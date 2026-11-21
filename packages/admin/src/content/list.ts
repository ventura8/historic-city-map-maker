/**
 * A live list's state as every area's page shows it (`docs/research/M2c-interfaces.md` §1.4): loading, the items, an
 * error with Try again, "Reconnecting…" while the listener waits or reads from the cache, and More while the last answer
 * filled its limit. `LiveList` keeps one such list in step with a `ContentStore` query.
 */
import { timestampToDate, type Schema, type TimestampLike } from '@hcm/shared';

import type { Clock, Unsubscribe } from '../app/ports.js';
import { LiveListener, type LiveStatus } from './live.js';
import { PAGE_SIZE, type ContentQuery, type ContentStore, type Stored, type StoredPage, type StoreFailure } from './services.js';

export type LoadStatus = 'loading' | 'ready' | 'error';

export interface ListState<Item> {
    readonly status: LoadStatus;
    readonly items: readonly Item[];
    readonly hasMore: boolean;
    /** The listener lost the server (it waits to attach again, or answers from the cache): "Reconnecting…". */
    readonly reconnecting: boolean;
    /** Why the list stopped (`status: 'error'`), or the failure it is recovering from. */
    readonly failure: StoreFailure | null;
}

export const LOADING_LIST: ListState<never> = { status: 'loading', items: [], hasMore: false, reconnecting: false, failure: null };

/** A Firestore timestamp as an ISO string (what the pages format with `Intl`). */
export function isoOf(timestamp: TimestampLike): string {
    return timestampToDate(timestamp).toISOString();
}

/** The list after an answer: its items mapped, More when the limit was reached. */
function listFromPage<Doc, Item>(page: StoredPage<Doc>, map: (doc: Stored<Doc>) => Item): ListState<Item> {
    return { status: 'ready', items: page.docs.map(map), hasMore: page.hasMore, reconnecting: page.fromCache, failure: null };
}

/** The list after a listener's failure: kept while it reconnects, an error otherwise. */
export function listAfterFailure<Item>(list: ListState<Item>, status: LiveStatus): ListState<Item> {
    if (status.retrying) {
        return { ...list, reconnecting: true, failure: status.failure };
    }
    return { ...list, status: 'error', reconnecting: false, failure: status.failure };
}

export interface LiveListDeps<Doc, Item> {
    readonly store: ContentStore;
    readonly clock: Clock;
    /** The collection `show` reads (`showIn` names another: a job's log lines). */
    readonly collection: string;
    /** Documents per page (`PAGE_SIZE` when absent). */
    readonly pageSize?: number;
    readonly schema: Schema<Doc>;
    readonly map: (doc: Stored<Doc>) => Item;
    /** Every new state of the list. */
    readonly changed: (list: ListState<Item>) => void;
    /** A `denied` failure: the shell asks who this is again. */
    readonly denied: () => void;
}

/** One live query: `show(query)` (re)attaches it, `more()` asks for one page more, `stop()` detaches it. */
export class LiveList<Doc, Item> {
    readonly #deps: LiveListDeps<Doc, Item>;
    readonly #listener: LiveListener;
    readonly #pageSize: number;
    #collection: string;
    #query: ContentQuery = {};
    #limit: number;
    #list: ListState<Item> = LOADING_LIST;

    constructor(deps: LiveListDeps<Doc, Item>) {
        this.#deps = deps;
        this.#pageSize = deps.pageSize ?? PAGE_SIZE;
        this.#limit = this.#pageSize;
        this.#collection = deps.collection;
        this.#listener = new LiveListener({
            clock: deps.clock,
            attach: (failed) => this.#attach(failed),
            status: (status) => {
                this.#failed(status);
            },
        });
    }

    get list(): ListState<Item> {
        return this.#list;
    }

    get active(): boolean {
        return this.#listener.active;
    }

    /** Shows the first page of `query` (a new filter starts from one page again; the items stay until it answers). */
    show(query: ContentQuery): void {
        this.#query = query;
        this.#limit = this.#pageSize;
        this.#set({ ...LOADING_LIST, items: this.#list.items });
        this.#listener.start();
    }

    /** Shows the first page of `query` over another collection (its items start empty). */
    showIn(collection: string, query: ContentQuery): void {
        this.#collection = collection;
        this.#list = LOADING_LIST;
        this.show(query);
    }

    /** One page more of the same query. */
    more(): void {
        this.#limit += this.#pageSize;
        this.#listener.start();
    }

    /** Try again after an error. */
    retry(): void {
        this.#set({ ...this.#list, status: 'loading', failure: null });
        this.#listener.start();
    }

    stop(): void {
        this.#listener.stop();
    }

    #attach(failed: (failure: StoreFailure) => void): Unsubscribe {
        const { store, schema } = this.#deps;
        return store.watchQuery(
            this.#collection,
            schema,
            { ...this.#query, limit: this.#limit },
            (page) => {
                this.#listener.answered();
                this.#set(listFromPage(page, this.#deps.map));
            },
            failed,
        );
    }

    #failed(status: LiveStatus): void {
        if (status.failure?.kind === 'denied') {
            this.#deps.denied();
        }
        this.#set(listAfterFailure(this.#list, status));
    }

    #set(list: ListState<Item>): void {
        this.#list = list;
        this.#deps.changed(list);
    }
}
