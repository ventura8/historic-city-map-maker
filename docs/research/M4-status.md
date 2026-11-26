# M4 status: automation, what works and what waits for you

Written on 2026-10-24 by the M4 integrator, after the five M4 workstreams (orders, autogcp, compare, assists-notify,
tooling) and the integrator's own pass, updated on 2026-10-25 by the fixer of the two M4 reviews. It records the state of branch `feat/engine-rewrite` as the pipeline left it.
Nothing in M4 was deployed, pushed or committed, nothing was downloaded but the one package the user approved
(`terra-draw` 1.38.0), and no real Google, Mapbox, USGS, STAC, Nominatim, Vertex AI or OpenStreetMap endpoint was
called: everything below that says "works" was proved against the Firebase emulators (project `demo-hcm`), the shared
fakes of `@hcm/test-support`, the e2e mock APIs and the pipeline's loopback fakes. The contract and every change request:
[M4-interfaces.md](M4-interfaces.md); the decisions: [DECISIONS-for-review.md](DECISIONS-for-review.md) §52–§57.

## 1. The verdicts

Measured on 2026-10-25 on this machine and, for the split stage, with the NUC, after the fixer applied the two M4
reviews (security and cost: 8 findings; minimum input and UX: 16; DECISIONS §57, `docs/LESSONS.md` 203–218).

