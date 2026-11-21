import type { BBox, Geometry } from '@hcm/shared';
import type { RasterLayerSpec, VectorOverlaySpec } from '@hcm/ui/map';
import { describe, expect, it } from 'vitest';

import { testLog } from '../app/fakes.js';
import type { AdminMapFactory } from '../../src/map/factory.js';
import { overlayOf, PoisMap, UNCATEGORISED_COLOR, type EditTarget, type MapStatus } from '../../src/pois/map-session.js';
import type { CityFrame } from '../../src/pois/model.js';
import { AREA, CONTAINER, FakeMaps, POINT, settle } from './world.js';

const CITY_BOUNDS: BBox = [
    [26, 44.3],
    [26.3, 44.55],
];

const FRAME: CityFrame = { bounds: CITY_BOUNDS, view: { center: [26.1, 44.43], zoom: 14, bearing: 0 } };

const CHURCHES = overlayOf({ id: 'biserici', color: '#8b5e3c', icon: 'church', defaultOpacity: 0.9 }, [
    { id: 'stavropoleos', geometry: POINT, title: 'Stavropoleos' },
    { id: 'antim', geometry: { type: 'Point', coordinates: [26.09, 44.42] }, title: 'Antim' },
]);

interface Session {
    readonly map: PoisMap;
    readonly maps: FakeMaps;
    readonly statuses: MapStatus[];
    readonly clicked: string[];
    readonly drawn: Geometry[];
    readonly refused: string[];
}

function session(factory: AdminMapFactory | null = new FakeMaps()): Session {
    const statuses: MapStatus[] = [];
    const clicked: string[] = [];
    const drawn: Geometry[] = [];
    const refused: string[] = [];
    const map = new PoisMap({
        maps: factory,
        locale: () => 'en',
        log: testLog().log,
        status: (status) => statuses.push(status),
        clicked: (id) => clicked.push(id),
        drawn: (geometry) => drawn.push(geometry),
        refused: (kind) => refused.push(kind),
    });
    return { map, maps: factory instanceof FakeMaps ? factory : new FakeMaps(), statuses, clicked, drawn, refused };
}

async function ready(): Promise<Session> {
    const created = session();
    created.map.attach(CONTAINER);
    created.map.setFrame(FRAME);
    await settle();
    return created;
}

function overlays(maps: FakeMaps, id: string): VectorOverlaySpec[] {
    return maps.map
        .callsOf('addVectorOverlay')
        .map((args) => args[0] as VectorOverlaySpec)
        .filter((spec) => spec.id === id);
}

const NEW_PLACE: EditTarget = { id: 'nou', category: 'biserici', geometry: null, shape: 'polygon', color: '#8b5e3c' };

describe('the places map: creation', () => {
    it('happyPath_theMapWaitsForTheHostAndTheCityThenDrawsAndAttachesTheTools', async () => {
        const { map, maps, statuses } = session();

        map.setFrame(FRAME);
        expect(maps.created).toEqual([]);
        map.attach(CONTAINER);
        map.attach(CONTAINER);
        await settle();
        map.setFrame(FRAME);

        expect(maps.created).toEqual([{ container: CONTAINER, options: { bounds: CITY_BOUNDS, view: FRAME.view, locale: 'en' } }]);
        expect(statuses).toEqual(['none', 'loading', 'ready']);
        expect(maps.draw.attached?.options).toEqual({
            limits: [
                [25.5, 43.8],
                [26.8, 45.05],
            ],
            maxVertices: 500,
            maxRings: 20,
            color: UNCATEGORISED_COLOR,
        });
        expect(map.port).toBe(maps.map);
    });

    it('badPath_withoutAFactoryOrWithARefusalTheMapSaysWhy', async () => {
        const none = session(null);
        const refusing = new FakeMaps();
        refusing.refuse = 'no-token';
        const refused = session(refusing);

        expect(none.map.centre()).toBeNull();
        none.map.setFrame(FRAME);
        none.map.attach(CONTAINER);
        refused.map.setFrame(FRAME);
        refused.map.attach(CONTAINER);
        await settle();

        expect(none.statuses).toEqual(['none', 'failed']);
        expect(refused.statuses).toEqual(['none', 'loading', 'no-token']);
        expect(none.map.port).toBeNull();
        expect(none.map.centre()).toEqual(FRAME.view.center);
        none.map.zoomBy(1);
    });

    it('badPath_aPageThatLeavesWhileItsMapLoadsDestroysTheLateMap', async () => {
        const maps = new FakeMaps();
        maps.hold = true;
        const { map, statuses } = session(maps);
        map.setFrame(FRAME);
        map.attach(CONTAINER);
        await settle();

        map.detach();
        maps.release();
        await settle();

        expect(maps.destroyed).toBe(1);
        expect(statuses).toEqual(['none', 'loading', 'none']);
    });

    it('badPath_aRefusalAfterThePageLeftIsDropped', async () => {
        const maps = new FakeMaps();
        maps.hold = true;
        maps.refuse = 'failed';
        const { map, statuses } = session(maps);
        map.setFrame(FRAME);
        map.attach(CONTAINER);
        await settle();

        map.detach();
        maps.release();
        await settle();

        expect(statuses).toEqual(['none', 'loading', 'none']);
    });

    it('badPath_aPageThatLeavesWhileTheToolsLoadAttachesNothing', async () => {
        const maps = new FakeMaps();
        maps.holdDraw = true;
        const { map, statuses } = session(maps);
        map.setFrame(FRAME);
        map.attach(CONTAINER);
        await settle();

        map.detach();
        maps.releaseDraw();
        await settle();

        expect(maps.draw.attached).toBeNull();
        expect(statuses).toEqual(['none', 'loading', 'none']);
        expect(maps.destroyed).toBe(1);
    });
});

