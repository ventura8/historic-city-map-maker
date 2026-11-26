# Historic City Map Maker Skills Catalog

This catalog indexes the project skills of **Historic City Map Maker** (București dispărut): what each one covers and when to read it.

## Mandatory Execution Rule

1. Before starting any task, read `AGENTS.md`, `.agent/instructions.md`, this catalog, and every skill and workflow file relevant to the task.
2. Every task updates the Markdown that describes it (`README.md`, `docs/*.md`, `.agent/**`, `.agents/skills/**` and the `.claude/skills/**` mirror) in the same task. Never ship code-only changes.
3. Verify every change with `scripts/ci/run-all-checks.sh` (inside the quality image); it is what CI runs, gate for gate. Quote its `[SUCCESS] stage '<x>' passed` line before saying done.

---

## Folder Layout

- `governance/`: keeping the agent assets and the documentation in sync with the code, and where each lesson is written down.
- `quality/`: the pipeline (the **only** definition of the stages), every gate and its fix, the test tiers, the e2e scenario registry, SonarQube Cloud, releases.
- `web/`: the public viewer engine, the admin and its Setup Assistant, the Material 3 Expressive adaptive UI kit, i18n (RO default, EN), web security (no HTML from data, CSP).
- `firebase/`: Cloud Functions (pure handlers and thin triggers), Firestore and Storage rules, the emulators, analytics and crash reporting.
- `pipeline/`: the Python + GDAL raster pipeline, USGS M2M, Mapbox tileset publishing and its cost guard.
- `workflow/`: human-only steps and per-action consent, git, pull requests and reviews.

Agent-native digests live in `.agents/skills/<name>/SKILL.md` and, byte-identical, in `.claude/skills/<name>/SKILL.md`: `quality-pipeline`, `e2e-scenarios`, `sonarqube`, `firebase`, `raster-pipeline`, `setup-assistant`, `coderabbit-review-waves`, `resolve-pr-comments`, `prepare-release`. Edit the `.agents/skills/` copy, then `cp` it over the mirror.

Subagents (`.claude/agents/`): `pipeline-runner` (runs one stage, returns the verdict), `e2e-matrix-auditor` (the registry against the tests), `docs-sync-checker` (the docs a diff must touch), `golden-reviewer` (Playwright screenshot diffs).

---

## Governance Skills

- `governance/agent_asset_maintenance_skill.md`: keep `AGENTS.md`, `CLAUDE.md`, `.agent/`, `.agents/skills/`, `.claude/` in sync with the code every task; the drift rules (counts and stage definitions in one place, planned paths); *Where a lesson goes*.
- `governance/doc_update_skill.md`: which document owns which fact (`README.md`, `docs/*.md`, the generated scenario doc, release notes, badges), the `docs/research/` addendum rule, and the Markdown style that keeps markdownlint green.

---

## Quality Skills

- `quality/pipeline_skill.md`: the single entry point `scripts/ci/run-all-checks.sh`, the **canonical stage table** (`static`, `tests`, `e2e`, `build`, `sonar`, `deps`, `release`, `quality`, `all`), how to add a gate, the CI mapping, tool pins, holds and local tooling quirks.
- `quality/ci_quality_gates_skill.md`: every gate in run order, its command, configuration, what it fails on and how to fix it without a suppression.
- `quality/testing_strategy_skill.md`: the test tiers (node, Vitest browser mode, the static site build, functions, rules, pytest, Playwright), fakes and seams (`MapPort` + FakeMap, msw, the mock APIs, the emulators), network isolation, naming, per-file coverage, and the local stack for manual testing (`npm run dev:stack`: the e2e world for a person's browser, the Claude browser pane's limits).
- `quality/e2e_scenario_matrix_skill.md`: the scenario registry `e2e/scenarios.json` (V viewer, A admin, P pipeline), its id scheme, statuses, the test tags and the cross-check in both directions; the e2e world: tiers and projects (`E2E_TIER`, the admin tier), the site server, the admin server and mock APIs, the fixture manifest, the fixtures every spec gets, the pitfalls the M1 and M2b specs met.
- `quality/sonarqube_skill.md`: SonarQube Cloud (org `ventura8`), the CI job and the local `sonar` stage, the strict verdict, the token rules and the pitfalls inherited from the sibling repos.
- `quality/prepare_release_skill.md`: the release scripts (`npm run release:bump`, `release:cdn`, `release:pin-kit`, `release:notes`), the two release-note files per tag, the engine in `cdn/engine/` with `release.json` for jsDelivr, the release gates and the ask-first commands for the tag.

