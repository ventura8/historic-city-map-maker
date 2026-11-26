// The georeferencer shows the version's own map (M15 review, 2026-11-08): the figures and residuals the version page shows, the
// preview of the map that is published (a camera's lattice included), and, once the pairs change, that the result is a refit.
import {
    FIRESTORE_PATHS,
    fitTransform,
    geoToMercator,
    mercatorToGeo,
    scanBounds,
    terrainTransform,
    type BBox,
    type FittedTransform,
    type Gcp,
    type Georef,
    type GeorefTransform,
} from '@hcm/shared';
import type { FakeMapboxMap } from '@hcm/test-support/fake-map';
import { FakeMapDraw } from '@hcm/test-support/fake-map-draw';
import { describe, expect, it } from 'vitest';

import { loadGeorefExtras, type ExtrasLoader } from '../../src/georef/extras.js';
import { loadWarp, WARP_DELAY_MS } from '../../src/georef/georef-pictures.js';
import { warpTriangles } from '../../src/georef/warp.js';
import { georefModule } from '../../src/georef/georef.js';
import type { FakeClock } from '../app/fakes.js';
import { settle } from '../app/fakes.js';
import { factoryOf, host, mapboxHandle } from '../imagery/maps.js';
import { CITY, cityDoc, golden, imageryWorld, VERSIONS } from '../imagery/world.js';

const RENDERED = 'job-1966-0712';
const PREVIEW = 'rasters/bucharest/kh-4a-corona-1966/job-1966-0712/scan-preview.jpg';
const SCAN = { width: 20_480, height: 16_384 };
/** How far east the camera's map lies from the pairs' poly2, EPSG:3857 metres. */
const CAMERA_EAST_M = 300;
const SIDE = 17;

function goldenGeoref(): { readonly gcps: Gcp[]; readonly transform: GeorefTransform } {
    return golden('version.awaiting-approval.json')['georef'] as { gcps: Gcp[]; transform: GeorefTransform };
}

/** The pairs' own poly2, as the page refits it. */
function refitOf(gcps: readonly Gcp[]) {
    const result = fitTransform('poly2', gcps);
    if (!result.ok) {
        throw new Error(result.reason);
    }
    return result.transform;
}

/** 17 x 17 nodes of a map `CAMERA_EAST_M` east of the pairs' poly2: what a camera fitted on every tile stores. */
function lattice(gcps: readonly Gcp[]) {
    const refit = refitOf(gcps);
    const nodes = Array.from({ length: SIDE * SIDE }, (_node, index) => {
        const pixel = { x: ((index % SIDE) * SCAN.width) / (SIDE - 1), y: (Math.floor(index / SIDE) * SCAN.height) / (SIDE - 1) };
        const at = geoToMercator(refit.toGeo(pixel));
        return { pixel, geo: mercatorToGeo({ x: at.x + CAMERA_EAST_M, y: at.y }) };
    });
    return { model: 'panoramic', nodes };
}

/** Ground 100 m up everywhere (2 x 2 cells at 1,000 decimetres), as `georef.terrain.heights` holds it. */
const LEVEL_100_M = { left: 2.8e6, top: 5.6e6, cell: 2e5, columns: 2, rows: 2, baseDm: 1000, valuesDm: 'AAAAAAAAAAA=' };
/** Scan pixels east a metre of height: the terrain's parallax in this stand-in. */
const PIXELS_A_METRE = 1;

/** A frame over terrain: an RPC that is the pairs' affine map, its places shown further east the higher they are. */
function terrain(gcps: readonly Gcp[]): NonNullable<Georef['terrain']> {
    const affine = fitTransform('affine', gcps);
    if (!affine.ok) {
        throw new Error(affine.reason);
    }
    const middle = gcps[0]?.geo ?? { lat: 0, lng: 0 };
    const at = (dLng: number, dLat: number) => affine.transform.toPixel({ lat: middle.lat + dLat, lng: middle.lng + dLng });
    const [here, east, north] = [at(0, 0), at(1e-3, 0), at(0, 1e-3)];
    const row = (axis: 'x' | 'y', parallax: number) => [
        here[axis],
        (east[axis] - here[axis]) * 1e3,
        (north[axis] - here[axis]) * 1e3,
        parallax,
        ...Array.from({ length: 16 }, () => 0),
    ];
    const den = [1, ...Array.from({ length: 19 }, () => 0)];
    const axes = { line: -0.5, samp: -0.5, lat: middle.lat, lng: middle.lng, height: 0 };
    const unit = { line: 1, samp: 1, lat: 1, lng: 1, height: 1 };
    const rpc = { offset: axes, scale: unit, lineNum: row('y', 0), lineDen: den, sampNum: row('x', PIXELS_A_METRE), sampDen: den };
    return { source: 'glo30', reliefM: 4, rpc, heights: LEVEL_100_M };
}

