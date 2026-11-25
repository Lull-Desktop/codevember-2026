// node tools/coast-time.mjs [WxH] [moments...]: what each pass of the page costs on the GPU, in ms. One frame is recorded at each
// moment of the loop (with two ticks of the water, as at 30 frames a second), the page is stopped, and each pass is run many times
// on end: timestamps of render passes are no use on Apple's GPUs, and a GPU that waits for the screen slows its clock.
// The page is not changed for it: WebGPU is wrapped from outside. DPR and SET as in coast-shot.mjs; JSON=1 prints only numbers.
// CUT='[["trace","find","put"],...]' changes shader text first, to see what a part costs; ONLY=trace.frag times that pass alone.
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
const [size = "1728x1000", ...moments] = process.argv.slice(2);
if (!moments.length) moments.push("0.2", "0.5", "0.75", "0.95");
const url = process.env.URL ?? "http://localhost:5319/";
const base = os.homedir() + "/Library/Caches/ms-playwright/chromium-1243/";
const sub = fs.readdirSync(base).find((d) => d.startsWith("chrome-"));
const app = fs.readdirSync(base + sub).find((d) => d.endsWith(".app"));
const browser = await chromium.launch({
  executablePath: `${base}${sub}/${app}/Contents/MacOS/${app.replace(".app", "")}`,
  headless: true,
});
const [w, h] = size.split("x").map(Number);
const page = await browser.newPage({
  viewport: { width: w, height: h },
  deviceScaleFactor: +(process.env.DPR ?? 1),
});
const bad = [];
page.on("pageerror", (e) => bad.push(e.message.slice(0, 600)));
page.on("console", (m) => {
  if (["error", "warning"].includes(m.type()) && !m.text().includes("404"))
    bad.push(m.text().slice(0, 600));
});
await page.addInitScript(
  (cuts) => {
    const T = (window.__time = {
      record: false,
      list: [],
      stop: false,
      js: [],
    });
    const names = new WeakMap();
    const ask = GPUAdapter.prototype.requestDevice;
    GPUAdapter.prototype.requestDevice = async function (d) {
      const device = await ask.call(this, d);
      T.device = device;
      const sm = device.createShaderModule.bind(device);
      device.createShaderModule = (d) => {
        let code = d.code;
        for (const [name, find, put] of cuts)
          if (name === d.label) {
            if (!code.includes(find)) console.error(`cut not found: ${find}`);
            code = code.replaceAll(find, put);
          }
        return sm({ ...d, code });
      };
      for (const kind of ["createComputePipeline", "createRenderPipeline"]) {
        const f = device[kind].bind(device);
        device[kind] = (d) => {
          const p = f(d);
          names.set(
            p,
            kind === "createComputePipeline"
              ? d.compute.entryPoint
              : `${d.fragment.module.label}.${d.fragment.entryPoint}`,
          );
          return p;
        };
      }
      T.ce = device.createCommandEncoder.bind(device);
      device.createCommandEncoder = (d) => {
        const enc = T.ce(d);
        if (!T.record) return enc;
        const bc = enc.beginComputePass.bind(enc);
        const br = enc.beginRenderPass.bind(enc);
        enc.beginComputePass = () => {
          const p = bc();
          let pipe, group, off;
          const sp = p.setPipeline.bind(p);
          const sb = p.setBindGroup.bind(p);
          const dw = p.dispatchWorkgroups.bind(p);
          p.setPipeline = (q) => (sp(q), (pipe = q));
          p.setBindGroup = (i, g, o) => (
            o ? sb(i, g, o) : sb(i, g),
            (group = g),
            (off = o)
          );
          p.dispatchWorkgroups = (x, y) => {
            dw(x, y);
            const [a, b, c] = [pipe, group, off];
            T.list.push({
              label: names.get(a),
              run: (e) => {
                const q = e.beginComputePass();
                q.setPipeline(a);
                c ? q.setBindGroup(0, b, c) : q.setBindGroup(0, b);
                q.dispatchWorkgroups(x, y);
                q.end();
              },
            });
          };
          return p;
        };
        enc.beginRenderPass = (desc) => {
          const p = br(desc);
          let pipe, group, blend, part, label;
          const draws = [];
          const real = {};
          for (const k of [
            "setPipeline",
            "setBindGroup",
            "setBlendConstant",
            "setScissorRect",
            "draw",
            "end",
          ])
            real[k] = p[k].bind(p);
          p.setPipeline = (q) => (real.setPipeline(q), (pipe = q));
          p.setBindGroup = (i, g) => (real.setBindGroup(i, g), (group = g));
          p.setBlendConstant = (k) => (real.setBlendConstant(k), (blend = k));
          p.setScissorRect = (...v) => (real.setScissorRect(...v), (part = v));
          p.draw = (n) => {
            real.draw(n);
            label ??= names.get(pipe);
            draws.push([pipe, group, blend, part, n]);
          };
          // (a pass of several draws is named after the first)
          p.end = () => {
            real.end();
            const at = [...desc.colorAttachments].map((c) => ({ ...c }));
            if (label === "show.frag") {
              const c = document.querySelector("canvas");
              at[0].view = device
                .createTexture({
                  size: [c.width, c.height],
                  format: navigator.gpu.getPreferredCanvasFormat(),
                  usage: 16,
                })
                .createView();
            }
            T.list.push({
              label,
              run: (e) => {
                const q = e.beginRenderPass({ colorAttachments: at });
                for (const [a, b, k, cut, n] of draws) {
                  q.setPipeline(a);
                  q.setBindGroup(0, b);
                  if (k) q.setBlendConstant(k);
                  if (cut) q.setScissorRect(...cut);
                  q.draw(n);
                }
                q.end();
              },
            });
          };
          return p;
        };
        return enc;
      };
      return device;
    };
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (f) =>
      raf((t) => {
        if (T.stop) return (T.later = f);
        const c0 = performance.now();
        f(t);
        T.js.push(performance.now() - c0);
      });
  },
  JSON.parse(process.env.CUT ?? "[]"),
);
await page.goto(url);
await page
  .waitForFunction(
    () => window.__coast && window.__coast.state.frame > 2,
    null,
    { timeout: 40000 },
  )
  .catch(() => {
    console.log("never started:\n" + [...new Set(bad)].join("\n"));
    process.exit(1);
  });
