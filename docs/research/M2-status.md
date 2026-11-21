# M2 status: what works, what needs the real cloud, what is left to do

Written on 2026-10-18 by the final-gate agent, after the M2, M2b and M2c work and the four adversarial reviews
(security, Material 3 and UX, minimum input, quality). It records the state of branch `feat/engine-rewrite` as the
pipeline left it, so the orchestrator and the user can decide the go-live. Nothing in this file was deployed, pushed or
run against a real Google, Mapbox or USGS endpoint: everything below that says "works" was proved against the Firebase
emulators (project `demo-hcm`), the shared fakes of `@hcm/test-support` and the mock APIs of the e2e tiers.

## 1. The verdicts

The default stage, split between the laptop and the NUC (`bash scripts/ci/e2e-split.sh`: static, tests, build, e2e,
tour-matrix and sonar; about 20 minutes), on the working tree of 2026-10-18:

- First run: every gate passed but one Playwright test on the NUC, `S-V04-HAPPY` at `fn-m768-ro` (the spec read the
  1966 markers before the year's filter was drawn; `docs/LESSONS.md` 128), so the split said
  `[FAILURE] stage 'all' failed: here (exit 0), nuc (exit 1), report merge (exit 0)`. Fixed in the spec; repeated six
  times at three projects, green.
- Second run, after that fix and the two screenshot fixes of section 6: one Playwright test failed on the NUC,
  `S-A20-HAPPY` at `admin-c360-ro` (the spec left the place editor while its Save was still on its way; lesson 131).
  Fixed in the spec; repeated four times at two projects, green.
- Final run, on the tree as it is now but this file: `[SUCCESS] stage 'all' passed (reports/pipeline/green-all.json;
  Playwright split: 3/3 here, 1-2/3 on nuc, 1213 s)`, every Playwright test passed on both machines, no flaky retry.
- Coverage (the `coverage` gate of the final run): `613 files measured at >= 90.00% per file (overall 99.47%, branches
  98.66%)`; the bundle budget `admin.iife.js` 446.9 KB of 450 KB gzip, `engine.iife.js` 109.2 of 125, `engine.mjs`
  95.9 of 100.
- SonarCloud: `[sonar] [SKIP] no SONAR_TOKEN and no .sonar-token` (the stage passes without a token; CI runs it).
- The scenario registry (`docs/E2E_SCENARIOS.md`, Counts): 70 behaviours, 373 scenarios (127 happy, 246 bad), 326 with
  their test and 47 planned (M3 imagery and pipeline A11–A17 and P01–P02, swipe compare V06 in M4, and the rows of
  DECISIONS §37e that wait for a screen).

## 2. What works end to end on the emulators

Each line is proved by Playwright specs that drive the built admin and the built viewer from outside, with the network
firewall and the console guard on, every state through the generic layout and accessibility checkers
(`expectStateSound`: occlusion, overlap, edges, Mapbox's legal line, text, axe with best practices, target sizes, the Tab
round, contrast, landmarks, the scroll sweep) at the tour's viewports, light and dark, Romanian and English. The
scenario registry (`e2e/scenarios.json`, `docs/E2E_SCENARIOS.md`) names the spec of every row.

- __The public viewer__ (M1, behaviours V00–V25 but V06): the manifest boot and its error cards, the timeline, the
  layers with live opacity and image adjustments, photos on the map with clusters, cones and the lightbox, points of
  interest with their detail sheet, deep links and sharing, geolocation, language and theme, About and credits, the
  analytics consent and the crash reporter, the embed API and the starter kit; one map per view, at all 11 viewports.
- __Sign-in and ownership__ (A01, A02, A20, A25–A27): start-up mode before the server exists (with a start-up deploy no
  request to the server and no console error), the ownership check through Google's IAM, the automatic owner claim once
  the server answers, invitations (hashed, single use, 14 days), a stranger signed out, a revoked admin kept read-only
  under a banner until sign-out, every Google consent asked one scope at a time and kept in memory only.
- __The Setup Assistant__ (A03–A07, A22, A28, A30), against the fake Google, Mapbox and USGS services: billing with
  one, several or no billing account and the 5 USD budget; the provisioner's 15 items in order, idempotent, with Retry
  what failed; the functions' installation detected and the claim made; Mapbox from a demo account to a paid one, the
  secret token pasted once (saved on paste) and the public tokens minted; USGS with the 60 s countdown, maintenance and
  the approval noticed by the periodic tick; Analytics with the GA4 stream setting and the crash alerts; the import of
  the 45 legacy Bucharest photos up to the published manifest. The whole assistant stays within its input budget (9
  inputs and 4 Google consents, `SETUP_STEP_SPECS`), counted by the journey at five admin projects.
- __The editors__ (A08–A10, A15, A18, A19, A23, A29, A31–A41 as far as built): photos (upload with resume, EXIF, bulk
  publish with reasons, replace, delete with Undo), places (point, line, area from the list of positions, the
  Markdown preview, GeoJSON import and export), layers (order, link a tileset or an XYZ source, the four image
  adjustments, default opacity), settings (the city's area, links, the seed colour, the categories with the icon guessed
  from the label), jobs with live progress and cancel, history with revert and restore, admins, crash reports and the
  dashboard; drafts, conflicts merged field by field, a deleted item refused.
- __Admin to viewer__ (A41): what an editor saves goes through the publish trigger and the manifest build in the Functions
  emulator to the gzip manifest in the Storage emulator's public bucket, and the built Bucharest site (`bucharest`,
  DECISIONS §35b) shows it: a photo published, renamed, reverted and unpublished, a place added from the keyboard, a
  layer's opacity, start-up visibility and saturation (pixel probe).
