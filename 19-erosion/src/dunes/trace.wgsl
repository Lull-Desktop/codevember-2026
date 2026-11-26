// The picture: a ray a pixel over the dunes, with sand blown off the crests and haze between, under the sky.

@group(0) @binding(1) var heightMap: texture_2d<f32>;
@group(0) @binding(2) var look: sampler;
@group(0) @binding(3) var lipMap: texture_2d<f32>;
@group(0) @binding(4) var fillMap: texture_2d<f32>;

const FAR = 2600.0;

@vertex
fn vert(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  return vec4f(f32((i << 1u) & 2u) * 2.0 - 1.0, f32(i & 2u) * 2.0 - 1.0, 0.0, 1.0);
}

fn mapUv(p: vec2f) -> vec2f {
  return vec2f((p.x - F.map.z) / F.map.x, -p.y / F.map.y);
}
// the land the dunes ride over: level where the person is, broad rises further off, which keep the dunes from
// looking alike to the horizon
fn landAt(p: vec2f) -> f32 {
  let off = smoothstep(120.0, 900.0, length(p));
  return F.cloud.w * off * (sin(p.x * 0.0071 + 1.3 + 0.9 * sin(p.y * 0.0047)) + 0.8 * sin(p.y * 0.0093 + p.x * 0.0031 + 0.4) + 0.6 * sin(p.x * 0.0157 - p.y * 0.0062 + 2.1));
}
fn rough(p: vec2f) -> f32 {
  return textureSampleLevel(heightMap, look, mapUv(p), 0.0).r + landAt(p);
}
// the same, with a smooth curve through the cells (a cubic spline in four reads)
fn smooth1(p: vec2f) -> f32 {
  return spline(p) + landAt(p);
}
fn spline(p: vec2f) -> f32 {
  let size = vec2f(textureDimensions(heightMap));
  let q = mapUv(p) * size - 0.5;
  let i = floor(q);
  let f = q - i;
  let w0 = (1.0 - f) * (1.0 - f) * (1.0 - f) / 6.0;
  let w1 = (4.0 - 6.0 * f * f + 3.0 * f * f * f) / 6.0;
  let w3 = f * f * f / 6.0;
  let w2 = 1.0 - w0 - w1 - w3;
  let a = w0 + w1;
  let b = w2 + w3;
  let t0 = (i - 0.5 + w1 / a + 0.0) / size;
  let t1 = (i + 1.5 + w3 / b) / size;
  let u0 = t0;
  let u1 = t1;
  return a.y * (a.x * textureSampleLevel(heightMap, look, vec2f(u0.x, u0.y), 0.0).r + b.x * textureSampleLevel(heightMap, look, vec2f(u1.x, u0.y), 0.0).r) +
    b.y * (a.x * textureSampleLevel(heightMap, look, vec2f(u0.x, u1.y), 0.0).r + b.x * textureSampleLevel(heightMap, look, vec2f(u1.x, u1.y), 0.0).r);
}

fn fbmWrap(p: vec2f, n: i32, salt: u32) -> f32 {
  return 0.5 * wrapNoise(p, n, salt) + 0.25 * wrapNoise(p * 2.0 + 7.3, n * 2, salt + 1u) + 0.125 * wrapNoise(p * 4.0 + 3.1, n * 4, salt + 2u) + 0.0625 * wrapNoise(p * 8.0, n * 8, salt + 3u);
}

// how thick the blown sand is at a point
fn blown(p: vec3f) -> f32 {
  var l = textureSampleLevel(lipMap, look, mapUv(p.xz), 0.0);
  l.x += landAt(p.xz);
  let back = l.y;
  if (l.z <= 0.01 || back <= 0.1) {
    return 0.0;
  }
  let wide = F.drift.z * (0.25 + 0.06 * back);
  let up = (p.y - l.x - 0.15 - 0.02 * back) / wide;
  let body = exp(-up * up) * exp(-back / F.drift.y) * l.z;
  if (body < 0.004) {
    return 0.0;
  }
  // streaks that run with the wind; they come round once a loop
  let u = F.size.w;
  let a = wrapNoise(vec2f(p.x / 24.0 - u * 18.0, p.z * 0.22), 18, 71u);
  let b = wrapNoise(vec2f(p.x / 7.0 - u * 62.0, p.z * 0.9 + p.y * 0.8), 62, 72u);
  let gust = smoothstep(0.35, 0.8, wrapNoise(vec2f(u * 7.0, p.z * 0.02 + 5.0), 7, 73u));
  return F.drift.x * body * mix(1.0, smoothstep(0.25, 0.85, a) * (0.3 + 1.4 * b * b), F.drift.w) * (0.25 + 0.75 * gust);
}

