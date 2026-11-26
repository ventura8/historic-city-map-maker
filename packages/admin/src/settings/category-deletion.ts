/**
 * Deleting a POI category (`docs/research/M2c-interfaces.md` §9.5; behaviours A33, A39): Delete counts the places that
 * use it; a category in use asks where its places go (one choice among the other categories) and is deleted only after
 * they moved, in batches, the category last (S-A33-BAD-CATEGORY-IN-USE). Without a choice nothing changes, and neither when
 * its places cannot be read (S-A33-BAD-CATEGORY-UNREAD): the places would still name a category that no longer exists. A
 * deleted category comes back from History.
 */
import { FIRESTORE_PATHS, MAX_POIS, poiDocSchema } from '@hcm/shared';

import { readOnce, type ReadFailure } from '../content/read-once.js';
import type { ContentServices, WriteOutcome } from '../content/services.js';
import { deletionBatches } from './categories.js';

export type CategoryDeletionState =
    | { readonly phase: 'idle' }
    | {
          readonly phase: 'counting' | 'confirm' | 'running';
          readonly id: string;
          readonly label: string;
          /** Places that use the category (null while counting, or when the count failed). */
          readonly inUse: number | null;
          /** Where those places go. */
          readonly target: string | null;
      };

const IDLE: CategoryDeletionState = { phase: 'idle' };

export class CategoryDeletion {
    readonly #services: ContentServices;
    readonly #changed: (state: CategoryDeletionState) => void;
    #state: CategoryDeletionState = IDLE;

    constructor(services: ContentServices, changed: (state: CategoryDeletionState) => void) {
        this.#services = services;
        this.#changed = changed;
    }

    get state(): CategoryDeletionState {
        return this.#state;
    }

    async ask(category: { readonly id: string; readonly label: string }): Promise<void> {
        if (this.#state.phase !== 'idle') {
            return;
        }
        this.#set({ phase: 'counting', id: category.id, label: category.label, inUse: null, target: null });
        const { store, cityId } = this.#services;
        const inUse = await store.count(FIRESTORE_PATHS.pois(cityId), { where: [['category', '==', category.id]] });
        const counting = this.#current();
        if (counting.phase === 'counting' && counting.id === category.id) {
            this.#set({ ...counting, phase: 'confirm', inUse });
        }
    }

    /** The state now (read after an `await`: a Cancel may have closed the dialog meanwhile). */
    #current(): CategoryDeletionState {
        return this.#state;
    }

    setTarget(target: string | null): void {
        if (this.#state.phase === 'confirm') {
            this.#set({ ...this.#state, target });
        }
    }

    cancel(): void {
        if (this.#state.phase === 'counting' || this.#state.phase === 'confirm') {
            this.#set(IDLE);
        }
    }

    /** Moves the places and deletes the category; the first refused batch's outcome, or ok. Null when it may not run. */
    async confirm(): Promise<WriteOutcome | null> {
        const state = this.#state;
        if (state.phase !== 'confirm' || (state.inUse !== 0 && state.target === null)) {
            return null;
        }
        this.#set({ ...state, phase: 'running' });
        const outcome = await this.#run(state.id, state.target);
        this.#set(outcome.ok ? IDLE : { ...state, phase: 'confirm' });
        return outcome;
    }

    async #run(id: string, target: string | null): Promise<WriteOutcome> {
        const { store, cityId } = this.#services;
        const places = await this.#placesOf(id, target);
        if (typeof places === 'string') {
            return { ok: false, reason: places };
        }
        for (const batch of deletionBatches(cityId, id, places, target)) {
            const outcome = await store.batch(batch);
            if (!outcome.ok) {
                return outcome;
            }
        }
        return { ok: true };
    }

    /** The places of category `id` that move to `target` (none without a target: the category was not in use), or why not read. */
    async #placesOf(id: string, target: string | null): Promise<readonly string[] | ReadFailure> {
        if (target === null) {
            return [];
        }
        const { page, failure } = await readOnce(this.#services, FIRESTORE_PATHS.pois(this.#services.cityId), poiDocSchema, {
            where: [['category', '==', id]],
            limit: MAX_POIS,
        });
        return page === null ? failure : page.docs.map((poi) => poi.id);
    }

    #set(state: CategoryDeletionState): void {
        this.#state = state;
        this.#changed(state);
    }
}
