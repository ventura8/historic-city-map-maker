# M16: Recalibrate a published layer (contract)

The owner, 2026-11-08: "build in the ability to calibrate even more a satellite image after publishing (manual, automatic, semi-auto)". No cloud project, Mapbox or Chrome is touched by this work; nothing runs in production yet.

## 0. What exists, and what this adds

Before this milestone a published layer could already be changed in one way: the georeferencer's **Save** on a published version, or on one waiting for approval, makes a new `regeoref` version from the same scan (`functions/src/imagery/regeoref.ts`, `save-gcps.ts`), which waits for Approve (it has no `calibration`, M9 §11). Nothing measured whether it was better, nothing refined a fit automatically once it existed, and the proof's dense matching (`calibrate/`, M9 §4) ran only inside an import.

This milestone adds, on **every published layer and on a version waiting for approval**:

| Route | Who starts it | What it does | Renders |
| --- | --- | --- | --- |
| **Automatic** (`route: 'auto'`) | **Refine automatically** on the version's page | Reruns the proof and the dense matching on the stored scan, started from the current fit | Only if the held-out figure improves on the current fit's, measured on the same checks (§2); otherwise the job ends with the reason and nothing changes |
| **Semi-automatic** (`route: 'points'`) | **Snap my points** in the georeferencer, after placing 1 to 12 rough points where the image looks off | The rough points bend the start; the dense matching snaps them and spreads tiles around them | Whenever the proof holds; the figures before and after are on the page, and the proposed pairs can be accepted (Approve) or rejected one by one in the georeferencer (§3) |
| **Manual** (`route: 'manual'`) | The georeferencer's **Save**, as today | Every pair editable | Always; figures before and after when the version holds checkpoints the fit never saw (§2) |

Every route makes a **new version** of the same layer, from the same scan. It is drawn at full detail on the version's page (M12's own tiles, `docs/research/M12-own-tiles.md`), with **Show the current one** swapping the same map to the layer's current image at full detail, and the two figures side by side. It replaces the current one only through Approve. **A published layer is never replaced by a worse one without the owner choosing it** (§4).

## 1. The model

`layerVersionDocSchema.recalibration` (`packages/shared/src/schemas/imagery-recalibration.ts`; twin `RecalibrationInfo` in `pipeline/src/hcm_pipeline/documents.py`):

```ts
recalibration: z.strictObject({
    route: z.enum(['auto', 'points', 'manual']),
    // The version waiting for approval that this one replaces once it is rendered (auto, points); see §5.
    replaces: idSchema.optional(),
    // The admin's rough points (points): a pixel of the scan and where it lies, 1 to RECALIBRATE_MAX_POINTS (12).
    points: z.array(z.strictObject({ pixel: pixelSchema, geo: latLngSchema })).min(1).max(12).optional(),
    // Written by the pipeline: the current fit and the new one on the same checks (§2), the proof's tiles, the pairs near the points.
    before: figure.optional(), after: figure.optional(),   // figure: { rmseM: metres, checks: count }
    tiles: z.strictObject({ agreed: count, tried: count }).optional(),
    proposed: count.optional(),
}).optional()
```

