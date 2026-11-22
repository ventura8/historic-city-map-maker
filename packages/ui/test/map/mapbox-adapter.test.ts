import { rasterAdjustmentPaint, type BBox, type LngLat } from '@hcm/shared';
import { FakeMap, FakeMapboxGl, type FakeMapboxMap } from '@hcm/test-support/fake-map';
import { describe, expect, it } from 'vitest';

import type { MapEventMap, MapOptions, MapPort, RasterLayerSpec, VectorOverlaySpec } from '../../src/map/map-port.js';
import { createMapboxPort, nativeMap } from '../../src/map/mapbox-adapter.js';
import { fakeAdapterEnv, settle, type FakeAdapterEnv } from './support.js';

const OPTIONS: MapOptions = {
    style: 'mapbox://styles/mapbox/standard-satellite',
    config: { show3dObjects: true },
    accessToken: 'pk.test',
    view: { center: [26.08, 44.42], zoom: 14, bearing: 0 },
    minZoom: 10,
    maxZoom: 20,
    locale: 'en',
    reducedMotion: false,
};

const RASTER: RasterLayerSpec = {
    id: 'kh4-1966',
    source: { type: 'mapbox', tilesetId: 'owner.kh4-1966' },
    minzoom: 10,
    maxzoom: 17,
    visible: true,
    opacity: 0.8,
    order: 2,
    attribution: 'USGS EROS',
};

const POI: VectorOverlaySpec = {
    id: 'cladiri',
    kind: 'poi',
    features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [26.08, 44.42] }, properties: { id: 'casa', title: 'Casa' } }],
    color: '#8B5E3C',
    icon: 'church',
    visible: true,
    opacity: 1,
};

interface Mounted {
    readonly port: MapPort;
    readonly gl: FakeMapboxGl;
    readonly env: FakeAdapterEnv;
    readonly map: FakeMapboxMap;
}

async function mounted(options: MapOptions = OPTIONS): Promise<Mounted> {
    const gl = new FakeMapboxGl();
    const env = fakeAdapterEnv();
    const port = createMapboxPort(gl, env);
    const mounting = port.mount({} as HTMLElement, options);
    gl.map.fire('load');
    await mounting;
    await settle();
    return { port, gl, env, map: gl.map };
}

/** A map container whose Mapbox elements record the attributes the adapter writes (`<selector> <attribute>` → value). */
function labelledContainer(): { readonly container: HTMLElement; readonly labels: Map<string, string> } {
    const labels = new Map<string, string>();
    const container = {
        querySelectorAll: (selector: string) => [
            {
                nodeType: 1,
                childNodes: [],
                setAttribute: (attribute: string, value: string) => {
                    labels.set(`${selector} ${attribute}`, value);
                },
            },
        ],
    };
    return { container: container as unknown as HTMLElement, labels };
}

