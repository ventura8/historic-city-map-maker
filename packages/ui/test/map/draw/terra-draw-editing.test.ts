import { describe, expect, it } from 'vitest';

import type { DrawnFeature } from '../../../src/map/draw/draw-port.js';
import { createTerraDrawPort } from '../../../src/map/draw/terra-draw-adapter.js';
import { fakeTerraDrawModules } from './fake-terra-draw.js';
import { attached, CITY, PIN, PLACE, polygon, SQUARE, type Position } from './terra-draw-world.js';

describe('Terra Draw adapter: dragging in select', () => {
    it('happyPath_setModeSelectWithAnIdSelectsItForDragging', async () => {
        const { port, td, selections } = await attached();
        port.load([PLACE]);

        port.setMode('select', 'casa-capsa');

        expect(td.mode).toBe('select');
        expect(td.selected).toBe('casa-capsa');
        expect(selections).toEqual(['casa-capsa']);
    });

    it('happyPath_aDragPreviewsEveryFrameAndSettlesAtTheEnd', async () => {
        const { port, td, changes } = await attached();
        port.load([PLACE]);
        port.setMode('select');
        const moved: Position[] = [
            [26.01, 44.4],
            [26.11, 44.4],
            [26.11, 44.5],
            [26.01, 44.5],
            [26.01, 44.4],
        ];
        const dragged = { ...PLACE, geometry: { type: 'Polygon', coordinates: [moved] } };

        td.drag('casa-capsa', polygon(moved), false);
        td.drag('casa-capsa', polygon(moved), true);

        expect(changes).toEqual([
            { features: [dragged], final: false },
            { features: [dragged], final: false },
            { features: [dragged], final: true },
        ]);
        expect(port.snapshot()).toEqual([dragged]);
    });

    it('badPath_aDragOutsideTheCitySnapsBackOnRelease', async () => {
        const { port, td, changes, refusals } = await attached();
        port.load([PLACE]);
        port.setMode('select');

        td.drag('casa-capsa', polygon(SQUARE.map(([lng, lat]): Position => [lng + 1, lat])), true);

        expect(refusals).toEqual([{ kind: 'outside', bounds: CITY }]);
        expect(td.store.get('casa-capsa')?.geometry).toEqual(PLACE.geometry);
        expect(changes.at(-1)).toEqual({ features: [PLACE], final: true });
    });

    it('badPath_changesOfOtherFeaturesOrWhileDrawingAreNotReported', async () => {
        const { port, td, changes } = await attached();
        port.load([PLACE]);

        td.play('change', ['casa-capsa'], 'update');
        port.setMode('select');
        td.store.set('hcm-draw-9', {
            id: 'hcm-draw-9',
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [26.1, 44.4] },
            properties: {},
        });
        td.play('change', ['hcm-draw-9'], 'update');
        td.play('change', ['casa-capsa'], 'styling');
        // A selection's marks change the feature's properties, never its place.
        td.play('change', ['casa-capsa'], 'update', { target: 'properties' });
        td.store.set('casa-capsa', { id: 'casa-capsa', type: 'Feature', geometry: { type: 'Polygon', coordinates: [] }, properties: {} });
        td.play('change', ['casa-capsa'], 'update');

        expect(changes).toEqual([{ features: [], final: false }]);
    });
});

describe('Terra Draw adapter: a click moves the selected point', () => {
    it('happyPath_aClickElsewhereMovesThePinAndKeepsItSelected', async () => {
        const { port, td, click, changes } = await attached();
        port.load([PIN]);
        port.setMode('select', 'photo-location');

        click([26.123456789, 44.44]);

        const moved = { ...PIN, geometry: { type: 'Point', coordinates: [26.1234568, 44.44] } };
        expect(port.snapshot()).toEqual([moved]);
        expect(td.store.get('photo-location')?.geometry).toEqual(moved.geometry);
        expect(td.selected).toBe('photo-location');
        // One change, final: the port's own update of Terra Draw is not echoed as a drag.
        expect(changes).toEqual([{ features: [moved], final: true }]);
    });

    it('badPath_aClickOnThePinItselfOrWithoutAPinSelectedMovesNothing', async () => {
        const { port, td, click, changes, refusals } = await attached();
        port.load([PIN, PLACE]);
        port.setMode('select', 'photo-location');
        td.near = ['photo-location'];

        click([26.1000001, 44.43]);
        port.select('casa-capsa');
        click([26.2, 44.44]);
        click([27, 44.44]);

        expect(port.snapshot()).toEqual([PIN, PLACE]);
        expect(changes).toEqual([]);
        expect(refusals).toEqual([]);
    });

    it('badPath_aClickOutsideTheCityWithAPinSelectedIsRefused', async () => {
        const { port, click, refusals } = await attached();
        port.load([PIN]);
        port.setMode('select', 'photo-location');

        click([27, 44.44]);

        expect(refusals).toEqual([{ kind: 'outside', bounds: CITY }]);
        expect(port.snapshot()).toEqual([PIN]);
    });
});

