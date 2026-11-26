import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HASH_WRITE_DELAY_MS } from '../../src/core/url-sync.js';
import { loaded } from './harness.js';

/**
 * A historical layer switched on shows (V03, the owner 2026-11-09): the timeline moves to its year, so the layer is
 * always the timeline's; with several on, the timeline follows the last one switched on; switching layers off leaves the
 * timeline where it is. The hash carries the visible layers.
 */
describe('viewer store: a layer switched on moves the timeline to its year', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    function visible(state: { readonly overlays: readonly { readonly id: string; readonly visible: boolean }[] }): string[] {
        return state.overlays.filter((overlay) => overlay.visible && overlay.id.includes('-19')).map((overlay) => overlay.id);
    }

    it('happyPath_aLayerOfAnotherYearMovesTheTimelineAndStaysVisible', async () => {
        const { store, map, location, telemetry } = await loaded();
        store.setYear(1966);

        store.toggleOverlay('kh9-1980', true);
        vi.advanceTimersByTime(HASH_WRITE_DELAY_MS);

        expect(store.getState().year).toBe(1980);
        expect(visible(store.getState())).toEqual(['kh4-1966', 'kh9-1980']);
        expect(map.callsOf('setOverlayVisibility').at(-1)).toEqual(['kh9-1980', true]);
        expect(telemetry.events).toContainEqual({ name: 'year_change', year: 1980 });
        expect(location.written.at(-1)).toContain('layers=kh4-1966,kh9-1980');
    });

    it('happyPath_theTimelineFollowsTheLastLayerSwitchedOnAndBringsItToTheFront', async () => {
        const { store, map, location } = await loaded();

        store.toggleOverlay('kh9-1980', true);
        store.toggleOverlay('kh4-1966', true);
        vi.advanceTimersByTime(HASH_WRITE_DELAY_MS);

        expect(store.getState().year).toBe(1966);
        expect(store.getState().front).toBe('kh4-1966');
        expect(visible(store.getState())).toEqual(['kh4-1966', 'kh9-1980']);
        const [, older] = map.callsOf('setLayerOrder').findLast((call) => call[0] === 'kh4-1966') ?? [];
        const [, newer] = map.callsOf('setLayerOrder').findLast((call) => call[0] === 'kh9-1980') ?? [];
        expect(Number(older)).toBeGreaterThan(Number(newer));
        expect(location.written.at(-1)).toContain('layers=kh9-1980,kh4-1966');
    });

    it('happyPath_aLinkNamingTheOlderLayerLastStandsOnItsYearWithItOnTop', async () => {
        const { store } = await loaded({ hash: '#15/44.43/26.1&layers=kh9-1980,kh4-1966' });

        expect(store.getState().year).toBe(1966);
        expect(store.getState().front).toBe('kh4-1966');
    });

    it('badPath_theTimelinesOwnStopForgetsTheChosenFront', async () => {
        const { store } = await loaded();
        store.toggleOverlay('kh4-1966', true);

        store.setYear(1980);

        expect(store.getState().front).toBeNull();
        expect(visible(store.getState())).toEqual(['kh9-1980']);
    });

    it('badPath_switchingLayersOffLeavesTheTimelineAsItIs', async () => {
        const { store } = await loaded();
        store.toggleOverlay('kh4-1966', true);
        store.toggleOverlay('kh9-1980', true);

        store.toggleOverlay('kh9-1980', false);
        expect(store.getState().year).toBe(1980);
        store.toggleOverlay('kh4-1966', false);

        expect(store.getState().year).toBe(1980);
        expect(visible(store.getState())).toEqual([]);
    });

    it('badPath_anOverlayThatIsNoLayerLeavesTheTimelineAsItIs', async () => {
        const { store, telemetry } = await loaded();
        store.setYear(1966);

        store.toggleOverlay('cladiri');
        store.toggleOverlay('cladiri');

        expect(store.getState().year).toBe(1966);
        expect(telemetry.events.filter((event) => event.name === 'year_change')).toHaveLength(1);
    });
});
