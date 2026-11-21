import { FakeMap } from '@hcm/test-support/fake-map';
import { describe, expect, it } from 'vitest';

import { createTerraDrawPort, SKETCH_ID } from '../../../src/map/draw/terra-draw-adapter.js';
import { geometryOf, positionsOf } from '../../../src/map/draw/terra-draw-features.js';
import { fakeTerraDrawModules, type FakeMode } from './fake-terra-draw.js';
import { attached, CITY, CROSSED, mountedMap, OPTIONS, PLACE, SQUARE, type Position } from './terra-draw-world.js';

const [A, B, C, D] = SQUARE as [Position, Position, Position, Position];

describe('Terra Draw adapter: attaching', () => {
    it('happyPath_attachStartsTerraDrawOnTheMapboxMapWithOurModes', async () => {
        const { td, modules, mapbox, port } = await attached();

        expect(td.started).toBe(true);
        expect(td.mode).toBe('static');
        expect(port.mode).toBe('static');
        expect(modules.adapters).toEqual([{ map: mapbox, coordinatePrecision: 7 }]);
        const modes = td.options.modes as FakeMode[];
        expect(modes.map((mode) => mode.kind)).toEqual(['static', 'point', 'linestring', 'polygon', 'rectangle', 'select']);
        expect(modes[0]?.options?.modeName).toBe('static');
        expect(modes[3]?.options?.styles?.['fillColor']).toBe('#8b5e3c');
        // The select mode keeps its selection on a click elsewhere and leaves the keys to the editor's tools.
        expect(modes[5]?.options).toMatchObject({ modeName: 'select', keyEvents: null, allowManualDeselection: false });
        expect(Object.keys(modes[5]?.options?.flags ?? {})).toEqual(['point', 'linestring', 'polygon', 'rectangle']);
        expect(modes[5]?.options?.flags?.['polygon']).toMatchObject({
            feature: { draggable: true, coordinates: { draggable: true, midpoints: { draggable: true }, deletable: true } },
        });
        expect(td.options.idStrategy.isValidId('casa-capsa')).toBe(true);
        expect(td.options.idStrategy.isValidId('')).toBe(false);
        expect(td.options.idStrategy.getId()).not.toBe(td.options.idStrategy.getId());
    });

    it('badPath_attachWithoutAMapboxMapThrows', () => {
        const port = createTerraDrawPort(fakeTerraDrawModules());

        expect(() => {
            port.attach(new FakeMap(), OPTIONS);
        }).toThrow('draw needs a mounted Mapbox map');
    });

    it('happyPath_featuresLoadedBeforeAttachAreDrawnOnAttach', async () => {
        const { map } = await mountedMap();
        const modules = fakeTerraDrawModules();
        const port = createTerraDrawPort(modules);

        port.load([PLACE]);
        port.attach(map, OPTIONS);

        expect(modules.instances[0]?.store.get('casa-capsa')?.properties).toEqual({ mode: 'polygon' });
        expect(port.snapshot()).toEqual([PLACE]);
    });

    it('badPath_aPolygonWithHolesIsShownByItsOuterRingAndKeptWhole', async () => {
        const { port, td, changes } = await attached();
        const hole: Position[] = [
            [26.04, 44.44],
            [26.06, 44.44],
            [26.06, 44.46],
            [26.04, 44.44],
        ];
        const holed = { id: 'parc', geometry: { type: 'Polygon' as const, coordinates: [SQUARE, hole] } };

        port.load([holed, PLACE]);
        port.setMode('select');
        td.drag('casa-capsa', { type: 'Polygon', coordinates: [SQUARE] }, true);

        expect(td.store.get('parc')).toMatchObject({ geometry: { coordinates: [SQUARE] }, properties: { mode: 'static' } });
        expect(port.snapshot()).toEqual([holed, PLACE]);
        expect(changes.at(-1)).toEqual({ features: [holed, PLACE], final: true });
    });

    it('happyPath_detachStopsTerraDrawAndForgetsTheMap', async () => {
        const { port, td, mapbox, click, changes } = await attached();
        port.setMode('draw-point', 'p');

        port.detach();
        click([26.1, 44.4]);

        expect(td.stopped).toBe(true);
        expect(port.mode).toBe('static');
        expect(mapbox.canvas.listenerCount('keydown')).toBe(1);
        expect(changes).toEqual([]);
        await expect(port.pick()).resolves.toBeNull();
    });
});

