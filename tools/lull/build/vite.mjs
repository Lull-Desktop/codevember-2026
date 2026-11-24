// Builds a scene with the project's own Vite installation, but with an inline
// config that is completely separate from the project's vite.config.ts.
//
// This keeps ssamExport / ssamFfmpeg / ssamGit and other dev-only plugins out
// of the content package, and means a project's existing build is untouched.

import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { repoRoot } from "./config.mjs";

export async function loadProjectVite(projectDir) {
  const require = createRequire(join(projectDir, "package.json"));
  let viteEntry;
  try {
    viteEntry = require.resolve("vite");
  } catch {
    throw new Error(
      `${projectDir} 没有安装 vite。先在项目目录执行 npm ci，或给 lull:build 加 --install。`,
    );
  }
  const vite = await import(pathToFileURL(viteEntry).href);
  return vite;
}

// Vite's `define` does not reliably replace a bare global in dev, and a
// replacement in dependencies could corrupt them. This pre-transform only
// touches the project's own src/ files and keeps the built output free of the
// `localStorage` literal.
function storageShimPlugin(projectDir) {
  const sourceRoot = join(projectDir, "src").replaceAll("\\", "/");
  return {
    name: "lull-storage-shim",
    enforce: "pre",
    transform(code, id) {
      const normalized = id.replaceAll("\\", "/");
      if (!normalized.startsWith(sourceRoot)) return null;
      if (!code.includes("localStorage")) return null;
      return {
        code: code.replace(/\blocalStorage\b/g, "globalThis.__LULL_STORAGE__"),
        map: null,
      };
    },
  };
}

async function loadGlslPlugin(projectDir) {
  const require = createRequire(join(projectDir, "package.json"));
  let entry;
  try {
    entry = require.resolve("vite-plugin-glsl");
  } catch {
    return null;
  }
  const mod = await import(pathToFileURL(entry).href);
  const factory = mod.default ?? mod;
  return typeof factory === "function"
    ? factory({ warnDuplicatedImports: false })
    : null;
}

export function sceneBuildConfig(projectDir, { sdkIndex, plugins = [] } = {}) {
  return {
    root: projectDir,
    configFile: false,
    base: "./",
    publicDir: false,
    clearScreen: false,
    logLevel: "warn",
    resolve: {
      alias: [
        {
          find: /^@lull\/scene-sdk$/,
          replacement: sdkIndex,
        },
      ],
    },
    define: {
      // The storage replacement is done by storageShimPlugin below. Do NOT put
      // `localStorage` in `define`: Vite's dev client applies define keys to
      // globalThis and fails on the getter-only localStorage property.
      "import.meta.env.LULL_SCENE": '"1"',
    },
    build: {
      target: "es2022",
      outDir: join(projectDir, ".lull-build"),
      emptyOutDir: true,
      copyPublicDir: false,
      assetsDir: "assets",
      assetsInlineLimit: 4096,
      cssCodeSplit: false,
      minify: "esbuild",
      sourcemap: false,
      rollupOptions: {
        input: join(projectDir, "lull", "entry.ts"),
        output: {
          format: "es",
          entryFileNames: "scene.js",
          assetFileNames: "assets/[name]-[hash][extname]",
          chunkFileNames: "assets/[name]-[hash].js",
          inlineDynamicImports: true,
        },
      },
    },
    worker: {
      format: "es",
      rollupOptions: {
        output: {
          entryFileNames: "assets/[name]-[hash].js",
          chunkFileNames: "assets/[name]-[hash].js",
          assetFileNames: "assets/[name]-[hash][extname]",
        },
      },
    },
    plugins,
  };
}

export async function buildScene(projectDir, { sdkIndex } = {}) {
  const vite = await loadProjectVite(projectDir);
  const glsl = await loadGlslPlugin(projectDir);
  const plugins = [storageShimPlugin(projectDir), ...(glsl ? [glsl] : [])];
  const config = sceneBuildConfig(projectDir, { sdkIndex, plugins });
  await vite.build(config);
  return join(projectDir, ".lull-build");
}

export async function createPreviewServer(projectDir, { sdkIndex, port = 0 } = {}) {
  const vite = await loadProjectVite(projectDir);
  const glsl = await loadGlslPlugin(projectDir);
  const plugins = [storageShimPlugin(projectDir), ...(glsl ? [glsl] : [])];
  const config = sceneBuildConfig(projectDir, { sdkIndex, plugins });

  const server = await vite.createServer({
    ...config,
    build: undefined,
    base: "/",
    publicDir: join(projectDir, "public"),
    server: {
      port,
      strictPort: false,
      host: "127.0.0.1",
      fs: { allow: [projectDir, repoRoot] },
      open: false,
    },
    logLevel: "info",
  });
  await server.listen();
  return server;
}

export function sdkIndexPath() {
  const path = resolve(repoRoot, "tools", "lull", "scene-sdk", "dist", "index.js");
  if (!existsSync(path)) {
    throw new Error(`缺少 ${path}；先执行 npm run lull:sync-sdk`);
  }
  return path;
}