// The person: their body where it is seen, over the surface; and the picture of them from the sun's side that their shadow
// is read from.

// ground between the eye and them
fn hidden(ro: vec3f, rd: vec3f, t: f32) -> bool {
  for (var i = 1; i <= 64; i++) {
    let p = ro + rd * (t - 0.8 * f32(i) - 0.4);
    if (p.y > F.haze.w || 0.8 * f32(i) > t - 1.0) {
      break;
    }
    let q = onMap(p.xz);
    if (p.y < textureSampleLevel(topMap, look, mapUv(q), 0.0).r + inland(q.x)) {
      return true;
    }
  }
  // and what they stand in
  let p = ro + rd * t;
  return p.y < textureSampleLevel(topMap, look, mapUv(onMap(p.xz)), 0.0).r - 0.02;
}

@fragment
fn frag(@builtin(position) at: vec4f) -> @location(0) vec4f {
  let ro = F.eye.xyz;
  let rd = rayAt((at.xy + jitter()) / F.size.xy * 2.0 - 1.0);
  let l = F.sun.xyz;
  let who = meetPerson(ro, rd, FAR);
  if (who.x > 1e8 || hidden(ro, rd, who.x)) {
    discard;
  }
  let far = who.x;
  let p = ro + rd * far;
  let k = toThem((p - F.walk.xyz) / F.walk.w);
  let ee = 0.006;
  let b = personAt(k).x;
  let nl = normalize(vec3f(personAt(k + vec3f(ee, 0.0, 0.0)).x, personAt(k + vec3f(0.0, ee, 0.0)).x, personAt(k + vec3f(0.0, 0.0, ee)).x) - b);
  let n = fromThem(nl);
  let vis = sunAt(p) * patchAt(p);
  let cloth = personTone(who.y);
  // darker in the folds and under the arms
  let open = clamp(0.35 + 0.65 * personAt(k + nl * 0.07).x / 0.07, 0.3, 1.0);
  var col = cloth * (F.sunTone.rgb * max(dot(n, l), 0.0) * min(vis, personOnSelf(p + n * 0.04, l)) + skyFall(normalize(vec3f(n.x, abs(n.y) + 0.3, n.z))) * 0.8 * open);
  // and light off the sand, from below
  col += cloth * F.sand.rgb * F.sunTone.rgb * 0.10 * max(0.4 - 0.6 * n.y, 0.0) * open;
  col += F.sunTone.rgb * 0.05 * pow(1.0 - max(dot(n, -rd), 0.0), 3.0) * vis * max(0.0, dot(rd, l));
  return vec4f(max(col, vec3f(0.0)), far);
}

@fragment
fn fromSun(@builtin(position) at: vec4f) -> @location(0) vec4f {
  let q = at.xy / CAST * 2.0 - 1.0;
  let side = castSide();
  let half = castHalf();
  let from1 = castMid() + (side * q.x + cross(F.sun.xyz, side) * q.y) * half;
  let tall = F.walk.w;
  var s = -half * 1.1;
  var near = 9.0;
  var where1 = 0.0;
  for (var i = 0; i < 64; i++) {
    let d = personAt(toThem((from1 + F.sun.xyz * s - F.walk.xyz) / tall)).x * tall;
    if (d < near) {
      near = d;
      where1 = s;
    }
    s += max(abs(d) * 0.8, 0.03);
    if (s > half * 1.1) {
      break;
    }
  }
  return vec4f(near, where1, 0.0, 1.0);
}
