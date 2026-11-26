import { rasterAdjustmentPaint } from '@hcm/shared';
import { FakeMapboxMap } from '@hcm/test-support/fake-map';
import { describe, expect, it } from 'vitest';

import type { PhotoFeatureCollection, RasterLayerSpec, VectorOverlaySpec } from '../../src/map/map-port.js';
import { layerOpacityPaint, OverlayRegistry, visibilityValue } from '../../src/map/overlay-registry.js';
import { CONE_MIN_ZOOM, PHOTO_MAP_LAYERS, photoEntry, photoLayers, photoSources, splitPhotoData } from '../../src/map/photos.js';
import {
    isPoiLayer,
    POI_CASING_WIDTH,
    POI_LABEL_MIN_ZOOM,
    POI_LINE_WIDTH,
    poiData,
    poiEntry,
    poiLayers,
    poiClusterSource,
    poiPointData,
    poiSources,
} from '../../src/map/pois.js';
import {
    attributionText,
    layerIdOfSource,
    overlaySourceId,
    rasterBeforeId,
    rasterEntry,
    rasterLayer,
    rasterLayerId,
    rasterSource,
} from '../../src/map/rasters.js';
import { fakeFrames } from './support.js';

const RASTER: RasterLayerSpec = {
    id: 'kh4-1966',
    source: { type: 'mapbox', tilesetId: 'owner.kh4-1966' },
    minzoom: 10,
    maxzoom: 17,
    visible: true,
    opacity: 0.8,
    order: 1,
    attribution: 'USGS EROS',
};

const POI: VectorOverlaySpec = {
    id: 'cladiri',
    kind: 'poi',
    features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [26.08, 44.42] }, properties: { id: 'casa', title: 'Casa' } }],
    color: '#8B5E3C',
    icon: 'domain_disabled',
    visible: false,
    opacity: 0.5,
};

function mapboxMap(): FakeMapboxMap {
    return new FakeMapboxMap({
        container: {} as HTMLElement,
        style: 'mapbox://styles/mapbox/standard',
        accessToken: 'pk.test',
        center: [26, 44],
        zoom: 12,
        bearing: 0,
        minZoom: 0,
        maxZoom: 22,
        language: 'ro',
        locale: {},
        attributionControl: true,
        performanceMetricsCollection: false,
    });
}

