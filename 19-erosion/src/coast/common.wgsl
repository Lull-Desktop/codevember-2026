// Put in front of every shader of the page. x runs inland from the sea, y up, z along the coast towards the eye; metres.
// Everything is drawn in the eye's own frame: the eye stands still and the coast goes away from it.

struct Frame {
  eye: vec4f,   // .w: how steep the ground is at the person, to their right
  right: vec4f, // .w: half the picture's width at distance 1
  up: vec4f,    // .w: half its height
  ahead: vec4f, // .w: and along their way
  size: vec4f,  // the picture's width and height; which frame of a still this is; how far through the loop, 0 … 1
  sun: vec4f,   // towards the sun; how big it is (tangent of its radius)
  sunTone: vec4f, // its colour; how much the clouds shade
  map: vec4f,   // where the maps start in x; their length in x and in z; size of a cell
  coast: vec4f, // how far along the coast the eye is, in all and within this loop; how the coast bends; a bay's length
  sea: vec4f,   // seconds; the tide now; where the water's grid ends inland; depth out at sea
  low: vec4f,   // sky: at the horizon under the sun; how bright the sky is
  side: vec4f,  // at the horizon away from it; how much cloud
  mid: vec4f,   // a little above the horizon; how far up that is
  top: vec4f,   // overhead; how much light comes back off the sand
  cool: vec4f,  // the sky's light as it falls on things; how much of it is that, not the sky as seen
  sand: vec4f,  // the sand; how rough it looks to the light
  water: vec4f, // the water's own colour; how rough it is
  haze: vec4f,  // how thick it is; how fast it thins with height; how much the sand's face shows in the shade; the highest ground
  mist: vec4f,  // banks of mist: how thick; how high; how patchy; how much sun they catch
  drift: vec4f, // blown sand: how thick; how far it goes; how high; how streaky
  fine: vec4f,  // ripples: height, wavelength; how swelling and mottled the sand is; its grain
  hills: vec4f, // the far hills: colour; how high
  walk: vec4f,  // the person: place on the ground, how tall
  pose: vec4f,  // their step (radians); lean; stride; which way they face
  more: vec4f,  // spray; the colour of shallow water
  more2: vec4f, // how many pixels of the picture one of the air's is wide; which half of the bounced light is made anew (-1: all)
  way: array<vec4f, 16>, // the line they keep: 64 places over a loop, in the maps' x
};
@group(0) @binding(0) var<uniform> F: Frame;

const TAU = 6.2831853;

// (QUICK is put before this by index.ts: where there is a lot of noise a pixel, a plainer way of scattering will do)
fn pcg(v: u32) -> u32 {
  if (QUICK) {
    let q = (v ^ (v >> 15u)) * 747796405u;
    return q ^ (q >> 16u);
  }
  let s = v * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
fn h1(v: u32) -> f32 {
  return f32(pcg(v)) * (1.0 / 4294967296.0);
}
fn h2(x: i32, y: i32, salt: u32) -> f32 {
  return h1((u32(x) * 1597334677u) ^ (u32(y) * 3812015801u) ^ (salt * 2798796415u));
}
// noise that repeats after n cells in its first direction
fn wrapNoise(p: vec2f, n: i32, salt: u32) -> f32 {
  let i = vec2i(floor(p));
  let f = fract(p);
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  let x0 = ((i.x % n) + n) % n;
  let x1 = (((i.x + 1) % n) + n) % n;
  return mix(mix(h2(x0, i.y, salt), h2(x1, i.y, salt), u.x), mix(h2(x0, i.y + 1, salt), h2(x1, i.y + 1, salt), u.x), u.y);
}
// and after n cells in both
fn wrapBoth(p: vec2f, n: vec2i, salt: u32) -> f32 {
  let i = vec2i(floor(p));
  let f = fract(p);
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  let a = ((i % n) + n) % n;
  let b = (((i + 1) % n) + n) % n;
  return mix(mix(h2(a.x, a.y, salt), h2(b.x, a.y, salt), u.x), mix(h2(a.x, b.y, salt), h2(b.x, b.y, salt), u.x), u.y);
}
// the same, with its slopes: value, d/dx, d/dy
fn wrapSlope(p: vec2f, n: vec2i, salt: u32) -> vec3f {
  let i = vec2i(floor(p));
  let f = fract(p);
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  let du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
  let a = ((i % n) + n) % n;
  let b = (((i + 1) % n) + n) % n;
  let h00 = h2(a.x, a.y, salt);
  let h10 = h2(b.x, a.y, salt);
  let h01 = h2(a.x, b.y, salt);
  let h11 = h2(b.x, b.y, salt);
  return vec3f(mix(mix(h00, h10, u.x), mix(h01, h11, u.x), u.y), du.x * mix(h10 - h00, h11 - h01, u.y), du.y * mix(h01 - h00, h11 - h10, u.x));
}
// noise of slopes, not of heights, which shows less of its grid; repeats after n cells in its first direction: value
// (about -0.7 … 0.7), d/dx, d/dy
fn slopeWay(x: i32, y: i32, salt: u32) -> vec2f {
  let a = h2(x, y, salt) * TAU;
  return vec2f(cos(a), sin(a));
}
fn wrapHill(p: vec2f, n: i32, salt: u32) -> vec3f {
  let i = vec2i(floor(p));
  let f = fract(p);
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  let du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
  let x0 = ((i.x % n) + n) % n;
  let x1 = (((i.x + 1) % n) + n) % n;
  let ga = slopeWay(x0, i.y, salt);
  let gb = slopeWay(x1, i.y, salt);
  let gc = slopeWay(x0, i.y + 1, salt);
  let gd = slopeWay(x1, i.y + 1, salt);
  let a = dot(ga, f);
  let b = dot(gb, f - vec2f(1.0, 0.0));
  let c = dot(gc, f - vec2f(0.0, 1.0));
  let d = dot(gd, f - vec2f(1.0, 1.0));
  let v = mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  let g = mix(mix(ga, gb, u.x), mix(gc, gd, u.x), u.y) + du * vec2f(mix(b - a, d - c, u.y), mix(c - a, d - b, u.x));
  return vec3f(v, g);
}
// cells round scattered points, as bubbles lie: how far in from the wall a place is (0 on it), and which cell. Repeats
// after n cells in its first direction.
fn bubbles(p: vec2f, n: i32, salt: u32) -> vec2f {
  let i = vec2i(floor(p));
  var d1 = 9.0;
  var d2 = 9.0;
  var which = 0.0;
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let c = i + vec2i(x, y);
      let cx = ((c.x % n) + n) % n;
      let o = vec2f(h2(cx, c.y, salt), h2(cx, c.y, salt + 1u));
      let d = length(vec2f(c) + 0.1 + 0.8 * o - p);
      if (d < d1) {
        d2 = d1;
        d1 = d;
        which = o.x;
      } else if (d < d2) {
        d2 = d;
      }
    }
  }
  return vec2f(d2 - d1, which);
}
fn fbmWrap(p: vec2f, n: i32, salt: u32) -> f32 {
  return 0.5 * wrapNoise(p, n, salt) + 0.25 * wrapNoise(p * 2.0 + vec2f(0.0, 7.3), n * 2, salt + 1u) + 0.125 * wrapNoise(p * 4.0 + vec2f(0.0, 3.1), n * 4, salt + 2u) + 0.0625 * wrapNoise(p * 8.0, n * 8, salt + 3u);
}

