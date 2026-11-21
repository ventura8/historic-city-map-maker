# M4 interfaces: automation, the contract the five workstreams build on

Written on 2026-10-24 by the M4 contracts agent, alone in the tree before the five M4 workstreams (orders, autogcp,
compare, assists-notify, tooling) start in parallel. Read it together with `PLAN.md` (*M4, automation*; *Cloud
Functions* → `usgs.*` and `assist.*`; *Raster pipeline* → step 3 `georef`; *Engine* → lazy swipe compare; Addendum 3 →
*Swipe-compare also respects each overlay's opacity*), `M3-interfaces.md` and `M3-status.md` (what M3 built: the
harvest, the import job model, the pipeline's steps, the georeferencer, publishing; M4 builds on them and duplicates
none), `M2-interfaces.md` (the Firestore model, `CLIENT_WRITES`, the callable plumbing, the ports), `M2b-interfaces.md`
(the Setup Assistant, the provisioner), `M2c-interfaces.md` (the list and detail layout, the editors, the tour),
`../ENGINE_API.md`, `design-review-security-cost.md` (§0.9 Gemini server-side, §1.1 IAM, §1.7 untrusted strings, §3.4
the budget guard, *Nominatim policy*, *OSM*), `design-review-onboarding.md` (§0.4 `tram-order-*`, §0.6 the EarthExplorer
deep link, C6), and the `setup-assistant`, `raster-pipeline`, `e2e-scenarios` and `firebase` skills.

