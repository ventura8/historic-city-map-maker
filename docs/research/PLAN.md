# Plan: București dispărut → Historical City Map Engine + Bucharest site + "do-everything" Admin

## Context

The repo `ventura8/bucurestiuldisparut.github.io` (renamed `ventura8/historic-city-map-maker` on 2026-11-12, `DECISIONS-for-review.md` §161) is public, forked from `fostulbucuresti`, and served by GitHub Pages from `master`. Today it is a 2015–2022 hand-written Mapbox GL v2.6 page:

- 9 hard-coded historical layers, all owned by the `fostulbucuresti` Mapbox account
- a destroyed-streets tileset
- 44 geotagged photos with 34 view cones (`geojson/photos.json`, `photos/`, `thumbnails/`)

The user wants `master` overwritten with the app designed in the Gemini chat:

- a **data-driven core engine served from a CDN**, plus a **3-file city starter kit**, so anyone can host their own city
- **Bucharest** as the first city
- an **admin that does everything with minimum admin input**: account and billing setup assistance for Mapbox, Google Cloud and USGS; finding, buying and downloading USGS imagery; automatic georeferencing, tiling and publishing; photo management

Quality bar:

- every linter, unit test and e2e test for all scenarios
- **≥90% coverage on every file**
- SonarQube, with conventions copied from the user's sibling repos
- the **latest Material Design**, adaptive to every resolution

### Fixed decisions

- **No `fostulbucuresti` resources** (tilesets, style, token, streets).
  - Satellite layers come only from USGS imagery we acquire.
  - The 1927, 1938 and 1943 aerials were not USGS, so they are dropped. They can return later through "Upload GeoTIFF" if originals are obtained.
- **Data and accounts:**
  - The 44 photos, cones and metadata from the repo are migrated.
  - Mapbox account **ventura86**.
  - Firebase **Blaze**; the user adds billing.
  - **Admins only**.
  - **RO + EN, default RO**.
  - The user has **no USGS account yet**.
- **Mapbox terms:** Mapbox Satellite must never be used to align imagery. The georeferencing reference is OSM data plus open Sentinel-2.
- **No credentials from me:** I never create accounts, type passwords, enter card details or paste tokens. The human does these few steps; the app and I take them to the exact button.

## What you will have to do (everything else is automated, or done by me)

Start these on day 0, in parallel; they unblock everything:

| # | Action (human-only) | Time | Who/what helps |
| --- | --- | --- | --- |
| 1 | Google Cloud: create a billing account (card) | ~3 min | Deep link. I then link it to the project and create a $5 budget with alerts (you say "yes"). |
| 2 | Mapbox (ventura86): billing address + card (the console already blocks on "confirm billing information") | ~3 min | Deep link. Then I set usage alerts in Chrome. |
| 3 | USGS: create an ERS account; submit the M2M access request (pre-written text; I can fill it, you submit) | ~5 min | Wizard. USGS approves in 24–48 business hours. |
| 4 | Approve the Google sign-in consents: gcloud + Firebase CLI, then your first admin sign-in | 3 clicks | |
| 5 | Paste two secrets once, in Admin › Setup: the Mapbox `sk` token (I tick the scopes for you in Chrome) and the USGS app token (shown for 60 s; the paste box opens first) | 2 pastes | Live verification. The Mapbox public token and username are then derived and minted automatically. |
| 6 | SonarCloud: run one command to store the token, `gh secret set SONAR_TOKEN` | 1 paste | |
| 7 | Later, only if you want unscanned frames: pay USGS for scan orders ($30/frame + $5/order) | per order | The app prepares the order, tracks it and auto-imports when delivered. |
| 8 | Say "yes" in chat before pushes, deploys, settings changes, downloads and terms acceptance | — | |

## Architecture

