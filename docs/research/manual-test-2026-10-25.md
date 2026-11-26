# Manual test findings (2026-10-25, live admin 0.0.0+90b31be, start-up mode)

The record of the live manual test of 2026-10-25: the user walked `docs/MANUAL_TEST_PLAN.md` (the start-up page and
sign-in, the Setup Assistant's steps with the deploys D2 and D3, and the photos' daily flow) with Claude on the real
project `bucurestiul-disparut`, admin `https://bucurestiul-disparut.web.app` (the start-up Hosting deploy of `90b31be`,
release `0.0.0+90b31be`). The passes and findings below are kept as they were noted during the walk; only their
Markdown changed (the tags' brackets escaped, two addresses in angle brackets, blank lines around the lists, finding 8,
noted last, moved to its place in the numbered list). The user's requests and decision of the same day are findings 10, 13, 14 and 16. What M6 does about
each finding, its owner and its scenario rows: [M6-interfaces.md](M6-interfaces.md) §3.

## The live state after the test

- **Billing**: a new Google Cloud billing account, a free trial (300 USD for 90 days, finding 18), linked to the
  project (Blaze) with the 5 USD budget (B1).
- **Provision cloud**: 15 of 15 items after one Retry what failed (B2, finding 4).
- **The server**: the rules and indexes and the 61 functions of `90b31be` deployed from the developer machine with the
  user's yes (D2, D3; D3 needed `--force`, finding 9, and a second run once Eventarc's service agent had propagated,
  finding 12). The Cloud Scheduler jobs of `ops-tick` and `imagery-tick` do not exist (finding 11). The admin left
  start-up mode by itself, so D4 was not run (finding 14); the owner claim (d2) followed without a click.
- **Mapbox**: saved for the account `ventura86`; both public tokens minted; the viewer's token is still restricted to
  `https://ventura8.github.io` (finding 14 asks for the Hosting address).
- **USGS**: the token is saved; USGS has not approved M2M downloads yet (checked every 6 hours), so Setup reads 8 of 9
  (findings 21, 24).
- **Analytics**: the measurement id was found (G).
- **The old Bucharest photos**: 45 of 45 imported, processed and published; the public manifest
  `cities/bucharest/manifest.json` lists 45 photos, their rights confirmed (H, finding 23).
- **The server checks**: every check green but Translation drafts (Vertex AI), which fails (finding 20).
- **The public site**: unchanged, the legacy site on GitHub Pages; nothing is published at the root of Firebase
  Hosting, where the admin still is.

## The IAM grant applied by hand

With the user's approval (2026-10-25), Claude granted `roles/run.invoker` at the project level to
`fn-events@bucurestiul-disparut.iam.gserviceaccount.com` and `fn-admin@bucurestiul-disparut.iam.gserviceaccount.com`
in the Cloud Console (finding 17): Eventarc could not deliver the Storage events to `photos-onupload`, which runs as
`fn-events@`, and Cloud Scheduler's OIDC calls as `fn-admin@` would have met the same refusal. Eventarc redelivered the
stuck events within minutes and the import finished. Provision does not grant this role yet: its `iam` item merges the
bindings it wants into the project's policy and never removes one, so a Re-check keeps the grant. M6 adds it to
Provision (M6-interfaces.md §1.6, `DECISIONS-for-review.md` §67b).

## Passed

- A1 start-up page boots clean (console: boot + start-up lines only).
- A2 title follows an English Chrome ("Map administration").
- A3 owner sign-in + ownership check -> Setup, step a Done.

## Findings

1. \[minor]\[layout] The "Loading…" screen shows a vertical scrollbar.
2. \[minor]\[layout] The start-up sign-in card sits at the top of the page, not centred.
3. \[ux]\[setup b] With no billing account, the card says "You have no billing account yet. Create one on Google's page" but the
   only way there is a plain link "Google Cloud billing accounts" (console.cloud.google.com/billing, the list page). It should be
   a primary button straight to the create page (console.cloud.google.com/billing/create), and say plainly that the app waits and
   continues by itself (the poll every few seconds is invisible except a thin bar). The "Link billing and create the US$5 budget"
   button stays enabled while waiting, which reads as "click me" though there is nothing to link. User reported "stuck at step b".
   (B1 then PASSED once the user created the account: linked, Blaze, budget.)
4. \[bug]\[setup c] Provision: "Service accounts" failed right after "Google services enabled: Done" with "The iam.googleapis.com
   service is not enabled in the project" — API enablement propagation delay (a just-enabled API answers SERVICE_DISABLED for
   up to a few minutes). Permissions and Keyless installation then wait on it. The provisioner should retry SERVICE_DISABLED for
   an API it has just enabled (backoff ~10 s up to ~3 min) instead of costing the admin a click. Live run: 11/15 done.
5. \[copy]\[setup c] The failure says 'Run "Prepare the project" again' but the button is "Retry what failed".
6. \[layout]\[setup] While a step is busy, the M3 loading indicator (morphing shape) is drawn ON TOP of the step's status chip
   ("To do") in the list and in the card header, covering its text. The indicator should replace the chip's icon/label, not
   overlap it (the overlap checker evidently does not see the busy state with a live loading indicator).
   (B2 PASSED after one "Retry what failed": 15/15, periodic check waits for the server as designed.)
7. \[copy]\[setup d] The "Install the map's server" card repeats step c's consent note ("Google asks for access to Google Cloud:
   we prepare the map's services and storage") although nothing on that card asks for a consent; and it says "0 of 61 functions
   installed" twice (above the note and under the progress bar).
8. \[docs] MANUAL_TEST_PLAN D3 says "51 din 51" while the card says 61 (and M5 will make it 68): keep the count out of the plan or
   derive it.
9. \[docs]\[deploy] D3 non-interactive fails: "Pass the --force option to deploy functions with a failure policy"
   (notify-onEvent has retry: true). The D3 command in MANUAL_TEST_PLAN / M2-status and the CI deploy job need --force (or the
   retry policy reconsidered); note that --force also deletes functions missing from the source.
10. \[FEATURE, user request 2026-10-25] Step d must let the admin install the server from the app: a button "Install the
   server" (and later "Update the server" when the admin's release is newer than the installed server). Design: in-browser
   deployer with the owner's Google consent (cloud-platform, like Provision), from a server bundle published with the admin
   (same commit: functions/dist zipped + a deployment manifest of the 61+ endpoints precomputed at build from the
   firebase-functions discovery: entry points, triggers, schedules, task queues, retry, service accounts, memory, env), uploaded
   to the project's bucket, then Cloud Functions v2 API create/patch per function + Eventarc/Scheduler/Tasks wiring, live
   progress per function, retry of failed ones only. Also firestore rules/indexes + storage rules from the same bundle (D2), so
   Setup needs no CLI at all. GitHub Actions deploy stays as the CI path. Needs: contract, fake GCP APIs in e2e, rows.
11. \[BUG]\[functions] Scheduled functions (ops-tick, imagery-tick): the Cloud Scheduler job create fails with 400
   INVALID_ARGUMENT because runAs() returns the shorthand "fn-admin@" and firebase-tools 15.33.0 passes it unexpanded as the
   job's oidcToken.serviceAccountEmail (the function itself accepts the shorthand). Fix: runAs() returns the full email
   `<name>@<project>.iam.gserviceaccount.com` (project from GCLOUD_PROJECT at discovery), with a unit test, and a deploy-shape
   test that every onSchedule's serviceAccount is a full email. The functions exist; their scheduler jobs do not.
12. \[ops]\[deploy] First functions deploy on a fresh project: 14 Eventarc-triggered functions fail with "Permission denied while
   using the Eventarc Service Agent ... may take a few minutes" (service agent IAM propagation). Any in-app deployer (#10) must
   retry these after a delay automatically; the Provision step could also pre-create the Eventarc/Pub/Sub service identities
   (it did not: the CLI generated them during the deploy).
