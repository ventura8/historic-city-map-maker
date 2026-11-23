/**
 * `<hcm-date-menu>`: the date picker of a timeline year with several dates (V13, the owner 2026-11-13). An M3 menu beside
 * the badge or the slider that asked for it (`hcm-dates-open`, `timeline-dates.ts`): above a lying timeline, on the
 * trailing side of a standing one, kept inside the viewer and clear of the strip of Mapbox's legal line and of the floating
 * controls it is given (`avoid`, `date-menu-clear.ts`). Each date is a
 * `menuitemcheckbox` (48 px tall), every layer that is on ticked and the one on top in bold (2026-11-22). It is modal: a transparent scrim takes a press anywhere else and
 * closes it, the viewer makes the frame under it inert and gives the focus back to the slider. The arrow keys, Home and End
 * move between the dates, Tab walks them as any button, Esc closes, Enter or a press picks one.
 *
 * A peek (`peek`: a mouse or a scrubbing finger resting on the year, `timeline-peek.ts`) is not modal: no scrim, the focus
 * stays where it was, the frame stays live. The mouse entering or leaving it says so (`hcm-date-menu-pointer`), so the dock
 * keeps it open on the way from the year; a finger sliding over it marks the date under it (`touchAt`) and lifting picks it.
 *
 * With `side` (a menu of the selected year, a peek too) the year's opacity sliders, slotted, sit beside the dates in one row
 * (`.pair`, the owner 2026-11-23: never stacked, never over each other), placed as one box; on a narrow phone the two columns
 * share the width and their labels wrap instead of being cut. Tab goes from the dates to them, Esc in them closes.
 *
 * Events (viewer-internal): `hcm-date-pick` (`{layerId}`), `hcm-close`, `hcm-date-menu-pointer` (`{inside}`).
 */
import { LitElement, css, html, type PropertyValues, type TemplateResult } from 'lit';

import { EMPTY } from './empty.js';
import { clearOf } from './date-menu-clear.js';
import { dateMenuOrigin, MAX_WIDTH, PAIR_MAX_WIDTH, pairHeight, sideRoom, type Side } from './date-menu-place.js';
import { closeEvent } from './sheet-frame.js';
import { baseStyles } from './shared-styles.js';
import type { DateItem, DatesOpenDetail } from './timeline-dates.js';

export const HCM_DATE_MENU_TAG = 'hcm-date-menu';

/** The strip at the foot of the map kept for Mapbox's logo and attribution (`--hcm-map-chrome`). */
const LEGAL_STRIP = 42;

type Box = DatesOpenDetail['anchor'];

/** The properties that move or resize the menu or its sliders. */
const PLACING: readonly (keyof HcmDateMenu)[] = ['anchor', 'side', 'items', 'vertical'];