- __The backend__ (M2): every callable through `requireAccess` with validated input and output, default-deny Firestore and
  Storage rules with every expression evaluated allowed and denied (the `rules` gate), the history triggers, the public
  crash endpoint, secrets only in Secret Manager (fake), redaction of tokens in logs and crash reports.

## 3. What needs the real cloud (not provable on the emulators)

- __The deploys themselves__ (section 5): Hosting, the rules and indexes, the 35 functions. The functions' Cloud Build
  install, their service accounts and the invoker setting have only been checked against the fakes.
- __Google__: the real OAuth client and its consent screen ("unverified app" path), Resource Manager's IAM check, Cloud
  Billing linking and the budget, every provisioner item (APIs, service accounts, IAM, buckets with CORS and lifecycle,
  Secret Manager, Cloud Tasks, Workload Identity Federation for GitHub, App Check with reCAPTCHA Enterprise, Monitoring
  alerts, the browser key's restriction), organisation policies, GA4 and Cloud Error Reporting. The weekly
  `contract.yml` checks the deep links and API shapes; it has not been dispatched (ask first).
- __Mapbox__: a real secret token's scopes, minting the URL-restricted public tokens, map loads in the admin and the
  viewer (the tests never load Mapbox), tileset validation for a linked layer. MTS publishing is M3.
- __USGS__: ERS registration, M2M approval (24–48 business hours), the application token and the order and download
  APIs. The imagery search, import, georeferencer and raster pipeline are M3 (rows A11–A17, P01, P02 planned).
- __App Check enforcement__: `functions/deploy-env.json` keeps `HCM_APP_CHECK=monitor` for a week of measurements
  first (row `S-A20-BAD-NO-APP-CHECK` is planned until then).
- __The public site on GitHub Pages__: the `deploy-pages` job runs on `master` only; it replaces the old site (ask first)
  and builds with the repository variable `MAPBOX_PUBLIC_TOKEN`.

## 4. What the user still does in the app (the Setup Assistant)

The admin is `https://bucurestiul-disparut.web.app`. Claude opens each provider page and says which button; the user
types every credential, accepts every term and pays.

1. __(a) Sign in with Google__ with the account that owns project `bucurestiul-disparut`, and allow the read-only Cloud
   access Google asks for (one consent).
2. __(b) Billing__: one click and the billing consent; the app links the billing account (Blaze) and creates the 5 USD
   budget. With no billing account yet, create one on Google's page (card details: the user's), the card picks it up.
3. __(c) Prepare the project__: one click and the Google Cloud consent; 15 items. An organisation policy or a missing
   role is named with its fix; __Retry what failed__.
