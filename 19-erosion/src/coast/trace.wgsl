// The surface: sand, water, the person or the sky, whichever a ray meets first, and how far off it is. The air in front
// of it is air.wgsl's.

// the open sea, beyond the water's grid
fn ocean(q: vec2f) -> f32 {
  let z = q.y - F.coast.y + F.coast.x;
  return F.sea.y + swellAt(q.x, z, F.sea.x, 5.425) * smoothstep(-900.0, -300.0, q.x);
}
fn rough(p: vec2f) -> f32 {
  let q = onMap(p);
  if (q.x < F.map.x + 4.0) {
    return ocean(q);
  }
  return textureSampleLevel(topMap, look, mapUv(q), 0.0).r + inland(q.x);
}
struct Four {
  a: vec4f, // weights
  u: vec4f, // places: x0, x1, y0, y1
};
fn four(size: vec2f, uv: vec2f) -> Four {
  let q = uv * size - 0.5;
  let i = floor(q);
  let f = q - i;
  let w0 = (1.0 - f) * (1.0 - f) * (1.0 - f) / 6.0;
  let w1 = (4.0 - 6.0 * f * f + 3.0 * f * f * f) / 6.0;
  let w3 = f * f * f / 6.0;
  let w2 = 1.0 - w0 - w1 - w3;
  let a = w0 + w1;
  let b = w2 + w3;
  var o: Four;
  o.a = vec4f(a.x, b.x, a.y, b.y);
  let t0 = (i - 0.5 + w1 / a) / size;
  let t1 = (i + 1.5 + w3 / b) / size;
  o.u = vec4f(t0.x, t1.x, t0.y, t1.y);
  return o;
}
fn spline(t: texture_2d<f32>, uv: vec2f) -> vec4f {
  let k = four(vec2f(textureDimensions(t)), uv);
  return k.a.z * (k.a.x * textureSampleLevel(t, look, k.u.xz, 0.0) + k.a.y * textureSampleLevel(t, look, k.u.yz, 0.0)) +
    k.a.w * (k.a.x * textureSampleLevel(t, look, k.u.xw, 0.0) + k.a.y * textureSampleLevel(t, look, k.u.yw, 0.0));
}
fn smooth1(p: vec2f) -> f32 {
  let q = onMap(p);
  if (q.x < F.map.x + 4.0) {
    return ocean(q);
  }
  return spline(topMap, mapUv(q)).r + inland(q.x);
}
fn waterAt(q: vec2f) -> vec4f {
  if (q.x < F.map.x + 6.0) {
    return vec4f(3.0, 0.0, 1.0, 1.0);
  }
  if (q.x > F.sea.z) {
    return vec4f(0.0);
  }
  return spline(waterMap, vec2f((q.x - F.map.x + 0.5 * F.map.w) / (F.map.w * f32(textureDimensions(waterMap).x)), q.y / F.map.z + 0.5 * F.map.w / F.map.z));
}

// where the person walked at a moment of the loop
fn wayAt(u: f32) -> f32 {
  let t = fract(u) * 64.0;
  let i = i32(floor(t));
  let f = t - f32(i);
  let a = i & 63;
  let b = (i + 1) & 63;
  return mix(F.way[a >> 2][a & 3], F.way[b >> 2][b & 3], f);
}

@group(0) @binding(13) var grainMap: texture_2d_array<f32>;
// one of the sand's noises at a place given in its cells, as fine as is seen where a pixel is `wide` cells: value, slopes
fn grainAt(p: vec2f, k: i32, wide: f32) -> vec3f {
  return textureSampleLevel(grainMap, again, p / GRAINS[k], k, max(log2(wide * GRAIN_WIDE / GRAINS[k].x) - 1.5, 0.0)).xyz;
}

