// Two oceans. The wind off the land drives dunes down to the sea, where they are tallest, and out into it; the waves come
// the other way and cut them down. And someone walks towards us between the two, along the water, and never gets here.
//
// The sand was worked out beforehand (sim/shore.py, sim/shoreloop.py): now.wgsl makes the ground of this moment. The
// water is worked out live on that ground (water.wgsl). light.wgsl makes the light in the hollows, trace.wgsl the
// picture. The eye goes back along the coast by one bay a loop, and a loop later everything is as it was, one bay on.
import type { Sketch, SketchSettings } from "ssam";
import { ssam } from "ssam";
import { Color, PerspectiveCamera, Vector3 } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import GUI from "three/examples/jsm/libs/lil-gui.module.min.js";
import Stats from "three/examples/jsm/libs/stats.module.js";
import airCode from "./air.wgsl?raw";
import bakeCode from "./bake.wgsl?raw";
import commonCode from "./common.wgsl?raw";
import lightCode from "./light.wgsl?raw";
import nowCode from "./now.wgsl?raw";
import personCode from "./person.wgsl?raw";
import sceneCode from "./scene.wgsl?raw";
import nearCode from "./near.wgsl?raw";
import showCode from "./show.wgsl?raw";
import traceCode from "./trace.wgsl?raw";
import walkerCode from "./walker.wgsl?raw";
import waterCode from "./water.wgsl?raw";
import { bringDunes, type Packed } from "./dunes";
import { createWalk } from "./walk";

const LOOP = 40; // seconds
const STILL = 64; // frames averaged into a still
const TICKS = 60; // of the water, a second; each is two steps
const SEA = 120; // columns of sea put before the ground
const WET = 360; // columns of the water's grid
let WARM = Number(new URLSearchParams(location.search).get("warm") ?? 2400); // ticks the water is run before a moment that is jumped to
const RUSH = 40; // of them in a frame

