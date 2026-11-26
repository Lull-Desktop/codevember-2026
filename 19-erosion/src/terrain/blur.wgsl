// A soft copy of the picture, a quarter of its size, for the glow. One pass makes it smaller (each cell the
// mean of the 4 by 4 it covers); the next two smear it, across and then down.

struct Blur {
  step: vec4f, // the way from one tap to the next, as a part of the picture (0 0 to make smaller); this picture's size
};
@group(0) @binding(0) var<uniform> B: Blur;
@group(0) @binding(1) var from_: texture_2d<f32>;
@group(0) @binding(2) var soft: sampler;

@vertex
fn vert(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  return vec4f(f32((i << 1u) & 2u) * 2.0 - 1.0, f32(i & 2u) * 2.0 - 1.0, 0.0, 1.0);
}

@fragment
fn frag(@builtin(position) at: vec4f) -> @location(0) vec4f {
  let uv = at.xy / B.step.zw;
  if (B.step.x == 0.0 && B.step.y == 0.0) {
    let d = 1.0 / vec2f(textureDimensions(from_));
    var sum = textureSampleLevel(from_, soft, uv + d * vec2f(-1.0, -1.0), 0.0).rgb;
    sum += textureSampleLevel(from_, soft, uv + d * vec2f(1.0, -1.0), 0.0).rgb;
    sum += textureSampleLevel(from_, soft, uv + d * vec2f(-1.0, 1.0), 0.0).rgb;
    sum += textureSampleLevel(from_, soft, uv + d * vec2f(1.0, 1.0), 0.0).rgb;
    // very bright points (the sun on the water) are held down, or each would be a blob of its own
    let c = sum * 0.25;
    return vec4f(c / (1.0 + 0.08 * max(c.r, max(c.g, c.b))), 1.0);
  }
  var sum = vec3f(0.0);
  var most = 0.0;
  for (var i = -7; i <= 7; i++) {
    let w = exp(-f32(i * i) / 18.0);
    sum += w * textureSampleLevel(from_, soft, uv + B.step.xy * f32(i), 0.0).rgb;
    most += w;
  }
  return vec4f(sum / most, 1.0);
}
