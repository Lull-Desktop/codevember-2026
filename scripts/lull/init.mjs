#!/usr/bin/env node
/**
 * Adds a Lull sidecar to a codevember project:
 *
 *   npm run lull:init -- 19-foo
 *   npm run lull:init -- 19-foo --id codevember.foo --name "Foo"
 *
 * It never touches src/, index.html, vite.config.ts, package.json or the
 * project's default tsconfig. The generated files are all under lull/.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, join, relative, resolve } from "node:path";

import {
  loadGlobalConfig,
  repoRoot,
  scenePath,
} from "../../tools/lull/build/config.mjs";

const args = process.argv.slice(2);
const folderArg = args.find((arg) => !arg.startsWith("--"));
if (!folderArg) {
  console.error("用法：npm run lull:init -- <NN-name> [--id ...] [--name ...] [--force]");
  process.exit(1);
}

function option(name, fallback = undefined) {
  const index = args.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`--${name} 需要一个参数`);
  return value;
}

const force = args.includes("--force");
const projectDir = resolve(repoRoot, folderArg);
if (!existsSync(projectDir)) {
  console.error(`目录不存在：${projectDir}`);
  process.exit(1);
}
if (!/^\d+-/.test(basename(projectDir))) {
  console.error("目录名必须以 NN- 开头，例如 19-foo");
  process.exit(1);
}

const sceneFile = scenePath(projectDir);
if (existsSync(sceneFile) && !force) {
  console.error(`${relative(repoRoot, sceneFile)} 已存在；加 --force 覆盖`);
  process.exit(1);
}

const htmlPath = join(projectDir, "index.html");
if (!existsSync(htmlPath)) {
  console.error(`缺少 ${relative(repoRoot, htmlPath)}`);
  process.exit(1);
}

const html = readFileSync(htmlPath, "utf8");
const moduleMatch = html.match(
  /<script[^>]*type=["']module["'][^>]*src=["']([^"']+)["']/i,
);
if (!moduleMatch) {
  console.error("index.html 里找不到 <script type=\"module\" src=\"...\">");
  process.exit(1);
}
const modulePath = moduleMatch[1].replace(/^\.\//, "");
if (!existsSync(join(projectDir, modulePath))) {
  console.error(`找不到主入口：${modulePath}`);
  process.exit(1);
}

const slug =
  option("slug") ?? basename(projectDir).replace(/^\d+-/, "");
const name =
  option("name") ??
  slug
    .split(/[-_]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
const id = option("id") ?? `codevember.${slug}`;
const version = option("version") ?? "1.0.0";
const globalConfig = loadGlobalConfig();
const defaults = globalConfig.defaults ?? {};

const background = html.match(
  /body\s*\{[^}]*?background(?:-color)?\s*:\s*(#[0-9a-f]{6})/i,
)?.[1] ?? "#111111";

const scene = {
  schemaVersion: 1,
  enabled: true,
  id,
  slug,
  name,
  version,
  description: `${name} — Codevember 2026 experiment.`,
  author: defaults.author ?? "Yuri Artiukh",
  license: defaults.license ?? "CC-BY-4.0",
  source: { html: "index.html", module: modulePath },
  entry: "lull/entry.ts",
  theme: { background },
  capabilities: defaults.capabilities ?? [
    "wallpaper.viewport",
    "wallpaper.params",
    "wallpaper.script",
  ],
  performance: defaults.performance ?? { tier: "medium", targetFps: 60 },
  compatibility: defaults.compatibility ?? {
    hostApi: 1,
    platforms: ["windows"],
  },
  requires: ["webgpu"],
  assets: [],
  hide: [".lil-gui", "#stats", ".pages", ".balls", ".hud"],
  assetsLicense: "review",
  params: [],
};

const lullDir = join(projectDir, "lull");
mkdirSync(lullDir, { recursive: true });
writeFileSync(sceneFile, `${JSON.stringify(scene, null, 2)}\n`);

writeFileSync(
  join(lullDir, "prelude.ts"),
  `import GUI from "three/examples/jsm/libs/lil-gui.module.min.js";
import { prepareScene } from "../../tools/lull/runtime/boot";
import type {
  GuiConstructor,
  SceneConfig,
} from "../../tools/lull/runtime/types";
import config from "./scene.json";

export const probe = prepareScene(
  GUI as unknown as GuiConstructor,
  config as unknown as SceneConfig,
);

export { GUI, config };
`,
);

writeFileSync(
  join(lullDir, "entry.ts"),
  `import { probe, GUI, config } from "./prelude";
import "../${modulePath}";
import { bootPreparedScene } from "../../tools/lull/runtime/boot";
import type {
  GuiConstructor,
  SceneConfig,
} from "../../tools/lull/runtime/types";

void bootPreparedScene({
  config: config as unknown as SceneConfig,
  probe,
  GUI: GUI as unknown as GuiConstructor,
});
`,
);

writeFileSync(join(lullDir, "tsconfig.json"), tsconfigTemplate(projectDir));

console.log(`已生成：
  ${relative(repoRoot, sceneFile)}
  ${relative(repoRoot, join(lullDir, "prelude.ts"))}
  ${relative(repoRoot, join(lullDir, "entry.ts"))}
  ${relative(repoRoot, join(lullDir, "tsconfig.json"))}

下一步：
  1. 在 scene.json 的 params 里加 3–5 个参数，binding 填 GUI 显示名或属性名；
  2. 在 assets 里声明 public/ 下需要的文件；
  3. npm run lull:preview -- ${basename(projectDir)}
  4. npm run lull:build -- --only ${basename(projectDir)} --pack
`);

function tsconfigTemplate(project) {
  const hasProjectTsconfig = existsSync(join(project, "tsconfig.json"));
  return `${JSON.stringify(
    {
      ...(hasProjectTsconfig ? { extends: "../tsconfig.json" } : {}),
      compilerOptions: {
        ...(hasProjectTsconfig
          ? {}
          : {
              target: "ESNext",
              module: "ESNext",
              moduleResolution: "Bundler",
              strict: true,
              noEmit: true,
              skipLibCheck: true,
              lib: ["ESNext", "DOM", "DOM.Iterable"],
            }),
        allowImportingTsExtensions: true,
        resolveJsonModule: true,
        types: ["vite/client"],
        baseUrl: ".",
        paths: {
          "@lull/scene-sdk": ["../../tools/lull/scene-sdk/dist/index.d.ts"],
        },
      },
      include: ["./**/*.ts", "../../tools/lull/runtime/**/*.ts"],
    },
    null,
    2,
  )}\n`;
}