describe('Terra Draw adapter: drawing by clicks', () => {
    it('happyPath_anAreaShowsItsFirstClicksThenGrowsWithEveryClick', async () => {
        const { port, td, click, changes } = await attached();
        port.setMode('draw-polygon', 'casa-capsa');

        click(A);
        expect(td.store.get(SKETCH_ID)).toMatchObject({ geometry: { type: 'Point', coordinates: A }, properties: { mode: 'point' } });
        click(B);
        expect(td.store.get(SKETCH_ID)).toMatchObject({
            geometry: { type: 'LineString', coordinates: [A, B] },
            properties: { mode: 'linestring' },
        });
        expect(changes).toEqual([]);
        click(C);
        click(D);

        expect(td.store.has(SKETCH_ID)).toBe(false);
        expect(td.store.get('casa-capsa')?.properties).toEqual({ mode: 'polygon' });
        expect(port.mode).toBe('draw-polygon');
        expect(td.mode).toBe('static');
        expect(changes.map((change) => change.final)).toEqual([true, true]);
        expect(port.snapshot()).toEqual([{ ...PLACE, shape: 'polygon' }]);
        expect(td.updated).toEqual(['casa-capsa']);
    });

    it('happyPath_aPointIsOneClickThenSelectedForDragging', async () => {
        const { port, td, click, selections } = await attached();
        port.setMode('draw-point');

        click([26.1, 44.43]);

        expect(port.snapshot()).toEqual([{ id: 'hcm-draw-1', geometry: { type: 'Point', coordinates: [26.1, 44.43] }, shape: 'point' }]);
        expect(port.mode).toBe('select');
        expect(td.mode).toBe('select');
        expect(td.selected).toBe('hcm-draw-1');
        expect(selections).toEqual(['hcm-draw-1']);
    });

    it('happyPath_aRectangleIsTwoCorners', async () => {
        const { port, td, click } = await attached();
        port.setMode('draw-rectangle', 'bounds');

        click(C);
        click(A);

        expect(port.snapshot()).toEqual([{ ...PLACE, id: 'bounds', shape: 'rectangle' }]);
        expect(td.store.get('bounds')?.properties).toEqual({ mode: 'rectangle' });
        expect(td.selected).toBe('bounds');
    });

    it('badPath_aClickOutsideTheCityOrOneThatCrossesIsRefusedEveryTimeAndTheLastGoodShapeStays', async () => {
        const { port, click, refusals, changes } = await attached();
        port.setMode('draw-polygon', 'casa-capsa');

        click([27, 44.4]);
        click([27, 44.4]);
        for (const position of CROSSED.slice(0, 3)) {
            click(position);
        }
        click(CROSSED.at(3) ?? A);

        expect(refusals).toEqual([{ kind: 'outside', bounds: CITY }, { kind: 'outside', bounds: CITY }, { kind: 'self-intersection' }]);
        expect(changes).toHaveLength(1);
        expect(port.snapshot()[0]?.geometry).toEqual({ type: 'Polygon', coordinates: [[...CROSSED.slice(0, 3), A]] });
    });

    it('badPath_aClickWhileStaticOrWhileAPickWaitsDrawsNothing', async () => {
        const { port, click, changes, refusals } = await attached();

        click([26.1, 44.4]);
        click([27, 44.4]);
        port.setMode('draw-point', 'p');
        const picked = port.pick();
        click([26.1, 44.4]);

        await expect(picked).resolves.toEqual([26.1, 44.4]);
        expect(changes).toEqual([]);
        expect(refusals).toEqual([]);
    });

    it('happyPath_aNewToolDropsTheSketch', async () => {
        const { port, td, click } = await attached();
        port.setMode('draw-linestring', 'strada');
        click(A);

        port.setMode('draw-polygon', 'strada');
        click(B);

        expect(td.store.get(SKETCH_ID)?.geometry).toEqual({ type: 'Point', coordinates: B });
    });

    it('happyPath_validationRefusesPositionsOnAddAndMovesAndTheWholeShapeAtTheEnd', async () => {
        const { td, refusals } = await attached();

        const inside = td.validate('polygon', { type: 'Polygon', coordinates: [SQUARE] });
        const outside = td.validateMove(
            'polygon',
            { type: 'Polygon', coordinates: [SQUARE.map(([lng, lat]) => [lng, lat + 1])] },
            'provisional',
        );
        const crossed = td.validateMove('polygon', { type: 'Polygon', coordinates: [CROSSED] }, 'finish');
        const broken = td.validateMove('polygon', { type: 'Polygon', coordinates: [[[26.0, 44.4]]] }, 'finish');

        expect(inside).toEqual({ valid: true });
        expect(outside).toEqual({ valid: false, reason: 'outside' });
        expect(crossed).toEqual({ valid: false, reason: 'self-intersection' });
        expect(broken).toEqual({ valid: false, reason: 'zero-area' });
        expect(refusals.map((refusal) => refusal.kind)).toEqual(['outside', 'self-intersection', 'zero-area']);
    });

    it('badPath_validationAfterDetachAcceptsEverything', async () => {
        const { port, td } = await attached();

        port.detach();

        expect(td.validate('point', { type: 'Point', coordinates: [27, 44] })).toEqual({ valid: true });
    });
});

describe('Terra Draw adapter: reading geometry', () => {
    it('happyPath_positionsAreFoundAtAnyDepth', () => {
        expect(
            positionsOf([
                [
                    [26, 44],
                    [26.1, 44.1],
                ],
                [[26.2, 44.2]],
            ]),
        ).toEqual([
            [26, 44],
            [26.1, 44.1],
            [26.2, 44.2],
        ]);
        expect(geometryOf({ type: 'Feature', geometry: { type: 'Point', coordinates: [26.1, 44.4] }, properties: {} })).toEqual({
            type: 'Point',
            coordinates: [26.1, 44.4],
        });
    });

    it('badPath_whatIsNotAPositionIsSkippedAndABrokenShapeHasNoGeometry', () => {
        expect(positionsOf('26,44')).toEqual([]);
        expect(positionsOf([['26', 44]])).toEqual([]);
        expect(geometryOf({ type: 'Feature', geometry: { type: 'MultiPoint', coordinates: [] }, properties: {} })).toBeNull();
    });
});
