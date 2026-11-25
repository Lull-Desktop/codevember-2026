// The person as the rest of the picture knows them: their shadow, read from a small picture made from the sun's side
// (walker.wgsl), the dark round their feet, and a stand-in for what is mirrored in water. Their body is only known to
// walker.wgsl: in a shader as large as the surface's it would slow down every place, also where they are not.

@group(0) @binding(14) var castMap: texture_2d<f32>;
@group(0) @binding(15) var soft: sampler;

// from the world, seen from where they stand, to their own frame: the way they face, up, their right
fn toThem(w: vec3f) -> vec3f {
  let c = cos(F.pose.w);
  let n = sin(F.pose.w);
  return vec3f(w.x * n + w.z * c, w.y, -w.x * c + w.z * n);
}
fn fromThem(v: vec3f) -> vec3f {
  let c = cos(F.pose.w);
  let n = sin(F.pose.w);
  return vec3f(v.x * n - v.z * c, v.y, v.x * c + v.z * n);
}

// the square the shadow picture covers: across the sun's light, round the middle of them
fn castSide() -> vec3f {
  return normalize(vec3f(F.sun.z, 0.0, -F.sun.x));
}
fn castHalf() -> f32 {
  return 0.85 * F.walk.w;
}
fn castMid() -> vec3f {
  return F.walk.xyz + vec3f(-0.12, 0.5, 0.0) * F.walk.w;
}
// how much of the sun's disc is seen past them
fn personShade(p: vec3f) -> f32 {
  let o = p - castMid();
  let side = castSide();
  let q = vec2f(dot(o, side), dot(o, cross(F.sun.xyz, side))) / castHalf();
  if (max(abs(q.x), abs(q.y)) >= 0.99) {
    return 1.0;
  }
  let c = textureSampleLevel(castMap, soft, q * 0.5 + 0.5, 0.0).rg; // how near the light passes them, and where on its way
  let off = c.y - dot(o, F.sun.xyz);
  if (off < -0.02) {
    return 1.0;
  }
  return smoothstep(0.0, 1.0, 0.5 + 0.5 * c.x / (off * F.sun.w + 0.02));
}
// how far a place, in their own lengths, is from their feet
fn feetFrom(k: vec3f) -> f32 {
  var d = 9.0;
  for (var i = 0; i < 2; i++) {
    let s = F.pose.x + f32(i) * 3.14159;
    let side = (0.5 - f32(i)) * 0.075;
    let fx = F.pose.z * sin(s);
    let lift = max(cos(s), 0.0);
    d = min(d, length(k - vec3f(fx + 0.03, fx * F.ahead.w + side * F.eye.w + 0.03 + 0.085 * lift * lift, side)) - 0.055);
  }
  return d;
}
// how near a ray passes the line between two places (less the thickness there)
fn passes(ro: vec3f, rd: vec3f, a: vec3f, b: vec3f, thick: f32) -> f32 {
  let ba = b - a;
  let oa = ro - a;
  let u = dot(ba, ba);
  let v = dot(ba, rd);
  let w = dot(oa, rd);
  let x = dot(ba, oa);
  let s = clamp((x - v * w) / max(u - v * v, 1e-5), 0.0, 1.0);
  let q = a + ba * s;
  return length(q - ro - rd * max(dot(q - ro, rd), 0.0)) - thick;
}
fn mirroredPerson(ro: vec3f, rd: vec3f) -> f32 {
  let tall = F.walk.w;
  let o = toThem((ro - F.walk.xyz) / tall);
  let d = toThem(rd);
  if (passes(o, d, vec3f(0.0, 0.0, 0.0), vec3f(0.0, 1.0, 0.0), 0.35) > 0.0) {
    return 0.0;
  }
  let sw = F.pose.z * sin(F.pose.x);
  let body = min(min(passes(o, d, vec3f(0.0, 0.40, 0.0), vec3f(0.04, 0.75, 0.0), 0.10), passes(o, d, vec3f(0.08, 0.90, 0.0), vec3f(0.08, 0.93, 0.0), 0.07)),
    min(passes(o, d, vec3f(sw, 0.03, 0.04), vec3f(0.0, 0.42, 0.04), 0.05), passes(o, d, vec3f(-sw, 0.03, -0.04), vec3f(0.0, 0.42, -0.04), 0.05)));
  return smoothstep(0.01, -0.01, body);
}
