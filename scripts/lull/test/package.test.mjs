import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { globToRegExp } from "../../../tools/lull/build/assets.mjs";
import { computePackageDigest } from "../../../tools/lull/build/digest.mjs";
import { validatePackage } from "../../../tools/lull/build/validate.mjs";
import { crc32, writeZip } from "../../../tools/lull/build/zip.mjs";

test("glob handles ** and *", () => {
  assert.ok(globToRegExp("bake/**/*.bin").test("bake/knot.bin"));
  assert.ok(globToRegExp("bake/**/*.bin").test("bake/sub/knot.bin"));
  assert.ok(!globToRegExp("bake/**/*.bin").test("other/knot.bin"));
  assert.ok(globToRegExp("*.json").test("a.json"));
  assert.ok(!globToRegExp("*.json").test("sub/a.json"));
});

test("zip round-trips names and bytes with forward slashes", () => {
  const dir = mkdtempSync(join(tmpdir(), "lull-zip-"));
  const file = join(dir, "test.zip");
  try {
    const entries = [
      { name: "catalog.json", data: '{"ok":true}\n' },
      { name: "scenes/test/index.html", data: Buffer.from([1, 2, 3]) },
    ];
    writeZip(file, entries);

    const archive = readFileSync(file);
    assert.equal(archive.readUInt32LE(0), 0x04034b50);
    const parsed = readZip(archive);
    assert.deepEqual(parsed.map((entry) => entry.name), entries.map((entry) => entry.name));
    assert.deepEqual(parsed[0].data, Buffer.from('{"ok":true}\n'));
    assert.deepEqual(parsed[1].data, Buffer.from([1, 2, 3]));
    assert.equal(crc32(Buffer.from("hello")), 0x3610a686);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("zip rejects backslash and parent-directory names", () => {
  const dir = mkdtempSync(join(tmpdir(), "lull-zip-"));
  const file = join(dir, "test.zip");
  try {
    assert.throws(() => writeZip(file, [{ name: "a\\b", data: "x" }]));
    assert.throws(() => writeZip(file, [{ name: "../a", data: "x" }]));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("validatePackage accepts a minimal package and catches forbidden storage", () => {
  const dir = mkdtempSync(join(tmpdir(), "lull-pkg-"));
  try {
    const pkg = join(dir, "codevember.test");
    const sceneDir = join(pkg, "scenes", "test");
    mkdirSync(sceneDir, { recursive: true });
    writeFileSync(join(sceneDir, "index.html"), "<!doctype html><p>ok</p>");

    const id = "codevember.test";
    const version = "1.0.0";
    const digest = computePackageDigest({ id, version, dir: sceneDir }).digest;
    const catalog = {
      schemaVersion: 1,
      scenes: [
        {
          schemaVersion: 1,
          type: "scene",
          id,
          name: "Test",
          version,
          license: "CC-BY-4.0",
          capabilities: ["wallpaper.viewport", "wallpaper.script"],
          entry: "scenes/test/index.html",
          integrity: { algorithm: "sha256", scope: "package", digest },
        },
      ],
    };
    writeFileSync(join(pkg, "catalog.json"), JSON.stringify(catalog));

    const good = validatePackage(pkg);
    assert.deepEqual(good.errors, []);

    writeFileSync(
      join(sceneDir, "index.html"),
      "<!doctype html><script>localStorage.getItem('x')</script>",
    );
    const bad = validatePackage(pkg);
    assert.ok(bad.errors.some((error) => error.includes("浏览器存储")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function readZip(archive) {
  const eocd = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(eocd >= 0);
  const count = archive.readUInt16LE(eocd + 10);
  let offset = archive.readUInt32LE(eocd + 16);
  const entries = [];

  for (let index = 0; index < count; index += 1) {
    assert.equal(archive.readUInt32LE(offset), 0x02014b50);
    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const localOffset = archive.readUInt32LE(offset + 42);
    const name = archive.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");

    assert.equal(archive.readUInt32LE(localOffset), 0x04034b50);
    const localNameLength = archive.readUInt16LE(localOffset + 26);
    const localExtraLength = archive.readUInt16LE(localOffset + 28);
    const size = archive.readUInt32LE(localOffset + 18);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const data = archive.subarray(dataStart, dataStart + size);

    entries.push({ name, data });
    offset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}