// The georeferencer's panes turned together (`rotation.ts`, the linked ports of `link.ts`): once a fit exists the map takes the
// bearing that suits the scan and the scan the angle that suits the map, and each pane turns on its own (S-A16-HAPPY-GEOREF-ROTATE);
// turned apart, or without a fit, a pane's turn leaves the other as it is (S-A16-BAD-GEOREF-ROTATE-APART).
import { fitTransform, FIRESTORE_PATHS, geoToMercator, mercatorToGeo, type FittedTransform, type Gcp, type MapView } from '@hcm/shared';
import { FakeMap } from '@hcm/test-support/fake-map';
import { FakeMapDraw } from '@hcm/test-support/fake-map-draw';
import { describe, expect, it } from 'vitest';

import { loadGeorefExtras } from '../../src/georef/extras.js';
import { georefModule } from '../../src/georef/georef.js';
import { angleFor, bearingFor, fitAngle } from '../../src/georef/rotation.js';
import { createMapPreview } from '../../src/map/preview.js';
import { settle } from '../app/fakes.js';
import { factoryOf, host } from '../imagery/maps.js';
import { CITY, cityDoc, golden, imageryWorld, VERSIONS } from '../imagery/world.js';
import { fakeFrames } from '../map/support.js';

const UPLOAD = 'up-plan1911';
const RENDERED = 'job-1966-0712';
const EXTRAS = await loadGeorefExtras();

/** A fit of four pairs: `turned(x, y)` says where on the ground (Web Mercator metres from a corner) the scan pixel lies. */
function fitOf(turned: (x: number, y: number) => readonly [number, number]): FittedTransform {
    const pairs: Gcp[] = [
        [0, 0],
        [1000, 0],
        [0, 1000],
        [1000, 1000],
    ].map(([x = 0, y = 0], index) => {
        const [east, north] = turned(x, y);
        const geo = mercatorToGeo({ x: 2_888_740 + east, y: 5_550_954 + north });
        return { id: `g${String(index + 1)}`, pixel: { x, y }, geo, enabled: true, origin: 'manual' };
    });
    const fitted = fitTransform('affine', pairs);
    if (!fitted.ok) {
        throw new Error('the pairs give no fit');
    }
    return fitted.transform;
}

/** North up: the scan's x goes east, its y south. */
const NORTH_UP = fitOf((x, y) => [2 * x, -2 * y]);
/** The film lay a quarter turn round: the scan's x goes south, its y west. */
const QUARTER = fitOf((x, y) => [-2 * y, -2 * x]);

describe('the angle the fit gives', () => {
    it('happyPath_aNorthUpScanIsUprightAndATurnedOneTurnsByItsFit @S-A16-HAPPY-GEOREF-ROTATE', () => {
        const at = { x: 500, y: 500 };
        expect(fitAngle(NORTH_UP, at)).toBeCloseTo(0, 9);
        // The scan's x points south on the map: a quarter turn clockwise on a north-up map.
        expect(fitAngle(QUARTER, at)).toBeCloseTo(Math.PI / 2, 6);

        // A north-up map shows the quarter-turned scan a quarter turn round; the map turned to bearing 90 shows it upright.
        expect(angleFor(QUARTER, at, 0)).toBeCloseTo(Math.PI / 2, 6);
        expect(angleFor(QUARTER, at, 90)).toBeCloseTo(0, 6);
        // The scan kept upright: the map turns to bearing 90; the scan turned with the map: north up.
        expect(bearingFor(QUARTER, at, 0)).toBeCloseTo(90, 4);
        expect(bearingFor(QUARTER, at, Math.PI / 2)).toBeCloseTo(0, 4);
        // Bearings stay within a half turn either way.
        expect(bearingFor(NORTH_UP, at, Math.PI * 1.5)).toBeCloseTo(90, 4);
        expect(geoToMercator(NORTH_UP.toGeo(at)).x).toBeCloseTo(2_888_740 + 1000, 3);
    });

    it('badPath_aFitWithNoPlaceThereGivesNoAngle @S-A16-BAD-GEOREF-ROTATE-APART', () => {
        const nowhere: FittedTransform = { ...NORTH_UP, toGeo: () => ({ lat: Number.NaN, lng: Number.NaN }) };

        expect(bearingFor(nowhere, { x: 1, y: 1 }, 0)).toBeNull();
        expect(angleFor(nowhere, { x: 1, y: 1 }, 0)).toBeNull();
    });
});

function setup() {
    const map = new FakeMap();
    map.view = { center: [26.1, 44.45], zoom: 13, bearing: 0 };
    const handle = {
        port: map,
        preview: createMapPreview(map, fakeFrames()),
        draw: () => Promise.resolve(new FakeMapDraw()),
        destroy: () => undefined,
    };
    const world = imageryWorld({ maps: factoryOf([{ ok: true, map: handle }]) });
    world.store.docs.set(FIRESTORE_PATHS.city(CITY), cityDoc({ imagery: { rmseThresholdM: 5 } }));
    world.store.docs.set(VERSIONS(UPLOAD), golden('version.needs-gcps.json'));
    world.store.docs.set(VERSIONS(RENDERED), golden('version.awaiting-approval.json'));
    const frames: (() => void)[] = [];
    const georef = georefModule(
        () => Promise.resolve(EXTRAS),
        (run) => {
            frames.push(run);
        },
    ).create(world.services);
    const flush = (): void => {
        for (const run of frames.splice(0)) {
            run();
        }
    };
    return { georef, map, flush };
}

