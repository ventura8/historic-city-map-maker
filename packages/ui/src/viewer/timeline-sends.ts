/**
 * When `<hcm-timeline>` sends `hcm-year-change` (the owner, 2026-11-13): a key's year at once; during a press (a mouse's
 * drag, a finger's scrub) its first new year at once, then at most one per animation frame, the latest, so a fast scrub
 * selects live without queueing map work, and the press's end sends what is left. The store writes the hash with
 * `replaceState`, so the scrub leaves no history entry per year. The year sent is the one selected, kept here: the
 * viewer renders the timeline with the store's year meanwhile, one behind (lesson 641).
 */
export class YearSends {
    readonly #send: (year: number | null) => void;
    /** The frame that sends the year selected since the last one sent, or null. */
    #frame: number | null = null;
    /** A press selected a year that was not sent yet. */
    #unsent = false;
    /** The last year selected. */
    #year: number | null = null;
    /** A press changed the year since it began. */
    #moved = false;

    constructor(send: (year: number | null) => void) {
        this.#send = send;
    }

    /** The timeline's year changed to `year`, by a key or (`live`) by a press. */
    changed(year: number | null, live: boolean): void {
        this.#year = year;
        this.#moved ||= live;
        if (live && this.#frame !== null) {
            this.#unsent = true;
            return;
        }
        this.#send(year);
        if (live) {
            this.#frame = requestAnimationFrame(() => {
                this.#frame = null;
                this.#flush();
            });
        }
    }

    /** A press ended: sends what is left; true when it changed the year (the timeline then says it). */
    settle(): boolean {
        if (this.#frame !== null) {
            cancelAnimationFrame(this.#frame);
            this.#frame = null;
        }
        this.#flush();
        const moved = this.#moved;
        this.#moved = false;
        return moved;
    }

    /** A removed timeline sends nothing more. */
    drop(): void {
        this.#unsent = false;
        this.#moved = false;
    }

    #flush(): void {
        if (this.#unsent) {
            this.#unsent = false;
            this.#send(this.#year);
        }
    }
}
