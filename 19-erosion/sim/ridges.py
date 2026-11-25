"""Ridges: python ridges.py <in.bin> <out.bin> [name=value ...]

The dunes of shoreloop.py have sharp edges but domed tops: behind the edge of the slip face the ground is nearly level for
some metres, and low light fades slowly over it. Here the taller ones are given a ridge. Behind the edge the ground is
lifted, more the nearer it is, so that it goes on climbing; and the slip face is carried on up, at its own slope, until the two meet.
"""
import sys, json, numpy as np
from multiprocessing import Pool
from scipy.ndimage import gaussian_filter, distance_transform_edt, zoom, map_coordinates, label, maximum, minimum

src, out = sys.argv[1], sys.argv[2]
# how much steeper the ground behind the edge gets; over how far, metres; how high the edges it starts with and is full at;
# how far inside its edge a face is taken to be true; how tall a face must be
opt = dict(steeper=0.30, over=24.0, low=3.5, full=9.5, inside=1.2, drop=2.5)
opt.update({k: float(v) for k, v in (a.split("=") for a in sys.argv[3:])})
meta = json.load(open(src.replace(".bin", ".json")))
n, m, K, dx = meta["n"], meta["m"], meta["keys"], meta["dx"]
lo, hi = meta["lo"], meta["hi"]
raw = np.fromfile(src, "u1")
size = K * n * m * 2
H = lo + (hi - lo) / 65535 * raw[:size].view("<u2").reshape(K, n, m).astype(np.float32)
Z, P = 3, 52  # worked out on cells a third as wide; cells put on at the sides, as the coast goes round


def ease(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def look(k):
    """the slip faces of a moment, on finer cells: what is well inside them, the nearest place of that, and how tall the face is"""
    w = np.pad(H[k], ((0, 0), (P, P)), mode="wrap")
    f = zoom(w, Z, order=3)
    e = dx / Z
    even = lambda a, r: gaussian_filter(a, r / e)
    gx, gz = np.gradient(even(f, 0.6), e)
    g = np.hypot(gx, gz)
    face = even((g > 0.42).astype(np.float32), 0.9) > 0.5
    # (at their edges the faces are already rounded)
    core = even(distance_transform_edt(face, sampling=e).astype(np.float32), 1.0) > opt["inside"]
    # small steep places are no slip faces
    which, many = label(core)
    if many:
        ids = np.arange(many + 1)
        drop = maximum(f, which, ids) - minimum(f, which, ids)
        drop[0] = 0
        core = drop[which] > opt["drop"]
        tall = ease(opt["drop"], opt["drop"] + 3.0, drop)[which]
    else:
        tall = np.zeros_like(f)
    far, (bi, bj) = distance_transform_edt(~core, sampling=e, return_indices=True)
    size1 = ease(opt["low"], opt["full"], even(f[bi, bj], 3.0)) * tall[bi, bj]
    return f, gx, gz, g, core, far, bi, bj, even(size1, 3.0), e, even


def coarse(a, f):
    """from the finer cells to the page's"""
    i, j = np.indices((n, m))
    return map_coordinates(a, [i * (f.shape[0] - 1) / (n - 1), (j + P) * (f.shape[1] - 1) / (m + 2 * P - 1)], order=1).astype(np.float32)


def strength(k):
    r = look(k)
    return coarse(r[8], r[0])


def ridge(job):
    k, size1 = job
    f, gx, gz, g, core, far, bi, bj, _, e, even = look(k)
    size1 = np.maximum(zoom(np.pad(size1, ((0, 0), (P, P)), mode="wrap"), Z, order=1), 0)
    ii, jj = np.indices(f.shape)
    ux, uz, un = gx[bi, bj], gz[bi, bj], g[bi, bj] + 1e-6
    # up the face from there, not down it or to its side
    up = even(ease(0.1, 0.6, ((ii - bi) * ux + (jj - bj) * uz) * e / un / np.maximum(far, e)), 1.2)
    d = np.maximum(far - opt["inside"], 0)
    lift = even(opt["steeper"] * opt["over"] / 3 * np.clip(1 - d / opt["over"], 0, 1) ** 3 * size1 * up, 0.3)
    back = f + lift
    front = even(f[bi, bj], 1.8) + even(np.clip(un, 0.55, 0.85), 3.0) * far
    r = np.where(far < 7, np.minimum(back, np.maximum(front, f)), back)
    r = np.where(core, f, np.maximum(r, f))
    return coarse(even(r, 0.22), f)


def settle(a):
    """evened over time, along the way the dunes go"""
    b = meta["block"]
    mv = raw[size:].reshape(K, n // b, m // b).astype(np.float32) / 255 * meta["most"]
    mv = np.stack([zoom(np.pad(q, 1, mode="wrap"), b, order=1)[b:-b, b:-b] for q in mv])
    i, j = np.indices((n, m))
    at = lambda k: np.roll(a[k % K], meta["shift"] * (k // K), 1)
    move = lambda k: np.roll(mv[k % K], meta["shift"] * (k // K), 1)
    out = []
    for k in range(K):
        # (index 0 is out at sea, where the dunes go to)
        before = map_coordinates(at(k - 1), [i + move(k - 1), j], order=1, mode="nearest")
        after = map_coordinates(at(k + 1), [i - move(k), j], order=1, mode="nearest")
        out.append(0.25 * before + 0.5 * a[k] + 0.25 * after)
    return np.stack(out)


if __name__ == "__main__":
    with Pool(6) as pool:
        size1 = np.stack(pool.map(strength, range(K), chunksize=1))
        for _ in range(4):
            size1 = settle(size1)
        A = np.stack(pool.map(ridge, list(enumerate(size1)), chunksize=1))
    print(f"added: most {(A - H).max():.2f} m, top {H.max():.1f} -> {A.max():.1f}")
    lo2, hi2 = float(A.min()), float(A.max())
    with open(out, "wb") as o:
        o.write(np.round((A - lo2) / (hi2 - lo2) * 65535).astype("<u2").tobytes())
        o.write(raw[size:].tobytes())
    json.dump({**meta, "lo": lo2, "hi": hi2}, open(out.replace(".bin", ".json"), "w"))
