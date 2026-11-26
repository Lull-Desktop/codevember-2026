// A Möbius band of layered sandstone, ray marched, with a wave of erosion going round it for ever.
//
// The band is a rectangle swept round a circle with half a turn. Its rock is in level layers, some soft and
// some hard. Where the wave has passed, three things happen at three sizes and speeds: the soft layers sink
// back between the hard ones; small pits open, quickly; and large hollows grow, slowly, until they go right
// through and leave bridges. Far behind the wave the rock closes again, so that by the time the wave has come
// round, the band is whole for it.

struct Params {
  size: vec4f, // the picture's width and height; which frame of a still this is; where the wave is (0..1 of a lap)
  eye: vec4f,
  right: vec4f, // .w: half the picture's width at distance 1
  up: vec4f, // .w: half its height
  fore: vec4f,
  sun: vec4f, // the way to the sun; its strength
  band: vec4f, // the circle's radius; half the band's width; half its thickness; how far round the twist starts
  rock: vec4f, // layers to a unit; how far they are bent; roughness of the faces; grain
  holes: vec4f, // size of a small pit's cell; of a large hollow's; how big the pits get; how big the hollows
  wave: vec4f, // how much of a lap the wear takes to set in; where it starts to heal; where it has healed; how ragged its front
  light: vec4f, // sky light; rim light; shade in hollows; haze
  misc: vec4f, // how far soft layers sink; how round the hollows' rims; seconds; 1 to see the steps taken
  turn: vec4f, // the band tipped toward the eye, then leant sideways: cosine and sine of each
  more: vec4f, // how much the worn rock thins; how plain the thin bands in a layer are
};
@group(0) @binding(0) var<uniform> P: Params;

const TAU = 6.2831853;
const FAR = 30.0;
const NEAR = 0.14; // closer to the plain band than this, its wear is worked out

@vertex
fn vert(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  return vec4f(f32((i << 1u) & 2u) * 2.0 - 1.0, f32(i & 2u) * 2.0 - 1.0, 0.0, 1.0);
}

fn pcg(v: u32) -> u32 {
  let s = v * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
fn h1(v: u32) -> f32 {
  return f32(pcg(v)) * (1.0 / 4294967296.0);
}
fn cell(p: vec3i) -> u32 {
  return (u32(p.x) * 1597334677u) ^ (u32(p.y) * 3812015801u) ^ (u32(p.z) * 2798796415u);
}
fn h3(p: vec3i) -> f32 {
  return h1(cell(p));
}
fn noise(x: vec3f) -> f32 {
  let i = vec3i(floor(x));
  let f = fract(x);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(h3(i), h3(i + vec3i(1, 0, 0)), u.x), mix(h3(i + vec3i(0, 1, 0)), h3(i + vec3i(1, 1, 0)), u.x), u.y),
    mix(mix(h3(i + vec3i(0, 0, 1)), h3(i + vec3i(1, 0, 1)), u.x), mix(h3(i + vec3i(0, 1, 1)), h3(i + vec3i(1, 1, 1)), u.x), u.y),
    u.z,
  );
}
fn fbm(x: vec3f, octaves: i32) -> f32 {
  var sum = 0.0;
  var a = 0.5;
  var p = x;
  for (var i = 0; i < octaves; i++) {
    sum += a * noise(p);
    p = p * 2.03 + vec3f(17.1, 3.3, 9.7);
    a *= 0.5;
  }
  return sum;
}
// the larger of two, with the corner between them rounded over k
fn smax(a: f32, b: f32, k: f32) -> f32 {
  let h = max(k - abs(a - b), 0.0) / max(k, 1e-6);
  return max(a, b) + h * h * k * 0.25;
}

// the plain band: how far from it; how far round the circle this point is; where across the band's width
// and through its thickness
fn band(p: vec3f) -> vec4f {
  let phi = atan2(p.z, p.x);
  let q = vec2f(length(p.xz) - P.band.x, p.y);
  let a = phi * 0.5 + P.band.w;
  let c = cos(a);
  let s = sin(a);
  let uv = vec2f(c * q.x + s * q.y, -s * q.x + c * q.y);
  let r = 0.035;
  let e = abs(uv) - P.band.yz + r;
  return vec4f(length(max(e, vec2f(0.0))) + min(max(e.x, e.y), 0.0) - r, phi, uv);
}