The server writes `route`, `replaces` and `points`; the pipeline adds `before`, `after`, `tiles` and `proposed` (`WORKER_VERSION_FIELDS` gains `recalibration`, and `worker.step` refuses a write that changes the server's part or adds a `recalibration` to a version that had none: `step-update.ts` `recalibrationAllowed`). `basedOn` (already on every `regeoref` version) names the current version. Job parameters do not change: a recalibration is a `regeoref` job whose version carries `recalibration`.

`recalibrationVerdict(recalibration)` in `@hcm/shared` is the one reading of the figures, used by the approval and the page: `better` when both figures exist and `after.rmseM <= before.rmseM - RECALIBRATE_MIN_GAIN_M` (1 m: a checkpoint figure of a dozen checks moves that far with the seed alone, M9 §14), `worse` when both exist and it is not better, `unmeasured` otherwise. The pipeline's twin (`steps/recalibrate.py`, `Compared.better`) reads the same constant from `contract.py`, held equal by `enums.json`.

## 2. The ruler

The product's ruler is the held-out checkpoint figure: `georef.checkpointRmseM` with `checkpointKind: 'held-out'` (M9 §7, §11), in ground metres (`transforms.residuals_m`). Comparing the current version's own figure with the new one's would compare two different sets of checks: A001's moved from 13.0 to 21.3 m with the seed alone (M9 §14). So **both figures are measured on the new version's checkpoints**:

- `after` is the new fit's `checkpointRmseM` over its disabled pairs (`checks` of them);
- `before` is the current version's transform (refitted from its stored pairs: `fit(base.transform, base.gcps)`) over **the same pairs**.

The checks are dense tiles read from the match, never from either fit (M9 §7: `CHECK_MIN_PEAK`, `CHECK_MIN_MARGIN`), and none of them was in the current fit's pairs, so the comparison is fair to both. A manual version gets figures only when it holds at least `RECALIBRATE_MIN_CHECKS` (3) disabled pairs; leave-one-out compares nothing (M9 §13.1), so it reads `unmeasured`.

## 3. The pipeline (`pipeline/src/hcm_pipeline/steps/recalibrate.py`)

`GeorefStep` (`steps/georef.py`) hands a version with `recalibration.route` `auto` or `points` to `RecalibratedGeorefStep` (a subclass registered as the `georef` step) before anything else, and a manual recalibration's fit gets its figures in its `_fitted`. `georef.py` itself only gained a `given` reference for `measured_on_scan` and a public `TransformMap`.

- **The references.** A `regeoref` job has no `reference` step: `refine` reads the city window's Sentinel-2 and OpenStreetMap from their caches (`steps/common.sentinel2`, `osm_features`; fetched once more only when the cache is gone), the same window an import used.
- **The start.** `auto`: the current fit. `points`: the current pairs farther than `POINT_REACH_GROUND_M` (1,500 m) from every rough point, plus the rough points, fitted with the current transform (affine when fewer than six pairs are left).
- **The search.** `max(PROOF_SEARCH_GROUND_M, min(3 x the current checkpoint figure, 2000))` for `auto`, as M9's seeded points; for `points`, at least twice the largest distance between where the current fit puts a rough point and where the admin put it, within 2,000 m.
- **The proof.** `measured_on_scan` and `calibrated` unchanged (M9 §4, §7): every gate holds, the last look included; checkpoints set aside before RANSAC.
- **Endings.** The proof refused: the job ends **declined** with `apiError.imagery.refineRefused` (both routes). `auto` with fewer than `RECALIBRATE_MIN_CHECKS` held-out checks to compare: declined with `apiError.imagery.refineUnmeasured` (the tiles agreed; only the comparison was impossible). `auto` not `better`: declined with `apiError.imagery.notImproved {before, after}`. Declined is a new outcome (`jobs.Declined`): the job and its version end `cancelled` with that error, so the dispatcher releases the layer (`releaseCancelled`) and nothing else changes. `worker.step` accepts a run's `cancelled` without `cancelRequested` only with one of these codes (`RECALIBRATE_DECLINED_CODES`), on a `regeoref` job.
- **`proposed`**: the new pairs within `POINT_REACH_GROUND_M` of a rough point.
- **Log**: `refined: 812 of 1,004 tiles agree; 14.1 m against the current 17.6 m on the same 21 checks` / `declined: 16.9 m against the current 17.2 m on the same 21 checks, not 1 m better`.

## 4. The approval

- **The policy** (`functions/src/imagery/approval.ts`): a version with `recalibration` never publishes itself. The owner asked to see it beside the current one first.
- **Approve** (`imagery.approve`, request `{cityId, versionId, acceptWorse?: true}`): a version whose verdict is not `better` (worse, or unmeasured) is refused with `apiError.imagery.notBetter` unless `acceptWorse` is true. The figures compare the new fit with its `basedOn`, so they count only when that is the layer's published version (or the layer has none yet; `againstCurrent`, read in Approve's transaction). The policy drops them otherwise, so the page reads `unmeasured` and asks: a refine of a version that was itself waiting (a Save, say) never launders a fit that would have needed the owner's choice. The page asks first ("The new fit is not shown to be better. Replace the current one anyway?"), so the owner chooses it in words. Reject works as for any version.
- **Publish** is unchanged: the new version supersedes the current one (M12 §5), whose public archive stays for its grace.

