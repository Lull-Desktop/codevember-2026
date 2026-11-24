// Assembles dist-lull/<id>/ from the Vite output + declared public assets.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { copyAssets, copyDirectory, walkRelativeFiles } from "./assets.mjs";
import { toManifest } from "./config.mjs";
import { computePackageDigest } from "./digest.mjs";
import { renderSceneHtml } from "./html.mjs";
import { validatePackage } from "./validate.mjs";

const SOURCE_URL = "https://github.com/akella/codevember-2026";

export function assembleScene({
  scene,
  projectDir,
  outRoot,
  builtDir,
  release = false,
}) {
  const pkgDir = join(outRoot, scene.id);
  const entryRel = `scenes/${scene.slug}`;
  const entryDir = join(pkgDir, ...entryRel.split("/"));

  rmSync(pkgDir, { recursive: true, force: true });
  mkdirSync(entryDir, { recursive: true });

  if (!existsSync(join(builtDir, "scene.js"))) {
    throw new Error(`Vite 没有产出 scene.js：${builtDir}`);
  }
  copyDirectory(builtDir, entryDir);
  copyAssets(projectDir, scene.assets, entryDir);

  writeFileSync(
    join(entryDir, "index.html"),
    renderSceneHtml({ projectDir, scene, mode: "package" }),
  );
  writeFileSync(join(entryDir, "LICENSE"), licenseText(scene));
  writeFileSync(
    join(entryDir, "THIRD_PARTY_NOTICES.md"),
    thirdPartyNotices(scene),
  );

  const manifest = toManifest(scene);
  manifest.integrity = {
    algorithm: "sha256",
    scope: "package",
    digest: "0".repeat(64),
  };

  const catalog = { schemaVersion: 1, scenes: [manifest] };
  const { digest, files, bytes } = computePackageDigest({
    id: scene.id,
    version: scene.version,
    dir: entryDir,
  });
  manifest.integrity.digest = digest;
  writeFileSync(
    join(pkgDir, "catalog.json"),
    `${JSON.stringify(catalog, null, 2)}\n`,
  );

  const validation = validatePackage(pkgDir, {
    release,
    assetsLicense: scene.assetsLicense,
  });

  return {
    pkgDir,
    entryDir,
    entry: manifest.entry,
    digest,
    files,
    bytes,
    maxFile: Math.max(
      0,
      ...files.map((file) => statSync(join(entryDir, ...file.split("/"))).size),
    ),
    ...validation,
  };
}

export function packageFiles(pkgDir) {
  return walkRelativeFiles(pkgDir);
}

function licenseText(scene) {
  return `Copyright (c) 2026 ${scene.author ?? "Yuri Artiukh"}

This scene package is licensed under the Creative Commons Attribution 4.0
International License (CC BY 4.0).

You are free to share and adapt the material for any purpose, provided you
give appropriate credit, link to the license, and indicate if changes were
made.

License: https://creativecommons.org/licenses/by/4.0/
Source: ${SOURCE_URL}
`;
}

function thirdPartyNotices(scene) {
  return `# Third-party notices

Scene: ${scene.name} (${scene.id} ${scene.version})

## Scene source

https://github.com/akella/codevember-2026

## @lull/scene-sdk

The scene bridge is bundled from \`@lull/scene-sdk\`, licensed under
Apache-2.0. Source: https://github.com/Lull-Desktop/Lull

## Three.js

The sketch uses Three.js, licensed under the MIT License.
Source: https://github.com/mrdoob/three.js

## Assets

Asset provenance and licensing for this scene are tracked in the source
repository: ${SOURCE_URL}
Do not redistribute assets whose rights are not cleared.
`;
}

export function readCatalog(pkgDir) {
  return JSON.parse(readFileSync(join(pkgDir, "catalog.json"), "utf8"));
}