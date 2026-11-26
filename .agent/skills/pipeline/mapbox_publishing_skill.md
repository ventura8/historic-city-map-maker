# Mapbox Publishing Skill

Mapbox account `ventura86`. How tokens are handled, how historical layers reach Mapbox, and how cost is guarded. Sources: `docs/research/design-review-onboarding.md` §2B, `docs/research/design-review-security-cost.md` §1.3, §3.3, §4.4, §5.

## Hard constraints

- **No `fostulbucuresti` resources**: no tileset, style, token or streets dataset of that account, and nothing copied from it.
- **Mapbox Satellite is never used to align imagery** (Mapbox Product Terms). Georeferencing uses OSM data and open Sentinel-2.
- Historical layers come only from USGS imagery we acquire or originals the admin uploads.
- The service worker never caches Mapbox tiles or API responses.

## Tokens

- **Secret token** (created by the user in the Mapbox console, scopes `styles:read styles:tiles fonts:read tilesets:read tilesets:write tilesets:list tokens:read tokens:write`, no URL restriction; a token can only mint scopes it holds). Pasted once into the Setup Assistant; stored as `mapbox-sk-bootstrap` in Secret Manager; used only to mint and rotate.
- `setup.saveMapbox` validates it (`GET /tokens/v2` → `TokenValid`, `usage=sk`, the `user` field becomes the username), lists missing scopes by name, then mints `mapbox-sk-tiles` (`tilesets:*`, rotated quarterly) and the **public tokens**: viewer (`allowedUrls: ["https://ventura8.github.io"]`, origin only) and admin (`<proj>.web.app`, `<proj>.firebaseapp.com`), scopes `styles:read styles:tiles fonts:read`. A separate dev token is minted only if ever needed, with the port in its URL.
- Every minted token carries the note `historic-city-map <project> <purpose> [city] (auto)` (purpose `viewer`, `admin` or `tiles`): a save finds each token again by its stored id, then by its note, so saving twice or after a save that stopped half-way updates the tokens in place and never adds more (S-A06-BAD-SAVED-TWICE); leftover tiles tokens are deleted. A demo or trial account (403 on create) and unconfirmed billing (422) answer `apiError.mapbox.mintRefused`, and nothing is stored, not even the pasted token.
- `setup.rotatePublicToken` is the panic button: mint, rewrite the city doc and manifest, queue the old id in `setup/status.mapbox.retiring` (at most 10) with `retireAt` = now + 10 minutes; `ops.tick` deletes it then (S-A06-HAPPY-OLD-TOKEN-RETIRED).
- URL restrictions are best effort (the Referer can be spoofed outside browsers): abuse is handled by usage monitoring and alerts.

## Publishing a layer

- **M12: `docs/research/M12-own-tiles.md`.** Tiles from the project's own public bucket are the default (built end to end; its addenda say what is still unverified on the real cloud): `imagery/publish-own.ts` runs before the compute-unit guard and asks Mapbox nothing; everything below is for a city with `imagery.publishThroughMapbox`, and for a publish already at Mapbox. A version with no COG can only take the own path. Lesson from its prototype: GL 3.34.1 does not read a `.pmtiles` URL by itself; it fetches a provider plugin from `api.mapbox.com`, so `rasters.ts`'s `pmtiles` branch is a custom source with our own reader (`packages/ui/src/map/pmtiles-source.ts`), never a bare URL. The approval card's compute units and choices are the `mapbox-choices` chunk: a version on its own bucket never fetches it.
- Iteration, previews and the georeferencer run on our own COG and preview files in GCS; **nothing is published to Mapbox before approval** (or auto-approval below the RMSE threshold).
- **MTS** (automatic, billed): one deterministic tileset id per layer (`tilesetIdFor(user, city, layer)` of `@hcm/shared`: `<user>.hcm-<city>-<layer>`, hashed past 32 characters), the raster recipe from the layer's zoom range (`rasterRecipe`); published by functions (`imagery.publish`, a task queue, the COG streamed from the private bucket) and polled by the task, with `imagery.tick` as the safety net (`docs/research/M3-interfaces.md` §7).
- **Compute-unit guard**: each MTS publish of a city crop at maxzoom 11 or more costs about 5–30 CU against 20 free CU per month. The guard (`guardVerdict`, `estimateComputeUnits` of `@hcm/shared`, UNVERIFIED rates) estimates the CU against a month-to-date counter (`usage/mapbox-YYYY-MM`) with a reservation per publish; over budget it offers the **free Studio upload** (tilesets uploaded in Studio are free: 20 uploads per month, 300 MB each; Claude uploads through the user's browser with consent), "defer to next month", or "pay about $X".
- At most 24 tilesets without the user's approval; frames of the same date are mosaicked into one tileset to save hosting. The count holds what will exist too: queued `layer-delete` jobs that name a tileset, first publishes under way, and the month's reservations marked `newTileset`, read in the guard's transaction (`docs/LESSONS.md` 174). At the cap only Studio is offered (waiting a month frees no place).
- **A paid call is never made twice** (`docs/LESSONS.md` 171, 172; CR-M3-47): a start whose job has an MTS job polls it; the upload is skipped when `steps.upload.sha256` is the version's COG; `steps.publish: running` is written in a transaction before the publish call, and a retry that finds it without a job id lists the tileset's jobs (`listJobs`) before publishing; every start counts `publishAttempts` (at most `PUBLISH_MAX_ATTEMPTS`); a red budget guard holds the publish before anything reaches Mapbox; the tick's recovery task id is the job's last write (`stale-<ms>`), so it is queued once per stale episode.
- **What ends a publish**: a Mapbox token or scope failure fails the job with Setup's Mapbox step as the cure (no Retry: `NOT_RETRYABLE_CODES`); a 413 on the source goes back to the admin with the verdict `too-large` and only the free Studio upload; Cancel ends a publish that has not asked Mapbox yet (`beforeMapbox`), never one Mapbox works on. `studioDone` never takes the layer's own tileset nor one created before the choice (lesson 178).

## Cost model

- Map loads: 50,000 free per month for web; the viewer creates **one map per view**, swipe compare creates the second lazily (M4). Tests never hit Mapbox (`e2e` routes `api.mapbox.com` to fixtures).
- Usage alerts are set in the Mapbox console (no API); the Setup Assistant shows them as a manual checkbox.

## Tests

- The fake Mapbox of `@hcm/test-support/fakes` and its fixtures for `tokens/v2` (retrieve, list, create, update, delete; the demo account and the billing block), `tilesets/v1` (list; `MapboxTilesetsApi.listTilesets` of `functions/src/adapters/mapbox.ts`, joining the `MapboxApi` port with its first user, the M3 publisher); M3 adds sources, recipe validate, publish, jobs; the e2e mock APIs serve TileJSON and tiles, styles, fonts, sprites and `events` (204, counted).
- Test tokens: `sk.e2e-trial`, `sk.e2e-missing-scopes`, `pk.e2e-fake-token` (not JWT-shaped).