- The split `all` stage (`bash scripts/ci/e2e-split.sh`, its fourth run of the fixer's pass): `[FAILURE] stage 'all'
  failed: here (exit 1), nuc (exit 0), report merge (exit 0)`, this machine's part for the four audit gates only:
  `[local] [FAILURE] stage 'all' failed: static/npm-audit, static/deploy-lock-audit, static/pip-audit,
  static/pipeline-pip-audit` (body-parser, fast-uri and undici in npm, filelock in pip: their fixes are downloads
  awaiting the user's yes, `DECISIONS-for-review.md` §48a, §49i). The NUC: `[nuc] [SUCCESS] stage 'e2e' passed
  (reports/pipeline/green-e2e.json)`, 925 tests, and `[nuc] [SUCCESS] stage 'tour-matrix' passed
  (reports/pipeline/green-tour-matrix.json)`, 860 tests; here the e2e's 332 and the tour's 430 Playwright tests, no
  failure and nothing flaky. Every other gate of `all` passes (`sonar` skips without a token); it cannot print SUCCESS
  until those bumps are approved. The fixer's first three runs found five failing tests to fix (`docs/LESSONS.md` 216–218).
- `static`: every gate but the four audits passes (47 of 51: lint, types, formatting, i18n parity, the font subset,
  knip, dependency-cruiser, the scenario matrix, the agent assets, markdownlint, gitleaks).
- `tests`: Vitest 489 files and 6,884 tests (under the Firebase emulators), the CI tooling's pytest 736, the pipeline's
  pytest 400, the rules' coverage complete (`[SUCCESS] rules coverage: every expression of firebase/firestore.rules
  evaluated, every condition allowed and denied`), the per-file gate `[coverage] OK: 900 files measured at >= 90.00% per
  file (overall 99.37%, branches 98.42%)`.
- `build`: every gate passes. The engine: `engine.mjs` 97.5 KB gzip of 100, `engine.iife.js` 117.0 of 125, the lazy
  `compare` 4.6 of 5 and `firebase-sdk` 13.3 of 16; the admin: the entry 378.0 of 450, `imagery` 17.6 of 18,
  `order-card` 1.8 of 2, `georef` 16.8 of 17, `inbox` 3.5 of 5, `assist` 2.4 of 3, `messaging-sdk` 5.7 of 7,
  `terra-draw` 47.7 of 58, 603.1 KB in all of 620. `[notices] OK`: the engine's `THIRD_PARTY_NOTICES.txt` names 13
  bundled packages and 2 for the fonts, the admin's 24 and 2. No budget was raised.
- The cross-app journey (A48) alone: 2 of 2 at `admin-l1440-ro` (the happy path 4.3 min) and, with the orders spec, 7
  of 7 at `admin-c360-ro`; in the split run at both per-push projects.
- The local stack: `bash scripts/dev/dev-stack.sh check` ends `[SUCCESS] the local stack works` (the order card and the
  watched order, the inbox, no request off the machine).
- Screenshots: every new state at 360 × 800, 768 × 1024, 1440 × 900 and 2560 × 1440, light and dark in Romanian and
  light in English: the admin's 18 M4 states (the order card, ordered, reminded, delivered, never delivered; the
  suggested pairs, some accepted, none; the title suggestions and their refusal; the drafts of a photo, a place and a
  layer and a refused draft; the inbox, empty, push on and denied) in `reports/screenshots/m4/admin.*/`, the viewer's
  six compare states at each size where they exist (the second map from 600 px, the toggle below) in
  `reports/screenshots/m4/viewer.compare-*/`, 279 files, one contact sheet per state in `reports/screenshots/m4/sheets/`.
  The reviews' two new states (`orders.scanned-while-marking`, `orders.waits-for-approval`) pass the tour's checkers at
  every admin project of the split run; they have no contact sheet.

## 2. What works end to end on the emulators

Each line is proved by tests that drive the built admin and the built viewer from outside (Playwright, with the network
firewall, the console and placeholder guards, every new state through the generic layout and accessibility checkers),
by the functions' handler tests over the ports' fakes, by the rules tests and by the pipeline's pytest suite.
`e2e/scenarios.json` names the test of every row; 500 of its 502 rows exist (the two still planned are M2's
`S-A19-BAD-LOW-CONTRAST-SEED` and `S-A20-BAD-NO-APP-CHECK`).

- __The whole automation, across the apps__ (A48, `e2e/admin/specs/imagery/automation.spec.ts`): a free 1966 frame
  imported with one click and published; the 1968 frame USGS has not scanned bought the human way (its order card, its
  EarthExplorer page, then __I ordered it__: two inputs); the fake USGS delivers and a day passes; `imagery.tick`'s watch
  imports it, the stand-in pipeline's automatic points are under the threshold, the policy approves it and the fake MTS
  publishes it with no click; the next tick marks the order imported; the inbox lists the delivery and the import, whose
  item opens the published version; the manifest lists both layers and the public viewer compares the bought scan with
  the 1966 layer on two maps (Close leaves one: created 2, removed 1). Over the threshold the version waits for Approve,
  the inbox says so and nothing reaches Mapbox. Passed at `admin-l1440-ro` (4.3 min) and `admin-c360-ro`.
- __Buying a scan__ (A13): the order card (35 USD for one frame, paid to USGS, the four EarthExplorer steps, the scene's
  verified EarthExplorer page in a new tab), __I ordered it__ (`usgs.markOrdered`, which refuses a scene USGS already
  offers), __Take the mark back__ (on the card, and in the snackbar after the mark), __Check now__ (once a minute), the order's facts; the daily watch (a step of
  `imagery.tick`, each order once a day, one USGS login a run, at most 50 orders), reminders on days 7 and 12, `expired`
  after 90 days with __Order it again__ and __Take the mark back__ (only such an order counts in Work: a reminder, once
  sent, waits like any order), the import of a delivered scan under the budget guard and today's cap, and one
  notification per event, never twice. Before USGS approves the account's downloads both cards say the daily check waits
  for it, with the link to Setup's USGS step; a frame scanned while it was being marked turns free and the snackbar says
  why; times are in the admin's time zone. The rules refuse a client's `ordered` or `available` and every order field.
  The order card is a lazy chunk (`order-card`), fetched the first time a scene to buy opens.
- __Automatic GCP suggestions__ (A44, P03): the pipeline's matcher adds ORB when SIFT finds too few keypoints, OpenStreetMap's
  lines as a second channel matched tile by tile, RANSAC across both, a confidence and a residual per pair, and held-out
  checkpoints from 15 confident pairs; pairs under 0.6 are suggestions the georeferencer shows with Accept, Reject and
  Accept all (Enter and Delete on a row; Accept all leaves the keyboard on the panel's heading), each with its distance
  from the page's live fit, dashed on the scan and flags on the map, never saved without Save; enough confident pairs in
  a line wait with `apiError.imagery.noSpread`, not "too few". On the synthetic world drawn through an exact affine map
  the matcher's fit is within 15 m of the truth in the median (3.7, 2.8 and 9.9 m in the three tests) and within 30 m at
  the scan's corners, outside the matched pairs, where `poly2` extrapolates (14.1, 11.7 and 23.4 m): the approval policy
  reads interior checkpoints, so an edge guard is proposed (§57d) and waits for the `real-data` measurement.
- __Swipe compare__ (V06): the engine's own (no plugin), a lazy chunk of the engine (`compare`, 4.6 KB, budget 5 KB; `engine.mjs` 97.5 KB of 100);
  the second map is created only on a window 600 px or wider and destroyed on Close, Esc, a lost map or `destroy()`; a
  compact window hides it for a minute first, so a phone turned back reuses it (§57c; the map-instance counter proves
  both); the chooser offers no side the main side shows already; both cameras follow each other; each side keeps its overlay's
  opacity; the divider is a slider for the keyboard and screen readers; the legal line stays the viewer map's at every
  position; a compact window gets a toggle on one map; `cmp=` and `sw=` in the address reopen it.
- __Title suggestions and drafts__ (A45, A09's assists): __Suggest a title__ through the `assist-geocode` queue at one
  Nominatim request a second for the project, cached 90 days, a ten-minute cool-down after a 429, at most 300 cells a
  UTC day, OpenStreetMap's attribution; a photo still titled after its file asks by itself when its pin is set (a real
  upload, §57a); the editor's wait for a queued cell ends after two minutes; __English draft__ and __Romanian draft__
  (offered only for an empty side) through Vertex AI's pinned model on the server only, plain text within the field's
  length, never adding or changing a link (`apiError.assist.linksChanged`), a monthly cap (500 requests or 0.50 USD) in a
  transaction, paused by the budget guard, refused cleanly when the API is off; a draft only fills the editor's draft,
  an answer for another item is dropped, and only Save writes. Setup's self-test has an `ai` check; Provision turns on
  `aiplatform`, `fcm` and `fcmregistrations` and makes the custom role `hcmVertexDrafts` for the drafts (§57g).
- __Notifications__ (A46, A47): every event (a delivery, an import, a reminder, an order never delivered, a failed job, a
  layer waiting for approval or for points, USGS approving downloads, the budget pause, a crash spike) is one
  `notificationEvents/{id}` document that `notify.onEvent` fans out to every admin's inbox (`#/inbox`, the unread count
  on the navigation) and, for the kinds an admin chose (points needed included by default), to their browsers through
  FCM after the browser's own prompt. The inbox is pruned by a count, never read whole; a browser's push record names
  its admin, sign-out unregisters it, a browser registered by another admin is taken from the first, and a removed
  admin's devices, inbox and settings go with them (§57b, §57f). No e-mail (it would need a new provider, §54i).
