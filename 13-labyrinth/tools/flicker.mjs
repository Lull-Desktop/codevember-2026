// node tools/flicker.mjs [frames] [from playhead] : consecutive frames at 60 a second, and how much each differs from the
// one before. Steady motion gives a steady number; a frame that flickers stands out as a spike. KEEP=dir saves the frames.
import { chromium } from "playwright-core";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const [count = "48", start = "0.3"] = process.argv.slice(2);
const url = process.env.URL ?? "http://localhost:5313/";
const base = os.homedir() + "/Library/Caches/ms-playwright/chromium-1243/";
const sub = fs.readdirSync(base).find((d) => d.startsWith("chrome-"));
const app = fs.readdirSync(base + sub).find((d) => d.endsWith(".app"));
const browser = await chromium.launch({ executablePath: `${base}${sub}/${app}/Contents/MacOS/${app.replace(".app", "")}`, headless: true });
const page = await browser.newPage({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });
await page.goto(url);
await page.waitForFunction(() => window.__labyrinth && window.__labyrinth.state.frame > 2, null, { timeout: 60000 });
await page.addStyleTag({ content: ".lil-gui,canvas+div,body>div:not(:has(canvas)){display:none!important}" });
await page.evaluate((s) => {
  const r = window.__labyrinth;
  const set = { grain: 0, ...JSON.parse(s ?? "{}") };
  Object.assign(r.look, set);
  if (["walls", "flow", "pulse", "seed", "restless", "drama"].some((k) => k in set)) r.rebuild();
  r.refresh();
  r.frameUp();
}, process.env.SET);
const dir = process.env.KEEP ?? fs.mkdtempSync(path.join(os.tmpdir(), "flicker-"));
fs.mkdirSync(dir, { recursive: true });
const files = [];
for (let n = 0; n < +count; n++) {
  await page.evaluate((at) => new Promise((done) => {
    window.__labyrinth.state.hold = at;
    let k = 0;
    const f = () => (++k < 3 ? requestAnimationFrame(f) : done());
    requestAnimationFrame(f);
  }), +start + n / (40 * 60));
  const file = path.join(dir, `f${String(n).padStart(3, "0")}.png`);
  fs.writeFileSync(file, await page.screenshot());
  files.push(file);
}
const diffs = [];
for (let n = 1; n < files.length; n++) {
  let out = "";
  try { out = execFileSync("compare", ["-metric", "MAE", files[n - 1], files[n], "null:"], { stdio: ["ignore", "pipe", "pipe"] }).toString(); } catch (e) { out = String(e.stderr); }
  diffs.push(+(/\(([\d.e-]+)\)/.exec(out)?.[1] ?? NaN) * 1000);
}
const sorted = [...diffs].sort((a, b) => a - b);
const median = sorted[sorted.length >> 1];
console.log(diffs.map((d) => d.toFixed(1)).join(" "));
console.log(`median ${median.toFixed(2)}, largest ${sorted.at(-1).toFixed(2)} (x${(sorted.at(-1) / median).toFixed(1)}), frames over 1.5x median: ${diffs.filter((d) => d > 1.5 * median).length} of ${diffs.length}`);
await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 2500))]);
process.exit(0);
