// Labyrinth: a man walks straight on through a labyrinth that never stops rearranging itself. Walls sink and
// rise everywhere; the one in front of him is down just before he gets there. He never slows down. It is the
// whole maze that moves, and he is only lucky. See maze.ts for how the maze is made and why it loops.
import type { Sketch, SketchSettings } from "ssam";
import { ssam } from "ssam";
import GUI from "three/examples/jsm/libs/lil-gui.module.min.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import Stats from "three/examples/jsm/libs/stats.module.js";
import { bloom } from "three/examples/jsm/tsl/display/BloomNode.js";
import * as TSL from "three/tsl";
import { BoxGeometry, Color, DataTexture, LinearFilter, Mesh, NearestFilter, RGBAFormat, MeshBasicNodeMaterial, NoToneMapping, PerspectiveCamera, PlaneGeometry, RenderPipeline, RepeatWrapping, Scene, UnsignedByteType, Vector3, Vector4, WebGPURenderer } from "three/webgpu";
import { concrete } from "./concrete.ts";
import { createMan, METRE, type Tone } from "./man.ts";
import { createHilbert, hilbertDefaults } from "./hilbert.ts";
import { createMaze, mazeDefaults } from "./maze.ts";
import lightCode from "./light.wgsl?raw";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const T: Record<string, any> = TSL;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;
const { abs, cameraPosition, clamp, dot, exp, float, floor, Fn, fract, fwidth, instanceIndex, length, Loop, max, min, mix, normalize, normalLocal, normalWorld, pass, positionLocal, positionWorld, pow, sampler, screenCoordinate, screenUV, select, sin, smoothstep, texture, uniform, uniformArray, varying, vec2, vec3, vec4, wgslFn } = T;

const PACE = 0.8; // cells a second: 1.28 m/s
const LOOP = mazeDefaults.H / PACE; // seconds
const STRIDES = Math.round((mazeDefaults.H / METRE) / 1.42); // whole strides in a loop
// the walls that are drawn: a window of cells that goes with him
const SIDE = 44;
const BACK = 14;
const FRONT = 50;

export const look = {
  // how the walls move. hilbert: all of them on one Hilbert curve, travelling along it (he goes through them).
  // doors: a perfect maze whose free-ended walls slide a slot and back, and open for him
  walls: "hilbert" as "hilbert" | "doors",
  flow: hilbertDefaults.flow, // hilbert: how many 32-slot stretches of the curve pass a point in a loop; negative runs the other way
  pulse: hilbertDefaults.pulse, // hilbert: 0 steady, 1 a slot at a time with a rest between
  // the maze (changing these makes it again)
  seed: mazeDefaults.seed,
  restless: mazeDefaults.restless, // outings tried per door per loop
  drama: mazeDefaults.drama, // how often a door from beside his way comes to stand in it before he gets there
  // walls
  wallHeight: 2.2, // cells
  thick: 0.22,
  // the sun: degrees above the horizon, and degrees east of straight ahead
  sunUp: 52,
  sunTurn: -6,
  sunSoft: 0.015,
  sun: 2.0,
  sky: 0.14,
  fill: 0.003, // light from nowhere, so that nothing is quite black
  pool: 0.5, // a soft light from straight above that goes with him
  poolWide: 1.3, // cells
  gloss: 0.5, // how much the ground and the tops of walls shine toward the sun
  wallTone: 0.36,
  floorTone: 0.3,
  // air
  haze: 0.18,
  hazeFrom: 9, // cells from the eye where the haze begins
  hazeLow: 1.6, // the air is thickest near the ground: the height over which it thins
  hazeTone: 1.5,
  // camera: where it stands from a point a little ahead of him
  fov: 55,
  pitch: 54,
  turn: 0,
  dist: 11.5,
  ahead: 2,
  // the print
  exposure: 1,
  bloom: 0.08,
  vignette: 0.85,
  grain: 0.04,
};
const ranges: Record<string, [number, number, number?]> = {
  flow: [-3, 3, 1],
  pulse: [0, 1, 0.01],
  seed: [1, 99, 1],
  restless: [0, 12, 0.1],
  drama: [0, 1, 0.01],
  wallHeight: [0.5, 4, 0.05],
  thick: [0.06, 0.4, 0.01],
  sunUp: [8, 80, 1],
  sunTurn: [-60, 60, 1],
  sunSoft: [0.005, 0.12, 0.005],
  sun: [0, 8, 0.1],
  sky: [0, 2, 0.01],
  fill: [0, 0.3, 0.005],
  pool: [0, 3, 0.01],
  poolWide: [0.3, 5, 0.05],
  gloss: [0, 2, 0.01],
  wallTone: [0.05, 0.9, 0.01],
  floorTone: [0.05, 0.9, 0.01],
  haze: [0, 1, 0.005],
  hazeFrom: [0, 40, 0.5],
  hazeLow: [0.3, 10, 0.1],
  hazeTone: [0, 4, 0.05],
  fov: [15, 70, 1],
  pitch: [10, 89, 1],
  turn: [-180, 180, 1],
  dist: [4, 60, 0.5],
  ahead: [-6, 12, 0.1],
  exposure: [0.2, 3, 0.01],
  bloom: [0, 1.5, 0.01],
  vignette: [0, 1.5, 0.01],
  grain: [0, 0.3, 0.005],
};
const remake = new Set(["walls", "flow", "pulse", "seed", "restless", "drama"]);
const reframe = new Set(["fov", "pitch", "turn", "dist", "ahead"]);

