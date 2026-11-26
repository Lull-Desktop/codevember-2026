# Lull scene export: status and operations

This is the implementation companion to the Lull sidecar. The tooling lives in
`tools/lull/` and `scripts/lull/`; per-project configuration lives in
`NN-name/lull/scene.json`.

## Current status

- 18/18 projects have a `lull/scene.json` and a compile-checked prelude/entry.
- `npm run lull:build -- --all --pack` produces 18 package directories,
  18 installable zips and `dist-lull/report.json`.
- `npm run lull:check` validates every config and every built package.
- 11/18 packages pass the official `lull-ext validate --strict` check out of
  the box. The other 7 have either a `new Function` (P-EVAL) warning from a
  Three.js TSL bundle, or exceed the 5 MB recommended size (the installer hard
  cap is 64 MiB / 8 MiB per file). All 18 pass the official non-strict check.
- Browser checks under a simulated Lull CSP (`script-src 'self'`, no
  `unsafe-eval`, `connect-src 'self'`, `worker-src 'self' blob:`) passed for
  01-fold, 03-melt, 06-orrery, 07-hollow, 11-rust, 14-tension and 15-mirage.
  This is not a substitute for a real WebView2/Lull install.

## License and source

- Scene source repository: https://github.com/akella/codevember-2026
- Scene code and assets: `CC-BY-4.0`, attribution to Yuri Artiukh, unless a
  per-package notice says otherwise.
- Each generated package carries `LICENSE` and `THIRD_PARTY_NOTICES.md` inside
  `scenes/<slug>/`; both include the source URL above.
- Third-party models, textures and audio still need their own provenance
  review; `assetsLicense: "review"` blocks `--release` until that is done.

## Commands

```sh
npm run lull:check
npm run lull:test
npm run lull:build -- --only 01-fold --pack
npm run lull:build -- --all --pack
npm run lull:previews -- --all --pack
npm run lull:preview -- 03-melt
npm run lull:build -- --all --target bundled --into F:/TK/GameProjects/lull-app
```

Install a zip from Lull: Settings → Extensions → Install from file.

For the bundled route, the target directory is
`extensions/bundled/codevember-<slug>/`; run `pnpm extensions:build` in
lull-app afterwards.

## Preview screenshots

Each extension has a 16:9 `preview.webp` at 1600×900, under 3 MiB:

- `<project>/preview.webp` — source file, copied into every later build.
- `dist-lull/<id>/preview.webp` — package root, next to `catalog.json`; it is
  outside the entry directory, so it does not change the content digest.
- `dist-lull/artifacts/<id>-<version>.zip` — includes the preview when packed.

Regenerate them after changing a scene:

```sh
npm run lull:previews -- --all --pack
npm run lull:previews -- --only 01-fold --pack
```

The command renders the built package in headless Chrome, samples two frames,
and keeps the one with more visual detail. Generation needs a local Chrome and
`puppeteer-core`; `CHROME_PATH` / `PUPPETEER_CORE` override discovery. The
report is `dist-lull/previews.json`.

## Per-scene snapshot

