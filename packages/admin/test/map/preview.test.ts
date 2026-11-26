import { PHOTOS_OVERLAY_ID, rasterAdjustmentPaint } from '@hcm/shared';
import { FakeMap } from '@hcm/test-support/fake-map';
import type { PhotoFeatureCollection, RasterLayerSpec, VectorOverlaySpec } from '@hcm/ui/map';
import { describe, expect, it } from 'vitest';

import { createMapPreview, previewPhotos, type MapContent } from '../../src/map/preview.js';
import { fakeFrames } from './support.js';

const LAYER: RasterLayerSpec = {
    id: 'kh4-1966',
    source: { type: 'xyz', tiles: ['https://tiles.e2e.test/{z}/{x}/{y}.png'], tileSize: 256 },
    minzoom: 10,
    maxzoom: 17,
    visible: true,
    opacity: 0.8,
    order: 1,
    attribution: 'USGS',
};

const CHURCHES: VectorOverlaySpec = {
    id: 'biserici',
    kind: 'poi',
    features: [
        {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [26.1, 44.43] },
            properties: { id: 'stavropoleos', title: 'Stavropoleos' },
        },
        { type: 'Feature', geometry: { type: 'Point', coordinates: [26.09, 44.42] }, properties: { id: 'antim', title: 'Antim' } },
    ],
    color: '#8b5e3c',
    icon: 'church',
    visible: true,
    opacity: 0.9,
};

const PARKS: VectorOverlaySpec = { ...CHURCHES, id: 'parcuri', features: [], color: '#1f6f43', icon: 'park' };

const PHOTOS: PhotoFeatureCollection = {
    type: 'FeatureCollection',
    features: [
        {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [26.1, 44.43] },
            properties: { id: 'p1', title: 'Lipscani', year: 1930, bearing: null },
        },
        {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [26.2, 44.44] },
            properties: { id: 'p2', title: 'Obor', year: 1940, bearing: null },
        },
    ],
};

const CONTENT: MapContent = { layers: [LAYER], photos: PHOTOS, photosOpacity: 0.7, categories: [CHURCHES, PARKS] };

function previewed(content: MapContent = CONTENT): {
    readonly map: FakeMap;
    readonly frames: ReturnType<typeof fakeFrames>;
    readonly preview: ReturnType<typeof createMapPreview>;
} {
    const map = new FakeMap();
    const frames = fakeFrames();
    const preview = createMapPreview(map, frames);
    preview.show(content);
    map.calls.length = 0;
    return { map, frames, preview };
}

function lastOverlay(map: FakeMap, id: string): VectorOverlaySpec | undefined {
    return map
        .callsOf('addVectorOverlay')
        .map((args) => args[0] as VectorOverlaySpec)
        .filter((spec) => spec.id === id)
        .at(-1);
}

describe('map preview: the saved content', () => {
    it('happyPath_showDrawsLayersCategoriesAndPhotos', () => {
        const map = new FakeMap();
        const preview = createMapPreview(map, fakeFrames());

        preview.show(CONTENT);

        expect(map.callsOf('addRasterLayer')).toEqual([[LAYER, 'middle']]);
        expect(map.callsOf('addVectorOverlay')).toEqual([
            [CHURCHES, 'top'],
            [PARKS, 'top'],
        ]);
        expect(map.callsOf('setPhotosData')).toEqual([[PHOTOS]]);
        expect(map.callsOf('setOverlayOpacity')).toEqual([[PHOTOS_OVERLAY_ID, 0.7]]);
    });

    it('happyPath_aNewShowRemovesWhatIsGone', () => {
        const { map, preview } = previewed();

        preview.show({ categories: [PARKS] });

        expect(map.callsOf('removeLayer')).toEqual([['kh4-1966'], ['biserici']]);
        expect(map.callsOf('setPhotosData')).toEqual([[{ type: 'FeatureCollection', features: [] }]]);
        expect(map.callsOf('setOverlayOpacity')).toEqual([[PHOTOS_OVERLAY_ID, 1]]);
    });
});

