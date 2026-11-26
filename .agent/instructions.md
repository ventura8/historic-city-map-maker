# Agent Instructions

This file is the canonical pre-task entry point for the `.agent` assets of the **Historic City Map Maker** repository (București dispărut). `AGENTS.md` at the root holds the commands, boundaries and global rules; this file is the reading order and the execution rules; `docs/LESSONS.md` holds the defects behind them.

## Mandatory Pre-Task Review

Before beginning any implementation task:

1. Read `AGENTS.md`.
2. Read `.agent/instructions.md` (this file).
3. Read `.agent/skills/SKILLS_CATALOG.md`.
4. Read every directly relevant skill and workflow file (for example `.agent/skills/quality/pipeline_skill.md`, `.agent/skills/quality/e2e_scenario_matrix_skill.md`, `.agent/skills/web/engine_viewer_skill.md`).
5. For milestone work, read the milestone's section of `docs/research/PLAN.md` and the TODO list in `docs/research/M0-handoff.md`; for M1, also `docs/research/M1-interfaces.md` (ownership, interfaces, change requests) and `docs/ENGINE_API.md`; for M2, `docs/research/M2-interfaces.md` (the Firestore model, the callable and HTTPS contracts, the ports, ownership, change requests); for M2b (the admin app), `docs/research/M2b-interfaces.md` (routes, auth states, Google OAuth scopes, the bootstrap order and the Setup Assistant's step graph, the provisioner, ownership, change requests); for M2c (the admin's editors), `docs/research/M2c-interfaces.md` (the list and detail layout per window class, the content seam, the admin map and `MapDrawPort`, drafts and live preview, each area's screens, ownership and the marked sections of the shared files, change requests); for M3 (the first historical layers), `docs/research/M3-interfaces.md` (the USGS harvest and ranking, layer versions, the job model and its dispatcher, the pipeline's steps and golden contracts in `pipeline/tests/contracts/`, publishing behind the compute-unit guard, uploads, links and the address guard, the Imagery area and the georeferencer, ownership of the four workstreams, change requests) and `docs/research/M3-status.md` (what works on the emulators, what waits for the real cloud and the user); for M4 (automation), `docs/research/M4-interfaces.md` (buying a scan and the daily order watch, automatic GCP suggestions and the georeferencer's Accept, swipe compare as a lazy chunk of the engine, the title and translation assists, the notification events, inbox and push, ownership of the five workstreams and the marked sections of the shared files, change requests) and `docs/research/M4-status.md` (what works on the emulators, the cross-app journey A48, what waits for the real cloud and the user); for M5 (multi-city), `docs/research/M5-interfaces.md` (what still assumed Bucharest, city roles and membership, per-city access in the rules and the callables, the city switcher and the New city flow, per-city budgets, the Pages layout, engine releases on jsDelivr with `cdn/engine/release.json` and SRI, the starter-kit template, `create-historic-city`, the static export, ownership of the four workstreams, change requests) and `docs/research/M5-status.md` (what works on the emulators, the cross-app journey A54, the prepared v1.0.0 and what waits for the user); for M6 (Setup with no terminal), `docs/research/manual-test-2026-10-25.md` first (the user's live manual test of 2026-10-25, findings 1–24 with the user's requests and decision: the milestone's source of truth) and `docs/research/M6-interfaces.md` (the in-app installer on Cloud Build with its `hcm-installer@` account, the install bundle and the three targets, what Provision adds, the progress and status model; the public map on Firebase Hosting with the admin under `/admin/`; every finding's owner and rows; the new step graph and its input budget; the four workstreams installer, hosting, server-bugs and setup-ux); for M7 ("Run on my computer" and the cheap cloud defaults, the user's decisions of 2026-11-01), `docs/research/M7-local-worker.md` (the worker mode of the pipeline image and its local sign-in page, the five `worker.*` callables and their allow-lists, where a job runs and `imagery.runOn`, Cloud Run's free-tier count and the OK, the raw delivery deleted after `locate`, Mapbox's Uploads API path, the `worker` chunk, the security review); for M8 (a whole-city layer by joining one date's frames, the owner's request of 2026-11-06), `docs/research/M8-join-interfaces.md` (the design in §1 to §10, what was built in §11 to §16: `imagery.join`, the `layer-join` job with `align` and `merge`, the date plan, the target years); for M12 (a layer's tiles from the project's own bucket, the owner's decision of 2026-11-07), `docs/research/M12-own-tiles.md` (the design, and its addendum: what was built and the contract for the viewer and the approval view); for M17 (stories, the owner's decision of 2026-11-08), `docs/research/M17-stories.md` (the document and who may write it, the safe text format with figures of the city's photos, the additive `stories` list of the manifest and `#story=`, the viewer's sheet, the admin's area and the review queue); for M18 (the owner's nine improvements of 2026-11-08), `docs/research/M18-improvements.md`.
6. Do not write or modify code until this review is complete.

---

## Fix Order and Gates

Work through failures in this order, and never lower a gate to get past one:

1. **Format**: Prettier (TS, JS, JSON, YAML, CSS), `ruff format`, `shfmt`, `taplo fmt`.
2. **Lint**: the suppression scan, skill mirrors, agent assets, data files, EditorConfig, the scenario registry, i18n parity, `tsc -b`, ESLint, stylelint, HTML linters, markdownlint, knip, dependency-cruiser, yamllint, taplo, ruff, mypy, radon, bandit, shellcheck, hadolint, actionlint and the workflow checks (schemas, timeouts, action pins, the workflow policy), the repo policy (secret files, exact pins, image digests) and budget, gitleaks (tree and CI commit range), the CI tooling's own tests, the audits.
3. **Tests**: Vitest (node projects and the Chromium browser project) and pytest.
4. **Coverage**: 90 % or more per file, lines and branches (Vitest per file, then the `coverage` gate over the Sonar scope); add behaviour tests, never exclusions.
5. **E2E**: the Playwright specs behind the firewall and console guard (today the harness smoke; the tiers under the Firebase emulators and mock APIs from M1).

The stages, their gates and the meaning of `quality` and `all` are defined once, in `quality/pipeline_skill.md` → *Stages*. Every gate and how to fix it: `quality/ci_quality_gates_skill.md`.

---

## Mandatory Markdown Update (Every Task, No Exceptions)

- Every change updates the documentation that describes it, in the same task: application code, UI, functions, rules, the pipeline, CI, dependency bumps, lint configuration and tooling alike.
- Sync every impacted file among `README.md`, `docs/*.md`, `.agent/**`, `.agents/skills/**` and `.claude/skills/**`.
- `docs/research/` is the verbatim record of the research and the approved plan: append dated addenda, never rewrite it, and keep it markdownlint-clean (blank lines around headings and lists).
- Treat documentation as a deliverable, not a chore. A task is not closed until its docs are.

---

## Cost, Push and Secrets Discipline (Hard Rules)

- **Never push before the local pipeline is green**: `bash scripts/ci/run-all-checks.sh` (default `all`) ends in `[SUCCESS] stage 'all' passed` before any push to `master` or a tag. Pushing `master` or a tag is ask-first; pushes of the work branch `feat/engine-rewrite` are pre-approved (the user, 2026-10-12) once the code that changed is tested (the user, 2026-10-31): `static`, `tests` and `build` green plus targeted Playwright runs of the specs the change touches; the full `all` is for `master` and tags only. `all` ends with the `sonar` stage, which skips with a notice (and passes) without a SonarCloud token.
- **Cloud cost**: Mapbox map loads and MTS compute units are billed beyond the free tier, so tests never hit Mapbox, the viewer creates one map per view, and MTS publishes only after approval within the compute-unit guard. The GCP budget ($5) alarm pauses the raster pipeline and MTS, never the public site.
- **Human-only steps**: account creation, billing and card entry, terms acceptance, passwords, Google sign-in consents and token pastes are done by the user. Claude opens the exact page, explains the step and verifies the result; it never types the credential. Every accept, submit, publish, purchase or settings change in a browser is confirmed by the user in chat first, one at a time.
- **Secrets never leave their place**: Mapbox and USGS secrets live only in Secret Manager (written by the `setup.*` callables); `SONAR_TOKEN` is the only repository secret; GCP access from CI is keyless (Workload Identity Federation). Local secrets (`.env.local`, `.sonar-token`, `.secret.local`) are git-ignored and never opened, printed or pasted.
- **Pre-approved config edits** (the user, 2026-10-12): an edit to a lint or tool config, a workflow or the gitleaks files that makes a gate stricter or keeps a tool working is applied, verified with the stage that covers it, and logged in `docs/research/DECISIONS-for-review.md`. Hosting deploys and Setup's Update the map are pre-approved (the user, 2026-11-11; DECISIONS §142). Relaxing a gate, `.claude/settings.json`, payments and other cloud changes stay ask-first.
- **Never use** a `fostulbucuresti` resource, or Mapbox Satellite as a georeferencing reference.

---

## Global Execution Rules

- **Run the pipeline, not a subset**: `scripts/ci/run-all-checks.sh` is what CI runs. Ad-hoc tool runs are for iterating only and happen inside `hcm-quality:local` (`.agent/workflows/test.md`).
- **Architecture constraints** (`docs/ARCHITECTURE.md`):
  - The public viewer reads only the static manifest and photo files from the public bucket; it never reads Firestore and loads no Firebase SDK for data.
  - Only the engine's Mapbox adapter touches `mapbox-gl`; the core talks to a `MapPort` interface and is tested against a fake map. `mapbox-gl` stays external (global `mapboxgl`, v3.34.1).
  - Cloud Functions are pure handlers with injected ports plus thin triggers; Cloud Run Admin and Secret Manager are called over REST so tests can mock them.
  - Every Firestore writer validates with the shared zod schemas from `@hcm/shared`; rules are default-deny.
- **Lit without decorators**: `static override readonly properties`, `declare` fields, defaults in the constructor, an idempotent `define…()` function, the `hcm-` element prefix (`web/ui_m3_adaptive_skill.md`).
- **No HTML from data**: Lit templates and `textContent` only (`web/web_security_skill.md`).
- **Quality and coverage**: every new file, function and branch has tests; per-file coverage of 90 % or more, lines and branches. A new failure branch is covered by a test that causes the failure from outside (a 404 manifest, a revoked token, a 503 from USGS), not by calling a private path.
- **Scenario matrix discipline**: every behaviour has a happy and a bad row in `e2e/scenarios.json`. Change the behaviour, change the row and the test; a row without its test says `planned`.
- **Zero inline suppressions**: relax a rule only in the tool's repository-wide configuration file, with the reason next to it.
- **Logging standard**: TypeScript logs only through `createLogger(scope, …)` from `@hcm/shared` (secret-looking keys are redacted); Python CI scripts through `scripts/ci/cilog.py`; the raster pipeline through its own logger with the same redaction. Never `console.*` or `print`.
- **i18n**: Romanian is the default and the key source of truth; English is typed against it, so a missing key is a compile error (`web/i18n_skill.md`). That is the app's texts only: every Markdown file of the repository (docs, READMEs, skills, the kit's and the CLI's READMEs, the Markdown a generator writes) is in English only, quoting a Romanian UI label where it documents one (the owner, 2026-11-10; DECISIONS §157).

---

## Agent Asset Maintenance (Every Task, No Exceptions)

Every task ends with the agent assets brought up to date, in the same task:

- Update the affected skills in `.agent/skills/` and workflows in `.agent/workflows/`.
- Update `.agent/skills/SKILLS_CATALOG.md` whenever a skill is added, renamed or its scope grows.
- Keep `.agents/skills/` and `.claude/skills/` byte-identical: edit the `.agents/skills/` copy, then `cp` it over the mirror.
- Write down what was learned (a tool quirk, a decision and its reason, a bug a test caught, a rule the user gave) in the file that owns the subject: `governance/agent_asset_maintenance_skill.md` → *Where a lesson goes*. Chat and commit messages are not project memory.
- Every repository path written in back-ticks must exist or be listed under *Planned paths* in `docs/research/M0-handoff.md`; remove a planned entry in the task that creates the file.

---

## Working on the Developer Machine

- Linux; Docker is the only runtime for gates. The host has Node 22 and npm 9, which are too old (`engines` requires Node 24.12 or later) and are never used.
- `npm install` of a new dependency runs in `node:24-bookworm-slim` pinned by digest (`docs/SETUP.md` → *npm in a container*); pin the exact version after checking it with `npm view`. A new workspace also needs a `COPY` line in `docker/Dockerfile.quality`.
- The quality image clears `LD_PRELOAD` (the GDAL base preloads tcmalloc, which crashes Chromium). A crashed browser leaves `core.<pid>` in the repository root; it is git-ignored, delete it.

---

## Documentation Completion Rule

Do not close a task until all impacted documentation, the coverage badges (once `scripts/ci/check_coverage.py` writes them), the scenario registry and the agent assets are synchronized with the work just completed.
