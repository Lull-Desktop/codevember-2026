// node tools/terrain-shot.mjs <out.png> [WxH] [seconds...]: renders terrain.html headless with real WebGPU, at
// those moments of the river's run (seconds at the page's own speed), and tiles the shots.
// SET='{"air":{"fog":1}}' changes look values (by group); CAM="x,y,z[,tx,ty,tz]" moves the eye; EVAL runs js
// once at the start; DPR; COLS; URL; FRAMES=n measures over n running frames at the end.
import { chromium } from "playwright-core";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const [out = "terrain.png", size = "900x900", ...shots] = process.argv.slice(2);
if (!shots.length) shots.push("0");
const url = process.env.URL ?? "http://localhost:5319/terrain.html";
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
  if (t.startsWith("terrain:")) console.log(t);
  if (["error", "warning"].includes(m.type()) && !t.includes("404")) bad.push(t.replace(/[ \t]+/g, " ").slice(0, 1500));
});
await page.goto(url);
await page
  .waitForFunction(() => window.__terrain && window.__terrain.state.frame > 2, null, { timeout: +(process.env.WAIT ?? 40000) })
  .catch(() => {
    console.log("never started:\n" + [...new Set(bad)].join("\n"));
    process.exit(1);
  });
await page.addStyleTag({ content: ".lil-gui,#stats{display:none!important}" });
await page.evaluate(
  ([s, cam]) => {
    const r = window.__terrain;
    r.state.hold = true;
    if (s) for (const [group, values] of Object.entries(JSON.parse(s))) Object.assign(r.look[group], values);
    if (cam) {
      const c = cam.split(",").map(Number);
      r.camera.position.set(c[0], c[1], c[2]);
      if (c.length > 3) r.controls.target.set(c[3], c[4], c[5]);
      r.controls.update();
    }
    if (s) r.refresh();
  },
  [process.env.SET, process.env.CAM],
);
if (process.env.EVAL) console.log(JSON.stringify(await page.evaluate(process.env.EVAL)));
const frames = (n) =>
  page.evaluate(
    (n) =>
      new Promise((done) => {
        const s = window.__terrain.state;
        const f0 = s.frame;
        const t0 = performance.now();
        const f = () => (s.frame >= f0 + n ? done((performance.now() - t0) / (s.frame - f0)) : requestAnimationFrame(f));
        requestAnimationFrame(f);
      }),
    n,
  );
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "terrain-"));
const files = [];
for (const [i, at] of shots.entries()) {
  // the river is run on to the moment asked for, and held there while the shot is taken
  await page.evaluate((at) => {
    const r = window.__terrain;
    const to = Math.round(+at * 60 * r.look.river.speed);
    if (to > r.state.steps) r.skip(to - r.state.steps);
  }, at);
  await frames(4);
  const file = path.join(tmp, `s${String(i).padStart(2, "0")}.png`);
  fs.writeFileSync(file, await page.screenshot({ timeout: 60000 }));
  files.push(file);
}
if (files.length === 1) fs.copyFileSync(files[0], out);
else
  execFileSync("montage", [...files, "-tile", `${process.env.COLS ?? Math.ceil(Math.sqrt(files.length))}x`, "-geometry", "+2+2", "-background", "#222", out]);
// how long a frame takes with the river running
await page.evaluate(() => (window.__terrain.state.hold = false));
const ms = await frames(+(process.env.FRAMES ?? 90));
const state = await page.evaluate(() => {
  const { state, field } = window.__terrain;
  return { ...state, points: field.river.x.length };
});
console.log(JSON.stringify(state, (k, v) => (typeof v === "number" ? +v.toFixed(2) : v)));
console.log(`${ms.toFixed(1)} ms a frame`, bad.length ? `${bad.length} problems:\n${[...new Set(bad)].join("\n")}` : "clean");
await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 2500))]);
process.exit(0);
