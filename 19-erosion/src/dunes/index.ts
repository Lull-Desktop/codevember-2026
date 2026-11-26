// Dunes that travel like slow waves, and someone walking against them who gets nowhere.
//
// The dunes were worked out beforehand (sim/dunes.py, sim/loop.py): a lap of a simulation that ends as it began,
// kept as heights at some moments of it, in a frame that moves with the dunes. now.wgsl makes the heights of this
// moment from them, light.wgsl the light in the hollows, trace.wgsl the picture. While nothing moves, each frame is
// a slightly shifted picture averaged into the last.
import type { Sketch, SketchSettings } from "ssam";
import { ssam } from "ssam";
import { Color, PerspectiveCamera } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import GUI from "three/examples/jsm/libs/lil-gui.module.min.js";
import Stats from "three/examples/jsm/libs/stats.module.js";
import commonCode from "./common.wgsl?raw";
import lightCode from "./light.wgsl?raw";
import nowCode from "./now.wgsl?raw";
import personCode from "./person.wgsl?raw";
import showCode from "./show.wgsl?raw";
import traceCode from "./trace.wgsl?raw";
import { createWalk } from "./walk";

const LOOP = 40; // seconds
const STILL = 64; // frames averaged into a still

const look = {
  play: true,
  at: 0.2, // where in the loop, when not playing
  free: false, // the mouse moves the eye
  // the eye
  eyeX: 70,
  eyeY: 52,
  eyeZ: 330,
  aimX: -6,
  aimY: 10,
  aimZ: -60,
  fov: 24,
  sway: 7,
  // the dunes
  tall: 1.25, // how high they are drawn
  // the person
  who: 3, // how tall, metres
  whoX: 0,
  whoZ: 0,
  // the light
  sunTurn: -108, // from straight ahead, degrees; negative is left
  sunHeight: 8.5,
  sunWide: 1.4,
  sunTone: "#ffbe84",
  sun: 3.7,
  low: "#ffc573",
  side: "#e0a380",
  mid: "#dc9484",
  midUp: 0.075,
  top: "#8c6f92",
  sky: 0.9,
  cloud: "#d67a72",
  clouds: 0.85,
  rises: 5,
  sand: "#cda27a",
  matte: 0.6,
  bounce: 0.5,
  cool: "#4763b4",
  coolness: 0.85,
  // the air
  haze: 0.00055,
  hazeThin: 0.045,
  hazeGlow: 0.5,
  drift: 0.12,
  driftFar: 14,
  driftHigh: 1.2,
  driftStreak: 0.8,
  // the sand's face
  ripple: 0,
  rippleWide: 1.0,
  streak: 0.05,
  speck: 0.06,
  // the print
  exposure: 0.95,
  glow: 0.12,
  colour: 1.0,
  noise: 0.5,
  corner: 0.35,
  res: 1 / Math.min(window.devicePixelRatio, 2),
};
const ranges: Record<string, [number, number, number?]> = {
  at: [0, 1],
  eyeX: [-120, 120],
  eyeY: [2, 120],
  eyeZ: [20, 500],
  aimX: [-120, 120],
  aimY: [-20, 60],
  aimZ: [-300, 200],
  fov: [5, 70],
  sway: [0, 30],
  tall: [0.5, 2],
  who: [0.5, 8],
  whoX: [-60, 60],
  whoZ: [-200, 200],
  sunTurn: [-180, 180],
  sunHeight: [1, 60],
  sunWide: [0.1, 6],
  sun: [0, 10],
  midUp: [0.05, 0.8],
  sky: [0, 2],
  clouds: [0, 1],
  rises: [0, 20],
  matte: [0, 1],
  bounce: [0, 3],
  coolness: [0, 1],
  haze: [0, 0.01],
  hazeThin: [0.005, 0.2],
  hazeGlow: [0, 3],
  drift: [0, 0.4],
  driftFar: [1, 60],
  driftHigh: [0.1, 5],
  driftStreak: [0, 1],
  ripple: [0, 0.6],
  rippleWide: [0.2, 4],
  streak: [0, 0.6],
  speck: [0, 0.6],
  exposure: [0.2, 3],
  glow: [0, 1],
  colour: [0, 2],
  noise: [0, 2],
  corner: [0, 1.5],
  res: [0.25, 2],
};

