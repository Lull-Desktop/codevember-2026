// The traced picture, put on the screen; then the sand, drawn over it.
//
// The sand keeps no state. Each grain has a moment of the loop at which it comes loose, a place in the band
// (just behind the wave of wear, as it stood at that moment) and a way through the air that depends only on
// how long ago that was. So any moment of the loop can be drawn by itself, and the loop closes exactly.

struct Params {
  size: vec4f,
  eye: vec4f,
  right: vec4f,
  up: vec4f,
  fore: vec4f,
  sun: vec4f,
  band: vec4f,
  rock: vec4f,
  holes: vec4f,
  wave: vec4f,
  light: vec4f,
  misc: vec4f,
  turn: vec4f,
  more: vec4f,
};
struct Shown {
  size: vec4f, // of the screen; exposure; frame
  sand: vec4f, // how many grains; their size; how bright; seconds in a loop
  wind: vec4f, // where the wind goes, and how fast; how far the grains swirl
};
@group(0) @binding(0) var<uniform> S: Shown;
@group(0) @binding(1) var traced: texture_2d<f32>;
@group(0) @binding(2) var soft: sampler;
@group(0) @binding(3) var<uniform> P: Params;

const TAU = 6.2831853;

@vertex
fn vert(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  return vec4f(f32((i << 1u) & 2u) * 2.0 - 1.0, f32(i & 2u) * 2.0 - 1.0, 0.0, 1.0);
}

// ACES, as fitted by Narkowicz
fn curve(x: vec3f) -> vec3f {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), vec3f(0.0), vec3f(1.0));
}

@fragment
fn frag(@builtin(position) at: vec4f) -> @location(0) vec4f {
  let uv = at.xy / S.size.xy;
  var col = textureSampleLevel(traced, soft, uv, 0.0).rgb * S.size.z;
  let v = uv - 0.5;
  col *= 1.0 - 0.45 * dot(v, v);
  col = pow(curve(col), vec3f(1.0 / 2.2));
  let n = fract(sin(dot(at.xy, vec2f(12.9898, 78.233))) * 43758.5453);
  return vec4f(col + (n - 0.5) / 255.0, 1.0);
}

