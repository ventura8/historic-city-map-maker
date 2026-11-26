/**
 * The georeferencer's Undo: the pairs as they were before each edit since the page opened (or the last Discard), newest last.
 * It keeps at most `UNDO_DEPTH` steps; taking back past the oldest does nothing.
 */
import type { Gcp } from '@hcm/shared';

/** How many edits Undo can take back. */
const UNDO_DEPTH = 50;

export class PairHistory {
    #steps: (readonly Gcp[])[] = [];

    /** True when Undo has a step to take back. */
    get canUndo(): boolean {
        return this.#steps.length > 0;
    }

    /** Remembers the pairs an edit is about to replace (`remember` false: Undo's own edit, not remembered). */
    note(pairs: readonly Gcp[], remember: boolean): void {
        this.#steps = remember ? [...this.#steps, pairs].slice(-UNDO_DEPTH) : this.#steps;
    }

    /** The pairs before the last edit, forgotten here (null: nothing to take back). */
    pop(): readonly Gcp[] | null {
        const previous = this.#steps.at(-1) ?? null;
        this.#steps = this.#steps.slice(0, -1);
        return previous;
    }

    clear(): void {
        this.#steps = [];
    }
}