describe('the places map: places and the open place', () => {
    it('happyPath_everyCategoryIsDrawnAndAClickOnAPlaceSelectsIt', async () => {
        const { map, maps, clicked } = await ready();

        map.showPlaces([CHURCHES]);
        maps.map.clickPoi('antim');

        expect(overlays(maps, 'biserici').at(-1)).toEqual(CHURCHES);
        expect(clicked).toEqual(['antim']);
    });

    it('happyPath_aNewPlaceIsDrawnInItsCategorysColourThenEdited', async () => {
        const { map, maps, drawn } = await ready();
        map.showPlaces([CHURCHES]);

        map.edit(NEW_PLACE);
        expect(maps.draw.callsOf('setColor')).toEqual([['#8b5e3c']]);
        expect(maps.draw.callsOf('load')).toEqual([]);
        expect(maps.draw.mode).toBe('draw-polygon');
        expect(maps.draw.drawId).toBe('nou');
        maps.draw.emitChange([{ id: 'nou', geometry: AREA }], false);
        maps.draw.emitChange([{ id: 'other', geometry: POINT }]);
        maps.draw.emitChange([{ id: 'nou', geometry: AREA }]);
        expect(drawn).toEqual([AREA]);

        map.edit({ ...NEW_PLACE, geometry: AREA });
        expect(maps.draw.callsOf('load')).toEqual([]);
        expect(maps.draw.callsOf('setMode')).toHaveLength(1);
    });

    it('badPath_aNewPlaceAppliedAgainBeforeItsShapeExistsKeepsItsFirstClicks', async () => {
        const { map, maps } = await ready();
        map.edit(NEW_PLACE);

        // Its category arrives (a new colour) while the area has its first corner: the tools keep drawing it.
        map.edit({ ...NEW_PLACE, color: '#1f6f43' });
        map.edit({ ...NEW_PLACE, color: '#1f6f43' });

        expect(maps.draw.callsOf('setMode')).toEqual([['draw-polygon', 'nou']]);
        expect(maps.draw.callsOf('setColor').at(-1)).toEqual(['#1f6f43']);

        // The Select tool, then the target again: its shape is still to draw, so the tools draw it again.
        map.setMode('select');
        map.edit({ ...NEW_PLACE, color: '#1f6f43' });
        expect(maps.draw.mode).toBe('draw-polygon');
    });

    it('happyPath_aStoredPlaceLeavesItsCategoryAndIsLoadedIntoTheTools', async () => {
        const { map, maps } = await ready();
        map.showPlaces([CHURCHES]);

        map.edit({ id: 'antim', category: 'biserici', geometry: CHURCHES.features[1]?.geometry ?? null, shape: 'point', color: '#8b5e3c' });
        maps.frames.run();
        map.setMode('draw');
        map.setMode('select');

        expect(maps.draw.callsOf('load').at(-1)).toEqual([
            [{ id: 'antim', geometry: { type: 'Point', coordinates: [26.09, 44.42] }, shape: 'point' }],
        ]);
        expect(
            overlays(maps, 'biserici')
                .at(-1)
                ?.features.map((feature) => feature.properties.id),
        ).toEqual(['stavropoleos']);
        expect(maps.draw.callsOf('setMode')).toEqual([
            ['select', 'antim'],
            ['draw-point', 'antim'],
            ['select', 'antim'],
        ]);
    });

    it('happyPath_closingThePlaceClearsTheToolsAndRestoresItsCategory', async () => {
        const { map, maps, refused } = await ready();
        map.showPlaces([CHURCHES]);
        map.edit({ id: 'antim', category: 'biserici', geometry: POINT, shape: 'point', color: '#8b5e3c' });
        maps.frames.run();
        maps.draw.emitRefused({ kind: 'outside', bounds: CITY_BOUNDS });

        map.edit(null);
        map.setMode('draw');

        expect(refused).toEqual(['outside']);
        expect(maps.draw.callsOf('load').at(-1)).toEqual([[]]);
        expect(maps.draw.mode).toBe('static');
        expect(overlays(maps, 'biserici').at(-1)?.features).toHaveLength(2);
    });

    it('happyPath_aRedrawnPlaceEmptiesTheToolsAndDrawsAgain', async () => {
        const { map, maps, drawn } = await ready();
        map.edit({ id: 'antim', category: 'biserici', geometry: POINT, shape: 'point', color: '#8b5e3c' });

        map.edit({ id: 'antim', category: 'biserici', geometry: null, shape: 'linestring', color: '#8b5e3c' });
        map.edit(null);
        maps.draw.emitChange([{ id: 'antim', geometry: POINT }]);

        expect(maps.draw.callsOf('load').slice(-2)).toEqual([[[]], [[]]]);
        expect(maps.draw.callsOf('setMode')).toContainEqual(['draw-linestring', 'antim']);
        expect(drawn).toEqual([]);
    });

    it('happyPath_aTargetSetBeforeTheMapIsShownOnceItIsReady', async () => {
        const { map, maps } = session();
        map.edit({ ...NEW_PLACE, color: '#1f6f43' });
        map.showPlaces([CHURCHES]);
        map.setMode('select');

        map.attach(CONTAINER);
        map.setFrame(FRAME);
        await settle();

        expect(maps.draw.attached?.options.color).toBe('#1f6f43');
        expect(maps.draw.mode).toBe('draw-polygon');
    });
});