- __The reviews' fixes__ (§57, `docs/LESSONS.md` 203–218): the two M4 reviews' 24 findings, each applied or proposed,
  as the lines above say; six new scenario rows (`S-A13-BAD-SCANNED-WHILE-MARKING`, `S-A13-BAD-WAITS-FOR-APPROVAL`,
  `S-A45-BAD-DAILY-CAP`, `S-A45-BAD-LINKS-CHANGED`, `S-A47-BAD-SHARED-BROWSER`, `S-P03-BAD-NO-SPREAD`) and two tour
  states (`orders.scanned-while-marking`, `orders.waits-for-approval`).
- __Fixed on the way__ (the integrator, §56a): M3's daily raster-job cap now counts in production (CR-M4-11: the Firestore
  adapter's timestamp operands); the engine's third-party notices list both formats' packages (CR-M4-19); the monthly
  harvest keeps the orders (the orders workstream, CR-M4-12).
- __Tooling__ (§53): Terra Draw 1.38.0 (the drawing specs pass, the `terra-draw` chunk 47.7 KB of 58); both builds write
  `THIRD_PARTY_NOTICES.txt` from the installed packages' licences, and the `notices` gate (build and release) checks that
  it names every bundled package and every font's package, with a permissive licence each.
- __The local stack__ (`npm run dev:stack`): a frame to buy, an order watched, a version waiting for points with the
  matcher's suggestions, and the inbox items of the server's own events; its check passes (§1). `docs/MANUAL_TEST_PLAN.md`
  walks through them as the items O (orders), S (suggested pairs and assists), N (notifications) and V11 (the swipe
  compare), LOCAL now and LIVE after the deploys.

