"""Dunes as a continuum, after Kroy, Sauermann & Herrmann 2002 and Duran, Parteli & Herrmann 2010.

The wind blows along x. Over a hill its push on the sand is strongest a little before the top (worked out in Fourier
space); behind a crest the air comes loose from the ground and the sand lies in shelter. The sand in the air needs
some way to catch up with the wind. Where it grows the ground is worn, where it falls the ground is raised; slopes
steeper than sand can lie slide. The ground repeats in both directions.

x is the first index, y the second. Lengths in metres; time in units in which a saturated wind over flat sand
carries 1 square metre of sand past a line (a metre long) in a unit.
"""
import numpy as np
from numba import njit, prange
from scipy import fft


class Dunes:
    def __init__(self, h, dx, ls=2.0, A=4.0, B=2.5, tc=0.5, shelter=0.14, repose=0.62, side=0.12):
        self.h = h.astype(np.float32)
        self.dx = dx
        self.ls = ls        # how far sand needs to catch up with the wind
        self.A, self.B = A, B  # how much a slope speeds the wind up; and how far ahead of the top it does
        self.tc = tc        # the push below which no sand moves, against the push over flat ground
        self.shelter = shelter  # slope of the air's lower edge behind a crest
        self.repose = repose
        self.side = side    # how much sand on a cross slope is drawn down it
        n, m = h.shape
        kx = 2 * np.pi * np.fft.fftfreq(n, dx)[:, None]
        ky = 2 * np.pi * np.fft.rfftfreq(m, dx)[None, :]
        k = np.sqrt(kx**2 + ky**2)
        k[0, 0] = 1
        core = A * np.abs(kx) + 1j * B * kx
        # the finest waves are left out of the wind, which cannot feel them
        soft = np.exp(-((kx * dx * 1.2) ** 2) - (ky * 1.6) ** 2)
        self.fx = (np.abs(kx) / k * core * soft).astype(np.complex64)
        self.fy = (ky * np.sign(kx) / k * core * soft).astype(np.complex64)
        self.fx[0, 0] = self.fy[0, 0] = 0
        self.t = 0.0

    def step(self, dt, turn=0.0):
        h = self.h
        env = shelter(h, self.shelter * self.dx)
        env = smooth_side(env, h)
        H = fft.rfft2(env, workers=8)
        tx = fft.irfft2(H * self.fx, s=h.shape, workers=8)
        ty = fft.irfft2(H * self.fy, s=h.shape, workers=8)
        q, qy = flux(h, env, tx, ty, self.dx, self.ls, self.tc, self.side, turn, dt)
        move(h, q, qy, dt / self.dx)
        sag(h, q, self.side * 4.0 * dt / self.dx**2)
        for _ in range(18):
            if slide(h, self.repose * self.dx) < 0.002 * self.dx:
                break
        self.t += dt
        return q, env


