// Pictures that stay as they are and only slide, made once when the page starts: noise that repeats on both sides, the
// clouds' shadows, the clouds, the far hills. Worked out anew at every step of every ray they were most of a frame's time.

@group(0) @binding(1) var tilesOut: texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var patchOut: texture_storage_2d<rgba16float, write>;
@group(0) @binding(3) var cloudOut: texture_storage_2d<rgba16float, write>;
@group(0) @binding(4) var hillOut: texture_storage_2d<rgba8unorm, write>;

fn place(id: vec3u, size: vec2u) -> vec2f {
  return (vec2f(id.xy) + 0.5) / vec2f(size);
}

// noise that repeats both ways; of the rows there are without end, those up to `last` are the ones kept
fn rowOf(y: i32, n: i32, last: i32) -> i32 {
  let r = ((y % n) + n) % n;
  return select(r, r - n, r >= last);
}
fn tile(p: vec2f, n: vec2i, last: i32, salt: u32) -> f32 {
  let i = vec2i(floor(p));
  let f = fract(p);
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  let x1 = (i.x + 1) % n.x;
  let y0 = rowOf(i.y, n.y, last);
  let y1 = rowOf(i.y + 1, n.y, last);
  return mix(mix(h2(i.x, y0, salt), h2(x1, y0, salt), u.x), mix(h2(i.x, y1, salt), h2(x1, y1, salt), u.x), u.y);
}
// four noises, each of as many cells as TILES says
@compute @workgroup_size(8, 8)
fn tiles(@builtin(global_invocation_id) id: vec3u) {
  let uv = place(id, textureDimensions(tilesOut));
  var v = vec4f(0.0);
  for (var k = 0; k < 4; k++) {
    v[k] = tile(uv * TILES[k], vec2i(TILES[k]), TILE_LAST[k], TILE_SALT[k]);
  }
  textureStore(tilesOut, id.xy, v);
}

// the sand's noises, with their slopes; then each half the size, for sand far off
@group(0) @binding(5) var grainOut: texture_storage_2d_array<rgba16float, write>;
@group(0) @binding(6) var grainIn: texture_2d_array<f32>;
@compute @workgroup_size(8, 8)
fn grains(@builtin(global_invocation_id) id: vec3u) {
  let k = id.z;
  let n = vec2i(GRAINS[k]);
  let p = place(id, textureDimensions(grainOut)) * GRAINS[k];
  let i = vec2i(floor(p));
  let f = fract(p);
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  let du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
  let x1 = (i.x + 1) % n.x;
  let y0 = rowOf(i.y, n.y, 24);
  let y1 = rowOf(i.y + 1, n.y, 24);
  let salt = GRAIN_SALT[k];
  let ga = slopeWay(i.x, y0, salt);
  let gb = slopeWay(x1, y0, salt);
  let gc = slopeWay(i.x, y1, salt);
  let gd = slopeWay(x1, y1, salt);
  let a = dot(ga, f);
  let b = dot(gb, f - vec2f(1.0, 0.0));
  let c = dot(gc, f - vec2f(0.0, 1.0));
  let d = dot(gd, f - vec2f(1.0, 1.0));
  let v = mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  let g = mix(mix(ga, gb, u.x), mix(gc, gd, u.x), u.y) + du * vec2f(mix(b - a, d - c, u.y), mix(c - a, d - b, u.x));
  textureStore(grainOut, id.xy, k, vec4f(v, g, 0.0));
}
@compute @workgroup_size(8, 8)
fn halve(@builtin(global_invocation_id) id: vec3u) {
  let c = id.xy * 2u;
  var sum = vec4f(0.0);
  for (var k = 0u; k < 4u; k++) {
    sum += textureLoad(grainIn, c + vec2u(k & 1u, k >> 1u), id.z, 0);
  }
  textureStore(grainOut, id.xy, id.z, sum * 0.25);
}

// where the sun comes through the clouds
@compute @workgroup_size(8, 8)
fn patches(@builtin(global_invocation_id) id: vec3u) {
  let uv = place(id, textureDimensions(patchOut));
  let a = wrapBoth(uv * vec2f(8.0, 12.0) + vec2f(0.0, 3.0), vec2i(8, 12), 81u);
  let b = wrapBoth(uv * vec2f(16.0, 22.0) + vec2f(0.0, 9.0), vec2i(16, 22), 83u);
  textureStore(patchOut, id.xy, vec4f(smoothstep(0.30, 0.62, a * 0.7 + b * 0.3), 0.0, 0.0, 0.0));
}

// two sheets of cloud, over the place that is asked for
fn sheet(q: vec2f, salt: u32) -> f32 {
  let w = vec2f(fbmWrap(q * 0.9 + 3.0, 4096, salt), fbmWrap(q * 0.9 + 19.0, 4096, salt + 6u)) - 0.47;
  return (fbmWrap(q * vec2f(0.8, 0.9) + w * 1.6, 4096, salt + 12u) * 0.7 + fbmWrap(q * vec2f(2.4, 4.5) + w * 4.0, 4096, salt + 18u) * 0.3 - 0.47) * 2.4;
}
@compute @workgroup_size(8, 8)
fn clouds(@builtin(global_invocation_id) id: vec3u) {
  let q = CLOUD_FROM + place(id, textureDimensions(cloudOut)) * CLOUD_WIDE;
  textureStore(cloudOut, id.xy, vec4f(sheet(q, 11u), sheet(q, 111u), 0.0, 0.0));
}

// far hills, one behind another, each paler: how much of their colour there is in the sky at a place
@compute @workgroup_size(8, 8)
fn hills(@builtin(global_invocation_id) id: vec3u) {
  let at = HILL_FROM + place(id, textureDimensions(hillOut)) * HILL_WIDE;
  let az = at.x;
  let e = at.y;
  var all = 0.0;
  for (var k = 0; k < 4; k++) {
    let fk = f32(k);
    let x = az * (3.0 + 1.5 * fk) + fk * 13.7;
    let big = wrapNoise(vec2f(x, fk), 4096, 121u + u32(k)) * 0.6 + wrapNoise(vec2f(x * 2.7, fk), 4096, 131u + u32(k)) * 0.28 + wrapNoise(vec2f(x * 7.0, fk), 4096, 141u + u32(k)) * 0.08;
    // they stand to the right, and go down to the sea on the left
    let stand = smoothstep(-0.95 + 0.14 * fk, 0.05 + 0.04 * fk, az);
    let top = F.hills.w * (1.0 - 0.17 * fk) * stand * (0.35 + 0.95 * big);
    let trees = wrapNoise(vec2f(az * 900.0, fk), 1 << 20, 151u) * 0.0014 * smoothstep(0.4, 3.0, fk);
    // their feet stand in the mist
    let body = (0.34 + 0.16 * fk) * smoothstep(0.0, 0.05, e);
    all = mix(all, body, smoothstep(0.0012, -0.0012, e - top - trees) * step(0.002, stand));
  }
  textureStore(hillOut, id.xy, vec4f(all, 0.0, 0.0, 1.0));
}
