// The noise the clouds are made of, made once: a block that repeats in every direction. Red is billows on noise,
// green is finer billows, to eat into their edges.

@group(0) @binding(0) var puff: texture_storage_3d<rgba8unorm, write>;

const SIDE = 96.0;

fn pcg3(v: vec3u) -> vec3u {
  var x = v * 1664525u + 1013904223u;
  x.x += x.y * x.z;
  x.y += x.z * x.x;
  x.z += x.x * x.y;
  x ^= x >> vec3u(16u);
  x.x += x.y * x.z;
  x.y += x.z * x.x;
  x.z += x.x * x.y;
  return x;
}
fn at3(c: vec3i, n: i32, salt: i32) -> vec3f {
  let k = ((c % n) + n) % n;
  return vec3f(pcg3(bitcast<vec3u>(k + vec3i(salt * 131, salt * 17, n)))) / 4294967296.0;
}
fn smooth3(p: vec3f, n: i32, salt: i32) -> f32 {
  let q = p * f32(n);
  let i = vec3i(floor(q));
  let f = fract(q);
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  var sum = 0.0;
  for (var k = 0; k < 8; k++) {
    let o = vec3i(k & 1, (k >> 1) & 1, k >> 2);
    let g = at3(i + o, n, salt) * 2.0 - 1.0;
    let w = mix(1.0 - u, u, vec3f(o));
    sum += w.x * w.y * w.z * dot(g, f - vec3f(o));
  }
  return sum;
}
fn billow(p: vec3f, n: i32, salt: i32) -> f32 {
  let q = p * f32(n);
  let i = vec3i(floor(q));
  var near = 4.0;
  for (var z = -1; z <= 1; z++) {
    for (var y = -1; y <= 1; y++) {
      for (var x = -1; x <= 1; x++) {
        let c = i + vec3i(x, y, z);
        let d = vec3f(c) + at3(c, n, salt) - q;
        near = min(near, dot(d, d));
      }
    }
  }
  return 1.0 - min(sqrt(near), 1.0);
}

@compute @workgroup_size(4, 4, 4)
fn bake(@builtin(global_invocation_id) id: vec3u) {
  if (any(id >= vec3u(u32(SIDE)))) {
    return;
  }
  let p = (vec3f(id) + 0.5) / SIDE;
  var soft = 0.0;
  var a = 0.5;
  var n = 4;
  for (var i = 0; i < 4; i++) {
    soft += a * smooth3(p, n, i + 1);
    a *= 0.5;
    n *= 2;
  }
  soft = clamp(soft * 1.1 + 0.5, 0.0, 1.0);
  let b = billow(p, 5, 11) * 0.6 + billow(p, 10, 12) * 0.27 + billow(p, 20, 13) * 0.13;
  let fine = billow(p, 8, 21) * 0.55 + billow(p, 16, 22) * 0.3 + billow(p, 32, 23) * 0.15;
  textureStore(puff, id, vec4f(clamp(mix(soft, b, 0.45) * 1.25 - 0.12, 0.0, 1.0), fine, soft, 1.0));
}