13. \[FEATURE, user request 2026-10-25] "The admin must not need Claude or the terminal in the rest of the setup." Everything after
   Provision must be in-app: (a) install/update the server: functions + Firestore rules/indexes + Storage rules (#10);
   (b) leave start-up mode by itself once the server answers (no D4 Hosting redeploy; runtime.json startUp only a hint);
   (c) install the imagery pipeline: Cloud Build from the bundled pipeline source into Artifact Registry + the two Cloud Run
   Jobs via the Run API (replaces D5); (d) the public site publish without GitHub/terminal (decision: Firebase Hosting second
   site deployed from the admin via the Hosting REST API, or keep Pages via a GitHub step) (D7); (e) Vertex AI / FCM APIs via
   re-Provision (already in-app); (f) the optional GitHub keyless deploy variables stay optional. MANUAL_TEST_PLAN must then
   list no terminal command in Setup.
14. \[DECISION, user 2026-10-25] The PUBLIC map lives on Firebase Hosting at the SAME <https://bucurestiul-disparut.web.app/>
   (the viewer at the root; the admin moves to a path, e.g. /admin/), published from the admin ("Publish the site" in Setup,
   via the Hosting REST API from the owner's consent); no GitHub Pages step. Consequences: per-path CSP headers (viewer vs
   admin), the viewer's URL-restricted Mapbox public token minted for <https://bucurestiul-disparut.web.app>, M5's multi-city
   paths (/<city>/) under the same site, the admin's auth handler unchanged (same origin), old Pages links (redirect notice).
   OBSERVED: after D3 the admin LEFT start-up mode by itself (full navigation, the city's brown theme): 13(b) already works,
   so D4 (Hosting normal-mode redeploy) is not needed; drop it from the plan.
   D3 PASSED after the Eventarc retry: d Done, d2 (claim) Done automatically, 5/9.
15. \[copy]\[setup e] The link "Add the payment method (choose Rotate token)" — the parenthesis reads like a stray hint from
   another link; check the deep links' labels against their targets.
16. \[FEATURE, user request 2026-10-25] Step f (USGS) can be skipped and done later: a "Do it later" action on the card
   (state "Later", not "To do"/"Done"); Setup readiness and the dashboard-first rule (§34i) no longer wait for USGS; the
   progress counts it as postponed; Home shows a persistent reminder tile "USGS is not set up yet: historical imagery search is
   off" with "Set up USGS"; the Imagery area keeps its "set up USGS first" state (S-A11-BAD-USGS-NOT-SET-UP); an M2M request
   already sent shows "waiting for USGS approval" with its date. Same pattern worth offering for the other optional/slow steps.
   Rows: happy (skip -> Home opens, reminder shown, later completion clears it) and bad (Imagery search while skipped).
   E PASSED: "Saved for the Mapbox account ventura86", both public tokens minted (viewer token still restricted to
   ventura8.github.io: re-mint for bucurestiul-disparut.web.app per #14).
17. \[BUG]\[provision IAM] Step h import stuck at 0/45: the uploads reach Storage, but Eventarc cannot deliver the events:
   photos-onupload logs "The request was not authenticated ... The IAM principal lacks run.routes.invoke". Event-triggered
   functions run as fn-events@ and Eventarc invokes them with that account, which has no roles/run.invoker; the same will hit
   the scheduler jobs (OIDC as fn-admin@) and possibly the task-queue functions. Fix: Provision's "Permissions" grants
   roles/run.invoker to fn-events@ and fn-admin@ (project level, or per service after install), a self-test check
   "events reach the server", and the e2e/rules cannot catch it (emulators skip IAM) -> add a contract/real-data probe and a
   LESSONS entry. Also: events delivered while the invoker was missing are lost (no retry on Storage-finalized?) -> the
   import must re-trigger processing for photos stuck in "pending" (photos.reprocess) instead of waiting 10 min per photo.
   WORKAROUND APPLIED LIVE (user approved, 2026-10-25): roles/run.invoker granted at project level to fn-events@ and fn-admin@
   in the Cloud Console; Eventarc redelivered the stuck events within minutes. H PASSED: 45/45 imported, processed and
   published; public manifest cities/bucharest/manifest.json (45 photos, max-age=60, CORS *), web/thumb WebP 200.
18. \[info] The new billing account is a Google Cloud FREE TRIAL ($300, 90 days). The app should detect a trial billing account
   in step b and remind the owner (Home tile, ~2 weeks before the end) to upgrade, or the server stops when the trial ends.
19. \[ux]\[setup] After step h finished, the card jumped to the next unfinished step (f) by itself: fine, but no confirmation of
   what just finished ("45 photos imported") stays visible; a snackbar "All 45 photos are on the map" would close the loop.
20. \[BUG]\[self-test ai] Server checks: "Translation drafts (Vertex AI): Unavailable now — Something went wrong on the server."
   The function logs only {"check":"ai","code":"apiError.internal"}; the Agent Platform (aiplatform) API IS enabled and its
   metrics show NO request/error, so the call fails before reaching Vertex (request building, endpoint/region, model id
   gemini-2.5-flash-lite, the fn-admin token, or the custom role). Fix: (a) log the upstream status/api/reason (never secrets)
   and map it to an actionable message instead of "Something went wrong"; (b) find the real cause with a real-data probe;
   (c) a free-trial billing account may not have Gemini access — check and say so.
21. F: the owner saved the USGS token; step f shows "Waiting": "USGS has not approved M2M access for this account yet. We
   check again every 6 hours." (correct). G: "Google Analytics is not enabled for the project" -> the owner must enable it in
   the Firebase console (Project settings > Integrations > Google Analytics) — a human step by design (Google's terms).
22. \[layout]\[setup] Scrolled to the bottom, the page shows a band of a different background below the content (the shell's
   surface does not fill the viewport height when the content is shorter than the scrolled viewport).
23. C (photos) PASSED so far: list 45 with thumbnails, map draws (clusters/markers), editor opens with in-view, bulk "Confirm
   rights" on all 45 -> manifest republished 16:34 with rightsReview false x45. G PASSED (measurement id found).
24. \[ux]\[setup] "Setup 8 of 9, not done" only because f waits on USGS's M2M approval (days): the user read it as "Setup is
   broken". With #16 the header should say "Setup done — USGS approval pending" and the dashboard-first rule should open Home.
   The Vertex AI check failing is not a step but sits in the same card with an alarming icon (#20).

## Live test 2026-10-31 (M6 admin)

The user's second live walk, on the same project: the admin `1.0.0+18977f0` deployed to `/admin/` in its start-up
variant (D1), the server still the 61 functions of `90b31be` (2026-10-25). The numbering continues the list above.
What each finding changed, its rows and its decisions: `docs/LESSONS.md` 296–298 and 300–305, `DECISIONS-for-review.md` §75 and
[M6-status.md](M6-status.md) §6. Findings 29, 32 and 34 and the live outcome of 2026-11-01 were recorded on 2026-11-01.

- **25.** \[bug, minor]\[hosting] On the start-up root (`/`, "the map is being set up"), an old admin address typed as a hash
  change only (`/#/setup` while already on `/`) did not forward to `/admin/#/setup`; a fresh load did. Cause:
  `scripts/site/src/hosting/admin-redirect.ts` read `location.hash` once, at load. FIXED: it also forwards on
  `hashchange` (S-A58-HAPPY-OLD-LINK-HASH-CHANGE, S-A58-BAD-VIEWER-HASH-CHANGE).
- **26.** \[DECISION for the user] The per-tab sign-in (`DECISIONS-for-review.md` §73a) is tiring live: every new tab, every
  notification link and Claude's own tab ask to sign in again. The alternative, the admin on its own Hosting site with
  the normal local persistence, is written up as a proposal in §75c; nothing changed. The user's decision (2026-11-01):
  §75c REJECTED, "we don't want the admin on its own hosting site"; the per-tab sign-in of §73a stays.
- **27.** \[bug]\[setup] After the redeploy Setup read 3 of 11: d2 "Take over the map", e Mapbox, f USGS, g Analytics and h old
  photos "To do", which the old admin against the same server showed Done (USGS "Waiting"). Causes, from the code:
  (1) the M6 admin's `admin.session` schema requires M5's `cities` and `projectOwner`, which the pre-M5 server does not
  return; the adapter turned the mismatch into `internal`, which the probe reads as "no server", so the admin stayed in
  start-up mode (or showed "the server is down" after a sign-in) and never asked `setup.status`; (2) in start-up mode
  step d waited for all 69 functions of the M6 registry, so the 61 of `90b31be` never led to the probe and the claim
  that had taken the old admin out of start-up mode by itself (finding 14); (3) a step nothing had checked read
  "To do". Stored state was not the cause: `localStorage` and `sessionStorage` belong to the origin, not the path.
  FIXED: the session schema reads a pre-M5 answer (no city, not the project's owner); an answer in a shape the admin
  cannot read is `apiError.serverOutdated` (a server that answered, never "no server"), so a browser that had seen the
  server (`hcm:admin:serverSeen`) leaves start-up mode by itself again; in a browser that had not, step d waits for the
  whole M6 registry and Update the map installs it; a step the older server cannot say reads **Update the server to check**
  (`adminSetup.state.unknown`), never "To do" (S-A03-HAPPY-OLDER-SERVER, S-A03-BAD-OLDER-SERVER-STATUS).
- **28.** \[BUG, blocks Setup d] The in-app server install (Cloud Build, `hcm-installer@`) stopped at step #3, `functions`:
  `firebase-tools` 15.34.2 runs `checkServiceAccountIam` (`lib/deploy/functions/checkIam.js`, from
  `lib/commands/deploy.js` for any functions target) before it deploys anything, and it requires
  `iam.serviceAccounts.actAs` on `<project>@appspot.gserviceaccount.com`, the App Engine default account:
  "Missing permissions required for functions deploy. You must have permission iam.serviceAccounts.ActAs on service
  account …". The user's decision (2026-10-31): "Code fix first, live later". FIXED: Provision's `iam` item grants
  `hcm-installer@` `roles/iam.serviceAccountUser` on that one account (its own policy, never project-wide) when the
  account exists (a GET; a 404 grants nothing and is no failure); the custom role `hcmInstaller` also gains
  `cloudfunctions.functions.setIamPolicy`, which `checkHttpIam` requires before a deploy creates an HTTPS function. A
  stopped build whose log names one of these checks offers step c's **Retry what failed** on the server's card (it
  reruns the `iam` item, whose row names the reason), then **Try again**. The fakes now enforce the check
  (S-A04-HAPPY-APPENGINE-ACTAS, S-A04-BAD-NO-APPENGINE-ACCOUNT, S-A55-BAD-NO-ACTAS). Live, after the next admin
  redeploy: Setup c **Retry what failed**, then d **Try again** (`docs/MANUAL_TEST_PLAN.md`).
- **29.** \[bug]\[setup d] An admin tab left open across a Hosting redeploy kept running the old admin's code (the hashed chunks of
  the old release), and its actions used the old release's install bundle, which the redeploy had removed: a server build
  then stopped at `fetch` with "manifest.json is not the one the admin read". FIXED (`DECISIONS-for-review.md` §75i, lesson
  303): the admin reads its `runtime.json` again (no-store, a few hundred bytes) when the tab becomes visible again (at most
  once a minute), every five minutes while it is visible, and before it submits any install build
  (`packages/admin/src/app/release-watch.ts`); once Hosting serves another release, a polite banner above the page says
  "A new version of the admin is ready" with **Reload** (the sign-in, kept in the tab's `sessionStorage`, survives it),
  and an install click refuses (`apiError.install.adminOutdated`, naming the newer release) instead of submitting a build
  (S-A61-HAPPY, S-A61-BAD-INSTALL-REFUSED; tour `shell.new-release`).
- **30.** \[BUG, blocks Setup d] With the actAs grant in place (admin `1.0.0+60fe650`), the server install passed
  `firebase-tools`' check and started `deploy --only functions --force` (step `functions`, `steps/deploy-with-retry.mjs`),
  which printed "⚠ functions: Couldn't find firebase-functions package in your source code. Have you run 'npm
  install'?", "Loading and analyzing source code for codebase default to determine what to deploy", then "Error: An
  unexpected error has occurred.". Cause: `firebase.json`'s functions source is `functions/dist`; `server.tgz` carries
  it with its `package.json` and deploy lock but no `node_modules`, and `firebase-tools` resolves `firebase-functions`
  from that folder and loads `index.js` to discover what to deploy. From a checkout Node finds the packages in the
  repository's `node_modules` above it, so no laptop deploy, and no fake, ever showed it. FIXED: the server build's step
  `packages` (**Install the server's packages**, after `tools`) runs `npm ci --omit=dev --ignore-scripts --no-audit
  --no-fund` in `server/functions/dist`; the fake Cloud Build stops a server definition without it at `functions` with
  those lines (S-A55-BAD-NO-FUNCTIONS-PACKAGES); every other step was audited for the same kind of gap
  (`M6-interfaces.md` §1.4.1, addendum). Live, after the next admin redeploy: the stopped build is of an older release,
  so (d) offers the install again (the update against the server of `90b31be`; Install the server on a fresh project),
  and its one click runs the build with `packages`.
- **31.** \[bug]\[setup] Step (d), Install the server, waited for the whole of step (c), so an item only the optional
  imagery pipeline needs (the Artifact Registry repository `hcm`) not done held the server back. FIXED
  (`DECISIONS-for-review.md` §75h, lesson 302): (d), the install cards' looks and the deployment's watch wait for every
  item the server needs (`serverPrepared`); the installer's writer role on `hcm` moved into the `artifact-registry`
  item, which the `iam` item no longer waits for; the pipeline's card names the missing repository
  (S-A55-HAPPY-PIPELINE-ITEM-FAILED, S-A55-BAD-SERVER-ITEM-FAILED).
- **32.** \[bug]\[setup] Right after a reload Setup showed every step as "To do" (0 of 11) for several seconds, until the
  server's record (`setup.status`) and the checks answered. FIXED (§75j, lesson 304): until a step's first check answers
  (the server's record, read or refused; the legacy import's own detection; the tab's record in start-up mode) its chip
  reads **Checking…** / **Se verifică…** with the loading indicator, and the header says "Checking every step…" over an
  indeterminate ring with no count, Check again off; a record that cannot be read ends it with the page's alert
  (S-A03-HAPPY-CHECKING-AFTER-RELOAD, S-A03-BAD-CHECKING-STATUS-FAILS; tour `setup.loading`).
- **33.** \[BUG, blocks Setup d] With findings 28 and 30 fixed, the server install (Cloud Build f92cec75) passed fetch,
  tools, packages, rules and indexes, the source upload and the Pub/Sub and Eventarc identities; then every function
  create and update failed: "HTTP Error: 403, Caller is missing permission 'iam.serviceaccounts.actAs' on service
  account `projects/-/serviceAccounts/<number>-compute@developer.gserviceaccount.com`. Grant the role
  'roles/iam.serviceAccountUser' to the caller on the service account …", then "failed to create/update function …".
  Cause: Cloud Functions gen 2 builds each function as the Compute Engine default account (`firebase-tools` names no
  build account), and the API requires the deployer to act as it. The user's decision (2026-10-31): "Act-as + narrow its
  role". FIXED (`DECISIONS-for-review.md` §75g, lesson 301): Provision's `iam` item grants `hcm-installer@` Service
  Account User on that one account (its own policy), gives the account `roles/cloudbuild.builds.builder` on the project,
  then removes its `roles/editor`; the server's card finds the 403 anywhere in the stopped step and offers **Retry what
  failed in step c**, then **Try again** (S-A04-HAPPY-COMPUTE-BUILD-ACCOUNT, S-A04-BAD-COMPUTE-EDITOR-REFUSED,
  S-A55-BAD-NO-COMPUTE-ACTAS). Live, after the next admin redeploy: reload the tab, (c) **Retry what failed**, (d) **Try
  again** (`docs/MANUAL_TEST_PLAN.md`).
- **34.** \[bug]\[setup c] After **Check again** on step (c) in a tab whose one-hour Google permission was gone (or never
  granted), "Prepare the Google Cloud project" turned to "To do" although its last provision run had finished every item
  (the server's record said done). Related, found by the §75b work: `provisionRequest` never recorded a doctor's `missing`
  result, so a re-check could not show an item that had gone back to missing (the record turned the chip back to Done).
  FIXED (§75k, lesson 305): without a Google token Re-check changes nothing (no doctor runs; an item Google refuses with
  401 mid-check is neither shown nor recorded) and the card says "Last checked {time}; sign in to Google Cloud to check
  again"; with a token a run records exactly what it reported, `missing` included, so the server's record follows the
  project both ways (S-A04-BAD-RECHECK-NO-TOKEN, S-A04-HAPPY-RECHECK-RECORDS-MISSING; tour
  `setup.provision-last-checked`).

Also checked: the sign-in card showed in English in an English Chrome with no saved choice. That is the admin's rule:
`?lang=`, then the stored choice (`hcm:admin:lang`), then the browser's first language (`resolveLocale`: English for
any `en*`), then Romanian (`packages/admin/src/state/locale.ts`; `M2b-interfaces.md` §1.6; the i18n skill). PLAN's
"default RO" holds only when the browser's first language is not English; nothing changed (the user decides).

### The live outcome of 2026-11-01

- **The server**: `1.0.0+9e2e6b5` installed from the app (Setup d, Cloud Build, no terminal), the admin the same release.
- **Setup**: steps a–i done.
- **The public map**: live at the root of `https://bucurestiul-disparut.web.app/` once step (e)'s **Replace the visitors'
  token** had minted the visitors' token again.
- **Translation drafts**: Vertex AI does not offer `gemini-2.5-flash-lite` to the project: the model is the user's
  decision of `DECISIONS-for-review.md` §67g.
- **Mapbox telemetry**: `events.mapbox.com` answers 503 to the map's usage events; harmless (the map draws), nothing changed.
- **The user's decision**: §75c (the admin on its own Hosting site) REJECTED; the per-tab sign-in stays (finding 26).

### The editors on the live map (2026-11-01, admin `1.0.0+9e2e6b5`)

The user's walk through the editors of the migrated Bucharest city, once Setup was done. The numbering continues the
list above; what each finding changed: `docs/LESSONS.md` 306–309 and `DECISIONS-for-review.md` §77.

- **35.** \[bug]\[places] Places → Add place on a city with no place categories (the migrated Bucharest had none: the
  legacy data has no categories, and neither `setup.createCity` nor `cities.create` made any): the Category select was
  empty and Save said only "The value does not have the required format." (the schema's word for the empty category
  id). FIXED (§77a): (a) a new city starts with five starter categories, Clădire/Building, Stradă/Street, Piață/Square,
  Biserică/Church and Monument/Monument (`STARTER_POI_CATEGORIES` of `@hcm/shared`: both labels, the icons the admin's
  icon guesser gives the labels, the default sepia and four companion tones the white glyph reads on), written in the
  transaction that creates the city (`functions/src/api/starter-categories.ts`, from `cities.create` and
  `setup.createCity`; an existing city gets none, `seed/bucharest/` unchanged); (b) the place editor of a city without
  categories shows, instead of the empty select, why a place cannot be saved yet, **Add the starter categories** (one
  batch, ids clear of the city's layers and categories, the new place then in the first) and **Add a category** (the
  settings' new category); (c) the field's problem reads "Choose a category" / "Alege o categorie", never the format
  text (S-A39-HAPPY-STARTER-CATEGORIES, S-A39-BAD-STARTER-CATEGORIES-EXISTING-CITY, S-A39-HAPPY-ADD-STARTER,
  S-A39-BAD-NO-CATEGORIES; tour `pois.no-categories`). Live: the next deploy of the server and the admin; then Places →
  Add place → **Add the starter categories** once in the migrated city.
- **36.** \[bug]\[public map] On the public map (Mapbox Standard Satellite) the lines and area outlines of places were
  thin strokes in the category colour and almost disappeared on the photo. FIXED (§77b): every category draws a white
  casing under its lines and area outlines (`hcm-poi-<id>-casing`, 90 % of the overlay's opacity), the stroke grows with
  the zoom (4 px at zoom 16, the casing 10 px), and the area fill is 35 % (was 30 %); every opacity still scales with the
  overlay's slider, so 0 % hides the casing too. The admin's map draws through the same layers
  (`packages/ui/src/map/pois.ts`; S-V24-HAPPY-LINE-CASING, S-V24-BAD-CASING-AT-ZERO-OPACITY, pixel probes over a dark
  satellite ground).
- **37.** \[bug]\[editors] A required field said the schema's generic words: an empty Romanian title read "The value is
  too small or too short." at the field and "Cannot save. The value is too small or too short." above Save. FIXED
  (§77c): the editing kit's `issue-text.ts` gives a required field the action it asks for ("Add a title in Romanian" /
  "Adaugă un titlu în română", "Add a name in Romanian" for a layer's or a category's label, "Add the city's name in
  Romanian", "Choose a category", "Draw the place on the map or add its positions", "Write the year as a number, such
  as 1966"), and Save's note names every field it waits for ("Cannot save: add a title in Romanian; choose a
  category."); the places, photos, layers and settings editors (categories and texts included) all say their problems
  through it, every other problem keeping the validation words after the field's name (S-A38-BAD-REQUIRED-FIELD-NAMED,
  S-A38-HAPPY-REQUIRED-FIELD-FIXED).
- **38.** \[bug]\[history] History listed created documents by their ids ("Place W1DLFHuhMZpHW6UzReWl") while their
  changes and deletions showed titles ("AreaOne", "Gresit"): a creation entry stores no version (`previous` is null).
  FIXED (§77d): a creation takes the title of the version it made, the `previous` of the next entry of the same document
  when the list holds one, else the document as it is now (read once per document,
  `packages/admin/src/history/names.ts`); only a creation whose document is gone with nothing newer listed keeps the
  kind and the id (S-A23-HAPPY-CREATED-NAMED, S-A23-BAD-CREATED-GONE-UNNAMED). The entries' schema is unchanged, so an
  older admin reads a newer server's entries as before.

### The update check and Settings (2026-11-01, admin `1.0.0+457201e`, server `1.0.0+9e2e6b5`)

After the Hosting redeploy of the admin `1.0.0+457201e` (the public variant). The numbering continues the list above;
what each finding changed: `docs/LESSONS.md` 310–311 and `DECISIONS-for-review.md` §78.

- **39.** \[bug]\[installer] Setup step (d) said "Installed: 1.0.0+9e2e6b5" and offered no **Update the map** for the
  admin `1.0.0+457201e`. Every release is version 1.0.0; the build metadata (`+commit`) has no precedence in semver,
  and the card showed the state the older admin had recorded of its own server (`installed`) without reading it against
  the newer admin (earlier updates were offered only because the old server had no release at all). FIXED (§78a):
  every release has a total order that follows the build: its **build time**, the commit's time in seconds since 1970
  (`SOURCE_DATE_EPOCH`, else `git show -s --format=%ct`), recorded beside the release wherever the release is recorded
  and compared (the admin's `runtime.json` `releaseTime`, the site's `/release.json`, the install manifest, the
  functions' `HCM_RELEASE_TIME`, the pipeline jobs' `hcm-release-time` label, the builds' `_RELEASE_TIME`,
  `setup/status.install.*.releaseTime`). Newer = a higher version, or the same version and a later build time; the
  same commit is installed; an installed build with a different commit and no time (every record and server before
  this change) is behind, never newer, unless its version is higher; a timed installed build is never replaced by an
  admin that knows no time of its own. A recorded state is read again against this admin's own release (Setup's cards
  and Home's tile), so the live server reads as an update without a look at Google; the downgrade guard (a server newer
  than the admin is never replaced) holds with the new order (S-A55-HAPPY-UPDATE-SAME-VERSION,
  S-A55-BAD-DOWNGRADE-SAME-VERSION, S-A55-HAPPY-SAME-BUILD; tour `setup.install-update-recorded`). Live: the next
  Hosting deploy of the admin; then Setup (d) **Update the map** once (one consent); the server it installs names its
  build time from then on.
- **40.** \[bug]\[setup] Card (d) (and any install card) showed Google's consent box ("Google asks for access to Google
  Cloud…") with no Continue button while there was nothing to do (installed, no update). FIXED (§78b): on an install
  card the note shows only with a button of the card that asks Google for the token (Install, Publish, Try again,
  Install the pipeline, Update the map), or beside Continue when a check needs the token again
  (`installCardAsks`, `packages/ui/src/admin/setup/install-status.ts`; S-A55-BAD-NOTE-NOTHING-TO-DO; tour
  `setup.install-nothing-to-do`).
- **41.** \[feature]\[settings] (the user approved) Settings → Place categories gets **Add the starter categories** for
  a city that already has categories. DONE (§78c): one click adds, in one batch, only the starters of finding 35 whose
  label is not there yet (a category's Romanian or English name equal to the starter's Romanian or English one, case,
  diacritics and spacing aside), ids clear of the city's categories and layers, after the city's own in order, as many
  as fit under the 50-category limit; the snackbar says how many; with all five present the action is off with "Every
  starter category is already here" (S-A39-HAPPY-ADD-MISSING-STARTERS, S-A39-BAD-STARTERS-PRESENT; tour
  `settings.categories-starters-added`, `settings.categories-starters-present`).

### The editors, Setup, Jobs, Crashes and push (2026-11-01, admin and server `1.0.0+e53d9ec`)

After the Hosting redeploy and the server update of `1.0.0+e53d9ec`. The numbering continues the list above; what each
finding changed: `docs/LESSONS.md` 312–316 and `DECISIONS-for-review.md` §79.

- **42.** \[bug]\[places] Places → **Add place**, then leaving it untouched (no title, no shape; the category select filled
  in by default) still asked "Discard your changes?". A new place counted as unsaved for being new, and the category
  filled in once the categories were listed was an edit. FIXED (§79a): a new place is unsaved only once it differs from
  its start (typed text, a drawn or placed position, a field moved from its default; `PoiDraft.unsaved`, positions of an
  unfinished shape in `PlaceEditor.unsaved`), and the category filled in later is a default (`PoiDraft.prefill`), not an
  edit (S-A38-HAPPY-NEW-UNTOUCHED, S-A38-BAD-NEW-TYPED-ASKS). UNVERIFIED: a line or an area being drawn on the map whose
  shape is not finished is held by the map's drawing tool, not by the editor, so it does not count until it is finished
  (the vertex list's positions do).
- **43.** \[bug]\[setup d3] Step d3 (the optional imagery pipeline) offered **Install the pipeline** although the install
  bundle's manifest says `tools.docker: null` (§67e undecided: no digest-pinned Docker builder), so a click could only be
  refused. The card read a record of the pipeline (looked at, not installed) without its reason. FIXED (§79b): the cards
  read once, without a token, whether this admin's bundle can install the pipeline (`InstallerPort.localBlocker`, the
  admin's own origin); when it cannot, the card says "Not available yet: …" with the existing copy and shows no button,
  no consent note and no "the same click also installs the pipeline" on the server's card, and neither Install the server
  nor Update the map submits it; with a Docker builder in the bundle the button stays (S-A56-BAD-NOT-AVAILABLE,
  S-A56-HAPPY-INSTALL-ALONE; tour `setup.pipeline-not-available`).
- **44.** \[ux]\[jobs] The Jobs page's empty state only said "No jobs yet.". DONE (§79c): a second line says where jobs
  come from, as Layers' empty state does: Historical imagery's imports (a USGS scene or a GeoTIFF), georeferencing or
  publishing a layer again, and deleting a layer's tiles (`adminContent.jobs.emptyHint`; S-A18-HAPPY-EMPTY-HINT,
  S-A18-BAD-EMPTY-HINT-GONE). Photo reprocessing and the static export do not make jobs (`JOB_TYPES`), so the line does
  not name them.
- **45.** \[ops]\[functions] Crashes showed a production group "The request was aborted because there was no available
  instance…" (Cloud Run's 429), three times from 2026-10-26 to 2026-10-29, application `ops-onbudget`. With one instance,
  a burst of budget notifications that came while it was starting was refused; Pub/Sub delivers a refused message again,
  so no alert was lost, but every refusal was an error. FIXED (§79d): `ops-onBudget` scales to three instances of 80
  concurrent requests (`BUDGET_SCALING`, `functions/src/ops/budget.ts`), no minimum instance (an idle month costs
  nothing), under the five-instance cap of every function; the guard's transaction keeps a repeated alert from turning
  it red or notifying twice (S-A43-HAPPY-BUDGET-BURST, S-A43-BAD-BUDGET-BURST-ONCE). Live: the next server update.
- **46.** \[bug]\[notifications] Notifications → **Notifications on this device**: after Chrome's prompt (granted) the
  admin said "Notifications did not start: This browser could not be registered for notifications. Try again, or use
  the inbox." Live facts: `Notification.permission` granted, the worker `/admin/firebase-messaging-sw.js` active with
  scope `/admin/`, a push subscription held, and a second click made no request to `fcmregistrations` or
  `firebaseinstallations`. That message is `apiError.notify.deviceInvalid`: the browser's side gave an installation id
  and the server's dry run at FCM (`messages:send`, `validate_only`, `fid`) refused it; with no request on the second
  click, `register()` answered from the SDK's own record of an earlier registration. FIXED (§79e):
  (a) a failure says why on a line of its own with its code, the SDK's (`messaging/fid-registration-failed`,
  `messaging/permission-blocked`, `installations/request-failed`, …) or FCM's (`fcm/UNREGISTERED`, passed on by the
  server as the refusal's `reason`), in Romanian and English for the known families, and the log keeps the code and the
  SDK's text with every id, token or key replaced (`packages/admin/src/inbox/push-failure.ts`; the server logs FCM's code,
  never the token); (b) a registration FCM refuses is made again once: the SDK's record is forgotten
  (`packages/admin/src/firebase/fcm-record.ts`) and the browser registers anew, also right after the root's worker of an
  admin before M6 is retired (S-A47-HAPPY-RENEWED, S-A47-BAD-FCM-REFUSED-REASON, S-A47-BAD-SDK-CODE,
  S-A47-BAD-FCM-REASON-NAMED; tour `notify.push-failed-reason`). What `register()` needs, read offline from
  `@firebase/messaging` 0.13.3 and `@firebase/installations` 0.6.24, against this project:
  - the Notifications permission granted: yes (live);
  - the worker's registration passed to `register()`, so the SDK never registers its own `/firebase-messaging-sw.js` at
    `/firebase-cloud-messaging-push-scope`: yes (`scope: './'`, `/admin/` live);
  - a push subscription of that worker, made with the SDK's default VAPID key when the worker has none (an existing one
    is reused whatever its key): present live;
  - Firebase Installations (`firebaseinstallations.googleapis.com`: `createInstallation`, `generateAuthToken`) with the
    web API key: the API is enabled by Provision, the CSP `connect-src` of `/admin/**` allows `https://*.googleapis.com`,
    and the key's referrers are `${origin}/*` of the admin's and the viewer's origins, which the page `/admin/` matches;
  - `CreateRegistration` at `fcmregistrations.googleapis.com` with the key and the installation's token: enabled by
    Provision, allowed by the same CSP;
  - IndexedDB for both SDKs' records (`firebase-installations-database`, `firebase-messaging-database`): a record says
    only the installation id and when it was registered, and is trusted for seven days, whatever worker or subscription
    it was made with: the cause fixed in (b);
  - the server's dry run with `fid` (firebase-admin 14's `FidMessage`) as the functions' account.
  VERIFIED offline: the CSP, the referrers, the enabled APIs, the scope, the record's seven days. UNVERIFIED until the
  next live try (the first attempt of 2026-11-01 was not captured): which of the record's registration (made with an
  earlier worker, or forgotten by FCM) and FCM's refusal of a fresh one it was; that a key auto-created by Firebase
  restricts its APIs to a list that includes the Installations and FCM Registration APIs; that the default VAPID key is
  accepted with `register()` (M4-interfaces §10). The reason line now names the code that settles it.

### The pipeline's jobs, the measurement reports and push again (2026-11-01, admin and server `1.0.0+2073d68`)

After the Hosting redeploy and the server update of `1.0.0+2073d68`. The numbering continues the list above; what each
finding changed: `docs/LESSONS.md` 319–322 and `DECISIONS-for-review.md` §81.

- **47.** \[bug]\[setup d3] The in-app pipeline install (Cloud Build, account `hcm-installer@`) built and pushed the
  pipeline's image, then stopped at step 3 "jobs": `run-jobs: GoogleCallError: POST
  https://run.googleapis.com/v2/projects/bucurestiul-disparut/locations/us-central1/jobs: HTTP 429`. The line carried no
  reason, so the cause is UNVERIFIED: a quota (the project is on the Google Cloud free trial) or a request rate. FIXED
  (§81a): (a) every Google refusal a step prints carries Google's error essentials, `error.status`, `error.message` and
  each `ErrorInfo` (reason and metadata such as `quota_metric`, `quota_limit`, `consumer`) and `QuotaFailure` violation,
  redacted of bearer tokens, keys, URL queries (signed URLs) and e-mail addresses
  (`scripts/site/src/install/steps/google-error.ts`, `step-io.ts`); (b) a 429 or `RESOURCE_EXHAUSTED` of the request rate
  (`ErrorInfo` `RATE_LIMIT_EXCEEDED`, or no details) is tried again after 5, 10, 20 and 40 s, each with jitter (half to
  one and a half times) or Google's `Retry-After` when longer, at most 60 s a wait and under four minutes in all, each
  wait a `retry` line the pipeline's card shows as "Google is still preparing its change quota"; the jobs are made one
  after the other; a quota (a `QuotaFailure`, or any other reason) is not tried again and the step ends with a line naming
  it and a `quota` event (`run-jobs.ts`); (c) the pipeline's card turns that event into "Google Cloud refused a quota: {metric}
  (limit {limit}). A free-trial project has lower quotas: upgrade the account, or ask Google for a higher quota." with **Open the Quotas page** (`gcp.quotas` of `links.json`: the project's Quotas page filtered to
  the API), keeping Try again (S-A56-HAPPY-JOBS-RATE-LIMITED, S-A56-BAD-JOBS-QUOTA; tour `setup.pipeline-retrying`,
  `setup.pipeline-quota`). (d) The jobs' sizes against Cloud Run's documented limits, read offline: 4 vCPU / 16 GiB and
  8 vCPU / 32 GiB, the second at the per-instance maximum of a Cloud Run job (8 vCPU, 32 GiB), each within the memory a
  CPU count allows; both definitions are valid. Creating or updating a job definition starts no instance, so it should use
  no CPU or memory quota (those count running instances: an execution); what a create does count is the Run Admin API's
  request rate per region (job writes per minute), which the step's two writes plus their operation polls (one GET every
  5 s) would exceed only on a quota far below the default. So the live 429 was most likely the request rate (a free-trial
  or new project's lower API limits) and is now waited out; if it was a quota, the next run names it. UNVERIFIED: which it
  was, the names Cloud Run gives its quotas (the fake's `run.googleapis.com/cpu_allocation` and `CpuAllocPerProjectRegion`
  are placeholders), and the Quotas page's `service` filter parameter (the weekly contract run probes the link).
- **48.** \[bug]\[setup g] **Create the measurement reports** said "The service is unavailable right now. Try again." although
  the request never reached Google: the user's network (a Pi-hole DNS blocklist) resolved `analyticsadmin.googleapis.com`
  to `::`, the browser's CORS preflight failed and `fetch` threw (a network error, no HTTP answer), which the admin's
  Google transport reported as Google's own 503. FIXED (§81b): a Google call of the admin's transport (every browser-side
  Google API the admin calls: Cloud Build, Logging, Cloud Billing, Resource Manager, IAM, Service Usage, Firebase
  Management, Cloud Functions, Run, Hosting, Analytics Admin) that fails without an answer, after its retries, says
  "Request to {host} never left this browser: allow it in your blocker (Pi-hole, VPN) or change network."
  (`adminShell.network.blocked`; the admin guides' table lists the blockers: an ad or tracker blocklist, a Pi-hole, a VPN,
  a firewall), distinct from a server's 503,
  which keeps "unavailable" (S-A22-BAD-REPORTS-BLOCKED-HOST, S-A22-HAPPY-REPORTS-UNBLOCKED). Live after the fix's cause was
  found: once the user allowed `analyticsadmin.googleapis.com` in Pi-hole, the button found property 560685137 and
  created 14 definitions (11 dimensions, 3 metrics), every request answered 200. The same cause explains the earlier
  `events.mapbox.com` 503s in the console: Mapbox GL's telemetry endpoint is on the same kind of blocklist; harmless for
  the viewer (the map draws without it). Not covered: the ownership check's own `fetch` (`auth/ownership.ts`), which
  reads a network failure as "the server is down".
- **49.** \[bug]\[setup] On step g, after a failed **Create the measurement reports** (the red "The service is unavailable
  right now. Try again."), a later run that worked showed "Measurement reports: 14 created, 0 already there." with the old
  red banner still on the card. FIXED (§81c): an in-app input starts a new attempt and clears its card's last failure
  (`withCount` of `packages/admin/src/setup/state.ts`, which every Setup card's action counts before it acts), so a card
  shows only the failure of its latest attempt, or none (S-A22-HAPPY-REPORTS-UNBLOCKED, S-A22-BAD-REPORTS-NEW-FAILURE-ONLY).
  The other cards: every Setup card's action counts its input through the same `withCount` before it acts, so the fix
  covers them all (billing, Provision, the Mapbox and USGS pastes, step g's stream switch, crash e-mails and Turn on the
  API, the legacy import); a check that answers already cleared the failure, and the install cards (d, d3, i) clear their
  own on each click and each look.
- **50.** \[bug]\[notifications] Push still failed live after §79e (admin and server `1.0.0+2073d68`): "Why: Google's
  messaging service refused this browser, also registered anew (fcm/UNREGISTERED)"; the console showed "push registration
  refused by FCM", "push registration refused: registering this browser again", "push registration refused by FCM".
  After the retry the IndexedDB store `firebase-messaging-fid-registration-store` was empty (0 records), while
  `firebase-installations-store` and `firebase-messaging-store` held one each; the worker `/admin/firebase-messaging-sw.js`
  was active with a push subscription and the permission granted. Whether a `POST` to `fcmregistrations.googleapis.com`
  was made was not captured. So the server's dry run `messages:send {validate_only: true, message: {fid}}` answered
  `UNREGISTERED` for an installation id the admin had just registered. Read offline (`@firebase/messaging` 0.13.3,
  `firebase-admin` 14.5.0): `register()` posts the registration, writes its record in the FID store and deletes the
  `getToken` record of the same app id in one transaction, so an empty FID store beside a token record means a later
  `getToken`-path write or a record of another app id (the admin never calls `getToken`): UNVERIFIED which;
  firebase-admin 14 sends a `FidMessage` as `message.fid` and marks `TokenMessage` deprecated, nothing marks FID targeting
  as preview. FIXED (§81d): (a) a device records what it is, `kind: 'token' | 'fid'` (`PUSH_TARGET_KINDS`; the
  request's default `token`; a device stored before has none and is read as an installation id), and every send and dry
  run addresses `message.token` or `message.fid` as it says; (b) a dry run that answers `UNREGISTERED` (or 404) for the
  registration the browser has just made no longer refuses it: the device is recorded with a warning (the kind and the
  code, never the token) and the first real send decides, forgetting it if FCM still does not know it (S-A47-HAPPY-TOKEN,
  S-A47-HAPPY-DRY-RUN-UNREGISTERED, S-A47-HAPPY-LEGACY-FID, S-A47-BAD-TOKEN-UNREGISTERED); a refusal of another kind
  (`INVALID_ARGUMENT`) still says why, after one new registration (S-A47-HAPPY-RENEWED, S-A47-BAD-FCM-REFUSED-REASON).
  (c) With the user's approval of 2026-11-01 the browser registers an FCM registration token: `getToken` with the admin's
  worker (`kind: 'token'`, sent as `message.token`), and a registration FCM refuses is deleted (`deleteToken`, which also
  drops the push subscription) before the browser registers once more; firebase 13 marks both deprecated, so
  `eslint.config.js` allows these two in `packages/admin/src/firebase/messaging-sdk.ts` only. A browser whose device was
  recorded as an installation id keeps it (sent as `message.fid`, forgotten at a send FCM refuses) until push is turned on
  again from it. The next live try: **Notifications on this device**, then **Send a test**.

### Historical imagery: Find, Work and the first real import (2026-11-01, admin and server `1.0.0+c8f0019`)

The admin's Historical imagery → Find over Bucharest after the first real USGS harvest, then the first real import. The
numbering continues the list above. The "#51 admin theme" noted first was withdrawn (the user had changed the city's theme
themselves), so 51–58 are the imagery findings; what each changed: `docs/LESSONS.md` 323–330 and
`DECISIONS-for-review.md` §82.

- **51.** \[bug]\[imagery] The scene footprints on the imagery map were solid blue fills; nearly every frame covers the
  whole city, so the stacked fills hid the basemap: a flat blue field with white road lines. A first fix drew them as
  outlines; the user's look at it zoomed out (2026-11-01: "what is this madness of lines on the map") showed dozens of
  crossing edges, since Corona and KH-9 footprints are long strips over the whole region. FIXED (§82a): by default the
  map draws no result's footprint, only the city's boundary (a thin line in the city theme's light `primary`) on the
  normal basemap, at the city's own view; exactly one footprint, the open scene's (outline and a light fill, 0.35 × 0.6
  of the theme's light `tertiary`), and the map never zooms out to a footprint (`packages/admin/src/imagery/imagery-map.ts`).
  Pixel probes: six overlapping results and none open leave the basemap's own colour at the city's centre and no
  footprint; the open scene alone is drawn, its fill's blend at the centre (S-A11-BAD-FOOTPRINTS-STACKED,
  S-A11-HAPPY-FOOTPRINT-SELECTED; tour `imagery.results-previews-unavailable`). Not done: a "Show all footprints"
  switch (optional in the user's request; the list is the way to pick) and a footprint on hovering a row.
- **52.** \[bug]\[imagery] Only one result showed its browse thumbnail (a 1964 KH-4A Corona); the others showed the generic
  placeholder. Root cause, from the code: the list showed a thumbnail only for a scene whose copy already existed in our
  bucket (`browse.state: 'copied'`) and never asked for one: the copies are made by the harvest's prefetch (the 20
  best-ranked frames, each fetched with a 10 s limit at the end of the up to 300 s search) and by opening a scene
  (`imagery.browse`); a scene whose copy was not made yet (`none`) and one whose copy failed (`failed`) showed the same
  placeholder forever. The one thumbnail is most likely the scene that was opened (the page and the list share the
  browse images), or one of the prefetch's few copies. Not the URL signing, CSP or CORS (that one image loaded through
  the same Storage read), not the KH-9 browse naming (every dataset's `browsePath` is held to `usgsBrowseUrlSchema`), not
  lazy loading (the `<img>` is eager). UNVERIFIED: why the prefetch's own copies were missing live (each scene's
  `browse.state` and the harvest's `browse image not copied` warnings in the functions' logs would say: `none` means not
  attempted, `failed` an answer USGS did not give within 10 s or a refused address). FIXED (§82b): the list's first 24
  rows ask `imagery.browse` for the copies they lack, four at a time, the next starting as each ends; the scene's page
  asks for its own at once, sharing a copy already asked for; a row whose copy failed shows a broken-image icon with the
  reason ("The USGS preview cannot be fetched right now. Try again.") in its name, and its page keeps Try again
  (`packages/admin/src/imagery/browse.ts`, `packages/ui/src/admin/imagery/scene-list.ts`; S-A11-HAPPY-ROW-PREVIEWS,
  S-A11-BAD-ROW-PREVIEW-UNAVAILABLE; tour `imagery.results-previews`).
- **53.** \[bug]\[imagery] Three results read exactly "KH-4A Corona · Jun 18, 1964": nothing told them apart. FIXED
  (§82c): every row has a line with the frame's USGS id, its camera and frame number when the id says them (Corona's and
  KH-9's panoramic frames end in `A`/`F` and the frame, `DS1012-1043DA015` → "aft camera, frame 15"; KH-9's mapping
  frames name the frame after the `L`) (`frameText`; S-A11-HAPPY-TWINS-TOLD-APART, S-A11-BAD-TWINS-ALONE). Not done:
  numbering the frames of one day ("2 of 3"), first built and then taken out for the admin's bundle budget (§82g). The id's structure is USGS's naming, read from the ids; the metadata's own "Mission" and
  "Frame" fields stay UNVERIFIED (M3-interfaces §14).
- **54.** \[bug]\[imagery] While an import ran, the "Work (0)" tab count stayed 0: it counted only what waits for the
  admin. FIXED (§82d): Work's count is what Work lists, live: every unfinished version (an import running too) and every
  open order (`packages/ui/src/admin/imagery/hcm-imagery-page.ts`, `orders/order-list.ts`; S-A12-HAPPY-WORK-COUNT,
  S-A12-BAD-WORK-COUNT-ENDED). The orders' count of §M4 changes with it: an order waiting for its delivery counts too.
- **55.** \[bug]\[imagery]\[pipeline] The first real import (KH-9 Hexagon 1972-02-02) sat on "Downloading the scene ·
  Running" for 5+ minutes with the bar barely moving and no bytes shown. FIXED (§82e): the pipeline's fetch reports the
  bytes received as they arrive (`ctx.report_bytes`: the step's share of the progress at once, and
  `steps.fetch.bytes` with `steps.fetch.totalBytes` from `download-options`' size, with the progress, written at most
  every 5 s), and the version's step line reads "Downloading the scene · Running · 1.23 of 3.4 GB" (gigabytes, two
  decimals; the bytes alone while the total is unknown) (`pipeline/src/hcm_pipeline/jobs.py`, `steps/fetch.py`, `totalBytes` in `jobDocSchema`,
  `packages/ui/src/admin/imagery/version-detail.ts`; S-A12-HAPPY-DOWNLOAD-BYTES, S-A12-BAD-DOWNLOAD-SIZE-UNKNOWN; tour
  `imagery.version-downloading`).
- **56.** \[cost]\[pipeline] The first import ran on `raster-pipeline-xl` (8 vCPU / 32 GiB) while the fetch was
  network-bound: ~3 % CPU and 2–3 MB/s from USGS for 30+ minutes, eight vCPUs paid to idle. FIXED (§82f): a third Cloud
  Run job, `raster-fetch` (1 vCPU / 4 GiB), made by the pipeline install's `jobs` step with the other two; an import's
  download phase (`DOWNLOAD_STEPS`: fetch and extract) is dispatched to it, and the pipeline then queues the job again
  (no new attempt) for its processing on `raster-pipeline` (`-xl` for a KH-9 panoramic frame); an out-of-memory exit moves
  a job to the next larger job (`fetch` → `std` → `xl`), and the processing never downloads again (its steps are done);
  the version records which job each phase ran on (`machines.download`, `machines.process`); extract frees each segment
  from the in-memory scratch once it is in the bucket. A pipeline run no dispatcher sized (the coming local worker) runs
  both phases. Rows S-A12-HAPPY-DISPATCH-PHASES, S-A12-BAD-PHASE-OUT-OF-MEMORY (functions), S-P01-HAPPY-PHASES,
  S-P01-BAD-PHASE-ESCALATED (pipeline). The pipeline card's cost line names the run costs (about US$0.09 an hour on the
  small job, US$0.37 on the standard one). The live project needs the pipeline installed again (Setup → the pipeline
  card) with the server of this change: a server that dispatches to `raster-fetch` before the job exists retries the run
  a minute later until its attempts are used.
- **57.** \[bug]\[pipeline] The same import, on `raster-pipeline-xl`: fetch 22:29:09–23:15:56 (about 7 GB at 2–3 MB/s),
  extract to 23:20:10, stitch started 23:20:11, then "Container terminated on signal 9" at 23:22:01: the stitch joined
  the KH-9 scan's parts in memory (every segment read whole, the joined frame, its border crop: several times the
  frame) and was killed even at 32 GiB. FIXED (§82h): the frame is never held whole. `stitch` stages two segments at a
  time (each let go once paired), finds each offset from shrunk copies and full-resolution strips, crops the film border
  on a preview shrunk to at most 16 384 px on its long side, and writes `frame.json` (each segment's place in the frame)
  and `frame-preview.tif`; `locate` scores the preview and reads the city's window out of the segments that cover it,
  one at a time; a 16-bit segment is read through its own linear stretch; `GDAL_CACHEMAX` is 1024 MB
  (`pipeline/src/hcm_pipeline/frames.py`, `steps/stitch.py`, `steps/locate.py`). A retry reuses the delivery and the
  segments in the bucket (the done steps are skipped). Rows S-P01-HAPPY-BOUNDED-MEMORY (a 20 MB frame stitched within
  half of it, offsets exact), S-P01-BAD-CROP-ACROSS-SEGMENTS; the synthetic georeferencing tests unchanged and green.
  UNVERIFIED until the next live import: the peak on the standard job (the scratch folder is memory on Cloud Run, so two
  staged segments count: about the size of two of the delivery's TIFFs, plus a window of the city at full resolution).
- **58.** \[bug]\[imagery] The version page still showed "Joining the scan's parts · Running" minutes after the
  execution died: the tick asks Cloud Run only once a job's lease lapses (10 minutes after the last heartbeat). FIXED
  (§82i): a running job not written for three heartbeats (3 minutes) has its execution asked at the next tick (every
  5 minutes), so a killed run is noticed within about 8 minutes: out of memory on `raster-pipeline-xl` fails the job and
  its version with "The frame did not fit in the processing memory" and, since the pipeline of finding 57 may fit it,
  **Try again** is offered (`apiError.imagery.outOfMemory` left `NOT_RETRYABLE_CODES`); out of memory on a smaller job
  runs again on the next larger one; another exit runs again until the attempts are used. A late heartbeat of a run
  Cloud Run still runs is left alone (`functions/src/imagery/tick-jobs.ts`; S-A12-HAPPY-DEAD-EXECUTION-NOTICED,
  S-A12-BAD-HEARTBEAT-LATE-RUNNING, S-A12-HAPPY-OUT-OF-MEMORY-RETRY).

### The KH-9 import after finding 57 (2026-11-02, admin, server and pipeline `1.0.0+9ecfe87`)

The retry of the KH-9 Hexagon import (1972-02-02, `D3C1202-200149F039`, forward camera, frame 39) on
`raster-pipeline-xl`, 00:32–00:37: `stitch` done in 2 minutes within its memory (finding 57 holds), then
"corner guess: rotation 270 degrees, correlation 0.03", `reference` done, `georef` "sift over s2, osm: 0 confident
pairs, 0 suggestions, 0 of 128 tiles matched", the job waiting for the admin's points, exit 0. Changes: `docs/LESSONS.md`
332–334, `DECISIONS-for-review.md` §84.

- **62.** \[blocker]\[imagery]\[pipeline] The version page then read "This could not be read (invalid-document). Try
  again." and Work showed 0: the admin refused the layer version the pipeline wrote (the Work list drops a document
  that fails its schema, so the unfinished version vanished from the count). Root cause, from the code (**UNVERIFIED**
  against the live document, which was not read: its `scan.width`/`scan.height` and `georef.gcps[].pixel` would say):
  the quarter-turn guess of finding 63 mapped the city window across the strip's whole length (a KH-9 panoramic frame is
  about 1:12, some 300 000 film pixels long at 7 µm: about 7 GB delivered), so `locate` cropped and recorded a scan with
  a side over `MAX_SCAN_PIXELS` (200 000) and corner GCPs past it, which `scanSchema` and `pixelSchema` refuse; the
  pipeline declared the limit (`contract.MAX_SCAN_PIXELS`) but never checked it. Ruled out by running the real writers
  through every path and parsing what they wrote: `machines`, `steps.<step>.bytes`/`totalBytes`, the corner `georef`,
  the reference, the suggestions with no pairs, `error {pairs: '0'}` and the waiting job all pass. Found on the way, the
  same class: a step failure with a numeric parameter (`downloadIncomplete {bytes}`, `gcpOutside {count}`,
  `tooFewGcps {min}`) wrote a number where `apiErrorParamsSchema` takes text, so the job and its version would have
  been unreadable too (a pipeline test even asserted the number). FIXED (§84a): `locate` refuses a crop over
  `MAX_SCAN_PIXELS` before reading it (`processingFailed`); a failure's parameters are written as text
  (`StepFailedError`); a contract test runs the real runner along ten paths and holds every job, version and log
  document it writes to a shape of `pipeline/tests/contracts/written-documents.json`, whose documents the shared test
  parses with `jobDocSchema`, `layerVersionDocSchema` and `jobLogDocSchema`; every pipeline error code must be an
  `ApiErrorCode` and `MAX_SCAN_PIXELS`/`MAX_GCPS` join `enums.json`; the admin's store logs a refused document's path
  with its failing fields and codes, never their values ("a document does not match its schema and is not shown",
  scope `admin-store`), while the page keeps its message (S-P01-HAPPY-WRITTEN-CONTRACT, S-P01-BAD-WRITTEN-PARAMS).
  Live: the version stays unreadable until it is written again; **Try again** on it after the next deploy (or, if
  the page cannot show it, the job's retry from Jobs) runs `locate` again under the new guess.
- **63.** \[bug]\[pipeline] "rotation 270 degrees, correlation 0.03": a guess no better than chance was cropped, and its
  scan matched nothing in 128 tiles. Root cause, from the code: the corner guess (`georef/corners.py`) scored all eight
  assignments of the frame's corners to the scene's (four turns, mirrored or not) and kept the best with no threshold;
  on a strip, a quarter turn (or a transposition) stretches every ground pixel by the aspect squared (about 140 times
  for 1:12), and at 60 m a guess a few hundred metres off already correlates about 0.01 on the synthetic world, so any
  sizeable error in the metadata corners left only noise to choose from. **UNVERIFIED** why the right turn scored so low
  live: the corners' error, and the KH-9 panoramic geometry (film position follows the scan angle, the ground its
  tangent; across ±60° a four-corner homography is kilometres off away from the frame's middle). The KH-9 corner order
  in the USGS metadata is read as north-west first and clockwise like every other dataset (`Scene.corner_quad`); a
  forward or aft camera only changes which assignment is right, and all of them are scored. FIXED (§84b): only
  assignments with about square ground pixels are scored (at most 3 times as elongated as the best-shaped one); a guess
  under 0.2 is searched again over the window widened by half on every side, moved by the best match and scored again;
  still under it, `locate` fails with the new `apiError.imagery.cityNotFound` ("The city could not be found on this
  frame: its corners do not match the map. Choose another frame.") instead of cropping; the log names the
  move ("moved 1.3 km by the search around the window") (S-P01-HAPPY-KH9-STRIP, S-P01-BAD-CITY-NOT-FOUND). Not done:
  the frame preview in the admin to mark the city's area by hand (a new georeferencer mode), and a panoramic camera
  model for the guess; both in §84c.

### The local worker, live (2026-11-02, admin, server and pipeline after `5d0c318`; the worker image `b9130dc…`)

The owner started M7's worker on a Linux computer against `bucurestiul-disparut` and asked: "make sure all of this is
automagic for the admin!!!". Changes: `DECISIONS-for-review.md` §85, `docs/LESSONS.md` 345–349, the addendum of
2026-11-02 (findings 65–69) of `docs/research/M7-local-worker.md`.

- **65.** \[ux]\[setup] "Update the map" installed a release whose Provision items had changed (M7's public pull of the
  Artifact Registry repository `hcm`, the 7-day lifecycle of `usgs-raw/`), and nothing applied them: the owner had to
  open step c, Check again (a consent), then Retry what failed. Root cause: Provision ran only from step c; the record
  said each item `ok` under the definition of the release that ran it, and nothing told a newer admin which items its own
  definitions had changed. FIXED (§85a): the item set is versioned (`PROVISION_SET_VERSION`, `PROVISION_CHANGED_IN` of
  `@hcm/shared`; version 2 for M7's two items) and `setup/status.provision.setVersion` records the version a run brought
  the project to (a run that reported every item changed since `ok`, step c's first run included). Update the map (the
  server card's, the pipeline's or the site's, and Home's update tile, which opens it) also runs those items in the same
  click and consent, beside the builds; the server card names them ("The update also brings these project settings up to
  date: …"), and Home shows its update tile for them alone when every target is current (S-A04-HAPPY-UPDATE-PROVISION,
  S-A04-BAD-UPDATE-PROVISION).
- **66.** \[ux]\[worker] Starting the worker needed `mkdir -m 777 ~/hcm-worker` and a long command, and the terminal had
  to stay open. FIXED (§85b): one line, nothing to prepare: `docker rm -f hcm-worker …; docker run -d --name hcm-worker
  --restart unless-stopped -p 127.0.0.1:8765:8765 -v hcm-worker:/work <image@digest> worker --city … --project …
  --pair …`. The named volume `hcm-worker` replaces the bind mount (Docker initialises it from the image's `/work`, owned
  by the worker's user, so no permissions to set); it runs in the background and comes back after a reboot; the same line
  replaces (and so updates) an older worker. The panel writes it for Linux or macOS, or for Windows PowerShell (picked
  from the browser's system), with "Docker is not installed? Get Docker" (S-A62-HAPPY-PANEL).
- **67.** \[ux]\[security]\[worker] The worker's page then asked for a second Google sign-in. FIXED (§85c): pairing. The
  panel mints a one-time code when it shows the command (`worker.pairCode`: 130 random bits, 10 minutes, stored only as a
  SHA-256 prefix with the owner and the image digest; renewed a minute before it ends); the worker exchanges it once
  through `worker.pair` (no sign-in, App Check off, 20 attempts per city in 10 minutes) for a Firebase custom token of
  that owner with the claims `worker: true`, `city` and `pair`, signs in at Identity Toolkit and works as before. Only
  the worker's own callables of that city admit that token (every other callable and the rules want a Google sign-in).
  The refresh token is kept in the volume (`.hcm-session-<city>.json`, mode 600), so a restart needs no new code; a new
  command pairs again and revokes the pairing it replaces; **Disconnect this computer** revokes the worker and its pairing
  (`worker.revoke`; the owner's own sessions are untouched). The worker learns from `worker.hello` and `worker.claim`
  whether its image is still the installed one; an outdated worker takes no job and the panel says to run the command
  again (pairing reused through the volume) (S-A62-HAPPY-PAIR, S-A62-BAD-PAIR-REUSED, S-A62-BAD-PAIR-EXPIRED,
  S-A62-HAPPY-DISCONNECT, S-A62-BAD-WORKER-OUTDATED, S-P04-HAPPY-PAIR, S-P04-BAD-PAIR-REFUSED, S-P04-BAD-REVOKED,
  S-P04-BAD-OUTDATED).
- **68.** \[ux]\[worker] The admin should do the rest by itself. FIXED (§85d): new imports already default to a connected
  computer; a local job that waited 15 minutes (`WORKER_WAIT_MINUTES`) with no computer seen is marked by `imagery.tick`
  (`workerOverdueAt`), leaves one inbox item (`job.noWorker`, pushed by default) and its version page offers **Run in
  Google Cloud instead** first (one click); the Jobs panel follows the connected computer's job live, its step and its
  progress (S-A62-HAPPY-NO-WORKER-OFFER, S-A62-BAD-NO-WORKER-QUIET, S-A62-HAPPY-PROGRESS).
- **69.** \[bug]\[worker] On the live worker (Chrome, `http://localhost:8765/`) **Sign in with Google** completed Google's
  account popup, but the page stayed "Not signed in": no error, no console line, no `POST /session` reached the worker.
  Root cause **UNVERIFIED** (the live page was not instrumented): the Firebase JS SDK's calls from `localhost` carry the
  project's browser API key, which Provision's `api-key` item restricts to the Hosting origins (and the page sends
  `Referrer-Policy: no-referrer`), so Identity Toolkit refuses them; Chrome's partitioned storage of the SDK's auth iframe
  on a non-Firebase origin is the other suspect. Either way the popup's promise never settled. FIXED (§85e): pairing (67)
  makes the browser sign-in unnecessary; the page is for the worker's state, its sign-in a fallback that gives up after 90
  seconds ("The sign-in did not finish: use the command from the admin, which signs this computer in"), and it still shows
  the state when the SDK cannot be loaded. The worker's own calls to Google's token services name the Hosting origin as
  their `Referer`, so the referrer-restricted key accepts them (S-P04-BAD-POPUP-TIMEOUT).

### Open issues of the local worker's live test, and no copy and paste (2026-11-02, admin, server and pipeline `1.0.0+b8b4a26`)

The owner, after Update the map installed `b8b4a26` (17:00–17:15): "I should not have to copy and paste. Fix. Also fix open
issues"; the decision for the first: **Starter file + auto-pair**. The open issues kept their numbers from the session
(59–61, 64, 70, 71), recorded here with their fixes. Changes: `DECISIONS-for-review.md` §86, `docs/LESSONS.md` 350–353,
the addendum of 2026-11-02 (the starter file and auto-pair) of `docs/research/M7-local-worker.md`.

- **59.** \[bug]\[setup] The server card said **Not installed** for a moment while an update started. Root cause: the click
  sets the target's flow busy, and a flow that has not looked at Google yet (the update clicked from Home's tile, or right
  after Setup opened, with no live token) reported its first view, "Not installed", over the recorded target until its
  look answered. FIXED (§86e): a view without a look keeps what the card showed and takes only the click's `busy`,
  `error` and `blocker` (S-A55-BAD-UPDATE-DURING-BUILD).
- **60.** \[bug]\[imagery] The version page showed the raw code (`apiError.imagery.outOfMemory`) under the translated
  message. Root cause: `imagery.tick`'s ending of a lost run writes the job's `message` as the code, and the page prints the
  message as the technical detail. FIXED (§86f): a message that is only a code (or the code again) is not shown; the code
  stays on the job, which **Jobs** shows (S-A12-BAD-LOST-RUN-STEP).
- **61.** \[bug]\[imagery] A failed version's step list still said **Running** on the step the run died in. Root cause: the
  run was killed (out of memory), so nothing wrote the step's end; the tick failed the job only. FIXED (§86f): the page reads
  a `running` step of a failed job as **Failed** (and drops its byte count) (S-A12-BAD-LOST-RUN-STEP).
- **64.** \[bug]\[cost] Cloud Run's free-tier meter showed 0 although the month had cloud runs. Root cause: the count
  (`imagery.onJobWrite`) began with M7's release; runs that ended before it were never counted. FIXED (§86g): once a month
  the first `imagery.tick` adds every city's cloud runs of the month that ended uncounted, from their jobs' times (dispatch
  to end × the machine; at most three hours each), and marks the month `backfilledAt` (S-A63-HAPPY-BACKFILL,
  S-A63-BAD-BACKFILL-ONCE).
- **70.** \[bug]\[setup] While an install or update ran, the server card still showed **Update the map** and the line
  "The update also brings these project settings up to date: …". FIXED (§86i): neither is offered while any target's build
  is queued or running, or a click on one is on its way (S-A55-BAD-UPDATE-DURING-BUILD).
- **71.** \[bug]\[setup] After a successful Update the map that included the changed Provision items, the card still offered
  the update with "also brings these project settings up to date". Found: the items did run (both were already `ok` from an
  earlier manual Retry, and stayed so); the record that names the item set's version (`setup.recordCloud` with
  `provision.setVersion`) was sent beside the server's build, to the server being replaced (a release before `b8b4a26`), whose strict
  request schema did not know `setVersion` and refused the whole record (the step's error, on step c's card). FIXED
  (§86d): an update that installs the server records Provision's result once that build has settled
  (S-A55-HAPPY-UPDATE-WITH-PROVISION). Live: one more **Update the map** after this release records it (the server now
  knows the field).
- **72.** \[ux]\[worker] "I should not have to copy and paste." FIXED (§86a–§86c): **Use this computer** on the worker's panel
  saves a small starter file for the browser's system (Linux `hcm-worker.sh`, macOS `hcm-worker.command`, Windows
  `hcm-worker.bat`, switchable), which holds no secret. Opened once, it checks Docker (Get Docker when missing) and installs a
  supervisor of the owner's user, no administrator rights (Linux a `systemd --user` service, else the desktop's autostart;
  macOS a LaunchAgent; Windows a task at logon, else the Startup folder), which asks the server for the installed pipeline
  image (`worker.image`), pulls it by digest and runs the worker with `--supervised --image <digest>` and no restart policy;
  when the worker ends (exit 75 when its image is older than the installed one, or any other end) it waits and starts the
  installed image again, so updates reach the computer with no paste and no Docker socket in the container. The admin pairs
  the computer by itself: while the panel is shown, or the admin is open in a browser that set the computer up, it reads
  `http://127.0.0.1:8765/state` (the worker answers CORS and Private Network Access's preflight for the project's Hosting
  origins only) and posts a fresh one-time code to the worker's `POST /pair`: **Connecting this computer…**, then **This
  computer is connected**. **Stop using this computer** gives the same file set to remove the service, the worker and its
  volume, and disconnects the computer's worker. The copyable command stays behind **Advanced** (S-A62-HAPPY-STARTER,
  S-A62-BAD-STARTER-TEMPLATE, S-A62-HAPPY-STOP-COMPUTER, S-A62-HAPPY-AUTO-PAIR, S-A62-HAPPY-STARTER-IMAGE,
  S-A62-BAD-STARTER-NO-IMAGE, S-A62-HAPPY-STARTER-UPDATE, S-A62-BAD-STARTER-OUTDATED, S-P04-HAPPY-AUTO-PAIR,
  S-P04-BAD-AUTO-PAIR-ORIGIN, S-P04-BAD-SUPERVISED-OUTDATED). **UNVERIFIED** until the owner's first run: each system's
  double-click (Gatekeeper, SmartScreen, a file manager that opens a `.sh` in an editor), the Scheduled Task without
  administrator rights, Chrome's Local Network Access prompt for the admin's look at `127.0.0.1`, and browsers other than
  Chrome.

### The starter file, live (2026-11-03, admin, server and pipeline `1.0.0+bf74d17`)

After **Update the map** installed `bf74d17` (Cloud Build `e407898b` rebuilt the pipeline image, tag `pipeline:1-0-0-bf74d17`,
and its `jobs` step put the new digest on the Cloud Run jobs), the owner used the worker's panel on Linux in Chrome. Changes:
`DECISIONS-for-review.md` §87, `docs/LESSONS.md` 354–355, the addendum of 2026-11-03 of
`docs/research/M7-local-worker.md`.

- **73.** \[ux]\[worker] **Use this computer** downloaded nothing: no `hcm-worker.sh` in `~/Downloads`, no `.crdownload`.
  The page saved a file it made itself (a Blob URL behind a synthetic click after an `await`). Root cause **UNVERIFIED**
  (Chrome's download bubble was not inspected): a `.sh` is a type Chrome lets through only for a download the user
  starts from a site they know. FIXED (§87d–§87e): the link points at the server's new public function `worker.starter`,
  which answers the filled file with `Content-Disposition: attachment`; one `HEAD` when the panel shows tells a server
  that does not make the file yet ("update the map"). After the click the panel says the browser may ask to keep the file
  and that it is in Downloads, and on Linux shows `sh ~/Downloads/hcm-worker.sh` with **Copy the line** (GNOME opens a
  downloaded `.sh` as text); a worker that comes up turns it to **Connecting this computer…** by itself
  (S-A62-HAPPY-STARTER, S-A62-BAD-STARTER-TEMPLATE, S-A62-HAPPY-STOP-COMPUTER, tour `worker.local-downloaded`,
  `worker.local-advanced`).
- **74.** \[bug]\[worker] The public `worker.image` answered `pipeline@sha256:ae268234…` (the image of `b8b4a26`) with the
  release `1.0.0+bf74d17`; the supervisor pulled that old image, whose worker refused `--supervised --image`
  ("unrecognized arguments", exit 2) and was started again in a loop. Root cause: the record's digest came only from the
  build log's last line (the `jobs` step's `image` event), which the admin read once, when it first saw the build end, and
  cached; Cloud Logging had not delivered that line yet, so the record kept the earlier digest while the state change to
  installed wrote the new release from the jobs' label, and no later look changed the state. FIXED (§87a–§87c): the admin
  and the server read the digest the job `raster-pipeline` runs (with its label's release; the server keeps it a minute,
  `fn-admin@` gains `roles/run.viewer` through Provision's `iam`, set version 3), the record follows the image as well as
  the state, a release is never paired with another digest, and the supervisor says once "update the map" and waits 5
  minutes after three usage errors in a row (S-A62-HAPPY-STARTER-IMAGE-UPDATE, S-A62-BAD-STARTER-IMAGE-STALE,
  S-A62-BAD-STARTER-OLD-IMAGE). Live: one more **Update the map** applies the role and installs the server that reads the
  job; the looping supervisor then pulls the new image at its next ask.

### The worker paired live, and the 1972 import on the owner's computer (2026-11-03, admin, server and pipeline `1.0.0+27a537d`)

After **Update the map** installed `27a537d` (`worker-starter` answered at 19:54, `worker.image` named the job's digest
`sha256:8aa2d47e…` with the release `1.0.0+27a537d` at 19:55: finding 74 fixed live), Claude started the `systemd --user`
service installed earlier from the live template; it ran the new image and answered `pairable`. Opening **Jobs** paired
nothing until the owner clicked **Use this computer**; then the admin posted a code and the worker signed in
(18:39:49 UTC, "paired with the admin's code"), and the KH-9 import of 1972-02-02 the owner started was claimed by the
computer within its 30 s poll.

- **75.** \[ux]\[worker] A computer whose worker runs but that this browser did not set up (installed from another browser,
  the browser's storage cleared, or installed by hand as here) is never paired: the panel looks at `127.0.0.1:8765` only
  in a browser marked by **Use this computer** (`LOCAL_KEY`, so admins who never use a computer get no local-network
  prompt), and says nothing about it. The owner had to click **Use this computer** again, which also downloads the
  starter file again. FIXED (§88f): **Already set up? Look for it** under the file's link sets the mark with no
  download and says it is looking until the worker answers (S-A62-HAPPY-FIND-COMPUTER, S-A62-BAD-FIND-COMPUTER, tour
  `worker.local-looking`).
- **76.** \[bug]\[imagery] The 1972 KH-9 import ran on the owner's computer (fetch 29 min for 8.8 GB, extract 1 min, stitch
  9 s with no memory trouble) and failed in `locate`: `apiError.imagery.cityNotFound`, "the best guess correlates 0.09,
  under 0.20" (the cloud run of 2026-11-01 had 0.03). The frame's `frame.json` placed segment `d` 17,246 px inside `c`
  (46 % of a segment) and 2,500 px higher, where every other pair overlaps 1,400 to 3,100 px (4 to 8 %); the preview
  shows the seam broken. Root cause: the coarse match looked for the right segment's 8 px wide strip (the frame shrunk 48
  times) across the whole left segment, and on a snow-covered frame of repeating valleys a place deep inside matched
  better. FIXED (§88e): the coarse search looks only in the left segment's last 35 % (S-P01-BAD-STITCH-DECOY). Also seen:
  the frame of 2 February 1972 is under snow, which the summer Sentinel-2 and OpenStreetMap reference matches poorly, so
  the crop may stay below 0.20 with the seam fixed; a frame of the warm season is the better first import. Live: one more
  **Update the map** rebuilds the pipeline; **Try again** reuses the delivery kept on the computer.
- **77.** \[bug]\[worker] Under the starter file's service the outdated worker logged "copy the command from the admin and
  run it to update", and each restart (an update, a reboot) took a new worker id (`w-5e82…`, `w-02bb…`, `w-2612…` in one
  day), leaving one more worker document. FIXED (§88g): the words say the service updates by itself and only a worker
  started by hand needs the command; the id is kept in the work folder and forgotten with the session, so a disconnected
  computer starts as a new worker (S-P04-HAPPY-WORKER-ID-KEPT, S-P04-BAD-WORKER-ID-FORGOTTEN).
