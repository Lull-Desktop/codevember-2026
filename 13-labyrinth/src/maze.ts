// The labyrinth, for one whole loop.
//
// Cells are unit squares, W of them east–west and H along the walk; both directions wrap. Every cell owns two
// slots: its south edge (kind 0, on the line y = j, between x = i and i + 1) and its west edge (kind 1, on the
// line x = i, between y = j and j + 1). A slot either holds a wall or is a way through.
//
// The maze has a home state: a perfect maze (the ways through are a spanning tree, made from random weights).
// A wall is a door if one of its ends is free: no other wall meets it at that post, and the slot beyond the
// post, in line with it, is empty. Such a wall can slide along its own line, through the post, into that slot,
// and later slide home again. Sliding it opens its own slot and shuts the one it goes to, and the three ways
// through round that post are exactly the ring that this opens and shuts: the maze stays perfect.
//
// Two doors may be out at once only if neither's new place is on the other's ring. Then any set of doors that
// are out together leaves a perfect maze, whichever of them go home first, so nothing has to be checked in
// time order: an outing is an arc of the loop, and arcs are simply laid down wherever they do not clash.
// Every door is home between its outings, so the loop closes by itself.
//
// The walker goes north up one column, a cell every `perCell` ticks. At every row his way is crossed by a
// door whose home is either across his way (it slides aside just before he gets there, and back when he has
// gone) or beside it (it may come and stand in his way, and leaves just in time). His column wraps round the
// loop, so the ways through hold one ring, his: unrolled along the walk, as it is seen, it is a tree.

export type MazeOptions = {
  W: number;
  H: number;
  perCell: number; // ticks per cell walked
  seed: number;
  restless: number; // outings tried per door per loop
  drama: number; // 0..1: how often a wall stands across his way shortly before he gets there
  move: number; // ticks a door takes to slide one cell
  clear: number; // cells: the door in front is out of his way when he is still this far from it
  after: number; // cells: and starts back when he is this far past
  stay: [number, number]; // ticks a door stays out, least and most
  sub: number; // samples per tick in the baked sheet
};

export const mazeDefaults: MazeOptions = {
  W: 96,
  H: 32,
  perCell: 5,
  seed: 13,
  restless: 3,
  drama: 0.8,
  move: 5,
  clear: 0.3,
  after: 1.6,
  stay: [8, 40],
  sub: 4,
};

export type Outing = { wall: number; to: number; way: number; ring: number[]; from: number; back: number; late: number; his: boolean };

export type Maze = MazeOptions & {
  col: number; // the walker's column: he walks at x = col + 0.5
  ticks: number;
  cells: number;
  home: Uint8Array; // [cell * 2 + kind]: 255 where a wall has its home
  doors: number; // walls that can slide at all
  outings: Outing[];
  samples: number; // width of the sheet
  // what part of each slot is filled, 0..255 from its low end to its high end: [(cell * samples + sample) * 4 + kind * 2] = from, + 1 = to.
  // A row per cell, time across
  sheet: Uint8Array;
  filled: (i: number, j: number, kind: number, playhead: number) => [number, number]; // as the sheet has it, 0..1
  wall: (edge: number, tick: number) => boolean; // does the slot hold a wall (doors count where they are going)
};

const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const wrap = (a: number, n: number) => ((a % n) + n) % n;

