// Reads the repository-wide Lull defaults and each project's lull/scene.json.
// This module is intentionally dependency-free so `node scripts/lull/check.mjs`
// works before any project has node_modules installed.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
export const lullRoot = join(repoRoot, "tools", "lull");
export const globalConfigPath = join(lullRoot, "lull.config.json");

export const CAPABILITIES = new Set([
  "wallpaper.viewport",
  "wallpaper.canvas",
  "wallpaper.sync",
  "wallpaper.params",
  "wallpaper.script",
  "wallpaper.pointer",
  "wallpaper.audio",
]);

export const PARAM_TYPES = new Set([
  "number",
  "boolean",
  "string",
  "color",
  "enum",
  "text",
]);

const ID = /^[a-z0-9][a-z0-9._-]{2,63}$/;
const SLUG = /^[a-z0-9][a-z0-9._-]{1,31}$/;
const KEY = /^[a-z][a-z0-9._-]{0,31}$/;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const COLOR = /^#[0-9a-f]{6}$/i;

export function loadGlobalConfig() {
  const raw = JSON.parse(readFileSync(globalConfigPath, "utf8"));
  if (raw.schemaVersion !== 1) {
    throw new Error(`${relative(repoRoot, globalConfigPath)}: schemaVersion 必须是 1`);
  }
  return raw;
}

export function scenePath(projectDir) {
  return join(projectDir, "lull", "scene.json");
}

export function discoverScenes(globalConfig = loadGlobalConfig()) {
  const wanted = Array.isArray(globalConfig.scenes) ? globalConfig.scenes : null;
  const folders = readdirSync(repoRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d+-/.test(entry.name))
    .map((entry) => entry.name)
    .filter((name) => (wanted ? wanted.includes(name) : true))
    .sort((left, right) => {
      const a = Number(left.match(/^(\d+)/)?.[1] ?? 0);
      const b = Number(right.match(/^(\d+)/)?.[1] ?? 0);
      return a - b;
    });

  return folders.flatMap((folder) => {
    const projectDir = join(repoRoot, folder);
    const configPath = scenePath(projectDir);
    if (!existsSync(configPath)) return [];
    return [{ folder, projectDir, configPath }];
  });
}

export function loadScene(projectDir, globalConfig = loadGlobalConfig()) {
  const path = scenePath(projectDir);
  if (!existsSync(path)) {
    throw new Error(`缺少 ${relative(repoRoot, path)}`);
  }

  const raw = JSON.parse(readFileSync(path, "utf8"));
  if (raw.schemaVersion !== 1) {
    throw new Error(`${relative(repoRoot, path)}: schemaVersion 必须是 1`);
  }

  const merged = mergeScene(globalConfig.defaults ?? {}, raw);
  merged.entry = merged.entry ?? "lull/entry.ts";
  merged.assets = merged.assets ?? [];
  merged.hide = merged.hide ?? [];
  merged.params = merged.params ?? [];
  merged.requires = merged.requires ?? [];
  merged.assetsLicense = merged.assetsLicense ?? "review";

  return {
    scene: merged,
    projectDir,
    configPath: path,
  };
}

function mergeScene(defaults, scene) {
  return {
    ...defaults,
    ...scene,
    theme: { ...(defaults.theme ?? {}), ...(scene.theme ?? {}) },
    performance: { ...(defaults.performance ?? {}), ...(scene.performance ?? {}) },
    compatibility: {
      ...(defaults.compatibility ?? {}),
      ...(scene.compatibility ?? {}),
    },
    capabilities: scene.capabilities ?? defaults.capabilities ?? [],
    params: scene.params ?? [],
  };
}

/**
 * @returns {{ errors: string[], warnings: string[] }}
 */