4. __(d) Install the server__: the orchestrator's deploy of section 5, steps 3 and 4 (or GitHub Actions once
   `DEPLOY_ENABLED` and the WIF variables the card lists are set: ask first). The card turns green by itself; __(d2)__
   the owner claim follows without a click.
5. __(e) Mapbox__: create the account, leave the demo plan (card and billing address), tick the usage alerts, create the
   secret token `historic-map-server` with the listed scopes and paste it into the card (saved on paste).
6. __(f) USGS__: register on ERS, request M2M access with the card's text, wait for approval; then type the ERS
   username, open the token page and paste the token within 60 s.
7. __(g) Analytics and crash reports__ (optional): enable Google Analytics in the Firebase console (Google's terms), then
   __Stop counting address changes as page views__ (one click, the Analytics consent).
8. __(h) The old Bucharest photos__ (optional): __Import the 45 photos__, then check their rights in Photos.

## 5. Deploy steps for the orchestrator (every step ask first)

Each step needs the user's explicit yes for that step, a green `bash scripts/ci/e2e-split.sh` (or
`bash scripts/ci/run-all-checks.sh`) on the exact commit, and a clean tree (`.agent/workflows/deploy.md`: never deploy
a dirty tree). The user runs `npx -y firebase-tools@15.33.0 login` in their own terminal first; Claude never runs a login
or types a credential. Every command names the project explicitly (`.firebaserc`'s `default` is the real project).

1. __Commit and back up__: commit the tree (the M2 work is uncommitted on `feat/engine-rewrite`), run the default stage
   on the clean commit (`scripts/git-hooks/pre-push` checks `reports/pipeline/green-all.json` names it), then the
   backup push of `feat/engine-rewrite` (pre-approved). A push to `master` is ask first.
2. __Hosting, start-up mode__ (now, before billing): fixes the live CORS console error and the `release: dev` boot log
   (DECISIONS §36b, §36c). Ask first.

   ```bash
   HCM_ADMIN_START_UP=1 npx firebase deploy --only hosting --project bucurestiul-disparut
   ```

   Check: the admin boots with `release: 0.0.0+<short commit>`, and its console shows no error before sign-in.

   Done 2026-10-23 (user approved 2026-10-18) from `8f4e43d` after a green split `all` on that commit: the live admin
   boots with `release: 0.0.0+8f4e43d`, `startUp: true`, and its console shows no error. The Firestore indexes in the
   project are still the 2026-10-12 set; the `cityId`-first History indexes (DECISIONS §45) arrive with step 3.
3. __Firestore rules and indexes, Storage rules__ (after the user finished Setup steps b and c, which link billing and
   create the buckets). Ask first. The `(default)` database already exists in `nam5` (created with the project on
   2026-10-11; the rules and indexes were deployed to it on 2026-10-12), and `firebase.json` names that location, so a
   deploy only updates the rules and indexes and never creates a database (DECISIONS §40a, resolved).

   ```bash
   npx firebase deploy --only firestore,storage --project bucurestiul-disparut
   ```

4. __Functions__ (after step 3; the predeploy builds `functions/dist`, the environment comes from
   `functions/deploy-env.json`). Ask first.

   ```bash
   npx firebase deploy --only functions --project bucurestiul-disparut
   ```

   Check: Setup step (d) shows "35 of 35 functions installed" and turns green; the claim (d2) follows; `setup.selfTest`
   all green.
5. __Hosting, normal mode__ (after step 4, so a fresh browser probes the server): ask first.

   ```bash
   npx firebase deploy --only hosting --project bucurestiul-disparut
   ```

6. __Later, each ask first__: App Check from `monitor` to `enforce` after a week (`functions/deploy-env.json`); the
   repository variables for CI deploys (`GCP_WIF_PROVIDER`, `GCP_DEPLOY_SA`, `GCP_PROJECT_ID`, `DEPLOY_ENABLED`,
   `MAPBOX_PUBLIC_TOKEN`) with `gh variable set`; the public site on Pages with the push to `master` that replaces the
   old site.

## 6. Open items

Found in this final pass and fixed (each with its check):

- `S-V04-HAPPY` polled for a marker today's view already had (`e2e/specs/viewer/timeline.spec.ts`; lesson 128).
- `S-A20-HAPPY` left the editor before the page had its Save's answer (`e2e/admin/specs/shell/shell.spec.ts`; lesson 131).
- The Setup cards' copy buttons zigzagged (`packages/ui/src/admin/setup/setup-styles.ts`; lesson 129).
- The places editor put Save before Discard changes, the other editors after it
  (`packages/ui/src/admin/pois/hcm-poi-editor.ts`; lesson 130).
- The review screenshots' resize closed the account menu and then failed its Esc check; `docs/TESTING.md` says how to
  shoot such a state.

The review screenshots: `reports/screenshots/m2-final/<state id>/<width>x<height>-<scheme>-<lang>.png` (git-ignored),
106 states (30 of the viewer, 76 of the admin) at 360 × 800, 915 × 412, 1440 × 900 and 3840 × 2160 in light and dark,
Romanian, and English at 360 × 800 and 1440 × 900; one contact sheet per state in `reports/screenshots/m2-final/sheets/`.
The viewer's and the admin editors' states come from their tour projects at those viewports, the admin's other states
from `admin-l1440-ro` and `admin-l1440-en` resized (`docs/TESTING.md` → *Review screenshots*). The mock basemap, tiles
and glyphs of the e2e world are what the shots show for the map (labels as boxes, tile coordinates as text).

Open, for the user or a later milestone:

- __A revoked admin's Save stays enabled__ (§35e as built: every write is refused at once with a snackbar, the scenario
  row asserts that); a page that is read-only would disable it in each editor. The UX review's other layout points
  (the places editor's overflow menu and landscape layout, the bulk bar, raw field names in History, raw job step
  names, the photos' empty state) are recorded in its report and DECISIONS §37e.
- __The admin bundle__ is at 446.9 of its 450 KB gzip budget: §34b (the module build with lazy chunks) waits for the
  user, and Terra Draw (§34g) needs it.
- __The security review's findings left open__: a dedicated no-role account for the public crash endpoint, the crash
  endpoint's worst-case logging cost, Subresource Integrity for `mapbox-gl-compare.js` (V06, M4), App Check `enforce`
  after a week; all deploy or cost decisions.
- __The quality review's__ §39c: what would bring the split `quality` stage to about eight minutes.
- __SonarCloud__ runs only with the token (CI has it); the local runs skipped it.
- __The pipeline milestones__: imagery search, import, georeferencing and MTS publishing are M3; swipe compare, the
  buy-scan flow and the Nominatim and AI assists are M4.

## Addendum 2026-10-18: after the user's decisions §34b, §34g and §34i

- __Bundle__: the admin page loads `admin.mjs`; its entry with its static chunk is 349.8 KB gzip of 450 (was
  `admin.iife.js`, 446.9), each area, Terra Draw (47.4 KB), the colour library and the analytics SDK are lazy chunks
  with budgets of their own, 512.0 KB in all of 620 (`DECISIONS-for-review.md` §41a).
- __Terra Draw__ 1.37.0 is installed and drags shapes, vertices and midpoints (§41b; `S-A32-HAPPY-VERTEX-EDIT` exists).
- __First screen__: once Setup is complete an empty address opens the dashboard (§41c).
- __Open for the user__: a third-party notices file for the admin (§41b); `terra-draw` 1.38.0 to evaluate (a `HELD`
  entry).

## Addendum 2026-10-18: the §37e screens, read-only revoked editors, security, the §39c tiering

- __§40a resolved__: the Firestore `(default)` database exists in `nam5`; `firebase.json` names the location, so a
  deploy can never create one elsewhere (`firebase/rules-tests/test/firebase-config.test.ts`).
- __The rows §37e listed exist__ (`DECISIONS-for-review.md` §42a–§42c): the settings page's map (area drawn as a
  rectangle, Use this view, the overlay defaults previewed live), the self-test's per-check list with each failing
  check's reason and step, Replace the visitors' or the admin's Mapbox token, the conflict banner naming who and when,
  Home's list of the documents the public map skipped.
