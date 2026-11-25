// The wandering river: the line of lab/sims/river.ts (Ikeda, Parker & Sawai 1981; Howard & Knutson 1984),
// copied here to change two things. There the valley's sides only slow the river down, and it roams over
// most of the block; here the outer part of the belt leans back toward the middle, so the river keeps to a
// belt of a set width and leaves the mountains on either side alone. (Stopping it dead at the sides was
// tried first: it then lies down along one side, straight, and never bends again.) And how far upstream the
// curve is felt can be set: shorter gives tighter bends, more of them, cut off more often.
//
// The bank is cut at a rate set by how the channel curves, here and for some way upstream. The channel's
// points are 1 apart.
import { rng } from "../lab/util";

export type Loop = { x: number[]; y: number[] };
export type MeanderOpts = {
  from: number; // where the channel starts and ends along the valley
  to: number;
  mid: number; // the valley's middle line, and how far to each side the river may go
  reach: number;
  held?: number; // how far in from each end the banks are kept from moving
  lag?: number; // how far upstream the curve is felt: bends come out about 8 times this long
};

export function makeMeander(seed: number, o: MeanderOpts) {
  const rnd = rng(seed + 21);
  const held = o.held ?? 30;
  const r = {
    x: [] as number[],
    y: [] as number[],
    time: 0,
    cut: [] as Loop[], // loops cut off this step
    step,
  };
  for (let s = o.from; s <= o.to; s++) {
    r.x.push(s);
    r.y.push(
      o.mid +
        (rnd() - 0.5) * 0.6 +
        2.5 * Math.sin(s * 0.11 + seed) +
        2 * Math.sin(s * 0.047 + seed * 2.3),
    );
  }

  // the points put back 1 apart along the line
  const spread = () => {
    const { x, y } = r;
    const nx = [x[0]];
    const ny = [y[0]];
    let need = 1;
    for (let i = 1; i < x.length; i++) {
      let ax = x[i - 1];
      let ay = y[i - 1];
      let seg = Math.hypot(x[i] - ax, y[i] - ay);
      while (seg >= need) {
        const t = need / seg;
        ax += (x[i] - ax) * t;
        ay += (y[i] - ay) * t;
        nx.push(ax);
        ny.push(ay);
        seg -= need;
        need = 1;
      }
      need -= seg;
    }
    // the far end stays where it is
    if (need < 0.5) (nx.pop(), ny.pop());
    nx.push(x[x.length - 1]);
    ny.push(y[y.length - 1]);
    r.x = nx;
    r.y = ny;
  };

  function step() {
    r.time++;
    r.cut = [];
    const { x, y } = r;
    const n = x.length;
    const curve = new Float32Array(n);
    for (let i = 1; i < n - 1; i++) {
      const a = Math.atan2(y[i] - y[i - 1], x[i] - x[i - 1]);
      const b = Math.atan2(y[i + 1] - y[i], x[i + 1] - x[i]);
      let d = b - a;
      if (d > Math.PI) d -= 2 * Math.PI;
      if (d < -Math.PI) d += 2 * Math.PI;
      curve[i] = d;
    }
    const raw = curve.slice();
    for (let i = 1; i < n - 1; i++)
      curve[i] = (raw[i - 1] + 2 * raw[i] + raw[i + 1]) / 4;
    // the cut at each point: against the curve here, with the curve upstream (weighted, fading with distance)
    let sum = 0;
    let norm = 0;
    const fade = Math.exp(-1 / (o.lag ?? 7));
    const nx = new Array<number>(n);
    const ny = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      sum = sum * fade + curve[i];
      norm = norm * fade + 1;
      const rate = -curve[i] + 2.5 * (sum / norm);
      const a = Math.max(0, i - 1);
      const b = Math.min(n - 1, i + 1);
      const tx = x[b] - x[a];
      const ty = y[b] - y[a];
      const tl = Math.hypot(tx, ty) || 1;
      const hold = Math.min(1, i / held, (n - 1 - i) / held); // the ends are held
      const move = 0.3 * rate * hold; // (more than 0.5 of the local term would shake the line apart)
      let my = -(tx / tl) * move;
      // the valley's sides: in the outer part of the belt the ground leans back toward the middle, more and
      // more, to 0.08 a step at the side itself, which is about as fast as a bend grows (measured, the
      // river strays a tenth or so past `reach`)
      const off = y[i] - o.mid;
      const out = Math.max(0, (Math.abs(off) / o.reach - 0.4) / 0.6);
      my -= Math.sign(off) * 0.08 * out * out * hold;
      nx[i] = x[i] + (ty / tl) * move;
      ny[i] = y[i] + my + (rnd() - 0.5) * 0.004;
    }
    r.x = nx;
    r.y = ny;
    spread();
    // two reaches that touch: the loop between them is cut off
    if (r.time % 2 === 0) {
      for (let i = 0; i < r.x.length - 12; i++) {
        for (let j = Math.min(r.x.length - 1, i + 400); j > i + 10; j--) {
          const dx = r.x[j] - r.x[i];
          if (dx > 2.4 || dx < -2.4) continue;
          const dy = r.y[j] - r.y[i];
          if (dx * dx + dy * dy < 5.3) {
            r.cut.push({ x: r.x.slice(i, j + 1), y: r.y.slice(i, j + 1) });
            r.x.splice(i + 1, j - i - 1);
            r.y.splice(i + 1, j - i - 1);
            break;
          }
        }
      }
    }
  }
  return r;
}