export function validateSceneConfig(scene, projectDir) {
  const errors = [];
  const warnings = [];

  const fail = (message) => errors.push(message);
  const warn = (message) => warnings.push(message);

  if (!ID.test(String(scene.id ?? ""))) {
    fail(`id 非法：${String(scene.id)}（应为小写 author.scene，2–64 字符）`);
  }
  if (!SLUG.test(String(scene.slug ?? ""))) {
    fail(`slug 非法：${String(scene.slug)}（小写字母/数字/._-，2–32 字符）`);
  }
  if (!SEMVER.test(String(scene.version ?? ""))) {
    fail(`version 非法：${String(scene.version)}（需要语义化版本）`);
  }
  if (typeof scene.name !== "string" || scene.name.trim() === "") {
    fail("name 必填");
  } else if (scene.name.length > 80) {
    fail(`name 超过 80 字符：${scene.name.length}`);
  }
  if (typeof scene.license !== "string" || scene.license.trim() === "") {
    fail("license 必填");
  }
  if (typeof scene.description !== "string" || scene.description.trim() === "") {
    warn("description 为空，Lull 设置页只显示名称");
  }
  if (typeof scene.author !== "string" || scene.author.trim() === "") {
    warn("author 为空");
  }

  if (!scene.source || typeof scene.source !== "object") {
    fail("source 必填：{ html, module }");
  } else {
    for (const [key, value] of Object.entries(scene.source)) {
      if (typeof value !== "string" || value.trim() === "") {
        fail(`source.${key} 必填`);
        continue;
      }
      if (!existsSync(join(projectDir, value))) {
        fail(`source.${key} 不存在：${value}`);
      }
    }
    if (!existsSync(join(projectDir, scene.entry))) {
      fail(`entry 不存在：${scene.entry}`);
    }
  }

  if (scene.theme?.background && !COLOR.test(scene.theme.background)) {
    fail(`theme.background 必须是 #RRGGBB：${scene.theme.background}`);
  }
  if (scene.theme?.accent && !COLOR.test(scene.theme.accent)) {
    fail(`theme.accent 必须是 #RRGGBB：${scene.theme.accent}`);
  }

  if (!Array.isArray(scene.capabilities) || scene.capabilities.length === 0) {
    fail("capabilities 必须是非空数组");
  } else {
    const seen = new Set();
    for (const capability of scene.capabilities) {
      if (!CAPABILITIES.has(capability)) {
        fail(`未知 capability：${capability}`);
      }
      if (seen.has(capability)) fail(`capability 重复：${capability}`);
      seen.add(capability);
    }
  }

  const hostApi = Number(scene.compatibility?.hostApi ?? 1);
  if (!Number.isInteger(hostApi) || hostApi < 1 || hostApi > 5) {
    fail(`compatibility.hostApi 必须是 1–5 的整数：${hostApi}`);
  }
  if (scene.compatibility?.maxHostApi !== undefined) {
    const max = Number(scene.compatibility.maxHostApi);
    if (!Number.isInteger(max) || max < hostApi || max > 5) {
      fail(`compatibility.maxHostApi 必须 >= hostApi 且 <= 5：${max}`);
    }
  }
  if (
    scene.compatibility?.platforms !== undefined &&
    (!Array.isArray(scene.compatibility.platforms) ||
      scene.compatibility.platforms.length === 0)
  ) {
    fail("compatibility.platforms 必须是非空数组");
  }

  if (scene.performance?.tier !== undefined) {
    if (!["low", "medium", "high"].includes(scene.performance.tier)) {
      fail(`performance.tier 非法：${scene.performance.tier}`);
    }
  }
  if (scene.performance?.targetFps !== undefined) {
    const fps = Number(scene.performance.targetFps);
    if (!Number.isInteger(fps) || fps < 1 || fps > 240) {
      fail(`performance.targetFps 必须是 1–240 的整数：${fps}`);
    }
  }

  if (!Array.isArray(scene.requires)) {
    fail("requires 必须是数组");
  } else {
    for (const requirement of scene.requires) {
      if (!["webgpu", "webgl2"].includes(requirement)) {
        fail(`未知 requires：${requirement}`);
      }
    }
  }

  if (!Array.isArray(scene.assets)) {
    fail("assets 必须是数组");
  } else {
    for (const pattern of scene.assets) {
      if (typeof pattern !== "string" || !pattern.startsWith("public/")) {
        fail(`assets 只接受 public/ 下的 glob：${String(pattern)}`);
      }
    }
  }

  if (!Array.isArray(scene.hide)) {
    fail("hide 必须是数组");
  }

  if (!["ok", "review"].includes(scene.assetsLicense)) {
    fail(`assetsLicense 只能是 ok / review：${String(scene.assetsLicense)}`);
  }

  const params = Array.isArray(scene.params) ? scene.params : [];
  if (params.length > 0) {
    if (!scene.capabilities.includes("wallpaper.params")) {
      fail("声明 params 时必须同时声明 wallpaper.params");
    }
    if (!scene.capabilities.includes("wallpaper.script")) {
      fail("外部场景声明 params 时必须同时声明 wallpaper.script");
    }
  }

  const keys = new Set();
  for (const [index, param] of params.entries()) {
    const where = `params[${index}]`;
    if (!param || typeof param !== "object") {
      fail(`${where} 必须是对象`);
      continue;
    }
    if (typeof param.key !== "string" || !KEY.test(param.key)) {
      fail(`${where}.key 非法：${String(param.key)}`);
    } else if (keys.has(param.key)) {
      fail(`${where}.key 重复：${param.key}`);
    } else {
      keys.add(param.key);
    }
    if (typeof param.label !== "string" || param.label.trim() === "") {
      fail(`${where}.label 必填`);
    }
    if (!PARAM_TYPES.has(param.type)) {
      fail(`${where}.type 非法：${String(param.type)}`);
      continue;
    }
    validateParamValue(param, where, fail);

    if (!param.binding || (!param.binding.gui && !param.binding.property)) {
      fail(`${where}.binding 必须提供 gui 或 property`);
    }
    if (param.apply !== undefined && !["change", "finish"].includes(param.apply)) {
      fail(`${where}.apply 只能是 change / finish`);
    }
    if (param.map !== undefined) {
      if (!param.map || typeof param.map !== "object" || Array.isArray(param.map)) {
        fail(`${where}.map 必须是对象`);
      }
    }
  }

  if (scene.reducedMotion !== undefined) {
    if (
      !scene.reducedMotion ||
      typeof scene.reducedMotion.param !== "string" ||
      !keys.has(scene.reducedMotion.param)
    ) {
      fail("reducedMotion.param 必须是已声明的 params key");
    }
  }

  if (scene.capabilities.includes("wallpaper.pointer") && hostApi < 3) {
    fail("wallpaper.pointer 需要 compatibility.hostApi >= 3");
  }
  if (scene.capabilities.includes("wallpaper.audio") && hostApi < 5) {
    fail("wallpaper.audio 需要 compatibility.hostApi >= 5");
  }
  if (
    scene.capabilities.includes("wallpaper.sync") &&
    !scene.capabilities.includes("wallpaper.script")
  ) {
    fail("wallpaper.sync 必须同时声明 wallpaper.script");
  }

  return { errors, warnings };
}