---

## Web Skills

- `web/engine_viewer_skill.md`: the public viewer engine (`@hcm/engine`): config and manifest (contract: `docs/ENGINE_API.md`), the `MapPort` seam, Mapbox GL 3.34.1 as an external global, layers, timeline, photos, points of interest, the overlay model (live opacity of every overlay, raster image adjustments), URL state, one map per view, the M1 interfaces, where the engine and viewer code lives (`packages/engine/src/`, `packages/ui/src/viewer/`), the build with its fonts.
- `web/admin_setup_assistant_skill.md`: the admin (`@hcm/admin`): the Setup Assistant cards and their state machine, the bootstrap order before Blaze (no server, Google REST from the browser, the automatic owner claim), the Google OAuth scopes per step, the minimum-input budget, the admin as built in M2b (boot, auth controller, Setup controller and flows, Google REST clients, provisioner, legacy import, the rules the integration taught), photos, layers, georeferencer, jobs, settings; the editors as built in M2c (the content seam, one store per area, drafts and conflicts, the admin map, what a save publishes).
- `web/ui_m3_adaptive_skill.md`: the `@hcm/ui` kit: Lit 3 without decorators, `hcm-` elements, Material 3 Expressive, dynamic colour tokens, self-hosted fonts and the icon subset, styles through the CSSOM under the page's CSP, window classes, accessibility.
- `web/i18n_skill.md`: Romanian default and source of truth, English typed against it, locale resolution, the admin's catalogues (one folder per editor area), the leak check.
- `web/web_security_skill.md`: no HTML from data, URL and id validation, CSP and headers, tokens in the browser, App Check, consent before analytics.

---

## Firebase Skills

