import type { BBox } from '@hcm/shared';
import { FakeMap } from '@hcm/test-support/fake-map';
import { FakeMapDraw } from '@hcm/test-support/fake-map-draw';
import type { DrawnFeature, MapDrawPort } from '@hcm/ui/map/draw';
import { describe, expect, it } from 'vitest';

import { cropChunkLoader } from '../../src/layers/crop-chunk.js';
import { layersModule } from '../../src/layers/layers.js';
import { CropSlot } from '../../src/layers/crop-slot.js';
import { CROP_DRAW_ID, createCropTool, cropRingOf } from '../../src/layers/geometry/crop-tool.js';
import type { CropState, CropToolFactory } from '../../src/layers/geometry/types.js';
import { failure, settle } from '../app/fakes.js';
import { CITY, contentWorld } from '../content/world.js';
import { answer, callsOf } from '../imagery/world.js';
import { CITY_PATH, cityDoc, LAYER_PATH, layerDoc } from './fixtures.js';

const BOUNDS: BBox = [
    [25.9, 44.3],
    [26.3, 44.6],
];

function polygon(...corners: [number, number][]): DrawnFeature {
    return { id: CROP_DRAW_ID, geometry: { type: 'Polygon', coordinates: [corners] } };
}

const SQUARE = polygon([26, 44.4], [26.2, 44.4], [26.2, 44.5], [26, 44.5], [26, 44.4]);

/** The editor's map as the tool sees it: the drawing tools on a fake map, or none. */
function drawing(draw: MapDrawPort | null) {
    const port = new FakeMap();
    port.view = { center: [26.1, 44.45], zoom: 13, bearing: 0 };
    return { port, map: { drawing: () => Promise.resolve(draw === null ? null : { draw, port, bounds: BOUNDS }) } };
}

function tool(draw: MapDrawPort | null = new FakeMapDraw(), overrides: Parameters<typeof contentWorld>[0] = {}) {
    const world = contentWorld(overrides);
    const states: CropState[] = [];
    const done = { count: 0 };
    const { port, map } = drawing(draw);
    const crop = createCropTool({
        ...{ services: world.services, map, layerId: 'corona' },
        changed: (state) => states.push(state),
        done: () => {
            done.count += 1;
        },
    });
    return { ...world, crop, states, done, port };
}

describe('the crop polygon', () => {
    it('happyPath_theOuterRingWithoutItsClosingCornerOrNothing', () => {
        expect(cropRingOf([SQUARE])).toEqual([
            { lat: 44.4, lng: 26 },
            { lat: 44.4, lng: 26.2 },
            { lat: 44.5, lng: 26.2 },
            { lat: 44.5, lng: 26 },
        ]);
        expect(cropRingOf([polygon([26, 44.4], [26.2, 44.4], [26.2, 44.5])])).toHaveLength(3);
        expect(cropRingOf([polygon([26, 44.4], [26.2, 44.4], [26, 44.4])])).toBeNull();
        expect(cropRingOf([{ id: 'p', geometry: { type: 'Point', coordinates: [26, 44.4] } }])).toBeNull();
        expect(cropRingOf([{ id: 'p', geometry: { type: 'Polygon', coordinates: [] } }])).toBeNull();
    });
});

