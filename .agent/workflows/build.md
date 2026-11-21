---
description: Build the engine and admin bundles (and later the functions deploy artifact and the pipeline image) inside the quality image, exactly as CI does
---

# Build Workflow

Everything builds inside the pinned quality image `hcm-quality:local`; the host's Node 22 is never used. Stage definitions: `.agent/skills/quality/pipeline_skill.md` → *Stages*.

## One command, CI-equivalent

```bash
mkdir -p reports/pipeline
PIPELINE_STAGE=build bash scripts/ci/run-all-checks.sh > reports/pipeline/run.log 2>&1; echo "EXIT=$?"
grep -E '^\[(SUCCESS|FAILURE)\]' reports/pipeline/run.log
```

The `build` stage runs `npm run build`, which runs every workspace's `build` script:

| Package | Output | Notes |
| --- | --- | --- |
| `@hcm/engine` | `packages/engine/dist/engine.iife.js`, `engine.mjs` (plus its lazy `firebase-sdk-<hash>.js`), `engine.css`, `fonts/` | IIFE global `window.HistoricCityMap`; Mapbox GL is never imported: the engine reads the page's global `mapboxgl` (Mapbox GL JS 3.34.1 from `api.mapbox.com`); config in `packages/engine/vite.config.ts`, then `fonts:copy` copies the kit's fonts and their licences into `dist/fonts/` |
| `@hcm/admin` | `packages/admin/dist/admin.*` | global `HistoricCityMapAdmin`; deployed to Firebase Hosting from M2 |

`dist/` is git-ignored: the `release` stage rebuilds the bundles on a tag and `release.yml` attaches them to the GitHub Release. The engine a release serves through jsDelivr is the one copy of a build in the tree: `npm run release:cdn` writes it into `cdn/engine/` with `release.json` on the release commit, and the `release-cdn` gate requires it to equal a fresh build byte for byte (`.agent/skills/quality/prepare_release_skill.md`).

## Ad-hoc, while iterating

```bash
docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp/hcm-home -v "$PWD:$PWD" -w "$PWD" hcm-quality:local \
  bash -c 'mkdir -p $HOME && npm run build --workspace @hcm/engine'
```

## Planned builds

- `functions/dist/` (built since M0 by `npm run build`, deployed from M2): `functions/build.mjs` bundles `@hcm/shared` with Vite SSR, keeps npm dependencies external and writes `dist/package.json` with exact pins; its lockfile and the e2e emulator run on it join in M2.
- Pipeline image (M3): `pipeline/Dockerfile` targets `test` (the GDAL test image) and `runtime` (the Cloud Run Job image).
- Sites: `npm run build:site` (gate `site-build`, after `vite-build`) writes `dist/site/bucharest` (Pages) and `dist/site/starter-kit` from `sites/bucharest/` and `starter-kit/`: the generated `index.html` (meta CSP, Mapbox GL with Subresource Integrity), `config.js`, `site.css`, `data/manifest.json` with the photos in `data/media/` and the Mapbox token from `MAPBOX_PUBLIC_TOKEN`, and the engine `dist` copied same-origin into `engine/` with its `THIRD_PARTY_NOTICES.txt`. With `HCM_PUBLIC_BUCKET` set (a site whose `site.json` says `publicManifest: true`, Bucharest's), `config.js` reads `https://storage.googleapis.com/<bucket>/cities/<city>/manifest.json`, the page's CSP allows that host and the crash endpoint, and no `data/` snapshot is bundled (`scripts/site/src/public-manifest.ts`, `DECISIONS-for-review.md` §55a). The e2e variant (`npm run build:site:e2e`) writes `dist/e2e-site` with the e2e fixture manifest.
- Bundle budget gate: gzip size of the engine IIFE and the admin bundle.

## Rules

- Never bundle `mapbox-gl`; never add a dependency without `npm view` and an exact pin (`docs/SETUP.md` → *npm in a container*).
- A new workspace needs its `COPY` line in the `manifests` stage of `docker/Dockerfile.quality`, or `npm ci` fails in the image build.
