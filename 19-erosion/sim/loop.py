"""One lap of the dunes that ends as it began: python loop.py <work folder> <out.bin>

Two ridges are grown from a wandering start. Then the sand is held, loosely, to that shape moving downwind at the
speed it has by itself, while the wind veers to and fro a whole number of times a lap. The hold is weak enough that
slip faces, crests and small dunes do as they like, and strong enough that after a lap or two every lap is the same.
Writes the heights at KEYS moments of the lap, each in the frame that moves with the dunes.
"""
import sys, time, json, numpy as np
from scipy import fft
from dunes import Dunes, picture

work, out = sys.argv[1], sys.argv[2]
opt = dict(a.split("=") for a in sys.argv[3:])
seed = int(opt.get("seed", 21))
hold = float(opt.get("hold", 5))  # strength: how many times over a lap the hold would undo a difference
veer = float(opt.get("veer", 0.55))
cycles = int(opt.get("cycles", 2))
mean = float(opt.get("mean", 6.5))
wander = float(opt.get("wander", 20))
grow = int(opt.get("grow", 1500))
dx, n, m, KEYS, dt = 0.5, 512, 1536, 32, 0.18
Lx, Ly = n * dx, m * dx


# only the broad shape is held (over some 10 metres): crests and slip faces are the simulation's own
KX = 2 * np.pi * np.fft.fftfreq(n, dx)[:, None]
KY = 2 * np.pi * np.fft.rfftfreq(m, dx)[None, :]
BROAD = np.exp(-0.5 * (KX**2 + KY**2) * float(opt.get("broad", 11)) ** 2).astype(np.float32)


def pull(h, guideF, shift, k):
    gap = (guideF * np.exp(-1j * KX * shift * dx).astype(np.complex64) - fft.rfft2(h, workers=8)) * BROAD
    h += (k * fft.irfft2(gap, s=h.shape, workers=8)).astype(np.float32)


def start():
    rng = np.random.default_rng(seed)
    x = np.arange(n)[:, None] * dx
    y = np.arange(m)[None, :] * dx
    wave = lambda a, lo, hi: sum(
        rng.normal() * a / k**0.75 * np.sin(2 * np.pi * k * y / Ly + rng.uniform(0, 6.28)) for k in range(lo, hi)
    )
    both, one = wave(wander, 1, 8), wave(wander * 0.55, 1, 8)
    s = 2 * np.pi * x / Lx
    bend = both + one * np.sin(s)  # the two ridges wander alike, but not quite
    h = mean + 3.2 * np.sin(2 * s + bend * 2 * np.pi / (Lx / 2)) * (1 + 0.25 * np.sin(s + 2 * np.pi * 2 * y / Ly))
    return np.maximum(h + rng.normal(size=h.shape) * 0.02, 0.05)


t0 = time.time()
d = Dunes(start(), dx)
for k in range(grow):
    d.step(dt, veer * 0.6 * np.sin(2 * np.pi * d.t / 90))
guide = d.h.copy()
picture(guide, dx, f"{work}/guide.png", tile=2, sun=(-0.95, 0, 0.3))
# how fast it goes by itself
a = guide.copy()
t = d.t
for k in range(400):
    d.step(dt, veer * 0.6 * np.sin(2 * np.pi * d.t / 90))
F = np.fft.fft(a - a.mean(0), axis=0).conj() * np.fft.fft(d.h - d.h.mean(0), axis=0)
c = np.fft.ifft(F.sum(1)).real
i = int(np.argmax(c[: n // 2]))
p = (c[i - 1] - c[i + 1]) / (2 * (c[i - 1] - 2 * c[i] + c[i + 1]))
speed = (i + p) * dx / (d.t - t)
steps = int(round(Lx / speed / dt / KEYS)) * KEYS
print(f"grown in {time.time()-t0:.0f}s, heights {guide.min():.1f}..{guide.max():.1f}, speed {speed:.3f}, a lap is {steps} steps", flush=True)

guideF = fft.rfft2(guide, workers=8)
d.h = guide.copy()
T = steps * dt
keys, before = None, None
for lap in range(int(opt.get("laps", 3))):
    keys = []
    for k in range(steps):
        if k % (steps // KEYS) == 0:
            keys.append(np.roll(d.h, -(n // KEYS) * (k // (steps // KEYS)), 0).copy())
        u = k / steps
        d.step(dt, veer * np.sin(2 * np.pi * cycles * u))
        pull(d.h, guideF, n * (k + 1) / steps, hold / steps)
    gap = np.abs(d.h - keys[0])
    off = np.mean([np.abs(a - guide).mean() for a in keys])
    print(f"lap {lap}: {time.time()-t0:.0f}s, end against start {gap.mean():.4f} (most {gap.max():.2f}), off the guide {off:.3f}, heights {d.h.min():.1f}..{d.h.max():.1f}", flush=True)


# the long slopes made even, without touching the steep faces or rounding the edge between: each place evens out with
# its neighbours by as much as neither is steep. (A shelf a few centimetres high before each crest shows under a low
# sun.) What is steep is judged once, softly, or the edge comes out ragged.
@njit(parallel=True, fastmath=True)
def even(h, broad, dx, goes):
    n, m = h.shape
    w = np.zeros_like(h)
    for i in prange(n):
        for j in range(m):
            gx = (broad[(i + 1) % n, j] - broad[(i - 1) % n, j]) / (2 * dx)
            gy = abs(broad[i, (j + 1) % m] - broad[i, (j - 1) % m]) / (2 * dx)
            s = (max(-gx, gy) - 0.08) / 0.26
            s = min(max(s, 0.0), 1.0)
            w[i, j] = 1.0 - s * s * (3 - 2 * s)
    for _ in range(goes):
        fx = np.zeros_like(h)
        fy = np.zeros_like(h)
        for i in prange(n):
            for j in range(m):
                a = (i + 1) % n
                b = (j + 1) % m
                fx[i, j] = 0.2 * min(w[i, j], w[a, j]) * (h[a, j] - h[i, j])
                fy[i, j] = 0.2 * min(w[i, j], w[i, b]) * (h[i, b] - h[i, j])
        for i in prange(n):
            for j in range(m):
                h[i, j] += fx[i, j] - fx[(i - 1) % n, j] + fy[i, j] - fy[i, (j - 1) % m]


keys = np.stack(keys)
np.save(f"{work}/raw.npy", keys.astype(np.float32))
for k in keys:
    soft = np.exp(-0.5 * (KX**2 + KY**2) * 1.1**2)  # judged on the shape without its finest wrinkles
    even(k, fft.irfft2(fft.rfft2(k) * soft, s=k.shape).astype(k.dtype), dx, int(opt.get("even", 130)))
    k[:] = fft.irfft2(fft.rfft2(k) * np.exp(-0.5 * (KX**2 + KY**2) * 0.42**2), s=k.shape)  # and the edge's stairs
np.save(f"{work}/keys.npy", keys.astype(np.float32))
for k in (0, KEYS // 4, KEYS // 2, 3 * KEYS // 4):
    picture(keys[k], dx, f"{work}/key{k:02d}.png", tile=2, sun=(-0.95, 0, 0.3))
lo, hi = float(keys.min()), float(keys.max())
raw = np.round((keys - lo) / (hi - lo) * 65535).astype("<u2")
raw.tofile(out)
json.dump(dict(n=n, m=m, keys=KEYS, dx=dx, lo=lo, hi=hi), open(out.replace(".bin", ".json"), "w"))
print("saved", raw.nbytes / 1e6, "MB", flush=True)
