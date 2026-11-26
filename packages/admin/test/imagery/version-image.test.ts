import { FIRESTORE_PATHS } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { CallableFailure } from '../../src/firebase/ports.js';
import { IMAGERY_MODULE } from '../../src/imagery/imagery.js';
import { TILES_LAYER, UNCOVERED_OVERLAY, type ImageryMap } from '../../src/imagery/imagery-map.js';
import type { VersionPageState } from '../../src/imagery/version.js';
import { VersionImage } from '../../src/imagery/version-image.js';
import { settle } from '../app/fakes.js';
import { fakeFrames } from '../map/support.js';
import { factoryOf, host, mapboxHandle } from './maps.js';
import { answer, callsOf, CITY, cityDoc, imageryWorld, JOBS, jobDoc, setupStatus, VERSIONS, versionDoc } from './world.js';

const VERSION = 'job-1966-0712';
const DIR = 'rasters/bucharest/kh-4a-corona-1966/job-1966-0712';
const PREVIEW = `${DIR}/preview.png`;
const SOURCE = `hcm-source-${TILES_LAYER}`;
const TILES = { path: `${DIR}/tiles.pmtiles`, bytes: 175_000_000, count: 20_270, sha256: 'a'.repeat(64), thumbPath: `${DIR}/thumb.webp` };
const SIGNED = 'https://storage.example.org/x.pmtiles?X-Goog-Signature=secret';
const PUBLIC_ARCHIVE = 'https://storage.example.org/public/x.pmtiles';

/** An answer the test gives when it chooses. */
function deferred<T>(): { readonly promise: Promise<T>; resolve(value: T): void } {
    const answers: ((value: T) => void)[] = [];
    const promise = new Promise<T>((resolve) => {
        answers.push(resolve);
    });
    return {
        promise,
        resolve: (value) => {
            answers[0]?.(value);
        },
    };
}

function outputWith(tiles: unknown, extra: Record<string, unknown> = {}): Record<string, unknown> {
    return { ...(versionDoc()['output'] as Record<string, unknown>), ...(tiles === null ? {} : { tiles }), ...extra };
}

async function opened(output: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
    const frames = fakeFrames();
    const { handle, native } = await mapboxHandle(null, frames);
    const world = imageryWorld({ maps: factoryOf([{ ok: true, map: handle }]) });
    world.store.docs.set(FIRESTORE_PATHS.setupStatus, setupStatus('ok'));
    world.store.docs.set(FIRESTORE_PATHS.city(CITY), cityDoc());
    world.store.docs.set(VERSIONS(VERSION), versionDoc({ output, ...overrides }));
    world.store.docs.set(JOBS(VERSION), jobDoc({ status: 'awaiting_approval', waitReason: 'approval' }));
    world.files.put(PREVIEW);
    answer(world.callables, 'imagery.previewUrl', () => ({ url: SIGNED, expiresAt: '2026-10-20T10:00:00.000Z', bytes: TILES.bytes }));
    const imagery = IMAGERY_MODULE.create(world.services);
    imagery.open(['version', VERSION]);
    imagery.intents.attachMap(host());
    await settle();
    return { world, imagery, native, frames };
}

