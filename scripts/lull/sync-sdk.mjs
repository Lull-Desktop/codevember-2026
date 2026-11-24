#!/usr/bin/env node
/**
 * Re-vendors @lull/scene-sdk from a local Lull checkout.
 *
 *   npm run lull:sync-sdk -- --from F:/TK/GameProjects/lull-app/packages/scene-sdk
 *
 * The checked-in copy under tools/lull/scene-sdk is what CI and other machines
 * use; this command is only for updating it.
 */

import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

import { repoRoot } from "../../tools/lull/build/config.mjs";

const args = process.argv.slice(2);
const fromIndex = args.indexOf("--from");
const source = resolve(
  fromIndex === -1 ? process.env.LULL_SCENE_SDK ?? "F:/TK/GameProjects/lull-app/packages/scene-sdk" : args[fromIndex + 1],
);
const dest = join(repoRoot, "tools", "lull", "scene-sdk");

if (!existsSync(join(source, "dist", "index.js"))) {
  console.error(`找不到 ${join(source, "dist", "index.js")}`);
  console.error("先在 lull-app 执行 pnpm scenes:sdk，或用 --from 指定 packages/scene-sdk。");
  process.exit(1);
}

const destDist = join(dest, "dist");
mkdirSync(destDist, { recursive: true });

// Remove stale SDK artefacts from both the flat (old) and dist layouts.
for (const dir of [dest, destDist]) {
  if (!existsSync(dir)) continue;
  for (const file of readdirSync(dir)) {
    if (file.endsWith(".js") || file.endsWith(".d.ts")) {
      rmSync(join(dir, file), { force: true });
    }
  }
}

const copied = [];
for (const file of readdirSync(join(source, "dist"))) {
  if (!file.endsWith(".js") && !file.endsWith(".d.ts")) continue;
  copyFileSync(join(source, "dist", file), join(destDist, file));
  copied.push(`dist/${file}`);
}

for (const file of ["package.json"]) {
  const path = join(source, file);
  if (existsSync(path)) {
    copyFileSync(path, join(dest, file));
    copied.push(file);
  }
}

const readme = join(source, "README.md");
if (existsSync(readme)) {
  const banner = `> Vendored for the codevember-2026 Lull scene export.
> Scene source: https://github.com/akella/codevember-2026
> Upstream project: https://github.com/Lull-Desktop/Lull

`;
  writeFileSync(join(dest, "README.md"), banner + readFileSync(readme, "utf8"));
  copied.push("README.md");
}

const license = join(dirname(source), "..", "SDK-LICENSE.md");
if (existsSync(license)) {
  copyFileSync(license, join(dest, "LICENSE"));
  copied.push("LICENSE");
}

const packageJson = JSON.parse(readFileSync(join(source, "package.json"), "utf8"));
const files = copied.sort().map((file) => {
  const bytes = readFileSync(join(dest, file));
  return {
    name: file,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
});

writeFileSync(
  join(dest, "SOURCE.json"),
  `${JSON.stringify(
    {
      schemaVersion: 1,
      package: packageJson.name,
      version: packageJson.version,
      source: source.replaceAll("\\", "/"),
      usedBy: "https://github.com/akella/codevember-2026",
      syncedAt: new Date().toISOString(),
      files,
    },
    null,
    2,
  )}\n`,
);

console.log(`[lull] scene-sdk ${packageJson.version} → ${dest}`);
console.log(`[lull] ${files.length} files, ${(files.reduce((sum, file) => sum + file.bytes, 0) / 1024).toFixed(1)} KiB`);