## 5. Concurrency and the version waiting for approval

- A published current version: the new version holds the layer's `pendingVersion` from the start (as `regeoref` does); a second recalibration is `apiError.layers.busy` until it ends.
- A current version **waiting for approval**: the georeferencer's Save replaces it at once, as today. Refine and Snap do **not**: they may decline, and a declined refine must leave the waiting version where it was. So the new version records `replaces: <current>`, the current keeps `pendingVersion`, and when the new one reaches `awaiting_approval` the policy's transaction cancels the current version and its job and moves `pendingVersion` to the new one (`recalibrate-replace.ts`). The replaced version is only the new one's own `basedOn`, on the same layer. A current version approved or rejected meanwhile is left as it is; one approved and still publishing leaves the mark to the new version, as a publish clears only its own mark (`finalize.ts`). A second Refine or Snap, or a Save, on the same waiting version while one runs is `apiError.layers.busy`, decided in the start's transaction: the waiting version records the refine started from it (`refining`, its job read there; a stale one, the refine ended, is ignored), since the layer's mark stays on it and cannot serialize two starts.

## 6. Joined layers (M8)

A join has no scan and no `georef` (M8 cut: it cannot be georeferenced). **Refine automatically** on a join (published or waiting) recalibrates each frame and joins them again:

1. Each frame (`state: 'joined'`, or published) gets an `auto` refine of its own (`recalibration.rejoin: <join>`); a frame's refine never declines inside a re-join: not better, it renders its current fit again (`keep`), so the new join has every frame.
2. A new `layer-join` job over those versions is born waiting for its frames (`waitReason: 'parts'`, as `imagery.join` makes it), on the join's layer, with `recalibration {route: 'auto', before}` where `before` is the current join's `checkpointRmseM` and checks.
3. The join's `checkpointRmseM` is its `after`; the approval reads the verdict as above. The frames stay `partOf` the new join; the old join's frames stay as they were until it is superseded.

**As built:** step 1's frame refines and step 2's waiting join are **not built**, and nothing else improves a joined layer today: `imagery.recalibrate` on a join answers `apiError.imagery.joinRecalibrate`, which says only that a joined layer cannot be calibrated again yet. Its frames are no way round it: a published join's frames are `joined` (refused with `versionState`, and the page offers nothing), a waiting join's are held (`joinPartHeld`). (Until 2026-11-08 the message told the owner to refine each frame and join them again, which no path allowed.) Reason: M8's `writeJoin` takes scenes, not versions, and a re-join from versions is a second entry into M8's plan that the join track owns.

## 7. The page

