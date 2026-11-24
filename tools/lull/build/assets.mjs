// Copies only the public/ files a scene declares, preserving their relative
// paths so runtime `fetch("./sdf/...")` calls keep working inside the package.

import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
} from "node:fs";
import { dirname, join, posix, relative, sep } from "node:path";

export function globToRegExp(pattern) {
  const normalized = String(pattern).replaceAll("\\", "/");
  let source = "^";

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    if (char === "*") {
      if (normalized[index + 1] === "*") {
        index += 1;
        if (normalized[index + 1] === "/") {
          index += 1;
          source += "(?:.*/)?";
        } else {
          source += ".*";
        }
      } else {
        source += "[^/]*";
      }
    } else if (char === "?") {
      source += "[^/]";
    } else if ("\\^$+?.()|{}[]".includes(char)) {
      source += `\\${char}`;
    } else {
      source += char;
    }
  }

  source += "$";
  return new RegExp(source);
}

export function walkRelativeFiles(dir, base = dir, out = []) {
  if (!existsSync(dir)) return out;

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const absolute = join(dir, entry.name);
    const stat = lstatSync(absolute);
    if (stat.isSymbolicLink()) {
      throw new Error(`public/ 不允许符号链接：${absolute}`);
    }
    if (stat.isDirectory()) {
      walkRelativeFiles(absolute, base, out);
    } else if (stat.isFile()) {
      out.push(relative(base, absolute).split(sep).join("/"));
    }
  }
  return out;
}

export function copyAssets(projectDir, patterns, destDir) {
  const publicDir = join(projectDir, "public");
  const files = walkRelativeFiles(publicDir);
  const matchers = patterns.map((pattern) => {
    const normalized = pattern.replaceAll("\\", "/").replace(/^public\//, "");
    return { pattern, regex: globToRegExp(normalized) };
  });

  const selected = new Map();
  for (const matcher of matchers) {
    const matches = files.filter((file) => matcher.regex.test(file));
    if (matches.length === 0) {
      throw new Error(`assets 模式没有匹配到任何文件：${matcher.pattern}`);
    }
    for (const file of matches) selected.set(posix.normalize(file), file);
  }

  let bytes = 0;
  for (const file of [...selected.values()].sort()) {
    const source = join(publicDir, ...file.split("/"));
    const target = join(destDir, ...file.split("/"));
    if (existsSync(target)) {
      throw new Error(`资产目标已存在，拒绝覆盖：${target}`);
    }
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(source, target);
    bytes += lstatSync(source).size;
  }

  return { files: [...selected.values()].sort(), bytes };
}

export function copyDirectory(sourceDir, destDir) {
  const files = walkRelativeFiles(sourceDir);
  for (const file of files) {
    const source = join(sourceDir, ...file.split("/"));
    const target = join(destDir, ...file.split("/"));
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(source, target);
  }
  return files;
}