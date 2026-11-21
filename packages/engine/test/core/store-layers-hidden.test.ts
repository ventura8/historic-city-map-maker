import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HASH_WRITE_DELAY_MS } from '../../src/core/url-sync.js';
import { loaded } from './harness.js';

/**
 * The extra-large Layers pane minimized to its rail (V03, the owner 2026-11-08) is the store's, so it outlives the pane's
 * element: leaving the extra-large layout and coming back re-creates the pane, which reads it again. It lasts for the
 * session only: never in the URL hash, never in the visitor's stored choices.
 */
describe('viewer store: the minimized Layers pane', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('happyPath_theMinimizedPaneOutlivesALayoutChange', async () => {
        const { store } = await loaded();
        expect(store.getState().layersHidden).toBe(false);

        store.setLayersHidden(true);
        store.setWindowSize(1200, 800);
        store.setWindowSize(1920, 1080);

        expect(store.getState().layersHidden).toBe(true);
        store.setLayersHidden(false);
        expect(store.getState().layersHidden).toBe(false);
    });

    it('badPath_itIsNeitherInTheHashNorStored', async () => {
        const { store, location, storage } = await loaded();
        vi.advanceTimersByTime(HASH_WRITE_DELAY_MS);
        const written = location.written.length;
        const stored = [...storage.keys()];

        store.setLayersHidden(true);
        vi.advanceTimersByTime(HASH_WRITE_DELAY_MS);

        expect(location.written.slice(written)).toEqual([]);
        expect([...storage.keys()]).toEqual(stored);
    });
});
