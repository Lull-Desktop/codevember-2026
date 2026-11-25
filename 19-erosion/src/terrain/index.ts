// Erosion, a second take: a square block of mountains with a river wandering through its valley, in fog.
//
// The mountains are smooth noise worn by the erosion filter (erosion.wgsl), worked out once into a picture of
// heights (bake.wgsl) and another of their shadows (light.wgsl). The river is a line that moves by rule
// (meander.ts); field.ts keeps, for every cell of the valley, how long ago the river ran there, and
// trace.wgsl reads that as ground height and colour while it ray marches the block. blur.wgsl and show.wgsl
// give the picture its glow and put it on the screen.
import type { Sketch, SketchSettings } from "ssam";
import { ssam } from "ssam";
import { PerspectiveCamera } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import GUI from "three/examples/jsm/libs/lil-gui.module.min.js";
import Stats from "three/examples/jsm/libs/stats.module.js";
import bakeCode from "./bake.wgsl?raw";
import blurCode from "./blur.wgsl?raw";
import erosionCode from "./erosion.wgsl?raw";
import { AGE0, CELLS, FRESH, makeField, OLD, SPAN, UNITS } from "./field";
import lightCode from "./light.wgsl?raw";
import showCode from "./show.wgsl?raw";
import traceCode from "./trace.wgsl?raw";

const LOOP = 12; // seconds
const BAKED = 2048; // cells across the picture of heights
const LIT = 1024; // and across the picture of shadows
const UNDER = -0.3; // the block's underside
const REACH = 20; // how far to each side of the valley's middle the river may go, in its own units
const WARM = 1.6 * OLD; // steps the river runs before the first frame, so the valley has a past

