import type { Page } from '@playwright/test';

import { siteManifestData, type Json } from '../../fixtures/manifest.js';
import { BASEMAP_BACKGROUND, E2E_TILE_HOST, type Rgb } from '../../fixtures/world.js';
import { expectColourAt, mapFacts, mapFraction, mapIdle, screenPointOf, type LngLat } from '../../support/map.js';
import { frameArchive, serveArchive } from '../../support/pmtiles.js';
import { expect, test } from '../../support/test.js';
import { openViewer, serveManifest } from '../../support/viewer.js';

/**
 * A layer whose one frame covers only part of the city (behaviour V32, docs/research/M12-own-tiles.md), as the 1980 KH-9 frame covers
 * Bucharest's north half: the real Mapbox GL JS shows the frame and, everywhere else, the basemap. Mapbox GL draws a tile the source
 * answers with nothing on a texture from its pool, without uploading pixels, so a hole showed an earlier tile of another place and
 * zoom (the owner's screenshot of 2026-11-08, docs/LESSONS.md); that only shows once tiles have left Mapbox GL's cache, hence the walk.
 */
const FRAME = { id: 'e2e-frame', label: 'Cadru parțial (e2e)' } as const;
const ARCHIVE_URL = `https://${E2E_TILE_HOST}/own/e2e-frame.pmtiles`;
const COLOUR: Rgb = [40, 160, 90];
/** South-west of the city, away from the photos (44.42 to 44.45 N, 26.08 to 26.14 E). */
const WEST = 25.935;
const EAST = 26.075;
const SOUTH = 44.335;
const NORTH = 44.415;
/** The camera's zooms; Mapbox GL draws a 256 px source one zoom deeper (z16 and z17 tiles), so the archive holds those. */
const ZOOMS = [15, 16] as const;
const TILE_ZOOMS = [16, 17] as const;
/** A walk inside the frame: nine views a zoom, each new to the tiles, more than Mapbox GL's tile cache keeps at any viewport. */
const WALK_LNG = [25.96, 26.005, 26.05] as const;
const WALK_LAT = [44.35, 44.375, 44.4] as const;
/** Well north of the frame and inside the city: every tile of the view is a hole. */
const OUTSIDE: LngLat = [25.97, 44.5];
const EDGE_LNG = 26.0;
/** 40 CSS px at the camera's z16 around the frame's northern edge. */
const NEAR_EDGE = 0.0006;

/** The latitude of the top of tile row `y` at zoom `z`. */
function rowTop(y: number, z: number): number {
    return (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI;
}

/** The frame's northern edge as Mapbox GL draws it at the camera's z16: the top of the z17 tile row that holds `NORTH`. */
function northEdge(): number {
    const z = TILE_ZOOMS[1];
    const sin = Math.sin((NORTH * Math.PI) / 180);
    return rowTop(Math.floor((0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * 2 ** z), z);
}

function withFrameLayer(): Json {
    const manifest = siteManifestData();
    const layers = manifest['layers'] as Json[];
    layers.push({
        ...layers[0],
        id: FRAME.id,
        year: 1980,
        label: { ro: FRAME.label, en: FRAME.label },
        source: { type: 'pmtiles', url: ARCHIVE_URL },
        attribution: 'USGS EROS (e2e)',
        minzoom: 10,
        maxzoom: 17,
        order: 3,
    });
    return manifest;
}

function archive(): Promise<Buffer> {
    return frameArchive({ colour: COLOUR, bounds: [WEST, SOUTH, EAST, NORTH], minzoom: TILE_ZOOMS[0], maxzoom: TILE_ZOOMS[1] });
}

function view(zoom: number, [lng, lat]: LngLat): string {
    return `${String(zoom)}/${lat.toFixed(5)}/${lng.toFixed(5)}&layers=${FRAME.id}`;
}

/** Moves the camera as a visitor's address does, then waits for its tiles. */
async function goTo(page: Page, zoom: number, at: LngLat): Promise<void> {
    await page.evaluate(
        (hash) => {
            location.hash = hash;
        },
        view(zoom, at),
    );
    await expect
        .poll(async () => {
            const facts = await mapFacts(page);
            return !facts.moving && Math.abs(facts.center[0] - at[0]) < 1e-4 && Math.abs(facts.center[1] - at[1]) < 1e-4;
        })
        .toBe(true);
    await mapIdle(page);
}

test(
    'A layer whose frame covers part of the view shows the frame there and the basemap beside it',
    { tag: '@S-V32-HAPPY-PARTIAL-FRAME' },
    async ({ page, lang }) => {
        await serveArchive(page, ARCHIVE_URL, await archive());
        await serveManifest(page, withFrameLayer());
        const edge = northEdge();

        await openViewer(page, { lang, hash: view(ZOOMS[1], [EDGE_LNG, edge]) });

        await expectColourAt(page, await screenPointOf(page, [EDGE_LNG, edge - NEAR_EDGE]), COLOUR, 'inside the frame: its picture');
        await expectColourAt(page, await screenPointOf(page, [EDGE_LNG, edge + NEAR_EDGE]), BASEMAP_BACKGROUND, 'beside it: the basemap');
    },
);

test(
    'Past the frame, after a walk across it, the map shows the basemap and never an earlier tile of the layer',
    { tag: '@S-V32-BAD-STALE-HOLE' },
    async ({ page, lang }) => {
        await serveArchive(page, ARCHIVE_URL, await archive());
        await serveManifest(page, withFrameLayer());
        await openViewer(page, { lang, hash: view(ZOOMS[0], [WALK_LNG[0], WALK_LAT[0]]) });
        await expectColourAt(page, await mapFraction(page, 0.5, 0.5), COLOUR, 'the walk starts inside the frame');
        for (const zoom of ZOOMS) {
            for (const lng of WALK_LNG) {
                for (const lat of WALK_LAT) {
                    await goTo(page, zoom, [lng, lat]);
                }
            }
        }

        await goTo(page, ZOOMS[0], OUTSIDE);

        for (const [fx, fy] of [
            [0.5, 0.3],
            [0.5, 0.5],
            [0.3, 0.45],
            [0.7, 0.45],
        ] as const) {
            await expectColourAt(
                page,
                await mapFraction(page, fx, fy),
                BASEMAP_BACKGROUND,
                `past the frame at ${String(fx)},${String(fy)}`,
            );
        }
    },
);
