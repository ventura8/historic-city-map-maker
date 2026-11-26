/**
 * A typed listener list: the store, the map adapter and telemetry each keep their subscribers in one. A listener that
 * throws is reported to `onError` and never stops the others (one broken subscriber must not freeze the viewer).
 */
import type { Unsubscribe } from './map-port.js';

export class Listeners<T extends readonly unknown[]> {
    readonly #listeners = new Set<(...args: T) => void>();
    readonly #onError: (error: unknown) => void;

    constructor(onError: (error: unknown) => void) {
        this.#onError = onError;
    }

    get size(): number {
        return this.#listeners.size;
    }

    add(listener: (...args: T) => void): Unsubscribe {
        const entry = (...args: T): void => {
            listener(...args);
        };
        this.#listeners.add(entry);
        return () => {
            this.#listeners.delete(entry);
        };
    }

    emit(...args: T): void {
        for (const listener of [...this.#listeners]) {
            try {
                listener(...args);
            } catch (error) {
                this.#onError(error);
            }
        }
    }

    clear(): void {
        this.#listeners.clear();
    }
}

/** One `Listeners` per event name of `Events`. */
export class EventListeners<Events extends object> {
    readonly #lists = new Map<keyof Events, Listeners<[unknown]>>();
    readonly #onError: (error: unknown) => void;

    constructor(onError: (error: unknown) => void) {
        this.#onError = onError;
    }

    on<E extends keyof Events>(event: E, listener: (payload: Events[E]) => void): Unsubscribe {
        let list = this.#lists.get(event);
        if (list === undefined) {
            list = new Listeners<[unknown]>(this.#onError);
            this.#lists.set(event, list);
        }
        return list.add(listener as (payload: unknown) => void);
    }

    emit<E extends keyof Events>(event: E, payload: Events[E]): void {
        this.#lists.get(event)?.emit(payload);
    }

    clear(): void {
        this.#lists.clear();
    }
}