- **78.** \[bug]\[imagery] **Run it again** on the 1972 job after the update re-ran only `locate`: `stitch` stayed Done, so
  the new pipeline read the frame the old one had joined wrong, and finding 76's fix could not apply. FIXED (§88e): a
  pipeline retry keeps only what is costly or gone (the city crop, an upload's inspection, the unpacked segments, the
  delivery) and runs every later step again; a publish retry still keeps the render (S-A12-HAPPY-RETRY-REDOES,
  S-A12-BAD-RETRY-KEEPS-CROP). Also seen, **not reproduced**: the owner's earlier click on **Try again** left the job Failed
  with no claim for 30 minutes. It came minutes after **Update the map** started and the owner's tab is not one Claude could
  read, so the cause is **UNVERIFIED**; the Jobs page's button worked at once.
- **79.** \[ux]\[worker] The panel said "Docker is not installed? Get Docker" beside "This computer is connected". FIXED
  (§88f): the hint shows only while this computer has no worker that answers (S-A62-HAPPY-FIND-COMPUTER).
- **80.** \[bug]\[jobs] After the retry the Jobs page listed "Finding the city" before "Downloading the scene": it showed the
  stored map's order. FIXED (§88e): the steps read in the order their type runs them (S-A18-HAPPY-STEP-ORDER).