describe("a version's picture on the map", () => {
    it('happyPath_itsOwnTilesAtFullZoomTheCityAndNoSmallPicture @S-A74-HAPPY-SEES-IMAGE', async () => {
        const { imagery, native, world } = await opened(outputWith(TILES));

        expect(imagery.state.image).toEqual({ status: 'ready' });
        expect(callsOf(world.callables, 'imagery.previewUrl')).toEqual([{ cityId: CITY, versionId: VERSION }]);
        expect(native.sources.get(SOURCE)).toMatchObject({ type: 'custom', tileSize: 256, minzoom: 10, maxzoom: 16 });
        expect(native.sources.has('hcm-picture-preview')).toBe(false);
        expect(native.sources.has('hcm-source-imagery-city')).toBe(true);
    });

    it('happyPath_theSignedAddressNeverEntersTheAreasState', async () => {
        const { imagery } = await opened(outputWith(TILES));

        expect(JSON.stringify(imagery.state)).not.toContain('secret');
    });

    it('happyPath_theSliderMovesItsOpacityAndActualPixelsGoesTo1To1 @S-A74-HAPPY-ACTUAL-PIXELS', async () => {
        const { imagery, native, frames } = await opened(outputWith(TILES));

        imagery.intents.setPreviewOpacity(35);
        imagery.intents.actualPixels();
        frames.run();

        expect(native.paint.get(`hcm-raster-${TILES_LAYER}`)?.['raster-opacity']).toBeCloseTo(0.35, 9);
        // A 256 px tile of z16 is 1:1 at z15; past that its pixels stay square.
        expect(native.callsOf('jumpTo').at(-1)?.[0]).toMatchObject({ zoom: 15 });
        expect(native.paint.get(`hcm-raster-${TILES_LAYER}`)?.['raster-resampling']).toEqual(['step', ['zoom'], 'linear', 15, 'nearest']);
    });

    it('happyPath_whatTheImageMissesOfTheCityIsShaded @S-A74-HAPPY-COVERAGE', async () => {
        const outline = [
            { lat: 44.4, lng: 26 },
            { lat: 44.4, lng: 26.2 },
            { lat: 44.5, lng: 26.2 },
            // Past the city's north: kept inside it, so the hole stays in its ring.
            { lat: 44.9, lng: 26 },
        ];
        const { native } = await opened(outputWith(TILES, { outline, coveragePct: 57 }));

        const source = native.sources.get(`hcm-source-${UNCOVERED_OVERLAY}`) as unknown as {
            data: { features: { geometry: { coordinates: number[][][] } }[] };
        };
        const [ring, hole] = source.data.features[0]?.geometry.coordinates ?? [];

        expect(ring?.[0]).toEqual([25.9, 44.3]);
        expect(hole).toHaveLength(5);
        expect(hole?.[3]).toEqual([26, 44.6]);
    });

    it('badPath_theCityReadAfterTheVersionStillGetsItsOutlineAndAMapMadeLaterFitsTheImage', async () => {
        const maps = await mapboxHandle();
        const world = imageryWorld({ maps: factoryOf([{ ok: true, map: maps.handle }]) });
        world.store.docs.set(VERSIONS(VERSION), versionDoc({ output: outputWith(TILES) }));
        world.store.docs.set(JOBS(VERSION), jobDoc({ status: 'awaiting_approval', waitReason: 'approval' }));
        answer(world.callables, 'imagery.previewUrl', () => ({ url: SIGNED, expiresAt: '2026-10-20T10:00:00.000Z', bytes: TILES.bytes }));
        const imagery = IMAGERY_MODULE.create(world.services);
        imagery.open(['version', VERSION]);
        imagery.intents.attachMap(host());
        await settle();
        expect(maps.native.sources.has('hcm-source-imagery-city')).toBe(false);

        world.store.put(FIRESTORE_PATHS.city(CITY), cityDoc());
        await settle();

        expect(maps.native.sources.has('hcm-source-imagery-city')).toBe(true);
        expect(maps.native.sources.has(SOURCE)).toBe(true);
        expect(maps.native.callsOf('fitBounds').length).toBeGreaterThan(0);
    });

    it('badPath_noMeasuredEdgeOrTheWholeCityShadesNothing', async () => {
        const none = await opened(outputWith(TILES, { coveragePct: 57 }), { calibration: undefined });
        const whole = await opened(
            outputWith(TILES, {
                coveragePct: 100,
                outline: [
                    { lat: 44.3, lng: 25.9 },
                    { lat: 44.3, lng: 26.3 },
                    { lat: 44.6, lng: 26.3 },
                ],
            }),
        );

        expect(none.native.sources.has(`hcm-source-${UNCOVERED_OVERLAY}`)).toBe(false);
        expect(whole.native.sources.has(`hcm-source-${UNCOVERED_OVERLAY}`)).toBe(false);
    });
});

