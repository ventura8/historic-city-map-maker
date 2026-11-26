# M22: Help calibrate (design and contract)

The owner, 2026-11-09: "for hard to import photos and drawings and maps, help the admin help the app to calibrate them!!!!"

This is the design and, since 2026-11-09, the contract of what is built: what landed is in §13 (the as-built sections win over the design where they differ). The owner, the same day: "for the data in harti.zip ... make sure we stitch them together for the admin, and we do this in our pipeline in our app; and make a nice setup wizard for what needs help from admin to place those maps on our app". No cloud project, Mapbox or Chrome is touched. The reference data is OpenStreetMap and Sentinel-2 only, never Mapbox Satellite. The approval guard (`functions/src/imagery/approval.ts`, M9 §11), the held-out checks (M9 §7), `RECALIBRATE_MIN_GAIN_M` (M16 §1) and every gate in `calibrate/proof.py` stay exactly as they are. A help session makes the pipeline's own proof succeed sooner. It never relaxes the proof.

## 0. What exists, and what this adds

Today the admin can help in five ways: pairs in the georeferencer, pairs used as the starting guess (M9 §7, `_seedable` needs 3 or more pairs), the suggestions panel (M4 §2.5), Locate again (a blind retry), and Recalibrate → *Place rough points* (M16, only for a version that already has a fit). For photos there are the pin, the direction click, the field of view, EXIF and the `checkPlace` chip. Every hard case ends in the georeferencer as *Needs points*. There is no way to give the app a coarse hint, no queue ordered by what matters, and nothing for drawn maps, sheet series or photos without a place.

M22 adds three things:

1. **One queue, *Help calibrate*.** It lists every item that waits for a person. *What needs you* on Home links to it. Items are ordered by value, and each has a one-line reason (§1).
2. **A guided flow per item.** It asks for the least input first and lets the pipeline do more after each answer: **A rough placement → B confirm the app's pairs → C one more point here**. A live quality meter runs throughout. The flow stops as soon as the guard's figures hold, and the result waits for Approve as every hand-assisted version already does (§2). Drawn maps, sheet series and ground photos each get a variant (§3, §4, §5).
3. **A prior-aware matching job, `help-match`.** It takes the admin's rough placement as the starting guess and returns candidate pairs with confidences and an uncertainty map. It runs on the local worker (GPU first, then CPU). Its dense and OSM parts also run on Cloud Run (§6).

## 1. The queue

### 1.1 What enters it

The queue is computed from the documents that already exist. It is not a stored list, so it cannot fall out of step with them. A shared pure function, `helpItemsOf(...)` in `packages/shared/src/help/queue.ts`, reads:

| Source | Condition | Reason code | One line (en) |
| --- | --- | --- | --- |
| `layerVersions` | `state == 'needs_gcps'` and `calibration.how == 'none'` with `why: 'no-votes'` | `notFound` | The city was not found on the frame. |
| same | `calibration.why == 'noSpread'` | `noSpread` | Matches were found only in one corner of the frame. |
| same | `calibration.why == 'small-window'` (fewer than `PROOF_MIN_INLIERS` tiles possible) | `smallWindow` | The frame is too small or too rural for the automatic check. |
| same | `calibration.why == NO_LOCAL_AI` (the frame ran on Cloud Run) | `aiUnavailable` | The AI on your computer has not looked at it yet. |
| `layerVersions`, `source.kind == 'upload'` | no embedded georeference, `content == 'drawn'` | `drawnNoRef` | A drawn map with no coordinates. |
| same | `content == 'drawn'` and the street check refused (§3) | `drawnUnmatched` | A drawn map: its streets were not matched to today's. |
| same | `content == 'photo'` (an aerial print scanned to JPG or TIFF), no georeference | `scanNoRef` | A scan with no coordinates. |
| `layerVersions` | `state == 'awaiting_approval'`, `measuredPct < 70` or `checksDropped > 0` | `weakFit` | Placed, but parts of it are not proved. |
| `layerVersions`, `series` set | a neighbour of a calibrated sheet that has no fit (§4) | `sheetNeighbour` | The next sheet of a series you already placed. |
| `photos` | `location` missing | `photoNoPlace` | A photo with no place. |
| `photos` | `location` set, `bearing` missing | `photoNoDirection` | A photo with no direction. |
| `photos` | `checkPlace == true` (EXIF outside the city, or the place was questioned) | `photoCheckPlace` | The photo's place is in doubt. |

An item that already has an open help session shows *In progress by {name}*. The `placingPoints` lock (`packages/admin/src/georef/placing.ts`) is reused unchanged, so the automatic re-search (M18 §3) still waits while a person works.

### 1.2 Value order

`helpValue(item, city)` in `packages/shared/src/help/value.ts` is pure, has unit tests and uses no wall clock. The time spent waiting comes from `createdAt` relative to the query's `now`, which is passed in.

```text
imagery:  value = 100 × newAreaShare × yearGapWeight + 10 × sheetBonus + waitingDays (max 30)
photos:   value =  40 × yearGapWeight + 20 × (linked from a story or a place) + 5 × (has a title) + waitingDays (max 30)
```

- `newAreaShare` is the share of the item's footprint that lies inside the city's area and is not covered by any published layer of the same decade. The footprint is the USGS corners, the uploader's rough box, or the prior. It is computed from the layers' bounding boxes in the manifest state, so it costs no extra read per item.
- `yearGapWeight = min(1, gapYears / 20)`, where `gapYears` is the distance to the nearest published layer year (imagery) or the nearest photo year in a 300 m cell (photos). A 1955 frame scores 1 when the nearest layer is 1980.
- `sheetBonus = 1` when a neighbouring sheet of the same series is already calibrated, because it is cheap to finish.

The queue shows the top 50, plus a filter by kind (aerial, drawn, sheet, photo) and by reason. The ordering is a `sort` over the loaded documents. The queries are the existing `needs_gcps` and `awaiting_approval` ones, plus `photos where location == null` (a Firestore `==` null query, which needs an index: `firestore.indexes.json`).

