import { FakeMapboxGl } from '@hcm/test-support/fake-map';
import { describe, expect, it } from 'vitest';

import type { MapOptions } from '../../src/map/map-port.js';
import { createMapboxPort } from '../../src/map/mapbox-adapter.js';
import { createViewerMapPort } from '../../src/map/viewer-map.js';
import { fakeAdapterEnv, settle } from './support.js';

/**
 * A port made before Mapbox GL JS has arrived (the public page loads it `async` since the cold load of 2026-11-12, so
 * the viewer paints first): it asks the probe about WebGL until then, and `mount` waits for it.
 */

const OPTIONS: MapOptions = {
    style: 'mapbox://styles/mapbox/standard-satellite',
    accessToken: 'pk.test',
    view: { center: [26.08, 44.42], zoom: 14, bearing: 0 },
    minZoom: 10,
    maxZoom: 20,
    locale: 'en',
    reducedMotion: false,
};

describe('Mapbox adapter with Mapbox GL still on its way', () => {
    it('happyPath_mountWaitsForMapboxGlThenCreatesTheMap', async () => {
        const gl = new FakeMapboxGl({ supported: false });
        const arrival: { resolve?: (value: FakeMapboxGl) => void } = {};
        const pending = new Promise<FakeMapboxGl>((resolve) => {
            arrival.resolve = resolve;
        });
        const port = createViewerMapPort(pending, fakeAdapterEnv());

        expect(port.isWebGLSupported(), 'the probe answers before Mapbox GL is there').toBe(true);
        const mounting = port.mount({} as HTMLElement, OPTIONS);
        arrival.resolve?.(gl);
        await settle();
        gl.map.fire('load');
        await mounting;

        expect(port.mapLoadCount).toBe(1);
        expect(port.isWebGLSupported(), 'then Mapbox GL answers').toBe(false);
    });

    it('badPath_aMapboxGlThatNeverArrivesFailsTheMount', async () => {
        const failed = Promise.reject(new Error('mapboxgl is not defined'));
        const port = createMapboxPort(failed, fakeAdapterEnv({ webgl: false }));

        expect(port.isWebGLSupported()).toBe(false);
        await expect(port.mount({} as HTMLElement, OPTIONS)).rejects.toThrow('mapboxgl is not defined');
        expect(port.mapLoadCount).toBe(0);
    });
});
