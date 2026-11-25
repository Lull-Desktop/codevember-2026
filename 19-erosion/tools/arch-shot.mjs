// node tools/shot.mjs <out.png> [WxH] [moments 0..1 of the loop...]: renders the page headless with real WebGPU and tiles the shots.
// SET='{"sun":3}' changes look values; CAM="x,y,z" moves the eye; EVAL runs js once at the start; DPR; COLS; URL.
import { chromium } from "playwright-core";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const [out = "shot.png", size = "900x1100", ...shots] = process.argv.slice(2);
if (!shots.length) shots.push("-1");
const url = process.env.URL ?? "http://localhost:5319/arch.html";
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
  if (t.startsWith("arch:")) console.log(t);
  if (["error", "warning"].includes(m.type()) && !t.includes("404"))
    bad.push(t.replace(/[ \t]+/g, " ").slice(0, 1500));
});
await page.goto(url);
await page
  .waitForFunction(() => window.__arch && window.__arch.state.frame > 2, null, {
    timeout: +(process.env.WAIT ?? 30000),
  })
  .catch(() => {
    console.log("never started:\n" + [...new Set(bad)].join("\n"));
    process.exit(1);
  });
await page.addStyleTag({
  content: ".lil-gui,#stats{display:none!important}",
});
await page.evaluate(
  ([s, cam]) => {
    const r = window.__arch;
    if (s) Object.assign(r.look, JSON.parse(s));
    if (cam) {
      const c = cam.split(",").map(Number);
      r.camera.position.set(c[0], c[1], c[2]);
      if (c.length > 3) r.controls.target.set(c[3], c[4], c[5]);
      r.controls.update();
    }
  },
  [process.env.SET, process.env.CAM],
);
if (process.env.EVAL)
  console.log(JSON.stringify(await page.evaluate(process.env.EVAL)));
console.log(JSON.stringify(await page.evaluate(() => ({}))));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "erosion-"));
const files = [];
let ms = 0;
for (const [i, at] of shots.entries()) {
  // the wear is run up to the moment asked for, then a few frames pass so the counts are read back
  const told = await page.evaluate(
    ([at, lead]) =>
      new Promise((done) => {
        const r = window.__arch;
        const tick = 1 / (r.LOOP * 60);
        // up to a little before the moment as fast as it goes, then frame by frame, so there is sand in the air
        let u = Math.max(0, +at - lead * tick);
        r.state.hold = u;
        let after = -2;
        const f = () => {
          if (r.state.step !== r.state.due || after < 0) after = Math.min(after + 1, 0);
          else if (u < +at - tick * 0.5) r.state.hold = u = Math.min(+at, u + tick);
          else if (++after > 8) return done({ ...r.state });
          requestAnimationFrame(f);
        };
        requestAnimationFrame(f);
      }),
    [at, +(process.env.LEAD ?? 150)],
  );
  ms = told.ms.frame;
  console.log(
    `${at}: step ${told.step}, ${(told.corners / 3e3).toFixed(0)}k triangles (${(told.smooth / 3e3).toFixed(0)}k smooth), sand ${told.sand}, ms ${Object.entries(
      told.ms,
    )
      .map(([k, v]) => `${k} ${v.toFixed(2)}`)
      .join(", ")}`,
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
