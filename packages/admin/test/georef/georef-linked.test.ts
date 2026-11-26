// The georeferencer's linked views through its store (S-A16-HAPPY-GEOREF-LINKED, S-A16-BAD-GEOREF-LINKED-NO-FIT): a scan move
// jumps the map once a frame, a map move puts the scan pane there, the toggle stops both, and a version without a fit moves nothing
// (nor fetches the chunk).
import { FIRESTORE_PATHS, type MapView } from '@hcm/shared';
import { FakeMap } from '@hcm/test-support/fake-map';
import { FakeMapDraw } from '@hcm/test-support/fake-map-draw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadGeorefExtras, type ExtrasLoader } from '../../src/georef/extras.js';
import { georefModule } from '../../src/georef/georef.js';
import { ANIMATION_FRAME } from '../../src/georef/link.js';
import { createMapPreview } from '../../src/map/preview.js';
import { settle } from '../app/fakes.js';
import { factoryOf, host } from '../imagery/maps.js';
import { CITY, cityDoc, golden, imageryWorld, VERSIONS } from '../imagery/world.js';
import { fakeFrames } from '../map/support.js';

const UPLOAD = 'up-plan1911';
const RENDERED = 'job-1966-0712';

/** The lazy chunk, fetched once before the tests (as from the browser's module map). */
const EXTRAS = await loadGeorefExtras();

/** The chunk's fetch failing: offline, or a deploy replaced it. */
const OFFLINE: ExtrasLoader = () => Promise.reject(new TypeError('Failed to fetch dynamically imported module'));

function setup(load: ExtrasLoader = () => Promise.resolve(EXTRAS)) {
    const draw = new FakeMapDraw();
    const map = new FakeMap();
    map.view = { center: [26.1, 44.45], zoom: 13, bearing: 0 };
    const handle = { port: map, preview: createMapPreview(map, fakeFrames()), draw: () => Promise.resolve(draw), destroy: () => undefined };
    // Two: a test re-makes the map (as a page that shows it again).
    const world = imageryWorld({
        maps: factoryOf([
            { ok: true, map: handle },
            { ok: true, map: handle },
        ]),
    });
    world.store.docs.set(FIRESTORE_PATHS.city(CITY), cityDoc({ imagery: { rmseThresholdM: 5 } }));
    world.store.docs.set(VERSIONS(UPLOAD), golden('version.needs-gcps.json'));
    world.store.docs.set(VERSIONS(RENDERED), golden('version.awaiting-approval.json'));
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
    return { georef, map, draw, frames, fetched, flush };
}

type World = ReturnType<typeof setup>;

async function opened(id: string, load?: ExtrasLoader): Promise<World> {
    const world = setup(load);
    world.georef.open([id]);
    world.georef.intents.attachMap(host());
    await settle();
    return world;
}

/** The owner moves the map (Mapbox plays `move` with the view of each frame). */
function ownerMoves(world: World, view: Partial<MapView>): void {
    world.map.emit('move', { ...world.map.view, ...view });
}

/** The chunk fetched by a first move, as the page's first pan does. */
async function linked(world: World): Promise<void> {
    world.georef.intents.scanMoved({ centre: { x: 100, y: 100 }, scale: 1 });
    await settle();
    world.flush();
}

const jumps = (world: World) => world.map.callsOf('flyTo');

