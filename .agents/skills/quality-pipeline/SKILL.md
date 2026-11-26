---
name: quality-pipeline
description: Run the Historic City Map Maker quality pipeline (scripts/ci/run-all-checks.sh inside the pinned hcm-quality image - suppression scan, skill mirrors, agent assets, data files, EditorConfig, scenario registry, i18n parity, font subset, copy wording, Prettier, tsc, ESLint, stylelint, HTML and Markdown linters, knip, dependency-cruiser, YAML, TOML, ruff, mypy, radon, bandit, shell, Docker, workflow-policy and action-pin checks, repo policy (secret files, exact pins, image digests) and budget, gitleaks over the tree and the CI commit range, Conventional Commits, npm and pip audits, Vitest with Chromium and pytest plus the per-file 90 percent coverage gate, the site build tests, Playwright e2e, vite build, bundle budget and third-party notices, the SonarQube scan and verdict, the weekly latest-stable dependency check) as CI runs it, pick the right stage, add a gate, and fix a failing gate without an inline suppression. Use before claiming any change is done, when a CI job fails, or when adding or bumping a tool.
---

# Quality Pipeline Skill

`scripts/ci/run-all-checks.sh` builds `docker/Dockerfile.quality` as `hcm-quality:local` and runs `scripts/ci/pipeline.py --stage "$PIPELINE_STAGE"` inside it, with the repository mounted at the same absolute path and no host-home mount. CI calls the same script per stage. The host's Node 22 and Python never run a gate.

Canonical stage table (and what `quality` and `all` contain): `.agent/skills/quality/pipeline_skill.md` → *Stages*. Every gate and its fix: `.agent/skills/quality/ci_quality_gates_skill.md`.

## Commands

```bash
PIPELINE_STAGE=static bash scripts/ci/run-all-checks.sh    # docs and tooling changes
PIPELINE_STAGE=tests bash scripts/ci/run-all-checks.sh     # Vitest (node + Chromium) + pytest, 90 % per file
PIPELINE_STAGE=build bash scripts/ci/run-all-checks.sh     # vite build of engine and admin
PIPELINE_STAGE=quality bash scripts/ci/run-all-checks.sh   # what CI runs
PIPELINE_STAGE=quality bash scripts/ci/e2e-split.sh        # the same, Playwright split with the NUC (e2e alone: 7.5 min)
bash scripts/ci/run-all-checks.sh                          # default all: before a push to master or a tag
PIPELINE_STAGE=release bash scripts/ci/run-all-checks.sh   # at a vX.Y.Z tag: versions, release notes, bundles
PIPELINE_STAGE=contract bash scripts/ci/run-all-checks.sh  # deep links and third-party API shapes (network)
PIPELINE_STAGE=sonar bash scripts/ci/run-all-checks.sh     # SonarQube scan and verdict (skips without SONAR_TOKEN or .sonar-token)
PIPELINE_STAGE=deps bash scripts/ci/run-all-checks.sh      # every pin on its latest stable release (network; HELD entries aside)
python3 scripts/ci/pipeline.py --list                      # the registry (safe on the host)
bash scripts/ci/build-and-test.sh                          # rebuild the image only
```

Read the verdict from a log, never through `tail`:

```bash
mkdir -p reports/pipeline
PIPELINE_STAGE=static bash scripts/ci/run-all-checks.sh > reports/pipeline/run.log 2>&1; echo "EXIT=$?"
grep -E '^\[(SUCCESS|FAILURE)\]|FAILED' reports/pipeline/run.log
```

One tool while iterating (inside the image):

```bash
docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp/hcm-home -v "$PWD:$PWD" -w "$PWD" hcm-quality:local \
  bash -c 'mkdir -p $HOME && npx vitest run --project ui'
```

## Which stage

