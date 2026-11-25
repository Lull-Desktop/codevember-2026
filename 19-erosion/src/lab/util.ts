// What the model sketches share: a seeded random number, and a small picture drawn cell by cell.

export function rng(seed: number) {
  let s = (seed * 2654435761) >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Sim = {
  step(): void;
  draw(ctx: CanvasRenderingContext2D, size: number): void;
  done?(): boolean;
};
export type Def = {
  id: string;
  title: string;
  paper: string;
  note: string;
  steps?: number; // steps a frame
  make(seed: number): Sim;
};

// a picture of n by m cells, stretched over the tile
export class Raster {
  canvas = document.createElement("canvas");
  ctx: CanvasRenderingContext2D;
  image: ImageData;
  px: Uint8ClampedArray;
  constructor(
    public n: number,
    public m: number,
  ) {
    this.canvas.width = n;
    this.canvas.height = m;
    this.ctx = this.canvas.getContext("2d")!;
    this.image = this.ctx.createImageData(n, m);
    this.px = this.image.data;
    this.px.fill(255);
  }
  set(i: number, r: number, g: number, b: number) {
    const p = i * 4;
    this.px[p] = r;
    this.px[p + 1] = g;
    this.px[p + 2] = b;
  }
  put(ctx: CanvasRenderingContext2D, size: number, smooth = true) {
    this.ctx.putImageData(this.image, 0, 0);
    ctx.imageSmoothingEnabled = smooth;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(this.canvas, 0, 0, size, size);
  }
}

// how lit each cell of a height field is, by a low sun from the upper left: about 0..1.4
export function relief(
  h: ArrayLike<number>,
  n: number,
  m: number,
  i: number,
  j: number,
  steep: number,
  wrap = false,
) {
  const at = (x: number, y: number) => {
    if (wrap) return h[((y + m) % m) * n + ((x + n) % n)];
    return h[
      Math.min(m - 1, Math.max(0, y)) * n + Math.min(n - 1, Math.max(0, x))
    ];
  };
  const dx = (at(i + 1, j) - at(i - 1, j)) * steep;
  const dy = (at(i, j + 1) - at(i, j - 1)) * steep;
  const l = (-dx * -0.6 + -dy * -0.6 + 0.55) / Math.sqrt(dx * dx + dy * dy + 1);
  return Math.max(0, l) / 0.55;
}
