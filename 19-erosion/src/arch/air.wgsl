// The air: sunlight scattered on its way through the atmosphere, worked out once a frame for every direction into a
// small picture of the sky (Hillaire 2020, one scattering and a guess at the rest). Distances are in kilometres.

const GROUND = 6360.0;
const TOP = 6460.0;
const RAY = vec3f(5.802e-3, 13.558e-3, 33.1e-3);
const OZONE = vec3f(0.65e-3, 1.881e-3, 0.085e-3);
const MIE = 3.996e-3;

// how much air, dust and ozone there is at a height, for a kilometre
fn thick(h: f32) -> vec3f {
  return vec3f(exp(-h / 8.0), exp(-h / 1.2), max(0.0, 1.0 - abs(h - 25.0) / 15.0));
}
fn lost(d: vec3f) -> vec3f {
  return RAY * d.x + vec3f(MIE * 1.11 * DUST) * d.y + OZONE * d.z;
}
const DUST = 1.6;

fn toShell(o: vec3f, d: vec3f, r: f32) -> f32 {
  let b = dot(o, d);
  let c = dot(o, o) - r * r;
  let q = b * b - c;
  if (q < 0.0) {
    return -1.0;
  }
  return -b + sqrt(q);
}
// the light of a far source that reaches a point through the air
fn arrives(o: vec3f, l: vec3f) -> vec3f {
  let b = dot(o, l);
  var clear = 1.0;
  if (b < 0.0) {
    // the ground may be in the way; its edge is softened
    let low = sqrt(max(dot(o, o) - b * b, 0.0));
    clear = smoothstep(GROUND - 12.0, GROUND + 4.0, low);
  }
  if (clear <= 0.0) {
    return vec3f(0.0);
  }
  let far = toShell(o, l, TOP);
  var sum = vec3f(0.0);
  let n = 6;
  for (var i = 0; i < n; i++) {
    let t = far * pow((f32(i) + 0.5) / f32(n), 2.0);
    let w = far * 2.0 * ((f32(i) + 0.5) / f32(n)) / f32(n);
    sum += thick(max(length(o + l * t) - GROUND, 0.0)) * w;
  }
  return exp(-lost(sum)) * clear;
}
fn scatter(d: vec3f, l: vec3f) -> vec3f {
  let o = vec3f(0.0, GROUND + 0.5, 0.0);
  var far = toShell(o, d, TOP);
  let b = dot(o, d);
  let c = dot(o, o) - GROUND * GROUND;
  let q = b * b - c;
  if (b < 0.0 && q > 0.0) {
    far = min(far, max(-b - sqrt(q), 1.0));
  }
  let m = dot(d, l);
  let ray = 0.0596831 * (1.0 + m * m);
  let g = 0.78;
  let mie = 0.1193662 * (1.0 - g * g) * (1.0 + m * m) / ((2.0 + g * g) * pow(1.0 + g * g - 2.0 * g * m, 1.5));
  var depth = vec3f(0.0);
  var sum = vec3f(0.0);
  let n = 26;
  for (var i = 0; i < n; i++) {
    let s = (f32(i) + 0.5) / f32(n);
    let t = far * s * s;
    let w = far * 2.0 * s / f32(n);
    let p = o + d * t;
    let k = thick(max(length(p) - GROUND, 0.0));
    let before = depth + k * w * 0.5;
    depth += k * w;
    let light = arrives(p, l);
    let one = RAY * k.x * ray + vec3f(MIE * DUST) * k.y * mie;
    // what has been scattered more than once comes from all round
    let rest = (RAY * k.x + vec3f(MIE * DUST) * k.y) * 0.035;
    sum += (one + rest) * light * exp(-lost(before)) * w;
  }
  return sum;
}

@vertex
fn vert(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  return vec4f(f32((i << 1u) & 2u) * 2.0 - 1.0, f32(i & 2u) * 2.0 - 1.0, 0.0, 1.0);
}

@fragment
fn frag(@builtin(position) at: vec4f) -> @location(0) vec4f {
  let uv = at.xy / vec2f(256.0, 160.0);
  let az = (uv.x - 0.5) * TAU;
  let el = uv.y * uv.y * (TAU * 0.25 + 0.02) - 0.02;
  let d = vec3f(cos(el) * cos(az), sin(el), cos(el) * sin(az));
  // one scattering alone leaves a low sun's sky greenish
  let dusk = smoothstep(0.3, 0.0, abs(F.dusk.y));
  var col = scatter(d, F.dusk.xyz) * F.sunTone.w * mix(vec3f(1.0), vec3f(1.14, 0.90, 1.10), dusk);
  // the moon lights the same air, much less and, as the eye has it, bluer
  col += scatter(d, F.moon.xyz) * F.sunTone.w * F.moon.w * 0.01 * vec3f(0.7, 0.9, 1.25);
  // and the night has a glow of its own
  col += F.dusk.w * mix(vec3f(0.026, 0.042, 0.066), vec3f(0.007, 0.015, 0.040), smoothstep(0.0, 0.5, el));
  return vec4f(col, 1.0);
}