| Scene | id | Params | Size | Notes |
| --- | --- | --- | ---: | --- |
| 01-fold | codevember.fold | 9 | 1.1 MB | Full-window canvas; camera dolly/yaw/pitch/roll + day/night theme params; P-EVAL warning; CSP browser test passed |
| 02-shatter | codevember.shatter | 2 | 6.7 MB | P-EVAL; >5 MB; bake assets |
| 03-melt | codevember.melt | 5 | 9.5 MB | >5 MB; CSP browser test passed |
| 04-tangle | codevember.tangle | 2 | 22.8 MB | Full-window canvas; P-EVAL; >5 MB; largest package |
| 05-moss | codevember.moss | 5 | 140 KB | clean |
| 06-orrery | codevember.orrery | 5 | 1.2 MB | clean; CSP browser test passed |
| 07-hollow | codevember.hollow | 5 | 1.1 MB | P-EVAL; CSP browser test passed |
| 08-tesseract | codevember.tesseract | 4 | 745 KB | clean |
| 09-membrane | codevember.membrane | 0 | 1.2 MB | GUI fields are incomplete; params deferred until an adapter is written |
| 10-caustic | codevember.caustic | 5 | 794 KB | clean |
| 11-rust | codevember.rust | 5 | 12.9 MB | >5 MB; default Suzanne assets; face.sdf excluded |
| 12-feather | codevember.feather | 4 | 3.8 MB | clean |
| 13-labyrinth | codevember.labyrinth | 4 | 421 KB | clean |
| 14-tension | codevember.tension | 1 (`look`) | 4.0 MB | production GUI only exposes `look`/`show`; editor stripped |
| 15-mirage | codevember.mirage | 5 | 452 KB | clean; first frame was slow in headless Chrome (~30–40 s) |
| 16-spore | codevember.spore | 5 | 4.5 MB | clean |
| 17-kelp | codevember.kelp | 5 | 6.0 MB | >5 MB; fish/kelp assets |
| 18-pendulum | codevember.pendulum | 5 | 1.3 MB | clean |

## Known limitations

### WebGPU

Every current scene requires WebGPU. The Lull host serves scenes from
`http://lullcontent.localhost` on Windows, which is a secure context, and its
CSP allows `connect-src` and `worker-src`. The remaining unknown is whether the
real WebView2 wallpaper window exposes a usable adapter on the target machine.
Install one package (03-melt or 06-orrery is a good pilot) and check the Lull
console before publishing the rest.

### `new Function` / P-EVAL

Three.js TSL bundles include `new Function` in `scene.js`. Lull's validator
reports this as a warning (strict mode turns it into an error) because the host
CSP has no `unsafe-eval`. Browser tests under a simulated CSP passed for the
sampled scenes, which means the code path was not executed. This is not a
guarantee for every scene/GPU/driver combination. Before release:

- run the package in the real Lull WebView2;
- if it throws `EvalError`, either move that scene to a WebGL/raw-WebGPU path,
  or request a host CSP change (not recommended for untrusted content).

### Size

The official guidance is 5 MB; the installer hard caps are 8 MiB per file,
64 MiB per package and 512 files. `04-tangle`, `11-rust`, `03-melt`,
`02-shatter` and `17-kelp` exceed the guidance. They install, but start-up and
download cost is higher. Options: keep only the used bake/model variant, gzip
large binary assets with a scene-side decompressor, or decimate/re-bake.

### Pointer / audio / sync / span

v1 declares only `wallpaper.viewport`, `wallpaper.params` and
`wallpaper.script`. Canvas drag/OrbitControls interaction, audio-reactive
paths, cross-monitor sync and `wallpaper.canvas` span are not part of this
batch. The scenes run as ambient animations.

### Editor UI

The package HTML hides `.lil-gui`, stats (including the classless Three.js
stats container), page switchers and known HUDs. Some sketches create custom
DOM without a stable class/id; add a selector to `hide` if a control still
shows in the wallpaper.

## Adding a project

```sh
npm run lull:init -- 19-foo --id codevember.foo --name "Foo"
```

Then:

1. Add 3–5 params, each with a `binding` (`gui` display name, folder path, or
   `property`).
2. Declare `public/` assets the main entry fetches.
3. Run `npm run lull:preview -- 19-foo` and verify the params in the URL.
4. Run `npm run lull:build -- --only 19-foo --pack`.

## Acceptance checklist per scene

- [ ] Package installs and appears in Settings → Wallpaper.
- [ ] First frame appears; loader/error state is not stuck.
- [ ] Params apply without reloading the iframe.
- [ ] No console errors, no CSP violations, no 404s.
- [ ] Hidden wallpaper stops rendering; visible wallpaper resumes.
- [ ] 10-minute run has no crash or unbounded growth.
- [ ] Mirror / independent render correctly (span is not in v1).
- [ ] Reinstall with a bumped version overwrites and reloads the scene.
- [ ] Asset licenses are cleared (`assetsLicense: "ok"`) before `--release`.