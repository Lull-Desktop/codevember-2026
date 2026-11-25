// Someone small, walking into the wind: a coat, a hood, a scarf that streams behind. Lengths are in their own height.

fn part(p: vec3f, a: vec3f, b: vec3f, ra: f32, rb: f32) -> f32 {
  let pa = p - a;
  let ba = b - a;
  let t = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * t) - mix(ra, rb, t);
}
fn melt(a: f32, b: f32, k: f32) -> f32 {
  let h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}

// p: x the way they face, y up, z to their right. x: distance; y: 1 for the scarf
fn personAt(p: vec3f) -> vec2f {
  let step = F.pose.x;
  let lean = F.pose.y;
  let stride = F.pose.z;
  let slope = F.pose.w;
  let hard = F.pose2.x;
  let bob = 0.018 * cos(2.0 * step) - 0.03 * hard;
  let hip = vec3f(0.02 * hard, 0.49 + bob, 0.0);
  let neck = hip + vec3f(sin(lean), cos(lean), 0.0) * 0.33;
  let head = neck + vec3f(sin(lean * 1.15), cos(lean * 1.15), 0.0) * 0.10 + vec3f(0.015, 0.0, 0.0);
  var d = 9.0;
  // legs
  for (var k = 0; k < 2; k++) {
    let s = step + f32(k) * 3.14159;
    let side = (f32(k) - 0.5) * 0.10;
    let fx = stride * sin(s) + 0.02 * hard;
    let lift = max(cos(s), 0.0) * (0.07 + 0.07 * hard);
    let foot = vec3f(fx, fx * slope + lift - 0.015, side);
    let top = hip + vec3f(0.0, -0.01, side * 0.8);
    let bend = 0.06 + 0.5 * lift + 0.04 * hard;
    let knee = mix(top, foot, 0.48) + vec3f(bend, 0.02, 0.0);
    d = melt(d, part(p, top, knee, 0.058, 0.044), 0.03);
    d = melt(d, part(p, knee, foot, 0.042, 0.030), 0.02);
    d = min(d, part(p, foot, foot + vec3f(0.075, 0.012, 0.0), 0.026, 0.022));
  }
  // coat, wider at the hem and blown back
  let hem = hip + vec3f(-0.05, -0.13, 0.0);
  d = melt(d, part(p, neck - vec3f(0.0, 0.03, 0.0), hem, 0.075, 0.118), 0.05);
  // arms
  for (var k = 0; k < 2; k++) {
    let s = step + f32(1 - k) * 3.14159;
    let side = (f32(k) - 0.5) * 0.2;
    let sh = neck + vec3f(0.0, -0.03, side);
    let swing = sin(s) * (0.45 + 0.1 * hard) + lean * 0.5 + 0.25 * hard;
    let elbow = sh + vec3f(sin(swing), -cos(swing), 0.12 * side) * 0.16;
    let reach = swing + 0.45 + 0.2 * hard;
    let hand = elbow + vec3f(sin(reach), -cos(reach), -0.4 * side) * 0.15;
    d = melt(d, part(p, sh, elbow, 0.042, 0.034), 0.03);
    d = melt(d, part(p, elbow, hand, 0.033, 0.024), 0.02);
  }
  // head and hood
  d = melt(d, part(p, head, head + vec3f(-0.02, 0.02, 0.0), 0.066, 0.066), 0.04);
  // the scarf
  var sc = 9.0;
  var a = neck + vec3f(-0.03, 0.02, 0.0);
  let t = F.pose2.y;
  for (var i = 0; i < 5; i++) {
    let fi = f32(i);
    let b = a + vec3f(-0.085, 0.012 + 0.035 * sin(t * 6.2831853 * 52.0 - fi * 1.3) - 0.012 * fi * (1.0 - 0.5 * hard), 0.035 * sin(t * 6.2831853 * 71.0 - fi * 1.1 + 1.0));
    sc = min(sc, part(p, a, b, 0.026, 0.024));
    a = b;
  }
  sc = min(sc, part(p, neck + vec3f(0.0, 0.012, -0.03), neck + vec3f(0.0, 0.012, 0.03), 0.055, 0.055));
  if (sc < d) {
    return vec2f(sc, 1.0);
  }
  return vec2f(d, 0.0);
}

// a ray against them: how far along it meets them (or a big number), and what of them
fn meetPerson(ro: vec3f, rd: vec3f, most: f32) -> vec2f {
  let tall = F.walk.w;
  let mid = F.walk.xyz + vec3f(0.12, 0.5, 0.0) * tall;
  let oc = ro - mid;
  let b = dot(oc, rd);
  let q = b * b - dot(oc, oc) + tall * tall * 0.64;
  if (q < 0.0) {
    return vec2f(1e9, 0.0);
  }
  var t = max(-b - sqrt(q), 0.0);
  let end = min(-b + sqrt(q), most);
  for (var i = 0; i < 48; i++) {
    if (t > end) {
      break;
    }
    let w = (ro + rd * t - F.walk.xyz) / tall;
    // they face upwind
    let m = personAt(vec3f(-w.x, w.y, -w.z));
    if (m.x < 0.003) {
      return vec2f(t, m.y);
    }
    t += max(m.x * 0.8, 0.003) * tall;
  }
  return vec2f(1e9, 0.0);
}
// how near a ray to the sun comes to them, as a soft shadow
fn personShade(ro: vec3f, rd: vec3f) -> f32 {
  let tall = F.walk.w;
  let mid = F.walk.xyz + vec3f(0.12, 0.5, 0.0) * tall;
  let oc = ro - mid;
  let b = dot(oc, rd);
  let q = b * b - dot(oc, oc) + tall * tall * 0.8;
  if (q < 0.0 || -b + sqrt(q) < 0.0) {
    return 1.0;
  }
  var t = max(-b - sqrt(q), 0.02);
  let end = -b + sqrt(q);
  var low = 1.0;
  for (var i = 0; i < 40; i++) {
    if (t > end) {
      break;
    }
    let w = (ro + rd * t - F.walk.xyz) / tall;
    let m = personAt(vec3f(-w.x, w.y, -w.z)).x * tall;
    low = min(low, 0.5 + 0.5 * m / (t * F.sun.w + 0.01));
    if (low <= 0.0) {
      return 0.0;
    }
    t += max(m * 0.8, 0.02);
  }
  return smoothstep(0.0, 1.0, low);
}
