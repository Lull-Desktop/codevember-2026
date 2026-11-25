// The traced picture, put on the screen: a soft copy of it laid over it (the glow that makes it dreamy),
// then brought into the range a screen has.

struct Shown {
  size: vec4f, // of the screen; exposure; frame
  look: vec4f, // how much glow; contrast; how much colour; grain
};
@group(0) @binding(0) var<uniform> S: Shown;
@group(0) @binding(1) var traced: texture_2d<f32>;
@group(0) @binding(2) var glow: texture_2d<f32>;
@group(0) @binding(3) var soft: sampler;

@vertex
fn vert(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  return vec4f(f32((i << 1u) & 2u) * 2.0 - 1.0, f32(i & 2u) * 2.0 - 1.0, 0.0, 1.0);
}

@fragment
fn frag(@builtin(position) at: vec4f) -> @location(0) vec4f {
  let uv = at.xy / S.size.xy;
  var col = textureSampleLevel(traced, soft, uv, 0.0).rgb;
  let g = textureSampleLevel(glow, soft, uv, 0.0).rgb;
  // part of the sharp picture gives way to the soft one, and the soft one's light is added on top
  col = mix(col, g, 0.3 * S.look.x) + g * 0.12 * S.look.x;
  col *= S.size.z;
  let v = uv - 0.5;
  col *= 1.0 - 0.45 * dot(v, v);
  // a shoulder with no toe: bright things roll off, dark things stay open
  col = 1.0 - exp(-col);
  col = pow(col, vec3f(1.0 / 2.2));
  let grey = dot(col, vec3f(0.3, 0.59, 0.11));
  col = mix(vec3f(grey), col, S.look.z);
  col = mix(col, col * col * (3.0 - 2.0 * col), S.look.y);
  let n = fract(sin(dot(at.xy + S.size.w * 0.37, vec2f(12.9898, 78.233))) * 43758.5453);
  return vec4f(col + (n - 0.5) * S.look.w, 1.0);
}