### 1.3 Home

`HOME_COUNTS` (`packages/admin/src/home/home.ts`) gains `helpCalibrate`. It is the sum of the counts that already exist (`versionsNeedingPoints`) and two new aggregations, `photosUnplaced` (`location == null`) and `photosNoDirection` (`location != null && bearing == null`, a composite index). *What needs you* shows **Help calibrate: {n}** with a link to `#/help`. The existing *Needs points* line folds into it, so there is one line instead of two. Readers: owner and editor. An uploader sees only their own photos (`firestore.rules`), so the photo counts are not asked for that role (the existing `READERS` map).

### 1.4 The page

`#/help` is `<hcm-help-page>` (`packages/ui/src/admin/help/hcm-help-page.ts`). It is a list built on the existing `<hcm-list>` row pattern from `hcm-admin-photo-list.ts`. Each row shows a thumbnail (the scan's preview or the photo's 400 px WebP), the title, the reason line, the value as a short label (*Fills 1955 · 34 % new area*) and one button, **Help**. On a phone-width or tablet portrait screen the row stacks. The page has no map, so it costs no Mapbox load.

## 2. The guided flow for an aerial frame or a scan (`#/help/{versionId}`)

`<hcm-help-session>` (`packages/ui/src/admin/help/hcm-help-session.ts`) is a three-step flow with a stepper at the top. It is built from the georeferencer's existing parts:

- the scan pane: `hcm-scan-viewer.ts`, `scan-draw.ts`, `scan-view.ts`;
- the map: `georef-map.ts`, with the OSM-lines or Sentinel-2 backdrop and never Satellite;
- the warp preview: `warp.ts`, `fit-view.ts`;
- the residual table: `residual-table.ts`;
- the suggestions UI: `suggestions-panel.ts`, `suggestions.ts`, generalised into candidates.

There is one Mapbox map per view, the same as the georeferencer's.

### 2.1 Step A: rough placement (1 to 3 inputs)

The scan is laid over the map, semi-transparent (opacity slider, 50 % by default) and warped by an affine `prior` that the admin changes directly:

- **Pointer or touch:** drag to move. Two fingers pinch to scale and twist to rotate (`pointerdown` with two active pointers). The handles on the corners scale, and the handle on top rotates. **Flip** mirrors (a mirrored print). **Rotate 90°** turns by a quarter.
- **Alternatively, two matching places:** click a place on the scan, then the same place on the map, twice. This gives a similarity transform (translation, rotation, scale) with no shear. One pair plus *north is up / left / down / right* gives a similarity whose scale comes from the sensor's nominal ground size (`imagery-plan.ts` sensor table) or, for uploads, from the uploader's rough box.
- **Starting position:** the USGS corners when they exist. Otherwise it comes from the upload's rough box: the upload panel gains an optional *Draw roughly where it is* rectangle, the same rectangle tool as New city (M5). Otherwise it is the city's centre at the sensor's scale.

The prior's uncertainty is estimated, not asked for. It is `max(300 m, 0.08 × footprint diagonal)` after a direct placement, and `max(300 m, 0.15 × diagonal)` after one pair plus an orientation. It is capped at 3 km (the vote search's own scale).

**Find the rest** sends the prior (`calibrate.helpRound`, §6.2) and shows *Searching around your placement… (AI on your computer: graphics card)* together with the worker's `ai.state` (`<hcm-worker-panel>` text reused). Expected time: 15 to 40 s on the GPU, 2 to 8 min on the CPU (§6.4). The admin can leave the page. The session continues and the queue row reads *Searching*.

If the round comes back **proved**, the dense proof held within the prior under the unchanged gates. The flow jumps straight to *Done* (§2.4), so a good placement plus one click is the whole job.

### 2.2 Step B: confirm (one key per pair)

When the round is not proved but returns candidates, the app shows them **one at a time, best first**. The scan crop (256 px around the candidate) sits beside the map crop (the same ground size, OSM lines or Sentinel-2 as chosen), each with a crosshair. Below them are the candidate's confidence as **high / medium / low** (the existing `suggestions.ts` bands) and *how far it is from the current fit*.

| Answer | Key | Touch | Effect |
| --- | --- | --- | --- |
| Yes, same place | `Y` or `Enter` | **Yes** button | becomes a pair (`origin: 'confirmed'`) |
| No | `N` | **No** | kept as a rejection; the next round excludes this crop and lowers its neighbours |
| Skip | `S` or `→` | **Skip** | unanswered; it can come back later |
| Nudge | arrow keys with `Alt` (1 px), `Alt+Shift` (10 px) on the focused side | drag the crosshair | Yes then saves the nudged pixel |
| Back | `←` or `Backspace` | **Back** | undoes the last answer (the existing `undo.ts` pattern) |

After each Yes, the fit is refitted in the browser (`warp.ts` and the existing `fit()` port) and the warp preview updates. After 3 Yes answers, or when the candidates run out, the next round starts by itself with the new pairs as the start, which narrows the margin to `max(150 m, 3 × leave-one-out RMSE)`.

At most `HELP_MAX_CANDIDATES` (12) candidates are shown per round. Candidates are spread over the frame: no two within one 8×8 cell until every cell has had one.

### 2.3 Step C: one more point here

When candidates are few or keep being rejected, the round's **uncertainty map** marks the cell where the fit is least certain (§6.3). The flow outlines it on both sides and asks: *Click one place in this area on the scan, then the same place on the map.* On the map side, a click **snaps to the nearest OSM junction within 25 screen px** (§3.2). Snapping is shown as a ring and can be undone with `Alt`-click, or with a long press on touch. On the scan side, a click snaps to a detected junction when one is within 12 px. That is the drawn-map detector (§3.2), which runs on every scan, aerial or drawn.

### 2.4 The meter and stopping

