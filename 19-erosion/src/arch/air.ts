// The same air as air.wgsl, for the few places the page itself needs it: what is left of the sun's light where the
// arch stands, and the light of the sky from above and from the sides.
export type V3 = [number, number, number];
const GROUND = 6360;
const TOP = 6460;
const RAY: V3 = [5.802e-3, 13.558e-3, 33.1e-3];
const OZONE: V3 = [0.65e-3, 1.881e-3, 0.085e-3];
const MIE = 3.996e-3;
const DUST = 1.6;

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const thick = (h: number): V3 => [
  Math.exp(-h / 8),
  Math.exp(-h / 1.2),
  Math.max(0, 1 - Math.abs(h - 25) / 15),
];
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const left = (d: V3): V3 =>
  [0, 1, 2].map((k) =>
    Math.exp(-(RAY[k] * d[0] + MIE * 1.11 * DUST * d[1] + OZONE[k] * d[2])),
  ) as V3;
const toShell = (o: V3, d: V3, r: number) => {
  const b = dot(o, d);
  const q = b * b - dot(o, o) + r * r;
  return q < 0 ? -1 : -b + Math.sqrt(q);
};
const go = (o: V3, d: V3, t: number): V3 => [
  o[0] + d[0] * t,
  o[1] + d[1] * t,
  o[2] + d[2] * t,
];
const high = (p: V3) => Math.max(Math.hypot(...p) - GROUND, 0);

export function arrives(o: V3, l: V3): V3 {
  const b = dot(o, l);
  let clear = 1;
  if (b < 0)
    clear = smooth(
      GROUND - 12,
      GROUND + 4,
      Math.sqrt(Math.max(dot(o, o) - b * b, 0)),
    );
  if (clear <= 0) return [0, 0, 0];
  const far = toShell(o, l, TOP);
  const sum: V3 = [0, 0, 0];
  const n = 10;
  for (let i = 0; i < n; i++) {
    const s = (i + 0.5) / n;
    const k = thick(high(go(o, l, far * s * s)));
    for (let j = 0; j < 3; j++) sum[j] += (k[j] * far * 2 * s) / n;
  }
  return left(sum).map((v) => v * clear) as V3;
}
// the sun's light at some height in kilometres
export const sunlight = (l: V3, km: number) => arrives([0, GROUND + km, 0], l);

export function scatter(d: V3, l: V3): V3 {
  const o: V3 = [0, GROUND + 0.5, 0];
  const far = toShell(o, d, TOP);
  const m = dot(d, l);
  const ray = 0.0596831 * (1 + m * m);
  const g = 0.78;
  const mie =
    (0.1193662 * (1 - g * g) * (1 + m * m)) /
    ((2 + g * g) * (1 + g * g - 2 * g * m) ** 1.5);
  const depth: V3 = [0, 0, 0];
  const sum: V3 = [0, 0, 0];
  const n = 16;
  for (let i = 0; i < n; i++) {
    const s = (i + 0.5) / n;
    const w = (far * 2 * s) / n;
    const p = go(o, d, far * s * s);
    const k = thick(high(p));
    const before = left([
      depth[0] + k[0] * w * 0.5,
      depth[1] + k[1] * w * 0.5,
      depth[2] + k[2] * w * 0.5,
    ]);
    for (let j = 0; j < 3; j++) depth[j] += k[j] * w;
    const light = arrives(p, l);
    for (let j = 0; j < 3; j++) {
      const one = RAY[j] * k[0] * ray + MIE * DUST * k[1] * mie;
      const rest = (RAY[j] * k[0] + MIE * DUST * k[1]) * 0.035;
      sum[j] += (one + rest) * light[j] * before[j] * w;
    }
  }
  return sum;
}
