// The lit picture, put on the screen: brought into the range a screen has.

struct Shown {
  size: vec4f, // of the screen; exposure; frame
};
@group(0) @binding(0) var<uniform> S: Shown;
@group(0) @binding(1) var lit: texture_2d<f32>;
@group(0) @binding(2) var soft: sampler;

@vertex
fn vert(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  return vec4f(f32((i << 1u) & 2u) * 2.0 - 1.0, f32(i & 2u) * 2.0 - 1.0, 0.0, 1.0);
}

// ACES, as fitted by Narkowicz
fn curve(x: vec3f) -> vec3f {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), vec3f(0.0), vec3f(1.0));
}

@fragment
fn frag(@builtin(position) at: vec4f) -> @location(0) vec4f {
  let uv = at.xy / S.size.xy;
  var col = textureSampleLevel(lit, soft, uv, 0.0).rgb * S.size.z;
  let v = uv - 0.5;
  col *= 1.0 - 0.45 * dot(v, v);
  col = pow(curve(col), vec3f(1.0 / 2.2));
  let n = fract(sin(dot(at.xy + S.size.w * 0.37, vec2f(12.9898, 78.233))) * 43758.5453);
  return vec4f(col + (n - 0.5) / 255.0, 1.0);
}
