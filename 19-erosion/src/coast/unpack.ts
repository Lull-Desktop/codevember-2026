// Unpacks moments of the dunes (sim/pack.py), in a worker: each is unzipped, its numbers put back in their places, and the
// wavelet run backwards. Heights come out as 16 bits between the lowest and the highest, as the rest of the page has them.

export type Job = {
  part: ArrayBuffer;
  k: number;
  n: number;
  m: number;
  levels: number;
  step: number;
  lo: number;
  hi: number;
};

const A = -1.586134342;
const B = -0.05298011854;
const C = 0.8829110762;
const D = 0.4435068522;
const Z = 1.149604398;

export const unzip = async (part: ArrayBuffer) =>
  new Uint8Array(
    await new Response(
      new Blob([part]).stream().pipeThrough(new DecompressionStream("gzip")),
    ).arrayBuffer(),
  );

// one size of the wavelet, backwards, on the first h rows and w columns
const back = (a: Float32Array, M: number, h: number, w: number) => {
  const hh = h >> 1;
  const hw = w >> 1;
  // down the columns, a whole row at a time
  const s = new Float32Array(hh * w);
  const d = new Float32Array(hh * w);
  for (let r = 0; r < hh; r++)
    for (let c = 0; c < w; c++) {
      s[r * w + c] = a[r * M + c] / Z;
      d[r * w + c] = a[(r + hh) * M + c] * Z;
    }
  const less = (
    x: Float32Array,
    y: Float32Array,
    f: number,
    other: (r: number) => number,
  ) => {
    for (let r = 0; r < hh; r++) {
      const o = r * w;
      const q = other(r) * w;
      for (let c = 0; c < w; c++) x[o + c] -= f * (y[o + c] + y[q + c]);
    }
  };
  const before = (r: number) => (r ? r - 1 : 0);
  const after = (r: number) => (r < hh - 1 ? r + 1 : r);
  less(s, d, D, before);
  less(d, s, C, after);
  less(s, d, B, before);
  less(d, s, A, after);
  for (let r = 0; r < hh; r++) {
    a.set(s.subarray(r * w, r * w + w), 2 * r * M);
    a.set(d.subarray(r * w, r * w + w), (2 * r + 1) * M);
  }
  // and along the rows
  const p = new Float32Array(hw);
  const q = new Float32Array(hw);
  for (let r = 0; r < h; r++) {
    const o = r * M;
    for (let c = 0; c < hw; c++) {
      p[c] = a[o + c] / Z;
      q[c] = a[o + hw + c] * Z;
    }
    p[0] -= D * 2 * q[0];
    for (let c = 1; c < hw; c++) p[c] -= D * (q[c - 1] + q[c]);
    for (let c = 0; c < hw - 1; c++) q[c] -= C * (p[c] + p[c + 1]);
    q[hw - 1] -= C * 2 * p[hw - 1];
    p[0] -= B * 2 * q[0];
    for (let c = 1; c < hw; c++) p[c] -= B * (q[c - 1] + q[c]);
    for (let c = 0; c < hw - 1; c++) q[c] -= A * (p[c] + p[c + 1]);
    q[hw - 1] -= A * 2 * p[hw - 1];
    for (let c = 0; c < hw; c++) {
      a[o + 2 * c] = p[c];
      a[o + 2 * c + 1] = q[c];
    }
  }
};

export const unpack = async ({ part, n, m, levels, step, lo, hi }: Job) => {
  const bytes = await unzip(part);
  const many = n * m;
  // what did not fit in a byte is kept after them
  let more = many;
  const next = (at: number) => {
    let z = bytes[at];
    if (z === 255) {
      z = bytes[more] | (bytes[more + 1] << 8) | (bytes[more + 2] << 16);
      more += 3;
    }
    return (z >>> 1) ^ -(z & 1);
  };
  const a = new Float32Array(many);
  let at = 0;
  const h0 = n >> levels;
  const w0 = m >> levels;
  const whole = new Int32Array(h0 * w0);
  for (let r = 0; r < h0; r++) {
    let run = 0;
    for (let c = 0; c < w0; c++) {
      run += next(at++);
      whole[r * w0 + c] = run + (r ? whole[(r - 1) * w0 + c] : 0);
      a[r * m + c] = whole[r * w0 + c] * step;
    }
  }
  for (let k = levels - 1; k >= 0; k--) {
    const h = n >> (k + 1);
    const w = m >> (k + 1);
    for (const [top, left] of [
      [0, w],
      [h, 0],
      [h, w],
    ])
      for (let r = 0; r < h; r++)
        for (let c = 0; c < w; c++)
          a[(top + r) * m + left + c] = next(at++) * step;
  }
  for (let k = levels - 1; k >= 0; k--) back(a, m, n >> k, m >> k);
  const out = new Uint16Array(many);
  const scale = 65535 / (hi - lo);
  for (let i = 0; i < many; i++)
    out[i] = Math.min(65535, Math.max(0, Math.round(a[i] * scale)));
  return out;
};

if (typeof document === "undefined" && typeof self !== "undefined")
  self.onmessage = async ({ data }: MessageEvent<Job>) => {
    try {
      const out = await unpack(data);
      (self as unknown as Worker).postMessage({ k: data.k, out }, [out.buffer]);
    } catch (e) {
      (self as unknown as Worker).postMessage({ k: data.k, error: String(e) });
    }
  };
