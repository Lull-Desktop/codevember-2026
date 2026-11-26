// The block of land, ray marched. Its height at a point is the mountains' height, read from the picture
// baked by bake.wgsl, or the height the river has cut the ground down to, whichever is lower. The river's
// part is read from the picture of "how long since the river was here" that field.ts redraws every frame:
// just left is under water, a little longer is a bare bar, long ago is back up at the valley floor.

struct Params {
  size: vec4f, // the picture's width and height; the frame; seconds
  eye: vec4f,
  right: vec4f, // .w: half the picture's width at distance 1
  up: vec4f, // .w: half its height
  fore: vec4f,
  sun: vec4f, // the way to the sun; its strength
  block: vec4f, // the block's underside; the top of the air over it; sky light; shade in hollows
  water: vec4f, // the water's level; the channel's depth; how far a fresh bank stands out of the water; steps the river has taken
  ages: vec4f, // steps for cut ground to be back at the valley floor; steps to come out of the water; and the two numbers the ages are stored with
  valley: vec4f, // the valley's swing: how far, how often, its phase; and the valley's middle
  bars: vec4f, // scroll bars: their height, the steps between them; how much they show as colour; 1 to see the steps taken
  fog: vec4f, // how thick; how high it stands; how much of it is wisps; the wisps' size
  air: vec4f, // haze toward the back; how much the fog throws light forward; how far the wisps have drifted; the fog's brightness
  tint: vec4f, // the height of the far tops; where the trees end and where the snow starts, as parts of it; how much of the fog lies over the river's ground
  more: vec4f, // ripples on the water; how far above the smooth land the fog's top lies in the mountains, as a part of their height
};
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var heights: texture_2d<f32>;
@group(0) @binding(2) var light: texture_2d<f32>;
@group(0) @binding(3) var river: texture_2d<f32>;
@group(0) @binding(4) var soft: sampler;

const TAU = 6.28318530718;
const NEAR = 0.25; // shadows from nearer than this are marched; from further they are read (light.wgsl)
const SUN = vec3f(1.0, 0.74, 0.52);
const SKY = vec3f(0.50, 0.58, 0.92);

@vertex
fn vert(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  return vec4f(f32((i << 1u) & 2u) * 2.0 - 1.0, f32(i & 2u) * 2.0 - 1.0, 0.0, 1.0);
}

fn pcg(v: u32) -> u32 {
  let s = v * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
fn h3(p: vec3i) -> f32 {
  return f32(pcg((u32(p.x) * 1597334677u) ^ (u32(p.y) * 3812015801u) ^ (u32(p.z) * 2798796415u))) * (1.0 / 4294967296.0);
}
fn noise(x: vec3f) -> f32 {
  let i = vec3i(floor(x));
  let f = fract(x);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(h3(i), h3(i + vec3i(1, 0, 0)), u.x), mix(h3(i + vec3i(0, 1, 0)), h3(i + vec3i(1, 1, 0)), u.x), u.y),
    mix(mix(h3(i + vec3i(0, 0, 1)), h3(i + vec3i(1, 0, 1)), u.x), mix(h3(i + vec3i(0, 1, 1)), h3(i + vec3i(1, 1, 1)), u.x), u.y),
    u.z,
  );
}

// the smaller of two, with the crease between them rounded over k
fn smin(a: f32, b: f32, k: f32) -> f32 {
  let h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}

// the valley's middle line: z for an x (the same as in bake.wgsl)
fn axisAt(x: f32) -> f32 {
  return P.valley.w + P.valley.x * sin(x * P.valley.y + P.valley.z);
}

// rg: the mountains' height, in two parts; b: -1 in gullies, 1 on ridges; a: the height before the gullies
fn landAt(x: vec2f) -> vec4f {
  return textureSampleLevel(heights, soft, x * 0.5 + 0.5, 0.0);
}

