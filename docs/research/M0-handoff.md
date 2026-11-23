# M0 hand-off: monorepo scaffolding and quality pipeline

Written by the M0 foundation agent on 2026-10-11 for the agents that build M1+ on top of it.
Read this together with `PLAN.md`, `quality-conventions.md`, `design-review-testability.md` and
`design-review-security-cost.md`. Where this file and those disagree, this file records what was
actually built and why.

## 1. Status

| Item | State |
| --- | --- |
| `PIPELINE_STAGE=static bash scripts/ci/run-all-checks.sh` | `[SUCCESS] stage 'static' passed` (49 gates; §10e added six, §10f `commits`) |
| `PIPELINE_STAGE=tests bash scripts/ci/run-all-checks.sh` | `[SUCCESS] stage 'tests' passed` (5 gates): Vitest over 6 projects (shared, ui in Chromium, engine, admin, functions, rules) under the emulators, rule coverage, pytest, the pipeline's pytest, and the per-file `coverage` gate at 100% overall |
| `PIPELINE_STAGE=e2e bash scripts/ci/run-all-checks.sh` | `[SUCCESS] stage 'e2e' passed` (2 gates: `e2e-matrix`, `playwright` with the V00 harness smoke) |
| `PIPELINE_STAGE=build bash scripts/ci/run-all-checks.sh` | `[SUCCESS] stage 'build' passed` (2 gates: `vite-build`, `bundle-budget`) |
| `quality` | passes (static, tests, e2e, build) |
| `sonar` | `[SUCCESS]`: gate `sonar` (§10f); without `SONAR_TOKEN` or `.sonar-token` it skips with a notice, so `all` passes too |
| `deps` | gate `dependency-updates` (§10f); network-bound and weekly, it fails while a pin is behind (2 on 2026-10-12) |
| `release`, `contract` | registered (§10) |
| Quality image | `docker/Dockerfile.quality` builds as `hcm-quality:local` (5.3 GB unpacked; about 5 min cold, seconds when cached) |
| Lockfile | `package-lock.json` (lockfileVersion 3), `npm ci` works in the image |

Nothing was committed or pushed (the orchestrator commits).

## 2. Toolchain and pins

All npm versions were checked with `npm view` on 2026-10-11 and are pinned exactly (`.npmrc`
`save-exact=true`). Node `>=24.12.0` is enforced (`engines` + `engine-strict=true`).

