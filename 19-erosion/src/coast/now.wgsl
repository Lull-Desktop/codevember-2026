// The ground at this moment, made from the two moments nearest it: each is moved towards the other by as far as its
// shapes go in that time, so dunes travel instead of fading over. Then the top of things, water laid on the ground;
// the edge of the air that comes loose behind each crest (the wind comes off the land); and the height below which a place is in shadow.

struct Made {
  size: vec4f,  // cells of the ground along x and z; how many moments; the moment it is, 0 … 1
  range: vec4f, // lowest and highest height; the largest move; how many columns of sea are put before the ground
  beach: vec4f, // slope; length of the slope; how the waterline wanders; a bay's length
  more: vec4f,  // where the ground starts in x; cells a loop is along the coast; a block's size; slope of the sea floor
  tall: vec4f,  // how much taller the dunes are drawn
};
@group(0) @binding(1) var<storage, read> keys: array<u32>;
@group(0) @binding(2) var<storage, read> moves: array<u32>;
@group(0) @binding(3) var<uniform> M: Made;
@group(0) @binding(4) var groundOut: texture_storage_2d<r32float, write>;

// a height kept for moment k; the moment after the last is the first again, one stretch of coast further on
fn keyAt(k0: i32, i: i32, j0: i32) -> f32 {
  let n = vec2i(M.size.xy);
  let many = i32(M.size.z);
  var k = k0;
  var j = j0;
  if (k >= many) {
    k -= many;
    j -= i32(M.more.y);
  }
  j = ((j % n.y) + n.y) % n.y;
  let at = u32(k) * u32(n.x * n.y) + u32(clamp(i, 0, n.x - 1)) * u32(n.y) + u32(j);
  let w = keys[at >> 1u];
  return f32(select(w & 0xffffu, w >> 16u, (at & 1u) == 1u));
}
fn alongX(k: i32, x: f32, j: i32) -> f32 {
  let i = floor(x);
  return mix(keyAt(k, i32(i), j), keyAt(k, i32(i) + 1, j), x - i);
}
fn moveCell(k: i32, i: i32, j: i32) -> f32 {
  let b = i32(M.more.z);
  let n = vec2i(M.size.xy) / b;
  let at = u32(k) * u32(n.x * n.y) + u32(clamp(i, 0, n.x - 1)) * u32(n.y) + u32(((j % n.y) + n.y) % n.y);
  return f32((moves[at >> 2u] >> (8u * (at & 3u))) & 255u) / 255.0 * M.range.z;
}
fn moveAt(k: i32, c: vec2f) -> f32 {
  let q = c / M.more.z - 0.5;
  let i = vec2i(floor(q));
  let f = fract(q);
  return mix(mix(moveCell(k, i.x, i.y), moveCell(k, i.x + 1, i.y), f.x), mix(moveCell(k, i.x, i.y + 1), moveCell(k, i.x + 1, i.y + 1), f.x), f.y);
}

@compute @workgroup_size(8, 8)
fn ground(@builtin(global_invocation_id) id: vec3u) {
  let wide = i32(M.size.x + M.range.w);
  let c = vec2i(i32(id.x) - i32(M.range.w), i32(id.y));
  if (i32(id.x) >= wide || c.y >= i32(M.size.y)) {
    return;
  }
  var h = 0.0;
  if (c.x < 2) {
    let z = f32(c.y) * F.map.w;
    let w = TAU / M.beach.w;
    let line = M.beach.z * (sin(w * z) + 0.35 * sin(2.0 * w * z + 1.1));
    h = max(M.more.w * (M.more.x + f32(c.x) * F.map.w - line), -3.0);
  } else {
    let t = M.size.w * M.size.z;
    let k = i32(floor(t));
    let f = t - f32(k);
    let d = moveAt(k, vec2f(c));
    let a = alongX(k, f32(c.x) + d * f, c.y);
    let b = alongX(k + 1, f32(c.x) - d * (1.0 - f), c.y);
    h = mix(M.range.x, M.range.y, mix(a, b, f) / 65535.0);
    // taller than they are, above the beach
    let up = max(h - 1.0, 0.0);
    h += (M.tall.x - 1.0) * up * up / (up + 2.0);
  }
  textureStore(groundOut, vec2i(id.xy), vec4f(h, 0.0, 0.0, 0.0));
}

@group(0) @binding(5) var groundIn: texture_2d<f32>;
@group(0) @binding(6) var<storage, read> state: array<vec4f>; // the water: depth, flow along x and z, the ground under it
@group(0) @binding(7) var<storage, read> skin: array<vec2f>;  // foam; wetness
@group(0) @binding(8) var topOut: texture_storage_2d<r32float, write>;
@group(0) @binding(9) var waterOut: texture_storage_2d<rgba16float, write>;