async function opened(id: string) {
    const world = setup();
    world.georef.open([id]);
    world.georef.intents.attachMap(host());
    await settle();
    // The first move fetches the linked views' chunk.
    world.georef.intents.scanMoved({ centre: { x: 100, y: 100 }, scale: 1, angle: 0 });
    await settle();
    world.flush();
    return world;
}

/** The bearing of the map's last jump (undefined: it kept its own). */
function lastBearing(map: FakeMap): number | undefined {
    return (map.callsOf('flyTo').at(-1)?.[0] as Partial<MapView> | undefined)?.bearing;
}

describe('the panes turn together through the store', () => {
    it('happyPath_theScanTurnedTurnsTheMapAndTheMapTurnedTurnsTheScan @S-A16-HAPPY-GEOREF-ROTATE', async () => {
        const world = await opened(RENDERED);
        expect(world.georef.state.rotateLinked).toBe(true);
        const upright = lastBearing(world.map) ?? Number.NaN;
        expect(Number.isFinite(upright)).toBe(true);

        // The owner turns the scan a quarter turn clockwise: the map's bearing falls by 90 degrees (the ground turns with it).
        world.georef.intents.scanMoved({ centre: { x: 100, y: 100 }, scale: 1, angle: Math.PI / 2 });
        world.flush();
        const turned = lastBearing(world.map) ?? Number.NaN;
        // About a quarter turn: the version's own fit is not a pure turn and scale.
        expect(Math.abs(((((upright - turned) % 360) + 360) % 360) - 90)).toBeLessThan(5);
        expect(world.georef.state.scanAngle).toBeCloseTo(Math.PI / 2, 9);

        // A pan of the map that does not turn it reads no angle back: the scan keeps the turn the owner gave it.
        const panned = world.map.view;
        world.map.emit('move', { ...panned, center: [panned.center[0] + 0.001, panned.center[1]] });
        world.flush();
        expect(world.georef.state.scanFollow?.angle).toBeUndefined();
        expect(world.georef.state.scanAngle).toBeCloseTo(Math.PI / 2, 9);

        // The owner turns the map (same centre, same zoom) by 30 degrees: the scan follows by the same angle.
        const before = world.map.view;
        world.map.emit('move', { ...before, bearing: before.bearing + 30 });
        world.flush();
        const follow = world.georef.state.scanFollow;
        expect(follow?.angle).toBeDefined();
        const turnedBy = (follow?.angle ?? 0) - Math.PI / 2;
        expect(Math.abs(turnedBy + (30 * Math.PI) / 180)).toBeLessThan(0.1);
        expect(world.georef.state.scanAngle).toBe(follow?.angle);

        // The map's own buttons: 15 degrees clockwise on the screen is 15 degrees less bearing; null is north up.
        world.map.view = { ...world.map.view, bearing: 40 };
        world.georef.intents.rotateMap(15);
        expect(lastBearing(world.map)).toBe(25);
        expect(world.map.callsOf('flyTo').at(-1)?.[1]).toEqual({ animate: false });
        world.georef.intents.rotateMap(null);
        expect(lastBearing(world.map)).toBe(0);
    });

    it('badPath_turnedApartOrWithoutAFitAPanesTurnLeavesTheOtherAsItIs @S-A16-BAD-GEOREF-ROTATE-APART', async () => {
        const world = await opened(RENDERED);
        world.georef.intents.setRotateLinked(false);

        world.georef.intents.scanMoved({ centre: { x: 100, y: 100 }, scale: 1, angle: 1 });
        world.flush();
        // The map still goes to the scan's place, with the bearing it had.
        expect(lastBearing(world.map)).toBeUndefined();
        const before = world.map.view;
        world.map.emit('move', { ...before, center: [26.12, 44.44], bearing: 70 });
        world.flush();
        expect(world.georef.state.scanFollow?.angle).toBeUndefined();
        expect(world.georef.state.scanAngle).toBe(1);

        // A scan still waiting for its first points has none: nothing links, and the map's buttons still turn it.
        const waiting = await opened(UPLOAD);
        const jumps = waiting.map.callsOf('flyTo').length;
        waiting.georef.intents.scanMoved({ centre: { x: 10, y: 10 }, scale: 1, angle: 2 });
        waiting.flush();
        expect(waiting.map.callsOf('flyTo')).toHaveLength(jumps);
        waiting.georef.intents.rotateMap(-15);
        expect(lastBearing(waiting.map)).toBe(15);

        // Kept while the admin is open: the next version opens with the panes still turned apart.
        world.georef.close();
        expect(world.georef.state.rotateLinked).toBe(false);
    });
});
