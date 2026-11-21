import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { validateManifest, type Manifest } from '@hcm/shared';

import { E2E_CITY_ID, E2E_ERROR_ENDPOINT, E2E_MEASUREMENT_ID, E2E_SITE_DIR, E2E_TILESET_LAYER, E2E_TOKEN, E2E_XYZ_LAYER } from './world.js';

/**
 * The e2e fixture manifest (docs/research/M1-interfaces.md §10), assembled from committed inputs and validated with
 * `validateManifest` before anything is served, so an invalid fixture fails the build and the `setup` project, never
 * a scenario:
 *
 * 1. the migrated Bucharest manifest `seed/bucharest/manifest.static.json` (45 photos, its derived images), its city named
 *    as the site names it (`E2E_CITY_ID`);
 * 2. the two synthetic raster layers of `world.ts`: a `mapbox://` tileset and an `xyz` source, both painted by the
 *    mock APIs in solid colours;
 * 3. the POI fixture set `scripts/seed/e2e-pois.json` (photos overlay default, three categories, four POIs);
 * 4. the crash-report endpoint on the e2e telemetry host, and the e2e Mapbox token.
 *
 * A bad-path spec serves a changed copy of the manifest the built site serves (`siteManifestData`: the fixture with
 * the site build's `media/` image paths) through `page.route` on the site's data/manifest.json; `{ pois: false }` is
 * the seed without POIs (S-V24-BAD-NO-POIS), `{ layers: false }` Bucharest today (no historical layers),
 * `{ analytics: true }` adds a GA4 measurement id (the consent banner, V19).
 */

const ROOT = resolve(import.meta.dirname, '../..');

export interface FixtureOptions {
    /** The two synthetic raster layers (default true). */
    readonly layers?: boolean;
    /** `scripts/seed/e2e-pois.json` (default true). */
    readonly pois?: boolean;
    /** A GA4 measurement id, so the viewer asks for analytics consent (default false). */
    readonly analytics?: boolean;
}

export type Json = Record<string, unknown>;

function readJson(path: string): Json {
    return JSON.parse(readFileSync(join(ROOT, path), 'utf8')) as Json;
}

function fixtureLayers(): Json[] {
    const common = { minzoom: 0, maxzoom: 22, defaultVisible: false };
    return [
        {
            ...common,
            id: E2E_TILESET_LAYER.id,
            year: E2E_TILESET_LAYER.year,
            label: { ro: 'Corona 1966 (e2e)', en: 'Corona 1966 (e2e)' },
            kind: 'satellite',
            sensor: 'KH-4A (e2e)',
            attribution: 'USGS (e2e)',
            source: { type: 'mapbox', tilesetId: E2E_TILESET_LAYER.tilesetId },
            order: 1,
            opacity: 1,
        },
        {
            ...common,
            id: E2E_XYZ_LAYER.id,
            year: E2E_XYZ_LAYER.year,
            label: { ro: 'Fotografie aeriană 1980 (e2e)', en: 'Aerial photo 1980 (e2e)' },
            kind: 'aerial',
            attribution: 'Arhivă (e2e)',
            source: { type: 'xyz', tiles: [E2E_XYZ_LAYER.tiles], tileSize: 256 },
            order: 2,
            opacity: 0.8,
        },
    ];
}

/** The fixture manifest as plain JSON data, not yet validated (bad-path specs break a copy of it). */
function fixtureManifestData(options: FixtureOptions = {}): Json {
    const seed = readJson('seed/bucharest/manifest.static.json');
    const city = seed['city'] as Json;
    const analytics =
        options.analytics === true
            ? { measurementId: E2E_MEASUREMENT_ID, errorEndpoint: E2E_ERROR_ENDPOINT }
            : { errorEndpoint: E2E_ERROR_ENDPOINT };
    return {
        ...seed,
        city: { ...city, id: E2E_CITY_ID, mapbox: { publicToken: E2E_TOKEN }, analytics },
        layers: options.layers === false ? [] : fixtureLayers(),
        ...(options.pois === false ? {} : readJson('scripts/seed/e2e-pois.json')),
    };
}

/** The validated fixture manifest; throws with every issue when a committed input stopped being valid. */
export function buildFixtureManifest(options: FixtureOptions = {}): Manifest {
    const result = validateManifest(fixtureManifestData(options));
    if (!result.ok) {
        const issues = result.issues.map((issue) => `${issue.path} ${issue.code}`).join('; ');
        throw new Error(`the e2e fixture manifest is invalid: ${issues}`);
    }
    return result.value;
}

/**
 * The manifest the built Bucharest site serves (`npm run build:site:e2e` writes it, with the photos under
 * `data/media/`), as plain JSON a spec may change and serve again; the options remove the layers or the POIs, or add
 * the GA4 measurement id, as for `buildFixtureManifest`.
 */
export function siteManifestData(options: FixtureOptions = {}): Json {
    const served = JSON.parse(readFileSync(join(ROOT, E2E_SITE_DIR, 'bucharest/data/manifest.json'), 'utf8')) as Json;
    const city = served['city'] as Json;
    const analytics = { ...(city['analytics'] as Json), ...(options.analytics === true ? { measurementId: E2E_MEASUREMENT_ID } : {}) };
    const { photosOverlay, poiCategories, pois, ...withoutPois } = served;
    const places = options.pois === false ? {} : { photosOverlay, poiCategories, pois };
    return { ...withoutPois, ...places, city: { ...city, analytics }, layers: options.layers === false ? [] : served['layers'] };
}

/**
 * The site's manifest with both layers in 1980 (V68, the timeline's date picker): the tileset dated 14 March and named
 * `Corona (e2e)`, the xyz one dated 2 August and opaque, so a probe tells which is on top.
 */
export function twoDatesOf1980(): Json {
    const manifest = siteManifestData();
    const [tileset, xyz] = manifest['layers'] as [Json, Json];
    Object.assign(tileset, { year: 1980, date: '1980-03-14', label: { ro: 'Corona (e2e)', en: 'Corona (e2e)' } });
    Object.assign(xyz, { date: '1980-08-02', opacity: 1 });
    return manifest;
}