// how much cloud there is, over the angles of the sky (across, up): streaks that lean, torn by the wind
fn layer(a: vec2f, go: f32, salt: u32) -> f32 {
  let q = vec2f(a.x * 2.0 + a.y * 2.6 - go, a.y * 8.5 - a.x * 0.9);
  let bend = vec2f(fbmWrap(q * 0.9 + 3.0, 4096, salt), fbmWrap(q * 0.9 + 19.0, 4096, salt + 6u)) - 0.47;
  let big = fbmWrap(q * vec2f(0.8, 0.9) + bend * 1.7, 4096, salt + 12u);
  let thin = fbmWrap(q * vec2f(2.4, 5.5) + bend * 5.5, 4096, salt + 18u);
  return (big * 0.66 + thin * 0.34 - 0.47) * 2.4;
}
// Clouds drift and do not come back, so there are two of them, half a loop apart, each fading in as the other goes.
fn sheet(a: vec2f) -> f32 {
  let u = F.size.w;
  let k = 0.5 - 0.5 * cos(TAU * u);
  let x = layer(a, fract(u + 0.5) * 0.35, 11u);
  let y = layer(a, u * 0.35, 111u);
  return (x * (1.0 - k) + y * k) / sqrt(k * k + (1.0 - k) * (1.0 - k)) + 0.5;
}
fn skyAt(d: vec3f) -> vec3f {
  var col = skyTone(d);
  let e = max(d.y, 0.0);
  let a = vec2f(atan2(d.x, -d.z), e);
  let c = sheet(a);
  let c2 = sheet(a + vec2f(-0.035, -0.012)); // a little nearer the sun
  let least = 0.80 - 0.55 * F.side.w;
  let cover = smoothstep(least, least + 0.42, c) * smoothstep(0.0, 0.07, e);
  let face = clamp((c - c2) * 2.6 + 0.5, 0.0, 1.0); // turned to the sun, or away
  let flat = normalize(vec3f(d.x, 0.0, d.z) + vec3f(1e-5, 0.0, 0.0));
  let side = dot(flat, normalize(vec3f(F.sun.x, 0.0, F.sun.z))) * 0.5 + 0.5;
  // gold low and towards the sun, rose above, mauve where they are thick and turned away
  let lowness = exp(-e * 7.0);
  let warm = mix(F.cloud.rgb, F.low.rgb * 1.1, clamp(0.15 + 0.5 * side * side + 0.35 * lowness, 0.0, 1.0));
  let dim = mix(F.top.rgb * 0.9, F.cloud.rgb * 0.8, 0.35 + 0.4 * lowness);
  let body = mix(dim, warm, 0.25 + 0.75 * face);
  return mix(col, body * F.low.w, cover * 0.88);
}

fn sunAt(p: vec3f, start: f32, n: i32, dice: f32) -> f32 {
  let flat = length(F.sun.xz);
  let dir = F.sun.xz / flat;
  let rise = F.sun.y / flat;
  var low = 1.0;
  var s = start * (1.0 + 0.1 * dice);
  for (var i = 0; i < n; i++) {
    low = min(low, rise - (rough(p.xz + dir * s) - p.y) / s);
    if (low < -F.sun.w) {
      return 0.0;
    }
    s *= 1.085;
    if (s > 260.0) {
      break;
    }
  }
  return smoothstep(-F.sun.w, F.sun.w, low);
}

