import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  toManifest,
  validateSceneConfig,
} from "../../../tools/lull/build/config.mjs";

function project() {
  const dir = mkdtempSync(join(tmpdir(), "lull-config-"));
  mkdirSync(join(dir, "src"), { recursive: true });
  mkdirSync(join(dir, "lull"), { recursive: true });
  writeFileSync(join(dir, "index.html"), "<!doctype html>");
  writeFileSync(join(dir, "src", "index.ts"), "export {};\n");
  writeFileSync(join(dir, "lull", "entry.ts"), "export {};\n");
  return dir;
}

function scene(overrides = {}) {
  return {
    schemaVersion: 1,
    id: "codevember.test",
    slug: "test",
    name: "Test",
    version: "1.0.0",
    description: "A test scene.",
    author: "Yuri Artiukh",
    license: "CC-BY-4.0",
    source: { html: "index.html", module: "src/index.ts" },
    entry: "lull/entry.ts",
    theme: { background: "#111111" },
    capabilities: ["wallpaper.viewport", "wallpaper.params", "wallpaper.script"],
    performance: { tier: "medium", targetFps: 60 },
    compatibility: { hostApi: 1, platforms: ["windows"] },
    requires: ["webgpu"],
    assets: [],
    hide: [".lil-gui"],
    assetsLicense: "ok",
    params: [
      {
        key: "speed",
        type: "number",
        label: "Speed",
        default: 1,
        min: 0,
        max: 2,
        step: 0.01,
        binding: { property: "speed" },
      },
    ],
    ...overrides,
  };
}

test("a complete config validates", () => {
  const dir = project();
  try {
    const result = validateSceneConfig(scene(), dir);
    assert.deepEqual(result.errors, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("params require script capability", () => {
  const dir = project();
  try {
    const result = validateSceneConfig(
      scene({ capabilities: ["wallpaper.viewport", "wallpaper.params"] }),
      dir,
    );
    assert.ok(result.errors.some((error) => error.includes("wallpaper.script")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("camelCase param keys are rejected by the Lull key rule", () => {
  const dir = project();
  try {
    const value = scene();
    value.params[0].key = "sunTurn";
    const result = validateSceneConfig(value, dir);
    assert.ok(result.errors.some((error) => error.includes("key 非法")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("defaults must stay inside min/max", () => {
  const dir = project();
  try {
    const value = scene();
    value.params[0].default = 5;
    const result = validateSceneConfig(value, dir);
    assert.ok(result.errors.some((error) => error.includes("大于 max")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("toManifest strips build-only fields", () => {
  const manifest = toManifest(scene());
  assert.equal(manifest.entry, "scenes/test/index.html");
  assert.equal(manifest.type, "scene");
  assert.equal(manifest.params[0].binding, undefined);
  assert.equal(manifest.assets, undefined);
  assert.equal(manifest.source, undefined);
});