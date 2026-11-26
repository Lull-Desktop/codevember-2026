// What the mountains do to the light, worked out once from the picture of heights (bake.wgsl) and again
// whenever the sun is moved: how high their shadow stands over every point of the land, and how much of the
// sky each point sees. The ray march reads these in place of marching to the sun a hundred times a pixel,
// and the fog reads them at every step to get its shafts of light.

struct Sun {
  dir: vec4f, // the way to the sun; the width of the picture of heights, in cells
};
@group(0) @binding(0) var<uniform> S: Sun;
@group(0) @binding(1) var heights: texture_2d<f32>;
@group(0) @binding(2) var soft: sampler;

const NEAR = 0.22; // the far shadow leaves out what is nearer than this (the ray march looks there itself)

@vertex
fn vert(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  return vec4f(f32((i << 1u) & 2u) * 2.0 - 1.0, f32(i & 2u) * 2.0 - 1.0, 0.0, 1.0);
}

fn heightAt(x: vec2f) -> f32 {
  let s = textureSampleLevel(heights, soft, x * 0.5 + 0.5, 0.0);
  return s.r + s.g;
}

// r: the height below which a point here is in the shadow of land further than NEAR away;
// g: the same with the near land counted too (for the fog, which need not be exact);
// b: how much of the sky is seen from the ground here; a: how far off the land casting the far shadow is.
@fragment
fn frag(@builtin(position) at: vec4f) -> @location(0) vec4f {
  let x = at.xy / S.dir.w * 2.0 - 1.0;
  let here = heightAt(x);
  let level = max(length(S.dir.xz), 1e-4);
  let toward = S.dir.xz / level;
  let rise = S.dir.y / level;

  var far = -4.0;
  var whole = -4.0;
  var away = 0.0;
  var dist = 0.015;
  for (var i = 0; i < 300; i++) {
    let q = x + toward * dist;
    if (max(abs(q.x), abs(q.y)) > 1.0) {
      break;
    }
    let top = heightAt(q) - dist * rise;
    whole = max(whole, top);
    if (dist >= NEAR && top > far) {
      far = top;
      away = dist;
    }
    dist += max(0.005, dist * 0.02);
  }

  var open = 0.0;
  for (var k = 0; k < 10; k++) {
    let a = (f32(k) + 0.5) * 0.6283185;
    let dir = vec2f(cos(a), sin(a));
    var steep = 0.0;
    for (var j = 1; j <= 7; j++) {
      let r = 0.006 * f32(j * j);
      steep = max(steep, (heightAt(x + dir * r) - here) / r);
    }
    open += 1.0 - steep / sqrt(1.0 + steep * steep);
  }
  return vec4f(far, whole, open / 10.0, away);
}
