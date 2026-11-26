/**
 * The photos area's actions on whole photos (`docs/research/M2c-interfaces.md` §1.5, §6.2, §6.5, §6.6, §9.5): the
 * bulk actions with their one snackbar ("12 published, 2 skipped: see why"), the one-click rights confirmation and
 * place confirmation, and the delete with its confirmation and Undo (a bulk delete points to History instead).
 */
import { FIRESTORE_PATHS, type PhotoDoc } from '@hcm/shared';

import { runBulk, type BulkAction, type BulkReport } from './bulk.js';
import type { AreaContext } from './context.js';
import type { PhotoEditing } from './editing.js';
import { writeErrorKey } from './messages.js';
import type { Stored } from '../content/services.js';
import { undoDelete } from './undo.js';

export interface ActionIntents {
    /** Publish, Unpublish, Confirm rights, Set author, source and licence on the selection (Delete asks first). */
    bulk(action: Exclude<BulkAction, { kind: 'delete' }>): Promise<void>;
    /** One-click rights confirmation of one photo (the Rights review queue). */
    confirmRights(photoId: string): Promise<void>;
    /** The fallback pin is right: the photo may be published (§6.2 step 5). */
    confirmPlace(photoId: string): void;
    /** Asks before deleting the open photo (no ids) or the given photos. */
    requestDelete(ids?: readonly string[]): void;
    cancelConfirm(): void;
    /** Deletes what the confirmation names; true when something was deleted. */
    confirmDelete(): Promise<boolean>;
    /** Opens the last bulk action's skipped photos ("See why"). */
    showReport(): void;
    closeReport(): void;
}

export class PhotoActions {
    readonly #context: AreaContext;
    readonly #editing: PhotoEditing;
    #report: BulkReport | null = null;
    readonly intents: ActionIntents;

    constructor(context: AreaContext, editing: PhotoEditing) {
        this.#context = context;
        this.#editing = editing;
        this.intents = this.#makeIntents();
    }

    /** The photo as read: from the open editor, else from the list. */
    #stored(photoId: string): Stored<PhotoDoc> | null {
        const editor = this.#editing.editor;
        return editor?.id === photoId ? editor.stored : (this.#context.list.doc(photoId) ?? null);
    }

    async #bulk(action: BulkAction, photos: readonly Stored<PhotoDoc>[]): Promise<void> {
        const { services, memory, list } = this.#context;
        this.#context.set({ busy: true, report: null });
        const checkPlace = memory.checkPlace();
        const report = await runBulk(
            { store: services.store, cityId: services.cityId, checkPlace: (id) => checkPlace.has(id) },
            action,
            photos,
        );
        if (action.kind === 'setFields') {
            memory.rememberSticky(action.fields);
        }
        this.#report = report;
        this.#context.set({ busy: false, sticky: memory.sticky() });
        list.select(report.skipped.map((skip) => skip.id));
        const params = { done: String(report.done), skipped: String(report.skipped.length) };
        const seeWhy =
            report.skipped.length === 0
                ? {}
                : {
                      action: {
                          key: 'adminContent.photos.bulk.seeWhy' as const,
                          run: () => {
                              this.#show();
                          },
                      },
                  };
        services.notify({ key: `adminContent.photos.bulk.${report.kind}`, params, ...seeWhy });
    }

    #show(): void {
        this.#context.set({ report: this.#report });
    }

    /** The open photo, as a selection of one (none without an editor). */
    #openPhoto(): readonly string[] {
        const editor = this.#editing.editor;
        return editor === null ? [] : [editor.id];
    }

    #titleOf(photoId: string): string | null {
        return this.#stored(photoId)?.data.title.ro ?? null;
    }

    #requestDelete(ids: readonly string[] | undefined): void {
        const chosen = ids ?? this.#openPhoto();
        const [first] = chosen;
        if (first !== undefined) {
            this.#context.set({ confirm: { ids: chosen, title: chosen.length === 1 ? this.#titleOf(first) : null } });
        }
    }

    async #confirmDelete(): Promise<boolean> {
        const confirm = this.#context.state().confirm;
        this.#context.set({ confirm: null });
        if (confirm === null) {
            return false;
        }
        const [only, ...rest] = confirm.ids;
        return only !== undefined && rest.length === 0 ? this.#deleteOne(only, confirm.title) : this.#deleteMany(confirm.ids);
    }

    async #deleteOne(photoId: string, title: string | null): Promise<boolean> {
        const { services, memory } = this.#context;
        this.#context.set({ busy: true });
        const outcome = await services.store.remove(
            FIRESTORE_PATHS.photo(services.cityId, photoId),
            this.#stored(photoId)?.version ?? null,
        );
        this.#context.set({ busy: false });
        if (!outcome.ok) {
            services.notify({ key: writeErrorKey(outcome.reason) });
            return false;
        }
        memory.markCheckPlace(photoId, false);
        services.notify({ key: 'adminContent.photos.deleted', params: { title: title ?? photoId }, ...this.#undoOffer(photoId) });
        return true;
    }

    /** M13 §1: bringing a photo back reads its history, which an uploader may not. */
    #undoOffer(photoId: string) {
        return this.#context.services.cityRole() === 'uploader'
            ? {}
            : { action: { key: 'adminContent.photos.undoAction', run: () => void this.#undo(photoId) } as const };
    }

    async #deleteMany(ids: readonly string[]): Promise<boolean> {
        const wanted = new Set(ids);
        await this.#bulk(
            { kind: 'delete' },
            this.#context.list.docs.filter((stored) => wanted.has(stored.id)),
        );
        return true;
    }

    async #undo(photoId: string): Promise<void> {
        const outcome = await undoDelete(this.#context.services, photoId);
        this.#context.services.notify(outcome.ok ? { key: 'adminContent.photos.restored' } : { key: outcome.error });
    }

    #confirmPlace(photoId: string): void {
        this.#context.memory.markCheckPlace(photoId, false);
        this.#context.list.refresh();
        this.#editing.refresh();
    }

    #makeIntents(): ActionIntents {
        return {
            bulk: (action) => this.#bulk(action, this.#context.list.selected()),
            confirmRights: async (photoId) => {
                const stored = this.#stored(photoId);
                await this.#bulk({ kind: 'confirmRights' }, stored === null ? [] : [stored]);
            },
            confirmPlace: (photoId) => {
                this.#confirmPlace(photoId);
            },
            requestDelete: (ids) => {
                this.#requestDelete(ids);
            },
            cancelConfirm: () => {
                this.#context.set({ confirm: null });
            },
            confirmDelete: () => this.#confirmDelete(),
            showReport: () => {
                this.#show();
            },
            closeReport: () => {
                this.#context.set({ report: null });
            },
        };
    }
}
