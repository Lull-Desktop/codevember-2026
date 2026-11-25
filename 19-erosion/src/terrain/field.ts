// The river's history as a picture the shader can read. The river itself is the wandering line of
// meander.ts; here every cell of the valley floor keeps the time the river last ran over it (the trick
// of lab/sims/canyon.ts). The shader turns "how long ago" into height and colour: water where it is now, bare
// bars where it has just been, older and higher ground further back, and ghost channels in between.
import { makeMeander } from "./meander";

export const UNITS = 128; // the block is this many river units across (the water is about 3 wide)
export const CELLS = 512; // cells across the picture
export const OLD = 2400; // steps after which ground left by the river is back at the height of the valley floor
export const NEVER = 3 * OLD; // an age that stands for "the river was never here"
export const FRESH = 40; // steps in which ground the river has left comes up out of the water
export const AGE0 = 20; // ages are stored as log(1 + age / AGE0), fine near zero and coarse far back
export const SPAN = Math.log(1 + NEVER / AGE0);

// across the channel: a flat bed out to R0, the waterline at R1, the top of the cut bank at R2
const R0 = 1.0;
const R1 = 1.6;
const R2 = 2.9;
const LAKE = 800; // steps a cut-off loop takes to silt up
const DRY = 4 * FRESH; // how old the silted loop then counts as

const S = CELLS / UNITS;
const LUT = 1024;

type Lake = { cells: Int32Array; edge: Float32Array; born: number };