// what a ray off water or wet sand sees: the person, else the dunes, else the sky
fn mirrored(ro: vec3f, rd: vec3f, dice: f32) -> vec3f {
  let who = mirroredPerson(ro, rd);
  if (who > 0.5) {
    return vec3f(0.045, 0.037, 0.034);
  }
  let sky = hillsAt(rd, skyAt(rd));
  if (rd.x < -0.02) {
    return sky;
  }
  var s = 2.0 * (1.0 + dice);
  for (var i = 0; i < 14; i++) {
    let p = ro + rd * s;
    if (p.y > F.haze.w) {
      break;
    }
    if (p.y < rough(p.xz)) {
      let fill = textureSampleLevel(fillMap, look, mapUv(onMap(p.xz)), 0.0).rgb;
      let sand = F.sand.rgb * (fill + F.sunTone.rgb * 0.25 * sunAt(p) * patchAt(p));
      return mix(sky, sand, exp(-s * 0.006));
    }
    s *= 1.4;
  }
  return sky;
}
fn glint(n: vec3f, v: vec3f, l: vec3f, a: f32) -> f32 {
  let h = normalize(v + l);
  let nh = max(dot(n, h), 0.0);
  let a2 = a * a;
  let d = a2 / (3.14159 * pow(nh * nh * (a2 - 1.0) + 1.0, 2.0));
  let vh = max(dot(v, h), 0.0);
  let f = 0.02 + 0.98 * pow(1.0 - vh, 5.0);
  return d * f * 0.25 / max(max(dot(n, v), dot(n, l)), 0.08);
}

// small waves: cells a bay; cells they go out in a loop; which way they go along it; how steep
const CHOP = array<vec4f, 5>(vec4f(7.0, 16.0, 0.0, 0.10), vec4f(15.0, 29.0, 1.0, 0.09), vec4f(31.0, 47.0, -1.0, 0.08), vec4f(67.0, 83.0, 1.0, 0.07), vec4f(149.0, 131.0, 0.0, 0.05));

// the sand's swells: cells a bay; how much shorter they are inland than along the coast; how steep; how much they colour it
const SWELLS = array<vec4f, 4>(vec4f(5.0, 1.5, 0.075, 0.35), vec4f(13.0, 1.4, 0.050, 0.3), vec4f(37.0, 1.3, 0.022, 0.22), vec4f(112.0, 1.2, 0.012, 0.25));

