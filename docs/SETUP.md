# Developer Setup

Everything that checks, tests or builds this repository runs in Docker. The host needs only Docker, git and a shell; its own Node and Python are never used for a gate.

## Prerequisites

- Linux (the only supported developer platform).
- Docker Engine with BuildKit (Docker 23 or later); your user in the `docker` group.
- git; optionally the GitHub CLI `gh` for pull requests.
- About 6 GB of disk for the quality image.

## First run

```bash
git clone https://github.com/ventura8/historic-city-map-maker.git
cd historic-city-map-maker
git switch feat/engine-rewrite
PIPELINE_STAGE=static bash scripts/ci/run-all-checks.sh
```

The first run builds `docker/Dockerfile.quality` as `hcm-quality:local` (about 5 minutes cold, seconds afterwards), installs `node_modules` inside the container from the image's npm cache, then runs the static gates. Read the verdict: `[SUCCESS] stage 'static' passed`. Stages and when to run which: [CI_PIPELINE.md](CI_PIPELINE.md).

The image contains Node 24, npm 11, JDK 21, Python 3.14 with the CI tools, GDAL, the Playwright browsers, the Firebase emulator JARs and the linter binaries. The repository is mounted at the same absolute path, with `HOME=/tmp/hcm-home` inside the container and no host-home mount (a rule adopted after a home-directory wipe on 2026-10-10).

## npm in a container

The host's Node 22 and npm 9 are too old (`engines` requires Node 24.12 or later, `engine-strict` is on). Add or update a dependency with the digest-pinned Node image, after checking the version:

```bash
docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp/h -e npm_config_cache=/tmp/h/.npm \
  -v "$PWD:$PWD" -w "$PWD" \
  node:24-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54 \
  npm view <pkg> version

docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp/h -e npm_config_cache=/tmp/h/.npm \
  -v "$PWD:$PWD" -w "$PWD" \
  node:24-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54 \
  npm install --save-exact <pkg>@<version> --workspace @hcm/<name>
```

- Versions are exact (`.npmrc` `save-exact=true`); the latest stable release, unless a hold is recorded in [CI_PIPELINE.md](CI_PIPELINE.md) → *Held dependencies*.
- A new workspace with registry dependencies of its own also needs its `COPY <dir>/package.json <dir>/` line in the `manifests` stage of `docker/Dockerfile.quality`, which drops the manifests' scripts and writes the workspaces' versions as 0.0.0, so neither an npm script edit nor a release's version bump rebuilds the image's npm layer; a workspace whose dependencies are all workspaces (`create-historic-city`) needs none ([research/DECISIONS-for-review.md](research/DECISIONS-for-review.md) §63b).
- A workspace's link in the lockfile needs no download: `npm install --package-lock-only --offline --ignore-scripts` in a scratch copy of the manifests, in the pinned Node image with `--network=none`, then copy the lockfile back (how `create-historic-city`'s entries were made).
- Run `npm audit --audit-level=low` afterwards (the `static` stage does); fix advisories with `overrides`, never an allowlist.

## One tool inside the image

```bash
docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp/hcm-home -v "$PWD:$PWD" -w "$PWD" hcm-quality:local \
  bash -c 'mkdir -p $HOME && npx vitest run --project ui'
```

Use the same pattern for `npx eslint`, `npx prettier --write`, `npx markdownlint-cli2`, `ruff`, `mypy` or `python3 -m pytest`. More in [.agent/workflows/test.md](../.agent/workflows/test.md).

## Git hooks

```bash
git config core.hooksPath scripts/git-hooks
```