```text
            ┌──────────────── this repo (npm workspaces monorepo) ─────────────────┐
 tag vX ───►│ packages/engine → dist/engine.{iife.js,mjs,css} ──► jsDelivr @1 (other cities)
            │ packages/admin  → dist/admin.*  ──► Firebase Hosting <proj>.web.app (own origin) + jsDelivr
            │ packages/{shared,ui,test-support}                                       │
            │ sites/bucharest (index.html+config.js; engine copied same-origin) ──► GitHub Pages
            │ starter-kit/ (template + static-manifest mode, no backend needed)        │
            │ functions/ (Firebase Functions v2, TS, Node 24) ──► us-central1          │
            │ pipeline/ (Python + GDAL container) ──► Cloud Run Jobs (std 4cpu/16G, xl 8cpu/32G)
            │ firebase/ (rules, indexes, firebase.json) infra/ (bootstrap/doctor)      │
            └──────────────────────────────────────────────────────────────────────────┘
 Public viewer ─GET→ gs://<proj>-public/cities/{city}/manifest.json + photo webp (no Firestore, no Firebase SDK)
 Admin ─Auth/Firestore/Storage(private)/callables→ Functions → Secret Manager · USGS M2M · Mapbox APIs · Cloud Run Admin (REST)
 jobs doc ─trigger→ Cloud Run Job (GDAL) → GCS COG/preview → [admin approves + CU guard] → Mapbox MTS → layer published → manifest rebuilt
```

Why this shape:

- **Server-side calls are required.** USGS M2M allows no CORS outside `*.usgs.gov`, and secrets must stay server-side.
- **Cloud Run instead of GitHub Actions** for GDAL work:
  - Actions logs are public and would leak signed USGS URLs.
  - No GitHub token or service-account key is needed anywhere.
- **The public site never reads Firestore**, which avoids the read quota and abuse risk.
- **The admin gets its own origin**, because `ventura8.github.io` is shared by all your Pages sites.
- **Region:** `nam5` Firestore, everything in `us-central1`. That is where the free tiers apply and it avoids cross-region triggers.

### Data (Firestore; zod schemas in `packages/shared` are reused by every writer)

- `cities/{city}`:
  - `name{ro,en}`, `center`, `zoom`, `bounds`, `about{ro,en}`, `credits[]`
  - `theme{seed, tokensCss}`, `basemap`, `mapbox{user, publicToken}` (auto)
  - `published`
- `cities/{city}/layers/{id}`:
  - `year`, `date`, `label{ro,en}`, `kind`, `sensor`, `attribution`
  - `source{type: mapbox|xyz|pmtiles, …, minzoom, maxzoom, bounds}`
  - `order`, `opacity`, `status`, `published`
  - `provenance{usgs…, georef{method, gcps[], checkpointRmseM}}`
  - `mapbox{tilesetId, publishedSourceSha}`
- `cities/{city}/photos/{id}`:
  - `title{ro,en}`, `description{ro,en}`
  - `year[…End]`, `author`, `license` (enum), `rightsHolder`, `links[{url,label}]`
  - `location`, `bearing`, `fov`
  - `image{web, thumb, sha256, w, h}`, `processing`, `published`
  - `rightsReview`, `legacyId`
- Also: `usgsScenes/{entityId}`, `jobs/{id}` (+ `logs`), `admins/{uid}`, `setup/status` (non-secret health), `usage/mapbox-YYYY-MM`, `ops/guard`.
- **Two buckets:**
  - private `<proj>.firebasestorage.app`: uploads, rasters, USGS raw files, browse copies
  - public `<proj>-public`: manifest, `web.webp` and `thumb.webp` only, content-hashed and immutable
- Legacy HTML in `source`/`description` is migrated to structured `links`. **No HTML is ever rendered from data.**

### Cloud Functions (TS; pure handlers + thin triggers; Cloud Run/Secret Manager via REST so tests can mock them)

