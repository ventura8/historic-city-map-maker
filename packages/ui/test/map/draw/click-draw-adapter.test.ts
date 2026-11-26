import { MAX_GEOMETRY_VERTICES, MAX_POLYGON_RINGS, type BBox } from '@hcm/shared';
import { FakeMap } from '@hcm/test-support/fake-map';
import { describe, expect, it } from 'vitest';

import { CLICK_DRAW_OVERLAY_ID, createClickDrawPort, drawnPositions, shapeGeometry } from '../../../src/map/draw/click-draw-adapter.js';
import type { DrawChange, DrawOptions, DrawRefusal, MapDrawPort } from '../../../src/map/draw/draw-port.js';
import type { VectorOverlaySpec } from '../../../src/map/map-port.js';

/** A mutable `[lng, lat]`, the type of the manifest geometry's positions. */
type Position = [number, number];

const CITY: BBox = [
    [25.9, 44.3],
    [26.3, 44.55],
];

const OPTIONS: DrawOptions = { limits: CITY, color: '#8b5e3c', maxVertices: MAX_GEOMETRY_VERTICES, maxRings: MAX_POLYGON_RINGS };

interface World {
    readonly port: MapDrawPort;
    readonly map: FakeMap;
    readonly changes: DrawChange[];
    readonly selections: (string | null)[];
    readonly refusals: DrawRefusal[];
}

function attached(options: DrawOptions = OPTIONS): World {
    const map = new FakeMap();
    const port = createClickDrawPort();
    const changes: DrawChange[] = [];
    const selections: (string | null)[] = [];
    const refusals: DrawRefusal[] = [];
    port.on('change', (change) => changes.push(change));
    port.on('select', (id) => selections.push(id));
    port.on('refused', (refusal) => refusals.push(refusal));
    port.attach(map, options);
    return { port, map, changes, selections, refusals };
}

/** The overlay the port drew last. */
function overlay(map: FakeMap): VectorOverlaySpec | undefined {
    return map.callsOf('addVectorOverlay').at(-1)?.[0] as VectorOverlaySpec | undefined;
}

const A: Position = [26.0, 44.4];
const B: Position = [26.1, 44.4];
const C: Position = [26.1, 44.5];
const D: Position = [26.0, 44.5];

