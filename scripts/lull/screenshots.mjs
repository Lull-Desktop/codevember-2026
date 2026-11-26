#!/usr/bin/env node
/**
 * Captures the 16:9 preview screenshots used by the extension catalog.
 *
 *   npm run lull:previews -- --all
 *   npm run lull:previews -- --only 01-fold,06-orrery
 *   npm run lull:previews -- --all --pack
 *
 * Each built package is served from dist-lull/<id>/ and rendered in headless
 * Chrome at 1600x900. Two frames are sampled and the frame with more visual
 * detail is encoded as WebP (the chrome DevTools screenshot API only emits PNG
 * or JPEG, so the WebP encoding happens on a scratch canvas in the browser).
 *
 * The result is written to:
 *   - <project>/preview.webp       source-of-truth, copied into future builds
 *   - dist-lull/<id>/preview.webp  the extension package
 *   - dist-lull/previews.json      capture report
 *
 * Chrome and puppeteer-core are resolved from the local machine; no browser is
 * downloaded. Set CHROME_PATH / PUPPETEER_CORE to override the discovery.
 */

import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import {
  discoverScenes,
  loadGlobalConfig,
  loadScene,
  repoRoot,
} from "../../tools/lull/build/config.mjs";
import { walkRelativeFiles } from "../../tools/lull/build/assets.mjs";
import { writeZip } from "../../tools/lull/build/zip.mjs";

const WIDTH = 1600;
const HEIGHT = 900;
const MAX_PREVIEW_BYTES = 3 * 1024 * 1024;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".bin": "application/octet-stream",
  ".hdr": "application/octet-stream",
  ".exr": "application/octet-stream",
  ".ktx2": "image/ktx2",
  ".wasm": "application/wasm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".xml": "application/xml",
};

const args = process.argv.slice(2);

function flag(name) {
  return args.includes(`--${name}`);
}

function option(name, fallback = undefined) {
  const index = args.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`--${name} 需要一个参数`);
  return value;
}

function listOption(name) {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== `--${name}`) continue;
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`--${name} 需要一个参数`);
    values.push(...value.split(",").map((item) => item.trim()).filter(Boolean));
  }
  return values;
}

const globalConfig = loadGlobalConfig();
const outRoot = resolve(repoRoot, option("out", globalConfig.outDir ?? "dist-lull"));
const only = listOption("only");
const delayMs = Number(option("delay", "6000"));
const gapMs = Number(option("gap", "4000"));
const shots = Math.max(1, Number(option("shots", "2")));
const quality = Math.min(100, Math.max(50, Number(option("quality", "90"))));
const writeSource = !flag("no-source");
const pack = flag("pack");
const sdkIndex = join(repoRoot, "tools", "lull", "scene-sdk", "dist", "index.js");

if (!existsSync(sdkIndex)) {
  console.error("[preview] 缺少 scene-sdk，先执行 npm run lull:sync-sdk");
  process.exit(1);
}
if (!existsSync(outRoot)) {
  console.error(`[preview] 缺少 ${relative(repoRoot, outRoot)}；先执行 npm run lull:build -- --all`);
  process.exit(1);
}

let candidates = discoverScenes(globalConfig);
if (only.length > 0) {
  candidates = candidates.filter((item) => {
    const { scene } = loadScene(item.projectDir, globalConfig);
    return only.some(
      (value) =>
        value === item.folder ||
        value === scene.id ||
        value === scene.slug ||
        item.folder.includes(value) ||
        scene.id.includes(value),
    );
  });
}
if (candidates.length === 0) {
  console.error("[preview] 没有匹配的场景");
  process.exit(1);
}

const chromePath = findChrome();
const puppeteerPath = findPuppeteer();
console.log(`[preview] chrome: ${chromePath}`);
console.log(`[preview] puppeteer: ${relative(repoRoot, puppeteerPath)}`);

const puppeteer = (await import(pathToFileURL(puppeteerPath).href)).default;

const server = await startStaticServer(outRoot);
const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: "new",
  defaultViewport: { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 },
  args: [
    "--enable-unsafe-webgpu",
    "--ignore-gpu-blocklist",
    "--disable-gpu-sandbox",
    "--no-sandbox",
    "--hide-scrollbars",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
  ],
  protocolTimeout: 180_000,
});

const converter = await browser.newPage();
await converter.setContent("<!doctype html><meta charset=utf-8><title>preview encoder</title>");

const report = {
  schemaVersion: 1,
  capturedAt: new Date().toISOString(),
  width: WIDTH,
  height: HEIGHT,
  quality,
  previews: [],
};

let failures = 0;

