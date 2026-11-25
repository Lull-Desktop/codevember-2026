"""Packs the dunes for the page: python pack.py <in.bin> <out.pack> [step=0.002]

Each moment is put through a wavelet (CDF 9/7, four sizes), which leaves next to nothing where the sand is smooth; what is
left is rounded to steps of some millimetres and zipped, a moment at a time, so that they can be unpacked side by side
(src/coast/unpack.ts). The moves between moments are kept as they are. out.json says where each part begins.
"""
import sys, json, gzip, numpy as np

src, out = sys.argv[1], sys.argv[2]
opt = dict(a.split("=") for a in sys.argv[3:])
step = float(opt.get("step", 0.002))
meta = json.load(open(src.replace(".bin", ".json")))
n, m, K, lo, hi = (meta[k] for k in ("n", "m", "keys", "lo", "hi"))
raw = np.fromfile(src, "u1")
size = K * n * m * 2
H = lo + (hi - lo) / 65535 * raw[:size].view("<u2").reshape(K, n, m).astype(np.float64)
L = 4
A, B, C, D, Z = -1.586134342, -0.05298011854, 0.8829110762, 0.4435068522, 1.149604398


def lift(x):
    """along the first direction: the smooth half, then the rough"""
    s, d = x[0::2].copy(), x[1::2].copy()
    before = lambda a: np.concatenate([a[:1], a[:-1]])
    after = lambda a: np.concatenate([a[1:], a[-1:]])
    d += A * (s + after(s))
    s += B * (before(d) + d)
    d += C * (s + after(s))
    s += D * (before(d) + d)
    return np.concatenate([s * Z, d / Z])


def forward(h):
    h = h.copy()
    for k in range(L):
        a, b = n >> k, m >> k
        h[:a, :b] = lift(lift(h[:a, :b].T).T)
    return h


def zig(v):
    return np.where(v < 0, -2 * v - 1, 2 * v).astype(np.uint32)


def part(h):
    """the coarsest part first, each place as what it adds to its neighbours; then the rough parts, from coarse to fine.
    A byte a place; what does not fit in one follows at the end, as three."""
    c = forward(h - lo)  # (from the lowest place, so that the first numbers are small)
    a, b = n >> L, m >> L
    q = np.round(c[:a, :b] / step).astype(np.int64)
    d = q.copy()
    d[1:] -= q[:-1]
    e = d.copy()
    e[:, 1:] -= d[:, :-1]
    parts = [e]
    for k in range(L)[::-1]:
        a, b = n >> k + 1, m >> k + 1
        for r in (c[:a, b : 2 * b], c[a : 2 * a, :b], c[a : 2 * a, b : 2 * b]):
            # (what is less than half a step and a bit is nothing)
            parts.append((np.sign(r) * np.floor(np.abs(r) / step + 0.42)).astype(np.int64))
    z = np.concatenate([zig(p).ravel() for p in parts])
    assert z.max() < 1 << 24
    over = z[z >= 255].astype("<u4").view("u1").reshape(-1, 4)[:, :3]
    return gzip.compress(np.minimum(z, 255).astype("u1").tobytes() + over.tobytes(), 9, mtime=0)


parts = [part(h) for h in H]
parts.append(gzip.compress(raw[size:].tobytes(), 9, mtime=0))
open(out, "wb").write(b"".join(parts))
json.dump({**meta, "step": step, "levels": L, "parts": [len(p) for p in parts]}, open(out.replace(".pack", ".json"), "w"))
print(f"{sum(map(len, parts)) / 1e6:.2f} MB, of it the moves {len(parts[-1]) / 1e6:.2f}; a moment {np.mean([len(p) for p in parts[:-1]]) / 1e3:.0f} KB")
