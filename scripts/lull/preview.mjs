#!/usr/bin/env node
/**
 * Starts a Vite dev server with the Lull entry and a generated preview page.
 *
 *   npm run lull:preview -- 01-fold
 *
 * The page is served from the project root with <base href="/">, so the
 * sketch's existing `fetch("./asset")` calls hit Vite's public/ directory.
 * bootLullScene falls back to a local SceneFrame and accepts ?key=value.
 */

import { existsSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

import {
  discoverScenes,
  loadGlobalConfig,
  loadScene,
  repoRoot,
  validateSceneConfig,
} from "../../tools/lull/build/config.mjs";
import { renderSceneHtml } from "../../tools/lull/build/html.mjs";
import { createPreviewServer, sdkIndexPath } from "../../tools/lull/build/vite.mjs";

const folder = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
if (!folder) {
  console.error("用法：npm run lull:preview -- <NN-name>");
  process.exit(1);
}

const globalConfig = loadGlobalConfig();
const candidate = discoverScenes(globalConfig).find(
  (item) => item.folder === folder || item.folder.startsWith(`${folder}-`),
);
if (!candidate) {
  console.error(`找不到 ${folder}/lull/scene.json`);
  process.exit(1);
}

const { scene } = loadScene(candidate.projectDir, globalConfig);
const check = validateSceneConfig(scene, candidate.projectDir);
if (check.errors.length > 0) {
  console.error(`配置校验失败：\n  ${check.errors.join("\n  ")}`);
  process.exit(1);
}

const previewPath = join(candidate.projectDir, "lull-preview.html");
writeFileSync(
  previewPath,
  renderSceneHtml({ projectDir: candidate.projectDir, scene, mode: "preview" }),
);

const server = await createPreviewServer(candidate.projectDir, {
  sdkIndex: sdkIndexPath(),
});
const address = server.httpServer?.address();
const port = typeof address === "object" && address ? address.port : 5173;
const url = `http://127.0.0.1:${port}/lull-preview.html`;

console.log(`\n[lull] ${relative(repoRoot, previewPath)}`);
console.log(`[lull] ${url}`);
console.log("[lull] 参数预览：在 URL 后加 ?key=value，例如 ?density=1.4\n");

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    await server.close();
    process.exit(0);
  });
}