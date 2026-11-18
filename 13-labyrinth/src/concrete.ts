// One tiling sheet of noise that all the concrete is read from, made once on the CPU so that it has mips
// (noise worked out per pixel shimmers on walls seen from far off).
//   r: broad mottling   g: fine grain   b: cracks (1 on a crack)   a: runs, stretched along v, for what rain leaves on a wall
import { DataTexture, LinearFilter, LinearMipmapLinearFilter, RepeatWrapping, RGBAFormat, UnsignedByteType } from "three/webgpu";

const hash = (x: number, y: number, s: number) => {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(s, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const wrap = (a: number, n: number) => ((a % n) + n) % n;

// value noise that repeats every (px, py) lattice cells
const noise = (x: number, y: number, px: number, py: number, s: number) => {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const a = hash(wrap(xi, px), wrap(yi, py), s);
  const b = hash(wrap(xi + 1, px), wrap(yi, py), s);
  const c = hash(wrap(xi, px), wrap(yi + 1, py), s);
  const d = hash(wrap(xi + 1, px), wrap(yi + 1, py), s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
};
const fbm = (x: number, y: number, px: number, py: number, octaves: number, s: number) => {
  let sum = 0;
  let amp = 0.5;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise(x * px, y * py, px, py, s + o);
    total += amp;
    amp *= 0.5;
    px *= 2;
    py *= 2;
  }
  return sum / total;
};

// distance between the two nearest points of a repeating scatter: small along the borders of its cells
const borders = (x: number, y: number, n: number, s: number) => {
  const xi = Math.floor(x * n);
  const yi = Math.floor(y * n);
  let f1 = 9;
  let f2 = 9;
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const cx = xi + dx;
      const cy = yi + dy;
      const px = cx + hash(wrap(cx, n), wrap(cy, n), s);
      const py = cy + hash(wrap(cx, n), wrap(cy, n), s + 7);
      const d = Math.hypot(px - x * n, py - y * n);
      if (d < f1) ((f2 = f1), (f1 = d));
      else if (d < f2) f2 = d;
    }
  return f2 - f1;
};

export function concrete(size = 512) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const at = (y * size + x) * 4;
      const broad = fbm(u, v, 4, 4, 6, 1);
      const grain = fbm(u, v, 64, 64, 3, 20);
      // cracks wander: read the scatter through a warp, and keep only some of its borders
      const wu = u + 0.035 * (fbm(u, v, 8, 8, 4, 40) - 0.5);
      const wv = v + 0.035 * (fbm(u, v, 8, 8, 4, 50) - 0.5);
      const edge = borders(wu, wv, 5, 60);
      const keep = fbm(u, v, 3, 3, 3, 70);
      const fine = borders(wu * 1.0 + 0.31, wv + 0.17, 13, 80);
      const crack = Math.max((1 - Math.min(1, edge / 0.022)) * Math.min(1, Math.max(0, (keep - 0.5) * 8)), 0.5 * (1 - Math.min(1, fine / 0.04)) * Math.min(1, Math.max(0, (0.4 - keep) * 8)));
      const runs = fbm(u, v, 48, 3, 4, 90);
      data[at] = 255 * broad;
      data[at + 1] = 255 * grain;
      data[at + 2] = 255 * crack;
      data[at + 3] = 255 * runs;
    }
  const texture = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}
