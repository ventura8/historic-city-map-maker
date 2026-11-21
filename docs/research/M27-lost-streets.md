# M27: Disappeared streets (Străzi dispărute)

Written 2026-11-13 on `track/lostreets`. The owner asked for a layer of the streets Bucharest had and lost, like the
one on fostulbucuresti, **rebuilt from open data and our own georeferenced maps**. fostulbucuresti's repository has no
licence (all rights reserved): its data is never fetched, copied or embedded; its public site is a visual reference only
(`AGENTS.md`, DECISIONS §151).

## 1. What a disappeared street is

No new entity: a street is a **point of interest** (`pois[]`) with a `LineString` geometry in a POI category the city
owner names (Bucharest: **Străzi dispărute** / **Disappeared streets**, icon `add_road`). Everything the POIs already
have serves it: the line in the category colour over a white casing, the label from zoom 16, the timeline filter
(`yearStart`, `yearEnd`), the detail sheet, the admin's editor with drawing, the GeoJSON import and export, the history
and the static manifest the public viewer reads (it never reads Firestore). Each street has:

| What the owner asked for | Where it is |
| --- | --- |
| a line | `geometry` (`LineString`, 2 to 500 positions) |
| its historical name or names | `title` (the name), `description` ("Alte nume: …" / "Other names: …") |
| the years it existed | `yearStart`, `yearEnd` (either may be absent), or only `yearSeen` when the street is proved on a plan of one year with no known start/end |
| its source | `links` (the dataset's record: an OpenHistoricalMap way, an OSM way, a Wikidata item), `sourceLayer` (the id of the city's layer it was traced on) and the category's `attribution` |

## 2. What M27 added

Additive within manifest v1 (every field optional, so an older manifest reads as before; `docs/ENGINE_API.md`):