describe('Terra Draw adapter: loading, selecting, deleting', () => {
    it('happyPath_loadUpdatesWhatItHoldsInPlaceAndLeavesOutWhatBreaksALimit', async () => {
        const { port, td, refusals, selections } = await attached();
        port.load([PLACE]);
        port.select('casa-capsa');
        const line: DrawnFeature = {
            id: 'strada',
            geometry: {
                type: 'LineString',
                coordinates: [
                    [26.0, 44.4],
                    [26.0000000001, 44.5],
                ],
            },
        };

        port.load([line, { id: 'afar', geometry: { type: 'Point', coordinates: [30, 44] } }]);

        expect(refusals).toEqual([{ kind: 'outside', bounds: CITY }]);
        expect(port.snapshot()).toEqual([
            {
                ...line,
                geometry: {
                    type: 'LineString',
                    coordinates: [
                        [26.0, 44.4],
                        [26.0, 44.5],
                    ],
                },
            },
        ]);
        expect([...td.store.keys()]).toEqual(['strada']);
        expect(selections).toEqual(['casa-capsa', null]);
    });

    it('happyPath_aReloadOfTheSelectedShapeKeepsItSelected', async () => {
        const { port, td, selections, changes } = await attached();
        port.load([PLACE]);
        port.setMode('select', 'casa-capsa');
        const moved = {
            ...PLACE,
            geometry: { type: 'Polygon' as const, coordinates: [SQUARE.map(([lng, lat]): Position => [lng, lat + 0.01])] },
        };

        port.load([moved]);

        expect(td.updated).toEqual(['casa-capsa']);
        expect(changes).toEqual([]);
        expect(td.selected).toBe('casa-capsa');
        expect(selections).toEqual(['casa-capsa']);
        expect(port.snapshot()).toEqual([moved]);
    });

    it('badPath_aGeometryTerraDrawWillNotUpdateIsAddedAfresh', async () => {
        const { port, td } = await attached();
        port.load([PLACE]);
        td.failUpdates = true;
        const line = { id: 'casa-capsa', geometry: { type: 'LineString' as const, coordinates: SQUARE.slice(0, 2) } };

        port.load([line]);

        expect(td.removed.at(-1)).toEqual(['casa-capsa']);
        expect(td.store.get('casa-capsa')).toMatchObject({ geometry: line.geometry, properties: { mode: 'linestring' } });
    });

    it('happyPath_selectSwitchesToSelectAndDeselects', async () => {
        const { port, td, selections } = await attached();
        port.load([PLACE]);

        port.select('casa-capsa');
        port.select(null);
        port.select(null);
        port.select('unknown');
        td.play('select', 'hcm-draw-1');

        expect(td.mode).toBe('select');
        expect(td.selected).toBeNull();
        expect(selections).toEqual(['casa-capsa', null]);
    });

    it('happyPath_deleteSelectedRemovesTheFeature', async () => {
        const { port, td, changes } = await attached();
        port.load([PLACE]);
        port.deleteSelected();
        port.select('casa-capsa');

        port.deleteSelected();

        expect(td.store.size).toBe(0);
        expect(port.snapshot()).toEqual([]);
        expect(changes).toEqual([{ features: [], final: true }]);
    });

    it('badPath_callsBeforeAttachOnlyKeepTheState', () => {
        const port = createTerraDrawPort(fakeTerraDrawModules());

        port.deleteSelected();
        port.select('casa-capsa');
        port.setMode('select', 'casa-capsa');
        port.setColor('#000000');
        port.load([PLACE]);

        expect(port.mode).toBe('select');
        expect(port.snapshot()).toEqual([PLACE]);
    });
});

describe('Terra Draw adapter: picks and colour', () => {
    it('happyPath_aPickResolvesWithTheNextMapClickRounded', async () => {
        const { port, click } = await attached();

        const picked = port.pick();
        click([26.123456789, 44.4]);

        await expect(picked).resolves.toEqual([26.1234568, 44.4]);
    });

    it('badPath_escapeAModeChangeOrANewPickCancelThePick', async () => {
        const { port, mapbox, click } = await attached();

        const escaped = port.pick();
        mapbox.canvas.pressKey('a');
        mapbox.canvas.pressKey('Escape');
        const replaced = port.pick();
        const changed = port.pick();
        port.setMode('select');
        click([26.1, 44.4]);

        await expect(escaped).resolves.toBeNull();
        await expect(replaced).resolves.toBeNull();
        await expect(changed).resolves.toBeNull();
    });

    it('happyPath_aNewColourRestylesEveryModeWithoutRedrawingAndKeepsTheSelection', async () => {
        const { port, modules, td } = await attached();
        port.load([PLACE]);
        port.setMode('select', 'casa-capsa');

        port.setColor('#8b5e3c');
        port.setColor('#1f6f43');

        expect(modules.instances).toHaveLength(1);
        expect([...td.styles.keys()]).toEqual(['static', 'point', 'linestring', 'polygon', 'rectangle', 'select']);
        expect(td.styles.get('polygon')?.['outlineColor']).toBe('#1f6f43');
        expect(td.selected).toBe('casa-capsa');
        expect(port.mode).toBe('select');
    });

    it('badPath_aThrowingSubscriberDoesNotStopTheOthers', async () => {
        const { port, td, refusals } = await attached();
        port.on('refused', () => {
            throw new Error('broken subscriber');
        });

        td.validate('point', { type: 'Point', coordinates: [27, 44] });

        expect(refusals).toEqual([{ kind: 'outside', bounds: CITY }]);
    });

    it('happyPath_unsubscribingStopsTheEvents', async () => {
        const { port, td } = await attached();
        const seen: string[] = [];
        const stop = port.on('refused', (refusal) => seen.push(refusal.kind));

        td.validate('point', { type: 'Point', coordinates: [27, 44] });
        stop();
        port.setMode('draw-point');
        td.validate('point', { type: 'Point', coordinates: [27, 44] });

        expect(seen).toEqual(['outside']);
    });
});
