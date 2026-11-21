/**
 * The shapes every editor area's port shares (`docs/research/M2c-interfaces.md` §2.3), mirroring
 * `packages/admin/src/content/{list,doc}.ts` and `areas.ts`: a live list, a live document, a store as a page uses it. An
 * area's port file imports them from here, never from `content-port.ts`, which imports every area's port (an import
 * the other way round would be a cycle: dependency-cruiser `no-circular`).
 */
export type LoadStatusPort = 'loading' | 'ready' | 'error';

/** Why a listener stopped: refused (`denied`), offline (`unavailable`, it reconnects by itself), or another failure. */
export interface StoreFailurePort {
    readonly kind: 'denied' | 'unavailable' | 'failed';
    readonly code: string;
}

/** A document as read (`version` is its `updatedAt`, `pending` an unacknowledged local write). */
export interface StoredPort<T> {
    readonly id: string;
    readonly path: string;
    readonly data: T;
    readonly version: string;
    readonly pending: boolean;
}

/** A live list: loading, its items, an error, "Reconnecting…", More. */
export interface ListStatePort<Item> {
    readonly status: LoadStatusPort;
    readonly items: readonly Item[];
    readonly hasMore: boolean;
    readonly reconnecting: boolean;
    readonly failure: StoreFailurePort | null;
}

/** A live document (`doc` null once read: not found, or deleted while open). */
export interface DocStatePort<T> {
    readonly status: LoadStatusPort;
    readonly doc: StoredPort<T> | null;
    readonly reconnecting: boolean;
    readonly failure: StoreFailurePort | null;
}

/** One area's store as its page uses it. */
export interface AreaPort<State, Intents> {
    readonly state: State;
    subscribe(listener: (state: State) => void): () => void;
    readonly intents: Intents;
    /** The page shows with these route params (`#/jobs/<id>`: `[id]`). */
    open(params: readonly string[]): void;
    /** The page is gone. */
    close(): void;
}
