/**
 * Bulk actions on the places list (docs/research/M2c-interfaces.md §1.5; S-A33-HAPPY-BULK): publish, unpublish, move to
 * a category and delete the selection, in Firestore batches of at most `MAX_BATCH_WRITES`. A selected place that is no
 * longer loaded (deleted meanwhile) or would not change is left alone and counted as skipped; a batch the store refuses
 * stops the action, and the outcome says how many were changed.
 */
import { FIRESTORE_PATHS } from '@hcm/shared';

import { MAX_BATCH_WRITES, type BatchWrite, type ContentStore, type WriteOutcome } from '../content/services.js';
import type { PoiItem } from './model.js';

export type BulkAction =
    | { readonly kind: 'publish'; readonly published: boolean }
    | { readonly kind: 'move'; readonly category: string }
    | { readonly kind: 'delete' };

export interface BulkOutcome {
    readonly changed: number;
    readonly skipped: number;
    /** Why the action stopped early (a refused batch), or null. */
    readonly failure: Exclude<WriteOutcome, { readonly ok: true }>['reason'] | null;
}

/** Whether the action changes this place at all. */
function changes(action: BulkAction, place: PoiItem): boolean {
    if (action.kind === 'publish') {
        return place.published !== action.published;
    }
    return action.kind === 'delete' || place.category !== action.category;
}

function writeOf(action: BulkAction, path: string): BatchWrite {
    if (action.kind === 'delete') {
        return { kind: 'delete', path };
    }
    return { kind: 'update', path, fields: action.kind === 'publish' ? { published: action.published } : { category: action.category } };
}

export async function runBulk(
    store: Pick<ContentStore, 'batch'>,
    cityId: string,
    action: BulkAction,
    selected: readonly PoiItem[],
): Promise<BulkOutcome> {
    const targets = selected.filter((place) => changes(action, place));
    const writes = targets.map((place) => writeOf(action, FIRESTORE_PATHS.poi(cityId, place.id)));
    let changed = 0;
    for (let start = 0; start < writes.length; start += MAX_BATCH_WRITES) {
        const batch = writes.slice(start, start + MAX_BATCH_WRITES);
        const outcome = await store.batch(batch);
        if (!outcome.ok) {
            return { changed, skipped: selected.length - changed, failure: outcome.reason };
        }
        changed += batch.length;
    }
    return { changed, skipped: selected.length - changed, failure: null };
}