describe('the georeferencer links its views', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('happyPath_theLinkMovesAtTheBrowsersNextAnimationFrame @S-A16-HAPPY-GEOREF-LINKED', () => {
        const asked: FrameRequestCallback[] = [];
        vi.stubGlobal('requestAnimationFrame', (run: FrameRequestCallback) => asked.push(run));
        const ran: string[] = [];

        ANIMATION_FRAME(() => ran.push('moved'));
        asked[0]?.(0);

        expect(ran).toEqual(['moved']);
    });

    it('happyPath_aScanMoveJumpsTheMapAndAMapMoveCentresTheScan @S-A16-HAPPY-GEOREF-LINKED', async () => {
        const world = await opened(RENDERED);
        expect(world.georef.state.linked).toBe(true);
        await linked(world);
        // The move made while the chunk loaded is played once it is in: a quick zoom is not lost.
        expect([world.fetched.count, jumps(world).length]).toEqual([1, 1]);

        world.georef.intents.scanMoved({ centre: { x: 2000, y: 1500 }, scale: 0.5 });
        world.georef.intents.scanMoved({ centre: { x: 2400, y: 1500 }, scale: 0.5 });
        world.flush();
        // One jump a frame, to the latest move, without an animation; the map's own `move` did not move the scan back.
        expect(jumps(world)).toHaveLength(2);
        expect(jumps(world)[1]?.[1]).toEqual({ animate: false });
        expect(world.georef.state.scanFollow).toBeNull();

        ownerMoves(world, { center: [26.11, 44.44], zoom: 15 });
        world.flush();
        const follow = world.georef.state.scanFollow;
        expect(follow?.scale).toBeGreaterThan(0.5);
        expect(jumps(world)).toHaveLength(2);
    });

    it('happyPath_aFirstMoveOnTheMapMovesTheScanWhileTheChunkLoads @S-A16-HAPPY-GEOREF-LINKED', async () => {
        const world = await opened(RENDERED);

        // Reduced motion: one jump, one `move`, compared with the camera the map showed when it was made.
        ownerMoves(world, { center: [26.11, 44.44], zoom: 15 });
        await settle();
        world.flush();

        expect(world.fetched.count).toBe(1);
        expect(world.georef.state.scanFollow?.scale).toBeGreaterThan(0);
        expect(jumps(world)).toHaveLength(0);
    });

    it('happyPath_twoMapMovesBeforeTheChunkIsInFollowTheLatest @S-A16-HAPPY-GEOREF-LINKED', async () => {
        const world = await opened(RENDERED);

        ownerMoves(world, { center: [26.11, 44.44], zoom: 14 });
        ownerMoves(world, { center: [26.12, 44.44], zoom: 15 });
        await settle();
        world.flush();
        const first = world.georef.state.scanFollow;
        // A re-made map only says where it is now: no move of the scan.
        world.map.view = { center: [26.2, 44.5], zoom: 12, bearing: 0 };
        world.georef.intents.attachMap(host());
        await settle();
        world.flush();

        expect(first).not.toBeNull();
        expect(world.georef.state.scanFollow).toBe(first);
    });

    it('happyPath_theToggleStopsBothWaysAndIsRememberedForTheNextVersion @S-A16-HAPPY-GEOREF-LINKED', async () => {
        const world = await opened(RENDERED);
        await linked(world);
        world.georef.intents.setLinked(false);

        world.georef.intents.scanMoved({ centre: { x: 2000, y: 1500 }, scale: 0.5 });
        ownerMoves(world, { center: [26.11, 44.44], zoom: 15 });
        world.flush();
        expect([jumps(world).length, world.georef.state.scanFollow]).toEqual([1, null]);

        world.georef.close();
        world.georef.open([UPLOAD]);
        await settle();
        expect(world.georef.state.linked).toBe(false);
    });

    it('badPath_whileAPointIsDraggedOnTheMapTheScanStaysWhereItIs @S-A16-BAD-GEOREF-LINKED-NO-FIT', async () => {
        const world = await opened(RENDERED);
        await linked(world);
        world.draw.emitChange([], false);

        ownerMoves(world, { center: [26.11, 44.44], zoom: 15 });
        world.flush();
        expect(world.georef.state.scanFollow).toBeNull();

        world.draw.emitChange([], true);
        ownerMoves(world, { center: [26.12, 44.44], zoom: 15 });
        world.flush();
        expect(world.georef.state.scanFollow).not.toBeNull();
    });

    it('badPath_aVersionWithoutAFitMovesNothingAndFetchesNothing @S-A16-BAD-GEOREF-LINKED-NO-FIT', async () => {
        const world = await opened(UPLOAD);
        expect(world.georef.state.fit.refusal).toBe('too-few');

        world.georef.intents.scanMoved({ centre: { x: 100, y: 100 }, scale: 1 });
        ownerMoves(world, { center: [26.11, 44.44], zoom: 15 });
        await settle();
        world.flush();

        expect([world.fetched.count, jumps(world).length, world.georef.state.scanFollow, world.frames.length]).toEqual([0, 0, null, 0]);
    });

    it('badPath_aChunkThatFailsToLoadLeavesTheViewsUnlinkedAndAsksOnce @S-A16-BAD-GEOREF-LINKED-NO-FIT', async () => {
        const world = await opened(RENDERED, OFFLINE);

        await linked(world);
        world.georef.intents.scanMoved({ centre: { x: 200, y: 100 }, scale: 1 });
        await settle();
        world.flush();

        expect([world.fetched.count, jumps(world).length]).toEqual([1, 0]);
    });
});
