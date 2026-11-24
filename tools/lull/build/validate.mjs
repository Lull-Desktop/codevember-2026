// Validates the generated package against the Lull v1 scene contract and the
// extra safety rules the host enforces. Kept dependency-free.

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { computePackageDigest, walkFiles } from "./digest.mjs";

const MAX_FILE = 8 * 1024 * 1024;
const MAX_PACKAGE = 64 * 1024 * 1024;
const MAX_FILES = 512;
const WARN_PACKAGE = 5 * 1024 * 1024;

const ALLOWED_SCENE_KEYS = new Set([
  "schemaVersion",
  "type",
  "id",
  "name",
  "version",
  "description",
  "author",
  "license",
  "capabilities",
  "entry",
  "theme",
  "params",
  "performance",
  "compatibility",
  "game",
  "audio",
  "integrity",
]);

const CAPABILITIES = new Set([
  "wallpaper.viewport",
  "wallpaper.canvas",
  "wallpaper.sync",
  "wallpaper.params",
  "wallpaper.script",
  "wallpaper.pointer",
  "wallpaper.audio",
]);

const PARAM_TYPES = new Set([
  "number",
  "boolean",
  "string",
  "color",
  "enum",
  "text",
]);

const ID = /^[a-z0-9][a-z0-9._-]{2,63}$/;
const KEY = /^[a-z][a-z0-9._-]{0,31}$/;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const COLOR = /^#[0-9a-f]{6}$/i;

