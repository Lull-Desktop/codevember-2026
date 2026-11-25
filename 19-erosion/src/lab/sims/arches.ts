// Arches and pillars (Bruthans et al. 2014; Ostanin, Safonov & Oseledets 2017). Sandstone grains that carry
// load are locked against each other and hold; grains that carry none wash out. So wear takes the unloaded
// rock and stops at the surface where the stress has risen enough: what is left is the path the weight takes
// to the ground.
import { rng, type Def, type Sim } from "../util";

export const arches: Def = {
  id: "arches",
  title: "Arches by stress",
  paper: "Bruthans et al. 2014 · loaded sandstone resists erosion",
  note: "Bright rock carries the load and is locked; dull rock carries little and is washed out. A slab on top is the weight.",
  make(seed): Sim {
    const rnd = rng(seed + 11);
    const nx = 100;
    const ny = 72;
    const N = nx * ny;
    const solid = new Uint8Array(N); // 1 rock, 2 the slab on top, 3 the ground
    const tough = new Float32Array(N);
    const ux = new Float32Array(N);
    const uy = new Float32Array(N);
    const stress = new Float32Array(N);
    const TOP = 16;
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        tough[k] = 0.75 + 0.5 * rnd();
        if (j >= ny - 2) solid[k] = 3;
        else if (i >= 10 && i < nx - 10 && j >= TOP)
          solid[k] = j < TOP + 3 ? 2 : 1;
      }
    // a few weak spots where the wear can begin from within
    for (let c = 0; c < 4; c++) {
      const cx = 22 + rnd() * (nx - 44);
      const cy = ny - 4 - rnd() * 14;
      const r = 2.5 + rnd() * 2.5;
      for (let j = 0; j < ny - 2; j++)
        for (let i = 0; i < nx; i++)
          if ((i - cx) ** 2 + (j - cy) ** 2 < r * r && solid[j * nx + i] === 1)
            solid[j * nx + i] = 0;
    }
    const off = [-nx - 1, -nx, -nx + 1, -1, 1, nx - 1, nx, nx + 1];
    const dxs = [-1, 0, 1, -1, 1, -1, 0, 1].map(
      (v, k) => v / (k === 1 || k === 3 || k === 4 || k === 6 ? 1 : Math.SQRT2),
    );
    const dys = [-1, -1, -1, 0, 0, 1, 1, 1].map(
      (v, k) => v / (k === 1 || k === 3 || k === 4 || k === 6 ? 1 : Math.SQRT2),
    );
    const stiff = [0.5, 1, 0.5, 1, 1, 0.5, 1, 0.5];
    const weight = (k: number) => (solid[k] === 2 ? 14 : 1) * 0.002;

    // each cell is moved to where its neighbours' springs and its own weight balance, over and over
    const settle = (sweeps: number) => {
      for (let s = 0; s < sweeps; s++) {
        const up = s & 1;
        for (let q = 0; q < N; q++) {
          const k = up ? N - 1 - q : q;
          if (!solid[k] || solid[k] === 3) continue;
          const i = k % nx;
          let mxx = 1e-4;
          let mxy = 0;
          let myy = 1e-4;
          let rx = 0;
          let ry = weight(k);
          for (let b = 0; b < 8; b++) {
            if ((i === 0 && dxs[b] < 0) || (i === nx - 1 && dxs[b] > 0))
              continue;
            const o = k + off[b];
            if (!solid[o]) continue;
            const c = stiff[b];
            const along = dxs[b] * ux[o] + dys[b] * uy[o];
            mxx += c * dxs[b] * dxs[b];
            mxy += c * dxs[b] * dys[b];
            myy += c * dys[b] * dys[b];
            rx += c * dxs[b] * along;
            ry += c * dys[b] * along;
          }
          const det = mxx * myy - mxy * mxy;
          const tx = (myy * rx - mxy * ry) / det;
          const ty = (mxx * ry - mxy * rx) / det;
          ux[k] += 1.7 * (tx - ux[k]);
          uy[k] += 1.7 * (ty - uy[k]);
        }
      }
      for (let k = 0; k < N; k++) {
        stress[k] = 0;
        if (!solid[k]) continue;
        const i = k % nx;
        for (let b = 0; b < 8; b++) {
          if ((i === 0 && dxs[b] < 0) || (i === nx - 1 && dxs[b] > 0)) continue;
          const o = k + off[b];
          if (o < 0 || o >= N || !solid[o]) continue;
          const squeeze =
            -(dxs[b] * (ux[o] - ux[k]) + dys[b] * (uy[o] - uy[k])) * stiff[b];
          if (squeeze > 0) stress[k] += squeeze;
        }
      }
    };
    settle(900);
    // the stress the uncut wall carries half way up: wear stops where it has risen to some multiple of it
    let ref = 0;
    let cnt = 0;
    for (let i = 20; i < nx - 20; i++) {
      const k = Math.floor((TOP + ny) / 2) * nx + i;
      if (solid[k] === 1) ((ref += stress[k]), cnt++);
    }
    const LOCK = (ref / (cnt || 1)) * 2.6;
    let quiet = 0;
    let fell = false;
    const seen = new Uint8Array(N);
    const stack: number[] = [];

    return {
      step() {
        settle(44);
        let took = 0;
        for (let k = nx; k < N - nx; k++) {
          if (solid[k] !== 1) continue;
          const i = k % nx;
          const open =
            !solid[k - nx] ||
            !solid[k + nx] ||
            (i > 0 && !solid[k - 1]) ||
            (i < nx - 1 && !solid[k + 1]);
          if (!open) continue;
          const free = 1 - stress[k] / (LOCK * tough[k]);
          if (free > 0 && rnd() < 0.012 * free) {
            solid[k] = 0;
            ux[k] = uy[k] = 0;
            took++;
          }
        }
        // rock no longer joined to the ground falls away
        seen.fill(0);
        stack.length = 0;
        for (let i = 0; i < nx; i++) {
          seen[(ny - 1) * nx + i] = 1;
          stack.push((ny - 1) * nx + i);
        }
        while (stack.length) {
          const k = stack.pop()!;
          const i = k % nx;
          for (const o of [
            k - nx,
            k + nx,
            i > 0 ? k - 1 : -1,
            i < nx - 1 ? k + 1 : -1,
          ]) {
            if (o >= 0 && o < N && solid[o] && !seen[o])
              ((seen[o] = 1), stack.push(o));
          }
        }
        for (let k = 0; k < N; k++)
          if (solid[k] && !seen[k]) {
            if (solid[k] === 2) fell = true;
            solid[k] = 0;
            ux[k] = uy[k] = 0;
            took++;
          }
        quiet = took ? 0 : quiet + 1;
      },
      done: () => quiet > 80 || fell,
      draw(ctx, size) {
        const c = size / nx;
        const top = (size - ny * c) / 2;
        const g = ctx.createLinearGradient(0, 0, 0, size);
        g.addColorStop(0, "#c8d6dc");
        g.addColorStop(1, "#ece4d6");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, size, size);
        for (let k = 0; k < N; k++) {
          if (!solid[k]) continue;
          const t = Math.min(1.3, stress[k] / LOCK);
          if (solid[k] === 2) ctx.fillStyle = "#4a4039";
          else if (solid[k] === 3) ctx.fillStyle = "#8a7560";
          else
            ctx.fillStyle = `rgb(${88 + 128 * t},${66 + 92 * t},${54 + 40 * t})`;
          ctx.fillRect(
            (k % nx) * c,
            top + ((k / nx) | 0) * c,
            c + 0.6,
            c + 0.6,
          );
        }
        ctx.fillStyle = "#8a7560";
        ctx.fillRect(0, top + ny * c - 1, size, size);
      },
    };
  },
};
