// Someone small, walking along the water with the wind off the land at their side: a coat, a hood, a scarf that streams off. Lengths are in their own height.

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

// the same, squeezed along x (which way they face): clothes and chests are not round
fn flat1(p: vec3f, a: vec3f, b: vec3f, ra: f32, rb: f32, k: f32) -> f32 {
  let s = vec3f(1.0 / k, 1.0, 1.0);
  return part(p * s, a * s, b * s, ra, rb) * k;
}
// a place between two joints, each limb as long as `len`, that bends the way `out` says
fn joint(a: vec3f, b: vec3f, len: f32, out: vec3f) -> vec3f {
  let v = b - a;
  let d = min(length(v), 1.98 * len);
  let w = normalize(v);
  return a + w * d * 0.5 + normalize(out - w * dot(out, w)) * sqrt(len * len - d * d * 0.25);
}

// p: x the way they face, y up, z to their right. x: distance; y: what of them it is: 0 coat, 1 scarf, 2 trousers and
// boots, 3 face and hands
fn personAt(p0: vec3f) -> vec2f {
  let p = vec3f(p0.xy, -p0.z); // the wind is at their other side, off the land: it blows towards -z
  let step = F.pose.x;
  let lean = F.pose.y;
  let stride = F.pose.z;
  let slope = F.ahead.w;
  let across = F.eye.w; // the feet stand on the ground as it lies
  let wind = TAU * F.size.w;
  let up = normalize(vec3f(sin(lean), cos(lean), 0.13)); // they lean into the climb and into the wind
  let twist = 0.22 * sin(step);
  let hip = vec3f(0.0, 0.485 + 0.014 * cos(2.0 * step), 0.0);
  let across1 = vec3f(sin(twist), 0.0, cos(twist)); // the shoulders turn against the hips
  let neck = hip + up * 0.325;
  var cloth = 9.0;
  var legs = 9.0;
  var skin = 9.0;
  // legs, and the coat that goes round each of them down to the knee
  var skirt = 9.0;
  for (var k = 0; k < 2; k++) {
    let s = step + f32(k) * 3.14159;
    let side = (f32(k) - 0.5) * 0.094;
    let fx = stride * sin(s);
    let lift = max(cos(s), 0.0);
    let top = hip + vec3f(0.02 * sin(s) * 0.5, 0.0, side * 0.9);
    let heel = vec3f(fx - 0.01, fx * slope - side * across + 0.042 + 0.085 * lift * lift + 0.035 * smoothstep(-0.2, -1.0, sin(s)), side * 0.8);
    let knee = joint(top, heel, 0.247, vec3f(1.0, 0.1, 0.0));
    legs = min(legs, part(p, mix(knee, heel, 0.12), heel, 0.044, 0.032)); // (the coat hides what is above)
    // the foot rolls: toe down behind, heel down in front
    let roll = 0.75 * lift * smoothstep(0.6, -0.8, sin(s)) + 0.5 * smoothstep(-0.2, -1.0, sin(s)) - 0.3 * smoothstep(0.5, 1.0, sin(s));
    let toe = heel + vec3f(0.092 * cos(roll), -0.016 - 0.092 * sin(roll), 0.0);
    legs = melt(legs, part(p, heel - vec3f(0.018, 0.012, 0.0), toe, 0.033, 0.024), 0.02);
    let hang = mix(top, knee, 1.0) + vec3f(0.004 - 0.026 * max(-sin(s), 0.0), -0.022, side * 0.20 - 0.010);
    skirt = min(skirt, flat1(p, top + vec3f(0.0, 0.03, -side * 0.25), hang, 0.068, 0.077, 0.9));
  }
  // joined, as cloth is from one leg to the other; its tail goes off with the wind
  let tail0 = hip + vec3f(-0.035, 0.02, -0.02);
  let tail1 = hip + vec3f(-0.075, -0.10, -0.085 + 0.012 * sin(wind * 43.0));
  let tail2 = hip + vec3f(-0.085 + 0.02 * sin(wind * 43.0 - 0.8), -0.195 + 0.02 * sin(wind * 61.0), -0.165 + 0.03 * sin(wind * 43.0 - 1.4));
  var tail = melt(flat1(p, tail0, tail1, 0.055, 0.05, 0.6), flat1(p, tail1, tail2, 0.05, 0.022, 0.5), 0.04);
  // folds that hang
  let fold = 0.0045 * sin(atan2(p.x - hip.x, p.z - hip.z) * 9.0 + p.y * 14.0) * smoothstep(0.52, 0.34, p.y);
  cloth = melt(skirt, tail, 0.07) + fold;
  // waist, chest and shoulders
  cloth = melt(cloth, flat1(p, hip + up * 0.0, hip + up * 0.10, 0.088, 0.072, 0.74), 0.05);
  let chest = flat1(p, hip + up * 0.11, hip + up * 0.245, 0.073, 0.094, 0.70);
  cloth = melt(cloth, chest, 0.06);
  let left = hip + up * 0.298 - across1 * 0.098;
  let right = hip + up * 0.298 + across1 * 0.098;
  cloth = melt(cloth, flat1(p, left, right, 0.044, 0.044, 0.9), 0.06);
  // arms: one swings, the other holds the coat shut against the wind
  for (var k = 0; k < 2; k++) {
    let s = step + f32(1 - k) * 3.14159;
    let side = f32(k) * 2.0 - 1.0;
    let sh = select(left, right, k == 1);
    let swing = 0.42 * sin(s) + 0.12 + lean * 0.4;
    var hand = sh + vec3f(0.29 * sin(swing) + 0.05, -0.29 * cos(swing) + 0.01, side * 0.035);
    if (k == 1) {
      hand = hip + up * 0.15 + vec3f(0.115, 0.0, 0.035) + vec3f(0.012 * sin(step), 0.0, 0.0);
    }
    let elbow = joint(sh, hand, 0.165, vec3f(-0.8, -0.25, side * 0.75));
    let arm = melt(part(p, sh, elbow, 0.044, 0.037), part(p, elbow, hand, 0.037, 0.031), 0.025);
    cloth = melt(cloth, arm, 0.018);
    skin = min(skin, length(p - mix(hand, hand + (hand - elbow) * 0.22, 0.8)) - 0.026);
  }
  // neck, head and hood
  let face = normalize(vec3f(cos(0.35), -0.16, 0.20)); // bent a little, into the wind
  let head = neck + up * 0.085 + vec3f(0.022, 0.0, 0.0);
  skin = min(skin, flat1(p, head + vec3f(0.008, 0.026, 0.0), head + vec3f(0.018, -0.030, 0.0), 0.050, 0.038, 1.0));
  var hood = melt(part(p, head + vec3f(-0.010, 0.022, 0.0), head + vec3f(-0.030, -0.045, 0.0), 0.071, 0.066), part(p, head + vec3f(-0.045, 0.030, 0.0), head + vec3f(-0.095, -0.005, -0.015), 0.040, 0.014), 0.05);
  // open in front
  hood = max(hood, -(length((p - head - face * 0.085 - vec3f(0.0, -0.005, 0.0)) * vec3f(0.8, 0.85, 1.1)) - 0.066));
  cloth = melt(cloth, hood, 0.025);
  // the scarf: wound round, and an end that flies, broad and thin
  var sc = part(p, neck + vec3f(0.022, 0.018, -0.034), neck + vec3f(0.022, 0.022, 0.034), 0.046, 0.046);
  sc = min(sc, part(p, neck + vec3f(-0.02, 0.018, -0.03), neck + vec3f(-0.02, 0.022, 0.03), 0.048, 0.048));
  // a ribbon that stands on edge: broad up and down, thin along the way they face, narrower towards its end
  var a = neck + vec3f(-0.03, 0.015, -0.04);
  var fly = 9.0;
  for (var i = 0; i < 8; i++) {
    let fi = f32(i);
    let grow = min(fi * 0.3, 1.0);
    let b = a + vec3f(-0.016 + 0.022 * grow * sin(wind * 71.0 - fi * 0.8), 0.006 - 0.004 * fi + 0.024 * grow * sin(wind * 52.0 - fi * 0.9), -0.052);
    fly = min(fly, flat1(p, a, b, 0.029 - 0.0014 * fi, 0.0276 - 0.0014 * fi, 0.5));
    a = b;
  }
  sc = min(sc, fly);
  var d = vec2f(cloth, 0.0);
  if (legs < d.x) {
    d = vec2f(legs, 2.0);
  }
  if (skin < d.x) {
    d = vec2f(skin, 3.0);
  }
  if (sc < d.x) {
    d = vec2f(sc, 1.0);
  }
  return d;
}
fn personTone(of1: f32) -> vec3f {
  if (of1 > 2.5) {
    return vec3f(0.34, 0.19, 0.12);
  }
  if (of1 > 1.5) {
    return vec3f(0.036, 0.031, 0.031);
  }
  if (of1 > 0.5) {
    return vec3f(0.46, 0.055, 0.035);
  }
  return vec3f(0.078, 0.063, 0.056);
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
    let m = personAt(toThem(w));
    if (m.x < 0.003) {
      return vec2f(t, m.y);
    }
    t += max(m.x * 0.8, 0.003) * tall;
  }
  return vec2f(1e9, 0.0);
}
// how near a ray to the sun comes to them, as a soft shadow
fn personOnSelf(ro: vec3f, rd: vec3f) -> f32 {
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
    let m = personAt(toThem(w)).x * tall;
    low = min(low, 0.5 + 0.5 * m / (t * F.sun.w + 0.01));
    if (low <= 0.0) {
      return 0.0;
    }
    t += max(m * 0.8, 0.02);
  }
  return smoothstep(0.0, 1.0, low);
}

