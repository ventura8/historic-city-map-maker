import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HASH_WRITE_DELAY_MS } from '../../src/core/url-sync.js';
import { harness, loaded } from './harness.js';

/**
 * Show my location moves the camera to the visitor's position (`store.flyTo`). That view is the position itself, so the
 * address (and every link shared from it) keeps the view it had before until the visitor moves the camera themselves.
 */
const HOME = { center: [26.1003, 44.4301] as const, zoom: 16, bearing: 0 };

describe('the view Show my location brings', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('happyPath_theAddressKeepsTheViewItHadUntilTheVisitorMovesTheCamera', async () => {
        const { store, map, location } = await loaded();
        map.emit('moveend', { center: [26.1, 44.43], zoom: 13, bearing: 0 });
        vi.advanceTimersByTime(HASH_WRITE_DELAY_MS);
        const before = location.hash;

        store.flyTo(HOME);
        map.emit('moveend', { ...HOME, zoom: 15.999_999 });
        store.setMapLabels({ streets: false });
        vi.advanceTimersByTime(HASH_WRITE_DELAY_MS);

        expect(store.getState().view.center).toEqual([26.1003, 44.4301]);
        expect(location.hash.split('&')[0]).toBe(before);
        expect(location.written.join(' ')).not.toContain('44.4301');
        map.emit('moveend', { center: [26.12, 44.44], zoom: 15, bearing: 0 });
        vi.advanceTimersByTime(HASH_WRITE_DELAY_MS);
        expect(location.hash.split('&')[0]).toBe('#15/44.44/26.12');
    });

    it('badPath_aPaneOpenedMidFlightEndsItOffThePositionAndTheAddressStillKeepsItsView', async () => {
        const { store, map, location } = await loaded();
        map.emit('moveend', { center: [26.1, 44.43], zoom: 13, bearing: 0 });
        vi.advanceTimersByTime(HASH_WRITE_DELAY_MS);
        const before = location.hash;

        // Mapbox ends a flight at the centre point it started from: a pane that narrowed the map mid-flight leaves the
        // camera half the lost width west of the position, and that is the flight's own `moveend`.
        const offset = { ...HOME, center: [26.098_09, 44.4301] as const };
        store.flyTo(HOME);
        map.emit('moveend', offset);
        map.emit('moveend', offset);
        store.setMapLabels({ streets: false });
        vi.advanceTimersByTime(HASH_WRITE_DELAY_MS);

        expect(location.hash.split('&')[0]).toBe(before);
        expect(location.written.join(' ')).not.toContain('44.4301');
        map.emit('moveend', { center: [26.12, 44.44], zoom: 15, bearing: 0 });
        vi.advanceTimersByTime(HASH_WRITE_DELAY_MS);
        expect(location.hash.split('&')[0]).toBe('#15/44.44/26.12');
    });

    it('badPath_aHashTheVisitorTypesAfterwardsIsTheViewAndIsNotPutBack', async () => {
        const { store, location } = await loaded();
        vi.advanceTimersByTime(HASH_WRITE_DELAY_MS);

        store.flyTo(HOME);
        location.navigate('#14/44.45/26.08');
        store.setMapLabels({ pois: false });
        vi.advanceTimersByTime(HASH_WRITE_DELAY_MS);

        expect(store.getState().view.center).toEqual([26.08, 44.45]);
        expect(location.hash.split('&')[0]).toBe('#14/44.45/26.08');
    });

    it('badPath_beforeTheMapTheAddressStillKeepsThePositionOut', () => {
        const { store, location } = harness();

        store.flyTo(HOME);
        vi.advanceTimersByTime(HASH_WRITE_DELAY_MS);

        expect(store.getState().view).toEqual(HOME);
        expect(location.written.join(' ')).not.toContain('44.4301');
    });
});
