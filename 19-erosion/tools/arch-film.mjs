// node tools/arch-film.mjs <out.mp4> [WxH] [frames] [fps]: the whole loop, frame by frame, as a film. Tells the
// frames that differ from the one before much more than their neighbours do, which is how a jump shows.
// SET, EVAL, DPR, URL as in arch-shot.mjs; FROM and TO keep to a part of the loop.
import { chromium } from "playwright-core";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const [out = "arch.mp4", size = "960x600", frames = "1200", fps = "60"] =
  process.argv.slice(2);
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arch-film-"));
const total = +frames;
const from = Math.round(total * +(process.env.FROM ?? 0));
const to = Math.round(total * +(process.env.TO ?? 1));
const arrive = (u) =>
  page.evaluate(
    (u) =>
      new Promise((done) => {
        const r = window.__arch;
        r.state.hold = u;
        let n = 0;
        const f = () =>
          r.state.step === r.state.due && ++n > 2
            ? done()
            : requestAnimationFrame(f);
        requestAnimationFrame(f);
      }),
    u,
  );
for (let i = from; i < to; i++) {
  await arrive(i / total);
  fs.writeFileSync(
    path.join(tmp, `f${String(i - from).padStart(5, "0")}.jpg`),
    await page.screenshot({ type: "jpeg", quality: 95 }),
  );
}
await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 2500))]);
execFileSync("ffmpeg", [
  "-y",
  "-loglevel",
  "error",
  "-framerate",
  fps,
  "-i",
  path.join(tmp, "f%05d.jpg"),
  "-c:v",
  "libx264",
  "-crf",
  "16",
  "-pix_fmt",
  "yuv420p",
  out,
]);
// the change from each frame to the next, on a small grey copy
const [sw, sh] = [240, 150];
const raw = execFileSync(
  "ffmpeg",
  [
    "-loglevel",
    "error",
    "-i",
    out,
    "-vf",
    `scale=${sw}:${sh}:flags=area,format=gray`,
    "-f",
    "rawvideo",
    "-",
  ],
  { maxBuffer: 1 << 30 },
);
const n = raw.length / (sw * sh);
const diff = (a, b) => {
  let s = 0;
  for (let k = 0; k < sw * sh; k++)
    s += Math.abs(raw[a * sw * sh + k] - raw[b * sw * sh + k]);
  return s / (sw * sh);
};
const d = [];
for (let i = 0; i + 1 < n; i++) d.push(diff(i, i + 1));
const odd = [];
for (let i = 3; i + 3 < d.length; i++) {
  const around = (d[i - 3] + d[i - 2] + d[i + 2] + d[i + 3]) / 4;
  if (d[i] > 1.6 * around + 0.4)
    odd.push(
      `${i + from} (${((i + from) / total).toFixed(3)}): ${d[i].toFixed(2)} against ${around.toFixed(2)}`,
    );
}
console.log(
  `${n} frames; change a frame: mean ${(d.reduce((a, b) => a + b, 0) / d.length).toFixed(2)}, most ${Math.max(...d).toFixed(2)}`,
);
if (from === 0 && to === total)
  console.log(
    `last to first ${diff(n - 1, 0).toFixed(3)}; its neighbours ${d[0].toFixed(3)}, ${d[d.length - 1].toFixed(3)}`,
  );
console.log(odd.length ? `jumps:\n${odd.join("\n")}` : "no jumps");
console.log(bad.length ? [...new Set(bad)].join("\n") : "clean");
fs.rmSync(tmp, { recursive: true });
process.exit(0);