// the rock's layers, level in the block the band was cut from (which is tipped against the band, so they
// cross it at a slant): x, where through the stack of them this point is; y, how soft its layer is
fn layers(p: vec3f) -> vec2f {
  let bend = (fbm(p * 1.1 + 4.0, 3) - 0.47) * P.rock.y;
  let s0 = (dot(p, vec3f(0.44, 0.80, 0.41)) + bend) * P.rock.x;
  // beds of uneven thickness
  let s = s0 + 0.45 * sin(s0 * 0.9) + 0.2 * sin(s0 * 2.3 + 1.0);
  let i = floor(s);
  let f = s - i;
  let a = h1(u32(i32(i) + 4096) * 2654435761u);
  let b = h1(u32(i32(i) + 4097) * 2654435761u);
  return vec2f(s, mix(a, b, smoothstep(0.82, 1.0, f)));
}

// how worn the rock is here, 0 whole to 1: by how long ago the wave passed, soft rock going first
fn wear(p: vec3f, phi: f32, soft: f32) -> f32 {
  let ragged = P.wave.w * (noise(p * 2.1 + 9.0) - 0.5) + 0.07 * (soft - 0.5);
  let x = fract(P.size.w - phi / TAU + ragged + 1.0);
  return smoothstep(0.0, P.wave.x, x) * (1.0 - smoothstep(P.wave.y, P.wave.z, x));
}

// hollows, one to a cell of a grid, each a ball somewhere in its cell: how far to the nearest one's wall
// (below zero inside it). A ball stays within reach of the eight cells nearest a point, so those are all
// that need asking. `grow` 0..1 is how far the hollows here have grown.
fn hollows(p: vec3f, size: f32, grow: f32, most: f32, salt: u32) -> f32 {
  let g = p / size;
  let i = floor(g);
  let base = vec3i(i) + vec3i(select(vec3f(-1.0), vec3f(0.0), g - i > vec3f(0.5)));
  var d = 1e9;
  for (var k = 0u; k < 8u; k++) {
    let c = base + vec3i(i32(k & 1u), i32((k >> 1u) & 1u), i32(k >> 2u));
    let h = pcg(cell(c) ^ salt);
    let h2 = pcg(h);
    let h4 = pcg(h2);
    let at = (vec3f(c) + 0.5 + (vec3f(f32(h & 1023u), f32((h >> 10u) & 1023u), f32((h >> 20u) & 1023u)) / 1023.0 - 0.5) * 0.3) * size;
    // a few are large, most small, and some cells have none
    let big = f32(h2 & 65535u) / 65535.0;
    let full = select(0.0, 0.55 + 0.45 * big, big > 0.25);
    // each begins a little sooner or later than its neighbours
    let late = f32(h4 & 65535u) / 65535.0 * 0.35;
    let r = size * most * full * smoothstep(late, late + 0.65, grow);
    d = min(d, length(p - at) - r);
  }
  return d;
}

// into the band's own frame, where its circle lies level
fn own(p: vec3f) -> vec3f {
  let a = vec3f(p.x * P.turn.z + p.y * P.turn.w, -p.x * P.turn.w + p.y * P.turn.z, p.z);
  return vec3f(a.x, a.y * P.turn.x + a.z * P.turn.y, -a.y * P.turn.y + a.z * P.turn.x);
}

// x: the distance to the rock; y: how worn it is here
fn rock(world: vec3f) -> vec2f {
  let p = own(world);
  let b = band(p);
  if (b.x > NEAR) {
    return vec2f(b.x, 0.0);
  }
  let l = layers(p);
  let w = wear(p, b.y, l.y);
  // some parts stay heavy and some go to lace; and the band's two edges are left as rails, so it is never
  // eaten through
  let frail = mix(0.3, 1.0, smoothstep(0.38, 0.62, noise(p * 0.9 + 21.0))) * (1.0 - smoothstep(0.5, 0.92, abs(b.z) / P.band.y));
  var d = b.x;
  // the soft layers sink back between the hard ones
  d += P.misc.x * w * l.y * l.y + P.more.x * w * frail;
  if (d < 0.05) {
    d += P.rock.z * ((noise(p * 9.0) - 0.5) * 2.0 + (noise(p * 27.0 + 3.0) - 0.5) * 0.7);
  }
  // large hollows, slow to come, squeezed along the layers; then small pits, quick
  let q = p * vec3f(1.0, 1.35, 1.0) + 0.05 * vec3f(noise(p * 3.0), noise(p * 3.0 + 5.0), noise(p * 3.0 + 9.0));
  let large = hollows(q, P.holes.y, smoothstep(0.25, 1.0, w) * frail, P.holes.w, 0x51ed27u);
  d = smax(d, -large, P.misc.y);
  let small = hollows(q, P.holes.x, smoothstep(0.02, 0.6, w) * frail, P.holes.z, 0x9e3779u);
  d = smax(d, -small, P.misc.y * 0.5);
  return mix(vec2f(d, w), vec2f(b.x, 0.0), smoothstep(NEAR * 0.5, NEAR, b.x));
}

