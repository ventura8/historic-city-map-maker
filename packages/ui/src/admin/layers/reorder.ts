/**
 * A list whose order the admin changes (`docs/research/M2c-interfaces.md` §8.1, §8.5): the historical layers top first,
 * the POI categories in the viewer's order. Each row is a link to its editor, a drag handle (a pointer drags the row to
 * its new place) and **Move up** / **Move down**, the keyboard's and a single pointer's way to the same result (WCAG
 * 2.1.1, 2.5.7). The handle is pointer-only and hidden from assistive technology; the buttons are not. Rows are keyed,
 * so a moved row keeps its elements and the focused Move button moves with it; the buttons are never disabled (a disabled
 * focused button drops the focus to the page): at either end, or while a reorder is written, a move does nothing.
 */
import { html, nothing, type TemplateResult } from 'lit';
import { repeat } from 'lit/directives/repeat.js';

import { current } from '../editing/states.js';

export interface ReorderRow {
    readonly id: string;
    readonly title: string;
    readonly detail: string;
    readonly href: string;
    readonly selected: boolean;
    /** Shown before the title (a category's icon on its colour). */
    readonly lead?: TemplateResult;
}

export interface ReorderLabels {
    readonly up: (title: string) => string;
    readonly down: (title: string) => string;
    /** What the list is, for its accessible name. */
    readonly list: string;
}

export interface ReorderHandlers {
    readonly move: (id: string, direction: 'up' | 'down') => void;
    /**
     * A revoked admin's read-only page (`DECISIONS-for-review.md` §42d): the rows are links only, without the drag handle
     * and the Move buttons (no order can be written).
     */
    readonly readOnly?: boolean;
}

/**
 * One drag of a row by its handle: the pointer is captured, the row the drop would land before is marked, and the drop
 * moves the row there (its index in the list without it, as `moveTo` takes it). Esc or a lost pointer cancels it.
 */
export class RowDrag {
    readonly #drop: (id: string, index: number) => void;
    #id: string | null = null;
    #others: HTMLElement[] = [];
    #index = -1;

    constructor(drop: (id: string, index: number) => void) {
        this.#drop = drop;
    }

    readonly start = (event: PointerEvent, id: string): void => {
        const handle = event.currentTarget as HTMLElement;
        const list = handle.closest('[data-reorder-list]');
        const rows = [...(list?.querySelectorAll<HTMLElement>('[data-reorder-row]') ?? [])];
        this.#id = id;
        this.#others = rows.filter((row) => row.dataset['reorderRow'] !== id);
        rows.find((row) => row.dataset['reorderRow'] === id)?.toggleAttribute('data-dragging', true);
        handle.setPointerCapture(event.pointerId);
        event.preventDefault();
    };

    readonly move = (event: PointerEvent): void => {
        if (this.#id === null) {
            return;
        }
        this.#index = this.#others.filter((row) => {
            const box = row.getBoundingClientRect();
            return box.top + box.height / 2 < event.clientY;
        }).length;
        this.#others.forEach((row, index) => {
            row.toggleAttribute('data-drop', index === this.#index);
        });
    };

    readonly end = (event: PointerEvent): void => {
        const id = this.#id;
        const index = this.#index;
        this.cancel(event);
        if (id !== null && index >= 0) {
            this.#drop(id, index);
        }
    };

    readonly cancel = (event: Event): void => {
        const handle = event.currentTarget as HTMLElement | null;
        handle
            ?.closest('[data-reorder-list]')
            ?.querySelectorAll('[data-dragging], [data-drop]')
            .forEach((row) => {
                row.removeAttribute('data-dragging');
                row.removeAttribute('data-drop');
            });
        this.#id = null;
        this.#others = [];
        this.#index = -1;
    };
}

function link(item: ReorderRow): TemplateResult {
    return html`<a class="row" href=${item.href} aria-current=${current(item.selected)} ?data-lead=${item.lead !== undefined}>
        ${item.lead ?? nothing}<span class="row-title">${item.title}</span>
        <span class="row-detail">${item.detail}</span>
    </a>`;
}

function row(item: ReorderRow, context: { labels: ReorderLabels; handlers: ReorderHandlers; drag: RowDrag }): TemplateResult {
    const { labels, handlers, drag } = context;
    if (handlers.readOnly === true) {
        return html`<li class="reorder-row" data-reorder-row=${item.id} data-read-only>${link(item)}</li>`;
    }
    return html`<li class="reorder-row" data-reorder-row=${item.id}>
        <span
            class="handle"
            aria-hidden="true"
            @pointerdown=${(event: PointerEvent) => {
                drag.start(event, item.id);
            }}
            @pointermove=${drag.move}
            @pointerup=${drag.end}
            @pointercancel=${drag.cancel}
            ><hcm-icon name="drag_indicator"></hcm-icon
        ></span>
        ${link(item)}
        <span class="moves">
            <hcm-icon-button
                icon="arrow_upward"
                label=${labels.up(item.title)}
                @click=${() => {
                    handlers.move(item.id, 'up');
                }}
            ></hcm-icon-button>
            <hcm-icon-button
                icon="arrow_downward"
                label=${labels.down(item.title)}
                @click=${() => {
                    handlers.move(item.id, 'down');
                }}
            ></hcm-icon-button>
        </span>
    </li>`;
}

/** The rows, in order, keyed by id. */
export function reorderList(items: readonly ReorderRow[], labels: ReorderLabels, handlers: ReorderHandlers, drag: RowDrag): TemplateResult {
    const context = { labels, handlers, drag };
    return html`<ul class="rows" data-reorder-list aria-label=${labels.list}>
        ${repeat(
            items,
            (item) => item.id,
            (item) => row(item, context),
        )}
    </ul>`;
}