- `scripts/git-hooks/pre-commit`: refuses staged secrets (`.env*` except `.env.example`, `.sonar-token`, `.secret.local`, service-account JSON, `*.p12`), runs the inline-suppression scan on the staged index and gitleaks on the staged changes. Hooks are local and optional, so the same file list is also the `repo-policy` static gate, and CI scans every pushed commit with `gitleaks-history`.
- `scripts/git-hooks/commit-msg`: refuses a message that is not Conventional Commits, `type(scope): summary` (types `feat`, `fix`, `docs`, `refactor`, `test`, `build`, `ci`, `perf`, `chore`, `revert`; a lower-case scope is required, `chore(wip): ...` for work in progress; `!` before the colon for a breaking change; subject at most 100 characters; a blank line before the body). It runs `scripts/ci/check_commits.py --message-file -` in the quality image with the message on stdin. Comment lines and the scissors section are ignored, and git's own `Merge ...` and `fixup!`/`squash!`/`amend!` subjects pass (squash the latter before a pull request: the `commits` gate refuses them in CI).
- `scripts/git-hooks/pre-push`: refuses a push to `master` or a `v*` tag unless `reports/pipeline/green-all.json` names the pushed commit and a clean tree.

Work branches are pushed without a marker (backups after each commit); the hooks run their tools inside the quality image. No husky, lefthook or pre-commit framework. Hooks are local and optional, so CI repeats each check over the pushed commits: `repo-policy` (secret files), `gitleaks-history` and `commits`.

## Local environment file

Local, non-committed settings go into `.env.local` (git-ignored). The template `.env.example` (planned, added with the first setting the build reads) holds placeholders only. Nothing secret is needed for development: tests use the `demo-hcm` emulator project and generated test credentials, and `api.mapbox.com` is served from fixtures. The Mapbox public token for production builds comes from CI configuration; the Firebase web config is never committed (the admin reads `/__/firebase/init.json` on Hosting).

## Firebase emulators

```bash
docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp/hcm-home -v "$PWD:$PWD" -w "$PWD" hcm-quality:local \
  bash -c 'mkdir -p $HOME && npx firebase emulators:exec --project demo-hcm --only firestore,storage "npx vitest run --project rules"'
```

The emulator JARs are in the image (`FIREBASE_EMULATORS_PATH`); `demo-hcm` needs no login. **Always pass `--project demo-hcm`**: `.firebaserc`'s `default` is the real Firebase project `bucurestiul-disparut` (the deploy target), so a command without it would start the emulators for that project. Emulator logs (`firebase-debug.log`, `firestore-debug.log`, `pubsub-debug.log`) are git-ignored. Details: [TESTING.md](TESTING.md) → *Emulators*.

The Cloud Functions deploy artifact and the Functions emulator on it:

```bash
docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp/hcm-home -v "$PWD:$PWD" -w "$PWD" hcm-quality:local \
  bash -c 'mkdir -p $HOME && npm run build --workspace @hcm/functions'   # functions/dist (checked, then loaded)
docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp/hcm-home -v "$PWD:$PWD" -w "$PWD" hcm-quality:local \
  bash -c 'mkdir -p $HOME && npx firebase emulators:exec --project demo-hcm \
  --only functions,firestore,auth,storage,pubsub,tasks "echo up"'      # loads all 35 functions
```

In the emulator the functions keep secrets in memory and reach Google, Mapbox and USGS only through the fake upstreams at `HCM_UPSTREAM_BASE` (unset: every such call fails like a network error), so a local run can never touch a real service.

## Local stack for manual testing

One command starts the whole product on this machine, seeded with a Bucharest city and a second city (Bacău), without touching the cloud: the admin (its `e2e` build), the viewer (the e2e Bucharest site), the Firebase emulators of project `demo-hcm` (auth, firestore, storage, functions from `functions/dist`, pubsub, tasks) and the mock APIs of the e2e world (fake Google Cloud, Mapbox, USGS, STAC, Nominatim, Google's consent stand-in, the raster pipeline's stand-in runner). It runs inside the quality image like every gate (no host-home mount); the walk-through that uses it is [MANUAL_TEST_PLAN.md](MANUAL_TEST_PLAN.md).