- **`setup.*`:**
  - `saveMapbox`: validate the `sk`; derive `user`; verify scopes; mint a scoped `mapbox-sk-tiles`; **auto-mint URL-restricted public tokens** for the viewer (`https://ventura8.github.io`) and the admin.
  - `saveUsgs`: `login-token` + `permissions`; poll for M2M approval every 6 h; auto-flip and notify.
  - `status`, `selfTest` (IAM/permissions smoke), `rotatePublicToken`.
  - Secrets go to Secret Manager and are read at runtime with a cache, so no redeploy is needed.
- **`usgs.*`:**
  - Harvest on city creation and monthly: `scene-search` over the bbox × `corona2`/`declassii`/`declassiii`. Browse JPEGs are copied to our bucket.
  - Rank scenes by coverage, centre position, resolution, and free vs paid.
  - `markOrdered`; a daily `download-options` watch auto-imports a scene when it becomes available. Reminders go out on days 7 and 12, because USGS deletes unpaid orders.
- **Jobs and ops:**
  - `jobs.onCreate`: transactional dispatch of the Cloud Run Job.
  - `ops.tick` (every 15 min): resume waiting jobs, poll MTS, nightly full manifest rebuild, health checks, stale-user cleanup.
  - `ops.onBudget`: pause pipeline/MTS on budget alarm (never touches the site).
- **Content:**
  - `photos.onUpload`: sniff magic bytes; sharp → WebP 2048 + 400; strip EXIF from public files; sha256 dedupe; EXIF/filename → location, year and bearing suggestions.
  - `publish.*`: diff-gated triggers → Cloud Tasks builder (serialized, debounced, incremental) → `manifest.json`.
  - `admins.invite` (email-link sign-in).
  - `assist.*` (M4): Nominatim title suggestions (Cloud Tasks queue at 1 req/s, cached, attributed); RO↔EN drafts via Vertex AI Gemini server-side (the EEA requires the paid tier; < $0.05/month).

### Raster pipeline (Python + `osgeo.gdal` from the pinned `ghcr.io/osgeo/gdal` image; Poetry)

Short, idempotent, resumable steps:

1. `fetch`: M2M with deterministic labels → resumable stream into GCS → extract only the needed segments.
2. `locate/crop`: corner homography → city window ± margin; `-srcwin`; aft-frame rotation.
3. `georef`:
   - M3: first guess from the corners, plus admin GCPs from the editor.
   - M4: automatic GCP suggestions (CLAHE + SIFT/RANSAC vs Sentinel-2 → pre-warp → tile matching) with checkpoint RMSE.
4. `warp`: `-tps` / `-order 2` → EPSG:3857, zoom-aligned bbox (z16 KH-4, z17 KH-9 pan/KH-7, z15 KH-9 mapping).
5. `export`: 8-bit COG + preview + DZI tiles of the raw crop (OpenSeadragon).
6. `publish` (only after approval, or auto when RMSE < threshold):
   - The **CU guard** estimates compute units against a month-to-date counter.
   - Over budget offers: "free Studio upload (≤300 MB, I do it)", "defer to next month", or "pay ~$X".
   - MTS uses a deterministic tileset id per layer, then polls the job.

Job state machine:

- leases and heartbeat; `waiting_usgs` with backoff for maintenance (503 HTML)
- re-login at 100 min; cancel flag
- OOM → re-dispatch on the `-xl` job; logs are redacted

### Engine (public viewer, `<bd-map-viewer>`)

- **Config:** `config.js` has `{cityId, manifestUrl}` or an inline static manifest (starter kit, no backend). The manifest is zod-strict.
- **Map:** Mapbox GL **3.32.0** (external), Standard Satellite basemap. Historical rasters sit in slot `middle`, with 3D buildings off while a historical layer is shown.
- **Timeline and layers:** year scrubber, layer toggles, opacity, lazy swipe-compare (2nd map only on demand).
- **Photos:** clustered camera icons rotated by bearing; view cones at high zoom; bottom sheet (compact) or side sheet (≥ medium); lightbox; "photos near this year".
- **Other:** URL hash state + `#photo=`; share; geolocate; About/credits/privacy notice (RO/EN).
- **Settings:** `performanceMetricsCollection:false`. Mapbox logo and attribution are always visible.