/** The lazy chunk, fetched once before the tests: the page gets it within a few microtasks, as from the browser's module map. */
const EXTRAS = await loadGeorefExtras();
/** The warp chunk, fetched once before the tests (the page's own fetch then finds it in the module map). */
await loadWarp();
const LOADED: ExtrasLoader = () => Promise.resolve(EXTRAS);
/** The chunk's fetch failing: offline, or a deploy replaced it. */
const OFFLINE: ExtrasLoader = () => Promise.reject(new TypeError('Failed to fetch dynamically imported module'));

async function setup(withLattice: boolean, overTerrain = false, extras = LOADED) {
    const { handle, native } = await mapboxHandle(new FakeMapDraw());
    const world = imageryWorld({ maps: factoryOf([{ ok: true, map: handle }]) });
    const doc = golden('version.awaiting-approval.json');
    const georef = goldenGeoref();
    const withTerrain = overTerrain ? { terrain: terrain(georef.gcps) } : {};
    world.store.docs.set(FIRESTORE_PATHS.city(CITY), cityDoc({ imagery: { rmseThresholdM: 5 } }));
    const own = withLattice ? { ...doc, georef: { ...georef, lattice: lattice(georef.gcps), ...withTerrain } } : doc;
    world.store.docs.set(VERSIONS(RENDERED), own);
    world.files.put(PREVIEW);
    const store = georefModule(extras).create(world.services);
    return { ...world, map: native, georef: store, clock: world.services.clock as FakeClock };
}

/** The west edge of the warped preview on the map (longitude). */
function previewWest(map: FakeMapboxMap): number {
    const source = map.sources.get('hcm-picture-warped') as { coordinates?: [number, number][] } | undefined;
    return Math.min(...(source?.coordinates ?? []).map((corner) => corner[0]));
}

/** The west edge of the box the pairs' own refit puts the scan in, moved `east` metres. */
function refitWest(east: number): number {
    const west = scanBounds(refitOf(goldenGeoref().gcps), SCAN)[0][0];
    return mercatorToGeo({ x: geoToMercator({ lat: 44.45, lng: west }).x + east, y: 0 }).lng;
}

async function opened(withLattice: boolean, overTerrain = false, extras = LOADED) {
    const world = await setup(withLattice, overTerrain, extras);
    world.georef.open([RENDERED]);
    world.georef.intents.attachMap(host());
    await settle();
    world.clock.advance(WARP_DELAY_MS);
    return world;
}

