// Worn stones (Firey 1974; Bloore 1977; Domokos et al. 2014). Each point of a stone's rim is worn back at a
// steady rate plus a rate that grows with how sharply the rim turns there. Corners go first, so a fragment
// rounds long before it has lost much of its size; then the round stone only shrinks.
import { rng, type Def, type Sim } from "../util";

type Stone = {
  x: Float32Array;
  y: Float32Array;
  cx: number;
  cy: number;
  rings: Float32Array[];
  steps: number;
  tone: number;
};

export const pebbles: Def = {
  id: "pebbles",
  title: "Worn stones",
  paper: "Firey 1974 · Bloore 1977 · Domokos et al. 2014 · wear by curvature",
  note: "Fragments round first and shrink after. The rings are where the rim was.",
  steps: 4,
  make(seed): Sim {
    const rnd = rng(seed + 90);
    const DS = 0.035; // between the rim's points, the stone being about 1 across
    const spread = (px: number[], py: number[]) => {
      // the rim, walked again in even steps
      const n = px.length;
      let total = 0;
      const at = [0];
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        total += Math.hypot(px[j] - px[i], py[j] - py[i]);
        at.push(total);
      }
      const count = Math.max(12, Math.round(total / DS));
      const x = new Float32Array(count);
      const y = new Float32Array(count);
      let k = 0;
      for (let c = 0; c < count; c++) {
        const s = (c / count) * total;
        while (at[k + 1] < s) k++;
        const t = (s - at[k]) / (at[k + 1] - at[k] || 1);
        const j = (k + 1) % n;
        x[c] = px[k] + (px[j] - px[k]) * t;
        y[c] = py[k] + (py[j] - py[k]) * t;
      }
      return { x, y };
    };
    const fresh = (cx: number, cy: number): Stone => {
      // a fragment: a few corners around a middle
      const corners = 4 + Math.floor(rnd() * 4);
      const px: number[] = [];
      const py: number[] = [];
      const turn = rnd() * 6.28;
      const squash = 0.65 + 0.35 * rnd();
      for (let i = 0; i < corners; i++) {
        const a = turn + ((i + 0.75 * rnd()) / corners) * 6.2832;
        const r = 0.6 + 0.4 * rnd();
        px.push(Math.cos(a) * r);
        py.push(Math.sin(a) * r * squash);
      }
      return { ...spread(px, py), cx, cy, rings: [], steps: 0, tone: rnd() };
    };
    const stones: Stone[] = [];
    for (let j = 0; j < 3; j++)
      for (let i = 0; i < 3; i++) stones.push(fresh(i, j));
    // not all at the same point of their lives
    const ahead = stones.map(() => Math.floor(rnd() * 500));

    const wear = (s: Stone) => {
      const n = s.x.length;
      const nx = new Array<number>(n);
      const ny = new Array<number>(n);
      const dt = 0.18 * DS * DS;
      for (let i = 0; i < n; i++) {
        const a = (i + n - 1) % n;
        const b = (i + 1) % n;
        const ux = s.x[i] - s.x[a];
        const uy = s.y[i] - s.y[a];
        const vx = s.x[b] - s.x[i];
        const vy = s.y[b] - s.y[i];
        const lu = Math.hypot(ux, uy);
        const lv = Math.hypot(vx, vy);
        const wx = s.x[b] - s.x[a];
        const wy = s.y[b] - s.y[a];
        const lw = Math.hypot(wx, wy) || 1e-9;
        const curve = (2 * (ux * vy - uy * vx)) / (lu * lv * lw || 1e-9); // 1 over the radius of the turn
        const rate = Math.max(0, 0.35 + curve);
        // inward is to the left of the way round (the rim runs anticlockwise)
        nx[i] = s.x[i] - (wy / lw) * rate * dt;
        ny[i] = s.y[i] + (wx / lw) * rate * dt;
      }
      const next = spread(nx, ny);
      s.x = next.x;
      s.y = next.y;
      if (s.steps++ % 110 === 0)
        s.rings.push(new Float32Array([...s.x, ...s.y]));
    };
    const small = (s: Stone) => s.x.length <= 14;
    stones.forEach((s, i) => {
      for (let k = 0; k < ahead[i] && !small(s); k++) wear(s);
    });

    return {
      step() {
        stones.forEach((s, i) => {
          if (small(s)) stones[i] = fresh(s.cx, s.cy);
          else wear(s);
        });
      },
      draw(ctx, size) {
        ctx.fillStyle = "#1d1a17";
        ctx.fillRect(0, 0, size, size);
        const cell = size / 3;
        const k = cell * 0.44;
        for (const s of stones) {
          const ox = (s.cx + 0.5) * cell;
          const oy = (s.cy + 0.5) * cell;
          const path = (
            x: ArrayLike<number>,
            y: ArrayLike<number>,
            n: number,
            off = 0,
          ) => {
            ctx.beginPath();
            for (let i = 0; i < n; i++)
              ctx.lineTo(ox + x[i] * k, oy + y[off + i] * k);
            ctx.closePath();
          };
          ctx.lineWidth = size / 700;
          s.rings.forEach((r, i) => {
            const n = r.length / 2;
            path(r, r, n, n);
            ctx.strokeStyle = `rgba(214,190,160,${0.22 + 0.5 * (i / s.rings.length) ** 2})`;
            ctx.stroke();
          });
          path(s.x, s.y, s.x.length);
          ctx.fillStyle = `hsl(${24 + s.tone * 16},${22 + s.tone * 12}%,${52 + s.tone * 14}%)`;
          ctx.fill();
        }
      },
    };
  },
};
