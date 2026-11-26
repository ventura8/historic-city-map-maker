/**
 * Admin-only lon/lat ↔ screen projection stays off the engine's `MapPort` (DECISIONS-for-review.md §146).
 */
import { FakeMap, FakeMapboxGl } from '@hcm/test-support/fake-map';
import { createMapboxPort } from '@hcm/ui/map';
import { describe, expect, it } from 'vitest';

import { withMapProjection } from '../../src/map/projection.js';
import { fakeEnv } from './support.js';

const VIEW = { center: [26.1, 44.43] as const, zoom: 13, bearing: 0 };

describe('withMapProjection', () => {
    it('happyPath_aFakeThatAlreadyProjectsIsLeftAlone', async () => {
        const fake = new FakeMap();
        await fake.mount({} as HTMLElement, {
            style: 'mapbox://styles/mapbox/standard',
            accessToken: 'pk.test',
            view: { ...VIEW },
            minZoom: 9,
            maxZoom: 20,
            locale: 'ro',
            reducedMotion: true,
        });
        const wrapped = withMapProjection(fake);
        expect(wrapped).toBe(fake);
        expect(wrapped.project([26.1, 44.43])).toEqual({ x: 400, y: 300 });
    });

    it('happyPath_aMapboxPortProjectsAndUnprojectsAfterMount', async () => {
        const gl = new FakeMapboxGl();
        const port = createMapboxPort(gl, fakeEnv());
        const mounting = port.mount({} as HTMLElement, {
            style: 'mapbox://styles/mapbox/standard',
            accessToken: 'pk.test',
            view: { ...VIEW },
            minZoom: 9,
            maxZoom: 20,
            locale: 'en',
            reducedMotion: true,
        });
        gl.map.fire('load');
        await mounting;
        const wrapped = withMapProjection(port);
        const at = wrapped.project([26.1, 44.43]);
        expect(at).not.toBeNull();
        expect(wrapped.unproject(at ?? { x: 0, y: 0 })).toEqual([26.1, 44.43]);
    });

    it('badPath_beforeMountAWrappedMapboxPortReturnsNull', () => {
        const port = createMapboxPort(new FakeMapboxGl(), fakeEnv());
        const wrapped = withMapProjection(port);
        expect(wrapped.project([26.1, 44.43])).toBeNull();
        expect(wrapped.unproject({ x: 0, y: 0 })).toBeNull();
    });
});