- __A revoked admin__ sees every editor read-only under the banner (§42d); the UX leftovers are done (§42e).
- __Security__ (§42f): the public crash endpoint runs as `fn-crash@`, an account with no project role, at 15 reports per
  instance a minute and 16 KiB per entry (about 22 GiB of logs in a worst-case month, under the 50 GiB free tier); the
  compare plugin loads only with SHA-384 digests.
- __Open for the user__ (ask first): installing `mapbox-gl-compare@0.6.0` to compute its digests (a download); a log
  sink exclusion for the crash endpoint's request log (a cloud change); App Check enforcement after the deploy.
- __§39c__ (§42g): every scenario row still runs on every push; the repetitions (the Setup journey at three more
  projects, the window-class-independent functional specs at four more, the admin's tours in dark and English) run in
  `tour-matrix`. The split `quality` stage measured below eight minutes (`docs/CI_PIPELINE.md`).

## Addendum 2026-10-18: the M2e gate and review screenshots

- __Gate__: the split `all` stage (`scripts/ci/e2e-split.sh`, the full tour and `tour-matrix` included) is the
  milestone's gate; its verdict is quoted in the task report. Its first run found what the per-push `quality` runs of
  §41 and §42 never reach (`DECISIONS-for-review.md` §43): the places editor over its "Set up Mapbox" note on a 320 px
  phone, the bar's "Configurare" broken over two lines there, a legal-line rule that asked for a logo on a 4 px strip
  of map, and three specs that raced a loaded machine (`docs/LESSONS.md` 143–148).
- __Review screenshots__ of the dashboard, the places editor half way through a drag, and the photo and layer editors
  at 360×800, 768×1024, 1440×900 and 2560×1440, light and dark (`docs/TESTING.md` → *Review screenshots*). They found
  two defects, both fixed: the opened photo or place could lie off its editor's map (the map now centres on it once,
  `S-A09-HAPPY-OPEN-IN-VIEW`, `S-A32-HAPPY-OPEN-IN-VIEW`, `S-A32-BAD-NEW-PLACE-KEEPS-VIEW`), and the dashboard's tiles
  in one row differed in height (`docs/LESSONS.md` 141, 142).
