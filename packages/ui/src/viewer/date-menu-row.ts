/**
 * One row of `<hcm-date-menu>` (the owner, 2026-11-24): a checkbox that shows or hides that layer on the map right in the
 * panel (`hcm-date-show`, `{layerId, visible}`: the store's `toggleOverlay`, the Layers panel's state, so the two and the URL's
 * `layers=` stay in sync), and the date itself, a `menuitemcheckbox` too (both are the menu's items: a menu owns no plain checkbox) that picks it and brings it to the front
 * (`hcm-date-pick`). The layer on top is always on: its checkbox is checked and cannot be cleared there; picking a hidden
 * date shows it. The checkbox's target is the kit's 48 px ring; Tab reaches it, Space toggles it, Enter on the date picks.
 */
import { css, html, type TemplateResult } from 'lit';

import type { DateItem } from './timeline-dates.js';

/** What a row needs from its menu. */
export interface DateRowView {
    readonly selected: string | null;
    readonly shown: ReadonlySet<string>;
    /** The checkbox's accessible name for a layer's name (`timeline.showOnMap`). */
    readonly showLabel: (name: string) => string;
}

/** The checkbox's name: the layer's label and its date (two scans of one year may share a label). */
function rowName(item: DateItem): string {
    return item.label === '' ? item.date : `${item.label}, ${item.date}`;
}

function send(target: EventTarget, type: string, detail: object): void {
    target.dispatchEvent(new CustomEvent(type, { bubbles: true, composed: false, detail }));
}

/** The date's row: the checkbox, then the date that picks. */
export function dateRow(host: EventTarget, item: DateItem, view: DateRowView): TemplateResult {
    const front = item.id === view.selected;
    const visible = view.shown.has(item.id);
    const pick = (): void => {
        send(host, 'hcm-date-pick', { layerId: item.id });
    };
    const on = visible || front;
    const toggle = (): void => {
        send(host, 'hcm-date-show', { layerId: item.id, visible: !on });
    };
    return html`<div class="row" role="none" data-row=${item.id}>
        <span class="check">
            <button
                type="button"
                class="box touch-target"
                role="menuitemcheckbox"
                data-show=${item.id}
                aria-label=${view.showLabel(rowName(item))}
                aria-checked=${String(on)}
                ?disabled=${front && visible}
                @click=${toggle}
            >
                <hcm-icon name="check" aria-hidden="true"></hcm-icon>
            </button>
        </span>
        <button
            type="button"
            class="item"
            role="menuitemcheckbox"
            aria-checked=${String(on)}
            ?data-front=${front}
            data-item=${item.id}
            @click=${pick}
        >
            <span class="text"><span class="date">${item.date}</span><span class="label">${item.label}</span></span>
        </button>
    </div>`;
}

/** The focusable parts of a row: its checkbox (unless the front's, which is fixed) and its date. */
function rowParts(row: Element): HTMLElement[] {
    return [...row.querySelectorAll<HTMLElement>('.box:not(:disabled), .item')];
}

/** The arrows that cross a row. */
const SIDEWAYS: ReadonlySet<string> = new Set(['ArrowLeft', 'ArrowRight']);

function rowOf(active: Element | null): Element | null {
    return active === null ? null : active.closest('.row');
}

/** The row of the focused part among the dates (`items`), -1 for none. */
export function rowIndex(items: readonly HTMLElement[], active: Element | null): number {
    const row = rowOf(active);
    return items.findIndex((item) => item.parentElement === row);
}

/** Left and right (a TV's D-pad too) move between the focused row's checkbox and its date; true when they did. */
export function across(event: KeyboardEvent, active: Element | null): boolean {
    const row = rowOf(active);
    if (row === null || !SIDEWAYS.has(event.key)) {
        return false;
    }
    event.preventDefault();
    const parts = rowParts(row);
    parts[(parts.indexOf(active as HTMLElement) + 1) % parts.length]?.focus();
    return true;
}

/** The rows' styles: a 48 px checkbox box beside a 48 px tall date. */
export const dateRowStyles = css`
    /* The checkbox's column is 40 px and its 48 px ring reaches 4 px into the date: a narrow phone keeps the dates' width. */
    .row {
        display: flex;
        flex: none;
        align-items: stretch;
        padding-inline-start: 4px;
    }

    .check {
        display: grid;
        flex: none;
        place-items: center;
        inline-size: 40px;
        min-block-size: 48px;
    }

    /* M3's checkbox: an 18 px box with a 2 px on-surface-variant edge (3:1 on the menu), filled with primary and its tick when
       on; the kit's 48 px touch target around it. */
    .box {
        position: relative;
        display: grid;
        place-items: center;
        box-sizing: border-box;
        inline-size: 18px;
        block-size: 18px;
        padding: 0;
        border: 2px solid var(--md-sys-color-on-surface-variant);
        border-radius: 2px;
        background: transparent;
        color: var(--md-sys-color-on-primary);
        cursor: pointer;
    }

    .box[aria-checked='true'] {
        border-color: var(--md-sys-color-primary);
        background: var(--md-sys-color-primary);
    }

    .box hcm-icon {
        --hcm-icon-size: 14px;
    }

    .box[aria-checked='false'] hcm-icon {
        visibility: hidden;
    }

    .box:disabled {
        opacity: 0.38;
        cursor: default;
    }

    .box:focus-visible {
        outline: 2px solid var(--md-sys-color-secondary);
        outline-offset: 4px;
    }

    @media (forced-colors: active) {
        .box {
            border-color: CanvasText;
        }

        .box[aria-checked='true'] {
            background: Highlight;
        }

        .box hcm-icon {
            color: HighlightText;
        }
    }
`;
