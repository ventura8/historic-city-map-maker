# M15: calibration accuracy, what to build

The owner, 2026-11-08: improve the calibration error; the joint solve, *Joint solve*; terrain, *Terrain* at the end. Evidence: [M9 §14](M9-calibration.md#14-rehearsal-on-real-frames-2026-11-06) and `reports/calib/accuracy/` (git-ignored), on 11 Bucharest frames (KH-9 pan from 8 missions, KH-7, KH-9 mapping) plus F006 over Pitești. No product code changed.

**The ruler.** Sentinel-2 cannot judge a 5 m map: its tile noise against film is 10 to 14 m. The judge is the **film ruler**: 52 pairs of frames compared with each other, ground metres, held out twice (3.2 km blocks, 900 m buffer, unseen by both fits; repeated on 8 km blocks). Self-checks: a frame against itself reads 0.007 m; an injected field returns within 1.5 m. Blind spot: an error all frames share, above all an absolute shift. "Per frame" splits a pair's error between its frames (three-cornered hat).

## Error budget, today's product

| Term | Size | Evidence |
| --- | --- | --- |
| **Published layer is not the fitted map** | 8.5 to 13 m RMS, 252 m at a corner | `gdalwarp -order 2` fits its own inverse polynomial |
| **Camera misfit, KH-9 pan** | 5 to 11 m | cubic-shaped along the scan; KH-7 3.2, KH-9 mapping 1.0 |
| Too few points in the fit | 3 to 5 m | camp on ~100 pairs 11.1, on every tile 7.7 |
| Film tile noise | 2 to 5 m a tile | averaged over thousands of tiles |
| Seams | 0.4 to 4.7 m, 12.7 m worst tile | segments are turned; `stitch` only shifts |
| Terrain | 6.2 m on A001, 7.8 m over Pitești after poly2 | measured with Copernicus DEM (`acc-open-refs.md`); built (*Terrain*, below) |
| Sentinel-2 absolute | about 4.6 m RMS | my arithmetic from under 8 m CE95, not measured |

Double held out, 52 pairs: **15.7 m RMS** fitted, **14.4 m** as GDAL renders it; per frame 3.2 to 12.3 m (median 7.0).

## What is achievable, and the floor

- **Between frames, about 4 to 5 m per frame.** With the camera model the real render reads 2.5 to 6.7 m (median 4.4).
- **The floor:** on every tile all flexible models converge at 6.4 to 6.6 m pair RMS (about 4.6 m per frame); with tile noise extrapolated to zero, 5.4 to 6.25. What remains is film tile noise and misfit no model holds; more freedom (poly4, free warps) gets worse held out.
- **Absolute: about 5 to 8 m, unproven.** Sentinel-2's shared error adds to every frame and the ruler cannot see it; OSM or a second scene would measure it.
- **The Sentinel-2 checkpoint figure stays near 17 to 25 m** even as the map improves (camp 21.5 against 24.2): reference noise and 50 years of city change dominate it.

## Build, in order

1. **Render what we fitted.** *Built (As built, below).* Sample the fitted map on a lattice and warp with `-tps`: 14x14 (196, under `MAX_AUTO_GCPS` 200) reproduces it within 0.02 to 0.79 m; 17x17 (289, under `MAX_GCPS` 300) better. Camp rendered: 6.69 m against 6.61 m in Python. Cost: 109 s against 95 s a full warp, same 6.7 GB peak. Nodes are not measurements: they need an origin `lattice` that the editor, `checkpointRmseM` and leave-one-out skip. Every later gain depends on this.
2. **Panoramic camera model (camp), KH-9 pan only.** *Built (As built, below).* Five physical angles under a soft prior plus poly2, fitted on **every gated tile** after blocked checkpoints are set aside (stored pairs stay as the editor's sample). Double held out 15.72 → **7.70 m** (gain 4.1 to 13.3 m, 95 %); 8 km blocks 26.7 → 11.4; 52 of 52 pairs better; beats poly3 by 0.7 to 4.8 m. Fit 0.2 s. Without the poly2 term it gets stuck, so it never ships without it. KH-7 and KH-9 mapping keep poly2.
3. **Orientation matcher** (structure tensor, double angle) in `measure`. −0.44 ± 0.17 m on every tile, −1.2 to −1.5 m with ~100 pairs; 46 of 52 pairs, every sensor; a real warp agrees (5.32 → 4.89). Its own figure overstates the gain twentyfold. Cost +0.2 to 1.2 s a round, memory 1.2 to 2.0 GB against 0.85 to 1.3. The peak gate is reset on the wrong-place null (1.4 % false tiles).
4. **Adjust a city's frames together** (film ties, weight 9). *Built as each new frame joining the accepted frames held still, so nothing published is reissued (Joint solve, below).* Poly3 alone → together 9.80 → 6.02 m; the never-fitted same pass 17.1 → 4.7; 52 of 52. Sentinel-2 does not move: this is consistency between layers (swipe compare), not absolute position. Solve 0.55 s, ties 48 s. **It reissues published versions: the owner's decision.**
5. **Rigid stitch** (rotation and shift per segment). Worst seam tile 12.7 → 0.94 m, same pass 4.69 → 3.95, overall only 6.02 → 5.98. 0.6 s a seam; it also fixes seams like KH-9 mapping's, 52 m off outside this crop.

Steps 2 to 4 were read alone; together they are unmeasured. Each lands only if the ruler repeats the gain after a whole job (`prove` → `pairs` → warp) on these frames **and** a second city.

## Do not build

| Variant | Why |
| --- | --- |
| poly4 | 18.2 m held out, 66.8 m same pass |
| poly3 as the answer | loses to camp; KH-7 extrapolation 37.8 against 20.2; runs away over holes |
| Thin plate, smoothed grid | 11.2 and 10.5 against 7.7; the grid on camp broke at 102 m |
| Mutual information | +0.67 m, six times slower |
| Strong tiles only, peak weights | +0.11 to +1.57 m: better own figure, worse truth |
| Land-cover masks, shadow filters | +0.16 to +2.88 m |
| Five-scene median, for the map | +0.31 m; can only help absolute, unmeasured |
| Per-segment S2 steps; align's seam pass across dates | overfit; 1 to 5 of ~25 samples pass |
| Coarse-to-fine | broken code (42 to 100 m), not judged |

## Waiting on the owner

- **Downloads**: a second Sentinel-2 scene (~44 MB, [Copernicus, free with attribution](https://ads.atmosphere.copernicus.eu/licences/ec-sentinel)), an OSM extract ([ODbL](https://osmfoundation.org/wiki/Licence/Attribution_Guidelines)), Copernicus DEM ([GLO-30 licence](https://documentation.dataspace.copernicus.eu/APIs/SentinelHub/Data/DEM/resources/license/License-COPDEM-30.pdf); recorded in `~/hcm-calib/ref/LICENCES.md` on the NUC and used since *Terrain*). They measure absolute position and terrain, small here, tens of metres in a hilly city.
- **M9 §13's cut on poly3** rested on the noisy Sentinel-2 reading; camp supersedes it.
- **Auto-publish** reads the saved checkpoint figure (12 to 22 m), which flatters: blocked, the same frames read 19 to 30 m. Move the threshold to the blocked figure.

## What the admin should see

Today: "Measured error 15 m", which mostly says how far today's satellite image is from a 1970s city. Instead:

- **"Lines up with your other photos within 5 m"** (`calibration.agrees`; ro *Se potrivește cu celelalte fotografii la 5 m*): the film ruler, when another frame overlaps. This is the figure that improves.
- **"Compared with today's satellite image: 21 m, including what was built or demolished since"** (`calibration.vsToday`; ro *Față de imaginea satelitară de azi: 21 m, inclusiv ce s-a construit sau demolat între timp*).
- **A shaded outline of the measured part**; outside it, "estimated, not measured here" (*estimat, nemăsurat aici*): unreached corners carry the largest errors.
- No absolute claim until OSM or a second scene measures one.

Keys in `ro` and `en`, inside the 650 KB budget, with a happy and a bad row in `e2e/scenarios.json`.

## As built (2026-11-08): steps 1 and 2

**Built.** Step 1 and step 2; steps 3 to 5 and the admin's new figures are not (below).

- **The layer is the fitted map** (`steps/warp.py` `rendered_points`, used by `warp` and by the join's `join/warping.py`). Every georeferenced scan warps with `-tps`: a thin-plate spline through its own enabled points; an affine or poly2 fit through 17 x 17 nodes sampled on the fit over the scan (`georef/lattice.py`), worked out at the warp from the pairs, so nothing is stored; a map its pairs cannot rebuild through its stored nodes. An upload's own georeference is unchanged.
- **Contract: `georef.lattice`** (`georefSchema`, `documents.py` `GeorefInfo`): `{model: 'panoramic', nodes: [{pixel, geo}]}`, exactly the 289 nodes the pipeline samples. Nodes are not measurements: they sit beside `gcps`, so no editor, residual, checkpoint or leave-one-out reads them. `imagery.saveGcps` writes a fresh georef, so the admin's points drop them (`S-A16-BAD-POINTS-DROP-LATTICE`); a crop or a re-render keeps the same scan and keeps them; a `georef` retry over them keeps the georef as it is (`kept: the panoramic map ...`).
- **The KH-9 pan camera** (`calibrate/camera.py`, `calibrate/pairs.py`): `locate` stores the film's radians a column in `calibration.json` (`radPerPx`, `steps/locate.py` `rad_per_px`: 121 degrees over the exposure, a shorter film at the full film's rate), KH-9 pan only. `calibrated` fits the camera on **every** gated tile of the cells not held for checks; the pairs stay the editor's sample (the same RANSAC as before) and `transform` stays theirs; their residuals, the checks (gated at 100 m against the camera), `checkpointRmseM`, `fitRmseM` and `crossValidatedM` (each fold of the pairs' 3.2 km cells against the camera fitted on the tiles outside it) are the camera's, and the lattice carries it to the warp. A camera holding under 90 % of the tiles the polynomial's RANSAC kept is not used. KH-7, KH-9 mapping, an older `calibration.json`, a re-measured proof and the admin's points keep their polynomial (rendered through the lattice).
- Rows `S-P06-HAPPY-RENDERED-FIT`, `S-P06-BAD-RENDERED-OWN-POINTS`, `S-P06-HAPPY-PANORAMIC-CAMERA`, `S-P06-BAD-PANORAMIC-FALLS-BACK`, `S-A16-BAD-POINTS-DROP-LATTICE`.

**Run.** On the NUC, `pipeline/src` of this branch (`src-accuracy`), `tools/m15b-product.py`, `m15b-warp.py`, `m15b-table.py` (copies with every output in `reports/calib/accuracy/m15b/`, not tracked; outputs on the NUC in `out/m15b/` and `out/acc-transforms/b{3200,8000}/prod*`). Each fold's map is the product's: `calibrated()` on that fold's tiles from the frame's own `calibration.json` with the job's seed, `recorded()`, then GDAL's own transformer of what the warp is handed (`-order N` through the enabled pairs before; `rendered_points()` and `-tps` after), inverted by Newton: what the layer shows at each place. The judge is the film ruler of the evidence above, unchanged: 52 pairs, blocks shared by all frames, nothing within 900 m of a held block in either frame's fit, scored before any RANSAC; 5 seeds x 5 folds; the 95 % interval resamples frames. Today's product reproduced its saved figures (`fitRmseM`, `checkpointRmseM`, `crossValidatedM`) within 0.02 m on 10 frames of 12; KH-9 mapping's checkpoint read 15.2 against 15.8 saved and F006 over Pitești's 15.3 against 15.4, not traced.

| Film ruler, 52 pairs, double held out (median pair) | Today: poly2 of ~100 pairs as GDAL renders it | Step 1 alone | **Steps 1 + 2, built** | The evidence's `camp` |
| --- | --- | --- | --- | --- |
| 3.2 km blocks | 14.64 (13.19) | 16.03 (13.67) | **8.14 (7.94)** | 7.70 |
| pairs better than today; gain, 95 % | | 18 of 52; -3.9 to +1.6 m | **52 of 52; +3.8 to +9.4 m** | |
| 8 km blocks | 25.57 (22.60) | 28.02 (25.36) | **12.65 (12.19)** | 11.39 |
| pairs better than today; gain, 95 % | | 18 of 52; -7.5 to +2.8 m | **52 of 52; +7.8 to +18.0 m** | |
| Same pass F006-F007, 1,525 tiles: held out / every tile | 22.2 / 12.6 | 22.8 / 13.2 | **9.5 / 4.1** | 8.5 / 3.8 |
| Every tile, in sample | 10.88 | 10.85 | 6.92 | 6.55 |
| By pair kind, 3.2 km: pan-pan, KH-9 mapping-pan, KH-7-pan, KH-7-mapping | 14.4, 10.4, 18.8, 14.2 | 15.8, 13.6, 19.3, 8.4 | 8.0, 6.8, 9.7, 8.4 | 7.6, 6.2, 9.3, 7.8 |
| Sentinel-2 tiles held out, 3.2 km, mean RMSE over 12 frames | 22.9 | 24.3 | 21.7 | 21.5 |

Ground metres, RMS over pairs. Each frame, RMS of its own pairs, 3.2 km then 8 km, today to built: F006 15.7 to 9.5, 29.9 to 15.5; F007 14.2 to 7.8, 25.5 to 10.8; F040 20.3 to 9.2, 31.6 to 16.1; A001 14.6 to 9.4, 22.4 to 12.5; F003 12.0 to 6.7, 22.0 to 10.7; F022 12.1 to 8.2, 21.6 to 12.7; A015 12.5 to 7.9, 19.3 to 11.9; A038 15.7 to 7.0, 28.6 to 11.3; F049 12.6 to 6.8, 21.1 to 10.1; KH-7 18.4 to 9.6, 36.3 to 16.0; KH-9 mapping 10.8 to 7.0, 18.3 to 10.5 (7 to 10 pairs each; a pair counts for both its frames).

**The layer against the map it should show** (real `gdalwarp` through the product's `gcp_source` and `warp_method`, a ramp scan whose pixels hold their own column and row at an eighth of the size, z15 over the Bucharest window; every third output pixel): today 0.19 to 12.97 m RMS (A001 13.0, F003 10.9, F022 10.8, A015 10.2, KH-7 8.3, F049 4.9, F040 3.5, A038 2.1; worst pixel 59.7 m); built 0.28 to 0.92 m (worst pixel 11.7 m on KH-7, 6.2 m on F003, at the scan's edge). Over every pair tile the stored lattice lies 0.08 to 0.33 m RMS from the camera itself.

**Cost** (one real warp of the real scan at z17 over the window, 4 CPU, 16 GB, alone on the NUC): F003 84.3 s, 5.46 GB today against 87.5 s, 5.45 GB built; A001 118.2 s, 4.89 GB against 120.3 s, 4.89 GB. `calibrated` 0.06 to 0.11 s today, 0.3 to 1.1 s with the camera, plus five camera fits for the blocked figure. The 109 against 95 s above was a shared machine. Budgets unchanged; the admin's Imagery chunk sits at its 18 KB: the schema moves the shared chunk's hash, which the Imagery chunk imports by name, so the first form of the lattice read 18,001 bytes and the exact count 17,998.

**The saved figures move, and with them auto-publish.** Built, against today (`checkpointRmseM`, the checks held out of both fits): F006 19.5 to 19.1, F007 14.2 to 13.2, F040 19.0 to 15.0, A001 21.3 to 18.7, F003 16.8 to 10.8, F022 22.1 to 18.7, A015 16.9 to 14.7, A038 12.0 to 7.5, F049 13.8 to 9.2, F006 over Pitești 15.3 to 12.8; KH-7 and KH-9 mapping unchanged. Under the default 15 m, three KH-9 pan frames of ten were under it, and seven are now (F040 at 14.99). That is the owner's threshold reading a lower, still held-out figure; the blocked reading of *Waiting on the owner* stands.

**What the run showed, plainly:**

- **Step 1 alone does not show its gain on the ruler**: 14.64 to 16.03 m, 18 pairs of 52 better. On KH-9 pan frames GDAL's own reverse polynomial happens to sit closer to the truth than the poly2 fit it should render, as neither is the camera; on the one pair without a panoramic frame, KH-7 with KH-9 mapping, it is 14.2 to 8.4 m. It stays because step 2 cannot reach the layer without it and the published layer is now the map every figure describes. The cost of that: a KH-9 pan frame whose camera is not used renders about 1.5 m worse than today.
- **The guard was first "at least as many tiles as RANSAC kept"**: 9 of 500 fold fits fell back to the poly2 of ~100 pairs and read 20 to 30 m, and the built figure was 9.79 m. A camera that converged keeps 0.989 to 1.02 times RANSAC's count on all 500; a wrong rate keeps none (synthetic) or under a third. So 90 %. It changed after the ruler was read; the bound comes from those counts, not from the figure.
- **What remains to the evidence's 7.70 m:** the cells held for checks (0.30 m: the product's camera alone, no lattice, reads 8.00) and KH-7 and KH-9 mapping fitted on ~100 pairs rather than every tile (8.00 against 8.14 at 3.2 km, 11.88 against 12.65 at 8 km; KH-7 with mapping 7.8 against 8.4 and 10.3 against 15.2). That last is a candidate: a `polynomial` lattice of every tile.
- **The second city is unproven.** F006 over Pitești has no second frame, so no film ruler; Sentinel-2 held out reads 17.6 to 17.2 m on 3.2 km blocks and 19.6 to 20.8 on 8 km, inside its own noise. Its checkpoint figure falls 15.3 to 12.8.
- **Not run:** a whole job through the runner on a real frame (`LocateStep`, `GeorefStep`, `WarpStep`, `export`). The proof was not run again: `dense.py` and `proof.py` did not change, and the tiles are each frame's own `calibration.json`, written by the product. Those files predate `radPerPx`; the harness took it from `frame.json` through the product's `rad_per_px`, as `locate` now does.
- **Sources:** nothing downloaded. The Sentinel-2 window already on the NUC (Copernicus Sentinel data, free, full and open, with attribution); no Mapbox Satellite, no `fostulbucuresti` resource.

**Not built in this round:** step 3 (orientation matcher: it changes `measure` and the proof's gate, so every frame's proof must run again and the gate be set on a wrong-place null; -0.44 m on every tile); step 4 (frames adjusted together: it reissues published versions, the owner's decision); step 5 (rigid stitch: 6.02 to 5.98 m overall, it changes `stitch` and every film coordinate after it); the admin's figures of *What the admin should see* (the film ruler is not in the product).

## Review of 2026-11-08: the georeferencer and the edges

**The georeferencer showed a map that is not published.** It refitted a version's stored pairs with a polynomial on load, so a KH-9 pan version (its camera fitted on every tile, published through `georef.lattice`) showed other errors, residuals and warnings than its version page, and a preview of the pairs' polynomial. Built: while the pairs and the transform are the version's, the page shows the figures and residuals the version stored and previews the lattice through a thin-plate spline, as the warp renders it (`packages/admin/src/georef/fit-view.ts` `ownFitOf`, `shownFit`); once they change, every figure and the preview are the refit, and a note says Save replaces the version's map with it (`adminContent.georef.refitted`). A version with no figures of its own (corner guesses) shows the refit with no note. Rows `S-A16-HAPPY-VERSION-FIGURES`, `S-A16-BAD-EDIT-REFITS`; state `georef.refitted`; `docs/LESSONS.md` 461.

**A001 at its edges.** The ruler's edge readings fit each frame on the middle 70 % of its tiles along one axis (900 m margin) and read the outer 15 % each side against the other frames' whole maps. On the film ruler A001's rows beyond its tiles read 15.5 m today and 19.2 m as built. Measured, through the product's functions on the folds of `tools/acc-transforms.py` (`tools/m15c-edge.py`, `m15d-try.py` on the NUC; outputs `out/m15c/`, `out/m15d/`):

| Variant (film ruler) | 3.2 km held, pairs | 8 km held, pairs | Edges along the rows, A001 | Edges along the scan, mean of 11 frames |
| --- | --- | --- | --- | --- |
| As built | 8.14 | 12.65 | 19.2 | 10.9 |
| Second-order term carried on its tangent beyond the tiles' box | 8.13 | **21.51** | 18.9 | **29.7** |
| The same along the rows only | 8.14 | not run | 18.9 | 10.9 (rows: F003 7.4 to 22.2, A038 9.3 to 23.1) |
| No v² term | 8.12 | not run | **24.0** | 10.8 |
| **Plainest of two mirrored cameras (built)** | **8.13** | **12.50** | 19.2 | 11.0 |

- **Falling back to a lower order where no tile is loses.** The tangent fallback cuts curvature that is real on most frames (along the scan F006 13.3 to 51.1 m, F003 6.9 to 65.8 m). The frame's own poly2 read on the same strips (stored `prodfit`) is better than the camera only on A001 and F007 along the rows (13.7 against 19.2, 15.0 against 15.9), level on F006 (19.6 against 19.7), and worse on every other frame along the rows and on every frame along the scan (F040 rows 28.9 against 16.8, F003 12.4 against 7.4). Neither was built.
- **What was wrong instead: a coin toss between mirrored cameras.** Each KH-9 pan frame has two cameras mirrored about the nadir that hold the same tiles within a tile or two (A001, on the tiles not held for checks: 700 and 698); one needs a second-order term of 0.3 to 1.2 km, the other 4.3 to 8.7 km, and the product kept whichever held a tile more or came out a hundredth of a metre closer. On every tile it had kept the bent one for A001 (8.7 km), F022 (7.4 km) and F049 (4.3 km). The two agree within 0.1 to 0.7 m RMS at the lattice's nodes over the tiles and part by 5.6 m RMS (23.1 m at worst) beyond them on A001, 4.6 (11.8) on F022, 2.0 (6.1) on F049. Built: both signs of the scan angle are followed, and of the cameras within 1 % of the most tiles the one with the smallest second-order term is kept (`calibrate/camera.py` `plainest`); a camera holding clearly more tiles still wins. Synthetic: the bent mirror (899 tiles against 898) read 4.1 m RMS beyond the tiles, the plainest 1.8 m. Rows `S-P06-HAPPY-CAMERA-PLAINEST-MIRROR`, `S-P06-BAD-CAMERA-PLAINEST-ONLY-AMONG-EQUALS`; `docs/LESSONS.md` 462.
- **On the ruler it is neutral, not a gain.** Against as built: 3.2 km gain −0.02 to +0.06 m (95 %, frames resampled), 33 pairs better and 18 worse; 8 km −0.04 to +0.34 m, 41 better and 10 worse; against today 52 of 52 better at both sizes. **A001's edge is not fixed**: 19.2 m along the rows, as built. The cause is not established: on those strips A001's own poly2 reads 13.7 m as fitted and 15.5 m as GDAL rendered it before M15, the evidence's poly2 of ~100 pairs 17.4 m and the camera variants 18.8 to 24.0 m; A001 is the frame with the strongest relief term (slope near 1 at tan 1.14, `acc-open-refs.md`), which no model here holds.

Each frame, today (before M15) / as built / now: own pairs on 3.2 km blocks; on 8 km blocks; film edges along the rows; along the scan (metres):

| Frame | 3.2 km | 8 km | Edge, rows | Edge, scan |
| --- | --- | --- | --- | --- |
| **A001** | 14.60 / 9.39 / 9.37 | 22.38 / 12.53 / 12.35 | 15.5 / 19.2 / 19.2 | 16.1 / 13.4 / 13.4 |
| **F006** | 15.65 / 9.52 / 9.50 | 29.89 / 15.52 / 15.26 | 19.8 / 19.7 / 19.7 | 21.1 / 13.3 / 11.9 |
| F007 | 14.24 / 7.82 / 7.81 | 25.47 / 10.80 / 10.60 | 17.1 / 15.9 / 16.0 | 27.2 / 12.3 / 12.6 |
| F040 | 20.32 / 9.21 / 9.14 | 31.63 / 16.15 / 16.05 | 30.7 / 16.8 / 16.8 | 33.2 / 16.2 / 16.2 |
| F003 | 12.00 / 6.73 / 6.74 | 22.02 / 10.70 / 10.81 | 11.9 / 7.4 / 7.5 | 12.0 / 6.9 / 6.7 |
| F022 | 12.06 / 8.22 / 8.22 | 21.58 / 12.65 / 12.27 | 12.0 / 11.3 / 11.3 | 14.2 / 10.1 / 10.2 |
| A015 | 12.54 / 7.89 / 7.88 | 19.29 / 11.86 / 11.61 | 10.6 / 8.9 / 8.8 | 15.6 / 10.5 / 11.7 |
| A038 | 15.67 / 6.95 / 6.90 | 28.56 / 11.29 / 11.11 | 13.9 / 9.3 / 9.3 | 21.1 / 8.0 / 8.5 |
| F049 | 12.61 / 6.82 / 6.82 | 21.06 / 10.14 / 9.92 | 13.2 / 7.3 / 7.3 | 19.5 / 9.4 / 9.4 |
| KH-7 | 18.38 / 9.58 / 9.62 | 36.28 / 15.98 / 16.04 | 33.6 / 15.6 / 15.6 | 18.2 / 12.9 / 13.0 |
| KH-9 mapping | 10.82 / 6.97 / 6.95 | 18.30 / 10.46 / 10.30 | 13.7 / 11.8 / 11.8 | 9.4 / 6.9 / 6.9 |

KH-7 and KH-9 mapping keep their polynomial; they move only through their partners. **F006 over Pitești** has no film ruler; Sentinel-2 at its edges (rows, scan) reads 19.8 / 25.6 today, 20.0 / 27.5 as built and 20.0 / 27.7 now, its held-out Sentinel-2 figure 17.6, 17.2, 17.2: its camera is the same one (scan angle −0.611 rad, second-order term 689 m).

**The saved figures move a little** (`checkpointRmseM`, on every tile, as built to now): A001 18.75 to 18.86, F022 18.72 to 18.33, F049 9.24 to 9.37, F006 19.10 to 19.19 (a camera near the nadir, 0.06 to 0.00 rad); the others are unchanged to 0.01 m; `crossValidatedM` moves by 0.15 m at most (F040 13.31 to 13.16). Cost unchanged: three starts followed, as before.

**Not run:** a whole job through the runner on a real frame; the second city has still no film ruler.

## The reference guard (2026-11-08)

**Why.** Three dates of tile 35TMK (2024-10-21, 2024-10-26, 2025-01-19, baseline 05.11) sit rigidly 9.8 to 13.0 m south of the others (`~/hcm-calib/out/acc-open-refs.md` on the NUC, finding 1), and every frame's bias follows the reference: 9.8 to 11.7 m north against them. `stac.py` took the least cloudy item over three years, and in today's cloud order over Bucharest 2024-10-26 is second and 2024-10-21 third: a cloud value a little different would have moved the whole city with no warning. The film ruler cannot see this (an error all frames share).

**What it does** (`pipeline/src/hcm_pipeline/agreement.py`, called by `steps/common.py` `sentinel2` for every window `locate` and `reference` read):

- **Candidates:** up to 5 sets that cover the window, chosen as before (`stac.choose`: one item, a date's mosaic of up to 4, or dates across an orbit seam), least cloudy first, each at least 30 days from the others, so one bad period counts once (2024-10-21 and 2024-10-26 are one vote).
- **Reading:** each set over the same patch, at most 10 by 10 km in the window's middle, at 10 m on a transverse Mercator centred there: ground metres east and north at any latitude, across UTM zones, tiles and mosaics. A set whose address is refused or that GDAL cannot read does not vote (a warning).
- **Measuring:** every pair's rigid offset is the median of its 900 m tiles (the gradient filter the calibration uses, ±50 m search, peak 0.3, at least 12 tiles).
- **Consensus:** each set against the median of the others; a set more than **7.5 m** off is rejected and the median is taken again without it, until none leaves. Two shifted dates of five pull a plain median by 2 to 3 m, enough to keep a third at 8.7 m; centred again, both go.
- **Choice:** the least cloudy set that agrees, when a majority of at least 3 read sets agrees (`agreed`). Under 3 read: the least cloudy readable one, `unchecked`. No majority: the same, `disputed`. Both warn in the job's log, and so does a rejected least cloudy date.
- **Record:** `version.reference.s2Check` (`status`, `boundM`, `chosen`, and for each set its items, date, cloud, offset `eastM` / `northM` from the consensus, `kept`), with `s2Item` and `s2Date` as before. The verdict is stored in the cached window's metadata (`HCM_S2_CHECK`), and the cache is keyed by every candidate, so `locate` measures once and `reference` reads it.
- **The bound:** 79 scenes of 35TMK at baseline 05.xx against their median: the clean ones sit at most 6.2 m off (P99 6.0 m), the three shifted dates 8.7, 11.1 and 11.8 m. 7.5 m is between them.
- **Cost:** each candidate reads one patch. Measured on Earth Search: 8 to 50 MB and 5 to 11 s for 4 or 5 sets per window, once per window and candidate list (the cache), against the city's own window read as before.

**Proof on real scenes** (the product's `candidates`, `read_patch`, `readings` and `decide` on public Earth Search, `~/hcm-calib/tools/guard/run_guard.py`, `replay.py`; results `~/hcm-calib/out/guard/run1.json` on the NUC). Offsets are ground metres from the consensus, east / north:

| Window | Candidates (today's search) | Rejected | Reference kept |
| --- | --- | --- | --- |
| Bucharest | 5; 2024-10-26 second by cloud | 2024-10-26 at −0.4 / −11.5 | S2C_35TMK_20260817 (−0.4 / +0.4), the scene the frames were calibrated on |
| Pitești | 5 | 2024-10-26 at +0.5 / −11.2 | S2C_35TLK_20260817 (−0.4 / +1.9), the frame's calibration scene (pixels identical) |
| Gothenburg, across zones 32 and 33 | 5 | the least cloudy, S2B_32VPK_20241204: its asset is an `s3://` address the guard refuses (before the guard this failed the reference) | S2B_33VUE_20240521 |
| Tromsø, 69.7° N | 5, two UTM zones | none (largest 2.8 m) | the least cloudy |
| Longyearbyen, 78.2° N | 5 | 2024-03-21, unmeasured (snow) | the least cloudy (+0.6 / +4.1) |
| Quito, on the equator | 4 (5 items under 20 % clouds in three years) | none (largest 0.8 m) | the least cloudy |
| Ushuaia, 54.8° S | 5 | 2024-07-24 (winter) at +11.6 / −1.5 | the least cloudy (+5.6 / −2.1) |

Forced sets, the shifted dates placed on purpose:

| Set over | Verdict |
| --- | --- |
| Bucharest, 2024-10-26 least cloudy, four sound dates | rejected at −11.3 m north; 2026-08-17 kept |
| Bucharest, 2024-10-21 and 2025-01-19 among five | both rejected (−12.7 and −9.8 m); 2026-08-17 kept. A plain median would have kept 2025-01-19 (6.8 m) |
| Pitești, 2024-10-26 least cloudy, three sound dates | rejected at −9.3 m; 2026-08-17 kept |
| Bucharest, all three shifted dates among five | **the shifted majority wins**: 2026-08-17 rejected at +11.9 m. A vote of 5 survives 2 bad sets, not 3; the 30-day spacing makes 2024-10-21 and 2024-10-26 one candidate, so these three dates can never be 3 of 5 |

**The ruler, before and after.** The guard keeps, for both cities, the very scene every frame was calibrated on (Bucharest: correlation 0.99996 with S2C_35TMK_20260817, Pitești: identical pixels with S2C_35TLK_20260817), so every frame's input, fit and film-ruler figure are unchanged by construction: the per-frame table of *Review of 2026-11-08* stands as it is (A001 9.37 / 12.35, F006 9.50 / 15.26, F007 7.81 / 10.60, F040 9.14 / 16.05, F003 6.74 / 10.81, F022 8.22 / 12.27, A015 7.88 / 11.61, A038 6.90 / 11.11, F049 6.82 / 9.92, KH-7 9.62 / 16.04, KH-9 mapping 6.95 / 10.30 m, 3.2 / 8 km blocks; F006 over Pitești 17.2 m held out against Sentinel-2). The ruler was not run again. What the guard buys is invisible to it: the 9.8 to 11.7 m shift every frame would have taken against a shifted date.

**Synthetic proof** (`pipeline/tests/unit/test_agreement.py`, `tests/integration/test_import_job.py`): one texture placed off by known metres reads back within 0.5 m around Bucharest, within 1 m in EPSG:32633 at 78° N, EPSG:32719 at 55° S and as a mosaic of EPSG:32717 and 32718 across the equator's zone seam; a whole import whose least cloudy date is moved 12 m south takes the world's own date and records the check. Rows `S-P06-HAPPY-REFERENCE-AGREEMENT`, `S-P06-BAD-REFERENCE-SHIFTED-DATE`, `S-P06-HAPPY-REFERENCE-ANY-LATITUDE`, `S-P06-BAD-REFERENCE-TOO-FEW`, `S-P06-BAD-REFERENCE-UNREADABLE`.

**Limits.** The guard sees a date that disagrees with others, not an error all of them share (Sentinel-2's absolute error, about 4.6 m RMS by the published figure). A window across the antimeridian is not handled, as before. The admin does not show `s2Check` yet: the record and the job log carry it (the imagery chunk has no bytes to spare). The cause of the shifted dates is still not established.

## Joint solve (2026-11-08): a new frame lined up with the accepted frames it overlaps

**Why.** The nearby-years evidence (`reports/calib/accuracy/`, the owner's two reports of 2026-11-08): solving every overlapping frame together on its Sentinel-2 tiles and film ties beats each frame alone on rulers no fit saw (6.68 to 5.91 m pair-out with no shared helper; on the blocked ruler much more, as ties fill where tiles are thin); chains drift (12 m RMS after one hop, 93 m after ten); closeness in years barely matters; a new frame joining a pool held still reads 5.65 m against 5.64 m for solving all again, and old frames would move 0.31 m with a pool of ten; the absolute gain is real only where tiles are thin.

**What it does** (`calibrate/joint.py`, `joining.py`, `together.py`, `ties.py`; `steps/aligning.py`):

- **Each proved frame keeps `align.tif`** (`export`): its layer's grey at 5 ground metres, on a grid of whole cells of the city's window shared by every frame, deflated, 0 no data. A new version file (`VERSION_FILES`).
- **`georef` of a proved frame** fits it alone first (as before), then finds the city's frames an admin accepted (`approved`, `publishing`, `published`) that a proof placed (`calibration.how` of a proof, `georef.method` `auto`), whose output overlaps the frame's pairs and checks and that kept `align.tif`: at most 12, newest first. It renders its own first map at 5 m (the warp's own thin-plate points), and for each held frame, one file staged at a time, looks for every 900 m tile of the held frame (every 450 m, ±150 m, the proof's peak and margin gates) in its own image. A tie is the place the held frame shows the tile's middle at and the film pixel of ours that shows the same feature (our warp's own place-to-pixel transform at that place plus the offset found).
- **The fit.** Ties are rows like Sentinel-2 tiles, nine times the weight (M15 step 4; measured noise 2.4 to 3.7 m against 8.1 m a tile). A KH-9 pan frame keeps its camera (joined), when it holds nearly the tiles the polynomial's RANSAC kept; any other frame takes a cubic on every tile and tie, **restricted to its film's measured box** (`Restricted`: beyond the box, the cubic's value at its edge plus the growth of the second-order fit of the same rows). Either is stored as `georef.lattice` (models `panoramic`, `polynomial`). The pairs, the checks and the blocked figure stay the frame's own; a tie in a checkpoint's cell never counts, so the checkpoint figure stays held out of every fit.
- **Who counts.** A partner with at least 100 ties and a quarter of its tried tiles holding (`few` otherwise: a wrong place gates at most 1.3 %, a real pair 51 % or more). A partner whose ties sit more than 6 m from the map of the frame's own tiles and its other partners is left out (`disagrees`), the furthest first and alone, the rest measured again (lesson 465).
- **Nothing published moves.** Held frames are read, never rendered again; lining an older frame up with the newer ones is the owner's choice (the version page says so; no one-click action is built). A frame placed only by the admin's points is never held, and every frame keeps its own tiles: no chain.
- **Record and words.** `calibration.alignment.partners[]`: `versionId`, `year`, `ties`, `tried`, `status` (`used`, `few`, `disagrees`), `offsetM`; the job log says how many frames were held and how many ties, and who was left out. The version page: "Lined up with your photos of 1972, 1977 at 2230 shared points", "Those photos stay where they are; lining them up with this one is your choice", and "Not lined up with 1978: their streets sat over 6 m from the others" (ro and en; `S-A67-HAPPY-ALIGNED`, `S-A67-BAD-ALIGNED-LEFT-OUT`).
- **Where it runs.** The same step on Cloud Run and on the local worker; the worker's allow-list reads the city's versions and their `align.tif`, read-only (M7 §2.5, DECISIONS §107f).
- **A partner that cannot be read is no partner** (2026-11-08, lesson 493). The worker's list of the city's versions holds only those that pass `layerVersionDocSchema`, and a read of one that fails it answers `{data: null}` with a warning that names its path and fields; on the pipeline's side any `WorkerApiError` on one version's read leaves that version out, with one warning line naming every version not read, and the frame is fitted with the others or alone (`S-A62-BAD-HELD-UNREADABLE`, `S-P06-BAD-JOINT-UNREADABLE`). Before, one older version that failed its schema made the server answer `apiError.internal`, and the frame, and with it its join, failed. The same holds past the read (lesson 482): a partner whose `align.tif` cannot be looked up (a `worker.urls` refusal, a store failure, an id off the path pattern), staged, read by GDAL or measured is left out with one warning naming it (*the accepted frame V could not be found* or *measured: fitted without it*; never the error, which may carry a URL), and the versions the server left out of its list are counted (*N of the city's frames could not be read and were left out*). A lost lease or a disconnected computer still stops the run.

**Proof on the ruler.** On the NUC, the product's own `joined_calibration` (`tools/m15e-joint.py`; copies and every output in `reports/calib/accuracy/m15e/`, not tracked; outputs on the NUC in `out/m15e/`). The ties are the evidence's film-to-film matches (`acc-temporal` `ties.npz`, 5 m warps, the same gates); each frame joins **in the order it was imported** (its job id: F006, F007, F040, A001, F003, A015, F049, A038, F022, KH-7, KH-9 mapping), the frames before it held still as their layers show them (the lattice through GDAL's `-tps`, inverted by Newton, as `m15b-product.py`). In every fold the held blocks and their 900 m buffer are out of every frame's tiles **and out of every tie**, so the film ruler reads places no fit saw. "As built" is the product before this section (plainest camera, `try-occ` of the review), reproduced exactly by the same harness with no partners (8.13 / 12.50 m).

| Film ruler, 52 pairs, double held out | As built | **Joined** | Gain, 95 % (frames resampled) | Pairs better |
| --- | --- | --- | --- | --- |
| 3.2 km blocks (median pair) | 8.13 (8.03) | **6.50 (6.07)** | +0.84 to +2.52 m | 51 of 52 |
| 8 km blocks (median pair) | 12.50 (11.96) | **9.19 (8.18)** | +1.28 to +5.43 m | 51 of 52 |
| By pair kind, 3.2 km: pan-pan, KH-9 mapping-pan, KH-7-pan, KH-7-mapping | 7.97, 6.77, 9.75, 8.37 | 6.62, 5.42, 7.09, 6.11 | | |
| Same pass F006-F007, held out (3.2 / 8 km) | 9.4 / 16.5 | 9.4 / 16.5 | | (one tie between them: no change) |
| Every tile, in sample | 6.94 | 5.76 | | |
| Sentinel-2 tiles held out, mean RMSE of 11 frames (3.2 / 8 km) | 21.7 / 22.7 | 21.6 / 22.4 | | |

Each frame, RMS of its own pairs (a pair counts for both its frames), as built → joined: 3.2 km blocks / 8 km blocks.

| Frame | 3.2 km | 8 km |
| --- | --- | --- |
| A001 | 9.37 → 7.99 | 12.35 → 10.15 |
| F006 | 9.50 → 8.84 | 15.26 → 13.67 |
| F007 | 7.81 → 6.22 | 10.60 → 7.82 |
| F040 | 9.14 → 6.01 | 16.05 → 8.27 |
| F003 | 6.74 → 5.46 | 10.81 → 8.12 |
| F022 | 8.22 → 6.94 | 12.27 → 9.35 |
| A015 | 7.88 → 6.53 | 11.61 → 9.04 |
| A038 | 6.90 → 5.52 | 11.11 → 8.12 |
| F049 | 6.82 → 5.12 | 9.92 → 7.51 |
| KH-7 | 9.62 → 7.00 | 16.04 → 11.02 |
| KH-9 mapping | 6.95 → 5.49 | 10.30 → 7.48 |

F006 and F007 were imported first and are never joined themselves (F007's only earlier frame is F006, with one tie); they improve only through their pairs with later frames. **F006 over Pitești** has no other frame: it is fitted alone, exactly as built (17.2 m held out against Sentinel-2).

**Thin and partial frames** (`m15e-joint.py thin`, `partial`): each frame joins last, the others solved in order **without it**, so no held map saw any of its ties; read on its pairs with them, ground metres RMS, as built (alone) → joined.

- **Thin**: its Sentinel-2 tiles on one 3.2 km fold of five only, its ties everywhere but the read fold (900 m buffer), read on that fold; 5 seeds x 4 folds. A001 14.6 → 7.3, F006 55.4 → 6.7, F007 30.7 → 5.9, F040 121.2 → 5.8, F003 14.0 → 4.9, F022 21.9 → 6.7, A015 15.3 → 6.0, A038 8.6 → 5.0, F049 11.8 → 4.8, KH-7 23.4 → 6.9, KH-9 mapping 14.3 → 4.9. This is the evidence's "real absolute gain for thin coverage" in the product.
- **Partial**: its tiles **and** ties on one half of its film (each half of each axis, four reads), read on the other half: extrapolation, the hardest case. Pooled over the eleven frames 34.6 → **16.3 m** (with the cubic unrestricted 20.1). Better on 39 of 44 halves, level on F040's last rows (19.4); worse on F049's far scan half (16.0 → 38.1, its camera), F022's last rows (9.1 → 9.9), KH-9 mapping's far scan half (6.5 → 6.8) and KH-7's first rows (18.7 → 21.9; its last rows 55.2 → 36.4). Each frame over its four halves: A001 39.4 → 30.2, F006 29.3 → 16.1, F007 63.6 → 9.3, F040 54.8 → 18.7, F003 12.0 → 8.7, F022 25.4 → 13.1, A015 32.8 → 10.6, A038 20.2 → 11.2, **F049 20.0 → 21.1**, KH-7 34.4 → 22.6, KH-9 mapping 24.6 → 7.1. The restriction is what keeps KH-7 and KH-9 mapping sane there: unrestricted, KH-9 mapping's first scan half read 52.2 m and KH-7's far half 43.0; restricted 7.1 and 10.7.

**Absolute position, OSM rails** (never in any fit, the evidence's `osm2` reading: each rail measured across through the frame's layer; the bias is the frame's shift against OpenStreetMap, the scatter what remains after it). Bias as built → joined, ground metres: A001 3.41 → 3.17, F040 9.69 → 7.60, F003 5.16 → 4.08, A015 7.42 → 7.11, A038 6.60 → 5.50, F022 8.47 → 7.29, KH-7 12.12 → 10.11, KH-9 mapping 6.53 → 6.22, **F049 9.21 → 10.38** (north −6.86 → −8.42); F006 and F007 unchanged (11.76, 9.91: nothing joined). The scatter after the bias moves by at most 0.5 m (F049 10.60 → 11.07; KH-7 9.69 → 8.43). Pooled over 1,169 rails 12.09 → 11.94 m; the mean square changes by +3.5 m² (95 %: −1.1 to +8.4, blocks resampled): **no loss of absolute position**, and no proved gain either, as the evidence found at full coverage.

**Partners on real data.** In the whole city, joined in order, every partner with enough ties sat 0.02 to 1.36 m from the rest (all `used`); in the ruler's folds, with their blocks removed, F006 read 5.3 to 7.0 m from the rest in 3 of 1,404 verdicts at 3.2 km (4 of 1,404 at 8 km) and was left out of those folds. The product's own matcher on the real `align.tif` files (`m15e-cost.py join`): A001 against the ten others, 723 to 2,371 ties of 838 to 3,863 tried, every partner used, 0.21 to 2.13 m from the rest; KH-9 mapping, 763 to 2,682 ties, 0.15 to 2.42 m.

**A partner published wrong** (`m15e-joint.py wrong`): each frame joins last with the partner it shares most ties with moved east before it joins. The offset read back is the shift within 0.5 m on every frame (0.1 to 0.7 m with no shift). Moved 8, 10 or 25 m, the partner is left out on 11 frames of 11; 6 m, on 4 of 11 (those reading just over the bound); 4 m, never. Kept at 4 to 6 m, it moves the frame 0.5 to 1.1 m RMS over its scan (F006, joining with thin tiles of its own, 3.0 to 3.3 m); left out, the frame lies 0.2 to 0.4 m from where it would with that partner sound (F006 3.2 m), what losing one partner's ties costs.

**Cost** (the product's functions on the real scans, 4 CPUs, 16 GB, one process; `m15e-cost.py` on the NUC): `align.tif` over the Bucharest window (5,878 x 6,106 cells) **7.5 to 30.9 MB a frame, median 20.5 MB**, written in 7 to 60 s at most 1.64 GB (rendered here from the scan; `export` renders it from the warped layer, already on the tile grid). Joining A001 to ten frames: its own image 31.9 s, the ties 46.8 s (3.7 to 6.2 s a partner, one file staged at a time), the fit 26.8 s (eleven camera fits: each partner left out once, then all), 106 s in all, **peak 1.48 GB**; KH-9 mapping 62 s, 1.48 GB. Within a standard Cloud Run task (4 CPU, 16 GB) and the worker; disk: one partner's file at a time beside the scan.

**Proof in tests.** Synthetic: ties held still cut the error of a frame with 10 m tiles to under 60 % of its error alone; a frame with tiles on half its film is carried by ties on the other half within 5 m; a partner 20 m off among three is read back at 20 m and left out alone, the other two kept; too few, scattered or another place's ties hold nothing; a restricted cubic is the cubic inside its box (`test_calibrate_joint.py`, `test_calibrate_ties.py`). Whole jobs (`test_joint_job.py`): a proved frame keeps `align.tif` at 5 ground metres; the same frame imported again is joined to the first, accepted, with 105 ties, and the accepted version is untouched; that frame's image moved 20 m east is left out at 20 m; turned upside down it holds nothing (`few`); not yet accepted, it is never held. Edges of discovery (`test_steps_aligning.py`); the worker's allow-list (`functions/test/worker`); the page in both languages and its tour state (`calibration.spec.ts`, `imagery.version-aligned`). Rows `S-P06-HAPPY-JOINT-HELD-STILL`, `S-P06-HAPPY-JOINT-THIN-FRAME`, `S-P06-HAPPY-JOINT-RESTRICTED`, `S-P06-BAD-JOINT-PARTNER-DISAGREES`, `S-P06-BAD-JOINT-FEW-TIES`, `S-P06-BAD-JOINT-NOT-ACCEPTED`, `S-A67-HAPPY-ALIGNED`, `S-A67-BAD-ALIGNED-LEFT-OUT`, `S-A62-HAPPY-HELD-FRAMES`, `S-A62-BAD-HELD-FRAMES-WRITE`; lesson 465; DECISIONS §107.

**Limits and not done.**

- **Old frames stay as they are.** The frames imported first gain nothing from later ones (F006, F007 here); re-aligning one is the owner's choice, said on the page, but no one-click action is built: a new georeference of an automatic frame keeps its lattice today.
- **The same pass F006-F007** shares one tie on this grid: the seam between the two frames of one pass is not touched (M15 step 5, the rigid stitch, is the tool for it).
- **The camera is not restricted**; F049's far scan half reads worse joined (16.0 → 38.1 m) when that half has neither tiles nor ties. A frame with partners on all sides, the usual case in a city, does not meet it.
- **Absolute position** is neither lost nor proved better at full coverage (OSM above); F049's bias grows 1.2 m.
- **Not run:** a whole job through the runner on a real frame (the product's matcher and fit ran on the real scans, through the harness); the edge-strip ruler of the review (the partial ruler, half a frame, replaces it); a second city with two frames (Pitești has one); the measured-area outline on the admin's map.

## Terrain (2026-11-08): a frame seen off nadir, over the surface model

**Why.** A feature h metres above the frame's reference height shows on the film where flat ground h tan(view) further from the nadir would show. The open references (`~/hcm-calib/out/acc-open-refs.md` on the NUC, finding 3) found the frames' residuals following Copernicus DEM relief with a slope near 1 where the view is off nadir (A001 0.97 ± 0.13, F003 1.04, A015 1.17, F006 over Pitești 1.11 ± 0.06), leaving 6.2 m on A001 and 7.8 m over Pitești after poly2 (48.8 m at worst).

**What it does** (`calibrate/terrain.py`, `surface.py`, `steps/relief.py`, `georef/rpc.py`, `georef/heights.py`; `joining.py`, `steps/georef.py`, `steps/warp.py`, `steps/aligning.py`, `join/warping.py`; `@hcm/shared` `terrainTransform`), as fixed by its review (*Review of the terrain*, below):

- **The surface** (`surface.py`, `steps/relief.py`): Copernicus DEM GLO-30, the public tiles on AWS open data (`HCM_DEM_URL`, default the bucket's eu-central-1 address, anonymous https through the address guard), every one-degree tile the city window touches, warped to EPSG:3857 at 30 ground metres a cell (at most 4,096 a side: a larger window takes coarser cells), averaged over a 900 m square (the area a tile measures; today's buildings and trees weigh little at that scale), then read at the centres of 300 m cells to the decimetre (`SURFACE_CELL_GROUND_M`; Bucharest's window 102 x 98 cells), float32, deflated (16 KB for Bucharest, 15 KB for Pitești), cached as `reference/{city}/dem/{key}.tif` (key: window, source and cell; 90 days, like the other references). Every tile the window touches must be read: a tile that cannot be (gone, refused, broken, open sea) gives no surface and nothing cached, never ground at 0 m in its place. Without a surface, or with the address refused (a real one under the emulators), the frame is fitted flat with a warning.
- **The parallax** (`parallax_at`): from the KH-9 pan camera fitted flat, each film pixel's ray on the plane under the camera at a height of 1, from the nadir, through the camera's linear map to EPSG:3857, over that map's scale: the view's tan as a direction away from the nadir. Over a city it is fitted as an affine field of the place (`Terrain.tan`). Against the open references' figures the camera reads A001 1.19 (pixel ratio 1.14, free fit 1.11), A015 0.75 (0.65, 0.77), F003 0.67 (0.50, 0.68), F022 0.64 (0.59, 0.49), F049 0.35 (0.21, 0.40), F006 over Pitești 0.73 (scan angle 0.50, free fit 0.61).
- **What the tiles show** (`_shown`): the camera's tan runs high where its scan angle is loosely held, and the surface model holds today's buildings; so the tan is scaled by the slope of the flat camera's residuals on the predicted displacement, both less a cubic in the film (tiles within 100 m), clipped to [0, 1]: A001 0.93, F003 0.93, A015 1.0, F022 0.85, F049 0.73, Pitești 0.63.
- **Who is corrected**: a KH-9 pan frame whose camera holds (as `alone` asks) and whose relief after a second-order fit, once scaled by what its tiles show, is 1 m or more (`RELIEF_MIN_M`; a frame whose tiles show none of it is fitted flat, the record equal to the flat fit's). In Bucharest: A001 (6.0 m after scaling), A015 (4.0), F003 (3.6), F022 (2.9), F049 (1.4); not F006, F007, F040, A038 (0.25 to 0.98 m), nor KH-7 or KH-9 mapping (no camera). Pitești's F006: 6.7 m. Any other frame, and a flat city, is fitted exactly as before (the very same georeference: `S-P06-BAD-TERRAIN-NEGLIGIBLE`).
- **The fit**: the frame's model (its camera, alone or joined to the frames held still) is fitted on its tiles' and ties' places moved where its film shows them (`Terrain.flat`), and maps a film pixel back to the ground through the heights (`Terrain.ground`, a fixed point, `OnGround`); its pairs, checks and blocked figure are read against that map. The lattice samples that map on the ground (it was the flat map, 8 to 15 m from the layer: *Review of the terrain*); no reader renders the frame through it.
- **The render** (`georef/rpc.py`, `steps/warp.py`): a 17 x 17 lattice cannot hold a 900 m relief field (A001: 11.3 m RMS from the map through `-tps`, worse than no correction; 33 x 33 3.6 m, 49 x 49 2.0 m; Pitești 18.3, 6.8, 3.7). GDAL renders such a map natively: rational polynomial coefficients (RPC00B) from longitude, latitude and height to the scan, with the surface model (`gdalwarp -rpc -to RPC_DEM=... RPC_DEM_APPLY_VDATUM_SHIFT=FALSE`). They are fitted on the map on a 25 x 25 grid at five heights and hold it within 0.002 m on the real frames (A001, F003, Pitești; refused over 0.5 px); GDAL reads RPC pixels at their centres, so the fit takes half a pixel off. Stored as `georef.terrain` {`source` `glo30`, `reliefM`, `rpc`, `heights`}: `heights` are the surface's cells under the scan (`Heights.covering`, one more around), each cell's decimetres above `baseDm` as little-endian uint16 in base64 (`georef/heights.py`; 27 KB of text for A001, the RPC fitted over their span). **Every reader goes through that RPC over those heights**: the warp (`attached`: `RPC_DEM` is the record's own cells, written to a GeoTIFF; no surface is fetched, so there is no fallback), a join's part and the next frame's ties (the same `attached`), and the georeferencer (`terrainTransform`, held to GDAL by `pipeline/tests/contracts/terrain-map.json`).
- **Credit**: a layer fitted over terrain carries GLO-30's notice after USGS's (`DEM_ATTRIBUTION`, `finalize.ts`).

**Proof on the ruler** (`tools/m15f-terrain.py` on the NUC, the product's own `joined_calibration` with `Proved.heights`, each corrected layer read through GDAL's own RPC transformer with `RPC_DEM` and inverted by Newton, as a warp shows it; the world of *Joint solve*, frames joining in import order, held blocks out of every tile and tie; outputs `~/hcm-calib/out/m15f/` as first built, `out/m15g/` after the review's fixes, `out/m15g-before/` the first build run again, through `~/hcm-calib/acc2/ruler.py`). "Joined" is the build before this section, reproduced exactly (6.50 / 9.19); "as first built" ran again to the same figures.

| Film ruler, 52 pairs, double held out | Joined | Terrain as first built | **Terrain, fixed** | Gain joined → fixed, 95 % (frames resampled) | Pairs better |
| --- | --- | --- | --- | --- | --- |
| 3.2 km blocks (median pair) | 6.50 (6.07) | 5.93 (5.17) | **5.94 (5.18)** | −0.08 to +1.34 m | 36 of 52 |
| 8 km blocks (median pair) | 9.19 (8.18) | 8.23 (6.52) | **8.25 (6.64)** | +0.29 to +1.98 m | 43 of 52 |
| 3.2 km, fresh seeds 101, 211, 307, 401, 503 | 6.61 (6.10) | 6.01 (5.22) | **6.02 (5.22)** | −0.07 to +1.45 m | 36 of 52 |
| Every tile, in sample | 5.76 | 5.17 | 5.17 | | |
| Sentinel-2 tiles held out, mean of 11 frames (3.2 / 8 km) | 21.6 / 22.4 | 21.4 / 22.0 | 21.4 / 22.0 | | |

The fixes cost nothing measurable: first build → fixed −0.03 to +0.00 m at 3.2 km, −0.10 to +0.04 m at 8 km (95 %). No variant was chosen on the fresh seeds, and the gain holds there.

**Each frame by the three-cornered hat** (`hatHeld` of `report.json`, ground metres, 95 % interval): what M15 calls a frame's own error. An earlier table here gave the RMS of each frame's own pairs, which credits a frame with its partners' gains and hid the frames made worse. Joined → terrain fixed; corrected frames in bold, frames made worse in italics:

| Frame | 3.2 km | 8 km |
| --- | --- | --- |
| **A001** | 6.64 [5.96, 7.25] → 5.05 [4.49, 5.57] | 7.72 [6.96, 8.37] → 4.99 [4.26, 5.68] |
| **F003** | 2.50 [1.67, 3.22] → 1.95 [1.29, 2.60] | 4.30 [3.59, 5.04] → 3.28 [2.70, 3.95] |
| **A015** | 4.52 [3.77, 5.14] → 3.82 [3.34, 4.24] | 6.01 [4.62, 6.93] → 5.34 [4.18, 6.12] |
| **F022** | 5.16 [4.45, 5.71] → 3.09 [2.63, 3.39] | 6.52 [5.82, 7.09] → 3.94 [3.30, 4.37] |
| **F049** | *2.56 [1.81, 3.18] → 2.64 [2.09, 3.14]* | 4.53 [3.82, 5.14] → 3.68 [3.12, 4.14] |
| F006 | *7.64 [7.17, 8.13] → 7.83 [7.60, 8.09]* | 12.22 [11.29, 13.05] → 12.06 [11.32, 12.71] |
| F007 | 4.53 [3.75, 5.20] → 3.97 [3.36, 4.48] | 5.10 [4.24, 5.82] → 4.56 [3.86, 5.21] |
| F040 | 4.21 [3.36, 4.91] → 4.02 [3.21, 4.69] | 5.83 [5.12, 6.45] → 5.66 [4.92, 6.25] |
| A038 | *2.65 [1.60, 3.32] → 3.04 [2.44, 3.49]* | *4.30 [3.58, 5.03] → 4.32 [3.72, 4.98]* |
| KH-7 | *5.25 [4.68, 5.64] → 5.95 [5.60, 6.24]* | *8.95 [8.52, 9.42] → 9.37 [9.08, 9.68]* |
| KH-9 mapping | *2.58 [1.91, 3.07] → 2.70 [2.29, 3.01]* | 2.72 [1.70, 3.46] → 2.51 [1.61, 3.18] |

KH-7 is made worse at both scales, its intervals apart at 3.2 km; A038, F006, KH-9 mapping and F049 (a corrected frame) move up by 0.08 to 0.39 m at 3.2 km, inside overlapping intervals. On the fresh seeds four of them read worse at 3.2 km (KH-7 5.31 → 5.95, A038 2.35 → 2.84, F006 7.92 → 8.37, KH-9 mapping 2.42 → 2.49; F049 2.66 → 2.64). What the corrected frames gain, the frames tied to them partly pay: an error they shared is gone from one side only (*Limits*).

**F006 over Pitești** (no second frame: Sentinel-2 held out on the same blocks, five seeds, tiles within 100 m): 17.19 → **13.93 m** on 3.2 km blocks (median 10.40 → 7.59), 20.87 → **15.02 m** on 8 km (12.93 → 8.87); as first built 13.91 and 15.01. The geometry alone, unscaled, read 14.43 and 16.91.

**Variants read on the same ruler** (so the one kept is chosen on it): the geometry alone 5.98 / 8.46 m (gain −0.15 to +1.32, −0.13 to +2.02); the surface averaged over 450 m 6.12 / 8.62; every KH-9 pan frame corrected, the near-flat ones too (no threshold), 5.98 at 3.2 km, the same as with it: correcting a frame with little relief does it no harm. The scaled tan was kept: best on both rulers and over Pitești, and it only ever shrinks the geometry.

**Absolute position, OSM rails** (never in any fit; `osm2` reading as in *Joint solve*): pooled over 1,173 rails 12.04 → 11.99 m, the mean square +1.12 m² (95 %: −2.6 to +4.7; as first built +1.25, −2.4 to +4.8): **no loss and no proved gain**. Per frame, RMS joined → terrain fixed: A001 11.76 → 11.33 (scatter after the bias 11.17 → 10.56, bias 3.17 → 3.96), F003 10.77 → **11.49** (scatter 10.71 → 10.69, bias 4.08 → 5.43), A015 14.86 → 14.99 (13.71 → 13.31, 7.11 → 8.66), F049 13.69 → 13.44, F022 12.59 → 12.58; the others within 0.1 m; every frame within 0.03 m of the first build. The scatter falls on A001, A015 and F049, and each corrected frame's bias moves 0.2 to 1.6 m, inside the 3.1 m per-frame noise this ruler carries north (*acc-open-refs* §2). Pitești has 7 rail readings, too few.

**A flat city.** By construction a frame under 1 m of relief (once scaled by what its tiles show), without a camera, or without the surface gets the georeference it got before (`test_bad_path_a_flat_city_is_fitted_exactly_as_without_a_surface`, `test_bad_path_a_frame_whose_tiles_show_no_parallax_is_not_corrected`: the records are equal); in Bucharest six frames of eleven are such frames.

**Cost** (`tools/m15f-cost.py`, the real scans, one process, 4 CPUs, 16 GB): the fit over terrain 0.9 to 1.2 s (flat 0.8 to 1.2 s). A real warp of the whole scan at zoom 17 over the Bucharest reference box through the RPC and the surface: A001 429 s against 152 s through the lattice, F003 333 s against 217 s, the same peak (5.8 to 6.0 GB) and the same size (0.74 to 0.76 GB); within a standard Cloud Run task and the worker. GDAL's own transformers of those two warps put the scan's pixels 6.2 m RMS apart on A001 (P95 11.7 m, 25.3 m at most) and 3.7 m on F003: the correction as rendered, the size of the relief each corrects (6.0 and 3.6 m). The cached surface: 16 KB for Bucharest, 15 KB for Pitești on 300 m cells (3.1 and 2.1 MB at 30 m as first built; the harness built them with the product's `write_surface` from the open references' copies of the tiles; the bytes the product reads from the public bucket were not measured). The record's heights: 23 to 27 KB of text for the Bucharest frames (85 to 98 x 102 cells), 14 KB for Pitești. Reading the 30 m surface on 300 m cells moves the map 0.34 m RMS on A001 (3.4 m at most; 150 m cells 0.11 and 1.1 m; F003 0.20 and 1.9 m: `~/hcm-calib/acc2/spacing.py`); the ruler above is the figure that counts.

**Proof in tests.** Synthetic: a panoramic frame over an 80 m hill is fitted within its noise where the flat fit is not, and its RPC with the surface puts each true place on its film pixel within 3 m; its lattice's nodes lie on that map (each read back through the RPC within a metre; the flat lattice lay 39 m off) and it carries the cells under its scan; the camera reads the parallax its geometry gives within 0.05; a frame whose tiles show half the predicted parallax is corrected by that much, one whose tiles show none is not corrected; a level surface, a 1 m rise, no camera or a failed camera leave the frame flat, the records equal; flat and ground undo each other; an RPC holds a map over heights, round-trips its record and GDAL reads it with a surface as the fit does; a map no rational cubic holds gives none; heights round-trip their record to the decimetre and a malformed one is refused; GLO-30 tiles are named by their south-west corner, warped, averaged, read on their cells and read back; a window with an unreadable tile has no surface (`test_calibrate_terrain.py`, `test_georef_rpc.py`). Whole steps (`test_terrain_job.py`): a version with `georef.terrain` warps through its RPC over its own heights with no surface served, 100 m of ground shown 50 m east landing 50 m west of the flat render; the surface is fetched once and cached by window, source and cell; with no tile, or an address refused, there is none, nothing is cached and the log says why. Every reader (`test_terrain_readers.py`, a coded scan over a 90 m hill seen off nadir): a join's part shows its layer's pixels within a metre, and with a seam's nodes still does past the taper (P95 under a metre); the next frame's ties read its film through the same map. The map in TypeScript against GDAL's (`terrain-map.json`: `test_terrain_map_contract.py`, `terrain.test.ts`), the page previewing it (`georef-published.test.ts`), the stand-in's frame over terrain opened in the georeferencer (`georeferencer.spec.ts`). Shared schema and the layer's credit (`imagery.test.ts`, `finalize.test.ts`). Rows `S-P06-HAPPY-TERRAIN`, `S-P06-BAD-TERRAIN-NEGLIGIBLE`, `S-P06-BAD-TERRAIN-UNAVAILABLE`, `S-P05-HAPPY-TERRAIN-PART`, `S-A16-HAPPY-TERRAIN-PREVIEW`; DECISIONS §108, §109; lessons 466 to 469.

**Review of the terrain (2026-11-08).** An adversarial review (`~/hcm-calib/adv/` on the NUC) reran the ruler on fresh seeds (the gain held: 6.61 → 6.01 m, −0.07 to +1.46) and confirmed four problems; each is fixed with a test that failed before the fix:

1. **The stored lattice was the flat map, and three readers showed it.** For a frame over terrain `mapped_calibration` sampled `mapped.flat`, the camera before the relief: 14.6 m RMS (41.6 m at most) from the layer on A001, 9.1 on F003, 9.3 on A015, 7.6 on F022, and worse on Sentinel-2 than the flat fit it replaced (A001 16.0 against 11.9 m median). The georeferencer previewed it beside figures of the ground map, a join (M8) rendered its parts through it, and the warp fell back to it without the surface. Fixed: the record carries the heights under its scan and every reader reads the map through its RPC over them (*What it does*); the lattice samples the ground map; the warp has no fallback. Before the fix, on the readers' synthetic hill, a join's part lay 43.5 m RMS (95.5 m at most) from its layer; the lattice test read 30 pixels off (39 m).
2. **The per-frame table hid frames made worse** (the RMS of a frame's own pairs): replaced by the three-cornered hat above, with the frames made worse named.
3. **An unreadable tile was ground at 0 m, cached 90 days.** Without E025 Bucharest's heights went from 51–126 m to 0–115 m and A001's relief from 6.0 to 0.85 m, its map 5.9 m RMS from the right one, with no warning, still credited. Fixed: every tile must be read, else no surface and nothing cached (lesson 468); before the fix the same test built a surface of 0 to 80 m from one tile of two.
4. **A frame scaled to nothing was still corrected**: the relief was checked before the scale by what the tiles show. Fixed: checked after it (lesson 469).

**What every reader shows, on the real frames** (`~/hcm-calib/acc2/agree.py` and `agree-ts.json`, the product after the fixes on A001, F003, A015, F022, F049 and F006 over Pitești, each fitted alone on every tile; the layer is GDAL's RPC transformer over the record's heights exactly as `attached` hands them to the warp, on a sparse stand-in of the real scan's size):

| Frame | Relief (m) | Join part, no nodes | Join part with a 1 m seam, past the taper (max) | Georeferencer's map against GDAL's (max) | Stored figures against the layer's own: fit / checks (m) | The lattice's spline against the layer, RMS (max) |
| --- | --- | --- | --- | --- | --- | --- |
| A001 | 6.05 | 0 | 0.0009 m | 3.4 µm | 10.85 / 10.84, 16.45 / 16.42 | 3.0 (15.5) m |
| F003 | 3.59 | 0 | 0.0006 m | 2.0 µm | 8.51 / 8.51, 10.52 / 10.53 | 1.5 (8.8) m |
| A015 | 3.88 | 0 | 0.0002 m | 2.3 µm | 9.02 / 9.02, 13.82 / 13.83 | 1.6 (8.7) m |
| F022 | 2.90 | 0 | 0.0003 m | 1.7 µm | 8.60 / 8.61, 18.93 / 18.92 | 1.3 (9.5) m |
| F049 | 1.39 | 0 | 0.0004 m | 0.9 µm | 8.72 / 8.72, 9.10 / 9.08 | 0.6 (4.7) m |
| F006, Pitești | 8.11 | 0 | 0.0004 m | 7.2 µm | 7.68 / 7.68, 8.12 / 8.13 | 2.8 (17.5) m |

The join's part without nodes is the warp's own source and method, so the two agree exactly; with nodes it is read through the RPC onto the level's grid and the nodes carry only the seam's field there. The georeferencer's map gives GDAL's pixel of each of 1,917 to 2,296 places per frame (`terrainTransform`; the contract file holds the synthetic hill's). Each pair's stored residual lies within 0.16 m of the layer's own, the 0.1 pixel GDAL's inverse stops at. What the page draws is that map through a 16 x 16 mesh of affine triangles on a canvas of 1,024 pixels (24 to 30 m each): between the mesh's corners it lies 1.9 to 6.8 m RMS from the map (A001 6.8 m), 24.2 m at most (over Pitești, where a pixel of the preview is 23.7 m): about a pixel of the preview at worst, as every panoramic frame's preview has drawn since M3 (64 x 64 quads would hold 0.1 to 0.7 m RMS, 6.5 m at most, and draw 16 times the triangles: not built). A scan pixel goes back to its place through the lattice, which samples the same map, within 18 m (RMS 1.6 to 3.9 m on the four corrected frames, rechecked 2026-11-08). Two things read it: the preview's frame (the box it is drawn in) and each automatic suggestion's distance from the fit (`distanceFromFit`, shown as the suggestion's metres in the georeferencer), so on a terrain frame that figure can be off by as much. Open: a Newton inversion through `terrainTransform` for `toGeo`, which costs bytes the georeferencer chunk does not have today (16,998 of 17,000).

**Limits and not done.**

- **The frames tied to corrected ones read worse by the hat**: KH-7 at both scales (5.25 → 5.95 at 3.2 km, intervals apart; 8.95 → 9.37 at 8 km), A038, F006, KH-9 mapping and F049 at 3.2 km by 0.08 to 0.39 m inside their intervals. KH-7 is not corrected (no camera model; its roll is unknown), and its pairs with corrected frames lost an error they shared (A015-KH-7 5.60 → 6.76, F003-KH-7 6.02 → 6.87, F049-KH-7 6.24 → 6.84 as first built). The open references' free fit reads KH-7's own tan at 0.43 ± 0.13 east, far from near nadir. Correcting it needs its pointing; KH-9 mapping (vertical) likewise keeps its polynomial.
- **The gain at 3.2 km is not proved** (95 % from −0.08 m, −0.07 on fresh seeds); at 8 km and over Pitești it is.
- **F003's OSM reading worsens 0.7 m**, inside that ruler's per-frame noise but not explained.
- **A window touching a GLO-30 tile that does not exist** (open sea) has no surface: its frames are fitted flat.
- **Not run**: a whole job through the runner on a real KH-9 frame (the product's fit ran on the real tiles and its RPC through GDAL's transformer, and a real warp of the scan through it: *Cost*); a real join of a frame over terrain (the readers' test warps a coded scan through the join's own code); the surface fetched from the public bucket by the product (the harness built it from the same tiles fetched for the open references); Pitești on a film ruler (one frame).
