// Stone forests (Huang, Tong, Shelley & Ristroph 2020). A soluble block stands in still water. The water
// against it grows heavy with what it has dissolved and slides down the surface in a thin layer; the layer is
// thinnest, and dissolves fastest, where it has only just begun, near the top. So the top of each column is
// eaten from its sides faster than its foot, and it sharpens to a spike as it goes down.
import { rng, type Def, type Sim } from "../util";

export const pinnacles: Def = {
  id: "pinnacles",
  title: "Stone forest",
  paper:
    "Huang, Tong, Shelley & Ristroph 2020 · dissolving under its own sinking flow",
  note: "Rate falls with the distance the heavy water has run down the wall. The lines are earlier outlines.",
  steps: 1,
  make(seed): Sim {
    const rnd = rng(seed + 55);
    const N = 620;
    const W = 3;
    const dx = W / N;
    const y = new Float32Array(N);
    for (let x = 0.06 + rnd() * 0.1; x < W - 0.2; ) {
      const w = 0.22 + 0.4 * rnd();
      const top = 1.25 + 0.7 * rnd();
      for (let i = 0; i < N; i++) {
        const u = (i * dx - x - w / 2) / (w / 2);
        if (Math.abs(u) < 1)
          y[i] = Math.max(
            y[i],
            top * (1 - Math.abs(u) ** 5) ** 0.45 * (1 - 0.12 * u * u),
          );
      }
      x += w + 0.04 + 0.14 * rnd();
    }
    const run = new Float32Array(N); // how far the layer has come to reach each point, steepness counted in
    const cut = new Float32Array(N);
    const START = 0.004;
    const dt = 0.3 * dx * START ** 0.25;
    const lines: Float32Array[] = [];
    let time = 0;
    return {
      step() {
        if (time++ % 90 === 0) lines.push(y.slice());
        // the slope as seen from the side the surface is retreating from, so a tip is taken down by its
        // steeper flank and a wall can stand upright without the sum blowing up
        const part = (i: number) => {
          const back = i > 0 ? Math.max((y[i] - y[i - 1]) / dx, 0) : 0;
          const fore = i < N - 1 ? Math.min((y[i + 1] - y[i]) / dx, 0) : 0;
          return Math.max(back, -fore);
        };
        let sum = 0;
        for (let i = 0; i < N; i++) {
          // the layer running down to the right
          const p = part(i);
          const drive = Math.cbrt(p / Math.sqrt(1 + p * p));
          if (i > 0 && y[i] < y[i - 1]) {
            sum += drive * dx * Math.sqrt(1 + p * p);
            run[i] = sum;
          } else {
            sum = 0;
            run[i] = -1;
          }
        }
        sum = 0;
        for (let i = N - 1; i >= 0; i--) {
          const p = part(i);
          const drive = Math.cbrt(p / Math.sqrt(1 + p * p));
          if (i < N - 1 && y[i] < y[i + 1]) {
            sum += drive * dx * Math.sqrt(1 + p * p);
            if (run[i] < 0 || sum < run[i]) run[i] = sum;
          } else sum = 0;
        }
        for (let i = 0; i < N; i++) {
          const p = part(i);
          const drive = Math.cbrt(p / Math.sqrt(1 + p * p));
          cut[i] =
            (drive / (Math.max(run[i], 0) + START) ** 0.25) *
            Math.sqrt(1 + p * p);
        }
        for (let i = 0; i < N; i++) y[i] = Math.max(0, y[i] - dt * cut[i]);
      },
      done: () => {
        let top = 0;
        for (let i = 0; i < N; i++) top = Math.max(top, y[i]);
        return top < 0.12;
      },
      draw(ctx, size) {
        const k = size / W;
        const base = size * 0.86;
        const g = ctx.createLinearGradient(0, 0, 0, size);
        g.addColorStop(0, "#0f2a33");
        g.addColorStop(1, "#1d4651");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, size, size);
        const trace = (h: Float32Array) => {
          ctx.beginPath();
          ctx.moveTo(0, base);
          for (let i = 0; i < N; i++) ctx.lineTo(i * dx * k, base - h[i] * k);
          ctx.lineTo(size, base);
        };
        ctx.lineWidth = size / 800;
        lines.forEach((h, i) => {
          trace(h);
          ctx.strokeStyle = `rgba(190,224,228,${0.1 + (0.3 * i) / lines.length})`;
          ctx.stroke();
        });
        trace(y);
        ctx.fillStyle = "#e6dcc8";
        ctx.fill();
        ctx.fillStyle = "#c9bda6";
        ctx.fillRect(0, base, size, size - base);
      },
    };
  },
};