### Admin

- **Setup Assistant** (first screen until green; re-checkable any time):
  - Google Cloud, Mapbox and USGS cards, each with status chip, why + cost, a verified deep link, "do it for me" where possible, paste box + live verification, auto-advance.
  - USGS card adds a 60 s token countdown and M2M approval auto-detection.
- **Photos:**
  - drag-and-drop batch; auto-filled from EXIF and filename (year), with the last pin as fallback
  - sticky author/source/license
  - "click what the camera looked at" sets the bearing; default FOV 60°
  - published on save; rights-review queue for legacy photos
- **Satellite layers:**
  - "Find imagery for Bucharest" with ranked scenes and footprints/browse previews on the map
  - "Import (free)" for already-scanned frames
  - "Buy scan" (EarthExplorer deep link `…/scene/metadata/full/{datasetId}/{entityId}/`, cost, payment guide, tracking)
  - "Upload GeoTIFF"; "Link tileset/XYZ"
  - pre-seeded suggestions: 1966-07-12 KH-4A, 1976-02-20, 1977-09-13, 1980-07-16 KH-9, 1978-03-30 KH-9 mapping
- **Georeferencer:**
  - OpenSeadragon raw crop vs reference map (OpenFreeMap/OSM + Sentinel-2 cloudless)
  - residual table, transform choice (`@allmaps/transform`), live overlay preview, snap to OSM intersections
- **Jobs** (live), **Settings** (draw bounds, About, seed colour with live M3 preview), **Admins** (invite / revoke).

### UI: Material 3 + M3 Expressive, adaptive

Google's `@material/web` is in maintenance mode, and per m3.material.io "Expressive is not implemented on Web". So:

- **Lit 3** custom elements; no decorators (cleaner coverage).
- **Components:** M3E `@m3e/web` (pinned) for Expressive components; stable `@material/web` 2.5.0 form controls in the admin. Everything sits behind our own `bd-*` wrappers in `packages/ui`.
- **Colour:** `@material/material-color-utilities` (2025/2026 spec) generates light, dark and high-contrast `--md-sys-color-*` tokens from the city seed colour. The admin precomputes them into the manifest.
- **Shape and motion:** shape scale; spring-derived motion curves; reduced motion honoured.
- **Fonts:** self-hosted Roboto Flex and subsetted Material Symbols (no Google Fonts, for GDPR).
- **Breakpoints** are measured on the host element with container queries + ResizeObserver → `map.resize()`:
  - compact <600, medium 600–839, expanded 840–1199, large 1200–1599, extra-large ≥1600
  - compact-height (<480) for landscape phones
- **Accessibility and layout details:** 48 dp touch targets, safe areas, `dvh`, logical properties. The drawer is not used; the admin uses a rail.

### Security and cost guards (summary)

- **Firestore and Storage rules:** default deny; admin = claim + `admins/{uid}` exists; strict field validation; size and type limits; no SVG.
- **App Check** (reCAPTCHA Enterprise) on admin, Firestore and callables.
- **CSP:** strict on Hosting; meta CSP on Pages. ESLint bans `innerHTML`/`unsafeHTML`.
- **Accounts and credentials:**
  - Least-privilege service accounts: `fn-admin`, `fn-events`, `job-raster`, and `gh-deployer` via **WIF** (no keys). Bootstrap checks org policies.
  - Owner admin is granted by a bootstrap script; no email is in the repo.
- **Budgets:**
  - GCP: $5 budget → Pub/Sub guard; per-function `maxInstances`.
  - Mapbox: usage alerts; one map per view; ≤24 tilesets without approval; tests never hit Mapbox.
- **Expected cost:**
  - ≈ $0.5–2/month GCP.
  - Mapbox $0 within 50k map loads; MTS backlog spread across months, or the free Studio path.

