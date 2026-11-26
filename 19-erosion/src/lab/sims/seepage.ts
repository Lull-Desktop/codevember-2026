// Channels fed by groundwater (Devauchelle et al. 2012; Niemeyer, Pietronero & Wiesmann 1984). Rain soaks in
// everywhere and the water table drains to the channels, so its height obeys a Poisson equation that is zero
// on every channel. A channel's tip grows where the most water seeps into it. Tips screen each other: a branch
// between two others gets less water and stops.
import { Raster, rng, type Def, type Sim } from "../util";

export const seepage: Def = {
  id: "seepage",
  title: "Seepage channels",
  paper: "Devauchelle et al. 2012 · growth in a Poisson field",
  note: "Channels grow headward toward the water. Each drains its surroundings, starving the tips beside it.",
  make(seed): Sim {
    const rnd = rng(seed + 3);
    const n = 150;
    const N = n * n;
    const water = new Float32Array(N).fill(0.5);
    const channel = new Float32Array(N); // 0, or the time it was cut
    let time = 1;
    for (let i = 0; i < n; i++) channel[(n - 1) * n + i] = 1;
    let count = n;
    const raster = new Raster(n, n);
    const picks: number[] = [];
    const weight: number[] = [];
    const relax = () => {
      for (let pass = 0; pass < 2; pass++)
        for (let j = 0; j < n - 1; j++)
          for (let i = (j + pass) & 1; i < n; i += 2) {
            const k = j * n + i;
            if (channel[k]) {
              water[k] = 0;
              continue;
            }
            // the sides and the top let nothing through: there the neighbour outside mirrors the one inside
            const l = water[i > 0 ? k - 1 : k + 1];
            const r = water[i < n - 1 ? k + 1 : k - 1];
            const u = water[j > 0 ? k - n : k + n];
            const d = water[k + n];
            water[k] += 1.75 * ((l + r + u + d) / 4 + 0.00035 - water[k]);
          }
    };
    for (let k = 0; k < 300; k++) relax();
    return {
      step() {
        time++;
        for (let k = 0; k < 5; k++) relax();
        // every cell beside a channel may be cut next, the likelier the more water stands in it
        picks.length = weight.length = 0;
        let sum = 0;
        for (let j = 0; j < n - 1; j++)
          for (let i = 0; i < n; i++) {
            const k = j * n + i;
            if (channel[k]) continue;
            const beside =
              (i > 0 && channel[k - 1]) ||
              (i < n - 1 && channel[k + 1]) ||
              (j > 0 && channel[k - n]) ||
              channel[k + n];
            if (!beside) continue;
            const w = water[k] ** 2;
            sum += w;
            picks.push(k);
            weight.push(w);
          }
        for (let g = 0; g < 4 && sum > 0; g++) {
          let at = rnd() * sum;
          for (let p = 0; p < picks.length; p++) {
            at -= weight[p];
            if (at <= 0) {
              if (!channel[picks[p]]) ((channel[picks[p]] = time), count++);
              break;
            }
          }
        }
      },
      done: () => count > N * 0.16,
      draw(ctx, size) {
        let top = 1e-6;
        for (let i = 0; i < N; i++) top = Math.max(top, water[i]);
        for (let k = 0; k < N; k++) {
          if (channel[k]) {
            const young = Math.max(0, 1 - (time - channel[k]) / 400);
            raster.set(k, 20 + 150 * young, 44 + 150 * young, 64 + 130 * young);
          } else {
            const t = Math.sqrt(water[k] / top);
            raster.set(k, 96 + 120 * t, 84 + 112 * t, 66 + 96 * t);
          }
        }
        raster.put(ctx, size, false);
      },
    };
  },
};
