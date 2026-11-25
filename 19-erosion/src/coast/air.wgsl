// The air: mist and blown sand between the eye and the surface. They are soft, so they are worked out at a half of the picture's
// size or less, and laid over the surface with care at the edges of things.

@group(0) @binding(20) var surfMap: texture_2d<f32>; // the surface: its light; how far off it is

// one of the noises of bake.wgsl; a whole number of TILES cells is a whole turn of it
fn tileAt(p: vec2f, k: i32) -> f32 {
  return textureSampleLevel(tileMap, again, p / TILES[k], 0.0)[k];
}

// how thick the blown sand is at a point, and the spray off the waves
fn blown(p: vec3f) -> vec2f {
  let q = onMap(p.xz);
  if (q.x < F.map.x + 20.0) {
    return vec2f(0.0);
  }
  let l = textureSampleLevel(lipMap, look, mapUv(q), 0.0);
  var out = vec2f(0.0);
  let u = F.size.w;
  if (l.w > 0.02) {
    let up = p.y - textureSampleLevel(topMap, look, mapUv(q), 0.0).r;
    let body = exp(-max(up, 0.0) / 0.75) * l.w;
    if (body > 0.01) {
      let a = tileAt(vec2f(p.x / 2.2 + u * 180.0, p.z * 0.6 + p.y * 1.3), 2);
      let b = tileAt(vec2f(p.x / 0.8 + u * 496.0, p.z * 1.9 + p.y * 2.0), 3);
      out.y = F.more.x * body * smoothstep(0.25, 0.8, a * 0.65 + b * 0.35);
    }
  }
  let back = l.y;
  if (l.z <= 0.01 || back <= 0.1) {
    return out;
  }
  let wide = F.drift.z * (0.25 + 0.06 * back);
  let up = (p.y - l.x - 0.15 - 0.02 * back) / wide;
  // (none right at the crest: the map's cells are coarse, and some of it would lie on the windward side, in lumps)
  let body = exp(-up * up) * exp(-back / F.drift.y) * l.z * smoothstep(54.0, 30.0, back) * smoothstep(0.6, 3.0, back);
  if (body < 0.004) {
    return out;
  }
  let a = tileAt(vec2f(p.x / 24.0 + u * 18.0, p.z * 0.22), 2);
  let b = tileAt(vec2f(p.x / 7.0 + u * 62.0, p.z * 0.9 + p.y * 0.8), 3);
  let gust = smoothstep(0.3, 0.8, wrapNoise(vec2f(u * 9.0, p.z * 0.02 + 5.0), 9, 73u));
  out.x = F.drift.x * body * mix(1.0, smoothstep(0.25, 0.85, a) * (0.3 + 1.4 * b * b), F.drift.w) * (0.2 + 0.8 * gust);
  return out;
}

// mist: an even haze that thins with height, and low banks of it that go out over the sea
fn mistAt(p: vec3f) -> f32 {
  let h = max(p.y, 0.0);
  let even = F.haze.x * exp(-h * F.haze.y);
  let u = F.size.w;
  let a = tileAt(vec2f(p.x / 46.0 + u * 4.0, p.z / 80.0 + p.y * 0.05), 0);
  let b = tileAt(vec2f(p.x / 17.0 + u * 11.0, p.z / 24.0 + p.y * 0.14 + 4.0), 1);
  let bank = smoothstep(F.mist.z, F.mist.z + 0.5, a * 0.65 + b * 0.35);
  return even + F.mist.x * bank * exp(-h / F.mist.y) * smoothstep(40.0, 160.0, length(p - F.eye.xyz));
}

