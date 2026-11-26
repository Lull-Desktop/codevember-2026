// A row of stone arches in a desert, one after another to the horizon. Before each one time runs away: the sun
// and the stars race over, clouds pour across, and the arch, smooth at first, is worn to lace. Then time slows, the
// eye goes through, and there is the next arch, smooth.
//
// The arches are all the same one, so the end of the loop is its beginning one arch further on. The worn arch is
// made whole again behind the eye. The sky has gone round a whole number of days, the clouds have come a whole
// number of repeats of their noise, and the ground repeats with the row.
//
// The rock is a grid of numbers, how full each cell is. A compute pass wears it from its surface inward
// (erode.wgsl), pieces that come loose are found (hold.wgsl) and fall apart, and each frame the grid is turned into
// triangles by marching cubes (march.wgsl). air.wgsl is the sky's light, clouds.wgsl the clouds, draw.wgsl the rest.
//
// ?n=352 sets the cells across the arch (304), ?grains= the grains of sand, ?corners= the room for triangles.
import type { Sketch, SketchSettings } from "ssam";
import { ssam } from "ssam";
import {
  Matrix4,
  PerspectiveCamera,
  Vector3,
  WebGPUCoordinateSystem,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import GUI from "three/examples/jsm/libs/lil-gui.module.min.js";
import Stats from "three/examples/jsm/libs/stats.module.js";
import { triTable } from "three/examples/jsm/objects/MarchingCubes.js";
import { scatter, sunlight, type V3 } from "./air";
import airCode from "./air.wgsl?raw";
import cloudCode from "./clouds.wgsl?raw";
import commonCode from "./common.wgsl?raw";
import drawCode from "./draw.wgsl?raw";
import erodeCode from "./erode.wgsl?raw";
import fieldCode from "./field.wgsl?raw";
import frameCode from "./frame.wgsl?raw";
import holdCode from "./hold.wgsl?raw";
import initCode from "./init.wgsl?raw";
import marchCode from "./march.wgsl?raw";
import puffCode from "./puff.wgsl?raw";
import sandCode from "./sand.wgsl?raw";
import showCode from "./show.wgsl?raw";
import skyCode from "./sky.wgsl?raw";
import wideCode from "./wide.wgsl?raw";

const query = new URLSearchParams(location.search);
const N = Math.max(64, Math.round(+(query.get("n") ?? 304) / 4) * 4); // cells across the arch
const MOST_CORNERS = +(query.get("corners") ?? 3.6e6); // room in the triangle list
const MOST_BORN = 4096; // places a step can report sand from
const GRAINS = +(query.get("grains") ?? 300000); // grains of sand in the air at most
const HOLDS = 24; // rounds a step gives to finding what still hangs on the arch
const MOST_SMOOTH = 1.5e6; // and in the list of the arch as it was
const SHADE = 4096; // size of the sun's map
const STEP = 1 / 60; // seconds a step stands for
const LOOP = 20; // seconds from one arch to the next
const PUFF = 96; // size of the clouds' noise

const look = {
  // the arch; the grid is sized for these at the start, so making it bigger later cuts it off
  outer: 1.2,
  inner: 0.7,
  spring: 0.95, // height the round part starts at
  spread: 0.16,
  deepFoot: 0.4,
  deepTop: 0.26,
  round: 0.1,
  yaw: 8,
  // the rock
  seed: 4,
  layers: 20,
  tilt: 0.08,
  warp: 0.07,
  warpScale: 1.3,
  cell: 0.28,
  squash: 1.5,
  grow: 0.85,
  wall: 0.14,
  bent: 0.75,
  fine: 0.45,
  fineSize: 0.42,
  small: 0.35,
  big: 1.05,
  join: 0.85,
  window: 0.6,
  shelf: 0.15,
  layerSoft: 0.2,
  rind: 0.04,
  massive: 0.6,
  blotch: 1.1,
  crust: 0.06,
  core: 0.15,
  coreReach: 0.12,
  // the wear
  rate: 0.32,
  power: 1.6,
  shelter: 1.5,
  crumbs: 0.3,
  windPull: 0.45,
  blast: 0.8,
  blastHigh: 0.35,
  uneven: 0.6,
  loose: 1,
  sandy: 10,
  slow: 0.0015,
  // the loop, as parts of it
  wearFrom: 0.04,
  wearTo: 0.63,
  walkFrom: 0.53,
  turnFrom: 0.5,
  turnTo: 0.82,
  creep: 1.1,
  step: 13, // forward to the next arch
  side: 1.3, // and sideways
  back: 5, // how far before the arch the eye starts
  sway: 0.2,
  eyeHigh: 0.5,
  lookHigh: 1.3,
  fov: 42,
  play: true,
  at: 0,
  free: false, // the mouse moves the eye
  // the sky
  days: 3,
  slowDays: 0.015,
  hour: -72,
  linger: 0.62, // where the sun is when time is slow, degrees from noon
  latitude: 26,
  sunDip: 4,
  trail: 1,
  stars: 2.2,
  moon: 1,
  cover: 0.53,
  dense: 2.2,
  tile: 2.6,
  cloudsAcross: 3,
  cloudsAlong: 12,
  // the mesh
  edge: 2,
  smooth: 1,
  // the light
  sun: 5.7,
  sky: 18,
  fill: 1,
  rim: 1,
  bounce: 0.5,
  haze: 0.011,
  ao: 1,
  patina: 0.6,
  nightLift: 0.9,
  // the ground
  dunes: 0.5,
  ripples: 0.28,
  bright: 0.75,
  piles: 1,
  // the sand
  wind: 0.9,
  swirl: 0.7,
  thick: 0.25, // how many of the grains that could start do
  grainSize: 0.0016,
  sandGlow: 1.3,
  grain: 0.2,
  lines: 0.45,
  shadowSoft: 1.3,
  exposure: 0.62,
  glow: 0.14,
  colour: 1.02,
  noise: 0.35,
  // the picture
  res: 1 / Math.min(window.devicePixelRatio, 2),
  show: 0, // 0 the picture, 1 openness, 2 normals, 3 light, 4 hardness of the layers
};
const ranges: Record<string, [number, number, number?]> = {
  outer: [0.8, 1.3],
  inner: [0.3, 0.9],
  spring: [0.4, 1.1],
  spread: [0, 0.2],
  deepFoot: [0.1, 0.5],
  deepTop: [0.1, 0.5],
  round: [0, 0.25],
  yaw: [-60, 60],
  seed: [1, 99, 1],
  layers: [3, 40],
  tilt: [0, 0.5],
  warp: [0, 0.3],
  warpScale: [0.3, 5],
  cell: [0.06, 0.5],
  squash: [0.5, 3],
  grow: [0, 1],
  wall: [0.01, 0.2],
  bent: [0, 1.5],
  fine: [0, 1],
  fineSize: [0.2, 0.8],
  small: [0.1, 1],
  big: [0.1, 1.2],
  join: [0.3, 1],
  window: [0.1, 1],
  shelf: [0, 1],
  layerSoft: [0, 1],
  rind: [0.005, 0.15],
  massive: [0, 1],
  blotch: [0.3, 5],
  crust: [0, 0.15],
  core: [0, 1],
  coreReach: [0.02, 0.4],
  rate: [0, 1],
  power: [0.5, 4],
  shelter: [0, 5],
  crumbs: [0, 2],
  windPull: [0, 1],
  blast: [0, 3],
  blastHigh: [0.05, 1.5],
  uneven: [0, 0.8],
  loose: [0, 3],
  sandy: [0, 12],
  slow: [0, 0.05],
  wearFrom: [0, 0.5],
  wearTo: [0.3, 0.9],
  walkFrom: [0.2, 0.9],
  turnFrom: [0.2, 0.9],
  turnTo: [0.4, 1],
  creep: [0, 4],
  step: [8, 24],
  side: [-6, 6],
  back: [3, 8],
  sway: [-4, 4],
  eyeHigh: [0.1, 2],
  lookHigh: [0, 3],
  fov: [20, 80],
  at: [0, 1],
  days: [1, 6, 1],
  slowDays: [0, 0.2],
  hour: [-180, 180],
  linger: [0, 0.95],
  latitude: [0, 70],
  sunDip: [-30, 60],
  trail: [0, 4],
  stars: [0, 4],
  moon: [0, 4],
  cover: [0, 1],
  dense: [0, 5],
  tile: [0.5, 8],
  cloudsAcross: [-12, 12, 3],
  cloudsAlong: [-30, 30, 3],
  edge: [1, 4],
  smooth: [0, 1],
  sun: [0, 12],
  sky: [0, 40],
  fill: [0, 3],
  rim: [0, 4],
  bounce: [0, 2],
  haze: [0, 0.1],
  ao: [0, 1],
  patina: [0, 1],
  nightLift: [0, 4],
  dunes: [0, 2],
  ripples: [0, 1],
  bright: [0.2, 1.5],
  piles: [0, 2],
  wind: [0, 3],
  swirl: [0, 3],
  thick: [0, 1],
  grainSize: [0.0005, 0.01],
  sandGlow: [0, 4],
  grain: [0, 1],
  lines: [0, 1],
  shadowSoft: [0.3, 4],
  exposure: [0.2, 3],
  glow: [0, 1],
  colour: [0, 2],
  noise: [0, 2],
  res: [0.25, 1],
  show: [0, 4, 1],
};
// changing any of these makes the rock anew, from the first step
const MAKING = [
  "outer",
  "inner",
  "spring",
  "spread",
  "deepFoot",
  "deepTop",
  "round",
  "seed",
  "layers",
  "tilt",
  "warp",
  "warpScale",
  "cell",
  "squash",
  "grow",
  "wall",
  "bent",
  "fine",
  "fineSize",
  "small",
  "big",
  "join",
  "window",
  "shelf",
  "layerSoft",
  "rind",
  "massive",
  "blotch",
  "crust",
  "core",
  "coreReach",
  "edge",
];

const ROWS = 130; // as in draw.wgsl: rows of the ground from one arch to the next
const COLS = 300;
const ARCHES = 6; // in the row

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
// from 0 to 1 with no jolt at either end; `pace` is how fast it goes (mean 1)
const ease = (x: number) => {
  const t = clamp01(x);
  return t - Math.sin(2 * Math.PI * t) / (2 * Math.PI);
};
// the same with an even run between a slow start and a slow stop, each a part `R` of the whole
const R = 0.28;
const glide = (x: number) => {
  const t = clamp01(x);
  if (t > 0.5) return 1 - half(1 - t);
  return half(t);
};
const half = (t: number) => {
  const s = Math.min(t / R, 1);
  return (R * (s ** 3 - s ** 4 / 2) + Math.max(0, t - R)) / (1 - R);
};
const glidePace = (x: number) =>
  x <= 0 || x >= 1 ? 0 : (smooth(0, R, x) * smooth(0, R, 1 - x)) / (1 - R);

const sketch: Sketch<"webgpu"> = async ({ wrap, canvas }) => {
  if (import.meta.hot) {
    import.meta.hot.dispose(() => wrap.dispose());
    import.meta.hot.accept(() => wrap.hotReload());
  }
  const adapter = await navigator.gpu?.requestAdapter({
    powerPreference: "high-performance",
  });
  if (!adapter) throw new Error("WebGPU is not available");

  // the grid: a box round the arch with three cells to spare on every side, and a little under the ground
  const wide = 2 * (look.outer + look.spread * 1.2);
  const size = wide / (N - 6);
  const NY = Math.ceil(((look.spring + look.outer) / size + 12) / 4) * 4;
  const NZ = Math.ceil((2 * look.deepFoot) / size / 4 + 2) * 4;
  const count = N * NY * NZ;
  const coarse = [N / 4, NY / 4, NZ / 4];
  const low = [(-N * size) / 2, -8 * size, (-NZ * size) / 2];

  // the triangle list is the biggest thing here; make it as long as the device lets a shader see
  const timing = adapter.features.has("timestamp-query");
  const most = Math.min(
    adapter.limits.maxStorageBufferBindingSize,
    adapter.limits.maxBufferSize,
  );
  const corners = Math.floor(Math.min(MOST_CORNERS, most / 32) / 3) * 3;
  if (count * 8 > most)
    throw new Error(`a grid of ${N} is too big for this device`);
  const device = await adapter.requestDevice({
    requiredFeatures: timing ? ["timestamp-query"] : [],
    requiredLimits: {
      maxStorageBufferBindingSize: Math.max(corners * 32, count * 8),
      maxBufferSize: Math.max(corners * 32, count * 8),
    },
  });
  const context = canvas.getContext("webgpu")!;
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: "opaque" });

  // ---- buffers
  const STORE = GPUBufferUsage.STORAGE;
  const params = new Float32Array(15 * 4);
  const paramsBuffer = device.createBuffer({
    size: params.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const frame = new Float32Array(16 * 3 + 23 * 4);
  const frameBuffer = device.createBuffer({
    size: frame.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const shown = new Float32Array(8);
  const shownBuffer = device.createBuffer({
    size: shown.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const madeBuffer = device.createBuffer({ size: count * 8, usage: STORE });
  // the rock, twice: a step reads one and writes the other
  const rockBuffers = [0, 1].map(() =>
    device.createBuffer({
      size: count * 4,
      usage: STORE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    }),
  );
  // the rock as it was at the start, to begin again from
  const wholeBuffer = device.createBuffer({
    size: count * 4,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  });
  const fieldBuffer = device.createBuffer({ size: count * 4, usage: STORE });
  const coarseCount = coarse[0] * coarse[1] * coarse[2];
  const roughBuffer = device.createBuffer({
    size: coarseCount * 4,
    usage: STORE,
  });
  const wideBuffer = device.createBuffer({
    size: coarseCount * 4,
    usage: STORE,
  });
  const casesBuffer = device.createBuffer({
    size: 256 * 16 * 4,
    usage: STORE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(casesBuffer, 0, triTable as Int32Array<ArrayBuffer>);
  const listBuffer = device.createBuffer({
    size: corners * 32,
    usage: STORE | GPUBufferUsage.VERTEX,
  });
  const smoothCorners = Math.floor(Math.min(MOST_SMOOTH, most / 32) / 3) * 3;
  const smoothList = device.createBuffer({
    size: smoothCorners * 32,
    usage: STORE | GPUBufferUsage.VERTEX,
  });
  const smoothDraw = device.createBuffer({
    size: 16,
    usage:
      STORE |
      GPUBufferUsage.INDIRECT |
      GPUBufferUsage.COPY_SRC |
      GPUBufferUsage.COPY_DST,
  });
  // counters the shaders share: corners written, sand reported
  const tallyBuffer = device.createBuffer({
    size: 16,
    usage: STORE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  });
  const drawBuffer = device.createBuffer({
    size: 16,
    usage: STORE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_SRC,
  });
  // what holds the rock up, twice, as each round reads one and writes the other
  const halves = [N / 2, NY / 2, NZ / 2];
  const halfCount = halves[0] * halves[1] * halves[2];
  const lumpsBuffer = device.createBuffer({
    size: halfCount * 4,
    usage: STORE,
  });
  const holdBuffers = [0, 1].map(() =>
    device.createBuffer({
      size: halfCount * 4,
      usage: STORE | GPUBufferUsage.COPY_DST,
    }),
  );
  const grainsBuffer = device.createBuffer({
    size: GRAINS * 32,
    usage: STORE | GPUBufferUsage.COPY_DST,
  });
  const bornBuffer = device.createBuffer({
    size: MOST_BORN * 16,
    usage: STORE,
  });
  const readBuffer = device.createBuffer({
    size: 16 + 8 * 8,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  });
  // times of the passes, where the device can tell them: a step of the wear with its fields (the coarse one, the
  // smoothed one, what holds), the marching cubes, the sun's map, the picture
  const clock = timing
    ? device.createQuerySet({ type: "timestamp", count: 8 })
    : null;
  const clockBuffer = device.createBuffer({
    size: 8 * 8,
    usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
  });
  const timed = (slot: number, begin = true, end = true) =>
    clock
      ? {
          timestampWrites: {
            querySet: clock,
            beginningOfPassWriteIndex: begin ? slot * 2 : undefined,
            endOfPassWriteIndex: end ? slot * 2 + 1 : undefined,
          },
        }
      : {};

  // ---- shaders
  const wideAt = (wide: number, held: number) =>
    wideCode
      .replace("@binding(WIDE)", `@binding(${wide})`)
      .replace("@binding(HELD)", `@binding(${held})`);
  const sources: Record<string, string> = {
    init: commonCode + initCode,
    erode: commonCode + wideAt(4, 7) + erodeCode,
    field: commonCode + fieldCode,
    hold: commonCode + holdCode,
    march: commonCode + wideAt(3, 8) + marchCode,
    draw: commonCode + frameCode + skyCode + drawCode,
    air: commonCode + frameCode + airCode,
    clouds: commonCode + frameCode + skyCode + cloudCode,
    puff: puffCode,
    sand: commonCode + frameCode + sandCode,
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

  const initPipe = compute("init", "init");
  const erodePipe = compute("erode", "erode");
  const gatherPipe = compute("field", "gather");
  const blurPipe = compute("field", "blur");
  const softenPipe = compute("field", "soften");
  const marchPipe = compute("march", "march");
  const finishPipe = compute("march", "finish");
  const lumpPipe = compute("hold", "lump");
  const holdPipe = compute("hold", "hold");
  const driftPipe = compute("sand", "drift");

  const initBind = bind(initPipe, [
    [0, paramsBuffer],
    [1, madeBuffer],
    [2, rockBuffers[0]],
    [3, rockBuffers[1]],
  ]);
  // one set for each direction of a step
  const erodeBind = [0, 1].map((k) =>
    bind(erodePipe, [
      [0, paramsBuffer],
      [1, madeBuffer],
      [2, rockBuffers[k]],
      [3, rockBuffers[1 - k]],
      [4, wideBuffer],
      [5, bornBuffer],
      [6, tallyBuffer],
      [7, holdBuffers[0]],
    ]),
  );
  const gatherBind = [0, 1].map((k) =>
    bind(gatherPipe, [
      [0, paramsBuffer],
      [1, rockBuffers[k]],
      [2, roughBuffer],
    ]),
  );
  const blurBind = bind(blurPipe, [
    [0, paramsBuffer],
    [3, roughBuffer],
    [4, wideBuffer],
  ]);
  const softenBind = [0, 1].map((k) =>
    bind(softenPipe, [
      [0, paramsBuffer],
      [5, rockBuffers[k]],
      [6, fieldBuffer],
    ]),
  );
  const marchBind = bind(marchPipe, [
    [0, paramsBuffer],
    [1, fieldBuffer],
    [2, madeBuffer],
    [3, wideBuffer],
    [4, casesBuffer],
    [5, listBuffer],
    [6, tallyBuffer],
    [8, holdBuffers[0]],
  ]);
  const holdBind = [0, 1].map((k) =>
    bind(holdPipe, [
      [0, paramsBuffer],
      [2, lumpsBuffer],
      [3, holdBuffers[k]],
      [4, holdBuffers[1 - k]],
    ]),
  );
  const lumpBind = bind(lumpPipe, [
    [0, paramsBuffer],
    [1, fieldBuffer],
    [2, lumpsBuffer],
  ]);
  const driftBind = bind(driftPipe, [
    [1, frameBuffer],
    [2, grainsBuffer],
    [3, bornBuffer],
    [4, tallyBuffer],
  ]);
  const finishBind = bind(finishPipe, [
    [5, listBuffer],
    [6, tallyBuffer],
    [7, drawBuffer],
  ]);
  // the same, for the arch as it was
  const smoothMarch = bind(marchPipe, [
    [0, paramsBuffer],
    [1, fieldBuffer],
    [2, madeBuffer],
    [3, wideBuffer],
    [4, casesBuffer],
    [5, smoothList],
    [6, tallyBuffer],
    [8, holdBuffers[0]],
  ]);
  const smoothFinish = bind(finishPipe, [
    [5, smoothList],
    [6, tallyBuffer],
    [7, smoothDraw],
  ]);

  const corner: GPUVertexBufferLayout = {
    arrayStride: 32,
    attributes: [
      { shaderLocation: 0, offset: 0, format: "float32x4" },
      { shaderLocation: 1, offset: 16, format: "float32x4" },
    ],
  };
  const SAMPLES = 4;
  const depthOf = (
    write: boolean,
    compare: GPUCompareFunction,
  ): GPUDepthStencilState => ({
    format: "depth32float",
    depthWriteEnabled: write,
    depthCompare: compare,
  });
  const over: GPUBlendState = {
    color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha" },
    alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
  };
  const added: GPUBlendState = {
    color: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
    alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
  };
  const drawing = (
    vert: string,
    frag: string,
    depthStencil: GPUDepthStencilState,
    blend?: GPUBlendState,
    buffers: GPUVertexBufferLayout[] = [],
  ) =>
    device.createRenderPipeline({
      layout: "auto",
      vertex: { module: modules.draw, entryPoint: vert, buffers },
      fragment: {
        module: modules.draw,
        entryPoint: frag,
        targets: [{ format: "rgba16float", blend }],
      },
      primitive: { cullMode: "none" },
      depthStencil,
      multisample: { count: SAMPLES },
    });
  const skyPipe = drawing("skyVert", "skyFrag", depthOf(false, "less-equal"));
  const landPipe = drawing("landVert", "landFrag", depthOf(true, "less"));
  const rockPipe = drawing(
    "rockVert",
    "rockFrag",
    depthOf(true, "less"),
    undefined,
    [corner],
  );
  const farPipe = drawing("farVert", "rockFrag", depthOf(true, "less"), over, [
    corner,
  ]);
  const sandPipe = drawing(
    "sandVert",
    "sandFrag",
    depthOf(false, "less"),
    added,
  );
  const shading = (vert: string) =>
    device.createRenderPipeline({
      layout: "auto",
      vertex: { module: modules.draw, entryPoint: vert, buffers: [corner] },
      primitive: { cullMode: "none" },
      depthStencil: {
        format: "depth32float",
        depthWriteEnabled: true,
        depthCompare: "less",
        depthBias: 2,
        depthBiasSlopeScale: 2,
      },
    });
  const shadePipe = shading("shadeVert");
  const shadeFarPipe = shading("shadeFarVert");
  const full = (
    module: string,
    frag: string,
    out: GPUTextureFormat,
    blend?: GPUBlendState,
  ) =>
    device.createRenderPipeline({
      layout: "auto",
      vertex: { module: modules[module], entryPoint: "vert" },
      fragment: {
        module: modules[module],
        entryPoint: frag,
        targets: [{ format: out, blend }],
      },
    });
  const airPipe = full("air", "frag", "rgba16float");
  const cloudPipe = full("clouds", "frag", "rgba16float");
  const downPipe = full("show", "down", "rgba16float");
  const upPipe = full("show", "up", "rgba16float", {
    color: { srcFactor: "one", dstFactor: "one" },
    alpha: { srcFactor: "one", dstFactor: "one" },
  });
  const showPipe = full("show", "frag", format);

  const shadeMap = device.createTexture({
    size: [SHADE, SHADE],
    format: "depth32float",
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });
  const shadeView = shadeMap.createView();
  const airMap = device
    .createTexture({
      size: [256, 160],
      format: "rgba16float",
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    })
    .createView();
  const puff = device
    .createTexture({
      size: [PUFF, PUFF, PUFF],
      dimension: "3d",
      format: "rgba8unorm",
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
    })
    .createView();
  const soft = device.createSampler({
    magFilter: "linear",
    minFilter: "linear",
  });
  const round = device.createSampler({
    magFilter: "linear",
    minFilter: "linear",
    addressModeU: "repeat",
    addressModeV: "repeat",
    addressModeW: "repeat",
  });
  // round the horizon it repeats, up and down it does not
  const airLook = device.createSampler({
    magFilter: "linear",
    minFilter: "linear",
    addressModeU: "repeat",
  });
  const compare = device.createSampler({
    compare: "less",
    magFilter: "linear",
    minFilter: "linear",
  });
  {
    const pipe = compute("puff", "bake");
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipe);
    pass.setBindGroup(0, bind(pipe, [[0, puff]]));
    pass.dispatchWorkgroups(PUFF / 4, PUFF / 4, PUFF / 4);
    pass.end();
    device.queue.submit([encoder.finish()]);
  }
  const shadeBind = bind(shadePipe, [[1, frameBuffer]]);
  const shadeFarBind = bind(shadeFarPipe, [[1, frameBuffer]]);
  const airBind = bind(airPipe, [[1, frameBuffer]]);
  const cloudBind = bind(cloudPipe, [
    [1, frameBuffer],
    [2, puff],
    [3, round],
    [8, airMap],
    [9, airLook],
  ]);
  const sandBind = bind(sandPipe, [
    [1, frameBuffer],
    [2, shadeView],
    [4, grainsBuffer],
  ]);
  const lit: [number, GPUBuffer | GPUTextureView | GPUSampler][] = [
    [0, paramsBuffer],
    [1, frameBuffer],
    [2, shadeView],
    [3, compare],
    [8, airMap],
    [9, airLook],
  ];
  const landBind = bind(landPipe, lit);
  const rockBind = bind(rockPipe, lit);
  const farBind = bind(farPipe, lit);

  // the picture is drawn with four samples a pixel, then made one, then put on the screen
  let many: GPUTexture | null = null;
  let one: GPUTexture | null = null;
  let depth: GPUTexture | null = null;
  let showBind: GPUBindGroup | null = null;
  let skyBind: GPUBindGroup | null = null;
  let clouds: GPUTexture | null = null;
  // the glow's pictures, each half the one before, and what is needed to go down them and up again
  let glows: GPUTexture[] = [];
  let glowViews: GPUTextureView[] = [];
  let downs: GPUBindGroup[] = [];
  let ups: GPUBindGroup[] = [];
  const fit = () => {
    const w = Math.max(16, Math.round(canvas.width * look.res));
    const h = Math.max(16, Math.round(canvas.height * look.res));
    if (one && one.width === w && one.height === h) return;
    for (const t of [many, one, depth, clouds, ...glows]) t?.destroy();
    const picture = (
      pw: number,
      ph: number,
      sampleCount = 1,
      f: GPUTextureFormat = "rgba16float",
    ) =>
      device.createTexture({
        size: [pw, ph],
        format: f,
        sampleCount,
        usage:
          sampleCount > 1
            ? GPUTextureUsage.RENDER_ATTACHMENT
            : GPUTextureUsage.RENDER_ATTACHMENT |
              GPUTextureUsage.TEXTURE_BINDING,
      });
    many = picture(w, h, SAMPLES);
    one = picture(w, h);
    depth = picture(w, h, SAMPLES, "depth32float");
    clouds = picture(Math.floor(w / 2), Math.floor(h / 2));
    glows = [];
    for (let k = 1; k <= 6; k++)
      glows.push(picture(Math.max(1, w >> k), Math.max(1, h >> k)));
    glowViews = glows.map((t) => t.createView());
    const oneView = one.createView();
    downs = glowViews.map((_, k) =>
      bind(downPipe, [
        [1, k ? glowViews[k - 1] : oneView],
        [2, soft],
      ]),
    );
    ups = glowViews.slice(1).map((view) =>
      bind(upPipe, [
        [1, view],
        [2, soft],
      ]),
    );
    skyBind = bind(skyPipe, [
      [1, frameBuffer],
      [5, clouds.createView()],
      [8, airMap],
      [9, airLook],
    ]);
    showBind = bind(showPipe, [
      [0, shownBuffer],
      [1, oneView],
      [2, soft],
      [3, glowViews[0]],
    ]);
  };

  const camera = new PerspectiveCamera(30, 1, 0.03, 200);
  camera.coordinateSystem = WebGPUCoordinateSystem;
  camera.position.set(1, 0.6, 5);
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 1, 0);
  controls.enableDamping = true;
  controls.update();

  const state = {
    frame: 0,
    step: 0, // steps of wear taken
    hold: -1, // a moment of the loop to stay at, for the tools
    due: 0, // the step the moment asks for
    at: 0, // the moment of the loop
    cells: [N, NY, NZ],
    size,
    corners: 0, // corners in the triangle list of the last frame read back
    room: corners,
    sand: 0,
    smooth: 0, // corners of the arch as it was
    ms: { step: 0, mesh: 0, shadow: 0, picture: 0, frame: 0 },
    timing,
  };

  const turn = new Matrix4();
  const unturn = new Matrix4();
  const wind = new Vector3();
  // the wear takes one step for each sixtieth of a second between its two moments; they grow and shrink in strength
  const STEPS = () => Math.round((look.wearTo - look.wearFrom) * LOOP * 60);
  const writeParams = (step: number) => {
    const through = step / STEPS();
    turn.makeRotationY((look.yaw * Math.PI) / 180);
    unturn.copy(turn).invert();
    wind.set(1, 0.1, -0.35).normalize().transformDirection(unturn);
    params.set([N, NY, NZ, size], 0);
    params.set([low[0], low[1], low[2], step], 4);
    params.set([look.outer, look.inner, look.spring, look.spread], 8);
    params.set([look.deepFoot, look.deepTop, look.round, look.seed], 12);
    params.set([look.layers, look.tilt, look.warp, look.warpScale], 16);
    params.set([look.cell, look.squash, look.grow, look.wall], 20);
    params.set([look.layerSoft, look.massive, look.blotch, look.crust], 24);
    params.set([look.rate, look.power, look.shelter, look.crumbs], 28);
    params.set(
      [glide(through), glidePace(through), look.uneven, look.blast],
      32,
    );
    params.set([look.windPull, look.blastHigh, look.core, look.coreReach], 36);
    params.set([wind.x, wind.y, wind.z, look.rind], 40);
    params.set([look.edge, look.smooth, look.slow, 0], 44);
    params.set([look.small, look.join, look.shelf, look.big], 48);
    params.set([look.bent, look.window, look.loose, look.sandy], 52);
    params.set([look.fineSize, look.fine, 0, 0], 56);
    device.queue.writeBuffer(paramsBuffer, 0, params);
  };

  const groups = (n: number[]) =>
    n.map((v) => Math.ceil(v / 4)) as [number, number, number];
  // the fields made from the rock in buffer k: how much rock is around, the smoothed rock, what still hangs on
  const survey = (encoder: GPUCommandEncoder, k: number, time = false) => {
    const pass = encoder.beginComputePass(time ? timed(0, false, true) : {});
    pass.setPipeline(gatherPipe);
    pass.setBindGroup(0, gatherBind[k]);
    pass.dispatchWorkgroups(...groups(coarse));
    pass.setPipeline(blurPipe);
    pass.setBindGroup(0, blurBind);
    pass.dispatchWorkgroups(...groups(coarse));
    // an even number of rounds, so the answer ends in the buffer the wear reads
    pass.setPipeline(softenPipe);
    pass.setBindGroup(0, softenBind[k]);
    pass.dispatchWorkgroups(...groups([N, NY, NZ]));
    pass.setPipeline(lumpPipe);
    pass.setBindGroup(0, lumpBind);
    pass.dispatchWorkgroups(...groups(halves));
    pass.setPipeline(holdPipe);
    for (let i = 0; i < HOLDS; i++) {
      pass.setBindGroup(0, holdBind[i % 2]);
      pass.dispatchWorkgroups(...groups(halves));
    }
    pass.end();
  };
  let now = 0; // which of the two rock buffers is the present one
  let meshed = -1; // the step the triangle list was made at
  let meshedWith = 1;
  const everHeld = new Float32Array(halfCount).fill(1);
  const noGrains = new Float32Array(GRAINS * 8);
  // the arch whole again: at the start of each loop
  const again = () => {
    writeParams(0);
    for (const b of holdBuffers) device.queue.writeBuffer(b, 0, everHeld);
    device.queue.writeBuffer(grainsBuffer, 0, noGrains);
    const encoder = device.createCommandEncoder();
    encoder.copyBufferToBuffer(wholeBuffer, 0, rockBuffers[0], 0, count * 4);
    survey(encoder, 0);
    device.queue.submit([encoder.finish()]);
    now = 0;
    state.step = 0;
    meshed = -1;
  };
  // the rock worked out anew, and the mesh of it as it is at first
  const make = () => {
    writeParams(0);
    for (const b of holdBuffers) device.queue.writeBuffer(b, 0, everHeld);
    device.queue.writeBuffer(tallyBuffer, 0, new Uint32Array(4));
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(initPipe);
    pass.setBindGroup(0, initBind);
    pass.dispatchWorkgroups(...groups([N, NY, NZ]));
    pass.end();
    encoder.copyBufferToBuffer(rockBuffers[0], 0, wholeBuffer, 0, count * 4);
    survey(encoder, 0);
    const mesh = encoder.beginComputePass();
    mesh.setPipeline(marchPipe);
    mesh.setBindGroup(0, smoothMarch);
    mesh.dispatchWorkgroups(...groups([N, NY, NZ]));
    mesh.setPipeline(finishPipe);
    mesh.setBindGroup(0, smoothFinish);
    mesh.dispatchWorkgroups(1);
    mesh.end();
    device.queue.submit([encoder.finish()]);
    // it is drawn once for each arch further on
    device.queue.writeBuffer(smoothDraw, 4, new Uint32Array([ARCHES - 1]));
    again();
  };
  const stepOnce = (time: boolean) => {
    state.step++;
    writeParams(state.step);
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass(time ? timed(0, true, false) : {});
    pass.setPipeline(erodePipe);
    pass.setBindGroup(0, erodeBind[now]);
    pass.dispatchWorkgroups(...groups([N, NY, NZ]));
    pass.end();
    now = 1 - now;
    survey(encoder, now, time);
    device.queue.submit([encoder.finish()]);
  };
  make();

  const refresh = (key?: string) => {
    if (!key || MAKING.includes(key)) make();
  };
  const gui = new GUI({ title: "arches" });
  gui.close();
  for (const k of Object.keys(look)) {
    const r = ranges[k];
    const values = look as unknown as Record<string, number>;
    if (r) gui.add(values, k, r[0], r[1], r[2]).onChange(() => refresh(k));
    else gui.add(values, k).onChange(() => refresh(k));
  }
  gui.add({ again: () => make() }, "again");
  const stats = new Stats();
  stats.dom.id = "stats";
  document.body.appendChild(stats.dom);
  Object.assign(window, {
    __arch: { look, state, refresh, make, camera, controls, device, LOOP },
  });

  const eye = new Vector3();
  const aim = new Vector3();
  const lightView = new Matrix4();
  const lightBox = new Matrix4();
  const viewing = new Matrix4();
  const V = (v: Vector3): V3 => [v.x, v.y, v.z];
  const times = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
  const plus = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  let reading = false;
  let lastTime = 0;
  let lastTick = 0;

  // where time has got to in the sky, 0 … 1 over the loop: slow at both ends, racing between
  const skyAt = (u: number) => {
    const k = look.slowDays / look.days;
    return (
      k * u +
      (1 - k) * glide((u - look.wearFrom) / (look.wearTo - look.wearFrom))
    );
  };
  const skyPace = (u: number) => {
    const k = look.slowDays / look.days;
    const span = look.wearTo - look.wearFrom;
    return k + ((1 - k) / span) * glidePace((u - look.wearFrom) / span);
  };
  const place = (u: number) => {
    // forward: creeping while it looks, then through and on
    const z =
      look.back -
      look.creep * u -
      (look.step - look.creep) *
        ease((u - look.walkFrom) / (1 - look.walkFrom));
    // swinging out to the side between two arches, straight through the middle of each
    const swing = 0.5 - 0.5 * Math.cos((2 * Math.PI * z) / look.step);
    const x = (-look.side * z) / look.step + look.sway * swing;
    eye.set(x, look.eyeHigh + 0.2 * (1 - swing), z);
    const q = ease((u - look.turnFrom) / (look.turnTo - look.turnFrom));
    aim.set(look.side * q, look.lookHigh - 0.35 * (1 - swing), -look.step * q);
  };

  wrap.render = ({ playhead }) => {
    fit();
    const w = one!.width;
    const h = one!.height;
    const u = state.hold >= 0 ? state.hold : look.play ? playhead : look.at;
    state.at = u;
    const secs = u * LOOP;
    place(u);
    if (look.free) controls.update();
    else {
      camera.position.copy(eye);
      camera.lookAt(aim);
      controls.target.copy(aim);
    }
    camera.aspect = w / h;
    // in a narrow window the view opens up, so the arch still fits across it
    camera.fov =
      (Math.atan(
        Math.tan((look.fov * Math.PI) / 360) * Math.max(1, 1.1 / camera.aspect),
      ) *
        360) /
      Math.PI;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();

    // the wear, brought up to this moment; when the loop has begun again, from the whole arch
    const due = Math.round(
      clamp01((u - look.wearFrom) / (look.wearTo - look.wearFrom)) * STEPS(),
    );
    state.due = due;
    if (due < state.step) again();
    const steps = Math.min(due - state.step, state.hold >= 0 ? 30 : 6);
    device.queue.writeBuffer(tallyBuffer, 0, new Uint32Array(4));
    for (let i = 0; i < steps; i++) stepOnce(i === steps - 1);
    writeParams(state.step);

    // ---- the sky
    const rad = Math.PI / 180;
    const sky = skyAt(u);
    const round = look.hour * rad + sky * look.days * 2 * Math.PI;
    // the sun lingers at the horizon and hurries through noon and midnight; the stars go evenly
    const hour = round + 0.5 * look.linger * Math.sin(2 * round);
    const lat = look.latitude * rad;
    const pole: V3 = [0, Math.sin(lat), -Math.cos(lat)];
    const mid: V3 = [0, Math.cos(lat), Math.sin(lat)];
    // something on the sky at an hour angle and a height above its equator
    const onSky = (hr: number, dec: number): V3 =>
      plus(
        plus(times(mid, Math.cos(hr) * Math.cos(dec)), [
          -Math.sin(hr) * Math.cos(dec),
          0,
          0,
        ]),
        times(pole, Math.sin(dec)),
      );
    const sun = onSky(hour, look.sunDip * rad);
    // the moon goes round with the sky too, nearly opposite the sun
    const moon = onSky(hour + 186 * rad, -14 * rad);
    // The sky turns so fast that a real dusk would be over in a frame or two. Once it is down, the sun the light
    // is worked out from sinks three times slower.
    const down = Math.asin(sun[1]);
    const held = down < 0 ? Math.sin(down * 0.3) : sun[1];
    const flatter = Math.sqrt(
      (1 - held * held) / Math.max(1e-6, 1 - sun[1] * sun[1]),
    );
    const glow: V3 = [sun[0] * flatter, held, sun[2] * flatter];
    const night = smooth(-0.02, -0.32, sun[1]);
    const dark = smooth(0.2, -0.2, sun[1]); // and how far the eye has got used to it
    const moonUp = smooth(-0.02, 0.3, moon[1]) * smooth(-0.06, -0.32, sun[1]);
    const day = sun[1] > -0.05;
    const light = day ? sun : moon;
    const direct = times(
      sunlight(glow, 0.5),
      look.sun * smooth(-0.03, 0.13, sun[1]),
    );
    const moonTone: V3 = [0.56, 0.74, 1];
    const glare = day ? direct : times(moonTone, 1.0 * look.moon * moonUp);
    // clouds stand high and keep the sun a little longer
    const lifted: V3 = [glow[0], glow[1] + 0.03, glow[2]];
    const cloudTone = day
      ? times(sunlight(lifted, 4), look.sun * 0.6 * smooth(-0.05, 0.0, sun[1]))
      : times(moonTone, 0.2 * look.moon * moonUp);
    const airFrom = (d: V3): V3 => {
      const len = Math.hypot(...d);
      const n = times(d, 1 / len);
      const a = times(scatter(n, glow), look.sky);
      const b = scatter(n, moon);
      const m = look.sky * moonUp * look.moon * 0.01;
      const base: V3 = [0.03 * dark, 0.048 * dark, 0.085 * dark];
      return plus(
        plus(a, [b[0] * m * 0.7, b[1] * m * 0.9, b[2] * m * 1.25]),
        base,
      );
    };
    const flat = Math.hypot(light[0], light[2]) || 1;
    const lx = light[0] / flat;
    const lz = light[2] / flat;
    const mean = (ds: V3[]) =>
      times(ds.map(airFrom).reduce(plus), look.fill / ds.length);
    const high = mean([
      [0, 1, 0],
      [lx, 1.2, lz],
      [-lx, 1.2, -lz],
      [lz, 0.8, -lx],
      [-lz, 0.8, lx],
    ]);
    const near = mean([
      [lx, 0.15, lz],
      [lx, 0.5, lz],
    ]);
    const away = mean([
      [-lx, 0.15, -lz],
      [-lx, 0.5, -lz],
    ]);
    // how far the sky turns while one frame is open: the length of a star's trail
    const speed = (skyPace(u) * look.days * 2 * Math.PI) / LOOP;
    const trail = 0.0004 + speed * 0.06 * look.trail;

    // what the light sees: a ball round the part of the row that can be near the eye
    const reach = 19;
    const cx = (look.side * 12) / look.step;
    const centre = new Vector3(cx, 0.5, -12);
    const from = new Vector3(...light).multiplyScalar(40).add(centre);
    lightView.identity().lookAt(from, centre, camera.up);
    lightView.setPosition(from).invert();
    lightBox
      .makeOrthographic(
        -reach,
        reach,
        reach,
        -reach,
        15,
        65,
        WebGPUCoordinateSystem,
      )
      .multiply(lightView);

    const e = camera.matrixWorld.elements;
    const tan = Math.tan((camera.fov * Math.PI) / 360);
    viewing.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    );
    frame.set(viewing.elements, 0);
    frame.set(lightBox.elements, 16);
    frame.set(turn.elements, 32);
    let slot = 48;
    const put = (...v: number[]) => {
      frame.set(v, slot);
      slot += 4;
    };
    wind.set(1, 0.1, -0.35).normalize();
    put(...V(camera.position), secs);
    put(e[0], e[1], e[2], tan * camera.aspect);
    put(e[4], e[5], e[6], tan);
    put(-e[8], -e[9], -e[10], size);
    put(...light, day ? 1 : 0);
    put(...glare, look.bounce);
    put(...sun, night);
    put(...glow, dark);
    put(...cloudTone, look.sky);
    put(...moon, look.moon * moonUp);
    put(...high, look.rim);
    put(...near, look.haze);
    put(...away, look.stars);
    put(...pole, round);
    put(...mid, trail);
    put(w, h, look.grain, look.lines);
    put(look.patina, look.ao, look.shadowSoft, look.show);
    put(wind.x, wind.y, wind.z, look.wind);
    put(look.grainSize, look.sandGlow, look.swirl, look.thick);
    put(
      look.side,
      look.step,
      ARCHES,
      look.piles * smooth(0.15, 1, due / STEPS()),
    );
    const across = look.cloudsAcross * sky;
    const along = look.cloudsAlong * sky;
    put(
      -across,
      -along,
      -Math.round(look.cloudsAcross / 0.27) * sky,
      -Math.round(look.cloudsAlong / 0.27) * sky,
    );
    put(
      look.cover + 0.1 * Math.sin(2 * Math.PI * (sky * 2 + 0.1)),
      look.dense,
      look.tile,
      Math.round(look.days * 3) * sky,
    );
    put(look.dunes, look.ripples, Math.round(look.days * 4) * sky, look.bright);
    device.queue.writeBuffer(frameBuffer, 0, frame);
    shown.set(
      [
        canvas.width,
        canvas.height,
        look.exposure *
          (1 + look.nightLift * dark) *
          (1 - 0.45 * smooth(0.1, 0.7, sun[1])),
        state.frame,
      ],
      0,
    );
    shown.set([look.glow, look.colour, look.noise, 0.45], 4);
    device.queue.writeBuffer(shownBuffer, 0, shown);

    const encoder = device.createCommandEncoder();
    // the sand goes on for each sixtieth of a second of the loop
    const tick = Math.round(secs * 60);
    let ticks = tick - lastTick;
    if (ticks < 0) ticks = 1;
    lastTick = tick;
    if (ticks > 0) {
      const pass = encoder.beginComputePass();
      pass.setPipeline(driftPipe);
      pass.setBindGroup(0, driftBind);
      for (let i = 0; i < Math.min(ticks, 4); i++)
        pass.dispatchWorkgroups(Math.ceil(GRAINS / 64));
      pass.end();
    }
    if (meshed !== state.step || look.smooth !== meshedWith) {
      meshedWith = look.smooth;
      const pass = encoder.beginComputePass(timed(1));
      if (steps === 0) {
        pass.setPipeline(softenPipe);
        pass.setBindGroup(0, softenBind[now]);
        pass.dispatchWorkgroups(...groups([N, NY, NZ]));
      }
      pass.setPipeline(marchPipe);
      pass.setBindGroup(0, marchBind);
      pass.dispatchWorkgroups(...groups([N, NY, NZ]));
      pass.setPipeline(finishPipe);
      pass.setBindGroup(0, finishBind);
      pass.dispatchWorkgroups(1);
      pass.end();
      meshed = state.step;
    }
    const into = (view: GPUTextureView, loadOp: GPULoadOp = "clear") =>
      encoder.beginRenderPass({
        colorAttachments: [{ view, loadOp, storeOp: "store" }],
      });
    const fill = (
      pass: GPURenderPassEncoder,
      pipe: GPURenderPipeline,
      group: GPUBindGroup,
    ) => {
      pass.setPipeline(pipe);
      pass.setBindGroup(0, group);
      pass.draw(3);
      pass.end();
    };
    fill(into(airMap), airPipe, airBind);
    fill(into(clouds!.createView()), cloudPipe, cloudBind);
    {
      const pass = encoder.beginRenderPass({
        colorAttachments: [],
        depthStencilAttachment: {
          view: shadeView,
          depthClearValue: 1,
          depthLoadOp: "clear",
          depthStoreOp: "store",
        },
        ...timed(2),
      });
      pass.setPipeline(shadePipe);
      pass.setBindGroup(0, shadeBind);
      pass.setVertexBuffer(0, listBuffer);
      pass.drawIndirect(drawBuffer, 0);
      pass.setPipeline(shadeFarPipe);
      pass.setBindGroup(0, shadeFarBind);
      pass.setVertexBuffer(0, smoothList);
      pass.drawIndirect(smoothDraw, 0);
      pass.end();
    }
    {
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: many!.createView(),
            resolveTarget: one!.createView(),
            loadOp: "clear",
            storeOp: "discard",
          },
        ],
        depthStencilAttachment: {
          view: depth!.createView(),
          depthClearValue: 1,
          depthLoadOp: "clear",
          depthStoreOp: "discard",
        },
        ...timed(3),
      });
      pass.setPipeline(rockPipe);
      pass.setBindGroup(0, rockBind);
      pass.setVertexBuffer(0, listBuffer);
      pass.drawIndirect(drawBuffer, 0);
      pass.setPipeline(landPipe);
      pass.setBindGroup(0, landBind);
      pass.draw(COLS * Math.round(ROWS * 6) * 6);
      // the sky only where nothing hides it; before the far arches, the last of which is half clear
      pass.setPipeline(skyPipe);
      pass.setBindGroup(0, skyBind!);
      pass.draw(3);
      pass.setPipeline(farPipe);
      pass.setBindGroup(0, farBind);
      pass.setVertexBuffer(0, smoothList);
      pass.drawIndirect(smoothDraw, 0);
      pass.setPipeline(sandPipe);
      pass.setBindGroup(0, sandBind);
      pass.draw(6, GRAINS);
      pass.end();
    }
    for (let k = 0; k < glows.length; k++)
      fill(into(glowViews[k]), downPipe, downs[k]);
    for (let k = glows.length - 2; k >= 0; k--)
      fill(into(glowViews[k], "load"), upPipe, ups[k]);
    fill(into(context.getCurrentTexture().createView()), showPipe, showBind!);
    // read the counts and the times back when the last reading is done
    if (!reading) {
      encoder.copyBufferToBuffer(drawBuffer, 0, readBuffer, 0, 4);
      encoder.copyBufferToBuffer(tallyBuffer, 4, readBuffer, 4, 4);
      encoder.copyBufferToBuffer(smoothDraw, 0, readBuffer, 8, 4);
      if (clock) {
        encoder.resolveQuerySet(clock, 0, 8, clockBuffer, 0);
        encoder.copyBufferToBuffer(clockBuffer, 0, readBuffer, 16, 64);
      }
    }
    device.queue.submit([encoder.finish()]);
    if (!reading) {
      reading = true;
      const stepped = steps > 0;
      readBuffer.mapAsync(GPUMapMode.READ).then(() => {
        const data = readBuffer.getMappedRange();
        const counts = new Uint32Array(data, 0, 3);
        state.corners = counts[0];
        state.sand = counts[1];
        state.smooth = counts[2];
        if (clock) {
          const t = new BigInt64Array(data, 16, 8);
          const ms = (k: number) => Number(t[k * 2 + 1] - t[k * 2]) / 1e6;
          const blend = (old: number, v: number) =>
            v > 0 && v < 1000 ? (old ? old * 0.9 + v * 0.1 : v) : old;
          if (stepped) state.ms.step = blend(state.ms.step, ms(0));
          if (stepped) state.ms.mesh = blend(state.ms.mesh, ms(1));
          state.ms.shadow = blend(state.ms.shadow, ms(2));
          state.ms.picture = blend(state.ms.picture, ms(3));
        }
        readBuffer.unmap();
        reading = false;
      });
    }
    const t = performance.now();
    if (lastTime) state.ms.frame = state.ms.frame * 0.9 + (t - lastTime) * 0.1;
    lastTime = t;
    stats.update();
    state.frame++;
  };

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
