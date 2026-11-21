/**
 * What the places area writes (and reads whole for Export all), and what it tells the admin (docs/research/M2c-interfaces.md §1.6, §5.3, §9.5): Save
 * (and the remembered category of the next new place), a delete with Undo for ten seconds, and the bulk actions, each
 * ending in one snackbar, and the starter categories a city without any is offered; a refused write says why, and a `denied` one makes the shell ask who this is again.
 */
import { FIRESTORE_PATHS } from '@hcm/shared';

import type { ContentServices, WriteOutcome } from '../content/services.js';
import { runBulk, type BulkAction } from './bulk.js';
import type { PlaceEditor } from './editor.js';
import type { CategoryItem, PoiItem } from './model.js';
import { everyPlace, WRITE_FAILURES, type WriteFailure } from './places.js';
import { addStarterCategories } from './starter.js';
import { DeleteUndo, UNDO_WAIT_MS } from './undo.js';

/** `localStorage`: the category a new place starts in (§5.6). */
export const LAST_CATEGORY_KEY = 'hcm:admin:lastCategory';

export type ActionServices = Pick<ContentServices, 'cityId' | 'store' | 'callables' | 'clock' | 'local' | 'notify' | 'cityRole' | 'denied'>;

export class PlaceActions {
    readonly #services: ActionServices;
    readonly #changed: (patch: { readonly busy?: boolean; readonly exporting?: boolean }) => void;
    #undo: DeleteUndo | null = null;

    constructor(services: ActionServices, changed: (patch: { readonly busy?: boolean; readonly exporting?: boolean }) => void) {
        this.#services = services;
        this.#changed = changed;
    }

    #busy(busy: boolean): void {
        this.#changed({ busy });
    }

    /**
     * Export all: every place of the city that reads, whatever the list loaded; null when they could not be read. The snackbar
     * says so, or how many places the file leaves out.
     */
    async everyPlace(): Promise<readonly PoiItem[] | null> {
        this.#changed({ exporting: true });
        const read = await everyPlace(this.#services);
        this.#changed({ exporting: false });
        if (read === null) {
            this.#services.notify({ key: 'adminContent.pois.exportFailed' });
        } else if (read.unreadable.length > 0) {
            this.#services.notify({ key: 'adminContent.pois.exportPartial', params: { count: String(read.unreadable.length) } });
        }
        return read?.places ?? null;
    }

    refused(reason: WriteFailure): void {
        if (reason === 'denied') {
            this.#services.denied();
        }
        this.#services.notify({ key: WRITE_FAILURES[reason] });
    }

    async save(editor: PlaceEditor): Promise<WriteOutcome> {
        const outcome = await editor.save();
        if (!outcome.ok) {
            this.refused(outcome.reason);
            return outcome;
        }
        const category = editor.state.draft?.value.category ?? '';
        if (category !== '') {
            this.#services.local.set(LAST_CATEGORY_KEY, category);
        }
        this.#services.notify({ key: 'adminContent.pois.saved' });
        return outcome;
    }

    /** Deletes the open place; the snackbar offers Undo for ten seconds. */
    async remove(editor: PlaceEditor): Promise<WriteOutcome | null> {
        const base = editor.state.draft?.base ?? null;
        if (base === null) {
            return null;
        }
        this.#busy(true);
        const outcome = await this.#services.store.remove(FIRESTORE_PATHS.poi(this.#services.cityId, editor.id), base.version);
        this.#busy(false);
        if (outcome.ok) {
            this.#offerUndo(editor.id);
        } else {
            this.refused(outcome.reason);
        }
        return outcome;
    }

    #offerUndo(id: string): void {
        this.dispose();
        // M13 §1: bringing a place back reads its history, which an uploader may not.
        if (this.#services.cityRole() === 'uploader') {
            this.#services.notify({ key: 'adminContent.pois.deleted' });
            return;
        }
        const { cityId, store, callables, clock } = this.#services;
        const undo = new DeleteUndo(id, { cityId, store, callables, clock });
        this.#undo = undo;
        const run = (): void => {
            void this.#runUndo(undo);
        };
        this.#services.notify({ key: 'adminContent.pois.deleted', action: { key: 'adminContent.pois.undo', run } });
        clock.setTimeout(() => {
            undo.dispose();
        }, UNDO_WAIT_MS);
    }

    async #runUndo(undo: DeleteUndo): Promise<void> {
        const result = await undo.undo();
        this.#services.notify({ key: result.ok ? 'adminContent.pois.restored' : result.error });
    }

    /** A bulk action on the selected places; true when every write went through. */
    async bulk(action: BulkAction, selected: readonly PoiItem[], selectionSize: number): Promise<boolean> {
        this.#busy(true);
        const outcome = await runBulk(this.#services.store, this.#services.cityId, action, selected);
        this.#busy(false);
        const params = { changed: String(outcome.changed), skipped: String(selectionSize - outcome.changed) };
        if (outcome.failure !== null) {
            if (outcome.failure === 'denied') {
                this.#services.denied();
            }
            this.#services.notify({ key: 'adminContent.pois.bulkStopped', params });
            return false;
        }
        this.#services.notify({ key: action.kind === 'delete' ? 'adminContent.pois.bulkDeleted' : 'adminContent.pois.bulkDone', params });
        return true;
    }

    /** The starter categories, for a city with none (finding 35 of 2026-11-01); one snackbar says how it went. */
    async addStarters(categories: readonly CategoryItem[]): Promise<WriteOutcome> {
        this.#busy(true);
        const outcome = await addStarterCategories(this.#services.store, this.#services.cityId, categories);
        this.#busy(false);
        if (outcome.ok) {
            this.#services.notify({ key: 'adminContent.pois.startersAdded' });
        } else {
            this.refused(outcome.reason);
        }
        return outcome;
    }

    /** Stops watching for a delete's history entry (a new delete, or the page closed). */
    dispose(): void {
        this.#undo?.dispose();
        this.#undo = null;
    }
}