@fragment
fn frag(@builtin(position) at: vec4f) -> @location(0) vec4f {
  let f = F.size.z;
  let ro = F.eye.xyz;
  let rd = rayAt((at.xy + jitter()) / F.size.xy * 2.0 - 1.0);
  let pix = 2.0 * F.up.w / F.size.y;
  let dice = h1(u32(at.x) + u32(at.y) * 8192u + u32(f) * 0x1000193u);
  let l = F.sun.xyz;

  // how fast the ground comes nearer, mostly; where it is steeper still a step may end in it, and is taken back
  let fall = 0.88 * length(rd.xz) - rd.y;
  let ceil1 = F.haze.w;
  var t = 0.4;
  if (ro.y > ceil1) {
    if (rd.y >= 0.0) {
      t = FAR;
    } else {
      t = (ceil1 - ro.y) / rd.y;
    }
  }
  var hit = false;
  var t0 = t;
  var over0 = 1.0;
  var gone = false;
  for (var i = 0; i < 300; i++) {
    let p = ro + rd * t;
    if ((p.y > ceil1 && rd.y > 0.0) || t > FAR) {
      gone = true;
      break;
    }
    let over = p.y - rough(p.xz);
    if (over < pix * t * 0.2) {
      if (over < -0.2 * pix * t && i > 0) {
        // between the last place above the ground and this one
        var a = vec2f(t0, over0);
        var b = vec2f(t, over);
        for (var k = 0; k < 3; k++) {
          let m = mix(a.x, b.x, clamp(a.y / (a.y - b.y), 0.1, 0.9));
          let q = ro + rd * m;
          let o = q.y - rough(q.xz);
          if (o > 0.0) {
            a = vec2f(m, o);
          } else {
            b = vec2f(m, o);
          }
        }
        t = mix(a.x, b.x, a.y / (a.y - b.y));
      }
      hit = true;
      break;
    }
    t0 = t;
    over0 = over;
    t += max(over / max(fall, 0.05) * 0.92, pix * t * 0.35);
  }
  hit = hit || (!gone && t < FAR);
  if (hit) {
    // onto the smooth ground: one step, and then by how much that step brought
    let d0 = ro.y + rd.y * t - smooth1(ro.xz + rd.xz * t);
    let s0 = d0 / max(fall, 0.15) * 0.9;
    let d1 = ro.y + rd.y * (t + s0) - smooth1(ro.xz + rd.xz * (t + s0));
    let less = (d0 - d1) / select(s0, 1e-4, abs(s0) < 1e-4); // how fast it comes nearer
    t += s0 + clamp(d1 / max(less, 0.12), -pix * t, pix * t);
  }
  var col = vec3f(0.0);
  var far = FAR;
  if (hit) {
    far = t;
    let p = ro + rd * t;
    let q = onMap(p.xz);
    let e = max(0.35, pix * t * 0.8);
    let hx = smooth1(p.xz + vec2f(e, 0.0)) - smooth1(p.xz - vec2f(e, 0.0));
    let hz = smooth1(p.xz + vec2f(0.0, e)) - smooth1(p.xz - vec2f(0.0, e));
    var n = normalize(vec3f(-hx, 2.0 * e, -hz));
    let steep = smoothstep(0.42, 0.58, length(vec2f(hx, hz)) / (2.0 * e));
    let w = waterAt(q);
    let u = F.size.w;
    let vis0 = sunAt(p + n * 0.03) * patchAt(p);
    let vis = min(vis0, personShade(p + n * 0.03));
    let fill = textureSampleLevel(fillMap, look, mapUv(q), 0.0).rgb;

    // ---- the sand, also under shallow water
    var sn = n;
    // how big a pixel is on the ground
    let print = pix * t / sqrt(max(-rd.y, 0.04));
    let high = smoothstep(1.6, 3.0, p.y);
    // swells and hollows of all sizes, and ripples across the wind. All of it repeats with the bays.
    let zc = q.y / F.coast.w; // bays
    let deep = w.x > 0.8;
    var swells = vec2f(0.0); // slopes along x and z
    var mottle = 0.0;
    for (var k = 0; k < 4; k++) {
      let L = SWELLS[k];
      let each = F.coast.w / L.x;
      // (leant over, so that the cells do not line up with the coast)
      // not where it is too small to be seen, or under water
      if (deep || print > 0.7 * each) {
        continue;
      }
      let g = grainAt(vec2f(zc * L.x + q.x * 0.37 / each, q.x * L.y / each), k, print / each);
      let keep = smoothstep(0.7, 0.2, print / each);
      swells += vec2f(g.y * 0.37 + g.z * L.y, g.y) * L.z * keep;
      mottle += g.x * L.w * keep;
    }
    let bend1 = grainAt(vec2f(zc * 7.0 + q.x * 0.05, q.x * 0.11), 4, print * 0.117);
    let bend2 = grainAt(vec2f(zc * 22.0 + q.x * 0.12, q.x * 0.31), 5, print * 0.37);
    let bent = 2.4 * bend1.x + 1.0 * bend2.x;
    let bentBy = 2.4 * vec2f(bend1.y * 0.05 + bend1.z * 0.11, bend1.y * 7.0 / F.coast.w) + 1.0 * vec2f(bend2.y * 0.12 + bend2.z * 0.31, bend2.y * 22.0 / F.coast.w);
    // not near a crest, where the sand is blown smooth
    let crest = textureSampleLevel(topMap, look, mapUv(q - vec2f(6.0, 0.0)), 0.0).r - p.y;
    // how far apart two pixels are on the ground, to the side and away
    let aside = normalize(vec2f(F.right.x, F.right.z)) * pix * t;
    let off = normalize(rd.xz) * pix * t / max(dot(n, -rd), 0.05);
    let slid0 = grainAt(vec2f(zc * 9.0 - q.x * 0.06, q.x * 0.19), 6, print * 0.15);
    var ripples = vec2f(0.0);
    for (var k = 0; k < select(2, 0, deep); k++) {
      // small ones, and broad low ones that are seen from afar, in patches
      let wide = F.fine.y * (1.0 + 2.1 * f32(k));
      let w0 = vec2f(1.0 / wide, 0.0) + bentBy * (1.0 - 0.55 * f32(k));
      let wave = TAU * (q.x / wide + bent * (1.0 - 0.55 * f32(k)));
      let cycles = abs(dot(w0, aside)) + abs(dot(w0, off));
      let patchy = smoothstep(-0.12, 0.4, select(mottle + bend2.x, 0.9 * slid0.x - 0.5 * bend1.x, k == 1));
      let seen = (1.0 - smoothstep(0.10, 0.36, cycles)) * mix(0.12, 1.0, patchy);
      ripples += normalize(w0) * cos(wave + 0.6 * sin(wave)) * F.fine.x * (1.0 + 0.3 * f32(k)) * seen;
    }
    ripples *= (1.0 - steep) * mix(0.3, 1.0, high) * smoothstep(-0.9, 0.1, crest);
    // where sand slides down a steep face it leaves tongues
    let slid = grainAt(vec2f(zc * 34.0 + 0.3 * bend2.x, p.y * 0.30 + 3.0), 7, print * 0.57);
    let tongue = slid.x * steep;
    sn = normalize(sn - vec3f(ripples.x, 0.0, ripples.y) - vec3f(swells.x, 0.0, swells.y) * F.fine.z * mix(0.35, 1.0, high) * (1.0 - 0.6 * steep) + vec3f(0.0, 0.0, 0.05) * tongue);
    // footprints, strung out behind the person
    let tall = F.walk.w;
    let behind = F.walk.z - p.z;
    var dent = 0.0;
    if (behind > -0.5 && behind < 45.0) {
      let px = wayAt(u - behind / F.coast.w) - bend(p.z);
      if (abs(p.x - px) < 0.4 * tall) {
        let pace = 2.0 * F.pose.z * tall;
        let s0 = F.pose.x / 3.14159265;
        let kk = round(behind / pace - fract(s0));
        let left = (i32(floor(s0)) - i32(kk)) & 1;
        let o = (vec2f(behind, p.x - px) - vec2f((kk + fract(s0)) * pace, (0.5 - f32(left)) * 0.10 * tall)) / (vec2f(0.11, 0.055) * tall);
        dent = exp(-dot(o, o)) * exp(-behind / 22.0) * smoothstep(-0.5, 0.2, behind) * (1.0 - smoothstep(0.0, 0.02, w.x));
        sn = normalize(sn + vec3f(o.y, 0.0, -o.x) * dent * 0.9);
      }
    }
    let nl = max(dot(sn, l), 0.0);
    let nv = max(dot(sn, -rd), 0.02);
    let r2 = F.sand.w * F.sand.w;
    let cosPhi = dot(normalize(l - sn * dot(sn, l)), normalize(-rd - sn * dot(sn, -rd)));
    let sa = sqrt(max((1.0 - nl * nl) * (1.0 - nv * nv), 0.0)) / max(max(nl, nv), 0.25);
    let oren = (1.0 - 0.5 * r2 / (r2 + 0.33)) + 0.45 * r2 / (r2 + 0.09) * max(cosPhi, 0.0) * sa;
    var sand = F.sand.rgb * (1.0 + F.fine.z * (0.55 * mottle + 0.5 * tongue));
    // paler grains gather apart from the darker, redder ones
    sand *= mix(vec3f(1.0), vec3f(1.03, 1.0, 0.95), clamp(bend2.x * 1.6, -1.0, 1.0) * F.fine.z * 5.0);
    let speck = h2(i32(floor(p.x * 37.0)), i32(floor((p.z) * 37.0)), 7u) - 0.5;
    sand *= 1.0 + F.fine.w * speck * (1.0 - smoothstep(0.02, 0.12, pix * t));
    // the beach is paler and flatter in colour than the dunes
    sand = mix(sand * vec3f(0.80, 0.88, 1.02), sand, smoothstep(0.8, 2.8, p.y));
    let wet = w.z * (1.0 - smoothstep(2.0, 4.0, p.y));
    var fill2 = fill;
    if (distance(p, F.walk.xyz) < tall) {
      fill2 *= mix(0.35, 1.0, smoothstep(0.0, 0.16, feetFrom(toThem((p - F.walk.xyz) / tall))));
    }
    fill2 *= 1.0 - 0.45 * dent;
    // in the shade, what leans away from the sun sees more of the open sky
    let open = normalize(vec3f(-l.x, 0.9, -l.z));
    fill2 *= clamp(1.0 + F.haze.z * dot(sn - n, open), 0.5, 1.5);
    let damp = mix(sand, sand * sand * 0.6 + sand * 0.16, wet * 0.85);
    let dry = damp * (F.sunTone.rgb * nl * oren * vis + fill2);
    col = dry;

    // ---- wet sand and water
    let flood = smoothstep(0.004, 0.05, w.x);
    if (wet > 0.02 || flood > 0.0 || w.y > 0.02) {
      // small waves the grid is too coarse for; smaller in a film
      var wn = normalize(mix(vec3f(0.0, 1.0, 0.0), n, max(flood, 0.6)));
      let t0 = F.sea.x;
      let zz = q.y - F.coast.y + F.coast.x;
      // the wind off the land drives them out to sea; each layer goes by a whole number of its cells in a loop
      var chop = vec2f(0.0);
      var lost = 0.0;
      for (var k = 0; k < 5; k++) {
        let L = CHOP[k];
        let wide = F.coast.w / L.x;       // a cell along the coast, metres; across it is less than that
        let g = wrapSlope(vec2f(q.x / (wide * 0.55) + L.y * u, zc * L.x + L.z * L.x * u), vec2i(i32(L.y), i32(L.x)), 161u + u32(k)).yz;
        let keep = smoothstep(0.9, 0.2, print / (wide * 0.55));
        chop += g * vec2f(1.0 / 0.55, 1.0) * L.w * keep;
        lost += L.w * (1.0 - keep);
      }
      let choppy = smoothstep(0.02, 0.8, w.x);
      wn = normalize(wn + vec3f(-chop.x, 0.0, -chop.y) * mix(0.02, 1.0, choppy));
      wn = normalize(wn - rd * max(dot(wn, rd) + 0.02, 0.0));
      var rr = reflect(rd, wn);
      // rough water shows sky from higher up, on the whole
      rr = normalize(vec3f(rr.x, abs(rr.y) + 0.004 + 0.34 * choppy, rr.z));
      let fres = 0.02 + 0.98 * pow(1.0 - max(dot(wn, -rd), 0.0), 5.0) * mix(1.0, 0.48, choppy);
      let seen = mirrored(p + vec3f(0.0, 0.05, 0.0), normalize(rr), dice);
      let ruf = mix(0.10, F.water.w, choppy) + lost * choppy;
      let spark = glint(wn, -rd, l, max(ruf, 0.06)) * vis0;
      let mirror = seen * fres + F.sunTone.rgb * min(spark, 6.0);
      // what is under it: pale sand, seen through water that takes the red out of it and gives back turquoise while
      // it is shallow, blue where it is deep
      let thin = exp(-w.x * vec3f(1.6, 0.42, 0.40));
      let own = mix(F.more.yzw, F.water.rgb, smoothstep(0.2, 1.7, w.x));
      let above = skyFall(vec3f(0.0, 1.0, 0.0));
      let light = mix(above, vec3f(dot(above, vec3f(0.34))), 0.55) * 1.1 + F.sunTone.rgb * 0.16 * vis0;
      // light gathered by the waves runs over the bottom in a net
      var net1 = 1.0;
      if (w.x > 0.05 && w.x < 2.2) {
        let a1 = wrapHill(vec2f(zc * 29.0 + q.x * 0.31 + 29.0 * u + chop.x * 1.2, q.x * 0.52 + chop.y * 0.8), 29, 191u);
        let b1 = wrapHill(vec2f(zc * 43.0 - q.x * 0.44 - 43.0 * u + a1.y * 0.25, q.x * 0.74 + a1.z * 0.25), 43, 193u);
        let line = max(1.0 - 2.8 * abs(a1.x), 0.0) * 0.6 + max(1.0 - 3.4 * abs(b1.x), 0.0) * 0.6;
        net1 = mix(1.0, 0.86 + 0.55 * line * line, smoothstep(0.05, 0.25, w.x) * smoothstep(2.2, 0.9, w.x) * smoothstep(0.9, 0.25, print / 1.2));
      }
      let floor1 = mix(sand, vec3f(dot(sand, vec3f(0.4))), 0.25) * (F.sunTone.rgb * 0.13 * vis0 + fill2 * 0.5) * net1;
      let murk = 1.0 - exp(-w.x * 1.9);
      let body = own * light * murk * mix(1.0, net1, 0.25);
      // light comes through a wave that stands against the sun
      let back = max(dot(rd, l), 0.0);
      let lit = F.water.rgb * vec3f(0.8, 1.15, 1.0) * F.sunTone.rgb * 0.5 * back * back * smoothstep(0.12, 0.35, length(n.xz)) * vis0;
      let under = mix(dry, body + lit * murk + floor1 * thin, smoothstep(0.0, 0.12, w.x));
      let watery = under * (1.0 - fres) + mirror;
      let shiny = dry * (1.0 - fres * wet) + mirror * wet * mix(0.75, 1.0, wet);
      col = mix(shiny, watery, flood);
      // foam: a net of bubbles that opens into lace as it dies
      // the face of a wave that breaks is white too
      let face = smoothstep(0.20, 0.45, length(n.xz)) * smoothstep(0.05, 0.25, w.x);
      let c1 = wrapHill(vec2f(zc * 43.0 + q.x * 0.29, q.x * 0.70), 43, 171u);
      let c2 = wrapHill(vec2f(zc * 127.0 + q.x * 0.71, q.x * 2.0), 127, 173u);
      // the grid's own squares must not show: what is read off it is read from a little to the side
      let w2 = waterAt(q + (vec2f(c1.z, c1.y) * 0.45 + vec2f(c2.z, c2.y) * 0.22) * mix(1.0, 0.35, steep));
      // at its edge, where it is only a film, it comes apart
      let film = smoothstep(0.10, 0.004, w2.x);
      let k1 = clamp(max(w2.y * 1.15, face * 0.9) - film * max(0.22 + 0.55 * c1.x + 0.75 * c2.x, 0.0), 0.0, 1.0);
      if (k1 > 0.015) {
        let warp = vec2f(c1.y, c1.z) * 0.30 + vec2f(c2.y, c2.z) * 0.10;
        let fineness = smoothstep(0.5, 0.1, print / 0.25);
        let wall1 = bubbles(vec2f(zc * 46.0 + q.x * 0.31, q.x * 0.77) + warp, 46, 175u);
        let wall2 = bubbles(vec2f(zc * 139.0 - q.x * 0.83, q.x * 2.3) + warp * 1.7, 139, 177u);
        let c3 = wrapHill(vec2f(zc * 367.0 + q.x * 2.3, q.x * 5.9), 367, 179u);
        let net = wall1.x * 0.62 + wall2.x * 0.42 * mix(0.6, 1.0, fineness) + c1.x * 0.18 + c2.x * 0.16 + c3.x * 0.22 * fineness;
        let lace = smoothstep(k1 * 1.25, k1 * 1.25 - 0.28, net) * smoothstep(0.02, 0.25, k1);
        let foamed = max(lace, smoothstep(0.80, 1.0, k1) * 0.9);
        // it is heaped, not flat
        let heap = c1.zy * 0.20 + c2.zy * 0.26 + c3.zy * 0.28 * fineness;
        let fn1 = normalize(n + vec3f(heap.x, 0.0, heap.y) * 0.55);
        let thickness = clamp(k1 * 1.2 - net * 0.7, 0.0, 1.0);
        let foamLight = mix(vec3f(0.50, 0.56, 0.62), vec3f(0.78, 0.79, 0.80), thickness) * (F.sunTone.rgb * (0.07 + 0.62 * max(dot(fn1, l), 0.0)) * vis0 + mix(fill, vec3f(dot(fill, vec3f(0.34))), 0.45) * (0.6 + 0.4 * thickness));
        col = mix(col, foamLight, foamed * 0.92);
      }
    }
  } else {
    col = hillsAt(rd, skyAt(rd));
  }

  // the land and the sea end in haze, not in a line
  if (hit && far > 450.0 && far < FAR) {
    let d0 = normalize(vec3f(rd.x, max(rd.y, 0.004), rd.z));
    col = mix(col, hillsAt(d0, skyTone(d0)), smoothstep(450.0, 1250.0, far));
  }
  return vec4f(max(col, vec3f(0.0)), min(far, FAR));
}
