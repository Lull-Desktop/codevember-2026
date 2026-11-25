// The rock, ray marched. It is a box cut into pieces by a tree of planes (rock.ts): a point finds its piece by
// walking the tree, and the distance to the rock there is the distance to the box's skin or to the nearest
// crack's wall, whichever is nearer. Pieces that have fallen away are empty.

struct Node {
  plane: vec4f, // the cut: its normal and how far along it
  info: vec4f, // half its width when open; the age it starts at; the age its piece falls away; 1 if cut
  grow: vec4f, // how late the crack reaches a point: dot(grow.xyz, p) + grow.w
};
struct Params {
  size: vec4f, // the picture's width and height; which frame of a still this is; the time
  eye: vec4f,
  right: vec4f, // .w: half the picture's width at distance 1
  up: vec4f, // .w: half its height
  fore: vec4f,
  sun: vec4f, // the way to the sun; its strength
  hull: vec4f, // half the box; how round its edges are
  shape: vec4f, // the bend of the whole: how far, how often; the roughness of the faces: how far, how often
  crack: vec4f, // age; width; how long a crack takes to open; how much later its far end opens
  edge: vec4f, // how round the edges wear; how far pieces sit back; how far they tip; how dark a hairline is
  look: vec4f, // sky light; shade in hollows; dark varnish; dust on ledges
  misc: vec4f, // the height of the box's middle; the mound at its foot; grain; haze
  wear: vec4f, // (unused); how high the ledges on a face are; 1 to see the steps taken; how wide the sun is
};
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> nodes: array<Node>;

const LEVELS = 12;
const MARGIN = 0.12; // beyond this from the box, the box alone is asked
const OVER = 0.0005; // a step goes this far past a crack's middle, so as not to creep up to it for ever
const FAR = 60.0;

@vertex
fn vert(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  return vec4f(f32((i << 1u) & 2u) * 2.0 - 1.0, f32(i & 2u) * 2.0 - 1.0, 0.0, 1.0);
}