## Repo layout & quality system (mirrors the user's sibling repos)

```text
packages/{shared,ui,engine,admin,test-support}/{src,test}   functions/{src/{triggers,handlers,ports,adapters},test}
pipeline/{pyproject.toml,Dockerfile,src/hcm_pipeline,tests/{unit,integration,synthetic}}
firebase/{firebase.json,.firebaserc,firestore.rules,storage.rules,firestore.indexes.json,rules-tests/}
sites/bucharest/  starter-kit/  e2e/{specs,tour,a11y,mock-apis,fixtures}  infra/{bootstrap,doctor}
scripts/ci/*  scripts/git-hooks/*  docker/Dockerfile.quality  docs/  AGENTS.md CLAUDE.md .agent/ .agents/ .claude/
```

- **Pipeline entry:** `scripts/ci/run-all-checks.sh`, with `PIPELINE_STAGE` = static | tests | e2e | build | sonar | deps | release.
  - `quality` = static → tests → e2e → build (CI); `all` = quality + sonar (local, before push).
  - Runs **only inside the pinned Docker image**: Node 24, JDK 21, GDAL, Playwright, linters. The repo is mounted at the same path, with no host-home mount.
- **Static gates:**
  - no-inline-suppressions script; skill mirrors; agent-asset budgets; data files; editorconfig
  - Prettier; ESLint (typescript-eslint strictTypeChecked + sonarjs + no-unsanitized; complexity 5; 400/60/4 size limits); `tsc -b` (TS 6.0.3, held)
  - stylelint; htmlhint + html-validate
  - ruff (C90 = 5); mypy strict; radon A; bandit
  - yamllint; actionlint; markdownlint; taplo; shellcheck/shfmt; hadolint
  - gitleaks; npm audit / pip-audit; knip; dependency-cruiser; i18n key parity; action-pin; repo and bundle budgets
- **Unit tests:**
  - Vitest 5: projects shared/ui/engine/admin/functions/rules; browser mode for Lit; fake MapPort; msw with shared API fixtures; emulator-backed function handlers.
  - Rules tests with a rule-coverage gate.
  - pytest with synthetic scans (known GCPs → recovered transform within tolerance) and fake M2M/MTS. Non-loopback sockets are blocked.
- **Coverage:** `check_coverage.py` reads its scope from `sonar-project.properties` and fails if **any file < 90%** (lines + conditions, Sonar scoring), or if a file is missing or stale. Writes a badge and summary.
- **E2E: Playwright 1.64 + axe**, under Firebase emulators + mock APIs (USGS, Mapbox, STAC, Nominatim, AI). A firewall fixture proves no real network is hit and no Firestore calls come from the viewer. A map-instance counter checks one map per view.
  - Tiers:
    - functional matrix at c360/m768/l1440 (RO), plus EN and dark variants
    - layout + a11y **tour** over **11 viewports** (320×568 … 3840×2160, incl. 915×412 landscape) × light/dark × RO/EN
    - reduced-motion, forced-colors and no-WebGL projects
    - Firefox/WebKit admin forms
    - pipeline compose tier
  - Scenarios: **V01–V18 viewer, A01–A21 admin, P01–P02 pipeline**, with ≥1 happy and ≥1 bad row each. The registry `e2e/scenarios.json` is cross-checked against the tests in both directions and generates `docs/E2E_SCENARIOS.md`.
  - An **admin-input budget fixture** asserts the click/fill counts per flow (e.g. Mapbox setup ≤ 2, import a free scene ≤ 2).
- **SonarCloud** (org `ventura8`, key `ventura8_bucurestiuldisparut.github.io`, Automatic Analysis off):
  - CI job: SHA-pinned scan + quality-gate actions, then `sonar_report.py` (gate OK, 0 issues, 0 hotspots, 0 duplications, coverage ≥ 90).
  - Local `sonar` stage with the pinned scanner image.
