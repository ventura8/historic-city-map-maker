# Decisions for review

Proposals for edits that `AGENTS.md` lists under *Ask first* (lint and tool configs, `.github/workflows/`,
`.gitleaks.toml`, `.claude/settings.json`), so no agent applied them. Each section is one decision: the exact
change, why, and how to verify it. Approve or reject them one by one; an approved section is applied in its own
change, followed by the stage named under *Verify*. Nothing here weakens a gate: every proposal either adds a
check or narrows a scope to exactly the false positive it names.

Opened on 2026-10-12 by the agent that closed the M0 review leftovers (`docs/research/M0-handoff.md` §10f), from
the findings of §10d and §10e.

Addendum (2026-10-12, after the review): the user approved §1 to §25 as a whole, relayed to the applying agent by the
orchestrator. Each heading now says `APPLIED 2026-10-12 (user approved)` or `NOT APPLIED: <reason>`; §26 records how
they were applied, where a later section superseded an earlier one, where the stricter of two readings was taken, and
why seven were not applied. §27 is a new proposal that waits for the user's own answer.

## 1. `.htmlvalidate.json`: extend `html-validate:prettier` — APPLIED 2026-10-12 (user approved)

Prettier 3 prints `<!doctype html>` and self-closing void tags (`<meta ... />`); html-validate's recommended
`doctype-style` and `void-style` rules reject both, so today no committed `.html` file can pass the `prettier` and
`html-validate` gates together. html-validate 11.16.2 ships the `html-validate:prettier` preset, which turns off
exactly the rules that contradict Prettier's output and nothing else. M1 needs it before the first page of
`sites/bucharest/`.

```diff
-    "extends": ["html-validate:recommended"],
+    "extends": ["html-validate:recommended", "html-validate:prettier"],
```

Verify: `PIPELINE_STAGE=static` with the first committed `.html` file.

## 2. `eslint.config.js`: Playwright rules for `e2e/`, why-comments for the test limits — APPLIED 2026-10-12 (user approved; stricter variant, §26)

Today `e2e/**` gets neither the test rules nor any size limit, and `eslint-plugin-playwright`
(`quality-conventions.md` §4.2, `design-review-testability.md` §2) is not installed, so nothing enforces "no
sleeps" (`playwright/no-wait-for-timeout`) or web-first assertions. The relaxed test limits (600 / 120 / 8) have no
why-comment, which the config's own header requires.

Install first (the latest release, checked with `npm view` on 2026-10-12; peer `eslint >=8.40.0`), in the pinned
Node image (`docs/SETUP.md` → *npm in a container*):

```bash
npm install --save-exact --save-dev eslint-plugin-playwright@2.12.1
```

```diff
 import nounsanitized from 'eslint-plugin-no-unsanitized';
+import playwright from 'eslint-plugin-playwright';
 import sonarjs from 'eslint-plugin-sonarjs';
@@
 const TESTS = ['packages/*/test/**/*.ts', 'packages/test-support/src/**/*.ts', 'functions/test/**/*.ts', 'firebase/rules-tests/**/*.ts'];
+/** Playwright specs, fixtures and config (the @hcm/e2e workspace). */
+const E2E = ['e2e/**/*.ts'];
 const NODE_TOOLING = ['*.config.ts', 'packages/*/vite.config.ts', 'eslint.config.js', '.dependency-cruiser.cjs'];
@@
+/**
+ * Tests may be longer than product code, never more complex: a test file holds one behaviour's happy and bad rows
+ * with their fixtures (600 lines), a test reads top to bottom as arrange / act / assert without helper indirection
+ * (120 lines per function), and the fixtures Vitest and Playwright inject arrive as parameters (8).
+ */
+const TEST_LIMITS = {
+    'max-lines': ['error', { max: 600, skipBlankLines: true, skipComments: true }],
+    'max-lines-per-function': ['error', { max: 120, skipBlankLines: true, skipComments: true }],
+    'max-params': ['error', 8],
+};
@@
         rules: {
             'vitest/no-focused-tests': 'error',
             'vitest/no-disabled-tests': 'error',
             'vitest/expect-expect': ['error', { assertFunctionNames: ['expect', 'expect.element'] }],
-            'max-lines': ['error', { max: 600, skipBlankLines: true, skipComments: true }],
-            'max-lines-per-function': ['error', { max: 120, skipBlankLines: true, skipComments: true }],
-            'max-params': ['error', 8],
+            ...TEST_LIMITS,
         },
     },
+    {
+        // The e2e suite must stay deterministic (design-review-testability.md §2): no sleeps, no focused or
+        // skipped tests, no networkidle waits, no forced clicks, web-first assertions only.
+        files: E2E,
+        extends: [playwright.configs['flat/recommended']],
+        languageOptions: { globals: globals.node },
+        rules: {
+            'playwright/no-wait-for-timeout': 'error',
+            'playwright/no-focused-test': 'error',
+            'playwright/no-skipped-test': ['error', { allowConditional: false }],
+            'playwright/no-networkidle': 'error',
+            'playwright/no-force-option': 'error',
+            'playwright/prefer-web-first-assertions': 'error',
+            ...TEST_LIMITS,
+        },
+    },
```

Verify: `PIPELINE_STAGE=static` (eslint and knip: the new devDependency is used by the config) and `e2e`.

## 3. `.dependency-cruiser.cjs`: keep the Firebase SDK out of the public viewer; scan `e2e/` and the rules tests — APPLIED 2026-10-12 (user approved; stricter variant, §26)

`AGENTS.md`: the public viewer never reads Firestore and loads no Firebase SDK for data; Addendum 2 of `PLAN.md`
allows only the consent-gated GA4 and Performance Monitoring. No rule enforces either today. With
`doNotFollow: node_modules`, only the first hop into `node_modules` is checked, which is exactly the import the
engine writes.

```diff
         {
             name: 'only-the-map-adapter-imports-mapbox',
@@
             to: { path: 'node_modules/mapbox-gl/' },
         },
+        {
+            name: 'engine-firebase-only-in-telemetry',
+            severity: 'error',
+            comment: 'The public viewer loads no Firebase SDK, except the consent-gated telemetry (PLAN.md Addendum 2).',
+            from: { path: '^packages/engine/', pathNot: '^packages/engine/src/telemetry/' },
+            to: { path: 'node_modules/(firebase|@firebase)/' },
+        },
+        {
+            name: 'engine-telemetry-only-app-analytics-performance',
+            severity: 'error',
+            comment: 'Telemetry may load firebase/app, firebase/analytics and firebase/performance, nothing else.',
+            from: { path: '^packages/engine/src/telemetry/' },
+            to: { path: 'node_modules/(firebase|@firebase)/', pathNot: 'node_modules/firebase/(app|analytics|performance)/' },
+        },
+        {
+            name: 'no-firebase-data-sdk-in-public-code',
+            severity: 'error',
+            comment: 'engine and shared (bundled into the viewer) never load Firestore, Auth, Storage or Realtime Database.',
+            from: { path: '^packages/(engine|shared)/' },
+            to: { path: 'node_modules/(firebase/(firestore|auth|storage|database)|@firebase/(firestore|auth|storage|database))' },
+        },
     ],
```

And in the root `package.json` (not ask-first itself, but it belongs with this decision), scan the e2e and
rules-test workspaces too, so cycles and unresolvable imports are caught there:

```diff
-        "lint:deps": "depcruise packages functions --config .dependency-cruiser.cjs",
+        "lint:deps": "depcruise packages functions e2e firebase/rules-tests --config .dependency-cruiser.cjs",
```

Checked on 2026-10-12 in the quality image: `npx depcruise packages functions e2e firebase/rules-tests --config
.dependency-cruiser.cjs` reports no violation (82 modules, 122 dependencies). Not applied yet because a root
`package.json` change invalidates the image's npm layer (Playwright browsers and emulator JARs are downloaded again):
batch it with the next dependency bump (`dependency-cruiser` 18.6.0 is already out, see §10f).

Verify: `PIPELINE_STAGE=static` (`dependency-cruiser`), plus a throwaway import of `firebase/firestore` in an engine
file, which must fail.

## 4. Workflow hardening (`.github/workflows/`) — APPLIED 2026-10-12 (user approved): 4a to 4e

### 4a. `ci.yml` `deploy-firebase`: install before authenticating — APPLIED 2026-10-12 (user approved)

`npm ci` runs the install scripts of about 1,200 packages after the Workload Identity step has written a
short-lived credentials file into the mounted workspace and exported `GOOGLE_APPLICATION_CREDENTIALS`. Install
first, authenticate last:

```diff
             - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
               with:
                   persist-credentials: false

-            - name: Authenticate to Google Cloud (Workload Identity Federation)
-              uses: google-github-actions/auth@7c6bc770dae815cd3e89ee6cdf493a5fab2cc093 # v3.0.0
-              with:
-                  workload_identity_provider: ${{ vars.GCP_WIF_PROVIDER }}
-                  service_account: ${{ vars.GCP_DEPLOY_SA }}
-
             - uses: ./.github/actions/quality-image

             - name: Load the quality image
               env:
                   HCM_DOCKER_BUILD_FLAGS: ${{ env.LOAD_IMAGE }}
               run: bash scripts/ci/build-and-test.sh

+            # Every install script runs BEFORE the credentials exist: none of them can read the token file.
+            - name: Install dependencies (no credentials yet)
+              run: >-
+                  docker run --rm --user "$(id -u):$(id -g)" --env HOME=/tmp
+                  --volume "$PWD:$PWD" --workdir "$PWD" "$HCM_IMAGE"
+                  npm ci --prefer-offline --no-audit --no-fund
+
+            - name: Authenticate to Google Cloud (Workload Identity Federation)
+              uses: google-github-actions/auth@7c6bc770dae815cd3e89ee6cdf493a5fab2cc093 # v3.0.0
+              with:
+                  workload_identity_provider: ${{ vars.GCP_WIF_PROVIDER }}
+                  service_account: ${{ vars.GCP_DEPLOY_SA }}
+
             # firebase-tools is pinned in package.json and runs in the image; the short-lived
             # credentials file of the auth step lives in the workspace, mounted at the same path.
             - name: firebase deploy
@@
                   in_image=(docker run --rm --user "$(id -u):$(id -g)" --env HOME=/tmp --env GOOGLE_APPLICATION_CREDENTIALS
                       --volume "$PWD:$PWD" --workdir "$PWD" "$HCM_IMAGE")
-                  "${in_image[@]}" npm ci --prefer-offline --no-audit --no-fund
                   "${in_image[@]}" npx firebase deploy --non-interactive --project "$GCP_PROJECT_ID" \
```

### 4b. `ci.yml` `sonarqube`: check every report the scan reads — APPLIED 2026-10-12 (user approved)

The job checks `lcov.info`, `scripts.xml` and `pytest.xml` but not the raster pipeline's `pipeline.xml` and
`junit/pipeline.xml`. `scripts/ci/sonar_report.py --check-reports` (added in §10f) reads the list from
`sonar-project.properties`, the single source, so load the image first and let it decide:

```diff
-            - name: Check the reports are present
-              id: reports
-              if: steps.sonar.outputs.enabled == 'true'
-              run: |
-                  for report in reports/coverage/ts/lcov.info reports/coverage/scripts.xml reports/junit/pytest.xml; do
-                      test -s "$report" || { echo "::error::missing or empty ${report}"; exit 1; }
-                  done
-                  echo "version=$(jq -r .version package.json)" >>"$GITHUB_OUTPUT"
+            - if: steps.sonar.outputs.enabled == 'true'
+              uses: ./.github/actions/quality-image
+
+            - name: Load the quality image
+              if: steps.sonar.outputs.enabled == 'true'
+              env:
+                  HCM_DOCKER_BUILD_FLAGS: ${{ env.LOAD_IMAGE }}
+              run: bash scripts/ci/build-and-test.sh
+
+            # Every coverage and test report named in sonar-project.properties exists and is not empty.
+            - name: Check the reports are present
+              id: reports
+              if: steps.sonar.outputs.enabled == 'true'
+              run: |
+                  docker run --rm --user "$(id -u):$(id -g)" --env HOME=/tmp --volume "$PWD:$PWD" --workdir "$PWD" \
+                      "$HCM_IMAGE" python3 scripts/ci/sonar_report.py --check-reports
+                  echo "version=$(jq -r .version package.json)" >>"$GITHUB_OUTPUT"
@@
-            - if: steps.sonar.outputs.enabled == 'true'
-              uses: ./.github/actions/quality-image
-
-            - name: Load the quality image
-              if: steps.sonar.outputs.enabled == 'true'
-              env:
-                  HCM_DOCKER_BUILD_FLAGS: ${{ env.LOAD_IMAGE }}
-              run: bash scripts/ci/build-and-test.sh
-
             # The repository's release bar on top of the gate: no open issue, no hotspot to review, no
```

Later option (not part of this decision): the job could run `PIPELINE_STAGE=sonar bash
scripts/ci/run-all-checks.sh` itself (pipeline parity) once the container receives the `GITHUB_*` variables the
scanner reads to detect pull-request analyses; today the scan action does that detection.

### 4c. `deps.yml`: open the issue only when something is behind — APPLIED 2026-10-12 (user approved)

The `deps` stage now has its gate (`dependency-updates`), so the empty Monday issue is gone. What remains: a
registry outage (exit 2, "not checked" lines) would still open "Dependency updates available". Open or update the
issue only when the log names a pin that is behind (` -> `) or a stale hold (`HELD`); otherwise just fail the run:

```diff
                   echo "status=${status}" >>"$GITHUB_OUTPUT"

+            # Exit 1 (behind, stale hold) and exit 2 (a registry could not be read) both fail the stage;
+            # only real findings belong in the reminder issue.
+            - name: Updates found?
+              id: found
+              if: steps.check.outputs.status != '0'
+              run: |
+                  if grep -Eq '^  - (.* -> |HELD )' deps.log; then
+                      echo "updates=true" >>"$GITHUB_OUTPUT"
+                  else
+                      echo "updates=false" >>"$GITHUB_OUTPUT"
+                  fi
+
             - name: Open or update the reminder issue
-              if: steps.check.outputs.status != '0'
+              if: steps.found.outputs.updates == 'true'
               uses: ./.github/actions/upsert-issue
```

### 4d. `release.yml`: build without write access, publish without running repository code — APPLIED 2026-10-12 (user approved)

Today the `release` stage (npm ci, every install script, the build) runs in the job that holds `contents: write`.
Split it: the build job reads, the publish job writes and runs no repository code.

```yaml
jobs:
    build:
        name: Release checks & bundles
        runs-on: ubuntu-24.04
        timeout-minutes: 45
        permissions:
            contents: read
        steps:
            - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
              with:
                  persist-credentials: false

            - uses: ./.github/actions/quality-image

            - name: Release stage
              env:
                  PIPELINE_STAGE: release
                  HCM_DOCKER_BUILD_FLAGS: --load --cache-from type=gha,scope=hcm-quality
              run: bash scripts/ci/run-all-checks.sh

            - name: Upload the release files
              uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2
              with:
                  name: release
                  path: |
                      packages/engine/dist/
                      packages/admin/dist/
                      docs/releases/
                  if-no-files-found: error
                  retention-days: 7

    publish:
        name: Publish GitHub Release
        needs: build
        runs-on: ubuntu-24.04
        timeout-minutes: 10
        permissions:
            contents: write
        steps:
            - name: Download the release files
              uses: actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333 # v8.0.2
              with:
                  name: release
                  path: release

            # The single H1 of the description file is the release title (docs/releases/README.md).
            - name: Release title
              id: notes
              env:
                  TAG: ${{ github.ref_name }}
              run: |
                  title="$(sed -n 's/^# //p' "release/docs/releases/${TAG}_github_description.md" | head -n 1)"
                  echo "title=${title:-$TAG}" >>"$GITHUB_OUTPUT"

            - name: GitHub Release
              uses: softprops/action-gh-release@efb35369e0ad2afab669f228072c1b0d510eae64 # v3.0.3
              with:
                  name: ${{ steps.notes.outputs.title }}
                  body_path: release/docs/releases/${{ github.ref_name }}_github_description.md
                  fail_on_unmatched_files: true
                  files: |
                      release/packages/engine/dist/*
                      release/packages/admin/dist/*
```

(upload-artifact keeps the paths below their common ancestor, the repository root, hence the `release/` prefixes.)

### 4e. `ci.yml` `static`: name the commit range for the `commits` gate (optional) — APPLIED 2026-10-12 (user approved)

The new `commits` gate reads `COMMIT_RANGE` and falls back to `GITLEAKS_LOG_OPTS`, which this job already exports,
so CI enforces Conventional Commits without this change. For clarity the same step can export both
(`scripts/ci/run-all-checks.sh` already forwards `COMMIT_RANGE`):

```diff
                   echo "GITLEAKS_LOG_OPTS=${range}" >>"$GITHUB_ENV"
+                  echo "COMMIT_RANGE=${range}" >>"$GITHUB_ENV"
```

Verify for all of §4: `PIPELINE_STAGE=static` (actionlint, workflow schemas, `workflow-policy`, `action-pins`),
then one run on GitHub.

## 5. `sonar-project.properties`: analyse `.github/actions` too — APPLIED 2026-10-12 (user approved)

The composite actions (`quality-image`, `upsert-issue`) hold shell and GitHub Actions code like the workflows, which
are already in `sonar.sources`:

```diff
     docker,\
-    .github/workflows
+    .github/workflows,\
+    .github/actions
```

Verify: `PIPELINE_STAGE=tests` (the `coverage` gate reads the same scope; YAML has no coverage, so it stays green)
and the next Sonar analysis.

## 6. gitleaks: the pushed false positive in `14d4d7b`, and the header of `.gitleaks.toml` — APPLIED 2026-10-12 (user approved): 6a, 6b and its stricter option

### 6a. `.gitleaksignore` (new file) for exactly one finding — APPLIED 2026-10-12 (user approved)

Commit `14d4d7b` (already on `origin/feat/engine-rewrite`) holds the multi-line `curl-auth-user` false positive of
`docs/research/quality-conventions.md` that a later commit reworded (§7 of the hand-off). A pull request whose range
includes it fails `gitleaks-history`. The fingerprint, computed with gitleaks 8.30.1 in `hcm-quality:local`
(`gitleaks git --log-opts="origin/master..HEAD"`, the only finding of the branch), names that commit, file, rule and
line only, so nothing else is tolerated:

```text
# Commit 14d4d7b (already pushed): the multi-line curl-auth-user false positive in
# docs/research/quality-conventions.md, reworded later (docs/research/M0-handoff.md §7, §10e).
14d4d7b4a397704bc4488f09f29f1811a9983b77:docs/research/quality-conventions.md:curl-auth-user:520
```

gitleaks reads `.gitleaksignore` from the scanned directory by itself (no flag needed). Checked on 2026-10-12: with
this file, `gitleaks git --log-opts="origin/master..HEAD"` reports no leak, and `gitleaks dir` (the `gitleaks` gate,
whose fingerprints have no commit part) is unaffected. The alternative is squashing the branch before the pull request
(a force-push of `feat/engine-rewrite`, also ask first).

### 6b. `.gitleaks.toml`: say what the path allowlist really does — APPLIED 2026-10-12 (user approved; stricter variant, §26)

The header says "nothing tracked by git is exempted", but the allowlist also hides `.sonar-token` and `.env.local`
in history mode, tracked or not. The `repo-policy` gate and the pre-commit hook refuse those files in git's view, so
nothing is lost today; the wording should still be true:

```diff
-# and the pipeline's own reports/. This allowlist is about scan SCOPE, not about tolerating a finding:
-# nothing tracked by git is exempted, and a real secret committed to this repository is still reported.
+# and the pipeline's own reports/. This allowlist is about scan SCOPE, not about tolerating a finding.
+# Two entries name the developer's local secret files (.sonar-token, .env.local) so the directory scan does
+# not report them; they would be hidden in history mode too, which is why the repo-policy gate and the
+# pre-commit hook refuse both files in git's view. Every other tracked path is scanned.
```

Stricter option: give `gitleaks-history` its own config without the two secret-file entries (a second
`.gitleaks-history.toml`, `--config` changed in `GITLEAKS_HISTORY` in `scripts/ci/pipeline.py`).

Verify: `PIPELINE_STAGE=static` (`gitleaks`, `gitleaks-history` with `GITLEAKS_LOG_OPTS=origin/master..HEAD`).

## 7. `ruff.toml`: GDAL's CamelCase names in the stubs — APPLIED 2026-10-12 (user approved; stricter variant, §26)

`pipeline/typings/osgeo/*.pyi` declares GDAL's CamelCase API as typed callable attributes, because ruff N802/N803
reject a CamelCase `def` and `ruff.toml` is ask-first. A per-file ignore limited to the stubs allows ordinary `def`
stubs (a follow-up rewrites them):

```diff
 "**/tests/**/*.py" = ["S101", "S105", "S106", "S108", "S607", "PLR2004"]
+# GDAL's Python API is CamelCase (gdal.Open, Dataset.GetGeoTransform); its stubs must spell it as GDAL does.
+"pipeline/typings/**/*.pyi" = ["N802", "N803"]
```

Verify: `PIPELINE_STAGE=static` (`ruff-check`, `pipeline-mypy`).

## 8. `pytest.ini`: the `editorconfig` deprecation filter (keep) — APPLIED 2026-10-12 (user approved): kept, no change

The CI tooling's pytest turns every warning into an error, except one line that tolerates the `codecs.open()`
deprecation warning `editorconfig` 0.17.1 (the latest release) raises on Python 3.14. The filter names the message,
the category and the module, so no other warning slips through. Recommendation: keep it, and delete it when an
`editorconfig` release reads files with `open()` (the weekly `deps` stage reports the new version). The alternative,
replacing the library with an own `.editorconfig` parser in `scripts/ci/check_editorconfig.py`, is more code to
maintain for no gain.

## 9. `vitest.config.ts`: an `engine-browser` project and a `tools` project (M1 change request CR-2) — APPLIED 2026-10-12 (user approved)

Added on 2026-10-12 by the M1 contracts agent (`docs/research/M1-interfaces.md` → *Change requests*). Two test
environments M1 needs do not exist yet:

- **`engine-browser`**: the Mapbox adapter runs against the real `mapbox-gl@3.32.0` under SwiftShader and the viewer's
  Lit elements need a real DOM (`design-review-testability.md` §3.2, §3.3); today the engine project is node-only.
- **`tools`**: the JavaScript CLIs (`scripts/seed/migrate-legacy.mjs`, `packages/ui/scripts/gen-theme.mjs`) are tested
  as child processes. The ui project runs in Chromium (it cannot start a process), so both CLI test files sit in the
  shared node project today (`packages/shared/test/cli/`), which works but is the wrong home.

```diff
     {
         dir: 'packages/engine',
-        project: { extends: true, test: { name: 'engine', environment: 'node', include: ['packages/engine/test/**/*.test.ts'] } },
+        project: {
+            extends: true,
+            test: { name: 'engine', environment: 'node', include: ['packages/engine/test/**/*.test.ts'], exclude: ['packages/engine/test/browser/**'] },
+        },
         coverage: ['packages/engine/src/**/*.ts'],
     },
+    {
+        // The Mapbox adapter (real mapbox-gl under SwiftShader) and the Lit viewer elements need a browser; same coverage scope.
+        dir: 'packages/engine',
+        project: { extends: true, test: { name: 'engine-browser', include: ['packages/engine/test/browser/**/*.test.ts'], browser: chromium } },
+        coverage: [],
+    },
+    {
+        // JavaScript CLIs, driven as child processes; their logic is TypeScript measured in its own package.
+        dir: '.',
+        project: { extends: true, test: { name: 'tools', environment: 'node', include: ['scripts/*/test/**/*.test.ts', 'packages/*/scripts/test/**/*.test.ts'] } },
+        coverage: [],
+    },
```

Follow-ups in the same change: move `packages/shared/test/cli/migrate-legacy.test.ts` to `scripts/seed/test/` and
`packages/shared/test/cli/gen-theme.test.ts` to `packages/ui/scripts/test/`, give both folders a `tsconfig.json` in the
root solution, and add their globs to `TESTS` in `eslint.config.js` (also ask-first). Nothing is excluded from coverage.

Verify: `PIPELINE_STAGE=tests` (the `vitest` gate lists the new project names) and `static` (`tsc`, `eslint`, `knip`).

## 10. The legacy migration writes new files under `seed/bucharest/` (for visibility) — APPLIED 2026-10-12 (user approved): committed (§11)

Added on 2026-10-12 by the M1 contracts agent. `seed/bucharest/` is ask-first for changes to the legacy originals,
and none were changed: `photos.legacy.geojson`, `photos/` and `thumbnails/` are only read. The planned M1 migration
step (`PLAN.md` → M1, "migrated photos/cones via a static manifest") wrote two new outputs next to them with
`scripts/seed/migrate-legacy.mjs`:

- `seed/bucharest/manifest.static.json` (50 KB): the City Manifest v1 of Bucharest, schema-validated, 45 photos;
- `seed/bucharest/derived/<id>/{web,thumb}.webp`: 90 WebP files, 9.52 MB in total, EXIF and ICC stripped.

Decision for the user: commit the derivatives (the M1 static site and the e2e tier read them; `seed/` is outside the
repository budget, and M2 moves the photos to Cloud Storage), or keep them out of git and let the site build run the
migration (it needs sharp and about 20 s in the quality image). The manifest is small and should be committed either
way. Re-running the migration rewrites both outputs from the originals.

Verify: `npm run seed:migrate` in the quality image ends with `manifest written { photos: 45, cones: 34, ... }`.

## 11. Orchestrator decisions taken overnight (2026-10-12), for review — APPLIED 2026-10-12 (user approved): confirmed

| Item | Decision | Why | Reverse how |
| --- | --- | --- | --- |
| `seed/bucharest/derived/` (90 WebP, 9.5 MB) | Committed | Deterministic migration output; the static site and the e2e fixtures need it; `check_repo_budget.py` excludes `seed/` | `git rm -r seed/bucharest/derived` and regenerate it at build time with `scripts/seed/migrate-legacy.mjs` |
| CR-2 (`vitest.config.ts` `engine-browser` project) pending | Workaround: every Lit component, viewer-specific ones included, lives in `packages/ui` (browser project); `packages/engine` stays DOM-free logic plus a dependency-injected `mount()` tested in Node | No ask-first edit while the user is away; no gate weakened | Once §9 is approved, viewer components may move to `packages/engine/src/ui/` |

## 12. M1 e2e infrastructure and the static sites (e2e-infra, 2026-10-12) — APPLIED 2026-10-12 (user approved) except where its subsections say otherwise

Added by the M1 e2e-infra workstream. The sites (`sites/bucharest/`, `starter-kit/`), their build (`scripts/site/`) and
the Playwright tiers with their mock APIs (`e2e/`) work without any of the edits below; each one folds a workaround back
into the repository-wide configuration. None weakens a gate.

### 12a. `vitest.config.ts` and `sonar-project.properties`: the site build's tests join the `tools` project — APPLIED 2026-10-12 (user approved)

The site build's unit tests run today from their own configuration, `scripts/site/vitest.config.ts` (gate `site-unit`,
`npm run test:site`, 90 % per file on all four metrics, reports `reports/junit/site.xml` and `reports/coverage/site/`),
because the root configuration is ask-first and has no project for the Node tooling under `scripts/`. Neither SonarQube
nor the `coverage` gate sees `scripts/site` yet. With §9 approved, the `tools` row measures it too:

```diff
     {
         // JavaScript CLIs, driven as child processes; their logic is TypeScript measured in its own package.
         dir: '.',
         project: { extends: true, test: { name: 'tools', environment: 'node', include: ['scripts/*/test/**/*.test.ts', 'packages/*/scripts/test/**/*.test.ts'] } },
-        coverage: [],
+        // The static site build (scripts/site/src) is product code: it writes the page, its CSP and the served manifest.
+        coverage: ['scripts/site/src/**/*.ts'],
     },
```

```diff
 sonar.sources=packages/shared/src,\
@@
     scripts/ci,\
+    scripts/site/src,\
     scripts/git-hooks,\
@@
 sonar.tests=packages/shared/test,\
@@
     scripts/ci/tests,\
+    scripts/site/test,\
     e2e
```

Follow-ups in the same change: delete `scripts/site/vitest.config.ts`, the `test:site` script and the `site-unit` gate
(with its row in `scripts/ci/tests/test_pipeline.py` and the stage tables), and add `scripts/site/test/**/*.ts` to `TESTS`
in `eslint.config.js` (§12b).

Verify: `PIPELINE_STAGE=tests` (`vitest` lists `tools`; `coverage` measures `scripts/site/src/*.ts` at 100 %).

### 12b. `eslint.config.js`: the product limits for the site build, the test rules for its tests, browser globals for `config.js` — APPLIED 2026-10-12 (user approved; stricter variant, §26)

`scripts/site/src/**` and the e2e servers are linted with the type-checked rule sets but none of `PRODUCT_LIMITS`
(complexity 5, 400 lines, 60 per function) or the Vitest rules; they were written within those limits by hand. A city's
`config.js` has no browser globals, so it writes `globalThis.HistoricCityMapConfig` (the same object as
`window.HistoricCityMapConfig` in a classic script) instead of the form `docs/ENGINE_API.md` shows.

```diff
-const PRODUCT = ['packages/*/src/**/*.ts', 'functions/src/**/*.ts'];
-const TESTS = ['packages/*/test/**/*.ts', 'packages/test-support/src/**/*.ts', 'functions/test/**/*.ts', 'firebase/rules-tests/**/*.ts'];
+const PRODUCT = ['packages/*/src/**/*.ts', 'functions/src/**/*.ts', 'scripts/site/src/**/*.ts', 'scripts/site/build-site.ts'];
+const TESTS = [
+    'packages/*/test/**/*.ts',
+    'packages/test-support/src/**/*.ts',
+    'functions/test/**/*.ts',
+    'firebase/rules-tests/**/*.ts',
+    'scripts/site/test/**/*.ts',
+];
@@
+    {
+        // A city's config.js is a classic script that assigns window.HistoricCityMapConfig (docs/ENGINE_API.md).
+        files: ['sites/*/config.js', 'starter-kit/config.js'],
+        languageOptions: { sourceType: 'script', globals: globals.browser },
+    },
```

`PRODUCT` also brings the browser globals to the site build, which is Node code; it only uses imported Node modules, so
nothing changes in practice. Then `sites/bucharest/config.js` and `starter-kit/config.js` may say `window.` again
(`scripts/site/src/config-js.ts` accepts both).

Verify: `PIPELINE_STAGE=static` (`eslint`).

### 12c. `.github/workflows/ci.yml`: deploy the built site, the public token, e2e tiers in the matrix — APPLIED 2026-10-12 (user approved; variant, §26)

- The Pages artifact path `sites/bucharest/dist` is a placeholder from M0; the site build writes `dist/site/bucharest`.
- The site build reads the URL-restricted public Mapbox token from `MAPBOX_PUBLIC_TOKEN` (forwarded by
  `run-all-checks.sh`). A `pk.` token restricted to `https://ventura8.github.io` is public by design (it is in the served
  manifest), so a repository variable fits; without it the build uses the e2e placeholder and says so.
- `E2E_TIER` is forwarded too: the tour tier (44 projects) is worth its own shards once its specs exist.

```diff
             - name: Build stage
               env:
                   PIPELINE_STAGE: build
+                  MAPBOX_PUBLIC_TOKEN: ${{ vars.MAPBOX_PUBLIC_TOKEN }}
                   HCM_DOCKER_BUILD_FLAGS: ${{ env.LOAD_IMAGE }}
               run: bash scripts/ci/run-all-checks.sh
@@
-            # The Bucharest site (M1/M2: sites/bucharest) is what GitHub Pages serves.
+            # The Bucharest site, built by the site-build gate (scripts/site), is what GitHub Pages serves.
             - name: Upload the GitHub Pages artifact
               if: github.event_name == 'push' && github.ref == 'refs/heads/master' && vars.DEPLOY_ENABLED == 'true'
               uses: actions/upload-pages-artifact@fc324d3547104276b827a68afc52ff2a11cc49c9 # v5.0.0
               with:
-                  path: sites/bucharest/dist
+                  path: dist/site/bucharest
@@
     e2e:
-        name: E2E (Playwright + Firebase Emulators) ${{ matrix.shard }}
+        name: E2E (Playwright, ${{ matrix.tier }}) ${{ matrix.shard }}
@@
             matrix:
-                # Shards as "index/total" (Playwright --shard). Grow the list and the total together.
-                shard: ['1/1']
+                # Tiers of e2e/projects.ts; shards as "index/total" (Playwright --shard) within a tier.
+                include:
+                    - { tier: 'smoke,fn,a11y,nogl', shard: '1/1' }
+                    - { tier: tour, shard: '1/2' }
+                    - { tier: tour, shard: '2/2' }
@@
                   PIPELINE_STAGE: e2e
+                  E2E_TIER: ${{ matrix.tier }}
                   E2E_SHARD: ${{ matrix.shard }}
@@
-                  check_name: E2E Test Report (${{ matrix.shard }})
+                  check_name: E2E Test Report (${{ matrix.tier }} ${{ matrix.shard }})
```

The comment in `.github/actions/quality-image/action.yml` that lists the forwarded variables then names `E2E_TIER` and
`MAPBOX_PUBLIC_TOKEN` too.

Verify: `PIPELINE_STAGE=static` (actionlint, workflow schemas, `workflow-policy`), then one run on GitHub.

### 12d. `.htmlvalidate.json` (§1, change request CR-3): still wanted, for other pages — APPLIED 2026-10-12 (user approved): the pages stay generated (§26)

The site pages stay generated after §1 is approved: their meta CSP comes from the site's manifest and configuration and
their Subresource Integrity from the pinned `mapbox-gl` package, so a committed copy would drift. §1 is still needed for
the admin's entry page (M2) and for the starter kit's committed `index.html` in the template repository (M5). The
generated pages are checked against `.htmlvalidate.json` itself (`scripts/site/test/page.test.ts`), so they keep passing
whatever the gate's configuration becomes.

### 12e. `package.json` `lint:deps`: also cruise the site build — APPLIED 2026-10-12 (user approved)

Together with §3 (which adds `e2e` and `firebase/rules-tests`), add `scripts/site`, so the site build is checked for
cycles and imports that do not resolve:

```diff
-        "lint:deps": "depcruise packages functions --config .dependency-cruiser.cjs",
+        "lint:deps": "depcruise packages functions e2e firebase/rules-tests scripts/site --config .dependency-cruiser.cjs",
```

Verify: `PIPELINE_STAGE=static` (`dependency-cruiser`).

### 12f. `contract` stage: the CDN serves the bytes the page's integrity names — APPLIED 2026-10-12 (user approved)

The page pins `https://api.mapbox.com/mapbox-gl-js/v3.32.0/mapbox-gl.{js,css}` with a `sha384` digest computed from the
npm release `mapbox-gl@3.32.0` (`scripts/site/src/sri.ts`). Mapbox publishes both from one build, but that the CDN bytes
are identical is **unverified**: if they differed, browsers would refuse the script and the site would show nothing. The
first deploy shows it at once; a weekly check in `scripts/ci/check_contracts.py` would keep it true (fetch both files,
compare their digests with the npm files' digests). Not added here: the `contract` stage and its script belong to the CI
tooling, and the check needs the network.

## 13. M1 engine core (engine-core, 2026-10-12) — APPLIED 2026-10-12 (user approved) except 13b

Added by the engine-core workstream (`packages/engine/src/{core,map,telemetry,config}/`,
`packages/test-support/src/fake-map.ts`). Its change requests are CR-8 to CR-11 in `M1-interfaces.md`.

### 13a. `packages/engine/vite.config.ts`: the Firebase SDK in the IIFE build (CR-10) — APPLIED 2026-10-12 (user approved): option 1, no change

The analytics SDK (firebase/app, firebase/analytics, firebase/performance) is behind one dynamic import,
`packages/engine/src/telemetry/firebase-sdk.ts`. It runs only after consent and only with a `measurementId`. Measured in
the quality image on 2026-10-12 with a throwaway library build of `telemetry.ts`:

| Build | What the SDK costs |
| --- | --- |
| ES module (`engine.mjs`) | a separate chunk `firebase-sdk-<hash>.js`, 83.6 KB raw, 23.9 KB gzip, fetched only after consent; telemetry itself is 2.8 KB gzip |
| IIFE (`engine.iife.js`) | inlined: Vite builds IIFE output with `codeSplitting: false`, so the same 24 KB gzip is downloaded with the engine (not evaluated before consent, and served from the city's own origin, so no Google host is contacted) |

The bundle budgets are 125 KB gzip for `engine.iife.js` and 110 KB for `engine.mjs` (`scripts/ci/check_bundle_budget.py`;
the IIFE had 150 KB and the ES module build none when this section was written). Options:

1. **Keep the configuration** (recommended for M1). The city pages load `engine.mjs` (CR-6, which the generated Bucharest
   page already does), so visitors get the lazy chunk. The IIFE stays a fallback for third-party pages and carries the
   SDK. The site build and the release must ship every file of `packages/engine/dist/`, the chunk included.
2. **Drop the IIFE format in v1.** `docs/ENGINE_API.md` documents the IIFE and `window.HistoricCityMap`, so this is a
   contract change that contracts and the integrator decide.
3. **A second build pass for the IIFE** that loads the ES chunk at run time from `engineBase`. This needs a deterministic
   chunk name in the ES build and a format flag that the telemetry loader reads:

```diff
         rolldownOptions: {
             external: ['mapbox-gl'],
             output: {
                 globals: { 'mapbox-gl': 'mapboxgl' },
+                // The lazy analytics chunk keeps a fixed name, so the IIFE build can load it from `engineBase`.
+                chunkFileNames: '[name].mjs',
             },
         },
```

   The second half of option 3 (a `define` per format, which needs two `vite build` runs, and a loader that calls
   `import(new URL('firebase-sdk.mjs', engineBase).href)` in the IIFE) touches `vite.config.ts`, the build script and
   the CSP. Choose it only if the IIFE remains a first-class embed.

Verify: `PIPELINE_STAGE=build`. Both `vite-build` and `bundle-budget` must pass. `packages/engine/dist/` must list the
chunk next to `engine.mjs`.

### 13b. CR-2 follow-up: the adapter against the real `mapbox-gl@3.32.0` — NOT APPLIED: superseded by the e2e tier (§26)

The adapter does not import `mapbox-gl`. It takes the global through the structural type `MapboxGl`
(`packages/engine/src/map/mapbox-types.ts`), and its node tests drive `FakeMapboxGl` from `@hcm/test-support`. Once the
`engine-browser` project of §9 exists:

- add `mapbox-gl@3.32.0` as a devDependency of `@hcm/engine` (the e2e workspace already pins it);
- add a browser test that checks `mapboxgl satisfies MapboxGl` at the type level, and that mounts `createMapboxPort` on
  the real library with a local style that has a `basemap` import and slots. The test then checks `getSlot`,
  `getPaintProperty('raster-opacity')`, `getConfigProperty('basemap', 'show3dObjects')` and one canvas pixel probe.
  This is `design-review-testability.md` §3.2.

Until then, what has not been checked against the real library: the names of the paint, layout and configuration
properties, and the fact that Mapbox GL JS 3.32 reads a `.pmtiles` source URL natively.

Verify: `PIPELINE_STAGE=tests`.

### 13c. `.dependency-cruiser.cjs` §3: engine core already complies — APPLIED 2026-10-12 (user approved)

Only two engine files reach Firebase. `packages/engine/src/telemetry/analytics.ts` imports types from firebase/app,
firebase/analytics and firebase/performance. `packages/engine/src/telemetry/firebase-sdk.ts` imports the functions. No
data SDK is imported. With §3 applied, `engine-firebase-only-in-telemetry` and
`engine-telemetry-only-app-analytics-performance` pass as they are. Firebase 13.0.0 is now a runtime dependency of
`@hcm/engine`, at the version the rules tests already locked (`package-lock.json`: only the dev flags of the firebase tree
changed). This changes a workspace `package.json`, so the next image build reinstalls npm (M0-handoff §3).

### 13d. Information for the viewer page's CSP (e2e-infra, `scripts/site/`) — APPLIED 2026-10-12 (user approved): information

The consent-gated SDKs need these hosts. The meta CSP is static, so they are listed even though nothing is contacted
before consent (scenario V19 proves that with the firewall):

- `script-src https://www.googletagmanager.com`;
- `connect-src https://*.google-analytics.com https://*.analytics.google.com https://firebaseinstallations.googleapis.com
  https://firebaselogging-pa.googleapis.com https://firebaseremoteconfig.googleapis.com`;
- the origin of `analytics.errorEndpoint` (the M2 `telemetry.reportError` function).

The crash reports are POSTed as `text/plain` without credentials, so they need no CORS preflight.

The compare plugin loads from `https://api.mapbox.com/mapbox-gl-js/plugins/mapbox-gl-compare/v0.6.0/`, which the
existing `https://api.mapbox.com/mapbox-gl-js/` source already covers. Setting `script.src` is a Trusted Types sink, so
the report-only `require-trusted-types-for 'script'` policy will report it. A Trusted Types policy for that one constant
URL is the fix, once the policy is enforced.

## 14. `vitest.config.ts`: pre-bundle the browser tests' dependencies (ui-kit, 2026-10-12) — APPLIED 2026-10-12 (user approved; stricter variant, §26)

Added by the M1 ui-kit workstream (`docs/research/M1-interfaces.md` CR-16). On a cold Vite cache (`npm ci` deletes
`node_modules/.vite`, so every CI run is cold) the `ui` browser project discovers dependencies while the tests import
them (`lit/directives/style-map.js`, `lit/directives/repeat.js`, `lit/directives/keyed.js`, `axe-core`), re-optimises
and reloads the page mid-run. Seen locally on 2026-10-12: "Vite unexpectedly reloaded a test", "Failed to fetch
dynamically imported module", "The iframe … did not become ready within 60000ms" and "Multiple versions of Lit loaded"
(there is one Lit in `node_modules`; the reload created a second pre-bundle). A second run on the warm cache passed. Vite
suggests exactly this fix: list the dependencies so they are pre-bundled before the first test.

```diff
     {
         dir: 'packages/ui',
-        project: { extends: true, test: { name: 'ui', include: ['packages/ui/test/**/*.test.ts'], browser: chromium } },
+        project: {
+            extends: true,
+            // Pre-bundle what the browser tests import, so a cold cache (every CI run) never re-optimises and reloads a test.
+            optimizeDeps: {
+                include: [
+                    'lit',
+                    'lit/directives/keyed.js',
+                    'lit/directives/repeat.js',
+                    'lit/directives/style-map.js',
+                    'zod',
+                    '@material/material-color-utilities',
+                    '@hcm/test-support > axe-core',
+                ],
+            },
+            test: { name: 'ui', include: ['packages/ui/test/**/*.test.ts'], browser: chromium },
+        },
         coverage: ['packages/ui/src/**/*.ts'],
     },
```

`@hcm/test-support > axe-core` is Vite's nested-dependency syntax: `@hcm/test-support` pins `axe-core@4.14.0`, while the
root `axe-core` is the 4.13 line that `@axe-core/playwright` brings. A new Lit directive or browser-test dependency joins
the list in the same change. Verify: delete `node_modules/.vite`, then `PIPELINE_STAGE=tests` (no reload warning in
the `vitest` gate's output).

## 15. M1 integration (integrator, 2026-10-12) — APPLIED 2026-10-12 (user approved) except 15c

Added by the M1 integrator (`docs/research/M1-interfaces.md` §12). Each item is an ask-first file; the tree works and
every gate passes without it.

### 15a. `eslint.config.js`: ban Lit's `styleMap` in product code — APPLIED 2026-10-12 (user approved)

The viewer smoke found three kit elements (slider, progress, overlay swatch) whose `styleMap` wrote a `style` attribute
on its first render; the city page's CSP (`style-src` without `'unsafe-inline'`) refused each one and logged a console
error. They now use `cssProperties` (`packages/ui/src/components/css-properties.ts`). This rule keeps `styleMap` out
(a `style=${…}` attribute binding is not caught by it; the e2e console guard still is):

```diff
 const UNSAFE_LIT_DIRECTIVES = {
     patterns: [
         {
             group: ['lit/directives/unsafe-*', 'lit-html/directives/unsafe-*'],
             message: 'unsafeHTML/unsafeSVG/unsafeMathML render strings as markup; data is never HTML (security review §1.7).',
         },
+        {
+            group: ['lit/directives/style-map.js', 'lit-html/directives/style-map.js'],
+            message: "styleMap writes a style attribute the city page's CSP refuses; use cssProperties (packages/ui/src/components/css-properties.ts).",
+        },
     ],
 };
```

With it, §14's `optimizeDeps.include` no longer needs `lit/directives/style-map.js` (add `lit/directives/class-map.js`
instead).

### 15b. `packages/engine/vite.config.ts`: no change proposed (CR-15, CR-21) — APPLIED 2026-10-12 (user approved): no change

Rolldown replaces `import.meta` with `{}` in the IIFE output and warns `EMPTY_IMPORT_META` on every build. A global
`define` would also empty `import.meta.url` in `engine.mjs`, where the engine needs it, and both formats share one
configuration, so the warning stays: the engine falls back to the running script in the IIFE (`engineBaseOf` in
`packages/engine/src/mount.ts`, unit-tested). The kit's fonts are copied by the package's own `fonts:copy` script
(`vite build && npm run fonts:copy`), so `vite.config.ts` needs no plugin for CR-15. Only CR-10 (§13a) remains for
this file (and, from the quality review, the minified ES module build of §17a).

### 15c. The site CSP once the engine comes from jsDelivr (M5) — NOT APPLIED: M5 work by its own text

`font-src 'self'` covers the fonts while Bucharest serves the engine from its own origin. A city that loads the engine
from `cdn.jsdelivr.net` (M5) needs that origin in `font-src` and `script-src`; `scripts/site/src/csp.ts` should add the
engine's origin when `config.js` names an `engineBase` on another host (an e2e-infra change, not ask-first; recorded
here so M5 does not miss it).

## 16. M1 e2e (e2e author, 2026-10-12) — APPLIED 2026-10-12 (user approved)

Added by the M1 e2e author (`docs/research/M1-interfaces.md` §13). The tree works and every gate passes without it.

### 16a. `.github/workflows/ci.yml`: shard the e2e job — APPLIED 2026-10-12 (user approved): supersedes the matrix of §12c

The viewer's e2e tiers now hold about 790 tests (19 minutes for all of them with 16 cores and 8 workers at the M1 final gate): the functional matrix (5 projects, about 7 minutes locally with 16
cores and 8 workers), the tour (44 projects, about 9 minutes), the a11y specials, no-WebGL and the smoke. On a 4-core
GitHub runner (2 workers) one shard would take well over the job's `timeout-minutes: 60`. The pipeline already
forwards `E2E_SHARD` and `playwright.config.ts` reads it, so only the matrix grows:

```diff
             matrix:
                 # Shards as "index/total" (Playwright --shard). Grow the list and the total together.
-                shard: ['1/1']
+                shard: ['1/4', '2/4', '3/4', '4/4']
```

Each shard then uploads its own JUnit report (`E2E Test Report (n/4)`), as the job already names it. A per-tier matrix
(§12c) would also work; sharding keeps one job definition.

## 17. M1 quality review (quality reviewer, 2026-10-12) — APPLIED 2026-10-12 (user approved)

Added by the M1 quality review (coverage, tests, bundle size, dead code, docs). The tree works and every gate passes
without it.

### 17a. `packages/engine/vite.config.ts`: minify the ES module build — APPLIED 2026-10-12 (user approved)

The city pages load `engine.mjs` (CR-6), but Vite's library mode keeps the whitespace of the `es` format, so that its
`/* @__PURE__ */` annotations survive for a bundler downstream: the file is 14,545 lines. Nothing bundles `engine.mjs`
again; it is a page script, served as it is. Measured in the quality image on 2026-10-12 with the same configuration
plus `minify: true` (a throwaway build through Vite's JavaScript API, written to a scratch folder):

| File | Today | Minified |
| --- | --- | --- |
| `engine.mjs` | 409.8 KB raw, 97.9 KB gzip | 343.4 KB raw, 89.9 KB gzip |
| `firebase-sdk-<hash>.js` (after consent) | 83.7 KB raw, 23.9 KB gzip | 69.0 KB raw, 21.7 KB gzip |

The IIFE is minified already; the option changes nothing there. The output still has no `import` of `mapbox-gl`.

```diff
         rolldownOptions: {
             external: ['mapbox-gl'],
             output: {
                 globals: { 'mapbox-gl': 'mapboxgl' },
+                // engine.mjs is a page script that nothing bundles again: minify it like the IIFE.
+                minify: true,
             },
         },
```

In the same change, lower the `engine.mjs` budget in `scripts/ci/check_bundle_budget.py` from 110 to 100 KB (and its
test). `vite.config.ts` is treated as a tool configuration, as CR-10 (§13a) does. Verify: `PIPELINE_STAGE=build`
(`vite-build`, `bundle-budget`, `site-build`), then `PIPELINE_STAGE=e2e` (the city pages load the minified file).

## 18. M1 accessibility and security review (a11y-sec reviewer, 2026-10-12) — APPLIED 2026-10-12 (user approved) except 18b

Added by the M1 review through the accessibility (WCAG 2.2 AA) and security lens. The fixes it could make without an
*Ask first* file are in the tree (`docs/LESSONS.md` #18 to #20); these three need a decision.

### 18a. Firebase Performance Monitoring sends the URL hash, that is the visitor's view — APPLIED 2026-10-12 (user approved): option 1 (§21a)

Not an *Ask first* file: a product decision about a feature the user asked for (PLAN Addendum 2) against the privacy
promise of the consent banner ("Anonymous statistics") and of `analytics.ts` ("never its hash").

- What happens: after consent, every Performance Monitoring batch carries `web_app_info.page_url`, which
  `firebase/performance` 0.7 computes as `location.href.split('?')[0]` (`node_modules/@firebase/performance`,
  `Api.getUrl`). The viewer's address has no query but a hash, so the whole hash goes to Google:
  `#<zoom>/<lat>/<lng>&photo=…`. After *My location* the map centres on the visitor, so the hash is their position to
  about a metre at zoom 17, sent with the Firebase installation id. GA4 is not affected (its `page_location` is set to
  the origin and path), nor are crash reports (`page` is the origin and path, redacted).
- Options:
  1. Drop Performance Monitoring from the public viewer (keep it in the admin, whose URLs hold no visitor position):
     remove `initializePerformance` from `firebase-sdk.ts` and `analytics.ts`, its tests, and the
     `firebaselogging*.googleapis.com` hosts from `scripts/site/src/csp.ts`. Smallest chunk, no leak.
  2. Keep it and say so: the consent text and the privacy notice name "the map position you look at, which after
     *My location* is yours", and the viewer pauses Performance Monitoring (`dataCollectionEnabled = false`) from a
     *My location* until the visitor moves the map elsewhere. More code, a weaker promise.
- Recommendation: option 1 for M1. GA4 events and crash reports already cover the plan's "crashes and analytics";
  page-load timings can come from GA4's own `page_view` timing or a later, hash-free custom trace.
- Verify (option 1): `PIPELINE_STAGE=tests` (the analytics unit tests), `PIPELINE_STAGE=e2e` with
  `S-V19-HAPPY` (no `firebaselogging` request after consent), then `PIPELINE_STAGE=build` (bundle budget).

### 18b. Subresource Integrity for the swipe-compare plugin (M4) — SUPERSEDED 2026-10-24: the user decided on an own swipe compare, no plugin to load (§52a)

`packages/engine/src/map/compare.ts` loads `mapbox-gl-compare` 0.6.0 from `api.mapbox.com` with `crossorigin` but no
`integrity`, while the page loads Mapbox GL JS itself with one. Nothing calls it before V06 (M4). When V06 lands, give
the script and stylesheet the sha384 of the pinned release (as `scripts/site/src/sri.ts` does for mapbox-gl) and add
both to the `contract` stage's CDN check (§12f). Verify: `PIPELINE_STAGE=contract`, then the V06 e2e rows.

### 18c. Withdrawing consent leaves GA4's cookies in place — APPLIED 2026-10-12 (user approved) (§21a)

After *Accept*, gtag.js writes the first-party cookies `_ga` and `_ga_<container>` (two years). Withdrawing in About
sets Consent Mode back to denied and turns collection off, so nothing reads or sends them any more, but they stay in
the browser, while the privacy notice says that without consent the map "uses no cookies". Proposal: on withdrawal,
`telemetry/analytics.ts` expires every `_ga` and `_ga_*` cookie for the page's host and each parent domain gtag may
have used (`Max-Age=0; Path=/; Domain=<host and parents>`), with a unit test and an `S-V19-BAD-WITHDRAWN` assertion that
`document.cookie` holds no `_ga` afterwards (the stand-in gtag in `e2e/mock-apis/gtag.ts` must then write one). Not
applied by the review: it changes what withdrawal does, which the plan only describes as "can be withdrawn in About".

## 19. M2 backend contracts (contracts agent, 2026-10-12) — APPLIED 2026-10-12 (user approved)

Added by the M2 contracts agent before the parallel backend build (`docs/research/M2-interfaces.md`). The tree works and
every gate passes without them.

### 19a. `.dependency-cruiser.cjs`: keep the function handlers pure and the feature folders independent — APPLIED 2026-10-12 (user approved)

The M2 workstreams build `functions/src/{admin,history,telemetry}`, `functions/src/setup` and
`functions/src/{photos,publish,ops}` in parallel against the ports and the shared registry (M2-interfaces §5, CR-M2-3).
Two rules make that layering a gate instead of a convention:

```diff
         {
             name: 'only-the-map-adapter-imports-mapbox',
             ...
         },
+        {
+            name: 'functions-sdks-only-in-adapters',
+            severity: 'error',
+            comment: 'Handlers and the callable plumbing reach Firestore, Auth, Google APIs and sharp only through functions/src/ports (adapters and the composition root import the SDKs), so every handler is tested with fakes.',
+            from: { path: '^functions/src/', pathNot: ['^functions/src/adapters/', '^functions/src/deps\\.ts$'] },
+            to: { path: 'node_modules/(firebase-admin|google-auth-library|sharp)/' },
+        },
+        {
+            name: 'functions-feature-folders-independent',
+            severity: 'error',
+            comment: 'A feature folder reaches another only through ports/, api/ and @hcm/shared (M2-interfaces §1, §5), so the three workstreams never edit or break each other.',
+            from: { path: '^functions/src/(admin|history|telemetry|setup|photos|publish|ops)/' },
+            to: { path: '^functions/src/(admin|history|telemetry|setup|photos|publish|ops)/', pathNot: '^functions/src/$1/' },
+        },
```

Today's tree already complies (`deps.ts` and `adapters/` are the only importers of `firebase-admin` and
`google-auth-library`; no feature folder exists yet). Verify: `PIPELINE_STAGE=static` (`dependency-cruiser`).

### 19b. Where `ops.tick` runs: `fn-admin@` instead of widening `fn-events@` — APPLIED 2026-10-12 (user approved): option 1

Not a file: a choice for the IAM item of the Provision cloud doctor (a cloud project change, so ask first). `ops.tick`
deletes retired Mapbox public tokens and checks the Mapbox token daily, which needs `mapbox-sk-bootstrap` (security
review §1.2 gives it to `fn-admin@` only), and deletes stale Auth accounts, which needs `roles/firebaseauth.admin`
(also `fn-admin@` only).

1. **Recommended**: run `ops.tick` as `fn-admin@` (`serviceAccount` on the scheduled function). `fn-admin@` already
   holds every role the tick needs (Firestore, both buckets, the secrets, Auth, the task queue); `fn-events@` keeps the
   Firestore and Storage triggers. No role is added anywhere.
2. Grant `fn-events@` `secretAccessor` on `mapbox-sk-bootstrap` and `roles/firebaseauth.admin`. The most sensitive
   secret would then be readable by the account every trigger runs as.

Verify: the integrator sets `serviceAccount` per family in `functions/src/global-options.ts`; `setup.selfTest` and the
first `ops.tick` after deploy report every check `ok`.

## 20. M2 photos, publishing and the scheduler (fn-content, 2026-10-12) — APPLIED 2026-10-12 (user approved)

Two choices fn-content made where the plan and the M2 contract assumed something the runtime cannot do, or would cost
more than it gives. The code works either way; each needs a yes or a different answer.

### 20a. An unpublished photo keeps its public files — APPLIED 2026-10-12 (user approved): option 1, as built

The contract (`M2-interfaces.md` §3.7, `UNPUBLISH_DELETE_MINUTES`) says the public derivatives of an unpublished photo
are deleted 10 minutes after the manifest stops naming them. Built instead (`functions/src/ops/manifests.ts`): the
nightly sweep deletes only the public files that no photo document and no served manifest names (a replaced image, a
deleted photo), once they are older than 10 minutes and the last build is older than 10 minutes.

1. **Recommended (built)**: unpublishing hides a photo (it leaves the manifest at once); deleting the photo removes its
   files at the next nightly sweep. The admin keeps its thumbnails, and publishing again needs no reprocessing. The
   files' addresses are content-hashed (`photos/{city}/{photo}/{sha8}/…`), so nobody finds an unpublished photo
   without having seen it published.
2. Delete the files of unpublished photos too. Publishing again then needs `photos.reprocess` (the original is kept
   privately), the photo is out of the manifest until it finishes, and the admin must load its own thumbnails of
   unpublished photos from the private bucket.

For a takedown (a rights holder asks), the admin deletes the photo; with 1 its files are gone within a day, at once with
2. Verify: `functions/test/ops/manifests.test.ts`.

### 20b. HEIC photos are refused with a message, not converted — APPLIED 2026-10-12 (user approved): option 1, as built

The security review (§1.7) and `firebase/storage.rules` say HEIC is converted on the server. sharp's prebuilt libvips
decodes AVIF only (`sharp.format.heif.input.fileSuffix` is `['.avif']`), and HEVC decoding is patent-encumbered.
Built: `photos.onUpload` recognises HEIC and HEIF by their magic numbers and sets `processing: 'failed'` with an error
code (change request CR-M2-30 asks for `apiError.photo.heicUnsupported`, which tells the admin how to export a JPEG).

1. **Recommended (built)** for M2: refuse with the message; iPhones export JPEG when set to "Most Compatible".
2. Later: decode HEVC in the function with a WebAssembly libheif build (`libheif-js`, LGPL, about 2 MB): a new pinned
   dependency, its licence reviewed, the 2 GiB memory checked on a 48 MP photo.
3. Later: convert in the admin's browser before the upload. Chromium cannot decode HEIC either, so this needs the same
   WebAssembly decoder in the admin bundle.

Verify: `functions/test/photos/upload.test.ts` (`badPath_an HEIC photo (not decodable here)`).

## 21. M2 viewer fixes (viewer workstream, 2026-10-12) — APPLIED 2026-10-12 (user approved)

Added by the viewer workstream, which fixed the open viewer issues of the M1 reviews (`docs/research/M0-handoff.md`
§10m and §10o). No *Ask first* file was edited; the tree passes its targeted gates without the items below.

### 21a. §18a and §18c are applied in the viewer — APPLIED 2026-10-12 (user approved)

- §18a, option 1: the public viewer no longer loads Performance Monitoring (`packages/engine/src/telemetry/analytics.ts`,
  `firebase-sdk.ts`); its Firebase app is always the named app `hcm-viewer`. GA4 also gets `page_path`, `page_location`
  on every event, and Google signals and ad personalisation off. Left for another owner: the site CSP still allows the
  `firebaselogging` hosts (change request CR-M2-36 in `M2-interfaces.md`).
- §18c, as proposed, with two limits: only a withdrawal (granted, then denied, with analytics configured) expires the
  cookies, so a first *Decline* never touches an embedding page's own `_ga`; and GA4 starts with the consent as it is
  when its chunk arrives, so a withdrawal during the load never grants it (`packages/engine/src/telemetry/cookies.ts`).
- Verify: `npx vitest run --project engine packages/engine/test/telemetry` in the image, then the e2e rows
  `S-V19-HAPPY`, `S-V19-BAD-HASH-NEVER-SENT`, `S-V19-HAPPY-COOKIES-EXPIRED`, `S-V19-BAD-DECLINE-KEEPS-PAGE-COOKIES`.

### 21b. GA4's history-change page views: off in the stream (CR-M2-37) — APPLIED 2026-10-12 (user approved): option 1, in the provisioner

gtag.js's enhanced measurement can send a `page_view` on every `history.replaceState`, with the new `location.href` as
its page location: the viewer rewrites its hash, the visitor's view, on every move. The viewer cannot switch this off
from the page (only `send_page_view` for the first view), so the GA4 web stream must have *Page changes based on browser
history events* off.

1. **Recommended**: the provisioner sets `enhancedMeasurementSettings.pageChangesEnabled = false` through the Analytics
   Admin API when it creates or detects the stream, and the card shows it checked (CR-M2-37).
2. Or the admin guide tells the owner to switch it off by hand (written in both guides meanwhile).

Verify: a provisioning unit test against the Analytics Admin fake; the viewer side is `S-V19-BAD-HASH-NEVER-SENT`.

### 21c. The Mapbox legal bar while a modal surface covers the map — APPLIED 2026-10-12 (user approved): option 1, as built

Not *Ask first*; recorded because it changes what visitors see. Mapbox's terms need the logo and the attribution visible.
While a modal sheet, the lightbox or About covers the map, the viewer hides Mapbox's own and shows a copy: a 48 px bar
at the bottom of the viewer (the sheets, their scrim and the lightbox end above it) or the foot of About. The text is
read from Mapbox's control, so it is always what the map credits.

1. **Built**: the bar and the About foot (scenarios `S-V18-HAPPY-MODAL-STATES`, `S-V18-BAD-FULL-SHEET`).
2. Alternative: move Mapbox's own controls above the sheet's top edge as it moves (what the native SDKs do with
   `logoMargins`). The modal frame is `inert`, so they would be visible but neither focusable nor clickable, and a
   draggable sheet would need its height reported to the viewer on every frame.

## 22. M2 integration (integrator, 2026-10-12) — APPLIED 2026-10-12 (user approved)

Added by the M2 integrator, who wired the backend workstreams into one deploy (`docs/research/M2-interfaces.md` →
*Addendum A*). No *Ask first* file was edited; the tree passes every stage without the items below. §19a (layering
rules for `functions/`) is still open; the code follows it (feature folders share helpers only through
`functions/src/api/` and names through `@hcm/shared`).

### 22a. Where the deploy-time configuration of the functions lives — APPLIED 2026-10-12 (user approved; variant, §26)

`functions/src/deps.ts` reads `HCM_OAUTH_CLIENT_IDS` (the web client of the Google sign-in provider, which
`admin.claim` checks the access token against), `HCM_VIEWER_ORIGINS` (default `https://ventura8.github.io`) and
`HCM_APP_CHECK` (`monitor` until a week after the admin ships reCAPTCHA Enterprise). Nothing sets them at deploy yet:
until it does, `admin.claim` refuses every token with `apiError.claim.tokenMismatch`. All three are public values.

1. **Recommended**: `functions/.env.bucurestiul-disparut` (committed, non-secret, the Firebase convention) holding the
   three values, copied into `functions/dist/` by `functions/build.mjs` next to `package.json`; the OAuth client id is
   filled in once the Setup Assistant has created the sign-in provider. A test of the build checks that the file holds
   only `HCM_*` keys.
2. Firebase params (`defineList`, `defineString`) declared in `global-options.ts`: firebase-tools prompts for them at
   the first deploy and stores them in the same `.env` file, so the result is the same with a prompt in between.

Verify: `PIPELINE_STAGE=build` (the build copies and checks the file), then after the first deploy `setup.selfTest`
and an owner claim in the admin.

### 22b. A lockfile for `functions/dist/` — APPLIED 2026-10-12 (user approved; stricter variant, §26)

`functions/dist/package.json` pins the four direct dependencies exactly; Cloud Build resolves their transitive
versions at deploy time, so two deploys of the same commit can run different code. Generating a lockfile needs the
registry's metadata, which the offline npm cache of the quality image does not hold (`npm install --package-lock-only
--offline` answers `ENOTCACHED`), so it is a download (*Ask first*).

1. **Recommended**: generate `functions/deploy-lock/package-lock.json` once with the network in the digest-pinned
   `node:24-bookworm-slim` image, commit it, and let `functions/build.mjs` copy it into `functions/dist/` after checking
   that its root dependencies equal `functions/package.json`'s; refresh it with every bump of those four.
2. Keep resolving at deploy time (today).

Verify: `PIPELINE_STAGE=build`; `firebase deploy --only functions` (ask first) installs with `npm ci`.

### 22c. sharp at every cold start — APPLIED 2026-10-12 (user approved; stricter variant, §26)

The 32 functions are one codebase, so every instance loads `functions/dist/index.js`, which imports `sharp` (its native
libvips) at module load, although only `photos.onUpload` uses it.

1. **Recommended**: `functions/src/adapters/image.ts` imports sharp lazily (`await import('sharp')` inside `inspect`
   and `webp`), so the other 31 functions never load libvips; no other file changes.
2. A second codebase for the photo functions (`firebase.json` `functions[]`), with its own build: more moving parts.
3. Keep it (measure the cold start after the first deploy first).

Verify: `PIPELINE_STAGE=tests` (the adapter's tests on real sharp), then the cold-start time of `admin-session` in
Cloud Logging after a deploy.

### 22d. Information: what the integration decided without asking — APPLIED 2026-10-12 (user approved): information

- **Service accounts**: §19b option 1 is in the code: `ops.tick` and `ops.onBudget` run as `fn-admin@`
  (`RUNTIME_ACCOUNTS` in `functions/src/global-options.ts`); option 2 is a one-line change there plus the grants.
  The accounts and their roles are created by the provisioner (CR-M2-5); a deploy before they exist fails.
- **Hosting**: `firebase.json` names the site `bucurestiul-disparut` and frames only its two auth domains, Google
  sign-in and reCAPTCHA; `.firebaserc` gained `default: bucurestiul-disparut` beside `e2e: demo-hcm`. Every test and
  emulator run names `--project demo-hcm`, and a test fails if an npm script starts the emulators without it.
- **Emulators**: Pub/Sub (8085) and Cloud Tasks (9499) joined `firebase.json`, so the Functions emulator loads all 32
  functions (`ops.*` need Pub/Sub, `publish.buildManifest` its queue).
- **Contract change requests applied by the integrator** (contracts had finished): CR-M2-11 (a), CR-M2-15 (b–d),
  CR-M2-16, CR-M2-23, CR-M2-30, CR-M2-31 (a–e), with the shared names `FIRESTORE_PATHS.cities` and
  `DERIVATIVE_WRITTEN_AT` and the helpers in `functions/src/api/objects.ts`; CR-M2-15 (a) waits for its first user, the
  M3 publisher.

## 23. M2b admin contracts (contracts agent, 2026-10-12) — APPLIED 2026-10-12 (user approved) except 23b and 23c

Added by the M2b contracts agent, alone in the tree before the admin workstreams start
(`docs/research/M2b-interfaces.md`). No *Ask first* file was edited; the tree passes `PIPELINE_STAGE=static` without
the items below.

### 23a. `.dependency-cruiser.cjs`: the admin's layering — APPLIED 2026-10-12 (user approved)

M2b-interfaces §1.7: `packages/admin` holds DOM-free logic tested in Node, the Lit elements live in
`packages/ui/src/admin/`, only the Firebase adapters and the entry touch the Firebase JS SDK, and the Google REST
clients use `fetch`. Three rules make that a gate (CR-M2b-7):

```diff
+        {
+            name: 'admin-firebase-sdk-only-in-adapters',
+            severity: 'error',
+            comment: 'The admin logic is tested in Node with fakes of its ports: only its Firebase adapters and its entry import the Firebase JS SDK (M2b-interfaces §1.7); the Google REST clients use fetch.',
+            from: { path: '^packages/admin/src/', pathNot: ['^packages/admin/src/firebase/', '^packages/admin/src/index\\.ts$'] },
+            to: { path: 'node_modules/(firebase|@firebase)/' },
+        },
+        {
+            name: 'admin-logic-without-lit',
+            severity: 'error',
+            comment: 'Admin elements live in packages/ui/src/admin; packages/admin is logic only (its entry registers the elements through @hcm/ui/admin).',
+            from: { path: '^packages/admin/src/' },
+            to: { path: 'node_modules/(lit|lit-html|@lit)/' },
+        },
+        {
+            name: 'viewer-never-loads-admin-elements',
+            severity: 'error',
+            comment: 'The engine and the viewer elements never import the admin elements, so no admin code or text reaches the public bundle.',
+            from: { path: ['^packages/engine/', '^packages/ui/src/(viewer|components|layout|theme|fonts)/'] },
+            to: { path: '^packages/ui/src/admin/' },
+        },
```

Today's tree already complies (no admin element, no Firebase import in `packages/admin`). Verify:
`PIPELINE_STAGE=static` (`dependency-cruiser`).

### 23b. `.github/workflows/ci.yml`: build the admin and write its runtime file before the Hosting deploy — NOT APPLIED: the runtime writer does not exist and the Hosting predeploy would erase its file (§26)

The `deploy-firebase` job deploys Hosting from `packages/admin/dist`, but no step of that job builds the admin (the
`build` job's output is not passed on, and `firebase.json` has no Hosting `predeploy`). The admin also needs the App
Check site key, which the Provision cloud step creates in the browser (M2b-interfaces §1.4, §3.4 item `app-check`).
Proposal (CR-M2b-6): before `firebase deploy`, in the image, build the admin and write `packages/admin/dist/runtime.json`
= `{release: <commit>, appCheckSiteKey}`, the key read with the deployer's credentials from Firebase App Check
(`GET https://firebaseappcheck.googleapis.com/v1/projects/<number>/apps/<appId>/recaptchaEnterpriseConfig`; absent:
no key, the admin runs without App Check):

```diff
             - name: firebase deploy
               env:
                   GCP_PROJECT_ID: ${{ vars.GCP_PROJECT_ID }}
               run: |
                   in_image=(docker run --rm --user "$(id -u):$(id -g)" --env HOME=/tmp --env GOOGLE_APPLICATION_CREDENTIALS
                       --volume "$PWD:$PWD" --workdir "$PWD" "$HCM_IMAGE")
                   "${in_image[@]}" npm ci --prefer-offline --no-audit --no-fund
+                  "${in_image[@]}" npm run build:admin
+                  "${in_image[@]}" npm run admin:runtime -- --project "$GCP_PROJECT_ID" --release "$GITHUB_SHA"
                   "${in_image[@]}" npx firebase deploy --non-interactive --project "$GCP_PROJECT_ID" \
                       --only firestore,storage,functions,hosting
```

`build:admin` and `admin:runtime` are root scripts (the integrator adds them) over the admin target of `scripts/site/`
(the admin-e2e workstream). **UNVERIFIED**: that `roles/firebase.viewer` (which `gh-deployer@` holds) reads the reCAPTCHA
Enterprise configuration; otherwise the provisioner adds `roles/firebaseappcheck.viewer`. Verify: `PIPELINE_STAGE=static`
(actionlint, the workflow policy), then the first deploy and the admin's App Check token in the network log.

### 23c. `.github/workflows/ci.yml`: callables under domain-restricted sharing — NOT APPLIED: needs a deploy-time script and a project with the policy to verify (§26)

When an organisation policy (`iam.allowedPolicyMemberDomains`) refuses `allUsers`, firebase-tools cannot make the
callables public and the admin's probe never gets an answer (M2b-interfaces §3.3 d, §3.4.2). Proposal (CR-M2b-6): a
step after `firebase deploy`, only when the repository variable `HCM_NO_INVOKER_IAM_CHECK` is `true` (Claude sets it,
with the user's yes, when the doctor reported the policy), that sets `invokerIamDisabled: true` on the Cloud Run
service of every callable and of `telemetry-reportError` (Cloud Run Admin v2 `PATCH services/<name>?updateMask=invokerIamDisabled`,
the REST form of `gcloud run services update --no-invoker-iam-check`; security review §1.8). Verify: actionlint; a
deploy into a project with that policy.

### 23d. Information: the legacy import uploads the originals, not the seed derivatives — APPLIED 2026-10-12 (user approved): information

The brief said the import bundles "the 45 migrated photos + derivatives". Contract (M2b-interfaces §3.3 h): the admin
build bundles the migrated records and the **originals** of `seed/bucharest/photos/`, and the import uploads each
original through the normal photo pipeline. Why: `photos.onUpload` makes the 2048 px and 400 px WebP files from what it
receives, so a 1600 px seed derivative would become an upscaled public image; the original is kept privately for the
rights review; the seed derivatives keep serving the static viewer and the e2e fixture. Cost: 46 MB in the Hosting
release (fetched only by an import). The imported photos are published once processed, as the static site shows them
today, with `rightsReview: true` kept. Say so if derivatives should be uploaded instead.

### 23e. Information: the budget's amount in the billing account's currency — APPLIED 2026-10-12 (user approved): information

The Budget API takes the amount in the billing account's own currency (a Romanian account may bill in RON). Contract
(`BUDGET_AMOUNTS`, setup-ui): USD 5, EUR 5, GBP 4, RON 25, any other currency 5 units; the card shows the amount and the
currency before the click, and Settings may change it later.

### 23f. The admin's icons: a subset of their own (not *Ask first*; for review) — APPLIED 2026-10-12 (user approved): superseded by §24a

The admin needs about 17 Material Symbols the viewer never shows (M2b-interfaces §1.6). Adding them to `UI_ICONS` grows
the one icon font every visitor downloads (11 KB today). Recommended: a second subset,
`packages/ui/fonts/material-symbols-rounded-admin.woff2`, built by the same `build-fonts.mjs` from an `ADMIN_ICONS`
list and registered only by the admin; the alternative is one shared subset. The admin-shell workstream implements the
chosen one.

### 23g. Information: the GitHub environment in the Workload Identity condition — APPLIED 2026-10-12 (user approved): information

Security review §2 wrote the provider's condition with `assertion.environment=='production'`; `ci.yml`'s deploy jobs
declare `environment: deploy`. The provisioner writes `'deploy'` (from `infra/project.json`), so the condition matches
the workflow; the GitHub environment `deploy` must stay restricted to `master`.

## 24. M2b admin shell (admin-shell, 2026-10-12) — APPLIED 2026-10-12 (user approved)

Added by the admin-shell workstream (`docs/research/M2b-interfaces.md` §1, §2; its change requests CR-M2b-26 to
CR-M2b-31). No *Ask first* file was edited.

### 24a. Information: the admin's icons stay in the one subset (§23f) — APPLIED 2026-10-12 (user approved): one subset, as built

The 17 icons of M2b-interfaces §1.6 joined `UI_ICONS`, so the one icon font grew from 11,456 to 13,448 bytes. The second
subset §23f recommends was not built: two faces of one family cannot share ligatures (the browser picks a face per
character by `unicode-range`, never per ligature), so it needs a superset file registered only by the admin, a second
build target in `packages/ui/scripts/build-fonts.mjs` and an option of `installFonts`. Say so if the visitors' 2 KB are
worth that; the change stays inside `packages/ui`.

### 24b. Information: `esnext.temporal` in the admin's tsconfigs — APPLIED 2026-10-12 (user approved): information

`firebase/firestore` 13.0.0's declarations name `Temporal.Instant` (`Timestamp.fromInstant`), and `skipLibCheck` is off,
so `tsc` fails in any project that imports Firestore without the Temporal declarations. `packages/admin/tsconfig.json`
and `packages/admin/test/tsconfig.json` add `esnext.temporal` to `lib`; `tsconfig.base.json` is unchanged, so no other
package gains the global.

### 24c. Information: what the admin keeps in `localStorage` — APPLIED 2026-10-12 (user approved): information

M2b-interfaces §1.7 said `localStorage` holds the language only. The admin also keeps the theme (`hcm:admin:theme`)
and the answer to its analytics consent (`hcm:admin:consent`): PLAN Addendum 2 stores the decision, and a theme that
reset on every visit would be a regression of the viewer's behaviour. Neither is a token, an address or a secret.

## 25. M2b integration (integrator, 2026-10-12) — APPLIED 2026-10-12 (user approved) except 25c and 25d

Added by the integrator while wiring the admin end to end (`docs/research/M2b-interfaces.md` Addendum A). No *Ask
first* file was edited.

### 25a. Decision to confirm: the bundled city is created published — APPLIED 2026-10-12 (user approved): created published

`setup.createCity` writes `published: true`. The old site shows Bucharest publicly today, and the legacy import
publishes its 45 photos "as the static site shows them" (M2b-interfaces §3.3 h): an unpublished city would publish
them into nothing. Nothing reaches the public bucket before Mapbox is set (the builder keeps no manifest without the
viewer token), and the Bucharest page keeps reading its committed seed until its `config.js` points at the bucket's
manifest. Say so if the first city should start unpublished, to be published from Settings (M2c) instead.

### 25b. Information: the Functions emulator is composed differently in three places — APPLIED 2026-10-12 (user approved): information

Measured in the admin tier: the emulator runs every function in its own process, so in-memory secrets were invisible
to the next function; the Cloud Tasks emulator dispatches a task at once and keeps refusing its id, which swallowed a
debounce window's later requests; the Admin SDK waited about 14 s for the absent metadata server on every enqueue.
`functions/src/deps.ts` therefore, in the emulator only, keeps secrets in the fake Secret Manager when fakes are
configured, enqueues manifest tasks without an id, and names the task queue's service account. Deployed behaviour is
unchanged.

### 25c. Proposal: the USGS approval reaches an open page — NOT APPLIED: an admin feature with its own scenario rows, not a config edit (§26)

The page reads `setup/status` when it opens and on Check again; the approval that `ops.tick` records every six hours
shows after a reload. An admin with the page open could see it sooner if the Setup page listened to `setup/status`
(admins may read it) while USGS is pending. Not built; one listener, no new callable.

### 25d. Proposal: a scheduled tick the e2e tier can trigger — NOT APPLIED: not needed while the emulators start fresh, by its own text

The emulator cannot run a v2 scheduled function from its Pub/Sub topic, so the e2e world posts to the function's
trigger route, whose key carries the emulator's trigger generation (`-0` on a fresh start). An `ops.runTick` admin
callable (or a test-only HTTPS endpoint in the emulator) would remove that coupling; neither is needed while the
emulators start fresh for each run, as in CI.

### 25e. Information: the claim no longer needs `HCM_OAUTH_CLIENT_IDS` (§22a) — APPLIED 2026-10-12 (user approved): information

`admin.claim` used to refuse every token while `HCM_OAUTH_CLIENT_IDS` was unset, which nothing sets yet, so the first
real claim would have failed. When the variable is empty the function now reads the project's Google sign-in client from
Identity Toolkit (`GET identitytoolkit.googleapis.com/admin/v2/projects/{id}/defaultSupportedIdpConfigs/google.com`,
`fn-admin@` holds `roles/firebaseauth.admin`) and accepts tokens issued to it; the variable still wins when set. The
answer also carries the provider's client secret, which the adapter never reads, keeps or logs. §22a's carrier for the
variable is no longer on the critical path.

## 26. Applied on 2026-10-12 (user approved)

The user approved §1 to §25 on 2026-10-12; the orchestrator relayed the decision to the agent that applied them. Where a
later section superseded an earlier one the later was applied; where two readings differed the stricter was taken.
Verified with `PIPELINE_STAGE=quality`, then the default `all` (the `sonar` stage skips without a token).

| Section | Outcome | How |
| --- | --- | --- |
| §1 | applied | `.htmlvalidate.json` extends `html-validate:prettier` |
| §2 | applied, stricter | `eslint-plugin-playwright@2.12.1`; `TEST_LIMITS` shared by Vitest tests and `e2e/`; `playwright/expect-expect` as an error that counts helpers named `expect…`; the recommended rules' warnings fail too (`--max-warnings 0`), so seven specs were reworked: window-class branches moved into `isDocked`, `closeModalSheet` and `manifestIssues` (`e2e/support/viewer.ts`), web-first assertions, and the admin journey split into one function per step |
| §3, §12e, §13c | applied, stricter | the three Firebase rules; the telemetry rule allows `firebase/app` and `firebase/analytics` only (Performance Monitoring left the viewer in §21a), renamed `engine-telemetry-only-app-and-analytics`; `lint:deps` cruises `e2e`, `firebase/rules-tests` and `scripts/site`; `dependency-cruiser` bumped to 18.6.0 in the same `package.json` change, as §3 suggested |
| §4a–§4e | applied | `ci.yml`, `deps.yml`, `release.yml` as written; the comment of `.github/actions/quality-image/action.yml` names every forwarded variable |
| §5, §12a | applied | `sonar.sources` gains `scripts/site/src` and `.github/actions`; `sonar.tests` gains `scripts/site/test` and the CLIs' new test folders; their tsconfigs join `sonar.typescript.tsconfigPaths` |
| §6a | applied | `.gitleaksignore` with the one fingerprint, checked: `gitleaks git --log-opts="origin/master..HEAD"` reports no leak |
| §6b | applied, stricter | the header reworded, and the stricter option taken: `gitleaks-history` reads `.gitleaks-history.toml`, which has no path allowlist at all (the branch range is clean with it) |
| §7 | applied, stricter | `ruff.toml` allows `N802` only (the stubs' parameter names are lower case, so `N803` is not needed) for `pipeline/typings/**/*.pyi`, and the follow-up was done: the GDAL stubs are positional-only `def`s |
| §8 | applied | kept as recommended (no change) |
| §9, §11 | applied | `engine-browser` (with `packages/engine/test/browser/adapter-env.test.ts`: frames, ResizeObserver, the sprite canvas, font loading and the WebGL 2 probe on a real Chromium, no map) and `tools` projects; the CLI tests moved to `scripts/seed/test` (now on the real `scripts/seed/bucharest.city.json`) and `packages/ui/scripts/test`, each with a tsconfig in the root solution; viewer components stay in `packages/ui` (§11's move remains optional) |
| §10 | applied | the derivatives and the manifest stay committed |
| §12a | applied | `scripts/site/vitest.config.ts`, `test:site` and the `site-unit` gate are gone; the `tools` project measures `scripts/site/src` |
| §12b | applied, stricter | `PRODUCT` also covers `scripts/site/build-admin.ts` (written after §12b); two functions above complexity 5 were split (`buildAdminSite`, `globToRegExp`); `config.js` uses the documented `window.` form again |
| §12c | applied as superseded | the public token and the Pages path as written; the per-tier matrix gave way to §16a's four shards, so `E2E_TIER` stays unset in CI |
| §12d | applied | see *Generated pages* below |
| §12f | applied | the `contract` stage GETs `mapbox-gl.js` and `mapbox-gl.css` from the CDN and compares their `sha384` with the installed npm release (`scripts/ci/check_contracts.py`, probes `mapbox.integrity.*`); a missing or other npm version exits 2 |
| §13a, §15b | applied | option 1, no `vite.config.ts` change for them |
| §13b | not applied | the e2e tier already runs the adapter on the real `mapbox-gl@3.32.0` (served from the npm package by the mock CDN, behind the firewall), which checks the property names and the `.pmtiles` source §13b listed; a Vitest browser test of a real `Map` would post a billed map load to `events.mapbox.com`, as the browser project has no firewall |
| §14 | applied, stricter | `BROWSER_TEST_DEPS` for both browser projects, as §15a asked without `style-map.js` and with `class-map.js`, plus `lit/directive.js`, which the kit imports |
| §15a | applied | `styleMap` imports refused |
| §15c, §18b | not applied | M5 and M4 work by their own text |
| §16a | applied | four shards over every tier |
| §17a | applied | `engine.mjs` minified: 92.7 KB gzip (101.0 before); budget 100 KB |
| §18a, §18c, §19b, §20a, §20b, §21a–§21c, §24a, §25a | applied | confirmed as built |
| §19a, §23a | applied | the five layering rules; the tree complies |
| §22a | applied, variant | a committed `functions/.env.<project>` is refused by the `repo-policy` gate, the pre-commit hook and `.gitignore` (secret-file names), and relaxing that rule needs the user, so the carrier is `functions/deploy-env.json`: `functions/build.mjs` writes `functions/dist/.env.<project>` from it (one-line `HCM_*` values only) and `functions/test/deploy-env.test.ts` holds it to the keys `runtimeConfig` reads. `bucurestiul-disparut` sets `HCM_OAUTH_CLIENT_IDS` to the project's auto-created Google web client (a public id the orchestrator read from the Cloud console), `HCM_VIEWER_ORIGINS` and `HCM_APP_CHECK=monitor` |
| §22b | applied, stricter | `functions/deploy-lock/` (the artifact's `package.json`, with the root's advisory overrides, and its lockfile, generated once with the network in the pinned Node image by `npm run deploy-lock --workspace @hcm/functions`); the build refuses a stale lock and copies it into `functions/dist/`; a new static gate, `deploy-lock-audit`, audits it |
| §22c | applied, stricter | sharp is imported on the first photo; the build's import check also reads dynamic imports |
| §23b | not applied | no `admin:runtime` writer exists, and `firebase.json`'s Hosting `predeploy` runs `build:admin`, whose Vite build empties `packages/admin/dist`, so a `runtime.json` written before `firebase deploy` would be erased. Redesign for the deploy milestone: `scripts/site/build-admin.ts` writes `runtime.json` from environment values (the release, the App Check site key read by a workflow step with the deployer's token), so the predeploy itself produces it |
| §23c | not applied | it needs a deploy-time script that lists the callables and patches their Cloud Run services, which only a project under the organisation policy can verify, and the repository variable it reads is a cloud-side change for the user |
| §25c | not applied | an admin feature (a Firestore listener on `setup/status` while USGS is pending, with its happy and bad scenario rows), not a configuration edit; left for the next admin task |
| §25d | not applied | by its own text, not needed while the emulators start fresh for each run |

### Generated pages (the question §12d left open)

With `html-validate:prettier` in place a committed `.html` file can pass `prettier`, `htmlhint` and `html-validate`. The
site and admin pages still stay generated: their meta CSP is computed from each city's manifest and configuration and
their Subresource Integrity from the pinned `mapbox-gl` release, so a committed copy would drift, and a committed
template with placeholders would need its own substitution step, more code than `scripts/site/src/page.ts`. They are
fully gated where they are made: the `tools` project checks every generated page against `.htmlvalidate.json` with the
html-validate library, and the e2e tier loads them behind its console guard. The first committed `.html` file (the
starter kit's template repository, M5) is linted as it is.

### Found while applying

- `knip` did not look at `scripts/site/`: once it did (`knip.json`, a pre-approved stricter scope), it found 13 exports
  used only inside their own module and `zod` imported without a declaration; the exports are module-private now and
  `zod` is a root devDependency at the version `@hcm/shared` pins.
- Vitest's `expect(value, message)` form fails `vitest/valid-expect`; the site build's CLI test asserts the whole result
  with `toMatchObject`, whose diff shows stderr.
- With the site build's tests in the shared run, one admin-build test passed 5 s on a busy machine: the `tools`
  project gives each test 30 s. Two browser projects sharing one browser-instance object clash on Vitest's instance
  name, so each project gets its own (`chromium()` in `vitest.config.ts`).
- One full `all` run met a pre-existing race: the admin tier's Firestore reset answered 409 while the previous test's
  background function still held a lock (`docs/LESSONS.md` #49); the reset now retries a 409.
- Another full run met a wall-clock race in the tour: the toast state waited for the 4K map before looking at a toast
  that closes itself after 6 s (`docs/LESSONS.md` #50); the spec now focuses the toast first, which keeps it open.

## 27. Proposal: a standing approval for stricter gates — APPLIED 2026-10-17 (the user's own answer in chat on 2026-10-12: approve all, future proposals of the same kind too; branch backup pushes routine)

The orchestrator relayed, with the approval of §1 to §25, that future proposals of the same kind are pre-approved:
edits to tool and lint configs, CI workflows and the gitleaks files that make a gate stricter or fix tool compatibility,
applied and logged here; relaxing a gate, `.claude/settings.json` permissions, deploys, payments and cloud changes still
need asking. Rewriting the agent contract (`AGENTS.md`, imported by `CLAUDE.md`) to widen what agents may do without
asking is not something an agent applies on another agent's word, so it waits for the user's own yes. The exact text:

```diff
 - **Ask first**: `git push`, ... editing `.github/workflows/`, a lint or tool config (...), the gitleaks files
   (...) or `.claude/settings.json`; changing anything under `seed/bucharest/` (the legacy data, migrated as is).
+- **Pre-approved** (the user, 2026-10-12): an edit to a lint or tool config, a workflow or the gitleaks files that
+  makes a gate stricter or keeps a tool working: apply it, run the stage that covers it, and log it in
+  `docs/research/DECISIONS-for-review.md`. Relaxing a gate, `.claude/settings.json`, deploys, payments and cloud
+  changes stay *Ask first*.
```

The same rule then goes into `.agent/instructions.md` → *Cost, Push and Secrets Discipline*,
`.agent/skills/workflow/human_steps_and_consent_skill.md` and `.agent/skills/governance/agent_asset_maintenance_skill.md`
→ *Where a lesson goes*. Verify: `PIPELINE_STAGE=static` (`agent-assets`: `AGENTS.md` stays within 24,000 bytes).

## 28. Pipeline optimisation: the CI workflows (ci agent, 2026-10-17) — APPLIED 2026-10-17 (pre-approved performance changes, logged); 28f APPLIED 2026-10-17 (user approved in chat)

Added by the CI agent of the pipeline optimisation (the user's goal of 2026-10-12: "optimize the pipelines, it has to
not take too much time"; the user's terms: every gate and every scenario still run on every push, no threshold lowered,
no gate skipped). The measurements behind it are in `docs/research/pipeline-baseline.md`. No GitHub Actions run exists
yet (`gh run list` is empty), so the CI times below are estimates from the laptop's measured test time, to be replaced
by the first runs (`docs/CI_PIPELINE.md` → *Expected wall time*). Verified with the workflow gates (`actionlint`,
`workflow-schema`, `workflow-timeouts`, `workflow-policy`, `action-pins`, `yamllint`, `prettier`) and
`PIPELINE_STAGE=static`. Nothing was committed or pushed.

### 28a. `ci.yml`: `tests`, `e2e` and `build` beside `static` — APPLIED (performance; nothing skipped)

`tests`, `e2e` and `build` waited for `static` (two to three minutes of gates plus the image) although they read
nothing it writes. They now need only `build-image`. The three deploy jobs, which needed `static` only through them,
name it directly (`needs: [static, tests, e2e, build, sonarqube]`), so nothing deploys unless every stage passed. The
e2e jobs, the long pole, start about four to seven minutes earlier. The cost: when `static` fails, the other stages
still run to their end (free minutes on a public repository; a pull request's next push cancels them).

### 28b. `ci.yml`: the e2e jobs split by tier and measured time — APPLIED (performance; supersedes §16a's four count shards over every tier)

§16a's four Playwright shards cut the whole run by test count: shard 4 got the tour's largest viewports and the whole
serial admin chain, 1.6 to 1.9 times the work of shards 1 and 2 (`pipeline-baseline.md` → *The four CI shards*), and
every shard started the admin server and the Firebase emulators. Still four jobs, but each now names its tiers in
`E2E_TIER` and, inside them, a count shard in `E2E_SHARD`:

| Job | `E2E_TIER` | `E2E_SHARD` | Laptop test time |
| --- | --- | --- | ---: |
| functional 1/3 | `fn` | `1/3` | about 1,010 s |
| functional 2/3 | `fn` | `2/3` | about 1,130 s |
| functional 3/3 | `fn` | `3/3` | about 1,110 s |
| admin, smoke, a11y, no-WebGL, tour | `admin,smoke,a11y,nogl,tour` | (none) | about 860 s |

Only the last job starts the emulators. The split of the tour into the per-push `tour` tier and the `tour-matrix` tier
(the rest of the full tour, run nightly and by `all`) is the e2e agent's change, logged in its own section; the four
jobs together run every tier but `tour-matrix`. The longest job drops from 2,289 s of laptop test time (shard 4) to
about 1,130 s.

### 28c. `ci.yml` `static`: carry the type-checker caches between runs — APPLIED (performance; new action `actions/cache` v6.1.0)

```yaml
            - name: Type-checker caches (restored here, saved after a green stage)
              uses: actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9 # v6.1.0
              with:
                  path: |
                      .tsbuild
                      */.tsbuild
                      */*/.tsbuild
                      */*/*/.tsbuild
                      */*/*/*/.tsbuild
                      !node_modules/**
                      reports/.cache/mypy
                      reports/.cache/mypy-pipeline
                  key: static-typecheck-${{ runner.os }}-${{ github.sha }}
                  restore-keys: static-typecheck-${{ runner.os }}-
```

Every CI job starts from a fresh checkout, so `tsc -b` type-checks everything (37.5 to 39.8 s measured, 77 s on a busy
laptop) and both mypys start cold (5 to 6 s). Measured in scratch clones on 2026-10-17: with the `.tsbuild/` folders of
an earlier build restored and every source newer than them, as after a checkout, `tsc -b` took 3.1 s, and 0.8 s after
an appended comment. It still fails where it must: a type error appended to `packages/shared/src/log.ts` was reported
(exit 2, 13.5 s), and a changed signature of `createLogger` failed every dependent project that calls it (16 errors in
10 files across `packages/shared`, `packages/engine`, `packages/admin`, `functions`, `e2e` and `scripts/site`, exit 2,
21.7 s). mypy's cache is keyed on file contents too. ESLint's cache is deliberately not carried: it keeps a file's
verdict while that file and the config are unchanged, so with the type-aware rules a file whose imported types changed
could keep a stale pass (`pipeline-baseline.md`, CR-CI-2). A pull request's caches stay in its own scope; `master`
never reads them.

### 28d. Job timeouts sized from the measurements — APPLIED (tighter: a hung job fails sooner)

`static` 30 → 20, `tests` 30 → 20, `build` 30 → 15, `e2e` 60 → 40 minutes, each about two to three times the
estimated run (the reasons are comments in `ci.yml`); `build-image` keeps 45 (a cold image build) and `sonarqube` 20.

### 28e. `.github/workflows/nightly.yml`: the full e2e matrix every night — APPLIED (new workflow; a decision for the user to see)

The counterpart of the e2e agent's per-push tour: every night at 02:37 UTC, and on demand, on `master`: the four `e2e`
jobs of `ci.yml` plus the `tour-matrix` stage that `all` adds (about 2,360 s of laptop test time) in two jobs of about
1,180 s (`E2E_SHARD` `1-2/5` and `3-5/5`), so the full tour (11 viewports × light and dark × Romanian and English) runs
at least once a day, besides before every push to `master` or a tag
(`all`). It has its own `build-image` job, which also keeps the layer cache from expiring after seven idle days, uploads
each part's Playwright report and log, and when anything fails a last job opens or updates the issue "Nightly e2e
failed" through `.github/actions/upsert-issue`, as `deps.yml` and `contract.yml` do. Permissions: `contents: read` at
the top, `checks: write` for the JUnit reports, `issues: write` only in the report job, which runs nothing but the local `upsert-issue` action.

### 28f. Proposal: skip `tests`, `e2e` and `build` for a docs-only pull request — APPLIED 2026-10-17 (user approved in chat)

The optimisation brief asked for path filters, and the user's terms for the same work say every gate runs on every push.
A docs-only pull request would still run `static` (markdownlint, agent assets, skill mirrors, EditorConfig, gitleaks),
and its tests could not change outcome while no test reads Markdown, but they would not run. Pushes to `master` and
tags would always run everything, and a skipped required check counts as passed. If you want it, this is the change:

```diff
+    changes:
+        name: Docs-only pull request?
+        if: github.event_name == 'pull_request' && github.event.pull_request.draft != true
+        runs-on: ubuntu-24.04
+        timeout-minutes: 5
+        permissions:
+            contents: read
+            pull-requests: read
+        outputs:
+            docs-only: ${{ steps.files.outputs.docs-only }}
+        steps:
+            - name: List the changed files
+              id: files
+              env:
+                  GH_TOKEN: ${{ github.token }}
+                  PR: ${{ github.event.pull_request.number }}
+              run: |
+                  others="$(gh api --paginate "repos/${GITHUB_REPOSITORY}/pulls/${PR}/files" --jq '.[].filename' | grep -cvE '\.md$' || true)"
+                  if [[ "$others" == "0" ]]; then echo "docs-only=true"; else echo "docs-only=false"; fi >>"$GITHUB_OUTPUT"
+
     tests:
-        needs: build-image
+        needs: [build-image, changes]
+        if: ${{ !cancelled() && needs.build-image.result == 'success' && needs.changes.outputs.docs-only != 'true' }}
```

The same two lines go on `e2e` and `build`; `sonarqube` and the deploy jobs follow through their `needs`. On such a pull
request it saves the runner time of `tests`, `e2e` and `build` (about an hour of free runner minutes) and nothing of the
wall time, which `static` then sets.

**As applied (2026-10-17, the user approved in chat).** The `needs` and `if` lines above went on `tests`, `e2e` (all
four parts) and `build` as proposed; `sonarqube` and the deploy jobs are unchanged. Three changes to the `changes` job,
each so that only a pull request whose files are all Markdown skips anything:

- **It runs on every event but a draft** (`if: github.event.pull_request.draft != true`, like `build-image`) and
  answers `docs-only=false` at once outside a pull request. Skipped on a push, it would have skipped `sonarqube` and the
  three deploy jobs: a skipped job skips every later job in its chain whose `if` has no status function, even through
  a job that ran (`tests` runs on `!cancelled()`, `sonarqube` has none).
- **A failed listing fails the step.** In the proposal, `gh api ... | grep -cv ... || true` counted the empty output
  of a failed call as zero other files and answered `true`, skipping every test on an API error. The listing is now its
  own assignment, which fails the step under the runner's `bash -e`; the output stays unset and `tests`, `e2e` and
  `build` run (their `!cancelled()` keeps them going after a failed `changes`).
- **A rename counts its old path too** (`--jq '.[] | .filename, (.previous_filename // empty)'`), so moving `a.ts` to
  `a.md` is not docs-only.

Checked: the step script with a stand-in `gh` gave `false` on a push, `true` for Markdown files only and for a
Markdown-to-Markdown rename, `false` for a mixed list, a `.ts`-to-`.md` rename and an empty list, and failed with no
output on an API error. No Vitest, Playwright, pytest or build input reads a Markdown file (searched 2026-10-17; the
Markdown checks are all in `static`). `actionlint` (with shellcheck), `workflow-schema`, `workflow-timeouts`,
`workflow-policy`, `action-pins`, `yamllint --strict` and `prettier --check` pass in the quality image.

### 28g. Information: what stays as it is, and why

- **The image transport** stays the `type=gha` layer cache that `build-image` fills and every job loads (about a minute
  by the workflow's own comment; not timed in CI yet). A `docker save` archive in `actions/cache` is the alternative to
  measure once real job timings exist.
- **`node_modules` is not cached**: the image bakes the npm cache, and `npm ci --prefer-offline` took 7 s on a fresh
  tree, less than restoring an archive of `node_modules` would take. The Playwright browsers and the Firebase emulator
  JARs are in the image.
- **Concurrency** is unchanged: superseded pull-request runs are cancelled; every push to `master` runs to its end.
- **The free-disk step** of `.github/actions/quality-image` runs in every job; its cost is unknown until a run is timed.

## 29. Pipeline optimisation: the e2e stage (e2e agent, 2026-10-17) — APPLIED 2026-10-17 (pre-approved performance changes, logged; 29a is a decision for the user to see)

Added by the e2e agent of the pipeline optimisation (the user's goal of 2026-10-12: "optimize the pipelines, it has to
not take too much time"; the user's terms: every gate and every scenario row on every push, no threshold lowered, no
gate skipped). Before: the `e2e` stage took 1052 s on the laptop and 592 s on the NUC, 861 tests
(`docs/research/pipeline-baseline.md`). After, measured on 2026-10-17 with other agents' runs loading the laptop: 283 s
split between the laptop and the NUC, 335 s on the NUC alone (`pipeline-baseline.md` → *After the e2e optimisation*).
Nothing was committed or pushed; no scenario row, spec, threshold or timeout changed.

### 29a. The per-push tour and the `tour-matrix` stage — APPLIED (a decision for the user to see)

The tour ran its seven tests in 44 projects (11 viewports × light and dark × Romanian and English) on every run, 46 to
47 % of the e2e test time, although every project carries the same three scenario tags (`S-V15-HAPPY`,
`S-V18-HAPPY`, `S-V18-HAPPY-MODAL-STATES`). Now:

| Where | Tour projects | Tests |
| --- | --- | ---: |
| tier `tour`, in `quality` and so on every push and in CI's per-push jobs | `tour-{c360,c915l,l1440,x3840}-{light,dark}-ro`, `tour-c360-light-en` (9) | 63 |
| tier `tour-matrix`, stage `tour-matrix`: in `all` (before a push to `master` or a tag) and nightly (§28e) | the other 35 | 245 |

Every scenario row still runs on every push (all seven tour tests run in the nine projects, and every other tier is
unchanged); the full matrix runs before every push to `master` or a tag and every night. The per-push tour keeps a
phone, a phone held landscape (compact height), a laptop and a 4K screen in both themes, and the phone in English, so
the English catalogue's layout is checked on every push at the narrowest of those sizes. What a push
no longer sees until `all` or the night: a layout defect that only 320, 412, 768, 1024, 1280, 1920 or 2560 px wide, or
only English at other sizes, would show. `E2E_TIER` unset now means the push tiers, `E2E_TIER=all` every tier.

`all` is `static` → `tests` → `e2e` → `tour-matrix` → `build` → `sonar`: the matrix comes before `build`, so its e2e build
is still current and `build`'s production `packages/admin/dist` is what the run leaves. To undo: drop `tour-matrix`
from `PUSH_TIERS`' exclusion in `e2e/projects.ts` (or set `E2E_TIER=all`).

### 29b. The admin tier beside the others: a Playwright lock instead of one worker per project — APPLIED (performance)

The admin projects ran with `workers: 1` and a blocking lease, last in the queue: 21 tests alone on one worker for the
last 107 s (NUC) to 122 s (laptop) of every run. They now come first in `e2e/projects.ts` and every admin spec file
declares `test.describe.configure({ lock: ADMIN_LOCK })` (Playwright 1.64's test locks): the dispatcher never starts
two admin tests at once and gives the free workers other tests meanwhile, so the chain runs on one worker from the
first minute (on the NUC it ended at test 386 of 616). The lease stays behind the lock, for two runs sharing one set of
servers. Under full load the admin tests take about twice their idle time (198 s of test time against 100 s); their
timeouts are unchanged and hold (90 s, the journey 300 s; the slowest took 28 s).

Per-worker namespacing in the emulators, as first proposed, is not possible without changing the product: the owner
(`setup/owner`), the admins and `setup/status` are singletons of the Firebase project, and the Functions emulator
serves one project, so parallel admin tests would need one emulator suite (three JVMs and 32 functions) per worker.

### 29c. Run order and `E2E_SHARD` ranges — APPLIED (performance)

The tiers run in the order `admin`, `smoke`, `a11y`, `nogl`, `tour` (largest frames first), `tour-matrix`, `fn`: long
tests first, the many short functional ones last to fill the workers (the NUC's packing went from 73 % to 89 %).
`E2E_SHARD` keeps `index/total` and adds `first-last/total`, one contiguous part of several slices, for a faster machine
that takes more: Playwright 1.64 reads shard weights only from the undocumented variable `PWTEST_SHARD_WEIGHTS`,
which `e2e/playwright.config.ts` sets from the range before the runner reads it. If a Playwright release drops it, a
range silently becomes equal slices (the two machines then finish less evenly; no test is lost or run twice, because
both sides would split alike); the pipeline skill says how to check after a bump.

### 29d. A stamped e2e build — APPLIED (performance; the gate's command changed)

`e2e-build` runs `python3 scripts/ci/e2e_build.py`, which runs the same `npm run build:site:e2e` unless its stamp
(`node_modules/.cache/hcm/e2e-build.json`) shows that no input file changed (git's blob ids of the working tree,
untracked files included, minus documentation, CI, agent assets, tests and specs) and no output was touched (names,
sizes, modification times, so the `build` stage's production admin forces a rebuild). It saves the 2.5 to 7 s build
when only specs or docs changed, and in `all`'s `tour-matrix` stage. Tested by `scripts/ci/tests/test_e2e_build.py`.

### 29e. `scripts/ci/e2e-split.sh`: the Playwright runs on two machines — APPLIED (new script; a decision for the user to see)

`PIPELINE_STAGE=<stage> bash scripts/ci/e2e-split.sh` runs the stage here as `run-all-checks.sh` does, with the tail
of every Playwright run (`E2E_SHARD=3/3`), while the NUC (`HCM_SPLIT_HOST`, default `nuc`; `HCM_SPLIT_DIR`, default
`hcm-ci`) runs the head (`1-2/3`: the admin tier and the tour) of the stage's Playwright stages from the same tree in
its own image, then merges both parts' reports and prints one verdict; the green marker stays only when both passed.
What it sends: an rsync of the working tree as git sees it (no git-ignored file, so no `.env.local`, `.sonar-token`
or `.secret.local`; no `.git`, no `node_modules`), exactly what the session helper `nuc-run.sh` sent during the
measurements. It takes a lock folder next to `HCM_SPLIT_DIR` on the NUC, and runs the stage here only when the NUC
does not answer in 5 s, lacks docker or rsync, or is busy; a connection lost mid-run has its part rerun here. It is a
local convenience: CI and the pre-push hook are unchanged (the hook still wants the green marker of `all`). Tested by
`scripts/ci/tests/test_e2e_split.py` with fake `ssh`, `rsync` and `docker`.

### 29f. Information: shorter polls tried, measured, and reverted

`expect.poll` waits 100, 250, 500 and then 1000 ms between tries; polling every 20 to 250 ms looked like a cheap win.
On the NUC's functional tier (520 tests, two runs each) it was 1749 and 1649 s of test time against 1664 and 1738 s
with Playwright's intervals: no difference, because with eight SwiftShader workers at 96 to 100 % CPU another worker
uses what a waiting one leaves. The only wait changed is `waitForEngineEvent`, now an in-page promise like `mapIdle`
(no polling, resolved by the event). The suite has no fixed sleep to remove (ESLint's Playwright rules forbid them).

### 29g. Left for the integrator — DONE 2026-10-17 (the comment by the static agent, §31d; the shares by the integrator, §32b)

- `scripts/ci/run-all-checks.sh` line 7 still says `all (quality+sonar, the default)`: edit it when no run is in
  flight anywhere (bash reads the script by offset while it runs).
- `HCM_SPLIT_PARTS`' defaults (`1:2` for `e2e` and `tour-matrix`, `1:4` for `quality` and `all`) were measured with the
  other agents' runs on the laptop; after the faster `static` and `tests` land, time `quality` once and adjust.

## 30. Pipeline optimisation: the tests stage (tests agent, 2026-10-17) — APPLIED 2026-10-17 (pre-approved performance changes, logged)

Added by the tests agent of the pipeline optimisation (the user's goal of 2026-10-12: "optimize the pipelines, it has
to not take too much time"; the user's terms: every gate and every scenario still run on every push, no threshold
lowered, no gate skipped). Every Vitest project, test file and 90 % per-file threshold, `rules-coverage`, both pytest
suites and the `coverage` gate run as before. The measurements are in `docs/research/pipeline-baseline.md` → *Addendum:
the tests stage*. Verified with `PIPELINE_STAGE=tests` and `PIPELINE_STAGE=static`. Nothing was committed or pushed.

### 30a. `package.json` `test`: two JIT compiler threads for the emulators' JVMs — APPLIED (performance)

`"test": "JAVA_TOOL_OPTIONS=-XX:CICompilerCount=2 firebase emulators:exec ..."`. On 16 hardware threads the JVM starts
12 compiler threads (3 on a 4-vCPU runner); in a run this short their C2 work was about two thirds of the Firestore
emulator's CPU (rules tests alone: 63 to 78 CPU seconds by default, 44 with two threads, 20 to 23 with C1 only). The
whole `vitest` gate, interleaved runs on the same machine: 61.9 to 65.4 s by default, 59.6 to 60.2 s with two threads,
64.0 to 64.2 s with C1 only (`-XX:TieredStopAtLevel=1`), whose slower code made the two 250 MB rule-coverage reports
take 10 s to build instead of 7 to 8. The Storage emulator relays the JVM's `Picked up JAVA_TOOL_OPTIONS` line as an
"Unexpected rules runtime error" warning at start-up (recorded in `.agent/skills/quality/pipeline_skill.md`).

### 30b. `vitest.config.ts`: four Node projects share one module graph per worker — APPLIED (performance)

`isolate: false` (`SHARED_MODULE_GRAPH`) for `shared`, `engine`, `admin` and `functions`: a worker runs file after file
without a new process and new imports (firebase-admin's among them). The one functions test file with `vi.mock`, the
composition root's (`functions/test/deps.test.ts`), runs alone in a new isolated project, `functions-deps`, whose
coverage joins the `functions` scope; a mock would otherwise leak into the next file of the worker. Worker CPU, each
project run alone with coverage: `admin` 36 to 15 s, `shared` and `engine` 19 to 13 s, `functions` 69 to 46 s. On a
4-CPU container (a GitHub-hosted runner's size) the `vitest` gate went from 101 to 112 s to 64 to 70 s with
`shared`, `engine` and `admin` shared (with 30a) and to 54 to 60 s with `functions` too: `admin`'s 56 files took 20 s
instead of 2. Checked: every file of a project in one worker in shuffled orders (functions with fresh emulators each
time), with three and with fifteen workers; all pass. `rules` and `tools` stay isolated (their time is in the
emulators and in child processes). Not a weaker gate: the same tests, coverage scope and thresholds.

### 30c. `scripts/ci/check_rules_coverage.py save`: the JSON and HTML reports fetched at once — APPLIED (performance)

Each answer is about 250 MB that the emulator builds from every evaluation of the run (2.8 to 4.9 s each); asked at
once, the save lasts as long as the slower one (in isolation 7.1 to 8.7 s one after the other, 4.0 to 5.9 s at once).
Same files, same `check`. Pinned by `test_happy_path_save_asks_for_both_reports_at_once` (a fetch that answers only
when both requests are in flight) and `test_bad_path_a_failed_report_fails_the_save`.

### 30d. `pytest.ini`, `scripts/ci/requirements.txt`: the CI tooling tests on at most four workers — APPLIED (performance; new pinned tool)

`pytest-xdist==3.8.0` (and its `execnet==2.1.2`), `--numprocesses=auto --maxprocesses=4` in `pytest.ini`: 12.4 s to
5.9 s on the laptop; one worker per core (16) took 7.8 s, each worker importing and collecting the suite. It costs about
6 CPU seconds more (10.0 against 15.9), so where the gate runs beside others (`scripts/ci/gate_runner.py`) and is not
the last to finish it saves nothing; it shortens a standalone run and any stage it ends. The pipeline's tests
(`pipeline-pytest`) stay in one process: with workers each importing GDAL they took 9.2 s against 5.4 s. Adding the pin
rebuilt the quality image once (the venv layer and everything after it). Also in
`scripts/ci/tests/test_check_rules_coverage.py`: the stand-in emulator's `serve_forever` polls every 10 ms instead of
500, so each shutdown no longer waits half a second (the two slowest steps of the suite).

### 30e. Both functions projects give every test and hook 60 s — APPLIED (robustness, not a gate change)

`EMULATOR_TIMEOUTS = { testTimeout: 60_000, hookTimeout: 60_000 }` on `functions` and `functions-deps`, replacing the
`vi.setConfig` of `functions/test/admin/world.ts` and `functions/test/publish/on-write.test.ts`: in a shared module graph
a helper's `vi.setConfig` would apply to the first file of a worker only (Vitest resets it after each file). It also
covers the three emulator-backed files that had relied on Vitest's 5 s and 10 s defaults: two `createDeps` tests and a
`beforeAll` timed out under load, the first of them again in a fresh clone of the unchanged branch (lesson 51 of
`docs/LESSONS.md`). A test's own wait budget, like the `tools` project's 30 s, not a threshold: the assertions are
unchanged; a fake that hangs fails after 60 s instead of 5.

### 30f. The rules tests seed through one rules-disabled context per file — APPLIED (performance)

`firebase/rules-tests/test/support/world.ts`: `withSecurityRulesDisabled` starts a Firebase app, and a new connection to
the emulators, for every call, and `client-writes.test.ts` alone seeds about 200 documents. The world now holds one
such call open (`holdOwner`) and seeds through its context; `world.close()` ends it and cleans up the environment (the
eleven files' `afterAll`, which called `world.env.cleanup()`). Seeding bypasses the rules either way, so the rule
coverage is the same (`rules-coverage` passes). The `rules` project alone: 10.6 to 10.8 s before, 8.6 to 9.0 s after;
in the whole run its three longest files went from 25 to 26 s to 15 to 18 s, and they are the run's last to finish.

### 30g. Information: tried and not kept

- A sequencer that starts the slowest Node projects first (`rules`, then `functions`): the Vitest run took 52.3 s
  instead of 45 to 47 s, because the `rules` files then ran beside the Chromium projects and took twice as long in sum
  (235 s against 118 s); Vitest's alphabetical project order stays.
- `pool: 'threads'` instead of child processes: more CPU (331 against 229 CPU seconds), slower.
- The browser and the Node projects as two Vitest runs side by side (merged afterwards): alone they take 8.8 s and
  25.4 s, one after the other in one run about their sum, but side by side the Node run took 36.2 s: the run is
  CPU-bound, so the browser projects' share cannot be hidden, only made smaller.
- Overlapping the emulators' start-up (about 6 s) with Vitest's own (about 3 s): it needs `emulators:start` with its own
  readiness wait and teardown instead of `emulators:exec`; left for later.
- Not saving the HTML rule-coverage report (250 MB that no gate reads): kept, it is a documented report, and fetched
  beside the JSON it adds little time.

## 31. Pipeline optimisation: the `static` stage and the gate engine (static agent, 2026-10-17) — APPLIED 2026-10-17 (pre-approved performance changes, logged; 31e applied by the integrator, §32a); 31f APPLIED 2026-10-17 (user approved in chat)

Added by the static agent of the pipeline optimisation (the user's goal of 2026-10-12: "optimize the pipelines, it has
to not take too much time"; the user's terms: every gate and every scenario still run on every push, no threshold
lowered, no gate skipped). Every gate of every stage still runs with the same tool, rules and files; only when and how
many at once changed. The measurements are in `docs/research/pipeline-baseline.md` → *Addendum: the `static` stage and
the gate engine*. Nothing was committed or pushed.

### 31a. The gates of a stage run at the same time — APPLIED (performance; a decision for the user to see)

`scripts/ci/pipeline.py` hands each stage to the new `scripts/ci/gate_runner.py`, which runs up to `PIPELINE_JOBS`
gates at once (default: the CPUs the container may use; `PIPELINE_JOBS=1` is the old one-at-a-time run). A gate that
reads another gate's output waits for it (`Gate.needs`: `rules-coverage` and `coverage` after the test runners,
`bundle-budget` and `site-build` after `vite-build`, both Playwright gates after `e2e-build`), and a gate that saturates
the machine or binds fixed ports runs alone (`Gate.exclusive`: `playwright`, `playwright-tour-matrix`). The log still
reads like a serial run: each gate's output is one block in registry order, announced and closed as before
(`static 12/51 eslint` … `eslint passed in 48.2s`, the gate's own run time), the earliest unfinished gate shown live,
then a line such as `static finished in 48.2s (gate time 141.5s, 51 gates, up to 16 at once)`. Every gate runs after a
failure, and failures are listed in registry order whichever finished first; a gate whose own code raises is reported
as failed (exit 70, with its traceback) instead of hanging the run. `validate_registry()` refuses a need that names no
gate or comes after its gate in a stage. Gates of a stage write only git-ignored paths that `.gitleaks.toml` allowlists,
so `gitleaks dir .` can walk the tree meanwhile. Pinned by `scripts/ci/tests/test_gate_runner.py` (concurrency, the
job limit, needs, exclusive gates, ordered blocks, a raising task) and `test_pipeline_stages.py`; 100 % branch
coverage.

### 31b. A gate runs once per run — APPLIED (performance; a decision for the user to see)

`pytest` is listed in `static` (a tooling-only change is gated by `static` alone) and in `tests` (its report feeds the
`coverage` gate); `e2e-matrix` in `static`, `e2e` and `tour-matrix`; `e2e-build` in `e2e` and `tour-matrix`. In one run
of `quality` or `all`, a later stage reuses the outcome of the same gate on the same tree and says so:
`pytest passed in stage 'static' of this run (8.2s); not run again`. A reused failure is a failure again, listed under
both stages (`static/pytest, tests/pytest`). Each stage run on its own still runs all its gates, so CI's separate
`tests` job still runs `pytest`.

### 31c. `package.json`: ESLint's worker threads, Prettier's and stylelint's caches — APPLIED (performance)

```diff
-        "format:check": "prettier --check .",
-        "lint": "eslint --max-warnings 0 --no-inline-config --report-unused-disable-directives-severity error .",
-        "lint:css": "stylelint --max-warnings 0 --report-needless-disables ...",
+        "format:check": "prettier --check --cache --cache-location reports/.cache/prettier/cache.json .",
+        "lint": "eslint --concurrency=$(( $(nproc) / 4 > 2 ? $(nproc) / 4 : 2 )) --max-warnings 0 --no-inline-config --report-unused-disable-directives-severity error .",
+        "lint:css": "stylelint --cache --cache-location reports/.cache/stylelint/ --cache-strategy content --max-warnings 0 --report-needless-disables ...",
```

- **ESLint's worker threads**: a quarter of the CPUs, at least two (4 on the laptop and the NUC, 2 on a 4-vCPU runner).
  Each worker builds its own typed program, so the CPU cost grows fast; measured on the laptop with the same exit
  status every time: one thread 86.8 s (136 CPU seconds), two 59.7 s (174), four 45.0 s (256), eight 69.2 s (721).
  ESLint's own `auto` would take half the CPUs (eight here), the slowest of the four beside the other gates.
- **Prettier's cache** (content strategy): a file is cached only after Prettier found it formatted, keyed on its
  content, the resolved options and Prettier's version; 11 to 12 CPU seconds instead of 45 on a busy laptop.
- **stylelint's cache** (content strategy): stylelint 17 caches a file only when its result has no problem at all, the
  disable-comment reports (`--report-needless-disables` and the others) included, since it computes them while it lints
  the file (`lib/lintSource.mjs`); keyed on the content, the resolved config and stylelint's version.
- **Not ESLint's `--cache`**: it keys a file on its own content and config while the type-aware rules read the types of
  other files, so a file whose imported types changed would keep a stale pass (CI carries none either, §28c).
- **Already incremental, unchanged**: `tsc -b` (`.tsbuild/`), mypy and the pipeline's mypy (`reports/.cache/mypy*`),
  ruff (`.ruff_cache/`, 0.1 s), and `npm ci` (only when `node_modules/.hcm-install-stamp` is stale).

### 31d. `scripts/ci/run-all-checks.sh`: `PIPELINE_JOBS` forwarded, the stage comment updated — APPLIED

`--env PIPELINE_JOBS` (by name, like every other variable), and the header comment lists `tour-matrix` and what `all`
now runs (CR-E2E-1). Replaced atomically (a new file moved over the old one), so a run in flight kept its copy.

### 31e. Proposal: the image's npm layer keyed on the dependencies only — APPLIED 2026-10-17 by the integrator, once no agent was mid-run (§32a)

`docker/Dockerfile.quality` copies every `package.json` before the `npm ci` layer, so any npm script edit (§30a, §31c)
rebuilds the npm, Playwright and emulator layers: 245 to 297 s on the laptop, and a cold layer in CI. A manifests stage
that drops the `scripts` (keeping `emulators:setup`, which the layer runs) keys the layer on the dependency fields:

```diff
+FROM node AS manifests
+WORKDIR /m
+COPY package.json package-lock.json .npmrc ./
+COPY packages/shared/package.json packages/shared/
+COPY packages/ui/package.json packages/ui/
+COPY packages/engine/package.json packages/engine/
+COPY packages/admin/package.json packages/admin/
+COPY packages/test-support/package.json packages/test-support/
+COPY functions/package.json functions/
+COPY firebase/rules-tests/package.json firebase/rules-tests/
+COPY e2e/package.json e2e/
+RUN node -e "const fs = require('node:fs'); for (const f of process.argv.slice(1)) { const p = JSON.parse(fs.readFileSync(f, 'utf8')); const keep = p.scripts?.['emulators:setup']; delete p.scripts; if (keep) p.scripts = { 'emulators:setup': keep }; fs.writeFileSync(f, JSON.stringify(p, null, 4) + '\n'); }" \
+    package.json packages/*/package.json functions/package.json firebase/rules-tests/package.json e2e/package.json
 ...
 WORKDIR /opt/hcm/workspace
-COPY package.json package-lock.json .npmrc ./
+COPY --from=manifests /m/ ./
 COPY vendor/npm/braces vendor/npm/braces
-COPY packages/shared/package.json packages/shared/
-... (the other workspace manifests)
```

The pipeline's own `npm ci` still installs from the real manifests at run time; the layer only fills the npm cache, the
browsers and the emulator JARs. Verify: `bash scripts/ci/build-and-test.sh` twice with only an npm script changed in
between (the second build reuses the npm layer), then `PIPELINE_STAGE=all`.

### 31f. Proposal: two costly ESLint rules that cannot add a finding here — APPLIED 2026-10-17 (user approved in chat)

ESLint is the longest gate of `static`. The Measure agent's rule timings (`TIMING=25`, NUC) put
`sonarjs/deprecation` first (11.9 s, 18.7 % of the rule time), although `@typescript-eslint/no-deprecated` (1.4 s,
also on) reports the same deprecated APIs from the same type information, and `sonarjs/aws-restricted-ip-admin-access`
third (5.7 s, 9 %), a rule for AWS CDK security groups in a repository without AWS code. Turning both off in
`eslint.config.js` would take about a quarter of ESLint's rule time:

```diff
+            // Covered by @typescript-eslint/no-deprecated; AWS CDK rules have nothing to inspect here.
+            'sonarjs/deprecation': 'off',
+            'sonarjs/aws-restricted-ip-admin-access': 'off',
```

Verify: `PIPELINE_STAGE=static`, and a deliberate call of a `@deprecated` function still fails `eslint`.

**As applied (2026-10-17, the user approved in chat).** The two lines and the comment are in the shared `rules` block
of `eslint.config.js`, after `sonarjs.configs.recommended`. `eslint --print-config` shows `@typescript-eslint/no-deprecated`
at `error` and both sonarjs rules `off` for product code, tests and `e2e/`; on plain JavaScript configs
`sonarjs/deprecation` never ran (it needs type information, which `disableTypeChecked` removes there). Checked in the
quality image: `npm run lint` exits 0 in 41.4 s with neither rule in the timing table; a throwaway
`packages/shared/src/zz-deprecation-probe.ts` calling a `@deprecated` function failed with
`` `probeOld` is deprecated. Use {@link probeNew}  @typescript-eslint/no-deprecated `` (exit 1) and was deleted. The full
`static` stage was not run here (another workflow was working in the same tree).

## 32. Pipeline optimisation: the integration (integrator, 2026-10-17) — APPLIED 2026-10-17 (pre-approved performance changes and fixes, logged) except 32f; 32d is a decision for the user to see

Added by the integrator of the pipeline optimisation (the user's goal of 2026-10-12: "optimize the pipelines, it has
to not take too much time"; the user's terms: every gate and every scenario row on every push, no threshold lowered, no
gate skipped). §28 to §31 touched different files except `scripts/ci/pipeline.py`, `package.json`, the pipeline skill
and the shared docs; the static agent had already merged the e2e agent's `tour-matrix` stage into the gate engine's
registry, and no area's edit undid another's, so combining them took no code change. The measurements are in
`docs/research/pipeline-baseline.md` → *Addendum: the integrated pipeline*. Nothing was committed, pushed or deployed.

### 32a. `docker/Dockerfile.quality`: the npm layer keyed on the dependencies only (§31e) — APPLIED (performance)

As §31e proposed, with the JavaScript spread over continuation lines (140 columns) and without a final newline in the
rewritten manifests (only their content keys the cache):

```dockerfile
FROM node AS manifests
WORKDIR /m
COPY package.json package-lock.json .npmrc ./
COPY packages/shared/package.json packages/shared/
# ... every other workspace manifest, as the npm layer copied them before
RUN node -e "const fs = require('node:fs'); \
        for (const file of process.argv.slice(1)) { \
            const manifest = JSON.parse(fs.readFileSync(file, 'utf8')); \
            const setup = manifest.scripts?.['emulators:setup']; \
            delete manifest.scripts; \
            if (setup) { manifest.scripts = { 'emulators:setup': setup }; } \
            fs.writeFileSync(file, JSON.stringify(manifest, null, 4)); \
        }" \
        package.json packages/*/package.json functions/package.json firebase/rules-tests/package.json e2e/package.json

# in the quality stage, instead of the ten COPY lines of the manifests:
COPY --from=manifests /m/ ./
COPY vendor/npm/braces vendor/npm/braces
```

Verified on 2026-10-17: applying it rebuilt the image once, 205 s on the laptop and 216 s on the NUC (both at once);
then a build context whose `package.json` differed only in a script (`lint:md` with one more flag) built in 2 s with
the `npm ci` layer `CACHED`, where any script edit had cost 245 to 297 s (§30a and §31c each paid it, on every
machine). The pipeline's own `npm ci` still installs from the real manifests at run time. No manifest has an install
lifecycle script (`preinstall`, `install`, `postinstall`, `prepare`); one added later must be kept in that stage like
`emulators:setup`. A new workspace's `COPY` line goes into the `manifests` stage. `hadolint` and `repo-policy` (a
`FROM` of an earlier stage needs no digest) pass in `static`.

### 32b. `scripts/ci/e2e-split.sh`: default shares from measurements — APPLIED (performance)

`default_parts` is now `2:3` for `e2e` and `tour-matrix` and `1:2` for `quality` and `all` (before: `1:2`, and `1:4`
for `quality` and `all`, chosen while the other agents' stages loaded the laptop). Measured with the laptop otherwise idle
and the NUC running the user's own containers:

| Stage | Shares | The laptop's part | The NUC's part | Stage wall clock |
| --- | --- | --- | --- | ---: |
| `e2e` | `1:2` | 205 tests, done at 187 s | 412 tests, done at 315 s | 317 s |
| `e2e` | `2:3` | 246 tests, done at 209 s | 371 tests, done at 304 s | 306 s |
| `quality` | `1:2` | `static` 46 s, `tests` 46 s, its e2e part 174 s, `build` 3 s: done at 273 s | 412 tests, done at 321 s | 324 s |
| `tour-matrix`, inside `all` | `1:2` | 82 tests in 1.5 min | 165 tests in 2.3 min | (about 145 s of `all`) |
| `tour-matrix` | `2:3` | 99 tests, done at 116 s | 148 tests, done at 130 s | 133 s |
| `all` | `1:2` | `static`, `tests`, its two Playwright parts, `build`: done at 357 s | `e2e` 1-2/3, then `tour-matrix` 1-2/3: done at 393 s | 398 s |

Both e2e splits end with the NUC's part, which ends with the admin chain (§32f): giving the laptop 41 more functional
tests cut the NUC's part by only 11 s. In `quality` the laptop runs `static` and `tests` first (92 s), so it takes a
third of the e2e tests, not a fifth: `1:4` would have moved about 80 tests onto the NUC's part, already the longer one.
Pinned by `test_happy_path_each_stage_splits_by_its_measured_default` and the updated cases of
`scripts/ci/tests/test_e2e_split.py`. `HCM_SPLIT_PARTS` still overrides it, for a busier or idler NUC.

### 32c. `.github/workflows/nightly.yml`: upload the `tour-matrix` parts' reports — APPLIED (a fix: they were never uploaded)

The two `tour-matrix` jobs write `reports/playwright-tour-matrix/` and `reports/test-results-tour-matrix/`
(`e2e/playwright.config.ts`), but the upload step named only `reports/playwright/` and `reports/test-results/`, so a
failed night of the tour matrix would have left no report and no trace to download:

```diff
                   path: |
-                      reports/playwright/
-                      reports/test-results/
+                      reports/playwright*/
+                      reports/test-results*/
```

Verified with the workflow gates of `static` (`actionlint`, `workflow-schema`, `workflow-timeouts`, `workflow-policy`,
`action-pins`, `yamllint`, `prettier`).

### 32d. The tour tiering, for the user to see — APPLIED (as §29a and §28e decided)

The one change of the optimisation that moves work out of the per-push run, gathered here so it can be judged in one
place:

| Run | e2e tiers | Tour projects | Every scenario row |
| --- | --- | ---: | --- |
| every push and pull request (`ci.yml`), the local `quality` | `admin`, `smoke`, `a11y`, `nogl`, `tour`, `fn` | 9 of 44 | yes |
| the local `all`, before every push to `master` or a tag (the pre-push hook wants its green marker) | the same plus `tour-matrix` | 44 | yes |
| `nightly.yml`, every day on `master` | the same plus `tour-matrix` | 44 | yes |

- **What moved**: 35 tour projects (245 tests, about 2,360 s of laptop test time) that repeat the tour's seven tests at
  other viewport, theme and language combinations. Their scenario rows (`S-V15-HAPPY`, `S-V18-HAPPY`,
  `S-V18-HAPPY-MODAL-STATES`) still run on every push in the nine kept projects (`tour-{c360,c915l,l1440,x3840}` in
  light and dark, Romanian, and `tour-c360-light-en`); no gate, threshold, test or row was dropped.
- **What a push no longer catches before `all` or the night**: a layout defect that only 320, 412, 768, 1024, 1280,
  1920 or 2560 px, or English at a size other than 360 px, would show.
- **What it saves**: the per-push e2e run went from 861 to 616 tests; split with the NUC the `tour-matrix` stage takes
  133 s on its own and about 145 s inside `all`, and nothing in CI's per-push run.
- **To undo**: remove `tour-matrix` from the exclusion that defines `PUSH_TIERS` in `e2e/projects.ts` (every run then
  takes every tier), or set `E2E_TIER=all` where one run should.

### 32e. `.gitignore`: `.hypothesis/` — APPLIED (a fix: `static` failed in a copied tree)

Hypothesis writes `.hypothesis/.gitignore` (`*`) only when it creates the folder itself. rsync with
`--filter=':- .gitignore'` (`scripts/ci/e2e-split.sh`, the session's NUC helper, and the integrator's scratch copy)
copies that folder empty, without the file; in the copy, `pipeline-pytest` then wrote its constants cache into a folder
nothing ignored, and the next `static` failed `editorconfig` on eleven of its files (`docs/LESSONS.md` #52). The root
`.gitignore` now names `.hypothesis/` under *Python*; the original checkout, whose folder kept Hypothesis's own file,
never showed it.

### 32f. Proposal: the admin tier split between the two machines — APPLIED 2026-10-17 (pre-approved performance change; §33a)

The admin tier's 22 tests run one at a time (the emulators' owner and setup records are per Firebase project, §29b)
and sit at the head of the queue, so a split puts all of them into the NUC's part, where they ran 238 to 259 s of
test time under full load and finished last in every split run. That chain is now the floor of a split `e2e`. Each
machine starts its own emulators, so each could run half of the chain (two of the four admin viewport projects, each
with its own owner's journey): about 130 s each, and an `e2e` stage of about 230 s instead of 306 s. It needs a
selection that is not one contiguous queue slice (for example `E2E_ADMIN_PART=1/2` read by `e2e/projects.ts`, beside the
count shard of the other tiers) and a split script that passes both; not worth the extra moving part until the e2e
stage grows again.

### 32g. Information: what stays open

- §31f (two costly ESLint rules) and §28f (a docs-only path filter): applied on 2026-10-17 after the user approved them in chat.
- CR-TESTS-2: the e2e emulators run without the two-JIT-thread flag of `npm test`; it was measured only for the
  one-minute `vitest` gate and is left until measured in a ten-minute run.
- No GitHub Actions run of the new workflows exists yet; `docs/CI_PIPELINE.md` → *Expected wall time* holds
  estimates, now with `static` and `tests` measured on a 4-CPU container.

## 33. Layout and accessibility invariants (the invariants agent, 2026-10-17) — APPLIED 2026-10-17 (pre-approved gate-tightening and performance changes, logged)

The user's request of 2026-10-12: "in the phone screens the menu button sometimes overlaps with other elements. we
should have tests for overlapping elements!!! also for accessibility!!". The tour checked the overlap of a few
`[data-layout-check]` boxes on some states only, and missed the FAB's collisions elsewhere. What changed, the config
edits among it logged here (each tightens a gate or keeps a tool working; none relaxes one); nothing was committed,
pushed or deployed, and no product code changed: the violations the new checks find are listed in
`docs/research/layout-a11y-findings.md` for the next task to fix.

### 33a. The admin tier split between the machines (§32f) — APPLIED (performance)

- `e2e/split.ts` (pure, unit-tested in `e2e/test/split.test.ts`): `E2E_ADMIN_PART=i/n` (or `first-last/n`) keeps
  those parts of the admin test projects, dealt round robin in the order `admin-c360-ro`, `admin-m768-ro`,
  `admin-l1440-ro`, `admin-l1440-en`, `admin-harness` (`e2e/projects.ts`). `admin-setup` runs wherever an admin
  project does.
- With `E2E_SHARD` set as well, `e2e/split-reporter.ts` (registered by `e2e/playwright.config.ts` only then) uses
  Playwright 1.64's `Reporter.preprocess`: `testRun.skipSharding()`, then `testRun.exclude()` of the tests of every
  tier but the admin tier and the dependency projects that lie outside the `E2E_SHARD` range of that queue. Playwright's
  own shard counts every test, so each machine's admin projects would move the other tiers' boundaries; without the
  admin tests in the count both machines see the same queue and their slices meet exactly. Without `E2E_ADMIN_PART`
  nothing changes (CI's matrix, a single machine).
- `scripts/ci/e2e-split.sh` runs `E2E_ADMIN_PART=1-2/3` on the NUC (`admin-c360-ro`, `admin-l1440-en`,
  `admin-m768-ro`, `admin-harness`) and `3/3` here (`admin-l1440-ro`), also for the fallback that reruns a dropped
  NUC's part here. Halves (`1/2`, `2/2`) were measured first: with the state checks of §33b this machine's two
  journeys (about 2.5 minutes each beside the functional tests) ended the stage at 560 s while the NUC was done at
  379 s, so the NUC, about twice as fast, takes three of the four journeys; `scripts/ci/run-all-checks.sh` forwards `E2E_ADMIN_PART` by name. Pinned by
  `scripts/ci/tests/test_e2e_split.py`.
- Measured before the checkers of §33b: a split `e2e` in 275 s (the NUC's part done at 220 s, this machine's at
  272 s) against 306 s with the whole admin chain on the NUC. With the checkers: 560 s with halves, 453 s with
  `1-2/3` : `3/3` (this machine done at 386 s, the NUC at 413 s).

### 33b. The generic checkers and the state inventory — APPLIED (gate-tightening)

- `assertLayoutSound` (`e2e/support/layout.ts`) and `assertAccessible` (`e2e/support/a11y.ts`) run on every state of
  `e2e/tour/states.ts` (the viewer's 30 states at every tour project; the admin's 15 states in the journey and the
  smoke at its four projects) and in the a11y specials; `docs/TESTING.md` → *The tour's checkers* lists every check.
  The checks are soft assertions: a test still fails on any violation, and one run reports them all.
- Axe in `assertAccessible` adds `wcag21a` and `best-practice` to the fixture's tags (the functional specs keep the
  fixture's set).
- Scenario rows: `S-V15-HAPPY` refined; new `S-V14-HAPPY-EVERY-STATE`, `S-V15-BAD-TEXT-SPACING`, `S-V15-BAD-REFLOW-320`;
  `S-V14-HAPPY-TOAST-ANNOUNCED` now exists (the live-region recorder `e2e/support/live-regions.ts`); behaviour A31
  (admin layout and accessibility) with `S-A31-HAPPY` and `S-A31-BAD-ALERTS`; `S-A29-BAD-UNKNOWN-ROUTE` now exists.
- One sanctioned stacking: the open FAB menu may cover what lies beneath it (`SANCTIONED_STACKINGS`).

### 33c. Config edits — APPLIED (they add a gate or keep the tools working)

- `vitest.config.ts`: a new project `e2e-support` (Chromium) runs `e2e/test/**/*.test.ts`, and its `coverage` lists
  the checkers' modules and `e2e/split.ts`, so the 90 % per-file thresholds hold them (Sonar counts `e2e/` as tests,
  so `scripts/ci/check_coverage.py` skips them; Vitest's own per-file thresholds are the gate).
- `eslint.config.js`: `e2e/test/**/*.ts` joins the Vitest file set (`TESTS`, the Vitest rules) and leaves the
  Playwright block (`ignores`), whose rules would read Vitest's `test` as a Playwright test.
- `e2e/tsconfig.json`: includes `split.ts`, `split-reporter.ts` and `test/`.
- `e2e/projects.ts`: the tour's test timeout from 120 s to 240 s (up to seven states per test, each through both
  checkers; a 3840 × 2160 journey took about 90 to 130 s on a loaded laptop). A longer timeout lowers no bar.

### 33d. Test fixes — APPLIED (a flaky race, not a product change)

- `e2e/admin/specs/journey.spec.ts`: the USGS countdown assertion read one exact second (`60`, then `55` after a 5 s
  jump) of a clock the spec keeps running for the Firebase SDK; under load it saw 54 and failed. It now asserts the
  jump took at least five seconds off and the 60 s window is still open (`docs/LESSONS.md` #54).
- `e2e/admin/specs/smoke.spec.ts`: a heading lookup that matched the list and the detail pane of the l1440 Setup
  page takes the first.

### 33e. `.github/workflows/ci.yml` and `nightly.yml`: the e2e matrices rebalanced — APPLIED (keeps the jobs within their timeouts)

Every tour state now runs both generic checkers: in the full run of 2026-10-17 the per-push tour took 1,192 s and the
tour matrix 4,038 s of the NUC's test time (about twice that on the laptop), against about 600 and 2,360 s of laptop
time before; the admin tier took 755 s with its state checks. The job that carried the admin, smoke, a11y, no-WebGL
and tour tiers (about 860 s before, 40-minute timeout) would carry about 3,200 s of laptop time, and each of the
nightly's two `tour-matrix` jobs about 4,000 s (45-minute timeout), both past their timeouts on a 4-vCPU runner with
Playwright's two workers. No tier, test or row moves:

```diff
-                    - part: admin, smoke, a11y, no-WebGL, tour
-                      tier: admin,smoke,a11y,nogl,tour
-                      shard: ''
+                    - part: tour 1/2
+                      tier: tour
+                      shard: 1/2
+                    - part: tour 2/2
+                      tier: tour
+                      shard: 2/2
+                    - part: admin, smoke, a11y, no-WebGL
+                      tier: admin,smoke,a11y,nogl
+                      shard: ''
```

The same in `nightly.yml`'s `e2e` jobs, and its `tour-matrix` stage in six count shards (`1/6` to `6/6`) instead of
`1-2/5` and `3-5/5`; the first shard (the 2560 and 3840 px frames) is the heaviest, at about 2,400 s of laptop time.
Verified with the workflow gates of `static` (`actionlint`, `workflow-schema`, `workflow-timeouts`,
`workflow-policy`, `action-pins`, `yamllint`, `prettier`). Retime from the first GitHub Actions runs.

### 33f. The admin's shell becomes an app shell — APPLIED (a product fix of the findings, for the user to see)

The admin agent's fixes of the admin's rows of `layout-a11y-findings.md` (its addendum lists them all). One changes how
the admin feels, so it is set out here: on every window the shell is now as tall as the window and only the page
scrolls (`.scroller` inside `<main>`), so the navigation bar, the rail and the top app bar keep their own places and no
content ever scrolls under them. Before, the document scrolled under the sticky bar at 360 px: a focused Setup header,
link, field or switch ended hidden under it (WCAG 2.4.11), axe found headers half covered (`target-size`), and at
1440 px the account button scrolled away with the top bar. The snackbar is docked below the page (it takes no room while
empty) instead of floating over it, where it hid the focused control too. The bar's More sheet now covers the window
(it covered only the bar, whose sticky host was its containing block).

The alternative was to keep the page scrolling and add `scroll-padding` for the bar: the focused control would clear it,
but whatever the page is scrolled to still lies under the bar (axe flags a target half under it), and the snackbar
would still cover the page. The cost of the app shell: a phone's address bar no longer hides as the page scrolls, and
Space or Page Down scroll the page only once it was clicked or something in it has the focus (as in the Google Cloud
console). Verified by
the admin tier at its four projects and `packages/ui/test/admin/shell/shell-layout.test.ts`.

### 33g. The verify pass: stricter checkers and a dark admin project — APPLIED (gate-tightening, logged)

The verify agent of 2026-10-17 resolved the open change request LA-6 and ran the visual audit the checks could not
replace (`docs/research/layout-a11y-findings.md` → *Addendum 2026-10-17: verify and visual audit*). No lint or tool
configuration changed; these make the existing gates stricter:

- **Touch targets are hit-tested** (`targetSizeOf`, `e2e/support/layout-probe.ts`): the kit's 48 px `touch-target`
  ring counts only as far as a pointer reaches the control (each side hit-tested at its middle; a side off screen or
  scrolled out of its list counts as computed). It read the pseudo-element's computed 48 px, which stays 48 px when an
  `overflow: hidden` cuts it (LA-6).
- **The open FAB menu's sanction is narrowed** (`SANCTIONED_STACKINGS`, `e2e/support/layout.ts`): it may cover the
  map's content and the two top docks it is designed to grow over (the consent banner, the toast), no longer any chrome
  (`under: '*'`). The audit found its last item on the timeline's thumb at 768 px.
- **No box scrolls sideways** (`sideways-scroll`, `e2e/support/layout-rules.ts`): every scroller of the page, not only
  the page, is checked for content wider than it (WCAG 1.4.10). The audit found a dialog's theme choice past its edge.
- **A focus ring must not be cut off** (`ringCutBy`, `e2e/support/a11y-probe.ts`): the Tab round reports a ring whose
  outline box leaves an ancestor that hides its overflow without scrolling. It found the map's ring cut away whole.
- **The admin runs in the dark scheme too**: the project `admin-l1440-dark` (`e2e/projects.ts`), dealt to part 1 of a
  split run (the NUC). It adds one admin journey and smoke, about 150 s of laptop test time, to the chain of CI's job
  "admin, smoke, a11y, no-WebGL" (40-minute timeout; about 760 s of admin test time before). Retime that job from its
  first GitHub Actions run.

The state screenshots behind the audit are `HCM_STATE_SCREENSHOTS` (`e2e/support/state-shots.ts`), off by default.

## 34. M2c admin editors (contracts agent, 2026-10-17) — PROPOSED

What the M2c contract (`docs/research/M2c-interfaces.md`) needs from files the workstreams may not change on their own,
and three product decisions for the user to see. Nothing here is applied yet: 34a is of the pre-approved kind (stricter or
equal) and is applied, verified and logged by the pois workstream in the change that moves the map; 34b and 34c change
what a gate measures or how long CI runs, so they wait for the user's answer.

### 34a. `.dependency-cruiser.cjs`: the map's new home and the draw library — APPLIED (2026-10-17, pois workstream; pre-approved kind: stricter or equal); its proposal (drop the empty `engine-browser` project) APPLIED 2026-10-18 (orchestrator decision)

The admin may not import the engine (`engine-and-admin-independent`), so `packages/engine/src/map/` moves to
`packages/ui/src/map/` (M2c-interfaces CR-M2c-1). The rule that guards Mapbox GL follows the file, and two new rules keep
Terra Draw out of the viewer and in one module:

```diff
         {
             name: 'only-the-map-adapter-imports-mapbox',
             severity: 'error',
-            comment: 'Mapbox GL is reached only through engine/src/map/mapbox-adapter.ts (MapPort), so the core is testable with FakeMap.',
-            from: { pathNot: '^packages/engine/src/map/mapbox-adapter\\.ts$' },
+            comment: 'Mapbox GL is reached only through ui/src/map/mapbox-adapter.ts (MapPort), so the core is testable with FakeMap.',
+            from: { pathNot: '^packages/ui/src/map/mapbox-adapter\\.ts$' },
             to: { path: 'node_modules/mapbox-gl/' },
         },
+        {
+            name: 'only-the-draw-adapter-imports-terra-draw',
+            severity: 'error',
+            comment: 'Terra Draw is reached only through ui/src/map/draw/terra-draw-adapter.ts (MapDrawPort, M2c-interfaces §4).',
+            from: { pathNot: '^packages/ui/src/map/draw/terra-draw-adapter\\.ts$' },
+            to: { path: 'node_modules/terra-draw' },
+        },
+        {
+            name: 'viewer-never-loads-the-draw-tools',
+            severity: 'error',
+            comment: 'The public viewer never ships the admin drawing tools.',
+            from: { path: ['^packages/engine/', '^packages/ui/src/(viewer|components|layout|theme|fonts)/'] },
+            to: { path: ['^packages/ui/src/map/draw/', 'node_modules/terra-draw'] },
+        },
```

Verify: `PIPELINE_STAGE=static` (the `dependency-cruiser` gate) after the move.

Applied by the pois workstream with the move (CR-M2c-1, 2026-10-17), exactly as the diff above: `npm run lint:deps` in the
quality image reports no violation (1060 modules). The move left the `engine-browser` project of `vitest.config.ts` without
a file (its one test, `adapter-env.test.ts`, now runs in the `ui` project, which is Chromium too); Vitest runs an empty
project without failing, so the config stays as it is. **Proposal** (ask-first file, not applied): drop that project and
the `engine` project's `exclude` of `packages/engine/test/browser/**` in the next change to `vitest.config.ts`.

### 34b. The admin page loads the ES module build — APPLIED 2026-10-18 (user approved 2026-10-18; §41a)

The admin page loads `admin.iife.js`, and an IIFE build inlines every dynamic import (§13a's finding for the engine), so
each M2c page and Terra Draw would sit in the one file the budget measures (311 KB gzip of 450 on 2026-10-17, before
M2c). Proposal: the admin page (`scripts/site/src/admin/page.ts`) loads `admin.mjs` as a module script, which already
splits lazy chunks (the analytics SDK is one today); each area's page and the draw library become chunks loaded when
their route opens; the build is minified like the engine's (§17a). `scripts/ci/check_bundle_budget.py` then measures
`admin.mjs` (the entry, 450 KB) and the largest lazy chunk (a new budget), instead of `admin.iife.js`. The alternative is
to keep the IIFE and minify it, which keeps everything in one file and the same budget. Verify: `PIPELINE_STAGE=build`
(`bundle-budget`) and the admin tier.

### 34c. The admin's journeys at the tour projects — APPLIED 2026-10-18 (orchestrator decision; §37b)

Every new admin screen and state must pass the generic checkers at every tour viewport, light and dark (the task's rule;
M2c-interfaces §12.2), while today the admin's states run at its six admin projects only. Proposal: one tour file per
area (`e2e/tour/admin-<area>.tour.ts`) at the tour projects, as the viewer's: the per-push `tour` tier's nine projects
and the `tour-matrix` stage's other 35 (nightly and in `all`); each journey in its own city of the content world
(M2c-interfaces §12.3), so they need no lock. Cost: about 70 states, so roughly as many admin tour tests as the viewer's
per project; the `tour` jobs of `ci.yml` and the `tour-matrix` shards of `nightly.yml` need rebalancing from the first
measured run (a workflow edit that keeps the jobs within their timeouts: the pre-approved kind once measured).

### 34d. Information: Terra Draw, not Mapbox GL Draw — PROPOSED (a decision for the user to see)

`terra-draw` 1.37.0 and `terra-draw-mapbox-gl-adapter` 1.5.0 (MIT, no runtime dependencies, the adapter's peer
`mapbox-gl ^3.9.2`) behind our own `MapDrawPort`, bundled into the admin only. Mapbox GL Draw 1.5.2 (ISC) states no
Mapbox GL v3 support, brings a control and a stylesheet we would have to hide (its buttons are under 48 px) and has no
validation hook. The comparison is M2c-interfaces §4.1.

### 34e. Information: a deleted layer's tileset goes after seven days — PROPOSED (a decision for the user to see)

Deleting a layer removes its document at once (it leaves the public map within a minute) and queues the deletion of its
Mapbox tileset and source for seven days later, so History can restore it without reprocessing (which would cost
compute units). Mapbox bills the tileset's hosting meanwhile (within the free tier for a few layers). M2c-interfaces §8.4.

### 34f. Information: an English title is not required to publish — PROPOSED (a decision for the user to see)

The M2 row `S-A10-BAD-MISSING-EN-TITLE` ("A photo without an English title cannot be published") contradicts CR-1 of
`M1-interfaces.md` (Romanian required, English optional, the viewer falls back to Romanian). It is replaced by
`S-A10-BAD-NOT-PUBLISHABLE` (processing not done, failed, or the licence unknown: the rules' publish gate).

### 34g. Installing Terra Draw — APPLIED 2026-10-18 (user approved 2026-10-18; §41b)

The pois workstream (2026-10-17) built `MapDrawPort` with two implementations: the Terra Draw adapter
(`packages/ui/src/map/draw/terra-draw-adapter.ts`, written and unit-tested against the structural types of
`terra-draw-types.ts`) and click-only drawing on `MapPort` (`click-draw-adapter.ts`: a point is one click, a line and an
area grow with every click, vertices are moved and removed in the vertex list). The admin uses the click-only tools until
the packages are installed, because installing `terra-draw@1.37.0` and `terra-draw-mapbox-gl-adapter@1.5.0` downloads
them from the npm registry. With a yes: install both, exact, as dependencies of `@hcm/ui` in the pinned Node container
(`docs/SETUP.md` → *npm in a container*), check `npm audit --audit-level=low`, add the loader and pass it as `terraDraw` in
the pois section of `packages/admin/src/app/content-wiring.ts` (M2c-interfaces CR-M2c-20). Dragging a whole shape, a
vertex or a midpoint on the map comes with it. Verify: `PIPELINE_STAGE=tests` (a browser test with the real Terra Draw),
then `build` (the bundle budget, §34b).

### 34h. The admin's Mapbox GL JS without Subresource Integrity — APPLIED 2026-10-18 (orchestrator decision): the stricter option

The admin adds `mapbox-gl.js` of the pinned release from `api.mapbox.com` when its first map opens (`loadMapboxGl`,
`packages/ui/src/map/mapbox-loader.ts`), so the Setup pages never load it. The viewer's page names the script with an
`integrity` hash the site build computes; the lazily added script has none (the CSP still limits scripts to
`https://api.mapbox.com/mapbox-gl-js/`, as for the compare plugin). Stricter option: the admin page's build writes the
hash into the page (a `data-mapbox-integrity` attribute the entry reads) and the loader sets `integrity` and
`crossOrigin` with it. Verify: `PIPELINE_STAGE=build` and the admin tier.

### 34i. The dashboard as the admin's first screen — APPLIED 2026-10-18 (user approved 2026-10-18; §41c)

The M2c brief's "dashboard home" is built as `#/home` (behaviour A40, `M2c-interfaces.md` CR-M2c-24): what the city
holds, what waits for an admin (photos in rights review, unpublished photos, running and failed jobs), each a link to its
page, one chip per Setup area from `setup/status` and the public map's state. It is the first destination of the rail
and the drawer, and under More on the compact bar, whose four places stay Setup, Photos, Places and Layers. An empty
address still opens Setup (M2b's rule, `packages/admin/src/routing/router.ts`). Proposal: once Setup is complete, an
empty address opens the dashboard, and the dashboard takes Setup's place on the compact bar (Setup moves under More).
With a yes: the target of `isBlank` (`resolveAdminRoute`) and `ADMIN_ROUTE_SPECS` in `packages/admin/src/routing/`, their tests, and the
`S-A40-*` rows. Verify: `PIPELINE_STAGE=tests`, then the admin tier.

## 35. M2c integration (integrator, 2026-10-18)

The integrator wired the four workstreams' editors into the shell, ran the cross-app journeys on the emulators and resolved
the change requests that fell to it (`M2c-interfaces.md` §13). Nothing was committed, pushed or deployed; no real Google,
Mapbox or USGS endpoint was called. Applied items are of the pre-approved kinds (stricter, or a product fix the checks
found); the rest wait for the user.

### 35a. The editors' catalogue split per area (CR-M2c-25) — APPLIED (structure, no gate changed)

`packages/shared/src/i18n/admin-content/{ro,en}.ts` had reached about 800 lines each, past ESLint's `max-lines` (400), so
`static` failed on them. They are now one catalogue folder per area at the depth the `i18n` gate already reads
(`packages/*/src/i18n/*`): `admin-content/` keeps the kit's and the map's sections, `admin-photos/`, `admin-pois/`,
`admin-layers/`, `admin-settings/` and `admin-ops/` (admins, history, jobs, crash reports) hold the rest, and
`admin-content/index.ts` merges them into `translateAdminContent` and `ADMIN_CONTENT_CATALOGUES`. The split moved the 769
keys unchanged; `packages/shared/test/i18n-admin.test.ts` checks each folder's sections and prefixes, that no key is in two
folders and that the merge holds them all. No configuration changed (the `i18n` gate counts 10 catalogue folders now).

### 35b. The Bucharest site names another city than the project — APPLIED 2026-10-18 (orchestrator decision): option 1

The built site (`sites/bucharest/config.js`) and the legacy manifest (`seed/bucharest/manifest.static.json`) name the city
`bucuresti`; the project (`infra/project.json`), the admin and therefore every manifest the backend builds name it
`bucharest`. The viewer refuses a manifest of another city ("cityId din config.js (bucuresti) nu corespunde hărții
(bucharest)"), so the site cannot switch to the backend's manifest as it is. The admin-to-viewer journeys serve the site a
`config.js` naming `bucharest` meanwhile (`e2e/admin/support/flows.ts`). Options: (1) the site's `config.js` names
`bucharest` when its `manifestUrl` moves to the public bucket (visitors' stored language and theme, kept per city id, are
read once under the old id and written under the new one), the recommended one; (2) rename the project's city to
`bucuresti` (`infra/project.json`, the e2e worlds), which also changes the Firestore paths. `seed/bucharest/` stays as
migrated either way (ask first). Verify: the A41 journeys without the routed `config.js`.

### 35c. The history collection-group read narrowed — APPLIED (stricter; logged)

CR-M2c-6's `match /{path=**}/history/{entry} { allow read: if isAdmin(); }` let an admin read a `history` document
anywhere, `setup/status/history/h1` included, which the rules matrix's default-deny test refused. Now:

```diff
         match /{path=**}/history/{entry} {
-            allow read: if isAdmin();
+            allow list: if isAdmin();
+            allow get: if isAdmin() && path[0] == 'cities';
         }
```

A condition on the path cannot hold for a collection-group query (the emulator then denies the whole query), so `list`
stays open to admins: an admin could still list a `history` collection outside `cities/`, where nothing writes one.
Verified by `firebase/rules-tests` (203 tests, the `rules-coverage` gate) in `PIPELINE_STAGE=tests`.

### 35d. The place editor's texts commit on each key — APPLIED (a product fix the A41 journey found); its alternative for numbers APPLIED 2026-10-18 (orchestrator decision)

The place editor's titles, descriptions and links committed on `change`; a new place's Romanian title typed and then a
click on Save did nothing, because Save was still disabled (the draft had no title yet) and a disabled button takes no
click, so the field was never left. They commit on `input` now, as the photo editor's texts already did
(`packages/ui/src/admin/pois/poi-fields.ts`). Years (and the photo editor's numbers) still commit on `change`: half a
number is not a year and would flash an error. A year-only edit therefore still needs the field left (Tab) before Save:
for the user to see; the alternative is to commit numbers on `input` and show their errors only once the field is left.

### 35e. A revoked admin's open draft is lost — APPLIED 2026-10-18 (orchestrator decision)

When the owner removes an admin who is editing, the admin's next Save is refused (the rules need `admins/{uid}`), the shell
asks `admin.session` again and replaces the page with "This Google account does not administer this map": the draft goes
with it. `S-A20-BAD-REVOKED-WHILE-EDITING` (planned) wants the draft to stay visible until sign-out. Proposal: on that
transition the shell keeps the open page read-only under a banner ("Your access was removed: copy what you need, then sign
out") while an area holds unsaved changes; the stores stop their listeners but keep their drafts. `S-A02-BAD-REVOKE` now
proves the refusal, that nothing is written and the panel (`e2e/admin/specs/flows/revoke.spec.ts`).

### 35f. The admin bundle is at its budget — APPLIED 2026-10-18 (orchestrator decision): minified like the engine's (§36d); §34b still waits for the user

`admin.iife.js` measures 448.1 KB gzip of its 450 KB budget with every editor wired (`PIPELINE_STAGE=build`,
2026-10-18). Terra Draw (§34g) or the next area will not fit. §34b (the admin page loads the ES module build, each area
and the draw library a lazy chunk, minified as the engine's) or its alternative (minify the IIFE) needs the user's answer
before M3.

### 35g. The editors' states at every tour viewport (§34c) — APPLIED 2026-10-18 (orchestrator decision; §37b)

The M2c states pass the generic checkers at the five admin projects (c360, m768, l1440 in light, dark and English). The
review screenshots of every state at 360 × 800, 768 × 1024, 1440 × 900 and 2560 × 1440, light and dark
(`reports/screenshots/m2c/`, `docs/TESTING.md` → *Review screenshots*) were looked at instead; running the checkers there
is §34c's CI time, which waits for the user.

### 35h. What the review screenshots showed — APPLIED (product fixes, each with a check)

The contact sheets of every editor state at 360 × 800, 768 × 1024, 1440 × 900 and 2560 × 1440, light and dark
(`reports/screenshots/m2c/sheets/`), showed four defects the checkers had passed, each now fixed and pinned by a test
(`docs/LESSONS.md` 81–84): the map box an empty block without a map (`hcm-admin-map[no-map]`), the layer editor's Romanian
and English texts out of their columns on wide panes, "Configurare" broken across two lines on the phone's bar (the bar's
items lost their 4 px inline padding), and the chosen position of the list of positions filled with a colour that left its
fields at 1.27:1 in high contrast (now ringed). One gap of the checkers is recorded for their owner: a state's checks
measure only what is scrolled into the window, so a fault below the fold waits for a layout change to be seen (lesson 84).

## 36. M2c follow-ups (follow-ups agent, 2026-10-18) — APPLIED 2026-10-18 (orchestrator decisions and pre-approved kinds, logged)

The orchestrator's decisions of 2026-10-18 (the headings of §34a, §34h, §35b, §35d, §35e and §35f say so), the M2c change
requests that needed no answer from the user (CR-M2c-15, -27, -28, -29), the state checker's scroll sweep (lesson 84),
the account menu after a rotation and the two polish items the deployed admin showed on 2026-10-17. Nothing was
committed, pushed or deployed; no real Google, Mapbox or USGS endpoint was called. The admin's tour at every viewport
(§34c, §35g) is the E2E agent's.

### 36a. The decisions as applied

- **§35b option 1**: `sites/bucharest/config.js` names `bucharest`; `sites/bucharest/site.json` names the seed's city
  (`legacyCityId: "bucuresti"`), and the site build serves that manifest under `config.js`'s id (any other mismatch still
  fails the build, `scripts/site/src/build.ts`). `seed/bucharest/` is untouched. The e2e fixture manifest names
  `E2E_CITY_ID` (`bucharest`) and `e2e/admin/support/flows.ts` serves the built site as it is (no routed `config.js`). No
  one-time read of the old `hcm:bucuresti:*` preferences: the new site is not live, so no visitor has any.
- **§34h stricter option**: the admin's site build writes the digest of the pinned `mapbox-gl.js` into
  `<html data-mapbox-integrity>`; `loadMapboxGl` sets it as the script's `integrity` with `crossOrigin` (a value that is not
  a SHA-384 digest is ignored, `pageIntegrity`).
- **§35d alternative**: the photo editor's numbers and the place editor's years commit on `input`; `numberValue` keeps the
  admin's own spelling of the same number (`44.40`, an unfinished `44.`), and `LeftFields` shows a number's problem only
  once the field has been left (`packages/ui/src/admin/editing/number-fields.ts`). A year typed and then a click on Save
  saves.
- **§35e**: a denial makes the shell ask `admin.session`; not an admin while an editor holds unsaved changes, the shell
  sets `revoked` instead of the `notAdmin` panel: the page and its draft stay under an alert banner with Sign out, every
  editor write is refused at once (`writesRefusedWhen`) and no further denial asks again; Sign out asks to discard first
  (`S-A20-BAD-REVOKED-WHILE-EDITING`, `exists`; the state `admin.session-revoked` joins the inventory).
- **§34a proposal**: `vitest.config.ts` drops the empty `engine-browser` project and the `engine` project's `exclude`.
- **Bundle (§35f)**: §36d.

### 36b. A start-up deploy says so (the live CORS error) — APPLIED; for the user to see

Before the server exists, the anonymous probe of `admin-session` meets a 404 without CORS headers, which the browser
logs as a CORS error. Tried in Chromium first: a `no-cors` request only trades it for "Failed to load resource: 404";
every answer of 400 or more is logged whatever the mode. So a new map's Hosting-only deploy now says it has no server:
`HCM_ADMIN_START_UP=1 npx firebase deploy --only hosting` (the predeploy's `build:admin` writes `runtime.json` with
`startUp: true`), and the admin calls nothing of the server until step (d) sees every function `ACTIVE` on Google. A
browser that has had the server's answer probes anyway (`hcm:admin:serverSeen`), so a functions-only deploy that leaves
the start-up page in place still works. Without the variable the probe runs as before (`S-A25-BAD-NO-START-UP-DEPLOY`).
**For the user**: the live admin keeps logging the error until it is deployed again that way (ask first).

### 36c. The release — APPLIED (a fix)

`scripts/site/build-admin.ts` writes `runtime.json` itself (§23b's redesign, its first half): `release` is
`<root package.json version>+<short commit>` (`HCM_COMMIT`, else `GITHUB_SHA`, else the checkout's `HEAD`; the version
alone outside a checkout). The boot log and the crash reports name it instead of `dev`. The App Check site key joins it
with the deploy milestone.

### 36d. The admin bundle minified — APPLIED (the orchestrator's decision; no budget changed)

Vite's library mode already minified the IIFE (its JavaScript); what was left was the text of the Lit `css` templates,
about 77 KB of indentation and comments. `packages/admin/vite.config.ts` now runs `cssLiteralsPlugin`
(`scripts/site/src/css-literals.ts`: outside strings, comments and indentation go, and the spaces around `{ } ; ,` and
after `:`; every line break stays, so the source maps hold) and minifies `admin.mjs` like the engine's (§17a). Measured
in the quality image, production build, 2026-10-18:

| File | Before | After |
| --- | --- | --- |
| `admin.iife.js` (the budget, 450 KB) | 1,665,267 B, 448.1 KB gzip | 1,622,593 B, 443.6 KB gzip |
| `admin.mjs` | 1,841,325 B, 450.2 KB gzip | 1,496,221 B, 408.8 KB gzip |

§34b (the module build with lazy chunks) still waits for the user; it is what makes room for Terra Draw (§34g).

### 36e. Configuration edits — APPLIED (pre-approved kinds: stricter, or keeping the tools working)

- `vitest.config.ts`: `e2e/support/scroll-probe.ts` joins the `e2e-support` coverage list (stricter: one more file at 90 %);
  the `engine-browser` project went (§34a).
- `tsconfig.tools.json`: `references` the `scripts/site` project, as the admin's Vite config now imports its minifier
  (keeps `tsc -b` working).

### 36f. The state checker sees the whole state — APPLIED (gate-tightening; one narrowing it makes safe)

`expectStateSound` ends with the scroll sweep (`e2e/support/scroll-sweep.ts`, `docs/TESTING.md` → *The tour's
checkers*): every box a visitor scrolls is scrolled through its content and the position-dependent checks (layout, target
sizes, non-text contrast in both schemes, axe's colour contrast) run at each position; only new violations are reported.
With it, CR-M2c-29 (c) narrows the occlusion check: a sliver of at most 5 px of a control at the edge of what scrolls is
not counted (Chromium hit-tests the clip's last fraction of a pixel as the element beyond it), since the sweep checks the
control whole at another position. The admin base ring (CR-M2c-29 a) and the dialog's 4 px above its actions (b) are kit
fixes; the layers area's two workarounds went with them. Its first runs (the `e2e` and `tour-matrix` stages, 2026-10-18) found no new fault: the
viewer's 44 viewports and the admin's five projects passed with the sweep (1044 extra positions in `tour-matrix`
alone; `docs/research/layout-a11y-findings.md`, its addendum).

### 36g. Information: the error group link (CR-M2c-15)

`gcp.errorGroup` (`https://console.cloud.google.com/errors/detail/{groupId}?project={projectId}`) joined
`packages/admin/src/setup/links.json` in the console's documented form; the weekly contract run checks it and opens an
issue if it does not resolve (not dispatched: a workflow run is ask first).

## 37. M2c end-to-end (E2E agent, 2026-10-18) — APPLIED (test infrastructure, product fixes with their tests, orchestrator decisions §34c and §35g); §37e, §37g and §37i for the user

Every admin and cross-app row of `e2e/scenarios.json` that the screens support became a Playwright spec (108 rows from
`planned` to `exists`; `docs/E2E_SCENARIOS.md` regenerated). Nothing was committed, pushed or deployed; no real Google,
Mapbox or USGS endpoint was called; no package was installed (Terra Draw waits for §34g).

### 37a. The content world (CR-M2c-7) — APPLIED (test infrastructure)

A content spec gets a city (`w-<10 hex>`) and a Google account (`editor-<hash>@content.e2e.test`) of its own, an admin
of the map, and takes no lock: `EmulatorWorld.reset` of a locked test now deletes everything but the content worlds
(Firestore, Auth and Storage alike), so the editors' specs run on every worker beside the locked chain (Setup, the
session, admins, crash reports, Home). The `e2e` build's kit reads `?city=` (already there) and a new `?mapToken=`
(`e2eMapToken`, `packages/admin/src/index.ts`: a `pk.` token for the admin map, `none` for no map), so a content spec
never reads the singleton `setup/status`. The admin map draws in e2e on the mock Mapbox CDN, style and tiles; the e2e
admin server's CSP adds the e2e tile host to `connect-src` (as an XYZ server's host is added by hand in production).

### 37b. The admin editors in the tour (§34c, §35g) — APPLIED (orchestrator decision)

The editors' states run at every tour project, like the viewer's: `e2e/tour/admin-{photos,places,drawing,layers,
settings,jobs,history}.tour.ts` (15 tests, each in a city of its own) at the nine per-push `tour` projects and the 35 of
`tour-matrix`; the run starts the admin server and the emulators for the tour tiers too (`needsAdmin`,
`e2e/projects.ts`). The singleton screens (Setup, the sign-in, the claim, Admins, Crash reports, Home, a revoked
session) stay in their locked specs at the five admin projects: a tour of them would hold the lock across 44 projects.
A part that waits on the viewer (the area the viewer draws) stays in `e2e/admin/specs/`. Measured on the laptop,
2026-10-18, against fresh emulators: the per-push admin tour, 127 tests, 10.3 minutes of wall time, 126 green at the
first full run (the one red, the layer editor's map checked before its attribution: fixed, §37d). Its first runs found
lesson 107 (the editors flapped at 915 × 412). The CI tour jobs are rebalanced from the measured run (§37h).

### 37c. New admin projects — APPLIED (they add checks)

- `admin-steps-l1440-en` (`e2e/admin/steps/`): the Setup Assistant's steps one by one, each from a seeded state
  (`e2e/admin/support/steps.ts`): billing, provisioning, the server's installation and the claim, Mapbox, USGS,
  analytics, the page as a whole, sign-in and invitations, start-up mode, Google's consents and the legacy import. One
  project, in English: they check the server's answers and the cards' words, which do not depend on the window; the
  layout is the journey's (five projects) and the tour's.
- `admin-firefox-l1440-ro` and `admin-webkit-l1440-ro` (`e2e/admin/specs/editing/`): the editors' forms in Firefox and
  WebKit. `E2E_ADMIN_PART` deals them like the others (part 1 gets the steps, part 2 Firefox, part 3 WebKit).
- The fake upstreams gained `service-usage.billingApisEnabled`, `billing-budgets.appBudget` and `.staleBudget`,
  `monitoring.crashAlertsProvisioned`, and a gapi loader for Firebase Auth on Safari (`google-apis`, lesson 109).

### 37d. The checkers — APPLIED (refinements; nothing allowlisted)

- The legal rule applies to a map whose foot is in view (a map scrolled past its bottom shows its legal line no more
  than the rest of what is cut; the scroll sweep checks the positions that show it).
- A map's own controls over its canvas are the map (`ownMapControl`): a canvas scrolled to a strip had a sample on its
  own attribution (lesson 108).
- A state waits up to 60 s for its maps to load and fill their attribution (`MAPS_LOADED_MS`, was 15 s); the layers
  journey waits for its editor's map before the check.
- A console error "Failed to load resource" names its address; the waits on the Functions emulator share
  `FUNCTIONS_TIMEOUT_MS` (120 s).
- A state also waits while an admin map box is still creating its map (lesson 115).
- The occlusion check samples a control only inside its own shape, the corners of a rounded border left out (lesson
  123: the round colour presets of Settings, scrolled to a strip at 320 × 568).
- Tests without the lock touch only their own world: a content world's admin joins after the personas and leaves at
  teardown, and a test whose answer depends on `setup/owner` holds the lock (lesson 113); a locked test's reset keeps
  the content worlds' public photo files, which it deleted by reading a derivative's photo id as its city (lesson 116);
  the emulator helpers send a request again when the emulator drops the connection (lesson 119); the console guard of
  the admin projects expects the 400 or 409 of a transaction commit Firestore's SDK runs again, with its reason
  (lesson 117); Setup's `show` opens a card again when Setup moved on meanwhile.

### 37e. Rows still planned: what the screens lack — APPLIED 2026-10-18 (§42a–§42c: the screens exist, their rows too; Terra Draw's drags §41b)

Each row's `notes` says why: the self-test's per-check list (`S-A03-BAD-SELFTEST-FAILURE`: Re-check applies the status
but no screen lists the checks, so a failing check's reason and its link to Provision have nowhere to show); a control
for `setup.rotatePublicToken` (`S-A06-HAPPY-ROTATE`); the settings page's map (`S-A19-HAPPY`, `S-A36-HAPPY`,
`S-A36-BAD-DISCARD`); the conflict banner's name and time (`S-A38-BAD-CONFLICT`: the draft keeps `updatedBy`, nothing
names it); Home's list of the documents the build skipped (`S-A38-BAD-SKIPPED-SHOWN`); Terra Draw's drags
(`S-A32-HAPPY-VERTEX-EDIT`, §34g). Two cannot be reached in e2e: `S-A19-BAD-LOW-CONTRAST-SEED` (no seed colour makes the
tone algorithm adjust; unit-tested) and `S-A20-BAD-NO-APP-CHECK` (the emulator enforces no App Check). The M3 and M4
rows (A09's assists, A11 to A17, V06) and the pipeline's wait for their milestones.

### 37f. Product fixes — APPLIED (each with its unit test; `docs/LESSONS.md` 90 to 122)

The admin map hidden under a modal dialog (its legal line); Select all before any row is ticked; a click moves the
selected pin; an upload waits for the city's centre; the shell's theme follows the edited city; the import preview
planned again when its lists arrive; the list of positions put back after a refusal; the toolbar follows the drawing
session; the import's limit named with its numbers; the outside-the-city refusal names its limit (RO and EN); Back from
an item opened by its address stays in the admin; a landscape phone keeps its page heading; the places list previews
the open draft; a new place gets its remembered category once the categories arrive; a refused Mapbox or USGS save
shows the chip the server recorded; a provisioning item keeps its reason once recorded; a token expired mid-run offers
Continue; the start-up record survives a reload before the claim; the list and detail never split at a compact height;
"Add at centre" waits for the city's view (lesson 111); the Setup's analytics card checks Google Analytics only while the
Setup page shows, not on every page of a session (lesson 112); a line or an area keeps its first clicks when its place
is applied again (lesson 114); a create that finds its own landed attempt is no conflict (lesson 117); a photo's Save refused for a newer version of
other fields goes again once that version is here (lesson 118); a server probe that timed out is sent again before the
shell decides there is no server (lesson 120); a delete's history entry is never stamped before the version it deleted
(lesson 121); right after a Save, a settings or layer draft is not unsaved until the next edit (lesson 122).

### 37g. WebKit's report-only Trusted Types header — for the user

Safari applies `Content-Security-Policy-Report-Only: require-trusted-types-for 'script'` (firebase.json) and logs that
the policy "will have no effect" without `report-to`, then reports Firebase Auth's gapi loader (a script URL set as a
string), on every page load. Chromium reports the same loader once a Google popup opens. Options: give the header a
`report-to` endpoint (the crash endpoint could take it), or drop it until Trusted Types are enforced. The WebKit project
expects these two messages (and the CSP refusals of Playwright's own inspector styles) with their reasons.

### 37h. CI and the split — APPLIED (pre-approved kind: keeps the jobs within their timeouts)

The tour tiers now start the admin server and the emulators. Measured in the split quality run of 2026-10-18 (test
seconds on the NUC beside every other tier): the per-push tour about 4,150 s (the admin's editor journeys about 2,900 s
of it, 200 to 480 s a project), the admin tier about 3,100 s. `.github/workflows/ci.yml`: the tour in three count shards
(was two) and the admin, smoke, a11y and no-WebGL tiers in two (was one): eight e2e jobs, the heaviest about 1,400 to
1,600 s, within the 40-minute timeout. `nightly.yml`: the same eight, and `tour-matrix` (35 projects, now with the 14
editor journeys each, about 17,500 s) in ten count shards (was six). `docs/CI_PIPELINE.md` says the same. Pre-approved
kind (keeps the jobs within their timeouts); nothing else in the workflows changed.

### 37i. Two sliders named "Opacity: Photos" in English — for the user

The viewer's Layers panel names each overlay's slider after its title. A category named "Photos" (its own id,
`photos-<suffix>`, `S-A39-BAD-ID-CLASH`) gives the English panel two sliders of the same name, the photos' own and the
category's: a screen reader cannot tell them apart. Options: name the photos' slider by its kind ("Opacity: all
photos"), or add the overlay's kind to every slider's name. The e2e helper takes the photos' own slider (the first one).

## 38. Minimum admin input (adversarial reviewer, 2026-10-18) — APPLIED (§38a–§38c, each with its tests); §38d for the user

Every Setup step and daily flow was walked and its inputs counted against `SETUP_STEP_SPECS` and
`CONTENT_INPUT_BUDGETS`. Three inputs went away; the budgets were lowered with them and the flows that had a budget but
no counted test now have one.

### 38a. A pasted Mapbox secret token saves itself — APPLIED

Step (e) took two inputs (paste, Save) where the USGS paste already took one. A paste (`insertFromPaste`) of a value that
classifies as a secret (`classifyMapboxToken`) now goes to `setup.saveMapbox` at once and the box clears; a public `pk.`
or malformed paste is explained and only counted, nothing sent; a typed token goes with Enter or Save. `SETUP_STEP_SPECS`
mapbox 2 → 1, so `setupInputBudget()` is 9 inputs and 4 consents (was 10). Tests: `hcm-setup-credentials.test.ts`,
`e2e/admin/steps/mapbox.spec.ts` (`S-A05-HAPPY`: `flow.used` is 1), the journey (one retry paste, allowance 1).

### 38b. A new category's icon follows its label — APPLIED

Adding a category took four inputs (Add, the label, an icon, Save) although the label usually names the icon. Until the
admin picks one, a new category's icon is `guessCategoryIcon(label)` (`packages/admin/src/settings/icon-guess.ts`:
Romanian and English word starts, without diacritics, the specific kinds before the generic ones; else the pin). An icon
picked by hand is never replaced. `CONTENT_INPUT_BUDGETS.category` 4 → 3. Rows: `S-A39-HAPPY` (reworded),
`S-A39-BAD-ICON-NOT-GUESSED` (new, `exists`).

### 38c. A new invitation's link is copied at once — APPLIED

Inviting an admin took four inputs (Invite, the address, Invite, Copy). The link now goes to the clipboard from the click
that made the invitation, with "The link was copied." said; a browser that refuses leaves Copy as before.
`CONTENT_INPUT_BUDGETS.inviteAdmin` 4 → 3, counted in `e2e/admin/specs/ops/ops.spec.ts` (the clipboard holds the link).
`revertChange` and `revokeAdmin`, declared but not counted, are now counted in `e2e/admin/specs/flows/publish.spec.ts` and
`revoke.spec.ts`.

### 38d. Not done: what would cut more, and why it waits — for the user

- **Add place in one click per shape** (Add point, Add line, Add area in the list's head instead of Add place, then the
  shape): a point 5 → 4 inputs, an area 4 + n → 3 + n. It changes the places list's head at every window class (the
  tour state `pois.add-shape` goes away) and about 30 test call sites the places workstream owns; a reviewer's small fix
  it is not.
- **The photos of a batch selected after their upload**, so Publish is one click (3 → 2): the bulk bar then shows on
  the photos tour states after every upload, and the selection has to survive the list's reloads while the photos are
  processed. Worth a decision on whether a fresh batch should be the selection.
- **USGS stays three inputs**: the ERS username cannot be read from anywhere the app may look; the token page and the
  paste are already one click and one paste.
- **A place's title from its position** (reverse geocoding) is behaviour A09 with Nominatim, M3.
- **Billing, provision, analytics and the import** are one input each, consents apart; a single billing account is
  already chosen without a click.

## 39. Quality review: e2e time, docs (adversarial reviewer — quality, 2026-10-18) — APPLIED (39a, 39b: no check, gate or scenario dropped); 39c for the user

Measured in `docs/research/pipeline-baseline.md` → *Addendum: the quality review*. The split `quality` had grown from
324 s to 1,002 s with the admin's journeys in the per-push tour and the generic checkers on every state.

### 39a. axe runs in place on a page of one frame — APPLIED (performance; same rules, same results)

`axeViolations` (`e2e/support/a11y.ts`) ran `AxeBuilder`'s default mode for every check: axe-core injected into the
page and every frame, a per-frame partial run, then a blank page with axe injected again to merge the results; about a
second per state and half a second per scroll-sweep position on an admin page whose own `axe.run` takes a sixth of
that. A page of one frame now runs in legacy mode on the first check of a document and through the injected `axe.run`
afterwards, reporting violations only; a page with frames keeps the default mode (which also tests cross-origin
frames). A differential run of both ways on every call over 134 tests and a page with planted violations found no
difference.

### 39b. A failed test's trace without DOM snapshots and screencast — APPLIED (performance; diagnostics, not a gate)

`trace: 'retain-on-failure'` recorded a DOM snapshot and a screenshot at every action of every test, passed or failed,
and the checkers' probes and Tab presses are hundreds of actions per state: 40 % of a tour project's test time, 20 % of
a functional one's. `e2e/playwright.config.ts` now keeps the trace of a failed test without them (actions and timings,
console, network, the error) and adds its screenshot (`screenshot: 'only-on-failure'`) beside Playwright's error
context; the full trace is one rerun away (`--trace retain-on-failure`). With 39a: −45 % test time on the tour and
admin projects measured, −20 % on a functional one.

**For the user**: if a failing CI run should carry the full trace anyway, `trace: 'on-first-retry'` in CI (where a
test is retried once and a pass on the retry still fails the run) would add it at the cost of the retry's time only.

### 39c. What would bring the split `quality` to about 8 minutes — APPLIED 2026-10-18 (§42g)

After 39a and 39b the estimate is 600 to 650 s before the split's shares are retuned (the next split run measures
it; `default_parts` of `scripts/ci/e2e-split.sh` follows). What remains, each a coverage choice rather than waste:

- **The Setup journey at five admin projects** (`admin-{c360,m768,l1440}-ro`, `admin-l1440-dark`, `admin-l1440-en`): about
  580 s of test time behind `ADMIN_LOCK`, so it runs one at a time on each machine; at two projects per push (the
  others nightly) the locked chain would shrink by about 350 s.
- **The fifty-category state** (`admin-settings.tour.ts`) at all nine per-push tour projects: about 50 s each under
  load, 26 s idle; the per-push tour could check it at the four viewports and the other five in `tour-matrix`.
- **The functional tier** runs the same 105 specs at five projects (2,650 s); specs that do not depend on the window
  class (deep links, consent, language) could run at one.
- **The admin's per-push tour** could take the viewer's four viewports in light only, the dark and English variants
  moving to `tour-matrix` (about 1,450 s of the per-push tour's 2,640 s of admin journeys before 39a and 39b).

## 40. M2 final gate (final-gate agent, 2026-10-18) — RESOLVED 2026-10-18 (§40a: the database exists in nam5)

The state of M2 and the deploy steps are in `docs/research/M2-status.md`. Nothing was committed, pushed or deployed.

### 40a. The Firestore location — RESOLVED: the database exists in nam5

`firebase.json` names the `(default)` database but no `location`. The first `firebase deploy --only firestore` on a
project without a database creates one, and firebase-tools 15.33.0 then uses `nam5` (US multi-region;
`node_modules/firebase-tools/lib/deploy/firestore/prepare.js`, `createDatabase`). A database's location can never be
changed, and the provisioner does not create the database. The functions, the queue and the buckets are in
`us-central1` (`infra/project.json`).

Options, before the first rules deploy:

1. Add `"location": "us-central1"` to `firebase.json`'s `firestore` (one region, next to the functions: the cheapest and
   fastest for the server; the public viewer never reads Firestore, so the visitors' distance does not matter).
2. Leave it out: `nam5`, the console's default for a US project (multi-region, the same free quota).
3. A European region (`eur3`, `europe-west1`): nearer the admins in Romania, farther from the functions.

Recommended: option 1. If the project already has a database (check with
`gcloud firestore databases list --project bucurestiul-disparut`, read-only), its location stays and `firebase.json` names it.

**Resolved 2026-10-18**: the project's `(default)` database already exists in `nam5`: it was created with the project on
2026-10-11, and the orchestrator deployed the rules and indexes to it on 2026-10-12. Options 1 and 3 are moot (a location
never changes). `firebase.json`'s `firestore` now names `"location": "nam5"`, so a deploy to a project that lost its
database could never create one elsewhere, and `firebase/rules-tests/test/firebase-config.test.ts` pins it.

## 41. The user's decisions §34b, §34g and §34i, and the review polish (M2c follow-ups, 2026-10-18) — APPLIED 2026-10-18 (user approved 2026-10-18; configuration edits of the pre-approved kinds, logged)

The user answered §34b, §34g and §34i in chat on 2026-10-18 (relayed by the orchestrator), and the orchestrator's review
of the M2c screenshots asked for three polish items. Applied in that order. Nothing was committed, pushed or deployed; no
real Google, Mapbox or USGS endpoint was called.

### 41a. §34b: the admin page loads `admin.mjs`, each area a lazy chunk

- The admin's Vite build is ES only (`packages/admin/vite.config.ts`): no `admin.iife.js` any more, since an IIFE
  inlines every dynamic import and no document promises the admin on jsDelivr (only the engine's IIFE is distributed
  there, and keeps its own budget). The page loads `<script type="module" src="admin.mjs">`
  (`scripts/site/src/admin/page.ts`); Hosting's `**/*.@(html|js|mjs|css|json)` rule already serves every chunk
  `no-cache`, and its `**` rewrite answers a chunk a new deploy replaced with the page, which fails the import.
- Each area (`photos`, `pois`, `layers`, `settings`, `admins`, `history`, `jobs`, `crashes`, `home`) is one chunk:
  `packages/admin/src/pages/<area>.ts` holds the page's elements (`@hcm/ui/admin/areas/<area>`, a new subpath export
  of `@hcm/ui`) and the area's store module; `packages/admin/src/routing/area-pages.ts` imports it when the route first
  opens, adds the store module to the editors' modules (the content registry creates a store the first time its page
  reads it, so the module is always there by then) and registers the elements. `defineAdminElements` registers the
  shell, the kit and the editing kit only. Terra Draw is a chunk too (§41b); the colour library and the analytics SDK
  already were.
- Rolldown's `codeSplitting` groups name the chunks, so each can have a budget: `admin-core` (everything the entry imports
  statically; `admin.mjs` is a stub that imports it), `editor-shared` (what two or more areas share and the entry does
  not), `terra-draw`. Without them Rolldown split the code the entry shares with an area into about thirty small chunks
  named after one module each, which a refactor renames.
- A chunk that does not load (the network, or a deploy that replaced it) makes the page registry's loader reject;
  `<hcm-page-outlet>` then says "The page did not load. Check the internet connection and try again." with **Try again**,
  which imports it again (Chromium, Firefox and WebKit all fetch a failed dynamic import again: probed 2026-10-18 with
  Playwright 1.64 in the quality image). Row `S-A29-BAD-CHUNK-LOAD`, state `admin.page-failed` at every tour viewport
  (`e2e/tour/admin-jobs.tour.ts`).
- **Budget configuration** (`scripts/ci/check_bundle_budget.py`, the change to what the gate measures that §34b asked
  the user for): the entry (`admin.mjs` and every chunk it imports statically, read from the files' static imports)
  keeps the IIFE's 450 KB; every other chunk is measured against its own budget by name (the measurement plus about
  20 %, rounded up), a chunk without a budget fails, and everything together has a cap of 620 KB. Measured on the
  production build, quality image, 2026-10-18 (gzip level 9):

| Chunk | gzip KB | Budget KB |
| --- | --- | --- |
| `admin.mjs` + `admin-core` (the entry) | 349.8 | 450 |
| `terra-draw` | 47.4 | 58 |
| `photos` | 20.3 | 25 |
| `pois` | 19.6 | 25 |
| `dynamic-color` | 19.3 | 24 |
| `settings` | 15.3 | 20 |
| `editor-shared` | 10.1 | 13 |
| `layers` | 7.4 | 10 |
| `analytics-sdk` | 6.3 | 8 |
| `history` | 5.4 | 8 |
| `admins` | 3.6 | 6 |
| `home` | 2.7 | 5 |
| `jobs` | 2.4 | 5 |
| `crashes` | 2.4 | 5 |
| everything | 512.0 | 620 |

  Before: `admin.iife.js` 446.9 KB of 450 (M2-status §1). The entry is 97 KB lighter, Terra Draw included in the whole.
  Most of the entry is the Firebase SDK, Lit, the kit, Setup and the catalogues: the editors' texts are one module of
  `@hcm/shared` today, so they load with the shell (a split per area is a later change).

### 41b. §34g: Terra Draw installed and wired

- `terra-draw@1.37.0` and `terra-draw-mapbox-gl-adapter@1.5.0`, exact, dependencies of `@hcm/ui`, installed in the
  digest-pinned `node:24-bookworm-slim` (`docs/SETUP.md` → *npm in a container*); `npm audit --audit-level=low`: 0
  vulnerabilities. The published adapter imports nothing of `mapbox-gl` (only `terra-draw`), as §4.2 of M2c-interfaces
  expected. `terra-draw` 1.38.0 was published on 2026-10-18, after the evaluation: 1.37.0 is a `HELD` entry
  (`scripts/ci/check_dependency_updates.py`, `docs/CI_PIPELINE.md`) until it is evaluated.
- Their declarations name `geojson` (a dev dependency of Terra Draw's) and the global `mapboxgl` namespace;
  `skipLibCheck` stays off, so `packages/ui/src/map/draw/terra-draw-env.d.ts` declares the five GeoJSON types they use
  (as `@types/geojson` does) and an opaque `mapboxgl.Map`, instead of downloading another package.
- `loadTerraDraw` (in `terra-draw-adapter.ts`, the only importer, dependency-cruiser) imports both on the first drawing
  tools; `content-wiring.ts` passes it as `terraDraw` (CR-M2c-20). The real constructors take wider options than the
  structural `TerraDrawModules` (Mapbox's own map type), so the loader hands them over as those types; the browser test
  `packages/ui/test/map/draw/terra-draw-real.test.ts` drives the real Terra Draw and its Mapbox adapter through the port
  on a structural map with a real canvas: a vertex, a midpoint and the whole shape dragged with real pointer events, a
  drag past the limits refused, a pin dragged and moved by a click, an area drawn by clicks then dragged.
- **The click tools stay**, as the user asked: a new shape is still drawn by clicks (a point is one click, a line and
  an area grow with every click, Save works at any time: the input budgets hold), now shown by Terra Draw's own layers
  (`click-growth.ts`, shared by both ports); `select` is Terra Draw's select mode (drag a feature, a vertex, a midpoint
  to insert one; a right click on a vertex removes it), which keeps its selection on a click elsewhere, so a click still
  moves a selected point (WCAG 2.5.7), and leaves the keys to the editor's tools; the vertex list stays the keyboard's
  way. A polygon with holes, which Terra Draw's modes cannot hold, is shown by its outer ring and edited in the list.
  The click-only port stays the fallback when Terra Draw does not load.
- What the e2e found (`docs/LESSONS.md`): Terra Draw reports a selection's marks as an `update` of the feature's
  properties and the port's own updates as `api` changes; reported as drags, they moved the photo's pin back over a
  place typed in its fields. Only geometry changes that do not come from the port are reported now.
- Rows: `S-A32-HAPPY-VERTEX-EDIT` (`planned` → `exists`), `S-A32-HAPPY-DRAG-SHAPE`, `S-A32-BAD-DRAG-CROSSING`
  (`e2e/admin/specs/pois/dragging.spec.ts`, green at `admin-c360-ro`, `-m768-ro`, `-l1440-ro`, twice each).
- **Configuration** (pre-approved kind: keeps a tool working): `vitest.config.ts` pre-bundles `terra-draw` and
  `terra-draw-mapbox-gl-adapter` for the browser projects (`BROWSER_TEST_DEPS`), as every browser-test dependency.
- **For the user**: the admin bundles MIT code (Terra Draw, Lit) with no third-party notices file; M2c-interfaces §4.2
  said Terra Draw's licence text joins "the admin's third-party notices", which do not exist yet. Proposal: the admin's
  site build writes `THIRD-PARTY-NOTICES.txt` next to the page from the bundled packages' licences.

### 41c. §34i: the dashboard is the first screen once Setup is complete

- `packages/admin/src/app/setup-readiness.ts` watches `setup/status` while an admin is signed in with the server and
  sets `setupReady` once billing, provisioning, Mapbox and USGS are `ok` (the Setup Assistant's required steps); this
  browser remembers it per project (`localStorage` `hcm:admin:setupReady`), so the next visit's empty address opens the
  dashboard at once. `resolveAdminRoute` opens `#/home` for an empty address when Setup is complete;
  `ADMIN_ROUTE_SPECS.inCompactBarOnceSetUp` puts Home on the compact bar in Setup's place (Setup under More).
- An empty address opened before the readiness is known follows its first answer; a later change moves nobody: finishing
  Setup's last required step leaves the owner on Setup, where the optional steps (analytics, the legacy import) wait,
  and only the bar follows.
- A city of the `e2e` build's own (`?city=`) does not watch the singleton `setup/status`, which the locked Setup specs
  rewrite meanwhile (as its map token, CR-M2c-7): its first screen is Setup whatever another spec left there.
- Rows `S-A40-HAPPY-FIRST-SCREEN`, `S-A40-BAD-SETUP-INCOMPLETE` (`e2e/admin/specs/ops/ops.spec.ts`).
- The owner's journey (`e2e/admin/specs/journey.spec.ts`) reloads its empty address once USGS approves: the dashboard
  opens there now, and the journey goes back to Setup for the optional steps (its first split run of 2026-10-18 failed on
  that reload at the five admin projects, as the decision means it to).

### 41d. The review polish

1. **Dates in the admin's language**: the two native `<input type="date">` (the layer's exact date, the USGS token's
   expiry) showed the browser's pattern (`mm/dd/yyyy` in an American browser, inside a Romanian page). They are M3 date
   input fields now: a text field with the pattern as its hint, `zz.ll.aaaa` in Romanian and `dd/mm/yyyy` in English
   (the admin's English dates are British, `setup-text.ts`); a typed date is stored as the ISO date, one that does not
   exist is marked at its field (`packages/ui/src/admin/editing/date-text.ts`). Rows `S-A21-HAPPY-DATES-IN-LANGUAGE`
   and `S-A21-BAD-DATE-UNREAD`, under an `en-US` browser with the `America/New_York` time zone
   (`e2e/admin/specs/layers/dates.spec.ts`).
2. **Large and extra-large windows**: on an extra-large page (M3, from 1600 px, measured by `hcm-list-detail`) the
   map-centric editors put the map beside the form as a supporting pane (`packages/ui/src/admin/editing/wide-layout.ts`):
   photos and places, list 412 px | map | form 480 px, each scrolling on its own; the layer editor, groups 560 px | the
   map kept in view beside them. A map that does not show keeps the stacked layout. The other editors (texts, theme,
   categories, admins, history, jobs, crash reports) keep at most 840 px, centred in the detail pane: M3's readable
   width for forms and text; their wide margins are the cost of not stretching a form across 1,900 px. Below 1600 px
   the layouts are unchanged (at 1440 the detail pane is about 890 px: a 400 px form beside the map would leave the map
   under 500 px). Checked by the admin tour at `tour-x3840-light-ro`, `-l1440-`, `-c915l-`, `-c360-` (61 tests green)
   and the review screenshots at 2560 × 1440 (`reports/screenshots/m2c-review/`).
3. **The city's theme**: the admin wears its city's colours already (`packages/admin/src/app/city-theme.ts`: while an
   admin is signed in the shell watches `cities/{city}` and applies its `theme.tokens`; Settings previews a new seed live;
   M2b-interfaces §1.2 and the PLAN's "seed colour with live M3 preview"). The purple of the reviewed screenshots is the
   M3 baseline the shell falls back to while the city document holds no `theme.tokens`: the shots were taken at 02:22 on
   2026-10-18, before the E2E agent's fix "the shell's theme follows the edited city" (§37f; until then a content
   world's shell watched the project's city, not the test's own), and some tour worlds seed a city without a theme. The
   e2e journeys whose city carries the Bucharest site's theme (`seedPublicCity`) show the brown city colours.

## 42. The screens §37e asked for, read-only revoked editors, UX leftovers, security, and the §39c tiering (M2 follow-ups, 2026-10-18) — APPLIED 2026-10-18 (orchestrator task; configuration edits of the pre-approved kinds, logged); §42f's two cloud steps and one download for the user

Applied on `feat/engine-rewrite`; nothing committed, pushed or deployed, no real Google, Mapbox or USGS endpoint called.
The rows §37e listed as planned now exist, each with its e2e test and its states in the tour's inventory.

### 42a. The settings page's map — APPLIED

- The area and overlays sections show the city's map above the section (`packages/admin/src/settings/settings-map.ts`,
  one map per page visit through `AreaMap`): the saved layers, the published photos and places as the visitors see
  them, and the area's bounds as a rectangle (overlay `_bounds`, not clickable). **Draw the area on the map** takes two
  clicks, two opposite corners (the status line says which; the same button stops drawing); **Use this view** takes the
  map's centre and zoom. The number fields stay the keyboard's way (WCAG 2.1.1). The overlay defaults preview on the
  same map through the settings' `PreviewLayer`; Discard returns the stored opacities.
- Found by the new e2e: the settings chunk rendered `<hcm-admin-map>` without defining it (only the layers, places and
  photos chunks did), so the box stayed empty; `defineSettingsElements` defines it now, and
  `packages/ui/test/admin/editing/areas.test.ts` checks every map-showing chunk defines it (`docs/LESSONS.md`).
- Rows `S-A19-HAPPY`, `S-A36-HAPPY`, `S-A36-BAD-DISCARD` (`e2e/admin/specs/settings/map.spec.ts`); state
  `settings.area-drawing` in the settings tour.
- **A new named chunk** (the bundle budget's rule for a new chunk): the settings map imports the places' and photos'
  map modules, which made them shared and pushed `editor-shared` to 13.7 KB gzip, over its 13 KB. Rather than raise that
  budget, the admin map's box and the content modules it draws are a chunk of their own, `admin-map`
  (`packages/admin/vite.config.ts`), loaded by the four areas that show the map: 7.4 KB measured, budget 9 KB (plus
  about 20 %, as `scripts/ci/check_bundle_budget.py` asks); `editor-shared` is 8.8 KB again, every other budget
  unchanged, the total 620 KB unchanged.

### 42b. The self-test's checks, Rotate the visitors' token, and Home's skipped documents — APPLIED

- **Check again** keeps what `setup.selfTest` found and the Setup page lists every check with its state; a failing
  check shows its reason in the admin's language and a link to the step that fixes it (cloud checks to Prepare the
  project, Mapbox and USGS to their cards, Error Reporting to analytics): `packages/ui/src/admin/setup/self-test.ts`,
  row `S-A03-BAD-SELFTEST-FAILURE`, state `setup-self-test`.
- The Mapbox card has **Replace the visitors' token** and **Replace the admin's token** (`setup.rotatePublicToken`), each
  behind a confirmation dialog, saying when the old token goes (ops.tick deletes it ten minutes later, a clock test of
  the functions): row `S-A06-HAPPY-ROTATE`, state `mapbox-rotate-confirm`.
- Home's **Not on the public map** lists each document the manifest build skipped with its first issue (the field's
  human name) and a link to its editor: row `S-A38-BAD-SKIPPED-SHOWN`, state `home.skipped`.

### 42c. The conflict banner names who and when — APPLIED

The editors' banner reads "Saved by {who} on {date}." (who from `admins.list`, loaded once per session as the shell's
`people`, falling back to the address and then to "another admin"; the date in the admin's language, or the sentence
without it when the version is not a date) and lists the fields both sides changed by their human names. Row
`S-A38-BAD-CONFLICT` saves as a second content world's admin; state `editing.conflict`.

### 42d. A revoked admin's editors are read-only — APPLIED

Under the revoked banner every editor (photos, places, layers, every settings section, history, jobs, admins) shows
its fields read-only, Save and every action disabled, a "Read only" state line; the stores ignore an edit while
`ContentServices.readOnly()` holds (the drafts' `locked`), so no keyboard path writes either. `S-A20-*` asserts it in
`e2e/admin/specs/flows/revoke.spec.ts`.

### 42e. UX leftovers — APPLIED

- The places editor: Delete visible, History and the redraw tools in an overflow menu (`<hcm-overflow-menu>`); in a
  landscape phone window the detail pane stacks map and form in two scrolling rows (`wide-layout.ts`).
- One bulk bar for photos and places (`bulk-bar.ts`): count, Select all, Clear, the two main actions as buttons, the
  rest in its overflow menu.
- History and the jobs page show human field names (`adminContent.field.*`) and step names
  (`adminContent.jobs.stepName.*`) in RO and EN; History is a button like every other action (no link-styled one).

### 42f. Security — APPLIED in code; three steps for the user

- **The compare plugin's integrity**: `openCompare` refuses to load mapbox-gl-compare 0.6.0 without SHA-384 digests of
  both files and sets them with `crossOrigin`. The digests themselves come from the pinned npm package, the way
  mapbox-gl's do; installing `mapbox-gl-compare@0.6.0` is a download, so it waits for the user's yes (the viewer does
  not use the plugin yet: V06 is a later milestone).
- **The crash endpoint's account**: `telemetry.reportError` runs as `fn-crash@`, a new service account with no project
  role (the provisioner creates it and grants only the deployer `actAs` on it). A log entry needs no role, so a flaw in
  the one public endpoint reaches neither Firestore nor Storage.
- **Its worst-case logging cost**: 15 reports per instance a minute (was 120), 10 per client, two instances: about 30
  entries a minute project-wide; each entry cut to 16 KiB (`REPORTED_EVENT_MAX_BYTES`, the message shortened first),
  about 17 KiB with its envelope: 30 × 17 KiB × 60 × 24 × 31 ≈ 22 GiB in a 31-day month, under Cloud Logging's 50 GiB
  free tier. Not capped by the handler: Cloud Run's own request log (one short entry per request, refused ones too);
  **for the user**: a `_Default` sink exclusion for that function's request log (a cloud change, ask first).
- **App Check enforcement** (`HCM_APP_CHECK=enforce`) stays a later step for the user, after the deploy shows the
  tokens arriving in monitor mode (ask first).

### 42g. §39c: what each push repeats, and the split retuned — APPLIED (orchestrator decision; no scenario row dropped)

Every scenario row still runs on every push; only repetitions moved to `tour-matrix` (in `all` and nightly):

- the Setup journey at `admin-c360-ro` and `admin-l1440-ro` per push; at `admin-m768-ro`, `admin-l1440-dark` and
  `admin-l1440-en` in `tour-matrix` (`adminJourneyMatrixProjects`);
- the window-class-independent functional specs (about, boot, consent, CSP, crash reporting, deep links, embed API,
  geolocate, language and theme, no JavaScript, starter kit) at `fn-l1440-ro` per push, the other functional projects
  in `tour-matrix` (`fn-<viewport>-matrix`);
- the admin's tour journeys (the fifty-category state among them) per push at the viewer's four light RO projects
  only; their dark and English variants run in `tour-matrix` (`tour-<…>-admin`).

Measured (`docs/research/pipeline-baseline.md`, last addendum): the split `quality` stage in 460 s (482 s in a first run
whose failures were fixed), 968 tests and about 4,720 s of per-push test time (about 9,860 s before); this machine's part
ended about 20 s before the NUC's, so `default_parts` keeps `1:2` (its comment records the run). The nightly
`tour-matrix` gains about 1,700 s of test time over its ten shards, inside the 45-minute job; `ci.yml`'s per-push shards
only got lighter, so no workflow changed.

## 43. The M2e gate: the full `all` with the tour matrix, and what it found (2026-10-18) — APPLIED 2026-10-18 (orchestrator task; no gate relaxed, no allowlist entry)

The split `all` (`scripts/ci/e2e-split.sh`) ran the tour matrix for the first time since the M2c editors' follow-ups; the
per-push `quality` runs of §41 and §42 never reach it. What it and the M2e review screenshots found, and the fixes:

### 43a. Product fixes — APPLIED

- An opened photo or place is brought into view on its editor's map (centre, zoom kept, no animation); a new place and
  an edit of the open item move nothing (`S-A09-HAPPY-OPEN-IN-VIEW`, `S-A32-HAPPY-OPEN-IN-VIEW`,
  `S-A32-BAD-NEW-PLACE-KEEPS-VIEW`; `docs/LESSONS.md` 141).
- The dashboard's tiles in one row are as tall as each other (lesson 142).
- The admin map's box without a map never shrinks below its note (`flex: none`), and the map-beside-the-form layout of a
  compact height applies only from a medium width: a portrait phone of 320 × 568 measured a compact height and laid the
  places editor over the "Set up Mapbox" note (lesson 143).
- The navigation bar's labels follow their item's width below about 70 px (`17cqi`, 10.9 px at 64 px): "Configurare"
  broke over two lines at 320 px (lesson 147).

### 43b. A checker made exact, not relaxed — APPLIED

The legal-line rule asked for the Mapbox logo and attribution whenever a canvas showed its foot, also when only the last
4 px of a map scrolled to its end showed, below the band where Mapbox draws them (`admin.settings.area-refused` at 768 ×
1024). `showsItsFoot` now also asks that the visible strip be taller than the band under the map's lowest legal
control (`legalGap`, `e2e/support/layout-probe.ts`): one pixel of either control on screen and the rule applies as
before (`e2e/test/layout-probe.test.ts`; lesson 144). No allowlist entry was added.

### 43c. Three specs synchronised — APPLIED

- History's Deleted filter: the tour waits for the server's answer (no "Reconnecting…") instead of asserting no
  "Show more", which a full page of other cities' entries in the shared emulators legitimately offers until history
  entries carry their city (CR-M2c-14; lesson 145).
- Saving offline: the spec waits for Save to be on before it goes offline. The run after that showed a product bug
  behind it, fixed in §43a's spirit: offline, a categories listener answered from the cache with no category and the
  draft read the place's category as unknown, turning Save off; the draft now checks the category only against a list
  the server answered (lesson 146).
- A category's colour saved: the settings tour waits for the editor's own "Saved" before it opens another category; the
  emulator held the new colour before the page heard back, and the new address asked "Discard your changes?" (lesson
  148).

## 44. Security patch bumps for new advisories (2026-10-23) — APPLIED 2026-10-23 (user approved the downloads, `virtualenv` in a second approval)

New advisories failed the `static` stage's audit gates. The user approved downloading exactly these patch versions; no
allowlist entry, no new `overrides` entry and no other package was added.

| Package | From | To | Advisory | Gate |
| --- | --- | --- | --- | --- |
| `vitest`, `@vitest/browser-playwright`, `@vitest/coverage-v8` (root `devDependencies`); `@vitest/browser`, `@vitest/ui`, `@vitest/mocker`, `@vitest/spy`, `@vitest/utils`, `@vitest/pretty-format` (transitive) | 5.0.3 | 5.0.5 | GHSA-p458-7748-mcp3 | `npm-audit` |
| `markdownlint-cli2` (brings `markdown-it` 15.0.1 → 15.0.3 and `markdownlint` 0.41.1 → 0.42.0) | 0.23.3 | 0.24.0 | GHSA-r7fv-28h4-cvq7, GHSA-vfgh-jcmw-g37q, GHSA-gfr2-rv44-r23c (`markdown-it` 15.0.0 to 15.0.2) | `npm-audit` |
| `ip-address` (transitive: `firebase-tools` → `express-rate-limit`, `socks`; both ranges `^10`) | 10.7.3 | 10.7.4 | GHSA-rxp7-6hxx-x8q5 | `npm-audit` |
| `certifi` (`scripts/ci/requirements.txt`, `pipeline/requirements-poetry.txt`, `pipeline/poetry.lock`) | 2026.7.22 | 2026.10.19 | PYSEC-2026-4320 | `pip-audit`, `pipeline-pip-audit` |
| `virtualenv` (`pipeline/requirements-poetry.txt`, Poetry's own venv) | 21.14.6 | 21.14.13 | CVE-2026-113722, CVE-2026-113725 | `pipeline-pip-audit` |

- **npm.** `npm install --save-exact` of the three root packages stopped on `ERESOLVE`: the lockfile's `vitest@5.0.3`
  peers each `@vitest/*` at exactly 5.0.3, so no single package could move first. The fix was a lockfile refresh of
  only the affected entries: the 5.0.3 `vitest` and `@vitest/*` entries, `markdownlint-cli2`, `markdown-it` and
  `ip-address` were removed from `package-lock.json` and `npm install` re-resolved them in the digest-pinned Node
  image (`docs/SETUP.md` → *npm in a container*). The rest of the tree is unchanged apart from the dependencies of
  the new versions (`obug` 3.0.0 under Vitest; `micromark` and its extensions, `js-yaml` 5.4.3 and `string-width`
  8.3.0 under markdownlint, and one new transitive package, `micromark-util-edit-map` 1.0.0). `ip-address` needed no
  override: both of its dependants accept 10.7.4. `npm audit --audit-level=low` and the `deploy-lock-audit` gate
  (`functions/deploy-lock`, which holds neither package) report 0 vulnerabilities.
- **Python.** `certifi` is pinned to the approved 2026.10.19 in both requirements files. `poetry update certifi
  --lock` (Poetry 2.5.1 from the quality image) picked 2026.10.23, published the same day; the lock entry was set to
  2026.10.19 with PyPI's two sha256 hashes, so all three files name one version. `pyproject.toml` is unchanged, so
  the lock's `content-hash` stays valid (`pipeline-lock` gate).
- **`virtualenv`, approved and applied the same day.** The same `static` run found a further advisory outside the
  first approval: `virtualenv` 21.14.6 (Poetry's own dependency, `pipeline/requirements-poetry.txt`), CVE-2026-113722
  and CVE-2026-113725, fixed in 21.14.7 and 21.14.9. The user approved the latest, 21.14.13 (2026-10-23), which is
  now pinned; its dependencies (`distlib`, `filelock`, `packaging`, `platformdirs`, `python-discovery`) were already
  pinned at versions it accepts, so no package was added (`pipeline-pip-audit`).

Verify: `PIPELINE_STAGE=static bash scripts/ci/run-all-checks.sh` and `PIPELINE_STAGE=tests bash
scripts/ci/run-all-checks.sh`.

## 45. History's recent changes ask one city (CR-M2c-14, 2026-10-23) — APPLIED 2026-10-23 (orchestrator task; no gate relaxed, no config of the ask-first kinds changed)

The split `all` failed once in the tour matrix: `admin.history.recent` at `tour-x3840-dark-ro-admin`, "Tab never
reaches" the test's own city's creation entry. The recent changes read the newest 50 entries of every city's
`history` and the page left the others' entries out (§9.2 as built, CR-M2c-14 open for M5). In the shared emulators
the other tests' cities write entries at the same instants, so they decided which of this city's entries made the
page, pushed one off it during the Tab round, and kept "Show more" on (the tolerance of §43c; `docs/LESSONS.md` 149).

- **Contract**: `historyEntryDocSchema` gains `cityId` (an id, optional so an entry written before it still parses);
  `history.on*Write` (`functions/src/history/record.ts`) and `history.revert` (`revert.ts`) write it from the audited
  document's path. `docs/research/M2-interfaces.md` §2.2 and `M2c-interfaces.md` §9.2 say so; CR-M2c-14 is done.
- **Query**: `recentQuery(cityId, filter)` asks `cityId ==` the city, then the entity and action filters, ordered by
  `updatedAt` descending (`packages/admin/src/history/entries.ts`); the page-side `inCity` filter went.
- **Indexes** (`firebase/firestore.indexes.json`): the three collection-group composites became four that start with
  `cityId` (alone, with `action`, with `entity`, with both); the `history.updatedAt` override, which only added the
  collection-group descending order for the unfiltered query, went, so `history` keeps Firestore's default
  single-field indexes. `firebase/rules-tests/test/indexes.test.ts` asks for the four and refuses a collection-group
  index that does not start with `cityId`. If an earlier deploy created the old collection-group indexes, `firebase
  deploy --only firestore` lists them as not in the file; deleting them is part of that ask-first step.
- **Rules**: unchanged (admins, who edit every city, list the collection group; `get` stays under `cities/`).
  `firebase/rules-tests/test/history.test.ts` queries one city with and without the filters (admins only) and checks
  that another city's entry never answers it.
- **Migration**: none. The live project never had a history trigger deployed (`M2-status.md` §5, step 4 not run), so
  its Firestore holds no history entry; an entry without `cityId` still validates and shows among its document's
  versions (the tour's year-2000 entry is one).
- **Tests**: `S-A23-BAD-OTHER-CITY` (the tour writes a newer deletion of another city: never listed, and the city's
  few entries offer no "Show more", in the recent changes and the Deleted filter; the tour also waits for the city's
  own creation entry before its checkers), the admin store's test with a full page of another city's entries, the
  shared schema's, functions' and rules' tests.

Verify: `PIPELINE_STAGE=static`, `tests` and `build` of `bash scripts/ci/run-all-checks.sh`; the history tour and the
specs that use History at several projects with `--repeat-each`.

## 46. The M3 contracts (2026-10-23) — 46c APPLIED (a stricter configuration, the pre-approved kind); 46a, 46b, 46d–46f, 46h–46j recorded for the user; 46g PROPOSED, NOT APPLIED (new dependencies)

The M3 contracts agent wrote `docs/research/M3-interfaces.md` alone before the four M3 workstreams. What it decided that
the user may want to see, and what it did not do:

- **46a Publishing runs in functions, not in the pipeline.** After approval, `imagery.publish` (a task queue, one at a
  time, 30 minutes) streams the COG from the private bucket to an MTS tileset source, writes the recipe, publishes and
  polls (§7.3). The pipeline never holds a Mapbox secret (`job-raster@` loses `mapbox-sk-tiles`, §9.4), an approval does
  not start a second Cloud Run execution, and the compute-unit guard runs in the same TypeScript as the approval policy.
  The cost: a 30-minute ceiling per upload, which a city crop (a few hundred MB, in-region read) is far from.
- **46b Automatic GCPs are part of M3** (PLAN had them in M4): the minimum-input path of the M3 brief is search → Import
  → automatic georeferencing → auto-publish; the georeferencer is the fallback (§5.6).
- **46c APPLIED: `.dependency-cruiser.cjs`'s `functions-feature-folders-independent` lists `layers` and `imagery`.**
  `functions/src/layers/` (M2c) was missing from the rule; `functions/src/imagery/` (M3) joins it, so the new folder can
  only reach the others through `ports/`, `api/` and `@hcm/shared`. Stricter; verified with `PIPELINE_STAGE=static`.
- **46d Layer versions; a layer exists only with tiles.** `cities/{city}/layerVersions/{version}` carries the work in
  progress (§2.2); a replacement keeps the old tiles until the new version is published. **UNVERIFIED**: that Mapbox
  serves a tileset's previous tiles while it processes a new publish of the same tileset. If not, the fallback is two
  alternating tilesets per layer (`-a`, `-b`), the inactive one deleted after the switch, which doubles a layer's
  tileset only while it is republished (the 24-tileset guard counts both).
- **46e A job status `awaiting_gcps`**, applied with its consumers (the Jobs page's text and active statuses, the rules
  tests iterate the statuses): an upload without georeference and a scene the matcher could not place wait for the
  admin's points instead of failing.
- **46f Jobs are created by callables and triggers only** (CR-M3-2, the rules: stricter): each creator checks the
  parameters, the budget guard, the daily cap and writes the version in one transaction; the client keeps Cancel.
- **46g PROPOSED, NOT APPLIED (each a new download, ask first):**
  - `openseadragon` for the georeferencer's scan pane (deep zoom over DZI tiles of the full scan). M3 instead shows a
    4,096 px preview in a canvas viewer of its own (`scan-preview.jpg`); a deep-zoom port can take OpenSeadragon later.
  - `@allmaps/transform` for the transforms (PLAN named it). M3 instead implements affine, second-order polynomial and
    thin-plate spline in `packages/shared/src/georef/`, held to the pipeline's numpy by golden cases; the module's
    interface (§6.2) lets the library replace the implementation later.
  - `google-cloud-secret-manager` and `pystac-client` for the pipeline: not needed; both are a few REST calls through
    the pinned `httpx`.
- **46h The compute-unit numbers are UNVERIFIED** (Mapbox's raster MTS precisions and price per km²):
  `KM2_PER_COMPUTE_UNIT`, `USD_PER_COMPUTE_UNIT` and `MAPBOX_FREE_COMPUTE_UNITS` are conservative constants; each publish
  records the MTS job's `tileset_precisions` so a later change can calibrate them against the first invoice.
- **46i A second scheduled function**, `imagery.tick` every 5 minutes (dispatch, lost executions, Mapbox polling,
  deferred publishes, layer deletions, the monthly harvest): a second Cloud Scheduler job (three are free per billing
  account) and about 8,600 invocations a month (free tier). `ops.tick`'s `jobs` and `mts` steps stay no-ops.
- **46j The references' public endpoints**: Sentinel-2 L2A from Element 84's Earth Search STAC (`HCM_STAC_URL`) and OSM
  features from the Overpass API (`HCM_OVERPASS_URL`), called only by the Cloud Run job, cached 90 days in the private
  bucket; never Mapbox Satellite. **UNVERIFIED**: their availability and limits for our volume (a few calls per import);
  both addresses are configuration, so a mirror or a paid endpoint is a deploy-time change.
- **46k Bundle budgets**: the new chunks `imagery` and `georef` (at most 30 KB each) and `layer-geometry` (at most 8 KB)
  get their rows in `ADMIN_CHUNK_BUDGETS` from admin-imagery with the measurement (the pre-approved kind, logged then);
  together they stay within `ADMIN_TOTAL_KB` (521 KB measured on 2026-10-23).

Verify: `PIPELINE_STAGE=static bash scripts/ci/run-all-checks.sh`; the shared, rules (`documents.test.ts`), functions
(`support/`, `layers/`), admin (`jobs`) and ui (`admin/jobs`, `admin/ops`) Vitest projects for the edited files.

## 47. admin-imagery: the M3 chunks' budgets and what the screens decided (2026-10-23) — 47a APPLIED (the pre-approved kind §46k names); 47b–47e recorded for the user

- **47a APPLIED: `ADMIN_CHUNK_BUDGETS` gains `imagery` 18 KB, `georef` 17 KB and `layer-geometry` 3 KB**
  (`scripts/ci/check_bundle_budget.py`): 15.2, 14.0 and 1.9 KB gzip measured on 2026-10-23 plus about 20 %, under the
  contract's ceilings of 30, 30 and 8 KB. No existing budget changed: `editor-shared` 11.0 of 13, `layers` 7.8 of 10,
  `settings` 17.8 of 20, `admin-core` 367 of 450, the admin in all 569.8 of 620. New chunks only, each with its own
  budget, as §46k planned.
- **47b Replace image is the Imagery area's upload for the layer** (`#/imagery/replace/<layerId>`), not a second upload
  inside the layer editor: the same resumable upload, checks and progress, and none of its code in the `layers` or
  `layer-geometry` chunks (it would have moved the upload into `editor-shared`, over its budget).
- **47c Crop's keyboard way**: pan the map with the arrow keys and add a corner at its centre, three or more; the
  drawing tools' clicks are the pointer's way. Save sends the outer ring to `imagery.crop`.
- **47d `fn-events@` runs the raster job's executions with project-level roles** (`roles/run.jobsExecutorWithOverrides`,
  `roles/run.viewer`): §9.4 asks for them on the two job definitions, which the provisioner cannot bind yet (no Cloud Run
  resource policy, and the definitions are deployed after it runs). Narrowing them to the two jobs is a follow-up;
  `job-raster@` lost `mapbox-sk-tiles` as §9.4 says.
- **47e Not applied, for the owners**: the Bucharest import's target years (CR-M3-28); `mapbox.studioTilesets` in
  `links.json` waits for the weekly probe (CR-M3-9).

Verify: `PIPELINE_STAGE=static bash scripts/ci/run-all-checks.sh`, `PIPELINE_STAGE=build bash scripts/ci/run-all-checks.sh`;
the admin, ui and shared Vitest projects.

## 48. e2e-fakes: advisories published during the M3 run, and one CI-time question (2026-10-24) — 48a APPLIED 2026-10-25 (user approved the downloads; §64); 48b recorded for the user

- **48a APPLIED 2026-10-25 (user approved the downloads; the versions in §64): two security bumps.**
  The `static` stage of 2026-10-24 fails on advisories that appeared
  after §44, in packages no M3 change touched; this phase may download nothing, so they wait for the user's approval:

  | Package | From | To | Advisory | Gate |
  | --- | --- | --- | --- | --- |
  | `body-parser` (transitive: the root's through `@modelcontextprotocol/sdk` and `firebase-functions`; `functions/deploy-lock`'s 2.x) | 2.0.0 to 2.3.0, and below 1.20.9 | 2.4.0 or later (1.20.9 for a 1.x range) | GHSA-27r3-jxmh-p828 | `npm-audit`, `deploy-lock-audit` |
  | `filelock` (`scripts/ci/requirements.txt`, and the pipeline's tool chain) | 4.1.1 | 4.2.1 | CVE-2026-112906, CVE-2026-112914, CVE-2026-112940 | `pip-audit`, `pipeline-pip-audit` |

  The way §44 took: refresh only the affected lockfile entries in the digest-pinned Node image (an `overrides` entry
  only if a dependant's range refuses the fixed version), and pin `filelock==4.2.1` in every requirements file that
  names it.
- **48b The imagery specs' time behind the admin lock.** The publish flows wait for fn-imagery's first MTS poll (60 s)
  and the manifest build, so `S-A12-HAPPY`, `S-A12-HAPPY-AUTO-PUBLISHED` and `S-A16-HAPPY-CROP` take two to four
  minutes each at each of the five admin projects (the imagery specs: about 40 minutes in one run). Like the Setup
  journey (§39c) they could run per push at `admin-c360-ro` and `admin-l1440-ro` only and at the other three in
  `tour-matrix` (`e2e/projects.ts`, not changed). For the user and the integrator (CR-M3-36).

Verify: `PIPELINE_STAGE=static bash scripts/ci/run-all-checks.sh`.

## 49. The M3 integrator: the change requests closed, and what stays for the user (2026-10-24) — 49a–49h, 49k and 49m APPLIED (product and test changes, the e2e tiering of the kind §39c and §42g applied; no configuration of the ask-first kinds); 49i APPLIED 2026-10-25 (user approved the downloads; §58); 49j and 49l recorded for the user

No lint, tool, workflow or gitleaks configuration changed, no gate was relaxed and no checker allowlist entry was added.

- **49a The Imagery area's happy path is one input again.** Each free scene's card has its own **Import** (named after
  its scene), as §10.2 of the contract says; `CONTENT_INPUT_BUDGETS.importScene` stays 1 and the e2e counts 1
  (CR-M3-35 d; the e2e had been set to the screen's 2).
- **49b The kit keeps targets clear** (CR-M3-35 e, j, h, i, l): `hcm-list-detail` keeps 4 px under its Back row (every
  area's detail on compact and medium windows moves down 4 px); the Imagery filters' rows are 16 px apart; each target
  year's row in Settings is 48 px; the Jobs page's georeferencer link is a 48 px `a.external`; the georeferencer's radios
  and checkboxes are drawn like the kit's (2 px border, 48 px ring); the admin map underlines its attribution's links.
- **49c The georeferencer's table fits its box.** Below a 560 px table the pixel and place columns give way (the panes
  show where every pair is) and a pair's origin goes under its name; a selected row hands its on-container colours to its
  controls. No horizontal scroller (WCAG 1.4.10, the `sideways-scroll` check).
- **49d `imagery.search` may run 300 s** (CR-M3-22): a functions-side table `CALLABLE_TIMEOUT_SECONDS` sets the deploy
  option; the admin calls it with a 310 s timeout (the SDK's default is 70 s). The shared registry is unchanged.
- **49e A layer is busy while any job of it runs** (CR-M3-24): `layers.delete` also asks the top-level `layerId` of M3's
  jobs and refuses a layer with a `pendingVersion`.
- **49f A replacement upload asks no year**: the layer keeps its own, so `imagery.onRasterUpload` reads none; the upload
  starts as soon as the file is chosen. Link a layer gains **Check** (`imagery.probeTiles`), optional: Link is off only
  after a Check found no tiles, until the address changes.
- **49g The admin's tab title and `<html lang>` follow its language** (the live polish of 2026-10-23;
  `S-A21-HAPPY-DOCUMENT-TITLE`, `S-A21-BAD-UNSUPPORTED-LANGUAGE`).
- **49h The legal-line check owes each control only where the map's strip reaches it** (`e2e/support/layout-probe.ts`,
  `legal.owes`; `docs/LESSONS.md` 163). Lesson 144's rule owed the logo and the attribution together once the strip
  passed the band under the lowest of them; on the admin map the attribution sits on the foot, so a strip of 1 to 10 px
  (a pane the Tab round left at its end) asked for a logo drawn 10 px above it, which no visitor could see. Two of a kind
  are still one too many, and a control the strip reaches must be there and uncovered. This makes the check exact, not
  looser: every case the old rule could see the logo in is still checked. For the user's review all the same, as a
  change to a checker.
- **49i APPLIED 2026-10-25 (user approved the downloads; the versions in §64): §48a's security bumps.**
  The `static` stage fails only on `npm-audit`,
  `deploy-lock-audit`, `pip-audit` and `pipeline-pip-audit` (body-parser GHSA-27r3-jxmh-p828, filelock 4.1.1 →
  4.2.1). This task may download nothing. The two body-parser tarballs (2.4.0 and 1.20.9) are already in the host's npm
  cache since 2026-10-23, so after your yes the lockfile refresh needs no new body-parser download (its packument may
  still be fetched); filelock 4.2.1 is in no local cache, and pinning it rebuilds the quality image. The final `static`
  run of 2026-10-24 also reports advisories published that day, in `firebase-tools`' tree only (the emulators and the
  deploy CLI, nothing shipped): `fast-uri` 3.1.8 (moderate: GHSA-w74x-v6f9-j3xg, GHSA-xhq7-xmqj-769h,
  GHSA-wjr9-j795-jxcr, GHSA-333x-w4r6-6crp; through `ajv` 8.20.0) and `undici` 6.29.0 and 8.11.2 (high:
  GHSA-4qv8-2p9j-2685, GHSA-f72v-6w45-q472, GHSA-xjj6-f33q-929c; the second through `node-gyp`). PROPOSED, NOT APPLIED:
  the patched releases `npm audit` names, as exact `overrides` in the same lockfile refresh (downloads, for your yes).
- **49j CR-M3-28 (Bucharest's target years) stays open**: the bundled seed (`seed/bucharest/`, ask first) or
  `createCityRequestSchema` would have to carry `imagery`. The admin guides tell the owner to add the five years once in
  Settings → Historical imagery (five inputs).
- **49k APPLIED: §48b, the imagery publishes per push at a phone and a laptop** (`e2e/projects.ts`, the kind of §39c and
  §42g). The imagery specs took 20 minutes at one admin project (34 tests behind the admin lock, 2026-10-24), most of it
  in the publishes that wait for the fake MTS and the manifest build; at the five admin projects that is about 100
  minutes a machine. So `published.spec.ts` (the imports that reach the viewer, split out of `import.spec.ts`) and
  `layer-geometry.spec.ts` (crop, replace, re-georeference) run per push at `admin-c360-ro` and `admin-l1440-ro`, and at
  `admin-{m768-ro,l1440-dark,l1440-en}-imagery` in `tour-matrix` (`all`, nightly); the real pipeline's spec, which does not
  depend on the window class, at `admin-l1440-ro` only. Every scenario row still runs on every push. To revert: drop
  `IMAGERY_PUBLISH_SPECS` and `PIPELINE_SPEC` from `noJourney` and the `-imagery` projects.
- **49l The Link dialog's preview of a Mapbox tileset on the admin map (`S-A15-HAPPY-PROBED`'s first wording) is not
  built**: Check answers with the tile's type, and the layer's editor previews the tiles once linked (S-A15-HAPPY). The
  row now says so.
- **49m Two dispatcher rules the quality run corrected** (CR-M3-44, CR-M3-45; `docs/LESSONS.md` 166, 167): the tick's
  monthly harvest repeats only a harvest older than 30 days (a city never harvested, or with no frame over it, is searched
  when its Imagery area opens, not every 5 minutes), and `RUNNING_JOBS_MAX` counts the jobs holding an execution
  (`starting`, or `running` with the lease held; a lapsed lease is a lost run the tick recovers). For review: both read
  the contract tighter than §3.5 and §4.2 first did.

Verify: `PIPELINE_STAGE=static bash scripts/ci/run-all-checks.sh`, `PIPELINE_STAGE=tests …`, `PIPELINE_STAGE=build …`,
`PIPELINE_STAGE=quality bash scripts/ci/e2e-split.sh`.

## 50. The M3 reviews' fixes: what the product now decides for the admin (2026-10-24) — 50a–50g and 50i APPLIED (product and test changes; no configuration of the ask-first kinds, no gate relaxed, no checker allowlist entry); 50h APPLIED 2026-10-25 (user approved the downloads; §58)

The fixer of the two M3 reviews (ten security and cost findings, fifteen minimum-input ones; CR-M3-47,
`docs/LESSONS.md` 171–180) applied every finding. These are the choices in it the user may want to change:

- **50a The admin may resume a budget pause** (behaviour A43, `imagery.resumeGuard`, admin, App Check consume). Before,
  the 5 USD alert turned `ops/guard` red for good and no screen could turn it back. Now the Imagery and Jobs pages show
  the spend and **Resume processing**: the guard turns green for the rest of that budget period (`resumedFor`; Google's
  repeated alerts for the same period leave it green, the next period's first alert pauses it again). The public map
  never paused. To make it stricter: refuse the resume above a second threshold, or let it hold one day only.
- **50b A publish starts at most 6 times** (`PUBLISH_MAX_ATTEMPTS`), the admin's Try again included, then fails
  `apiError.imagery.attemptsExhausted` with its reservation freed; `JOB_MAX_ATTEMPTS` (3 executions) is unchanged.
- **50c A failed harvest waits an hour, then twice as long after each further failure** (`HARVEST_RETRY_HOURS`, at most
  the 30 days of a harvest that answered), recorded in `ops/harvest-{city}` (a new ops document, written by the
  functions only; the rules deny every client, as for every `ops/` document).
- **50d What Try again never offers** (`NOT_RETRYABLE_CODES`, shared by `imagery.retry`, the Jobs page and the version
  page): a Mapbox token that is invalid, lacks a scope or is missing (the way out is Setup's Mapbox step), out of memory
  on the large machine, and attempts exhausted; a refused upload offers Upload another file; any failed version may be
  dismissed. A file too large for MTS is no longer a failure: it goes back with the verdict `too-large`, only the free
  Studio way left.
- **50e Two more ops documents read and written in transactions**: `ops/dispatch` (one slot per job holding a Cloud Run
  execution, the two-runs cap) and the month's `usage/mapbox-YYYY-MM` reservations marked `newTileset` (the 24-tileset
  cap). Both replace counts read outside the transaction that acted on them.
- **50f The ranking explains a low rank first** (`RANKING_VERSION` 2, `reason.noLayers` for a city with no layers): the
  stored scenes keep their version 1 ranks until the next harvest or the next `notScanned` ranks them again.
- **50g The Mapbox "list a tileset's jobs" answer is a recorded fixture, UNVERIFIED** (`mapbox/tilesets.jobs.list`): only
  a lost publish answer uses it (`MapboxTilesets.listJobs`); the weekly contract probe should cover it once it runs
  (ask first, as CR-M3-9).
- **50h APPLIED 2026-10-25 (user approved the downloads; §64): §48a and §49i's security bumps.** The four audit
  gates still fail the `static`
  stage, and so `all`; this task could download nothing.
- **50i Two screen defects the first full `all` found** (`docs/LESSONS.md` 181, 182): the georeferencer's pairs table on
  a phone now applies its narrow rules (they sat before the cells' own rule and never applied), and a cell wraps when the
  table would not fit otherwise; the
  admin map's attribution gives a layer's plain-text credit Mapbox's link colour (it read white on white in the dark
  scheme). The second is a style on Mapbox's own control, for your review as such; it makes the credit legible, it hides
  nothing.

No bundle budget changed: every admin chunk and the entry stayed within their budgets (`check_bundle_budget.py`, §47a's
tables).

Verify: `PIPELINE_STAGE=tests bash scripts/ci/run-all-checks.sh`, `PIPELINE_STAGE=build …`, `bash scripts/ci/e2e-split.sh`.

## 51. The local stack for manual testing and the manual test plan (2026-10-24) — 51a–51d APPLIED (tooling and test-world changes; no configuration of the ask-first kinds, no gate relaxed); 51e APPLIED 2026-10-24 as a PLAN alignment (§55a)

Before the owner and Claude test the product by hand "from the top", one command now starts the e2e world for a
person's browser (`npm run dev:stack`, `docs/SETUP.md` → *Local stack for manual testing*), and
`docs/MANUAL_TEST_PLAN.md` lists what to check, where (LIVE or LOCAL) and after which deploy, with the ask-first
commands. These are the choices in it the user may want to change:

- **51a An in-page shim, not a service worker.** In the specs Playwright's routes keep every request on the machine; a
  person's browser has none. A service worker was the first design (it worked in Chromium), but the Claude browser pane
  refuses to register one ("An unknown error occurred when fetching the script"), so the stack's admin and site servers
  put `e2e/stack/browser.ts` first into every page: it rewrites every address of a host off the machine to
  `/__stack/h/<host>/<path>` (in the page and in Mapbox GL's blob worker), and the server decides with the e2e firewall's
  own host table (`e2e/mock-apis/hosts.ts`): the mock APIs, the Storage emulator, or 403. `e2e/stack/check.ts` proves no
  request of the main screens reaches the network for a host off the machine. The rewrite exists only in the stack's
  servers; the admin's and the viewer's builds are the e2e ones, unchanged.
- **51b Google's consent stand-in opens in a frame over the page** in the stack (the pane opens a popup in place of its
  page, losing the opener the answer goes to); `e2e/mock-apis/oauth-page.ts` posts to its parent when it has no opener,
  which leaves every e2e spec's popup path as it was (the harness's consent specs pass), and the stack adds the mock APIs'
  origin to the served CSP's `frame-src`.
- **51c The container shares the host's network** (`--network host`), so the stack's ports are the e2e ports on the
  host's loopback, and the stack is seeded through the real flows where they exist: the owner's `imagery.search` and four
  `imagery.import` runs played by the stand-in runner (a draft over the threshold, a scan waiting for points, a run failed
  at warp, a frame the fake MTS publishes), and the legacy photos' real derivatives. `scripts/ci/e2e_build.py` counts
  `e2e/stack/` and `scripts/dev/` as not read by the e2e build (no rebuild for a stack change).
- **51d The admin's tab title follows its language**: already applied in `921088f` (A21's `S-A21-HAPPY-DOCUMENT-TITLE`
  and `S-A21-BAD-UNSUPPORTED-LANGUAGE`, `packages/ui/test/admin/shell/shell.test.ts`); run again on 2026-10-24 at
  `admin-l1440-ro` and `admin-c360-ro` (8 passed with the harness's consent specs). The live admin shows it after the
  next Hosting deploy (the plan's D1, ask first).
- **51e APPLIED 2026-10-24 (a PLAN alignment, §55a)**: the public site's `config.js` read the manifest the site build
  bundled from `seed/bucharest/manifest.static.json`, not the public bucket's `cities/bucharest/manifest.json` the admin
  publishes; a build that names the bucket (`HCM_PUBLIC_BUCKET`) now serves the bucket's, with the page's CSP, and the
  seed snapshot stays only for a build without one. The Claude browser pane on this machine has no WebGL: the plan runs
  its map items in Chrome.

Verify: `bash scripts/dev/dev-stack.sh` then `bash scripts/dev/dev-stack.sh check` (`[SUCCESS] the local stack works`),
`PIPELINE_STAGE=static bash scripts/ci/run-all-checks.sh`, `PIPELINE_STAGE=tests bash scripts/ci/run-all-checks.sh`.

## 52. The M4 contracts and the user's decisions of 2026-10-23 (2026-10-24) — 52a–52d APPLIED (the user's decisions: 52a in this change, 52b in the contract, 52c and 52d by the tooling workstream); 52e recorded for the user; 52f and 52g PROPOSED, NOT APPLIED

The M4 contracts agent wrote `docs/research/M4-interfaces.md` alone before the five M4 workstreams (orders, autogcp,
compare, assists-notify, tooling). No lint, tool, workflow or gitleaks configuration changed, no gate was relaxed, no
checker allowlist entry was added, and nothing was downloaded.

- **52a APPLIED: swipe compare is our own implementation, not `mapbox-gl-compare`** (the user, 2026-10-23). Removed in
  this change: `packages/ui/src/map/compare.ts` (the plugin loader with its integrity check), its test, its five exports
  from `@hcm/ui/map`, the `MapboxCompare` types and `mapboxgl.Compare` (`packages/ui/src/map/mapbox-types.ts`, the
  `FakeMapboxGl` of `@hcm/test-support`). Superseded with it: §18b (Subresource Integrity for the plugin), the plugin
  part of §42f and of §13d's CSP note, and the open item of `docs/research/M2-status.md` (installing
  `mapbox-gl-compare@0.6.0` to compute its digests: no download is needed any more). The contract: M4-interfaces §3 (a
  lazy chunk of the engine with its own budget, the second map created on demand and destroyed on exit, a MapPort `move`
  event for the camera sync, a keyboard and screen-reader divider, each side's overlay opacity, a toggle on compact
  windows, `cmp=` and `sw=` in the hash, which this change built in `packages/shared/src/url/hash.ts`).
- **52b APPLIED: Romanian ↔ English drafts through Vertex AI Gemini, server-side, as PLAN says** (the user, 2026-10-23:
  the paid EEA tier, under 0.05 USD a month; the API turned on by the app's Provision step; drafts never published
  automatically). The contract: M4-interfaces §4.3 and §4.4: `assist.translateDraft` (admin, App Check `enforce`) calls
  `generateContent` on the pinned `VERTEX_MODEL_ID` (`gemini-2.5-flash-lite`, **UNVERIFIED** that Google still serves it
  until the setup self-test's free `countTokens` check runs) with the pinned prompt (`TRANSLATION_PROMPT_VERSION` 1), the
  answer is plain text (`sanitizeDraft`) within the field's limit, a monthly cap (`AI_MONTHLY_CAP`: 500 requests or
  0.50 USD) in a transaction, paused by a red budget guard; Provision enables `aiplatform.googleapis.com` and grants
  `fn-admin@` `roles/aiplatform.user`; a draft fills the editor's draft only, and only the admin's Save writes.
- **52c APPLIED (the decision; the bump is the tooling workstream's): `terra-draw` 1.37.0 → 1.38.0** (the user,
  2026-10-23; the one download M4 may make). The `HELD` entry (`scripts/ci/check_dependency_updates.py`,
  `docs/CI_PIPELINE.md` → *Held dependencies*) goes in the same change as the bump, because the `deps` gate fails a hold
  that no longer matches its pin; `terra-draw-mapbox-gl-adapter` moves only if 1.38.0 requires it, else that is a NOT
  APPLIED proposal here. Verify: the drawing tests (`packages/ui/test/map/draw/`, the admin's drawing specs), `static`,
  `tests`, `build`.
- **52d APPLIED (the decision; built by the tooling workstream): a third-party notices file generated at build** for the
  engine and the admin from the installed packages' licences, with a gate that checks it is complete (the user,
  2026-10-23; §41b's open proposal). The contract: M4-interfaces §6.4 (`THIRD_PARTY_NOTICES.txt` beside `engine.mjs` and
  `admin.mjs`, every bundled package with its licence text, a permissive-licence allowlist in the gate's own config; a
  new gate of the pre-approved kind, logged by tooling).
- **52e Recorded: what the contract decided that the user may want to see.**
  - The order watch is a step of the five-minute `imagery.tick`, each order asked once a day: no third Cloud Scheduler
    job (two of the three free ones are used).
  - An order is a record on its scene (`usgsScenes/{entityId}.order`), written by the functions only; from M4 the rules
    refuse a client's `status: 'ordered'` (an admin could set it with the Firestore SDK in M3), because
    `usgs.markOrdered` checks USGS first and refuses a scene already downloadable.
  - Reminders on days 7 and 12 (USGS deletes an unpaid order after two weeks); an order not delivered in 90 days is
    `expired` (USGS quotes three to four weeks after payment); Order again restarts it.
  - Automatic GCPs: a pair joins the fit on its own from a confidence of 0.6; between 0.3 and 0.6 it is only a
    suggestion the admin accepts and saves. From 15 confident pairs a fifth is held out as true checkpoints, which
    measures the checkpoint RMSE more strictly than M3's leave-one-out, so a borderline frame may now wait for Approve
    instead of publishing on its own.
  - Notifications: an in-app inbox per admin with a badge, and FCM web push only after the admin turns it on and the
    browser's own prompt is allowed; **UNVERIFIED** that FCM accepts tokens made with the SDK's default VAPID key (else
    Setup gains one console click). `fn-admin@` and `fn-events@` gain `roles/firebasecloudmessaging.admin`
    (**UNVERIFIED** as the narrowest role); Provision enables `fcm.googleapis.com` and `fcmregistrations.googleapis.com`.
  - Swipe compare makes a second Mapbox map load only on a window 600 px or wider; a phone gets a toggle on its one map.
  - New budgets, each logged by its owner when measured: the engine's `compare` chunk (a new `ENGINE_CHUNK_BUDGETS`
    table, at most 12 KB gzip) and the admin's `inbox` chunk.
- **52f PROPOSED, NOT APPLIED: e-mail notifications without a new provider.** A log-based alert policy per notification
  kind on the fan-out's structured log entry, sending through the Cloud Monitoring e-mail channel the `crash-alerts`
  provision item already creates for the owner. Not applied: alert conditions may be billed (**UNVERIFIED** at the time
  of the decision), one policy per kind is ten more cloud resources, and the in-app inbox and push cover the need. For
  the user's yes or no.
- **52g PROPOSED, NOT APPLIED: detect an order without the I ordered it click** through M2M `tram-order-search` and
  `tram-order-status` (`docs/research/design-review-onboarding.md` §0.4, **UNVERIFIED** for on-demand scans). Needs the
  first real order to see what they answer; until then the click is the one input after the purchase.

Verify: `PIPELINE_STAGE=static bash scripts/ci/run-all-checks.sh`; the shared, admin and ui (`map`) Vitest projects for
the edited files.

## 53. The M4 tooling workstream: Terra Draw 1.38.0 and the third-party notices (2026-10-24) — 53a and 53b APPLIED (the user's decisions §52c and §52d; a new gate and a stricter `release` stage, the pre-approved kind); 53c recorded for the user; 53d PROPOSED, NOT APPLIED

No gate was relaxed, no checker allowlist entry was added, and the only download was the approved `terra-draw@1.38.0`.
Configuration edits, each of the pre-approved kind (a stricter gate, or keeping a tool working): the `notices` gate in
`scripts/ci/pipeline.py` (stages `build` and `release`), and a project reference to `packages/ui` in
`tsconfig.tools.json` (the Vite configs read the kit's font table).

- **53a APPLIED: `terra-draw` 1.37.0 → 1.38.0** (§52c). `npm view terra-draw@1.38.0` (MIT, no dependencies, no peer
  dependencies, published 2026-10-18), then `npm install --save-exact terra-draw@1.38.0 --workspace @hcm/ui` in the
  digest-pinned `node:24-bookworm-slim` (`docs/SETUP.md` → *npm in a container*): one package changed
  (`packages/ui/package.json` and its two lockfile lines; the lockfile's integrity is the registry's). The `HELD` entry
  went in the same change (`scripts/ci/check_dependency_updates.py`, `docs/CI_PIPELINE.md` → *Held dependencies*).
  `terra-draw-mapbox-gl-adapter` stays at 1.5.0: it is the adapter's latest release and peers `terra-draw ^1.0.0`, so
  1.38.0 needs nothing of it and there is nothing to propose. Verified: the drawing unit tests
  (`packages/ui/test/map/draw/`, 67 tests, the real Terra Draw on a canvas among them), the admin's drawing and dragging
  specs (`e2e/admin/specs/pois/drawing.spec.ts`, `dragging.spec.ts` at `admin-c360-ro` and `admin-l1440-ro` with the
  tier's setup: 17 passed), and `tsc -b` of `packages/ui` (the declarations of 1.38.0 still need only what
  `terra-draw-env.d.ts` declares). The `terra-draw` chunk measures 47.7 KB gzip (47.4 KB with 1.37.0), under its 58 KB
  budget, which stays. With the other M4 workstreams running gates in the same tree, the new lockfile's digest was
  written to `node_modules/.hcm-install-stamp` (`npm install` had already brought `node_modules` to it), so the next
  pipeline run does not `npm ci` under their tests; the quality image still rebuilds its npm layer on the next
  `run-all-checks.sh`, as after §44 (the lockfile is one of its inputs).
- **53b APPLIED: the third-party notices** (§52d; contract M4-interfaces §6.4).
  - **The generator** is the Vite plugin `thirdPartyNoticesPlugin` (`scripts/site/src/notices.ts`) in both Vite
    configs, not the contract's `scripts/build/notices.mjs` (CR-M4-10): it reads Rolldown's own module list of each
    output, and `scripts/site` is the build tooling with its own Vitest project, measured at 90 % per file (this file
    and `licence-texts.ts` at 100 %). A package is bundled when one of its modules renders code into a chunk
    (`renderedLength` above zero); it is the folder under the last `node_modules/` of the module's path, named by its own
    `package.json`. The fonts' two packages join through the kit's font table (`FONT_FILES`), each with the files copied
    from it (`File:` lines). It writes `THIRD_PARTY_NOTICES.txt` beside `engine.mjs` and `admin.mjs`, sorted, without a
    date: on 2026-10-24 the engine's lists 14 packages (98 KB), the admin's 25 (178 KB).
  - **Packages without a licence file.** The npm packages of the Firebase JS SDK (`firebase` and every `@firebase/*`
    bundled, 13 in the admin), `terra-draw` and `terra-draw-mapbox-gl-adapter` ship no `LICENSE`. Their entry carries
    the copyright lines of their bundled files (`Copyright 2019 Google LLC`, `Copyright The Closure Library Authors`,
    …), or, when there is none, their `author` (Terra Draw and its adapter: James Milner), then the standard text of
    the licence they declare, from `scripts/site/src/licence-texts.ts`: the Apache License 2.0's terms as
    `material-symbols` 0.48.0 ships them (the appendix on applying the licence left out), and the MIT License as `zod`
    4.6.6 ships it, without its copyright line. A package without a licence file whose licence has no text there stops
    the build.
  - **The gate** `notices` (`scripts/ci/check_notices.py`, 100 % of its lines and branches in `scripts/ci/tests`), in
    `build` after `vite-build` and in `release` (so the bundles a release attaches carry complete notices), checks each
    file against evidence the plugin does not write: the build's source maps (`sourcemap: true` in both configs) and
    the installed packages. Every package a source map names has its entry with the same version, the licence id its
    `package.json` declares and a licence text; an entry naming copied files names files the build ships, from the
    installed package at that version; no other entry; every font file shipped is named; every licence is on
    `ALLOWED_LICENCES`, the contract's list (MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, OFL-1.1, 0BSD, CC0-1.0).
    The source maps and the plugin agree on both builds today (no entry missing, none extra).
  - **Where the files go**: the site build copies every file of the engine build, the notices with them; the release
    attaches `packages/engine/dist/*` and `packages/admin/dist/*`; Hosting serves `packages/admin/dist` (it ignores only
    dotfiles and source maps), so the admin's notices are at `/THIRD_PARTY_NOTICES.txt`.
- **53c Recorded: what the notices leave out, for the user's review.** The bundler's own helpers (Rolldown's runtime,
  Vite's preload helper: generated code, not a package's files) and Mapbox GL JS (external, loaded from Mapbox's CDN
  under Mapbox's terms). For the packages that ship no licence file, the entry is the best the installed package gives:
  Terra Draw and its adapter name their author but ship no copyright line; comparing those two entries once with the
  `LICENSE` of their upstream repository (`JamesLMilner/terra-draw`) is a reading the user may want (nothing was
  downloaded for it).
- **53d PROPOSED, NOT APPLIED: a visible link to the notices.** The viewer's attribution control and the admin's menu
  could link `THIRD_PARTY_NOTICES.txt` ("Licențe" / "Licences"). Not applied here: it is a user-visible behaviour (two
  strings in both languages, a scenario row per surface, tour states), outside the tooling workstream's files, and the
  file is reachable without it (beside the engine, on Hosting, in the release).

Verify: `PIPELINE_STAGE=static bash scripts/ci/run-all-checks.sh`; the `tools` Vitest project
(`scripts/site/test/notices.test.ts`), the ui project's `packages/ui/test/map/draw/`, `scripts/ci/tests` in the image,
`npm run build` then `python3 scripts/ci/check_notices.py`.

## 54. The M4 assists-notify workstream: title suggestions, translation drafts, the inbox and push (2026-10-24) — 54a and 54b APPLIED (a stricter configuration and stricter budgets, the pre-approved kinds); 54c–54h decided within the contract and recorded for the user; 54i PROPOSED, NOT APPLIED

Written by the assists-notify workstream (`docs/research/M4-interfaces.md` §4, §5, §6.1). Nothing was deployed, no
download was made and no real Nominatim, Vertex AI or FCM endpoint was called: the functions run against the shared fake
upstreams (`@hcm/test-support/fakes`: `nominatim`, `vertex-ai`, `fcm`) and the Firebase emulators.

- **54a APPLIED: the M4 feature folders join `functions-feature-folders-independent`** (`.dependency-cruiser.cjs`): `assist`
  and `notify` reach the rest of the backend only through `ports/`, `api/` and `@hcm/shared`, as the M2 and M3 folders do
  (a stricter rule, the pre-approved kind §46c names).
- **54b APPLIED (stricter budgets and a build group, the pre-approved kinds): the inbox's chunks have budgets.**
  `scripts/ci/check_bundle_budget.py` `ADMIN_CHUNK_BUDGETS` gains `inbox` 5 KB, `messaging-sdk` 7 KB and
  `firebase-installations` 4 KB, `assist` 3 KB and `firebase-messaging-sw.js` 1 KB (the push service worker the admin
  page build writes beside the chunks, which the gate counts); `packages/admin/vite.config.ts` gains the code-splitting
  groups `firebase-installations` (`@firebase/installations`, priority 2), without which Rolldown put it into
  `editor-shared` (14.3 KB of 13; at priority 4 it pulled modules of the first load with it), and `assist` (the editors'
  assists, which the photo, place and layer editors share: in `editor-shared` they made it 13.2 KB of 13). Measured on
  2026-10-24: `inbox` 3.4 KB, `messaging-sdk` 5.7 KB, `firebase-installations` 2.9 KB, `assist` 2.2 KB, the worker
  0.7 KB, `editor-shared` 11.6 KB. The remaining over-budget chunk of that build, `imagery` (18.2 KB of 18), is the
  orders workstream's.
- **54c DECIDED: FCM over its REST API, and the browser's registration is its Firebase installation ID.** The functions
  send with FCM HTTP v1 over REST (`functions/src/adapters/fcm.ts`, the functions' own token, one `messages:send` per
  device, a `validate_only` dry run before a device is stored), not firebase-admin's `getMessaging()`, so the Functions
  emulator reaches the fake FCM through `createEmulatorFetch` like every other Google API and no local run can push to a
  real browser. The installed `firebase@13` deprecates `getToken` (ESLint's `no-deprecated` refuses it, and no suppression
  is allowed): the admin registers with `register` and reads the installation ID (FID) from `onRegistered`
  (`packages/admin/src/firebase/messaging.ts`), and the functions target it as `message.fid`, exactly as firebase-admin
  14.5's `FidMessage` sends it. The shared schemas keep the field's name `token` (`notify.registerDevice {token}`,
  `pushDeviceDocSchema.token`): an FID matches its pattern. UNVERIFIED (CR-M4-24 asks §10 of the contract to list it): that FCM's REST API
  accepts `fid` from our REST call as it does from firebase-admin; proof: the first `notify.sendTest` after Provision. An
  FID that rotates later (the SDK registers it again only while an `onRegistered` handler is set, and ours is removed once
  the registration is read) makes FCM answer `UNREGISTERED`: the device is forgotten and the admin turns push on again.
- **54d DECIDED: an admin's settings document records its creation, and a read item's time is its stamp.** The settings
  (`admins/{uid}/notify/settings`) are created by the admin's first Settings change through the content store, which
  stamps `createdAt`: `notifySettingsDocSchema` gains `createdAt` (optional, create only), as do `CLIENT_WRITES` and the
  rules (`createdAt == request.time` on create, never changed by an update), and `notify.registerDevice` keeps it. Marking
  an item read writes `read: true` with the stamp (`updatedAt` is when); the rules still allow `readAt` only as
  `request.time` for a client that sends it.
- **54e DECIDED: the admin's push service worker is plain JavaScript, and the `e2e` build has a stand-in registrar.**
  The site build writes `firebase-messaging-sw.js` next to the admin's page (`scripts/site/src/admin/service-worker.ts`):
  no Firebase SDK and no `importScripts` from a CDN (the CSP, and no third-party code in the worker); it shows a push's
  `notification` (title, text, tag) as text and opens its `fcm_options.link` on the admin's own origin only. UNVERIFIED:
  the payload's field names on a real push (proof: the first `notify.sendTest`). The `e2e` build's registrar keeps the
  browser's real permission (Playwright grants it, or the Chrome DevTools Protocol denies it) and hands out a fixed
  registration per `?test=` (`e2e-fcm-token:<test>-browser-0001`), since no browser test may reach FCM; the server side
  is the fake FCM.
- **54f DECIDED: what Provision adds.** `REQUIRED_APIS` gains `aiplatform`, `fcm` and `fcmregistrations`; `fn-admin@`
  gains `roles/aiplatform.user` (the drafts and the self-test's `countTokens`) and `roles/firebasecloudmessaging.admin`
  (the test push and the device's dry run); `fn-events@` gains `roles/firebasecloudmessaging.admin` (the fan-out's pushes).
  The narrowest FCM role stays UNVERIFIED (contract §10).
- **54g DECIDED: shared pieces the producers use.** One emit helper for every producer
  (`functions/src/api/notification-event.ts`: the event's id from its parts, `create` so a redelivery writes nothing, a
  failure logged and never thrown into the producer); the admin shell's watchers (the session, the unread badge) moved out
  of `packages/admin/src/app/mount.ts` into `app/shell-watches.ts` to keep `mount.ts` within its size. The fan-out records
  a push on the item as it is now (a transaction), so an item the admin opened while FCM was sending stays read.
- **54h DECIDED: the notification and assist specs hold the admin tier's lock.** The geocoding queue's cool-down
  (`ops/assist`) and cache (`assistGeocodes/*`), the month's AI counters (`usage/ai-*`), the inboxes, the events and the
  server's fake upstreams are one per project, so `e2e/admin/specs/{assists,notify}/` run as the owner on the project's
  city under `ADMIN_LOCK`, whose reset empties them. An event fans out to every admin, and an unlocked content spec may
  fail a job of its own city meanwhile (`specs/imagery/jobs.spec.ts`): the specs look for their own items and never count
  an inbox exactly.
- **54i PROPOSED, NOT APPLIED: e-mail.** No e-mail is sent: the stack has no mail provider and adding one is a new
  account. The path without a new provider (a log-based alert policy on the fan-out's structured log, through the
  Cloud Monitoring e-mail channel the `crash-alerts` item creates) stays the contract's proposal (§52f, contract §5.7),
  for the user to decide.

## 55. The M4 compare workstream: our own swipe compare, and the public site reading the bucket's manifest (2026-10-24) — 55a–55d APPLIED (product and test changes; 55b a stricter gate and 55c a build setting, the pre-approved kinds; no gate relaxed, no checker allowlist entry); 55e PROPOSED, NOT APPLIED (a workflow line, ask first)

The compare workstream built swipe compare as the user decided (§52a; `docs/research/M4-interfaces.md` §3) and aligned
the public site with the PLAN (§51e). Nothing was downloaded and no real endpoint was called.

- **55a APPLIED: the public site reads the manifest the admin publishes** (§51e; PLAN → *Architecture*: the public viewer
  GETs `gs://<project>-public/cities/{city}/manifest.json`). `sites/bucharest/site.json` says `publicManifest: true`; a
  site build that names the public bucket (`HCM_PUBLIC_BUCKET`, forwarded by `scripts/ci/run-all-checks.sh` by name like
  `MAPBOX_PUBLIC_TOKEN`) writes a generated `config.js` whose `manifestUrl` is
  `https://storage.googleapis.com/<bucket>/cities/bucharest/manifest.json`, bundles no `data/` snapshot, and adds the
  bucket's origin and the project's crash-report endpoint (`https://<region>-<projectId>.cloudfunctions.net`, from
  `infra/project.json`, the functions' own formula) to the page's CSP (`scripts/site/src/public-manifest.ts`). Without a
  bucket every site bundles its manifest as before (the starter kit always does). The viewer never reads Firestore. Rows
  `S-V01-HAPPY-PUBLIC-BUCKET` and `S-V01-BAD-PUBLIC-BUCKET-404` (`e2e/specs/viewer/public-manifest.spec.ts`, the e2e site
  `bucharest-bucket`; a bucket without the manifest shows the not-found card, never a stale snapshot). For the go-live
  the user sets the repository variable and approves 55e; until then Pages keeps the seed snapshot.
- **55b APPLIED (a stricter gate, the pre-approved kind): the engine's lazy chunks have budgets.**
  `scripts/ci/check_bundle_budget.py` gains `ENGINE_CHUNK_BUDGETS`: `compare` 5 KB (4.2 KB measured, the contract's
  ceiling 12 KB) and `firebase-sdk` 16 KB (13.3 KB measured, unbudgeted until now); a chunk of the engine without a
  budget fails, as the admin's do. Measured on 2026-10-24: `engine.mjs` 97.5 KB of 100 (96.0 before compare),
  `engine.iife.js` 116.6 KB of 125.
- **55c APPLIED (a build setting that keeps the entry whole): `preserveEntrySignatures: 'allow-extension'`** in
  `packages/engine/vite.config.ts`. Vite's library default (`strict`) moved everything the compare chunk shares with the
  entry into a third chunk, `map-sync-<hash>.js` (44.6 KB), which `engine.mjs` imported at once; now the chunks import what
  they share from `engine.mjs`, which may carry those internal exports besides the documented ones (only the names of
  `docs/ENGINE_API.md` are the API). The IIFE is one file as before.
- **55d APPLIED: what the build decided within the contract** (`docs/research/M4-interfaces.md` → *Change requests*,
  CR-M4-10):
  - The legal line is the viewer map's: its Mapbox logo and attribution (z-index 2 in mapbox-gl.css) stay above the
    second map at every divider position, the second map's own are hidden, and the compare bar credits the compared
    layer's source ("Sursa: …"); the contract had the second map's attribution on the right, which a divider at 100 %
    clips away. The legal mirror of a modal sheet keeps reading the viewer map, as before.
  - The second map is inert and lets every pointer through: the viewer's map takes every gesture and the second follows
    its camera, so either side drags, zooms and clicks alike, and no second canvas is a keyboard stop. The divider's
    handle is the only drag target; it sits below the map's centre (the centre stays the map's) and, on a phone held
    landscape, ends before the vertical timeline.
  - MapPort's `move` is forwarded at once (Mapbox fires it once per rendered frame), not a frame later as the contract
    said, so the followed map draws the same camera in the same frame.
  - The chunk's entry is `packages/engine/src/compare/compare.ts` (Rolldown names a chunk after its entry file:
    `compare-<hash>.js`), reached through `import('./compare/compare.js')` in `mount.ts`'s browser environment.
  - The chooser of the compared side is a native `<select>` (the browser's own list on every device, no popup to keep
    clear of the controls); the tour's `viewer.compare-menu` is the state after choosing. The edge states are
    `viewer.compare-swipe-edge` (0 %) and `viewer.compare-swipe-edge-end` (100 %).
  - A drag settles the divider on the whole percent, as the keys and the hash do.
- **55e PROPOSED, NOT APPLIED (a workflow edit, ask first): the CI build reads the bucket.** One line in
  `.github/workflows/ci.yml`, job `build`, step `Build stage`, `env:` beside `MAPBOX_PUBLIC_TOKEN`:
  `HCM_PUBLIC_BUCKET: ${{ vars.HCM_PUBLIC_BUCKET }}`, and the repository variable itself
  (`gh variable set HCM_PUBLIC_BUCKET --body bucurestiul-disparut-public`, a settings change: ask first) once the admin has
  published the city's manifest. Unset, the Pages site keeps bundling the seed snapshot.

Verify: `PIPELINE_STAGE=static bash scripts/ci/run-all-checks.sh`; the engine, ui and tools Vitest projects; the build
and `scripts/ci/check_bundle_budget.py`; `E2E_TIER=fn npx playwright test specs/viewer/compare.spec.ts
specs/viewer/public-manifest.spec.ts --project fn-l1440-ro` and the tour's compare journey at every viewer viewport.

## 56. The M4 integrator: the change requests closed, the cross-app journey, and what waits for the user (2026-10-24) — 56a–56e APPLIED (product, test and documentation changes; 56b a new lazy chunk with its own budget, the pre-approved kind; no gate relaxed, no budget raised, no checker allowlist entry); 56f recorded for the user

The M4 integrator worked alone after the five workstreams (orders, autogcp, compare, assists-notify, tooling), resolved
their open change requests and checked the flows across the apps against the emulators and the fakes. Nothing was
downloaded, committed, pushed or deployed, and no real Google, Mapbox, USGS, STAC, Nominatim, Vertex AI or OpenStreetMap
endpoint was called. The user's decisions of 2026-10-23 stand as §52a–§52d record them, all four APPLIED: swipe compare
is the engine's own (the plugin loader, its Subresource Integrity plan §18b and the M2 open item are superseded; no
source names `mapbox-gl-compare` any more), the Romanian and English drafts go through Vertex AI Gemini on the server
(turned on by Provision, never published by themselves), `terra-draw` is 1.38.0 with its hold removed, and both builds
write a complete `THIRD_PARTY_NOTICES.txt` that the `notices` gate checks (complete for the engine since 56a).

- **56a APPLIED: the open change requests.**
  - CR-M4-11: the Firestore adapter's `buildQuery` converts every filter operand as it converts a stored value
    (`toFirestoreValue`), so a timestamp range matches; M3's daily cap of raster jobs (`JOBS_PER_DAY`) now counts the day's
    jobs in production. Pinned on the emulator (`functions/test/adapters/documents.test.ts`).
  - CR-M4-19: the notices plugin no longer clears what it gathered at each `buildStart`; one plugin instance lives for
    one `vite build`, whose library mode starts one build per format, so the file written last lists both formats'
    packages (`lit` from the IIFE's inlined compare chunk). `[notices] OK`, 13 engine packages.
  - CR-M4-14: the obsolete `adminContent.imagery.needsOrderNote` is gone from both catalogues.
  - CR-M4-24: `docs/research/M4-interfaces.md` §5.4 and §10 describe the push registration as built (the installation
    ID, `message.fid`), with its proof by the first `notify.sendTest`.
  - CR-M4-25: the public bucket's address in `S-V01-HAPPY-PUBLIC-BUCKET` is in backticks; `docs/E2E_SCENARIOS.md`
    regenerated, `markdownlint` passes.
  - CR-M4-9: the docs, the skills and their mirrors, `docs/LESSONS.md` 190–202, `docs/research/M4-status.md`.
  - Two specs the split `quality` run found (test changes only): the title-suggestion spec counts the Nominatim
    requests of its own cell, since a content spec drawing a place beside it asks for the city's centre in the same
    server world (`docs/LESSONS.md` 201); the Setup steps' self-test spec counts `SELF_TEST_CHECKS.length`, which M4's
    `ai` check made ten (`docs/LESSONS.md` 202).
- **56b APPLIED (a new chunk with its own budget, the pre-approved kind): the order card is a lazy chunk.** With M4's buy
  flow the Imagery area's chunk measured 18.2 KB against its 18 KB budget (§47a). The budget was not raised: the order
  card, which only a scene to buy or with an order shows, is fetched the first time such a scene opens
  (`packages/ui/src/admin/imagery/orders/lazy-card.ts`: Loading until it is in, a failed fetch says so with Try again,
  `ImageryContext.refresh` re-renders the page once it is in). `ADMIN_CHUNK_BUDGETS` gains `order-card` 2 KB (1.7 KB
  measured on 2026-10-24 plus about 20 %); `imagery` measures 17.6 KB. A codeSplitting group was tried first and
  dropped: Rolldown's groups take what their modules import along, and every area then imported the group
  (`.agent/skills/quality/pipeline_skill.md` → *Local tooling quirks*).
- **56c APPLIED: behaviour A48, the cross-app journey** (`e2e/admin/specs/imagery/automation.spec.ts`; rows
  `S-A48-HAPPY`, `S-A48-BAD-OVER-THRESHOLD`). Happy: the free 1966 frame imported with one click and published; the
  1968 frame to buy through its order card (EarthExplorer, then I ordered it: the `buyScan` budget); the fake USGS
  delivers and a day passes (`order.nextCheckAt` written in the past); `imagery.tick`'s watch imports it (the job created
  by the admin who ordered); the stand-in pipeline's automatic points under the threshold; approved by `system:imagery`
  and published by the fake MTS with no click; the next tick marks the order imported; the inbox lists
  `order.delivered` and `order.imported`, whose item opens the published version; the manifest lists both layers, and
  the public viewer at a wide window compares the bought scan with the 1966 layer on two maps (the divider names both
  sides, each side's tiles in its colour; Close leaves one map: created 2, removed 1). Bad: over the threshold the
  version waits for Approve, the inbox's `layer.readyToApprove` item opens it, nothing reaches Mapbox. The spec is tiered
  with M3's publish specs (`IMAGERY_PUBLISH_SPECS` in `e2e/projects.ts`: per push at `admin-c360-ro` and
  `admin-l1440-ro`, at the other three admin projects in `tour-matrix`).
- **56d APPLIED: the local stack's M4 world** (`npm run dev:stack`): the 1968 Corona frame stays one to buy (its preview
  seeded), the Declass 3 frame is marked as ordered through `usgs.markOrdered`, the 1976 import waits for points with the
  matcher's suggestions (the stand-in's `suggestions` outcome instead of `no-match`), and the failed import, the draft
  over the threshold and the version waiting for points reach every admin's inbox through the server's own events. The
  stack's check gains the order card and the inbox (`e2e/stack/check.ts`). `docs/MANUAL_TEST_PLAN.md` gains section F
  (O1–O5, G1, A1, A2, N1, N2), V11 (compare) and the go-live's bucket variable (V0, D7).
- **56e APPLIED: the documentation** of M4: both admin guides (buying a scan, suggested pairs, title suggestions, drafts,
  notifications, the visitors' compare, costs, troubleshooting), `docs/ARCHITECTURE.md` (the M4 functions, 61 in all),
  `docs/TESTING.md`, `docs/CI_PIPELINE.md`, the build and deploy workflows (`HCM_PUBLIC_BUCKET`), the quality skills
  (`ENGINE_CHUNK_BUDGETS`, `order-card`, the M4 tooling quirks) and the e2e skills with their mirror.
- **56f Recorded: what waits for the user** (each ask first; `docs/research/M4-status.md` §3): the deploys (functions,
  rules and indexes, the admin, the pipeline image with the new matcher), Provision turning on Vertex AI (the paid EEA
  tier, under 0.05 USD a month, capped at 0.50 USD), FCM and FCM registrations, the first real scan purchase in
  EarthExplorer (35 USD for one frame; Claude never pays), the CI line of §55e with the `HCM_PUBLIC_BUCKET` variable,
  the proposals §52f (e-mail through a log-based alert), §52g (detecting an order without the click), §53d (a visible
  licences link) and §54i (e-mail), and the advisories of §48a and §49i that keep the four audit gates red (bumps
  applied 2026-10-25, §64).

Verify: `PIPELINE_STAGE=static`, `tests`, `build` (`bash scripts/ci/run-all-checks.sh`) and `PIPELINE_STAGE=quality bash
scripts/ci/e2e-split.sh`; `E2E_TIER=admin npx playwright test specs/imagery/automation.spec.ts --project admin-l1440-ro`.

## 57. The M4 reviews' fixes: security, cost and minimum input (2026-10-24) — 57a–57i and 57k–57o APPLIED (product, test and documentation changes; no configuration of the ask-first kinds, no gate relaxed, no budget raised, no checker allowlist entry); 57d's approval-policy guard, 57h's probe, 57i's import map and 57j PROPOSED, NOT APPLIED

Two reviews of the M4 working tree (security and cost; minimum input and UX) found 24 problems, two of them the same.
Every one was applied as below or is proposed for the user's decision; none was wrong. Rows:
`S-A13-BAD-SCANNED-WHILE-MARKING`, `S-A13-BAD-WAITS-FOR-APPROVAL`, `S-A45-BAD-DAILY-CAP`, `S-A45-BAD-LINKS-CHANGED`,
`S-A47-BAD-SHARED-BROWSER`, `S-P03-BAD-NO-SPREAD` (new) and the asserts of `S-V06-BAD-COMPACT-WIDTH`, `S-A09-HAPPY-TITLE-SUGGESTION`,
`S-A09-HAPPY-TRANSLATE-DRAFT`, `S-A13-BAD-NEVER-DELIVERED`, `S-A44-HAPPY`, `S-A46-HAPPY-FAN-OUT`; the defects in
`docs/LESSONS.md` 203–218.

- **57a APPLIED: the editors' assists.** A translation draft answered after another item opened is dropped (the session
  counts the open item; it filled the next photo's title before). A queued title cell no answer reaches within
  `GEOCODE_QUEUED_MINUTES` ends the wait with `apiError.assist.unavailable`, so Suggest a title works again. A photo's
  pin asks for suggestions by itself while nobody chose its title: empty, a camera's naming (`isCameraName`, shared with
  `photos.onUpload`) or the title its file gave it (`suggested.title`); every upload starts titled after its file, so a
  real upload never asked before. A draft is offered only for an empty side (it replaced typed text), its note stays
  once it filled the field.
- **57b APPLIED: the inbox's pruning costs a few reads.** `notify.onEvent` read the newest 250 items of every admin's
  inbox on every event (about 200 reads each once full). `DocumentStore` gains `count` (an aggregation: one read per
  thousand documents); the inbox is counted and only its items over `INBOX_MAX_ITEMS`, oldest first, are read and
  deleted.
- **57c APPLIED: compare reuses its second map across window changes.** A compact window hides the second map (its
  container stays, `visibility: hidden`, so Mapbox is never sized to nothing) for `COMPARE_PARK_MS` (60 s) and destroys
  it then; a wider window within the minute shows the same map (a phone turned back and forth, a window dragged across
  600 px paid a map load each time). Close, Esc, a lost map and `destroy()` destroy it at once. The chooser leaves out
  what the main side shows, unless it is the side compared now (both sides could show the same layer).
- **57d APPLIED in part: the automatic georeference's edges are measured.** The integration tests asserted the median
  distance from the truth only; the largest (a corner, outside the matched pairs' hull, where `poly2` extrapolates) was
  14.1, 11.7 and 23.4 m. They now assert both: the median within `EXPECTED_RMSE_M` (15 m) and the largest within
  `EDGE_ERROR_M` (30 m); `M4-status.md` says so instead of "within 15 m". **PROPOSED, NOT APPLIED:** an edge guard in the
  approval policy (checkpoints chosen near the hull, or `poly2` refused when it bends more than the threshold outside
  the hull) would hold such a version for Approve; it changes when bought scans publish by themselves, so it waits for
  the `real-data` measurement on a real Corona frame and your decision.
- **57e APPLIED: a daily cap on title suggestions.** `ops/assist` counts the cells queued on the UTC day
  (`queuedDay`, `queuedToday`); past `GEOCODE_DAILY_CAP` (300, far above an admin's real use) the answer is
  `apiError.assist.dailyCap` and nothing is queued, so no scripted session can keep Nominatim busy (its policy forbids
  bulk use). The cool-down's write keeps the count (a transaction). A task the queue refuses takes its cell back.
- **57f APPLIED: a browser stops getting an admin's notifications when it should.** The push record in `localStorage`
  names its admin (`{uid, deviceId}`, `packages/admin/src/inbox/push-device.ts`): another admin signed in sees push off;
  sign-out unregisters this browser for the admin (best effort) and forgets it; `notify.registerDevice` removes the same
  browser from every other admin (one browser, one admin); `admins.revoke` deletes the removed admin's push devices,
  inbox and notification settings first, while the account is still an admin's (its open page then sees its inbox
  emptied, not a listener denied mid-edit, LESSONS 218), then the access document; turning push off when the server
  cannot be reached leaves it on and says why.
- **57g APPLIED (a cloud change on the next Provision, ask first as always): a custom role for Vertex AI.**
  `roles/aiplatform.user` also lets `fn-admin@` start billable custom jobs and deploy endpoints. The `iam` item now
  makes the project's custom role `hcmVertexDrafts` (`aiplatform.endpoints.predict` only) before the role table binds
  it to `fn-admin@`, undeletes and corrects a deleted or changed one, and leaves a right one alone; the permission
  messages name it. UNVERIFIED until the first real call (M4-interfaces §10): that `aiplatform.endpoints.predict` is all
  `generateContent` and `countTokens` of a publisher model need; the setup self-test's `ai` check proves it for free,
  and if it does not, adding the missing permission to `VERTEX_DRAFTS_PERMISSIONS` and running Provision again repairs
  the role.
- **57h APPLIED: the EarthExplorer guide no longer claims an unverified button.** Only the scene's page was verified
  (`design-review-onboarding.md` §0.6); step one now says to add the scene to the basket from the search results.
  **PROPOSED, NOT APPLIED:** checking the basket control in `check_contracts.py`'s weekly probe: EarthExplorer draws its
  controls with JavaScript, so a plain HTTP probe cannot see them; the first real order confirms the steps.
- **57i APPLIED (documentation): SRI and the lazy chunks.** `docs/ENGINE_API.md` says that `integrity` covers only the
  file it is on, that `engine.mjs` fetches `compare-<hash>.js` and `firebase-sdk-<hash>.js` without one, and that a page
  relying on SRI loads `engine.iife.js`, which carries both. **PROPOSED, NOT APPLIED:** publishing an import map with
  `integrity` entries for the module build's chunks with each release.
- **57j PROPOSED, NOT APPLIED: how a shared compare link opens.** A `cmp=` link opens the second map (a map load) for
  everyone it is shared with and on every reload; opening it as the one-map toggle, or with a prompt, would spare that
  load but changes behaviour V06's deep link (`S-V06-HAPPY-DEEP-LINK`), which the plan asked for.
- **57k APPLIED: the orders' screens.** The expired card offers Take the mark back (`usgs.cancelOrder` accepted it, but
  nothing offered it, so Work's count could never go down); a reminder already sent no longer counts in Work and wears
  the waiting tone, and its note tells an admin who paid there is nothing to do; before USGS approves downloads both
  cards say the daily check waits for it, with the link to Setup's USGS step, and the next check reads "after USGS
  approves downloads"; the refusal of I ordered it on a frame scanned meanwhile is also the snackbar's (the card it was
  shown in disappears with the order; an inline alert on the page left the map's attribution a sliver under the app bar
  at 768 px, LESSONS 216), and a refused mark moves the keyboard to the scene's heading
  (`ImageryContext.focusDetail`: the clicked button may go with its card); the checks' times are in the admin's own time
  zone, as the inbox's. The photo editor's banner (the place to check) sets its ring's colour, which fell under 3:1 in
  the dark scheme (LESSONS 216).
- **57l APPLIED: the georeferencer's suggestions.** Each pending suggestion's distance is computed from the page's live
  fit (`distanceFromFit`), not the matcher's stored residual; Accept all leaves the keyboard on the panel's heading; a
  version whose confident pairs lie in a line waits with `apiError.imagery.noSpread {pairs}` (the pipeline's
  `Decision.degenerate`), not `noMatch`'s "too few".
- **57m APPLIED: the notifications.** `layer.needsPoints` is pushed by default (a bought scan whose automatic points
  failed reached only the inbox); `order.imported` says the scan is imported into a layer version that is published or
  waits; "1 devices" and "1 necitite" are gone (`pluralOf` in `@hcm/shared`; the Romanian badge reads "necitite: 3").
- **57n APPLIED: a draft keeps the source's links.** A description's draft may carry Markdown links, and the viewer
  renders them; text pasted into the source could tell the model to add one. A draft with a link address the source
  lacks (added, changed, or kept as text) is no draft: `apiError.assist.linksChanged` (`draftKeepsLinks`).
- **57o APPLIED (the test world): a seeded running job holds a lease.** The fixes' first split `all` run lost the jobs
  tour's running import at two viewports: another spec's `imagery.tick` (over every city) took it, lease-less, for a lost
  execution and ran it again, and the stand-in runner failed it; a third run found its waiting job dispatched once its
  date (2026-10-24) had passed on the server's wall clock. `seedJob` (`e2e/admin/support/ops.ts`) gives a seeded running
  job a lease held far ahead, as a live pipeline's heartbeat would, and the waiting job's date is in 2100
  (`docs/LESSONS.md` 217).

Verify: `bash scripts/ci/e2e-split.sh` (stage `all`; the four audit gates stayed red on §48a and §49i until their bumps of
2026-10-25, §64).

## 58. The M5 contracts (2026-10-25) — 58a recorded for the user; 58b–58f PROPOSED, NOT APPLIED (workflow edits, possible gate exclusions, the template repository, the npm publish); 58g and 58h for the user's decision; 58i recorded

The M5 contracts agent wrote `docs/research/M5-interfaces.md` alone before the four M5 workstreams (multi-city, release,
kit-cli, export), with the shared schemas, API schemas, error codes, catalogues, input budgets, tour sections and the
56 planned scenario rows it names (CR-M5-1). No lint, tool, workflow or gitleaks configuration changed, no gate was
relaxed, no checker allowlist entry was added, and nothing was downloaded, pushed, tagged, published or deployed.

- **58a Recorded: what the contract decided that the user may want to see.**
  - Membership lives on the admin's own document (`admins/{uid}.cities`: city id to `owner` or `editor`), written by the
    functions only; the custom claim stays `admin: true`. The project's owner creates cities and sets their budgets; a
    city's owner invites and removes that city's admins and exports it; an editor edits its content. Admins from before
    M5 keep every city (the project owner as owner, every other admin as editor), migrated at their first session and by
    `ops.tick`. Resuming the project's budget guard (`imagery.resumeGuard`) becomes the project owner's, since it
    resumes every city's imagery.
  - Switching city reloads the admin page (one city per page load, so no listener of another city survives); an admin of
    one city sees no switcher and no address change. New city takes three inputs (the name, one rectangle, Create); the
    city starts unpublished, with no legacy import, and its first USGS harvest runs at the next five-minute tick.
  - Per-city budgets: a new city gets a quarter of the free Mapbox compute units a month, three raster jobs a day, 100 AI
    drafts a month, 100 title suggestions a day and three exports a day; Bucharest, with no limits, is held by the
    project's caps only, as today. At most 20 cities a project.
  - GitHub Pages: Bucharest stays at the root (its old links keep working), every other city at `/<city>/`; a city's
    site is a committed `sites/<city>/` folder, because the admin holds no GitHub credential.
  - The first engine release is v1.0.0; the release commit holds the built engine in `cdn/engine/` (about 1 MB, no
    source maps) with `release.json` (the SRI of every file), because jsDelivr's GitHub route serves only what a tag
    holds and `dist/` is ignored.
  - The starter kit's template ships no photos (the M1 kit's examples are licensed for București dispărut only) and no
    `config.js`: `<hcm-map-viewer manifest-url="city.json">` is the configuration; its page frame moves into
    `engine.css` (`.hcm-fullpage`, `.hcm-note`), so the kit stays three files.
  - `create-historic-city` has no runtime dependency (one bundled file, the template and the self-host files inside the
    package), runs only the owner's own `firebase` and `gcloud` after a `y/N` per step, and fetches nothing.
  - The export's download is a V4 signed address that lives 15 minutes; the zip stays seven days.
- **58b PROPOSED, NOT APPLIED: GitHub Pages serves the assembled tree** (`.github/workflows/ci.yml`, a workflow edit that
  changes what is deployed: ask first). Once the site build's `--pages` lands (multi-city), the `Upload the GitHub Pages
  artifact` step's `path: dist/site/bucharest` becomes `path: dist/pages`. With only Bucharest's site both trees are
  identical. Verify: `PIPELINE_STAGE=build` (the site build writes `dist/pages`), the V26 rows.
- **58c PROPOSED, NOT APPLIED: the release workflow publishes the engine's release file, its source maps and the CLI's
  package, and purges the `@1` alias** (`.github/workflows/release.yml`; ask first: it publishes more). The `build`
  job's upload adds `cdn/engine/release.json` and `reports/release/create-historic-city-*.tgz`; the `publish` job's
  `files` add them beside the bundles (the maps are already in `packages/engine/dist/*`); a last step, with no
  repository code, requests `https://purge.jsdelivr.net/gh/ventura8/bucurestiuldisparut.github.io@1/cdn/engine/<file>`
  for each file `release.json` lists (best effort; the exact tag needs no purge). The SonarQube gate of the same commit,
  planned since M2, is the pre-approved kind (a stricter check) only if it reuses the SHA-pinned actions `ci.yml`
  already pins; the release workstream applies it then and logs it, else it joins this proposal. Verify:
  `PIPELINE_STAGE=static` (actionlint, the workflow policy and the action pins), then the first tag.
- **58d PROPOSED, NOT APPLIED (only if measured): static gates and the committed `cdn/engine/`.** Minified third-party
  code may trip the suppression scan (a bundled library's comment), EditorConfig (no final newline) or gitleaks (a
  false positive). The release workstream first measures; ignoring the generated folder in Prettier's or ESLint's own
  ignore file keeps a tool working (pre-approved, logged); any exclusion from the suppression scan, EditorConfig or
  gitleaks is a relaxation and waits here with its exact line and the finding that needs it. The preferred way out is
  the `cdn` transform itself (it already removes the source-map line), where a finding allows it.
- **58e PROPOSED, NOT APPLIED (ask first): the starter kit's GitHub template repository**, after v1.0.0 is tagged:
  `gh repo create ventura8/historic-city-map-starter --public`, push the three files of `templates/starter-kit/`, then
  `gh api -X PATCH repos/ventura8/historic-city-map-starter -F is_template=true` (the name is the user's choice).
- **58f PROPOSED, NOT APPLIED (the user's own steps): publishing `create-historic-city` to npm**, after the tag:
  `npm view create-historic-city` (is the name free), `npm login` (the user's account and 2FA), then
  `npm publish reports/release/create-historic-city-1.0.0.tgz --access public`. Claude never types the password or the
  one-time code.
- **58g For the user: whether jsDelivr serves this repository at a tag.** The release skill records jsDelivr's limits as
  150 MB a package and 20 MB a file; the tree is about 76 MB, but this was not probed (no request leaves the machine).
  The probe: open `https://cdn.jsdelivr.net/gh/ventura8/bucurestiuldisparut.github.io@legacy-2022/README.md` once. If
  it is refused, the alternatives are (1) a small repository holding only `cdn/engine/` per tag, which the release
  pushes to (a new secret: ask first), or (2) the engine on npm and `cdn.jsdelivr.net/npm/...` pins (an npm account
  step). Either changes only `engineCdnBase` and the release scripts.
- **58h For the user's decision: the photos licensed for this map only in an export.** The contract includes them (an
  export is the owner's archive, and Bucharest's 45 photos are all `permission-legacy`) and names them in `RIGHTS.md`
  and on the export card. The alternative leaves them out by default, with a box to include them (one more input).
- **58i Recorded: configuration edits the workstreams will make, each of the pre-approved kind and logged by its
  owner**: the CLI's Vitest project in `vitest.config.ts`, its dependency-cruiser rule and the `cities` and `export`
  feature folders in the `functions-feature-folders-independent` rule (`.dependency-cruiser.cjs`), the CLI's entry in
  `knip.json`, its scope in `sonar-project.properties`, the `templates/` root of the agent-asset checker, new
  `ADMIN_CHUNK_BUDGETS` rows (`cities`, `city-budget`, `export-card`), the `notices` gate over the CLI's bundle, and the
  `release` stage's `kit-pins` and `release-cdn` gates.

Verify: `PIPELINE_STAGE=static bash scripts/ci/run-all-checks.sh`; the shared and admin Vitest projects for the edited
files.

## 59. The M5 release workstream: the release scripts and gates, what committing `cdn/engine/` trips, the first release prepared (2026-10-25) — 59a, 59b and 59d APPLIED (stricter gates and configurations, and ignore entries that keep two tools working: the pre-approved kinds); 59c and 59j PROPOSED, NOT APPLIED (an EditorConfig relaxation; the exact publishing lines of §58c); 59e–59g and 59i recorded; 59h for the user, ask first

The release workstream of `docs/research/M5-interfaces.md` (§2, §6.1) built the scripts that write one version
everywhere, the released engine's folder, the starter kit's pins and the notes' pinned addresses, the gates that hold them
together, and measured which static gates read a committed `cdn/engine/`. Nothing was bumped, tagged, pushed, published
or downloaded, and no request left the machine: the bump, `cdn/engine/`, the kit's pins and the notes' block are the last
steps of M5 (§2.6), after the other workstreams' engine changes (kit-cli's `engine.css` frame, CR-M5-5) have landed.

- **59a APPLIED (stricter gates): `kit-pins`, `release-cdn`, `release-pack`, and `release-check` extended.**
  - `kit-pins` (`scripts/ci/check_kit_pins.py`, `static` and `release`): `cdn/engine/release.json` has the shape of
    `engineReleaseSchema` and lists every committed file of `cdn/engine/` with its size and SHA-384; the kit page
    (`templates/starter-kit/index.html`) pins Mapbox GL JS and, in its engine block, `engine.css` and a deferred
    `engine.iife.js` from one pinned jsDelivr folder, each with `integrity` and `crossorigin="anonymous"`, its CSP's
    `script-src`, `style-src` and `font-src` name that folder, and nothing loads from jsDelivr outside the block; with a
    release, every pinned address and integrity is `release.json`'s. Before the first release only the page's shape is
    checked (kit-cli's template passes today, with its placeholder integrity).
  - `release-check` (`scripts/ci/check_release.py`) also requires every dependency of a workspace on another workspace,
    `cdn/engine/release.json` and the kit's pinned folder at the tag's version, and the description's pinned addresses
    (and every `sha384-` value it names) to be `release.json`'s.
  - `release-cdn` (`npm run release:cdn -- --check`, after `vite-build`): `cdn/engine/` is byte for byte the release
    folder of the fresh engine build; it writes `reports/release/engine-addresses.md` for the job summary.
  - `release-pack`: `npm pack --workspace create-historic-city` into `reports/release/` (nothing is published).
  - The `release` stage is now `release-check`, `kit-pins`, `vite-build`, `release-cdn`, `bundle-budget`, `notices`,
    `release-pack`; `static` gains `kit-pins` (69 gates in all). The shared readers are `scripts/ci/release_pins.py`.
- **59b APPLIED (configurations of the pre-approved kinds).**
  - Stricter: `vitest.config.ts` (the `tools` project's coverage scope gains `scripts/release/src/**/*.ts`, so the
    release scripts are held to 90 % per file); `eslint.config.js` (`scripts/release` joins `PRODUCT` and its limits);
    `knip.json` (the root workspace's `project` gains `scripts/release/**/*.ts`); `npm run lint:deps` (over
    `scripts/release` too); `sonar-project.properties` (`scripts/release/src` a source, `scripts/release/test` tests,
    their two tsconfig projects); the root `tsconfig.json` references both projects.
  - Keeping two tools working (measured on a scratch copy of the folder, never in the tree): ESLint reports 7,716
    errors on the minified engine and Prettier 5 unformatted files, so `eslint.config.js` ignores `cdn/engine/**` and
    `.prettierignore` lists `cdn/engine/`, each with its why-comment. The engine's sources stay linted in `packages/`.
- **59c PROPOSED, NOT APPLIED (a relaxation, ask first): EditorConfig on the committed engine.** Measured on the
  release folder `npm run release:cdn` writes from the current build: `cdn/engine/engine.iife.js: line 58: trailing
  whitespace` and `cdn/engine/engine.mjs: line 114: trailing whitespace`. Both are lit-html's
  `` `[ \t\n\f\r]` `` written by the minifier as a template literal whose `\n` became a real line break, so the line
  ends with a space and a tab that belong to the string: stripping them would change lit-html's whitespace pattern, and
  Rolldown's minifier has no option to keep the escape. (The other finding, `engine.css` without a final newline, the
  transform already fixes: every text file of the release ends in a newline.) The narrowest exception, verified on the
  scratch copy (`[editorconfig] OK: 13 files follow .editorconfig`), appended to `.editorconfig`:

  ```ini
  # The released engine (cdn/engine/, docs/research/M5-interfaces.md §2.3): minified third-party code committed byte for
  # byte as jsDelivr serves it, where a template literal of lit-html holds a space and a tab before a line break.
  [cdn/engine/*.{js,mjs}]
  trim_trailing_whitespace = false
  ```

  Alternatives: excluding `cdn` from `cirepo.EXCLUDED_DIRS` (it would also hide the folder from the suppression scan,
  `data-files` and `repo-policy`, which pass on it as it is), or not committing the engine (the npm route of §58g). Without
  one of them the release commit's `static` stage fails on `editorconfig`, so the answer is needed before v1.0.0.
  Verify: `PIPELINE_STAGE=static bash scripts/ci/run-all-checks.sh` on the release commit.
- **59d APPLIED: `release.yml` shows the pinned addresses and their integrity.** The `build` job gains one step after the
  release stage, `cat reports/release/engine-addresses.md >>"$GITHUB_STEP_SUMMARY"` (the `release-cdn` gate wrote it
  from `cdn/engine/release.json`: the table of the four pinned addresses with their SHA-384, the `release.json` and `@1`
  addresses, the tags to paste), and its header comment names the new gates. It runs no repository code, needs no
  permission and publishes nothing the tag does not already hold; the stricter checks themselves come from the `release`
  stage (59a). Checked: `actionlint`, `workflow-schema`, `workflow-timeouts`, `workflow-policy`, `action-pins`, yamllint
  and Prettier on the workflow. The artifact upload and the `publish` job are unchanged (§58c stays a proposal).
- **59e Recorded: the rest of the measurement of §2.3.** On the same scratch copy, the suppression scan, gitleaks with
  `.gitleaks.toml` and with `.gitleaks-history.toml` (which has no path allowlist), `data-files`, `repo-policy` (no banned
  account, no secret file) and markdownlint (`fonts/LICENSES.md` is byte for byte `packages/ui/fonts/LICENSES.md`) pass;
  `repo-budget` stays far inside its 60 MB (16.7 MB without `seed/` today, plus about 1.04 MB). No other static gate
  reads the folder (`knip`, `dependency-cruiser`, stylelint, the i18n and scenario checks, Sonar's sources).
- **59f Recorded: what the release scripts decided (`scripts/release/`, `npm run release:{bump,cdn,pin-kit,notes}`).**
  - The bump rewrites the lockfile's workspace entries itself (versions only, four-space JSON as npm writes it), so no
    `npm install` and no download is needed; it also rewrites `functions/deploy-lock/` (`package.json` and its lock),
    whose version `functions/build.mjs` compares with the functions'. A Vitest test runs the bump over the real tree
    read-only and requires no change: every version is aligned today and every file round-trips byte for byte.
  - The release folder keeps every built file but the maps, removes the last source-map line, ends every text file
    with a newline, lists the files in code-point order (no locale in the bytes), takes Mapbox GL JS's integrity from the
    installed npm release and refuses another installed version.
  - The kit is pinned through `fillKitPage` (kit-cli's `packages/shared/src/kit/page.ts`), which rewrites the engine
    block and the CSP; the template's Mapbox GL JS tags must already be the release's, or the pinning stops.
  - The description's block lies between `<!-- hcm:sri -->` and `<!-- /hcm:sri -->` (plain HTML comments, invisible on
    GitHub); `check_release.py` compares its table rows and every `sha384-` value with `release.json`.
  - The About dialog's spec (`e2e/specs/viewer/about.spec.ts`, S-V13-HAPPY) read `'0.0.0'`; it now reads the root
    `package.json`'s version, so the bump changes no test.
- **59g Recorded: v1.0.0 prepared, not tagged.** `docs/releases/v1.0.0.md` and `docs/releases/v1.0.0_github_description.md`
  are written (between the description's markers a sentence says the block comes with `cdn/engine/`), and `docs/ENGINE_API.md` → *Versioning and compatibility* says
  what a release holds and how a page pins it. `python3 scripts/ci/check_release.py --tag v1.0.0` lists what remains,
  the integrator's last steps of M5 (§2.6): `npm run release:bump -- 1.0.0`; `npm run build --workspace @hcm/engine &&
  npm run release:cdn`; `npm run release:pin-kit`; `npm run release:notes -- --write
  docs/releases/v1.0.0_github_description.md`; the notes re-read against what M5 shipped; `all` split with the NUC.
- **59h For the user, ask first, one at a time (after 59c is answered and `all` is green on the release commit):**
  1. the jsDelivr probe of §58g (open its address once in a browser), since the pinned addresses depend on it;
  2. `git push origin feat/engine-rewrite`
  3. `gh pr create --base master --head feat/engine-rewrite --title "feat: M5 multi-city and engine v1.0.0"`, its
     review, then the merge;
  4. on the merged `master` commit, once `all` is green there: `git tag -a v1.0.0 -m "v1.0.0"`;
  5. `git push origin v1.0.0` (CI's `release.yml` then checks, rebuilds and publishes the GitHub Release);
  6. then the template repository (§58e) and the npm publish (§58f).

- **59i Recorded: the SonarQube gate of the tagged commit stays in §58c's proposal.** Reusing `ci.yml`'s pinned scan and
  quality-gate actions in `release.yml` needs the commit's coverage reports there: either the whole `tests` stage again
  on the tag (about 20 minutes more) or the CI run's `coverage` artifact (a cross-workflow download with `actions: read`
  and the run's id). Neither is a stricter check of what the release job already has, so it waits with the publishing
  additions; the lighter design for the user's yes is a step that asks SonarCloud's API for the quality gate of the
  `master` analysis whose revision is the tagged commit (`api/project_analyses/search`, then
  `api/qualitygates/project_status`), with `SONAR_TOKEN` passed by name.

- **59j PROPOSED, NOT APPLIED (ask first: it publishes more): the exact lines of §58c's publishing additions.** The
  `build` job uploads `cdn/engine/release.json` and the CLI's package with the release files; the `publish` job (still
  no checkout, no repository code) names the release file `engine-release.json`, attaches it and the package beside the
  bundles (the engine's source maps already are), then asks jsDelivr to refresh the major alias, best effort. Checked on
  a scratch copy of the workflow: `actionlint`, the GitHub workflow schema, `workflow-policy`, yamllint and Prettier pass.

  ```diff
  --- a/.github/workflows/release.yml
  +++ b/.github/workflows/release.yml
  @@ -59,6 +59,8 @@ jobs:
                         packages/engine/dist/
                         packages/admin/dist/
                         docs/releases/
  +                      cdn/engine/release.json
  +                      reports/release/create-historic-city-*.tgz
                     if-no-files-found: error
                     retention-days: 7

  @@ -86,6 +88,10 @@ jobs:
                     title="$(sed -n 's/^# //p' "release/docs/releases/${TAG}_github_description.md" | head -n 1)"
                     echo "title=${title:-$TAG}" >>"$GITHUB_OUTPUT"

  +            # The engine's release file under a name that says what it is, beside the bundles on the GitHub Release.
  +            - name: Name the engine's release file
  +              run: cp release/cdn/engine/release.json release/engine-release.json
  +
               - name: GitHub Release
                 uses: softprops/action-gh-release@efb35369e0ad2afab669f228072c1b0d510eae64 # v3.0.3
                 with:
  @@ -95,3 +101,20 @@ jobs:
                     files: |
                         release/packages/engine/dist/*
                         release/packages/admin/dist/*
  +                      release/engine-release.json
  +                      release/reports/release/create-historic-city-*.tgz
  +
  +            # jsDelivr keeps a tag's files for good, but caches what the floating major alias (@1) resolves to: ask it to
  +            # look again for each file of the release (best effort; the exact tag needs no purge).
  +            - name: Purge the major alias on jsDelivr
  +              continue-on-error: true
  +              env:
  +                  TAG: ${{ github.ref_name }}
  +                  REPOSITORY: ${{ github.repository }}
  +              run: |
  +                  major="${TAG#v}"
  +                  major="${major%%.*}"
  +                  jq -r '.files[].path' release/engine-release.json | while read -r file; do
  +                      curl -fsS --max-time 30 "https://purge.jsdelivr.net/gh/${REPOSITORY}@${major}/cdn/engine/${file}" >/dev/null ||
  +                          echo "::warning title=jsDelivr purge::${file} was not purged"
  +                  done
  ```

Verify: `PIPELINE_STAGE=static bash scripts/ci/run-all-checks.sh` (the four audit gates stay red on §48a and §49i);
the `tools` Vitest project (`scripts/release/test`, 100 % lines and branches per file) and `pytest`
(`test_check_kit_pins.py`, `test_check_release.py`, 100 % per file).

## 60. The M5 export workstream: the static export of a city (2026-10-25) — 60a–60e APPLIED (product, test and documentation changes within the contract, its change requests CR-M5-9, CR-M5-10 and CR-M5-15 to CR-M5-18; 60e a new lazy chunk with its own budget, the pre-approved kind; no gate relaxed, no budget raised, no checker allowlist entry); 60f recorded for the user; 60g waits on multi-city (CR-M5-8, CR-M5-11)

The export workstream built behaviour A53 (a city owner exports the city from Settings) and V28 (the viewer boots from
the export) as `docs/research/M5-interfaces.md` §5 says. Nothing was downloaded, committed, pushed or deployed, and no
real Google, Mapbox, USGS, STAC, Nominatim, Vertex AI or OpenStreetMap endpoint was called: the functions run against
the fakes and the Storage emulator, the admin against the emulators, the V28 page against the mock APIs.

- **60a APPLIED: the server side** (`functions/src/export/`, deployed as `export-start`, `export-download`,
  `export-build`; the group is exported as `export { exportGroup as export }` since `export` is a reserved word).
  `export.start` (a city's owners: the registry's `cityOwner`) refuses a city never published, a red guard, an export
  under way and the day's exports used up (the city's `limits.exportsPerDay`, else three), records the export and queues
  its task. The export id is `x-<YYYYMMDD>-<n>`, the day's `n`-th, so two owners racing compute the same id and the second
  create is `apiError.export.busy`; the task id is `<city>--<export>` (CR-M5-17). `export.build` (`fn-events@`, one
  attempt, two at a time, 1 GiB, 30 minutes) reads the published manifest from the public bucket, plans the files, sums
  their sizes first and streams the zip into `exports/<city>/<export>.zip` through a writer of its own over Node's `zlib`
  (data descriptors, DEFLATE for text, STORE for WebP, GeoTIFF and WOFF2, entries in name order, the export's day as their
  time, no ZIP64), counting and hashing as it streams; anything that fails leaves `failed` with its code and the
  message's parameters (`errorParams`, a schema field the export owns) and no object. `export.download` answers a V4
  signed address of fifteen minutes with the file name as its disposition; the address is never logged. `ops.tick`'s
  new step `exports` expires ready exports past their seven days (deleting the zip) and fails one stuck queued or
  building 40 minutes after it began, which `export.start` no longer counts as busy (CR-M5-17).
- **60b APPLIED: what travels** (§5.1, §5.2). The zip holds the starter kit's page filled by `fillKitPage` (the city's
  name and colour, Romanian first, the engine from `engine/`, a CSP that names only the outside origins the manifest still
  points at), `city.json` (the photos' files beside it, `analytics` empty: no GA4 or Firebase id and no crash endpoint,
  the viewer token kept), a README in both languages before the kit's own, `RIGHTS.md` naming the photos licensed for this
  map only, the engine (`engine.iife.js`, `engine.css`, `fonts/`, `THIRD_PARTY_NOTICES.txt`, copied into
  `functions/dist/export-kit/` by `functions/build.mjs` with `kit.json`, CR-M5-9) and, when asked, the COG of each USGS
  layer's current version. Only what the city publishes travels: a photo without a licence or not published is not in
  the manifest, so its files are never read (row `S-A53-BAD-UNLICENSED`, added). The photos licensed for this map only
  travel and are named (§58g, the contract's default, stays the user's decision).
- **60c APPLIED: the card** (Settings → Export the city, CR-M5-10): the intro, Include the USGS scans with their size
  (only when the city has USGS scans), Export; the latest export live (waiting, being prepared, ready with its size,
  counts, SHA-256 and expiry, failed with its reason, expired), Download, which saves the signed address through a link
  the page follows once and drops; an editor sees it read-only, a city never published says to publish it first. A ready
  export whose time is up reads expired before the tick marks it. Inputs: `exportCity` 2, `exportWithRasters` 3.
- **60d APPLIED: the tests.** Functions (fakes and the Storage emulator): `functions/test/export/*` and the adapters'
  (`url-signer`, `storage-writer`, `export-kit`), `functions/test/ops/exports.test.ts`; rows `S-A53-HAPPY-RASTERS`,
  `-HAPPY-RIGHTS`, `-BAD-TOO-LARGE`, `-BAD-EDITOR`, `-BAD-DAILY-LIMIT`, `-BAD-UNLICENSED`. Admin (`e2e/admin/specs/export/`,
  content worlds): `S-A53-HAPPY` (two inputs, the downloaded zip is the object the task wrote, unpacked by
  `e2e/support/unzip.ts`), `-BAD-BUSY`, `-BAD-EXPIRED`, `-BAD-NEVER-PUBLISHED`, and the tour states `export.card`,
  `export.building`, `export.ready`, `export.failed`, `export.expired`, `export.readonly`. Starter kit
  (`e2e/specs/starter-kit/export.spec.ts`): `S-V28-HAPPY`, `-HAPPY-CONSENT-SENDS-NOTHING` (a city published with a GA4 id
  exports none: no banner asks, nothing loads), `-BAD-FILE-URL`. V28 builds its own export with the export's planner and
  writer over the fixture city (CR-M5-18): the starter-kit tier runs without the emulators, and on the other machine in a
  split run. `e2e/tour/states.ts` had reached its 600-line limit: the M4 and M5 sections moved to
  `e2e/tour/admin-sections.ts` (CR-M5-15).
- **60e APPLIED (a new chunk with its own budget, the pre-approved kind): the card is the lazy chunk `export-card`**
  (`packages/ui/src/admin/export/export-card.ts`, fetched the first time the section opens; `lazy-card.ts` shows Loading,
  or the failure with Try again). `ADMIN_CHUNK_BUDGETS` gains `export-card` 2 KB (1.7 KB measured by the gate on
  2026-10-25 plus about 20 %). Measured with it: `editor-shared` 12.8 KB of 13 (the order card's `chunkLoader`, which the
  export card reuses, is now shared by two areas), `settings` 19.5 KB of 20 with both M5 sections' stores and chunk loaders (18.6 KB with the export's alone): the
  next Settings section needs a chunk of its own.
  No budget was raised; `PIPELINE_STAGE=build` passes.
- **60f recorded for the user: the signing permission and the lifecycle rule are provisioner items** (CR-M5-8, the
  multi-city workstream's provisioner): until Provision runs again with them, `export.download` fails on the real
  project (V4 signing needs `roles/iam.serviceAccountTokenCreator` of `fn-admin@` on itself; **UNVERIFIED** until then),
  and exports past seven days are removed by the tick only.
- **60g waits on multi-city:** the Firestore match `cities/{city}/exports/{id}` (read by the city's members, no client
  write; CR-M5-11) and its rules row `S-A53-BAD-CLIENT-EXPORTS` (planned); without the match the card's listener is
  refused and `e2e/admin/specs/export/export.spec.ts` cannot pass.

Verify: `PIPELINE_STAGE=static bash scripts/ci/run-all-checks.sh` (the four audit gates stay red on §48a and §49i);
the functions, admin and ui Vitest projects for the files above (100 % lines per file but `build.ts`, `start.ts` and
`zip.ts`, each above 98 %); `E2E_TIER=fn npx playwright test specs/starter-kit/export.spec.ts`; the admin tier's
`specs/export/export.spec.ts` once CR-M5-11 is in.

## 61. The M5 kit-cli workstream: the starter kit's template, `create-historic-city` and the kit's e2e (2026-10-25) — 61a–61c APPLIED (product, test and documentation changes within the contract; configuration edits that make a gate stricter or keep a tool working, the pre-approved kinds; no gate relaxed, no checker allowlist entry); 61d PROPOSED, NOT APPLIED (the lockfile's workspace link and the quality image's manifest line: rebuilding the image downloads); 61e–61g recorded for the user

The kit-cli workstream of `docs/research/M5-interfaces.md` (§3, §4, §6.1) built the shared kit helpers, the starter
kit's template, the `create-historic-city` CLI and behaviours V27 and V29 with the kit's tour state. Nothing was
committed, pushed, tagged, published or deployed, nothing was downloaded, and no request left the machine: the CLI's
tests run over fakes of its ports, its e2e rows run the built CLI with fake `firebase`, `gcloud` and `xdg-open` as the
only commands on its `PATH`, and the kit's page boots against the mock CDN and the mock Mapbox.

- **61a APPLIED: what landed.**
  - `packages/shared/src/kit/csp.ts` (the one CSP table of every engine page: the site's policy unchanged with the
    engine at `'self'`, the kit's with the pinned jsDelivr folder in `script-src`, `style-src` and `font-src`) and
    `packages/shared/src/kit/page.ts` (`fillKitPage`, `readKitEngine`, `kitContentSecurityPolicy`, `kitResult`,
    `isUnpinned`), exported from `@hcm/shared` (one export line in its index and a `KIT_EXPORTS` list in the exports
    fixture: CR-M5-19).
  - `templates/starter-kit/` (`index.html` committed Prettier-clean and a fixed point of `fillKitPage`, `city.json`, a
    Romanian and English `README.md`); `engine.css` gains `.hcm-fullpage` and `.hcm-note` (CR-M5-5, done); the M1 kit's
    README points to the template.
  - `packages/create-historic-city/` (the scaffold, `self-host`, `deploy`, `upgrade`, `doctor`, `--dry-run`, its own
    Romanian and English catalogue, the ports and their Node implementations, the self-host bundle's builder, 100 %
    lines per file and at least 96 % branches).
  - The e2e: the site server's `/kit/` route, the mock CDN's release folder (`@v<version>` and `@1`, from `cdn/engine/`
    once a release made it, else `packages/engine/dist`), the mock Mapbox's 401 for the template's placeholder token,
    `e2e/support/kit.ts`, `e2e/support/cli.ts`, `e2e/specs/starter-kit/{template,create-city}.spec.ts` (rows V27 and
    V29, now `exists`) and the tour state `kit.loading-note` (`e2e/tour/kit-states.ts`, its journey in
    `e2e/tour/viewer.tour.ts`, so it runs at every tour project).
  - Docs: `docs/SELF_HOST.md` (Romanian and English), `docs/ENGINE_API.md` → *The starter kit*, `docs/SETUP.md` → *The
    starter kit and create-historic-city*, `README.md`.
- **61b APPLIED (the pre-approved kinds): configuration edits.**
  - `vitest.config.ts`: the `create-historic-city` project (Node; the colour library inlined by Vite, as its ES modules
    import without file extensions, which Node refuses) and its coverage scope; `sonar-project.properties`: its `src`
    as sources, its `test` as tests (stricter).
  - `.dependency-cruiser.cjs`: the new rule `create-historic-city-bundles-only-what-it-needs` (the CLI's source imports
    Node's built-ins, `@hcm/shared` and `@hcm/ui/dynamic-color` only; stricter). The workspace links `@hcm/shared` and
    `@hcm/ui` are the CLI's `devDependencies` (its build bundles them, so the published package has no `dependencies`):
    dependency-cruiser resolves them to the packages' own sources, so `src-not-to-dev-dependencies` is untouched.
  - `knip.json`: the CLI's entries (`cli.ts`, `build-self-host.ts`, its tests); `tsconfig.json` and `e2e/tsconfig.json`:
    the CLI's projects as references (keeps `tsc -b` and the e2e's import of the CLI's catalogue working).
  - `scripts/ci/check_agent_assets.py`: `templates/` joins `PATH_ROOTS` (stricter); `scripts/ci/check_notices.py`: the
    CLI's `dist` joins `BUILDS` (stricter; its tests gained the CLI's build); `scripts/ci/e2e_build.py`: the CLI's `dist`
    joins `OUTPUTS` (the stamp sees a rebuilt CLI).
  - The root `package.json`: `build:self-host`, and the CLI's build in `build:site:e2e` (the V29 rows run `cli.mjs`).
- **61c APPLIED: what the workstream decided within the contract** (each in CR-M5-19 to CR-M5-21).
  - `fillKitPage`'s text values are optional (a slot left out keeps the template's value, but every slot must still be
    there once): the release's pinning passes the engine alone. The `lang` value sets the viewer element's `lang` with
    `<html lang>`. `kitResult` turns a `KitPageError` into a value, so the CLI names a page an owner broke instead of
    failing.
  - Until a release pins it, the template's engine block names `@v1.0.0` with the integrity `sha384-` and 64 zeros
    (`KIT_UNPINNED_INTEGRITY`, valid in form, the digest of no file); `upgrade` and `doctor` treat it as "no release
    yet", and the e2e serves the page with the digests of what the mock CDN serves, said in the annotation `kit-pins`.
  - The CLI: the deploy files go to `server/` inside the city folder (added to its `.gitignore`: they are no part of the
    site); `--bundle` deploys another self-host bundle, `--viewer-origin` names the city's public site for the
    functions (default the project's `web.app`), `--billing-wait` bounds step 8's wait (default 20 minutes, 0 checks
    once more); when billing is not linked, step 8 opens the billing page and waits for Enter before it polls, so the
    owner's own link needs no clock; step 1 (the versions) runs without a question, as it changes nothing; a new city's
    example places move with its rectangle, so the scaffolded `city.json` still validates and still shows them.
- **61d PROPOSED, NOT APPLIED: the lockfile's workspace link and the quality image's manifest line.** A workspace needs
  its link in `package-lock.json` (made offline in the pinned Node image, no network: `npm install --package-lock-only
  --offline --ignore-scripts` in a scratch copy of the manifests) and its `package.json` in the image's `manifests` stage:

  ```text
  package-lock.json, beside the other node_modules/<workspace> links:
      "node_modules/create-historic-city": { "resolved": "packages/create-historic-city", "link": true },
  and beside the other packages/<workspace> entries:
      "packages/create-historic-city": { "version": "0.0.0", "license": "UNLICENSED",
          "bin": { "create-historic-city": "dist/cli.mjs" },
          "devDependencies": { "@hcm/shared": "0.0.0", "@hcm/ui": "0.0.0" },
          "engines": { "node": ">=24.12.0" } },
  docker/Dockerfile.quality, stage manifests, after packages/admin:
      COPY packages/create-historic-city/package.json packages/create-historic-city/
  ```

  Not applied tonight: a changed lockfile rebuilds the quality image's npm layer at the next `run-all-checks.sh` (every
  npm package from the registry, the Playwright browsers and the Firebase emulator JARs: downloads), and the pipeline's
  `npm ci` would replace the shared `node_modules` under the other workstreams' running checks. Until it lands, every
  gate passes (nothing runs `npm ci` while the lockfile is unchanged), but a fresh `npm ci` (CI, a new clone, a lockfile
  change) stops with `Missing: create-historic-city@0.0.0 from lock file`: the release's bump (CR-M5-12, which rewrites
  the lockfile's workspace versions) must add these lines in the same change, at the release's version (CR-M5-20).
  Verify: `npm ci --dry-run --offline` in the pinned Node image, then `PIPELINE_STAGE=static`.
- **61e For the user: the licence of `create-historic-city` and of the template.** Both say `UNLICENSED`, like every
  package of the repository. A CLI that others run with `npx`, and a template they copy, usually carry a licence (MIT
  is common); choosing one is the user's decision before `npm publish` (§58f) and the template repository (§58e).
- **61f Recorded: what only a real run proves (also in `docs/research/M5-interfaces.md` §10).** The JSON the Firebase CLI
  15.33.0 prints for `login:list`, `projects:list`, `apps:list WEB` and `hosting:sites:list` (the CLI reads `result`, an
  account's presence, a project's `projectNumber`, a web app's presence, a site whose `name` ends with
  `/sites/<project>`; a listing it cannot read counts as "not there", so the step offers to create it and the owner's
  tool says what is wrong); `firebase projects:create` failing until Google's terms are accepted (the CLI opens the
  console and tries once more). A self-hosted admin's provisioner needs CR-M5-7 (`project.json` without `github`) before
  its Provision step works; the functions of a self-hosted project run without `HCM_OAUTH_CLIENT_IDS` (the claim's
  fallback of `functions/src/admin/claim.ts`).
- **61g Recorded: sizes.** `cli.mjs` is about 550 KB (zod, `@hcm/shared` and the colour library bundled; its source map
  stays out of the npm package's `files`); the template's page is 4 KB, its `city.json` 18 KB (the theme's four token
  sets).

Verify: `PIPELINE_STAGE=static bash scripts/ci/run-all-checks.sh` (the four audit gates stay red on §48a and §49i), the
`create-historic-city` and `shared` Vitest projects, `E2E_TIER=fn npx playwright test specs/starter-kit/template.spec.ts
specs/starter-kit/create-city.spec.ts --project=fn-l1440-ro`, and the tour's kit state
(`E2E_TIER=tour npx playwright test tour/viewer.tour.ts -g "starter kit"`).

## 62. The M5 multi-city workstream: memberships, rules isolation, the switcher, New city, per-city admins and budgets, the Pages tree (2026-10-25) — 62a–62f APPLIED (product, test and documentation changes within the contract and its change requests CR-M5-2 to CR-M5-4, CR-M5-6, CR-M5-8, CR-M5-11, CR-M5-22 to CR-M5-24; 62c new lazy chunks with their own budgets and 62d configuration edits that make a gate stricter or keep a tool working, the pre-approved kinds; no gate relaxed, no budget raised, no checker allowlist entry); 62g PROPOSED, NOT APPLIED (a workflow line, ask first); 62h recorded for the user

The multi-city workstream of `docs/research/M5-interfaces.md` (§1, §6.1, §7, §8) made the map one of many cities. Nothing
was committed, pushed, tagged, deployed or downloaded, and no request left the machine: the functions ran against the
Firebase emulators (`demo-hcm`), the rules against the Firestore and Storage emulators, the admin and the viewer against
the e2e mock servers.

- **62a APPLIED: memberships and access** (§1.2, §1.3; CR-M5-2, CR-M5-4).
  - `admins/{uid}.cities` names each city and the role in it (`owner` or `editor`); the project's owner is the admin
    whose `role` is `owner`. A document from before M5 gets every existing city at its first `admin.session` (the
    project's owner as owner, every other admin as editor) or at `ops.tick`'s new `memberships` step; until then the
    rules and the callables treat it as no membership (fail closed). `admin.session` also accepts an invitation to more
    cities for an admin who already joined (no second "Join"), lists a member's city by its id while the city has no
    document (the bundled city before Setup writes it, so its owner can still invite), and answers `projectOwner`.
  - `CallableAccess` gains `cityEditor`, `cityOwner` and `projectOwner`; every city callable checks the role in the
    request's `cityId` after the request is validated and before any read (`requireCityRole`). `AdminDirectory.membership`
    replaces the contract's two lookups (one read).
  - New callables: `cities.create`, `cities.setLimits` (`fn-cities`), `admins.setRole`; `admins.invite`, `.revoke` and
    `.list` work on one city (an admin removed from their last city stops being an admin; the project's owner keeps
    their document; a city keeps at least one owner: `apiError.city.lastOwner` on a demotion).
  - `notify.onEvent` fans a city's events out to that city's members only, with a link into the city.
- **62b APPLIED: every city closed to the others** (§1.4; CR-M5-3, CR-M5-11).
  - `firebase/firestore.rules`: a city's subtree, its manifest state, its harvest state, its usage and exports are its
    members' only; History's collection-group list is allowed only with `where('cityId', '==', <a city of the admin>)`
    (proved on the emulator); `admins/*` is its own reader's or the project owner's; invitations the project owner's;
    the ops documents are read by name only (no list). `firebase/storage.rules`: a city's originals, uploads, photos,
    rasters, work and reference files are its members'; the USGS browse copies any admin's (shared by every city);
    everything else server-only (the catch-all read is gone). The allow/deny matrix tests a member of city A against
    city B (`firebase/rules-tests/test/{cities,identity,storage,matrix}.test.ts`), and the rule coverage gate holds.
  - The e2e worlds seed memberships: the personas are members of the bundled city, each content world's account the
    owner of its own city.
- **62c APPLIED (the pre-approved kind): two new lazy chunks with their budgets.** `cities` (the New city page: its store,
  its map and `<hcm-new-city-page>`, 4.6 KB measured) gets 6 KB and `city-budget` (Settings → the city's budget, 1.0 KB)
  2 KB, the measurement plus about 20 % (`scripts/ci/check_bundle_budget.py`). The admin in all now measures 619.6 KB of
  its 620 KB (the build stage of 2026-10-25, with the other M5 workstreams' chunks) and `settings` 19.5 KB of 20 KB: the
  next workstream that adds to the admin needs a reviewed raise.
- **62d APPLIED (the pre-approved kinds): configuration edits.** `.dependency-cruiser.cjs`'s
  `functions-feature-folders-independent` gains `cities` (stricter); `scripts/site/tsconfig.json` includes the new entry
  `add-site.ts` (keeps `tsc -b` and ESLint working); `eslint.config.js`'s block for a city's `config.js` (a classic
  script with the browser's globals) names the e2e fixture cities' too (`e2e/fixtures/sites/*/config.js`, keeps ESLint
  working); the root `package.json` gains `site:add`, and `build:site` assembles the Pages tree (`--pages dist/pages`).
- **62e APPLIED: what the workstream decided within the contract** (each in CR-M5-22 to CR-M5-24).
  - The city switcher (§1.5): the top bar's button from the medium window class, the account menu's list on a phone,
    shown to an admin of two cities or more, or to the project's owner (New city). Switching is a page load into
    `#/c/<city>/home`, remembered per account in `localStorage` (`hcm:admin:city:<uid>`); an unsaved edit is asked about
    first, and once the admin discards it nothing holds the page load back (the navigation guard and `beforeunload`
    ask the app, which stops counting a discarded edit while another city opens).
  - New city (§1.6): the rectangle is dragged on the map itself (a capture-phase gesture on the element Mapbox draws
    into, so nothing covers the map or its zoom buttons and the admin's CSP needs no inline style), or clicked corner to
    corner, or typed edge by edge. `cities.create` writes the new city's harvest state due at once: the contract's "a
    city without a harvest state is due" would undo CR-M3-44 (the e2e content worlds' cities would all be harvested), so
    only a created city is harvested by the next tick. The viewer's token is minted by the flow's follow-up
    `setup.rotatePublicToken` (best effort: a project without Mapbox yet answers 400 and Setup's Mapbox card mints it);
    the project's analytics ids are copied from another city.
  - Per-city budgets (§1.8): a city's compute units count its publishes under way as reserved until the month ends (a
    failed publish keeps its share until then: conservative, never over); a city without `limits` (Bucharest) is held
    by the project's caps only; the approval card's `city-over` offers Studio or next month, never paying (paying the
    project's overage would not raise the city's share).
  - The admins page shows each admin's role in the city; its owners change roles after a question and invite with a
    role (editor unless changed); oneself is never removable (the project's owner: the map always keeps its owner).
- **62f APPLIED: the GitHub Pages layout** (§1.10; CR-M5-6). `site.json` gains `pagesPath` (`""` for Bucharest at the
  root, so the old links keep working); a city without a seed manifest reads the public bucket only and is built only
  when the build names it; `npm run build:site` assembles `dist/pages` (two sites on one path, or a city folder the root
  site uses, refuse the tree); `npm run site:add -- --city <id> --name-ro <name> --theme <#rrggbb>` writes `sites/<id>/`
  (a repository step: the admin holds no GitHub credential). `scripts/site/src/csp.ts` re-exports the shared table of
  `packages/shared/src/kit/csp.ts`. The e2e build assembles the same tree under `dist/e2e-site/pages/` with the fixture
  cities of `e2e/fixtures/sites/` (never `sites/`, which a production build would publish).
- **62g PROPOSED, NOT APPLIED (a workflow edit, ask first): the Pages deploy uploads the tree.** In
  `.github/workflows/ci.yml`, the step "Upload the GitHub Pages artifact" changes `path: dist/site/bucharest` to
  `path: dist/pages` (and its comment to "Every city's site, built and assembled by the site-build gate"). Until a second
  city's site is committed both trees serve the same files.
- **62h recorded for the user.** CR-M5-7 (a `project.json` without `github`: the provisioner without the Workload
  Identity pool and `gh-deployer`) is not applied: it changes the Setup's repository variables and the provisioner's
  service accounts, bindings and items, and no M5 flow needs it yet (`create-historic-city` deploys from the owner's
  terminal). Deploying the new functions (`cities-create`, `cities-setLimits`, `admins-setRole`) and the rules is the
  user's (ask first). The integrator's lessons for `docs/LESSONS.md` are in CR-M5-24.

Verify: `PIPELINE_STAGE=static bash scripts/ci/run-all-checks.sh` (the four audit gates stay red on §48a and §49i),
`PIPELINE_STAGE=tests bash scripts/ci/run-all-checks.sh`, and the admin and viewer rows
(`E2E_TIER=admin npx playwright test admin/specs/cities/ --project=admin-l1440-ro`,
`E2E_TIER=fn npx playwright test specs/viewer/multi-city.spec.ts --project=fn-l1440-ro`).

## 63. The M5 integrator: the change requests closed, Settings → Publishing, the image blind to versions, the cross-app journey, v1.0.0's versions, and what waits for the user (2026-10-25) — 63a–63f APPLIED (product, test, tooling and documentation changes; 63b a Dockerfile edit that keeps the quality image's npm layer cached, the "keeps a tool working" kind; no gate relaxed, no budget raised, no checker allowlist entry); 63g recorded (downloads on the NUC; since §64 the NUC's image is current); 63h–63i for the user, ask first; 63j APPLIED (the integrator's second run: the visual audit's fixes, the review screenshots and every stage green, the split `quality` included)

The release workstream's integrator role (`docs/research/M5-interfaces.md` §6.3 step 4), after the other three
workstreams reported. Nothing was committed, pushed, tagged, published or deployed; no request went to a real Google,
Mapbox, USGS, STAC, Nominatim, Vertex AI, OpenStreetMap, npm or jsDelivr endpoint from a test; the targeted runs ran in
the quality image with `--network=none`. One split run started rebuilding the NUC's image (63g).

- **63a APPLIED: Settings → Publishing (a gap between the contract and the screens).** New city makes a city
  unpublished (§58a, §1.6) and its done screen says "publish it from Settings when it is ready", but no screen wrote
  `cities/{city}.published` (`CLIENT_WRITES.city.update` and the rules allowed it): a city made in the admin could never
  get a public manifest, so never a public site nor an export (`apiError.export.noManifest`). The integrator's cross-app
  journey found it. Settings gains the city section `publish` (`packages/admin/src/settings/city-sections.ts`,
  `packages/ui/src/admin/settings/publish-section.ts`): one switch, **The city is public**, what switching it does, and
  the section's Save, with the draft, the conflict banner and the read-only state every city section has; the input
  budget `publishCity` (2: the switch, Save); the tour state `cities.publish`; five texts in both languages. Who may
  switch it: a member of the city, as the rules already allow for the city's settings (63i asks whether owners only).
  Measured by the `build` stage: `settings` 19.6 KB of its 20 KB, the admin in all 619.9 KB of its 620 KB (no budget
  raised; the next addition to the admin needs one, 63i).
- **63b APPLIED (keeps a tool working): the quality image's npm layer ignores the workspaces' own versions and a
  workspace without registry dependencies (CR-M5-20).** A changed lockfile or workspace version re-ran the image's npm
  layer (`npm ci` from the registry, the Playwright browsers, the Firebase emulator JARs: downloads), so the CLI's
  lockfile entries (§61d) and the release's bump could not land. The `manifests` stage of `docker/Dockerfile.quality`
  now also writes every workspace's `version`, and every dependency of a workspace on another, as `0.0.0`, and drops
  the lockfile's entries of a workspace it does not copy: `create-historic-city`, whose only dependencies are
  workspaces, needs no `COPY` line (the comment says when one does). Verified: `docker build --target manifests` gives
  `/m/` byte for byte equal to the files baked into the current image, before and after the bump; the full build then
  reports the npm layer `CACHED`; `npm ci --offline` with `--network=none` in the image installs the new lockfile in 7 s.
  The lockfile's two entries were generated offline (`npm install --package-lock-only --offline --ignore-scripts` in a
  scratch copy, pinned Node image, `--network=none`).
- **63c APPLIED: v1.0.0's versions (§2.6 step 1, first half).** `npm run release:bump -- 1.0.0` (offline, in the image)
  rewrote the ten `package.json`, every workspace dependency, the lockfile, `functions/deploy-lock/` and
  `ENGINE_VERSION`; the bump's read-only test over the real tree passes at 1.0.0. Not run: `release:cdn`,
  `release:pin-kit` and `release:notes`, because the committed `cdn/engine/` fails EditorConfig until §59c (CR-M5-14) is
  answered; the kit keeps its placeholder digests until then and `kit-pins` checks its shape only (63h, step 1).
- **63d APPLIED: the cross-app journey (behaviour A54).** `e2e/admin/specs/cities/city-journey.spec.ts`:
  `S-A54-HAPPY` (New city, Publishing, the server's manifest, the site `site:add` and `build:site` make for the city with
  the public bucket named, booted with one map; Export and Download, the zip booted on a plain static server with no
  Firebase, Google or jsDelivr request), `S-A54-BAD-UNPUBLISHED` (switched off, the manifest leaves the bucket and the
  site says `error.manifest.notFound`) and `S-A54-BAD-OTHER-CITY` (another city's owner, with their own ID token on the
  emulators' REST: 403 on the city's documents, its export's zip and an upload into it, `apiError.city.notMember` from
  `export.start`, `export.download` and `admins.invite`). Helpers: `e2e/support/city-site.ts` (the repository's own
  `addSite` and `buildSite` into `dist/e2e-city-sites/<test>/`, served at `/city-sites/`),
  `e2e/admin/specs/cities/journey-world.ts` (the public bucket answered from the Storage emulator, the outsider), and
  `unpackExport` in `e2e/support/export-site.ts`. Content specs: parallel, no lock; 16 of 16 at the five admin projects
  in 59 s.
- **63e APPLIED: the change requests left open.** CR-M5-11's rules row `S-A53-BAD-CLIENT-EXPORTS`
  (`firebase/rules-tests/test/cities.test.ts`: members read and list, nobody writes, another city's admin reads
  nothing); CR-M5-25 (`exports` in the reset's city-first prefixes, `e2e/admin/support/emulators.ts`); the per-file
  coverage of `functions/src/adapters/storage-writer.ts` (a source failing with something other than an Error, now
  tested: 100 % branches); CR-M5-20 (63b); CR-M5-24 (the lessons 220–233 of `docs/LESSONS.md`, the guides, ARCHITECTURE,
  TESTING, CI_PIPELINE, SETUP, MANUAL_TEST_PLAN, README, the skills and their mirrors, `M5-status.md`).
- **63f Recorded: CR-M5-7 stays accepted, not applied.** A `project.json` without `github` (what `create-historic-city
  self-host` writes) is refused by the admin's `parseProjectConfig`, and without a project file the admin's Setup is
  unavailable: a self-hosted admin cannot run its Setup Assistant at all yet (step 7 of `docs/SELF_HOST.md`).
  Applying it changes the provisioner's service accounts and IAM bindings (no `gh-deployer` and no Workload Identity
  pool without GitHub), the `workload-identity` item, the deploy card's repository variables and its texts (a deploy
  from the owner's terminal instead), and would need bytes the admin's budget no longer has (63a): a reviewed change of
  its own, with the work list in CR-M5-7.
- **63g Recorded: the NUC rebuilt the quality image from scratch, with downloads, and the run was stopped.** The first
  split `quality` run found the NUC's BuildKit cache evicted (the machine builds other projects; its cache records of
  this image were gone, though the tagged image remained): it pulled the pinned base images (Docker Hub, GHCR), the
  apt packages (Ubuntu's mirrors), the CI venv (PyPI) and `npm ci` (the npm registry), and was stopped while apt fetched
  the browsers' system libraries, before the Playwright browsers' CDN and before the emulator JARs (Google's storage);
  nothing it fetched reached the tree. Every later run used this machine only (`PIPELINE_STAGE=quality bash
  scripts/ci/run-all-checks.sh`, the split's own fallback). A split run needs that rebuild on the NUC once: ask first
  (63h).
- **63h For the user, ask first, one at a time** (exact commands in `docs/research/M5-status.md` §3):
  1. §59c / CR-M5-14: the `.editorconfig` exception for `cdn/engine/*.{js,mjs}`; then, in the image, `npm run build
     --workspace @hcm/engine && npm run release:cdn`, `npm run release:pin-kit`, `npm run release:notes -- --write
     docs/releases/v1.0.0_github_description.md`, `python3 scripts/ci/check_release.py --tag v1.0.0`;
  2. ~~the NUC's image rebuild (downloads) for the split runs~~: done by §64's approved run (the NUC's image of 09:10
     on 2026-10-25); the second run's split `quality` built there with every layer `CACHED` (63j);
  3. §62g / §58b: `ci.yml`'s Pages artifact `dist/pages`;
  4. §58g: the jsDelivr probe;
  5. the push of `feat/engine-rewrite`, the pull request, its review and the merge into `master` (the overwrite of the
     legacy site and the Pages go-live);
  6. `git tag -a v1.0.0 -m "v1.0.0"` on the merged commit and `git push origin v1.0.0`; then §59j's publishing lines;
  7. §58e: the template repository; §58f: `npm publish` of `create-historic-city` (after §61e's licence);
  8. the deploys: functions (67), Firestore and Storage rules and indexes, the admin's Hosting; then Provision again
     (CR-M5-8's lifecycle rule and signing binding).
- **63i For the user's decision.** Whether only a city's owners may publish it (today any member may, as for the city's
  settings: a rules change and the section's read-only state for editors); a raise of the admin's budget in all (620 KB,
  0.1 KB left) before the next admin feature; §58h, §61e and §61f stay open.

- **63j APPLIED: the integrator's second run (a tooling outage cut the first one after 63i).** The four audit gates pass
  since §64, so every gate of every stage is green (the verdicts below). The visual audit of the M5 review screenshots
  (`reports/screenshots/m5/`: the 19 admin states at 360 × 800, 768 × 1024, 1440 × 900 and 2560 × 1440, light and dark
  in Romanian and light in English, and the kit's `kit.loading-note`; 235 files, one contact sheet per state in
  `reports/screenshots/m5/sheets/`) found what the checkers pass, fixed as CR-M5-29: the ready export said "1
  fotografii" / "1 photos" (now "fotografii: 1, straturi: 0"), its Export was a second filled button beside Download
  (now tonal), and the per-city daily limits of imagery jobs and exports and the city's compute-unit message put a
  number an owner can set to 1 before a plural noun (now in brackets or after a label; the guides' tables follow;
  `docs/LESSONS.md` 234). The admin in all is now 619,971 bytes of its 620,000 (the budget passes with 29 bytes left;
  63i's raise is due before any addition). The NUC: its BuildKit cache held §64's build, and the split's own build log
  showed every layer `CACHED`, so nothing was downloaded; an offline `docker build --network=none` is no probe (the
  network mode keys every `RUN` step; `docs/LESSONS.md` 235). The first split `quality` failed one test on the NUC,
  M2c's `S-A18-BAD-STREAM-DROP` at `admin-l1440-en`: a route reaches only new requests, and Firestore's long poll opened
  before it stayed open 45 s on the loaded machine; the spec now also takes the browser offline until the page says it is
  reconnecting (CR-M5-30, `docs/LESSONS.md` 236). No change of the ask-first kinds, no gate relaxed, no budget raised, no
  checker allowlist entry; CR-M5-7 and CR-M5-14 stay as 63f and 63h say.

Verify: `PIPELINE_STAGE=static`, `tests`, `build` and `quality` (`PIPELINE_STAGE=quality bash scripts/ci/e2e-split.sh`, split
with the NUC); the journey alone:
`E2E_TIER=admin npx playwright test specs/cities/city-journey.spec.ts --project=admin-l1440-ro` in the image.

## 64. Security bumps for §48a and §49i (2026-10-25) — APPLIED 2026-10-25 (user approved the downloads: "yes, install the security bumps")

The four audit gates of the `static` stage (`npm-audit`, `deploy-lock-audit`, `pip-audit`, `pipeline-pip-audit`) failed
on the advisories §48a and §49i name; the `static` run of 2026-10-25 listed the same packages, with three more filelock
CVEs than §48a's (all fixed in the same release). The user approved the security patch and minor bumps of packages
already in the tree; no package was added or removed, no major version changed, and no allowlist or `overrides` entry
was added (every dependant's range already accepts the fixed version).

| Package | From | To | Advisory | Gate |
| --- | --- | --- | --- | --- |
| `body-parser` 2.x (transitive: `firebase-functions` → `express` 5.3.0, `@modelcontextprotocol/sdk` → `express` 5.3.0; `functions/deploy-lock`) | 2.3.0 | 2.4.0 | GHSA-27r3-jxmh-p828 | `npm-audit`, `deploy-lock-audit` |
| `body-parser` 1.x (transitive: `firebase-tools`, `express` 4.22.3, `exegesis`) | 1.20.8 | 1.20.9 | GHSA-27r3-jxmh-p828 | `npm-audit` |
| `qs` (transitive; `body-parser` 2.4.0 requires `^6.16.1`; root and `functions/deploy-lock`) | 6.16.0 | 6.16.1 | none (a dependency of the fix) | `npm-audit`, `deploy-lock-audit` |
| `fast-uri` (transitive: `ajv` 8.20.0 under `firebase-tools`, `html-validate`, `table` and others) | 3.1.8 | 3.1.9 | GHSA-w74x-v6f9-j3xg, GHSA-xhq7-xmqj-769h, GHSA-wjr9-j795-jxcr, GHSA-333x-w4r6-6crp | `npm-audit` |
| `undici` 6.x (transitive: `firebase-tools`, `^6.19.0`) | 6.29.0 | 6.29.1 | GHSA-4qv8-2p9j-2685, GHSA-f72v-6w45-q472, GHSA-xjj6-f33q-929c | `npm-audit` |
| `undici` 8.x (transitive: `firebase-tools` → `re2` → `node-gyp` 13.1.0, `^8.4.1`) | 8.11.2 | 8.12.3 | the same three (affected: 8.0.0 to 8.12.1) | `npm-audit` |
| `filelock` (`scripts/ci/requirements.txt`, `pipeline/requirements-poetry.txt`) | 4.1.1 | 4.2.1 | CVE-2026-112906, CVE-2026-112907, CVE-2026-112913, CVE-2026-112914, CVE-2026-112937, CVE-2026-112940 | `pip-audit`, `pipeline-pip-audit` |

- **npm.** The way §44 took: the affected entries (the three `body-parser` entries with their nested dependencies,
  `qs`, `fast-uri` and both `undici` entries) were removed from `package-lock.json` and `npm install
  --package-lock-only --ignore-scripts` re-resolved them in the digest-pinned Node image (`docs/SETUP.md` → *npm in a
  container*); npm takes the newest release a range accepts, so `undici` 8.x went to 8.12.3, not the first fixed 8.12.2.
  The nested dependencies came back at the versions they had. `functions/deploy-lock/package-lock.json` lost its
  `body-parser` and `qs` entries and was refreshed with `node functions/deploy-lock.mjs` in the same image; its
  `package.json` is unchanged (the root `overrides` did not change). Nothing that ships changes: the viewer and the
  admin bundle none of these, and the functions artifact gets `body-parser` 2.4.0 and `qs` 6.16.1 at its next deploy.
- **Python.** `filelock==4.2.1` in both requirements files, the release the advisories name as fixed (4.2.4 is the
  latest). `pipeline/poetry.lock` does not hold `filelock`, so it is unchanged. Both venvs of the quality image are
  rebuilt by the next `run-all-checks.sh`.

Verify: `PIPELINE_STAGE=static bash scripts/ci/run-all-checks.sh` and `PIPELINE_STAGE=tests bash
scripts/ci/run-all-checks.sh`.

## 65. The M5 reviews' fixes: security, supply chain, minimum input and accessibility (2026-10-25) — 65a–65j and 65l APPLIED (product, test, tooling and documentation changes; 65l a stricter `release` stage, the pre-approved kind); 65k APPLIED for review (a build change that shrinks the admin, reversible in one line); 65e's publishing step PROPOSED, NOT APPLIED (a workflow edit); 65m–65o recorded for the user

The fixer's pass over the two M5 reviews (security and supply chain: nine findings; minimum input, UX and correctness:
seventeen). Nothing was committed, pushed, tagged, published or deployed, nothing was downloaded, and no test called a
real Google, Mapbox, USGS, Nominatim or npm endpoint (the new Nominatim search is answered by the shared fake and the
mock APIs). Every finding is applied, or answered below with why not; each fix has its tests and a lesson
(`docs/LESSONS.md` 237–256).

- **65a APPLIED (security 1): the CLI never reads the owner's tokens.** `firebase login:list` is read as plain text
  (`Logged in as …`); its `--json` answer lists the accounts with their OAuth tokens. The fakes answer `--json` with
  tokens and the tests prove it is never run (lesson 237).
- **65b APPLIED (security 2): `layers.link` keeps each city's pipeline tilesets to that city.** A tileset named
  `<user>.hcm-*` (`tilesetName`) is linkable only when a layer of the request's city records it
  (`apiError.layers.otherCityTileset`; `S-A15-BAD-OTHER-CITY-TILESET`). Recorded limit (`docs/ARCHITECTURE.md`): every
  city's public token belongs to the project's one Mapbox account and reads all of its tilesets.
- **65c APPLIED (security 3): a role change is one transaction, and the project's owner stays.** `changeCityRole`
  (`functions/src/admin/memberships.ts`) reads the caller (still an owner), the target and every owner a query found
  before it, then writes; `admins.setRole` and `admins.revoke` go through it. Of the review's two recovery options, the
  project's owner is never removed from or demoted in a city they own (`apiError.city.projectOwnerStays`; the Admins
  page offers neither on their row), which with `legacyCityRoles` and `cities.create` keeps every city an owner who can
  always reach it. Tested on the Firestore emulator with two owners at once (`S-A51-BAD-ROLE-RACE`,
  `S-A51-BAD-PROJECT-OWNER-STAYS`; lesson 243). `packages/shared/src/api/cities.ts`'s comment now says what the code does.
- **65d APPLIED (security 4): pre-M5 invitations get the cities of now.** `migrateLegacyInvites` (the `memberships`
  tick step, and `cities.create` before it writes) gives each pending invitation without `cities` every existing city
  as an editor, in a transaction per invitation; `admins.list` then shows it and `revokeInvite` finds it
  (`S-A51-HAPPY-LEGACY-INVITE`; lesson 245).
- **65e APPLIED (security 5) in the tree; the publishing step PROPOSED, NOT APPLIED.** Every guide and every command the
  CLI prints names the exact release (`npx create-historic-city@1.0.0`, `NPX_COMMAND`); `release:bump` rewrites the
  guides of `PINNED_DOCS` and `release-check` refuses a tag whose guides name another version. `docs/research/M5-status.md`
  §3 now checks and publishes (or reserves) the npm name before the merge. Proposed for the user (a workflow edit, ask
  first): after the release job, publish `reports/release/create-historic-city-X.Y.Z.tgz` from `release.yml` with
  `npm publish --provenance --access public` in a job with `id-token: write` and the `NPM_TOKEN` secret the user sets,
  so the published tarball is the one CI built and checked.
- **65f APPLIED (security 6): `export.download` has a daily cap and obeys the guard.** At most
  `EXPORT_LIMITS.downloadsPerDay` (10) signings per export a UTC day, counted in `cities/{city}/exports/{id}.downloads`
  in a transaction, none while the guard is red, the day's count logged (`S-A53-BAD-DOWNLOAD-LIMIT`; lesson 246).
- **65g APPLIED (security 7): a CSP source is an origin of CSP's grammar.** `isCspOrigin` (`text/urls.ts`) filters the
  export's origins and `contentSecurityPolicy` throws on anything else; the basemap style's schema and rule
  (`httpsHostUrl()`) refuse a host with `;` or `'`; the export's policy names no telemetry host
  (`S-A53-BAD-STYLE-HOST`; lesson 241). `isHttpsUrl` itself is unchanged: links and photo sources never reach a policy.
- **65h APPLIED (security 8): the self-host bundle is built and checked.** `npm run build:self-host` builds the admin and
  the functions for production first; the bundle refuses an admin that carries the OAuth stand-in; see 65l.
- **65i Recorded (security 9, §58h): still the user's.** Exports still carry the photos licensed for this map only and
  name them in `RIGHTS.md`. The review suggests leaving them out by default behind an opt-in switch, as for the scans;
  it is a rights policy, so it waits for the user's answer (no change made).
- **65j APPLIED (UX 1–17).** 1: `self-host` and `deploy` refuse without `--experimental` (no tool runs; a dry run needs
  no flag), the scaffold no longer advertises them, and `SELF_HOST.md` and the npm README say why (CR-M5-7). 2: New
  city's map answers its zoom buttons. 3: `cities.locate` (new callable, `projectOwner`, as `fn-admin@`: one Nominatim
  `/search` at the mirror beside `HCM_NOMINATIM_URL`, under the title suggestions' cool-down, a refusal starting it)
  draws the named city's rectangle and flies the map there once typing rests; New city is two inputs from any view
  (`newCity` 2, `newCityDrawn` 3; the functions now number 68). 4: `upgrade` keeps the page's own policy sources. 5:
  the gesture follows the primary pointer only, lets a pinch through, and shows a band. 6: an id no city may take is
  said at its field and keeps Create off; an emptied field takes the suggestion again. 7: a city without limits says the
  project's caps alone hold it, its fields empty; a field left empty saves at its maximum (`MAX_CITY_LIMITS`), so
  setting one limit never imposes five (65o). 8: a phone's top bar, a sideways phone's heading and the tab's title name
  the open city (two cities or more); the account menu asks for the cities again when it opens. 9: the done screen and
  Publishing say how a new city gets a public site (`npm run site:add`, or Export), and the imagery line depends on
  USGS being set up. 10: `hcm-button`'s `popup`, `current` and `label` reach its inner button; the switcher is named
  "City: …". 11: one live region per page (New city, the export card), the focus to the heading. 12: the typed edges
  are a draft until all four are there. 13: `theme` recolours a kit from one colour; the kit README gives a photo
  example in both languages (validated by a test), the bbox question says where to find the numbers and labels its
  default, step 1 names every question. 14: a failed `projects:create` names another id. 15: `SELF_HOST.md` says to
  create the city first. 16: the kit's note says only "loading" for 4 s. 17: Create refreshes the city menu at once.
- **65k APPLIED for review (the admin's bundle): `re2js` resolves to a stand-in in the admin's build.** The fixes above
  took the admin from 619,971 to 622,563 bytes gzip, over its 620 KB, and §63i left a raise to the user. Instead of a
  raise: the Firestore SDK imports `re2js` (144 KB minified in `admin-core`) only to evaluate the `like`,
  `regex_contains` and `regex_match` functions of Firestore Pipelines in the browser, which the admin never runs; its
  three call sites catch what `compile` throws and answer an error value. `packages/admin/vite.config.ts` aliases
  `re2js` to `packages/admin/src/vendor/re2js-unsupported.ts` (its `compile` throws, unit-tested). The admin is now
  579.3 KB of 620 (−43 KB); every admin unit and e2e test passes on it; the notices gate no longer lists `re2js` for the
  admin. To revert: delete the `resolve.alias` line (the budget then needs §63i's raise). No gate, threshold or budget
  changed.
- **65l APPLIED (pre-approved kind: a stricter `release` stage): the `self-host-bundle` gate.** `scripts/ci/pipeline.py`
  runs `build-self-host.ts` after `vite-build` and before `release-pack`, which now needs it; the stage's test
  (`scripts/ci/tests/test_pipeline_stages.py`) pins the order. The skills, `docs/CI_PIPELINE.md` and `docs/SETUP.md`
  follow.
- **65m Recorded (UX 5, last item): drawing on a phone stays on by default.** The review suggests drawing only after
  **Draw the area** on compact windows. With 65j's located rectangle a phone rarely needs to draw at all, and switching
  the default would add an input to the drawn path on every touch window (the c360 and m768 projects); the swipe that
  scrolls past the map is the trade-off, left for the user.
- **65n Recorded (UX 3): the located rectangle is the place's own box.** Nominatim's box of a city's administrative area
  (fitted to 0.02°–2°) can be larger than the built-up city; the admin adjusts it, and the done screen's Settings change
  it later. A different default (a fixed size around the centre) is the user's call.
- **65o Recorded (UX 7, last item): no question before a city's first limits.** The review suggests confirming before
  setting limits on a city that had none; since a field left empty now saves at its maximum, saving one limit sets only
  that one, so no question is needed.

Verify: `bash scripts/ci/e2e-split.sh` (the stage `all`, split with the NUC); the release stage's new gate alone:
`node --import ./scripts/site/register-ts.mjs packages/create-historic-city/build-self-host.ts` after `npm run build` in
the image.

## 66. The manual test plan for M4 and M5, and the local stack's second city (2026-10-25) — 66a–66d APPLIED (test-world and documentation changes; no configuration of the ask-first kinds, no gate relaxed, no download)

`docs/MANUAL_TEST_PLAN.md` now walks every M4 and M5 behaviour, each LIVE or LOCAL, and lists every ask-first command
in one table (D1–D8 deploys, R1–R9 release and repository steps). The local stack seeds what those screens need. Choices
the user may want to change:

- **66a A second city, Iași, in the `city` seed** (`e2e/stack/seed-cities.ts`): made through the server's own
  `cities.create` and `setup.rotatePublicToken`, unpublished, with a category and two places, the project owner's alone
  (`admin@e2e.test` stays an editor of București only). Not Cluj-Napoca: the fake Nominatim finds only that name, which
  New city's LOCAL walk uses.
- **66b Mapbox connected through `setup.saveMapbox`** with the fake's generated bootstrap token (`MAPBOX_TOKENS.bootstrap`
  of `@hcm/test-support`), replacing the seeded `setup/status.mapbox` record with the server's own: the Functions
  emulator keeps secrets in memory, so without it no city made in the stack had a viewer token and its manifest was
  refused when published.
- **66c Every city's page on the stack's site server**: `http://127.0.0.1:4310/<city>/` serves the Bucharest site's page
  and engine with a `config.js` naming the city and the manifest the emulators published (404 before), standing in for
  `site:add` and `build:site` (the tab's title stays Bucharest's).
- **66d The shim forwards an `<a download>` the page clicks itself** (the export's Download), never a link a person
  follows (`docs/LESSONS.md` 259); the stack's check gained that step and the second city's.
- The plan's item ids are now unique (the M5 items were `M1`–`M7` beside M3's `M1`–`M10`, and M4's title suggestions
  `A1` beside the start-up page's): M4 is `O`, `S`, `N`; M5 `T`, `X`, `K`; the swipe compare `V11`.

Verify: `bash scripts/dev/dev-stack.sh` then `bash scripts/dev/dev-stack.sh check` (`[SUCCESS] the local stack works`);
`PIPELINE_STAGE=static bash scripts/ci/run-all-checks.sh`.

## 67. The M6 contract: Setup with no terminal, the in-app installer on Cloud Build, the public map on Firebase Hosting (2026-10-25) — 67a, 67b, 67h, 67i and 67k DECIDED by the contract (`docs/research/M6-interfaces.md`), each applied by its workstream; 67c, 67e and 67j PROPOSED, NOT APPLIED (two workflow lines and a registry read: ask first); 67d, 67f, 67g and 67l for the user; 67e and 67g APPLIED 2026-11-01 (the user's decision, §80)

The contract answers the user's live manual test of 2026-10-25 (`docs/research/manual-test-2026-10-25.md`, findings
1–24) and the user's four requirements of that day: install the server from step (d) with a button; no Claude and no
terminal in the rest of Setup; the public map on Firebase Hosting at `https://bucurestiul-disparut.web.app/` with the
admin under `/admin/`; USGS can be done later. Nothing was built, deployed, pushed or downloaded by the contract; only
the IAM grant of finding 17 was applied live, by hand and with the user's approval, before it (67b).

- **67a DECIDED: the installer runs in Google Cloud Build as its own account, `hcm-installer@`.** The admin submits
  regional builds from the browser with the owner's `cloud-platform` token (the pattern of Provision; the token stays in
  the tab and never enters a build); the builds run `firebase-tools` 15.33.0 (from a lockfile in the bundle), Docker and
  small Node step scripts, authenticated through the metadata server. The account gets, least privilege: on the project
  `roles/cloudfunctions.developer`, `roles/firebaserules.admin`, `roles/datastore.indexAdmin`,
  `roles/cloudscheduler.admin`, `roles/cloudtasks.queueAdmin`, `roles/serviceusage.serviceUsageConsumer`,
  `roles/firebase.viewer`, `roles/firebasehosting.admin`, `roles/logging.logWriter` and a custom role `hcmInstaller`
  (Cloud Run services' get and IAM policy, Cloud Run jobs' create, get and update and their operations,
  `resourcemanager.projects.getIamPolicy`, Artifact Registry repositories' get and update); `roles/iam.serviceAccountUser`
  on `fn-admin@`, `fn-events@`, `fn-crash@` and `job-raster@` only; `roles/artifactregistry.writer` on the repository
  `hcm` only. Rejected: `roles/run.admin` or `roles/run.developer` (would let it replace any Cloud Run service),
  `roles/resourcemanager.projectIamAdmin` (would let it grant anything), `roles/artifactregistry.repoAdmin` at the
  project, `roles/editor`; reusing `gh-deployer@` (it is GitHub's, through Workload Identity, which stays optional). The
  set is UNVERIFIED as complete: the first real install's 403s name what is missing, and each addition is logged here.
  Why Cloud Build and not REST calls from the browser per function (finding 10's first sketch): the same
  `firebase-tools` that CI and the terminal use, so one deploy logic, and its first-deploy behaviour is what the live
  test already exercised.
- **67b DECIDED (applied by hand on 2026-10-25 with the user's approval; Provision adds it in M6): `roles/run.invoker`
  for `fn-events@` and `fn-admin@` on the project.** Eventarc delivers the Firestore, Storage and Pub/Sub events with
  the function's own account, Cloud Scheduler's OIDC calls as `fn-admin@`, a task queue's tasks as the enqueuer; without
  the role the import stopped at 0 of 45. Project-wide because both accounts only ever call this project's functions and
  the grant must exist before the functions do. The narrower alternative, the role on each function's Cloud Run service
  after every install (the installer's `verify` step would grant it), is the user's to choose; it adds a step to every
  install and leaves a window after a new function appears.
- **67c PROPOSED, NOT APPLIED (two workflow edits, ask first): GitHub Pages becomes optional.** The public map's home is
  Hosting. To retire the Pages site without breaking the 2015–2022 links, `ci.yml`'s "Upload the GitHub Pages
  artifact" would upload `dist/pages-redirect` (each page sends its visitor to the Hosting address with the same hash)
  instead of `dist/site/bucharest`; to keep Pages as a second public address, nothing changes. Either way a push to
  `master` publishes it (ask first).
- **67d For the user: the viewer's origins.** `infra/project.json` `viewerOrigins` and `HCM_VIEWER_ORIGINS` become the
  two Hosting origins; the contract keeps `https://ventura8.github.io` beside them while the Pages site exists (its
  token keeps working there). Dropping it once 67c's redirect is live tightens the token.
- **67e APPLIED 2026-11-01 (user decision; §80a): `tools.docker` = `gcr.io/cloud-builders/docker@sha256:6a6635024a23c8ed596c26fefc744bd3c5dbe269e8d8d541f2fda2beb0664ea5`, the tag `29`.** Originally PROPOSED, NOT APPLIED (a network read, ask first): the digest of `gcr.io/cloud-builders/docker`. The pipeline
  build's Docker steps must name their image by digest (the repository's rule). Reading the current digest is a request
  to Google's registry (no image is pulled), so it waits for the user's yes; until then the pipeline target is complete
  and tested against the fakes, and the live card says it is not available in this release. The command, for the yes:
  `docker buildx imagetools inspect gcr.io/cloud-builders/docker:<version>` for the builder's current version tag (its
  digest written into the build definition, the version in a comment, never a moving tag).
- **67f For the user: a likely free trial is guessed, not read.** The Cloud Billing API v1 says nothing of a free trial
  (UNVERIFIED at the time of writing; checked again by setup-ux). An account that appeared while Setup's billing card
  waited (a new account, which Google opens as a trial for a new customer) is recorded as a likely trial, and Home
  reminds 14 days before its 90th day, with the link to upgrade and "It is a paid account" to dismiss it for good. An
  account that existed before is never flagged.
- **67g APPLIED 2026-11-01 (user decision; §80b): `gemini-3.5-flash-lite`, then `gemini-3.1-flash-lite`, the first one offered.** Originally for the user, after the probe: the Vertex AI model. The `ai` check's `apiError.internal` means Vertex AI
  answered with a failure the check did not map (a 404, a 400 or 422, a 401, or no `totalTokens`); the leading
  hypothesis is a 404 for `gemini-2.5-flash-lite` in `us-central1` (retired, or not offered to this project), UNVERIFIED.
  M6 logs the status and Google's reason and names them on the card; if the probe shows a retired model, changing
  `VERTEX_MODEL_ID` (and its price constant) is a reviewed change for the user's yes. The `ai` check becomes optional: it
  never keeps Setup from "done".
- **67h DECIDED: a 69th function, `ops.onProbe`.** The self-test's new `events` check needs a real event to travel
  through Eventarc to a function running as `fn-events@`; no existing trigger is harmless to provoke (each publishes,
  processes or records history). It costs one more function to build and deploy and nothing at rest.
- **67i DECIDED: the Setup input budget grows from 9 inputs to 11** (4 consents unchanged): Install the server and
  Publish the map are a button each, as the user asked; the imagery pipeline's install rides on the server's click.
  With USGS postponed the whole assistant takes 9 inputs, the required steps alone 7. In exchange D2–D5 and D7 leave the
  terminal.
- **67j PROPOSED, NOT APPLIED (a workflow edit, ask first): `--force` in `ci.yml`'s `deploy-firebase`.** `firebase-tools`
  refuses, non-interactively, to deploy a function with a failure policy (`notify.onEvent`) and to set the image cleanup
  policy without it (finding 9). It also deletes functions missing from the source, which is right for a deploy of
  `master`. The in-app installer passes it and refuses to install a bundle older than the installed server.
- **67k DECIDED: Cloud Build downloads at install time, in the owner's project.** The builds install `firebase-tools`
  from npm (each package checked against the bundle's lockfile integrity) and pull the step images by digest, and Google's
  own function builds install the functions' locked dependencies, as every deploy already did. None of this runs on the
  developer machine or the NUC, and nothing is downloaded by the gates.
- **67l For the user, later: an update channel for owners without CI.** The admin installs its own bundle; a newer
  admin reaches Hosting by a CI deploy, a terminal deploy, or a future "a new release exists" check (for example the
  release workflow attaching the bundle to the GitHub Release and the admin reading the latest release). Not in M6.

Verify: `PIPELINE_STAGE=static bash scripts/ci/run-all-checks.sh` (the registry's 69 new planned rows, the regenerated
`docs/E2E_SCENARIOS.md`, the Markdown).

## 68. The M6 hosting workstream: the public map on Firebase Hosting, the admin under `/admin/` (2026-10-25) — 68a–68h APPLIED (product, test, tooling and documentation changes within `docs/research/M6-interfaces.md` §2 and its change requests CR-M6-15 to CR-M6-19; 68g a new gate of the build stage, the pre-approved kind; no gate relaxed, no budget raised, no checker allowlist entry, no download); 68i UNVERIFIED until the first deploy; 68j for the user, ask first

- **68a APPLIED: the Hosting tree and `firebase.json`'s Hosting block.** `npm run build:hosting`
  (`scripts/site/build-hosting.ts`, `scripts/site/src/hosting/`) builds every committed city site for Hosting (each
  reading the public bucket `<projectId>-public` or `HCM_PUBLIC_BUCKET`; the root one, `pagesPath` `""`, with
  `admin-redirect.js` first), the generic city page (`/city/`: its `config.js` takes the city id from the address and
  reads `cities/<id>/manifest.json` of the bucket, so a city made in the admin needs no repository step), and assembles
  two trees: `dist/hosting-public/`, always the public variant (the installer's `hosting.tgz`, CR-M6-5), and
  `dist/hosting/` (`hosting.public`), the variant this deploy publishes: start-up with `HCM_ADMIN_START_UP=1` (a
  bilingual "being set up" page, no engine, the admin's `runtime.json` `startUp: true`), else public. The release is the
  admin build's own (`runtime.json`), written to `/release.json` with the variant; `admin/install/` is never copied from
  the admin's build. `firebase.json`: `public` `dist/hosting`, `predeploy` `build:hosting`, `cleanUrls`,
  `trailingSlash: true`, `/admin` → `/admin/` (301), rewrites `/admin/**` → the admin's page and
  `^/[a-z0-9-]{2,32}/?$` → `/city/index.html`, the admin's CSP, Trusted Types report-only and COOP on `/admin/**` only,
  `Referrer-Policy`, `nosniff` and the Permissions-Policy everywhere, no CSP outside the admin (every viewer page keeps
  its meta policy: a probe-path test pins one policy per page), pages `no-cache`, `/admin/legacy/**` a day,
  `/admin/install/**` a year and immutable with its `manifest.json` `no-cache`. `scripts/site/src/admin/hosting.ts`
  now reads redirects, regex rules and `trailingSlash` in superstatic's order (the Hosting emulator's engine), with
  superstatic's trailing-slash and clean-URL moves as tables (complexity 5). The Hosting build is a CLI of its own,
  not the `--hosting` flag of `build:site` that §2.1 sketched: it needs the admin's build and the bucket for every site,
  which the Pages build does not, and Hosting's `predeploy` runs it alone.
- **68b APPLIED: the e2e Hosting server.** `e2e/mock-apis/admin-server.ts` serves the e2e build's Hosting tree
  (`dist/e2e-hosting`, built by `e2e/scripts/build-site.ts` with the production assembler) through
  `resolveHostingPath`; the admin's reserved files moved to `/admin/runtime.json` and `/admin/project.json`; the
  start-up tree (`dist/e2e-hosting-start-up`) answers a browser with the cookie `hcm-e2e-variant=start-up` (per browser
  context, so parallel tests never see each other's variant); `/firebase-messaging-sw.js` is a root push worker for the
  old-worker scenario. It starts for every e2e run (`e2e/playwright.config.ts`: the viewer tier's V30 opens it; the
  emulators stay the admin tiers' only), and every e2e build now builds the admin's Hosting folder (a few seconds:
  the tree holds it; `scripts/ci/e2e_build.py` counts the two trees among its outputs). Every admin spec's address
  moved under `/admin/` in one change (`adminPath`, `ADMIN_URL`, the helpers of the specs' worlds); the local stack's
  root sends to `/admin/` so `.claude/launch.json` keeps opening the admin. `create-historic-city`'s self-host bundle
  follows the base too: its Hosting folder is `hosting/` with the admin in `hosting/admin/`, its template redirects the
  root to `/admin/` (302) until the map is published, and the CLI opens `https://<id>.web.app/admin/`.
- **68c APPLIED: the admin under `/admin/`.** `packages/admin/vite.config.ts` `base: '/admin/'`; the admin fetches
  `runtime.json` and `project.json` at `import.meta.env.BASE_URL` (`/admin/` in the builds, `/` under the unit tests);
  everything else it loads is relative to its page (chunks, fonts, `legacy/`, `install/`) or Hosting's reserved
  `/__/` paths (unchanged, same origin, same authorised domains). The push worker's start page is its own scope
  (`/admin/`), and both registrars (FCM and the `e2e` stand-in) unregister a registration of the site's root scope
  (`retireRootWorker`) before registering their own, so no worker of a pre-M6 admin controls the public map; the
  stand-in registers the real worker where the browser lets it (the e2e projects block service workers unless a spec
  allows them). The functions' `adminUrl` is `https://<project>.web.app/admin/` (invitations, the inbox's and push's
  links); with no `HCM_VIEWER_ORIGINS` the viewer's origins default to the project's Hosting origins.
- **68d APPLIED: one origin, two apps' traces kept apart.** The admin's GA4 runs with `cookie_prefix: 'hcm_admin'`
  and its withdrawal expires only `hcm_admin_ga*`, never the viewer's `_ga` (cookies a pre-M6 admin wrote as `_ga` stay:
  nothing tells them from the viewer's). `telemetry.reportError` decides the Error Reporting service by the report's
  page (under `/admin/` on an admin origin the admin's, else on a viewer origin the viewer's, else on an admin origin
  the admin's: a pre-M6 admin at the root) and refuses, 403 `apiError.telemetry.origin`, a report whose page is not on
  its request's `Origin` (S-A24-HAPPY-SAME-ORIGIN, S-A24-BAD-PAGE-ORIGIN-MISMATCH).
- **68e APPLIED: the viewer's token follows the server's origins** (`functions/src/ops/viewer-tokens.ts`, run by
  `ops.tick`'s `tokens` step after the retirement). A city whose recorded `mapbox.allowedUrls` differ from
  `viewerOrigins` gets a token minted for them as `setup.rotatePublicToken` mints one, written to the city (its manifest
  republishes when the city is published) and the old one queued for retirement after `TOKEN_RETIRE_MINUTES`; at most
  the retirement queue's room per tick. A refused mint keeps the old token and records `setup/status.mapbox.detail`
  (`apiError.mapbox.mintRefused`, the area's state unchanged) and fails the step with that code; the next successful
  re-mint clears it. Deviation from §2.6 (CR-M6-19): the contract's `viewerAllowedUrls` is the existing
  `cities/{city}.mapbox.allowedUrls`, which `setup.saveMapbox` and `setup.rotatePublicToken` already write; a token
  without recorded addresses is left alone (what it allows is not known). The feature folders reach each other only
  through `api/` (dependency-cruiser's `functions-feature-folders-independent`), so the re-mint has its own small mint
  and transaction instead of `setup/`'s, and `tokenNote` moved to `functions/src/api/mapbox-token-note.ts` (re-exported
  by `functions/src/setup/mapbox-tokens.ts`), so a token's note stays one formula.
- **68f APPLIED: the viewer's origins** (§67d's default, the user's to change): `infra/project.json` `viewerOrigins`
  and `functions/deploy-env.json` `HCM_VIEWER_ORIGINS` are `https://bucurestiul-disparut.web.app`,
  `https://bucurestiul-disparut.firebaseapp.com` and `https://ventura8.github.io` (kept while the Pages site exists).
  `city` joins `RESERVED_CITY_IDS` (the generic city page's folder); the New city flow's suggestion for a name with no
  letter or digit becomes `my-city`.
- **68g APPLIED (the pre-approved kind: a stricter gate): `hosting-build`** in the build stage
  (`scripts/ci/pipeline.py`, after `vite-build`; `node --import ./scripts/site/register-ts.mjs
  scripts/site/build-hosting.ts`, so the stage's own builds are reused), with its line in `test_pipeline.py`.
- **68h APPLIED: the GitHub Pages redirect tree** (`npm run build:site -- --pages-redirect <dir>`,
  `scripts/site/src/hosting/pages-redirect.ts`): a page for the root and each city's Pages path, each sending the
  visitor to the same page on `https://<projectId>.web.app/` with the same query and hash (the target is a build value
  in `<html data-target>`, never the address's), the root's `404.html` to Hosting's root; without script each says the
  map moved, in Romanian and English. `npm run build:site` builds it beside the Pages tree (`dist/pages-redirect`, so
  the build stage's `site-build` proves it), which makes §67c, when the user says yes, the one workflow line
  `path: dist/site/bucharest` → `path: dist/pages-redirect` of `ci.yml`'s "Upload the GitHub Pages artifact" step.
  Publishing it stays §67c (ask first).
- **68i UNVERIFIED until the first deploy:** that the live Hosting CDN applies `trailingSlash` and `cleanUrls` as
  superstatic does (the e2e resolver and the probe-path tests implement superstatic's moves); that GA4's `cookie_prefix`
  names the cookies `hcm_admin_ga` and `hcm_admin_ga_<container>` (the withdrawal matches one or more underscores).
- **68j For the user, ask first: D1 with the M6 tree** (`docs/MANUAL_TEST_PLAN.md` → D1): `npm run build:hosting` in
  the image (with `HCM_ADMIN_START_UP=1` for the start-up page, or without it for the public map directly: this
  project's server and published manifest exist), then `firebase deploy --only hosting`. After it the admin is at
  `https://bucurestiul-disparut.web.app/admin/` and every old `/#/…` address forwards there.

Verify: `PIPELINE_STAGE=static bash scripts/ci/run-all-checks.sh`; the `tools`, `admin`, `shared` and `functions`
Vitest projects; Playwright `specs/viewer/hosting.spec.ts` at `fn-l1440-ro`, the site states at the 44 tour projects,
`admin/specs/shell/admin-path.spec.ts` and the admin specs whose addresses moved at `admin-l1440-ro`.

## 69. The M6 server-bugs workstream: the Scheduler's account, the events probe, the API propagation wait, Provision's M6 rows and the Vertex AI failures (2026-10-25) — 69a–69f, 69h and 69i APPLIED (product, test and documentation changes within `docs/research/M6-interfaces.md` §1.2, §1.5, §1.6 and §3.2 and CR-M6-2, with CR-M6-6 to CR-M6-8, CR-M6-14 and CR-M6-20; no configuration of the ask-first kinds, no gate relaxed, no budget raised, no checker allowlist entry, no download); 69g for the user

Findings 4, 11, 12, 17 and 20 of the user's live manual test (`docs/research/manual-test-2026-10-25.md`). Every change is
tested against the emulators, the fakes and the e2e mock servers; nothing reached a real Google, Vertex AI or Mapbox
endpoint, and nothing was deployed. The lessons are `docs/LESSONS.md` 260–265.

- **69a APPLIED: every function names its runtime account in full (finding 11).** `runAs` and the global default
  return `<account>@<project>.iam.gserviceaccount.com`, the project read from `GCLOUD_PROJECT` (firebase-tools sets it
  for discovery; the emulators set `demo-hcm`), else `GOOGLE_CLOUD_PROJECT`; neither set is a refusal naming both, never
  the shorthand. `functions/test/deploy-shape.test.ts` loads `src/index.ts` with firebase-tools' discovery environment
  (as `index.test.ts` does: the `tests` stage runs before any build, and the bundle is the same code; a deviation from
  §3.2's "the built `functions/dist/index.js`", CR-M6-8) and builds each scheduled function's Cloud Scheduler job with
  firebase-tools 15.33.0's own `jobFromEndpoint`, which reproduces the bug with the shorthand and passes with the full
  address. On the live project the next server install creates both jobs.
- **69b APPLIED: the self-test's `events` check and `ops.onProbe`, the registry's 69th function (finding 17, §67h).**
  The check writes `ops/probe` with a fresh nonce (system writer `ops`) and polls it once a second for at most 20 s
  (`EVENTS_PROBE_WAIT_MS`); `ops.onProbe` (`fn-events@`, one instance, no retry) copies the nonce back in a transaction,
  so it never overwrites a newer probe and its own write answers nothing. No answer is `apiError.setup.eventsUnreached`
  naming `roles/run.invoker`. The `Clock` port gains an optional `sleep` for the poll (the system clock's is Node's
  timers; a test clock without it polls its rounds at once). The probe's document needs no rule: no client reads it,
  and `ops/{doc}` stays closed for ids the rules do not name.
- **69c APPLIED: an API Google is still switching on is waited for (finding 4, §1.5).** The admin's transport, given
  `withApiPropagation`, waits out a 403 `SERVICE_DISABLED` of an API that Service Usage reports enabled (asked once, at the
  first refusal) after 10, 20, 40, 60 and 60 s on the injected clock, the running item reading "Waiting for Google to
  switch on {api}…"; still refused, the item is `missing` with `apiError.cloud.apiPropagation`. An API Service Usage
  reports off fails at once, as before. Every client of the Setup Assistant's Cloud port has it, so the installer's
  submit can share it.
- **69d APPLIED: Provision's M6 rows (findings 12 and 17, CR-M6-2).** `hcm-installer@` with exactly §1.2's roles and the
  custom role `hcmInstaller`; `roles/iam.serviceAccountUser` for it on the four runtime accounts only;
  `roles/artifactregistry.writer` on the repository `hcm` only; the item `artifact-registry` (the Docker repository with
  its cleanup policy keeping two images; 16 items); `roles/run.invoker` for `fn-events@` and `fn-admin@` on the project
  (§67b, as granted by hand); the Eventarc and Pub/Sub service identities generated before the role table; the APIs
  `firebasehosting`, `firebaserules`, `firestore`. Beyond §1.2, recorded for review (CR-M6-8): firebase-tools'
  `ensureServiceAgentRoles` wants, on a project with no event function yet, the Pub/Sub agent's
  `roles/iam.serviceAccountTokenCreator` and the Compute Engine default account's `roles/run.invoker` and
  `roles/eventarc.eventReceiver`, and writes the project's policy when they are missing, which `hcm-installer@` may only
  read; Provision binds them so the first install only reads them, the compute account's only when the project has that
  account (a binding naming a missing account would make Google refuse the whole policy).
- **69e APPLIED: the Vertex AI failures are named and logged (finding 20).** `UpstreamError` keeps Google's
  `error.status` and the first `ErrorInfo` reason (`[A-Z_]{1,64}` or dropped, never the message); the self-test logs
  `{check, code, service, failure, status, googleStatus, reason}`; a 404 is `apiError.assist.modelUnavailable {model}`
  in the check and on the drafts button; any other refusal is `apiError.cloud.refused {api, reason}`, never
  `apiError.internal`. On the live project the owner's Check again after the next server install names the cause
  (§67g).
- **69f APPLIED: the import re-sends a photo whose upload event was lost (finding 17).** A photo still `pending` two
  minutes after its upload (`STUCK_PHOTO_MS`, the injected clock) goes to `photos.reprocess` once; still `pending` two
  minutes later it is listed as `apiError.photo.notReceived` (a new code: the import's line takes no parameter) with a
  link to Prepare the project, and the import goes on. The e2e loses the first event by sending the upload, with the
  Storage emulator's admin token, to a name in the same folder that `photos.onUpload` ignores (`photos.reprocess` still
  finds it, and runs for real in S-A28-HAPPY-STUCK-REPROCESSED); for the second loss (S-A28-BAD-STUCK-AGAIN) the test
  answers the page's `photos.reprocess` call as the callable does, without the copy, because the emulators always
  deliver the event of a copy the server makes. That one answered callable is a judgement for review: the alternative
  is a test-only switch in the functions, which the repository's rules forbid.
- **69g For the user (UNVERIFIED until the first in-app install, ask first): the Compute Engine API.** firebase-tools
  reads the Compute Engine default account on a first functions deploy (`gce.getDefaultServiceAccount`). Provision does
  not enable `compute.googleapis.com` (enabling it creates that account, with Editor on the project unless the
  organisation withholds the default grants); the live project already has it from D3. If a fresh project's first install
  fails there, adding `compute` to `REQUIRED_APIS` is the user's decision.
- **69h APPLIED: CR-M6-14 (setup-ux's request, 2026-10-30).** A Check again keeps `setup/status.usgs.pendingSince`
  (S-A59-HAPPY-APPROVAL-PENDING's date survives the self-test), and `apiError.cloud.apiPropagation` ends "Wait a
  minute, then retry what failed" instead of "Try again in a minute", so it names the provisioning card's button
  (finding 5) without a mapping on the card.
- **69i APPLIED: Retry what failed waits for the run's record (CR-M6-20).** In normal mode the Provision card recorded a
  run with `setup.recordCloud` after it had already re-enabled Retry what failed; a Retry clicked meanwhile ran and
  recorded first, and the older record, applied last, put the items back (13 of 16, `service-accounts` missing). The
  card now stays busy until the record is back; S-A04-BAD-API-STILL-DISABLED failed about one run in two before.

Verify: `PIPELINE_STAGE=static` and the workstream's targeted Vitest projects and Playwright specs inside the image (the
workstream's report quotes them); the split stage is the integrator's.

## 70. The M6 setup-ux workstream: the frame's rules, the billing wait, USGS later, the likely free trial and the shell's fit (2026-10-25) — 70a–70i and 70k APPLIED (product, test and documentation changes within `docs/research/M6-interfaces.md` §3.1 and §4.1, CR-M6-3, CR-M6-4 and the self-applied CR-M6-12; 70h a stricter tour check, the pre-approved kind; no gate relaxed, no budget raised, no checker allowlist entry, no download); 70j for the user; 70l APPLIED 2026-10-31 (§74)

The workstream answers findings 1, 2, 3, 5, 6, 7, 15, 16, 18, 19, 22 and 24 of the live test of 2026-10-25
(`docs/research/manual-test-2026-10-25.md`) and the quiet part of finding 20.

- **70a APPLIED: when Setup is done is one rule, `setupDone` (`packages/shared/src/api/setup-done.ts`).** Billing, the
  project's preparation and Mapbox `ok`; USGS `ok`, postponed (`usgs.postponedAt`) or waiting for USGS's approval of a
  saved token (`pending` with `apiError.usgs.accessPending`, which takes days); and, once Setup records the installer's
  targets (`setup/status.install`), the server and the site installed (`installed`, `updateAvailable`, `newerInstalled`).
  A `setup/status` without `install` is a map set up before M6, whose server answers: it is not held back. The Setup
  page's header ("Setup done", "— USGS later", "— approval pending"), the dashboard-first rule (`setup-readiness.ts`) and
  Home's reminders read it; the server's own `setupReady` (the view's `ready`) is unchanged. The admin state's `ready`
  reads the areas and USGS; the install part there is the installer's (CR-M6-13).
- **70b APPLIED: Do it later is a record, not a state.** `setup.recordCloud`'s `postponed: {usgs}` sets or clears
  `usgs.postponedAt` and keeps the area's own state and reason (a refused token stays `invalid` with its reason, later);
  a saved token replaces the record whole, which ends the postponement. The chip reads Later (`step.postponed`), the
  progress counts it apart, the next step to open treats it as settled (CR-M6-4). One input (`skipUsgs`).
- **70c APPLIED: since when the approval is awaited is the server's (`usgs.pendingSince`).** Set by the first `pending`
  check (`usgsRecord`), kept while USGS does not answer and by a re-saved token, gone once approved. `ops.tick` keeps it
  (it rewrites the record field by field); the self-test's `usgsAfter` does not pass it on yet, so a Check again restarts
  the date (CR-M6-14 to server-bugs, one line).
- **70d APPLIED (implements 67f): a likely free trial.** An account the billing card's wait finds (never one listed at the
  first look) records `billing.trialSince` (the day it appeared, through the bootstrap record before the claim, kept by
  later billing reports, never moved, never in the future); Home reminds from 14 days before its 90th day with the
  billing page (`gcp.billingAccounts`, verified) until "It is a paid account" records `billing.trialPaidAt` (one input,
  `dismissTrial`). Whether the Cloud Billing API can tell a trial apart is still UNVERIFIED: checking Google's reference
  is a network read this workstream does not make.
- **70e APPLIED: the billing card's wait (finding 3).** A primary **Create a billing account** opens
  `https://console.cloud.google.com/billing/create` (`gcp.billingCreate`, added to `links.json` in the console's
  documented form and checked by the next weekly contract run, as `gcp.errorGroup` was); while the card waits it offers
  no Link button, says what it does by itself, and when it last looked (outside the status region, which announces the
  wait once).
- **70f APPLIED: the frame's rules (findings 6, 7, 15).** A busy chip shows the loading indicator in place of its icon,
  its shape sized to the 18 px box through `::part(indicator)`, and says Working… (a still icon with reduced motion); the
  consent note shows only while no live token holds the card's scope (`liveScopes`, read on every change), and beside
  Continue when that is the button; a `*.progress` reason is the body's count and is not repeated; a deep link's advice
  is a hint beside it (`LINK_HINTS`). `apiError.cloud.apiDisabled` names the Setup step (the server checks link it); the
  provisioning card says Retry what failed instead (`adminSetup.provision.apiDisabled`).
- **70g APPLIED: the shell fits (findings 1, 2, 22).** The loading screen's padding is inside its `100dvh`; it has a
  visually hidden page heading (axe's `page-has-heading-one` on the new tour state); the sign-in, claim, join and blocked
  panels are centred from 600 × 480 and start at the top below; the page's root wears the shell's theme and surface (a
  constructed sheet, `root-surface.ts`: no inline style), so the canvas under a scroll past the end or an overscroll is
  the surface. The self-test list's focus ring is its container's on colour (the tour measured secondary at 2.16:1 there).
- **70h APPLIED (the pre-approved kind: a stricter check): `graphic-overlap` in the tour's layout checker.** A loading
  indicator's shape (`[part="indicator"][role="progressbar"]`) must not cover any text but its own; the occlusion check
  samples a text's centre only and the overlap check floating chrome only, so finding 6 passed both. Limited to the
  indicators (their shapes turn and morph past their box); icons are next.
- **70i APPLIED: the import's end in the snackbar (finding 19).** All on the map, or how many with Open (ten seconds),
  which opens the card's list; a notice's action may now be a Setup text (`NoticeInput.action.key`).
- **70j For the user: the Vertex AI check stays listed, apart.** The translation drafts' check is under Optional
  features, off with its reason and a neutral icon, never holding Setup back (finding 20's quiet part); the model choice
  is still 67g.

- **70k APPLIED (the workstream's second run, 2026-10-30): what the first run's verification left.** The Setup page wears
  the kit's focus ring (`focusRing` in `hcm-setup-page`'s styles): its server checks' fix links had the browser's own
  ring, which the tour measured at 2.16:1 on the list's container at `admin-c360-ro` only (Android's orange ring; the
  desktop's near-black one passes the contrast check, so the other projects could not see it); a unit test pins the
  ring's style and colour. S-A03-HAPPY opens the analytics card itself: since the installer's imagery pipeline step
  (d3, optional) the next step not done after USGS is the pipeline's, not analytics. Four test files' types fixed for
  `tsc -b` (`renderRoot` on an `HTMLElement`, a status view in the reminders' fake answer, the bootstrap record's type,
  `apiError.photo.unreadable`).

- **70l APPLIED 2026-10-31 (§74e; the user approved the dependency update and the `re2js` fix): the `npm-audit` gate's new advisory.** On 2026-10-30 the static
  stage's `npm-audit` fails on GHSA-gg6h-894w-4m9c (high: quadratic-time lookbehind matching in `re2js` 2.2.0–2.8.6),
  reached through `markdownlint-cli2@0.24.0` → `markdownlint@0.42.0`, which pins `re2js` 2.8.6 exactly (the Firebase
  SDK's `^2.8.3` resolves to the same copy; the admin's build already replaces it, §65k). No M6 change brought it: the
  advisory is new. The fix is an `overrides` entry for `re2js` at its first patched release (or, if none is out yet,
  `markdownlint-cli2` held at 0.23.3, the downgrade `npm audit` offers, as a `HELD` entry with this reason), applied
  with `npm install` in the digest-pinned `node:24-bookworm-slim` image (`docs/SETUP.md` → *npm in a container*): a
  download, so it waits for the user's yes; never an allowlist. Until then `PIPELINE_STAGE=static` stops at
  `npm-audit` for every workstream.

Verify: `PIPELINE_STAGE=static`; Vitest `shared`, `admin`, `ui`, `e2e-support` and the setup tests of `functions`;
Playwright `admin/steps` at `admin-steps-l1440-en` and `admin/specs/shell/setup-*.spec.ts` at the five admin projects,
inside the image (the workstream's report quotes them); the split stage is the integrator's.

## 71. The M6 installer workstream: Cloud Build from the browser, the install bundle, the three cards and Home's tile (2026-10-30) — 71a–71g APPLIED (product, test, tooling and documentation changes within `docs/research/M6-interfaces.md` §1, §4.1, §6 and the accepted CR-M6-3, CR-M6-4, CR-M6-5 and CR-M6-16, with the self-applied CR-M6-21; 71e two new gates of the build stage and new rows of `check_bundle_budget.py`, the pre-approved kind; no gate relaxed, no budget raised, no checker allowlist entry, no download); 71h for the user; 71i APPLIED 2026-10-31 (§74)

The workstream answers the user's requests (1) "a button" in step d, (2) no terminal in the rest of Setup, and the
installer's part of (3), the public map published from the admin (findings 9, 10, 12, 13 and 14 of
`docs/research/manual-test-2026-10-25.md`).

- **71a APPLIED: the installer's port and its Cloud Build adapter** (`packages/admin/src/install/`, the REST clients
  `packages/admin/src/google/{cloud-build,logging,run-jobs,artifact-registry}.ts`). The admin submits each target's
  build of its own bundle with the owner's `cloud-platform` token (memory only, as Provision), as `hcm-installer@`, and
  reads the builds by tag, each step's state, the failing step's last 20 log lines (Cloud Logging, redacted, shown as
  text) and what is installed (the functions' `HCM_RELEASE`, the jobs' `hcm-release` label, the site's `/release.json`).
  The build definitions are data (`build-spec.ts`) checked against golden JSON; the first step (`fetch`) is an inline
  Node program that refuses any file whose SHA-256 is not the one the admin read.
- **71b APPLIED: the install bundle** (`npm run build:install`, `scripts/site/src/install/`): `server.tgz`,
  `pipeline.tgz`, `hosting.tgz` and `manifest.json` at `admin/install/<slug>/` of the deployed Hosting tree,
  deterministic (sorted ustar entries, fixed modes and owner, `SOURCE_DATE_EPOCH`, gzip without name or time: two builds
  of one commit give the same bytes), `firebase-tools` cut from the root lockfile offline, the step scripts bundled from
  `scripts/site/src/install/steps/` (the contract's `scripts/install/` lives there, CR-M6-21). `HCM_RELEASE` joins the
  functions' `.env.<project>` (`functions/build.mjs`).
- **71c APPLIED: the cards.** Install the server (d, one click, which also starts the imagery pipeline), the imagery
  pipeline (d3, no input of its own; Try again on a failure) and Publish the map (i, one click; off with the reason while
  the first city has no published manifest), each with its steps, the server's functions' count once, the retry Google
  is waiting on, a stopped build's step, log and console link, the build minutes against the free tier, and **Update the
  map** when what is installed is older than the admin. A click restarts the card's watch (its next look one running
  interval later, whatever wait an earlier failed look had set), and Update the map counts what the cards show,
  recorded states included, so a target Setup recorded behind is updated before its card looked (both found by the
  e2e). A release recorded or installed elsewhere is shown undated ("Installed: {release}."). The cards send their
  records one after another, and `setup.recordCloud` keeps a stored target record checked later than the reported one
  (two records of one card had landed out of order; `functions/src/setup/record-install.ts`, the installer's marked
  part). The cards' links and the GitHub disclosure are 48 px targets (the tour's checker at the compact and medium
  windows).
- **71d APPLIED: Home's installation tile** (`home.update-tile`): a target recorded `failed` first, else one recorded
  `updateAvailable`, with the link to its Setup step (`adminSetup.install.tileOpen`). The tile names no release: Home
  has no token and no bundle to compare with; the card does.
- **71e APPLIED (the pre-approved kind: stricter): two gates of the build stage.** `install-build` (after
  `hosting-build`: the bundle from the stage's own builds) and `install-budget` (`check_bundle_budget.py --install`:
  each tarball as served against the contract's ceilings, `server.tgz` 8,000 KB, `pipeline.tgz` 1,000 KB, `hosting.tgz`
  80,000 KB).
- **71f APPLIED: the e2e world.** The fake Cloud Build plays each build by scenario (no step runs) and changes the world
  as a real build would; new scenarios `cloud-build.installerAccount` (the installer's account of a map prepared in an
  earlier session), `cloud-build.siteOlderRelease`, and the preset `install.provisioned`. The specs wait for the
  submitted build before they move it on (a scenario applied before the browser's POST found no build), reopen a card
  after its step turns done (the page moves on), write the published manifest only once the seeded city's own build
  has ended and with the publisher's stamp (`seedPublishedMap`: an unstamped record made the publish trigger's
  retries hold `manifests/{city}`, and every later reset failed), and end only when no `setup.recordCloud` is under way
  (`recordsSettled`). Lessons 266–270.
- **71g APPLIED: the input budget.** `updateMap` (1 input; one consent in daily use) joins `CONTENT_INPUT_BUDGETS`; the
  steps' budgets are those of §6.2.
- **71h For the user (UNVERIFIED until the first real install, §9 of the contract):** that Cloud Build and Cloud
  Logging answer a browser's bearer request (CORS), the installer's role set, the build minutes, and the docker
  builder's digest (§67e: until then the live pipeline card says it is not available in this release). `setup.status`
  does not answer `serverRelease` (contract §1.7): Home reads the records, and Setup reads the functions' release from
  Cloud Functions; adding it needs no new input.

- **71i APPLIED 2026-10-31 (§74e; the user approved the dependency update and the `re2js` fix): the `npm-audit` gate fails on a new advisory.** GHSA-gg6h-894w-4m9c
  (high: quadratic-time matching in `re2js` 2.2.0–2.8.6, which `markdownlint` ≥ 0.42 and so `markdownlint-cli2` ≥ 0.24
  pull in) appeared after the M6 contract's run; the image's npm cache holds only `re2js` 2.8.6. The fix is an `overrides`
  entry pinning the first patched `re2js` release (exact version from the advisory at the time), installed with the
  digest-pinned `node:24-bookworm-slim` as `docs/SETUP.md` → *npm in a container* says, then `npm audit --audit-level=low`
  clean; `npm audit fix --force` would instead downgrade `markdownlint-cli2` (a breaking change) and is not the fix. No
  workstream code is involved; every stage's other gates were green on the installer's tree.

Verify: Vitest `shared`, `admin`, `ui` and `tools` for the installer's files; pytest `scripts/ci/tests`; Playwright
`admin/steps/install` at `admin-steps-l1440-en` and `admin/specs/install` at the admin projects, inside the image; the
split stage is the integrator's.

## 72. The M6 integrator: the change requests closed, the whole Setup with no terminal, the local stack's bundle, and what waits for the user (2026-10-30) — 72a and 72b APPLIED (product, test, tooling and documentation changes within `docs/research/M6-interfaces.md`, closing CR-M6-11, CR-M6-13, CR-M6-17, CR-M6-18 and CR-M6-22; no configuration of the ask-first kinds, no gate relaxed, no budget raised, no checker allowlist entry, no download); 72c APPLIED 2026-10-31 (§74); 72d for the user, ask first

- **72a APPLIED: the whole Setup with no terminal** (`e2e/admin/specs/journey.spec.ts`, S-A30-HAPPY-NO-TERMINAL and S-A30-BAD-TOKEN-EXPIRED, rows `exists`; S-A30-HAPPY's count is 11 inputs since M6). From sign-in in start-up mode to the public map at the e2e Hosting root showing the 45 photos the emulated server published (`servePublishedMap`), against the fakes, with USGS done later. It found two product bugs, fixed with their unit tests (and the split run a spec of A60 that read Home's live list once, lesson 275): Publish the map stayed off once the tab's Google token no longer granted Google Cloud (`InstallerPort.localBlocker`, lesson 273), and the admin's `ready` ignored the install part `setupDone` has (lesson 274). The bad row publishes two hours after Prepare the project: one consent from the same click, nothing asked again. The first split `quality` also failed A60's two specs (`e2e/admin/steps/billing-trial.spec.ts`: Home's list read once, with the installer's update tile of another behaviour in it); the spec now polls the list and counts its own kinds (lesson 275).
- **72b APPLIED: the change requests the integrator held.** CR-M6-17's second part: New city's done screen and Settings → Publishing show the city's public address, `https://<origin>/<id>/` from the admin's own origin (the same Hosting site; `packages/ui/src/admin/cities/public-address.ts`), and their texts no longer name `npm run site:add`. CR-M6-22: `firebase/rules-tests/test/firebase-config.test.ts` reads the admin's headers from `**` and `/admin/**`, pins `public: dist/hosting` and that no CSP goes to every path. The local stack serves its admin's install manifest for the e2e tree's release (`e2e/stack/servers.ts`, the manifest from `e2e/fixtures/install-bundle.ts`), so `HCM_STACK_SEED=fresh` rehearses Install the server and Publish the map, a build ending on the fake's `cloud-build.finish`. The documents and agent assets of CR-M6-11, CR-M6-13 and CR-M6-18: `docs/MANUAL_TEST_PLAN.md` (Setup lists no terminal command; D1 is the one terminal deploy, with `build:install`; D2, D3, D5, D7 the terminal fallback; how the Bucharest project moves the admin to `/admin/`), the admin guides, ARCHITECTURE (the installer), TESTING, CI_PIPELINE, the skills and their mirrors, lessons 271–274, `docs/research/M6-status.md`.
- **72c APPLIED 2026-10-31 (§74e: `"re2js": "2.9.1"` in the root `overrides`; the user approved the dependency update and the `re2js` fix): the `npm-audit` advisory of §70l and §71i.** GHSA-gg6h-894w-4m9c (`re2js` 2.2.0–2.8.6 through `markdownlint-cli2@0.24.0` → `markdownlint@0.42.0`). The image's npm cache holds only `re2js` 2.8.6 (checked offline, 2026-10-30), so neither an override nor the hold of `markdownlint-cli2` at 0.23.3 is possible without a download. The fix: an `overrides` entry `"re2js": "<first patched version>"` in the root `package.json`, installed with `npm install` in the digest-pinned `node:24-bookworm-slim` image (`docs/SETUP.md` → *npm in a container*), then the quality image rebuilt and `PIPELINE_STAGE=static` green; never an allowlist. It is the only failing gate of `static`, `quality` and `all`.
- **72d For the user, ask first, one at a time** (`docs/research/M6-status.md` §3): D1 with the M6 tree (the one terminal deploy: the admin at `/admin/` with its install bundle), then in the app Prepare the project again, Update the map, Replace the visitors' token (or the next tick), Publish the map and Check again.

Verify: `PIPELINE_STAGE=static`, `tests`, `build`, then `PIPELINE_STAGE=quality bash scripts/ci/e2e-split.sh` (quoted in `docs/research/M6-status.md` §1).

## 73. The M6 reviews' fixes: the admin's sign-in kept in its tab, the installer's guards, the live map's upgrade path and minimum input (2026-10-30) — 73a APPLIED for review (a product choice, reversible in one line: the user decides); 73b–73i APPLIED (product, test and documentation changes; no configuration of the ask-first kinds, no gate relaxed, no budget raised, no checker allowlist entry, no download); 73j PROPOSED, NOT APPLIED (a product decision); 73k recorded; 73m APPLIED 2026-10-31 (§74); 73j, 73k and 73l APPLIED 2026-11-01 (the user's decision, §80)

- **73a APPLIED for review: the admin's Firebase sign-in lives in its tab's `sessionStorage`** (security-cost finding 1). Since M6 the public map and the admin share one origin, and `getAuth` kept the owner's refresh token in the origin's IndexedDB (`firebaseLocalStorageDb`), which any script on a viewer page could read and use to call the owner-only callables. `packages/admin/src/firebase/app.ts` now creates Auth with `initializeAuth(app, { persistence: browserSessionPersistence })`, the popup's resolver passed with each popup (`adapters.ts`; Node's build of `firebase/auth`, which the entry's tests load, has none). The trade-off, for the user: one sign-in per tab (a reload keeps it; a new tab, or a notification's link, asks once more: one click on an already signed-in Google account). Reverting is one line (`browserLocalPersistence`), with the risk above. The admin's `hcm:admin:*` `localStorage` keys hold no secret and no authority: each is a preference read through a fixed parser (the language, the theme, the analytics consent, the city last chosen), so a same-origin script forging one gains nothing it could not do itself. The e2e tier signs a persona in through an init script that fills the admin tab's `sessionStorage` (`e2e/admin/support/session.ts`), only under `/admin/` and the harness page, so a viewer page of the same context starts with nothing (S-A58-HAPPY-SIGN-IN-IN-TAB, S-A58-BAD-VIEWER-READS-NO-SIGN-IN); the content specs take an option `signedIn` for a signed-out tab, and S-A25-BAD-RELOAD-KEEPS-STEPS checks the app's own `sessionStorage` record apart from Firebase's session (lessons 284, 285). A header CSP with enforced Trusted Types on the viewer's paths stays a possible next step (the viewer's meta CSP and Mapbox's SRI already apply). **Since §210 (the owner's decision of 2026-11-13) this holds only without the admin's own site**: served from `https://<project>-admin.web.app/admin/` the admin keeps the sign-in in that origin's IndexedDB, one sign-in for every tab.
- **73b APPLIED: an older admin never replaces a newer server, complete or not** (security-cost finding 2). `InstalledInfo` carries the newest release any deployed function or job names (`newest`) and whether part of the target is there (`partial`); `deriveInstallState` says `newerInstalled` whenever `newest` is newer than the bundle, before completeness, so the `--force` deploy of an older release can no longer delete a newer one's functions (S-A55-BAD-DOWNGRADE-INCOMPLETE, unit tests in `model.test.ts` and `cloud-build-installer.test.ts`).
- **73c APPLIED: viewer origins checked before a token is minted, and a minted token the city cannot hold deleted** (security-cost finding 3). `runtimeConfig` refuses `HCM_VIEWER_ORIGINS` that are not at most 10 https origins without a path (`viewerOriginsOf`), `functions/build.mjs` refuses to build them (the same pattern as `httpsOriginSchema`, pinned by `functions/test/deploy-env.test.ts`), and `ops.tick`'s re-mint deletes the new token at Mapbox when the city's write fails (S-A06-BAD-ORIGINS-REFUSED, S-A06-BAD-UNRECORDED-TOKEN-DELETED).
- **73d APPLIED: the Hosting transfer of a publish is shown, and `server.tgz` is an allowlist** (security-cost findings 4 and 5). Publish the map's cost line says each publish moves about 52 MB of Hosting's free 360 MB a day (`SITE_PUBLISH_TRANSFER_MB`, UNVERIFIED like the build minutes; `M6-interfaces.md` §1.9's table counts it). The server's tarball carries only `index.js`, `package.json`, `package-lock.json`, `.env.<project>` and `export-kit/**` of `functions/dist`; anything else (a `.secret.local`, a `.env.local`) fails `build:install` (`scripts/site/test/install-bundle.test.ts`).
- **73e APPLIED: the live map's upgrade path** (min-input findings 1–5). The server card decides its button from the install's state, not from step (d)'s chip: Try again after a stopped update in an admin session; a server with functions present but incomplete (the live map's 61 of 69, no release) is `updateAvailable`, so Update the map and Home's tile appear after one look. A look on step (d) in an admin session leaves the claim (d2) done. Retry what failed runs every item when one was never reported (a record from before M6), so it makes `hcm-installer@` and its roles. The pipeline card has its own **Install the pipeline** once the server is there, and Update the map includes a pipeline not installed with nothing in its way. `setupDone` and the admin's `ready` count a target as installed while a release of it is recorded, whatever its build does; a passing `unavailable` is never recorded. Rows S-A55-HAPPY-PRE-M6-UPGRADE, S-A55-BAD-UPDATE-FAILED-ADMIN, S-A55-HAPPY-DONE-WHILE-UPDATING, S-A04-BAD-PRE-M6-RECORD, S-A56-HAPPY-INSTALL-ALONE; the tour's `setup.install-update` checks the claim, and `setup.pipeline-install` is a new state.
- **73f APPLIED: "This account is a free trial"** (min-input finding 6, finding 18 of 2026-10-25 for the live map). One click on the linked billing card, no consent: `setup.recordCloud` records the trial from today (in start-up mode the bootstrap record carries it to the claim), and a trial said after "It is a paid account" starts again from that day. It is an optional input outside the happy path's budget (S-A60-HAPPY-SAID-TRIAL; tour state `setup.billing-mark-trial`).
- **73g APPLIED: the copy and the cards' clutter** (min-input findings 7–10). The Mapbox console's link reads **Open the Mapbox console** with the payment advice in its hint; Do it later is not offered while a USGS token waits for approval (S-A59-BAD-NO-LATER-WHILE-PENDING); step (d) shows no function count before its first look nor beside a Done chip; "The button is off:" reads **Not available yet:** / **Încă indisponibil:**; the unused `adminSetup.install.site.needsServer` is gone; each install card has one cost line (the frame leaves an available install step's cost to its body); the not-available pipeline says the map works without it meanwhile; the not-provisioned blocker names Check again, then Retry what failed.
- **73h APPLIED (documentation): the consents the whole assistant asks** (min-input finding 11). The tab keeps one Google token, so Analytics' consent replaces Google Cloud's and Publish the map asks Google once more: `docs/MANUAL_TEST_PLAN.md` and `docs/research/M6-status.md` now say at most 11 inputs and 5 consents. Keeping one token per scope would save that consent; it is 73j.
- **73i APPLIED (documentation): the imagery pipeline is not installable from the app in this release** (min-input finding 3). The install bundle names no Docker builder digest (§67e, the user's decision), so requirement 2 holds for the server and the public map and waits on §67e for the pipeline; the plan and the status say so, with D5 as the pipeline's way in meanwhile.
- **73j APPLIED 2026-11-01 (user decision; §80c)**, originally PROPOSED, NOT APPLIED (a product decision): **one Google token per scope in the tab**, so the analytics consent no longer costs Publish the map a consent within the hour. It changes `packages/admin/src/auth/google-access.ts`'s single-token rule (memory only either way) and the journey's counts; for the user.
- **73l APPLIED 2026-11-01 (user decision; §80e: the entry below, as proposed, in `.gitleaks.toml`'s scope allowlist; `.gitleaks-history.toml` unchanged)**, originally PROPOSED, NOT APPLIED (a `.gitleaks.toml` edit; the fixer's session could not make it): **the emulators' logs out of `gitleaks dir`'s scope.** The fixer's second split `all` failed `static/gitleaks` on 3,200 findings in `firebase-debug.log`, the gitignored log the Firebase CLI writes at the root when an e2e run's emulators are stopped by Playwright rather than exiting by themselves; it holds the Auth emulator's generated test tokens, and the next run's `static` scans it. The fixer deleted the stray logs (`firebase-debug.log`, `firestore-debug.log`, `pubsub-debug.log`, all gitignored) before the third run. The proposed diff adds, to the scope allowlist of gitignored pipeline output that already lists `reports/` and `dist/`: `'''^(firebase|firestore|database|pubsub|storage|ui)-debug(\.[^/]*)?\.log$'''` (the names `.gitignore` ignores); `gitleaks-history` keeps no path allowlist. Ask first (it changes a gate's scope). Lesson 287.
- **73m APPLIED 2026-10-31 (§74e: `pyasn1` 0.6.5 in `pipeline/poetry.lock`, `"glob": "14.0.3"` in the root `overrides` and `functions/deploy-lock` refreshed; the user approved the dependency update): `pyasn1` 0.6.5 for the pipeline.** Published during the fixer's third run: CVE-2026-119194 to CVE-2026-119197 in `pyasn1` 0.6.4 (a transitive dependency of the raster pipeline, `pipeline/poetry.lock`), fixed in 0.6.5; `static/pipeline-pip-audit` fails on it. The fix is `poetry update pyasn1` in the image (a download), then the quality image rebuilt and `PIPELINE_STAGE=static` green; never an allowlist. Like §72c, for the orchestrator's approved dependency update. A later `static` run (2026-10-31) also found GHSA-3g3m-2fjr-6pw4 (`glob` 3.0.0–14.0.1, through `rimraf` and `gaxios`), which fails `npm-audit` beside §72c and now `deploy-lock-audit` (`functions/deploy-lock`): the same kind of fix, `overrides` and a lock refresh, a download.
- **73k APPLIED 2026-11-01 (user decision; §80d)**, originally recorded: **the legacy originals in every Hosting release.** `hosting.tgz` is mostly `/admin/legacy/` (45 MB of the old photos' originals, which step (h) imports). Keeping them out of the published site once the import is done would shrink each publish's transfer to a few MB; it changes what a later import can read, so it waits for the user.

Verify: `bash scripts/ci/e2e-split.sh` (stage `all`), quoted in `docs/research/M6-status.md` §1.

## 74. Dependency update 2026-10-31 — 74a–74e APPLIED 2026-10-31 (the user asked to update every dependency to its latest stable release, approved the downloads, the workflow pin edits and the `re2js` fix); 74f APPLIED 2026-10-31 (the user chose the vendored copy)

Every pin the `deps` stage reported behind, bumped in the pinned images (`docs/SETUP.md` → *npm in a container*; Python in the quality image), each exact.

- **74a APPLIED: npm.** `@axe-core/playwright` 4.13.0 → 4.14.0, `@playwright/test` and `playwright` 1.64.0 → 1.64.1 (the image installs the matching browsers), `@vitest/eslint-plugin` 1.6.27 → 1.6.28, `dependency-cruiser` 18.6.0 → 18.7.0, `eslint` 10.12.0 → 10.14.0, `firebase` 13.0.0 → 13.1.0 (admin, engine, rules-tests), `firebase-tools` 15.33.0 → 15.34.2 (also `FIREBASE_TOOLS_VERSION` in `@hcm/shared` and `create-historic-city`, so the install bundle's `tools/` lock and the self-host check follow, the tests, fixtures and every current command in the docs and skills; research records keep the version they observed), `google-auth-library` 11.2.0 → 11.3.2, `harfbuzzjs` 1.6.3 → 1.6.4, `html-validate` 11.16.2 → 11.17.0, `knip` 6.41.0 → 6.44.0 (and `knip.json`'s `$schema` URL, the "keeps a tool working" kind), `material-symbols` 0.48.0 → 0.48.2 (the icon subset rebuilt with `fonts:build`), `terra-draw` 1.38.0 → 1.39.0, `typescript-eslint` 8.71.1 → 8.72.1, `vite` 8.3.4 → 8.3.5, `zod` 4.6.6 → 4.6.7. The overrides moved with their packages: `@firebase/firestore@4.19.0` (the firestore of `firebase` 13.1.0, still `@grpc/grpc-js ~1.9.0`) → `@grpc/grpc-js` 1.14.7, `basic-ftp` 6.2.4, `katex` 0.19.1; `@opentelemetry/core` stays 2.12.0 (3.0.0 is a major its dependants do not accept). Two stale hoisted peers were deduped with `npm update` (`playwright-core`, `@firebase/app`; lesson 288).
- **74b APPLIED: Mapbox GL JS 3.32.0 → 3.34.1.** The e2e devDependency, `MAPBOX_GL_VERSION` (engine, ui, site build), the starter kit's `integrity` values (`sha384-bRGpP2/…` for the script, `sha384-QWCpuitI…` for the stylesheet: computed from the files api.mapbox.com serves for v3.34.1, downloaded for that alone, and equal to the npm release's), the tests' URLs and every current doc, skill and comment. 3.33.0's breaking changes (the RTL text plugin API removed, icon sizes in `text-field` measured at the tile zoom) touch nothing the engine calls; the attribution rules `attribution-colour.test.ts` copies are unchanged in 3.34.1's `mapbox-gl.css`. The e2e tier (the orchestrator's split run) is the check of the real library.
- **74c APPLIED: Python.** `scripts/ci/requirements.txt` (regenerated in a fresh venv of the image): ruff 0.17.3, mypy 2.4.1, pytest 9.2.0, coverage 7.17.0, check-jsonschema 0.39.0, and transitively ast_serialize 0.13.1, certifi 2026.10.23, filelock 4.2.5, msgpack 1.2.4, platformdirs 4.14.0, pluggy 1.7.0. `pipeline/requirements-poetry.txt` (Poetry 2.5.1 in a fresh venv): certifi, distlib 0.4.4, dulwich 1.2.20, filelock 4.2.5, installer 1.1.0, more-itertools 11.2.1, msgpack 1.2.4, pbs-installer 2026.10.25 (which now takes `httpx2` and `httpcore2` 2.16.0, Pydantic's maintained fork, and `truststore` 0.10.5, replacing `httpx` 0.28.1 and `httpcore` 1.0.9 in that set), pkginfo 1.13.3, platformdirs 4.14.0, pycparser 3.12, python-discovery 1.9.0, tomlkit 0.15.2, virtualenv 21.15.2. `pipeline/pyproject.toml`: google-cloud-storage 3.17.1; dev pytest 9.2.0, coverage 7.17.0, hypothesis 6.170.14; `poetry lock --regenerate` in the image, which also took `pyasn1` 0.6.5 (§73m) and google-api-core 2.43.2, google-auth 2.62.0, grpcio and grpcio-status 1.85.1, googleapis-common-protos 1.76.0, opentelemetry-api 1.45.2. New holds: `findpython` 0.8.0 and `pkginfo` 1.13.3 (Poetry 2.5.1, the latest, requires `findpython <0.9.0` and `pkginfo <2.0`), in `HELD` and `docs/CI_PIPELINE.md`.
- **74d APPLIED: images and actions.** `docker/dockerfile` 1.27.1 → 1.28.0 (`@sha256:bb22d981…`, both Dockerfiles), `sonarsource/sonar-scanner-cli` 12.2.0.4256_8.1.0 → 12.3.0.4285_8.1.0 (`@sha256:47956b66…`, Dockerfile.quality and `scripts/ci/sonar_scan.sh`; still SonarScanner CLI 8.1.0.6389), digests read from Docker Hub's index manifests. Actions by the tag's commit (`gh api`, annotated tags dereferenced): `SonarSource/sonarqube-scan-action` v8.4.0 `4d1dc0c9…`, `docker/login-action` v4.7.0 `81c6f93d…`, `github/codeql-action` v4.39.1 `9b325408…`, each with its `# vX.Y.Z` comment.
- **74e APPLIED: the advisories.** `"re2js": "2.9.1"` (GHSA-gg6h-894w-4m9c, fixed in 2.8.7; §70l, §71i, §72c) and `"glob": "14.0.3"` (GHSA-3g3m-2fjr-6pw4, fixed in 14.0.2; §73m) in the root `overrides`. Every `glob` dependant calls `glob`, `sync` or `globSync`, which 14 keeps; `firebase-tools`' `listFiles`, `archiver`'s glob and `exegesis` were run against it offline before the gates. `functions/deploy-lock` refreshed with `node functions/deploy-lock.mjs` (0 vulnerabilities). `pyasn1` 0.6.5 (§73m) in 74c. `deploy-lock-audit`, `pip-audit` and `pipeline-pip-audit` pass.
- **74f APPLIED 2026-10-31 (the user chose the vendored copy, and approved reading the advisory and fetching minimatch 11): GHSA-g3hv-75wg-m249, `minimatch` below 11.0.1** (published 2026-10-30 23:09 UTC, moderate). The advisory as first recorded: the vulnerable `firstPhasePreProcess` was only in the 10.2.6 copy (`eslint`, `@eslint/config-array`, `@typescript-eslint/typescript-estree`, `eslint-plugin-sonarjs`), while `firebase-tools`' 3.1.5, `readdir-glob`'s 5.1.9 and `superstatic`'s 6.2.3 were in the range too; 11's CommonJS entry is not callable and `firebase-tools` (`lib/fsAsync.js`) and `superstatic` (`lib/utils/patterns.js`) call `require('minimatch')(path, glob)`, so a plain `overrides` to 11 would break `firebase deploy` and the emulators. What was done:
  - `vendor/npm/minimatch` (its README): minimatch **11.0.3**, the latest release (above the first patched 11.0.1, and already in the tree under `glob` 14, so its tarball came from the image's npm cache with the lockfile's integrity; SHA-256 `175b2fd9…e8ae` in the README), upstream's `dist/commonjs` and `dist/esm` byte for byte as `commonjs/` and `esm/` (no source maps; not `dist/`, which `.gitignore` and the checkers skip), version `11.0.3-callable.1`. `index.cjs` exports 11's own `minimatch` function with every named export of 11 on it (`minimatch`, `Minimatch`, `filter`, `match`, `braceExpand`, `escape`, `unescape`, `defaults`, `sep`, `GLOBSTAR`) and `default`; `index.mjs` re-exports 11's ES module and adds the function as the default export. Nothing of 11 is re-implemented: no dependant uses `makeRe` or `regexp` (each dependant's code searched).
  - Wired as `braces`: the root devDependency `"minimatch": "file:vendor/npm/minimatch"`, `"minimatch": "$minimatch"` in the root `overrides`, `package-lock.json` refreshed in the pinned Node image (every copy, `glob`'s 11.0.3 included, is now the one link; `concat-map` and the old `brace-expansion` and `balanced-match` copies left the tree), `COPY vendor/npm/minimatch` in `docker/Dockerfile.quality` and its `.dockerignore` line, and `knip.json`'s `ignoreDependencies` gains `minimatch` (used through `overrides` only: the pre-approved "keeps a tool working" kind). `functions/deploy-lock` is unchanged: `deploy-manifest.mjs` leaves `$name` overrides out and its tree already locks the registry's 11.0.3. `npm audit --audit-level=low` and the deploy lock's audit: 0 vulnerabilities.
  - The install bundle (`scripts/site/src/install/tools-lock.ts`, `bundle.ts`): its `tools/` lock is cut from the root lockfile, so it now follows the link to `vendor/npm/minimatch`, carries the folder as `tools/vendor/npm/minimatch/`, and `tools/package.json` names the same `file:` dependency and the root `overrides` (a `$name` only when `tools/` has that dependency). Checking it with an offline `npm ci` found that `tools/package.json` never had the overrides: npm re-resolved `@opentelemetry/core` (`ENOTCACHED` offline; out of sync with the lock online), so the installer's `npm ci` could not have installed the locked tree since the overrides existed (lesson 292). With both changes `npm ci --offline` of the generated folder installs 598 packages and `npm ls minimatch` shows the one vendored copy.
  - Verified offline in the quality image: the old copies and the vendored one agree on 876 calls in the dependants' own shapes (superstatic's `minimatch(url, source)` on every `source` of `firebase.json`'s rewrites, redirects and headers; `fsAsync`'s `{ matchBase: true, dot: true }` and the functions emulator's `**/<ignore>` on every `ignore` of `firebase.json`; `readdir-glob`'s `Minimatch` options; ESLint's absolute and partial matches); `npm ls minimatch` shows the one vendored copy under every dependant; ESLint over the repository (`static/eslint`), the emulators (`tests`: the rules project under `firebase emulators:exec`), `firebase-tools`' `readdirRecursive` with the functions' `ignore`, superstatic's `configMatcher` on `firebase.json`'s sources, an `archiver` zip with a `readdir-glob` pattern and ignores, the Hosting emulator over the built tree (`/admin/install/<slug>/manifest.json` gets `no-cache`, `/admin` its 301, `/admin/index.html` the admin CSP), and the built `server.tgz`'s `tools/` installed with `npm ci --offline` (598 packages, `firebase --version` 15.34.2, `readdirRecursive` over `functions/dist`).

Breakages fixed (lessons 288–290): an order-dependent `functions/test/index.test.ts` (since M6 three other files load `src/index.ts` with another bucket; now all agree); the duplicate `playwright-core` and `@firebase/app`; typescript-eslint 8.72's `no-deprecated` on `MountEnvironment.document` (now a two-method port, `packages/engine/src/mount.ts`) and on `dns.lookup`'s `verbatim` (`order: 'verbatim'`, `functions/src/adapters/remote-files.ts`); `scripts/site/test/notices.test.ts` expects the installed `material-symbols` 0.48.2. Holds kept: `typescript` 6.0.3 (`typescript-eslint` 8.72.1 still peers `<6.1.0`), `@types/node` 24.x, `mando` 0.7.1, `node:24-bookworm-slim`.

Verify: `PIPELINE_STAGE=deps` (holds only), `static` (all but 74f; with 74f, all), `tests`, `build`; the split `all` is the orchestrator's.

- **74g APPLIED 2026-10-31: `@axe-core/playwright` held at 4.13.0** (part of 74a undone, no download: the lockfile's three axe entries are those of before §74, which `npm install --package-lock-only --offline` in the pinned Node image leaves unchanged, and `node_modules` took the two 4.13.0 packages from a checkout installed before §74). The split `all` after §74 failed 46 Playwright tests on axe's `target-size` and `color-contrast` with nothing on the page changed: `axe-core` 4.14.0 leaves slotted content of a scrolling shadow-root pane out of that pane's grid, so its hidden part "covers" what lies under the pane (lesson 294, with the ten-line page that fails on 4.14.0 and passes on 4.13.0). A `HELD` entry and the *Held dependencies* row name it; `@hcm/test-support`'s own `axe-core` stays 4.14.0 (its component tests never scroll a slotted pane). The image's npm layer rebuilds from the new lockfile on its next build. Lift the hold when an `@axe-core/playwright` release brings an `axe-core` whose `findScrollRegionParent` follows the flattened tree again: the ten-line page of lesson 294 passing is the check.

## 75. The live test of 2026-10-31: the installer's actAs on the App Engine default account, an admin newer than its server, the old links on a hash change, and the per-tab sign-in (2026-10-31) — 75a, 75b (the user's decision, 2026-10-31) and 75d–75f APPLIED (product, test and documentation changes; no configuration of the ask-first kinds, no gate relaxed, no budget raised, no checker allowlist entry, no download; 75b changes the live project only when the owner runs step c again); 75c REJECTED 2026-11-01 (the user's decision: the admin stays at `/admin/`, the per-tab sign-in of §73a stays); 75g APPLIED 2026-10-31 (the user's decision, "Act-as + narrow its role"; changes the live project only when the owner runs step c again) and 75h APPLIED (finding 31); 75i–75k APPLIED 2026-11-01 (findings 29, 32 and 34: product, test and documentation changes; no configuration of the ask-first kinds, no gate relaxed, no budget raised, no checker allowlist entry, no download)

The source: findings 25–28 of `docs/research/manual-test-2026-10-25.md` → *Live test 2026-10-31 (M6 admin)*.

- **75a APPLIED (the user's decision, 2026-10-31: "Code fix first, live later"): the installer may act as the App Engine
  default account, on that account only** (finding 28). `firebase-tools` 15.34.2 checks before any functions deploy that
  the deploying account holds `iam.serviceAccounts.actAs` on `<project>@appspot.gserviceaccount.com`
  (`checkServiceAccountIam`, `lib/deploy/functions/checkIam.js`, called from `lib/commands/deploy.js`; a check that
  errors, as for a missing account, is skipped), and the live install stopped there. Provision's `iam` item
  (`packages/admin/src/provision/resources.ts` `appEngineBindings`, `items-iam.ts` `appEngineDefault`) now reads the
  account (`IamClient.serviceAccountExists`, a GET; 404: nothing to grant, not a failure) and binds
  `roles/iam.serviceAccountUser` for `hcm-installer@` in that account's own policy, never in the project's. The custom
  role `hcmInstaller` gains `cloudfunctions.functions.setIamPolicy`, which `checkHttpIam` (`lib/deploy/functions/deploy.js`)
  requires on the project before a deploy creates an HTTPS function (`roles/cloudfunctions.developer` lacks it; gen 2's
  invoker itself goes through `run.services.setIamPolicy`, already in the role, so the installer gains no new power over
  who may call a function), and the read-only `datastore.databases.getMetadata` and `storage.buckets.get`, which
  `ensureTriggerRegions` (`lib/deploy/functions/triggerRegionHelper.js`) needs before every functions deploy to read the
  Firestore database's and each Storage trigger's bucket's region (a refused bucket read stops the deploy). A stopped
  server build whose log names either check marks step c's `iam` item to run again (its row names the reason), and its
  card offers **Retry what failed in step c** (that item only), then Try again; step c's chip is left as it is, since
  steps d onwards wait for it and the card that explains must stay open. The e2e fakes model the account and
  its policy, and the fake Cloud Build's server build stops at `functions` with `firebase-tools`' own lines without the
  grant. The full list of what `firebase-tools` checks before a deploy, against the installer's roles: lesson 298.
  - **The security trade-off**: on most projects the App Engine default account holds `roles/editor` on the project
    (Google grants it when the App Engine app is made, as it grants the Compute Engine default account its own). Acting as
    it, the installer could reach Editor indirectly: a build or a function deployed to run as that account would run with
    Editor. The grant is the narrowest that satisfies `firebase-tools` (one account, one role), and nothing of ours runs
    as that account: every function names its own account (`fn-admin@`, `fn-events@`, `fn-crash@`), the raster job runs
    as `job-raster@`, and the builds as `hcm-installer@`. Since §75b Provision takes that Editor role away, so the actAs
    reaches no project role.
- **75b APPLIED 2026-10-31 (the user's decision: "do 75b"): Provision removes `roles/editor` from the App Engine default
  account on the project's policy.** Proposed as: since nothing of ours runs as it, a step of `iam` could remove that one
  binding, so 75a's actAs reaches nothing; risks: an App
  Engine app or another tool of the owner's that runs as that account would lose its access (Google's own guidance
  recommends it for production projects).
  - **What changed**: the `iam` item (`packages/admin/src/provision/items-iam.ts` `appEngineEditorHeld`,
    `dropAppEngineEditor`) reads the project's policy and, while `serviceAccount:<project>@appspot.gserviceaccount.com`
    is a member of its unconditional `roles/editor` binding, lacks `editor:<that member>`; its fix runs last, after the
    role table, and calls `removeBindings` (`packages/admin/src/google/iam-policy.ts`, sharing `ensureBindings`' loop:
    read, change, write with the etag read, read again on a 409 `ABORTED`, at most three writes). It removes that member
    from that binding only: every other member and every other binding as read, a conditional binding never touched, a
    binding left empty dropped. Nothing to do when the account is absent (the same GET as 75a) or the binding is. It is a
    part of `iam`, not a 17th item: step c's **Retry what failed** and the server card's **Retry what failed in step c**
    (75a: `iam` only) both cover it, and an older server, whose `setup.recordCloud` accepts the 16 ids of
    `PROVISION_ITEMS` only, keeps recording step c (75d's case). While the Editor role is all the item lacks, the doctor's
    result carries the reason `adminSetup.provision.appEngineEditor` (RO and EN: Retry what failed takes it away), shown
    on the row as the run reports it. Found on the way, not changed: a doctor's `missing` is never recorded
    (`provisionRequest` in `packages/admin/src/setup/provision.ts` drops every `missing` item, to skip the never-reported
    ones), so once Re-check's run is recorded the server's earlier state of such an item comes back (`ok`, or a failure's
    `invalid`): Re-check cannot show an item that regressed, for this part as for any item. Fixed since by §75k: a run
    records what it reported, `missing` included. A refused write fails
    the row with the role it needs (`apiError.cloud.permission`, `roles/resourcemanager.projectIamAdmin`). The fake
    project's policy gives Editor to both default accounts, as Google does, and the scenario
    `resource-manager.appEngineEditorLocked` refuses the removal (S-A04-HAPPY-APPENGINE-NO-EDITOR,
    S-A04-BAD-APPENGINE-EDITOR-REFUSED).
  - **The check that nothing of ours needs that account's Editor role** (the tree searched on 2026-10-31 for
    `appspot`, `appengine`, `app.yaml`, `serviceAccount`, `firebase-functions/v1`, `onSchedule`, `exportDocuments`):
    no App Engine service is deployed (no `app.yaml`; the App Engine app exists only as the project's legacy default
    bucket and location). Every function is gen 2 and names its account (`runAs` and `GLOBAL_OPTIONS.serviceAccount`
    = `fn-events@` in `functions/src/global-options.ts`; no `firebase-functions/v1`, whose default runtime account would be
    this one). Cloud Scheduler's jobs of `ops.tick` and `imagery.tick` carry the function's own account as their OIDC
    token (finding 11) and Cloud Tasks the enqueuer's (`fn-admin@`). No Firestore export exists. The raster jobs run as
    `job-raster@` (`scripts/site/src/install/steps/run-jobs.ts`). The in-app builds run as `hcm-installer@`
    (`packages/admin/src/install/build-spec.ts` `installerServiceAccount`), GitHub's deploys as `gh-deployer@` through
    Workload Identity Federation (`.github/workflows/ci.yml`), never as a default account. `firebase-tools`' own check
    (75a) asks for actAs on the account, not for any role of it, so the removal leaves the install as it is.
  - **Not the other default accounts** (superseded for the Compute Engine account by 75g, the next live finding): the
    Compute Engine default account `<number>-compute@developer.gserviceaccount.com` keeps its Editor role. Cloud Functions gen 2 and Cloud Run build the functions' images from source with it (or the
    legacy Cloud Build account) when the deploy names no build account, and Provision already binds its invoker and
    event-receiver roles (and the builder role when the organisation withholds the default grants); taking Editor away from
    it needs those builds' exact permissions first: out of scope, a later proposal if wanted. Nothing else is removed.
  - **The live project**: unchanged until the owner, after the next admin redeploy, runs step c again (its Retry what
    failed, or the server card's Retry what failed in step c); `docs/MANUAL_TEST_PLAN.md` says so.
- **75c REJECTED 2026-11-01 (the user's decision: "we don't want the admin on its own hosting site"; finding 26): the
  admin on its own Hosting site, instead of the sign-in per tab of §73a.** Nothing of it is built: the admin stays at
  `/admin/` on the map's own origin and keeps Firebase Auth in the tab's `sessionStorage` (§73a), one sign-in per tab.
  The proposal as it was written: Today the admin keeps Firebase Auth in the tab's `sessionStorage`, so the public viewer on the same
  origin can never read the owner's sign-in (the M6 security review's finding 1); the cost is a sign-in for every new tab,
  every notification link and Claude's own tab. The alternative: Firebase Hosting's multi-site, the admin at
  `https://<project>-admin.web.app/` with the normal local persistence (`indexedDB`), the public map alone at the root
  of `https://<project>.web.app/`. Its trade-offs:
  - **One more site**: `firebase.json` and `firebase.deploy.json` gain a second `hosting` target, `.firebaserc` a target
    map; Provision creates the site (`firebasehosting.sites.create`, the installer already holds
    `roles/firebasehosting.admin`); the site build makes two trees; the free tier is per project, so no new cost.
  - **The auth domain**: the web configuration's `authDomain` stays `<project>.firebaseapp.com` (the `/__/auth/handler`
    of the default site); the popup sign-in keeps working across sites, but the redirect flow would need the admin's own
    domain as `authDomain`, served by the admin site's `/__/` paths.
  - **OAuth redirect URIs and authorized domains**: Firebase Auth's authorized domains gain `<project>-admin.web.app`
    (and `-admin.firebaseapp.com`); the Google sign-in client's JavaScript origins the same; the consent stand-in of e2e
    and the local stack need a second origin.
  - **The CSP**: the admin's policy moves from a per-path header (`/admin/**`) to the admin site's whole site, and the
    viewer's root loses the `/admin/` exception; simpler, with one policy per site.
  - **App Check**: the reCAPTCHA Enterprise site key's allowed domains gain the admin site's domains (Provision's
    `app-check` item), or the admin gets its own key.
  - **The install bundle path**: `_ORIGIN` becomes the admin site's origin, and `hostingOrigins()` (the admin's check
    that its origin is one of the project's) gains the admin site's two; the site build's `hcm-site` target publishes the
    public site only, the admin site needing its own target (or one build publishing both).
  - **Old links**: `/admin/` on the public site and the root's `/#/…` addresses forward to the admin site (the root's
    `admin-redirect.js` gains the new origin); invitation and notification links already sent keep working through
    those forwards; the admin's push worker scope moves with it, so devices register again once.
  - **The viewer's isolation** stays: two origins share no storage, so the owner's sign-in is out of the viewer's reach
    by construction, which is what §73a buys today with the sign-in per tab. Effort: a contract change of
    `M6-interfaces.md` §2 and a new tier of the hosting tests; reversible.
- **75d APPLIED: an admin newer than its server** (finding 27). `sessionResponseSchema` reads a pre-M5 answer
  (`cities` defaults to none, `projectOwner` to false); a callable's answer the admin cannot parse is
  `apiError.serverOutdated` (`failed-precondition`, `packages/admin/src/firebase/adapters.ts`), which proves a server
  (the probe) and, for `admin.session`, leaves the decision to Google's ownership check as in start-up mode
  (`packages/admin/src/auth/controller.ts`); a `setup.status` the admin cannot read marks sign-in, server and claim done and
  every unchecked step **Update the server to check** (`adminSetup.state.unknown`, `SetupState.serverOutdated`), as do
  the steps only the record knows in start-up mode while the server reads as an update. The new API error code is the
  admin's own (no function throws it).
- **75e APPLIED: old admin links on a hash change** (finding 25): `admin-redirect.js` also forwards on `hashchange`.
- **75f Recorded: the admin's language with no saved choice** (the user's question of 2026-10-31). The admin follows
  `?lang=`, the stored choice, the browser's first language, then Romanian (`M2b-interfaces.md` §1.6), so an English
  Chrome sees English; PLAN's "default RO" is the fallback. Making Romanian win over the browser would be a one-line
  change of `resolveAdminLocale` and its tests: the user decides.

- **75g APPLIED 2026-10-31 (the user's decision: "Act-as + narrow its role"): the installer may act as the Compute Engine
  default account, which builds the functions; that account gets the Cloud Build builder role and loses Editor**
  (finding 33, Cloud Build f92cec75). With 75a in place the live install passed fetch, tools, packages, rules and
  indexes, the source upload and the Pub/Sub and Eventarc identities; then every function create and update failed:
  "HTTP Error: 403, Caller is missing permission 'iam.serviceaccounts.actAs' on service account
  `projects/-/serviceAccounts/<number>-compute@developer.gserviceaccount.com`. Grant the role 'roles/iam.serviceAccountUser'
  to the caller …". Cloud Functions gen 2 builds each function with Cloud Build as a build service account;
  `firebase-tools` 15.34.2 names none (`lib/gcp/cloudfunctionsv2.js` builds `buildConfig` from the runtime, the entry
  point and the source only), so Google uses the Compute Engine default account, and the API checks that the caller may
  act as it (not a check of `firebase-tools`'; lesson 298 listed only the tool's own).
  - **What changed**: the `iam` item (`packages/admin/src/provision/items-iam.ts`, `resources.ts` `buildAccountBindings`)
    reads the account (`IamClient.serviceAccountExists`, a GET; a 404 is nothing to do, as 75a's; the project number is
    `ProjectConfig.projectNumber`, as for the Pub/Sub service agent) and, in this order, after the custom roles and the
    role table: (1) binds `roles/iam.serviceAccountUser` for `hcm-installer@` on that account's own policy, never
    project-wide; (2) binds `roles/cloudbuild.builds.builder` for the account on the project; (3) removes the account
    from the project's unconditional `roles/editor` binding with 75b's helper (`removeBindings`: one member of one
    binding, the etag read, a 409 read again, at most three writes), one write per account, App Engine's first. A failed
    write stops the item, so (3) never runs before (2) is in place. The doctor lacks `build:serviceAccount:<account>`,
    `build:project:<project>` and `editor:<member>`; while these (and 75b's) are all it lacks, its reason is
    `adminSetup.provision.computeBuildAccount` (RO and EN; the App Engine one keeps `appEngineEditor`). The builder role
    was bound before only when the organisation withholds the default grants (`M2b-interfaces.md` §3.4.2); it is now
    bound whenever the account exists, so `roleTable` lost its `noDefaultGrants` argument. A stopped server build whose
    log names the 403 anywhere in its `functions` step (the card read only the last 20 lines, which are `firebase-tools`'
    summary of every failed function) marks `iam` to run again and offers **Retry what failed in step c**, then Try again
    (`fixedInProvision`, `install-flow.ts`). A refused removal fails the row with the role it needs
    (`apiError.cloud.permission`, `roles/resourcemanager.projectIamAdmin`), the actAs and the builder role in place.
  - **Why `roles/cloudbuild.builds.builder` alone**: it is the role Google documents for a user-specified build account of
    Cloud Functions gen 2 and Cloud Run source deploys ("Cloud Build Service Account"); the repository already relied on
    it for that account under the organisation policy (`M2b-interfaces.md` §3.4.1, `design-review-security-cost.md`).
    By Google's documented contents (not verifiable offline: no role definition ships in the repository or in
    `firebase-tools`, whose code mentions the compute account only for App Hosting and the service-agent bindings) it holds
    the build's source reads (`storage.objects.get`, `storage.objects.list`, `storage.buckets.get`), the pushes to the
    region's `gcf-artifacts` repository (`artifactregistry.repositories.uploadArtifacts`, `downloadArtifacts`,
    `createOnPush`) and the log writes (`logging.logEntries.create`), so neither `roles/logging.logWriter` nor
    `roles/artifactregistry.writer` is bound beside it. UNVERIFIED until the live install: if a build then fails on a
    permission, its log names it and the narrowest role holding it joins `M6-interfaces.md` §1.2.
  - **The trade-off**: acting as the compute account, the installer could reach that account's roles through a build or
    a function deployed to run as it; with Editor gone, those are the builder role (builds, the build's logs, Artifact
    Registry pushes, the source bucket) and 75b's first-deploy roles (`roles/run.invoker`, `roles/eventarc.eventReceiver`),
    narrower than the installer's own. Risk: an App Engine app, a Compute Engine VM or another tool of the owner's that
    runs as that account loses Editor (Google's own guidance recommends it for production projects).
  - **The check that nothing of ours needs that account's Editor role** (the tree searched on 2026-10-31 for `compute@`,
    `-compute`, `computeDefault`, `serviceAccount`, `runAs`, `buildConfig`, `firebase-functions/v1`): every function is
    gen 2 and names its account (`runAs` and `GLOBAL_OPTIONS.serviceAccount` = `fn-events@`,
    `functions/src/global-options.ts`; `fn-admin@` and `fn-crash@` per function), so no function runs as the compute
    account; Eventarc's triggers deliver with the function's own account; the raster jobs run as `job-raster@`
    (`scripts/site/src/install/steps/run-jobs.ts`); the in-app builds run as `hcm-installer@` (`packages/admin/src/install/build-spec.ts`
    `installerServiceAccount`), GitHub's deploys as `gh-deployer@`; nothing of ours creates a VM or an App Engine
    service. What the compute account still does for us: build the functions' images (the builder role) and, on a
    first deploy of an event type, invoke and receive events (75b's first-deploy bindings, kept).
  - **Fakes and rows**: the IAM fake gives every project the compute account (`computeAccount`, scenarios
    `iam.noComputeAccount`, `iam.computeActAsMissing`); the Resource Manager fake's `computeEditorLocked` refuses the
    removal; the fake Cloud Build's server build stops at `functions` (`failsAtComputeActAs`) with the API's 403 for each
    registry function and `firebase-tools`' summary after firebase-tools' own checks (75a's, then the discovery of
    finding 30), as the deploy meets them. S-A04-HAPPY-COMPUTE-BUILD-ACCOUNT, S-A04-BAD-COMPUTE-EDITOR-REFUSED,
    S-A55-BAD-NO-COMPUTE-ACTAS; lesson 301.
  - **The live project**: unchanged until the owner, after the next admin redeploy, reloads the tab, runs step c's Retry
    what failed (or the server card's Retry what failed in step c), then step d's Try again (`docs/MANUAL_TEST_PLAN.md`).
- **75h APPLIED: step (d) no longer waits for the imagery pipeline's repository** (finding 31). Install the server, its
  card's looks and the deployment's watch wait for `serverPrepared` (`packages/admin/src/setup/state.ts`: step c done,
  or every item but `PIPELINE_ONLY_ITEMS` = `artifact-registry` done), not for step c as a whole; the installer's writer
  role on `hcm` moved from the `iam` item's role table into the `artifact-registry` item (after `apis` and
  `service-accounts`), so `iam` no longer waits for it. The pipeline's card names the missing repository
  (`apiError.install.noRepository`) with a way back to step c; Setup is done only with c done, as before
  (S-A55-HAPPY-PIPELINE-ITEM-FAILED, S-A55-BAD-SERVER-ITEM-FAILED; lesson 302).

- **75i APPLIED 2026-11-01: the admin notices a newer release of itself** (finding 29: a tab left open across a Hosting
  redeploy ran the old admin, and its install build named the old release's bundle, which the redeploy had removed; the
  build stopped at `fetch` with "manifest.json is not the one the admin read"). `watchRelease`
  (`packages/admin/src/app/release-watch.ts`) reads `/admin/runtime.json` again with `cache: 'no-store'` when the tab becomes
  visible again (at most once a minute, `RELEASE_REVISIT_MS`), every five minutes while it is visible (`RELEASE_LOOK_MS`),
  and on demand (`check`); once Hosting serves another release it says so once and reads nothing more (cost: one file of
  a few hundred bytes every five minutes of a visible tab); a build without a release (`dev`, the e2e world's `e2e`)
  watches nothing; an unreadable file is no news. The shell's state gains `newRelease`, which puts up a polite status
  banner above the page, "A new version of the admin is ready. Reload the page to use it; you stay signed in." with
  **Reload** (`adminShell.update.*`, RO and EN; `packages/ui/src/admin/shell/shell-banners.ts`); it never blocks the page.
  The Cloud Build installer asks `newerAdmin()` before every submit (a click and the resubmit of a build Google ended)
  and refuses with `apiError.install.adminOutdated` (the newer release as `{release}`; the admin's own code, no function
  throws it) instead of submitting: the card says to reload, and the check itself puts the banner up. The sign-in lives
  in the tab's `sessionStorage` (§73a), so the reload keeps it; the Google token (memory only) does not, and the next
  Google action asks once. Clock and visibility are injected (`release-watch.test.ts`); the e2e moves the page's clock
  and fires `visibilitychange` as the browser does (lesson 299). S-A61-HAPPY, S-A61-BAD-INSTALL-REFUSED; tour
  `shell.new-release`; lesson 303.
- **75j APPLIED 2026-11-01: a step reads Checking… until its first check answers** (finding 32: right after a reload every
  chip read "To do", 0 of 11, until `setup.status` answered). Each step carries `firstCheck` (`packages/admin/src/setup/state.ts`),
  true in a fresh state; a patch with a check's time or a failure ends it (`withStep`), and the controller ends it in bulk
  (`withChecksAnswered`): in an admin session once the server's record is read or refused (every step but the legacy
  import), then after the import's own detection; in start-up mode once the tab's record is restored. The derived
  `loading` makes the header say "Checking every step…" over an indeterminate ring with no count, Check again off; the
  chip shows the loading indicator (a still icon with reduced motion) and **Checking…** / **Se verifică…**
  (`adminSetup.state.checking`). A busy step still says Working…. S-A03-HAPPY-CHECKING-AFTER-RELOAD,
  S-A03-BAD-CHECKING-STATUS-FAILS; tour `setup.loading`; lesson 304.
- **75k APPLIED 2026-11-01: Re-check of step (c) never downgrades it without a token, and records what it found both ways**
  (finding 34, and the gap of §75b). `packages/admin/src/setup/provision.ts`: a run records exactly the items it reported
  (`provisionRequest` over the run's reports in screen order), `missing` included, so an item that went back to missing is
  recorded so and the chip follows; an item Google refused with 401 (`adminShell.session.googleExpired`) is never recorded
  (an expired token says nothing about the item; before, a run recorded it `invalid`), and in Re-check (the doctor) its
  row keeps what it showed, the card offering Continue as before. Without a token, a closed consent leaves the recorded
  state and says "Last checked {time}; sign in to Google Cloud to check again" (`adminSetup.provision.lastChecked`; an ISO
  `time` parameter is written out in the page's language by `setupText`); another refusal keeps its own reason. Retry what
  failed reads a recorded `missing` item as never reported and reruns every item, which is idempotent.
  S-A04-BAD-RECHECK-NO-TOKEN, S-A04-HAPPY-RECHECK-RECORDS-MISSING; tour `setup.provision-last-checked`; lesson 305.

Verify: `static`, `tests` and `build`, and the touched Playwright specs in the quality image
(`docs/research/M6-status.md` §6).

## 76. Field measurements: Core Web Vitals and the apps' own timings in GA4, after consent (2026-10-31) — 76a–76e APPLIED (the user's request and decisions of 2026-10-31, the download of `web-vitals` approved; 76d a stricter dependency rule and new budget rows, 76e a build setting that keeps a gate green without raising its budget: the pre-approved kinds; no gate relaxed, no budget raised, no checker allowlist entry); 76f recorded for the user; its first option APPLIED 2026-11-01 (the user's decision, §80f)

The user's request (2026-10-31): "make sure we get all measurements from the field for improvements", in this release.
The full list of events, parameters, moments and reasons: `docs/ARCHITECTURE.md` → *Field measurements*.

- **76a APPLIED: the user's decisions.** (1) Core Web Vitals through Google's `web-vitals`, its attribution build,
  exact-pinned at the latest stable release, `6.2.3` (Apache-2.0; installed in the digest-pinned Node image as a
  dependency of `@hcm/engine` and `@hcm/admin`; `@firebase/performance` keeps its own `web-vitals@4.2.4` at the root,
  so npm nests ours under each workspace). (2) GA4 events only, after consent only, exactly like the events before: the
  hash-free `page_location`, Consent Mode v2, collection off at once on a withdrawal; no URL hash, no coordinates, no
  photo or place id beyond the unchanged `photo_open` and `poi_open`, no PII; the attribution's element as a short
  selector of the app's own elements only. (3) It ships in the same redeploy.
- **76b APPLIED: what is measured, and what is not.** The viewer: LCP, INP, CLS, FCP and TTFB (`web_vitals`) with
  their attribution's element, load state, interaction type and parts; the boot from the engine's start to the
  manifest, to the map's first render and to its first idle (`viewer_timing`, `performance.mark` and `measure` as
  `hcm:<phase>`); a failed manifest (`manifest_error`); no map, by reason (`map_unavailable`: no WebGL, a lost context,
  a failed style or WebGL, no container); the map's errors by kind (`map_errors`: the first at once, then the count at
  most every 30 s and at page hide, never one event per tile); a photo's click to its decoded thumbnail
  (`photo_timing`, through a new `hcm-photo-shown` event of `<hcm-photo-sheet>`); Compare to its second map
  (`compare_timing`); the `idle` event joined `MapPort` for it (one map per view unchanged). The admin: the same Core
  Web Vitals; the time to the signed-in shell (`admin_ready`); each Setup step's check (`setup_check`, `busy` on then
  off) and Check again (`step: all`); Provision per item (`provision_item`); each install build the admin saw running
  end (`install_build`: target, outcome, Cloud Build's own duration, the failing step's name, never a log line); every
  editor write (`editor_save`: area, operation, outcome, latency; `measuredStore` wraps the editors' Firestore, so no
  editor changed); a job seen unfinished that ends (`job_done`: from its `createdAt` to the admin seeing it). Every
  field measurement carries `app`, `window_class` and `release`. Sampled at 100 %: a page sends a few dozen events at
  most. **Deliberately not measured**: the hash, a coordinate, the map's view or zoom, LCP's resource URL (a photo's
  address), the URL of a soft navigation (it carries the hash; soft navigations stay off), script sources, element text
  or ids, e-mail addresses, user ids, a build's log, Firebase Performance Monitoring (still out of the viewer, §18a).
- **76c APPLIED: the privacy reasoning.** Every event of both apps (the old ones too) passes the guard of `@hcm/shared`
  (`packages/shared/src/telemetry/field-events.ts`, each app's own table: the viewer's guard knows no admin event and
  the other way round) in the consented chunk before `logEvent`: the name must be one of the app's events (GA4's 40
  characters), at most 25 parameters, each text at most 100 characters and without `?`, `#`, `@`, a number with four
  decimals or more or a `/z/x/y` tile path, the event's strict zod schema (an unknown parameter is refused), and the
  page's budget (300 events, 100 per name, `web_vitals` 15, `map_errors` 30, `exception` 10, …). A crash message that
  names coordinates still reaches Error Reporting redacted, but never GA4 (`S-V19-BAD-POSITION-NEVER-MEASURED`). The
  element of a metric is `shortTarget`: the nearest `hcm-` element (across shadow roots), then at most three inner tags
  with one class of the app's own form each; `page` for an element of an embedding page. Measurements made before
  consent (the boot's) wait in memory, at most 30, and leave only after a grant; a refusal or a withdrawal forgets them;
  web-vitals itself reads the page's buffered entries once it starts after consent. The consent texts say so: the
  banner's `consent.body` and the admin's account switch now name "usage and performance statistics" (RO and EN), and a
  new city's privacy text (`functions/src/cities/texts.ts`) says what is measured and that the position is not; the
  existing cities' texts are their owners' (Settings), `ADMIN_GUIDE.*.md` asks them to update theirs.
- **76d APPLIED: where the code lives, and the gates.** `web-vitals` is imported only by the lazy field chunks
  (`packages/engine/src/telemetry/field-sdk.ts`, `packages/admin/src/firebase/field-sdk.ts`), fetched with the Firebase
  SDK after consent; the new `.dependency-cruiser.cjs` rule `web-vitals-only-in-the-consented-chunks` makes that a gate
  (stricter: the pre-approved kind). `check_bundle_budget.py` has a `field-sdk` row for each app (9 KB; 7.3 KB and
  7.2 KB measured). The CSP needs nothing new: web-vitals reads the page's own Performance API and sends nothing itself;
  the chunk is served beside `engine.mjs` (`script-src` already names the engine's origin); GA4's hosts are unchanged.
  e2e: `e2e/specs/viewer/field-measurements.spec.ts` (`S-V19-HAPPY-FIELD-MEASUREMENTS` and four bad rows: nothing
  before consent or after Decline, nothing after a withdrawal, a position never sent, a tile-error storm capped), each
  received event validated with the viewer's own schema (`e2e/support/ga4.ts`). The admin's GA4 has no e2e world (the
  e2e web configuration names no measurement id), so its measurements are covered by the node tests
  (`packages/admin/test/app/field.test.ts`, `telemetry.test.ts`, `firebase/analytics.test.ts`).
- **76e APPLIED: the engine's CSS literals minified, so the IIFE keeps its budget.** The IIFE inlines every lazy chunk
  (§13a), so the field chunk (7.3 KB, 5.4 KB of it web-vitals) took `engine.iife.js` to 125.4 KB, over its 125 KB. The
  admin has minified the CSS of its Lit `css` templates since §36d (`cssLiteralsPlugin`, `scripts/site/src/css-literals.ts`,
  comments and indentation only, every line break kept); the engine's build now uses the same plugin, which takes about
  6 KB gzip out of the engine. Measured on 2026-10-31 (gzip, level 9), before → after: `engine.mjs` 97.7 → 93.9 KB
  (budget 100), `engine.iife.js` 117.2 → 120.1 KB (125), `compare` 4.6 → 4.2 KB, `firebase-sdk` 13.4 KB, `field-sdk`
  7.3 KB (new, 9); the admin's entry 362.7 → 364.5 KB (450), its `field-sdk` 7.2 KB (new, 9), all of it 601.3 →
  609.6 KB (620). No budget was raised.
- **76f recorded for the user: how to analyse, and later options; the custom definitions from the app APPLIED 2026-11-01 (user decision; §80f: Setup step g's Create the measurement reports).** GA4 shows the events by name after a day; the
  parameters need registering once as custom dimensions and metrics (`ADMIN_GUIDE.*.md` lists them), then Explore's
  free form gives `web_vitals` by `metric_name`, `window_class` and `release`. Later options, each its own decision: the
  provisioner could register the custom definitions itself (Analytics Admin `customDimensions.create`, a change to the
  owner's GA4 property: ask first); a BigQuery export of the GA4 property gives exact percentiles over long periods
  (free tier, a cloud change: ask first); sampling below 100 % if a city's traffic ever needs it.

Verify: `PIPELINE_STAGE=static`, `tests` and `build`, and the touched Playwright specs in the quality image
(`e2e/specs/viewer/field-measurements.spec.ts`, `consent.spec.ts`).

## 77. The live test of 2026-11-01, the editors: starter categories, legible lines on satellite, required fields that say what to do, named creations (2026-11-01) — 77a–77e APPLIED (findings 35–38 of `docs/research/manual-test-2026-10-25.md`: product, test and documentation changes; no configuration of the ask-first kinds, no gate relaxed, no budget raised (77e a new chunk with its own new budget row, the pre-approved kind), no checker allowlist entry, no download; `seed/bucharest/` unchanged)

- **77a APPLIED: starter categories (finding 35).** Where: a new city gets them from the server, in the transaction that
  creates it (`cities.create` and `setup.createCity`, `functions/src/api/starter-categories.ts`), so a city is never
  born without one; an existing city (the migrated Bucharest) is never changed behind its owner's back: its place
  editor offers them instead, one click, one batch from the admin (`packages/admin/src/pois/starter.ts`), the ids kept
  clear of its layers' (read once at the click) and categories'. What: five common kinds of a lost city's places,
  Clădire/Building, Stradă/Street, Piață/Square, Biserică/Church, Monument/Monument (`STARTER_POI_CATEGORIES`,
  `packages/shared/src/overlays/starter-categories.ts`); their icons are the icon guesser's answers for their labels
  (`domain`, `add_road`, the pin for a square, which no bundled icon names, `church`, `account_balance`; a test pins the
  two together); their colours the default sepia of a new category and four companion tones (blue, violet, brick, olive),
  each 5.5:1 or more against the white glyph. They are ordinary categories: renamed, recoloured or deleted in Settings.
  The editor's no-categories field also links to Settings' new category, where the unsaved-changes question guards a
  place being drawn.
- **77b APPLIED: POI lines and outlines legible on a satellite photo (finding 36).** A seventh layer per category,
  `hcm-poi-<id>-casing`: white, under the stroke, at 90 % of the overlay's opacity (`OpacityBase` `line-opacity` 0.9, so
  the overlay model scales it like every other paint property, 0 % included); the stroke 2/4/7 px and the casing 6/10/14
  px at zooms 12/16/20; the area fill 35 % (was 30 %). A white casing rather than a dark one: the category colours are
  dark by rule (the glyph's 3:1), so the stroke already reads on a light basemap and the white band is what a dark photo
  lacked. The casing shares the stroke's filter, so it also widens the click target of a line.
- **77c APPLIED: a required field says what to do (finding 37).** One table in the editing kit
  (`packages/ui/src/admin/editing/issue-text.ts`) maps a field's path and code to its own words (`adminContent.common.issue.*`:
  `title.ro`, `label.ro`, `name.ro` when empty, `category` for every problem, `geometry` when missing, `year` when not a
  number); every other problem keeps the viewer's validation words. Save's note (`adminContent.common.cannotSave`) names
  every field once, the own words first-letter-lowered in the sentence, any other as "{field}: {problem}" with the
  editors' field names; it replaces `adminContent.pois.cannotSave` and the photos' `editor.firstIssue`, which named only
  the first problem.
- **77d APPLIED: History names a creation (finding 38).** No schema change: a creation's name is derived in the admin
  from the next entry's `previous`, else from the document now (a one-time read per document, stopped at its answer,
  cached for the page's life), so an older admin and a newer server keep reading each other's entries.
- **77e APPLIED: a new named chunk, `editor-texts` (the bundle budget's rule for a new chunk, as §42a).** The required
  fields' own words (`issue-text.ts`, which every editor imports) took `editor-shared` to 13.3 KB gzip, over its 13 KB.
  Rather than raise that budget, the editors' words for a field and its problem (`field-names.ts`, `issue-text.ts`) are
  a chunk of their own (`packages/admin/vite.config.ts`, group `editor-texts`): 1.0 KB measured on 2026-11-01, budget
  2 KB (plus about 20 %, rounded up, in `scripts/ci/check_bundle_budget.py`); `editor-shared` is 12.4 KB, every other
  budget unchanged. A new budget row for a new chunk, no budget raised: the pre-approved kind.

## 78. The live test of 2026-11-01, the update check and Settings: a release order that follows the build, the consent note only with an action, the starter categories in Settings (2026-11-01) — 78a–78e APPLIED (findings 39–41 of `docs/research/manual-test-2026-10-25.md`: product, test and documentation changes; 78c the user's approved feature; 78d a new chunk with its own new budget row, the pre-approved kind; no configuration of the ask-first kinds, no gate relaxed, no budget raised, no checker allowlist entry, no download; `seed/bucharest/` unchanged)

- **78a APPLIED: every release has a total order that follows the build (finding 39).** The root cause was two-fold:
  a release had no order beyond its semver (`1.0.0` for every build; build metadata has no precedence), and Setup's
  cards and Home's tile showed a recorded state (`setup/status.install.*.state`, written relative to the admin that
  recorded it) as it was, so the live record "installed 1.0.0+9e2e6b5" stayed "installed" for the admin 1.0.0+457201e.
  The live look (Check again) did offer the update, since a different commit counted as older; but that same rule let
  an older admin replace a newer build of its own version, a hole in the downgrade guard of §73b.
  - **The build time**: the commit's time in whole seconds since 1970: `SOURCE_DATE_EPOCH` when set, else
    `/usr/bin/git show -s --format=%ct <commit>` (`scripts/site/src/admin/runtime.ts` `releaseTime`; an absolute path,
    as every command the builds run; none outside a checkout). Chosen over a build counter (no shared state across
    machines) and over the wall clock (two builds of one commit must be the same release, and the bundle stays
    deterministic). Carried beside the release everywhere it is recorded or compared: `runtime.json` `releaseTime`,
    `/release.json` `releaseTime` (`scripts/site/src/hosting/tree.ts`), the install manifest's `releaseTime`
    (`installManifestSchema`, nullable, checked against `runtime.json` by the admin and against `_RELEASE_TIME` by the
    `fetch` step), the functions' `HCM_RELEASE_TIME` (`functions/build.mjs`; `deploy-env.json` may not name it), the
    builds' substitution `_RELEASE_TIME` (used by `fetch`, so Cloud Build never refuses it as unused) and the pipeline
    jobs' label `hcm-release-time` (`run-jobs`), `setup/status.install.*.releaseTime` (`installRecordSchema`, optional).
    `INSTALL_FORMAT` stays 1: an admin only ever reads its own manifest.
  - **The order** (`compareRelease(installed, bundle, times)`, `@hcm/shared`): the version first; the same commit is the
    same release; else the later build time is newer; an installed build without a time (every record and server
    before this change) is older, so it is offered as an update and never counts as newer unless its version is
    higher; a timed installed build against an admin without a time counts as newer (an admin that cannot place itself
    never replaces a build that can); equal times of two commits count as older. Every installed part is compared this
    way (`cloud-build-installer.ts`: the oldest part is the target's release, the newest guards against a downgrade).
  - **Recorded states are read again** (`recordedState`, `packages/admin/src/install/model.ts`): a record's `installed`,
    `updateAvailable` or `newerInstalled` with a release is ordered against this admin's release and build time
    (Setup's `withRecordedInstall`, Home's `remindersOf` through `ContentServices.adminRelease`); a build under way or
    stopped, a record without a release and an admin without a release (`dev`, the e2e world's `e2e`) keep the record.
  - **An older server refuses a record naming a build time** (its `installRecordSchema` is strict): an admin session
    sends `releaseTime` only once the server itself names one (`install.ts`), so the records keep landing while the
    update to this release is under way. The self-host bundle of `create-historic-city` (§M5) names no time yet: its
    releases fall back to the commit rule (a different commit is an update).
- **78b APPLIED: Google's consent note only with an action that asks for the token (finding 40).** The note's rule was
  the step's scope and a live token (finding 7); every install card's scope is `cloudPlatform`, so an installed card in
  daily use (no token) showed the note above nothing. On an install card it now shows only while the card's body offers
  a button that asks Google (Install the server, Install the pipeline, Publish the map, Try again, Update the map:
  `installCardAsks`, `packages/ui/src/admin/setup/install-status.ts`), and beside Continue when a check needs the token
  again. Check again stays on every card and still opens Google's popup when the token is gone, without the note: the
  user's rule (the note goes with an action, or with Continue). Every other card keeps the rule of finding 7.
- **78c APPLIED (the user approved the feature): Settings → Place categories, Add the starter categories (finding 41).**
  For a city that already has categories (the place editor's offer of §77a covers a city with none): one click, one
  batch, only the starters whose label is not there (`missingStarterCategories`, `@hcm/shared`: a category's RO or EN
  label equal to a starter's RO or EN label after NFD, combining marks removed, lower case, trimmed spaces; "Clădiri" is
  not "Clădire"), the ids clear of the city's categories and layers (the layers read once at the click; a failed read
  writes nothing), after the city's own in order, as many as fit under `MAX_POI_CATEGORIES`; the snackbar says how many
  (`adminContent.settings.startersAdded`); with all five present the action is off with "Every starter category is
  already here" (`startersPresent`). The place editor's offer now writes only the missing starters too (the same
  `startersFor`), which matters only if categories arrive between its render and the click. The two new tour states
  are spread from `e2e/admin/specs/settings/states.ts` through `e2e/tour/admin-sections.ts` (`states.ts` is at its line
  limit, CR-M5-15).

- **78d APPLIED: a new named chunk, `starter-categories` (the bundle budget's rule for a new chunk, as §77e).** Once the
  settings imported the starters too, the starters' data and writes (`packages/shared/src/overlays/starter-categories.ts`,
  `packages/admin/src/pois/starter.ts`) became shared by two areas and took `editor-shared` to 13.3 KB gzip (budget 13),
  and the settings chunk reached 20.0 KB (budget 20). Rather than raise either budget, they and Settings' button
  (`packages/ui/src/admin/settings/starter-actions.ts`) are a chunk of their own (`packages/admin/vite.config.ts`, group
  `starter-categories`): 1.1 KB measured on 2026-11-01, budget 2 KB (plus about 20 %, rounded up, in
  `scripts/ci/check_bundle_budget.py`); `editor-shared` 12.4 KB, settings 19.5 KB, every other budget unchanged. A new
  budget row for a new chunk, no budget raised: the pre-approved kind.
- **78e found on the way, fixed: the GitHub disclosure's focus ring on the server card.** The tour states of 78a and 78b
  at 360 px found the `<summary>` of "Optional: install from GitHub Actions" with the browser's own focus ring, 2.16:1
  against the card (3:1 needed); the server card now carries the kit's `focusRing` (`hcm-setup-deploy.ts`).

Verify: `PIPELINE_STAGE=static`, `tests` and `build`, and the touched Playwright specs in the quality image
(`e2e/admin/steps/install/*.spec.ts`, `provision.spec.ts`, `status.spec.ts` at `admin-steps-l1440-en`, `journey.spec.ts`
at `admin-l1440-ro`, `e2e/admin/specs/install/states.spec.ts` for the new states, `e2e/tour/admin-settings.tour.ts`).

## 79. The live test of 2026-11-01, the editors, Setup, Jobs, Crashes and push: an untouched new place, a pipeline the bundle cannot install, where jobs come from, a burst of budget alerts, and why push did not start (2026-11-01) — 79a–79e APPLIED (findings 42–46 of `docs/research/manual-test-2026-10-25.md`: product, test and documentation changes; 79d a function's scaling option within the existing cap of five; no configuration of the ask-first kinds, no gate relaxed, no budget raised, no checker allowlist entry, no download; `seed/bucharest/` unchanged)

- **79a APPLIED: a new place is unsaved only once it differs from its start (finding 42).** `PoiDraft.unsaved` compares a
  new place's value with its first value; the category filled in after the categories arrive is `prefill`, which moves
  that start too (the select showed it as chosen, the admin did nothing); positions placed of a shape not finished yet
  (the vertex list's sketch) count in `PlaceEditor.unsaved`. A stored place is unchanged (its changed fields). Discard on
  a new place still returns to its start, now with the prefilled category. Left as it is: a line or an area being drawn
  on the map before it is finished lives in the map's drawing tool and does not count (UNVERIFIED as a live complaint;
  wiring the tool's sketch to the editor is a separate change).
- **79b APPLIED: whether this admin can install the pipeline is read from its bundle, without a token (finding 43).**
  `InstallerPort.localBlocker('pipeline')` reads the admin's own install manifest (its origin, no Google call) and says
  `apiError.install.notAvailable` while `tools.docker` is null (§67e still undecided); the install cards ask once, when
  they start following the pipeline, and before Install the server and Update the map, and keep the answer as the
  install slice's `pipelineOff`, apart from any record (a record keeps a target's state, not its blocker, which is how
  the live card offered its button). With `pipelineOff`, or the same answer from a look, the pipeline card shows "Not
  available yet: …" and no button (neither Install the pipeline nor Try again), so no consent note; the server's card
  drops "The same click also installs the historical imagery pipeline."; neither click submits the pipeline. A bundle that
  cannot be read says nothing (the look with a token still says why). Once §67e names a digest, the button comes back
  with no other change.
- **79c APPLIED: the Jobs page's empty state says where jobs come from (finding 44).** `<hcm-empty-state>` takes an
  optional `hint`, a second line, and a list's texts an optional `emptyHint`. The line names what makes jobs today
  (`JOB_TYPES`: imports of a USGS scene or a GeoTIFF, georeferencing or publishing a layer again, deleting a layer's
  tiles), all from Historical imagery; the finding's examples "reprocessing a photo" and "exports" make no job (the
  photo's reprocess is a callable, the export its own document), so they are left out rather than promised.
- **79d APPLIED: `ops-onBudget` scales to three instances of 80 concurrent requests, none kept warm (finding 45).** One
  instance refused deliveries that arrived while it started (Cloud Run 429), each a Crashes group, though Pub/Sub
  delivered them again. Three instances stay under every function's cap of five (`index.test.ts`), the concurrency of 80
  is the global option stated again where it matters, and no minimum instance keeps the cost of an idle month at zero;
  `retry: false` is unchanged (Google repeats budget alerts on its own; the 429s were redelivered by the push
  subscription regardless). The handler was already idempotent (the guard's transaction, the event id per period); a
  test now pins that three deliveries turn the guard red once and notify once. Live: the next server update.
- **79e APPLIED: why push did not start, and a stale FCM registration made again (finding 46).**
  - The registrar (`packages/admin/src/firebase/messaging.ts`) throws a `PushFailure` with a short code: the SDK's
    `FirebaseError.code` when it is a `messaging/…` or `installations/…` code, else its own (`push/no-service-worker`,
    `push/worker-registration-failed`, `push/no-installation-id`, `push/unknown`). The page shows "Notifications did not
    start: …" as before and, under it, a reason line per family (permission, registration, worker, unsupported,
    storage, installations, FCM refused, other) with the code; the log (`createLogger`) gets the code and the SDK's
    `errorInfo` with every word of 12 or more letters and digits replaced (`redactIds`): never a token, an installation
    id or an API key.
  - `notify.registerDevice` passes FCM's refusal on as `apiError.notify.deviceInvalid` with `reason` (the `FcmError`
    code, else the error's status, else `HTTP_<status>`) and logs it with the uid, never the token; the adapter's
    `validate` returns `{ ok, reason }`. An older server's refusal without `reason` reads as `fcm/UNSPECIFIED`.
  - On such a refusal (whatever the server's release) the admin forgets the SDK's record of the registration (IndexedDB
    `firebase-messaging-database`, store `firebase-messaging-fid-registration-store`, cleared; a database the SDK never
    made is not created: its creation is aborted) and registers once more, so `register()` makes the registration again
    with this worker's subscription; the record is also forgotten right after the root's worker of an admin before M6 is
    retired. One retry only: a second refusal is shown with FCM's code. The `e2e` build's stand-in hands out a new token
    after `reset` (`…-browser-0002`) and fails as the SDK does when the address asks (`?pushFail=<code>`); the fake FCM
    has `fcm.everyTokenGone`.
  - Checked offline against the project (findings' list in the manual-test record): the CSP's `connect-src`, the API
    key's referrers, the enabled APIs, the worker's scope, the SDK's seven-day record. UNVERIFIED until the next live
    try: which refusal it was, the auto-created key's API restrictions, the default VAPID key with `register()`.

Verify: `PIPELINE_STAGE=static`, `tests` and `build`, and the touched Playwright specs in the quality image
(`e2e/admin/specs/editing/drafts.spec.ts`, `e2e/admin/specs/pois/in-view.spec.ts`, `e2e/admin/steps/install/update.spec.ts`,
`e2e/admin/specs/install/states.spec.ts`, `e2e/tour/admin-jobs.tour.ts`, `e2e/admin/specs/notify/push.spec.ts`).

## 80. The user's decisions of 2026-11-01, "do all": the pipeline's builder, the drafts' model, a token per scope, the originals out of later publishes, the emulators' logs, the measurement reports — 80a–80f APPLIED 2026-11-01 (the user's decision in chat, the recommended option each; one network read approved: the registry read of 80a; 80d and 80f add budget rows and lower one, 80a extends the deps gate to gcr.io, 80e is the approved `.gitleaks.toml` entry: the pre-approved or approved kinds; no gate relaxed, no budget raised, no checker allowlist entry, no download; `seed/bucharest/` unchanged)

- **80a (§67e): Google's Docker builder pinned by digest.** The one approved read: gcr.io's anonymous tag list
  (`/v2/cloud-builders/docker/tags/list`) and `docker buildx imagetools inspect gcr.io/cloud-builders/docker:29`, no pull.
  The current line is the tag `29`, an OCI index of linux/amd64 (`sha256:59561410…`) and linux/arm64 (`sha256:530261ce…`),
  digest `sha256:6a6635024a23c8ed596c26fefc744bd3c5dbe269e8d8d541f2fda2beb0664ea5`; `latest` names `20.10.24`, which with
  `24.0.9` carries Google's `no-new-use-public-image` marker. Written as `DOCKER_BUILDER_PIN` (tag and digest, read by the
  deps gate) and `DOCKER_BUILDER_IMAGE` (digest only, the manifest's `tools.docker`) in
  `packages/shared/src/schemas/install.ts`, a test keeping them equal; `scripts/site/src/install/bundle.ts` writes it, and
  the build spec's golden pipeline, the admin's unit world and the e2e bundle use it. `check_dependency_updates.py` reads
  that file and gained a gcr.io reader (the anonymous tag list per manifest, leaving out every image Google marks
  `deprecated-public-image` or `no-new-use-public-image`): a tracked pin, no hold (a tool kept working: pre-approved). Rows:
  S-A56's notes. UNVERIFIED live: the push to `hcm` as `hcm-installer@` and the jobs' creation (`M6-status.md` §7).
- **80b (§67g): the drafts' model list.** `VERTEX_MODEL_IDS` = `gemini-3.5-flash-lite` (stable since 2026-07-21,
  retirement no earlier than 2027-07-21, per Google's Vertex AI model lifecycle page, as the user gave it),
  `gemini-3.1-flash-lite`. `functions/src/api/vertex-models.ts` (`withOfferedModel`): the models in order, a 404 moving
  to the next, the choice kept ten minutes per instance; every model 404 is `ModelsNotOfferedError`
  (`apiError.assist.modelUnavailable` naming both, its log line keeping the last 404). The self-test's `ai` check probes
  them with `countTokens` and is ok with `params.model`, shown as "Model in use: …" under the check; drafts name the model
  that drafted. The custom role needs no change (`aiplatform.endpoints.predict`); the price constant stays UNVERIFIED.
  Rows S-A45-HAPPY-FALLBACK-MODEL (functions), S-A45-HAPPY-MODEL-NAMED (e2e), S-A45-BAD-MODEL-UNAVAILABLE and the S-A45
  self-test and translate rows updated; lesson 318.
- **80c (§73j): one Google token per scope.** `GoogleAccessStore` keeps the user's tokens (memory only): a new one
  replaces those it supersedes (it may be used for every scope they may), `live` answers with the usable token that lives
  longest; a user change, a sign-out, a wrong account or a 401 still drops them all. The journey asks Publish the map no
  consent after the analytics consent and counts at most 4 consents (S-A30-HAPPY-NO-TERMINAL; its `- 1` allowance gone);
  `MANUAL_TEST_PLAN.md` and `M6-status.md` say 11 inputs and 4 consents again.
- **80d (§73k): the legacy originals out of later publishes.** The transfer is the build's download of the bundle, so
  the originals moved to their own tarball, `legacy.tgz` (the manifest's optional `files.legacy`); `hosting.tgz` keeps
  `photos.json` and `city.json`, which the import's detection and the city's creation read. A site build fetches and
  unpacks `legacy.tgz` (`HCM_FILES=…,legacy`, `HCM_UNPACK=legacy`) only while step (h)'s import is not complete
  (`legacyImportedCheck` over the importer's `detect`; an unreadable state keeps them); D1 and a fresh project keep them.
  The site card's transfer follows the import: `SITE_PUBLISH_TRANSFER_MB` 52, `SITE_PUBLISH_TRANSFER_TRIMMED_MB` 7
  (hosting 4.5 MB, server 0.8, pipeline 0.2 as served, measured by the build stage on 2026-11-01; 7 rounds up with the manifest and headroom). Budgets (stricter, pre-approved): `hosting.tgz`
  80,000 → 12,000 KB, `legacy.tgz` 60,000 KB new. Rows S-A57-HAPPY-PUBLISH-WITHOUT-ORIGINALS,
  S-A57-BAD-ORIGINALS-UNTIL-IMPORTED; lesson 317. A later import after a trimmed publish needs a publish made while the
  import is incomplete (which fetches them), or D1.
- **80e (§73l): the emulators' logs out of `gitleaks dir`'s scope**, the entry as proposed
  (`'''^(firebase|firestore|database|pubsub|storage|ui)-debug(\.[^/]*)?\.log$'''`) in `.gitleaks.toml`'s scope allowlist;
  `.gitleaks-history.toml` unchanged; lesson 287 updated.
- **80f (§76f): Create the measurement reports.** Step (g)'s new button (RO "Creează rapoartele de măsurători"): with the
  `analytics.edit` consent (asked on this click when the tab holds no live token of that scope), the admin finds the GA4
  property whose web stream sends the measurement id through the Analytics Admin API `v1beta` (`accountSummaries`, then
  each property's `dataStreams`), lists its custom dimensions and metrics and creates the missing ones: the dimensions
  `metric_name`, `metric_rating`, `debug_target`, `window_class`, `release`, `phase`, `step`, `outcome`, `area`, `target`,
  `error_kind`, the metrics `metric_value` and `duration_ms` (milliseconds) and `error_count` (standard), each event
  scoped with its parameter as display name; the card says how many were created and how many were there. Code in a lazy
  chunk (`packages/admin/src/google/analytics-reports.ts`, `analytics-reports`, 0.8 KB, a new budget row of 1 KB); the
  admin in all 619.9 of 620 KB in the build stage (no budget raised; the room left is 0.1 KB, so the next admin feature needs a saving first). The fake GA Admin API serves the summaries, streams and definitions
  (409 on a duplicate) with the scenario `analytics-admin.otherAccount`. Rows S-A22-HAPPY-MEASUREMENT-REPORTS,
  S-A22-HAPPY-REPORTS-AGAIN-NOTHING, S-A22-BAD-REPORTS-NO-PROPERTY, S-A22-BAD-REPORTS-PERMISSION; the tour state
  `setup.analytics-reports`. UNVERIFIED live: the API's answers on a real property.

Verify: `PIPELINE_STAGE=static`, `tests` and `build`, and the touched Playwright specs in the quality image
(`e2e/admin/steps/analytics.spec.ts`, `e2e/admin/steps/status.spec.ts`, `e2e/admin/specs/assists/drafts.spec.ts`,
`e2e/admin/steps/install/update.spec.ts`, `e2e/admin/specs/install/states.spec.ts`, `e2e/admin/specs/journey.spec.ts`).

## 81. The live test of 2026-11-01, the pipeline's jobs, the measurement reports and push: Google's reason in the build's log, a blocked request named, a failure that goes with its attempt, push devices that say what they are (2026-11-01) — 81a–81c APPLIED (findings 47–49 of `docs/research/manual-test-2026-10-25.md`: product, test and documentation changes; no configuration of the ask-first kinds, no gate relaxed, no budget raised, no checker allowlist entry, no download; `seed/bucharest/` unchanged); 81d APPLIED (finding 50; its lint exception is the user's approval of 2026-11-01, in chat: one file-scoped `no-deprecated` allowance for `getToken` and `deleteToken`); 81e APPLIED (the admin's total budget kept without raising it: the production build drops the emulators' connectors)

- **81a APPLIED: the pipeline's `jobs` step prints Google's reason, waits out a request rate and names a quota (finding
  47).** `googleJson` of the install steps reads a refusal's body: `error.status`, `error.message`, each `ErrorInfo`
  (`reason`, every metadata entry) and `QuotaFailure` violation (`subject`, `quotaMetric`, `quotaId`, `quotaValue`,
  `description`), one line of at most 900 characters, redacted with `redactText` of `@hcm/shared` plus any bearer header
  (`scripts/site/src/install/steps/google-error.ts`); `GoogleCallError` carries it with `Retry-After`. A 429 or
  `RESOURCE_EXHAUSTED` with no `QuotaFailure` and an `ErrorInfo` reason of `RATE_LIMIT_EXCEEDED` (or none) is a request
  rate: every Google call of `run-jobs` is tried again up to four times, after 5·2^(n−1) s times a jitter in [0.5, 1.5)
  (`StepDeps.random`) or `Retry-After` when longer, each at most 60 s (under four minutes in all), each wait printed with a
  `retry` event (reason `quota`, which the card already words as "its change quota"); the jobs are made one after the
  other. Anything else of that kind is a quota: not tried again; the step prints "Google Cloud refused <job> for the quota
  <metric> (limit <limit>) of <service>. A free-trial project has lower quotas: …" and a new `HCM_INSTALL` event
  `{"event":"quota","service","metric","limit"}` (`installLogEventSchema`). The admin reads a working pipeline build's log
  too (its retries; the site's prints none) and keeps a stopped build's last `quota` event as the view's `quota`; the
  pipeline's card shows it with **Open the Quotas page**, `https://console.cloud.google.com/iam-admin/quotas?project=<p>&service=<api>`
  (`gcp.quotas` in `links.json`, its copy `quotasUrl` in `@hcm/ui/admin`; the project is the build's console page's),
  and Try again. The fake Cloud Run makes and replaces jobs (`jobs.create`, `jobs.patch`) with the scenarios
  `jobsRateLimited` (the next two writes answer `google/error.rate-limited`), `jobsQuotaExceeded` (every write answers the
  new fixture `cloud-run/jobs.create.quota-exceeded`) and `jobsWritable`; the fake Cloud Build plays `retriesAtJobs` and
  `failsAtJobsQuota` for the pipeline. Rows S-A56-HAPPY-JOBS-RATE-LIMITED, S-A56-BAD-JOBS-QUOTA; tour states
  `setup.pipeline-retrying`, `setup.pipeline-quota`; lesson 319. The jobs' sizes, reviewed: 4 vCPU / 16 GiB and 8 vCPU /
  32 GiB, the second at a Cloud Run job's per-instance maximum; unchanged. UNVERIFIED: whether the live 429 was the rate
  or a quota (the next run prints it), Cloud Run's quota names, and the Quotas page's `service` filter (the weekly contract
  run probes `gcp.quotas`).
- **81b APPLIED: a request that never left the browser names its host (finding 48).** The admin's Google transport keeps
  the host of a call whose `fetch` threw (no HTTP answer: a DNS blocklist, a VPN or firewall, a failed CORS preflight, an
  offline browser) in the failure (`GoogleFailure.host`, still kind `unavailable`, so it is retried as before), and
  `failureMessage` and Setup's `googleFailure` (`setup/messages.ts`) say `adminShell.network.blocked` with `{host}` ("Request to {host} never left this browser: allow it in your blocker (Pi-hole, VPN) or change network."; one line of the catalogue, so the guides' table names the other blockers) instead of `apiError.unavailable`; a server's 5xx keeps
  "unavailable". An admin-shell key, not an `apiError.*` code: the API catalogue mirrors the server's codes and this one
  never comes from a server. Every browser-side Google call goes through that transport. Rows
  S-A22-BAD-REPORTS-BLOCKED-HOST, S-A22-HAPPY-REPORTS-UNBLOCKED; lesson 320. Not changed: `auth/ownership.ts`'s own
  `fetch` (a network failure there still reads "the server is down").
- **81c APPLIED: a card's failure goes with its attempt (finding 49).** `withCount(state, step, 'inputs')` clears the
  step's `error`: every Setup action counts its input before it acts, so a new attempt starts clean and shows only its own
  failure; a consent count keeps it (the consent is part of the same attempt). Rows S-A22-HAPPY-REPORTS-UNBLOCKED,
  S-A22-BAD-REPORTS-NEW-FAILURE-ONLY; lesson 321.
- **81d PARTLY APPLIED: push devices say what they are, and a fresh registration's `UNREGISTERED` dry run no longer
  refuses it (finding 50).** `PUSH_TARGET_KINDS = ['token', 'fid']`; `notify.registerDevice` takes `kind` (default
  `token`) and stores it on the device; a device without one (every device stored before) is an installation id; the FCM
  adapter addresses `message.token` or `message.fid` as the kind says, in sends and dry runs (`PushTarget` of the
  `PushSender` port). A dry run answering `UNREGISTERED`, `NOT_FOUND` or HTTP 404 is recorded with the warning "push
  device recorded although FCM refused its dry run" (uid, kind, code; never the token); the first real send forgets a
  device FCM still does not know, as before; `INVALID_ARGUMENT` and the rest still refuse with FCM's code. The browser's
  registrar says its kind (`PushRegistrar.kind`, `fid` today). The fake FCM reads `message.token` or `message.fid`, records
  the kind, and gains `tokensInvalid` and `everyTokenInvalid` (the e2e renewal and refusal rows now use them). Rows
  S-A47-HAPPY-TOKEN, S-A47-HAPPY-DRY-RUN-UNREGISTERED, S-A47-HAPPY-LEGACY-FID (new), S-A47-BAD-TOKEN-UNREGISTERED,
  S-A47-HAPPY-RENEWED, S-A47-BAD-FCM-REFUSED-REASON, S-A47-BAD-FCM-REASON-NAMED (updated); lesson 322.
  **The browser's FCM registration token (APPLIED 2026-11-01, the user's approval in chat).** `getToken(messaging,
  {serviceWorkerRegistration})` and `deleteToken` are `@deprecated` in firebase 13 (`@firebase/messaging` 0.13.3) and
  `@typescript-eslint/no-deprecated` (strictTypeChecked) refuses them; with no inline suppression, `eslint.config.js` has
  one file-scoped override for `packages/admin/src/firebase/messaging-sdk.ts`:
  `'@typescript-eslint/no-deprecated': ['error', { allow: [{ from: 'package', package: '@firebase/messaging', name: ['getToken', 'deleteToken'] }] }]`
  (the package the declarations resolve from: with `firebase` the two are still reported); every other deprecated API stays
  an error, there and everywhere. `messaging-sdk.ts` exports `getMessaging`, `getToken`, `deleteToken` (no more `register`,
  `onRegistered`); the registrar's `token()` is `getToken` with the admin's worker, `kind: 'token'`; `reset` deletes the
  token this page registered (`deleteToken`: FCM's registration and the push subscription; a refusal ignored); the
  admin's own clearing of the FID record (§79e's module) is removed, since `getToken`'s record keeps the subscription it
  was made for and makes a new token when it changed; `push/no-installation-id` is gone, `messaging/token-update-failed` joins the registration
  family. The e2e stand-in hands out its fixed tokens as `token`. A browser whose stored device is an installation id keeps
  it (sent as `message.fid`) until push is turned on again from it, or a send FCM refuses forgets it. Rows S-A47-HAPPY
  (the device's kind and `message.token`), S-A47-BAD-SDK-CODE (`messaging/token-subscribe-failed`). The registration's
  dry run keeps the tolerance above. UNVERIFIED until the next live try: that FCM delivers to the token (**Send a test**).- **81e APPLIED: room in the admin's total budget without raising it.** §81a–§81d cost the admin about 0.8 KB gzip (the
  messages in both languages, the quota line, the device's kind, and `getToken` with `deleteToken`, which pull more of the
  messaging SDK than `register` did), past the 620 KB total (620.6 KB in the build stage, every chunk and the push worker
  counted). Measured first: the production build carried the Firebase SDKs' emulator connectors and the Auth emulator's
  banner although it never connects to an emulator, because `firebaseSdk` (`packages/admin/src/firebase/sdk.ts`) listed
  them. The table now spreads `EMULATORS`: the real connectors unless `import.meta.env.MODE === 'production'`, where each
  is a function that throws ("the production build connects to no emulator"); the bundler folds the constant and drops
  the connectors (0.85 KB gzip). The `e2e` build and the tests keep them (a test re-imports the module with
  `MODE=production`). §79e's module that cleared the FID record went with `register` (§81d; 0.1 KB). Also measured and
  not done: stripping the bundler's `@__PURE__` annotations from the output (`output.comments.annotation: false` turns
  off the minifier's use of them too: +10 KB), a stand-in for zod's JSON Schema modules (4 KB, but `aggregateChecks`
  backs the string schemas' `minLength`/`maxLength`), `sourcemap: 'hidden'` (about 1 KB, but the deployed maps would no
  longer load in DevTools). The admin in all (gzip, the budget's 1000-byte KB, the build stage's figure): 619.9 KB at
  `2073d68`, 620.6 KB with §81a–§81d, 619.8 KB with this change (the `build` stage), within 620.

Verify: `PIPELINE_STAGE=static`, `tests` and `build`; the step tests (`scripts/site/test/install-steps.test.ts`,
`install-run-jobs-refusals.test.ts`); the touched Playwright specs in the quality image (`e2e/admin/steps/install/pipeline.spec.ts`,
`e2e/admin/steps/analytics.spec.ts`, `e2e/admin/specs/notify/push.spec.ts`). The admin in all (gzip, the budget's 1000-byte
KB): see §81e.

## 82. The live test of 2026-11-01, Historical imagery: outlined footprints, rows that fetch their own previews and tell twins apart, Work counting what it lists, a download that shows its bytes, the download on a small job, a frame never held whole, a dead run noticed (2026-11-01) — 82a–82i APPLIED (findings 51–58 of `docs/research/manual-test-2026-10-25.md`: product, test and documentation changes, the user's approval of 2026-11-01 for each; 82f adds a Cloud Run job definition the pipeline install makes; no configuration of the ask-first kinds, no gate relaxed, no budget raised, no checker allowlist entry, no download; `seed/bucharest/` unchanged)

- **82a APPLIED (finding 51): the city and the open scene, no result's footprint.** First outlines for every listed scene;
  the user's look at them zoomed out ("what is this madness of lines on the map!!!") made it: by default the map draws
  the city's boundary only (a closed line of the city's bounds, the theme's light `--md-sys-color-primary`), and exactly
  one footprint, the open scene's (outline and a fill at 0.35 × 0.6 of the light `--md-sys-color-tertiary`), both not
  clickable; `#rrggbb` only, else `#3949ab` and `#c2185b`. The map stays at the city's view (no fit to a footprint: a
  strip would zoom it out over the region). The light scheme because the admin's map is always Standard's day look
  (`ADMIN_MAP_CONFIG`). No change to the shared map adapter. Not done: the optional "Show all footprints" switch and a
  footprint on hovering a row (the admin bundle's budget; the list is the way to pick).
- **82b APPLIED (finding 52): the rows fetch their previews.** `BrowseImages.thumbnails` loads the copies that exist,
  marks a `failed` copy unavailable without asking again (Try again on its page asks), and asks `imagery.browse` for a
  missing one, at most four at once (`COPIES_AT_ONCE`), the next starting as each ends (the last list shown is kept);
  the page's `open` shares a copy the list already asked for, or asks at once. Root cause and what stays UNVERIFIED:
  finding 52.
- **82c APPLIED (finding 53): what tells twins apart.** `frameText` reads the camera and frame from the id
  (`^(?:(?:DS|D3C)[\w-]+([AF])|DZB[\w-]+L)(\d{3})\d{0,3}$`). Three new strings (camera aft/forward, frame) in both
  languages. Built and taken out for the bundle (82g): "n of m that day" among the listed frames of one camera and day.
- **82d APPLIED (finding 54): Work counts its rows.** `view.versions.items.length + openOrderCount(view)`;
  `ordersNeedingYou` is gone. S-A13-BAD-NEVER-DELIVERED's count changes from 1 to 3 with it (the user's finding replaces
  the M4 review's "needs you" count of 2026-10-24).
- **82e APPLIED (finding 55): the bytes of a download.** `JobContext.report_bytes(received, total)` sets the step's share
  at once and writes `steps.<step>.bytes`, `steps.<step>.totalBytes` (new, optional, in `jobDocSchema`'s step record) and
  `progress` at most every `BYTES_REPORT_SECONDS` (5 s); the fetch calls it for every piece read from USGS. The version's
  step line adds " · 1.23 of 3.4 GB" (gigabytes with two decimals; the bytes alone without a total).
- **82f APPLIED (finding 56): the download on a small job.** `JOB_MACHINES` `fetch` | `std` | `xl`, `CLOUD_RUN_JOBS.fetch`
  `raster-fetch` (1 vCPU, 4 GiB: the most memory Cloud Run gives one vCPU; a `.zip` delivery is staged in the in-memory
  scratch, which an out-of-memory exit then moves to `std`), made first by the install's `jobs` step. `DOWNLOAD_STEPS`
  (fetch, extract) in both languages' contract (`enums.json`). The dispatcher's `machineOf`: `xl` once escalated; `fetch`
  while the download is pending (`std` once an out-of-memory exit moved it there); then the camera's (`xl` for KH-9
  panoramic, else `std`). The run on `fetch` walks the download steps and ends `queued` with its lease released (the
  `onJobWrite` trigger dispatches it); that dispatch is no new attempt (`handedOver`: the job was on `fetch` and its
  download is done). The tick's out-of-memory path escalates `fetch` → `std` → `xl` (`largerThan`). The pipeline records
  `machines.download` / `machines.process` on the version once per phase (new, optional, in `layerVersionDocSchema`). A
  run whose job names no machine (a local worker, a job from before this change) walks every step. The e2e stand-in
  hands over as the pipeline does. Extract unlinks each segment once published (the scratch is memory). Cost, at list
  price ($0.000018 a vCPU-second, $0.000002 a GiB-second): `raster-fetch` about $0.09 an hour, `raster-pipeline` $0.37,
  `-xl` $0.75; the pipeline card's cost line says so. Not done: a cost estimate on the Jobs page (the admin's total
  budget, 82g); a fallback when `raster-fetch` does not exist yet (the pipeline card shows the pipeline as not installed
  until it is installed again, which the update needs anyway).
- **82g APPLIED: the admin's total budget kept without raising it.** 82a–82i cost the admin about 1.5 KB gzip at their
  first build, most of it in the lazy `imagery` chunk (17.0 → 18.2 KB of its 18). Room made, measured with the build
  stage's own sum (every script of `packages/admin/dist`, the push worker `firebase-messaging-sw.js` included: 0.7 KB that
  a bare `vite build` does not write): nineteen catalogue keys no code, test or spec reads, in both languages
  (`adminContent.common.moreActions`, `adminContent.common.history`, `adminSetup.openPage`, `adminSetup.deploy.explain`,
  `adminSetup.deploy.variables`, `adminShell.admins.role.admin`, `adminShell.admins.inviteRow`,
  `adminContent.map.chooseVertex`, `adminContent.map.vertexRefused`, `adminContent.layers.orderNote`,
  `adminContent.layers.addressInvalid`, `adminContent.layers.fieldInvalid`, `adminContent.layers.reordering`,
  `adminContent.settings.fieldInvalid`, `adminContent.photos.loading`, `adminContent.pois.redrawConfirm`,
  `adminShell.oauth.continue`, `adminShell.city.opening`, `adminShell.city.none`; `adminShell.admins.role.owner` stays,
  two specs read it; each found by a search of every source, test and spec for its full name and for a template that
  could build it); the footprint click path the map no longer needs (82a: no footprint is clickable; `pickedScene`
  gone from the Imagery state and its port); the list's copies limited by the copies in flight rather than a queue with
  priorities; sizes on the step line in gigabytes only; and not built after all: the frames' "n of m that day" and each
  card's Import named after its frame id. The admin in all: 619.8 KB at `c8f0019`, 619.9 KB with this change (the
  `build` stage), within 620; the entry chunk 369.5 KB (0.4 KB less than before); `imagery` 17.6 KB of its 18.

- **82h APPLIED (finding 57): a frame never held whole.** `hcm_pipeline/frames.py`: `Segment` reads a segment by windows
  (and shrunk, by GDAL) as 8-bit pixels, a deeper one through its own linear stretch (its 2nd and 98th percentiles of a
  shrunk read); `FrameLayout` (`frame.json`: the frame's size, the preview's shrink and each segment's place, a later one
  on top). `stitch` stages two segments at a time (`JobContext.unstage` frees a staged copy: the scratch folder is
  memory on Cloud Run), pairs them from shrunk copies and full-resolution strips (unchanged precision), crops the film
  border on the preview (at most `PREVIEW_MAX_PX` 16 384 px on its long side: about 20 m a pixel on a KH-9 panoramic
  frame, finer than the 30 m `locate` scores at; the border is placed within one preview pixel, the frame's own edge
  kept where the crop reaches it) and publishes `frame.json` and `frame-preview.tif` instead of `frame.tif`; `locate`
  scores the preview and reads the crop out of the covering segments one at a time. `GDAL_CACHEMAX` 4096 → 1024 MB.
  The step order stays (stitch, then locate). Considered and not done: GDAL's `/vsigs/` streaming from the bucket (no
  staged copy at all: the e2e and test bucket fakes speak the JSON API only), a VRT (the same reads with a file the next
  run would need its sources beside).
- **82i APPLIED (finding 58): a dead run noticed.** `recoverLost` also asks Cloud Run about a running job not written for
  `HEARTBEAT_LATE_BEATS` (3) heartbeats, so a kill is noticed at the next tick instead of after the lease's ten minutes;
  `apiError.imagery.outOfMemory` leaves `NOT_RETRYABLE_CODES` (Try again on the version page, `imagery.retry` accepts it).
  S-A12-BAD-NOT-RETRYABLE now shows a refused Mapbox token without Try again.

Verify: `PIPELINE_STAGE=static`, `tests` and `build`; the targeted Playwright specs of the imagery and the pipeline install
(`e2e/admin/specs/imagery/rows.spec.ts`, `import.spec.ts`, `search.spec.ts`, `orders.spec.ts`,
`e2e/admin/steps/install/pipeline.spec.ts`, `update.spec.ts`).

## 83. M7: "Run on my computer" and the cheap cloud defaults (2026-11-02) — 83a–83h APPLIED (the user's decisions of 2026-11-01, "make this as free as possible": product, test and documentation changes within `docs/research/M7-local-worker.md`; 83b raises `ADMIN_TOTAL_KB` from 620 to 630, approved under the user's overnight blanket approval of 2026-11-01 ("i give u all the yes"), flagged for review in the morning; 83d a Provision binding the owner applies with step c; no gate relaxed, no checker allowlist entry, no download; `seed/bucharest/` unchanged); 83i PROPOSED (the Uploads scopes of the Mapbox tokens); 83j RESOLVED (the first stop signal after a job sometimes lost: found and fixed 2026-11-02); 83k–83l APPLIED (the split `all` of `d7fe0c9`: the push kinds the rules allow, the admin tests' server calls)

The contract is `docs/research/M7-local-worker.md` (written before the code; §11 lists what only a real project can prove). Four
workstreams built it in one tree (fn-worker, fn-cost, pipeline, admin) and an integrator ran the gates.

- **83a APPLIED: the worker, its callables and where a job runs.** As the contract's §1–§5: `python -m hcm_pipeline worker`
  (`pipeline/src/hcm_pipeline/worker/`), the five `worker.*` callables (owner `fn-worker`, `functions/src/worker/`), the
  dispatcher's `runOn` and `imagery.runOn`, Cloud Run's free-tier count and the OK, the raw delivery deleted by `locate`
  (lifecycle 30 → 7 days), the Uploads API path. Rows A62–A64, P04 and P01's raw-deletion pair, every one `exists`.
- **83b APPLIED: the admin's bundle.** The first build of M7 measured the admin in all at 627.8 KB gzip of its 620 (the
  `build` stage), its entry 371.5 of 450. The waste first: the admin validated every answer with the one registry table,
  so the local worker's five callables' request and response schemas were in its entry (`docs/LESSONS.md` 337). The
  registry is now split by its consumers: `ADMIN_CALLABLES` (every callable but the worker's, with the schemas the admin
  checks its answers with), `WORKER_CALLABLE_NAMES` and `CALLABLE_NAMES` (the names the deployment check waits for) in
  `packages/shared/src/api/registry.ts`; the worker's schemas and rows (`WORKER_CALLABLES`) in `worker-calls.ts`; the whole
  table `CALLABLES` (the functions', the tests' and the mock server's) in `callables.ts`, which the admin never imports:
  0.6 KB less. Tried and not kept: Rolldown's `manualPureFunctions: ['z']` (unused schemas dropped, about 1 KB) would also have
  dropped the `z.config({ jitless: true })` call the admin's CSP needs. What is left is real: the lazy `worker` chunk
  (5.5 KB, loaded only by the Jobs page, the pipeline card and an unfinished version's page; its budget row 7 KB, the
  contract's 5 plus room) and the entry's share of M7 (the job's place and wait, the install's image record, Provision's
  public pull, the new error codes). The total counts every lazy chunk, those loaded only on use included, so
  `ADMIN_TOTAL_KB` goes from 620 to 630, the smallest round value that fits (`scripts/ci/check_bundle_budget.py`, with
  the reason beside it): approved under the user's overnight blanket approval of 2026-11-01 ("i give u all the yes");
  flagged for review in the morning. Measured by the `build` stage at the end of this change: the admin in all 627.2 KB of 630, its entry 371.0 KB of 450
  (369.5 at `9ecfe87`), `worker` 5.5 KB of 7.
- **83c APPLIED: the `worker` chunk.** No codeSplitting group (a group's chunk needs Rolldown's runtime helper, which would
  make a chunk of its own beside terra-draw's): the natural chunk of its one dynamic entry, `packages/admin/src/worker/worker.ts`,
  imported by the Jobs store; its elements come from the subpath `@hcm/ui/admin/worker` and its words from
  `@hcm/shared/admin-worker` (`packages/shared/src/i18n/admin-worker/`), a catalogue the entry does not import (the
  `i18n` gate checks its parity like every folder's).
- **83d APPLIED: the image anyone can pull.** Provision's `hcm` repository of Artifact Registry gets `allUsers` →
  `roles/artifactregistry.reader` (`PUBLIC_PULL`, `packages/admin/src/provision/resources.ts`), so the owner's
  `docker run` needs no login. The trade-off: anyone who learns the project id can pull the pipeline's image (it holds
  the open-source pipeline and no secret or configuration: the secret scans run on the tree it is built from), and every
  pull, the owner's or another's, is internet egress billed to the owner (about 0.6 GB, cents at list price). Where an
  organisation policy refuses `allUsers`, Provision records the refusal and goes on; the panel names `gcloud auth
  configure-docker us-central1-docker.pkg.dev`. Applied to a live project when the owner runs step c again.
- **83e APPLIED: App Check off for `worker.*`.** The first callables without it (`AppCheckMode` `off`): App Check cannot
  attest a process on the owner's computer. The credential is a verified ID token of a city editor; each call is bound to
  the one job the caller's worker claimed (`job.worker.{id,uid}`, no other live lease), the guard pauses them, `worker.urls`
  signs at most 20 objects a call and the instance cap is two. The registry's test pins that no admin callable is `off`
  and every worker callable is.
- **83f APPLIED: the workstreams' choices beyond the contract.** fn-worker: the five callables run as `fn-admin@` (it reads
  the USGS secrets for the M2M calls it makes for a worker and signs the worker's object addresses with its own
  `signBlob`); `worker.step` stamps every write `system:pipeline` at the server's time and answers documents through
  `toWire` (`docs/LESSONS.md` 335); under the emulators the "signed" address is the Storage emulator's own JSON API (a
  `POST` upload as its owner; `workerSignedObjectSchema.method` admits it), loopback only. fn-cost: the Uploads path is
  recorded on the job as a step of its own, **`uploads`** (`UPLOADS_STEP`; "Free upload to Mapbox", "Încărcarea gratuită
  pe Mapbox"): running while the path is used, `skipped` after a fallback, so the guard never chooses it again for that
  job; a fallback while polling continues MTS at the next poll number (`docs/LESSONS.md` 336); the version records
  `mapbox.via`.
- **83g APPLIED: the integration.** S-A62-HAPPY-WORKER-RUN (`e2e/admin/specs/imagery/worker-run.spec.ts`) runs the real
  worker against the emulators: queued for the computer before sign-in, signed in through its page (the CSRF token of
  `GET /`, `POST /session` from the page's origin), every step through `worker.step` and signed URLs, the version awaiting
  approval, no Cloud Run execution, no `usgs-raw/` or `work/` object in the bucket, the delivery deleted from the work
  folder after `locate`, the panel showing the computer's last job done; the row's text says that the raw delivery stays
  local and is deleted after `locate`. `pipeline/tests/contracts/written-documents.json` was written again from M7's
  writers. Fixed on the way: the admin's deployment count (69 → 75), `test_log.py` reading only its own logger's lines
  (lesson 339), the ops fake's `request`, the worker tests' answer types, the exports knip found only their own modules use.
- **83h APPLIED: the documentation.** The admin guide's M7 section and troubleshooting table and `docs/MANUAL_TEST_PLAN.md`
  W1–W5 name the admin's actual words (Procesări, **Copiază comanda**, **Rulează pe calculatorul meu când e conectat**,
  **Rulează în Google Cloud oricum**, the worker page's "Sesiunea s-a încheiat: conectează-te din nou").
- **83i PROPOSED: the Uploads scopes.** Setup mints `mapbox-sk-tiles` with `MAPBOX_TILES_SCOPES` (`tilesets:*` only) and
  the bootstrap token needs `MAPBOX_BOOTSTRAP_SCOPES`, neither with `uploads:read` or `uploads:write`; the contract's §6
  says the tiles token "must also carry" them. As built, every publish on a real project tries the Uploads API once, gets
  403 and goes through MTS behind the compute-unit guard (one log line says why), so the free path costs nothing and gains
  nothing until both lists gain the two scopes (the owner's bootstrap token then needs them too, and Setup asks for a
  new paste). The user's decision.
- **83j RESOLVED (2026-11-02, below): the first stop signal after a job is sometimes lost.** In five runs of S-A62-HAPPY-WORKER-RUN the first
  SIGTERM, or the first Ctrl-C (SIGINT), sent to the worker after it ran a job did not stop it within 30 s three times
  (once its main thread was caught in a network call at that moment, and 5 s later in the loop's wait); a second signal of
  either kind then stopped it at once with exit 0 and "worker … stopped", and in the other two runs the first Ctrl-C did.
  Before a job, the first SIGTERM stopped it at once. After the run the handler is the loop's at
  both the Python and the C level (`signal.getsignal` and `sigaction` read in the process), no thread blocks the
  signals, and pytest's reproductions (the real steps inside `loop.run()`, OpenCV's default threads, a signal to a
  native thread, a signal during an httpx call) all stop at once, so the cause is not found. The spec sends Ctrl-C, as the
  admin guide says, and records how the worker ended without asserting it. The owner's second Ctrl-C works;
  `docker stop` sends SIGTERM, then kills the container after its 10 s grace, and the job goes back to waiting when its
  lease lapses. To look into before the first live run.
  **Resolved 2026-11-02** (`docs/LESSONS.md` 342): the runner's handler (`sigterm_raises`) replaces the loop's for the
  whole run and only raised the run's flag; a signal after the run's last checkpoint (`_finish`'s final write and its
  log line, both network calls through `worker.step`, which is where the main thread was caught) was read by nobody, the
  run ended `DONE`, and the loop, its own handler back, kept claiming; the second signal reached the loop's handler.
  The spec's stop came at that moment because the job's status is written after the version's (the split `all` read the
  job `running`). Also a signal while a claim was under way set the loop's flag only, and the claimed job then ran whole.
  The reproductions above stopped at once because their signal never fell after the last checkpoint. Fixed: the runner's
  handler calls `RunFlags.interrupt` (one assignment, no lock: both handlers used to take a lock the main thread could hold
  at that very bytecode) and then the Python handler it replaced (never Python's own Ctrl-C handler, which would raise
  `KeyboardInterrupt` inside the run); the loop's handler sets a flag and its waits look at it every 0.25 s
  (`SIGNAL_CHECK_SECONDS`); the run asks the loop at each checkpoint (`RunSettings.asked_to_stop`), and a stop asked
  before the first step requeues the job without a step record. `pipeline/tests/integration/test_worker_stop.py`
  (S-P04-BAD-ONE-SIGNAL) holds a worker process at a moment, sends one signal and expects exit 0 within 10 s: on the old
  code it timed out at all six tail attempts and during the claim, now all nine pass. S-A62-HAPPY-WORKER-RUN polls the
  job's status and asserts that one Ctrl-C ends the worker with `exit 0`.
- **83k APPLIED: the push kinds the rules allow** (`docs/LESSONS.md` 340). `validPushKinds` in `firebase/firestore.rules`
  spelled out the ten kinds of M4, so `job.needsOk` (M7, pushed by default) made every save of the push settings a 403
  (S-A47-HAPPY failed at every admin project). The list gains it and allows 11; `firebase/rules-tests/test/notify.test.ts`
  saves every kind of `NOTIFICATION_KINDS`, all of them and the defaults, so a kind added to the shared list without the
  rules fails the rules tests.
- **83l APPLIED: an admin test ends once its imagery calls answered** (`docs/LESSONS.md` 341). S-A11-BAD-BROWSE-UNAVAILABLE
  failed once at `admin-m768-ro`: a browse copy of the test before (its harvest's prefetch or a row's `imagery.browse`,
  which finding 52 multiplied) recorded `copied` on this test's scene of the shared `PROJECT_CITY`. Not a product race:
  the copy existed. The admin fixtures' `page` (`e2e/admin/support/test.ts`) now ends a test only once its page's
  `imagery.search` and `imagery.browse` requests have answered (`e2e/admin/support/server-calls.ts`). No sleep, no retry.

Verify: `PIPELINE_STAGE=static`, `tests` and `build`; the targeted Playwright runs of `worker.spec.ts`, `worker-run.spec.ts`,
`jobs.spec.ts`, `guard.spec.ts`, `publish.spec.ts`, `published.spec.ts`, `automation.spec.ts`, `pipeline.spec.ts`, the
pipeline install and provision steps and the journey at `admin-l1440-ro`.

## 84. The KH-9 import after finding 57: a version the admin could not read, a corner guess no better than chance (2026-11-02) — 84a–84b APPLIED, 84c PROPOSED (findings 62–63 of `docs/research/manual-test-2026-10-25.md`: product, test and documentation changes; one new error code with both languages' message; no configuration of the ask-first kinds, no gate relaxed, no budget raised, no checker allowlist entry, no download; `seed/bucharest/` unchanged)

- **84a APPLIED (finding 62): what the pipeline writes, held to the schemas.** The writer was wrong, not the schema:
  `scanSchema` and `pixelSchema` cap a side at `MAX_SCAN_PIXELS` (a KH-9 strip cropped to a city fits) and
  `apiErrorParamsSchema` takes texts. `steps/locate.py` `within_limits` fails a crop over the cap with `processingFailed`
  before any pixel is read; `StepFailedError` turns every parameter into text. The contract gains a check of what the
  real writers produce: `pipeline/tests/integration/test_written_documents.py` runs the runner along ten paths
  (whole import, two phases, USGS preparing, not scanned, size mismatch, corrupt archive, cancelled, no pairs, corners
  far off, city not found) on a recording store and holds every job, version and log document after every write to a
  shape (each field path with its JSON type, list items merged) of `pipeline/tests/contracts/written-documents.json`, a
  generated file (`HCM_WRITE_CONTRACTS=1`, then Prettier) with one document of each shape, lists cut to 12 items keeping
  one of each item shape; `pipeline-contract.test.ts` parses each with its schema. Shapes, not values: the golden
  documents come from synthetic scenes, so value limits stay the writers' own checks. `enums.json` gains `MAX_GCPS`,
  `MAX_SCAN_PIXELS` (equal on both sides) and `PIPELINE_ERROR_CODES` (every `contract.Errors` code; each must be an
  `ApiErrorCode`). The admin's `contentStore` takes an optional `log` (`createLogger('admin-store')` in production) and
  warns once per document and set of issues with its path and failing fields and codes (`scan.width validation.tooBig`),
  never the values; the page's text is unchanged. Not done: an admin Playwright row for the log (a log is not shown to
  the user).
- **84b APPLIED (finding 63): the corner guess has a floor.** `georef/corners.py`: `plausible` keeps the assignments
  whose centre ground pixel is at most `MAX_ANISOTROPY` (3) times as elongated as the best-shaped one's (on a square
  frame all eight stay; on a 1:2 KH-9 mapping frame or a strip, the four with the film's long side along the
  footprint's); `guess_corners` keeps the best when it reaches `MIN_CORRELATION` (0.2), else `searched` warps the frame
  onto the window widened by `SEARCH_MARGIN` (0.5 of its size) on every side, matches the window's Sentinel-2 inside it
  (`TM_CCOEFF_NORMED`; a place where the frame covers under `MIN_COVERAGE` of the window is no match), moves the guess
  by the offset and scores it again; still under 0.2: `CityNotFoundError` → `apiError.imagery.cityNotFound` (new, both
  languages, `failed-precondition`, retryable: a later pipeline may find it), nothing cropped. The search runs whenever
  the first score is low, which on the synthetic scenes is most of the time (CR-M3-20 measured 0.08 to 0.13 for right
  guesses with corners 290 m off; the moved guess scores 0.8 to 0.9), so every import now crops a better-placed window.
  The 0.2 floor and the 3× shape limit are calibrated on synthetic frames only: **UNVERIFIED** on real ones (the log
  line names each run's correlation and move).
- **84c PROPOSED: what the admin can do when the city is not found.** (1) Show the frame's preview (`frame-preview.tif`,
  already in `work/`) on the failed version and let the admin draw the city's rough area on it; `locate` then crops
  that area and the georeferencer takes over (a new georeferencer mode, a callable and rows). (2) A panoramic camera
  model for KH-4 (±35°) and KH-9 (±60°, **UNVERIFIED**) frames in the guess: the long axis's pixel as the scan angle,
  the ground as its tangent, as extra candidates scored like the others. Neither is built: both change the admin or the
  geometry beyond this finding; the user's decision.

Verify: the targeted tests (`pipeline/tests/unit/test_corners.py`, `pipeline/tests/integration/test_written_documents.py`,
`pipeline/tests/unit/test_contract.py`, `test_runner.py`, the whole pipeline suite;
`packages/shared/test/schemas/pipeline-contract.test.ts`, `packages/admin/test/firebase/content.test.ts`); the
`static`, `tests` and `build` stages once the M7 work in the same tree is finished.

## 85. The live test of the local worker: Provision with an update, one command with nothing to prepare, pairing instead of a second sign-in, the cloud when no computer comes, a page sign-in that gave up (2026-11-02) — 85a–85f APPLIED (findings 65–69 of `docs/research/manual-test-2026-10-25.md`, the user's request "make sure all of this is automagic for the admin!!!": product, test and documentation changes; three new callables and one new notification kind, each in both languages; a pipeline image line (`/work` owned by the worker's user); no configuration of the ask-first kinds, no gate relaxed, no budget raised, no checker allowlist entry, no download; `seed/bucharest/` unchanged); 85g recorded for the user

- **85a APPLIED (finding 65): Provision's item set is versioned and an update applies what changed.** `@hcm/shared`
  gains `PROVISION_SET_VERSION` (2) and `PROVISION_CHANGED_IN` (each item's set version of its last definition change:
  `artifact-registry` and `bucket-lifecycle` 2, the others 1) and `provisionDue(recorded)`; `setup/status.provision`
  and `setup.recordCloud`'s `provision` gain `setVersion` (absent = 1). The admin sends it when the run reported every
  item changed since the recorded version `ok` (`reachedVersion` of `packages/admin/src/setup/provision-version.ts`: the
  run observed them with this admin's definitions, so a record of an older release's `ok` never counts), step c's runs,
  Re-check and the bootstrap's claim record included; the server keeps a recorded version when a later report names none.
  The install slice carries `provisionDue` (`updateItems`: none for a project never prepared); Update the map, from any
  card and so from Home's tile, runs `ProvisionFlow.update` with the click's token beside the builds (one click, one
  consent); the server card names the items and offers Update the map for them alone; Home's update tile also shows for
  them when every target is current. Rejected: re-running every item on every update (16 items of Google calls, and a
  refusal of an unchanged item would block an update that did not touch it); a version per item (the user asked for the
  set's; one number per release is enough while items only gain definitions).
- **85b APPLIED (finding 66): one line with nothing to prepare.** `workerCommand` (`hcm-worker-panel.ts`):
  `docker rm -f hcm-worker <quiet>; docker run -d --name hcm-worker --restart unless-stopped -p 127.0.0.1:8765:8765 -v
  hcm-worker:/work <image@digest> worker --city <c> --project <p> --pair <code>`, `<quiet>` `2>&1 | true` (Linux,
  macOS) or `2>&1 | Out-Null` (Windows PowerShell; the shell picked from the browser's user agent, switchable; not `>/dev/null` nor `$null`: the e2e placeholder guard reads a visible `null` as a leaked value, and a pipe says the same). The named volume
  replaces `$HOME/hcm-worker`: `pipeline/Dockerfile`'s runtime stage creates `/work` owned by `10001`, and Docker
  initialises an empty named volume from it, owner included. One container per computer (a second city's command
  replaces the first: a documented limit; the volume keeps each city's session file apart). "Docker is not installed?
  Get Docker" links `https://docs.docker.com/get-started/get-docker/`.
- **85c APPLIED (finding 67): pairing.** `worker.pairCode {cityId}` (admin, `cityEditor`, App Check enforced) mints 26
  base32 characters from `crypto.randomBytes` (130 bits), stores `cities/{c}/pairings/{sha256(code)[:40]}` `{uid, image?,
  expiresAt (+600 s)}` and deletes the caller's unused expired codes; `worker.pair {cityId, code, replaces?}` (access
  `none`, App Check off, two instances) counts the attempt in `pairings/limit` (20 per city per 10 minutes, counted before
  the code is read; `apiError.rateLimited`), marks the code used in one transaction (used, revoked, expired and unknown
  are one answer, `apiError.worker.pairCode`), checks that the owner still has a role in the city, revokes the replaced
  pairing when it is the same owner's, and returns `auth.createCustomToken(uid, {worker: true, city, pair})`
  (fn-admin's own `signBlob`: the `roles/iam.serviceAccountTokenCreator` on itself Provision's `iam` item grants since
  M5 for `export.download`, so no new item; **UNVERIFIED** until the first real pairing). The worker's five callables
  carry `workerToken: true` in their rows: `requireAccess` reads such a token (`sign_in_provider: 'custom'`, the three
  claims) only there, still requires the owner's membership, and `requireCityRole` holds it to its `city`; every handler
  is wrapped in `paired`, which finds the pairing standing (exchanged, the caller's, not revoked) or refuses with the new
  `apiError.worker.revoked`. `worker.revoke {cityId, workerId}` (admin) sets `revokedAt` on the worker and its pairing;
  `ownWorker` refuses a revoked worker, so a Google-signed worker stops at its next claim. Chosen over Firebase's
  `revokeRefreshTokens`, which would sign the owner out of every browser too. The worker (`pairing.py`) exchanges the
  code, signs in at `accounts:signInWithCustomToken` with the web API key and the Hosting origin as `Referer` (the key is
  referrer-restricted to the Hosting origins; the token refresh sends the same header), calls `worker.hello` through the
  page's own sign-in path, and keeps `{refreshToken, pairId, codeHash}` in `<work>/.hcm-session-<city>.json` (mode 600,
  written to a new file then moved), again after every refresh. At start: a code different from the kept one's pairs
  (naming the kept pairing as `replaces`), else the kept session resumes; a refused code falls back to the kept session;
  a transient failure is tried again every 30 s (a reboot's network); `apiError.worker.revoked` ends the session and
  deletes the file. The security review is §10's addendum of `docs/research/M7-local-worker.md`.
- **85d APPLIED (finding 67, the auto-update): the image a worker runs is the pairing's, compared on every hello and
  claim.** Decided: the command keeps naming the image by digest (the supply-chain pin of `DECISIONS-for-review.md` §83),
  and Docker's restart policy never pulls, so a tag would not update anything without a watcher container (Watchtower:
  another image with the Docker socket, rejected). The pairing records the digest its command named; `worker.hello`
  answers the installed one (`setup/status.install.pipeline.image`) and `outdated`; `worker.claim` gives an outdated
  paired worker no job (`{job: null, outdated: true}`) and records `outdated` on its document; the worker's page and log
  say to run the admin's command again; the panel says so with the command, whose new code replaces the pairing (one
  paste, no sign-in). A worker signed in with Google has no image recorded and is never called outdated.
- **85e APPLIED (finding 68): the admin does the rest.** `imagery.tick`'s new part `noWorker` (`tick-worker.ts`, green
  guard only): a queued local job waiting for the computer whose last write is `WORKER_WAIT_MINUTES` (15) old, with no
  worker of the city seen within `WORKER_FRESH_SECONDS`, is marked `workerOverdueAt` in a transaction that finds it still
  waiting and leaves the notification `job.noWorker` (warning, pushed by default; the rules' `validPushKinds` gains it and
  its size cap goes to 12); the version page offers **Run in Google Cloud instead** (filled) with "Your computer has not
  picked it up in 15 minutes"; a claim or a move of the job clears the mark. Never moved by itself: a cloud run costs, and
  past the free tier it would wait for the OK anyway. The Jobs panel follows the busy worker's job (its `step` and
  `progress`, live).
- **85f APPLIED (finding 69): the page's sign-in is a fallback that gives up.** `page.py`: the SDK modules are loaded
  together and their failure leaves the page showing the state; `signInWithPopup` races `SIGN_IN_TIMEOUT_MS` (90 s),
  after which the page says the sign-in did not finish and to use the admin's command, a message the state polls keep.
  The cause is **UNVERIFIED** (findings doc, 69). Not done: adding `localhost` to the browser key's referrers (it would
  widen the key for every page on every computer).
- **85g recorded for the user.** To take these live: deploy the server and run Update the map (it applies 85a's two
  items and installs the new pipeline image), then copy the panel's new command once on the computer (it replaces the
  running worker; no `mkdir`, no sign-in). Verify live: the first `worker.pair` (fn-admin's `signBlob` for the custom
  token), the Identity Toolkit sign-in with the Hosting origin as `Referer`, and a reboot of the computer (the worker
  back with no new code).

Verify: `PIPELINE_STAGE=static`, `tests` and `build`; targeted Playwright (`worker.spec.ts`, `worker-run.spec.ts`, the
install specs, `provision.spec.ts`, `journey.spec.ts`, two workers).

## 86. No copy and paste for the local worker, and the live test's open issues: the starter file, auto-pair, an update's record after its server, a card quiet during a build, the month's meter backfilled, a lost run's page (2026-11-02) — 86a–86g and 86i APPLIED (findings 59–61, 64, 70–72 of `docs/research/manual-test-2026-10-25.md`, the user's request "I should not have to copy and paste. Fix. Also fix open issues" and decision "Starter file + auto-pair": product, test and documentation changes; one new callable and one new lazy chunk with its own budget row (the pre-approved kind), each text in both languages; the admin's CSP `connect-src` gains the worker's loopback address; no gate relaxed, no budget raised, no checker allowlist entry, no download; `seed/bucharest/` unchanged); 86h APPLIED for review (two build changes that shrink the admin, each reversible in one line); 86j recorded for the user

- **86a APPLIED (finding 72): the starter file.** **Use this computer** on the worker's panel saves a file for the browser's
  system (switchable), made from the templates `packages/admin/starter/hcm-worker.sh` (Linux `.sh`, macOS `.command`) and
  `hcm-worker.bat` (Windows: cmd, then PowerShell), which the admin's site build publishes at `/admin/worker/` and the admin
  fills with the project, the city and `install`/`uninstall`, each checked against its pattern. Opened once, it checks
  Docker and installs a per-user supervisor (systemd `--user`, else the desktop's autostart; a LaunchAgent; a task at
  logon, else the Startup folder), whose loop reads the installed image from the new callable `worker.image` (no sign-in,
  App Check off, `fn-worker`, read-only), pulls it by digest and runs `worker --supervised --image <digest>` with no restart
  policy, starting it again after any end (at once after `75`, `WORKER_OUTDATED_EXIT`). It holds no secret. **Stop using
  this computer** gives the same file set to `uninstall`. Chosen over the example's static `/admin/worker.json` of the site
  build: the site's build cannot know the digest the pipeline's own build pushes, and a stale file would make every
  supervisor pull an image the server calls outdated, in a loop (`docs/research/M7-local-worker.md`, its addendum of
  2026-11-02). Not made: a Linux `.desktop` launcher (GNOME's Files does not launch an untrusted downloaded one). The shell
  template passes shellcheck and shfmt in the static stage; the image has no PowerShell, so the Windows file's structure is
  unit-tested (`packages/admin/test/worker/starter.test.ts`: every system's file, no placeholder, no code, CRLF, one
  PowerShell part, balanced brackets; the POSIX one through `sh -n`).
- **86b APPLIED (finding 72): auto-pair.** The worker's local server answers `GET /state` and `POST /pair {code}` with CORS
  and Private Network Access's preflight for the project's Hosting origins only (`Endpoints.hosting_origins`); the code goes
  to the connector, which pairs at the loop's next pass as `--pair` does. The admin's `LocalComputer` (lazy chunk
  `worker-local`, one instance per city and project) looks every 5 s while the panel is shown and while the admin is open
  (`packages/admin/src/app/local-watch.ts`, its own listener of the shell), only in a browser that set the computer up
  (`localStorage` `hcm:admin:workerLocal`), and posts a fresh `worker.pairCode` to a `pairable` worker of its city and
  project. The panel no longer mints a code just by showing (the Advanced command mints one when opened). The admin's CSP
  `connect-src` gains `http://127.0.0.1:8765 http://localhost:8765` (`scripts/site/src/admin/csp.ts`, `firebase.json`; a
  narrower policy than a wildcard, the kept-equal test unchanged). The security review: §10.14–§10.19 of the M7 contract.
- **86c APPLIED: the image a supervised worker runs is the one compared.** `worker.hello` takes an optional `image`; the
  worker's document records it, and `worker.hello` and `worker.claim` compare it, else the pairing's, with the installed
  one: a kept pairing outlives many images. A worker of this release against a server of before it is refused at hello
  (its strict schema): Update the map installs the server with the pipeline, so only a starter file run before the server's
  update meets it, and the supervisor's next start after the update succeeds.
- **86d APPLIED (finding 71): an update's Provision record waits for the server it installs.** `ProvisionUpdate` takes
  `recordAfter`, which `#update` resolves once the server's build has settled (any state but a running one; also when the
  cards are disposed). Root cause, from the code and the live facts: the items ran (already `ok`), the record naming
  `setVersion` went to the server being replaced, whose strict schema refused it. Rejected: retrying the record without
  `setVersion` (the items would be recorded, the version never). Live: one more Update the map records it.
- **86e APPLIED (finding 59): a card keeps what it showed until its first look.** `Cards.#shown`: a view without
  `checkedAt` takes only `busy`, `error` and `blocker` over the recorded target.
- **86f APPLIED (findings 60, 61): a lost run's version page.** `jobViewOf` reads a `running` step of a failed job as
  `failed` (no byte count) and drops a message that is only a code; the server's ending is unchanged (the job keeps the
  code, the Jobs page shows it).
- **86g APPLIED (finding 64): the month's meter backfilled once.** `backfillCloudUsage` (`imagery.tick`, before the cities'
  parts): when `usage/cloudrun-<month>` has no `backfilledAt`, every city's jobs dispatched this month that ran in the cloud,
  are not running and were never counted add (end − dispatch, at most `BACKFILL_RUN_MAX_SECONDS` = 3 h) × the machine (`std`
  when none is named); the transaction marks the month (`cloudRunUsageDocSchema.backfilledAt`), and a later count keeps the
  mark. An earlier attempt of a job that ran again is lost: the meter stays an estimate.
- **86h APPLIED for review (the admin's bundle): two savings instead of a raise.** Finding 72 needed about 2 KB and the
  admin had 0.8 KB left of 630. (1) zod's classic schemas import its JSON Schema conversion for `toJSONSchema()`, Standard
  Schema's `jsonSchema` and derived getters the admin never calls, reachable from every schema's constructor; the admin's
  build resolves those two imports to `packages/admin/src/vendor/zod-json-schema-unsupported.ts` (each function throws;
  unit-tested to name every one zod imports), as §65k did for `re2js`: −5.7 KB. (2) `sourcemap: 'hidden'`: the maps are
  still written (the notices gate reads them) but the chunks no longer name files Hosting never serves (`**/*.map` is
  ignored): −1.1 KB. With finding 72 and the other fixes: 626.6 of 630 KB; `worker` 5.7 of 7 KB; the new `worker-local`
  4.3 KB with its row `"worker-local": 5` (the measurement plus about 20 %, the pre-approved kind). To revert either: delete
  the plugin line, or set `sourcemap: true` (the budget then needs a raise). Every admin unit and the targeted e2e tests
  pass on it (the e2e admin is built with it).
- **86i APPLIED (finding 70): no update offered while a build runs.** `updateOffered` is false while any target's build is
  queued, working or retrying, or a click on one is on its way: neither **Update the map** nor the Provision line shows.
- **86j recorded for the user.** To take these live: deploy the server (it adds `worker-image` and the backfill) and the
  site (the starter templates and the admin), then **Update the map** once more (it records Provision's version: finding 71).
  On the computer: **Use this computer**, open the file once; the panel says **This computer is connected** without a paste.
  The running worker of the old command keeps working until the file's supervisor replaces it (the same container name).
  Verify live, each **UNVERIFIED** until then: the first double-click per system, the task at logon without administrator
  rights, Chrome's Local Network Access prompt, an update reaching the supervised worker (exit 75, the new digest pulled).

Verify: `PIPELINE_STAGE=static`, `tests` and `build`; targeted Playwright (`worker.spec.ts`, `worker-run.spec.ts`, the
install specs, `provision.spec.ts`, `journey.spec.ts`, the imagery version specs; two workers).

## 87. The live test of 2026-11-03: the worker's image follows the job its build set, the supervisor backs off from an older image, the starter file is a download the server answers (2026-11-03) — 87a–87e APPLIED (findings 73–74 of `docs/research/manual-test-2026-10-25.md`: product, test and documentation changes; one new public HTTPS function and its port, one Provision role (`iam`, set version 3), each new text in both languages; no configuration of the ask-first kinds, no gate relaxed, no budget raised, no checker allowlist entry, no download; `seed/bucharest/` unchanged); 87f recorded for the user

- **87a APPLIED (finding 74): the root cause, and the admin's record.** `setup/status.install.pipeline.image` came only from
  the build log's `image` event, the `jobs` step's last line, read once when the admin's card first saw the build end
  (`TargetFlow.#readsLog`, the summary of an ended build cached in `#ended`). Cloud Logging lags a build's status, so that
  read lacked the line; `#viewOf` kept the image of the record before (`summary.image ?? this.#view.image`, the view filled
  by `fromRecord`), and `Cards.#record`, which records on a change of state only, wrote `installed` with the new release
  (read from the jobs' `hcm-release` label) beside the old digest; no later look changed the state, so nothing corrected it.
  Fixed: the pipeline's observation carries the digest the job `raster-pipeline` runs (`InstalledInfo.image`,
  `cloud-build-installer.ts`), which wins over the log's (`imageOf`, `install-flow.ts`: the job's, else the log's, else the
  kept one only while the shown release is the same), and a target is recorded again when its image changes
  (`recordKey`, `setup/install.ts`). Rejected: re-reading the log until it names the image (it costs a Logging read per look,
  and a failed build never names one).
- **87b APPLIED (finding 74): the server reads the job.** `installedImage` (`functions/src/worker/installed-image.ts`) is the
  one answer of `worker.image`, `worker.hello`, `worker.claim` and `worker.pairCode`: the job's image and its label's release
  (`CloudRunJobs.job`, Run Admin `jobs.get`, kept `JOB_CACHE_MS` = 60 s per instance), else the record (the release only for
  its own digest). One resolver for all four, or a supervisor given the job's image would be called outdated by `hello`
  against a stale record and loop. `fn-admin@` gains `roles/run.viewer` (Provision `iam`, `PROVISION_SET_VERSION` 3,
  `PROVISION_CHANGED_IN.iam` 3), so Update the map applies it in the same consent; before that, a refused read is logged
  and the record answers. The e2e IAM fake gains `iam.accountsProvisioned` (the accounts an earlier Prepare the project
  made), which the two update specs that run the changed items now need, as `iam` binds those accounts. Rejected: running the four callables as `fn-events@` (which has the role; `worker.pair` and the
  USGS proxy need `fn-admin@`), and having `imagery.tick` rewrite the record from the job (a minute late, and a second
  writer of `setup/status`).
- **87c APPLIED (finding 74): the supervisor and an older image.** Old images cannot learn the new arguments, so the
  supervisor (`hcm-worker.sh`, `hcm-worker.bat`) counts the worker's usage error (`2`) in a row: at the third it says once
  "The server named an image that does not support this computer's starter: update the map." and waits 5 minutes between
  tries until the image changes (`functions/test/worker/starter.test.ts` runs the POSIX supervisor over stand-ins of
  `curl`, `docker` and `sleep`).
- **87d APPLIED (finding 73): the starter file as a download the server answers.** The public HTTPS function
  `worker.starter` (`functions/src/worker/starter.ts`, `HTTP_ENDPOINTS`, `fn-admin@`, two instances) answers `GET` and
  `HEAD ?city&os&action` with the filled template as `Content-Disposition: attachment`; the templates go into
  `functions/dist/starter/` (`functions/build.mjs`; the install bundle's allowlist names the two files) through the port
  `StarterTemplates`. The admin's links point at it (`functionsBaseFor`: the emulator's address in the e2e build); one
  `HEAD` when the panel first shows says whether the server makes the file. Rejected: a Hosting rewrite to the function
  (same origin, but a site deploy then fails on a server without the function), a per-city file at publish time (a new
  city has no site deploy), the Blob kept but prepared before the click (the cause is **UNVERIFIED**; a server's
  attachment is what browsers trust for a typed download). The site build no longer publishes `/admin/worker/`.
- **87e APPLIED (finding 73): after the click.** The polite region says the browser may ask to keep the file and that it
  is in Downloads; on Linux the exact line `sh ~/Downloads/hcm-worker.sh` with **Copy the line** (GNOME opens a downloaded
  `.sh` as text); a worker that comes up and takes a code turns the panel to **Connecting this computer…** by itself.
  Tour states `worker.local-downloaded` and `worker.local-advanced` changed with it.
- **87f recorded for the user.** To take these live: **Update the map** (the server gains `worker-starter` and reads the
  job; Provision's `iam` gives `fn-admin@` `roles/run.viewer` in the same consent; the pipeline is rebuilt and its record
  follows its job). Then `worker.image` names the job's digest even before the admin records it, and the supervisor that
  loops today picks it up at its next ask (at most 5 minutes). On the computer nothing else is needed; **Use this
  computer** now downloads from the server. Verify live, **UNVERIFIED** until then: Chrome's keep prompt per system, the
  first `jobs.get` with the new role.

Verify: `PIPELINE_STAGE=static`, `tests` and `build`; targeted Playwright (`worker.spec.ts`, `worker-run.spec.ts`, the
install specs; two workers).

## 88. While the owner is away (2026-11-03) and the 1972 import's findings: a scene opens from its address, the e2e stand-in no longer writes into the next test's world, the v1.0.0 notes catch up with M6 and M7, the stitch's bounded search, a computer set up another way, what a retry redoes — 88a–88h APPLIED (an M4 follow-up of `docs/research/M4-status.md`, lesson 356, release notes: product, test and documentation changes; one text changed in both languages; no configuration of the ask-first kinds, no gate relaxed, no budget raised, no checker allowlist entry, no download; `seed/bucharest/` unchanged)

- **88a APPLIED: a scene opens from its address whatever the filters.** The Imagery area also reads the routed scene by
  its id (`ImageryFeeds.showScene`, one live document while a scene is open, stopped with the route): a frame to buy that
  **Free only** hides, or one past the list's first page, opens from `#/imagery/scene/<entityId>`; the page waits for that
  read before it says the scene is missing, now "No scene has this address" / "Nicio scenă nu are această adresă" (it
  said "not in the list", no longer the reason). Cost: one document read per scene opened. Rejected: reading it only
  when the lists lack it (a second state to keep in step with two paged lists, for one read). S-A13-HAPPY-ADDRESS,
  S-A13-BAD-NO-SCENE.
- **88b APPLIED (lesson 356): the imagery stand-in writes only what exists.** `updateDocument(…, existing)` adds
  `currentDocument.exists=true` for the job's and the version's writes, `DocumentGone` ends the run as cancelled (logged at
  info), and `refresh()` of a deleted job ends it the same way. Test support only; no product code changed.
- **88c APPLIED: the v1.0.0 notes.** `docs/releases/v1.0.0.md` gains M6 and M7 (Setup with no terminal, the install
  bundle and **Update the map**, the local worker, the cheap cloud defaults, the field measurements) and says where the
  public map lives now (Firebase Hosting's root, the admin at `/admin/`; GitHub Pages optional, with the redirect tree).
  The GitHub description is unchanged (its pins wait for the release commit).
- **88d APPLIED (lesson 357): a seeded running job's heartbeat is never late.** The split `all` on `86cd289` failed only
  on the NUC's Jobs tour (two projects; every other gate green, `[local] [SUCCESS] stage 'all' passed`, tour-matrix 1112
  passed): another test's `imagery.tick` took the seeded running job for a lost run (finding 58's late heartbeat) and the
  stand-in failed it. `seedJob` now writes a running job's `updatedAt` at its lease's end. Test support only.
- **88e APPLIED (finding 76, lesson 358): the stitch's coarse search is bounded.** `MAX_OVERLAP_SHARE` 0.35 of
  `pipeline/src/hcm_pipeline/steps/stitch.py`: the right segment starts in the left one's last 35 % (real overlaps 4 to
  8 % on a KH-9 panoramic frame, 20 % in the synthetic tests). Rejected: a check of each overlap against the others'
  median after the walk (it needs every pair first, while the step holds two segments at a time). Live: **Update the
  map** rebuilds the pipeline image, then **Try again** on the failed 1972 version (see 88h: that retry needed the next
  release to re-stitch).
- **88f APPLIED (findings 75, 79): a computer set up another way.** **Already set up? Look for it**
  (`LocalIntents.find`, phase `looking`) sets the browser's mark without a download; the mark still gates every look, so an
  admin who never uses a computer gets no local-network prompt. Rejected: looking once on every Jobs page (the prompt for
  everyone), the starter file telling the admin (it cannot reach the browser). The Docker hint hides while the worker answers.
- **88g APPLIED (finding 77): the worker's words and id.** The id lives in `<work>/.hcm-worker-<city>.id` beside the session
  and is cleared with it (`SessionFile.clear`), so a revoked worker's next start is a new worker, as before. Old worker
  documents from before this release stay; nothing reads them beyond the panel's newest. A cleanup is not worth a job.
- **88h APPLIED (findings 78, 80, lesson 359): what a retry redoes.** `rerunSteps` of `functions/src/imagery/retry.ts` keeps
  the first finished of `locate`, `inspect`, `extract`, `fetch` and everything before it, and reopens the rest; a publish
  retry and the automatic resumes are unchanged. Rejected: recording each step's pipeline release and comparing it with the
  installed one (a job field through the schema, the worker's allow-list and the contract files, for the same result on
  the rare manual retry, whose cost here is seconds to minutes; the cost: a retry of a late failure redoes `reference` and
  `georef`). Jobs lists its steps in the type's order.
- **88i APPLIED (finding 81): the panel's padding on Jobs.** A rule of `hcm-jobs-page`, not of the panel, which the Setup card
  also holds with its own padding. Finding 82: `cancel`, `check` and `check_circle` stand in for three unbundled icons. The `fonts` gate (`build-fonts.mjs --check`) now also
  refuses an icon the sources name that is not listed: the stricter, pre-approved kind.
- **88j APPLIED (findings 83, 84, lesson 360): the whole frame, joined right.** `MAX_SEGMENTS` 26 and a failure past it,
  `COARSE_ROWS` 2048 (a shrunk segment of about 3,100 by 2,090 px, two at a time: about 13 MB, far under the machine's
  memory), `MARGIN_SHARE` 0.03. A KH-9 frame now keeps about 13 GB of segments for its run, on the computer or in the bucket
  (the extra 5.6 GB there until the job ends). **For the owner:** whether to keep the 0.20 threshold is open until a real run
  of the whole frame reports its figure.
- **88k APPLIED (finding 85): a scene is freed when nothing can make its layer.** `functions/src/imagery/release-scene.ts`, on a
  dismissal and as the tick's part `scenes` (one query of the city's `imported` scenes). A failed version still holds its
  scene, since Try again may yet make the layer. Rejected: writing the freeing into the pipeline's failure (a retry needs the
  scene held), and a one-off repair of the live document (a cloud write by hand, which the next stuck scene would need again).

Verify: `PIPELINE_STAGE=static`, `tests` and `build`; targeted Playwright (`e2e/admin/specs/imagery/`).

## 89. Bacău is the second city of multi-city testing (2026-11-06) — APPLIED (the owner's decision: "for multi city testing we will use Bacau, Romania, not Iasi"; test, seed and documentation changes only; no gate relaxed; `seed/bucharest/` unchanged)

The local stack's seeded second city (`e2e/stack/seed-cities.ts`: `bacau`, its rectangle, Biserica Precista and Parcul Cancicov, generated test values), the tests' example city ids and the current documents. Past records (`docs/research/` logs, `docs/LESSONS.md`) keep what they say. One consequence, kept: `bacau` sorts before `bucharest`, so an admin of both with no remembered city opens Bacău first (`packages/admin/src/app/current-city.ts`, the first by name; S-A49-HAPPY-FIRST-SCREEN), and the stack's owner lands there.

## 90. The panoramic locate and the batch of the rehearsal (2026-11-06) — APPLIED (findings 86 to 90 of `docs/research/manual-test-2026-10-25.md`: product, test and documentation changes, one line added to the `fonts` gate's scan, the stricter pre-approved kind; each new text in both languages; no gate relaxed, no budget raised, no checker allowlist entry, no download; `seed/bucharest/` unchanged)

- **90a The first guess is the camera's, not four corners' homography**, for the KH-9 panoramic camera only (`SensorSpec.half_angle_deg` 60.5). Corona stays on the homography until a real run measures it (**UNVERIFIED**).
- **90b Acceptance:** the raw gate of 0.20 stays, or a masked gradient peak with ratio at least 2 and z at least 7. Calibrated on one frame; the real frame passes at ratio 2.10, so its margin is thin. A guess under both is not a failure (90c), which is why a thin margin costs points, not a job.
- **90c A weak guess goes to the points**, its crop holding every orientation that reaches the window, and its corner pairs dropped so they cannot spoil the admin's fit. **For the owner:** a weak crop of this frame would be 168504 by 21984 px, 3.7 GB in memory, with the matcher at 8.25 GB; a smaller computer is **UNVERIFIED**, and past `MAX_SCAN_PIXELS` it fails with the delivery kept.
- **90d Rejected:** lowering 0.20 (a wrong place reached 0.237 on this frame); a coarse scale and rotation sweep (not decisive at 220 steps in 611 s); retuning the half angle on one frame.
- **90e Coverage** uses the camera's outline for KH-9 panoramic scenes and is an estimate (the model's centre carries a constant shift of about 7 km on the measured frame).

## 91. M8: a whole-city layer by joining frames, and the target years (2026-11-06) — APPLIED (`docs/research/M8-join-interfaces.md`, the owner's request of 2026-11-06: code, tests and documentation; two new rows in the bundle budget, the stricter pre-approved kind; no budget raised, no gate relaxed, no checker allowlist entry, no download, no deploy; `seed/bucharest/` unchanged; no `fostulbucuresti` resource)

- **91a Decision D1 needed no yes: no budget rose.** `ADMIN_TOTAL_KB` stays 630 and every existing row stands; the baseline was at exactly 630.000 KB. The room came from two savings: `cssLiteralsPlugin` (`scripts/site/src/css-literals.ts`) now also minifies `html` templates and drops the line breaks left in `css` ones, 6.4 KB across the admin and a smaller engine (templates with `<pre>` or `<textarea>` stay as written, line numbers are kept), and the Upload view is a chunk, about 0.8 KB out of `imagery`. New rows in `scripts/ci/check_bundle_budget.py`: `join-card` 3 KB (2.4 measured), `upload-panel` 2 KB (1.2 measured). Measured: 627.8 of 630 KB on the production build; `imagery` 17.7 of 18, `editor-shared` 12.9 of 13. **For review:** Upload now shows Loading briefly on first open, and the minifying touches every template, so the wider Playwright run matters.
- **91b CR-M3-28 is closed, along with CR-M3-8.** `createCityRequestSchema` picks `imagery`, and `scripts/seed/bucharest.city.json` holds 1966, 1972, 1976, 1977, 1978, 1979, 1980, 1982, 1983, 1984; the seed manifest does not change, the bundle's `legacy/bucharest/city.json` gains them. The live city got them through Settings on 2026-11-06 (D2). The years come from this project's own plan (M3 §1) and the owner's request, not from any other site's resources.
- **91c Absolute error is not improved, and says so.** A join closes the gap between frames: the card shows the worst frame's own checkpoint error and the largest shift, and a correction a second measure finds unhelpful is refused. Rejected: an absolute measure of the mosaic, graph-cut or multi-band blending, bundle adjustment, a shared layer id for the parts, GDAL cutlines (M8 §1, §9).
- **91d UNVERIFIED, for the owner:** every seam figure and threshold comes from synthetic rasters; the time at about 2 Gpx, the disk and the `xl` memory are extrapolated; up to four downloads per frame on the worker. Rehearsal D3 (F006 + F007, then F039 + F040, real USGS downloads) calibrates them before the thresholds are frozen; `docs/MANUAL_TEST_PLAN.md` J1, J2.
- **91e A by-eye look at the public fostulbucuresti site is an owner step only** (`docs/MANUAL_TEST_PLAN.md` J8): never an alignment reference, no value recorded, nothing of theirs loaded.
- **91f Deployment order:** the admin's plan feed needs the `imageryPlans` rule; both go out in one Update the map (ask first).
- **91g Deviations from the contract:** M8 §11 to §16. Lessons 363 to 365.

## 92. Map labels: the visitor's street names and points of interest (2026-11-07) — APPLIED (the owner's request: code, tests and documentation; no gate relaxed, no budget raised, no download, no deploy; `seed/bucharest/` unchanged)

- **92a What is verified about the names, and how.** `showRoadLabels`, `showPointOfInterestLabels` and the Satellite style's support: Mapbox's documentation read on 2026-11-07 (the Standard API page lists all of them on Standard; the set-a-style guide says Standard Satellite takes all of Standard's configuration except the 3D objects and the colours, and uses `showPointOfInterestLabels` as its example). The pinned GL JS 3.34.1 source was read for `getConfigProperty`: it answers null for a style without the import or the property, which is what the switches rest on. **UNVERIFIED, for the owner:** no test reaches the real Standard or Standard Satellite style (tests never hit Mapbox), and the docs state no default values: the code assumes drawn unless told otherwise, and the map's own answer corrects that without a link's choice. `docs/MANUAL_TEST_PLAN.md` V5b is the live check.
- **92b `showPlaceLabels` and `showTransitLabels` stay the city's.** "Street names" and "points of interest" are what was asked; neighbourhood and city names orient a visitor on a map of the past, and a transit stop is a third thing. A city can still set both in `basemap.config`. *Superseded for transit by §175 (the owner, 2026-11-08).*
- **92c The admin's budget.** The admin stood at 630 KB of 630 KB gzip and bundles `MapPort`'s adapter and the viewer's main catalogue, so two methods on the adapter alone took it over (630,021 bytes). The viewer's extra goes through `ViewerMapPort` (`createViewerMapPort`, `packages/ui/src/map/viewer-map.ts`) and its words through a catalogue of their own; the admin measures 629,964 bytes with this change. The price: `FakeMap` implements the wider port, and the five-line read of a configuration property exists in `basemap.ts` and `viewer-map.ts`, so that the admin's minified adapter stays unchanged.
- **92d No manifest field.** `basemap.config` already says it. Absent `labels=` is the city's default on `hashchange` too, as an absent `cmp=` closes compare: the encoder omits a default, so "absent" must mean it.
- **92e No golden screenshots.** The tier has none (`toHaveScreenshot` appears only in the Playwright config); the tour's checkers and two reviewed ad-hoc screenshots stand in.

## 93. Browse thumbnails that do not freeze the tab, and Locate again (2026-11-07) — APPLIED (the owner's live use: code, tests and documentation; no gate relaxed, no budget raised, no download, no deploy)

- **93a Thumbnails are made in the browser, not on the server.** `functions/src/imagery/browse.ts` is unchanged: it has no image library, and adding `sharp` to the functions means a native dependency in every install bundle, for files already copied (a server-side fix would also need a backfill). The rejected option stays open if the transient decode below proves too much in live use.
- **93b What the fix does and does not do.** No `<img>` shows a copy any more, and no full-size bitmap reaches the page for a row (`createImageBitmap`'s resize). `createImageBitmap` still reads a file whole for a moment, off the main thread, so the pictures are made one at a time. A scene's preview (at most 2,048 px long) goes through `decode`, whose bitmap is full size until it is drawn: its proportions are unknown before, and the map's picture has always done the same. The row keeps `object-fit: cover`'s middle of the frame. A tall image is decoded twice (the first tells it is tall): USGS's strips seen so far are wide.
- **93c The bytes.** The admin stood at 629,964 of 630,000 bytes and the Imagery chunk at 17,943 of 18,000. `packages/admin/vite.config.ts` now resolves zod's English messages to a stand-in (`src/vendor/zod-locale-none.ts`, 0.8 KB gzip), as §86 did for its JSON Schema conversion: the admin reads an issue's `validation.*` code, never its sentence, so an uncoded issue's message in a log now reads zod's "Invalid input". Three small `@hcm/shared` modules only Imagery reads moved to the `editor-texts` chunk (1.2 of 2 KB), so Imagery pays for its own button. The imagery chunk then fetches `editor-texts` too, a request it had not made on its own; the group's name no longer says all it holds.
- **93d Locate again is a new callable, not an option of `imagery.retry`.** The states, what a run keeps and the refusals differ; `retry.ts` stays about failed jobs. It reuses `imageryVersionRequestSchema` and `imageryRetryResponseSchema`, so it adds no schema to the admin. **Deployment:** the admin's button needs `imagery-locateAgain`, so both go out in one Update the map (ask first).
- **93e A frame a live join holds may search again,** as `imagery.saveGcps` lets it take points: the join waits for its frames either way. A job on the owner's computer is not checked for its inputs, since the server cannot see them; there a run may download again if that computer's sweep removed both (M7 §5).
- **93f The version forgets `georef`, `calibration` and `suggestions` at the click:** if the new search fails, the job fails (Retry and Dismiss apply), and the refusal it had waited with is gone from the page.
- **93g Lessons 387, 388.**

## 94. Owner's decisions of 2026-11-07: the admin's bundle budget, the savings of §86h, Mapbox's scopes

- **§83b reviewed: `ADMIN_TOTAL_KB` raised from 630 to 650** (`scripts/ci/check_bundle_budget.py`). The owner's explicit decision. The total counts every lazy chunk, and it had become a hunt for bytes while the entry, what an admin waits for, stood at 367 of its 450 KB. The entry's budget and every chunk's are unchanged.
- **§86h reviewed: both savings kept.** The stand-in for zod's JSON Schema conversion and `sourcemap: 'hidden'` stay.
- **§83i decided: no Uploads API; tiles from the project's own public bucket.** Mapbox's documentation bills Uploads jobs in compute units with no per-job meter or cap (`docs/research/M11-mapbox-automatic.md`), so the path is not free as M7 §6 assumed. The owner chose to serve the historical layers' tiles from the project's public bucket, drawn over the Mapbox basemap: automatic after Approve. The bootstrap token the owner pasted that day carries the uploads scopes, unused.
- **`autoPublish` stays on** by the owner's choice: a frame with at least 90 % of the city and a held-out checkpoint within the threshold publishes by itself; every other waits for Approve. The owner sees each image before approving.

## 95. M12's pipeline and server: what was decided while building them (2026-11-07)

- **95a The step is `pyramid`.** The design said `tiles`; `PUBLISH_STEPS` already has one, in the same `job.steps` map, and the two would have overwritten each other's record.
- **95b A version on its own tiles records `own`, never a fake `mapbox`.** `published` and `superseded` need one of the two. A tileset an earlier version left stays on the layer's `mapbox`, so the 24-tileset count and the layer's deletion still see it: no new version deletes it. To review: such a tileset hosts on at Mapbox until its layer goes.
- **95c `layer-tiles` is a side job.** Its failure, cancel or invalid params never fail its version, because that version may be approved and waiting; the worker's `step` refuses it any state change. `succeeded` joins what a worker may write for this type only.
- **95d A failed tiles job is not made again by the tick,** so a frame that always fails costs one run, not one every five minutes; its Retry is the owner's. The cost: such a version waits until someone looks.
- **95e No COG or Studio file on the default path,** as designed: about 300 MB less per frame. A version without a COG always publishes its own tiles, even after the city turns Mapbox on.
- **95f The `imagery.tick` parts `ownTiles` and `ownTilesClean` stop while the budget guard is red,** like every other part that starts work; a superseded archive just stays longer.
- **95g One sweep step per city per tick,** where the design says one version a tick: the part runs per city, as every tick part does.
- **95h Lessons 393, 394, 395.**

## 96. M12's viewer and approval view: what was decided while building them (2026-11-07)

Applied: code, tests and documentation; no gate relaxed, no budget raised, no download, no deploy, no cloud touched; `seed/bucharest/` unchanged; no `fostulbucuresti` resource. Two new rows in the bundle budget, by the same rule as §91.

- **96a Two new chunks, no row raised.** `imagery` was at 18.0 of 18. `approval-map` (5 KB, 3.5 measured) is a version's whole page, more than the design's view alone, because the view alone would not have made room: `imagery` is at 16.2 now. `mapbox-choices` (2 KB, 1.3 measured) is what only a version going through Mapbox fetches. Refused, the alternative is the entry, as the design says. **To review: the two rows.**
- **96b A version's map starts at 100 %.** It started at 80 %, and a published layer starts at 100 % (`functions/src/imagery/finalize.ts`): the owner would have approved a paler image than visitors see.
- **96c Swipe compare was not built.** The design calls it last and optional: a second map is one more billed load and the slider already compares over the basemap. Nothing in the view depends on it.
- **96d Statistics does not exist.** The design says Statistics sums the published bytes; the admin has no such page. The approval card says each version's size. **To decide:** a total of what the bucket holds, and where.
- **96e See the image is a scroll, on every window.** The design says the map gives way on compact windows; it does not: `imagery-styles.ts` keeps it above the detail, 240 px at least, at full width. So the button brings the map back from the card below it, with no new load.
- **96f A failing tile takes the layer off the map.** One failed tile means the address ran out or the bucket refuses, and the next tiles would too: the small picture stands in, the page says so, and Try again signs a new address. There is no timer for the hour: a page left open longer than that only fails when it next needs a tile.
- **96g The picture's own edge before the proof's.** `output.outline` (the alpha's edge) shades the map when it exists, else `calibration.outline`: what is shaded is what this picture misses.
- **96h Local stack.** The emulator's signer needs an owner's header no browser sends, so the image cannot show on `npm run dev:stack` (docs/SETUP.md); changing the stand-in for a manual run was not worth a second signer. The e2e tier answers that address from the object.
- **96i Lessons 396, 397, 398.**

## 97. Roles and review (2026-11-07) — APPLIED (the owner's decisions: code, tests and documentation on `track/roles`; no gate relaxed, no budget raised, no download, no deploy)

- **97a The contract** is `docs/research/M13-roles.md`.
- **97b Two new chunk rows**: `review` (4.1 KB measured) and `contribute` (3.5 KB), each plus about 20 %, in `ADMIN_CHUNK_BUDGETS`; the admin's total 642.8 KB of 650, the entry 372.1 of 450, the engine 95.4 of 100 and its IIFE 121.7 of 125: none raised.
- **97c `admin` access narrowed.** It now leaves out an account whose every role is `moderator` or `uploader`; `notify.*` moved to a new `member` access. An account with no city at all keeps what it had.
- **97d The Contribute page is a route of the admin**, not a page of its own: it reuses sign-in, the catalogues and the Mapbox loader at the cost of one chunk. A signed-in account of no role gets the new auth state `visitor` there instead of being signed out.
- **97e No `minVersion`.** No release is tagged, so the manifest's additions join the v1 baseline, as `photosOverlay` did.
- **97f For review: a pending photo's duplicate check.** `photos.onUpload` still refuses a repeat of another photo of the city and names it in `duplicateOf`, so an uploader can learn that a file they hold is already in the city and its id. Nothing else of that photo is readable to them.
- **97g For review: no daily limit on an uploader's uploads.** Rules cannot count; an uploader is a person an owner approved, and an owner can revoke them. Say if a cap is wanted.
- **97h One more chunk row**: `proposal-fields` (0.5 KB measured, budget 1 KB): the Contribute page and the Review page's adjust share the value fields, which took `editor-shared` to 13.2 KB against its 13. No budget raised.
- **97i Findings of the M13 review, applied**: `photos.onUpload` decides from the path's uid and the status when it runs; `review.decide` binds an approval to `seenAt`; a suggestion keeps only what changes and its decision records its own way back, so `suggestions.decide` takes `revert` and the Review page no longer guesses a history entry (`history.revert` stays for the rest). `docs/research/M13-roles.md` §§2, 4, 9.
- **97j For review: an approved date text and the other language.** A correction typed in Romanian keeps the English text as it stood, as asked, so the two can disagree until someone edits the other. Say if an approved date text should drop the other language instead.
- **97k For review: Revert refuses when the same fields changed since**, rather than restoring the fields nobody touched. It says so and points at the photo's History.

## 98. Viewer input: shortcuts, gamepad, the basemap's light, the accessibility statement (2026-11-07) — APPLIED (`docs/research/viewer-input.md`, the owner's request: code, tests and documentation; one new row in the bundle budget, the stricter pre-approved kind; no budget raised, no gate relaxed, no download, no deploy; `seed/bucharest/` unchanged)

- **98a New budget row: `gamepad`, 2 KB** (1.6 KB measured). A chunk without a row fails, so this tightens.
- **98b The IIFE's margin is gone: 125.0 KB of 125** (engine.mjs 97.4 of 100, a few bytes left). The IIFE inlines every chunk, so a lazy chunk does not help it. To fit, the texts are terse, messages were reused (`layers.opacityChanged`), and five catalogue keys nothing read were removed (`engine.name`, `admin.title`, `timeline.noLayer`, `photo.marker`, `poi.marker`). **For review:** any further growth of the engine needs a budget decision from the owner, or savings first.
- **98c What the budget cost in the texts.** The help panel does not mention screen readers' browse mode (documented in `docs/ENGINE_API.md`); the statement does not say the photos are also a list, nor that automated tests check what works. Worth restoring if the budget is raised.
- **98d For review: how to report a problem.** The manifest has no contact field, so the statement sends people to those named above it in About. A city whose About and Credits name no contact leaves that sentence empty of help; a `city.contact` field would be a schema change, not made here.
- **98e Single-key shortcuts have a switch** (WCAG 2.1.4), stored in localStorage like language and theme, no cookie. No claim of conformance is made anywhere.
- **98f Not done: a real gamepad.** None was available; every gamepad test uses a fake `navigator.getGamepads`. `docs/MANUAL_TEST_PLAN.md` C4b asks a person to try one. Two viewers on one page would both follow the pad.
- **98g Lessons 420, 421.**

## 99. Start your own map from a browser (2026-11-07) — APPLIED on the track's branch (the owner's request; contract `docs/research/M14-start-your-map.md`)

- **99a CR-M5-7 finished.** `github` optional, the provisioner and Setup without it, `self-host` and `deploy` without `--experimental` (still accepted). `S-V29-BAD-NOT-AVAILABLE` became `S-V29-BAD-NO-BUNDLE`: the refusal it tested is gone.
- **99b The same tab, no Google script, no client secret.** The OAuth 2.0 flow for browser apps, not the code flow with PKCE, which needs a secret at Google's token endpoint for a web client. Reasons and risks: the contract §2.
- **99c The page's own Hosting site, its release files on the same origin.** Not jsDelivr (GitHub packages over 50 MB) and not GitHub Releases (no CORS, third-party reports). The contract §5, §6.
- **99d Pre-approved kind, logged.** A new gate `start-build` and a new row `dist/start-app/start.mjs` of `check_bundle_budget.py` (69.0 KB measured, 72): stricter. `tsconfig.tools.json` and `scripts/site/tsconfig.json` name the new entry and config: keeps the tools working. The admin's total and every existing budget are unchanged.
- **99e For the owner to decide (ask first, nothing was done).** Create the OAuth client and set `HCM_START_OAUTH_CLIENT_ID`; create the Hosting site `start-historic-city` and deploy `dist/start/`; submit verification. The first real run from a clean Google account proves §9 of the contract, the upload host's CORS above all.
- **99f New shared surface.** `GENERIC_INSTALL_PROJECT`: an admin accepts a bundle made for no project; a site build of one adopts the project in its `fetch` step. Bucharest's own bundle is unchanged, byte for byte.

## 100. The merge of photos, roles, input and the start page into the own-tiles branch: the bundle budget (2026-11-08) — APPLIED, no budget raised

After the four merges the build failed its budget: the engine's IIFE at 127.8 KB of 125, `engine.mjs` at 100.2 of 100, the admin's total at 654.6 of 650 and `editor-shared` one byte over its 13 KB. Two real savings, no feature removed:

- **100a zod's JSON Schema conversion leaves the engine too.** The engine resolves the two imports of zod's classic schemas to the admin's stand-in that throws (§86), through one plugin both builds use (`scripts/site/src/zod-stand-ins.ts`, unit-tested); the engine never converts a schema to JSON Schema nor reads the derived getters. zod's English messages stay in the engine (§93 is the admin's). The IIFE is 122.1 KB of 125, `engine.mjs` 94.6 of 100.
- **100b Terra Draw keeps only its modes in use.** `loadTerraDraw` destructures each dynamic import where it is awaited, so the bundler drops the modes the admin never builds (circle, freehand, sector, sensor, angled rectangle); both packages declare `sideEffects: false`. The `terra-draw` chunk is 35.7 KB instead of 47.7, the admin's total 642.6 of 650, the entry 377.6 of 450, `editor-shared` within its 13. The budget row of `terra-draw` stays at 58.
- **100c Behaviour ids renumbered at the merge.** Own tiles had taken V32 and A70, so the input track's V32-V35 are V36-V39 and the start page's A70 is A76; LESSONS items and DECISIONS sections of each track follow the ones before them (roles §97, input §98, the start page §99).
- **100d For review: the gallery of unplaced photos shows no source link.** The photo sheet shows the photo's source (the photos track) under the credit lines (the roles track); the gallery card shows the date and the credit lines only, as it shows no description or links either. Say if the gallery should link the source.
- **100e A suggestion that changes a photo's years drops the old year's month and day** (as it dropped the date text), and its revert brings them back; a correction cannot propose a month or a day.
- **100f Gates the tracks left red, fixed at the merge.** In files the merge left as the start track had them: Prettier (two `start.failure.refused` texts over a line, now shorter in both languages, as the i18n gate wants one line per entry), ESLint (`submit`'s complexity, an unused binding in a test, `renderGithub`'s two return types), knip (five exports nothing imports), `test_check_bundle_budget.py` (the start page's row sorts first), the shared API test (the start page's twelve exports, `exports-m14.ts`) and the per-file coverage of `setup-wiring.ts`, `content/services.ts` and `start/build.ts`; of the roles track, the coverage of `hcm-admin-photo-list.ts` and `hcm-unplaced-gallery.ts`. Of the merge itself: `e2e/tour/states.ts`, `app/mount.ts` and `shared/test/index.test.ts` over their line limits (the input journey moved beside its states, the photos section's visits named once, two exports into the M9 list).

## 101. The owner's nine improvements (2026-11-08) — APPLIED on `track/improve` (`docs/research/M18-improvements.md`; no budget raised, no gate relaxed, no deploy)

- **101a The tab reloads itself after a deploy** only when it is hidden or the owner has just come back (10 s) and nothing is unsaved; otherwise the Reload banner, as before. For review: a reload on return loses a scroll position or an open dialog that is not an unsaved edit.
- **101b Locate again is free in attempts** (one run of its own, as the admin's points) where it refused at `JOB_MAX_ATTEMPTS`, and `imagery.tick` asks it by itself once per new pipeline image, at most three frames a city a tick. Each is a pipeline run; the budget guard and Cloud Run's free-tier meter still apply.
- **101c The day's limit counts imports only** (`usgs-import`, `geotiff-import`, `layer-join`); new points, crops and tiles no longer count. The cap was a spend guard; re-runs download nothing.
- **101d Join when it ends waits in the open admin only** (every minute, two hours at most), not on the server: a server-side queue of joins would be a new job state. S-A65-HAPPY-JOIN-WHEN-FREE is `planned` until the e2e world can seed a frame published on a busy layer.
- **101e One Delete changes words only**: each stage keeps its callable (cancel, reject, the layer's delete); a deleted version reads Deleted.
- **101f No budget raised.** `editor-shared` crossed its 13 KB by 16 bytes with nothing of it changed (the export lists of the chunks around it did); `scene-refusal.ts` (the Imagery area's and the order card's) joins `editor-texts` beside §93's modules (`IMAGERY_UI_SHARED_MODULES` in `packages/admin/vite.config.ts`). The Layers page's new 48 px link rule is the page's own style, not `layers-styles.ts`, which Settings shares.
- **101g Review of §101 (2026-11-08).** The self-reload also waits for an upload being sent (`AreaStore.busy`, Imagery's GeoTIFF and the Photos queue), which the unsaved guard still does not ask about. What needs you lists a count it could not read with a dash, and one still being read with an ellipsis. Home does not ask for a count the role may not read: an editor's or moderator's role requests, an uploader's suggestions. The tick's Locate again leaves a frame alone while an editor places points on it. The georeferencer marks the job `placingPoints` (stamped; a new client write, only on a job `awaiting_gcps`, `firestore.rules`) at the first edit and every 30 minutes, and the tick holds for `PLACING_POINTS_HOLD_MS` (2 h). Only the image the Cloud Run job runs counts: while the job cannot be read, nothing moves. A failed crop's Locate again counts its runs as Retry does (`attemptsExhausted` at `JOB_MAX_ATTEMPTS`); a parked frame keeps its run of its own. A frame waiting for points is deleted with `imagery.reject` (it reads Deleted). An image stopped at the guard is offered Delete beside the three ways out. For review: the mark is a new field clients may write; a closed tab leaves its mark for up to two hours.

## 102. Stories (2026-11-08) — APPLIED on `track/stories` (the owner's decision; contract `docs/research/M17-stories.md`: code, tests and documentation; one new budget row, the stricter pre-approved kind; no budget raised, no gate relaxed, no download, no deploy; `seed/bucharest/` unchanged)

- **102a A new admin chunk row, `stories`: 5 KB** for 4.3 KB measured (`scripts/ci/check_bundle_budget.py`). The admin's total is 647.9 of 650 with it, the review queue's third list included.
- **102b `editor-shared` one byte over, fixed by a move, not a raise.** With the stories area importing the editing kit `editor-shared` measured 13,001 bytes of 13,000. The Markdown renderer `packages/ui/src/viewer/markdown.ts`, which the settings' texts and the place editor share, joins the `editor-texts` group (`packages/admin/vite.config.ts`, `MARKDOWN_MODULES`): `editor-shared` 12.8, `editor-texts` 1.4 of 2, the total unchanged. A build configuration, not a lint or tool config.
- **102c The engine grows within its budgets.** `engine.iife.js` 124.0 of 125 KB, `engine.mjs` 96.3 of 100: the stories' sheet, element, five viewer texts per language and the hash's `story=` are in the entry (no lazy chunk: the IIFE inlines every chunk anyway, §13a). **For review:** the IIFE has about 1 KB left; the next viewer feature needs savings or the owner's budget decision.
- **102d Two behaviour ids taken: V50 and A100**, far from the last ones (V41, A94), so the tracks that run beside this one do not collide at the merge.
- **102e For review: the stories icon is `museum`**, one the icon font already bundles (a new glyph rebuilds the font subset). `history_edu` or `auto_stories` would say "story" better; either needs `npm run fonts:build --workspace @hcm/ui`.
- **102f For review: a story is created before it is written.** New story asks for a Romanian title and creates the document unpublished (an uploader's waits for review at once, with that title), so the editor is the layer editor's `EditDraft` on a stored document. A reviewer may see a waiting story before its text: approving it is refused only by `seenAt` if it changes, and an approval of a story with no text publishes nothing (the builder lists only a story with a body).
- **102g For review: an uploader's own create through the admin.** The stories rule lets an uploader read a story id that has no document yet (the admin's create reads it in a transaction). Places and photos keep M13's rule, which likely refuses an uploader's create through the admin the same way (`docs/LESSONS.md` 443); not changed here, the roles track's rules.

## 103. Recalibrate a published layer: a new chunk, and the admin's request schemas out (2026-11-08, track/recal) — APPLIED, no budget raised

`docs/research/M16-recalibrate.md`. Numbered after §100; the integrator renumbers if another track took 103.

- **103a A new chunk `recalibrate-card`** (0.8 KB measured, row 2 KB in `check_bundle_budget.py`): the version page's Calibrate again block and a recalibration's figures, fetched only on a page that offers or shows them. The admin's total is 645.4 of 650.
- **103b `editor-shared` paid with a real saving.** The new callable's schemas took it over 13 KB; the admin's `imagery/api.ts` now carries only the response schemas (which check answers) and keeps the request schemas as types: the server validates every request. 12.9 KB after.
- **103c For review: Approve of a recalibration not shown better asks first.** "Not shown better" includes "not measured on the same checks" (a manual edit without three disabled pairs), so the georeferencer's Save on a published layer now takes one more confirmation at Approve. A recalibration never publishes itself, whatever its figure.
- **103d For review: the re-join of a joined layer is not built** (M16 §6): a join answers `joinRecalibrate`, refined frame by frame.
- **103e New registry row `imagery.recalibrate`**: 91 functions on the track, 93 with stories' two after the merge (`setup-cloud.test.ts`, `clients.test.ts`).
- **103f Review fixes of M16 (2026-11-08).** A recalibration's figures count only against the layer's published version (dropped by the policy otherwise, so Approve asks); the worker may not write `recalibration`'s server part; `replaces` acts only on the own base; a waiting version records the refine started from it (`refining`, new optional field of `layerVersionDocSchema`); a publish clears only its own pending mark (`finalize.ts`, all versions); new decline code `apiError.imagery.refineUnmeasured`. For review: the joined layer still has no recalibration; its message now says so instead of advising frame refines.

## 104. The merge of the improvements, stories and recalibration (2026-11-08) — APPLIED except the admin's total budget, which stays over (no budget raised)

Three merges into `feat/engine-rewrite`, one merge commit each (`track/improve`, `track/stories`, `track/recal`, all from f2f917b). Numbering at the merge: LESSONS improvements 442-443, stories 444-448, recal 449-453; DECISIONS §101 (improvements), §102 (stories), §103 (recal). Behaviour ids did not collide (stories V50 and A100, recal A89 and P19; the improvements added rows to existing behaviours).

- **104a Delete on a recalibration (M16 with M18 item 5).** The one word stays *Delete*; on a recalibration whose current version is published the question is *Delete this new fit?* (only the new fit goes; the published version stays) and the notice says the published version stays (`rejectRecalibration`, `notice.rejectedRecalibration`). A recalibration of a version that was waiting asks as any image does: that version was cancelled once the new one rendered, so "the published one stays" would be false (S-A89-HAPPY-DELETE-NEW-FIT, S-A89-BAD-DELETE-WAITING-BASE).
- **104b Calibrate again and the day's limit (M16 with M18 item 3).** A recalibration is a `regeoref`: it renders a scan already here, so with the improvements' `COUNTED` it never counts against the day's import limit and is stopped only while the budget guard is red (S-A89-HAPPY-FREE-OF-DAY-LIMIT, S-A89-BAD-GUARD-RED). Locate again needed no change: a `regeoref` job has no `locate` step, so neither the tick's relocate nor a failed crop's Locate again ever takes a recalibration.
- **104c What needs you and the stories' review queue (M17 with M18 item 7).** Home lists *Stories to review* (stories with `reviewStatus` pending, a link to `#/review`) beside the suggestions; an uploader is not asked (the rules let them read only their own stories), as M18 already did for the suggestions; an uploader has no Home anyway (its address opens Photos) (S-A40-HAPPY-STORIES-TO-REVIEW, S-A40-BAD-UPLOADER-NO-STORY-COUNT). **For review:** photos and places waiting in the same queue are still not counted on Home (they were not before the merge either); one count each would follow the same pattern.
- **104d Join when it ends has its e2e test.** `e2e/admin/specs/imagery/join-wait.spec.ts`: a frame published as its own layer, a `regeoref` job still running on that layer seeded in the emulators, Join frames refused in words, Join when it ends, the page's clock moved on a minute at a time; S-A65-HAPPY-JOIN-WHEN-FREE is `exists`, with the tour state `imagery.join-waiting-free`. S-A61-BAD-UPLOAD-HOLDS-RELOAD, S-A40-BAD-COUNT-UNREAD-SHOWN, S-A19-BAD-LOW-CONTRAST-SEED and S-A20-BAD-NO-APP-CHECK stay `planned`.
- **104e Gates the tracks left red, fixed at the merge** (LESSONS 454): recal's `auto_fix_high` (now `tune`), its two-line Romanian string, the fake deployment's third (31 of 93), the shared index's line limit.
- **104f For review: the admin's total is over its budget.** Measured on the NUC after the three merges: 653.6 KB of 650 (642.6 at f2f917b: stories about +5.3, recal +2.8, the improvements +3.1). The entry is 381.3 of 450 and every chunk within its row. Probes for a real saving found too little to close the gap: the error table `API_ERRORS` out of the admin 0.7 KB; the callables' request schemas out of the table 0.1 KB; no module is duplicated across chunks; the colour library's 2021 spec is the 2025 spec's base class. No budget was raised and no feature removed: the owner decides between a raise of the total and a larger refactor (for example the uploads without the Storage SDK).

## 105. The owner's decision of 2026-11-08: the admin's total budget is 700 KB

- **`ADMIN_TOTAL_KB` raised from 650 to 700** (`scripts/ci/check_bundle_budget.py`), the owner's explicit choice among 660, 700 and a refactor. The merge of stories, recalibration and the improvements measured 653.8 KB; the searches of §104f found no saving worth its risk (0.8 KB at best). The entry (381 of 450 KB) and every chunk keep their own budgets.

## 106. The Sentinel-2 reference guard (2026-11-08) — APPLIED (M15, the owner's request: code, tests and documentation; one constant added to the shared contract; no gate relaxed, no budget raised, no admin byte added, no deploy; `seed/bucharest/` unchanged; no Mapbox Satellite or `fostulbucuresti` resource)

- **106a The numbers.** 5 candidates, 30 days apart, a 10 km patch, 7.5 m. The bound sits between the largest clean offset (6.2 m) and the smallest shifted one (8.7 m) of 79 scenes of 35TMK; 5 candidates survive 2 bad ones; 30 days makes 2024-10-21 and 2024-10-26 one vote. Each is a constant of `agreement.py`; the owner may prefer 7 candidates (survives 3, about 40 % more download).
- **106b Choose, never correct.** The kept scene is used as it is, its offset recorded; it is not shifted onto the consensus, whose own error (about 1 m from 5 scenes) is the size of a sound scene's offset. Bucharest and Pitești therefore keep the scenes their frames were calibrated on, and no map moved.
- **106c `unchecked` and `disputed` proceed.** A cloudy place may have one or two clear dates in three years (Quito had 5 items); failing them would leave the city without a reference. They take the least cloudy readable date, warn in the job log and say so in `s2Check`.
- **106d No admin surface yet.** The imagery chunk is at its 18 KB limit; the version record and the job log carry the verdict. A line on the version's page is the natural next step, paid for elsewhere.
- **106e The verdict lives in the cached window's metadata** (`HCM_S2_CHECK`), not in a new object path: no change to `paths.json`, the Storage rules or the lifecycle. A cached window without it is measured again and replaced.
- **106f `written-documents.json` regenerated:** the shapes gain `reference.s2Check`; byte counts, scores and hashes that differ by machine were refreshed with it (only shapes are compared).

## 107. The joint solve: each new frame lined up with the accepted frames it overlaps, which stay still (2026-11-08) — APPLIED (M15, the owner's request: code, tests and documentation; one version file and two constants added to the shared contract, one lattice model, the local worker's read-only allow-list widened; no gate relaxed, no budget raised, no deploy; `seed/bucharest/` unchanged; no Mapbox Satellite or `fostulbucuresti` resource)

- **107a New frames join; old frames are held, never moved.** A proved frame is fitted on its own Sentinel-2 tiles plus film ties to every accepted (`approved`, `publishing`, `published`) proved frame over it, each tie nine times a tile's weight; the held frames' maps are what their layers show, and nothing published is rendered again. The evidence measured a new frame joining a held pool at 5.65 m against 5.64 m for solving all again, and old frames moving 0.31 m with a pool of ten, so no re-render is needed. Re-aligning an older frame with newer ones is the owner's choice: the version page says so; a one-click action for it is not built.
- **107b No chain.** Every frame keeps its own Sentinel-2 tiles, and a frame placed only by the admin's points is never held: a position never travels frame to frame (the evidence: 12 m RMS after one hop, 93 m after ten).
- **107c The numbers.** `MIN_TIES` 100 and `MIN_SHARE` 0.25 (a wrong frame gated at most 1.3 % of its tiles, real pairs at least 51 %); `DISAGREE_M` 6 m between the largest offset of a real partner in the full city (1.36 m) and what a published error must be to matter; the furthest partner beyond it leaves first and the rest are measured again (lesson 465). `TIE_WEIGHT` 9 is M15 step 4's; measured noise weights read the same as a flat weight in the evidence. 12 partners at most, newest first. Each is a constant of `calibrate/joint.py` or `steps/aligning.py`.
- **107d The models.** A KH-9 pan frame keeps its camera, joined; any other frame takes a cubic on every tile and tie, restricted to the film's measured box (beyond it, the cubic's value at the box's edge plus the growth of the second-order fit of the same rows: `together.py` `Restricted`), since the cubic alone ran to 43 to 52 m on a half frame (M15 *Joint solve*). The camera is not restricted: carrying its bend on a tangent read worse at the edges in the review of 2026-11-08.
- **107e `align.tif`, a new version file.** A proved frame's grey at 5 ground metres on the city's align grid, deflated, 0 no data (`export`); a later frame's ties are measured on it, one at a time. It is deleted with the version's other files by `imagery.tick`.
- **107f The local worker reads the city's versions.** `worker.step` lists and reads every `cities/C/layerVersions/*` (target `held`, read-only) and `worker.urls` signs GET of `rasters/C/*/*/align.tif`; writes are unchanged (the run's own version and job only). It is what the owner's own admin pages already show, to the owner's own computer (M7 §2.5). A worker on a server without it fits the frame alone and logs why.
- **107g The admin's words.** On the version page: "Lined up with your photos of {years} at {ties} shared points", "Those photos stay where they are; lining them up with this one is your choice", and "Not lined up with {years}: their streets sat over 6 m from the others" (the text names the bound of 107c). The join chunk was at its 3 KB: the words' data comes from the shared schema module (`alignedWith`, in `admin-core`), and two expressions of the join card were written shorter; join-card 2,983 bytes, imagery 17,985.

## 108. Terrain: a KH-9 panoramic frame seen off nadir fitted and rendered over the Copernicus DEM (2026-11-08) — APPLIED (M15 *Terrain*, the owner's request: code, tests and documentation; one shared constant (`DEM_ATTRIBUTION`), one reference kind (`dem`), one optional georef field (`terrain`), one optional pipeline variable (`HCM_DEM_URL`); no gate relaxed, no budget raised, no admin byte added, no deploy; `seed/bucharest/` unchanged; no Mapbox Satellite or `fostulbucuresti` resource)

- **108a The source and its licence.** Copernicus DEM GLO-30, the public COG tiles on AWS open data (bucket `copernicus-dem-30m`, eu-central-1, anonymous https), read through `/vsicurl/` for the city window only and cached 90 days as `reference/{city}/dem/{key}.tif`. The licence is free with a source notice; it was read and recorded with the open references (`~/hcm-calib/ref/LICENCES.md`, `provenance.json` on the NUC). The heights reach a published layer only as geometry, and that layer's attribution adds the notice after USGS's (`DEM_ATTRIBUTION` in `@hcm/shared`, `finalize.ts`). The address goes through the same guard as Sentinel-2's assets; under the emulators a real address is refused and the frame is fitted flat.
- **108b Who is corrected.** Only a KH-9 pan frame whose camera holds: the camera gives the view's direction and tan. Under 1 m of relief beyond a second-order fit (`RELIEF_MIN_M`) the frame is fitted exactly as before; KH-7 and KH-9 mapping keep their polynomial (no pointing known). The tan is scaled by what the frame's own tiles show, never above the geometry (`terrain.py` `_shown`), chosen on the ruler over the geometry alone and a 450 m surface (M15 *Terrain*).
- **108c How it renders.** Through an RPC00B with the surface model (`gdalwarp -rpc -to RPC_DEM`), stored as `georef.terrain.rpc`; the 17 x 17 lattice stays the flat map. A lattice cannot hold the relief (A001: 11.3 m RMS lost, lesson 466); a denser lattice would need hundreds of kilobytes in the version document and a thin-plate solve of thousands of nodes. Without the surface at the warp, the lattice renders, flat, with a warning. Superseded by §109: the lattice samples the ground map, every reader goes through the RPC over the heights the record carries, and there is no fallback.
- **108d What it buys and what it does not.** Film ruler 6.50 → 5.93 m (3.2 km, gain not proved: −0.08 to +1.35) and 9.19 → 8.23 m (8 km, +0.28 to +2.02); F006 over Pitești, Sentinel-2 held out, 17.2 → 13.9 m and 20.9 → 15.0 m; OSM rails 12.04 → 11.99 m, no proved change. KH-7 reads 0.25 m worse on its 3.2 km pairs (an error it shared with the corrected frames is gone from theirs only). A join of several frames (M8) renders its parts flat. Superseded by §109b (a join's part shows its layer); the per-frame view by the three-cornered hat is in M15 (KH-7 worse at both scales).
- **108e The local worker** fetches the tiles itself, like Sentinel-2's, and keeps the surface on the computer with the rest of the reference cache (M7 §2.5: nothing signs it).

## 109. Terrain, after its review: one map for every reader, a surface read whole (2026-11-08) — APPLIED (M15 *Terrain*, *Review of the terrain*; the review's four findings: code, tests and documentation; one georef field (`terrain.heights`), one shared export (`terrainTransform`); no gate relaxed, no budget raised, no deploy; `seed/bucharest/` unchanged; no Mapbox Satellite or `fostulbucuresti` resource)

- **109a The frame carries its heights.** `georef.terrain.heights`: the city surface's cells under the scan (300 m, to the decimetre, uint16 in base64: 23 to 27 KB of text for a Bucharest frame, under a twentieth of a version document's limit). Every reader then shows the one map the layer shows: the warp (`RPC_DEM` is the record's cells), a join's part and the next frame's ties (`steps/warp.py` `attached`), the georeferencer (`terrainTransform`). The alternatives: a denser lattice (needs hundreds of kilobytes and a thin-plate solve of thousands of nodes, and still metres off: 108c), or the georeferencer showing the rendered layer's PNG (nothing before the render, and no map for the suggestions or the frame). The surface is read on 300 m cells so the record stays small: the map moves 0.34 m RMS on A001 against the 30 m surface, and the ruler reads the same (5.94 against 5.93 m at 3.2 km, 8.25 against 8.23 at 8 km, both inside −0.10 to +0.04).
- **109b A join's part over terrain** is read through its RPC onto the level's grid before its nodes, which then carry only the seam's field: nodes in scan pixels would carry the relief only between them (43 m RMS on a synthetic hill). It costs a second bilinear resampling where a part has nodes.
- **109c No fallback at the warp.** The record is all the warp needs, so a missing surface can no longer render the flat lattice (worse than the flat fit it replaced, finding 1).
- **109d A surface is read whole.** A tile that cannot be read leaves the city without a surface (fitted flat, with a warning, nothing cached), never ground at 0 m; a window touching a GLO-30 tile that does not exist (open sea) is therefore never corrected (finding 3).
- **109e The relief is gated after its scale** by what the tiles show: a frame whose tiles show none of it is fitted flat, not credited (finding 4).
- **109f The georeferencer's chunk.** `terrainTransform` adds about 0.3 KB gzip to the georeferencer (16.7 → 17.0 KB, budget 17): paid for with its scan pixel going back through the lattice (the same map sampled on its nodes; only the box the preview is drawn in reads it, within 18 m on the real frames) and with three copies of a number formatter and four clamps that `@hcm/shared` and the imagery texts already hold. Its toPixel is GDAL's within 8 µm on the real frames. What the page draws stays the M3 mesh of 16 x 16 quads (1.9 to 6.8 m RMS from the map, about a pixel of the preview at worst); a denser mesh was measured, not built.

## 110. The merge of the accuracy track (M15) into the recalibration (M16), and the georeferencer's chunk at 18 KB (2026-11-08) — APPLIED (the owner's decision in chat, 2026-11-08: the `georef` row of `ADMIN_CHUNK_BUDGETS` rises from 17 to 18 KB; one new lazy chunk `georef-extras` (row 2 KB); no gate relaxed, no other budget or threshold raised, no deploy; `seed/bucharest/` unchanged; no Mapbox Satellite or `fostulbucuresti` resource)

- **110a The merge.** `track/accuracy` (M15: the camera and terrain maps, §108, §109) into `feat/engine-rewrite` (M16: Calibrate again, Refine, Snap my points). 45 files changed on both sides; the conflicts were additive (both tracks' rows in `e2e/scenarios.json`, `docs/LESSONS.md`, this log, the imagery texts in ro and en, `packages/shared/src/index.ts`'s exports, the pipeline's contract files, `enums.json`, `written-documents.json` and the fakes) and were kept whole, both sides. Where the two met in code (`packages/admin/src/georef/georef.ts`, `state.ts`, the georeferencer's parts and port, the join card, `finalize.ts`, the worker's allow-list, the pipeline's `georef` and `export` steps), both sides' behaviour was kept: the georeferencer of a published camera or terrain version shows the map the layer publishes (M15), beside Snap my points (M16).
- **110b A fix the merge's run found** (lesson 471): the georeferencer's preview of a frame over terrain stayed missing when the scan decoded before the map was ready; `GeorefPictures.mapStatus` draws the pictures again once the map is ready. Present on the accuracy track alone; not caused by the merge.
- **110c The lazy split.** Together the two tracks put the `georef` chunk over its 17 KB. What only some pages need moved to a lazy chunk of its own, `georef-extras` (`packages/admin/src/georef/georef-extras.ts`, fetched by `extras.ts`): the map a camera's lattice or a frame over terrain publishes, and Snap my points with its save request (`save-request.ts`). The orders' texts moved out of `admin-imagery` to their own catalogue, `admin-orders/`. A chunk that cannot be fetched says so in plain words and leaves the page working on the pairs' fit (`S-A16-BAD-TERRAIN-CHUNK`, `S-A89-BAD-SNAP-CHUNK`). `georef-extras` measures 1.0 KB gzip, row 2 KB (the measurement plus about 20 %, rounded up).
- **110d The owner's decision.** After the split, the `georef` chunk measured 17,160 bytes gzip against 17,000: what is left is the page every georeferencing needs (the pairs, the fit, the preview and the terrain map's reader `terrainTransform`, §109f), with no further split that does not put the first paint behind a second fetch. The owner chose (2026-11-08, in chat) to raise the row to 18 KB rather than trim the page further; the comment at the row in `scripts/ci/check_bundle_budget.py` cites this section. No other row and not the admin's total budget rose.

## 111. The old site's 2023 additions (2026-11-08, track/oldphotos) — APPLIED, no budget raised

The owner confirmed that the GitHub account `bucurestiuldisparut` is theirs and asked to import every photo the migration missed from `bucurestiuldisparut/bucurestiuldisparut.github.io` (approved download of those files). Contract: `docs/research/M5-interfaces.md` §12; lessons 472-473.

- **111a What was missing.** The account added 23 photo files after its fork; 11 were already in `seed/bucharest/` (it was taken from a copy that had them), so 12 photos with 12 viewpoints (24 features) were imported. None is in `fostulbucuresti/fostulbucuresti.github.io`'s tree or history, by name or by blob.
- **111b Where they live.** `seed/bucharest-2023/`, the shape of `seed/bucharest/`, which is unchanged; ids reserved against the 45 (`migrate-legacy.mjs --joins`, `migrateLegacyPhotos(…, reservedIds)`).
- **111c One original re-encoded (for review).** `mosilor_70.png` was a 16-bit RGB PNG of 16.4 MB; kept as is it would have taken `legacy.tgz` past its budget (60000 KB: 63918 KB). It is stored as 8-bit RGB PNG, otherwise lossless (4.6 MB); the derivatives are 8-bit anyway. Every other original is byte for byte the repository's.
- **111d The import never undoes the owner's work.** A record whose document is gone and whose `history` has a delete by an account is not created again; a processed, unpublished photo of which an account changed a published version is not published again. The server's own entries (`system:…`, or a service account's e-mail) do not count (the e2e world's reset deletes documents through the emulator, and its delete entries arrive after the reset: counting them made the next test's import skip photos). Both count as done (the card's *all on the map* then counts a photo the owner removed).
- **111e The transfer estimate.** `SITE_PUBLISH_TRANSFER_MB` 52 to 60 (7.4 MB more originals in a publish before the import is complete): an estimate shown to the owner, not a gate budget.
- **111f The build stage stays red on the admin's total, as at the base (§104f).** Measured on the NUC: 654.2 KB of 650 (653.6 at the base; this track adds about 0.6 KB: the card's note and label, the history check). No budget raised; `legacy.tgz` 53594 KB of 60000.
- **For review:** the old site also moved *Parc Ferdinand*'s point (about 10 m) and gave it a cone; that photo is one of the 45 and was left as migrated. The static site (`sites/bucharest/`) still shows the 45. *Superseded by §111g–111j.*
- **111g Directions from the old site (the owner, 2026-11-08).** Every one of the 57 compared with the old site's live data (`scripts/seed/legacy-corrections.mjs`): 1 corrected (`parcul-ferdinand-1930`: the old site's point and a cone, bearing 219.1°, field of view 50°), 46 already had the old site's direction, 10 have no cone on the old site (`docs/research/M5-interfaces.md` → *Directions from the old site*). The correction lives in `seed/bucharest-2023/corrections.json`, keyed by photo id, with the migrated values it replaces; `seed/bucharest/` is unchanged.
- **111h The import changes a photo only where the owner never did (for review).** A correction is applied to a photo whose direction is still the migration's (none, or exactly the migrated one) and whose history has no person's change of `bearing` or `fov`; its point moves only while it is the migrated one and no person moved it. A photo the owner moved but never aimed gets the direction without the move (the cone's angle measured from the old site's point, about 10 m away for Parc Ferdinand). One click with the photos' import; the step is done when nothing is left.
- **111i The credits name the additions' author through the import.** The bundle's `city.json` credits and the static site's name all 57 photos' authors (the migrated authors line, untouched, gains Studiourile Buftea); on an existing city the import does the same, or, when the owner edited or removed that line, adds a line of the authors no credit names (for review: an owner who removed every photo credit on purpose gets one back).
- **111j The static site shows the 57** (`sites/bucharest/site.json` → `additions: ["seed/bucharest-2023"]`, `scripts/site/src/additions.ts`): the seed's photos, then the additions', each from its own `derived/`, corrections applied, credits naming every author; an id twice fails the build. Cones now match their point by the decoded NFC file name, not the identical URL (LESSONS 474); the migration of both seed folders gives the same photos as before.
- **111k The admin's total after the directions (no budget raised).** Measured on the NUC: 656.0 KB gzip of 650 (654.2 before: the fixes module, the card's two notes and labels, about 1.8 KB). This branch still reads 650; the main branch's 700 (§105, the owner's decision) comes with the merge. `legacy.tgz` unchanged (53594 KB of 60000); the bundle gains `corrections.json` (under 1 KB).

## 112. The merge of the old photos track into the main branch (2026-11-08) — APPLIED, no budget raised

- **112a The merge.** `track/oldphotos` (the 2023 additions, the old site's directions, the credits, the static site with 57 photos) into `feat/engine-rewrite`. Three files conflicted, each kept from both sides: the incoming lessons 455–457 are 472–474 and its §105 is §111 (every reference followed: the skills, `docs/TESTING.md`, §111's own), `e2e/scenarios.json` merged without a duplicate id and `docs/E2E_SCENARIOS.md` regenerated in the image.
- **112b The admin's total.** Measured on the NUC after the merge: 658.3 KB gzip of 700 (§105, kept); `legacy.tgz` 53,594 KB of 60,000; `georef` 17.2 of 18 KB (§110d). §111f and §111k's red build at 650 ends with the merge.
- **112c A race the merge's run found** (lesson 475): `S-A28-HAPPY-DIRECTIONS` now waits for the history trigger to record the import's aim before it ends, so the entry cannot land after the next test's reset; no product code changed.

## 113. Show my location as a blue dot, the review queue's photos and places on Home, two planned rows built (track/improve2, 2026-11-08) — APPLIED

- **113a Our own layer, not Mapbox's `GeolocateControl`** (the owner: "when the user clicks show my location, we must show it with a blue dot"). The control is in the global `mapboxgl` (no bundle bytes), but it brings its own button and pulsing marker, moves the camera itself, reports errors its own way, ignores the city's bounds, and needs one watch per map in swipe compare. Our GeoJSON source with two layers (`packages/ui/src/map/my-location.ts`) keeps the menu, the toasts, the bounds check and compare's second map on one watch (`packages/ui/src/viewer/my-location.ts`), and draws a dot with a white ring, the accuracy circle and, where the device gives one, a heading cone. Measured on the NUC the way the gate does (Python's gzip, level 9; the `gzip` command reads about 90 bytes less): the IIFE 124,996 of 125,000 bytes, the ES module 97.2 of 100 KB; no budget raised. Bytes saved to fit: the store's equality check, `circle-pitch-alignment`, a 3 px ring in the text colour for the switch's on state (one rule for both colour modes) instead of a filled item plus a forced-colours rule, and short announcements ("Your location: ±25 m"). The IIFE now has 4 bytes of headroom: **for review**, the next engine feature needs a saving or the owner's decision on the IIFE's budget.
- **113b No compass.** The heading is the position's own (`coords.heading`, given while moving); the device orientation API needs a permission prompt on iOS and a calibration story, so a standing visitor sees no cone. Playwright's emulated geolocation has no heading either: the cone is unit-tested only.
- **113c The switch stops** when the visitor turns it off, at a position outside the city, on a refused permission, when the page is hidden, and when the viewer leaves; a late or lost position while one is shown keeps the last one. The position stays in memory (`ViewerState.myLocation`): not in the hash, the stored preferences or telemetry.
- **113d Home counts the review queue's photos and places** (§104c's open point): `photosToReview` and `placesToReview` (`reviewStatus` pending) beside `storiesToReview`, links to `#/review`, never asked for an uploader (S-A40-HAPPY-PHOTOS-PLACES-TO-REVIEW, S-A40-BAD-UPLOADER-NO-PHOTO-PLACE-COUNT).
- **113e Two planned rows are reachable and now `exists`**: S-A61-BAD-UPLOAD-HOLDS-RELOAD (a photo upload held open at the network: the Storage emulator's request is never answered while Hosting serves a newer admin) and S-A40-BAD-COUNT-UNREAD-SHOWN (Home's counts, the emulator's `runAggregationQuery` requests, held for the ellipsis and failed for the dash). Both hold or fail only the network, an external boundary. The Imagery GeoTIFF half of A61's row stays unit-tested (`content.busy()` is one switch for both queues).
- **113f Review fix: the address never carries the visitor's position** (S-V10-BAD-POSITION-NOT-IN-LINK). The camera's view after Show my location's first move is the position itself (the hash rounds to 5 decimals, about 1 m), so the URL hash and a link shared from it kept the visitor's home. Now `store.flyTo` keeps the view the hash had (`ViewerState.hashView`) until the map reports a view other than the one it flew to (the visitor moved the camera), or a typed hash is applied; then the hash follows the camera as before. Rejected: rounding the centre (still a neighbourhood) and leaving the view out only while the switch is on (turning it off and sharing would still send the home view). Bytes: the fix cost about 45 bytes of the IIFE, which had 1 left; paid by `cssLiteralsPlugin` (`scripts/site/src/css-literals.ts`), which now also drops the space around `>`, `/` and `!` and the `;` before a block's `}` (not after a colon: an empty custom property keeps it), and by the unused catalogue key `app.title` (a Bucharest title in a many-city engine). Measured on the NUC the gate's way: the IIFE 124,936 of 125,000 bytes, the ES module 97.2 of 100 KB; the admin's bundles only shrink. S-V19-BAD-HASH-NEVER-SENT, which waited for the position in the hash, now checks it is not there. No budget raised.

## 114. The merge of track/improve2 into the main branch (2026-11-08) — APPLIED, no budget raised

- **114a The merge.** `track/improve2` (§113: the blue dot, Home's review counts, two planned rows built) merged into `feat/engine-rewrite` after the old photos track (§112). Its §106 became §113 and its lessons 456–459 became 476–479, every reference followed (`docs/LESSONS.md`, the e2e skills); `e2e/scenarios.json` keeps both sides' rows and `docs/E2E_SCENARIOS.md` was regenerated.
- **114b A leak the merge's run found** (lesson 480): opening Layers while Show my location's flight was under way ended the flight off the position (Mapbox keeps the start's centre point after a resize), and the store took that `moveend` for the visitor's move, so the hash carried the position to within about 200 m. `store.setView` now holds the hash's view through the flight's own `moveend` (a private flag set by `store.flyTo`), then while the view stays the same at the hash's precision, as before. Measured on the NUC the gate's way: the IIFE 124,947 of 125,000 bytes (11 more than the track's 124,936), the ES module 97,173 bytes of 100 KB; no budget raised. **For review**: 53 bytes of IIFE headroom remain.

## 115. Two live findings after deploying 1.0.0+567a5d6: the stale legacy bundle and the false "Installing" (2026-11-08, track/stalefix) — APPLIED, no budget raised

- **115a The legacy bundle is always read fresh.** Hosting answered `/admin/legacy/**` with `public, max-age=86400` (CR-M2b-5), so the owner's browser kept the 45-record `photos.json` a day after the release grew it to 57 (lesson 481). Two defences: the admin reads `photos.json` and `corrections.json` with `cache: 'no-cache'` (`bundleJson`; `city.json` was already `no-store`), which also refuses a copy a browser cached under the old header; and `firebase.json` adds `/admin/legacy/*/*.json` → `no-cache` after the day-long rule. A revalidation costs a request, not the file (a 304 when it did not change).
- **115b The originals keep a day (for review).** Their names are not content-addressed, but a release does not change an original under its name (the import uploads each once; a change would come with a new name); keeping them a day spares the 46 MB on a revisit.
- **115c A recorded build at work is shown as being checked.** A view from `setup/status.install` or the bootstrap record now carries `recorded` (an admin-side field, never sent in a record; the UI port's is optional); a card shows a recorded `queued`, `working` or `retrying` target as "Checking the installation…" with when it was last seen and no steps, and it no longer hides another card's Update the map (lesson 482). Without a live token the line stays until Check again, which says how to see where the build is now. Home's tile reads records as before.

## 116. The review of 6858f8a and a live finding: honest install cards (2026-11-08, track/stalefix) — APPLIED, no budget raised

- **116a "Checking the installation…" only while a look runs.** The install flow reports `looking` (an admin-side field; the UI port's is optional) while it asks Cloud Build; a recorded build at work says "Last seen installing on {date}. Check again to see now." otherwise (no token: the watch stops at once), and a failed read shows `unavailable` with its error (`#shown` takes it; before, the record's view won). A view from a record is never recorded again (lesson 483).
- **116b A recorded build at work hides Update the map again (reverts §115c's last clause).** Of the two fixes the review offered (keep hiding, or have Update the map look at every target recorded at work first), hiding is the simpler one and needs no new path: the card says to check again, and the look settles it. Update the map skips a target at work, so offering it beside one let Provision's record go in before the server's build settled (finding 71).
- **116c The e2e Hosting's test-only cache switch.** `e2e/mock-apis/admin-server.ts` serves `/admin/legacy/**` with the old `public, max-age=86400` to a browser carrying the cookie `hcm-e2e-cache=day`; the bad row of A28 runs in a browser context without routes (any route, the firewall's included, turns Chromium's cache off), only loopback resolving in it as in every project, and checks that every address it asked was the loopback (lesson 484).
- **116d "Running for N min." on one clock.** The flow keeps, per build, when its look first saw it at work on the browser's clock, less `elapsedOnGoogle` (the build's latest step time after its `startTime`, on Google's clock), as `runningSince`; nothing while queued. `startedAt` stays the build's `createTime` (the analytics' `install_build` duration is Google's own, `createTime` to `finishTime`). After a reload mid-build the count starts from what the step times prove, a lower bound (lesson 485; §116f replaces this with the build's start).
- **116e A failed read never settles a build at work (the review of the stale fixes).** A read Google could not answer keeps a target the card saw, or a record says, at work at work, with the error; `unavailable` only replaces a state that was not running. Update the map's waits (Provision's record, the site after the server) settle only on a look that saw the server neither running, nor clicked, nor `unavailable`, so a read that fails at the click waits for the next look too (lesson 486).
- **116f Where a build at work started (amends §116d).** `workStartOnBrowser`: Google's `startTime`, but never before the tab last saw the build queued (a clock ahead of Google's, the live finding) nor after now less `elapsedOnGoogle` (a clock behind, or no start). A build first seen at work, after a reload or in a new tab, counts from its start; for such a build a browser clock ahead of Google's still adds its lead (the browser cannot read Google's clock: Cloud Build's `Date` header is not exposed to it), which is bounded by the skew, not by a step's length (lesson 486).

## 117. The merge of track/stalefix into the main branch (2026-11-08) — APPLIED, no budget raised

- **117a The merge.** `track/stalefix` (§115: the legacy bundle read fresh, a recorded build at work never shown as running; §116: honest install cards, a failed read that never settles a build at work, the running time from the build's start) merged into `feat/engine-rewrite` after track/improve2 (§114). Its §113 and §114 became §115 and §116, and its lessons 476–481 became 481–486, every reference followed (`docs/LESSONS.md`, `docs/ARCHITECTURE.md`, `docs/research/M6-interfaces.md`, `.agent/skills/web/admin_setup_assistant_skill.md`, the firebase skill and its mirror); `e2e/scenarios.json` keeps both sides' rows and `docs/E2E_SCENARIOS.md` was regenerated in the image.

## 118. The merge of track/tilespeed into the main branch (2026-11-08) — APPLIED, no budget raised

- **118a The merge.** `track/tilespeed` (d21cba1, from f2f917b: each PMTiles range read at its own address, `?range=`, so Chrome's cache lock no longer runs an archive's tiles one after another; a signed address reads with `cache: 'no-store'` instead) merged into `feat/engine-rewrite` after track/stalefix (§117). It was never merged before. Its lesson 442 became 487; nothing referenced it by number.

## 119. One blue dot for Show my location (track/onedot, 2026-11-08) — APPLIED, no budget raised

- **119a The cause** (the owner on 1.0.0+d1aa25f: "we only want a blue dot in the middle; right now we show a lot of blue dots around the centre one"). The source `hcm-my-location` holds the accuracy circle (a 25-point Polygon), the heading cone where there is one, and the Point; the `circle` layer `hcm-my-location-dot` had no filter, and Mapbox draws a circle layer at each vertex of a polygon, so a ring of 24 dots with white rings sat on the accuracy circle's edge (more on the cone's arc). Not a layer per fix: the source and layers are added once (the existing unit test).
- **119b The fix**: the dot layer is filtered to the Point (`['==', ['geometry-type'], 'Point']`); the fill layer needs none (a fill draws no Point). Rejected: a second source for the dot (another `addSource` and `setData` per fix, more bytes for the same result). Tests: `packages/ui/test/map/my-location.test.ts` (failed first), S-V10-BAD-ONE-DOT-ONLY (lesson 481).
- **119c Bytes**: measured on the NUC the gate's way, the IIFE 124,958 of 125,000 bytes (11 more than §114's 124,947), the ES module 97.2 of 100 KB; no budget raised. **For review**: 42 bytes of IIFE headroom remain.
- **119d The merge.** `track/onedot` (6054f5d, from d1aa25f) merged into `feat/engine-rewrite` after track/tilespeed (§118). Its §115 became §119 and its lesson 481 became 488, every reference followed (`.agent/skills/web/engine_viewer_skill.md`).

## 120. Show on map in a photo's details (track/locate, 2026-11-08) — APPLIED, no budget raised

The owner: "we want for photos detail panel to be a locate image button". Contract: `docs/ENGINE_API.md` → *Show on map*; scenario rows V51. Numbered §115 on the track; §120 at the merge.

- **120a The bytes: zod's English messages leave the engine too.** The engine's IIFE was at 124,947 of its 125,000 bytes. The engine never shows a zod sentence: every issue reaches the visitor or the error card's hint as its `validation.*` code (`packages/shared/src/schemas/validation.ts`; a coded refinement carries its code as its own message, so an uncoded custom issue still becomes `validation.invalid`). `packages/engine/vite.config.ts` now resolves zod's import of `locales/en.js` to the admin's empty stand-in (`packages/admin/src/vendor/zod-locale-none.ts`, §93) through the shared plugin, as §100a did for the JSON Schema conversion: 1,010 bytes gzip of the IIFE (124,947 to 123,937) and 1,020 of `engine.mjs`. With the button, the ring and the offset the IIFE measures 124,374 bytes of 125,000 and `engine.mjs` 96,615 of 100,000 (the `build` stage's own measure); after §120g's fixes 124,749 and 96,673. §100a's "zod's English messages stay in the engine" is superseded.
- **120b The place beside the sheet is Mapbox's `offset`, not the map's padding.** Padding passed to a camera move stays on the map in Mapbox GL JS: every later centre, the hash's included, would be the padded one. The offset applies to that one move: half the bottom sheet's height up on a phone, half the side sheet's width left on a medium window, none beside a docked pane (the map is already beside it). `jumpTo` takes no offset, so the jump under reduced motion is an `easeTo` of no duration; a move without an offset still jumps with `jumpTo` (the compare camera sync, the hash).
- **120c The ring lives until the camera moves again**, or a photo opens or closes; it does not fade on a timer: nothing on the map moves by itself (as §113's dot), the tests need no wall clock, and the store counts the flight's own `moveend` (`#ring`, as `#flying` for Show my location).
- **120g After review: what Mapbox does on its own.** `flyTo` and `easeTo` start by stopping the move under way, which fires its `moveend` at once, and a jump fires its own before returning: the store ignores the `moveend`s fired while Show on map starts the camera (`LOCATING`) and keeps the ring for the flight's own only when it flew. Mapbox also reads `prefers-reduced-motion` on every call and turns a flight that is not `essential` into a `jumpTo` without the offset: the engine reads the preference when the camera moves (`Boot.flyMap`, Show my location's flight too) and passes `animate` itself; an explicit `animate: true` is now `essential` and wins over the mount's preference (`MapPort.flyTo`; the cluster zoom, which passes none, still leaves the choice to Mapbox). The ring is the state's `photoMark`, drawn by `MapSync`, so swipe compare's second map draws it as it draws the blue dot. Beside a docked pane in swipe compare the place still lands on the divider at its default 50 %: the ring now shows on both sides of the 4 px line, and moving the divider is the visitor's. The side sheet's offset comes from the sheet's box and the map's, so a right-to-left host page, whose side sheet is on the left, gets the place to its right.
- **120d The hash follows the camera**: the photo's place is the photo's, not the visitor's, so none of §113f's holding applies; `photo=` stays.
- **120e No `locatePhoto` in the JavaScript API.** The offset depends on the sheet the viewer renders, and a page can already put the camera anywhere with the hash; `openPhoto` keeps its meaning. No new gamepad command either: the button is a focusable control the D-pad and A already reach.
- **120f No button without a map** (the no-WebGL photo list's sheet: `canLocate` is the state's `webgl`) and none for a photo with no place: those live only in the unplaced gallery, which has no detail sheet (`S-V51-BAD-NO-MAP`, `S-V51-BAD-UNPLACED`).
- **120h The merge.** `track/locate` (9f297c0, 3769e5f, from d1aa25f) merged into `feat/engine-rewrite` after track/onedot (§119). Its §115 became §120 and its lessons 481 and 482 became 489 and 490, every reference followed (`.agent/skills/quality/ci_quality_gates_skill.md`, the zod stand-ins, `packages/engine/vite.config.ts`). `packages/ui/src/map/my-location.ts` keeps both sides: locate's `drawSource` with onedot's Point filter on the dot layer (lesson 488). V51 was free on the main branch.

## 121. The Buy this scan guide from the owner's first order (track/ordersteps, 2026-11-08) — APPLIED, no budget raised

- **121a The four steps follow the page Order in EarthExplorer opens.** The owner ordered D3C1216-100235F038 on 2026-11-08: the scene's Full Display page (`/scene/metadata/full/{datasetId}/{entityId}/`) has Login (top right) and Order (bottom), no basket; Order leads, signed in, to a Scene List (`/order/index/?list=order-process-ee-<n>&orderType=order`) with On-Demand Order, the product `DECLASS 3 IMAGERY ON-DEMAND ($30)`, a Micron Option (7 or 14) and Submit Product Selections; then USGS's form and pay.gov by card, 35 USD, ending with an order confirmation number. The card's keys are now `adminContent.orders.guide.{signIn,order,selections,pay}` (the old `basket`, `itemBasket`, `resolution`, `payment` are gone), ro and en; the next line (Then click I ordered it) is unchanged. The pay step names 35 USD, the price of the card's one frame (`orderEstimateUsd(1)`); the card is per scene, so it never shows another total. Rejected: keeping the Item Basket steps as an alternative (the page we open has no basket, and two paths double the card's reading).
- **121b What stays UNVERIFIED** (`M4-interfaces.md` §10): the turnaround (the delivery date of this order proves it) and whether M2M's TRAM endpoints see the order (§52g).
- **121c The merge.** `track/ordersteps` (44a2be2, from d1aa25f) merged into `feat/engine-rewrite` after track/locate (§120). Its §115 became §121 and its lesson 481 became 491, every reference followed.

## 122. The engine's IIFE after the four merges of 2026-11-08 — APPLIED, no budget raised

- **122a Over by 22 bytes.** After §118 to §121 the `build` stage measured `engine.iife.js` at 125,022 of 125,000 bytes gzip (lesson 492); `engine.mjs` was within its 100 KB.
- **122b Trims with no behaviour change**, measured one at a time on the NUC: `rangeRequest` returns the `Range` header in its `init` and the reader passes `signal ?? null` (5 bytes); the signed-address test is `address.includes('Signature=')`, which still matches Google's V4 and V2 signatures and no public address (36); `moveCamera` passes a view without an offset as is instead of a copy (4); Show my location's dot filter is `geometryIs('Point')` from `pois.ts` (`['in', ['geometry-type'], ['literal', ['Point']]]`, the same features as §119b's `==`; 6). Result: 124,971 bytes, `engine.mjs` 96,895 of 100,000; **for review**: 29 bytes of IIFE headroom remain; the next engine change will need a real saving or the owner's decision on the budget.

## 123. A partner that cannot be read is no partner (track/heldfix, 2026-11-08) — APPLIED, no budget raised

- **123a The fix** (lesson 493): `worker.step` lists only the city's versions that pass `layerVersionDocSchema` and answers a `held` read of one that fails it with `{data: null, updateTime: null}` and the warning *worker skipped an invalid version* (path, fields, codes; never values). The job's own documents (`job`, `version`, `base`, the join's parts) still fail loudly: a run must not go on over its own broken data. The pipeline's `held_frames` leaves out any version whose read raises `WorkerApiError`, one warning line naming them.
- **123b No schema loosened, no migration run.** The likely invalid document is the 2026-11-02 KH-9 version of finding 62 (§84a), wrong when written, not an older shape. **For review**: delete or repair it in the console (ask first); the warning names it on the next run.
- **123c Deploy.** Both sides change: the server (`worker-step`, through *Update the map* or a functions deploy) and the worker image (`steps/aligning.py`). Either alone stops the crash: the new server answers null, and the new worker survives the old server's `apiError.internal`.
- **123d The review of 0421875** (lesson 494): a partner whose `align.tif` cannot be looked up, staged, read by GDAL or measured is left out by name and never fails the import (`PARTNER_FAILURES`; a lost lease or a revoked computer still stops the run). `worker.step`'s list of the city's versions answers `{ids, skipped}`; the pipeline writes *N of the city's frames could not be read and were left out* to the job log, and reads an older server's answer as none skipped, an older pipeline ignores the field (`workerStepResponseSchema.skipped` is optional). The server log names `(document)` for an issue of the whole document. No schema loosened, no budget raised.
- **123e The review of a6750294** (lesson 495): both object stores map httpx's errors of a look-up or a download to `ObjectStoreError` (its kind, never the address) and remove a download cut short; `FirestoreStore.get` and `list_ids` map google.api_core's errors to `DocumentStoreError`, a `RuntimeError`. A partner the network or Firestore fails is left out by name like any other; a list Firestore cannot answer fits the frame alone. Firestore's `update`, `create` and `transact` keep their errors: a failed write still ends the job, and the lease's heartbeat already survives one.
- **123f The merge.** `track/heldfix` (0421875, a675029, eaaa25a, from d1aa25f) merged into `feat/engine-rewrite` after §122. Its §115 became §123 and its lessons 481 to 483 became 493 to 495, every reference followed (`M7-local-worker.md`, `M15-calibration-accuracy.md`); its scenario rows join the existing behaviours A62 and P06, no id renumbered.

## 124. A partial frame's holes and its dark rim (track/tilebug, 2026-11-08) — APPLIED, no budget raised

The owner's screenshot of the live 1980 layer (one KH-9 frame over the city's north half): square grey pictures of other places south of the frame's edge, and an opaque black band along it.

- **124a The holes** (lesson 496, S-V32-BAD-STALE-HOLE, S-V32-HAPPY-PARTIAL-FRAME): `pmtiles-source.ts` answers a tile the archive leaves out with one shared, transparent 256 px `ImageData` instead of `null`, which Mapbox GL 3.34.1 drew with a recycled texture of an earlier tile. No request is made for it, as before; `undefined` was not an option (Mapbox marks the tile `errored`). This needs only an engine deploy; no archive changes.
- **124b The rim** (lessons 497, 499, S-P08-HAPPY-RIM-CUT, S-P08-HAPPY-RIM-FADE, S-P08-BAD-RIM-LIMITS): the pyramid step's RGBA view (`rgba_view`) takes an alpha without the film's dark rim and its fade (`tiles/rim.py`): the black core (grey 24 or less) the transparent outside reaches through black pixels only, then the fade grown from the core while darker than 65 % of the scene's own median, stopping at the first pixel that reaches it; at most 150 ground metres from the alpha's edge, plus one preview pixel; found on a preview at most 8192 px on its long side. A review of the first version (2358145) found the black-only cut left the 1980 frame's fade (3 to 6 z13 rows at grey 29 to 70) as a dark grey band, and its VRT `min` pixel function hid the COG's overviews, so the thumbnail and coarse reads went through full resolution; the derived alpha is now written once as a tiled `rgba-alpha.tif` with the source's overview levels and the view's alpha is a plain source of it. A frame with no rim keeps its alpha untouched; a dark river behind a bright bank is kept even within the band. The stitch crop is left alone: moving it would shift the scan's pixels under every saved point. Thresholds (24, 65 %, 150 m) are judgment calls from one frame (1980's live tiles: the cut now ends on a median grey of 79 where the black-only cut ended on 63); a darker scene touching the rim loses at most 150 ground metres of itself (superseded by 124d: a flat one loses a pixel or two).
- **124c What existing layers need** (not built here, for the owner's choice): the published archives keep their band until a new render of the layer, which the existing paths give (Calibrate again or the georeferencer's Save, both re-runs that do not count against the day's import limit, then Approve). A dedicated "remake the tiles" of a published version was not added: the default path keeps no COG, a published version's private archive is deleted, and a re-tile would need a publish path for an already-published version; the band is cosmetic once 124a is live.
- **124d The fade is a rising ramp; the band is Euclidean** (lesson 500, S-P08-BAD-RIM-DARK-PATCH, S-P08-HAPPY-RIM-ANGLES; a review of c5766ba): dark ground touching the core (grey 30 to 70) was cut the whole 150 m, and the band in side steps ended about 106 m in across a 45 degree edge. The fade now grows only where the dark pixels' profile rises outward, read on distance shells over a 7 px window (`RIM_RISE` 1.5 grey a preview pixel: a 200 m fade on a 5 m preview rises 3; a flat patch 0; grain of 12 grey crosses it now and then, so a grainy lake loses up to six preview pixels, about 30 m, against 150 m before), and the fade's last dark pixel before the scene is taken too; the band and the cut's limit are a Euclidean distance from the alpha's edge (`cv2.distanceTransform`, `DIST_L2`, precise). The thresholds (24, 65 %, 150 m) stay. Judgment calls: `RIM_RISE` 1.5 and the 7 px window, from the synthetic ramps and patches and the live 1980 crop (median 79 and 10th percentile 50 where c5766ba gave 79 and 51 at the test's reach). A fade slower than about 1.5 grey a preview pixel (a scene of 120 fading in over more than 400 m) stops early and keeps its slow tail. The profile is read only at the band's dark pixels, so a full 8192 px preview takes about 4 s (2 s before).
- **124e The merge.** `track/tilebug` (2358145, c5766ba, deb935a, from d1aa25f) merged into `feat/engine-rewrite` after track/heldfix (§123). Its §115 became §124 and its lessons 481 to 485 became 496 to 500, every reference followed (the raster-pipeline, e2e-scenarios and engine-viewer skills with their mirrors, `M12-own-tiles.md`, the P08 rows' notes); its rows join the existing behaviours V32 and P08, no id renumbered. `pmtiles-source.ts` keeps main's range addresses (§118, §122b) and the track's transparent hole.
- **124f The engine's IIFE after the merge: 16 bytes over, trimmed with no behaviour change.** With the track's hole the `build` stage measured `engine.iife.js` at 125,016 of 125,000 bytes gzip (lesson 492's case again). Two trims, measured on the NUC the gate's way: `rasterSource` (`rasters.ts`) builds the fields every raster source tells Mapbox GL once (zooms, attribution as text, flat bounds) and hands them to `pmtilesSource` (`RasterSourceFields`), which no longer flattens the bounds itself: the same objects, keys in the same order; and the hole starts `undefined` and is made where `loadTile` answers, still one shared transparent 256 px picture made on first use (sonarjs refuses the assignment inside the ternary, so it is two statements). Rejected after measuring: an `ImageData` per hole (a 256 KB allocation each time, 124,999), one hole per source (125,006), `cache: 'default'` for a public range (±1). Result: 124,970 bytes (one under main before the merge), `engine.mjs` 96,888 of 100,000; no budget raised. **For review**: 30 bytes of IIFE headroom remain.

## 125. The "photos near this year" chip on the timeline card (track/yearchip, 2026-11-08) — APPLIED, no budget raised

- **125a The owner's report.** "It looks like it is floating around in the UI": from 600 px the chip sat `gutter + 72px` from the map pane's leading edge while the timeline card is centred and at most 640 px wide, so with a docked pane or any map wider than 832 px they shared no edge; on a landscape phone the chip stood on the leading edge beside the menu button, the vertical timeline on the trailing one.
- **125b Chosen: the card's leading edge.** From 600 px `inset-inline-start: max(var(--hcm-gutter) + 72px, 50% - 320px)`, the card's own start in the same containing block, 8 px above it; compact unchanged (already on that edge, a row above the menu button); a landscape phone docks the chip 8 px before the vertical timeline with the bottoms aligned. Logical insets: it mirrors in RTL.
- **125c Rejected.** Centred above the card (cheapest): the open menu's items end 8 px above the timeline on the trailing side and would cover a centred chip from 600 to 840 px and beside a docked pane, against the rule that the open menu covers only the map and the two top docks. An icon button inside the card: loses the year in the label, leaves about 150 px of track for 12 stops at 320 px, changes `hcm-timeline`'s contract and costs hundreds of bytes against 53 of headroom. Inside the thumb: a button in a `role="slider"` fails axe's `nested-interactive` and moves while dragged.
- **125d Size.** Measured on the NUC the gate's way: the IIFE 124,964 of 125,000 bytes gzip (17 more than 124,947). No budget raised. **For review**: 36 bytes of IIFE headroom remain; giving the chip the card's elevation (about 80 bytes) is left out until a saving turns up.

## 126. The timeline stands on phones held upright and lies on short windows (track/yearchip, 2026-11-08) — APPLIED, no budget raised

- **126a The owner's rule.** "For phone or small width setup, maybe it would be wise to show the timeline vertically (as fostulbucuresti does it)", then "when height is short, we should display the timeline horizontally": a compact height (`data-compact-height`, below 480 px) lays it down; otherwise a compact width (below 600 px) stands it up; everything else as before. It was the opposite. `layoutFor` swaps the two layouts' `timeline`; the frame carries `data-timeline="horizontal|vertical"` and the CSS keys every orientation rule off it (the lying card's centring moved out of the 600 px container query, which a short narrow window also needs). Only the layout was looked at on fostulbucuresti; nothing of it is used.
- **126b Where the standing card goes.** On the leading edge, 68 px wide, from the top gutter down to the chip's row; the chip docks 8 px under its foot on the same edge, a row above the FAB, which keeps the bottom trailing corner (the owner); the open menu's items begin above the chip's row when a chip shows. Rejected: the trailing edge above the FAB (the open menu would cover the card, which the tour forbids: only the map, the banner and the snackbar may lie under it); the chip beside the card (259 px of Romanian beside 68 + 24 px does not fit 375 px); the chip on the FAB's row (does not fit 320 px). The width is the constraint: at 320 px the open menu's widest item (210 px in English) begins 94 px from the edge and must keep 8 px from the timeline (the tour's gap check found 5.6 px at 72 px), so the card is a 52 px lane plus 8 px each side, and the years are the ruler in the pill's lane (the ticks hidden, each label masked from the rail by the card's colour) instead of a 112 px column of rail and labels.
- **126c The pill and the labels** (lesson 502). Lying, the labels moved 10 px down, below the pill's 44 px, inside the same 84 px card; standing, the twelve stops of the owner's city are at least 31 px apart at 320 × 568, wider than half the pill plus half a label (28 px). Rejected: hiding the neighbours' labels while selected (JavaScript measuring every label, bytes the budget does not have, and years that vanish while dragging), staggered labels (two rows, a taller card).
- **126d Short windows.** The menu stays on the leading edge (lesson about the two-column menu), now beside the lying card, its items ending 8 px above it; the chip takes the card's trailing edge, clear of that menu. Compare's handle moved above the map's middle, ending 16 px before it (below it, at 412 px, it touched the lying card; lifted out of the card's way the tour found it over the chip, then over the map's centre, and 32 px above the middle under the bar that the tour's text spacing makes two rows tall); its bar, the top docks and the skip link begin after a standing card through one custom property, `--hcm-top-start`, and `CompareUiProps.compactHeight` is gone (it only served the trailing vertical card). Below 600 × 480 (a 568 × 320 phone held sideways, not a tour viewport) the open menu needs three columns: 126g.
- **126e Keys and direction** (lesson 503). Up and Down always step later and earlier; Left and Right step the way they point, so right to left Left is later. The centring translate flips with the direction, which also fixes the stops' offset right to left. `aria-orientation` was already set.
- **126f The open menu beside a standing card.** The tour's text spacing (WCAG 1.4.12) widened the menu to 244 px at 320 px, over the card. The menu's dock now begins 8 px after a standing card (`--hcm-top-start`, the FAB kept at the end with `text-align: end`), and `hcm-fab-menu`'s items are at least 56 px tall instead of exactly 56 px, so an item narrowed by its dock wraps its label (`kit-timeline-layout.test.ts`, *…WiderTextSpacing…*).
- **126g The narrow short window** (the review, lesson 504). At 568 × 320 the chip, on the card's trailing end 88 px from the edge, sat on the map's centre point, and the open menu (three columns of two) covered it. On every short window the lying card now takes the trailing column too (the menu button is on the leading side only), and the chip its trailing edge, `max(var(--hcm-gutter), 50% - 356px)`: on a narrow window both end at the gutter, the chip 9 px clear of the centre in Romanian. The menu's items end above the chip's row (`--hcm-fab-menu-gap` 84 px, the max block size 48 px less), also when no chip shows, so the menu keeps its place. At 915 × 412 the card moves 36 px towards the trailing edge, the chip with it. **For review**: below about 540 px wide and 268 to 348 px high (480 × 320) the Romanian chip would still reach the centre.
- **126h More years than the card holds** (the review, lesson 505). The track is at least 30 px per gap (`--hcm-gaps`, the stops less one, set on the track by the element; 30 px is half the 40 px pill plus half a label standing, a 24 px label and a gap lying), and the card scrolls in both axes with no scroll bar; the selected stop has `scroll-snap-align: center` under `scroll-snap-type: both mandatory`, so a key, a tap and the end of a drag bring it into view, and `:host([dragging])` turns snapping off (the track would run under the finger). The owner's twelve stops still fit at every tour size (31 px apart at 320 × 568). Rejected: JavaScript that scrolls the thumb into view (`scrollIntoView` also scrolls the page an embed sits in, and the bytes); hiding labels. The stops are 30 px apart, not 48: they are no targets (the list is `aria-hidden`, the 48 px thumb is the one), and 48 px would scroll the owner's own city on a phone. The bytes: the engine's IIFE had 76 bytes of headroom and this needed 157; `scripts/site/src/css-literals.ts` now drops the quotes of an attribute selector's identifier value, the whitespace inside parentheses and a number's leading zero (50 bytes), the thumb's transition is one shorthand plus `transition-property`, and `.stops` is `all: unset`: 124,997 of 125,000 bytes, no budget raised.
- **126i Size.** Measured on the NUC the gate's way after the `build` stage: the IIFE 124,924 of 125,000 bytes gzip (40 fewer than 124,964 before this change: the key table became a table of steps, the orientation overrides became the base rules and `--hcm-timeline-inline` a literal, which paid for the new rules); the ES module 97,228 bytes of 100 KB. No budget raised. **For review**: 76 bytes of IIFE headroom remain.
- **126j The merge.** `track/yearchip` (921bcdc, 74b58c8, 34c15a9, from d1aa25f) merged into `feat/engine-rewrite` after track/tilebug (§124). Its §115 became §125 and its §116 §126 (its second 116g, the size, is 126i), its lessons 481 to 485 became 501 to 505, every reference followed (`ui_m3_adaptive_skill.md`); its rows join the existing behaviour V04, no id renumbered. With main's engine the IIFE measured 125,040 bytes gzip, 40 over its budget: §127 pays for it.

## 127. The engine's message catalogues packed at build time (2026-11-08) — APPLIED, no budget raised

- **127a What.** `scripts/site/src/catalogue-pack.ts`, a Vite plugin of the engine's build only (`cataloguePackPlugin`, on `packages/shared/src/i18n/`), rewrites a catalogue's object literal of `'family.key': 'text'` pairs into one string of its keys and an array of its texts, expanded by `Object.fromEntries` when the module loads. The object is the same: the same keys in the same order with the same texts (`catalogue-pack.test.ts` imports the packed `ro.ts` and `en.ts` and compares their entries with the source's), so no visitor, page or API sees a difference; the sources stay one entry per line for `check_i18n.py` and the type of `Messages`. Only an object of quoted keys without whitespace and plain string texts is packed, anything else is left as written; every line keeps its place, so the source map holds. Measured on the NUC the gate's way (gzip 9, `mtime=0`): the IIFE 125,040 → 124,764 bytes (276 fewer: the English key string is one long repeat of the Romanian), the ES module 97,018 → 96,757.
- **127b Rejected.** Writing the catalogues packed in the source: one line per entry is what the i18n gate and every reviewer read. Dropping keys the viewer never shows (`hello.greeting`): the catalogue is the engine's public contract.

## 128. Zoom in and Zoom out buttons on the public map (track/zoom, 2026-11-08) — APPLIED, no budget raised

- **128a Our own M3 buttons, not Mapbox's `NavigationControl`** (the owner: "add zoom in and out buttons to the map"). The control is in the global `mapboxgl` (no bundle bytes) but brings 29 px targets, a compass, its own look and its own texts in one language; ours are two of the kit's icon buttons (48 px targets) in one rounded group (surface container high, elevation 2, the same declarations as the timeline note's), named and titled `viewer.zoomIn` / `viewer.zoomOut` ("Mărește harta" / "Micșorează harta", the admin map's words). A click calls the new store action `zoomBy(±1)`: one level from the camera's live zoom (`MapPort.getView`, so a second press mid-flight adds a level), clamped to `city.minZoom`..`city.maxZoom`, nothing at all when the clamp leaves the zoom where it is, flown through `Boot.flyMap` (animated, a jump under reduced motion; `store.flyTo` would have held the hash's view, §113f). The hash follows the camera's `moveend`. One pair in swipe compare: the second map follows the first.
- **128b The budget, paid by a smaller baseline theme.** The buttons, the action, the two texts per language and the styles measured 438 bytes gzip of the IIFE (124,947 → 125,385 of 125,000, the gate's way: gzip level 9, `mtime=0`). The saving: `packages/ui/src/theme/baseline.ts` wrote its four token sets out, 212 `'--md-sys-color-<role>': '#rrggbb'` pairs; it now lists the 53 roles once and each scheme as one string of `rrggbb` values, expanded with `Object.fromEntries` when the module loads: 628 bytes gzip. The object is the same (`baseline.test.ts` still pins it to `themeFromSeed(DEFAULT_SEED_COLOR)`, key order included), so no visitor, page or API sees a difference; the admin and the start page import the same export. Measured after both: the IIFE 124,763 of 125,000 bytes, the ES module 97,001 of 100,000; with §128e's and §128f's fixes the final build measures the IIFE at 124,966 (34 left, 19 more than before the track) and the ES module at 97,200; after §128g's fixes the IIFE measures 124,993 (7 left) and the ES module 97.2 KB. Considered and left: zod's cyclic-parse memoizer and its English messages (the parse's behaviour), the duplicated Firebase SDK in the IIFE (§13a).
- **128c Soft-disabled at the limits.** A natively disabled button leaves the Tab order and drops the focus of a visitor pressing Enter at the limit, so `<hcm-icon-button>` gains `softDisabled` (`soft-disabled`): the disabled look, `aria-disabled="true"`, the focus kept; its clicks still fire and a toggle never flips; the zoom group binds no click listener to a button at its limit (§128g). It has no hover or pressed state layer and no pointer cursor, and in forced colours it turns `GrayText`, as a native disabled button does. The state reads `ViewerState.view.zoom`, which the camera's `moveend` sets, so the gamepad's zoom, the wheel, a pinch and a typed hash disable the buttons at a limit too. The gamepad's zoom is analogue (triggers and the right stick): there is no discrete binding for the buttons to mirror.
- **128d Where.** The trailing edge (the left in a right-to-left page), centred over the FAB and 8 px above it from medium up; on a phone above the "photos from around" chip's row, which can be as wide as the map (a merge with the track that moves the chip into the timeline's card may lower the group by that row); on a phone held landscape a row at the foot of the map before the vertical timeline: in a column it reached the band swipe compare's divider handle sweeps (50 % + 32 px of the map's height). The tour's journey `zoom` (Zoom in soft-disabled and focused at the city's maximum, Zoom out focused one level out) and every other map state check the group's box against the menu, the timeline, the chip, the sheets and the legal line at all 11 viewports.
- **128e Two things the tour found, and one checker change for review.** (1) The open FAB menu grew over the group (`viewer.menu-open: [overlap] menu … overlaps … div.dock.zoom`): the group is hidden while the menu is open (`.dock.menu:has(> [open]) + .dock.zoom`), as the menu covers it anyway. (2) The soft-disabled Zoom in's icon measured 2.06:1 against its group (`non-text-contrast`, 3:1): the probe (`controlContrasts` in `e2e/support/a11y-probe.ts`) already left natively disabled controls out, as WCAG 1.4.11 exempts inactive components; it now leaves out `aria-disabled="true"` ones too, which are as inactive and only keep the focus. **For review**: this narrows what one checker measures; the alternative was a disabled look at 3:1, which reads as enabled next to its neighbour.
- **128f Zoom out's real limit.** The e2e bad path found Zoom out enabled where it could do nothing: Mapbox keeps the view inside `maxBounds` (the city's bounds), so it stops zooming out where the bounds just cover the map, above Bucharest's `minZoom` 10 on every tour viewport (about 10.8 on a phone, 11.6 at 1440 px). `viewer-zoom.ts` computes that zoom (`coverZoom`: Web Mercator, a 512 px world at zoom 0, the larger of the two sides) from the map container's box, read at each render (a resize of the map fires Mapbox's `moveend`, which renders again), and soft-disables Zoom out at the higher of the two (within a hundredth of a level of the cover zoom: the camera Mapbox stopped is rounded). The store still clamps to `minZoom` only (it does not know the map's box); a press at the cover zoom never reaches it (§128g).
- **128g Two review findings (2026-11-08), fixed.** (1) At the cover zoom Zoom out showed as disabled but its click still reached `zoomBy`, which clamps only to `city.minZoom`: Mapbox flew and clamped back (22 to 26 `move` events and a `moveend`) and the address lost the typed view (`10/44.42704/26.0853` became `11.63/44.4401/26.09`), against "a press changes nothing". The zoom group now binds no click listener to a button at its limit (`@click=${atLimit ? nothing : onClick}` in `viewer-zoom.ts`); the store keeps its `minZoom` clamp for any other caller. (2) In forced colours the `color-mix` dimming is overridden, so a soft-disabled button looked exactly like an enabled one, and the hover layer still showed: `<hcm-icon-button>` gives `soft-disabled` `GrayText` in its forced-colours block, no `::before` layer and the default cursor. Both cost 27 bytes gzip of the IIFE (124,993 of 125,000); no budget changed.
- **128h The merge with track/yearchip** (§125, §126). `track/zoom` (a569eb6, 92bc3db, from d1aa25f) merged into `feat/engine-rewrite` after track/yearchip. Its §115 became §128, its lessons 481 to 484 became 506 to 509, its behaviour V45 became V52 (main has V50 and V51; rows `S-V52-*`, the specs' tags, the tour and every note followed). The group's place (128d) follows the new timeline: from medium up, unchanged, over the FAB on the trailing edge; on a phone held upright, where the timeline stands on the leading edge and the chip takes the row above the FAB (up to the map's width at 320 px), on the trailing edge with its foot level with the card's, above the chip's row (`42 + 56 + 40 + 2 × 8` px); on a short window, where the FAB is on the leading side and the lying card and the chip take the trailing column, over the FAB in the leading column the card leaves free. The track's landscape row before a vertical timeline and its compact rules for a lying card are gone with the layouts they served, as is `--hcm-timeline-inline`. `kit-timeline-layout.test.ts` measures the group's real box clear of the timeline, the chip, the FAB, the map's centre and the Mapbox strip at 375 × 812, 320 × 568, 915 × 412, 768 × 1024, 1440 × 900 and 568 × 320, left to right and right to left. **For review**: swipe compare's handle sweeps a band from 64 to 16 px above the map's middle at whatever place the divider is dragged to; the short window's column clears it from 356 px of height (every tour viewport is 412 px or more), while at 568 × 320 the handle dragged to the leading edge would reach the group's top 18 px. Measured on the NUC the gate's way after the merge, with the catalogue packing (§127) and the smaller baseline theme (128b): the IIFE 124,736 of 125,000 bytes gzip (264 left), the ES module 96,756 of 100,000; no budget raised.

## 129. Settings out of About, and the Layers pane minimized (track/settings, 2026-11-08) — APPLIED, no budget raised

- **129a Language and theme in the menu's Settings.** The owner: "Limba and Tema should not be in the About screen!!!". The FAB menu's one-tap language item (named after the other language) became **Setări / Settings** (icon `settings`, already in the subset), which opens `<hcm-about-dialog>` in a third mode (`mode`: `about`, `help`, `settings`; the sheet `settings`, `dialogMode` in `input-commands.ts`) holding the two segmented buttons About had. About keeps the city, credits, the accessibility statement with the help button, privacy with the consent withdrawal and the engine version. Changing a language is now two taps instead of one. Rejected: two items, Language and Theme (the fewest bytes, but a tenth menu item, and at 568 × 320 the nine already take three columns reaching the trailing edge); a compact section inside the menu (the kit's FAB menu holds actions, M3's menu has no segmented choice). Settings is full screen where About is (`aboutFullscreen`): the three Romanian theme labels do not fit a basic dialog at 360 px. The URL hash, `#lang=`, the stored choices and the public API are unchanged.
- **129b The extra-large Layers pane minimizes.** The owner: "viewer should be able to minimize the layers panel". Only extra-large (1600 px and wider) docks the pane for good with no close; there its close button now minimizes it to an 88 px rail on the same edge, one tonal button (icon over the label **Straturi**, `aria-expanded="false"`) restoring it; the map takes the 272 px (the map container's ResizeObserver resizes Mapbox). The focus goes to the rail's button and back to the pane's Close. The state is the panel's own (`minimized`, reflected for the frame's `:has()` rule), for the session only: the hash does not carry the open sheet, so it does not carry this; no store field, no localStorage. The switches and sliders are the store's, so nothing is lost. The `l` key focuses the rail's button while minimized (it never minimizes). Rejected: a store field with a handler (about 100 bytes more, and it would touch `store.ts`, `viewer-handlers.ts` and `hcm-map-viewer.ts`, which the main branch is changing for the zoom buttons). Other widths: modal sheets (compact, medium, landscape phones) cover the map, so their close is the minimize; expanded and large already close their docked pane and reopen it from the menu's Straturi (S-V03-HAPPY-COMPACT-CLOSE).
- **129c Paid for by the token fallbacks.** At bdb0ecf3 the IIFE was 124,971 bytes gzip of 125,000; the two features cost about 220 bytes. `<hcm-map-viewer>` applies the whole theme (colours, shapes, type, motion, state, the typefaces) to its host on connect, before its first render, so the viewer's `var(--md-sys-*, fallback)` and `var(--md-ref-typeface-plain, fallback)` fallbacks were never used; they are gone from the viewer files the main branch does not touch plus `compare-styles.ts` and `timeline-styles.ts` (1,047 characters), and `.labels h3` of the Layers panel keeps only what differs from `baseStyles`' h3 (identical rendering). `packages/ui/test/viewer/theme-tokens.test.ts` proves every token a viewer source names is set by the theme in light and dark. Result: 124,960 bytes (lesson 510). **For review**: `viewer-styles.ts` still has 192 characters of fallbacks, left for after the main branch's merge of the zoom buttons and the vertical timeline (it rewrites that file); `compare-styles.ts` and `timeline-styles.ts`' edits touch only fallback lines, which the main branch's changes there do not.

## 130. The review's fixes of the minimized Layers pane, and the viewer's own baseline (track/settings, 2026-11-09) — APPLIED, no budget raised

- **130a The minimized pane is the store's.** The review confirmed that the minimized pane came back open after the window left the extra-large layout and returned (the layout re-creates the pane element, which held the state). §129b's "no store field" is reversed: `ViewerState.layersHidden` (initially false) and `setLayersHidden` in `packages/engine/src/core/store.ts`, mirrored in `store-port.ts`; the panel fires `hcm-layers-minimize` (`{minimized}`), `viewer-handlers.ts` calls the action and `viewer-render.ts` binds `minimized`. It stays out of the URL hash and of localStorage: the session only, as ENGINE_API says. These files are the ones the main branch changes for the zoom buttons; the edits are a few lines each, next to the existing actions.
- **130b The collapse button says what it does.** The review confirmed that the docked pane's close button minimized but was named Închide / Close with no `aria-expanded`. When `minimizable`, it is **Restrânge straturile** / **Collapse layers** (new key `layers.minimize`), icon `chevron_left` (already in the subset) and `aria-expanded="true"`, the rail's button staying **Straturi** with `aria-expanded="false"`: a disclosure pair. `<hcm-icon-button>` gains `expanded` (none: no attribute) and `renderSheetFrame` a `minimize` option. Rejected: naming it Straturi too (the fewest bytes, but a screen reader user hears the pane's own title on the button that hides it).
- **130c The viewer's baseline, cut to its tokens.** The `tests` stage failed on the §129c fallbacks: a city theme that sets only some tokens (the schema allows 1 to 200 names; the test city sets three) left `--md-sys-color-secondary` unset, so the focus ring's `outline` shorthand was invalid and drew nothing (lesson 512). `packages/ui/src/viewer/viewer-baseline.ts` holds `VIEWER_BASELINE`, `BASELINE_THEME` cut to the 27 colour tokens the viewer, the kit and the map name (the other 26, tertiary and the fixed and dim roles among them, are only the admin's), and `withViewerBaseline` lays a city's tokens over it scheme by scheme; `<hcm-map-viewer>` applies that. `viewer-baseline.test.ts` pins the values to `BASELINE_THEME`, `theme-tokens.test.ts` now scans the viewer, the kit and the map against it. A partial city theme now gets the baseline's colour for what it leaves out (before §129c: a CSS system colour). `BASELINE_THEME` itself is unchanged for the admin, the start page and `themeFromSeed`'s fallback.
- **130d Size.** The two fixes cost 191 bytes gzip (124,996 before them, with the uncommitted trims of `hcm-about-dialog.ts` and `hcm-layer-panel.ts` and `timeline-styles.ts`' fallbacks restored); the cut baseline saved 710 (measured on the built IIFE): 124,657 of 125,000 bytes. **For review**: `viewer-styles.ts`' 192 characters of fallbacks stay for after the main branch's merge, as §129c planned.

## 131. The Contribute page's welcome while signed out (track/contribute, 2026-11-08) — APPLIED, no budget raised

- **131a What the owner saw.** A visitor who clicked Contribute on the live map landed on the admin's sign-in ("Map administration", "Sign in with the Google account that administers the map."). Now `#/contribute/<city>` signed out shows a contributor's welcome in place of the admin's panel (`packages/admin/src/app/welcome.ts`, `<hcm-sign-in>`; lesson 514; `docs/research/M13-roles.md` §3); every other address keeps the admin's sign-in, and start-up mode keeps it too (no server, nothing to contribute to).
- **131b Where the welcome's words come from.** The rules let only a city's members read `cities/{city}`, so the admin cannot read the name before sign-in: the map menu's Contribute link carries `?lang=` and `name` (shown as text, control characters removed, at most 80 characters). **For review**: a link anyone may write can put any 80 characters in the title; reading the city's public `manifest.json` instead would cost a download of the whole manifest on every visit.
- **131c The engine's budget.** A first version (the language, the name and the map's address on the menu's, the sheet's and the gallery's links) measured 125,079 bytes gzip of 125,000 (base 124,971); the photo links stay as they were, and the menu's link with the language and the name costs 74 bytes. Two messages that only a programming error shows were shortened with no behaviour change: the zod JSON Schema stand-in's (`no JSON Schema conversion (DECISIONS-for-review.md §86, §100)`, 29 bytes) and `cssProperties binds an element only` (22 bytes). Result: 124,994 bytes. **For review**: 6 bytes of IIFE headroom remain.
- **131d The language without a `?lang=`** (a photo's link): on the Contribute page the admin reads the language the visitor chose on that city's map (`hcm:<city>:lang`, the same origin since M6), then its own stored choice, then Romanian (the map's default), never the browser's; elsewhere the admin's order is unchanged.
- **131e The way back.** **Back to the map** opens the city's map on the admin's own Hosting: the project's first city (`infra/project.json` `cities[0]`) at `/`, any other at `/<city>/` (M6 §2.4), so the link needs no address of the map.

## 132. Every state of the Contribute page speaks to a contributor (track/contribute, 2026-11-09) — APPLIED, no viewer change

- **132a What the review found.** After §131 only the signed-out state of `#/contribute/<city>` was a contributor's: no server, a busy server, a refused session, a map without an owner and two loading texts still led to or named the administration (lesson 515).
- **132b One new auth state, `contributeClosed`** (a map nobody set up: a start-up deploy's, `startUp` with no server ever seen, or a session saying `ownerClaimed: false`): "Contributions to this map are not open yet." and Back to the map, no action. A new state rather than a flag on `backendDown`, so that nothing can Try again what is not there. A server that does not answer on a deploy that is not a start-up one is `backendDown` ("The map is resting. Try again in a minute.", Try again, Back to the map): the probe cannot tell a busy server from one never installed, and a live map is the likely case. **For review**: a map whose server was never installed and whose deploy does not say `startUp` shows "resting" to a contributor, not "not open yet".
- **132c A refused session on the page** (any non-retryable error, `apiError.accountNotAllowed` say) is `backendDown` with its reason and the account stays signed in; an outdated server's reason ("update the server (step d)") speaks to the admin, so the panel shows only "resting" then. **For review**: a non-retryable reason under "The map is resting" reads oddly; a message of its own per reason would need the UI to know which errors are retryable.
- **132d The Romanian title** is „Contribuie la harta orașului {city}”: „harta {city}” needs the city's genitive (Bucureștiului, Bacăului), which a generic text cannot form; „harta orașului București” is correct for every name.

## 133. A layer switched on moves the timeline, layers stack by date, and a photo's date leads to the map of its year (the owner, 2026-11-09) — APPLIED, no budget raised

- **133a The merges.** track/settings (9c0fec0d, §129, §130) and track/contribute (48055d3b, §131, §132; its §123 and §124 renumbered, its lessons 493 and 494 now 514 and 515) merged into `feat/engine-rewrite` after the zoom buttons (§128). Their conflicts kept both sides (the icon button's `softDisabled` and `expanded`, the tour's zoom and Settings states). Together they measured 125.1 KB gzip of the IIFE's 125 KB (`build/bundle-budget`), before the work below.
- **133b Paid for with no behaviour change.** With the three requests below the IIFE measured 125,361 bytes gzip. `VIEWER_BASELINE` (`packages/ui/src/viewer/viewer-baseline.ts`) spells its 27 role names once and each scheme as one string of 27 values (`scheme`), the same objects (`viewer-baseline.test.ts` still pins every value to `BASELINE_THEME`): 360 bytes. `TYPE_SCALE`'s emphasized weight is derived from the weight (`typeStyle`: regular to medium, medium to bold, as all 15 styles had it; `system.test.ts` pins it): 43 bytes. Result: **124,990 bytes** after the review's fixes (the chips' own method, `toSorted`). **For review**: 10 bytes of headroom. (§128b had packed the baseline the same way; the settings track's `viewer-baseline.ts` wrote it out again.)
- **133c A layer switched on moves the timeline** (lesson 516). The owner: switching a historical layer on in the Layers panel did not show it unless the timeline already sat on its year. Now a layer switched on (the panel, the controller's `toggleLayer`, the keyboard) sets the timeline to its year (`withLayerYear`) and logs `year_change`; the other visible layers stay on; with several on, the timeline follows the last one switched on; switching a layer off, or any other overlay, leaves the timeline. The hash keeps naming the visible layers. **For review**: the hash carries no year, so a link opened later stands on the newest of its layers (`yearOfLayers`, as before), not on the last one switched on; and an older layer switched on under a newer opaque one is still covered by it (133d) though the timeline moved; lowering the newer one's opacity, or the timeline's own stop (which shows only that year's layers), shows it.
- **133d Layers stack by date.** The owner: several historical layers on always stack newest on top, oldest at the bottom, whatever the order they were switched on in and whatever the admin's `order`, on the main map and in compare. `rasterSpec` (`packages/engine/src/core/map-specs.ts`) passes the layer's year as the map's `order` (`RasterLayerSpec.order`, higher on top; both the main map and compare's draw through `MapSync`); two layers of one year keep the manifest's order between them. The admin's `order` still orders the Layers panel within a year (ENGINE_API.md, *Manifest*). Tests: `map-specs.test.ts`, S-V03-HAPPY-STACK-BY-DATE. **Changed by §191 (the owner, 2026-11-13):** the layer the timeline chose now comes to the front, above a newer opaque one too; the others still stack by date.
- **133e A photo's date leads to the map of its year.** In a photo's sheet, while there is a map, a date (year, range, month or day) whose years hold a layer's year is a text button, named by the date and **Harta din 1966** / **Map of 1966** (`photo.mapOf`), that sets the timeline to that year (`hcm-year-change`, the timeline's own event, so the store's `setYear`): the map shows that year's layers and the photo stays open. Otherwise up to three outlined buttons (chips), one under another in a `section` of the sheet (lesson 517), name the layer years within ten years of the photo's span, nearest first, the older on a tie (`photoMapYears`, `packages/ui/src/viewer/hcm-photo-sheet.ts`); an undated photo, or one far from every layer, shows its date as before. No map (no WebGL: the photo list's sheet) shows no button. Tests: `hcm-photo-sheet-years.test.ts`, S-V07-HAPPY-MAP-OF-YEAR, S-V07-BAD-NO-LAYER-OF-ITS-YEAR, the tour's `photo-map-year`.

## 134. Import local files: the core (track/archive, 2026-11-09) — APPLIED, no budget raised

The owner's request of 2026-11-09 and the design `docs/research/M20-import-local.md` (§13: the owner's decisions; §14: as built).

- **134a What landed.** The contracts (`imagery-archive.ts`, `api/archive.ts` and their Python twins), the worker's import page and intake (a folder or a zip over loopback, the zip's limits, magic bytes, a spawned probe child with its own limits), classification for any city, the scan report (`worker.archiveReport`: at most 200 series, 500 sample paths, never a host path), `imagery.archiveImport` (one local-only `archive-series` job per kept series, in the ladder's order), the daily share per series (`countedAt`, wait reason `daily`, released by `imagery.tick`), the series job's `gather` and `place` steps (no placer yet: every class waits for points with a one-line `help`), tiles per encoding (line art lossless with its paper transparent, a DEFLATE COG; grey as today; colour), the rights gate on Approve and on the automatic policy, the scaled map threshold, and the layer's credit line and `rights`.
- **134b The owner's decisions applied** (§13): the threshold `max(city, 1 mm × scale)` capped by `mapThresholdMaxM` (60, range 15–200), `mapAutoPublish` on; one count per series; DWG reported; the rights through the sidecar (`confirmedBy`, `maxzoom`, `priority: low`, `skip`).
- **134c The manifest does not grow.** §7's `layer.rights?` cost the engine's IIFE 125,040 bytes gzip against its 125,000 budget (the budget is never raised), so the manifest keeps v1 and the credit reaches it through `attribution` (the built line). The layer document keeps `rights` (`layerRightsSchema`) for when the viewer has the bytes. **For review:** the bytes for the manifest field and §9's rights row, Maps subgroup and chip glyph.
- **134d A series dated before 1800 is refused by `imagery.archiveImport`** (`yearSchema` holds layers to 1800–2100), so the 1770–1799 maps wait. **For review:** whether the viewer's timeline takes earlier years.
- **134e Not built here** (the paths phase and Workstream H): the placers per class, OCR, contact sheets, the admin's Import card, scan report, rights dialog and progress, the viewer's Maps subgroup and rights row, the acceptance run on `harti.zip`. Nothing was uploaded or deployed.
- **134f Scenario ids `S-A120-*` and `S-P20-*`** (lesson 519): `A101` was taken by two other tracks.

## 135. Import local files: the paths (track/archive, 2026-11-09) — APPLIED, no budget raised

The design `docs/research/M20-import-local.md` §3 and §10 C, D, E; as built in §15 there.

- **135a One placer per class** in `pipeline/src/hcm_pipeline/placing/` (`PLACERS` in `steps/place.py`): `georeferenced` (`embedded.py`), `grid` (`grid.py`, `gridscheme.py`, `render.py`), `single`, `atlas`, `pieces` (`maps.py`, `single.py`, `assemble.py`, `pdfpages.py`), on shared parts (`streets.py`, `frame.py`, `coarse.py`, `fine.py`, `checks.py`, `reference.py`, `geometry.py`, `raster_io.py`, `output.py`). A placement that does not hold never fails the job: the version waits `needs_gcps` with `help` and suggested pairs.
- **135b A new dependency, pikepdf 10.18.0** (with Pillow 13.0.0 and lxml 6.1.3), as §3 *PDFs* chose: GDAL's PDF driver in the base image writes only, and Miorini 1923 is encrypted (Standard handler, V4 R4, an owner password only). An owner-locked PDF is read; a password PDF waits for a person and is never cracked.
- **135c The worker may write its version's `source`**, but only an archive series' `placedCount` and `skipped` (`step-update.ts` `sourceAllowed`); every other part of a source stays the server's (S-P20-BAD-SOURCE-FORGED).
- **135d `AUTO_GCP_METHODS` gains `junctions`** (shared and Python): the drawn-map path's suggested pairs are junction pairs, not SIFT or ORB.
- **135e Pieces are classified by name** (a folder of at least three scans in a scanner's order, its sibling folders merged at their parent); whether they overlap is the placer's to find.
- **135f Gates of a drawn map's fit** (zero false accepts first): at least 20 agreeing junction pairs and 20 % of the training junctions, at least 5 held-out checks and none gross, and the runner-up placement agreeing with at most half as many pairs. A thin-plate spline only with 30 pairs over 60 % of the map; a grid's mosaic stays affine.
- **135h The core's classification, corrected on the real archive** (the first scan made 855 single "series" of the 1:2000 and cadastral sheets and hit the 200-series cap): a series' sheets are alike when 80 % lie within 10 % of the median size (the 1:2000 sheets come in two batches, 7008 × 9933 and 6608 × 9363); sheets join across gaps of up to three cells (the cadastral rows 15 and 18); an edition of an accepted series is a series of its own however few its sheets (§1.4); a year that follows `1_`, `1:` or `1-` is a scale (`1_2000` is no year). Python's `VERSION_ORIGINS` lacked `archive`, so no archive version could be read (lesson 527): fixed and pinned in the parity contract.
- **135g Not built** (each says so in its module): OCR (index pages, printed scales, cartouches), the `RoadSegmenter` AI path (no licensed weights verified), the joint seam solve and printed-crossing detection of grid sheets, the graph-cut seam and bundle adjustment of pieces, TPS λ by cross-validation, LibreDWG, and the server filling `referenceLayerIds` from the ladder (the placers read them when given). **For review:** which of these the acceptance run (§15) says to build next.

## 136. Import local files: the admin and the viewer (track/archive, 2026-11-09) — APPLIED, no budget raised

The design `docs/research/M20-import-local.md` §8 and §9 (Workstream H); as built in §16 there.

- **136a The report opens by itself.** Choose (the worker's page), the zip, then the admin's Import are the owner's three inputs (the budget asked: scan and import in three); an archive that arrives while the Upload view is open opens its report (`hcm-archive-arrived`) instead of waiting for a click on its row. The Upload tab itself is navigation, outside the count.
- **136b Rights are confirmed inline in the report** (Permission from, Confirm the rights), not in a dialog: one field and one button per waiting series, in the order the owner reads the report. The confirmation reaches the version with `licence: 'permission'`, `state: 'clear'`, `confirmedBy`, and `confirmedAt` from the server's clock.
- **136c The viewer needs no byte for a map layer, and §9's extras wait.** A map layer is listed, drawn and credited like any layer (S-V53-*). The Maps subgroup, the chip's map glyph and the rights row would grow `engine.iife.js`, which has 4 bytes of headroom (§113a): **for review**, the owner's budget decision or a saving first.
- **136d A new admin chunk `archive`** (the feed, the two elements, `@hcm/shared/admin-archive`): 8.6 KB gzip measured, its own row of 10 KB in `ADMIN_CHUNK_BUDGETS`; the admin's total is 670.1 KB of 700, the entry 387.5 of 450, `engine.iife.js` unchanged at 125.0 of 125. The card reads a worker through a projection of its document (`lastSeenAt`, `revokedAt`), not `workerDocSchema`: importing the schema made it shared by two chunks, which moved `schemas/worker.ts` into `editor-shared` and took that chunk to 13.1 KB of 13. No row rose.
- **136e A series a layer cannot show starts left out** (before 1800, skipped by the scan, or too small), so the defaults import without an extra click; the owner can still take a too-small series in.
- **136f The owner's sidecar is read from the archive's one top folder too**, so a folder chosen whole (`Harti/hcm-archive.json`) carries the owner's decisions; its paths stay relative to the archive's root.

## 137. Import local files: the review's fixes (track/archive, 2026-11-09) — APPLIED, no budget raised

The review of track/archive (2851ae51..69ce4978); the owner kept the 1800 minimum year for now. As built in `docs/research/M20-import-local.md` §17.

- **137a The sidecar merges from the root down** (lesson 530), and takes the original a scan was made from: `originalLabel`, `originalUrl`, `originalProbable` (`true` only). The rights carry it as `original: {label, url?, probable?}`; the credit line ends "original: …" or "original, probably: …". `layers/{layer}.rights` does not carry it yet (the manifest has no room); `attribution` does.
- **137b The Bucharest sidecar** (kept beside the archive, not in the tree) credits the whole `Harti/` folder to Idei Urbane – DocuBucurești with its link, the public-domain series included; adds the 1962–1978 mosaic (`Harti/1962-1963-1965-1978`, year 1978, label 1962–1978, permission confirmed by the owner); dates IPB 1:2000 1951–1977; corrects `Harti/Bucuresti 1974` to 1974 (it had carried the mosaic's label); names the originals: 1871 Pappasoglu (Wikimedia Commons / Biblioteca Academiei Române), c. 1900 and c. 1938 (muzeuldefotografie.ro), and UAUIM "Ion Mincu" as probable for 1844–46, 1895–99, 1911, 1968, 1969 and 1974.
- **137c Rights are the server's** (lesson 531): only the city's owner confirms (`apiError.city.notOwner` for an editor, `apiError.imagery.rightsUnconfirmed` without `confirmedBy`).
- **137d An undated series (`?`) or one before 1800 is refused** with `apiError.imagery.archiveYear` until the owner types a year; the admin starts an undated series left out with an empty year and always sends the typed year. The typed year becomes the rights' printed year.
- **137e The daily share is exact for M20's counting transactions**: the import and each daily release count today's room inside their transaction behind the turnstile `ops/daily` (functions only, closed to clients by the rules' existing `ops` list); a share of 0 says none starts instead of a count of days. The other raster creators keep the spend-guard check.
- **137f An archive series' COG and Studio file are never uploaded** (§4: only tiles, thumbnail, preview and sheets go up), and a local-only job is never offered the cloud (no `job.noWorker`, no Run in Google Cloud).
- **137g Grid names**: a block's rows and columns must be neighbours or it is read by none; `prim` reads as a prime, `-MIC` before a quarter is odd, a whole cell with no quarter is odd, a file with no extension is read by none.
- **137h Untrusted files**: a cut-off upload is removed and refused; a zip entry that would land on the zip being read is refused.
- **137i Estimates**: a grid sheet counts half its scanned paper (Bucharest's 1:500, measured on one city); the archive's size counts every file. The per-sheet seconds and tiles per minute stay UNVERIFIED (shown as "about").
- **137j The engine's budget at the merge into feat/engine-rewrite**: the two branches together measured 125,009 bytes gzip against 125,000 (feat/engine-rewrite alone 124,990). Bisecting showed no line of `imagery-archive.ts` in the engine: `export * from './schemas/imagery-archive.js'` in the package's index cost 19 bytes of module glue by itself (named exports, or no export, measured 124,990; a star-exported barrel of named exports did not help). The index now names the module's runtime exports (`export type *` for its types), `api/index.ts` names `api/archive.ts`'s (its star cost 13 more), and `geometry.js`'s list is written on two lines to stay within the index's 400 lines. No behaviour or API change; the budget is not raised.

## 138. Batch 4: joins of published frames, the owner's grid approval, Layers as one button, the Jobs layout, the import in the admin's tab (track/batch4, 2026-11-09) — APPLIED, no budget raised

- **138a A join takes any frame with a usable version.** The owner: "a join must accept frames whose job ended but whose version exists". Awaiting approval, approved, publishing and published frames serve, on the join's layer or their own; only a frame with no usable version left refuses. Rejected: keeping the transaction's refusal of a frame the policy approved meanwhile (it failed the live 1980 join the same way).
- **138b The joined layer retires the date's other layers when it publishes.** Not at approval: the joined layer is live first, then the others leave the manifest (`published: false`, `retired: {by, at}`), their tiles and versions kept, nothing deleted; the history trigger records it; a frame that publishes alone after its join published is born retired. The join takes the first published frame's layer, so its tileset and presentation stay. Rejected: deleting the retired layers (the owner asked that nothing be deleted before the joined layer is live, and a delete cannot be undone), retiring every same-date layer not in the join (a frame left out may show a part of the city the join does not).
- **138c `joinPartTaken`.** The live "Frame … ended" came from the retry of a duplicate join whose frames a newer join had taken. That case has its own words and is not retryable; `joinPartGone` now says the frame has no usable version left. `apiError.imagery.joinTwoPublished` is gone.
- **138d `grid-names`, approved by the owner.** The owner, 2026-11-09: "Approve the sheet-name placement". A fitted grid whose checks do not hold renders as `grid-names` with its seams (`seamScore`) and its checks against OpenStreetMap; the policy never publishes it; Approve is the city owner's alone, enforced by `imagery.approve` (`apiError.city.notOwner`); the layer records `provenance.archive {method: 'grid-names', approvedBy: 'owner'}`. A grid with no fit at all still waits for three sheets.
- **138e Layers minimized is one floating button.** The 88 px rail is gone: `--hcm-pane-leading: 0px` while minimized, the button absolutely placed at the map's leading gutter, the top docks moved past it with `--hcm-top-start`, and the empty pane stops clipping it (`.pane.leading:has(> [minimized]) { overflow: visible }`: the tour found it "off screen" and its focus ring cut). Paid for by the token fallbacks left in `viewer-styles.ts` (§129c's "for review"): the IIFE is 124,987 bytes gzip (124,990 before). `timeline-styles.ts`' fallbacks stay: a timeline mounted alone (its unit test) has no theme, and its labels crowded.
- **138f The Jobs page and the admin tab's import.** The worker card, Where new jobs run and the Cloud Run meter are one collapsible full-width card (`<details>`) above the list-detail, which splits from `large` (1200 px, `split-from`), whatever its own height (the open card left it under 480 px, which the compact-height rule took for a landscape phone: Playwright found the job alone at 1680 × 900); the choices read When it is on / Always on my computer / Always in the cloud and wrap between words (`overflow-wrap: normal` on the segmented button inside the worker panel, not in the kit, which the engine ships). Import local files picks the folder or zip in the admin's tab and streams it to the worker over the loopback with a session token the worker gives only while signed in for the city (CORS and Private Network Access for the Hosting origins only); its client is a new lazy chunk, `local-run` (1.6 KB, budget row 2 KB: a new chunk's row, pre-approved as keeping the gate working), so the `archive` chunk stays within its 10 KB (9.9). The join's note went into the Imagery chunk (17.4 of 18 KB): `join-card` was at 2,987 of 3,000 bytes.
- **For review**: the retired layers are listed among the layers like any unpublished one (a filter or a section for them is not built); the in-tab import sends the files one at a time (no parallel uploads, no resume of a cancelled upload); the session token lives for the worker's process. The viewer tour's `viewer.unplaced` (c320, m768: the I know where link's 20 px target) and `viewer.story + text spacing` (e1024, l1280: All stories cut off) fail with the base commit's viewer files too: not this batch's, left for the viewer's owner.

## 139. Corona strips searched along their length (track/corona, 2026-11-09) — APPLIED, no gate changed

- **139a** `SensorSpec.strip` (pipeline only, not in `as_contract`) marks KH-4, KH-4A and KH-4B; `locate` searches such a film, when at least 4 times as long as high, window by window (`calibrate/strip.py`, M9 §16). KH-9-pan keeps its camera model; KH-5, KH-7 and KH-9 mapping are unchanged.
- **139b** The window is the city plus 15 km along the strip (the task's figure; 20 km merged the two ends' windows of a city 60 % along on a 240 km strip), the film's full height. UNVERIFIED on a real Corona.
- **139c** A footprint off the city slides 40 km windows, half overlapping, with no local AI (it would run once a window); the matcher still runs in a footprint window.
- **139d** A frame nothing proved keeps the crop of its best-voted window, not of the whole strip.

## 140. Landsat as a source (track/landsat, 2026-11-09) — APPLIED, no budget raised

The owner's request of 2026-11-09 ("import the landsat, add it to our sources, and automate import, as we have for usgs"); as built in `docs/research/M25-landsat.md`.

- **140a Level-1, not Level-2**: Collection 2 Level-1 (`landsat_tm_c2_l1`, `landsat_etm_c2_l1`) keeps ETM+'s 15 m panchromatic band; a per-scene stretch over the clear pixels replaces surface reflectance for a historical layer.
- **140b No new job type**: a Landsat scene is a `usgs-import` whose dataset is Landsat; the pipeline routes `extract` and `warp` by dataset and skips `stitch`, `locate` and `georef` (`landsat/route.py`). The daily cap, the worker's allow-list and the scene's release work unchanged.
- **140c The tick imports on its own by default** (`imagery.landsatAuto`, 1984–2000 by default, one a tick, at most 20 % cloud, the city covered); the daily cap and the guard refuse it as any import. The owner can turn it off in Settings → Imagery → Landsat.
- **140d Approval without a georeference**: within one Landsat pixel of Sentinel-2 (phase correlation of high-passed images) and at most 10 % of the city under cloud, with the city auto-publishing and covered; otherwise Approve. Public domain: no rights step.
- **140e ETM+ stops at 2003-05-30** (the scan line corrector's failure), and a Landsat scene never joins a date plan.
- **140f The shared index names the new exports** (lesson 532: no `export *`), and its imagery-settings block is written on two lines to stay within 400.
- **140g No budget raised for the join card**: Landsat's verdict (`landsatClear` and its two bars) is a module of its own (`schemas/landsat-verdict.ts`, lesson 538), so the admin's shared core gains no export and the join card stays at 2,989 bytes gzip of its 3,000.

## 141. The georeferencer's chunk budget, 18 → 19 KB (2026-11-10) — APPLIED, the owner's explicit yes

- **What**: `scripts/ci/check_bundle_budget.py` `"georef": 19` (was 18).
- **Why**: the owner asked for zoom buttons on the scan, Undo, a step-by-step placing guide and the pair numbers on the map while placing the `harti.zip` maps; together they measure about 18,030 bytes gzip (level 9), 30 bytes over 18 KB after the pair and suggestion overlays were merged into one routine and strings shortened. The chunk loads only on the admin's georeferencer page, never in the public viewer.
- **Owner**: asked in chat, answered "yes" (2026-11-10).

## 142. Standing Hosting deploy and Update the map (2026-11-11) — APPLIED, the owner's explicit yes

- **What**: the agent may run Firebase Hosting deploys (`ship.sh` / `firebase deploy --only hosting:…`) and Setup's **Update the map** (server, pipeline image, worker digest) without asking each time.
- **Why**: the owner, 2026-11-11 in chat: "u have my persimission to always deplay and update the map yourself".
- **Still ask first**: pushes to `master` or a tag, merges, payments, credentials, relaxing a gate, and cloud changes outside that Update-the-map path.
- **Layers row height (same day)**: overlay swatches back to 32 px (`--hcm-icon-size: 20px`); Compare / Street names / POIs and overlay rows `min-block-size` 40 px (switch keeps its own 48 px target).
  Amended 2026-11-13 (the phone tour's findings, `docs/LESSONS.md` 618): the Street names / POIs rows are 48 px again, since two switches 40 px apart overlapped their 48 px targets; the pinned strip stays pinned only on a large window (1200 px wide and 700 px high or more), and scrolls with the list on a phone's bottom sheet or a tablet's side sheet, where at half height it took 170 of 310 px and covered the switches the focus reached. The overlay rows stay at 40 px.

## 143. Georeferencer: map markers identical to the scan (2026-11-11) — APPLIED, the owner's explicit yes

- **What**: On `#/georef`, every pair and suggestion badge on the **map (right)** looks and behaves like the **scan (left)**: same disc, number inside at every zoom, selected ring, hollow checkpoint, dashed `aN` suggestion, half-pair `+`. Shared painters in `packages/ui/src/admin/georef/marker-badge.ts`; the map paints them on a canvas overlay (`packages/admin/src/georef/marker-overlay.ts`) instead of POI overlays (`POI_LABEL_MIN_ZOOM` / `place` / `flag`). Terra Draw keeps transparent hit targets only. Map keyboard: focusable pane, badge crosshair, arrow nudge 1/10 CSS px. Residual colour bands on both panes; pinch-zoom on the scan.
- **Why**: the owner, 2026-11-11: "i want in georeferencer: the points on the right screen to be exactly the same as on the left."
- **Also**: admin-only `project` / `unproject` (`packages/admin/src/map/projection.ts`) for screen-space badges and nudges — not on shared `MapPort` (§146). M22 `#/help` stays the next phase.

## 144. Georeferencer: Second-order polynomial is broken (2026-11-12) — APPLIED

- **What**: On `#/georef`, the transform **Second-order polynomial (at least 6 pairs)** / **Polinomială de gradul 2 (cel puțin 6 perechi)** (`poly2`) refused many real pair sets as `degenerate` while affine and thin-plate still fitted.
- **Why**: the owner, 2026-11-12: "also add to plan, this broken: Second-order polynomial (at least 6 pairs)".
- **Cause**: TypeScript fitted the poly2 place→pixel map on the pairs alone; a quadratic has no quadratic inverse, so well-spread scan pixels whose places lay on two lines (two streets) made the reverse design singular and the whole fit refused. The pipeline already sampled the forward map on a 15×15 grid (`INVERSE_GRID`) for that inverse.
- **Fix**: `packages/shared/src/georef/fit.ts` `poly2Fitter` matches the pipeline (`poly2InverseNodes`); pin S-A16-HAPPY-POLY2-GRID-INVERSE / S-A16-BAD-POLY2-TWO-ROWS; lesson 553. Pairs on only two scan rows still refuse (forward singular) — spread across the image. The e2e-matrix `TEST_GLOBS` also scan `packages/shared/test/georef/*.test.ts` so those Vitest tags count.

## 145. Line-art tiles: never average overview alpha again (2026-11-12) — APPLIED

- **What**: `lineart` pyramid uses `overview_resampling="nearest"` (and deepest-zoom `nearest`); live Post 1847 repaired and cache-busted. Recurrence pinned by `S-P20-HAPPY-ENCODING` / `S-P20-BAD-LINEART-AVERAGE` (`test_lineart_tiles.py`: soft alpha 0 % with nearest at every zoom; the same source with `average` washes above 5 %).
- **Why**: the owner, 2026-11-12: "also make sure the 1847 problem does not happen again!!!".

## 146. Bundle budget: keep georef projection off the engine MapPort (2026-11-12) — APPLIED, no budget raised

- **What**: Shared `MapPort` / `createMapboxPort` do **not** grow `project` / `unproject`. The admin wraps the port with `withMapProjection` (`packages/admin/src/map/projection.ts`, same split idea as `ViewerMapPort`). Dead georef exports dropped (`PAIR_COLOR`, `PAIR_NUMBERS_OVERLAY_ID`, deprecated suggestion overlay ids). Badge painters + map overlay move to a new named chunk `georef-badges` (3 KB; 1.9 measured, like §56b / §77e) so `georef` stays **19 KB** (17.6 measured) — no existing budget raised. Engine room from shorter Map labels copy (Streets / POIs / Străzi / POI, tighter notes): IIFE 125.0 of 125 KB gzip.
- **Why**: §143's badge work pushed `engine.iife.js` over 125 KB gzip and `georef` over 19 KB; owner rule: do not raise budgets.
- **Verify**: `PIPELINE_STAGE=build` → `[SUCCESS] stage 'build' passed`.

## 147. npm-audit: `fast-xml-parser` GHSA-474x-hrwr-fgx4 (2026-11-12) — APPLIED

- **What**: Root `overrides` pin `"fast-xml-parser": "5.12.0"` (first release above the advisory's `<=5.11.2` range). `package-lock.json` and `functions/deploy-lock/` refreshed in the digest-pinned Node image. Never an allowlist.
- **Why**: `static`'s `npm-audit` / `deploy-lock-audit` fail on GHSA-474x-hrwr-fgx4 (quadratic CPU on unterminated stop-node tags); same pre-approved "keeps a gate working" pattern as §74e.

## 148. `imagery.confirmRights` so Approve never strands on needs-confirmation (2026-11-12) — APPLIED

- **What**: Callable `imagery.confirmRights` (`cityOwner`, `fn-imagery` / runs as `fn-admin`): a version awaiting approval whose rights are `needs-confirmation` becomes `clear` with licence `permission`, the owner's `confirmedBy` and `confirmedAt` from the server clock. Empty words → `apiError.imagery.rightsUnconfirmed`; wrong rights → same; not `awaiting_approval` → `apiError.imagery.versionState`. VersionView exposes a rights summary; the approval card shows Confirm and keeps Approve disabled until `rightsAllowPublish`. Live IPB version `ar-mw993zri-s-83618d0c24e6` had rights cleared earlier; this is the product path so it does not happen again.
- **Why**: M20 gated publish on rights but only confirmed at Import; a series already waiting for approval had no Confirm, so Approve refused forever (`rightsUnconfirmed`). Lesson 552; S-A120-HAPPY-CONFIRM-RIGHTS, S-A120-BAD-CONFIRM-EMPTY, S-A120-BAD-CONFIRM-STATE.
- **No budget raised.**

## 149. Hosting deploys must ship `build:install`, never the admin tree alone (2026-11-12) — APPLIED

- **What**: Every Hosting ship under §142 is `npm run build:hosting && npm run build:install` (quality image), then `firebase deploy --only hosting` via `firebase.deploy.json` (no host `predeploy`). A deploy of the admin/public tree without the install folder is refused from now on. Overnight 2026-11-12 restored `/admin/install/1-0-0-3897359/` and submitted Update builds for server, pipeline and site of `1.0.0+3897359`.
- **Why**: Hosting-only uploads that skipped `build:install` left `/admin/install/<slug>/manifest.json` falling through the `/admin/**` SPA rewrite to `index.html`, so Update the map / Install could not fetch the bundle. Lesson 554.

## 150. Line-art default is opaque white paper, not see-through (2026-11-12) — APPLIED

- **What**: `paperTransparent` defaults to **off**. Pyramid runs `paper_opaque` (ink black, paper white, outside clear) for line art unless the owner sets `paperTransparent: true` (then `paper_transparent`). Live Post 1847 rebuilt and published as `…-fix2.pmtiles` and pointed from `cities/bucharest/manifest.json` plus the Firestore layer `source.url`. Pins: `S-P20-HAPPY-ENCODING` (default opaque; opt-in transparent).
- **Why**: the owner, 2026-11-12: "1847 is still see through, give it a white background!!! that is the real fix." Nearest overviews alone left transparent paper, so the plan stayed see-through on the basemap.

## 151. `fostulbucuresti` becomes a reference, never a resource (2026-11-12) — APPLIED

- **What**: its public site's historical maps may be used as a reference: looked at (by the owner or an agent) to find where a feature lies while placing points on our own scans, or to judge a result by eye (`docs/MANUAL_TEST_PLAN.md` J8). Nothing of it is embedded or copied: no tileset, style, token or dataset in our code, config or layers, and no tile or asset shipped.
- **Why**: the owner, 2026-11-12: "new hard rule: we can use fostulbucuresti for reference!" (the 1966 frames DF046/DF047 wait for points). A Mapbox token belongs to its account (using theirs from our app bills them and breaks Mapbox's terms), and copied tiles would ship their georeferencing as ours, so "reference" stays visual.
- **Where**: `AGENTS.md` (*Never*, *Project hard constraints*); automatic matching against their tiles is not part of this and would need its own decision.

## 152. The georeferencer's context menu as a lazy chunk `georef-menu` (2026-11-12) — APPLIED, no budget raised

- **What**: A right-click, a touch held still for 500 ms, or the ContextMenu key / Shift+F10 on the scan or the map opens `<hcm-georef-menu>` (Add a point here, Move this point, Delete this point, Undo; a read-only version's menu has only a line saying it takes no points). The element and the gestures that open it (`packages/ui/src/admin/georef/georef-menu.ts`, `georef-menu-host.ts`) are one dynamic `import()` that the page fetches at its first render: a new named chunk `georef-menu` with its own budget, 3 KB (2.4 measured plus about 20 %, rounded up), added to `ADMIN_CHUNK_BUDGETS` in `scripts/ci/check_bundle_budget.py`. `georef` stays within its **19 KB** (18.7 measured); no existing budget raised. The store's side (`addAt`, `pickUp`, `mapTarget`, the picked-up point dropped by the next click on its pane) stays in `georef`. The scan and the map share one hit radius, `PAIR_HIT_RADIUS` (24 CSS px) of `marker-badge.ts`.
- **Why**: the owner's request of 2026-11-12 (a context menu on both panes; keep the georef chunk within 19 KB, lazy parts allowed). The first build with the menu in `georef` measured 19.5 KB.
- **Verify**: `python3 scripts/ci/check_bundle_budget.py` after the admin build; S-A16-HAPPY-GEOREF-MENU, S-A16-BAD-GEOREF-MENU-READONLY. Its tour state `georef.context-menu` found two older defects, fixed with it (lesson 563): the guide's summary under 48 px on a compact window, and the map box's focus ring cut by the pane.

## 153. `imagery.deleteVersion`: delete a version that never reached the map (2026-11-12) — APPLIED

- **What**: Callable `imagery.deleteVersion` (`cityEditor`, `fn-imagery` / runs as `fn-admin`): a `failed`, `cancelled` or `rejected` version whose job is finished, or an archive series waiting for points (its job ended first as Cancel ends it), is deleted with its job, the job's logs, its scratch files and its own private folder (plus a public copy a dead publish left). Refusals: `apiError.imagery.deletePublished` (approved, publishing, published, superseded, joined), `apiError.imagery.deleteRunning` (a job still queued, running or waiting; also a Retry that lands between the check and the deletion), `apiError.imagery.deleteInUse` (another version is `basedOn` it), `joinPartHeld`. The version page's **Delete this version** asks first and returns to the list; it is offered for failed, cancelled and rejected versions whose job is finished and for a parked archive series (replacing that one's Cancel-area Delete), never for one another version of the list is `basedOn`. Review of 2026-11-12: a failed version's Dismiss (labelled Delete, but only `imagery.reject`) is gone from the page, so the page shows one Delete and it deletes; the e2e locators match names exactly. The transaction reports a version gone meanwhile as `notFound` and one that left its state as `versionState`.
- **Why**: the owner, 2026-11-12: cancelled and failed versions stayed in the Imagery lists for ever, and an archive series parked for points could not be started over. No history entry: layer versions are not audited documents; the deletion is the structured log line with the caller's uid, as every version decision writes. The archive's record (`archives/{a}.jobs`, series → job id) loses the deleted series' entry in the same transaction (the last one leaves the archive unimported), and `imagery.archiveImport` refuses only a series the record still names, so a series started over is imported again from the archive page, which now shows the plan of the series not imported yet below the others' progress (review of 2026-11-12: it once kept pointing at the deleted job and the series could never come back).
- **No budget raised.**

## 154. The georeferencer's texts get their own catalogue `admin-georef/` (2026-11-12) — APPLIED, no rule relaxed

- **What**: the merge of track/georefmenu and track/deletecancel into `feat/engine-rewrite` put `packages/shared/src/i18n/admin-imagery/{ro,en}.ts` at 401 lines each (ESLint `max-lines` 400). The `georef` section (`adminContent.georef.*`) moved as is to `packages/shared/src/i18n/admin-georef/{ro,en}.ts` (`AdminGeorefKey`), merged into `ADMIN_CONTENT_CATALOGUES` beside `admin-imagery`, as the orders' texts left that folder (§110); `packages/shared/test/i18n-admin.test.ts` maps the folder to its prefix. No key or text changed. The same merge put `packages/shared/src/index.ts` at 401: the viewer events' value and type exports became one line.
- **Why**: the 400-line limit stays; splitting by section keeps each catalogue one owner's.
- **Verify**: `npx eslint` on the four files, `python3 scripts/ci/check_i18n.py`, `packages/shared/test/i18n-admin.test.ts`.

## 155. Two budgets kept after the merge of 2026-11-12: a chunk `legacy-reads` and a place's late year in admin words (2026-11-12) — APPLIED, no budget raised

- **What**: after the four merges (`docs/LESSONS.md` 568) the admin build put `packages/shared/src/schemas/legacy-reads.ts` (Home, the Imagery lists and a version's page read older records through it) into `editor-shared`, 13.05 KB of its 13. It is now its own named chunk `legacy-reads` (`LEGACY_READ_MODULES` in `packages/admin/vite.config.ts`) with a new row in `ADMIN_CHUNK_BUDGETS`: 1 KB (0.52 KB measured; the smallest whole budget); `editor-shared` measures 12.69 KB again. The viewer's `engine.iife.js` reached 125.04 KB of 125, from two causes. `packages/shared/src/index.ts` re-exported `legacy-reads.ts` with `export *`, which left an empty module wrapper in the IIFE although the viewer uses none of it: the index names its four exports now (124.99 KB again, as before the work branch's legacy reads). And the words of `validation.yearLate`, which only the admin's place editor shows, sat in the viewer's catalogue: `placeYearIssues` now reports a year after next year as the schema's own `validation.tooBig`, and the editor says it in its own words, `adminContent.common.issue.yearLate` ("The year cannot be after next year."), through `packages/ui/src/admin/editing/issue-text.ts` (its own words per field now a list, the first whose codes match). The viewer's catalogue lost the key; nothing the owner reads changed.
- **Why**: no budget raised; what only the admin needs stays out of the viewer, and `editor-shared` keeps what the editors share.
- **Verify**: `npm run build` then `python3 scripts/ci/check_bundle_budget.py`; `packages/ui/test/admin/editing/issue-text.test.ts`, `packages/ui/test/admin/pois/poi-editor.test.ts`; S-A32-BAD-PLACE-YEAR.

## 156. The georeferencer's linked views, within the 19 KB `georef` chunk (2026-11-12) — APPLIED, no budget raised

- **What**: Once the pairs give a fit, panning or zooming the scan moves the map to the same place and the map's moves bring the scan along (`docs/research/M3-interfaces.md`, addendum *Linked views*); **Link the views** turns it off (on by default, kept in memory for the session; disabled with a note without a fit). The mapping both ways and the frame-throttled `ViewLink` with its echo guard live in the lazy `georef-extras` chunk (1.0 → 1.5 KB of its 2). `packages/admin/vite.config.ts`: the `georef-badges` group now also takes four helpers that import no module of the `georef` chunk, only `@hcm/shared` and `marker-badge` (`pairs.ts`, `history.ts`, `tones.ts`, `full-screen.ts`), 2.0 → 2.7 KB of its 3; `georef` measured 18,917 bytes gzip after the review fixes (18,916 before them) (budget 19,000; it was 18,869 before the change and 19,383 with the link and no move).
- **Why**: the owner's request of 2026-11-12 (linked views; never raise a budget, lazy loading allowed). The toggle, the scan pane's `follow` / `hcm-view` and the store's glue have to load with the page.
- **Said plainly**: `georef-badges` loads with the georeferencer's page too, so moving the four helpers there relocates code rather than deferring it: the page's eager download did not shrink, only the `georef` number did. What is deferred is the mapping and the `ViewLink` (`georef-extras`). The toggle is a Lit template of the panes and the scan pane's `follow` / `hcm-view` handling is part of `hcm-scan-viewer`, both in `@hcm/ui`; moving them behind the lazy chunk would need a lazily defined element for one button, which costs more glue than it saves. Merge note: these numbers were measured on `track/georefmenu` (as §152, lessons 560 and 561); merged into `feat/engine-rewrite` this entry is §156, the lessons 570 and 571, and the two keys became `adminContent.georef.linkViews` / `adminContent.georef.linkViewsNoFit` in the `admin-georef` catalogue (§154); the build and `check_bundle_budget.py` were re-run on the merged tree.
- **Verify**: `npm run build` then `python3 scripts/ci/check_bundle_budget.py`; S-A16-HAPPY-GEOREF-LINKED, S-A16-BAD-GEOREF-LINKED-NO-FIT.

## 157. All project Markdown in English only (2026-11-12) — APPLIED

- **What**: every Markdown file of the repository is written in English only. `docs/ADMIN_GUIDE.ro.md` is gone (`docs/ADMIN_GUIDE.en.md` is the one guide, and kept what only the Romanian one said); the Romanian halves of `docs/SELF_HOST.md`, `starter-kit/README.md`, `templates/starter-kit/README.md` (which `create-historic-city` copies into a new city) and `packages/create-historic-city/README.md` are removed, their English halves kept. The static export's own `README.md` and `RIGHTS.md` (`functions/src/export/documents.ts`) are written in English only.
- **Not affected**: the in-app texts (the i18n catalogues of the viewer, the admin, the CLI and the exported page) stay in every language; Markdown that documents a Romanian UI label (a quoted button, an i18n key's `ro` column) keeps it; the photos' and places' own titles are data; the legacy `seed/bucharest/` is not touched.
- **Why**: the owner, 2026-11-10: all project Markdown in English; the app's texts stay in all languages.
- **Where**: `.agent/instructions.md` (*i18n*), `.agent/skills/governance/doc_update_skill.md`, `docs/research/M5-interfaces.md` §3.4.

## 158. A manual Retry of a run on the owner's computer passes the attempt cap (2026-11-12) — APPLIED

- **What**: archive series `ar-mw993zri-s-4054e55659a3` (`runOn: 'local'`) failed three times in `place` because the server refused a record (`overview` missing from `STITCH_METHODS`, fixed and deployed: `docs/LESSONS.md` 569). At `attempt: 3` (`JOB_MAX_ATTEMPTS`) `jobRetryable` and `imagery.retry` refused it, and the version page offered only Delete this version. New shared rule in `packages/shared/src/api/imagery.ts`: `runsLocally(job)` (`runOn: 'local'`, `localOnly`, or `archive-series`); `retryPastCap(job, publishing)` = `failedOutdated(job)` or (not a publish and `runsLocally`); `retryCures(job, publishing)` = no `NOT_RETRYABLE_CODES` failure, except `attemptsExhausted` when `retryPastCap` holds (the dispatcher ends a local run whose worker was lost at the cap with that code). `jobRetryable` (admin: version page, Jobs page) and `functions/src/imagery/retry.ts` (`curable`, `uncapped`, `attemptsAgain`) both use them; such a retry sets `attempt` back to 0, as an outdated runner's already did.
- **Why**: the cap stops paid cloud work looping; a run on the owner's computer costs no cloud compute, and the only way out was deleting and re-importing the series. Automatic retries keep the cap (the dispatcher, the tick, `worker.claim`); a cloud run at the cap and every publish (`PUBLISH_MAX_ATTEMPTS`, Mapbox's paid work) stay refused. A retried local job can still be moved to the cloud while queued (`imagery.runOn`): it then gets at most `JOB_MAX_ATTEMPTS` cloud runs behind the free-tier OK and the budget guard, and needs the owner's click each time, so no loop is unattended.
- **Not done**: "the server release changed since the job failed" as a further reason to pass the cap: no job field records the release or pipeline image a failure happened under (`searchedWith` is only a parked frame's search image), and no field was invented for it.
- **Verify**: `packages/shared/test/api/imagery.test.ts`, `functions/test/imagery/retry.test.ts`, `packages/admin/test/imagery/version.test.ts`; S-A12-HAPPY-LOCAL-RETRY-PAST-CAP, S-A12-BAD-CLOUD-RETRY-AT-CAP.

## 159. The daily cap counts only jobs that may run in the cloud (2026-11-12) — APPLIED

- **What**: Bucharest's worker choice is `local`, yet a join of free USGS frames was refused with `apiError.imagery.dailyLimit` after ten jobs that day. `functions/src/imagery/limits.ts` now leaves every job on the owner's computer (`runOn: 'local'`, `localOnly`) out of the count; `refuseRasterJobs` / `refuseNewRasterJob` return a `Placement`: for a city whose choice (`cities/{city}/workers/choice`) is `local` they ask only the budget guard and the caller creates every new job `runOn: 'local'` (import, upload, landsat auto-import, delivered order, a join's frames and its `layer-join`). `imagery.runOn` moving a counted job from the computer to the cloud calls `refuseCloudMove` first (guard and today's caps) and stamps `countedAt` with the move's time, so it counts on the day of the move. `JOBS_PER_DAY` is unchanged.
- **Why**: the cap bounds paid Cloud Run work; a job on the owner's computer costs none. The decision is recorded on the job at its creation, so it is auditable, and the only way such a job reaches the cloud is a move that asks the cap, the budget guard and (at dispatch) the free-tier OK.
- **Not done**: `auto` with a connected worker still counts at creation (the job may fall back to Cloud Run if the worker goes away); only the explicit `local` choice passes the cap. The cap's queries stay outside the transaction (a spend guard, not an exact quota), so a choice changed in the same instant as a creation may let one job through either way.
- **Verify**: `functions/test/imagery/local-daily-cap.test.ts`, `functions/test/imagery/archive-import.test.ts`; S-A12-HAPPY-LOCAL-PAST-DAILY-CAP, S-A12-BAD-RUNON-CLOUD-PAST-CAP.

## 160. Pre-release tags and the committed engine without an EditorConfig exception (2026-11-12) — APPLIED, the owner's explicit yes ("pr and merge as v1.0.0.beta1"; the `release.yml` edit approved through the coordinator)

- **What**: the release tooling accepts `vX.Y.Z` and, from now on, the SemVer pre-releases `vX.Y.Z-beta.N` and `vX.Y.Z-rc.N` (N without leading zeros), nothing else: `RELEASE_TAG_PATTERN`, `releaseTag`, `versionOfTag`, `isPrerelease`, `releaseDistTag`, `releaseVersionSchema` (`release.json`, a city export's `engineVersion`) and `engineMajorBase` (which refuses a pre-release) in `packages/shared/src/schemas/engine-release.ts`; `parseReleaseVersion` and a SemVer-ordered `compareVersions` (`1.0.0-beta.1` < `1.0.0-rc.1` < `1.0.0`, so a manifest needing `1.0.0` refuses a beta engine) in `compat.ts`; the install release `RELEASE_PATTERN` (`1.0.0-beta.1+abc1234`); `scripts/release/src/versions.ts` (the bump, the guides' CLI pins), `notes-sri.ts` (a pre-release's block offers no `@1` line); `scripts/ci/release_pins.py` (`RELEASE_VERSION`), `check_release.py` (the tag, the guides' pins) and `check_kit_pins.py`; `functions/build.mjs` and `functions/src/adapters/export-kit.ts` (`ENGINE_VERSION`); the e2e mock CDN's release route. `.github/workflows/release.yml` (owner-approved edit, actions still pinned by SHA, no `pull_request_target`): the tag filter is the three forms only, and the `publish` job sets `prerelease: true` and `make_latest: false` for a pre-release tag. Nothing moves `@1`, purges or publishes to npm; a later npm publish of a pre-release uses `--tag beta` / `--tag rc` (`releaseDistTag`), never `latest`.
- **§59c answered without a relaxation**: `npm run release:cdn` now writes lit-html's whitespace class, which the minifier emits as an untagged template literal holding a raw tab and line break (``gf=`[ <TAB><LF>\f\r]` ``), with escapes (`` `[ \t\n\f\r]` ``): the literal's value is byte for byte the same string, the committed engine has no trailing whitespace and `editorconfig` passes on `cdn/engine/` with no `.editorconfig` exception (58d's preferred way out, "the transform itself"). The replacement is exact (that literal only, in `.js` / `.mjs`), so any other finding still fails the gate.
- **Done for v1.0.0-beta.1**: `npm run release:bump -- 1.0.0-beta.1`, `npm run build --workspace @hcm/engine && npm run release:cdn`, `npm run release:pin-kit`, both notes files with `npm run release:notes -- --write`, the releases index.
- **Verify**: `packages/shared/test/schemas/{engine-release,compat}.test.ts`, `scripts/release/test/{versions,notes-sri,cdn}.test.ts`, `scripts/ci/tests/test_check_{release,kit_pins}.py`; `python3 scripts/ci/check_release.py --tag v1.0.0-beta.1`, `npm run release:cdn -- --check`, `PIPELINE_STAGE=all`.

## 161. The rename: Historic City Map Maker, `ventura8/historic-city-map-maker`, București dispărut as the example, the legacy site retired (2026-11-12) — APPLIED, the owner's decisions

- **Display name**: the product is **Historic City Map Maker** (was "Historic City Map") in `README.md`, `AGENTS.md`, `CLAUDE.md`, the docs that name it, the agent assets and skill mirrors, the start page's title and legal pages, the About dialog's engine line (`about.engine`, ro and en keep the English proper name), a new city's default about text, the starter kits, `create-historic-city`'s README and description and the release notes. Unchanged: the npm names (`historic-city-map`, `@hcm/*`, `create-historic-city`), the `HistoricCityMap` global, the custom elements, file paths, the cloud resources' titles Setup already created (IAM role, Artifact Registry, budgets), the Sonar project key `ventura8_bucurestiuldisparut.github.io` (a SonarCloud identifier; renaming it is a SonarCloud step for the owner).
- **Repository**: the owner renamed the GitHub repository to `ventura8/historic-city-map-maker`; every current reference follows (`ENGINE_REPOSITORY`, so `release.json`, the kit's pins and the jsDelivr addresses; the starter kits' links; `create-historic-city`'s `repository`; the About dialog's and the start page's source and issue links; the Nominatim and CI user agents; `infra/project.json`'s `github.repo`, which the Pages redirect's base path reads; docs and skills). The workload-identity binding uses the repository's numeric id (`repoId`), so the rename does not break CI's deploys. Historical records keep the old name (this file's earlier sections, `docs/LESSONS.md`, the research and review notes, the Bucharest seed's about text).
- **București dispărut is an example**: the README, `AGENTS.md`, `CLAUDE.md`, `docs/ARCHITECTURE.md` and the root `package.json` present Historic City Map Maker as the engine and admin for any city, with "Example: București dispărut (`https://bucurestiul-disparut.web.app/`)". The example city stays the test and deployment city (the owner, 2026-11-12): `seed/bucharest`, `seed/bucharest-2023`, `sites/bucharest`, the Firebase project and site `bucurestiul-disparut`, the e2e fixtures and the Sonar key are unchanged.
- **The legacy site is retired**: master's GitHub Pages site (`build_type: legacy`, source `master` `/`, now at `https://ventura8.github.io/historic-city-map-maker/`) is the 2015–2022 hand-written page: 104 files (`index.html`, `index-l.html`, `interactiv.html`, `.nojekyll`, `geojson/`, `images/`, `photos/`, `thumbnails/`, `scripts/leaflet*`). None of them is on `feat/engine-rewrite`, and `origin/master` is an ancestor of it, so the merge deletes all 104 (`git diff --name-status origin/master HEAD` lists them all as `D`); no file exists only on master. After the merge the legacy Pages build would publish the monorepo's root (Jekyll rendering `README.md`), so the owner disables Pages (the coordinator's step, never Claude's); the live map is `https://bucurestiul-disparut.web.app/`. The redirect tree (`npm run build:site -- --pages-redirect`) remains the alternative for keeping the old links working on Pages.
- **Verify**: `PIPELINE_STAGE=all`; `python3 scripts/ci/check_release.py --tag v1.0.0-beta.1`.

## 162. GitHub Pages is the project's landing page (2026-11-12) — APPLIED, the owner's decision (the new workflow and the `ci.yml` edit approved through the coordinator)

- **What**: GitHub Pages (`https://ventura8.github.io/historic-city-map-maker/`) serves a small landing page "for whoever wants to start their own app for their city": `sites/landing/` (`index.html` in English, `ro.html` in Romanian, `landing.css`), written by `npm run build:landing` (`scripts/site/src/landing/`: the words in `texts.ts`, one catalogue per language, the page from elements and text only in `page.ts`) and committed. It says what Historic City Map Maker is (one sentence and three points), links **Start your map** to `https://start-historic-city.web.app/`, names the terminal road at this release (`npx create-historic-city@<version> self-host`; both pages are in `PINNED_DOCS`, so the bump rewrites them and `release-check` holds them, never `@1`), links the example București dispărut (`https://bucurestiul-disparut.web.app/`), the repository, `SETUP.md`, `SELF_HOST.md`, `ENGINE_API.md`, the releases list (pre-releases included) and the start page's privacy policy and terms. No script, no cookie, no analytics, no third-party request (a meta CSP with `script-src 'none'`), system colours for light and dark, targets of at least 44 px, no screenshot (none in the repository is cleared for it). English is the page at the root because the page addresses any city; Romanian is one link away.
- **Gates and tests**: a new static gate `landing` (`npm run build:landing -- --check`) holds the committed folder to the build (both languages complete, the version current); `.prettierignore` lists `sites/landing/` (generated, the pre-approved kind that keeps a tool working, like `cdn/engine/`); `scripts/site/test/landing.test.ts` (the build, its links, html-validate, the refusals); e2e `e2e/admin/specs/start/landing.spec.ts` (the e2e Hosting server serves the folder at `/landing/`) with the tour states `start.landing` and `start.landing-ro`; rows S-A132-HAPPY-LANDING and S-A132-BAD-LANDING-MISSING-KEY.
- **Deploy**: `.github/workflows/pages.yml` (new, owner-approved): on a push to `master` touching `sites/landing/**` or itself, and on a manual dispatch, it uploads `sites/landing/` as it is (`actions/upload-pages-artifact`) and deploys it (`actions/configure-pages`, `actions/deploy-pages`), each pinned by full SHA with its `# vX.Y.Z`, `contents: read` by default and `pages: write` + `id-token: write` only on the deploy job; it builds nothing and runs no repository code; no `pull_request_target`. `ci.yml` no longer uploads or deploys a Pages artifact (its `deploy-pages` job published Bucharest's site, which lives on Firebase Hosting since M6), so one workflow owns Pages.
- **For the owner, after the merge** (never Claude's): Settings → Pages → Build and deployment → Source: **GitHub Actions** (today `build_type: legacy`, branch `master` `/`), then run `pages.yml` once (or push a landing change). Until then the legacy builder would publish the merged root (`README.md` through Jekyll).
- **162b Pages stays on the legacy builder until the merge** (2026-11-14): `master` holds no `pages.yml` yet, so switching the source to GitHub Actions now would stop publishing. The switch is done after `feat/engine-rewrite` is merged into `master`, then `pages.yml` runs once.
- **Verify**: `PIPELINE_STAGE=static` (`landing`, `actionlint`, `workflow-policy`, `action-pins`), the `tools` Vitest project, the e2e admin tier.

## 163. Start page OAuth in its own project start-historic-city (owner 2026-11-12): its consent screen and verification no longer include the example city's admin scopes — APPLIED, the owner's decision

- **What**: the owner created the Google Cloud project `start-historic-city` (number 499020596181) and in it the Web client `Start your map` (`499020596181-urom5vlitv2slhaj1cqliae5ddg3n0g6.apps.googleusercontent.com`; origin `https://start-historic-city.web.app`, redirect URIs with and without the slash). The start site is rebuilt with `HCM_START_OAUTH_CLIENT_ID` set to that id and `HCM_START_SITE_VERIFICATION=google81a1ffad6e76455f.html`, and `dist/start/` is redeployed to the Hosting site `start-historic-city` (still in `bucurestiul-disparut`; Hosting deploys pre-approved, §142). No code changed: the page reads the id from `start-config.json`, written at build.
- **Why**: the client used to live in `bucurestiul-disparut`, whose consent screen also carries the example city's admin scopes; Google's verification of the start page would have reviewed both. In its own project the consent screen lists only the start page's two scopes, and verifying it touches nothing of the example city.
- **Left to the owner**: the new project's consent screen (Branding: home page, privacy policy, terms on `start-historic-city.web.app`; scope justifications; demo video) and the verification submission; deleting the old client in `bucurestiul-disparut` once the new one is proven.
- **Verify**: `curl https://start-historic-city.web.app/start-config.json` serves the new id; `packages/admin/test/start/`, `scripts/site/test/start.test.ts`, `e2e/admin/specs/start/`.

## 164. The pipeline's parallelism follows the free memory; a low-memory mode (2026-11-12) — APPLIED, the owner's order ("12 GB for lint is crazy, optimize"; pre-approved class: keeps a tool working, no gate relaxed)

- **What**: `scripts/ci/parallel.py` decides how much runs at once from `MemAvailable` as well as the cores: the gates of a stage (a CPU and 2 GiB each; `PIPELINE_JOBS` still wins), ESLint's workers (`scripts/ci/lint.sh`: a quarter of the CPUs; one worker, and one more per 5 GiB available past 9), Vitest's (`VITEST_MAX_WORKERS`) and Playwright's (`HCM_E2E_WORKERS`, read by `e2e/playwright.config.ts`). `HCM_MAX_PARALLEL=<n>` caps all of them, `HCM_LINT_WORKERS=<n>` sets ESLint's, `HCM_LOW_MEM=1` is the low-memory mode (gates one at a time, one ESLint worker, two Vitest and two Playwright workers). `scripts/ci/run-all-checks.sh` forwards the five variables by name and starts the container with `--oom-score-adj 500` (`HCM_OOM_SCORE_ADJ`), so a runaway gate dies before the desktop session. `npm run lint:changed` (`scripts/ci/lint-changed.sh`) lints the files that differ from `origin/feat/engine-rewrite` on one worker: the check before a commit.
- **Measured** (the NUC, 16 threads, the whole tree, the container's cgroup `memory.peak`, which counts page cache too): ESLint on one worker 228 s and 8.8 GB, two 137 s and 14.2 GB, four 103 s and 17.8 GB. With V8's default heap one worker aborted (out of heap at about 4 GB) and two ended `ERR_WORKER_OUT_OF_MEMORY`, so `lint.sh` gives one or two workers a larger heap (12,288 and 8,192 MB). One worker is 2.2 times the time of four, over the 1.5 asked for a lower default, so the default stays by the machine: four workers where 24 GiB are free, one on a laptop with under 14.
- **Where the memory goes**: typescript-eslint's `projectService` builds, in every worker, a TypeScript program for each of the 24 `tsconfig` projects that worker's files fall in, and a project that references another loads its sources again; nothing is shared between workers. So the first worker costs about 9 GB and each further one about 5.
- **Not done**: one shared program (a single lint `tsconfig` in place of `projectService`): it would type every package under one set of `lib` and `types` and could change what the type-aware rules report, so it needs its own measured change; the files that fall into the default project were not listed. The peak memory of the stages `tests`, `build` and `e2e` was not measured (only ESLint, the consumer the owner named). No rule, threshold or gate changed.
- **Verify**: `scripts/ci/tests/test_parallel.py`, `scripts/ci/tests/test_pipeline.py`; `HCM_LINT_WORKERS=1 npm run lint` on the NUC.

## 165. The browser tab icon: the Layers map glyph by default, and the admin can change it (track/favicon, 2026-11-08) — APPLIED, no budget raised

The owner: "let's have the map icon we use in Layers as the default browser tab icon for the app, and make sure the admin can change it". Before: every page linked `data:,` (no icon at all) and no web app manifest existed. Contracts: `docs/ENGINE_API.md` → *The page's tab icon*, `docs/research/M2-interfaces.md` → *The city's tab icon*; scenario rows V52 and A101.

- **165a The default** is the Material Symbols Rounded `map` glyph (Apache License 2.0, Copyright Google LLC; `packages/ui/fonts/LICENSES.md`), the one the Layers panel draws, white on a rounded square of the seed colour (a white glyph reads on light and dark tab strips; a brown glyph alone would not). Its outline is a constant (`MAP_GLYPH_PATH`), which the existing `fonts` gate now checks against the committed subset with HarfBuzz: no new gate.
- **165b PNG only, and the default inlined.** The pages the build writes (a site without the bucket, `/city/` before its city's icon loads, the admin, the start page, 404 and start-up) and the starter kit carry the default as a 32 px PNG `data:` address (`DEFAULT_FAVICON_DATA_URL`, 892 characters; every page's policy already allows `data:` images). Rejected: PNG files written next to each page (the site builds are synchronous and sharp is not; the kit, the CLI's scaffold and the export would each have to copy binaries) and an SVG favicon (a second link to keep apart from a custom PNG, and no apple-touch-icon). The default the build inlines is in the project's colour, not each site's `themeColor`: the city's own icon in the bucket wears its seed colour. No 192 px icon and no web app manifest: none existed, and nothing asked for an installable app.
- **165c Fixed names in the bucket, not content-hashed ones.** A page cannot learn a hash without reading Firestore (the viewer never does) or being rewritten after each change (no deploy per icon), so `cities/<city>/icon-{32,180,512}.png` are overwritten in place with a five-minute cache; a tab already open may keep its old icon until reloaded (the card says so). The admin's preview adds `?v=<first 8 of the sha256>`.
- **165d No `city.icon` in the manifest.** `citySchema` is strict and bundled into the engine, whose IIFE has 29 bytes left (§122); the engine is unchanged (zero bytes) and the City Manifest v1 too.
- **165e A callable, not a Storage upload trigger.** `cities.setIcon` (a city's editors, as the theme) checks the bytes and answers at once with the refusal's own message, and needs no client-writable Storage path, no `storage.rules` change and no trigger. The request is base64 within 1,333,336 characters (1 MB of bytes). Only PNG and WebP pass, read from the magic numbers: an SVG never reaches sharp (the repository's no-SVG-from-users rule). The browser checks the type and the size first, so an SVG is refused without a call.
- **165f The default follows the theme.** `publish.buildManifest` draws it for a city without one, or whose default wears an older seed colour (a theme change already requests a build); an upload is never replaced, and one made during the drawing wins. A failure is logged and never fails the manifest. So `cities.create` and `setup.createCity` need no call of their own: a new city's first write requests a build.
- **165g The record is server-owned and quiet.** `cities/{city}.icon` is outside `CLIENT_WRITES` (the rules refuse it), outside `MANIFEST_FIELDS` (no build), and an icon-only write is not listed in the city's history (`UNLISTED_FIELDS`); a revert keeps the current icon, as any server-owned field.
- **165h The generic city page** inlines the default and its `config.js` swaps in the city's icon once `icon-32.png` loads (an `Image` probe, then `link.href` and a new `apple-touch-icon` element: no HTML). A city without an icon keeps the default; the probe's 404 is one more console line beside the manifest's own 404 for a city never published.
- **165i The admin's own tab keeps the default**: it serves many cities, so it has no single icon to follow, and the default tells it apart from a city's tab. The card previews the city's icon instead.
- **165j The export** inlines its city's 32 px icon into its `index.html` (`fillKitPage`'s optional `icon`, which accepts only a PNG `data:` address) or keeps the kit's default; the zip gains no file.
- **165k Bytes**: the engine is unchanged (zero bytes). The default PNG (892 characters) is in `admin-core` (387.2 KB of 450).
- **165l A chunk of its own for the card, for review.** With the card in it the `settings` chunk measured 20.6 KB of its 20 KB. Rather than raise that budget, the card's view and the browser's checks of a chosen file (`icon-section.ts`, `icon-upload.ts`) are fetched the first time the section opens (`lazy-icon.ts`, as the budget and export cards are), and the card's CSS went (it uses the page's `actions` and `note`): `settings` 19.8 KB, the new `icon-section` chunk 1.3 KB, whose row in `ADMIN_CHUNK_BUDGETS` is 2 KB (the measurement plus about 20 %, the rule of every row). No existing budget changed; `ADMIN_TOTAL_KB` unchanged. The new row is the reviewed decision a new chunk needs (`scripts/ci/check_bundle_budget.py`).
- **165m The merge** (2026-11-12): track/favicon merged `feat/engine-rewrite` (124 commits). Its behaviour V52 became V54 (the zoom buttons took V52), its lessons 493 to 495 became 578 to 580, this section was §123, and the registry counts 98 functions.

## 166. The default tab icon wears the user's theme (track/favicon, 2026-11-12) — APPLIED, no budget raised

The owner: "make sure the icon in the tab uses the theme set by the user", and "I want to see our default browser tab icon for București dispărut asap". It replaces §165b (one inlined default), §165c's links to the bucket and §165h.

- **166a Two inlined variants.** Every page the build writes links the default twice, each under its `prefers-color-scheme`: the square in the theme's `primary`, the glyph in its `on-primary`, of the palette of the project's colour `#8B5E3C` (`gen-theme.mjs`): light `#875329` with `#FFF7F4`, dark `#F4BB92` with `#5D3719` (`DEFAULT_ICON_VARIANTS`, `DEFAULT_TAB_ICONS`; sharp's drawing, pinned by `functions/test/cities/map-icon.test.ts`). The tab follows the system with no script.
- **166b The chosen theme, with zero engine bytes.** The IIFE has no room (§122), and the engine has no theme event. The page's own script (`tab-icon.js`, from `tabIconSource`) reads the colours `<hcm-map-viewer>` wears (`getComputedStyle`: the chosen mode and the city's own palette are already there) and draws the glyph on a canvas into the icon link (`paintTabIcon`, `followViewerTheme` of `@hcm/shared`, written into the page with `toString()` as `configureCityPage` is). It paints on `DOMContentLoaded`, `hcm-ready`, `hcm-error`, each `click` and `keyup` (the theme is picked with one) and the two media queries' changes; a paint that changes nothing leaves the link as it is. A `hcm-theme-change` event would be cleaner and waits for room in the IIFE.
- **166c A file of its own**, not lines appended to `config.js`: a city site's `config.js` stays the one literal assignment `readConfigJs` reads. The generic city page's `config.js` was already code and ends with the same lines.
- **166d The default is purely a Hosting change.** No page links the bucket any more: the root inlines the default like every other page, so the icon shows on a project whose functions are older than the icon (Bucharest on 2026-11-12, before Update the map).
- **166e An upload is told from the default by a file.** The page cannot read `cities/{city}.icon`. `cities.setIcon` writes an upload's 32 px copy to `icon-own-32.png` and drawing the default deletes it; the page probes that name and, when it loads, shows it in every theme (never recoloured). `icon-{32,180,512}.png` stay as they were (the admin's preview, the export, the home screen: `icon-180.png` is linked as `apple-touch-icon` once it loads). A city on the default costs two 404 probes per load until its functions are updated, then one.
- **166f The admin** paints its tab from its root's theme whenever the shell applies one (`paintRoot`), in `admin-core`.
- **166g Not done**: the starter kit's template and the static export keep one inlined icon (no build writes their page); the start page's icon is the project's brown while its theme is the baseline's.
- **166h Its own entry of `@hcm/shared`.** The glyph, the default's files and the painter (`kit/map-icon.ts`, `kit/tab-icon.ts`) are `@hcm/shared/tab-icon`, not part of the root index: the engine's bundler keeps an empty initialiser for every module the index reaches, and with them the IIFE measured 125,026 and then 125,008 of 125,000 bytes gzip after the merge. The icon's limits and sizes moved beside the callable's schemas (`api/city-icon.ts`).
- **166i The settings chunk after the merge** measured 20,087 of 20,000 bytes gzip (the card's state and loader, §165l, on top of the main line's growth). The card's state became a function with one intent (`iconIntents`, `setIcon`) and the budget's, the export's and the icon's lazy cards share one loader (`lazyCard`, `packages/ui/src/admin/cities/lazy-budget.ts`), with no behaviour change; no budget raised.

## 167. The full-size view's zoom buttons, photo versions and the first side-loaded part (track/photoversions, 2026-11-09) — APPLIED, no budget raised

The owner's request of 2026-11-09 ("add + and - buttons for when viewing a photo full screen. also we will have multiple versions of a photo (original, improved, colorized). implement") and the owner's earlier yes to "Load extras on demand" (side-loaded IIFE parts with SRI). Contract: `docs/ENGINE_API.md` → *The full-size view*, *Photo versions*, *Side-loaded parts*.

- **167a The full-size view is the first side-loaded part.** The IIFE stood at 124,987 of its 125,000 bytes gzip; the versions' switch, its texts and `pv=` alone did not fit. `<hcm-lightbox>`, its zoom and its styles left both builds for `engine.extras.js` (2.6 KB gzip), added with its `sha384-` integrity the first time a photo opens full size; the IIFE measures 124,390 bytes (the host's Python gzip, level 9) with the whole feature, about 600 bytes of headroom. The part takes Lit and the helpers from the engine (`extras-kit.ts`): one Lit, no second catalogue. The ES module build loads the same part (one way for both builds; `engine.mjs` 96.7 of 100 KB).
- **167b Why not Firebase's SDK first.** It is the IIFE's biggest inlined chunk (13.5 KB) and self-contained, but its load sits behind the analytics consent and the field measurements' timing; moving it is a larger change of a flow the e2e checks closely. **For review**: it is the next candidate when the IIFE is full again.
- **167c Versions are separate fields, not a list.** `image` stays the original (every older manifest and document is valid as it was); `versions.improved` and `versions.colorized` are written by `photos.onUpload` from an upload whose custom metadata says `version` (the Storage rule allows only those two words, and only from a reviewer), with their own content-hashed WebP pair and original. Credits are the admin's `versionCredits`, outside `versions`, so the server owns the files and the admin the names. A reviewer may only remove a version (`firestore.rules`: no key added or changed).
- **167d Uploaders add no versions yet.** A version of a photo that waits for review would need held pictures and `review.decide` to move them (M13 §2); the server refuses it (`apiError.photo.versionNotAllowed`) and the uploader's editor has no section. **For review**: whether uploaders should send versions with their photos.
- **167e The default version** is improved when there is one, else the original; colorized is shown only when picked. `pv=` keeps the pick; an unknown word reads as `original`, a version the photo lacks shows its default.
- **167f The zoom buttons** reuse the keys' step (1.25) between 1x and 4x around the centre and are soft-disabled at the limits, as the map's (§128). Their names say "the photo" (`lightbox.zoomIn`, `lightbox.zoomOut`): the map's "Mărește harta" would be wrong over a photo.
- **167g Budget rows.** `ENGINE_CHUNK_BUDGETS` gains `engine.extras.js: 4` (2.6 KB measured; 7 since §167i). The static export copies the part with the IIFE (`functions/build.mjs`); the release folder lists it in `release.json` like every file.
- **167h The map's menu and Street View** (the owner's addition the same day: "go to Google Street View from a right click panel (hold on touch screen) on the map … also from a photo details panel"). Street View is a plain Maps URL in a new tab (no Google script, key or cost). The menu's items are a registry (`MAP_MENU_ITEMS`): Open in Google Street View and Copy coordinates; **Share this place** is left out (the menu's Share would duplicate the page's Share, which already sends the view; **for review**). The menu has no scrim (the tour's occlusion and legal checks refuse one over the map's controls), and a right press that dragged opens nothing (Mapbox's right-drag rotates).
- **167i The extras part grew.** With the menu and the photo sheet's link the IIFE measured 125,515 bytes; About and its help panel moved into the side-loaded part with the full-size view and the menu (`engine.extras.js`, 5.3 KB gzip, its row 7 KB), and the IIFE measures 124,430 of 125,000. About now opens after its part loads (the first time, one small request); a failed load closes it. The part was renamed from `engine.lightbox.js` before any release.
- **167j The menu ships, with Share a link to this view** (2026-11-12, the owner's spec: copy coordinates, Street View, share a link to this view). The third item reuses the FAB menu's Share (`shareViewer`: Web Share, else the clipboard, the toasts `share.copied` and `share.failed`), so it costs the engine one handler; a clipboard that refuses Copy coordinates is said by `mapMenu.copyFailed` instead of an unhandled rejection; closed, the menu gives the focus back to the map. Scenario rows S-V62-HAPPY-KEYBOARD-COPY, S-V62-HAPPY-SHARE, S-V62-BAD-CLIPBOARD-REFUSED.
- **167k Under the standing timeline the photos-near-the-year chip is an icon button** (the owner, 2026-11-12, asked again: no wide text pill on phones): `<hcm-icon-button variant="tonal" icon="photo_library">` whose name and tooltip are the chip's full text, centred on the 68 px card, 8 px under its foot; lying timelines keep the text chip. Rows S-V04-HAPPY-PHONE-ICON-CHIP, S-V04-BAD-PHONE-NO-YEAR-NO-BUTTON; the tour's state `year` checks it at the phone viewports.
- **167l The shared index stays within its 400 lines** after the merge of 2026-11-12 by writing the photo versions' three names and two type exports on one line each (`type` inline); nothing re-exported through another module (lesson 591).
- **167m The map's menu as a sanctioned popup of the tour's layout checker — APPROVED by the owner 2026-11-12 (relayed by the coordinator).** Open, the menu covers the point the visitor pressed; from the keyboard that is the map's centre, the one point the occlusion check samples on the canvas, and on a phone no place is clear of the standing timeline and the zoom group. `e2e/support/layout.ts` therefore names it chrome of kind `context-menu`, allowed over anything (`SANCTIONED_STACKINGS`, the second popup after the FAB menu; docs/TESTING.md). This relaxes a checker for one component, so it waited for the owner's yes.
- **167n The menu is on `track/photoversions`** (2026-11-12): parked first on `track/mapmenu-wip` (the revert and its revert are in the history), merged by fast-forward once §167m was approved.

## 168. The engine's bundle budgets raised for beta.1 (the owner, 2026-11-12)

The owner, in chat on 2026-11-12, after every branch of beta.1 had to trim bytes to fit (the IIFE at 124.8 to 124.99 of
125 KB; photo versions, the map's menu, the theme-following tab icon and 25 languages all land in this release): "raise
the limits!!!". A relaxed gate, so it is the owner's decision, recorded here.

- **168a** `packages/engine/dist/engine.iife.js` 125 → 150 KB gzip; `packages/engine/dist/engine.mjs` 100 → 120 KB;
  the side-loaded `engine.extras.js` chunk 7 → 12 KB (`scripts/ci/check_bundle_budget.py`).
- **168b** The admin's budgets, the start page's and the other chunks' stay as they were.
- **168d** The admin's total 700 → 750 KB gzip (`ADMIN_TOTAL_KB`, the coordinator under this instruction, 2026-11-12): the merge of the
  georeferencer's beta.1 work measured 701.8 KB with its panes (`georef-panes`, 4.2 KB, loaded with the page) and the sharper scan's
  tiles (`scan-tiles`, 1.2 KB, loaded on zoom). The entry's 450 KB and every chunk's own budget stay.
- **168e** The admin's `worker-local` chunk 5 → 10 KB gzip (`ADMIN_CHUNK_BUDGETS`, the coordinator under this instruction,
  2026-11-13): the build of `cb7329fd` measured 8,729 bytes, over its 5 KB since the machine's profile and the starter's
  self-update card (`d6934a07`, `hcm-worker-versions`, 1.0 KB). The source map splits it: the Romanian and English texts
  3.9 KB, `<hcm-worker-local>` 2.1 KB, `local.ts` 1.6 KB, the versions card 1.0 KB, the machine's card 0.9 KB, the
  machine's schema and reader 1.2 KB. Every part shows together on the computer's panel, the one place that fetches the
  chunk, so a further split would add a round trip for the same bytes; the catalogues bundle both languages, as every
  admin catalogue does. 8.7 KB plus about 15 %, rounded up. 168b's other chunks stay.
- **168c** The rule stands: a budget moves only by a reviewed change with its reason; code that only some visitors need
  still goes to the on-demand parts first (`docs/ENGINE_API.md` → *Side-loaded parts*).

## 169. Release channels: an untagged build never blocks a later one; a confirmed override over a newer release (the live finding of 2026-11-12) — APPLIED

The admin `1.0.0-beta.1+593d539` (the release prep's bump) met the live server `1.0.0+dcfb067`, an untagged build of
before the bump: by SemVer `1.0.0-beta.1` < `1.0.0`, so step d said "newer than this admin" and offered no Update.

- **169a** A build of a commit that carries `v<version>` names the version alone (`release` or `prerelease`); every
  other build keeps `+<commit>` and is `dev`. The channel travels in the release string, so no server, label or record
  needs a new field; `runtime.json` and the install manifest also write `channel`. The live `1.0.0+dcfb067` reads `dev`.
- **169b** `compareRelease`: the core first; two tagged releases of one core follow SemVer (the downgrade guard
  stays); a dev build is placed by the build times against anything of its core. The unit tests pin the live pair.
- **169c** The owner's override: **Install this admin's version anyway**, behind a confirmation, submits the build
  tagged `hcm-over`. Recorded in Cloud Build's history and the admin's log, not in the History page: a rollback installs
  an older server, whose strict schemas would refuse an entry of a kind they do not know. To review: whether a History
  entity for installs is wanted once every live server knows it.
- **169d** `releaseOfSlug` reads pre-release slugs (`1-0-0-beta-1-593d539`), so a pre-release's pipeline jobs name
  their release.
- **169e** For CI: a tag build (`refs/tags/v1.0.0-beta.1`) now names `1.0.0-beta.1` without the commit; crash reports of
  a tagged release name the tag, which names the commit.

## 170. The georeferencer's kept zoom, ghost and sharper scan, within the 19 KB `georef` chunk (2026-11-12) — APPLIED, no budget raised

- **What**: four fixes the owner asked for after placing points on 1966 Corona frames (`docs/research/M3-interfaces.md`, addendum *The kept zoom, the ghost and the sharper scan*): the scan pane keeps its zoom and centre over a size change; the linked views pause while a pair waits for its second click; the expected place of that click is a dashed ring (the fit's, or with two pairs and no fit their similarity's); scans longer than their preview get `scan-detail.jpg` (at most 16,384 px long, a new `VERSION_FILES` member and optional `scan.detailPath` / `scan.detailScale`), fetched once when the pane zooms past the preview; the warped map preview is 4,096 px across (3,072 before).
- **Budget**: the four took `georef` to 19,471 bytes gzip (budget 19,000). The warped preview's mesh code (`warp.ts` with `previewMesh` and `scanBounds`) moved to a new lazy chunk `georef-warp` (fetched when a version opens; 991 bytes, budget 2 KB: the measurement plus about 20 %, rounded up, a new row of `ADMIN_CHUNK_BUDGETS`), and its triangle transform is solved in closed form (`triangleCanvasTransform`), because `@hcm/shared`'s `triangleTransform` shares the matrix solver with the `georef` chunk's fit and Rolldown then moved that solver to `editor-shared` (13.4 KB of 13). After: `georef` 18,745 bytes, `editor-shared` 12.8 KB, `georef-extras` 1.9 KB of 2 (the ghost's arithmetic), `georef-badges` 2.9 KB of 3 (the ring's painter). No budget was raised.
- **Not done**: a scan parked before this change has no `scan-detail.jpg`; it gets one only when the pipeline writes its scan again (Locate again, a new import). Tiles from `scan.tif` itself (a COG range reader in the browser) were not built: the scan is a plain GeoTIFF of up to 200,000 px per side and the 16,384 px JPEG is the smallest correct path. `georef.ts` moved its picked-up point's helpers to `moving.ts` and `<hcm-scan-viewer>` its gesture types to `scan-input.ts` to stay within 400 lines.
- **Verify**: `npm run build` then `python3 scripts/ci/check_bundle_budget.py`; S-A16-HAPPY-GEOREF-KEEP-ZOOM, S-A16-BAD-GEOREF-KEEP-ZOOM-NEVER-SHOWN, S-A16-HAPPY-GEOREF-GHOST, S-A16-BAD-GEOREF-GHOST-NO-PAIRS, S-A16-HAPPY-GEOREF-FULL-RES, S-A16-BAD-GEOREF-FULL-RES-NONE.

## 171. The sharper scan capped by its area, switched on in device pixels, and the older frames' backfill (2026-11-12) — APPLIED

- **What**: review of §170. `scan-detail.jpg` is now also capped at `SCAN_DETAIL_MAX_PIXELS` = 64,000,000 pixels (`detail_scale` in `steps/common.py`; the constant on both sides of the contract, `enums.json` included): a 20,000 px square upload gets 8,000 × 8,000 (about 256 MB of RGBA decoded, instead of about 1 GiB). The "not well above the preview" guard the review suggested is not code: at this area the detail is never shorter than 8,000 px, about twice the 4,096 px preview, and a pytest pins that relation (`SCAN_DETAIL_MAX_PIXELS ** 0.5 >= 1.5 × SCAN_PREVIEW_MAX_PX`) instead of a branch no input reaches. The pane draws, and the store fetches, the sharper scan once `scale × devicePixelRatio` passes one device pixel per preview pixel.
- **Older frames**: no new backfill job. A USGS frame parked for points before this pipeline searches again by itself once the newer image is installed (`functions/src/imagery/relocate.ts`, M18 item 3), and that search writes the scan again through `publish_scan`, so it gets its detail; **Locate again** does the same by hand. An uploaded scan parked before (`inspect`) has no such path and stays at the preview until imported again; ADMIN_GUIDE and MANUAL_TEST_PLAN M5c say so (§170's *Not done* line is superseded).
- **E2E**: the stand-in now writes `scan-detail.jpg` (the world at the scan's own pixels, `scanDetailJpeg`) with `detailPath` / `detailScale`, so `georef-ghost.spec.ts` drives the sharper scan (S-A16-HAPPY-GEOREF-FULL-RES, S-A16-BAD-GEOREF-FULL-RES-NONE) and asserts the ghost ring's position and that a click on its centre makes the pair there.
- **A bug the ring's position found**: with Add pairs on, the map click after a completed pair also moved that pair to the click, because selecting it in the Terra Draw adapter switched the tools from `static` to `select` (LESSONS 598). `GeorefMap` no longer selects in the tools while adding.
- **Verify**: `pipeline/tests/unit/test_publish_scan.py`, `pipeline/tests/unit/test_contract.py`, `packages/shared/test/schemas/pipeline-contract.test.ts`, `packages/admin/test/georef/georef-pictures.test.ts`, `packages/ui/test/admin/georef/scan-viewer-keep.test.ts`, `e2e/admin/specs/imagery/georef-ghost.spec.ts`.

## 172. The sharper scan as tiles in one file, at most 32 decoded (2026-11-12) — APPLIED

- **What**: the audit of §170 and §171: even capped by its area, `scan-detail.jpg` was one JPEG the browser decoded whole (256 MiB at 8,000 px a side, about 430 MiB for a 16,384 × 6,500 Hexagon half). The pipeline now writes `scan-tiles.bin` instead: the same picture as JPEG tiles of `SCAN_TILE_PX` = 1,024 px in one object (`pipeline/src/hcm_pipeline/scan_tiles.py`: `HCMT`, five `uint32`, the offsets, the tiles). The scan pane (`packages/ui/src/admin/georef/scan-tiles.ts`) decodes only the tiles in view with `createImageBitmap` over a slice of the `Blob`, keeps at most `SCAN_TILES_KEPT` = 32 (about 128 MiB; with the preview under 200 MiB), closes the rest, and draws them over the preview.
- **Why one file, not a tile folder**: a version's files are a fixed list (`VERSION_FILES`) that the paths, the local worker's allow-list (`worker.step`), `deleteVersion` and the rules all enumerate; a folder of tiles would have changed all four and added one signed address per tile for a run on the owner's computer. One object changes none of them; the browser already fetched the whole detail in one request. The file's bytes (about 15 MB at the area cap) are held as a `Blob`, not decoded.
- **The trade**: a view that needs more than 32 tiles (a large pane only just past the preview's pixels) keeps the preview until the owner zooms further: there is one level, no pyramid. On a 2,560 px laptop pane the tiles come in at about 1.3 device pixels a preview pixel for a Corona strip. A second level would remove that gap at about 25 % more bytes; not built.
- **`scan-detail.jpg` never shipped** (it lived only on `track/georefux`), so there is no older file to read: the name left `VERSION_FILES`.
- **Verify**: `pipeline/tests/unit/test_publish_scan.py` (tile count and sizes), `packages/ui/test/admin/georef/scan-tiles.test.ts` (the tiles asked for and kept while panning a 16,384 px scan), `packages/ui/test/admin/georef/scan-viewer-keep.test.ts`, `e2e/admin/specs/imagery/georef-ghost.spec.ts` (S-A16-HAPPY-GEOREF-FULL-RES: fewer decodes than tiles, none larger than a tile).
- **The resource audit's browser items, with the tiles** (`reports/resource-audit.md` §3, item 15 and budget test 4; 2026-11-12): the live warped preview's canvas is 2,048 px on a window narrower than 840 CSS px (`warpSideFor`, 16 MiB instead of up to 64); a PMTiles reader keeps its 32 most recently read leaf directories (`Recent` in `pmtiles-source.ts`; it dropped none before; it fits the engine budgets the owner raised in §168); and two budget tests hold the scan pane: `packages/ui/test/admin/georef/scan-budget.test.ts` pans a 16,384 × 4,096 px strip from end to end at three zooms in Chromium and counts every bitmap decoded and closed (at most 32 live, 128 MiB, where the whole picture is 256 MiB; the JavaScript heap grows by under 32 MiB), and `georef-ghost.spec.ts` reads the page's `JSHeapUsedSize` over CDP with the sharper scan zoomed in (budget 300 MB). Decoded bitmaps are not part of the JavaScript heap and Chromium gives a page no figure for them, so they are counted, not measured: before, one 16,384 × 4,096 JPEG was 256 MiB decoded (1 GiB for a square one); after, at most 128 MiB at any zoom.

## 173. The georeferencer for beta.1: what the map shows, turning, Delete with Undo, Edit points (2026-11-12) — APPLIED

- **What** (the owner's requests of 2026-11-12, branch `track/georefbase`): (a) **The map shows**, a native list on the map pane: OpenStreetMap, Sentinel-2 or any published layer of the city, drawn opaque under the pairs on the page's one map (`base-layers.ts`, `GeorefMap.showBase`); kept while the admin is open. (b) A chosen pair has **Delete pair N** beside the panes, Delete and Backspace work on the map pane too, and every removal shows a notice with **Undo** (`removing.ts`). (c) **Edit points** on a published version: the server already allowed it (`imagery.saveGcps` → `regeoref`, the layer keeps its tiles until the new version is published), so only the names and a note changed; no rule and no callable changed.
- **A native `<select>`, not a kit component**: the kit has no list component, and a native list is keyboard and screen-reader friendly as it is; the segmented OpenStreetMap | Sentinel-2 switch it replaces could not hold a city's layers.
- **The scan pane has no list**: it shows the scan; its warped preview is drawn on the map and keeps its switch and opacity below the panes. A list with one entry was not added.
- **(d) Rotation**: each pane turns on its own (buttons under each pane; `r`, `R`, `n` and Ctrl with a drag on the scan; Mapbox's own gestures and the buttons on the map), and with a fit the two turn together by default (**Turn the panes together**, off to turn them apart): `rotation.ts` reads the fit's rotation where the pane looks, the scan's angle is that minus the map's bearing. Text buttons, not icons: the kit's font subset has no turn icons, and adding glyphs is a font rebuild. A scan that is mirrored (a film scanned from its back) cannot be made to match by turning; nothing was added for that.
- **The `georef` chunk stays 19 KB by a new eager group, `georef-panes`** (the owner kept it, 2026-11-12): with these requests `georef` measured 19.9 KB. Following §146 and §156, the panes' template, the scan pane's gestures and view arithmetic, pair removal, the map pane's layers and the turning moved to a group that loads with the page (a budget row of its own, see `check_bundle_budget.py`); the sharper scan's reader is a lazy chunk (`scan-tiles`, 2 KB row). The page's eager download grew by what the features weigh; no existing row was raised and the admin's total stays within its 650 KB. If the owner would rather raise `georef` itself, the group can be folded back.
- **Verify**: S-A16-HAPPY-GEOREF-MAP-SHOWS, S-A16-BAD-GEOREF-MAP-SHOWS-GONE, S-A16-HAPPY-GEOREF-REMOVE-UNDO, S-A16-BAD-GEOREF-REMOVE-NOTHING, S-A16-HAPPY-EDIT-POINTS-PUBLISHED, S-A16-BAD-EDIT-POINTS-ENDED, S-A16-HAPPY-GEOREF-ROTATE, S-A16-BAD-GEOREF-ROTATE-APART.

## 174. The Pixel 9 Pro review of the public viewer (track/viewer-phone, 2026-11-12) — APPLIED, no gate relaxed

The owner's device review (`reports/devices/FINDINGS.md`, section *Pixel 9 Pro*), P1 to P6 but P5 (track/viewer-device).

- **174a (P3, supersedes §21c)** The modal surfaces draw above Mapbox's logo and attribution; nothing copies them. The
  legal bar below the sheets and the lightbox and the copy at the foot of About took 40 to 80 px of every surface on a
  phone, and Mapbox's corners (z-index 2) drew over the lightbox (z-index auto in the frame's stacking context). Now the
  modal layer has z-index 30; while a modal sheet is open Mapbox's corners move into the part of the map it leaves
  (above a bottom sheet's top edge, beside a side sheet; `legal-lift.ts`), under its translucent scrim like the map;
  the lightbox and a full-screen dialog hide the whole map, so no credit is owed there (Mapbox's terms ask for it where
  the map is displayed), and a centred dialog leaves the corners in view. §21c's option 2, without its cost: a
  ResizeObserver follows the sheet's own box, so the viewer needs no report of its height.
- **174b (P2)** A chosen light or dark theme declares `color-scheme: only light` / `only dark`: Chrome's dark theme for
  sites (Android, dark system) repaints every element whose used scheme is light, inverting dark text to a light tone
  while it keeps tinted fills; `system` stays `light dark`. The dark tours run with that repaint
  (`--blink-settings=forceDarkModeEnabled=true`), and the tour measures the FAB menu's painted contrast from pixels.
- **174c (P1)** On a landscape phone the open FAB menu lays its items in rows from the leading edge across the map's
  width, 48 px tall, while the lying card, the chip and the zoom group step aside; a window too short even for that
  scrolls the menu. The tour's journey `short-landscape` opens it at 884 × 322 and 568 × 270 in every tour project
  (a whole new viewport found other short-window defects, left for their own task).
- **174d (P4, P6)** No text selection or Touch to Search from a long press on the map; the lightbox zooms on a double
  tap and counts and pages through the list it was opened from.

## 175. Transit stations follow the points of interest switch (track/transit, 2026-11-08; merged 2026-11-12, numbered §123 and lesson 493 on the track) — APPLIED, no budget raised

- **175a The report.** The owner, live: with **Points of interest** off, tram and metro stations were still drawn. Mapbox Standard keeps them under `showTransitLabels` ("transit icons and text"), apart from `showPointOfInterestLabels` ("POI icons and text"); §92b had left it the city's. To a visitor a station is a point of interest, so the switch now drives both (Mapbox's Standard API page, read 2026-11-08).
- **175b What else stays.** `showPlaceLabels` (neighbourhood and city names) stays the city's, as §92b says. `showLandmarkIcons` and `showLandmarkIconLabels` are left alone: the page states no defaults, and writing them back on when the switch returns could turn on icons a city never showed (UNVERIFIED on the live style: `docs/MANUAL_TEST_PLAN.md` V5b is the check).
- **175c The rule** (`transitLabels` in `@hcm/shared/map-labels`): stations are drawn when the points of interest are, unless the city's `basemap.config` sets `showTransitLabels`: `false` keeps them hidden, `true` keeps them while the switch is at the city's own default (a city that hides POIs but shows stations). A city that hides POIs and says nothing of transit now hides the stations too, in the mount `config`. Live writes go only to a basemap that has `showPointOfInterestLabels` and `showTransitLabels` both, and only what differs; swipe compare's map follows through `MapSync`. The hash and the event keep `{ streets, pois }`: no new kind.
- **175d The IIFE.** The change measured 125,070 of 125,000 bytes gzip. Saving with no behaviour change: the viewer catalogue's `layers.kind.satellite`, `layers.kind.aerial` and `layers.kind.map` (ro and en), which nothing reads (the admin has its own `adminContent.layers.kind.*`): 124,994 bytes (`engine.mjs` 96,908 of 100,000). **For review:** 6 bytes of IIFE headroom remain.
- **175e The merge and the IIFE** (2026-11-12): `origin/feat/engine-rewrite` merged into `track/transit`; with it the IIFE measured 125,043 bytes gzip (the work branch alone 124,993; the three `layers.kind.*` texts of 175d were already counted). Two savings with no behaviour change bring it back under the work branch's own size: the placeholder key `hello.greeting` and the unused `<hcm-hello>` element go, exactly as `track/copy` removes them (its entry "Production copy without developer words"; the same lines, so the two tracks merge without a conflict), and `isBundledIcon`'s set is built from `UI_ICONS` and `POI_ICONS` directly and the sorted `ICONS`, which only the font tools read, moved to its own module `packages/ui/src/icons-sorted.ts`, so the viewer no longer sorts a list it only looks names up in. **For review:** the viewer's IIFE carries every icon name of the kit, the admin's too (about 1 KB raw), because `<hcm-icon>` checks a name against the whole subset; a viewer-only list would free a few hundred bytes gzip.

## 176. One hardware governor for the worker's share of the owner's computer (2026-11-12) — APPLIED, the owner's principle ("runs on modest hardware; nobody upgrades for us")

- **What**: `hcm_pipeline/governor/` (`docs/research/M26-governor.md`): a probe of the container plus the starter's host hints, a pure policy (`full` / `quiet` / `paused`, quiet within one 5 s tick of input, of others over 40 % or of battery; full only after 120 s calm; paused under 30 % battery; one level down at 90 °C CPU / 83 °C GPU), a budget (threads cores − reserve or cores ÷ 4, 60 % / 35 % of free memory, the card's share 0.7 / 0.4), actuators (nice 10 and idle I/O, GDAL's threads and cache, a gate every checkpoint waits at, `docker update --cpus` from the starter) and the matcher's place (CUDA → ROCm → OpenVINO GPU → NPU → processor, only where the release has the image; a card other programs hold is yielded). `/state` gains `machine`, `POST /profile` takes the owner's choice (kept on the computer), the admin's "This computer" card shows it (A141).
- **Deviations from the design**: `others-busy` added to the reasons (another program's load is not the person's input); the cores are capped by the quota the container started with (a shared machine's slot); strings are `adminWorkerLocal.machine.*` in the existing `worker-local` catalogue (the card lives in that chunk) rather than a new `adminWorker.machine.*` family.
- **Not done**: the ONNX Runtime / OpenVINO sidecar images and their parity runs (the merge below joined the governor to stripfix's numbers).
- **Verify**: `pipeline/tests/unit/test_governor_*.py`, `test_worker_governor.py`, `functions/test/worker/starter-governor.test.ts`, `packages/ui/test/admin/worker/machine.test.ts`; the NUC load test (`pipeline/tests/load/governor_load.py`).
- **The merge with stripfix (2026-11-13)**: `origin/feat/engine-rewrite` (stripfix at `8c794234`) merged into `track/hwgov`, lesson 585 renumbered 611, this entry 163 renumbered 176, behaviour A132 (taken by the landing page) renumbered A141. Kept from stripfix, unrelaxed: `gdal_memory` (the governor's cache and warp memory are its shares of the budget, at most 1,024 and 2,048 MB; before the merge the governor would have given 3,456 MB of cache on the laptop), `tile_processes`, the 60 % container cap with `--cpu-shares 256`, `HCM_WORKER_NICE` (the governor now adds only the idle I/O class: nice once, not twice), the 60 s idle claims, the sidecar's 4 GB and `--cpu-shares 128`, the processor matcher niced by 10 on the cores but one when no budget says fewer. Found in the adversarial review and closed: the rim's compression used `NUM_THREADS=ALL_CPUS` (now GDAL's threads), OpenCV kept every core (now `cv2.setNumThreads` of the budget), the warp's memory ignored the budget (now `HCM_GOVERNED_WARP_MB`, the least of the two), the owner's `HCM_WORKER_THREADS` was overridden by the governor (now a cap on every profile).

## 177. The processor's matcher: half resolution, and a sidecar in the worker's own image (2026-11-13) — APPLIED, items h2 and i of the optimisation list

- **What**: on the processor `matcher/search.py` searches at half resolution (`CPU_DECIMATION` 2) with the budget's keypoints: 64 s a request on the NUC against 553 s, the same verdict on ten requests of F006 (Fetești), F007 and F003 (Bucharest), the true orientation 23 to 322 m from the card's proposal (the proof measures at full resolution). A computer with no NVIDIA card gets `HCM_AI_VARIANT=cpu` from the starter and runs the sidecar from the worker's own image with `matcher/pins-cpu.json`'s cp314 PyTorch for the processor in `lib-cpu/` (276 MB fetched, 830 MB unpacked) instead of PyTorch's 9.68 GB CUDA image. `download.pytorch.org` joins the matcher's hosts.
- **Rejected, measured**: 1,024 keypoints (38 s at half resolution, 206 s at full) lost F006, which the card finds with 3 pairs; so the governor's quiet profile now keeps 2,048 keypoints too (slower, never blinder; lesson 613). The governor's processor heat limit rose from 90 to 95 °C (lesson 612): the laptop reads 90 with only a local model running.
- **Measured backends**: CUDA on the laptop's 3080 beside a local model holding 6.4 of 8 GB, 43.4 s and 1,086 MB under a 0.2 share (20.4 s alone in R1); OpenVINO 2026.4.1 cannot load the exported ALIKED (`DeformConv-19` has no conversion rule), so Intel's GPU and NPU stay `no-image`. Unproved: ROCm, DirectML, Core ML, NPUs, the processor's sidecar on Windows and arm.
- **Verify**: `pipeline/tests/unit/test_matcher_search.py`, `test_matcher_torch.py`, `test_ai_files.py`, `test_governor_policy.py`, `test_governor_budget.py`; `functions/test/worker/starter.test.ts`, `starter-sidecar.test.ts`, `starter-windows.test.ts`; the NUC bench in `docs/research/M26-governor.md` §9.

## 178. The Pixel Tablet's findings on the public map (track/viewer-device, 2026-11-12) — APPLIED, no budget raised

The owner's real-device test (Pixel Tablet, Chrome; `reports/devices/FINDINGS.md` T1–T6 and the cold load). No gate was
relaxed; one new e2e budget.

- **178a Timeline density** (T1). The track fits the card; the gap between stops decides the density
  (`packages/ui/src/viewer/timeline-model.ts`): `roomy` from 30 px (every year named), `dense` from 14 px (every other
  year, the ends always, the selected one on the pill), `scroll` below 14 px (16 px per gap, the card scrolls under a
  finger along the timeline, the edge with more years beyond fades 24 px, the selected year is centred unless a drag is
  on). The thumb keeps `touch-action: none` so it still drags on a scrolling track; elsewhere a finger taps a year.
- **178b Slider under a finger** (T2). `hcm-slider` is `touch-action: pan-y`; a finger moves the value only once it has
  gone 8 px (`TOUCH_SLOP_PX`) more sideways than up or down, a tap still sets it, `pointercancel` ends the press without a
  change. Mouse, pen and keyboard are unchanged.
- **178c Docked pane from 760 px** (T3). A medium window at least 760 px wide (`DOCKED_PANE_MIN_PX`) and not of compact
  height docks the sheets beside the map like expanded (the map keeps 400 px beside a 360 px pane); below it, or short,
  the modal sheets stay. `ViewerState.dockable` carries it; the e2e helpers' `sheetsDock` mirror it (the 768 px tablet
  project now docks).
- **178d Credits in the visitor's language, once** (T5). The pipeline keeps writing the English constants
  (`USGS_ATTRIBUTION`, `LANDSAT_ATTRIBUTION`); the viewer shows a known credit by its text key
  (`layers.attribution.usgs`, `layers.attribution.landsat`) in the visitor's language and an unknown one as written, each
  once (`@hcm/shared/credits`: a subpath export, so the shared index stays within 400 lines; lesson 591). The Layers
  panel, Mapbox's attribution line (each raster source's credit in the language of the first load, `rasterSpec`; its text
  rewritten on a language switch, `relabelMapbox`) and swipe compare's bar use it. New keys exist in `ro` and `en` only (the viewer's two
  locales).
- **178e Lone links 48 px tall** (T6): `.details .link > a` in the detail sheets.
- **178f The cold load.** Traced on a local build with CDP (Fast 4G, 4x CPU, cache off): the engine is a module
  script, which runs in document order after the deferred `mapbox-gl.js` (1.9 MB, 526 KB gzip, from a new origin), so
  nothing was painted before Mapbox GL had arrived and run. The page now loads Mapbox GL `async`; the engine renders the
  viewer at once and `mapboxOf` hands the map adapter a promise of `mapboxgl` when the script is still loading (no global
  and no loading script: the old error). The same trace with Mapbox's CDN two seconds slower found the second cause: the
  page's `<link rel="stylesheet">` of `mapbox-gl.css` in the head blocked the first paint (2.9 s) until api.mapbox.com had
  answered, and no one needed it: the viewer links that stylesheet inside its shadow root, where the head's copy cannot
  reach. The city pages now link none (`scripts/site/src/page.ts`; only mapbox-gl.js keeps its SRI hash). Measured on the
  local build at the phone size, three runs each: FCP 1,408–1,668 ms before (deferred script), 760–796 ms after. The e2e
  budget `S-V01-HAPPY-COLD-FIRST-PAINT` (FCP under 1,800 ms at a phone
  and a tablet) and `S-V01-BAD-SLOW-MAPBOX-FIRST-PAINT` (the viewer paints before Mapbox GL arrives) measure it with the
  same method; Mapbox's files are answered by the firewall (`route.fulfill`, out of the throttling's reach), so the test
  gives them a modelled cold CDN time (three round trips and their gzip bytes at Fast 4G) — the only timed wait in the
  e2e suite, a network model rather than a wait for the page. The starter kit's own `index.html` keeps its order (it
  works either way).
- **178g The photos-near-the-year button** (the owner, 2026-11-13): its text only on a large screen. The text chip
  shows on an expanded or wider window that is not short and whose main pointer is a mouse (`finePointer` of
  `<hcm-map-viewer>`, from `(pointer: fine)` and its changes: a tablet on its side, 1280 px, is as wide as a laptop);
  everywhere else, phones and tablets, the icon button, whose accessible name and tooltip are the full text
  (`packages/ui/src/viewer/viewer-near-year.ts` `textChip`; `S-V04-HAPPY-TABLET-ICON-CHIP`).

## 179. The cheap cloud defaults: smaller pipeline jobs, a 15-minute tick, one decode a photo (2026-11-12) — APPLIED, the owner's priority ("optimizations first"); no cloud change made from here

- **What**: the resource audit's cloud items 7, 9 and 10 (`reports/resource-audit.md` §4, §6) and a review of every function's settings, in the repository only (nothing deployed; the next **Update the map** carries them). `JOB_MACHINE_SIZES` `std` 2 vCPU / 8 GiB and `xl` 4 / 16 (from 4 / 16 and 8 / 32), and the installer's `PIPELINE_JOBS` now built from it; `IMAGERY_TICK_SCHEDULE` every 15 minutes (from 5), with `imagery.onJobWrite` dispatching every city's queued jobs when a run leaves `starting` / `running`; `photos.onUpload` makes the thumbnail from the web WebP and runs at 1 GiB (from 2); `imagery.publish` 512 MiB (from 1 GiB: both paths stream); `imagery.onRasterUpload` the default 256 MiB (from 512). The table, today → proposed → why, and the saving: `docs/research/M7-local-worker.md` §4.6.
- **Why**: the free tier's processing runs double (8 → 16 a month), a busy month of 20 imports costs about $0.45 instead of $2.90, the idle tick's 5,760 runs a month go, and a photo's GiB-seconds halve. The photo figures are measured (200 MP on the NUC: 321 MB peak, 1.8 → 1.1 CPU-seconds); the job sizes rest on `track/stripfix`'s memory that follows the machine and its atlas fix (measured there).
- **Risk**: a frame that needed more than 16 GiB now fails on `xl` where 32 passed (the out-of-memory escalation stays); a job waiting on something only the tick sees (a USGS wait, a lost run, a lost event) waits up to 15 minutes instead of 5; the budget guard's "Processing starts again within 15 minutes". **UNVERIFIED** until the first real cloud run on the new sizes (M7 §11): the run's peak memory in Cloud Monitoring.
- **Guard**: `functions/test/cost-shape.test.ts` fails on any `minInstances`, explicit CPU, memory or timeout outside the reviewed table, more than 5 instances, or a schedule under 15 minutes; `packages/shared/test/api/worker.test.ts` and `scripts/site/test/install-steps.test.ts` hold the jobs' sizes.
- **Merge order**: `track/stripfix` (GDAL's cache and the warp's memory from the machine's, the atlas pasted part by part, an idle worker's slower claims) is on `feat/engine-rewrite` since 2026-11-13 (`8c794234`), so the smaller jobs ship with what they rest on; a frame that still outgrows 8 GiB fails once on `std` and runs again on `xl` (4 / 16, the old `std`).
- **Verify**: `PIPELINE_STAGE=tests` and `static`; after the next deploy, the jobs' `cpu` and `memory` in Cloud Run and the Scheduler job `firebase-schedule-imagery-tick-us-central1` at `every 15 minutes`.

## 180. Dev tooling on modest hardware: ESLint by project groups, the containers' caps, the emulators' heaps, a smaller image (track/optdev, 2026-11-12) — APPLIED (pre-approved class: keeps a tool working, no gate, rule or threshold relaxed)

The owner's priority "optimizations first", the product principle "runs on modest hardware", the audit's area 5 and the
leftovers of §164. Every figure is the container's cgroup `memory.peak` (page cache included) on the NUC unless named.

- **180a ESLint, one process per group of TypeScript projects** (`scripts/ci/lint.sh`). The debug log of
  typescript-eslint's `projectService` showed no file in a default project: every file falls in one of the 22 `tsconfig`
  projects, and one process over the whole tree held 21 TypeScript programs at once, because the service keeps every
  program it opens until the process ends and a test project's program also loads its package and every package it
  imports. Seven groups (functions, admin, shared, ui, e2e, scripts, the small packages with `firebase/`) and the rest of
  the tree (`.` with the groups' folders ignored, so a new folder is still linted) run as separate processes. Before: one
  worker 181 to 228 s and 8.6 to 8.8 GB, two 14.2 GB, four 17.8 GB. After, one group at a time: 222 s and 2.9 GB on the
  NUC, 301 s and 3.08 GB on the laptop under `q.sh`'s 8 GB cap, with a planted `no-var`/`no-console` file reported and
  the gate failed. Every rule runs on every file; a group's programs are the ones a whole-tree run builds for its files.
  `scripts/ci/parallel.py lint` now counts groups: one per 2 CPUs and 4 GiB available. A solution-style `tsconfig` was
  not needed: the programs were not duplicated per file, only held together.
- **180b The available memory includes the container's own cap**: `parallel.py` takes the smaller of `MemAvailable`
  (the host's, inside a container) and cgroup v2 `memory.max` less `memory.current`, so a run under a 8 or 12 GB cap
  picks fewer workers. `HCM_MEM_GB=<n>` caps `run-all-checks.sh`'s container; `scripts/dev/dev-stack.sh` caps the stack at
  `HCM_STACK_MEM_GB` (default 8) with `--oom-score-adj 500`.
- **180c Peak memory per stage** (NUC, 12 GB slot, `HCM_LINT_WORKERS=1`): `static` 6.6 GB (ESLint 3.0, `tsc -b` 2.0,
  `npm ci` 1.2, dependency-cruiser 0.8, knip 0.7); `build` 2.2 GB (`npm ci` 1.2, the install bundle's build 0.55, the
  functions' build 0.47); `tests` 9.6 GB (after 180g: the Firestore JVM 6.4 GB while it builds the rule-coverage report, the check 1.7 GB; before it the report failed, 180g) `e2e` hit the 12 GB cap: 46 Functions emulator workers held 8.8 GB (one Node
  process per function trigger and more under concurrent calls, each about 250 MB, kept while idle), the browsers 1.4 GB,
  Playwright's runner 0.7 GB, and the kernel killed the Firestore JVM, after which the admin tests failed in under 100 ms.
- **180d The emulators' JVMs get a heap ceiling** through `JAVA_TOOL_OPTIONS`: unset, each takes up to a quarter of the
  machine's (or the container's) memory. `npm test`: 6 GB (180g), because 1.5 GB ran the Firestore emulator out of heap while it
  built the rule-coverage report (`ruleCoverage` answered HTTP 500 and the `rules-coverage` gate failed). The e2e and
  stack emulators (`EMULATOR_ENV`, `e2e/admin/world.ts`): 2 GB, which also gives them the tests tier's
  `-XX:CICompilerCount=2`; their Firestore JVM held 0.86 GB when it was killed.
- **180e The quality image** (6.09 GB; its largest layer 2.62 GB: browsers 1.3 GB, emulators 0.29, npm cache 0.18): Chromium
  is installed as its headless shell only (`--only-shell`), as every Vitest and Playwright project launches it headless:
  403 MB less. Checked with the full Chromium hidden from Playwright: Chromium (WebGL on), Firefox and WebKit launch and a
  Vitest browser file passes. Firefox and WebKit stay (the admin's forms run on both); the Pub/Sub zip next to its
  unpacked folder stays, as `firebase` re-downloads an emulator whose archive is missing.
- **180g The rule-coverage report fits a 12 GB container** (the `tests` stage's `vitest` and `rules-coverage` gates). The
  Firestore emulator builds `ruleCoverage` whole in its heap: 582 MB of indented JSON (132 MB of values without the
  indentation), and its HTML view of the same data was asked for at the same time (§30c). Under a 12 GB cap the unset
  heap is 3 GB; measured on the NUC with the JSON alone: 3 and 4 GB ran out ("Java heap space", HTTP 500), 6 GB passed
  with the emulator at 6.46 GB resident and the container at 8.2 GB. So: `npm test` gives the JVMs `-Xmx6g`; `save` asks
  only for the JSON (the HTML is a view of the same report, read by no gate: replaces §30c) and streams it to disk through
  a `.part` file that a short body never replaces; `check` drops each evaluated value as it parses it (an object hook),
  1.69 GB and 3.4 s instead of 2.2 GB. Every expression and every condition is checked as before (0 problems on the same
  report). No rule, condition or gate dropped; the emulator offers no smaller or streamed report.
- **180h The colour library is inlined in every Vitest project** (`vitest.config.ts`, a config edit of the pre-approved
  class: it keeps a tool working, no threshold or file excluded). `@material/material-color-utilities` imports without
  file extensions, which Node refuses; only `create-historic-city` had it in `server.deps.inline`. With fewer workers
  (a capped container, 180b) a worker that had run `admin` files (`isolate: false`, which also reach the library through
  `@hcm/ui/dynamic-color`) went on to the CLI's files, and all six failed with "Cannot find module …/dynamic_color";
  `admin` + `create-historic-city` on 5 workers failed every time, with or without `--coverage`. The option now sits in the
  root `test` config that every project extends: the same command passes 230 files. Found while it, the shared API's
  fixture lacked the governor's eight exports (§176): added to `exports-m7.ts`.
- **180i The Functions emulator's workers in the e2e stage** (NUC, 12 GB slot, sampled every 3 s). Every Node process the
  emulators start now inherits `NODE_OPTIONS=--max-semi-space-size=1` (`EMULATOR_ENV`): one worker that loaded the functions
  went from 102 to 48 MB of heap and 148 to 122 MB resident; in the stage, about 250 to 165 MB a worker. The count is the
  problem: the emulator keeps one worker per function trigger for the whole run and never stops an idle one, 61 to 65 at
  the end (10.6 GB), so the stage still reaches the 12 GB cap (the browsers 2 to 3 GB beside them). Tried and not adopted:
  `--inspect-functions`, whose shared pool kept one worker (0.4 GB, the container's peak 9.9 GB) but served the calls one at
  a time: past 2 hours for about 2,370 of 3,137 tests, with 43 failures, against 45 minutes. A per-worker heap ceiling saves
  little (the code loaded is most of a worker). What would fit: the functions' entry loading each group's module on its
  first call instead of the whole bundle in every worker, a change to the deployed code's cold start that needs its own
  measurement; until then the e2e stage needs about 14 GB (CI's runners have 16).
- **180f Left**: the Functions emulator's workers (180c, 180i) are the largest consumer of the e2e tier and the dev stack;
  the e2e stage reaches a 12 GB cap with them (measured after 180d and 180i), and the dev stack's 8 GB default holds only
  a manual session's fewer workers.

## 181. Automatic tile stitching: names, seams, one bundle, a windowed mosaic; a doubtful layout waits for its owner (2026-11-12) — APPLIED, the owner's design (track/autostitch)

- **What**: an atlas or pieces are laid out from their names (`sheetnames.py`) and the seams between grid neighbours (`seams.py`, edge strips only), every sheet placed at once (`bundle.py`, IRLS with Huber's loss and a grid prior), judged (`quality.py`) and, when `good`, mosaicked in 2048 px windows (`canvas_window.py`); else the older joins when they place 90 %, else the version waits with `layout-check` and its layout files (`layout.json`, `thumbs.jpg`, `seams.jpg`) for the tile-import wizard. The owner's answer (`help.layoutAnswer`) is fixed as given (`owner_layout.py`). M20 §19.
- **Contract**: the enums and limits twins follow track/tilewizard's `imagery-tiles.ts` (`SEAM_SIDES` `right`/`below`, the `STITCH_GOOD_*` thresholds, `THUMB_SPRITE_COLS`, `SEAM_CELL_PX`); track/autostitch carries only the Python side, so its `pipeline-contract.test.ts` is green once merged with track/tilewizard.
- **Thresholds chosen**: strong seam 0.6, weak 0.3; a turn wins by 0.2 and must fit strongly; outlier seam 8 px; the working copies within 160 MB; the canvas 20,000 px long at most. Measured on synthetic series (M20 §19.9).
- **Verify**: `pipeline/tests/unit/test_placing_{sheetnames,sheetwork,seams,bundle,autostitch,canvas_window,autoplace}.py`; scenarios `S-P20-HAPPY-STITCH-*`, `S-P20-BAD-STITCH-*`.
- **Review of 2026-11-13 (adversarial, pipeline side)**: (1) the verdict counts a sheet as placed only when a kept seam touches it and scores every seam the bundle did not keep 0, so names read right over silent seams are never `good`; (2) the older joins mosaic only when vouched for: matches within `STITCH_GOOD_RMS_PX` and 24 agreeing matches a join on average, or edges alone on a `check` (never `poor`) proposal; (3) a sheet the owner's answer does not name keeps its automatic reason (`blank`, `no-join`, `no-seam`), only the X is `not-part`; (4) an owner seam is fixed only between neighbours on its side of the new grid with two finite points; a refused turn goes back a quarter; (5) `help.layoutAnswer` is carried by every `wait_for_help` in the same write; (6) more than `LAYOUT_SHEETS_MAX` files wait with `no-path`; (7) the mosaic reads each sheet's box straight at its canvas size (a colour 12000 px pair: 690 MB peak, tested ≤ 800 MB); (8) `pipeline/tests/contracts/layout.json` is what the pipeline writes, for the shared schemas' test. For track/tilewizard (not changed here): show and sprite `missing` seams as weak ones, send every sheet with a cell, clear a sheet's answered seams when it turns, flips, moves or goes out, parse `contracts/layout.json`, and document `matrix` as an axis-wise stretch and `seamRmsPx` in cell pixels; its M20 sections become §19.10 onward. Verify: `pipeline/tests/unit/test_placing_{stitch_guards,layout_contract,autoplace,autostitch,canvas_window,assemble_stitched}.py`; scenarios S-P20-HAPPY-STITCH-OWNER, S-P20-BAD-STITCH-{NAMES-NO-SEAMS,OWNER-MALFORMED,LEGACY-LOOSE,TOO-MANY}.

## 182. The tile layout's contract and the tile-import wizard (track/tilewizard, 2026-11-12)

The design of automatic tile stitching and the tile-import wizard (docs/research/M20-import-local.md §19), contract and admin half.

- **182a** The contract is as designed, with these precisions for the pipeline track: the enums' types (`LeftOutReason`,
  `SeamState`, `SheetSource`, `SheetTurn`, `StitchVerdict`) and `SEAM_SIDES` (`right`, `below`); `layout.json` carries each sheet's
  oriented `width` and `height`, the canvas size, and each seam's `overlapPx` and, for a weak seam, its `strip` (its row of
  `seams.jpg` and the two rectangles); `thumbs.jpg` is `min(n, 32)` cells of 128 px wide; `seams.jpg` is 512 px wide, one 256 px row
  per weak seam with a strip.
- **182b** The answer holds every sheet in the grid and every sheet the owner took out (`not-part`), so `owner_layout.py` fixes the
  whole layout the owner saw; `imagery.acceptLayout` keeps the earlier answer and marks it `accepted`.
- **182c** A new route `help` (`#/help/<versionId>/tiles`), not in the navigation, and its own lazy chunk with its own catalogue
  `@hcm/shared/admin-tiles` (as `@hcm/shared/admin-archive`), so no other page carries the wizard's texts.
- **182d** `helpItemsOf` lives in `schemas/imagery-tiles.ts` and `@hcm/shared`'s index exports it directly: a first draft routed
  the exports through a `help/index.ts` barrel, which lesson 591 forbids; the index gained its lines back by an inline `type` export.
- **182e** The Help calibrate queue page of M22 §1.1 is not built: the queue's `layoutCheck` item is computed (`helpItemsOf`) and
  shown on the series' page as **Arrange the tiles**; the meter is the wizard's own (`role="meter"` per figure of `placing/quality.py`).
- **182f** (the review of 2026-11-13, M20 §19.12) The wizard asks `missing` seams beside `weak` ones, and a missing seam with no
  guess is answered by two picked points; `seams.jpg`'s height counts every seam with a strip.
- **182g** The answer names a sheet left out for `no-seam` or `no-join` whose cell is still free, without `out`, so the pipeline
  tries it again instead of reading it as `not-part`; a blank page, a sheet with no frame or one whose cell another sheet took is
  not named.
- **182h** A seam whose sheet the owner moves, turns, mirrors or takes out leaves the draft (answered or not): its strips and points
  belong to the orientation the pipeline wrote.
- **182i** A series waiting with `layout-check` takes no points: no georeferencer link, and `imagery.saveGcps` refuses it with the new
  `apiError.imagery.layoutWaits` (`failed-precondition`).
- **182j** One pointer and no drag (WCAG 2.5.7): **Move** then a tap on the cell; a touch never starts a drag, so the grid pans. A
  live region says each change; the seam's strips take a keyboard cross (WCAG 2.1.1). A stale refusal still drops the owner's
  unsent edits, and its alert already says so; re-applying them to the newer revision is left for later.

## 183. The tile wizard's `help` chunk gets its own bundle budget, 14 KB (2026-11-13) — APPLIED, pre-approved class (a new chunk's budget; no row rose)

- **What**: the merge of track/tilewizard into feat/engine-rewrite built a new lazy admin chunk, `help` (the route
  `#/help/<versionId>/tiles`, M20 §19.11), which `scripts/ci/check_bundle_budget.py` refused as a chunk without a budget. It
  measured 11.6 KB gzip; `ADMIN_CHUNK_BUDGETS["help"]` is 14 KB (the measurement plus about 15 %, rounded up). The admin's total
  budget is unchanged and still met.
- **Verify**: `PIPELINE_STAGE=build bash scripts/ci/run-all-checks.sh` (bundle-budget).

## 184. Production copy without developer words, and the `copy` gate (track/copy, 2026-11-09; merged 2026-11-12, numbered §125 and lesson 501 on the track, §166 and lesson 578 before the merge, §169 and lesson 594 on track/stale-text, §184 and lesson 631 since) — APPLIED, no budget raised

The owner's report: "this kind of text should not be in production text", for the viewer's "Gamepad standard (încercat doar simulat)" (lesson 631).

- **184a The sweep and the rewording.** Every catalogue (`packages/*/src/i18n`, ro and en), the starter kit, the worker starter scripts, the job log's `relocate.ts` line and the export's README were read; about 80 keys were reworded, keys unchanged. The viewer's (in the engine's IIFE) only got shorter: `input.padTitle` loses its test note, `about.a11yMissing` no longer lists a QA task, `error.config.missing` is plain words, `about.a11yReport` and `input.note` say "tu"; the placeholder key `hello.greeting` and the unused scaffolding element `hcm-hello` are removed. The admin's and the API's: no raw IAM role, HTTP code, MIME type, model id, uid, icon id, JSON path or `{code}` in a sentence (the notification reasons keep `{code}` only in `.other`; `apiError.cloud.refused` labels it "cod:" / "code:"); setup steps named, not lettered ("pasul c" is `aria-hidden`); "budget guard" is "the monthly budget was reached"; "pipeline" and "service worker" leave the Romanian; the job steps `doctor`, `align` and `merge` are "Pornirea", "Alinierea îmbinărilor", "Contopirea cadrelor" / "Getting ready", "Aligning the seams", "Merging the frames" (no sibling contains another, and `merge` keeps clear of the join job's own name "Unire cadre", `i18n_skill.md` rule 11).
- **184b Placeholders dropped, parameters still sent.** `apiError.city.not*` and `adminShell.city.notMember` name "this city" instead of `{cityId}` (the admin is already on that city; plumbing the display name into the functions is not worth a server change); the callers keep passing their parameters, which `translate` ignores. Both locales drop the same placeholders, so the `i18n` gate's parity holds.
- **184c Not changed, for review.** `error.config.cityMismatch` and `.invalid` keep `config.js` and the ids: only a misconfigured site shows them, the owner's guide quotes them, and they say what to fix. The job log's other English lines from `functions/src/imagery/*` and the pipeline's `ctx.log` (sweep item 52) stay technical; a "technical log" label or catalogue keys for them is a separate change. The worker starter's messages are reworded in English only (no Romanian line yet). The starter kit's `city.json` placeholders are not yet warned about by `create-historic-city` or the site build (item 55).
- **184d The gate** (pre-approved as a stricter gate, 2026-10-12): `copy`, static stage, after `fonts`. `scripts/ci/check_copy.py` reads every catalogue value as `check_i18n.py` does, plus the sources `scripts/ci/check_copy.toml` names (by kind: the page's visible HTML with comments and scripts left out, JSON strings, whole text, a script's `say` / `Write-Host` messages, a TypeScript file's string literals), and refuses whole-word terms: simulat/simulated, mock, fake, stub, fixture, emulator, Playwright, Vitest, pytest, e2e, TODO, FIXME, milestone ids (`M\d+`, case-sensitive so USGS's M2M passes), `CR-M…`, DECISIONS, LESSONS, lessons, `docs/research`, §, IAM role ids, "service worker", "unverified", and in Romanian catalogues "pipeline" and "tile-…". An allowed use names its key or file and its term; one that no longer matches fails the gate. It starts with none.
- **184e The merge** (2026-11-12): `origin/feat/engine-rewrite` merged into `track/copy`. The Romanian halves upstream removed (`docs/ADMIN_GUIDE.ro.md`, the export README's and the starter-kit README's Romanian sections) stay removed; `adminShell.city.notMember` keeps this entry's wording beside the new `adminShell.welcome.*` keys. The gate was run over every catalogue of the merged tree (25 folders, 2,800 keys, ro and en, the only locales wired here) and passed with no new rewording; the start page's privacy policy and terms (`scripts/site/src/start/legal-text.ts`) joined its sources and passed too. **For review:** the other locales (`track/langs25`, not merged here) were translated from the texts before this sweep: 49 of the reworded keys exist there and need a new translation (`input.padTitle` still carries the test note in every language); the gate's terms are Romanian and English words, so it cannot see a translated one, and only `fr` trips it (`input.padTitle` "simulation", `adminContent.notify.push.reason.worker` "service worker").

## 185. No old text: today's facts in the copy, and the `copy` gate's old-text terms (track/stale-text, 2026-11-12) — APPLIED, no budget raised

The owner, 2026-11-12: "make sure we don't have any dev text or old text anywhere!!!" (lesson 632). Built on `track/copy` (§184), merged into this track.

- **185a The viewer.** `timeline.empty` and `layers.empty` no longer promise layers "soon" (a map may never have any): "No historical layers on this map" / "Harta nu are straturi istorice", "This map has no historical layers." / "Această hartă nu are straturi istorice."; `about.a11yMissing` says "Missing:" instead of "Not yet:". `apiError.imagery.archiveMissing` names the starter file, not "the worker" (English inside Romanian).
- **185b The Bucharest seed.** `scripts/seed/bucharest.city.json`: the About's "*Coming soon:* historical layers…" became a sentence about the live layers and the Layers panel; the USGS EROS credit lost "(coming soon)"; the privacy notice names Firebase Hosting, not GitHub Pages; the photo-rights link points at `ventura8/historic-city-map-maker/issues`. The admin's legacy bundle (`scripts/site/src/admin/legacy.ts`) now takes the About, credits and privacy from that file when it holds them (the authors' line first, as the migration wrote it), so `seed/bucharest/manifest.static.json` stays as migrated. **For the owner:** that manifest still holds the old texts (`city.about`, `city.credits[3]`, `city.privacy`, the old issues link); nothing ships them any more, and changing them is the owner's call. The live city's Firestore document keeps the old texts until edited in the admin: `reports/stale-text-live.md` on the track lists each, old and new. **Done (2026-11-14):** with the owner's yes, the agent replaced the live city's eight old sentences (About, the USGS EROS credit and the privacy notice, ro and en) with the new ones in the live admin (Settings → Texts) and saved them; `seed/bucharest/` is unchanged.
- **185c The worker's pages and the Cloud console.** "Historic City Map" → "Historic City Map Maker" (the local pages' titles, the autostart entry and the systemd unit's description; the two IAM custom roles' titles and the pipeline repository's description, which Provision writes when it creates or repairs them: it compares only the permissions, so an installed project keeps the old title until a role needs a repair); the worker page's help names **Use this computer** instead of "the command from the admin".
- **185d The owner's docs.** `docs/ADMIN_GUIDE.en.md` lost its milestone tags in headings, its "outline… filled in milestones M2–M5" opening, the M6 test-status paragraph (replaced by what the admin does today) and the e2e note; `README.md` says "Lost Bucharest" as the site does and no longer says the Setup Assistant cannot run in a project of one's own (CR-M5-7 is done; `--experimental` is accepted and ignored), as `docs/SETUP.md` now says too.
- **185e The gate** (pre-approved as a stricter gate, 2026-10-12): four terms ("coming soon|în curând|wip|dummy|debug…|placeholder"; "GitHub Pages", case-sensitive; any `http(s)://…bucurestiuldisparut…` address; "Historic City Map" not followed by " Maker") and nine sources (the city seed, `functions/src/cities/texts.ts`, the two landing pages, the Hosting static pages, the admin's shell page, the start page's shell and legal pages, the worker's two local pages). Allowed, each with its reason: USGS's rate-limit retry ("reîncercăm în curând"), GitHub Pages in the two static kits' READMEs and the export's README, and the worker page's docstring naming the Auth emulator.
- **185f Not changed, for review.** The design-note links (`docs/research/…`) in the owner's guide stay as pointers; the SonarCloud project key keeps the old repository's name (a key, not a text); the other locales do not exist on this branch (only ro and en), so no key needs a new translation here, but `track/langs25`'s translations of `timeline.empty`, `layers.empty`, `about.a11yMissing` and `apiError.imagery.archiveMissing` must be redone after the merge.

## 186. The IIFE loads its lazy parts as extras beside it, each with its integrity (2026-11-12) — APPLIED, no budget raised

- **What**: `engine.iife.js` was 124,864 bytes gzip of its 125 KB budget, because an IIFE cannot split and so carried every lazy chunk of the ES module build inline (§13a): swipe compare, the gamepad, the consented Firebase SDK and the field chunk, about 24 KB gzip of it. They are now its *extras*, classic scripts beside it (`extra-<name>-<hash>.js`), which it adds with `integrity` and `crossorigin="anonymous"` the first time each is wanted (`packages/engine/src/extras/`: the loader, the host, the runtime; `scripts/site/src/engine-extras.ts`: their build). The IIFE measures 99,352 bytes gzip (−25.5 KB); the extras 6.4 (compare), 1.9 (gamepad), 13.4 (Firebase SDK) and 5.5 KB (field), each with a new row in `check_bundle_budget.py` (8, 3, 16, 7 KB: the measurement plus about 20 %). No existing row changed; `engine.mjs` stays at 98.3 KB.
- **How**: `src/extras/imports.ts` names each extra as a dynamic import (as the tests and a bundler of the sources see it); the IIFE run of the engine's build (`vite build --mode iife`, after the ES module run, into the same `dist/`) replaces that module with calls to the loader carrying each file and its `sha384-` digest, so the IIFE's graph holds none of their code. Each extra is built on its own (IIFE, minified, a hidden source map, a final newline, so the bytes the release copies are the bytes the digest covers) and takes Lit and the `@hcm/shared` bindings it needs from the engine through one non-enumerable global, `__hcmEngineHost`, where it also registers its exports. The build refuses an extra that carries Lit, the catalogues or zod, one that imports a host binding `src/extras/host-lit.ts` / `host-shared.ts` does not list, and an `imports.ts` whose keys differ from the build's list. The third-party notices take the extras' modules (`moreModules`), the static export copies the extras with the IIFE (`functions/build.mjs`, `e2e/support/export-site.ts`); a site and a release already copy every built file.
- **Why two runs**: a Vite library build with two formats is one bundle whose outputs are generated twice, so one module cannot be replaced for the IIFE only. Doing it for both formats instead (the ES module build loading the same extras) was measured: the field chunk's event guard must then live in the entry (it needs the entry's zod), which took `engine.mjs` to 101.2 KB, over its 100 KB budget. The ES module build is therefore unchanged, with its chunks and dynamic imports.
- **Integrity**: a page that pins `engine.iife.js` with `integrity` covers its extras, since their digests are part of the pinned file; `engine.mjs`'s chunks still carry none (§57i), so pinned pages keep loading the IIFE.
- **Failure**: the loader removes a script that did not arrive (offline, 404, wrong digest) and logs `extra not loaded`; the next wish fetches it again. Compare closes with the new message `error.extraLoad` (ro, en) instead of the background map's; the gamepad retries at its next connection; analytics stays off for the page, as before when the Firebase SDK could not load.
- **Verify**: `packages/engine/test/extras/` (the loader's happy path and a failing chunk), `packages/engine/test/compare/session.test.ts`, `scripts/site/test/engine-extras.test.ts`, `scripts/site/test/notices.test.ts`; S-V63-HAPPY-EXTRAS-ON-DEMAND, S-V63-BAD-EXTRAS-CHUNK-FAILS (`e2e/specs/viewer/extras.spec.ts`).
- **After review**: two engine releases on one page each get their own entry on the host (`__hcmEngineHost.v1_0_0`: the Vite config reads `ENGINE_VERSION` from `src/index.ts`, `hostKeyOf` in `scripts/site/src/engine-extras.ts` makes the key, and the generated `imports.ts` hands it to the loader with each extra), so neither takes the other's Lit, `@hcm/shared` or extras, and a mismatch fetches its own file with its own integrity. Each extra's last statement marks it ready (`<entry>.ready.<global>`, the build's `footer`): the registry entry exists from the script's first statement, so a script that throws while it runs used to resolve with a half-filled object, cached for good; now it fails as not loaded, its entry is dropped and the next wish fetches it whole. `e2e/specs/viewer/extras.spec.ts` also covers the analytics extras after the consent and the gamepad's with a pad through the IIFE (S-V63-HAPPY-EXTRAS-CONSENT-AND-PAD).
- **Not done**: Lit components of the first screen (About, the stories reader, the lightbox) stay in the IIFE; they can become extras the same way when photo versions, the map's context menu and numbered dots need the room.
- **The merge** (2026-11-13, track/mergequeue): numbered §159 and lesson 577 on the track, §186 and lesson 633 since; its behaviour V54 became V63 (the tab icon holds V54). The extras sit beside the side-loaded `engine.extras.js` (the full-size view, `vite.part.config.ts`): the engine builds the part, then the ES run (which emits the part), then the IIFE run with its extras; both runs write the part's integrity. The budget rows keep the owner's beta.1 raise (§168).

## 187. Update the map: the bundle download retries, and the pipeline waits for the server (2026-11-12) — APPLIED

- **What**: (a) the `fetch` step of every install build (`packages/admin/src/install/fetch-script.ts`) tries each download up to four times, waiting 5, 15 and 30 s, on a network error, 408, 429 or 5xx, with one log line per wait and a closing `no answer after 4 attempts (<why>)`; a 404 or a wrong digest still stops at once. (b) Update the map submits the pipeline, like the site, only once the server it submitted is installed (`packages/admin/src/setup/install.ts`); a stopped server releases neither. (c) Each paid frame of a whole-city date has its own Buy this scan link (`paidFrameList` in `packages/ui/src/admin/imagery/orders/order-list.ts`, which `join-card.ts` renders), or Your order with the order's chip while the order is open; an expired order reads Order it again.
- **Why**: on 2026-11-09 one 10 s connect timeout to Hosting failed the whole update, and the pipeline's build, finished before the server's, put a new image on `raster-pipeline` that `worker.image` handed to the local worker while the old server refused its claims. Serialising costs the pipeline build's minutes after the server's, in exchange for never running a worker ahead of its server. The row's single link hid every paid frame but the first.
- **Not done**: a guard on the server side (`worker.image` answering the job's image only once `HCM_RELEASE` is at least the job's `hcm-release` label): with the admin's order it is only needed for an update started from elsewhere (GitHub Actions), and it would hold back a pipeline-only update whose server is already current. Proposed for review. The admin's order holds only while the tab that clicked stays open with a live token: a tab closed during the server's build, or one whose token expired, leaves the pipeline and the site unsubmitted, and their cards offer Update the map again (said in `docs/ADMIN_GUIDE.en.md` and `docs/research/M6-interfaces.md`, addendum *the update order*). The server-side guard would also need the image before the update, which the job no longer names once the pipeline's build has run.
- **Verify**: `packages/admin/test/install/fetch-script.test.ts`, `packages/admin/test/setup/install.test.ts`, `packages/ui/test/admin/imagery/join-paid.test.ts`; S-A56-HAPPY-UPDATE-AFTER-SERVER, S-A56-BAD-UPDATE-SERVER-STOPPED, S-A66-HAPPY-BUY-EVERY-PAID, S-A66-BAD-PAID-ORDERED.
- **The merge** (2026-11-13, track/mergequeue): numbered §159 and lessons 577, 578 on the track; §187 and lessons 634, 635 since.

## 188. No blank scroll on any screen, and the compact Layers sheet's targets (track/layout, 2026-11-12) — APPLIED, no budget raised

The owner's requests for beta.1: "make sure you can never scroll down past our app's limit (into blank space) in none of our screens/pages", desktop and phones, iOS and Android overscroll included; the pre-existing red of the viewer tour's Layers sheet at compact sizes; `issue-text.ts` under 90 % branches.

- **188a The `no-blank-scroll` checker** joins `expectStateSound` (`e2e/support/blank-scroll-probe.ts`; `docs/TESTING.md` → *The tour's checkers*): an app shell (its root hides its block overflow) is no taller than the window, does not move when the window scrolls and sets `overscroll-behavior-y: none`; a document ends at its last drawn content within 16 px. It runs on every state of the inventory. `vitest.config.ts` lists the probe in the `e2e-support` coverage (pre-approved class: a gate made stricter).
- **188b App shells at the root.** The city pages (`sites/*/site.css`, `starter-kit/site.css`) hide the root's overflow while scripting is on (without JavaScript the page is its note, which may scroll) and set `overscroll-behavior: none`; the starter kit's page does the same once the viewer is defined, and its viewer is a flow root (the note's margin pushed the 100dvh element 24 px down); the kit's page reads `engine.css` from the committed release folder `cdn/engine/`, so the tour's `kit.loading-note` passes once the next release rebuilds it (open until then: the release's job, never a hand edit of a pinned file). The admin's page scroller is positioned, so it clips its absolute elements (a first `overflow: clip` on the frame cut the bottom bar's focus rings): the visually hidden captions and labels far down a long page had the frame as their containing block, escaped the page's scroller and doubled the document (the owner's black area under Historical imagery, 2026-11-09: 639 to 800 px at 360 × 800 on the imagery, orders and georeferencer pages and the overlays settings); `<hcm-admin-shell data-frame>` lets `admin.css` hide the root's overflow and overscroll on the framed screens only (the sign-in, claim and blocked panels are documents).
- **188c Documents end at their last element**: the Hosting site's pages lose 24 px of their bottom padding (36 px of blank on a landscape phone); the footer of the start site's legal pages is a bordered box, so it counts as content to its edge.
- **188d The Layers strip is pinned in the docked pane only.** In a modal sheet (the phone's bottom sheet, the landscape phone's side sheet) the overlay list scrolled under the sticky strip: Tab focused switches and sliders hidden under it (WCAG 2.4.11), every target under it measured 52 × 32 or 4 × 44, and at peek height Tab reached Street names and POIs where nobody could see them. The strip now scrolls with the list there (the owner's request of 2026-11-10 holds where the pane is tall enough). The overlay rows are 48 px for the switch and 48 px for the slider (`grid-auto-rows: minmax(48px, auto)`) and the map-label rows 48 px, so no two 48 px rings overlap. The IIFE does not grow: the strip's list, paragraph and heading resets the viewer's base styles already make, and the overlay list's `gap: 0`, are gone.
- **The merge** (2026-11-13, track/mergequeue): numbered §170 and lessons 595, 596 on the track; renumbered after the merge. The Layers strip keeps both rules: sticky only in the docked pane (this track) and only on a window of at least 1200 x 700 (lesson 618, merged first).

## 190. The viewer's compass (2026-11-13, beta.1) — APPLIED

The owner: "i want us to have a compass for the viewer. (and clicking on it resets to north up)". Behaviour V64, `docs/ENGINE_API.md` → *Compass*.

- **190a Our own element in its own pill by the zoom group**, not Mapbox's `NavigationControl` (§128a's reasons, and its look comes from Mapbox's control styles). It follows the group wherever the group goes (§128h, one custom property `--hcm-zoom-end` for both): 8 px above it on a map 600 px tall or more; beside its Zoom in, towards the map, on a shorter one. The first draft put it inside the group, 56 px taller: the tour found it under compare's divider handle and the consent banner at 915 × 412 and under the open compare bar at 320 × 568.
- **190b The needle repaints alone.** `<hcm-compass>` subscribes to the store's `watchCamera` (Mapbox's `move`, every frame); the live bearing is not `ViewerState`, which changes only on `moveend` (a state per frame would re-render the whole viewer and touch the hash writer).
- **190c Always visible**, as asked; north up and level it is quiet (the needle in `on-surface-variant`), turned or tilted its north point is `primary`. Not soft-disabled north up: it still reads the map's direction. A press there changes nothing (within 0.05°, the hash's precision).
- **190d The reset levels the tilt too** (`FlyOptions.pitch`, new and optional; `ViewerMapPort.getPitch`). Swipe compare's camera link now carries the tilt as well, so both maps level together; before, a tilt on one map was not followed.
- **190e Rotation stays on.** The viewer never disabled Mapbox's `dragRotate` or `touchZoomRotate` rotation, and no entry here forbids them: a right-drag or Ctrl with a drag on a desktop, two fingers on a touch screen (§167h already relies on the right-drag).
- **190f A description, not a live region**: the bearing and tilt in whole degrees through `aria-describedby`; the needle is an inline SVG (the icon subset has no two-part compass glyph; no font rebuild), turned through `cssProperties` under the page's CSP.
- **Verify**: S-V64-HAPPY-COMPASS-RESET, S-V64-HAPPY-NEEDLE-FOLLOWS, S-V64-HAPPY-COMPARE, S-V64-HAPPY-TOUR, S-V64-BAD-ALREADY-NORTH, S-V64-BAD-REDUCED-MOTION, S-V64-BAD-NO-WEBGL.

## 191. The timeline's layer comes to the front (V15, the owner 2026-11-13, beta.1) — APPLIED, no budget raised

The owner, asked whether an older layer switched on under an opaque newer one should stay covered (§133c, §133d): "the older one to the front (and the easy way for the user to switch using our timeline)".

- **191a The stack** (`packages/engine/src/core/stack.ts`). On top is the layer the visitor brought to the front (`ViewerState.front`: a layer switched on in the Layers panel, with the controller's `toggleLayer` or the keyboard; next, the date picked on a timeline year with several), while it is visible; else the last layer of the timeline's year in manifest order. Under it the timeline's year's other layers, then every other layer by date, the newest highest. The timeline's own stop forgets the choice (`withYear`: that year's layers only, as before). Switching the front off leaves the timeline (§133c) and the rest stacked by date.
- **191b The map moves a layer, it does not redraw it.** `ViewerMapPort.setLayerOrder(id, order)` (new) moves the raster in its slot with Mapbox's `moveLayer`, so its tiles are kept; `MapSync` calls it for each layer whose place changed. Compare's second map draws through `MapSync` too.
- **191c The link keeps the layer on top.** `layers=` names the visible layers in the Layers panel's order with the one on top moved last; a link's last known layer is its front, and its year the timeline's (`frontOfIds`). This replaces §133c's "a shared link stands on the newest of its layers": a link written before, in the panel's order, ends on its newest year, so it opens as it did, except that, of two visible layers of one year, the one the panel lists last is now on top. `layers=` is also written when the visible layers are the defaults but another is on top. `docs/ENGINE_API.md` → *URL hash v1* and *Manifest*.
- **191d Tests.** `stack.test.ts`, `store-layer-year.test.ts`, `map-sync.test.ts`, `mapbox-adapter.test.ts`; S-V03-HAPPY-CHOSEN-LAYER-FRONT and S-V03-BAD-FRONT-SWITCHED-OFF replace S-V03-BAD-STACK-SWITCHED-LAST, which asserted the old cover.

## 192. The timeline's year chip, its finger, and live selection (the owner 2026-11-13, beta.1) — APPLIED, no budget raised

The owner: a year without its label shows a chip with the year (and the date when the year has several) under a mouse or the keyboard; on touch, a finger dragged along the timeline scrubs, the chip always naming the year under the finger, clear of it; then: the selection is live while dragging, mouse and finger, cheaply. `docs/ENGINE_API.md` → *Timeline*.

- **192a The chip** (`timeline-tip.ts`) is an M3 plain tooltip outside the card's scroller (its mask would clip it), placed by `placeTip` within the card's span and the viewport: above the lying card, beside the standing one. Within the span it cannot reach the compass, the zoom group or the menu button, which sit in the side columns; the photos chip, docked over the card's start, is hidden while it shows (`hcm-timeline[tipping]`). The keyboard shows it only for a selected year of several dates: the selected year is always named by the pill, so a key on a dense track needs no chip. The points are not focusable on their own (one slider, `aria-valuetext` names the year), so "the point's accessible name" is the slider's value text; the chip is `aria-hidden`.
- **192b Live, coalesced.** `timeline-sends.ts` sends a press's first new year at once and then at most one per animation frame; the press's end sends what is left. The store's `setYear` is a no-op for an unchanged year and the hash writer already uses `replaceState` once per 300 ms. A polite live region says the year once when a drag ends; while it moves, the slider's value text is all.
- **192c The finger** (`timeline-scrub.ts`): axis-locked with the opacity slider's `touchIntent` (§178b), no selection before 8 px along the track or a tap; listeners filter by `pointerId`; `navigator.vibrate(8)` per year unless reduced motion. The card keeps `touch-action: none` (pan-x / pan-y where the track scrolls), so a swipe across it does nothing and one that starts on the map pans the map.
- **192d The pointers moved out of `hcm-timeline.ts`** (`timeline-pointer.ts`) to keep it under 400 lines; `trackRatio` is re-exported. V12 (the phone pill) and V13 (the date picker) are another agent's (track/timeline-b).
- **192e Tests.** `timeline-tip.test.ts`, `hcm-timeline-tip.test.ts`, `hcm-timeline.test.ts`; S-V04-HAPPY-YEAR-CHIP, S-V04-BAD-YEAR-CHIP-LABELLED, S-V04-HAPPY-TOUCH-SCRUB, S-V04-BAD-FAST-SCRUB, S-V04-HAPPY-YEAR-CHIP-TOUR (the tour's journey `timeline-chip`).

## 194. The viewer on games consoles: spatial navigation, the 10-foot ring, the console's no-WebGL card (2026-11-13, beta.1) — APPLIED

The owner: "make sure our app (the viewer) is usable on PS and Xbox". Behaviours V65 and V66, `docs/research/viewer-input.md` §6.

- **194a Spatial navigation in the entry, not in the gamepad's chunk.** `viewer/spatial-nav.ts` serves the arrow keys, the pad's D-pad (through `GamepadSurface.navigate` and `activate`) and the Xbox's `Gamepad…` keys alike, so one tested path covers all three; the chunk got smaller (its linear focus walk went), its budget (2 KB) and the engine's (IIFE 150, ES 120 KB) are unchanged.
- **194b The D-pad's left and right step the year only on the focused timeline** (the owner's words), no longer from anywhere: elsewhere they move the focus. The timeline keeps left and right; up and down leave it (a horizontal slider; a phone's standing timeline keeps up and down and left and right leave it), so it is reached and left with the D-pad alone. The keyboard's arrows on the timeline stay the slider's in both axes (WAI-ARIA), Tab leaves it.
- **194c Never a step into a box around the focus**: the map's canvas and a scrolling pane enclose the controls over them; a step from the map starts at the viewer's middle. The map is reached with Tab, or the pad's A with nothing focused (Enter on the map, as before).
- **194d The Xbox's key emulation is asked for only where `navigator.gamepadInputEmulation` exists** (legacy EdgeHTML); Chromium Edge has no such switch and keeps the cursor, with which every control works. Under the emulation the gamepad loop ignores A, B, Y, View and the D-pad, which arrive as keys, so nothing acts twice.
- **194e A thicker ring, not a zoomed page**, on a large window without a fine pointer: `--hcm-focus-ring-width` 6 px (3 px elsewhere), one custom property the kit and the viewer read. The rings Mapbox's box clips (the canvas's, drawn inside; the logo's, 6 px from the foot) follow the width (the tour found both cut at 6 px). CSS zoom on the viewer was rejected: Mapbox reads pointer positions in unzoomed pixels.
- **194f The console's own no-WebGL card** (`error.webglConsole`, ro and en): the user agent names `Xbox` or `PlayStation`; it says the console's browser lacks the 3D graphics the map needs, that the photo list still works, and to open the map on a phone. No "WebGL" in it (the M1 UX review). The 12 other catalogues of `track/mergequeue-langs` need this key and the reworded `input.padMove` and `input.padFocus` through ltrans with QA before that merge.
- **194g Not tested on a console**: none was available. The research (Microsoft's UWP docs on mouse mode, reports on the PS5's WebKit windows) is in `viewer-input.md` §6.
- **194h Larger controls and type on the same windows, not everywhere**: `--hcm-control-size` 48 px and `--hcm-chip-size` 48 px (the kit reads them, 40 and 32 px by default), the M3 body, label and title sizes a quarter up on the viewer's wrapper. A phone or a desk keeps M3's sizes; the tour's journey `tv` checks the larger ones.
- **Verify**: S-V65-HAPPY-DPAD-ROUND, S-V65-HAPPY-ARROWS, S-V65-BAD-MAP-KEEPS-ARROWS, S-V65-HAPPY-XBOX-KEYS, S-V65-BAD-DISCONNECT, S-V66-HAPPY-TV-RING, S-V66-BAD-FINE-POINTER, S-V66-BAD-NO-WEBGL-CONSOLE.

## 195. The timeline as a pill on a phone, and a year's dates (V12 and V13 of beta.1, the owner 2026-11-13) — APPLIED, no budget raised

The owner: "on phones the timeline collapses to a year pill when idle and expands on tap" (it must cover nothing: the compass, the menu button, the attribution, the Layers sheet, upright and on its side, 568 × 270 included) and "a year with several dates or layers lets the visitor pick the date (badge + compact chooser)", the date picked on top with V15's mechanism (§191). Behaviours V67 and V68, `docs/ENGINE_API.md` → *Timeline on a phone, and a year's dates*.

- **195a The pill is the timeline, collapsed.** `<hcm-timeline collapsed>` hides the rail and the years and keeps its thumb, a 56 px pill in a 64 px card (amended the same day, the owner: "too small"; it was 40 px in 48 px), the year in M3 title large with 20 px either side (96 px wide or more), so the slider, its keys and its value text stay: a keyboard or screen-reader visitor never needs to open it, and the tests that read the slider are unchanged. It docks at the foot of the column the card took upright (8 px over the chip) and at the trailing end under the chip on its side; `--hcm-timeline-block` becomes 64 px, so the chip and the menu's gap follow (`timeline-dock-styles.ts`). Upright the larger pill is wider than the 68 px column the open menu keeps clear, and at 320 × 568 the six items do not fit above its row: while the menu is open the pill steps aside (`visibility: hidden`, as a short window's whole dock already does). Phones only: a standing timeline, or a short window's lying one.
- **195b "Idle" is the visitor going back to the map, not a timer.** A press anywhere in the viewer outside the dock, or Esc in it, collapses it; nothing collapses it on its own (WCAG 2.2.1: a visitor reading or tabbing is never hurried, and a timed collapse would move the layout under the tour's checks). A tap on the pill opens it and moves no year (the press is caught in the capture phase: lesson 647); the skip link opens it too.
- **195c The badge counts layers, not distinct dates.** A year with two layers or more has a badge on its point (and on the pill when selected): two passes of one day, or a map and a photograph of one year, are two choices. M3's badge colours (`error`, `on-error`: the viewer's baseline has no tertiary). It is for the eye only (amended, §195g: no press of its own, `pointer-events: none`); the slider's value text says the count and that Enter lists them.
- **195d The picker is a modal M3 menu**, `<hcm-date-menu>` in the modal layer: beside the badge or the thumb (above a lying timeline, on the trailing side of a standing one), kept inside the viewer and off the legal strip, its dates as `menuitemradio` (48 px), the one on top checked; a transparent scrim closes it and the frame under it is inert, so it can never be judged to cover a usable control. On a phone the first tap on a collapsed pill opens the card; selecting the year there opens the menu (§195g), and Enter on the pill opens the card first, then the menu beside its thumb.
- **195e A pick is `pickLayer`** (`withFrontLayer`): the timeline at that layer's year, every layer of the year visible, the picked one `front` (§191a), so `layers=` names it last and a link keeps it. `setYear` and `pickLayer` share `#moveTimeline` (one `year_change` when the year changes).
- **195f No new key in the 14 complete catalogues yet**: two keys (`timeline.dates`, `timeline.datesHint`) in `ro` and `en`; the other languages get them through the translation QA (`ltrans`) when their catalogues merge.
- **195g Amended (the owner, 2026-11-13): "The date picker should show up when the user selects a year with multiple dates, not when the user taps the badge. It is too small for finger or mouse interaction."** Selecting a year of several dates opens the menu: a press the visitor lifts on it (a tap, a click, the end of a mouse drag or a finger's scrub: `settle(released)`), Enter on the slider, and the gamepad's A (a click with `detail` 0). A drag or a scrub that only passes such a year never opens it (its years show live, the newest date of each, as before); a cancelled press (the browser's scroll, a swipe across) neither. The arrow keys move the year live and wait for Enter: opening a modal menu on an arrow would take the focus away mid-walk (WCAG 3.2.2, no change of context on input). One selection opens it once; a deliberate second press or Enter on the same year opens it again, and nothing reopens it on its own (closing gives the focus back to the slider, which opens nothing). B (the input `close`) closes it first. No new string: `timeline.datesHint` ("Enter lists them") still holds.
- **195h The year chip, bigger and never on a year of several dates** (the owner, 2026-11-13: "bigger on all platforms", and "the year chip must not appear for a year with several images or dates"): the chip is M3 title medium, 40 px tall, 16 px either side, the small corner, everywhere (mouse, keyboard, finger; phone, tablet, desktop, TV). A stop whose year has two layers or more (`dateCounts`, as the badge counts) shows no chip under a mouse, the keyboard or a finger: the badge marks it and its date menu names the dates, so the chip would say it twice. The chip's text is the year alone (the dates it named before are gone with it; `datesOfYear` and the timeline's `layers` property were dropped).
- **195i Amended (the owner, 2026-11-13): "The date picker for the year should open on mouse hover over the year in the timeline", and the same day the same idea on phones and tablets.** A pointer resting on a year of several dates shows its menu as a *peek* (`timeline-peek.ts`, `hcm-dates-peek`): not modal (no scrim, the frame stays live, the focus stays where it was) and the year not selected; only a date picked in it (`pickLayer`) or selecting the year (§195g, which turns the peek into the modal menu) changes the map. A mouse or a pen (the pointer's own type, `pointerType`, rather than the owner's `(hover: hover) and (pointer: fine)`: a tablet or a touch laptop with a mouse, as the e1024 window with touch, reports a coarse primary pointer, and a finger's pointer events are never `mouse`) rests 300 ms on the year's point (hover intent: a sweep across the timeline opens nothing); the menu opens above the card (beside a standing one), anchored at the year's point along the track and at the whole card across it, so it never covers the track; moving from the year into the menu keeps it (the close waits 300 ms and the mouse entering the menu cancels it); leaving both closes it 300 ms later; Esc or a press elsewhere closes it at once; a drag with the button held opens nothing; a menu opened by a click, Enter or the gamepad is never replaced by a peek. A finger scrubbing along the track that rests 400 ms on such a year opens it at once with a haptic tick (none under reduced motion); a quick sweep opens nothing; moving on along the track closes it and the scrub goes on (the live year selection unchanged); the finger off the card across the track holds the year, slid onto a date and lifted picks that date (press, drag, release), lifted on the year selects it and the menu stays open (modal) for a tap. Either menu, peek or modal, keeps clear of the compass, the zoom group, the menu button and the photos chip, moving the shortest way past them (`date-menu-clear.ts`), and the peek's host lets every press through to the map (`LESSONS.md` 671). No new string, no budget raised.
- **Verify**: S-V04-BAD-MULTI-DATE-NO-CHIP, S-V68-BAD-MULTI-DATE-NO-CHIP, S-V68-HAPPY-HOVER-PEEK, S-V68-BAD-HOVER-SWEEP, S-V68-BAD-HOVER-TOUCH, S-V68-HAPPY-DWELL-PICK, S-V68-BAD-DWELL-SWEEP, S-V68-BAD-SCRUB-PASSES, S-V67-HAPPY-PILL-ON-PHONE, S-V67-HAPPY-PILL-LANDSCAPE, S-V67-BAD-ESC-AND-LARGE-WINDOW, S-V67-HAPPY-TOUR, S-V68-HAPPY-PICK-DATE, S-V68-BAD-ESC-CHANGES-NOTHING, S-V68-BAD-SINGLE-DATE, S-V68-HAPPY-TOUR.

## 199. Crash reports and analytics checked; messages say what happened, why and the fix (track/telemetry, 2026-11-13) — APPLIED

- **Read live** (2026-11-12, read-only): Crashes, 30 days: four groups. (1) `ops-onBudget` "no available instance" ×3, 2026-10-26 to 10-29: already fixed on 2026-11-01 (`BUDGET_SCALING`, finding 45), none since. (2, 3) "Can't find variable: `__firefox__`" and "`window.__firefox__.reader`", viewer 1.0.0, 2026-11-11, one each: Firefox for iOS's reader script injected into the page, not ours; now dropped at the source and by the endpoint (`crashNoiseOf`). (4) "TypeError: Cannot convert undefined or null to object", viewer 1.0.0, 2026-11-08: Mapbox 3.34.1's `_contextRestored` → `reloadModels` on a style fragment without models; fixed by `context-restore.ts`. GA4 (property bucurestiul-disparut, last 28 days): 20 users, 350 views (263 admin, 87 viewer), 2,963 events: `year_change` 995, `web_vitals` 625, `page_view` 350, `viewer_timing` 263, `photo_open` 131, `layer_toggle` 96, `compare_open` 3, `share` 2, `exception` 1; 18 of 20 users in Romania.
- **Changes**: the crash reports' browser label, route and the noise filter; the Crashes page's frames, page, browser, people affected and release link; the events `story_open`, `locale_change`, `theme_change` and the admin's `admin_action`; the owner's rule of 2026-11-13 in `AGENTS.md` and `.agent/skills/web/i18n_skill.md` rule 12, with the `plain-messages` gate (`scripts/ci/check_plain_messages.py`, a new gate of `static`: pre-approved as a stricter gate, logged here); the messages the owner named rewritten (a worker busy in a long step is not "not connected"; "newer than this admin"; `apiError.invalidRequest`, whose fields now go to the log; `apiError.internal`, `error.generic`, `tilesNotFound`'s "(404)"); "Run it again" on an import set aside after the frame was imported again now names the newer import (`apiError.imagery.importedAgain`, Open the newer import); the Jobs page says which version the computer runs.
- **Not done**: source maps for Error Reporting (it has none for JavaScript); an admin Statistics page over the GA4 Data API (it needs the `analytics.readonly` scope in the owner's sign-in and a screen of its own: proposed as its own task); the PWA's `app_install` and Report a problem events (the PWA is on another track; Report a problem is a link out).

## 200. Wizard funnels, the errors shown, the viewer's key actions and Do Not Track (track/analytics, the owner 2026-11-13, beta.1) — APPLIED, no budget raised

The owner: "make sure we have analytics through the app and especially in the wizards / setup wizards, so we can see user pain points and issues and fix and improve the wizards." Built on §199 (track/telemetry, merged here).

- **200a One funnel helper**, `@hcm/shared/funnels` (a subpath export: the public viewer's engine never carries it, `LESSONS.md` 532): a page reports a snapshot of its wizard on every render (`trackFunnel`), only what changed leaves as a composed `hcm-funnel` DOM event, and the admin's `FunnelHub` turns it into `wizard_start`, `step_view`, `step_complete`, `step_back`, `step_error`, `step_help_opened`, `step_action`, `wizard_abandon` (on `pagehide` or a hidden page) and `wizard_complete`, with the wizard, the step, the attempt and the time; the release, the app and the window class come with every field measurement. Chosen over a telemetry port in every UI element: the UI kit stays free of telemetry, and a page with no listener (a test, the start page) sends nothing.
- **200b Wired**: Setup (every card; a guide or console link opened in the open card is its help), New city, the start page (M14: signals only, the page loads no analytics before the owner's project exists), the tile wizard, the georeferencer and Help-calibrate (points placed and removed as `step_action`, save, approval), the USGS import, an uploaded file (web or local), a local archive, Run on my computer. Report a problem is not in this branch (track/report).
- **200c Errors**: every error notice of the admin is one `ui_error` (key and route); the viewer's `error.…` toasts are one `ui_error` each; a wizard's errors are `step_error`; the guard refuses free text in all of them; the hub and the watch never throw.
- **200d The viewer**: `year_change` waits 1.5 s for the year to stay (a drag is one event; a hidden page sends it at once), `compass_reset`, `input_device` (`gamepad`, `console`, once a page each), `ui_error`; the others as before.
- **200e Do Not Track and Global Privacy Control** count as a refusal in both apps until the person accepts in About or the account menu: no banner asks, nothing is stored for the signal, nothing loads.
- **200f The owner's view**: **Crashes → Where people get stuck** (`#/crashes/statistics`), a route parameter of the crashes page rather than a new route (no new area chunk, no navigation change): every wizard's steps and codes and how to build its GA4 funnel exploration. The GA4 Data API is **not** wired: it needs the `analytics.readonly` scope in the owner's consent and a screen or function of its own; GA4 shows the average time between steps, the exact median needs the BigQuery export. Setup's **Create the measurement reports** registers `wizard_id`, `step_id`, `error_code`, `action`, `code`, `route`, `device` and `attempt`.
- **200g Budgets**: the field guard caps `step_action` at 60 and `ui_error` at 30 a page; the hub batches (2 s, or at once on hide); no new request on the viewer's critical path (the events wait for the consented lazy chunk); the engine got only `settle.ts`, `viewer-analytics.ts` and the privacy check (no engine budget raised: IIFE 108.5 KB, ES 105.9 KB gzip). In the admin the wizards' snapshots and the shared `trackFunnel` would have taken `archive`, `imagery`, `worker` and `editor-shared` 0.1 KB over their budgets each: they are a `funnels` chunk of their own (`packages/admin/vite.config.ts`) with a new row of 2 KB in `scripts/ci/check_bundle_budget.py`; no existing row was raised.
- **200h Lines kept within the limits**: the shared index's field-events types became `export type *` (no runtime cost), the engine store's zoom and window size moved to `compass.ts` and `window-size.ts`, the admin's telemetry wiring to `telemetry-wiring.ts`.
- **Verify**: S-A150-HAPPY-FUNNEL-ORDER, S-A150-BAD-NO-EVENTS-BEFORE-CONSENT, S-A150-BAD-STEP-ERROR-CODE-NOT-TEXT, S-A151-HAPPY-STATISTICS, S-A151-BAD-NO-ANALYTICS, S-V70-HAPPY-KEY-ACTIONS, S-V70-BAD-NO-EVENTS-BEFORE-CONSENT, S-V70-BAD-YEAR-DRAG-ONE-EVENT.

- **Verify**: S-V67-HAPPY-PILL-ON-PHONE, S-V67-HAPPY-PILL-LANDSCAPE, S-V67-BAD-ESC-AND-LARGE-WINDOW, S-V67-HAPPY-TOUR, S-V68-HAPPY-PICK-DATE, S-V68-BAD-ESC-CHANGES-NOTHING, S-V68-BAD-SINGLE-DATE, S-V68-HAPPY-TOUR.

## 201. Not useful on a scene, the cloud estimate, and Declass 3 previews over 5 MB (the owner 2026-11-13) — APPLIED, one callable added

The owner: "This scan is useless (too many clouds!!!)" on `#/imagery/scene/DS09066A047MC019`, a 1964 frame the whole-city plan offered as **Buy this scan**; then every KH-9 panoramic card said its preview could not be fetched. Behaviour A152; `docs/research/M4-interfaces.md` §1.9, `M3-interfaces.md` §3.2–§3.4.

- **201a The scene route already opened the scene.** On the live admin (1,920 px) `#/imagery/scene/<id>` showed the scene's pane beside the list, its preview, cost, guide and reasons; nothing was built for that. What it lacked was an action that says the scene is of no use, and a preview for Declass 3 frames.
- **201b Not useful is `status: 'rejected'` with `unusable {reason, at}`, written by a callable, `imagery.markScene`**, not by the client rule that already allowed `rejected`: the plan must be written again at once (a client write starts no function, and the plan is the server's), and the reason is server-owned like `order`. Rejected scenes already took no part in the plan and the list's filter already hid them, so the filter was renamed Hide not useful and nothing else changed there. The client rule for `status` and `note` stays (no screen writes it).
- **201c One more deployed function (101).** A Firestore trigger on `usgsScenes` would have run on every harvest write (hundreds a month) to catch a rare click; the callable runs only when clicked.
- **201d The estimate is the function's, on a 128 px grey copy** (sharp was already deployed for photos): bright (at least 150, 60 over the median, never above 210) and flat (3 × 3 spread under 45) pixels inside the city's bounds, placed through the corners. Measured once per copy (`CLOUD_ESTIMATE_VERSION`), at copy time and on the first read of an older copy, so scenes copied before this change are measured when opened. DS09066A047MC019's preview gave 46 % with the footprint's north-western vertex as the image's top left (**UNVERIFIED** for frames without corners).
- **201e From 40 % (`CLOUDY_CITY_PERCENT`) a frame is "probably cloudy over the city"**: the rank keeps its clear share (RANKING_VERSION 5), the card, the page and the plan's Buy this scan warn in words. It is never hidden or refused on the estimate alone: the owner decides with Not useful.
- **201f Declass 3 previews are 7 to 13 MB** (`ims.cr.usgs.gov/browse/declass3/…`, read with `curl -I` on 2026-11-13); the 5 MB fetch cap answered "cannot be fetched right now, try again" for every one, and a retry could never help. The fetch now takes up to 30 MB in 30 s and stores a file over 5 MB shrunk to a 4,096 px JPEG; the failures say what failed (`browseNotImage`, `browseTooLarge`, `browseUnavailable`) and what to do.
- **201g The Imagery chunk's 18 KB kept, not raised.** Origin's `imagery-*.js` measured 18.03 KB gzip (over its 18 KB row) and 18.38 KB with Not useful. A scene's page's own parts (its preview, the facts, why Import is not offered, Not useful, the cloudy warning) moved to a lazy chunk, `scene-unusable` (budget row 2 KB, 1.61 KB measured), fetched when a scene's page opens; Imagery measured 17.94 KB. The chunk imports no module of the Imagery chunk (one it shared would land in `editor-shared`, which stays at 12.98 KB). The card's chips stay (`scene-tags.ts`).
- **Verify**: S-A152-HAPPY, S-A152-HAPPY-UNDO, S-A152-BAD-CLOUDY, S-A152-BAD-NOT-EDITOR, S-A152-BAD-CLIENT-MARK, S-A12-HAPPY-LARGE-BROWSE, S-A12-BAD-BROWSE-SPECIFIC.
- **Verify**: S-V67-HAPPY-PILL-ON-PHONE, S-V67-HAPPY-PILL-LANDSCAPE, S-V67-BAD-ESC-AND-LARGE-WINDOW, S-V67-HAPPY-TOUR, S-V68-HAPPY-PICK-DATE, S-V68-BAD-ESC-CHANGES-NOTHING, S-V68-BAD-SINGLE-DATE, S-V68-HAPPY-TOUR.

## 202. The second optimisation round: the e2e tier's emulator workers capped, the canvas within its budget on every thread, a governor that gives way before the heat, cards named only by a command that succeeded (track/optim2, 2026-11-13) — APPLIED, no gate, rule or threshold relaxed

The owner's standing priority (optimisations first) and the low-resource principle; the open items of reports/resource-audit.md and §180i.

- **202a The Functions emulator's workers capped** (§180i's open item). The emulator keeps one Node worker per function trigger for the whole run and never stops an idle one. `e2e/stack/firebase.ts` now runs firebase-tools' own CLI after wrapping its `RuntimeWorkerPool` (`e2e/support/emulator-pool.ts`): when a new worker would make more than `HCM_EMULATOR_MAX_WORKERS` (default 18) live ones, the least recently used IDLE worker is stopped exactly as the emulator's own `refresh()` stops one after a code change (FINISHING, killed; its exit marks it FINISHED). A BUSY worker is never stopped; a trigger whose worker was stopped cold-starts on its next call. The e2e tier (`e2e/playwright.config.ts`) and the dev stack (`e2e/stack/main.ts`) start the emulators through it; the deployed functions never see it. Rejected: grouping the functions into fewer codebases (each trigger still gets its own worker), lazy imports per group (measured: a worker that loaded the whole bundle is 120 MB resident against 104 MB for its dependencies alone, so at most 16 MB a worker), `--inspect-functions` (serial, §180i). Measured: E2E_NUMBERS.
- **202b The windowed canvas within 800 MB on every thread count.** GDAL's threads allocate from glibc's per-thread malloc arenas, which keep freed pages: two 12,000 px colour sheets laid out and mosaicked peaked at 636 MB on one thread and 870 MB on every core of the NUC (about 115 MB of the layout's reads stayed resident). `python -m hcm_pipeline` starts with at most two arenas and the canvas gives the heap back before its first sheet and after each one (`pipeline/src/hcm_pipeline/heap.py`, also tcmalloc's release when the pipeline's image preloads it): on glibc 634 to 588 MB on one thread and 871 to 653 MB on every core, the same pixels, no slower; under the worker image's tcmalloc the same sheets measured 650 to 690 MB either way (the release keeps it there). Tuning `GDAL_CACHEMAX` per window was not needed (the canvas already holds GDAL's cache to 128 MB; reading the sheet single-threaded measured the same 853 to 865 MB, so the reads were not the cause). The budget test now runs on one thread and on `ALL_CPUS`; the budget is unchanged.
- **202c The governor gives way before the heat, and counts other programs.** From 80 °C the budget's threads shrink in proportion to the degrees left to the 95 °C step-down (14 threads at 80, 9 at 85, 4 at 90, 1 at 93 on the laptop); other programs' busy cores come off the top; the step-down's way back is 5 °C, not 10 (with a local model, pytest and Prettier holding the laptop at 88 to 93 °C, a resume at 85 never came and the worker paused for hours). The memory budget counts whole 256 MB steps and the log says only a change of profile, reason or threads (the laptop's last hour: 173 lines, 56 under the new rule; up to 720 an hour before). Within a profile a change of fewer than two threads is not made (the ramp first moved quiet's threads by one almost every tick on the laptop). A thermal step down holds at least two minutes (on battery at 90 to 95 °C the laptop paused and resumed about once a minute).
- **202d A hot or busy computer leaves queued jobs to the others** (three workers: the laptop, the NUC, the PC). `Governor.headroom()` (0 to 1: the heat's share and others' load, 0 while paused) stretches every claim wait by 1 + 3 × (1 − headroom) in `worker/pace.py`: 30 s with room, 75 s half busy, 120 s hot or paused (240 s idle). A lone worker still takes the job. Kept small and client-side: track/archivehost changes the server's claim.
- **202e Graphics cards only from a command that succeeded.** The starter keeps nvidia-smi's rows only on exit 0 and in shape (the NUC printed its failure on stdout, and the empty line after it made the admin read the whole `machine` as an older worker's), names cards by `lspci` (the NUC: "Arrow Lake-P [Arc Pro 130T/140T]"), and says `no-driver` for an NVIDIA card it cannot reach; the worker drops a card whose name is empty, multi-line or over 120 characters; the admin's card says to install NVIDIA's driver, with a link (ro, en). The Windows file checks `$LASTEXITCODE` and the same shape. Starter version `7d4d3f94aee3`.
- **202f Pre-approved config edit**: `vitest.config.ts` adds `e2e/support/emulator-pool.ts` to the e2e-support project's per-file coverage (stricter).
- **Verify**: `e2e/test/emulator-pool.test.ts`; `pipeline/tests/unit/test_heap.py`, `test_placing_canvas_window.py`, `test_governor_{budget,policy,loop,probe}.py`, `test_worker_pace.py`; `functions/test/worker/starter-governor.test.ts`; `packages/ui/test/admin/worker/machine.test.ts`. Scenarios S-A141-BAD-NO-DRIVER, S-A141-BAD-BATTERY (updated), S-P31-HAPPY-CLAIM-HEADROOM, S-P31-BAD-CLAIM-HEADROOM-RANGE, S-P31-HAPPY-CANVAS-THREADS, S-P31-BAD-CANVAS-THREADS-NO-GLIBC. Lessons 659 to 661.

## 203. The Statistics view shows the numbers: GA4's Data API on the owner's read-only consent, Error Reporting's groups, visitors per app and role (track/gadata, the owner 2026-11-13) — APPLIED

The owner: "take me to the analytics permission button", then: the page must show real data from Google Analytics and from crash reporting, visitors and visits per app (the map, the admin, the start page, Contribute) and per admin role, totals and a daily line, cheap calls.

- **203a The consent**: **Show the numbers here** on `#/crashes/statistics` asks for `https://www.googleapis.com/auth/analytics.readonly` only (`GOOGLE_SCOPES.analyticsRead`), through the admin's existing Google sign-in (Firebase Auth `GoogleAuthProvider.addScope` and `reauthenticateWithPopup`, the shell's `GoogleAccessService`: the popup opens in the click, nothing awaited before it), with `<hcm-consent-note>`'s plain why ("read your map's visitor statistics, nothing else", removable at myaccount.google.com/permissions). The token stays in the memory-only `GoogleAccessStore`, reused while it has five minutes left, never stored or logged. Chosen over Google Identity Services' token client: the admin has no GIS, every other scope already goes through Firebase Auth.
- **203b The property**: as Setup's Create the measurement reports finds it (`setup.analyticsConfig`'s measurement id, then the Admin API's account summaries and each property's web streams), with the read-only token; no property id is stored. No property at all is "no access", others but not this one is "no property".
- **203c The numbers**: the GA4 Data API `v1beta` `batchRunReports` from the browser, three calls a period (five reports, five, one): the wizards' `step_view` people, `step_error` codes, `step_complete`'s `averageCustomEvent:duration_ms`, the apps' totals and days; the totals, pages, admin screens (`customEvent:route` of `page_view`), the viewer's key actions, devices; countries. `runFunnelReport` exists only in `v1alpha`: the funnel (who left before each step) is computed from `runReport` rows, in the page's step order. 7, 28 or 90 days; each answer kept for the session in memory, read on a click (the button, a period not seen yet, Refresh), never on a timer. Its own lazy chunk `analytics-data` (budget row 2 KB).
- **203d Apps and roles**: every event of either app carries `app_surface` (`SURFACE_PARAMS`, added by `eventSchemas` to every event's schema): the viewer `viewer`, the admin `admin_<role>` of the open city (`TelemetryView.role`), `admin` before one is known. Chosen over the page path (the admin and the map share the origin and Contribute is a hash route of the admin, so the path cannot tell the roles apart) and over a user property (a role changes with the open city). Registered by Create the measurement reports (23 parameters now). Events before this release show as "not split yet"; the start page (M14) loads no analytics and is shown as not measured.
- **203e Errors**: Cloud Error Reporting (not Crashlytics, which is for mobile apps) through the existing `telemetry.listGroups`: the server's `fn-admin@` account already holds `roles/errorreporting.viewer` (Provision's role table), so the owner gives no extra consent; it returns aggregates and the redacted first line only (no stack is shown on this page); admins only; now limited to 20 lists a minute per admin and 60 per instance (`LIST_GROUPS_LIMITS`, salted and hashed uids in memory). The view's period moves the groups' period (7 days, else 30, Error Reporting's longest).
- **203f The installer**: Provision's `apis` item turns on `analyticsdata.googleapis.com`; `PROVISION_SET_VERSION` 4 makes **Update the map** apply it to a prepared project in the same click.
- **203g Messages**: consent refused, the window blocked, another account, the Data API off (with Setup and the API's console page), no property, no access, the names not registered (step g), Google Analytics not set up, Google silent, a blocked host, the server's own refusal: each in words with its fix and link (`adminContent.statistics.problem.*`, ro and en).
- **203h Names GA4 cannot use yet** (the owner's live test, 2026-11-13): every 400 of `batchRunReports` was said as "Google Analytics does not know the map's measurement names yet", while step g reported all 23 registered; the names the view asks for (`wizard_id`, `step_id`, `error_code`, `app_surface`, `route`, `duration_ms`) are all among them, and an hour later the same read worked with no values for them yet. GA4 rejects the whole batch for one field its Data API does not list yet, and a newly registered name takes hours to be listed. Now the read asks the property's metadata (`getMetadata`, read-only scope) first, sends only the reports whose names it lists, and says why the rest are missing (`analytics-fields.ts`): not registered at all (the Admin API's list, Setup's step g as the fix), registered but not usable yet (look again tomorrow), or usable with no values yet (24 to 48 hours after use). Another 400 is `refused` (the admin's fault, Google Analytics as the way meanwhile). Each reason is a `ui_error` `statistics_<reason>` and a log line with the names. The admin screens leave out `(not set)` (the public map's page views and the admin's before `route` was registered); the guide's last line says whether GA4 knows the codes, from the last read.
- **Verify**: S-A153-HAPPY-NUMBERS, S-A153-BAD-CONSENT-REFUSED, S-A153-BAD-API-DISABLED; Vitest `packages/admin/test/crashes/statistics.test.ts`, `packages/admin/test/google/analytics-data.test.ts`, `packages/admin/test/app/statistics-wiring.test.ts`, `packages/ui/test/admin/ops/statistics.test.ts`, `functions/test/telemetry/list-groups.test.ts`.

## 204. Any computer runs an archive series: the hand-back and the copy through the bucket (live report of 2026-11-13) — APPLIED, step 1

- **Seen**: the NUC (w-12a21a1738d6b1ed) and the PC's WSL (w-438aea84a5181070) joined the laptop (w-c9cc212966de0cb3) for Bucharest; five
  series of `ar-971b77774eee2871` failed at `gather` with `apiError.imagery.archiveMissing` and the Borroczyn atlas spent its attempts.
- **204a Every worker claims every job.** The owner rejected pinning an archive's jobs to the computer that imported it.
- **204b A worker without the series' sheets hands the job back without spending an attempt** (`worker.end` `returned`: the attempt
  the claim counted is given back, `waitReason: 'archive-copy'`). The computer the archive came from, and the fifth return, fail it
  with `archiveMissing` instead (no loop).
- **204c The copy goes through the private bucket** (`tmp/archive-copies/{city}/{job}/`, the existing one-day lifecycle of `tmp/`):
  only the series' sheets, each by its SHA-256 and checked on arrival, sent by the computer that holds the archive whole when its
  claim is answered `copy`; the new callable `worker.archiveCopy` signs it while the job waits for it, never with the guard red,
  at most 8 GiB, and logs the bytes. A copied archive is recorded `partial` on the receiving computer and never offered as a source.
- **204d Step 2** (pending): the copy over the home network (a separate LAN endpoint off unless the city has two paired workers, a
  short-lived read-only token from a callable, archive files only), and pre-seeding under the governor; the bucket stays the fallback.
- **Verify**: S-A120-HAPPY-ARCHIVE-COPY, S-A120-BAD-ARCHIVE-COPY, S-P20-HAPPY-ARCHIVE-COPY, S-P20-BAD-ARCHIVE-COPY.

## 216. Pause a job, every job or a computer (track/pause, the owner 2026-11-13) — APPLIED, one callable added

- **Asked**: "I want the user to be able to pause jobs, and to pause using a machine!!!!" (the owner, 2026-11-13).
- **216a No new job status.** A paused job keeps its status (`queued`, or the run's own until its step boundary) and gains
  `paused: {by, at, inRun?}`; the claim, the dispatcher and the tick's no-computer mark skip it. A new status would have touched every
  status switch, filter and catalogue for one meaning the field already carries; the rules still let no client write it (`paused`,
  `releaseRequested` are `imagery.pause`'s alone), and a paused job can still be cancelled.
- **216b A job stops between steps, a computer at the next checkpoint.** The owner's job pause keeps the step's work (the step
  finishes); a paused computer must free the processor now, so its step stops at a checkpoint and starts again elsewhere.
- **216c No attempt is spent by a pause.** The job's Resume gives back the attempt a paused run counted (`inRun`); a computer's hand-back
  (`worker.end` `released`) gives it back only while the computer is paused or the job was asked back, so it is never a way round
  the attempts. It mirrors M20's `returned` (§204, archivehost) with its own outcome: a paused computer's job waits for no copy.
- **216d The server is the truth of a computer's pause**; the worker mirrors the claim's answer into the governor's new `paused`
  choice (M26 §3), and the computer's own page sends its pause with the next claim or end (`pause` command), so either side pauses it.
- **216e Until tomorrow is 08:00 tomorrow** on the clock of whoever clicked; a pause ends within 48 hours at most
  (`PAUSE_UNTIL_MAX_HOURS`, `apiError.imagery.pauseUntil`).
- **Verify**: S-A170-*, S-A171-*, S-P32-*; `docs/research/M7-local-worker.md` → *Pause*.

## 205. Under WSL the starter reads Windows' idle time, not logind's (the owner's PC, 2026-11-13) — APPLIED, no gate relaxed

- **205a The fault**: in WSL logind's `IdleHint` is always `no`, which the starter wrote as `"idleS":0` every 5 s; the governor read `user-active` and Automatic never left Quiet (4 of 16 threads).
- **205b The reading**: under WSL only `GetLastInputInfo` through `powershell.exe -EncodedCommand` (parity with `hcm-worker.bat`), at most every 30 s, from the first `/run/WSL/*_interop` whose process runs in a session other than 0 (session 0 reads the uptime); none answering is an empty `idleS`. Measured on the PC inside a systemd user unit: 1722 s through `4597_interop` in 1.7 s.
- **205c Cost**: the Automatic profile goes quiet up to 30 s after the owner returns instead of 5 s; the owner's guidance accepted a 30 s cache.
- **205d Release**: starter version `0428b9113175`; the worker image must match (`ai_state.never_here` refuses the AI with an older starter), so Setup's **Update the map** follows the deploy.
- **Verify**: S-A141-HAPPY-WSL-IDLE, S-A141-BAD-WSL-NO-INTEROP; Vitest `functions/test/worker/starter-governor.test.ts`.

## 209. A scene harvested before the id rules is imported as the camera its id names (track/coronacrop, the owner 2026-11-13) — APPLIED

The owner: "There is no Bucharest in the left screen" on `DS09065A073MC043` (18 June 1964, labelled KH-4A Corona). It is neither a strip cut in the wrong place nor a wrong footprint: the frame is a **KH-5 Argon** mapping-camera frame (`MC`, mission 9065A), 550 km square at about 140 m on the ground, and its footprint (41.3 to 49.2 N, 22.6 to 33.4 E) holds Bucharest at 28 % and 63 % of its sides. Every `corona2` scene of Bucharest (249) was harvested on 2026-10-25, before the id rules of 2026-11-09, so each still says KH-4A (the dataset's fallback): 33 Argon frames, 12 KH-4B (DS11xx) and the KH-4 ones. The import copied that label into the job, so `locate` searched a square frame as a Corona strip for 35 minutes, timed out and offered the whole frame shrunk twice (8218 x 8227 px), in which the city is about 370 pixels wide next to the Black Sea.

- **209a**: `trueSensor` (`functions/src/imagery/scene-record.ts`): a stored scene whose camera is its dataset's fallback takes the camera its id names; a camera named otherwise, or an id of no known form, is kept. `imagery.import` (and the order watch's `startImport`, Import again) use it for the job's params, the version's sensor and label, the reserved layer id and the scene it marks imported.
- **209b**: a new harvest (Imagery → Search USGS) relabels every stored scene as well (`sceneDoc` writes the harvested camera); not run by the agent.
- **209c**: the Argon frames already imported as KH-4A (MC043, MC038, MC039, MC042, MC015) were not re-imported: as KH-5 the search is held to 10 minutes and an unproved frame is still offered whole, with the city a few hundred pixels across at 140 m a pixel. Whether Argon is worth a layer is the owner's call (Not useful → Other, or rough points on the city).
- **209d DS1103-1058DF026 (1968, stitched right to left)**: its crop around the rough points showed farmland. The mapping is not mirrored: the whole scan (`SegmentReader`) and the crop (`write_crop`) read the same `frame.json` window by window, and `WholeFrame.to_film` is the scan's own shrink and left edge; the log's crop, film columns 80,028 to 109,449 of 128,514, holds the points at 73 to 74 % along, where they were placed. A regression test pins this for a strip lettered either way (S-P01-HAPPY-RECROP-RIGHT-TO-LEFT, S-P01-BAD-RECROP-MIRRORED). The crop holds a single-runway airfield near its left edge (about 67 % along, row 7,140 of 8,631), likely Otopeni, while the point named Otopeni sits at 74 %, row 2,398: the points were placed on other features. The frame covers only about 17 km north to south, so most of the city lies on DF027, and the join is what holds it.
- **Verify**: S-A12-HAPPY-STALE-CAMERA, S-A12-BAD-STALE-CAMERA-KEPT, S-P01-HAPPY-RECROP-RIGHT-TO-LEFT, S-P01-BAD-RECROP-MIRRORED; pytest `pipeline/tests/unit/test_recrop_order.py`; Vitest `functions/test/imagery/scene-record.test.ts`, `functions/test/imagery/import.test.ts`.

## 215. The join card's budget is 4 KB (the owner, 2026-11-13: "raise the limits you need to raise") — APPLIED, gate relaxed with approval

`scripts/ci/check_bundle_budget.py`: `join-card` 3 → 4 KB, `statistics-live` 4 → 6 KB (Material 3 redesign, 4.6 KB), `funnels` 2 → 3 KB (2.8 KB), `imagery` 18 → 20 KB (18.0 KB). The chunk measured 3.0 KB after the cloud estimate and the plain
messages, failing the budget gate for every track. The owner approved raising budgets that block beta.1.

Also for the beta.1 freeze (track/green, 2026-11-13): `settings` 20 → 22 KB (measured 20.2 KB, failing every track) and `ADMIN_TOTAL_KB` 760 → 770 KB (754.8 KB with W5, 760.6 KB measured with the §210g message restored; after the Pause merge `worker` 8 → 10 KB (8.7 KB) and `approval-map` 5 → 6 KB (5.0 KB); the §210g message naming the new address in a tab on the old one, left out at 760, is restored).

- **215b (track/sources, M28):** the Setup chunk carries the Platform and Sources cards and their catalogue (`@hcm/shared/admin-sources`, about 360 texts in two languages); any budget the change outgrows is raised to its measured size plus room, under the same approval (the values are in `scripts/ci/check_bundle_budget.py`, with this section named beside them).

## 216. The 1895-1899 layer's white patches: left-out pieces found again in the overview's holes, and a placed series stitched again (the owner 2026-11-13) — APPLIED

The owner: the published layer `1895-1899` (archive version `ar-mw993zri-s-4054e55659a3`, 60 pieces, "placed by gcps", checkpoint 22.5 m) shows three white patches near Grivița, Obor/Gara de Est and Tineretului; fill them with real map data only, nothing generated. `docs/research/M20-import-local.md` §15 (*Atlases and pieces*), LESSONS 669.

- **216a The cause was (a), pieces left out by the stitcher, not missing or blank sources.** `help.stitched`: 57 joined, `leftOut` img366, img390, img418 (`no-join`). All three are in harti.zip (`Harti/Bucuresti 1895-1899/1895-1899.jpg/{1,2,4}_quadrat/`), with full map content. The four gaps in the file numbering (img377, img385, img410, img413) are not in the archive under any name and no area lacks a piece once the three land, so nothing had to come from the second copy `harta-bucuresti-1895`.
- **216b No fill from a sibling scan was built.** The owner's fallback (re-align `harta-bucuresti-1895` around each patch and composite it) was for pieces that do not exist; with the pieces present it would have pasted a lower-detail, differently placed copy where the series' own scans belong. "Fill gaps from another version of the same map" stays unbuilt until a series really lacks a piece.
- **216c The second pass (`placing/overview_holes.py`)**: after `fit_tiles`, each left-out piece is warped by the strong fits' median scale and turn (and the turn plus 180°), correlated (`TM_CCOEFF_NORMED`) with the overview, only at places covering at least 20 % of uncovered overview; kept at a score of at least 0.45 that beats every non-overlapping place by 0.1; refined by ORB within a window twice its size when that fit agrees with the consensus and stays within a tenth of its size. The holes are recomputed as pieces land. A piece that does not pass stays in `leftOut`, as before. No new field or reason: the version's `joined` and `leftOut` say how many landed.
- **216d The thresholds come from the real files**: the three pieces scored 0.96, 0.91, 0.90 against next bests 0.66, 0.51, 0.15; the wrong turn scored 0.27, 0.21, 0.22. The refinement's ORB fits agreed within 1 px.
- **216e A placed series is stitched again in a new version of its layer, through Locate again.** A published version's `place` never ran the stitcher again: with the owner's pairs saved it warps the kept `stitched.tif` (`placing/owner.py`), and `imagery.locateAgain` took only parked versions. Now `imagery.locateAgain` on a published archive series whose `help.stitched` is an `overview` mosaic with `leftOutCount > 0` starts a new `archive-series` job and version on the same layer (`functions/src/imagery/restitch.ts`: `params.restitch: true`, `runOn: 'local'`, the base's label, year, source, rights, scan, pairs and `help` without a layout answer; the layer marks it pending; the busy layer and the budget guard refuse as for any re-run). Its `place` lays the series on the overview again (`placing/restitch.py`), publishes the new mosaic as `help.stitched` and the scan, and, when it was placed from the owner's pairs, warps it through them (one placed on its own is placed again by its class's placer): an overview mosaic's frame is the overview's own resized, so the pairs, in the base scan's pixels, are scaled by the two sizes (`owner.picture_of`). When the overview places it no more, it waits for points (`low-confidence`). The admin shows Locate again on such a version (`restitchable` of the version view). No new callable and no new words: the button and its label are the existing ones. The published version stays on the map until the new one is approved.
- **216f Not for other mosaics**: a series stitched by names, seams or joins has no fixed frame, so the pairs would not hold; it is not offered (S-A122-BAD-RESTITCH-NOTHING-LEFT).
- **216g `restitch` on the job-params schema** (2026-11-14): `archiveSeriesParamsSchema` and the Python `_ARCHIVE_SERIES_KEYS` twin accept optional boolean `restitch` for `archive-series` only; other job types still refuse it. Without that, Locate again queued the job and the worker failed immediately with `params has unknown keys: restitch` (lesson 701).
- **Verify**: S-P20-HAPPY-OVERVIEW-HOLES, S-P20-BAD-OVERVIEW-HOLES-NOT-FOUND, S-A122-HAPPY-RESTITCH, S-A122-BAD-RESTITCH-NOTHING-LEFT, S-P20-HAPPY-RESTITCH, S-P20-BAD-RESTITCH-NO-OVERVIEW.

## 210. The admin on its own web address: one sign-in for every tab, kept when Chrome closes (track/adminsite, the owner 2026-11-13) — APPLIED; reverses 75c

The owner: the admin moves to its own web address, so one sign-in can be shared safely across tabs and survive closing Chrome. Since M6 the admin lived under `/admin/` of the public map's origin and, for the risk of §73a, kept Firebase Auth in each tab's `sessionStorage`: the owner signed in again in every tab and every notification link.

- **210a The site**: a second Firebase Hosting site of the same project, `<project>-admin` (`adminSiteId` of `@hcm/shared`: the project id's first 24 characters when longer, so the id stays within 30; the worker's twin `admin_site_id`), `https://bucurestiul-disparut-admin.web.app/admin/` for this map. The admin keeps its `/admin/` folder there, so the Vite base, the push worker's scope, the bundle's path and every hash route are unchanged. Provision's new item `admin-site` makes it with the owner's token in the same consent as **Update the map** (`firebasehosting.sites.create`), then adds its two host names to Firebase Auth's authorised domains (Identity Toolkit `projects.updateConfig`, mask `authorizedDomains`, every other domain kept), only once Hosting finds the site among the project's own. `PROVISION_SET_VERSION` 5: `admin-site`, `app-check` (the reCAPTCHA key's domains), `api-key` (the browser key's referrers) and `bucket-cors` (the admin's origins) run on the next Update the map. An id another project holds is refused in words (`adminSetup.provision.adminSiteTaken`, with the fix) and the admin stays where it is.
- **210b The deploy**: the site build's `hosting` step is now `steps/deploy-hosting.mjs`: when Hosting finds `<project>-admin` among the project's own sites (the installer's `roles/firebasehosting.admin` reads it; another project's answers 404 or 403), the tree is split (`scripts/site/src/hosting/admin-site.ts`): `public/admin/` moves to `public-admin/admin/` with `release.json` (Setup's release check reads it on the admin's origin) and a `runtime.json` naming `adminOrigin`; `firebase.json` gains a second `hosting` entry (the admin's `/admin/**` rewrite and headers, its CSP among them, `/` to `/admin/`); one `firebase deploy --only hosting` releases both, and the admin's site keeps its last 10 releases too. Without the site the tree deploys as before. `ship.sh` runs the same split (`npm run split:admin-site`) when the site exists and deploys both sites.
- **210c Old links**: the public map's `/admin` and `/admin/…` answer 301 to the same path on the admin's site; a browser keeps the address's `#/route` across a redirect, so bookmarks, e-mails, invitations and notifications already sent land on the same screen. One file stays: `/admin/starter.json`, which a Linux starter installed before this release reads with `curl` and no `-L` (the forward is an RE2 pattern of every path but that one: Hosting's regex has no lookahead).
- **210d The sign-in**: the admin uses `[indexedDBLocalPersistence, browserLocalPersistence]` only when `runtime.json`'s `adminOrigin` is the page's own origin (`packages/admin/src/app/admin-site.ts`); anywhere else (the public map's `/admin/`, a self-hosted copy, a starter-kit city, a project whose site could not be made) it keeps §73a's `sessionStorage`. **The risk of §73a is gone on the admin's site**: no page of the public map is served from that origin, and two origins share no storage, so a viewer script cannot read the owner's refresh token (S-A160-BAD-VIEWER-READS-NOTHING keeps the intent of S-A58-BAD-VIEWER-READS-NO-SIGN-IN across the two origins).
- **210e Addresses**: the functions' `adminOrigins` gain the admin site's two (the crash endpoint, the admin's Mapbox token); `ops.tick`'s `tokens` step re-mints the admin's Mapbox token when its recorded addresses differ (`functions/src/ops/admin-token.ts`). Links (`adminUrl`: invitations, the inbox, push, the manifest's Contribute link) name the admin's site once `HCM_ADMIN_SITE` names it; a server build sets it (the `fetch` step writes it into `functions/dist/.env`) only when submitted by an admin served from that site, which proves the site is the project's. Until then links keep the public map's `/admin/`, which forwards: a link never names a site the project was not seen to own. The worker's CORS and Private Network Access allow-list adds the admin site's origins; `hostingOrigins()` (where the admin may install from) too. The admin's links to the public map (a city's address, Contribute's welcome) are built from the admin's own origin, so the admin's site answers `/<city id>/` with a 301 to the same address on the public map (an RE2 pattern of every city id but `admin`): no admin code changed for them.
- **210f Unchanged on purpose**: the M14 start page hands a new owner to `https://<project>.web.app/admin/` (a new project has no admin site until its first Update the map; the address forwards afterwards), `create-historic-city`'s self-host deploys one site (the fallback), the admin has no web app manifest to move (its CSP's `manifest-src 'self'` only). `authDomain` stays `<project>.firebaseapp.com` (the popup sign-in works across sites; the redirect flow is not used).
- **210g A tab on the old address** (the live finding of 2026-11-13): its install build named the bundle on the public map's `/admin/`, which now answers 301, and `fetch`'s `redirect: 'error'` stopped it. The step follows one redirect, only to the project's admin site (`HCM_REDIRECT_ORIGIN`), and such a tab refuses to submit and names the new address (`apiError.install.adminOutdated` with that address: a reload lands there; lesson 675). Restored under §215's 770 KB total.
- **Verify**: S-A160-HAPPY-ONE-SIGN-IN, S-A160-BAD-VIEWER-READS-NOTHING, S-A160-BAD-NO-ADMIN-SITE, S-A160-HAPPY-OLD-LINK-FORWARDS, S-A160-BAD-NOT-FORWARDED, S-A160-HAPPY-ADMIN-TOKEN, S-A160-BAD-ADMIN-TOKEN-REFUSED; Vitest `scripts/site/test/hosting-admin-site.test.ts`, `scripts/site/test/install-deploy-hosting.test.ts`, `packages/admin/test/provision/admin-site.test.ts`, `packages/admin/test/app/admin-site.test.ts`, `packages/admin/test/firebase/app.test.ts`, `functions/test/deps.test.ts`; pytest `pipeline/tests/unit/test_worker_args.py`.

## 216. Household computers: the list, one line for a computer without a screen, removal that cleans up first, the governor across computers (W5, the owner 2026-11-13, beta.1) — APPLIED (increments 1 to 3), one chunk added (worker-household, 9 KB)

The owner: "Make it easy for users to use not only their own computer but also the other computers in their household, with minimum input from them. What we did here today for us must be available to our users." Then: "install all dependencies automatically" and "clean up first, disconnect second, and the user never has to run a command." `docs/research/M7-local-worker.md` → *Household computers*; behaviour A143.

- **216a The list** of the city's computers in the worker's panel (a lazy chunk `worker-household`, a new row of 9 KB in `scripts/ci/check_bundle_budget.py` (7.4 KB measured); no existing row raised), with Rename, Pause, Resume and Remove through one new callable `worker.manage` (`cityEditor`, fn-admin). The worker documents gain `name`, `host`, `os`, `starter`, `share`, `pausedAt`, `removal`.
- **216b A computer without a screen joins with one pasted line** that carries a 45-minute one-use code (`worker.pairCode {household: true}`) on standard input; the starter posts it to its own worker's `/pair`. Chosen over a device code the owner types back (two transfers, and the device-code phishing path) and over the tunnel used by hand (it exposed a port and needed the laptop's worker stopped). Threat model: M7 §10.23–§10.27.
- **216c Docker on Linux** from the distribution's own signed packages with one sudo, the disk checked first, linger where there is no screen. No Docker Desktop anywhere (its licence and size).
- **216d Removal through the claim channel**: asked in the admin, answered to the worker's next claim, accepted by the worker (exit 76–79), cleaned by its starter, then `done` from the worker's last run, and only then the server disconnects it; Disconnect now anyway and the manual line only as the last resort. Docker or WSL only by the helper's install note and when ticked.
- **216d2 On the computer itself**: the worker's page (`http://localhost:8765/`) has **Stop using this computer** (its own CSRF token, a confirm): the loop ends with the removal's exit code and the starter cleans up as for an order from the admin; a worker with no cleaning starter answers 409 `no-starter` and the page says the two Docker commands.
- **216e The governor across computers**: a claim says the governor's share; a computer held back for its person yields to a calm one, and takes the job when none is calm.
- **216f Windows (increment 2)**: without Docker Desktop, the starter turns WSL on (one permission prompt, a RunOnce resume after the restart), installs its own Ubuntu (`--name hcm-worker`) and Docker Engine from Docker's apt repository (key by fingerprint, version pinned and held), keeps that Linux awake from the supervisor (a hidden `sleep infinity`; no VBS, no administrator), lists itself in Settings > Apps, takes `HCM_PAIR_CODE`, and cleans itself up on the admin's order. Chosen over Docker Desktop (its licence and 4+ GB). Structure-tested only (no PowerShell in the image): UNVERIFIED until the first real Windows computer.
- **216g macOS (increment 3)**: Colima with Homebrew (checked bottles), Rosetta on Apple silicon, kept by Homebrew's launchd agent, removed only by the helper's note; without Homebrew the helper explains and links rather than running Homebrew's installer script. Homebrew's versions are not pinned by us (Homebrew pins and checks its own bottles): a deliberate exception to "pin versions". Chosen over Docker Desktop (licence and size) and over Lima alone (Colima packages the Docker runtime and its socket). Until then a Windows or Mac computer joins with a screen, and Remove on it says it cannot clean itself up (Disconnect now anyway, then the line).
- **Verify**: S-A143-HAPPY-LIST, S-A143-HAPPY-MANAGE, S-A143-BAD-MANAGE-REMOVED, S-A143-HAPPY-HEADLESS-PAIR, S-A143-BAD-HEADLESS-EXPIRED, S-A143-BAD-HEADLESS-WRONG-CITY, S-A143-HAPPY-INSTALL-DOCKER, S-A143-BAD-INSTALL-DOCKER, S-A143-HAPPY-GOVERNOR, S-A143-BAD-GOVERNOR-ALONE, S-A143-BAD-PAUSED, S-A143-HAPPY-REMOVE, S-A143-HAPPY-REMOVE-OFFLINE, S-A143-BAD-REMOVE-FORCED, S-A143-BAD-REMOVE-NO-STARTER, S-A143-BAD-REMOVE-DOCKER.

## 217. A stitched film waits for the computer that holds it (live report of 2026-11-13, the 1968 Corona F026) — APPLIED

`stitch`'s segments stay on the computer that stitched the frame; a later `georef` on another worker failed "film no longer
stored". Now every claim names the films its work folder holds, a worker without the film hands the job back unspent
(`waitReason: 'film-copy'`), and only a holder claims it; when no worker of the city holds it (disconnected, unseen 14 days or none),
the job fails `filmMissing` with Locate again. The film is not copied through the bucket (only the busy-or-idle holder could send
13 GB; an idle holder runs the job instead). M20 §21. No gate, rule or threshold relaxed.

## 208. The harvest stores as it goes and resumes; Landsat 8 and 9 OLI; Landsat to the current year; Landsat on the workers (track/landsatfix, the owner 2026-11-13) — APPLIED

The investigation of 2026-11-13: no Landsat over Bucharest, because the harvest was all or nothing and died past the callable's 540 s (`LESSONS.md` 676).

- **208a Budgets.** No page after `SEARCH_BUDGET_MS` (300 s, was 360 s); each `scene-search` request its own `AbortController` timeout, at most `PAGE_TIMEOUT_MS` (60 s, the adapters' default stays 20 s) and never past `PAGES_BUDGET_MS` (360 s); the run done by `RUN_BUDGET_MS` (420 s): re-ranking, the browse prefetch and the date plan are skipped past it and done by the next run. A timed-out request is `unavailable` with the reason `TIMED_OUT`, so the harvest records `requestTimedOut` rather than a USGS failure.
- **208a′ USGS's rate limit** (live, 2026-11-13, the first run of this fix): six datasets and the dataset ids at once were all refused `RATE_LIMIT` within 4 s. The datasets are now searched two at a time (`DATASET_CONCURRENCY`), the dataset ids first, and a page refused for too many requests is asked again after 5, 10 and 15 s while the run has time; a dataset USGS still refuses says "USGS turned it away", not "too slow".
- **208a″ Memory**: the same live run stored 258 Landsat 8-9 scenes, then the browse prefetch (five copies at once, each decoded to estimate its clouds) took the callable past 256 MiB and it was stopped; the record stayed `running` and the next run resumes the rest, as designed. The prefetch now copies one at a time.
- **208b Stored as it goes.** Each dataset is written as soon as its own search ends; the run keeps only the written ids and the 20 best frames for the browse copy (`StoreTally`), not every document.
- **208c Recorded as it goes, resumed.** `ops/harvest-{city}` gains `running` and `partial` outcomes, `datasets` (each one's state, count, reason, error and `next` cursor) and `finishedAt`. A `partial` run is due again after `HARVEST_RESUME_MINUTES` (15), doubled after each further one (a month at most); the next whole-harvest run searches only the unfinished datasets from their cursors and keeps the finished ones' parts. A run still `running` `HARVEST_KILLED_AFTER_MS` (10 min) after its start was stopped by the server: logged `harvest.killed` as an error (Error Reporting reads it), counted, resumed. A dataset USGS refused (maintenance) is now `partial` too, so it is retried within the hour instead of a month later. Admins already read `ops/harvest-{city}`; the rules are unchanged.
- **208d The admin.** `imagery.search` answers `datasets`; Historical imagery shows each dataset's part live from `ops/harvest-{city}` and from the answer, in plain words (what it kept, that the rest comes by itself in 15 minutes, or Search USGS again). The function logs carry `reasonCode` (`harvest.done`, `harvest.outOfTime`, `harvest.requestTimedOut`, `harvest.usgsFailed`, `harvest.tailSkipped`, `harvest.killed`); the admin has no analytics port in its content services, so no new GA4 event was added.
- **208e Landsat 8 and 9 OLI** (`landsat_ot_c2_l1`, sensors `L8-OLI` and `L9-OLI`, 15 m, z8–z14): searched like TM and ETM+ (summer months, the cloud cap), the true colour from B4, B3, B2 and Brovey with B8 in the pipeline; the enums' twins (`SENSOR_SPECS`, `contract.py`, `enums.json`) follow. `archive/model.py` holds no dataset or sensor list, so it did not change. Whether the owner's M2M account may download OLI is proved only by the first real download (the ERS dataset access page grants it).
- **208f Default Landsat years 1984 to the current year** (was 2000): `landsatTo` absent means "up to this year" (`landsatYearsOf(settings, thisYear)`); Settings shows it empty; a city that set an end keeps it.
- **208g The pace.** While the city's workers are online (seen within `WORKER_FRESH_SECONDS`), the tick starts one Landsat import per online worker, at most `LANDSAT_AUTO_MAX_PER_TICK` (4), each `runOn: 'local'` (the daily cap never counts a job on the computer; the budget guard still refuses); with none online, one a tick in the cloud within the daily cap, as before. Still one clear summer scene per year.
- **Verify**: S-A11-BAD-REQUEST-TIMED-OUT, S-A11-BAD-HARVEST-PARTIAL-STORED, S-A11-HAPPY-HARVEST-RESUME, S-A11-BAD-HARVEST-KILLED, S-A130-HAPPY-OLI, S-A130-BAD-OLI-UNKNOWN, S-A130-HAPPY-WORKERS-PACE, S-A130-BAD-NO-WORKER-PACE, S-P30-HAPPY-OLI, S-P30-BAD-OLI-MISSING-BAND.

## 218. The viewer in sixteen languages, each fetched when first shown (track/langs, 2026-11-09) — APPLIED, no budget raised

- **218a What.** The owner's decision: the public viewer speaks `ro` (the default and the source), `en`, `es`, `fr`, `de`, `it`, `pt`, `ru`, `uk`, `pl`, `tr`, `ar` (right to left), `hi`, `zh`, `ja` and `ko`, every translation Claude's. `VIEWER_LOCALES` and `ViewerLocale` of `@hcm/shared` are the viewer's; `Locale` (`ro | en`) stays the admin's and a city's own texts' (`{ro, en}`), so the admin's 127 files that index `{ro, en}` by it are unchanged (the design's `AdminLocale` turned round: the same split, fewer changes). Each language is `packages/shared/src/i18n/<locale>.ts` (and `map-labels/<locale>.ts`), typed against `ro.ts`; `VIEWER_CATALOGUES` (`viewer-catalogues.ts`) holds them all, the main family and the map labels merged, for the build and the tests.
- **218b Out of the bundle.** The engine's build (`scripts/site/src/i18n-catalogues.ts`, `i18nCataloguesPlugin`) resolves `i18n/ro.ts`, `i18n/en.ts` and their `map-labels/` to an empty stand-in (the precedent of §100a and §120a) and writes `dist/i18n/<locale>.json` (`{engine, locale, messages}`, keys sorted, about 3.5 KB gzip each). The engine fetches a language when first shown (`packages/engine/src/core/catalogues.ts`, through the manifest's request: its timeout and its two retries), takes it only when it names `ENGINE_VERSION` and that language and every value is a text, and registers it; the store commits the language only then, the latest choice winning (`setLocale`), and the boot fetches the first language beside the manifest. A language that cannot be fetched leaves the page as it was with `language.unavailable`; at boot Romanian, saying so; with no language at all, the engine's one bilingual card (Romanian and English, each with its `lang`, a Retry that reloads), `hcm-error` still reporting the boot's own error. `@hcm/shared` keeps importing `ro` and `en`, so the admin, the start page, the functions and the tests are unchanged and synchronous. §127a's packing went with it (`catalogue-pack.ts` deleted: nothing left to pack).
- **218c No SRI on the fetch.** The files come from the same version-pinned folder as the SRI-checked engine (immutable on jsDelivr), as its fonts do (a `FontFace` cannot carry SRI either), and every value is rendered as text, never HTML. The release lists them in `release.json` with their sha384 like every file (`scripts/release/src/cdn.ts` walks the whole build); embedding sixteen digests in the bundle would cost about 0.8 KB of incompressible bytes. **For review.**
- **218d The CSP.** `contentSecurityPolicy` names the engine's folder in `connect-src` too, and the release check requires it of the kit (`CSP_FOLDER_DIRECTIVES`); the committed kit page (pinned to v1.0.0, which bundles its two languages) gained it by hand so the check holds until the next pin. Hosting and the city sites serve the engine from `'self'`, already allowed.
- **218e Where the list is.** The menu's Settings (Setări, the dialog's `settings` mode since the merge of track/settings) lists the sixteen by their own names (`LANGUAGE_NAMES`, each with its `lang`, in the root collation's order, Latin first, so the list never reorders); the kit's segmented button stacks them into one column. The list is controlled: it shows the page's language until the store has switched, so a language that fails never stays checked. The merge with feat/engine-rewrite (2026-11-09) took track/settings' menu item and dialog and kept this list in it; this section was §128 on track/langs, its lessons 506 to 511 became 541 to 546.
- **218f Right to left.** `dir` follows the language on the viewer and on `<html>`; the CSS was logical already; the map's container and the mirrored attribution stay left to right (Mapbox's terms; two links set side by side by the bidi reorder failed axe's target size); `hcm-icon` mirrors `chevron_*` and `arrow_*`; the slider, the segmented button, the toolbar and the lightbox read their keys through `logicalKey` (the timeline already did); `translate` isolates each value in Arabic (U+2068 … U+2069). Dates use `intlTag` (`ar-u-nu-latn`: Latin digits, as the timeline's years).
- **218g City texts and fonts.** A city's text shows in the visitor's language when the city has it, else in English, else in Romanian (`localized`, one rule for the engine and the viewer), the element carrying the `lang` it is in and a note (`content.fallback`) under a photo's, a place's and About's texts. Cyrillic is Roboto Flex's `cyrillic` subset (15.6 KB, fetched only when drawn); Arabic, Devanagari and the CJK scripts use the system's fonts (`system-ui, sans-serif`): no font of theirs is small enough to ship, and no font CDN is allowed (GDPR).
- **218h The gate.** `check_i18n.py` reads sixteen catalogues in the viewer's two folders and checks what a translation gets wrong: the six plural forms (`photos.count.zero` … `.other`, looked up by `Intl.PluralRules`), no brace outside a `{word}` placeholder, no whitespace at either end, no bidi control, no English left (`COGNATES` lists the words two languages spell alike, as French's "Menu"), 80 % of the letters in the catalogue's script, Romanian's comma below.
- **218i Size.** Measured on the NUC the gate's way (gzip 9, `mtime=0`): the IIFE 124,764 → about 121,100 bytes of 125,000 (the catalogues out, about 4.8 KB; the loader, the bilingual card, the endonyms, the Cyrillic face and the right-to-left handling back in), the ES module 96,757 → about 93,000. No budget raised; the exact figures are in the commit.
- **218j Not built here, for the owner.** The manifest's `city.languages` (the languages a city offers, and taking the browser's on a first visit, `fromBrowser`), the data schema's optional keys for other languages, the admin's editor for both, the kit page's `lang` beyond `ro` and `en`, `hreflang` links, and a stylelint rule against physical properties. To confirm: Brazilian Portuguese, neutral Spanish, Latin digits in Arabic, the timeline mirroring right to left, the formal register every catalogue uses. The basemap's labels per language and Arabic's shaping on a real map are `docs/MANUAL_TEST_PLAN.md` V8b (whether Mapbox needs its RTL text plugin).
- **218k Rejected.** Bundling Romanian (about 2.4 KB gzip the loader then could not pay for); a loading indicator on the chosen row (a fetch takes a moment; the snackbar says when it fails); prefetching other languages; keeping the menu's one-tap switch to the other language (sixteen do not toggle).

## 219. Every UI text in 25 languages: one list, files fetched when chosen, English per missing key (track/langs25, 2026-11-12) — APPLIED, no budget raised

- **219a What.** The owner's request: every text of the viewer, the admin, the Setup Assistant, the start page and the API's errors in `ro en fr de es it pt pl ru uk tr ja zh ko ar hi nl hu id vi bn bg el fa ur`, with a language switch everywhere; `ar`, `fa`, `ur` right to left. `UI_LOCALES` of `packages/shared/src/i18n/locales.ts` is the one list (names, direction, the pickers' order); `check_i18n.py` holds a copy a test keeps equal. `docs/I18N.md` is the user-facing description.
- **219b Two locale types.** `UiLocale` (25) is the interface's language; `Locale` (`ro | en`) stays the language of a city's own texts, which the admin edits in two (`contentLocale`: Romanian for Romanian, English for any other). The admin's and the start page's state, every translator (`catalogueTranslator`, `translateApiError`, `translate`, `pluralOf`) and the UI's `locale` properties take `UiLocale`; a city text indexed by the admin's language goes through `contentLocale` (the Contribute page's date text, the review's `dateLocale`, push registration's `lang`, the inbox's parameters). The assists' `from`/`to` stay `Locale`.
- **219c Out of every bundle.** Romanian and English stay bundled. The admin's and the start page's builds write every family of each other language to `i18n/<locale>.json` (`scripts/site/src/ui-catalogues.ts`, read from the catalogue files as text in the gate's one-entry-per-line shape, not imported), next to the module: `/admin/i18n/` on Hosting, the start site's folder (`scripts/site/src/start/tree.ts` copies them). The page fetches a file when the language is chosen (`packages/admin/src/state/ui-language.ts`), registers it and only then switches; a first language from the address, the stored choice or the browser shows English until it arrives. A file that cannot be fetched keeps the language with a notice (`adminShell.language.unavailable`, `start.languageUnavailable`). Measured: the start page 69.0 → 70.4 KB of 72 (the list and the loader), the IIFE 122.2 of 125, the admin's entry 394.9 of 450, its total 689.9 of 700. The registry of fetched files is a module of its own (`registry.ts`): with the fallback inside `i18n/index.ts` the start page bundled the viewer's main catalogue and measured 75.9 KB.
- **219d Fallback.** A key a language lacks shows in English (`uiText`), logged once per language and page. The viewer keeps its rule: a viewer language whose file has not arrived shows no text, not English. A language with no translation at all shows English with its own `lang` and `dir` (the admin's choice is the reader's language; the text arrives as the model writes it).
- **219e Pickers.** The admin's account menu lists the 25 (`UI_LANGUAGE_OPTIONS`, the viewer's segmented list, by endonym in the root collation's order), controlled by the outcome as the viewer's (lesson 681); the Setup Assistant is a page of the same shell. The start page's two buttons became a native list in its header (cheaper than the kit's segmented button in its 72 KB). The viewer keeps its sixteen in Settings and in the URL; the nine other languages join `VIEWER_LOCALES` once their viewer catalogues are complete.
- **219f Right to left.** The kit's CSS was logical; two motions were not: the side sheet's entrance and the indeterminate linear progress now mirror under `:dir(rtl)`. The tour visits the admin in Arabic (`admin.shell.language-rtl`) and the start page in Urdu (`admin.start.language-rtl`); their leak check reads the page as English, since the texts not translated yet are English by design.
- **219g The gate.** `check_i18n.py`: `ro` and `en` unchanged and strict; any other language's file is optional and checked for shape (no unknown key, the same placeholders, no brace outside one, no edge whitespace, no bidi control, no HTML tag the source lacks); a per-language completeness report once a translation is under way; `--strict` / `HCM_I18N_STRICT=1` for the owner once complete. A translation's entry that Prettier wraps after its key is read as one (French runs longer than 140 columns); `ro` and `en` stay one line per entry.
- **219h Import.** `scripts/i18n/import_translations.py` (its body `scripts/ci/import_translations.py`, where ruff, mypy, radon, bandit and coverage see it) imports a model's `<folder>/<locale>.ts` files: each entry checked with the gate's own rules, the passing ones merged into the catalogue in the source's order, the rest listed; the viewer's own sixteen are never overwritten. First run: the 13 French families written so far, 1,463 texts, 93 refused (all keys of `admin-georef` the model's older source had in `admin-imagery`).
- **219i Not done here.** The viewer's nine further languages (their catalogues are a translation task, then one line in `VIEWER_LOCALES`); the functions' own texts (push notifications and the welcome mail stay Romanian and English: their language is the device's registration, `lang: Locale`); a city's texts in more than two languages in the admin's editors; marking each English fallback with `lang="en"` (WCAG 3.1.2), which needs every text to carry its language out of the translators.
- **219j Verify.** `packages/shared/test/i18n-ui-locales.test.ts`, `packages/admin/test/state/ui-language.test.ts`, `packages/admin/test/app/language.test.ts`, `packages/admin/test/state/translations.test.ts`, `packages/admin/test/start/controller.test.ts`, `packages/ui/test/start/hcm-start-page.test.ts`, `packages/ui/test/admin/shell/nav-and-menu.test.ts`, `scripts/site/test/ui-catalogues.test.ts`, `scripts/ci/tests/test_check_i18n.py`, `scripts/ci/tests/test_import_translations.py`; e2e `S-A95-*`, `S-A76-HAPPY-LANGUAGE-PICKER`, `S-A76-BAD-LANGUAGE-UNAVAILABLE`.

## 220. The 25 languages after review: the viewer speaks all of them, strict adds and never drops, the latest choice wins (track/langs25, 2026-11-12) — APPLIED, no budget raised

- **220a The viewer speaks the 25.** Supersedes 160e and 160i's first item: `VIEWER_LOCALES` is `UI_LOCALES` and `LANGUAGE_NAMES` is derived from `UI_LANGUAGE_NAMES` in `UI_LOCALES_BY_NAME`'s order, so `locales.ts` holds the one list and the one table of names (`check_i18n.py`'s mirror stays under its equality test). The nine languages not translated for the viewer (`nl hu id vi bn bg el fa ur`) have an empty catalogue in each viewer folder (`= {};`, filled by the importer); the engine's build marks a language lacking a key of Romanian with `"fallback": "en"` in its `i18n/<locale>.json`, and the engine then fetches English too before switching, so each missing key shows in English as the admin's do. A file that is complete costs nothing more. Measured: `engine.iife.js` within its budget (the build's check passed); the nine files are data.
- **220b Strict adds, never drops.** `--strict` / `HCM_I18N_STRICT=1` now keeps every check of the default mode and only adds completeness: the viewer's checks run on a viewer folder whatever languages it requires, and the shape checks (HTML tags, braces, edge whitespace, bidi controls) run on every language but `ro` and `en`, required or not; a strict run with a missing file still checks the files that are there. `test_bad_path_strict_rejects_everything_the_default_mode_rejects` pins it. In the viewer's folders a language being translated is also checked for text left in English and its script's share, not yet for all six plural forms.
- **220c The latest choice wins.** As the viewer's `LocaleSwitch` (§195b): the admin (`adminLanguage`: the boot's `start` and the menu's `choose`) and the start page share one switch per page (`latestLanguage`), and a language whose file arrives after a later choice is neither shown, stored nor reported.
- **220d English says it is English.** Supersedes 160f's leak check and 160i's last item: the admin's page area carries `lang="en"` until the language's file holds the page's family (by its key prefix, `familyLanguage`), the navigation labels, the page's title, the signed-in line and Sign out carry their own text's language (`textLanguage`), the start page's `<main>`, title and language label carry `en` until a file holds `start.*`. The tour's right-to-left states are read as Arabic and Urdu; the leak check counts English as a language's own text for each key its catalogue lacks and skips what is marked. Not marked: a single English text inside a translated family, and the viewer's (both shrink with each import; the gate reports completeness).
- **220e Bidi isolation everywhere.** `fillPlaceholders(text, params, locale)` isolates each value in a right-to-left language for every family's translator and the API's errors, as the viewer's `translate` did alone.
- **220f The importer re-checks.** Entries already imported are checked again against today's Romanian: a stale one (gone key, changed placeholders) is dropped and listed; a new text for an existing key counts as replaced.
- **220g The start page remembers in `localStorage`.** `hcm:start:lang` outlives the tab, as the admin's `hcm:admin:lang`; the run's plan and consent state stay in the session.
- **220h Not done here.** `packages/admin/dist/review-*.js` measures 5,024 bytes gzip against its 5 KB budget with and without this change (the same size at `dd4dc4d1`): a finding of its own, not raised.
- **220i Verify.** `packages/shared/test/i18n-ui-locales.test.ts`, `packages/shared/test/i18n-viewer.test.ts`, `packages/engine/test/core/catalogues.test.ts`, `scripts/site/test/i18n-catalogues.test.ts`, `packages/admin/test/app/language.test.ts`, `packages/admin/test/start/controller.test.ts`, `packages/ui/test/admin/shell/shell.test.ts`, `packages/ui/test/start/hcm-start-page.test.ts`, `scripts/ci/tests/test_check_i18n.py`, `scripts/ci/tests/test_import_translations.py`; e2e `S-V11-HAPPY-TRANSLATING-FALLS-BACK`, `S-V11-BAD-MISSING-KEY-FALLS-BACK`, `S-A95-HAPPY-LANGUAGE-PICKER`, `S-A76-HAPPY-LANGUAGE-PICKER`. The leak check now follows `lang` through shadow hosts (lesson 690), and the start page footer marks its Romanian link texts `lang="ro"`.

## 221. Translations are imported only after local QA; the pre-QA French awaits the owner (track/langs25, 2026-11-12) — APPLIED, the question closed (2026-11-14)

- **221a QA before import, no exceptions** (the owner, 2026-11-12). `scripts/i18n/import_translations.py` imports a `<folder>/<locale>.ts` only beside a `<locale>.ts.qa.json` whose `status` is `pass`, whose policy starts with `validators+back-translation/` and whose `fileSha256` matches the file, and only the entries the report passed with that very text (docs/I18N.md → Importing translations). The policy is matched by prefix so a later version of the same checks (`/v2`) needs no change here.
- **221b The first QA'd import.** `admin-georef` and `start` in `fr`, `ar` and `ja`: 565 texts, none refused, the strings QA held left out (they show in English). `map-labels` in the same three was skipped: they are among the viewer's sixteen complete languages, never overwritten.
- **221c Closed (the owner, 2026-11-14): the pre-QA French stays until the QA'd files replace it.** The French imported before the rule. The 13 French families of §196h (1,463 texts) have no QA report. They are kept, because removing them leaves `S-A95-HAPPY-LANGUAGE-PICKER` and `S-A95-BAD-MISSING-KEY-FALLS-BACK` reading English for French, and each entry is replaced when its family's QA'd file is imported. Entries the QA'd file holds back stay as they were; the owner decides whether to clear the 13 files (`admin-archive`, `admin-cities`, `admin-content`, `admin-export`, `admin-imagery`, `admin-install`, `admin-layers`, `admin-notify`, `admin-ops`, `admin-orders`, `admin-photos`, `admin-pois`, `admin-review`) before the release, in which case the S-A95 rows need a French file they can read (the start page's or `admin-georef`'s). **Outcome:** the owner keeps the 13 files; each family's entries are replaced as its QA'd file is imported, and nothing is cleared before the release.
- **221d Verify.** `python3 scripts/ci/check_i18n.py` (fr 65 %, ar 13 %, ja 13 %), `packages/shared/test/i18n-ui-locales.test.ts`, the admin's build writing `dist/i18n/ar.json` with 379 texts; the bundle budget unchanged but for §197h's `review-*.js`.
- **221e The merge queue's held strings** (2026-11-13). Wait in their catalogues for the second judge on the 5090, and the queue's branch is not merged into `feat/engine-rewrite` before they pass (`hcm-wt/i18n-out/pending-mergequeue.txt`, 142): the queue's viewer strings the laptop's judge doubted (98); five of the compass's 56 that origin's merge e201aafd added (`viewer.compass` in es, it, pt, ru; `viewer.compassTurned` in tr; the other 51 passed the validators and the back-translation, the Arabic after it said "rotated by" instead of a word read back as "managed"); and 39 of the 42 that the consoles' merge fa295332 added or changed (`error.webglConsole`, `input.padMove`, `input.padFocus`): the laptop's judge doubted 33, and the six of Japanese and Chinese did not run its QA, whose sentence count reads CJK's unspaced full stops as one sentence and whose retry needs the 5090. **Outcome** (2026-11-13, after the merge of origin a542b827): the QA ran again on all 14 complete viewer catalogues (200 strings each, the reboot having taken the earlier results): 2,790 passed outright or after a correction, 27 held strings rewritten with the glossary and QA'd again (among them `about.engine` in hi and ja, which had lost "Maker"; the new `timeline.dates` and `timeline.datesHint`), the four CJK pad hints passed once the sentence counter read `。` (lesson 693). The owner approved one string (2026-11-13): zh `layers.attribution.landsat`, "Landsat 历史影像由 NASA Goddard Space Flight Center 和 U.S. Geological Survey 提供", where the glossary's 历史影像 for "imagery" and the second judge (who called 历史 an addition) disagreed; the glossary term matches the passed USGS line (解密历史影像), and the QA report marks it `ownerApproved`.
- **The merge** (2026-11-13, track/mergequeue): langs25 numbered §159 to §162 and lessons 577 to 590; §218 to §221 and lessons 677 to 692 since (renumbered after origin's §217 and lesson 676, merged at 0cd8e7fa). The viewer's 17 keys added on `feat/engine-rewrite` since the track branched (the extras' `error.extraLoad`, the credits, the full-size view's zoom, the map's menu, the photo versions) were written by Claude into the 14 other complete catalogues, and `timeline.empty` / `layers.empty` follow §185 (no layers "soon") in them; not yet back-translated by the local QA (`docs/I18N.md`), for the owner's review. `hello.*`, `layers.kind.*` and `adminContent.georef.reference.label`, gone from ro and en, left every other file; 14 translations whose source lost a placeholder in §184 (the copy gate) were dropped, so those keys show in English until the next import. `photoVersion.original` joined the i18n gate's cognates for ro, es, de and pt (the same word).

## 222. Follow my device is the default: the theme's mode and the device's accent colour, in the viewer and the admin (track/osaccent, the owner 2026-11-13) — APPLIED; two admin budgets raised under §215

The owner: "make sure the feature to follow the OS accent colours (and others available) is the new default".

- **222a What was there.** Both apps already defaulted to the `system` mode (`prefers-color-scheme`), and every mode already followed `prefers-contrast: more` (the city's high-contrast scheme), `prefers-reduced-motion: reduce` (`REDUCED_MOTION_TOKENS`) and the browser's text size (the `rem` type scale); forced colours are handled per element (26 kit files, `e2e/a11y/forced-colors.spec.ts`). Nothing followed the accent colour. The mode's label is now **Follow my device** / **Ca dispozitivul** (was System / Automată), in all 16 complete viewer languages.
- **222b The accent: what browsers give.** CSS `AccentColor` (and `AccentColorText`): Firefox gives the system's accent; Chrome ships the keywords on desktop in 150 (Intent to Ship, blink-dev, April 2026) but scopes the real accent to installed web apps and the initial profile, a tab getting a constant blue (fingerprinting, csswg-drafts #10372); WebKit returns a constant; Android does not expose the system's dynamic colour to the web. A constant would paint every city one blue, so `readDeviceAccent` (`packages/ui/src/theme/device-accent.ts`) trusts `AccentColor` only in Gecko (`CSS.supports('-moz-appearance', 'none')`) or in Chromium (`navigator.userAgentData`) with an installed app's `display-mode`; anywhere else, with a grey accent (OKLCH chroma under 0.03), or under forced colours, the city's own colours show. A page may name the accent itself: `--hcm-device-accent` on its root wins (embedding sites; the e2e tests' emulation).
- **222c The tokens, no colour library.** `withAccent` turns every colour of the city's four schemes by the OKLCH hue angle from the city's light primary to the accent, keeps its chroma (reduced only to stay in sRGB) and finds its lightness again so that its WCAG relative luminance is the city's (bisection). Every contrast ratio of every scheme, the high-contrast ones included, is therefore the city's, within the rounding to `#rrggbb` (the unit test checks every `CONTRAST_PAIRS` pair of the four schemes for three accents within 0.15); `error*`, `shadow` and `scrim` keep their values. The alternative, `themeFromSeed` from the accent, would ship `@material/material-color-utilities` in the viewer (the engine has never carried it) and drop the city's own tones; the hue turn keeps the brand's tonality and its checked contrast.
- **222d The choice.** Viewer: Settings' **Colours** (`accent`: **Device accent** `device`, the default; **Map colours** `map`), stored per city as `hcm:<cityId>:accent` (`theme-choice.ts`, `setAccent`; no analytics event). Admin: the account menu's **Colours**, stored as `hcm:admin:accent` (`theme-prefs.ts`); Settings' live seed preview always shows the seed's own colours, so an owner picking a seed sees the seed. A user who chose Light or Dark before keeps it (the stored `theme`); nobody had an accent choice before, so everyone starts on Device accent.
- **222e Budgets.** The engine IIFE measures 110.8 of 150 KB gzip, the ES module 108.3 of 120: no engine budget moved. The admin's `settings` chunk measured 20.2 of 20 KB (it grew with the 25 languages' merge, not with this change) and the admin's total 764.6 of 760 KB (about 1.5 KB of it this change, in `admin-core`): `settings` 20 → 21 and `ADMIN_TOTAL_KB` 760 → 770 (`scripts/ci/check_bundle_budget.py`), under the owner's pre-approval of budget raises that block beta.1 (§215, and the task's brief for this track). After merging origin on 2026-11-14 two chunks this change does not touch went over too, and rose the same way: `worker` 8 → 9 (8.7 KB) and `approval-map` 5 → 6 (just over 5.0 KB).
- **222f The translations.** The 14 other complete viewer languages' four strings (`theme.system`, `accent.label`, `accent.device`, `accent.map`) were written by Claude and back-translated by the laptop's local model (qwen3.5:9b): it flagged pt "Cor de destaque", tr "vurgu rengi", ar "لون التمييز", zh "强调色" and ko "강조 색상" as "highlight"/"emphasis" colours, which are each platform's own word for the accent colour, kept; it rightly flagged the Italian (now "Colore d'accento del dispositivo"). For the owner's review with the next QA'd import (§221).
- **Verify**: S-V12-HAPPY-DEVICE-ACCENT, S-V12-BAD-NO-DEVICE-ACCENT, S-A21-HAPPY-DEVICE-ACCENT, S-A21-BAD-NO-DEVICE-ACCENT; `packages/ui/test/theme/device-accent.test.ts`, `packages/ui/test/viewer/viewer-theme.test.ts`, `packages/engine/test/core/theme-choice.test.ts`.

## 225. The map's sources and the app's platform in Setup (M28, the owner 2026-11-13, beta.1, priority 3) — APPLIED

`docs/research/M28-sources.md`. Two cards after Mapbox: **The app's platform** (e1, no input; Google Cloud, Firebase, Firestore, storage and processing, Mapbox, each with its role, costs, limits, sign-up help and state, read from steps b to e) and **The map's sources** (e2, one input: Save my choice). The owner's corrections of the same day are applied: the platform is not a source and is one card, not three (Mapbox, Firebase and Firestore were first to be separate steps, then grouped); the old step ids, deep links and funnel steps stay as they were, the card only links them; collections such as Facebook groups, Fortepan, Europeana and the US National Archives' air photos are drawn from by hand with an honest "may it go public" and "automatic import: planned or none"; uploaders keep the photo and data sources, the satellite ones stay with the owner and the editors.

- **225a Storage:** `cities/{city}.sources`, saved on its own as the imagery settings are (rules `validSources`; refused beside any other field). Per city, as Setup's `host.cityId`.
- **225b USGS left out:** with neither the declassified frames nor Landsat on, the USGS step leaves Setup's list and USGS is recorded as postponed through `setup.recordCloud`, so `setupDone` (server side) holds without it. Turning either on brings the step back as Later.
- **225c Defaults:** free and open on, paid off (`usgsOrders`, `cloudAi`). Not in `setupDone`: a map from before M28 stays done.
- **225d Figures:** only those the product already uses (Setup's Blaze line, the scan price, the AI cap, the free tiers of the install and worker cards); everything else links the provider's official pricing page; the estimate says the date checked (`SOURCES_CHECKED_ON`).
- **225e Not built (planned):** the harvest's dataset list on the server, the AI drafts refused when the cloud AI is off, the local matcher off, automatic imports from Commons, Europeana, Fortepan, Rumsey, the Library of Congress and Mapillary, and an uploader's own map or satellite image held for review.
- **225f The country finder (2026-11-14):** `countrySources/{country}`, written only by `ops.tick`'s new `sources` step (the 11th of `OPS_STEPS`), read by staff. Romania's list is curated (ten places, facts read on 2026-11-14); any other country is researched in Wikidata and marked unverified. A city is placed by one Nominatim reverse lookup a tick (the geocoder port gained `countryCode`); a list is refreshed every 30 days with each website checked. A visit's request is a filled-in email, never text to copy. A key box for an online source is not built: no verified Romanian source has a key the app could use.
- **225g Free translation (2026-11-14):** six cards with figures from the providers' own pages (a figure a page did not state is said to be unstated); the app does not translate through them yet, and the cards say so. `#/imagery/upload` now opens Imagery's Upload tab.
- **225h Budgets (under §215b):** the Platform and Sources cards with their catalogue now load as a chunk of their own (`sources-cards`, 34.7 KB measured, budget 42; `loadSourcesCards` in `hcm-setup-page.ts`), so the entry stays within its 450 KB (it measured 459.3 with them inside); the admin's total 805.7 KB → `ADMIN_TOTAL_KB` 770 → 820; `crashes` 5 → 6 (5.0 KB after the merge). The curated country lists left the admin's bundle for their own entry `@hcm/shared/country-seeds` (only `ops.tick`, the stack and the tests read them).
- **Verify:** S-A183-HAPPY-FINDER, S-A183-HAPPY-REFRESH, S-A183-BAD-REFRESH, S-A184-HAPPY-TRANSLATIONS, S-A180-HAPPY-SAVE-DEFAULTS, S-A180-HAPPY-RULES-SAVE, S-A180-BAD-RULES-SHAPE, S-A180-BAD-LANDSAT-OFF, S-A181-HAPPY-PLATFORM, and the planned rows of A180–A182 (unit-tested).

## 226. The map and the admin as installable apps, so Device accent works in Chrome and Edge (track/pwa2, the owner 2026-11-14) — APPLIED

The owner wanted "Follow my device"'s accent to actually work. Chrome and Edge (150 and later) give CSS `AccentColor` the device's colour only to an installed web app (`docs/LESSONS.md` 711), so each city site and the admin became installable (`docs/ENGINE_API.md` → *Installable app*). The paused `pwa` workflow (`wf_777559d6-45b`, `track/pwa`, 472 commits behind) was not merged: its cache-first shell and stale-while-revalidate `manifest.json` contradict lesson 707 (never serve stale app code or data), and its bucket-hosted manifests and functions-drawn icons needed a functions deploy. Its manifest builder, page script and specs were reused in a smaller design.

- **226a Network first, never stale.** The worker answers only the page and its own shell, network first, and keeps a copy for a visit offline; it never answers `manifest.json`, `runtime.json`, `release.json`, `admin.mjs`, `app.webmanifest`, photos, another folder or another origin (Mapbox, the bucket, Firebase, analytics). The admin's worker (its push worker) keeps and answers nothing. No update toast: there is never an old release to leave.
- **226b Icons drawn by the build.** `scripts/site/src/app-icons.ts` rasterises the tab icon's glyph into 192, 512 and maskable 512 PNGs in the site's theme colour (pure TypeScript and `node:zlib`, synchronous; no image library): no functions change, no deploy beyond Hosting. A city's uploaded tab icon is not used for the app icon yet.
- **226c Install app only when the browser offers it** (`beforeinstallprompt`, its banner prevented): the viewer's Settings and the admin's account menu, and the Device accent note on a computer's Chrome or Edge. Android's installed app is offered the install but not told it brings the accent: Android's dynamic colour does not reach a web page (lesson 711), unverified on a real installed app.
- **226d Not covered:** the generic `/city/` page and the starter kit (no manifest, no worker); iOS gets the `apple-touch-icon` only (Safari's Add to Home Screen, which gives no accent either).
- **226e Strings:** `app.title`, `app.install`, `app.installHint`, `accent.installFix` in the sixteen viewer languages (the fourteen beyond ro and en written by Claude, not yet back-translated by the local QA); `adminShell.account.installHint`, `adminShell.account.installFix` in ro and en.
- **Verify:** S-V72-HAPPY-INSTALLABLE, S-V72-BAD-NO-PROMPT, S-V72-BAD-NEVER-STALE, S-A185-HAPPY-INSTALLABLE, S-A185-BAD-NOTHING-KEPT; `packages/shared/test/kit/app-worker.test.ts`, `scripts/site/test/app.test.ts`.

## 229. Scanned maps shared while their computer works: a sharing thread, pre-seeding, a 20 GB daily cap (M20 §22, the owner 2026-11-14) — APPLIED

`docs/research/M20-import-local.md` §22. Eight series waited for the busy laptop that holds `harti.zip` while the PC and the NUC idled: §20 asked for a copy only with the holder's claim.

- **229a Channel:** the holder's own thread asks `worker.archiveCopy {kind: 'wanted', archives}` (no `jobId`, the request's `jobId` is now optional and required by every other kind), also while it runs a job; `progress` keeps `workers/{id}.sharing`. Its claims say `shares: true` and are never answered `copy`. A function deploy (Update the map), no new callable.
- **229b Pre-seeding:** with another computer seen in the last 10 minutes and not paused, the newest queued series not copied yet is shared before anyone hands it back; a handed-back series always goes first. One extra hand-back can happen when a computer claims a series whose copy is still under way (the manifest is written last); it spends no attempt.
- **229c The holder runs a waiting series itself:** a series waiting `archive-copy` is claimable by a worker whose claim names its archive (it was claimable by nobody), so a holder past its day's limit or too old to share still makes progress.
- **229d Budget:** the governor's profile sets the pace: nothing while paused, 1 MiB/s average while quiet, 8 MiB/s at full. Cost: 20 GB a computer a UTC day (`ARCHIVE_SHARE_DAY_BYTES`, about USD 2.4 of download); the budget guard red refuses; nothing is shared when no other computer could take it.
- **229e Not built:** the copy over the home network (a LAN endpoint on the holder): the bucket works across NAT and WSL and is verified end to end; the receiving computer's partial copy is kept for the series' later runs (counted in its folder's size).
- **Verify:** S-A120-HAPPY-ARCHIVE-SHARE, S-A120-BAD-ARCHIVE-SHARE, S-A120-BAD-ARCHIVE-SHARE-DAY, S-P20-HAPPY-ARCHIVE-SHARE, S-P20-BAD-ARCHIVE-SHARE-PAUSED, S-P20-BAD-ARCHIVE-SHARE-STOPPED, S-A143-HAPPY-SHARING, S-A143-BAD-SHARING-DAY-LIMIT, S-A143-BAD-SHARING-STALE.

## 230. Every pin on its latest stable release (deps bump, 2026-11-14) — APPLIED; mapbox-gl held

- **230a npm:** vite 8.3.8, vitest and `@vitest/*` 5.1.0 (lockstep: their lockfile entries deleted first), playwright and `@playwright/test` 1.65.1 (`playwright-core` deduped with `npm update`), eslint 10.15.0, typescript-eslint 8.72.2 (still peers `typescript <6.1.0`: the TypeScript hold stays), eslint-plugin-playwright 2.12.2, globals 17.14.0, prettier 3.10.1, stylelint 18.0.0 with stylelint-config-standard 41.0.0, html-validate 11.21.1, markdownlint-cli2 0.24.1, knip 6.45.1, dependency-cruiser 18.7.2, firebase-tools 15.36.0, firebase 13.3.0, firebase-admin 14.5.1, google-auth-library 11.3.4, material-symbols 0.49.0. The `@grpc/grpc-js` override's key follows `firebase` 13.3.0's firestore (`@firebase/firestore@4.20.0`, still `~1.9.0`): without it `npm audit` reported five high advisories. `npm audit --audit-level=low`: 0.
- **230b Hold `mapbox-gl@3.34.1` (3.35.0 out):** the released engine (`cdn/engine/release.json`) and the starter kit pin Mapbox GL JS 3.34.1 with its SRI, and the kit tests compute that SRI from this npm package; the engine's `MAPBOX_GL_VERSION`, the package and the kit move together with the next engine release. `HELD` entry plus `docs/CI_PIPELINE.md` → *Held dependencies*.
- **230c PyPI:** `scripts/ci/requirements.txt` (click, coverage, filelock, markdown-it-py, mypy_extensions, platformdirs, py-serializable, ruff 0.17.5, stevedore), `pipeline/requirements-poetry.txt` (anyio, dulwich, fastjsonschema, filelock, platformdirs, python-discovery, virtualenv), the pipeline's coverage 7.17.3, hypothesis 6.170.15, pikepdf 10.18.1 (`poetry lock`).
- **230d Images and actions (pre-approved: keeps the tools current):** `docker/dockerfile` 1.29.0, `sonarsource/sonar-scanner-cli` 12.4.0.4321_8.4.0 (CLI 8.4.0.16527), the `node:24-bookworm-slim` digest (Node 24.22.3, npm 11.19.1); workflows: sonarqube-scan-action v8.5.0, docker/login-action v4.8.0, codeql-action v4.39.3, action-junit-report v6.7.1, action-gh-release v3.0.4, each by full SHA.

## 231. The timeline's smaller gap, dots, scroll hint and start at the selected year (the owner 2026-11-14) — APPLIED; the narrowed tour check kept by the owner

- **231a The years:** `YEAR_GAP_PX` 56 → 40 px, fixed at every size and both ways; lying, a 6 px dot per year on the rail, the selected year's 10 px primary dot on the pill's lower edge; labels 13 px lying, 14 px (M3 label large) standing or compact; a lying label that would come within 4 px of its neighbour's is left out (`crowdedLabels`; today's kept), the chip names that year. Four-digit years always fit at 40 px.
- **231b The scroll hint:** each edge with years beyond it fades (56 px) under a 48 px button that pages that way and names the furthest hidden year (`timeline.earlier` / `timeline.later` in the 16 full viewer catalogues; the nine partial ones show English until translated).
- **231c Start at the selected year:** the centring waits until the card has a size and is not a pill; opening from the pill and a new size ask again (lesson 722).
- **231d APPLIED, the owner's yes (2026-11-14) — the tour's `sideways-scroll` check:** it flagged every box that scrolls sideways, so the lying timeline of more years than its card (horizontal scrolling being the owner's design since 2026-11-14) failed the first tour state that showed it. The probe now leaves out a box whose block axis is hidden or clipped (`scrollsOnlySideways`, `e2e/support/layout-probe.ts`): it cannot scroll in two directions, which is what WCAG 1.4.10 is about; a box that scrolls down and by accident sideways is still flagged (`e2e/test/layout-probe.test.ts`). The timeline's scroller says so with `overflow: auto hidden` (standing `hidden auto`). Revert if the owner wants the timeline never to scroll sideways.

## 232. Approving imagery: by eye, not by the 15 m checkpoint error (the owner 2026-11-14) — APPLIED

The owner, in chat on 2026-11-14: "dont hold images because of the 15m limit. i have my permission. i will correct them later if necesary". From now on an agent approves a layer, a USGS frame or an archive map, when it lines up by eye in several districts against OpenStreetMap or Sentinel-2 (never Mapbox Satellite); the checkpoint error is no longer a reason to hold. Still held: a visible defect (the film-edge stripe of the 1977 mapping-camera frames until their crop is redone, `docs/LESSONS.md` 730), a wrong place, or a fit that is clearly broken. What was approved under this rule, with each error, is listed in `reports/admin-sweep/actions.md`. The app's own approval policy (`imagerySettings.rmseThresholdM`) is unchanged: this is how an agent acting for the owner decides, not a setting.

## 233. The admin sweep's fixes of 2026-11-14 (`reports/admin-sweep/bugs.md`) — APPLIED

- **233a** Refine automatically on a frame waiting for approval is no longer refused because another frame of the same date waits too (they share a layer): jobs waiting for a person do not make the layer busy for a refine.
- **233b** Jobs shows a failed job's code as its plain sentence with its parameters, never the stored message (a Python exception) or a raw key; `attemptsExhausted` and `joinPartGone` now say why and what to press.
- **233c** A KH-9 mapping camera crop leaves the film's black border out (`georef/film_edge.py`); the three 1977 frames are run again.
- **233d** The stitch limit (0.35) is kept: the miss was the matcher's (segments shrunk by picking pixels alias the film grain; averaged, a true grainy pair scores 0.98 where picked pixels gave 0.34).
- **233e** Argon frames are named KH-5 Argon by their id and set aside in Work as too coarse for streets (about 140 m a pixel), kept, never deleted.
- **233f** A whole strip records where the city likely lies (`calibration.expected`), and the georeferencer opens there.
- **233g** `imagery.browse` takes two requests an instance and sharp keeps no cache (memory, no raise); a content write while a manifest build is queued joins it without a transaction; a map is removed only once its style settles; crash groups of the browser's own scripts are left out of the Crashes list.

## 234. The imagery census on the first step of a new map (the owner 2026-11-15) — APPLIED

The start page and Setup show how many old images from above the city has before any account (`docs/research/M29-imagery-census.md`). Landsat is counted exactly from Microsoft Planetary Computer's public STAC API (the only public Landsat catalogue checked that answers another origin's page and serves its previews on the same host; USGS LandsatLook refuses other origins, Earth Search's previews are requester-pays S3). The declassified frames need a USGS login, so they are a labelled range with the scan price and the step that unlocks the exact count. The host joins the start page's and the admin's `connect-src` and `img-src`.

## 235. ESLint out of memory on the NUC: the agents' worktrees left out (2026-11-15) — APPLIED (pre-approved: keeps a tool working)

`static`'s ESLint gate died with "JavaScript heap out of memory" in its last group (`.`, the rest of the tree, `scripts/ci/lint.sh`) on every run from a checkout that holds `.claude/worktrees/` (gitignored agents' worktrees, each a whole copy of the repository): ESLint does not read `.gitignore`, so it built the TypeScript programs of every copy and passed its 6 GiB heap. `eslint.config.js` now ignores `.claude/worktrees/**` (no source of ours is skipped; nothing about the rules changes). `.claude/scheduled_tasks.lock`, Claude Code's local lock file, joins `.gitignore`, which is the EditorConfig gate's exclusion list (it reads git's file list).

## 236. A static gate keeps the architecture document true (2026-11-16) — APPLIED (pre-approved: a stricter gate)

The owner asked that architecture documents always be correct and carry Mermaid diagrams. `architecture`
(`scripts/ci/check_architecture.py`, in `static` after `skill-mirrors`) fails when `docs/ARCHITECTURE.md` names a repository
path or links a file that does not exist, has no Mermaid diagram, or has one without a known type, a body or balanced
brackets. It cannot judge prose; it catches the drift that renames and deletions cause.

## 237. Home's Monthly costs in a chunk of its own (2026-11-16) — APPLIED (pre-approved: keeps a gate working, no budget raised)

The Monthly costs card took Home's chunk to 6.5 KB (budget 5 KB). Instead of raising it, the card's element and its four live
counters moved to a lazy `costs` chunk fetched when Home opens (`packages/admin/src/home/costs.ts`, `<hcm-home-costs>`); Home is
back to 4.7 KB. `check_bundle_budget.py` gains `"costs": 4` (2.8 KB measured plus headroom), as for every new chunk.

## 238. Home's Visitors card reuses the Statistics page's read (2026-11-16) — APPLIED

The owner asked for the map's statistics on Home. §203 stays: Google Analytics is read only in this browser after the
owner's read-only consent on the Statistics page, and Home never asks Google. The source keeps the last answer in memory
(`StatisticsSource.latest`, `packages/admin/src/app/statistics-wiring.ts`); Home's lazy `visitors` chunk shows it: the period's
visitors and visits with the trend against the period before, the last day, new against returning, the top countries,
languages, devices, and the most looked-at years, layers and photos (two more `batchRunReports` per period,
`SUMMARY_REPORTS` and `LOOKED_AT_REPORTS` of `packages/admin/src/google/analytics-data.ts`). Before any read it says where
to allow it, with Open Statistics. `check_bundle_budget.py` gains `"visitors": 3`. No cloud change.

## 239. Quality image OpenJDK pin 21.0.12 → 21.0.13 (2026-11-19) — APPLIED (pre-approved: keeps a tool working)

`docker/Dockerfile.quality` pinned `openjdk-21-jre-headless=21.0.12*`. After the build cache was gone, `apt-get` failed
because Ubuntu 26.04 only carries `21.0.13.1+2-1~26.04.1` (and the older `21.0.11~8ea-1`). The pin is now `21.0.13*`;
`docs/research/M0-handoff.md` matches. No gate was relaxed.

## 240. Statistics drops empty admin screen names; `imagery.markScene` at 512 MiB (2026-11-20) — APPLIED

The Statistics page's "Most opened admin screens" showed a blank first row (8 views, 22 %): GA4 returns page views whose
`route` is the empty string before the admin registers the screen name, the same class as `(not set)`.
`readStatistics` now drops both (`packages/admin/src/google/analytics-data.ts`); the sample fake carries them so the
unit test pins the filter. Separately, Cloud Error Reporting's top group was `imagery-markScene` out of memory (259 MiB
used on 256 MiB, 22 reports). `callableOptions` gains `CALLABLE_MEMORY` with `imagery.markScene` at `512MiB`; the
cost-shape table and `callable.test.ts` match. No gate was relaxed; deploy needs Setup's **Update the map**.

## 241. Admin chunk budgets after W5/M20/M26 growth — APPLIED 2026-11-20 (owner: finish and merge WIP)

Measured on `feat/engine-rewrite` after the household day-limit constant left `worker-calls.ts` (lesson 749):

| Row | Was | Now | Measured |
| --- | --- | --- | --- |
| `worker-household` | 9 | 10 | 9.1 KB |
| `editor-shared` | 13 | 18 | 17.1 KB |
| `firebase-messaging-sw.js` | 1 | 2 | 1.6 KB |
| `georef` | 19 | 20 | 19.1 KB |
| `imagery` | 20 | 21 | 20.0 KB |
| `ADMIN_TOTAL_KB` | 820 | 850 | 832 KB |
| `app.js` | — | 2 | 1.8 KB (Hosting page script) |
| `rolldown-runtime` | — | 1 | 0.2 KB |

No new chunk. Headroom about 10 %. Verify: `PIPELINE_STAGE=build`.

## 242. The Wikipedia overlay's chunks get budgets — APPLIED 2026-11-22 (owner: "implement wikipedia layer already")

M31 (`docs/research/M31-wikipedia.md`) adds three lazy chunks, each a new row of `scripts/ci/check_bundle_budget.py` (a new chunk is a reviewed decision; no existing row rose): the engine's `wikipedia` (ES) and `extra-wikipedia` (IIFE extra), 2 KB each, fetched the first time a visitor switches the overlay on; the admin's `wikipedia-section`, 3 KB, fetched when Settings → Wikipedia opens, so `settings` keeps its 22 KB. The engine's entry gains `wikipediaFileSchema` and `validate` on the extras' host (`packages/engine/src/extras/host-shared.ts`) so the chunk carries no zod. No gate was loosened. Verify: `PIPELINE_STAGE=build`.

## 243. `MAX_LAYERS` 100 → 300 and `JOIN_MAX_PARTS` 8 → 64 (2026-11-22) — APPLIED (owner approved in chat: "Continue. U do all")

The Bucharest manifest stopped rebuilding on 2026-11-21 21:22: `publish-buildmanifest` refused it with `layers: validation.tooBig`,
the city now publishing more than 100 layers (the 48 sheets of the 1990 cadastral plan among them). The owner approved raising the cap
to 300 and joining the 48 sheets into one layer, which needs a join of more than 8 parts.

- `MAX_LAYERS` = 300 (`packages/shared/src/schemas/manifest.ts`); the admin's list pages follow it; the viewer has no own cap.
- `JOIN_MAX_PARTS` = 64 for archive joins (`versionIds`, `maxzoom` params, `source.parts`, `usgsParts`, the Python twin and `enums.json`);
  the new `JOIN_MAX_FRAMES` = 8 keeps the USGS date plan and the frames join (`entityIds`, `sensor` params) where they were, so no plan
  buys more frames than before.
- Memory: the worker spills each part's preview, tone field, weight and cover to scratch files (`spilled`), so a 48-part join fits a
  modest computer; tone fields accumulate in float32.
- `scripts/ci/check_e2e_matrix.py` also reads `packages/shared/test/schemas/*.test.ts` for scenario tags (the caps' tests live there).

## 244. Engine shared chunks and admin `join-card` budget (2026-11-22) — APPLIED

The engine's ES module build now emits three shared chunks (`locales`, `manifest`, `primitives`) without entries in `ENGINE_CHUNK_BUDGETS`, and the admin's `join-card` chunk reached its 4 KB ceiling (`scripts/ci/check_bundle_budget.py`).

| Row | Was | Now | Reason |
| --- | --- | --- | --- |
| `locales` (engine) | — | 2 | New ES-build shared chunk (`packages/shared/src/i18n/locales.ts`) |
| `manifest` (engine) | — | 5 | New ES-build shared chunk (`packages/shared/src/schemas/manifest.ts`), 4.6 KB measured |
| `primitives` (engine) | — | 25 | New ES-build shared chunk (`packages/shared/src/schemas/primitives.ts` with the zod it needs), 22.2 KB measured |
| `join-card` (admin) | 4 | 5 | Reached the 4.0 KB ceiling; 5 KB is the smallest whole-KB step in `ADMIN_CHUNK_BUDGETS` |

Verify: `PIPELINE_STAGE=build`.

## 245. Viewer favourites, licence and citation; dark mode already shipped (2026-11-23) — APPLIED (owner request)

The owner asked for three viewer features from `reports/similar-sites-2026-11-23.md`. Decisions taken without asking:

- **Dark mode** needed no new work: Settings' theme (Follow my device, Light, Dark; V12), remembered per city in localStorage (`hcm:<cityId>:theme`), the Material 3 dark tokens on every panel and sheet, and the basemap's `lightPreset` following the theme on the same map (V38: no extra map load) were already live.
- **Favourites** (V91) live in `localStorage` only (`hcm:<cityId>:favorites`, at most 500), never in Firestore: the public viewer stays static and account-free. The star of a layer rides a new generic `OverlayListItem.trailing` of the kit's overlay list, so the kit imports nothing of the viewer.
- **Public domain** (V92) is read from a layer's credit (`USGS` or `Landsat` in `attribution`), since `layers[]` has no licence field: every USGS-derived layer the admin publishes already credits USGS EROS or Landsat. A `license` field in the manifest would be the cleaner contract; it waits for an owner decision because it changes the manifest builder and the admin. Downloads offer the PMTiles archive the map already reads; GeoTIFF is listed as planned. A third-party scan never offers a file, whatever its credit says.
- **Our own texts' licence** is not stated as Creative Commons: the panel asks for a citation with a link. Choosing a licence for the city's texts and stories is the owner's call.
- `packages/engine/vite.part.config.ts`: `hcm-licence-panel.ts` and `licence.ts` join the side-loaded part's `OWN` list (the panel loads with About, not in the IIFE); `extras-kit.ts` exports `LICENSE_URLS`, `licenseText` and `photoCountText` for them.
- The icon font gains `star` and `copyright` (`packages/ui/src/icons.ts`, rebuilt with `fonts:build`).

Verify: `PIPELINE_STAGE=static`, `PIPELINE_STAGE=build`, the touched Vitest files and `e2e/specs/viewer/favorites-licence.spec.ts`.

## 246. Admin total bundle budget 850 → 900 KB (2026-11-23) — APPLIED

The owner's decision ("also rize size limits!!!!"): favourites and the licence and citation panel's 16-catalogue strings took the admin total to 850.3 KB (`ADMIN_TOTAL_KB`, `scripts/ci/check_bundle_budget.py`). Raised to 900 KB; the admin entry's 450 KB budget, what an admin waits for, is unchanged. Verify: `PIPELINE_STAGE=build`.

## 247. A layer's shot direction and the viewer's button (2026-11-23) — APPLIED (owner request)

The owner's request: satellite and aerial imagery layers get an optional shot direction, the compass bearing the camera looked toward (0–360). The layer document and the manifest carry `shotDirection` (`bearingSchema`, as a photo's `bearing`); the rules allow it in the admin's editable fields. The viewer shows a round button between Show my location and the compass while the layer on top has one, and a press eases the map to that bearing (`store.faceBearing`; no analytics event yet). The admin's layer editor has a compass dial (`<hcm-direction-dial>`, an ARIA slider: a drag, the arrow keys, Home) beside the degrees typed and Clear; when the layer came from a USGS scene whose metadata lists its four corners, the editor offers that frame's direction (the bearing of its south-west to north-west edge: the way the image's top looks) as Use the USGS direction, never writing it before Save. M2M lists no camera heading for the declassified datasets, so the corners are the only USGS source. Scenario rows V93 and A233; `docs/ENGINE_API.md` → *Shot direction*. The editor's fields and dial are a side chunk (`hcm-shot-direction.ts`, defined once the layers page is) with a new 3 KB row in `ADMIN_CHUNK_BUDGETS` (`scripts/ci/check_bundle_budget.py`, a new chunk's budget, pre-approved as keeping the tool working); the `layers` chunk keeps its 10 KB. Verify: `PIPELINE_STAGE=tests`, `build`, `e2e/specs/viewer/shot-direction.spec.ts`, `e2e/admin/specs/layers/shot-direction.spec.ts`.

## 248. The quality runner mounts a linked worktree's git folder; the cold load budget runs alone (2026-11-24) — APPLIED (pre-approved: keeps a tool working)

- `scripts/ci/run-all-checks.sh`: in a linked worktree (`git worktree add`, the agents' `hcm-wt/<track>`), `.git` is a file naming the main repository's git folder, outside the mounted tree, so every gate that asks git failed at once: the split `all`'s part on this machine ended after 5 s in the runs of 2568a3a7 and 8017b96e and only the NUC's part ran. The runner now mounts the folder `git rev-parse --git-common-dir` names at its own path when `.git` is a file. A clone is unchanged.
- `e2e/specs/viewer/cold-load.spec.ts`: S-V01-HAPPY-COLD-FIRST-PAINT takes Playwright's built-in `-exclusive-` lock, so its 1,800 ms budget is measured with no other test running (beside a full run it measured 1,824 to 2,780 ms; alone it passes). The budget is unchanged. The e2e site server gzips its text files as Firebase Hosting does (`e2e/mock-apis/server.ts`). `docs/LESSONS.md` 796.

## 249. The year's dates and sliders stack on very narrow phones (2026-11-24) — APPLIED (owner decision)

The owner's answer in chat, verbatim: "for timeline Stack on very narrow phones (my pick)". The rule of 2026-11-23, the dates and the opacity sliders side by side in one row and never stacked, has one exception: where the room beside a standing timeline is narrower than both side by side (the menu's least 112 px, the 8 px gap and the sliders' least 152 px, less the 8 px kept from the viewer's edge), the sliders go under the dates, as wide as the room, each column scrolling in its share of the height. A 320 x 568 phone (228 px of room) stacks; a 360 px one (268 px) keeps the row. `pairStacks` in `packages/ui/src/viewer/date-menu-place.ts`, `.pair[data-stacked]` in `hcm-date-menu.ts`; rows S-V13-HAPPY-DATES-STACKED-NARROW and S-V13-BAD-STACKED-WITH-ROOM; the tour's c320 timeline states check the layout. Found by the split `all`'s tour at c320, where the pair ran 44 px past the window and its sliders were off screen (`docs/LESSONS.md` 796).

## 250. A layer's rights may be unclear (2026-11-24) — APPLIED (owner request)

The owner's request: a layer's rights can be marked "Unclear rights" ("Drepturi neclare"). `layerRightsSchema` takes `LAYER_RIGHTS_LICENCES` (`LAYER_LICENSES` plus `unclear`), and `RIGHTS_LICENCES` includes `unclear` (with `pipeline/src/hcm_pipeline/archive/model.py` and `pipeline/tests/contracts/enums.json` in sync) so a replacing archive import carries over an unclear layer's rights. `firebase/firestore.rules` → `validLayerRights` accepts `unclear` (the rules deploy waits for the owner). Such a layer stays on the public map: the manifest build lists it as any other (`functions/test/publish/assemble.test.ts`), and its attribution's licence part reads `rights unclear` (`UNCLEAR_CREDIT`; appended when the credit named no licence), beside the author and the scan source the credit line already carries. The viewer translates that part through `layers.attribution.unclear` in all sixteen catalogues (`STORED_CREDITS`), keeping it inside the layer's credit rather than as a credit of its own. The layer editor shows a plain note while it is chosen: rights not confirmed; ask the scan source for permission, then choose the licence it gives. No layer data was changed. Scenario rows S-A197-HAPPY-UNCLEAR and S-A197-BAD-UNCLEAR-MISSPELT; `docs/research/M20-import-local.md` §7.

## 251. The imagery scene list keeps its order while it is in use (2026-11-25) — APPLIED (owner decision)

The owner's decision, on the coordinator's proposal: each preview copy measures a frame's clouds and the server ranks it again, so the open list reordered itself under the pointer and the keyboard (a press then acted on the row that took the place, and a Tab round met a moved row twice: lessons 812, 818). Now, while the pointer or the keyboard focus is inside the list, its rows keep their places (a new row joins at the end, a gone one leaves); once both have left, the new ranking shows, and when it moved anything a status line above the list says so ("The list is now in its new order: the ranking changed while you were using it." / "Lista e acum în noua ordine: clasamentul s-a schimbat cât timp o foloseați."), seen by sighted users and announced politely (WCAG 3.2.2: no change of context while someone is using the list). The line empties at the next use of the list. `packages/ui/src/admin/imagery/scene-order-hold.ts` (`SceneOrderHold`, one per Imagery page, `ImageryContext.hold`), used by `scene-list.ts`; strings `adminContent.imagery.resorted` (ro, en, fr). Scenario rows S-A234-HAPPY-ORDER-HELD and S-A234-BAD-ORDER-LIVE (`e2e/admin/specs/imagery/order-hold.spec.ts`).

## 252. The layers page's Link dialog is its own chunk (2026-11-25) — APPLIED (pre-approved: keeps a tool working)

The admin's `layers` chunk passed its 10 KB budget again (10.1 KB) once the shot direction's Set from view (1f8a4f30) added its intents, after lesson 809 had left it 1 byte under. As lesson 809 said for the next addition, a part is split out rather than the budget raised: the Link a tileset or WMTS dialog (`link-dialog.ts`, opened only when asked) is now `<hcm-link-dialog>` (`packages/ui/src/admin/layers/hcm-link-dialog.ts`), a chunk the layers page defines once it is, as V93 did with the shot direction. `layers` is 9.4 KB after it; the new chunk, 1.4 KB measured, gets a budget of 2 KB in `ADMIN_CHUNK_BUDGETS` (`scripts/ci/check_bundle_budget.py`), within the admin's total. The dialog renders in the page's own DOM, so its fields and tests are unchanged.

## 253. The emulator worker cap leaves event triggers' workers alone (2026-11-26) — APPLIED (pre-approved: keeps a tool working)

The history tour failed at tour-x3840-light-en on the NUC (a30d35b5's split): a place's rename and a second place's creation were recorded two minutes after their writes, past the spec's 120 s. The emulators' debug log showed why: the Firestore emulator hands its trigger events to the Functions emulator one at a time, each after the last one's answer, and §202a's cap (18 workers, counted together) had 73 cold starts in under three minutes, about 2 s each, the working set being larger than the cap; every test's triggers waited behind each one. An event trigger's worker (`eventTrigger` in its definition: Firestore, Storage, Pub/Sub and schedules) is now never stopped and not counted; the cap, `HCM_EMULATOR_MAX_WORKERS`, holds the callable and HTTPS workers only, whose cold start holds up only their own call, and its default goes from 18 to 12. Cost: about 20 event triggers' workers kept at 165 MB each, at most about 5 GB of workers against 3 GB before. Rejected: stopping callables first under one cap of 18 (with the event triggers' workers live, the callables would share a few slots and cold-start on most calls), and a higher cap for all (the thrash moves to a later stage). `e2e/support/emulator-pool.ts`, lesson 822.