## 3. What waits for you (the real cloud)

Each step is yours (accounts, consents, payments) or a deploy that needs your yes. Claude prepares the commands and opens
the exact pages; nothing is done without you.

1. __Provision again__ (Setup → Prepare the project): it turns on `aiplatform.googleapis.com` (Vertex AI: the paid EEA
   tier, under 0.05 USD a month at the expected use, never over the app's 0.50 USD cap), `fcm.googleapis.com` and
   `fcmregistrations.googleapis.com`, makes the project's custom role `hcmVertexDrafts` (`aiplatform.endpoints.predict`
   only, §57g; not `roles/aiplatform.user`, which also runs billable jobs) and grants it and
   `roles/firebasecloudmessaging.admin` to `fn-admin@`, `fn-events@` the FCM role. The `assist-geocode` task queue is created with the
   functions' deploy. The self-test's `ai` check (a free `countTokens`) then proves the model is served and that the
   custom role's one permission suffices (UNVERIFIED until then).
2. __Deploys__ (ask first, each one): the functions (61 in all: the orders' 3, the assists' 3 and the notifications' 4
   are new), the Firestore rules and indexes (the order fields refused to clients, the notification collections), the
   admin (Hosting, with its push service worker `firebase-messaging-sw.js`), and the pipeline's image with the new
   matcher (`pipeline/Dockerfile`, target `runtime`).
3. __The first real scan purchase__ (yours, never Claude's): in EarthExplorer, 30 USD a frame plus 5 USD an order, paid
   by card on pay.gov (done 2026-11-08 for D3C1216-100235F038: Login, Order, 7 Micron, Submit Product Selections, pay.gov). Then __I ordered it__ in the admin; delivery takes three to four weeks after payment, and
   the watch imports it by itself. It also proves what the contract marks UNVERIFIED (§10): the Declass 2 and 3
   EarthExplorer dataset ids, the order lifecycle, whether M2M's order endpoints could spare the click (§52g).
4. __The public site reads the bucket__ (§55e, ask first): one `ci.yml` line and the repository variable
   `HCM_PUBLIC_BUCKET`, once the admin has published the city's manifest; until then GitHub Pages keeps the seed
   snapshot.
5. __Push on a real device__: the first `notify.registerDevice` and `notify.sendTest` in the deployed admin prove that
   FCM takes `message.fid` from our call and accepts the SDK's default VAPID key (§54c, CR-M4-24).
6. __Your decisions on the proposals__: e-mail notifications through a log-based alert (§52f) or not at all (§54i), the
   order detection without the click (§52g), a visible licences link in the viewer and the admin (§53d), the Terra Draw
   copyright lines (§53c), the advisories that kept the four audit gates red (§48a, §49i: their bumps were applied
   on 2026-10-25, §64),
   and the reviews' proposals: an edge guard in the approval policy (§57d), the EarthExplorer basket in the weekly
   probe (§57h), an import map with `integrity` for the module build's chunks (§57i), and a shared compare link opening
   as the one-map toggle (§57j).

## 4. Open items

- Closed 2026-10-25: the four audit gates (`npm-audit`, `deploy-lock-audit`, `pip-audit`, `pipeline-pip-audit`) failed
  on advisories whose fixes were downloads awaiting the user's yes (§48a, §49i); the user approved them and the bumps
  are in (§64).
- `real-data` (ask first, local only): the matcher's checkpoint RMSE on a real Corona frame against Sentinel-2 and
  OpenStreetMap, and whether more than 15 confident pairs come out of a 1960s scan.
- The order watch filters the due orders in memory (CR-M4-13 (b)); with CR-M4-11 fixed, a composite index on
  `order.state`, `order.nextCheckAt` could replace that if a city ever has many open orders.
- Closed 2026-11-03: the address of a scene to buy that no one ordered yet (`#/imagery/scene/<id>`) opened while
  __Free only__ is on said the scene was not found, since the page looked it up in the filtered list and the orders only.
  The area now also reads the routed scene by its id (`ImageryFeeds.showScene`), so any scene of the city opens from its
  address, past the list's first page too; an address of no scene says "No scene has this address" once that read
  answers (S-A13-HAPPY-ADDRESS, S-A13-BAD-NO-SCENE).