// x: steps since the river last ran here; y: 1 in the running water; z: 0 on ground the river's bed has
// passed over, 1 on a bank it cut. The river's picture is laid along the valley, so it swings with it.
fn riverAt(x: vec2f) -> vec3f {
  let uv = vec2f(x.x, x.y - axisAt(x.x)) * 0.5 + 0.5;
  let s = textureSampleLevel(river, soft, uv, 0.0);
  let e = (s.r * 65280.0 + s.g * 255.0) / 65535.0;
  return vec3f(P.ages.z * (exp(e * P.ages.w) - 1.0), s.b, s.a);
}

// How high ground stands that the river left `age` steps ago. Under water at first; out of it within
// ages.y steps; then up, ever more slowly, to the valley floor (height 0) at ages.x steps. The scroll bars
// are low ridges, one for every so many steps of the river's going: they mark where it has been.
fn cutAt(rv: vec3f) -> f32 {
  let age = rv.x;
  let t = age / P.ages.x;
  let dry = 1.0 - exp(-age / P.ages.y);
  let rise = -P.water.x - P.water.z;
  var h = P.water.x - P.water.y + (P.water.y + P.water.z) * dry + rise * pow(min(t, 2.0), 0.7);
  let since = P.water.w - age;
  h += P.bars.x * sin(TAU * since / P.bars.y) * smoothstep(2.0, 6.0, age / P.ages.y) * (1.0 - smoothstep(0.6, 1.0, t)) * (1.0 - smoothstep(0.0, 0.25, rv.z));
  // ground the river has not been to for long enough is not cut at all
  return h + 3.0 * smoothstep(1.3, 2.6, t);
}

fn ground(x: vec2f) -> f32 {
  let l = landAt(x);
  return smin(l.r + l.g, cutAt(riverAt(x)), 0.008);
}

fn normalAt(x: vec2f, e: f32) -> vec3f {
  return normalize(vec3f(ground(x - vec2f(e, 0.0)) - ground(x + vec2f(e, 0.0)), 2.0 * e, ground(x - vec2f(0.0, e)) - ground(x + vec2f(0.0, e))));
}

// where a ray enters and leaves a box: x and y; it misses if x > y
fn boxHit(ro: vec3f, rd: vec3f, lo: vec3f, hi: vec3f) -> vec2f {
  let inv = 1.0 / rd;
  let a = (lo - ro) * inv;
  let b = (hi - ro) * inv;
  let n = min(a, b);
  let f = max(a, b);
  return vec2f(max(n.x, max(n.y, n.z)), min(f.x, min(f.y, f.z)));
}

// the shadow of what is near: a short march toward the sun over the ground as it is now, river banks and all
fn nearShadow(p: vec3f) -> f32 {
  var res = 1.0;
  var t = 0.004;
  for (var i = 0; i < 14; i++) {
    let q = p + P.sun.xyz * t;
    if (max(abs(q.x), abs(q.z)) > 1.0) {
      break;
    }
    res = min(res, 22.0 * (q.y - ground(q.xz)) / t);
    if (res < 0.0 || t > NEAR) {
      break;
    }
    t *= 1.36;
  }
  return clamp(res, 0.0, 1.0);
}

// the shadow the whole block throws on the floor it stands on
fn blockShadow(p: vec3f) -> f32 {
  let b = boxHit(p, P.sun.xyz, vec3f(-1.0, P.block.x, -1.0), vec3f(1.0, P.block.y, 1.0));
  if (b.x >= b.y || b.y <= 0.0) {
    return 1.0;
  }
  var t = max(b.x, 0.0) + 0.002;
  var res = 1.0;
  for (var i = 0; i < 48; i++) {
    let q = p + P.sun.xyz * t;
    let d = q.y - ground(q.xz);
    if (d < 0.0) {
      return 0.0;
    }
    res = min(res, 9.0 * d / t);
    t += max(0.012, d * 0.5);
    if (t > b.y) {
      break;
    }
  }
  return clamp(res, 0.0, 1.0);
}

