/**
 * The viewer's window size as its state keeps it (moved here from the store, §200): the width class, a compact height and
 * whether the panels can dock.
 */
import { isCompactHeight, isDockable, windowClassFor } from '@hcm/ui';

import type { ViewerState } from './state.js';

/** `state` with the classes of a window of `width` × `height`; the same object when nothing changes. */
export function withWindowSize(state: ViewerState, width: number, height: number): ViewerState {
    const windowClass = windowClassFor(width);
    const compactHeight = isCompactHeight(height);
    const dockable = isDockable(width);
    if (windowClass === state.windowClass && compactHeight === state.compactHeight && dockable === state.dockable) {
        return state;
    }
    return { ...state, windowClass, compactHeight, dockable };
}
