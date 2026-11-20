# M9: import and calibration for any place on Earth (contract, at a65f7bb)

The source: the owner, 2026-11-06. Any location, automatic, minimum input; AI only local (GPU first, CPU fallback). References: Sentinel-2 and OpenStreetMap only, never Mapbox Satellite or a `fostulbucuresti` resource.

**Status:** the pipeline workstream is built and rehearsed on real KH-9 panoramic, KH-7, KH-9 mapping and KH-5 frames (§14; no real Corona yet); the server+admin workstream is built (§15). A value marked *first* has no refusal measured against it yet, except where §14 says so.

## 0. Evidence and corrections

A new probe (`reports/calib/vote3.py`, `honest.py`; NUC, votes on 1 core, dense at `--cpus=4 --memory=16g`) replaces `vote2.py`'s 48 warps: **one warp per corner assignment**, 64-cell tiles at 43 m ground, a similarity RANSAC over the tiles' votes (a tile tolerates scale and rotation error; the consensus measures them).

| Window on frame | Votes agreeing | Hull | Shift dx, dy (m) | Known (m) |
| --- | --- | --- | --- | --- |
| Bucharest, F006 | 21 of 182 | 0.106 | +10320, +17289 | +10080, +16800 |
| Bucharest, F007 | 22 of 182 | 0.228 | +1830, +13869 | +1680..2280, +13300..15000 |
| Bucharest, F040 (winter) | 13 of 182 | 0.218 | +1977, +9375 | sibling F039: +2776, +10906 |
| Bucharest, A001 (1982) | 3; corner homography 4 | 0 | none | none |
| Slobozia, Slatina, Fetești on F006 | 3, 4, 6 | ≤ 0.038 | none | none |
| Pitești on F006 | 33 of 169 | 0.138 | +1413, +13179 | none; proof not run |

Votes took 52 s for four warps on one core, 0.48 GB. Dense from those proposals, no landmark:

| Frame | Inliers / candidates, poly2 | Dense, 4 cores, warm disk | 5-fold on inliers | Checks of §7, two folds |
| --- | --- | --- | --- | --- |
| F007 | 697 / 896 | 25 s | 12.8 m | 10.5, 16.3 m |
| F006 | 414 / 505 | 21 s | 12.5 m | 15.1, 14.2 m |
| F040 | 414 / 578 | 24 s | 13.0 m | 16.4, 17.5 m |

Corrections:

- **F040 is not refused.** From a proposal, tile 128 px, search ±80 px: 414 inliers, where the earlier run had 16 of 363. A checkerboard by eye on one region agrees; no landmark checked it.
- **A001 was the model's fault, and is found** (§14). Its film is half as long as a full frame's: KH-9 swept 60 degrees, not 120, and off the nadir. Under the full centred sweep 3 of 196 tiles agreed, under the corner homography 4, under this one 24 in the first probe. Written before that was known: its rows in the table above and in §6 no longer describe the product.
- **11 to 12 m flatters.** `refine.py` cross-validates its RANSAC inliers, capped at 25 m. Tiles held out before RANSAC: median 10 to 17 m, RMSE 15 to 33 m. So **some real frames will miss the 15 m auto-publish threshold and wait for one click**. The threshold stays.
- **A vote must refuse partly covered places.** Unmasked, every tile peaked at the frame's edge (0.43 against the truth's 0.34): a confident false consensus.
- **`warp` does not clip.** `steps/warp.py` has no `outputBounds`; M8's "every warp clips" holds only for `align`. Hence 1,249 km² rendered.
- **`coverage_pct` (`steps/merge.py`) divides by the city inside its grid**: right for a join's canvas, inflated for a crop.

## 1. The chain

New package `pipeline/src/hcm_pipeline/calibrate/`, called from `steps/locate.py` and `steps/georef.py`:

1. **Model:** `first_guesses` (`georef/corners.py`), the plausible assignments, panoramic for a sensor with `half_angle_deg`, else the corner homography. A frame over longitude 180 is one piece around the city (`around`, `documents._one_piece`); a window ends on the line (`MercatorBox.expanded`), and no pair is written past it (`inside_world`). `CityNotFoundError` stays for a frame reaching the window under no orientation, "reaching" read over the window widened by the sensor's search range **on the ground** (below) or half its size if that is more: a 10 km town the model puts 14 km past the film's edge gets its search, and, refused, its bounded crop and the admin's points.
2. **Prior**, then **votes** (§2).
3. **Prove** each proposal, best first, at most `PROOF_MAX_PROPOSALS = 3` (§4).
4. **`ProposalMatcher`** only if nothing proved (§3); same proof.
5. Proved: §5. Not: §6.