A **quality meter** stays visible in the session header:

- **Held-out error.** The round's `heldOut.rmseM` over `heldOut.checks` checks: dense tiles from the pipeline, never from the fit (M9 §7). Between rounds it shows the browser's leave-one-out estimate, labelled *estimate* and greyed.
- **Proved share.** `measuredPct`, with a bar that turns green at 70.
- **What the guard needs.** A short list that changes from *needs* to *ok* line by line, read from the same `guardChecks(fig)` as `approval.ts`. That function is extracted into `@hcm/shared` so the meter and the approval cannot disagree: dropped checks 0, proved share ≥ 70, held-out checks ≥ `RECALIBRATE_MIN_CHECKS`, coverage ≥ 90 % (USGS).

**Stop rule.** When every line reads *ok*, the flow says *That's enough: the app can take it from here* and shows **Finish**. The admin may keep going, but the flow no longer asks for anything.

**Finish** calls `calibrate.helpFinish`. It makes a `regeoref` version with `method: 'gcps'`, the session's pairs (confirmed and clicked), the pipeline's held-out checks as disabled pairs, and `help: { sessionId, inputs }`. The `georef` step then runs as today: `_seedable` with the help seed (§6.5), followed by the dense check.

**Publishing does not change.** Hand points still mean *waits for Approve* (M9 §11). The approval page shows the meter's last figures and the session's input count. The flow never publishes and never offers *accept worse*. On a version that already had a fit (a `weakFit` item), the route is M16's `points`, so `RECALIBRATE_MIN_GAIN_M` decides as before.

If the guard never holds (a featureless frame), **Save as it is** keeps today's path: the hand points are saved and wait for Approve with the figures shown in red.

### 2.5 Locate again with a hint

The *Needs points* card (`calibration-card.ts`) and Locate again gain **Help it find this**, which opens Step A directly. *Locate again* stays the blind retry.

## 3. Drawn maps and scans without coordinates

### 3.1 Upload

- `upload-panel.ts` accepts `.tif,.tiff,.jpg,.jpeg,.png` (the cap stays `UPLOAD_MAX_BYTES`). `upload.ts` stores the real content type. The pipeline's `crop` reads JPG and PNG through GDAL (already in the image) and writes the same cropped TIFF it writes today.
- The upload source (`imagery.ts` `sourceSchema`, `kind: 'upload'`) gains `content: z.enum(['drawn', 'photo']).default('photo')` and `roughBox: boundsSchema.optional()`. The panel asks *Is it a drawn map or a photograph from above?* as two large choices, one input. *Draw roughly where it is* is optional.
- A drawn map without a georeference enters `help` directly (`drawnNoRef`) instead of `wait_for_points(0)`.

### 3.2 Junctions on both sides

- **Map side.** `osm.py` already keeps the window's Overpass answer as GeoJSON. A new `osm_junctions(geojson)` returns the nodes shared by 3 or more highway or railway ways, plus the points where a way crosses a waterway (bridges). They are stored once per city window as `reference/junctions.json` (about 30 to 80 KB for Bucharest's window, gzipped), next to `reference-osm.png`. The browser loads it once per session for snapping and for the landmark list.
- **Scan side.** In `help-match`, a drawn map's lines are extracted with an adaptive threshold, a thinning (OpenCV `ximgproc.thinning`, or a Zhang-Suen in numpy when the contrib module is missing), and the nodes of degree 3 or more. The result is up to 2,000 junctions with their degree and their branch angles, returned as `scanJunctions` in the round (about 40 KB). The same detector feeds snapping on the scan side.

### 3.3 Matching a drawn map: lines, not texture

For `content == 'drawn'`, `help-match` matches **street graphs, not Sentinel-2 texture**:

1. The scan's thinned lines and the window's OSM line raster (`reference-osm.png`, 10 m grid) are both distance-transformed. Within the prior's margin, a chamfer search over scale ±15 %, rotation ±10° and translation is seeded by the prior and finished with an affine refinement by ICP on the junctions (junctions matched by degree and branch angles, RANSAC, at least 8 inliers).
2. A local warp: with 10 or more spread junction pairs, the matched junctions also give a tps proposal for a distorted sheet. tps is still never automatic. It is offered as *This sheet looks bent; try the bending fit*, and the admin's one click chooses it.
3. Candidates for Step B are junction pairs, shown as crops as usual.

**The street check (new, drawn maps only).** The dense check after the points (`measured_on_scan`) compares against Sentinel-2, which a drawn map nearly always fails. A drawn map is checked instead by `lines_on_scan`, which uses held-out junction pairs. These are junctions matched by the graph search, never by the fit, and kept out of it. It reports `heldOut.rmseM`, `measuredPct` (the share of 8×8 cells holding a held-out junction within `2 × rmse`) and `checksDropped`.

**Gate.** The values do not change: the meter's guard lines use the same numbers. The check's kind is recorded as `checkpointKind: 'held-out-lines'`. Because the approval guard requires method `auto`, a drawn map never publishes itself in any case. It always waits for Approve, which is the existing rule for uploads.

### 3.4 Match by landmark

For a sheet with few legible streets, the flow offers **Match by landmark**. It is a searchable list of named OSM features in the window, fetched in the same Overpass call and kept in `reference/landmarks.json`:

- `amenity=place_of_worship` with a name (churches);
- `place=square` and named `highway=pedestrian` areas;
- `historic=*` and `building=*` with `wikidata`;
- bridges over the Dâmbovița;
- **river bends**: points of maximum curvature along `waterway=river` with a name, labelled *Dâmbovița, bend near {nearest named street}*.

The admin picks one from the list (typing filters it, with ro diacritics folded: `ă`→`a`) and clicks it on the scan. That counts as one pair. On the map side its position is exact, with no click needed.

Two landmarks give a similarity prior, the same as Step A's *two places*, so a hard drawn map can start with **2 picks and 2 clicks**.

## 4. Sheet series

