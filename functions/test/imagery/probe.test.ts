/**
 * `imagery.probeTiles` (`functions/src/imagery/probe.ts`, `docs/research/M3-interfaces.md` §8.2, §8.3): Check asks one
 * tile at the city's centre server-side, behind the address guard: an image passes, a 404, another type or no answer is
 * said in words, a private address is refused, and a foreign tileset or a key in the address never gets that far.
 */
import { describe, expect, it } from 'vitest';

import { probeTilesFunction, tileAt } from '../../src/imagery/probe.js';
import { UpstreamError } from '../../src/ports/errors.js';
import { failureOf } from '../admin/world.js';
import { adminCall } from '../publish/fakes.js';
import { JPEG_BYTES, PNG_BYTES } from '../support/imagery-fakes.js';
import { BOUNDS, CITY, MAPBOX_USER, TILES_TOKEN, readyWorld, seedCity, type ImageryWorld } from './world.js';

const XYZ = { type: 'xyz', tiles: ['https://tiles.example.org/plan-1911/{z}/{x}/{y}.png'], tileSize: 256 } as const;
const TILESET = `${MAPBOX_USER}.plan-1911`;
const WEBP = new Uint8Array([...new TextEncoder().encode('RIFF'), 0, 0, 0, 0, ...new TextEncoder().encode('WEBPVP8 ')]);

function probe(world: ImageryWorld, source: unknown) {
    return probeTilesFunction(() => world.deps).run(adminCall({ cityId: CITY, source }));
}

function xyzTile(): string {
    const tile = tileAt(
        { name: { ro: 'x' }, bounds: BOUNDS, published: true, updatedBy: 'x', updatedAt: { seconds: 0, nanoseconds: 0 } },
        12,
    );
    return `https://tiles.example.org/plan-1911/12/${String(tile.x)}/${String(tile.y)}.png`;
}

describe('tileAt', () => {
    it('happyPath_theTileHoldingBucharestsCentre', () => {
        const city = { name: { ro: 'x' }, bounds: BOUNDS, published: true, updatedBy: 'x', updatedAt: { seconds: 0, nanoseconds: 0 } };

        expect(tileAt(city, 12)).toEqual({ z: 12, x: 2344, y: 1482 });
        expect(tileAt({ ...city, center: { lat: 44.4268, lng: 26.1025 } }, 0)).toEqual({ z: 0, x: 0, y: 0 });
    });
});

