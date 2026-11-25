// Drying mud as a net of springs (Kitsunezaki 1999; Skjeltorp & Meakin 1988). A layer stuck to a base shrinks;
// each spring breaks when stretched too far. A break unloads the springs beside it and loads those ahead, so
// breaks line up into cracks, and a crack relieves only the pull across itself: the next one meets it square.
import { rng, type Def, type Sim } from "../util";

export const cracks: Def = {
  id: "cracks",
  title: "Drying cracks",
  paper: "Kitsunezaki 1999 · spring network on a base",
  note: "A shrinking layer held by its base. The base's grip sets the size of the cells.",
  make(seed): Sim {
    const rnd = rng(seed);
    const nx = 86;
    const ny = 98;
    const row = Math.sqrt(3) / 2;
    const n = nx * ny;
    const px = new Float32Array(n);
    const py = new Float32Array(n);
    const ox = new Float32Array(n);
    const oy = new Float32Array(n);
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        ox[k] = px[k] = i + (j & 1) * 0.5 + (rnd() - 0.5) * 0.3;
        oy[k] = py[k] = j * row + (rnd() - 0.5) * 0.3;
      }
    const a: number[] = [];
    const b: number[] = [];
    const link = (i: number, j: number, i2: number, j2: number) => {
      if (i2 < 0 || i2 >= nx || j2 >= ny) return;
      a.push(j * nx + i);
      b.push(j2 * nx + i2);
    };
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        link(i, j, i + 1, j);
        link(i, j, i, j + 1);
        link(i, j, j & 1 ? i + 1 : i - 1, j + 1);
      }
    const m = a.length;
    const rest = new Float32Array(m);
    const limit = new Float32Array(m);
    const alive = new Uint8Array(m).fill(1);
    const born = new Float32Array(m);
    for (let k = 0; k < m; k++) {
      rest[k] = Math.hypot(px[a[k]] - px[b[k]], py[a[k]] - py[b[k]]);
      limit[k] = 0.05 * (0.92 + 0.16 * rnd());
    }
    const grip = 0.009; // the base's hold on each point, against 1 for a spring
    let shrink = 0.036;
    const most = 0.12;
    const fx = new Float32Array(n);
    const fy = new Float32Array(n);
    let time = 0;

    const relax = () => {
      for (let k = 0; k < n; k++) {
        fx[k] = grip * (ox[k] - px[k]);
        fy[k] = grip * (oy[k] - py[k]);
      }
      let worst = -1;
      let over = 1;
      const s = 1 - shrink;
      for (let k = 0; k < m; k++) {
        if (!alive[k]) continue;
        const dx = px[b[k]] - px[a[k]];
        const dy = py[b[k]] - py[a[k]];
        const len = Math.hypot(dx, dy);
        const r = rest[k] * s;
        const f = (len - r) / len;
        fx[a[k]] += dx * f;
        fy[a[k]] += dy * f;
        fx[b[k]] -= dx * f;
        fy[b[k]] -= dy * f;
        const strain = (len - r) / r / limit[k];
        if (strain > over) {
          over = strain;
          worst = k;
        }
      }
      for (let k = 0; k < n; k++) {
        px[k] += fx[k] * 0.14;
        py[k] += fy[k] * 0.14;
      }
      return worst;
    };

    return {
      step() {
        time++;
        shrink = Math.min(most, shrink + 0.00007);
        for (let k = 0; k < 5; k++) {
          relax();
          relax();
          relax();
          relax();
          const worst = relax();
          if (worst >= 0) {
            alive[worst] = 0;
            born[worst] = time;
          }
        }
      },
      done: () => shrink >= most,
      draw(ctx, size) {
        const s = size / (nx - 0.5);
        ctx.fillStyle = "#b79f84";
        ctx.fillRect(0, 0, size, size);
        ctx.strokeStyle = "#2a1f18";
        ctx.lineCap = "round";
        const sh = 1 - shrink;
        for (let k = 0; k < m; k++) {
          if (alive[k]) continue;
          const ax = px[a[k]];
          const ay = py[a[k]];
          const dx = px[b[k]] - ax;
          const dy = py[b[k]] - ay;
          const len = Math.hypot(dx, dy);
          const open = Math.max(0, len - rest[k] * sh);
          const mx = ax + dx / 2;
          const my = ay + dy / 2;
          const h = 0.33 / len;
          ctx.lineWidth = Math.max(0.7, open * s * 0.9);
          ctx.beginPath();
          ctx.moveTo((mx - dy * h) * s, (my + dx * h) * s);
          ctx.lineTo((mx + dy * h) * s, (my - dx * h) * s);
          ctx.stroke();
        }
      },
    };
  },
};