Everything marked **done** exists and is tested (100 % lines and branches per file); everything else is a contract the
owning workstream implements exactly as written. A change to anything here goes through
[Change requests](#change-requests), never by editing another workstream's files. Nothing in M4 calls a real Google,
Mapbox, USGS, STAC, Nominatim, Vertex AI or OpenStreetMap endpoint, creates a cloud resource, deploys or downloads a
package (the one download the user approved is `terra-draw` 1.38.0, tooling's): every test runs against the Firebase
emulators (project `demo-hcm`), the shared fakes of `@hcm/test-support`, the e2e mock servers and the pipeline's
loopback fakes. Facts that could not be checked without a real account are marked **UNVERIFIED**, each with how the
first real run proves it (§10).

## 0. What this contract decides

1. **Buying a scan is two clicks and the purchase** (§1): the scene's card links to its EarthExplorer page (verified
   pattern), the admin buys the scan there ($30 a frame plus $5 an order, a human step: Claude never pays), comes back
   and clicks **I ordered it** (`usgs.markOrdered`, which refuses a scene USGS already offers). Everything after is
   automatic: a daily watch (a step of `imagery.tick`, no new schedule), reminders on days 7 and 12 (USGS deletes an
   unpaid order after two weeks), the import into the M3 job pipeline the moment USGS lists the download, the
   automatic georeferencing and the publish under the city's RMSE threshold, and an `expired` state for an order never
   delivered. The order is a record on the scene (`usgsScenes/{entityId}.order`), written by the functions only.
2. **Automatic GCP suggestions** (§2): the pipeline's `georef` step adds an ORB fallback, OpenStreetMap's lines as a
   second matching channel (a distance field, tile by tile), a confidence and a residual per pair, and held-out
   checkpoints. A pair at or above `AUTO_GCP_MIN_CONFIDENCE` (0.6) joins the fit as in M3; one below it is only a
   **suggestion** (`layerVersion.suggestions`) the georeferencer shows with Accept, Reject and Accept all, and that is
   never saved without the admin's Save.
3. **Swipe compare is our own** (§3, the user's decision of 2026-10-23): no `mapbox-gl-compare`. A lazy chunk of the
   engine (`compare-<hash>.js`, its own budget) creates the second map only when the visitor compares and destroys it
   on exit, on a compact window and on `destroy()`; both maps follow one camera through a new MapPort `move` event; the
   divider is a keyboard and screen-reader slider that clips the second map; each side keeps its overlays' opacity; a
   compact window gets a toggle on the one map; the hash carries `cmp=` and `sw=`.
4. **Assists** (§4): `assist.suggestTitle` (Nominatim reverse geocoding through a Cloud Tasks queue at one request a
   second for the whole project, cached per 11 m cell, attributed; a refusal cools everything down for ten minutes and
   the admin types) and `assist.translateDraft` (Vertex AI Gemini server-side, the paid tier the EEA requires, the model
   id and the prompt pinned, plain-text output sanitized and length-limited, a monthly cap, App Check, paused by the
   budget guard; a draft is never published without the admin's Save). Provision enables `aiplatform.googleapis.com`
   and grants `fn-admin@` `roles/aiplatform.user`; the setup self-test gains an `ai` check that costs nothing.
5. **Notifications** (§5): producers write one event document per occurrence (an id built from what happened, so a
   redelivery writes nothing); `notify.onEvent` fans it out to every admin's **inbox** (Firestore documents per admin,
   read state, the shell's badge) and, for the kinds each admin chose, to the browsers they allowed (**FCM web push**,
   free, no new account, only after the browser's own permission prompt). No e-mail provider: an e-mail path through the
   existing Cloud Monitoring channel is a proposal (`DECISIONS-for-review.md` §52f).
6. **The user's four decisions of 2026-10-23** (`DECISIONS-for-review.md` §52a–§52d): our own compare (the plugin
   loader and its SRI plan removed, done here); Vertex AI Gemini for the drafts (§4.3); `terra-draw` 1.37.0 → 1.38.0 with
   its `HELD` entry removed in the same change (tooling); a third-party notices file generated at build for the admin and
   the engine, with a gate that checks it is complete (tooling, §6.4).
7. **Ownership** (§6): five workstreams, the shared files' marked sections, the order of work, and the one-at-a-time
   rule for split stages on the NUC.

Done by this contract (CR-M4-1): the shared schemas, constants and pure helpers (`packages/shared/src/schemas/
{usgs-order,autogcp,assist,notifications}.ts`, the scene's `order` and `eeDatasetId`, the version's `suggestions`, the
M4 paths), the API schemas (`packages/shared/src/api/{orders,assist,notify}.ts`) and seven error codes in both
languages, the URL hash's `cmp=` and `sw=` (`packages/shared/src/url/hash.ts`), the function owners `fn-orders` and
`fn-assist-notify`, the system writers `assist` and `notify`, the three M4 ports (`functions/src/ports/{geocoder,
translator,push-sender}.ts`, left out of `Deps` until wired) and the `assist-geocode` queue's payload, the golden
`pipeline/tests/contracts/autogcp.json` and `version.needs-gcps.suggestions.json` with their TypeScript check, the
catalogue skeletons (`packages/shared/src/i18n/admin-notify/`, the `orders` section of `admin-imagery`, its own folder `admin-orders/` since DECISIONS-for-review.md §110), the M4
input budgets (`packages/admin/src/content/budgets.ts`), the tour inventory's M4 sections, the scenario rows (§7), the
removal of the compare plugin loader, `docs/ENGINE_API.md`'s compare section, and the decisions log.

## 1. Orders: buying a scan (orders)

### 1.1 The flow

```text
Imagery → a scene that must be ordered (chip "Must be ordered", Free only off)
   └─ its order card: 35 USD = 30 a frame + 5 an order, paid to USGS; the guide; "Order in EarthExplorer" (new tab)
        └─ (the admin, on the scene's EarthExplorer page: Login → Order → On-Demand, 7 Micron → Submit Product Selections
            → USGS's form → pay.gov, 35 USD → an order confirmation number)
        └─ "I ordered it" (1 click) ─► usgs.markOrdered ─► order {state: ordered, nextCheckAt: +24 h}
             └─ imagery.tick, step "orders" (every 5 min; each order asked once a day, Check now any time)
                  ├─ USGS lists the download ─► delivered ─► the M3 import (job usgs-import + version, one transaction)
                  │     └─ importing ─► the version leaves processing ─► imported (published under the threshold, or
                  │        the approval card, or the georeferencer's suggestions)
                  ├─ day 7, day 12 without delivery ─► reminder (one notification each: "have you paid?")
                  └─ day 90 without delivery ─► expired ("Order again" = EarthExplorer + I ordered it)
```

### 1.2 The states

`acquisitionState(scene)` (done) gives every screen one of `SCENE_ACQUISITION_STATES`: `available` (already scanned:
Import is free), `needsOrder`, then the order's own state (`ORDER_STATES`). A scene imported for free in M3 is
`imported`; a stored legacy `status: 'ordered'` without an order (a client could write it in M3) is `needsOrder`.

| From → to | By | When |
| --- | --- | --- |
| `needsOrder` → `ordered` | `usgs.markOrdered` | the admin's click; refused for `available` (`apiError.usgs.alreadyAvailable`) |
| `expired` → `ordered` | `usgs.markOrdered` | "Order again": a new order record (`orderedAt` now, reminders reset) |
| `ordered` → `reminder` | the watch | `reminderDue(order, now)` is 7 (and again 12: the state stays `reminder`) |
| `ordered` / `reminder` / `expired` → `delivered` | the watch or `usgs.checkOrder` | `download-options` lists the scene `available` |
| `delivered` → `importing` | the watch or `usgs.checkOrder` | the import job and its version were created (`importJobId`) |
| `importing` → `imported` | the watch | the import's version left `processing` (any later state but `failed` and `cancelled`) |
| `ordered` / `reminder` → `expired` | the watch | `orderExpired(order, now)`: `ORDER_GIVE_UP_DAYS` (90) without delivery |
| `ordered` / `reminder` / `expired` → (no order: `needsOrder`) | `usgs.cancelOrder` | "Take the mark back" |

- A `delivered` order waits (no error) while `ops/guard` is red or today's raster jobs reached `JOBS_PER_DAY`; the next
  tick that can import does (`S-A13-BAD-GUARD-PAUSED`). An import that fails leaves the order `importing`: the job's own
  failure notification (`job.failed`) and Retry on the version page are the way out.
- An admin who imports a delivered scene by hand (the harvest found it downloadable first) moves its order the same way:
  `imagery.import` on a scene with an order sets `importing` and `importJobId` in its transaction (orders' M4 edit of
  `functions/src/imagery/import.ts`).

### 1.3 The record (done: `usgsOrderSchema`)

`cities/{city}/usgsScenes/{entityId}.order`: `state`, `orderedAt`, `orderedBy` (the admin who clicked; the import job's
`createdBy`), `checks`, `lastCheckedAt?`, `nextCheckAt`, `remindersSent` (days of `ORDER_REMINDER_DAYS` sent: a watch that
missed day 7 sends day 12's only), `deliveredAt?`, `importJobId?`, `importedAt?`, `expiredAt?`, `lastError?` (the last
failed check as an error code, which the card shows). The scene also gains `eeDatasetId?`, EarthExplorer's own id of
its dataset (§1.6). Written by the functions only, stamped `system:imagery` (the callables stamp the caller's uid).

### 1.4 The callables (registry rows: orders, owner `fn-orders`, `adminCallable`, App Check `enforce`)

| Callable | Request → response (done: `packages/shared/src/api/orders.ts`) | Errors |
| --- | --- | --- |
| `usgs.markOrdered` | `{cityId, entityId}` → `{state: 'ordered', nextCheckAt}` | `notFound`, `usgs.notConfigured`, `usgs.alreadyAvailable`, `usgs.orderState` |
| `usgs.checkOrder` | `{cityId, entityId}` → `{state, available, jobId?}` | `notFound`, `usgs.orderState`, `usgs.notConfigured`, `usgs.accessPending`, `usgs.credentials`, `usgs.maintenance`, `usgs.unavailable`, `rateLimited` |
| `usgs.cancelOrder` | `{cityId, entityId}` → `{state}` (a `SCENE_ACQUISITION_STATES` value) | `notFound`, `usgs.orderState` |

- `usgs.markOrdered`, in one transaction: the scene exists; `acquisitionState` is `needsOrder` or `expired` (else
  `orderState`); `downloadAvailable` false (else `alreadyAvailable`). Before the transaction, when USGS has granted the
  download role, one `download-options` call for the scene (one login, logout in a `finally`): `available` → the scene
  gets `downloadAvailable: true` and is ranked again (`rankScene`), and the answer is `alreadyAvailable`
  (`S-A13-BAD-MARK-AVAILABLE-REFUSED`); a USGS failure is not fatal (the mark is recorded, the watch asks later). Writes
  the order (`checks: 0`, `remindersSent: []`, `nextCheckAt` = now + `ORDER_CHECK_EVERY_HOURS`), and `eeDatasetId` when
  the `download-options` answer carried one.
- `usgs.checkOrder` ("Check now"): states `ordered`, `reminder`, `expired`; refused within `ORDER_CHECK_NOW_MIN_SECONDS`
  of `lastCheckedAt` (`apiError.rateLimited`, `S-A13-BAD-CHECK-NOW-TOO-OFTEN`); then exactly what the watch does for one
  order (§1.5), answering the new state, whether USGS lists the download, and the import's job id.
- `usgs.cancelOrder`: states `ordered`, `reminder`, `expired`; deletes the `order` field (the scene keeps everything
  else). The admin's snackbar after I ordered it offers Undo through it.

### 1.5 The watch: `imagery.tick`'s step `orders`

A step of the existing five-minute tick (`IMAGERY_TICK_SCHEDULE`), after *Harvest*, so no Cloud Scheduler job is added
(two of the three free ones are used: `ops.tick`, `imagery.tick`). It runs even while `ops/guard` is red (asking USGS
and reminding cost nothing); only the import waits for green. Per city:

1. **Due orders**: `usgsScenes where order.state in WATCHED_ORDER_STATES and order.nextCheckAt <= now` (the composite
   index of §1.8), at most 50 per run. With `setup/status.usgs` not `ok` with the download role, skip to step 3.
2. **Ask USGS**: one `UsgsApi.login` per tick run (logout in a `finally`), `UsgsScenes.downloadOptions` batched per
   dataset (at most 50 entity ids per call); per order `checks + 1`, `lastCheckedAt` now. `available` → `delivered`
   (`deliveredAt`, `eeDatasetId` from the answer when missing) and the event `order.delivered`; not available →
   `nextCheckAt` + `ORDER_CHECK_EVERY_HOURS`, `lastError` cleared; maintenance, rate limit, 5xx →
   `nextCheckAt` + `ORDER_RETRY_HOURS`, `lastError` the code (`S-A13-BAD-USGS-DOWN`); a refused token → `lastError`
   `apiError.usgs.credentials` and `setup/status.usgs` marked as M3's search does.
3. **Reminders and expiry** (no USGS call): `reminderDue(order, now)` → `reminder`, the day added to `remindersSent`,
   the event `order.reminder` (`notificationEventId('order.reminder', city, entityId, String(day))`); `orderExpired` →
   `expired` with `expiredAt` and the event `order.expired` (`S-A13-BAD-EXPIRED`).
4. **Import what was delivered**: `order.state == 'delivered'` → when the guard is green and today's cap allows, the
   M3 import's transaction (`createWork` of `functions/src/imagery/versions.ts` through `import.ts`: job `usgs-import`
   with `{entityId, dataset, sensor}`, its version, the scene `status: 'imported'` and its reserved `layerId`), `createdBy`
   = `order.orderedBy`, and in the same transaction the order `importing` with `importJobId`. The dispatcher, the
   pipeline, the policy and the publisher then run exactly as for a free import (M3 §4–§7).
5. **Finish**: `order.state == 'importing'` → read the version `importJobId`; out of `processing` and not
   `failed`/`cancelled` → `imported` with `importedAt` and the event `order.imported`.

Every write re-reads its scene in a transaction and acts only when the state is still the one it read (a Check now and a
tick at once never import twice: the version's id is the job's, created with `create`). Each event is created once
(§5.2). Order of work: the M3 imports' cap and guard checks are reused unchanged.

### 1.6 The EarthExplorer deep link, and how it was verified

- **Pattern**: `https://earthexplorer.usgs.gov/scene/metadata/full/{datasetId}/{entityId}/` (`earthExplorerSceneUrl`,
  done), where `datasetId` is EarthExplorer's own id of the dataset, not the M2M alias. Verified on 2026-10-11 by a live
  request without credentials (`design-review-onboarding.md` §0.6: HTTP 200, title "Full Display of DS009013039DV181"),
  with `corona2`'s id `5e839febdccb64b3` read from M2M `dataset-search` (`EARTH_EXPLORER_DATASET_IDS`, done).
- **The other two datasets**: their ids are read at run time and stored on each scene (`eeDatasetId`): the harvest
  calls `dataset-search {"datasetName": "declass"}` once per run (orders' M4 edit of `functions/src/imagery/search.ts`,
  through a new `UsgsScenes.datasets(apiKey)` port method, its adapter and its fake: orders), and `download-options`
  answers carry `datasetId` too (`packages/test-support/src/api-fixtures/usgs/download-options.*.json`). A scene without
  a known id shows its entity id with Copy and a link to EarthExplorer's search page instead of the deep link (no broken
  link). **UNVERIFIED**: the declassii and declassiii ids (the fixture's `5e839ff7d71d4811` is a recorded shape, not a
  checked value) until the first real harvest.
- **Kept honest weekly**: orders adds `usgs.earthExplorerScene` to `packages/admin/src/setup/links.json` with the
  verified sample (`{datasetId: '5e839febdccb64b3', entityId: 'DS009013039DV181'}`) and a body check to
  `scripts/ci/check_contracts.py` (`PIPELINE_STAGE=contract`, `contract.yml`: 2xx and the page names the entity id), a
  stricter probe of the pre-approved kind. The admin's link is built from the same template.
- **Buy flow guide** (texts of the order card; verified by the owner's first order, D3C1216-100235F038, 2026-11-08): on
  the scene's page (`/scene/metadata/full/{datasetId}/{entityId}/`, which has no search results and no basket icon) sign
  in (Login, top right), then **Order** at the page's bottom; the order page
  (`/order/index/?list=order-process-ee-<n>&orderType=order`, a Scene List with the order type On-Demand Order, the scene
  under its dataset, e.g. Declass 3, with the product `DECLASS 3 IMAGERY ON-DEMAND ($30)` and a Micron Option of 7 or
  14 Micron): keep On-Demand, choose **7 Micron**, then **Submit Product Selections**; USGS's form, then payment by card
  on pay.gov, 35 USD (30 + 5), which ends with an EarthExplorer order confirmation number (`P…`). The Item Basket path
  (basket icon in search results → Item Basket → On-Demand → Start Order) is the search page's, not the scene page's; unpaid requests are deleted after two weeks;
  turnaround three to four weeks after payment; support `custserv@usgs.gov`, 1-800-252-4547. Claude never pays, never
  types card data, and opens EarthExplorer for the user only with their consent (`AGENTS.md`).
- **Not built** (UNVERIFIED, `design-review-onboarding.md` §0.4): detecting the order or its payment through M2M
  `tram-order-search` / `tram-order-status`, which would remove the I ordered it click; a later proposal once the first
  real order shows what they answer.

### 1.7 The admin screens (orders; the Imagery area's chunk)

- **The scene list**: the chip of `acquisitionState` (`adminContent.orders.state.*`, done) on every card; "Needs you"
  counts orders in `reminder` and `expired` beside M3's versions; the filter Free only (M3, on by default) hides the
  scenes that must be ordered, as today.
- **The order card** on a `needsOrder` scene (`#/imagery/scene/<entityId>`): the estimate (`orderEstimateUsd(1)`,
  `adminContent.orders.estimate`), the guide (§1.6), **Order in EarthExplorer** (an `a` with `target="_blank"` and
  `rel="noopener noreferrer"`, 48 px), **I ordered it**; once ordered: the state chip, the next check, `lastError` in
  words, **Check now**, **Take the mark back**; `expired`: **Order again** (the same two inputs). An `available` scene
  shows M3's Import and no order card (`S-A13-BAD-ALREADY-AVAILABLE`).
- **From a whole-city date** (M8, 2026-11-12): every paid frame of a row of Find's **Whole-city dates** has its own
  **Buy this scan: {frame}**, a link to that frame's page and so to this card; a frame with an open order reads **Your
  order: {frame}** with the order's chip, an expired order **Order it again: {frame}** (`packages/ui/src/admin/imagery/orders/order-list.ts`, `paidFrameList`, in the Imagery chunk: the join chunk has no room).
- **The input budget** (`CONTENT_INPUT_BUDGETS`, done): `buyScan` 2 (Order in EarthExplorer, I ordered it; the purchase
  in EarthExplorer is the admin's own step), `checkOrderNow` 1 (never needed: the watch asks daily).
- **States** for the tour (§7.3): `orders.order-card`, `orders.ordered`, `orders.reminder`, `orders.delivered`,
  `orders.expired`.

### 1.9 Not useful, and a scan probably cloudy over the city (the owner's report of 2026-11-13)

"This scan is useless (too many clouds!!!)": DS09066A047MC019 (1964), which the whole-city plan kept offering as **Buy this scan**.

- **The scene's page** is the route `#/imagery/scene/<entityId>` (M3 §10.2; the list's cards and every Buy this scan link to it):
  its preview, date, coverage, free or paid, score, reasons and actions. Under them **Not useful?**: four buttons, Clouds, Haze or
  blur, Wrong area, Other, one click each (`packages/ui/src/admin/imagery/scene-unusable.ts`); once marked, what that did and
  **It is useful after all**; the snackbar's Undo does the same. An imported scene has none (its layer is what to reject or delete).
- **`imagery.markScene`** (`cityEditor`, `functions/src/imagery/mark-scene.ts`) `{cityId, entityId, unusable}`: a reason stores
  `status: 'rejected'` and `unusable {reason, at}`; `null` stores `candidate` and removes `unusable`; in a transaction, then the
  plan is written again at once (`rewriteDatePlan`: rejected scenes take no part), so the date's row says what else completes it
  and lists no Buy this scan for it. Refusals: `apiError.imagery.alreadyImported`, `apiError.notFound`, `apiError.city.notEditor`.
  The admin runs it through `OrderActions.markUnusable` (one action at a time with the order card's; its refusal, `action:
  'unusable'`, shows in its own section only).
- **The list**: Find's filter **Hide not useful** (`hideRejected`, on by default; it read Hide deleted) hides it; off, its card
  carries **Not useful**.
- **The cloud estimate** (M3 §3.4): a card reads **Probably cloudy over the city: N %** at `CLOUDY_CITY_PERCENT` (40) or more, its
  page warns what is wrong and what to do before Import or the order card, and the plan's row lists it in `cloudyFrames`, so its
  **Buy this scan** carries the same warning. Its rank keeps only its clear share (M3 §3.3, `RANKING_VERSION` 5).
- Rules: `unusable` and `cloudEstimate` are server-owned (`S-A152-BAD-CLIENT-MARK`). Behaviour A152; DECISIONS §201.

### 1.8 Rules and indexes (orders)

- `usgsScenes`: the client triage keeps `status` (`candidate`, `rejected`) and `note`; `ordered` and `available` leave
  the rules' allowed list (`firebase/firestore.rules`, the `TRIAGE` list of `firebase/rules-tests/test/jobs.test.ts`);
  `order` and `eeDatasetId` are server-owned like every field outside `CLIENT_WRITES` (`S-A13-BAD-CLIENT-ORDERED-STATUS`).
  The complete fixture of the rules tests already carries both fields (done).
- Index: `usgsScenes` by `order.state` then `order.nextCheckAt` (`firebase/firestore.indexes.json`, the indexes test).

## 2. Automatic GCP suggestions (autogcp)

### 2.1 The step contract (`pipeline/src/hcm_pipeline/georef/matcher.py`, `steps/georef.py`)

M3 built CLAHE, SIFT per cell of an 8 × 8 grid coarse to fine, a normalized cross-correlation fallback and RANSAC
against Sentinel-2 (M3 §5.6, §5.9). M4 extends the same step; inputs and outputs are the version's files and document.

1. **Pre-warp**: the scan through the corner guess (`locate`'s transform; for a `regeoref` or a scan that already holds
   the admin's points, the current fit) onto the reference grid at 10 m, so scale and rotation are mostly gone.
2. **Channels** (`MATCH_CHANNELS`): `s2` (Sentinel-2 true colour, grey, CLAHE clip 2.0 on 8 × 8 tiles, as M3) and `osm`
   (the cached OpenStreetMap lines rasterized at 10 m, then `cv2.distanceTransform` normalized to 0–255: a distance
   field that a scan's edges, after Canny on the CLAHE'd scan, correlate with). A window without a usable Sentinel-2 item
   (clouds over 20 %, none in three years) runs on `osm` alone; without OpenStreetMap lines, on `s2` alone.
3. **Features** (`AUTO_GCP_METHODS`): SIFT (`cv2.SIFT.create(nfeatures=4000)`) per cell with Lowe's ratio 0.75, as M3;
   **ORB** (`cv2.ORB.create(nfeatures=5000)`, Hamming, ratio 0.8) when SIFT finds fewer than 200 keypoints on the
   pre-warped scan (a smooth or low-contrast frame) or `cv2.SIFT` is not in the build; `suggestions.method` records which.
4. **Tile matching** (the `osm` channel, and the `s2` fallback where a cell has too few features): tiles of
   `AUTO_GCP_TILE_PX` (256 px at 10 m, 2.56 km) on the same grid, each found in the reference within ± 400 m at the
   coarsest level (halved per level) by normalized cross-correlation; a tile's pair is its centre.
5. **Consensus**: RANSAC (`cv2.estimateAffine2D`, 3 px, confidence 0.999, 5,000 iterations, `cv2.setRNGSeed` from the job
   id) per level over both channels' candidates; at most two pairs per cell, so the pairs spread.
6. **Back to the scan**: every inlier through the pre-warp's inverse to full-resolution scan pixels (GCP `origin: 'auto'`).

### 2.2 Confidence and residual per pair

- `score` (the confidence, 0 to 1) = 0.5 × the match's margin + 0.3 × its inlier support + 0.2 × the agreement of the
  channels, each part 0 to 1: the margin is `1 − d1/d2` of Lowe's two nearest distances for a feature pair, or the NCC
  peak minus the second peak outside the peak's 3 × 3 neighbourhood for a tile; the support is the share of RANSAC
  inliers within 1.5 px of the pair's own residual among its cell's candidates; the agreement is 1 when both channels
  produced a pair within 20 m of each other, 0.5 with one channel, 0 when they disagree.
- `residualM` (ground metres, M3 §6.1): leave-one-out for an enabled pair of the fit, the plain residual for a held-out
  checkpoint, and for a suggestion how far the fit of the confident pairs puts its pixel from its place (absent without
  a fit).

### 2.3 What the step writes

| Outcome | `georef` | `suggestions` | Version, job |
| --- | --- | --- | --- |
| at least `MIN_GCPS.poly2` (6) enabled confident pairs (`score ≥ AUTO_GCP_MIN_CONFIDENCE`) | the confident pairs (a share held out, §2.4), the transform (M3: `poly2` from 12 spread pairs, else `affine`), both errors | the candidates with `AUTO_GCP_SUGGEST_MIN ≤ score < AUTO_GCP_MIN_CONFIDENCE`, best first, at most `MAX_SUGGESTIONS`, with `residualM` | on to `warp` as in M3 |
| fewer | absent | every candidate with `score ≥ AUTO_GCP_SUGGEST_MIN`, confident ones included, best first, at most `MAX_SUGGESTIONS` | `needs_gcps` with `apiError.imagery.noMatch {pairs}` (the confident count), the job `awaiting_gcps` (M3) |
| no candidate | absent | `{…, pairs: []}` with `tiles.matched` 0 | the same wait, `{pairs: '0'}` |

- `suggestions` (done: `gcpSuggestionsSchema`): `method`, `channels`, `generatedAt`, `minConfidence`, `tiles {matched,
  total}`, `pairs` (GCPs, `origin: 'auto'`, `enabled: true`, `score`, `residualM?`). Its golden document is
  `pipeline/tests/contracts/version.needs-gcps.suggestions.json` and its constants `autogcp.json` (done; the TypeScript
  side checks both, the Python side's test is autogcp's).
- A version holding the admin's points (`imagery.saveGcps`) is fitted as in M3; the matcher does not run again, so the
  admin's Save is exactly what is warped. A `regeoref` of a USGS scan without points (none in M4) would run it.

### 2.4 Checkpoint RMSE and the approval policy

- With at least `CHECKPOINT_MIN_PAIRS` (15) confident pairs, `AUTO_GCP_CHECKPOINT_SHARE` (a fifth, at least 3) of them,
  spread over the grid (every fifth by cell order), are kept `enabled: false`: true checkpoints, left out of the fit,
  whose RMSE is `checkpointRmseM` with `checkpointCount` their number. With fewer, leave-one-out over the enabled pairs as
  in M3.
- The approval policy is unchanged (M3 §7.1): auto-publish needs `checkpointRmseM ≤ rmseThresholdM` with
  `checkpointCount ≥ 3`. Suggestions never count: they are not in `georef` until the admin accepts and saves them.

### 2.5 The georeferencer (autogcp; the `georef` chunk)

- A **Suggestions** panel beside the residual table when `version.suggestions.pairs` is not empty: each suggestion as a
  row (its confidence in words and as a bar, its residual) and as dashed markers on both panes, numbered `a…`;
  **Accept** and **Reject** per row (buttons named after the pair), **Accept all**; accepting moves the pair into the
  table (`acceptSuggestions`, done: enabled, `origin: 'auto'`, a free id, the same scan pixel never twice, at most
  `MAX_GCPS`), rejecting hides it for the page (`pendingSuggestions`, done). The fit, both errors, the transforms each
  count allows and the warped preview update live, as for the admin's own pairs.
- **The city guard** (`docs/LESSONS.md` 729): when the suggestions' places, taken together, would put the map outside the city
  (`landsInCity` of `@hcm/shared`: the centre within the city's bounds grown by a quarter, at least half the smaller of the two
  boxes shared), every row reads *doubtful* with no percentage, the panel says the map would land outside the city, and there is
  no Accept all (a single Accept still works). The approval card of a version whose footprint lies mostly outside the city says so
  and Approve asks first (`approveOutside`).
- **Never saved without Save**: accepted suggestions are part of the page's unsaved pairs (M2c's unsaved guard);
  `imagery.saveGcps` is called only by Save, with exactly the table's pairs; nothing the admin did not accept reaches
  the version (`S-A44-BAD-REJECTED-NEVER-SAVED`).
- Keyboard: the list is reachable by Tab, Enter on a row accepts, Delete rejects; the markers follow the selection as
  M3's pairs do (`S-A44-HAPPY-KEYBOARD`).
- **Input budget** (done): `acceptSuggestions` 2 (Accept all, Save).
- **States** (§7.3): `georef.suggestions`, `georef.suggestions-accepted`, `georef.no-suggestions`.

### 2.6 Tests (autogcp)

pytest on the synthetic world (`pipeline/tests/synthetic/`): the M3 frames with a known transform, plus a smoothed scan
(forces ORB), a cloud-masked Sentinel-2 window (forces `osm`), a uniform scan (no candidate); determinism
(`GDAL_NUM_THREADS=1`, `cv2.setNumThreads(1)`, the seeded RNG); the serialization equals the golden documents; 90 % per
file. The e2e stand-in runner (`e2e/admin/support/imagery-standin.ts`) learns an outcome `suggestions` that writes the
golden shape for the georeferencer's specs.

## 3. Swipe compare (compare)

### 3.1 The engine API (done in `docs/ENGINE_API.md` → *Compare*)

- `HistoricCityMapController.openCompare(layerId: string | null, options?: { position?: number }): void`: compare the
  current map (the main side) with `layerId` (`null`: today, no historical layer); an unknown or non-raster id is
  ignored. `setComparePosition(position: number): void` (0 to 1, clamped). `closeCompare(): void`.
- The event `hcm-compare-change` `{ open, mode: 'swipe' | 'toggle' | null, layerId, position }`, fired on open, close,
  mode change and divider release (not while dragging); `compare_open` is the telemetry event M1 reserved (after
  consent).
- The hash: `cmp=<layer id>` (empty for today) and `sw=<0..100>` (done in `packages/shared/src/url/hash.ts`:
  `CompareState`, `DEFAULT_COMPARE_POSITION`; `sw=` without `cmp=` is ignored; either may come first).

### 3.2 The lazy chunk and its budget

- `packages/engine/src/compare/` holds the compare session (second map, camera sync, clip, mode switch) and is reached
  only through `import('./compare/index.js')` from the store's compare action: the ES module build emits it as
  `compare-<hash>.js` beside `engine.mjs` (the site build already copies every file of the engine build); the IIFE build
  cannot split code and inlines it, within its existing budget (125 KB; 109.3 measured).
- `<hcm-compare>` (the divider and the compare bar, Lit, `hcm-` prefix, no decorators) lives in
  `packages/ui/src/viewer/compare/` and is exported only through a new subpath `@hcm/ui/viewer/compare` (compare adds it
  to `packages/ui/package.json`'s `exports`), never from `@hcm/ui`'s root, so it lands in the chunk and not in
  `engine.mjs`. The Layers panel's Compare button and the loader stay in the entry (under 1 KB; `engine.mjs` stays
  within its 100 KB, 96.0 measured).
- Budget: `scripts/ci/check_bundle_budget.py` gains `ENGINE_CHUNK_BUDGETS` with `compare` at the measurement plus about
  20 %, never above 12 KB gzip, and a chunk of the engine build without a budget fails as the admin's do (a stricter
  gate of the pre-approved kind, logged in `DECISIONS-for-review.md` by compare).

### 3.3 The second map's life

- Created on the first open in swipe mode (a window 600 px wide or more): `createMapboxPort(gl).mount(container, the
  main map's options with its current view)`, in a container stacked over the main map's; a second map load, counted by
  the e2e map-instance counter (`instrumentation.read(page).mapsCreated`).
- Destroyed (`MapPort.destroy`, the container removed, every listener gone) on Close, on Esc while the divider has
  focus, when the window becomes compact (§3.7), when the visitor shows another view that hides the map (the no-WebGL
  list, an error card), and by the controller's `destroy()`; reopening creates a new one. One map per view again:
  `mapsRemoved` grows by one (`S-V06-BAD-EXIT-DESTROYS-MAP`).
- A second map that fails to load (style, WebGL) closes compare with the existing `error.map.*` toast; the main map is
  untouched.

### 3.4 Camera sync

- MapPort gains `move` in `MapEventMap` (`move: MapView`, fired per animation frame while the camera moves; the Mapbox
  adapter maps Mapbox's `move`, coalesced with `requestAnimationFrame`; `FakeMap` emits it on `flyTo`): compare's change
  to `packages/ui/src/map/map-port.ts`, `mapbox-adapter.ts` and `packages/test-support/src/fake-map.ts`, additive (the
  admin ignores it).
- Each map's `move` sets the other's camera with `flyTo(view, { animate: false })` under a re-entrancy guard (a move
  caused by the sync is not synced back), so either side may be dragged, zoomed or rotated and both stay on the same
  centre, zoom and bearing after every frame (`S-V06-HAPPY-CAMERA-SYNC`).

### 3.5 The divider

- The second map's container is clipped with `clip-path: inset(0 0 0 <p × 100>%)` (p = `position`): left of the divider
  the main map, right of it the compared side. Pointer: a drag on the handle (pointer capture), a click on the bar
  jumps; the maps keep their own gestures elsewhere.
- Accessibility: the handle is `role="slider"`, `aria-valuemin` 0, `aria-valuemax` 100, `aria-valuenow` the percent of
  the main side, `aria-valuetext` naming both sides and their shares (viewer catalogue `compare.value`: "{left}: {a} %,
  {right}: {b} %"), labelled `compare.divider`; arrows ±1 %, Shift ±10 %, PageUp/PageDown ±10 %, Home/End 0 and 100;
  a 48 px target, a 3:1 focus ring; Esc closes. The divider is announced on release, not on every step
  (`S-V06-HAPPY-KEYBOARD`).
- The compare bar (top of the map, inside the safe area): the main side's name, a menu choosing the compared side (today
  or another historical layer), Close.

### 3.6 What each side shows, and the legal line

- The main map is the viewer's map, unchanged. The second map shows the same basemap, the same vector overlays (photos,
  POI categories) with the same visibility and opacity, and of the historical layers only the compared one (none for
  today), with its overlay opacity and its image adjustments. A slider moved in the Layers panel while comparing applies
  to both maps at once (the store applies overlay paints to every live map; `S-V06-HAPPY-OPACITY`).
- Exactly one Mapbox logo and one attribution stay visible at every divider position (the layout checker's legal-line
  rule, `docs/LESSONS.md` 163): the main map's logo (left) and the second map's attribution (right), which credits both
  sides' layers (`customAttribution` with the main side's layer credits too). The tour checks positions 0, 50 and 100.
- Photos and POIs are clickable on both sides and open the same sheet.

### 3.7 Compact windows: the toggle

Below 600 px (`compact` window class) compare never creates a second map: the compare bar becomes a two-way toggle
(segmented buttons: the main side's name | the compared side's name) that swaps which historical layer the one map
shows; the hash's `sw` is 100 (main) or 0 (compared). Crossing 600 px while comparing switches the mode: wider creates
the second map (lazily, as on open), narrower destroys it (`S-V06-BAD-COMPACT-WIDTH`).

### 3.8 Deep-link state

The store writes `cmp=` and `sw=` with `history.replaceState` like every other state (on open, close, release); on load
(after `hcm-ready`) a hash with `cmp=` opens compare on that layer at `sw` (`S-V06-HAPPY-DEEP-LINK`); a `cmp=` naming no
layer of the manifest opens nothing and the hash is rewritten without `cmp` and `sw` (`S-V06-BAD-UNKNOWN-LAYER`).

### 3.9 Texts, icons, states

- Viewer catalogue keys (compare adds them to `packages/shared/src/i18n/{ro,en}.ts`, both languages): `compare.open`,
  `compare.close`, `compare.today`, `compare.choose`, `compare.divider`, `compare.value`, `compare.toggle`. Icon
  `compare` joins `UI_ICONS` and the font subset.
- States for the tour (§7.3), each at every viewer viewport: `viewer.compare-swipe` (50 %), `viewer.compare-swipe-edge`
  (divider at 0 and 100), `viewer.compare-menu`, `viewer.compare-toggle` (compact), `viewer.compare-keyboard` (focus on
  the divider); a journey `compare` in `e2e/tour/states.ts` visits them (the inventory refuses an unvisited state).

## 4. Assists (assists-notify)

### 4.1 Where the admin meets them

- **Title suggestions**: the photo editor (A09) and the place editor (POIs). When a place is set (a pin dropped or moved,
  a point drawn) and the Romanian title is empty, the editor asks `assist.suggestTitle` on its own and shows up to three
  suggestions as chips under the title with the attribution (`NOMINATIM_ATTRIBUTION`, a link to
  `https://osm.org/copyright`); with a title already there, **Suggest a title** asks. One click fills the Romanian title
  (and the English one when OpenStreetMap has `name:en`) in the editor's draft.
- **Translation drafts**: beside every Romanian/English field pair of the photo, place and layer editors (title, label,
  description, the photo's date text), **English draft** (when the Romanian side has text) or **Romanian draft**. The
  draft fills the other field in the editor's draft only, with the note `adminContent.assist.draftNote` naming the model;
  the admin edits it or not, and only Save writes (the M2c save, so the manifest changes only then). An entity's
  `published` is never touched by an assist (`S-A09-BAD-AI-UNAVAILABLE`: nothing auto-published).

### 4.2 `assist.suggestTitle` and the geocoding queue

| Piece | Contract (done: `packages/shared/src/schemas/assist.ts`, `api/assist.ts`) |
| --- | --- |
| `assist.suggestTitle` (admin, `enforce`, owner `fn-assist-notify`) | `{cityId, location}` → `{state, key, suggestions, attribution, error?}`; the location within the city's bounds plus 0.5° (else `apiError.invalidRequest`) |
| The cell | `geocodeCellKey(lat, lng)`: rounded to 4 decimals (about 11 m); `assistGeocodes/{key}` (`geocodeCellDocSchema`): `queued`, `ready` (suggestions, possibly none) or `failed` (`error`), `requestedAt`, `answeredAt?`, `expiresAt` |
| The answer | a `ready` cell not expired → at once; `queued` less than two minutes old → `queued`; `failed` not expired → `failed`; else: during the cool-down → `failed` with `apiError.assist.rateLimited` and nothing queued; otherwise the cell set `queued` and a task enqueued with the cell as its id (Cloud Tasks drops the second) → `queued`. The editor listens to the cell (`onSnapshot`, admins read it) until it is `ready` or `failed` |
| The queue | `ASSIST_GEOCODE_QUEUE` (`assist-geocode`), `onTaskDispatched({ rateLimits: GEOCODE_RATE_LIMITS, retryConfig: { maxAttempts: 2, minBackoffSeconds: 10 } })`: one request a second for the whole project, one at a time; payload `geocodeTaskSchema` `{key}` |
| `assist.geocode` (task, `fn-events@`) | `Geocoder.reverse` of `geocodeCellCenter(key)` (never the admin's more precise place) in Romanian, `GEOCODE_ZOOM` 18, with `NOMINATIM_USER_AGENT`; the suggestions: the object's `name` (and `name:en`), the road with the area, the area alone, unique, plain text of at most 200 characters (`titleSuggestionSchema`), at most `MAX_TITLE_SUGGESTIONS`; the cell `ready`, `expiresAt` + `GEOCODE_CACHE_DAYS` |
| A refusal | a 429 or 403 → the cell `failed` with `apiError.assist.rateLimited`, `ops/assist.nominatimCoolUntil` + `GEOCODE_COOLDOWN_MINUTES`, no retry; a 5xx or a timeout → one retry by the queue, then `failed` with `apiError.assist.unavailable` (expires after the cool-down) |

Nominatim's usage policy is met by construction: one request a second for the whole application, an identifying
User-Agent, every answer cached, no bulk or grid lookup (only a place an admin set), the licence shown. The address is
configuration (`HCM_NOMINATIM_URL`, default `NOMINATIM_REVERSE_URL`), so a mirror is a deploy-time change.

### 4.3 `assist.translateDraft` (Vertex AI Gemini)

| Piece | Contract |
| --- | --- |
| The callable (admin, App Check `enforce`, owner `fn-assist-notify`, `fn-admin@`) | `assistTranslateDraftRequestSchema` `{cityId, field, from, to, text}` (the field's limit, two different languages) → `{draft, truncated, model}` |
| The model | `VERTEX_MODEL_ID` (`gemini-2.5-flash-lite`, pinned; a new model is a reviewed change of the constant) in `VERTEX_LOCATION` (`us-central1`), Vertex AI's `generateContent` with the functions' service account: no key, no browser access (security review §0.9: the Firebase AI Logic client SDK stays off) |
| The prompt | `translationPrompt` (done; `TRANSLATION_PROMPT_VERSION` 1, its exact text pinned by `packages/shared/test/schemas/assist.test.ts`): a system instruction naming the field, the city and the languages and asking for plain text only, the admin's text as the only user turn, `temperature` 0.2, `maxOutputTokens` from the field's limit, `responseMimeType: 'text/plain'`, one candidate |
| The answer | `sanitizeDraft(text, field)` (done): NFC, control and invisible formatting characters out, a wrapping code fence or quotation marks removed, spaces collapsed (paragraphs kept for a description), cut to the field's limit at a word (`truncated`); nothing left, or `finishReason` `SAFETY` / `RECITATION` → `apiError.assist.noDraft`. Rendered as text only, never as HTML (Lit, `textContent`) |
| The cap | in one transaction on `usage/ai-{usageMonth(now)}` (`aiUsageDocSchema`): `overAiCap(usage, estimate)` → `apiError.assist.monthlyCap`; else `requests + 1` and the estimated cost (`estimateTokens`, `aiCostUsd`) reserved; after the call the counters take the tokens Vertex AI reports. `AI_MONTHLY_CAP`: 500 requests or 0.50 USD a month (expected use: under 0.05 USD, PLAN). Admins read the counters (the rules' `usage/{doc}`) |
| The guard | `ops/guard` red → `apiError.guardPaused` before anything else (`opsGuardDocSchema` already says red pauses AI assists) |
| Failures | Vertex AI 5xx, a timeout (20 s) → `apiError.assist.unavailable`; 429 → `apiError.rateLimited`; `SERVICE_DISABLED` → `apiError.cloud.apiDisabled {api}`; a missing role → `apiError.cloud.permission`; the field is left as it was in every case |

The port is `Translator` (`functions/src/ports/translator.ts`, done): `generate(model, prompt)` and `countTokens(model,
text)`; adapter `functions/src/adapters/vertex-ai.ts` (assists-notify), its fake for the functions tests and the e2e mock
APIs (`aiplatform.googleapis.com` routes in `packages/test-support/src/fakes/`), the firewall's server-only hosts gain
`*-aiplatform.googleapis.com` and `nominatim.openstreetmap.org`.

### 4.4 Provisioning, IAM and the setup self-test (assists-notify, through CR-M4-5 to the admin's provisioner and fn-setup)

- **APIs** (`REQUIRED_APIS`, `packages/admin/src/provision/`): `aiplatform.googleapis.com` (Vertex AI),
  `fcm.googleapis.com` (FCM HTTP v1 sends) and `fcmregistrations.googleapis.com` (the browser's token registration). The
  provisioner's `apis` item enables them with the owner's consent like every other API (Provision's one click).
- **IAM** (the provisioner's `iam` item): `fn-admin@` gains `roles/aiplatform.user` (project; the callable and the
  self-test) and `roles/firebasecloudmessaging.admin` (`notify.registerDevice`'s dry-run, `notify.sendTest`); `fn-events@`
  gains `roles/firebasecloudmessaging.admin` (the fan-out's pushes) and keeps `roles/cloudtasks.enqueuer` for the
  `assist-geocode` queue. **UNVERIFIED**: that `roles/firebasecloudmessaging.admin` is the narrowest role holding
  `cloudmessaging.messages.create`.
- **The queue**: `assist-geocode` is declared by its function (`onTaskDispatched`) and created at deploy; the `task-queues`
  doctor item lists it.
- **The setup self-test**: `SELF_TEST_CHECKS` gains `ai` (fn-setup's `functions/src/setup/self-test-checks.ts` and the
  shared list): `Translator.countTokens(VERTEX_MODEL_ID, 'test')`, free; `ok`, or `apiError.cloud.apiDisabled` /
  `apiError.cloud.permission` with the Provision step's link (`S-A45-HAPPY-SELF-TEST`, `S-A45-BAD-API-DISABLED`). Its
  label joins `admin-setup` in both languages.

### 4.5 Input budgets (done)

`suggestTitle` 1 (a suggestion; the suggestions come when the place is set), `translateDraft` 2 (the draft button, Save).

### 4.6 States (§7.3)

`assist.suggestions`, `assist.suggestions-refused`, `assist.draft`, `assist.draft-refused`, in the photo and place
editors at every admin tour viewport.

## 5. Notifications (assists-notify)

### 5.1 The events

| Kind (`NOTIFICATION_KINDS`) | Producer | Id parts (`notificationEventId`) | Params | Link | Severity, push by default |
| --- | --- | --- | --- | --- | --- |
| `usgs.approved` | `ops.tick` step `health` (`functions/src/ops/services.ts`), when `setup/status.usgs.role` turns `download` | `'download'` | none | `#/imagery` | info, yes |
| `order.delivered` | the order watch, `usgs.checkOrder` | city, entity id | `scene` (the scene's label) | `#/imagery/scene/<entityId>` | info, yes |
| `order.imported` | the order watch | city, entity id | `scene` | `#/imagery/version/<versionId>` | info, no |
| `order.reminder` | the order watch | city, entity id, day | `scene`, `days` | `#/imagery/scene/<entityId>` | warning, yes |
| `order.expired` | the order watch | city, entity id, `orderedAt` in ms | `scene`, `days` | `#/imagery/scene/<entityId>` | warning, yes |
| `job.failed` | `imagery.onJobWrite` (a transition to `failed`) | city, job id, attempt | `label` (the version's) | `#/imagery/version/<versionId>` (`#/jobs` without a version) | error, yes |
| `layer.readyToApprove` | `imagery.onJobWrite` (`awaiting_approval` not approved by the policy) | city, version id | `label` | `#/imagery/version/<versionId>` | info, yes |
| `layer.needsPoints` | `imagery.onJobWrite` (`awaiting_gcps`) | city, version id | `label` | `#/georef/<versionId>` | info, no |
| `budget.paused` | `ops.onBudget` (`ops/guard` green → red) | the budget period's first day (`spend.interval`'s date, `YYYY-MM-DD`) | `cost`, `budget`, `currency` | `#/imagery` | error, yes |
| `crash.spike` | `ops.tick` step `health`: at least `CRASH_SPIKE_THRESHOLD` (10) new reports since the last run within the hour, from `ErrorReporter.listGroups({hours: 24})`'s summed counts against the last run's (`ops/crashes`, a new ops document assists-notify adds) | the day (`YYYY-MM-DD`) | `count` | `#/crashes` | warning, yes |

Severity and the push default are `NOTIFICATION_SPECS` (done); the message is `adminContent.notify.event.<kind>` (done,
both languages), filled with the params as text.

### 5.2 How a producer emits

One `documents.create(FIRESTORE_PATHS.notificationEvent(id), notificationEventDocSchema, event)` after the producer's
own transaction (never inside it: a retried transaction must not emit twice), stamped with its system writer; a
`conflict` (the id exists) means it was emitted already and is ignored. Every producer reaches it through the ports it
already has (`documents`), so no feature folder imports another. The emit lines in the producers' files are
assists-notify's (§6.2), except the order watch's, which are orders'.

### 5.3 The fan-out: `notify.onEvent`

A Firestore trigger on `notificationEvents/{eventId}` (create; `fn-events@`, owner `fn-assist-notify`):

1. Every admin (`admins` collection); for each, `inboxItemDocSchema` created at `admins/{uid}/inbox/{eventId}` (the
   event's fields, `read: false`, stamped `system:notify`); an existing item is left (a redelivery).
2. Each admin's settings (`admins/{uid}/notify/settings`); `wantsPush(settings, kind)` → `PushSender.send` to their
   devices' tokens with the message in each device's language (`lang`), the item's `pushedAt`; tokens FCM no longer
   knows → their device documents deleted.
3. Each inbox kept at `INBOX_MAX_ITEMS` (the oldest deleted); events older than `NOTIFICATION_EVENT_DAYS` deleted, 50 a
   run; the event gets `fannedOutAt` and `recipients`.

### 5.4 Push on a device (optional; FCM web push)

- **Consent**: push is off until the admin turns on **Notifications on this device** in the inbox's settings; only then
  does the admin call `Notification.requestPermission()` (the browser's own prompt). Denied → `adminContent.notify.
  push.denied` and nothing registered (`S-A47-BAD-PERMISSION-DENIED`); granted → `register` and `onRegistered` of
  `firebase/messaging` (the installed `firebase` package, no new dependency; `firebase@13` deprecates `getToken`) with
  the admin's service worker: the device is its Firebase installation ID (FID), sent as `message.fid` (firebase-admin
  14.5's `FidMessage`) → `notify.registerDevice {token, lang}` (the field keeps its name `token`; it holds the FID) →
  FCM dry-run (`PushSender.validate`) → `admins/{uid}/pushDevices/{deviceId}` (`deviceId`: 32 hex digits of the
  token's SHA-256; at most `PUSH_DEVICES_MAX`, the oldest replaced) and the settings' `push: true` with
  `DEFAULT_PUSH_KINDS` unless the admin chose others (as built: CR-M4-24, DECISIONS-for-review.md §54c).
- **The service worker**: `firebase-messaging-sw.js` at the admin's origin root (a Vite entry of the admin build that
  imports `firebase/messaging/sw`; Hosting serves it with the admin's CSP), showing the message's title and text and
  opening its admin link. **UNVERIFIED**: that FCM accepts tokens made with the SDK's default VAPID key, so no key pair
  has to be generated in the console (if not, Setup gains one console click to generate it and the public key is read
  through the Firebase Management API).
- **CSP**: no change: the admin's policy (`scripts/site/src/admin/csp.ts`, `firebase.json`) already allows
  `connect-src https://*.googleapis.com` (`fcmregistrations`, `firebaseinstallations`) and `worker-src 'self' blob:`;
  the service worker is a same-origin script.
- **Callables** (owner `fn-assist-notify`, `enforce`; done: `packages/shared/src/api/notify.ts`): `notify.registerDevice`,
  `notify.unregisterDevice` (`{deviceId}` → `{removed}`), `notify.sendTest` (to the caller's own devices → `{sent,
  removed}`). The port is `PushSender` (done), adapter `functions/src/adapters/fcm.ts` through firebase-admin's
  `getMessaging()`.
- **The test tier**: Playwright grants or denies the permission; the e2e mock APIs answer `fcmregistrations` and the FCM
  send route; no real push service is reached (the firewall refuses `fcm.googleapis.com` from a page).

### 5.5 The inbox in the admin (assists-notify)

- A route `#/inbox` (icon `notifications`, in the rail after Jobs and under More on the compact bar, its own lazy chunk
  `inbox` with its budget) listing the admin's items newest first (`admins/{uid}/inbox`, `onSnapshot`, 50 at a time): the
  message in the admin's language, the time, the severity's colour and icon, unread in bold; a click (Enter) marks it
  read and opens its link; **Mark all as read** (client batches of at most 50 updates each, read from the server until none is unread: 2026-11-06, S-A46-HAPPY-MARK-ALL-READ; a read that cannot answer says why and marks nothing).
- **The badge**: the rail's and the compact bar's Notifications item shows the unread count (a query on `read == false`
  limited to `INBOX_BADGE_MAX + 1`, `99+` above), in its accessible name (`adminContent.notify.unread`).
- **Settings**: a section of the inbox page: push on this device (§5.4) and one switch per kind (`pushKinds`), saved
  with the Firestore SDK.
- **Input budget** (done): `readNotification` 1, `pushOn` 2 (the switch, the browser's Allow).
- **States** (§7.3): `notify.inbox`, `notify.inbox-empty`, `notify.badge` (the shell with a count), `notify.settings`,
  `notify.push-denied`.

### 5.6 Rules and indexes (assists-notify)

- `CLIENT_WRITES` gains `inboxItem: {create: [], update: ['read', 'readAt', 'updatedBy', 'updatedAt']}` and
  `notifySettings: {create: ['push', 'pushKinds', …stamp], update: same}`; `firebase/firestore.rules`: an admin reads and
  updates only `admins/{own uid}/inbox/*` (`read` true with `readAt == request.time`), reads and writes only their
  `notify/settings`, reads only their `pushDevices`; nobody else, no client create or delete of items, devices or
  `notificationEvents`; admins read `assistGeocodes/*` (the editor's listener); `usage/ai-*` is already readable by
  admins (`usage/{doc}`). The allow and deny matrix per persona, the complete fixtures of the new collections and rule
  coverage (`S-A46-BAD-OTHER-ADMIN`).
- Indexes: `inbox` by `read` then `createdAt desc`, and by `createdAt desc` (single field).

### 5.7 E-mail

Not built: Firebase has no mail sending of its own and the stack has no mail provider. A path without a new provider
exists (a log-based alert policy on the notification fan-out's structured log, sending through the Cloud Monitoring
e-mail channel the `crash-alerts` provision item already creates); it is a proposal for the user
(`DECISIONS-for-review.md` §52f: its price per alert condition is UNVERIFIED and it would add one policy per kind).

## 6. Ownership

### 6.1 Who owns what

Each workstream writes only its own paths (tests mirror them); reading and importing anything is fine; anything else is
a change request.

| Workstream | Owns (writes) |
| --- | --- |
| orders | `functions/src/imagery/orders/**` (the three callables, the watch's step, the order transitions; part of the imagery feature folder, so it reuses `import.ts` and `versions.ts`), the `orders` line of `functions/src/imagery/tick.ts` and the M4 lines of `import.ts` and `search.ts` (§1.2, §1.6), `UsgsScenes.datasets` (`functions/src/ports/usgs-scenes.ts`, `adapters/usgs.ts`, the fakes), `functions/test/imagery/orders.test.ts` and the tests of those edits, the `usgs` export line of `functions/src/index.ts` and its registry rows, `packages/admin/src/imagery/orders/**`, `packages/ui/src/admin/imagery/orders/**`, the `orders` section of `packages/shared/src/i18n/admin-imagery/{ro,en}.ts`, the `usgsScenes` rule and index of §1.8, `links.json`'s `usgs.earthExplorerScene` and its probe in `scripts/ci/check_contracts.py`, the USGS fake's delivery flip (`packages/test-support/src/fakes/usgs*.ts`, `e2e/mock-apis` routes), `e2e/admin/specs/imagery/orders.spec.ts`, the `orders` sections of `e2e/tour/states.ts` and `budgets.ts`, the A13 rows |
| autogcp | `pipeline/src/hcm_pipeline/georef/**`, `pipeline/src/hcm_pipeline/steps/georef.py`, `pipeline/tests/**` but `tests/contracts/`, the Python side of the contract test; `packages/admin/src/georef/suggestions*.ts`, `packages/ui/src/admin/georef/suggestions*.ts` and their tests; the `suggestions` outcome of the e2e stand-in runner (`e2e/admin/support/imagery-standin.ts`, `imagery-run.ts`); `e2e/admin/specs/imagery/suggestions.spec.ts`; the `autogcp` sections of `e2e/tour/states.ts` and `budgets.ts`; georeferencer texts in the `georef` section of `admin-imagery` (CR-M4-6); the A44 and P03 rows |
| compare | `packages/engine/src/compare/**`, the compare lines of `packages/engine/src/core/{store,state,url-sync}.ts` and `mount.ts`, `packages/ui/src/viewer/compare/**`, the Layers panel's Compare button (`packages/ui/src/viewer/hcm-layer-panel.ts`), the `./viewer/compare` export of `packages/ui/package.json`, MapPort's `move` (`packages/ui/src/map/{map-port,mapbox-adapter}.ts`, `packages/test-support/src/fake-map.ts`), the viewer catalogue's `compare.*` keys, the icon, `ENGINE_CHUNK_BUDGETS`, `docs/ENGINE_API.md`'s *Compare* section, `e2e/specs/viewer/compare.spec.ts`, `ENGINE_EVENTS` of `e2e/support/instrumentation.ts`, the viewer compare states and journey in `e2e/tour/states.ts`, the V06 rows |
| assists-notify | `functions/src/{assist,notify}/**` (new feature folders: the `functions-feature-folders-independent` rule of `.dependency-cruiser.cjs` lists them, a stricter edit of the pre-approved kind), `functions/src/adapters/{nominatim,vertex-ai,fcm}.ts`, the three M4 ports' wiring in `functions/src/deps.ts` (the `Omit` goes), their accounts in `global-options.ts`, the `assist` and `notify` export lines of `functions/src/index.ts`, their registry rows; the emit lines of §5.1 in `functions/src/imagery/on-job-write.ts`, `functions/src/ops/{services,budget}.ts`; the `ai` self-test check (CR-M4-5); the provisioner's APIs and IAM (CR-M4-5); `packages/admin/src/{inbox,assist}/**`, `packages/ui/src/admin/{inbox,assist}/**`, the editors' assist slots (CR-M4-4), the shell's Notifications item and badge, the admin's service worker and CSP; `packages/shared/src/i18n/admin-notify/**`; the rules, indexes and rules tests of §4.2 and §5.6 and `CLIENT_WRITES`; the fakes (Nominatim, Vertex AI, FCM) in `packages/test-support/src/fakes/` and `e2e/mock-apis/`; `e2e/admin/specs/{assists,notify}/**`; the `notify` sections of `e2e/tour/states.ts` and `budgets.ts`; the A09 assist rows, A45, A46, A47 |
| tooling | `terra-draw` 1.37.0 → 1.38.0 (and `terra-draw-mapbox-gl-adapter` only if 1.38.0 requires it: otherwise a NOT APPLIED proposal) in `packages/ui/package.json` and the lockfile, the `HELD` entry removed in the same change (`scripts/ci/check_dependency_updates.py`, `docs/CI_PIPELINE.md` → *Held dependencies*), the drawing tests that prove it (`packages/ui/test/map/draw/**`, the admin's drawing specs), `ADMIN_CHUNK_BUDGETS`' `terra-draw` row if the measurement moves; the third-party notices generator and its gate (§6.4); after the four: `docs/*.md` (ARCHITECTURE, TESTING, CI_PIPELINE, SETUP, the admin guides' chapters, LESSONS, MANUAL_TEST_PLAN), `.agent/**`, `.agents/**`, `.claude/**`, `docs/research/M0-handoff.md`, `docs/research/M4-status.md`, the root `package.json` and the lockfile |
| contracts (done) | this file, the files of *Done by this contract* (§0) |

### 6.2 Shared files

| File | How a workstream appends |
| --- | --- |
| `e2e/scenarios.json` | each workstream flips its rows (the `notes` name the owner and the spec) to `exists` when the tagged test lands, a new row after its behaviour's last; then `python3 scripts/ci/check_e2e_matrix.py write` in the image |
| `e2e/tour/states.ts` | inside its own M4 section (`orders`, `autogcp`, `notify`) for admin states; compare adds the viewer states with the journey that visits them |
| `packages/admin/src/content/budgets.ts` | inside its own section (`orders`, `autogcp`, `assists-notify`) |
| `packages/shared/src/api/registry.ts`, `functions/src/index.ts`, `functions/test/index.test.ts`, `packages/admin` function counts (`packages/admin/test/google/clients.test.ts`, `provision/setup-cloud.test.ts`) | one line per function at the end of its group (orders: 3 callables; assists-notify: 5 callables, 2 background) |
| `packages/shared/src/api/errors.ts` and the API catalogues | a new code is a change request here (the seven of §0 are done) |
| `packages/shared/src/i18n/admin-imagery/{ro,en}.ts` | orders in `orders`, autogcp in `georef` (CR-M4-6), never another section |
| `functions/src/imagery/tick.ts`, `on-job-write.ts`, `import.ts`, `search.ts` | orders' and assists-notify's lines only as §6.1 says; M3's behaviour unchanged (their tests keep passing) |
| `firebase/firestore.rules`, `firestore.indexes.json`, `firebase/rules-tests/**` | orders: the `usgsScenes` triage list and index; assists-notify: the notification and assist matches; each in its own block |
| `scripts/ci/check_bundle_budget.py` | compare: `ENGINE_CHUNK_BUDGETS`; assists-notify: `ADMIN_CHUNK_BUDGETS`' `inbox` row; tooling: the `terra-draw` row; each logged in `DECISIONS-for-review.md` |
| `pipeline/tests/contracts/**` | change request (both languages must pass the change) |

### 6.3 Order of work

1. **In parallel from the start**: orders (the callables and the watch against the fakes, then the card), autogcp (the
   matcher against the synthetic world, the panel against the golden document), compare (MapPort `move`, the chunk, the
   divider), assists-notify (the ports' adapters and `deps.ts` wiring first, the fan-out and the producers' emit lines,
   then the queue, the translator and the screens), tooling (terra-draw first: one download, approved; then the notices).
2. The orders watch emits through `documents` (§5.2) and needs nothing of assists-notify to be tested; the inbox shows
   orders' events once both land.
3. Each workstream runs `PIPELINE_STAGE=static` and `tests` for its own changes, `build` when it touches the engine or
   the admin.
4. **Only one agent at a time runs a split stage** (`PIPELINE_STAGE=<stage> bash scripts/ci/e2e-split.sh`, the NUC); the
   others run single tiers locally (`--project`), and nobody touches other containers or `~/fork-linux-ci` on the NUC.

### 6.4 The third-party notices (tooling; the user's decision §52d)

- A generator (`scripts/build/notices.mjs`, run by the engine's and the admin's builds after Vite) walks the bundled
  packages of each build (the Rolldown output's module ids resolved to their `node_modules` package folders, plus the
  self-hosted fonts' packages) and writes `THIRD_PARTY_NOTICES.txt` beside `engine.mjs` and `admin.mjs`: per package its
  name, exact version, licence id and the full licence text from the installed package (`LICENSE*`, `LICENCE*`,
  `COPYING*`, `NOTICE*`), sorted, deterministic.
- A gate (`notices`, build stage, `scripts/ci/check_notices.py`): every package in a bundle's module graph has its entry
  with a licence text; no entry without a bundled module; the licence is on an allowlist of permissive licences in the
  gate's own config (MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, OFL-1.1 for the fonts, 0BSD, CC0-1.0; anything
  else fails until reviewed). Mapbox GL JS is never bundled and needs no entry; the site build copies the engine's
  notices file with the engine. A new gate is the pre-approved kind; tooling logs it.

## 7. Scenarios, budgets and tour states

### 7.1 Rows (done: `e2e/scenarios.json`, `docs/E2E_SCENARIOS.md` regenerated)

Every M4 row is `planned` and its `notes` name the section, the owner and the test file that will carry its tag; a row
flips to `exists` when that test lands.

- **A13** buy a scan (orders): `S-A13-HAPPY`, `-BAD-NEVER-DELIVERED`, `-BAD-ALREADY-AVAILABLE` refined, `-HAPPY-TAKE-BACK`
  (e2e-admin); `-HAPPY-WATCH`, `-BAD-MARK-AVAILABLE-REFUSED`, `-BAD-EXPIRED`, `-BAD-USGS-DOWN`, `-BAD-GUARD-PAUSED`,
  `-BAD-CHECK-NOW-TOO-OFTEN` (functions); `-BAD-CLIENT-ORDERED-STATUS` (rules).
- **A44** (new) automatic GCP suggestions (autogcp): `S-A44-HAPPY`, `-BAD-REJECTED-NEVER-SAVED`, `-HAPPY-KEYBOARD`,
  `-BAD-NO-SUGGESTIONS` (e2e-admin). **P03** (new): `S-P03-HAPPY`, `-HAPPY-ORB-FALLBACK`, `-HAPPY-OSM-CHANNEL`,
  `-BAD-FEW-CONFIDENT`, `-BAD-LOW-TEXTURE` (e2e-pipeline, pytest docstrings).
- **V06** swipe compare (compare): the three rows refined; `-HAPPY-KEYBOARD`, `-HAPPY-DEEP-LINK`, `-BAD-UNKNOWN-LAYER`,
  `-HAPPY-OPACITY`, `-HAPPY-CAMERA-SYNC` (e2e-viewer).
- **A09** photo edit (assists-notify): `S-A09-BAD-NOMINATIM-429` and `-BAD-AI-UNAVAILABLE` refined,
  `-HAPPY-TITLE-SUGGESTION`, `-HAPPY-TRANSLATE-DRAFT` (e2e-admin). **A45** (new) the assists: `S-A45-HAPPY` (e2e-admin);
  `-HAPPY-GEOCODE-QUEUE`, `-BAD-GEOCODE-COOLDOWN`, `-HAPPY-TRANSLATE`, `-BAD-MARKUP-AND-LENGTH`, `-BAD-MONTHLY-CAP`,
  `-BAD-GUARD-PAUSED`, `-BAD-API-DISABLED`, `-HAPPY-SELF-TEST` (functions).
- **A46** (new) the inbox: `S-A46-HAPPY`, `-BAD-EMPTY` (e2e-admin); `-HAPPY-FAN-OUT`, `-HAPPY-PRODUCERS` (functions);
  `-BAD-OTHER-ADMIN` (rules). **A47** (new) push: `S-A47-HAPPY`, `-BAD-PERMISSION-DENIED` (e2e-admin);
  `-BAD-TOKEN-UNREGISTERED` (functions).

### 7.2 Input budgets (done: `CONTENT_INPUT_BUDGETS`)

| Flow | Inputs | How |
| --- | --- | --- |
| `buyScan` | 2 | Order in EarthExplorer (the purchase there is the admin's own step), I ordered it |
| `checkOrderNow` | 1 | Check now (never needed: the watch asks daily) |
| `acceptSuggestions` | 2 | Accept all, Save |
| `suggestTitle` | 1 | a suggested title (they come when the place is set) |
| `translateDraft` | 2 | the draft button, Save |
| `readNotification` | 1 | the item (it opens its page and is marked read) |
| `pushOn` | 2 | Notifications on this device, the browser's Allow |

Everything after I ordered it (the watch, the reminders, the import, the georeferencing, the publish under the
threshold) takes no input.

### 7.3 Tour states

Every new screen and state joins `e2e/tour/states.ts` (the M4 sections are there, empty) and passes `expectStateSound`
at every tour viewport, light and dark; the viewer's compare states at every viewer viewport; nothing joins a checker's
allowlist: `orders.order-card`, `orders.ordered`, `orders.reminder`, `orders.delivered`, `orders.expired`,
`georef.suggestions`, `georef.suggestions-accepted`, `georef.no-suggestions`, `notify.inbox`, `notify.inbox-empty`,
`notify.badge`, `notify.settings`, `notify.push-denied`, `assist.suggestions`, `assist.suggestions-refused`,
`assist.draft`, `assist.draft-refused`, `viewer.compare-swipe`, `viewer.compare-swipe-edge`, `viewer.compare-menu`,
`viewer.compare-toggle`, `viewer.compare-keyboard`.

## 8. Fakes and the e2e world

- **USGS** (orders): a scene whose `download-options` answers `available: false` until the spec flips it
  (`POST /__usgs/deliver?entity=`), `dataset-search` with the three datasets' ids; the tick's clock through the
  emulator's time control the M3 world already uses for `imagery.tick`.
- **Nominatim** (assists-notify): `GET /reverse` answering a few Bucharest places (a named building, a road in a
  quarter, a quarter only) with the real licence line, scenarios `nominatim.rateLimited` (429) and `.unavailable` (503),
  a call counter; the host `nominatim.openstreetmap.org` is server-only (the firewall refuses it from a page).
- **Vertex AI** (assists-notify): `generateContent` echoing a scripted draft per scenario (`vertex.ok`, `.markup`,
  `.empty`, `.safety`, `.unavailable` 503, `.disabled` SERVICE_DISABLED), recording the model, the prompt and the
  generation config; `countTokens`; server-only host.
- **FCM** (assists-notify): `fcmregistrations` for the page's `getToken` (a fixed fake token), the HTTP v1 send route
  recording messages, `.unregistered` per token.
- **The runner** (autogcp): the stand-in's `suggestions` outcome (§2.6).
- **Firewall**: the M3 server-only hosts plus Nominatim and Vertex AI; FCM's send host from a page; Mapbox Satellite and
  OpenStreetMap tiles stay refused; `mapbox-gl-compare` is no longer allowed anywhere (nothing loads it).

## 9. Cost and security summary

| Item | Cost | Guard |
| --- | --- | --- |
| A scan | 35 USD for one frame (30 + 5), paid by the admin to USGS | a human step; the app never pays, never sees card data |
| The order watch | at most one USGS login per five-minute tick with orders due, one `download-options` per dataset a day | inside `imagery.tick`, no new scheduler |
| Nominatim | free | one request a second (the queue), cached 90 days, ten-minute cool-down after a refusal, the policy's User-Agent and attribution |
| Vertex AI | under 0.05 USD a month expected (PLAN) | `AI_MONTHLY_CAP` (500 requests, 0.50 USD), the budget guard, App Check, admins only, server-side only |
| FCM | free | admins' own devices only, at most five each, a dry-run before storing a token |
| Cloud Tasks, Firestore | within the free tiers (one queue, one trigger, a few documents per event and admin) | the inbox and the events pruned |
| Compare | one extra Mapbox map load per compare session on a window 600 px or wider, none on a phone | created on demand, destroyed on exit, counted by the e2e map-instance counter |

Untrusted strings (security review §1.7): Nominatim's names, Gemini's drafts and the event parameters are plain text,
length-limited by their schemas and rendered with Lit or `textContent`, never as HTML; no address from them is fetched.

## 10. UNVERIFIED, and how the first real run proves it

| Fact | Proof (ask first; local or the real project, never in CI) |
| --- | --- |
| The declassii and declassiii EarthExplorer dataset ids | the first real harvest's `dataset-search`; the deep link opened once in the user's browser with consent |
| USGS deletes an unpaid order after two weeks; turnaround three to four weeks | USGS's help pages (2026-10-11); the first real order (placed and paid 2026-11-08: the delivery date proves the turnaround) |
| ~~Where the order control sits on the scene's page~~ | proved 2026-11-08 by the owner's first order: Login, then Order at the page's bottom, no basket (the *Buy flow guide*, §1) |
| `tram-order-search` / `tram-order-status` could detect an order or its payment | the first real order, with the download role |
| `gemini-2.5-flash-lite` is still served in `us-central1`, and its price | the setup self-test's `ai` check (`countTokens`, free) after Provision; the first month's invoice line |
| `roles/firebasecloudmessaging.admin` is the narrowest role for HTTP v1 sends | the first `notify.sendTest` after Provision |
| FCM web push with the SDK's default VAPID key | the first `notify.registerDevice` and `notify.sendTest` in the deployed admin |
| FCM's REST API takes `message.fid` from our own call (CR-M4-24) | the first `notify.sendTest` after Provision (DECISIONS-for-review.md §54c) |
| Nominatim answers our User-Agent and `name:en` for Bucharest's places | the first suggestion in the deployed admin |
| A log-based alert policy's price (the e-mail proposal) | the Cloud Monitoring pricing page at the time of the user's decision |

## Change requests

A workstream that needs a change outside its paths appends a row here and continues against the current contract; the
owner (or tooling, the integrator) applies it. Ids are `CR-M4-<n>`; status `open`, `accepted`, `done` or `rejected`.

| Id | From | Target (owner) | Change | Why | Status |
| --- | --- | --- | --- | --- | --- |
| CR-M4-1 | contracts | contracts | The shared schemas and helpers (orders, autogcp, assists, notifications), the scene's `order` and `eeDatasetId`, the version's `suggestions` (and its `undefined` in `functions/src/imagery/versions.ts`'s new-version builder), the M4 paths, the API schemas, seven error codes, the hash's `cmp=`/`sw=`, the function owners and system writers, the three ports and the queue payload, the golden autogcp documents, the catalogue skeletons, the input budgets, the tour sections, the scenario rows, the compare plugin's removal, `docs/ENGINE_API.md`'s compare section, the decisions log | the five workstreams start from one contract | done (2026-10-24) |
| CR-M4-2 | contracts | orders (rules, `jobs.test.ts`) | §1.8: the client triage list without `ordered` and `available`; the `usgsScenes` index on `order.state`, `order.nextCheckAt` | the order is `usgs.markOrdered`'s, which checks USGS first | done (2026-10-24; no composite index: CR-M4-13 (b)) |
| CR-M4-3 | contracts | orders (`functions/src/imagery/{tick,import,search}.ts`, `UsgsScenes`) | §1.5's step in `imagery.tick`; `imagery.import` on a scene with an order moves the order; the harvest records `eeDatasetId` through `UsgsScenes.datasets` | no new scheduler; one import path | done (2026-10-24; the harvest edit is in `harvest.ts`: CR-M4-12) |
| CR-M4-4 | contracts | assists-notify (the M2c photo, place and layer editors: `packages/ui/src/admin/{photos,pois,layers}/**`, `packages/admin/src/{photos,pois,layers}/**`) | One assist slot under each title or label and beside each Romanian/English pair, filled by the `assist` module's elements through the content seam (`ContentPort` gains `suggestTitle`, `translateDraft`), so the editors' chunks import only leaves of `assist` (lesson of CR-M3-31) | the assists appear where the admin types | done (2026-10-24: the photo, place and layer editors; the slots are `packages/ui/src/admin/assist/assist-parts.ts`, the intents `packages/admin/src/assist/editor-assists.ts` through each area's own state and intents, not `ContentPort`, so no editor chunk imports more than those leaves) |
| CR-M4-5 | contracts | assists-notify (the admin's provisioner `packages/admin/src/provision/**`; fn-setup's `functions/src/setup/self-test*.ts` and `SELF_TEST_CHECKS`; `admin-setup` labels) | §4.4: three APIs, the IAM roles, the `ai` self-test check and its label | Vertex AI and FCM need them | done (2026-10-24: `aiplatform`, `fcm`, `fcmregistrations`; `roles/aiplatform.user` and `roles/firebasecloudmessaging.admin` for `fn-admin@`, the FCM role for `fn-events@`; the `ai` check and its label; DECISIONS §54f) |
| CR-M4-6 | contracts | autogcp (the `georef` section of `packages/shared/src/i18n/admin-imagery/{ro,en}.ts`, admin-imagery's in M3) | the Suggestions panel's texts join the `georef` section | the georeferencer's texts stay in one section | accepted |
| CR-M4-7 | contracts | compare (`packages/ui/src/map/map-port.ts`, `mapbox-adapter.ts`, `packages/test-support/src/fake-map.ts`) | MapPort's `move` event (§3.4) | camera sync without touching `mapbox-gl` outside the adapter | done (2026-10-24; forwarded at once, see CR-M4-16) |
| CR-M4-8 | contracts | assists-notify (`functions/src/imagery/on-job-write.ts`, `functions/src/ops/{services,budget}.ts`; `ops/crashes`' schema in `packages/shared/src/schemas/notifications.ts`) | §5.1's emit lines and the crash-spike counter document | the producers emit once each | done (2026-10-24: through `functions/src/api/notification-event.ts` and `functions/src/imagery/job-notices.ts`, CR-M4-20) |
| CR-M4-9 | contracts | tooling | Each workstream's report at its end (built, learned, lessons for `docs/LESSONS.md` and the skills); then the docs, `docs/research/M4-status.md` and the agent assets | docs follow the code | done (2026-10-24, the integrator: README, `docs/{ADMIN_GUIDE.en,ENGINE_API,ARCHITECTURE,TESTING,CI_PIPELINE,LESSONS,MANUAL_TEST_PLAN}.md`, the skills and their mirrors, `docs/research/M4-status.md`) |
| CR-M4-10 | tooling | tooling (§6.4) | The notices generator is the Vite plugin `thirdPartyNoticesPlugin` in `scripts/site/src/notices.ts`, in both Vite configs (with the fonts' packages from the kit's `FONT_FILES`), instead of `scripts/build/notices.mjs` run after Vite; the gate is `scripts/ci/check_notices.py` as written, in `build` and also in `release` | the plugin reads Rolldown's own module list of each output; `scripts/site` is the build tooling with a Vitest project measured per file; the bundles a release attaches carry complete notices (`DECISIONS-for-review.md` §53b) | done (2026-10-24) |
| CR-M4-11 | orders | tooling, the integrator (`functions/src/adapters/documents.ts`, owner M2's) | Convert every `where` operand with `toFirestoreValue` in `buildQuery` (`query.where(field, operator, toFirestoreValue(value))`), with an emulator test of a timestamp range | A `timestampFromDate` operand reaches the Admin SDK as a plain `{seconds, nanoseconds}` map, and Firestore compares a range filter only within one type: on the emulator `createdAt >= <map>` found 0 of 1 matching documents (a throwaway probe test, 2026-10-24). So M3's `JOBS_PER_DAY` cap (`limits.ts` `rasterJobsToday`) never counts a job in production (its unit tests use the in-memory fake, which compares timestamps). The order watch avoids the bug: it reads the open orders with one `in` filter and keeps the due ones in memory | done (2026-10-24, the integrator: `buildQuery` converts every operand with `toFirestoreValue`; `functions/test/adapters/documents.test.ts` `happyPath_aTimestampOperandMatchesStoredTimestampsInARangeAndInAList` on the emulator) |
| CR-M4-12 | orders | orders (self-applied: files of M3's imagery feature with no M4 owner) | Orders' integration lines: `functions/src/imagery/harvest.ts` (the harvest itself; `search.ts` only wraps it), `scene-rank.ts` (`rankNow` exported), `global-options.ts` (`RUNTIME_ACCOUNTS` of the three callables, needed to compile the registry rows); `packages/admin/src/imagery/{model,feeds,state,imagery}.ts` (the scene item's `acquisition`, `order`, `earthExplorerUrl`; the orders feed; the order state and intents); `packages/ui/src/admin/imagery/{imagery-port,hcm-imagery-page,scene-detail,scene-list,work-list}.ts` (the card, the chips, Work's orders, a routed ordered scene); their M3 tests (`packages/ui/test/admin/imagery/{fixtures,imagery-detail.test}.ts`, `packages/admin/test/imagery/feeds.test.ts`), the rules matrix row (`firebase/rules-tests/test/matrix.test.ts`: the triage update is now `rejected`), `functions/test/support/imagery-fakes.ts` (`datasets`), the deployment counts (`packages/admin/test/{google/clients,provision/setup-cloud}.test.ts`: 61 with assists-notify's 7) | The buy flow lives in the Imagery area's screens and the M3 harvest, which no other M4 workstream owns. Without the harvest edit a monthly harvest rewrote every scene without its `order` (it kept only status, note, layer id and creation) | done (2026-10-24) |
| CR-M4-13 | orders | orders (self-applied contract deviations, §1.6, §1.8, §5.1, §8) | (a) `order.reminder` ids name the order too (`order.reminder~city~entity~day~orderedAtMs`), so an order marked again after it expired or was taken back is reminded again (the contract's three parts would have swallowed them as duplicates). (b) No `usgsScenes` composite index: the watch's query is the single `order.state in [...]` (the automatic index; the due filter runs in memory, see the adapter CR above); the admin's orders feed is the same query. (c) No new `usgs.earthExplorerScene` link: `links.json` already holds the same template as `usgs.sceneMetadata` (C6); the stricter weekly probe is `usgs.earthExplorerScene` in `scripts/ci/check_contracts.py` (HTTP 200 and the page names `DS009013039DV181`), and an admin test ties `earthExplorerSceneUrl` to that template. (d) The e2e delivery is the named scenario `usgs.ordersDelivered` (every scene that had to be bought becomes downloadable), not a `POST /__usgs/deliver` route; the fake's `download-options` names each dataset's EarthExplorer id (none for Declass 3). (e) A scene whose EarthExplorer page is unknown names its entity id as selectable text with EarthExplorer's home (no Copy button). (f) The cards keep M3's Free / Needs ordering chips and add a short order chip (`adminContent.orders.tag.*`); the full `orders.state.*` sentence is on the scene's card. (g) The e2e reminder, delivered and expired states are seeded as the watch leaves them (no server clock to move); the watch's own timing is the functions rows | What the code and its tests do; the reviewer may want them in §1 | done (2026-10-24) |
| CR-M4-14 | orders | admin-imagery's `imagery` section of `packages/shared/src/i18n/admin-imagery/{ro,en}.ts` (tooling, the integrator) | Remove `adminContent.imagery.needsOrderNote` ("…in a later milestone") | No screen uses it since the order card replaced the note | done (2026-10-24, the integrator) |
| CR-M4-15 | orders | autogcp / tooling (`e2e/tour/states.ts`) | Bring the file back under 600 code lines (609 now): move the inline `georef.suggestions*` states into a file of their own, as orders' `e2e/admin/specs/imagery/orders-states.ts` and M3's `states.ts` are spread | ESLint's `max-lines` for tests; orders adds two lines (an import, a spread) | done (2026-10-24, autogcp: `e2e/admin/specs/imagery/suggestions-states.ts`, spread in the autogcp section) |
| CR-M4-16 | compare | compare (self-applied; no other M4 workstream owns these files) | (a) §3.6: the legal line is the viewer map's own logo and attribution, above the second map at every divider position (the second map's are hidden; the bar credits the compared layer's source), not the second map's attribution, which a divider at 100 % clips away. (b) §3.3–§3.5: the second map is inert and lets every pointer through (the viewer's map takes the gestures, the second follows its camera); the handle is the only drag target, below the map's centre, clear of the vertical timeline of a phone held landscape. (c) §3.4: `move` is forwarded at once, not a frame later. (d) §3.2: the chunk's entry is `packages/engine/src/compare/compare.ts` (`compare-<hash>.js`), and `packages/engine/vite.config.ts` sets `preserveEntrySignatures: 'allow-extension'` so what the chunks share stays in `engine.mjs` (DECISIONS-for-review.md §55c). (e) §3.5, §3.9: the chooser is a native `<select>`; the tour states are `viewer.compare-swipe`, `-keyboard`, `-swipe-edge` (0 %), `-swipe-edge-end` (100 %), `-toggle`, `-menu` (`e2e/tour/compare-states.ts`, journey `compare`). (f) Files beyond §6.1's list: the viewer's integration lines in `packages/ui/src/viewer/{store-port,events,viewer-render,viewer-handlers,viewer-actions}.ts`, `packages/engine/src/core/{boot,map-sync,deps,compare-driver}.ts`, `e2e/projects.ts` (the spec runs at one functional project per push), `e2e/support/compare.ts`; and §51e (the orchestrator's addition): `scripts/site/src/{build,cli,site-spec,public-manifest}.ts`, `sites/bucharest/{site.json,config.js}`, `scripts/ci/run-all-checks.sh` (forwards `HCM_PUBLIC_BUCKET`), `e2e/scripts/build-site.ts`, `e2e/fixtures/world.ts`, `e2e/support/site.ts`. (g) For tooling's docs pass (CR-M4-9): `.agent/skills/web/engine_viewer_skill.md` is updated here; still to sync: the e2e skill's V06 line, `docs/TESTING.md` (the tour's compare journey, `public-manifest.spec.ts`), `docs/CI_PIPELINE.md` and `.agent/skills/quality/{pipeline,ci_quality_gates}_skill.md` (`HCM_PUBLIC_BUCKET`, `ENGINE_CHUNK_BUDGETS`), `.agent/workflows/{build,deploy}.md` and `docs/MANUAL_TEST_PLAN.md` (the go-live's repository variable, DECISIONS §55e); lessons for `docs/LESSONS.md`: Vite's library mode keeps the entry's signature strict, so a lazy chunk sharing modules with the entry made a third chunk the entry imported at once (§55c); a native `<select>` keeps its widest option's width unless it may shrink (`min-inline-size: 0`), which the tour's text spacing at 320 px found past the map's edge; the occlusion check samples a map canvas at its centre, so no control may sit there; two 4K maps under SwiftShader on a loaded machine outlast `mapIdle`'s 15 s (`mapIdle(page, timeout)` now); a tour run while another agent rebuilt `packages/engine/dist` and `dist/e2e-site` failed on 404s of the engine's fonts and chunk (rebuild, then run, with no build in parallel) | the build met the contract's edges (the legal line at 100 %, the checker's centre sample, Vite's library chunking) and the orchestrator's §51e | done (2026-10-24) |
| CR-M4-17 | autogcp | autogcp (self-applied: M3's georeferencer files, no other M4 owner) | The Suggestions panel's wiring (§2.5) beyond the `suggestions*` files: the store's four intents (`acceptSuggestion`, `acceptAllSuggestions`, `rejectSuggestion`, `selectSuggestion`) and its `suggestions` state in `packages/admin/src/georef/{georef,state}.ts`; the map's suggestion overlay in `georef-map.ts` (`georef-suggestions`, flags in their own colour labelled `a1`… from zoom 16: Mapbox circles cannot be dashed, so only the scan pane draws dashed rings); the port, the page's panel slot and the keyboard's place after a decision in `packages/ui/src/admin/georef/{georef-port,hcm-georef-page,georef-panes,hcm-scan-viewer,scan-draw}.ts`; the `suggestions` default of the page tests' fixture `packages/ui/test/admin/imagery/fixtures.ts`; in the e2e stand-in, fitting the admin's points removes `suggestions` as the pipeline does | §2.5 lives in the georeferencer's files | done (2026-10-24) |
| CR-M4-18 | autogcp | contracts (§2.1 step 2, §2.2, §2.3, §2.6; as built) | (a) The `osm` channel's scan side is the white and black top-hat of the CLAHE'd pre-warped scan (lines up to 150 m wide), not Canny's edges: on the synthetic world Canny followed the ground's texture as much as the roads (median 155 m off against 13 m); the reference side is the proximity field (255 on a line, 0 at 60 m). (b) A tile's margin is the peak minus the next *local maximum* outside its 3 × 3 neighbourhood (the raw next value is the peak's own shoulder on a smooth field). (c) A tile is the cell's box capped at `AUTO_GCP_TILE_PX` at 10 m, tried where the scan covers 90 % of it; `tiles` counts the tiles tried and matched at the level the pairs come from, both channels (the `s2` fallback's too). (d) SIFT or ORB is decided once, on the scan pre-warped onto the 10 m grid through the corner guess. (e) The agreement compares the two channels' shifts in the same cell (20 m on the ground). (f) A version waiting with suggestions keeps the corner pairs `locate` wrote ("absent" in §2.3: the step writes no fitted `georef`), so the georeferencer starts from them as in M3. (g) Fitting the admin's points (a version holding `method: 'gcps'`) deletes `suggestions`: they are decided. (h) §2.6's ORB scene is a faded scan (contrast 5 %: SIFT finds 35 keypoints, ORB matches), the `osm` scene a Sentinel-2 window under cloud from edge to edge (OpenStreetMap's lines alone place the frame within 15 m); scans come from the synthetic world through an exact affine map (`pipeline/tests/integration/matching.py`). (i) The georeferencer's panel shows for a version with a `suggestions` record, or a USGS import waiting with `noMatch` (an upload without a georeference waits with `noMatch {pairs: 0}` though nothing was matched: no panel). For tooling's docs pass (CR-M4-9): `.agents/skills/raster-pipeline/SKILL.md` still says OSM is "not yet a matching channel" | the measurements on the synthetic world | done (2026-10-24) |
| CR-M4-19 | compare | tooling (`scripts/site/src/notices.ts`) | `thirdPartyNoticesPlugin` clears what it gathered at every `buildStart`, and Vite's library build of the engine's two formats starts one build per format, so the `THIRD_PARTY_NOTICES.txt` written last holds the ES build's packages only (the build log shows it written twice: 100.18 kB after the IIFE, 98.41 kB after the ES build). Since swipe compare, the IIFE (which inlines the `compare-<hash>.js` chunk and wraps what it imports) renders `lit/index.js`, which the ES build does not, so `engine.iife.js.map` names `lit@3.3.3` and the `notices` gate fails: "packages/engine/dist: lit@3.3.3: bundled (BSD-3-Clause) but not in THIRD_PARTY_NOTICES.txt". Suggested fix: gather across the formats of one build (do not clear between them), so the last file is complete as the plugin's comment intends | the build stage's `notices` gate (2026-10-24, `PIPELINE_STAGE=build`) | done (2026-10-24, the integrator: the plugin no longer clears at `buildStart`; one instance lives for one `vite build`, so the file written last lists both formats' packages: `[notices] OK` with 13 engine packages, `lit` among them) |
| CR-M4-20 | assists-notify | tooling, the integrator (self-applied: backend files beside the owned emit lines) | `functions/src/api/notification-event.ts` (new: the producers' one emit helper, an id from the event's parts, `create`, a failure logged and never thrown); `functions/src/imagery/job-notices.ts` (new: `job.failed`, `layer.readyToApprove`, `layer.needsPoints`, called by `on-job-write.ts` after its action); `functions/src/ops/crash-spike.ts` (new) and `functions/src/ops/tick.ts` (its health step checks the crash spike; `OpsDeps` gains `errors`); `functions/src/adapters/emulator-fetch.ts` (Nominatim's host joins the forwarded ones) | the producers of §5.1 emit once each through one helper, and the Functions emulator reaches the fake Nominatim | done (2026-10-24) |
| CR-M4-21 | assists-notify | contracts (self-applied: shared schemas, catalogues and their tests) | `packages/shared/src/schemas/notifications.ts`: `paramsIn` (an English reader gets the `<name>En` parameters), `OPS_CRASHES_PATH` and `crashCounterDocSchema`, and the settings' optional `createdAt` (create only), mirrored in `CLIENT_WRITES` and the rules; `packages/shared/test/schemas/{client-writes,index}.test.ts` (the two notify collections' shapes, the new exports); `adminShell.nav.inbox` in `packages/shared/src/i18n/admin-shell/{ro,en}.ts` | the content store stamps `createdAt` on a create (DECISIONS §54d); the rail names the inbox | done (2026-10-24) |
| CR-M4-22 | assists-notify | tooling, the integrator (self-applied: the admin's app wiring and the kit's ports) | `packages/admin/src/{app/{content-wiring,shell-watches,mount,boot,state},firebase/{messaging,messaging-sdk},routing/routes,content/{areas,services},pages/inbox,area-pages,index}.ts` (the inbox area and route, the unread badge's watcher, the push registrar and its `e2e` stand-in); `packages/ui/src/admin/{content-port,admin-port}.ts` (section `inbox`, route `inbox`, `unread`), `packages/ui/src/admin/setup/self-test.ts` (the `ai` check's step), `packages/ui/src/icons.ts` (`done_all`, `notifications`, `send`) and the rebuilt icon font | the inbox is an area of its own, and the shell counts what is unread | done (2026-10-24) |
| CR-M4-23 | assists-notify | tooling (self-applied, a stricter gate and a build group: DECISIONS §54b) | `packages/admin/vite.config.ts`: the `firebase-installations` and `assist` groups; `scripts/ci/check_bundle_budget.py`: `inbox` 5, `messaging-sdk` 7, `firebase-installations` 4, `assist` 3 KB and the service worker `firebase-messaging-sw.js` 1 KB | every new admin chunk has a budget, and `@firebase/installations` stays out of `editor-shared` | done (2026-10-24) |
| CR-M4-24 | assists-notify | contracts (§5.4, §10; as built) | §5.4 says the page's `getToken` and the device's FCM token: `firebase@13` deprecates `getToken`, so the page registers with `register` and `onRegistered` and the device is its Firebase installation ID, sent as `message.fid` (firebase-admin 14.5's `FidMessage`); the field keeps its name `token`. §10 gains: "FCM's REST API takes `message.fid` from our own call", proved by the first `notify.sendTest` after Provision (DECISIONS §54c) | the contract describes what is built | done (2026-10-24, the integrator: §5.4 and §10 as built) |
| CR-M4-25 | assists-notify | compare (its row `S-V01-HAPPY-PUBLIC-BUCKET` in `e2e/scenarios.json`) | Put the bucket's address in the row's `asserts` in backticks (`` `https://storage.googleapis.com/<bucket>/cities/bucharest/manifest.json` ``) and run `check_e2e_matrix.py write` | the generated `docs/E2E_SCENARIOS.md` carries the row's text, and markdownlint's MD034 refuses the bare address there (the `static` stage's `markdownlint` gate, found when the assists-notify rows were flipped to `exists` on 2026-10-24) | done (2026-10-24, the integrator: the address in backticks, `docs/E2E_SCENARIOS.md` regenerated; `markdownlint` passes) |
| CR-M4-26 | the integrator | the integrator (self-applied: orders' and M3's Imagery screens, the admin's budgets, the e2e tiering) | (a) The order card is a chunk of its own, fetched the first time a scene that must be bought, or one with an order, opens (`packages/ui/src/admin/imagery/orders/lazy-card.ts`: Loading until it is in, a failed fetch says so with Try again; `ImageryContext.refresh`, the page's `requestUpdate`, renders it once in), with its budget `order-card` 2 KB: with the buy flow inline the `imagery` chunk measured 18.2 KB against its 18 KB budget, now 17.6 KB (DECISIONS-for-review.md §56b). (b) The cross-app check is behaviour A48 (`e2e/admin/specs/imagery/automation.spec.ts`, rows `S-A48-HAPPY` and `S-A48-BAD-OVER-THRESHOLD`): the order card, I ordered it, the watch's delivery and import, the stand-in pipeline's automatic points, the auto-publish (or the wait for Approve), the inbox and the viewer's compare of the bought scan with an older layer; tiered with M3's publish specs (`IMAGERY_PUBLISH_SPECS`). (c) The local stack's seed (`npm run dev:stack`) gains an order to buy, an order watched, inbox items and a version with suggestions | the build stage's `bundle-budget` failed on `imagery`, and no workstream's spec crossed from the purchase to the viewer | done (2026-10-24) |

## Addendum (2026-10-24): the reviews' fixes

Two reviews of the built M4 (security and cost; minimum input and UX) changed the contract as below; the decisions and
the reasons are `DECISIONS-for-review.md` §57, the defects `docs/LESSONS.md` 203–218. The sections above stay as the
workstreams wrote them; where they differ, this addendum is the contract.

- §1.5, §1.7 (orders): the expired card offers Take the mark back besides Order it again; only an `expired` order counts
  in Work's "needs you", and a `reminder` wears the waiting tone (its note: an admin who paid has nothing to do); while
  `setup/status.usgs` is `pending` both cards carry `[data-state="waits-for-approval"]` with the link to Setup's USGS step
  and the next check reads `adminContent.orders.fact.afterApproval`; `apiError.usgs.alreadyAvailable` from I ordered it
  (a frame scanned meanwhile, whose card goes with the order) is also the snackbar's (`OrderActions.markOrdered`), and a
  refused mark moves the keyboard to the scene's heading (`ImageryContext.focusDetail`); times are in the admin's own time
  zone. Step one of the EarthExplorer guide no longer names a basket on the scene's
  page (UNVERIFIED: where the control is). Verified on 2026-11-08 by the owner's first order: the scene's page has
  Login and an Order button, no basket; the guide's four steps are now Login, Order, 7 Micron with Submit Product
  Selections, and USGS's form with 35 USD on pay.gov (the *Buy flow guide* above).
- §2.3, §2.5 (suggestions): `Decision.degenerate` of the pipeline: enough confident pairs that give no fit wait with
  `apiError.imagery.noSpread {pairs}`; the panel's view has `noSpread` (`adminContent.georef.suggestions.noSpread`); each
  pending row has `offsetM`, its distance from the page's live fit (`distanceFromFit` of `@hcm/shared`), and the
  matcher's stored `residualM` is no longer shown; Accept all focuses the panel's heading. The integration tests pin
  the largest distance from the truth (`EDGE_ERROR_M`, 30 m) besides the median (15 m).
- §3 (compare): a compact window hides the second map for `COMPARE_PARK_MS` (60 s) and destroys it then; a wider window
  within it shows the same map; `<hcm-compare>` keeps `.second` in toggle mode (`visibility: hidden`) and
  `mapContainer()` answers it in swipe mode only. `compareChoices` leaves out the main side's layers (or today) unless
  it is the side compared now.
- §4.1 (the editors): a draft answered after `reset` is dropped; a queued cell's wait ends after
  `GEOCODE_QUEUED_MINUTES` with `apiError.assist.unavailable`; `EditorAssistsDeps.untitled` decides when a place set asks
  by itself (the photo editor: empty, `isCameraName`, or the file's `suggested.title`); a draft is offered only for an
  empty side, and its note stays once it filled it.
- §4.2 (suggestTitle): `ops/assist` gains `queuedDay` and `queuedToday`; past `GEOCODE_DAILY_CAP` (300 a UTC day) the
  answer is `failed` with `apiError.assist.dailyCap`; a refused enqueue deletes the cell it claimed; the worker's
  cool-down keeps the count.
- §4.3 (translateDraft): a draft with a link address the source lacks is `apiError.assist.linksChanged`
  (`draftKeepsLinks`, `linkTargets` of `@hcm/shared`).
- §4.4 (IAM): `fn-admin@` gets the custom role `hcmVertexDrafts` (`VERTEX_DRAFTS_PERMISSIONS`:
  `aiplatform.endpoints.predict`), which the `iam` item makes, undeletes or corrects before binding it, instead of
  `roles/aiplatform.user`; `apiError.cloud.permission` names it.
- §5.2, §5.3 (notifications): `layer.needsPoints` is pushed by default; `order.imported` says the scan is imported into
  a layer version; the inbox is pruned by `DocumentStore.count` and a read of its items over the limit only.
- §5.4 (push): the browser's record is `{uid, deviceId}` under `hcm:admin:pushDevice`; sign-out unregisters it
  (`AuthControllerDeps.leaving`); `notify.registerDevice` deletes the same device id from every other admin;
  `admins.revoke` deletes the removed admin's `pushDevices`, `inbox` and `notify/settings` before `admins/{uid}`; a failed
  Off keeps push on.
- §9: Nominatim's guard gains the daily cap; Firestore's line holds (a count and the overflow per event and admin);
  compare's line: one extra map load per compare session, reused across window changes within a minute.
- §10 gains: "`aiplatform.endpoints.predict` is all `generateContent` and `countTokens` of a publisher model need",
  proved by the setup self-test's `ai` check after Provision.

## Addendum (2026-11-01): why push did not start, and a stale registration made again

Finding 46 of `docs/research/manual-test-2026-10-25.md` (the live test of 2026-11-01; `DECISIONS-for-review.md` §79e).
Where it differs from §5.4, this addendum is the contract.

- §5.4 (push, the browser): a registrar's failure is a `PushFailure` with a short code (the SDK's `FirebaseError.code`,
  or `push/…`), and the inbox shows, under "Notifications did not start: …", a reason line per family with that code
  (`adminContent.notify.push.reason.*`, both languages; `packages/admin/src/inbox/push-failure.ts`); the log gets the
  code and the SDK's text with ids, tokens and keys replaced. `PushRegistrar` gains `reset()`: it forgets the FCM SDK's
  IndexedDB record of the registration (`packages/admin/src/firebase/fcm-record.ts`), which `register()` otherwise
  trusts for seven days whatever worker or push subscription it was made with; the record is also forgotten right after
  the root's worker of an admin before M6 is retired.
- §5.4 (push, the server): `notify.registerDevice` refuses with `apiError.notify.deviceInvalid` and `reason`, FCM's code
  (`UNREGISTERED`, `INVALID_ARGUMENT`, the status, or `HTTP_<status>`), logged without the token; `PushSender.validate`
  returns `{ ok: true } | { ok: false, reason }`. On that refusal the admin resets the registration and registers once
  more; a second refusal is shown with `fcm/<code>` (`fcm/UNSPECIFIED` from an older server).
- §7.1 gains S-A47-HAPPY-RENEWED, S-A47-BAD-FCM-REFUSED-REASON, S-A47-BAD-SDK-CODE and S-A47-BAD-FCM-REASON-NAMED; §7.3
  the tour state `notify.push-failed-reason`; §8: the fake FCM's scenario `fcm.everyTokenGone`, and the `e2e` stand-in's
  `reset` (a new token, `…-browser-0002`) and `?pushFail=<code>`.
- §10 gains: which refusal the live failure of 2026-11-01 was, the auto-created browser key's API restrictions
  (Installations and FCM Registration), and the default VAPID key with `register()`: the reason line of the next live
  try names it.

## Addendum 2026-11-01: the drafts' model (`DECISIONS-for-review.md` §67g)

- §4.3, §4.4: `VERTEX_MODEL_ID` is the first of `VERTEX_MODEL_IDS` = `gemini-3.5-flash-lite` (stable since 2026-07-21,
  retirement no earlier than 2027-07-21), `gemini-3.1-flash-lite`; `gemini-2.5-flash-lite` was retired in October 2026.
  `assist.translateDraft` and the self-test's `ai` check call through `withOfferedModel` (`functions/src/api/vertex-models.ts`):
  the models in order, a 404 moving to the next, the choice kept ten minutes per instance; the check names the model in
  use (`params.model`), and a project offered neither gets `apiError.assist.modelUnavailable` naming both. The answer's
  `model` is the model that drafted. Rows S-A45-HAPPY-FALLBACK-MODEL, S-A45-HAPPY-MODEL-NAMED; the fake Vertex AI's
  scenario `vertex-ai.firstModelUnavailable`. The price constant and the custom role are unchanged.

## Addendum of 2026-11-06: §1.5, an order and its ended import

A freed scene drops its import's order (`imported` or `importing`): not back to `delivered`, which the watch would import again within
five minutes; a scene USGS delivered and with no order is `available`, whose Import is the admin's own click. A failure keeps the scene
and its order until the version is dismissed (`docs/research/M3-interfaces.md`, its addendum of the same date).