- **CI workflows** (SHA-pinned, least privilege):
  - `ci.yml`: image → static → tests / e2e(shards) / build → sonar → deploy on master (Pages + Firebase via WIF + Cloud Run image).
  - `release.yml`: engine tags → jsDelivr.
  - `deps.yml` (weekly latest-stable); `contract.yml` (weekly deep-link and API drift); `codeql.yml`.
- **Git hooks:** pre-commit (suppressions, gitleaks, forbidden files); pre-push (green `all` marker for master/tags).
- **Agent assets** in Watch-GPS layout:
  - `AGENTS.md` (≤24 KB) + `CLAUDE.md` (`@AGENTS.md`)
  - `.agent/` + SKILLS_CATALOG
  - `.agents/skills` byte-mirrored to `.claude/skills`
  - subagents: pipeline-runner, e2e-matrix-auditor, docs-sync-checker, golden-reviewer
  - docs: ARCHITECTURE, CI_PIPELINE, TESTING, SETUP, LESSONS, ADMIN_GUIDE.ro/en, E2E_SCENARIOS, research/
- **Repo conventions:** Conventional Commits with the Co-Authored-By trailer; `master` kept; Linux only.

## Delivery milestones (each one shippable and green; work on branch `feat/engine-rewrite`; tag `legacy-2022` first)

- **M0 (day 0):** you start steps 1–3 above (the slow ones).
  - Research artifacts are copied into `docs/research/`.
  - Monorepo, Docker quality image, all gates, CI and agent assets are scaffolded.
  - gcloud is installed (download approval).
- **M1, engine + migration:**
  - `shared` schemas, the `ui` M3 kit, the viewer engine with migrated photos/cones via a static manifest, the starter kit
  - full unit + e2e viewer matrix; Sonar green
- **M2, backend and go-live (I ask before overwriting master):**
  - `infra/bootstrap`: project, Blaze link, budget, APIs, Firestore, buckets/CORS/lifecycle, Auth, App Check, service accounts, WIF.
  - Rules, functions (setup, photos, publish, admins), admin with Setup Assistant + Photos + Settings.
  - Photos migrated to Storage. Bucharest goes live on Pages and the admin on `<proj>.web.app`.
- **M3, first historical layers:** USGS harvest + ranking; free import; Cloud Run pipeline (corner guess + georeferencer); approval; CU guard; MTS/Studio publish.
  - Target the 1966, 1976, 1977, 1978 and 1980 frames (likely already scanned, so free).
- **M4, automation:** buy-scan flow + order watch + auto-import; auto-GCP suggestions; swipe compare; Nominatim/AI assists; notifications.
- **M5, multi-city:** engine releases on jsDelivr, starter-kit template repo, `create-historic-city` bootstrap (self-host), static export.
- **Execution approach:** each milestone runs as multi-agent workflows (per package, in worktrees), followed by adversarial review and the full pipeline before merge.

## Verification

- `PIPELINE_STAGE=all bash scripts/ci/run-all-checks.sh` prints `[SUCCESS] stage 'all' passed`. This covers every gate, per-file coverage ≥90% for TS, Python, functions and rules, and the e2e matrix with all happy/bad rows present.
- SonarCloud quality gate passes with 0 issues and 0 hotspots; CI is green on the PR.
- Playwright MCP visual check of the viewer and admin at the 11 viewports, light/dark, RO/EN.
- After deploy:
  - `setup.selfTest` is all green (IAM, secrets, Cloud Run, MTS).
  - The live site loads with exactly 1 map load, photos render, and the layer toggles work.
  - The admin sign-in creates the owner claim.
- Opt-in `real-data` stage: import one free Bucharest Corona frame end to end, report checkpoint RMSE, publish a draft, then verify it in the viewer.
- Weekly `contract.yml` keeps the Setup Assistant deep links and the API shapes honest.

