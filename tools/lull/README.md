# Lull scene sidecar

This directory contains the shared tooling for exporting each `NN-name`
experiment as a Lull wallpaper scene. Nothing here is imported by the normal
Vite apps; the sidecar is only used by `npm run lull:*`.

## Layout

```text
tools/lull/
  lull.config.json        global defaults and scene order
  scene-sdk/              vendored @lull/scene-sdk (Apache-2.0, dist + types)
  runtime/                browser-side boot, GUI probe, params, rAF gate
  build/                  Node-side config/build/validate/zip helpers
scripts/lull/             CLI entry points
NN-name/
  preview.webp           16:9 catalog artwork (generated, also copied into the package)
  lull/
    scene.json            the only per-scene configuration
    prelude.ts            installs storage shim + GUI probe before the sketch
    entry.ts              imports prelude, then the sketch, then starts the bridge
    tsconfig.json         standalone typecheck for lull/ + runtime
```

## Commands

```sh
npm run lull:check
npm run lull:test
npm run lull:init -- 19-foo --id codevember.foo --name "Foo"
npm run lull:preview -- 01-fold
npm run lull:build -- --only 01-fold --pack
npm run lull:build -- --all --pack
npm run lull:previews -- --all --pack
npm run lull:build -- --all --target bundled --into F:/TK/GameProjects/lull-app
npm run lull:sync-sdk -- --from F:/TK/GameProjects/lull-app/packages/scene-sdk
```

`--release` makes `assetsLicense: "review"` a hard error. Use it for a
publishable build; leave it off while bringing up a scene.

## Preview screenshots

Every extension needs a `preview.webp`: 16:9, 1600×900, under 3 MiB. The
capture command serves the already-built packages, renders them in headless
Chrome at that size, samples two frames, and keeps the one with more visual
detail:

```sh
npm run lull:previews -- --all --pack
npm run lull:previews -- --only 01-fold,06-orrery --pack
```

The WebP is written to both `<project>/preview.webp` (source of truth, copied
into later builds) and `dist-lull/<id>/preview.webp` (package root, next to
`catalog.json`). `--pack` refreshes the zip as well. The image sits outside the
entry directory, so it does not change the content digest and the scene never
loads it.

Chrome and `puppeteer-core` are discovered locally; set `CHROME_PATH` or
`PUPPETEER_CORE` to override. `--delay` / `--gap` / `--shots` control the
sampling, and `--no-source` writes only the package copy. A per-scene capture
log is written to `dist-lull/previews.json`.

## `scene.json`

Manifest fields are written to `catalog.json`; build fields are stripped.

| Field | Kind | Notes |
| --- | --- | --- |
| `id` | manifest | `^[a-z0-9][a-z0-9._-]{2,63}$` |
| `slug` | manifest/build | entry directory `scenes/<slug>/index.html` |
| `name`, `version`, `description`, `author`, `license` | manifest | name <= 80 chars; semver version |
| `theme.background`, `theme.accent` | manifest | `#RRGGBB` |
| `capabilities` | manifest | v1 uses `wallpaper.viewport`, `wallpaper.params`, `wallpaper.script` |
| `performance` | manifest | `tier` + `targetFps` hint |
| `compatibility` | manifest | `hostApi: 1`, `platforms: ["windows"]` |
| `params` | manifest/build | see below |
| `source.html`, `source.module` | build | original page and module |
| `entry` | build | always `lull/entry.ts` |
| `requires` | build | `["webgpu"]` for the current sketches |
| `assets` | build | globs under `public/`, copied preserving paths |
| `hide` | build | CSS selectors hidden in the wallpaper |
| `assetsLicense` | build | `ok` or `review` |
| `reducedMotion` | build | optional `{ param, value }` |

### Params and bindings

Each param needs a `binding` to an existing lil-gui controller:

```json
{
  "key": "chains",
  "type": "number",
  "label": "Chains",
  "default": 16,
  "min": 1,
  "max": 16,
  "step": 1,
  "binding": { "property": "chains" },
  "apply": "finish"
}
```

Binding forms:

- `{ "gui": "spiral density" }` — controller display name.
- `{ "gui": "light/light shafts" }` — folder path + display name.
- `{ "property": "pace" }` — underlying property, best when the sketch uses
  generated names or `.name()` is dynamic.

`apply`:

- `"change"` — `controller.setValue`, immediate (use for smooth sliders).
- `"finish"` — debounced 200 ms, then `controller.load`, which fires
  `onFinishChange` (use for geometry/texture rebuilds).

The runtime first applies the manifest defaults once, then only changed values.
It logs missing bindings through `scene.log`; the build also checks that the
binding name/property appears in the project's source.

`map` is only for enum values that must be converted to non-string controller
values (for example `fps-cap` `"60"` -> `60`).

## Runtime

`prelude.ts` runs before the sketch and `entry.ts` runs after it:

1. `prelude.ts` installs an in-memory `localStorage` (opaque-origin iframe),
   patches `GUI.prototype` to collect controllers, and installs the rAF gate;
2. `entry.ts` statically imports the original sketch (no dynamic import, so the
   bundled package has no `import()` and no Rollup TDZ hazard);
3. `bootPreparedScene` connects `@lull/scene-sdk`, applies `frame.params`, and
   pauses `requestAnimationFrame` while the wallpaper is hidden.

The original sketch is not edited. Editor UI is hidden by CSS (`hide`), and
the original page's CSS/DOM is kept so loaders and canvas layout still work.

## Lull contract reminders

- One scene per `catalog.json`.
- Package root: `catalog.json` + `scenes/<slug>/`.
- Digest covers `scenes/<slug>/**` only.
- No remote resources, `localStorage`, `eval`, dynamic imports, absolute paths
  or inline event handlers.
- Installer caps: 8 MiB per file, 64 MiB per package, 512 files. The official
  guidance is 5 MB, but several experiments exceed it; `report.json` lists the
  actual sizes.
- Lull v1 has no click/pointer events for scenes unless `wallpaper.pointer` is
  declared; these sketches currently run as ambient/animated wallpaper.
- WebGPU is required by most sketches. The host serves scenes from
  `http://lullcontent.localhost` (secure context on Windows) and its CSP allows
  `connect-src` and `worker-src`; still verify `navigator.gpu` in the real
  WebView2 wallpaper window.

## SDK updates

`tools/lull/scene-sdk` is committed so CI and other machines do not need the
Lull checkout. To update it:

```sh
npm run lull:sync-sdk -- --from F:/TK/GameProjects/lull-app/packages/scene-sdk
```

Then rebuild the pilots. `SOURCE.json` records the version and per-file
SHA-256.

## Licensing and source

- Scene source repository: https://github.com/akella/codevember-2026
- `@lull/scene-sdk`: Apache-2.0 (see `scene-sdk/LICENSE` and
  `scene-sdk/PROVENANCE.md`).
- Three.js and sketch dependencies: their own licenses; each generated package
  includes `THIRD_PARTY_NOTICES.md` with the source URL.
- Scene code/assets: the package `license` field is `CC-BY-4.0` with attribution
  to Yuri Artiukh. Third-party models/textures/audio still need their own
  provenance checks; `assetsLicense: "review"` blocks `--release` until done.