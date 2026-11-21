// The georeferencer's pending pair through its store (2026-11-12): the panes stand still while a pair waits for its second click
// (S-A16-HAPPY-GEOREF-GHOST), the place the pairs so far expect is the ghost (two pairs: their similarity; a fit: the fit), and
// without two pairs or a fit there is none and nothing is fetched (S-A16-BAD-GEOREF-GHOST-NO-PAIRS). The sharper scan is fetched
// once the scan pane zooms past the preview, by the owner or by the linked map (S-A16-HAPPY-GEOREF-FULL-RES).
import { FIRESTORE_PATHS, type MapView } from '@hcm/shared';
import { FakeMap } from '@hcm/test-support/fake-map';
import { FakeMapDraw } from '@hcm/test-support/fake-map-draw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadGeorefExtras, type ExtrasLoader } from '../../src/georef/extras.js';
import { georefModule } from '../../src/georef/georef.js';
import { GeorefMap } from '../../src/georef/georef-map.js';
import { createMapPreview } from '../../src/map/preview.js';
import { settle } from '../app/fakes.js';
import { factoryOf, host } from '../imagery/maps.js';
import { CITY, cityDoc, golden, imageryWorld, VERSIONS } from '../imagery/world.js';
import { fakeFrames } from '../map/support.js';
import { pair } from './fixtures.js';

const UPLOAD = 'up-plan1911';
const RENDERED = 'job-1966-0712';
const DETAIL = 'rasters/bucharest/planul-bucurestilor-1911/up-plan1911/scan-tiles.bin';
const CORONA_DETAIL = 'rasters/bucharest/kh-4a-corona-1966/job-1966-0712/scan-tiles.bin';

const EXTRAS = await loadGeorefExtras();

function setup(load: ExtrasLoader = () => Promise.resolve(EXTRAS)) {
    const map = new FakeMap();
    map.view = { center: [26.1, 44.45], zoom: 13, bearing: 0 };
    const handle = {
        ...{ port: map, preview: createMapPreview(map, fakeFrames()) },
        ...{ draw: () => Promise.resolve(new FakeMapDraw()), destroy: () => undefined },
    };
    const world = imageryWorld({ maps: factoryOf([{ ok: true, map: handle }]) });
    world.store.docs.set(FIRESTORE_PATHS.city(CITY), cityDoc({ imagery: { rmseThresholdM: 5 } }));
    world.store.docs.set(VERSIONS(UPLOAD), golden('version.needs-gcps.json'));
    world.store.docs.set(VERSIONS(RENDERED), golden('version.awaiting-approval.json'));
    world.files.put(DETAIL);
    world.files.put(CORONA_DETAIL);
    const frames: (() => void)[] = [];
    const fetched = { count: 0 };
    const extras: ExtrasLoader = () => {
        fetched.count += 1;
        return load();
    };
    const georef = georefModule(extras, (run) => {
        frames.push(run);
    }).create(world.services);
    const flush = (): void => {
        for (const run of frames.splice(0)) {
            run();
        }
    };
    return { georef, map, fetched, flush };
}

type World = ReturnType<typeof setup>;

async function opened(id: string): Promise<World> {
    const world = setup();
    world.georef.open([id]);
    world.georef.intents.attachMap(host());
    await settle();
    return world;
}

/** A whole pair from the context menu: its scan end, then its place. */
function addPair(world: World, id: string, x: number, y: number): void {
    const { pixel, geo } = pair(id, x, y);
    world.georef.intents.addAt({ pixel });
    world.georef.intents.addAt({ geo });
}

const jumps = (world: World) => world.map.callsOf('flyTo');

function ownerMoves(world: World, view: Partial<MapView>): void {
    world.map.emit('move', { ...world.map.view, ...view });
}

