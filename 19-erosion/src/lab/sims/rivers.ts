// A land cut by its rivers (Howard 1994; Braun & Willett 2013). The ground rises steadily; each cell is worn
// down at a rate that grows with its slope and with how much land drains through it. Water finds the steepest
// way down, so wherever a little more gathers the ground is cut faster and gathers more: valleys branch
// upstream until every ridge is as far from a river as every other.
import { Raster, relief, rng, type Def, type Sim } from "../util";

export const rivers: Def = {
  id: "rivers",
  title: "River networks",
  paper: "Howard 1994 · Braun & Willett 2013 · stream power law",
  note: "Uplift against wear that grows with slope and drained area. The uplift slowly leans round, so divides keep moving.",
  make(seed): Sim {
    const rnd = rng(seed + 7);
    const n = 170;
    const N = n * n;
    const h = new Float32Array(N);
    const soft = new Float32Array(N); // how easily each cell wears: the rock is not all one
    const lump = Array.from({ length: 12 }, () => [
      rnd() * 6.28,
      rnd() * 6.28,
      0.02 + rnd() * 0.07,
      0.02 + rnd() * 0.07,
    ]);
    for (let i = 0; i < N; i++) {
      const x = i % n;
      const y = (i / n) | 0;
      let s = 0;
      for (const [a, b, fx, fy] of lump)
        s += Math.sin(a + x * fx * 2) * Math.sin(b + y * fy * 2);
      h[i] = rnd() * 0.8 + 0.35 * s;
      soft[i] = 0.55 + 0.9 * rnd();
    }
    const to = new Int32Array(N);
    const dist = new Float32Array(N);
    const area = new Float32Array(N);
    const order = new Uint32Array(N);
    const edge = (i: number) => {
      const x = i % n;
      const y = (i / n) | 0;
      return x === 0 || y === 0 || x === n - 1 || y === n - 1;
    };
    const ring = [-n - 1, -n, -n + 1, -1, 1, n - 1, n, n + 1];
    const far = [Math.SQRT2, 1, Math.SQRT2, 1, 1, Math.SQRT2, 1, Math.SQRT2];
    const raster = new Raster(n, n);
    let time = 0;
    return {
      step() {
        time++;
        // where each cell's water goes: to the neighbour it falls to most steeply
        for (let i = 0; i < N; i++) {
          to[i] = i;
          if (edge(i)) continue;
          let best = 0;
          for (let k = 0; k < 8; k++) {
            const s = (h[i] - h[i + ring[k]]) / far[k];
            if (s > best)
              ((best = s), (to[i] = i + ring[k]), (dist[i] = far[k]));
          }
        }
        for (let i = 0; i < N; i++) order[i] = i;
        order.sort((a, b) => h[b] - h[a]);
        area.fill(1);
        for (let k = 0; k < N; k++) {
          const i = order[k];
          if (to[i] !== i) area[to[i]] += area[i];
        }
        // from the outlets up: each cell is worn toward the one it drains to (solved for the new height,
        // which lets a step be long)
        const turn = time * 0.004;
        const cx = Math.cos(turn);
        const cy = Math.sin(turn);
        for (let k = N - 1; k >= 0; k--) {
          const i = order[k];
          if (edge(i)) continue;
          const x = (i % n) / n - 0.5;
          const y = ((i / n) | 0) / n - 0.5;
          const up = 0.012 * (1 + 0.9 * (x * cx + y * cy));
          if (to[i] === i) h[i] += up;
          else {
            const f = (0.06 * soft[i] * Math.sqrt(area[i])) / dist[i];
            h[i] = (h[i] + up + f * h[to[i]]) / (1 + f);
          }
        }
        // and the slopes between the rivers creep
        for (let i = n + 1; i < N - n - 1; i++) {
          if (edge(i)) continue;
          h[i] += 0.03 * (h[i - 1] + h[i + 1] + h[i - n] + h[i + n] - 4 * h[i]);
        }
      },
      draw(ctx, size) {
        let top = 1e-6;
        for (let i = 0; i < N; i++) top = Math.max(top, h[i]);
        for (let j = 0; j < n; j++)
          for (let i = 0; i < n; i++) {
            const k = j * n + i;
            const l = relief(h, n, n, i, j, 3.2 / top);
            const t = h[k] / top;
            const water = Math.min(
              1,
              Math.max(0, (Math.log(area[k]) - 2.6) / 4.5),
            );
            let r = (112 + 120 * t) * l;
            let g = (94 + 100 * t) * l;
            let b = (74 + 76 * t) * l;
            r += (30 - r) * water;
            g += (62 - g) * water;
            b += (84 - b) * water;
            raster.set(k, r, g, b);
          }
        raster.put(ctx, size);
      },
    };
  },
};
