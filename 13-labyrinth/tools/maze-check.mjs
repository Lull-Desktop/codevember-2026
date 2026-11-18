// node --experimental-strip-types tools/maze-check.mjs : the maze by itself. Is it a perfect maze at every tick, is his
// way clear, how much of it moves, and a picture of it in text around him (AT=playhead, SET='{"seed":5}').
import { createMaze } from "../src/maze.ts";
const t0 = performance.now();
const m = createMaze(JSON.parse(process.env.SET ?? "{}"));
const ms = performance.now() - t0;
const { W, H, ticks, cells, perCell, col } = m;
const edges = cells * 2;
// at every tick: as many ways through as cells (a tree and his one ring), and every cell reached
let bad = 0;
const parent = new Int32Array(cells);
const find = (a) => { while (parent[a] !== a) a = parent[a] = parent[parent[a]]; return a; };
for (let s = 0; s < ticks; s++) {
  for (let c = 0; c < cells; c++) parent[c] = c;
  let ways = 0, groups = cells;
  for (let e = 0; e < edges; e++) {
    if (m.wall(e, s)) continue;
    ways++;
    const c = e >> 1, i = c % W, j = (c - i) / W;
    const other = e & 1 ? j * W + ((i - 1 + W) % W) : ((j - 1 + H) % H) * W + i;
    const a = find(c), b = find(other);
    if (a !== b) (parent[a] = b, groups--);
  }
  if (ways !== cells || groups !== 1) bad++;
}
// his way: how much of the slot in front is filled while he is within reach of it
let worst = 0, shut = 0;
for (let k = 0; k < H; k++) {
  for (let d = -0.28; d <= 0.5; d += 0.01) { const [a, b] = m.filled(col, k, 0, (k + d) / H); worst = Math.max(worst, b - a); }
  const [a, b] = m.filled(col, k, 0, (k - 1.6) / H);
  if (b - a > 0.5) shut++;
}
let moving = 0, out = 0;
for (const o of m.outings) { out += (o.back - o.from) / ticks; moving += (2 * m.move) / ticks; }
const his = m.outings.filter((o) => o.his).length;
console.log(`${W}x${H} cells, ${ticks} ticks, built in ${ms.toFixed(0)} ms`);
console.log(`ticks where it is not a perfect maze: ${bad} of ${ticks}`);
console.log(`walls ${cells}, of which doors ${m.doors}; outings ${m.outings.length} (${his} his)`);
console.log(`at any moment: ${out.toFixed(0)} doors out, ${moving.toFixed(0)} sliding (${(100 * moving / cells).toFixed(1)}% of walls)`);
console.log(`on his line: most of a slot filled within his reach ${worst.toFixed(3)}, shut 1.6 cells before he gets there ${shut}/${H}`);
const at = +(process.env.AT ?? 0.26);
const y = at * H;
let text = "";
for (let j = Math.floor(y) + 9; j >= Math.floor(y) - 4; j--) {
  let a = "", b = "";
  for (let i = col - 16; i <= col + 16; i++) {
    const hs = m.filled(i, j + 1, 0, at), hw = m.filled(i, j, 1, at);
    const s = hs[1] - hs[0], w = hw[1] - hw[0];
    a += "+" + (s > 0.9 ? "--" : s > 0.1 ? (hs[0] > 0.05 ? " -" : "- ") : "  ");
    b += (w > 0.9 ? "|" : w > 0.1 ? ":" : " ") + (i === col && j === Math.floor(y) ? "()" : "  ");
  }
  text += a + "\n" + b + "\n";
}
console.log(text);