export function makeField(seed: number, reach: number, lag = 3.5) {
  const river = makeMeander(seed, {
    from: -70,
    to: UNITS + 70,
    mid: UNITS / 2,
    reach,
    lag,
  });
  const last = new Float32Array(CELLS * CELLS).fill(-1e9);
  const live = new Uint8Array(CELLS * CELLS);
  // Whether a cell's mark came from the channel's bed or from its bank. Ground the bed has passed over
  // carries the river's history, one line for each moment; a bank is only a slope, and the shader must not
  // draw scroll bars down it.
  const side = new Uint8Array(CELLS * CELLS).fill(255);
  const data = new Uint8Array(CELLS * CELLS * 4).fill(255); // (all 255 is "never", and bank)
  for (let o = 2; o < data.length; o += 4) data[o] = 0;
  let lakes: Lake[] = [];
  const rows = [CELLS, -1]; // the first and last row of cells the river has ever marked

  // By how much a cell at distance d from the channel's middle counts as older than the bed. It makes the
  // channel's cross-section: the bank comes up to the waterline at R1, and the old ground the river is eating
  // into is cut back in a slope out to R2, not in a wall one cell wide.
  const edge = new Float32Array(LUT + 1);
  const wet = new Uint8Array(LUT + 1);
  const bank = new Uint8Array(LUT + 1); // 0 out to the waterline, 255 at the top of the cut bank
  for (let i = 0; i <= LUT; i++) {
    const d = Math.sqrt((i / LUT) * R2 * R2);
    const u = (d - R0) / (R1 - R0);
    const w = (d - R1) / (R2 - R1);
    edge[i] =
      d < R0
        ? 0
        : d < R1
          ? 1.6 * FRESH * u * u
          : 1.6 * FRESH + (NEVER - 1.6 * FRESH) * w ** 2.2;
    wet[i] = Math.round(
      255 * Math.min(1, Math.max(0, 1 - (d - R0) / (R1 - R0))),
    );
    bank[i] = Math.round(255 * Math.min(1, Math.max(0, w)));
  }
  // the stored value for each whole age
  const code = new Uint16Array(NEVER + 1);
  for (let a = 0; a <= NEVER; a++)
    code[a] = Math.round((65535 * Math.log(1 + a / AGE0)) / SPAN);

  // Goes over the cells near a line and calls `put` with each cell and its place in the tables above.
  const near = (
    x: number[],
    y: number[],
    put: (cell: number, at: number) => void,
  ) => {
    const k = LUT / (R2 * R2);
    for (let p = 0; p < x.length - 1; p++) {
      const ax = x[p];
      const ay = y[p];
      const bx = x[p + 1];
      const by = y[p + 1];
      if (Math.max(ax, bx) < -R2 || Math.min(ax, bx) > UNITS + R2) continue;
      if (Math.max(ay, by) < -R2 || Math.min(ay, by) > UNITS + R2) continue;
      const ex = bx - ax;
      const ey = by - ay;
      const ee = ex * ex + ey * ey || 1;
      const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - R2) * S));
      const i1 = Math.min(CELLS - 1, Math.ceil((Math.max(ax, bx) + R2) * S));
      const j0 = Math.max(0, Math.floor((Math.min(ay, by) - R2) * S));
      const j1 = Math.min(CELLS - 1, Math.ceil((Math.max(ay, by) + R2) * S));
      for (let j = j0; j <= j1; j++) {
        const py = (j + 0.5) / S - ay;
        for (let i = i0; i <= i1; i++) {
          const px = (i + 0.5) / S - ax;
          const t = Math.min(1, Math.max(0, (px * ex + py * ey) / ee));
          const dx = px - ex * t;
          const dy = py - ey * t;
          const at = (dx * dx + dy * dy) * k;
          if (at < LUT) put(j * CELLS + i, at | 0);
        }
      }
    }
  };

  // The channel as it lies now, marked on the ground. `mark` also notes where the running water is.
  // (The same walk as `near`, written out, as it runs over a hundred thousand cells a frame.)
  const stamp = (mark: boolean) => {
    const now = river.time;
    const { x, y } = river;
    const k = LUT / (R2 * R2);
    if (mark) live.fill(0);
    for (let p = 0; p < x.length - 1; p += 2) {
      const q = Math.min(p + 2, x.length - 1);
      const ax = x[p];
      const ay = y[p];
      const ex = x[q] - ax;
      const ey = y[q] - ay;
      const lox = ex < 0 ? ax + ex : ax;
      const loy = ey < 0 ? ay + ey : ay;
      const hix = ex < 0 ? ax : ax + ex;
      const hiy = ey < 0 ? ay : ay + ey;
      if (hix < -R2 || lox > UNITS + R2 || hiy < -R2 || loy > UNITS + R2)
        continue;
      const ee = 1 / (ex * ex + ey * ey || 1);
      const i0 = Math.max(0, Math.floor((lox - R2) * S));
      const i1 = Math.min(CELLS - 1, Math.ceil((hix + R2) * S));
      const j0 = Math.max(0, Math.floor((loy - R2) * S));
      const j1 = Math.min(CELLS - 1, Math.ceil((hiy + R2) * S));
      if (i0 <= i1 && j0 < rows[0]) rows[0] = j0;
      if (i0 <= i1 && j1 > rows[1]) rows[1] = j1;
      for (let j = j0; j <= j1; j++) {
        const py = (j + 0.5) / S - ay;
        for (let i = i0; i <= i1; i++) {
          const px = (i + 0.5) / S - ax;
          let t = (px * ex + py * ey) * ee;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const dx = px - ex * t;
          const dy = py - ey * t;
          const at = ((dx * dx + dy * dy) * k) | 0;
          if (at >= LUT) continue;
          const c = j * CELLS + i;
          const v = now - edge[at];
          if (v > last[c]) {
            last[c] = v;
            side[c] = bank[at];
          }
          if (mark && wet[at] > live[c]) live[c] = wet[at];
        }
      }
    }
    // A loop the river has cut off stays a lake: its water ages slowly while it silts up, edges first, and
    // only then is it left to grow old like the rest of the ground.
    lakes = lakes.filter((l) => now - l.born < LAKE);
    for (const l of lakes) {
      const t0 = now - ((now - l.born) / LAKE) * DRY;
      for (let q = 0; q < l.cells.length; q++) {
        const t = t0 - l.edge[q];
        if (t > last[l.cells[q]]) {
          last[l.cells[q]] = t;
          side[l.cells[q]] = 255; // no scroll bars in a lake bed: its marks are not moments of the river's
        }
      }
    }
  };

  const field = {
    river,
    last,
    data,
    cuts: 0, // loops cut off so far
    get lakes() {
      return lakes.length;
    },
    // Moves the river on by n steps. The ground is marked every few steps, often enough that the channel
    // never jumps over a cell.
    step(n: number, every = 4) {
      for (let s = 0; s < n; s++) {
        river.step();
        for (const loop of river.cut) {
          field.cuts++;
          const cells: number[] = [];
          const edges: number[] = [];
          near(loop.x, loop.y, (cell, at) => {
            cells.push(cell);
            edges.push(edge[at]);
          });
          // a cell near two stretches of the loop is listed twice; the newer mark wins, as it should
          lakes.push({
            cells: Int32Array.from(cells),
            edge: Float32Array.from(edges),
            born: river.time,
          });
        }
        if (river.time % every === 0 && s < n - 1) stamp(false);
      }
      stamp(true);
    },
    rows, // only these rows of the picture ever change
    // Writes the picture: how long ago, in two bytes (the high byte and the rest, which a smooth texture
    // read adds back together exactly), the running water in a third, and bed or bank in the fourth.
    encode() {
      const now = river.time;
      const end = (rows[1] + 1) * CELLS;
      for (
        let c = Math.max(rows[0], 0) * CELLS, o = c * 4;
        c < end;
        c++, o += 4
      ) {
        const age = now - last[c];
        const v = code[age >= NEVER ? NEVER : age < 0 ? 0 : age | 0];
        data[o] = v >> 8;
        data[o + 1] = v & 255;
        data[o + 2] = live[c];
        data[o + 3] = side[c];
      }
      return data;
    },
  };
  return field;
}
