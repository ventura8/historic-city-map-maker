# M12: Own tiles and seeing what you approve (design)

The owner, 2026-11-07: "i want to see the satelite images i aprove!!! build this into our app!!!"; publishing automatic after Approve; Mapbox's Uploads API out ([M11](M11-mapbox-automatic.md)); `autoPublish` stays on. Nothing is built, no cloud touched.

## The choice: one PMTiles archive per version, read by our own small reader

256 px WebP (quality 75) with alpha, z10 to z17, one object, drawn through Mapbox's documented `type: 'custom'` raster source: no tileset, compute units or token.

### Measured

KH-9 frames A015 (78 % of the window) and A038 (57 %), rebuilt at z17 on the NUC from their proved `pairs.json` (`cv2.remap`, not `gdalwarp`); `gdal raster tile` 3.13.3, 4 cores. Window: the city + 10 %, 35,808 × 34,496 px.

| A015 | |
| --- | --- |
| Pyramid from warped / from its COG | 85 s / 87 s |
| Tiles, bytes | 20,270, 174.8 MB (from the COG 175.7 MB) |
| Packing into one file | 0.7 s |
| Full window, scaled, not measured | 25,900 tiles, about 223 MB |
| Other files | COG 300.6 MB; 320 px thumbnail 29 KB; 2048 px preview 6.3 MB |

A038's pyramid: WebP 256 q75 126.4 MB, q60 103.6, WebP 512 124.2 (3,850 objects against 14,802), PNG 608.9. Against lossless, q75 scored 36.4 dB downtown and kept streets and roofs by eye. JPEG has no alpha.

Real Mapbox GL JS 3.34.1, no network, Chromium, the city's CSP; five steps (z12, z14, z16, two pans):

| | Desktop 1280×800: reads, KB | Phone 375×812 @3: reads, KB |
| --- | --- | --- |
| XYZ 256 | 118, 1,132 | 48, 463 |
| XYZ 512 | 43, 1,598 | 23, 853 |
| PMTiles 256 | 122, 1,172 | 52, 504 |
| PMTiles 512 | 44, 1,614 | 24, 870 |

- **Mapbox and PMTiles.** A bare `.pmtiles` URL, what `rasters.ts` sends today, makes GL fetch `mapbox-gl-pmtiles-provider` v0.0.3 from `api.mapbox.com` (blocked here; untested). No `addProtocol`; `addTileProvider` works with our module but is `@private`. The custom source works in Chromium and WebKit, with opacity, `raster-resampling: nearest` and removal.
- **Reader:** 1,151 B gzip, no library.
- **Preflights.** PMTiles none (a simple `Range`). Private XYZ with an `Authorization` header: 118, one per tile. Playwright's `page.route` hides preflights.
- **Holes.** XYZ logs a 404 for a skipped tile; the archive answers from its directory.
- **Reload.** XYZ 0 requests; PMTiles in Chromium 51 reads, 105 KB.
- **A server without `Range`** starts the whole file. The reader must cancel the body and report the layer's error.
- **CSP.** Without the origin in `connect-src`, tile errors; the map survives. Admin's `*.googleapis.com` and `manifestOrigins` already cover it.

Why not XYZ: 25,900 objects mean 1,295 `worker.urls` calls (`WORKER_URLS_MAX` 20) with a `stat` and `signBlob` per object, about 51,800 Class A operations for upload plus copy (about $0.26 a layer, past the free 5,000), a partial state to resume, and no private preview without a preflight and a rule's `firestore.get` per tile. The archive needs one signed PUT, one copy, one delete, one signed GET.

Why 256 over 512: a phone downloads 42 % less; the extra reads cost about the same in money.

