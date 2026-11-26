// A wall of small models, one a paper: each tile runs its model and starts it again when it has run out.
// ?only=<id> shows one large; ?speed=4 runs them faster; ?seed=3 starts from another seed.
import { arches } from "./sims/arches";
import { canyon, lidar } from "./sims/canyon";
import { cracks } from "./sims/cracks";
import { dunes } from "./sims/dunes";
import { hierarchy } from "./sims/hierarchy";
import { hoodoos } from "./sims/hoodoos";
import { meanders } from "./sims/meanders";
import { pebbles } from "./sims/pebbles";
import { pinnacles } from "./sims/pinnacles";
import { rivers } from "./sims/rivers";
import { seepage } from "./sims/seepage";
import type { Def, Sim } from "./util";

const all: Def[] = [
  hoodoos,
  lidar,
  canyon,
  meanders,
  cracks,
  hierarchy,
  pebbles,
  rivers,
  seepage,
  pinnacles,
  arches,
  dunes,
];
const query = new URLSearchParams(location.search);
const only = query.get("only");
const speed = Number(query.get("speed") ?? 1);
const seed0 = Number(query.get("seed") ?? 1);
const grid = document.getElementById("grid")!;
if (only) grid.classList.add("one");

type Tile = {
  def: Def;
  sim: Sim;
  ctx: CanvasRenderingContext2D;
  seen: boolean;
  seed: number;
  rest: number;
  steps: number;
};
const tiles: Tile[] = [];
const state = { frame: 0, tiles };
Object.assign(window, { __lab: state });

for (const def of all) {
  if (only && def.id !== only) continue;
  const el = document.createElement("div");
  el.className = "tile";
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = only ? 1000 : 560;
  const h = document.createElement("h2");
  h.innerHTML = `<a href="?only=${def.id}">${def.title}</a>`;
  const paper = document.createElement("p");
  paper.className = "paper";
  paper.textContent = def.paper;
  const note = document.createElement("p");
  note.textContent = def.note;
  el.append(canvas, h, paper, note);
  grid.append(el);
  const tile: Tile = {
    def,
    sim: def.make(seed0),
    ctx: canvas.getContext("2d")!,
    seen: true,
    seed: seed0,
    rest: 0,
    steps: 0,
  };
  canvas.addEventListener("click", () => {
    tile.sim = def.make(++tile.seed);
    tile.rest = tile.steps = 0;
  });
  new IntersectionObserver(([e]) => (tile.seen = e.isIntersecting)).observe(
    canvas,
  );
  tiles.push(tile);
}

const frame = () => {
  for (const t of tiles) {
    if (!t.seen) continue;
    if (t.sim.done?.()) {
      // a finished model is left to be looked at for a while, then begun again
      if (++t.rest > 150 / Math.max(1, speed)) {
        t.sim = t.def.make(++t.seed);
        t.rest = t.steps = 0;
      }
    } else {
      const k = Math.max(1, Math.round((t.def.steps ?? 1) * speed));
      for (let i = 0; i < k && !t.sim.done?.(); i++, t.steps++) t.sim.step();
    }
    t.sim.draw(t.ctx, t.ctx.canvas.width);
  }
  state.frame++;
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);
