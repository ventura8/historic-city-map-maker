/**
 * The timeline's year changes, settled (the owner's request of 2026-11-13, `docs/ARCHITECTURE.md` → *Wizard funnels*):
 * a drag along the timeline or a held arrow key changes the year many times a second, and only where the visitor stops
 * is worth a `year_change` event. The last change waits {@link YEAR_SETTLE_MS}; a newer one replaces it; the page's
 * hiding sends it at once.
 */

/** How long a year must stay before its `year_change` leaves. */
export const YEAR_SETTLE_MS = 1500;

export class Settle<T> {
    readonly #send: (value: T) => void;
    readonly #ms: number;
    #held: { readonly value: T } | null = null;
    #timer: ReturnType<typeof setTimeout> | null = null;

    constructor(send: (value: T) => void, ms: number) {
        this.#send = send;
        this.#ms = ms;
    }

    /** Holds `value` in place of the one held; it leaves once nothing newer came for the wait. */
    hold(value: T): void {
        this.#held = { value };
        this.#stopTimer();
        this.#timer = setTimeout(() => {
            this.flush();
        }, this.#ms);
    }

    /** Sends the value held now (the page is being hidden or left). */
    flush(): void {
        this.#stopTimer();
        const held = this.#held;
        this.#held = null;
        if (held !== null) {
            this.#send(held.value);
        }
    }

    /** Forgets the value held. */
    cancel(): void {
        this.#stopTimer();
        this.#held = null;
    }

    #stopTimer(): void {
        if (this.#timer !== null) {
            clearTimeout(this.#timer);
            this.#timer = null;
        }
    }
}