describe('Mapbox adapter', () => {
    it('happyPath_webGlSupportComesFromMapboxOrTheProbe', () => {
        expect(createMapboxPort(new FakeMapboxGl({ supported: false }), fakeAdapterEnv()).isWebGLSupported()).toBe(false);
        expect(createMapboxPort(new FakeMapboxGl(), fakeAdapterEnv({ webgl: false })).isWebGLSupported()).toBe(false);
        expect(createMapboxPort(new FakeMapboxGl({ supported: true })).isWebGLSupported()).toBe(true);
    });

    it('happyPath_mountCreatesOneMapWithThePhotoLayersAndIcons', async () => {
        const { port, map, env } = await mounted();

        expect(port.mapLoadCount).toBe(1);
        expect(map.options).toMatchObject({
            accessToken: 'pk.test',
            language: 'en',
            locale: {
                'Map.Title': 'Map',
                'AttributionControl.ToggleAttribution': 'Show or hide the map sources',
                'LogoControl.Title': 'Mapbox homepage',
            },
            performanceMetricsCollection: false,
            attributionControl: true,
            config: { basemap: { show3dObjects: true } },
        });
        expect(map.layerOrder).toEqual(['hcm-photos-cone-fill', 'hcm-photos-cone-line', 'hcm-photos-cluster', 'hcm-photos-marker']);
        expect([...map.images.keys()]).toEqual(['hcm-photo-aerial', 'hcm-photo-camera', 'hcm-photo-direction', 'hcm-photo-cluster']);
        expect(map.callsOf('updateImage')).toHaveLength(4);
        expect(env.observed).toBe(1);
        expect(nativeMap(port)).toBe(map);
        expect(nativeMap(new FakeMap())).toBeNull();
        expect(nativeMap(createMapboxPort(new FakeMapboxGl(), fakeAdapterEnv()))).toBeNull();
    });

    it('badPath_aMapThatCannotBeCreatedRejectsWithWebgl', async () => {
        const gl = new FakeMapboxGl();
        gl.constructError = new Error('Failed to initialize WebGL');
        const port = createMapboxPort(gl, fakeAdapterEnv());

        await expect(port.mount({} as HTMLElement, OPTIONS)).rejects.toThrow('webgl');
        expect(port.mapLoadCount).toBe(0);
    });

    it('badPath_aStyleErrorBeforeLoadRejectsWithStyle', async () => {
        const gl = new FakeMapboxGl();
        const port = createMapboxPort(gl, fakeAdapterEnv());
        const errors: MapEventMap['error'][] = [];
        port.on('error', (event) => errors.push(event));

        const mounting = port.mount({} as HTMLElement, OPTIONS);
        gl.map.fire('error', { error: new Error('Style 401') });

        await expect(mounting).rejects.toThrow('style');
        expect(errors).toEqual([{ kind: 'style', message: 'Style 401' }]);
    });

    it('badPath_destroyOrASecondMountWhileLoadingRejectsTheFirst', async () => {
        const gl = new FakeMapboxGl();
        const port = createMapboxPort(gl, fakeAdapterEnv());

        const first = port.mount({} as HTMLElement, OPTIONS);
        const second = port.mount({} as HTMLElement, OPTIONS);
        port.destroy();

        await expect(first).rejects.toThrow('unknown');
        await expect(second).rejects.toThrow('unknown');
        // Admin sweep 2026-11-14: a map whose style is still loading is removed once it settles (Mapbox's `reloadModels` threw).
        expect(gl.maps.some((map) => map.removed)).toBe(false);
        gl.maps[0]?.fire('load');
        gl.maps[1]?.fire('error', { error: new Error('Style 401') });
        expect(gl.maps.every((map) => map.removed)).toBe(true);
    });

    it('badPath_aLoadAfterTheMapWasReplacedIsIgnored', async () => {
        const gl = new FakeMapboxGl();
        const port = createMapboxPort(gl, fakeAdapterEnv());
        const first = port.mount({} as HTMLElement, OPTIONS);
        const firstMap = gl.map;
        firstMap.fire('load');
        const second = port.mount({} as HTMLElement, OPTIONS);

        await expect(first).rejects.toThrow('unknown');
        gl.map.fire('load');
        await second;
        expect(firstMap.layerOrder).toEqual([]);
        expect(port.mapLoadCount).toBe(2);
    });

    it('badPath_callsBeforeTheStyleLoadsAreIgnored', () => {
        const gl = new FakeMapboxGl();
        const port = createMapboxPort(gl, fakeAdapterEnv());
        port.mount({} as HTMLElement, OPTIONS).catch(() => undefined);

        port.addRasterLayer(RASTER, 'middle');
        port.addVectorOverlay(POI, 'top');
        port.setOverlayVisibility('photos', false);
        port.setOverlayOpacity('photos', 0.2);
        port.setLayerPaint('kh4-1966', rasterAdjustmentPaint());
        port.setLayerOrder('kh4-1966', 4);
        port.removeLayer('kh4-1966');
        port.setPhotosData({ type: 'FeatureCollection', features: [] });

        expect(gl.map.callsOf('addLayer')).toEqual([]);
        expect(gl.map.callsOf('setLayoutProperty')).toEqual([]);
        port.destroy();
    });
});

