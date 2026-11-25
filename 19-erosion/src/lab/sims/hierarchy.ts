// Cracks that divide what earlier cracks left (Bohn, Pauchard, Couder 2005): each new crack leaves an old one
// square to it and runs across one cell to the far side, so every cell is cut in two, then its halves, and on.
// The pattern at any depth looks like the pattern above it.
import { rng, type Def, type Sim } from "../util";

type P = [number, number];
type Cut = { a: P; b: P; level: number; from: number; len: number };

export const hierarchy: Def = {
  id: "hierarchy",
  title: "Hierarchical division",
  paper: "Bohn, Pauchard & Couder 2005 · successive domain divisions",
  note: "Each crack halves one cell and stops at its walls. Old cracks are wide, young ones hairlines.",
  make(seed): Sim {
    const rnd = rng(seed + 40);
    const cuts: Cut[] = [];
    const area = (p: P[]) => {
      let s = 0;
      for (let i = 0; i < p.length; i++) {
        const q = p[(i + 1) % p.length];
        s += p[i][0] * q[1] - q[0] * p[i][1];
      }
      return Math.abs(s) / 2;
    };
    // cells are cut level by level; a crack starts when the one it leaves from has passed its foot
    const divide = (poly: P[], level: number, from: number) => {
      if (level > 9 || area(poly) < 0.0012 || (level > 3 && rnd() < 0.08))
        return;
      let best = 0;
      let longest = 0;
      for (let i = 0; i < poly.length; i++) {
        const q = poly[(i + 1) % poly.length];
        const l = Math.hypot(q[0] - poly[i][0], q[1] - poly[i][1]);
        if (l > longest) ((longest = l), (best = i));
      }
      const p0 = poly[best];
      const p1 = poly[(best + 1) % poly.length];
      const t = 0.5 + (rnd() - 0.5) * 0.36;
      const a: P = [p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t];
      const turn = (rnd() - 0.5) * 0.4;
      const ex = (p1[0] - p0[0]) / longest;
      const ey = (p1[1] - p0[1]) / longest;
      // square to the edge, a little off, pointing into the cell
      let dx = -ey * Math.cos(turn) + ex * Math.sin(turn);
      let dy = ex * Math.cos(turn) + ey * Math.sin(turn);
      const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length - a[0];
      const cy = poly.reduce((s, p) => s + p[1], 0) / poly.length - a[1];
      if (dx * cx + dy * cy < 0) ((dx = -dx), (dy = -dy));
      let hit = -1;
      let far = Infinity;
      for (let i = 0; i < poly.length; i++) {
        if (i === best) continue;
        const q0 = poly[i];
        const q1 = poly[(i + 1) % poly.length];
        const sx = q1[0] - q0[0];
        const sy = q1[1] - q0[1];
        const det = dx * sy - dy * sx;
        if (Math.abs(det) < 1e-12) continue;
        const u = ((q0[0] - a[0]) * sy - (q0[1] - a[1]) * sx) / det;
        const v = ((q0[0] - a[0]) * dy - (q0[1] - a[1]) * dx) / det;
        if (u > 1e-9 && v >= 0 && v <= 1 && u < far) ((far = u), (hit = i));
      }
      if (hit < 0) return;
      const b: P = [a[0] + dx * far, a[1] + dy * far];
      const wait = (0.25 + rnd() * 0.9) * (0.4 + far * 2.2);
      const cut: Cut = { a, b, level, from: from + wait, len: far };
      cuts.push(cut);
      // the two halves, walking the cell's rim from the cut's foot to its far end and back
      const one: P[] = [a];
      for (let i = (best + 1) % poly.length; ; i = (i + 1) % poly.length) {
        one.push(poly[i]);
        if (i === hit) break;
      }
      one.push(b);
      const two: P[] = [b];
      for (let i = (hit + 1) % poly.length; ; i = (i + 1) % poly.length) {
        two.push(poly[i]);
        if (i === best) break;
      }
      two.push(a);
      const end = cut.from + far / SPEED;
      divide(one, level + 1, end);
      divide(two, level + 1, end);
    };
    const SPEED = 0.55; // of a crack's tip, in widths of the picture a time unit
    divide(
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ],
      0,
      0,
    );
    const last = Math.max(...cuts.map((c) => c.from + c.len / SPEED));
    let time = 0;
    return {
      step() {
        time += 0.035;
      },
      done: () => time > last + 0.3,
      draw(ctx, size) {
        ctx.fillStyle = "#d9cdbb";
        ctx.fillRect(0, 0, size, size);
        ctx.strokeStyle = "#2b221c";
        ctx.lineCap = "round";
        for (const c of cuts) {
          const age = time - c.from;
          if (age <= 0) continue;
          const k = Math.min(1, (age * SPEED) / c.len);
          // a crack goes on widening after it is through
          ctx.lineWidth =
            (size / 560) *
            Math.max(
              0.5,
              5.5 * 0.7 ** c.level * Math.min(1, 0.25 + age * 0.35),
            );
          ctx.beginPath();
          ctx.moveTo(c.a[0] * size, c.a[1] * size);
          ctx.lineTo(
            (c.a[0] + (c.b[0] - c.a[0]) * k) * size,
            (c.a[1] + (c.b[1] - c.a[1]) * k) * size,
          );
          ctx.stroke();
        }
      },
    };
  },
};
