/**
 * The scene list keeps its order while it is in use (the owner, 2026-11-25; DECISIONS-for-review.md §251): each preview copy
 * measures a frame's clouds and the server ranks it again, so the open list would move under a pointer or the keyboard
 * (a press then acted on the row that took the place, or the Tab round met a moved row twice: lessons 812, 818). While the
 * pointer or the focus is inside the list, its rows stay where they were (a new row joins at the end, a gone one leaves);
 * once both have left, the new ranking shows, and when it moved anything a note says so, seen and announced politely.
 */
import type { UiLocale } from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

import { contentText } from '../shell/text.js';

interface Identified {
    readonly id: string;
}

function sameOrder(left: readonly string[], right: readonly string[]): boolean {
    return left.length === right.length && left.every((id, index) => id === right[index]);
}

/** `scenes` in the order of `shown` where they were shown, the others after them in their own order. */
function inShownOrder<T extends Identified>(shown: readonly string[], scenes: readonly T[]): T[] {
    const byId = new Map(scenes.map((scene) => [scene.id, scene]));
    const kept = shown.flatMap((id) => byId.get(id) ?? []);
    const known = new Set(shown);
    return [...kept, ...scenes.filter((scene) => !known.has(scene.id))];
}

export class SceneOrderHold {
    #pointer = false;
    #focus = false;
    #shown: readonly string[] = [];
    /** The ranking changed while the list was held: the order to apply is waiting for the pointer and the focus to leave. */
    #waiting = false;
    #resorted = false;

    /** `update`: renders the page again (the held order is let go). */
    constructor(private readonly update: () => void) {}

    /** The scenes in the order the list shows them now. */
    order<T extends Identified>(scenes: readonly T[]): readonly T[] {
        const ids = scenes.map((scene) => scene.id);
        if (this.#pointer || this.#focus) {
            const held = inShownOrder(this.#shown, scenes);
            this.#shown = held.map((scene) => scene.id);
            this.#waiting ||= !sameOrder(this.#shown, ids);
            return held;
        }
        if (this.#waiting) {
            this.#resorted = !sameOrder(this.#shown, ids);
            this.#waiting = false;
        }
        this.#shown = ids;
        return scenes;
    }

    /** The note after a re-sort the list waited for: a status line, empty otherwise (so the region is there before its text). */
    note(locale: UiLocale): TemplateResult {
        const text = this.#resorted ? contentText(locale, 'adminContent.imagery.resorted') : '';
        return html`<p class="note resorted" role="status">${text}</p>`;
    }

    readonly onPointerEnter = (): void => {
        this.#pointer = true;
        this.#quiet();
    };

    readonly onPointerLeave = (): void => {
        this.#pointer = false;
        this.#release();
    };

    readonly onFocusIn = (): void => {
        this.#focus = true;
        this.#quiet();
    };

    readonly onFocusOut = (event: FocusEvent): void => {
        const list = event.currentTarget;
        if (list instanceof Node && event.relatedTarget instanceof Node && list.contains(event.relatedTarget)) {
            return;
        }
        this.#focus = false;
        this.#release();
    };

    /** A new use of the list: the last note has been read. */
    #quiet(): void {
        if (this.#resorted) {
            this.#resorted = false;
            this.update();
        }
    }

    #release(): void {
        if (!this.#pointer && !this.#focus && this.#waiting) {
            this.update();
        }
    }
}
