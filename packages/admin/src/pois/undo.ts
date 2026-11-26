/**
 * Undo of a place's delete (docs/research/M2c-interfaces.md §9.5, behaviour A33): right after the delete the place's
 * history is watched for the delete's entry (the trigger writes it within seconds); Undo restores the place from it with
 * `history.revert`, waiting at most `UNDO_WAIT_MS` for the entry when it has not arrived yet. Each delete has its own
 * `DeleteUndo`, which stops watching once used, or when the snackbar's ten seconds have passed.
 */
import { FIRESTORE_PATHS, historyEntryDocSchema, type AdminContentKey, type ApiErrorCode } from '@hcm/shared';

import type { Clock, Unsubscribe } from '../app/ports.js';
import type { ContentStore } from '../content/services.js';
import { CallableFailure, type CallablesPort } from '../firebase/ports.js';

/** How long the delete's entry is waited for, and how long Undo is offered. */
export const UNDO_WAIT_MS = 10_000;

export type UndoResult = { readonly ok: true } | { readonly ok: false; readonly error: AdminContentKey | ApiErrorCode };

export interface UndoDeps {
    readonly cityId: string;
    readonly store: Pick<ContentStore, 'watchQuery'>;
    readonly callables: CallablesPort;
    readonly clock: Clock;
}

const NEWEST = { orderBy: [['updatedAt', 'desc']], limit: 1 } as const;

export class DeleteUndo {
    readonly #deps: UndoDeps;
    readonly #poiId: string;
    #entry: string | null = null;
    #stop: Unsubscribe | null = null;
    #timer: unknown = null;
    /** Who waits for the entry (an Undo that came first). */
    #waiting: ((entry: string | null) => void) | null = null;

    constructor(poiId: string, deps: UndoDeps) {
        this.#deps = deps;
        this.#poiId = poiId;
        const path = FIRESTORE_PATHS.history({ entity: 'poi', cityId: deps.cityId, entityId: poiId });
        this.#timer = deps.clock.setTimeout(() => {
            this.#settle(null);
        }, UNDO_WAIT_MS);
        const stop = deps.store.watchQuery(
            path,
            historyEntryDocSchema,
            NEWEST,
            (page) => {
                const newest = page.docs[0];
                if (newest?.data.action === 'delete') {
                    this.#settle(newest.id);
                }
            },
            () => {
                this.#settle(null);
            },
        );
        this.#stop = stop;
        if (this.#timer === null) {
            stop();
        }
    }

    /** The watch ended: with the entry, or without one (the wait ran out or the listener failed). */
    #settle(entry: string | null): void {
        if (this.#timer === null) {
            return;
        }
        this.#deps.clock.clearTimeout(this.#timer);
        this.#timer = null;
        this.#entry = entry;
        this.#stop?.();
        this.#stop = null;
        this.#waiting?.(entry);
        this.#waiting = null;
    }

    #entryId(): Promise<string | null> {
        if (this.#timer === null) {
            return Promise.resolve(this.#entry);
        }
        return new Promise((resolve) => {
            this.#waiting = resolve;
        });
    }

    /** Restores the place from its delete's entry. */
    async undo(): Promise<UndoResult> {
        const entryId = await this.#entryId();
        if (entryId === null) {
            return { ok: false, error: 'adminContent.pois.undoUnavailable' };
        }
        try {
            await this.#deps.callables.call('history.revert', { cityId: this.#deps.cityId, entity: 'poi', entityId: this.#poiId, entryId });
            return { ok: true };
        } catch (error) {
            return { ok: false, error: error instanceof CallableFailure ? error.details.code : 'apiError.internal' };
        }
    }

    /** Stops watching (the page closed). */
    dispose(): void {
        this.#settle(this.#entry);
    }
}