- Docs or tooling only: `static`. In CI a pull request whose every changed file is Markdown runs only `static` too (the `changes` job of `ci.yml` skips `tests`, `e2e`, `build` and with them `sonarqube`); a push runs everything.
- TypeScript or Python: `static`, `tests`, `build`.
- A user-visible change, `e2e/`, `e2e/scenarios.json`, `sites/`, `starter-kit/` or `scripts/site/`: also `e2e` (`E2E_TIER=smoke,fn` for a quick run; unset runs every push's tiers, every scenario row; `all` and the `tour-matrix` stage add the rest of the tour matrix; `bash scripts/ci/e2e-split.sh` instead of `run-all-checks.sh` splits the Playwright runs with the NUC). The site build's unit tests run in Vitest's `tools` project (gate `vitest` of `tests`); the Pages sites are built by `site-build` in `build`, after `notices` checked each build's `THIRD_PARTY_NOTICES.txt` against its source maps.
- A Setup Assistant deep link (`packages/admin/src/setup/links.json`) or a third-party probe: `contract`.
- Before a push to `master` or a tag: `all` (the default: `quality` with the `tour-matrix` stage after `e2e`, then `sonar`, which skips with a notice without a token).
- A dependency bump: `static`, `tests`, `build`, then `deps` to see what else is behind; a deliberate hold is a `HELD` entry with its reason in `scripts/ci/check_dependency_updates.py`.

## Adding a gate

1. Pin the tool: exact npm devDependency, an exact line in `scripts/ci/requirements.txt`, or a digest-pinned binary in `docker/Dockerfile.quality`.
2. Add `Gate("<name>", (...))` to `GATES` in `scripts/ci/pipeline.py`; npm tools get a `package.json` script and run as `(*NPM_RUN, "<script>")`.
3. Add the name to its stage in `STAGES` (cheapest first, network-bound last). The gates of a stage run at the same time (`scripts/ci/gate_runner.py`, at most `PIPELINE_JOBS`, output still in registry order): a gate that reads another gate's output gets `needs=("<gate>",)` and comes after it, one that saturates the machine or binds fixed ports gets `exclusive=True`, and tool caches go under `reports/.cache/`.
4. Run the pytest suite in the image: the registry tests reject unknown, duplicated or unstaged gates.
5. Update `pipeline_skill.md`, `ci_quality_gates_skill.md`, `docs/CI_PIPELINE.md` and this skill (then `cp` it to `.claude/skills/quality-pipeline/SKILL.md`).

## Fixing a gate

Never suppress: no inline directive of any tool, no `.skip`/`.only`/`xfail`, no lowered threshold, no exclusion to pass. Split the function, type the value, render with Lit or `textContent`, log through `createLogger` or `scripts/ci/cilog.py`, drive the uncovered branch from outside. A genuine relaxation goes into the tool's single config with a why-comment, and editing a lint config is ask first. An advisory is fixed with `overrides` (or a vendored copy such as `vendor/npm/braces` or `vendor/npm/minimatch`), never an allowlist; a transitive one whose fix every dependant's range accepts is a lockfile refresh of its entries instead (`.agent/skills/quality/pipeline_skill.md` → *Local tooling quirks*), and a Python one a new exact pin in every requirements file that names the package.

## Hard-won rules

- Memory (the owner, 2026-11-12: lint on four workers took 12 GB of a 31 GB laptop): before a commit run `npm run lint:changed` (changed files, one worker). `npm run lint` runs one ESLint process per group of TypeScript projects (`scripts/ci/lint.sh`), at most 2.9 GB each, against 8.6 GB for the whole tree in one process. The pipeline picks its parallelism from the free memory too (`scripts/ci/parallel.py`); `HCM_LOW_MEM=1` is the low-memory mode (serial gates, one lint group at a time, two Vitest and two Playwright workers) and `HCM_MAX_PARALLEL=<n>` caps everything. Heavy stages go to the NUC.
- Never edit `scripts/ci/run-all-checks.sh` while it runs (bash reads it by offset). When another run may be in flight, replace it atomically: write a temporary file next to it and `mv` it over (the running bash keeps the old inode).
- The quality image sets `LD_PRELOAD=""`: the GDAL base preloads tcmalloc and Chromium aborts under it.
- A new workspace with registry dependencies needs a `COPY <dir>/package.json <dir>/` line in the Dockerfile's `manifests` stage, or `npm ci` fails in the image build (one whose dependencies are all workspaces needs none).
- A dependency change (lockfile, a manifest's dependency fields, `scripts/ci/requirements.txt`) rebuilds the image for three to five minutes on every machine, with downloads; an npm script edit or a version bump does not, because the `manifests` stage drops the scripts and writes the workspaces' versions as 0.0.0 before the npm layer (keep `emulators:setup`, which that layer runs). A NUC whose build cache was evicted rebuilds from the registries: a download, so ask first and run here only meanwhile (`.agent/skills/quality/pipeline_skill.md` → *Local tooling quirks*).
- A split run (`scripts/ci/e2e-split.sh`) gives each machine part of the admin tier's projects (`E2E_ADMIN_PART=1-2/3` on the NUC, about twice as fast, `3/3` here; their locked tests run one at a time against each machine's own emulators, the content tests on every worker) and slices every other tier by `HCM_SPLIT_PARTS` without counting the admin tests (`e2e/split-reporter.ts`), so the two admin parts run at the same time instead of one chain ending the NUC's part.
- `npm install` of a dependency runs in the digest-pinned `node:24-bookworm-slim` image, after `npm view` (`docs/SETUP.md` → *npm in a container*). While other agents run gates in the same tree, write the new `package-lock.json`'s SHA-256 to `node_modules/.hcm-install-stamp` afterwards: `npm install` already brought `node_modules` to the lockfile, and a stale stamp makes the next run's `npm ci` delete `node_modules` under their tests.
- Vite bundles a config's relative imports (`scripts/site/src/css-literals.ts`, `notices.ts`) but leaves their package imports to Node: such a module imports `node:` modules, npm packages and files beside it, never a workspace package such as `@hcm/shared`, whose TypeScript sources import `./x.js` (`ERR_MODULE_NOT_FOUND`: the first build with the notices plugin, which imported the site build's `errors.ts`).
- A dependency whose npm package ships no `LICENSE` (the Firebase JS SDK's packages, Terra Draw) gets the standard text of its declared licence in `THIRD_PARTY_NOTICES.txt` (`scripts/site/src/licence-texts.ts`); one whose licence has no text there stops the build, and one whose licence is not on `ALLOWED_LICENCES` (`scripts/ci/check_notices.py`) fails the `notices` gate until it is reviewed.
- A browser crash leaves `core.<pid>` in the repository root (git-ignored); delete it.
- Commit subjects are `type(scope): summary` (`scripts/git-hooks/commit-msg` locally, the `commits` gate over the CI range); squash `fixup!` commits before a pull request.
- The image has a real `sonar-scanner` on `PATH`: a test that hides its fake tool must also drop the image's directories from `PATH`.
- e2e specs are linted with `eslint-plugin-playwright`: no conditional in a test body (window-class branches go into helpers such as `closeModalSheet` in `e2e/support/viewer.ts`), assertion helpers are named `expect…`, a test function stays within 120 lines (a journey becomes one function per step).
- A change to `functions/package.json`'s dependencies or to the root `overrides` refreshes `functions/deploy-lock/` (`npm run deploy-lock --workspace @hcm/functions` in the pinned Node image, with the network); the `vite-build` gate fails on a stale lock and `deploy-lock-audit` audits it.
