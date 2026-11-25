// The wandering river itself, shared by the pictures made of it (Ikeda, Parker & Sawai 1981; Howard & Knutson
// 1984). The bank is cut at a rate set by how the channel curves, not just here but for some way upstream, the
// nearer the more. That makes bends grow and creep downvalley, lean over, and at last touch: the loop is cut
// off. The channel is 2 wide and its points 1 apart.
import { rng } from "../util";

export type Loop = { x: number[]; y: number[]; age: number };
export type RiverOpts = {
  from: number; // where the channel starts and ends along the valley
  to: number;
  mid: number; // the valley's middle line, and how far to each side the river may go
  reach: number;
  held?: number; // how far in from each end the banks are kept from moving
};

export function makeRiver(seed: number, o: RiverOpts) {
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
    const fade = Math.exp(-1 / 7);
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
      // the ends are held, and the valley's sides turn the river back
      const hold = Math.min(1, i / held, (n - 1 - i) / held);
      const wall = Math.abs(y[i] - o.mid) > o.reach ? 0.2 : 1;
      const move = 0.3 * rate * hold * wall; // (more than 0.5 of the local term would shake the line apart)
      nx[i] = x[i] + (ty / tl) * move;
      ny[i] = y[i] - (tx / tl) * move + (rnd() - 0.5) * 0.004;
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
            r.cut.push({
              x: r.x.slice(i, j + 1),
              y: r.y.slice(i, j + 1),
              age: 0,
            });
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
