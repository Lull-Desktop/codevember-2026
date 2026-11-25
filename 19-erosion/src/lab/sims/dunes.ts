// Dunes of slabs (Werner 1995). Sand is a pile of slabs on a grid. A slab is picked up, carried a few cells
// downwind and set down, more surely on sand than on bare ground, and always in the wind shadow of a pile.
// Slopes too steep slide. Nothing more is needed for ridges to gather, march, join and split.
import { Raster, relief, rng, type Def, type Sim } from "../util";

export const dunes: Def = {
  id: "dunes",
  title: "Dunes",
  paper: "Werner 1995 · slabs carried by wind",
  note: "Pick up, hop, set down in the lee. The ground wraps round, so the field marches for ever.",
  make(seed): Sim {
    const rnd = rng(seed + 5);
    const n = 220;
    const N = n * n;
    const h = new Int16Array(N);
    for (let i = 0; i < N; i++) h[i] = 5 + Math.floor(rnd() * 5);
    const at = (x: number, y: number) => ((y + n) % n) * n + ((x + n) % n);
    const raster = new Raster(n, n);
    // in the lee of sand upwind: under a line falling 15 degrees from its top (a slab is a third of a cell high)
    const shadow = (x: number, y: number) => {
      const here = h[at(x, y)];
      for (let d = 1; d < 14; d++)
        if (h[at(x - d, y)] - here >= 0.8 * d) return true;
      return false;
    };
    const ring = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    // a pile steeper than sand can lie slides, a slab at a time
    const slide = (x: number, y: number, down: boolean) => {
      for (let guard = 0; guard < 60; guard++) {
        let bx = 0;
        let by = 0;
        let most = 2;
        for (const [dx, dy] of ring) {
          const diff = down
            ? h[at(x, y)] - h[at(x + dx, y + dy)]
            : h[at(x + dx, y + dy)] - h[at(x, y)];
          if (diff > most) ((most = diff), (bx = dx), (by = dy));
        }
        if (most === 2) return;
        if (down) {
          h[at(x, y)]--;
          h[at(x + bx, y + by)]++;
        } else {
          h[at(x + bx, y + by)]--;
          h[at(x, y)]++;
        }
        x += bx;
        y += by;
      }
    };
    return {
      step() {
        for (let m = 0; m < 12000; m++) {
          let x = Math.floor(rnd() * n);
          const y = Math.floor(rnd() * n);
          if (h[at(x, y)] <= 0 || shadow(x, y)) continue;
          h[at(x, y)]--;
          slide(x, y, false);
          for (let hop = 0; hop < 60; hop++) {
            x = (x + 5) % n;
            if (shadow(x, y) || rnd() < (h[at(x, y)] > 0 ? 0.6 : 0.4)) break;
          }
          h[at(x, y)]++;
          slide(x, y, true);
        }
      },
      draw(ctx, size) {
        for (let j = 0; j < n; j++)
          for (let i = 0; i < n; i++) {
            const k = j * n + i;
            const l = relief(h, n, n, i, j, 0.13, true);
            const bare = h[k] <= 0 ? 0.72 : 1;
            raster.set(k, 226 * l * bare, 188 * l * bare, 136 * l * bare);
          }
        raster.put(ctx, size);
      },
    };
  },
};
