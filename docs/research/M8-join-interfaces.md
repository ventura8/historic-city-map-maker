# M8: a whole-city layer by joining frames (contracts, at 6a399f3)

The source: the owner, 2026-11-06. A KH-9 panoramic frame often holds only part of a city, so one date's frames are joined into one layer. The owner also asked for the USGS dates the project did not target yet.

**Status (2026-11-06):** every workstream built on synthetic frames and the emulators; no real frame has been joined, and rehearsal D3 (§10) still has to calibrate every seam threshold. §1 to §10 are the design; where the code differs, §11 to §17 hold.

## 1. Decisions and evidence

| Topic | Decision | Why (checked in code or a probe) |
| --- | --- | --- |
| Source raster | Each part's `scan.tif` + `georef`, one resample | A COG input means JPEG twice and a second bilinear pass. `scan.tif` survives until the sweep. |
| Correction transport | TPS nodes whose base positions come from GDAL's own `gdal.Transformer(vrt, None, ['METHOD=GCP_POLYNOMIAL','MAX_GCP_ORDER=2','DST_SRS=EPSG:3857'])` | This replaces "pin `fit_transform` to GDAL". Probe in `hcm-pipeline:local` on a synthetic scan: the transformer matches the poly2 function to under 1 mm, and a TPS over 400 nodes matches to 0.11 m. |
| Clip | Every warp clips to `city_window(ctx)` (`steps/common.py:33`: bounds + 10 %) | Caps disk and compute units. |
| Join shape | New job `layer-join`: `align, merge, export, register, ...PUBLISH_STEPS` | `export` and `register` are reused unchanged because `merge` writes grey + last-band alpha to `work/.../warped.tif` (`Warped.of`). |
| Blend | Own numpy block compositor with normalised weights, not GDAL cutlines | The image-quality prototype found that feathered cutlines leave a translucent line and that the feather runs into no-data. Normalising over valid pixels removes both. |
| Frame choice | Server-side plan document | The admin list is paged at 100 and filtered by Free only, so neighbours can be missing. The bundle also has no room. |
| Auto-publish | A join branch in `autoApproves`, all conditions required (§5) | No fake `georef`: `georefSchema` means one scan's pixels. |
| Part layer ids | Keep one id per part and repoint scenes at finalize | Live F039 already has its own id, so `parts[].layerId` is needed anyway. A shared id would add a second path. |

**Corrections to the designs, found in the code:**

- `importIn` reads the scene, then writes. A loop inside one transaction would read after a write. It must split into `readFreeScene` (all reads first) and `writeImport`.
- `movedJob` in `run-on.ts` strips `waitReason`, and `MOVABLE` includes `queued`. Claim refusal alone is therefore not enough:
  - the join job is born with `waitReason:'parts'`;
  - `movedJob` keeps that reason;
  - `CLAIM_RULES` refuses it.
- Repeated `reserveLayerId` calls in one transaction return the same id, because the frames share a label. Add `reserveLayerIds(labels)`.

**Dates (the second half of the request):**

- The harvest already searches all three datasets with an open window. The real gaps are:
  - nothing in production writes `targetYears` (CR-M3-28);
  - the 500-per-dataset cap truncates silently;
  - `newYear` demotes same-date neighbours;
  - dates are never grouped.
- The target dates 1966-07-12, 1976-02-20, 1977-09-13, 1978-03-30 and 1980-07-16 are already this project's own plan (`M3-interfaces.md:84`). Using them as target years copies no fostulbucuresti resource.
- Not verified:
  - whether USGS returns every one of these for Bucharest (checked at acceptance, §10);
  - how the public fostulbucuresti site joins its frames: its page lists 2 to 6 tilesets per year, stacked, and no technique. Nothing of theirs is used; the site is only looked at, for ideas or a by-eye check (the owner, 2026-11-06).

## 2. Contracts (Workstream A)

`packages/shared/src/schemas/imagery.ts` and its Python twins:

```ts
export const ENDED_VERSION_STATES = ['published', 'rejected', 'superseded', 'failed', 'cancelled', 'joined'] as const; // `joined` requires output
export const VERSION_ORIGINS = ['usgs', 'upload', 'regeoref', 'crop', 'join'] as const;
export const JOIN_MAX_PARTS = 8;

export const joinPartSchema = z.strictObject({
    versionId: idSchema,
    layerId: idSchema,
    entityId: idSchema,
    dataset: z.enum(USGS_DATASETS),
    sensor: sensorSchema,
    acquisitionDate: dateSchema,
});
// added to the sourceSchema discriminated union
export const joinSourceSchema = z.strictObject({
    kind: z.literal('join'),
    parts: z.array(joinPartSchema).min(2).max(JOIN_MAX_PARTS),
});

export const layerJoinParamsSchema = z.strictObject({
    parts: z.array(z.strictObject({ versionId: idSchema, layerId: idSchema })).min(2).max(JOIN_MAX_PARTS),
    sensor: sensorSchema, // sensorMachine picks xl for KH-9
});

export const joinSeamSchema = z.strictObject({
    a: idSchema,
    b: idSchema, // entity ids
    measured: z.boolean(),
    applied: z.boolean(),
    samples: z.number().int().nonnegative(),
    heldOut: z.number().int().nonnegative(),
    beforeRmseM: z.number().nonnegative().optional(),
    afterRmseM: z.number().nonnegative().optional(),
    maxShiftM: z.number().nonnegative(),
});
export const joinReportSchema = z.strictObject({
    seams: z.array(joinSeamSchema),
    omitted: z.array(idSchema), // parts that added under 1 % of the covered cells
    coveragePct: z.number().min(0).max(100), // measured on the alpha over the city bounds
    checkpointRmseM: z.number().nonnegative().optional(), // the WORST part's own, never pooled
    checkpointCount: z.number().int().nonnegative(), // the LOWEST part's count
    maxShiftM: z.number().nonnegative(),
});
// LayerVersionDoc gains: partOf?: idSchema; join?: joinReportSchema
```

A join version has no `scan` and no `georef`, so crop and `saveGcps` refuse it with the existing `noScan`.

Other changes in this workstream:

- `JOB_TYPES` gains `layer-join`. `CLIENT_JOB_TYPES` does not: only the callable queues it. Its comment is stale, because the rules do not list the types.
- `PIPELINE_STEPS` gains `align` and `merge`, before `warp`. `STEP_WEIGHTS`: `align` 0.15, `merge` 0.25.
- `JOB_WAIT_REASONS` gains `parts`. `VERSION_FILES` is unchanged.
- Layer provenance gains `usgsParts?: string[]`. For a join, `usgsEntityId` is the first part, so `rasterExportable` stays true.

Callable, `packages/shared/src/api/imagery.ts`:

```ts
export const imageryJoinRequestSchema = z.strictObject({
    cityId: cityIdSchema,
    entityIds: z.array(idSchema).min(2).max(JOIN_MAX_PARTS),
});
export const imageryJoinResponseSchema = z.strictObject({ jobId: idSchema, versionId: idSchema, layerId: idSchema });
// registry row: cityEditor('fn-imagery', ...) as 'imagery.join'; RUNTIME_ACCOUNTS fn-admin
```

Plan document, `cities/{city}/imageryPlans/dates`, new `FIRESTORE_PATHS.imageryPlan`:

```ts
export const datePlanRowSchema = z.strictObject({
    date: dateSchema,
    sensor: sensorSchema,
    frames: z.array(z.strictObject({
        entityId: idSchema, displayId: plainText(64).optional(), free: z.boolean(),
        versionId: idSchema.optional(), state: z.enum(LAYER_VERSION_STATES).optional(),
    })).max(JOIN_MAX_PARTS),
    paidFrames: z.array(idSchema).max(8), // never auto-chosen; the row gives each its own Buy this scan
    coveragePct: z.number().min(0).max(100), // estimate, worded "about"
    framesToDownload: z.number().int().nonnegative(),
    winter: z.boolean(), // Dec-Feb: sorted lower, "may need points"
});
export const datePlanDocSchema = z.strictObject({ rows: z.array(datePlanRowSchema).max(30), updatedAt: timestampSchema });
```

