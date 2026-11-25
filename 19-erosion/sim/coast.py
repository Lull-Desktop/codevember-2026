"""Dunes born on a beach: the model of dunes.py with a sea at one side, where the wind comes from.

x runs inland from the sea, y along the coast (which repeats). Sand is blown off the beach in pulses and heaps up;
the heaps grow, catch each other up, merge, and are taken out of the picture far inland. A tide comes and goes: what
its waves reach is levelled to the slope of the beach.

A loop of the picture: after a time T everything is as it was, one stretch D of coast further on. (The eye goes along
the coast by D in that time.) The beach has a bay every D, and the pulses of sand have that symmetry too, so the
dunes come to have it by themselves once the start has been blown out of the picture.
"""
import numpy as np
from numba import njit, prange
from scipy import fft
from dunes import smooth_side, move, sag, slide


@njit(parallel=True, fastmath=True, cache=True)
def shelter_open(h, fall):
    n, m = h.shape
    env = h.copy()
    block = 64
    for b in prange((m + block - 1) // block):
        lo, hi = b * block, min(m, (b + 1) * block)
        for i in range(1, n):
            for j in range(lo, hi):
                v = env[i - 1, j] - fall
                if v > env[i, j]:
                    env[i, j] = v
    return env


@njit(parallel=True, fastmath=True, cache=True)
def flux_open(h, floor, env, tx, ty, wet, dx, ls, tc, turn, dt):
    n, m = h.shape
    q = np.zeros_like(h)
    qy = np.zeros_like(h)
    k = dx / ls
    full = 1.0 - tc
    block = 64
    for b in prange((m + block - 1) // block):
        lo, hi = b * block, min(m, (b + 1) * block)
        for i in range(1, n):
            for j in range(lo, hi):
                if wet[i, j] > 0.5:
                    continue
                t = 1.0 + tx[i, j]
                t *= max(0.0, 1.0 - (env[i, j] - h[i, j]) / 0.25)
                qs = 0.0
                if t > tc:
                    qs = t * np.sqrt(t) * (1.0 - tc / t) / full
                v = (q[i - 1, j] + k * qs) / (1.0 + k)
                most = q[i - 1, j] + max(0.0, h[i, j] - floor[i, j]) * dx / dt * 0.5
                q[i, j] = max(0.0, min(v, most))
    for i in prange(n):
        for j in range(m):
            t = 1.0 + tx[i, j]
            qy[i, j] = q[i, j] * (turn + 0.6 * min(max(ty[i, j] / max(t, 0.3), -0.6), 0.6))
            if h[i, j] - floor[i, j] < 0.03:
                qy[i, j] = 0.0
    return q, qy


class Coast:
    def __init__(self, c):
        self.c = c
        dx, n, m = c["dx"], c["n"], c["m"]
        self.x = (c["x0"] + np.arange(n) * dx)[:, None].astype(np.float32)
        self.y = (np.arange(m) * dx)[None, :].astype(np.float32)
        Ly = m * dx
        D = c["D"]
        w = 2 * np.pi / D
        # the waterline wanders: a bay every D
        self.line = (c["bay"] * (np.sin(w * self.y) + 0.35 * np.sin(2 * w * self.y + 1.1))).astype(np.float32)
        s = self.x - self.line
        # the beach: a steady slope out of the sea, then a berm, then nearly level ground
        flat = np.maximum(s - c["toe"], 0)
        self.floor = (c["slope"] * np.minimum(s, c["toe"]) + c["rise"] * flat).astype(np.float32)
        self.floor = np.maximum(self.floor, -3.0)
        self.h = self.floor.copy()
        kx = 2 * np.pi * np.fft.fftfreq(n, dx)[:, None]
        ky = 2 * np.pi * np.fft.rfftfreq(m, dx)[None, :]
        k = np.sqrt(kx**2 + ky**2)
        k[0, 0] = 1
        core = c["A"] * np.abs(kx) + 1j * c["B"] * kx
        soft = np.exp(-((kx * max(dx, 0.6) * 1.2) ** 2) - (ky * 1.6) ** 2)
        self.fx = (np.abs(kx) / k * core * soft).astype(np.complex64)
        self.fy = (ky * np.sign(kx) / k * core * soft).astype(np.complex64)
        self.fx[0, 0] = self.fy[0, 0] = 0
        self.sink = (np.clip((self.x - c["end"]) / 75, 0, 1) ** 2).astype(np.float32)
        rng = np.random.default_rng(c["seed"])
        # the pulses of sand: where along the coast (as the eye goes), when in the loop, how much, how wide
        N = c["pulses"]
        self.py = (np.arange(N) / N * Ly + rng.uniform(-0.5, 0.5, N) * Ly / N * 1.2) % Ly
        self.pt = (np.arange(N) * 0.61803 + rng.uniform(0, 0.25, N)) % 1
        self.pv = c["big"] * np.exp(rng.normal(0, c["spread"], N))
        self.pw = rng.uniform(c["wlo"], c["whi"], N)
        self.px = c["toe"] + rng.uniform(4, 26, N)
        self.t = 0.0

    def tide(self, u):
        return self.c["tide"] * np.sin(2 * np.pi * u)

    def step(self, dt):
        c = self.c
        h, dx = self.h, c["dx"]
        n, m = h.shape
        u = self.t / c["T"]
        # sand heaping up
        Ly = m * dx
        for k in range(len(self.py)):
            a = (u - self.pt[k]) % 1.0
            if a < c["burst"]:
                rate = self.pv[k] * (1 - np.cos(2 * np.pi * a / c["burst"])) / (c["burst"] * c["T"])
                at = (self.py[k] + c["D"] * u) % Ly
                d = (self.y - at + Ly / 2) % Ly - Ly / 2
                cy = float(np.interp(at, self.y[0], self.line[0]))
                g = np.exp(-((d / self.pw[k]) ** 2)) * np.exp(-(((self.x - cy - self.px[k] - 0.005 * d * d) / c["deep"]) ** 2))
                h += (rate * dt * g).astype(np.float32)
        loose = h - self.floor
        env = shelter_open(h, c["shelter"] * dx)
        env = smooth_side(env, h)
        H = fft.rfft2(env - self.floor, workers=8)
        tx = fft.irfft2(H * self.fx, s=h.shape, workers=8)
        ty = fft.irfft2(H * self.fy, s=h.shape, workers=8)
        level = self.tide(u) + c["runup"]
        wet = (h < level).astype(np.float32)
        turn = c["veer"] * np.sin(2 * np.pi * u * c["veers"] + 0.6) + c["slant"]
        q, qy = flux_open(h, self.floor, env, tx, ty, wet, dx, c["ls"], c["tc"], turn, dt)
        move(h, q, qy, dt / dx)
        sag(h, q, c["side"] * 4.0 * dt / dx**2)
        for _ in range(18):
            if slide(h, c["repose"] * dx) < 0.004 * dx:
                break
        # the sea takes what its waves reach, hardest at the water's edge
        reach = np.clip((level - self.floor) / c["runup"], 0, 1)
        h -= (np.minimum(1, dt * c["eat"] * reach) * (h - self.floor)).astype(np.float32)
        h -= self.sink * 0.06 * dt * (h - self.floor)
        np.maximum(h, self.floor, out=h)
        self.t += dt


BASE = dict(dx=1.2, n=352, m=400, x0=-50.0, D=60.0, T=220.0, bay=5.0, slope=0.04, toe=42.0, rise=0.004,
            A=4.0, B=2.5, ls=2.0, tc=0.5, shelter=0.14, repose=0.62, side=0.12, end=320.0,
            seed=1, pulses=22, big=3.0, spread=0.6, wlo=14, whi=40, burst=0.2, deep=8.0,
            tide=0.5, runup=0.8, eat=0.25, veer=0.25, veers=2, slant=0.1)
