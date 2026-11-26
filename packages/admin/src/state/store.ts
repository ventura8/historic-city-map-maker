/**
 * The admin's state container: the current state, replaced (never mutated) by `update`, and its listeners. A listener
 * that throws is logged and the others still run.
 */
import type { Logger } from '@hcm/shared';

import type { Unsubscribe } from '../app/ports.js';

export class Store<State extends object> {
    readonly #log: Logger;
    readonly #listeners = new Set<(state: State) => void>();
    #state: State;

    constructor(initial: State, log: Logger) {
        this.#state = initial;
        this.#log = log;
    }

    get state(): State {
        return this.#state;
    }

    /** Merges `patch` into a new state and tells every listener, unless nothing changed. */
    update(patch: Partial<State>): void {
        const keys = Object.keys(patch) as (keyof State)[];
        if (keys.every((key) => Object.is(this.#state[key], patch[key]))) {
            return;
        }
        this.#state = { ...this.#state, ...patch };
        for (const listener of [...this.#listeners]) {
            this.#notify(listener);
        }
    }

    subscribe(listener: (state: State) => void): Unsubscribe {
        this.#listeners.add(listener);
        return () => {
            this.#listeners.delete(listener);
        };
    }

    #notify(listener: (state: State) => void): void {
        try {
            listener(this.#state);
        } catch (error) {
            this.#log.error('state listener failed', { error: String(error) });
        }
    }
}