describe('raster layers', () => {
    it('happyPath_eachSourceTypeBecomesARasterSource', () => {
        expect(rasterSource(RASTER)).toEqual({
            type: 'raster',
            url: 'mapbox://owner.kh4-1966',
            tileSize: 256,
            minzoom: 10,
            maxzoom: 17,
            attribution: 'USGS EROS',
        });
        expect(
            rasterSource({
                ...RASTER,
                source: { type: 'xyz', tiles: ['https://t.example.org/{z}/{x}/{y}.webp'], tileSize: 512 },
                bounds: [
                    [25.9, 44.3],
                    [26.2, 44.5],
                ],
            }),
        ).toEqual({
            type: 'raster',
            tiles: ['https://t.example.org/{z}/{x}/{y}.webp'],
            tileSize: 512,
            scheme: 'xyz',
            minzoom: 10,
            maxzoom: 17,
            attribution: 'USGS EROS',
            bounds: [25.9, 44.3, 26.2, 44.5],
        });
        // M12: never a bare URL, which would make Mapbox GL fetch a provider script from its own host.
        const custom = rasterSource({
            ...RASTER,
            source: { type: 'pmtiles', url: 'https://t.example.org/kh4.pmtiles' },
            bounds: [
                [25.9, 44.3],
                [26.2, 44.5],
            ],
        });
        expect(custom).toMatchObject({
            id: 'hcm-source-kh4-1966',
            type: 'custom',
            dataType: 'raster',
            tileSize: 256,
            minzoom: 10,
            maxzoom: 17,
            attribution: 'USGS EROS',
            bounds: [25.9, 44.3, 26.2, 44.5],
        });
        expect(custom).not.toHaveProperty('url');
    });

    it('badPath_markupInTheAttributionReachesMapboxAsEscapedText', () => {
        // Mapbox GL's attribution control parses a source attribution as HTML and keeps its links; the manifest's is plain text.
        const attribution = '<a href="https://phish.example">USGS</a> & <img src=x onerror=alert(1)>';

        expect(rasterSource({ ...RASTER, attribution })['attribution']).toBe(
            '&lt;a href="https://phish.example"&gt;USGS&lt;/a&gt; &amp; &lt;img src=x onerror=alert(1)&gt;',
        );
        expect(rasterSource({ ...RASTER, attribution: null })).not.toHaveProperty('attribution');
        expect(rasterSource({ ...RASTER, attribution: '' })['attribution']).toBe('');
        expect(attributionText('USGS EROS © 1966')).toBe('USGS EROS © 1966');
    });

    it('happyPath_theLayerSitsInItsSlotWithOpacityAndNeutralAdjustments', () => {
        expect(rasterLayer(RASTER, 'middle')).toEqual({
            id: 'hcm-raster-kh4-1966',
            type: 'raster',
            source: 'hcm-source-kh4-1966',
            slot: 'middle',
            layout: { visibility: 'visible' },
            paint: { 'raster-opacity': 0.8, ...rasterAdjustmentPaint(), 'raster-fade-duration': 0, 'raster-emissive-strength': 1 },
        });
        expect(rasterLayer({ ...RASTER, visible: false, adjustments: { contrast: 0.5 } }, 'middle')).toMatchObject({
            layout: { visibility: 'none' },
            paint: { 'raster-contrast': 0.5 },
        });
        expect(rasterEntry(RASTER)).toEqual({
            kind: 'raster',
            layers: [{ id: rasterLayerId('kh4-1966'), type: 'raster', base: {} }],
            sources: [overlaySourceId('kh4-1966')],
            visible: true,
            opacity: 0.8,
        });
    });

    it('happyPath_aHigherOrderDrawsOnTop', () => {
        const orders = new Map([
            ['a', 1],
            ['c', 3],
            ['d', 5],
        ]);

        expect(rasterBeforeId(orders, 2)).toBe('hcm-raster-c');
        expect(rasterBeforeId(orders, 5)).toBeUndefined();
        expect(rasterBeforeId(new Map(), 1)).toBeUndefined();
    });

    it('happyPath_aSourceIdNamesItsLayer', () => {
        expect(layerIdOfSource('hcm-source-kh4-1966')).toBe('kh4-1966');
        expect(layerIdOfSource('composite')).toBeUndefined();
        expect(layerIdOfSource(undefined)).toBeUndefined();
    });
});