`SensorSpec.search` (the pipeline's alone, not in `as_contract`) holds ranges in ground metres, converted by `ground_scale` of the window's latitude; cells and tiles too, so 60 degrees and the equator see the same ground:

| Sensor | Model | Margin | Scales |
| --- | --- | --- | --- |
| KH-9-pan | panoramic | 30 km | 1, 0.94 (full sweeps measured 0.915 to 0.956, short films 0.998 to 1.010: §14) |
| KH-4, 4A, 4B | corners | 30 km | 0.85, 1, 1.15 **UNVERIFIED**: no real Corona frame has run (§14) |
| KH-5 | corners | 30 km | 1; one real frame, which nothing proves (§14); its search is held to 10 min (`search_seconds`, 2026-11-12: an hour with no end), then the city's crop by the footprint waits for points |
| KH-7 | corners | 30 km | 1, 1.1, each at shears 0 and ±7.5 degrees; one real frame (§14) |
| KH-9-mapping | corners | 15 km | 1; one real frame (§14) |

## 2. Propose (`calibrate/votes.py`, `prior.py`)

- `VOTE_CELL_GROUND_M = 43`, `VOTE_TILE_CELLS = 64`, `vote3.py`'s gradient filter, `VOTE_SIDE_MAX_PX = 2400` (a wider search image coarsens the cell).
- `VOTE_TILE_BUDGET = 720` matches a frame, shared over the warps, each at least `VOTE_WARP_MIN_TILES = 180` (4 warps: 180 tiles; 12: 180, 2,160 matches). At 60 a warp no real frame reached `VOTE_MIN_AGREE`; the model's own scale goes first, so a strong proposal ends the search before the wider scales cost anything. Counted, not timed: deterministic. The preview's pixel is the frame's long side on the ground over its long side on film (`frame_pixel_m`), so a strip running north-south and scanned as its width is not shrunk ten times too far.
- A place under `VOTE_PLACE_COVERAGE = 0.9` cannot win; `VOTE_MIN_PEAK = 0.12`; a flat tile is not asked.
- Consensus: `cv2.estimateAffinePartial2D`, ±3 cells, seeded by the job id. A proposal needs `VOTE_MIN_AGREE = 8`, `VOTE_MIN_HULL = 0.05`, scale within `VOTE_SCALE_TOLERANCE = 0.12`, rotation within `VOTE_ROTATION_DEG = 3` (from the eight windows above).
- **Aggregation:** proposals of one assignment with centre shifts within `VOTE_MERGE_GROUND_M = 1000` merge, votes added. Weak consistent clusters reach the proof, which decides.
- **Early stop:** `VOTE_STOP_AGREE = 16` goes to the proof at once; only a refusal resumes voting.
- **Same-pass prior:** key mission + camera letter + date (`D3C1203-300415`, `F`, date; `/([A-Z])\d+$/` as in `imagery/join.ts`). `cities/{city}/imageryPasses/{key}` holds the last proved `model`; `imagery.onJobWrite` writes it when `locate` ends proved; `functions/src/worker/allow-list.ts` adds it read-only. The prior warps first, `PRIOR_MARGIN_GROUND_M = 12000` (neighbours measured: 6.5 km F006 to F007, about 1 km F039 to F040). A refusal falls through to the full search.

## 3. The `ProposalMatcher` port (`calibrate/ports.py`)

```python
class ProposalMatcher(Protocol):
    name: str
    def propose(self, request: ProposalRequest) -> Sequence[Proposal]: ...
# ProposalRequest: frame preview, Sentinel-2 window, OSM lines, grid, sensor. Proposal: film-to-EPSG:3857 matrix, support.
```

`NullProposalMatcher` is today's only one, injected as `Services.proposal_matcher`. A later local matcher plugs in on the worker alone, under the network guard, never reaching a remote model. Its output is only a proposal: the gates do not soften.

## 4. Prove (`calibrate/dense.py`, `proof.py`)

- Read the proposal's window plus the search reach at `PROOF_READ_GROUND_M = 5` a pixel: new `Segment.averaged_window` (`frames.py`, `AVERAGED`), a segment at a time.
- Warp onto the reference grid (a whole factor coarser where 10 m Mercator is under about 5 m ground). `PROOF_TILE_GROUND_M = 900`, every 450 m. `PROOF_SEARCH_GROUND_M = 600`, halving, at least 10 cells; 3 iterations, refitting. A whole-frame Corona can exceed OpenCV remap's 32 766 px side: `_remap_bounded` / `warp_film` downsamples the source for `cv2.remap` while the maps stay in the original read (lesson 746; S-P06-HAPPY-REMAP-BOUNDED / S-P06-BAD-REMAP-NARROW).
- A tile counts with `PROOF_MIN_PEAK = 0.2` and `PROOF_MIN_MARGIN = 0.03` over the best beyond ±8 cells.
- RANSAC poly1 then poly2, `PROOF_RANSAC_M = 25` ground (2.4 and 1.6 times first), job-id seed. Metres use each pair's latitude, never `refine.py`'s fixed cosine.

Accepted when **all** hold; `refusal` names the first that fails:

| Constant | Value | Measured |
| --- | --- | --- |
| `PROOF_MIN_INLIERS` | 60 | 414 to 697; a refused run 16 |
| `PROOF_MIN_SHARE` (of candidates) | 0.5 | 0.72 to 0.82; a refused run 0.04 |
| `PROOF_MIN_SPREAD` (hull / covered window) | 0.4 | *first* |
| `PROOF_MIN_COVERED` (of the window) | 0.05 | *first* |
| `PROOF_MAX_CV_M` (blocked 5-fold, §7) | 30 | *first*; folds 10 to 31 |
| `PROOF_MAX_GROSS` (checks over 100 m) | 0.2 | 0 to 0.13 |
| `PROOF_MIN_CHECKS` (refusal `cross-validation`) | 5 | 64 to 139 on real frames; one tile decided both gates above |
| `PROOF_MAX_RIVAL`, `RIVAL_MIN_SHARE` and `RIVAL_MIN_SIGMAS` (refusal `rival`) | 0.5; 0.1 and 10 | §14: 3.6 to 4.3 sigmas on real frames |

**The last look (`calibrate/rival.py`).** `measure` narrows to about ±150 m, so a tile whose true place lies further has no peak and leaves `tried`: every gate above counts survivors. A lattice of fields proved a map 800 m wrong, and a film with its east 30 % displaced 357 m read 2.2 m at the checkpoints (`docs/LESSONS.md` 374). So once every gate holds, up to `RIVAL_TILES = 400` tiles search `RIVAL_SEARCH_GROUND_M = 1500` around the final map and their score maps are **added**: noise cancels, and where the film as a whole agrees remains. Beyond `RIVAL_NEAR_GROUND_M = 200` of the map's own place, a peak over half its height is a repeat, and one over a tenth and 10 standard deviations of the sum's noise is a part of the film that belongs elsewhere. Under `RIVAL_MIN_TILES = 30` the sum says nothing. It does not see: a displaced part under about 15 % of the window, or further off than the search, or one with no texture. What no tile looks at, the approval's `measuredPct` (§11) leaves to a person.

## 5. On proof (`steps/locate.py`)

- Crop only what the frame reaches of `city_window(ctx)`, through the proved map, on the exposure, `PROOF_CROP_PAD_PX = 64`.
- Corner GCPs from the proved map; pairs in `work/{city}/{job}/calibration.json`, so a retry does not re-measure.
- `delete_delivery` on proof only. `MIN_CORRELATION`, `surface.py`, `searched` and `_search_around` retire: the proof is stricter.
- `calibration.outline` (the exposure's edge through the proved map, clipped to the city's bounds, at most 32 vertices) and `coveredPct`. **The planner reads it:** `functions/src/imagery/join-plan.ts` passes `measuredOutline`; `cellsOf` (`imagery/join.ts`) prefers it over `coverageRing`.
- `steps/warp.py` passes `outputBounds = aligned_box(city_window(ctx))` when `source.kind === 'usgs'`: nothing renders or bills beyond the window.
- `steps/export.py` writes `output.coveragePct`: alpha over the city's bounds, **divided by the whole city's area** (fix `coverage_pct`, join's result unchanged).

## 6. No proof

`bounded_crop` (replaces `weak_crop`) **always fits**:

- `UNPROVEN_MARGIN_M = 20000` ground (replaces `WEAK_CROP_MARGIN_M`: F006 lay 14 km ground off) per reaching orientation, ordered by votes, coverage, then as given.
- A union's side over `MAX_SCAN_PIXELS` is cut to it, the first orientation's box kept whole; `calibration.cutOrientations` counts any lost.
- `within_limits` stays as a guard no input reaches. A001 (225,264 px) becomes 200,000 px and `needs_gcps`.
- The delivery stays (§15: what for). `georef/matcher.py` still runs at its unchanged bar, then the job waits and the corner pairs clear.
- Since 2026-11-12 (§17) the guess cuts only a frame searched whole, in time, and no larger than a scan shown whole; any other frame nothing proved is offered whole.

## 7. `georef` (`steps/georef.py`, `calibrate/pairs.py`)

**Proved frame:**

- Cells `PAIR_CELL_GROUND_M = 1600`, doubled until `DENSE_MAX_PAIRS = MAX_AUTO_GCPS` (200) fits; inside crop and window. One pair a cell, but no buffer between cells: tiles are 900 m at a 450 m step, so a pair and a check 450 m apart can read half the same pixels. Simulated, this does not flatter a poly2 figure at this leverage (16.73 m against a true 16.97 m; independent errors 17.61 against 16.71).
- Every fifth cell (`AUTO_GCP_CHECKPOINT_SHARE`) is set aside **before this RANSAC**; `measure`'s earlier rounds refit on every tile, held ones too, and centre the last search on that map. Its strongest tile with `CHECK_MIN_PEAK = 0.3`, `CHECK_MIN_MARGIN = 0.06` (reading the match, never the fit) is a real checkpoint (`enabled: false`). Over `CHECK_GROSS_M = 100` it is dropped and counted in `checksDropped`; the rest are not trimmed. `checkpointRmseM` is therefore the survivors' figure: a dropped check may be a false match or a part of the map that is wrong, and nothing can tell them apart, so any dropped check keeps the frame from publishing itself (§11) and its card says so.
- RANSAC on the other cells; each cell's strongest inlier is a pair: `origin: 'auto'`, `score = max(AUTO_GCP_MIN_CONFIDENCE, min(1, 2 x peak))`, no suggestions.
- `affine` or `poly2` by blocked 5-fold; `poly2` needs `MIN_POLY2_PAIRS` and `TRANSFORM_MIN_GAIN_M = 2`. `tps` is never automatic; poly3 is cut (about 1 m, three twins to change). `crossValidatedM` is that blocked figure, steadier than one split; with no fold to hold there is no figure, never `Infinity`, and a fold needs more pairs than its own order's minimum (6 or 7 pairs read infinite, and every reader of the document would have refused it).

**Since M15 (`M15-calibration-accuracy.md`, *As built*):** a KH-9 pan frame is mapped by its camera, fitted on every gated tile of the cells not held, and carried to the warp as `georef.lattice`; every fit renders through `-tps`, so the published layer is the fitted map. The pairs and checks above are unchanged; their residuals and figures are the camera's.

**Admin's points seed the same step.** `method: 'gcps'`, at least `MIN_GCPS.affine` enabled, none `auto`, none disabled: their fit starts `dense` on `scan.tif`, search `max(600, min(3 x checkpoint RMSE, 2000))`. Proved: `method: 'auto'`, `how: 'points'`, `seedPoints`, the rough points replaced, and the log says so. Refused: `fit_points` as today. A set holding `auto` pairs is fitted as saved, so a later edit is never overwritten.

**Schemas** (`packages/shared`, twins in `documents.py`):

```ts
// georefSchema; fit.ts and transforms.py derive it: disabled pairs -> 'held-out', else 'leave-one-out'
checkpointKind: z.enum(['held-out', 'leave-one-out']).optional(),
// outputSchema
coveragePct: z.number().min(0).max(100).optional(),
// layerVersionDocSchema
calibration: z.strictObject({
    how: z.enum(['votes', 'pass', 'points', 'matcher', 'local-ai', 'none']), // 'matcher': proved, but the tiles gave no fit
    measuredPct: pct.optional(), // the agreeing tiles' hull over what the frame covers of the window
    model: z.strictObject({ camera: z.enum(['panoramic', 'corners']), rotation: z.number().int(), mirrored: z.boolean(),
        scale: z.number(), rotationDeg: z.number(), dxM: z.number(), dyM: z.number() }).optional(),
    votes: z.strictObject({ agreed: count, tiles: count }).optional(),
    tiles: z.strictObject({ agreed: count, tried: count }).optional(),
    crossValidatedM: metres.optional(), coveredPct: pct.optional(), outline: ring.max(32).optional(),
    checksDropped: count.optional(), seedPoints: count.optional(), cutOrientations: count.optional(),
    refusal: z.enum(['no-votes', 'few-inliers', 'low-share', 'narrow', 'small', 'cross-validation', 'gross', 'rival']).optional(),
}).optional(),
```

## 8. What is shown

**Job log** (`locate`; the figures are examples):

- `found by tile votes: 22 of 182 tiles agree (as given, scale 0.94, moved 13.9 km)`
- `proved: 697 of 896 tiles agree, cross-validated 12.8 m, covers 62 % of the city; crop 41,200 x 22,100 px, delivery deleted`
- `not proved (few-inliers: 16 of 363): crop 200,000 x 22,240 px, delivery kept, the admin's points are next`

**Admin** (`approval-card.ts`, `version-detail.ts`, `packages/admin/src/imagery/version-view.ts`): a block under `adminContent.imagery.calibration.`; the join offer reads `output.coveragePct` first. Tour states: calibrated, not proved, waiting on coverage.

| Key | en | ro |
| --- | --- | --- |
| `how.votes` | Found automatically | Găsită automat |
| `how.pass` | Found from a neighbouring frame | Găsită după un cadru vecin |
| `how.points` | Refined from your points | Rafinată din punctele tale |
| `tiles` | {agreed} of {tried} areas agree | {agreed} din {tried} zone se potrivesc |
| `error` | Measured error {metres} m | Eroare măsurată {metres} m |
| `covered` | Covers {percent} % of the city | Acoperă {percent} % din oraș |
| `notFound` | Not found: place a few rough points, the rest is automatic | Negăsită: pune câteva puncte aproximative, restul e automat |
| `waits.notProved` (nothing proved it, checked only on its own points, a check dropped, or too little measured: one key for the 630 KB budget) | Not fully checked: compare it with the map | Neverificată complet: compar-o cu harta |
| `waits.coverage` | Covers under 90 % of the city: add a frame or approve | Acoperă sub 90 % din oraș: adaugă un cadru sau aprobă |

## 9. Budgets (4 cores, 16 GB)

| Stage | Budget | Basis |
| --- | --- | --- |
| Votes | 720 matches at most 4 warps, 180 a warp beyond: KH-9-pan and KH-5 8 warps, 1,440; Corona 12, 2,160; KH-7 24, 4,320. One process, 1 GB | 52 s for 720 on one NUC core, 0.48 GB; §14 for 8, 12 and 24 warps |
| One proof | 3 iterations and the last look, 2 GB | 21 to 25 s from a 2.8 GB crop; the averaged read is **unmeasured** |
| `locate`, proved | under 2 minutes | votes, proof, crop. Not held on 12 warps with a weak proposal (§14: 170 s); on 8 and 24 warps held, 16 to 61 s (§14) |
| Worst case | under 5 minutes | votes, 3 proofs; a local matcher's time is its own |
| Bounded crop | 4.4 GB array, 6 GB peak | 200,000 x 22,240 |

Budgets are counts; only the log reports seconds. A real 4-core PC must confirm.

## 10. Tests

`pipeline/tests/unit/test_calibrate_{votes,proof,pairs,prior,ports}.py`, on `tests/synthetic/scenes.py` with an injected shift, scale and rotation:

- Recovery at 44, about 0 and about 60 degrees, asserted in ground metres. A mirrored and a rotated scan recover their assignment.
- An off-strip window: no false positive. Low texture: `no-votes`, no exception. A partial frame: `coveredPct` near the injected share.
- Over-limit crop bounded; a bad tile in a held cell raises the figure; seeded points refine or fall back; the null matcher is never called after a proof.

**Goldens:** `georef-cases.json`, `written-documents.json` (regenerated), `version.awaiting-approval.json`. **Rows changed:** `S-P01-BAD-WEAK-GUESS-TOO-WIDE`, `S-P01-BAD-WEAK-GUESS-TO-POINTS`, `S-P01-HAPPY-PANORAMIC-LOCATE`; `test_surface.py` goes.

**New rows:** `S-P06-HAPPY-VOTES`, `S-P06-BAD-OFF-STRIP`, `S-P06-BAD-LOW-TEXTURE`, `S-P06-HAPPY-PASS-PRIOR`, `S-P06-BAD-PASS-PRIOR-WRONG`, `S-P06-BAD-OVER-LIMIT`, `S-P06-HAPPY-SEEDED-POINTS`, `S-P06-BAD-SEEDED-REFUSED`, `S-P06-HAPPY-WARP-CLIPPED`, `S-P06-BAD-CROP-COVERAGE`, `S-A17-HAPPY-WHOLE-CITY`, `S-A17-BAD-PART-OF-CITY`, `S-A17-BAD-LEAVE-ONE-OUT`, `S-A67-HAPPY-CALIBRATION`, `S-A67-BAD-NOT-FOUND`.

**Rehearsal D4, before any status claim:** the four frames through the built step; the off-strip windows and Pitești through the proof table; a real Corona, KH-7 and KH-9 mapping frame; a city far from Bucharest.

## 11. Auto-publish (`functions/src/imagery/approval.ts`)

The hole: `imagery.saveGcps` stores `checkpointCount` from leave-one-out, so automatic pairs saved all enabled (live F007: 124 pairs, 12.0 m) pass `measuredWithin` while the frame holds part of the city, and `held` guards only a frame a join already named.

```ts
const CITY_MIN_COVERAGE_PCT = 90; // one bar, renames JOIN_MIN_COVERAGE_PCT
function measuredWithin(georef: Georef, threshold: number): boolean {
    return georef.method !== 'embedded' && georef.checkpointKind === 'held-out' /* + today's count and RMSE */;
}
function frameCoversCity(version: Rendered): boolean {
    return version.source?.kind !== 'usgs' || (version.output.coveragePct ?? 0) >= CITY_MIN_COVERAGE_PCT;
}
```

A missing figure never approves. A regeoref or crop keeps `source` (`regeoref.ts`), so stays under the rule. The rendered figure survives a crop and poor points. `S-A17-HAPPY`'s fixture needs disabled pairs; M3 §7.1 gets an amendment.

**As built, stricter (§13.1):** `held-out` says little off the proof's path. The matcher's checks come from pairs its own RANSAC filtered at 3 px (`autogcp.held_out`), and a pair an admin disables after reading its residual is no independent check. So a version publishes itself only when, besides the above:

- `georef.method === 'auto'`: hand points always wait, uploads included (`S-A17-BAD-HAND-POINTS`). So no upload publishes itself any more; M3 §7.1 said a measured one could.
- `calibration.how` is `votes`, `pass`, `points` or `local-ai`, with no `refusal`: the proof holds this fit (`S-A17-BAD-NOT-PROVED`). A proved frame whose tiles gave no fit and went to the matcher reads `matcher`. A re-rendered version has no `calibration`, and waits.
- `checksDropped` is 0 (`S-A17-BAD-CHECKS-DROPPED`).
- `measuredPct >= AUTO_MIN_MEASURED_PCT` (70; real frames 79.4 to 88.2): beyond the tiles' hull a polynomial extrapolates, the folds are interleaved cells and never hold out a contiguous region, and `coveragePct` reads alpha, not tiles (`S-A17-BAD-UNMEASURED-AREA`).

## 12. Workstreams

Server+admin lands the schemas first; both build against §7.

**Pipeline:** `pipeline/src/hcm_pipeline/calibrate/**`; `steps/{locate,georef,warp,export,merge}.py`, `georef/{corners,transforms}.py`, `georef/surface.py` (removed), `frames.py`, `rasters.py`, `documents.py`, `contract.py`, `jobs.py`; `pipeline/tests/**`; `docs/research/M3-interfaces.md`; `.agents/skills/raster-pipeline/` and its mirror.

**Server+admin:** `packages/shared/src/schemas/{georef,imagery}.ts`, `packages/shared/src/georef/fit.ts`, `packages/shared/src/imagery/join.ts`, i18n, `packages/shared/test/**`; `functions/src/imagery/{approval,join-plan,on-job-write}.ts`, `functions/src/imagery/pass-calibration.ts` (new), `functions/src/worker/allow-list.ts`, `functions/test/**`, the rules and `rules-tests` for `imageryPasses` (no client); `packages/ui/src/admin/imagery/**`, `packages/admin/src/imagery/**` and their tests; `e2e/**` with `e2e/scenarios.json` and `e2e/tour/states.ts`; `docs/research/M8-join-interfaces.md`; `.agents/skills/{firebase,e2e-scenarios}/` and mirrors; `docs/ARCHITECTURE.md`.

The integrator owns `AGENTS.md`, `CLAUDE.md`, `docs/LESSONS.md` and this file.

## 13. Owner decisions

1. Leave-one-out never auto-approves: hand points that did not refine take one Approve click (M3 §7.1 allowed it). Recommended. Built wider than that wording (§11): disabled hand points wait too, whatever their kind says. **For the owner to confirm:** hand-pointed uploads no longer publish themselves.
2. An honest figure sits near 15 m, so auto-publish will often wait until D4 shows how often. The threshold stays unless the owner changes it.

**Cut:** the local matcher itself; picking an orientation by hand; re-cropping a stored frame; poly3; a place with no Sentinel-2 scene under 20 % cloud (`referenceUnavailable` stands).

**Not cut: a window across the seam of two orbit tracks.** Tracks lie about 280 km apart at the equator and swaths are 290 km, and adjacent tracks fly on different days, so no single date may cover it; and a tile's box may hold a window whose footprint does not (27 % missing at latitude 5, 9 % at 44.4). `stac.py` reads the footprint, asks for 100 items (50 left out a date's other tiles over longitude 27 at 44.4), and falls back on up to four items of any dates, each the one that adds most of the window. A live sweep of the catalog was not repeated after this change; tested on fixtures only.

## 14. Rehearsal on real frames (2026-11-06)

**Run:** the product's own `find_frame`, `prove_map`, `calibrated`, `reach_of`, `proved_box`, `crop_pixels` (`tools/m9-run.py`, `m9-false.py` on the NUC, `pipeline/src` synced), on `stitch`'s real segments and preview; no landmark, no prior unless named. One frame at a time, `--cpus=4 --memory=16g`, warm disk, segments on the local disk. Seconds are the search with its proof, then the crop's read.

| Frame, window | Result | Votes | Tiles agreed | Figure, 5 folds (checks) | Pairs + checkpoints, transform | `checkpointRmseM`, blocked | Search + crop s | Peak GB | Crop px |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| F006, Bucharest | proved | 20 of 196 | 402 of 500 | 14.3 m (74) | 69 + 14, poly2 | 19.5, 11.5 m | 20 + 0.4 | 1.44 | 36,895 x 11,605 |
| F007, Bucharest | proved | 22 of 196 | 712 of 946 | 16.3 m (114) | 136 + 21, poly2 | 17.3, 13.5 m | 24 + 1.7 | 1.49 | 40,314 x 22,140 |
| F007, F006's model as prior | proved, `pass` | 21 of 156 | 707 of 946 | 16.5 m (116) | 130 + 25, poly2 | 18.0, 14.2 m | 18 + 1.1 | 1.49 | 40,316 x 22,140 |
| A001 (1982), Bucharest | proved | 13 of 196 | 922 of 1,192 | 17.7 m (139) | 62 + 13, poly2 | 13.0, 15.0 m | 38 + 0.3 | 1.64 | 19,037 x 22,240 |
| F040 (winter), Bucharest | **proved** | 20 of 196 | 406 of 582 | 19.7 m (64) | 91 + 13, poly2 | 24.9, 14.0 m | 22 + 1.3 | 1.43 | 42,612 x 21,984 |
| F006, Pitești | **proved** | 42 of 196 | 1,039 of 1,176 | 14.4 m (117) | 108 + 23, poly2 | 15.5, 12.9 m | 19 + 0.5 | 1.08 | 26,008 x 19,010 |
| F006, Fetești | `no-votes` (**a miss of the votes**: gate R1 proved it, see below) | 0 | | | | | 41 | 0.50 | bounded 200,000 x 22,112 |
| F007, Fetești | `no-votes` (unsettled, see below) | 0 | | | | | 32 | 0.50 | bounded 200,000 x 22,140 |
| F006, Slobozia | `no-votes` (**a miss of the votes**, see below) | 0 | | | | | 27 | 0.39 | bounded 200,000 x 22,112 |
| F006, Slatina; F007, Pitești | `no-votes` (was `cityNotFound` until the reach went to ground metres, see below) | 0 | | | | | 19, 25 | 0.41, 0.54 | bounded 200,000 x 22,112 |

**Corrected by gate R1 (`docs/research/M10-local-ai.md`, 2026-11-07), this table and what is said of it below:**

- **Fetești on F006 is not a clean refusal, and Slobozia is not off the strip.** Both were misses by the votes. Fetești was proved through a matcher's proposal from three shifted starts at 15 and 10 m, all maps within 4.0 m; Slobozia by a scan of 289 proofs, once, by numbers alone (its checkerboard is inconclusive).
- **A model from a far city does not fit `PRIOR_MARGIN_GROUND_M` of 12 km:** the Bucharest model is 18.3 km (ground) off at Fetești and 6.9 km at Pitești, mostly along the film.
- **Across the film that model's error was only 0.1 to 4.2 km (Mercator), so its on-film shares are usable.** A share of 0 % or 0.5 % is a correct refusal, and F007 on Pitești (2.3 %) is treated the same. They come from a model, not a proof. Fetești on F007 stays unsettled: the models put 12.5 to 17.7 % of the window on film, and nothing proved it.

**Re-run after the review of 2026-11-07** (`tools/m9-run2.py`, `m10.sh`, this tree's `pipeline/src`, one frame at a time, `--cpus=4 --memory=6g`): every frame above gives the same votes, tiles, figures and crops; the search with its proof takes 25, 31, 28, 44 and 21 s where it took 20, 24, 22, 38 and 19 s, so the last look costs about 5 s.

| Frame, window | `rival` share | Sigmas of noise | `measuredPct` | `checksDropped` |
| --- | --- | --- | --- | --- |
| F006, Bucharest | 0.174 | 4.3 | 79.4 | 0 |
| F007, Bucharest | 0.092 | 3.6 | 88.2 | 0 |
| F040, Bucharest | 0.150 | 4.2 | 82.3 | 0 |
| A001, Bucharest | 0.091 | 4.1 | 87.1 | 0 |
| F006, Pitești | 0.050 | 3.6 | 85.5 | 0 |

So `RIVAL_MIN_SIGMAS` (10) and `AUTO_MIN_MEASURED_PCT` (70) leave these five as they were, and no real frame has a measured refusal on `rival` or on `measuredPct`: those two rest on synthetic worlds (a lattice under the true map 0.49 and three periods off 1.03, at about 5.7 sigmas; a part displaced over 30 % of the window 37 to 40 sigmas, over 20 % 23, over 15 % 10.0 at a share of 0.045, not refused, over 10 % 5). **Slatina and F007 on Pitești now search and wait for points**, because a frame the model puts up to 30 km away gets its search: no false result, but a frame truly off the city costs about 30 s and a bounded crop where it used to fail at once, and asks for points instead of naming another frame.

**Twelve warps on real frames.** The KH-9 frames forced to three scales (0.85, 1, 1.15), as a Corona or a KH-7 frame searches, 180 tiles a warp: see the table below. At 60 a warp, the earlier share of the budget, no warp of F006, F040 or A001 reached `VOTE_MIN_AGREE`. These are KH-9 frames standing in: no Corona or KH-7 frame has run.

| Frame, Bucharest | Votes | Tiles agreed | Figure, 5 folds | `checkpointRmseM`, blocked | Search s |
| --- | --- | --- | --- | --- | --- |
| F006 | 12 of 196 | 395 of 492 | 14.0 m | 14.6, 11.5 m | 170 |
| F007 | 21 of 196 | 706 of 939 | 16.7 m | 14.3, 13.9 m | 38 |
| F040 | 14 of 196 | 409 of 583 | 19.5 m | 15.3, 15.3 m | 138 |
| A001 | 17 of 196 | 928 of 1,187 | 17.7 m | 10.9, 14.8 m | 45 |

All four proved. **F006 and F040 miss the 2-minute budget of §9:** a weak proposal runs all twelve warps before its proof, 2,160 matches. They shared the NUC with a test suite, so the seconds are a poor measure, but the count is the count. A strong proposal, 16 votes or more, stops early, as F007 and A001 did. It stays under the worst case's 5 minutes here.

**Independent checks.** F006 and F007 against the earlier maps started from hand landmarks (`out/f006`, `f007`): median 2.0 and 2.3 m, largest 3.9 and 7.4 m over the tiles. A001, F040 and F006 on Pitești have no such truth: a checkerboard against Sentinel-2, by eye on one square of 1,200 cells each, shows roads and rivers running on across the squares. That is the only check they had; no landmark.

**Wrong proposals straight into the proof** (`m9-false.py`, each frame's first guess under all four orientations, kilometres off, so the votes cannot help): at most **18** tiles agree (of at most 61), every one refused `few-inliers` against the gate's 60, on F006, F007, F040, A001 and F006 on Fetești; Slobozia's first guesses, off its window, refuse `small` at once (the frame does hold Slobozia: corrected above). The true places hold 402 to 1,039. A001's first guess under its true orientation lies close enough to prove by itself. So `PROOF_MIN_INLIERS` and `PROOF_MIN_SHARE` have refusals measured against them now; **`PROOF_MIN_SPREAD`, `PROOF_MIN_COVERED`, `PROOF_MAX_CV_M` and `PROOF_MAX_GROSS` were reached by no real wrong proposal: still first values**, tried on synthetic tiles alone.

**Against the brief, plainly:**

- **F040 does not refuse.** The brief asked for a clean refusal; the frame is found, proved and aligned by eye, so a refusal would be the bug. Clean refusals are shown on Slatina and F007 on Pitești (by the model's shares, corrected above), and on a film over another place and a uniform film (synthetic); Fetești and Slobozia, listed here at first, were misses. Whether F040 is good enough is another matter: its checkpoint figure, 24.9 m, is the worst here.
- **Pitești on F006 is true, not false.** 1,039 tiles at 14.4 m and the checkerboard agree: Pitești is on that strip. The votes refuse Fetești on F006 and F007, and on F006 that is a miss (corrected above). No false result in these runs.
- **Most frames will wait for one click.** `checkpointRmseM` is under the 15 m threshold on A001 alone (13.0 m); F006 19.5, F007 17.3, F040 24.9, Pitești 15.5. It is a figure of 13 to 25 checks; the steadier blocked figure is 11.5 to 15.0 m. The threshold stands (§13.2).
- **Timings are a good case.** Under 50 s for `locate` where the budget is 2 minutes, but on a warm disk with local segments, under a 4-CPU quota on a 16-core NUC, not a 4-core PC. Staging the segments from a bucket is not in them.

**Built differently from the sections above:**

- `SensorSpec.full_aspect` (20.2, four real frames: 19.6 to 20.5) and `PanoramicCamera.sweep_deg`: a film under 90 % of it swept less, its angle from its aspect, and `tan(wide) = (ratio - cos(sweep)) / sin(sweep)` from its ends' widths on the ground puts the nadir (A001: -7.8 to 52.9 degrees; -8 to 52 worked out by hand first gave the same place). **One frame only:** no other short frame has run.
- The preview is no longer blurred before the votes (A001: 15 agree with one cell of blur, 17 without; 13 at scale 0.94).
- A window too small for 64-cell tiles at 43 m gets finer cells (down to 30 m) and smaller tiles (down to 24 cells): a real small town has not run. A synthetic 6 by 4.8 km window reached 35 tiles, under `PROOF_MIN_INLIERS`: so small a window goes to the matcher.
- The search image stops where the film's exposure ends; counted matches are unchanged, each is cheaper.
- `calibration.how` is `local-ai` for any matcher's proposal, proved over at least 30 km since M10 (`docs/research/M10-local-ai.md`); `matcher` is what `georef` writes when its matcher fitted a frame whose tiles gave no fit.
- `model` is measured from the votes' similarity, not the proved map: a place to look, 12 km of margin around it. On F007 under F006's prior it moved 6.4 km and proved at once.

**Not run:** a whole job on a real frame through `LocateStep`, `GeorefStep`, `warp` and `export`, so the 1,249 km² correction and `coveragePct` are tested on synthetic rasters alone; a real Corona frame (its `SearchRange` stays **UNVERIFIED**; KH-7, KH-9 mapping and KH-5 ran later, below) and a city far from Bucharest, which D4 still owes; Playwright: `S-P01-HAPPY-ADMIN`'s 3.5 by 2.8 km city is too small to prove, so it walks the matcher's path and, since §11 as built, takes one click.

### Three other cameras, and the KH-9 frames again (2026-11-07)

**Run:** `tools/m15-all.sh`, `m15-run.py` on the NUC, this tree's `pipeline/src`: the product's `first_guesses`, `reaching`, `find_frame`, `calibrated`, `proved_box`, `crop_pixels`, with `frame_pixel_m` and the job id's seed; KH-5 through `Scene.corner_quad`, no corners. Three frames at a time, each `--cpus=4 --memory=6g`, so the seconds are rough. The window is Bucharest's, the reference `s2-bucharest.tif`. No landmark, no prior.

| Frame | Metadata said | Result | Votes | Tiles agreed | 5 folds (checks) | Pairs + checks, transform | `checkpointRmseM`, blocked | Rival, sigmas | `measuredPct`, `coveredPct` | Search + crop s | Peak GB | Crop px | Checkerboard, read |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| DZB00403000026H017001, KH-7, 1966 | 46 km of a strip 51 km long, 22 km off | **proved** | 15 of 196, rotation 270, scale 1.1, shear 7.5 | 538 of 689 | 12.8 m (90) | 109 + 18, poly2 | 15.2, 12.7 m | 0.126, 4.7 | 84.8, 49.0 | 61 + 2.9 | 1.33 | 21,379 x 30,563 | Băneasa's runway, the forest's edge and the streets run on across the squares |
| DZB1214-500086L005001, KH-9 mapping, 1978 | right, within 0.1 km | **proved** | 19 of 196, rotation 90, scale 1 | 1,053 of 1,233 | 12.0 m (151) | 75 + 16, poly2 | 15.8, 11.3 m | 0.068, 3.7 | 90.9, 100 | 22 + 0.5 | 2.06 | 9,333 x 9,560 | Herăstrău's shore, the railway and the streets run on; its reseau crosses show |
| DS09065A089MC039, labelled KH-4A, 1964, corners null | its footprint, 20 km off at the city | **refused**, `no-votes` | 0 | | | | | | | 70 | 1.17 | bounded 14,076 x 14,094 | nothing to read |

| KH-9 pan, Bucharest | Votes, scale that won | Tiles agreed | 5 folds (checks) | `checkpointRmseM`, blocked | Rival, sigmas | `measuredPct` | Search s | Same as before? | Checkerboard, read |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| F006 | 20, 0.94 (12 at 1) | 402 of 500 | 14.3 m (74) | 19.5, 11.5 m | 0.174, 4.3 | 79.4 | 49 | as `m14c`; about 25 s more than one scale | a runway and the shore run on; a film edge's black sliver |
| F007 | 21, 1 | 708 of 942 | 16.7 m (116) | 14.2, 13.7 m | 0.090, 3.5 | 87.2 | 22 | as `m14c` | Carol Park's axis, the railway |
| F040 | 20, 0.94 (14 at 1) | 412 of 582 | 19.5 m (63) | 19.0, 13.9 m | 0.152, 4.2 | 82.5 | 45 | as `m14c`; about 20 s more than one scale | streets, the railway; low contrast in the fields, a weaker look |
| A001 | 16, 1 | 919 of 1,180 | 17.9 m (139) | 21.3, 14.0 m | 0.088, 4.0 | 87.5 | 26 | was 13 at 0.94, 922 of 1,192; see below | under cloud in places, streets run on between |
| F003 | 24, 1 | 1,119 of 1,374 | 18.6 m (165) | 16.8, 14.7 m | 0.066, 3.8 | 84.1 | 19 | as `live-s1` | lakes, the railway |
| F022 | 52, 1 | 1,126 of 1,359 | 16.1 m (165) | 22.1, 13.4 m | 0.061, 3.5 | 87.4 | 18 | as `live-s1` | lakes, the railway |
| A015 (1983) | 17, 1 | 1,126 of 1,418 | 15.9 m (169) | 16.9, 14.0 m | 0.067, 3.8 | 87.2 | 25 | **`no-votes` before: rescued** | lakes and streets run on |
| A038 | 48, 1 | 1,164 of 1,326 | 14.8 m (173) | 12.0, 14.0 m | 0.060, 3.7 | 87.9 | 25 | as `live-s1` | lakes, stadium; slivers of film edge |
| F049 | 27, 1 | 922 of 1,119 | 14.6 m (136) | 13.8, 12.8 m | 0.084, 3.9 | 86.9 | 20 | as `live-s1` | lakes, Carol Park |

Every checkpoint figure above was recomputed from `pairs.json` alone (`m15-verify.py`) and equals the saved one. Gradient correlation inside each checkerboard's region against the same region 300 m off: 0.206 / 0.127 (KH-7), 0.136 / 0.028 (mapping), and 0.083 to 0.239 against 0.007 to 0.142 on KH-9 pan: higher in place on all eleven. The eye read one square of 1,200 cells on each; **no landmark checked any of them.**

**A001's checkpoint figure** moved from 13.0 to 21.3 m, its 12 checks being other cells under the job id's seed: the same code under the earlier harness' seed reads 10.9 m, blocked 14.8. A figure of a dozen checks moves that far with the seed alone, which is what the blocked figure is for.

**Windows the votes do not prove, same code** (the frames do hold Fetești and Slobozia, corrected above): F006 on Fetești, Slobozia, Slatina and F007 on Fetești, Pitești: `no-votes`, 33 to 51 s, bounded crop. F006 on Pitești stays proved (1,041 of 1,171, 14.4 m). KH-7 on Fetești and Pitești and mapping on Fetești, Slobozia, Slatina: `cityNotFound`. Mapping on Pitești, whose western edge the footprint barely reaches: `no-votes`, a bounded crop of 26,975 x 32,850; whether the frame holds it was not read.

**Wrong proposals straight into the proof** (`m15-false.py`, every warp's first guess, kilometres off): KH-7, 24 warps: none accepted, at most 17 tiles against the gate's 60. Mapping, 4 warps: the true orientation proves itself (1,053 of 1,235, a median of 9.0 m from the proved tiles), the other three at most 13. KH-5, 8 warps: at most 10. All `few-inliers`.

**What the frames showed, and what changed:**

- **KH-9 pan: scales 1 and 0.94** (Part 1). The model's scale first: four warps at 1, then four at 0.94, 1,440 matches at most where there were 720. Seven of nine frames agree strongly at 1, so they stop early and it costs nothing; F006 and F040 are weak at 1, so they run all eight, 20 to 25 s more. A015 goes from `no-votes` to proved. No frame lost its proof.
- **KH-7 is a parallelogram.** The proof's map against the metadata: the long side lies right (10.5 degrees from north, 11 said), but the short side runs at -0.9 degrees where the corners say -7 to -12, 22 km ground off along the strip, pixels 13 and 8 % larger than the corners give. No vote: the corner homography at scales 0.95 to 1.25 under a 30 km margin, a square-pixel similarity at those and at 0.8 to 1.75 under 70 km. Under the true affine 23 of 196 agree at margins from 2 to 30 km. A tile of 64 cells cannot bear 10 degrees of shear. So `SearchRange.shears_deg`, `Hypothesis.shear_deg` and `votes.sheared_about`: the short side turned, the long side kept, about the window's centre, the same on the ground under every orientation; a margin of 30 km and scales 1, 1.1. Agreeing warps: 5 and 10 degrees, not 0 or 15; so 7.5, both ways, as a pass the other way may lean the other way (**not seen: one frame**). The cause was not established.
- **`MAX_ANISOTROPY` 3 to 2.5.** A 1:2.25 strip's quarter turn reads 3.9 against 1.3, which 3 let through: 8 orientations and 48 warps. Now 4 and 24.
- **KH-9 mapping needed nothing.** 15 km and scale 1 hold; the votes read 0.969 and 0.1 km.
- **DS09065A089MC039 is no KH-4A: it is a KH-5 Argon.** Mission 9065A is on USGS's ARGON list, MC its mapping camera; the code's table knew only KH-4x for `corona2` and fell through to KH-4A. USGS gives 460 feet, about 140 m (KH-4A's 2.75 m is what the admin read). Its 16,330 px at 7 µm is 114 mm; an older USGS listing says 5 by 5 inch film, so the format here is measured, not read. New sensor `KH-5` (140 m, z8 to z12, 1.0 at 30 km), and `scene-record.ts` reads the camera from the id when the metadata does not: `DS0*9nnnAnnnMCnnn` KH-5, `DS11nn` KH-4B, `DS10nn` KH-4A, `DS9nnn` KH-4, `DZB...H` KH-7, `DZB...L` KH-9 mapping. The metadata still outranks it. **The id rules are read from these frames and the fixtures, not USGS's documentation, and the stored scene stays KH-4A until a search updates it.** KH-6 Lanyard ids still read KH-4A. The scenes harvested before that rule kept KH-4A (every `corona2` scene of Bucharest, harvested 2026-10-25), so `imagery.import` reads a stored fallback camera again by the id (`trueSensor`, DECISIONS §209): live 2026-11-13, DS09065A073MC043 was searched as a Corona strip and shown whole.
- **Corners null works.** The footprint's extremes give the right quad and rotation 180 is the true orientation, about 20 km off; `frame_pixel_m` reads 58.5 Mercator metres.
- **It truly cannot be proved, under these gates.** From a start placed by hand on Lake Greaca (±4 km, 81 starts, one orientation, this probe only): at most 14 of 20 tiles, `few-inliers` against 60; six warps' votes around it: none. A tile of 900 m is about 6 resolution elements at 140 m, and the 30 m gate is under its pixel. No gate moved. The frame waits for the admin's points, whose scan is nearly the whole frame. Such a frame adds nothing to a city's map: it should not be bought or imported, and it now says what it is.
- **KH-7's seam is not understood.** At film x about 36,000 the two segments' content does not run on: a bright band, a dark band before it, and curved field edges after it. Bucharest stops at x about 21,400 on this frame, so nothing here crossed it; **a city beyond it is untested and the stitch was not changed.** The KH-9 mapping frame's seam does run on.

**Against the brief, plainly:**

- **One frame a camera.** KH-7's shear, scale and margin and mapping's range rest on one frame each, one city. The KH-4x ranges are still **UNVERIFIED**: the "Corona" frame was not one.
- **KH-7 covers 49 % of the city, mapping 100 % at 7.5 m.** Neither publishes itself unless every rule of §11 holds: KH-7 under 90 %; mapping's checkpoint 15.8 m misses 15 m by 0.8.
- **A same-pass prior loses the shear:** `MeasuredModel` is a similarity, so a KH-7 neighbour's prior will likely refuse and fall through to the full search, costing time, not truth. Not run.
- **Harness, not a job:** `LocateStep`, `georef`'s `matcher`, `warp`, `export` were not run on these frames, F039 was not rerun (its corners were not at hand), and the seconds shared the NUC three at a time. One harness slip: `f007-pit` collided on a container name and was rerun alone.

### The measuring stick (2026-11-07)

**Run:** `tools/acc-ruler.py` on the NUC, a copy with its outputs in `reports/calib/accuracy/` (not tracked), `pipeline/src` unchanged; each map is the product's own, refitted from `out/m15/*/pairs.json`. Nothing in the product changed.

**The rulers.** None was seen by a fit:

- **Film against film.** Every pair of the 11 Bucharest frames through its own map onto one 5 m ground grid, 900 m tiles, the proof's peak and margin: 52 pairs of 55 hold 100 tiles or more. Sentinel-2 is in neither image. Its blind spot: **an error every frame shares, an absolute shift above all, does not show.**
- **The same pass.** F006 with F007, the only such pair: 33 km² of overlap, too narrow for 900 m tiles, so 450 m (305 tiles, median peak 0.94, none gross). Nearly no noise, the sharpest ruler here, on one strip at the edge of both crops.
- **Blocked hold-outs on Sentinel-2.** Blocks of 3.2 km over 5 folds and 5 seeds, no training tile within 900 m of a held one, every gated tile scored before any RANSAC, only a 100 m line, its share given. `measure`'s earlier rounds still saw the held tiles.
- **The film against itself.** Each overlap of two segments, no map or reference.
- **Checked:** a known field (20 m + 10 m shift, 15 m wave) came back within 0.69 m against the frame itself and 1.46 m against another film; a frame against itself read 0.007 m.

**Not run:** a second Sentinel-2 scene (scene-to-scene misregistration is therefore **not measured here**; the code read a synthetic 3-cell shift as 21.42 m, true 21.42), OSM rails and bridges, a DEM, WorldCover. None is on the machines and each is a download: ask first. Published for Sentinel-2: below 8 m CE95 absolute and below 5 m CE95 multi-temporal for Collection-1 (Enache et al., IGARSS 2023); the scene behind `s2-bucharest.tif` is not recorded, so which baseline it has is not known.

| Frame | Saved checkpoint, blocked | S2 held out, RMSE (median), over 100 m | Film ruler (68 % of pairs resampled) | Coherent, tile noise | Same with a cubic | S2 tile noise | Shared at a place | Map vs all tiles | Cubic's size | Largest at a seam | tan off-nadir |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| F006 | 19.5, 11.5 | 27.2 (14.2), 2.9 % | 9.1 (7.8-10.3) | 8.0, 4.2 | 4.9 | 12.1 | 11.6 | 3.7 | 5.4 | 2.8 | 0.0 |
| F007 | 14.2, 13.7 | 27.7 (16.4), 5.7 % | 4.2 (2.4-5.3) | 2.5, 3.3 | 4.5 | 14.0 | 12.9 | 2.1 | 8.4 | 7.5 | 0.0 |
| F040 | 19.0, 13.9 | 29.9 (18.5), 6.5 % | 11.4 (10.5-12.2) | 10.8, 3.8 | 5.8 | 14.3 | 14.9 | 2.9 | 8.1 | 1.1 | 0.1 |
| A001 | 21.3, 14.0 | 24.7 (15.5), 4.9 % | 8.0 (7.1-8.8) | 6.4, 4.7 | 6.6 | 12.5 | 12.7 | 3.5 | 7.3 | none in crop | 1.1 |
| F003 | 16.8, 14.7 | 25.2 (14.9), 2.6 % | 6.6 (5.5-7.7) | 6.3, 2.3 | 3.0 | 10.9 | 12.1 | 2.5 | 10.8 | 6.1 | 0.5 |
| F022 | 22.1, 13.4 | 23.1 (14.5), 2.6 % | 7.4 (6.4-8.1) | 6.5, 3.6 | 5.1 | 10.6 | 11.6 | 3.3 | 9.7 | 2.9 | 0.6 |
| A015 | 16.9, 14.0 | 25.6 (16.3), 3.3 % | 5.9 (4.4-6.9) | 4.8, 3.4 | 4.2 | 11.8 | 12.2 | 3.2 | 9.8 | 12.7 | 0.6 |
| A038 | 12.0, 14.0 | 19.5 (13.0), 2.1 % | 7.5 (6.1-8.8) | 7.0, 2.7 | 3.0 | 10.3 | 11.4 | 4.5 | 8.0 | 4.8 | 0.0 |
| F049 | 13.8, 12.8 | 25.0 (15.2), 2.9 % | 5.8 (4.3-6.9) | 5.4, 2.3 | 2.8 | 11.3 | 13.9 | 3.0 | 10.2 | 10.8 | 0.2 |
| KH-7 | 15.2, 12.7 | 24.7 (13.0), 5.1 % | 9.6 (8.9-10.3) | 8.4, 4.6 | 5.9 | 12.8 | 9.6 | 2.6 | 3.2 | unmeasured, outside crop | n/a |
| KH-9 mapping | 15.8, 11.3 | 19.3 (9.3), 2.5 % | 6.4 (5.3-7.6) | 6.0, 2.4 | 2.8 | 10.7 | 10.5 | 2.9 | 1.0 | outside crop | n/a |
| F006, Pitești | 15.4, 12.9 | 19.6 (12.5), 1.7 % | no other frame | | | | | | | | 0.5 |

All in ground metres. The film column splits each pair's squared RMS between its two frames (three-cornered hat): it assumes frames err independently, **and the panoramic frames do not**, so it flatters them and blames the mapping frame for their shared error. Read the pairs against the mapping frame for that.

**What the error is made of:**

- **The saved figures flatter, and the Sentinel-2 ruler overstates.** Every gated tile held out reads 19 to 30 m against saved 11 to 15 m (blocked) and 12 to 22 m (checkpoint), whose tiles are the strongest. The same maps agree with each other film to film at a median pair RMS of 10.5 m, 5.9 to 17.6 m by pair. Most of the 19 to 30 m is not the map: a tile against Sentinel-2 carries 10 to 14 m of its own noise and film against film about 2 to 5 m.
- **Sentinel-2's tile residual does measure the map.** Against film-film offsets at the same places the slope is 1.00 at the median of 51 pairs (0.56 to 1.30), correlation 0.27 to 0.84.
- **The largest term in the map is a camera misfit: poly2 cannot hold a panoramic frame.** The fields are smooth and low in noise (`pairs/f003_k9m.png`, `frames/*-scan.png`): along the scan a cubic-shaped curve to 20 m and more at the crop's ends, across it flat; radially, outward at 5 to 10 km and inward by 10 to 20 m at 15 to 20 km. It follows the film, not the place: about each frame's own centre it is stronger, the mapping frame shows none (cubic's size 1.0 m), KH-7 little (3.2), KH-9 pan 5 to 11. The pairs against the mapping frame read 8.7 to 11.9 m.
- **Stitch: real, local, and small on the whole.** Eight seams lie inside a crop. Their mean offset is 0.4 to 4.7 m, but the segments are also turned: up to 1 px per 1,000 px, so up to 12.7 m (A015) and 10.8 m (F049) at one end of a seam. No linear residual over 0.34 px. Translation is all `stitch` corrects. **The mapping frame's own seam, outside this crop, is 52 m off and turned 0.27 degrees**, and KH-7's overlap of 300 px is too narrow to measure. The residual step across a seam (at most 13 m, standard error 3 to 7) cannot see this: the direct ruler is what counts.
- **Estimation:** the map from about 100 pairs lies 2.1 to 4.5 m from the same order fitted on every tile.
- **Terrain: bounded, not measured.** No DEM here. 1 m of height moves a tile by the tan column; A001 at tan 1.14 reads 7.5 m to the mapping frame with the cubic against 4.2 to 5.6 m for the other panoramic frames, so at most about 5.6 m of its error, about 5 m of height, can be relief.
- **Shared at a place: 9.6 to 14.9 m** of a tile's residual repeats across frames, mostly uncorrelated from place to place (short lags 11 m, long 13 m): the reference's texture, or what changed since all the films. The residual images put the large ones on field edges and new suburbs. Without a second scene, these two cannot be told apart.

**A candidate read on the ruler, no product change.** Each frame refitted on its Sentinel-2 tiles alone, narrowing to 25 m; the film ruler then reads the shift each map adds (first order; a real warp through the cubic of F003 with F022 reads 6.35 m, this 6.34 m):

| Over the 52 pairs, RMS | Product | poly2, all tiles | poly3, all tiles | poly4, all tiles |
| --- | --- | --- | --- | --- |
| Pairs | 10.8 | 10.3 | **6.5** | 7.3 |
| F006 with F007, the same pass | 13.1 | 13.2 | **3.4** | 9.2 |

The cubic improved all 52 pairs; panoramic against the mapping frame 8.7-11.9 to 4.2-7.5 m. Its Sentinel-2 hold-out moves far less (F007 27.7 to 26.2 m; on strong tiles 18.2 to 14.3 m), because 20 m of noise covers it: **"poly3 is cut, about 1 m" (§7, §13) was read through that noise.** poly4 gives way on the same pass: at a strip's edge it extrapolates. This is one reading, 11 frames, one city, on film the crop shares with another frame; corners no second frame reaches are unmeasured, and none of it has been through `prove`, `pairs` or a whole job. The cut is the owner's decision (§13): it is not reversed here.

### Reference variants, what could be read without a download (2026-11-07)

**Not run:** the variants themselves. A median of scenes, a season's scene, OSM fused into the fit and a DEM each need a download, downloads are ask-first, and no yes reached this phase; a second scene, an OSM extract and a DEM are on neither machine (the five `ref-*.tif` and `s2-bucharest.tif` windows do not overlap). `tools/acc-references.py fetch` refuses without the owner's yes and `variants` is a stub. So **no reference variant has a before and after here**. What follows bounds what they could buy, on real frames, with synthetic noise or other frames standing in. Nothing in the product changed. **Run:** `tools/acc-references-noise.py`, `acc-references-simex.py`, `acc-references.py` on the NUC, `--cpus=4`, while other experiments held the machine (load 25 to 55 on 16 cores), so the seconds are rough.

| Frame | Film ruler: product | poly3, all tiles | poly3, place cleaned | poly3, reference noised 0.25 sd | Tiles, as is / noised | S2 held out: poly2 | poly3 | poly3, place cleaned |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| F006 | 9.1 | 4.9 | 4.7 | 5.5 | 500 / 260 | 27.0 | 27.4 | 25.9 |
| F007 | 4.2 | 4.5 | 4.5 | 4.9 | 939 / 528 | 27.3 | 26.2 | 25.8 |
| F040 | 11.4 | 5.8 | 5.4 | 8.6 | 578 / 306 | 29.2 | 27.2 | 26.2 |
| A001 | 8.0 | 6.6 | 6.6 | 6.4 | 1,199 / 664 | 24.5 | 23.5 | 23.2 |
| F003 | 6.6 | 3.0 | 2.9 | 3.5 | 1,359 / 836 | 24.7 | 19.8 | 19.6 |
| F022 | 7.4 | 5.1 | 5.2 | 5.5 | 1,362 / 806 | 23.2 | 18.3 | 18.1 |
| A015 | 5.9 | 4.2 | 4.3 | 4.8 | 1,416 / 831 | 25.6 | 21.6 | 21.4 |
| A038 | 7.5 | 3.0 | 2.6 | 3.9 | 1,329 / 836 | 19.8 | 16.4 | 16.4 |
| F049 | 5.8 | 2.8 | 2.6 | 3.3 | 1,121 / 672 | 25.2 | 21.5 | 21.2 |
| KH-7 | 9.6 | 5.9 | 5.9 | 7.3 | 705 / 374 | 24.3 | 25.4 | 24.7 |
| KH-9 mapping | 6.4 | 2.8 | 2.6 | 3.4 | 1,225 / 544 | 19.2 | 19.5 | 19.4 |

Ground metres. Film columns split pairs' squared RMS (three-cornered hat, as above: it flatters the panoramic frames); S2 held out is 3.2 km blocks, 900 m buffer, 5 seeds, every gated tile, scored on raw Sentinel-2 before any RANSAC, to the 100 m line. The poly3 column is the same reading as the table above, and the control reproduced `deep.json` exactly.

- **Reference error local to a place barely moves the map.** "Place cleaned" takes each tile's reference error from at least 3 other frames' residuals there, never a frame's pair partner (77 % of tiles at the median, 37 % at worst): the 52 pairs go 6.51 to 6.38 m RMS, 38 better, the same pass stays 3.45 m. S2 held out moves 0 to 1.5 m. It stands in for the best a reference could do about S2 texture and change together, and it cannot run on a city's first frame.
- **Tile noise from the reference is a small part of what the film ruler reads.** Adding more of each frame's own residuals and extrapolating to none (SIMEX, 12 draws): 6.51 m goes to about 6.25 m on a straight line (68 % of pairs resampled: 6.0 to 6.5). The curve is concave under the 25 m narrowing, so the first step's slope gives about 5.4 m: read it as 5.4 to 6.25 m. So the rest, 5 m and more on a pair, is the films' own tile noise and what a cubic does not hold, and no reference fixes that. First try by dropped blocks failed and is not used: intercept zero, and one seed read 16 m. **poly3 can run away when coverage has holes.**
- **But a worse image costs tiles, and tiles matter.** Noise correlated at about 30 m through the product's own `measure`: at 0.25 of the image's standard deviation the gate keeps 44 to 63 % of the tiles and the pairs go 6.46 to 7.67 m, F040 5.7 to 8.6 m, the same pass 3.24 to 9.95 m. At 0.5 it keeps 8 to 18 %: 29.5 m. poly2 holds up better there (10.24, 10.78, 16.03 m). The steep part is the leverage of a cubic on few tiles. So the likely gain of a cleaner reference is **more tiles on weak frames and a safer cubic, not a lower figure on strong ones**. That the noise goes in does not say a median takes it out: only real scenes can.
- **What this ruler cannot say:** a median's main claim is on absolute position, a scene's registration, and every frame shares that. Published Collection-1 figures (below 8 m CE95 absolute, below 5 m multi-temporal, see *The measuring stick*) are about 4.6 and 2.9 m RMS for a circular normal, worked out here, not measured; a median can reduce the second and not the first, which all scenes share with the Global Reference Image.
- **Poly3 on the blind ruler again:** F003, F022, A015, A038 and F049 gain 3.4 to 4.9 m held out against Sentinel-2, F007, F040, A001 1 to 2 m, F006 loses 0.4 m (its median gains), **KH-7 and KH-9 mapping lose 1.1 and 0.3 m**. So a cubic per camera, not everywhere. It stays the owner's decision (§13).

**Checks:** a rematch through `measure` from the product's map, unnoised, gives the same tiles within 2 % (KH-9 mapping 1,225 against 1,233, A001 1,199 against 1,180) and 6.46 m against 6.51 m. Known answers: five scenes' shifts found within 0.03 cells; OSM's channel through the ruler's match -17.9, -10.4 m (true -17.5, -10.5); the terrain step removes a synthetic relief exactly, first full-sweep frame. These test code, not sources: **OSM's channel, the median and the DEM have never seen real data.**

**Cost, 4 CPU, machine shared, no network:** a rematch 7 to 30 s a frame (the film's read 1 to 6 s, `measure` 6 to 25 s), 1.5 to 2.3 GB, on a reference it already holds; a median of five whole 4,275 x 4,116 scenes 11.3 s, 2.0 GB (synthetic content); a refit under a second, 0.16 GB.

**Any city on Earth, metadata only** (STAC search, HEAD of a DEM tile, Overpass counts; no pixels read; 40 km window, the last 3 years, under 20 % cloud, items per December, March, June, September quarter):

| City | S2 items by quarter | Single item's box covers, any quarter | COP-DEM tile, MB | OSM ways, rail / major road |
| --- | --- | --- | --- | --- |
| Bucharest | 49, 47, 178, 87 | yes | 44 | 1,289 / 7,225 |
| Lagos | 14, 0, 0, 4 | yes, 2 quarters empty | 28 | 124 / 2,096 |
| Manaus | 5, 6, 53, 21 | yes | 45 | 0 / 1,298 |
| La Paz | 26, 104, 283, 120 | no, mosaic | 33 | 55 / 3,817 |
| Almaty | 61, 104, 113, 123 | no, mosaic | 39 | 838 / 3,531 |
| Jakarta | 4, 37, 122, 32 | no, mosaic | 46 | 1,349 / 12,935 |
| Reykjavik | 21, 43, 26, 44 | yes | 21 | 0 / 2,139 |
| Ushuaia | 3, 14, 12, 7 | yes | 28 | 0 / 367 |
| Kinshasa | 3, 8, 29, 13 | yes | 43 | 84 / 990 |
| Longyearbyen | 0, 247, 278, 35 | no, mosaic | 11 | 0 / 0 |

- **Median of scenes: possible as a default,** with whatever dates a window has, 2 to 5, from the mosaics the product already builds; the number of scenes is the city's. Sentinel-2 systematically covers land from 56 S to 82.8 N. Free, full and open with attribution. **Below two usable scenes it must fall back to one.**
- **Season closest to the frame: a preference, not a rule.** Lagos has no scene under 20 % cloud in 2 quarters of 4 in three years. And the frames' dates are not on these machines, so the season's effect has no reading here; F040, the winter frame, reads worst on the product's film and held-out figures, n = 1. `s2-bucharest.tif` is most likely `S2C_35TMK_20260817_0_L2A` (August, baseline 05.12): `fetchref.py`'s query, run again, picks it, not proved from its pixels.
- **OSM as a second channel: optional, gated per window.** Rail is absent from four windows of ten, and Longyearbyen has no major road; quality is not read by any count. Licence ODbL: public use must credit OpenStreetMap. Whether a published table of tiles measured against OSM would be a Derivative Database has **no source here**: keep such rows internal until the owner has asked.
- **Copernicus DEM: possible for any city, and where it matters is not here.** GLO-30's licence is worldwide and free, requires its notice (`produced using Copernicus WorldDEM-30 ...`), and must be accepted: **that is the owner's consent.** The AWS copy lists a small set of unreleased tiles; two catalogues disagree on whether Armenia and Azerbaijan remain among them, and GLO-90 is the worldwide fallback. Bucharest bounds it at 5.6 m on A001. La Paz's relief, at the arithmetic of hundreds of metres times tan 0.5, would be tens to hundreds of metres, which no polynomial can hold: **a poly fit there may not prove at all, not measured.** A short film's scan angle needs its corners; KH-7 and mapping have no such model in the ruler.
- **WorldCover:** global, 10 m, CC BY 4.0, 2021: it could name stable land cover where the shared term sits. Not fetched.

**Sources:** [Sentinel-2 coverage](https://sentiwiki.copernicus.eu/web/s2-mission), [Copernicus Sentinel licence](https://ads.atmosphere.copernicus.eu/licences/ec-sentinel), [COP-DEM GLO-30 licence](https://documentation.dataspace.copernicus.eu/APIs/SentinelHub/Data/DEM/resources/license/License-COPDEM-30.pdf), [its AWS copy](https://registry.opendata.aws/copernicus-dem/), [OSM attribution guideline](https://osmfoundation.org/wiki/Licence/Attribution_Guidelines), [WorldCover](https://developers.google.com/earth-engine/datasets/catalog/ESA_WorldCover_v200), [Collection-1](https://elib.dlr.de/197794/1/Collection1_IGARSS2023.pdf).

### Frames together, a rigid stitch, and the join (2026-11-07)

**Run:** `tools/acc-joins.py`, `acc-joins-bundle.py`, `acc-joins-stack.py`, `acc-joins-align.py`, `acc-joins-export.py`, `acc-joins-cost.py`, `acc-joins-report.py` on the NUC, copies and outputs in `reports/calib/accuracy/joins/` (not tracked). The 11 Bucharest frames are the same as in *The measuring stick*. They come from three cameras (KH-9 pan from eight missions, KH-7 1966, KH-9 mapping 1978) and include the August 1972 pair F006 and F007. Nothing in the product changed. `align` was run as the product's own functions and GDAL warps, with a stub for the job only.

**The ruler, held out:** 3.2 km blocks, 5 folds and 5 seeds, the same blocks over Sentinel-2 tiles and film ties, and no training tile of either kind within 900 m of a held one. Scoring is up to the 100 m line, before any RANSAC. A tie weighs 9 against a Sentinel-2 tile (12 m against 4 m), and both kinds narrow to 25 m. Both were fixed before any reading. The weights 1, 3 and 27 move the film ruler by 0.02 m at most, but not the Sentinel-2 figure: it reads 22.03, 22.06 and 23.74 m.

| Over the 52 pairs, blocked (seeds' range) | Film ruler | Same pass, never fitted | S2 held out, RMSE over frames (median) |
| --- | --- | --- | --- |
| The product's recipe, refitted per fold, poly2 | 14.90 (14.5-15.6) | 23.98 | 24.94 (14.8) |
| Each frame alone, all S2 tiles, poly2 / poly3 | 14.62 / 9.80 (8.3-11.8) | 22.42 / 17.09 | 24.83 / 22.66 (14.8 / 11.7) |
| All frames together, poly2 / poly3 | 9.13 / **6.02** (5.9-6.2) | 5.14 / **4.69** | 25.37 / 22.28 (15.1 / 11.2) |
| Together, poly3, segments rigid | 5.98 | 3.95 | 22.26 (11.2) |

- **Together beats any one frame on the film ruler:** poly3 together is better than poly3 alone on all 52 pairs. With every tile and only the scored pair's ties left out (not blocked), pairs read 6.51 m alone and 5.61 m together, and the same pass 3.46 and 3.24 m. **Against the reference it barely moves:** 22.66 to 22.28 m RMSE, a median of 11.7 to 11.2. KH-9 mapping reads 19.5 to 19.8 and A038 16.4 to 16.9, so the absolute place is not shown to improve.
- **Per frame, film ruler, blocked (recipe, alone poly3, together poly3):** F006 16.0, 12.2, 6.9; F007 12.0, 8.6, 5.8; F040 21.6, 13.1, 5.8; A001 13.1, 10.4, 7.4; F003 13.7, 7.9, 5.0; F022 13.9, 9.2, 6.8; A015 14.2, 9.0, 6.0; A038 14.8, 8.7, 5.1; F049 12.6, 7.9, 5.0; KH-7 17.1, 12.1, 6.7; KH-9 mapping 12.9, 7.8, 5.2. Real warps of one seed's five folds read the first-order figures again, within 0.05 m: 11.86 for alone, 6.23 together, 6.17 rigid.
- **Two frames get most of it.** For a pair adjusted alone, as a join would be, poly3 reads 10.02 to 6.27 m on itself and 8.76 to 8.11 m against frames that took no part (50 of 52 pairs better). S2 reads 21.87 to 21.61 m (43 better). In poly2 the pair reads 14.66 to 9.36 m on itself, but only 39 of 52 pairs improve against others, and the pair's S2 gets worse (24.32 to 24.55). Random groups of 2, 3, 5, 8 and 11 frames read 5.8, 5.9, 5.5, 5.9 and 5.9 m inside the group.
- **A frame with no Sentinel-2 tile of its own,** placed only through its ties, reads its own S2 tiles within 0.7 m of the frame fitted on them, or better: F006 25.7 against 26.6, KH-7 24.2 against 25.7. Other frames' S2 tiles at the same places share the reference's noise, but a cubic averages it.
- **Where no tile measured:** 99.5 to 100 % of each frame's part of the window lies within 1 km of a tile or a tie. In the rest the cubic together lies 6 to 23 m (RMS) from the product's map.

**A stack of dates** is the mean of the frames' matching filter, with the frames warped through the cubic together. Against one other film it halves the tile noise: 2.1 to 5.0 m against 3.9 to 5.7 m, with peaks 0.47 to 0.69 against 0.37 to 0.50. Against Sentinel-2 it hardly helps: missions 1213 to 1216 read 10.4 m against 11.8 to 12.7 m for its frames, and all frames 12.6 m. The early group, whose frames barely overlap, reads 18.7 m. More tiles pass (1,845 against 325 to 1,061). **Most of a tile's noise against Sentinel-2 is on the reference's side, or in what changed since, and a stack of films cannot remove it.**

**Stitch: the segments are turned, not only shifted.** On all 72 measured seams, each overlap is a rigid motion within 0.43 px (half the tiles train, the other half score). `stitch`'s translation leaves 6.05 px, and the turns are 0.48 mrad at the median and 4.8 at most. On the eight seams inside a crop, a rigid join takes the overlap from 0.6-6.7 m to 0.13-0.46 m, and its worst tile from 12.7 m (A015) to 0.94 m. **On the map the gain is small:** within 3 km of a seam, real warps of the cubic together read F049 5.14 to 4.69 m, F003 5.72 to 5.54, F007 6.89 to 6.54, A015 10.93 to 10.75, A038 3.82 to 3.66, F040 4.29 to 4.20. F006 reads 8.51 to 8.68 and F022 11.68 to 11.80. Over all pairs it is 6.02 to 5.98, and the same pass 4.69 to 3.95 (3.24 to 2.81 with every tile). It costs 0.6 s and 0.7 GB a seam on 4 CPU.

**What `warp` and `align` read is not the fitted map.** Both hand GDAL the points with `-order 2`, and GDAL fits its own place-to-pixel polynomial, separate from the fit's pixel-to-place one. Under the crop, that reverse lies from the fit by 0.0 to 0.6 m on F006, F007 and the mapping frame. It lies 8.5 to 13.2 m RMS (27 to 53 m at most) on F003, F022, A001, A015 and KH-7. A real warp of F003 at its maxzoom, through the saved points, reads 10.0 m against its own fit (2,991 tiles). Over the 52 pairs the warps through GDAL's reverse read 10.88 m against 10.82 m through the fit: 25 pairs better, 27 worse, by up to 5.7 m. **So every figure so far is of the fit, not of the published layer, and the two differ by about 10 m on half the frames.** Exported fits:

| Through GDAL, reverse against the fit, cubic together, RMS over frames (worst) | 12 x 12 points | 17 x 17 (289: `MAX_GCPS` is 300) | 25 x 25 |
| --- | --- | --- | --- |
| `-order 2`, today's | 9.47 (69 m) | | 9.18 (76 m) |
| `-order 3` | 0.95 (6.1 m) | 0.92 (6.9 m) | 0.90 (7.5 m) |
| `tps` | 1.42 (18.7 m) | 0.58 (10.1 m) | 0.22 (5.8 m) |

A real warp of F003, the cubic together, at 1.19 m, outputs bounded to the window, 4 CPU on a shared machine, against the map it should show: `tps` 17 x 17 0.39 m in 170 s, 25 x 25 0.13 m in 314 s, 40 x 40 0.11 m in 552 s. `-order 3` gives 0.80 m in 55 s, and the saved points with `-order 2` 10.0 m in 57 to 71 s, all at 4.4 to 5.1 GB. In the fold warps, the cubic together through 25 x 25 `tps` reads 6.23 m, the same as its exact inverse. Poly2 together through a 25 x 25 lattice and `-order 2` reads 16.33 m against 9.08 m exact.

**The join (`align`, real), the four that have two parts.** The seam is read three ways: `align`'s own figure, the ruler's 450 m tile (as the same pass's) or 900 m tile within 1.5 km of the seam, and each part against the nine frames that took no part, within 6 km. "Third party" figures are unseen only for the product's points and the pair-only fits: frames-together fits saw those frames' ties.

| Join | Variant | `align` samples, own before / after | Gap, 900 m tile (450 m) before / after | Third party, each part, before / after | s, 4 CPU |
| --- | --- | --- | --- | --- | --- |
| F006 + F007, Aug 1972 | product | 27, 8.7 / 1.3, moved 14.2 m | 450 m: 12.6 / 3.2 | 10.6 / 10.8, 9.9 / 9.2 | 17-27 |
| | pair, poly3 as 25 x 25 `tps` | 26, 4.1 / 2.5, moved 2.1 m | 450 m: 3.4 / 2.5 | 8.7 / 8.7, 8.2 / 8.2 | 55-66 |
| F003 + F022, two dates | product | 3, not measured | 8.6 | 8.7, 9.6 | 11 |
| | ruler's ties fed to `align`'s model | 236, held tiles 7.8 / 5.9 | 8.6 / 7.1 | 8.6 / 8.5, 9.5 / 9.3 | 12 |
| | pair, poly2 / poly3 | not measured | 12.1 / 6.5 | 9.8, 15.6 / 8.4, 9.6 | 10 / 78-86 |
| F040 + F049, winter and 1214 | product | 5, not measured | 6.8 | 11.8, 9.0 | 9-13 |
| | ruler's ties | 198, held 6.3 / 3.4 | 6.8 / 4.0 | 11.7 / 11.1, 9.0 / 9.1 | 16 |
| | pair, poly2 / poly3 | not measured | 5.3 / 3.4 | 9.7, 9.2 / 8.2, 7.9 | 12 / 64-66 |
| F007 + KH-7, 1966 | product | 2, not measured | 14.3 | 8.7, 13.5 | 9 |
| | ruler's ties | 163, held 12.5 / 11.2 | 14.3 / 14.8 | 8.7 / 9.0, 13.5 / 13.3 | 17 |
| | pair, poly2 / poly3 | not measured | 14.9 / 4.2 | 8.8, 15.1 / 7.4, 8.1 | 13 / 62-64 |

Every run peaked at 1.4 to 2.0 GB.

- **`align`'s seam correction works only within one pass.** Across dates and cameras, its 450 m tile at peak 0.5 finds 1 to 5 of about 25 samples, and the seam stays as it was: 6.8 to 14.3 m on the 900 m tile. On the same pass it closes what it sees (8.7 to 1.3 m) and leaves the parts where they were on the ground: 10.6 to 10.8 and 9.9 to 9.2 m against the other frames.
- **The ruler's ties fed to the same model measure every seam,** with 163 to 236 samples. Held tiles read 7.8 to 5.9, 6.3 to 3.4 and 12.5 to 11.2 m, and the 900 m gap 8.6 to 7.1 and 6.8 to 4.0 m, but 14.3 to 14.8 m on KH-7. Third parties stay within 0.6 m, so this closes a seam and places nothing.
- **The pair fitted together in poly3 closes more and places better:** gaps 6.5, 3.4 and 4.2 m with nothing for `align` left to move (2.1 m on the same pass), and third parties better by 0 to 5.4 m (KH-7 13.5 to 8.1). **In poly2 it is worse than the product** on two joins of three: F022 9.6 to 15.6, KH-7 13.5 to 15.1.
- **KH-9 mapping with any KH-9 pan frame is not a join:** the mapping frame is deeper everywhere, so `align` leaves the panoramic frame out. A frames-together fit is the only way they share anything.
- **Not run:** a whole job (`georef` writing points, `warp`, `merge`). The 625 `tps` points here are over `MAX_GCPS` (300): the 289-point lattice was read through GDAL, but `align` did not run on it. Nor was any other city run. The ties are the ruler's own, measured through the product's map, and a frames-together fit has not been through `prove`.

**Cost, 4 CPU, NUC shared:** two frames warped and read on the film ruler take 6.3 s and 1.3 GB. All 52 pairs from warps already made take 48 s. The solve takes 0.05 s for 2 frames and 0.55 s for 11. A rigid seam takes 0.6 s, and all 13 of F006's 2.8 s, 0.7 GB.

### Matching variants on the ruler (2026-11-08)

**Run:** `tools/acc-matching.py` (rows), `acc-matching-score.py` (rulers), `acc-matching-batch.py` on the NUC, copies and every score in `reports/calib/accuracy/matching/` (not tracked); `pipeline/src` unchanged. The 11 Bucharest frames (KH-9 pan of seven dates, KH-7, KH-9 mapping) through their product maps onto the reference's 10 m lattice; every variant matched every tile there, before any gate, and **each variant's gate was set on a wrong-place null (tiles 2.1 km off) to the product gate's own false-accept share, 1.4 %**: the product's 0.2 peak would let 32 % of null tiles through at 450 m tiles and 0.1 % at 1,350 m. Readers: the product's pairs (`choose`, poly2, about 100 pairs), the same with poly3, and poly3 on every gated tile. The judge is the film ruler (52 pairs, first-order, checked by real warps on 4 pairs within 0.16 m), with a leave-one-frame-out standard error; beside it Sentinel-2 tiles of the base matcher held out in blocks (fixed for every variant), the variant's **own** blocked figure, tile noise read film against film ((r_a - r_b) - d, which cancels the reference and the maps) and what frames share at a place. Control: the saved rows read 10.81 / 6.51 m, the ruler's own 10.8 / 6.5.

| Variant | Tiles | Pairs, poly2 | Pairs, poly3 | All tiles, poly3 (52 pairs better) | Same pass | S2 held out | Own figure | Tile noise | Shared | 4 CPU, f003 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Product matcher | 11,639 | 11.14 | 8.58 | 6.45 | 3.4 | 21.7 | 21.7 | 12.0 | 12.3 | 4.8 s |
| **Orientation (double angle, structure tensor)** | 19,860 | 9.97 (-1.17 +- 0.95) | 7.06 (-1.52 +- 0.51) | **6.01 (-0.44 +- 0.17, 46)** | 3.5 | 21.4 | 12.3 | 7.4 | 6.3 | 5.0 s |
| the same on a 7 m lattice | 21,292 | 10.00 | 6.72 | 5.87 (-0.58 +- 0.19, 50) | 2.7 | 21.3 | 11.0 | 7.0 | 5.4 | |
| the same, 1,350 m tiles | 24,995 | 10.35 | 6.66 (-1.92 +- 0.64) | 5.93 (-0.52, 49) | 3.7 | 21.5 | 8.3 | 6.1 | 4.4 | 5.8 s |
| Change mask from the other half's films | 16,847 | 10.51 | 7.97 | 6.12 (-0.33 +- 0.12, 45) | 3.5 | 21.4 | 16.3 | 9.6 | 8.8 | 7.5 s |
| Phase correlation, raw grey | 11,039 | 10.51 | 6.88 (-1.70 +- 0.64) | 6.19 (-0.26 +- 0.18) | 3.3 | 21.3 | 14.3 | 8.8 | 5.6 | 3.6 s |
| 1,350 m tiles | 17,018 | 10.94 | 7.61 (-0.97 +- 0.39) | 6.42 | 6.4 | 21.6 | 16.8 | 10.6 | 8.9 | 4.7 s |
| Median of five scenes | 12,262 | 11.77 | 9.37 | 6.76 (+0.31) | 4.5 | 22.0 | 19.9 | 11.7 | 11.4 | 4.4 s |
| Mutual information (search 100 m) | 6,257 | 11.31 | 10.14 | 7.12 (+0.67) | 6.6 | 21.8 | 21.0 | 12.2 | 9.3 | 30.7 s |
| 450 m tiles | 19,346 | 11.81 | 10.13 | 6.95 (+0.50) | 5.8 | 21.5 | 29.9 | 16.1 | 18.3 | |
| Strong tiles only (peak 0.3) | 5,532 | 12.20 | 9.84 | 8.01 (+1.57) | 5.3 | 21.7 | 14.6 | 6.6 | 8.8 | |

Ground metres, RMS over pairs; brackets: change against the product matcher, its leave-one-frame-out error, pairs better. Per frame, poly3 on all tiles, product matcher to orientation: F006 6.7 to 6.6, F007 6.4 to 5.8, F040 7.1 to 6.1, A001 7.9 to 7.5, F003 5.6 to 5.0, F022 6.9 to 6.5, A015 6.3 to 6.1, A038 5.5 to 5.2, F049 5.5 to 5.0, KH-7 7.2 to 6.7, KH-9 mapping 5.5 to 5.1; through the product's poly2 pairs F040 14.6 to 10.2, A038 11.6 to 9.1, KH-7 12.4 to 12.2.

- **Only orientation lowers the true error everywhere, and less than its own figure says.** It wins in both halves of the frames and on every sensor (pan pairs -0.47, KH-7 -0.44, KH-9 mapping -0.35 m), and real warps agree (F040 with KH-9 mapping 5.32 to 4.89 m). Its own blocked figure falls 9.4 m, the ruler 0.4 m (1.5 m with about 100 pairs): **the tile is twice as good, the map a little, because a map already averages thousands of tiles.** What remains is the camera and the shared world, not the match.
- **Much of the shared "place" term was the matcher's:** 12.3 to 6.3 m with orientation, which ignores which side of an edge is bright. Read on survivors, so a bound, not a split.
- **Lowers the fit figure, not the error:** larger tiles alone (1,800 m own 13.9, ruler +0.26), strong tiles only, weights by peak (+0.11 to +1.55), tiles chosen by land cover or texture. **Neither:** sub-cell methods (|change| 0.1 m or less; on a known shift no method is biased over 0.06 m except a cubic upsample, 0.2 to 0.4 m), an upsampled reference with the same blur, the start from the cubic.
- **Worse on the ruler:** mutual information, phase correlation on the filter, raw, high-passed or locally normalised grey, any shadow filter (closing +0.55, opening +0.26, log +0.16), masking vegetation (+2.88) or WorldCover cropland (+0.59) or trees (+1.44), a median of five scenes (+0.31, its same pass 4.5), a single other date (-0.11 to +0.36, none clear). The change mask helps a little (-0.33, only pairs inside a half, so no frame judged its own mask) and adds nothing to orientation (5.97).
- **Not a finding:** the coarse-to-fine matcher read 42 to 100 m on the same pass: an implementation fault, excluded. About 70 variants were read; orientation's 2.6 standard errors is replicated across halves and sensors, the spread among its own tweaks is not.
- **Cost, 4 CPU, f003 / KH-7 / KH-9 mapping, one round:** product 4.8 / 2.2 / 5.3 s, orientation 5.0 / 3.4 / 6.4 s, main process 1.2 to 2.0 GB (workers not captured); the change mask needs the other frames warped (+3 to 5 s); mutual information 31 / 20 / 43 s; a 5 m lattice 18 / 9 / 22 s and 2.9 to 5.0 GB.
- **Sources:** scenes and ESA WorldCover 2021 were already in `~/hcm-calib/ref` (provenance with sha256 in `ref/provenance.json`); this phase downloaded nothing. Copernicus Sentinel data: free, full and open, with attribution. WorldCover: CC BY 4.0, "© ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium" ([data access](https://esa-worldcover.org/en/data-access); Zanaga et al. 2022, doi 10.5281/zenodo.7254221). No Mapbox Satellite, no `fostulbucuresti` resource.

## 15. Server and admin, as built (2026-11-06)

Everything of §7, §8, §11 and §12 landed; where it differs:

| Spec | As built | Why |
| --- | --- | --- |
| `CITY_MIN_COVERAGE_PCT` in `approval.ts` | In `schemas/imagery-settings.ts`, and read by the join's offer too | One bar for the policy and the page. |
| The pass's key | `passKeyOf` in `schemas/imagery-calibration.ts`, spelt as `calibrate/prior.py`'s `pass_key` (both tests name `D3C1203-300415-F-1975-08-20`) | A pipeline read and a server write must agree. |
| `allow-list.ts` adds the pass | `documentTarget` answers `pass` for the scene's mission and camera with any `YYYY-MM-DD`; a read through `worker.step`, never a write | The date lies on the scene, which the list does not read. |
| Keys of §8 | `covered` is the existing `join.coverageMeasured`, word for word; no `title`: `how` is the block's heading; `matcher` and `local-ai` read `how.votes` (the same proof, found automatically) | The budgets stay, with 630 KB in all and 18 KB for Imagery full; ten text keys nothing read went for the same reason (`adminContent.map.label`, nine of `adminContent.photos.*`). |
| The block in `imagery` | `calibration-card.ts` is part of the `join-card` chunk, rendered by its `versionJoin` and `joinReport`; any open version fetches it, so on the card the waits come above the error | The Imagery chunk reached 18.5 KB; budgets are not raised. |
| Rows of §10 | Also `S-A66-HAPPY-MEASURED-OUTLINE`, `S-A67-HAPPY-PASS-RECORDED`, `S-A67-BAD-PASS-NOT-PROVED` | §2 and §5 are behaviours too. |
| A seam of a join (M8) | A refused correction on a seam at or under `SEAM_ALREADY_CLOSED_M` (2 m) reads `applied: true`, nothing moved | Real frames joined at 0.34 m on the e2e world and waited for a click, as nothing could improve them. |
| A delivery on a frame nothing proved | Stays, as §6 says, also once the matcher succeeded: `S-A62-HAPPY-WORKER-RUN` asserts it. Until the bucket's 7 days, or on a worker's disk until a pass that claims nothing, once it is 7 days old (`LocalObjectStore._stale_folders`): a stopped or always busy worker keeps it longer. **This job never reads it again:** `extract` is its only reader and `runner.py`'s `LOCATE_INPUTS` keep it from running once `locate` is finished, and re-cropping a stored frame is cut (§13). All it buys is that another import of the same scene within those days, this city's or another's, skips the download (`FetchStep._delivered`) | **Open for the owner:** delete it at the end of `locate` too? About 8.7 GB held for up to 7 days, against a free re-import of a frame nothing proved. |
| A crop of a USGS frame | Under 90 % of the city it waits for one click, as §11 says (`S-A16-HAPPY-CROP`) | The rendered figure survives a crop. |
| The admin's budget | 629.0 KB of 630: `packages/admin/vite.config.ts` drops annotation comments from the chunks (1 KB), since nothing bundles them again; the card's one `waits.notProved` replaces `selfChecked` | Not raised. |
| `coverage_pct` | Stops at 100 | Whole pixels over a fractional span read 100.04 %, which the schemas refuse (`docs/LESSONS.md` 370). |

A frame nothing proved shows `notFound` only while it needs points; once it has them it shows the fit's figures. A re-rendered version carries no `calibration` (`regeoref.ts` does not copy it), so its page has no block, and its `source` keeps it under the coverage rule.

## 16. Panoramic strips searched along their length (2026-11-09)

The live KH-4A frames of 1966-08-18 (F046, F047) ended in `locate` with `not proved (no-votes)` and a crop of 137,350 by 9,288 pixels: a Corona strip is about 17 by 230 km, and its four corners give no homography. A corner quad that is not a parallelogram makes one bend the strip's long axis as a perspective would, kilometres off and tens of percent out of scale far from its ends; and the crop of a frame nothing proved was the union of orientations that put the city at either end, so the whole strip.

`calibrate/strip.py`, for a sensor whose `SensorSpec.strip` is set (KH-4, KH-4A, KH-4B; not KH-9-pan, which has its camera model) and a film at least `STRIP_MIN_ASPECT` (4) times as long as it is high:

| What | How |
| --- | --- |
| Where the city lies along the strip | Each plausible orientation's centre line (the middle of the first column to the middle of the last, on the ground) is taken as linear in film columns; the city's window projects onto it as a share of the length. |
| The window | That share with `STRIP_MARGIN_GROUND_M` (15 km) before and after, the film's full height; overlapping windows of several orientations are one. The film stored reversed is another orientation, so the city's place from the other end is a window too. |
| The map inside it | `local_map`: the window's four film corners onto the footprint's long edges, linearly; the votes, the proof and the local AI then run unchanged inside it (`Frame.exposure` and `limits` are the window's columns). |
| Which window | The chain in each in turn: the first proved ends it; else the window with the most agreeing votes (the first of equals), whose crop was that window's until 2026-11-12; now no window is kept unproved and the whole strip is offered shrunk (§17). |
| No place on the strip | A footprint that puts the city on no part of the strip under any orientation slides `SLIDE_GROUND_M` (40 km) windows, half overlapping, along the whole strip, each moved onto the city: votes and proofs only, the local AI asked of none (it would run once a window). |
| The log | `strip window: film columns a to b of W (x to y % along), from the footprint, n orientations` for each, and `strip window kept: …` for the one kept. |

Tests: `pipeline/tests/unit/test_calibrate_strip.py`, a synthetic 240 by 17.5 km strip wider at one end (16 to 20 km, no parallelogram), the city 60 % along, the corners 3 km off: proved within 25 m in the window around 60 %, and stored reversed, around 40 %; a footprint 400 km off slides windows over the whole strip (`S-P06-HAPPY-STRIP-WINDOW`, `S-P06-BAD-STRIP-NO-PLACE`).

**UNVERIFIED** on a real Corona: no real KH-4 frame has run through it yet. Corona keeps no camera model, so a window's map is the footprint's linear one: near the strip's middle a 70-degree sweep makes the ground about 13 % shorter along and up to 22 % narrower across than the corners say, which the Corona scales (0.85, 1.0, 1.15) cover only in part. DS09065A089MC039 (1964-06-18) is a KH-5 Argon mapping frame, square, read by its own camera (§14); the strip windows do not apply to it.

## 17. A frame nothing proved is offered whole (2026-11-12)

Live: DS1103-1058DF027 (1968-05-05, a Corona strip 131,443 px wide). The footprint named two windows (columns 19,150 to 54,814 and 76,629 to 112,293); the local AI proposed nothing in either, and `locate` kept the **first** unproved (`not proved (no-votes): crop 35664 x 8172 px, delivery kept`). It is countryside: the georeferencer showed farmland and nobody could place a point on the city. A guess that could not be proved had still chosen what the owner sees.

| What | How |
| --- | --- |
| When | `whole.offered_whole`: nothing proved **and** the search held a part of the frame (a strip's window), or ran out of its `search_seconds` (the KH-5 cap), or the exposure's long side is over `WHOLE_MAX_PX` (16,384, `stitch`'s preview budget). Only a frame searched whole, in time and within that budget keeps `bounded_crop` (§6) and the matcher. |
| The scan | The whole exposure, averaged down by the whole number that fits `WHOLE_MAX_PX` (DF027: 9 times, about 14,600 by 900 px), read out of the segments by `SegmentReader`. `version.georef` is removed (no corner pairs: nothing starts a matcher on a shrunk strip), `calibration` is the refusal as before, the delivery stays. |
| How the scan says so | `scan.tif` carries `HCM_WHOLE_FRAME` (`{factor, left, top}`) in its own GDAL metadata: the version's files outlive the work folder, and no document or schema changes shape. A whole frame at full resolution carries nothing: its points are fitted on it as they are. |
| The log | `not proved (no-votes) in any part of the frame: the whole frame is the scan, shrunk 9 times (W x H px), delivery kept; waits for a person: place a few rough points anywhere on the strip`. |
| After the points | `georef` (`steps/recrop.py`), for the admin's points on a marked scan of a frame nothing proved: the points go onto the film (`x * factor + left`), the film is cut around them with the city window's larger side as margin, at the points' own scale (how far they spread on film over how far on the ground), inside the exposure, at **full resolution** out of the segments; the points move into the crop, the version's `scan` and `georef` are written, and the step goes on as with any scan (the points seed the tiles, else are fitted as saved; then `warp`). |
| Refusals | A point off the scan: `apiError.imagery.gcpOutside`. Points on one place: `apiError.imagery.degenerateGcps`. `frame.json` or a segment no longer stored: `apiError.imagery.processingFailed`, whose log line says to use **Locate again** while the delivery is kept, else to import the frame again. |
| Frames parked with the wrong crop | **Locate again** (and `imagery.tick`'s `relocate`, once the image changes) runs `stitch` and `locate` again from the kept delivery: the frame then waits with the whole strip. |

Tests: `pipeline/tests/unit/test_whole.py`, `pipeline/tests/integration/test_whole_frame.py` (a synthetic strip of 6000 by 900 px in four segments over another place, searched in its footprint's window): `S-P06-HAPPY-WHOLE-STRIP`, `S-P06-BAD-WHOLE-STRIP-UNPROVED`, `S-P06-HAPPY-ROUGH-POINTS-CROP`, `S-P06-BAD-ROUGH-POINTS-OUTSIDE`, `S-P06-BAD-ROUGH-POINTS-FILM-GONE`.

**Not done here:** the admin's own text still says the scan needs points (`apiError.imagery.noMatch`); only the job's log says "anywhere on the strip". The georeferencer shows the 4,096 px preview of the shrunk strip (about 32 film pixels a preview pixel on DF027): enough to find the city, not a street.