describe('the pending pair: the panes stand still and the ghost shows where it is expected', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('happyPath_twoPairsPredictTheOtherEndBothWaysThroughTheirSimilarity @S-A16-HAPPY-GEOREF-GHOST', async () => {
        const world = await opened(UPLOAD);
        const painted = vi.spyOn(GeorefMap.prototype, 'setGhost');
        addPair(world, 'a', 100, 100);
        addPair(world, 'b', 2000, 1500);
        expect(world.georef.state.fit.refusal).toBe('too-few');

        // Scan first: the map's dashed ring at the place the two pairs expect (the fixtures' exact map, 2 m a pixel, north up; a
        // place is kept to 1 cm, so the way back is within a hundredth of a pixel or so).
        world.georef.intents.pickScan({ x: 1000, y: 800 });
        await settle();
        const expected = pair('x', 1000, 800).geo;
        const ghost = world.georef.state.ghost;
        const geo = ghost !== null && 'geo' in ghost ? ghost.geo : null;
        expect(geo?.lat).toBeCloseTo(expected.lat, 7);
        expect(geo?.lng).toBeCloseTo(expected.lng, 7);
        expect(painted).toHaveBeenLastCalledWith(geo);

        // Esc: the ghost goes with the half pair; map first: the scan's ring at the pixel expected.
        world.georef.intents.cancelHalf();
        await settle();
        expect([world.georef.state.ghost, painted.mock.lastCall?.[0]]).toEqual([null, null]);
        world.georef.intents.addAt({ geo: pair('y', 600, 400).geo });
        await settle();
        const back = world.georef.state.ghost;
        const pixel = back !== null && 'pixel' in back ? back.pixel : null;
        expect(pixel?.x).toBeCloseTo(600, 1);
        expect(pixel?.y).toBeCloseTo(400, 1);
        expect(painted).toHaveBeenLastCalledWith(null);

        // Add pairs off drops the half pair and its ghost.
        world.georef.intents.setAdding(false);
        await settle();
        expect([world.georef.state.half, world.georef.state.ghost]).toEqual([null, null]);
    });

    it('happyPath_withAFitThePanesDoNotMoveWhileAPairWaitsAndTheGhostIsTheFits @S-A16-HAPPY-GEOREF-GHOST', async () => {
        const world = await opened(RENDERED);
        world.georef.intents.scanMoved({ centre: { x: 100, y: 100 }, scale: 0.2 });
        await settle();
        world.flush();
        const before = jumps(world).length;

        world.georef.intents.setAdding(true);
        world.georef.intents.pickScan({ x: 500, y: 500 });
        await settle();
        // The owner zooms the scan and the map before the second click: neither pane moves the other.
        world.georef.intents.scanMoved({ centre: { x: 2000, y: 1500 }, scale: 0.5 });
        ownerMoves(world, { center: [26.11, 44.44], zoom: 15 });
        world.flush();
        expect([jumps(world).length, world.georef.state.scanFollow]).toEqual([before, null]);
        const ghost = world.georef.state.ghost;
        expect(ghost !== null && 'geo' in ghost ? Number.isFinite(ghost.geo.lat + ghost.geo.lng) : false).toBe(true);

        // The pair is made: the panes link again.
        world.georef.intents.addAt({ geo: { lat: 44.44, lng: 26.11 } });
        world.georef.intents.scanMoved({ centre: { x: 2400, y: 1500 }, scale: 0.5 });
        world.flush();
        expect(jumps(world)).toHaveLength(before + 1);
        expect(world.georef.state.ghost).toBeNull();
    });

    it('badPath_withoutTwoPairsOrAFitThereIsNoGhostAndNothingIsFetched @S-A16-BAD-GEOREF-GHOST-NO-PAIRS', async () => {
        const world = await opened(UPLOAD);

        world.georef.intents.addAt({ pixel: { x: 10, y: 10 } });
        await settle();
        expect([world.georef.state.ghost, world.fetched.count]).toEqual([null, 0]);

        world.georef.intents.addAt({ geo: pair('a', 10, 10).geo });
        world.georef.intents.addAt({ pixel: { x: 300, y: 300 } });
        await settle();
        expect([world.georef.state.ghost, world.fetched.count]).toEqual([null, 0]);
        expect(world.georef.state.half).not.toBeNull();
    });

    it('badPath_twoPairsAtOnePixelOrOnePlacePredictNothing @S-A16-BAD-GEOREF-GHOST-NO-PAIRS', async () => {
        const world = await opened(UPLOAD);
        addPair(world, 'a', 100, 100);
        world.georef.intents.addAt({ pixel: { x: 900, y: 900 } });
        world.georef.intents.addAt({ geo: pair('a', 100, 100).geo });

        world.georef.intents.pickScan({ x: 400, y: 400 });
        await settle();

        expect(world.georef.state.pairs).toHaveLength(2);
        expect(world.georef.state.ghost).toBeNull();
    });
});

describe('the sharper scan through the store', () => {
    it('happyPath_theOwnersZoomPastThePreviewFetchesTheDetail @S-A16-HAPPY-GEOREF-FULL-RES', async () => {
        const world = await opened(UPLOAD);
        expect(world.georef.state.version?.scan?.detail).toEqual({ path: DETAIL, scale: 1 });

        world.georef.intents.scanMoved({ centre: { x: 100, y: 100 }, scale: 0.4 });
        await settle();
        expect(world.georef.state.scanDetail).toBeNull();

        world.georef.intents.scanMoved({ centre: { x: 100, y: 100 }, scale: 1.5 });
        await settle();
        expect(world.georef.state.scanDetail).toEqual({ file: expect.any(Blob) as Blob, scale: 1 });

        world.georef.close();
        expect(world.georef.state.scanDetail).toBeNull();
    });

    it('happyPath_theLinkedMapZoomingTheScanInFetchesItToo @S-A16-HAPPY-GEOREF-FULL-RES', async () => {
        const world = await opened(RENDERED);
        world.georef.intents.scanMoved({ centre: { x: 100, y: 100 }, scale: 0.01 });
        await settle();
        world.flush();

        ownerMoves(world, { center: [26.11, 44.44], zoom: 22 });
        world.flush();
        await settle();

        expect(world.georef.state.scanFollow?.scale).toBeGreaterThan(0.2);
        expect(world.georef.state.scanDetail).toEqual({ file: expect.any(Blob) as Blob, scale: 0.8 });
    });
});