describe('photo layers', () => {
    const data: PhotoFeatureCollection = {
        type: 'FeatureCollection',
        features: [
            {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [26, 44] },
                properties: { id: 'a', title: 'A', year: 1978, bearing: 40 },
            },
            {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [26, 44] },
                properties: { id: 'b', title: 'B', year: null, bearing: null },
            },
            {
                type: 'Feature',
                geometry: {
                    type: 'Polygon',
                    coordinates: [
                        [
                            [26, 44],
                            [26.1, 44],
                            [26, 44.1],
                            [26, 44],
                        ],
                    ],
                },
                properties: { id: 'a' },
            },
        ],
    };

    it('happyPath_pointsAndConesSplitIntoTwoSources', () => {
        const { points, cones } = splitPhotoData(data);

        expect(points).toEqual({
            type: 'FeatureCollection',
            features: [
                {
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: [26, 44] },
                    properties: { id: 'a', title: 'A', year: 1978, bearing: 40 },
                },
                { type: 'Feature', geometry: { type: 'Point', coordinates: [26, 44] }, properties: { id: 'b', title: 'B' } },
            ],
        });
        expect((cones as { features: unknown[] }).features).toHaveLength(1);
        expect(photoSources().map(([id, source]) => [id, source['cluster'] ?? false])).toEqual([
            ['hcm-photos-cones', false],
            ['hcm-photos-points', true],
        ]);
    });

    it('happyPath_theHoveredPhotosViewedAreaIsFocused', () => {
        const area = (id: string) =>
            ({
                type: 'Feature',
                geometry: { type: 'Polygon', coordinates: [] },
                properties: { id, area: true },
            }) as const;
        const { cones } = splitPhotoData({ type: 'FeatureCollection', features: [area('a'), area('b')] }, 'b');

        expect((cones as { features: { properties: unknown }[] }).features.map((feature) => feature.properties)).toEqual([
            { id: 'a', area: true },
            { id: 'b', area: true, focus: true },
        ]);
    });

    it('badPath_aHoveredConeIsNotAnArea', () => {
        const { cones } = splitPhotoData(data, 'a');

        expect((cones as { features: { properties: unknown }[] }).features.map((feature) => feature.properties)).toEqual([{ id: 'a' }]);
    });

    it('happyPath_conesFromZoom17AndMarkersRotatedByBearing', () => {
        const layers = photoLayers('top', false, 0.5);

        expect(layers.map((layer) => [layer['id'], layer['type'], layer['minzoom']])).toEqual([
            ['hcm-photos-area-fill', 'fill', undefined],
            ['hcm-photos-area-line', 'line', undefined],
            ['hcm-photos-cone-fill', 'fill', CONE_MIN_ZOOM],
            ['hcm-photos-cone-line', 'line', CONE_MIN_ZOOM],
            ['hcm-photos-cluster', 'symbol', undefined],
            ['hcm-photos-marker', 'symbol', undefined],
        ]);
        expect(layers[0]?.['filter']).toEqual(['has', 'focus']);
        expect(layers[2]?.['filter']).toEqual(['!', ['has', 'area']]);
        expect(layers[2]?.['paint']).toEqual({ 'fill-color': '#ffb74d', 'fill-emissive-strength': 1, 'fill-opacity': 0.125 });
        expect(layers[3]?.['paint']).toMatchObject({ 'line-opacity': 0.4 });
        expect(layers[5]?.['layout']).toMatchObject({
            visibility: 'none',
            'icon-image': ['case', ['has', 'aerial'], 'hcm-photo-aerial', ['has', 'bearing'], 'hcm-photo-direction', 'hcm-photo-camera'],
            'icon-rotate': ['coalesce', ['get', 'bearing'], 0],
            'icon-rotation-alignment': 'map',
        });
        expect(layers[5]?.['paint']).toEqual({ 'icon-opacity': 0.5, 'text-opacity': 0.5 });
        expect(photoEntry(true, 1)).toMatchObject({ kind: 'photos', layers: PHOTO_MAP_LAYERS, visible: true, opacity: 1 });
    });
});

