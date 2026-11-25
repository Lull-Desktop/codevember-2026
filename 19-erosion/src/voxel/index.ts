// Erosion of a Möbius band of layered sandstone, on a grid of cells.
//
// The band is a grid of numbers: how full of rock each cell is. A front travels round the ring. Behind it a
// compute pass wears the rock from its surface inward (erode.wgsl): soft and sheltered rock goes first, pits open,
// join into holes and leave bridges. Further behind the rock comes back, so a lap later the band is whole again
// and the picture repeats. Pieces that come loose from the ring are found (hold.wgsl) and fall apart. Each frame
// the grid is turned into triangles by marching cubes (march.wgsl) and lit (draw.wgsl); sand leaves the places
// that lost rock (sand.wgsl). common.wgsl has the band and what its rock is made of.
//
// ?n=352 sets the cells across the ring (288), ?grains= the grains of sand, ?corners= the room for triangles.
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
import commonCode from "./common.wgsl?raw";
import drawCode from "./draw.wgsl?raw";
import erodeCode from "./erode.wgsl?raw";
import fieldCode from "./field.wgsl?raw";
import frameCode from "./frame.wgsl?raw";
import holdCode from "./hold.wgsl?raw";
import initCode from "./init.wgsl?raw";
import marchCode from "./march.wgsl?raw";
import sandCode from "./sand.wgsl?raw";
import showCode from "./show.wgsl?raw";
import wideCode from "./wide.wgsl?raw";

const query = new URLSearchParams(location.search);
const N = Math.max(64, Math.round(+(query.get("n") ?? 288) / 4) * 4); // cells across the ring
const MOST_CORNERS = +(query.get("corners") ?? 4.5e6); // room in the triangle list
const MOST_BORN = 4096; // places a step can report sand from
const GRAINS = +(query.get("grains") ?? 300000); // grains of sand in the air at most
const HOLDS = 24; // rounds a step gives to finding what still hangs on the ring
const SHADE = 2048; // size of the sun's map
const STEP = 1 / 60; // seconds a step stands for

const look = {
  // the band; the grid is sized for these at the start, so making it bigger later cuts it off
  radius: 1,
  width: 0.74,
  thick: 0.3,
  round: 0.035,
  twistAt: 90,
  bunch: 0.3,
  // the rock
  seed: 1,
  layers: 26,
  tilt: 0.1,
  warp: 0.09,
  warpScale: 1.5,
  cell: 0.26,
  squash: 1.5,
  grow: 0.85,
  wall: 0.14,
  bent: 0.25,
  fine: 0.4,
  fineSize: 0.42,
  small: 0.5,
  big: 0.95,
  join: 0.85,
  window: 0.6,
  shelf: 0,
  layerSoft: 0.15,
  rind: 0.03,
  massive: 0.6,
  blotch: 1.3,
  crust: 0.06,
  // the wear
  rate: 0.5,
  power: 1.6,
  shelter: 1.5,
  crumbs: 0.3,
  inside: 0,
  windPull: 0.4,
  loose: 1,
  sandy: 2,
  slow: 0.0015,
  // the lap
  lap: 24, // seconds the front takes round the ring
  front: 200, // where the front starts, degrees
  spin: 1, // 1: the rock turns so the front stays where it is in the picture
  rise: 0.05,
  fadeFrom: 0.5,
  fadeTo: 0.6,
  healFrom: 0.7,
  healTo: 0.94,
  healRate: 0.2,
  ragged: 0.05,
  play: true,
  // the mesh
  edge: 2,
  smooth: 1,
  // the light
  lean: 42,
  sunTurn: 75,
  sunHeight: 17,
  sun: 5.5,
  sky: 0.55,
  rim: 1.2,
  bounce: 0.5,
  haze: 0.012,
  ao: 1,
  patina: 0.6,
  // the sand
  wind: 0.9,
  swirl: 0.7,
  fall: 0.5,
  grainSize: 0.0018,
  sandGlow: 1,
  grain: 0.2,
  lines: 0.45,
  shadowSoft: 1.2,
  exposure: 0.85,
  // the picture
  res: 1,
  turn: 0,
  show: 0, // 0 the picture, 1 openness, 2 normals, 3 sun, 4 hardness of the layers, 5 loose pieces in blue
};
const ranges: Record<string, [number, number, number?]> = {
  radius: [0.6, 1],
  width: [0.3, 0.92],
  thick: [0.1, 0.34],
  round: [0, 0.1],
  twistAt: [0, 180],
  bunch: [0, 0.5],
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
  rate: [0, 1],
  power: [0.5, 4],
  shelter: [0, 5],
  crumbs: [0, 2],
  inside: [0, 1],
  windPull: [0, 1],
  loose: [0, 3],
  sandy: [0, 3],
  slow: [0, 0.05],
  lap: [6, 60],
  front: [0, 360],
  spin: [0, 1],
  rise: [0.005, 0.2],
  fadeFrom: [0.1, 0.9],
  fadeTo: [0.1, 0.9],
  healFrom: [0.3, 0.95],
  healTo: [0.5, 0.99],
  healRate: [0.02, 1],
  ragged: [0, 0.2],
  edge: [1, 4],
  smooth: [0, 1],
  lean: [-60, 60],
  sunTurn: [-180, 180],
  sunHeight: [2, 85],
  sun: [0, 12],
  sky: [0, 2],
  rim: [0, 4],
  bounce: [0, 2],
  haze: [0, 0.1],
  ao: [0, 1],
  patina: [0, 1],
  wind: [0, 3],
  swirl: [0, 3],
  fall: [0, 3],
  grainSize: [0.001, 0.03],
  sandGlow: [0, 4],
  grain: [0, 1],
  lines: [0, 1],
  shadowSoft: [0.3, 4],
  exposure: [0.2, 3],
  res: [0.25, 1],
  turn: [-1, 1],
  show: [0, 5, 1],
};
// changing any of these makes the rock anew, from the first step
const MAKING = [
  "radius",
  "width",
  "thick",
  "round",
  "twistAt",
  "bunch",
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
  "edge",
];

