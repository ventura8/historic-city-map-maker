---
description: Run the quality pipeline (static gates, Vitest and pytest with 90 percent per-file coverage, e2e, build, Sonar) inside the quality image, and iterate on a single tool
---

# Test and Quality Workflow

`scripts/ci/run-all-checks.sh` is the single entry point; CI calls the same script per stage. Stages: `.agent/skills/quality/pipeline_skill.md` → *Stages*; every gate and its fix: `.agent/skills/quality/ci_quality_gates_skill.md`.

## One command, CI-equivalent

```bash
bash scripts/ci/run-all-checks.sh                          # default stage: all (before every push to master or a tag)
PIPELINE_STAGE=quality bash scripts/ci/run-all-checks.sh   # what CI runs
PIPELINE_STAGE=static bash scripts/ci/run-all-checks.sh    # docs and tooling changes
PIPELINE_STAGE=tests bash scripts/ci/run-all-checks.sh     # Vitest (node + Chromium) and pytest, 90 % per file
PIPELINE_STAGE=build bash scripts/ci/run-all-checks.sh     # vite build of engine and admin
python3 scripts/ci/pipeline.py --list                      # the live stage -> gate registry (safe on the host)
```

Read the verdict from a log file, never through `tail` (the pipe's exit status would be `tail`'s):

```bash
mkdir -p reports/pipeline
PIPELINE_STAGE=static bash scripts/ci/run-all-checks.sh > reports/pipeline/run.log 2>&1; echo "EXIT=$?"
grep -E '^\[(SUCCESS|FAILURE)\]|FAILED' reports/pipeline/run.log
```

A passing stage ends with `[SUCCESS] stage '<x>' passed` and writes `reports/pipeline/green-<x>.json`. Quote that line before saying a change is done. `all` is `quality` (static, tests, e2e, build) followed by `sonar`, which skips with a notice and passes without a SonarCloud token. `deps` and `contract` are weekly network checks and fail when something drifted.

## Developer loop: one tool, inside the image

```bash
IMG="docker run --rm -u $(id -u):$(id -g) -e HOME=/tmp/hcm-home -v $PWD:$PWD -w $PWD hcm-quality:local"
$IMG bash -c 'mkdir -p $HOME && npx vitest run --project ui'            # one Vitest project (shared, ui, engine, admin)
$IMG bash -c 'mkdir -p $HOME && npx vitest run packages/shared/test/i18n.test.ts'
$IMG bash -c 'mkdir -p $HOME && npx eslint packages/engine'
$IMG bash -c 'mkdir -p $HOME && npx prettier --write e2e/scenarios.json'
$IMG bash -c 'mkdir -p $HOME && npx markdownlint-cli2'
$IMG bash -c 'mkdir -p $HOME && python3 -m pytest scripts/ci/tests/test_pipeline.py'
$IMG bash -c 'mkdir -p $HOME && ruff check . && ruff format --check . && mypy'
```

`bash scripts/ci/build-and-test.sh` (re)builds the image alone; `run-all-checks.sh` does it automatically and it takes seconds when cached. The first pipeline run after a lockfile change runs `npm ci --prefer-offline` from the image's npm cache (delete `node_modules/.hcm-install-stamp` to force it).

## Emulators and e2e

```bash
$IMG bash -c 'mkdir -p $HOME && npx firebase emulators:exec --project demo-hcm --only firestore,storage "npx vitest run --project rules"'
$IMG bash -c 'mkdir -p $HOME && npm run test:e2e'                                    # every Playwright spec
$IMG bash -c 'mkdir -p $HOME && cd e2e && npx playwright test --grep @S-V00-HAPPY'   # one scenario by its tag
PIPELINE_STAGE=e2e bash scripts/ci/run-all-checks.sh
```

The emulator JARs and Playwright browsers are baked into the image; the `demo-hcm` project needs no credentials. E2E details: `docs/TESTING.md`.

## The local stack (manual testing)

```bash
npm run dev:stack                        # admin 127.0.0.1:4312, viewer 127.0.0.1:4310, emulators, fakes, two seeded cities
bash scripts/dev/dev-stack.sh check      # its own check: sign-in, the main screens, the second city, no request off the machine
bash scripts/dev/dev-stack.sh stop       # from another terminal; Ctrl+C in its own
```

The e2e world without Playwright, in the quality image on the host's network (`scripts/dev/dev-stack.sh`, `e2e/stack/`); seeds, levers and limits: `docs/SETUP.md` → *Local stack for manual testing*; the walk-through: `docs/MANUAL_TEST_PLAN.md`.

## Reports (git-ignored `reports/`)

- `reports/pipeline/green-<stage>.json`, `reports/pipeline/run.log`
- `reports/coverage/ts/` (`lcov.info`, `coverage-summary.json`), `reports/coverage/scripts.xml`
- `reports/junit/vitest.xml`, `reports/junit/pytest.xml`, `reports/gitleaks.json`
- `reports/playwright/` (HTML report), `reports/test-results/` (a failed test's screenshot, error context and light trace; rerun it with `--trace retain-on-failure` for the DOM at each step), `reports/junit/e2e.xml`
