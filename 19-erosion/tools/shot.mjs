// node tools/shot.mjs <out.png> [WxH] [ages...]: renders the page headless with real WebGPU and tiles the shots.
// SET='{"sun":3}' changes look values; CAM="x,y,z" moves the eye; EVAL runs js once at the start; DPR; COLS; URL.
import { chromium } from "playwright-core";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const [out = "shot.png", size = "900x1100", ...shots] = process.argv.slice(2);
if (!shots.length) shots.push("-1");
const url = process.env.URL ?? "http://localhost:5319/rock.html";
const base = os.homedir() + "/Library/Caches/ms-playwright/chromium-1243/";
const sub = fs.readdirSync(base).find((d) => d.startsWith("chrome-"));
const app = fs.readdirSync(base + sub).find((d) => d.endsWith(".app"));
const browser = await chromium.launch({
  executablePath: `${base}${sub}/${app}/Contents/MacOS/${app.replace(".app", "")}`,
  headless: true,
});
const [w, h] = size.split("x").map(Number);
const page = await browser.newPage({
  viewport: { width: w, height: h ?? w },
  deviceScaleFactor: +(process.env.DPR ?? 1),
});
const bad = [];
page.on("pageerror", (e) => bad.push(e.message.slice(0, 1500)));
page.on("console", (m) => {
  const t = m.text();
  if (t.startsWith("erosion:")) console.log(t);
  if (["error", "warning"].includes(m.type()) && !t.includes("404"))
    bad.push(t.replace(/[ \t]+/g, " ").slice(0, 1500));
});
await page.goto(url);
await page
  .waitForFunction(
    () => window.__erosion && window.__erosion.state.frame > 2,
    null,
    {
      timeout: +(process.env.WAIT ?? 30000),
    },
  )
  .catch(() => {
    console.log("never started:\n" + [...new Set(bad)].join("\n"));
    process.exit(1);
  });
await page.addStyleTag({
  content: ".lil-gui,#stats{display:none!important}",
});
await page.evaluate(
  ([s, cam]) => {
    const r = window.__erosion;
    if (s) Object.assign(r.look, JSON.parse(s));
    if (cam) {
      const c = cam.split(",").map(Number);
      r.camera.position.set(c[0], c[1], c[2]);
      if (c.length > 3) r.controls.target.set(c[3], c[4], c[5]);
      r.controls.update();
    }
    r.refresh();
  },
  [process.env.SET, process.env.CAM],
);
if (process.env.EVAL)
  console.log(JSON.stringify(await page.evaluate(process.env.EVAL)));
console.log(
  JSON.stringify(await page.evaluate(() => window.__erosion.state.rock)),
);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "erosion-"));
const files = [];
let ms = 0;
for (const [i, at] of shots.entries()) {
  // the time a frame takes while the still is gathering, then the finished still
  ms = await page.evaluate(
    (at) =>
      new Promise((done) => {
        const r = window.__erosion;
        r.state.hold = +at;
        r.state.still = 0;
        let t0 = 0;
        let f0 = 0;
        const f = () => {
          const s = r.state.still;
          if (s >= 4 && !t0) ((t0 = performance.now()), (f0 = s));
          if (s >= 48) done((performance.now() - t0) / (s - f0));
          else requestAnimationFrame(f);
        };
        requestAnimationFrame(f);
      }),
    at,
  );
  await page.waitForTimeout(150);
  const file = path.join(tmp, `s${String(i).padStart(2, "0")}.png`);
  fs.writeFileSync(file, await page.screenshot({ timeout: 60000 }));
  files.push(file);
}
if (files.length === 1) fs.copyFileSync(files[0], out);
else
  execFileSync("montage", [
    ...files,
    "-tile",
    `${process.env.COLS ?? Math.ceil(Math.sqrt(files.length))}x`,
    "-geometry",
    "+2+2",
    "-background",
    "#222",
    out,
  ]);
console.log(
  `${ms.toFixed(1)} ms a frame`,
  bad.length
    ? `${bad.length} problems:\n${[...new Set(bad)].join("\n")}`
    : "clean",
);
await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 2500))]);
process.exit(0);