@fragment
fn frag(@builtin(position) at: vec4f) -> @location(0) vec4f {
  let f = F.size.z;
  let jit = fract(vec2f(0.5) + f * vec2f(0.7548776662, 0.5698402910)) - 0.5;
  let uv = (at.xy + jit) / F.size.xy * 2.0 - 1.0;
  let ro = F.eye.xyz;
  let rd = normalize(F.ahead.xyz + F.right.xyz * (uv.x * F.right.w) - F.up.xyz * (uv.y * F.up.w));
  let pix = 2.0 * F.up.w / F.size.y;
  let dice = h1(u32(at.x) + u32(at.y) * 8192u + u32(f) * 0x1000193u);

  // over the dunes: no slope is steeper than sand can lie, so a step as long as that allows never goes through
  let lean = length(rd.xz);
  let fall = 0.92 * lean - rd.y;
  let ceil1 = F.haze.w; // above this there is nothing
  var t = 0.5;
  if (ro.y > ceil1) {
    if (rd.y >= 0.0) {
      t = FAR;
    } else {
      t = (ceil1 - ro.y) / rd.y;
    }
  }
  var hit = false;
  var dust = 0.0;
  var lastDrift = t;
  var gone = false;
  for (var i = 0; i < 300; i++) {
    let p = ro + rd * t;
    if (p.y > ceil1 && rd.y > 0.0) {
      gone = true;
      break;
    }
    if (t > FAR) {
      gone = true;
      break;
    }
    let over = p.y - rough(p.xz);
    if (over < pix * t * 0.35) {
      hit = true;
      break;
    }
    var go = max(over / max(fall, 0.05) * 0.95, pix * t * 0.35);
    if (F.drift.x > 0.0 && t < 700.0) {
      go = min(go, 2.0 + t * 0.012);
      dust += blown(p + rd * go * (dice - 0.5)) * go;
    }
    t += go;
  }
  // a ray that ran out of steps was sliding along a slope, all but on it
  hit = hit || (!gone && t < FAR);
  if (hit) {
    // the last bit against the smooth surface
    for (var i = 0; i < 4; i++) {
      let p = ro + rd * t;
      t += (p.y - smooth1(p.xz)) / max(fall, 0.15) * 0.7;
    }
  }
  var col = vec3f(0.0);
  let back = skyAt(rd);
  var far = FAR;
  let who = meetPerson(ro, rd, select(FAR, t, hit));
  if (who.x < 1e8) {
    far = who.x;
    let p = ro + rd * far;
    let e = 0.004 * F.walk.w;
    let g = vec2f(1.0, -1.0) * e;
    let tall = F.walk.w;
    let k = (p - F.walk.xyz) / tall;
    let ee = 0.006;
    let o = vec3f(-k.x, k.y, -k.z);
    let b = personAt(o).x;
    let nl = normalize(vec3f(personAt(o + vec3f(ee, 0.0, 0.0)).x, personAt(o + vec3f(0.0, ee, 0.0)).x, personAt(o + vec3f(0.0, 0.0, ee)).x) - b);
    let n = vec3f(-nl.x, nl.y, -nl.z);
    let vis = sunAt(p, 0.6, 50, dice);
    let cloth = mix(vec3f(0.045, 0.036, 0.036), vec3f(0.36, 0.05, 0.035), who.y);
    col = cloth * (F.sunTone.rgb * max(dot(n, F.sun.xyz), 0.0) * vis + skyFall(normalize(vec3f(n.x, abs(n.y) + 0.3, n.z))) * 0.8);
    let rim = pow(1.0 - max(dot(n, -rd), 0.0), 3.0);
    col += F.sunTone.rgb * 0.03 * rim * vis;
  } else if (hit) {
    far = t;
    let p = ro + rd * t;
    let e = max(0.35, pix * t * 0.8);
    let hx = smooth1(p.xz + vec2f(e, 0.0)) - smooth1(p.xz - vec2f(e, 0.0));
    let hz = smooth1(p.xz + vec2f(0.0, e)) - smooth1(p.xz - vec2f(0.0, e));
    var n = normalize(vec3f(-hx, 2.0 * e, -hz));
    let steep = smoothstep(0.42, 0.58, length(vec2f(hx, hz)) / (2.0 * e));
    // the wind's mark, on the slopes it blows over: ripples across it, streaks along it
    let u = F.size.w;
    let w = F.fine.y;
    let k = round(F.map.x / w);
    let bent = fbmWrap(vec2f(p.x / 8.0 - u * F.map.x / 8.0, p.z * 0.06), 32, 41u) * 9.0 + wrapNoise(vec2f(p.x / 2.0 - u * F.map.x / 2.0, p.z * 0.5), 128, 45u) * 1.4;
    let wave = TAU * ((p.x / F.map.x - u) * k + p.z * 0.05 + bent);
    let show = (1.0 - smoothstep(0.12, 0.5, pix * t / w)) * (1.0 - steep);
    n = normalize(n + vec3f(1.0, 0.0, 0.12) * cos(wave + 0.6 * sin(wave)) * F.fine.x * show);
    let streak = fbmWrap(vec2f(p.x / 32.0 - u * F.map.x / 32.0, p.z * 0.35), 8, 51u) - 0.47;
    // sand that has slid lies in tongues down the steep face
    let tongue = (noise2(vec2f(p.z * 0.55, p.y * 0.06 + 40.0 * floor((p.x - F.map.z) / F.map.x)), 61u) - 0.5) * steep;
    n = normalize(n + vec3f(0.0, 0.0, 1.0) * tongue * 0.10);

    // their footprints, strung out behind them, which the wind fills in
    let tall = F.walk.w;
    let behind = p.x - F.walk.x;
    var dent = 0.0;
    if (behind > -0.5 && behind < 60.0 && abs(p.z - F.walk.z) < 0.4 * tall) {
      let pace = 2.0 * F.pose.z * tall; // from one print to the next
      let s0 = F.pose.x / 3.14159265;
      let kk = round(behind / pace - fract(s0));
      let left = (i32(floor(s0)) - i32(kk)) & 1;
      let at1 = vec2f((kk + fract(s0)) * pace, (f32(left) - 0.5) * 0.10 * tall);
      let o = (vec2f(behind, p.z - F.walk.z) - at1) / (vec2f(0.11, 0.055) * tall);
      dent = exp(-dot(o, o)) * exp(-behind / 16.0) * smoothstep(-0.5, 0.2, behind);
      n = normalize(n + vec3f(o.x, 0.0, o.y) * dent * 0.9);
    }
    var vis = sunAt(p + n * 0.05, 0.4, 80, dice);
    vis = min(vis, personShade(p + n * 0.03, F.sun.xyz));
    // sand sends light back towards where it came from more than a smooth thing would (after Oren and Nayar)
    let nl = max(dot(n, F.sun.xyz), 0.0);
    let nv = max(dot(n, -rd), 0.02);
    let r2 = F.sand.w * F.sand.w;
    let cosPhi = dot(normalize(F.sun.xyz - n * dot(n, F.sun.xyz)), normalize(-rd - n * dot(n, -rd)));
    let sa = sqrt(max((1.0 - nl * nl) * (1.0 - nv * nv), 0.0)) / max(max(nl, nv), 0.25);
    let oren = (1.0 - 0.5 * r2 / (r2 + 0.33)) + 0.45 * r2 / (r2 + 0.09) * max(cosPhi, 0.0) * sa;
    var fill = textureSampleLevel(fillMap, look, mapUv(p.xz), 0.0).rgb;
    // they keep some of the sky off the sand at their feet
    if (distance(p, F.walk.xyz) < tall) {
      let w2 = (p + vec3f(0.0, 0.10 * tall, 0.0) - F.walk.xyz) / tall;
      fill *= mix(0.35, 1.0, smoothstep(0.0, 0.16, personAt(vec3f(-w2.x, w2.y, -w2.z)).x));
    }
    fill *= 1.0 - 0.45 * dent;
    var sand = F.sand.rgb * (1.0 + F.fine.z * streak * (1.0 - steep) + 0.5 * F.fine.z * tongue);
    let speck = h2(i32(floor(p.x * 37.0)), i32(floor(p.z * 37.0)), 7u) - 0.5;
    sand *= 1.0 + F.fine.w * speck * (1.0 - smoothstep(0.02, 0.12, pix * t));
    col = sand * (F.sunTone.rgb * nl * oren * vis + fill);
  } else {
    col = back;
  }

  // blown sand, lit by the sun from behind and by the sky
  let m = max(dot(rd, F.sun.xyz), 0.0);
  let veil = 1.0 - exp(-dust);
  let veilTone = F.sand.rgb * (F.sunTone.rgb * (0.20 + 0.75 * pow(m, 3.0)) + skyFall(vec3f(rd.x, 0.5, rd.z)) * 0.8);
  col = mix(col, veilTone, veil * 0.85);

  // haze: thick in the hollows, thin above, glowing towards the sun
  if (far < FAR || rd.y < 0.02) {
    let span = min(far, FAR);
    let b = F.haze.y;
    let dy = rd.y * span;
    var thick = F.haze.x * exp(-b * max(ro.y - 4.0, 0.0)) * span;
    if (abs(dy * b) > 1e-3) {
      thick *= (1.0 - exp(-b * dy)) / (b * dy);
    }
    let away = skyTone(normalize(vec3f(rd.x, 0.02, rd.z)));
    let tone = away * (0.92 + F.haze.z * pow(m, 4.0));
    col = mix(col, tone, 1.0 - exp(-thick));
  }
  return vec4f(max(col, vec3f(0.0)), 1.0);
}
