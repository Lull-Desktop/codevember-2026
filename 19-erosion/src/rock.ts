// The rock as a tree of cuts (after Domokos, Jerolmack, Kun, Török 2020, "Plato's cube"): a box is cut by a
// plane, each piece is cut again, and so on. A cut ends at the walls of the piece it divides, so later cracks
// stop at earlier ones, as joints in rock do. The planes come from a few families of directions.
//
// The tree is kept as a heap (the children of node i are 2i+1 on the plane's negative side and 2i+2 on its
// positive side), three vec4 to a node, for the shader to walk:
//   plane: its normal, and its distance along it (in the box's own frame, origin at the box's middle)
//   info:  its half width when fully open; the age it starts at; the age its piece falls away; 1 if it is cut
//   grow:  the delay with which the crack reaches a point p is dot(grow.xyz, p) + grow.w

export type V3 = [number, number, number];
type Cell = V3[][]; // a convex piece, as its faces

export type RockOpts = {
  seed: number;
  depth: number; // most cuts above any piece
  half: V3; // half the box
  minSize: number; // pieces smaller than this are left whole
  split: number; // chance a piece is cut at all, past the first few
  scatter: number; // how far a cut strays from its family's direction
  bed: number; // how often the cuts are level (bedding), against upright
  diag: number; // and how often they slant
  fall: number; // chance an outer piece falls away
  pace: number; // stretches the whole history
};

export const rockDefaults: RockOpts = {
  seed: 7,
  depth: 10,
  half: [0.55, 1.15, 0.45],
  minSize: 0.07,
  split: 0.88,
  scatter: 0.13,
  bed: 0.9,
  diag: 0.35,
  fall: 0.45,
  pace: 1,
};

export const NODE_FLOATS = 12;

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const unit = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

function mulberry(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function box(h: V3): Cell {
  const v = (x: number, y: number, z: number): V3 => [
    x * h[0],
    y * h[1],
    z * h[2],
  ];
  const faces: Cell = [];
  for (let a = 0; a < 3; a++)
    for (const s of [-1, 1]) {
      const q: V3[] = [];
      for (const [i, j] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ]) {
        const c = [0, 0, 0];
        c[a] = s;
        c[(a + 1) % 3] = i;
        c[(a + 2) % 3] = j;
        q.push(v(c[0], c[1], c[2]));
      }
      faces.push(q);
    }
  return faces;
}

// the piece on each side of the plane dot(n, p) = c
function cut(cell: Cell, n: V3, c: number): [Cell, Cell] {
  const neg: Cell = [];
  const pos: Cell = [];
  const rim: V3[] = [];
  for (const f of cell) {
    const a: V3[] = [];
    const b: V3[] = [];
    for (let i = 0; i < f.length; i++) {
      const p = f[i];
      const q = f[(i + 1) % f.length];
      const sp = dot(n, p) - c;
      const sq = dot(n, q) - c;
      if (sp <= 0) a.push(p);
      if (sp >= 0) b.push(p);
      if (sp === 0) rim.push(p);
      if ((sp < 0 && sq > 0) || (sp > 0 && sq < 0)) {
        const t = sp / (sp - sq);
        const x: V3 = [
          p[0] + (q[0] - p[0]) * t,
          p[1] + (q[1] - p[1]) * t,
          p[2] + (q[2] - p[2]) * t,
        ];
        a.push(x);
        b.push(x);
        rim.push(x);
      }
    }
    if (a.length >= 3) neg.push(a);
    if (b.length >= 3) pos.push(b);
  }
  if (rim.length >= 3) {
    // the new face: the rim's points in order around their middle
    const m: V3 = [0, 0, 0];
    for (const p of rim) for (let k = 0; k < 3; k++) m[k] += p[k] / rim.length;
    const u = unit(cross(n, Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
    const w = cross(n, u);
    const ring = rim
      .map((p) => {
        const d = sub(p, m);
        return { p, a: Math.atan2(dot(d, w), dot(d, u)) };
      })
      .sort((x, y) => x.a - y.a)
      .filter((x, i, all) => i === 0 || x.a - all[i - 1].a > 1e-7)
      .map((x) => x.p);
    if (ring.length >= 3) {
      neg.push(ring);
      pos.push(ring);
    }
  }
  return [neg, pos];
}

function measure(cell: Cell) {
  const mid: V3 = [0, 0, 0];
  let count = 0;
  for (const f of cell)
    for (const p of f) {
      for (let k = 0; k < 3; k++) mid[k] += p[k];
      count++;
    }
  for (let k = 0; k < 3; k++) mid[k] /= count || 1;
  let volume = 0;
  for (const f of cell) {
    const area: V3 = [0, 0, 0];
    const fm: V3 = [0, 0, 0];
    for (let i = 0; i < f.length; i++) {
      for (let k = 0; k < 3; k++) fm[k] += f[i][k] / f.length;
      if (i > 0 && i < f.length - 1) {
        const x = cross(sub(f[i], f[0]), sub(f[i + 1], f[0]));
        for (let k = 0; k < 3; k++) area[k] += x[k] / 2;
      }
    }
    volume += Math.abs(dot(area, sub(fm, mid))) / 3;
  }
  return { mid, volume };
}

// how much of the ball around it a piece fills: about 1.5 for a cube, little for a sliver
function chunky(cell: Cell) {
  const { mid, volume } = measure(cell);
  let r = 0;
  for (const f of cell)
    for (const p of f) {
      const d = sub(p, mid);
      r = Math.max(r, Math.hypot(d[0], d[1], d[2]));
    }
  return volume / (r * r * r || 1);
}

function span(cell: Cell, n: V3): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const f of cell)
    for (const p of f) {
      const d = dot(n, p);
      if (d < lo) lo = d;
      if (d > hi) hi = d;
    }
  return [lo, hi];
}