try {
  for (const candidate of candidates) {
    const { folder, projectDir } = candidate;
    const { scene } = loadScene(projectDir, globalConfig);
    const pkgDir = join(outRoot, scene.id);
    const entry = join(pkgDir, "scenes", scene.slug, "index.html");
    const started = Date.now();

    if (!existsSync(entry)) {
      failures += 1;
      console.error(`[preview] ${folder}: 缺少构建产物 ${relative(repoRoot, entry)}`);
      report.previews.push({ folder, id: scene.id, status: "missing-package" });
      continue;
    }

    const page = await browser.newPage();
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(String(error)));
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      const text = message.text();
      if (!text.includes("Failed to load resource")) pageErrors.push(text);
    });

    try {
      const url = `http://127.0.0.1:${server.port}/${encodeURIComponent(scene.id)}/scenes/${encodeURIComponent(scene.slug)}/index.html?preview=1`;
      console.log(`\n[preview] ${folder} → ${scene.id}`);

      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.waitForFunction(() => document.querySelector("canvas") !== null, {
        timeout: 45_000,
        polling: 250,
      });

      const adapter = await page.evaluate(async () => {
        if (!navigator.gpu) return "no navigator.gpu";
        const gpu = await navigator.gpu.requestAdapter();
        return gpu ? "ok" : "no adapter";
      });
      if (adapter !== "ok") throw new Error(`WebGPU 不可用：${adapter}`);

      // Hide host/editor chrome before sampling. The generated scene CSS
      // already hides these, but the preview badge is added at runtime.
      await page.addStyleTag({
        content:
          "#lull-preview-badge,.lil-gui,#stats,.stats,.pages,.balls,.hud," +
          ".melt-picker,.labyrinth-stats,.labyrinth-hint,.tension-hint," +
          'body > div[style*="z-index:10000"],body > div[style*="z-index: 10000"]' +
          "{display:none!important}",
      });

      const frames = [];
      for (let index = 0; index < shots; index += 1) {
        const wait = index === 0 ? delayMs : gapMs;
        await sleep(wait);
        const png = await page.screenshot({
          type: "png",
          captureBeyondViewport: false,
        });
        const encoded = await encodeWebp(converter, png, quality, WIDTH, HEIGHT);
        frames.push({ png, ...encoded });
        console.log(
          `[preview]   frame ${index + 1}: detail ${encoded.stats.score.toFixed(1)} ` +
            `(${(encoded.webp.length / 1024).toFixed(0)} KiB)`,
        );
      }

      const best = frames.reduce((left, right) =>
        right.stats.score > left.stats.score ? right : left,
      );
      if (best.stats.std < 1 && best.stats.edge < 1) {
        console.warn("[preview]   画面几乎没有细节，仍写入预览图");
      }

      const output = best.webp;
      if (output.length > MAX_PREVIEW_BYTES) {
        throw new Error(
          `WebP ${(output.length / 1024 / 1024).toFixed(2)} MiB 超过 3 MiB 上限`,
        );
      }
      assertWebp(output);

      if (writeSource) {
        writeFileSync(join(projectDir, "preview.webp"), output);
      }
      writeFileSync(join(pkgDir, "preview.webp"), output);

      if (pack) {
        const artifacts = join(outRoot, "artifacts");
        mkdirSync(artifacts, { recursive: true });
        const zipPath = join(artifacts, `${scene.id}-${scene.version}.zip`);
        const files = walkRelativeFiles(pkgDir).sort();
        writeZip(
          zipPath,
          files.map((file) => ({
            name: file,
            data: readFileSync(join(pkgDir, ...file.split("/"))),
          })),
        );
      }

      report.previews.push({
        folder,
        id: scene.id,
        version: scene.version,
        status: "ok",
        bytes: output.length,
        detail: Number(best.stats.score.toFixed(2)),
        source: writeSource ? relative(repoRoot, join(projectDir, "preview.webp")) : null,
        package: relative(repoRoot, join(pkgDir, "preview.webp")),
        ms: Date.now() - started,
        pageErrors,
      });
      console.log(
        `[preview] ${scene.id}: ok, ${(output.length / 1024).toFixed(1)} KiB, ` +
          `${Date.now() - started} ms`,
      );
    } catch (error) {
      failures += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[preview] ${folder} 失败：${message}`);
      report.previews.push({
        folder,
        id: scene.id,
        status: "failed",
        error: message,
        pageErrors,
        ms: Date.now() - started,
      });
    } finally {
      await page.close().catch(() => {});
    }
  }
} finally {
  await browser.close().catch(() => {});
  await new Promise((resolve) => server.instance.close(resolve));
}

writeFileSync(
  join(outRoot, "previews.json"),
  `${JSON.stringify(report, null, 2)}\n`,
);

const ok = report.previews.filter((item) => item.status === "ok").length;
console.log(`\n[preview] 完成：${ok}/${report.previews.length} 张，报告 ${relative(repoRoot, join(outRoot, "previews.json"))}`);
if (failures > 0) process.exitCode = 1;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error("找不到 Chrome/Edge；设置 CHROME_PATH 环境变量指向浏览器可执行文件");
  }
  return found;
}

function findPuppeteer() {
  const candidates = [process.env.PUPPETEER_CORE];
  const relativeEntry = join("node_modules", "puppeteer-core", "lib", "puppeteer", "puppeteer-core.js");
  candidates.push(join(repoRoot, relativeEntry));
  for (const entry of readdirSync(repoRoot, { withFileTypes: true })) {
    if (entry.isDirectory() && /^\d+-/.test(entry.name)) {
      candidates.push(join(repoRoot, entry.name, relativeEntry));
    }
  }
  const found = candidates.filter(Boolean).find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(
      "找不到 puppeteer-core；在任一子项目 npm ci 或设置 PUPPETEER_CORE 指向 puppeteer-core.js",
    );
  }
  return found;
}

async function startStaticServer(rootDir) {
  const root = resolve(rootDir);
  const instance = createServer((request, response) => {
    try {
      if (request.method !== "GET" && request.method !== "HEAD") {
        response.writeHead(405).end();
        return;
      }
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      let pathname;
      try {
        pathname = decodeURIComponent(url.pathname);
      } catch {
        response.writeHead(400).end();
        return;
      }
      let file = normalize(join(root, pathname));
      if (file !== root && !file.startsWith(`${root}${sep}`)) {
        response.writeHead(403).end();
        return;
      }
      if (!existsSync(file)) {
        response.writeHead(404).end("not found");
        return;
      }
      if (statSync(file).isDirectory()) file = join(file, "index.html");
      if (!existsSync(file) || !statSync(file).isFile()) {
        response.writeHead(404).end("not found");
        return;
      }
      const type = MIME[extname(file).toLowerCase()] ?? "application/octet-stream";
      response.writeHead(200, {
        "content-type": type,
        "content-length": statSync(file).size,
        "cache-control": "no-store",
      });
      if (request.method === "HEAD") {
        response.end();
        return;
      }
      createReadStream(file).pipe(response);
    } catch (error) {
      response.writeHead(500).end(String(error));
    }
  });

  await new Promise((resolve, reject) => {
    instance.once("error", reject);
    instance.listen(0, "127.0.0.1", resolve);
  });
  const address = instance.address();
  return { instance, port: typeof address === "object" && address ? address.port : 0 };
}

async function encodeWebp(page, png, qualityPercent, width, height) {
  const data = await page.evaluate(
    async ({ pngBase64, quality, width, height }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${pngBase64}`;
      await image.decode();

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.drawImage(image, 0, 0, width, height);

      const sample = document.createElement("canvas");
      sample.width = 160;
      sample.height = 90;
      const sampleContext = sample.getContext("2d", { willReadFrequently: true });
      sampleContext.drawImage(image, 0, 0, sample.width, sample.height);
      const pixels = sampleContext.getImageData(0, 0, sample.width, sample.height).data;

      const luminance = new Float32Array(sample.width * sample.height);
      let sum = 0;
      let sumSquares = 0;
      let color = 0;
      for (let index = 0, pixel = 0; index < pixels.length; index += 4, pixel += 1) {
        const r = pixels[index];
        const g = pixels[index + 1];
        const b = pixels[index + 2];
        const value = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        luminance[pixel] = value;
        sum += value;
        sumSquares += value * value;
        color += Math.max(r, g, b) - Math.min(r, g, b);
      }
      let edge = 0;
      for (let y = 1; y < sample.height; y += 1) {
        for (let x = 1; x < sample.width; x += 1) {
          const index = y * sample.width + x;
          edge += Math.abs(luminance[index] - luminance[index - 1]);
          edge += Math.abs(luminance[index] - luminance[index - sample.width]);
        }
      }
      const count = sample.width * sample.height;
      const mean = sum / count;
      const std = Math.sqrt(Math.max(0, sumSquares / count - mean * mean));
      const edgeMean = edge / count;
      const colorMean = color / count;
      return {
        webp: canvas.toDataURL("image/webp", quality),
        stats: {
          mean,
          std,
          edge: edgeMean,
          color: colorMean,
          score: std + edgeMean * 2 + colorMean * 0.5,
        },
      };
    },
    { pngBase64: png.toString("base64"), quality: qualityPercent / 100, width, height },
  );

  if (!data.webp.startsWith("data:image/webp")) {
    throw new Error("浏览器没有返回 WebP 数据");
  }
  return {
    webp: Buffer.from(data.webp.slice(data.webp.indexOf(",") + 1), "base64"),
    stats: data.stats,
  };
}

function assertWebp(buffer) {
  if (buffer.length < 16) throw new Error("WebP 文件过小");
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WEBP") {
    throw new Error("不是合法的 WebP 文件");
  }
}