@njit(parallel=True, fastmath=True, cache=True)
def shelter(h, fall):
    n, m = h.shape
    env = h.copy()
    block = 64
    for b in prange((m + block - 1) // block):
        lo, hi = b * block, min(m, (b + 1) * block)
        for i in range(2 * n):
            a = i % n
            p = (i - 1) % n
            for j in range(lo, hi):
                v = env[p, j] - fall
                if v > env[a, j]:
                    env[a, j] = v
    return env


# the shelter's roof is smooth across the wind
@njit(parallel=True, fastmath=True, cache=True)
def smooth_side(env, h):
    n, m = env.shape
    for _ in range(4):
        out = np.empty_like(env)
        for i in prange(n):
            for j in range(m):
                v = (env[i, (j - 2) % m] + 4 * env[i, (j - 1) % m] + 6 * env[i, j] + 4 * env[i, (j + 1) % m] + env[i, (j + 2) % m]) / 16
                out[i, j] = max(v, h[i, j])
        env = out
    return env


@njit(parallel=True, fastmath=True, cache=True)
def flux(h, env, tx, ty, dx, ls, tc, side, turn, dt):
    n, m = h.shape
    q = np.zeros_like(h)
    qy = np.zeros_like(h)
    k = dx / ls
    full = 1.0 - tc
    block = 64
    for b in prange((m + block - 1) // block):
        lo, hi = b * block, min(m, (b + 1) * block)
        for i in range(2 * n):
            a = i % n
            p = (i - 1) % n
            for j in range(lo, hi):
                t = 1.0 + tx[a, j]
                gap = env[a, j] - h[a, j]
                # in the shelter there is no wind to speak of
                t *= max(0.0, 1.0 - gap / 0.25)
                qs = 0.0
                if t > tc:
                    qs = t * np.sqrt(t) * (1.0 - tc / t) / full
                v = (q[p, j] + k * qs) / (1.0 + k)
                # no more can leave than there is
                most = q[p, j] + h[a, j] * dx / dt * 0.5
                q[a, j] = max(0.0, min(v, most))
    for i in prange(n):
        for j in range(m):
            t = 1.0 + tx[i, j]
            qy[i, j] = q[i, j] * (turn + 0.6 * min(max(ty[i, j] / max(t, 0.3), -0.6), 0.6))
    return q, qy


@njit(parallel=True, fastmath=True, cache=True)
def move(h, q, qy, r):
    n, m = h.shape
    for i in prange(n):
        p = (i - 1) % n
        for j in range(m):
            jn = (j + 1) % m
            jp = (j - 1) % m
            h[i, j] -= r * (q[i, j] - q[p, j] + 0.5 * (qy[i, jn] - qy[i, jp]))


# blown sand on a slope across the wind is drawn down it. Strong near the crests, so it is done in small goes.
@njit(parallel=True, fastmath=True, cache=True)
def sag(h, q, k):
    n, m = h.shape
    goes = 8
    for i in prange(n):
        f = np.empty(m, np.float32)
        for _ in range(goes):
            for j in range(m):
                d = min(0.5 * (q[i, j] + q[i, (j + 1) % m]) * k / goes, 0.24)
                f[j] = d * (h[i, (j + 1) % m] - h[i, j])
            for j in range(m):
                h[i, j] += f[j] - f[(j - 1) % m]


# one round of slides: each cell gives to lower neighbours what is too steep. Returns the steepest excess.
@njit(parallel=True, fastmath=True, cache=True)
def slide(h, most):
    n, m = h.shape
    fx = np.zeros_like(h)
    fy = np.zeros_like(h)
    worst = np.zeros(n, np.float32)
    for i in prange(n):
        ip = (i + 1) % n
        w = 0.0
        for j in range(m):
            jp = (j + 1) % m
            jm = (j - 1) % m
            im = (i - 1) % n
            gx = h[ip, j] - h[i, j]
            gyx = 0.25 * (h[i, jp] - h[i, jm] + h[ip, jp] - h[ip, jm])
            s = np.sqrt(gx * gx + gyx * gyx)
            if s > most:
                fx[i, j] = 0.22 * gx * (1.0 - most / s)
                w = max(w, s - most)
            gy = h[i, jp] - h[i, j]
            gxy = 0.25 * (h[ip, j] - h[im, j] + h[ip, jp] - h[im, jp])
            s = np.sqrt(gy * gy + gxy * gxy)
            if s > most:
                fy[i, j] = 0.22 * gy * (1.0 - most / s)
        worst[i] = w
    for i in prange(n):
        im = (i - 1) % n
        for j in range(m):
            jm = (j - 1) % m
            h[i, j] += fx[i, j] - fx[im, j] + fy[i, j] - fy[i, jm]
    return worst.max()


def picture(h, dx, path, sun=(-0.94, 0.0, 0.34), tile=1):
    from PIL import Image
    gx = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) / (2 * dx)
    gy = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) / (2 * dx)
    l = (-gx * sun[0] - gy * sun[1] + sun[2]) / np.sqrt(1 + gx**2 + gy**2)
    v = np.clip(l * 1.5, 0.05, 1)
    im = np.stack([v * 235 + 20, v * 190 + 22, v * 130 + 40], -1).clip(0, 255).astype(np.uint8)
    im = np.tile(im, (tile, 1, 1)).transpose(1, 0, 2)
    Image.fromarray(im).save(path)
