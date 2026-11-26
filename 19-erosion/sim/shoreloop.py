"""The shore's loop: python shoreloop.py <work folder> <out.bin> [name=value ...]

Runs laps of shore.py until one lap is like the one before (moved along by a bay), then keeps KEYS moments of the last,
and how far the sand's shapes move towards the sea from each moment to the next, so that moments between can be made by moving
the two nearest towards each other.
"""
import sys, time, json, numpy as np
from numba import njit, prange
from scipy import fft, ndimage
from shore import Shore, BASE
from dunes import picture

work, out = sys.argv[1], sys.argv[2]
opt = dict(a.split("=") for a in sys.argv[3:])
laps = int(opt.pop("laps", 16))
lean = int(opt.pop("lean", 9))  # the lap from which each leans on the one before
evens = int(opt.pop("even", 60))
KEYS = 64
conf = {**BASE, **dict(dx=0.6, n=704, m=800)}
for k, v in opt.items():
    conf[k] = type(conf[k])(float(v))
s = Shore(conf)
dx, n, m = conf["dx"], conf["n"], conf["m"]
steps = int(round(conf["T"] / (0.18 if dx < 1 else 0.3) / KEYS)) * KEYS
dt = conf["T"] / steps
shift = int(round(conf["D"] / dx))
t0 = time.time()
before = None
for lap in range(laps):
    keys = []
    for k in range(steps):
        if k % (steps // KEYS) == 0:
            i = len(keys)
            if before is not None and lap >= lean:
                # the last laps lean a little on the one before, which settles what is left
                s.h += 0.12 * (np.roll(before[i], shift, 1) - s.h)
            keys.append(s.h.copy())
        s.step(dt)
    if before is not None:
        g = [np.abs(np.roll(a, shift, 1) - b).mean() for a, b in zip(before, keys)]
        w = max(np.abs(np.roll(a, shift, 1) - b).max() for a, b in zip(before, keys))
        print(f"lap {lap}: {time.time()-t0:.0f}s top {(s.h-s.floor).max():.1f}, against the lap before: mean {np.mean(g):.4f}, worst {w:.2f}", flush=True)
    before = keys
keys = np.stack(keys)
# back into lap 0's place along the coast
keys = np.roll(keys, -shift * (laps - 1), 2)
np.save(f"{work}/coast_raw.npy", keys)


@njit(parallel=True, fastmath=True)
def even(h, broad, dx, goes):
    n, m = h.shape
    w = np.zeros_like(h)
    for i in prange(1, n - 1):
        for j in range(m):
            gx = (broad[i + 1, j] - broad[i - 1, j]) / (2 * dx)
            gy = abs(broad[i, (j + 1) % m] - broad[i, (j - 1) % m]) / (2 * dx)
            a = min(max((max(-gx, gy) - 0.08) / 0.26, 0.0), 1.0)
            w[i, j] = 1.0 - a * a * (3 - 2 * a)
    for _ in range(goes):
        fx = np.zeros_like(h)
        fy = np.zeros_like(h)
        for i in prange(n - 1):
            for j in range(m):
                b = (j + 1) % m
                fx[i, j] = 0.2 * min(w[i, j], w[i + 1, j]) * (h[i + 1, j] - h[i, j])
                fy[i, j] = 0.2 * min(w[i, j], w[i, b]) * (h[i, b] - h[i, j])
        for i in prange(1, n - 1):
            for j in range(m):
                h[i, j] += fx[i, j] - fx[i - 1, j] + fy[i, j] - fy[i, (j - 1) % m]


blur = lambda a, r: ndimage.gaussian_filter(a, r / dx, mode=("nearest", "wrap"))
for k in keys:
    even(k, blur(k, 1.1), dx, evens)
    k[:] = blur(k, 0.4)

# how far things move, in cells, between one moment and the next
B = 8
flow = np.zeros((KEYS, n // B, m // B), np.float32)
tries = np.arange(0, 17, 0.5)
for k in range(KEYS):
    a = keys[k]
    b = keys[k + 1] if k + 1 < KEYS else np.roll(keys[0], shift, 1)
    a, b = a - s.floor, b - s.floor
    cost = []
    for d in tries:
        e = ndimage.shift(a, (d / 2, 0), order=1, mode="nearest") - ndimage.shift(b, (-d / 2, 0), order=1, mode="nearest")
        c = ndimage.gaussian_filter(e * e, (9, 9), mode=("nearest", "wrap"))[B // 2 :: B, B // 2 :: B]
        cost.append(c + 2e-5 * d)
    cost = np.stack(cost)
    i = np.clip(cost.argmin(0), 1, len(tries) - 2)
    g = lambda q: np.take_along_axis(cost, q[None], 0)[0]
    p, q, r = g(i - 1), g(i), g(i + 1)
    off = np.clip((p - r) / (2 * (p - 2 * q + r) + 1e-9), -0.5, 0.5)
    flow[k] = (i + off) * 0.5
flow = np.stack([ndimage.gaussian_filter(ndimage.median_filter(f, 3, mode="nearest"), 1.0, mode=("nearest", "wrap")) for f in flow])
print(f"moves: {flow.min():.1f}..{flow.max():.1f} cells a moment, {time.time()-t0:.0f}s", flush=True)
# from the sea inland, as the page has it
keys, flow = keys[:, ::-1], flow[:, ::-1]
lo, hi = float(keys.min()), float(keys.max())
with open(out, "wb") as f:
    f.write(np.round((keys - lo) / (hi - lo) * 65535).astype("<u2").tobytes())
    f.write(np.round(np.clip(flow / 17 * 255, 0, 255)).astype("u1").tobytes())
json.dump(dict(n=n, m=m, keys=KEYS, dx=dx, lo=lo, hi=hi, block=B, most=17, shift=shift, **{k: conf[k] for k in ("x0", "D", "bay", "shelf", "slope", "toe", "rise", "tide", "runup")}), open(out.replace(".bin", ".json"), "w"))
for k in range(0, KEYS, 16):
    picture(np.roll(keys[k], -int(shift * k / KEYS), 1), dx, f"{work}/coast{k:02d}.png", sun=(-0.93, 0.2, 0.32))