describe('click drawing: shapes', () => {
    it('happyPath_aPointIsOneClickThenSelected', () => {
        const { port, map, changes, selections } = attached();
        port.setMode('draw-point', 'casa');

        map.clickMap([26.123456789, 44.43]);

        expect(changes).toEqual([
            { features: [{ id: 'casa', geometry: { type: 'Point', coordinates: [26.1234568, 44.43] }, shape: 'point' }], final: true },
        ]);
        expect(port.mode).toBe('select');
        expect(selections).toEqual(['casa']);
        expect(overlay(map)).toMatchObject({ id: CLICK_DRAW_OVERLAY_ID, clickable: false, color: '#8b5e3c', visible: true, opacity: 1 });
        expect(overlay(map)?.features[0]?.properties.id).toBe('hcm-draw:casa');
    });

    it('happyPath_anAreaExistsFromItsThirdClickAndGrowsWithEveryClick', () => {
        const { port, map, changes } = attached();
        port.setMode('draw-polygon', 'piata');

        map.clickMap(A);
        expect(overlay(map)?.features.map((feature) => feature.geometry.type)).toEqual(['Point']);
        map.clickMap(B);
        expect(overlay(map)?.features.map((feature) => feature.geometry.type)).toEqual(['LineString']);
        map.clickMap(C);
        map.clickMap(D);

        expect(changes.map((change) => change.features[0]?.geometry)).toEqual([
            { type: 'Polygon', coordinates: [[A, B, C, A]] },
            { type: 'Polygon', coordinates: [[A, B, C, D, A]] },
        ]);
        expect(port.mode).toBe('draw-polygon');
        expect(overlay(map)?.features.map((feature) => feature.geometry.type)).toEqual(['Polygon']);
    });

    it('happyPath_aLineExistsFromItsSecondClick', () => {
        const { port, map, changes } = attached();
        port.setMode('draw-linestring');

        map.clickMap(A);
        map.clickMap(B);
        map.clickMap(C);

        expect(changes.map((change) => change.features)).toEqual([
            [{ id: 'hcm-draw-1', geometry: { type: 'LineString', coordinates: [A, B] }, shape: 'linestring' }],
            [{ id: 'hcm-draw-1', geometry: { type: 'LineString', coordinates: [A, B, C] }, shape: 'linestring' }],
        ]);
    });

    it('happyPath_aRectangleIsTwoCornersAndANewOneStartsAfresh', () => {
        const { port, map, changes } = attached();
        port.setMode('draw-rectangle', 'bounds');

        map.clickMap(C);
        map.clickMap(A);
        port.setMode('draw-rectangle', 'bounds');
        map.clickMap([26.05, 44.45]);
        map.clickMap(C);

        expect(changes.map((change) => change.features[0]?.geometry)).toEqual([
            { type: 'Polygon', coordinates: [[A, B, C, D, A]] },
            {
                type: 'Polygon',
                coordinates: [
                    [
                        [26.05, 44.45],
                        [26.1, 44.45],
                        [26.1, 44.5],
                        [26.05, 44.5],
                        [26.05, 44.45],
                    ],
                ],
            },
        ]);
        expect(port.mode).toBe('select');
    });

    it('badPath_clicksOutsideTheCityOrThatCrossTheAreaAreRefused', () => {
        const { port, map, changes, refusals } = attached();
        port.setMode('draw-polygon', 'piata');

        map.clickMap([27, 44.4]);
        map.clickMap(A);
        map.clickMap(C);
        map.clickMap(B);
        map.clickMap([26.0, 44.45]);

        expect(refusals).toEqual([{ kind: 'outside', bounds: CITY }, { kind: 'self-intersection' }]);
        expect(changes.map((change) => change.features[0]?.geometry)).toEqual([{ type: 'Polygon', coordinates: [[A, C, B, A]] }]);
    });

    it('badPath_clicksOutsideADrawingModeOrBeforeAttachDoNothing', () => {
        const { port, map, changes, refusals } = attached();
        const detached = createClickDrawPort();

        map.clickMap(A);
        port.setMode('select');
        map.clickMap(A);
        map.clickMap([27, 44.4]);
        detached.setMode('draw-point');

        expect(changes).toEqual([]);
        expect(refusals).toEqual([]);
        expect(detached.snapshot()).toEqual([]);
    });

    it('happyPath_inSelectAClickMovesTheSelectedPoint', () => {
        const { port, map, changes, refusals } = attached();
        port.load([
            { id: 'pin', geometry: { type: 'Point', coordinates: A } },
            { id: 'piata', geometry: { type: 'Polygon', coordinates: [[A, B, C, A]] } },
        ]);
        port.setMode('select');
        port.select('pin');

        map.clickMap(D);
        map.clickMap([27, 44.4]);
        port.select('piata');
        map.clickMap(B);

        expect(changes.map((change) => change.features[0]?.geometry)).toEqual([{ type: 'Point', coordinates: D }]);
        expect(refusals).toEqual([{ kind: 'outside', bounds: CITY }]);
        expect(port.snapshot()[1]?.geometry).toEqual({ type: 'Polygon', coordinates: [[A, B, C, A]] });
    });
});

describe('click drawing: loading, selection, deletion', () => {
    it('happyPath_loadDrawsTheShapesAndAreasGoOnFromTheirRing', () => {
        const { port, map, changes } = attached();
        port.load([{ id: 'piata', geometry: { type: 'Polygon', coordinates: [[A, B, C, A]] } }]);
        port.setMode('draw-polygon', 'piata');

        map.clickMap(D);

        expect(changes.at(-1)?.features[0]?.geometry).toEqual({ type: 'Polygon', coordinates: [[A, B, C, D, A]] });
        expect(overlay(map)?.features).toHaveLength(1);
    });

    it('badPath_loadLeavesOutWhatBreaksALimitAndForgetsAGoneSelection', () => {
        const { port, selections, refusals } = attached();
        port.load([{ id: 'casa', geometry: { type: 'Point', coordinates: A } }]);
        port.select('casa');
        port.select('casa');

        port.load([{ id: 'afar', geometry: { type: 'Point', coordinates: [27, 44] } }]);
        port.select('afar');

        expect(port.snapshot()).toEqual([]);
        expect(refusals).toEqual([{ kind: 'outside', bounds: CITY }]);
        expect(selections).toEqual(['casa', null]);
    });

    it('happyPath_aLoadBeforeAttachIsDrawnOnAttach', () => {
        const map = new FakeMap();
        const port = createClickDrawPort();

        port.load([{ id: 'casa', geometry: { type: 'Point', coordinates: [26.000000049, 44.4] } }]);
        port.attach(map, OPTIONS);

        expect(port.snapshot()).toEqual([{ id: 'casa', geometry: { type: 'Point', coordinates: A } }]);
        expect(overlay(map)?.features).toHaveLength(1);
    });

    it('happyPath_deleteSelectedRemovesTheShape', () => {
        const { port, changes, selections } = attached();
        port.load([{ id: 'casa', geometry: { type: 'Point', coordinates: A } }]);
        port.deleteSelected();
        port.select('casa');

        port.deleteSelected();

        expect(port.snapshot()).toEqual([]);
        expect(selections).toEqual(['casa', null]);
        expect(changes).toEqual([{ features: [], final: true }]);
    });

    it('happyPath_aModeChangeDropsTheSketch', () => {
        const { port, map } = attached();
        port.setMode('draw-polygon');
        map.clickMap(A);

        port.setMode('select');
        port.setMode('static');

        expect(overlay(map)?.features).toEqual([]);
        expect(map.callsOf('addVectorOverlay')).toHaveLength(3);
    });
});

