/**
 * The georeferencer's picked-up point (the context menu's Move this point, `docs/research/M3-interfaces.md` §10.4): a click on its
 * pane drops it there (one Undo step), one elsewhere or Esc puts it back, and a pair that went away (deleted, undone) waits for
 * nothing. Out of `./georef.ts`, which keeps its 400 lines.
 */
import type { Gcp } from '@hcm/shared';

import type { Store } from '../state/store.js';
import type { GeorefMap } from './georef-map.js';
import type { GeorefState } from './state.js';

export interface MovingHost {
    readonly cell: Store<GeorefState>;
    readonly map: Pick<GeorefMap, 'setAdding'>;
    /** One edit of the pairs (one Undo step). */
    readonly edit: (pairs: readonly Gcp[]) => void;
}

/** The point is put back: both panes go back to their modes. */
export function putBack(host: MovingHost): void {
    host.cell.update({ moving: null });
    host.map.setAdding(host.cell.state.adding);
}

/** A click on `pane` while a point is picked up: dropped there when it is its pane, else put back; false when none is picked up. */
export function dropped(host: MovingHost, pane: 'scan' | 'map', moved: (id: string) => readonly Gcp[]): boolean {
    const moving = host.cell.state.moving;
    if (moving === null) {
        return false;
    }
    putBack(host);
    if (moving.pane === pane) {
        host.edit(moved(moving.id));
    }
    return true;
}

/** A picked-up point whose pair is no longer among `pairs` is put back. */
export function dropGone(host: MovingHost, pairs: readonly Gcp[]): void {
    const moving = host.cell.state.moving;
    if (moving !== null && !pairs.some((pair) => pair.id === moving.id)) {
        putBack(host);
    }
}