describe('POI layers', () => {
    it('happyPath_nineLayersInTheCategoryColourWithAWhiteCasingUnderLinesAndOutlinesAndClusteredPoints', () => {
        const layers = poiLayers(POI, 'top');

        expect(layers.map((layer) => [layer['id'], layer['type']])).toEqual([
            ['hcm-poi-cladiri-fill', 'fill'],
            ['hcm-poi-cladiri-casing', 'line'],
            ['hcm-poi-cladiri-line', 'line'],
            ['hcm-poi-cladiri-circle', 'circle'],
            ['hcm-poi-cladiri-symbol', 'symbol'],
            ['hcm-poi-cladiri-cluster', 'circle'],
            ['hcm-poi-cladiri-cluster-count', 'symbol'],
            ['hcm-poi-cladiri-label-line', 'symbol'],
            ['hcm-poi-cladiri-label-area', 'symbol'],
        ]);
        expect(layers[0]?.['paint']).toEqual({ 'fill-color': '#8B5E3C', 'fill-emissive-strength': 1, 'fill-opacity': 0.175 });
        // The casing is wider than the stroke at every zoom, and both scale with the overlay's opacity.
        expect(layers[1]?.['paint']).toEqual({
            'line-color': '#ffffff',
            'line-width': POI_CASING_WIDTH,
            'line-emissive-strength': 1,
            'line-opacity': 0.45,
        });
        expect(layers[2]?.['paint']).toEqual({
            'line-color': '#8B5E3C',
            'line-width': POI_LINE_WIDTH,
            'line-emissive-strength': 1,
            'line-opacity': 0.5,
        });
        expect(layers[1]?.['filter']).toEqual(layers[2]?.['filter']);
        const widths = (width: unknown): number[] => (width as unknown[]).slice(3).filter((_value, index) => index % 2 === 1) as number[];
        widths(POI_CASING_WIDTH).forEach((casing, index) => {
            expect(casing - (widths(POI_LINE_WIDTH)[index] ?? casing)).toBeGreaterThanOrEqual(3);
        });
        expect(layers[3]?.['paint']).toMatchObject({ 'circle-color': '#8B5E3C', 'circle-opacity': 0.5, 'circle-stroke-opacity': 0.5 });
        expect(layers[4]?.['layout']).toMatchObject({ 'icon-image': 'hcm-poi-icon-domain_disabled', visibility: 'none' });
        expect(layers[5]).toMatchObject({ filter: ['has', 'point_count'], paint: { 'circle-color': '#8B5E3C' } });
        expect(layers[6]?.['layout']).toMatchObject({ 'text-field': ['get', 'point_count_abbreviated'] });
        expect(layers[7]?.['layout']).toMatchObject({
            'symbol-placement': 'line-center',
            'text-field': ['step', ['zoom'], '', POI_LABEL_MIN_ZOOM, ['get', 'title']],
        });
        expect(layers.map((layer) => layer['source'])).toEqual([
            ...Array<string>(3).fill('hcm-source-cladiri'),
            ...Array<string>(4).fill('hcm-source-cladiri-points'),
            ...Array<string>(2).fill('hcm-source-cladiri'),
        ]);
        expect(layers.every((layer) => layer['slot'] === 'top')).toBe(true);
    });

    it('badPath_atZeroOpacityTheCasingGoesWithTheStroke', () => {
        const layers = poiLayers({ ...POI, opacity: 0 }, 'top');

        expect(layers[1]?.['paint']).toMatchObject({ 'line-opacity': 0 });
        expect(layers[2]?.['paint']).toMatchObject({ 'line-opacity': 0 });
        expect(layers[0]?.['paint']).toMatchObject({ 'fill-opacity': 0 });
    });

    it('happyPath_pointsGoToAClusteredSourceAndShapesToTheOther', () => {
        const line: VectorOverlaySpec['features'][number] = {
            type: 'Feature',
            geometry: {
                type: 'LineString',
                coordinates: [
                    [26.08, 44.42],
                    [26.09, 44.43],
                ],
            },
            properties: { id: 'strada', title: 'Strada' },
        };
        const both = { ...POI, features: [...POI.features, line] };
        expect(poiSources(both)).toEqual([
            ['hcm-source-cladiri', { type: 'geojson', data: { type: 'FeatureCollection', features: [line] } }],
            [
                'hcm-source-cladiri-points',
                {
                    type: 'geojson',
                    data: { type: 'FeatureCollection', features: POI.features },
                    cluster: true,
                    clusterMaxZoom: 15,
                    clusterRadius: 40,
                },
            ],
        ]);
        expect(poiData({ ...POI, features: [] })).toEqual({ type: 'FeatureCollection', features: [] });
        expect(poiPointData({ ...POI, features: [line] })).toEqual({ type: 'FeatureCollection', features: [] });
        expect(poiEntry(POI)).toMatchObject({
            kind: 'poi',
            sources: ['hcm-source-cladiri', 'hcm-source-cladiri-points'],
            visible: false,
            opacity: 0.5,
        });
        expect(isPoiLayer('hcm-poi-cladiri-fill')).toBe(true);
        expect(isPoiLayer('hcm-photos-marker')).toBe(false);
    });

    it('badPath_onlyAPoiClusterLayerNamesAClusteredSource', () => {
        expect(poiClusterSource('hcm-poi-cladiri-cluster')).toBe('hcm-source-cladiri-points');
        expect(poiClusterSource('hcm-poi-cladiri-cluster-count')).toBeNull();
        expect(poiClusterSource('hcm-poi-cladiri-circle')).toBeNull();
        expect(poiClusterSource('hcm-photos-cluster')).toBeNull();
    });
});

