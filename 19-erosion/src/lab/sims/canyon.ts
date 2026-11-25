// The wandering river cutting down as it goes. The river sinks at a steady rate (or the land rises), and
// every piece of ground keeps the height the river had when it last ran there. Nothing else is modelled, and
// that is enough for a canyon: the inside of a bend, left behind a little at a time, is a smooth ramp; the
// outside, where the river eats into ground it left long ago, is a cliff; a loop cut off is left hanging as
// a dry trough around a hill. Plants take the ground by how long it has been left: sand, grass, wood.
import { Raster, relief, type Def, type Sim } from "../util";
import { makeRiver } from "./river";

const river = (lidar: boolean) =>
  function make(seed: number): Sim {
    const n = 260;
    const river = makeRiver(seed, {
      from: -70,
      to: n + 70,
      mid: n / 2,
      reach: n * 0.4,
    });
    const N = n * n;
    const OLD = 9000; // ground left longer than this is the plateau
    const last = new Float32Array(N).fill(-1e6);
    const h = new Float32Array(N);
    const raster = new Raster(n, n);
    const stamp = () => {
      const { x, y, time } = river;
      for (let p = 0; p < x.length; p++) {
        const cx = Math.round(x[p]);
        const cy = Math.round(y[p]);
        for (let j = cy - 2; j <= cy + 2; j++)
          for (let i = cx - 2; i <= cx + 2; i++) {
            if (i < 0 || j < 0 || i >= n || j >= n) continue;
            if ((i - x[p]) ** 2 + (j - y[p]) ** 2 < 1.7) last[j * n + i] = time;
          }
      }
    };
    return {
      step() {
        river.step();
        stamp();
      },
      draw(ctx, size) {
        const { time } = river;
        const span = lidar ? 30000 : OLD;
        for (let k = 0; k < N; k++)
          h[k] = Math.min(1, (time - last[k]) / span) ** (lidar ? 0.45 : 0.7);
        for (let j = 0; j < n; j++)
          for (let i = 0; i < n; i++) {
            const k = j * n + i;
            const age = time - last[k];
            const l = 0.35 + 0.65 * relief(h, n, n, i, j, 26);
            let r: number;
            let g: number;
            let b: number;
            if (lidar) {
              const t = Math.min(1, age / 30000) ** 0.3;
              const e = 0.55 + 0.45 * relief(h, n, n, i, j, 60);
              r = (250 - 236 * t) * e;
              g = (252 - 214 * t) * e;
              b = (255 - 170 * t) * e;
            } else if (age < 3) [r, g, b] = [44, 92, 112];
            else {
              // bare sand, then grass, then wood, then the dry rock of the plateau
              const t = Math.min(1, age / OLD);
              const grass = Math.min(1, Math.max(0, (age - 120) / 500));
              const wood = Math.min(1, Math.max(0, (age - 900) / 1800));
              const dry = Math.min(1, Math.max(0, (t - 0.55) / 0.35));
              r = 214 + (132 - 214) * grass;
              g = 198 + (158 - 198) * grass;
              b = 160 + (84 - 160) * grass;
              r += (58 - r) * wood;
              g += (96 - g) * wood;
              b += (58 - b) * wood;
              r += (178 - r) * dry;
              g += (134 - g) * dry;
              b += (98 - b) * dry;
              r *= l;
              g *= l;
              b *= l;
            }
            raster.set(k, r, g, b);
          }
        raster.put(ctx, size);
      },
    };
  };

export const canyon: Def = {
  id: "canyon",
  title: "Meanders, cutting down",
  paper: "the same river · ground keeps the river's height from its last visit",
  note: "Ramps inside the bends, cliffs outside, cut-off loops left hanging round a hill. Green is ground left long enough to grow over.",
  steps: 8,
  make: river(false),
};

// The same field of last visits, drawn as the lidar maps of rivers are: height above the river as light, the
// newest ground white and the oldest sunk into the dark, with no land or plants to model at all.
export const lidar: Def = {
  id: "lidar",
  title: "Meanders, as a lidar map",
  paper: "the same river · height above the river drawn as light",
  note: "Only the time since the river's last visit, as a tone. Old channels stay as ghosts.",
  steps: 8,
  make: river(true),
};
