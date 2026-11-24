# Codevember 2026

https://akella.github.io/codevember-2026/

Each `NN-name` folder is one experiment, with its own dependencies. On every push to `main`,
GitHub Actions builds `01-fold` to `/1/`, `02-shatter` to `/2/`, and so on. The gallery lists all
30 prompts from `scripts/build.mjs`, and a day becomes a link once its folder exists. Build output
is never committed.

The build adds a footer to every page, linking back to the gallery, so a day needs nothing for that.

## Adding a day

1. Scaffold it with `npm create ssam@latest`, naming the folder `NN-name`.
2. In the new folder, delete `.git`, then remove `ssamGit()` and its import from `vite.config.ts`.
   That plugin runs `git init` on every dev server start, and a nested repo gets pushed as an
   empty folder. The build stops with an error if this step is missed.
3. Optional: add `public/cover.jpg` for the gallery tile.

## Local preview

```sh
npm run build
npm run preview
```

## Lull scene packages

Each experiment can also ship as a Lull wallpaper scene without changing its
normal Vite app. The sidecar lives in `NN-name/lull/`; the default
`src/`, `index.html`, `vite.config.ts` and `tsconfig.json` are untouched.

```sh
# validate every lull/scene.json
npm run lull:check

# build one scene, or all of them
npm run lull:build -- --only 01-fold --pack
npm run lull:build -- --all --pack

# local browser preview; ?key=value overrides params
npm run lull:preview -- 01-fold

# install into lull-app/extensions/bundled and rebuild there
npm run lull:build -- --all --target bundled --into F:/TK/GameProjects/lull-app
```

Outputs go to `dist-lull/<scene-id>/` plus `dist-lull/artifacts/*.zip` and
`dist-lull/report.json`. Lull requires one scene per package; the package is
`catalog.json` + `scenes/<slug>/index.html` + `scene.js` + declared assets.

To add a new project:

```sh
npm run lull:init -- 19-foo --id codevember.foo --name "Foo"
```

Then add 3–5 `params` with a `binding` (`gui` display name, folder path, or the
underlying `property`) and declare any `public/` assets the sketch fetches.
See `tools/lull/README.md` for the schema and `docs/lull-scenes.md` for the
current package matrix, warnings and acceptance checklist.

Notes:

- Scene source: https://github.com/akella/codevember-2026
- The scene SDK is vendored once at `tools/lull/scene-sdk` (Apache-2.0); it is
  not added to each project's `package.json`.
- The build uses a separate inline Vite config, so `ssamExport`, `ssamFfmpeg`
  and other dev-only plugins never enter the scene package.
- Most experiments need WebGPU. The Lull host serves scenes from
  `http://lullcontent.localhost` (secure context on Windows), but verify
  `navigator.gpu` in the actual WebView2 wallpaper window before publishing.
- `npm run lull:build -- --all` expects each project's `node_modules`; use
  `--install` to let the script run `npm ci` for missing ones.
