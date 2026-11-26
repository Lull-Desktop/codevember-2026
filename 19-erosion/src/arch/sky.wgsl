// Read by everything that needs the sky: its colour in a direction, from the small picture air.wgsl makes.

@group(0) @binding(8) var airMap: texture_2d<f32>;
@group(0) @binding(9) var airLook: sampler;

fn airAt(d: vec3f) -> vec3f {
  let el = asin(clamp(d.y, -1.0, 1.0));
  let v = sqrt(clamp((el + 0.02) / (TAU * 0.25 + 0.02), 0.0, 1.0));
  return textureSampleLevel(airMap, airLook, vec2f(atan2(d.z, d.x) / TAU + 0.5, v), 0.0).rgb;
}
// what far things fade into: the sky just over the horizon behind them
fn hazeAt(d: vec3f) -> vec3f {
  return airAt(normalize(vec3f(d.x, 0.05 * length(d.xz), d.z)));
}
