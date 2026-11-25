// The lit picture, put on the screen: bright things glow, and the whole is brought into the range a screen has.

struct Shown {
  size: vec4f, // of the screen; exposure; frame
  more: vec4f, // how much glow; how much colour; grain; shade in the corners
};
@group(0) @binding(0) var<uniform> S: Shown;
@group(0) @binding(1) var lit: texture_2d<f32>;
@group(0) @binding(2) var soft: sampler;
@group(0) @binding(3) var glow: texture_2d<f32>;

@vertex
fn vert(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  return vec4f(f32((i << 1u) & 2u) * 2.0 - 1.0, f32(i & 2u) * 2.0 - 1.0, 0.0, 1.0);
}

// the glow: the picture halved again and again, then each size added back onto the one above it
@fragment
fn down(@builtin(position) at: vec4f) -> @location(0) vec4f {
  let texel = 1.0 / vec2f(textureDimensions(lit));
  let uv = at.xy * 2.0 * texel;
  var sum = textureSampleLevel(lit, soft, uv, 0.0).rgb * 4.0;
  for (var k = 0; k < 4; k++) {
    let o = vec2f(f32(k & 1), f32(k >> 1)) * 2.0 - 1.0;
    sum += textureSampleLevel(lit, soft, uv + o * texel, 0.0).rgb;
  }
  return vec4f(min(sum / 8.0, vec3f(20.0)), 1.0);
}
@fragment
fn up(@builtin(position) at: vec4f) -> @location(0) vec4f {
  let texel = 1.0 / vec2f(textureDimensions(lit));
  let uv = at.xy * 0.5 * texel;
  var sum = vec3f(0.0);
  for (var k = 0; k < 8; k++) {
    let a = f32(k) * 0.785398;
    sum += textureSampleLevel(lit, soft, uv + vec2f(cos(a), sin(a)) * texel * 1.4, 0.0).rgb;
  }
  return vec4f(sum / 8.0 * 0.85, 1.0);
}

// ACES, as fitted by Narkowicz
fn curve(x: vec3f) -> vec3f {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), vec3f(0.0), vec3f(1.0));
}

@fragment
fn frag(@builtin(position) at: vec4f) -> @location(0) vec4f {
  let uv = at.xy / S.size.xy;
  var col = textureSampleLevel(lit, soft, uv, 0.0).rgb;
  col = mix(col, textureSampleLevel(glow, soft, uv, 0.0).rgb * 0.3, S.more.x);
  col *= S.size.z;
  let v = uv - 0.5;
  col *= 1.0 - S.more.w * dot(v, v);
  let grey = dot(col, vec3f(0.2126, 0.7152, 0.0722));
  col = max(mix(vec3f(grey), col, S.more.y), vec3f(0.0));
  col = pow(curve(col), vec3f(1.0 / 2.2));
  // a print's contrast: a gentle S
  col = mix(col, col * col * (3.0 - 2.0 * col), 0.45);
  let n = fract(sin(dot(at.xy + S.size.w * 0.37, vec2f(12.9898, 78.233))) * 43758.5453);
  return vec4f(col + (n - 0.5) * (S.more.z * 0.05 + 1.0 / 255.0), 1.0);
}
