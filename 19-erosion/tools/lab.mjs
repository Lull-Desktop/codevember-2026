// node tools/lab.mjs <out.png> [id|all] [seconds...]: the wall of models (lab.html), or one of them at several
// moments side by side. SPEED=4 runs the models faster; SEED; SIZE of one model's picture; URL.
import { chromium } from "playwright-core";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const [out = "lab.png", id = "all", ...times] = process.argv.slice(2);
if (!times.length) times.push("6");
const base = os.homedir() + "/Library/Caches/ms-playwright/chromium-1243/";
const sub = fs.readdirSync(base).find((d) => d.startsWith("chrome-"));
const app = fs.readdirSync(base + sub).find((d) => d.endsWith(".app"));
const browser = await chromium.launch({
  executablePath: `${base}${sub}/${app}/Contents/MacOS/${app.replace(".app", "")}`,
  headless: true,
});
const one = id !== "all";
const size = +(process.env.SIZE ?? 700);
const page = await browser.newPage({
  viewport: one ? { width: size, height: size } : { width: 1500, height: 1800 },
});
const bad = [];
page.on("pageerror", (e) => bad.push(e.message.slice(0, 800)));
page.on("console", (m) => {
  if (m.text().startsWith("hoodoos:")) console.log(m.text());
  if (["error", "warning"].includes(m.type()) && !m.text().includes("404")) bad.push(m.text().slice(0, 800));
});
const q = new URLSearchParams({ speed: process.env.SPEED ?? "1", seed: process.env.SEED ?? "1" });
if (one) q.set("only", id);
await page.goto(`${process.env.URL ?? "http://localhost:5319/lab.html"}?${q}`);
await page.waitForFunction(() => window.__lab && window.__lab.frame > 1, null, { timeout: 20000 }).catch(() => bad.push("never started"));
if (one) await page.addStyleTag({ content: "#grid{padding:0!important}.tile h2,.tile p{display:none}" });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lab-"));
const files = [];
const t0 = Date.now();
for (const [i, t] of times.entries()) {
  await page.waitForTimeout(Math.max(0, +t * 1000 - (Date.now() - t0)));
  const file = path.join(tmp, `s${String(i).padStart(2, "0")}.png`);
  fs.writeFileSync(file, await page.screenshot({ fullPage: !one }));
  files.push(file);
}
const info = await page.evaluate(() => window.__lab.tiles.map((t) => `${t.def.id}:${t.steps}`).join(" "));
if (files.length === 1) fs.copyFileSync(files[0], out);
else execFileSync("montage", [...files, "-tile", `${process.env.COLS ?? files.length}x`, "-geometry", "+2+2", "-background", "#222", out]);
console.log(info, bad.length ? `\n${bad.length} problems:\n${[...new Set(bad)].join("\n")}` : "clean");
await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 2500))]);
process.exit(0);