```bash
npm run dev:stack                        # or: bash scripts/dev/dev-stack.sh; Ctrl+C stops it (the emulators shut down cleanly)
HCM_STACK_SEED=fresh npm run dev:stack   # a new map instead: start-up mode, Setup from the first sign-in
HCM_STACK_TICKS=0 npm run dev:stack      # without the scheduler clock (imagery.tick and ops.tick every 15 min)
bash scripts/dev/dev-stack.sh tick       # run imagery.tick and ops.tick once, now (from another terminal)
bash scripts/dev/dev-stack.sh check      # the stack's own check (below)
bash scripts/dev/dev-stack.sh stop       # stop it from another terminal
```

**A version's own tiles on the local stack** (M12): the emulator's signer names the Storage emulator, which refuses a browser without the owner's header, so `imagery.previewUrl`'s address fails there and a version's page says **The image's full detail could not be read**, its small picture on the map. That is the signer's stand-in and not the feature; the e2e tier answers that address from the object (`e2e/admin/specs/imagery/own-tiles.spec.ts`).

The first start builds the e2e sites and the admin's e2e bundle (a few minutes; later starts skip the build when no input changed, `scripts/ci/e2e_build.py`), starts the emulators (a minute or two), seeds the world and prints the addresses. Always open them with `127.0.0.1`, never `localhost` (the functions' CORS and the consent stand-in name exactly these origins):

| What | Address |
| --- | --- |
| Admin | `http://127.0.0.1:4312/admin/` (M6: the e2e Hosting server; the stack sends its root `http://127.0.0.1:4312` there) |
| Viewer | `http://127.0.0.1:4310/bucharest/` (`/` redirects there) |
| Any other city's page (M5) | `http://127.0.0.1:4310/<city>/`, as `http://127.0.0.1:4310/bacau/` |
| The e2e Pages tree, the starter kit | `http://127.0.0.1:4310/pages/` (`/pages/e2e-second/`, `/pages/e2e-unpublished/`), `http://127.0.0.1:4310/kit/` |
| Mock APIs (control: `/__upstream/scenarios`, `/__calls`) | `http://127.0.0.1:4311` |
| Emulators (`firebase.json`) | auth 9099, firestore 8080, storage 9199, functions 5001, pubsub 8085, tasks 9499, hub 4400 |