const sketch: Sketch<"webgpu"> = async ({ wrap, canvas }) => {
  if (import.meta.hot) {
    import.meta.hot.dispose(() => wrap.dispose());
    import.meta.hot.accept(() => wrap.hotReload());
  }
  const adapter = await navigator.gpu?.requestAdapter({
    powerPreference: "high-performance",
  });
  if (!adapter) throw new Error("WebGPU is not available");
  // heights are kept as full floats and blended between cells; without that the low sun shows every step
  if (!adapter.features.has("float32-filterable"))
    throw new Error("this device cannot blend float textures");
  const meta = (await (await fetch("./output/dunes.json")).json()) as {
    n: number;
    m: number;
    keys: number;
    dx: number;
    lo: number;
    hi: number;
  };
  const data = new Uint16Array(
    await (await fetch("./output/dunes.bin")).arrayBuffer(),
  );
  const device = await adapter.requestDevice({
    requiredFeatures: ["float32-filterable"],
    requiredLimits: {
      maxStorageBufferBindingSize: Math.max(data.byteLength, 134217728),
      maxBufferSize: Math.max(data.byteLength, 268435456),
    },
  });
  const context = canvas.getContext("webgpu")!;
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: "opaque" });

  const sources: Record<string, string> = {
    now: commonCode + nowCode,
    light: commonCode + lightCode,
    trace: commonCode + personCode + traceCode,
    show: showCode,
  };
  const modules: Record<string, GPUShaderModule> = {};
  for (const [name, code] of Object.entries(sources)) {
    const m = device.createShaderModule({ code, label: name });
    modules[name] = m;
    const info = await m.getCompilationInfo();
    for (const msg of info.messages)
      console[msg.type === "error" ? "error" : "warn"](
        `${name}:${msg.lineNum}:${msg.linePos} ${msg.message}\n${code.split("\n")[msg.lineNum - 1]}`,
      );
  }
  const compute = (module: string, entryPoint: string) =>
    device.createComputePipeline({
      layout: "auto",
      compute: { module: modules[module], entryPoint },
    });
  const bind = (
    pipe: GPUComputePipeline | GPURenderPipeline,
    entries: [number, GPUBuffer | GPUTextureView | GPUSampler][],
  ) =>
    device.createBindGroup({
      layout: pipe.getBindGroupLayout(0),
      entries: entries.map(([binding, r]) => ({
        binding,
        resource: r instanceof GPUBuffer ? { buffer: r } : r,
      })),
    });

  const uniform = (n: number) => {
    const array = new Float32Array(n);
    const buffer = device.createBuffer({
      size: array.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    return { array, buffer };
  };
  const frame = uniform(21 * 4);
  const made = uniform(8);
  const shown = uniform(8);
  const keysBuffer = device.createBuffer({
    size: data.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(keysBuffer, 0, data);

  const { n, m } = meta;
  const map = (w: number, h: number, f: GPUTextureFormat) =>
    device
      .createTexture({
        size: [w, h],
        format: f,
        usage:
          GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
      })
      .createView();
  const heightMap = map(n, m, "r32float");
  const lipMap = map(n / 2, m / 2, "rgba16float");
  const litMap = map(n, m, "rgba16float");
  const fillRaw = map(n / 2, m / 2, "rgba16float");
  const fillMap = map(n / 2, m / 2, "rgba16float");
  const repeat = device.createSampler({
    magFilter: "linear",
    minFilter: "linear",
    addressModeU: "repeat",
    addressModeV: "repeat",
  });
  const soft = device.createSampler({
    magFilter: "linear",
    minFilter: "linear",
  });

  const nowPipe = compute("now", "now");
  const lipPipe = compute("now", "lip");
  const sunnedPipe = compute("light", "sunned");
  const gatherPipe = compute("light", "gather");
  const evenPipe = compute("light", "even");
  const passes: [GPUComputePipeline, GPUBindGroup, number, number][] = [
    [
      nowPipe,
      bind(nowPipe, [
        [1, keysBuffer],
        [2, heightMap],
        [3, made.buffer],
      ]),
      n,
      m,
    ],
    [
      lipPipe,
      bind(lipPipe, [
        [0, frame.buffer],
        [3, made.buffer],
        [4, heightMap],
        [5, lipMap],
      ]),
      n / 2,
      m / 2,
    ],
    [
      sunnedPipe,
      bind(sunnedPipe, [
        [0, frame.buffer],
        [1, heightMap],
        [2, repeat],
        [3, litMap],
      ]),
      n,
      m,
    ],
    [
      gatherPipe,
      bind(gatherPipe, [
        [0, frame.buffer],
        [1, heightMap],
        [2, repeat],
        [4, litMap],
        [5, fillRaw],
      ]),
      n / 2,
      m / 2,
    ],
    [
      evenPipe,
      bind(evenPipe, [
        [5, fillMap],
        [6, fillRaw],
      ]),
      n / 2,
      m / 2,
    ],
  ];

  const blend: GPUBlendComponent = {
    srcFactor: "constant",
    dstFactor: "one-minus-constant",
    operation: "add",
  };
  const full = (
    module: string,
    entryPoint: string,
    f: GPUTextureFormat,
    b?: GPUBlendState,
  ) =>
    device.createRenderPipeline({
      layout: "auto",
      vertex: { module: modules[module], entryPoint: "vert" },
      fragment: {
        module: modules[module],
        entryPoint,
        targets: [{ format: f, blend: b }],
      },
    });
  const tracePipe = full("trace", "frag", "rgba16float", {
    color: blend,
    alpha: blend,
  });
  const downPipe = full("show", "down", "rgba16float");
  const plus: GPUBlendComponent = { srcFactor: "one", dstFactor: "one" };
  const upPipe = full("show", "up", "rgba16float", {
    color: plus,
    alpha: plus,
  });
  const showPipe = full("show", "frag", format);
  const traceBind = bind(tracePipe, [
    [0, frame.buffer],
    [1, heightMap],
    [2, repeat],
    [3, lipMap],
    [4, fillMap],
  ]);

  let target: GPUTexture | null = null;
  let targetView: GPUTextureView;
  let showBind: GPUBindGroup;
  let glows: GPUTexture[] = [];
  let glowViews: GPUTextureView[] = [];
  let downs: GPUBindGroup[] = [];
  let ups: GPUBindGroup[] = [];
  const fit = () => {
    const w = Math.max(64, Math.round(canvas.width * look.res));
    const h = Math.max(64, Math.round(canvas.height * look.res));
    if (target && target.width === w && target.height === h) return;
    for (const t of [target, ...glows]) t?.destroy();
    const picture = (pw: number, ph: number) =>
      device.createTexture({
        size: [pw, ph],
        format: "rgba16float",
        usage:
          GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
    target = picture(w, h);
    targetView = target.createView();
    glows = [1, 2, 3, 4, 5, 6].map((k) =>
      picture(Math.max(1, w >> k), Math.max(1, h >> k)),
    );
    glowViews = glows.map((t) => t.createView());
    downs = glowViews.map((_, k) =>
      bind(downPipe, [
        [1, k ? glowViews[k - 1] : targetView],
        [2, soft],
      ]),
    );
    ups = glowViews.slice(1).map((v) =>
      bind(upPipe, [
        [1, v],
        [2, soft],
      ]),
    );
    showBind = bind(showPipe, [
      [0, shown.buffer],
      [1, targetView],
      [2, soft],
      [3, glowViews[0]],
    ]);
    state.still = 0;
  };

  const camera = new PerspectiveCamera(24, 1, 0.1, 4000);
  const controls = new OrbitControls(camera, canvas);
  const state = {
    frame: 0,
    still: 0, // frames averaged so far
    hold: -1, // a moment of the loop to stay at, for the tools
    spp: 1, // rays a pixel in one frame, for the film
    walk: {} as Record<string, number>,
  };
  const { heightAt, walkAt } = createWalk(data, meta, LOOP);
  const gui = new GUI({ title: "dunes" });
  gui.close();
  for (const k of Object.keys(look)) {
    const r = ranges[k];
    const values = look as unknown as Record<string, number>;
    if (r) gui.add(values, k, r[0], r[1], r[2]);
    else if (typeof values[k] === "string")
      gui.addColor(look as unknown as Record<string, string>, k);
    else gui.add(values, k);
  }
  const stats = new Stats();
  stats.dom.id = "stats";
  document.body.appendChild(stats.dom);
  Object.assign(window, {
    __dunes: { look, state, camera, controls, device, heightAt, LOOP },
  });
  const rgb = (c: string) => new Color(c).toArray();

  let last = "";
  wrap.render = ({ playhead }) => {
    fit();
    const w = target!.width;
    const h = target!.height;
    const u = state.hold >= 0 ? state.hold : look.play ? playhead : look.at;
    if (look.free) controls.update();
    else {
      // the eye drifts a little, as if held up by the same air
      const way = 2 * Math.PI * u;
      camera.position.set(
        look.eyeX + look.sway * Math.sin(way),
        look.eyeY + look.sway * 0.25 * Math.sin(way + 1.4),
        look.eyeZ - look.sway * 0.8 * Math.cos(way),
      );
      controls.target.set(look.aimX, look.aimY, look.aimZ);
      camera.lookAt(controls.target);
    }
    camera.aspect = w / h;
    camera.updateMatrixWorld();
    const e = camera.matrixWorld.elements;
    const tan = Math.tan((look.fov * Math.PI) / 360);
    const az = (look.sunTurn * Math.PI) / 180;
    const el = (look.sunHeight * Math.PI) / 180;
    const sun = [
      Math.sin(az) * Math.cos(el),
      Math.sin(el),
      -Math.cos(az) * Math.cos(el),
    ];
    const who = walkAt(u, look.whoX, look.whoZ, look.tall, look.who);
    state.walk = who;
    const Lx = n * meta.dx;
    const tone = (c: string, k = 1) => rgb(c).map((v) => v * k);
    const a = frame.array;
    let slot = 0;
    const put = (...v: number[]) => {
      a.set(v, slot);
      slot += 4;
    };
    put(e[12], e[13], e[14], 0);
    put(e[0], e[1], e[2], tan * camera.aspect);
    put(e[4], e[5], e[6], tan);
    put(-e[8], -e[9], -e[10], 0);
    put(w, h, 0, u);
    put(sun[0], sun[1], sun[2], Math.tan((look.sunWide * Math.PI) / 180));
    put(...tone(look.sunTone, look.sun), 0);
    put(Lx, m * meta.dx, u * Lx, meta.dx);
    put(...tone(look.low), look.sky);
    put(...tone(look.side), look.clouds);
    put(...tone(look.mid), look.midUp);
    put(...tone(look.top), look.bounce);
    put(...tone(look.cloud), look.rises);
    put(...tone(look.sand), look.matte);
    put(
      look.haze,
      look.hazeThin,
      look.hazeGlow,
      meta.hi * look.tall + 3 + look.rises * 2.4,
    );
    put(look.drift, look.driftFar, look.driftHigh, look.driftStreak);
    put(look.ripple, look.rippleWide, look.streak, look.speck);
    put(who.x, who.y, look.whoZ, look.who);
    put(who.step, who.lean, who.stride, who.slope);
    put(who.hard, u, 0, 0);
    put(...tone(look.cool), look.coolness);

    // anything that changes the picture starts the still again
    const key = a.join(" ");
    if (key !== last) state.still = 0;
    last = key;

    const encoder = device.createCommandEncoder();
    if (state.still === 0) {
      made.array.set([n, m, meta.keys, u, meta.lo, meta.hi, look.tall, 0]);
      device.queue.writeBuffer(made.buffer, 0, made.array);
      device.queue.writeBuffer(frame.buffer, 0, a);
      const pass = encoder.beginComputePass();
      for (const [pipe, group, x, y] of passes) {
        pass.setPipeline(pipe);
        pass.setBindGroup(0, group);
        pass.dispatchWorkgroups(Math.ceil(x / 8), Math.ceil(y / 8));
      }
      pass.end();
    }
    if (state.still < STILL) {
      device.queue.writeBuffer(
        frame.buffer,
        4 * 4 * 4 + 8,
        new Float32Array([state.still]),
      );
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: targetView,
            loadOp: state.still === 0 ? "clear" : "load",
            storeOp: "store",
          },
        ],
      });
      pass.setPipeline(tracePipe);
      pass.setBindGroup(0, traceBind);
      const k = 1 / (state.still + 1);
      pass.setBlendConstant([k, k, k, k]);
      pass.draw(3);
      pass.end();
      state.still++;
    }
    shown.array.set([canvas.width, canvas.height, look.exposure, state.frame]);
    shown.array.set([look.glow, look.colour, look.noise, look.corner], 4);
    device.queue.writeBuffer(shown.buffer, 0, shown.array);
    const fill = (
      view: GPUTextureView,
      pipe: GPURenderPipeline,
      group: GPUBindGroup,
      loadOp: GPULoadOp = "clear",
    ) => {
      const pass = encoder.beginRenderPass({
        colorAttachments: [{ view, loadOp, storeOp: "store" }],
      });
      pass.setPipeline(pipe);
      pass.setBindGroup(0, group);
      pass.draw(3);
      pass.end();
    };
    for (let k = 0; k < glows.length; k++)
      fill(glowViews[k], downPipe, downs[k]);
    for (let k = glows.length - 2; k >= 0; k--)
      fill(glowViews[k], upPipe, ups[k], "load");
    fill(context.getCurrentTexture().createView(), showPipe, showBind);
    device.queue.submit([encoder.finish()]);
    stats.update();
    state.frame++;
  };

  wrap.resize = () => (state.still = 0);
  wrap.unload = () => {
    gui.destroy();
    stats.dom.remove();
    controls.dispose();
    device.destroy();
  };
};

const settings: SketchSettings = {
  mode: "webgpu",
  pixelRatio: Math.min(window.devicePixelRatio, 2),
  animate: true,
  duration: LOOP * 1000,
  exportFps: 60,
  framesFormat: ["webm"],
};

ssam(sketch, settings);
