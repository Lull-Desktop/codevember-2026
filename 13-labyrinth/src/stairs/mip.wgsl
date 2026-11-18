// A picture at half its size: each pixel the mean of the four it covers. Done level after level, it gives the
// ball (ball.wgsl) the picture at every size it needs, down to one pixel.
@group(0) @binding(0) var larger: texture_2d<f32>;
@group(0) @binding(1) var smooth_: sampler;

@vertex
fn vert(@builtin(vertex_index) n: u32) -> @builtin(position) vec4f {
  return vec4f(f32(n & 1u) * 4.0 - 1.0, f32(n >> 1u) * 4.0 - 1.0, 0.0, 1.0);
}

@fragment
fn frag(@builtin(position) at: vec4f) -> @location(0) vec4f {
  let size = vec2f(max(textureDimensions(larger) / 2u, vec2u(1u)));
  return textureSampleLevel(larger, smooth_, at.xy / size, 0.0);
}