describe('map preview: drafts', () => {
    it('happyPath_aLayerDraftIsPaintedOncePerFrameAndWritesNothing', () => {
        const { map, frames, preview } = previewed();

        preview.preview({ kind: 'layer', id: 'kh4-1966', opacity: 0.4 });
        preview.preview({ kind: 'layer', id: 'kh4-1966', opacity: 0.5, visible: false, adjustments: { contrast: 0.2 } });
        expect(map.calls).toEqual([]);
        frames.run();

        expect(map.callsOf('setOverlayOpacity')).toEqual([['kh4-1966', 0.5]]);
        expect(map.callsOf('setOverlayVisibility')).toEqual([['kh4-1966', false]]);
        expect(map.callsOf('setLayerPaint')).toEqual([['kh4-1966', rasterAdjustmentPaint({ contrast: 0.2 })]]);
        expect(frames.pending).toBe(0);
    });

    it('happyPath_thePhotosOverlayAndACategoryPreviewTheirLook', () => {
        const { map, frames, preview } = previewed();

        preview.preview({ kind: 'photos-overlay', opacity: 0.3 });
        preview.preview({ kind: 'poi-category', id: 'biserici', opacity: 0.6, color: '#123456' });
        preview.preview({ kind: 'poi-category', id: 'parcuri', icon: 'forest' });
        preview.preview({ kind: 'poi-category', id: 'necunoscut', color: '#000000' });
        frames.run();

        expect(map.callsOf('setOverlayOpacity')).toEqual([
            [PHOTOS_OVERLAY_ID, 0.3],
            ['biserici', 0.6],
        ]);
        expect(lastOverlay(map, 'biserici')?.color).toBe('#123456');
        expect(lastOverlay(map, 'parcuri')).toMatchObject({ icon: 'forest', color: '#1f6f43' });
        expect(lastOverlay(map, 'necunoscut')).toBeUndefined();
    });

    it('happyPath_aPhotoDraftMovesItsMarkerAndDrawsItsCone', () => {
        const { map, frames, preview } = previewed();

        preview.preview({ kind: 'photo', id: 'p1', location: [26.11, 44.431], bearing: 90 });
        frames.run();

        const data = map.callsOf('setPhotosData').at(-1)?.[0] as PhotoFeatureCollection;
        expect(data.features.map((feature) => [feature.properties.id, feature.geometry.type])).toEqual([
            ['p2', 'Point'],
            ['p1', 'Point'],
            ['p1', 'Polygon'],
        ]);
        expect(data.features[1]?.geometry.coordinates).toEqual([26.11, 44.431]);
    });

    it('badPath_aPhotoWithoutBearingHasNoConeAndAnUnknownPhotoAddsNoMarker', () => {
        const moved = previewPhotos(PHOTOS, { kind: 'photo', id: 'p2', location: [26.21, 44.45] });
        const unknown = previewPhotos(PHOTOS, { kind: 'photo', id: 'p9', location: [26.21, 44.45], bearing: 10, fov: 40 });

        expect(moved.features).toHaveLength(2);
        expect(unknown.features.map((feature) => [feature.properties.id, feature.geometry.type])).toEqual([
            ['p1', 'Point'],
            ['p2', 'Point'],
            ['p9', 'Polygon'],
        ]);
    });

    it('happyPath_thePlaceBeingEditedLeavesItsCategoryUntilRestored', () => {
        const { map, frames, preview } = previewed();

        preview.preview({ kind: 'poi', id: 'antim', category: 'biserici' });
        frames.run();
        expect(lastOverlay(map, 'biserici')?.features.map((feature) => feature.properties.id)).toEqual(['stavropoleos']);
        preview.preview({ kind: 'poi', id: 'antim', category: 'parcuri' });
        frames.run();
        expect(lastOverlay(map, 'biserici')?.features).toHaveLength(2);
        preview.show(CONTENT);
        expect(lastOverlay(map, 'parcuri')?.features).toEqual([]);

        preview.restore({ kind: 'poi', id: 'stavropoleos' });
        preview.restore({ kind: 'poi', id: 'antim' });

        expect(lastOverlay(map, 'parcuri')).toEqual(PARKS);
    });
});

describe('map preview: partial drafts', () => {
    it('badPath_aPartialLayerDraftPaintsOnlyWhatItNamesAndRestoreClearsAdjustments', () => {
        const { map, frames, preview } = previewed();

        preview.preview({ kind: 'layer', id: 'kh4-1966', adjustments: { brightnessMax: 0.8 } });
        preview.preview({ kind: 'poi-category', id: 'biserici', opacity: 0.5 });
        frames.run();
        preview.restore({ kind: 'layer', id: 'kh4-1966' });
        preview.show({});

        expect(map.callsOf('setLayerPaint')).toEqual([
            ['kh4-1966', rasterAdjustmentPaint({ brightnessMax: 0.8 })],
            ['kh4-1966', rasterAdjustmentPaint({})],
        ]);
        expect(map.callsOf('setOverlayVisibility')).toEqual([['kh4-1966', true]]);
        expect(map.callsOf('setOverlayOpacity')).toEqual([
            ['biserici', 0.5],
            ['kh4-1966', 0.8],
            [PHOTOS_OVERLAY_ID, 1],
        ]);
        expect(map.callsOf('addVectorOverlay')).toEqual([]);
    });
});

describe('map preview: restore', () => {
    it('happyPath_restorePutsEachEntityBackAsSaved', () => {
        const { map, frames, preview } = previewed({ ...CONTENT, layers: [{ ...LAYER, adjustments: { saturation: -0.5 } }] });
        preview.preview({ kind: 'layer', id: 'kh4-1966', opacity: 0.1 });

        preview.restore({ kind: 'layer', id: 'kh4-1966' });
        preview.restore({ kind: 'photos-overlay' });
        preview.restore({ kind: 'poi-category', id: 'biserici' });
        preview.restore({ kind: 'photo', id: 'p1' });
        frames.run();

        expect(map.callsOf('setOverlayOpacity')).toEqual([
            ['kh4-1966', 0.8],
            [PHOTOS_OVERLAY_ID, 0.7],
            ['biserici', 0.9],
        ]);
        expect(map.callsOf('setOverlayVisibility')).toEqual([['kh4-1966', true]]);
        expect(map.callsOf('setLayerPaint')).toEqual([['kh4-1966', rasterAdjustmentPaint({ saturation: -0.5 })]]);
        expect(map.callsOf('setPhotosData')).toEqual([[PHOTOS]]);
        expect(lastOverlay(map, 'biserici')).toEqual(CHURCHES);
    });

    it('badPath_restoringWhatThePageDoesNotShowChangesNothingButTheDefaults', () => {
        const { map, preview } = previewed({ categories: [] });

        preview.restore({ kind: 'layer', id: 'kh4-1966' });
        preview.restore({ kind: 'poi-category', id: 'biserici' });
        preview.restore({ kind: 'photos-overlay' });
        preview.restore({ kind: 'photo', id: 'p1' });

        expect(map.callsOf('setOverlayOpacity')).toEqual([[PHOTOS_OVERLAY_ID, 1]]);
        expect(map.callsOf('setPhotosData')).toEqual([[{ type: 'FeatureCollection', features: [] }]]);
        expect(map.callsOf('addVectorOverlay')).toEqual([]);
    });
});