export function validatePackage(pkgDir, { release = false, assetsLicense = "review" } = {}) {
  const errors = [];
  const warnings = [];
  const fail = (message) => errors.push(message);
  const warn = (message) => warnings.push(message);

  const catalogPath = join(pkgDir, "catalog.json");
  if (!existsSync(catalogPath)) {
    return { errors: [`缺少 catalog.json：${catalogPath}`], warnings, empty: true };
  }

  let catalog;
  try {
    catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
  } catch (error) {
    return { errors: [`catalog.json 不是合法 JSON：${error.message}`], warnings, empty: true };
  }

  if (catalog.schemaVersion !== 1) fail("catalog.schemaVersion 必须是 1");
  if (!Array.isArray(catalog.scenes) || catalog.scenes.length !== 1) {
    fail("catalog.scenes 必须恰好包含一条 scene");
    return { errors, warnings, empty: true };
  }

  const scene = catalog.scenes[0];
  if (!scene || typeof scene !== "object") {
    fail("scenes[0] 必须是对象");
    return { errors, warnings, empty: true };
  }

  for (const key of Object.keys(scene)) {
    if (!ALLOWED_SCENE_KEYS.has(key)) fail(`未知 scene 字段：${key}`);
  }

  if (scene.schemaVersion !== 1) fail("scene.schemaVersion 必须是 1");
  if (scene.type !== "scene") fail('scene.type 必须是 "scene"');
  if (!ID.test(String(scene.id ?? ""))) fail(`scene.id 非法：${String(scene.id)}`);
  if (typeof scene.name !== "string" || scene.name.trim() === "") {
    fail("scene.name 必填");
  } else if (scene.name.length > 80) {
    fail("scene.name 超过 80 字符");
  }
  if (!SEMVER.test(String(scene.version ?? ""))) {
    fail(`scene.version 非法：${String(scene.version)}`);
  }
  if (typeof scene.license !== "string" || scene.license.trim() === "") {
    fail("scene.license 必填");
  }

  if (!Array.isArray(scene.capabilities) || scene.capabilities.length === 0) {
    fail("scene.capabilities 必须是非空数组");
  } else {
    const seen = new Set();
    for (const capability of scene.capabilities) {
      if (!CAPABILITIES.has(capability)) fail(`未知 capability：${capability}`);
      if (seen.has(capability)) fail(`capability 重复：${capability}`);
      seen.add(capability);
    }
  }

  if (scene.theme?.background && !COLOR.test(scene.theme.background)) {
    fail("theme.background 必须是 #RRGGBB");
  }
  if (scene.theme?.accent && !COLOR.test(scene.theme.accent)) {
    fail("theme.accent 必须是 #RRGGBB");
  }

  const capabilities = Array.isArray(scene.capabilities) ? scene.capabilities : [];
  const hostApi = Number(scene.compatibility?.hostApi ?? 1);
  if (!Number.isInteger(hostApi) || hostApi < 1 || hostApi > 5) {
    fail(`compatibility.hostApi 非法：${hostApi}`);
  }
  if (capabilities.includes("wallpaper.pointer") && hostApi < 3) {
    fail("wallpaper.pointer 需要 hostApi >= 3");
  }
  if (capabilities.includes("wallpaper.audio") && hostApi < 5) {
    fail("wallpaper.audio 需要 hostApi >= 5");
  }
  if (scene.compatibility?.maxHostApi !== undefined) {
    const max = Number(scene.compatibility.maxHostApi);
    if (!Number.isInteger(max) || max < hostApi || max > 5) {
      fail(`compatibility.maxHostApi 非法：${max}`);
    }
  }
  if (scene.performance?.tier !== undefined) {
    if (!["low", "medium", "high"].includes(scene.performance.tier)) {
      fail(`performance.tier 非法：${scene.performance.tier}`);
    }
  }
  if (scene.performance?.targetFps !== undefined) {
    const fps = Number(scene.performance.targetFps);
    if (!Number.isInteger(fps) || fps < 1 || fps > 240) {
      fail(`performance.targetFps 非法：${fps}`);
    }
  }

  const entry = scene.entry;
  if (typeof entry !== "string" || !entry.endsWith(".html")) {
    fail("scene.entry 必须是 .html");
  } else if (!isSafeRelativePath(entry)) {
    fail(`scene.entry 路径不安全：${entry}`);
  } else if (entry.split("/").length < 2 || entry.split("/").length > 6) {
    fail(`scene.entry 深度必须是 2–6：${entry}`);
  } else if (!existsSync(join(pkgDir, ...entry.split("/")))) {
    fail(`scene.entry 文件不存在：${entry}`);
  }

  const params = Array.isArray(scene.params) ? scene.params : [];
  if (params.length > 0) {
    if (!capabilities.includes("wallpaper.params")) {
      fail("声明 params 时必须声明 wallpaper.params");
    }
    if (!capabilities.includes("wallpaper.script")) {
      fail("外部场景声明 params 时必须声明 wallpaper.script");
    }
  }
  validateManifestParams(params, fail);

  if (release && assetsLicense !== "ok") {
    fail("assetsLicense 仍为 review；正式发布前必须完成素材授权审计");
  }

  if (scene.integrity) {
    if (scene.integrity.algorithm !== "sha256" || scene.integrity.scope !== "package") {
      fail("integrity 必须是 { algorithm: sha256, scope: package }");
    }
  }

  if (errors.length > 0) return { errors, warnings, empty: false };

  const entryDir = join(pkgDir, ...entry.split("/").slice(0, -1));
  let digest;
  try {
    const result = computePackageDigest({
      id: scene.id,
      version: scene.version,
      dir: entryDir,
    });
    digest = result.digest;

    if (scene.integrity?.digest !== digest) {
      fail(`integrity 不匹配：声明 ${scene.integrity?.digest}，实际 ${digest}`);
    }

    const files = walkFiles(entryDir);
    const bytes = files.reduce(
      (sum, file) => sum + statSync(join(entryDir, ...file.split("/"))).size,
      0,
    );
    const maxFile = Math.max(
      0,
      ...files.map((file) => statSync(join(entryDir, ...file.split("/"))).size),
    );

    if (files.length > MAX_FILES) fail(`文件数超过 ${MAX_FILES}：${files.length}`);
    if (bytes > MAX_PACKAGE) {
      fail(`整包 ${(bytes / 1024 / 1024).toFixed(2)} MB 超过 ${MAX_PACKAGE / 1024 / 1024} MB`);
    } else if (bytes > WARN_PACKAGE) {
      warn(`整包 ${(bytes / 1024 / 1024).toFixed(2)} MB 超过建议的 5 MB`);
    }
    if (maxFile > MAX_FILE) {
      fail(`单文件 ${(maxFile / 1024 / 1024).toFixed(2)} MB 超过 8 MB 上限`);
    }

    scanForbidden(entryDir, files, fail, warn);
    return { errors, warnings, digest, files, bytes, maxFile, scene };
  } catch (error) {
    fail(error.message);
    return { errors, warnings, empty: false };
  }
}

