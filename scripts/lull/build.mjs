#!/usr/bin/env node
/**
 * Build Lull scene packages for one or all codevember projects.
 *
 *   npm run lull:build -- --all
 *   npm run lull:build -- --only 01-fold,06-orrery --pack
 *   npm run lull:build -- --all --pack --target bundled --into F:/TK/GameProjects/lull-app
 *
 * The script is dependency-free; Vite and vite-plugin-glsl are resolved from
 * each project's own node_modules.
 */

import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";

import { walkRelativeFiles } from "../../tools/lull/build/assets.mjs";
import {
  discoverScenes,
  loadGlobalConfig,
  loadScene,
  repoRoot,
  validateSceneConfig,
} from "../../tools/lull/build/config.mjs";
import { assembleScene } from "../../tools/lull/build/package.mjs";
import { buildScene, sdkIndexPath } from "../../tools/lull/build/vite.mjs";
import { writeZip } from "../../tools/lull/build/zip.mjs";

const args = process.argv.slice(2);

function flag(name) {
  return args.includes(`--${name}`);
}

function option(name, fallback = undefined) {
  const index = args.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`--${name} 需要一个参数`);
  }
  return value;
}

function listOption(name) {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== `--${name}`) continue;
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`--${name} 需要一个参数`);
    values.push(...value.split(",").map((item) => item.trim()).filter(Boolean));
  }
  return values;
}

const globalConfig = loadGlobalConfig();
const outRoot = resolve(repoRoot, option("out", globalConfig.outDir ?? "dist-lull"));
const only = listOption("only");
const pack = flag("pack");
const release = flag("release");
const install = flag("install");
const target = option("target", "install");
const into = option("into");
const sdkIndex = sdkIndexPath();

if (!["install", "bundled", "both"].includes(target)) {
  throw new Error("--target 只能是 install / bundled / both");
}
if ((target === "bundled" || target === "both") && !into) {
  throw new Error("--target bundled/both 需要 --into <lull-app 目录>");
}

let candidates = discoverScenes(globalConfig);
if (only.length > 0) {
  candidates = candidates.filter((item) => {
    let id = "";
    try {
      id = loadScene(item.projectDir, globalConfig).scene.id;
    } catch {
      // Leave broken configs in so the report shows the actual error.
      return only.some((value) => item.folder.includes(value));
    }
    return only.some(
      (value) =>
        value === item.folder ||
        value === id ||
        item.folder.includes(value) ||
        id.includes(value),
    );
  });
}

if (candidates.length === 0) {
  console.error("[lull] 没有找到可构建的场景配置（NN-name/lull/scene.json）");
  process.exit(1);
}

mkdirSync(outRoot, { recursive: true });
const report = {
  schemaVersion: 1,
  builtAt: new Date().toISOString(),
  outDir: relative(repoRoot, outRoot) || ".",
  scenes: [],
};
const artifactsDir = join(outRoot, "artifacts");
if (pack) mkdirSync(artifactsDir, { recursive: true });

let failures = 0;

for (const candidate of candidates) {
  const { folder, projectDir } = candidate;
  const started = Date.now();
  const entry = {
    folder,
    id: null,
    version: null,
    status: "failed",
    warnings: [],
    errors: [],
  };

  try {
    const { scene } = loadScene(projectDir, globalConfig);
    entry.id = scene.id;
    entry.version = scene.version;

    const configCheck = validateSceneConfig(scene, projectDir);
    entry.warnings.push(...configCheck.warnings);
    if (configCheck.errors.length > 0) {
      entry.errors.push(...configCheck.errors);
      throw new Error(`配置校验失败：\n  ${configCheck.errors.join("\n  ")}`);
    }

    ensureDeps(projectDir, install);

    console.log(`\n[lull] ${folder} → ${scene.id} ${scene.version}`);
    const builtDir = await buildScene(projectDir, { sdkIndex });
    const assembled = assembleScene({
      scene,
      projectDir,
      outRoot,
      builtDir,
      release,
    });

    entry.digest = assembled.digest;
    entry.bytes = assembled.bytes;
    entry.maxFile = assembled.maxFile;
    entry.files = assembled.files.length;
    entry.warnings.push(...assembled.warnings);
    entry.errors.push(...assembled.errors);
    entry.status = assembled.errors.length === 0 ? "built" : "invalid";

    if (assembled.errors.length > 0) failures += 1;

    if (pack && assembled.errors.length === 0) {
      const zipPath = join(artifactsDir, `${scene.id}-${scene.version}.zip`);
      const files = walkRelativeFiles(assembled.pkgDir).sort();
      writeZip(
        zipPath,
        files.map((file) => ({
          name: file,
          data: readFileSync(join(assembled.pkgDir, ...file.split("/"))),
        })),
      );
      entry.zip = relative(repoRoot, zipPath);
      console.log(`[lull] zip → ${entry.zip}`);
    }

    if (target === "bundled" || target === "both") {
      copyBundled(assembled.pkgDir, scene, into);
      entry.bundled = relative(repoRoot, join(into, "extensions", "bundled", `codevember-${scene.slug}`));
    }

    entry.ms = Date.now() - started;
    console.log(
      `[lull] ${scene.id}: ${entry.status}, ${(assembled.bytes / 1024).toFixed(1)} KiB, ` +
        `${assembled.files.length} files` +
        (entry.warnings.length ? `, ${entry.warnings.length} warnings` : ""),
    );
  } catch (error) {
    failures += 1;
    entry.errors.push(error instanceof Error ? error.message : String(error));
    console.error(`[lull] ${folder} 失败：${entry.errors.at(-1)}`);
  }

  report.scenes.push(entry);
}

writeFileSync(
  join(outRoot, "report.json"),
  `${JSON.stringify(report, null, 2)}\n`,
);

const built = report.scenes.filter((scene) => scene.status === "built").length;
console.log(`\n[lull] 完成：${built}/${report.scenes.length} 个包，报告 ${relative(repoRoot, join(outRoot, "report.json"))}`);
if (failures > 0) process.exitCode = 1;

function ensureDeps(projectDir, shouldInstall) {
  if (existsSync(join(projectDir, "node_modules"))) return;

  if (!shouldInstall) {
    throw new Error(
      `${relative(repoRoot, projectDir)} 没有 node_modules；先执行 npm ci，或给命令加 --install。`,
    );
  }

  console.log(`[lull] 安装依赖：${relative(repoRoot, projectDir)}`);
  const result = spawnSync("npm", ["ci", "--no-audit", "--no-fund"], {
    cwd: projectDir,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    throw new Error(`npm ci 失败：${relative(repoRoot, projectDir)}`);
  }
}

function copyBundled(pkgDir, scene, lullAppRoot) {
  const label = `codevember-${scene.slug}`;
  const dest = join(lullAppRoot, "extensions", "bundled", label);
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  cpSync(pkgDir, dest, { recursive: true });
  console.log(`[lull] bundled → ${relative(repoRoot, dest)}`);
}