export type Rock = {
  data: Float32Array;
  nodes: number; // slots in the heap
  cuts: number;
  pieces: number;
  fallen: number;
  last: number; // the age of the last crack
};

export function buildRock(o: RockOpts): Rock {
  const rnd = mulberry(o.seed * 7919 + 13);
  const gauss = () =>
    Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
  const depth = Math.max(1, Math.min(11, Math.round(o.depth)));
  const nodes = 2 ** (depth + 1) - 1;
  const data = new Float32Array(nodes * NODE_FLOATS);
  for (let i = 0; i < nodes; i++) data[i * NODE_FLOATS + 6] = 1e9;
  const H = o.half;
  const whole = measure(box(H)).volume ** (1 / 3);
  const stats = { cuts: 0, pieces: 0, fallen: 0, last: 0 };

  const families: { n: V3; s: number; w: number }[] = [
    { n: [1, 0, 0], s: 1, w: 1.25 },
    { n: [0, 0, 1], s: 1, w: 1.25 },
    { n: [0, 1, 0], s: 0.6, w: o.bed },
    { n: unit([0.75, 0.62, 0.25]), s: 1, w: o.diag },
  ];
  // which way the slanting cuts lean is one choice for the whole rock, as it is in a real one
  if (rnd() < 0.5) families[3].n[0] *= -1;
  if (rnd() < 0.5) families[3].n[2] *= -1;

  const outer = (cell: Cell) => {
    const e = 1e-5;
    let sides = 0;
    let top = false;
    let foot = false;
    const seen = [false, false, false, false];
    for (const f of cell)
      for (const p of f) {
        if (p[0] > H[0] - e) seen[0] = true;
        if (p[0] < -H[0] + e) seen[1] = true;
        if (p[2] > H[2] - e) seen[2] = true;
        if (p[2] < -H[2] + e) seen[3] = true;
        if (p[1] > H[1] - e) top = true;
        if (p[1] < -H[1] + e) foot = true;
      }
    for (const s of seen) if (s) sides++;
    return { sides, top, foot };
  };

  const pieces: { i: number; cell: Cell; t0: number; mid: V3 }[] = [];
  const since = new Float64Array(nodes); // the age each node is a piece by itself from
  const loose = new Float64Array(nodes).fill(Infinity); // the age it comes loose, if it does
  const chance = mulberry(o.seed * 104729 + 71); // apart from the cutting's, so `fall` leaves the cuts alone

  // i: the node; t0: the age by which every crack around this piece has run its length
  const grow = (i: number, cell: Cell, level: number, t0: number) => {
    const at = i * NODE_FLOATS;
    since[i] = t0;
    const { mid, volume } = measure(cell);
    const size = volume ** (1 / 3);

    // an outer block, of any size, may come loose of itself: more often high up and at a corner
    if (level >= 2 && size < 0.5 * whole) {
      const where = outer(cell);
      if (where.sides > 0 || where.top) {
        let p = o.fall * 0.2 * (0.3 + 0.7 * (mid[1] / H[1] / 2 + 0.5));
        if (where.top) p *= 1.5;
        if (where.sides > 1) p *= 1.5;
        if (where.foot) p *= 0.2;
        if (chance() < p) loose[i] = t0 + 0.06 + 0.5 * chance();
      }
    }

    const whole3 = level < 3;
    if (level >= depth || size < o.minSize || (!whole3 && rnd() > o.split)) {
      pieces.push({ i, cell, t0, mid });
      return;
    }

    // a cut: the family is chosen mostly by how long the piece is along it, which keeps the pieces boxy
    let best: { n: V3; c: number } | null = null;
    for (let tries = 0; tries < 6 && !best; tries++) {
      const cands = families.map((f) => {
        const n = unit([
          f.n[0] + o.scatter * f.s * gauss(),
          f.n[1] + o.scatter * f.s * gauss(),
          f.n[2] + o.scatter * f.s * gauss(),
        ]);
        const [lo, hi] = span(cell, n);
        return { n, lo, hi, w: f.w * (hi - lo) ** 3 };
      });
      let pick = rnd() * cands.reduce((s, c) => s + c.w, 0);
      let c = cands[0];
      for (const k of cands) {
        c = k;
        pick -= k.w;
        if (pick <= 0) break;
      }
      const where = c.lo + (c.hi - c.lo) * (0.5 + (rnd() - 0.5) * 0.56);
      const [a, b] = cut(cell, c.n, where);
      if (a.length < 4 || b.length < 4) continue;
      const va = measure(a).volume;
      const vb = measure(b).volume;
      if (Math.min(va, vb) < 0.12 * volume) continue;
      // no slivers: a thin wedge would stand out as a needle once its neighbours are gone
      if (Math.min(chunky(a), chunky(b)) < 0.3) continue;
      best = { n: c.n, c: where };
    }
    if (!best) {
      pieces.push({ i, cell, t0, mid });
      return;
    }
    const { n, c } = best;

    // the crack starts at one edge of the piece, more often an upper one, and runs across it
    const lean: V3 = [gauss(), gauss() - 1.1, gauss()];
    const k = dot(lean, n);
    const dir = unit([
      lean[0] - k * n[0],
      lean[1] - k * n[1],
      lean[2] - k * n[2],
    ]);
    const [lo, hi] = span(cell, dir);
    const slow = 0.04; // age per unit length
    const wait = -Math.log(1 - rnd()) * 0.05 * (whole / size) ** 0.6;
    const birth = t0 + wait;
    const done = birth + slow * (hi - lo);

    data[at] = n[0];
    data[at + 1] = n[1];
    data[at + 2] = n[2];
    data[at + 3] = c;
    // the first cracks are the widest; a level one is pressed shut by the weight on it
    data[at + 4] =
      0.011 *
      (0.35 + 1.3 * rnd() ** 2) *
      0.86 ** level *
      (1 - 0.6 * n[1] * n[1]);
    data[at + 5] = birth;
    data[at + 7] = 1;
    data[at + 8] = dir[0] * slow;
    data[at + 9] = dir[1] * slow;
    data[at + 10] = dir[2] * slow;
    data[at + 11] = -lo * slow;
    stats.cuts++;
    stats.last = Math.max(stats.last, birth);

    const [a, b] = cut(cell, n, c);
    grow(2 * i + 1, a, level + 1, done);
    grow(2 * i + 2, b, level + 1, done);
  };
  grow(0, box(H), 0, 0);
  stats.pieces = pieces.length;

  // Which pieces fall away, and when. Some outer pieces go by themselves; then whatever stood on a piece that
  // went goes after it, once its own cracks are through (until then it is held by the rock it is still part of).
  const pieceAt = (p: V3) => {
    let i = 0;
    while (data[i * NODE_FLOATS + 7] > 0.5) {
      const at = i * NODE_FLOATS;
      const s = data[at] * p[0] + data[at + 1] * p[1] + data[at + 2] * p[2];
      i = 2 * i + 1 + (s > data[at + 3] ? 1 : 0);
    }
    return i;
  };
  // what each piece stands on: the piece straight under its middle (-1 for the ground)
  const under = pieces.map((pc) => {
    let floor = -Infinity;
    for (const f of pc.cell) {
      const fm: V3 = [0, 0, 0];
      const n: V3 = [0, 0, 0];
      for (let j = 0; j < f.length; j++) {
        for (let k = 0; k < 3; k++) fm[k] += f[j][k] / f.length;
        if (j > 0 && j < f.length - 1) {
          const x = cross(sub(f[j], f[0]), sub(f[j + 1], f[0]));
          for (let k = 0; k < 3; k++) n[k] += x[k];
        }
      }
      if (dot(n, sub(fm, pc.mid)) < 0) for (let k = 0; k < 3; k++) n[k] *= -1;
      if (n[1] > -1e-9) continue;
      const y = (dot(n, fm) - n[0] * pc.mid[0] - n[2] * pc.mid[2]) / n[1];
      if (y <= pc.mid[1] && y > floor) floor = y;
    }
    if (floor - 0.006 < -H[1]) return -1;
    return pieceAt([pc.mid[0], floor - 0.006, pc.mid[2]]);
  });
  // want: the age a piece loses its hold. It goes then if it is a piece by then; if it is still part of a
  // larger uncut block, that block goes whole once all of it has lost its hold, and otherwise holds it.
  const want = new Float64Array(nodes).fill(Infinity);
  const lag = pieces.map(() => 0.015 + 0.05 * chance());
  for (const pc of pieces) {
    // a piece goes with the first of the blocks it is in to come loose
    for (let j = pc.i; ; j = (j - 1) >> 1) {
      want[pc.i] = Math.min(want[pc.i], loose[j]);
      if (j === 0) break;
    }
  }
  const gone = new Float64Array(nodes).fill(Infinity); // the age each node is empty from
  const settle = (i: number): number => {
    if (data[i * NODE_FLOATS + 7] > 0.5)
      want[i] = Math.max(settle(2 * i + 1), settle(2 * i + 2));
    gone[i] = Math.max(want[i], since[i]);
    return want[i];
  };
  const emptyFrom = (i: number) => {
    let t = gone[i];
    for (let j = i; j > 0; ) {
      j = (j - 1) >> 1;
      t = Math.min(t, gone[j]);
    }
    return t;
  };
  for (let pass = 0, moved = true; moved && pass < 400; pass++) {
    moved = false;
    settle(0);
    pieces.forEach((pc, j) => {
      if (under[j] < 0 || under[j] === pc.i) return;
      const when = emptyFrom(under[j]) + lag[j];
      if (when < want[pc.i] - 1e-9) {
        want[pc.i] = when;
        moved = true;
      }
    });
  }
  settle(0);
  for (let i = 0; i < nodes; i++)
    if (gone[i] < Infinity) data[i * NODE_FLOATS + 6] = gone[i];
  stats.fallen = pieces.filter((pc) => emptyFrom(pc.i) < Infinity).length;

  // the history is stretched so that most cracks (85 in 100) are there by age 1, whatever the cutting was
  const births: number[] = [];
  for (let i = 0; i < nodes; i++)
    if (data[i * NODE_FLOATS + 7] > 0.5) births.push(data[i * NODE_FLOATS + 5]);
  births.sort((x, y) => x - y);
  const k = o.pace / (births[Math.floor((births.length - 1) * 0.85)] || 1);
  for (let i = 0; i < nodes; i++) {
    const at = i * NODE_FLOATS;
    data[at + 5] *= k;
    if (data[at + 6] < 1e8) data[at + 6] *= k;
    for (let j = 8; j < 12; j++) data[at + j] *= k;
  }
  stats.last *= k;
  return { data, nodes, ...stats };
}
