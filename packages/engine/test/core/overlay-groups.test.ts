import { describe, expect, it, vi } from 'vitest';

import { setOverlayGroup, setOverlayOpacityOf, type GroupHost } from '../../src/core/overlay-groups.js';
import { initialState, withManifest, type ViewerState } from '../../src/core/state.js';
import { manifest } from './fixtures.js';

/** A store holding one state, its hash writer a spy. */
function host(): GroupHost & { state: ViewerState; readonly schedule: ReturnType<typeof vi.fn> } {
    const schedule = vi.fn();
    const store = {
        state: withManifest(initialState('ro', 'system', 'unknown'), manifest()),
        schedule,
        hash: { schedule },
        getState: () => store.state,
        set: (next: ViewerState) => {
            store.state = next;
        },
    };
    return store;
}

describe("a place category's sub-groups and opacity", () => {
    it('happyPath_aSubGroupTurnedOffIsHiddenAndTheHashFollows', () => {
        const store = host();
        const id = store.state.overlays[0]?.id ?? '';

        setOverlayGroup(store, id, 'poduri', false);

        expect(store.state.overlays[0]?.hiddenGroups).toEqual(['poduri']);
        expect(store.schedule).toHaveBeenCalledOnce();
    });

    it('happyPath_aSliderMovesTheOpacityLiveAndWritesTheHashOnRelease', () => {
        const store = host();
        const id = store.state.overlays[0]?.id ?? '';

        setOverlayOpacityOf(store, id, 0.25, false);
        expect(store.state.overlays[0]?.opacity).toBe(0.25);
        expect(store.schedule).not.toHaveBeenCalled();

        setOverlayOpacityOf(store, id, 0.25, true);
        expect(store.schedule).toHaveBeenCalledOnce();
    });

    it('badPath_anUnchangedOpacityKeepsTheState', () => {
        const store = host();
        const before = store.state;

        setOverlayOpacityOf(store, 'no-such-overlay', 0.5, false);

        expect(store.state).toBe(before);
    });
});