describe('OverlayRegistry', () => {
    function setup(): { map: FakeMapboxMap; registry: OverlayRegistry; frames: ReturnType<typeof fakeFrames> } {
        const map = mapboxMap();
        const frames = fakeFrames();
        const registry = new OverlayRegistry(map, frames);
        for (const layer of poiLayers(POI, 'top')) {
            map.addLayer(layer);
        }
        for (const [id, source] of poiSources(POI)) {
            map.addSource(id, source);
        }
        registry.set('cladiri', poiEntry(POI));
        return { map, registry, frames };
    }

    it('happyPath_opacityIsPaintedOncePerFrameWithTheLastValue', () => {
        const { map, registry, frames } = setup();
        const before = map.callsOf('setPaintProperty').length;

        registry.setOpacity('cladiri', 0.2);
        registry.setOpacity('cladiri', 0.9);
        expect(map.callsOf('setPaintProperty')).toHaveLength(before);
        frames.run();

        expect(map.paint.get('hcm-poi-cladiri-fill')?.['fill-opacity']).toBeCloseTo(0.315);
        expect(map.paint.get('hcm-poi-cladiri-casing')?.['line-opacity']).toBeCloseTo(0.81);
        expect(map.paint.get('hcm-poi-cladiri-symbol')).toMatchObject({ 'icon-opacity': 0.9, 'text-opacity': 0.9 });
        expect(map.callsOf('setPaintProperty')).toHaveLength(before + 15);
        expect(registry.get('cladiri')?.opacity).toBeCloseTo(0.9);
    });

    it('badPath_unknownIdsAndBadValuesAreIgnoredOrClamped', () => {
        const { map, registry, frames } = setup();

        registry.setOpacity('nope', 0.5);
        registry.setOpacity('cladiri', Number.NaN);
        frames.run();
        registry.setOpacity('cladiri', 7);
        registry.flush();

        expect(map.paint.get('hcm-poi-cladiri-circle')).toMatchObject({ 'circle-opacity': 1 });
        expect(registry.setVisibility('nope', true)).toBe(false);
        registry.remove('nope');
        expect(registry.entries().map(([id]) => id)).toEqual(['cladiri']);
    });

    it('happyPath_visibilityChangesEveryLayerOnce', () => {
        const { map, registry } = setup();

        expect(registry.setVisibility('cladiri', true)).toBe(true);
        expect(registry.setVisibility('cladiri', true)).toBe(false);

        expect(map.callsOf('setLayoutProperty')).toHaveLength(9);
        expect(map.layout.get('hcm-poi-cladiri-label-area')).toMatchObject({ visibility: 'visible' });
        expect(visibilityValue(false)).toBe('none');
    });

    it('happyPath_removingTakesLayersTopFirstThenSources', () => {
        const { map, registry, frames } = setup();
        registry.setOpacity('cladiri', 0.3);

        registry.remove('cladiri');
        frames.run();

        expect(map.callsOf('removeLayer').map(([id]) => id)).toEqual([
            'hcm-poi-cladiri-label-area',
            'hcm-poi-cladiri-label-line',
            'hcm-poi-cladiri-cluster-count',
            'hcm-poi-cladiri-cluster',
            'hcm-poi-cladiri-symbol',
            'hcm-poi-cladiri-circle',
            'hcm-poi-cladiri-line',
            'hcm-poi-cladiri-casing',
            'hcm-poi-cladiri-fill',
        ]);
        expect(map.sources.has('hcm-source-cladiri')).toBe(false);
        expect(map.sources.has('hcm-source-cladiri-points')).toBe(false);
        expect(registry.entries()).toEqual([]);
    });

    it('badPath_destroyCancelsAPendingFrame', () => {
        const { map, registry, frames } = setup();
        const before = map.callsOf('setPaintProperty').length;

        registry.setOpacity('cladiri', 0.3);
        registry.destroy();
        registry.destroy();
        frames.run();

        expect(map.callsOf('setPaintProperty')).toHaveLength(before);
        expect(layerOpacityPaint('raster', { id: 'x', type: 'raster', base: {} }, 0.5)).toEqual({ 'raster-opacity': 0.5 });
    });
});