describe('the georeferencer shows the version as published', () => {
    it('happyPath_theVersionsOwnFiguresAndResidualsUntilAPairChanges', async () => {
        const { georef, clock } = await opened(false);
        const shown = georef.state.fit;

        georef.intents.toggle('g7');
        clock.advance(WARP_DELAY_MS);
        const edited = georef.state.fit;
        georef.intents.discard();

        expect(shown).toMatchObject({ fitRmseM: 6.1, checkpointRmseM: 8.9, checkpointCount: 2, overThreshold: true, refitted: false });
        expect(shown.residuals).toEqual({ g1: 5.1, g2: 6.8, g3: 7.2, g4: 4.4, g5: 3.9, g6: 8, g7: 9.6, g8: 8.1 });
        expect(edited.fitRmseM).not.toBeCloseTo(6.1, 2);
        expect([edited.checkpointCount, edited.refitted]).toEqual([1, true]);
        expect(georef.state.fit).toEqual(shown);
    });

    // Lattice + terrain open builds a 17×17 map and warps under the suite's load; idle runs finish in ~0.5 s, busy ones need more than Vitest's 5 s (lesson 548).
    it('happyPath_aCameraMappedVersionPreviewsItsLatticeNotThePairsPolynomial', async () => {
        const { georef, map, clock } = await opened(true);
        const shown = previewWest(map);

        georef.intents.toggle('g7');
        clock.advance(WARP_DELAY_MS);
        const edited = previewWest(map);

        expect(shown).toBeCloseTo(refitWest(CAMERA_EAST_M), 4);
        expect(edited).not.toBeCloseTo(refitWest(CAMERA_EAST_M), 3);
        expect(georef.state.fit.refitted).toBe(true);
    }, 20_000);

    it('happyPath_aVersionOverTerrainPreviewsItsRpcOverItsHeights', async () => {
        const { georef, pictures, map } = await opened(true, true);
        const drawn = pictures.drawn.at(-1);
        const corners = (map.sources.get('hcm-picture-warped') as { coordinates?: [number, number][] } | undefined)?.coordinates ?? [];
        const [lngs, lats] = [corners.map((corner) => corner[0]), corners.map((corner) => corner[1])];
        const bounds: BBox = [
            [Math.min(...lngs), Math.min(...lats)],
            [Math.max(...lngs), Math.max(...lats)],
        ];
        const frame = { bounds, width: drawn?.target.width ?? 0, height: drawn?.target.height ?? 0 };
        /** The quads read the scan through `toPixel` alone; the box they are drawn in is the page's own. */
        const nowhere: FittedTransform = { kind: 'tps', toGeo: () => ({ lat: 0, lng: 0 }), toPixel: () => ({ x: 0, y: 0 }) };
        const through = (over: NonNullable<Georef['terrain']>) =>
            warpTriangles(terrainTransform(over, nowhere), frame, SCAN, drawn?.source ?? { canvas: {}, width: 0, height: 0 });
        const over = terrain(goldenGeoref().gcps);

        // Each quad of the preview reads the scan where the layer does (100 m of ground shown 100 pixels east); read at sea level
        // instead, every quad would read elsewhere.
        expect(drawn?.triangles).toEqual(through(over));
        expect(drawn?.triangles).not.toEqual(through({ ...over, heights: { ...over.heights, baseDm: 0 } }));
        expect(georef.state.fit).toMatchObject({ fitRmseM: 6.1, checkpointRmseM: 8.9, refitted: false });
    }, 20_000);

    it('badPath_aChunkThatFailsToLoadSaysSoAndPreviewsThePairsFit @S-A16-BAD-TERRAIN-CHUNK', async () => {
        const { georef, map, notices } = await opened(true, true, OFFLINE);

        expect(notices).toEqual([{ key: 'adminContent.georef.mapUnavailable' }]);
        expect(previewWest(map)).toBeCloseTo(refitWest(0), 4);
        expect(georef.state.fit).toMatchObject({ fitRmseM: 6.1, checkpointRmseM: 8.9, refitted: false });
        expect(georef.state.doc.status).toBe('ready');
    });

    it('badPath_snapWithoutItsChunkRefusesInWordsAndSendsNothing @S-A89-BAD-SNAP-CHUNK', async () => {
        const { georef, callables } = await opened(true, false, OFFLINE);

        await expect(georef.intents.snap()).resolves.toBe(false);

        expect(georef.state).toMatchObject({ saving: false, saved: null, refusal: { key: 'adminContent.georef.snapUnavailable' } });
        expect(callables.calls.some((call) => call.name === 'imagery.recalibrate')).toBe(false);
    });

    it('badPath_aVersionWithoutFiguresOfItsOwnShowsTheRefitAndNoRefitNotice', async () => {
        const world = await setup(false);
        const gcps = goldenGeoref().gcps.map(({ id, pixel, geo, enabled, origin }) => ({ id, pixel, geo, enabled, origin }));
        const georef = { method: 'corners', transform: 'poly2', gcps };
        world.store.docs.set(VERSIONS(RENDERED), { ...golden('version.awaiting-approval.json'), georef });
        world.georef.open([RENDERED]);
        await settle();
        const shown = world.georef.state.fit;
        world.georef.intents.toggle('g7');

        expect(shown.fitRmseM).not.toBeCloseTo(6.1, 2);
        expect([shown.checkpointCount, shown.refitted]).toEqual([2, false]);
        expect(world.georef.state.fit.refitted).toBe(false);
    });
});
