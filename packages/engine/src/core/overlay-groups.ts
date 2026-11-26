/** A place category's sub-group on or off (`poi-groups.ts` of @hcm/shared), the hash following (the owner, 2026-11-22). */
import { withOverlayGroup, withOverlayOpacity } from '@hcm/shared';

import type { ViewerState } from './state.js';
import type { HashWriter } from './url-sync.js';

/** What the action needs of the store. */
export interface GroupHost {
    getState(): ViewerState;
    set(next: ViewerState): void;
    readonly hash: Pick<HashWriter, 'schedule'>;
}

export function setOverlayGroup(store: GroupHost, id: string, group: string, visible: boolean): void {
    const state = store.getState();
    store.set({ ...state, overlays: withOverlayGroup(state.overlays, id, group, visible) });
    store.hash.schedule();
}

/** An overlay's opacity, live; `final` (a slider released) also writes the hash. */
export function setOverlayOpacityOf(store: GroupHost, id: string, opacity: number, final: boolean): void {
    const state = store.getState();
    const overlays = withOverlayOpacity(state.overlays, id, opacity);
    if (overlays !== state.overlays) {
        store.set({ ...state, overlays });
    }
    if (final) {
        store.hash.schedule();
    }
}