describe('the crop tool', () => {
    it('happyPath_aPolygonDrawnOnTheMapIsSavedAsTheLayersCrop', async () => {
        const draw = new FakeMapDraw();
        const { crop, states, done, callables, notices } = tool(draw);
        answer(callables, 'imagery.crop', () => ({ jobId: 'crop-1', versionId: 'crop-1' }));

        await crop.start();
        draw.emitChange([SQUARE], false);
        draw.emitChange([SQUARE]);
        await expect(crop.save()).resolves.toBe(true);

        expect(draw.callsOf('attach')[0]?.[1]).toMatchObject({ color: '#d81b60', maxVertices: 500, maxRings: 1 });
        expect(draw.callsOf('setMode')).toEqual([['draw-polygon', 'crop']]);
        expect(states.map((state) => [state.phase, state.vertices])).toEqual([
            ['drawing', 0],
            ['drawn', 4],
            ['saving', 4],
        ]);
        expect(callsOf(callables, 'imagery.crop')).toEqual([{ cityId: CITY, layerId: 'corona', ring: cropRingOf([SQUARE]) }]);
        expect(notices.map((notice) => notice.key)).toEqual(['adminContent.imagery.layer.cropStarted']);
        expect(done.count).toBe(1);
    });

    it('happyPath_theKeyboardAddsCornersAtTheMapsCentreAndDrawAgainStartsOver', async () => {
        const draw = new FakeMapDraw();
        const { crop, states, port } = tool(draw);
        await crop.start();

        for (const center of [
            [26, 44.4],
            [26.2, 44.4],
            [26.2, 44.5],
        ] as const) {
            port.view = { center, zoom: 13, bearing: 0 };
            crop.addCorner();
        }
        const loaded = draw.callsOf('load').at(-1);
        crop.redraw();

        expect(states.map((state) => [state.phase, state.vertices])).toEqual([
            ['drawing', 0],
            ['drawing', 1],
            ['drawing', 2],
            ['drawn', 3],
            ['drawing', 0],
        ]);
        expect(loaded).toEqual([
            [
                {
                    id: 'crop',
                    geometry: {
                        type: 'Polygon',
                        coordinates: [
                            [
                                [26, 44.4],
                                [26.2, 44.4],
                                [26.2, 44.5],
                                [26, 44.4],
                            ],
                        ],
                    },
                },
            ],
        ]);
        expect(draw.callsOf('setMode').at(-1)).toEqual(['draw-polygon', 'crop']);
    });

    it('badPath_aRefusedCropSaysWhyAndNothingIsSentWithoutAPolygonOrForAReadOnlyAdmin', async () => {
        const draw = new FakeMapDraw();
        let readOnly = false;
        const { crop, states, callables, done } = tool(draw, { readOnly: () => readOnly });
        callables.fail('imagery.crop', failure('invalid-argument', 'apiError.imagery.cropOutsideLayer'));
        await crop.start();

        const early = await crop.save();
        draw.emitChange([polygon([26, 44.4], [26.2, 44.4])]);
        draw.emitChange([SQUARE]);
        const refused = await crop.save();
        readOnly = true;
        const locked = await crop.save();

        expect([early, refused, locked]).toEqual([false, false, false]);
        expect(states.at(-1)).toEqual({ phase: 'drawn', vertices: 4, refusal: { key: 'apiError.imagery.cropOutsideLayer' } });
        expect(states.map((state) => state.phase)).toContain('drawing');
        expect(callsOf(callables, 'imagery.crop')).toHaveLength(1);
        expect(done.count).toBe(0);
    });

    it('badPath_withoutAMapOrItsToolsThereIsNothingToDrawOn', async () => {
        const none = tool(null);
        await none.crop.start();
        none.crop.redraw();
        none.crop.addCorner();
        const broken = contentWorld();
        const states: CropState[] = [];
        const failing = createCropTool({
            ...{ services: broken.services, layerId: 'corona', done: () => undefined },
            map: { drawing: () => Promise.reject(new Error('terra draw did not load')) },
            changed: (state) => states.push(state),
        });
        await failing.start();

        expect(none.states).toEqual([{ phase: 'no-map', vertices: 0, refusal: null }]);
        expect(states).toEqual([{ phase: 'no-map', vertices: 0, refusal: null }]);
    });

    it('happyPath_closingDetachesTheToolsAndAToolClosedWhileLoadingStaysQuiet', async () => {
        const draw = new FakeMapDraw();
        const { crop, states } = tool(draw);
        await crop.start();
        crop.close();
        draw.emitChange([SQUARE]);
        const late = tool(new FakeMapDraw());
        const starting = late.crop.start();
        late.crop.close();
        await starting;

        expect(draw.callsOf('detach')).toHaveLength(1);
        expect(draw.listenerCount).toBe(0);
        expect(states).toHaveLength(1);
        expect(late.states).toEqual([]);
    });
});