export function createMaze(options: Partial<MazeOptions> = {}): Maze {
  const o = { ...mazeDefaults, ...options };
  const { W, H, perCell } = o;
  const cells = W * H;
  const edges = cells * 2;
  const ticks = H * perCell;
  const col = W >> 1;
  const rand = rng(o.seed);
  const edge = (i: number, j: number, kind: number) => 2 * (wrap(j, H) * W + wrap(i, W)) + kind;

  // ---- home
  const weight = new Float32Array(edges);
  for (let e = 0; e < edges; e++) weight[e] = rand();
  // his line. At row k the door's home is across his way (slot (col, k)) or beside it, on one side; the post
  // between the two slots is kept free, which takes the two ways through that run north and south from it.
  type Row = { across: boolean; side: number; door: number; beside: number };
  const rows: Row[] = [];
  for (let k = 0; k < H; k++) {
    const across = rand() < 0.5;
    const side = rand() < 0.5 ? -1 : 1;
    const mine = edge(col, k, 0);
    const beside = edge(col + side, k, 0);
    const post = side > 0 ? col + 1 : col;
    weight[across ? mine : beside] = 9;
    weight[across ? beside : mine] = -1;
    weight[edge(post, k, 1)] = -1;
    weight[edge(post, k - 1, 1)] = -1;
    rows.push({ across, side, door: across ? mine : beside, beside: across ? beside : mine });
  }
  // the spanning tree, lightest first; what his line asked for comes first, and the one way through it has
  // to refuse (his ring) is let in afterwards
  const way = new Uint8Array(edges); // 1: a way through at home
  const parent = new Int32Array(cells);
  for (let c = 0; c < cells; c++) parent[c] = c;
  const find = (a: number) => {
    while (parent[a] !== a) a = parent[a] = parent[parent[a]];
    return a;
  };
  const order = Array.from({ length: edges }, (_, e) => e).sort((a, b) => weight[a] - weight[b] || a - b);
  for (const e of order) {
    const c = e >> 1;
    const i = c % W;
    const j = (c - i) / W;
    const other = e & 1 ? j * W + wrap(i - 1, W) : wrap(j - 1, H) * W + i;
    const a = find(c);
    const b = find(other);
    if (a !== b) ((parent[a] = b), (way[e] = 1));
    else if (weight[e] < 0) way[e] = 1;
  }
  const home = new Uint8Array(edges);
  for (let e = 0; e < edges; e++) home[e] = way[e] ? 0 : 255;

  // ---- doors: a wall, the slot it can slide to, which way that is along its line, and the ring (that slot and
  // the two ways through that cross the post between)
  type Door = { wall: number; to: number; way: number; ring: number[] };
  const doors: Door[] = [];
  const movable = new Set<number>();
  for (let e = 0; e < edges; e++) {
    if (way[e]) continue;
    const c = e >> 1;
    const i = c % W;
    const j = (c - i) / W;
    for (const dir of [-1, 1]) {
      // the post at that end, and the three other slots that meet there
      let to: number, a: number, b: number;
      if (e & 1) {
        const pj = dir > 0 ? j + 1 : j;
        to = edge(i, j + dir, 1);
        a = edge(i, pj, 0);
        b = edge(i - 1, pj, 0);
      } else {
        const pi = dir > 0 ? i + 1 : i;
        to = edge(i + dir, j, 0);
        a = edge(pi, j, 1);
        b = edge(pi, j - 1, 1);
      }
      if (way[to] && way[a] && way[b]) (doors.push({ wall: e, to, way: dir, ring: [to, a, b] }), movable.add(e));
    }
  }

  // ---- outings, laid on the loop wherever they do not clash
  const away = new Uint8Array(edges * ticks); // this wall is out (or on its way)
  const kept = new Uint8Array(edges * ticks); // this way through is on the ring of a door that is out: no wall may come here
  const taken = new Uint8Array(edges * ticks); // a door has come to stand here
  const outings: Outing[] = [];
  const lay = (d: Door, from: number, back: number, late: number, his: boolean) => {
    // from: the tick it starts out; back: the tick it starts home. It is in the way until it is home again.
    const end = back + o.move + (late > 0 ? 1 : 0);
    if (end - from >= ticks) return false;
    for (let s = from; s < end; s++) {
      const t = wrap(s, ticks);
      if (away[d.wall * ticks + t] || kept[d.to * ticks + t]) return false;
      for (const g of d.ring) if (taken[g * ticks + t]) return false;
    }
    for (let s = from; s < end; s++) {
      const t = wrap(s, ticks);
      away[d.wall * ticks + t] = 1;
      taken[d.to * ticks + t] = 1;
      for (const g of d.ring) kept[g * ticks + t]++;
    }
    outings.push({ ...d, from, back, late, his });
    return true;
  };
  // his: the slot across his way at row k is empty from `opens` until `shuts`
  const opens = (k: number) => Math.floor(k * perCell - o.clear * perCell - o.move);
  const shuts = (k: number) => Math.ceil(k * perCell + o.after * perCell);
  rows.forEach((row, k) => {
    const mine = edge(col, k, 0);
    if (row.across) {
      const d = doors.find((d) => d.wall === mine && d.to === row.beside);
      if (!d || !lay(d, opens(k), shuts(k), 0, true)) throw new Error(`labyrinth: his door at row ${k} cannot open`);
    } else {
      for (let s = opens(k) + o.move; s < shuts(k) + 1; s++) kept[mine * ticks + wrap(s, ticks)]++;
    }
  });
  // a door from beside comes to stand in his way and leaves just in time
  rows.forEach((row, k) => {
    if (row.across || rand() >= o.drama) return;
    const d = doors.find((d) => d.wall === row.door && d.to === edge(col, k, 0));
    if (!d) return;
    const back = opens(k);
    for (let n = 0; n < 6; n++) if (lay(d, back - o.move - Math.round(o.stay[0] + rand() * (o.stay[1] - o.stay[0])), back, 0, true)) break;
  });
  // everyone else
  for (let n = Math.round(doors.length * o.restless); n > 0; n--) {
    const d = doors[Math.floor(rand() * doors.length)];
    const from = Math.floor(rand() * ticks);
    lay(d, from, from + o.move + Math.round(o.stay[0] + rand() * (o.stay[1] - o.stay[0])), 0.02 + 0.98 * rand(), false);
  }

  // ---- the sheet
  const samples = ticks * o.sub;
  const sheet = new Uint8Array(cells * samples * 4);
  for (let e = 0; e < edges; e++) if (!way[e]) for (let m = 0; m < samples; m++) sheet[((e >> 1) * samples + m) * 4 + (e & 1) * 2 + 1] = 255;
  const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
  for (const out of outings) {
    const a = out.from + out.late;
    const b = out.back + out.late;
    for (let m = Math.floor(a * o.sub); m <= Math.ceil((b + o.move) * o.sub); m++) {
      const t = m / o.sub;
      const x = Math.round(255 * Math.min(ease((t - a) / o.move), 1 - ease((t - b) / o.move)));
      const at = wrap(m, samples) * 4;
      const own = (out.wall >> 1) * samples * 4 + at + (out.wall & 1) * 2;
      const next = (out.to >> 1) * samples * 4 + at + (out.to & 1) * 2;
      if (out.way > 0) {
        // it leaves its own slot at the high end and enters the next at the low end
        sheet[own] = x;
        sheet[own + 1] = 255;
        sheet[next] = 0;
        sheet[next + 1] = x;
      } else {
        sheet[own] = 0;
        sheet[own + 1] = 255 - x;
        sheet[next] = 255 - x;
        sheet[next + 1] = 255;
      }
    }
  }

  const filled = (i: number, j: number, kind: number, playhead: number): [number, number] => {
    const x = wrap(playhead, 1) * samples;
    const m = Math.floor(x);
    const f = x - m;
    const row = (wrap(j, H) * W + wrap(i, W)) * samples;
    const a = (row + (m % samples)) * 4 + kind * 2;
    const b = (row + ((m + 1) % samples)) * 4 + kind * 2;
    return [(sheet[a] + (sheet[b] - sheet[a]) * f) / 255, (sheet[a + 1] + (sheet[b + 1] - sheet[a + 1]) * f) / 255];
  };
  const wall = (e: number, tick: number) => {
    const t = wrap(tick, ticks);
    if (taken[e * ticks + t]) return outings.some((out) => out.to === e && wrap(t - out.from, ticks) < out.back - out.from);
    if (way[e]) return false;
    return !outings.some((out) => out.wall === e && wrap(t - out.from, ticks) < out.back - out.from);
  };
  return { ...o, col, ticks, cells, home, doors: movable.size, outings, samples, sheet, filled, wall };
}
