"""Two oceans: dunes that the wind off the land drives into the sea, and a sea that cuts them down.

The model of dunes.py with open ends. x runs inland from the sea, y along the coast (which repeats); the first index runs
with the wind, from far inland to the sea. Sand comes in pulses far inland; the heaps catch each other up and merge, so
the tallest are those that get to the shore. The sea takes sand that lies where its waves reach, the slope above slides
after it, and so a dune that has come into the water is undercut and goes down.

A loop of the picture: after a time T everything is as it was, one stretch D of coast further on. (The eye goes along
the coast by D in that time.) The pulses of sand have that symmetry, so the dunes come to have it by themselves once the
start has been blown into the sea.
"""
import numpy as np
from scipy import fft
from dunes import smooth_side, move, sag, slide
from coast import shelter_open, flux_open


class Shore:
    def __init__(self, c):
        self.c = c
        dx, n, m = c["dx"], c["n"], c["m"]
        self.x = (c["x0"] + (n - 1 - np.arange(n)) * dx)[:, None].astype(np.float32)
        self.y = (np.arange(m) * dx)[None, :].astype(np.float32)
        w = 2 * np.pi / c["D"]
        self.line = (c["bay"] * (np.sin(w * self.y) + 0.35 * np.sin(2 * w * self.y + 1.1))).astype(np.float32)
        s = self.x - self.line
        # the ground under the sand: a shelving sea floor, a beach, then nearly level
        self.floor = np.where(s < 0, c["shelf"] * s, c["slope"] * np.minimum(s, c["toe"]) + c["rise"] * np.maximum(s - c["toe"], 0))
        self.floor = np.maximum(self.floor, -3.0).astype(np.float32)
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
        rng = np.random.default_rng(c["seed"])
        N, Ly = c["pulses"], m * dx
        self.py = (np.arange(N) / N * Ly + rng.uniform(-0.6, 0.6, N) * Ly / N) % Ly
        self.pt = (np.arange(N) * 0.61803 + rng.uniform(0, 0.25, N)) % 1
        self.pv = c["big"] * np.exp(rng.normal(0, c["spread"], N))
        self.pw = rng.uniform(c["wlo"], c["whi"], N)
        self.px = c["birth"] + rng.uniform(-14, 14, N)
        self.t = 0.0
        self.taken = 0.0

    def step(self, dt):
        c = self.c
        h, dx = self.h, c["dx"]
        n, m = h.shape
        u = self.t / c["T"]
        Ly = m * dx
        for k in range(len(self.py)):
            a = (u - self.pt[k]) % 1.0
            if a < c["burst"]:
                rate = self.pv[k] * (1 - np.cos(2 * np.pi * a / c["burst"])) / (c["burst"] * c["T"])
                at = (self.py[k] + c["D"] * u) % Ly
                d = (self.y - at + Ly / 2) % Ly - Ly / 2
                g = np.exp(-((d / self.pw[k]) ** 2)) * np.exp(-(((self.x - self.px[k] + 0.005 * d * d) / c["deep"]) ** 2))
                h += (rate * dt * g).astype(np.float32)
        env = shelter_open(h, c["shelter"] * dx)
        env = smooth_side(env, h)
        # the sea is as good as flat to the wind
        H = fft.rfft2(np.maximum(env, 0) - np.maximum(self.floor, 0), workers=8)
        tx = fft.irfft2(H * self.fx, s=h.shape, workers=8)
        ty = fft.irfft2(H * self.fy, s=h.shape, workers=8)
        level = c["tide"] * np.sin(2 * np.pi * u)
        wet = (h < level + 0.25).astype(np.float32)
        turn = c["veer"] * np.sin(2 * np.pi * u * c["veers"] + 0.6) + c["slant"]
        q, qy = flux_open(h, self.floor, env, tx, ty, wet, dx, c["ls"], c["tc"], turn, dt)
        move(h, q, qy, dt / dx)
        sag(h, q, c["side"] * 4.0 * dt / dx**2)
        # the slides go round from one end to the other, where nothing must lie
        h[:4], h[-6:] = self.floor[:4], self.floor[-6:]
        for _ in range(18):
            if slide(h, c["repose"] * dx) < 0.004 * dx:
                break
        # the sea takes the sand that its waves reach: most at the water's edge, less deep down
        top = np.clip((level + c["runup"] - h) / c["runup"], 0, 1)
        deep = np.exp(np.minimum(h - level, 0) / c["stir"])
        # hardest on what stands furthest out
        sea = 1 / (1 + np.exp(np.clip((self.x - c["inland"]) / 6, -30, 30))) * (1 + c["out"] * np.clip((-12 - self.x) / 20, 0, 2) ** 2)
        go = np.minimum(1, dt * c["eat"] * top * deep * sea) * (h - self.floor)
        h -= go.astype(np.float32)
        # and spreads out what lies under it
        under = np.clip((level + 0.2 - h) / 0.5, 0, 1)
        lap = np.zeros_like(h)
        lap[1:-1] = h[2:] + h[:-2] - 2 * h[1:-1]
        lap += np.roll(h, 1, 1) + np.roll(h, -1, 1) - 2 * h
        lap[0] = lap[-1] = 0
        h += (min(0.2, c["spreads"] * dt / dx**2) * under * lap).astype(np.float32)
        np.maximum(h, self.floor, out=h)
        self.t += dt


BASE = dict(dx=1.2, n=352, m=400, x0=-80.0, D=60.0, T=400.0, bay=4.0, shelf=0.028, slope=0.04, toe=40.0, rise=0.003,
            A=4.0, B=2.5, ls=2.0, tc=0.5, shelter=0.14, repose=0.62, side=0.12, birth=295.0,
            seed=1, pulses=11, big=13.0, spread=0.5, wlo=22, whi=44, burst=0.45, deep=11.0, tide=0.5, runup=0.9, eat=0.4, out=3.0,
            stir=1.6, inland=70.0, spreads=0.3, veer=0.25, veers=2, slant=0.1)