The version's page gets a **Calibrate again** block (`packages/ui/src/admin/imagery/recalibrate/recalibrate-card.ts`, a lazy chunk of its own, `recalibrate-card`): on a published version or one waiting for approval, with a scan and pairs, **Refine automatically** and **Place rough points** (the georeferencer, where **Snap my points** sends the points added since it opened); on a recalibrated version, the figures (`Before: 17.6 m · After: 14.1 m, on the same 21 checks`, or `Not measured on the same checks`) and **Show the current one** / **Show the new one**, which swaps the page's one map between the two archives at full detail (the current one's public archive, or its private one through `imagery.previewUrl` while it waits). Words in `adminContent.imagery.recalibrate.*`, ro and en.

## 8. Rows

`S-A89-HAPPY-REFINE`, `S-A89-BAD-NOT-IMPROVED`, `S-A89-BAD-BUSY`, `S-A89-HAPPY-POINTS`, `S-A89-BAD-POINTS-REFUSED`, `S-A89-HAPPY-APPROVE-BETTER`, `S-A89-BAD-WORSE-NEEDS-CHOICE`, `S-A89-HAPPY-REPLACES-WAITING`, `S-A89-BAD-DECLINE-KEEPS-WAITING`, `S-A89-BAD-JOIN`, `S-P19-HAPPY-REFINE`, `S-P19-BAD-NOT-IMPROVED`, `S-P19-HAPPY-POINTS`, `S-P19-BAD-REFUSED`, `S-P19-HAPPY-MANUAL-FIGURES`.

## 9. To reconcile with track/accuracy

That branch changes the transform (a camera model, a rendered lattice) and the georeferencer's figures. What this track depends on, kept small on purpose:

- **`steps/georef.py`**: `RecalibratedGeorefStep` subclasses `GeorefStep` (its `run` and `_fitted`), and uses `measured_on_scan(..., given)`, `TransformMap`, `recorded`, `job_seed`, `references`, `osm_lines`. If those move or change shape, the subclass follows.
- **The current transform** is refitted from the current version's stored pairs (`georef.transforms.fit`). If the camera model or the lattice becomes what renders, `recalibrate.current_fit` must build the model the current version rendered with, or `before` measures a map nobody sees.
- **The ruler**: `transforms.residuals_m` and `rmse` over the new version's disabled pairs, `checkpointRmseM` and `checkpointKind`. If the accuracy branch changes the figure the product reports (another error measure, or checks of another kind), `before` and `after` must follow it in one place (`recalibrate.figure_on`), and `RECALIBRATE_MIN_GAIN_M` must be re-read against its noise.
- **The semi-automatic route's reach** depends on the transform: a `poly2` over hundreds of pairs cannot bend near five points, so the snapped tiles there are RANSAC outliers unless the whole map moves. Its effect is local only with a local transform (the lattice). Until then Snap mostly helps where the current fit is off as a whole.
- **`calibrate.pairs.calibrated`, `calibrate.dense`, `proof`**: called unchanged.
- **`functions/src/imagery/approval.ts`**: one more condition (`recalibration === undefined`) and the replace call in `policyIn`.

## 10. Not verified

Real frames: no recalibration ran on a real scan here, so `RECALIBRATE_MIN_GAIN_M`, the search widths and `POINT_REACH_GROUND_M` are first values; the figures' noise between two refines of the same scan is unmeasured. The re-join of §6. A real worker or Cloud Run run of a `regeoref` reading the reference caches.

## 11. As built (2026-11-08)

Every route of §0 is in, with the server, the pipeline, the admin and the stand-in; no cloud project, Mapbox or Chrome was touched.

- **Rows:** behaviour `A89` (admin) and `P19` (pipeline), not the numbers of §8 (A80 to A84 and P07 were taken or likely to be taken by other tracks): `S-A89-*` and `S-P19-*` in `e2e/scenarios.json`. Tour states `imagery.version-recalibrate`, `imagery.version-recalibrated`, `imagery.version-refine-declined` (`e2e/admin/specs/imagery/recalibrate.spec.ts`).
- **Not built:** the re-join of §6 (a join answers `joinRecalibrate`, which promises nothing); the base page's line about the last refine that declined (the new version's page says it, and the Refine button opens that page).
- **The start of Snap** bends the current fit with every rough point's correction weighed by the inverse square of its distance, plus the points themselves, rather than dropping the current pairs near them: one point moves the whole map, several bend it as far as the transform can (§9).
- **Search for Snap** is at least twice the furthest the bent start misses a rough point by (a rough point is rough), within 2,000 m.
- **The ruler's checks** for Refine and Snap are `calibrated`'s held-out cells; for the manual route, the admin's disabled pairs (at least 3). A figure is written with two decimals; the decline's parameters with one.
- **Budgets:** a new lazy chunk `recalibrate-card` (0.8 KB, row 2 KB); `approval-map` 3.9 of 5, `imagery` 16.7 of 18, `georef` 16.7 of 17, `editor-shared` 12.9 of 13, the admin 645.4 of 650 (before the merge with M15; after it, `georef` 17.2 of 18 with Snap my points and the published maps in the lazy `georef-extras`, 1.0 of 2: `DECISIONS-for-review.md` §110). `editor-shared` paid for the new callable with a real saving: the admin's `imagery/api.ts` carries no request schema any more (the server validates every request; the types stay).
- **A published version's page** now draws its public archive (its private one went at publish), so the current version is seen at full detail beside a recalibration; before, such a page showed the small picture.
- **Counts:** the registry has 91 functions (`imagery-recalibrate`); 93 after the merge with stories (two triggers).