const look = {
  play: true,
  at: 0.2, // where in the loop, when not playing
  free: false, // the mouse moves the eye
  // the eye
  eyeX: -9,
  eyeY: 33,
  eyeZ: 0,
  aimX: -30,
  aimY: 0,
  aimZ: -147,
  fov: 46,
  sway: 1.2,
  curve: 0.0009,
  // the land
  tall: 1.25, // how much taller the dunes are drawn than they were worked out
  // the sea
  tide: 0.35,
  water: "#37616f",
  shallow: "#3f8f92",
  choppy: 0.2,
  // the person
  who: 3.6, // how tall, metres
  whoZ: -86,
  whoX: 8, // where they walk, from the sea inland
  swing: 6, // how far to each side, metres
  when: 0.56, // when in the loop
  stride: 0.23,
  // the light
  sunTurn: -58, // from straight ahead, degrees; negative is left
  sunHeight: 7.5,
  sunWide: 1.2,
  sunTone: "#ffd6a2",
  sun: 4.4,
  patches: 0.75,
  low: "#ffe9bf",
  side: "#b4c0ca",
  mid: "#bcc6ca",
  midUp: 0.12,
  top: "#7d98b6",
  sky: 0.82,
  clouds: 0.8,
  cool: "#6f95ee",
  coolness: 0.85,
  sand: "#c59c6c",
  matte: 0.6,
  bounce: 0.8,
  hills: "#4d6484",
  hillsUp: 0.11,
  // the air
  haze: 0.0008,
  hazeThin: 0.03,
  mist: 0.007,
  mistHigh: 5,
  mistPatchy: 0.42,
  mistSun: 0.5,
  spray: 0.5,
  drift: 0.24,
  driftFar: 10,
  driftHigh: 1.5,
  driftStreak: 0.8,
  // the sand's face
  ripple: 0.018,
  relief: 1.8, // how much the sand's face shows in the shade
  rippleWide: 0.7,
  streak: 0.14,
  speck: 0.08,
  // the print
  exposure: 0.9,
  glow: 0.12,
  colour: 1.0,
  noise: 0.4,
  corner: 0.3,
  res: window.devicePixelRatio > 1 ? 0.7 : 1, // rays to a pixel of the screen, each way
};
// the same coast with the sun high: what is different. (It is turned to a little at a time.)
const low = { ...look };
const day: Partial<typeof look> = {
  sunHeight: 20,
  sunTone: "#ffeacb",
  sun: 3.3,
  low: "#f4f1e6",
  side: "#c2d6e4",
  mid: "#b4d0e4",
  top: "#5f95cc",
  sky: 0.9,
  clouds: 0.6,
  patches: 0.45,
  cool: "#8ea6f2",
  coolness: 0.75,
  shallow: "#4aa6a4",
  hills: "#5d7d9c",
  haze: 0.0006,
  mist: 0.0045,
  mistSun: 0.3,
  exposure: 0.83,
};
const ranges: Record<string, [number, number, number?]> = {
  at: [0, 1],
  eyeX: [-60, 260],
  eyeY: [1, 80],
  eyeZ: [-100, 100],
  aimX: [-120, 260],
  aimY: [-20, 40],
  aimZ: [-300, 0],
  fov: [5, 80],
  sway: [0, 10],
  curve: [-0.003, 0.003],
  tall: [0.5, 2],
  tide: [0, 1],
  choppy: [0.03, 0.6],
  who: [0.5, 8],
  whoZ: [-400, -5],
  whoX: [-60, 60],
  swing: [0, 12],
  when: [0, 1],
  stride: [0.1, 0.4],
  sunTurn: [-180, 180],
  sunHeight: [1, 60],
  sunWide: [0.1, 6],
  sun: [0, 10],
  patches: [0, 1],
  midUp: [0.03, 0.8],
  sky: [0, 2],
  clouds: [0, 1],
  coolness: [0, 1],
  matte: [0, 1],
  bounce: [0, 3],
  hillsUp: [0, 0.4],
  haze: [0, 0.01],
  hazeThin: [0.005, 0.2],
  mist: [0, 0.04],
  mistHigh: [0.5, 30],
  mistPatchy: [0, 0.9],
  mistSun: [0, 3],
  spray: [0, 3],
  drift: [0, 0.6],
  driftFar: [1, 60],
  driftHigh: [0.1, 5],
  driftStreak: [0, 1],
  ripple: [0, 0.2],
  relief: [0, 12],
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
  const meta = (await (await fetch("./coast.json")).json()) as Packed;
  // the dunes, and how much of them is here
  const veil = document.getElementById("veil");
  const how = veil?.querySelector<HTMLElement>(".how");
  const say = (text: string) =>
    how && (how.lastElementChild!.textContent = text);
  const { data, moves } = await bringDunes("./coast.pack", meta, (share) => {
    veil?.style.setProperty("--have", `${(share * 100).toFixed(1)}%`);
    say(`${Math.floor(share * 100)}%`);
  });
  how?.classList.add("wait");
  say("the sea is coming in");
  const { n, m } = meta;
  const heights = n * m * meta.keys;
  const device = await adapter.requestDevice({
    requiredFeatures: ["float32-filterable"],
    requiredLimits: {
      maxStorageBufferBindingSize: Math.max(heights * 2, 134217728),
      maxBufferSize: Math.max(heights * 2, 268435456),
    },
  });
  const context = canvas.getContext("webgpu")!;
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: "opaque" });

  const common = (quick: boolean) => `const QUICK = ${quick};\n${commonCode}`;
  const sources: Record<string, string> = {
    now: common(false) + nowCode,
    light: common(false) + lightCode,
    bake: common(false) + bakeCode,
    trace: common(true) + sceneCode + nearCode + traceCode,
    walker: common(true) + sceneCode + nearCode + personCode + walkerCode,
    air: common(false) + sceneCode + airCode,
    water: waterCode,
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
  const frame = uniform(42 * 4);
  const made = uniform(20);
  const shown = uniform(8);
  const store = (bytes: number) =>
    device.createBuffer({
      size: Math.ceil(bytes / 4) * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
  const keysBuffer = store(heights * 2);
  device.queue.writeBuffer(keysBuffer, 0, data);
  const movesBuffer = store(moves.byteLength);
  const padded = new Uint8Array(Math.ceil(moves.byteLength / 4) * 4);
  padded.set(moves);
  device.queue.writeBuffer(movesBuffer, 0, padded);

  const wide = n + SEA;
  const map = (w: number, h: number, f: GPUTextureFormat) =>
    device
      .createTexture({
        size: [w, h],
        format: f,
        usage:
          GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
      })
      .createView();
  const groundMap = map(wide, m, "r32float");
  const topMap = map(wide, m, "r32float");
  const waterMap = map(WET, m, "rgba16float");
  const lipMap = map(wide / 2, m / 2, "rgba16float");
  const shadeMap = map(wide, m, "rg32float");
  const shadeMap2 = map(wide, m, "rg32float");
  const litMap = map(wide, m, "rgba16float");
  const fillRaw = map(wide / 2, m / 2, "rgba16float");
  const fillMap = map(wide / 2, m / 2, "rgba16float");
  const repeat = device.createSampler({
    magFilter: "linear",
    minFilter: "linear",
    addressModeU: "clamp-to-edge",
    addressModeV: "repeat",
  });
  const again = device.createSampler({
    magFilter: "linear",
    minFilter: "linear",
    addressModeU: "repeat",
    addressModeV: "repeat",
  });
  const soft = device.createSampler({
    magFilter: "linear",
    minFilter: "linear",
  });

  // ---- what is made once
  const tileMap = map(256, 256, "rgba16float");
  const patchMap = map(256, 256, "rgba16float");
  const cloudMap = map(2048, 1024, "rgba16float");
  const hillMap = map(8192, 512, "rgba8unorm");
  const bakes = (
    [
      ["tiles", 1, tileMap, 256, 256],
      ["patches", 2, patchMap, 256, 256],
      ["clouds", 3, cloudMap, 2048, 1024],
    ] as const
  ).map(([name, binding, view, w, h]) => {
    const pipe = compute("bake", name);
    return { pipe, group: bind(pipe, [[binding, view]]), w, h, deep: 1 };
  });
  // the sand's noises: eight layers, each size half the one before
  const SIZES = 8;
  const grains = device.createTexture({
    size: [512, 512, 8],
    format: "rgba16float",
    mipLevelCount: SIZES,
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
  });
  const grainSize = (k: number) =>
    grains.createView({
      dimension: "2d-array",
      baseMipLevel: k,
      mipLevelCount: 1,
    });
  const grainPipe = compute("bake", "grains");
  const halvePipe = compute("bake", "halve");
  const grainBakes = Array.from({ length: SIZES }, (_, k) => ({
    pipe: k ? halvePipe : grainPipe,
    group: k
      ? bind(halvePipe, [
          [5, grainSize(k)],
          [6, grainSize(k - 1)],
        ])
      : bind(grainPipe, [[5, grainSize(0)]]),
    w: 512 >> k,
    h: 512 >> k,
    deep: 8,
  }));
  const hillsPipe = compute("bake", "hills");
  const hillsBake = {
    pipe: hillsPipe,
    group: bind(hillsPipe, [
      [0, frame.buffer],
      [4, hillMap],
    ]),
    w: 8192,
    h: 512,
    deep: 1,
  };
  let hillsUp = -1; // how high the hills were made
  const bake = (jobs: (typeof hillsBake)[]) => {
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    for (const { pipe, group, w, h, deep } of jobs) {
      pass.setPipeline(pipe);
      pass.setBindGroup(0, group);
      pass.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8), deep);
    }
    pass.end();
    device.queue.submit([encoder.finish()]);
  };
  bake([...bakes, ...grainBakes]);

  // ---- the water
  const states = [0, 1].map(() => store(WET * m * 16));
  const skins = [0, 1].map(() => store(WET * m * 8));
  // the numbers of each step of a rush, one after another
  const waterData = new Float32Array(RUSH * 64);
  const waterBuffer = device.createBuffer({
    size: waterData.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const waterLayout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "uniform", hasDynamicOffset: true },
      },
      {
        binding: 1,
        visibility: GPUShaderStage.COMPUTE,
        texture: { sampleType: "unfilterable-float" },
      },
      ...[2, 3, 4, 5].map((binding) => ({
        binding,
        visibility: GPUShaderStage.COMPUTE,
        buffer: {
          type: (binding % 2
            ? "storage"
            : "read-only-storage") as GPUBufferBindingType,
        },
      })),
    ],
  });
  const waterPipe = (entryPoint: string) =>
    device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [waterLayout] }),
      compute: { module: modules.water, entryPoint },
    });
  const flowPipe = waterPipe("flow");
  const foamPipe = waterPipe("foam");
  const stillPipe = waterPipe("still");
  const waterBind = [0, 1].map((k) =>
    device.createBindGroup({
      layout: waterLayout,
      entries: [
        { binding: 0, resource: { buffer: waterBuffer, size: 32 } },
        { binding: 1, resource: groundMap },
        { binding: 2, resource: { buffer: states[k] } },
        { binding: 3, resource: { buffer: states[1 - k] } },
        { binding: 4, resource: { buffer: skins[k] } },
        { binding: 5, resource: { buffer: skins[1 - k] } },
      ],
    }),
  );

  // the foam's step: the water always in the first buffer, the foam from one of its two to the other
  const foamBind = [0, 1].map((k) =>
    device.createBindGroup({
      layout: waterLayout,
      entries: [
        { binding: 0, resource: { buffer: waterBuffer, size: 32 } },
        { binding: 1, resource: groundMap },
        { binding: 2, resource: { buffer: states[0] } },
        { binding: 3, resource: { buffer: states[1] } },
        { binding: 4, resource: { buffer: skins[k] } },
        { binding: 5, resource: { buffer: skins[1 - k] } },
      ],
    }),
  );
  const groundPipe = compute("now", "ground");
  const layPipe = compute("now", "lay");
  const lipPipe = compute("now", "lip");
  // eight steps, the last of which ends in shadeMap
  const shadePipes = Array.from({ length: 8 }, (_, k) =>
    device.createComputePipeline({
      layout: "auto",
      compute: {
        module: modules.now,
        entryPoint: k ? "shadeNext" : "shadeFirst",
        constants: { FAR_AS: meta.dx * 2 ** k },
      },
    }),
  );
  const sunnedPipe = compute("light", "sunned");
  const gatherPipe = compute("light", "gather");
  const evenPipe = compute("light", "even");
  const groundBind = bind(groundPipe, [
    [0, frame.buffer],
    [1, keysBuffer],
    [2, movesBuffer],
    [3, made.buffer],
    [4, groundMap],
  ]);
  const layBind = [0, 1].map((k) =>
    bind(layPipe, [
      [0, frame.buffer],
      [5, groundMap],
      [6, states[0]],
      [7, skins[k]],
      [8, topMap],
      [9, waterMap],
    ]),
  );
  const passes: [GPUComputePipeline, GPUBindGroup, number, number][] = [
    [
      lipPipe,
      bind(lipPipe, [
        [0, frame.buffer],
        [10, topMap],
        [11, lipMap],
        [14, waterMap],
      ]),
      wide / 2,
      m / 2,
    ],
    ...shadePipes.map(
      (pipe, k): [GPUComputePipeline, GPUBindGroup, number, number] => {
        const out = k % 2 ? shadeMap : shadeMap2;
        return [
          pipe,
          bind(pipe, [
            [0, frame.buffer],
            [12, repeat],
            [13, out],
            k ? [15, k % 2 ? shadeMap2 : shadeMap] : [10, topMap],
          ]),
          wide,
          m,
        ];
      },
    ),
    [
      sunnedPipe,
      bind(sunnedPipe, [
        [0, frame.buffer],
        [1, topMap],
        [2, repeat],
        [3, litMap],
        [7, shadeMap],
      ]),
      wide,
      m,
    ],
    [
      gatherPipe,
      bind(gatherPipe, [
        [0, frame.buffer],
        [1, topMap],
        [2, repeat],
        [4, litMap],
        [5, fillRaw],
      ]),
      wide / 2,
      m / 2,
    ],
    [
      evenPipe,
      bind(evenPipe, [
        [5, fillMap],
        [6, fillRaw],
      ]),
      wide / 2,
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
    targets: GPUTextureFormat | GPUTextureFormat[],
    blend?: GPUBlendState,
  ) =>
    device.createRenderPipeline({
      layout: "auto",
      vertex: { module: modules[module], entryPoint: "vert" },
      fragment: {
        module: modules[module],
        entryPoint,
        targets: [targets].flat().map((format) => ({ format, blend })),
      },
    });
  const castMap = device
    .createTexture({
      size: [128, 128],
      format: "rgba16float",
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    })
    .createView();
  const tracePipe = full("trace", "frag", "rgba16float");
  const walkerPipe = full("walker", "frag", "rgba16float");
  const castPipe = full("walker", "fromSun", "rgba16float");
  const airPipe = full("air", "air", ["rgba16float", "rgba16float"]);
  const mixPipe = full("air", "mixed", "rgba16float", {
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
    [1, topMap],
    [2, repeat],
    [4, fillMap],
    [5, shadeMap],
    [6, waterMap],
    [9, again],
    [10, patchMap],
    [11, cloudMap],
    [12, hillMap],
    [13, grains.createView()],
    [14, castMap],
    [15, soft],
  ]);
  const walkerBind = bind(walkerPipe, [
    [0, frame.buffer],
    [1, topMap],
    [2, repeat],
    [5, shadeMap],
    [9, again],
    [10, patchMap],
  ]);
  const castBind = bind(castPipe, [[0, frame.buffer]]);

  let target: GPUTexture | null = null;
  let targetView: GPUTextureView;
  let surface: GPUTexture; // what the rays meet, and how far off
  let airs: GPUTexture[] = [];
  let surfaceView: GPUTextureView;
  let airViews: GPUTextureView[] = [];
  let airBind: GPUBindGroup;
  let mixBind: GPUBindGroup;
  let showBind: GPUBindGroup;
  let glows: GPUTexture[] = [];
  let glowViews: GPUTextureView[] = [];
  let downs: GPUBindGroup[] = [];
  let ups: GPUBindGroup[] = [];
  // the air is about as fine whatever the picture's size: two of the page's own pixels
  const airStep = () =>
    Math.max(
      2,
      Math.round(
        (2 * look.res * canvas.width) / (canvas.clientWidth || canvas.width),
      ),
    );
  const fit = () => {
    const w = Math.max(64, Math.round(canvas.width * look.res));
    const h = Math.max(64, Math.round(canvas.height * look.res));
    if (target && target.width === w && target.height === h) return;
    for (const t of [target, surface, ...airs, ...glows]) t?.destroy();
    const picture = (pw: number, ph: number) =>
      device.createTexture({
        size: [pw, ph],
        format: "rgba16float",
        usage:
          GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
    target = picture(w, h);
    targetView = target.createView();
    surface = picture(w, h);
    surfaceView = surface.createView();
    const step = airStep();
    airs = [0, 1].map(() => picture(Math.ceil(w / step), Math.ceil(h / step)));
    airViews = airs.map((t) => t.createView());
    airBind = bind(airPipe, [
      [0, frame.buffer],
      [1, topMap],
      [2, repeat],
      [3, lipMap],
      [5, shadeMap],
      [8, tileMap],
      [9, again],
      [10, patchMap],
      [20, surfaceView],
    ]);
    mixBind = bind(mixPipe, [
      [0, frame.buffer],
      [20, surfaceView],
      [21, airViews[0]],
      [22, airViews[1]],
    ]);
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

  const camera = new PerspectiveCamera(38, 1, 0.1, 4000);
  const controls = new OrbitControls(camera, canvas);
  const state = {
    frame: 0,
    still: 0, // frames averaged so far
    hold: -1, // a moment of the loop to stay at, for the tools
    spp: 1, // rays a pixel in one frame, for the film
    walk: {} as Record<string, number>,
    tick: -1, // of the water
    due: 0,
    laps: 0, // loops played
  };
  const { groundAt, walkAt, wayAt } = createWalk(data, meta, () => look.tall);
  const gui = new GUI({ title: "coast" });
  gui.close();
  for (const k of Object.keys(look)) {
    const r = ranges[k];
    const values = look as unknown as Record<string, number>;
    if (r) gui.add(values, k, r[0], r[1], r[2]);
    else if (typeof values[k] === "string")
      gui.addColor(look as unknown as Record<string, string>, k);
    else gui.add(values, k);
  }
  // ---- the sun's two heights
  const bar = document.getElementById("bar");
  const buttons = [
    ...(bar?.querySelectorAll<HTMLButtonElement>("[data-sun]") ?? []),
  ];
  let turning: { from: typeof look; to: typeof look; since: number } | null =
    null;
  const turnTo = (name: string, at1 = performance.now()) => {
    const to = { ...look };
    for (const k of Object.keys(day))
      Object.assign(to, {
        [k]: (name === "day" ? day : low)[k as keyof typeof look],
      });
    turning = { from: { ...look }, to, since: at1 };
    for (const b of buttons)
      b.setAttribute("aria-pressed", String(b.dataset.sun === name));
  };
  const turn = () => {
    if (!turning) return;
    const x = Math.min(1, (performance.now() - turning.since) / 2600);
    const e = x * x * (3 - 2 * x);
    for (const k of Object.keys(day) as (keyof typeof look)[]) {
      const a = turning.from[k];
      const b = turning.to[k];
      Object.assign(look, {
        [k]:
          typeof a === "string"
            ? `#${new Color(a).lerp(new Color(b as string), e).getHexString()}`
            : (a as number) + ((b as number) - (a as number)) * e,
      });
    }
    if (x < 1) return;
    turning = null;
    for (const c of gui.controllersRecursive()) c.updateDisplay();
  };
  const press = (e: Event) => {
    const name = (e.currentTarget as HTMLElement).dataset.sun!;
    turnTo(name);
    history.replaceState(null, "", name === "day" ? "#day" : "#");
  };
  for (const b of buttons) b.addEventListener("click", press);
  // (a page that starts by day is there at once)
  if (location.hash === "#day") turnTo("day", -1e9);
  const stats = new Stats();
  stats.dom.id = "stats";
  document.body.appendChild(stats.dom);
  Object.assign(window, {
    __coast: { look, state, camera, controls, device, groundAt, LOOP },
  });
  const rgb = (c: string) => new Color(c).toArray();

  let last = "";
  let lastU = 0;
  let flip = 0; // which of the two foam buffers is the present one
  const tideAt = (u: number) => look.tide * Math.sin(2 * Math.PI * u);
  const makeGround = (encoder: GPUCommandEncoder, u: number) => {
    made.array.set([n, m, meta.keys, u - Math.floor(u)]);
    made.array.set([meta.lo, meta.hi, meta.most, SEA], 4);
    made.array.set([meta.slope, meta.toe, meta.bay, meta.D], 8);
    made.array.set([meta.x0, meta.shift, meta.block, meta.shelf], 12);
    made.array[16] = look.tall;
    device.queue.writeBuffer(made.buffer, 0, made.array);
    const pass = encoder.beginComputePass();
    pass.setPipeline(groundPipe);
    pass.setBindGroup(0, groundBind);
    pass.dispatchWorkgroups(Math.ceil(wide / 8), Math.ceil(m / 8));
    pass.end();
  };
  // run the water on by some ticks (or from rest, when it starts afresh)
  const runWater = (
    encoder: GPUCommandEncoder,
    count: number,
    afresh: boolean,
  ) => {
    // the ground was made for the first of them, and so is the place along the coast it is read at
    const lap = Math.floor(state.tick / TICKS / LOOP);
    for (let i = 0; i < count; i++) {
      const secs = (state.tick + i + 1) / TICKS;
      waterData.set(
        [
          WET,
          m,
          meta.dx,
          0.5 / TICKS,
          secs,
          tideAt(secs / LOOP),
          lap * meta.shift,
          meta.x0 - SEA * meta.dx,
        ],
        i * 64,
      );
    }
    device.queue.writeBuffer(waterBuffer, 0, waterData);
    const pass = encoder.beginComputePass();
    const run = (pipe: GPUComputePipeline, k: number, i: number) => {
      pass.setPipeline(pipe);
      pass.setBindGroup(0, waterBind[k], [i * 256]);
      pass.dispatchWorkgroups(Math.ceil(WET / 8), Math.ceil(m / 8));
    };
    if (afresh) {
      run(stillPipe, 0, 0);
      run(stillPipe, 1, 0);
    }
    for (let i = 0; i < count; i++) {
      // two steps bring the water back to the buffer it was in; the foam, stepped once, goes to the other
      run(flowPipe, 0, i);
      run(flowPipe, 1, i);
      pass.setPipeline(foamPipe);
      pass.setBindGroup(0, foamBind[flip], [i * 256]);
      pass.dispatchWorkgroups(Math.ceil(WET / 8), Math.ceil(m / 8));
      flip = 1 - flip;
    }
    pass.end();
    state.tick += count;
  };
  wrap.render = ({ playhead }) => {
    turn();
    fit();
    const w = target!.width;
    const h = target!.height;
    const u = state.hold >= 0 ? state.hold : look.play ? playhead : look.at;
    if (state.hold < 0 && look.play && u < lastU - 0.5) state.laps++;
    if (state.hold >= 0 || !look.play) state.laps = 0;
    // while it plays the bounced light is made anew by halves; all of it where the maps go back by a bay, or a moment is jumped to
    const on = u - lastU;
    const half =
      state.hold < 0 && look.play && on > 0 && on < 0.01 ? state.frame % 2 : -1;
    lastU = u;
    const narrow = Math.min(1, Math.max(0, (1.6 - w / h) / 0.6));
    const fov = look.free
      ? look.fov
      : look.fov + 3 * narrow + 16 * Math.max(0, 1 - w / h);
    if (look.free) controls.update();
    else {
      const way = 2 * Math.PI * u;
      camera.position.set(
        look.eyeX + look.sway * Math.sin(way),
        look.eyeY + look.sway * 0.3 * Math.sin(way + 1.4),
        look.eyeZ,
      );
      // where the picture is narrow, look more to the land, so that the person stays in it
      controls.target.set(
        look.aimX + 17 * narrow,
        look.aimY - 4 * narrow,
        look.aimZ,
      );
      camera.lookAt(controls.target);
    }
    camera.aspect = w / h;
    camera.fov = fov;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    const e = camera.matrixWorld.elements;
    const tan = Math.tan((fov * Math.PI) / 360);
    const az = (look.sunTurn * Math.PI) / 180;
    const el = (look.sunHeight * Math.PI) / 180;
    const sun = [
      Math.sin(az) * Math.cos(el),
      Math.sin(el),
      -Math.cos(az) * Math.cos(el),
    ];
    const who = walkAt(
      u,
      look.whoZ,
      { x: look.whoX, swing: look.swing, when: look.when },
      look.who,
      look.stride,
    );
    state.walk = who;
    const bend = 0.5 * look.curve * look.whoZ * look.whoZ;
    const tone = (c: string, k = 1) => rgb(c).map((v) => v * k);
    const a = frame.array;
    let slot = 0;
    const put = (...v: number[]) => {
      a.set(v, slot);
      slot += 4;
    };
    put(e[12], e[13], e[14], who.across);
    put(e[0], e[1], e[2], tan * camera.aspect);
    put(e[4], e[5], e[6], tan);
    put(-e[8], -e[9], -e[10], who.slope);
    put(w, h, 0, u);
    put(sun[0], sun[1], sun[2], Math.tan((look.sunWide * Math.PI) / 180));
    put(...tone(look.sunTone, look.sun), look.patches);
    put(meta.x0 - SEA * meta.dx, wide * meta.dx, m * meta.dx, meta.dx);
    put(meta.D * (state.laps + u), meta.D * u, look.curve, meta.D);
    put(
      (state.laps + u) * LOOP,
      tideAt(u),
      meta.x0 + (WET - SEA - 3) * meta.dx,
      3,
    );
    put(...tone(look.low), look.sky);
    put(...tone(look.side), look.clouds);
    put(...tone(look.mid), look.midUp);
    put(...tone(look.top), look.bounce);
    put(...tone(look.cool), look.coolness);
    put(...tone(look.sand), look.matte);
    put(...tone(look.water), look.choppy);
    put(
      look.haze,
      look.hazeThin,
      look.relief,
      meta.hi * Math.max(look.tall, 1) + 2,
    );
    put(look.mist, look.mistHigh, look.mistPatchy, look.mistSun);
    put(look.drift, look.driftFar, look.driftHigh, look.driftStreak);
    put(look.ripple, look.rippleWide, look.streak, look.speck);
    put(...tone(look.hills), look.hillsUp);
    put(who.x - bend, who.y, look.whoZ, look.who);
    put(who.step, who.lean, look.stride, who.turn);
    put(look.spray, ...tone(look.shallow));
    put(airStep(), half, 0, 0);
    for (let k = 0; k < 64; k += 4)
      put(...[0, 1, 2, 3].map((i) => wayAt((k + i) / 64)));

    // the water, brought to this moment: on by a tick or two, or from some way back when the moment was jumped to
    const due = Math.round((state.laps + u) * LOOP * TICKS);
    state.due = due;
    let moved = false;
    if (!begun || due < state.tick || due - state.tick > WARM) {
      state.tick = due - WARM;
      fresh = true;
      begun = true;
    }
    if (state.tick < due || fresh) {
      // (the sea floor is made from these numbers too, also before anything is drawn)
      device.queue.writeBuffer(frame.buffer, 0, frame.array);
      // the ground is made anew every other tick: moved in leaps, it stirs up foam that is not there otherwise
      for (
        let done = 0;
        done < RUSH && (state.tick < due || fresh);
        done += 2
      ) {
        const part = device.createCommandEncoder();
        makeGround(part, state.tick / TICKS / LOOP);
        runWater(part, Math.min(2, due - state.tick), fresh);
        device.queue.submit([part.finish()]);
        fresh = false;
      }
      moved = true;
    }
    // until the water is at this moment the picture stays as it is: its sea would lie on other ground
    if (state.tick < due) {
      state.still = 0;
      state.frame++;
      return;
    }
    draw(moved, u);
    if (veil && !veil.classList.contains("gone")) {
      veil.classList.add("gone");
      setTimeout(() => veil.remove(), 1500);
    }
  };
  // the part of the picture the person can be in
  const corner = new Vector3();
  const walkerPart = (): [number, number, number, number] | null => {
    const [x, y, z, tall] = frame.array.slice(22 * 4, 23 * 4);
    let x0 = 1e9;
    let x1 = -1e9;
    let y0 = 1e9;
    let y1 = -1e9;
    for (let k = 0; k < 8; k++) {
      corner.set(
        x + tall * (k & 1 ? 0.45 : -0.85),
        y + tall * (k & 2 ? 1.15 : -0.15),
        z + tall * (k & 4 ? 0.5 : -0.5),
      );
      if (corner.clone().applyMatrix4(camera.matrixWorldInverse).z > -0.2)
        return [0, 0, target!.width, target!.height];
      corner.project(camera);
      x0 = Math.min(x0, (corner.x * 0.5 + 0.5) * target!.width);
      x1 = Math.max(x1, (corner.x * 0.5 + 0.5) * target!.width);
      y0 = Math.min(y0, (0.5 - corner.y * 0.5) * target!.height);
      y1 = Math.max(y1, (0.5 - corner.y * 0.5) * target!.height);
    }
    const fit1 = (v: number, most: number) =>
      Math.min(most, Math.max(0, Math.round(v)));
    const a = fit1(x0 - 2, target!.width);
    const b = fit1(x1 + 2, target!.width);
    const c = fit1(y0 - 2, target!.height);
    const d = fit1(y1 + 2, target!.height);
    return b > a && d > c ? [a, c, b - a, d - c] : null;
  };
  let fresh = false;
  let begun = false;
  const draw = (moved: boolean, u: number) => {
    const a = frame.array;
    // anything that changes the picture starts the still again
    const key = a.join(" ");
    if (key !== last || moved) state.still = 0;
    last = key;
    const encoder = device.createCommandEncoder();
    if (state.still === 0) {
      device.queue.writeBuffer(frame.buffer, 0, a);
      if (hillsUp !== look.hillsUp) bake([hillsBake]);
      hillsUp = look.hillsUp;
      makeGround(encoder, u);
      const pass = encoder.beginComputePass();
      pass.setPipeline(layPipe);
      pass.setBindGroup(0, layBind[flip]);
      pass.dispatchWorkgroups(Math.ceil(wide / 8), Math.ceil(m / 8));
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
      const draw1 = (
        views: GPUTextureView[],
        pipe: GPURenderPipeline,
        group: GPUBindGroup,
        k = 1,
        loadOp: GPULoadOp = "clear",
        after?: (pass: GPURenderPassEncoder) => void,
      ) => {
        const pass = encoder.beginRenderPass({
          colorAttachments: views.map((view) => ({
            view,
            loadOp,
            storeOp: "store",
          })),
        });
        pass.setPipeline(pipe);
        pass.setBindGroup(0, group);
        pass.setBlendConstant([k, k, k, k]);
        pass.draw(3);
        after?.(pass);
        pass.end();
      };
      if (state.still === 0) draw1([castMap], castPipe, castBind);
      // the person in the same pass as the surface: in one of their own the whole picture is loaded and stored once more
      draw1([surfaceView], tracePipe, traceBind, 1, "clear", (pass) => {
        const part = walkerPart();
        if (!part) return;
        pass.setPipeline(walkerPipe);
        pass.setBindGroup(0, walkerBind);
        pass.setScissorRect(...part);
        pass.draw(3);
      });
      draw1(airViews, airPipe, airBind);
      draw1(
        [targetView],
        mixPipe,
        mixBind,
        1 / (state.still + 1),
        state.still === 0 ? "clear" : "load",
      );
      state.still++;
    }
    shown.array.set([
      canvas.width,
      canvas.height,
      look.exposure,
      state.frame % 61,
    ]);
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
    for (const b of buttons) b.removeEventListener("click", press);
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
