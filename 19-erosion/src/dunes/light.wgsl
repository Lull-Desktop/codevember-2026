// The light on the sand, worked out on the dunes' own grid. First what the sun lights. Then, for each place, the sky
// it sees over the dunes round it, and the light that comes back off those dunes: warm from the lit slopes, dim from
// the shaded ones. This is what fills the shadows.

@group(0) @binding(1) var heightMap: texture_2d<f32>;
@group(0) @binding(2) var look: sampler;
@group(0) @binding(3) var litOut: texture_storage_2d<rgba16float, write>;

fn heightAt(uv: vec2f) -> f32 {
  return textureSampleLevel(heightMap, look, uv, 0.0).r;
}
fn normalAt(uv: vec2f, e: vec2f) -> vec3f {
  let gx = heightAt(uv + vec2f(e.x, 0.0)) - heightAt(uv - vec2f(e.x, 0.0));
  let gy = heightAt(uv + vec2f(0.0, e.y)) - heightAt(uv - vec2f(0.0, e.y));
  // the map's second way runs away from the eye, that is along -z
  return normalize(vec3f(-gx / (2.0 * e.x * F.map.x), 1.0, gy / (2.0 * e.y * F.map.y)));
}

@compute @workgroup_size(8, 8)
fn sunned(@builtin(global_invocation_id) id: vec3u) {
  let size = vec2f(textureDimensions(litOut));
  if (any(vec2f(id.xy) >= size)) {
    return;
  }
  let uv = (vec2f(id.xy) + 0.5) / size;
  let h = heightAt(uv);
  let n = normalAt(uv, 1.0 / size);
  let flat = length(F.sun.xz);
  let dir = vec2f(F.sun.x / F.map.x, -F.sun.z / F.map.y) / flat;
  let rise = F.sun.y / flat;
  var low = 1.0;
  var s = 1.0;
  for (var i = 0; i < 34; i++) {
    low = min(low, rise - (heightAt(uv + dir * s) - h) / s);
    s *= 1.17;
  }
  let vis = smoothstep(-F.sun.w, F.sun.w, low);
  let lit = vis * max(dot(n, F.sun.xyz), 0.0);
  textureStore(litOut, id.xy, vec4f(F.sunTone.rgb * lit + skyFall(vec3f(0.0, 1.0, 0.0)) * 0.6, h));
}

@group(0) @binding(4) var litMap: texture_2d<f32>;
@group(0) @binding(5) var fillOut: texture_storage_2d<rgba16float, write>;
const WAYS = 14;
const STEPS = 11;

@compute @workgroup_size(8, 8)
fn gather(@builtin(global_invocation_id) id: vec3u) {
  let size = vec2f(textureDimensions(fillOut));
  if (any(vec2f(id.xy) >= size)) {
    return;
  }
  let uv = (vec2f(id.xy) + 0.5) / size;
  let h = heightAt(uv);
  let n = normalAt(uv, 1.0 / size);
  let off = h1(id.x * 7919u + id.y * 104729u);
  var sum = vec3f(0.0);
  for (var a = 0; a < WAYS; a++) {
    let th = (f32(a) + off) / f32(WAYS) * TAU;
    let way = vec3f(cos(th), 0.0, sin(th));
    let dir = vec2f(way.x / F.map.x, -way.z / F.map.y);
    // the slope of the place itself is where its own ground is in the way
    let along = dot(n, way);
    var top = max(-along / n.y, -2.0); // tangent of how high the view is blocked
    let base = atan(top);
    var el = base;
    var s = 1.2;
    for (var i = 0; i < STEPS; i++) {
      let v = uv + dir * s;
      let t = (heightAt(v) - h) / s;
      if (t > top) {
        // the strip of view between the last thing seen and this
        let e2 = atan(t);
        let m = 0.5 * (el + e2);
        let face = max(along * cos(m) + n.y * sin(m), 0.0);
        let from1 = textureSampleLevel(litMap, look, v, 0.0).rgb * F.sand.rgb;
        sum += from1 * F.top.w * face * cos(m) * (e2 - el);
        top = t;
        el = e2;
      }
      s *= 1.5;
    }
    // and from there up, sky
    let m0 = el;
    let m1 = TAU * 0.25;
    for (var k = 0; k < 3; k++) {
      let m = mix(m0, m1, (f32(k) + 0.5) / 3.0);
      let face = max(along * cos(m) + n.y * sin(m), 0.0);
      sum += skyFall(vec3f(way.x * cos(m), sin(m), way.z * cos(m))) * face * cos(m) * (m1 - m0) / 3.0;
    }
  }
  // divided by pi, so that a full even sky gives its own brightness
  textureStore(fillOut, id.xy, vec4f(sum / f32(WAYS) * 2.0, 1.0));
}

@group(0) @binding(6) var fillIn: texture_2d<f32>;

// evened out, as the ways looked differ from place to place
@compute @workgroup_size(8, 8)
fn even(@builtin(global_invocation_id) id: vec3u) {
  let n = vec2i(textureDimensions(fillOut));
  let c = vec2i(id.xy);
  if (any(c >= n)) {
    return;
  }
  var sum = vec3f(0.0);
  var all = 0.0;
  for (var y = -2; y <= 2; y++) {
    for (var x = -2; x <= 2; x++) {
      let k = (c + vec2i(x, y) + n) % n;
      let w = f32((3 - abs(x)) * (3 - abs(y)));
      sum += textureLoad(fillIn, k, 0).rgb * w;
      all += w;
    }
  }
  textureStore(fillOut, c, vec4f(sum / all, 1.0));
}