Pure logic, `packages/shared/src/imagery/join.ts`:

- Export `coverageRing` from `coverage.ts`.
- `planDate(frames, bounds)`: a 48×48 grid with point-in-ring. A rendered frame uses `output.bounds`; any other frame uses the panoramic model ring.
- Greedy selection: start from rendered frames, add the frame covering the most uncovered cells. Ties go to free, then same camera letter, then imported. Stop at 95 %, at a gain under 2 %, or at 8 frames.
- Row sort: reaches 95 %, then target year, then non-winter, then fewest downloads.

So 1972-08-08 ranks above the snowy 1972-02-02.

`ranking.ts`: `RankContext` gains `pendingDates`, taken from unfinished versions only. In `newYear`, a scene whose date is in `pendingDates` scores value 1 with reason `sameDate`. `RANKING_VERSION` becomes 3.

## 3. The pipeline job (Workstream B)

Params are read through `JoinParams.of`. Each part's raw record is read with `ctx.read`, because `GeorefInfo.of` drops the checkpoint values. Every threshold below is a starting value, calibrated by the rehearsal in §10 before it is frozen.

### Step `align` (output `work/{city}/{job}/join-plan.json`, so a retry does not re-measure)

1. **Inputs.**
   - `stat` each part's `scan.path`. If one is missing, fail `joinPartMissing {frame}`.
   - Check room: `shutil.disk_usage` must show at least `largest scan + 1 byte/px × window px × (parts + 1)`, else `joinNoRoom`.
   - Stage a scan, attach its GCPs with `gcp_source`, warp it at z14 (9.55 m) clipped to the window, then `unstage` it.
2. **Ownership at z13 (19.1 m).** Run `cv2.distanceTransform` per alpha mask. Each cell goes to the part deepest inside its own frame, which keeps seams off the panoramic edges.
   - A part owning under 1 % of the cells the parts cover (not of the window: small archive sheets count) goes to `omitted`, which drops redundant fore/aft frames.
   - Fewer than 2 parts left: fail `joinNoFrames`.
   - A seam is an owner boundary at least 1 km long.
3. **Samples.** One per `clamp(length/24, 250 m, 1000 m)` along the seam's principal axis. A tile counts only if at least 90 % of it is valid in both parts.
4. **Coarse pass.**
   - z14, 64 px tile, `images.enhance` then high-pass, `cv2.matchTemplate(TM_CCOEFF_NORMED)`, search ±400 m.
   - Keep a tile with peak ≥ 0.5 and margin ≥ 0.05 (`georef/tiles.peak_margin`).
   - Median above 300 m: fail `joinSeamTooFar {a,b}`, whose message links the georeferencer.
5. **Fine pass.** z16 (2.39 m), 256 px tile, search ±40 m around the coarse median, parabolic sub-pixel. Parts are warped per tile through the VRT. Drop samples beyond 3 MAD.
6. **Model `s(u)`.**
   - At least 12 kept and spread ≥ `WELL_SPREAD` (0.25): a quadratic in seam position `u`, clamped outside the sampled range.
   - 6 to 11 kept: the constant median.
   - Fewer than 6: `measured:false`, no correction.
   - Hold out every 5th kept sample once there are ≥ 10.
7. **Share by evidence.** `s_A = σ_A²/(σ_A²+σ_B²)`, with σ the part's `georef.checkpointRmseM`, floor 5 m. If either is missing, split equally. Part A moves `+s_A·s`, part B moves `−s_B·s`, so the worse-measured frame moves more.
8. **Taper.** `w(n)` is a smoothstep from 1 at the seam to 0 at 6 km (about 1.2 % strain at 70 m). Past 6 km a part equals its approved georef. The fields of several seams on one part add up.
9. **Nodes.**
   - Scan pixels at 1 km ground spacing inside the band, 5 km elsewhere, including the outer ring, at most 900.
   - `target = gdal.Transformer(...) + correction`.
   - A part with no applied correction keeps its own `_method`.
10. **Measure on pixels.**
    - Re-warp at z14 through the nodes and re-run the coarse pass. That gives `afterRmseM` on held-out samples.
    - If `afterRmseM >= beforeRmseM`, set `applied:false` for that seam and report the before figure.
    - No frame shifts unless the measurement says it helped.

    **Absolute error is not improved.** A join closes the gap only. `join.checkpointRmseM` is the worst part's own figure, and `maxShiftM` says how far anything moved.

Warping stays memory-bounded (`warpMemoryLimit`, `flags.gdal_progress`).

### Step `merge` (output `work/{city}/{job}/warped.tif`)

1. **Warp used parts.** One at a time, `scan.tif` through its plan at `SENSOR_SPECS` maxzoom, `targetAlignedPixels`, clipped, `GTIFF_OPTIONS`; `unstage` each scan.
2. **Tone at z12 (38 m).**
   - The anchor is the largest owned area, then BFS across seams. A seam off the tree is only measured.
   - Linear gain + offset from p2/p98 in the overlap, gain clamped to 0.5–2.
   - Then a low-frequency field: median log-ratio in the band, Gaussian σ 1 km, tapered to 0 at 8 km, applied ±½.
3. **Weights.** A signed distance per part to its owned region at z13. `w_i = clamp(0.5 + D_i/(2F), 0, 1)`, upsampled bilinearly. Half-width F is 48 m when the seam's `afterRmseM ≤ 15`, else 12 m: a hard cut beats double streets.
4. **Blocks.** 4096 px blocks into a BIGTIFF with grey + alpha.
   - `grey = Σ w_i·a_i·tone_i(p_i) / Σ w_i·a_i`.
   - `alpha = any a_i`.
   - Only the parts whose weight is non-zero in the block are read.
5. **Report.** `coveragePct` from the alpha over `city_bounds`, then `update_version({join})`. `export`'s `valid_area_km2` counts the union once, so the compute-unit estimate is right.

A worker step never lists or deletes under `rasters/`.

## 4. Failure modes and error codes

New `apiError.imagery.*` codes (`api/errors.ts`, `Errors`, `enums.json`, both languages):

| Code | When | en | ro |
| --- | --- | --- | --- |
| `joinMixedFrames` | callable | Only frames of one date and one camera can be joined. | Se pot uni doar cadre din aceeași zi și de la aceeași cameră. |
| `joinTwoPublished` | callable | Two of these frames are already published; delete one layer first. | Două dintre aceste cadre sunt deja publicate; șterge mai întâi unul dintre straturi. |
| `joinPartGone` | callable, hold | Frame {frame} ended; import or retry it, then join again. | Cadrul {frame} s-a încheiat; importă-l sau reia-l, apoi unește din nou. |
| `joinPartHeld` | approve, reject, regeoref, crop, delete of a part | Frame {frame} is being joined; reject or cancel the join first. | Cadrul {frame} este în curs de unire; respinge sau anulează mai întâi unirea. |
| `joinPartMissing` | `align` | The scan of frame {frame} is no longer stored. | Scanarea cadrului {frame} nu mai este stocată. |
| `joinSeamTooFar` | `align` | Frames {a} and {b} are too far apart to join; fix the points of one. | Cadrele {a} și {b} sunt prea departe pentru a fi unite; corectează punctele unuia. |
| `joinNoFrames` | `align` | Fewer than two frames add anything to the city. | Mai puțin de două cadre adaugă ceva la oraș. |
| `joinNoRoom` | `align` | Not enough disk space for this join; free some and retry. | Nu este destul spațiu pe disc pentru această unire; eliberează spațiu și reia. |

