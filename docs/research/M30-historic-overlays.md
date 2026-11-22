# M30: Historic overlays from open data (Bucharest)

Written 2026-11-21. The owner asked for the overlays another Bucharest map shows and ours lacked: old river courses, the
Great Fire of 1847, the buildings that collapsed in the 1977 earthquake, the 1977–1989 demolitions, today's buildings of
seismic risk class I and the railways, current and vanished. All of it is **rebuilt from open data or our own plans**;
nothing is fetched, copied or embedded from that other map or from fostulbucuresti (`AGENTS.md`, DECISIONS §151).

## 1. No engine change

The engine already draws everything these overlays need. A POI category (`poiCategories[]`) is an overlay with its own
switch, slider, colour, icon, credit (`attribution`), `defaultVisible` and `pinned` (M27,
`docs/research/M27-lost-streets.md`); a place (`pois[]`) may be a `Point`, a `LineString` or a `Polygon` (lines over a
white casing, areas filled at 35 %; `docs/ENGINE_API.md` → *POIs*), with `yearStart` / `yearEnd` for the timeline and
`links` to its record. So each overlay is one category and its places, loaded through the admin's place import, the same
route as the disappeared streets. No generic vector overlay was added.

## 2. What landed (`scripts/seed/`)

Each file is a FeatureCollection in the admin's import format with a top-level `sources` member (name, address,
licence, credit, counts) the import ignores. `packages/shared/test/seed/historic-overlays.test.ts` merges them into the
migrated Bucharest manifest and validates them, and refuses a feature outside its category or a source without an open
licence.

| File | Category id (suggested label, icon) | Features | Source, licence |
| --- | --- | --- | --- |
| `railways-bucharest.geojson` | `railways` (**Căi ferate** / **Railways**, `train`) | 215: 45 lines in use, 130 disused, 33 abandoned, 7 removed | OpenStreetMap via Overpass, ODbL ("© OpenStreetMap contributors (ODbL)") |
| `old-rivers-bucharest.geojson` | `old-rivers` (**Cursuri vechi ale râurilor** / **Old river courses**, `water`) | 9: the Dâmbovița's bed before the 1980s channel (1 line, 8 water areas, ending 1983) | OpenHistoricalMap via Overpass, CC0 |
| `demolitions-1977-1989-bucharest.geojson` | `demolitions-1977-1989` (**Demolări 1977–1989** / **Demolitions 1977–1989**, `domain_disabled`) | 253: 249 block areas dissolved from 5,214 OHM buildings ending 1977–1989, 4 Wikidata buildings demolished 1984–1986 (Văcărești Monastery, Brâncovenesc Hospital, Teatrul Regina Maria, Cahal Cicu synagogue) | OpenHistoricalMap, CC0; Wikidata, CC0 |

Queries (bounds `25.93,44.33,26.25,44.55`, User-Agent `HistoricCityMapMaker/1.0` with the repository address):

- Railways: OSM ways `railway` in `rail|light_rail|narrow_gauge|abandoned|razed|disused|dismantled|preserved` plus the
  `abandoned:`, `razed:`, `disused:railway` lifecycle keys. Yards, sidings, spurs and crossovers of live lines are
  dropped, ways of one kind and name are joined end to end, pieces under about 300 m (live) or 100 m (gone) dropped.
- Rivers: OHM `waterway` and `natural=water` ways with an `end_date`; OHM's `start_date=1900` is its placeholder (M27
  §3) and is not kept.
- Demolitions: OHM `building` ways and relations ending 1977–1989, buffered 6 m and back so a block's buildings become one
  area; Wikidata items with P576 in those years and coordinates in the bounds (a dissolved institution is left out).
  Nearly all OHM buildings carry `end_date=1983`, a single date for the Centrul Civic clearance, so each area ends 1989
  on the timeline rather than claiming a year per building.

To load one into the live city: Settings → Categories → New category with the id, label and icon above, switch **Arată
pe hartă la deschidere** off and the source's credit in **Sursa datelor**; then Places → Import → the file, choosing that
category; then **Update the map**.

## 3. Not done yet, and why

| Overlay | What blocks it | The way forward |
| --- | --- | --- |
| Colentina's old course; the Dâmbovița before the 1880s works | OHM and OSM hold no dated earlier course | Trace by eye on our 1846, 1852, 1864 and 1871 plans with the place editor's **Trasare pe o hartă veche** (M27 §2), a Claude subagent in Chrome |
| The Great Fire of 1847 | No open dataset has its outline | Trace the burnt area as a `Polygon` on our 1846 plan, from the written accounts' bounding streets |
| 1977 collapsed buildings | No open dataset or Wikidata item holds their positions; the English Wikipedia article names about ten (Scala, Dunărea, Casata, Continental-Colonade, Nestor, Lizeanu, OD16 Militari, the Ministry of Metallurgy, the Faculty of Chemistry, the Computer Centre) without coordinates | Place each by eye on our 1978 layer, with the article as the link |
| Seismic risk class I | The AMCCRS list (`amccrs-pmb.ro/lista-imobile-2/`) is served by a table endpoint the agent's tool permissions refused to call | The owner allows the fetch, or saves the list; then geocode with Nominatim at one request per second, cached |

The fetch-and-build scripts are one-offs and live outside the repository; a reusable importer belongs beside
`pipeline/src/hcm_pipeline/lost_streets.py` once a second city wants these overlays.

**Demolitions rebuilt (2026-11-22).** The first build dissolved the buildings into 17 areas; the two largest held hundreds of
courtyards and streets as holes, and the schema keeps at most 19 holes and 500 positions a polygon, so the build kept the
outer ring and 19 holes and the map drew whole districts (Lipscani to Decebal) solid red; 828dcc15 only removed crossing
vertices, the shapes were the same. The areas are now cut in halves until each fits the schema (at most 19 holes, 480
positions), simplified to 1 m, every ring valid, outer rings counter-clockwise and holes clockwise (RFC 7946): 249 blocks,
none wider than about 450 m. `packages/shared/test/seed/historic-overlays.test.ts` refuses an area wider than 1.5 km. In
the live city the 17 old areas were deleted (History → Deleted can restore them) and the 249 imported.

