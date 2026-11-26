/**
 * One live document as a page shows it (`docs/research/M2c-interfaces.md` §1.4): loading, the document (null: not
 * found or deleted), an error with Try again, and "Reconnecting…" while its listener waits to attach again.
 */
import type { Schema } from '@hcm/shared';

import type { Clock, Unsubscribe } from '../app/ports.js';
import type { LoadStatus } from './list.js';
import { LiveListener, type LiveStatus } from './live.js';
import type { ContentStore, Stored, StoreFailure } from './services.js';

export interface DocState<T> {
    readonly status: LoadStatus;
    /** Null once read: the document does not exist (not found, or deleted while open). */
    readonly doc: Stored<T> | null;
    readonly reconnecting: boolean;
    readonly failure: StoreFailure | null;
}

export const LOADING_DOC: DocState<never> = { status: 'loading', doc: null, reconnecting: false, failure: null };

export interface LiveDocDeps<T> {
    readonly store: ContentStore;
    readonly clock: Clock;
    readonly schema: Schema<T>;
    readonly changed: (state: DocState<T>) => void;
    readonly denied: () => void;
}

export class LiveDoc<T> {
    readonly #deps: LiveDocDeps<T>;
    readonly #listener: LiveListener;
    #path = '';
    #state: DocState<T> = LOADING_DOC;

    constructor(deps: LiveDocDeps<T>) {
        this.#deps = deps;
        this.#listener = new LiveListener({
            clock: deps.clock,
            attach: (failed) => this.#attach(failed),
            status: (status) => {
                this.#failed(status);
            },
        });
    }

    get state(): DocState<T> {
        return this.#state;
    }

    get path(): string {
        return this.#path;
    }

    /** Watches the document at `path` (a new path starts from loading). */
    show(path: string): void {
        this.#path = path;
        this.#set(LOADING_DOC);
        this.#listener.start();
    }

    retry(): void {
        this.#set({ ...this.#state, status: 'loading', failure: null });
        this.#listener.start();
    }

    stop(): void {
        this.#listener.stop();
        this.#path = '';
    }

    #attach(failed: (failure: StoreFailure) => void): Unsubscribe {
        return this.#deps.store.watchDoc(
            this.#path,
            this.#deps.schema,
            (doc) => {
                this.#listener.answered();
                this.#set({ status: 'ready', doc, reconnecting: false, failure: null });
            },
            failed,
        );
    }

    #failed(status: LiveStatus): void {
        if (status.failure?.kind === 'denied') {
            this.#deps.denied();
        }
        const state = this.#state;
        this.#set(
            status.retrying
                ? { ...state, reconnecting: true, failure: status.failure }
                : { ...state, status: 'error', failure: status.failure },
        );
    }

    #set(state: DocState<T>): void {
        this.#state = state;
        this.#deps.changed(state);
    }
}