Other behaviours:

| Case | Result |
| --- | --- |
| Daily limit, guard red | Refused before anything is created; a 1984 set counts 4 + 1. |
| Frame not scanned | Existing `notScanned`, nothing created. |
| Part `needs_gcps` or `processing` | The join holds on `parts`. |
| No overlap, unmeasurable seam, snow | Renders with `measured:false`, waits for Approve, the card says so. |
| Coverage short | Renders, and the card offers the next frame. |
| Out of memory | Existing escalation and Retry. |

## 5. Functions (Workstream C)

**`imagery/join.ts` (callable), order of work:**

1. `requireCity`, read the scenes, require one date and one sensor.
2. For an imported scene, the part is found with `layerVersions where layerId == scene.layerId`: not ended, or published, newest. `failed` or `rejected` raises `joinPartGone`.
3. A new `refuseRasterJobs(documents, now, cityId, count)` in `limits.ts`, with count = missing frames + 1. For a city whose choice is `local` it asks only the budget guard and every job of the join is created `runOn: 'local'` (2026-11-12, `docs/research/M7-local-worker.md` §4.5).
4. For a missing frame, require `downloadAvailable` and `requireUsgs`, then `confirmScanned`.
5. `reserveLayerIds`. With one published part, the join becomes a new version of **that** layer (`refuseBusyLayer`), so tileset and presentation stay and `supersede` handles the old version. Otherwise it gets a new id.
6. One transaction, all reads first:
   - a live join already in `awaiting_approval` that shares a part is rejected (this is how "add a frame" works); a live join in any other state raises `joinPartHeld`;
   - create the imports with `partOf`;
   - stamp `partOf` on existing parts;
   - create the join job with `waitReason:'parts'`.

**`imagery/join-parts.ts`:**

- `isLiveJoin`: a version not in `ENDED_VERSION_STATES`. A failed join therefore frees its parts for a fix.
- `partsReady(deps, job)` returns one of:
  - `go`: all parts in `awaiting_approval|published` with `output`;
  - `hold`;
  - `gone {frame}`.
- `refuseHeldPart(...)`: one helper for the refusal.

**`dispatch.ts`, `dispatchPipelineJob`:** if `job.type === 'layer-join'`, evaluate `partsReady` first. Hold becomes `wait(…,'parts')`, gone becomes `endWork` failed. The 5-minute `dispatchDue` retries. `dispatch.ts` is at 345 lines, so the branch is one call. `wait` overwrites the reason once the join moves to `worker`.

**`worker/claim.ts`:** `CLAIM_RULES` gains `job.waitReason !== 'parts'`. **`run-on.ts`:** `movedJob` keeps `waitReason` when it is `parts`.

**`approval.ts`:**