const sketch: Sketch<"webgpu"> = async ({ wrap, canvas, width, height, pixelRatio }) => {
  if (import.meta.hot) {
    import.meta.hot.dispose(() => wrap.dispose());
    import.meta.hot.accept(() => wrap.hotReload());
  }

  const renderer = new WebGPURenderer({ canvas, antialias: false });
  renderer.setPixelRatio(Math.min(pixelRatio, 1.5)); // (four samples a pixel already)
  renderer.setSize(width, height);
  renderer.toneMapping = NoToneMapping;
  await renderer.init();

  // ---- the maze, and where its walls are over the loop as a sheet: a row per cell, time across
  const build = () => {
    if (look.walls === "hilbert") return { ...createHilbert({ seed: look.seed, flow: look.flow, pulse: look.pulse }), hilbert: true };
    const m = createMaze({ seed: look.seed, restless: look.restless, drama: look.drama });
    // which slots are a wall's home (a wall seen in any other slot is a visitor from the slot next to it)
    const home = new Uint8Array(m.cells * 4);
    for (let c = 0; c < m.cells; c++) home.set([m.home[c * 2], m.home[c * 2 + 1]], c * 4);
    return { W: m.W, H: m.H, cells: m.cells, col: m.col, samples: m.samples, sheet: m.sheet, home, shift: (_: number) => 0, hilbert: false };
  };
  let maze = build();
  const { W, H } = maze;
  const sheet = new DataTexture(maze.sheet, maze.samples, maze.cells, RGBAFormat, UnsignedByteType);
  sheet.wrapS = RepeatWrapping;
  sheet.magFilter = sheet.minFilter = LinearFilter;
  sheet.generateMipmaps = false;
  sheet.needsUpdate = true;
  // what the vertex shader has to know about each slot that does not change (see `build` and hilbert.ts)
  const homes = new DataTexture(maze.home, W, H, RGBAFormat, UnsignedByteType);
  homes.magFilter = homes.minFilter = NearestFilter;
  homes.generateMipmaps = false;
  homes.needsUpdate = true;
  const stone = concrete(512);

  // ---- light
  const U = {
    sun: uniform(new Vector4()),
    dim: uniform(new Vector4(W, H, look.wallHeight, look.thick)),
    tim: uniform(new Vector4()),
    sunPower: uniform(look.sun),
    sky: uniform(look.sky),
    fill: uniform(look.fill),
    gloss: uniform(look.gloss),
    wallTone: uniform(look.wallTone),
    floorTone: uniform(look.floorTone),
    haze: uniform(look.haze),
    hazeLow: uniform(look.hazeLow),
    hazeFrom: uniform(look.hazeFrom),
    hazeTone: uniform(look.hazeTone),
    rowBase: uniform(0),
    exposure: uniform(look.exposure),
    vignette: uniform(look.vignette),
    grain: uniform(look.grain),
    frame: uniform(0),
    man: uniform(new Vector3()),
    hilbert: uniform(maze.hilbert ? 1 : 0),
    flow: uniform(0),
    pool: uniform(look.pool),
    poolWide: uniform(look.poolWide),
  };
  const sheetNode = texture(sheet);
  const visFn = wgslFn(lightCode.replace(/^(\s*\/\/[^\n]*\n)+/, ""));
  const vis = (p: N, n: N) => visFn({ pw: p, nw: n, sheet: sheetNode, smp: sampler(sheetNode), sun: U.sun, dim: U.dim, tim: U.tim });

  // ---- the man
  const tones: Record<Tone, [number, number]> = { coat: [0.035, 0.1], cloth: [0.05, 0.04], shoe: [0.02, 0.05], skin: [0.42, 0.05], hair: [0.05, 0.08] };
  const manMaterial = (tone: Tone) => {
    const m = new MeshBasicNodeMaterial();
    const n = normalize(normalWorld);
    // the sun's shadow is asked for where he is; the sky, as if he faced up (he stands in the same slot of sky all round)
    const up = vec3(0, 1, 0);
    const v = vis(positionWorld, up);
    const toSun = U.sun.xyz;
    const eye = normalize(cameraPosition.sub(positionWorld));
    const wrapLight = max(dot(n, toSun).mul(0.75).add(0.25), 0);
    const skyShare = n.y.mul(0.35).add(0.65);
    const rim = pow(float(1).sub(max(dot(n, eye), 0)), 3).mul(tones[tone][1]);
    const lit = float(tones[tone][0])
      .mul(U.sunPower.mul(v.x).mul(wrapLight).add(U.sky.mul(v.y).mul(skyShare).mul(1.6)).add(U.fill).add(U.pool.mul(n.y.mul(0.6).add(0.4))))
      .add(rim.mul(U.sunPower.mul(v.x).mul(0.6).add(U.sky.mul(v.y))));
    m.colorNode = vec3(lit);
    return m;
  };
  const man = createMan(manMaterial);

  const capsA = uniformArray(man.capsA);
  const capsB = uniformArray(man.capsB);
  // his shadow: a capsule's, as soft as it is far (after Quilez)
  const capFn = wgslFn(`fn mzCap(ro: vec3f, rd: vec3f, a: vec4f, b: vec4f, soft: f32) -> f32 {
    let ba = b.xyz - a.xyz;
    let oa = ro - a.xyz;
    let oad = dot(oa, rd);
    let dba = dot(rd, ba);
    let baba = dot(ba, ba);
    let oaba = dot(oa, ba);
    var t = vec2f(-oad * baba + dba * oaba, oaba - oad * dba) / max(baba - dba * dba, 1e-6);
    t.x = max(t.x, 0.0001);
    t.y = clamp(t.y, 0.0, 1.0);
    let d = length(a.xyz + ba * t.y - ro - rd * t.x) - a.w;
    let s = clamp(0.5 * d / (t.x * soft + 0.003) + 0.5, 0.0, 1.0);
    return s * s * (3.0 - 2.0 * s);
  }`);
  const manShadow = (p: N) => {
    const lit = float(1).toVar();
    Loop(man.count, ({ i }: { i: N }) => {
      lit.mulAssign(capFn({ ro: p, rd: U.sun.xyz, a: capsA.element(i), b: capsB.element(i), soft: U.sun.w }));
    });
    // and what he takes of the sky from the ground under him
    const near = length(p.xz.sub(U.man.xz));
    return vec2(lit, float(1).sub(exp(near.mul(near).mul(-14)).mul(0.45).mul(exp(p.y.mul(-3)))));
  };

  // the light on a surface of tone `albedo`, then the air between it and the eye
  const shade = (albedo: N, p: N, n: N, opts: { gloss?: N; byMan?: boolean; sheen?: N } = {}) => {
    const v = vis(p, n).toVar();
    const toSun = U.sun.xyz;
    const eye = normalize(cameraPosition.sub(p));
    let sun = v.x;
    let sky = v.y;
    if (opts.byMan) {
      const m = manShadow(p).toVar();
      sun = sun.mul(m.x);
      sky = sky.mul(m.y);
    }
    const facing = max(dot(n, toSun), 0);
    const half = normalize(toSun.add(eye));
    const shine = pow(max(dot(n, half), 0), 24).mul(opts.gloss ?? 0).mul(U.gloss);
    // a pool of light that goes with him, from straight above: the one thing here with no cause
    const away = p.xz.sub(U.man.xz.add(vec2(0, -0.3)));
    const pool = U.pool.mul(exp(dot(away, away).div(U.poolWide.mul(U.poolWide)).negate())).mul(max(n.y, 0).mul(0.8).add(0.2)).mul(v.y.div(max(v.z, 0.01)).mul(0.7).add(0.3));
    let lit = albedo.mul(U.sunPower.mul(sun).mul(facing.add(shine)).add(U.sky.mul(sky)).add(U.fill).add(pool));
    if (opts.sheen) lit = lit.add(opts.sheen.mul(pow(float(1).sub(max(dot(n, eye), 0)), 3)).mul(U.sunPower.mul(sun).mul(0.5).add(U.sky.mul(sky))));
    // air: thickest near the ground, and brightest looking toward the sun
    const ray = p.sub(cameraPosition);
    const far = length(ray);
    const drop = max(cameraPosition.y.sub(p.y), 0.01);
    const depth = U.haze.mul(max(far.sub(U.hazeFrom), 0)).mul(U.hazeLow).mul(exp(p.y.div(U.hazeLow).negate()).sub(exp(cameraPosition.y.div(U.hazeLow).negate()))).div(drop);
    const air = float(1).sub(exp(depth.negate()));
    const glow = pow(max(dot(ray.div(far), toSun), 0), 2).mul(1.2).add(0.55);
    return mix(lit, U.hazeTone.mul(glow), air);
  };

  // ---- concrete
  // (everything that depends on z repeats every 32 cells, or the loop would show: tile sizes divide 32)
  // (a wall's concrete goes with it when it slides: `along` and `across` are measured on the wall, not in the world)
  const wallTone = Fn(([p, n, top, tone, along, across, end]: N[]) => {
    const side = abs(n.y).lessThan(0.5);
    const down = top.sub(p.y);
    const run = select(end.greaterThan(0.5), across, along);
    const uv = select(side, vec2(run, down.negate()), vec2(along, across)).div(3.2).add(tone.mul(vec2(3.7, 1.3)));
    const broad = texture(stone, uv);
    const fine = texture(stone, uv.mul(8));
    const runs = texture(stone, vec2(run.div(1.6).add(tone.mul(5.1)), down.div(6.4))).a;
    const tint = float(0.74)
      .add(broad.r.mul(0.5))
      .mul(fine.g.mul(0.3).add(0.85))
      .mul(float(1).sub(broad.b.mul(0.45)))
      .mul(tone.mul(0.22).add(0.89));
    // what rain leaves: dark runs from the top, fading on the way down
    const stain = smoothstep(0.46, 0.7, runs).mul(exp(down.mul(-0.7))).mul(0.45);
    // the lines where one pour ended and the next began
    const pour = smoothstep(0.46, 0.5, abs(fract(down.div(0.8).add(0.5)).sub(0.5))).mul(0.1);
    const damp = mix(0.7, 1, smoothstep(0, 0.5, p.y));
    const worn = smoothstep(0.07, 0, down).mul(0.2);
    const sided = tint.mul(float(1).sub(stain)).mul(float(1).sub(pour)).mul(damp).add(worn);
    return U.wallTone.mul(select(side, sided, tint.mul(1.12)));
  });
  const floorTone = Fn(([p]: N[]) => {
    const uv = p.xz.div(3.2);
    const broad = texture(stone, uv.mul(0.5).add(0.37));
    const mid = texture(stone, uv.add(0.11));
    const fine = texture(stone, uv.mul(8));
    // every line of the grid is a track that walls slide along: a groove, and the strip a wall stands on worn paler
    const th = U.dim.w.mul(0.5);
    const gx = abs(fract(p.x.add(0.5)).sub(0.5));
    const gz = abs(fract(p.z.add(0.5)).sub(0.5));
    // (drawn no thinner than a pixel, and fainter for it: a line narrower than that sparkles as the camera moves)
    const track = (d: N, across: N) => {
      const px = max(fwidth(across), 0.0001);
      const wide = max(float(0.011), px.mul(0.7));
      return float(1).sub(smoothstep(wide.sub(px.mul(0.5)), wide.add(px.mul(0.5)), d)).mul(float(0.011).div(wide));
    };
    const groove = max(track(gx, p.x), track(gz, p.z)).mul(0.5);
    const lid = smoothstep(th, th.sub(0.01), min(gx, gz)).mul(0.07);
    return U.floorTone.mul(
      float(0.7)
        .add(broad.r.mul(0.6))
        .mul(fine.g.mul(0.3).add(0.85))
        .mul(float(1).sub(mid.b.mul(0.4)))
        .mul(float(1).sub(groove))
        .add(lid.mul(0.3)),
    );
  });

  // ---- walls: one box per slot of the window, drawn over whatever part of the slot is filled at this moment
  // (a wall on its way from one slot to the next is two boxes that meet at the post between)
  const COLS = SIDE * 2 + 1;
  const ROWS = BACK + FRONT;
  const box = new BoxGeometry(1, 1, 1);
  box.translate(0, 0.5, 0);
  const wallMat = new MeshBasicNodeMaterial();
  {
    const k = float(instanceIndex);
    const turned = k.mod(2); // 0: the cell's south slot, along x. 1: its west slot, along z
    const cell = floor(k.div(2));
    const i = cell.mod(COLS).add(maze.col - SIDE);
    const j = floor(cell.div(COLS)).add(U.rowBase);
    const ci = i.mod(W);
    const cj = j.mod(H);
    const row = cj.mul(W).add(ci);
    const both = texture(sheet, vec2(U.tim.x, row.add(0.5).div(W * H))).level(0);
    const from = mix(both.r, both.b, turned);
    const to = mix(both.g, both.a, turned);
    const info = texture(homes, vec2(ci.add(0.5).div(W), cj.add(0.5).div(H))).level(0);
    const some = to.sub(from).greaterThan(0.004);
    const hil = U.hilbert.greaterThan(0.5);
    // -- doors. Where a wall is joined to its other half it stops at the post; a free end goes half a thickness past it
    const isHome = mix(info.r, info.g, turned).greaterThan(0.5);
    const low = from.greaterThan(0.002); // filled from part-way: the rest of this wall is in the next slot
    const part = to.lessThan(0.998); // filled up to part-way: the rest is in the slot before
    const half = U.dim.w.mul(0.5);
    // how far the wall is from home, and which wall it is
    const shift = select(isHome, select(low, from, to.sub(1)), select(low, from.sub(1), to));
    const step = select(isHome, 0, select(low, 1, -1));
    const id = mix(cj.mul(W).add(ci.add(step).mod(W)), cj.add(step).mod(H).mul(W).add(ci), turned);
    const doorTone = fract(sin(id.mul(12.9898).add(turned.mul(78.233))).mul(43758.5453));
    // -- hilbert. Every piece goes half a thickness past both its ends, so corners are filled and nothing jumps
    // as a wall goes round one; the walls that run north are a hair lower and thinner, so that where two
    // pieces share a corner one of them wins
    const lowByte = mix(info.r, info.b, turned).mul(255).round();
    const highByte = mix(info.g, info.a, turned).mul(255).round();
    const backwards = highByte.greaterThan(127.5);
    const place = lowByte.add(highByte.mod(16).mul(256)); // which step of the curve this slot is
    // no two walls quite the same height or thickness, so that where they overlap at a corner one of them wins
    const top = U.dim.z.add(select(hil, turned.mul(-0.004), doorTone.sub(0.5).mul(0.03)));
    const thick = U.dim.w.add(select(hil, turned.mul(-0.004), fract(doorTone.mul(57.3)).sub(0.5).mul(0.012)));
    const a = from.sub(select(hil, thick.mul(0.5), select(low, 0, select(part, 0, half))));
    const b = to.add(select(hil, thick.mul(0.5), select(low, 0, half)));
    const along = mix(a, b, positionLocal.x.add(0.5));
    // every piece is a hair smaller at its far end than at its near one: where it meets the next piece of the
    // same wall, no two faces lie at the same depth (they showed as a dotted line down the joint)
    const taper = positionLocal.x.greaterThan(0).toFloat().mul(0.003);
    const wide = positionLocal.z.mul(thick.sub(taper));
    const x = mix(i.add(along), i.add(wide), turned);
    const z = mix(j.negate().add(wide), j.add(along).negate(), turned);
    wallMat.positionNode = vec3(x, select(some, mix(-0.05, top.sub(taper), positionLocal.y), -1), z);
    const n = normalize(varying(mix(normalLocal, vec3(normalLocal.z, normalLocal.y, normalLocal.x.negate()), turned)));
    const p = positionWorld;
    // measured on the wall, so that the concrete goes with it: along it (from its home, or along the curve) and across it
    const onWall = varying(select(hil, place.add(select(backwards, float(1).sub(along), along)).sub(U.flow), mix(i, j, turned).add(along).sub(shift)));
    const across = mix(p.z, p.x, varying(turned));
    const end = mix(abs(n.x), abs(n.z), varying(turned));
    // each wall its own shade of grey; on the curve, each four slots of it (eight shades, so the loop closes)
    const tone = select(hil, fract(sin(floor(onWall.div(4)).mod(8).mul(12.9898).add(3.1)).mul(43758.5453)), varying(doorTone));
    wallMat.colorNode = shade(wallTone(p, n, varying(top), tone, onWall, across, end), p, n, { gloss: select(n.y.greaterThan(0.5), 1, 0.15), byMan: true });
  }
  const walls = new Mesh(box, wallMat);
  walls.count = COLS * ROWS * 2;
  walls.frustumCulled = false;

  const floorMat = new MeshBasicNodeMaterial();
  floorMat.colorNode = shade(floorTone(positionWorld), positionWorld, vec3(0, 1, 0), { gloss: 1, byMan: true });
  const ground = new Mesh(new PlaneGeometry(COLS, ROWS).rotateX(-Math.PI / 2), floorMat);
  ground.frustumCulled = false;

  const scene = new Scene();
  scene.add(walls, ground, man.group);
  walls.renderOrder = 0;
  man.group.renderOrder = 1;
  ground.renderOrder = 2;

  // ---- camera: it goes with him
  const camera = new PerspectiveCamera(look.fov, width / height, 0.5, 300);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.minDistance = 2;
  controls.maxDistance = 70;
  const manAt = new Vector3();
  const aim = new Vector3();
  const lastAim = new Vector3();
  const place = (playhead: number) => {
    manAt.set(maze.col + 0.5, 0, -playhead * H);
    aim.set(manAt.x, 0.6, manAt.z - look.ahead);
  };
  const frameUp = () => {
    const pitch = (look.pitch * Math.PI) / 180;
    const turn = (look.turn * Math.PI) / 180;
    camera.fov = look.fov;
    camera.updateProjectionMatrix();
    camera.position.set(aim.x + look.dist * Math.sin(turn) * Math.cos(pitch), aim.y + look.dist * Math.sin(pitch), aim.z + look.dist * Math.cos(turn) * Math.cos(pitch));
    controls.target.copy(aim);
    lastAim.copy(aim);
  };
  place(0);
  frameUp();

  // ---- the print: glow, darker corners, grain
  const pipeline = new RenderPipeline(renderer);
  const drawn = pass(scene, camera, { samples: 4 });
  const picture = drawn.getTextureNode("output");
  const glow = bloom(picture, look.bloom, 0.7, 0.9);
  const print = Fn(() => {
    const c = picture.rgb.add(glow.rgb).mul(U.exposure);
    const grey = dot(c, vec3(0.2126, 0.7152, 0.0722));
    // corners fall off, the bottom of the frame most of all
    const q = screenUV.sub(vec2(0.5, 0.42));
    const corner = float(1).sub(U.vignette.mul(dot(q, q).mul(1.5).add(smoothstep(0.55, 1.05, screenUV.y).mul(0.6))));
    const toned = grey.mul(max(corner, 0));
    // a shoulder, so that the haze does not clip
    const curved = float(1).sub(exp(toned.mul(-1.25)));
    const seed = vec3(screenCoordinate.xy, U.frame).mul(vec3(0.1031, 0.103, 0.0973)).fract().toVar();
    seed.addAssign(dot(seed, seed.yzx.add(33.33)));
    const noise = fract(seed.x.add(seed.y).mul(seed.z)).sub(0.5);
    const out = curved.add(noise.mul(U.grain).mul(curved.mul(0.7).add(0.3)));
    return vec4(vec3(out), 1);
  })();
  pipeline.outputNode = print;

  const refresh = () => {
    const up = (look.sunUp * Math.PI) / 180;
    const turn = (look.sunTurn * Math.PI) / 180;
    U.sun.value.set(Math.sin(turn) * Math.cos(up), Math.sin(up), -Math.cos(turn) * Math.cos(up), look.sunSoft);
    U.dim.value.set(W, H, look.wallHeight, look.thick);
    U.sunPower.value = look.sun;
    U.sky.value = look.sky;
    U.fill.value = look.fill;
    U.gloss.value = look.gloss;
    U.pool.value = look.pool;
    U.poolWide.value = look.poolWide;
    U.wallTone.value = look.wallTone;
    U.floorTone.value = look.floorTone;
    U.haze.value = look.haze;
    U.hazeLow.value = look.hazeLow;
    U.hazeFrom.value = look.hazeFrom;
    U.hazeTone.value = look.hazeTone;
    U.exposure.value = look.exposure;
    U.vignette.value = look.vignette;
    U.grain.value = look.grain;
    glow.strength.value = look.bloom;
    renderer.setClearColor(new Color(1, 1, 1).multiplyScalar(look.hazeTone * 1.2));
  };
  const rebuild = () => {
    maze = build();
    sheet.image.data = maze.sheet;
    sheet.needsUpdate = true;
    homes.image.data = maze.home;
    homes.needsUpdate = true;
    U.hilbert.value = maze.hilbert ? 1 : 0;
  };
  refresh();

  const gui = new GUI({ title: "labyrinth" });
  gui.close();
  for (const k of Object.keys(look) as (keyof typeof look)[]) {
    const c = k === "walls" ? gui.add(look, k, ["hilbert", "doors"]) : gui.add(look, k, ...(ranges[k] as [number, number, number]));
    if (remake.has(k)) c.onFinishChange(rebuild);
    else if (reframe.has(k)) c.onChange(() => frameUp());
    else c.onChange(refresh);
  }
  const stats = new Stats();
  stats.dom.style.cssText = "position:fixed;top:0;left:0";
  canvas.after(stats.dom);

  const state = { hold: -1, frame: 0, pause: false, view: null as number[] | null };
  Object.assign(window, { __labyrinth: { look, state, refresh, rebuild, frameUp, maze: () => maze, man, camera, controls, renderer, scene, U } });

  wrap.render = ({ playhead }) => {
    if (state.pause) return;
    const ph = state.hold >= 0 ? state.hold : playhead;
    place(ph);
    if (state.view) {
      const [turn, pitch, dist = look.dist] = state.view;
      const a = (turn * Math.PI) / 180;
      const b = (pitch * Math.PI) / 180;
      camera.position.set(aim.x + dist * Math.sin(a) * Math.cos(b), aim.y + dist * Math.sin(b), aim.z + dist * Math.cos(a) * Math.cos(b));
      controls.target.copy(aim);
      camera.lookAt(aim);
    } else {
      // the camera keeps whatever place the viewer has dragged it to, relative to him
      camera.position.add(aim).sub(lastAim);
      controls.target.copy(aim);
      controls.update();
    }
    lastAim.copy(aim);

    man.group.position.copy(manAt);
    man.group.rotation.y = 0;
    man.pose(ph * STRIDES, (H / METRE) / STRIDES);
    U.man.value.copy(manAt);
    U.tim.value.x = ph + 0.5 / maze.samples;
    U.flow.value = maze.shift(ph);
    U.rowBase.value = Math.floor(ph * H) - BACK;
    ground.position.set(maze.col + 0.5, 0, -(Math.floor(ph * H) - BACK + ROWS / 2) + 0.5);
    U.frame.value = Math.floor(ph * LOOP * 60) % 1024;

    pipeline.render();
    stats.update();
    state.frame++;
  };

  wrap.resize = ({ width, height }) => {
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
  };

  wrap.unload = () => {
    renderer.dispose();
    controls.dispose();
    gui.destroy();
    stats.dom.remove();
  };
};

const settings: SketchSettings = {
  mode: "webgpu",
  pixelRatio: window.devicePixelRatio,
  animate: true,
  duration: LOOP * 1000,
  exportFps: 60,
  framesFormat: ["webm"],
};

ssam(sketch, settings);