describe('click drawing: picks, colour, detach', () => {
    it('happyPath_aPickTakesTheNextClickInsteadOfDrawing', async () => {
        const { port, map, changes } = attached();
        port.setMode('draw-point');

        const picked = port.pick();
        map.clickMap([26.1234567891, 44.4]);

        await expect(picked).resolves.toEqual([26.1234568, 44.4]);
        expect(changes).toEqual([]);
    });

    it('badPath_aModeChangeOrANewPickCancelsAPickAndADetachedPortPicksNothing', async () => {
        const { port } = attached();
        const first = port.pick();
        const second = port.pick();
        port.setMode('select');

        await expect(first).resolves.toBeNull();
        await expect(second).resolves.toBeNull();
        await expect(createClickDrawPort().pick()).resolves.toBeNull();
    });

    it('happyPath_aNewColourRedrawsTheShapes', () => {
        const { port, map } = attached();

        port.setColor('#1f6f43');
        createClickDrawPort().setColor('#000000');

        expect(overlay(map)?.color).toBe('#1f6f43');
    });

    it('happyPath_detachRemovesTheOverlayAndStopsListening', () => {
        const { port, map, changes } = attached();
        port.setMode('draw-point');

        port.detach();
        map.clickMap(A);

        expect(map.callsOf('removeLayer')).toEqual([[CLICK_DRAW_OVERLAY_ID]]);
        expect(port.mode).toBe('static');
        expect(changes).toEqual([]);
        expect(map.listenerCount).toBe(0);
    });

    it('badPath_aThrowingSubscriberDoesNotStopDrawing', () => {
        const { port, map, changes } = attached();
        const stop = port.on('change', () => {
            throw new Error('broken subscriber');
        });
        port.setMode('draw-point');

        map.clickMap(A);
        stop();

        expect(changes).toHaveLength(1);
    });
});

describe('click drawing: geometry from positions', () => {
    it('happyPath_positionsMakeTheirShapeOnceThereAreEnough', () => {
        expect(shapeGeometry('point', [A])).toEqual({ type: 'Point', coordinates: A });
        expect(shapeGeometry('linestring', [A, B])).toEqual({ type: 'LineString', coordinates: [A, B] });
        expect(shapeGeometry('polygon', [A, B, C])).toEqual({ type: 'Polygon', coordinates: [[A, B, C, A]] });
        expect(drawnPositions({ type: 'Polygon', coordinates: [[A, B, C, A]] })).toEqual([A, B, C]);
        expect(drawnPositions({ type: 'Polygon', coordinates: [] })).toEqual([]);
        expect(drawnPositions({ type: 'LineString', coordinates: [A, B] })).toEqual([A, B]);
        expect(drawnPositions({ type: 'Point', coordinates: A })).toEqual([A]);
    });

    it('badPath_tooFewPositionsMakeNoShape', () => {
        expect(shapeGeometry('point', [])).toBeNull();
        expect(shapeGeometry('linestring', [A])).toBeNull();
        expect(shapeGeometry('polygon', [A, B])).toBeNull();
        expect(shapeGeometry('rectangle', [A])).toBeNull();
    });
});