## Addendum (2026-10-11, user direction): every human step happens inside the app

The user will perform all of their own steps through the admin Setup Assistant, as any city admin would. Therefore:

- **Google Cloud billing / Blaze inside the app.** Google sign-in requests extra OAuth scopes (cloud-billing; cloud-platform for provisioning). The admin then calls Google REST APIs directly from the browser:
  - `cloudbilling.googleapis.com` lists billing accounts and reads `projects/{id}/billingInfo`.
  - When no account exists, the app gives a deep link to create one (the card is entered on Google's page), then polls until the account appears.
  - One click links the account (Blaze) and creates the $5 budget through `billingbudgets.googleapis.com`.
- **"Provision cloud" step.** After Blaze is active, one click runs an idempotent provisioner from the admin, using the admin's OAuth token: enable APIs, create service accounts and IAM bindings, buckets with CORS and lifecycle, the WIF pool and provider for CI, and Secret Manager secrets. A re-checkable "doctor" shows per-item status.
- **What I do instead of the user:**
  - The only out-of-app actions I take are the initial Firebase project creation and the first deploy of the admin. Both need the user's explicit yes, for terms and consent.
  - All other external pages (Google billing account, Mapbox card, USGS ERS, USGS orders) are opened by the app through deep links, and completion is auto-detected.
- **Overnight work is local only.** No cloud resources are created, nothing is pushed, and no consents are clicked without the user. Everything is built and verified against emulators and mock APIs.

## Addendum 2 (2026-10-11): Firebase project created + crash/analytics support

- **Firebase project `bucurestiul-disparut`** (number 804854330662) was created by Claude with the user's explicit OK.
  - Analytics and Gemini are off at creation.
  - Firestore `(default)`: Standard edition, `nam5`, production rules.
  - Auth: Google provider enabled, public name "București dispărut". Authorized domains: localhost, bucurestiul-disparut.firebaseapp.com, bucurestiul-disparut.web.app.
  - Web app `historic-city-map`, appId `1:804854330662:web:c38656d443d7f18d3d7de7`, linked to Hosting site `bucurestiul-disparut`.
  - Plan: **Spark** until the admin links billing in-app.
  - The web config is never committed. The admin reads `/__/firebase/init.json` on Hosting.
- **Analytics (user request: "full firebase support for crashes and analytics"):**
  - Google Analytics for Firebase (GA4) through `firebase/analytics`, in both the public viewer and the admin.
  - Loaded **only after consent**: M3 consent banner (RO/EN), Consent Mode v2 defaults denied, `analytics_storage` granted on accept. The decision is stored and can be withdrawn in About.
  - Events: `page_view`, `layer_toggle`, `year_change`, `photo_open`, `share`, `compare_open`; admin flow events for setup steps and imports. No PII.
  - Firebase Performance Monitoring (`firebase/performance`) is likewise consent-gated.
  - The viewer still never reads Firestore. Firebase app + analytics + performance are lazy-loaded only when the manifest has a `measurementId` and the visitor consented.
  - Setup Assistant card "Analytics & crash reporting":
    - deep link to enable Google Analytics on the project (the GA terms are accepted by the admin)
    - auto-detects the `measurementId` via the Firebase Management API (`webApps/{id}/config`)
    - writes it to the city doc and the manifest
- **Crashes:** Crashlytics is mobile-only, so web gets the equivalent:
  - Global `error`/`unhandledrejection` handlers plus Lit/engine error boundaries.
  - GA4 `exception` events (fatal flag) after consent.
  - A `telemetry.reportError` HTTPS function, rate-limited, App Check on the admin and origin-checked on the viewer. It sends redacted stack, release, viewport and breakpoint as structured logs with `@type: type.googleapis.com/google.devtools.clouderrorreporting.v1beta1.ReportedErrorEvent`. That gives **Cloud Error Reporting**: grouped crashes, first-seen alerts and email notifications.
  - Source maps are uploaded as release artifacts for de-minification in reports.
  - Functions and the Cloud Run pipeline report through structured error logs.
  - The Setup Assistant shows a "Crash reports" panel listing the latest Error Reporting groups (through a callable).
- **Tests:** consent gating (no GA request before consent, verified by the e2e firewall), event payload unit tests, the error-reporter redaction and rate limit, and an e2e for crash → `telemetry.reportError` with a mocked endpoint. CSP is updated for googletagmanager, google-analytics, firebaseinstallations and firebaselogging hosts.

## Addendum 3 (2026-10-12, user direction): edit anything, POIs, live transparency for every overlay

### Admin can edit anything

- **Ground photos**:
  - metadata (RO/EN), year range, author, license and links
  - location by drag; bearing and FOV by handle
  - replace the image (derivatives regenerate), publish/unpublish, delete
- **POIs (new entity)**: points of interest beyond photos, such as places, buildings, demolished streets, events or notes.
  - Firestore `cities/{city}/pois/{id}`:
    - `category` (from a city-defined list with icon and colour)
    - `geometry` (GeoJSON Point / LineString / Polygon), `title{ro,en}`, `description{ro,en}` (markdown subset)
    - `yearStart`/`yearEnd`, `links[]`, optional `photoIds[]`, `published`
  - Admin draws and edits the geometry on the map: vertex edit, move, delete. Use a GL v3-compatible draw library (Mapbox GL Draw or Terra Draw; verify v3 support) behind our own `MapDrawPort`.
  - Bulk import and export as GeoJSON.
  - POI categories are editable in city settings: name RO/EN, icon (Material Symbol), colour, default opacity.
  - The manifest gains `pois[]` and `poiCategories[]`. The viewer renders POIs as icons, lines or fills, with labels at high zoom. Their detail opens in the same sheet as photos, and they are filtered by year with the timeline.
- **Satellite / historical layers**:
  - labels and descriptions RO/EN, attribution, year/date, order (drag), visibility default, default opacity
  - **image adjustments**: brightness min/max, contrast, saturation, gamma/levels. These are previewed live via `raster-brightness-*`, `raster-contrast` and `raster-saturation`, stored on the layer and applied by the viewer, with no reprocessing.
  - **geometry edits**:
    - re-georeference in the GCP editor
    - crop/mask by drawing a polygon (sent to the pipeline as a `-cutline`)
    - replace the source image
    - all of these re-run the pipeline and pass the CU guard before any MTS publish
  - delete, which also removes the Mapbox tileset and source after confirmation
- Everything is audited: `updatedBy`/`updatedAt` on every document and a `history` subcollection with the previous version, giving one-click revert. Security rules allow edits for admins only, with field validation per entity.

### Live transparency for every overlay

- The engine exposes an **overlay model**: each historical layer, the photos layer (markers + cones) and each POI category is an overlay with `visible` and `opacity` (0–1).
- **Viewer**: the Layers sheet/panel lists every overlay with a toggle and an M3 slider.
  - Moving the slider updates the map **live** (`raster-opacity`; `icon-opacity`/`text-opacity`/`line-opacity`/`fill-opacity`/`circle-opacity` for vector overlays), coalesced with requestAnimationFrame.
  - Values persist in the URL hash (`&op=<overlayId>:<0-100>,...`) and are restored on load. Keyboard and screen-reader friendly (slider ARIA, live announcements).
- **Admin**: the same slider sets the *default* opacity per overlay (saved to the doc, flows to the manifest). The admin map previews changes live before saving.
- **Swipe-compare** also respects each overlay's opacity.
- **Tests**: unit tests of the overlay model and the paint-property mapping per overlay type; e2e rows for viewer live opacity on raster, photos and POI overlays (pixel probes), hash persistence, keyboard control, and admin default-opacity save → manifest → viewer. Each row has a happy and a bad path, e.g. an out-of-range hash value is clamped and an unknown overlay id is ignored.
