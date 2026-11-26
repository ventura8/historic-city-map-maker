import { distanceMeters, type LngLat } from '@hcm/shared';
import { FakeMapboxGl } from '@hcm/test-support/fake-map';
import { describe, expect, it } from 'vitest';

import type { MapOptions } from '../../src/map/map-port.js';
import {
    MY_LOCATION_AREA_LAYER,
    MY_LOCATION_DOT_LAYER,
    MY_LOCATION_SOURCE,
    PHOTO_MARK_SOURCE,
    myLocationData,
    pointData,
    type MyLocationFix,
} from '../../src/map/my-location.js';
import { createViewerMapPort } from '../../src/map/viewer-map.js';
import { fakeAdapterEnv } from './support.js';

const OPTIONS: MapOptions = {
    style: 'mapbox://styles/mapbox/standard',
    accessToken: 'pk.test',
    view: { center: [26.08, 44.42], zoom: 14, bearing: 0 },
    minZoom: 10,
    maxZoom: 20,
    locale: 'en',
    reducedMotion: false,
};

const FIX: MyLocationFix = { center: [26.1, 44.43], accuracy: 25, heading: null };

interface Feature {
    readonly geometry: { readonly type: string; readonly coordinates: unknown };
    readonly properties: { readonly o?: number };
}

function featuresOf(data: unknown): readonly Feature[] {
    return (data as { readonly features: readonly Feature[] }).features;
}

async function mounted(): Promise<{ readonly gl: FakeMapboxGl; readonly port: ReturnType<typeof createViewerMapPort> }> {
    const gl = new FakeMapboxGl();
    const port = createViewerMapPort(gl, fakeAdapterEnv());
    const mounting = port.mount({} as HTMLElement, OPTIONS);
    gl.map.fire('load');
    await mounting;
    return { gl, port };
}

describe('myLocationData', () => {
    it('happyPath_anAccuracyCircleAsWideAsTheAccuracyAndTheDotOnTop', () => {
        const [circle, dot, ...rest] = featuresOf(myLocationData(FIX));

        expect(rest).toEqual([]);
        expect(circle?.geometry.type).toBe('Polygon');
        const ring = (circle?.geometry.coordinates as readonly (readonly LngLat[])[])[0] ?? [];
        expect(ring).toHaveLength(25);
        for (const point of ring) {
            expect(distanceMeters(FIX.center, point)).toBeCloseTo(25, 3);
        }
        expect(ring[0]).toEqual(ring.at(-1));
        expect(dot?.geometry).toEqual({ type: 'Point', coordinates: FIX.center });
    });

    it('happyPath_aHeadingAddsAConePointingThatWay', () => {
        const features = featuresOf(myLocationData({ ...FIX, heading: 90 }));
        const cone = features[1];

        expect(features.map((feature) => feature.geometry.type)).toEqual(['Polygon', 'Polygon', 'Point']);
        expect(cone?.properties.o).toBeGreaterThan(features[0]?.properties.o ?? 1);
        const ring = (cone?.geometry.coordinates as readonly (readonly LngLat[])[])[0] ?? [];
        expect(ring[0]).toEqual(FIX.center);
        // East of the visitor: every point of the arc lies to the east.
        expect(ring.slice(1, -1).every((point) => point[0] > FIX.center[0])).toBe(true);
    });

    it('badPath_noFixNoFeatures', () => {
        expect(featuresOf(myLocationData(null))).toEqual([]);
    });
});