// the maps are in this loop's own place along the coast; the water's grid is in the world's
@compute @workgroup_size(8, 8)
fn lay(@builtin(global_invocation_id) id: vec3u) {
  let n = vec2i(textureDimensions(groundIn));
  let c = vec2i(id.xy);
  if (any(c >= n)) {
    return;
  }
  let h = textureLoad(groundIn, c, 0).r;
  let wn = vec2i(textureDimensions(waterOut));
  var depth = 0.0;
  if (c.x < wn.x) {
    let off = i32(round((F.coast.x - F.coast.y) / F.map.w));
    let j = (((c.y + off) % n.y) + n.y) % n.y;
    let at = u32(c.x) * u32(n.y) + u32(j);
    let s = state[at];
    depth = s.x;
    textureStore(waterOut, c, vec4f(depth, skin[at], length(s.yz) / max(depth, 0.05)));
  }
  textureStore(topOut, c, vec4f(h + depth, 0.0, 0.0, 0.0));
}

@group(0) @binding(10) var topIn: texture_2d<f32>;
@group(0) @binding(14) var waterIn: texture_2d<f32>;
@group(0) @binding(11) var lipOut: texture_storage_2d<rgba16float, write>;

// x: height of the edge of the sheltered air above a place; y: how far back the crest is that makes it;
// z: how sharp that crest is, which says how much sand comes off it; w: spray blown off a wave that breaks up the wind
@compute @workgroup_size(8, 8)
fn lip(@builtin(global_invocation_id) id: vec3u) {
  let n = vec2i(textureDimensions(topIn));
  let c = vec2i(id.xy) * 2;
  if (any(c >= n)) {
    return;
  }
  let dx = F.map.w;
  var best = textureLoad(topIn, c, 0).r;
  var back = 0.0;
  for (var i = 1; i < 48; i++) {
    let h = textureLoad(topIn, vec2i(min(c.x + i * 2, n.x - 1), c.y), 0).r - f32(i * 2) * dx * 0.10;
    if (h > best) {
      best = h;
      back = f32(i * 2) * dx;
    }
  }
  let bx = min(c.x + i32(back / dx), n.x - 1);
  let top = textureLoad(topIn, vec2i(bx, c.y), 0).r;
  let after = textureLoad(topIn, vec2i(max(bx - 6, 0), c.y), 0).r;
  let sharp = smoothstep(0.15, 0.5, (top - after) / (6.0 * dx)) * smoothstep(1.5, 4.0, top);
  var spray = 0.0;
  let wide = i32(textureDimensions(waterIn).x);
  for (var i = 0; i < 18; i++) {
    let x = c.x + i;
    if (x + 1 >= wide) {
      break;
    }
    let w = textureLoad(waterIn, vec2i(x, c.y), 0);
    if (w.x > 0.12) {
      let tilt = (textureLoad(topIn, vec2i(max(x - 1, 0), c.y), 0).r - textureLoad(topIn, vec2i(x + 1, c.y), 0).r) / (2.0 * dx);
      spray = max(spray, smoothstep(0.22, 0.55, tilt) * smoothstep(0.2, 0.6, w.y) * smoothstep(0.15, 0.5, w.x) * exp(-f32(i) * dx / 4.5));
    }
  }
  textureStore(lipOut, vec2i(id.xy), vec4f(best, back, sharp, spray));
}

@group(0) @binding(12) var look: sampler;
@group(0) @binding(13) var shadeOut: texture_storage_2d<rg32float, write>;

// x: the height up to which a place is in shadow; y: how far off the thing is that shades it. Each step looks twice as
// far towards the sun as the one before and keeps the higher, so that eight of them miss nothing on the way.
@group(0) @binding(15) var shadeIn: texture_2d<f32>;
override FAR_AS: f32 = 0.6;
fn towards(uv: vec2f, go: f32) -> vec2f {
  let flat = length(F.sun.xz);
  return uv + vec2f(F.sun.x / F.map.y, F.sun.z / F.map.z) / flat * go;
}
@compute @workgroup_size(8, 8)
fn shadeFirst(@builtin(global_invocation_id) id: vec3u) {
  let size = vec2f(textureDimensions(topIn));
  if (any(vec2f(id.xy) >= size)) {
    return;
  }
  let uv = (vec2f(id.xy) + 0.5) / size;
  let rise = F.sun.y / length(F.sun.xz);
  // not from the place itself
  let a = textureSampleLevel(topIn, look, towards(uv, 0.9), 0.0).r - 0.9 * rise;
  let b = textureSampleLevel(topIn, look, towards(uv, 0.9 + FAR_AS), 0.0).r - (0.9 + FAR_AS) * rise;
  textureStore(shadeOut, id.xy, select(vec4f(a, 0.9, 0.0, 0.0), vec4f(b, 0.9 + FAR_AS, 0.0, 0.0), b > a));
}
@compute @workgroup_size(8, 8)
fn shadeNext(@builtin(global_invocation_id) id: vec3u) {
  let size = vec2f(textureDimensions(shadeIn));
  if (any(vec2f(id.xy) >= size)) {
    return;
  }
  let uv = (vec2f(id.xy) + 0.5) / size;
  let rise = F.sun.y / length(F.sun.xz);
  let a = textureLoad(shadeIn, vec2i(id.xy), 0).rg;
  let b = textureSampleLevel(shadeIn, look, towards(uv, FAR_AS), 0.0).rg + vec2f(-rise, 1.0) * FAR_AS;
  textureStore(shadeOut, id.xy, vec4f(select(a, b, b.x > a.x), 0.0, 0.0));
}
