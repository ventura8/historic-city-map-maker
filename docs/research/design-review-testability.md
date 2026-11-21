# Testability and repo/CI structure report: "București dispărut" Historical City Map Engine

Lens: testability, monorepo layout, CI and quality gates.

Sources read (read-only):

- the draft plan, `research.json` (verification corrections win over research claims), and the current repo
- sibling projects:
  - Whisper-Pro-ASR: Docker-only gates, `check-inline-ignores.py`, per-file `check_coverage.py`, Sonar job
  - Watch-GPS-Dashboard: `run-all-checks.sh` stages, git hooks, e2e matrix skill, `check_agent_assets.py`, skill mirrors, `sonar_setup.py`/`sonar_report.py`, weekly `deps.yml`
  - Fork-Linux, worktree `Fork-Linux-wt/e2e-coverage`: `scripts/check-coverage.py`, which reads its scope from `sonar-project.properties`
  - Auto-Subtitle-Generator: Sonar scope, `--cov-branch`

Every version below was taken live from the npm and PyPI registries, the GitHub releases API and jsDelivr type files on 2026-10-11.

---

## 0. Findings that change the draft plan (verified today)

| # | Finding | Consequence |
| --- | --- | --- |
| F1 | `typescript@latest` is **7.0.2** (the native Go port), but `typescript-eslint@8.71.1` requires `typescript >=4.8.4 <6.1.0`. | Pin **`typescript@6.0.3`** for `tsc -b` and type-aware lint. Hold TS 7 in the deps-stage `HELD` table (Watch-GPS convention) until typescript-eslint supports it. |
| F2 | `firebase-functions-test@3.5.0` requires `jest>=28` and `firebase-admin ^8–^13` as peers. The draft needs `firebase-admin@14.5.0`. | **Do not use firebase-functions-test.** Use pure handlers with injected dependencies, plus a thin trigger wrapper tested through v2's `fn.run(event)`, plus emulator integration tests. |
| F3 | `@firebase/rules-unit-testing@6.0.0` needs Node `>=24.12` and `firebase ^13`. The Cloud Functions runtime list includes `nodejs24` and `nodejs26`; firebase-tools added nodejs24 in 14.26. | **Node 24 everywhere**: tooling, CI image and functions (`"runtime":"nodejs24"`). Pin firebase 13.0.0 (rules-unit-testing forces 13). |
| F4 | firebase-tools v15.0.0: "Removed support for running emulators with Java versions prior to 21". The emulator docs still say 11. | The quality image must ship **JDK 21**. |
| F5 | Mapbox GL 3.32.0 typings expose these test-relevant settings: <ul><li>`testMode` (silences token errors)</li><li>`performanceMetricsCollection` (default `true`)</li><li>`mapboxgl.config.EVENTS_URL` (nullable)</li><li>`config.API_URL`</li><li>`config.REQUIRE_ACCESS_TOKEN`</li><li>`failIfMajorPerformanceCaveat` (default `false`, so SwiftShader works)</li></ul> | Unit tests of the real map can switch off telemetry and token checks from the test side only. Production should also set `performanceMetricsCollection:false` (privacy). |
| F6 | Vitest 5.0.5: coverage files are only reported if `coverage.include` lists them (untested files are not added automatically). `perFile` thresholds exist. Browser mode uses `@vitest/browser-playwright@5.0.5`. | Every package must list its `coverage.include` explicitly, or untested files silently disappear from coverage. |
| F7 | Playwright 1.64 has `failOnFlakyTests`, `forbidOnly`, `storageState({indexedDB:true})`, `page.clock`, `ariaSnapshot`, `routeWebSocket` and `stylePath`. | Use them: Firebase Auth state in IndexedDB, fake polling clocks, structural snapshots. |
| F8 | The research verifier noted that the GDAL ghcr images on the Ubuntu 26.04 base ship **Python 3.14**. rasterio wheels bundle their **own** GDAL. | Pipeline: `requires-python ">=3.14,<3.15"` (the draft says 3.13). Use `osgeo.gdal` from the image plus numpy and opencv-headless. **No rasterio wheels**, which would put two GDALs in one process. |
| F9 | The repo's default branch is **`master`**; every sibling workflow hard-codes `main`. | Use a `DEFAULT_BRANCH` env var in workflows and `ci_plan.py`. Alternatively, rename to `main` at cutover (decision for the user). |
| F10 | jsDelivr `/gh/` limits are 150 MB per package and 20 MB per file, and the engine is served from **this repo's** tags. | Add a repo-budget gate (tree at a tag ≤ 60 MB, no file > 5 MB, screenshot baselines ≤ 15 MB). Photos move to Storage, so `photos/` leaves the tree. |
| F11 | `@google-cloud/run` and `@google-cloud/secret-manager` speak gRPC, and msw/nock cannot intercept gRPC. | Call Cloud Run Admin v2 and Secret Manager over **REST with `fetch`**, with tokens from a `TokenProvider` port (google-auth-library). Then msw can test 100% of it, and cold starts are smaller. |

---

## 1. Monorepo layout

### 1.1 Workspace tool: npm workspaces

I recommend npm workspaces over pnpm:

- **Sibling convention.** All four siblings use npm with `npm ci` and an `npm audit --audit-level=low` gate.
- **Functions deploys stay simple.** pnpm's `workspace:` protocol breaks Cloud Build installs.
- **Phantom dependencies are still caught.** pnpm's strictness is replaced by `knip` (unused or missing dependencies, files and exports) and `dependency-cruiser` (layer rules, no cycles).

Configuration:

- root `package.json`: `"workspaces":["packages/*","functions","firebase/rules-tests","e2e"]` and `"engines":{"node":">=24.12"}`
- `.npmrc`: `engine-strict=true`, `save-exact=true`

### 1.2 Tree

```text
/
├─ package.json  package-lock.json  .npmrc  .nvmrc(24)
├─ tsconfig.base.json  tsconfig.json (solution: references only)
├─ vitest.config.ts            # all TS unit/component projects + one coverage report
├─ eslint.config.js  .stylelintrc.json  .prettierrc.json  .htmlvalidate.json
├─ .markdownlint-cli2.jsonc  .yamllint  .taplo.toml  .editorconfig  .gitleaks.toml
├─ knip.json  .dependency-cruiser.cjs  .jscpd.json
├─ sonar-project.properties    # single source of analysis scope; read by the coverage gate
├─ AGENTS.md  CLAUDE.md(@AGENTS.md)  .agent/  .agents/skills/  .claude/{skills,agents,settings.json}
├─ packages/
│  ├─ shared/      src/{schema(zod), manifest, geo, i18n/{ro,en}.ts, transforms}  test/   (node+browser-safe, no DOM)
│  ├─ ui/          src/{theme(M3 tokens, dynamic color), window-class, components/*}  test/   (Lit, browser-only)
│  ├─ engine/      src/{core/(state, url-hash, timeline, controller), map/{map-port.ts, mapbox-adapter.ts}, ui/*, index.ts}
│  │               test/{core, map, ui}  vite.config.ts → dist/engine.{iife.js,mjs,css}
│  ├─ admin/       src/{setup/(state machine + steps), photos/, layers/, georef/, jobs/, settings/, services/(ports), ui/}
│  │               test/  vite.config.ts → dist/admin.*
│  └─ test-support/ src/{fake-map.ts, fake-firebase/, api-handlers/{usgs,mapbox,stac,nominatim,ai}.ts,
│                        fixtures/api/*.json (shared with Python), synth-tiles.ts, emulator.ts, budget.ts}
├─ functions/      src/{index.ts(exports only), triggers/*.ts(thin), handlers/*.ts(pure), ports/*.ts,
│                       adapters/{usgs-m2m, mapbox-api, secret-store-rest, cloud-run-rest, gcs, nominatim}.ts, deps.ts}
│                  test/  build.mjs → deploy/{index.js, package.json(generated, exact pins), package-lock.json}
├─ pipeline/       pyproject.toml poetry.lock Dockerfile(base→test→runtime)
│                  src/hcm_pipeline/{main, m2m, archive, locate, crop, autogcp, warp, export, mts, store, devtools/poller}.py
│                  tests/{unit, integration, synthetic/{world.py, scan.py}}
├─ firebase/       firebase.json .firebaserc firestore.rules firestore.indexes.json storage.rules
│                  rules-tests/ (workspace; @firebase/rules-unit-testing)
├─ sites/bucharest/   index.html  config.js (ES module `export default {...}`, validated by a unit test)
├─ starter-kit/       index.html  config.js  README.md
├─ e2e/            playwright.config.ts  fixtures/  specs/{viewer,admin,starter-kit,pipeline}/  tour/  a11y/
│                  mock-apis/server.ts (node:http over test-support handlers)  env/{.env.demo-hcm, secret.local.e2e}
│                  __screenshots__/ (pixel baselines; budgeted)
├─ docker/         Dockerfile.quality  compose.e2e.yml  (sonarqube.yml optional local server)
├─ scripts/ci/     run-all-checks.sh  in-container.sh  ci_plan.py  check_no_inline_suppressions.py
│                  check_coverage.py  check_rules_coverage.py  check_agent_assets.py  check_skill_mirrors.py
│                  check_e2e_matrix.py  check_i18n.py  check_action_pins.py  check_repo_budget.py
│                  check_bundle_budget.py  check_dependency_updates.py  sonar_setup.py  sonar_report.py
│                  requirements.txt  tests/ (pytest, ≥90% per file like Watch-GPS)
├─ scripts/git-hooks/  pre-commit  pre-push
├─ .github/workflows/  ci.yml codeql.yml deploy.yml release.yml deps.yml contract.yml
└─ docs/  ARCHITECTURE.md TESTING.md CI_PIPELINE.md SETUP.md LESSONS.md ADMIN_GUIDE.{ro,en}.md
```

