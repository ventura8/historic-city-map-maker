/**
 * The photo list (`docs/research/M2c-interfaces.md` §6.1, §1.4, §1.5): one live query per filter (the editors'
 * `LiveList`: 50 photos a page, More one page longer, "Reconnecting…" while the listener comes back, an error with Try
 * again), the search over the loaded photos, and the bulk selection.
 */
import { FIRESTORE_PATHS, photoDocSchema, type PhotoDoc } from '@hcm/shared';

import type { Clock } from '../app/ports.js';
import { LiveList, type ListState } from '../content/list.js';
import type { ContentStore, Stored } from '../content/services.js';
import { photoQuery, photoRow, searchRows, type PhotoFilter, type PhotoRow, type PhotoSearch } from './model.js';
import { INITIAL_LIST, type PhotosListState } from './state.js';

export interface PhotoListDeps {
    readonly store: ContentStore;
    readonly clock: Clock;
    readonly cityId: string;
    /** The photos whose place is still to be checked (`PhotoMemory.checkPlace`). */
    readonly checkPlace: () => ReadonlySet<string>;
    /** M13: an uploader's uid: the rules let them read their own photos only. */
    readonly ownerOnly?: () => string | null;
    readonly changed: (state: PhotosListState) => void;
    /** A refused read: the shell asks who this is again. */
    readonly denied: () => void;
}

export class PhotoList {
    readonly #deps: PhotoListDeps;
    readonly #live: LiveList<PhotoDoc, Stored<PhotoDoc>>;
    #state: PhotosListState = INITIAL_LIST;
    #docs: readonly Stored<PhotoDoc>[] = [];

    constructor(deps: PhotoListDeps) {
        this.#deps = deps;
        this.#live = new LiveList({
            store: deps.store,
            clock: deps.clock,
            collection: FIRESTORE_PATHS.photos(deps.cityId),
            schema: photoDocSchema,
            map: (stored) => stored,
            changed: (list) => {
                this.#loaded(list);
            },
            denied: deps.denied,
        });
    }

    get state(): PhotosListState {
        return this.#state;
    }

    /** The loaded photos, as stored. */
    get docs(): readonly Stored<PhotoDoc>[] {
        return this.#docs;
    }

    doc(photoId: string): Stored<PhotoDoc> | undefined {
        return this.#docs.find((stored) => stored.id === photoId);
    }

    /** The page shows: listen (once). */
    open(): void {
        if (!this.#live.active) {
            this.#live.show(photoQuery(this.#state.filter, this.#deps.ownerOnly?.() ?? null));
        }
    }

    /** The page is gone: stop listening (the rows stay for the next visit's first paint). */
    close(): void {
        this.#live.stop();
    }

    setFilter(filter: PhotoFilter): void {
        if (filter !== this.#state.filter) {
            this.#set({ filter, selection: [] });
            this.#live.show(photoQuery(filter, this.#deps.ownerOnly?.() ?? null));
        }
    }

    /** One more page of photos. */
    more(): void {
        this.#live.more();
    }

    /** After an error: listen again. */
    retry(): void {
        this.#live.retry();
    }

    setSearch(search: PhotoSearch): void {
        this.#set({ search });
    }

    /** The rows again (a photo's place was checked). */
    refresh(): void {
        this.#set({});
    }

    select(selection: readonly string[]): void {
        this.#set({ selection: [...new Set(selection)] });
    }

    toggle(photoId: string): void {
        const selection = this.#state.selection;
        this.select(selection.includes(photoId) ? selection.filter((id) => id !== photoId) : [...selection, photoId]);
    }

    /** Every photo the search shows. */
    selectAll(): void {
        this.select(this.#state.rows.map((row) => row.id));
    }

    /** The selected photos that are loaded, as stored. */
    selected(): readonly Stored<PhotoDoc>[] {
        const ids = new Set(this.#state.selection);
        return this.#docs.filter((stored) => ids.has(stored.id));
    }

    #loaded(list: ListState<Stored<PhotoDoc>>): void {
        this.#docs = list.items;
        const loaded = new Set(list.items.map((stored) => stored.id));
        this.#set({
            ...{ status: list.status, reconnecting: list.reconnecting, failure: list.failure, hasMore: list.hasMore },
            selection: this.#state.selection.filter((id) => loaded.has(id)),
        });
    }

    #rows(search: PhotoSearch): readonly PhotoRow[] {
        const check = this.#deps.checkPlace();
        return searchRows(
            this.#docs.map((stored) => photoRow(stored, check.has(stored.id))),
            search,
        );
    }

    #set(patch: Partial<PhotosListState>): void {
        const next = { ...this.#state, ...patch };
        this.#state = { ...next, rows: this.#rows(next.search), loaded: this.#docs.length };
        this.#deps.changed(this.#state);
    }
}
