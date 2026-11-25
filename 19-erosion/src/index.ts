// Erosion: a block of rock that cracks along flat joints, piece by piece, and sheds its outer pieces.
//
// rock.ts cuts the block into a tree of pieces; trace.wgsl ray marches it, a ray a pixel; show.wgsl puts the
// picture on the screen. While nothing moves, each frame is a slightly shifted picture averaged into the last,
// so a still sharpens by itself.
import type { Sketch, SketchSettings } from "ssam";
import { ssam } from "ssam";
import { PerspectiveCamera } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import GUI from "three/examples/jsm/libs/lil-gui.module.min.js";
import Stats from "three/examples/jsm/libs/stats.module.js";
import { buildRock, NODE_FLOATS, rockDefaults, type Rock } from "./rock";
import showCode from "./show.wgsl?raw";
import traceCode from "./trace.wgsl?raw";

const LOOP = 12; // seconds
const MOST_NODES = 2 ** 12 - 1;
const LOW = 0.3; // how far the block goes into the ground
const STILL = 48; // frames averaged into a still

const look = {
  // the cutting
  seed: rockDefaults.seed,
  depth: rockDefaults.depth,
  split: rockDefaults.split,
  scatter: rockDefaults.scatter,
  bed: rockDefaults.bed,
  diag: rockDefaults.diag,
  fall: rockDefaults.fall,
  minSize: rockDefaults.minSize,
  // the age
  age: 0.7,
  play: false,
  gap: 1,
  open: 0.45,
  taper: 2,
  // the surface
  round: 0.005,
  ledges: 0,
  recess: 0.035,
  tilt: 0.05,
  warp: 0.03,
  rough: 0.006,
  grain: 0.45,
  line: 0.8,
  varnish: 0.7,
  dust: 0.5,
  mound: 0.14,
  // the light
  sunTurn: -62,
  sunHeight: 46,
  sunWide: 0.03,
  sun: 3.3,
  sky: 0.38,
  shade: 1,
  haze: 0.012,
  exposure: 0.8,
  // the picture
  res: 1 / Math.min(window.devicePixelRatio, 2),
  turn: 0,
  steps256: false, // shows how many steps each ray took
};
const ranges: Record<string, [number, number, number?]> = {
  seed: [1, 200, 1],
  depth: [3, 11, 1],
  split: [0.3, 1],
  scatter: [0, 0.4],
  bed: [0, 2],
  diag: [0, 2],
  fall: [0, 1],
  minSize: [0.03, 0.3],
  age: [0, 2],
  gap: [0, 3],
  open: [0.05, 1.5],
  taper: [0, 6],
  round: [0, 0.05],
  ledges: [0, 0.02],
  recess: [0, 0.08],
  tilt: [0, 0.15],
  warp: [0, 0.1],
  rough: [0, 0.02],
  grain: [0, 1],
  line: [0, 1],
  varnish: [0, 1],
  dust: [0, 1],
  mound: [0, 0.4],
  sunTurn: [-180, 180],
  sunHeight: [5, 85],
  sunWide: [0, 0.15],
  sun: [0, 8],
  sky: [0, 2],
  shade: [0, 2],
  haze: [0, 0.2],
  exposure: [0.2, 3],
  res: [0.25, 2],
  turn: [-1, 1],
};
const CUTTING = [
  "seed",
  "depth",
  "split",
  "scatter",
  "bed",
  "diag",
  "fall",
  "minSize",
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
  const device = await adapter.requestDevice();
  const context = canvas.getContext("webgpu")!;
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: "opaque" });

  const params = new Float32Array(13 * 4);
  const paramsBuffer = device.createBuffer({
    size: params.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const nodesBuffer = device.createBuffer({
    size: MOST_NODES * NODE_FLOATS * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const shown = new Float32Array(4);
  const shownBuffer = device.createBuffer({
    size: shown.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const traceModule = device.createShaderModule({ code: traceCode });
  const showModule = device.createShaderModule({ code: showCode });
  for (const [name, m] of [
    ["trace", traceModule],
    ["show", showModule],
  ] as const) {
    const info = await m.getCompilationInfo();
    for (const msg of info.messages)
      console[msg.type === "error" ? "error" : "warn"](
        `${name}.wgsl:${msg.lineNum}:${msg.linePos} ${msg.message}`,
      );
  }
  // each frame of a still goes over the last with a weight of 1/n, which leaves their average
  const tracePipe = device.createRenderPipeline({
    layout: "auto",
    vertex: { module: traceModule, entryPoint: "vert" },
    fragment: {
      module: traceModule,
      entryPoint: "frag",
      targets: [
        {
          format: "rgba16float",
          blend: {
            color: {
              srcFactor: "constant",
              dstFactor: "one-minus-constant",
              operation: "add",
            },
            alpha: {
              srcFactor: "constant",
              dstFactor: "one-minus-constant",
              operation: "add",
            },
          },
        },
      ],
    },
  });
  const showPipe = device.createRenderPipeline({
    layout: "auto",
    vertex: { module: showModule, entryPoint: "vert" },
    fragment: { module: showModule, entryPoint: "frag", targets: [{ format }] },
  });
  const traceBind = device.createBindGroup({
    layout: tracePipe.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: paramsBuffer } },
      { binding: 1, resource: { buffer: nodesBuffer } },
    ],
  });
  const soft = device.createSampler({
    magFilter: "linear",
    minFilter: "linear",
  });

  let target: GPUTexture | null = null;
  let showBind: GPUBindGroup | null = null;
  const fit = () => {
    const w = Math.max(1, Math.round(canvas.width * look.res));
    const h = Math.max(1, Math.round(canvas.height * look.res));
    if (target && target.width === w && target.height === h) return;
    target?.destroy();
    target = device.createTexture({
      size: [w, h],
      format: "rgba16float",
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    showBind = device.createBindGroup({
      layout: showPipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: shownBuffer } },
        { binding: 1, resource: target.createView() },
        { binding: 2, resource: soft },
      ],
    });
  };

  let rock: Rock;
  const cutRock = () => {
    rock = buildRock({
      ...rockDefaults,
      seed: look.seed,
      depth: look.depth,
      split: look.split,
      scatter: look.scatter,
      bed: look.bed,
      diag: look.diag,
      fall: look.fall,
      minSize: look.minSize,
    });
    device.queue.writeBuffer(
      nodesBuffer,
      0,
      rock.data as Float32Array<ArrayBuffer>,
    );
    state.rock = {
      cuts: rock.cuts,
      pieces: rock.pieces,
      fallen: rock.fallen,
      last: rock.last,
    };
  };

  const H = rockDefaults.half;
  const tall = 2 * H[1] - LOW;
  const camera = new PerspectiveCamera(30, 1, 0.1, 100);
  camera.position.set(1.9, 1.25, 4.6);
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, tall * 0.48, 0);
  controls.enableDamping = true;
  controls.update();

  const state = {
    frame: 0,
    still: 0, // frames averaged so far
    hold: -1, // an age to stay at, for the tools
    rock: {} as Record<string, number>,
  };
  cutRock();
  const refresh = (key?: string) => {
    if (!key || CUTTING.includes(key)) cutRock();
    state.still = 0;
  };

  const gui = new GUI({ title: "erosion" });
  gui.close();
  for (const k of Object.keys(look)) {
    const r = ranges[k];
    const values = look as unknown as Record<string, number>;
    if (r) gui.add(values, k, r[0], r[1], r[2]).onChange(() => refresh(k));
    else gui.add(values, k).onChange(() => refresh(k));
  }
  const stats = new Stats();
  stats.dom.id = "stats";
  document.body.appendChild(stats.dom);
  Object.assign(window, {
    __erosion: { look, state, refresh, camera, controls, device },
  });

  let last = "";
  wrap.render = ({ playhead, deltaTime }) => {
    if (look.turn !== 0) {
      const a = (look.turn * deltaTime) / 1000;
      const p = camera.position.clone().sub(controls.target);
      p.applyAxisAngle(camera.up, a);
      camera.position.copy(controls.target).add(p);
    }
    controls.update();
    fit();
    const w = target!.width;
    const h = target!.height;
    camera.aspect = w / h;
    camera.updateMatrixWorld();
    const e = camera.matrixWorld.elements;
    const tan = Math.tan((camera.fov * Math.PI) / 360);
    const age =
      state.hold >= 0 ? state.hold : look.play ? playhead * 1.6 : look.age;

    const az = (look.sunTurn * Math.PI) / 180;
    const el = (look.sunHeight * Math.PI) / 180;
    params.set([w, h, state.still, playhead], 0);
    params.set([e[12], e[13], e[14], 0], 4);
    params.set([e[0], e[1], e[2], tan * camera.aspect], 8);
    params.set([e[4], e[5], e[6], tan], 12);
    params.set([-e[8], -e[9], -e[10], 0], 16);
    params.set(
      [
        Math.sin(az) * Math.cos(el),
        Math.sin(el),
        Math.cos(az) * Math.cos(el),
        look.sun,
      ],
      20,
    );
    params.set([H[0], H[1], H[2], 0.05], 24);
    params.set([look.warp, 2.6, look.rough, 9], 28);
    params.set([age, look.gap, look.open, look.taper], 32);
    params.set([look.round, look.recess, look.tilt, look.line], 36);
    params.set([look.sky, look.shade, look.varnish, look.dust], 40);
    params.set([H[1] - LOW, look.mound, look.grain, look.haze], 44);
    params.set([0, look.ledges, look.steps256 ? 1 : 0, look.sunWide], 48);

    // anything that changes the picture starts the still again
    const key = `${w} ${h} ${Array.from(params.subarray(4)).join(" ")}`;
    if (key !== last) state.still = 0;
    last = key;
    params[2] = state.still;

    const encoder = device.createCommandEncoder();
    if (state.still < STILL) {
      device.queue.writeBuffer(paramsBuffer, 0, params);
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: target!.createView(),
            loadOp: state.still === 0 ? "clear" : "load",
            storeOp: "store",
          },
        ],
      });
      pass.setPipeline(tracePipe);
      pass.setBindGroup(0, traceBind);
      pass.setBlendConstant([
        1 / (state.still + 1),
        1 / (state.still + 1),
        1 / (state.still + 1),
        1 / (state.still + 1),
      ]);
      pass.draw(3);
      pass.end();
      state.still++;
    }
    shown.set([canvas.width, canvas.height, look.exposure, state.frame]);
    device.queue.writeBuffer(shownBuffer, 0, shown);
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