- **81.** \[ux]\[jobs] The owner, 2026-11-05: "fix padding in jobs tab". The worker's panel sat flush against the list pane's
  edge, 16 px left of the filter chips above it and with no space on the right. FIXED (§88i): the Jobs page gives the panel
  the pane's padding; the Setup card, which has its own, is unchanged (S-A62-HAPPY-PANEL-ALIGNED).
- **82.** \[bug]\[admin] **Disconnect this computer** showed an empty gap for its icon, seen in the state screenshots of 81:
  `link_off` is not in the bundled icon font, which draws nothing for an unlisted name; so were `save` (a city's budget)
  and `task_alt` (an order delivered). FIXED (§88i): bundled icons instead (the font, which the viewer loads too, is not
  rebuilt), and a test reads the admin's sources for any icon that is not bundled.

### Why the 1972 frame never found Bucharest (2026-11-05, offline, on the delivery kept on the owner's computer)

The owner away ("u do all steps"), **Update the map** refused to Claude, the real segments in the worker's volume were read
without any cloud change: `reports/stitch-1972/` (git-ignored). `DECISIONS-for-review.md` §88j, `docs/LESSONS.md` 360.

- **83.** \[bug]\[imagery] Finding 76's bound was not enough: `c`→`d` then overlapped a plausible 7.6 % but 2,774 px too high, and
  the seam still broke the river. Root cause: at 512 rows the frame was shrunk 48 times, too blurred for snow-covered valleys.
  At 12 times every strip from 96 to 1,440 px wide agrees on 1,518 px and 24 px, like its neighbours. FIXED: `COARSE_ROWS` 2048,
  and the search reaches at most 3 % of the height up or down (real offsets on this frame: at most 124 px of 25,047)
  (S-P01-BAD-STITCH-VERTICAL). Seen, open: `l`→`m`, over featureless cloud, overlaps only 173 px, likely wrong by about 1,600
  px; it lies past the city and moves only the frame's far end.
- **84.** \[bug]\[imagery] **The root cause of `cityNotFound` on this frame.** The delivery holds 14 segments (`_a` to `_n`) and
  `extract` kept 8: `MAX_SEGMENTS = 8` dropped the rest without a word. The frame was 57 % of its true width (284,762 of
  498,189 px) and ended at the edge of Bucharest, while the scene's corners describe the whole film. FIXED: the limit is 26 and
  passing it fails the job (S-P01-HAPPY-ALL-SEGMENTS, S-P01-BAD-TOO-MANY-SEGMENTS). Live: a new import (the job's attempts are
  used, and a retry keeps `extract`). **UNVERIFIED** until that run: the crop's correlation. By eye the whole frame shows
  Otopeni, Băneasa, Gara de Nord's rail lines and the Colentina lakes; matched by hand against Sentinel-2 this snow-covered
  frame scores only 0.15 to 0.25, so the 0.20 threshold may still refuse it; and its bottom edge seems to cut the city near
  its centre (by the two airports' distance, about 44.44° N), though the scene says it covers 100 %. The scene's corners
  were not read. The other candidate is **KH-9, 8 August 1972** (`D3C1203-300415F006`, free, no snow).
- **85.** \[bug]\[imagery] Dismissing the failed 1972 version left its scene **Imported** with no **Import**: a frame that failed
  could never be imported again. `imagery.reject` trusted that "the failure already released what it held", true for the
  server's endings (`endWork`) but not for a run that fails in the pipeline, which ends the job itself. FIXED (§88k): a
  dismissal frees a scene whose reserved layer was never made and whose versions are all rejected or cancelled, and the tick
  frees those an earlier release left (the 1972 scene, within 15 minutes of the update) (S-A12-HAPPY-DISMISS-IMPORT-AGAIN,
  S-A12-BAD-DISMISS-SCENE-HELD).

### The panoramic frame, rehearsed before spending a live run (2026-11-06, offline, on the real 1972 delivery)

The scene's real corners were read from the admin; the rehearsal fitted 17 landmarks by hand (`reports/stitch-1972/r/`, git-ignored). Changes: `DECISIONS-for-review.md` §90, `docs/LESSONS.md` 361, 362, `docs/research/M3-interfaces.md`.

- **86.** \[bug]\[imagery] Finding 84's whole frame still failed: 0.06 against 0.20. A homography through a panoramic frame's corners has the wrong scale by 1.5 to 2 times at the city, even the true placement scores only 0.126 on a snow-covered frame 50 years old, and the search correlated against the frame's blank area, walking 27 km away from the truth. FIXED: a panoramic model with the frame's image end (with a half angle of 60.5 degrees it fits the landmarks to 0.24 km after one constant shift of about 7 km), a masked gradient search accepted by its peak's contrast, and an averaged preview. On the real frame: accepted, ratio 2.10, z 8.7, 282 m RMS at the landmarks. The ratio's margin is thin and calibrated on one frame (**UNVERIFIED** on others); 61 degrees measured better, and was not applied from one frame.
- **87.** \[ux]\[imagery] A weak guess no longer fails the job: the crop holds every orientation that reaches the window, the delivery is kept, and georef ends at the existing points state; `cityNotFound` only when the frame does not reach the window.
- **88.** \[bug]\[imagery] The scene card said 100 % of a frame that holds about half the city: a panoramic frame is a bow tie, narrowest in the middle. FIXED: coverage goes through the camera's outline (52.95 % for this scene and the test bounds; measured about 51 %), and ranking follows at the next harvest. **Open:** this frame misses Piața Unirii by 0.86 km, and a layer holds one frame: another frame is needed for the centre.
- **89.** \[bug]\[worker] Data safety: a full disk during extract deleted the 8.7 GB delivery as "corrupt"; a resume after locate crashed with `work/` gone; the computer kept 13 GB per failed import for ever; a revoked worker id refused every new pairing; retry revived a dismissed version. All FIXED, each with its row.
- **90.** \[bug]\[admin] Pages acted on the loaded page as if it were everything: Export all, re-import (duplicates), Mark all as read, the photo picker. FIXED. Also from their tests: the picker's checkboxes were 13 by 13 px with a border of 1:1 contrast, and Try again never healed a repaired document (lesson 362).