- __Bundle__ after the fixes: the admin entry 353.4 KB gzip of 450, every lazy chunk within its budget, 521.1 KB in all
  of 620; the engine unchanged (`engine.mjs` 95.9 of 100, `engine.iife.js` 109.3 of 125).
- __Seen, not changed__: the admin map keeps the day basemap in the dark scheme, as the viewer does; test cities seeded
  without theme tokens show the fallback purple (the Bucharest theme is brown).

## Addendum 2026-10-23: History's recent changes ask one city (CR-M2c-14 resolved)

- __Found by__ the split `all` on the NUC: `admin.history.recent` at `tour-x3840-dark-ro-admin` failed its Tab round on
  the test's own city's creation entry. The recent changes read the newest 50 entries of every city's `history` and the
  page left the others' out, so other tests' cities decided which of the city's entries made the page, removed one
  while the checkers ran and kept "Show more" on (`docs/LESSONS.md` 149).
- __Fixed at the root__ (`DECISIONS-for-review.md` §45; `docs/research/M2c-interfaces.md` §9.2 and its CR-M2c-14 row):
  every history entry names its city (`cityId`, written by the history triggers and `history.revert`), the query asks
  `cityId ==` the city, and the collection-group indexes start with it. `S-A23-BAD-OTHER-CITY` (exists) pins it.
- __Deploy__: the next `firebase deploy --only firestore` (step 3, ask first) creates the four city-scoped
  collection-group indexes; the functions deploy (step 4) installs the writers. No migration: no history trigger was
  ever deployed, so the live Firestore holds no history entry, and an entry without `cityId` would still validate and
  show among its document's versions.

## Addendum 2026-10-24: the open items the user decided for M4

- __Swipe compare__ is the project's own (`DECISIONS-for-review.md` §52a): the `mapbox-gl-compare` loader is removed, so
  installing `mapbox-gl-compare@0.6.0` to compute its digests, and its Subresource Integrity (§18b), are no longer open.
- __Third-party notices__ for the admin (and the engine) are generated at build with a gate (§52d), and `terra-draw`
  1.38.0 replaces 1.37.0 with its `HELD` entry removed (§52c): both are the M4 tooling workstream's
  (`docs/research/M4-interfaces.md` §6).
