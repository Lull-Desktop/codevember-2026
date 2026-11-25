// Brings the dunes in: one packed file (sim/pack.py), each moment of which is handed to a worker as soon as it is here.
import Unpack from "./unpack?worker";
import { unzip, type Job } from "./unpack";
import type { Meta } from "./walk";

export type Packed = Meta & { step: number; levels: number; parts: number[] };

export const bringDunes = async (
  url: string,
  meta: Packed,
  have: (share: number) => void,
) => {
  const { n, m, keys, parts } = meta;
  const cells = n * m;
  const total = parts.reduce((a, b) => a + b, 0);
  const data = new Uint16Array(cells * keys);
  const workers = Array.from(
    {
      length: Math.min(
        6,
        Math.max(1, (navigator.hardwareConcurrency || 4) - 2),
      ),
    },
    () => new Unpack(),
  );
  try {
    const reply = await fetch(url);
    if (!reply.ok || !reply.body) throw new Error(`${url}: ${reply.status}`);
    const all = new Uint8Array(total);
    const ends = parts.map(
      (
        (sum) => (p: number) =>
          (sum += p)
      )(0),
    );
    let moves: Promise<Uint8Array> | undefined;
    let done = 0;
    let sent = 0;
    let failed: (why: Error) => void;
    let finished: () => void;
    const unpacked = new Promise<void>((yes, no) => {
      finished = yes;
      failed = no;
    });
    // (it may fail before anyone waits for it)
    unpacked.catch(() => {});
    for (const w of workers) {
      w.onmessage = ({ data: r }) => {
        if (r.error) return failed(new Error(r.error));
        data.set(r.out as Uint16Array, r.k * cells);
        if (++done === keys) finished();
      };
      w.onerror = (e) => failed(new Error(e.message || "a worker stopped"));
    }
    const reader = reply.body.getReader();
    let here = 0;
    for (;;) {
      const { done: end, value } = await reader.read();
      if (end) break;
      if (here + value.length > total) throw new Error(`${url} is too long`);
      all.set(value, here);
      here += value.length;
      have(here / total);
      while (sent < parts.length && ends[sent] <= here) {
        const part = all.slice(ends[sent] - parts[sent], ends[sent]).buffer;
        if (sent === keys) moves = unzip(part);
        else {
          const { levels, step, lo, hi } = meta;
          const job: Job = { part, k: sent, n, m, levels, step, lo, hi };
          workers[sent % workers.length].postMessage(job, [part]);
        }
        sent++;
      }
    }
    if (here < total || !moves) throw new Error(`${url} is too short`);
    await unpacked;
    return { data, moves: await moves };
  } finally {
    for (const w of workers) w.terminate();
  }
};