- **Sign in**: Sign in with Google (Conectează-te cu Google) opens Google's consent stand-in in a frame over the page; `owner@e2e.test` is preselected, Allow. The other generated test accounts: `admin@e2e.test` (an admin who joined), `editor@e2e.test` (a pending invitation: the join panel), `stranger@e2e.test` (not an admin: the blocked panel). No password exists anywhere; the stand-in is the only "Google".
- **The seeded city** (`HCM_STACK_SEED=city`, the default; `e2e/stack/seed.ts`): Setup's required steps green (`setup/status`, and the fake upstreams in the same state: provisioned, deployed, M2M downloads approved, Analytics linked, two crash groups; Mapbox connected through the server's own `setup.saveMapbox` with the fake's generated bootstrap token, so the Functions emulator's in-memory secret store holds it and a city made with New city gets its viewer token), the budget guard green; 13 photos (twelve legacy Bucharest photos with their real derivatives, two of them unpublished, and one upload whose processing failed), four place categories and seven places (points, a street, two areas, one draft), two linked layers (`plan-1911` on the e2e tile host, `corona-1968` on the e2e Mapbox account), an edited place (History has an update to revert), the USGS harvest of the fake catalogue, M4's orders (the 1968 Corona frame `DS1105-1071DF076` to buy, its preview seeded; the Declass 3 frame `D3C1209-100055F012` marked as ordered with `usgs.markOrdered`, so its card shows the watch), and four imports: a draft over the RMSE threshold waiting for Approve, one waiting for georeferencing points with the matcher's suggested pairs, one failed at warp (Retry), and the 1980 frame, published by the fake MTS about two minutes after the start. The failed import, the draft and the version waiting for points reach every admin's inbox (Notifications) through the server's own events. The fake USGS delivers the ordered scans after `curl -X POST 'http://127.0.0.1:4311/__upstream/scenario?test=' -H 'content-type: application/json' -d '{"name":"usgs.ordersDelivered"}'` (then **Check now**, or the next daily check). The viewer shows the manifest the emulators published (the e2e fixture manifest before the first build).
- **The old photos' import** (Setup step h): the admin's bundle holds 57 photos, the 45 of `seed/bucharest/` and the old site's 12 additions of 2023 (`seed/bucharest-2023/`, `docs/research/M5-interfaces.md` §12). The seeded city has 12 of them, two unpublished (never published, so the import may publish them), so the card offers **Importă fotografiile care lipsesc (47)**: it imports the other 45 (Parc Ferdinand with the old site's direction) and publishes those two; the seeded credits lack the 2023 photos' author, so the card also says **Mulțumirile nu îi numesc încă pe toți autorii fotografiilor vechiului site.** and the same click adds Studiourile Buftea. The old site's later directions (`seed/bucharest-2023/corrections.json`, M5 §12 → *Directions from the old site*) are remade from its live `geojson/photos.json` with `node scripts/seed/legacy-corrections.mjs --later <that file>` in the quality image; it reports every photo (corrected, had it, no cone). To remake the additions' derivatives: `node scripts/seed/migrate-legacy.mjs --city-dir seed/bucharest-2023 --joins seed/bucharest` in the quality image (`--joins` keeps their ids clear of the 45's).
- **The second city** (M5, `e2e/stack/seed-cities.ts`; Bacău since the owner's decision of 2026-11-06, and first by name, so the project owner's first visit opens it, not București): **Bacău** (`bacau`), made with the server's own `cities.create` and `setup.rotatePublicToken` as New city makes it (its start view, texts, per-city limits and viewer token), unpublished, with a category and two places, the project owner's alone (`admin@e2e.test` stays an editor of București only, so the city menu, the per-city roles and budgets and the isolation between cities each have a city to show). Its first USGS search runs at the next `imagery.tick` and finds nothing: the fake catalogue has scenes over Bucharest only. The fake Nominatim finds only Cluj-Napoca (and Cluj), so New city can still make it; any other name leaves the rectangle to drag.
- **A city's page**: the site server answers `http://127.0.0.1:4310/<city>/` for every city id no built site holds: the Bucharest site's page and engine (its tab title stays București dispărut), a `config.js` naming the city and the manifest the emulators published for it, or 404 before the city is published (the page then says the map could not be found), as `site:add` and `build:site` would make it for a city made in the admin.
- **Nothing leaves the machine**: the admin and site servers put a shim first into every page (`e2e/stack/browser.ts`) that points every address of a host off this machine (the page's requests, what its elements load, and a file it saves itself through an `<a download>` it clicks, as the export's **Download**) at the same origin's `/__stack/h/<host>/<path>`, where the server forwards it to the mock APIs, reads it from the Storage emulator or refuses it (403, logged) with the e2e firewall's own host table (`e2e/mock-apis/hosts.ts`). The map's basemap is the mock style (a plain background and tile labels), the historical layers are solid colours: the real Mapbox, Google and USGS answers are LIVE only. A link a person follows (EarthExplorer, Mapbox Studio, a Google console) is left alone and opens the real site: check its address instead.
- **Logs**: `reports/dev-stack/emulators.log` (every function's log) and `reports/dev-stack/mock-apis.log`.
- **The Claude browser pane** opens the stack through `.claude/launch.json`: `dev-stack` starts it (or follows one already running), `dev-stack-admin` and `dev-stack-viewer` open a running one. The pane cannot register a service worker (hence the shim, not a worker), opens a popup in place of its page (hence the consent frame) and, on this machine (2026-10-24), has no WebGL: its maps show their no-WebGL state, so the map items of the test plan run in Chrome (Claude in Chrome, or your own) at the same addresses.
- **The stack's check**, `bash scripts/dev/dev-stack.sh check` (`e2e/stack/check.ts`, headless Chromium like the pane, every request off the machine aborted and reported): the owner signs in with the stand-in and lands on the dashboard, Photos lists the seeded photos, Historical imagery lists the harvested scenes, the frame to buy has its order card and the ordered one is watched, the inbox lists the server's events, a layer's editor draws its tiles through the mock Mapbox, the second city opens from its address (`#/c/bacau/home`) and its page answers on the site, the viewer shows the emulators' manifest, and no request reached the network for a host off this machine. It ends with `[SUCCESS] the local stack works`.
- **Limits**: the data start again at every start (the emulators keep nothing); the stack and a Playwright run of the pipeline coexist (the pipeline's container has its own network), but two stacks do not (the start refuses busy ports); the admin's start-up deploy differs from `fresh` only in that the stack's server exists from the start, so step (d) turns green once the fake lists the functions: `curl -X POST 'http://127.0.0.1:4311/__upstream/scenario?test=' -H 'content-type: application/json' -d '{"name":"google.deployed"}'`.

## The local AI (M10)

`docs/research/M10-local-ai.md`. No gate needs a graphics card, weights or PyTorch: the tests use a fake `torch`, a fake network of real ORB keypoints and stand-ins of `docker` and `curl`. On a real worker it asks for nothing until a frame needs it, then fetches about 10 GB once: the 9.68 GB `pytorch/pytorch` image by digest from Docker Hub and about 0.3 GB of weights and wheels from their upstreams.

- **What it needs:** Docker, 30 GB free where Docker keeps its images, and, for the graphics card on Linux, the NVIDIA driver and `nvidia-container-toolkit`. Without a card it runs on the processor, much slower, and says so in the log and on the panel. Measured path: `--gpus all`, Linux. **UNVERIFIED:** CDI (`--device nvidia.com/gpu=all`), Docker Desktop on Windows, the PowerShell loop. macOS's Docker gives no graphics card, and arm64 is not supported.
- **See it run:** `journalctl --user -u hcm-worker` shows `local AI: graphics card found` or `local AI: no usable graphics card; using the processor (slower)`; `docker logs hcm-matcher` shows the sidecar's own while a frame wants it: it is removed when none does. On Windows only the sidecar's own log has the lines of the run.
- **Update the pins:** `pipeline/src/hcm_pipeline/matcher/pins.json`. Read the upstream's licence first and record it in `matcher/NOTICE.md`.

## A city's public site and the GitHub Pages tree

Every `sites/<city>/` with a `site.json` is a city's public site (M5, [research/M5-interfaces.md](research/M5-interfaces.md) §1.10). A city made in the admin gets its site as a repository change, because the admin holds no GitHub credential:

```bash
docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp/hcm-home -v "$PWD:$PWD" -w "$PWD" hcm-quality:local \
  bash -c 'mkdir -p $HOME && npm run site:add -- --city cluj-napoca --name-ro "Cluj-Napoca" --theme "#5B7F3A"'
docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp/hcm-home -e HCM_PUBLIC_BUCKET=<project>-public -v "$PWD:$PWD" -w "$PWD" hcm-quality:local \
  bash -c 'mkdir -p $HOME && npm run build --workspace @hcm/engine && npm run build:site'
```

- `site:add` writes `sites/<id>/site.json` (`pagesPath: "<id>/"`, `publicManifest: true`), `config.js` and Bucharest's `site.css`, and refuses an id that is no usable city id or a site that exists; commit and push it like any other change (ask first).
- `build:site` builds each site into `dist/site/<city>/` and assembles `dist/pages/`: Bucharest at the root, every other city at its `pagesPath`; since M6 also the Pages redirect tree `dist/pages-redirect/` (below). A site without a seed snapshot is built only with `HCM_PUBLIC_BUCKET` named (it reads what the admin publishes); without it the build skips it with a notice. The city appears once it is published in the admin (Settings → Publishing).

## The Firebase Hosting site (M6)

The public map lives on Firebase Hosting at the project's own address, with the admin under `/admin/` ([research/M6-interfaces.md](research/M6-interfaces.md) §2): `npm run build:hosting` (Hosting's `predeploy`) builds the admin and the engine, then every committed city site for Hosting (each reading the public bucket `<projectId>-public`, or `HCM_PUBLIC_BUCKET`), the generic city page that serves every city made in the admin (no `site:add` needed for Hosting), and assembles the tree:

```bash
docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp/hcm-home -v "$PWD:$PWD" -w "$PWD" hcm-quality:local \
  bash -c 'mkdir -p $HOME && npm run build:hosting'        # dist/hosting-public (public) and dist/hosting (the same, deployed)
docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp/hcm-home -e HCM_ADMIN_START_UP=1 -v "$PWD:$PWD" -w "$PWD" hcm-quality:local \
  bash -c 'mkdir -p $HOME && npm run build:hosting'        # dist/hosting is the start-up variant: a new map's first deploy (D1)
```

- `dist/hosting-public/` is always the **public** variant: the first city's site at `/` (with `admin-redirect.js`: an old admin address `/#/<route>` goes to `/admin/#/<route>`), every other committed city at its `pagesPath`, the generic city page at `/city/` (Hosting rewrites any other city id to it), the admin at `/admin/`, `release.json` (`{release, variant}`), the bilingual `404.html`. The installer's `hosting.tgz` is made from it (without the old photos' originals, which travel in `legacy.tgz`: DECISIONS-for-review.md §73k), and the admin's **Publish the map** releases it, with the originals while the legacy import is not complete.
- `dist/hosting/` (`firebase.json` → `hosting.public`) is what this deploy publishes: the **start-up** variant with `HCM_ADMIN_START_UP=1` (a bilingual "this map is being set up" page at `/`, no engine and no Mapbox, the admin's `runtime.json` with `startUp: true`), else the public one.
- **The admin's own site** (DECISIONS-for-review.md §210): Setup's Update the map makes `<projectId>-admin` (Provision's `admin-site` item) and the site build releases the admin there, the public map's `/admin/…` forwarding to it. A deploy from a checkout does the same in two commands once the site exists: `npm run split:admin-site -- --config <firebase json> --site <projectId>-admin` (the built tree moves the admin to `<public>-admin/`, and the configuration gains the second site), then `firebase deploy --only hosting`. Without the site, nothing changes: the admin stays under `/admin/`.
- `firebase.json`'s Hosting rules are read by `scripts/site/src/admin/hosting.ts` exactly as Hosting's engine reads them, so the e2e Hosting server (`e2e/mock-apis/admin-server.ts`, `127.0.0.1:4312`, every e2e run) serves the e2e build's tree (`dist/e2e-hosting`, the start-up variant `dist/e2e-hosting-start-up` to a browser with the cookie `hcm-e2e-variant=start-up`) with the same redirects, rewrites and headers. The admin's CSP is a header on `/admin/**` only; each viewer page keeps its own meta policy.
- To retire the old GitHub Pages site without breaking its links: `npm run build:site` also writes `dist/pages-redirect` (its `--pages-redirect` option), a tree whose every page sends the visitor to the same page on `https://<projectId>.web.app/` with the same hash (publishing it instead of the old site is a workflow line, DECISIONS-for-review.md §67c, ask first). The e2e build writes it to `dist/e2e-site/pages-redirect/`, pointed at the e2e Hosting server. The owner retired the old site with v1.0.0-beta.1 (DECISIONS-for-review.md §161): merging the rewrite into `master` deletes its files and the owner turns GitHub Pages off; the live map is `https://bucurestiul-disparut.web.app/`.

## The starter kit and create-historic-city

The kit a new city copies is `templates/starter-kit/` (M5): its page is committed and linted as it is (htmlhint, html-validate with `require-sri`, Prettier), its engine block is pinned by the release (`fillKitPage` of `packages/shared/src/kit/page.ts`; before the first release it carries placeholder digests) and the Mapbox GL JS digests are those of the pinned `mapbox-gl` package (a unit test recomputes them). The CLI is `packages/create-historic-city/` ([SELF_HOST.md](SELF_HOST.md) for owners). Everything runs in the quality image:

```bash
docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp/hcm-home -v "$PWD:$PWD" -w "$PWD" hcm-quality:local \
  bash -c 'mkdir -p $HOME && npx vitest run --project create-historic-city'      # its unit tests over fakes
docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp/hcm-home -v "$PWD:$PWD" -w "$PWD" hcm-quality:local \
  bash -c 'mkdir -p $HOME && npm run build --workspace create-historic-city'      # one bundled cli.mjs and the kit beside it
docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp/hcm-home -v "$PWD:$PWD" -w "$PWD" hcm-quality:local \
  bash -c 'mkdir -p $HOME && cd /tmp && node '"$PWD"'/packages/create-historic-city/dist/cli.mjs my-city --yes --dry-run'
```

- The start site (`npm run build:start`, after `build:hosting`; its `start-build` gate; `HCM_START_OAUTH_CLIENT_ID` opens it, for the live site the Web client of the Google Cloud project `start-historic-city`, M14 §10; `HCM_START_SITE_VERIFICATION`, Search Console's `google<hex>.html`, writes that file at the root): `dist/start/` with `privacy.html` and `terms.html`, deployed apart (`docs/research/M14-start-your-map.md` §5).
- The landing page GitHub Pages serves (`npm run build:landing` writes `sites/landing/`, which is committed; the static `landing` gate holds it to the build, and `.github/workflows/pages.yml` publishes it on a push to `master`; DECISIONS-for-review.md §162). Run it after `npm run release:bump`, since the page names the CLI at the release.
- The self-host bundle (`npm run build:self-host`, which builds the admin and the functions for production first; the `release` stage's `self-host-bundle` gate assembles it before `release-pack`) is the admin's production build without Bucharest's legacy import, the functions' artifact, the rules and a `firebase.json` template; a release's CLI carries it, and the admin's e2e build is refused. Without it, `self-host` stops at step 6 and names a released version. `--experimental`, from older command lines, is accepted and changes nothing ([SELF_HOST.md](SELF_HOST.md)).
- Never run `self-host` or `deploy` against a real project from an agent: they run the owner's own `firebase` and `gcloud`, which create cloud resources (ask first; the user runs them in their own terminal). The e2e rows S-V29-* run the built CLI with fake tools only.

## SonarQube Cloud token (the user, once)

1. Sign in to SonarCloud (organisation `ventura8`) and create a token; make sure Automatic Analysis is off for the project.
2. Run `python3 scripts/ci/sonar_setup.py` (planned): a hidden prompt writes the git-ignored `.sonar-token` with mode 0600.
3. Run `gh secret set SONAR_TOKEN` and paste the token on stdin, for the CI job.

Agents never read, print or paste the token. The `sonar` stage (part of `all`) reads `SONAR_TOKEN` from the environment (`scripts/ci/run-all-checks.sh` forwards it by name) or `.sonar-token`; without either it prints `[sonar] [SKIP] ...` and passes, so `all` is green on a machine without a token. With a token it first checks that the `tests` stage's reports exist (run `all`, or `tests` before `sonar`), then scans with the SonarScanner in the quality image and applies the strict verdict. The CI `sonarqube` job skips with a notice when `SONAR_TOKEN` is missing.

## Cloud credentials (the user, once)

- `firebase login` (`npx -y firebase-tools@15.36.0 login`) and `gcloud auth login` are run by the user in their own terminal. Agents never run `login:ci`, create keys or type credentials.
- Deploys go through CI with Workload Identity Federation; a manual deploy is an explicit, one-time decision ([.agent/workflows/deploy.md](../.agent/workflows/deploy.md)).

## Housekeeping

- A browser crash in a container writes `core.<pid>` into the repository root; it is git-ignored, delete it.
- `reports/` holds every pipeline output and is git-ignored.
- `node_modules/.hcm-install-stamp` records the lockfile hash of the last in-container install; delete it to force `npm ci`.