fn skyAt(rd: vec3f) -> vec3f {
  let h = clamp(rd.y, 0.0, 1.0);
  let s = max(dot(rd, P.sun.xyz), 0.0);
  return mix(vec3f(1.0, 0.80, 0.70), vec3f(0.42, 0.52, 0.86), pow(h, 0.55)) * 1.1 + SUN * (0.5 * pow(s, 6.0) + 6.0 * pow(s, 90.0));
}

// the plain wall behind everything: a soft light low down, dimmer and bluer up high
fn backdrop(uv: vec2f) -> vec3f {
  let v = clamp(0.5 - 0.5 * uv.y, 0.0, 1.0);
  var c = mix(vec3f(0.58, 0.40, 0.44), vec3f(0.10, 0.13, 0.30), smoothstep(0.0, 1.0, v));
  c += vec3f(0.22, 0.12, 0.09) * exp(-2.5 * dot(uv - vec2f(-0.2, 0.15), uv - vec2f(-0.2, 0.15)));
  return c;
}

// The fog's thickness at a point. It lies on the land: thin over the river's ground, thick along the foot of
// the far mountains and a little way up their sides (not the near ones, which would hide the river), thinning upward and toward the block's sides; and it is
// broken into banks and wisps that drift.
fn fogAt(p: vec3f) -> f32 {
  let edge = 1.0 - smoothstep(0.72, 1.0, max(abs(p.x), abs(p.z)));
  let lie = landAt(p.xz).a; // the land's height here, before its gullies
  // on the slopes its top follows the land as it was before the gullies were cut, so it fills the gullies
  // and the ridges stand out of it
  let y = max(p.y - mix(P.water.x, lie + P.more.y * P.tint.x, smoothstep(0.0, 0.05, lie)), 0.0);
  let foot = smoothstep(0.0, 0.05, lie) * (1.0 - smoothstep(0.25, 0.6, lie / P.tint.x)) * step(p.z, axisAt(p.x));
  let d = P.air.z;
  let bank = noise(vec3f(p.x * 1.7 + d * 0.5, p.z * 2.3, d * 0.2 + 3.0));
  let q = p * P.fog.w + vec3f(d, -0.3 * d, 0.4 * d);
  let wisp = noise(q) * 0.6 + noise(q * 2.3 + vec3f(7.1, 0.0, 3.3)) * 0.4;
  let w = smoothstep(0.38, 0.72, mix(bank, wisp, 0.45) + 0.25 * (bank - 0.5));
  return P.fog.x * exp(-y / P.fog.y) * edge * mix(P.tint.w, 1.0, foot) * mix(1.0, 2.2 * w, P.fog.z);
}

struct Lit {
  sun: f32, // how much of the sun reaches the point
  open: f32, // how much of the sky it sees
};
fn lightAt(p: vec3f, march: bool) -> Lit {
  let l = textureSampleLevel(light, soft, p.xz * 0.5 + 0.5, 0.0);
  let pen = 0.006 + 0.03 * l.a;
  var o: Lit;
  o.sun = smoothstep(-pen, pen, p.y - l.r);
  if (march && o.sun > 0.0) {
    o.sun *= nearShadow(p);
  }
  o.open = l.b;
  return o;
}

