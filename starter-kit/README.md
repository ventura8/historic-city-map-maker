# Starter kit — Historic City Map Maker

A historical map of your city in three files and an engine: a page, `config.js` and a manifest (`data/manifest.json`), plus the Historic City Map Maker engine. No server, database or Firebase account: everything is static and runs on GitHub Pages.

The public contract (every field of `config.js` and of the manifest) is [docs/ENGINE_API.md](../docs/ENGINE_API.md).

## What is in it

| File | Role |
| --- | --- |
| `config.js` | `cityId` (equal to the manifest's `city.id`) and `manifestUrl` |
| `data/manifest.json` | The city, its photos, layers and places (City Manifest v1) |
| `data/media/<id>/web.webp`, `thumb.webp` | The photos (2048 px and 400 px, WebP without metadata) |
| `site.json` | The page's title, description and no-JavaScript note |
| `site.css` | The page frame (the map fills the window) |

The `index.html` page is generated, not hand-written: its Content Security Policy is computed from the manifest and it loads Mapbox GL JS 3.34.1 from api.mapbox.com with Subresource Integrity. In this repository `npm run build:site` writes the complete kit to `dist/site/starter-kit/`.

## Steps

1. **Copy the kit.** For a new city use the starter kit, `templates/starter-kit/` ([README](../templates/starter-kit/README.md)): three files, the engine from jsDelivr at a pinned version, or `npx create-historic-city@1.0.0-beta.1 my-city`. This kit stays the variant this repository's site build makes (`npm run build:site`, in the repository's Docker image, writes `dist/site/starter-kit/`).
2. **The Mapbox token.** In your Mapbox account, create a **public** token (`pk.…`) with the scopes `styles:read`, `styles:tiles`, `fonts:read` and restrict it to your site's address (`https://<user>.github.io`). Put it in `data/manifest.json` at `city.mapbox.publicToken`. Never use a secret token (`sk.…`): the manifest refuses it. Creating the account and the token are your own steps, in your own account.
3. **Edit the manifest.** Change `city` (id, RO/EN name, centre, bounds, zoom, About, privacy, credits, theme colour), then the `photos` list: each photo has an `id`, a title, its licence, its place (`location`), optionally the direction it looks in (`bearing`) and its images in `data/media/<id>/`. Keep `cityId` in `config.js` equal to `city.id`.
4. **Replace the example photos.** The two example photos come from the Lost Bucharest archive, are published there with permission only and may not be republished on another site: put your own photos in their place.
5. **Turn on GitHub Pages.** In the repository: Settings → Pages → Source: "GitHub Actions" (or deploy from the main branch with the files at the root). After the first push the map is at `https://<user>.github.io/<repository>/`.
6. **Check it.** If something is wrong, the page shows an error that names the exact field to fix.

## Notes

- A manifest hosted elsewhere (`manifestUrl` set to an https address) needs its origin in the page's CSP: rebuild the page after the change, the build adds it.
- The engine is copied next to the page (`engine/`). The starter kit's template (`templates/starter-kit/`) loads it from jsDelivr instead, at a pinned version with `integrity`.
- No cookies and no analytics unless the manifest has a GA4 measurement id and the visitor accepts; Mapbox sees each visitor's IP address (say so in your privacy text).