fn pcg(v: u32) -> u32 {
  let s = v * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
fn h1(v: u32) -> f32 {
  return f32(pcg(v)) * (1.0 / 4294967296.0);
}
fn h3(p: vec3i) -> f32 {
  return h1((u32(p.x) * 1597334677u) ^ (u32(p.y) * 3812015801u) ^ (u32(p.z) * 2798796415u));
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
fn fbm(x: vec3f, octaves: i32) -> f32 {
  var sum = 0.0;
  var a = 0.5;
  var p = x;
  for (var i = 0; i < octaves; i++) {
    sum += a * noise(p);
    p = p * 2.03 + vec3f(17.1, 3.3, 9.7);
    a *= 0.5;
  }
  return sum;
}

fn sdBox(p: vec3f, b: vec3f, r: f32) -> f32 {
  let q = abs(p) - b + r;
  return length(max(q, vec3f(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
}
// the larger of two, with the corner between them rounded over k
fn smax(a: f32, b: f32, k: f32) -> f32 {
  let h = max(k - abs(a - b), 0.0) / max(k, 1e-6);
  return max(a, b) + h * h * k * 0.25;
}

// the whole rock gently bent, so no crack is quite straight; and into the box's own frame
fn bend(p: vec3f) -> vec3f {
  let a = P.shape.x;
  let f = P.shape.y;
  let w = p + a * sin(p.yzx * f + vec3f(1.3, 4.1, 2.2)) + a * 0.5 * sin(p.zxy * f * 2.3 + vec3f(5.2, 0.7, 3.9));
  return w - vec3f(0.0, P.misc.x, 0.0);
}

// how far a piece's outer face sits back from the box's skin, added up over the cuts that made the piece
fn back(node: u32, level: i32, q: vec3f) -> f32 {
  let a = pcg(node ^ 0x9e3779b9u);
  let b = pcg(a);
  let c = pcg(b);
  let tip = vec3f(f32(a), f32(b), f32(c)) * (1.0 / 4294967296.0) - 0.5;
  return max(P.edge.y * h1(node) + P.edge.z * dot(tip, q), 0.0) * pow(0.78, f32(level));
}

struct Walk {
  d: f32, // to the piece this point is in; huge if that piece has fallen
  bound: f32, // to the nearest other piece, at least
  over: vec3f, // the point just across the nearest crack
  near: u32, // that crack's node
  edge: f32, // how much nearer the nearest face is than the next: 0 on an edge
  exit: f32, // how far along the ray this piece's cell goes on
  skin: f32, // to the piece's outer face
  crack: f32, // to the nearest crack's wall
  loose: f32, // 0 where that crack is shut tight, 1 where it is open
};
// skip: a crack to leave out of `bound` (the one just crossed, when asking from its other side)
fn walk(q: vec3f, rq: vec3f, hull: f32, skip: u32) -> Walk {
  var w: Walk;
  w.bound = 1e9;
  w.exit = 1e9;
  w.over = q;
  w.near = 0xffffffffu;
  let age = P.crack.x;
  var node = 0u;
  var crack = -1e9;
  var rec = 0.0;
  var solid = true;
  var c1 = -1e9; // the nearest crack wall, and the next
  var c2 = -1e9;
  // a crack is weathered wide at the rock's skin and stays tight within
  let deep = 0.22 + 0.78 * exp(min(hull, 0.0) / 0.1);
  for (var i = 0; i < LEVELS; i++) {
    let nd = nodes[node];
    if (age > nd.info.z) {
      solid = false;
      break;
    }
    if (nd.info.w < 0.5) {
      break;
    }
    let travel = dot(nd.grow.xyz, q) + nd.grow.w;
    let tl = age - nd.info.y - travel; // how long the crack has been here
    if (tl <= 0.0) {
      break;
    }
    let s = dot(nd.plane.xyz, q) - nd.plane.w;
    let open = smoothstep(0.0, 1.0, (tl - travel * P.crack.w) / P.crack.z);
    let gap = nd.info.x * P.crack.y * open * deep;
    let fresh = min(tl * 30.0, 1.0);
    let e = gap - abs(s);
    crack = smax(crack, e, P.edge.x * (0.3 + 0.7 * open) * fresh);
    if (e > c1) {
      c2 = c1;
      c1 = e;
      w.loose = clamp(gap / (0.25 * P.shape.z + 1e-6), 0.0, 1.0);
    } else {
      c2 = max(c2, e);
    }
    let toward = dot(nd.plane.xyz, rq);
    if (s * toward < 0.0) {
      w.exit = min(w.exit, (abs(s) + OVER) / max(abs(toward), 1e-6));
    }
    let b = abs(s) + gap;
    if (b < w.bound && node != skip) {
      w.bound = b;
      w.over = q - nd.plane.xyz * (select(-1.0, 1.0, s > 0.0) * (b + 0.002));
      w.near = node;
    }
    node = node * 2u + 1u + u32(s > 0.0);
    rec += back(node, i, q) * open;
  }
  let skin = hull + rec;
  w.skin = skin;
  w.crack = crack;
  w.edge = max(c1, skin) - max(min(c1, skin), c2);
  if (solid) {
    w.d = smax(skin, crack, P.edge.x);
  } else {
    w.d = 1e9;
  }
  return w;
}

// The faces are rough, more so near an edge. A crack's wall is only ever worn back from the cut, never out
// past it (the cell beyond would clip it flat), and the walls of a tight crack still fit each other.
fn worn(w: Walk, q: vec3f) -> f32 {
  if (w.d > 0.04) {
    return w.d;
  }
  let k = exp(-w.edge / 0.02);
  let n1 = noise(q * P.shape.w);
  let nz = (n1 - 0.5) * 2.0 + (noise(q * P.shape.w * 3.1 + 5.0) - 0.5) * 0.7 + (noise(q * P.shape.w * 8.7 + 9.0) - 0.5) * 0.3;
  let a = P.shape.z * (1.0 + k);
  // the beds the rock was laid down in, standing out as low ledges
  let h = (q.y + 0.05 * n1) * 16.0;
  let ledge = P.wear.y * (floor(h) + smoothstep(0.0, 0.35, fract(h)) - h);
  return smax(w.skin + a * nz + ledge, w.crack + a * max(nz + 0.8, 0.0) * w.loose, P.edge.x);
}

// x: the distance to the rock; y: a step along the ray rd that is safe to take.
// With `far`, x also knows of the piece across the nearest crack, which the shade in hollows needs.
fn rock(p: vec3f, rd: vec3f, far: bool) -> vec2f {
  let q = bend(p);
  let hull = sdBox(q, P.hull.xyz, P.hull.w);
  if (hull > MARGIN) {
    return vec2f(hull);
  }
  let rq = (bend(p + rd * 0.01) - q) * 100.0; // the ray, as it runs in the bent rock
  let w = walk(q, rq, hull, 0xffffffffu);
  var d = worn(w, q);
  // to the cell's wall and just through it; a long step stops short, the bend making it less sure
  let reach = min(w.exit, max(w.exit * 0.8, 0.02));
  let stride = max(min(d, reach), hull);
  if (far) {
    if (w.bound < min(d, 0.3)) {
      let w2 = walk(w.over, vec3f(0.0), sdBox(w.over, P.hull.xyz, P.hull.w), w.near);
      d = min(d, w.bound + max(min(worn(w2, w.over), w2.bound), 0.0));
    }
  } else if (d > 1e8) {
    // Where a piece has fallen there is nothing to hit, only the walls of its cell to come to: kept a little
    // off zero, or a ray landing on a wall between two empty cells would take it for rock.
    d = w.bound + 0.003;
  }
  d = max(d, hull);
  return mix(vec2f(d, stride), vec2f(hull), smoothstep(MARGIN * 0.4, MARGIN, hull));
}

fn groundHeight(x: vec2f) -> f32 {
  let r = length(x / (P.hull.xz + 0.3));
  let mound = P.misc.y * (1.0 - smoothstep(0.2, 1.7, r));
  return mound + 0.012 * sin(x.x * 2.1 + 1.0) * sin(x.y * 1.7 + 2.0) + 0.004 * sin(x.x * 9.0 + x.y * 4.0);
}

// x: distance, y: a safe step, z: 1 for rock, 0 for ground
fn map(p: vec3f, rd: vec3f, far: bool) -> vec3f {
  let r = rock(p, rd, far);
  let g = (p.y - groundHeight(p.xz)) * 0.9;
  // above the ground's highest point, a ray can go straight down to that height
  let top = P.misc.y + 0.02;
  var gs = g;
  if (p.y > top) {
    gs = max(g, (p.y - top) / max(-rd.y, 0.02));
  }
  if (g < r.x) {
    return vec3f(g, min(gs, r.y), 0.0);
  }
  return vec3f(r.x, min(gs, r.y), 1.0);
}

fn normal(p: vec3f, h: f32) -> vec3f {
  let e = vec2f(1.0, -1.0) * h;
  return normalize(
    e.xyy * map(p + e.xyy, vec3f(0.0), false).x +
      e.yyx * map(p + e.yyx, vec3f(0.0), false).x +
      e.yxy * map(p + e.yxy, vec3f(0.0), false).x +
      e.xxx * map(p + e.xxx, vec3f(0.0), false).x,
  );
}

// Is the sun seen from here: yes or no. Each frame of a still asks toward a different point of the sun's
// disc, so the edge of a shadow softens as the still gathers, as wide as the thing casting it is far.
fn shadow(ro: vec3f, rd: vec3f) -> f32 {
  var t = 0.006;
  for (var i = 0; i < 96; i++) {
    let m = map(ro + rd * t, rd, false);
    if (m.x < 0.0003) {
      return 0.0;
    }
    t += max(m.y, 0.002);
    if (t > 8.0) {
      break;
    }
  }
  return 1.0;
}

fn hollow(p: vec3f, n: vec3f) -> f32 {
  var occ = 0.0;
  var sca = 1.0;
  for (var i = 0; i < 4; i++) {
    let h = 0.008 + 0.14 * f32(i * i) / 9.0;
    let d = map(p + n * h, vec3f(0.0), true).x;
    occ += max(h - d, 0.0) / h * sca;
    sca *= 0.72;
  }
  return clamp(1.0 - 0.55 * occ * P.look.y, 0.0, 1.0);
}

struct Detail {
  tint: f32, // each piece a little lighter or darker than its neighbours
  line: f32, // a crack too thin to see as a gap, drawn as a line
  skin: f32, // 1 on the box's old outer skin, 0 on the wall of a crack
};
fn detail(q: vec3f, n: vec3f, lw: f32) -> Detail {
  var o: Detail;
  let age = P.crack.x;
  let hull = sdBox(q, P.hull.xyz, P.hull.w);
  var node = 0u;
  var best = -1e9;
  var rec = 0.0;
  let deep = 0.22 + 0.78 * exp(min(hull, 0.0) / 0.1);
  for (var i = 0; i < LEVELS; i++) {
    let nd = nodes[node];
    if (age > nd.info.z || nd.info.w < 0.5) {
      break;
    }
    let travel = dot(nd.grow.xyz, q) + nd.grow.w;
    let tl = age - nd.info.y - travel;
    if (tl <= 0.0) {
      break;
    }
    let s = dot(nd.plane.xyz, q) - nd.plane.w;
    let open = smoothstep(0.0, 1.0, (tl - travel * P.crack.w) / P.crack.z);
    let gap = nd.info.x * P.crack.y * open * deep;
    let fresh = min(tl * 30.0, 1.0);
    let e = gap - abs(s);
    best = max(best, e);
    let across = 1.0 - abs(dot(n, nd.plane.xyz));
    let thin = 1.0 - smoothstep(0.5 * lw, 2.0 * lw, gap);
    o.line = max(o.line, fresh * thin * smoothstep(0.0, 0.5, across) * (1.0 - smoothstep(lw * 0.3, lw, -e)));
    node = node * 2u + 1u + u32(s > 0.0);
    o.tint += (h1(node ^ 0x5bd1e995u) - 0.5) * open;
    rec += back(node, i, q) * open;
  }
  o.skin = step(best, hull + rec);
  return o;
}

fn sky(rd: vec3f) -> vec3f {
  let h = max(rd.y, 0.0);
  return mix(vec3f(0.84, 0.74, 0.62), vec3f(0.36, 0.52, 0.78), pow(h, 0.45)) * 1.15;
}

@fragment
fn frag(@builtin(position) at: vec4f) -> @location(0) vec4f {
  let f = P.size.z;
  let jit = fract(vec2f(0.5) + f * vec2f(0.7548776662, 0.5698402910)) - 0.5;
  let uv = (at.xy + jit) / P.size.xy * 2.0 - 1.0;
  let ro = P.eye.xyz;
  let rd = normalize(P.fore.xyz + P.right.xyz * (uv.x * P.right.w) - P.up.xyz * (uv.y * P.up.w));
  let pix = 2.0 * P.up.w / P.size.y; // a pixel's width at distance 1

  var t = 0.02;
  var m = vec3f(0.0);
  var hit = false;
  var steps = 0.0;
  for (var i = 0; i < 256; i++) {
    m = map(ro + rd * t, rd, false);
    steps += 1.0;
    if (m.x < pix * t * 0.5) {
      hit = true;
      break;
    }
    t += max(m.y * 0.92, pix * t * 0.25);
    if (t > FAR) {
      break;
    }
  }
  let horizon = sky(vec3f(rd.x, 0.0, rd.z));
  var col = sky(rd);
  // a ray that ran out of steps: in a narrow crack it has seen only dark; in the open it is let go
  if (!hit && m.x > 0.01) {
    t = FAR;
  }
  if (t < FAR) {
    let p = ro + rd * t;
    let sunDir = P.sun.xyz;
    var n = normal(p, max(pix * t * 0.75, 0.0005));
    var alb: vec3f;
    if (m.z > 0.5) {
      let q = bend(p);
      let dt = detail(q, n, max(pix * t * 1.3, 0.0013));
      let big = fbm(q * 1.6 + 3.1, 4);
      let mid = fbm(q * 6.0 + 1.7, 4);
      let fine = fbm(q * 38.0, 3);
      alb = mix(vec3f(0.22, 0.15, 0.105), vec3f(0.37, 0.265, 0.19), smoothstep(0.3, 0.7, mid));
      alb = mix(alb, vec3f(0.40, 0.235, 0.16), smoothstep(0.5, 0.8, big) * 0.45);
      // grey-brown varnish in blotches, most on the old skin; and dark specks
      let blotch = fbm(q * 3.1 + 9.0, 5);
      let varnish = smoothstep(0.44, 0.62, blotch) * P.look.z * mix(0.55, 1.0, dt.skin);
      alb = mix(alb, vec3f(0.085, 0.075, 0.07), varnish * 0.75);
      alb *= 1.0 - 0.45 * smoothstep(0.62, 0.75, fbm(q * 55.0 + 4.0, 3));
      alb = mix(alb, alb * 1.18 + 0.015, 1.0 - dt.skin);
      alb *= (0.82 + 0.36 * fine) * (1.0 + dt.tint * 0.22);
      alb = mix(alb, vec3f(0.42, 0.31, 0.21), smoothstep(0.55, 0.95, n.y) * P.look.w);
      alb *= 1.0 - dt.line * P.edge.w;
      // (turned, so the grain's lattice does not line up with the faces)
      let qr = vec3f(0.36 * q.x + 0.48 * q.y - 0.8 * q.z, -0.8 * q.x + 0.6 * q.y, 0.48 * q.x + 0.64 * q.y + 0.6 * q.z);
      let g = vec3f(fbm(qr * 70.0, 2), fbm(qr * 70.0 + 7.7, 2), fbm(qr * 70.0 + 13.3, 2)) - 0.37;
      let g2 = vec3f(noise(qr * 21.0 + 3.0), noise(qr * 21.0 + 11.0), noise(qr * 21.0 + 19.0)) - 0.5;
      n = normalize(n + P.misc.z * (g + g2 * 0.8));
    } else {
      let s = fbm(vec3f(p.xz * 3.0, 0.0), 4);
      let grit = noise(vec3f(p.xz * 140.0, 1.0));
      alb = mix(vec3f(0.33, 0.235, 0.16), vec3f(0.43, 0.32, 0.225), s) * (0.85 + 0.3 * grit);
      let g = vec3f(noise(vec3f(p.xz * 60.0, 2.0)), 0.5, noise(vec3f(p.xz * 60.0, 5.0))) - 0.5;
      n = normalize(n + 0.25 * g);
    }
    let ndl = max(dot(n, sunDir), 0.0);
    var sh = 0.0;
    if (ndl > 0.0) {
      let side = normalize(cross(sunDir, vec3f(0.0, 1.0, 0.0)));
      let a = 6.2831853 * fract(f * 0.7548776662);
      let r = P.wear.w * sqrt(fract(f * 0.5698402910 + 0.5));
      let to = normalize(sunDir + (side * cos(a) + cross(side, sunDir) * sin(a)) * select(r, 0.0, f < 0.5));
      sh = shadow(p + n * 0.003, to);
    }
    let occ = hollow(p, n);
    var lin = vec3f(1.0, 0.92, 0.80) * (P.sun.w * ndl * sh);
    lin += vec3f(0.50, 0.62, 0.85) * (P.look.x * (0.5 + 0.5 * n.y) * occ);
    lin += vec3f(0.55, 0.40, 0.28) * (P.look.x * 0.7 * (0.5 - 0.5 * n.y) * occ);
    lin += vec3f(1.0, 0.85, 0.7) * (0.07 * P.sun.w * occ * max(dot(n, normalize(vec3f(-sunDir.x, 0.25, -sunDir.z))), 0.0));
    col = alb * lin;
    if (!hit) {
      col = vec3f(0.010, 0.008, 0.006); // lost in the depth of a crack
    }
    col = mix(col, horizon, 1.0 - exp(-t * P.misc.w));
  }
  if (P.wear.z > 0.5) {
    col = mix(vec3f(0.0, 0.0, 0.3), vec3f(1.0, 0.9, 0.0), steps / 256.0); // how many steps the ray took
    if (steps > 255.5) {
      col = vec3f(1.0, 0.0, 0.0);
    }
  }
  return vec4f(max(col, vec3f(0.0)), 1.0);
}