fn normal(p: vec3f, h: f32) -> vec3f {
  let e = vec2f(1.0, -1.0) * h;
  return normalize(e.xyy * rock(p + e.xyy).x + e.yyx * rock(p + e.yyx).x + e.yxy * rock(p + e.yxy).x + e.xxx * rock(p + e.xxx).x);
}

fn shadow(ro: vec3f, rd: vec3f) -> f32 {
  var t = 0.012;
  var res = 1.0;
  for (var i = 0; i < 70; i++) {
    let d = rock(ro + rd * t).x;
    if (d < 0.0006) {
      return 0.0;
    }
    res = min(res, 22.0 * d / t);
    t += clamp(d * 0.8, 0.004, 0.2);
    if (t > 4.5) {
      break;
    }
  }
  return clamp(res, 0.0, 1.0);
}

fn hollow(p: vec3f, n: vec3f) -> f32 {
  var occ = 0.0;
  var sca = 1.0;
  for (var i = 0; i < 5; i++) {
    let h = 0.012 + 0.2 * f32(i * i) / 16.0;
    occ += max(h - rock(p + n * h).x, 0.0) / h * sca;
    sca *= 0.75;
  }
  return clamp(1.0 - 0.5 * occ * P.light.z, 0.0, 1.0);
}

// the evening sky, the far mesas in it, and the plain below, all as a backdrop
fn sky(rd: vec3f) -> vec3f {
  let sun = P.sun.xyz;
  let toSun = max(dot(rd, sun), 0.0);
  let up = max(rd.y, 0.0);
  var col = mix(vec3f(1.0, 0.56, 0.30), vec3f(0.52, 0.36, 0.44), smoothstep(0.0, 0.22, up));
  col = mix(col, vec3f(0.16, 0.19, 0.36), smoothstep(0.12, 0.75, up));
  col += vec3f(1.0, 0.42, 0.12) * (0.8 * pow(toSun, 5.0) + 8.0 * pow(toSun, 260.0));
  // streaks of cloud, lit from below
  let streak = fbm(vec3f(rd.x * 3.0 / (0.25 + up), up * 22.0, rd.z * 3.0 / (0.25 + up)), 4);
  col = mix(col, vec3f(1.0, 0.55, 0.36) * (0.45 + 1.1 * pow(toSun, 3.0)), smoothstep(0.5, 0.72, streak) * 0.6 * smoothstep(0.02, 0.25, up));
  // mesas along the horizon, the nearer the darker; then the plain, into haze
  let az = atan2(rd.z, rd.x);
  for (var k = 0; k < 3; k++) {
    let fk = f32(k);
    let x = az * (5.0 + 3.0 * fk) + fk * 7.3;
    let steps = floor(x) + smoothstep(0.35, 0.65, fract(x));
    let top = 0.012 + 0.05 * (1.0 - 0.28 * fk) * (0.25 + noise(vec3f(steps * 0.7, fk * 3.1, 0.0))) - 0.02 * fk;
    let haze = mix(vec3f(0.56, 0.30, 0.25), vec3f(0.22, 0.12, 0.13), fk * 0.5) + vec3f(0.5, 0.2, 0.05) * pow(toSun, 4.0);
    col = mix(col, haze, smoothstep(0.004, -0.004, rd.y - top));
  }
  let low = clamp(-rd.y * 3.0, 0.0, 1.0);
  let plain = mix(vec3f(0.62, 0.33, 0.22), vec3f(0.20, 0.11, 0.09), pow(low, 0.5)) + vec3f(0.5, 0.2, 0.05) * pow(toSun, 4.0) * (1.0 - low);
  return mix(col, plain, smoothstep(0.0, -0.01, rd.y + 0.02));
}