describe('setMyLocation on the viewer map', () => {
    it('happyPath_theFirstFixAddsTheSourceAndTwoLayersAboveThePhotosLaterOnesOnlyMoveIt', async () => {
        const { gl, port } = await mounted();
        const before = gl.map.layerOrder.length;

        port.setMyLocation(FIX);
        port.setMyLocation({ ...FIX, center: [26.11, 44.44] });

        expect(gl.map.layerOrder.slice(before)).toEqual([MY_LOCATION_AREA_LAYER, MY_LOCATION_DOT_LAYER]);
        expect(gl.map.layers.get(MY_LOCATION_DOT_LAYER)).toMatchObject({ type: 'circle', slot: 'top', source: MY_LOCATION_SOURCE });
        expect(gl.map.paint.get(MY_LOCATION_DOT_LAYER)).toMatchObject({ 'circle-color': '#1a73e8', 'circle-stroke-color': '#fff' });
        expect(gl.map.callsOf('addSource').filter(([id]) => id === MY_LOCATION_SOURCE)).toHaveLength(1);
        const dot = featuresOf(gl.map.getSource(MY_LOCATION_SOURCE)?.data).at(-1);
        expect(dot?.geometry.coordinates).toEqual([26.11, 44.44]);
        expect(port.mapLoadCount).toBe(1);
    });

    it('badPath_theDotLayerDrawsThePointOnlyNotACircleAtEveryVertexOfTheAccuracyCircleOrTheCone', async () => {
        // The owner, 2026-11-08: "a lot of blue dots around the centre one". A circle layer draws a circle at every vertex of
        // a polygon in its source, so the dot layer must keep to the Point; the circle and the cone are fills only.
        const { gl, port } = await mounted();
        port.setMyLocation({ ...FIX, heading: 90 });

        const filter = gl.map.layers.get(MY_LOCATION_DOT_LAYER)?.['filter'];
        expect(filter).toEqual(['in', ['geometry-type'], ['literal', ['Point']]]);
        const drawnAsDots = featuresOf(gl.map.getSource(MY_LOCATION_SOURCE)?.data).filter((feature) => feature.geometry.type === 'Point');
        expect(drawnAsDots).toHaveLength(1);
        expect(gl.map.layers.get(MY_LOCATION_AREA_LAYER)).toMatchObject({ type: 'fill' });
    });

    it('happyPath_nullEmptiesTheSource', async () => {
        const { gl, port } = await mounted();
        port.setMyLocation(FIX);
        port.setMyLocation(null);

        expect(featuresOf(gl.map.getSource(MY_LOCATION_SOURCE)?.data)).toEqual([]);
    });

    it('badPath_nullFirstAddsNothing', async () => {
        const { gl, port } = await mounted();
        port.setMyLocation(null);

        expect(gl.map.getSource(MY_LOCATION_SOURCE)).toBeUndefined();
        expect(gl.map.layers.has(MY_LOCATION_DOT_LAYER)).toBe(false);
    });

    it('badPath_withoutAMapNothingHappens', () => {
        const gl = new FakeMapboxGl();
        const port = createViewerMapPort(gl, fakeAdapterEnv());

        expect(() => {
            port.setMyLocation(FIX);
        }).not.toThrow();
        expect(port.mapLoadCount).toBe(0);
    });
});

describe('markPhoto on the viewer map (Locate)', () => {
    it('happyPath_aRingInTheConeColourAroundThePlaceAboveThePhotosThenMoved', async () => {
        const { gl, port } = await mounted();
        const before = gl.map.layerOrder.length;

        port.markPhoto([26.1, 44.43]);
        port.markPhoto([26.2, 44.44]);

        expect(gl.map.layerOrder.slice(before)).toEqual([PHOTO_MARK_SOURCE]);
        expect(gl.map.layers.get(PHOTO_MARK_SOURCE)).toMatchObject({ type: 'circle', slot: 'top', source: PHOTO_MARK_SOURCE });
        expect(gl.map.paint.get(PHOTO_MARK_SOURCE)).toMatchObject({ 'circle-opacity': 0, 'circle-stroke-color': '#ffb74d' });
        expect(gl.map.callsOf('addSource').filter(([id]) => id === PHOTO_MARK_SOURCE)).toHaveLength(1);
        expect(featuresOf(gl.map.getSource(PHOTO_MARK_SOURCE)?.data)[0]?.geometry.coordinates).toEqual([26.2, 44.44]);
    });

    it('happyPath_nullTakesTheRingAway', async () => {
        const { gl, port } = await mounted();
        port.markPhoto([26.1, 44.43]);
        port.markPhoto(null);

        expect(featuresOf(gl.map.getSource(PHOTO_MARK_SOURCE)?.data)).toEqual([]);
    });

    it('badPath_nullFirstOrNoMapAddsNothing', async () => {
        const { gl, port } = await mounted();
        port.markPhoto(null);
        const unmounted = createViewerMapPort(new FakeMapboxGl(), fakeAdapterEnv());

        expect(gl.map.getSource(PHOTO_MARK_SOURCE)).toBeUndefined();
        expect(() => {
            unmounted.markPhoto([26.1, 44.43]);
        }).not.toThrow();
    });

    it('happyPath_pointDataIsOnePointOrNone', () => {
        expect(featuresOf(pointData([26.1, 44.43]))).toEqual([
            { type: 'Feature', geometry: { type: 'Point', coordinates: [26.1, 44.43] }, properties: {} },
        ]);
        expect(featuresOf(pointData(null))).toEqual([]);
    });
});