// Each group is a folder of sliders. The comments say what a value does in the picture.
const look = {
  land: {
    seed: 7, // which mountains
    shapes: 2.4, // how many big ones across the block
    rough: 0.3, // how much finer shape the smooth land has before it is worn
    far: 0.15, // height of the far side, before the gullies (the block is 1 across in this measure)
    near: 0.07, // and of the near side
    lift: 0.25, // how much of that height is there whatever the noise says
    relief: 1.15, // all heights times this
    floor: 0.44, // half the valley floor's width (the block is 2 across in this one)
    foot: 0.5, // the width of the slope from the floor up to the tops
    ragged: 0.12, // how far the mountains' foot wanders in and out
    swing: 0.1, // how far the valley swings from side to side
    middle: 0.16, // where the valley lies: 0 is the block's middle, more is nearer the eye
    bumps: 0.0015, // unevenness of the floor
  },
  gullies: {
    width: 0.15, // of the widest gullies
    strength: 0.22,
    weight: 0.5, // less keeps the peaks pointed
    detail: 1.5, // how far the fine gullies reach onto gentle ground
    octaves: 5,
    ridges: 0.1, // how rounded the ridges are
    creases: 0.0, // and the creases
    onset: 1.25, // how soon gullies come as the ground steepens
    slope: 0.7, // the steepness the filter assumes when choosing where gullies run
  },
  river: {
    seed: 2,
    speed: 1.6, // steps of the river a frame (at 60 frames a second)
    level: -0.05, // the water's level, below the valley floor
    depth: 0.02, // of the channel
    bank: 0.006, // how far a fresh bank stands out of the water
    bars: 0.0022, // height of the scroll bars
    barSteps: 46, // steps of the river between one bar and the next
    barTint: 0.55, // how much the bars show as colour
    ripples: 0.5,
  },
  light: {
    sunTurn: -132,
    sunHeight: 17,
    sun: 4,
    sky: 0.45,
    shade: 0.85, // how dark the hollows are
    trees: 0.42, // where the trees end, as a part of the tops' height
    snow: 0.8, // where the snow starts
  },
  air: {
    fog: 13, // how thick
    fogHigh: 0.035, // how high it stands over the ground
    fogRiver: 0.22, // how much of it lies over the river's ground (all of it lies along the mountains' foot)
    fogFill: 0.15, // how full of it the mountains' gullies are
    wisps: 1, // how much of it is broken into wisps
    wispSize: 5.5, // more is smaller
    drift: 0.12, // how fast the wisps move
    forward: 0.35, // how much more the fog glows looking toward the sun
    fogLight: 0.85,
    haze: 0.07, // thicker air toward the back
  },
  picture: {
    exposure: 1.15,
    glow: 0.7,
    glowWide: 1.4,
    contrast: 0.45,
    colour: 1.08,
    grain: 0.035,
    res: 1 / Math.min(window.devicePixelRatio, 2),
    turn: 0, // turns the eye round the block
    steps: false, // shows how many steps each ray took
  },
};
type Group = keyof typeof look;
const ranges: Record<string, [number, number, number?]> = {
  "land.seed": [1, 99, 1],
  "land.shapes": [1, 6],
  "land.rough": [0, 0.6],
  "land.far": [0, 0.3],
  "land.near": [0, 0.3],
  "land.lift": [0, 1],
  "land.relief": [0.3, 2],
  "land.floor": [0.2, 0.8],
  "land.foot": [0.1, 1],
  "land.ragged": [0, 0.3],
  "land.swing": [0, 0.3],
  "land.middle": [-0.4, 0.4],
  "land.bumps": [0, 0.01],
  "gullies.width": [0.03, 0.4],
  "gullies.strength": [0, 0.5],
  "gullies.weight": [0, 1],
  "gullies.detail": [0.3, 4],
  "gullies.octaves": [1, 7, 1],
  "gullies.ridges": [0, 0.5],
  "gullies.creases": [0, 0.5],
  "gullies.onset": [0.3, 4],
  "gullies.slope": [0.1, 2],
  "river.seed": [1, 99, 1],
  "river.speed": [0, 12],
  "river.level": [-0.12, -0.01],
  "river.depth": [0.002, 0.06],
  "river.bank": [0, 0.03],
  "river.bars": [0, 0.01],
  "river.barSteps": [10, 200],
  "river.barTint": [0, 1],
  "river.ripples": [0, 2],
  "light.sunTurn": [-180, 180],
  "light.sunHeight": [3, 80],
  "light.sun": [0, 8],
  "light.sky": [0, 2],
  "light.shade": [0, 1],
  "light.trees": [0, 1.2],
  "light.snow": [0.2, 1.6],
  "air.fog": [0, 12],
  "air.fogHigh": [0.01, 0.3],
  "air.fogRiver": [0, 1],
  "air.fogFill": [-0.2, 0.5],
  "air.wisps": [0, 1],
  "air.wispSize": [1, 16],
  "air.drift": [0, 1],
  "air.forward": [0, 0.85],
  "air.fogLight": [0, 2],
  "air.haze": [0, 1],
  "picture.exposure": [0.2, 3],
  "picture.glow": [0, 2],
  "picture.glowWide": [0.3, 4],
  "picture.contrast": [0, 1],
  "picture.colour": [0, 1.6],
  "picture.grain": [0, 0.15],
  "picture.res": [0.25, 2],
  "picture.turn": [-1, 1],
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

  const uniform = (floats: number) =>
    device.createBuffer({
      size: floats * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  const picture = (w: number, h: number, kind: GPUTextureFormat) =>
    device.createTexture({
      size: [w, h],
      format: kind,
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT |
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST,
    });
  const land = new Float32Array(9 * 4);
  const landBuffer = uniform(land.length);
  const sunBuffer = uniform(4);
  const params = new Float32Array(15 * 4);
  const paramsBuffer = uniform(params.length);
  const blurBuffers = [uniform(4), uniform(4), uniform(4)];
  const shown = new Float32Array(8);
  const shownBuffer = uniform(shown.length);

  const pipe = async (
    name: string,
    code: string,
    kind: GPUTextureFormat,
  ): Promise<GPURenderPipeline> => {
    const module = device.createShaderModule({ code });
    const info = await module.getCompilationInfo();
    for (const msg of info.messages)
      console[msg.type === "error" ? "error" : "warn"](
        `${name}.wgsl:${msg.lineNum}:${msg.linePos} ${msg.message}`,
      );
    return device.createRenderPipeline({
      layout: "auto",
      vertex: { module, entryPoint: "vert" },
      fragment: { module, entryPoint: "frag", targets: [{ format: kind }] },
    });
  };
  const erosionLines = erosionCode.split("\n").length - 1;
  const [bakePipe, lightPipe, tracePipe, blurPipe, showPipe] =
    await Promise.all([
      pipe(
        `erosion+bake (bake's lines start at ${erosionLines})`,
        erosionCode + bakeCode,
        "rgba16float",
      ),
      pipe("light", lightCode, "rgba16float"),
      pipe("trace", traceCode, "rgba16float"),
      pipe("blur", blurCode, "rgba16float"),
      pipe("show", showCode, format),
    ]);

  const soft = device.createSampler({
    magFilter: "linear",
    minFilter: "linear",
  });
  const heights = picture(BAKED, BAKED, "rgba16float");
  const shadows = picture(LIT, LIT, "rgba16float");
  const riverPicture = picture(CELLS, CELLS, "rgba8unorm");
  const bind = (p: GPURenderPipeline, ...resources: GPUBindingResource[]) =>
    device.createBindGroup({
      layout: p.getBindGroupLayout(0),
      entries: resources.map((resource, binding) => ({ binding, resource })),
    });
  const bakeBind = bind(bakePipe, { buffer: landBuffer });
  const lightBind = bind(
    lightPipe,
    { buffer: sunBuffer },
    heights.createView(),
    soft,
  );
  const traceBind = bind(
    tracePipe,
    { buffer: paramsBuffer },
    heights.createView(),
    shadows.createView(),
    riverPicture.createView(),
    soft,
  );

  // one full-screen pass into a picture
  const draw = (
    encoder: GPUCommandEncoder,
    view: GPUTextureView,
    p: GPURenderPipeline,
    group: GPUBindGroup,
  ) => {
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view, loadOp: "clear", storeOp: "store" }],
    });
    pass.setPipeline(p);
    pass.setBindGroup(0, group);
    pass.draw(3);
    pass.end();
  };

  const sunDir = () => {
    const az = (look.light.sunTurn * Math.PI) / 180;
    const el = (look.light.sunHeight * Math.PI) / 180;
    return [
      Math.sin(az) * Math.cos(el),
      Math.sin(el),
      Math.cos(az) * Math.cos(el),
    ];
  };
  // the shadows the mountains throw, for the sun as it stands
  const relight = () => {
    device.queue.writeBuffer(
      sunBuffer,
      0,
      new Float32Array([...sunDir(), LIT]),
    );
    const encoder = device.createCommandEncoder();
    draw(encoder, shadows.createView(), lightPipe, lightBind);
    device.queue.submit([encoder.finish()]);
    state.bakes++;
  };
  // the mountains themselves
  const SWING = 2.2; // how often the valley swings
  const PHASE = 0.5;
  const rebake = () => {
    const { land: l, gullies: g } = look;
    land.set([l.seed * 17.13, l.seed * 5.71, l.shapes, l.rough], 0);
    land.set([l.far, l.near, l.lift, l.relief], 4);
    land.set([l.floor, l.foot, l.swing, SWING], 8);
    land.set([PHASE, l.middle, l.bumps, l.ragged], 12);
    land.set([g.width, g.strength, g.weight, g.detail], 16);
    land.set([g.ridges, g.creases, 0.1, 2], 20);
    land.set([g.onset, g.onset, 2.8, 1.5], 24);
    land.set([g.slope, 1, 0.7, 0.5], 28);
    land.set([g.octaves, 2, 0.5, BAKED], 32);
    device.queue.writeBuffer(landBuffer, 0, land);
    const encoder = device.createCommandEncoder();
    draw(encoder, heights.createView(), bakePipe, bakeBind);
    device.queue.submit([encoder.finish()]);
    relight();
  };
  // the most the gullies can add to or take from a height, and so how high the land can stand
  const worn = () => {
    const g = look.gullies;
    let sum = 0;
    for (let i = 0; i < g.octaves; i++) sum += 0.5 ** i;
    return g.strength * g.width * sum;
  };

  let field = makeField(look.river.seed, REACH);
  let fresh = true; // the river's picture has changed and is to be sent
  let whole = true; // all of it, as the river is a new one
  const restart = () => {
    const t0 = performance.now();
    field = makeField(look.river.seed, REACH);
    field.step(WARM, 8);
    fresh = true;
    whole = true;
    state.warmMs = performance.now() - t0;
  };

  let target: GPUTexture | null = null;
  let glow: GPUTexture[] = [];
  let blurBinds: GPUBindGroup[] = [];
  let showBind: GPUBindGroup | null = null;
  const fit = () => {
    const w = Math.max(4, Math.round(canvas.width * look.picture.res));
    const h = Math.max(4, Math.round(canvas.height * look.picture.res));
    if (target && target.width === w && target.height === h) return;
    target?.destroy();
    glow.forEach((g) => g.destroy());
    target = picture(w, h, "rgba16float");
    const gw = Math.ceil(w / 4);
    const gh = Math.ceil(h / 4);
    glow = [picture(gw, gh, "rgba16float"), picture(gw, gh, "rgba16float")];
    // smaller, then smeared across, then down: the soft picture ends up in the first of the two
    blurBinds = [target, glow[0], glow[1]].map((from, i) =>
      bind(blurPipe, { buffer: blurBuffers[i] }, from.createView(), soft),
    );
    showBind = bind(
      showPipe,
      { buffer: shownBuffer },
      target.createView(),
      glow[0].createView(),
      soft,
    );
  };

  const camera = new PerspectiveCamera(24, 1, 0.1, 100);
  camera.position.set(2.68, 3.1, 5.52);
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, -0.05, 0);
  controls.enableDamping = true;
  controls.update();

  const state = {
    frame: 0,
    steps: 0, // steps the river has taken since the page opened
    hold: false, // stops the river, for the tools
    bakes: 0,
    warmMs: 0, // what the river's past took to make
    simMs: 0, // the river's share of a frame
    gpuMs: 0, // from handing a frame to the GPU until it is done
    cuts: 0,
    lakes: 0,
  };
  restart();
  rebake();

  // Runs the river on without drawing, for the tools: the same picture every time for the same steps.
  const skip = (steps: number) => {
    field.step(Math.round(steps), 4);
    state.steps += Math.round(steps);
    fresh = true;
  };

  const gui = new GUI({ title: "terrain" });
  gui.close();
  for (const group of Object.keys(look) as Group[]) {
    const folder = gui.addFolder(group);
    folder.close();
    const values = look[group] as unknown as Record<string, number>;
    for (const k of Object.keys(values)) {
      const r = ranges[`${group}.${k}`];
      const c = r
        ? folder.add(values, k, r[0], r[1], r[2])
        : folder.add(values, k);
      c.onChange(() => refresh(group, k));
    }
  }
  // what has to be made again when a value changes
  const refresh = (group?: Group, key?: string) => {
    if (!group || group === "land" || group === "gullies") rebake();
    else if (key === "sunTurn" || key === "sunHeight") relight();
    if (!group || (group === "river" && key === "seed")) restart();
  };
  const stats = new Stats();
  stats.dom.id = "stats";
  document.body.appendChild(stats.dom);
  Object.assign(window, {
    __terrain: {
      look,
      state,
      refresh,
      skip,
      camera,
      controls,
      device,
      get field() {
        return field;
      },
    },
  });

  let lag = 0; // the part of a step not yet taken
  let seconds = 0; // the page's own clock: the sketch's starts again every loop, and the fog must not jump
  wrap.render = ({ deltaTime }) => {
    seconds += Math.min(deltaTime, 50) / 1000;
    const { river: r, light, air, picture: pic } = look;
    if (pic.turn !== 0) {
      const a = (pic.turn * deltaTime) / 1000;
      const p = camera.position.clone().sub(controls.target);
      p.applyAxisAngle(camera.up, a);
      camera.position.copy(controls.target).add(p);
    }
    controls.update();
    fit();

    // the river moves on, and its picture is sent again
    const t0 = performance.now();
    if (!state.hold) {
      lag += (r.speed * Math.min(deltaTime, 50) * 60) / 1000;
      const n = Math.floor(lag);
      lag -= n;
      if (n > 0) {
        field.step(n);
        state.steps += n;
        fresh = true;
      }
    }
    if (fresh) {
      // (whole the first time, then only the rows the river has been to)
      const data = field.encode() as Uint8Array<ArrayBuffer>;
      const from = whole ? 0 : Math.max(field.rows[0], 0);
      const to = whole ? CELLS - 1 : field.rows[1];
      if (to >= from)
        device.queue.writeTexture(
          { texture: riverPicture, origin: [0, from] },
          data,
          { offset: from * CELLS * 4, bytesPerRow: CELLS * 4 },
          [CELLS, to - from + 1],
        );
      fresh = false;
      whole = false;
    }
    state.simMs += (performance.now() - t0 - state.simMs) * 0.1;
    state.cuts = field.cuts;
    state.lakes = field.lakes;

    const w = target!.width;
    const h = target!.height;
    camera.aspect = w / h;
    camera.updateMatrixWorld();
    const e = camera.matrixWorld.elements;
    const tan = Math.tan((camera.fov * Math.PI) / 360);
    const tops = 2 * look.land.relief * (look.land.far + worn());
    params.set([w, h, state.frame, seconds], 0);
    params.set([e[12], e[13], e[14], 0], 4);
    params.set([e[0], e[1], e[2], tan * camera.aspect], 8);
    params.set([e[4], e[5], e[6], tan], 12);
    params.set([-e[8], -e[9], -e[10], 0], 16);
    params.set([...sunDir(), light.sun], 20);
    params.set(
      [
        UNDER,
        2 * look.land.relief * (look.land.far + 2 * worn()) + 0.03,
        light.sky,
        light.shade,
      ],
      24,
    );
    params.set([r.level, r.depth, r.bank, field.river.time], 28);
    params.set([OLD, FRESH, AGE0, SPAN], 32);
    params.set([look.land.swing, SWING, PHASE, look.land.middle], 36);
    params.set([r.bars, r.barSteps, r.barTint, pic.steps ? 1 : 0], 40);
    params.set([air.fog, air.fogHigh, air.wisps, air.wispSize], 44);
    params.set([air.haze, air.forward, seconds * air.drift, air.fogLight], 48);
    params.set([tops, light.trees, light.snow, air.fogRiver], 52);
    params.set([r.ripples, air.fogFill, 0, 0], 56);
    device.queue.writeBuffer(paramsBuffer, 0, params);

    const gw = glow[0].width;
    const gh = glow[0].height;
    const wide = (pic.glowWide * 0.004 * gh) / 7; // the smear reaches this many cells, over its 7 taps a side
    [
      [0, 0],
      [wide / gw, 0],
      [0, wide / gh],
    ].forEach((s, i) =>
      device.queue.writeBuffer(
        blurBuffers[i],
        0,
        new Float32Array([s[0], s[1], gw, gh]),
      ),
    );
    shown.set([canvas.width, canvas.height, pic.exposure, state.frame], 0);
    shown.set([pic.glow, pic.contrast, pic.colour, pic.grain], 4);
    device.queue.writeBuffer(shownBuffer, 0, shown);

    const encoder = device.createCommandEncoder();
    draw(encoder, target!.createView(), tracePipe, traceBind);
    draw(encoder, glow[0].createView(), blurPipe, blurBinds[0]);
    draw(encoder, glow[1].createView(), blurPipe, blurBinds[1]);
    draw(encoder, glow[0].createView(), blurPipe, blurBinds[2]);
    draw(
      encoder,
      context.getCurrentTexture().createView(),
      showPipe,
      showBind!,
    );
    device.queue.submit([encoder.finish()]);
    const sent = performance.now();
    device.queue.onSubmittedWorkDone().then(() => {
      state.gpuMs += (performance.now() - sent - state.gpuMs) * 0.1;
    });
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