@fragment
fn frag(@builtin(position) at: vec4f) -> @location(0) vec4f {
  let f = P.size.z;
  let jit = fract(vec2f(0.5) + f * vec2f(0.7548776662, 0.5698402910)) - 0.5;
  let uv = (at.xy + jit) / P.size.xy * 2.0 - 1.0;
  let ro = P.eye.xyz;
  let rd = normalize(P.fore.xyz + P.right.xyz * (uv.x * P.right.w) - P.up.xyz * (uv.y * P.up.w));
  let pix = 2.0 * P.up.w / P.size.y;

  // the band lies inside a ball: outside it there is only sky
  let reach = P.band.x + P.band.y + 0.1;
  let bq = dot(ro, rd);
  let cq = dot(ro, ro) - reach * reach;
  let disc = bq * bq - cq;
  var t = FAR;
  var hit = false;
  var steps = 0.0;
  var m = vec2f(0.0);
  if (disc > 0.0) {
    let root = sqrt(disc);
    t = max(-bq - root, 0.02);
    let end = -bq + root;
    for (var i = 0; i < 200; i++) {
      m = rock(ro + rd * t);
      steps += 1.0;
      if (m.x < pix * t * 0.6) {
        hit = true;
        break;
      }
      t += max(m.x * 0.6, pix * t * 0.3);
      if (t > end) {
        break;
      }
    }
  }
  var col = sky(rd);
  var depth = FAR;
  if (hit) {
    depth = t;
    let pw = ro + rd * t;
    let p = own(pw);
    let sun = P.sun.xyz;
    var n = normal(pw, max(pix * t * 0.8, 0.0007));
    let l = layers(p);
    let w = m.y;
    // each layer its own colour of sandstone, with thin bands inside it
    let i = floor(l.x);
    let pick = h1(u32(i32(i) + 4096) * 0x9e3779b1u);
    let fine = fbm(vec3f(l.x * 9.0, p.x * 1.5, p.z * 1.5), 3);
    var alb = mix(vec3f(0.60, 0.41, 0.28), vec3f(0.52, 0.22, 0.10), smoothstep(0.22, 0.38, pick));
    alb = mix(alb, vec3f(0.36, 0.095, 0.055), smoothstep(0.5, 0.6, pick));
    alb = mix(alb, vec3f(0.60, 0.33, 0.17), smoothstep(0.68, 0.74, pick));
    alb = mix(alb, vec3f(0.72, 0.54, 0.38), smoothstep(0.84, 0.9, pick));
    alb *= 1.0 + P.more.y * (fine - 0.5);
    alb *= 0.8 + 0.4 * fbm(p * 14.0, 3);
    // rock just bared is paler and redder than the weathered skin
    alb = mix(alb, alb * vec3f(1.12, 0.94, 0.86) + 0.02, clamp(w * 1.3, 0.0, 1.0) * 0.5);
    let g = vec3f(noise(p * 80.0), noise(p * 80.0 + 7.7), noise(p * 80.0 + 13.3)) - 0.5;
    n = normalize(n + P.rock.w * g);

    let ndl = max(dot(n, sun), 0.0);
    var sh = 0.0;
    if (ndl > 0.0) {
      sh = shadow(pw + n * 0.004, sun);
    }
    let occ = hollow(pw, n);
    var lin = vec3f(1.0, 0.60, 0.36) * (P.sun.w * ndl * sh);
    lin += vec3f(0.30, 0.31, 0.55) * (P.light.x * (0.55 + 0.45 * n.y) * occ);
    lin += vec3f(0.80, 0.42, 0.24) * (P.light.x * 0.8 * (0.5 - 0.5 * n.y) * occ);
    // light coming round from behind catches the edges
    let rim = pow(1.0 - max(dot(n, -rd), 0.0), 3.0) * max(dot(rd, sun) * 0.5 + 0.5, 0.0);
    lin += vec3f(1.0, 0.5, 0.22) * (P.light.y * rim * occ * (0.3 + 0.7 * sh));
    col = alb * lin;
    col = mix(col, vec3f(0.70, 0.38, 0.27), 1.0 - exp(-t * P.light.w));
  }
  if (P.misc.w > 0.5) {
    col = mix(vec3f(0.0, 0.0, 0.3), vec3f(1.0, 0.9, 0.0), steps / 200.0);
  }
  return vec4f(max(col, vec3f(0.0)), depth);
}