// the colour of the ground: by height and steepness in the mountains, by age where the river has been
fn groundColour(p: vec3f, n: vec3f, land: vec4f, rv: vec3f) -> vec3f {
  let grass = vec3f(0.50, 0.58, 0.36);
  let wood = vec3f(0.20, 0.33, 0.30);
  let rock = vec3f(0.40, 0.32, 0.35);
  let pale = vec3f(0.62, 0.52, 0.50);
  let snow = vec3f(0.95, 0.94, 0.97);
  let sand = vec3f(0.66, 0.56, 0.42);
  let earth = vec3f(0.62, 0.45, 0.36);

  let blot = noise(vec3f(p.xz * 9.0, 1.0)) * 0.6 + noise(vec3f(p.xz * 31.0, 4.0)) * 0.4;
  let alt = p.y / P.tint.x;
  let ridge = land.b;
  // mountains: rock where steep, trees up to a line (higher in the gullies), then bare, then snow
  var c = mix(grass, grass * vec3f(1.12, 1.05, 0.8), smoothstep(0.35, 0.75, blot));
  let trees = smoothstep(0.02, 0.07, p.y) * (1.0 - smoothstep(-0.06, 0.06, alt - P.tint.y + 0.10 * ridge + 0.08 * (blot - 0.5)));
  c = mix(c, wood * (0.85 + 0.4 * blot), trees * smoothstep(0.36, 0.6, n.y + 0.08 * (blot - 0.5)));
  let bare = mix(rock, pale, smoothstep(-0.3, 0.6, ridge));
  c = mix(c, bare, smoothstep(0.02, 0.07, p.y) * max(1.0 - smoothstep(0.34, 0.56, n.y), smoothstep(-0.05, 0.08, alt - P.tint.y)));
  c = mix(c, snow, smoothstep(-0.05, 0.07, alt - P.tint.z + 0.12 * ridge) * smoothstep(0.35, 0.6, n.y));

  // the river's ground: sand just out of the water, then grass, darker along every other scroll bar
  let age = rv.x;
  let t = age / P.ages.x;
  let cut = smoothstep(0.002, 0.010, land.r + land.g - p.y);
  var f = mix(sand, grass * vec3f(1.25, 1.18, 0.95), smoothstep(2.0, 9.0, age / P.ages.y + 3.0 * (blot - 0.5)));
  f = mix(f, c, smoothstep(0.35, 1.0, t));
  let since = P.water.w - age;
  let band = 0.5 + 0.5 * sin(TAU * since / P.bars.y + 1.2);
  f = mix(f, wood * 1.15, P.bars.z * smoothstep(0.5, 0.9, band) * smoothstep(8.0, 20.0, age / P.ages.y) * (1.0 - smoothstep(0.8, 1.1, t)) * (1.0 - smoothstep(0.0, 0.25, rv.z)));
  f = mix(f, earth, 1.0 - smoothstep(0.55, 0.8, n.y));
  c = mix(c, f, cut);
  // wet at the water's edge
  return c * mix(0.72, 1.0, smoothstep(0.0, 0.006, p.y - P.water.x));
}

// the cut side of the block: beds of rock and earth, bent a little, with the soil on top
fn wallColour(p: vec3f, top: f32, along: f32) -> vec3f {
  let bend = 0.035 * sin(along * 3.1 + 1.0) + 0.02 * noise(vec3f(along * 6.0, p.y * 3.0, 2.0));
  let y = (p.y + bend) * 26.0;
  let k = floor(y);
  let tone = h3(vec3i(i32(k), 7, 3));
  var c = mix(vec3f(0.58, 0.40, 0.36), vec3f(0.80, 0.63, 0.52), tone);
  c = mix(c, vec3f(0.50, 0.38, 0.40), smoothstep(0.75, 1.0, h3(vec3i(i32(k), 1, 9))));
  c *= 0.9 + 0.1 * smoothstep(0.0, 0.12, fract(y)) + 0.12 * (noise(vec3f(along * 60.0, p.y * 160.0, 5.0)) - 0.5);
  let under = top - p.y;
  c = mix(vec3f(0.30, 0.25, 0.22), c, smoothstep(0.004, 0.016, under));
  // darker toward the foot
  return c * mix(0.62, 1.0, smoothstep(P.block.x, P.block.x + 0.5, p.y));
}

