/**
 * `<hcm-date-menu>`: the date picker of a timeline year with several dates (V13, the owner 2026-11-13). An M3 menu beside
 * the badge or the slider that asked for it (`hcm-dates-open`, `timeline-dates.ts`): above a lying timeline, on the
 * trailing side of a standing one, kept inside the viewer and clear of the strip of Mapbox's legal line and of the floating
 * controls it is given (`avoid`, `date-menu-clear.ts`). Each date is a
 * `menuitemradio` (48 px tall), the one on top checked. It is modal: a transparent scrim takes a press anywhere else and
 * closes it, the viewer makes the frame under it inert and gives the focus back to the slider. The arrow keys, Home and End
 * move between the dates, Tab walks them as any button, Esc closes, Enter or a press picks one.
 *
 * A peek (`peek`: a mouse or a scrubbing finger resting on the year, `timeline-peek.ts`) is not modal: no scrim, the focus
 * stays where it was, the frame stays live. The mouse entering or leaving it says so (`hcm-date-menu-pointer`), so the dock
 * keeps it open on the way from the year; a finger sliding over it marks the date under it (`touchAt`) and lifting picks it.
 *
 * With `side` (a menu of the selected year, a peek too) the year's opacity sliders, slotted, sit beside the menu, centred on it,
 * or under it on a phone (`stacked`), placed by `date-menu-side.ts`; Tab goes from the dates to them, Esc in them closes.
 *
 * Events (viewer-internal): `hcm-date-pick` (`{layerId}`), `hcm-close`, `hcm-date-menu-pointer` (`{inside}`).
 */
import { LitElement, css, html, type PropertyValues, type TemplateResult } from 'lit';

import { EMPTY } from './empty.js';
import { clearOf } from './date-menu-clear.js';
import { placeSide } from './date-menu-side.js';
import { closeEvent } from './sheet-frame.js';
import { baseStyles } from './shared-styles.js';
import type { DateItem, DatesOpenDetail } from './timeline-dates.js';

export const HCM_DATE_MENU_TAG = 'hcm-date-menu';

/** Px kept from the viewer's edges, and from the anchor. */
const EDGE = 8;
/** The strip at the foot of the map kept for Mapbox's logo and attribution (`--hcm-map-chrome`). */
const LEGAL_STRIP = 42;
/** The menu's width limits (M3 menus: 112 to 280 px). */
const MIN_WIDTH = 112;
const MAX_WIDTH = 280;

type Box = DatesOpenDetail['anchor'];

/** The properties that move or resize the menu or its sliders. */
const PLACING: readonly (keyof HcmDateMenu)[] = ['anchor', 'side', 'stacked', 'items', 'vertical'];

/** The side of the timeline the menu opens on: above a lying one, past or before a standing one. */
type Side = 'above' | 'end' | 'start';

/** Where the menu's corner goes in the viewer (px from its top-left): beside the anchor, moved back inside when it would leave. */
export function dateMenuOrigin(
    anchor: Box,
    menu: { readonly width: number; readonly height: number },
    room: { readonly width: number; readonly height: number },
    side: Side,
): { readonly x: number; readonly y: number } {
    const centreX = anchor.x + anchor.width / 2 - menu.width / 2;
    const centreY = anchor.y + anchor.height / 2 - menu.height / 2;
    const wanted = {
        above: { x: centreX, y: anchor.y - EDGE - menu.height },
        end: { x: anchor.x + anchor.width + EDGE, y: centreY },
        start: { x: anchor.x - EDGE - menu.width, y: centreY },
    }[side];
    const within = (at: number, length: number, end: number): number => Math.max(EDGE, Math.min(at, end - length));
    return { x: within(wanted.x, menu.width, room.width - EDGE), y: within(wanted.y, menu.height, room.height - LEGAL_STRIP) };
}

