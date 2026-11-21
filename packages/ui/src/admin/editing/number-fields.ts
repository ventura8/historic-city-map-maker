/**
 * Number fields of the editors (`DECISIONS-for-review.md` §35d, applied 2026-10-18): a number commits on every key, as
 * a text does, so a year typed and then a click on Save saves (a disabled Save takes no click, so a field that waited
 * for `change` was never left: `docs/LESSONS.md` 75), and the field says its problem only once it has been left, so
 * half a year ("19") does not flash an error under every key.
 *
 * - `numberValue(text)` binds an `<input>`'s `.value` and leaves what the admin typed alone while it is the same number
 *   (`44.40` stays as typed when the draft holds 44.4; `44.` or `-` stays while the number is not finished), and writes
 *   it when the draft's number changed otherwise (Discard, a pick on the map).
 * - `LeftFields` remembers the fields left since the item opened; an editor shows a number field's problem only for
 *   those (a Save that the draft's problems keep disabled says why once the field is left).
 */
import { noChange } from 'lit';
import { Directive, directive, PartType, type PartInfo, type PropertyPart } from 'lit/directive.js';

/** The number a field's text says, or undefined (empty, unfinished or not a number). */
export function typedNumber(text: string): number | undefined {
    const value = Number.parseFloat(text);
    return Number.isFinite(value) ? value : undefined;
}

class NumberValueDirective extends Directive {
    constructor(part: PartInfo) {
        super(part);
        if (part.type !== PartType.PROPERTY || part.name !== 'value') {
            throw new Error('numberValue() binds the .value of an input');
        }
    }

    render(text: string): string {
        return text;
    }

    override update(part: PropertyPart, [text]: [string]): typeof noChange {
        const input = part.element as HTMLInputElement;
        const wanted = this.render(text);
        if (typedNumber(input.value) !== typedNumber(wanted)) {
            input.value = wanted;
        }
        return noChange;
    }
}

/** An input's `.value` that keeps the admin's own spelling of the same number (see the module's comment). */
export const numberValue = directive(NumberValueDirective);

/** The fields an editor's template reads and reports as left. */
export interface FieldsLeft {
    has(field: string): boolean;
    leave(field: string): void;
}

/** The number fields left since the open item opened; `changed` re-renders the editor when one more is left. */
export class LeftFields implements FieldsLeft {
    readonly #left = new Set<string>();
    readonly #changed: () => void;
    #item: string | null = null;

    constructor(changed: () => void) {
        this.#changed = changed;
    }

    /** The fields left for `item`: another item starts with none. */
    forItem(item: string): this {
        if (item !== this.#item) {
            this.#item = item;
            this.#left.clear();
        }
        return this;
    }

    has(field: string): boolean {
        return this.#left.has(field);
    }

    leave(field: string): void {
        if (!this.#left.has(field)) {
            this.#left.add(field);
            this.#changed();
        }
    }
}
