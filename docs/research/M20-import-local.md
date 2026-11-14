# M20: Import local files (design)

Written 2026-11-09 from the owner's request: "we want to help the admin import local files … let's optimize and import and calibrate automatically all the formats in this archive". The test case is `harti.zip` (5,703 files, inventoried outside the repository). The owner's decisions of 2026-11-09 are in §13; what the core track built is in §14 (*As built*). Nothing was uploaded and nothing was deployed.

Read it alongside:

- `M3-interfaces.md` §2.4 (job states and limits) and §8 (uploads)
- `M7-local-worker.md` (the worker, its ports and the dispatcher)
- `M8-join-interfaces.md` (the join compositor)
- `M9-calibration.md` and `M15-calibration-accuracy.md` (proof, checkpoints, blocked figure)
- `M10-local-ai.md` (the matcher port, GPU first)
- `M12-own-tiles.md` (PMTiles, the approval view)
- `M16-recalibrate.md` and `M18-improvements.md` §3 (what counts against the daily cap)

The scenario rows are `S-A120-*` (functions) and `S-P20-*` (pipeline) in `e2e/scenarios.json`.

## 0. What exists today (checked in code)

| Fact | Where | Consequence |
| --- | --- | --- |
| `LAYER_KINDS = ['satellite', 'aerial', 'map']` | `packages/shared/src/schemas/manifest.ts:49` | Map layers are already valid in the manifest. The viewer treats every kind the same: the Layers panel has one *Historical layers* group (M18 §6), and nothing reads `kind` except the compare labels. |
| `layer.attribution` (500 chars) feeds the map source's attribution | `packages/engine/src/core/map-specs.ts:77` | Credits per layer already reach the legal line and the compare bar. There is no licence or author field. |
| `JOBS_PER_DAY = 10`. Counted types are `usgs-import`, `geotiff-import` and `layer-join`. Re-runs are free. | `packages/shared/src/api/imagery.ts:32`, `functions/src/imagery/limits.ts` | The cap counts new layers, not compute. It is per project, with a per-city share. `refuseRasterJobs(count)` creates a set all-or-nothing. |
| `GEOREF_TRANSFORMS = ['affine', 'poly2', 'tps']` | `schemas/georef.ts:17` | TPS already exists for fits and for the M8 correction transport. |
| `DEFAULT_RMSE_THRESHOLD_M = 15`, range 1–200. `CITY_MIN_COVERAGE_PCT = 90`, `AUTO_MIN_MEASURED_PCT = 70`. | `schemas/imagery-settings.ts` | Both coverage rules are relative to the city. A map of the centre can never pass the 90 % rule. |
| `JOIN_MAX_PARTS = 8`. A join part is a USGS version (`entityId`, `dataset`, `sensor`). | M8 §2 | A 4,545-sheet series cannot be an M8 join. The design reuses M8's compositor, not its job or its part schema. |
| The pipeline works in grey + alpha (`Warped`). Export is JPEG q85 COG, tiles are WebP. | `steps/export.py`, `tiles/pack.py` | Coloured maps and 1-bit line art each need their own path (§6). |
| M7 uploads `scan.tif` (the crop) through signed URLs. Raw files stay local. | M7 §1.3 | An archive series must not upload its sheets. Only tiles, previews and the sheet index go up (§2.4). |

## 1. Decisions

1. **The archive is processed by the local worker, not the cloud.** The browser never uploads it. The admin picks a folder or a zip on the worker's own local page (`localhost:8765/import`). That page streams the files over loopback into `/work/import/<archiveId>/`, or reads a zip in place there. Originals never leave the computer, and archive jobs are pinned with `runOn: 'local'` and `localOnly: true`, so `imagery.runOn` refuses to move them to the cloud (`apiError.imagery.localOnly`).
2. **Unit of work: one series becomes one job and one layer per edition year.** A *series* is a set of files that make one map: a sheet series, an atlas, overlapping scan pieces, or a single map. Sheets are not versions. They are the parts of one version, with origin `archive`. Their per-sheet record lives in a local sidecar, `work/{city}/{job}/sheets.json`, and a summary of it goes into the version.
3. **Scanning is free, importing counts against the cap.**
   - The scan (inventory and report), re-runs, Locate again, points and recalibration never count. This is M18's rule.
   - Each series job counts once against `JOBS_PER_DAY`, in the same way as a `geotiff-import`.
   - Why local jobs count:
     - The cap guards **new layers**, and what follows a new layer is cloud cost wherever its pixels were computed: storage and egress in the public bucket, the manifest's growth, approvals, and Mapbox if the city chose it.
     - If a job that did not count could ever reach Cloud Run, the guard would be defeated. Counting keeps the invariant simple even though `localOnly` already forbids the move.
     - Local CPU and GPU are the owner's, so archive jobs never count toward the Cloud Run free tier (M7 §4 already skips `runOn: 'local'`).
   - The import is never refused for the cap. Series beyond today's allowance wait (`waitReason: 'daily'`, a new reason), and `imagery.tick` releases them in the plan's order as each day's count frees.
   - The Bucharest archive has about 33 importable series: about 4 days at the default share, unless the owner raises the city's `rasterJobsPerDay` up to the project's 10.
   - **Superseded on 2026-11-09 (the owner: "I want the data from harti.zip in our app as soon as possible"; 31 series sat behind the cap).** A local-only job (`localOnly`: every archive series) neither counts toward nor is held by the daily cap: it runs free on the owner's computer and its tiles go to the project's own bucket, so the cap keeps guarding the Cloud Run work alone. `imagery.archiveImport` starts every series at once (`waitReason: 'worker'`, no `countedAt`), the worker still runs them one at a time, and `releaseDaily` releases a local-only job held `daily` whatever today's share (the series held before the change go at the next tick). A job that is not local-only and is held `daily` still waits for room and counts on its day (`functions/src/imagery/limits.ts` `countsSince`, `functions/src/imagery/daily.ts`; S-A121-HAPPY-LOCAL-UNCAPPED, S-A121-BAD-DAILY-SPLITS, S-A120-BAD-DAILY-SPLITS).
4. **Same date only, read for maps as same edition.** M8 joins frames of one acquisition date. A map series joins sheets of one edition. Sheets of other editions (`_62`, `_64`, `_71`) form their own partial layers of their year. The scan report lists them, and the owner may drop them. A series with no per-sheet edition (the base 1:500 sheets, 1961–77) gets one layer with `year` set to the latest revision the sheets state (1977, prefilled and editable). Its label carries the range.
5. **Never publish a bad fit.** Every series ends in one of two states:
   - `awaiting_approval`, which auto-publishes only under the map rule in §5;
   - `awaiting_gcps`, with suggested pairs.
   No path publishes a fit without a held-out checkpoint.