- An upload can carry a `series: { name, sheet: 'row,col' | label }`. A batch of sheets uploads with the existing multi-file chooser and a name pattern (`plan-1911-{r}-{c}.jpg`) to fill the series.
- When one sheet of a series has a fit, `help-match` (kind `neighbours`) proposes each neighbour's prior: the placed sheet's affine, shifted by one sheet width or height in the sheet's own axes. It checks that guess against the neighbour's edge overlap (a line-chamfer on the shared border strip, 5 % of the width) and puts it in the queue as `sheetNeighbour` with **Check this placement**.
- For a neighbour, Step A is already done. The admin opens it, sees the overlay and presses **Find the rest**. Typical cost: 1 to 2 inputs per further sheet.
- Printed grid lines and coordinate labels: **not in M22** (left for later, §11). The edge overlap already gives most of the benefit.

## 5. Ground photos without a place or direction

`#/help/photo/{photoId}` is `<hcm-help-photo>`. It reuses `editor-place.ts`'s map, the pin and the cone, and `assists.ts`.

1. **Roughly where?** The photo on the left, the map on the right. The admin can click the map, type a street (Nominatim through the existing assist port, limited to the city's box; a place outside it is refused, as today) or press **Same place as another photo**. That opens a picker of nearby photos by title, year and thumbnail, and copies `location` (and `bearing` if the admin keeps it).
2. **Which way was the camera facing?** A cone at the pin. The admin drags its tip, or uses the arrow keys to turn it 5° (`Shift` 1°) and `+` / `-` for the field of view. **Point at map centre** stays.
3. **Hints**, each one tap to accept, none applied without the tap:
   - *From the text:* the title, the description and the EXIF `ImageDescription` are parsed for street names and landmarks that match `landmarks.json` and the junctions' street names, all locally in the browser. A hint reads *"Calea Victoriei" mentioned: 3 places on that street*.
   - *From EXIF:* place and direction (existing `autofill.ts`).
   - *Nearby photos of the same building:* other placed photos within 400 m of the rough pin whose AI image embedding is close (§6.6). *Looks like "Palatul Telefoanelor, 1935" (facing NE)*. Tap to copy the direction.
   - *Likely direction from the streets:* given the pin, the local worker (`help-match` kind `photo-direction`) detects the vanishing lines in the photo, which give the street's direction relative to the camera axis. It then lists the OSM street bearings within 60 m of the pin and keeps the bearings consistent with them. With the building outlines (`building=*` from the same Overpass cache), it keeps only the bearings that see buildings at the distances the photo suggests. The answer is up to 3 bearings with a confidence. The cone shows them as faint arcs, and `1`, `2` or `3` accepts one.
4. **Done** saves `location`, `bearing` and `fov` through the existing `photos.update` path, so the same rules apply.

A photo help session never needs the GPU. Embeddings and vanishing lines run on the CPU in under 5 s. Without a worker, the text, EXIF and neighbour hints still work: only *Likely direction* and *same building* need the worker.

**Unplaced triage.** The queue filter *Photos* lists them by value. **Next** (`J`) moves to the next item without going back to the list, so a run of photos takes 2 to 4 inputs each.

## 6. What the pipeline and the worker expose

### 6.1 Job type `help-match`

`JOB_TYPES` gains `'help-match'`. It is queued only by `calibrate.helpRound`, never by a client write, like `layer-join`. It has one step, `help`, whose parameters are:

```ts
helpMatchParamsSchema = z.strictObject({
    sessionId: idSchema,
    round: z.number().int().min(1).max(HELP_MAX_ROUNDS),          // 20
    kind: z.enum(['frame', 'drawn', 'neighbours', 'photo-direction', 'photo-similar']),
    prior: z.strictObject({ matrix: affineSchema, mirrored: z.boolean(), uncertaintyM: z.number().min(50).max(3000) }).optional(),
    pairs: z.array(gcpSchema).max(200),           // confirmed and clicked so far
    rejected: z.array(pixelSchema).max(500),      // the scan pixels the admin said No to
})
```

**Where it runs.** The job is claimed with `priority: 'interactive'`. `worker.claim` takes interactive jobs before batch ones, and a long `locate` in progress is not interrupted, so the help round waits for the next free slot. The admin sees *waiting for your computer to finish {job}*.

On Cloud Run, `frame` and `drawn` run without the AI (the dense and line parts only). `photo-*` and the AI proposals need the local worker, and the round says so with `ai: 'unavailable'`. This follows M10: no remote model, ever.

**What it does, for `kind: 'frame'`.** This is the existing chain with the admin's start in front:

1. `prove_map(search, reference, start=prior)` (`chain.py:125`), searching the prior's `uncertaintyM` instead of the pass prior's 12 km margin. This is the same proof with the same gates. A prior is used as a hypothesis exactly like `_from_prior` (`chain.py:89`), placed first.
2. If not proved, the local AI runs on a `ProposalRequest` with `starts=(prior, prior ∘ R90 …)`, the prior first, and `margin_m = uncertaintyM`. **This gives the AI its second chance, which `locate` never gave it**: the `run.left` limit does not apply, because a help round has its own budget of 2 proofs.
3. Whatever is proved or not, candidate pairs come from the dense tile matches (`calibrate/dense.py`) under the best transform so far (the prior refitted with the admin's pairs). The candidates are each tile's peak, its margin and its agreement with the fit, mapped to high / medium / low by `suggestions.ts`'s bands, plus OSM junction pairs where a junction lies within the tile.

### 6.2 Callables (`functions/src/calibrate/`)

| Callable | Who | Does |
| --- | --- | --- |
| `calibrate.helpStart({ itemRef })` | owner, editor (photos: also the photo's uploader) | creates `helpSessions/{id}` and takes the `placingPoints` lock |
| `calibrate.helpRound({ sessionId, prior?, answers[] })` | the session's admin | records the answers, queues `help-match` round n+1; refused while a round runs (`apiError.help.roundRunning`) |
| `calibrate.helpFinish({ sessionId, transform })` | the session's admin | makes the `regeoref` version (or the M16 `points` recalibration), or saves the photo's fields; ends the session |
| `calibrate.helpLeave({ sessionId })` | the session's admin, or an owner | releases the lock; the session is kept as `left` |

All four callables run the same rate limit as `imagery.saveGcps` and use App Check as the other callables do.

### 6.3 What a round writes (`helpSessions/{id}/rounds/{n}`, by `worker.step` only)

```ts
helpRoundDocSchema = z.strictObject({
    status: z.enum(['running', 'done', 'failed']),
    proved: z.boolean(),
    transform: affineOrPolySchema.optional(),
    candidates: z.array(z.strictObject({ id, pixel, geo, confidence: z.enum(['high','medium','low']), offM: z.number(), source: z.enum(['dense','ai','junction','landmark']) })).max(24),
    uncertainty: z.strictObject({ cols: z.literal(8), rows: z.literal(8), metres: z.array(z.number().nullable()).length(64) }),   // per cell: 95th percentile of the fit's error by bootstrap over the pairs; null = no data
    figures: z.strictObject({ heldOutRmseM, checks, measuredPct, checksDropped, coveragePct, kind: z.enum(['held-out','held-out-lines']) }).optional(),
    scanJunctions: z.string().optional(),       // signed path in the private bucket, drawn only
    directions: z.array(z.strictObject({ bearing, confidence })).max(3).optional(),
    proposer: proposerSchema.optional(),        // M10's record, display only
    ai: z.enum(['gpu', 'cpu', 'unavailable']),
})
```

The **uncertainty map** comes from 50 bootstrap refits of the current pairs, plus held-out tiles: per 8×8 cell, the 95th-percentile displacement. Step C asks in the worst cell that still has texture or junctions, never in an empty cell such as water or a featureless field.

### 6.4 Costs

| Round | Bytes up or down | Compute (GPU / CPU) |
| --- | --- | --- |
| `frame`, first round (cold) | the preview and references are already in the worker's local store (M7); download 0 when the frame was located there, otherwise one scan read (the existing `worker.urls` signed URL, 20 to 200 MB once per session) | dense proof 10 to 20 s CPU; AI 15 to 30 s GPU, 2 to 8 min CPU (2 orientations, M10 budgets) |
| later rounds (warm) | under 50 KB (the round document) | dense under 10 s; AI only if not proved, around a narrower margin, 10 to 15 s GPU |
| `drawn` | `junctions.json` 30 to 80 KB once per window; `scanJunctions` 40 KB | thinning plus chamfer 5 to 20 s CPU, no GPU needed |
| `photo-direction` | the photo's 1600 px WebP, about 300 KB | under 5 s CPU |
| Firestore | one session document, one document per round (at most 20), answers inside the session (at most 500) | about 25 writes per session |

Cloud Run (no AI) bills only the dense part, well inside M7's free-tier meter. Mapbox: one map per session view, the same as the georeferencer. Nothing is published to MTS until Approve.

### 6.5 The seed

`_seedable` (`steps/georef.py:262`) gains one path. A version with `help.sessionId` and a stored session transform uses that transform as the seed, **however few the pairs**. A session can finish on 1 or 2 confirmed pairs plus the round's proved transform. The dense check searches `max(600, min(3 × heldOutRmse, 2000))` m around it, as today. Without a session, the 3-pair minimum stays.

### 6.6 Photo embeddings

`photo-similar` embeds each placed photo once with a small open image model in the matcher's sidecar (the same delivery as M10: digest-pinned, `--network none`, weights licence checked before landing; **owner's decision on the model**). It runs in the background on the worker. The vectors (256 float16 = 512 B per photo) are stored in the worker's local store only and **never uploaded**. A neighbour query returns photo ids only. Until the owner chooses a model, *same building* falls back to text and year matching.

## 7. The data model, rules and audit

```ts
// helpSessions/{sessionId} (city-scoped: cities/{city}/helpSessions)
helpSessionDocSchema = z.strictObject({
    item: z.discriminatedUnion('kind', [ { kind: 'version', versionId }, { kind: 'photo', photoId } ]),
    reason: helpReasonSchema,                   // §1.1's code at the start
    by: uidSchema, startedAt, endedAt?,
    state: z.enum(['open', 'finished', 'left', 'expired']),     // expired: 24 h with no round, lock released by imagery.tick
    prior: priorSchema.optional(),
    answers: z.array(z.strictObject({ candidateId, round, answer: z.enum(['yes','no','skip']), nudged: pixelSchema.optional(), at })).max(500),
    clicks: z.array(z.strictObject({ pixel, geo, snapped: z.enum(['junction','landmark','none']), landmarkId?: z.string(), at })).max(50),
    inputs: z.number().int(),                   // every human input, for the budget and the approval page
    outcome: z.strictObject({ versionId?, figures? }).optional(),
})
```

- **Rules.** Read: owner and editor of the city; an uploader only for their own photos' sessions. Write: **none from clients**. Every change goes through the callables or `worker.step`. Rounds are read under the same roles and written by `worker.step` only, which refuses a write to a session that is not `open`. The rules tests gain the allow/deny matrix rows for both collections.
- **Kept for audit and retraining.** Answers and clicks stay with the session, deleted with the layer (M18 §5's single Delete). A Yes, No or nudge is a labelled pair for a later matcher evaluation. An export, `reports/calib/help-pairs.jsonl`, is produced by the worker on demand, **locally only**. Nothing is sent to any model provider.
- **Privacy.** The sessions hold no personal data beyond the admin's uid. Photos' text hints are computed in the browser.

## 8. i18n (`packages/shared/src/i18n/admin-help/{ro,en}.ts`, a new catalogue)

There are around 70 keys. The main ones:

| Key | en | ro |
| --- | --- | --- |
| `help.title` | Help calibrate | Ajută la calibrare |
| `help.home` | Help calibrate: {n} | Ajută la calibrare: {n} |
| `help.reason.notFound` | The city was not found on the frame. | Orașul nu a fost găsit pe cadru. |
| `help.reason.drawnUnmatched` | A drawn map: its streets were not matched to today's. | O hartă desenată: străzile ei nu s-au potrivit cu cele de azi. |
| `help.reason.photoNoPlace` | A photo with no place. | O fotografie fără loc. |
| `help.stepA` | Place it roughly | Așază-o aproximativ |
| `help.stepA.hint` | Drag, pinch or turn the image until it roughly covers the right place. | Trage, apropie sau rotește imaginea până acoperă aproximativ locul potrivit. |
| `help.findRest` | Find the rest | Găsește restul |
| `help.stepB` | Is this the same place? | Este același loc? |
| `help.yes` / `help.no` / `help.skip` | Yes / No / Skip | Da / Nu / Sari peste |
| `help.stepC` | One more point here | Încă un punct aici |
| `help.enough` | That's enough: the app can take it from here. | Ajunge: aplicația se descurcă de aici. |
| `help.meter.estimate` | estimate | estimare |
| `help.landmark` | Match by landmark | Potrivește după un reper |
| `help.photo.where` | Roughly where was it taken? | Unde a fost făcută, aproximativ? |
| `help.photo.facing` | Which way was the camera facing? | Încotro privea aparatul? |
| `help.photo.samePlace` | Same place as another photo | Același loc ca altă fotografie |
| `help.ai.searching` | Searching around your placement… ({device}) | Caut în jurul așezării tale… ({device}) |
| `apiError.help.roundRunning` | A search is already running for this item. | O căutare rulează deja pentru acest element. |

Every key exists in both `ro` and `en` (the i18n parity gate). The landmark list folds diacritics for search but shows OSM's own names.

## 9. Accessibility, laptop and tablet

- **Keyboard end to end.**
  - Step A: with the overlay focused, the arrows move it (`Shift` ×10), `[` and `]` rotate 1°, `+` and `-` scale 1 %, `F` flips, `R` turns 90°.
  - The map side of a pair: the new `MapCursor` keyboard mode gives a visible crosshair that the arrows move by 1 screen px (`Shift` 10). `Enter` places and snaps. This closes survey gap C.6.
  - Step B: `Y`, `N`, `S`, `←` and `Alt`+arrows, as in §2.2.
  - Every shortcut is listed under `?` and mirrored by visible buttons, so nothing depends on a key alone.
- **Screen reader.** One polite live region per session announces:
  - a round's result: *"Round 2: proved 62 %, error 14 m, 8 candidates"*;
  - each candidate: *"Candidate 3 of 8, high confidence, 6 metres from the fit. Scan: near the river bend. Map: Splaiul Independenței and Strada Sfântul Vineri junction."* The map side's nearest junction or landmark name serves as the text alternative of a crop;
  - a snap: *"Snapped to Calea Victoriei and Strada Lipscani junction."*

  The meter is a `role="meter"` per line, with `aria-valuetext` in words.
- **Tablet.** Two-finger pinch and twist on the overlay with `touch-action: none` on the overlay only, so the page still scrolls. Long press undoes a snap. Targets are at least 44 px (the tour's target-size checker). On landscape tablets, Step B's crops sit side by side. On portrait and phone width they stack, with the buttons in a bottom bar clear of Mapbox's legal line (the occlusion checker).
- **Contrast.** The overlay opacity slider has a high-contrast option that tints the scan, and the uncertainty cell outline is double-stroked (dark and light) so it reads on both OSM lines and Sentinel-2.

## 10. Tests: scenarios, tour, input budgets

**Scenario rows** (`e2e/scenarios.json`, next ids after S-A100 and S-P19):

| Id | Behaviour |
| --- | --- |
| S-A101-HAPPY-HELP-QUEUE / S-A101-BAD-QUEUE-EMPTY / S-A101-BAD-COUNT-FAILED-SHOWN | the queue, its order and reasons; Home's line |
| S-A102-HAPPY-ROUGH-PLACE-PROVED / S-A102-BAD-PRIOR-WRONG-REFUSED | Step A, then the fake worker proves; a wrong prior is refused by the proof (no false accept) |
| S-A103-HAPPY-CONFIRM-KEYS / S-A103-BAD-ALL-REJECTED-ASKS-POINT | Step B by keyboard only; all No leads to Step C |
| S-A104-HAPPY-ONE-MORE-POINT / S-A104-BAD-SNAP-UNDONE | Step C with a junction snap; Alt-click unsnaps |
| S-A105-HAPPY-GUARD-STOPS / S-A105-BAD-SAVE-AS-IS-WAITS | the stop rule; *Save as it is* waits for Approve with red figures |
| S-A106-HAPPY-DRAWN-UPLOAD-JPG / S-A106-BAD-DRAWN-NO-STREETS | a JPG drawn map enters help; a blank sheet ends at *Save as it is* |
| S-A107-HAPPY-LANDMARK / S-A107-BAD-LANDMARK-OUTSIDE | match by landmark; a landmark outside the window is not listed |
| S-A108-HAPPY-SHEET-NEIGHBOUR / S-A108-BAD-NEIGHBOUR-EDGE-MISMATCH | sheet series |
| S-A109-HAPPY-PHOTO-PLACE-DIRECTION / S-A109-BAD-PLACE-OUTSIDE-CITY / S-A109-BAD-NO-WORKER-HINTS-PARTIAL | photo help |
| S-A110-HAPPY-SAME-PLACE / S-A110-BAD-SAME-PLACE-UNPLACED-SOURCE | *same place as another photo* |
| S-A111-HAPPY-HELP-NEVER-PUBLISHES / S-A111-BAD-UPLOADER-NO-VERSION-HELP | a help version waits for Approve; an uploader cannot open an imagery session |
| S-P20-HAPPY-HELP-MATCH-PRIOR / S-P20-BAD-HELP-MATCH-NO-AI-CLOUD | the pipeline job on a synthetic scene (`tests/unit/calibrate_scene.py`), with and without the fake proposer |
| S-P21-HAPPY-LINES-CHECK / S-P21-BAD-LINES-CHECK-REFUSES-SHIFTED | the street check on a synthetic drawn map, plus a map shifted 400 m that must fail |

**Admin-input budgets** (`e2e/support/budget.ts`, counted at teardown):

| Flow | Budget |
| --- | --- |
| an aerial `notFound` frame: Step A drag plus rotate, *Find the rest* (proved), *Finish* | **≤ 4** |
| **a hard drawn map**: content choice, 2 landmark picks plus 2 scan clicks, *Find the rest*, 3 Yes, *Finish* | **≤ 8** (the flow's own target is 10, held at 8 in e2e) |
| the next sheet of a series: open, *Find the rest*, *Finish* | **≤ 3** |
| a photo without place or direction with a text hint: accept the place hint, accept the direction arc, *Done* | **≤ 3** |
| a photo with no hints: click the map, drag the cone, *Done* | **≤ 3** |

**The tour** (`e2e/tour/states.ts`): new states `help-queue`, `help-queue-empty`, `help-step-a`, `help-step-a-searching`, `help-step-b`, `help-step-c`, `help-enough`, `help-drawn-landmarks`, `help-photo-where`, `help-photo-facing`, each at laptop, tablet landscape, tablet portrait and phone. All pass `expectStateSound`. The overlay's and the cone's drag handles join the target-size check.

**No GPU, no network, no weights in any gate.**

- The worker side uses M10's fake box.
- `junctions.json` and `landmarks.json` fixtures are built from a small synthetic GeoJSON.
- The thinning and chamfer run on synthetic drawn maps (lines on paper, scaled, rotated and bent by a known tps) with the per-file 90 % coverage.
- The admin side mocks only the callables' and the worker's boundaries. No owned module is mocked.

**Unit tests:** `helpValue`, `helpItemsOf`, `guardChecks` (shared by the meter and `approval.ts`, with a parity test), the browser leave-one-out estimate, the overlay's gesture-to-affine maths, the snapping.

## 11. Build plan

**Phase 1: the queue and Step A (no new pipeline maths).** About 1 week.

- **W1 `help-queue`** (`packages/shared/src/help/`, `packages/admin/src/help/`, `packages/ui/src/admin/help/hcm-help-page.ts`, Home's count): §1, the indexes, the rules' read rows.
- **W2 `help-match` frame** (`steps/help.py`, `calibrate/chain.py` prior-first hypothesis, `_request` with the admin's starts, the bootstrap uncertainty, the candidates from `dense.py`, the callables, the job type, `worker.claim` priority, the `_seedable` session path): §6.1 to §6.5 for `kind: 'frame'`.
- **W3 `help-session` UI**: Step A overlay and gestures, *Find the rest*, the meter with `guardChecks` extracted from `approval.ts`, *Finish* and *Save as it is*. It reuses `georef-map.ts`, `warp.ts`, `residual-table.ts` and the worker panel text.

Rows: S-A101, S-A102, S-A105, S-A111, S-P20.

**Phase 2: confirm and one more point.** About 1 week.

- **W3 continued**: Step B (generalising `suggestions-panel.ts` into a one-at-a-time card with keys), Step C, the keyboard map cursor, the live region, undo.
- **W4 `junctions`**: `osm_junctions`, `junctions.json` and snapping on the map side.

Rows: S-A103, S-A104. Then the tour's states and the 4-input aerial budget.

**Phase 3: drawn maps and sheets.** About 1.5 weeks.

- **W5 `drawn`**: JPG and PNG upload, `content`, `roughBox`, the scan-side junction detector, the chamfer and ICP search, the `lines_on_scan` street check with `checkpointKind: 'held-out-lines'` (pipeline twin, schema, golden `written-documents.json`), `landmarks.json` and *Match by landmark*, the bent-sheet tps offer.
- **W6 `series`**: the series field, the batch name pattern, the neighbour prior and the edge check.

Rows: S-A106, S-A107, S-A108, S-P21. The 8-input drawn-map budget.

**Phase 4: photos.** About 1 week.

- **W7 `help-photo`**: the triage filter and *Next*, `<hcm-help-photo>`, the text and landmark hints in the browser, *same place as*, `photo-direction` (vanishing lines plus OSM bearings plus building outlines) on the worker CPU.
- **W8 `photo-similar`** (after the owner chooses the embedding model and its licence is read): the sidecar embedding, local-only vectors, *same building*.

Rows: S-A109, S-A110.

**Each phase:** `static`, `tests` and `build` green, plus targeted Playwright runs of the new specs before pushing `feat/engine-rewrite`. Docs, skills and mirrors are updated in the same task:

- `docs/ARCHITECTURE.md`;
- `.agent/skills/` for the georeferencer, the raster pipeline and the e2e skills, with their `.claude/skills/` mirrors;
- `docs/MANUAL_TEST_PLAN.md` (a *Help calibrate* walk-through on the dev stack's Bucharest and Bacău, seeded with one `notFound` frame, one drawn JPG and three unplaced photos);
- `docs/E2E_SCENARIOS.md`.

The full `all` run (split with the NUC) is needed only before `master`.

## 12. Owner decisions and open points

1. **The embedding model for *same building*** (§6.6). The licence must be read before it lands. Until then, the fallback is text and year matching.
2. **Whether a drawn map may ever publish itself.** This design says **never** (hand input means Approve), consistent with M9 §11.
3. **The `help-match` priority over a running batch `locate`.** The design waits for the slot rather than pre-empting. Pre-empting would need `locate` to be resumable mid-proof, which it is not today.
4. **UNVERIFIED:**
   - the thinning's quality on faded 19th-century prints;
   - the vanishing-line direction on photos with no straight facades;
   - `junctions.json`'s size for a large window, to be measured on Bucharest and Bacău.
5. **Left for later:**
   - reading printed grid lines and coordinate labels on sheets (OCR);
   - recalibrating joined layers (M16 §6, still not built);
   - using the kept answers to fine-tune the matcher.

## 13. As built

### 13.1 Stitching that the admin can see (§4.1, track/helpcal, 2026-11-09)

Every grid, atlas, pieces or single archive series that waits for a person keeps **one stitched picture**, so the admin always places one
picture, never thousands of sheets.

| Part | Where | Behaviour |
| --- | --- | --- |
| The stitched picture | `pipeline/src/hcm_pipeline/placing/stitched.py` | The canvas kept with the job's files (`stitched.tif`, where the job runs, as `warped.tif`), its preview `stitched.jpg` (long side at most 4,096 px, a new `VERSION_FILES` entry) with the version; `help.stitched` (`stitchedSchema`, `packages/shared/src/schemas/imagery-help.ts`): preview path and scale, size, method (`grid`, `atlas`, `pieces`, `single`), parts, joined, the parts left out with their reason (`no-frame`, `no-join`, at most 200 named), metres a pixel (a grid's mosaic), the joins' quality. |
| A grid that does not prove | `placing/grid.py` | With no fit at all, its mosaic (names and frames) is the stitched picture, at the mosaic's known 2 m a pixel (coarser past 6,000 px). |
| Sheets with no neat line | `placing/frame.py` `content_frame` | The cadastral sheets: the longest dense run of ink across and down frames the sheet when it holds 30-99.5 % of it and its cell's shape within 20 %; logged as framed by their drawing's extent. |
| Pieces and atlas pages | `placing/joins.py`, `placing/maps.py` | Read at 2,400 px (twice the old size), SIFT (8,000 features) matched with FLANN and Lowe's ratio 0.8, a similarity by RANSAC (4 px), kept with 12 or more spread inliers at a scale within 10 % of one; chained by `assemble.tree`, drawn at 1,200 px a part. An atlas uses its overlaps when they join more pages than its edges. The joins' quality: links, mean inliers, residual in canvas pixels. |

Tests: `pipeline/tests/unit/test_placing_{assemble,grid}.py`; scenarios `S-P22-*`.

### 13.2 The georeferencer for an archive series (track/helpcal, 2026-11-09)

The owner's screenshot: the georeferencer of a series waiting for points ("1895-1899") showed "The scan cannot be shown" and "No
reference image", and its panes were too small to work in.

| Part | Where | Behaviour |
| --- | --- | --- |
| Its picture and reference | `pipeline/src/hcm_pipeline/placing/stitched.py` `_for_georeferencer` | When a series parks with a stitched picture, the picture is also the version's `scan` (`scan.tif`, at most 8,192 px long, and `scan-preview.jpg`, through `steps/common.publish_scan`, the worker's signed-URL uploads of `VERSION_FILES`) and the city window's OpenStreetMap lines its `reference` (`reference-osm.png`, at most 4,096 px; never Satellite). The georeferencer opens it like any frame. The version's suggested pairs move into the scan's pixels in the same write (`in_scan`: the scan's shrink times `Stitched.pairs_scale`, a pair outside the scan dropped; 2026-11-12, lesson 583). |
| Placed from the owner's pairs | `pipeline/src/hcm_pipeline/placing/owner.py`, `functions/src/imagery/save-gcps.ts` | Save and georeference on a parked series (`imagery.saveGcps`) writes the pairs as the version's `georef` (`method: 'gcps'`) and resets `place` (an archive job has no `georef` step); `place` then fits them, scales them from the scan to `stitched.tif` (the scan itself when that is gone), warps through a lattice of the fit into `warped.tif` at the series' `maxzoom` and writes `archive` with `method: 'gcps'`, never running the class's placer again. Too few pairs park it again with its help kept (2026-11-10, `docs/LESSONS.md`; S-P20-HAPPY-OWNER-PAIRS, S-P20-BAD-OWNER-PAIRS-FEW). |
| A series parked before | `functions/src/imagery/locate-again.ts`, `packages/ui/src/admin/imagery/version-detail.ts` | **Locate again** is offered on an archive series waiting for points: its job goes back to `queued` from `place` (`gather` kept), the version forgets its `help` (unless it holds the owner's tile layout, `help.layoutAnswer`, which stays for `place` to fix: lesson 797, M20 §19.20), and the new run makes its picture. A failed series or one asked to stop is not offered it. |
| Room to work | `packages/ui/src/admin/georef/georef-styles.ts`, `georef-parts.ts`, `hcm-georef-page.ts` | The scan and the map take at least 70 % of the window's height (420 px at least; 70 % of the dynamic height on a phone, one pane under the Scan or Map switch); **Full screen** (`fullscreen` / `fullscreen_exit`) covers the window with the page, its actions first, while everything around it is `inert` (`full-screen.ts`) and the page names itself at the first heading level; Esc or **Leave full screen** ends it. Since 2026-11-16 (the owner: full screen must really go full screen) it also asks the browser for its real full screen on the page (`requestFullscreen`, `webkitRequestFullscreen` on Safari), hiding the browser's bars; both panes follow the new size (a `resize` event), and leaving it by Esc or the browser's bar (`fullscreenchange`) puts the page back. A browser that refuses keeps the in-page cover and says how to allow it (`adminContent.georef.fullScreenRefused`). |
| Same markers left and right (2026-11-11) | `packages/ui/src/admin/georef/marker-badge.ts`, `packages/admin/src/georef/marker-overlay.ts`, `georef-map.ts` | The map no longer uses POI overlays for pair numbers; a canvas overlay paints the scan's badges (owner: "points on the right … exactly the same as on the left"; DECISIONS §143). |

Scenarios `S-A122-*`, `S-P22-HAPPY-GEOREF-SCAN`.