describe('Mapbox adapter: overlays', () => {
    it('happyPath_rastersAreOrderedAndHideThe3dCity', async () => {
        const { port, map } = await mounted();

        port.addRasterLayer(RASTER, 'middle');
        port.addRasterLayer({ ...RASTER, id: 'kh9-1980', order: 1, visible: false }, 'middle');

        expect(map.layerOrder.slice(-2)).toEqual(['hcm-raster-kh9-1980', 'hcm-raster-kh4-1966']);
        expect(map.config.get('basemap.show3dObjects')).toBe(false);
        port.setOverlayVisibility('kh4-1966', false);
        expect(map.config.get('basemap.show3dObjects')).toBe(true);
        port.setOverlayVisibility('kh4-1966', false);
        port.setOverlayVisibility('nope', true);
        expect(map.callsOf('setConfigProperty')).toHaveLength(2);
    });

    it('happyPath_aRasterMovesInTheStackWithItsTilesKept', async () => {
        const { port, map } = await mounted();
        port.addRasterLayer(RASTER, 'middle');
        port.addRasterLayer({ ...RASTER, id: 'kh9-1980', order: 5 }, 'middle');

        port.setLayerOrder('kh4-1966', 9);

        expect(map.layerOrder.slice(-2)).toEqual(['hcm-raster-kh9-1980', 'hcm-raster-kh4-1966']);
        port.setLayerOrder('kh4-1966', 1);
        expect(map.layerOrder.slice(-2)).toEqual(['hcm-raster-kh4-1966', 'hcm-raster-kh9-1980']);
        expect(map.callsOf('removeSource')).toEqual([]);
    });

    it('badPath_anUnknownOrUnmovedRasterIsNotMoved', async () => {
        const { port, map } = await mounted();
        port.addRasterLayer(RASTER, 'middle');

        port.setLayerOrder('nope', 3);
        port.setLayerOrder('kh4-1966', RASTER.order);

        expect(map.callsOf('moveLayer')).toEqual([]);
    });

    it('happyPath_aRasterAddedAgainIsReplaced', async () => {
        const { port, map } = await mounted();
        port.addRasterLayer(RASTER, 'middle');

        port.addRasterLayer({ ...RASTER, opacity: 0.3 }, 'middle');
        port.removeLayer('kh4-1966');

        expect(map.callsOf('removeSource').map(([id]) => id)).toEqual(['hcm-source-kh4-1966', 'hcm-source-kh4-1966']);
        expect(map.layers.has('hcm-raster-kh4-1966')).toBe(false);
        expect(map.config.get('basemap.show3dObjects')).toBe(true);
    });

    it('happyPath_opacityIsCoalescedToOnePaintPerFrame', async () => {
        const { port, map, env } = await mounted();
        port.addRasterLayer(RASTER, 'middle');

        port.setOverlayOpacity('kh4-1966', 0.1);
        port.setOverlayOpacity('kh4-1966', 0.6);
        port.setOverlayOpacity('photos', 0.5);
        port.setOverlayOpacity('nope', 0.5);
        env.frames.run();

        expect(map.callsOf('setPaintProperty').filter(([id]) => id === 'hcm-raster-kh4-1966')).toEqual([
            ['hcm-raster-kh4-1966', 'raster-opacity', 0.6],
        ]);
        expect(map.paint.get('hcm-photos-cone-fill')).toMatchObject({ 'fill-opacity': 0.125 });
        expect(map.paint.get('hcm-photos-marker')).toMatchObject({ 'icon-opacity': 0.5 });
    });

    it('happyPath_rasterAdjustmentsArePaintedLive', async () => {
        const { port, map } = await mounted();
        port.addRasterLayer(RASTER, 'middle');
        port.addVectorOverlay(POI, 'top');

        port.setLayerPaint('kh4-1966', rasterAdjustmentPaint({ brightnessMax: 0.6, saturation: -1 }));
        port.setLayerPaint('cladiri', rasterAdjustmentPaint({ contrast: 1 }));
        port.setLayerPaint('nope', rasterAdjustmentPaint({ contrast: 1 }));

        expect(map.paint.get('hcm-raster-kh4-1966')).toMatchObject({
            'raster-brightness-max': 0.6,
            'raster-saturation': -1,
            'raster-contrast': 0,
        });
        expect(map.callsOf('setPaintProperty')).toHaveLength(4);
    });

    it('happyPath_aPoiCategoryIsDrawnOnceAndOnlyItsDataChangesAfter', async () => {
        const { port, map, env } = await mounted();

        port.addVectorOverlay(POI, 'top');
        const layers = map.callsOf('addLayer').length;
        port.addVectorOverlay({ ...POI, features: [], visible: false, opacity: 0.4 }, 'top');
        env.frames.run();

        expect(map.callsOf('addLayer')).toHaveLength(layers);
        expect(map.layerOrder.slice(0, 6).every((id) => id.startsWith('hcm-poi-cladiri-'))).toBe(true);
        expect(map.getSource('hcm-source-cladiri')?.data).toEqual({ type: 'FeatureCollection', features: [] });
        expect(map.layout.get('hcm-poi-cladiri-symbol')).toMatchObject({ visibility: 'none' });
        expect(map.paint.get('hcm-poi-cladiri-circle')).toMatchObject({ 'circle-opacity': 0.4 });
        expect(map.images.has('hcm-poi-icon-church')).toBe(true);
    });

    it('happyPath_aNewColourRedrawsTheCategory', async () => {
        const { port, map } = await mounted();
        port.addVectorOverlay(POI, 'top');

        port.addVectorOverlay({ ...POI, color: '#000000' }, 'top');
        port.addVectorOverlay({ ...POI, id: 'strazi' }, 'middle');
        expect(map.layerOrder.at(-1)).toBe('hcm-poi-strazi-label-area');
        port.removeLayer('cladiri');
        port.removeLayer('photos');

        expect(map.callsOf('removeSource').map(([id]) => id)).toEqual([
            'hcm-source-cladiri',
            'hcm-source-cladiri-points',
            'hcm-source-cladiri',
            'hcm-source-cladiri-points',
        ]);
        expect(map.layers.has('hcm-photos-marker')).toBe(true);
    });
});

