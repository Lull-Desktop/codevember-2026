// The person's way: they walk towards the eye, which goes back as fast as they come, swinging a little from side to side.
// The coast swings more: at one time the water is nearly at their feet, then it goes back and they are up on the dunes.
// Everything repeats with the loop.

export type Meta = {
  n: number;
  m: number;
  keys: number;
  dx: number;
  lo: number;
  hi: number;
  block: number;
  most: number;
  shift: number;
  x0: number;
  D: number;
  bay: number;
  shelf: number;
  slope: number;
  toe: number;
  rise: number;
};

const FRAMES = 2400;

export function createWalk(
  data: Uint16Array,
  meta: Meta,
  tall: () => number,
) {
  const { n, m, keys, dx, lo, hi, shift, x0, D } = meta;
  const wrap = (a: number, k: number) => ((a % k) + k) % k;
  const cell = (k: number, i: number, j: number) => {
    const past = Math.floor(k / keys);
    const a = Math.min(n - 1, Math.max(0, i));
    return (
      lo +
      ((hi - lo) / 65535) *
        data[wrap(k, keys) * n * m + a * m + wrap(j - past * shift, m)]
    );
  };
  // the height of the ground in the maps' place along the coast, at a moment of the loop
  const groundAt = (x: number, z: number, u: number) => {
    const a = (x - x0) / dx;
    const b = z / dx;
    const i = Math.floor(a);
    const j = Math.floor(b);
    const f = a - i;
    const g = b - j;
    const t = u * keys;
    const k = Math.floor(t);
    const s = t - k;
    const one = (q: number) =>
      (cell(q, i, j) * (1 - f) + cell(q, i + 1, j) * f) * (1 - g) +
      (cell(q, i, j + 1) * (1 - f) + cell(q, i + 1, j + 1) * f) * g;
    const h = one(k) * (1 - s) + one(k + 1) * s;
    const up = Math.max(h - 1, 0);
    return h + ((tall() - 1) * up * up) / (up + 2);
  };
  // the way: a slow swing from side to side, once a loop
  let way = { x: 0, swing: 0, when: 0 };
  let steps = new Float32Array(FRAMES + 1);
  let key = "";
  const at = (u: number) =>
    way.x + way.swing * Math.sin(2 * Math.PI * (u + way.when));
  const walkAt = (
    u: number,
    z: number,
    go: { x: number; swing: number; when: number },
    who: number,
    stride: number,
  ) => {
    const now = [z, go.x, go.swing, go.when, who, stride, tall()].join(" ");
    if (now !== key) {
      way = { ...go };
      // steps as long as the way they cover; a whole number of them in a loop
      steps = new Float32Array(FRAMES + 1);
      const high = (v: number) => groundAt(at(v), z + D * v, wrap(v, 1));
      for (let f = 0; f < FRAMES; f++) {
        const a = f / FRAMES;
        const b = (f + 1) / FRAMES;
        const by = Math.hypot(D / FRAMES, at(b) - at(a), high(b) - high(a));
        steps[f + 1] = steps[f] + by / (4 * stride * who);
      }
      const k = Math.round(steps[FRAMES]) / steps[FRAMES];
      for (let f = 0; f <= FRAMES; f++) steps[f] *= k * 2 * Math.PI;
      key = now;
    }
    const t = wrap(u, 1) * FRAMES;
    const i = Math.min(FRAMES - 1, Math.floor(t));
    const x = at(u);
    const aside = (at(u + 0.004) - at(u - 0.004)) / 0.008 / D;
    // they lean into a climb
    const ahead = groundAt(at(u + 0.03), z + D * (u + 0.03), u);
    const back = groundAt(at(u - 0.03), z + D * (u - 0.03), u);
    const climb = (ahead - back) / (0.06 * D);
    // how the ground lies under their feet
    const near = 0.3 * who;
    const turn = Math.atan(aside);
    const dx1 = Math.sin(turn) * near;
    const dz1 = Math.cos(turn) * near;
    const gz = z + D * u;
    const slope = (a: number, b: number) =>
      (groundAt(x + a, gz + b, u) - groundAt(x - a, gz - b, u)) / (2 * near);
    return {
      x,
      y: groundAt(x, z + D * u, u),
      step: steps[i] + (steps[i + 1] - steps[i]) * (t - i),
      turn,
      slope: slope(dx1, dz1),
      across: slope(-dz1, dx1),
      lean:
        0.13 +
        0.35 * Math.max(-0.2, Math.min(0.6, climb)) +
        0.04 * Math.sin(2 * Math.PI * u * 3),
    };
  };
  return { groundAt, walkAt, wayAt: at };
}