/** Whether the point (`x`, `y`) is in `rect`, its edges included. */
function contains(rect: DOMRect, x: number, y: number): boolean {
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

/** The widest the menu may be (px) beside a standing timeline (the room past it), or above a lying one (the viewer). */
export function sideRoom(anchor: Box, width: number, side: Side): number {
    const room = { above: width, end: width - (anchor.x + anchor.width), start: anchor.x }[side] - 2 * EDGE;
    return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, room));
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
        label: { type: String },
        anchor: { attribute: false },
        side: { type: Boolean },
        stacked: { type: Boolean },
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

            .menu {
                position: absolute;
                display: flex;
                flex-direction: column;
                box-sizing: border-box;
                min-inline-size: 112px;
                max-inline-size: min(280px, calc(100% - 16px));
                max-block-size: calc(100% - 58px);
                padding-block: 8px;
                overflow: auto;
                border-radius: var(--md-sys-shape-corner-extra-small);
                background: var(--md-sys-color-surface-container);
                color: var(--md-sys-color-on-surface);
                box-shadow: var(--md-sys-elevation-level2);
                pointer-events: auto;
            }

            .side {
                position: absolute;
                display: flex;
                flex-direction: column;
                box-sizing: border-box;
                inline-size: 240px;
                padding: 8px 16px;
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
            }

            .date {
                font-size: var(--md-sys-typescale-label-large-size);
                font-weight: 600;
            }

            .label {
                font-size: var(--md-sys-typescale-body-small-size);
                color: var(--md-sys-color-on-surface-variant);
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
    declare label: string;
    /** The box (client px) the menu opens beside; null: closed. */
    declare anchor: Box | null;
    /** The floating controls (client px) the menu keeps clear of, measured each time it is placed (`timeline-dock.ts`). */
    declare avoid: () => readonly Box[];
    /** The timeline stands (a phone held upright): the menu opens on its trailing side, else above it. */
    declare vertical: boolean;
    /** Shown by a resting pointer, not by selecting the year: not modal. */
    declare peek: boolean;
    /** The year's opacity sliders are slotted: they show beside the menu (not on a peek). */
    declare side: boolean;
    /** On a phone: the sliders go under the menu, one sheet. */
    declare stacked: boolean;

    constructor() {
        super();
        this.items = [];
        this.selected = null;
        this.label = '';
        this.anchor = null;
        this.avoid = () => [];
        this.vertical = false;
        this.peek = false;
        this.side = false;
        this.stacked = false;
    }

    override render(): TemplateResult {
        if (this.anchor === null) {
            return EMPTY;
        }
        return html`${this.#scrim()}
            <div
                class="menu"
                role="menu"
                aria-label=${this.label}
                data-layout-check="date-menu"
                @keydown=${this.#onKey}
                @pointerenter=${this.#onPointer}
                @pointerleave=${this.#onPointer}
            >
                ${this.items.map((item) => this.#item(item))}
            </div>
            ${
                this.side
                    ? html`<div class="side" @keydown=${this.#onSideKey} @pointerenter=${this.#onPointer} @pointerleave=${this.#onPointer}>
                          <slot></slot>
                      </div>`
                    : EMPTY
            }`;
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
        const menu = this.renderRoot.querySelector<HTMLElement>('.menu');
        if (menu !== null && this.anchor !== null) {
            this.#place(menu, this.anchor);
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
        const menu = this.renderRoot.querySelector<HTMLElement>('.menu');
        if (menu === null || this.anchor === null) {
            return;
        }
        this.#observe(menu);
        // Placed again on every change that moves or resizes it, not only a new anchor: a year's sliders slotted after the
        // anchor (side turned on, new items) kept their unplaced corner, over the dates, so only the opacity panel showed.
        if (PLACING.some((key) => changed.has(key))) {
            this.#place(menu, this.anchor);
        }
        if (changed.has('anchor')) {
            this.#focusChecked();
        }
    }

    /** Watches the menu's and the sliders' sizes: each change places them again. */
    #observe(menu: HTMLElement): void {
        this.#resize.observe(menu);
        const sliders = this.renderRoot.querySelector<HTMLElement>('.side');
        if (sliders !== null) {
            this.#resize.observe(sliders);
        }
    }

    /** A modal menu takes the focus to the checked date, else the first; a peek leaves it where it is. */
    #focusChecked(): void {
        if (!this.peek) {
            (this.#items().find((item) => item.getAttribute('aria-checked') === 'true') ?? this.#items()[0])?.focus();
        }
    }

    /** Beside `at` (client px), inside the viewer, clear of the controls to avoid. */
    #place(menu: HTMLElement, at: Box): void {
        const host = this.getBoundingClientRect();
        const local = (box: Box): Box => ({ x: box.x - host.x, y: box.y - host.y, width: box.width, height: box.height });
        const anchor = local(at);
        const side = this.#side();
        menu.style.setProperty('max-inline-size', `${String(sideRoom(anchor, host.width, side))}px`);
        const size = { width: menu.offsetWidth, height: menu.offsetHeight };
        const wanted = { ...dateMenuOrigin(anchor, size, host, side), ...size };
        const origin = clearOf(wanted, [anchor, ...this.avoid().map(local)], host, LEGAL_STRIP);
        menu.style.setProperty('left', `${String(origin.x)}px`);
        menu.style.setProperty('top', `${String(origin.y)}px`);
        const sliders = this.renderRoot.querySelector<HTMLElement>('.side');
        if (sliders !== null) {
            const room = { width: host.width, height: host.height, ...(side === 'above' ? { floor: anchor.y - EDGE } : {}) };
            placeSide(sliders, { ...origin, ...size }, room, this.stacked);
        }
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
            role="menuitemradio"
            aria-checked=${String(item.id === this.selected)}
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