6. **Rights gate publishing, not processing.** Every series carries `rights` (§7). Series flagged *needs confirmation* can be imported, calibrated and previewed privately (M12's signed preview). `publish` refuses them until the owner confirms the licence (`apiError.imagery.rightsUnconfirmed`). Items marked *do not publish* are skipped at the scan.
7. **Calibrate in era order (the reference ladder).** Matching a drawn map against a map of a similar era is far easier than matching it against today's OSM. Once a layer is calibrated, it becomes a reference for older maps. Its own checkpoint error is added in quadrature to theirs. The ladder for Bucharest:
   - OSM → IPB 1:500 and 1:2000 (they solve the city grid);
   - the grid → IGA 1911, the 1911–14 cadastral plan and IGA 1895 (each refined against its own printed grid);
   - those → the 1886–1939 single maps and the coloured 1895 pieces;
   - IGA 1895 → Borroczyn 1846 and 1852;
   - Borroczyn → 1770–1799.
   A reference that is not published (IPB, for rights) is still used privately. Only its derived transform and its vector junctions are used.

## 2. Intake and scan (the worker)

### 2.1 Getting the files to the worker

- **The admin's entry point.** Imagery → *Import local files* opens a panel.
  - With no worker seen in the last 180 s (M7 §0.1), it shows the M7 command and *Start the worker first*.
  - With a worker, it shows **Choose a folder or zip on this computer**, which opens `http://localhost:8765/import?archive=<nonce>` in a new tab. The picker must live on the worker's own origin. A page on `web.app` calling `localhost` would hit Chrome's Private Network Access rules and CORS.
- **The worker page.** It uses `<input type=file webkitdirectory>` and a single-file `.zip` input, so it works in every browser without the File System Access API. It posts each file to `POST /import/<archiveId>/file` with the M7 CSRF header and the relative path in a header. The path is validated and never joined raw. Only loopback is involved.
- **The alternative for very large archives.** The admin copies the zip or folder into `~/hcm-worker/import/` (already mounted as `/work`), and the page lists it. The panel's note says so.
- **Zip reading.** The worker reads entries in place. It extracts nothing outside `/work/import/<id>/x/`. It refuses:
  - absolute paths, `..`, links and device entries;
  - more than 100,000 entries;
  - an entry whose ratio is above 200:1 or whose expanded size is above 64 GiB;
  - a total above the free disk space minus 10 GiB.
  Names are decoded as UTF-8 or else CP437, as the zip specification says. Bucharest's names are Romanian with diacritics.

### 2.2 Probing (untrusted input)

- Every file is probed in a **child process** with `RLIMIT_AS` 4 GiB, a 60 s CPU limit, no network and `GDAL_MAX_PIXELS`, plus Pillow's `MAX_IMAGE_PIXELS` at 1.5 gigapixels. A crash or timeout becomes a `skipped: unreadable` row and never stops the scan. Nothing in the archive is executed. Detection goes by magic bytes, never by extension (the `.368` file and the extensionless G4 TIFF prove this matters).
- **Recorded per file** in the local `archive.json` (never in Firestore):
  - SHA-256, format, size and bit depth;
  - photometric interpretation and compression;
  - dpi, and any EXIF or software tags;
  - georeferencing found (CRS, GeoTIFF tags, GCPs, world file, `.prj`, `.aux.xml`);
  - for PDFs, the page count, encryption and image-only status.
- **Thumbnails.** One 256 px thumbnail per file, plus a contact sheet per series for the report.

### 2.3 Classification (for any city)

The detectors run in order. Each file lands in exactly one series or one skip reason.

1. **Junk.** `Thumbs.db` (OLE2 with a `Catalog` stream), OLE2 autosaves (`.VCF` of VPstudio), directory listings, `.DS_Store`, `desktop.ini`, `__MACOSX/`. Reason: `not-a-map`.
2. **Exact duplicates** by SHA-256. Reason `duplicate-of: <path>`. The shortest canonical name is kept.
3. **Georeferenced** (class a): a CRS, a world file with or without `.prj`, or GCPs.
4. **Nomenclature series** (class b). A library of name grammars:
   - the international 1:1M scheme (`L-35-…`) and its Romanian Stereo 70 sheet numbering (Gauss–Krüger lineage);
   - generic `row-col` and `col+row+quarter` city grids;
   - an owner-supplied grammar.
   A grammar is accepted for a folder when at least 80 % of its rasters parse, and the parsed cells form a connected set with consistent raster sizes and dpi. A learned city grid (§3.2) is proposed and confirmed by the owner once. It is then stored as city data (`cities/{c}/grids/{gridId}`) and reused by later imports.
5. **Atlas.** Numbered pages in one folder, with an index page found by name (`Cuprins`, `Index`, `Inhalt`) or by a page whose layout is a grid of numbers. Pages that are not maps are found by content: low line density, mostly text, or a scale bar alone (`1_Autor`, `8_Tehnic`, `10_Registru`, `99_Scara`). They are skipped with the reason `not-a-map-page`.
6. **Pieces.** At least 3 rasters with the same dpi and pairwise feature overlap of 10 % or more (ORB on 1/8 scale). They form one stitched map.
7. **Twin scans.** Two series of the same map (the same layout found by thumbnail matching after a scale normalisation, at least 0.8). One series is primary, the other only fills gaps, with reason `twin-of`. The rule:
   - prefer grey or colour at 200 dpi or more over 1-bit;
   - otherwise the higher dpi.
   For Bucharest: the grey JPEG Borroczyn set is primary and the TIF set gives only page 50. IGA 1895 and IGA 1911 use the grey JPEG quadrants, with the 1-bit TIFs as fallback. A near-duplicate crop (`Bucuresti 1770.jpg`) is skipped as `crop-of`.
8. **Single** (class c): everything else that is a raster or a PDF page.
9. **CAD** (class e): `.dwg` and `.dxf`.
10. **Owner sidecar.** An optional `hcm-archive.json` at the archive root is a schema-checked declaration of series, grids, years, authors and licences. It is **data, never code**. It overrides detection only where it validates. This file is how a city owner, or Claude preparing an archive, fixes what detection got wrong.
11. **Series metadata.** For each series, the worker reads candidate title, year, scale, author and watermark text with on-device OCR on the cartouche (Tesseract, pinned, `ron+eng+deu+fra+hun`). These are only prefilled values that the owner edits in the report. Watermarks found (romaniaforum, dacoromanica) go into the attribution suggestion.

### 2.4 What reaches the server

`worker.archiveReport` is a new worker callable (access `cityEditor`, App Check off, as M7 §2.4). It writes `cities/{c}/archives/{archiveId}`:

- `name`, `source: 'zip' | 'folder'`, `fileCount`, `bytes`, `scannedAt`, `workerId`;
- `series[]` (at most 200): `seriesId`, `class`, `title`, `year`, `yearLabel`, `files`, `bytes`, `action`, `reason?`, `edition?`, `rights`, and `estimate` (`maxzoom`, `tilesBytes`, `minutes`, and `auto: 'likely' | 'possible' | 'points'`);
- `skipped` counts by reason.

Per-file rows stay local. A skipped list of up to 500 sample relative paths goes to the paged subcollection `archives/{id}/issues`. Host paths and file contents never go up. A contact sheet per series (WebP, at most 200 KB) goes through `worker.urls` to `rasters/{c}/archives/{id}/{series}.webp`, which is private and signed for the admin.

## 3. Automatic paths per input class

### (a) Already georeferenced

1. **Read the CRS.** GeoTIFF keys, `.prj`, or `.aux.xml`. A world file with no `.prj` gets a CRS inferred from the coordinate ranges and the city's position. The candidates are Stereo 70 (EPSG:3844, E 200k–900k, N 200k–800k), the local UTM zone, EPSG:3857 and EPSG:4326. Each candidate is tested by where it lands, and an ambiguous result asks the owner in the report.
2. **Stereo 70 datum.** EPSG:3844 goes through PROJ's Helmert transformation. That is 1–3 m, under the threshold. The official TransDatRO grid is used if PROJ-data ships it (**UNVERIFIED**).
3. **Output.** `gdalwarp` to EPSG:3857 (bilinear for grey and RGB, nearest then a box pyramid for 1-bit), then the COG, `tiles` and `register`. No matching is needed.
4. **Verification against OSM.** `check` runs the checkpoint machinery as a *ruler only* (§4). A median offset under the threshold behaves like a normal fit. A larger one sets `georef.disagreesM` and waits for the admin with the note "the file's georeference disagrees with OpenStreetMap by N m". It never auto-publishes.
5. **The test case.** None of the 5,703 files is georeferenced. The path is built for other cities and tested on synthetic files.

### (b) Sheet series with a known grid or nomenclature

1. **Parse.** Each file name becomes a grid cell (row, column, quarter or block). For Bucharest:
   - columns `A…Z` west and `A'…Z'` east (24 letters, no J or Q), with A' at index 0 and A at −1;
   - rows `n` south of the 0 row and `n'` north of it;
   - 500 m cells;
   - 1:500 sheets are quarters (`17A'3`);
   - 1:2000 sheets are 2×2 blocks (`29-30cb`, where `b''c''` is the primed form);
   - cadastral `Seria N/<letter>`, where `A1…H1` means `A'…H'`.
   - The quarter numbering is one of 8 permutations. It is chosen by the lowest seam residual between neighbours (step 4) and cross-checked against the index photo (an internal check, never published).
   - The 41 + 15 + 15 odd names go into an editable table in the report ("we read these as …").
2. **Frame per sheet.** Run on a 1/8 downsample:
   - a morphological close, then the largest near-rectangular contour, then corner refinement at full resolution by line intersection (sub-pixel);
   - where the printed grid crosses the sheet (IGA 1895 and 1911 quadrants), the grid lines' crossings are detected by Hough on the long thin lines. Each crossing is a control point with known grid coordinates: tens per sheet.
   - A sheet whose frame is not found is reported (`frame-not-found`) and left out of the mosaic. One bad sheet never blocks the series.
3. **Solve the grid once per city.** The unknown is a 4-parameter similarity from grid metres to EPSG:3857, or an affine if the residual warrants it.
   - Scale is known (500 m cells), so the search is translation plus a small rotation.
   - The series is rendered in grid space at 2 m from the sheets' frames: the whole city's 1970s street pattern.
   - It is matched against OSM roads and buildings, rasterised the same way, by NCC and chamfer over a pyramid on the CPU. The ALIKED+LightGlue proposal from M10 runs on the GPU as a second voter.
   - The M9 proof gates (inliers, share, spread, the rival search) decide.
   - If it is refused, the report asks the owner to drop **3 sheets** on the map (about 6 clicks), and the solve runs from those.
4. **Per-sheet fit.** A homography from the four frame corners, or from the grid crossings. Then a **joint solve** across neighbours (M15's joint solve): line continuity across shared edges, by correlating 2 cm-wide strips of each edge. This removes paper shrink (0.2–0.5 % on old sheets) and scanner skew. Then a TPS only where at least 30 crossings support it.
5. **Check.** A spatially blocked sample of 10 % of sheets, at least 20, scored against OSM junctions held out before any fit. For the older series, the IPB reference is used as well. The figure reported is M15's blocked figure.
6. **Mosaic.** Each sheet is cut at its neat line, with a hard seam and **no feather**: blending line art doubles lines. Where editions overlap, the higher priority wins: the series' own edition, then the newer. M8's block compositor is reused with weights set to 0 or 1.
7. **Expected error for grid series.** Frame ±2 px at 300 dpi is 0.17 mm on paper (8.5 cm at 1:500, 0.85 m at 1:5000). Grid solve 1–2 m. OSM's own error 1–3 m. So expect 2–5 m, well under 15 m.

### (c) Single scanned maps (JPG, PNG, PDF page)

Calibrating a drawn map automatically is hard: it has drafting error, generalisation, a changed city, and no photo texture. The realistic pipeline:

1. **Prepare.**
   - Deskew.
   - Find the neat line (as in b). Mask outside it.
   - Mask the cartouche, legend, scale bar and text blocks. Text is found with Tesseract's layout boxes plus a morphological text-blob detector. The legend is a dense rectangle near the frame with low road density.
   - Watermarks inside the map are masked by the same detector.
   - Colour is kept as RGB for warping. A working copy for matching is made per channel: roads are often the paper-coloured channels between coloured blocks.
2. **Street network.**
   - **The classical path (always on, CPU).** Road detection by the paper colour between building blocks (colour maps) or by double-line ridge filters (line plans), then skeletonise, then a junction graph: nodes of degree 3 or more, each with its angle signature.
   - **The AI path (GPU first, CPU fallback, M10's port and sidecar).** A segmentation model behind a `RoadSegmenter` port. A candidate must have weights whose licence is explicit, as M10 required. The **landing gate R2** runs on this archive's 1886–1939 maps with points made by hand as ground truth. It lands only if it raises the share of proved maps with **zero false accepts**. Otherwise the classical path stays. No model is chosen here: none was verified with licensed weights, so this is **UNVERIFIED**.
3. **Reference.** OSM highways in the city window, filtered for persistence:
   - streets that also exist in an older calibrated reference layer;
   - OSM `historic=*`;
   - churches with `start_date` before the map's year;
   - for maps after about 1880, the river.
   The Dâmbovița was straightened and canalised in the 1880s, so the river is excluded as a feature for older maps. Better still, the reference ladder's previous layer is used as a vectorised network (§1.7).
4. **Coarse placement.**
   - The scale prior comes from the printed scale (OCR: `1:40000`, `Echelle`, `Merték`) or from the neat line's size against the city's extent.
   - The rotation prior is north up; 4 × 90° when uncertain.
   - Chamfer matching of the skeleton against the reference's distance transform, over similarity transforms (scale ±30 %, rotation ±15° per quadrant, translation over the window), on a pyramid.
   - The M10 matcher on *rendered* skeletons is a second voter (GPU).
   - The M9 rival search refuses a second peak.
5. **Fine fit.**
   - Junction correspondences within a radius set by the coarse fit's spread.
   - RANSAC similarity, then affine, then poly2.
   - **TPS only with at least 30 inliers spread over at least 60 % of the map**, with regularisation λ chosen by blocked cross-validation. TPS absorbs real drafting distortion, which is the point for 18th–19th-century maps.
6. **Checkpoints.**
   - 20 % of junctions in spatial blocks, held out before RANSAC.
   - `CHECK_GROSS_M` scaled to the map (5 mm on paper × the scale, at least 100 m). Any dropped check blocks auto-publish (M9 §11).
   - The coverage rule is relative to **the map's own extent**, not the city's (§5).
7. **Low confidence.** `awaiting_gcps`. The surviving correspondences are saved as **suggested pairs** (`auto`, disabled), and the georeferencer opens with them (M4's suggestions). A placement that did not hold scores them at closeness × `UNPROVEN_SHARE` (never high); one whose footprint lands outside the city's own bounds (`placing/city_guard.py`) is neither warped nor suggested and waits with `OUTSIDE_CITY` (`docs/LESSONS.md` 729). After about 4 points from the admin, the same chain runs seeded (M9's "admin's points seed the same step").

### (d) Non-map pages and duplicates

These are skipped with a reason shown in the report and nothing is processed:

- `not-a-map`, `not-a-map-page`, `duplicate-of`, `twin-of`, `crop-of`;
- `rights: do-not-publish` (the Radu Oltean drawing; Giurescu, protected until 2047);
- `index-only` (the sheet-index photo: used internally to check the parser, never a layer);
- `too-small` (under 600 px on the long side; it is still importable if the owner insists, at the zoom it supports).

### (e) DWG and CAD

- **v1: report only.** The row reads "AutoCAD R14 drawing: export it to DXF or a georeferenced PDF from CAD". GDAL reads DWG only from R2000, and the 1969 atlas DWG is probably a page layout in drawing units, not a map layer.
- **v2: LibreDWG.** Pin LibreDWG `dwg2dxf` (it reads R13–R2018) in the pipeline image. Then DXF goes to OGR to a vector page index that helps assemble an atlas.
  - Its GPL-3 licence must be checked against the image's notice policy (**UNVERIFIED**).
  - ODA's converter is proprietary and is excluded.
  - Lands only if the 1969 atlas becomes publishable.

### PDFs

- Pages are extracted with **pikepdf**, pinned in the pipeline's requirements. It takes images out without re-encoding (`/DCTDecode` streams are written as is). Each page then becomes a single or an atlas page.
- An encrypted PDF that opens with an empty user password (owner restrictions only) is read. One that needs a password is skipped (`pdf-password`). The worker never asks for or cracks one.
- Miorini 1923: the encryption type is **UNVERIFIED**. Its 143 pages go to the atlas path.
- Every placer swaps a PDF for its pages before it reads anything, the overview search included (2026-11-12: the 1923 plan-ghid failed
  with `GDAL cannot read … .pdf`: the atlas's overview search ran on the PDF itself, found a loose map beside it, and asked GDAL, whose
  PDF driver in the pipeline image writes but cannot read, to open the PDF). A page stored in a form that cannot be written as is
  (JBIG2, an unusual colour space) is decoded once and written as a TIFF; a PDF pikepdf cannot open fails the series with
  `apiError.imagery.archiveCorrupt` naming the file. A page with no image at all (vector only) is still counted and left out.

### Atlases and pieces (the two assembly cases)

- **Atlas.** OCR on the index page gives page numbers on a grid, which gives the page adjacency. Neighbouring pages are aligned by matching across their shared edge: at least 8 matches along the edge strip, and a similarity with no TPS. The assembled atlas is then one map in map space, calibrated as one class (c) map. Many junctions over the whole city are far stronger than page by page. Missing pages (Borroczyn page 50 is in the twin; Miorini is unknown) leave holes, which are shown in the report.
- **Pieces.**
  - Pairwise homographies between overlapping pieces (SIFT on 1/4 scale, RANSAC). The pieces are flat scans, so an affine model is used, not a camera model.
  - A global bundle adjustment.
  - **Seam by graph cut**, not feathering. A missing piece leaves a reported hole.
  - Then class (c), with the same-era reference (IGA 1895) first.

## 4. The job

| Item | Value |
| --- | --- |
| Type | `archive-series` (new, in `COUNTED`, but never counted since it is `localOnly`: 2026-11-09). `runOn: 'local'`, `localOnly: true`, `waitReason: 'worker'` at once (`daily` only for the series held before 2026-11-09, released at the next tick). |
| Input | `{archiveId, seriesId, sheets: <count>, class, gridId?, referenceLayerIds[], edition?}`. The sheet list itself is the local `archive.json`, checked by SHA-256 in `gather`. |
| Steps | `gather` → `prepare` (per sheet: decode, frame, mask; resumable per sheet through `work/.../prepare.checkpoint.json`) → `place` (grid, atlas, pieces or match) → `refine` (joint and TPS) → `check` → `merge` (RGB- or line-art-aware) → `export` → `tiles` → `register` → the publish steps (M12 own tiles, or Mapbox if the city chose it). A failure in `place` or `check` moves the job to `awaiting_gcps` with suggested pairs, never to `failed`. |
| Version | `origin: 'archive'` and `source: {kind: 'archive', archiveId, seriesId, sheetCount, placedCount, skipped: {reason: n}}`. `georef` has `method: 'grid' \| 'atlas' \| 'match' \| 'embedded' \| 'gcps'` and the blocked checkpoint figure. A series cannot be described by one scan's pixels, so the version carries per-sheet residuals only as a summary (median, p95, worst five sheet names). |
| Recalibrate (M16) | Allowed on the worker that holds the originals, recognised by SHA-256. If the folder moved, the worker page asks the owner to point to it again. |
| Time (estimate, a 4-core home PC) | 1:500 series: prepare about 1 s a sheet, so about 75 min; mosaic and tiles at z19 about 40 min. Singles: 2–10 min each on CPU, under 1 min with the GPU voter. **UNVERIFIED** until the acceptance run (§10). |

**What is uploaded.** `tiles.pmtiles`, `thumb.webp`, `preview.png`, and a small `sheets.geojson` (sheet outlines and names, for the approval view and later corrections). `scan.tif` and the originals stay local. This is a deliberate exception to M7's `scan.tif` upload, recorded in the version as `localOnly`.

## 5. Approval and the threshold for maps

Satellite keeps the city's threshold, 15 m by default. A drawn map cannot be truer than its drafting and survey. Classic graphical accuracy is 0.2–0.3 mm on paper, and its tolerance is about 3×. A guide map also widens streets to draw them. The proposal:

```text
mapThresholdM = clamp( max(cityThresholdM, 1.0 mm × scaleDenominator), cityThresholdM, MAP_THRESHOLD_MAX_M = 60 )
```

| Map | Scale | Threshold |
| --- | --- | --- |
| IPB 1:500, 1:2000; cadastral; IGA 1:5000 or 1:10000 | at most 1:15000 | 15 m (the city's) |
| Baedeker c. 1900 | 1:31000 | 31 m |
| 1897 Hungarian | 1:40000 | 40 m |
| No stated or detected scale (1770–1799, the 1935 scheme) | none | **never auto-publishes**; one click after a look |

The rest of the rule for maps:

- **Coverage.** Coverage is measured against the map's own neat-line extent: the agreeing checkpoints must span at least 70 % of it (`AUTO_MIN_MEASURED_PCT`), in place of the city's 90 %.
- **Other gates.** No dropped gross check, the rival search clean, and the rights confirmed.
- **Why 60 m is the cap.** Beyond that, a map overlaid on the modern map at street zoom misleads more than it informs. A worse fit waits for the admin, who may still approve it with the error shown on the card.
- **Settings.** `cityImagery.mapThresholdMaxM` (default 60, range 15–200) and `mapAutoPublish` (default on), in Settings → Imagery, in `ro` and `en`.

## 6. Optimisation

- **Originals are kept losslessly and untouched** on the computer. Working copies are made only where needed: 1-bit G4 is kept as is, and JPEG is read without re-encoding. The 82 MB PNG becomes a DEFLATE COG locally.
- **Encoding per series**, chosen at the scan from bit depth and colour statistics (the owner can change it):
  - **`lineart`** (1-bit or two-tone):
    - warp with nearest, then a box-filter pyramid so lines stay crisp, and no JPEG anywhere;
    - local COG with DEFLATE and a predictor;
    - tiles are **lossless WebP with a palette**;
    - option **paper transparent** (default **off** for line plans; owner 2026-11-12): when off, paper is opaque white so the plan reads on the map; when on, paper becomes alpha 0 and overlays the basemap or satellite. It is stored as a tiling flag on the version, not as a viewer adjustment.
  - **`grey`**: bilinear, JPEG COG, lossy WebP at q80, as today.
  - **`colour`**: an **RGB** path through `Warped` (3 bands + alpha), `merge` and `export` (JPEG YCbCr COG, lossy WebP at q82). Today's code forces grey. This is Workstream F's main change, tested so that a grey input stays byte-identical.
- **Max zoom from the scan's ground resolution.**
  - `gsd = 25.4 mm / dpi × scaleDenominator`.
  - `zRes = floor(log2(156543.03 × cos φ / gsd))`.
  - The tiles' `maxzoom = min(zRes, zBudget, 21)`. Mapbox overzooms to the city's `maxZoom` (M12).
  - `zBudget` is the largest zoom whose estimated archive fits `ARCHIVE_SERIES_MAX_BYTES` (2 GB by default; the estimate comes from a sample of 50 tiles encoded at the scan).
  - The report shows bytes against the bucket's 5 GB free allowance.
  - Example: 1:500 at 300 dpi gives 4.2 cm, so zRes is 21. The 1:500 series covers about 284 km², so z19 (0.21 m) is about 95k tiles and about 1 GB lossless line art, while z20 is about 4 GB. Default z19, with z20 as a choice that shows its cost.
- **Duplicates** are never processed twice. The SHA-256 index of the archive is kept, and a re-import of the same files reports *already imported* per series.

## 7. Rights, provenance and credits

Each series carries:

```ts
rights: {
  licence: 'PD' | 'CC0' | 'CC-BY-4.0' | 'CC-BY-SA-4.0' | 'permission' | 'unknown';
  state: 'clear' | 'needs-confirmation' | 'do-not-publish';
  author?: string;
  publisher?: string;
  year: string;
  sourceLabel?: string;
  sourceUrl?: string;
  watermark?: string;
  note?: string;
  confirmedBy?: string;
  confirmedAt?: Timestamp;
}
```

Pre-flag rules:

- A work dated 1931 or earlier with no named author is `clear`, PD.
- A named author with an unknown death date is `needs-confirmation`, with a "check the author's death date" note (Pantea 1921, Miorini 1923).
- An institution's work less than 70 years after publication is `needs-confirmation` (Romanian law 8/1996).
- A visible "copyright" mark becomes `do-not-publish`, and the owner can change it only by choosing `permission` and typing who granted it.

For Bucharest:

| Series | Rights |
| --- | --- |
| IPB 1:500 and 1:2000, the 1962–78 mosaic | `needs-confirmation`, with the report's explicit question: "These sheets were made by Institutul Proiect București until 1977 and come from an institutional topographic archive. Confirm where they came from and that you may publish them." Until confirmed they can be calibrated and used as private references, but never published. |
| 1968, 1969, 1974, 1982 | `needs-confirmation` |
| Giurescu pages (two) | `do-not-publish` (protected until 2047) |
| The Oltean drawing | `do-not-publish` (marked "copyright Radu Oltean") |

- **Credits.** `layer.attribution` gets the built line "Author, Title, year · licence · scan: source (watermark)", within 500 characters. It already reaches the legal line and the compare bar.
- **Manifest change** (a minor, additive change, recorded in `ENGINE_API.md`): `layer.rights?: {licence, author?, source?: {label, url?}}`, shown in a layer-info row in the Layers panel and in About → Credits. Strict schema, plain text only, no HTML.

## 8. Admin UX

1. **Import local files** card on the Imagery page. It shows the worker's state, the choose button, and the archives already scanned.
2. **Scan report** (`/admin/imagery/archives/<id>`):
   - a header with files, size, series found and files skipped;
   - one row per series: contact-sheet thumbnail, title, year, files, size, class, what will happen ("Place 4,545 sheets from their names on the city grid", "Match against the 1895 plan", "Skip: modern artwork, copyright"), the estimated zoom and bytes, auto-calibration likelihood (*likely*, *possible*, *needs points*), and the rights chip;
   - editable title, year, licence and author per series, an include toggle, and the table of odd names;
   - a total: bytes to publish and jobs (no days since 2026-11-09: every series starts at once on the computer).
3. **One Import click.** `archive.import {cityId, archiveId, series: [{seriesId, include, title, year, rights}]}` creates every included series job in reference-ladder order. Since 2026-11-09 every job starts at once (`waitReason: 'worker'`); the response shows "33 series start on this computer". (Before, the jobs beyond today's share were created with `waitReason: 'daily'`.)
4. **Progress per series** on the Jobs page and on the archive page: step and sheet counts ("prepare 1,812 of 4,545"), skipped sheets with reasons, and the GPU or CPU in use (M10).
5. **Results.** Error in metres (the blocked figure), the threshold that applies and why, the checkerboard and own-tiles preview (M12), and sheet outlines over the map with per-sheet residuals coloured. *Approve*, *Fix points* (opens the georeferencer with suggested pairs), or *Exclude sheet*.
6. **Rights confirmation.** A dialog per flagged series, with the question and a free-text "permission from", logged in `rights.confirmedBy` and `rights.confirmedAt`. Publish stays disabled until it is done.
7. **Home → What needs you** (M18 §7) lists series waiting for points or rights.
8. **Strings and states.** Every string is in `ro` and `en`, in a lazy chunk `archive` with its own i18n catalogue (as M7's `admin-worker`). Every state joins `e2e/tour/states.ts`.

## 9. Viewer

- Map layers already render. They need:
  - a **Maps** subgroup inside *Historical layers*, next to *Aerial and satellite*, grouped by `kind`;
  - a small map glyph on a map year's timeline chip;
  - the `rights` row in the layer info.
- Default opacity for a `map` layer is 0.85. The `lineart` paper-transparent tiles make it legible over satellite.
- Compare (swipe) works unchanged: a map against a 1970s satellite frame is the headline use.
- No Firestore and no HTML from data. The new manifest field is plain text.

## 10. Workstreams and tests

### A. Contracts

(shared plus Python twins)

- Scope:
  - `archiveDocSchema` and the series plan;
  - `rightsSchema`;
  - job type `archive-series` in `COUNTED`;
  - wait reason `daily`, `localOnly`;
  - version origin `archive` and source kind `archive`;
  - `georef.method` additions;
  - the `mapThreshold` function;
  - `cityImagery.mapThresholdMaxM` and `mapAutoPublish`;
  - `layer.rights?` in the manifest;
  - grid documents `cities/{c}/grids/{id}`.
- Tests:
  - schema round trips;
  - Python and TypeScript parity;
  - `mapThreshold` table cases (no scale, 1:500, 1:40000, the cap);
  - manifest v1 back-compatibility (a layer without `rights` is valid);
  - a strict refusal of extra fields.

### B. Worker intake and scan

(`hcm_pipeline/archive/`)

- Scope: the import page, the loopback stream, zip reading, the sandboxed probe, the classifier, OCR prefill, the report callable.
- Tests:
  - zip-slip, absolute paths, symlinks, an entry ratio bomb and a too-many-entries archive are each refused;
  - CP437 and UTF-8 names;
  - magic-byte detection (a TIFF named `.368`, a file with no extension);
  - a probe child that crashes or times out becomes a skip row;
  - junk detectors (a synthetic `Thumbs.db`, an OLE2 autosave);
  - SHA-256 duplicates;
  - twin choice;
  - an atlas with an index and non-map pages;
  - piece overlap grouping;
  - sidecar validation (an invalid one is ignored and reported);
  - a report over 200 series is paged;
  - host paths never appear in the report.

### C. Grid series

- Scope: grammar parsers (the Bucharest grid, the 1:1M scheme), the quarter-permutation search, frame and crossing detection, the global grid solve, per-sheet homography, the joint seam solve, the hard-seam mosaic.
- Tests:
  - synthetic G4 sheets drawn from a known grid under a known similarity, with shrink and skew: recovered within 0.5 m;
  - the wrong quarter permutation loses to the true one;
  - a sheet with no frame is left out and reported;
  - the 3-sheet manual seed solves;
  - a grid solve against a mirrored or other city is refused by the proof gates;
  - the parser covers every name in the inventory's list of special cases (names only, as a data fixture).

### D. Drawn-map calibration

- Scope: masks, classical road extraction, the `RoadSegmenter` port (a null default), the persistence-filtered reference, chamfer coarse placement, junction RANSAC, the TPS with CV λ, scaled checkpoints, suggested pairs, the reference ladder with error in quadrature.
- Tests:
  - a synthetic network warped by a known TPS plus drafting noise, recovered under the threshold;
  - a map of another city is refused (zero false accepts, as `m9-false.py`);
  - a rotated-180 map is found;
  - too few junctions gives `awaiting_gcps` with pairs;
  - the TPS is refused under 30 inliers;
  - the legend and cartouche mask excludes text blocks;
  - a ladder reference's error adds into the figure.
- Gate R2: the AI path lands only on a measured gain with zero false accepts. No GPU and no weights in any gate (M10's rule).

### E. Assembly

- Scope: atlas layout from the index page, edge alignment, piece stitching with graph-cut seams, PDF page extraction (pikepdf), a password PDF skipped, DWG reported.
- Tests:
  - a synthetic atlas of 3×3 pages with one missing page leaves one hole;
  - a page out of order is placed by the index;
  - synthetic overlapping pieces are stitched within 1 px;
  - an encrypted-without-password PDF extracts; a password PDF is skipped;
  - a DWG file gives the `needs-cad-export` row.

### F. Optimisation and export

- Scope: the RGB path through warp, merge, export and tiles; `lineart` encoding with paper transparency; maxzoom from gsd and budget; originals untouched; local-only `scan`.
- Tests:
  - a grey input's outputs stay byte-identical to today's (regression);
  - an RGB input keeps colour (channel means preserved within 2 %);
  - line art has no grey halos at maxzoom (a palette of at most 4 colours);
  - the paper-transparent alpha;
  - `maxzoom` cases (1:500 at 300 dpi gives 19 under a 2 GB budget);
  - a byte estimate within ±25 % of the real archive on a fixture;
  - the original's SHA-256 is unchanged after a run.

### G. Functions

- Scope: `worker.archiveReport`, `archive.import`, `archive.cancel`; `localOnly` refusing `imagery.runOn`; the cap at one per series job with `daily` waits released by the tick in order; `autoApproves` for maps (own-extent coverage, the scaled threshold, no scale meaning no auto); the publish rights gate; attribution built into the manifest.
- Tests (emulator and unit):
  - 33 series with 10 left today gives 10 queued and 23 `daily`, and the tick releases the next day;
  - a re-run does not count;
  - moving a local-only job to the cloud is refused;
  - an unconfirmed series refuses publish; confirmed, it publishes;
  - auto-approve true and false per rule;
  - access matrix rows (editor yes, uploader and viewer no);
  - a 1 MB document limit cannot be reached (the report is capped and paged).

### H. Admin UI, viewer and e2e

- Scope: the import card, the scan report, the rights dialog, progress, results with sheet outlines, settings; the viewer's Maps subgroup, chip glyph and rights row.
- Each behaviour gets a happy and a bad row in `e2e/scenarios.json`:
  - S-A import: happy and BAD-NO-WORKER;
  - report edit: happy and BAD-YEAR-EMPTY;
  - unsafe zip: BAD-ZIP-SLIP;
  - the daily queue: BAD-DAILY-SPLITS;
  - low confidence to points: BAD-LOW-CONFIDENCE;
  - rights gate: happy and BAD-RIGHTS-UNCONFIRMED;
  - skip reasons: BAD-DUPLICATE, BAD-CAD;
  - S-V Maps group: happy and BAD-NO-MAPS;
  - rights row: happy and BAD-NO-RIGHTS.
- Every screen and state goes into the tour with `expectStateSound`. Strings exist in `ro` and `en`. The worker is a fake at the boundary; owned modules are never mocked.

### I. Acceptance on `harti.zip`

(CPU on the NUC, GPU here, nothing uploaded until the owner approves)

- Run the scan, then every series job on the worker against the local emulators.
- Record a table per series: placed and skipped sheets, blocked figure, threshold, auto or points, minutes, bytes, peak memory.
- Checkerboards read by eye.
- Record whether the IPB grid also fits IGA 1895, IGA 1911 and the cadastral plan within 5 m (the inventory's claim, **UNVERIFIED**).
- Results go into this document's *As built*, and bugs go into `docs/LESSONS.md`.

**Order:** A, then B with C and F in parallel, then D and E, then G and H, then I.

## 11. Estimate for this archive

| Series | Path | Expected |
| --- | --- | --- |
| IPB 1:500 (4,545; base layer plus edition layers) | b, grid | **Auto.** The grid is solved from the whole series; about 98 % of sheets placed, the rest reported. Publish blocked on rights. |
| IPB 1:2000 (531) | b, grid | **Auto.** 15 odd names need checking in the report. Blocked on rights. |
| Cadastral 1911–14 (124) | b, grid | **Auto** for about 109. The about 15 street-named files are matched against IGA 1911: mostly auto, a few need points. |
| IGA 1895–99 (4 quadrants, grey; TIF fallback) | b, printed grid | **Auto** (tens of crossings per quadrant) |
| IGA 1911 official edition (4, grey) | b, printed grid | **Auto.** The 1:5000 vs 1:10000 question is settled by the detected grid. |
| IPB mosaic 1962–78 (2) | c against IPB 1:2000 | **Auto likely** (same content). Rights blocked. |
| 1974 centre, building periods (2 halves) | c against IPB 1:2000 | **Auto likely.** Rights blocked. |
| Coloured 1895 pieces (60) | pieces, then c against IGA 1895 | Stitch **auto**, with holes where pieces are missing. Calibration **auto likely**. |
| Single maps 1893 Orascu, 1895 PNG, 1897, c. 1900 Baedeker, 1914 SOCEC, 1921, 1928, 1931, 1939 (9) | c against IGA 1895/1911 and OSM | **Possible.** About 5–7 of 9 automatic (estimate); the rest need about 4 points. |
| 1886, 1871 Pappasoglu, 1864 regional | c | **Points likely** (small scale, generalised); suggested pairs offered |
| Borroczyn 1846 atlas (95 map pages; page 50 from the twin) | atlas, then c against IGA 1895 | Assembly **auto**. Calibration **possible**; expect a few points, then TPS. |
| Borroczyn 1852 (A–D), post-1847 sheet | assemble, then c against 1846 | The 1852 border's Paris-meridian longitudes (+2°20′14″) give a **coarse prior only**. **Points likely.** |
| 1770, 1789/91 Purcel, 1791 Ernst, 1799 (500×366) | c against Borroczyn 1846 | **Points.** Never auto-publishes (no scale). 1799 is `too-small`, importable at about z14. |
| 1935 street-plan scheme | c | **Points.** A plan, not a survey: never auto-publishes. |
| Miorini 1923 PDF (143 pages) | PDF, atlas, then c | **Possible.** Depends on the encryption type and an index page (**UNVERIFIED**). |
| 1969 atlas (144 tiny pages), 1968, 1982 | c or atlas | Low value at 478×909. Rights blocked. **Points.** Recommend deferring. |
| DWG | e | "Needs export from CAD" (v1) |
| Giurescu (2), Oltean 1847, index photo, 1770 crop, Thumbs.db, VCF, LL.TXT, 10 exact duplicates, twin TIFs | d | Skipped with a reason |

**Totals.** About 5,300 of the 5,304 TIFF sheets (the grid and cadastral series) place automatically. Of the about 35 drawn single maps and atlases, about 12–15 are likely automatic. The rest go to the georeferencer with suggested pairs, typically 4–8 points each. **Publishable without the owner's rights answer:** everything from 1931 and earlier. The IPB and post-1966 series wait for confirmation.

## 12. Not verified, and owner decisions

- **Not verified:**
  - that the IPB grid is the same grid as IGA 1895 and 1911 and the cadastral plan;
  - the grid's quarter numbering;
  - a road segmenter with explicitly licensed weights;
  - LibreDWG's licence fit;
  - Miorini's encryption type;
  - TransDatRO in PROJ-data;
  - the run times and byte figures (all checked in Workstream I).
- **Owner decisions:**
  - the map threshold rule and its 60 m cap (§5);
  - whether local archive jobs count against the daily cap (proposed: yes, one per series, §1.3; decided by the owner on 2026-11-09: no, a local-only job is uncapped);
  - z19 versus z20 for the 1:500 plan;
  - the year for undated base editions (1977 prefilled);
  - where the IPB sheets came from and permission to publish them;
  - deferring the 1969 atlas and the DWG.

## 13. The owner's decisions (2026-11-09)

- **The map threshold** is the scaled rule of §5: `max(city threshold, 1 mm × scale)`, capped at `mapThresholdMaxM` (default 60 m, range 15–200); `mapAutoPublish` is on by default. A map of no stated or detected scale never publishes itself.
- **Rights.** The whole Idei Urbane DocuBucurești collection is free to publish, credited "Idei Urbane – DocuBucurești" with a link to <https://ideiurbane.ro/docubucuresti-planuri-harti-si-alte-documente/>, plus the originals where known: the 1871 Pappasoglu plan from Wikimedia Commons / Biblioteca Academiei Române; c. 1900 and c. 1938 from muzeuldefotografie.ro; 1844–46, 1895–99, 1911, 1968, 1969 and 1974 probably digitised about 2000 at UAUIM "Ion Mincu" (marked *probable*). So the IPB 1:500 and 1:2000 sheets, the 1962–78 mosaic, 1968, 1969, 1974 and 1982 are rights *confirmed by the owner* (`licence: 'permission'`, `confirmedBy`).
- **Skipped:** `bucuresti 1847.jpg` (copyright Radu Oltean) and the two Giurescu 1966 book pages (`do-not-publish`).
- **Dates and zoom:** the 1974 plan is dated 1962–1978; the undated 1:500 base edition gets year 1977, labelled 1961–1977; the IPB 1:500 series stops at z19.
- **The daily cap:** a local archive's job counts once per series (§1.3).
- **DWG:** "needs an export from CAD" in v1. **The 1969 atlas:** imported (the owner published it), at a low priority.
- **The standing rule** (every importer falls back to one guided "Help calibrate" queue, designed separately): until that design lands, an uncertain series ends in `awaiting_gcps` with suggested pairs and a one-line reason, in a small shared record (`helpItemSchema`: `reason`, `note`, `at`) that the queue's design adopts.

These decisions reach a run through the owner's sidecar `hcm-archive.json` (§2.3 step 10), which now also takes `confirmedBy`, `maxzoom` and `priority: low`. A permission with no `confirmedBy` is read as *needs confirmation*, and a watermark with a copyright mark stays *do not publish* unless a permission is named.

## 14. As built: the core (track/archive, 2026-11-09)

What landed (§1–§2, §4, §6, §7; Workstreams A, B, the core of F and G):

| Part | Where | Notes |
| --- | --- | --- |
| Contracts | `packages/shared/src/schemas/imagery-archive.ts`, `packages/shared/src/api/archive.ts`; Python twins in `pipeline/src/hcm_pipeline/archive/model.py` (held equal by `pipeline/tests/contracts/enums.json`) and `ArchiveSeriesParams` / `_ARCHIVE_SERIES_KEYS` in `pipeline/src/hcm_pipeline/model.py` | `archiveDocSchema`, `archiveSeriesSchema`, `archiveIssueSchema`, `archiveSeriesParamsSchema` (with `maxzoom` and optional `restitch` for Locate again / overview-hole restitching), `archiveSourceSchema`, `archiveReportSchema`, `rightsSchema`, `helpItemSchema`, `gridDocSchema`, `mapThresholdM`, `rightsAllowPublish`, `creditLine`, `layerRightsSchema`, `layerRightsOf`. Job type `archive-series` (steps `gather`, `place`, then the shared tail), wait reason `daily`, `JobDoc.localOnly` and `countedAt`, version origin `archive` with `archive`, `rights` and `help`. |
| Settings | `packages/shared/src/schemas/imagery-settings.ts` | `mapThresholdMaxM` (60, 15–200) and `mapAutoPublish` (on). |
| Credits and provenance | `functions/src/imagery/finalize.ts`, `layerRightsSchema` in `imagery-archive.ts` | The manifest's `attribution` carries the built credit line (author, title, year, licence, scan source and watermark), which already reaches the legal line and the compare bar. The layer document keeps `rights` (`{licence, author?, source?: {label, url?}}`). **The manifest field `layer.rights?` of §7 is not built:** with it the engine's IIFE measured 125,040 bytes gzip against its 125,000 budget, so it waits for viewer bytes (with §9's rights row, Workstream H); the builder does not copy it, so the v1 manifest is unchanged. |
| Intake and scan | `pipeline/src/hcm_pipeline/archive/` (`safepath`, `zipread`, `magic`, `probe`, `probe_child`, `classify`, `grammar`, `sidecar`, `rights`, `encoding`, `report`, `intake`) | The probe child is spawned through `multiprocessing` (never forked, no `subprocess`), limits itself, and a crash or timeout is an `unreadable` row. Classification covers junk, duplicates, CAD, georeferenced, grids (the Bucharest quarter and block names, `Seria N/`, the 1:1M scheme, row-col), atlases with their titled pages, and singles. Pieces and twins need pixels and stay singles until Workstream E. |
| The worker's page | `pipeline/src/hcm_pipeline/worker/import_page.py`, `worker/imports.py`, routes in `worker/server.py` | `GET /import`, `POST /import/new`, `/import/<id>/file` (streamed, `X-HCM-Path`), `/import/<id>/zip`, `/import/<id>/scan`, `GET /import/<id>`; the page's origin and CSRF header as the main page's. |
| Server | `functions/src/worker/archive-report.ts`, `functions/src/imagery/archive-import.ts`, `functions/src/imagery/daily.ts`; `limits.ts` (`dailyRoom`, `countedAt`), `run-on.ts` (`localOnly`), `claim.ts` and `dispatch.ts` (`daily` is never claimed or dispatched), `tick-jobs.ts` (the release), `approval.ts` (the map rule), `approve.ts` (the rights gate), `finalize.ts` (kind `map`, opacity 0.85, the credit line, the layer's rights) | Firestore rules: `archives/{a}`, `archives/{a}/issues/{i}` and `grids/{g}` are read by city members, written by the server only. |
| Pipeline steps | `steps/gather.py`, `steps/place.py`, `tiles/encoding.py`, `steps/pyramid.py`, `steps/export.py` | `gather` checks every sheet's SHA-256 where it lies and writes the local `sheets.json`; `place` dispatches to a placer per class (`PLACERS`, empty in the core) or parks the version `needs_gcps` with `help` (`no-path`) and the job `awaiting_gcps`. Tiles per encoding: line art lossless WebP, **nearest at every zoom including overviews** (averaged RGBA washed ink alpha — Post 1847, lesson 546; `S-P20-HAPPY-ENCODING`, `S-P20-BAD-LINEART-AVERAGE`), **opaque white paper by default** (`paper_opaque`; transparent paper only when `paperTransparent: true` — lesson 555); a one-band COG's edge is read from its mask, so outside the map stays clear (lesson 556); grey as today; colour at q82. A line-art COG is DEFLATE with a predictor, never JPEG. The export step is band-agnostic, so an RGB `warped.tif` keeps its colour. |

What the paths phase (§3, Workstreams C, D, E and the rest of F) needs from the core:

- **A placer per class**, registered in `steps/place.py`'s `PLACERS` (`grid`, `atlas`, `pieces`, `single`, `georeferenced`), each writing `warped.tif` (RGBA or grey and alpha, EPSG:3857, at the resolution of `params.maxzoom`) and the version's `archive` report (`archiveReportSchema`: `method`, `encoding`, `paperTransparent`, `scaleDenominator`, the blocked `checkpointRmseM`, `checkpointCount`, `checksDropped`, `measuredPct` on the map's own extent, `rivalClean`, `residuals`), then `Done`; or `wait_for_help(ctx, reason, note, {"suggestions": ...})` with `HELP_REASONS` (`low-confidence`, `frame-not-found`, `no-scale`).
- **The sheet list** is `work/{city}/{job}/sheets.json` (path relative to the archive, cell, bytes, SHA-256), written by `gather`; the originals are under `ArchiveStore(root).files(archiveId)`.
- **The approval** already applies §5 to `archive` (no `georef` or `scan` is needed); `register` and the publish steps are unchanged.
- **Not built in the core:** the admin's Import card, scan report, rights dialog and progress (Workstream H), the manifest's `layer.rights?` and the viewer's Maps subgroup, chip glyph and rights row (§9: they need engine bytes the IIFE does not have; the layer document already keeps the rights), OCR prefill (§2.3 step 11), contact sheets and thumbnails (§2.2, §2.4), grid documents written by a solve, recalibration of a series (§4, M16), and the acceptance run on `harti.zip` (Workstream I).
- **A layer's year is 1800 to 2100** (`yearSchema`): `imagery.archiveImport` refuses a series dated before 1800 (the 1770–1799 maps) with `apiError.invalidRequest` until the viewer's timeline takes earlier years; the report itself takes years from 1500.

## 15. As built: the paths (track/archive, 2026-11-09)

What landed (§3 a–e, *PDFs*, *Atlases and pieces*, the reference ladder of §1.7, the checks of §3 c step 6; Workstreams C, D and E):

| Part | Where | Notes |
| --- | --- | --- |
| The placers | `pipeline/src/hcm_pipeline/placing/`, registered in `steps/place.py` `PLACERS` | `georeferenced` → `embedded.py`; `grid` → `grid.py` (+ `gridscheme.py`, `render.py`); `single`, `atlas`, `pieces` → `maps.py` (+ `single.py`, `assemble.py`, `pdfpages.py`). Each writes `warped.tif` and the version's `archive` report and `source.placedCount`, or waits `needs_gcps` with `help` (and `junctions` suggestions), never `failed`. |
| Street network (§3 c step 2, the classical path) | `placing/streets.py` | Paper (lighter than Otsu, unsaturated in colour) that spans the map; Zhang–Suen skeleton; on a line plan only the skeleton within 2.5 street half-widths of ink (block interiors are paper too); junctions by crossing number, merged within a street's width. The AI `RoadSegmenter` is not built (no licensed weights verified). |
| Neat line (§3 b step 2, §3 c step 1) | `placing/frame.py` | The outermost rows and columns of ink that run across half the sheet (a faint line of a reduced 1-bit scan counts as ink), each side fitted as a line and their crossings the corners; else the largest convex four-cornered outline; 30–99.5 % of the sheet, in full-scan pixels. |
| Reference (§1.7, §3 c step 3) | `placing/reference.py` | The job's `referenceLayerIds` (a calibrated layer's COG, read as streets, its own error carried), then OpenStreetMap, asked once per city window and cached in the worker's work folder (`osm/`). Never Mapbox Satellite. |
| Coarse placement (§3 c step 4) | `placing/coarse.py` | Chamfer by FFT template matching, zero-mean (the closeness on the map's lines less what the window gives by chance: lesson 528) on a loosened closeness (σ 4 px), scales 12 % apart (±25 % around a stated scale and dpi), four quarter turns ± 3°; three placements far apart are kept; each is refined in 2 % and 1° steps on a finer reference. |
| Fine fit and checks (§3 c steps 5–6) | `placing/fine.py`, `placing/checks.py`, `placing/geometry.py` | Junction pairs within 4 reference pixels, a seeded RANSAC similarity that keeps the pixel flip, an affine, then a thin-plate spline with ≥ 30 pairs over ≥ 60 % of the map (a grid's mosaic stays affine). Checks: one block in five held out before any fit; gross = max(100 m, 5 mm × scale), any gross check blocks; the span on the map's own extent. Holds with ≥ 20 pairs and ≥ 20 % of the training junctions, ≥ 5 checks; the winner is the candidate with most pairs and its runner-up must have at most half as many (M9's rival share). A ladder rung's own error is added in quadrature. |
| Grid series (§3 b) | `placing/grid.py`, `gridscheme.py`, `render.py` | `CityGrid` (500 m cells, rows south, columns east, quarters, 2 × 2 blocks, cadastral cells) as a pluggable scheme per grammar; the quarter order of eight chosen by the seams; the series' mosaic at 2 m (coarser past 6,000 px) placed as one map of known scale, north up, rigid; or from the owner's confirmed grid (`params.gridId` → `cities/{c}/grids/{g}`). Every sheet rendered by a 5 × 5 lattice through its frame's homography, cut at its neat line, hard seams. Not built: the joint seam solve, printed-crossing detection, TPS per sheet. |
| Atlases and pieces | `placing/assemble.py`, `placing/maps.py`, `placing/overview_find.py` | Atlas pages (or a PDF's pages) cropped to their frames and laid out by edge continuity, strongest links first (no OCR of the index page); pieces chained by SIFT affines along the strongest overlaps, nearest-centre hard seams (no graph cut, no bundle adjustment). When the archive holds a complete smaller-scale overview beside the tiles — or, climbing towards the archive root, a same-year raster loose beside an ancestor's branch or in its sibling folders (harti.zip: `Harti/Harta Bucuresti 1895.png` for the coloured pieces in `Harti/Bucuresti 1895-1899/1895-1899.jpg/N_quadrat/`; the city's name alone never qualifies, lesson 561) — `find_overview` + `overview_canvas` lay the pieces (and an atlas's pages) on that overview first (`method: overview`) and that mosaic is the series' picture for the georeferencer. Pieces and overview are read at one size, so the pieces' downscale is estimated from their count (`expected_scale`: n pieces cover the overview) and swept ×0.5–1.4; the overview's 20,000 ORB features are detected once; a fit under 25 inliers (at least 10) is kept only when its scale and turn agree within 5 % / 0.05 rad with the strong fits; the canvas keeps the pieces' detail (median fit scale, at most 8× and `CANVAS_MAX_PX`). Fitting always runs on grey features; a `colour` series' canvas is composed in three bands (`CanvasOpts.colour`, from the series' encoding): each placed piece is read again in its own colour, one at a time as it is pasted (a piece that did not fit is not read again), and warped by the same matrix on paper-white RGB (the overview itself is only the frame and the features, never painted), so the stitched picture, the georeferencer's `scan.tif` and the warped output (placed on its own or from the owner's pairs) keep the map's colour (harti.zip 1895-1899 showed grey; `S-P20-HAPPY-OVERVIEW-COLOUR`); a grey or line-art series stays one band exactly as before, even from colour pieces (`S-P20-BAD-OVERVIEW-GREY-STAYS-GREY`). harti.zip 1895: 57 of 60 pieces, RMS 0.9 px (was 0 on the overview, 4 by joins). **The second pass in the holes** (`placing/overview_holes.py`, `refit_in_holes`, run by `overview_canvas` after `fit_tiles`): a piece left out because its streets lost the ratio test to look-alikes elsewhere on the overview is turned and scaled by the strong fits' consensus (as scanned and upside down) and searched by normalised cross-correlation only where it would cover at least 20 % of overview no placed piece covers; it lands when the best place scores at least 0.45 and beats every place that does not overlap it by 0.1, and its features matched within that window refine it when they agree (scale and turn within the consensus' 5 % / 0.05 rad, within a tenth of its size of the correlation's place). A blank piece, a piece of another map or one whose best place is not clearly the best stays left out and listed in `help.stitched.leftOut` (`S-P20-HAPPY-OVERVIEW-HOLES`, `S-P20-BAD-OVERVIEW-HOLES-NOT-FOUND`). Only the archive's own pieces are pasted; a hole no piece fills stays paper. harti.zip 1895: the three left out (img366, img390, img418, the published layer's white patches near Obor/Gara de Est, Grivița and Tineretului) scored 0.96, 0.91 and 0.90 (img418 upside down) against a next best of 0.66, 0.51 and 0.15: 60 of 60 (DECISIONS-for-review.md §216, LESSONS 669). A published series with pieces left out of its overview mosaic is laid on it again in a new version of the same layer by **Locate again** (`functions/src/imagery/restitch.ts` → job parameter `restitch` → `placing/restitch.py`): the new mosaic becomes its stitched picture and scan, and the base's pairs, in the base scan's pixels, are scaled onto it (the overview's frame is the same); a series the overview no longer places waits for points (`S-A122-HAPPY-RESTITCH`, `S-A122-BAD-RESTITCH-NOTHING-LEFT`, `S-P20-HAPPY-RESTITCH`, `S-P20-BAD-RESTITCH-NO-OVERVIEW`). A blank or unmatched overview falls back to today's joins. The canvas stays in the job's scratch folder and is placed as one drawn map. |
| Grid wait mosaic | `placing/grid.py` (+ `overview_find.py`) | When the grid does not prove, the wait's stitched picture prefers the same overview mosaic over the name/frame mosaic, in three bands for a `colour` series as above (proved / `grid-names` render unchanged). |
| PDFs | `placing/pdfpages.py` (pikepdf 10.18.0) | Each page's largest image written as stored; an owner-locked PDF (Miorini 1923: Standard handler, V4 R4) is read; a password PDF waits (`PDF_LOCKED`) and is never cracked. |
| Georeferenced files (§3 a) | `placing/embedded.py` | Own tags or GCPs; a world file read by the placer itself (lesson 522), its system inferred among Stereo 70, the city's UTM zone, EPSG:3857 and 4326 by where the centre lands; the ruler against OpenStreetMap: a median offset over 15 m waits ("disagrees with OpenStreetMap by N m"). |
| Pieces at the scan | `archive/classify.py` `take_pieces` | A folder of ≥ 3 scans in a scanner's order (`img362.jpg`) is one pieces series; sibling folders that are all pieces merge at their parent (the four `N_quadrat` of the coloured 1895 plan). |
| Server | `functions/src/worker/{allow-list,step-update}.ts` | A run may write `source`, but only an archive series' `placedCount` and `skipped` (`sourceAllowed`). |
| Contracts | `AUTO_GCP_METHODS` (+ `junctions`) | Shared, Python, `pipeline/tests/contracts/autogcp.json`. |

Tests: `pipeline/tests/unit/test_placing_{parts,single,assemble,grid,embedded,overview,overview_find,overview_scale,overview_holes}.py` on a synthetic town (`pipeline/tests/synthetic/town.py`: a jittered, bent street grid drawn as grey, colour or line-art maps, sheets, pages and pieces through known placements), `functions/test/worker/step-archive.test.ts`; scenarios `S-P20-HAPPY-{STREETS,FRAME,CHECKS,MATCH,LINEART,PIECES,OVERVIEW,OVERVIEW-ATLAS,OVERVIEW-ANCESTOR,OVERVIEW-SCALE,OVERVIEW-HOLES,OVERVIEW-COLOUR,ATLAS,PDF,GRID,EMBEDDED,LADDER}` and `S-P20-BAD-{FRAME-NOT-FOUND,OTHER-CITY,LOW-CONFIDENCE,PDF-PASSWORD,GRID-NOT-PROVED,EMBEDDED-DISAGREES,SOURCE-FORGED,OVERVIEW-BLANK,OVERVIEW-ATLAS-BLANK,OVERVIEW-ANCESTOR-YEAR,OVERVIEW-SCALE-BLANK,OVERVIEW-HOLES-NOT-FOUND,OVERVIEW-GREY-STAYS-GREY,ENCODING-MASK}`.

### 15.1 The local dry run on `harti.zip`

Run on the NUC on 2026-11-09 against the extracted `harti.zip`, with the worker's own intake and the real `gather` and `place` steps in a
local-only world (documents in memory, objects in a local folder, nothing uploaded); OpenStreetMap read once for the city window from a
public Overpass mirror and cached (the main instance refused this network). Maximum zoom capped at 16 for the run.

- **Scan**: 5,703 files probed in 74 minutes (one spawned probe child per file); after the classification fixes (DECISIONS §135h) 64
  series: 9 grid (1:500 base and 6 one-sheet editions, the 1:2000, the cadastral plan), 4 atlases (Borroczyn 1846 twice, the 1969 atlas,
  Miorini's PDF), 1 pieces (the coloured 1895, 60 scans), 46 singles, 4 skipped (Oltean, two Giurescu pages, the 500 px 1799 plan); 66
  files skipped (50 not a map, 10 duplicates, 4 titled pages, 1 index, 1 DWG).
- **Outcome**: **no series placed itself**; all 60 imported series ended `awaiting_gcps` with a one-line `help`, none failed, none was
  placed wrongly. Times: 1:500 grid 18.0 min (4,533 sheets, peak 1.2 GB), 1:2000 grid 7.1 min, every other series under 2 minutes.
- **What worked**: names to cells and neat lines placed the sheets on the city grid by themselves: the 1:2000 mosaic (303 of 512 sheets
  framed) shows Bucharest's ring railway, the Dâmbovița and its street pattern in place (preview `preview-ipb-1-2000-mosaic.png`), and the
  1:500 mosaic (2,356 of 4,501 framed) the city's outline; the PDF's 143 pages came out of the encrypted file.
- **Why they wait** (each a next step):
  - the grid solve against OpenStreetMap does not prove: the classical street network is read from paper corridors, and the IPB line
    plans are sparse outlines; a solve on the ink itself (rails, river, block edges) against OpenStreetMap's lines is the next try;
  - the cadastral sheets have no printed neat line (`frame-not-found`): their cells need a frame from the content's extent or the grid's
    printed crossings; 2,145 of the 1:500 and 209 of the 1:2000 sheets are framed by neither method yet;
  - drawn maps: guide maps hatch or tint their blocks and letter their streets, so a grey threshold finds no street network or the wrong
    one (the 1900 Baedeker crop, `streets-baedeker-1900-crop.png`); six coloured maps showed no network at all. This is the case §3 c
    step 2 kept for the `RoadSegmenter` (gate R2), and OCR of the printed scale would narrow the search for every single map;
  - atlases: edge continuity joined 2 of 94 Borroczyn pages and none of Miorini's (hand-drawn pages do not continue pixel for pixel
    after cropping); the index page (OCR) is needed; pieces: SIFT on the reduced colour scans joined 1 of 60.

The per-series table and the previews are the run's artefacts (`harti-dryrun.json`, kept outside the repository with the archive).

## 16. As built: the admin and the viewer (Workstream H, track/archive, 2026-11-09)

What landed (§8, §9, §5's settings; behaviours A121 and V53):

| Part | Where | Notes |
| --- | --- | --- |
| Import local files | `packages/ui/src/admin/archive/hcm-archive-panel.ts`, in the Imagery area's Upload view under the GeoTIFF upload | With no worker of the city seen in the last three minutes: "Start the worker on this computer first", Open Jobs. With one: **Choose a folder or zip on this computer**, a link to the worker's own page `http://127.0.0.1:8765/import?lat=<the city's latitude>` in a new tab (a page of the map's site cannot reach the computer's loopback). Below, the scanned archives (`cities/{c}/archives`, newest first), each opening its report. An archive that arrives while the card is open, not yet imported, opens its report by itself (`hcm-archive-arrived`). |
| The scan report | `packages/ui/src/admin/archive/hcm-archive-report.ts` at `#/imagery/archive/<id>` (the Imagery page's detail kind `archive`) | Files, size, series found, files skipped by reason; per series: title and year label, what will happen ("Place 4,545 sheets from their names on the city's grid", "Skipped: may not be published (rights)"), the chance to calibrate itself, the rights chip, zoom, bytes and minutes; Import this series, Title, Year; rights that wait ask "Permission from" and Confirm the rights (inline, not a dialog). The total: series, bytes of tiles, days at the city's daily share. One **Import** (`imagery.archiveImport` with only the owner's edits); "N series start today, M wait for the next days". Once imported, each series' progress, and below it the plan of the series not imported yet (left out, or started over by **Delete this version**, `imagery.deleteVersion`, which takes the series out of `archives/{a}.jobs`; the import then refuses only a series the record still names: S-A125-HAPPY-DELETE-VERSION). |
| First edits | `packages/admin/src/archive/model.ts` | A series is kept when the scan proposes it and a layer can show its year (1800–2100): the 1770–1799 maps, the too-small 1799 plan and the skipped series start left out, so the defaults import without a click more. |
| Progress | the same report once the archive records its jobs | Each series from its version and its job, live (`layerVersions` where `source.archiveId`, `jobs` where `params.archiveId`): Waiting for a later day's share, Waiting for the computer, Working: step, percent; Needs your points and the help's reason; Waiting for approval with the blocked error against the threshold its scale earns (`mapThresholdM` with the city's settings), or "the map has no scale"; Publishing, Published, Failed, Cancelled; each opens its version's page. |
| Rights confirmed | `functions/src/imagery/archive-import.ts`, `functions/src/imagery/confirm-rights.ts` | A choice whose rights name `confirmedBy` is stamped `confirmedAt` by the server's clock at Import; after Import, the owner confirms on the version's approval card (`imagery.confirmRights`, DECISIONS §148). |
| Settings | `packages/ui/src/admin/settings/imagery-section.ts`, group *Drawn maps* | Publish drawn maps within their threshold on their own (`mapAutoPublish`, on) and A map's largest threshold (`mapThresholdMaxM`, 60, 15–200, said at its field when out of range). |
| A version's place | `packages/admin/src/worker/feed.ts` | `archive-series` joins the pipeline's job types, so an archive version's page shows where its job runs and why it waits (lesson 529). |
| The chunk | `packages/admin/src/archive/archive.ts` (the `archive` chunk, its own row in `scripts/ci/check_bundle_budget.py`), texts `@hcm/shared/admin-archive` (`ro`, `en`) | Fetched when the Upload view or a report first shows (`ImageryIntents.archive`, `archiveElements`). |
| The owner's sidecar in a folder | `pipeline/src/hcm_pipeline/archive/sidecar.py` | A folder chosen whole arrives under its own name, so `hcm-archive.json` is also read from the archive's one top folder; its paths stay relative to the archive's root (`Harti/...`). |
| The viewer | none | A map layer already renders, is listed in Layers with its credit (`attribution`, the built credit line) and credits the legal line while it shows (S-V53-*). §9's Maps subgroup, the chip's map glyph and the rights row are **not built**: the engine's IIFE has 4 bytes of headroom (DECISIONS §113a), so they wait for the owner's budget decision or a saving (DECISIONS §136c). |

The admin-input budget: from the Upload view, Choose (1), the zip on the worker's page (2), Import (3); the report opens by itself when the worker's report arrives (S-A121-HAPPY-BUDGET). Scenarios `S-A121-*`, `S-V53-*`, `S-P20-HAPPY-SIDECAR-FOLDER`; tour states `archive.*` (`e2e/admin/specs/imagery/archive-states.ts`).

**Not built here:** the sheet outlines and per-sheet residuals over the map, Exclude sheet, the checkerboard for a series (the version's page shows its own-tiles preview as for any version), Home's *What needs you* rows for series, OCR prefill and contact sheets in the report.

### Addendum (2026-11-12): `imagery.confirmRights` on a waiting version

A series imported while rights still said `needs-confirmation` (or confirmed only at Import) no longer strands Approve. The city's owner confirms on the version's approval card (`imagery.confirmRights`: `cityOwner`, licence `permission`, `confirmedBy`, `confirmedAt` from the server clock). Approve stays disabled until `rightsAllowPublish`. DECISIONS §148; S-A120-HAPPY-CONFIRM-RIGHTS, S-A120-BAD-CONFIRM-*.

## 17. As built: the review's fixes (track/archive, 2026-11-09)

DECISIONS §137; lessons 530 and 531.

| What | Where | Behaviour |
| --- | --- | --- |
| Sidecar inheritance | `pipeline/src/hcm_pipeline/archive/sidecar.py` | Every entry that covers a file applies from the root down, a deeper key overriding. New keys `originalLabel`, `originalUrl`, `originalProbable`. |
| The original in the credit | `packages/shared/src/schemas/imagery-archive.ts` | `rights.original {label, url?, probable?}`; the credit line ends "original: …" or "original, probably: …". |
| Rights on the server | `functions/src/imagery/archive-import.ts` | The stored report's rights; a series' sent rights are the owner's confirmation only (owner role, `confirmedBy`), stamped `confirmedAt`. |
| Year | same, `packages/admin/src/archive/model.ts` | `?` or before 1800 without a typed year: `apiError.imagery.archiveYear`. The 1800 minimum stays (owner, 2026-11-09). |
| Daily share | `functions/src/imagery/limits.ts` (`dailyRoomIn`, `passTurnstile`), `daily.ts` | Counted inside the import's and each release's transaction behind `ops/daily`. A share of 0: "none starts until it is raised". |
| Local only | `pipeline/src/hcm_pipeline/steps/export.py` (`uploads_rasters`), `functions/src/imagery/tick-worker.ts`, `packages/ui/src/admin/worker/hcm-run-place.ts` | No COG or Studio upload for an archive series; no cloud offer for a local-only job. |
| Sheet names | `pipeline/src/hcm_pipeline/archive/grammar.py` | Blocks of neighbours only; `prim`, `-MIC`, whole cells read as odd; no extension, no cell. |
| Intake | `archive/intake.py`, `archive/zipread.py` | A cut-off file is removed and refused; an entry onto the zip itself is refused. |
| Estimates | `archive/report.py`, `archive/intake.py` | A grid sheet counts `GRID_CELL_SHARE` (0.5) of its paper; `bytes` is every file's. |

## 18. Batch 4: the owner approves a sheet-name placement; Import local files in the admin's own tab (2026-11-09)

DECISIONS-for-review.md §138d–f; lessons 533 and 534.

| What | Where | Behaviour |
| --- | --- | --- |
| A grid placed from its names | `pipeline/src/hcm_pipeline/placing/grid.py` (`OWNER_METHOD`, `Placed`), `output.py` | A grid that is fitted on the reference but whose checks do not hold (the IPB line plans) is rendered anyway from its sheets' names and frames, `archive.method: 'grid-names'`, with its checks against OpenStreetMap and `seamScore` (the mean edge correlation of neighbouring sheets). No fit at all still waits for three sheets. |
| Never on its own | `functions/src/imagery/approval.ts` | `ARCHIVE_CONDITIONS` refuse `grid-names` as they refuse `gcps`. |
| The owner alone | `functions/src/imagery/approve.ts` `refuseGridNamesUnlessOwner`; `packages/ui/src/admin/imagery/approval-card.ts` | An editor's Approve is `apiError.city.notOwner`; the card shows the seams and the checks, the overlay is the version's private preview on its map, and only the owner sees **Approve the sheet-name placement** (an editor reads that the owner decides). |
| What the layer records | `functions/src/imagery/finalize-provenance.ts` | `provenance.archive: {method: 'grid-names', approvedBy: 'owner'}` (any archive series records its method). |
| Picking files in the tab | `packages/ui/src/admin/archive/hcm-archive-panel.ts` | **Choose a folder** (`webkitdirectory`) and **Choose a zip** pick in the admin's tab; the worker's own page stays a link (the fallback). |
| Streaming to the worker | `packages/admin/src/archive/local-import.ts`, `local-transport.ts` (the lazy `local-run` chunk), `local-state.ts`, `feed.ts` | `POST /import/session {city}` for a token, `new`, each file (`XMLHttpRequest` for the upload's progress), `zip`, `scan`, then `GET /import/<id>` every second until `reported`; **Cancel** aborts and posts `/import/<id>/cancel`. Progress: bytes sent, then files read of total; after Import the report shows **All series: N %** beside each series. |
| The worker's side | `pipeline/src/hcm_pipeline/worker/server.py`, `imports.py`, `archive/intake.py` | A session token only while the worker is signed in for the city; import requests from a Hosting origin carry it (`X-HCM-Session`) instead of the page's CSRF token; CORS and Private Network Access answer `/import/...` for the Hosting origins only. The scan reports `read` of `total`; cancel stops it at its next file and removes the archive's folder. |

Tests: `pipeline/tests/unit/{test_placing_grid,test_worker_imports,test_worker_app}.py`, `functions/test/imagery/archive-approval.test.ts`,
`packages/admin/test/archive/{local-import,feed}.test.ts`, `packages/ui/test/admin/{archive/archive,imagery/grid-names}.test.ts`,
`e2e/admin/specs/imagery/archive.spec.ts`; scenarios `S-A120-HAPPY-GRID-NAMES`, `S-A120-BAD-GRID-NAMES-EDITOR`, `S-P20-HAPPY-GRID-BY-NAMES`,
`S-A121-HAPPY-LOCAL-TAB`, `S-A121-BAD-LOCAL-TAB`, `S-P20-HAPPY-ADMIN-IMPORT`, `S-P20-BAD-ADMIN-IMPORT`, `S-P20-BAD-ADMIN-IMPORT-CANCELLED`.

## 19. Tile stitching and the tile-import wizard (track/autostitch and track/tilewizard, 2026-11-12)

Why parts were left out before (the worker's "9 parts, 85 left out", "2 parts, 98 left out", "57/3", "135/9"): the atlas edges compared
1 px ink profiles and needed a mutual best match, which pages with margins and frames almost never give; the SIFT joins found few unique
matches on repeated hatching and tried no turn or flip; the whole canvas was kept in memory (about 1.2 GB at 20,000 px); names were read
only beside an overview. The pipeline side of the design (part A and the contract's twins) is in `pipeline/src/hcm_pipeline/placing/`;
the tile-import wizard (part B) and the callables are track/tilewizard's.

§19.1 to §19.9 are the pipeline's side (DECISIONS-for-review.md §181); §19.10 to §19.12 are the contract both sides build on and the
admin's half (DECISIONS-for-review.md §182).

### 19.1 The grid from the names (`sheetnames.py`)

`r1c2`, `3_7` / `03-07`, a letter row and a number column (`C12`), a sheet number with an `A`-`D` quadrant (each base sheet's quarters on a
grid twice as fine), folders as rows, else the natural order (`img003`, a PDF's pages). A scheme must read 80 % of the names, no two on one
cell; the names it does not read are foreign (`no-join`). For names in order alone the likeliest column counts (the whole map nearest a
square for the median sheet's shape, exact factorisations first) are each tried and the one whose seams join best is kept. The overview's
name hint (`overview.grid_hint`) reads names through the same parser (`cell_of`).

### 19.2 The working copies (`sheetwork.py`, `frame.py`)

Each sheet is read reduced (at most 1024 px, smaller for a long series so all copies stay within 160 MB), in grey, cropped to its content:
inside its frame when the frame has a paper margin around it (an outline inside the drawing, a ring of streets, is no frame), with the
frame's line trimmed off; else with paper margins of at least 2 % trimmed (a street along the edge is content). The paper level is the
98th percentile (a map of dark blocks has little paper). A page under 0.3 % ink is `blank`. Every copy is stretched to the series' cell
(the median shape), which takes out scale differences; its turn and flip are one of eight variants, those its shape allows.

### 19.3 The seams (`seams.py`)

Only edge strips (25 % of the side) are compared. Line art (under 30 % ink) goes through a distance transform clipped at 12 px; filled
maps are compared on their lightly smoothed grey. Overlap: the first sheet's outermost 2 %, 5 % and 10 % are each searched in the second's
strip by normalised cross-correlation at a sub-pixel peak, and the reading whose overlap correlates best after alignment wins; its
residual is the phase correlation (`cv2.phaseCorrelate`, Hanning window) of the aligned overlaps. Abutting pages: the edges' ink profiles,
shifted, correlated. `strong` from 0.6, `weak` from 0.3, else `missing`. A seam below is a right seam of the sheets transposed.
Each sheet's variant is chosen surest first: a sheet not strong as it is turns to a variant that fits strongly and gains 0.2, each checked
again just before it turns, in two passes.

### 19.4 The bundle (`bundle.py`)

Least squares over every sheet's top left: each strong or weak seam weighted by its score squared, a weak grid prior (0.02) holding each
sheet to its cell at the strong seams' median pitch, IRLS with Huber's loss (2 px). A seam still off by more than 8 px is dropped (marked
weak); a sheet whose cell came from the order alone with no kept seam is left out (`no-seam`): a foreign sheet numbered with the pages never
joins.

### 19.5 The verdict (`quality.py`)

`good` when at least 90 % of the sheets that count are placed (blank pages and `not-part` do not count), the seams' median NCC is at least
0.5, the residuals' 95th percentile at most 3 px and no sheet moved more than a quarter cell from its prior (the thresholds are the shared
`STITCH_GOOD_*` twins); `poor` under 50 % placed or a median under 0.25; else `check`. A sheet is placed for the verdict only when a kept
seam touches it (one its cell's prior alone holds proves nothing), and every seam the bundle did not keep (missing, or dropped) scores 0 in
the median: names read right over pictures whose seams say nothing (the 1895 quadrants read in the wrong order, or noise) are never `good`
(review of 2026-11-13; `test_placing_stitch_guards.py`, S-P20-BAD-STITCH-NAMES-NO-SEAMS).

### 19.6 The fallback order and the windowed mosaic (`maps.py`, `autoplace.py`, `canvas_window.py`)

Atlas and pieces alike: (1) the owner's layout (`help.layoutAnswer`), (2) the overview, (3) names, seams and bundle, mosaicked when `good`,
(4) the older edges or SIFT joins when they place at least 90 % of the parts and something vouches for them: their matches' residual
within `STITCH_GOOD_RMS_PX` with at least 24 agreeing matches a join on average, or, for pages joined by their edges alone (nothing
measured), a proposal that was only `check`, never `poor` (S-P20-BAD-STITCH-LEGACY-LOOSE), (5) else no mosaic: a preview of the proposal
and the version waits with `layout-check`. A series of more than `LAYOUT_SHEETS_MAX` (2000) files waits with `no-path` before any layout
("import it as smaller series"): the wizard could not open its `layout.json` (S-P20-BAD-STITCH-TOO-MANY). The mosaic is a tiled GTiff
written in 2048 px windows, one sheet at a time: only its content box is read, by GDAL straight at its size on the canvas, one band at a
time into one array, then turned; each pixel is owned by the covering sheet whose centre is nearest (a hard seam: blending line art doubles
its lines); GDAL's cache is held to 128 MB. Peak memory is one sheet at the canvas's scale, one band and two windows, never a whole scan
(two 12000 x 9000 colour scans: about 690 MB with the layout, under the test's 800 MB; the first paste read the scan whole at 1.05 x and
copied it three times, over 1.1 GB).

### 19.7 The files for the owner (`layout_files.py`)

`help.stitched.layout` (the grid, the revision, the quality, at most 200 weakest seams) and three version files: `layout.json`
(`layoutFileSchema`: every sheet's cell, turn, flip, why it is out, the grid's source (the same for every sheet, also for one left out),
its matrix from its oriented pixels to the canvas, an axis-wise stretch and a shift (`sx ≠ sy` when a sheet's shape differs from its
cell's), every seam's offset and overlap in the first sheet's oriented pixels, and for a weak **or missing** seam one suggested matching
point and its two strips), `thumbs.jpg` (128 px cells, 32 a row, not turned) and `seams.jpg` (one row per weak or missing seam, weakest
first, two 256 px squares: the wizard must show both states, and size the sprite from every seam with a `strip`). Residuals (`rmsPx`,
`quality.seamRmsPx`) are in cell pixels. The revision is one more than the version's current layout's. What the pipeline really writes is
held in `pipeline/tests/contracts/layout.json` (`test_placing_layout_contract.py`: a series with a foreign sheet, strong and missing seams;
its shape must match, `HCM_WRITE_CONTRACTS=1` writes it again), which the shared schemas' test parses.

### 19.8 The owner's layout (`owner_layout.py`)

The answer names sheets by index with their cell, turn and flip, or `not-part`. A sheet it does not name keeps its automatic reason
(`blank`, `no-join` for a name the grid did not read, else `no-seam`): only the owner's X makes a sheet `not-part`, which no longer counts
(the wizard should still send every sheet with a cell). A turn the cell's shape refuses (a quarter turn of an oblong sheet on an oblong
cell) goes back a quarter, the flip kept. A seam the owner answered (one point on each side) becomes a fixed seam of full weight only when
its two sheets are still neighbours on that side of the new grid and both points are two finite numbers: a seam answered before a sheet
moved or turned, or a malformed point, is ignored (S-P20-BAD-STITCH-OWNER-MALFORMED). The rest are measured and bundled. A `preview` answer
renders the layout and waits again (revision + 1); an accepted or final one is mosaicked and placed whatever its verdict
(S-P20-HAPPY-STITCH-OWNER). The answer stays in `help` through every later wait: `output.wait_for_help` carries `help.layoutAnswer` into
the new `help` in the same write, so a retry of `place` or Locate again lays the series out the owner's way again, and no crash between
two writes drops it.

### 19.9 Targets and measurements

Synthetic series (`pipeline/tests/synthetic/sheets.py` on the synthetic town): N x M grids, overlap 0-15 %, frames and margins, turns and
flips, scale ±5 %, grey, colour and line art, every name scheme, shuffled, missing and foreign sheets, noise. Targets, all met in the tests
(`test_placing_autostitch.py`, `test_placing_canvas_window.py`): every sheet placed at 3 % overlap or more and for named abutting atlases;
seam error median ≤ 1.5 px and p95 ≤ 3 px; a foreign sheet never placed; noise judged `poor` (it waits, never a mosaic); peak RSS ≤ 1.5 GB
for 100 sheets of 6000 px and ≤ 800 MB for two colour sheets of 12000 px (the child's own `VmHWM`, GDAL's cache at a 4 GB worker's 256 MB).
The older edges and SIFT joins place fewer than all 12 sheets of the 6 % overlap series that the layout places whole (pinned in
`test_placing_autostitch.py`).

Real series (dry run on the NUC, 2026-11-13, `autostitch.propose` alone, no overview; before: the older edges and SIFT joins, §15.1 and the
worker's log):

| Series | Before | After (placed / verdict) | Peak RSS | Time |
| --- | --- | --- | --- | --- |
| Borroczyn 1844-1846 atlas, 99 files in page order | 2 of 94 joined | 38 placed, 1 blank, 60 no seam: `poor`, waits with its proposal | 285 MB | 124 s |
| 1895-1899 pieces, 60 scans in 4 quadrant folders | 1 of 60 joined (57 of 60 on the overview, unchanged: the overview comes first) | 60 placed on a misread 4 x 15 grid (each folder is a quadrant, not a row): `check`, waits | 369 MB | 124 s |
| 1969 atlas, 144 pages in order | 2 parts, 98 left out | 102 placed, 42 no seam: `check`, waits | 369 MB | 165 s |

No series was mosaicked wrongly: each waits for the tile-import wizard with its proposal. Next steps: folders that are quadrants (each
its own grid, nested 2 x 2), and the atlas's index page (OCR) for page numbers that are not row-major.

### 19.10 The contract

| What | Where | Shape |
| --- | --- | --- |
| The layout's summary | `help.stitched.layout` (`stitchLayoutSchema`, `packages/shared/src/schemas/imagery-tiles.ts`) | `rows`, `cols`, `revision` (grows by one each time the pipeline writes a layout), `quality {placedPct, seamMedian, seamRmsPx (cell pixels, not the canvas's), verdict}`, `weakSeams` (at most 200: `a`, `b`, `side`, `score`). The Firestore document stays small. |
| Every sheet and seam | `layout.json`, a version file (`layoutFileSchema`) | `sheets` (name, row, col, turn 0/90/180/270, flip after the turn, `out` reason, `source`, an affine `matrix` into the canvas (as written, an axis-wise stretch and shift: `b = d = 0`, `a` and `e` may differ), the oriented size; `source` is the grid's for every sheet of a name or overview grid, unread ones included) and `seams` (`a`, `b`, `side` right or below, `dx`, `dy`, `score`, `rmsPx`, `overlapPx`, `state`, a weak or missing seam's `suggestion` (a missing one may have none) and its `strip` in `seams.jpg`). Golden file: `pipeline/tests/contracts/layout.sample.json`. |
| Thumbnails | `thumbs.jpg` | 128 px cells, 32 a row, `min(n, 32)` cells wide; cell `i` is `sheets[i]` as stored (no turn, no flip), its long side 128 px from the cell's top left. |
| Doubtful seams' strips | `seams.jpg` | One row of 256 px per weak or missing seam with a `strip` (as high as its last row): sheet `a`'s strip in the left square, `b`'s in the right, each scaled into its square from the top left. |
| The owner's answer | `help.layoutAnswer` (`layoutAnswerSchema`) | `revision`, `sheets` (every sheet in the grid with its cell, turn and mirror, every sheet left out for `no-seam` or `no-join` whose cell is still free, at that cell, and the sheets the owner took out as `not-part`), `seams` (one matching point on each side), `preview`, `accepted`, `by`, `at`. |
| Enums | `imagery-tiles.ts`, twins in `pipeline/src/hcm_pipeline/archive/model.py` and `pipeline/tests/contracts/enums.json` | `STITCH_METHODS` + `names`, `owner`; `LEFT_OUT_REASONS` + `blank`, `not-part`, `no-seam`; `HELP_REASONS` + `layout-check`; `SEAM_STATES`, `SHEET_SOURCES`, `SHEET_TURNS`, `STITCH_VERDICTS`, `SEAM_SIDES`; the verdict's thresholds (`STITCH_GOOD_*`, `STITCH_MAX_MOVE_CELL`) and the files' limits. |
| Callables | `functions/src/imagery/save-layout.ts`, `accept-layout.ts`, `layout-wait.ts`; schemas `packages/shared/src/api/imagery-tiles.ts` | `imagery.saveLayout({cityId, versionId, revision, sheets, seams, preview})` (a city editor): refused on a series that is not parked with `layout-check` (`apiError.imagery.versionState`) or on an older revision (`apiError.imagery.layoutStale`); writes `help.layoutAnswer`, the version `processing`, the job `queued` from `place` (as `imagery.saveGcps`). `imagery.acceptLayout({cityId, versionId, revision})`: the earlier answer kept, `accepted: true`, `preview: false`, the same resume. The worker's `place` reads the answer (`placing/owner_layout.py`, the pipeline track). |

No rule changed: the version's files are under `rasters/{city}/`, which a city member reads (`firebase/storage.rules`); the version
document is written by the functions only.

### 19.11 The wizard

`#/help/<versionId>/tiles` (route `help`, never a navigation destination; its own lazy chunk `help` with its texts
`@hcm/shared/admin-tiles`). It opens from a series' page (**Arrange the tiles**, `layoutCheck` of `helpItemsOf`) and reads the
version live, `layout.json` and the three pictures from the private bucket (`packages/admin/src/tiles/`).

| Step | Element | Behaviour |
| --- | --- | --- |
| 1 Order | `packages/ui/src/admin/tiles/tile-grid.ts` | The thumbnails in the grid, each with its source as a badge; drag a sheet onto a cell with a mouse or a pen (the sheet there swaps), or choose it, press **Move** and tap the cell (one pointer, no drag), or a roving tabindex: the arrows choose a cell, Shift and the arrows move its sheet, R turns, F mirrors, X takes it out of the map; the left-out sheets with **Put back**. Each change is said in a live region. The grid pans in its own frame on a phone: a touch never starts a drag (`touch-action: pan-x pan-y`). |
| 2 Seams | `seam-pair.ts` | Each weak or missing seam's two strips with the guess as a dot (a missing seam may have none, and says so); **Accept the guess** (Enter on the pair) or one point on each strip: a click, or the strip focused, a cross moved with the arrows (Shift: farther) and Space or Enter, said in a live region; **Next seam** (N). A seam whose sheet the owner then moves, turns, mirrors or takes out is dropped (the next preview asks it again). |
| 3 Preview | `tile-preview.ts` | The layout from the thumbnails at once; **Make the real preview** sends the answer with `preview` and waits for the next revision; the joined picture and the meter (`role="meter"` per figure the verdict reads, with its words) and an alert on a poor layout. |
| 4 Points | `hcm-tiles-page.ts` | **Place it on the map**: `imagery.acceptLayout` when nothing changed, `imagery.saveLayout` without `preview` otherwise; then **Open the georeferencer**. Off while every sheet is out. |

A draft the owner is changing is kept when the pipeline writes a newer revision; sending it is then refused as stale, the page says
so and shows the newer layout. Back and Next sit in a bar after the step (on a phone too: a bar fixed over the step hid its last lines and buttons). Loading, an address with no
series, a series that waits for nothing any more and a `layout.json` that cannot be read each say so.

Tests: `functions/test/imagery/save-layout.test.ts`, `packages/shared/test/schemas/{imagery-tiles,help-queue,pipeline-contract}.test.ts`,
`packages/admin/test/tiles/`, `packages/ui/test/admin/tiles/`, `packages/ui/test/admin/imagery/tiles-link.test.ts`,
`e2e/admin/specs/imagery/tiles.spec.ts` (tour states `tiles.*`); scenarios `S-A-HAPPY-TILE-WIZARD-{ORDER,KEYBOARD,MOVE,SEAM,SEAM-KEYS,PREVIEW,HANDOFF}`,
`S-A-BAD-TILE-WIZARD-{STALE-REVISION,SEAM-RESET,POINTS-FIRST,ALL-OUT,PREVIEW-POOR,UNREADABLE}` (behaviour A141). The pipeline's stitching, its scenarios
`S-P20-*-STITCH-*` and the dry run on `harti.zip` (§15.1) are the pipeline track's.

### 19.12 The review of 2026-11-13: what the admin side changed

An adversarial review of both tracks found the field names agreeing and the behaviour not. The admin's and the functions' half:

| Finding | Change |
| --- | --- |
| The wizard dropped `missing` seams, the ones the pipeline is least sure of; `seams.jpg`'s height came from the filtered list | Step 2 asks weak and missing seams; the sprite's height comes from every seam of `layout.json` with a strip (`seams.ts`). |
| A `no-seam` sheet became `not-part` for good as soon as the owner changed anything (the pipeline reads an unnamed sheet as `not-part`) | The answer names a `no-seam` or `no-join` sheet whose cell is free, at that cell, so the pipeline tries it again (`draft.ts`). The pipeline should also keep an unnamed sheet's own reason (track/autostitch). |
| A seam answer outlived a turn, mirror, move or take-out of its sheet | The seam is dropped from the draft (`seamsAfter`). The pipeline should also ignore an owner seam that is no neighbour pair of the new grid (track/autostitch). |
| Points could be placed on the doubtful preview | The series' page offers no georeferencer while `layoutCheck`; `imagery.saveGcps` refuses a version waiting with `layout-check` (`apiError.imagery.layoutWaits`). |
| A phone could not pan the grid, nor move a sheet without dragging; R, F, X and Shift+arrows were silent; seam points had no keyboard path | `touch-action: pan-x pan-y` and no drag from a touch; **Move** then a tap; a live region in the grid and in the seam pair; the strips' keyboard cross. |
| The previewing and stale states were not tour states | `tiles.previewing`, `tiles.stale` and `tiles.seam-missing` joined the inventory. |
| The TS docs called `matrix` a similarity and `seamRmsPx` canvas pixels | `imagery-tiles.ts` says what the pipeline writes (above). |

Left to the pipeline track: a test that serialises `layout_record()` of a synthetic proposal into `pipeline/tests/contracts/` for
`layoutFileSchema` to parse (the sample is hand-written), and a sheet cap that waits with `no-path` above `LAYOUT_SHEETS_MAX`; the
golden sample now has a missing seam with a strip and no guess, the shape the wizard asks.

## 20. Any computer runs an archive series: copies through the bucket (live report of 2026-11-13; DECISIONS §204)

**What happened.** The owner connected two more workers for Bucharest (the NUC and the PC's WSL) beside the laptop that imported
`harti.zip`. Both took archive series, found no record of the archive (it is on the laptop only), and failed them at `gather` with
`apiError.imagery.archiveMissing`; one atlas spent all its attempts that way (`attemptsExhausted`). The owner's rule: every
computer works on every job, so the archive is copied, not pinned to one computer.

**Step 1 (this change): the hand-back and the copy through the bucket.**

| Part | What it does |
| --- | --- |
| Pre-flight (`archive/copy.py` `ensure_series`, run by `runner.py` before the first step on a worker) | The series' sheets are here (the scan's own record, or an earlier copy names the series): go on. Otherwise read the job's copy from `tmp/archive-copies/{city}/{job}/` (`manifest.json` and each sheet by its SHA-256, through `worker.urls`), check every SHA-256, keep the sheets in this computer's store (`ArchiveStore.merge_copy`, a record marked `partial`), log the bytes. No copy, or one that is not the scan's bytes: `ArchiveElsewhereError`, the run ends `RETURNED` without a write. |
| Hand-back (`worker.end` `outcome: 'returned'`, `functions/src/worker/end.ts`) | The job, still held by that worker, goes back to `queued` with the attempt its claim counted given back, `archiveReturns` + 1, no lease or worker, and `waitReason: 'archive-copy'` (any earlier `archiveCopy` cleared: a new copy is wanted). The worker's last job stays as it was. The computer the archive's report came from never hands back (its files are gone), and the fifth return fails the job (`ARCHIVE_RETURNS_MAX`): both with `archiveMissing`, so nothing loops. |
| The holder's duty (`worker.claim`) | A claim names the archives the computer holds whole (`archives`: `ArchiveStore.held`, never a partial copy). A job waiting `archive-copy` is claimable by nobody; a claim of a worker naming its archive is answered `copy: {jobId, archiveId, seriesId}` before any job. |
| The copy (`worker.archiveCopy`, new callable, `functions/src/worker/archive-copy.ts`) | `objects`: signed PUT/GET of the job's copy files only (`ARCHIVE_COPY_FILE`: 64 hex or `manifest.json`), only while the job waits `archive-copy`, never while the budget guard is red. `done` with `bytes` (at most `ARCHIVE_COPY_MAX_BYTES`, 8 GiB): the job goes back to `waitReason: 'worker'`, `archiveCopy: {by, at, bytes}`, and the bytes are logged. |
| Cost | `tmp/` is deleted by the bucket's lifecycle after one day (`PRIVATE_BUCKET_LIFECYCLE`); a copy is only one series' sheets, sent once per job that needs it; downloads to the owner's home network are the only traffic billed. |
| What the owner reads | `adminContent.imagery.wait.archiveCopy`: "Waiting for the computer that has these scanned maps: turn it on, it sends a copy." (Jobs → Your computer shows whether it is connected) |

A worker older than this change still claims a series and fails it at `gather`: the workers update themselves to the installed
release. A failed series is retried from Jobs; a local job's retry starts its attempts again (`retryPastCap`) and its hand-backs
too (`imagery.retry` drops `archiveReturns` and `archiveCopy`).

Tests: `functions/test/worker/archive-host.test.ts`, `pipeline/tests/unit/{test_archive_copy,test_worker_copying,test_worker_loop}.py`;
scenarios `S-A120-HAPPY-ARCHIVE-COPY`, `S-A120-BAD-ARCHIVE-COPY`, `S-P20-HAPPY-ARCHIVE-COPY`, `S-P20-BAD-ARCHIVE-COPY`.

**Step 2 (done 2026-11-14 through the bucket, §22): sharing while busy and pre-seeding.** The copy over the home network (a LAN
endpoint on the holder) stays a later option, the bucket its fallback: §22 says why the bucket came first.

## 21. A stitched film on another computer (live report of 2026-11-13; DECISIONS §217)

**What happened.** The 1968 Corona F026 was stitched on one worker; after the owner's rough points it was queued again, another
worker claimed it, and `georef` (`steps/recrop.py`) failed "the frame's film is no longer stored": the segments `stitch` made stay
under `work/{city}/{job}/` on the computer that made them.

| Part | What it does |
| --- | --- |
| The films a worker holds (`worker/local_store.py` `held_films`) | Every claim names the jobs whose `work/{city}/{job}/frame.json` is in its work folder (`films`, newest first, at most 200); `worker.claim` keeps them on the worker's document. |
| The hand-back (`steps/recrop.py`, `runner.py`) | On a worker (`archive_root` set) a film not stored here raises `FilmElsewhereError` (an `ArchiveElsewhereError`): the run ends `RETURNED` without a write. In Cloud Run the step still fails with "use Locate again". |
| The wait (`functions/src/worker/film-host.ts`, `end.ts`) | A returned job that is not an archive series goes back `queued`, its attempt given back, `waitReason: 'film-copy'`, when another worker of the city (not disconnected, seen in the last 14 days, the segments' life) names its film; only a claim naming the job in `films` takes it. With no such worker it fails `apiError.imagery.filmMissing`: "The film of this frame is no longer on any computer: choose Locate again, or import the frame again." |
| What the owner reads | `adminContent.imagery.wait.filmCopy`: "Waiting for the computer that cut this frame from its film: turn it on, it goes on by itself." |

**Why no copy through the bucket.** Only the holder could send the film, and the worker runs one thing at a time: a busy holder
cannot send it, an idle one runs the job itself, and a film is 13 GB of segments where an archive series is a few sheets. The
preference is the whole fix; the LAN copy of step 2 could carry films later.

Tests: `functions/test/worker/film-host.test.ts`, `pipeline/tests/unit/test_film_host.py`, `test_worker_loop.py`,
`pipeline/tests/integration/test_whole_frame.py`; scenarios `S-A120-HAPPY-FILM-HOST`, `S-A120-BAD-FILM-GONE`, `S-P20-HAPPY-FILM-HOST`,
`S-P20-BAD-FILM-GONE`.

## 22. Sharing while busy: the holder pre-seeds the other computers (the owner's request of 2026-11-14; DECISIONS §229)

**What happened.** Eight queued "Bucuresti actual" series (4,534 and 525 sheets among them) waited `archive-copy` while the PC and
the NUC idled. The laptop that imported `harti.zip` (worker `w-c9cc212966de0cb3`) was running a long declassified-frame job with its
person at it (`quiet`, `user-active`): §20's copy was asked only by the holder's **claim**, and a busy holder does not claim, while a
pressed one is answered `yielded` before any copy offer. Only the holder has the files, so the series waited for it to be idle and
calm. The owner: other household computers should work on `harti.zip` and the other imported files, with no step of theirs.

| Part | What it does |
| --- | --- |
| The sharing thread (`worker/sharing.py` `Sharer`, started by `Worker.serve`) | Beside the job loop, also while a job runs: `worker.archiveCopy {kind: 'wanted', archives}` (no `jobId`) with the archives this computer holds whole; a named series is sent with `CopySender` (`archive/copy.py`), then it asks again after 1 s; `nothing` or `alone` waits 2 minutes, `dayLimit` 30 minutes, a refusal or a network failure 2 minutes; while paused or without a session it asks nothing (30 s). |
| What the server names (`functions/src/worker/archive-share.ts`, `archive-host.ts`) | A series a worker handed back (`archive-copy`, oldest first) whatever else; else, when another computer of the city was seen in the last 10 minutes (`SHARE_PEER_SECONDS`; a busy one's heartbeat refreshes it) and is neither paused, disconnected nor being removed, the **newest** queued series of its archives not copied yet (`sharable`: queued, not cancelled, not paused, not waiting for a later day's share, no `archiveCopy`) among the oldest 20 queued local jobs; the holder's own claim takes the oldest. |
| Signing and `done` | `objects` and `done` take any `sharable` series, not only one waiting: a pre-seeded series is copied before any computer claims it; `done` records `archiveCopy` and `waitReason: 'worker'` as before. A computer that claims a series whose copy is still under way finds no manifest (it is written last) and hands it back once (§20); `done` then lets it be claimed again. |
| The claim | A worker that shares on its own says `shares: true` and is never answered `copy`. A series waiting `archive-copy` is claimable by a worker whose claim names its archive (`archiveHere`): the holder runs it itself when it does not share it (an older worker, the day's limit), and nobody else takes it. |
| The governor (M26 §4) | `SharePacing`: nothing while the profile is `paused` (the owner's pause, the battery, the heat; a copy under way waits at its next sheet); an average upload of at most 1 MiB/s while `quiet` and 8 MiB/s at `full`, a sheet at a time; the worker's I/O is already in the idle class. |
| Resumable, verified | A sheet already in the bucket with the same MD5 is not sent again (`SignedObjectStore.upload_file`), so a copy cut short (SIGTERM: `ShareStoppedError` at the next sheet, never `done`; a power cut) resumes where it stopped; every upload is checked against Cloud Storage's MD5, and the receiving worker checks every sheet's SHA-256 (§20). |
| Progress (`progress`, the Computers card) | At the copy's start and at most every 15 s: `worker.sharing {state: 'sending', computers, jobId, sentBytes, totalBytes, day, dayBytes, at}`; `done` sets `state: 'done'` and adds the bytes to the day's. The card (`household-sharing.ts`) shows "Sharing scanned maps with 2 other computers, so they can work on them too. 120 MB of 677 MB sent." with a progress bar while `sending` was said in the last 10 minutes. |
| Cost guards | Uploading to the bucket is free; each byte shared is downloaded once by another computer, the only billed traffic (about USD 0.12 a GB). Each computer shares at most `ARCHIVE_SHARE_DAY_BYTES` (20 GB, about USD 2.4) a UTC day: past it `wanted` answers `dayLimit`, the card says "Sharing stopped until tomorrow: today's copies reached 20 GB. That daily limit keeps the cloud bill low. Meanwhile this computer works on these maps itself; the others do other work.", and the holder claims the waiting series itself. One copy may pass the limit by at most one series (`ARCHIVE_COPY_MAX_BYTES`). The budget guard red refuses every kind (`apiError.guardPaused`), and nothing is shared when no other computer could take it (`alone`). |
| Cleanup | `tmp/` is deleted by the bucket's lifecycle after one day (`PRIVATE_BUCKET_LIFECYCLE`): one sharing costs at most a day of storage, a few cents for gigabytes. The receiving computer keeps the sheets as a partial record (§20), so a later run of the same series (after the owner's points) needs no second copy; they count in its folder's size on the Computers card. |
| Privacy | The sheets go only to the project's private bucket, under `tmp/archive-copies/{city}/{job}/`, by signed URLs minted for the city's paired workers, and only to a worker claiming that job; nothing reaches the public bucket or the viewer. A series marked `do-not-publish` is shared like any other (it stays private), never published. |

**Why the bucket, not the home network.** The bucket path existed, is verified end to end and works between computers on different
networks (the PC's WSL and the NUC sit behind NAT and Docker's bridges); a LAN endpoint needs a listening port on the holder, its
token and the starter's firewall rule on three systems. With the 20 GB daily cap the bucket costs at most about USD 2.4 a day; the LAN
copy stays the later saving.

**What Update the map enables.** The functions (`worker.archiveCopy`'s `wanted` and `progress`, `worker.claim`'s `shares` and the
holder's claim of a waiting series) and the pipeline image (the sharing thread) ship together with Setup's **Update the map**; the
workers then update themselves to the installed image. Until then the laptop keeps §20's behaviour.

Tests: `functions/test/worker/archive-share.test.ts`, `archive-host.test.ts`, `pipeline/tests/unit/test_worker_sharing.py`,
`test_worker_loop.py`, `packages/admin/test/worker/household.test.ts`, `packages/ui/test/admin/worker/household-sharing.test.ts`,
`e2e/admin/specs/imagery/household.spec.ts` (tour state `worker.household-sharing`); scenarios `S-A120-HAPPY-ARCHIVE-SHARE`,
`S-A120-BAD-ARCHIVE-SHARE`, `S-A120-BAD-ARCHIVE-SHARE-DAY`, `S-P20-HAPPY-ARCHIVE-SHARE`, `S-P20-BAD-ARCHIVE-SHARE-PAUSED`,
`S-P20-BAD-ARCHIVE-SHARE-STOPPED`, `S-A143-HAPPY-SHARING`, `S-A143-BAD-SHARING-DAY-LIMIT`, `S-A143-BAD-SHARING-STALE`.
