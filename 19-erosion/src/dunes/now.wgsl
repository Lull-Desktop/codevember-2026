// The dunes at this moment: a smooth curve in time through the moments that were worked out (dunes.py). Then the edge
// of the air that comes loose behind each crest, along which sand is blown.

@group(0) @binding(1) var<storage, read> keys: array<u32>; // heights, two to a number, one moment after another
@group(0) @binding(2) var heightOut: texture_storage_2d<r32float, write>;

struct Made {
  size: vec4f, // cells along x and z; how many moments; the moment it is
  range: vec4f, // lowest and highest height; how high to draw them; -
};
@group(0) @binding(3) var<uniform> M: Made;

fn keyAt(k: i32, c: vec2i) -> f32 {
  let n = vec2i(M.size.xy);
  let i = u32(k) * u32(n.x) * u32(n.y) + u32(c.x) * u32(n.y) + u32(c.y);
  let w = keys[i >> 1u];
  return f32(select(w & 0xffffu, w >> 16u, (i & 1u) == 1u));
}

@compute @workgroup_size(8, 8)
fn now(@builtin(global_invocation_id) id: vec3u) {
  let n = vec2i(M.size.xy);
  let c = vec2i(id.xy);
  if (any(c >= n)) {
    return;
  }
  let many = i32(M.size.z);
  let t = M.size.w * M.size.z;
  let k = i32(floor(t));
  let f = t - f32(k);
  let a = keyAt((k + many - 1) % many, c);
  let b = keyAt(k % many, c);
  let d = keyAt((k + 1) % many, c);
  let e = keyAt((k + 2) % many, c);
  let v = b + 0.5 * f * (d - a + f * (2.0 * a - 5.0 * b + 4.0 * d - e + f * (3.0 * (b - d) + e - a)));
  let h = mix(M.range.x, M.range.y, v / 65535.0);
  textureStore(heightOut, c, vec4f(h * M.range.z, 0.0, 0.0, 0.0));
}

@group(0) @binding(4) var heightIn: texture_2d<f32>;
@group(0) @binding(5) var lipOut: texture_storage_2d<rgba16float, write>;

// x: height of the edge of the sheltered air above a place; y: how far back the crest is that makes it;
// z: how sharp that crest is, which says how much sand comes off it
@compute @workgroup_size(8, 8)
fn lip(@builtin(global_invocation_id) id: vec3u) {
  let n = vec2i(M.size.xy);
  let c = vec2i(id.xy) * 2;
  if (any(c >= n)) {
    return;
  }
  let dx = F.map.w;
  var best = textureLoad(heightIn, c, 0).r;
  var back = 0.0;
  for (var i = 1; i < 64; i++) {
    let x = (c.x - i * 2 + n.x * 2) % n.x;
    let h = textureLoad(heightIn, vec2i(x, c.y), 0).r - f32(i * 2) * dx * 0.10;
    if (h > best) {
      best = h;
      back = f32(i * 2) * dx;
    }
  }
  let bx = (c.x - i32(back / dx) + n.x * 2) % n.x;
  let top = textureLoad(heightIn, vec2i(bx, c.y), 0).r;
  let after = textureLoad(heightIn, vec2i((bx + 6) % n.x, c.y), 0).r;
  let sharp = smoothstep(0.15, 0.5, (top - after) / (6.0 * dx));
  textureStore(lipOut, vec2i(id.xy), vec4f(best, back, sharp, 0.0));
}