function validateParamValue(param, where, fail) {
  const { type, default: value } = param;

  if (type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      fail(`${where}.default 必须是有限数字`);
    }
    for (const key of ["min", "max", "step"]) {
      if (param[key] !== undefined && (typeof param[key] !== "number" || !Number.isFinite(param[key]))) {
        fail(`${where}.${key} 必须是有限数字`);
      }
    }
    if (param.min !== undefined && param.max !== undefined && param.min > param.max) {
      fail(`${where}.min 不能大于 max`);
    }
    if (param.step !== undefined && param.step <= 0) {
      fail(`${where}.step 必须大于 0`);
    }
    if (typeof value === "number") {
      if (param.min !== undefined && value < param.min) fail(`${where}.default 小于 min`);
      if (param.max !== undefined && value > param.max) fail(`${where}.default 大于 max`);
    }
  } else if (type === "boolean") {
    if (typeof value !== "boolean") fail(`${where}.default 必须是布尔值`);
  } else if (type === "color") {
    if (typeof value !== "string" || !COLOR.test(value)) {
      fail(`${where}.default 必须是 #RRGGBB`);
    }
  } else if (type === "enum") {
    if (!Array.isArray(param.options) || param.options.length === 0) {
      fail(`${where}.options 必须是非空数组`);
      return;
    }
    const values = new Set();
    for (const [index, option] of param.options.entries()) {
      if (!option || typeof option.value !== "string" || typeof option.label !== "string") {
        fail(`${where}.options[${index}] 需要 string value/label`);
        continue;
      }
      if (values.has(option.value)) fail(`${where}.options[${index}].value 重复`);
      values.add(option.value);
    }
    if (typeof value !== "string" || !values.has(value)) {
      fail(`${where}.default 必须是 options 中的 value`);
    }
  } else if (type === "string" || type === "text") {
    if (typeof value !== "string") fail(`${where}.default 必须是字符串`);
  }
}

export function toManifest(scene) {
  const manifest = {
    schemaVersion: 1,
    type: "scene",
    id: scene.id,
    name: scene.name,
    version: scene.version,
    license: scene.license,
    capabilities: scene.capabilities,
    entry: `scenes/${scene.slug}/index.html`,
  };

  if (scene.description) manifest.description = scene.description;
  if (scene.author) manifest.author = scene.author;
  if (scene.theme?.background || scene.theme?.accent) {
    manifest.theme = {};
    if (scene.theme.background) manifest.theme.background = scene.theme.background;
    if (scene.theme.accent) manifest.theme.accent = scene.theme.accent;
  }
  if (scene.performance?.tier || scene.performance?.targetFps !== undefined) {
    manifest.performance = {};
    if (scene.performance.tier) manifest.performance.tier = scene.performance.tier;
    if (scene.performance.targetFps !== undefined) {
      manifest.performance.targetFps = scene.performance.targetFps;
    }
  }
  if (scene.compatibility) {
    manifest.compatibility = { hostApi: scene.compatibility.hostApi ?? 1 };
    if (scene.compatibility.maxHostApi !== undefined) {
      manifest.compatibility.maxHostApi = scene.compatibility.maxHostApi;
    }
    if (scene.compatibility.platforms) {
      manifest.compatibility.platforms = scene.compatibility.platforms;
    }
  }
  if (scene.params.length > 0) {
    manifest.params = scene.params.map((param) => {
      const item = {
        key: param.key,
        type: param.type,
        label: param.label,
        default: param.default,
      };
      if (param.description) item.description = param.description;
      if (param.type === "number") {
        if (param.min !== undefined) item.min = param.min;
        if (param.max !== undefined) item.max = param.max;
        if (param.step !== undefined) item.step = param.step;
      }
      if (param.type === "enum") item.options = param.options;
      return item;
    });
  }

  return manifest;
}