Layout rules:

- **Tests live in `test/` beside `src/`, not colocated.** This keeps Sonar `sources` and `tests` disjoint (no "indexed twice" errors) and keeps `knip` and `coverage.include` trivial.
- **`test-support` is a workspace package.** Sonar treats it as tests. The same API fixtures JSON feeds the TS msw handlers, the e2e mock server and Python `respx`, so there is one source of truth for API shapes.
- **Python lives in `pipeline/` with Poetry 2.5.1 and `poetry.lock`** (sibling convention). Its venv is created with `--system-site-packages` so `osgeo.gdal` from the GDAL image is visible. CI tooling Python (`scripts/ci`) uses its own pinned `requirements.txt` (Watch-GPS pattern).

### 1.3 TypeScript project references

```jsonc
// tsconfig.base.json (TS 6.0.3)
{ "compilerOptions": {
  "target":"es2023","lib":["es2023","dom","dom.iterable"],"module":"preserve","moduleResolution":"bundler",
  "strict":true,"noUncheckedIndexedAccess":true,"exactOptionalPropertyTypes":true,"noImplicitOverride":true,
  "noPropertyAccessFromIndexSignature":true,"noFallthroughCasesInSwitch":true,"useUnknownInCatchVariables":true,
  "verbatimModuleSyntax":true,"isolatedModules":true,"composite":true,"declaration":true,
  "emitDeclarationOnly":true,"outDir":"${configDir}/.tsbuild","skipLibCheck":false,
  "experimentalDecorators":false, "useDefineForClassFields":true } }
// functions/tsconfig.json overrides: "module":"nodenext","moduleResolution":"nodenext","lib":["es2023"],"types":["node"]
// root tsconfig.json: { "files":[], "references":[{"path":"packages/shared"},{"path":"packages/ui"},
//   {"path":"packages/engine"},{"path":"packages/admin"},{"path":"packages/test-support"},{"path":"functions"},
//   {"path":"firebase/rules-tests"},{"path":"e2e"}] }
```

**Rule: no decorators in Lit code.** Use `static properties` and `customElements.define`. Decorators emit a TS `__decorate` helper whose branches show up as uncovered in v8 coverage. Vite 8's Oxc transform also has unclear support for standard decorators. Enforce this with an eslint `no-restricted-syntax` rule on `Decorator`.

### 1.4 Agent-assets layout (mirrors Watch-GPS and Whisper)

- `CLAUDE.md`: only `@AGENTS.md` plus quick orientation.
- `AGENTS.md`: at most 24,000 bytes. Contents:
  - Commands
  - Boundaries (Always / Ask first / Never)
  - Global Rules:
    - the pre-task review
    - the markdown update rule (every task)
    - the zero-inline-suppression rule
    - pipeline parity
    - push discipline
    - secrets
    - latest-stable dependencies with a `HELD` table
    - **Claude never types credentials, tokens, card data or passwords.** Account creation, billing and token entry are user steps. Claude may drive Chrome for everything else, with consent per action.
- `.agent/instructions.md` and `.agent/skills/SKILLS_CATALOG.md`.
- `.agent/skills/quality/`:
  - `pipeline_skill.md` (the single definition of stages)
  - `ci_quality_gates_skill.md`
  - `testing_strategy_skill.md`
  - `e2e_scenario_matrix_skill.md` (the **only** place that states test counts)
  - `sonarqube_skill.md`
  - `static_analysis_skill.md`
  - `i18n_skill.md`
  - `material_layout_skill.md`
- `.agent/skills/governance/{agent_asset_maintenance_skill.md, doc_update_skill.md}`
- `.agent/workflows/{build,test,deploy,release}.md`
- `.agents/skills/<name>/SKILL.md`, **byte-identical** to `.claude/skills/<name>/SKILL.md`. Skills:
  - `quality-pipeline`
  - `e2e-scenarios`
  - `firebase-emulators-rules`
  - `mapbox-mts-and-testing`
  - `usgs-m2m`
  - `georef-pipeline`
  - `i18n-ro-en`
  - `m3-adaptive-layout`
  - `sonarqube`
  - `release-jsdelivr`
  - `setup-assistant` (what Claude may and may not do)
  - `resolve-pr-comments`
- `.claude/agents/`:
  - `pipeline-runner`
  - `e2e-matrix-auditor`
  - `docs-sync-checker`
  - `golden-reviewer` (screenshot baselines)
  - `rules-auditor` (Firestore and Storage rules)
  - `i18n-reviewer`
- `.claude/settings.json`: an allowlist of the read-only and pipeline commands.

---

## 2. Quality gates per file type

The parallel `static` stage runs cheapest first, as in Whisper's `run_bg`. Every gate is pinned, runs only inside the quality image, and is invoked by `scripts/ci/run-all-checks.sh` both locally and in CI. There are no inline suppressions; a rule is relaxed only in its single repository-wide config, with a comment saying why.

| File type | Gates (all `--max-warnings 0` or the equivalent) | Hard limits |
| --- | --- | --- |
| **TS / TSX / JS** | <ul><li>`tsc -b` (TS 6.0.3)</li><li>eslint 10.12.0 with `--no-inline-config --report-unused-disable-directives`, using typescript-eslint 8.71.1 `strictTypeChecked` and `stylisticTypeChecked`, eslint-plugin-sonarjs 4.2.2, eslint-plugin-lit 2.3.1, eslint-plugin-wc 3.1.0, @vitest/eslint-plugin 1.6.27, eslint-plugin-playwright 2.12.1</li><li>prettier 3.9.10 `--check`</li><li>knip 6.41.0</li><li>dependency-cruiser 18.5.0 (no cycles; `engine/src/{core,ui}` cannot import `mapbox-gl`; only `map/mapbox-adapter.ts` may; `shared` cannot import DOM or Lit; `functions` cannot import browser packages)</li><li>jscpd 5.4.1 (≤ 2%)</li></ul> | <ul><li>`complexity` ≤ **5** (Whisper JS value)</li><li>`sonarjs/cognitive-complexity` ≤ 10</li><li>`max-lines` 400 for src and 600 for tests (skip blank lines and comments)</li><li>`max-lines-per-function` 60, `max-depth` 3, `max-params` 4</li><li>no `any`, no non-null `!`, `switch-exhaustiveness-check`</li><li>`no-console` (use the logger)</li><li>no decorators</li><li>`vitest/no-focused-tests`, `playwright/no-skipped-test`</li></ul> |
| **CSS** (files and Lit `css\`\``) | stylelint 17.16.0 with stylelint-config-standard 40.0.0, plus `postcss-lit` 1.4.1 as the custom syntax for TS. Flags: `--report-needless-disables --report-invalid-scope-disables --report-descriptionless-disables` (Whisper flags). | `declaration-property-value-no-unknown`, `no-descending-specificity`, colours only from M3 tokens (`color-no-hex` outside `ui/src/theme/`) |
| **HTML** (`sites/`, `starter-kit/`, admin `index.html`) | html-validate 11.16.2 and htmlhint (as in the siblings) | no inline `<script>` (CSP); SRI on the CDN `mapbox-gl.js`; `lang` attribute present |
| **Python** (`pipeline/`, `scripts/ci/`) | <ul><li>ruff 0.17.0 (check and format; `E,F,W,I,B,UP,SIM,PL,PT,RUF,S,N,C90`)</li><li>mypy 2.4.0 `--strict`</li><li>pylint 4.1.3, with `.pylintrc-tests` for tests (Whisper pattern)</li><li>radon 6.0.1 rank **A** (≤ 5) via xenon 0.9.3 `--max-absolute A`</li><li>bandit 1.9.4</li><li>pip-audit 2.10.1</li><li>vulture 2.16</li></ul> | `max-module-lines=600` (Whisper value), `max-args=5` |
| **Markdown** | markdownlint-cli2 0.24.0 (sibling config), `check_agent_assets.py` (paths exist, AGENTS.md ≤ 24,000 bytes, every AGENTS chain ≤ 32,768 bytes, skills ≤ 500 lines), `check_skill_mirrors.py` | — |
| **YAML** | yamllint (sibling config), actionlint 1.7.12, **zizmor 1.30.1** (Actions security), `check-jsonschema --builtin-schema vendor.github-workflows`, `check_action_pins.py` (every `uses:` is a 40-hex SHA with a `# vX.Y.Z` comment) | — |
| **JSON** | check-jsonschema: `firebase.json` against the firebase-tools schema, `firestore.indexes.json`, and our `manifest.schema.json`, which is generated from zod 4.6.6 (`z.toJSONSchema`). A sync gate fails if the generated schema is stale. | — |
| **TOML** | taplo fmt `--check` and taplo lint | — |
| **Shell** | shellcheck 0.11.0 (no `-e` excludes), shfmt 3.13.1 `-d` | — |
| **Dockerfile** | hadolint 2.15.1 `--failure-threshold warning --disable-ignore-pragma` | base images pinned by digest |
| **Firestore and Storage rules** | rules tests (§3.4) and `check_rules_coverage.py` | every `allow` expression evaluated both true and false |
| **Repository** | <ul><li>gitleaks 8.30.1: dir scan locally, commit range in CI (Watch-GPS `GITLEAKS_LOG_OPTS`)</li><li>`check_no_inline_suppressions.py`</li><li>`check_repo_budget.py`</li><li>`check_bundle_budget.py` (gzip size of engine iife ≤ N KB and admin ≤ M KB)</li><li>`check_i18n.py`</li><li>`check_e2e_matrix.py`</li><li>`npm audit --audit-level=low`</li></ul> | — |

