// The sea on the beach: shallow water, which runs up the sand and drains off it. (Second order in space; the ground is
// taken in the way of Audusse et al. 2004, so still water stays still over any ground and no depth goes below zero.)

struct Water {
  size: vec4f, // cells along x and z; size of a cell; seconds a step
  now: vec4f,  // seconds; the tide; how far this loop's maps are along the coast, in cells; where the grid starts in x
};
@group(0) @binding(0) var<uniform> W: Water;
@group(0) @binding(1) var groundMap: texture_2d<f32>;
@group(0) @binding(2) var<storage, read> was: array<vec4f>;
@group(0) @binding(3) var<storage, read_write> next: array<vec4f>;
@group(0) @binding(4) var<storage, read> skinWas: array<vec2f>;
@group(0) @binding(5) var<storage, read_write> skinNext: array<vec2f>;

const G = 9.81;
const TAU = 6.2831853;
const DRY = 0.0015;

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

fn cell(c: vec2i) -> u32 {
  let n = vec2i(W.size.xy);
  return u32(clamp(c.x, 0, n.x - 1)) * u32(n.y) + u32(((c.y % n.y) + n.y) % n.y);
}
fn bedAt(c: vec2i) -> f32 {
  let n = vec2i(W.size.xy);
  let j = c.y - i32(W.now.z);
  return textureLoad(groundMap, vec2i(clamp(c.x, 0, n.x - 1), ((j % n.y) + n.y) % n.y), 0).r;
}

// what a cell holds, as depth, height of the surface, and speed
fn held(c: vec2i) -> vec4f {
  let s = was[cell(c)];
  let h = s.x;
  let k = 2.0 * h / (h * h + max(h * h, 1e-4));
  return vec4f(h, h + bedAt(c), s.y * k, s.z * k);
}
fn least(a: vec4f, b: vec4f) -> vec4f {
  return select(vec4f(0.0), sign(a) * min(abs(a), abs(b)), a * b > vec4f(0.0));
}

struct Side {
  flow: vec3f, // through the face: depth, and the two flows
  mine: f32,   // what the ground adds for the cell on the left
  other: f32,  // and on the right
};
// through the face between two states; the first speed is the one across the face
fn face(l: vec4f, r: vec4f) -> Side {
  let bl = l.y - l.x;
  let br = r.y - r.x;
  let b = max(bl, br);
  let hl = max(l.y - b, 0.0);
  let hr = max(r.y - b, 0.0);
  let cl = sqrt(G * hl);
  let cr = sqrt(G * hr);
  var o: Side;
  o.mine = 0.5 * G * (l.x * l.x - hl * hl);
  o.other = 0.5 * G * (r.x * r.x - hr * hr);
  let sl = min(min(l.z - cl, r.z - cr), 0.0);
  let sr = max(max(l.z + cl, r.z + cr), 0.0);
  if (sr - sl < 1e-5) {
    o.flow = vec3f(0.0);
    return o;
  }
  let ul = vec3f(hl, hl * l.z, hl * l.w);
  let ur = vec3f(hr, hr * r.z, hr * r.w);
  let fl = vec3f(ul.y, ul.y * l.z + 0.5 * G * hl * hl, ul.y * l.w);
  let fr = vec3f(ur.y, ur.y * r.z + 0.5 * G * hr * hr, ur.y * r.w);
  o.flow = (sr * fl - sl * fr + sl * sr * (ur - ul)) / (sr - sl);
  return o;
}

// the change of a cell along one direction, from the two cells on each side of it. Speeds: across, along.
fn across(a: vec4f, b: vec4f, c: vec4f, d: vec4f, e: vec4f) -> vec3f {
  var sb = 0.5 * least(b - a, c - b);
  var sc = 0.5 * least(c - b, d - c);
  var sd = 0.5 * least(d - c, e - d);
  // no slopes by the water's edge
  if (min(min(a.x, b.x), min(c.x, min(d.x, e.x))) < 0.02) {
    sb = vec4f(0.0);
    sc = vec4f(0.0);
    sd = vec4f(0.0);
  }
  let left = face(b + sb, c - sc);
  let right = face(c + sc, d - sd);
  let cl = c - sc;
  let cr = c + sc;
  var out = left.flow - right.flow;
  out.y += left.other - right.mine;
  // the slope of the ground within the cell
  out.y += G * 0.5 * (cl.x + cr.x) * ((cl.y - cl.x) - (cr.y - cr.x));
  return out;
}

