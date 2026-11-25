// node tools/voxel-shot.mjs <out.png> [WxH] [steps...]: renders voxel.html headless with real WebGPU, once at each
// of the steps of wear asked for, and tiles the shots. A step given as "+0.5" means that part of a lap.
// SET='{"sun":3}' changes look values; CAM="x,y,z[,tx,ty,tz]" moves the eye; EVAL runs js once at the start;
// N is the grid size; DPR; COLS; URL; TIME=1 lets it play for a while at each stop to measure a frame.
import { chromium } from "playwright-core";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const [out = "voxel.png", size = "1280x720", ...stops] = process.argv.slice(2);
if (!stops.length) stops.push("0");
const q = process.env.N ? `?n=${process.env.N}` : "";
const url = process.env.URL ?? `http://localhost:5319/voxel.html${q}`;
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
  if (t.startsWith("voxel:")) console.log(t);
  if (["error", "warning"].includes(m.type()) && !t.includes("404"))
    bad.push(t.replace(/[ \t]+/g, " ").slice(0, 1500));
});
const stop = (code) => {
  if (bad.length)
    console.log(`${bad.length} problems:\n${[...new Set(bad)].join("\n")}`);
  process.exit(code);
};
await page.goto(url);
await page
  .waitForFunction(
    () => window.__voxel && window.__voxel.state.frame > 2,
    null,
    {
      timeout: +(process.env.WAIT ?? 30000),
    },
  )
  .catch(() => {
    console.log("never started");
    stop(1);
  });
await page.addStyleTag({ content: ".lil-gui,#stats{display:none!important}" });
await page.evaluate(
  ([s, cam]) => {
    const r = window.__voxel;
    r.look.play = false;
    if (s) Object.assign(r.look, JSON.parse(s));
    if (cam) {
      const c = cam.split(",").map(Number);
      r.camera.position.set(c[0], c[1], c[2]);
      if (c.length > 3) r.controls.target.set(c[3], c[4], c[5]);
      r.controls.update();
    }
    r.make();
  },
  [process.env.SET, process.env.CAM],
);
if (process.env.EVAL)
  console.log(JSON.stringify(await page.evaluate(process.env.EVAL)));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "voxel-"));
const files = [];
for (const [i, at] of stops.entries()) {
  // run the wear to the step asked for, then let a few frames pass so the counts are read back
  const told = await page.evaluate(
    ([at, time]) =>
      new Promise((done) => {
        const r = window.__voxel;
        const lap = Math.round(r.look.lap * 60);
        const goal = at.startsWith("+") ? Math.round(+at * lap) : +at;
        r.state.goto = goal;
        let after = 0;
        let there = false;
        const f = () => {
          if (!there && r.state.step === goal) {
            there = true;
            // with TIME the wear plays on from the stop, so the frames measured are whole ones
            if (time) ((r.state.goto = -1), (r.look.play = true));
          }
          if (there && ++after > (time ? 150 : 8)) {
            r.look.play = false;
            if (time) r.state.goto = r.state.step;
            done({ ...r.state });
          } else requestAnimationFrame(f);
        };
        requestAnimationFrame(f);
      }),
    [at, !!process.env.TIME],
  );
  const ms = Object.entries(told.ms)
    .map(([k, v]) => `${k} ${v.toFixed(2)}`)
    .join(", ");
  console.log(
    `step ${told.step}: ${(told.corners / 3e3).toFixed(0)}k triangles (room for ${(told.room / 3e3).toFixed(0)}k), sand ${told.sand}, grid ${told.cells.join("×")}, ms: ${ms}`,
  );
  await page.waitForTimeout(100);
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
console.log(bad.length ? "" : "clean");
await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 2500))]);
stop(0);