- `firebase/functions_skill.md`: Cloud Functions v2 (`@hcm/functions`): the function registry and the callable plumbing (access rule, validation, error codes), family factories, pure handlers and thin triggers, per-function service accounts and caps (`global-options.ts`), ports and REST adapters, the composition root and the emulator's fake upstreams, `.run()` tests, secrets read at runtime, the checked deploy artifact `functions/dist/`.
- `firebase/rules_and_emulators_skill.md`: default-deny Firestore and Storage rules mirroring `CLIENT_WRITES`, the 1000-expression budget, the indexes, the rules-test personas and matrix, rule coverage, the emulators under the `demo-hcm` project (the real project is `.firebaserc`'s default), seeding and isolation.
- `firebase/analytics_and_crash_skill.md`: GA4 behind consent (never the URL hash; Performance Monitoring only in the admin), cookies expired on withdrawal, the error reporter and Cloud Error Reporting, the event taxonomy, no PII; the field measurements (Core Web Vitals through `web-vitals` in the lazy field chunks, the apps' own timings, the shared event guard and its budget).

---

## Pipeline Skills

- `pipeline/raster_pipeline_skill.md`: the Python + GDAL pipeline (`pipeline/src/hcm_pipeline`): steps, the job state machine, the synthetic georeferencing harness, determinism, the Cloud Run Job.
- `pipeline/usgs_m2m_skill.md`: USGS M2M facts (login-token, permissions, scene search, download flow, error shapes, maintenance) and the buy-scan flow.
- `pipeline/mapbox_publishing_skill.md`: Mapbox tokens (secret, minted public), MTS publishing after approval, the compute-unit guard, the free Studio path, Mapbox terms.

---

## Workflow Skills

- `workflow/human_steps_and_consent_skill.md`: what only the human does (accounts, billing, cards, passwords, token pastes, consents), how Claude drives the browser with consent per action, and the Setup Assistant deep links.
- `workflow/git_and_pr_skill.md`: branches, Conventional Commits (the `commit-msg` hook and the `commits` gate), push discipline, the pull request, CodeRabbit waves and the single Copilot review.

---

## Recommended Skill Order by Task Type

| Task domain | Primary skills | Secondary skills |
| --- | --- | --- |
| **Any change** | `quality/pipeline_skill.md` | `quality/ci_quality_gates_skill.md`, `governance/agent_asset_maintenance_skill.md` |
| **Viewer feature or bug** | `web/engine_viewer_skill.md`, `quality/e2e_scenario_matrix_skill.md` | `web/ui_m3_adaptive_skill.md`, `web/i18n_skill.md`, `quality/testing_strategy_skill.md` |
| **Admin screen or Setup Assistant step** | `web/admin_setup_assistant_skill.md`, `workflow/human_steps_and_consent_skill.md` | `web/ui_m3_adaptive_skill.md`, `firebase/functions_skill.md`, `quality/e2e_scenario_matrix_skill.md` |
| **UI component, theme or layout** | `web/ui_m3_adaptive_skill.md` | `web/i18n_skill.md`, `quality/testing_strategy_skill.md` |
| **Text or language** | `web/i18n_skill.md` | `web/ui_m3_adaptive_skill.md` |
| **Rendering data, URLs, CSP, tokens** | `web/web_security_skill.md` | `firebase/rules_and_emulators_skill.md` |
| **Cloud Function** | `firebase/functions_skill.md` | `firebase/rules_and_emulators_skill.md`, `quality/testing_strategy_skill.md` |
| **Firestore or Storage rules** | `firebase/rules_and_emulators_skill.md` | `web/web_security_skill.md` |
| **Analytics, consent, crash reports, field measurements** | `firebase/analytics_and_crash_skill.md` | `web/web_security_skill.md`, `web/i18n_skill.md` |
| **Raster pipeline, georeferencing** | `pipeline/raster_pipeline_skill.md` | `pipeline/usgs_m2m_skill.md`, `pipeline/mapbox_publishing_skill.md` |
| **USGS or Mapbox integration** | `pipeline/usgs_m2m_skill.md`, `pipeline/mapbox_publishing_skill.md` | `firebase/functions_skill.md`, `workflow/human_steps_and_consent_skill.md` |
| **A gate fails** | `quality/ci_quality_gates_skill.md` | `quality/pipeline_skill.md` |
| **Coverage below 90 %** | `quality/testing_strategy_skill.md` | `quality/ci_quality_gates_skill.md` |
| **CI, tooling or a dependency bump** | `quality/pipeline_skill.md` | `quality/ci_quality_gates_skill.md`, `governance/doc_update_skill.md` |
| **SonarQube** | `quality/sonarqube_skill.md` | `quality/ci_quality_gates_skill.md` |
| **Release** | `quality/prepare_release_skill.md` | `governance/doc_update_skill.md`, `workflow/git_and_pr_skill.md` |
| **Manual testing, the local stack** | `quality/testing_strategy_skill.md` → *The local stack* | `docs/MANUAL_TEST_PLAN.md`, `docs/SETUP.md`, `quality/e2e_scenario_matrix_skill.md` |
| **Browser work in a console (Mapbox, Google Cloud, USGS, SonarCloud)** | `workflow/human_steps_and_consent_skill.md` | `web/admin_setup_assistant_skill.md` |
| **PR review wave** | `.agents/skills/coderabbit-review-waves/SKILL.md` | `.agents/skills/resolve-pr-comments/SKILL.md`, `workflow/git_and_pr_skill.md` |
