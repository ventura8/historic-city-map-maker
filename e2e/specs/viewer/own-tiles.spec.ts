import type { Locale } from '@hcm/shared';

import { siteManifestData, type Json } from '../../fixtures/manifest.js';
import { BASEMAP_BACKGROUND, E2E_TILE_HOST, type Rgb } from '../../fixtures/world.js';
import { expectColourAt, mapFraction } from '../../support/map.js';
import { archiveAt, serveArchive, solidArchive } from '../../support/pmtiles.js';
import { sitePath } from '../../support/site.js';
import { expect, test } from '../../support/test.js';
import { openViewer, serveManifest, t, viewer, waitForEngineEvent } from '../../support/viewer.js';

/**
 * A layer's tiles from one archive of the project's own bucket (behaviour V32, docs/research/M12-own-tiles.md): the real Mapbox GL JS draws
 * them through its custom source over the basemap, no tileset and no compute units; every read is a `Range`, so no preflight and no
 * whole file; a tile the archive leaves out is answered from its directory; a server without `Range` fails the layer, never the map.
 */
const OWN = { id: 'e2e-own', label: 'Arhiva proprie (e2e)' } as const;
const ARCHIVE_URL = `https://${E2E_TILE_HOST}/own/e2e-own.pmtiles`;
const COLOUR: Rgb = [40, 160, 90];
const HERE = { lat: 44.37, lng: 25.97 } as const;
/** Far enough north that the archive, around `HERE`, has no tile, and still inside the city. */
const HOLE = { lat: 44.5, lng: 25.97 } as const;
const VIEW = `15/${HERE.lat.toFixed(5)}/${HERE.lng.toFixed(5)}&layers=${OWN.id}`;

function withOwnLayer(): Json {
    const manifest = siteManifestData();
    const layers = manifest['layers'] as Json[];
    layers.push({
        ...layers[0],
        id: OWN.id,
        year: 1972,
        label: { ro: OWN.label, en: OWN.label },
        source: { type: 'pmtiles', url: ARCHIVE_URL },
        attribution: 'USGS EROS (e2e)',
        minzoom: 10,
        maxzoom: 17,
        order: 3,
    });
    return manifest;
}

function archive(): Promise<Buffer> {
    return solidArchive({
        colour: COLOUR,
        bounds: [HERE.lng - 0.02, HERE.lat - 0.02, HERE.lng + 0.02, HERE.lat + 0.02],
        minzoom: 10,
        maxzoom: 17,
    });
}

async function openOwn(page: Parameters<typeof openViewer>[0], lang: Locale, hash: string): Promise<void> {
    await serveManifest(page, withOwnLayer());
    await openViewer(page, { lang, hash });
}

test(
    "A layer in the project's own bucket shows its tiles over the basemap, read by range, with its attribution",
    { tag: '@S-V32-HAPPY-OWN-TILES' },
    async ({ page, lang, mockApis }) => {
        const reads = await serveArchive(page, ARCHIVE_URL, await archive());

        await openOwn(page, lang, VIEW);

        await expectColourAt(page, await mapFraction(page, 0.5, 0.5), COLOUR, 'the tiles of the archive');
        await expect(viewer(page).locator('.mapboxgl-ctrl-attrib-inner')).toContainText('USGS EROS (e2e)');
        expect(reads.ranges.length).toBeGreaterThan(1);
        expect(reads.ranges.every((range) => range?.startsWith('bytes=') === true)).toBe(true);
        // The basemap's map load and nothing else of Mapbox for this layer: no tileset asked for, and no provider script.
        const mapbox = await mockApis.calls('api.mapbox.com');
        expect(mapbox.filter((call) => /provider|pmtiles|e2e-own/.test(call.path))).toEqual([]);
    },
);

test(
    'A tile the archive leaves out is no request and no error: the basemap shows there',
    { tag: '@S-V32-HAPPY-HOLE' },
    async ({ page, lang }) => {
        const reads = await serveArchive(page, ARCHIVE_URL, await archive());

        await openOwn(page, lang, `15/${HOLE.lat.toFixed(5)}/${HOLE.lng.toFixed(5)}&layers=${OWN.id}`);

        await expectColourAt(page, await mapFraction(page, 0.5, 0.3), BASEMAP_BACKGROUND, 'the hole shows the basemap');
        // The first read of the header and root directory answered every tile of this view.
        expect(reads.ranges).toEqual(['bytes=0-16383']);
        await expect(page.getByRole('status').filter({ hasText: t(lang, 'error.layer', { name: OWN.label }) })).toBeHidden();
    },
);

test(
    'A server that ignores Range fails the layer once, names it in a toast and the map keeps working',
    { tag: '@S-V32-BAD-NO-RANGE' },
    async ({ page, lang }) => {
        const body = await archive();
        let reads = 0;
        await page.route(archiveAt(ARCHIVE_URL), async (route) => {
            reads += 1;
            await route.fulfill({
                status: 200,
                headers: { 'access-control-allow-origin': '*' },
                contentType: 'application/octet-stream',
                body,
            });
        });
        await serveManifest(page, withOwnLayer());
        // Not openViewer: a map whose visible layer keeps failing is never idle.
        await page.goto(sitePath('bucharest', { lang, hash: VIEW }));
        await waitForEngineEvent(page, 'hcm-ready');

        await expect(page.getByRole('status').filter({ hasText: t(lang, 'error.layer', { name: OWN.label }) })).toBeVisible();
        await expect(viewer(page).locator('canvas.mapboxgl-canvas')).toBeVisible();
        const probe = await mapFraction(page, 0.5, 0.3);
        await expectColourAt(page, probe, BASEMAP_BACKGROUND, 'the layer draws nothing, the basemap stays');
        // One read of the file, cancelled; every other tile fails on its answer, without asking again.
        expect(reads).toBe(1);
    },
);