**Inline-suppression scanner.** Port Watch-GPS's `check_no_inline_suppressions.py` (fence-aware for Markdown) and add the TS-ecosystem patterns:

```python
TS_JS = [r"eslint-disable", r"@ts-(ignore|expect-error|nocheck)", r"/\*\s*(v8|c8|istanbul)\s+ignore",
         r"//\s*NOSONAR|/\*\s*NOSONAR", r"prettier-ignore", r"stylelint-disable", r"lit-analyzer-disable",
         r"\b(it|test|describe)\.(only|skip|todo|fails)\b", r"\b(xit|xdescribe|fit|fdescribe)\b",
         r"test\.fixme\b", r"knip-ignore", r"dependency-cruiser-ignore", r"jscpd:ignore"]
PY += [r"#\s*pragma[:\s]?\s*no\s*(cover|branch)", r"@pytest\.mark\.(skip|xfail)", r"pytest\.skip\(",
       r"#\s*(noqa|nosec|type:\s*ignore|pylint:|ruff:|mypy:)", r"#\s*xenon:"]
OTHER = [r"#\s*shellcheck\s+disable", r"#\s*hadolint\s+ignore", r"#\s*yamllint\s+disable", r"#\s*zizmor:\s*ignore",
         r"gitleaks:allow", r"<!--\s*markdownlint-(disable|enable)", r"html-validate-disable"]
```

Config-level bans as well:

- `.coveragerc` / `pyproject` contain no `exclude_lines` and no `omit`.
- Vitest `coverage.exclude` may list only test, fixture and `.d.ts` paths.
- `sonar.coverage.exclusions` stays empty. The scanner checks these lists.

**Per-file coverage gate (`scripts/ci/check_coverage.py`).** Port Fork-Linux's script, which reads `sonar.sources`, `sonar.exclusions`, `sonar.coverage.exclusions` and the report paths from `sonar-project.properties`, scores the way Sonar does, and fails on missing or stale files. Add an **LCOV reader** for `sonar.javascript.lcov.reportPaths`:

```python
def read_lcov(path: Path, root: Path) -> Coverage:
    report: Coverage = {}; cov = None
    for raw in path.read_text(encoding="utf-8").splitlines():
        tag, _, val = raw.partition(":")
        if tag == "SF":   cov = report.setdefault(_report_key(root / val if not Path(val).is_absolute() else Path(val), root), FileCoverage())
        elif tag == "DA": n, hits = val.split(",")[:2]; cov.add(int(n), int(hits) > 0)
        elif tag == "BRDA":
            n, _blk, _br, taken = val.split(","); e = cov.lines.setdefault(int(n), [0, 0, 0])
            e[1] += 1; e[2] += int(taken not in ("-", "0"))
    return report
```

- Floors: combined ≥ 90, **line ≥ 90 and branch ≥ 90 for every language** (`--min-line 90 --min-branch 90`). Fork-Linux has Python-only flags; generalise them.
- Vitest also enforces `perFile` 90/90/90/90 inside its own run, so failures appear early.

---

## 3. Test architecture (how every file reaches ≥ 90% per file)

### 3.1 Network isolation (applies to every tier)

- **Node:** msw 3.0.3 `setupServer(...handlers)` with `onUnhandledRequest:'error'`.
- **Python:** `pytest-socket` 0.8.1 with `--disable-socket --allow-unix-socket --allow-hosts=127.0.0.1,localhost,mock-apis,emulators`.
- **Chromium (vitest browser and Playwright):** launch args include `--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost` as defence in depth. Playwright also has a route firewall (§4.2).
- **Test credentials encode the scenario**, so server-side code can select mock behaviour without per-test headers:
  - USGS token `e2e-ok`, `e2e-m2m-pending`, `e2e-bad`
  - Mapbox `sk.e2e-trial`, `sk.e2e-missing-scopes`
  
  These are not JWT-shaped, so gitleaks' Mapbox rule does not fire. Our validator checks only the `sk.`/`pk.` prefix; the (mock) API decides validity. These are generated test values, never real ones.

### 3.2 Engine: Mapbox-GL-dependent code (thin adapter + fake map)

```ts
// packages/engine/src/map/map-port.ts — the ONLY surface the engine core sees
export interface MapPort {
  whenReady(): Promise<void>;
  setCamera(c: Camera, o?: { animate: boolean }): void; getCamera(): Camera;
  addRasterLayer(l: RasterLayerSpec): void;            // slot:'middle', source mapbox|xyz|pmtiles
  removeLayer(id: string): void; setOpacity(id: string, v: number): void; setVisible(id: string, v: boolean): void;
  setPhotos(fc: PhotoFeatureCollection): void; setPhotoFilter(f: PhotoFilter): void;
  setStandardConfig(key: 'show3dObjects' | 'lightPreset', v: unknown): void;
  on<E extends keyof MapEvents>(e: E, cb: (p: MapEvents[E]) => void): () => void;  // moveend, photoclick, error, contextlost
  destroy(): void;
}
// mapbox-adapter.ts: createMapboxAdapter(gl: typeof mapboxgl, el: HTMLElement, o: AdapterOpts): MapPort
// test-support/src/fake-map.ts: class FakeMap implements MapPort { calls: Call[]; emit(e, p); state(): Snapshot }
```

| Code | Test environment | How it is covered |
| --- | --- | --- |
| `engine/src/core/**` (controller, timeline, URL-hash codec, compare state, filters, manifest → layer specs) | vitest **node** | Driven against `FakeMap`, asserting `fakeMap.calls`. Table-driven tests over every manifest/source type and hash shape. Fast; this is about 70% of engine logic. |
| `engine/src/map/mapbox-adapter.ts` | vitest **browser** (Chromium + SwiftShader) with the **real `mapbox-gl@3.32.0`** from node_modules (dev dependency, pinned exactly to the CDN version) | <ul><li>Before tests: `mapboxgl.config.EVENTS_URL = null; mapboxgl.config.REQUIRE_ACCESS_TOKEN = false`; Map options `testMode:true, performanceMetricsCollection:false`.</li><li>Style: a **local minimal style JSON** that defines Standard-like slot layers (`{id:'middle',type:'slot'}`) so `slot:'middle'` is exercised.</li><li>Raster tiles: solid-colour synthetic tiles served from Vitest `publicDir`.</li><li>Assertions: `map.getLayer`, `getPaintProperty('raster-opacity')` and `getSlot`, plus a canvas pixel probe at a fixed point (one solid colour per layer gives deterministic checks).</li><li>Context loss: simulate with `WEBGL_lose_context`.</li><li>Unsupported: `mapboxgl.supported()` returning false is stubbed.</li></ul> |
| `engine/src/ui/**` (Lit) | vitest **browser** | See §3.3. |