@fragment
fn frag(@builtin(position) at: vec4f) -> @location(0) vec4f {
  let uv = at.xy / P.size.xy * 2.0 - 1.0;
  let ro = P.eye.xyz;
  let rd = normalize(P.fore.xyz + P.right.xyz * (uv.x * P.right.w) - P.up.xyz * (uv.y * P.up.w));
  let pix = 2.0 * P.up.w / P.size.y; // a pixel's width at distance 1
  let sunDir = P.sun.xyz;
  let sunCol = SUN * P.sun.w;
  let lo = vec3f(-1.0, P.block.x, -1.0);
  let hi = vec3f(1.0, P.block.y, 1.0);

  var col = backdrop(uv);
  var far = 1e9; // how far the ray goes before it meets something
  var steps = 0.0;

  // the floor the block stands on is the backdrop again, seen only by the shadow on it
  if (rd.y < 0.0) {
    let tf = (P.block.x - ro.y) / rd.y;
    let p = ro + rd * tf;
    let beyond = max(max(abs(p.x), abs(p.z)) - 1.0, 0.0);
    let reach = exp(-tf * 0.02);
    let sh = mix(1.0, blockShadow(p + vec3f(0.0, 0.001, 0.0)), reach * exp(-beyond * 0.55));
    col *= mix(vec3f(0.56, 0.52, 0.70), vec3f(1.0), sh) * (1.0 - 0.35 * exp(-beyond * 9.0));
    far = tf;
  }

  let b = boxHit(ro, rd, lo, hi);
  if (b.x < b.y && b.y > 0.0) {
    var t = max(b.x, 0.0);
    var p = ro + rd * t;
    let top = ground(p.xz);
    if (p.y < top) {
      // in through a cut side, below the ground
      let side = abs(p.x) > abs(p.z);
      let n = select(vec3f(0.0, 0.0, sign(p.z)), vec3f(sign(p.x), 0.0, 0.0), side);
      let along = select(p.x, p.z + 3.0, side);
      let alb = wallColour(p, top, along);
      let ndl = max(dot(n, sunDir), 0.0);
      col = alb * (sunCol * ndl + SKY * P.block.z * 0.55 + vec3f(0.35, 0.25, 0.2) * P.block.z * 0.35);
      far = t;
    } else {
      // over the ground: step by a part of the height above it, then close in on the crossing
      var hit = false;
      var before = t;
      for (var i = 0; i < 220; i++) {
        p = ro + rd * t;
        let d = p.y - ground(p.xz);
        steps += 1.0;
        if (d < 0.0004 * t) {
          hit = true;
          break;
        }
        before = t;
        t += max(d * 0.38, pix * t * 0.6);
        if (t > b.y) {
          break;
        }
      }
      if (hit) {
        var a = before;
        var c = t;
        for (var i = 0; i < 6; i++) {
          let m = 0.5 * (a + c);
          let q = ro + rd * m;
          if (q.y < ground(q.xz)) {
            c = m;
          } else {
            a = m;
          }
        }
        t = c;
        p = ro + rd * t;
      }
      // the water lies flat at its level wherever the ground is lower
      let tw = (P.water.x - ro.y) / rd.y;
      let wet = rd.y < 0.0 && tw > b.x && tw < b.y && (!hit || tw < t);

      if (hit) {
        let land = landAt(p.xz);
        let rv = riverAt(p.xz);
        let n = normalAt(p.xz, max(0.0011, pix * t * 0.8));
        let alb = groundColour(p, n, land, rv);
        let lit = lightAt(p + n * 0.002, !wet);
        let open = mix(1.0, lit.open, P.block.w);
        let ndl = max(dot(n, sunDir), 0.0);
        col = alb * (sunCol * ndl * lit.sun + SKY * P.block.z * open * (0.55 + 0.45 * n.y) + vec3f(0.55, 0.38, 0.28) * P.block.z * 0.3 * open * (1.0 - n.y));
        far = t;
      } else if (wet) {
        col = vec3f(0.10, 0.20, 0.24); // out through the side under the water
        far = b.y;
      }
      if (wet) {
        let pw = ro + rd * tw;
        let rv = riverAt(pw.xz);
        let lit = lightAt(pw, true);
        // ripples: quicker and stronger where the water runs
        let run = 0.25 + 0.75 * rv.y;
        let q = vec3f(pw.xz * 50.0, P.size.w * 1.2);
        let rip = vec2f(noise(q) - noise(q + vec3f(0.7, 0.0, 0.0)), noise(q + vec3f(0.0, 0.0, 3.0)) - noise(q + vec3f(0.0, 0.7, 3.0)));
        let n = normalize(vec3f(rip.x * P.more.x * run, 1.0, rip.y * P.more.x * run));
        let deep = min(far, b.y) - tw;
        let body = mix(vec3f(0.06, 0.46, 0.52), vec3f(0.02, 0.18, 0.34), 1.0 - exp(-deep * 22.0)) * (sunCol * 0.5 * lit.sun + SKY * P.block.z * 1.7);
        col = mix(col, body, 1.0 - exp(-deep * 90.0));
        let r = reflect(rd, n);
        let fres = 0.04 + 0.96 * pow(1.0 - max(dot(-rd, n), 0.0), 5.0);
        col = mix(col, skyAt(r) * mix(0.35, 1.0, lit.sun), mix(fres, 1.0, 0.14));
        col += sunCol * lit.sun * 4.0 * pow(max(dot(r, sunDir), 0.0), 90.0);
        // a pale line where the water meets the bank
        col = mix(col, vec3f(0.80, 0.86, 0.84) * (0.4 + 0.6 * lit.sun), 0.5 * (1.0 - smoothstep(0.0, 0.0035, deep * -rd.y)) * step(0.5, f32(hit)));
        far = tw;
      }
    }
    // haze: the back of the block is further into the air than the front
    if (far < b.y + 1e-3) {
      let depth = dot(ro + rd * far, P.fore.xyz) - dot(ro, P.fore.xyz) - (length(ro) - 1.5);
      col = mix(col, vec3f(0.56, 0.58, 0.80) * (0.45 + 0.12 * P.sun.w), 1.0 - exp(-P.air.x * max(depth, 0.0)));
    }
  }

  // the fog, marched through the air over the block: lit by the sun where the mountains let it through
  let fogTop = min(P.block.y, 0.75 * P.tint.x + 4.0 * P.fog.y);
  let fb = boxHit(ro, rd, vec3f(-1.0, P.block.x, -1.0), vec3f(1.0, fogTop, 1.0));
  let f0 = max(fb.x, 0.0);
  let f1 = min(fb.y, far);
  if (P.fog.x > 0.0 && f0 < f1) {
    const FOG = 32;
    let dt = (f1 - f0) / f32(FOG);
    let dither = fract(52.9829189 * fract(dot(at.xy + 5.588 * (P.size.z % 64.0), vec2f(0.06711056, 0.00583715))));
    let g = P.air.y;
    let c = dot(rd, sunDir);
    let phase = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * c, 1.5);
    var through = 1.0;
    var glow = vec3f(0.0);
    for (var i = 0; i < FOG; i++) {
      let p = ro + rd * (f0 + (f32(i) + dither) * dt);
      let d = fogAt(p);
      if (d > 1e-4) {
        let l = textureSampleLevel(light, soft, p.xz * 0.5 + 0.5, 0.0);
        let sun = smoothstep(-0.015, 0.03, p.y - l.g);
        let a = 1.0 - exp(-d * dt);
        glow += through * a * (sunCol * sun * phase * 0.55 + vec3f(0.62, 0.66, 0.90) * P.block.z) * P.air.w;
        through *= 1.0 - a;
      }
    }
    col = col * through + glow;
  }

  if (P.bars.w > 0.5) {
    col = mix(vec3f(0.0, 0.0, 0.3), vec3f(1.0, 0.9, 0.0), steps / 220.0); // how many steps the ray took
  }
  return vec4f(max(col, vec3f(0.0)), 1.0);
}
