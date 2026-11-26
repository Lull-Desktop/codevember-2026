// Erosion as one field, made once. Rock is worn inward from its surface at a speed set by how hard it is, so
// each point has a time at which the surface arrives there: the surface at any moment is one level of that
// field, and the whole history is a single picture to read levels from (the wear need not be stepped at all).
// A second pass drops what has lost its footing: a point is gone as soon as nothing joins it to the rock
// below. Hard beds make caps on stalks, which thin and let the cap go.
//
// The rock repeats with depth, so after a start the surface's shape repeats too, one repeat lower each time:
// following it down gives a loop that closes exactly.
import { Raster, rng, type Def, type Sim } from "../util";

export const hoodoos: Def = {
  id: "hoodoos",
  title: "Arrival time through layered rock",
  paper:
    "front propagation (eikonal) · hard beds over soft · rock that repeats with depth",
  note: "The whole erosion is one field of arrival times; the surface is a level of it. The picture follows it down and repeats exactly.",
  make(seed): Sim {
    const rnd = rng(seed + 77);
    const W = 200;
    const P = 110; // the rock repeats every P rows
    const H = P * 14;
    const N = W * H;
    // how fast each cell wears: soft and harder beds, a little wavy, and thin hard lenses among them
    const speed = new Float32Array(N);
    const kind = new Uint8Array(N); // which colour: the bed, or 255 for a hard lens
    const beds = Array.from({ length: 9 }, () => 0.55 + 0.9 * rnd());
    const wave = [rnd() * 6.28, rnd() * 6.28];
    // (all equally fast and dead upright: were one a little quicker it would in the end run ahead of all
    // the others, and the settled picture would be a single valley)
    const joints = Array.from({ length: 7 }, (_, i) => ({
      x: Math.round(((i + 0.15 + 0.7 * rnd()) / 7) * W),
    }));
    const lenses = Array.from({ length: 9 }, () => ({
      x: rnd() * W,
      z: rnd() * P,
      rx: 5 + rnd() * 13,
      rz: 1.6 + rnd() * 2.6,
    }));
    for (let z = 0; z < H; z++)
      for (let x = 0; x < W; x++) {
        const k = z * W + x;
        const u = (2 * Math.PI * x) / W;
        const zz =
          (((z + 5 * Math.sin(u + wave[0]) + 3 * Math.sin(2 * u + wave[1])) %
            P) +
            P) %
          P;
        const bed = Math.floor((zz / P) * beds.length);
        speed[k] = beds[bed];
        kind[k] = bed;
        // upright joints, where water gets in and the rock goes several times faster: they are what cuts
        // the surface into fins and spires, the beds alone would only lower it
        for (const j of joints) {
          let dx = Math.abs(x - j.x);
          dx = Math.min(dx, W - dx);
          if (dx < 1.3) speed[k] *= 5;
        }
        for (const l of lenses) {
          let dx = Math.abs(x - l.x);
          dx = Math.min(dx, W - dx);
          let dz = Math.abs((z % P) - l.z);
          dz = Math.min(dz, P - dz);
          if ((dx / l.rx) ** 2 + (dz / l.rz) ** 2 < 1) {
            speed[k] = 0.1;
            kind[k] = 255;
          }
        }
      }

    // a heap of cells by key, for the two passes below
    const heap: number[] = [];
    const key = new Float64Array(N);
    const push = (c: number) => {
      let i = heap.push(c) - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (key[heap[p]] <= key[c]) break;
        heap[i] = heap[p];
        i = p;
      }
      heap[i] = c;
    };
    const pop = () => {
      const top = heap[0];
      const c = heap.pop()!;
      const n = heap.length;
      if (n) {
        let i = 0;
        for (;;) {
          let a = 2 * i + 1;
          if (a >= n) break;
          if (a + 1 < n && key[heap[a + 1]] < key[heap[a]]) a++;
          if (key[heap[a]] >= key[c]) break;
          heap[i] = heap[a];
          i = a;
        }
        heap[i] = c;
      }
      return top;
    };
    const around = (c: number, each: (o: number, far: number) => void) => {
      const x = c % W;
      const z = (c / W) | 0;
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dz) continue;
          const oz = z + dz;
          if (oz < 0 || oz >= H) continue;
          each(oz * W + ((x + dx + W) % W), dx && dz ? Math.SQRT2 : 1);
        }
    };
    // 1. when the surface, worn in from the top, comes to each cell
    const arrive = new Float64Array(N).fill(Infinity);
    const fixed = new Uint8Array(N);
    for (let x = 0; x < W; x++) {
      arrive[x] = 0;
      key[x] = 0;
      push(x);
    }
    while (heap.length) {
      const c = pop();
      if (fixed[c]) continue;
      fixed[c] = 1;
      around(c, (o, far) => {
        const t = arrive[c] + (far * 2) / (speed[c] + speed[o]);
        if (t < arrive[o]) {
          arrive[o] = t;
          key[o] = t;
          push(o);
        }
      });
    }
    // 2. when each cell is gone: at the latest moment some way still joins it to the rock far below
    //    (the best way down is the one whose earliest-worn cell lasts longest)
    const gone = new Float64Array(N).fill(-Infinity);
    fixed.fill(0);
    for (let x = 0; x < W; x++) {
      const c = (H - 1) * W + x;
      gone[c] = arrive[c];
      key[c] = -gone[c];
      push(c);
    }
    while (heap.length) {
      const c = pop();
      if (fixed[c]) continue;
      fixed[c] = 1;
      around(c, (o) => {
        const t = Math.min(gone[c], arrive[o]);
        if (t > gone[o]) {
          gone[o] = t;
          key[o] = -t;
          push(o);
        }
      });
    }
    // how long the surface takes to go one repeat down, and how exactly the field repeats by then: measured
    // at two depths, to see whether the start is still being forgotten
    const measure = (from: number) => {
      let turn = 0;
      for (let z = from; z < from + P; z++)
        for (let x = 0; x < W; x++)
          turn += gone[(z + P) * W + x] - gone[z * W + x];
      turn /= P * W;
      let off = 0;
      let wrong = 0;
      for (let z = from; z < from + P; z++)
        for (let x = 0; x < W; x++) {
          const d = Math.abs(gone[(z + P) * W + x] - gone[z * W + x] - turn);
          off = Math.max(off, d);
          if (d > turn * 0.01) wrong++;
        }
      return { turn, off, wrong: wrong / (P * W) };
    };
    const first = measure(8 * P);
    const second = measure(10 * P);
    const turn = second.turn;
    console.log(
      `hoodoos: a repeat takes ${first.turn.toFixed(3)} then ${second.turn.toFixed(3)}; worst miss ${first.off.toFixed(3)} then ${second.off.toFixed(3)}; cells off by over 1%: ${(first.wrong * 100).toFixed(2)}% then ${(second.wrong * 100).toFixed(2)}%`,
    );
    let begin = 0;
    for (let x = 0; x < W; x++) begin += gone[Math.floor(10.5 * P) * W + x] / W;

    const V = 200; // rows in the picture (the surface's deepest cuts run well ahead of its tops)
    const raster = new Raster(W, V);
    const tones = [
      [226, 200, 160],
      [201, 142, 96],
      [236, 214, 178],
      [178, 98, 72],
      [214, 168, 120],
      [240, 224, 196],
      [190, 120, 84],
      [222, 186, 140],
      [164, 86, 66],
    ];
    let phase = 0;
    return {
      step() {
        phase = (phase + 1 / 900) % 1;
      },
      draw(ctx, size) {
        const now = begin + phase * turn;
        const top = 10.5 * P + phase * P - V * 0.5; // the picture goes down with the surface
        for (let j = 0; j < V; j++) {
          const z = top + j;
          const z0 = Math.floor(z);
          const f = z - z0;
          for (let i = 0; i < W; i++) {
            const a = gone[z0 * W + i];
            const b = gone[(z0 + 1) * W + i];
            const t = a + (b - a) * f;
            const k = j * W + i;
            if (t <= now) {
              const s = j / V;
              raster.set(k, 196 + 30 * s, 214 + 16 * s, 222 + 4 * s);
              continue;
            }
            const c = kind[(f < 0.5 ? z0 : z0 + 1) * W + i];
            const tone = c === 255 ? [92, 70, 60] : tones[c];
            // the freshly bared rock is a little lighter, and the side away from the light darker
            const left = gone[z0 * W + ((i + W - 1) % W)];
            const right = gone[z0 * W + ((i + 1) % W)];
            const up = gone[(z0 - 1) * W + i];
            const lit = Math.max(
              -1,
              Math.min(1, ((right - left) * 0.7 + (b - up) * 0.7) * 0.25),
            );
            const fresh = Math.exp(-(t - now) / 2.5);
            const l = 0.86 + 0.14 * lit + 0.16 * fresh;
            raster.set(k, tone[0] * l, tone[1] * l, tone[2] * l);
          }
        }
        raster.put(ctx, size);
      },
    };
  },
};