- `policyIn` skips a version whose `partOf` is live, reading the join first. F040 can never auto-publish half a city.
- `autoApproves` gains a join branch, all required:
  - `autoPublish`;
  - `join.checkpointRmseM ≤ threshold`;
  - `checkpointCount ≥ 3`;
  - `maxShiftM ≤ threshold`;
  - every kept seam `measured` and applied, and at least one seam;
  - every seam `afterRmseM ≤ 15`;
  - `coveragePct ≥ 90` (`CITY_MIN_COVERAGE_PCT` since M9, one bar with a frame's: `docs/research/M9-calibration.md` §11).
- `approved` records `georef?.checkpointRmseM ?? join?.checkpointRmseM`.

At F039's 51.6 m the join waits for Approve, which is correct.

**`finalize-join.ts`, called inside `finalizeVersion`'s transaction (reads first):**

- parts in `awaiting_approval` → `joined`;
- their jobs → `succeeded`, without `waitReason`;
- every scene's `layerId` → the join layer, or `releaseScenes` would free them;
- `usgsProvenance` writes `usgsParts`, and `kindOf`/`attributionOf` are unchanged.

**The rest:**

| File | Change |
| --- | --- |
| `tick-maintenance.ts` | `ENDED_FOR_SWEEP` excludes `joined`. |
| `layer-delete.ts` | `versionsOf`/`deleteFiles` also walk `source.parts`, or gigabytes leak. |
| `approve.ts`, `regeoref.ts`, `save-gcps.ts`, `layers/delete.ts` | Call `refuseHeldPart`. |
| `end.ts`, `versions.ts`, `worker/step-update.ts` | Handle `joined`. |
| `worker/allow-list.ts` | `baseVersionOf` becomes plural `inputVersionsOf(job)`. Parts map to the read-only `base` target. `inputsOf` adds `RASTER_PATHS.version(city, part.layerId, part.versionId, 'scan.tif')` from params. `WORKER_VERSION_FIELDS` gains `join`. |
| `imagery/join-plan.ts` | Rewrites the plan doc after a harvest and when a part reaches `awaiting_approval`. One rewrite per city at a time in an instance; calls that come meanwhile share one more rewrite that starts after them (2026-11-13: three at once ran `imagery-onJobWrite` out of its 256 MiB; `docs/LESSONS.md` 659). |
| `harvest-target.ts`, `harvest.ts` | Warn when a dataset hits `MAX_SCENES_PER_DATASET`. For such a dataset only, run one windowed search per target year, so a targeted date cannot be lost to the cap. |
| `rankOf`, `shownYears` | Pass `pendingDates`. |
| `firebase/firestore.rules` | `match /imageryPlans/{id} { allow read: if isCityMember(city); }`, plus rules tests. |

**Reject, cancel, or fail of a join.** Only the join ends. Parts stay as they are and their scenes stay put, so re-joining downloads nothing. Parts created for the join are kept, and a stale `partOf` is ignored.

**Target years.**

- `createCityRequestSchema` picks `imagery`.
- `scripts/seed/bucharest.city.json` gains `imagery.targetYears: [1966,1972,1976,1977,1978,1979,1980,1982,1983,1984]`. Nothing under `seed/bucharest/` changes.
- The live city gets the years through Settings or the row button below.
- Saving the imagery section then calls the existing `imagery.search`, because only a search re-ranks.

## 6. Admin and UI (Workstream D)

No new tab or route. A lazy `join-card` chunk follows `orders/lazy-card.ts`.

- **Find, above `sceneRows`:** "Whole-city dates" from the plan doc. A row is date, frames, about N %, and **Join frames**. A row with paid frames says how many, then lists every one with its own **Buy this scan: {frame}**, which opens that frame's page and its order card (M4); a paid frame with an open order reads **Your order: {frame}** with its order's chip instead, or **Order it again: {frame}** once that order expired (`paidFrameList`, `packages/ui/src/admin/imagery/orders/order-list.ts`) (2026-11-12: only the first was linked; S-A66-HAPPY-BUY-EVERY-PAID, S-A66-BAD-PAID-ORDERED). **Add {year}** appears when the year is not targeted.
- **Version page, `outcome()`:** a USGS version awaiting approval with coverage under 90 % shows the offer. This is live F039's path.
- **Scene page:** the same offer beside Import.
- **After the call:** `context.go(['version', id])`.
- **Join page:** part rows with state and link. A part needing points is the existing georeferencer link. The approval card gains a join section.
- **Work list:** a part with a live join leaves "Waiting for you" unless it is `needs_gcps`. `hasScan` is false for a join.

Input budget: `joinFrames` = 1 in `budgets.ts`, then 1 Approve. Live F039 is Work → row → **Join** → **Approve**.

**Strings** (`admin-imagery`; job and step names in `admin-ops`):

| key | en | ro |
| --- | --- | --- |
| `join.datesTitle` | Whole-city dates | Date pentru tot orașul |
| `join.rowCoverage` | {frames} frames, about {percent} % of the city | {frames} cadre, circa {percent} % din oraș |
| `join.button` | Join frames | Unește cadrele |
| `join.offer` | This frame covers about {percent} % of the city. With {frames}: about {total} %. | Acest cadru acoperă circa {percent} % din oraș. Cu {frames}: circa {total} %. |
| `join.toDownload` | {count} to download | {count} de descărcat |
| `join.paidFrame` | {count} more would need ordering | Încă {count} ar trebui comandate |
| `join.buyFrame` | Buy this scan: {frame} | Cumpără această scanare: {frame} |
| `join.orderedFrame` | Your order: {frame} | Comanda ta: {frame} |
| `join.winter` | Winter: may need points | Iarnă: poate necesita puncte |
| `join.addYear` | Add {year} to target years | Adaugă {year} la anii țintă |
| `join.waiting` | Waiting for its frames | Așteaptă cadrele |
| `join.coverageMeasured` | Covers {percent} % of the city | Acoperă {percent} % din oraș |
| `join.seam` | Seam {a} and {b}: {before} m before, {after} m after | Îmbinarea {a} și {b}: {before} m înainte, {after} m după |
| `join.seamUnmeasured` | Seam {a} and {b} could not be measured | Îmbinarea {a} și {b} nu a putut fi măsurată |
| `join.absolute` | Worst frame error: {metres} m; joining does not improve it | Cea mai mare eroare a unui cadru: {metres} m; unirea nu o îmbunătățește |
| `join.maxShift` | Largest shift: {metres} m | Cea mai mare deplasare: {metres} m |
| `join.addFrame` | Add {frame} and join again | Adaugă {frame} și unește din nou |
| `join.omitted` | Left out, adds nothing: {frames} | Omise, nu adaugă nimic: {frames} |
| `jobs.type.layer-join` | Join frames | Unire cadre |
| `jobs.step.align` | Align seams | Aliniere îmbinări |
| `jobs.step.merge` | Merge frames | Unire cadre |
| `jobs.wait.parts` | Waiting for its frames | Așteaptă cadrele |
| `state.joined` | Joined | Unit |
| `origin.join` | Joined frames | Cadre unite |
| `rank.sameDate` | Same date as a frame in progress | Aceeași dată cu un cadru în lucru |

Never the word "seamless".

## 7. Workstreams with file ownership

**A (contracts; first, then frozen).**

- `packages/shared/src/schemas/{imagery,firestore-ops,firestore,paths}.ts`
- `packages/shared/src/api/{imagery,index,errors,registry,setup}.ts`
- `packages/shared/src/index.ts`
- `packages/shared/src/imagery/{join,coverage,ranking}.ts`
- `packages/shared/src/i18n/**`
- `packages/shared/test/**`
- `pipeline/src/hcm_pipeline/{contract,model,documents}.py`
- `pipeline/tests/contracts/enums.json`
- `pipeline/tests/unit/test_contract.py`
- `scripts/seed/bucharest.city.json`

**B (pipeline).**

- new `steps/{align,merge}.py`, `join/{seams,correction,tone,compose}.py`
- `services.py`
- `pipeline/tests/synthetic/scenes.py`
- new `pipeline/tests/integration/test_join_job.py`, unit tests for `join/*`
- `test_written_documents.py`, regenerated `written-documents.json`

**C (functions).**

- new `functions/src/imagery/{join,join-parts,join-plan,finalize-join,harvest-target}.ts`
- `imagery/{index,dispatch,approval,finalize,approve,regeoref,save-gcps,import,versions,limits,run-on,end,layer-delete,tick-maintenance,harvest}.ts`
- `layers/delete.ts`
- `worker/{allow-list,claim,step-update}.ts`
- `global-options.ts`
- `firebase/firestore.rules`, `firebase/rules-tests/**`
- `functions/test/**`

**D (admin and UI).**

- `packages/admin/src/imagery/{feeds,api,model,version-view}.ts`, new `imagery/join.ts` (`imagery.ts` is at 378 lines)
- `packages/admin/src/worker/feed.ts`
- `packages/admin/src/content/budgets.ts`
- `packages/admin/vite.config.ts`
- `packages/ui/src/admin/imagery/{imagery-port,scene-list,scene-detail,version-detail,approval-card,work-list}.ts`, new `imagery/join/{lazy-card,join-card}.ts`
- `packages/ui/src/admin/jobs/job-text.ts`
- `packages/admin/test/**`, `packages/ui/test/**` (includes `setup-cloud.test.ts` 80→81)
- `scripts/ci/check_bundle_budget.py`, after decision D1

**E (e2e).**

- `e2e/scenarios.json`
- `e2e/admin/support/{imagery-runner,imagery-run,imagery-standin}.ts`, new `imagery-standin-join.ts`
- new `e2e/admin/specs/imagery/{join.spec,join-pipeline.spec,join-states}.ts`
- `e2e/tour/admin-sections.ts`
- `e2e/projects.ts`
- `e2e/mock-apis/imagery.ts`
- generated `docs/E2E_SCENARIOS.md`

**F (docs; last).**

- `docs/research/M3-interfaces.md` §1, §2, §3.3, §4.1, §5.3, §9.1, §10, §11, and line 84, closing CR-M3-28
- `docs/research/M7-local-worker.md`
- `docs/ADMIN_GUIDE.{en,ro}.md`
- `docs/MANUAL_TEST_PLAN.md`
- `docs/ARCHITECTURE.md`
- `docs/TESTING.md`
- `docs/LESSONS.md`
- `docs/research/DECISIONS-for-review.md`
- `.agent/skills/pipeline/raster_pipeline_skill.md`
- `.agents/skills/raster-pipeline/SKILL.md`, copied to `.claude/skills/`

**Order:** A, then B, C, D in parallel, then E, then F. D builds against fixtures until C lands. Run `static`, `tests` and `build` plus targeted Playwright after each; quote each verdict.

## 8. Scenarios

**P05, pipeline** (tier `e2e-pipeline`, docstring tags). `SceneSpec` gains `centre_offset_m` over one seeded world, and `affine_scan` gains the same plus injected gain.

| Row | Asserts |
| --- | --- |
| `S-P05-HAPPY` | 2 frames, 60 m offset, 25 % tone step → seam ≤ 15 m, truth error beyond the taper unchanged within 1 m, no partial alpha inside the valid area, `areaKm2` is the union |
| `S-P05-HAPPY-THREE` | 3 frames, two seams, fields add |
| `S-P05-HAPPY-OMITTED` | A covered frame goes to `omitted` |
| `S-P05-BAD-NO-OVERLAP` | Renders, no seams, no auto-publish |
| `S-P05-BAD-UNMEASURED` | Flat overlap → `measured:false`, no shift, F 12 m |
| `S-P05-BAD-WORSENED` | Adversarial field → `applied:false`, before figure reported |
| `S-P05-BAD-TOO-FAR` | 500 m → `joinSeamTooFar` |
| `S-P05-BAD-PART-MISSING` | `joinPartMissing` |
| `S-P05-BAD-NO-ROOM` | `joinNoRoom` |
| `S-P05-HAPPY-WORKER` | Runs under the worker allow-lists |

**A65, join** (tiers `e2e-admin`, `functions`).

| Row | Asserts |
| --- | --- |
| `S-A65-HAPPY` | Live-style frame page → Join → parts → Approve → published, within the input budget |
| `S-A65-HAPPY-ADD-FRAME` | Short coverage → Add → join again, nothing re-downloaded |
| `S-A65-HAPPY-AUTO` | Join within all limits auto-publishes |
| `S-A65-BAD-MIXED` | `joinMixedFrames`, nothing created |
| `S-A65-BAD-DAILY-LIMIT` | Refused up front, no half-created set |
| `S-A65-BAD-PART-NEEDS-POINTS` | Holds, no claim, resumes after points |
| `S-A65-BAD-PART-GONE` | `joinPartGone` |
| `S-A65-BAD-PART-HELD` | Part refuses reject, re-georeference and delete |
| `S-A65-BAD-PART-NOT-AUTO` | A part never auto-publishes |
| `S-A65-BAD-OVER-THRESHOLD` | Waits for Approve |
| `S-A65-BAD-REJECTED` | Parts return, scenes kept |
| `S-A65-HAPPY-FINALIZE-SCENES` | Scenes repointed, sweep skips `joined`, delete removes part files |

**A66, dates and target years.**

| Row | Asserts |
| --- | --- |
| `S-A66-HAPPY` | Rows sorted, a summer date above a winter one |
| `S-A66-HAPPY-ADD-YEAR` | Add {year} saves and re-ranks |
| `S-A66-HAPPY-SEED` | A new setup holds the years |
| `S-A66-HAPPY-TRUNCATED` | Capped dataset → windowed search finds the target date |
| `S-A66-BAD-PAID-FRAME` | Row names the order instead of joining it |
| `S-A66-BAD-NO-NEIGHBOUR` | No row, no offer |

**A11 addition:** `S-A11-HAPPY-SAME-DATE-RANK`.

**Tour states** (`specs/imagery/join-states.ts`, spread at `// [section join]`; `states.ts` is full):

- `imagery.date-rows`
- `imagery.join-offer`
- `imagery.join-waiting`
- `imagery.join-part-needs-points`
- `imagery.join-approval`
- `imagery.join-unmeasured`
- `imagery.join-refused`
- `imagery.join-failed`

The real-pipeline spec joins `PIPELINE_SPECS` and needs `useSyntheticScenes` per entity (`*.tgz` by name, `scenes.py --join`).

## 9. Explicit cuts from v1

- Absolute measure of the mosaic against Sentinel-2/OSM. The card shows the worst part's figure instead.
- `seam.png`.
- `output.cityCells` and the pass-shift search: one measured frame is too little evidence.
- Graph-cut and multi-band blending, plus bundle adjustment across cycles.
- "Continue without this frame": cancel the join and join the rest.
- Buying from the join flow, and automatic frame addition.
- Mixed dates or sensors.
- Crop or re-georeference of a joined layer, and extending a published join: delete the layer and start again.
- Deleting parts' COGs after publish.
- Disk prediction in the UI.
- Adding a new USGS dataset: nothing shows one is needed.

## 10. Owner decisions and acceptance

**Ask first:**

- **D1, bundle budgets: resolved without asking, 2026-11-06.** No budget rose: real savings made the room (§12; `DECISIONS-for-review.md` §91a). The design's measure was: `ADMIN_TOTAL_KB` 630.047 of 630, `imagery` about 55 bytes free on a dist older than HEAD; a new `join-card` row plus a higher total would have been a relaxation, needing the owner's yes.
- **D2, the live city's target years: done 2026-11-06.** Saved through Settings: 1966, 1972, 1976, 1977, 1978, 1979, 1980, 1982, 1983, 1984.
- **D3, real rehearsal before the UI is finished.**
  - F006+F007 of 1972-08-08 on the local worker, then F039+F040. These are real USGS downloads.
  - It calibrates peak and margin, node-warp time, disk and `xl` memory.
  - If real fore/aft pairs yield under 6 kept samples, the fallback is the 12 m cut with `measured:false`.

**Acceptance after D3:**

- After a Search, the date rows must show 1966-07-12, 1977-09-13 and 1978-03-30, or the log explains why not (the live data so far names 1978-07-06).
- 1980 has A038+A039 against three legacy tilesets, so check coverage.
- A by-eye look at the public site is allowed as an owner step in `MANUAL_TEST_PLAN`. It is never an alignment reference, and no value is recorded.

**Unverified risks:**

- All seam figures come from synthetic rasters.
- Timing at about 2 Gpx is extrapolated from 32–144 Mpx runs.
- Cloud Run `xl` with memory-backed scratch may not fit a full window, so the local worker may be the only practical runner.
- Panoramic model coverage can be about 7 km off. That is why plan figures say "about" and the card shows the measured figure.

## 11. The contracts as built (Workstream A, frozen)

Where the code differs from §2, §4 and §6, the code holds:

| Spec | As built | Why |
| --- | --- | --- |
| Every join schema in `schemas/imagery.ts` | `schemas/imagery-join.ts` (part, source, params, seam, report), `schemas/imagery-plan.ts` (the plan), `JOIN_MAX_PARTS` in `schemas/imagery-settings.ts`; all exported from `@hcm/shared` | `firestore.ts` reads the limit and `imagery.ts` imports `firestore.ts`, so the constant needs the leaf module; the plan reads `LAYER_VERSION_STATES`; `index.ts` is at its 400 lines, so `export *`. |
| `sensorSchema`, `dateSchema` | `z.enum(SENSORS)`, `isoDateSchema` | The names that exist. |
| `RankContext.pendingDates` | Optional | Its callers are Workstream C's; absent means none. `sameDate` is listed first (`always`): a card shows three reasons. |
| Short i18n keys of §6 | `adminContent.imagery.join.*`, `adminContent.imagery.reason.sameDate`, `adminContent.imagery.wait.parts`, `adminContent.imagery.version.joined`, `adminContent.imagery.origin.join`, `adminContent.jobs.type.layerJoin`, `adminContent.jobs.stepName.align`, `adminContent.jobs.stepName.merge` | The catalogues' existing key forms. |
| `planDate(frames, bounds)` | Also `planDates(frames, bounds, targetYears)`: groups by date and sensor, sorts, caps at `DATE_PLAN_MAX_ROWS` | The row sort reads the target years. A row needs at least one obtainable frame, and two frames counting the paid ones. Paid frames go through the same greedy choice, after the chosen ones. |
| `scripts/seed/bucharest.city.json` alone | Also: `migrate-legacy.mjs` drops `imagery` from the viewer's manifest; `scripts/site/src/admin/legacy.ts` adds the file's `imagery` to `legacy/bucharest/city.json`; `packages/admin/src/import/city.ts` copies it | The manifest's city is strict and is the viewer's, and the bundle is built from the seed manifest, which does not change. Without these the seed's years never reach `setup.createCity`. |
| Python twins | `JoinParams`, `JoinPart` (`model.py`), `JoinReport`, `JoinSeam` (`documents.py`), `Errors.JOIN_*`, `JOIN_MAX_PARTS` (also in `enums.json`), golden `version.join.json` read by both languages. `Version` has no `partOf` | Nothing in the pipeline reads it. |

## 12. The admin and UI as built (Workstream D)

| Spec | As built | Why |
| --- | --- | --- |
| A lazy `join-card` chunk, offer logic beside each page | `join/lazy-card.ts` has one gate, `lazyJoin`: the chunk is fetched when the city has a plan or the open version is a join; every decision (rows, offer, frames, report) is inside `join/join-card.ts` | The imagery chunk had no room for the decisions. A city with a plan shows its rows on Find anyway. |
| Decision D1, the budgets | No budget rose. `ADMIN_TOTAL_KB` stays 630, the build is 627.8; `imagery` 17.7 of 18; new rows `join-card` 3 (2.4 measured) and `upload-panel` 2 (1.2 measured) | Two real savings. `cssLiteralsPlugin` now also minifies `html` templates and drops the line breaks left in `css` ones: 6.4 KB over the admin, also a smaller engine. The Upload view is a chunk fetched when its tab first opens: 0.8 KB out of `imagery`. |
| Comparing a part with the plan's state | A part's state comes from the unfinished list, then the plan; an ended part (`published`, `joined`) that neither names has no state line | A join page reads no other version document. |
| `join.waiting`, `origin.join` | `join.waiting` is the note above a join's frames, in place of the version page's own wait line, so it says it once; the Work row keeps `wait.parts`. `origin.join` heads the frames and names the link from a part or a date row to its live join | Each string has one place to appear. |
| Offer's figure for the frame | The version page reads the frame's scene through the routed read (`ImageryFeeds.showScene`), for its `coverage`; a repeated `showScene` of one path no longer restarts the listener | A version does not store its scene's coverage. |
| Saving Settings' imagery section | Calls `imagery.search` after every successful Save of that section; a failure is logged, the Save stands | §5 says so. The Imagery page's own Search reports USGS's errors. |
| Selectors for the e2e and tour states | `[data-join-dates]`, `[data-date]`, `[data-join-offer]`, `[data-join-parts]`, `[data-part]`, `[data-join-report]`, `[data-seam="applied\|not-applied\|unmeasured"]`, `[data-omitted]`, and `data-state` `join-waiting`, `join-holds`, `join-refused`, `join-paid` (the count), `join-buy` (each paid frame's link, in `[data-paid]` of `[data-join-paid-frames]`), `join-winter` | For Workstream E. |

## 13. The pipeline job as built (Workstream B)

Where the code differs from §3 and §8, the code holds:

| Spec | As built | Why |
| --- | --- | --- |
| `join/{seams,correction,tone,compose}.py` | Also `join/canvas.py` (the levels, `Raster`, `DatasetSource`), `join/measure.py` (tiles and the model), `join/plan.py` (parts, `join-plan.json`), `join/warping.py` | Complexity 5 per function; each file stays readable. |
| Coarse search ±400 m | `COARSE_SEARCH_M` 600 m | A search that stops under the row's 500 m cannot see that pair: its tiles fail and the seam reads as unmeasured, so it would render double streets instead of `joinSeamTooFar`. |
| Metres in a threshold | Ground metres (`ground_scale`), as every reported figure; tile sizes stay pixels of their level | 60 EPSG:3857 metres at Bucharest are 43 on the ground. |
| Transformer on the VRT | The same `gdal.Transformer` over a band-less `MEM` dataset holding the same points | It reads no pixel, so no scan is fetched to build it. |
| `applied:false` "reports the before figure" | `afterRmseM` = `beforeRmseM`, `maxShiftM` 0, no nodes | The approval and the blend read `afterRmseM`: what the layer shows at that seam is what was there before. A refused seam removes its field, and the rest are judged again, because the fields add up. |
| Dense nodes inside the band | Up to `TAPER_M` + 2 km (`NODE_BAND_M`) | Sparse nodes starting at the taper's end let the spline drift 1.3 m beyond it on the synthetic frame. |
| 3 MAD | With a floor of 1 Mercator metre (`MAD_FLOOR_M`) | A spread that small is the measurement's noise. |
| `align`'s output | `join-plan.json`, and `join-owner.tif` beside it | `merge` needs who owns each cell; its own warps have moved the edges, so it must not derive them again. |
| A peak on the search's edge | Refused | It may only be the slope of a peak outside the search. |
| `targetAlignedPixels` | The box is aligned on zoom 12's pixels by hand and passed as `outputBounds` | Every level must have exactly the sizes of the others, not one pixel over from a rounding. |
| Row list of P05 | Also `S-P05-BAD-NO-FRAMES` (§4's `joinNoFrames`) | §8 had no row for it; Workstream E registers it. |
| `scenes.py --join` | `{out}/{entity}/` for `JOIN_ENTITIES`: the 1966 default entity and `DS1035-1057DA024`, side by side with a third of a frame in common | What the real-pipeline spec loads per entity. |
| Worker `align` per seam | A part's scan is staged for its preview, its seams, its re-warp and its `merge`: up to four downloads | Only one or two scans are on disk at a time, as §3 asks. Worth measuring in the rehearsal (D3). |

Found on the way, not changed: where a frame's own edge lies inside the window, both frames can be equally deep near it, the owners tie, and the seam bends along that edge. Its taper then reaches further than a straight seam's. The P05 frames that assert the taper are taller than the window for that reason.

## 14. The scenarios as built (Workstream E)

| Spec | As built | Why |
| --- | --- | --- |
| `join.spec.ts` | Also `join-dates.spec.ts` (A66 on Find; every push's five projects) and the helpers `join-world.ts`; `join.spec.ts` joins `IMAGERY_PUBLISH_SPECS`, `join-pipeline.spec.ts` joins `PIPELINE_SPECS` | The publishes are the slow part; the date rows wait for none. |
| The frames of a date | Seeded `usgsScenes` the fake USGS's catalogue does not list (`D3C1202-200149F039`, `F040`, `F041`), so the page's own search leaves them alone and writes the plan from them; `POST /__imagery/frames` gives each a delivery, and a frame with a delivery counts as scanned (`usgs-downloads.ts`) | Adding same-date frames to the catalogue would change what every imagery spec lists. |
| A frame's outline | A footprint of five vertices | Only a ring of four corners goes through the panoramic bow tie, and these frames must cover what the spec says. |
| The stand-in's script | `ImageryScript` gains `join` and `entities`; `StandinAttempt` gains `outputBounds`, `join`, `seamsUnmeasured`, `codeParams` | One script plays a join and its frames. A frame rendered over the whole city would leave its date no row. |
| `useSyntheticScenes` per entity | Every `*.tgz` of the folder and of each folder below it; the references from the first folder holding them | `scenes.py --join` writes `{out}/{entity}/`. |
| Rows of §8 | Also `S-A65-BAD-UNMEASURED`, `S-A65-BAD-SEAM-TOO-FAR` (the tour states `join-unmeasured` and `join-failed` needed rows), `S-P05-HAPPY-ADMIN` (the real pipeline from the admin), `S-P05-BAD-NO-FRAMES` (§13). Tier `functions` for what no screen shows: `S-A65-BAD-MIXED`, `S-A65-BAD-PART-GONE`, `S-A66-HAPPY-TRUNCATED`, `S-A11-HAPPY-SAME-DATE-RANK` | |
| The real-pipeline spec's Approve | None: the two synthetic frames meet every limit, so the policy publishes the join | What the pipeline measured on this scene. |
| Tour states of §8 | Also `imagery.join-holds` | The frame page's link to its join had no state, and the same bare link failed the target size on Find. |
| `S-A65-BAD-PART-NEEDS-POINTS` in the browser | Holds and links the georeferencer; "resumes after points" stays in `functions/test/imagery/join*.test.ts` | Saving points in the georeferencer is `georeferencer.spec.ts`'s journey. |

Product change a test forced: `join-card.ts`'s two bare links use `a.external` (`docs/LESSONS.md` 363).

## 15. The functions as built (Workstream C)

| Spec | As built | Why |
| --- | --- | --- |
| `reserveLayerIds(labels)` | `reserveLayerIds(documents, cityId)` answers a function `(label) => id`, each id clear of the ones before it | The join's own id is taken only when no frame is published, and a list answer has an "index may be undefined" branch nothing can reach. |
| Transaction in `imagery/join.ts` | `imagery/join-write.ts` (also `importWork` in `import.ts`) | The callable's checks and the transaction read better apart. |
| "Not ended, or published, newest" | The same, leaving out a join not published yet (`isUsablePart`) | With a published frame the join is that layer's newest version, so "add a frame" would otherwise take the join for the frame. |
| One published part | A frame also counts as one when its layer exists, or it is `approved` or `publishing` (`refuseBusyLayer` then refuses it until it is published) | A frame on its way to a layer would otherwise leave that layer behind with no scene. |
| `go` for a `published` part | Only on the join's own layer; on another layer it is `gone` | A failed join frees its frames, so a retried join can find one published on its own meanwhile. |
| `policyIn` skips a held frame | It records the estimate and does not approve | With no estimate, the tick's `pendingApprovals` would run the policy again and could publish half a city once the join ended. |
| `layer-delete` walks `source.parts` | Only the parts in state `joined` | A rejected join's frames live on. |
| `harvest-target.ts` | A year's search that fails is logged and costs that year only; a request's window also bounds the target years | What the first search found stays. |
| `end.ts`, `worker/step-update.ts`, `versions.ts` `holdsLayerId` | No change: all derive from `ENDED_VERSION_STATES`; tests pin it | A worker cannot write `joined` (`WORKER_VERSION_STATES`). |
| `layers/delete.ts` calls `refuseHeldPart` | It reads the frame and its join itself | `functions-feature-folders-independent`: the `layers` folder may not import `imagery`. |
| Not in the spec | `job-notices.ts`: a frame a live join holds is not announced as ready to approve; `join-plan.ts`: a `regeoref` reaching approval and a join's `succeeded` also rewrite the plan, and a date a published join shows has no row | Its Approve is refused; the plan would otherwise offer a join the callable refuses. |

## 16. Also reported, at the end (Workstream F)

The workstreams' reports held these beyond §11 to §15. The code holds.

| Workstream | As built | Why |
| --- | --- | --- |
| A | `coverageRing` is exported from `imagery/coverage.ts`, not from the `@hcm/shared` barrel | Outside its file only `imagery/join.ts` reads it. |
| A | This document's table separators normalised | markdownlint. |
| A | Compile-only edits outside its files: `functions/src/global-options.ts`, `functions/src/imagery/versions.ts`, `packages/ui/src/admin/imagery/{imagery-text,imagery-port}.ts`, `e2e/admin/support/{imagery-runner,imagery-standin,imagery-run}.ts`, the function count 80→81 in `packages/admin/test/google/clients.test.ts` and `packages/admin/test/provision/setup-cloud.test.ts`, `pipeline/tests/unit/test_main.py` | A frozen enum must compile everywhere. |
| B | `warp.py`'s `_method` is `warp_method`; `rasters.py` gains `driver_of`; `pipeline/typings/osgeo/gdal.pyi` gains `Transformer` and block `WriteArray` | `join/` reuses them. |
| B | `written-documents.json` regenerated: two new paths, and older stale `sha256` and score values refreshed | Only shapes are compared; the default synthetic scene stays byte-identical (hash checked). |
| C | `save-gcps` and `crop` refuse a held frame through `startRegeoref`, not a call of their own; a frame in `needs_gcps` still resumes | A join waits for those points. |
| C | A published join refuses extension with `alreadyImported` | §9's cut: delete the layer and start again. |
| C | `dismissFailed` frees a scene only for a `usgs` source | A failed join frees no scene: its frames keep theirs. |
| C | `functions/test/support/imagery-fakes.ts`: the fake search honours `from` and `to`. The `sameYear` case of `search.test.ts` uses another day of the year | The windowed search needs the first; the same date is now `sameDate`. |
| D | New leaf `packages/ui/src/admin/imagery/join/live-join.ts` | An import cycle the dependency gate flagged. |
| D | New leaf `packages/admin/src/imagery/search-timeout.ts`, read by the Imagery page's search and Settings' Save; `orders/lazy-card.ts` gains a generic `chunkTemplate` | Both callers share one value and one loader. |
| D | A date row whose frames are all in one live join links to it instead of **Join frames**; a row whose frames are all `joined` has no button | There is nothing left to start. |
| D | `packages/admin/vite.config.ts` unchanged, though §7 listed it | It needed no change. |
| E | `packages/test-support/src/fakes/usgs-downloads.ts`: a frame with a delivery counts as scanned, with a case in `functions/test/support/upstream-orders.test.ts` | §14's seeded frames. |
| E | `HCM_STATE_SCREENSHOTS` is read relative to the repository root, also when absolute | Noted in `docs/TESTING.md`; pass `reports/...`. |

## 17. After the review (2026-11-06)

A review of the whole tree confirmed these against the code and real GDAL probes (`docs/LESSONS.md` 366 to 369). The code holds.

| Design said | As fixed | Why |
| --- | --- | --- |
| §1, §3 step 9: node base = forward transform of a pixel; past 6 km a part equals its georef | A node pairs a place with the pixel GDAL's **reverse** transform reads there (`BaseTransform.forward`, `.reverse`); its target is the place plus the field. A `tps` part also keeps its own points as nodes (`anchors`) | A warp runs on the reverse fit, which differs from the forward one by tens of metres off nadir. A spline through a part's points and samples of itself is itself, so its detail survives past the taper. |
| §3: a part warps through its points or its nodes | A part over terrain (M15 *Terrain*, `georef.terrain`) is read through its RPC over the heights it carries (`steps/warp.py` `attached`, as its layer); with nodes it is read onto the level's grid first and its nodes placed on that grid (`join/warping.py` `ground_grid`, `regridded`) | Nodes in scan pixels carry the relief only between them: such a part lay 43 m RMS from its layer on a synthetic hill; on the real frames it now lies within a millimetre of it past the taper (M15 *Terrain*, review of 2026-11-08). |
| §3: 5 km nodes outside the band | `SPARSE_EVERY` 2: 2 km | The spline holds a curved transform only as well as its nodes are dense: 24 m at a corner at 5 km, 7.5 m at 2 km (40 degrees off nadir, median 0.02 m). "Equals its georef" reads: to a few metres at a far corner. |
| §2, §3: `maxShiftM` read at the nodes | `largest_move_m` compares the pixels both warps read at places between the nodes too | A spline holds at its nodes whatever it does elsewhere: the auto-publish's limit must see that. |
| §3 step 1: room for one scan | `join/room.py`: `align` two scans (a seam's), `merge` one scan, each part and the mosaic; `merge` checks again; a download that fills the disk is `joinNoRoom` | A retried run may find a fuller disk; `OSError` was an internal error. |
| §5 `worker/allow-list.ts`: a part's scan by its id | `ObjectScope.inputScans`: the `scan.path` each input version names, of this city | A re-georeferenced frame's scan stays in its base's folder (also a re-georeference of a re-georeference). |
| §1 "`scan.tif` survives until the sweep" | The sweep keeps a folder while another version's `scan.path` points into it, unless that one ended as long ago; a layer's deletion also takes a joined frame's scan folder | The base ends long before the frame that reads its scan. |
| §5 `isLiveJoin`: a failed join frees its parts | Still, and: `partsReady` also answers `gone` when a frame's `partOf` is not this join; `imagery.retry` of a join asks it in its transaction and goes back with `waitReason:'parts'`; a publish retry needs `go` | A retry would revive a join over frames that moved on, and a worker could claim it before the dispatcher looked. |
| §5 refusals: approve, reject, regeoref, crop, delete | Also Cancel: `cancelJob` withdraws the request on a frame a live join holds and logs `joinPartHeld`; the version page offers no Cancel | The Firestore rule cannot read the frame's join, so the refusal is the server's. |
| §5 `policyIn` skips a frame whose `partOf` is live | Skips any frame with a `partOf`; a re-georeference inherits it; `readPart` refuses a frame on its way to a layer of its own, unless it is the join's | "F040 can never auto-publish half a city" also once the join ended. |
| §2 `planDate`: a rendered frame uses `output.bounds` | Its outline inside its box; the box alone when the outline misses it | The box holds nodata. |
| §2 row | `spareFrames?`: free frames the choice left out, most of the city first, offered by a short join. The cap keeps dates with an imported frame first, and the order stays | An estimate of 95 % can measure 62 %; a frame waiting for approval must keep its offer. |
| §5 `join-plan.ts`: after a harvest and a frame's approval | Also any planned job at rest (`awaiting_gcps`, `failed`, `cancelled`, `succeeded`), a layer's deletion, and the tick for a city with no plan | A deploy finds frames waiting and no job moves; §9's "delete and start again" needs its row back. |
| `NOT_RETRYABLE_CODES` | Gains `joinSeamTooFar`, `joinNoFrames`, `joinPartMissing`; `joinPartGone` stays, as the frame's own retry can bring it back | The same frames measure the same. |
| §6 | A live join over any of a row's frames (read from the join's own `source`, as `VersionItem.entityIds`) links it instead of **Join frames**; a joined frame links its join; a published join's frames read Joined; Work rows and the version heading name the frame or "Joined frames"; `join.noSeams`, `join.seamRefused`, `join.rowCoverageOne`, `join.paidFrameOne`, `imagery.layer.joined` | One click could reject a rendered join; a join and its frames shared a title; the card must say why a join did not auto-publish. |
| §9 | The layer editor of a joined layer offers neither **Edit points** nor **Crop** and says to delete it and join again (`provenance.usgsParts`) | Crop's refusal said the layer was linked, which is false. |

New rows: `S-P05-HAPPY-OFF-NADIR`, `S-A65-BAD-NO-SEAMS`, `S-A65-BAD-SEAM-REFUSED`, `S-A65-BAD-RETRY-STALE`, `S-A65-BAD-CANCEL-HELD`, `S-A65-BAD-ENDED-NOT-AUTO`, `S-A65-HAPPY-NEW-POINTS-SCAN`; tour states `imagery.join-no-seams`, `imagery.join-seam-refused`.

**Left open:**

- Rehearsal D3 and the acceptance of §10 are the owner's: real USGS downloads and a real join.
- `imageryPlans`' read rule goes out with the admin, or the feed's denied read makes the shell ask `admin.session` again (`docs/MANUAL_TEST_PLAN.md` J0).
- `cssLiteralsPlugin` now minifies every `html` template and Upload opens through a chunk: both need the wider Playwright run, which the pipeline's `all` gives. E ran only the join's specs and `deploy` at four projects, so `bash scripts/dev/dev-stack.sh check` and `tour-matrix` are also still to run.
- Bundle margin: D measured 627.8 of 630 KB in production; E read 629.4 on a dist that may be the e2e build. The `build` stage decides.
- A seam can bend along a frame's own edge (§13): left as it is, worth looking at in the rehearsal.
- The local stack seeds no frames of one date (`e2e/stack/seed-content.ts` is unchanged), so a join is not walked LOCAL by hand: the specs walk it, and `docs/MANUAL_TEST_PLAN.md` J is LIVE.

## 18. Batch 4: frames that already are layers (2026-11-09)

The owner's live joins (2 February 1972: F039 and F040 each published as their own layer, `kh-9-hexagon-2-februarie-1972` and `-2`;
1980: A038 published, A039 awaiting approval) were refused with "Two of these frames are already published: delete one layer first" and,
on the old join's retry, "Frame D3C1216-100235A039 ended; import or retry it". The rules now (DECISIONS-for-review.md §138a–c):

| What | Where | Behaviour |
| --- | --- | --- |
| Which frames serve | `functions/src/imagery/join.ts`, `join-write.ts`, `join-parts.ts` | Any frame with a usable version: awaiting approval, approved, publishing or published (as a layer of its own or the join's). Only a frame with no usable version left refuses (`apiError.imagery.joinPartGone`, new words). The transaction no longer refuses a frame the policy approved meanwhile. |
| The join's layer | `join.ts` `publishedFrame` | With frames on layers, the join is a new version of the first published one's layer (else the first on its way to one); `apiError.imagery.joinTwoPublished` is gone. |
| The dispatcher and a retry | `join-parts.ts` `partsReady`, `dispatch.ts`, `retry.ts` | A frame published on another layer, approved or publishing is ready. A frame a newer join stamped is `taken`: `apiError.imagery.joinPartTaken` (not retryable: `NOT_RETRYABLE_CODES`), so the old join's card offers no Try again and names the newer join's frame. |
| Retiring the date's layers | `finalize-join.ts` (`readFrame`, `layerWrite`, `retiredByJoin`), `finalize.ts` | When the join publishes, each frame's own layer other than the join's leaves the manifest (`published: false`) with `retired: {by: <join version>, at}`; its tiles, versions and files stay (the history trigger records the change). A frame that publishes alone after its join published gets the same at birth. Nothing is deleted. |
| The admin | `packages/ui/src/admin/imagery/scene-list.ts` (`replacesNote`, in the Imagery chunk: `join-card` has no bytes left), `layers/geometry-group.ts` | Under Whole-city dates, while a date has a published frame: "A join of this date replaces its frames' own published layers once you approve it…". A retired layer's editor says **Replaced by the joined layer of its date** and links the join. |

Tests: `functions/test/imagery/{join,join-parts,join-finalize,retry}.test.ts`, `packages/ui/test/admin/imagery/join.test.ts`,
`packages/ui/test/admin/layers/layer-geometry.test.ts`; scenarios `S-A65-HAPPY-PUBLISHED-FRAMES`, `S-A65-BAD-PART-TAKEN`.

## 19. A frame joined before joins again (2026-11-12)

The owner's 1980-07-16 join was refused with "Frame D3C1216-100235A039 has no usable version left": its version `im-mw819cxc` was
`joined` (an earlier join had used it, 11.7 m at its checkpoints), which `ENDED_VERSION_STATES` holds, and the scene page offered no
Import, so nothing could be done. `join-parts.ts` now counts `joined` with `published` as an ended state that still serves
(`ENDED_YET_USABLE`): `isUsablePart` takes it for a new join (unless it is itself a join), `partsReady` counts it ready (it has its
output), and only rejected, superseded, failed and cancelled frames are gone. Tests: `functions/test/imagery/{join,join-parts}.test.ts`;
scenarios `S-A65-HAPPY-JOINED-FRAME`, `S-A65-BAD-PART-GONE`.

## 20. Archive maps joined (2026-11-14)

The owner's harti.zip maps include maps in parts: the n and S halves of 1978, 1974-01 and 1974-02, the 1:500 sets per year, sheet series.
`imagery.join` also takes `{ cityId, versionIds }` (2 to `JOIN_MAX_PARTS` archive versions, `functions/src/imagery/join-archive.ts`):

- each part is an archive map (`source.kind: 'archive'`, a regeoref of one included), usable (published, approved or awaiting approval),
  with a scan and points of its own (`georef`, not `embedded`; else `apiError.imagery.joinNeedsPoints {map}`), one version per map
  (`joinSameLayer`), and held by no live join;
- the join is a new version of the first published part's layer (else a new layer), labelled with the parts' labels (`N + S`); the other
  parts' layers retire when it publishes, as in §18; approval is the usual one;
- its `layer-join` parameters carry `maxzoom` (the parts' largest) instead of a camera; the parts in its `source` have no dataset, camera
  or date, and their `entityId` is their version id;
- `align` keeps every part on its own fit: the seams are measured and reported (`applied: false`, `maxShiftM: 0`), a seam too far apart
  fails as before (`joinSeamTooFar`), and a part that shares no seam with another fails with `apiError.imagery.joinMapsApart {a, b}`;
- the version page of an archive map offers **Join with…** (`<hcm-archive-join>`): one button per other map of its year that the join can
  take, then a link to the join. Scenarios: S-A65-HAPPY-ARCHIVE, S-A65-BAD-ARCHIVE-NO-POINTS, S-A65-*-ARCHIVE-OFFER, S-P05-*-ARCHIVE*.
