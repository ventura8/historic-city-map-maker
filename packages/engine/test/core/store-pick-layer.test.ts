import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HASH_WRITE_DELAY_MS } from '../../src/core/url-sync.js';
import { layer, manifest } from './fixtures.js';
import { loaded } from './harness.js';

/**
 * V13: a year with several dates on the timeline; picking one stands the timeline on its year, every layer of that year
 * visible, the picked one on top (V15's front, so `layers=` names it last).
 */
describe('viewer store: a date picked on the timeline', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    const twoDates = (): ReturnType<typeof manifest> =>
        manifest({
            layers: [
                layer({ id: 'kh4-1966', date: '1966-04-12' }),
                layer({ id: 'kh4-1966b', date: '1966-09-03', order: 2 }),
                layer({ id: 'kh9-1980', year: 1980, order: 3 }),
            ],
        });

    it('happyPath_thePickedDateComesToTheFrontOfItsYear', async () => {
        const { store, location, telemetry } = await loaded({ manifest: twoDates() });

        store.pickLayer('kh4-1966');
        vi.advanceTimersByTime(HASH_WRITE_DELAY_MS);

        const state = store.getState();
        expect(state.year).toBe(1966);
        expect(state.front).toBe('kh4-1966');
        const visible = state.overlays.filter((overlay) => overlay.visible && overlay.kind === 'raster').map((overlay) => overlay.id);
        expect(new Set(visible)).toEqual(new Set(['kh4-1966', 'kh4-1966b']));
        expect(telemetry.events).toContainEqual({ name: 'year_change', year: 1966 });
        expect(location.written.at(-1)).toContain('layers=kh4-1966b,kh4-1966');
    });

    it('badPath_anUnknownOrTheSameDateChangesNothing', async () => {
        const { store, telemetry } = await loaded({ manifest: twoDates() });
        store.pickLayer('kh4-1966b');
        const picked = store.getState();
        const events = telemetry.events.length;

        store.pickLayer('no-such-layer');
        store.pickLayer('kh4-1966b');

        expect(store.getState()).toBe(picked);
        expect(telemetry.events).toHaveLength(events);
    });

    it('happyPath_anotherDateOfTheSameYearSwapsTheFrontWithoutAYearChange', async () => {
        const { store, telemetry } = await loaded({ manifest: twoDates() });
        store.pickLayer('kh4-1966b');
        const events = telemetry.events.filter((event) => event.name === 'year_change').length;

        store.pickLayer('kh4-1966');

        expect(store.getState().front).toBe('kh4-1966');
        expect(telemetry.events.filter((event) => event.name === 'year_change')).toHaveLength(events);
    });
});