### 3.3 Lit and M3 components: Vitest browser mode, not happy-dom

- M3 web components depend on `ElementInternals` ARIA reflection, form association, `adoptedStyleSheets`, `:state()`, ResizeObserver and real focus and accessibility trees. happy-dom 20.14.6 gives false passes and false failures on these.
- Browser-mode coverage (v8, Chromium provider) merges into the same LCOV.
- Pattern: `render(html\`<hcm-timeline .years=${...}>\`, host)` and the `vitest/browser` `page.getByRole(...)` locators.
- Each test checks: keyboard behaviour, ARIA names, RO and EN strings, window-class variants (resize the iframe viewport through `page.viewport(w,h)`), and reduced motion (`matchMedia` stub).
- Theme: `ui/src/theme/dynamic-color.ts` (built on `@material/material-color-utilities@0.4.0`) is pure. Test it in node with WCAG contrast assertions for every seed in a fixture set, in light and dark.

### 3.4 Firebase Functions (no firebase-functions-test; see F2)

```ts
// handlers/usgs-scene-search.ts — pure, all I/O through ports
export async function sceneSearch(d: Deps, req: AuthedRequest<SceneSearchIn>): Promise<SceneSearchOut> {...}
// triggers/usgs.ts — thin
export const usgsSceneSearch = onCall({ region: 'europe-west1', enforceAppCheck: false },
  (r) => sceneSearch(getDeps(), requireAdmin(r)));
// test: vi.mock deps.ts → fakes;  await usgsSceneSearch.run({ auth:{uid,token:{admin:true}}, data:{...} } as CallableRequest)
```

- **Ports:**
  - `SecretStore` (REST Secret Manager: `:addVersion`, `versions/latest:access`; read dynamically with a TTL cache, **not** `defineSecret`, so a token the admin pastes works without a redeploy)
  - `JobRunner` (REST Cloud Run Admin v2 `jobs/{job}:run` with `overrides.containerOverrides[].env`)
  - `UsgsM2M`, `MapboxApi`, `BlobStore`, `Clock`, `TokenProvider`, `Geocoder`
- **Adapters** are tested with **msw** against the shared fixtures, covering faithful failure shapes:
  - M2M: HTTP 500 with JSON `errorCode`, HTML 403 for bad auth, 503 HTML maintenance
  - Mapbox: 401, 422 recipe errors, trial/demo detection
- **`deps.ts` (composition root)** chooses adapters by environment:
  - `FUNCTIONS_EMULATOR==='true'` selects an in-memory `SecretStore` and the `queue-only` `JobRunner`
  
  Both branches are unit-tested with `vi.stubEnv`.
- **Emulator integration** (`firebase emulators:exec --project demo-hcm --only auth,firestore,storage,functions`) covers: real triggers (`photos.onUpload` with sharp 0.35.5, `publish.onWrite` producing the manifest), the claim flow, and index and rule interaction.
- **Emulator configuration:**
  - Secrets come from `.secret.local`, which the harness copies from `e2e/env/secret.local.e2e`. The real `.secret.local` is gitignored and refused by pre-commit.
  - Base URLs come from `.env.demo-hcm` (`USGS_M2M_BASE_URL`, `MAPBOX_API_BASE_URL`, `STAC_URL`, `NOMINATIM_URL` point at `mock-apis`).
  - The `demo-` project prefix guarantees that no real cloud resource is touched.
- **Scheduled `usgs.watchOrders`.** Its body is `runWatchOrders(deps)`, also exposed as the admin callable **"Check now"**. That is a real UX feature (minimum admin wait), and it is also the e2e seam. The `onSchedule` wrapper is covered through `.run()`.
- **Deploy artifact:**
  - `functions/build.mjs` (Vite/Rolldown SSR build) bundles `@hcm/shared` and keeps npm dependencies external.
  - It generates `deploy/package.json` (exact pins copied from the root lock) and `deploy/package-lock.json` (`npm install --package-lock-only --ignore-scripts`).
  - A gate checks for no `workspace:` or `file:` dependencies.
  - **e2e runs the emulator on `deploy/`**, which is the same artifact production uses.

### 3.5 Firestore and Storage rules

- `firebase/rules-tests` (vitest node project `rules`), run under `emulators:exec --only firestore,storage`, using `@firebase/rules-unit-testing@6`.
- Each `match` gets allow and deny tests for: anonymous, signed-in non-admin, admin via claim, admin via `admins/{uid}` document (if kept), and stale claim.
- Each test also covers field validation, boundary values, `request.resource.size` and `contentType` limits, and "rules are not filters" queries.
- Storage paths:
  - `public/**`: public read, no client write
  - `photos/{city}/{id}/original`: admin write, `image/(jpeg|png|webp)`, size ≤ limit
  - derived and raster paths: function-only writes
- **`check_rules_coverage.py`:** after the run, fetch the emulator's rules-coverage report (`/emulator/v1/projects/demo-hcm:ruleCoverage.html`; confirm the JSON form during implementation). Fail unless every `allow` expression was evaluated **both** true and false.

### 3.6 Python pipeline (pytest 9.1.1, pytest-cov 7.1.0, coverage 7.16.2 with `branch = true`, hypothesis 6.169.0, respx 0.23.1 + httpx 0.28.1)

Tests run inside `pipeline/Dockerfile` target `test`, FROM `ghcr.io/osgeo/gdal:ubuntu-small-3.13.3@sha256:<digest>`, so they use the real GDAL.

**Synthetic georeferencing harness** (`tests/synthetic/`):

1. **Reference world** (`world.py`, seeded):
   - a 2048² EPSG:3857 GeoTIFF COG at about 10 m/px near 44.43N 26.10E
   - procedural road grid with varied widths, sinuous river, park blobs, seeded noise texture
   - exported as a **COG served by mock-apis with HTTP Range 206** (GDAL `/vsicurl/`) behind a mock Earth Search STAC item
2. **Ground-truth transform `T_true`**:
   - projective, plus a quadratic panoramic term, plus optional 180° rotation (aft camera), mirror, 5× upsample with blur, film grain and contrast shift
   - an **"urban change" patch** repainting 15% of the area, which must yield rejected outliers
3. **Scan** by inverse warp:
   - `cv2.remap(ref, map_x, map_y)` where `(map_x, map_y) = T_true⁻¹(u, v)`
   - split into `_a.._d` segments with 300 px overlap
   - packed into a `.tgz` like USGS delivers
   - metadata corners deliberately offset 3 km
4. **Run** `main(job_id)` with M2M mocked by respx (or by the mock server in compose), Firestore and Storage as fakes in unit tests and emulators in integration tests, and the MTS API mocked.
5. **Assertions:**
   - stitch offsets ±1 px
   - rotation and mirror detected
   - checkpoint RMSE on **held-out ground-truth points** below 1.5 × reference GSD (coarse) and ≤ 1 scan px after the fine pass
   - no accepted GCP inside the changed patch with residual above threshold
   - zoom range chosen per camera
   - 8-bit COG valid (`gdalinfo -json`: overviews, EPSG:3857, uint8)
   - MTS recipe shape matches the fixture
6. **Property tests** (hypothesis with a `ci` profile: `derandomize=True`, `max_examples=25`): random rotation ±5°, scale 0.8–1.2 and shear must recover within tolerance.
7. **Failure paths:**
   - blank scan → `NoMatchesError`
   - no STAC coverage → `ReferenceUnavailable`
   - corrupt tgz → `CorruptArchive`
   - signed URL 403 → retry then `DownloadExpired`
   - 503 maintenance → backoff
   - SIGTERM mid-run → status `cancelled` and temp files removed (subprocess test)
   - memory guard → chunked path

Determinism: `GDAL_NUM_THREADS=1`, `cv2.setNumThreads(1)`, `cv2.setRNGSeed(0)`, seeded RANSAC. Scan sizes stay around 4000×1500, so the whole suite runs in minutes, and every coverage-bearing test runs in CI (no `slow` exclusion of covered code).

`devtools/poller.py` (the compose worker that polls emulator jobs that are `queued`) is source code, so it is also covered at ≥ 90%.

### 3.7 What is genuinely hard to cover, and the mitigation

