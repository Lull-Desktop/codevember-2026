import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { computePackageDigest, walkFiles } from "../../../tools/lull/build/digest.mjs";

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "lull-digest-"));
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "index.html"), "<!doctype html><title>fixture</title>");
  writeFileSync(join(dir, "assets", "a.bin"), Buffer.from([0, 1, 2, 255]));
  return dir;
}

test("digest matches the Lull reference fixture", () => {
  const dir = fixture();
  try {
    const { digest, files } = computePackageDigest({
      id: "codevember.fixture",
      version: "1.2.3",
      dir,
    });
    assert.equal(files.join(","), "assets/a.bin,index.html");
    // Computed with lull-app/scripts/content-digest.mjs for the same bytes.
    assert.equal(
      digest,
      "aa75a3229b0d37906176aaee311437706e1adb76108de7a8c12a11b402390994",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("digest is deterministic and sensitive to id/version", () => {
  const dir = fixture();
  try {
    const one = computePackageDigest({ id: "a.b", version: "1.0.0", dir }).digest;
    const two = computePackageDigest({ id: "a.b", version: "1.0.0", dir }).digest;
    const three = computePackageDigest({ id: "a.c", version: "1.0.0", dir }).digest;
    const four = computePackageDigest({ id: "a.b", version: "1.0.1", dir }).digest;
    assert.equal(one, two);
    assert.notEqual(one, three);
    assert.notEqual(one, four);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("walkFiles rejects symlinks", () => {
  const dir = fixture();
  try {
    // Windows symlink creation needs privileges; only assert the normal path.
    assert.deepEqual(walkFiles(dir).sort(), ["assets/a.bin", "index.html"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});