const all = [];
for (const at of moments) {
  await page.evaluate(
    ([s, at]) => {
      if (s) Object.assign(window.__coast.look, JSON.parse(s));
      window.__coast.state.hold = at;
    },
    [process.env.SET, +at],
  );
  await page.waitForTimeout(100);
  await page.waitForFunction(
    () => window.__coast.state.due === window.__coast.state.tick,
    null,
    { timeout: 120000 },
  );
  const out = await page.evaluate(
    async ([at, only]) => {
      const T = window.__time;
      const s = window.__coast.state;
      // one frame, two ticks of the water on
      T.list = [];
      const had = s.frame;
      T.record = true;
      s.hold = at + 2 / 60 / window.__coast.LOOP;
      while (s.frame === had) await new Promise((d) => setTimeout(d, 1));
      T.stop = true;
      T.record = false;
      await new Promise((d) => setTimeout(d, 60));
      // only the frame that had the water in it
      const list = T.list.slice(
        0,
        T.list.findIndex((x) => x.label === "show.frag") + 1,
      );
      const time = async (runs, many) => {
        const t0 = performance.now();
        for (let k = 0; k < many; k++) {
          const e = T.ce();
          for (const r of runs) r(e);
          T.device.queue.submit([e.finish()]);
        }
        await T.device.queue.onSubmittedWorkDone();
        return (performance.now() - t0) / many;
      };
      const best = async (runs) => {
        await time(runs, 4);
        const one = await time(runs, 8);
        const many = Math.max(6, Math.min(400, Math.ceil(120 / one)));
        const a = [];
        for (let k = 0; k < 8; k++) a.push(await time(runs, many));
        return Math.min(...a);
      };
      const out = {};
      const count = {};
      for (const x of list) count[x.label] = (count[x.label] ?? 0) + 1;
      for (const label of Object.keys(count))
        if (!only || only === label)
          out[label] = await best(
            list.filter((x) => x.label === label).map((x) => x.run),
          );
      if (!only) out.frame = await best(list.map((x) => x.run));
      const js = T.js.slice(-60).sort((a, b) => a - b);
      T.stop = false;
      const f = T.later;
      T.later = null;
      if (f) requestAnimationFrame(f);
      const c = document.querySelector("canvas");
      return {
        out,
        count,
        js: js[js.length >> 1],
        size: [c.width, c.height],
        res: window.__coast.look.res,
      };
    },
    [+at, process.env.ONLY],
  );
  all.push(out);
}
const keys = [...new Set(all.flatMap((a) => Object.keys(a.out)))];
const mean = (k) => all.reduce((s, a) => s + (a.out[k] ?? 0), 0) / all.length;
if (process.env.JSON)
  console.log(JSON.stringify({ at: moments, out: all.map((a) => a.out) }));
else {
  console.log(
    `canvas ${all[0].size.join("x")}, traced at ${all[0].res}; js ${all[0].js.toFixed(2)} ms`,
  );
  console.log(
    `${"".padEnd(16)}times  mean   ${moments.map((m) => m.padStart(7)).join("")}`,
  );
  for (const k of keys.sort((a, b) => mean(b) - mean(a)))
    console.log(
      `${k.padEnd(16)}${String(all[0].count[k] ?? "").padStart(3)} ${mean(k).toFixed(2).padStart(7)}   ${all.map((a) => (a.out[k] ?? 0).toFixed(2).padStart(7)).join("")}`,
    );
}
if (bad.length)
  console.log(`${bad.length} problems:\n${[...new Set(bad)].join("\n")}`);
await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 2500))]);
process.exit(0);
