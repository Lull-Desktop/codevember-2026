// What the passes that draw the picture share: where things are, the light on them, the sky. (bake.wgsl makes the pictures
// read here.)

@group(0) @binding(1) var topMap: texture_2d<f32>;   // the top of things: the ground, or the water on it
@group(0) @binding(2) var look: sampler;             // repeats along the coast, not inland
@group(0) @binding(3) var lipMap: texture_2d<f32>;
@group(0) @binding(4) var fillMap: texture_2d<f32>;
@group(0) @binding(5) var shadeMap: texture_2d<f32>;
@group(0) @binding(6) var waterMap: texture_2d<f32>; // depth, foam, wetness, speed
@group(0) @binding(8) var tileMap: texture_2d<f32>;
@group(0) @binding(9) var again: sampler;            // repeats both ways
@group(0) @binding(10) var patchMap: texture_2d<f32>;
@group(0) @binding(11) var cloudMap: texture_2d<f32>;
@group(0) @binding(12) var hillMap: texture_2d<f32>;

const FAR = 2400.0;

@vertex
fn vert(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  return vec4f(f32((i << 1u) & 2u) * 2.0 - 1.0, f32(i & 2u) * 2.0 - 1.0, 0.0, 1.0);
}

// the coast bends: how far it has swung seaward at a distance
fn bend(z: f32) -> f32 {
  return 0.5 * F.coast.z * z * z;
}
// from the eye's frame to the maps': x from the sea inland, z along this loop's stretch
fn onMap(p: vec2f) -> vec2f {
  return vec2f(p.x + bend(p.y), p.y + F.coast.y);
}
fn mapUv(q: vec2f) -> vec2f {
  return vec2f((q.x - F.map.x) / F.map.y, q.y / F.map.z) + vec2f(0.5 * F.map.w) / F.map.yz;
}
// land that rises far inland
fn inland(x: f32) -> f32 {
  let a = smoothstep(290.0, 900.0, x);
  return 34.0 * a * a;
}
// the clouds' shadows: patches of sun that go along the coast, one whole picture of them a loop
fn patchAt(p: vec3f) -> f32 {
  let s = p.xz - F.sun.xz / F.sun.y * p.y;
  return mix(1.0, textureSampleLevel(patchMap, again, vec2f(s.y / 720.0 + F.size.w, s.x / 1320.0), 0.0).r, F.sunTone.w);
}
// how much of the sun's disc is seen from a place
fn sunAt(p: vec3f) -> f32 {
  let q = onMap(p.xz);
  if (q.x < F.map.x + 10.0) {
    return 1.0;
  }
  let s = textureSampleLevel(shadeMap, look, mapUv(q), 0.0).rg;
  let wide = s.y * F.sun.w + 0.06;
  return smoothstep(-wide, wide, p.y - inland(q.x) - s.x);
}

// the ray through a place in the picture, from -1 to 1
fn rayAt(uv: vec2f) -> vec3f {
  return normalize(F.ahead.xyz + F.right.xyz * (uv.x * F.right.w) - F.up.xyz * (uv.y * F.up.w));
}
fn jitter() -> vec2f {
  return fract(vec2f(0.5) + F.size.z * vec2f(0.7548776662, 0.5698402910)) - 0.5;
}

// far hills over what is behind them
fn hillsAt(d: vec3f, behind: vec3f) -> vec3f {
  let at = (vec2f(atan2(d.x, -d.z), d.y / length(d.xz)) - HILL_FROM) / HILL_WIDE;
  if (at.x < 0.0 || at.x > 1.0 || at.y > 1.0) {
    return behind;
  }
  return mix(behind, F.hills.rgb, textureSampleLevel(hillMap, look, vec2f(at.x, clamp(at.y, 0.002, 0.998)), 0.0).r);
}
fn skyAt(d: vec3f) -> vec3f {
  var col = skyTone(d);
  let e = max(d.y, 0.0);
  let m = max(dot(d, F.sun.xyz), 0.0);
  let shown = smoothstep(0.02, 0.16, e);
  if (shown > 0.0) {
    let u = F.size.w;
    let k = 0.5 - 0.5 * cos(TAU * u);
    let az = atan2(d.x, -d.z);
    let q = (vec2f((az + e) * 1.6, e * 6.0 - az * 0.5) - CLOUD_FROM) / CLOUD_WIDE;
    let s1 = textureSampleLevel(cloudMap, again, q - vec2f(fract(u + 0.5) * 0.3 / CLOUD_WIDE.x, 0.0), 0.0).r;
    let s2 = textureSampleLevel(cloudMap, again, q - vec2f(u * 0.3 / CLOUD_WIDE.x, 0.0), 0.0).g;
    let c = (s1 * (1.0 - k) + s2 * k) / sqrt(k * k + (1.0 - k) * (1.0 - k)) + 0.5;
    let least = 0.85 - 0.55 * F.side.w;
    let cloud = mix(F.top.rgb * 1.05, F.low.rgb, 0.25 + 0.6 * pow(m, 3.0)) * F.low.w;
    col = mix(col, cloud, smoothstep(least, least + 0.5, c) * shown * 0.6);
  }
  // the sun, through the haze
  col += F.sunTone.rgb * (0.10 * pow(m, 350.0) + 0.22 * pow(m, 3500.0));
  return col;
}
