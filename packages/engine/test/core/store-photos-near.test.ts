import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PhotoFeatureCollection } from '@hcm/ui/map';
import { applyDecodedHash, hashStateOf, HASH_WRITE_DELAY_MS } from '../../src/core/url-sync.js';
import { loaded } from './harness.js';

/** Design B (the owner, 2026-11-15): every photo by default, or only those within 5, 10 or 25 years of the year. */
describe('viewer store: the photos near the year', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('happyPath_aWindowRedrawsOnlyThePhotosNearTheYearAndGoesInTheHash', async () => {
        const { store, map, location } = await loaded();
        store.setYear(1980);
        const points = (): unknown[] =>
            (map.callsOf('setPhotosData').at(-1)?.[0] as PhotoFeatureCollection).features
                .filter((feature) => feature.geometry.type === 'Point')
                .map((feature) => feature.properties.id);
        expect(points()).toHaveLength(3);

        store.setPhotosNear(10);
        vi.advanceTimersByTime(HASH_WRITE_DELAY_MS);

        expect(store.getState().photosNear).toBe(10);
        expect(points()).toEqual(['mihai-voda-1978']);
        expect(location.hash).toContain('near=10');

        store.setPhotosNear(null);
        expect(points()).toHaveLength(3);
    });

    it('badPath_aWindowNotOfferedOrTheSameOneChangesNothing', async () => {
        const { store } = await loaded();
        const before = store.getState();

        store.setPhotosNear(7);
        store.setPhotosNear(null);

        expect(store.getState()).toBe(before);
    });

    it('happyPath_theHashCarriesTheWindowBothWays', async () => {
        const { store } = await loaded();
        const state = applyDecodedHash(store.getState(), { legacy: false, photosNear: 25 }).state;

        expect(state.photosNear).toBe(25);
        expect(hashStateOf(state, 'ro').photosNear).toBe(25);
        expect(hashStateOf(store.getState(), 'ro').photosNear).toBeUndefined();
    });
});
