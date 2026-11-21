# My city's historical map

A historical map of your city in three files: old photos, vanished places and maps of the past over today's map. No server, database or Firebase account: everything is static and runs on GitHub Pages or any static host. The map engine (Historic City Map Maker) loads from jsDelivr, at a pinned version and with an integrity check.

## What is in it

| File | Role |
| --- | --- |
| `index.html` | The page: its Content Security Policy, Mapbox GL JS 3.34.1 and the engine from jsDelivr, each with `integrity` |
| `city.json` | The city, its places, photos and layers (City Manifest v1) |
| `README.md` | This file |

## Steps

1. **Copy the three files** into a new repository (on GitHub: "Use this template"), or run `npx create-historic-city@1.0.0-beta.1 my-city`, which asks for the city's name, its rectangle on the map (`west,south,east,north` in degrees: on openstreetmap.org, the Export button shows them for the area on screen), the theme's colour and the Mapbox token (Enter keeps each default).
2. **The Mapbox token.** In your Mapbox account (creating the account and the token are your own steps) make a **public** token (`pk.…`) with the scopes `styles:read`, `styles:tiles` and `fonts:read`, and restrict it to your site's address (`https://<user>.github.io`). Put it in `city.json` at `city.mapbox.publicToken`, in place of `pk.replace-with-your-token`. Never use a secret token (`sk.…`): the manifest refuses it, and anyone could read it from the page.
3. **Edit `city.json`.** Change `city`: the id, the Romanian and English names, the centre, the bounds (`bounds`, `[[west, south], [east, north]]`), the zooms, the About text, the privacy text and the credits. Replace the example places (`poiCategories`, `pois`: a point, a line and an area) with your own. **The colours:** the map reads the four schemes of `city.theme.tokens`, not `seedColor` alone, so do not change them by hand: `npx create-historic-city@1.0.0-beta.1 theme . --seed '#1b6c4a'` makes them all from one colour (and the page's colour in `index.html`).
4. **The photos.** Each photo of the `photos` list has an `id`, a title, its licence (`CC0`, `CC-BY-4.0`, `CC-BY-SA-4.0`, `PD` or `permission`), its links (`links`, a list, possibly empty), its place (`location`), optionally the direction it looks in (`bearing`, degrees from north) and `image`: two WebP images without metadata next to `city.json`, `photos/<id>/web.webp` (2048 px on the long edge) and `photos/<id>/thumb.webp` (400 px), with the large one's width and height (`w`, `h`). An example (the English title is optional), to put between the brackets of `"photos": []`:

   ```json
   {
       "id": "old-square-1936",
       "title": { "ro": "Piața veche, 1936", "en": "The old square, 1936" },
       "year": 1936,
       "author": "Ion Popescu",
       "license": "CC-BY-4.0",
       "links": [{ "url": "https://example.org/archive/123", "label": "The city archive" }],
       "location": { "lat": 44.4268, "lng": 26.1025 },
       "bearing": 90,
       "image": { "web": "photos/old-square-1936/web.webp", "thumb": "photos/old-square-1936/thumb.webp", "w": 2048, "h": 1365 }
   }
   ```

   Publish only photos you have the right to publish.
5. **The historical layers** (`layers`): a Mapbox tileset of your own account or an `xyz` source; the address of a source on another server also goes into the CSP of `index.html` (`img-src` and `connect-src`).
6. **Turn on GitHub Pages.** In the repository: Settings → Pages → Source: "Deploy from a branch", the main branch, the root folder (`/`). After the first push the map is at `https://<user>.github.io/<repository>/`.
7. **Check it.** If something in `city.json` is wrong, the page shows an error that names the exact field to fix. If the "The map is loading" text stays on screen, the engine could not load: the version or the `integrity` value in `index.html` does not match (use the values of the version's `release.json`, below).
8. **Update the engine.** Every version has a `release.json` (on the version's GitHub release page and at `https://cdn.jsdelivr.net/gh/ventura8/historic-city-map-maker@v<version>/cdn/engine/release.json`) with the addresses and `integrity` values. The easiest: `npx create-historic-city@<version> upgrade`, which rewrites only the engine block of `index.html` (the sources you added to the CSP stay).

**Locally:** serve the folder with any static server (for example `npx serve .` or `python3 -m http.server`) and open its address. Opened straight from the file (`file://`), the page can read neither `city.json` nor its language's texts (`engine/i18n/`).

**Privacy:** the map sets no cookies without the visitor's consent (Google Analytics statistics only when `city.json` has a measurement id and the visitor accepts). Mapbox sees each visitor's IP address: say so in the privacy text.

The public contract of `city.json`, the page and the engine: [Engine API v1](https://github.com/ventura8/historic-city-map-maker/blob/master/docs/ENGINE_API.md).
