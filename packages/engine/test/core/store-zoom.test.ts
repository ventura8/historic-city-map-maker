import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HASH_WRITE_DELAY_MS } from '../../src/core/url-sync.js';
import { harness, loaded } from './harness.js';

/**
 * The map's zoom buttons (scenario V52): `zoomBy` moves the camera one level from where it is, within the city's zoom
 * range (the fixture's 10 to 20), and the address follows the camera's `moveend` like any move of the visitor's.
 */
describe('zoomBy', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('happyPath_zoomInFliesOneLevelFromTheCameraAndTheAddressFollows', async () => {
        const { store, map, location } = await loaded();
        map.view = { center: [26.1, 44.43], zoom: 13.5, bearing: 0 };

        store.zoomBy(1);
        map.emit('moveend', map.view);
        vi.advanceTimersByTime(HASH_WRITE_DELAY_MS);

        // `Boot.flyMap` reads reduced motion when the button is pressed: animated here, a jump under reduced motion.
        expect(map.callsOf('flyTo').at(-1)).toEqual([{ center: [26.1, 44.43], zoom: 14.5, bearing: 0 }, { animate: true }]);
        expect(location.hash.split('&')[0]).toBe('#14.5/44.43/26.1');
    });

    it('happyPath_zoomOutFliesOneLevelOut', async () => {
        const { store, map } = await loaded();
        map.view = { center: [26.1, 44.43], zoom: 13, bearing: 0 };

        store.zoomBy(-1);

        expect(map.view.zoom).toBe(12);
    });

    it('badPath_atTheCityLimitsNothingMoves', async () => {
        const { store, map } = await loaded();
        map.view = { center: [26.1, 44.43], zoom: 20, bearing: 0 };
        const flights = map.callsOf('flyTo').length;

        store.zoomBy(1);
        map.view = { ...map.view, zoom: 10 };
        store.zoomBy(-1);

        expect(map.callsOf('flyTo')).toHaveLength(flights);
    });

    it('badPath_nearALimitTheStepStopsAtIt', async () => {
        const { store, map } = await loaded();
        map.view = { center: [26.1, 44.43], zoom: 19.6, bearing: 0 };

        store.zoomBy(1);

        expect(map.view.zoom).toBe(20);
    });

    it('badPath_beforeTheManifestNothingMoves', () => {
        const { store, map } = harness();

        store.zoomBy(1);

        expect(map.callsOf('flyTo')).toEqual([]);
    });
});