// what bake.wgsl makes: how many cells each of the four noises has; what of the clouds and of the hills is kept
const TILES = array<vec2f, 4>(vec2f(4.0, 16.0), vec2f(11.0, 32.0), vec2f(18.0, 32.0), vec2f(31.0, 31.0));
const TILE_LAST = array<i32, 4>(2, 8, 2, 4);
const TILE_SALT = array<u32, 4>(91u, 93u, 71u, 72u);
// the sand's noises: cells along the coast (those of the swells, all but the last, are cells a bay) and inland
const GRAINS = array<vec2f, 8>(vec2f(5.0, 32.0), vec2f(13.0, 32.0), vec2f(37.0, 32.0), vec2f(16.0, 32.0), vec2f(7.0, 32.0), vec2f(22.0, 32.0), vec2f(9.0, 32.0), vec2f(34.0, 32.0));
const GRAIN_SALT = array<u32, 8>(181u, 182u, 183u, 184u, 41u, 45u, 47u, 61u);
const GRAIN_WIDE = 512.0; // pixels
const CAST = 128.0; // pixels of the picture of the person from the sun's side
const CLOUD_FROM = vec2f(-5.4, -1.7);
const CLOUD_WIDE = vec2f(12.8, 9.6);
const HILL_FROM = vec2f(-1.2, 0.0);
const HILL_WIDE = vec2f(4.3416, 0.22);

// the sky, without clouds; smooth enough to light the sand by
fn skyTone(d: vec3f) -> vec3f {
  let flat = normalize(vec3f(d.x, 0.0, d.z) + vec3f(1e-5, 0.0, 0.0));
  let sunFlat = normalize(vec3f(F.sun.x, 0.0, F.sun.z));
  let a = dot(flat, sunFlat) * 0.5 + 0.5;
  let e = max(d.y, 0.0);
  let hor = mix(F.side.rgb, F.low.rgb, a * a * a);
  var col = mix(hor, F.mid.rgb * mix(0.86, 1.06, a), smoothstep(0.0, F.mid.w, e));
  col = mix(col, F.top.rgb, smoothstep(F.mid.w * 0.8, F.mid.w * 3.4, e));
  let m = max(dot(d, F.sun.xyz), 0.0);
  col += F.low.rgb * (0.14 * pow(m, 6.0) + 0.7 * pow(m, 60.0));
  return col * F.low.w;
}
fn skyFall(d: vec3f) -> vec3f {
  return mix(skyTone(d), F.cool.rgb * (0.65 + 0.6 * max(d.y, 0.0)), F.cool.w);
}

// the swell that comes in from the sea: height over still water. Each wave's speed and slant are such that a loop
// later, one bay along, it is the same.
const SWELL = array<vec3f, 7>(vec3f(0.42, 4.0, 0.0), vec3f(0.28, 5.0, 1.0), vec3f(0.24, 3.0, -1.0), vec3f(0.14, 7.0, 2.0), vec3f(0.10, 9.0, -2.0), vec3f(0.06, 11.0, 3.0), vec3f(0.04, 14.0, -3.0));
fn swellAt(x: f32, z: f32, t: f32, speed: f32) -> f32 {
  var sum = 0.0;
  for (var i = 0; i < 7; i++) {
    let s = SWELL[i];
    let w = TAU * (s.y - s.z / 8.0) / 40.0;
    sum += s.x * cos(w * (t - (x + 95.0) / speed) + TAU * s.z * z / 480.0 + f32(i) * 1.7);
  }
  return sum * 1.35;
}
