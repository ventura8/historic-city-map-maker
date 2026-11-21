import type { Page } from '@playwright/test';

import { BASEMAP_BACKGROUND, E2E_TILESET_LAYER, E2E_TOKEN, E2E_XYZ_LAYER, type Rgb } from '../../fixtures/world.js';
import { isColour, probePixel } from '../../support/site.js';
import { expect, test } from '../../support/test.js';

/**
 * Harness (behaviour V00): Mapbox GL JS 3.34.1, loaded from "api.mapbox.com" and answered entirely by the mock APIs,
 * draws the e2e world: the minimal Standard-like basemap, a `mapbox://` tileset and an `xyz` source in the `middle`
 * slot, and a label from the generated glyphs in the `top` slot. A pixel probe reads each layer's known colour.
 * The viewer's own specs build on this; here a spec-made page drives Mapbox GL directly.
 */

const PAGE = '/__harness/map.html';
const MAP_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"><title>Map harness</title><link rel="icon" href="data:,">
<link rel="stylesheet" href="https://api.mapbox.com/mapbox-gl-js/v3.34.1/mapbox-gl.css">
<script src="https://api.mapbox.com/mapbox-gl-js/v3.34.1/mapbox-gl.js"></script>
<style>html, body, #map { margin: 0; width: 100%; height: 100%; }</style>
</head>
<body><div id="map" role="region" aria-label="Map harness"></div></body>
</html>`;

const CENTER: readonly [number, number] = [26.0853, 44.427];
/** Two probe points away from the centre, where the label is drawn. */
const PROBES: readonly (readonly [number, number])[] = [
    [360, 225],
    [1080, 675],
];

interface HarnessOptions {
    readonly token: string;
    readonly center: readonly [number, number];
    readonly tilesetId: string;
    readonly xyzTiles: string;
}

/** Runs in the page: creates the map, adds both rasters (hidden) and a label, resolves when it is idle. */
function createHarnessMap(options: HarnessOptions): Promise<void> {
    const gl = (window as unknown as { mapboxgl: Record<string, unknown> }).mapboxgl;
    const MapClass = gl['Map'] as new (options: Record<string, unknown>) => Record<string, (...args: unknown[]) => unknown>;
    const map = new MapClass({
        container: 'map',
        accessToken: options.token,
        style: 'mapbox://styles/mapbox/standard-satellite',
        center: options.center,
        zoom: 14,
        performanceMetricsCollection: false,
        fadeDuration: 0,
    });
    (window as unknown as Record<string, unknown>)['harnessMap'] = map;
    return new Promise((resolve) => {
        map['once']?.('load', () => {
            map['addSource']?.('tileset', { type: 'raster', url: `mapbox://${options.tilesetId}`, tileSize: 256 });
            map['addSource']?.('xyz', { type: 'raster', tiles: [options.xyzTiles], tileSize: 256 });
            map['addLayer']?.({ id: 'tileset', type: 'raster', source: 'tileset', slot: 'middle', layout: { visibility: 'none' } });
            map['addLayer']?.({ id: 'xyz', type: 'raster', source: 'xyz', slot: 'middle', layout: { visibility: 'none' } });
            map['addSource']?.('label', { type: 'geojson', data: { type: 'Point', coordinates: options.center } });
            map['addLayer']?.({ id: 'label', type: 'symbol', source: 'label', slot: 'top', layout: { 'text-field': 'E2E 1966' } });
            map['once']?.('idle', () => {
                resolve();
            });
        });
    });
}

/** Runs in the page: shows exactly one raster (or none) and resolves when the map is idle again. */
function showOnly(visible: string | null): Promise<string[]> {
    const map = (window as unknown as Record<string, Record<string, (...args: unknown[]) => unknown>>)['harnessMap'];
    return new Promise((resolve) => {
        for (const id of ['tileset', 'xyz']) {
            map?.['setLayoutProperty']?.(id, 'visibility', id === visible ? 'visible' : 'none');
        }
        map?.['once']?.('idle', () => {
            resolve(['tileset', 'xyz', 'label'].map((id) => String(map['getSlot']?.(id))));
        });
        map?.['triggerRepaint']?.();
    });
}

async function expectProbes(page: Page, colour: Rgb): Promise<void> {
    for (const [x, y] of PROBES) {
        const seen = await probePixel(page, x, y);
        expect(isColour(seen, colour), `pixel (${String(x)}, ${String(y)}) is ${seen.join(',')}, expected ${colour.join(',')}`).toBe(true);
    }
}

test.beforeEach(async ({ page }) => {
    await page.route(PAGE, (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: MAP_HTML }));
});

test(
    'Mapbox GL from the mock APIs draws a mapbox:// tileset and an XYZ layer in the middle slot',
    { tag: '@S-V00-HAPPY-MOCK-MAP' },
    async ({ page, mockApis, instrumentation }) => {
        await page.goto(PAGE);
        await page.evaluate(createHarnessMap, {
            token: E2E_TOKEN,
            center: CENTER,
            tilesetId: E2E_TILESET_LAYER.tilesetId,
            xyzTiles: E2E_XYZ_LAYER.tiles,
        });

        expect(await page.evaluate(showOnly, null)).toEqual(['middle', 'middle', 'top']);
        await expectProbes(page, BASEMAP_BACKGROUND);
        await page.evaluate(showOnly, 'tileset');
        await expectProbes(page, E2E_TILESET_LAYER.colour);
        await page.evaluate(showOnly, 'xyz');
        await expectProbes(page, E2E_XYZ_LAYER.colour);

        expect((await instrumentation.read(page)).mapsCreated).toBe(1);
        await expect.poll(() => mockApis.mapLoadEvents()).toBe(1);
        const calls = await mockApis.calls();
        expect(calls.filter((call) => call.status >= 400).map((call) => `${String(call.status)} ${call.host}${call.path}`)).toEqual([]);
        const answered = calls.filter((call) => call.status === 200).map((call) => `${call.host}${call.path}`);
        expect(answered).toEqual(
            expect.arrayContaining([
                'api.mapbox.com/mapbox-gl-js/v3.34.1/mapbox-gl.js',
                'api.mapbox.com/styles/v1/mapbox/standard-satellite',
                `api.mapbox.com/v4/${E2E_TILESET_LAYER.tilesetId}.json`,
                expect.stringMatching(/^api\.mapbox\.com\/fonts\/v1\/mapbox\/.+\/0-255\.pbf$/),
                expect.stringMatching(new RegExp(`^api\\.mapbox\\.com/v4/${E2E_TILESET_LAYER.tilesetId}/\\d+/\\d+/\\d+\\.webp$`)),
                expect.stringMatching(/^tiles\.e2e\.test\/xyz\/e2e-1980\/\d+\/\d+\/\d+\.png$/),
            ]),
        );
    },
);

test(
    'A Mapbox path the mock does not implement answers 404 and is recorded',
    { tag: '@S-V00-BAD-UNMOCKED-PATH' },
    async ({ page, mockApis, consoleErrors }) => {
        await page.goto(PAGE);

        const status = await page.evaluate(async () => (await fetch('https://api.mapbox.com/search/geocode/v6/forward?q=Uranus')).status);

        expect(status).toBe(404);
        expect(await mockApis.calls('api.mapbox.com')).toEqual(
            expect.arrayContaining([expect.objectContaining({ path: '/search/geocode/v6/forward', query: '?q=Uranus', status: 404 })]),
        );
        expect(consoleErrors.take()).toEqual([expect.stringContaining('404')]);
    },
);