What XYZ wins: [built-in caching stops at 10 MiB](https://docs.cloud.google.com/storage/docs/caching), so archive reads travel to the bucket's region. Latency from Romania is unmeasured.

## The flow

1. **`tiles`, a new step** in `PIPELINE_STEPS` between `export` and `register`, runs where the job runs (local worker, else Cloud Run): `steps/tiles.py` builds the tree in scratch, `tiles/pack.py` the archive, uploaded privately to `rasters/C/L/V/tiles.pmtiles` with `thumb.webp`; `output.tiles` records path, bytes, count, SHA-256. `export` skips the COG and Studio file unless the city chose Mapbox.
2. **Before approval:** `imagery.previewUrl` (a city member, a one-hour V4 signed GET) gives the admin the private archive at full zoom. An hour on, the page asks for a new address on its own when a tile fails (addendum 2026-11-08).
3. **Approve or the policy:** `approval.ts` is unchanged: 90 % of the city and a held-out checkpoint within the threshold publish alone; every other waits. `publish-own.ts`: a red budget guard waits; no compute-unit guard; `blobs.copy` to `tiles/C/L/V.pmtiles` in the public bucket, `public, max-age=31536000, immutable` (`copy` gains metadata); `finalizeVersion` with origin `own` and source `{type: 'pmtiles', url}`; `publish.onLayerWrite` rebuilds the manifest. No new render.
4. **Sweep:** `imagery.tick`'s `ownTiles` part, one version a tick. A rendered version without `output.tiles` gets a `layer-tiles` job (this step only, from `cog.tif`, measured above). Then a version already `approved` and not at Mapbox has its verdict and choice cleared and publishes on its recorded approval: Aug 1972 join, 1982, 1967, 1978-08-18, 1984, 1983, 1978 mapping, the `studio` one too; `defer` and `pay` clear as well, nothing having been charged. One only `awaiting_approval` gets its picture and waits. Frames a live join holds get pictures, never publish.
5. **Old versions:** published, its private archive goes (the tiles are stored once, in the public bucket; the thumbnail stays). Superseded keeps its public object `LAYER_DELETE_GRACE_DAYS`, then a tick deletes it unless a layer points at it; its private folder goes 30 days after it was superseded (`tick-maintenance.ts`). Rejected or dismissed: its private tiles go, and any public copy a publish left. Layer delete: `layer-delete.ts` also empties `tiles/C/L/`.

## Mapbox's guard

Default: own tiles. One setting, **Publish through Mapbox** in Settings → Imagery, off, keeps today's path for a city that prefers it or whose project refuses `allUsers`. Off, the approval card shows no compute units, Studio steps or choices. Reason: M11's unmetered charge cannot be the default. Layers already at Mapbox stay until a new version replaces them.

## The viewer

- `rasters.ts` turns `pmtiles` into `new PmtilesSource(spec)`; `xyz` and `mapbox` unchanged. Zooms and bounds come from `output`; Mapbox overzooms to the city's `maxZoom`.
- Bucket CORS already allows `*` and `Range`. Never Firestore, no Firebase SDK, no HTML from data.
- **A hole is a transparent picture, never `null`** (addendum 2026-11-08, `docs/LESSONS.md` 496): Mapbox GL 3.34.1 draws a `null` tile with a recycled texture of an earlier tile, which showed other places' pictures beside a partial frame. The source answers a tile the archive leaves out with one shared, transparent 256 px `ImageData`, and still asks nothing for it.
- **Export and kit:** `plan.ts` carries the archive (not the COG) where `rasterExportable` allows, relative `tiles/<layer>.pmtiles`; otherwise the public URL. **A kit city without a bucket:** a file beside the page, on a host with `Range`; GitHub Pages is unverified.

## Cost, in the owner's words

Approval card: "Publishing moves its 175 MB of tiles into your public bucket. Mapbox charges nothing for this layer. Storage is about half a cent a month. Visitors' traffic counts toward Google's free allowance, then Google bills it. Nothing stops the site if traffic grows; the alarm only pauses processing." Size is the version's own; Statistics sums published bytes.

Figures: $0.02/GB-month; 5 GB free in three US regions only, per billing account across both buckets: about 22 full layers once published, as publishing deletes the private copy, fewer while versions wait for approval (each keeps its private archive) or were superseded within their grace (their public archive stays). [The free tier](https://docs.cloud.google.com/free/docs/free-cloud-features) gives 50,000 Class B (about 410 desktop walks of the table) and 100 GB (about 86,000). Past both, about $0.19 per 1,000 walks; its Class B and $0.12/GB egress prices are recalled: [the pricing page](https://cloud.google.com/storage/pricing) would not read.

## The approval view

- **Map:** the page's existing `AreaMap`, no new load, also between versions. The archive replaces the 2048 px canvas; slider on `raster-opacity`.
- **City:** `CITY_OVERLAY` outline, the city minus `output.outline` filled as uncovered, `coveragePct` beside it.
- **Detail:** **Actual pixels** jumps to `maxzoom − 1` (1:1), then `nearest` beyond (measured: 5.7 px blocks at z18.5).
- **Swipe, last and optional:** on tap, a second map on the compare code in a new lazy chunk (about 5 KB), one more counted load, destroyed on exit, only if the total stays under 650 KB.
- **Work:** each waiting row shows `thumb.webp` through `PicturePort`; no map.
- **Phone:** the map gives way on compact windows today (`imagery-styles.ts`). **See the image** opens it full width, the page's only load.

Budgets: engine 94.4 of 100, IIFE 120.7 of 125, `admin-map` 7.3 of 9: the reader fits. `imagery` is at 18.0 of 18, so the view takes a new `approval-map` chunk and the Mapbox choices move to `mapbox-choices`. **New rows, none raised: a reviewed decision.** Refused, it lands in the entry (366.7 of 450).

## Workstreams

**A, tiles and backend.** `pipeline/src/hcm_pipeline/steps/{tiles,export,run}.py`, `tiles/pack.py`, `contract.py`, `documents.py`; `functions/src/imagery/{publish,publish-own,publish-path,finalize,own-tiles-sweep,tick,layer-delete}.ts`, `preview-url.ts`; `functions/src/worker/{allow-list,step}.ts`; `functions/src/{adapters/storage,ports/blob-store}.ts`; `functions/src/export/*`; `packages/shared/src/schemas/{imagery,imagery-paths,firestore}.ts`; `pipeline/tests/contracts/*`; `docs/ARCHITECTURE.md`, `.agent/skills/pipeline/*`. Rows `S-A70-*` publish, `S-A71-*` sweep, `S-A72-*` clean-up, a `P` row. Lands the schema first.

**B, viewer and view.** `packages/ui/src/map/{rasters,mapbox-adapter,map-port}.ts`, `pmtiles-source.ts`; `packages/engine/src/core/map-specs.ts`; `packages/admin/src/imagery/{imagery-map,overlay,version,api,files}.ts`; `packages/ui/src/admin/imagery/{version-detail,approval-card,work-list,imagery-styles}.ts`, `approval-map.ts`; `packages/shared/src/i18n/**`; `scripts/ci/check_bundle_budget.py`; `e2e/tour/*`; `docs/ENGINE_API.md`. Rows `S-A73-*` cost, `S-A74-*` view, `S-A75-*` pictures, a `V` row (bad: no `Range`). Tests: a generated fixture archive, real GL, local files.

## Open risks, not verified

- Real Cloud Storage: range latency, copy time, signed ranges from the admin, the Storage emulator's `Range`.
- Firefox has no WebGL headless here. `DecompressionStream` needs Safari 16.4: check the baseline.
- The custom source under Standard's `middle` slot and in compare: the prototype used an empty style.
- F007 and 1982 were not read (their COGs are only in the bucket).
- A black hairline crossed one rebuilt tile and a dark line runs along the frame's edge, perhaps the prototype's reader. Check real output.
- **A viral month bills unseen:** the alarm never stops the site. The owner should know before the first publish.
- `worker.step` must accept a job writing `output` on an `approved` version without moving its state.
- History's restore of a version whose object is gone must refuse (`functions/src/history/restore.ts`).

## Addendum 2026-11-07: workstream A as built

The pipeline, the contracts and the server are in; the viewer's reader and the approval view (workstream B) are not part of it. No cloud project, Mapbox or Chrome was touched and nothing runs in production yet.

**Where the code differs from the design above.**

- **The step is `pyramid`, not `tiles`.** `PUBLISH_STEPS` already has a `tiles` (MTS at work), and `job.steps` is one map: `steps/pyramid.py`, `PIPELINE_STEPS`.
- **The version records `own`, not a Mapbox origin.** `LAYER_TILESET_ORIGINS` stays Mapbox's. `layerVersionDocSchema` gains `own {path, url, bytes, publishedAt, removedAt?}`, and `published` and `superseded` need `mapbox` or `own`. The layer has `source: {type: 'pmtiles', url}`; a `mapbox` block it already had stays on it, so the tileset is still counted and deleted with the layer.
- **`layer-tiles` is a side job** (`SIDE_JOB_TYPES`): it ends `succeeded`; its failure, cancel, or an invalid job never touches its version (`runner.py`, `imagery/end.ts`); `worker.step` refuses it a state change; its Retry works while the version is `awaiting_approval` or `approved`. Its id is one per version (`tiles-<fnv1a>`), so a failed one waits for that Retry and is never made again by the tick.
- **The setting decides at render and at publish.** `cities/{city}.imagery.publishThroughMapbox` is off by default. Off, `export` writes neither COG nor Studio file. A version with no COG can only publish its own tiles, whatever the city chose later (`publish-own.ts`): no failure to explain.
- **No `publishing` state on this path.** The copy is safe to repeat and the publish is one transaction that needs the version still `approved`; a rejection during the copy wins and its copy is deleted; so is a copy whose publish stopped (attempts run out, or a finalize that threw), and Reject or a dismissal deletes one a killed run left (addendum 2026-11-08). `publishAttempts` caps it at `PUBLISH_MAX_ATTEMPTS`, and a redelivered task after the end does nothing.
- **The sweep waits five minutes after a version's last write**, so it never queues beside a version's own publish task.
- **History:** only a deleted layer takes `source` from its entry (`source` is the server's field), so only that restore checks the object (`requireLayerTiles`).

**The contract for workstream B.** `imagery.previewUrl` (a city's editor, `imageryVersionRequestSchema`) answers `{url, expiresAt, bytes}`, `apiError.imagery.tilesMissing` (no tiles yet: on their way) or `apiError.imagery.tilesGone` (recorded but gone, or not the version's own: nothing makes them again; addendum 2026-11-08). `version.output.tiles` is `{path, bytes, count, sha256, thumbPath}`; `version.own.bytes` is what is public. `imagerySettingsOf(...).publishThroughMapbox` is the setting; Settings → Imagery has no switch for it yet, and its save must keep the field. `output.cogBytes` may be absent (`version-view.ts` shows 0): the card's size is `tiles.bytes`. A manifest's `pmtiles` address may be relative to the manifest in a static export (`tiles/<layer>.pmtiles`). The e2e stand-in's archive is a mark, not tiles: B replaces it with its generated fixture. `e2e/admin/support/imagery.ts` seeds `publishThroughMapbox: true`, as its specs drive Mapbox's path behind the mock; the local stack's cities are on the default.

**Measured with this code** (`write_tree`, `pack`, a reader of its own, on the NUC, the real A015 `cog.tif`, 8 threads): 43 s, 0.3 s to pack, 20,270 tiles, 175.7 MB, equal to the prototype; a 320 px thumbnail of 9 KB; 400 sampled z17 tiles read back from the archive byte for byte. **The two marks of the prototype:** no black hairline in 191,451 full lines of those tiles, so it came from the prototype's reader. The dark line along the frame is real and is the film's: mean grey by distance from the alpha's edge rises from 1 at 1 px to 37 at 8 px and 97 at 39 px in the COG, and likewise (1, 21, 68) in `warped-a015.tif`, so it comes before any tile is made. Nothing here crops it. One frame only.

**Still not verified:** real Cloud Storage (`file.copy` with `cacheControl`, range latency, signed ranges); a job on a real worker or Cloud Run; F007 and 1982 (their COGs are only in the bucket); the viewer list above. Prices are as in *Cost*: not re-read. The private tiles of frames a published join made `joined` stay until the layer's deletion, about 175 MB each: not in the design, and the owner may want them gone sooner.

## Addendum 2026-11-07: workstream B as built

The viewer's reader and the approval view are in. No cloud project, Mapbox or Chrome was touched and nothing runs in production yet. Decisions: `DECISIONS-for-review.md` §96.

**Where the code differs from the design above.**

- **`approval-map` is a version's whole page**, not only the view: the view alone left `imagery` over its 18 KB. It is at 16.2 of 18, `approval-map` 3.5 of 5, `mapbox-choices` 1.3 of 2.
- **The view's words** live in `image-view.ts`, the reader in `packages/ui/src/map/pmtiles-source.ts`, the page's logic in `packages/admin/src/imagery/version-image.ts`, Work's pictures in `version-thumbs.ts`.
- **A version's map starts at 100 %,** as its layer will.
- **See the image scrolls to the map:** the map does not give way on compact windows, as *The approval view* above says.
- **Not built: swipe** (last and optional) and **a Statistics total** (the admin has no Statistics page).

**Verified.**

- Real Mapbox GL JS 3.34.1, no network but the mock basemap, Chromium (`e2e/specs/viewer/own-tiles.spec.ts`, `e2e/admin/specs/imagery/own-tiles.spec.ts`, real PMTiles of real lossless WebP): the archive's colour on the map in the `middle` slot, its attribution, every read a `Range`, no provider script; a hole is no request; a server without `Range` is one read, a toast naming the layer, the map alive; Approve publishes with no Mapbox call. That settles this design's risk about the custom source under a Standard-shaped style, on the e2e's mock of Standard.
- Once, by hand, not kept as a test: the real A015 archive (174.9 MB, the prototype's writer, on the NUC) drawn by this reader at z13 and z16 in the built viewer: Bucharest in 1972, sharp, 26 reads and 564 KB, and 37 reads and 387 KB.
- `pipeline/tests/contracts/pmtiles-archive.json`: `tiles/pack.py` writes exactly these bytes, and the viewer's reader reads its tiles, so the two languages stay one format.

**Still not verified:** real Cloud Storage (signed ranges from the admin, range latency from Romania, the private bucket's CORS answering a real `Range`); Firefox (no WebGL headless here) and WebKit under this page (the prototype drew in WebKit, this code was not run there); `DecompressionStream` needs Safari 16.4; the real Mapbox Standard style; F007 and 1982; a real month's bill. The dark line along a frame's edge (addendum above) is still there, and the owner will now see it: nothing crops it.

## Addendum 2026-11-08: rehearsal on a real frame

One real frame end to end, with no live project: KH-9 A015 (`D3C1218-200750A015`), on the NUC and the local stack (`npm run dev:stack`). Nothing of it is kept as a test; the scripts and pictures stayed in `reports/rehearsal/` (git-ignored).

**Pipeline, with the product's code.** The real `JobRunner` walked `warp → export → pyramid → register` of a `regeoref` job on the NUC (8 GDAL threads; documents in memory, objects in a folder): the frame's cropped scan (30,370 × 22,980, out of its segments), its proved `poly2` pairs (71) and Bucharest's real bounds. Warp 13 s, export 18 s, pyramid 62 s, register 0 s: 93 s, peak memory 6.4 GB (the warp). The output: z10–17, 20,349 tiles, an archive of 179.4 MB, a thumbnail of 28.9 KB, a preview of 6.6 MB, no COG and no Studio file, 89.15 % of the city, so the policy waits for Approve. Today's OpenStreetMap rails and main roads, drawn over the archive's own tiles by z/x/y, lie on the tracks of 1972 at Gara de Nord, Obor and the western edge.

**The prototype's render is not a reference.** `warped-a015.tif` (the 2026-11-07 prototype's `cv2.remap` in 4,096 px blocks) smears about 128 px at every block edge; tiles made from it show those bands. The product's warp (`gdalwarp`) has none.

**On the stack.** The archive in the emulator's private bucket and the seeded draft given the real `output`; a headless Chromium as the owner: `imagery.previewUrl`'s address read by range (desktop, about 100 reads, 1.1 MB for the page and six places, slowest read 1.4 s), streets and roofs sharp at z16 (Actual pixels) and z17, the Stadionul Republicii of 1972 where the Palace of the Parliament stands now; Work shows the thumbnail; the page's JavaScript heap 29 MB. Approve: published 2.6 s after the click (`imagery.publish` 0.8 s, the 179 MB copy included), the public object `public, max-age=31536000, immutable`, the manifest rebuilt with a `pmtiles` source. The viewer with the real Mapbox GL JS against the stack: every read a 206 (four views: desktop 81 reads, 1.3 MB; phone 375×812 @3, 29 reads, 0.5 MB). Layer delete, its job made due and the tick run: the public archive and the version's private files gone, the manifest without the layer.

**Bugs found and fixed** (docs/LESSONS.md 399–401): the stack served archives without `Range`, so the published layer failed in the viewer (`e2e/stack/servers.ts`; `dev-stack.sh check` now reads one by range); Actual pixels zoomed a map scrolled out of sight (it now brings the map into view); an own-tiles layer was tagged Linked and its delete dialog said its tileset stayed at Mapbox (now: its tiles in the public bucket go after the grace).

**Seen, not fixed.**

- The Storage emulator refuses a single upload over about 130 MB (413), so a local worker on the stack cannot upload a real frame's archive or COG; Cloud Storage takes a signed `PUT` of any size. Not a production path.
- The admin's own sign-in on the stack lands in Bacău, so four steps of `dev-stack.sh check` (Photos, imagery, orders, a layer's editor) wait for Bucharest's rows and fail; the stack's first run of this rehearsal did too.
- The deletion notice names the layer by its Romanian label in English.
- Workstream B's "the emulator's signed address is refused by the browser" did not reproduce in headless Chromium: the address answered 206 with CORS for the admin's origin.

**Not run without the live project:** real Cloud Storage (a V4-signed range, the private bucket's CORS, latency from Romania, `file.copy` of 179 MB with `cacheControl`), a Cloud Run job's memory for the 6.4 GB warp, the real Mapbox Standard style under the layer, Firefox and WebKit, and a month's bill.

## Addendum 2026-11-08: the review's findings, fixed

Six findings of a review of the code above, each confirmed by reading it and pinned by a test that failed before its fix (`docs/LESSONS.md` 405–410). No cloud project, Mapbox or Chrome was touched.

- **A public copy outlived a publish that stopped.** A copy whose `finalizeVersion` threw, or an attempt that died after its copy, left an unpublished image world-readable; Reject and dismissal deleted only private files. Now `publish-own.ts` takes the copy back when the publish stops (unless the version is published with it), and `deleteVersionTiles` (`own-tiles-clean.ts`), on Reject and dismissal, deletes the public `tiles/C/L/V.pmtiles` of a version never published. `S-A70-BAD-FINALIZE-THROWS`, `S-A70-BAD-LEFT-COPY`, `S-A70-BAD-ATTEMPTS`.
- **A worker could name any object as its tiles.** `output.tiles.path` was any string, and the server copied, signed and deleted it. Now `isOwnTiles` (`packages/shared/src/schemas/imagery-paths.ts`) holds a version's tiles to `rasters/C/L/V/tiles.pmtiles` and `thumb.webp`: `worker.step` refuses any other (and a `layer-tiles` job changing more of the output than its tiles); `publishOwn` and `imagery.previewUrl` answer `tilesGone`; the clean-up deletes only the fixed names. `S-A70-BAD-FOREIGN-TILES`, `S-P08-BAD-FOREIGN-TILES`.
- **Each published layer was stored twice.** Publishing copied the archive and kept the private one until the layer's deletion, so the card's size and the free tier's count were half the truth. Now publishing deletes the private archive (the thumbnail stays), `imagery.previewUrl` signs the public copy of a published version, and the card says publishing *moves* the tiles. `S-A70-HAPPY-STORED-ONCE`, `S-A70-HAPPY-PREVIEW-PUBLISHED`.
- **"Made on their own, try again in a few minutes" for tiles that were gone.** A new refusal, `apiError.imagery.tilesGone`, says nothing makes them again, and its alert offers no Try again; `tilesMissing` stays for tiles on their way. `S-A70-BAD-PREVIEW-NO-TILES`, `S-A70-BAD-ARCHIVE-GONE`, `S-A74-BAD-REFUSED`.
- **"Being made on its own" for detail that never comes.** The small picture's note now follows the version (`image-view.ts` → `smallKey`): on their way only for a waiting version in a city on its own bucket (and, if they do not come, the Jobs page has the tiles job's Retry); none will be made for an ended version or a city on Mapbox; deleted for a rejected one. `S-A74-BAD-NEVER-COMING`.
- **An expired hour read as a broken image.** A tile failing after the address's hour (counted from its answer by the page's clock) asks `imagery.previewUrl` again on its own, once; a tile failing within its hour still says so, with Try again. `S-A74-BAD-HOUR-OVER`.

**Still not verified:** a real Cloud Storage `delete` racing a `copy`, and a V4 address expiring in a real browser (the e2e moves only the page's clock and refuses one read).

## Addendum 2026-11-08: a partial frame's holes and its dark rim

The owner's screenshot of the live 1980 layer showed two faults beside a frame that covers half the city (DECISIONS-for-review.md §124).

- **Holes drew earlier tiles** (lesson 496): fixed in the viewer (*The viewer* above); every layer with holes inside its bounds is fixed by the engine deploy alone.
- **The dark rim** (lessons 497, 499): `rgba_view` reads the layer through `tiles/rim.py`, which cuts a band measured from the alpha's edge in two passes on a preview at most 8192 px on its long side. The core is the film's black (grey 24 or less) that the transparent outside reaches through black pixels only; from the core the cut grows through the fade, a ramp that rises outward: a pixel joins while it is darker than 65 % of the scene's own median (the frame deeper than the band) and the dark pixels' profile still rises there, read on shells of equal distance from the edge over a 7 px window (lesson 500), and the fade's last dark pixel before the scene is taken too; neither pass goes more than 150 ground metres from the alpha's edge as a straight-line distance (a Euclidean distance transform, so the band is as deep across a 45 degree edge as across a straight one; the 1980 frame's black and fade: about 100), and one preview pixel more is taken. A frame with no black at its edge keeps its alpha untouched; dark water, a park or a shadow that touches the core is flat, not rising, and loses at most two preview pixels past the core (a grainy one, a few more), not the band. The keep-mask is drawn bilinear over the source's alpha (or the COG's mask) by a `min` pixel function **once**, into `rgba-alpha.tif` (tiled, DEFLATE, with the source's own overview levels), and the view's alpha is a plain source of it: a derived band hides every overview, so the first version (2358145) made the thumbnail and every coarse read go through full resolution. The view keeps the COG's overviews, and the thumbnail averages from the closest one. The stitch crop is unchanged, so saved points stay where they are.
- **Archives already published** keep their band until the layer is rendered again (Calibrate again, or the georeferencer's Save, then Approve: re-runs, not imports). No re-tile of a published version is built (§124c).
