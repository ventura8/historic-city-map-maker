/**
 * Undo of a photo's delete (`docs/research/M2c-interfaces.md` §9.5, behaviour A33): the history trigger writes the
 * delete's entry within seconds; Undo waits for it (at most ten seconds) and asks `history.revert` to restore it. The
 * editing kit may offer the same for every area later; the steps are the contract's.
 */
import { FIRESTORE_PATHS, historyEntryDocSchema, type AdminContentKey, type ApiErrorCode, type HistoryEntryDoc } from '@hcm/shared';

import type { Unsubscribe } from '../app/ports.js';
import { CallableFailure } from '../firebase/ports.js';
import type { StoredPage } from '../content/services.js';
import type { PhotosServices } from './ports.js';

/** How long Undo waits for the delete's history entry. */
export const UNDO_WAIT_MS = 10_000;

export type UndoOutcome = { readonly ok: true } | { readonly ok: false; readonly error: AdminContentKey | ApiErrorCode };

type UndoServices = Pick<PhotosServices, 'cityId' | 'store' | 'callables' | 'clock'>;

/** The id of the photo's newest history entry once it is its delete; null after `UNDO_WAIT_MS` without one. */
export function deleteEntry(services: UndoServices, photoId: string): Promise<string | null> {
    const path = FIRESTORE_PATHS.history({ entity: 'photo', cityId: services.cityId, entityId: photoId });
    return new Promise((resolve) => {
        const watch: { done: boolean; stop: Unsubscribe | null } = { done: false, stop: null };
        const finish = (entryId: string | null): void => {
            if (watch.done) {
                return;
            }
            watch.done = true;
            services.clock.clearTimeout(timer);
            watch.stop?.();
            resolve(entryId);
        };
        const timer = services.clock.setTimeout(() => {
            finish(null);
        }, UNDO_WAIT_MS);
        const seen = (page: StoredPage<HistoryEntryDoc>): void => {
            const newest = page.docs[0];
            if (newest?.data.action === 'delete') {
                finish(newest.id);
            }
        };
        const query = { orderBy: [['updatedAt', 'desc']], limit: 1 } as const;
        const unsubscribe = services.store.watchQuery(path, historyEntryDocSchema, query, seen, () => {
            finish(null);
        });
        // The listener may answer before `watchQuery` returns: then the watch ends at once.
        if (watch.done) {
            unsubscribe();
        } else {
            watch.stop = unsubscribe;
        }
    });
}

/** Restores a deleted photo from its delete's history entry. */
export async function undoDelete(services: UndoServices, photoId: string): Promise<UndoOutcome> {
    const entryId = await deleteEntry(services, photoId);
    if (entryId === null) {
        return { ok: false, error: 'adminContent.photos.undo.unavailable' };
    }
    try {
        await services.callables.call('history.revert', { cityId: services.cityId, entity: 'photo', entityId: photoId, entryId });
        return { ok: true };
    } catch (error) {
        return { ok: false, error: error instanceof CallableFailure ? error.details.code : 'apiError.internal' };
    }
}