describe('imagery.probeTiles', () => {
    it('happyPath_aTileServerAnsweringAnImageIsReady', async () => {
        const world = await readyWorld();
        world.remote.serve(xyzTile(), PNG_BYTES, 'image/png');

        await expect(probe(world, XYZ)).resolves.toEqual({ contentType: 'image/png', tile: { z: 12, x: 2344, y: 1482 } });
        expect(world.remote.recorder.argsOf('get')[0]?.[1]).toEqual({ timeoutMs: 5000, maxBytes: 2_000_000 });
    });

    it('happyPath_aMapboxTilesetIsAskedWithinItsZoomRange', async () => {
        const world = await readyWorld();
        await seedCity(world, { zoom: 18 });
        await world.tilesets.tilesets.upsertTileset(TILES_TOKEN, TILESET, { name: 'plan-1911', recipe: { minzoom: 10, maxzoom: 16 } });
        const tile = tileAt(
            { name: { ro: 'x' }, bounds: BOUNDS, published: true, updatedBy: 'x', updatedAt: { seconds: 0, nanoseconds: 0 } },
            16,
        );
        world.remote.serve(
            `https://api.mapbox.com/v4/${TILESET}/16/${String(tile.x)}/${String(tile.y)}.png?access_token=${TILES_TOKEN}`,
            JPEG_BYTES,
        );

        await expect(probe(world, { type: 'mapbox', tilesetId: TILESET })).resolves.toEqual({ contentType: 'image/jpeg', tile });
        expect(world.remote.recorder.argsOf('get')[0]?.[1]).toMatchObject({ allowedHosts: ['api.mapbox.com'] });
    });

    it('happyPath_aWebpTileIsAnImageToo', async () => {
        const world = await readyWorld();
        world.remote.serve(xyzTile(), WEBP, 'image/webp');

        await expect(probe(world, XYZ)).resolves.toMatchObject({ contentType: 'image/webp' });
    });

    it.each([
        ['a loopback address', 'https://127.0.0.1/{z}/{x}/{y}.png'],
        ['a link-local metadata address', 'https://169.254.169.254/{z}/{x}/{y}.png'],
        ['another port', 'https://tiles.example.org:8443/{z}/{x}/{y}.png'],
    ])('badPath_aProbeNeverReachesAPrivateAddress_%s @S-A15-BAD-PRIVATE-ADDRESS', async (_case, template) => {
        const world = await readyWorld();

        const failure = await failureOf(probe(world, { ...XYZ, tiles: [template] }));

        expect(failure).toMatchObject({ code: 'invalid-argument', details: { code: 'apiError.imagery.addressRefused' } });
        expect(world.remote.fetched).toEqual([]);
    });

    it('badPath_aRedirectOrAPrivateHostRefusedByTheGuardIsRefused @S-A15-BAD-PRIVATE-ADDRESS', async () => {
        const world = await readyWorld();
        world.remote.files.set(xyzTile(), new UpstreamError('remote', 'forbidden'));

        expect(await failureOf(probe(world, XYZ))).toMatchObject({ details: { code: 'apiError.imagery.addressRefused' } });
    });

    it.each([
        ['a 404', new UpstreamError('remote', 'notFound', { status: 404 }), 'apiError.imagery.tilesNotFound'],
        [
            'an HTTP 403 of the server itself',
            new UpstreamError('remote', 'forbidden', { status: 403 }),
            'apiError.imagery.tilesUnreachable',
        ],
        ['a timeout', new UpstreamError('remote', 'unavailable'), 'apiError.imagery.tilesUnreachable'],
    ])('badPath_aTileThatCannotBeReadIsSaid_%s', async (_case, error, code) => {
        const world = await readyWorld();
        world.remote.files.set(xyzTile(), error);

        expect(await failureOf(probe(world, XYZ))).toMatchObject({ details: { code } });
    });

    it('badPath_anAnswerThatIsNotAnImageIsSaid', async () => {
        const world = await readyWorld();
        world.remote.serve(xyzTile(), new TextEncoder().encode('<html>'), 'text/html');

        expect(await failureOf(probe(world, XYZ))).toMatchObject({ details: { code: 'apiError.imagery.tilesNotImage' } });
    });

    it('badPath_aMissingTilesetIsNotFound', async () => {
        const world = await readyWorld();

        expect(await failureOf(probe(world, { type: 'mapbox', tilesetId: TILESET }))).toMatchObject({
            details: { code: 'apiError.imagery.tilesNotFound' },
        });
        expect(world.remote.fetched).toEqual([]);
    });

    it('badPath_aFailingTileJsonIsPassedOn', async () => {
        const world = await readyWorld();
        world.tilesets.recorder.failNext('tileJson', new UpstreamError('mapbox', 'unauthorized', { status: 401 }));

        expect(await failureOf(probe(world, { type: 'mapbox', tilesetId: TILESET }))).toMatchObject({
            details: { code: 'apiError.imagery.tilesUnreachable' },
        });
    });

    it.each([
        ['another account', { type: 'mapbox', tilesetId: 'another-account.plan' }, 'apiError.layers.foreignTileset'],
        [
            'a key in the address',
            { ...XYZ, tiles: ['https://tiles.example.org/{z}/{x}/{y}.png?access_token=e2e'] },
            'apiError.layers.secretInAddress',
        ],
    ])('badPath_aSourceThatCannotBeLinkedIsRefusedFirst_%s', async (_case, source, code) => {
        const world = await readyWorld();

        expect(await failureOf(probe(world, source))).toMatchObject({ details: { code } });
        expect(world.remote.recorder.calls).toEqual([]);
    });

    it('badPath_withoutTheTilesTokenMapboxIsNotSetUp', async () => {
        const world = await readyWorld();
        world.secrets.versions.delete('mapbox-sk-tiles');

        expect(await failureOf(probe(world, { type: 'mapbox', tilesetId: TILESET }))).toMatchObject({
            details: { code: 'apiError.mapbox.notConfigured' },
        });
    });

    it('badPath_anUnknownCityIsNotFound', async () => {
        const world = await readyWorld();
        await world.deps.documents.delete(`cities/${CITY}`);

        expect(await failureOf(probe(world, XYZ))).toMatchObject({ code: 'not-found' });
    });
});