function validateManifestParams(params, fail) {
  const keys = new Set();
  params.forEach((param, index) => {
    const where = `params[${index}]`;
    if (!param || typeof param !== "object") {
      fail(`${where} 必须是对象`);
      return;
    }
    if (typeof param.key !== "string" || !KEY.test(param.key)) {
      fail(`${where}.key 非法`);
    } else if (keys.has(param.key)) {
      fail(`${where}.key 重复`);
    } else {
      keys.add(param.key);
    }
    if (typeof param.label !== "string" || param.label.trim() === "") {
      fail(`${where}.label 必填`);
    }
    if (!PARAM_TYPES.has(param.type)) fail(`${where}.type 非法`);
    if (!("default" in param)) fail(`${where}.default 必填`);

    if (param.type === "number") {
      if (typeof param.default !== "number" || !Number.isFinite(param.default)) {
        fail(`${where}.default 必须是有限数字`);
      }
      for (const key of ["min", "max", "step"]) {
        if (param[key] !== undefined && typeof param[key] !== "number") {
          fail(`${where}.${key} 必须是数字`);
        }
      }
      if (param.min !== undefined && param.max !== undefined && param.min > param.max) {
        fail(`${where}.min 不能大于 max`);
      }
      if (param.step !== undefined && param.step <= 0) fail(`${where}.step 必须大于 0`);
    } else if (param.type === "boolean") {
      if (typeof param.default !== "boolean") fail(`${where}.default 必须是布尔值`);
    } else if (param.type === "color") {
      if (typeof param.default !== "string" || !COLOR.test(param.default)) {
        fail(`${where}.default 必须是 #RRGGBB`);
      }
    } else if (param.type === "enum") {
      if (!Array.isArray(param.options) || param.options.length === 0) {
        fail(`${where}.options 必须是非空数组`);
      } else {
        const values = new Set(
          param.options
            .filter((option) => option && typeof option.value === "string")
            .map((option) => option.value),
        );
        if (values.size !== param.options.length) fail(`${where}.options 含非法或重复 value`);
        if (typeof param.default !== "string" || !values.has(param.default)) {
          fail(`${where}.default 必须是 options 中的 value`);
        }
      }
    } else if (param.type === "string" || param.type === "text") {
      if (typeof param.default !== "string") fail(`${where}.default 必须是字符串`);
    }
  });
}

function isSafeRelativePath(value) {
  if (value.includes("\\") || value.includes("%") || value.includes("\0")) return false;
  if (value.startsWith("/")) return false;
  const parts = value.split("/");
  return parts.every((part) => part !== "" && part !== "." && part !== "..") && parts.length >= 2;
}

function scanForbidden(entryDir, files, fail, warn) {
  const textFiles = files.filter((file) =>
    /\.(?:js|mjs|html|css|json|md)$/i.test(file),
  );

  for (const file of textFiles) {
    const source = readFileSync(join(entryDir, ...file.split("/")), "utf8");
    const check = (pattern, message, severity = "error") => {
      if (!pattern.test(source)) return;
      (severity === "warn" ? warn : fail)(`${file}: ${message}`);
    };

    check(/\b(?:localStorage|sessionStorage|indexedDB)\b/, "使用了浏览器存储（不透明源不可用）");
    check(/document\.cookie/, "使用了 document.cookie");
    // Lull's own validator treats eval/new Function as a warning: the host CSP
    // blocks them only if the code path executes. Three.js TSL includes
    // `new Function` in its bundle even when a particular scene never calls it.
    check(/\beval\s*\(/, "使用了 eval；Lull CSP 无 unsafe-eval，执行时会被拦截", "warn");
    check(/\bnew\s+Function\s*\(/, "使用了 new Function；Lull CSP 无 unsafe-eval，执行时会被拦截", "warn");
    check(/\bimport\s*\(/, "含动态 import；内容包必须是单文件");
    check(/@tauri-apps/, "导入了 Tauri API");
    check(/fetch\s*\(\s*["'`]https?:/i, "fetch 了远程资源");
    check(/url\(\s*["']?https?:/i, "CSS 引用了远程资源");
    check(/<(?:script|img|link|source|video|audio)\b[^>]*(?:src|href)\s*=\s*["']https?:/i, "HTML 引用了远程资源");
    check(/\son[a-z]+\s*=\s*["']/i, "HTML 含内联事件处理器");

    // A "https://" in a license header or error string is harmless; only the
    // active resource patterns above are errors.
  }
}