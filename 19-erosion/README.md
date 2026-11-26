# 19-erosion

Two oceans (`index.html`, `src/coast/`). The wind off the land drives dunes down to the sea, where they are tallest, and out into it; a live shallow-water sea comes the other way and cuts them down. Someone walks towards us between the two and never gets here, in a 40 second loop: at one time the water is at their feet, then it goes back and they are up on the dunes (`whoX`, `swing`, `when`, `whoZ` in the panel; they were searched for, so that the walk is never under water or out of sight). A loop later everything is as it was, one bay further along the coast, and the eye has gone back by that bay.

- `python sim/shoreloop.py <work folder> output/coast-soft.bin laps=9 lean=6 big=14` makes the dunes (numpy, scipy, numba, pillow; about a quarter of an hour, 73 MB, not in git). `python sim/ridges.py output/coast-soft.bin output/coast.bin` then gives the taller dunes ridges (a minute and a half), and `python sim/pack.py output/coast.bin public/coast.pack` packs them for the page: 72.7 MB become 5.8 by a wavelet rounded to 2 mm, unpacked in workers (`src/coast/unpack.ts`). `sim/coastloop.py` is the earlier take, with the wind off the sea: dunes born on the beach that go inland (the page no longer shows it; its film is `output/coast.mp4`).
- The picture is drawn in three passes: the surface (`trace.wgsl`, with the person over it, `walker.wgsl` and `person.wgsl`), the air in front of it at a half of the page's own pixels (`air.wgsl`), and the two laid over each other by how far off things are. `bake.wgsl` makes once what only slides: noise, the clouds' shadows, the clouds, the far hills. `DPR=2 node tools/coast-time.mjs 1728x1000` tells what each pass costs; `res` in the panel is how fine it is drawn.
- `coast-notes.html` explains all of it, with the real maps of one frame and three live demos.
- `node tools/coast-shot.mjs out.png 1600x900 0.72` renders a still, `SPP=8 node tools/coast-film.mjs out.mp4 1600x900 1200 30` the loop. `?warm=` sets how many sixtieths of a second the sea runs before a moment that is jumped to.
- The buttons at the top turn the sun between 7.5 and 20 degrees (`#day` starts by day). Until the sea has come to the first moment a veil is up, with how much of the dunes' file is here.
- `node tools/coast-film.mjs x.mp4 1024x1024 1200 30` films the square loop; where the window is narrow the eye looks more to the land.

## Before it

The rest are earlier tries, each on its own page.

### Rock

The first page of the day (`rock.html`).

A block of rock that cracks along flat joints and sheds its outer pieces.

- `src/rock.ts` cuts a box into a tree of pieces, plane by plane (after Domokos et al. 2020, "Plato's cube"), and decides when each crack starts and which pieces fall.
- `src/trace.wgsl` ray marches the tree; `src/show.wgsl` puts the picture on the screen.
- `node tools/shot.mjs out.png 900x1100 0.4 0.7 1.0` renders stills at those ages, headless (dev server on port 5319).

The `age` slider runs the history; `play` runs it over the loop (pieces vanish when they fall, they do not drop yet).

### Models wall

`lab.html` runs nine small models side by side, one a paper, to look at what structures each makes (`src/lab/sims/`). Click a tile to start it again from another seed; its title opens it large. `?speed=4` runs them faster.

`node tools/lab.mjs out.png <id|all> 3 8 16` renders the wall, or one model at those seconds side by side.

### Möbius

`mobius.html`: a Möbius band of layered sandstone, ray marched (`src/mobius/`), with a wave of erosion going round it in a seamless 12 second loop: soft layers sink, pits and through-holes open behind the wave and close again far behind it, and sand leaves from the wave's front. The sand keeps no state (each grain's path depends only on the moment of the loop), so the loop closes exactly.

`node tools/mobius-shot.mjs out.png 1200x680 0 0.25 0.5 0.75` renders stills at those moments of the loop.

### Terrain

`terrain.html`: a square block of mountains with a meandering river in its valley, fog and a glow (`src/terrain/`). The mountains use Rune Skovbo Johansen's erosion filter, ported from Luke Mitchell's C# conversion; it is MPL-2.0 and is kept alone in `src/terrain/erosion.wgsl`, which must stay under that licence and open if published. No loop yet.

`node tools/terrain-shot.mjs out.png 1000x1000 0 4 8` renders stills at those seconds of river time.

### Voxel Möbius

`voxel.html`: the same Möbius band as a 288×88×288 grid of rock, worn by compute shaders and meshed again with marching cubes every frame (`src/voxel/`). A front of wear travels round the ring once in 24 seconds and the rock grows back behind it; the rock repeats from the second lap on, the sand does not.

`node tools/voxel-shot.mjs out.png 1600x900 +1.3` renders a still at 1.3 laps.

### Arches

`arch.html` (`src/arch/`, on the voxel page's rock): a row of smooth stone arches in a desert. Before each one time runs away, three days and nights in about 12 seconds, and wears it to lace; then the eye goes through to the next. The loop is 20 seconds and closes exactly: every arch is the same one, so the end is the start one arch further on, and the worn arch is made whole behind the eye.

`node tools/arch-shot.mjs out.png 1200x800 0 0.3 0.6` renders stills at those moments; `node tools/arch-film.mjs out.mp4 960x600 1200 60` films the loop and reports jumps.

### Dunes

`dunes.html` (`src/dunes/`; only on the dev server, as its 50 MB of dunes are not in git): dunes that travel like slow waves, and someone walking against them who gets nowhere, in a 40 second loop. The dunes are a lap of a continuum simulation (`sim/dunes.py`: wind speed-up over the hills, sand flux that lags behind it, shelter behind crests, slides) held loosely to its own broad shape so that the lap closes (`sim/loop.py`); 32 moments of it are kept in `public/dunes.bin` (50 MB). The page ray marches them with light bounced between the dunes, blown sand and haze.

- `python sim/loop.py <work folder> output/dunes.bin laps=3 wander=27 seed=33 veer=0.5 hold=7` makes the dunes again (numpy, scipy, numba, pillow; about five minutes).
- `node tools/dunes-shot.mjs out.png 1080x1350 0.02` renders a still, `SPP=12 node tools/dunes-film.mjs out.mp4 1080x1350 1200 30` the loop.

