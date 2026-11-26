# Pipeline baseline (2026-10-17)

Measured on 2026-10-17 by the Measure agent of the pipeline optimisation (the user's goal of 2026-10-12: "optimize the pipelines, it has to not take too much time"), before any optimisation. Every stage ran through `scripts/ci/run-all-checks.sh` exactly as documented in `.agent/skills/quality/pipeline_skill.md`, on the laptop and on the NUC, and every run ended green. The only change made while measuring is the clean-checkout fix of the `agent-assets` gate (see *The clean-checkout fix* below); no gate, threshold, scenario or configuration was touched. This file is a dated record: the next agents append their after-numbers as addenda, they do not rewrite it.

## Summary

- **`quality` takes about 21 minutes on the laptop and 14 on the NUC**: `static` 115 s (warm tree) to 168 s (fresh clone), `tests` 72 to 77 s, `e2e` 1052 s, `build` 4 s on the laptop; 165 s, 65 s, 592 s and 10 s on the NUC.
- **`e2e` is 84 % (laptop) and 71 % (NUC) of `quality`.** Its test time splits into the functional tier (50 %) and the tour (46 to 47 %); the admin tier is 2 to 3 % of the test time but runs as a serial chain at the very end, alone on one worker, for the last 107 s (NUC) to 122 s (laptop) of the run, at 19 to 45 % CPU.
- **The NUC runs the same e2e stage in 9.9 minutes against the laptop's 17.5**: its per-test times are about half the laptop's (Core Ultra 7 255H against i9-11900H), even with the user's own containers running beside it.
- **`static` uses about 2 of 16 hardware threads** (11 to 13 % mean CPU): 51 gates run one after the other, and ESLint alone is 73 to 80 s (47 to 64 % of the stage). ESLint 10's `--concurrency=auto` lints the same tree in 27.0 s instead of 82.5 s on the NUC (measured, same exit status, not applied).
- **`tsc -b` is 37.5 to 39.8 s on a fresh tree and 0.2 s on a warm one** (its `.tsbuild` caches are git-ignored): every CI job is a fresh tree.
- **In CI, shard 4 of the four e2e shards carries 1.6 to 1.9 times the test time of shards 1 and 2** (the heaviest tour viewports and the whole serial admin chain), and every shard starts the admin server and the Firebase emulators although only shard 4 runs admin tests.

## Machines and method

| | Laptop | NUC (`ssh nuc`) |
| --- | --- | --- |
| CPU | Intel Core i9-11900H, 8 cores, 16 threads | Intel Core Ultra 7 255H, 16 cores, 16 threads |
| Memory | 30 GB, no swap activity during the runs | 30 GB; 17 GB of swap already in use by the user's own containers (about 18 of them), light swap activity during the runs |
| Background | idle (load average about 1) | the user's containers and Fork-Linux CI; load average 12 to 15 over the 15 minutes before the first run, 0.3 when it started |
| Image | `hcm-quality:local`, built locally from `docker/Dockerfile.quality` | `hcm-quality:local`, built on the NUC from the same Dockerfile |
| Tree | `feat/engine-rewrite` at `33d3103` plus the agent-assets fix | the same working tree, copied by the session helper `nuc-run.sh` (rsync of the tree, then the stage in the NUC's image, reports copied back) |

- Each stage ran as `PIPELINE_STAGE=<stage> bash scripts/ci/run-all-checks.sh` (on the NUC through `nuc-run.sh <stage>`), with every output line time-stamped on the host and `vmstat -n 2` sampled on the machine that ran the stage. Gate times are `pipeline.py`'s own `<gate> passed in <s>` lines; CPU is `100 - idle` of all 16 hardware threads averaged over the gate's window; "run queue" is vmstat's `r`.
- Per-project and per-test Playwright times come from `reports/junit/e2e.xml` (a project's time is the sum of its tests' times, that is worker-seconds, not wall clock); the tier windows and the minute-by-minute timeline come from the time-stamped result lines of the `list` reporter. Vitest times come from `reports/junit/vitest.xml` (a project's time is again the sum of its tests' times; files run in parallel).
- **Laptop, warm**: the working tree after earlier runs, so the incremental caches of `tsc -b` (`.tsbuild/`) and mypy were present. **Laptop, fresh**: a scratch `git clone` of the same tree with the same uncommitted changes and no `node_modules`, no build output and no cache, which is what a CI job starts from; `static`, `tests` and `build` ran there in that order. **NUC**: every git-ignored file except `node_modules` (build output, `.tsbuild/`, tool caches, reports) was moved aside before `static`, so its `static` is cold like a CI job's; `tests`, `build` and `e2e` followed in that order on the same tree.
- The laptop and the NUC ran their stages at the same time (one stage at a time per machine). The NUC's numbers are a busy NUC's: its own workload was not stopped.

## Stage totals

| Stage | Laptop, warm | Laptop, fresh clone | NUC (cold `static`) | CPU mean (laptop / NUC) |
| --- | ---: | ---: | ---: | ---: |
| `static` | 115 s | 168 s | 165 s | 13 % / 11 % |
| `tests` | 77 s | 72 s | 65 s | 48 % / 31 % |
| `build` | 4.5 s | 4.3 s | 9.7 s | 18 % / 12 % |
| `e2e` | 1052 s | (not run) | 592 s | 89 % / 81 % |
| `quality` (sum of the four) | about 1249 s (20.8 min) | about 1296 s with the warm `e2e` | about 831 s (13.9 min) | |

Overheads around the gates, per stage: the image check (`build-and-test.sh` with a cached image) and the container start take 1.0 to 1.4 s; `npm ci --prefer-offline` from the image's cache takes 7 s on a fresh tree (`added 1179 packages in 7s`); `nuc-run.sh` adds under 1 s of rsync before and 5 to 6 s of report copy-back after a stage.

## `static`

| Gate | Laptop, warm | Laptop, fresh | NUC, cold |
| --- | ---: | ---: | ---: |
| `eslint` | 72.7 s (13 % CPU) | 74.5 s (13 %) | 80.1 s (11 %) |
| `tsc` | 0.2 s | 37.5 s (13 %) | 39.8 s (12 %) |
| `pytest` | 8.2 s (8 %) | 8.3 s (15 %) | 9.6 s (16 %) |
| `prettier` | 8.3 s (14 %) | 8.5 s (14 %) | 5.2 s (13 %) |
| `pipeline-pip-audit` | 3.4 s (4 %) | 4.3 s (3 %) | 3.5 s (4 %) |
| `pipeline-mypy` | 0.2 s | 3.4 s (8 %) | 3.9 s (8 %) |
| `knip` | 2.5 s (13 %) | 3.4 s (11 %) | 2.6 s (10 %) |
| `pip-audit` | 2.9 s (4 %) | 3.4 s (3 %) | 2.9 s (2 %) |
| `gitleaks` | 3.0 s (28 %) | 1.6 s (34 %) | 1.3 s (26 %) |
| `dependency-cruiser` | 1.7 s (13 %) | 1.7 s (11 %) | 1.9 s (10 %) |
| `mypy` | 0.1 s | 1.7 s (8 %) | 1.8 s (8 %) |
| `stylelint` | 1.7 s (14 %) | 1.6 s (10 %) | 1.3 s (9 %) |
| `markdownlint` | 1.3 s (13 %) | 1.2 s (11 %) | 1.2 s (10 %) |
| the other 38 gates (each 0.9 s or less) | 6.8 s | 7.0 s | 7.8 s |
| **sum of the gates / stage wall clock** | **113.0 s / 115 s** | **158.1 s / 168 s** | **162.9 s / 165 s** |

- **The stage is serial**: one gate at a time, and almost every gate is single-threaded, so the stage averages 11 to 13 % of the 16 threads (about two busy threads) and never passes 64 %.
- **ESLint** lints with type information (`parserOptions.projectService` in `eslint.config.js`) in one process and without `--cache`, so an unchanged tree is linted again in full. Its rule timings on the NUC (`TIMING=25`), about 64 s of rule time in all: `sonarjs/deprecation` 11.9 s (18.7 %), `@typescript-eslint/no-unsafe-enum-assignment` 8.1 s (12.7 %), `sonarjs/aws-restricted-ip-admin-access` 5.7 s (9.0 %), `sonarjs/assertions-in-tests` 5.1 s (7.9 %), `sonarjs/no-redundant-assignments` 3.2 s (5.1 %), `sonarjs/no-dead-store` 2.2 s (3.4 %), `@typescript-eslint/no-misused-promises` 1.5 s, `@typescript-eslint/no-deprecated` 1.4 s, `@typescript-eslint/no-unsafe-argument` 1.2 s, `sonarjs/no-trivial-assertions` 1.1 s.
- **ESLint's own parallelism** (an ad-hoc run of the gate's exact command in the NUC's image, measured only): `--concurrency=off` 82.5 s, `--concurrency=4` 33.7 s, `--concurrency=8` 27.0 s, `--concurrency=auto` 27.0 s; every run exited 0.
- **`tsc -b`** (`npm run typecheck`) is 37.5 s (laptop) and 39.8 s (NUC) without its git-ignored `.tsbuild/` caches and 0.2 s with them; mypy and the pipeline's mypy likewise (5.1 to 5.7 s cold, 0.3 s warm). A CI job always starts cold.
- **Run twice per `quality`**: `pytest` (the CI tooling's tests, 8 to 10 s) is in `static` and again in `tests`; `e2e-matrix` (0.1 s) is in `static` and again in `e2e`.
- **Network-bound**: `pip-audit` and `pipeline-pip-audit` spend 6 to 8 s mostly waiting (2 to 4 % CPU); `npm-audit` and `deploy-lock-audit` are under 1 s each.

## `tests`

| Gate | Laptop, warm | Laptop, fresh | NUC |
| --- | ---: | ---: | ---: |
| `vitest` | 58.9 s (57 % CPU, peak 99 %) | 55.3 s (53 %, peak 98 %) | 42.0 s (43 %, peak 91 %) |
| `pytest` | 8.8 s (9 %) | 7.8 s (9 %) | 8.9 s (8 %) |
| `pipeline-pytest` | 6.0 s (9 %) | 6.1 s (7 %) | 6.0 s (6 %) |
| `rules-coverage` | 1.9 s | 1.7 s | 1.8 s |
| `coverage` | 0.1 s | 0.1 s | 0.1 s |
| **stage wall clock** | **77 s** | **72 s** | **65 s** |

The `vitest` gate, phase by phase (seconds from the gate's start):

| Phase | Laptop, warm | Laptop, fresh | NUC |
| --- | ---: | ---: | ---: |
| Firebase emulators (auth, firestore, storage) up | 5.9 s | 6.3 s | 5.1 s |
| `vitest run --coverage` (Vitest's own `Duration`) | 42.9 s | 38.9 s | 24.7 s |
| coverage reports, Vitest's exit and the rule-coverage export (`check_rules_coverage.py save`) | 7.6 s | 7.7 s | 9.5 s |
| emulators shut down | 1.5 s | 1.6 s | 1.5 s |

Vitest's own split of its `Duration` on the laptop: worker 39 %, tests 33 %, transform 15 %, import 12 %. A cold Vite cache (the fresh clone) made no measurable difference.

Test time per Vitest project (sum of the tests' times):

| Project | Tests | Laptop | NUC |
| --- | ---: | ---: | ---: |
| `functions` (under the emulators) | 826 | 111.4 s | 61.3 s |
| `rules` (under the emulators) | 716 | 106.3 s | 50.4 s |
| `ui` (Chromium) | 610 | 39.6 s | 40.9 s |
| `tools` (child processes, the site build) | 160 | 17.0 s | 6.6 s |
| `admin` | 606 | 3.9 s | 2.2 s |
| `shared` | 805 | 1.7 s | 0.5 s |
| `engine` | 283 | 1.4 s | 0.7 s |
| `engine-browser` (Chromium) | 5 | 0.2 s | 0.2 s |

The emulator-backed projects (`functions`, `rules`) are 77 % of the laptop's Vitest test time and 68 % of the NUC's. The slowest files (suite time, laptop / NUC): `firebase/rules-tests/test/client-writes.test.ts` 17.4 / 9.1 s, `firebase/rules-tests/test/matrix.test.ts` 16.3 / 9.0 s, `functions/test/history/revert.test.ts` 14.8 / 8.2 s, `firebase/rules-tests/test/storage.test.ts` 14.6 / 7.2 s, `firebase/rules-tests/test/cities.test.ts` 14.2 / 6.8 s, `functions/test/history/record.test.ts` 13.9 / 7.8 s, `functions/test/admin/revoke.test.ts` 12.3 / 6.7 s, `firebase/rules-tests/test/photos.test.ts` 11.2 / 5.5 s, `functions/test/admin/claim.test.ts` 11.0 / 6.5 s, `functions/test/adapters/documents.test.ts` 10.7 / 6.8 s.

### Slowest 30 Vitest tests

| # | Laptop | NUC | Project | File | Test |
| ---: | ---: | ---: | --- | --- | --- |
| 1 | 7.8 s | 5.3 s | `functions` | `functions/test/history/revert.test.ts` | history.revert > happyPath_restoresTheEditedFieldsAndRecordsTheRevertOnce |
| 2 | 6.6 s | 4.6 s | `functions` | `functions/test/history/record.test.ts` | history.onPoiWrite > happyPath_aCreateAnUpdateAndADeleteEachKeepTheVersionBefore |
| 3 | 6.4 s | 3.0 s | `functions` | `functions/test/publish/on-write.test.ts` | the publish triggers > happyPath_eachTriggerRequestsABuildForItsCity |
| 4 | 5.6 s | 2.3 s | `functions` | `functions/test/admin/invite.test.ts` | admins.invite > happyPath_storesOnlyTheHashOfTheAddress |
| 5 | 5.1 s | 2.7 s | `functions` | `functions/test/admin/revoke.test.ts` | admins.revoke > happyPath_aRevokedAdminLosesAccessAtOnce |
| 6 | 4.7 s | 2.8 s | `functions` | `functions/test/admin/join.test.ts` | admin.join > happyPath_anInvitedAccountJoinsOnce |
| 7 | 4.5 s | 1.5 s | `functions` | `functions/test/admin/list.test.ts` | admins.list > happyPath_listsTheAdminsOldestFirstAndThePendingInvitations |
| 8 | 4.2 s | 2.9 s | `functions` | `functions/test/admin/claim.test.ts` | admin.claim > happyPath_theProjectOwnerBecomesTheMapOwner |
| 9 | 3.9 s | 2.7 s | `functions` | `functions/test/adapters/documents.test.ts` | get and set > happyPath_aWrittenDocumentReadsBackValidatedWithFirestoreTimestamps |
| 10 | 3.8 s | 1.3 s | `functions` | `functions/test/admin/session.test.ts` | admin.session > happyPath_aNewProjectOffersTheOwnerClaim |
| 11 | 3.3 s | 2.3 s | `functions` | `functions/test/deps.test.ts` | createDeps > happyPath_theEmulatorWithTheFakesKeepsSecretsInTheFakeSecretManager |
| 12 | 3.1 s | 1.4 s | `functions` | `functions/test/history/revert.test.ts` | history.revert > happyPath_aDeletedDocumentComesBackWithItsServerOwnedFields |
| 13 | 2.9 s | 1.1 s | `tools` | `scripts/site/test/admin-build.test.ts` | buildAdminSite > happyPath_addsThePageTheFontsAndTheLegacyBundleNextToTheViteBuild |
| 14 | 2.7 s | 0.6 s | `rules` | `firebase/rules-tests/test/history.test.ts` | history of a city > happyPath_onlyAdminsReadTheHistoryNewestFirst |
| 15 | 2.5 s | 1.3 s | `functions` | `functions/test/admin/claim.test.ts` | admin.claim > badPath_aSecondOwnerIsRefusedAndTheOwnersRepeatChangesNothing |
| 16 | 2.3 s | 1.1 s | `functions` | `functions/test/admin/session.test.ts` | admin.session > happyPath_aPendingInvitationIsOfferedUntilItExpires |
| 17 | 2.2 s | 1.9 s | `ui` | `packages/ui/test/components/sheet.test.ts` | hcm-sheet > happyPath_theHandleCyclesAndArrowKeysStep |
| 18 | 2.0 s | 0.9 s | `rules` | `firebase/rules-tests/test/cities.test.ts` | update > badPath_adminCannotSave_an About text over 10000 characters |
| 19 | 2.0 s | 1.3 s | `functions` | `functions/test/admin/revoke.test.ts` | admins.revoke > badPath_theOwnerCannotBeRevoked |
| 20 | 1.9 s | 2.2 s | `ui` | `packages/ui/test/viewer/kit-integration.test.ts` | hcm-map-viewer with the real kit > happyPath_theFabMenuOpensTheLayersSheetWithLiveSlider |
| 21 | 1.8 s | 0.8 s | `rules` | `firebase/rules-tests/test/identity.test.ts` | admin identity > happyPath_onlyAVerifiedGoogleAccountWithClaimAndDocumentIsAnAdmin |
| 22 | 1.6 s | 1.0 s | `rules` | `firebase/rules-tests/test/storage.test.ts` | photo uploads > badPath_photosOfTheWrongSizeAreRejected_60 MiB or more |
| 23 | 1.6 s | 1.0 s | `functions` | `functions/test/admin/list.test.ts` | admins.list > badPath_aDocumentItsSchemaRefusesIsLeftOutAndLogged |
| 24 | 1.6 s | 0.6 s | `tools` | `scripts/site/test/build.test.ts` | buildSite (the committed sites) > happyPath_buildsBucharestFromItsCommittedInputs |
| 25 | 1.5 s | 0.7 s | `functions` | `functions/test/admin/invite.test.ts` | admins.invite > badPath_anAddressThatAlreadyAdministersTheMap |
| 26 | 1.5 s | 0.6 s | `functions` | `functions/test/history/revert.test.ts` | history.revert > happyPath_aCityRevertKeepsItsCurrentServerOwnedToken |
| 27 | 1.4 s | 0.5 s | `functions` | `functions/test/admin/claim.test.ts` | admin.claim > happyPath_withoutConfiguredClientsTheGoogleSignInClientIsAsked |
| 28 | 1.4 s | 0.7 s | `functions` | `functions/test/admin/join.test.ts` | admin.join > happyPath_anOwnerWhoWasAlsoInvitedStaysTheOwner |
| 29 | 1.3 s | 0.8 s | `functions` | `functions/test/admin/session.test.ts` | admin.session > happyPath_theOwnerWithTheClaimNeedsNothing |
| 30 | 1.3 s | 0.4 s | `functions` | `functions/test/history/record.test.ts` | history.onPoiWrite > happyPath_onlyTheNewestEntriesAreKept |

## `build`

| Gate | Laptop, warm | Laptop, fresh | NUC |
| --- | ---: | ---: | ---: |
| `vite-build` (engine, admin, `functions/dist`) | 2.3 s | 2.2 s | 2.4 s |
| `site-build` | 0.5 s | 0.5 s | 0.4 s |
| `bundle-budget` | 0.1 s | 0.1 s | 0.1 s |

Vite 8 builds each bundle in 0.2 to 0.7 s; the stage is not a time sink. The NUC's 9.7 s wall clock is mostly `nuc-run.sh` copying the reports back.

## `e2e`

| Gate | Laptop | NUC |
| --- | ---: | ---: |
| `e2e-matrix` | 0.1 s | 0.1 s |
| `e2e-build` | 3.0 s | 2.3 s |
| `playwright` | 1047.1 s (89 % CPU) | 581.9 s (82 % CPU) |
| **stage wall clock** | **1052 s (17.5 min)** | **592 s (9.9 min)** |

Inside the `playwright` gate: 15.5 s (laptop) and 14.5 s (NUC) pass before `Running 861 tests using 8 workers`, while the site server, the mock APIs, the admin server and the Firebase emulators with the 32 functions start; the last result line then comes 1030 s (laptop) and 566 s (NUC) later; the reports take about 1 s more. Both runs: 861 passed, no retry, no flaky test.

### Per tier

| Tier | Projects | Tests | Laptop test time | NUC test time | Share | Laptop window (first to last result) | NUC window |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `fn` | 5 | 520 | 3244 s | 1680 s | 50 % | 3 to 432 s | 2 to 225 s |
| `tour` | 44 | 308 | 3061 s | 1525 s | 46 to 47 % | 436 to 908 s | 228 to 460 s |
| `admin` | 6 | 22 | 112 s | 100 s | 2 to 3 % | 908 to 1030 s (setup at 1 s) | 459 to 566 s (setup at 0 s) |
| `a11y` | 2 | 3 | 27 s | 12 s | 0.4 % | 902 to 911 s | 455 to 462 s |
| `harness`, `smoke`, `nogl`, `setup` | 5 | 8 | 20 s | 10 s | 0.3 % | 1 to 907 s | 0 to 459 s |
| **all** | **62** | **861** | **6464 s** | **3327 s** | | | |

- **Playwright runs the projects in the order of `e2e/projects.ts`**: the functional tier first, then the tour, then a11y and no-WebGL, and the admin tier last. The admin tier is serial by design (`workers: 1` per project plus the lease of `e2e/admin/support/test.ts` across projects), so its 21 tests after `admin-setup` start only when everything else is done and run one at a time: 122 s (laptop) and 107 s (NUC) with one busy worker at the end of every run.
- **Packing**: the test time divided by the 8 workers is 808 s (laptop) and 416 s (NUC) against 1030 s and 566 s of actual run, a 78 % and 73 % packing; the serial admin tail is most of the difference.
- **The machine is saturated, not the worker pool**: while the functional tier and the tour run, CPU is 96 to 100 % with a run queue of about 40 to 76 on both machines (eight Chromium instances rendering WebGL on the CPU through SwiftShader, each with several threads). More workers on one machine would not add capacity; another machine would.

### Per project

| Project | Tests | Laptop | Laptop mean | NUC | NUC mean |
| --- | ---: | ---: | ---: | ---: | ---: |
| `fn-l1440-en` | 104 | 747 s | 7.2 s | 389 s | 3.7 s |
| `fn-l1440-ro` | 104 | 671 s | 6.5 s | 354 s | 3.4 s |
| `fn-m768-ro` | 104 | 632 s | 6.1 s | 347 s | 3.3 s |
| `fn-c360-dark` | 104 | 611 s | 5.9 s | 299 s | 2.9 s |
| `fn-c360-ro` | 104 | 582 s | 5.6 s | 292 s | 2.8 s |
| `admin-l1440-ro` | 3 | 42 s | 14.1 s | 24 s | 7.9 s |
| `admin-l1440-en` | 3 | 23 s | 7.8 s | 23 s | 7.8 s |
| `admin-c360-ro` | 3 | 23 s | 7.6 s | 30 s | 10.0 s |
| `admin-m768-ro` | 3 | 21 s | 7.1 s | 20 s | 6.8 s |
| `admin-harness` | 9 | 2 s | 0.2 s | 2 s | 0.3 s |
| `a11y-reduced-motion` | 2 | 15 s | 7.7 s | 6 s | 3.1 s |
| `a11y-forced-colors` | 1 | 12 s | 11.7 s | 6 s | 5.8 s |
| `harness` | 4 | 9 s | 2.2 s | 5 s | 1.1 s |
| `smoke-c360`, `smoke-l1440` | 2 | 7 s | 3.6 s | 3 s | 1.7 s |
| `nogl` | 1 | 4 s | 3.7 s | 2 s | 1.7 s |
| `setup`, `admin-setup` | 2 | 0 s | 0.1 s | 0 s | 0.1 s |

The tour's 44 projects (`tour-<viewport>-<light|dark>-<ro|en>`) each run the same seven tests of `e2e/tour/viewer.tour.ts`, with the same scenario tags (`S-V15-HAPPY`, `S-V18-HAPPY`, `S-V18-HAPPY-MODAL-STATES`). Their cost per viewport (four projects each; the slowest of the four is at most 20 % slower than the fastest, usually under 10 %):

| Viewport | Laptop, per project | NUC, per project | Laptop, four projects | NUC, four projects |
| --- | ---: | ---: | ---: | ---: |
| `x3840` (3840 × 2160) | 155 s | 81 s | 621 s | 324 s |
| `x2560` | 89 s | 45 s | 356 s | 179 s |
| `x1920` | 72 s | 36 s | 286 s | 145 s |
| `m768` | 62 s | 29 s | 249 s | 116 s |
| `l1440` | 62 s | 30 s | 246 s | 119 s |
| `l1280` | 58 s | 28 s | 232 s | 113 s |
| `c412` | 58 s | 29 s | 230 s | 114 s |
| `c915l` | 57 s | 28 s | 230 s | 113 s |
| `e1024` | 55 s | 27 s | 220 s | 107 s |
| `c360` | 52 s | 26 s | 206 s | 102 s |
| `c320` | 46 s | 23 s | 185 s | 92 s |

The functional tier per spec file (all five projects, laptop / NUC): `layers` 340 / 196 s, `photos` 309 / 155 s, `consent` 308 / 163 s, `pois` 295 / 150 s, `responsive` 254 / 139 s, `overlay-opacity` 254 / 135 s (the slowest per test: 10.1 s on the laptop), `deep-links` 249 / 120 s, `language-theme` 242 / 124 s, `keyboard` 198 / 101 s, `timeline` 192 / 101 s, `crash-reporting` 110 / 58 s, `geolocate` 108 / 51 s, `boot` 97 / 46 s, `about` 92 / 41 s, `embed-api` 81 / 39 s, `content-security-policy` 75 / 39 s, the starter kit 36 / 21 s, `no-javascript` 4 / 3 s.

### Timeline

Results finished per minute after `Running 861 tests`, the CPU in that minute and which tiers finished tests in it:

| Minute | Laptop results | Laptop CPU | Laptop tiers | NUC results | NUC CPU | NUC tiers |
| ---: | ---: | ---: | --- | ---: | ---: | --- |
| 0 | 82 | 96 % | setup, smoke, harness, fn, admin-setup | 155 | 97 % | setup, smoke, harness, fn, admin-setup |
| 1 | 79 | 100 % | fn | 134 | 100 % | fn |
| 2 | 72 | 100 % | fn | 123 | 100 % | fn |
| 3 | 69 | 100 % | fn | 141 | 98 % | fn, tour |
| 4 | 69 | 100 % | fn | 99 | 96 % | tour |
| 5 | 67 | 100 % | fn | 95 | 97 % | tour |
| 6 | 72 | 100 % | fn | 63 | 98 % | tour |
| 7 | 59 | 96 % | fn, tour | 31 | 73 % | tour, a11y, nogl, admin |
| 8 | 46 | 96 % | tour | 4 | 27 % | admin |
| 9 | 47 | 97 % | tour | 16 | 22 % | admin |
| 10 | 47 | 97 % | tour | | | |
| 11 | 43 | 98 % | tour | | | |
| 12 | 35 | 98 % | tour | | | |
| 13 | 27 | 99 % | tour | | | |
| 14 | 18 | 100 % | tour | | | |
| 15 | 11 | 45 % | tour, a11y, nogl, admin | | | |
| 16 | 5 | 31 % | admin | | | |
| 17 | 13 | 19 % | admin | | | |

### Slowest 30 Playwright tests

| # | Laptop | NUC | Project | File | Test |
| ---: | ---: | ---: | --- | --- | --- |
| 1 | 40.9 s | 22.2 s | `admin-l1440-ro` | `e2e/admin/specs/journey.spec.ts` | The owner sets up a new map from sign-in to the legacy import within the input budget |
| 2 | 35.6 s | 18.7 s | `tour-x3840-light-en` | `e2e/tour/viewer.tour.ts` | A photo, its lightbox, and the photo list |
| 3 | 35.1 s | 16.2 s | `tour-x3840-dark-en` | `e2e/tour/viewer.tour.ts` | A photo, its lightbox, and the photo list |
| 4 | 34.5 s | 15.8 s | `tour-x3840-dark-ro` | `e2e/tour/viewer.tour.ts` | A point of interest and About |
| 5 | 33.5 s | 18.8 s | `tour-x3840-dark-ro` | `e2e/tour/viewer.tour.ts` | A photo, its lightbox, and the photo list |
| 6 | 30.3 s | 16.9 s | `tour-x3840-light-ro` | `e2e/tour/viewer.tour.ts` | A photo, its lightbox, and the photo list |
| 7 | 29.1 s | 14.4 s | `tour-x3840-light-en` | `e2e/tour/viewer.tour.ts` | A point of interest and About |
| 8 | 28.0 s | 13.2 s | `tour-x3840-dark-en` | `e2e/tour/viewer.tour.ts` | A historical year and the Layers panel |
| 9 | 27.4 s | 13.9 s | `tour-x3840-dark-ro` | `e2e/tour/viewer.tour.ts` | A historical year and the Layers panel |
| 10 | 27.3 s | 15.3 s | `tour-x3840-dark-en` | `e2e/tour/viewer.tour.ts` | A point of interest and About |
| 11 | 26.2 s | 13.7 s | `tour-x3840-dark-en` | `e2e/tour/viewer.tour.ts` | Home, the keyboard focus and the open menu |
| 12 | 25.1 s | 14.4 s | `tour-x3840-light-en` | `e2e/tour/viewer.tour.ts` | Home, the keyboard focus and the open menu |
| 13 | 24.7 s | 15.2 s | `tour-x3840-light-ro` | `e2e/tour/viewer.tour.ts` | A point of interest and About |
| 14 | 24.6 s | 13.3 s | `tour-x3840-light-en` | `e2e/tour/viewer.tour.ts` | A historical year and the Layers panel |
| 15 | 24.4 s | 13.5 s | `tour-x3840-dark-ro` | `e2e/tour/viewer.tour.ts` | Home, the keyboard focus and the open menu |
| 16 | 23.7 s | 12.5 s | `tour-x3840-light-ro` | `e2e/tour/viewer.tour.ts` | A historical year and the Layers panel |
| 17 | 23.5 s | 11.3 s | `tour-x3840-dark-ro` | `e2e/tour/viewer.tour.ts` | Bucharest today: no layers yet and the consent banner |
| 18 | 22.1 s | 22.0 s | `admin-l1440-en` | `e2e/admin/specs/journey.spec.ts` | The owner sets up a new map from sign-in to the legacy import within the input budget |
| 19 | 21.8 s | 28.7 s | `admin-c360-ro` | `e2e/admin/specs/journey.spec.ts` | The owner sets up a new map from sign-in to the legacy import within the input budget |
| 20 | 21.4 s | 9.2 s | `tour-x3840-light-en` | `e2e/tour/viewer.tour.ts` | Bucharest today: no layers yet and the consent banner |
| 21 | 20.3 s | 19.1 s | `admin-m768-ro` | `e2e/admin/specs/journey.spec.ts` | The owner sets up a new map from sign-in to the legacy import within the input budget |
| 22 | 20.1 s | 12.2 s | `tour-x3840-light-ro` | `e2e/tour/viewer.tour.ts` | Bucharest today: no layers yet and the consent banner |
| 23 | 19.6 s | 10.8 s | `tour-x3840-light-ro` | `e2e/tour/viewer.tour.ts` | Home, the keyboard focus and the open menu |
| 24 | 19.4 s | 9.7 s | `tour-x3840-dark-en` | `e2e/tour/viewer.tour.ts` | Bucharest today: no layers yet and the consent banner |
| 25 | 19.2 s | 9.3 s | `tour-x2560-dark-en` | `e2e/tour/viewer.tour.ts` | A photo, its lightbox, and the photo list |
| 26 | 18.0 s | 9.8 s | `tour-x2560-dark-ro` | `e2e/tour/viewer.tour.ts` | A photo, its lightbox, and the photo list |
| 27 | 17.8 s | 10.0 s | `tour-x2560-light-en` | `e2e/tour/viewer.tour.ts` | A photo, its lightbox, and the photo list |
| 28 | 17.5 s | 8.6 s | `tour-x2560-light-ro` | `e2e/tour/viewer.tour.ts` | A photo, its lightbox, and the photo list |
| 29 | 17.0 s | 8.7 s | `tour-x3840-dark-ro` | `e2e/tour/viewer.tour.ts` | A toast |
| 30 | 16.6 s | 7.8 s | `fn-l1440-en` | `e2e/specs/viewer/pois.spec.ts` | POI labels show from zoom 16 and not below |

The admin journeys are the only tests that are not about half as long on the NUC: they wait on the emulators and the functions, not on rendering.

### The four CI shards

No GitHub Actions run exists yet (`gh run list` is empty), so the CI jobs could not be timed. What each shard of `.github/workflows/ci.yml` gets, from `npx playwright test --list` with `E2E_SHARD=1/4` to `4/4` (every tier, as CI runs it), joined with the measured test times:

| Shard | Tests | Tiers | Laptop test time | NUC test time |
| --- | ---: | --- | ---: | ---: |
| `1/4` | 216 | setup, harness, smoke, 209 `fn` | 1233 s | 649 s |
| `2/4` | 216 | setup, 215 `fn` | 1448 s | 755 s |
| `3/4` | 216 | setup, 96 `fn`, 119 `tour` | 1494 s | 735 s |
| `4/4` | 216 | setup, 189 `tour` (the large viewports), a11y, nogl, the whole `admin` tier | 2289 s | 1188 s |

- Shard 4 holds 1.6 to 1.9 times the test time of shards 1 and 2, the x2560 and x3840 tours and the serial admin chain, so it sets the e2e job's wall clock.
- Every shard starts the admin server and the Firebase emulators with the functions (the `webServer` list depends on `E2E_TIER`, which CI leaves unset), although only shard 4 runs admin tests: part of the 15 s of server start-up, and a JVM's memory, in every shard.
- Each CI job also pays the image load from the Actions cache (about a minute, by the comment in `ci.yml`), `npm ci` (7 s measured) and a cold tree.

## Top time sinks

Ranked by wall-clock effect on a `quality` run; "time" is laptop / NUC.

1. **The e2e functional tier**: 3244 / 1680 s of test time, half of e2e: 104 tests in each of five projects (`fn-c360-ro`, `fn-m768-ro`, `fn-l1440-ro`, `fn-l1440-en`, `fn-c360-dark`), 5.6 to 7.2 s per test on the laptop; the l1440 projects are the slowest (more pixels for SwiftShader).
2. **The e2e tour**: 3061 / 1525 s of test time, 46 to 47 % of e2e: 44 projects of the same seven tests with the same scenario tags; x3840 alone is 20 to 21 % of the tour (621 / 324 s), the three x-viewports together 41 to 42 %.
3. **The serial admin tail of e2e**: 122 / 107 s at the end of every run with one busy worker (19 to 45 % CPU), because the admin projects come last in `e2e/projects.ts` and run one test at a time.
4. **ESLint**: 73 to 80 s, single process, typed rules, no cache; `--concurrency=auto` measured at 27.0 s against 82.5 s.
5. **`tsc -b` on a fresh tree**: 37.5 / 39.8 s, every CI job; 0.2 s warm.
6. **Vitest**: 55 to 59 / 42 s; the emulator-backed `functions` and `rules` projects are 68 to 77 % of its test time; about 6 s of emulator start and 8 to 10 s of coverage reports and rule-coverage export around the run.
7. **The serial remainder of `static`**: about 40 s of single-threaded gates after ESLint and `tsc` (`pytest` 8 to 10 s and run again in `tests`, `prettier` 5 to 8.5 s, the two pip audits 6 to 8 s waiting on the network, the mypys 5 to 6 s cold, `knip` 2.5 to 3.4 s, the 38 small gates 7 to 8 s together).
8. **CI shape**: shard 4 is the long pole of the e2e job; every shard starts the emulators; every job loads the image and starts cold.

Not a sink: `build` (about 3 s of gates), the image check and container start (1 to 1.4 s per stage), `npm ci` (7 s, only on a fresh tree), `e2e-build` (2 to 3 s).

## The clean-checkout fix (`agent-assets`)

- **Seen**: on a fresh clone (the NUC with its build output moved aside, a scratch `git clone` on the laptop, and every CI runner) the `agent-assets` gate failed with eleven "does not exist" errors for `functions/dist` and `packages/admin/dist` (in `.agent/skills/firebase/rules_and_emulators_skill.md`, `.agent/skills/quality/pipeline_skill.md`, `.agent/skills/web/admin_setup_assistant_skill.md`, `.agent/workflows/deploy.md`, `docs/ARCHITECTURE.md`, `docs/TESTING.md`), while it passed on any machine that had built once.
- **Cause**: `scripts/ci/check_agent_assets.py` accepts a missing path that git ignores, and asks `git check-ignore --no-index`. git matches a folder pattern (`dist/`) only against a path it knows to be a folder; a build output that does not exist yet, written without a trailing slash, is therefore reported as not ignored (`functions/dist/` and `functions/dist/index.js` were, `functions/dist` was not).
- **Fix**: the checker asks git about every missing path also in its folder form (`functions/dist/`), and counts the path as ignored when either form is (`ignore_queries`, `answered_as_file_or_folder`); the docs keep naming the built folders. Pinned by `test_happy_path_unbuilt_output_folders_count_as_ignored_in_a_fresh_clone` in `scripts/ci/tests/test_check_agent_assets.py` (a path no pattern ignores still fails). The quirk is recorded in `.agent/skills/quality/pipeline_skill.md` → *Local tooling quirks*.
- **Verified**: the fresh clone's check went from eleven errors to `[agents] OK: ... 1775 path references resolve`; `static` on the NUC with every git-ignored file except `node_modules` moved aside ended `[SUCCESS] stage 'static' passed (reports/pipeline/green-static.json)`, and so did `static` on the laptop and in the laptop's fresh clone.

## Reproducing the measurement

1. Time-stamp every line of a stage's output on the host (bash's `$EPOCHREALTIME` in a `while read` loop) while `vmstat -n 2` runs, also time-stamped, on the machine that runs the stage; keep the stage's exit status from `PIPESTATUS`, never from the pipe.
2. Per gate: the `<stage> <i>/<n> <gate>` and `<gate> passed in <s>` lines; CPU over each gate's window is `100 - id` from vmstat.
3. Per test: `reports/junit/vitest.xml` (`classname` is the file; the project follows from its folder) and `reports/junit/e2e.xml` (`hostname` is the Playwright project).
4. For a cold `static`, run it in a fresh clone or with every git-ignored file except `node_modules` moved aside (`git clean -ndX` lists them).
5. Shard composition: `E2E_SHARD=<i>/4 npx playwright test --list --reporter=json` in `e2e/`, inside the image.

## After the e2e optimisation (e2e agent, 2026-10-17)

What changed (`docs/research/DECISIONS-for-review.md` §29): the per-push tour is 9 of the 44 tour projects (every tour test and scenario row still runs; the other 35 are the `tour-matrix` stage of `all` and the nightly workflow); the admin tests hold a Playwright lock instead of one worker per project and come first in the queue, so they run beside the viewer tiers; the projects run longest first; `E2E_SHARD` takes ranges (`1-2/3`); the e2e build is skipped while nothing it reads or writes changed; `scripts/ci/e2e-split.sh` runs a stage's Playwright runs on the laptop and the NUC at once. Every run below ended `[SUCCESS] stage '<x>' passed`, with no failed, flaky or retried test. During every laptop run the other agents' stages loaded the laptop too (its CPU and run queue are given); two runs also rebuilt the quality image on both machines because another agent had changed `package.json` or `scripts/ci/requirements.txt`, which the stage's wall clock includes.

| Run | Tests | Playwright | Stage wall clock | Notes |
| --- | ---: | ---: | ---: | --- |
| baseline `e2e`, laptop | 861 | 1030 s | 1052 s | (above) |
| baseline `e2e`, NUC | 861 | 566 s | 592 s | (above) |
| `e2e`, NUC alone | 616 | 5.5 min | 335 s | e2e build skipped by its stamp (0.2 s) |
| `e2e`, split `1:3` | 154 here, 463 on the NUC | 3.1 min here, 4.5 min on the NUC | **283 s** | laptop 93 % CPU, run queue 52; the merge of both reports included |
| `e2e`, split `1:2` (the final tree) | 205 here, 412 on the NUC | 4.8 min here, 4.0 min on the NUC | 596 s | both machines rebuilt the image first (about 200 s on the NUC); laptop 73 % CPU, run queue 41 |
| `tour-matrix`, split `1:2` | 82 here, 165 on the NUC | 2.3 min here, 2.2 min on the NUC | 430 s | both machines rebuilt the image first |
| `e2e` with `E2E_TIER=admin,smoke`, NUC | 29 | 2.0 min | 125 s | the admin chain alone: about 107 s |

Test time per tier on the NUC alone, against the baseline's run of every tier on the NUC:

| Tier | Tests | Test time | Baseline | Note |
| --- | ---: | ---: | ---: | --- |
| `fn` | 520 | 1775 s (3.41 s a test) | 1680 s (3.23 s) | the admin tests now run beside it |
| `tour` | 63 | 349 s | 1525 s (308 tests, 44 projects) | the other 245 tests are `tour-matrix` |
| `admin` | 22 | 198 s | 100 s | beside the others instead of alone; still one at a time |
| the rest | 11 | 22 s | 22 s | |
| packing (test time / 8 workers / run) | | 89 % | 73 % | no serial admin tail |

The polling intervals, measured and reverted (`DECISIONS-for-review.md` §29f): the functional tier on the NUC took 1749 and 1649 s of test time with `expect.poll` every 20 to 250 ms and 1664 and 1738 s with Playwright's 100, 250, 500, 1000 ms; at 96 to 100 % CPU a shorter wait only hands the CPU to another worker.

What sets the split's wall clock now: the larger of the two parts (each about 15 to 25 s of start-up, the servers and the emulators, plus its share of the test time) and about 7 s to merge the JUnit reports. A balanced split gives the NUC about twice the laptop's share when the laptop is otherwise idle (`HCM_SPLIT_PARTS=1:2`, the default) and more when it is busy (`1:3`); for `quality` and `all` the laptop also runs `static`, `tests` and `build`, so the default is `1:4`, to be retimed once those stages are faster (§29g).

## Addendum: the `static` stage and the gate engine (static agent, 2026-10-17)

What changed (`docs/research/DECISIONS-for-review.md` §31): the gates of every stage run at the same time
(`scripts/ci/gate_runner.py`, up to `PIPELINE_JOBS`, default the CPU count, output still in registry order); ESLint lints
on four worker threads here (a quarter of the CPUs, at least two); Prettier and stylelint keep content-keyed caches in
`reports/.cache/`; `quality` and `all` run `pytest`, `e2e-matrix` and `e2e-build` once and reuse the outcome in the later
stage.

**Method.** Two scratch clones of `33d3103` with the agent-assets fix: one with the old engine and `package.json`, one
with the new; each pair ran back to back on the laptop. The other agents' stages loaded the laptop during every run (16
hardware threads; the 1-minute load average at each run's start is given), so the spread is wide and the pairs, not the
absolute numbers, are the comparison. *Fresh*: no `node_modules` (the run includes `npm ci`); *cold*: every git-ignored
file but `node_modules` deleted (no `.tsbuild/`, no tool cache); *warm*: right after another run. Round 1 went through
`run-all-checks.sh` (its wall clock includes the image check) with ESLint's `--concurrency=auto` (eight threads);
round 2 is the final configuration, the same `docker run` without the image check. Every run ended
`[SUCCESS] stage 'static' passed`.

| Run | Old engine | New engine | Load at start (old / new) |
| --- | ---: | ---: | --- |
| round 1, fresh | 252.8 s | 120.6 s | 4.6 / 4.8 |
| round 1, warm | 148.8 s | 80.9 s | 4.8 / 4.7 |
| round 1, cold | 246.7 s | 108.5 s | 4.7 / 76.1 |
| round 2, warm (final) | 176.2 s | **48.2 s**, 64.4 s, 109.7 s | 5.9 / 6.4, 5.9, 5.4 (rising to 20) |
| round 2, cold (final) | 228.3 s | **87.7 s** | 13.0 / 5.9 |
| baseline (idle laptop, above) | 115 s warm, 168 s fresh | | about 1 |

The longest gates of the best runs (the stage's wall clock is the longest of them, not their sum):

| Gate | Old, warm | New, warm (48.2 s) | Old, cold | New, cold (87.7 s) |
| --- | ---: | ---: | ---: | ---: |
| `eslint` | 122.0 s | 48.2 s | 110.6 s | 77.9 s |
| `tsc` | 0.3 s | 0.8 s | 47.7 s | 87.0 s |
| `pytest` | 11.8 s | 17.4 s | 8.3 s | 26.7 s |
| `prettier` | 9.9 s | 8.4 s | 24.9 s | 28.7 s |
| `knip` | 3.8 s | 7.7 s | 2.7 s | 10.5 s |
| sum of the gates | 175.5 s | 141.6 s | 227.2 s | 323.8 s |

- **Warm, ESLint is the critical path**; cold, `tsc -b` is (single-threaded: 47.7 s alone, 87.0 s beside ESLint's
  workers and the other gates). A gate's own time grows when it shares the machine; the stage's does not add them up.
- **ESLint's worker threads**, measured alone in the image on the busy laptop (load 7 to 19), same exit status each
  time: one thread 86.8 s (136 CPU seconds), two 59.7 s (174), four 45.0 s (256), eight 69.2 s (721). Each worker builds
  its own typed program; past four the extra CPU outweighs the split. The NUC, with 16 physical cores, measured 82.5 s,
  33.7 s and 27.0 s for one, four and eight.
- **Prettier's cache**: `prettier --check` on the warm tree took 18 to 21 s (11 to 12 CPU seconds) with the cache and
  45 s (45 CPU seconds) without, at load 28.
- **The target of under 60 s on the laptop** is met warm when the laptop is not also running the other agents' stages
  (48.2 s at load 6); cold it is not (87.7 s), because `tsc -b` alone is 38 to 48 s and shares the CPU with ESLint.
  CI restores `.tsbuild/` (§28c), so its `static` starts warm for `tsc`.
- **Not measured here**: an idle laptop (the other agents' runs never stopped) and the NUC (reserved for the e2e and
  integration agents).

## Addendum: the `tests` stage (tests agent, 2026-10-17)

What changed (`docs/research/DECISIONS-for-review.md` §30): the emulators' JVMs run two JIT compiler threads
(`JAVA_TOOL_OPTIONS=-XX:CICompilerCount=2` in `npm test`); `shared`, `engine`, `admin` and `functions` share one module
graph per worker (`isolate: false`), with the one functions test that uses `vi.mock` in its own isolated project,
`functions-deps`, and both functions projects at 60 s per test and hook; the rules world seeds through one
rules-disabled context per file instead of a new Firebase app per seed; the two 250 MB rule-coverage reports are
fetched at once; the CI tooling tests run on at most four pytest-xdist workers. The tests stage already used one
emulator session for everything that needs one (the `vitest` gate); no gate, test file, threshold or scenario changed.

**Method.** Two scratch clones of `33d3103`, one unchanged and one with only these changes, run back to back with
the old serial engine, each in its own image; the other agents' stages loaded the laptop throughout, so the pairs, not
the absolute numbers, are the comparison (the 1-minute load average at each run's start is given). *4 CPUs*: the same
container pinned to four CPUs (`--cpuset-cpus=0-3`, the size of a GitHub-hosted runner; the JVM and Vitest size their
pools from it). CPU is the container's cgroup `usage_usec`. Every run ended `[SUCCESS] stage 'tests' passed`.

| Run | Before | After | Load at start (before / after) |
| --- | ---: | ---: | --- |
| 16 threads, round 1 | 71.6 s | 55.3 s | 4.7 / 8.6 |
| 16 threads, round 2 | 71.5 s | 55.6 s | 9.6 / 11.0 |
| 4 CPUs, round 1 | 93.9 s | 60.9 s | 11.4 / 7.3 |
| 4 CPUs, round 2 | 88.3 s | 61.0 s | 6.1 / 4.7 |
| the working tree, with the gate engine of the static addendum | 84.6 s (before any change, 11:52) | **50.1 s** (14:21), 56.9 s (14:05) | about 1 to 6 / 5.9, 4.0 |
| baseline (idle laptop, above) | 77 s warm, 72 s fresh | | about 1 |

| Gate or measure | Before, 16 threads | After, 16 threads | Before, 4 CPUs | After, 4 CPUs |
| --- | ---: | ---: | ---: | ---: |
| `vitest` gate | 54.9 to 55.6 s | 43.4 to 43.9 s | 72.0 to 76.8 s | 49.0 to 49.1 s |
| Vitest's own `Duration` | 39.2 s | 29.1 to 29.3 s | 56.4 to 59.4 s | 34.6 s |
| `pytest` | 7.9 to 8.5 s | 3.7 to 3.8 s | 8.4 to 8.8 s | 3.9 to 4.0 s |
| `pipeline-pytest` | 5.9 s | 5.9 s | 5.8 to 6.2 s | 5.8 s |
| `rules-coverage` | 1.7 to 1.8 s | 1.7 s | 1.7 to 1.8 s | 1.7 s |
| container CPU | 479 s | 318 to 319 s | 235 to 248 s | 166 to 168 s |

The working tree's last run phase by phase (gate engine of §31: `pytest` and `pipeline-pytest` run beside `vitest`):
image check 1.4 s, emulators up 6.6 s, Vitest 32.0 s, coverage reports and the rule-coverage save 6.0 s, emulators down
1.7 s, `rules-coverage` 1.7 s; `pytest` 4.9 s and `pipeline-pytest` 6.3 s finished inside the `vitest` gate's 46.9 s.
Before any change the same phases were 3.3, 5.9, 47.0, 9.3 (the reports fetched one after the other), 1.1 and 2.0 s,
with `pytest` (8.8 s) and `pipeline-pytest` (6.2 s) after them.

Each change measured on its own (16 threads unless named):

| Change | Before | After |
| --- | --- | --- |
| Two JIT compiler threads (default 12 here, 3 on 4 CPUs) | Firestore JVM 63 to 78 CPU s for the rules tests; `vitest` gate 61.9 to 65.4 s | 44 CPU s; 59.6 to 60.2 s (interleaved runs) |
| Shared module graph, worker CPU per project run alone | `admin` 36 s, `shared` + `engine` 19 s, `functions` 69 s | 15 s, 13 s, 46 s |
| Shared module graph, 4 CPUs | `admin`'s 56 files 20 s, `engine` 6.4 s | 1.7 to 1.9 s, 0.4 to 0.5 s |
| One rules-disabled context per rules file | `rules` alone 10.6 to 10.8 s; its longest files in the full run 25 to 26 s | 8.6 to 9.0 s; 15 to 18 s |
| Rule-coverage reports fetched at once (each about 250 MB) | 7.1 to 8.7 s | 4.0 to 5.9 s |
| `pytest` on four workers, alone | 12.4 s, 10.0 CPU s | 5.9 s, 15.9 CPU s |

- **The `vitest` gate is CPU-bound.** On 16 threads the run burns 300 to 500 CPU seconds; the browser projects (`ui`,
  `engine-browser`) take about 7 s at the start and the Node projects follow. Run as two Vitest processes side by side,
  the Node part took 36.2 s against 25.4 s alone: what is left to win is CPU work, not overlap.
- **The tail is now the rules files** (`matrix` 17.6 s, `storage` 15.9 s, `client-writes` 14.7 s in the working tree's
  14:05 run, each a sequence of round trips to the Firestore emulator), then the `tools` project's child processes. Fixed costs
  around Vitest: the emulators' start (6 to 7 s) and the two rule-coverage reports (about 7 s).
- **Not kept** (`DECISIONS-for-review.md` §30g): a slowest-projects-first sequencer (slower: the `rules` files then ran
  beside Chromium), the `threads` pool (more CPU), C1-only JIT (the reports built slower than the tests gained), the
  browser and Node projects as two runs (above), pytest-xdist for the pipeline's tests (GDAL per worker: 9.2 s against
  5.4 s).
- **Not measured**: an idle laptop, the NUC (reserved for the e2e and integration agents) and a real GitHub-hosted
  runner (the 4-CPU container stands in for it).

## Addendum: the integrated pipeline (integrator, 2026-10-17)

The four areas combined (`docs/research/DECISIONS-for-review.md` §28 to §31) plus the integration's own changes (§32:
the image's npm layer keyed on the dependencies only, the split's default shares, the nightly's `tour-matrix` reports,
`.hypothesis/` ignored), measured once the other agents had stopped. Every run below ended
`[SUCCESS] stage '<x>' passed`, with no failed, flaky or retried test; no gate, threshold, test or scenario row was
dropped.

**Method.** The laptop ran nothing but these runs (1-minute load average 1 to 9 at their starts, from the previous
run's tail); the NUC kept running the user's own containers (load average 4 at rest, up to 54 right after a split
part). Each run was timed on the laptop around the whole command, with `/proc/stat` read before and after on both
machines: the mean CPU is the busy share of all 16 hardware threads over the run's wall clock, and CPU seconds are the
busy time summed over them (the NUC's include the user's workload, about 4 busy threads at rest). *Warm*: the working
tree after earlier runs (`.tsbuild/`, the mypy, Prettier and stylelint caches present). *Fresh clone*: a `git clone`
of the tree with the uncommitted files copied in, no `node_modules`, no build output and no cache, so the run includes
`npm ci`. *4 CPUs*: the stage's container pinned to four CPUs (`--cpuset-cpus=0-3`, a GitHub-hosted runner's size),
ESLint then on two threads and the gate engine four gates at a time; *with the type-checker caches* is a CI `static`
job that restored them (§28c), *cold* one that did not. The baseline's CPU seconds are derived from its mean CPU and
wall clock.

### After: per stage

| Stage | Machine | Before | After | CPU after (mean, CPU s) | CPU before |
| --- | --- | ---: | ---: | --- | --- |
| `static` | laptop, warm | 115 s | **47.6 s** | 50 %, 389 | 13 %, about 240 |
| `static` | laptop, fresh clone | 168 s | **92.6 s** (`npm ci` included) | 58 %, 868 | 13 %, about 350 |
| `static` | 4 CPUs, with the type-checker caches | | 66.8 s | 241 | |
| `static` | 4 CPUs, cold | | 82.1 s | 335 | |
| `tests` | laptop, warm | 77 s | **56.8 s** | 50 %, 465 | 48 %, about 590 |
| `tests` | laptop, fresh clone | 72 s | **59.6 s** | 51 %, 491 | |
| `tests` | 4 CPUs (tests addendum) | 88 to 94 s | 61 s | 166 to 168 | 235 to 248 |
| `build` | laptop, warm and fresh | 4.3 to 4.5 s | 4.9 s | 21 %, 17 to 18 | 18 % |
| `e2e` | laptop alone | 1052 s (861 tests) | **592.5 s** (616 tests) | 96 %, 9,104 | 89 %, about 14,980 |
| `e2e` | NUC alone (e2e addendum) | 592 s | 335 s | | 81 %, about 7,670 |
| `e2e` | laptop + NUC, `2:3` (default) | | **306.5 s** | laptop 62 %, 3,059; NUC 93 %, 4,564 | |
| `e2e` | laptop + NUC, `1:2` | | 317.3 s | laptop 53 %, 2,701; NUC 93 %, 4,699 | |
| `tour-matrix` | laptop + NUC, `2:3` (default) | (in `e2e`) | **133.3 s** (247 tests) | laptop 77 %, 1,654; NUC 92 %, 1,958 | |
| `quality` | laptop alone | about 1249 s | about 700 s (the sum of the four) | | |
| `quality` | laptop + NUC, `1:2` (default) | | **324.2 s** | laptop 63 %, 3,267; NUC 93 %, 4,830 | |
| `all` | laptop + NUC, `1:2` (default) | about 1,250 s plus Sonar (laptop alone, every tour project in `e2e`) | **398.4 s** | laptop 71 %, 4,542; NUC 91 %, 5,813 | |

- **`static`**: the critical path is ESLint warm (45.9 s, on four threads beside the other 50 gates) and `tsc -b` cold
  (83.2 s in the fresh clone, 38 s when it had the machine alone); four ESLint threads were the fastest alone too (40.3
  s, against 43.9 s on six and 58.3 s on eight, the laptop idle). On 4 CPUs ESLint's two threads set the pace (65.5 s
  with the caches, 80.8 s cold, `tsc -b` 68.7 s beside it).
- **`tests`**: `vitest` 53.2 s warm with `pytest` (5.0 s) and `pipeline-pytest` (6.4 s) beside it; within `quality` the
  stage took 45.9 s, its `pytest` reused from `static`.
- **`e2e` alone**: 9.7 minutes of Playwright for 616 tests on 8 workers, at 96 % CPU: the laptop is saturated, so only
  less work or a second machine shortens it.
- **The image**: applying §32a rebuilt it once (205 s on the laptop, 216 s on the NUC, at the same time); afterwards a
  `package.json` that differed only in a script built in 2 s (the npm layer `CACHED`), where each script edit of the
  optimisation had cost 245 to 297 s per machine.

### The split

| Run | Shares | The laptop's part | The NUC's part | Wall clock |
| --- | --- | --- | --- | ---: |
| `e2e` | `1:2` | 205 tests in 3.0 min, done at 187 s | 412 tests in 5.1 min, done at 315 s | 317 s |
| `e2e` | `2:3` | 246 tests in 3.4 min, done at 209 s | 371 tests in 5.0 min, done at 304 s | 306 s |
| `quality` | `1:2` | `static` 46.1 s, `tests` 45.9 s, its e2e part 173.5 s (205 tests), `build` 2.7 s: done at 273 s | 412 tests in 5.2 min, done at 321 s | 324 s |
| `tour-matrix`, inside the first `all` | `1:2` | 82 tests in 1.5 min | 165 tests in 2.3 min | about 145 s of the run |
| `tour-matrix` | `2:3` | 99 tests in 1.8 min, done at 116 s | 148 tests in 2.1 min, done at 130 s | 133 s |
| `all` | `1:2` | `static` 46.0 s, `tests` 45.6 s, its e2e part 173.5 s, its `tour-matrix` part 88.1 s, `build` 2.7 s, `sonar` skipped: done at 357 s | its `e2e` part, 412 tests in 4.1 min (249.6 s), then its `tour-matrix` part, 165 tests in 2.3 min (141.3 s): done at 393 s | 398 s |

- **The floor is the admin chain.** The admin tier's 22 tests run one at a time behind the Playwright lock and stand at
  the head of the queue, so every split gives all of them to the NUC: 238 s (the `1:2` run) and 259 s (`2:3`) of test
  time, the journey alone 58 s per project under full load, and an admin test was the last of the NUC's part every
  time. Giving the laptop 41 more functional tests (`2:3`) shortened the NUC's part by only 11 s. Halving the chain
  between the machines is proposed in §32f (about 230 s for `e2e`).
- **Per test, the two machines were closer than in the baseline**: in the `1:2` run the laptop's functional tests took
  5.95 s each and the NUC's 4.44 s (the baseline: twice as fast on the NUC), the NUC sharing its CPU with the user's
  workload; the shares are a middle ground, and `HCM_SPLIT_PARTS` overrides them.
- **Defaults** (§32b): `2:3` for `e2e` and `tour-matrix`, `1:2` for `quality` and `all`. In `quality` the laptop's
  `static` and `tests` (92 s) come before its e2e part, so it ended 48 s before the NUC; the `1:4` that the e2e agent
  had set while the laptop was loaded would have added about 80 tests to the NUC's part, the longer one already. The `tour-matrix` part of a first `all` run at `1:2` left the laptop idle for the last 52 s of it, so the stage on
  its own takes `2:3` (the laptop done 14 s before the NUC); inside `all` one share serves both Playwright stages.

### Found while measuring

- `static` failed `editorconfig` in the fresh clone after `tests` had run in it: Hypothesis's cache files in a
  `.hypothesis/` folder without Hypothesis's own `.gitignore`, which rsync's `.gitignore` filter had dropped while
  copying the folder (`docs/LESSONS.md` #52, §32e). The root `.gitignore` names `.hypothesis/` now; rerun, it passed.
- The nightly workflow uploaded no report or trace for its two `tour-matrix` jobs (§32c).
- Two earlier `all` runs (438.5 s and 401.1 s, every test passed in both) failed in `static` on the integrator's own
  edits: a test line of 141 columns (`ruff-check`, `ruff-format`), then this file without its final newline
  (`editorconfig`, `markdownlint`). Both fixed; the `all` row above is the third run, `[SUCCESS] stage 'all' passed`.

## Change requests

Requests between the agents of the pipeline optimisation (2026-10-17). Each names the area that owns the change; the owner answers under it.

- **CR-CI-1 (ci → e2e)**: the CI e2e jobs choose their work with `E2E_TIER` and `E2E_SHARD` only (the matrix of `.github/workflows/ci.yml`), so that only the job that holds the `admin` tier starts the Firebase emulators and each job's share can follow the measured test time. Please keep both variables working as today (an empty `E2E_SHARD` means no sharding) and answer here: (a) the switch that selects the full tour matrix for `all` and the nightly workflow (proposed: `E2E_TOUR=full`, forwarded by name by `scripts/ci/run-all-checks.sh`, with the per-push tour when unset), (b) the size of the per-push tour (projects and tests), (c) whether the project order in `e2e/projects.ts` changes (CI shards the `fn` tier by count and assumes its five projects of 104 tests in today's order).
  - *ci, later the same day*: (a) is settled by the e2e work in progress: the `tour-matrix` tier of `e2e/projects.ts` (the 35 tour projects beyond the per-push `tour`), chosen through `E2E_TIER`, so no new variable is needed and the proposed `E2E_TOUR` is withdrawn. `ci.yml` runs `fn` in three count shards plus one job with `admin,smoke,a11y,nogl,tour`; `nightly.yml` adds the `tour-matrix` stage (the e2e work's new stage, the same one `all` runs) as `E2E_SHARD` `1-2/5` and `3-5/5`, so the two must land together. If the tier or stage names or the `fn` tier's five projects change, say so here.
  - *e2e, 2026-10-17*: (a) as the ci answer says: tier `tour-matrix` and stage `tour-matrix` (gates `e2e-matrix`, `e2e-build`, `playwright-tour-matrix` = `E2E_TIER=tour-matrix npm run test:e2e`); `E2E_TIER` unset is every tier but `tour-matrix`, `E2E_TIER=all` every tier; an empty `E2E_SHARD` still means no sharding, and `first-last/total` is new. (b) 9 projects, 63 tests (`tour-{c360,c915l,l1440,x3840}-{light,dark}-ro`, `tour-c360-light-en`); `tour-matrix` is 35 projects, 245 tests. (c) The tier order changed to `admin`, `smoke`, `a11y`, `nogl`, `tour`, `tour-matrix`, `fn`; inside `fn` the five projects keep their order and their 104 tests each, so the three `fn` count shards are unchanged. A sharded run also writes a blob report to `reports/blob/e2e*/` (for `playwright merge-reports`), and a `tour-matrix`-only run writes `reports/junit/e2e-tour-matrix.xml`, `reports/playwright-tour-matrix/` and `reports/test-results-tour-matrix/`, which `report_paths: reports/junit/e2e*.xml` already matches.
- **CR-CI-2 (ci → static)**: the CI `static` job restores and saves tool caches with `actions/cache`: today the `tsc -b` folders (`.tsbuild/` next to every `tsconfig`) and `reports/.cache/` (mypy, the pipeline's mypy). Please name here every cache path you add; a path under `node_modules/` is wiped by the job's `npm ci` and cannot be carried. ESLint's `--cache` keeps the verdict of an unchanged file even when the types it imports changed, so with the type-aware rules a cache carried between commits could pass a file that a full run fails: the CI cache leaves any ESLint cache out unless you show it is safe.
  - *static, 2026-10-17*: two new cache paths, both safe to carry between commits because only a file that passed is
    cached, keyed on its content, the resolved config and the tool's version: `reports/.cache/prettier/cache.json` and
    `reports/.cache/stylelint/`. stylelint's key leaves out the version of its syntax plugin `postcss-lit`, so if you carry
    that one, put `hashFiles('package-lock.json')` into the key. Optional: in CI the critical path of `static` is ESLint
    or `tsc`, and Prettier saves about 8 to 10 CPU seconds there. No ESLint cache (agreed; §31c).
  - *integrator, 2026-10-17*: the CI cache still carries only the type-checker caches. On a 4-CPU container Prettier
    took 22 to 24 s without its cache beside ESLint's 66 to 81 s, so carrying it would not shorten the job.
- **CR-CI-3 (ci → tests)**: none, unless the reports of `tests` move (`reports/junit/*.xml`, `reports/coverage/`): the CI artifact `coverage` and the `sonarqube` job read them.
  - *tests, 2026-10-17*: no report moved or changed name: `reports/junit/{vitest,pytest,pipeline}.xml`,
    `reports/coverage/ts/`, `reports/coverage/{scripts,pipeline}.xml`, `reports/rules/`. The Vitest JUnit report names one
    more project, `functions-deps` (the composition root's test, moved out of `functions`); the files and tests are the
    same.
- **CR-E2E-1 (e2e → integrator)**: `scripts/ci/run-all-checks.sh` line 7 still says `all (quality+sonar, the default)`; `all` is now `static`, `tests`, `e2e`, `tour-matrix`, `build`, `sonar`. Edit it only when no run is in flight on the laptop (bash reads a running script by offset).
  - *static, 2026-10-17*: done with the `PIPELINE_JOBS` forwarding (§31d), replaced atomically.
- **CR-E2E-2 (e2e → ci)**: for your information, `docs/CI_PIPELINE.md` got three factual edits from the e2e work: the `tour-matrix` stage in the one-line stage list and in `all`, the gate count (65, `tour-matrix` 3) and the E2E row (`scripts/ci/e2e_build.py`, `playwright-tour-matrix`).
- **CR-E2E-3 (e2e → static)**: for your information, markdownlint reports MD038 twice on `.agent/skills/quality/pipeline_skill.md` line 10 (code spans that start with spaces: `` `  tsc passed in 37.5s` ``), in the text of the run-order change.
  - *static, 2026-10-17*: fixed (`tsc passed in 37.5s`, no leading spaces in the code spans).
- **CR-E2E-4 (e2e → integrator)**: retime `PIPELINE_STAGE=quality bash scripts/ci/e2e-split.sh` once `static` and `tests` are faster, and set `default_parts` in `scripts/ci/e2e-split.sh` so the laptop's `static` + `tests` + its e2e part ends with the NUC's part (`1:4` today).
  - *integrator, 2026-10-17*: retimed with the laptop otherwise idle (*Addendum: the integrated pipeline* → *The
    split*): `quality` took 324 s at `1:2`, the laptop's part done 48 s before the NUC's, so `default_parts` is `1:2`
    for `quality` and `all` and `2:3` for `e2e` and `tour-matrix` on their own (§32b).
- **CR-STATIC-1 (static → integrator)**: §31e, the image's npm layer keyed on the dependencies only, so that an npm
  script edit stops rebuilding the npm, Playwright and emulator layers (245 to 297 s on the laptop each time, a cold
  layer in CI). Apply it when no agent is mid-run: it rebuilds every image once.
  - *integrator, 2026-10-17*: applied (§32a) once no other agent ran; the rebuild it caused took 205 s on the laptop
    and 216 s on the NUC, and a script-only edit then built in 2 s.
- **CR-STATIC-2 (static → ci)**: `docs/CI_PIPELINE.md` → *Expected wall time* estimates `static` at 5 to 6 minutes. With
  the gates running together and ESLint on two threads on a 4-vCPU runner the stage should be well below that; please
  retime it with the first measured run.
  - *integrator, 2026-10-17*: measured on a 4-CPU container: 66.8 s with the type-checker caches, 82.1 s cold;
    `docs/CI_PIPELINE.md` → *Expected wall time* now says about 4 minutes with the image.
- **CR-STATIC-3 (static → tests, e2e, integrator)**: for your information, from 2026-10-17 every stage runs its gates
  at the same time: in `tests`, `vitest`, `pytest` and `pipeline-pytest` together, then `rules-coverage` (after `vitest`)
  and `coverage` (after all three); in `e2e` and `tour-matrix`, `e2e-matrix` beside `e2e-build`, then Playwright alone.
  Within one run of `quality` or `all`, `pytest`, `e2e-matrix` and `e2e-build` run once (§31b), which matters for a
  split that runs part of a stage on each machine (`scripts/ci/e2e-split.sh`). `PIPELINE_JOBS=1` restores the serial
  order for a measurement; a new gate that reads another's output declares `needs`, one that binds fixed ports or
  fills the machine `exclusive`.
  - *tests, 2026-10-17*: noted and measured with it (the working tree's run in the tests addendum). With `pytest` beside
    `vitest`, its four workers are off the critical path of `tests`; they shorten a standalone run and cost about 6 CPU
    seconds (§30d).
  - *integrator, 2026-10-17*: noted. In a split run each machine reuses within its own run only: the NUC runs the
    `e2e` and `tour-matrix` stages on their own, so it runs their `e2e-matrix` and `e2e-build` itself.
- **CR-TESTS-1 (tests → ci)**: `docs/CI_PIPELINE.md` → *Expected wall time* estimates `tests` at 5 to 7 minutes. On a
  container pinned to four CPUs the stage itself took 61 s (88 to 94 s before these changes), plus the job's image load
  and `npm ci`; please retime it with the first measured run.
  - *integrator, 2026-10-17*: done in `docs/CI_PIPELINE.md` → *Expected wall time* (about 4 minutes with the image).
- **CR-TESTS-2 (tests → e2e)**: for your information, `npm test` now starts the emulators with
  `JAVA_TOOL_OPTIONS=-XX:CICompilerCount=2`; the e2e admin tier starts its own emulators without it. Measured only for
  the `vitest` gate's run of about a minute; in a ten-minute e2e run C2's faster code may pay back, so measure before
  copying it. The Storage emulator relays the JVM's "Picked up JAVA_TOOL_OPTIONS" line as an "Unexpected rules runtime
  error" warning.
  - *integrator, 2026-10-17*: not applied and not measured; left open (§32g).
- **CR-TESTS-3 (tests → integrator)**: the `package.json` `test` script and the new pins in `scripts/ci/requirements.txt`
  each rebuilt the image once on the laptop (about 4.5 minutes; CR-STATIC-1 would spare the first kind). A fresh clone
  of the unchanged branch failed `vitest` once on a 5 s timeout of `functions/test/deps.test.ts` (lesson 51 of
  `docs/LESSONS.md`), so a red `tests` run of the old tree on a busy machine is not a regression of the merge.
  - *integrator, 2026-10-17*: noted; since §32a only a dependency change rebuilds the npm layer. No red `tests` run
    in the integration: `tests` passed in every run, warm, in the fresh clone and inside `quality` and `all`.

## Addendum: the admin tier split and the tour's generic checkers (invariants agent, 2026-10-17)

Measured on 2026-10-17 with the laptop otherwise idle and the NUC running the user's own containers (its swap in use:
17 GB). Every run below went through `scripts/ci/e2e-split.sh` from the same tree; `docs/research/DECISIONS-for-review.md`
§33 records the changes.

| Run | Tests | This machine's part | The NUC's part | Stage wall clock |
| --- | ---: | --- | --- | ---: |
| `e2e`, admin halves (`E2E_ADMIN_PART` `2/2` here, `1/2` there), before the generic checkers | 618 | 246 tests, done at 272 s | 372 tests, done at 220 s | **275 s** (306 s before §33a) |
| `e2e` with `E2E_TIER=all`, the generic checkers on every tour and admin state | 1,039 | 414 tests in 10.4 min, done at 645 s | 625 tests in 15.0 min, done at 999 s | 1,141 s |
| `e2e`, admin halves, with the checkers | 654 | 260 tests, done at 522 s | 394 tests, done at 379 s | 560 s |
| `e2e`, admin `3/3` here and `1-2/3` there, with the checkers | 654 | 257 tests, done at 386 s | 397 tests, done at 413 s | **453 s** |

- Test time per tier in the full run (the merged `reports/junit/e2e.xml`; the tour ran mostly on the NUC, the
  functional tier on the laptop): `tour-matrix` 4,038 s for 385 tests, `fn` 3,877 s for 520, `tour` 1,192 s for 99,
  `admin` 755 s for 23 (a journey 1.1 to 2.9 minutes with its ten state checks), the rest under 30 s. Per tour project
  on the NUC: about 245 s at 3840 × 2160, 175 s at 2560 × 1440, 80 to 110 s for the others (11 tests each).
- Before the checkers the tour's 9 per-push projects took about 600 s of laptop test time and the 35 others about
  2,360 s; with them about 2,400 and 8,000 s. Every state currently fails its soft assertions, so every state also
  takes an outlined screenshot (about 1 s at 3840 × 2160) and every failing test restarts its worker; a clean tour
  will be faster than these numbers.
- Per state on the laptop, measured by phase: axe 0.7 to 2.0 s, the Tab round 0.4 to 1.9 s, the text-spacing and
  reflow variants 0.3 to 0.9 s, the contrast checks 0.1 to 0.4 s, the layout probe 0.05 to 0.7 s. The probes are
  installed once per page as a library and called by name (`e2e/support/page-script.ts`), so a call sends a few bytes
  instead of the helpers' 60 KB of source, and the trace of a failing test stays small.

## Addendum: the quality review (adversarial reviewer, 2026-10-18)

Measured on 2026-10-18 on the laptop while other agents worked on it (one ran Playwright in a copy of the tree), so
every comparison below alternates the old and the new way in the same minutes, each in its own container, from a
private copy of the working tree (no split stage, no build of the shared `dist/`).

| What | Before | After |
| --- | ---: | --- |
| `static`, warm | 115 s (baseline) | 67 s; ESLint 63.7 s is its critical path |
| `tests`, warm | 77 s (baseline) | 76 s (Vitest 66.7 s, 5,168 tests) |
| `quality`, split `1:2` (the E2E agent's run) | 324 s (2026-10-17) | 1,002 s: the NUC's part 995 s (834 tests), this machine's 613 s (`static` and `tests`, then 339 tests in 446 s) |
| `all`, split `1:2` (the E2E agent's run) | 398 s (2026-10-17) | 2,374 s |
| per-push e2e test time | | 9,857 s (tour 4,067 s, admin 3,120 s, functional 2,650 s); `tour-matrix` 19,328 s |

Why `quality` tripled: the admin's editor journeys joined the per-push tour (DECISIONS §34c, §35g) and every tour and
admin state runs the generic checkers. One state of a 50-category settings page, by phase: axe 1.2 to 1.6 s, the Tab
round 1.4 to 5.2 s, the contrast checks 0.2 s, the layout probe 0.1 to 0.3 s, and the scroll sweep 0.7 to 1.1 s per
position (6 to 14 positions), of which axe's colour contrast was 0.45 to 0.65 s.

Two kinds of waste, both removed without dropping a check, a gate or a scenario:

- **`AxeBuilder`'s default mode** injects axe-core (about 550 KB) into the page and every frame, runs it per frame,
  then opens a blank page, injects axe there as well and merges the partial results in it. On the admin's overlays page,
  six calls each: one rule 0.39 to 0.66 s against 0.11 to 0.17 s for the page's own `axe.run`; the tour's tags 1.18 to
  1.60 s against 0.15 to 0.22 s; legacy mode with `resultTypes: ['violations']` 0.21 to 0.35 s. `axeViolations`
  (`e2e/support/a11y.ts`) now runs a page of one frame in legacy mode on the first check of a document and through the
  injected `axe.run` after that; a page with frames keeps the default mode. A differential run of both ways on every call
  (134 tests: `tour-c360-light-ro`, `fn-l1440-ro`, both a11y projects; then a page with a low-contrast text, an unnamed
  button and an image without `alt`, with `include` and `skipRules`) found no difference, the new way 3.2 to 4.6 times
  faster per call.
- **The trace**: `retain-on-failure` recorded a DOM snapshot and a screencast frame at every action of every test, and
  a checker's probe or Tab press is an action. Four tour tests at 3840 × 2160 and 1440 × 900, four workers: 1.5 min with
  that trace, 1.1 min without screenshots or without snapshots, 55.5 s without both and 55.7 s with no trace at all.
  `e2e/playwright.config.ts` keeps a failed test's trace without them (actions, timings, console, network, the error),
  its screenshot and its error context; a rerun with `--trace retain-on-failure` gives the full trace.

Both together, whole projects, old and new alternated:

| Project | Tests | Before: test time, wall | After: test time, wall |
| --- | ---: | --- | --- |
| `tour-c915l-dark-ro` | 26 | 736 s and 965 s; 136 s and 169 s | 450 s and 441 s; 85 s and 86 s |
| `admin-l1440-dark` | 69 | 984 s; 194 s | 514 s; 114 s |
| `fn-l1440-ro` | 106 | 729 s; 100 s | 580 s; 80 s |

On the per-push tiers' test times above that is about 3,900 s less (the tour and admin tiers about 45 %, the functional
tier 20 %), from about 9,860 s to about 6,000 s, and the split `quality` from 1,002 s to an estimated 600 to 650 s
before the shares are retuned. A split run could not be made while other agents worked in the shared tree; the next
split `quality` measures it, and `default_parts` in `scripts/ci/e2e-split.sh` follows the measured parts (in the run
above the NUC's part was the longer by 382 s).

What still stands between `quality` and about 8 minutes, for the user (`docs/research/DECISIONS-for-review.md` §39c, the quality review's
section): the locked admin chain (the Setup journey at five projects, about 580 s of test time in all, 236 s in one
project on a loaded laptop), the fifty-category state at every per-push tour project (about 50 s each), and the
functional tier's five projects of the same 105 specs.

## Addendum: the per-push tiering of §39c, measured (M2 follow-ups, 2026-10-18)

`DECISIONS-for-review.md` §42g moved the repetitions out of every push (the Setup journey at `admin-m768-ro`,
`admin-l1440-dark` and `admin-l1440-en`; the eleven window-class-independent functional specs at four of the five `fn`
projects; the admin's tour journeys in the dark scheme and in English) into `tour-matrix`; every scenario row still runs
on every push. Two split `quality` runs with the NUC, this machine otherwise idle:

| Run | Wall | This machine | The NUC | Tests |
| --- | ---: | --- | --- | ---: |
| first (three spec failures and the bundle budget, fixed before the second) | 482 s | static, tests, Playwright 285 s, build | Playwright 464 s | 973 |
| second, green | 460 s | static, tests, Playwright 228 s, build | Playwright 447 s | 968 |

Test time of the per-push tiers in the second run (the merged `reports/junit/e2e.xml`): admin 472 tests, about 2,030 s;
functional 325, about 1,370 s; tour 159, about 1,310 s; the rest under 20 s; about 4,720 s in all (about 9,860 s before
the tiering, about 6,000 s estimated after §39a and §39b). The two parts ended within about 20 s of each other, so the
default `1:2` of `scripts/ci/e2e-split.sh` stays.

What moved costs the nightly `tour-matrix` about 1,700 s of test time more (the eleven specs about 160 s a project, the
journey about 100 s a project, the admin's tours about 150 s a project), on its ten count shards of about 17,500 s: the
heaviest shard stays well inside the 45-minute job. The per-push CI jobs only got lighter (`ci.yml`'s shards unchanged).