@compute @workgroup_size(8, 8)
fn flow(@builtin(global_invocation_id) id: vec3u) {
  let n = vec2i(W.size.xy);
  let c = vec2i(id.xy);
  if (any(c >= n)) {
    return;
  }
  let dx = W.size.z;
  let dt = W.size.w;
  let me = held(c);
  // the ground has moved since: water keeps its height, it is not carried up on the back of a dune
  let bed = bedAt(c);
  let grown = bed - was[cell(c)].w;
  let X = across(held(c - vec2i(2, 0)), held(c - vec2i(1, 0)), me, held(c + vec2i(1, 0)), held(c + vec2i(2, 0)));
  let Z = across(held(c - vec2i(0, 2)).xywz, held(c - vec2i(0, 1)).xywz, me.xywz, held(c + vec2i(0, 1)).xywz, held(c + vec2i(0, 2)).xywz);
  var s = was[cell(c)].xyz + dt / dx * vec3f(X.x + Z.x, X.y + Z.z, X.z + Z.y);
  s.x = max(s.x, 0.0);
  if (grown > 0.0 || s.x > 0.05) {
    let left = max(s.x - grown, 0.0);
    s = vec3f(left, s.yz * min(left / max(s.x, 1e-4), 1.0));
  }
  // rubbing on the sand, and sinking into it where it is only a film
  let speed = length(me.zw);
  let rub = G * 0.0009 * speed / pow(max(s.x, 0.01), 1.3333);
  s = vec3f(s.x, s.yz / (1.0 + dt * rub));
  // waves that run along the beach and are trapped there would slosh for minutes, and the loop would not close
  s.z *= exp(-dt * 0.12);
  s.x = max(s.x - dt * 0.008 * smoothstep(0.05, 0.0, s.x), 0.0);
  if (s.x < DRY) {
    s = vec3f(s.x, 0.0, 0.0);
  }
  // out at sea it does what the swell says
  let x = W.now.w + f32(c.x) * dx;
  let deep = max(W.now.y - bedAt(c), 0.5);
  let up = swellAt(x, f32(c.y) * dx, W.now.x, sqrt(G * 3.0));
  let pull = smoothstep(16.0, 2.0, f32(c.x) * dx) * 0.12;
  let want = deep + up;
  s = mix(s, vec3f(want, want * up * sqrt(G / deep), 0.0), pull);
  next[cell(c)] = vec4f(s, bed);
}

fn skinAt(p: vec2f) -> vec2f {
  let i = vec2i(floor(p));
  let f = fract(p);
  return mix(mix(skinWas[cell(i)], skinWas[cell(i + vec2i(1, 0))], f.x), mix(skinWas[cell(i + vec2i(0, 1))], skinWas[cell(i + vec2i(1, 1))], f.x), f.y);
}
// foam goes with the water: made where the surface is steep and the water runs together, gone in some seconds.
// And how wet the sand is.
@compute @workgroup_size(8, 8)
fn foam(@builtin(global_invocation_id) id: vec3u) {
  let n = vec2i(W.size.xy);
  let c = vec2i(id.xy);
  if (any(c >= n)) {
    return;
  }
  let dx = W.size.z;
  let dt = W.size.w * 2.0; // done once for two steps of the water
  let me = held(c);
  var k = skinAt(vec2f(c) - me.zw * dt / dx);
  let l = held(c - vec2i(1, 0));
  let r = held(c + vec2i(1, 0));
  let d = held(c - vec2i(0, 1));
  let u = held(c + vec2i(0, 1));
  let run = -((r.z - l.z) + (u.w - d.w)) / (2.0 * dx);
  var tilt = vec2f(0.0);
  if (min(min(l.x, r.x), min(d.x, u.x)) > DRY) {
    tilt = vec2f(r.y - l.y, u.y - d.y) / (2.0 * dx);
  }
  var make = 5.0 * smoothstep(0.35, 1.0, run) * smoothstep(0.02, 0.12, me.x);
  make += 6.0 * smoothstep(0.16, 0.36, length(tilt)) * smoothstep(0.05, 0.2, me.x);
  // the front of the water as it runs up
  make += 4.0 * smoothstep(0.5, 1.5, length(me.zw)) * smoothstep(0.004, 0.02, me.x) * smoothstep(0.16, 0.04, me.x);
  k.x += make * dt * (1.0 - k.x);
  k.x *= exp(-dt * mix(0.5, 0.22, smoothstep(0.3, 0.05, me.x)));
  // neither foam nor wet sand stays on a steep bank: that is a dune's face coming on, and what was there is under it
  let bank = smoothstep(0.16, 0.40, length(vec2f(bedAt(c + vec2i(1, 0)) - bedAt(c - vec2i(1, 0)), bedAt(c + vec2i(0, 1)) - bedAt(c - vec2i(0, 1)))) / (2.0 * dx));
  k.x *= exp(-dt * mix(1.2, 9.0, bank) * smoothstep(0.012, DRY, me.x));
  // (it dries fast: the sand here is soon other sand, that a dune has brought)
  k.y = max(skinWas[cell(c)].y * exp(-dt * mix(0.2, 2.5, bank)), smoothstep(0.002, 0.01, me.x));
  skinNext[cell(c)] = clamp(k, vec2f(0.0), vec2f(1.0));
}

// still water at the tide's level
@compute @workgroup_size(8, 8)
fn still(@builtin(global_invocation_id) id: vec3u) {
  let n = vec2i(W.size.xy);
  let c = vec2i(id.xy);
  if (any(c >= n)) {
    return;
  }
  let h = max(W.now.y - bedAt(c), 0.0);
  next[cell(c)] = vec4f(h, 0.0, 0.0, bedAt(c));
  skinNext[cell(c)] = vec2f(0.0, step(DRY, h));
}
