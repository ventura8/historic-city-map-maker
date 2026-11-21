# create-historic-city

A historical map of your city: old photos, vanished places and maps of the past over today's map, with the Historic City Map Maker engine.

```bash
npx create-historic-city@1.0.0-beta.1 my-city
```

It asks for the city's name (in Romanian), its rectangle on the map (`west,south,east,north`; on openstreetmap.org, the Export button shows them), the theme's colour and the Mapbox public token (Enter keeps the default), then writes three files into a new folder: `index.html` (the engine from jsDelivr, at a pinned version with an integrity check), `city.json` (the city, its places, photos and layers) and `README.md` (the steps: the Mapbox public token, editing, GitHub Pages). No server needed.

With a Firebase project of your own and the admin app (the Setup Assistant, the editors, the USGS historical imagery): `npx create-historic-city@1.0.0-beta.1 self-host my-city --project <id>`, after the first command. The steps are in `docs/SELF_HOST.md`.

```bash
npx create-historic-city@1.0.0-beta.1 self-host my-city --project <id> --experimental
```

Each step says what it does and what it costs and asks `y/N`; it runs only your own tools (`firebase`, optionally `gcloud`) and opens the Google pages where you sign in, accept the terms and link billing. It never asks for, writes or shows a password, a secret token or payment details, and it contacts no server by itself. `--dry-run` shows everything and does nothing. Other commands: `theme` (the map's colours from one colour), `deploy`, `upgrade`, `doctor`, `--help`.

The full guide: [docs/SELF_HOST.md](https://github.com/ventura8/historic-city-map-maker/blob/master/docs/SELF_HOST.md). The engine's contract: [docs/ENGINE_API.md](https://github.com/ventura8/historic-city-map-maker/blob/master/docs/ENGINE_API.md).
