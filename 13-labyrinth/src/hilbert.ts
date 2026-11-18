// A try-out: every wall on one Hilbert curve, and all of them travelling along it.
//
// The curve runs through the posts of the grid. A Hilbert curve of 32 x 32 posts starts in one bottom corner
// and ends in the other, so three of them side by side join end to start, and the last joins the first round
// the back: one closed curve through every post there is (96 x 32). Each step of the curve is a slot.
//
// Along the curve lies a pattern of walls and gaps that repeats every 32 slots. The pattern travels: a whole
// number of periods every loop, so the loop closes. A wall that reaches a corner goes round it.
//
// (Nothing here knows about the walker: he goes through walls.)

export type HilbertOptions = {
  seed: number;
  flow: number; // periods of the pattern that pass a point in one loop (negative: the other way)
  pulse: number; // 0: steady. 1: a slot at a time, with a rest between
  wall: [number, number]; // length of a stretch of wall, least and most, in slots
  gap: [number, number]; // and of a gap (never under 1.5: see GAP)
};
export const hilbertDefaults: HilbertOptions = { seed: 13, flow: 1, pulse: 0, wall: [2, 7], gap: [1.5, 3] };

const ORDER = 32;
const BLOCKS = 3;
const PERIOD = 32;
const SAMPLES = 640;
// The sheet holds one filled stretch per slot, and is read between its samples. So a slot must be seen empty for
// a while between one wall leaving it and the next coming in: a gap of exactly one slot leaves no such moment,
// and the in-between frames drew a sliver of wall flying across the slot.
const GAP = 1.5;

const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// the d-th post of a Hilbert curve on n x n posts
const post = (n: number, d: number) => {
  let x = 0;
  let y = 0;
  for (let s = 1, t = d; s < n; s *= 2, t = Math.floor(t / 4)) {
    const rx = 1 & (t >> 1);
    const ry = 1 & (t ^ rx);
    if (ry === 0) {
      if (rx === 1) ((x = s - 1 - x), (y = s - 1 - y));
      [x, y] = [y, x];
    }
    x += s * rx;
    y += s * ry;
  }
  return [x, y];
};

export function createHilbert(options: Partial<HilbertOptions> = {}) {
  const o = { ...hilbertDefaults, ...options };
  const W = ORDER * BLOCKS;
  const H = ORDER;
  const cells = W * H;
  const length = cells; // slots on the curve
  const rand = rng(o.seed);

  // which slot each step of the curve is: the cell that owns it, its kind, and whether the curve runs it backwards
  const slots = new Int32Array(length * 3);
  const at = (d: number) => {
    const b = Math.floor(d / (ORDER * ORDER)) % BLOCKS;
    const [x, y] = post(ORDER, d % (ORDER * ORDER));
    return [b * ORDER + x, y];
  };
  for (let d = 0; d < length; d++) {
    const [x0, y0] = at(d);
    const [x1, y1] = at((d + 1) % length);
    const dx = (((x1 - x0 + W) % W) + 1) % W - 1; // -1, 0 or 1, round the back as well
    const dy = y1 - y0;
    if (Math.abs(dx) + Math.abs(dy) !== 1) throw new Error(`hilbert: step ${d} is not one slot`);
    const kind = dx !== 0 ? 0 : 1;
    const back = dx < 0 || dy < 0 ? 1 : 0;
    const i = dx < 0 ? x1 : x0;
    const j = dy < 0 ? y1 : y0;
    slots.set([j * W + i, kind, back], d * 3);
  }
  // for the vertex shader: per slot, its place on the curve in 12 bits, one bit for "on the curve", one for "backwards"
  const home = new Uint8Array(cells * 4);
  for (let d = 0; d < length; d++) {
    const a = slots[d * 3] * 4 + slots[d * 3 + 1] * 2;
    home[a] = d & 255;
    home[a + 1] = (d >> 8) | 64 | (slots[d * 3 + 2] << 7);
  }

  // the pattern: stretches of wall along one period, in half slots (so that walls enter slots on a sample)
  const walls: [number, number][] = [];
  const pick = ([lo, hi]: [number, number]) => Math.round((lo + rand() * (hi - lo)) * 2) / 2;
  for (let c = 0; ; ) {
    const len = pick(o.wall);
    const gap = Math.max(GAP, pick(o.gap));
    if (c + len + gap > PERIOD - o.wall[0] - 1) {
      walls.push([c, PERIOD - Math.max(GAP, pick(o.gap))]);
      break;
    }
    walls.push([c, c + len]);
    c += len + gap;
  }

  // how far the pattern has gone along the curve, in slots
  const turns = Math.round(o.flow);
  const shift = (playhead: number) => {
    const s = playhead * Math.abs(turns) * PERIOD;
    const whole = Math.floor(s);
    const f = s - whole;
    return Math.sign(turns) * (whole + f + o.pulse * (f * f * (3 - 2 * f) - f));
  };

  const sheet = new Uint8Array(cells * SAMPLES * 4);
  for (let m = 0; m < SAMPLES; m++) {
    const gone = shift(m / SAMPLES);
    for (let d = 0; d < length; d++) {
      // this slot, in the pattern's own measure
      const s0 = (((d - gone) % PERIOD) + PERIOD) % PERIOD;
      let u0 = 0;
      let u1 = 0;
      let some = false;
      let below = 99; // how far the nearest wall is before the slot, and after it
      let above = 99;
      for (const [a, b] of walls)
        for (let lap = -PERIOD; lap <= PERIOD; lap += PERIOD) {
          const lo = Math.max(a + lap, s0);
          const hi = Math.min(b + lap, s0 + 1);
          if (hi > lo + 1e-6) ((u0 = lo - s0), (u1 = hi - s0), (some = true));
          else if (b + lap <= s0 + 1e-6) below = Math.min(below, s0 - b - lap);
          else above = Math.min(above, a + lap - s0 - 1);
        }
      // an empty slot is written as nothing at the end where the nearest wall is: that is the end a wall has
      // just left by, or will come in at, so the moments between two samples never show a wall crossing it
      if (!some) u0 = u1 = above < below ? 1 : 0;
      if (slots[d * 3 + 2]) [u0, u1] = [1 - u1, 1 - u0];
      const p = (slots[d * 3] * SAMPLES + m) * 4 + slots[d * 3 + 1] * 2;
      sheet[p] = Math.round(255 * u0);
      sheet[p + 1] = Math.round(255 * u1);
    }
  }
  return { W, H, cells, col: W >> 1, samples: SAMPLES, sheet, home, shift, period: PERIOD, walls };
}