| Area | Pin |
| --- | --- |
| Node / npm | Node 24.22.3, npm 11.19.1 (from `node:24-bookworm-slim`) |
| TypeScript | `typescript@6.0.3` **HELD**: `typescript-eslint@8.72.2` peers `typescript <6.1.0` (latest is 7.0.2) |
| Build / test | `vite@8.3.8`, `vitest@5.1.0`, `@vitest/coverage-v8@5.1.0`, `@vitest/browser-playwright@5.1.0`, `playwright@1.65.1`, `@playwright/test@1.65.1` (`@hcm/e2e`) |
| Lint | `eslint@10.15.0`, `@eslint/js@10.0.1`, `typescript-eslint@8.72.2`, `eslint-plugin-sonarjs@4.2.2`, `eslint-plugin-no-unsanitized@4.1.5`, `eslint-plugin-lit@2.3.1`, `eslint-plugin-wc@3.1.0`, `@vitest/eslint-plugin@1.6.28`, `eslint-config-prettier@10.1.8`, `globals@17.14.0` |
| Format / style | `prettier@3.10.1`, `stylelint@18.0.0`, `stylelint-config-standard@41.0.0`, `postcss-lit@1.4.1` |
| HTML / Markdown | `htmlhint@1.9.2`, `html-validate@11.21.1`, `markdownlint-cli2@0.24.1` |
| Architecture | `knip@6.45.1`, `dependency-cruiser@18.7.2` |
| Runtime | `lit@3.3.3` (in `@hcm/ui`); `zod@4.6.7` (`@hcm/shared`), `@material/material-color-utilities@0.4.0` (`@hcm/ui`), both added by the M1 contracts (§10g); `firebase@13.3.0` (`@hcm/engine`, the lazy analytics chunk, M1); `web-vitals@6.2.3` (`@hcm/engine`, `@hcm/admin`: the lazy field chunks after consent, `DECISIONS-for-review.md` §76) |
| UI kit build (M1) | devDependencies of `@hcm/ui`: `harfbuzzjs@1.6.4`, `wawoff2@2.0.1`, `material-symbols@0.49.0`, `@fontsource-variable/roboto-flex@5.3.0` (`npm run fonts:build`/`fonts:check`); `axe-core@4.14.0` (`@hcm/test-support`, entry `@hcm/test-support/axe`) |
| E2E (M1) | devDependencies of `@hcm/e2e`: `@axe-core/playwright@4.13.0` (held, lesson 294), `mapbox-gl@3.34.1` (served by the mock APIs, never bundled), `sharp@0.35.5` |
| Seed tooling | `sharp@0.35.5` (root devDependency, the legacy migration CLI; prebuilt `@img/sharp-linux-x64`) |
| Firebase CLI | `firebase-tools@15.36.0` (root devDependency; emulator JARs baked into the image) |
| Types | `@types/node@24.19.2` (Node 24 line, not the 26.x latest) |
| Python CI tools | `scripts/ci/requirements.txt`: ruff 0.17.5, mypy 2.4.1, pytest 9.2.0, pytest-cov 7.1.0, pytest-xdist 3.8.0 (2026-10-17), coverage 7.17.3, yamllint 1.38.0, check-jsonschema 0.39.0, bandit 1.9.4, pip-audit 2.10.1, radon 6.0.1, defusedxml 0.7.1, editorconfig 0.17.1, requests-mock 1.12.1, taplo 0.9.3, plus every transitive dependency pinned; pip 26.2.1 |
| Python | 3.14.4 (the GDAL image's interpreter). The raster pipeline uses `requires-python = ">=3.14,<3.15"` (§10c) |

Not added yet (add with the milestone that first imports them, so knip stays clean): `msw`, `jsdom`; `mapbox-gl` as
a devDependency of `@hcm/engine` waits for the engine's browser project (CR-2: the adapter uses a structural type and
the page's global, so nothing imports it). `@m3e/web` 2.10.0 and `@material/web` 2.5.0 were checked in M1 and not
adopted (`packages/ui/README.md` → *Decisions*). (`firebase`,
`@firebase/rules-unit-testing` and `@playwright/test` joined in M0: §10b, §10d; `zod`,
`@material/material-color-utilities` and `sharp` in M1: §10g.)

### npm audit fixes (no allowlist)

`npm audit --audit-level=low` reports 0 vulnerabilities thanks to `overrides` in the root `package.json`:

| Override | Why |
| --- | --- |
| `@opentelemetry/core` → 2.12.0 | GHSA-8988-4f7v-96qf; pulled by `@google-cloud/pubsub@5` in firebase-tools (pubsub 6 itself moved to 2.x; only `W3CTraceContextPropagator` is used) |
| `@firebase/firestore@4.20.0` → `@grpc/grpc-js` 1.14.7 | GHSA-m9gg-hp2v-232j, GHSA-f596-whhp-79r4; firestore still pins `~1.9.0` (the key follows `firebase` 13.3.0's firestore since 2026-11-14) |
| `basic-ftp` → 6.2.4 | GHSA-c475-qrg2-pj4r; firebase-tools → proxy-agent → get-uri (only `Client` is used) |
| `gaxios@6.7.1` → `uuid` 11.1.1 | GHSA-w5hq-g745-h8pq; gaxios only calls `v4()`; uuid 11 is the last CJS-compatible line |
| `glob` → 14.0.3 | GHSA-3g3m-2fjr-6pw4 (9.0.0–14.0.1): `rimraf` 5 and `gaxios` 7 (also in `functions/deploy-lock`), `archiver-utils`, `exegesis`, `firebase-tools`, `htmlhint`; every one calls `glob`, `sync` or `globSync`, which 14 keeps (§74) |
| `katex` → 0.19.1 | GHSA-238p-pmpm-9mq7 (markdownlint math extension) |
| `re2js` → 2.9.1 | GHSA-gg6h-894w-4m9c (2.2.0–2.8.6): `markdownlint@0.42.0` pins 2.8.6, `@firebase/firestore` takes `^2.8.3` (§72c, §74) |
| `smol-toml` → 1.9.1 | GHSA-r4xh-jqrq-34v2 (markdownlint-cli2, knip) |
| `minimatch` → `$minimatch` = `file:vendor/npm/minimatch` | GHSA-g3hv-75wg-m249 (below 11.0.1); 11 is a rewrite whose CommonJS entry is not callable, and `firebase-tools` (`fsAsync`) and `superstatic` call `require('minimatch')(...)`, so `vendor/npm/minimatch` is 11.0.3 unchanged plus a callable `index.cjs` (see its README; §74f). The install bundle's `tools/` carries it. Delete it when those dependants move to 11 |
| `braces` → `$braces` = `file:vendor/npm/braces` | GHSA-vfj7-8cjw-p6xm has **no** fixed release; `vendor/npm/braces` is 3.0.3 with the depth-limit patch the sibling Whisper-Pro-ASR repo carries (see its README). Delete it when upstream ships a fix |

`vendor/` is third-party code: it is excluded from ESLint, Prettier, markdownlint, yamllint,
taplo, ruff and the suppression scan, and knip ignores the `braces` and `minimatch` dependencies.

## 3. Docker images and digests

| Image | Pin |
| --- | --- |
| Dockerfile frontend | `docker/dockerfile:1.29.0@sha256:572cebbc2b15e6f84c077742952674889cb63cd5e9b80abdffcbe587b6f19183` |
| Base | `ghcr.io/osgeo/gdal:ubuntu-small-3.13.3@sha256:64250faf833c06d4b21afce4c27190039ba7ab58d70f0eebc87cf77d929c0b40` (Ubuntu 26.04, Python 3.14.4, GDAL 3.13.3, `osgeo` in `/usr/lib/python3/dist-packages`) |
| Node | `node:24-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54` (same digest as `node:24-slim`) |
| actionlint | `rhysd/actionlint:1.7.12@sha256:b1934ee5f1c509618f2508e6eb47ee0d3520686341fec936f3b79331f9315667` |
| hadolint | `hadolint/hadolint:v2.15.1-debian@sha256:9a3944b7fddcb947d1ffd90829ac1a6e5c30479223358f249d8b96c7d0019e27` |
| shellcheck | `koalaman/shellcheck:v0.11.0@sha256:61862eba1fcf09a484ebcc6feea46f1782532571a34ed51fedf90dd25f925a8d` |
| shfmt | `mvdan/shfmt:v3.14.1@sha256:8c06884a35683d8763fba6c0d9484d11a61a96da65f8d497d6f625825a6043f2` (newer than the 3.13.1 in the conventions doc) |
| gitleaks | `zricethezav/gitleaks:v8.30.1@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f` |

apt pins (Ubuntu 26.04): `openjdk-21-jre-headless=21.0.13*`, `git=1:2.53.0*`, `curl=8.18.0*`,
`python3.14-venv=3.14.4*`. Playwright's `install --with-deps chromium firefox webkit` works on
26.04 as is.

What the image contains, and where:

- `/opt/hcm/venv`: Python CI tools (first on `PATH`). It is a plain venv without system site
  packages; the GDAL pipeline has its own venv (next bullets).
- `/opt/hcm/poetry`: Poetry 2.5.1 in its own venv (`pipeline/requirements-poetry.txt`), and
  `/opt/hcm/pipeline-venv`: the pipeline's locked runtime and dev dependencies, created with
  `--system-site-packages` (so `osgeo` is importable) and `--without-pip` (§10c).
- `/opt/hcm/npm-cache` (`npm_config_cache`): the npm cache filled by a build-time `npm ci`. The
  build-time `node_modules` is deleted; the runtime installs from this cache.
- `/ms-playwright` (`PLAYWRIGHT_BROWSERS_PATH`): Chromium, Firefox, WebKit for Playwright 1.65.1.
- `/opt/hcm/firebase-emulators` (`FIREBASE_EMULATORS_PATH`): Firestore, Storage and Pub/Sub
  emulator JARs (`npm run emulators:setup`). World-writable so any uid can use them.
- `ENV HCM_TEST_IMAGE=1`, `USER 10001:10001`, `git config --system safe.directory '*'`.
- `ENV LD_PRELOAD=""`: the GDAL base image preloads `libtcmalloc_minimal.so.4` into every
  process, and Chromium aborts under it (`tcmalloc: Attempt to free invalid pointer`, SIGILL).
  Keep this in the quality image; the pipeline's `runtime` image keeps tcmalloc for GDAL.
- BuildKit cache mounts: `hcm-apt-cache`, `hcm-apt-lists`, `hcm-pip`, `hcm-poetry`.

`.dockerignore` is an allowlist (root manifests, `packages/*/package.json`, `functions/package.json`,
`firebase/rules-tests/package.json`, `e2e/package.json`, `vendor/npm/braces`, `vendor/npm/minimatch`, `scripts/ci/requirements.txt`
and the three pipeline dependency files), so the image only rebuilds when a manifest changes.
**When you add a workspace, add its `COPY <dir>/package.json <dir>/` line to the Dockerfile**
(and a `!<dir>/package.json` line to `.dockerignore` if it is outside `packages/*`); `npm ci`
fails in the build otherwise.

## 4. Running things

Everything that is a gate runs in the image. Never trust the host Node (22) or host Python.

```bash
PIPELINE_STAGE=static bash scripts/ci/run-all-checks.sh   # or tests, build, quality, all (default)
```

`run-all-checks.sh` builds the image (`scripts/ci/build-and-test.sh`, seconds when cached), then
runs `scripts/ci/in-container.sh` with `--user $(id -u):$(id -g)`, `HOME=/tmp/hcm-home`, the repo
at the same absolute path, and nothing else from the host. `in-container.sh` refuses to run without
`HCM_TEST_IMAGE=1`, then execs `python3 scripts/ci/pipeline.py --stage "$PIPELINE_STAGE"`.

Before the first gate, `pipeline.py` runs `npm ci --prefer-offline` into the bind-mounted
`node_modules` whenever `node_modules/.hcm-install-stamp` does not hold the SHA-256 of
`package-lock.json` (offline from the baked cache: about 1165 packages in about 10 s; free afterwards). Delete the
stamp to force it. The static gates then take about 35-55 s in total, the tests stage about 55 s (the
emulators start in about 8 s), e2e and build a few seconds each.

Ad-hoc npm commands (install a dependency, regenerate the lockfile), always in a container:

```bash
docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp/h -e npm_config_cache=/tmp/h/.npm \
  -v "$PWD:$PWD" -w "$PWD" \
  node:24-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54 \
  npm install --save-exact <pkg>@<version> --workspace @hcm/<name>
```

Ad-hoc commands with the full toolchain (ruff, vitest browser mode, tsc, ...):

```bash
docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp/hcm-home -v "$PWD:$PWD" -w "$PWD" hcm-quality:local \
  bash -c 'mkdir -p $HOME && npx vitest run --project ui'
```

## 5. Workspace conventions

- Root package `historic-city-map` (private, `type: module`). Workspaces: `packages/*`, `functions`,
  `firebase/rules-tests`, `e2e`. Packages: `@hcm/shared`, `@hcm/ui`, `@hcm/engine`, `@hcm/admin`,
  `@hcm/test-support`, `@hcm/functions` (§10b), `@hcm/rules-tests` (§10b), `@hcm/e2e` (§10d). Add a new
  workspace to `workspaces` only together with its `package.json` (npm fails on a path without one).
- Internal packages are **source-first**: `exports` points at `./src/index.ts`, there is no
  per-package build for consumers, and workspace dependencies are pinned to `"0.0.0"`.
- Relative imports use the **`.js` extension** (`import { ro } from './ro.js'`). It resolves under
  Vite, Vitest, `moduleResolution: bundler` and `nodenext` (functions), so shared code works everywhere.
- **Two TypeScript projects per package**: `<pkg>/tsconfig.json` (src only, no Node or Vitest
  types leak into product code) and `<pkg>/test/tsconfig.json` (`types: ["node"]`, plus
  `vite/client` where src imports CSS). Both are referenced from the root `tsconfig.json` solution;
  `tsc -b` type-checks everything (declaration-only output in `.tsbuild/`, gitignored).
  `tsconfig.tools.json` covers `vitest.config.ts` and `packages/*/vite.config.ts`.
  TypeScript 6 defaults to `types: []` and checks side-effect imports, hence the explicit `types`.
- Tests live in `<pkg>/test/**/*.test.ts`, never next to sources (Sonar `sources`/`tests` stay
  disjoint). Names: `happyPath_…` / `badPath_…` (TS), `test_happy_path_…` / `test_bad_path_…` (Python).
- `@hcm/test-support` is test-only (outside coverage, Sonar tests). Today it has
  `createRecordingSink()`; FakeMap, msw handlers and API fixtures go there in M1.
- Engine library build (`packages/engine/vite.config.ts`): formats `iife` + `es`, global
  `HistoricCityMap` (`window.HistoricCityMap`), files `dist/engine.iife.js`, `dist/engine.mjs`,
  `dist/engine.css` (`cssFileName`), `mapbox-gl` external mapped to the global `mapboxgl`
  (`build.rolldownOptions`, Vite 8). Admin is the same with `HistoricCityMapAdmin` / `admin.*`.
  `ENGINE_VERSION` and `MAPBOX_GL_VERSION = '3.32.0'` are exported by the engine.
- Lit: **no decorators** (ESLint bans the `Decorator` node). Declare reactive properties with
  `static override readonly properties = {...}`, `declare name: string;` fields and defaults in the
  constructor (required with `useDefineForClassFields: true`). Register with an idempotent
  `define…()` function. Custom element prefix `hcm-`. (`hcm-hello`, the scaffolding sample, was removed
  with its placeholder catalogue key; `hcm-chip` is a small example.)
- Logging: product TS logs only through `createLogger(scope, { sink, minLevel })` from
  `@hcm/shared` (`no-console` everywhere except `packages/shared/src/log.ts`). Data keys that look
  like secrets (`token`, `secret`, `password`, `authorization`, `signature`, `apiKey`) are redacted.
  Python CI scripts log through `scripts/ci/cilog.py` (`print` is banned by ruff T20).
- i18n: catalogues in `packages/shared/src/i18n/{ro,en}.ts`; `ro` is the key source of truth and
  the default locale; `en` is typed `Messages`, so a missing or extra key is a compile error.
  `resolveLocale(tag)` maps anything that is not English to `ro`.
- Lit tests run in **Vitest browser mode** (Chromium, headless, `@vitest/browser-playwright`), the
  other projects in `node`. Lit's Node build shims `customElements`, so engine/admin modules that
  register elements also load in `node` tests. `vitest.config.ts` has one row per suite
  (`SUITES`); a suite is enabled when `<dir>/package.json` exists, and its `coverage` globs are the
  only files measured (Vitest 5 never adds unlisted files). `functions` and `rules` rows already exist.

## 6. The quality pipeline (`scripts/ci/pipeline.py`)

The registry is data:

- `GATES`: `Gate(name, command, files=())`. `command` runs from the repo root and passes on exit 0.
  With `files` (git pathspecs), the matching tracked + untracked-not-ignored files are appended;
  no match means "skipped" (a pass). Node tools are invoked through `npm run --silent <script>`, so
  `package.json` scripts stay the single definition of their flags.
- `STAGES`: simple stage → ordered gate names. `COMPOSITE_STAGES`: `quality` = static, tests, e2e,
  build; `all` = quality, sonar.
- `validate_registry()` rejects unknown or duplicated names; it runs before every stage and in the tests.

Output: `static 10/48 tsc` before each gate, a `passed`/`FAILED (exit N)` line with the duration,
then `[SUCCESS] stage 'static' passed (reports/pipeline/green-static.json)` or
`[FAILURE] stage 'static' failed: static/eslint, ...` (exit 1). All gates run even after a failure.
The green marker is `{stage, head, status_sha256}`, the hash of
`git status --porcelain=v1 --untracked-files=all`. An empty stage fails ("no gates registered yet").

**How to add a gate** (example: radon grade A):

1. Pin the tool (npm devDependency, `scripts/ci/requirements.txt`, or a digest-pinned binary in the Dockerfile).
2. Add `Gate("radon", ("python3", "scripts/ci/check_radon.py"))` to `GATES` (for npm tools, add a
   `package.json` script and use `(*NPM_RUN, "<script>")`).
3. Add `"radon"` to the right tuple in `STAGES` (cheapest first; network-bound gates last).
4. Run `python3 -m pytest` in the image: `test_happy_path_every_gate_belongs_to_a_stage` and the
   registry test fail on typos. Update this file and the gate table in `docs/CI_PIPELINE.md` (when it exists).

The registry holds 60 gates (`python3 scripts/ci/pipeline.py --list`; the table with each gate's
command is `.agent/skills/quality/pipeline_skill.md` → *Stages*): static 49, tests 5 (`vitest`,
`rules-coverage`, `pytest` (also in static), `pipeline-pytest`, `coverage`), e2e 2 (`e2e-matrix`, `playwright`), build 2
(`vite-build`, `bundle-budget`), sonar 1 (`sonar`), deps 1 (`dependency-updates`), release 3 (`release-check`
plus the two build gates), contract 1 (`contracts`); no stage is empty (§10f).

`scripts/ci/check_no_inline_suppressions.py` is the suppression gate (ported from Watch-GPS and
extended with TS/Vitest/Playwright/CSS/HTML/Dockerfile patterns). It skips itself; its tests
assemble the directive strings from fragments so the test file stays clean. Use the same trick
whenever a test needs a banned directive as data.

Python coverage: `.coveragerc` (`branch = True`, `source = scripts/ci`, only `scripts/ci/tests/*`
omitted, `fail_under = 90`, no exclusion pragmas; `if __name__ == "__main__":` is covered by
running the scripts with `runpy`). Reports: `reports/coverage/scripts.xml`, `reports/junit/pytest.xml`.
TS coverage: `reports/coverage/ts/{lcov.info,coverage-summary.json}`, `reports/junit/vitest.xml`,
per-file thresholds 90/90/90/90. The tests' `conftest.py` blocks every non-loopback socket.

## 7. Config relaxations (each one has a why-comment in its file)

| File | Relaxation |
| --- | --- |
| `eslint.config.js` | `no-console` off for `packages/shared/src/log.ts` only; test files get Vitest rules and larger size limits (600 lines, 120 per function, 8 params); `disableTypeChecked` for the plain-JS tool configs; CommonJS for `.dependency-cruiser.cjs` |
| `ruff.toml` | `S603` off everywhere (subprocess audit marker); tests: `S101 S105 S106 S108 S607 PLR2004`; `*.md` excluded (ruff 0.17 formats Python blocks inside Markdown; Markdown belongs to markdownlint) |
| `.coveragerc` | `omit = scripts/ci/tests/*` (tests are not product code) |
| `.markdownlint-cli2.jsonc` | `MD013`, `MD033`, `MD041` off; `MD024` siblings only (sibling-repo config) |
| `.prettierignore` | `*.md` (markdownlint owns Markdown), `package-lock.json`, `seed/`, `docs/research/*.json` (verbatim research artifacts), `vendor/` |
| `.gitleaks.toml` | path allowlist for gitignored caches and outputs only (scope, not tolerance) |
| `knip.json` | `ignoreDependencies: ["braces", "minimatch"]` (they are used through `overrides` only) |
| `.editorconfig` | `*.sh` and `scripts/git-hooks/*` use tabs, in two sections (shfmt does not match a mixed brace list) |

To get `markdownlint` green, the research Markdown under `docs/research/` was reformatted
(blank lines around headings and lists, `| --- |` table separators, `text` on bare code fences,
bold pseudo-headings turned into headings). In `quality-conventions.md` one sentence was
reworded: "Never `curl -u`" sat within five lines of `--user uid:gid`, which gitleaks' multi-line
`curl-auth-user` rule reports. The content was not changed otherwise. New addenda to `PLAN.md`
must follow the same rules, or the static stage fails.

## 8. TODO for the next agents

- **M1 (engine, shared, ui):** the contracts are done (§10g: zod schemas, geo, URL hash, migration, theme;
  the interfaces and ownership are `docs/research/M1-interfaces.md`). Still to do: add `mapbox-gl@3.32.0` (dev,
  `@hcm/engine`), the `MapPort` + `mapbox-adapter.ts` (the only file allowed to import `mapbox-gl`; dependency-cruiser
  rule `only-the-map-adapter-imports-mapbox`), FakeMap in test-support, M3 tokens. Replace
  `hcm-hello` and `boot()` when the real viewer exists. Split engine tests into node and browser
  projects when the adapter arrives (one more `SUITES` row).
- **functions/ and firebase/ (M2; scaffolded and tested in M0, see §10b):** the remaining
  functions behind their ports, a `functions/dist` lockfile, per-function service accounts, App Check,
  dependency-cruiser rules for `functions/` (ask first: `.dependency-cruiser.cjs`) and the first deploy.
- **pipeline/ (M3; skeleton done in M0, see §10c):** the processing steps, the fake M2M server's
  download endpoints, Firestore and Storage fakes, `devtools/poller.py`, the compose tier.
- **e2e/ (M1; harness done in M0, see §10d):** `@axe-core/playwright`, the emulator topology
  (`firebase emulators:exec` around Playwright, the functions emulator on `functions/dist`), the mock
  APIs, a `webServer` for the built site, and the functional, tour, a11y, no-WebGL and cross-browser
  projects of `design-review-testability.md` §4.3.
- **Gates still to add:** jscpd, pylint, vulture and zizmor (radon and bandit landed in §10e; the `sonar`
  and `deps` stages and the `commits` gate in §10f).
- The default `PIPELINE_STAGE` is `all` (`quality`, then `sonar`); it passes without a SonarCloud token.
- **Ask-first edits** proposed with their exact diffs: `docs/research/DECISIONS-for-review.md` (§10f).

## 9. Caveats noticed

- npm 11.19 prints "install scripts not yet covered by allowScripts" for `protobufjs` and `re2`
  (firebase-tools) and, by 2026-10-25, `@firebase/util` (the Firebase JS SDK's postinstall). The scripts
  still run today; if a future npm blocks them, approve those three explicitly.
- `firebase-tools` pulls ~800 packages. Overrides cover today's advisories; expect new ones.
- Lit logs "Lit is in dev mode" in Node tests (Vite resolves the `development` condition). Harmless.
- Re-export-only files (`packages/*/src/index.ts`) have no executable statements: v8 reports
  them as 0 of 0 and Vitest's thresholds pass. The future `check_coverage.py` must treat 0/0 as covered.
- typescript-eslint's `no-unused-vars` does not exempt `_`-prefixed parameters; omit unused
  parameters instead.
- A browser crash in a container writes `core.<pid>` into the repository root; `.gitignore`
  covers `core.[0-9]*`.
- The research Markdown is a moving target if the orchestrator appends to it: keep blank lines
  around headings and lists.

## 10. CI workflows, git hooks and repository meta

Added by the M0 CI agent on 2026-10-11. The stage table stays in
`.agent/skills/quality/pipeline_skill.md`; the workflow overview is in `docs/CI_PIPELINE.md`.

- **Workflows** (`.github/workflows/`): `ci.yml`, `release.yml`, `deps.yml`, `contract.yml`,
  `codeql.yml`. Every job calls `scripts/ci/run-all-checks.sh` per stage (or
  `scripts/ci/build-and-test.sh` for the image); no tool is called directly. The image is shared
  through the GitHub Actions layer cache: `build-image` writes it (`HCM_DOCKER_BUILD_FLAGS` with
  `--cache-to type=gha,mode=max,scope=hcm-quality --output type=cacheonly`), every stage job
  rebuilds from it with `--load --cache-from type=gha,scope=hcm-quality`. The local composite
  action `.github/actions/quality-image` frees disk, sets up Buildx and exposes the cache runtime
  (`crazy-max/ghaction-github-runtime`, required for `type=gha` in a `run` step);
  `.github/actions/upsert-issue` opens or updates the weekly deps/contract issue.
- **Action pins** (resolved with `gh api repos/<o>/<r>/git/ref/tags/<tag>`, annotated tags
  dereferenced, 2026-10-11): checkout v7.0.1, upload-artifact v7.0.2, download-artifact v8.0.2,
  setup-buildx v4.4.1, build-push v7.4.0, login v4.8.0 (2026-11-14), ghaction-github-runtime v4.0.0,
  action-junit-report v6.7.1 (2026-11-14), sonarqube-scan v8.5.0 (2026-11-14), sonarqube-quality-gate v1.2.1,
  configure-pages v6.0.0, upload-pages-artifact v5.0.0, deploy-pages v5.0.1, google auth v3.0.0,
  codeql-action v4.39.3, action-gh-release v3.0.4 (2026-11-14). The SHAs are in the workflows.
- **Deploys are off** until M2: the jobs exist in `ci.yml` but need the repository variable
  `DEPLOY_ENABLED=true`, the `deploy` environment and the WIF variables `GCP_WIF_PROVIDER`,
  `GCP_DEPLOY_SA`, `GCP_PROJECT_ID`, `GCP_REGION` (none exist yet). GitHub Pages is still the
  legacy branch build from `master`; switching it to "GitHub Actions" is an M2 settings change
  (ask first). The Pages artifact path `sites/bucharest/dist` is a placeholder for the M1/M2 site build.
- **New stages and gates:** `release` (`release-check` = `scripts/ci/check_release.py`, then
  `vite-build`, `bundle-budget`) and `contract` (`contracts` = `scripts/ci/check_contracts.py`,
  reading `packages/admin/src/setup/links.json`, the verified Setup Assistant deep links). Static:
  `workflow-timeouts`, `action-schema`, `issue-forms-schema`, `issue-config-schema`
  (check-jsonschema built-in schemas, no network). `run-all-checks.sh` forwards `E2E_SHARD`.
- **Git hooks** (`scripts/git-hooks/`, `git config core.hooksPath scripts/git-hooks`): pre-commit
  refuses secret-bearing files, then runs the suppression scan on the staged index and gitleaks on
  the staged changes **in the quality image** (`docker run --network none`; directly when
  `HCM_TEST_IMAGE=1`). pre-push requires `reports/pipeline/green-all.json` (HEAD = the pushed
  commit, clean tree) only for `refs/heads/master` and `refs/tags/v*`; work branches pass.
  `scripts/ci/tests/test_git_hooks.py` drives both with real git commits and pushes in throwaway
  repositories (real scanner and gitleaks; a fake `docker` for the image path).
- **Repository meta:** `.github/pull_request_template.md`, `.github/ISSUE_TEMPLATE/` (bug and
  feature forms, blank issues off; a private-advisory contact link waits for the user to enable
  private vulnerability reporting), `.coderabbit.yaml`,
  `.github/badges/{coverage,branches}.svg` (`unknown` until the `coverage` gate rewrites them).
- **Lesson:** git sends a pre-commit hook's stdout to stderr, but not a pre-push hook's; hook tests
  assert on both streams together.

## 10b. Firebase, security rules and functions

Added by the M0 firebase agent on 2026-10-11. Status: `npm test` (every Vitest project under the
emulators) passes, 27 files; the `rules-coverage` gate passes (587 Firestore rule expressions
evaluated, all 20 `allow` conditions both allowed and denied); every `functions/src` file is at 100%
lines (one 95% branch file); `scripts/ci/check_rules_coverage.py` is at 100%.

### Layout (deviation from PLAN: `firebase.json` at the root)

- `firebase.json` and `.firebaserc` live at the **repository root**, not in `firebase/`:
  firebase-tools resolves every path through `Config.path()`, which refuses anything outside the
  directory that holds `firebase.json` ("is outside of project directory"). From `firebase/` the
  deploy could reach neither `functions/` nor `packages/admin/dist`. The emulators are also found
  from any subdirectory this way.
- `firebase/firestore.rules`, `firebase/storage.rules`, `firebase/firestore.indexes.json` (no
  composite index yet; `photos.description` and `photos.exif` are exempt from indexing) and the
  `firebase/rules-tests` workspace (`@hcm/rules-tests`).
- `.firebaserc` maps only `e2e` → `demo-hcm`; the real project is added with the first deploy (M2).
- Emulators on `127.0.0.1`: auth 9099, firestore 8080 (websocket 9150), storage 9199, functions
  5001, hosting 5000, hub 4400, logging 4500; `singleProjectMode`, UI off.
  `firebase/rules-tests/test/firebase-config.test.ts` pins this layout and the admin headers.
- `firebase.json` validates against `node_modules/firebase-tools/schema/firebase-config.json`
  (the `firebase-schema` static gate).

### How the tests run

- `npm test` = `firebase emulators:exec --project demo-hcm --only auth,firestore,storage 'bash
  scripts/ci/run-emulated-tests.sh'`. That script runs `npm run test:unit` (= `vitest run
  --coverage`, all projects, ONE merged `reports/coverage/ts/lcov.info`), then
  `check_rules_coverage.py save` (the coverage report is only reachable while the emulators run),
  keeping Vitest's exit status. The `vitest` gate calls `npm test` unchanged; startup adds about 8 s.
- `npm run test:unit` runs Vitest without emulators: fine for one project (`npx vitest run
  --project ui`), but the `rules` project and `functions/test/adapters/firestore.test.ts` need the
  emulators and fail fast without them.
- Gate `rules-coverage` (tests stage, after `vitest`): `check_rules_coverage.py check` reads
  `reports/rules/firestore-coverage.json` and fails when an expression was never evaluated (a
  short-circuited operand, `{}` in the report, does not count), when an `allow` condition never
  allowed or never denied (a constant such as `if false` is exempt), or when the report was made
  from other rules. Only the JSON is saved, streamed to disk (its HTML view doubled the emulator's
  work: `DECISIONS-for-review.md` §180g). The Storage emulator has no coverage report:
  `storage.test.ts` covers each condition explicitly.
- The emulator's report format (firebase-tools 15.33.0): `{rules: {files: [{name, content}]},
  report: [node]}`, node = `{sourcePosition: {line, column, currentOffset, endOffset (inclusive,
  character offsets)}, values?: [{value, count}], children?}`; missing `values` = never evaluated,
  `value: {}` = short-circuited, `value: {undefined: {causeMessage}}` = error.

### Rules-test conventions (`firebase/rules-tests/test/support/world.ts`)

- The emulators load the rules from `firebase.json` once; tests never pass `rules` to
  `initializeTestEnvironment` (reloading rules resets the coverage) and never clear data. Test
  files run in parallel, so each owns a scope: persona uids `<scope>-<persona>` and its own city ids.
- Personas: `anonymous`, `stranger` (verified Google, no claim), `unverified`, `otherProvider`
  (password sign-in), `claimOnly` (revoked admin: claim, no `admins` doc), `docOnly`, `admin`.
- `verdict(request)` returns `'allow' | 'deny'` (anything but PERMISSION_DENIED is rethrown) and
  `verdicts(personas, fn)` a whole row, so a failure shows the full matrix. `vi.setConfig` raises
  the timeouts to 30 s from the support module (the shared `vitest.config.ts` is ask-first).
- firebase@13's compat types reference `Temporal.Instant`: the rules-tests tsconfig adds
  `lib: esnext.temporal` (types only).

### Data shapes the rules fix (M1 zod schemas must match)

- `cities/{c}`: `name{ro,en}` (≤100), `bounds{west,south,east,north}` (degrees, west ≤ east,
  south ≤ north), `published`; `id`, `mapbox`, `createdAt` are server-owned.
- `photos/{p}`: required `title`, `location{lat,lng}` (inside the city bounds ±0.5°), `license`
  (`CC0`, `CC-BY-4.0`, `CC-BY-SA-4.0`, `CC-BY-3.0`, `CC-BY-SA-3.0`, `CC-BY-SA-3.0-RO`, `CC-BY-2.0`, `CC-BY-SA-2.0`, `PD`, `permission`, `permission-legacy`, `unknown`),
  `published`, `updatedBy`, `updatedAt`; optional `description{ro,en}` (≤5000), `year`/`yearEnd`
  (ints 1800–2100), `author`, `rightsHolder`, `sourceLabel` (≤200), `sourceUrl` (https only),
  `permissionNote` (≤2000), `legacyId` (≤64), `links` (list ≤5), `bearing` 0–360, `fov` 1–180,
  `rightsReview`; server-owned `image`, `exif`, `processing` (`pending` on create; publishing
  needs `done` and a licence other than `unknown`), `createdAt`, `createdBy`. Any other key is denied.
- Every client write stamps `updatedBy = uid` and `updatedAt = serverTimestamp()`
  (`== request.time`); jobs carry `createdBy`/`createdAt` instead.
- `layers`: admins change only `label`, `description`, `order` (int), `opacity` 0–1,
  `defaultVisible`, `published`, `attribution` (≤500) plus the stamp. `jobs`: create
  `{type ∈ usgs-import|geotiff-import|regeoref|republish, status: queued, params: map, createdBy,
  createdAt}`; update only `cancelRequested: true`. `gcps/{layer}`: `{points: list ≤300}` + stamp.
  `usgsScenes`: only `status ∈ candidate|ordered|rejected` and `note` (≤1000).
- Read-only for admins, never client-written: `admins`, `setup`, `usage`, `ops`, `jobs/*/logs`.
- Storage: `create` also covers overwriting an existing object, so uploads require
  `resource == null` (found by the rules tests; each upload has its own `{upload}` id).

### Functions (`functions/`, `@hcm/functions`)

- `src/index.ts` (exports only: `export * as setup`, deployed as `setup-status`),
  `src/global-options.ts` (`setGlobalOptions({region: 'us-central1', maxInstances: 5})`, imported
  first by every trigger because firebase-functions reads it at declaration time),
  `src/triggers/` (thin `onCall`), `src/handlers/` (pure: `requireAdmin` = claim, verified Google
  and `admins/{uid}`; `setupStatus` projects `setup/status` field by field so nothing unlisted,
  secrets included, ever leaves), `src/ports/` (interfaces; `Ports` aggregate, handlers take
  `Pick<Ports, ...>`), `src/adapters/` (Firestore via the Admin SDK, Secret Manager over REST with
  `fetch` + a google-auth-library `TokenProvider`, an in-memory secret store for the Functions
  emulator, the Cloud Logging sink for `createLogger`), `src/deps.ts` (composition root, created on
  first use). `CloudRunJobs`, `MapboxApi` and `UsgsApi` are ports only until M2/M3.
- Callable `setup-status` keeps `enforceAppCheck: false` until the admin ships App Check (M2).
- Tests: handlers with fakes (`functions/test/support/fakes.ts`), triggers through v2 `.run()` with
  `vi.mock('../../src/deps.js')`, adapters with a fake `fetch` or the Firestore emulator. No
  firebase-functions-test (F2).
- Build: `functions/build.mjs` uses Vite 8 SSR (Rolldown), the monorepo's bundler, instead of
  adding esbuild: `@hcm/*` is bundled, npm dependencies stay external. It writes
  **`functions/dist/`** (`index.js`, `package.json` with the exact pins), not `functions/deploy/`:
  every tool already ignores `dist/` (git, ESLint, Prettier, dependency-cruiser, Sonar), while a
  `deploy/` directory would need an ESLint ignore (ask-first config). `firebase.json` deploys
  `functions/dist` with `predeploy` building it. Verified: Node imports it, and the Functions
  emulator loads it and answers an anonymous call with `UNAUTHENTICATED`. The docs, the workflows
  in `.agent/workflows/`, `sonar-project.properties` and §11 now say `functions/dist` (integration pass).
- `dependency-cruiser` now also scans `functions` (`lint:deps`), with the generic rules only.

### Admin Hosting headers (`firebase.json`)

- CSP from security review §1.8 with these changes: no project id at all (the admin sets
  `authDomain` to its own host, so `frame-src 'self'` covers the auth handler on both
  `web.app` and `firebaseapp.com`); `https://apis.google.com` in `script-src` (signInWithPopup loads
  gapi); `https://api.mapbox.com/mapbox-gl-js/` in `script-src`/`style-src` and `'wasm-unsafe-eval'`
  (mapbox-gl is never bundled, the Standard style needs WebAssembly); the GA4 hosts of Addendum 2.
- UNVERIFIED until the first deploy: whether Hosting applies these headers to the reserved
  `/__/auth/handler` page. e2e must route the emulator hosts (CSP blocks `http://127.0.0.1`).

### npm

- New pins: `firebase-functions@7.4.0`, `firebase-admin@14.5.0`, `google-auth-library@11.2.0`
  (functions), `@firebase/rules-unit-testing@6.0.0`, `firebase@13.0.0` (rules-tests).
- Override `@firebase/firestore@4.18.0` → `@grpc/grpc-js` 1.14.6 (GHSA-m9gg-hp2v-232j,
  GHSA-f596-whhp-79r4; firestore pins `~1.9.0`). npm applied it only after the stale nested
  `node_modules/@firebase/firestore/node_modules/@grpc/*` lock entries were deleted.

### Left for M2

- A `functions/dist/package-lock.json` (Cloud Build otherwise resolves transitive versions);
  generating it needs registry metadata the offline image cache does not hold.
- dependency-cruiser rules for `functions/` (no browser or UI packages) need
  `.dependency-cruiser.cjs` (ask-first).
- Runtime service accounts per function, App Check enforcement, the `functions` emulator in the
  e2e topology, and the rule for the public bucket fallback (§1.5) if `allUsers` is blocked.

## 10c. Raster pipeline (`pipeline/`)

Added by the M0 pipeline agent on 2026-10-11. Status: 135 pytest tests (unit, integration against a
fake M2M server over real loopback HTTP, synthetic GeoTIFFs written with the image's GDAL), every
one of the 10 files in `pipeline/src` at 100% lines and branches; ruff, mypy strict, radon (all
grade A), bandit (every severity) and pip-audit clean; `poetry check --lock --strict` passes;
`pipeline/Dockerfile` builds both targets (`test` runs the suite, `runtime` runs `doctor`).

### Where the pipeline runs its gates: the quality image

The quality image is the GDAL image, so the pipeline's tests and type checks run there like every
other gate. `docker/Dockerfile.quality` installs Poetry in `/opt/hcm/poetry` and the lock (main and
dev groups, `--no-root`) into `/opt/hcm/pipeline-venv`; the source is bind-mounted. That layer sits
**after** the npm layer, so a change to `pipeline/pyproject.toml`, `poetry.lock` or
`requirements-poetry.txt` (all three are in the `.dockerignore` allowlist) rebuilds only it (~30 s).
`pipeline/Dockerfile` (stages `base` → `deps` → `test` | `runtime`, build context `pipeline/`) is
the shipped image; its `test` target runs the same suite on the same base digest and is not a gate.

| Gate | Stage | Command (from the repository root) |
| --- | --- | --- |
| `ruff-check`, `ruff-format` | static | the existing global gates; `ruff.toml` needed no change |
| `pipeline-lock` | static | `poetry --directory pipeline check --lock --strict` (with `VIRTUAL_ENV` set, so Poetry creates no venv) |
| `pipeline-mypy` | static | `mypy --config-file pipeline/pyproject.toml --python-executable /opt/hcm/pipeline-venv/bin/python` |
| `pipeline-radon` | static | `radon cc --min B` and `radon mi --min B` over `pipeline/src`; any output fails |
| `pipeline-bandit` | static | `bandit -q -r pipeline/src` (every severity) |
| `pipeline-pip-audit` | static | `pip-audit --path` the venv's site-packages, then `-r pipeline/requirements-poetry.txt` |
| `pipeline-pytest` | tests | `/opt/hcm/pipeline-venv/bin/python -m pytest -c pipeline/pyproject.toml --rootdir .`, before `coverage` |

### Decisions

- **Own config, root configs untouched.** `pipeline/pyproject.toml` holds the pytest, coverage and
  mypy settings; `mypy.ini`, `pytest.ini` and `.coveragerc` stay the CI tooling's. Every command
  runs from the repository root. pytest quirk: with `-c` the rootdir becomes `pipeline/` and
  `testpaths` is ignored, hence `--rootdir .`; `testpaths` is then rootdir-relative, while
  `pythonpath` (an ini "paths" value) is relative to the config file (`src`).
- **Separate reports, one gate.** `reports/coverage/pipeline.xml` (Cobertura, `relative_files`, so
  filenames are `pipeline/src/...` with an empty `<source>`) and `reports/junit/pipeline.xml`, next
  to `scripts.xml`; `sonar-project.properties` lists both, so `check_coverage.py` merges them (no
  `coverage combine`). Data file `reports/.coverage-pipeline`, mypy cache `reports/.cache/mypy-pipeline`.
- **Pins** (latest stable, checked on PyPI 2026-10-11): numpy 2.5.4, opencv-python-headless
  5.0.0.93 (abi3 wheel), httpx 0.28.1, google-cloud-firestore 2.34.1, google-cloud-storage 3.17.1, pikepdf 10.18.0 (M20's
  PDF pages, 2026-11-09; with Pillow 13.0.0 and lxml 6.1.3);
  dev: pytest 9.2.0, pytest-cov 7.1.0, coverage 7.17.3, respx 0.23.1, hypothesis 6.170.15 (bumped 2026-11-14); build
  backend poetry-core 2.5.0; Poetry 2.5.1. The venv's numpy shadows the image's numpy 2.3.5;
  `osgeo.gdal_array` works with it (same 2.x ABI line).
- **No pip in the pipeline venvs.** `python3 -m venv` seeds pip 25.1.1, which has 12 advisories
  (`pipeline-pip-audit` found them): both the quality image and `pipeline/Dockerfile` create the
  venv `--without-pip`; Poetry installs into it.
- **GDAL stubs without a ruff relaxation.** `pipeline/typings/osgeo/*.pyi` declares GDAL's CamelCase
  functions and methods as typed callable attributes, because ruff N802 rejects a CamelCase `def` and
  `ruff.toml` is ask-first. The idiomatic alternative is `def` stubs plus a `ruff.toml` per-file
  ignore of `N802`/`N803` for `pipeline/typings/**`, if the user approves that edit.
- **Exception names end in `Error`** (ruff N818): `AuthError`, `MaintenanceError`,
  `RateLimitError` (HTTP 429 or `RATE_LIMIT*`, with `retry_after`), `ProtocolError`,
  `UnreachableError`, all subclasses of `M2MError`.
- **Logging.** `hcm_pipeline.log.configure()` writes Cloud Logging JSON lines; the `hcm_pipeline`
  logger never propagates (another library's handler would print unredacted text). pytest 9's
  `caplog` still sees such records, so the test proves non-propagation with a root handler.
- **Tests.** The firewall (`pipeline/tests/fakes/network.py`) also blocks DNS lookups of
  non-loopback names. The hypothesis `ci` profile is derandomized with no example database (no
  `.hypothesis/` in the tree). The fake M2M server is `wsgiref` (an `http.server`), because a
  `BaseHTTPRequestHandler` needs a `do_POST` method that ruff N802 rejects.
- **Exit codes** (`hcm_pipeline.exit_codes.ExitCode`): 0 done or WAITING (`ops.tick` resumes),
  1 failed (Cloud Run retries), 2 usage, 3 configuration.

### Left for M3

The steps (fetch, locate/crop, georef, warp, export, publish), the job lease and heartbeat, the
fake server's `download-*` endpoints and scripted corrupt payloads, Firestore and Storage fakes,
`hcm_pipeline.devtools.poller` and the compose tier (P01, P02), the `deploy-pipeline-image` build
(`--target runtime`, context `pipeline`). pylint and vulture from the conventions list are not
wired for any Python yet.

Done in M3 (2026-10-24, `docs/research/M3-interfaces.md` §5 and CR-M3-19, `docs/research/M3-status.md`): every
step but publish (which moved to functions, `imagery.publish`), the lease and heartbeat in `hcm_pipeline/lease.py`, the
loopback fakes in `pipeline/tests/fakes/` (documents, Cloud Storage's JSON API, M2M and its delivery host, STAC,
Overpass) instead of a poller and a compose tier: P01 and P02 run in `pipeline/tests/integration/`, and the real
pipeline runs once under the admin e2e tier (`e2e/admin/specs/imagery/pipeline.spec.ts`). The runtime image's entry point
is `python -m hcm_pipeline`; building and pushing it, and the Cloud Run Job definitions, wait for the user's deploy.
pylint and vulture are still not wired.

## 10d. Integration pass and the e2e harness

Added by the M0 integrator on 2026-10-12, after the parallel agents of §10, §10b and §10c finished.
Status: `static`, `tests`, `e2e` and `build` each end with `[SUCCESS]` (§1), so `quality` passes;
`all` still fails on the empty `sonar` stage.

### What the pass did

- `npm install` in the pinned `node:24` image confirmed the lockfile matched every workspace the
  agents added; `@hcm/e2e` then joined (`@playwright/test@1.64.0`, the same version as the root
  `playwright`, deduplicated). The image was rebuilt with `COPY e2e/package.json e2e/` and the
  matching `.dockerignore` line (§3).
- Stale `functions/deploy` references now say `functions/dist` (`docs/TESTING.md`,
  `.agent/workflows/{build,deploy}.md`, §11); `sonar-project.properties` drops its
  `functions/deploy/**` exclusion (`**/dist/**` covers the artifact) and reads `e2e/tsconfig.json`.
- The Sonar skill (both copies) now lists the real scope, the CI job, `--check-token` and the 0600
  rule for `.sonar-token`; the stage table, the gates skill, the e2e skills, `docs/ARCHITECTURE.md`,
  `README.md` and `AGENTS.md` describe the workspaces and stages that exist.

### The e2e workspace (`e2e/`, `@hcm/e2e`)

- `e2e/package.json` (`test:e2e` = `playwright test`), `e2e/tsconfig.json` (in the root `tsc -b`
  solution; Node types plus the DOM for callbacks that run in the page), `e2e/playwright.config.ts`,
  `e2e/support/test.ts`, `e2e/specs/smoke.spec.ts`.
- Config: `testDir: specs`, one project `smoke-chromium` (1440×900, `ro-RO`, `Europe/Bucharest`) with
  `--use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist` and host-resolver rules
  that resolve only loopback; `baseURL` `http://127.0.0.1:4310`; `forbidOnly`; in CI one retry with
  `failOnFlakyTests`; `E2E_SHARD=index/total` becomes `shard` (anything else throws); reports in
  `reports/junit/e2e.xml`, `reports/playwright/`, `reports/test-results/` (the paths `ci.yml` uploads).
- Fixtures (automatic in every spec that imports `../support/test.js`): the firewall, a context route
  on `**/*` that lets `127.0.0.1` and `localhost` through and aborts (`blockedbyclient`) and records
  everything else, and the console guard (console errors and uncaught page errors). Both fail the test
  at teardown unless the test claimed the entries with `take()`. Throwaway probe specs confirmed it: an
  unclaimed blocked fetch and an uncaught page error each failed their test.
- Gate `playwright` = `npm run --silent test:e2e`; stage `e2e` = `e2e-matrix`, `playwright`.
  `scripts/ci/tests/test_pipeline.py` now uses `sonar` as the empty stage.

### Decisions

- **A harness behaviour, `V00`, instead of tagging `S-V02-HAPPY`.** The smoke proves the e2e
  preconditions (a WebGL2 clear reads back `rgba(0, 128, 255, 255)` under SwiftShader; a fetch of
  `api.mapbox.com` is aborted, recorded and reported) but renders no map, so marking V02 `exists`
  would claim a viewer behaviour that does not exist yet. `S-V00-HAPPY` and `S-V00-BAD-BLOCKED-HOST`
  are `exists`; every product row stays `planned`.
- **No committed `.html` page (decision for the user).** Prettier 3 prints `<!doctype html>` and
  `<meta ... />`, which html-validate's recommended `doctype-style` and `void-style` rules reject, so
  no committed HTML file can pass both gates. The fix is to extend `html-validate:prettier` in
  `.htmlvalidate.json`, an ask-first config edit that M1 needs before `sites/bucharest/index.html`.
  Until then the smoke page is fulfilled by the spec at the loopback origin, and there is no
  `webServer` (M1 adds one for the built site).

### Waiting for the user (ask first, one by one)

- `.htmlvalidate.json`: `"extends": ["html-validate:recommended", "html-validate:prettier"]` (above).
- `pytest.ini`: the ci-checks agent added one `filterwarnings` line that tolerates the
  `codecs.open()` deprecation warning of `editorconfig` 0.17.1 on Python 3.14 (tool config; keep or
  replace).
- `ruff.toml`: a per-file ignore of `N802`/`N803` for `pipeline/typings/**` would allow ordinary GDAL
  stubs (§10c); `.dependency-cruiser.cjs`: rules for `functions/` (§10b).
- `.claude/settings.json`: the agent-assets agent proposed an allowlist without push or deploy
  commands; it is not in the tree (§11).
- `.github/workflows/` are new files that have never run on GitHub; review them before the first push.
  Repository settings for later: `git config core.hooksPath scripts/git-hooks`, private vulnerability
  reporting, Pages from Actions, `DEPLOY_ENABLED` and the WIF variables (§10).

## 10e. Adversarial review of the scaffold

Added by the M0 review agent on 2026-10-12. It audited the scaffold against `quality-conventions.md`,
`design-review-testability.md` and `PLAN.md`; `static`, `tests`, `e2e` and `build` pass again afterwards.

### Fixed

- **Suppression scan gaps** (`scripts/ci/check_no_inline_suppressions.py`): `.pyi` stubs were not scanned;
  Playwright's `test.fail(`, chained modifiers (`it.concurrent.only`, `test.describe.serial.skip`,
  `test.step.skip`) and `testInfo.skip()`/`fixme()`/`fail()` passed; so did shellcheck directives inside
  workflow `run:` scripts, YAML `# prettier-ignore`, `# fmt: off`/`# fmt: skip`/`# isort: skip`, unittest
  skips, `# pyright:` and BuildKit's `# check=skip=`.
- **Missing gates from the conventions list**: `radon` (grade A, `--no-assert`, `scripts/ci` with its
  tests) and `bandit` (`scripts/ci`, medium severity and up; the why-comment is next to `BANDIT` in
  `pipeline.py`) for the CI scripts (§4 gates 14 and 15); three grade-B functions were split. The CI
  tooling's tests now also run in `static` (§4 gate 24), which is what `AGENTS.md` promises when it says
  `static` covers tooling changes.
- **`AGENTS.md` rules no gate enforced**: `workflow-policy` (`scripts/ci/workflow-policy.schema.json`
  through check-jsonschema: no `pull_request_target`, top-level `permissions`, no `write-all`/`read-all`,
  `persist-credentials: false` on every checkout, no `${{ }}` inside a `run:` script, composite actions
  included) and `repo-policy` (`scripts/ci/check_repo_policy.py`: no secret-bearing file in git's view,
  exact npm/pip/Poetry pins, `@sha256:` digests on every Dockerfile `FROM`/`# syntax=` and YAML `image:`,
  no `:latest`, no reference to the banned legacy Mapbox account outside the docs that state the ban).
  Before, a force-added `.env.local` or `.sonar-token` passed every gate: the pre-commit hook is not
  installed in this clone and `.gitleaks.toml` allowlists both paths.
- **A dead CI input**: `ci.yml` computed `GITLEAKS_LOG_OPTS` and `run-all-checks.sh` forwarded it, but no
  gate read it, while `ci.yml` and the docs described a history-mode scan. Gate `gitleaks-history` now
  scans that range in CI and passes with a notice when the variable is unset (local runs).
- **Docs that contradicted the code**: `docs/SETUP.md` said the `sonar` stage is skipped without a token
  (it has no gate and fails); the `pipeline-runner` subagent quoted `static 3/23`; gate counts.
- `pipeline/tests/unit/test_log.py`: the fake Mapbox token encoded the real account name; it now encodes
  the scenario (`redaction-test`).

### Waiting for the user (ask first, one by one)

- **`gitleaks-history` and commit `14d4d7b`** (already on `origin/feat/engine-rewrite`): it still holds the
  `curl-auth-user` false positive of §7, so a pull request whose range includes it fails `static` until the
  user either squashes the branch before the PR (a force-push) or approves a `.gitleaks.toml` allowlist
  entry for that one commit.
- **`.gitleaks.toml`**: the path allowlist for `.sonar-token` and `.env.local` (needed by the dir scan,
  which walks git-ignored files) also hides those files in history mode, and the header's "nothing
  tracked is exempted" is not true for them. Option: a separate config for `gitleaks git`.
- **`eslint.config.js`**: `e2e/**` gets neither the test rules nor any size limit, and
  `eslint-plugin-playwright` (conventions §4.2, testability §2) is not installed, so
  `playwright/no-wait-for-timeout` (sleeps) is unenforced; the relaxed test limits (600 / 120 / 8) have no
  why-comment.
- **`.dependency-cruiser.cjs`**: no rule keeps `firebase`/`@firebase/*` out of `packages/engine` (the
  public viewer never loads the Firebase SDK); `lint:deps` scans neither `e2e/` nor `firebase/rules-tests/`.
- **Workflows**: `deploy-firebase` runs `npm ci` (every install script) after the Workload Identity step,
  with `GOOGLE_APPLICATION_CREDENTIALS` and the credentials file in the mounted workspace: install before
  authenticating; the `sonarqube` job checks `scripts.xml` and `pytest.xml` but not the pipeline's reports;
  `deps.yml` will open an empty "Dependency updates available" issue every Monday while the `deps` stage
  has no gate; `release.yml` builds inside the job that holds `contents: write` (split build and publish);
  zizmor (testability §2) is not wired; `sonar.sources` leaves out `.github/actions`.
- **Research docs**: `design-review-*.md` (pushed in `14d4d7b`) list absolute paths under the local home
  directory, which name the user; the history already has them.
- **Not enforced anywhere yet**: Conventional Commits (no `commit-msg` hook), the hooks themselves
  (`core.hooksPath` is unset in this clone), WebSockets in the e2e firewall (`context.route` does not see
  them and the host-resolver rules do not stop an IP literal: `context.routeWebSocket` in M1).

## 10f. M0 review leftovers closed

Added on 2026-10-12 by the agent that closed the leftovers of §8, §10d and §10e that needed no ask-first edit.
Verdicts: `static`, `tests`, `e2e`, `build`, `sonar` (skipped: no token on this machine) and `quality` pass; the
`deps` stage runs and fails on the two pins that are behind (below), as designed.

### What landed

- **`sonar` stage.** `docker/Dockerfile.quality` copies the SonarScanner CLI 8.4.0.16527 (`bin`, `lib`, `conf`)
  from `sonarsource/sonar-scanner-cli:12.4.0.4321_8.4.0`, pinned by the same digest `scripts/ci/sonar_scan.sh`
  uses on the host, as a late layer (a scanner bump does not rebuild the npm, Playwright and emulator layers), and
  links it into `/usr/local/bin`; it runs on the image's JDK 21. Gate `sonar` = `bash scripts/ci/sonar_scan.sh`,
  which already skipped with a notice without a token and runs `sonar_report.py` after the scan. New in the script:
  with a token it first runs `sonar_report.py --check-reports` (every coverage and test report named in
  `sonar-project.properties` exists and is not empty; no token, no network), so an analysis without coverage is
  never uploaded; in the image it passes `-Dsonar.scanner.skipJreProvisioning=true` and keeps `SONAR_USER_HOME` in
  `reports/.cache/sonar`. `scripts/ci/run-all-checks.sh` forwards `SONAR_TOKEN` (by name). Tests: the skip, the
  report precondition, the in-image hand-off (`test_sonar_scan.py`), `--check-reports` (`test_sonar_report.py`).
- **`deps` stage.** Gate `dependency-updates` = `scripts/ci/check_dependency_updates.py`: npm (`npm outdated
  --json` at the root and with `--workspaces`; `--include-workspace-root` prints `{}` with npm 11.19), PyPI (`pip
  index versions --json`, 8 in parallel, for `scripts/ci/requirements.txt`, `pipeline/requirements-poetry.txt` and
  `pipeline/pyproject.toml`), Docker (images pinned by tag and digest, against tags of the same shape on Docker Hub
  or ghcr.io; best effort, an unreadable registry is a warning) and GitHub Actions (newest `vX.Y.Z` tag through
  `git/matching-refs`, because `github/codeql-action`'s "latest release" is a CodeQL bundle). `HELD` holds
  `typescript` 6.0.3, `@types/node` 24.19.2, the `node:24-bookworm-slim` image and `mando` 0.7.1 (`radon` 6.0.1
  requires `mando <0.8`; found by the first real run). A stale hold fails. The HTTPS transport of
  `check_contracts.py` moved to `scripts/ci/cihttp.py`, shared by both network gates. Offline tests with fake
  registries; one test reads the real repository's pins and requires every `HELD` entry to match its pin.
- **Conventional Commits.** `scripts/ci/check_commits.py` holds the rule (`type(scope): summary`, types `feat fix
  docs refactor test build ci perf chore revert`, a lower-case scope required, `chore(wip)` included, `!` for
  breaking, at most 100 characters, a blank line before the body). `scripts/git-hooks/commit-msg` runs it with
  `--message-file -` in the quality image (comments and the scissors section ignored; git's `Merge ...` and the
  autosquash subjects pass). Gate `commits` (static, after `gitleaks-history`) checks every non-merge commit of
  `COMMIT_RANGE`, else of the `GITLEAKS_LOG_OPTS` range `ci.yml` already exports, so CI enforces it without a
  workflow edit; locally it passes with a notice. In a range, `fixup!`/`squash!`/`amend!` commits fail. The four
  commits of `origin/master..HEAD` pass.
- **radon and bandit.** Both gates already covered `scripts/ci` and `pipeline/src` (§10c, §10e) and graded
  everything A, `check_release.py` and `check_rules_coverage.py` included. `pipeline-radon` now also covers
  `pipeline/tests` with `--no-assert`, like `radon` for `scripts/ci`; the new scripts were split until grade A.
- **Proposals** for every ask-first item the reviewers raised (`.htmlvalidate.json`, `eslint.config.js` with
  `eslint-plugin-playwright@2.12.1`, `.dependency-cruiser.cjs`, workflow hardening, `sonar.sources`,
  `.gitleaksignore` with the exact fingerprint of the `14d4d7b` false positive, the `.gitleaks.toml` header,
  `ruff.toml` for the GDAL stubs, the `pytest.ini` filter): `docs/research/DECISIONS-for-review.md`.

### Found by the first real `deps` run (2026-10-12), not bumped here

- npm `dependency-cruiser` 18.5.0 → 18.6.0 (root `package.json`; batch it with the `lint:deps` scope change of
  DECISIONS §3, since both rebuild the image's npm layer).
- Docker `docker/dockerfile` 1.27.1 → 1.28.0 (the `# syntax=` line of both Dockerfiles, with its digest).
- PyPI `mando` 0.7.1 → 0.8.2 is held (above).

## 10g. M1 contracts

Added on 2026-10-12 by the M1 contracts agent, before the M1 workstreams start in parallel. The interfaces, the
module ownership and the change-request process are `docs/research/M1-interfaces.md`; the public contract is
`docs/ENGINE_API.md`. Status: `quality` passes (static, tests, e2e, build); every new file is at 100 % lines and
branches.

- `@hcm/shared`: City Manifest v1 (`schemas/manifest.ts`), embed config (`schemas/config.ts`), Firestore documents
  (`schemas/firestore.ts`), localized validation (`schemas/validation.ts`: issues are `{path, code}` with `validation.*`
  i18n keys), manifest/engine compatibility (`schemas/compat.ts`), geo (`geo/`), the URL-hash codec v1 with the legacy
  hash (`url/hash.ts`), the Markdown subset and URL rules (`text/`), the legacy migration (`migration/`), and the
  viewer's i18n keys (112 in both catalogues).
- `@hcm/ui`: dynamic colour (`theme/dynamic-color.ts`, entry point `@hcm/ui/dynamic-color`, SpecVersion 2025 TonalSpot, WCAG checks) and the CLI
  `scripts/gen-theme.mjs` (`npm run theme:gen --workspace @hcm/ui -- --seed '#8B5E3C'`).
- Migration: `scripts/seed/migrate-legacy.mjs` (`npm run seed:migrate`) with the city seed
  `scripts/seed/bucharest.city.json` wrote `seed/bucharest/manifest.static.json` and `seed/bucharest/derived/`
  (45 photos, 34 cones, 9.52 MB, deterministic); the originals are untouched (DECISIONS §10).
- The JavaScript CLIs load TypeScript through Node 24's type stripping plus a `module.registerHooks` resolve hook
  (`.js` → `.ts`, extensionless → `.js` for the colour library). Their tests start them as child processes from
  `packages/shared/test/cli` until a `tools` Vitest project exists (DECISIONS §9, M1 change request CR-2).
- Scenario rows: V21 (embed API) and seven new rows on V01, V05, V07, V09, V13, V17 (`planned`).

## 10h. M1 contracts delta for PLAN Addendum 3

Added on 2026-10-12 by the contracts agent, alone, before the parallel M1 build. The full list of contract changes is
`docs/research/M1-interfaces.md` §11; the public side is `docs/ENGINE_API.md` (manifest `photosOverlay`,
`poiCategories[]`, `pois[]`, *Overlays*, the `op=` overlay ids, the new controller calls and events).

- New in `@hcm/shared`, every file at 100 % lines and branches: `schemas/geometry.ts` (GeoJSON Point, LineString and
  Polygon for the manifest; the nested-array-free Firestore shape and the conversions), `schemas/poi.ts`,
  `schemas/manifest-rules.ts` (the cross-value rules, kept apart so `manifest.ts` and the rules do not import each
  other), `overlays/model.ts`, `overlays/paint.ts`, `overlays/poi.ts`; Firestore `poi`, `poiCategory` and `history`
  documents; the hash's `HashLimits.overlayIds`; 16 i18n keys (128 in each catalogue).
- The POI fixture set of the e2e fixture manifest is `scripts/seed/e2e-pois.json`, pinned by
  `packages/shared/test/seed/e2e-pois.test.ts` against the migrated Bucharest manifest.
- Scenarios V22–V24 (planned); the brief's "V21–V23" collided with the existing embed-API behaviour V21.
- zod 4 behaviour the tests rely on: a failed size check (`.min`, `.max`) is "continuable", so the refinements after
  it still run (an empty polygon ring reports both `validation.tooSmall` and `validation.ringClosed`), while a failed
  type check aborts them. Write refinements that are safe on a short array, never on a mistyped one.
- No ask-first file was needed. The rules side is change request CR-4 (M2).

## 10i. M1 e2e infrastructure and the static sites

Added on 2026-10-12 by the M1 e2e-infra workstream (paths: `e2e/**`, `sites/**`, `starter-kit/**`, `scripts/site/**`).
Nothing committed or pushed; no ask-first file edited (proposals: `DECISIONS-for-review.md` §12).

- **Static sites** (`scripts/site/`): `npm run build:site` (gate `site-build`, build stage) writes `dist/site/bucharest`
  and `dist/site/starter-kit` from each site's `site.json`, `config.js` and `site.css`. The page is generated
  (`src/page.ts`, `src/html.ts`: elements and escaped text only, no inline script or style), never committed while
  `.htmlvalidate.json` lacks `html-validate:prettier` (§10d); its meta CSP (`src/csp.ts`, `src/origins.ts`) is the
  security review's public-site policy plus the consent-gated GA4/Firebase hosts and the origins the manifest and
  `config.js` name; Mapbox GL JS 3.32.0 loads from api.mapbox.com with `sha384` integrity computed from the pinned npm
  package (`src/sri.ts`), then `config.js`, then `engine/engine.mjs` as a module. `config.js` is parsed with the
  TypeScript parser, never run (`src/config-js.ts`; `sonarjs/code-eval` refuses `vm`), so it must be one assignment of
  literal data. The served manifest (`src/manifest.ts`) gets the token from `MAPBOX_PUBLIC_TOKEN` (forwarded by
  `run-all-checks.sh`; without it the e2e placeholder `pk.e2e-fake-token` and a warning) and its photos under
  `data/media/<id>/` (relative to the manifest, since the schema forbids `..`). Every input is validated before the
  output folder, which must lie below `dist/`, is replaced.
- **Tests**: `scripts/site/test` (gate `site-unit`, tests stage, `npm run test:site`) with its own
  `scripts/site/vitest.config.ts` (90 % per file, today 100 %) because the root configuration is ask-first (§12a).
  The generated pages are validated with the html-validate library against `.htmlvalidate.json`; the CLI entry runs as
  a child process under `node --import ./scripts/site/register-ts.mjs`.
- **E2E** (`e2e/`): `npm run build:site:e2e` (gate `e2e-build`) builds the engine and `dist/e2e-site` (Bucharest with
  the fixture manifest of `e2e/fixtures/manifest.ts`: the seed, two synthetic raster layers, `scripts/seed/e2e-pois.json`,
  the e2e crash endpoint). Playwright's `webServer` starts the site server (`:4310`) and the mock APIs (`:4311`,
  `e2e/mock-apis/`): Mapbox GL JS from the pinned package, a Standard-like fragment style with slots and the
  `show3dObjects` schema, TileJSON and solid-colour tiles from sharp with a z/x/y label, generated SDF glyphs, an empty
  sprite and icon set, map sessions, `events.mapbox.com` and GA4/Firebase beacons, jsDelivr engine paths, the crash
  endpoint; `GET /__calls`, `POST /__reset`. The fixtures (`e2e/support/test.ts`) add the network rules (loopback,
  mocked hosts forwarded per test, everything else blocked, WebSockets too), the console and placeholder guards, the
  map-instance counter and engine events, axe, the admin-input budget and the `lang` option. Projects and tiers
  (`E2E_TIER`): `e2e/projects.ts`.
- **Scenarios** now `exists`: `S-V00-HAPPY-MOCK-MAP`, `S-V00-BAD-UNMOCKED-PATH` (new harness rows),
  `S-V01-BAD-NO-JAVASCRIPT`, `S-V16-BAD-INLINE-SCRIPT` (new rows) and `S-V16-HAPPY` (the viewer smoke on c360 and
  l1440, which passes once the engine auto-boots from `engine.mjs`: change request CR-6 in `M1-interfaces.md`).
- **Dependencies** (`@hcm/e2e`): `@axe-core/playwright@4.13.0`, `mapbox-gl@3.34.1` (served by the mock, never bundled),
  `sharp@0.35.5`, `@hcm/shared`. The quality image's npm layer rebuilds for them.
- **Found on the way**: Mapbox GL 3.32 also requests `<sprite>/iconset.pbf` for a `mapbox://sprites/…` sprite; at zoom
  14 a 256 px raster source loads zoom-15 tiles; Playwright's text locators skip `<noscript>` content; a glob with
  `**/` inside a JSDoc comment ends the comment.

## 10j. M1 integration

Added on 2026-10-12 by the M1 integrator, alone in the tree after the four workstreams (ui-kit, engine-core,
engine-ui, e2e-infra). The resolved change requests and what the contract became: `docs/research/M1-interfaces.md`
§12 and its *Change requests* table. Nothing committed or pushed; no ask-first file edited (proposals:
`DECISIONS-for-review.md` §15).

- **The viewer boots**: `npm run build:site:e2e` builds the engine and `dist/e2e-site`; the viewer smoke S-V16-HAPPY
  (one map, one billed map load, `hcm-ready`, no console error, nothing outside the mocked hosts) passes on c360 and
  l1440 with the real Mapbox GL JS in SwiftShader.
- **Engine build**: `npm run build --workspace @hcm/engine` is `vite build` followed by `fonts:copy` (the kit's
  `packages/ui/fonts/*.woff2` and `LICENSES.md` into `dist/fonts/`, CR-15); the site build copies all of `dist/`.
  `engine.mjs` keeps the Firebase SDK in its lazy chunk; the IIFE inlines it (CR-10) and warns `EMPTY_IMPORT_META`
  (handled by `engineBaseOf`).
- **New gate** `fonts` (static, after `i18n`; CR-14): `npm run --silent fonts:check --workspace @hcm/ui`.
- **Fixes the integration found**: the kit's `styleMap` against the page's CSP (now `cssProperties`), the missing
  fonts in the engine build, the POI glyph font family, small photo sprites, the store's double map destroy (CR-17c).
- **Review screenshots**: captured at 360×800, 768×1024, 1440×900 and 2560×1440, light and dark, with the e2e
  fixtures (firewall and console guard on) into the git-ignored `reports/screenshots/m1/`. Six screens per viewport and scheme
  (home with the consent banner and the no-layers note, About, About's settings, photo markers with view cones, the
  photo sheet, the timeline over the e2e layers); the capture is a scratch Playwright project
  (`reports/m1-capture/`, git-ignored) that imports the e2e fixtures, run in the quality image with
  `npx playwright test -c reports/m1-capture/playwright.config.ts` after `npm run build:site:e2e`.

## 10k. M1 e2e scenarios

Added on 2026-10-12 by the M1 e2e author. Nothing committed or pushed; no ask-first file edited (proposal:
`DECISIONS-for-review.md` §16a, shard the CI e2e job). What the contract gained: `docs/research/M1-interfaces.md` §13.

- **Specs**: the viewer matrix V01–V25 (`e2e/specs/viewer/*.spec.ts`, one file per area), the starter kit
  (`e2e/specs/starter-kit/starter-kit.spec.ts`), the tour (`e2e/tour/viewer.tour.ts`), the a11y specials
  (`e2e/a11y/`) and no-WebGL; every viewer and starter-kit row exists except swipe compare (V06, M4).
- **Support**: `e2e/support/viewer.ts`, `map.ts`, `layout.ts`, `i18n.ts`; the instrumentation keeps the live maps
  (read only); `siteManifestData()` for changed manifests; the mock APIs gained the plain basemap, Standard's
  attribution, a 503 tile outage, the Firebase web config and the stand-in gtag.js; the servers never time out an idle
  keep-alive connection. The matrix gate reads `e2e/*.tour.ts`; the tour projects allow 120 s per test, the functional
  and a11y projects 60 s.
- **Product fixes the scenarios found** (`docs/LESSONS.md` #9–#16): analytics never sent (Performance Monitoring on a
  named Firebase app), the invalid-manifest card without its issue, `opacity=` fading hidden layers, focus lost after a
  sheet opened from the menu, mixed languages on a config error card, zod's eval probe under the CSP, English Mapbox
  labels on Romanian pages, and the tour's layout and contrast defects (toast off screen, chip over the menu, menu items
  off screen on a landscape phone, small touch targets, unreadable lightbox texts), and a debounced hash write that
  overwrote a newly opened link.

## 10l. M1 quality review

Added on 2026-10-12 by the M1 quality reviewer (coverage, tests, bundle size, dead code, docs). Nothing committed or
pushed; no ask-first file edited (proposal: `DECISIONS-for-review.md` §17a, minify `engine.mjs`).

- **Bundle budgets** (`scripts/ci/check_bundle_budget.py`): `engine.mjs`, which the city pages load, now has its own
  budget (110 KB gzip; 97.9 KB in M1), and the IIFE's went from 150 to 125 KB (112.0 KB in M1, the Firebase SDK
  inlined). zod is about 38 % of the engine's mapped bytes, Lit about 7 %.
- **Agent assets**: lessons #12 (focus before the announcement), #14 (zod `jitless` under the CSP) and #16 (the hash
  writer never overwrites the visitor's hash) now have their rules in the skills that own them.
- **Docs**: msw is marked as planned (M2) in `docs/TESTING.md` and the testing skill; the `e2e` stage in
  `docs/CI_PIPELINE.md` names the tour, the a11y specials and no-WebGL.

## 10m. M1 final gate

Added on 2026-10-12 after the three M1 reviews (UX and Material 3, accessibility and security, quality). Nothing
committed or pushed; no ask-first file edited.

- **The whole `quality` stage** (static, tests, e2e with every tier, build) ran green on the reviewed tree before the
  fixes below, and again after them. The e2e stage alone took about 19 minutes (8 workers, 16 cores).
- **Review screenshots**: 216 captures (12 states × 7 viewports from 360 × 800 to 3840 × 2160, light and dark, RO and
  EN at 360 × 800 and 1920 × 1080) in the git-ignored `reports/screenshots/m1-final/`, taken with a scratch
  Playwright configuration through the e2e fixtures. They found two defects no tier had seen (`docs/LESSONS.md` #21
  and #22): a POI glyph whose font arrived after the map settled stayed invisible (`updateImage` does not repaint an
  idle Mapbox map; new row `S-V24-BAD-ICON-FONT-LATE`), and the POI sheet's second photo thumbnail sat 4 px low.
- **Docs**: the architecture's UI and analytics sections match the code (own Lit components, the consent banner and
  error reports since M1, the open privacy decisions of `DECISIONS-for-review.md` §18), and both admin guides gained
  the public map's error cards under troubleshooting.

## 10n. M2 backend contracts

Added on 2026-10-12 by the M2 contracts agent, alone in the tree before the parallel backend build. The contracts,
module ownership and change requests are `docs/research/M2-interfaces.md`. Nothing committed or pushed; no ask-first
file edited (proposals: `DECISIONS-for-review.md` §19). Every new file is at 100 % lines and branches.

- **Firestore model** (`@hcm/shared`): `schemas/firestore.ts` keeps the content documents (photos gain the server-owned
  `processingError`, `duplicateOf`, `suggested`, `original`; the city's `mapbox` gains the token id and its origins);
  the operational ones moved to `schemas/firestore-ops.ts` (jobs with lease and steps, job log lines, scenes, the
  six-area `setup/status`, `setup/owner`, admins, invitations by address hash, Mapbox usage, the guard, manifest
  builds), every one stamped `updatedBy`/`updatedAt`; `schemas/firestore-common.ts` (timestamps, writers, the stamp),
  `schemas/client-writes.ts` (`CLIENT_WRITES`, the fields a client may write: M1's CR-1 and CR-4 at the schema level),
  `schemas/paths.ts` (`FIRESTORE_PATHS`, `STORAGE_PATHS`, lowercase city ids).
- **API** (`packages/shared/src/api/`): request and response schemas of every callable and of the crash endpoint, the
  registry `CALLABLES` / `HTTP_ENDPOINTS` / `BACKGROUND_FUNCTIONS`, 47 error codes with their callable and HTTP
  statuses (`API_ERRORS`) and Romanian and English messages in `packages/shared/src/i18n/api/` (kept out of the
  viewer bundle), helpers (`inviteIdFor`, `classifyMapboxToken`, `missingScopes`, `manifestTaskId`, `historyEntryId`,
  `apiErrorFromFailure`, `setupReady`), and `redactText` (`packages/shared/src/text/redact.ts`, the engine's rules plus
  `ya29.` tokens; CR-M2-4 asks engine-core to use it).
- **Functions**: the port interfaces of every outside service (`functions/src/ports/`, with `UpstreamError` and
  `InvalidDocumentError`) and the callable plumbing (`functions/src/api/`: `defineCallable`, `requireAccess`,
  `ApiError`, `toHttpsError`), tested through the v2 `.run()` entry point.
- **Gate change**: the `i18n` gate also checks folders directly inside a `packages/*/src/i18n/` folder (the API
  catalogue), with its tests.
- **Scenarios**: A01–A07, A20 and A22 refined, new behaviours A23 (edit history and revert) and A24 (the crash
  reporting endpoint); the brief's numbers A22 and A23 were taken (`e2e_scenario_matrix_skill.md` rule 4).
- **Tool behaviour met on the way** (now in `ci_quality_gates_skill.md`): ESLint's `complexity` counts each default
  value of a destructuring; knip reports a second export of the same value and an exported type nobody imports outside
  a package's entry file.

## 10o. M2 viewer fixes

Added on 2026-10-12 by the viewer workstream (`packages/ui/src/viewer/**`, `packages/engine/src/telemetry/**`), in
parallel with the M2 backend. It fixed the open viewer issues of §10m and `DECISIONS-for-review.md` §18; decisions and
the rest: `DECISIONS-for-review.md` §21, change requests CR-M2-36 to CR-M2-38 (and CR-M2-4, done) in
`M2-interfaces.md`. Lessons: `docs/LESSONS.md` #23–#28. Nothing committed or pushed; no *Ask first* file edited.

- **Mapbox logo and attribution in every state**: while a modal sheet, the lightbox or About covers the map, Mapbox's
  own bottom controls are hidden and `<hcm-map-attribution>` shows the logo and the attribution read from Mapbox's
  control (a `MutationObserver`, `attribution.ts`) in a legal bar under the modal layer, or at the foot of About. The
  viewer's layout moved into an inner grid `.viewer`: a page may set the element's own `display`. (Replaced on
  2026-11-12 after the Pixel 9 Pro review, P3: the surfaces draw above Mapbox's controls, which move out from under a
  modal sheet, `legal-lift.ts`; the bar and `<hcm-map-attribution>` are gone; DECISIONS-for-review.md §174.)
- **Privacy**: no Performance Monitoring in the public viewer (the Firebase chunk is app and analytics only); GA4 gets
  the page without its hash on its configuration and on every event; a withdrawal expires `_ga` and `_ga_*`.
- **CR-M2-4** applied: the error reporter uses `redactText` and `ErrorReport` of `@hcm/shared`.
- **Error card, skip link, photo list**: M3 error container with a filled tonal Retry and plain visitor copy (the
  `error.*` texts in `packages/shared/src/i18n/`, keys unchanged); the skip link starts at the map pane past a docked
  pane; photo-list dates in body-medium.
- **Tests**: every new or changed viewer and telemetry file at 100 % lines and branches; 11 new e2e rows, all `exists`;
  the tour checks the logo and the attribution in every state, the usable controls only (`visibleBoxes(…, { usable:
  true })`). The GA4 stand-in falls back to `location.href` and writes the GA4 cookies, as gtag.js does.
- **Bundle**: `engine.mjs` 101.0 KB gzip (budget 110), the IIFE 106.0 KB (125): the IIFE lost the inlined Performance
  Monitoring.

## 10p. M2 integration

Added on 2026-10-12 by the M2 integrator, alone in the tree after the parallel backend workstreams (rules, fn-admin,
fn-setup, fn-content, fakes) and the viewer fixes. What was wired, what the contract gained and what is still open:
`docs/research/M2-interfaces.md` → *Addendum A*; decisions: `DECISIONS-for-review.md` §22. Nothing committed, pushed or
deployed; no *Ask first* file edited.

- **Functions wired**: `functions/src/index.ts` exports the 32 registry functions as eight groups from the folders'
  factories; `functions/src/global-options.ts` sets `us-central1`, the caps, concurrency 80 and the runtime service
  account of every function (`RUNTIME_ACCOUNTS`, `runAs`); `functions/src/deps.ts` builds `RuntimeConfig` and every
  adapter, and keeps the Functions emulator off real hosts (`functions/src/adapters/emulator-fetch.ts`). The M0
  `triggers/`, `handlers/` and `secret-store-rest.ts` are gone with their tests.
- **Deploy artifact**: `sharp` 0.35.5 joined `functions/package.json` (and the lockfile's `functions` entry; sharp and
  its `@img/*` packages are no longer dev-only); `functions/build.mjs` now bundles every non-pinned dependency (it had
  left `zod` external), checks the bundle's imports and loads it. The Functions emulator loads all 32 functions from
  `functions/dist/` once `firebase.json` has the Pub/Sub (8085) and Cloud Tasks (9499) emulators.
- **Firebase config**: Hosting site `bucurestiul-disparut` (admin CSP: frames only for its two auth domains, Google
  sign-in and reCAPTCHA); `.firebaserc` `default: bucurestiul-disparut` beside `e2e: demo-hcm`; a test refuses an npm
  script that starts the emulators without `--project demo-hcm`.
- **Change requests resolved**: the integrator's own (CR-M2-2, 8, 10, 12, 13, 14, 19, 20, 24, 26, 27, 29, 33, 34, 35,
  38), and, the contracts agent having finished, the contract ones (CR-M2-9, 11, 15 b–d, 16, 23, 28, 30, 31, 32) and
  the site build's CR-M2-36. New: CR-M2-39 and CR-M2-40 for M2b.
- **The fakes** (`packages/test-support/src/{api-fixtures,fakes}/`, `functions/test/support/`): what they are and how
  each tier uses them is `docs/TESTING.md` → *Fake upstreams* and `.agent/skills/quality/testing_strategy_skill.md` →
  *Seams and fakes*; found on the way: a fixture whose `call` did not start with its method (caught by the catalogue
  test), and Prettier's line breaks pushing a fake past `max-lines-per-function` (a service's routes are built by helper
  functions).
- **Scenarios**: 15 rows flipped to `exists`, 14 `functions` rows registered and tagged (A03, A06, A08, A10, A20).
- **Tests**: `METADATA_SERVER_DETECTION=none` in `scripts/ci/run-emulated-tests.sh` (no metadata-server probe, no
  hook timeouts); new `functions/test/{index,deps,global-options}.test.ts` and
  `functions/test/adapters/emulator-fetch.test.ts`; every functions file at 100 % lines and branches.
- **Lessons**: `docs/LESSONS.md` #29–#34.
- **Left for M2b and later**: the admin and its emulator e2e tier (CR-M2-6, CR-M2-21, CR-M2-22's `x-hcm-test`
  forwarding, CR-M2-39, CR-M2-40), the provisioner's IAM and GA4 stream settings (CR-M2-5, CR-M2-37), the deploy-time
  configuration and a `functions/dist/` lockfile (§22a, §22b), the layering rules (§19a), App Check enforcement.

## 10q. M2b admin contracts

Added on 2026-10-12 by the M2b contracts agent, alone in the tree before the admin workstreams (admin-shell, setup-ui,
google-clients, admin-e2e) start in parallel. The contract, the ownership and the change requests are
`docs/research/M2b-interfaces.md`; proposals for *Ask first* files are `DECISIONS-for-review.md` §23. Nothing committed,
pushed or deployed; no *Ask first* file edited. Every new file is at 100 % lines and branches.

- **Contract**: the admin's routes, shell layout per window class, auth states, boot sequence and session expiry; Google
  OAuth with one scope per step, memory-only tokens and the consent note that explains Google's unverified-app screen;
  **bootstrap mode** before Blaze (no function, no Firestore: Google REST from the browser with the owner's token, step
  state in memory and `sessionStorage`), the automatic owner claim once the server answers, the Setup Assistant's step
  graph (a)–(h) with detection, actions and input budgets, the idempotent provisioner with its execution order, exact
  API calls and roles, the legacy import, the e2e admin world.
- **Code** (done): `PROVISION_ITEMS` gained `crash-alerts` and `api-key`; the admin's two catalogues
  `packages/shared/src/i18n/admin-shell/` and `admin-setup/` (`translateAdminShell`, `translateAdminSetup`, over the new
  `catalogueTranslator`); `packages/admin/src/google/scopes.ts` (`GOOGLE_SCOPES`, `unsatisfiedScopes`),
  `packages/admin/src/setup/steps.ts` (`SETUP_STEPS`, `SETUP_STEP_SPECS`, `nextSetupStep`, `setupInputBudget`),
  `packages/admin/src/routing/routes.ts` (`ADMIN_ROUTES`, `parseAdminRoute`, `adminRouteHash`), with their tests.
- **Scenarios**: A04, A07 and A22 refined and extended; new behaviours A25 (bootstrap mode), A26 (deployment detection
  and the automatic claim), A27 (Google OAuth scopes), A28 (the legacy import), A29 (navigation and layout), A30 (minimum
  admin input), all `e2e-admin` and planned; `docs/E2E_SCENARIOS.md` regenerated.
- **Found on the way** (in the skills now): `ci.yml`'s deploy jobs declare `environment: deploy` while the security
  review's Workload Identity condition says `production` (§23g); the deploy job deploys Hosting from
  `packages/admin/dist` without building it (§23b); a missing callable's 404 has no CORS headers, so the Firebase SDK
  reports it as `internal` like a network failure, and "not deployed" needs Google's Cloud Functions list to tell from
  "down"; the Hosting emulator would serve the admin's CSP with `upgrade-insecure-requests`, which upgrades the http
  emulators, so the admin's e2e build gets its own server.
- **Docs**: both admin guides (start-up mode, Google's permission screens, the automatic claim, provisioning, the server's
  installation, the legacy import, the USGS countdown), `docs/ARCHITECTURE.md`, `docs/TESTING.md`, the admin, e2e,
  consent, security, i18n and rules skills, the setup-assistant digest and its mirror, the catalogue.

## 10r. M2b admin workstreams and integration

Added on 2026-10-12 by the M2b integrator, after the four parallel workstreams (admin-shell, setup-ui, google-clients,
admin-e2e). What exists, and how to extend it; the contract is `docs/research/M2b-interfaces.md` (Addendum A: the admin as
integrated). Nothing committed, pushed or deployed; no *Ask first* file edited.

- **New paths**: `packages/admin/src/{app,auth,firebase,routing,state}/` (the shell's DOM-free logic, `mount()` with
  injected ports), `packages/admin/src/setup/` (the Setup controller, one flow per step), `packages/admin/src/google/`
  (typed Google REST clients over `fetch`), `packages/admin/src/provision/` (the provisioner of `PROVISION_ITEMS`),
  `packages/admin/src/import/` (the legacy import); `packages/ui/src/admin/` (the shell, the auth panels, the Setup cards,
  entry `@hcm/ui/admin`); `infra/project.json` (the real project's public ids, GitHub owner 6506625 and repository
  243934124); `scripts/site/build-admin.ts` and `scripts/site/src/admin/` (the admin's page, CSP, Hosting rules, fonts,
  `project.json`, the legacy bundle); `e2e/admin/` (the admin tier: world, fixtures, harness, the owner's smoke and
  journey), `e2e/mock-apis/{admin-server,oauth,oauth-page,lease}.ts`; ten new fake Google services in
  `packages/test-support/src/fakes/`; `functions/src/setup/create-city.ts`.
- **Build**: `npm run build` ends with the admin's site step (`scripts/site/build-admin.ts`), `npm run build:admin`
  builds the admin and its folder (Hosting's `predeploy`), `npm run build:site:e2e` also builds `functions/dist` and the
  admin's `e2e` bundle (`npm run build:e2e --workspace @hcm/admin`). Hosting serves `index.html`, `project.json` (a copy of
  `infra/project.json`), `fonts/` and `legacy/bucharest/` (cached a day) next to `admin.iife.js` (about 310 KB gzipped,
  budget 450).
- **Iterating on the admin tier**: start one quality-image container with the four servers (`node --import
  ./scripts/site/register-ts.mjs e2e/mock-apis/main.ts mock|site|admin` and `npx firebase emulators:start --project
  demo-hcm --only auth,firestore,storage,functions,pubsub,tasks` with the environment of `e2e/admin/world.ts`), then run
  `npx playwright test` in `e2e/` inside the same container with `E2E_TIER=admin`: outside CI the servers are reused. After
  changing `functions/src` rebuild `functions/dist` and restart the emulators; after changing the admin rebuild its `e2e`
  bundle and rerun `scripts/site/build-admin.ts` (Vite empties `dist/`).
- **Extending**: a new admin page registers with `registerAdminPage(id, load)`; a new Setup step needs its row in
  `SETUP_STEP_SPECS`, its flow in `packages/admin/src/setup/`, its body in `packages/ui/src/admin/setup/`, its texts in the
  `admin-setup` catalogue (RO and EN) and its scenario rows; a new Google call goes through `packages/admin/src/google/`
  and a fake in `packages/test-support/src/fakes/`; a new callable needs the registry row, `RUNTIME_ACCOUNTS`, the handler,
  the group's export and the type checks of `functions/test/index.test.ts`.
- **Waiting for the user** (ask first, `DECISIONS-for-review.md` §23–§25): `runtime.json` with the App Check site key and
  the invoker fix in `ci.yml` (CR-M2b-6), the admin's dependency-cruiser layering (CR-M2b-7), the bundled city created
  published (§25a). CR-M2b-2 landed: without `HCM_OAUTH_CLIENT_IDS` the claim reads the Google sign-in client from Identity Toolkit (its answer shape is UNVERIFIED until the first real project).

## 10s. The reviewed decisions applied

Added on 2026-10-12 by the agent that applied `DECISIONS-for-review.md` §1 to §25 after the user approved them (relayed
by the orchestrator). Each section's heading there says whether it was applied; §26 is the table of outcomes and §27 a
new proposal (a standing approval for stricter gates) that waits for the user's own answer. Nothing committed, pushed
or deployed.

- **Configs**: `.htmlvalidate.json` extends `html-validate:prettier`; `eslint.config.js` lints `e2e/` with
  `eslint-plugin-playwright@2.12.1`, refuses `styleMap`, holds the site build to the product limits and gives the
  cities' `config.js` browser globals; `.dependency-cruiser.cjs` has the Firebase, functions and admin layering rules
  and `lint:deps` cruises `e2e`, `firebase/rules-tests` and `scripts/site` (`dependency-cruiser` 18.6.0);
  `vitest.config.ts` adds the `engine-browser` and `tools` projects and pre-bundles the browser tests' dependencies;
  `knip.json` covers `scripts/site` and the CLIs' tests; `ruff.toml` allows `N802` in the GDAL stubs, now ordinary
  `def`s; `sonar-project.properties` analyses `scripts/site/src` and `.github/actions`; `.gitleaksignore` holds the
  `14d4d7b` fingerprint and `gitleaks-history` reads `.gitleaks-history.toml` (no path allowlist);
  `packages/engine/vite.config.ts` minifies `engine.mjs` (budget 100 KB).
- **Workflows**: `deploy-firebase` installs before authenticating; `sonarqube` checks every report through
  `sonar_report.py --check-reports`; `deps.yml` opens its issue only for real findings; `release.yml` builds read-only
  and publishes without repository code; `static` exports `COMMIT_RANGE`; `e2e` runs four shards; `build` reads
  `vars.MAPBOX_PUBLIC_TOKEN` and the Pages artifact is `dist/site/bucharest`.
- **Pipeline**: the `site-unit` gate, `test:site` and `scripts/site/vitest.config.ts` are gone (the site build's tests
  are the `tools` project); new static gate `deploy-lock-audit`; the `contract` stage compares the Mapbox CDN's bytes
  with the npm release's integrity.
- **Functions**: `functions/deploy-env.json` (public `HCM_*` values per project, written as `dist/.env.<project>`),
  `functions/deploy-lock/` (the artifact's locked tree, `npm run deploy-lock --workspace @hcm/functions` with the
  network), sharp imported lazily; `functions/build.mjs` checks all three and dynamic imports.
- **Tests moved or added**: `scripts/seed/test/migrate-legacy.test.ts` (on the real city seed), `scripts/seed/test/png.ts`,
  `packages/ui/scripts/test/gen-theme.test.ts`, `packages/engine/test/browser/adapter-env.test.ts`,
  `functions/test/deploy-env.test.ts`, the contract check's integrity probes.
- **Not applied** (reasons in §26): §13b, §15c, §18b, §23b, §23c, §25c, §25d.

## 10t. Pipeline baseline and the clean-checkout fix

Added on 2026-10-17 by the Measure agent of the pipeline optimisation (the user's goal: a pipeline that does not take
too much time). Nothing committed, pushed or deployed; no gate, threshold, scenario or configuration changed.

- **Measured** every stage on the laptop and the NUC, per gate with CPU use, per Vitest and Playwright project, the
  slowest tests and the CI shards' shares: `docs/research/pipeline-baseline.md`. `quality` takes about 21 minutes on
  the laptop and 14 on the NUC; `e2e` is 84 % and 71 % of it, and the serial admin tier runs alone for its last two
  minutes; `static` is serial (about two of 16 threads busy) with ESLint at 73 to 80 s and a cold `tsc -b` at 38 to
  40 s.
- **Fixed** the `agent-assets` gate on a fresh clone: `git check-ignore --no-index` does not match `dist/` against a
  folder that was never built, so `functions/dist` and `packages/admin/dist` were reported missing on the NUC and on
  every CI runner. `scripts/ci/check_agent_assets.py` now also asks about a missing path's folder form; pinned by a
  test, recorded in `.agent/skills/quality/pipeline_skill.md` → *Local tooling quirks*.

## 10u. Pipeline optimisation: the CI workflows

Added on 2026-10-17 by the CI agent of the pipeline optimisation. Nothing committed, pushed or run on GitHub; the
decisions and their reasons are `docs/research/DECISIONS-for-review.md` §28, the estimates `docs/CI_PIPELINE.md` →
*Expected wall time*.

- **`ci.yml`**: `static`, `tests`, `e2e` and `build` need only `build-image` and run side by side; the deploy jobs
  need all of them, `static` included. The e2e jobs are split by tier and measured test time (`E2E_TIER` and
  `E2E_SHARD` per matrix entry): `fn` in three count shards (about 1,010, 1,130 and 1,110 s of laptop test time) and
  `admin,smoke,a11y,nogl,tour` in one job (about 860 s), the only one that starts the emulators; §16a's shard 4
  carried 2,289 s. `static` carries the `.tsbuild/` folders and `reports/.cache/mypy*` between runs
  (`actions/cache` v6.1.0, `55cc8345863c7cc4c66a329aec7e433d2d1c52a9`). Timeouts: `static` and `tests` 20 minutes,
  `e2e` 40, `build` 15.
- **`nightly.yml`** (new): every day at 02:37 UTC on `master`, the four e2e jobs of `ci.yml` plus the `tour-matrix`
  stage (the one `all` adds) as `E2E_SHARD` `1-2/5` and `3-5/5` (about 1,180 s each), its own `build-image`, and the issue "Nightly e2e
  failed" through `.github/actions/upsert-issue` when anything fails.
- **Docs-only pull requests** (§28f, applied on 2026-10-17 after the user approved it in chat): the `changes` job lists
  the pull request's files, and when every one is Markdown `tests`, `e2e` and `build` are skipped, and with `tests`
  `sonarqube`; `static` runs. Pushes, tags and dispatches run everything. **Unchanged**: the `type=gha` image
  transport, the npm cache and the browsers baked into the image, `node_modules` not cached (`npm ci` takes 7 s), the
  concurrency rules.
- **Lessons**: `tsc -b` with `.tsbuild/` folders restored from an earlier build still fails every dependent project of
  a broken export (measured: cold 77 s, restored 3.1 s, restored after a breaking change 21.7 s with 16 errors in 10
  files); an ESLint cache is not safe to carry with type-aware rules, so CI carries none (recorded in
  `.agent/skills/quality/pipeline_skill.md` → *CI mapping*). Playwright 1.64 shards by test count; a tier list in
  `E2E_TIER` plus a count shard inside a uniform tier is how CI balances by time.

## 10v. Pipeline optimisation: the e2e stage

Added on 2026-10-17 by the e2e agent of the pipeline optimisation. Nothing committed or pushed; the decisions and their
reasons are `docs/research/DECISIONS-for-review.md` §29, the numbers `docs/research/pipeline-baseline.md` → *After the
e2e optimisation*.

- **Tiers** (`e2e/projects.ts`): the tour is split into `tour` (9 projects, every push) and `tour-matrix` (the other
  35; `E2E_TIER` unset runs every tier but it, `all` every tier). New stage `tour-matrix` (`e2e-matrix`, `e2e-build`,
  `playwright-tour-matrix`) in `all`, which is now `static`, `tests`, `e2e`, `tour-matrix`, `build`, `sonar`, and in the
  nightly workflow (§28e). Every scenario row still runs on every push.
- **Order and the admin tier**: the projects run `admin`, `smoke`, `a11y`, `nogl`, `tour`, `tour-matrix`, `fn`, longest
  first; the admin projects lost `workers: 1` and every admin spec file declares the Playwright lock `ADMIN_LOCK`
  (`e2e/admin/support/test.ts`), so the admin chain runs on one worker from the start instead of alone at the end; the
  mock APIs' lease stays as the guard behind it.
- **`E2E_SHARD`** takes `first-last/total` as well as `index/total` (`e2e/playwright.config.ts` turns a range into
  Playwright's `PWTEST_SHARD_WEIGHTS`); a sharded run writes a blob report to `reports/blob/e2e*/`; a `tour-matrix`-only
  run writes its own reports (`reports/junit/e2e-tour-matrix.xml`, `reports/playwright-tour-matrix/`).
- **`e2e-build`** is `python3 scripts/ci/e2e_build.py`: `npm run build:site:e2e` unless its stamp in
  `node_modules/.cache/hcm/` shows no input changed and no output was touched (`scripts/ci/tests/test_e2e_build.py`).
- **Two machines**: `PIPELINE_STAGE=<stage> bash scripts/ci/e2e-split.sh` runs the stage here with the tail of each
  Playwright run while the NUC runs the head from an rsync of the tree, merges both parts' reports and prints one
  verdict (`scripts/ci/tests/test_e2e_split.py`). The `e2e` stage took 283 s this way, against 1052 s on the laptop and
  592 s on the NUC before; 335 s on the NUC alone.
- **`waitForEngineEvent`** (`e2e/support/viewer.ts`) waits for the event in the page instead of polling the recorded
  events. Shorter `expect.poll` intervals were measured and reverted (no throughput at full CPU).
- **Lessons** (in `.agent/skills/quality/pipeline_skill.md` → *Local tooling quirks*): Playwright's shard weights
  variable, dependency phases that would serialise tiers, `merge-reports` across machines, waits at saturation, and the
  image rebuild after a `package.json` or `requirements.txt` change.

## 10w. Pipeline optimisation: the tests stage

Added on 2026-10-17 by the tests agent of the pipeline optimisation. Nothing committed or pushed; the decisions are
`docs/research/DECISIONS-for-review.md` §30, the numbers `docs/research/pipeline-baseline.md` → *Addendum: the tests
stage*. Every gate, test file and threshold of `tests` runs as before.

- **Emulators**: `npm test` gives the emulators' JVMs two JIT compiler threads (`JAVA_TOOL_OPTIONS=-XX:CICompilerCount=2`
  in `package.json`); `scripts/ci/check_rules_coverage.py save` fetches the two 250 MB rule-coverage reports at once.
  The tests stage already used one emulator session for everything that needs one (`vitest`); nothing else starts
  them.
- **Vitest**: `shared`, `engine`, `admin` and `functions` share one module graph per worker (`SHARED_MODULE_GRAPH` in
  `vitest.config.ts`); the composition root's test, the one with `vi.mock`, is the new isolated project `functions-deps`;
  `rules` and `tools` stay isolated. Both functions projects give every test and hook 60 s (`EMULATOR_TIMEOUTS`) instead
  of per-file `vi.setConfig`. The browser projects' pre-bundled dependencies (§14 of the decisions) needed no change: no
  re-optimisation in any run, cold or warm. The rules world seeds through one rules-disabled context held open per
  file (`holdOwner` in `firebase/rules-tests/test/support/world.ts`, closed by `world.close()`) instead of a new
  Firebase app per seed.
- **pytest**: pytest-xdist 3.8.0 (`scripts/ci/requirements.txt`), at most four workers (`pytest.ini`); the pipeline's
  tests stay in one process (GDAL per worker made them slower).
- **Robustness**: the functions tests that timed out under load now have the emulator timeouts (`docs/LESSONS.md` #51);
  the stand-in emulator of the rule-coverage tests no longer waits half a second to shut down.
- **Lessons** (in `.agent/skills/quality/testing_strategy_skill.md` and `pipeline_skill.md`): Vitest starts Node projects
  in alphabetical order, and starting the emulator-backed ones first was slower; the `vitest` gate is CPU-bound, so only
  less CPU work makes it faster; any `package.json` edit rebuilds the image's npm layers.

## 10x. Pipeline optimisation: the `static` stage and the gate engine

Added on 2026-10-17 by the static agent of the pipeline optimisation. Nothing committed or pushed; the decisions are
`docs/research/DECISIONS-for-review.md` §31, the numbers `docs/research/pipeline-baseline.md` → *Addendum: the `static`
stage and the gate engine*. Every gate of every stage runs as before; only when, and how many at once, changed.

- **Gate engine** (`scripts/ci/gate_runner.py`, new): `scripts/ci/pipeline.py` runs a stage's gates up to
  `PIPELINE_JOBS` at once (default the CPU count; `scripts/ci/run-all-checks.sh` forwards the variable). `Gate` gained
  `needs` (gates whose output it reads; the registry check refuses one listed later) and `exclusive` (runs alone: the
  two Playwright gates). Output is one block per gate in registry order, as a serial run printed it, plus a
  `<stage> finished in …` line; failures are listed in registry order. Within one run of `quality` or `all`, a gate a
  previous stage ran is reused, not run again (`pytest`, `e2e-matrix`, `e2e-build`). Tests:
  `scripts/ci/tests/test_gate_runner.py`, `test_pipeline_stages.py` (with the fake shell `fakeshell.py`, shared with
  `test_pipeline.py`), 100 % branch coverage.
- **`package.json`**: ESLint lints with worker threads, a quarter of the CPUs and at least two (eight, ESLint's `auto`
  here, cost five times the CPU of one thread and was slower than four); Prettier and stylelint keep content-keyed
  caches in `reports/.cache/`. ESLint keeps no cache (unsafe with type-aware rules).
- **Measured on the busy laptop** (other agents' stages ran beside every run): warm `static` 149 to 176 s with the old
  engine, 48 to 64 s with the new one at a similar load; cold 228 to 247 s against 88 s. Warm, ESLint is the critical
  path; cold, `tsc -b` (47 s alone, 87 s beside the other gates).
- **Applied later**: the image's npm layer keyed on the dependencies only (§31e, by the integrator, §32a); two costly
  ESLint rules that cannot add a finding here turned off (§31f, after the user approved it in chat on 2026-10-17:
  `sonarjs/deprecation`, which `@typescript-eslint/no-deprecated` covers, and `sonarjs/aws-restricted-ip-admin-access`).

## 10y. Pipeline optimisation: the integration

Added on 2026-10-17 by the integrator of the pipeline optimisation. Nothing committed, pushed or deployed; the
decisions are `docs/research/DECISIONS-for-review.md` §32, the after table of every stage
`docs/research/pipeline-baseline.md` → *Addendum: the integrated pipeline*, the overview `docs/CI_PIPELINE.md` →
*Stages, tiers and machines*.

- **Combined** §28 to §31 without a code change: the gate engine's registry already held the `tour-matrix` stage, and
  `package.json` carries both the tests agent's `test` script and the static agent's lint and format scripts.
- **`docker/Dockerfile.quality`** has a `manifests` stage that copies every workspace manifest with its scripts dropped
  (all but `emulators:setup`), so an npm script edit no longer rebuilds the npm, Playwright and emulator layers (§31e,
  applied as §32a): a new workspace's `COPY` line goes there now, not next to `npm ci` as §3 above says.
- **`scripts/ci/e2e-split.sh`**: measured default shares, `2:3` for `e2e` and `tour-matrix`, `1:2` for `quality` and `all`. **`nightly.yml`**
  uploads the `tour-matrix` parts' reports too. **`.gitignore`** names `.hypothesis/` (`docs/LESSONS.md` #52).
- **Measured** (laptop otherwise idle): `static` 48 s warm and 93 s in a fresh clone, `tests` 57 and 60 s, `build`
  5 s; split with the NUC `e2e` 306 s, `quality` 324 s and `all` 398 s, against about 21 minutes for `quality` on the
  laptop before.
  The floor of a split e2e run is the admin tier's one-at-a-time chain on the NUC (§32f proposes halving it).

## 11. Planned paths

Appended by the M0 agent-assets agent on 2026-10-11. The `agent-assets` static gate
(`scripts/ci/check_agent_assets.py`) requires every repository path written in back-ticks (or as
a relative link) in `AGENTS.md`, `CLAUDE.md`, `README.md`, `.agent/`, `.agents/`, `.claude/` and
`docs/` (outside `docs/research/`) to exist, be git-ignored, or be listed here. Each entry is a
deliberate future path with the milestone or reason that creates it. **Remove an entry in the task
that creates the file**; keep the list short (a plan that never lands is a stale doc). Append new
entries here; do not rewrite the rest of this file.

- `.claude/settings.json`: the Claude Code permission allowlist (pipeline and read-only commands). Editing it is ask first (`AGENTS.md` → *Boundaries*), so it waits for the user's explicit approval of its contents.
- `e2e/env`: M1–M2, the emulator environment for e2e (`.env.demo-hcm`, the test `.secret.local`).
- `scripts/ci/sonar_setup.py`: the user's one-time SonarCloud token helper (hidden prompt, writes `.sonar-token`).
