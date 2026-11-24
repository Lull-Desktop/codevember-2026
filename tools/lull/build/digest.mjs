// Lull content package digest.
//
// sha256("lull-content-package\0" + id + "\0" + version + "\0" +
//        Σ(relPath + "\0" + size + "\0" + bytes + "\0"))
//
// Paths are relative to the entry directory (scenes/<slug>), use forward
// slashes, and are sorted by UTF-8 bytes.

import { createHash } from "node:crypto";
import {
  lstatSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { join, relative, sep } from "node:path";

export function walkFiles(dir, base = dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const absolute = join(dir, entry.name);
    const stat = lstatSync(absolute);

    if (stat.isSymbolicLink()) {
      throw new Error(`内容包不允许符号链接：${absolute}`);
    }
    if (stat.isDirectory()) {
      walkFiles(absolute, base, out);
    } else if (stat.isFile()) {
      out.push(relative(base, absolute).split(sep).join("/"));
    }
  }
  return out;
}

export function computePackageDigest({ id, version, dir }) {
  if (typeof id !== "string" || id === "") throw new Error("digest: id 必填");
  if (typeof version !== "string" || version === "") {
    throw new Error("digest: version 必填");
  }

  const files = walkFiles(dir);
  if (files.length === 0) throw new Error(`digest: 目录为空：${dir}`);

  files.sort((left, right) =>
    Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8")),
  );

  const hash = createHash("sha256");
  hash.update("lull-content-package\0", "utf8");
  for (const part of [id, version]) {
    hash.update(part, "utf8");
    hash.update("\0");
  }

  for (const relPath of files) {
    const absolute = join(dir, ...relPath.split("/"));
    const bytes = readFileSync(absolute);
    hash.update(relPath, "utf8");
    hash.update("\0");
    hash.update(String(bytes.length), "utf8");
    hash.update("\0");
    hash.update(bytes);
    hash.update("\0");
  }

  return {
    digest: hash.digest("hex"),
    files,
    bytes: files.reduce((sum, rel) => sum + statSync(join(dir, rel)).size, 0),
  };
}