describe('Mapbox adapter: photo data', () => {
    it('happyPath_photoDataIsSplitIntoItsSources', async () => {
        const { port, map } = await mounted();

        port.setPhotosData({
            type: 'FeatureCollection',
            features: [
                {
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: [26, 44] },
                    properties: { id: 'a', title: 'A', year: null, bearing: 10 },
                },
                {
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: [26, 44] },
                    properties: { id: 'b', title: 'B', year: 1944, bearing: null, aerial: true },
                },
            ],
        });

        expect(map.getSource('hcm-photos-points')?.data).toEqual({
            type: 'FeatureCollection',
            features: [
                { type: 'Feature', geometry: { type: 'Point', coordinates: [26, 44] }, properties: { id: 'a', title: 'A', bearing: 10 } },
                {
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: [26, 44] },
                    properties: { id: 'b', title: 'B', year: 1944, aerial: true },
                },
            ],
        });
        expect(map.getSource('hcm-photos-cones')?.data).toEqual({ type: 'FeatureCollection', features: [] });
    });
});

describe('Mapbox adapter: selection and camera', () => {
    it('happyPath_clicksSelectPhotosAndPoisAndZoomIntoClusters', async () => {
        const { port, map } = await mounted();
        port.addRasterLayer(RASTER, 'middle');
        port.addVectorOverlay(POI, 'top');
        const photos: string[] = [];
        const pois: string[] = [];
        const stopPhotos = port.onPhotoClick((id) => photos.push(id));
        port.onPoiClick((id) => pois.push(id));

        map.rendered = [{ layer: { id: 'hcm-photos-marker' }, properties: { id: 'p1' } }];
        map.fire('click', { point: { x: 5, y: 5 } });
        map.rendered = [{ layer: { id: 'hcm-poi-cladiri-circle' }, properties: { id: 'casa' } }];
        map.fire('click', { point: { x: 5, y: 5 } });
        map.rendered = [
            { layer: { id: 'hcm-photos-cluster' }, properties: { cluster_id: 3 }, geometry: { type: 'Point', coordinates: [26.1, 44.43] } },
        ];
        map.fire('click', { point: { x: 5, y: 5 } });
        stopPhotos();
        map.rendered = [{ layer: { id: 'hcm-photos-marker' }, properties: { id: 'p2' } }];
        map.fire('click', { point: { x: 5, y: 5 } });

        expect(photos).toEqual(['p1']);
        expect(pois).toEqual(['casa']);
        expect(map.getSource('hcm-photos-points')?.expandedClusters).toEqual([3]);
        expect(map.callsOf('flyTo').at(-1)).toEqual([{ center: [26.1, 44.43], zoom: 16 }]);
        const queried = map.callsOf('queryRenderedFeatures').at(-1)?.[1] as { layers: string[] };
        expect(queried.layers).toContain('hcm-poi-cladiri-symbol');
        expect(queried.layers).toContain('hcm-photos-marker');
        expect(queried.layers).not.toContain('hcm-raster-kh4-1966');
    });

    it('badPath_aClusterThatCannotExpandOrHasNoCentreStillBehaves', async () => {
        const { map } = await mounted();
        const source = map.getSource('hcm-photos-points');

        map.rendered = [{ layer: { id: 'hcm-photos-cluster' }, properties: { cluster_id: 1 } }];
        map.fire('click', { point: { x: 5, y: 5 } });
        if (source !== undefined) {
            source.expansionZoom = new Error('cluster gone');
        }
        map.fire('click', { point: { x: 5, y: 5 } });

        expect(map.callsOf('flyTo')).toEqual([[{ zoom: 16 }]]);
    });

    it('happyPath_theCameraAnimatesUnlessReducedMotionOrAskedNotTo', async () => {
        const animated = await mounted();
        const reduced = await mounted({ ...OPTIONS, reducedMotion: true });

        animated.port.flyTo({ zoom: 16 });
        animated.port.flyTo({ bearing: 90 }, { animate: false });
        reduced.port.flyTo({ zoom: 16 });

        expect(animated.map.callsOf('flyTo')).toEqual([[{ zoom: 16 }]]);
        expect(animated.map.callsOf('jumpTo')).toEqual([[{ bearing: 90 }]]);
        expect(reduced.map.callsOf('jumpTo')).toEqual([[{ zoom: 16 }]]);
        expect(animated.port.getView()).toEqual({ center: [26.08, 44.42], zoom: 16, bearing: 90 });
    });

    it('happyPath_aClickOnNothingReportsItsPositionUntilUnsubscribed', async () => {
        const { port, map } = await mounted();
        const positions: LngLat[] = [];
        const stop = port.onMapClick((position) => positions.push(position));

        map.fire('click', { point: { x: 5, y: 5 }, lngLat: { lng: 26.1, lat: 44.43 } });
        map.rendered = [{ layer: { id: 'hcm-photos-marker' }, properties: { id: 'p1' } }];
        map.fire('click', { point: { x: 5, y: 5 }, lngLat: { lng: 26.2, lat: 44.44 } });
        stop();
        map.rendered = [];
        map.fire('click', { point: { x: 5, y: 5 }, lngLat: { lng: 26.3, lat: 44.45 } });

        expect(positions).toEqual([[26.1, 44.43]]);
    });

    it('happyPath_clicksPassThroughAnOverlayThatIsNotClickable', async () => {
        const { port, map } = await mounted();
        const pois: string[] = [];
        const positions: LngLat[] = [];
        port.onPoiClick((id) => pois.push(id));
        port.onMapClick((position) => positions.push(position));

        port.addVectorOverlay({ ...POI, id: 'hcm-draw', clickable: false }, 'top');
        map.rendered = [{ layer: { id: 'hcm-poi-hcm-draw-circle' }, properties: { id: 'casa' } }];
        map.fire('click', { point: { x: 5, y: 5 }, lngLat: { lng: 26.1, lat: 44.43 } });
        port.addVectorOverlay({ ...POI, id: 'hcm-draw', color: '#000000' }, 'top');
        map.fire('click', { point: { x: 5, y: 5 }, lngLat: { lng: 26.1, lat: 44.43 } });

        expect(positions).toEqual([[26.1, 44.43]]);
        expect(pois).toEqual(['casa']);
    });

    it('happyPath_fitBoundsAnimatesUnlessReducedMotionOrAskedNotTo', async () => {
        const box: BBox = [
            [26.0, 44.3],
            [26.2, 44.5],
        ];
        const animated = await mounted();
        const reduced = await mounted({ ...OPTIONS, reducedMotion: true });
        const unmounted = createMapboxPort(new FakeMapboxGl(), fakeAdapterEnv());

        animated.port.fitBounds(box, { padding: 24 });
        animated.port.fitBounds(box, { animate: false });
        reduced.port.fitBounds(box);
        unmounted.fitBounds(box);

        expect(animated.map.callsOf('fitBounds')).toEqual([
            [box, { padding: 24, animate: true }],
            [box, { padding: 0, animate: false }],
        ]);
        expect(reduced.map.callsOf('fitBounds')).toEqual([[box, { padding: 0, animate: false }]]);
    });

    it('happyPath_thePaddingIsKeptForTheNextMap', async () => {
        const sheet = { top: 0, right: 0, bottom: 240, left: 0 };
        const gl = new FakeMapboxGl();
        const port = createMapboxPort(gl, fakeAdapterEnv());

        port.setPadding(sheet);
        const mounting = port.mount({} as HTMLElement, OPTIONS);
        gl.map.fire('load');
        await mounting;
        port.setPadding({ ...sheet, bottom: 120 });

        expect(gl.map.callsOf('setPadding')).toEqual([[sheet], [{ ...sheet, bottom: 120 }]]);
    });

    it('happyPath_theViewIsReadFromTheMapAndRememberedAfterDestroy', async () => {
        const fresh = createMapboxPort(new FakeMapboxGl(), fakeAdapterEnv());
        const { port, map } = await mounted();
        map.center = { lng: 26.1, lat: 44.43 };
        map.zoom = 17;
        map.bearing = -30;

        expect(fresh.getView()).toEqual({ center: [0, 0], zoom: 0, bearing: 0 });
        fresh.flyTo({ zoom: 3 });
        expect(port.getView()).toEqual({ center: [26.1, 44.43], zoom: 17, bearing: 330 });
        port.destroy();
        expect(port.getView()).toEqual({ center: [26.1, 44.43], zoom: 17, bearing: 330 });
    });
});

