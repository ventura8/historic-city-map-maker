/**
 * Removing a pair in the georeferencer (`docs/research/M3-interfaces.md` §10.4): from its row, the button beside the panes, Delete
 * or Backspace on either pane, or the context menu. The pair goes (one Undo step) and a notice says which, with **Undo** for ten
 * seconds: that puts this very pair back where it was in the list, whatever was edited since. Out of `./georef.ts`, which keeps its
 * 400 lines.
 */
import type { Gcp } from '@hcm/shared';

import type { ContentServices } from '../content/services.js';
import { withoutPair } from './pairs.js';

export interface RemovingHost {
    readonly services: Pick<ContentServices, 'notify' | 'readOnly'>;
    readonly pairs: () => readonly Gcp[];
    /** One edit of the pairs (one Undo step). */
    readonly edit: (pairs: readonly Gcp[]) => void;
}

/** The list with `pair` back at `index` (at the end when the list got shorter); unchanged when a pair of that id is there. */
export function withRestored(pairs: readonly Gcp[], pair: Gcp, index: number): readonly Gcp[] {
    if (pairs.some((item) => item.id === pair.id)) {
        return pairs;
    }
    return [...pairs.slice(0, index), pair, ...pairs.slice(index)];
}

/** Removes the pair `id` and says so, with Undo; nothing for a pair that is not there or an admin who may not edit. */
export function removePair(host: RemovingHost, id: string): void {
    const pairs = host.pairs();
    const index = pairs.findIndex((pair) => pair.id === id);
    const pair = pairs[index];
    if (pair === undefined || host.services.readOnly()) {
        return;
    }
    host.edit(withoutPair(pairs, id));
    host.services.notify({
        key: 'adminContent.georef.pairRemoved',
        params: { number: String(index + 1) },
        action: {
            key: 'adminContent.georef.pairRemovedUndo',
            run: () => {
                host.edit(withRestored(host.pairs(), pair, index));
            },
        },
    });
}
