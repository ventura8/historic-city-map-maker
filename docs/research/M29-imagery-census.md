# M29: how many old images from above a city has, before any account

The owner's request of 2026-11-15: the very first step of a new map (the start page and Setup's first card) says how many historical satellite images exist for the chosen city: the total, how many are free and how many are paid (with the price), and a preview of the best image per decade from the sources' own browse images; before any account where possible, a labelled estimate where a source needs a login, plain words in Romanian and English, a loading state and a clear failure. Decision: `DECISIONS-for-review.md` §234.

## 1. Where the numbers come from

| Source | How | Exact? | Account |
| --- | --- | --- | --- |
| Landsat Collection 2, Level-1 (MSS, 1972-07-01 to 1981-12-31) | Microsoft Planetary Computer's public STAC API, `POST https://planetarycomputer.microsoft.com/api/stac/v1/search`, collection `landsat-c2-l1`, the city's rectangle, `eo:cloud_cover < 40` (`CENSUS_MAX_CLOUD`, the harvest's cap) | yes: ids paged by 1000 through the `next` link's body, at most `CENSUS_MAX_PAGES` (8) pages a collection, then "more than" | none |
| Landsat Collection 2, Level-2 (TM, ETM+, OLI; 1982 on) | the same, `landsat-c2-l2` | yes, as above | none |
| The best scene of each decade (1970s to 2020s) | one search a decade, `sortby eo:cloud_cover asc`, `limit 1`; the item's own `rendered_preview` | — | none |
| Declassified frames (Corona, Argon, Gambit, Hexagon; 1960–1984) | USGS M2M needs a login: **an estimate**, never shown as a count: already scanned 70–600 (`DECLASSIFIED_SCANNED`), to be scanned on request 30–400 (`DECLASSIFIED_TO_SCAN`), from Bucharest's harvests (two datasets reached the 500-scene cap); the price is `USGS_SCAN_PRICE_USD` (USD 30) a frame plus `USGS_ORDER_FEE_USD` (USD 5) an order | no | USGS (Setup's USGS step unlocks the exact count, in Imagery) |

Free = Landsat + the scanned declassified frames; paid = the frames to scan; total = both. Why Planetary Computer and not the others, checked on 2026-11-15:

- USGS LandsatLook's STAC server answers a browser's preflight with `*` but the search itself with `access-control-allow-origin: https://landsatlook.usgs.gov/stac-server`, so no other page can read it.
- Element 84's Earth Search answers `*` and counts in one request (`numberMatched`), but its Landsat previews are `s3://usgs-landsat/…` (requester pays), and it is a server-only host of the e2e world (the pipeline's Sentinel-2 reference).
- Planetary Computer answers `*` to both, and every item carries `rendered_preview`, a PNG on the same host. It returns no `numberMatched`, hence the paging (Bacău: 665 + 1,811 scenes, 3 requests, about 4 s).

Mapbox Satellite is never used. A preview is shown only when its address is on `CENSUS_ORIGIN`; any other address is dropped (`previewOf`).

## 2. The code

- `packages/shared/src/schemas/imagery-census.ts` (entry `@hcm/shared/census`): `imageryCensus(fetch, box, signal)`: ten searches at most a city, in parallel; `CensusError` with `offline` (no answer), `refused` (a non-2xx answer) or `unreadable` (an answer the schema refuses). A cancelled search rejects as the browser did.
- `packages/shared/src/i18n/census/` (`translateCensus`, `census.*`, ro and en; another language shows English).
- `packages/ui/src/census/hcm-imagery-census.ts`: `<hcm-imagery-census .box .locale usgs-link>`: waiting (no rectangle), searching (`role=status`, `aria-busy`), the counts and previews, or the failure (`role=alert`: what happened, that the map can go on without it, **Search again**). It searches `CENSUS_DEBOUNCE_MS` (500 ms) after the rectangle last changed, cancels an outdated search, and logs the reason code and the rectangle.
- The start page: `StartPagePort.censusBox()` (`censusBoxOf` of `packages/admin/src/start/form.ts`: the rectangle once it can be a city) puts the census under the rectangle on the plan screen.
- Setup: `SetupState.cityBBox` (the project's `firstCity.bounds`, the start page's rectangle) shows the census under the header until Setup is done (`setupCensus`), with **Open the USGS step**.
- The policies: `planetarycomputer.microsoft.com` in the start page's `connect-src` and `img-src` (`scripts/site/src/start/tree.ts`) and the admin's (`scripts/site/src/admin/csp.ts`, `firebase.json`).

## 3. Cost guard

No cost to the owner or the project: the catalogue is public and free, called from the visitor's browser, at most `2 × CENSUS_MAX_PAGES + 6` requests a rectangle, once per rectangle (a burst of edits searches once). Nothing is stored.

## 4. Tests

- Unit: `packages/shared/test/schemas/imagery-census.test.ts`, `packages/ui/test/census/hcm-imagery-census.test.ts`, the start form's and page's tests.
- e2e: `S-A189-HAPPY` and `S-A189-BAD-CENSUS` (`e2e/admin/specs/start/census.spec.ts`), tour states `start.census` and `start.census-failed`; the e2e world answers the catalogue host (`e2e/mock-apis/catalogue.ts`, host kind `catalogue`).