describe("a version's picture that cannot be its tiles", () => {
    it('badPath_aVersionWithNoTilesYetShowsItsSmallPictureAndAsksNothing @S-A74-BAD-NO-TILES-YET', async () => {
        const { imagery, native, world } = await opened(outputWith(null));

        expect(imagery.state.image).toEqual({ status: 'small' });
        expect(callsOf(world.callables, 'imagery.previewUrl')).toEqual([]);
        expect(native.sources.has('hcm-picture-preview')).toBe(true);
        expect(native.sources.has(SOURCE)).toBe(false);
    });

    it('badPath_aRejectedVersionsTilesAreGoneSoItsSmallPictureIsAskedForInstead', async () => {
        const { imagery, world } = await opened(outputWith(TILES), { state: 'rejected' });

        expect(imagery.state.image).toEqual({ status: 'small' });
        expect(callsOf(world.callables, 'imagery.previewUrl')).toEqual([]);
    });

    it('badPath_aRefusalSaysWhyTheSmallPictureStandsInAndTryAgainWorks @S-A74-BAD-REFUSED', async () => {
        const { handle, native } = await mapboxHandle();
        const world = imageryWorld({ maps: factoryOf([{ ok: true, map: handle }]) });
        world.store.docs.set(FIRESTORE_PATHS.setupStatus, setupStatus('ok'));
        world.store.docs.set(FIRESTORE_PATHS.city(CITY), cityDoc());
        world.store.docs.set(VERSIONS(VERSION), versionDoc({ output: outputWith(TILES) }));
        world.store.docs.set(JOBS(VERSION), jobDoc({ status: 'awaiting_approval', waitReason: 'approval' }));
        world.files.put(PREVIEW);
        answer(world.callables, 'imagery.previewUrl', () => {
            throw new CallableFailure('failed-precondition', { code: 'apiError.imagery.tilesMissing' });
        });
        const imagery = IMAGERY_MODULE.create(world.services);
        imagery.open(['version', VERSION]);
        imagery.intents.attachMap(host());
        await settle();

        expect(imagery.state.image).toEqual({ status: 'failed', notice: { key: 'apiError.imagery.tilesMissing' } });
        expect(native.sources.has('hcm-picture-preview')).toBe(true);

        answer(world.callables, 'imagery.previewUrl', () => ({ url: SIGNED, expiresAt: '2026-10-20T10:00:00.000Z', bytes: TILES.bytes }));
        imagery.intents.retryImage();
        expect(imagery.state.image).toEqual({ status: 'loading' });
        await settle();

        expect(imagery.state.image).toEqual({ status: 'ready' });
        expect(native.sources.has('hcm-picture-preview')).toBe(false);
    });

    it('badPath_aFailedTileTakesTheTilesOffAndSaysSoAnHourOnTryAgainAsksAnew @S-A74-BAD-TILE-FAILS', async () => {
        const { imagery, native, world } = await opened(outputWith(TILES));

        native.fire('error', { error: new Error('status-403'), sourceId: SOURCE, tile: {} });
        await settle();

        expect(imagery.state.image).toEqual({ status: 'failed', notice: { key: 'adminContent.imagery.view.tilesFailed' } });
        expect(native.sources.has(SOURCE)).toBe(false);
        expect(native.sources.has('hcm-picture-preview')).toBe(true);

        imagery.intents.retryImage();
        await settle();

        expect(callsOf(world.callables, 'imagery.previewUrl')).toHaveLength(2);
        expect(imagery.state.image).toEqual({ status: 'ready' });
    });

    it('badPath_anHourOnAFailingTileIsTheAddressRunningOutAndANewOneIsAskedForOnItsOwn @S-A74-BAD-HOUR-OVER', async () => {
        const { imagery, native, world } = await opened(outputWith(TILES));

        world.clock.advance(3_600_000);
        native.fire('error', { error: new Error('status-400'), sourceId: SOURCE, tile: {} });
        // Its other tiles fail too while the new address is on its way: one asking is enough.
        native.fire('error', { error: new Error('status-400'), sourceId: SOURCE, tile: {} });
        await settle();

        expect(callsOf(world.callables, 'imagery.previewUrl')).toHaveLength(2);
        expect(imagery.state.image).toEqual({ status: 'ready' });
        expect(native.sources.has(SOURCE)).toBe(true);

        // Within the new hour a failing tile is the bucket's: it says so, and asks nothing more.
        world.clock.advance(3_599_000);
        native.fire('error', { error: new Error('status-403'), sourceId: SOURCE, tile: {} });
        await settle();

        expect(imagery.state.image).toEqual({ status: 'failed', notice: { key: 'adminContent.imagery.view.tilesFailed' } });
        expect(callsOf(world.callables, 'imagery.previewUrl')).toHaveLength(2);
    });

    it('badPath_anotherLayersFailureIsNotThisImages', async () => {
        const { imagery, native } = await opened(outputWith(TILES));

        native.fire('error', { error: new Error('status-503'), sourceId: 'hcm-source-other', tile: {} });

        expect(imagery.state.image).toEqual({ status: 'ready' });
    });

    it('badPath_anAnswerAboutAVersionLeftBehindIsDropped', async () => {
        const { handle, native } = await mapboxHandle();
        const world = imageryWorld({ maps: factoryOf([{ ok: true, map: handle }]) });
        world.store.docs.set(FIRESTORE_PATHS.setupStatus, setupStatus('ok'));
        world.store.docs.set(FIRESTORE_PATHS.city(CITY), cityDoc());
        world.store.docs.set(VERSIONS(VERSION), versionDoc({ output: outputWith(TILES) }));
        world.store.docs.set(JOBS(VERSION), jobDoc({ status: 'awaiting_approval', waitReason: 'approval' }));
        const held = deferred<{ url: string; expiresAt: string; bytes: number }>();
        answer(world.callables, 'imagery.previewUrl', () => held.promise);
        const imagery = IMAGERY_MODULE.create(world.services);
        imagery.intents.attachMap(host());
        imagery.open(['version', VERSION]);
        await settle();

        imagery.open([]);
        held.resolve({ url: SIGNED, expiresAt: '2026-10-20T10:00:00.000Z', bytes: TILES.bytes });
        await settle();

        expect(imagery.state.image).toEqual({ status: 'none' });
        expect(native.sources.has(SOURCE)).toBe(false);
    });

    it('badPath_aFailureAfterLeavingIsNobodysAndARefusalLeftBehindIsDropped', async () => {
        const { imagery, native } = await opened(outputWith(TILES));

        imagery.open([]);
        await settle();
        native.fire('error', { error: new Error('status-403'), sourceId: SOURCE, tile: {} });

        expect(imagery.state.image).toEqual({ status: 'none' });
        imagery.intents.retryImage();
        expect(imagery.state.image).toEqual({ status: 'none' });
    });

    it('badPath_actualPixelsBeforeAnyOutputDoesNothing', async () => {
        const { handle, native } = await mapboxHandle();
        const world = imageryWorld({ maps: factoryOf([{ ok: true, map: handle }]) });
        world.store.docs.set(FIRESTORE_PATHS.city(CITY), cityDoc());
        const imagery = IMAGERY_MODULE.create(world.services);
        imagery.intents.attachMap(host());
        await settle();
        const before = native.callsOf('jumpTo').length;

        imagery.intents.actualPixels();

        expect(native.callsOf('jumpTo')).toHaveLength(before);
    });
});