- `poiCategories[].defaultVisible` (false: the overlay starts hidden), `.pinned` (listed in the Layers panel's top strip)
  and `.attribution` (the data's credit, at most 500 characters). Firestore: `poiCategoryDocSchema` and the rules'
  `validCategory`; the admin's category editor has a group **În panoul Straturi** / **In the Layers panel** with two
  switches (**Arată pe hartă la deschidere**, **Fixează sus în panoul Straturi**) and the **Sursa datelor** field (an
  emptied credit is removed, never saved blank).
- `pois[].sourceLayer`: a layer id of the same manifest (`validation.reference` otherwise). The manifest builder
  (`functions/src/publish/assemble.ts`) drops a `sourceLayer` whose layer it does not list (unpublished, retired), never
  the street.
- **The pinned strip** (`packages/ui/src/viewer/hcm-layer-panel.ts`, `layer-panel-model.ts`): the Layers panel already
  pinned Compare and the Map labels group at its top (2026-11-10). A pinned category is listed in that strip, **directly
  below the items already pinned and above every historical layer**, with its own switch and slider (a second
  `hcm-overlay-list` without a heading, in a group named **Straturi fixate sus** / **Layers pinned to the top**); the
  list below leaves it out. A pinned category alone makes the strip. Owner's requirement, 2026-11-13.
- **The sheet** (`hcm-poi-detail.ts`) lists **Surse** / **Sources**: "Se vede pe: <layer>" / "Seen on: <layer>" and the
  category's credit, as text. Visible categories' credits join the attribution lines under the list.
- **Trace a street** (the admin's place editor, `packages/admin/src/pois/trace-layers.ts`, `packages/ui/src/admin/pois/trace-field.ts`):
  the fieldset **Trasare pe o hartă veche** / **Tracing on an old map** has the select **Trasată pe harta** (None, then
  every layer of the city by year) and the slider **Opacitatea hărții vechi** / **Old map opacity**. Choosing a layer sets
  `sourceLayer` and draws that layer's tiles under the drawing tools, over the Standard basemap (today's streets
  beside, never Mapbox Satellite): the owner draws the line (or adds vertices at the map centre, the keyboard way),
  names it, gives its years and saves. A place naming a layer the city no longer has says so, with the fix.

## 3. Open sources

`pipeline/src/hcm_pipeline/lost_streets.py` (`python -m hcm_pipeline.lost_streets --bounds W,S,E,N --out <file>`, in
the quality image from `pipeline/` with `PYTHONPATH=src`) fetches three open sources with the User-Agent
`HistoricCityMapMaker/1.0 (https://github.com/ventura8/historic-city-map-maker)` and no personal data, merges the ways of
one name that touch end to end, thins each line to at most 500 positions, and writes a FeatureCollection in the admin's
POI import format (category `lost-streets`, `published: true`) with a top-level `sources` member (name, address,
licence, attribution, counts) that the import ignores.

| Source | Query | Licence and credit | Bucharest, 2026-11-13 |
| --- | --- | --- | --- |
| OpenHistoricalMap (Overpass `overpass-api.openhistoricalmap.org`) | `way["highway"]["end_date"]` in the bounds, named ways | CC0; "OpenHistoricalMap contributors (CC0)" | 307 ways, 235 named, **211 streets** (192 names) |
| OpenStreetMap (Overpass `overpass-api.de`) | `demolished:`, `was:`, `razed:`, `abandoned:`, `removed:`, `destroyed:highway`, `historic=street` | ODbL; "© OpenStreetMap contributors (ODbL)" | 4 ways, all unnamed razed parking aisles: **0** |
| Wikidata (SPARQL) | P576 dissolved and P625 in the bounds, P31 a street | CC0; "Wikidata (CC0)" | **0** streets (only buildings); an item would enrich a line of the same name |

Nearly every OpenHistoricalMap street is dated 1900–1983: 1983 matches the Centrul Civic demolitions, 1900 looks like a
mapper's placeholder rather than a founding year. The owner corrects the years in the editor, street by street, against
our own plans.

The first batch is `scripts/seed/lost-streets-bucharest.geojson` (211 features). To load it into the live city:
Settings → Categories → New category **Străzi dispărute** (icon `add_road`, switch **Arată pe hartă la deschidere** off,
**Fixează sus** on, credit `OpenHistoricalMap (CC0)`), then Places → Import → the file, choosing that category for the
features, then **Update the map**.

## 3b. Streets traced on our own plans (2026-11-13)

The owner then asked for the disappeared streets that fostulbucuresti shows first. Its public map was looked at only, as
allowed: a list of 179 street **names** with a rough centre point each, in our own words, read from its labels on screen
(no data file downloaded or parsed, no geometry copied). 45 of those names were already OpenHistoricalMap streets of the
first batch. The other 134 were traced by eye on **our** georeferenced plans: each name found by its printed label on the
1939 plan (`harta-bucuresti-1939`; one, Traian, on the 1914 SOCEC plan) and its centreline digitised from the scan's pixels,
converted to positions with the tiles' own Web Mercator grid. 100 streets were traced
(`scripts/seed/lost-streets-bucharest-traced.geojson`: `sourceLayer` names the plan, `yearSeen` is that plan's year
(1939 / 1914 / 1921), the description says "Trasată pe …"; no `yearStart` / `yearEnd`, since the plan shows only that
the street existed then — `placeYearIssues` accepts `yearSeen` alone so the admin's import does not refuse them). 34 were not: no readable label on any of our plans
near the name (Vigilenței, Intr. Bateriilor, Intr. Uranus, Intrarea Vânători, Intr. Evoluției, Gheorghe Petrescu, Antim,
Intrarea Antim, Bd. G. Coșbuc, V. Adamache, I. Barasch, Măcin, Haiducul Bujor, Gh. Cristescu, Strehaia, Operetei,
C-tin Bosianu, A. Goldfaden, Asan, Cernișoara, M. Popper, Intrarea Cobzei, Intrarea Naiului, Th. Speranția, Săcărâmb,
Foișorului, Intrarea Alămarului, I. Voinescu, Gh. Județul, Vlad Județul, Electricii, Tarcău), a stretch that cannot be
told from today's street (Calea 13 Septembrie), or a label that reads as another name (Unității: the plan says "Unirei").
Precision is that of the scan: about 10–30 m. The data names no third-party site. Import: Places → Import, the same
category, after the first batch.

### Second pass (2026-11-13)

`scripts/seed/lost-streets-bucharest-traced-2.geojson` (9 places; the first file holds the same corrections, so either
import is right): new traces on the 1921 Pantea plan (Antim, Intrarea Antim, Foișorului); Nerva Traian, Logofăt Tăutu,
Vulturilor, Antim, Intrarea Antim and Foișorului trimmed to the stretch farther than 25 m from today's street of the same
name (OpenStreetMap, ODbL); three names in the plan's spelling with the list's as "Alte nume" (Dim. D. Dobrescu,
Alex. Ciurcu, Prof. P. Cumpănici). Dropped: Traian (41 m left after trimming) and Calea Vitan, Calea 13 Septembrie (their
traced stretch lies on today's street); Bd. G. Coșbuc is the first batch's Bulevardul Maria. Still not traced (28): mostly
names given after 1948, which no plan of ours prints. Our layers have nothing from 1940–1963: the closest to the 1943–44
aerial coverage are the 1939 plan and the 1964 Corona frames. Candidate source for that period: the WWII aerial
photography of the US National Archives (Record Group 373, the German-flown "GX" series and US Army Air Forces sorties; degree
square 44N026E), viewable and scannable in the Cartographic Research Room at College Park or as NCAP's licensed scans.

## 4. Our own maps

The georeferenced plans and scans (1846, 1852, 1895–1899, 1911, 1923, 1935 and the rest of the city's layers; Imagery)
are public domain or ours. Semi-automatic: the owner traces a street present on a plan and gone today with the tool
above; its `sourceLayer` names the plan. Automatic detection (a street segment on a plan with no OSM street within a
few metres) is not built: it would run as an optional worker job on the owner's computer, never in the browser (the
low-resource principle), reusing the georeferencer's OSM reference (`hcm_pipeline/osm.py`).

## 5. Tests and scenarios

V71 (viewer: pinned, hidden at start, sources), A154 (trace on a layer), A155 (the category's place in the panel); rows
in `e2e/scenarios.json`. The position test: `packages/ui/test/viewer/hcm-layer-panel.test.ts` and
`e2e/specs/viewer/lost-streets.spec.ts` (strip children `compare`, `labels`, `pinned-overlays`; the switch above the
first historical layer). Tour states `layers-lost-streets` and `lost-street` (`e2e/tour/lost-streets-states.ts`).

## 6. Addendum: `yearSeen` (2026-11-14)

Traced streets have no inventable start or end year. An optional integer `yearSeen` on the place schema
(`poiSchema`, `poiDocSchema`) holds the plan year (`harta-bucuresti-1939` → 1939, `bucuresti-harta-1914-socec` → 1914,
`1921-mihai-pantea` → 1921). `hasPlaceYear` / `placeYearIssues`, the Firestore `dated` check, the GeoJSON import and
`review.decide` treat it as a dated place; the viewer's place sheet shows `poi.yearSeen` ("Văzută pe harta din {year}" /
"Seen on the {year} map"). Both traced seed files fill `yearSeen` from `sourceLayer`.