## 12. Review fixes (2026-11-08)

- **Figures against the published version** (§4): the policy drops `before`/`after` of a recalibration not `basedOn` the layer's published version, and Approve checks the same in its transaction. Tests: `functions/test/imagery/recalibrate-guards.test.ts`.
- **The worker's part of `recalibration`** (§1) and **`replaces` only the own base on the same layer** (§5): `step-update.ts`, `recalibrate-replace.ts`; tests in `functions/test/worker/step.test.ts` and `recalibrate-guards.test.ts`.
- **A publish clears only its own pending mark** (§5): `finalize.ts`; `functions/test/imagery/publish.test.ts`.
- **Two starts on one waiting version** (§5): `refining` on the waiting version, read in the start's transaction (`regeoref.ts`).
- **The join's message** (§6) no longer advises a route that does not exist; **`refineUnmeasured`** (§3) names a refine with too few checks to compare.

## 13. At the merge with the improvements (2026-11-08)

- A recalibration is a `regeoref`, so it never counts against the day's import limit (M18 item 3); only a red budget guard stops it (`recalibrate-guards.test.ts`; S-A89-HAPPY-FREE-OF-DAY-LIMIT, S-A89-BAD-GUARD-RED).
- Delete keeps the improvements' one word; on a recalibration of a published version the question and the notice say that only the new fit goes and the published version stays; of a waiting version, the question is any image's (S-A89-HAPPY-DELETE-NEW-FIT, S-A89-BAD-DELETE-WAITING-BASE; DECISIONS §104a).
- Refine automatically and Snap my points show `tune` (the icon subset has no `auto_fix_high`).

## 14. At the merge with the accuracy track (2026-11-08)

What §9 listed, as reconciled with M15 (`docs/research/M15-calibration-accuracy.md`):

- **The current map is the one its layer shows** (`steps/recalibrate.py` `rendered_map`, `Current`): GDAL's own transformer of what the warp is handed (`steps/warp.py`): a thin-plate spline through `rendered_points` (a spline's own points, a polynomial sampled on 17 x 17 nodes, a panoramic camera's stored `georef.lattice`), or, for a frame fitted over terrain, its RPC over the heights it carries. Its pairs and its figure are still refitted from the record (the search width, the bent start's pairs). Before the merge `before` measured the polynomial of the current pairs, which on a camera or terrain version is not what the public sees (S-P19-HAPPY-CURRENT-AS-RENDERED, S-P19-BAD-CURRENT-AS-RENDERED).
- **`figure_on`** takes any map (`misses_m`, the same ground metres as `transforms.residuals_m`). `after` stays the new fit's `checkpointRmseM`, the figure its version page and the approval policy read; M15 keeps that figure the rendered map's (the camera's, or the RPC's within 0.03 m).
- **The georef step subclass**: `GeorefStep.run` and `_fitted`, `measured_on_scan(..., given)`, `recorded`, `job_seed`, `references`, `osm_lines` kept their shapes; `measured_on_scan` takes the start as a `PlaceMap`. Refine still starts from the current pairs' fit: a start must reach the window's corners, past the scan, where an RPC over the heights under the scan gives nothing (the first try failed on exactly that). A `georef` retry over a stored lattice keeps it (M15), which never concerns a recalibration: its `run` is M16's, and the georeferencer's Save drops the lattice.
- **Snap with the camera model**: the rough points' corrections are measured against the rendered map, so a camera or terrain version is bent from what it shows. The new fit is a polynomial of the proof's pairs, as any re-measured proof: a `regeoref` job has neither `calibration.json` nor the film's offset, which the camera and the terrain fit need. It renders through its 17 x 17 nodes. A camera version is therefore refined only when that polynomial beats the camera on the same checks; its local reach is still the polynomial's (§9).
- **Approval**: unchanged; M15 changed no policy. A terrain version's DEM notice follows the version published (`finalize.ts` `attributionOf`), so a recalibration that replaces it with a flat fit drops it.
- **Not built**: a refine that refits the camera or the terrain (it would need the film's offset and `radPerPx` kept on the version), and a refine joined to the frames held still (its own base would be one of them).