describe('a version published while its page is open', () => {
    it('badPath_publishedWhileOpenItsGonePrivateArchiveGivesWayToItsPublicOneWithNoNewAddress', async () => {
        const world = imageryWorld();
        answer(world.callables, 'imagery.previewUrl', () => ({ url: SIGNED, expiresAt: '2026-10-20T10:00:00.000Z', bytes: TILES.bytes }));
        const urls: (string | null)[] = [];
        const map = {
            fitBox: () => undefined,
            clearVersion: () => undefined,
            showPicture: () => Promise.resolve(),
            showVersion: (_output: unknown, url: string | null) => urls.push(url),
        };
        const image = new VersionImage({
            services: world.services,
            map: () => map as unknown as ImageryMap,
            opacity: () => 1,
            changed: () => undefined,
        });
        const output = { bounds: { west: 26, south: 44.3, east: 26.2, north: 44.5 }, previewPath: PREVIEW, tiles: TILES };
        const shown = (view: Record<string, unknown>) =>
            ({
                showing: 'new',
                current: null,
                version: { doc: { data: { id: VERSION, output, publicUrl: null, ...view } } },
            }) as unknown as VersionPageState;

        image.follow(shown({ state: 'awaiting_approval' }));
        await settle();
        image.follow(shown({ state: 'published', publicUrl: PUBLIC_ARCHIVE }));
        await settle();
        image.follow(shown({ state: 'published', publicUrl: PUBLIC_ARCHIVE }));
        await settle();

        expect(urls).toEqual([SIGNED, PUBLIC_ARCHIVE]);
        expect(callsOf(world.callables, 'imagery.previewUrl')).toHaveLength(1);
    });
});