/** Whether the point (`x`, `y`) is in `rect`, its edges included. */
function contains(rect: DOMRect, x: number, y: number): boolean {
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

const NEXT: Readonly<Record<string, (index: number, count: number) => number>> = {
    ArrowDown: (index, count) => (index + 1) % count,
    ArrowUp: (index, count) => (index - 1 + count) % count,
    Home: () => 0,
    End: (_index, count) => count - 1,
};

export class HcmDateMenu extends LitElement {
    static override readonly properties = {
        items: { attribute: false },
        selected: { attribute: false },
        shown: { attribute: false },
        label: { type: String },
        anchor: { attribute: false },
        side: { type: Boolean },
        avoid: { attribute: false },
        vertical: { type: Boolean },
        peek: { type: Boolean },
    };

    static override readonly styles = [
        baseStyles,
        css`
            /* Over the whole viewer; only the scrim and the menu take the pointer, and only while open. */
            :host {
                position: absolute;
                inset: 0;
                z-index: 40;
                pointer-events: none;
            }

            .scrim {
                position: absolute;
                inset: 0;
                pointer-events: auto;
            }

            /* The dates and the sliders in one row, placed as one box: never stacked, never over each other. */
            .pair {
                position: absolute;
                display: flex;
                gap: 8px;
                align-items: flex-start;
                box-sizing: border-box;
                max-inline-size: calc(100% - 16px);
                max-block-size: calc(100% - 58px);
                pointer-events: none;
            }

            .menu {
                display: flex;
                flex: 0 1 auto;
                flex-direction: column;
                box-sizing: border-box;
                min-inline-size: 0;
                max-inline-size: 280px;
                max-block-size: inherit;
                padding-block: 8px;
                overflow: auto;
                border-radius: var(--md-sys-shape-corner-extra-small);
                background: var(--md-sys-color-surface-container);
                color: var(--md-sys-color-on-surface);
                box-shadow: var(--md-sys-elevation-level2);
                pointer-events: auto;
            }

            .side {
                display: flex;
                flex: 0 1 240px;
                flex-direction: column;
                box-sizing: border-box;
                min-inline-size: 0;
                max-block-size: inherit;
                padding: 8px 16px;
                overflow: auto;
                border-radius: var(--md-sys-shape-corner-large);
                background: var(--md-sys-color-surface-container);
                color: var(--md-sys-color-on-surface);
                box-shadow: var(--md-sys-elevation-level2);
                pointer-events: auto;
            }

            .item {
                display: flex;
                flex: none;
                gap: 12px;
                align-items: center;
                min-block-size: 48px;
                padding-inline: 12px 16px;
                border: 0;
                background: none;
                color: inherit;
                font: inherit;
                text-align: start;
                cursor: pointer;
            }

            .item:hover,
            .item:focus-visible,
            .item[data-armed] {
                background: color-mix(in srgb, var(--md-sys-color-on-surface) 8%, transparent);
                outline: 2px solid var(--md-sys-color-secondary);
                outline-offset: -2px;
            }

            .item hcm-icon {
                inline-size: 24px;
                color: var(--md-sys-color-primary);
            }

            .item[aria-checked='false'] hcm-icon {
                visibility: hidden;
            }

            .text {
                display: grid;
                min-inline-size: 0;
                overflow-wrap: anywhere;
            }

            .date {
                font-size: var(--md-sys-typescale-label-large-size);
                font-weight: 600;
            }

            .label {
                font-size: var(--md-sys-typescale-body-small-size);
                color: var(--md-sys-color-on-surface-variant);
            }

            /* The layer drawn on top among the ticked ones (the owner, 2026-11-22: a tick for every plan that is on). */
            .item[data-front] .label {
                font-weight: 700;
            }

            /* Forced colours drop the menu's fill and shadow: an edge keeps it apart from the map. */
            @media (forced-colors: active) {
                .menu,
                .side {
                    border: 1px solid CanvasText;
                }
            }
        `,
    ];

    declare items: readonly DateItem[];
    /** The layer on top: its date is checked. */
    declare selected: string | null;
    /** The year's layers that are on: each has its tick (the one on top, `selected`, is also marked). */
    declare shown: ReadonlySet<string>;
    declare label: string;
    /** The box (client px) the menu opens beside; null: closed. */
    declare anchor: Box | null;
    /** The floating controls (client px) the menu keeps clear of, measured each time it is placed (`timeline-dock.ts`). */
    declare avoid: () => readonly Box[];
    /** The timeline stands (a phone held upright): the menu opens on its trailing side, else above it. */
    declare vertical: boolean;
    /** Shown by a resting pointer, not by selecting the year: not modal. */
    declare peek: boolean;
    /** The year's opacity sliders are slotted: they show beside the dates, in the same row. */
    declare side: boolean;

    constructor() {
        super();
        this.items = [];
        this.selected = null;
        this.shown = new Set();
        this.label = '';
        this.anchor = null;
        this.avoid = () => [];
        this.vertical = false;
        this.peek = false;
        this.side = false;
    }

    override render(): TemplateResult {
        if (this.anchor === null) {
            return EMPTY;
        }
        return html`${this.#scrim()}
            <div class="pair" @pointerenter=${this.#onPointer} @pointerleave=${this.#onPointer}>
                <div class="menu" role="menu" aria-label=${this.label} data-layout-check="date-menu" @keydown=${this.#onKey}>
                    ${this.items.map((item) => this.#item(item))}
                </div>
                ${this.side ? html`<div class="side" @keydown=${this.#onSideKey}><slot></slot></div>` : EMPTY}
            </div>`;
    }

    /** Esc in the sliders closes the menu as in the dates. */
    readonly #onSideKey = (event: KeyboardEvent): void => {
        if (event.key === 'Escape') {
            event.preventDefault();
            this.#close();
        }
    };

    /** The modal menu's scrim, which takes a press anywhere else and closes it; a peek has none. */
    #scrim(): TemplateResult {
        return this.peek ? EMPTY : html`<div class="scrim" @pointerdown=${this.#close}></div>`;
    }

    /** Places the menu again when it or the viewer changes size (a window resized, larger text spacing). */
    readonly #resize = new ResizeObserver(() => {
        const pair = this.renderRoot.querySelector<HTMLElement>('.pair');
        if (pair !== null && this.anchor !== null) {
            this.#place(pair, this.anchor);
        }
    });

    override connectedCallback(): void {
        super.connectedCallback();
        this.#resize.observe(this);
    }

    override disconnectedCallback(): void {
        this.#resize.disconnect();
        super.disconnectedCallback();
    }

    protected override updated(changed: PropertyValues<this>): void {
        const pair = this.renderRoot.querySelector<HTMLElement>('.pair');
        if (pair === null || this.anchor === null) {
            return;
        }
        this.#resize.observe(pair);
        // Placed again on every change that moves or resizes it, not only a new anchor: a year's sliders slotted after the
        // anchor (side turned on, new items) kept their unplaced corner, over the dates, so only the opacity panel showed.
        if (PLACING.some((key) => changed.has(key))) {
            this.#place(pair, this.anchor);
        }
        if (changed.has('anchor')) {
            this.#focusChecked();
        }
    }

    /** A modal menu takes the focus to the checked date, else the first; a peek leaves it where it is. */
    #focusChecked(): void {
        if (!this.peek) {
            (this.#items().find((item) => item.hasAttribute('data-front')) ?? this.#items()[0])?.focus();
        }
    }

    /** The dates and the sliders as one box beside `at` (client px), inside the viewer, clear of the controls to avoid. */
    #place(pair: HTMLElement, at: Box): void {
        const host = this.getBoundingClientRect();
        const local = (box: Box): Box => ({ x: box.x - host.x, y: box.y - host.y, width: box.width, height: box.height });
        const anchor = local(at);
        const side = this.#side();
        const widest = this.side ? PAIR_MAX_WIDTH : MAX_WIDTH;
        pair.style.setProperty('max-inline-size', `${String(sideRoom(anchor, host.width, side, widest))}px`);
        pair.style.setProperty('max-block-size', `${String(pairHeight(anchor, host.height, side))}px`);
        const size = { width: pair.offsetWidth, height: pair.offsetHeight };
        const wanted = { ...dateMenuOrigin(anchor, size, host, side), ...size };
        const origin = clearOf(wanted, [anchor, ...this.avoid().map(local)], host, LEGAL_STRIP);
        pair.style.setProperty('left', `${String(origin.x)}px`);
        pair.style.setProperty('top', `${String(origin.y)}px`);
    }

    #side(): Side {
        if (!this.vertical) {
            return 'above';
        }
        return this.matches(':dir(rtl)') ? 'start' : 'end';
    }

    #item(item: DateItem): TemplateResult {
        const pick = (): void => {
            this.dispatchEvent(new CustomEvent('hcm-date-pick', { bubbles: true, composed: false, detail: { layerId: item.id } }));
        };
        return html`<button
            type="button"
            class="item"
            role="menuitemcheckbox"
            aria-checked=${String(this.shown.has(item.id) || item.id === this.selected)}
            ?data-front=${item.id === this.selected}
            data-item=${item.id}
            @click=${pick}
        >
            <hcm-icon name="check"></hcm-icon>
            <span class="text"><span class="date">${item.date}</span><span class="label">${item.label}</span></span>
        </button>`;
    }

    /**
     * A finger at (`x`, `y`) client px: over the menu it marks the date under it, and picks it when `lifted`; false when the
     * finger is not over the menu (no date marked then).
     */
    touchAt(x: number, y: number, lifted: boolean): boolean {
        const inside = (box: Element | null): boolean => box !== null && contains(box.getBoundingClientRect(), x, y);
        const over = inside(this.renderRoot.querySelector('.menu'));
        const item = over ? this.#items().find(inside) : undefined;
        for (const each of this.#items()) {
            each.toggleAttribute('data-armed', each === item);
        }
        if (lifted && item !== undefined) {
            item.click();
        }
        return over;
    }

    readonly #onPointer = (event: PointerEvent): void => {
        if (event.pointerType !== 'touch') {
            const detail = { inside: event.type === 'pointerenter' };
            this.dispatchEvent(new CustomEvent('hcm-date-menu-pointer', { bubbles: true, composed: false, detail }));
        }
    };

    #items(): HTMLElement[] {
        return [...this.renderRoot.querySelectorAll<HTMLElement>('.item')];
    }

    readonly #close = (): void => {
        this.dispatchEvent(closeEvent());
    };

    readonly #onKey = (event: KeyboardEvent): void => {
        if (event.key === 'Escape') {
            event.preventDefault();
            this.#close();
            return;
        }
        const next = NEXT[event.key];
        const items = this.#items();
        if (next !== undefined) {
            event.preventDefault();
            items[next(items.indexOf(this.shadowRoot?.activeElement as HTMLElement), items.length)]?.focus();
        }
    };
}

/** Registers `<hcm-date-menu>` once; calling it again is a no-op. */
export function defineHcmDateMenu(registry: CustomElementRegistry = customElements): void {
    if (registry.get(HCM_DATE_MENU_TAG) === undefined) {
        registry.define(HCM_DATE_MENU_TAG, HcmDateMenu);
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-date-menu': HcmDateMenu;
    }
}
