// The person's way: they walk into the wind, the dunes come at them. On the steep face of each they climb, are
// carried back with it, slip, and climb again; over the crest they win back on the long slope what they lost.
// Everything here repeats with the loop.

type Meta = {
  n: number;
  m: number;
  keys: number;
  dx: number;
  lo: number;
  hi: number;
};

export function createWalk(data: Uint16Array, meta: Meta, seconds: number) {
  const { n, m, keys, dx, lo, hi } = meta;
  const Lx = n * dx;
  const Ly = m * dx;
  const wrap = (a: number, k: number) => ((a % k) + k) % k;
  const cell = (k: number, i: number, j: number) =>
    lo +
    ((hi - lo) / 65535) *
      data[wrap(k, keys) * n * m + wrap(i, n) * m + wrap(j, m)];
  // the height of the ground at a place (x downwind, z towards the eye) at a moment of the loop
  const heightAt = (x: number, z: number, u: number) => {
    const a = wrap((x - u * Lx) / Lx, 1) * n - 0.5;
    const b = wrap(-z / Ly, 1) * m - 0.5;
    const i = Math.floor(a);
    const j = Math.floor(b);
    const f = a - i;
    const g = b - j;
    const t = wrap(u, 1) * keys;
    const k = Math.floor(t);
    const s = t - k;
    const one = (q: number) =>
      (cell(q, i, j) * (1 - f) + cell(q, i + 1, j) * f) * (1 - g) +
      (cell(q, i, j + 1) * (1 - f) + cell(q, i + 1, j + 1) * f) * g;
    const [p, v, c, d] = [one(k - 1), one(k), one(k + 1), one(k + 2)];
    return (
      v +
      0.5 *
        s *
        (c - p + s * (2 * p - 5 * v + 4 * c - d + s * (3 * (v - c) + d - p)))
    );
  };

  const FRAMES = 2400;
  type Walk = {
    x: Float32Array;
    slope: Float32Array;
    hard: Float32Array;
    step: Float32Array;
    stride: Float32Array;
  };
  // a running mean over a window, round the loop
  const even = (a: Float32Array, width: number) => {
    const out = new Float32Array(a.length);
    for (let i = 0; i < a.length; i++) {
      let s = 0;
      let w = 0;
      for (let d = -width; d <= width; d++) {
        const k = 0.5 + 0.5 * Math.cos((Math.PI * d) / (width + 1));
        s += a[wrap(i + d, a.length)] * k;
        w += k;
      }
      out[i] = s / w;
    }
    return out;
  };
  const make = (x0: number, z: number, who: number): Walk => {
    const dt = seconds / FRAMES;
    // where they are, sideways: pulled back to their place, carried along by a steep face
    const x = new Float32Array(FRAMES);
    let px = x0;
    const slopeAt = (xx: number, u: number) =>
      (heightAt(xx + 0.7, z, u) - heightAt(xx - 0.7, z, u)) / 1.4;
    // three laps, so that what is kept no longer knows where it started
    for (let lap = 0; lap < 3; lap++)
      for (let f = 0; f < FRAMES; f++) {
        const u = f / FRAMES;
        const s = slopeAt(px, u);
        const steep = Math.min(1, Math.max(0, (-s - 0.25) / 0.25));
        const speed = Lx / seconds;
        // now and then a foot gives way on the steep face
        const slip = steep * Math.max(0, Math.sin(u * 2 * Math.PI * 19)) ** 3;
        px += dt * (steep * speed * (0.42 + 0.5 * slip) - (px - x0) * 0.28);
        x[f] = px;
      }
    const sx = even(x, 8);
    const slope = new Float32Array(FRAMES);
    for (let f = 0; f < FRAMES; f++) slope[f] = slopeAt(sx[f], f / FRAMES);
    const calm = even(slope, 14);
    const hard = new Float32Array(FRAMES);
    for (let f = 0; f < FRAMES; f++)
      hard[f] = Math.min(1, Math.max(0, (-calm[f] - 0.12) / 0.38));
    const stride = new Float32Array(FRAMES);
    for (let f = 0; f < FRAMES; f++)
      stride[f] =
        0.23 - 0.09 * hard[f] + 0.05 * Math.min(1, Math.max(0, calm[f] * 4));
    // the sand goes by underfoot as the dunes do, less what they are carried along with it; each step covers just
    // what has gone by, so feet stay where they are put. A whole number of steps in a loop.
    const step = new Float32Array(FRAMES + 1);
    for (let f = 0; f < FRAMES; f++) {
      const carried = wrap(f + 1, FRAMES);
      const before = wrap(f - 1, FRAMES);
      const own = (sx[carried] - sx[before]) / (2 * dt);
      const by = Math.max(0.15, Lx / seconds - own);
      step[f + 1] = step[f] + (by * dt) / (4 * stride[f] * who);
    }
    const sum = step[FRAMES];
    const k = Math.round(sum) / sum;
    for (let f = 0; f <= FRAMES; f++) step[f] *= k * 2 * Math.PI;
    return { x: sx, slope: calm, hard, step, stride };
  };

  let made: Walk | null = null;
  let key = "";
  const walkAt = (
    u: number,
    x0: number,
    z: number,
    tall: number,
    who: number,
  ) => {
    const now = `${x0} ${z} ${who}`;
    if (now !== key || !made) {
      made = make(x0, z, who);
      key = now;
    }
    const w = made;
    const t = wrap(u, 1) * FRAMES;
    const i = Math.floor(t) % FRAMES;
    const j = (i + 1) % FRAMES;
    const f = t - Math.floor(t);
    const mix = (a: Float32Array) => a[i] * (1 - f) + a[j] * f;

    const x = mix(w.x);
    const hard = mix(w.hard);
    const slope = mix(w.slope) * tall;
    return {
      x,
      y: heightAt(x, z, u) * tall,
      step: w.step[i] * (1 - f) + w.step[i + 1] * f,
      // into the hill going up, back on the heels coming down, always into the wind
      lean: 0.17 + 0.3 * hard - 0.2 * Math.max(0, Math.min(1, slope * 3)),
      stride: mix(w.stride),
      // they face upwind, so ground that falls downwind rises ahead of them
      slope: -slope,
      hard,
    };
  };
  return { heightAt, walkAt };
}