struct Air {
  @location(0) mist: vec4f, // the light it gives; how much it lets through
  @location(1) dust: vec4f, // blown sand; spray; how far off the surface is that this is in front of
};
@fragment
fn air(@builtin(position) at: vec4f) -> Air {
  // of the pixels it stands for, by turns the nearest and the farthest
  let whole = vec2i(textureDimensions(surfMap));
  let each = i32(F.more2.x);
  let h = vec2i(at.xy);
  var c = min(h * each, whole - 1);
  var far = textureLoad(surfMap, c, 0).a;
  for (var k = 1; k < 4; k++) {
    let o = min(h * each + vec2i(k & 1, k >> 1) * (each - 1), whole - 1);
    let d = textureLoad(surfMap, o, 0).a;
    if (select(d > far, d < far, ((h.x + h.y) & 1) == 0)) {
      far = d;
      c = o;
    }
  }
  let ro = F.eye.xyz;
  let rd = rayAt((vec2f(c) + 0.5 + jitter()) / F.size.xy * 2.0 - 1.0);
  // a different part of the step from pixel to pixel, evenly over any nine of them
  let dice = fract(52.9829189 * fract(dot(vec2f(h), vec2f(0.06711056, 0.00583715))) + F.size.z * 0.61803399);

  var o: Air;
  var dust = vec2f(0.0);
  let top = F.haze.w;
  var t = 0.4;
  if (ro.y > top) {
    t = select((top - ro.y) / rd.y, FAR, rd.y >= 0.0);
  }
  let end = min(far, 420.0);
  if (F.drift.x > 0.0) {
    for (var i = 0; i < 160; i++) {
      if (t >= end) {
        break;
      }
      let go = min(1.5 + t * 0.014, end - t + 0.01);
      let p = ro + rd * (t + go * dice);
      if (p.y > top && rd.y > 0.0) {
        break;
      }
      let b = blown(p);
      if (b.x + b.y > 0.0) {
        dust += b * go * (0.3 + 0.7 * patchAt(p));
      }
      t += go;
    }
  }

  // mist: gathered along the ray, lit where the sun gets to it
  let m = max(dot(rd, F.sun.xyz), 0.0);
  let span = min(far, 1500.0);
  let steps = 30;
  var thick = 0.0;
  var glow = vec3f(0.0);
  let away = skyTone(normalize(vec3f(rd.x, 0.03, rd.z)));
  let ahead = F.sunTone.rgb * F.mist.w * (0.10 + 0.9 * pow(m, 5.0));
  var s0 = 0.0;
  for (var i = 0; i < steps; i++) {
    let x1 = (f32(i) + 1.0) / f32(steps);
    let s1 = span * x1 * x1;
    let sm = mix(s0, s1, dice);
    let p = ro + rd * sm;
    if (p.y > 130.0) {
      break;
    }
    let d = mistAt(p) * (s1 - s0);
    if (d > 1e-5) {
      let tr = exp(-thick);
      let a = 1.0 - exp(-d);
      let sunny = sunAt(p) * patchAt(p);
      glow += tr * a * (away * (0.72 + 0.28 * sunny) + ahead * sunny);
      thick += d;
    }
    s0 = s1;
  }
  o.mist = vec4f(glow, exp(-thick));
  o.dust = vec4f(dust, far, 1.0);
  return o;
}

@group(0) @binding(21) var mistMap: texture_2d<f32>;
@group(0) @binding(22) var dustMap: texture_2d<f32>;

// the air over the surface: from the nine small pixels round a place, those that are as far off as it
@fragment
fn mixed(@builtin(position) at: vec4f) -> @location(0) vec4f {
  let surf = textureLoad(surfMap, vec2i(at.xy), 0);
  let rd = rayAt((at.xy + jitter()) / F.size.xy * 2.0 - 1.0);
  let size = vec2i(textureDimensions(mistMap));
  let q = at.xy / F.more2.x;
  let c = vec2i(floor(q));
  var mist = vec4f(0.0);
  var dust = vec2f(0.0);
  var all = 0.0;
  for (var k = 0; k < 9; k++) {
    let i = clamp(c + vec2i(k % 3 - 1, k / 3 - 1), vec2i(0), size - 1);
    let o = max(1.5 - abs(vec2f(i) + 0.5 - q), vec2f(0.0));
    let d = textureLoad(dustMap, i, 0);
    let w = o.x * o.y * (1e-4 + exp(-18.0 * abs(d.z - surf.a) / min(d.z, surf.a)));
    mist += textureLoad(mistMap, i, 0) * w;
    dust += d.xy * w;
    all += w;
  }
  mist /= all;
  dust /= all;
  var col = surf.rgb;
  // blown sand, lit from behind
  let m = max(dot(rd, F.sun.xyz), 0.0);
  let spray = 1.0 - exp(-dust.y);
  let sprayTone = vec3f(0.9) * (F.sunTone.rgb * (0.16 + 0.5 * pow(m, 3.0)) + skyFall(vec3f(rd.x, 0.6, rd.z)) * 0.75);
  col = mix(col, sprayTone, spray * 0.9);
  let veil = 1.0 - exp(-dust.x);
  let veilTone = F.sand.rgb * (F.sunTone.rgb * (0.22 + 0.7 * pow(m, 3.0)) + skyFall(vec3f(rd.x, 0.5, rd.z)) * 0.8);
  col = mix(col, veilTone, veil * 0.85);
  return vec4f(col * mist.a + mist.rgb, 1.0);
}