describe('the places map: the camera', () => {
    it('happyPath_aPlaceOpenedWithAShapeIsBroughtIntoViewOnce', async () => {
        const { map, maps } = await ready();
        const antim: EditTarget = {
            id: 'antim',
            category: 'biserici',
            geometry: {
                type: 'LineString',
                coordinates: [
                    [26.08, 44.41],
                    [26.1, 44.42],
                ],
            },
            shape: 'linestring',
            color: '#8b5e3c',
        };

        map.edit(NEW_PLACE);
        map.edit(antim);
        map.edit({
            ...antim,
            geometry: {
                type: 'LineString',
                coordinates: [
                    [26.08, 44.41],
                    [26.12, 44.42],
                ],
            },
        });

        // The new place has no shape to show; the line's centre once, not again for an edit of it.
        expect(maps.map.callsOf('flyTo')).toEqual([[{ center: [26.09, 44.415] }, { animate: false }]]);
    });

    it('happyPath_theCentreAndTheZoomButtons', async () => {
        const { map, maps } = await ready();
        maps.map.view = { center: [26.12, 44.44], zoom: 15, bearing: 0 };

        map.zoomBy(1);

        expect(map.centre()).toEqual([26.12, 44.44]);
        expect(maps.map.callsOf('flyTo')).toEqual([[{ zoom: 16 }, undefined]]);
    });
});

const OLD_MAP: RasterLayerSpec = {
    id: 'plan-1911',
    source: { type: 'mapbox', tilesetId: 'hcm.plan-1911' },
    minzoom: 10,
    maxzoom: 18,
    visible: true,
    opacity: 1,
    order: 1,
    attribution: '',
};

function rasters(maps: FakeMaps): RasterLayerSpec[] {
    return maps.map.callsOf('addRasterLayer').map((args) => args[0] as RasterLayerSpec);
}

describe('the places map: the old map a street is traced on (M27)', () => {
    it('happyPath_theChosenOldMapGoesUnderTheDrawingAndFades', async () => {
        const { map, maps } = await ready();
        map.showPlaces([CHURCHES]);

        map.showLayer(OLD_MAP);
        expect(rasters(maps).at(-1)).toEqual(OLD_MAP);
        expect(overlays(maps, 'biserici').at(-1)).toEqual(CHURCHES);

        map.setLayerOpacity(0.4);
        maps.frames.run();
        expect(maps.map.callsOf('setOverlayOpacity')).toContainEqual(['plan-1911', 0.4]);
        // A later redraw of the places keeps the faded map.
        map.showPlaces([CHURCHES]);
        expect(rasters(maps).at(-1)?.opacity).toBeCloseTo(0.4);

        map.showLayer(null);
        expect(maps.map.callsOf('removeLayer')).toContainEqual(['plan-1911']);
    });

    it('badPath_withoutAMapOrAnOldMapNothingIsDrawn', async () => {
        const offline = session(null);
        offline.map.showLayer(OLD_MAP);
        offline.map.setLayerOpacity(0.5);
        expect(offline.maps.maps).toEqual([]);

        const { map, maps } = await ready();
        map.setLayerOpacity(0.5);
        maps.frames.run();
        expect(maps.map.callsOf('setOverlayOpacity').filter((args) => args[0] === 'plan-1911')).toEqual([]);
    });

    it('happyPath_anOldMapChosenBeforeTheMapIsReadyIsDrawnOnceItIs', async () => {
        const { map, maps } = session();
        map.showLayer(OLD_MAP);
        map.attach(CONTAINER);
        map.setFrame(FRAME);
        await settle();
        expect(rasters(maps).at(-1)).toEqual(OLD_MAP);
    });
});