describe('Mapbox adapter: events and lifecycle', () => {
    it('happyPath_mapEventsReachTheSubscribers', async () => {
        const { port, map } = await mounted();
        const heard: string[] = [];
        port.on('move', (view) => heard.push(`move ${String(view.zoom)}`));
        port.on('moveend', (view) => heard.push(`moveend ${String(view.zoom)}`));
        port.on('error', (event) => heard.push(`error ${event.kind} ${event.layerId ?? ''}`));
        port.on('webglcontextlost', () => heard.push('lost'));
        port.on('webglcontextrestored', () => heard.push('restored'));
        port.on('idle', () => heard.push('idle'));

        map.zoom = 14;
        map.fire('move');
        map.zoom = 15;
        map.fire('moveend');
        map.fire('error', { error: new Error('404'), sourceId: 'hcm-source-kh4-1966', tile: {} });
        map.fire('error', { error: new Error('odd') });
        map.fire('webglcontextlost');
        map.fire('webglcontextrestored');
        map.fire('idle');

        expect(heard).toEqual(['move 14', 'moveend 15', 'error tile kh4-1966', 'error unknown ', 'lost', 'restored', 'idle']);
    });

    it('badPath_aThrowingSubscriberDoesNotStopTheOthers', async () => {
        const { port, map } = await mounted();
        const heard: string[] = [];
        port.on('moveend', () => {
            throw new Error('subscriber bug');
        });
        port.on('moveend', () => heard.push('second'));

        map.fire('moveend');

        expect(heard).toEqual(['second']);
    });

    it('happyPath_theMapFollowsItsContainerInTheSameFrame', async () => {
        // The tour at 2560 and 3840 px: resized a frame later, the canvas was still wider than its box once a pane opened.
        const { port, map, env } = await mounted();

        env.resizeObserved();
        expect(map.callsOf('resize')).toHaveLength(1);
        expect(env.frames.pending).toBe(0);
        port.resize();

        expect(map.callsOf('resize')).toHaveLength(2);
    });

    it('happyPath_destroyRemovesTheMapAndStopsFollowingItsContainer', async () => {
        const { port, map, env, gl } = await mounted();
        const photos: string[] = [];
        port.onPhotoClick((id) => photos.push(id));

        port.destroy();
        port.destroy();
        env.resizeObserved();
        port.resize();
        port.flyTo({ zoom: 3 });

        expect(map.removed).toBe(true);
        expect(map.callsOf('resize')).toEqual([]);
        expect(map.listenerCount('click')).toBe(0);
        expect(map.listenerCount('moveend')).toBe(0);
        expect(env.observed).toBe(0);
        const again = port.mount({} as HTMLElement, OPTIONS);
        gl.map.fire('load');
        await again;
        gl.map.rendered = [{ layer: { id: 'hcm-photos-marker' }, properties: { id: 'p1' } }];
        gl.map.fire('click', { point: { x: 1, y: 1 } });
        expect(photos).toEqual([]);
        expect(port.mapLoadCount).toBe(2);
    });

    it('happyPath_aLanguageSwitchRelabelsMapboxAndItsBasemap', async () => {
        // The tour: after a switch to Romanian, Mapbox's canvas, logo and attribution toggle still spoke English.
        const gl = new FakeMapboxGl();
        const port = createMapboxPort(gl, fakeAdapterEnv());
        const { container, labels } = labelledContainer();
        const mounting = port.mount(container, OPTIONS);
        gl.map.fire('load');
        await mounting;

        port.setLocale('ro');

        expect(gl.map.callsOf('setLanguage')).toEqual([['ro']]);
        expect(Object.fromEntries(labels)).toEqual({
            'canvas.mapboxgl-canvas aria-label': 'Hartă',
            'a.mapboxgl-ctrl-logo aria-label': 'Pagina Mapbox',
            '.mapboxgl-ctrl-attrib-button aria-label': 'Arată sau ascunde sursele hărții',
            '.mapboxgl-ctrl-attrib-button .mapboxgl-ctrl-icon title': 'Arată sau ascunde sursele hărții',
        });
    });

    it('happyPath_aLanguageSwitchTranslatesTheLayersCreditsAndKeepsTheLinks', async () => {
        // The Pixel Tablet, 2026-11-12: the USGS credit stayed in the language of the first load.
        const gl = new FakeMapboxGl();
        const port = createMapboxPort(gl, fakeAdapterEnv());
        const container = document.createElement('div');
        const line = document.createElement('div');
        line.className = 'mapboxgl-ctrl-attrib-inner';
        const link = document.createElement('a');
        link.href = 'https://www.mapbox.com/about/maps/';
        link.textContent = '© Mapbox';
        line.append(link, ' | USGS EROS, declassified imagery (public domain)');
        container.append(line);
        const mounting = port.mount(container, OPTIONS);
        gl.map.fire('load');
        await mounting;

        port.setLocale('ro');

        expect(line.textContent).toBe('© Mapbox | USGS EROS, imagini desecretizate (domeniu public)');
        expect(line.querySelector('a')?.href).toBe('https://www.mapbox.com/about/maps/');
    });

    it('badPath_aLanguageSwitchWithoutAMapChangesNothing', async () => {
        const { port, map } = await mounted();

        port.destroy();
        port.setLocale('ro');

        expect(map.callsOf('setLanguage')).toEqual([]);
    });

    it('badPath_aStyleWithoutTheBasemapImportIsNeverReconfigured', async () => {
        const { port, map } = await mounted({ ...OPTIONS, config: { lightPreset: 'day' } });

        port.addRasterLayer(RASTER, 'middle');

        expect(map.callsOf('setConfigProperty')).toEqual([]);
    });
});