const sketch: Sketch<"webgpu"> = async ({ wrap, canvas }) => {
  if (import.meta.hot) {
    import.meta.hot.dispose(() => wrap.dispose());
    import.meta.hot.accept(() => wrap.hotReload());
  }
  const adapter = await navigator.gpu?.requestAdapter({
    powerPreference: "high-performance",
  });
  if (!adapter) throw new Error("WebGPU is not available");

  // the grid: a box round the band with three cells to spare on every side
  const half = Math.hypot(look.width / 2, look.thick / 2);
  const size = (2 * (look.radius + half)) / (N - 6);
  const NY = Math.ceil(((2 * half) / size + 6) / 4) * 4;
  const count = N * NY * N;
  const coarse = [N / 4, NY / 4, N / 4];
  const low = [(-N * size) / 2, (-NY * size) / 2, (-N * size) / 2];

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
  const frame = new Float32Array(16 * 3 + 10 * 4);
  const frameBuffer = device.createBuffer({
    size: frame.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const shown = new Float32Array(4);
  const shownBuffer = device.createBuffer({
    size: shown.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const madeBuffer = device.createBuffer({ size: count * 8, usage: STORE });
  // the rock, twice: a step reads one and writes the other
  const rockBuffers = [0, 1].map(() =>
    device.createBuffer({ size: count * 4, usage: STORE }),
  );
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
  const halves = [N / 2, NY / 2, N / 2];
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
  const grainsBuffer = device.createBuffer({ size: GRAINS * 32, usage: STORE });
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
    draw: commonCode + frameCode + drawCode,
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

  const corner: GPUVertexBufferLayout = {
    arrayStride: 32,
    attributes: [
      { shaderLocation: 0, offset: 0, format: "float32x4" },
      { shaderLocation: 1, offset: 16, format: "float32x4" },
    ],
  };
  const SAMPLES = 4;
  const skyPipe = device.createRenderPipeline({
    layout: "auto",
    vertex: { module: modules.draw, entryPoint: "skyVert" },
    fragment: {
      module: modules.draw,
      entryPoint: "skyFrag",
      targets: [{ format: "rgba16float" }],
    },
    depthStencil: {
      format: "depth24plus",
      depthWriteEnabled: false,
      depthCompare: "always",
    },
    multisample: { count: SAMPLES },
  });
  const rockPipe = device.createRenderPipeline({
    layout: "auto",
    vertex: { module: modules.draw, entryPoint: "rockVert", buffers: [corner] },
    fragment: {
      module: modules.draw,
      entryPoint: "rockFrag",
      targets: [{ format: "rgba16float" }],
    },
    primitive: { cullMode: "none" },
    depthStencil: {
      format: "depth24plus",
      depthWriteEnabled: true,
      depthCompare: "less",
    },
    multisample: { count: SAMPLES },
  });
  const shadePipe = device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module: modules.draw,
      entryPoint: "shadeVert",
      buffers: [corner],
    },
    primitive: { cullMode: "none" },
    depthStencil: {
      format: "depth32float",
      depthWriteEnabled: true,
      depthCompare: "less",
      depthBias: 2,
      depthBiasSlopeScale: 2,
    },
  });
  const sandPipe = device.createRenderPipeline({
    layout: "auto",
    vertex: { module: modules.draw, entryPoint: "sandVert" },
    fragment: {
      module: modules.draw,
      entryPoint: "sandFrag",
      targets: [
        {
          format: "rgba16float",
          blend: {
            color: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
            alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
          },
        },
      ],
    },
    depthStencil: {
      format: "depth24plus",
      depthWriteEnabled: false,
      depthCompare: "less",
    },
    multisample: { count: SAMPLES },
  });
  const showPipe = device.createRenderPipeline({
    layout: "auto",
    vertex: { module: modules.show, entryPoint: "vert" },
    fragment: {
      module: modules.show,
      entryPoint: "frag",
      targets: [{ format }],
    },
  });

  const shadeMap = device.createTexture({
    size: [SHADE, SHADE],
    format: "depth32float",
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });
  const shadeView = shadeMap.createView();
  const skyBind = bind(skyPipe, [[1, frameBuffer]]);
  const shadeBind = bind(shadePipe, [[1, frameBuffer]]);
  const sandBind = bind(sandPipe, [
    [1, frameBuffer],
    [2, shadeView],
    [4, grainsBuffer],
  ]);
  const rockBind = bind(rockPipe, [
    [0, paramsBuffer],
    [1, frameBuffer],
    [2, shadeView],
    [
      3,
      device.createSampler({
        compare: "less",
        magFilter: "linear",
        minFilter: "linear",
      }),
    ],
  ]);
  const soft = device.createSampler({
    magFilter: "linear",
    minFilter: "linear",
  });

  // the picture is drawn with four samples a pixel, then made one, then put on the screen
  let many: GPUTexture | null = null;
  let one: GPUTexture | null = null;
  let depth: GPUTexture | null = null;
  let showBind: GPUBindGroup | null = null;
  const fit = () => {
    const w = Math.max(1, Math.round(canvas.width * look.res));
    const h = Math.max(1, Math.round(canvas.height * look.res));
    if (one && one.width === w && one.height === h) return;
    many?.destroy();
    one?.destroy();
    depth?.destroy();
    many = device.createTexture({
      size: [w, h],
      format: "rgba16float",
      sampleCount: SAMPLES,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    one = device.createTexture({
      size: [w, h],
      format: "rgba16float",
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    depth = device.createTexture({
      size: [w, h],
      format: "depth24plus",
      sampleCount: SAMPLES,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    showBind = bind(showPipe, [
      [0, shownBuffer],
      [1, one.createView()],
      [2, soft],
    ]);
  };

  const camera = new PerspectiveCamera(30, 1, 0.1, 100);
  camera.coordinateSystem = WebGPUCoordinateSystem;
  camera.position.set(0.2, -0.45, 4.5);
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 0.12, 0);
  controls.enableDamping = true;
  controls.update();

  const state = {
    frame: 0,
    step: 0, // steps of wear taken
    goto: -1, // a step to run to and stay at, for the tools
    cells: [N, NY, N],
    size,
    corners: 0, // corners in the triangle list of the last frame read back
    room: corners,
    sand: 0,
    ms: { step: 0, mesh: 0, shadow: 0, picture: 0, frame: 0 },
    timing,
  };

  const model = new Matrix4();
  const unturn = new Matrix4();
  const wind = new Vector3();
  const frontAt = (step: number) =>
    (look.front * Math.PI) / 180 + (step * STEP * 2 * Math.PI) / look.lap;
  const writeParams = (step: number) => {
    const front = frontAt(step);
    // the rock leans towards the eye, and turns against the front so the wear stays in one part of the picture
    model
      .makeRotationX((look.lean * Math.PI) / 180)
      .multiply(
        unturn.makeRotationY(
          look.spin * (front - (look.front * Math.PI) / 180),
        ),
      );
    unturn.copy(model).invert();
    wind.set(1, 0.25, -0.2).normalize().transformDirection(unturn);
    params.set([N, NY, N, size], 0);
    params.set([low[0], low[1], low[2], step], 4);
    params.set([look.radius, look.width / 2, look.thick / 2, look.round], 8);
    params.set(
      [(look.twistAt * Math.PI) / 180, look.bunch, front, look.seed],
      12,
    );
    params.set([look.layers, look.tilt, look.warp, look.warpScale], 16);
    params.set([look.cell, look.squash, look.grow, look.wall], 20);
    params.set([look.layerSoft, look.massive, look.blotch, look.crust], 24);
    params.set([look.rate, look.power, look.shelter, look.crumbs], 28);
    params.set([look.rise, look.fadeFrom, look.fadeTo, look.healFrom], 32);
    params.set([look.healTo, look.healRate, look.inside, look.windPull], 36);
    params.set([wind.x, wind.y, wind.z, look.rind], 40);
    params.set([look.edge, look.smooth, look.slow, look.ragged], 44);
    params.set([look.small, look.join, look.shelf, look.big], 48);
    params.set([look.bent, look.window, look.loose, look.sandy], 52);
    params.set([look.fineSize, look.fine, (step * STEP) / look.lap, 0], 56);
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
    pass.dispatchWorkgroups(...groups([N, NY, N]));
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
  const make = () => {
    writeParams(0);
    // at the start all the rock hangs on the ring
    const all = new Float32Array(halfCount).fill(1);
    for (const b of holdBuffers) device.queue.writeBuffer(b, 0, all);
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(initPipe);
    pass.setBindGroup(0, initBind);
    pass.dispatchWorkgroups(...groups([N, NY, N]));
    pass.end();
    survey(encoder, 0);
    device.queue.submit([encoder.finish()]);
    now = 0;
    state.step = 0;
  };
  const stepOnce = (time: boolean) => {
    state.step++;
    writeParams(state.step);
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass(time ? timed(0, true, false) : {});
    pass.setPipeline(erodePipe);
    pass.setBindGroup(0, erodeBind[now]);
    pass.dispatchWorkgroups(...groups([N, NY, N]));
    pass.end();
    now = 1 - now;
    survey(encoder, now, time);
    device.queue.submit([encoder.finish()]);
  };
  make();

  const refresh = (key?: string) => {
    if (!key || MAKING.includes(key)) make();
  };
  const gui = new GUI({ title: "voxel erosion" });
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
    __voxel: { look, state, refresh, make, camera, controls, device },
  });

  const eye = new Vector3();
  const sunView = new Matrix4();
  const sunBox = new Matrix4();
  const sunAt = new Vector3();
  const viewing = new Matrix4();
  let reading = false;
  let lastTime = 0;
  let owed = 0; // milliseconds of wear not yet stepped
  wrap.render = ({ deltaTime }) => {
    if (look.turn !== 0) {
      const a = (look.turn * deltaTime) / 1000;
      const p = camera.position.clone().sub(controls.target);
      p.applyAxisAngle(camera.up, a);
      camera.position.copy(controls.target).add(p);
    }
    controls.update();
    fit();
    const w = one!.width;
    const h = one!.height;
    camera.aspect = w / h;
    // in a narrow window the view opens up, so the ring still fits across it
    camera.fov =
      (Math.atan(Math.tan(Math.PI / 12) * Math.max(1, 1.6 / camera.aspect)) *
        360) /
      Math.PI;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();

    // the wear: a step for each sixtieth of a second that has passed, so a fast screen does not hurry it; many
    // when a tool asks for a step far ahead
    let steps = 0;
    if (look.play) {
      owed += deltaTime;
      while (owed >= STEP * 1000 - 0.01 && steps < 3) {
        owed -= STEP * 1000;
        steps++;
      }
      owed = Math.min(owed, STEP * 1000);
    }
    if (state.goto >= 0) {
      if (state.goto < state.step) make();
      steps = Math.min(state.goto - state.step, 30);
    }
    device.queue.writeBuffer(tallyBuffer, 0, new Uint32Array(4));
    for (let i = 0; i < steps; i++) stepOnce(i === steps - 1);
    writeParams(state.step);

    const e = camera.matrixWorld.elements;
    const tan = Math.tan((camera.fov * Math.PI) / 360);
    const az = (look.sunTurn * Math.PI) / 180;
    const el = (look.sunHeight * Math.PI) / 180;
    sunAt.set(
      Math.sin(az) * Math.cos(el),
      Math.sin(el),
      Math.cos(az) * Math.cos(el),
    );
    // what the sun sees: a box that holds the whole ring
    const reach = look.radius + half + 0.1;
    sunView
      .identity()
      .lookAt(sunAt.clone().multiplyScalar(4), eye.set(0, 0, 0), camera.up);
    sunView.setPosition(sunAt.clone().multiplyScalar(4)).invert();
    sunBox
      .makeOrthographic(
        -reach,
        reach,
        reach,
        -reach,
        0.5,
        8,
        WebGPUCoordinateSystem,
      )
      .multiply(sunView);
    viewing.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    );
    frame.set(viewing.elements, 0);
    frame.set(sunBox.elements, 16);
    frame.set(model.elements, 32);
    frame.set([e[12], e[13], e[14], state.step * STEP], 48);
    frame.set([e[0], e[1], e[2], tan * camera.aspect], 52);
    frame.set([e[4], e[5], e[6], tan], 56);
    frame.set([-e[8], -e[9], -e[10], size], 60);
    frame.set([sunAt.x, sunAt.y, sunAt.z, look.sun], 64);
    frame.set([look.sky, look.haze, look.rim, look.bounce], 68);
    frame.set([w, h, look.grain, look.lines], 72);
    frame.set([look.patina, look.ao, look.shadowSoft, look.show], 76);
    wind.set(1, 0.25, -0.2).normalize();
    frame.set([wind.x, wind.y, wind.z, look.wind], 80);
    frame.set([look.grainSize, look.sandGlow, look.swirl, look.fall], 84);
    device.queue.writeBuffer(frameBuffer, 0, frame);
    shown.set([canvas.width, canvas.height, look.exposure, state.frame]);
    device.queue.writeBuffer(shownBuffer, 0, shown);

    const encoder = device.createCommandEncoder();
    if (steps > 0) {
      const pass = encoder.beginComputePass();
      pass.setPipeline(driftPipe);
      pass.setBindGroup(0, driftBind);
      pass.dispatchWorkgroups(Math.ceil(GRAINS / 64));
      pass.end();
    }
    {
      const pass = encoder.beginComputePass(timed(1));
      // the smoothed field is made with each step; with no step it is made here, in case its look value changed
      if (steps === 0) {
        pass.setPipeline(softenPipe);
        pass.setBindGroup(0, softenBind[now]);
        pass.dispatchWorkgroups(...groups([N, NY, N]));
      }
      pass.setPipeline(marchPipe);
      pass.setBindGroup(0, marchBind);
      pass.dispatchWorkgroups(...groups([N, NY, N]));
      pass.setPipeline(finishPipe);
      pass.setBindGroup(0, finishBind);
      pass.dispatchWorkgroups(1);
      pass.end();
    }
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
      pass.setPipeline(skyPipe);
      pass.setBindGroup(0, skyBind);
      pass.draw(3);
      pass.setPipeline(rockPipe);
      pass.setBindGroup(0, rockBind);
      pass.setVertexBuffer(0, listBuffer);
      pass.drawIndirect(drawBuffer, 0);
      pass.setPipeline(sandPipe);
      pass.setBindGroup(0, sandBind);
      pass.draw(6, GRAINS);
      pass.end();
    }
    {
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: context.getCurrentTexture().createView(),
            loadOp: "clear",
            storeOp: "store",
          },
        ],
      });
      pass.setPipeline(showPipe);
      pass.setBindGroup(0, showBind!);
      pass.draw(3);
      pass.end();
    }
    // read the counts and the times back when the last reading is done
    if (!reading) {
      encoder.copyBufferToBuffer(drawBuffer, 0, readBuffer, 0, 4);
      encoder.copyBufferToBuffer(tallyBuffer, 4, readBuffer, 4, 4);
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
        const counts = new Uint32Array(data, 0, 2);
        state.corners = counts[0];
        state.sand = counts[1];
        if (clock) {
          const t = new BigInt64Array(data, 16, 8);
          const ms = (k: number) => Number(t[k * 2 + 1] - t[k * 2]) / 1e6;
          const blend = (old: number, v: number) =>
            v > 0 && v < 1000 ? (old ? old * 0.9 + v * 0.1 : v) : old;
          if (stepped) state.ms.step = blend(state.ms.step, ms(0));
          state.ms.mesh = blend(state.ms.mesh, ms(1));
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
  duration: look.lap * 1000,
  exportFps: 60,
  framesFormat: ["webm"],
};

ssam(sketch, settings);
