/**
 * A Firestore listener that comes back by itself (`docs/research/M2c-interfaces.md` §1.4, §9.3): the SDK reconnects a
 * listener whose network dropped, but a listener that failed (the server refused it, the connection ended it) is gone.
 * `LiveListener` attaches it again after a growing pause while the failure is `unavailable`, and says so ("Reconnecting…");
 * a refusal (`denied`) or another failure stops it until Try again (`start`).
 */
import type { Clock, Unsubscribe } from '../app/ports.js';
import type { StoreFailure } from './services.js';

/** Pauses before the next attempt, in milliseconds; the last one repeats. */
export const RECONNECT_DELAYS_MS: readonly number[] = [1000, 2000, 5000, 10_000, 30_000];

/** How a listener stands: `retrying` while it waits to attach again. */
export interface LiveStatus {
    readonly failure: StoreFailure | null;
    readonly retrying: boolean;
}

export interface LiveListenerDeps {
    readonly clock: Clock;
    /** Attaches the listener; it reports its failure through `failed`. */
    readonly attach: (failed: (failure: StoreFailure) => void) => Unsubscribe;
    /** Every change of the status (a failure, a retry, attached again). */
    readonly status: (status: LiveStatus) => void;
}

export class LiveListener {
    readonly #deps: LiveListenerDeps;
    #detach: Unsubscribe | null = null;
    /** The current attachment: a failure of an older one is ignored. */
    #token: object | null = null;
    #timer: unknown = null;
    #attempt = 0;

    constructor(deps: LiveListenerDeps) {
        this.#deps = deps;
    }

    /** Attached, or waiting to attach again. */
    get active(): boolean {
        return this.#token !== null || this.#timer !== null;
    }

    /** Attaches the listener (again): the first time, after a refusal, or from Try again. */
    start(): void {
        this.stop();
        this.#attempt = 0;
        this.#attach();
    }

    /** The listener answered: the next failure starts again from the shortest pause. */
    answered(): void {
        this.#attempt = 0;
    }

    stop(): void {
        this.#token = null;
        this.#detach?.();
        this.#detach = null;
        if (this.#timer !== null) {
            this.#deps.clock.clearTimeout(this.#timer);
            this.#timer = null;
        }
    }

    #attach(): void {
        const token = {};
        this.#token = token;
        const detach = this.#deps.attach((failure) => {
            if (this.#token === token) {
                this.#token = null;
                this.#detach?.();
                this.#detach = null;
                this.#failed(failure);
            }
        });
        if (this.#token === token) {
            this.#detach = detach;
        } else {
            detach();
        }
    }

    #failed(failure: StoreFailure): void {
        const retrying = failure.kind === 'unavailable';
        this.#deps.status({ failure, retrying });
        if (retrying) {
            const delay = RECONNECT_DELAYS_MS[Math.min(this.#attempt, RECONNECT_DELAYS_MS.length - 1)] ?? 0;
            this.#attempt += 1;
            this.#timer = this.#deps.clock.setTimeout(() => {
                this.#timer = null;
                this.#attach();
            }, delay);
        }
    }
}