describe('the crop slot', () => {
    function slot(load: (() => Promise<CropToolFactory>) | null) {
        const world = contentWorld({ layerCrop: load });
        const crops: (CropState | null)[] = [];
        const draw = new FakeMapDraw();
        const crop = new CropSlot({ services: world.services, map: drawing(draw).map, changed: (state) => crops.push(state) });
        return { ...world, crop, crops, draw };
    }

    it('happyPath_cropLoadsItsChunkOnceAndForwardsRedrawCornersAndSave', async () => {
        let loads = 0;
        const { crop, crops, draw, callables } = slot(() => {
            loads += 1;
            return Promise.resolve(createCropTool);
        });
        answer(callables, 'imagery.crop', () => ({ jobId: 'crop-1', versionId: 'crop-1' }));

        await crop.open('corona');
        draw.emitChange([SQUARE]);
        crop.redraw();
        crop.addCorner();
        draw.emitChange([SQUARE]);
        await crop.save();

        expect(loads).toBe(1);
        expect(crops.map((state) => state?.phase ?? null)).toEqual([
            'loading',
            'drawing',
            'drawn',
            'drawing',
            'drawing',
            'drawn',
            'saving',
            null,
        ]);
    });

    it('badPath_noChunkAFailedLoadAndALoadOvertakenByAnotherLayer', async () => {
        const none = slot(null);
        await none.crop.open('corona');
        const failed = slot(() => Promise.reject(new Error('chunk')));
        await failed.crop.open('corona');
        const slow = slot(() => settle().then(() => createCropTool));
        const first = slow.crop.open('corona');
        slow.crop.close();
        await first;
        await expect(slow.crop.save()).resolves.toBe(false);

        expect(none.notices.map((notice) => notice.key)).toEqual(['adminContent.imagery.layer.cropUnavailable']);
        expect(none.crops).toEqual([]);
        expect(failed.crops.map((state) => state?.phase ?? null)).toEqual(['loading', null]);
        expect(failed.notices.map((notice) => notice.key)).toEqual(['adminContent.imagery.layer.cropUnavailable']);
        expect(slow.crops.map((state) => state?.phase ?? null)).toEqual(['loading', null]);
        expect(slow.draw.callsOf('attach')).toEqual([]);
    });

    it('happyPath_theChunkLoaderRegistersTheElementAndHandsOverTheTool', async () => {
        const factory = await cropChunkLoader(() => globalThis.customElements)();

        expect(factory).toBe(createCropTool);
        expect(globalThis.customElements.get('hcm-layer-crop')).toBeDefined();
    });
});

describe('the layer editor and its crop', () => {
    it('happyPath_cropOpensOnTheOpenLayerItsActionsReachItAndTheListClosesIt', async () => {
        const world = contentWorld({ layerCrop: () => Promise.resolve(createCropTool) });
        world.store.docs.set(LAYER_PATH('corona'), layerDoc({ currentVersion: 'corona-v1' }));
        world.store.docs.set(CITY_PATH, cityDoc());
        const layers = layersModule.create(world.services);
        await layers.intents.crop();
        const closed = layers.state.crop;

        layers.open(['corona']);
        await layers.intents.crop();
        const opened = layers.state.crop?.phase;
        layers.intents.redrawCrop();
        layers.intents.addCropCorner();
        const saved = await layers.intents.saveCrop();
        layers.intents.closeCrop();
        const cancelled = layers.state.crop;
        await layers.intents.crop();
        layers.open([]);

        expect([closed, opened, saved, cancelled]).toEqual([null, 'no-map', false, null]);
        expect(layers.state.crop).toBeNull();
    });
});