describe('Mapbox adapter: a camera move with an offset (Show on map, V51)', () => {
    it('happyPath_anOffsetFliesThePlaceBesideTheCentreAndJumpsThereUnderReducedMotion', async () => {
        const animated = await mounted();
        const reduced = await mounted({ ...OPTIONS, reducedMotion: true });

        animated.port.flyTo({ center: [26.1, 44.43], zoom: 17 }, { offset: [0, -150] });
        reduced.port.flyTo({ center: [26.1, 44.43], zoom: 17 }, { offset: [-180, 0] });

        expect(animated.map.callsOf('flyTo')).toEqual([[{ center: [26.1, 44.43], zoom: 17, offset: [0, -150] }]]);
        // jumpTo takes no offset: the jump is an easeTo of no duration.
        expect(reduced.map.callsOf('jumpTo')).toEqual([]);
        expect(reduced.map.callsOf('easeTo')).toEqual([[{ center: [26.1, 44.43], zoom: 17, offset: [-180, 0], duration: 0 }]]);
    });

    it('badPath_anExplicitAnimateWinsOverTheMountsReducedMotionAndMapboxsOwn', async () => {
        const reduced = await mounted({ ...OPTIONS, reducedMotion: true });
        const animated = await mounted();

        // The engine reads the visitor's preference when the camera moves; Mapbox would otherwise jump and drop the offset.
        reduced.port.flyTo({ center: [26.1, 44.43], zoom: 17 }, { offset: [0, -150], animate: true });
        animated.port.flyTo({ center: [26.1, 44.43], zoom: 17 }, { offset: [0, -150], animate: false });

        expect(reduced.map.callsOf('flyTo')).toEqual([[{ center: [26.1, 44.43], zoom: 17, offset: [0, -150], essential: true }]]);
        expect(animated.map.callsOf('easeTo')).toEqual([[{ center: [26.1, 44.43], zoom: 17, offset: [0, -150], duration: 0 }]]);
    });

    it('badPath_noOffsetNoOffsetKey', async () => {
        const animated = await mounted();

        animated.port.flyTo({ zoom: 15 }, {});

        expect(animated.map.callsOf('flyTo')).toEqual([[{ zoom: 15 }]]);
        expect(Object.hasOwn(animated.map.callsOf('flyTo')[0]?.[0] ?? {}, 'offset')).toBe(false);
    });
});

describe('Mapbox adapter: POI clusters', () => {
    it('happyPath_aPoiClusterZoomsIntoItsOwnCategorysSource', async () => {
        const { port, map } = await mounted();
        port.addVectorOverlay(POI, 'top');

        map.rendered = [{ layer: { id: 'hcm-poi-cladiri-cluster' }, properties: { cluster_id: 9 } }];
        map.fire('click', { point: { x: 5, y: 5 } });

        expect(map.getSource('hcm-source-cladiri-points')?.expandedClusters).toEqual([9]);
        expect(map.getSource('hcm-photos-points')?.expandedClusters).toEqual([]);
        const queried = map.callsOf('queryRenderedFeatures').at(-1)?.[1] as { layers: string[] };
        expect(queried.layers).toContain('hcm-poi-cladiri-cluster');
    });
});
