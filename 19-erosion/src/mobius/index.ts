// A Möbius band of sandstone with a wave of erosion going round it, in a seamless loop.
//
// trace.wgsl ray marches the band, a ray a pixel; show.wgsl puts the picture on the screen and the sand over it. While nothing
// moves (the loop held at one moment), each frame is a slightly shifted picture averaged into the last.
import type { Sketch, SketchSettings } from "ssam";
import { ssam } from "ssam";
import { PerspectiveCamera } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import GUI from "three/examples/jsm/libs/lil-gui.module.min.js";
import Stats from "three/examples/jsm/libs/stats.module.js";
import showCode from "./show.wgsl?raw";
import traceCode from "./trace.wgsl?raw";

const LOOP = 12; // seconds
const STILL = 48; // frames averaged into a still

const look = {
  play: true,
  at: 0.3, // where round the loop, when not playing
  // the band
  radius: 1,
  width: 0.27,
  thick: 0.13,
  twist: 0.6,
  tip: 30,
  lean: -8,
  // its rock
  layers: 26,
  bend: 0.1,
  rough: 0.004,
  grain: 0.35,
  sink: 0.03,
  thin: 0.02,
  bands: 0.5,
  // the hollows
  pit: 0.085,
  hollow: 0.34,
  pitSize: 0.42,
  hollowSize: 0.6,
  rim: 0.06,
  // the wave of wear
  setIn: 0.16,
  healFrom: 0.5,
  healed: 0.92,
  ragged: 0.07,
  // the light
  sunTurn: 72,
  sunHeight: 15,
  sun: 4.2,
  sky: 0.3,
  edge: 2,
  shade: 1,
  haze: 0.012,
  exposure: 0.85,
  // the sand
  grains: 900000,
  grain0: 0.0017,
  sandLight: 0.8,
  wind: 0.5,
  windTurn: 70,
  windRise: 18,
  swirl: 0.035,
  // the picture
  res: 1 / Math.min(window.devicePixelRatio, 2),
  steps: false,
};
const ranges: Record<string, [number, number, number?]> = {
  at: [0, 1],
  radius: [0.5, 1.5],
  width: [0.1, 0.8],
  thick: [0.05, 0.4],
  twist: [-3.2, 3.2],
  tip: [-90, 90],
  lean: [-90, 90],
  layers: [2, 60],
  bend: [0, 0.5],
  rough: [0, 0.02],
  grain: [0, 1],
  sink: [0, 0.1],
  thin: [0, 0.08],
  bands: [0, 1.5],
  pit: [0.04, 0.3],
  hollow: [0.15, 0.7],
  pitSize: [0, 0.55],
  hollowSize: [0, 0.68],
  rim: [0, 0.1],
  setIn: [0.02, 0.5],
  healFrom: [0.2, 0.9],
  healed: [0.3, 1],
  ragged: [0, 0.3],
  sunTurn: [-180, 180],
  sunHeight: [0, 80],
  sun: [0, 12],
  sky: [0, 2],
  edge: [0, 5],
  shade: [0, 2],
  haze: [0, 0.2],
  exposure: [0.2, 3],
  grains: [0, 1500000, 1000],
  grain0: [0.0005, 0.01],
  sandLight: [0, 2],
  wind: [0, 2],
  windTurn: [-180, 180],
  windRise: [-60, 80],
  swirl: [0, 0.2],
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
  const device = await adapter.requestDevice();
  const context = canvas.getContext("webgpu")!;
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: "opaque" });

  const params = new Float32Array(14 * 4);
  const paramsBuffer = device.createBuffer({
    size: params.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const shown = new Float32Array(12);
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
  const blend: GPUBlendComponent = {
    srcFactor: "constant",
    dstFactor: "one-minus-constant",
    operation: "add",
  };
  const tracePipe = device.createRenderPipeline({
    layout: "auto",
    vertex: { module: traceModule, entryPoint: "vert" },
    fragment: {
      module: traceModule,
      entryPoint: "frag",
      targets: [
        { format: "rgba16float", blend: { color: blend, alpha: blend } },
      ],
    },
  });
  const showPipe = device.createRenderPipeline({
    layout: "auto",
    vertex: { module: showModule, entryPoint: "vert" },
    fragment: { module: showModule, entryPoint: "frag", targets: [{ format }] },
  });
  const sandPipe = device.createRenderPipeline({
    layout: "auto",
    vertex: { module: showModule, entryPoint: "grain" },
    fragment: {
      module: showModule,
      entryPoint: "dust",
      targets: [
        {
          format,
          blend: {
            color: {
              srcFactor: "one",
              dstFactor: "one-minus-src-alpha",
              operation: "add",
            },
            alpha: {
              srcFactor: "one",
              dstFactor: "one-minus-src-alpha",
              operation: "add",
            },
          },
        },
      ],
    },
  });
  const traceBind = device.createBindGroup({
    layout: tracePipe.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: paramsBuffer } }],
  });
  const soft = device.createSampler({
    magFilter: "linear",
    minFilter: "linear",
  });

  let target: GPUTexture | null = null;
  let showBind: GPUBindGroup | null = null;
  let sandBind: GPUBindGroup | null = null;
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
    sandBind = device.createBindGroup({
      layout: sandPipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: shownBuffer } },
        { binding: 1, resource: target.createView() },
        { binding: 2, resource: soft },
        { binding: 3, resource: { buffer: paramsBuffer } },
      ],
    });
  };

  const camera = new PerspectiveCamera(32, 1, 0.1, 100);
  camera.position.set(0.2, -0.75, 3.75);
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 0.02, 0);
  controls.enableDamping = true;
  controls.update();

  const state = {
    frame: 0,
    still: 0, // frames averaged so far
    hold: -1, // a moment of the loop to stay at, for the tools
  };
  const gui = new GUI({ title: "möbius" });
  gui.close();
  for (const k of Object.keys(look)) {
    const r = ranges[k];
    const values = look as unknown as Record<string, number>;
    if (r) gui.add(values, k, r[0], r[1], r[2]);
    else gui.add(values, k);
  }
  const stats = new Stats();
  stats.dom.id = "stats";
  document.body.appendChild(stats.dom);
  Object.assign(window, {
    __mobius: { look, state, camera, controls, device },
  });

  let last = "";
  wrap.render = ({ playhead, time }) => {
    controls.update();
    fit();
    const w = target!.width;
    const h = target!.height;
    camera.aspect = w / h;
    camera.updateMatrixWorld();
    const e = camera.matrixWorld.elements;
    const tan = Math.tan((camera.fov * Math.PI) / 360);
    const at = state.hold >= 0 ? state.hold : look.play ? playhead : look.at;
    const az = (look.sunTurn * Math.PI) / 180;
    const el = (look.sunHeight * Math.PI) / 180;
    params.set([w, h, 0, at], 0);
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
    params.set([look.radius, look.width, look.thick, look.twist], 24);
    params.set([look.layers, look.bend, look.rough, look.grain], 28);
    params.set([look.pit, look.hollow, look.pitSize, look.hollowSize], 32);
    params.set([look.setIn, look.healFrom, look.healed, look.ragged], 36);
    params.set([look.sky, look.edge, look.shade, look.haze], 40);
    params.set(
      [look.sink, look.rim, (time / 1000) % 1000, look.steps ? 1 : 0],
      44,
    );

    const tip = (look.tip * Math.PI) / 180;
    const lean = (look.lean * Math.PI) / 180;
    params.set(
      [Math.cos(tip), Math.sin(tip), Math.cos(lean), Math.sin(lean)],
      48,
    );
    params.set([look.thin, look.bands, 0, 0], 52);

    // anything that changes the picture starts the still again
    const key = `${w} ${h} ${[...params.subarray(3, 46), ...params.subarray(48)].join(" ")}`;
    if (key !== last) state.still = 0;
    last = key;
    params[2] = state.still;

    const encoder = device.createCommandEncoder();
    device.queue.writeBuffer(paramsBuffer, 0, params);
    if (state.still < STILL) {
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
      const k = 1 / (state.still + 1);
      pass.setBlendConstant([k, k, k, k]);
      pass.draw(3);
      pass.end();
      state.still++;
    }
    const wt = (look.windTurn * Math.PI) / 180;
    const wr = (look.windRise * Math.PI) / 180;
    shown.set([canvas.width, canvas.height, look.exposure, state.frame], 0);
    shown.set([look.grains, look.grain0, look.sandLight, LOOP], 4);
    shown.set(
      [
        Math.sin(wt) * Math.cos(wr) * look.wind,
        Math.sin(wr) * look.wind,
        Math.cos(wt) * Math.cos(wr) * look.wind,
        look.swirl,
      ],
      8,
    );
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
    if (look.grains > 0) {
      pass.setPipeline(sandPipe);
      pass.setBindGroup(0, sandBind!);
      pass.draw(Math.round(look.grains) * 6);
    }
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
