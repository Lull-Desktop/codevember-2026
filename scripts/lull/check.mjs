#!/usr/bin/env node
/**
 * Validates scene configs and, when present, the packages under dist-lull/.
 * No node_modules required.
 *
 *   npm run lull:check
 *   npm run lull:check -- --json
 *   npm run lull:check -- --release
 */

import { existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import {
  discoverScenes,
  loadGlobalConfig,
  loadScene,
  repoRoot,
  validateSceneConfig,
} from "../../tools/lull/build/config.mjs";
import { validatePackage } from "../../tools/lull/build/validate.mjs";

const args = process.argv.slice(2);
const json = args.includes("--json");
const release = args.includes("--release");

const globalConfig = loadGlobalConfig();
const outRoot = resolve(repoRoot, globalConfig.outDir ?? "dist-lull");
const scenes = discoverScenes(globalConfig);
const results = [];
let failures = 0;

for (const { folder, projectDir } of scenes) {
  const result = {
    folder,
    id: null,
    version: null,
    errors: [],
    warnings: [],
    package: null,
  };

  try {
    const { scene } = loadScene(projectDir, globalConfig);
    result.id = scene.id;
    result.version = scene.version;

    const configCheck = validateSceneConfig(scene, projectDir);
    result.errors.push(...configCheck.errors);
    result.warnings.push(...configCheck.warnings);

    for (const file of [
      "lull/prelude.ts",
      "lull/entry.ts",
      "lull/tsconfig.json",
    ]) {
      if (!existsSync(join(projectDir, file))) {
        result.errors.push(`缺少 ${file}`);
      }
    }

    const pkgDir = join(outRoot, scene.id);
    if (existsSync(join(pkgDir, "catalog.json"))) {
      const packageCheck = validatePackage(pkgDir, {
        release,
        assetsLicense: scene.assetsLicense,
      });
      result.package = {
        errors: packageCheck.errors,
        warnings: packageCheck.warnings,
        digest: packageCheck.digest,
        bytes: packageCheck.bytes,
      };
      result.errors.push(...packageCheck.errors);
      result.warnings.push(...packageCheck.warnings);
    }
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : String(error));
  }

  if (result.errors.length > 0) failures += 1;
  results.push(result);

  if (!json) {
    const status = result.errors.length > 0 ? "FAIL" : "ok";
    console.log(
      `${status.padEnd(4)} ${folder.padEnd(14)} ${result.id ?? "?"} ` +
        `${result.errors.length} errors, ${result.warnings.length} warnings`,
    );
    for (const error of result.errors) console.log(`     error: ${error}`);
    for (const warning of result.warnings) console.log(`     warn:  ${warning}`);
  }
}

if (json) {
  console.log(JSON.stringify({ schemaVersion: 1, results }, null, 2));
} else {
  console.log(
    `\n[lull] ${scenes.length} configs, ${failures} with errors, output ${relative(repoRoot, outRoot)}`,
  );
}

if (failures > 0) process.exitCode = 1;