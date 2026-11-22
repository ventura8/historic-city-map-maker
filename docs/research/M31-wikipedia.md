# M31: The Wikipedia overlay

Written 2026-11-22 on `feat/wikipedia-layer`. The owner asked for it on 2026-11-09 and again on 2026-11-22 ("implement
wikipedia layer already"); the request is `reports/PLAN-live.md` → *Wikipedia layer* and item V3. Scenarios: V90 (the
viewer) and A230 (the server and the admin) in `e2e/scenarios.json`.

## 1. What the visitor sees

- An overlay **Wikipedia** in Layers, below the city's place categories, with its own switch and opacity slider. It is
  off when the map opens and does not follow the timeline: the articles have no years, so every stop shows them.
- One icon (`info`, on a dark grey disc) per geotagged article in the city's bounds, from the Romanian and the English
  Wikipedia. An article read on both is one icon.
- A click opens the detail sheet: the title and the first sentences in the visitor's language when the article has that
  version (Romanian or English), else the other one; the article's picture when Wikipedia marks
  it free; one link, **Citește pe Wikipedia** / **Read on Wikipedia**, to the version shown; and the credit
  **Sursa: Wikipedia (CC BY-SA 4.0)**, also listed under Layers while the overlay is on.
- Everything is text: the extract is escaped for the Markdown subset (`literalMarkdown`), nothing is rendered as HTML.
- If the file cannot be loaded, the overlay switches itself off and a toast says the articles did not load, probably the
  connection, and to switch Wikipedia on again in Layers (`wikipedia.loadFailed`, in the sixteen viewer languages).

## 2. Built on the server, never in the visitor's browser

Visitors make no request to Wikipedia (privacy, and Wikipedia's load), and the viewer reads no Firestore.

- **Where it runs.** Inside the manifest build (`functions/src/wikipedia/refresh.ts`, called by
  `functions/src/publish/build-manifest.ts`): when the city has the overlay on and its last fetch is older than
  `WIKIPEDIA_REFRESH_DAYS` (7) or the admin asked for one, it fetches; then it writes `cities/<city>/wikipedia.json` beside
  the manifest (gzip, `max-age=60`) without the hidden articles, and the manifest gets the category `wikipedia` and
  `wikipedia: {file, count, generatedAt}` (`withWikipedia`). Off, or with no article, the file is removed and the manifest
  has neither. The schedule is a part of the imagery tick (`functions/src/wikipedia/tick.ts`): a city whose fetch is due
  gets a manifest build, which fetches. The build is the only place that asks Wikipedia.
- **What it asks** (`functions/src/adapters/wikipedia.ts`, port `WikipediaApi`): `list=geosearch` over cells of the
  city's bounds (0.08° × 0.1°, at most 36 cells, nearest the centre first, within geosearch's largest box), then
  `prop=extracts|info|pageimages|langlinks` 20 pages at a time (the intro's first two sentences as plain text, the page's
  address, the page image only with `pilicense=free`, the title on the other Wikipedia), then each free thumbnail
  (320 px, `upload.wikimedia.org` only, at most 400 KB, at most 150 a fetch), copied to `cities/<city>/wikipedia/<id>.<ext>`.
- **Politely.** The generic User-Agent `HistoricCityMapMaker/1.0 (https://github.com/ventura8/historic-city-map-maker)`
  (no person's address), anonymous, one request at a time with at least 250 ms between two, `maxlag=5`. A `maxlag` answer
  or HTTP 429 is `rateLimited`, 5xx or the network `unavailable`, anything else `invalid`.
- **Cached.** The state document `cities/<city>/wikipedia/state` (`wikipediaStateDocSchema`, functions only: the rules
  deny every client) keeps the settings and every article of the last fetch, the hidden ones too, so hiding an article
  rewrites the file without asking Wikipedia. At most 400 articles (the nearest the centre), extracts within 300 characters.
- **Failure.** A failed fetch records why (`failure`) and keeps the articles and the file of the fetch before; any error
  of the overlay is logged and the manifest goes out without it. Wikipedia never fails a build.

## 3. The admin

Settings → **Wikipedia** (`packages/ui/src/admin/settings/wikipedia-section.ts`, a chunk of its own; the store's part
`packages/admin/src/settings/wikipedia.ts`), through the one callable `wikipedia.manage` (a city editor):

- `get`: the settings (off, Romanian and English, nothing hidden before the first save) and the last fetch's articles,
  its time and its failure;
- `save`: the switch, the languages (Romanian, English; never none) and the hidden articles; other languages ask for a
  fetch; the manifest is rebuilt;
- `refresh` (**Actualizează acum** / **Refresh now**): a fetch at the build it asks for, whatever the cache's age.

The card says when the articles were fetched, that a fetch waits for the rebuild, or why the last one failed and when to
press Refresh now again; each article has **Ascunde** / **Hide** (or **Arată** / **Show**), named with its title.

## 4. The viewer

- `manifest.wikipedia` (`wikipediaRefSchema`) tells the engine the file exists; `docs/ENGINE_API.md` → *`wikipedia`*.
- `packages/engine/src/core/wikipedia.ts` follows the state: the first time the overlay is visible (its switch, or a
  shared link), it loads the file through the lazy chunk `packages/engine/src/wikipedia/wikipedia.ts` (an extra of its
  own, `extra-wikipedia-<hash>.js`; it fetches without cookies and checks `wikipediaFileSchema`), and puts the articles in
  `state.wikipedia`. An answer for an older manifest is dropped.
- `packages/engine/src/core/map-specs.ts` (`withArticles`) adds the articles to the places the map draws, as POIs of the
  category `wikipedia` with ids `wikipedia-<article id>` (`wikipediaPois` of `@hcm/shared`); the store opens them like any
  place. `packages/ui/src/viewer/viewer-selection.ts` gives the detail sheet the article as a place with its thumbnail.

## 5. Not done

- No other languages than Romanian and English (the places' texts are bilingual); a third would need the POI title to
  carry more languages.
- No popularity ranking: the nearest 400 articles to the centre are kept.
- The static export does not copy `wikipedia.json`: an exported map shows the overlay's switch only when the file is
  copied by hand beside the manifest.