fn pcg(v: u32) -> u32 {
  let s = v * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
fn unit(v: u32) -> f32 {
  return f32(v) * (1.0 / 4294967296.0);
}
// out of the band's own frame, where its circle lies level
fn world(p: vec3f) -> vec3f {
  let a = vec3f(p.x, p.y * P.turn.x - p.z * P.turn.y, p.y * P.turn.y + p.z * P.turn.x);
  return vec3f(a.x * P.turn.z - a.y * P.turn.w, a.x * P.turn.w + a.y * P.turn.z, a.z);
}
// a slow swirl in the air, different at every place
fn swirl(p: vec3f) -> vec3f {
  return vec3f(
    sin(p.y * 2.3 + 1.0) + sin(p.z * 1.7 + p.x * 1.1),
    sin(p.z * 2.1 + 2.0) + sin(p.x * 1.9 + p.y * 1.3 + 4.0),
    sin(p.x * 2.5 + 3.0) + sin(p.y * 1.5 + p.z * 0.9 + 1.5),
  );
}

struct Grain {
  @builtin(position) at: vec4f,
  @location(0) corner: vec2f,
  @location(1) tone: vec4f, // its colour, and how much of it shows
  @location(2) far: f32, // how far from the eye
  @location(3) kind: f32, // 1 for a chip of rock, which hides what is behind it; sand only adds its light
};

@vertex
fn grain(@builtin(vertex_index) index: u32) -> Grain {
  var g: Grain;
  let id = index / 6u;
  let k = index % 6u;
  let corner = vec2f(f32(k == 1u || k == 2u || k == 4u), f32(k == 2u || k == 4u || k == 5u)) * 2.0 - 1.0;
  let a = pcg(id * 3u + 17u);
  let b = pcg(a);
  let c = pcg(b);
  let d = pcg(c);
  let e = pcg(d);
  let f = pcg(e);
  let span = S.sand.w;
  // when in the loop it comes loose, and how long it is in the air
  let born = unit(a);
  let life = (0.9 + 2.2 * unit(b)) / span;
  let age = fract(P.size.w - born);
  let secs = age * span;
  // where: in the band, a little way behind where the wave of wear stood then, most just at its front
  let behind = (pow(unit(c), 1.6) * 1.25 - 0.06) * P.wave.x;
  let phi = TAU * (born - behind);
  let heavy = unit(e);
  let across = (unit(d) * 2.0 - 1.0) * P.band.y;
  let through = (unit(f) * 2.0 - 1.0) * P.band.z;
  let tw = phi * 0.5 + P.band.w;
  let q = vec2f(cos(tw) * across - sin(tw) * through, sin(tw) * across + cos(tw) * through);
  let start = world(vec3f((P.band.x + q.x) * cos(phi), q.y, (P.band.x + q.x) * sin(phi)));
  // the way: slowly out of the rock, then taken by the wind; the heavier grains sag; all of them swirl.
  // One grain in some hundreds is a chip of rock: large, dark, and it only falls.
  let chip = unit(pcg(c ^ 0x7f4a7c15u)) < 0.0015;
  let wind = S.wind.xyz;
  let taken = secs - 0.7 * (1.0 - exp(-secs / 0.7));
  var p = start + wind * taken * (0.82 + 0.36 * unit(pcg(f)));
  p.y -= 0.16 * heavy * heavy * secs * secs;
  p += S.wind.w * sqrt(taken) * (swirl(start * 1.6 + wind * taken * 0.9) + 0.5 * swirl(p * 4.1 + 7.0));
  if (chip) {
    p = start + wind * taken * 0.12 + vec3f(0.0, -0.5 * (0.5 + heavy) * secs * secs, 0.0);
  }

  let rel = p - P.eye.xyz;
  let depth = dot(rel, P.fore.xyz);
  var size = S.sand.y * (0.6 + 0.9 * unit(pcg(e) ^ 0x55u)) * (1.0 + 0.6 * taken);
  if (chip) {
    size = S.sand.y * (2.0 + 3.5 * heavy);
  }
  // never smaller than a pixel and a half, or the grain falls between pixels and flickers
  size = max(size, 1.5 * depth * P.up.w / S.size.y);
  let x = dot(rel, P.right.xyz) + corner.x * size;
  let y = dot(rel, P.up.xyz) + corner.y * size;
  var show = smoothstep(0.0, 0.08, age / life) * (1.0 - smoothstep(0.45, 1.0, age / life));
  // the sand comes off in streaks, not evenly
  let streak = swirl(start * 5.0 + born * 40.0);
  show *= smoothstep(-0.2, 1.1, streak.x + 0.5 * streak.y);
  if (age > life || depth < 0.1) {
    show = 0.0;
  }
  // sand with the light behind it glows
  let glow = pow(max(dot(normalize(rel), P.sun.xyz), 0.0), 3.0);
  let tint = mix(vec3f(1.0, 0.72, 0.46), vec3f(1.0, 0.88, 0.70), unit(pcg(d)));
  g.tone = vec4f(tint * (0.7 + 2.2 * glow) * S.sand.z, show);
  g.kind = select(0.0, 1.0, chip);
  if (chip) {
    g.tone = vec4f(vec3f(0.30, 0.15, 0.09), min(show * 3.0, 1.0));
  }
  g.corner = corner;
  g.far = length(rel);
  g.at = vec4f(x / P.right.w, y / P.up.w, 0.5 * depth, depth);
  if (show <= 0.0) {
    g.at = vec4f(2.0, 2.0, 2.0, 1.0);
  }
  return g;
}

@fragment
fn dust(g: Grain) -> @location(0) vec4f {
  // hidden where the rock is nearer than the grain
  let uv = g.at.xy / S.size.xy;
  let rock = textureSampleLevel(traced, soft, uv, 0.0).a;
  let r = dot(g.corner, g.corner);
  let seen = smoothstep(0.0, 0.03, rock - g.far);
  if (g.kind > 0.5) {
    let a = g.tone.a * (1.0 - smoothstep(0.6, 1.0, r)) * seen;
    return vec4f(g.tone.rgb * a, a);
  }
  let a = g.tone.a * (1.0 - smoothstep(0.0, 1.0, r)) * seen;
  return vec4f(g.tone.rgb * a, a * 0.25);
}