| Hard area | Mitigation |
| --- | --- |
| Real Mapbox rendering and Standard-style visuals | Visual e2e with a minimal local style. One **post-deploy smoke** against production (read-only, one map load). |
| `signInWithPopup` against real Google | Only the Auth emulator popup in e2e. Unit tests use an `AuthPort` fake. Production behaviour is verified manually once (it is the user's account). |
| IAM: Cloud Run invoke, Secret Manager accessor, WIF | Not unit-testable. Checked by a post-deploy smoke callable `setup.selfTest` (re-runnable from the Setup Assistant), which reports green or red per permission. |
| USGS real downloads (GB scale) and georeferencing quality on real film | Opt-in local `real-data` stage, like Whisper's `real-audio`: one known free Corona frame over Bucharest, RMSE reported. Never in CI, because the public repo's Actions logs would leak signed URLs. |
| Third-party link rot (Mapbox, USGS ERS and Cloud Console deep links in the Setup Assistant) | Weekly `contract.yml`: HEAD on every deep link, plus API-shape drift checks against unauthenticated endpoints (M2M `login` returns `NOT_FOUND`; `login-token {}` returns 500 `INPUT_PARAMETER_REQUIRED`; no CORS header for github.io; Mapbox CDN 200; Earth Search collection exists). It opens an issue on drift and needs no secrets. |
| HEIC photos from phones (Chromium cannot decode HEIC; sharp prebuilds lack HEVC) | Explicit failure scenario with an actionable message. Any conversion path has its own tests. |
| Rules expressions | Covered by the rules-coverage gate (§3.5). Sonar does not measure them. |

---

## 4. End-to-end design ("all scenarios")

### 4.1 Topology

`docker/compose.e2e.yml` runs these services. Locally, Playwright `webServer` starts the same commands.

- **`mock-apis`**: one `node:http` server over the `test-support` handlers.
  - USGS M2M: `login-token`, `scene-search`, `download-options`, `download-request`, `download-retrieve`, `logout`, `dataset-search`, approval toggles
  - Mapbox: `tokens/v2` (create, list, scopes, trial), `tilesets/v1` sources, recipe validate, publish, jobs, `v4` TileJSON and tiles, styles, fonts, sprites, `events` (204, counted)
  - Earth Search STAC search and COG with Range
  - Nominatim reverse
  - Firebase AI Logic endpoint (translation drafts)
  - USGS browse JPEGs
  - `GET /__calls` for assertions
- **`emulators`**: firebase-tools 15.33.0 on Java 21, Node 24, `--project demo-hcm --only auth,firestore,storage,functions,hosting`.
  - Hosting serves the **built admin `dist`** with `firebase.json` headers, so the CSP is exercised.
  - Functions run from `functions/deploy/`.
- **`site`**: a static server for `sites/bucharest` and the starter kit, mimicking Pages (`cache-control: max-age=600`, `ACAO *`).
- **`pipeline-worker`**: the `pipeline:test` image running `python -m hcm_pipeline.devtools.poller` against the emulators. Used only in the `e2e-pipeline` tier. UI tiers instead drive job states from the test via the Admin SDK.

**Isolation.** Each test namespaces data by city id `e2e-w{workerIndex}-{testId}` and by unique Auth users, so workers run in parallel against one emulator without global resets. Seeding goes through the Admin SDK pointed at the emulators (`test-support/src/emulator.ts`).

**Auth:**

- Global setup signs in once per role (owner, invited admin, stranger) through the emulator popup widget. It saves `storageState({indexedDB:true})` because Firebase Auth persists in IndexedDB.
- Two specs exercise the real popup flow.
- `OWNER_EMAIL` comes from a function param (`.env.demo-hcm` = `owner@example.test`). The real email is never in tests.

### 4.2 Map in headless Chromium, and keeping Mapbox off the network

- Launch args: `['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist', HOST_RULES]`. A smoke spec asserts `!!document.createElement('canvas').getContext('webgl2')`.
- **The production HTML is untouched.** `context.route` intercepts:
  - `https://api.mapbox.com/mapbox-gl-js/v3.32.0/mapbox-gl.{js,css}` → fulfil from `node_modules/mapbox-gl/dist/` (byte-identical version; SRI hash checked)
  - `https://cdn.jsdelivr.net/gh/ventura8/...@1/...` → local `packages/engine/dist/`
  - `api.mapbox.com/**` (v4, styles, fonts) → `mock-apis`
  - `events.mapbox.com/**` → 204, counted
  - `firebasestorage.googleapis.com` / `storage.googleapis.com` → Storage emulator
- **Firewall fixture.** `context.route('**/*')` aborts every host outside an allowlist (`127.0.0.1`, `localhost` and the mocked hosts above) and records it. `afterEach` fails the test if anything was blocked. This proves "no real Mapbox or Google network", and that **the viewer never calls `firestore.googleapis.com`**.
- **Map-instance counter** (cost guard, no production hook). An init script traps assignment of `window.mapboxgl` with `Object.defineProperty` and wraps `Map` to count instances. Assertions: exactly one map load per page view, and swipe-compare creates a second map **lazily** and destroys it.
- **E2E city basemap** is a local minimal style with slot layers. Raster layers use `mapbox://ventura86.e2e-1966` (TileJSON and tiles from the mock: solid colour per layer plus a z/x/y label, generated with sharp at runtime, so no committed binaries) and an `xyz` source, which covers both source types.
- **Map assertions use pixel probes** (`page.screenshot({clip})` at known coordinates gives a known colour). Examples: layer on/off, opacity 0 versus 1, compare left versus right.

### 4.3 Playwright projects (M3 window classes)

```ts
// e2e/playwright.config.ts (Playwright 1.64.0)
const GL = ['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist',
  '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost'];
const V = {                       // M3: compact<600 ≤ medium<840 ≤ expanded<1200 ≤ large<1600 ≤ extra-large
  'c320':  { viewport:{width:320,height:568},  isMobile:true, hasTouch:true, deviceScaleFactor:2 },
  'c360':  { viewport:{width:360,height:800},  isMobile:true, hasTouch:true, deviceScaleFactor:2 },
  'c412':  { viewport:{width:412,height:915},  isMobile:true, hasTouch:true, deviceScaleFactor:2 },
  'c915l': { viewport:{width:915,height:412},  isMobile:true, hasTouch:true, deviceScaleFactor:2 }, // compact height
  'm768':  { viewport:{width:768,height:1024}, hasTouch:true },
  'e1024': { viewport:{width:1024,height:768}, hasTouch:true },
  'l1280': { viewport:{width:1280,height:800} }, 'l1440': { viewport:{width:1440,height:900} },
  'x1920': { viewport:{width:1920,height:1080} }, 'x2560': { viewport:{width:2560,height:1440} },
  'x3840': { viewport:{width:3840,height:2160} } } as const;
const THEMES = ['light','dark'] as const, LANGS = ['ro','en'] as const;
const chromium = (v: keyof typeof V) => ({ browserName:'chromium' as const, ...V[v], launchOptions:{ args: GL } });
export default defineConfig({
  testDir: '.', forbidOnly: true, failOnFlakyTests: !!process.env.CI, retries: process.env.CI ? 1 : 0,
  fullyParallel: true, reporter: [['list'],['html',{open:'never'}],['junit',{outputFile:'../reports/junit/e2e.xml'}]],
  expect: { toHaveScreenshot: { animations:'disabled', caret:'hide', scale:'css', maxDiffPixelRatio:0.002,
            stylePath:'./support/screenshot.css' } },   // hides map canvas + timestamps in chrome-only shots
  use: { trace:'retain-on-failure', video:'retain-on-failure', timezoneId:'Europe/Bucharest' },
  projects: [
    { name:'setup', testMatch:/global\.setup\.ts/ },
    // Tier F — functional scenario matrix (§4.5): 3 classes × RO, plus EN and dark variants
    ...(['c360','m768','l1440'] as const).map(v => ({ name:`fn-${v}-ro`, testMatch:/specs\/.*\.spec\.ts/,
        dependencies:['setup'], use:{ ...chromium(v), locale:'ro-RO', colorScheme:'light' } })),
    { name:'fn-l1440-en', testMatch:/specs\/.*\.spec\.ts/, dependencies:['setup'], use:{ ...chromium('l1440'), locale:'en-US' } },
    { name:'fn-c360-dark', testMatch:/specs\/.*\.spec\.ts/, dependencies:['setup'], use:{ ...chromium('c360'), colorScheme:'dark', locale:'ro-RO' } },
    // Tier T — layout/a11y tour: every screen×state on 11 viewports × 2 themes × 2 langs = 44 projects
    ...Object.keys(V).flatMap(v => THEMES.flatMap(t => LANGS.map(l => ({ name:`tour-${v}-${t}-${l}`,
        testMatch:/tour\/.*\.tour\.ts/, dependencies:['setup'],
        use:{ ...chromium(v as keyof typeof V), colorScheme:t, locale: l==='ro'?'ro-RO':'en-US' } })))),
    // Tier A — a11y specials
    { name:'a11y-reduced-motion', testMatch:/a11y\/.*/, use:{ ...chromium('l1440'), reducedMotion:'reduce' } },
    { name:'a11y-forced-colors',  testMatch:/a11y\/.*/, use:{ ...chromium('l1440'), forcedColors:'active' } },
    { name:'nogl', testMatch:/specs\/viewer\/no-webgl\.spec\.ts/, use:{ browserName:'chromium', launchOptions:{ args:['--disable-3d-apis'] } } },
    // Tier X — cross-browser, UI-only specs (no WebGL dependency; selected by file, never by skip)
    { name:'ff-admin', testMatch:/specs\/admin\/(setup|settings|photos-form)\.spec\.ts/, use:{ browserName:'firefox', ...V.l1440 } },
    { name:'wk-admin', testMatch:/specs\/admin\/(setup|settings|photos-form)\.spec\.ts/, use:{ browserName:'webkit', ...V.l1440 } },
    { name:'pipeline', testMatch:/specs\/pipeline\/.*/, use:{ ...chromium('l1440') } },   // compose stage only
  ],
});
```

What each tier checks:

- **Tour tier** (`tour/*.tour.ts`) visits every screen and state and runs:
  - `@axe-core/playwright@4.13.0` with `wcag2a, wcag2aa, wcag21aa, wcag22aa`. Contrast is checked per theme, which catches bad dynamic-colour seeds.
  - Layout invariants: `scrollWidth ≤ innerWidth` (no horizontal overflow), pairwise bounding-box **overlap** of `[data-layout-check]` elements, text not clipped (`scrollWidth ≤ clientWidth` on labels), touch targets ≥ 48×48 CSS px on compact, visible focus ring on tab, and the window-class navigation pattern (navigation bar, rail or drawer).
  - `toMatchAriaSnapshot` for structural regression on every project.
  - **i18n leak check**: in RO mode, no EN-only catalogue string appears in the DOM, and no raw message ids appear.
- **Visual (pixel) baselines** are a deliberate subset to stay within the repo budget: `c360, m768, l1440, x1920` × light and dark × RO × about 8 key screens, roughly 64 PNGs, ≤ 15 MB, enforced by `check_repo_budget.py`.
  - The other projects rely on ARIA snapshots plus invariants.
  - Baselines are generated **only** in the quality image: pinned fonts, with Roboto Flex and a **subsetted** Material Symbols font served locally (also better for production privacy than Google Fonts).
  - Updates go through `UPDATE_SNAPSHOTS=1` and the `golden-reviewer` subagent.
- **Admin-input budget fixture** (`test-support/src/budget.ts`) counts `fill`, `click` and `setInputFiles` actions per flow and asserts a declared maximum. This turns "MINIMUM ADMIN INPUT" into a regression gate. Examples: Mapbox setup ≤ 2 inputs (paste, save); import a free scene ≤ 2 clicks; publish photos ≤ 1.
- **Clock:** `page.clock.install()` with `fastForward` for M2M-approval polling, debounce and token refresh.
- **Coverage:** E2E is **not** counted toward the per-file gate. Unit and browser-mode tests carry every file, which keeps the gate deterministic.

### 4.4 Sharding

In CI, `fn-*` runs as 4 shards, `tour-*` as 6 shards, and a11y, nogl and cross-browser as 1. Repository Actions minutes are free (public repo). Locally, `PIPELINE_STAGE=e2e E2E_TIER=fn|tour|a11y|x|all`.

### 4.5 E2E scenario matrix (each behaviour has at least one happy and one bad row; `check_e2e_matrix.py` cross-checks rows against test titles in both directions)

#### Viewer (V)

| ID | Behaviour | Happy | Bad |
| --- | --- | --- | --- |
| V01 | Boot | manifest → map, timeline, photo markers | manifest 404 → localized error and Retry; zod-invalid manifest → error card; slow Storage → skeleton, then timeout message |
| V02 | WebGL | WebGL2 → map | `--disable-3d-apis` → fallback card; photo list still usable |
| V03 | Layer toggle | on/off (pixel probe) plus attribution | tile 404 → layer error chip; map survives |
| V04 | Timeline | year selection shows the layer; photo year filter in sync | year without a layer → stop disabled or snaps to nearest |
| V05 | Opacity | 0 versus 1 pixel probe; slider ARIA value | out-of-range hash value is clamped |
| V06 | Swipe compare | lazy second map (count 2); slider reveals left versus right | compact width → compare unavailable (toggle instead); exit → map destroyed (count 1) |
| V07 | Photos on map | clusters expand on zoom; click → bottom sheet (compact) or side sheet (expanded and up); view cones at high zoom | image 404 → placeholder and alt text |
| V08 | Lightbox | open, pinch-zoom (touch), arrow keys, Esc returns focus | broken full image → error state, close still works |
| V09 | Deep links and share | `#photo=`, `#layers=&view=` restore state; Share copies the URL (clipboard permission) | unknown photo id → toast; malformed hash → defaults |
| V10 | Geolocate | granted, in bounds → camera moves | denied → message; out of city bounds → message |
| V11 | Language | RO by default; switch to EN persists after reload; `<html lang>`; localized dates | `?lang=fr` → RO; missing key → RO fallback (also blocked at build time) |
| V12 | Theme | system dark; manual toggle persists; seed colour applied (axe contrast) | invalid seed → default palette |
| V13 | About / credits | rendered from manifest, RO and EN | empty credits → section hidden |
| V14 | Keyboard and screen reader | skip link → timeline → layers → photos; focus visible | forced-colors readable; reduced motion → no fly animation |
| V15 | Responsive | no overflow or overlap at all 11 viewports; touch targets ≥ 48 | compact landscape → controls collapse into a menu |
| V16 | Privacy and cost | only allowlisted hosts; 0 Firestore calls; 1 map load | tile host down → non-blocking toast |
| V17 | Starter kit (no Firebase) | static manifest renders | missing or invalid `config.js` → instructive error for the city owner |
| V18 | Legal | Mapbox logo and attribution visible at every viewport | compact collapsed attribution still reachable |

#### Admin (A)

| ID | Behaviour | Happy | Bad |
| --- | --- | --- | --- |
| A01 | Sign-in and owner claim | owner first sign-in → claim → dashboard | stranger → "not an admin" and sign out; popup closed → Retry; claim delay → automatic token refresh |
| A02 | Admin invitations | invite → invitee signs in → admin | invalid email; revoke; owner cannot be revoked; last-admin protection |
| A03 | Setup Assistant shell | every step with status; resume; Re-check | partial state → opens at the first incomplete step |
| A04 | Blaze / billing detection | billing enabled → green | not enabled → deep link and cost explainer; API permission error → actionable message |
| A05 | Mapbox account and plan | card on file → green | trial/demo → payment step; missing billing address → message |
| A06 | Mapbox secret token | valid `sk` → saved (masked) → public token **auto-minted** with URL restrictions → green; input budget ≤ 2 | missing scopes → lists them plus a pre-filled link; `pk` pasted → explanation; revoked (401); Mapbox 5xx → retry |
| A07 | USGS ERS and M2M | token valid and role approved → green | HTML 403 → bad token; role pending → "24–48 h" with auto-poll (clock), flips green when the mock approves; 503 maintenance banner |
| A08 | Photo upload | multi-file drop; EXIF prefills location, date and bearing; thumbnails appear (`onUpload`) | no EXIF → manual placement; duplicate sha256 flagged; HEIC or PDF → error; over size → rules reject with a message |
| A09 | Photo edit | drag marker and bearing handle, FOV slider; title suggestion (Nominatim); translation draft (AI) | Nominatim 429 → manual entry; AI unavailable → no draft, never auto-published |
| A10 | Photo publish | bulk publish → manifest rebuilt → **viewer shows the photo** (cross-app) | unpublish → hidden; missing EN title → blocked |
| A11 | Imagery search | ranked scenes, footprints, browse previews (Storage copies) | zero results → guidance; M2M error → actionable; USGS not set up → link to setup |
| A12 | Import free scene | queued → steps → draft with RMSE report → approve → viewer shows the layer | fails at autogcp → error and "Open georeferencer"; cancel; retry succeeds |
| A13 | Buy scan | $30 + $5 estimate, EarthExplorer deep link, guide; "I ordered it"; "Check now" → available → auto-import and notification | never delivered → reminder state; marking an available scene as ordered is prevented |
| A14 | Upload GeoTIFF | georeferenced → publish path | not georeferenced → georeferencer; non-TIFF → error; resumable upload of a large file |
| A15 | Link tileset / XYZ | valid → preview → save | 404 or invalid URL; another account's private `mapbox://` → error |
| A16 | Georeferencer | GCPs coloured by confidence; drag updates residuals; toggle a GCP; switch transform; overlay preview; save → regeoref job | too few GCPs → transform disabled; RMSE over threshold → warning |
| A17 | Auto-publish policy | RMSE < X → published automatically | RMSE > X → stays draft |
| A18 | Jobs | live progress and logs; retry and cancel | stream drop → reconnect |
| A19 | City settings | draw bounds, About RO/EN, credits, seed colour with live M3 preview, basemap → publish → viewer reflects it | zero-area bounds; low-contrast seed → auto-adjust warning |
| A20 | Session security | silent token refresh | admin removed mid-session → next action denied; deep link while signed out → sign-in |
| A21 | Admin i18n | every screen in RO and EN; switching language keeps form state | leak check (tour) |

#### Pipeline (P), compose stage

| ID | Happy | Bad |
| --- | --- | --- |
| P01 | queued job → worker (synthetic tgz from mock M2M) → MTS mock → draft layer within tolerance | corrupt archive; no reference coverage; MTS job failure → retry; SIGTERM → `cancelled` with cleanup |
| P02 | regeoref with manual GCPs → new version | degenerate GCP set → error |

**Security (S).** The rules suite (§3.5) and the V16 and A20 cross-checks.

**Ops (O).** Post-deploy smoke (production, read-only), weekly contract checks, and the `setup.selfTest` callable.

---

## 5. CI, Docker, Sonar, secrets, hooks

### 5.1 One entry point: `scripts/ci/run-all-checks.sh` (Docker-only gates)

- The host wrapper builds `docker/Dockerfile.quality` and the `pipeline/Dockerfile` target `test`. It runs `scripts/ci/in-container.sh` with **the repo mounted at its host path** (`-v "$PWD:$PWD" -w "$PWD"`, the Fork-Linux pattern). This removes Whisper's `<source>/app` coverage-path bug class for both LCOV and Cobertura.
- A passing stage writes `reports/pipeline/green-<stage>.json` (HEAD plus a porcelain SHA-256), per Watch-GPS.
- Stages:

| Stage | Contents |
| --- | --- |
| `static` | all §2 gates except tests |
| `unit-ts` | `vitest run --coverage` (node + browser projects) → `reports/coverage/ts/lcov.info` |
| `unit-py` | pytest in `pipeline:test` → `reports/coverage/pipeline.xml`, `reports/junit/pipeline.xml` |
| `scripts` | pytest for `scripts/ci` → `reports/coverage/scripts.xml` |
| `emulators` | rules tests, rules-coverage gate, functions emulator integration |
| `build` | Vite builds, `functions/deploy`, bundle budget, dist reproducibility on release commits, starter-kit html-validate |
| `coverage` | `check_coverage.py` over every report (per file ≥ 90 line and branch) |
| `e2e` | `E2E_TIER`, `E2E_SHARD` |
| `e2e-pipeline` | compose |
| `sonar` | Docker `sonarsource/sonar-scanner-cli@sha256:…` + `sonar_report.py` verdict: gate OK, 0 issues, 0 hotspots, coverage ≥ 90 |
| `contract` | weekly checks (§3.7) |
| `deps` | weekly checks (§5.5) |
| `real-data` | opt-in, local only |
| `quality` | static → unit-ts → unit-py → scripts → emulators → build → coverage |
| `all` | quality → e2e (all tiers) → e2e-pipeline → sonar |

### 5.2 `docker/Dockerfile.quality` (sketch; all digests pinned)

```dockerfile
FROM hadolint/hadolint@sha256:9a3944b7fddcb947d1ffd90829ac1a6e5c30479223358f249d8b96c7d0019e27 AS hadolint   # v2.15.1
FROM koalaman/shellcheck@sha256:61862eba1fcf09a484ebcc6feea46f1782532571a34ed51fedf90dd25f925a8d AS shellcheck # v0.11.0
FROM rhysd/actionlint@sha256:b1934ee5f1c509618f2508e6eb47ee0d3520686341fec936f3b79331f9315667 AS actionlint  # 1.7.12
FROM mvdan/shfmt@sha256:f22f3936140be1ba02d493b5d2b91d0e8b4af93fd903e7f46c477822bca4a3be AS shfmt            # v3.13.1
FROM zricethezav/gitleaks@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f AS gitleaks # v8.30.1
FROM mcr.microsoft.com/playwright:v1.64.0-noble@sha256:<resolve> AS quality     # browsers + deps + fonts baseline
SHELL ["/bin/bash","-o","pipefail","-c"]
COPY --from=node:24-slim@sha256:<resolve> /usr/local/ /usr/local/               # Node 24.x LTS (≥24.12)
RUN apt-get update && apt-get install -y --no-install-recommends openjdk-21-jre-headless python3-venv \
    && rm -rf /var/lib/apt/lists/*                                               # JDK 21: firebase-tools 15 emulators
COPY --from=hadolint /bin/hadolint /usr/local/bin/ ...                           # + shellcheck/actionlint/shfmt/gitleaks
COPY package.json package-lock.json ./ ; COPY packages/*/package.json ...        # workspace manifests first (layer cache)
RUN --mount=type=cache,target=/root/.npm npm ci && npx firebase emulators:download? (cache emulator jars)
COPY scripts/ci/requirements.txt ./ ; RUN python3 -m venv /opt/ci && /opt/ci/bin/pip install -r requirements.txt
COPY fonts/ /usr/share/fonts/hcm/ ; RUN fc-cache -f                              # deterministic screenshots
ENV HCM_QUALITY_IMAGE=1 PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
```

`pipeline/Dockerfile` stages:

- `base`: `ghcr.io/osgeo/gdal:ubuntu-small-3.13.3@sha256:<resolve>`
- `deps`: venv with `--system-site-packages` and `poetry install --only main`
- `test`: adds `--with test` and the tool set
- `runtime`: non-root; the Cloud Run Job image, pushed to Artifact Registry by `deploy.yml`

### 5.3 GitHub Actions workflows and job graph

```text
ci.yml  (push: master, tags v*; pull_request; workflow_dispatch)   concurrency: per ref, cancel PR runs
 plan ──────────────► (ci_plan.py: docs-only → static; else quality+e2e; tag already proven on master → skip)
 images ─┬─ quality image (buildx, gha cache scope=hcm-quality)
         └─ pipeline:test image (gha cache scope=hcm-pipeline)
 static ─────────┐  unit-ts ─┐  unit-py ─┐  scripts ─┐  emulators   build ──► e2e[fn×4, tour×6, a11y, nogl, x]  e2e-pipeline
                 │           └───────────┴───────────┴──► coverage (merge + check_coverage.py)
                 └──────────────────────────────────────► sonar (PR + master only; fork-PR guard; quality gate)
codeql.yml   (push/PR/weekly; languages: javascript-typescript, python, actions; advanced setup, SHA-pinned)
deploy.yml   (workflow_run: ci success on master) WIF auth → firebase deploy (rules, indexes, functions from functions/deploy,
             hosting=admin) → build+push pipeline runtime → gcloud run jobs update → Pages deploy (sites/bucharest) → post-deploy smoke
release.yml  (tag vX.Y.Z) → Sonar gate of main/master analysis of this SHA (Whisper's polling script) → rebuild dist,
             `git diff --exit-code packages/*/dist` → GitHub Release (notes files, Watch-GPS rule) → best-effort jsDelivr purge @1/@latest
deps.yml     (weekly) PIPELINE_STAGE=deps → opens/updates one issue (Watch-GPS)
contract.yml (weekly) PIPELINE_STAGE=contract → issue on drift (no secrets)
```

- Runner: **`ubuntu-24.04`, pinned**, because `ubuntu-latest` migrates to 26.04 between Oct 19 and Nov 19, 2026.
- Every job: `permissions: contents: read` at minimum, `persist-credentials: false`, `timeout-minutes`.
- Sonar job:
  - `fetch-depth: 0`
  - skipped on fork PRs
  - analyses PRs and the default branch only (Whisper lesson: non-default-branch analysis returns 403 on the free plan; tags are gated by looking up the default-branch analysis of the same SHA)
  - **Automatic Analysis must be OFF** in SonarCloud (Watch-GPS lesson)

**Pinned SHAs taken from the siblings (newest seen):**

```yaml
actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1                 # v7.0.1
actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9                    # v6.1.0
actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9          # v7.0.2
actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333        # v8.0.2
docker/setup-buildx-action@f87e5991a6d7451dcb8d9637bfbc97413f497069       # v4.4.1
docker/build-push-action@53b7df96c91f9c12dcc8a07bcb9ccacbed38856a         # v7.3.0
docker/login-action@dbcb813823bdd20940b903addbd779551569679f              # v4.6.0
SonarSource/sonarqube-scan-action@d209202bc7d53ff1cc128f7f907dac145c9d6ae9          # v8.3.0
SonarSource/sonarqube-quality-gate-action@7a5fffe8e523c40e0c740b6bc2712ab503e52efa  # v1.2.1
softprops/action-gh-release@efb35369e0ad2afab669f228072c1b0d510eae64      # v3.0.3
```

Still to resolve during implementation (`gh api repos/<o>/<r>/git/ref/tags/<tag>`, dereferencing annotated tags):

- `actions/configure-pages` v6.0.0
- `actions/upload-pages-artifact` v5.0.0
- `actions/deploy-pages` v5.0.1
- `google-github-actions/auth` v3.x
- `github/codeql-action` v4.x

The `deps` stage keeps every pin current.

**Secrets inventory (minimal):**

- `SONAR_TOKEN` is the **only** repository secret.
- GCP access is **keyless WIF**. Billing may auto-create an org that blocks service-account keys. The provider's attribute condition is `assertion.repository=='ventura8/bucurestiuldisparut.github.io' && assertion.ref=='refs/heads/master'`.
- The `deploy` environment uses `id-token: write`.
- Mapbox and USGS secrets live **only** in Secret Manager, written by the admin through the Setup Assistant, never in GitHub.

**Human-only steps:**

- SonarCloud login and token creation. The user then runs `python3 scripts/ci/sonar_setup.py` (hidden prompt, writes the gitignored `.sonar-token`) and `gh secret set SONAR_TOKEN` (stdin).
- `gcloud auth login`.
- Every account creation, payment entry and token paste.

### 5.4 `sonar-project.properties`

```properties
sonar.organization=ventura8
sonar.projectKey=ventura8_bucurestiuldisparut.github.io
sonar.projectName=Bucuresti disparut - Historical City Map Engine
# sonar.projectVersion passed by the sonar stage from package.json
sonar.sourceEncoding=UTF-8
sonar.sources=packages/shared/src,packages/ui/src,packages/engine/src,packages/admin/src,functions/src,\
  pipeline/src,sites,starter-kit,scripts/ci,scripts/git-hooks,docker,.github/workflows
sonar.tests=packages/shared/test,packages/ui/test,packages/engine/test,packages/admin/test,packages/test-support/src,\
  functions/test,firebase/rules-tests,pipeline/tests,scripts/ci/tests,e2e
sonar.exclusions=**/dist/**,**/node_modules/**,**/.tsbuild/**,reports/**,functions/deploy/**,**/*.d.ts,\
  scripts/ci/tests/**
sonar.test.exclusions=e2e/__screenshots__/**,**/fixtures/**/*.json
# check_coverage.py reads sources/exclusions/coverage.exclusions + both report keys below: its scope == Sonar's.
# Intentionally EMPTY: every measured file must be >=90% (no coverage exclusions, AGENTS.md).
sonar.coverage.exclusions=
sonar.javascript.lcov.reportPaths=reports/coverage/ts/lcov.info
sonar.typescript.tsconfigPaths=tsconfig.json,packages/*/tsconfig.json,functions/tsconfig.json
sonar.python.version=3.14
sonar.python.coverage.reportPaths=reports/coverage/pipeline.xml,reports/coverage/scripts.xml
sonar.python.xunit.reportPath=reports/junit/pipeline.xml
sonar.cpd.exclusions=packages/shared/src/i18n/**,**/test/**,pipeline/tests/**,e2e/**
```

- `sonar.coverage.exclusions` stays empty, so `config.js` in `sites/` and `starter-kit/` is covered by a unit test that imports it and validates it against the zod schema.
- `.github/workflows` and `docker/` are in sources for Sonar's GitHub Actions and Docker security rules (Auto-Subtitle lesson). Coverage does not apply to those languages.

### 5.5 Dependencies, CodeQL, gitleaks, hooks

- **Dependency currency** (sibling convention instead of Renovate or Dependabot version PRs): `check_dependency_updates.py` covers:
  - npm workspaces, Poetry, CI `requirements.txt`
  - Docker digests and action SHAs
  - **the Mapbox GL CDN version string in the HTML files, which must equal the `mapbox-gl` dev dependency**
  - the Firebase SDK
  
  It keeps a `HELD` table: `typescript 7` (F1); `firebase 13` major only together with rules-unit-testing. A weekly issue reports anything behind. Turn on GitHub **Dependabot security alerts** only (no PRs). `npm audit` and `pip-audit` gate every run.
- **CodeQL:** advanced setup, SHA-pinned, `security-extended` queries.
- **gitleaks** (`.gitleaks.toml`, `useDefault=true`): path allowlist only for gitignored scratch (`node_modules`, `reports`, `.venv`, `.claude/worktrees`, `.sonar-token`, `functions/.secret.local`, `.env.*.local`). Nothing tracked is exempt.
- **Hooks** (`git config core.hooksPath scripts/git-hooks`, Watch-GPS pattern, no husky or lefthook):
  - `pre-commit`, in order:
    1. refuse secret-bearing paths (`.sonar-token`, `functions/.secret.local`, `.env.*.local`, `*service-account*.json`, `*.p12`)
    2. inline-suppression scan on the **staged index** (`git checkout-index` into a temp dir)
    3. `gitleaks git --pre-commit --staged --redact`
    4. `prettier --check` and `ruff format --check` on staged files
  - `pre-push`: requires `reports/pipeline/green-all.json` for the pushed commit with a clean tree. If `ci_plan` classifies the change as docs-only, the `static` marker is enough.

---

## 6. Sequencing (testability-first)

1. Scaffold the workspaces, tsconfig refs, the quality image, `run-all-checks.sh`, the suppression scanner, `check_coverage.py` with the LCOV reader, and the agent-asset gates. Get a green `static` on an empty skeleton.
2. `shared`: zod schemas, manifest generator and JSON-schema sync. Build `test-support`: FakeMap, API handlers and fixtures, emulator helpers, synthetic tiles.
3. Engine core against FakeMap, then the adapter in browser mode. Viewer e2e V01–V18 against static manifests; the starter kit comes for free.
4. Firebase rules and rules tests with the coverage gate. Functions as handlers plus ports plus msw. The emulator harness. The `functions/deploy` artifact.
5. Admin, with the Setup Assistant as a pure state machine driven by mocks (A03–A07) and the input-budget fixture. Then photos, layers, jobs, settings.
6. Pipeline: synthetic world and scan harness first (test-first), then the stages. Compose `e2e-pipeline`.
7. CI workflows, Sonar wiring (after the user's token step), CodeQL, deps and contract workflows, WIF deploy, release with dist commit and tag.

---

### Critical Files for Implementation

- /home/sergiu-alexandrescu/Projects/Fork-Linux-wt/e2e-coverage/scripts/check-coverage.py (port and extend with the LCOV reader and line+branch floors for every language)
- /home/sergiu-alexandrescu/Projects/Watch-GPS-Dashboard/scripts/ci/run-all-checks.sh (stage model, green markers) together with /home/sergiu-alexandrescu/Projects/Watch-GPS-Dashboard/scripts/git-hooks/pre-commit and pre-push
- /home/sergiu-alexandrescu/Projects/Watch-GPS-Dashboard/scripts/ci/check_no_inline_suppressions.py (extend with the TS, Vitest and Playwright patterns above)
- /home/sergiu-alexandrescu/Projects/Whisper-Pro-ASR/.github/workflows/ci.yml (Docker-image job graph, Sonar job, tag gate polling) and /home/sergiu-alexandrescu/Projects/Whisper-Pro-ASR/Dockerfile.test (pinned tool-image digests)
- /home/sergiu-alexandrescu/Projects/Watch-GPS-Dashboard/.agent/skills/quality/e2e_scenario_matrix_skill.md and /home/sergiu-alexandrescu/Projects/Watch-GPS-Dashboard/scripts/ci/check_agent_assets.py (matrix and docs-sync governance to replicate)
