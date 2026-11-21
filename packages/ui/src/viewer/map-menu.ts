/**
 * `<hcm-map-menu>`: the map's menu (the owner, 2026-11-09; V62), opened by a right click, a long press or the ContextMenu key
 * (`map-menu-trigger.ts`) at a point of the map. An M3 menu at that point, kept inside the map; Esc or a press outside it
 * closes it (no scrim: the map's controls and its legal line stay uncovered); the arrow keys, Home and End move between its
 * items, Tab walks them as any link and button. Its items are `MAP_MENU_ITEMS`, a registry: an item is
 * a link opened in a new tab (`href`), a text to copy (`copy`) for the place under the pointer, or, with neither, the share
 * of the view on screen, so a new use of the menu is one more entry (docs/ENGINE_API.md → *The map's menu*). It is part of
 * the side-loaded `engine.extras.js`.
 *
 * Events (viewer-internal): `hcm-close`, `hcm-map-menu-copy` (`{text}`, which the viewer copies and announces),
 * `hcm-map-menu-share` (the viewer shares the page's address, whose hash carries the view).
 */
import { DEFAULT_LOCALE, streetViewUrl, translate, type ViewerLocale, type MapView, type MessageKey } from '@hcm/shared';
import { LitElement, css, html, type PropertyValues, type TemplateResult } from 'lit';

import { EMPTY } from './empty.js';
import type { MenuPoint } from './map-menu-trigger.js';
import { closeEvent } from './sheet-frame.js';
import { baseStyles } from './shared-styles.js';

export const HCM_MAP_MENU_TAG = 'hcm-map-menu';

export interface MapPlace {
    readonly lat: number;
    readonly lng: number;
}

/** One entry of the menu: a link to open in a new tab or a text to copy, for the place; with neither, the view's share. */
export interface MapMenuItem {
    readonly id: string;
    readonly icon: string;
    readonly label: MessageKey;
    readonly href?: (place: MapPlace) => string;
    readonly copy?: (place: MapPlace) => string;
}

/** The menu's items, in order. */
export const MAP_MENU_ITEMS: readonly MapMenuItem[] = [
    { id: 'street-view', icon: 'travel_explore', label: 'mapMenu.streetView', href: (place) => streetViewUrl(place) },
    { id: 'copy', icon: 'content_copy', label: 'mapMenu.copy', copy: (place) => `${place.lat.toFixed(6)}, ${place.lng.toFixed(6)}` },
    { id: 'share', icon: 'share', label: 'mapMenu.share' },
];

/** Mapbox's world is 512 px wide at zoom 0. */
const TILE = 512;

/** The place under `point` of a map of `size` showing `view` (Web Mercator, no pitch; the bearing turns the screen). */
export function placeAt(point: MenuPoint, view: MapView, size: { readonly width: number; readonly height: number }): MapPlace {
    const world = TILE * 2 ** view.zoom;
    const [lng, lat] = view.center;
    const centreX = ((lng + 180) / 360) * world;
    const centreY = ((1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2) * world;
    const turn = (view.bearing * Math.PI) / 180;
    const dx = point.x - size.width / 2;
    const dy = point.y - size.height / 2;
    const x = centreX + dx * Math.cos(turn) - dy * Math.sin(turn);
    const y = centreY + dx * Math.sin(turn) + dy * Math.cos(turn);
    return { lng: (x / world) * 360 - 180, lat: (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / world))) * 180) / Math.PI };
}

/** The menu's margin from the map's edges. */
const EDGE = 8;

/** Where the menu's corner goes: at the point, moved back inside the map when it would run past an edge. */
export function menuOrigin(
    point: MenuPoint,
    menu: { readonly width: number; readonly height: number },
    map: { readonly width: number; readonly height: number },
): MenuPoint {
    const within = (at: number, length: number, room: number): number => Math.max(EDGE, Math.min(at, room - length - EDGE));
    return { x: within(point.x, menu.width, map.width), y: within(point.y, menu.height, map.height) };
}

const NEXT: Readonly<Record<string, (index: number, count: number) => number>> = {
    ArrowDown: (index, count) => (index + 1) % count,
    ArrowUp: (index, count) => (index - 1 + count) % count,
    Home: () => 0,
    End: (_index, count) => count - 1,
};

/** The element that has the focus, through the shadow roots. */
function focused(doc: Document): Element | null {
    let active = doc.activeElement;
    while (active?.shadowRoot?.activeElement) {
        active = active.shadowRoot.activeElement;
    }
    return active;
}

export class HcmMapMenu extends LitElement {
    static override readonly properties = {
        point: { attribute: false },
        view: { attribute: false },
        locale: { type: String },
    };

    static override readonly styles = [
        baseStyles,
        css`
            /* Over the map, as large as it; only the scrim and the menu take the pointer, and only while open. */
            :host {
                position: absolute;
                inset: 0;
                z-index: 40;
                pointer-events: none;
            }

            .menu {
                position: absolute;
                z-index: 41;
                pointer-events: auto;
                display: flex;
                flex-direction: column;
                min-inline-size: 112px;
                max-inline-size: calc(100% - 16px);
                padding-block: 8px;
                border-radius: var(--md-sys-shape-corner-extra-small, 4px);
                background: var(--md-sys-color-surface-container);
                color: var(--md-sys-color-on-surface);
                box-shadow: var(--md-sys-elevation-level2, 0 2px 6px rgb(0 0 0 / 30%));
            }

            .item {
                display: flex;
                gap: 12px;
                align-items: center;
                min-block-size: 48px;
                padding-inline: 12px;
                border: 0;
                background: none;
                color: inherit;
                font: inherit;
                text-align: start;
                text-decoration: none;
                cursor: pointer;
            }

            .item:hover,
            .item:focus-visible {
                background: color-mix(in srgb, var(--md-sys-color-on-surface) 8%, transparent);
                outline: var(--hcm-focus-ring-width, 2px) solid var(--md-sys-color-secondary);
                outline-offset: -2px;
            }
        `,
    ];

    /** Where the menu was asked for, in the map's px; null: closed. */
    declare point: MenuPoint | null;
    declare view: MapView;
    declare locale: ViewerLocale;
    /** What had the focus when the menu opened. */
    #opener: Element | null = null;

    constructor() {
        super();
        this.point = null;
        this.view = { center: [0, 0], zoom: 0, bearing: 0 };
        this.locale = DEFAULT_LOCALE;
    }

    override render(): TemplateResult {
        if (this.point === null) {
            return EMPTY;
        }
        const place = placeAt(this.point, this.view, this.#size());
        return html`<div class="menu" role="menu" aria-label=${translate(this.locale, 'mapMenu.label')} @keydown=${this.#onKey}>
            ${MAP_MENU_ITEMS.map((item) => this.#item(item, place))}
        </div>`;
    }

    override disconnectedCallback(): void {
        this.ownerDocument.removeEventListener('pointerdown', this.#outside, true);
        super.disconnectedCallback();
    }

    protected override updated(changed: PropertyValues<this>): void {
        if (!changed.has('point')) {
            return;
        }
        const menu = this.renderRoot.querySelector<HTMLElement>('.menu');
        if (menu === null || this.point === null) {
            this.#closed();
            return;
        }
        this.#opened(menu, this.point, (changed.get('point') ?? null) === null);
    }

    /** Open at `point`: placed inside the map, its first item focused; `fresh`, it remembers what had the focus. */
    #opened(menu: HTMLElement, point: MenuPoint, fresh: boolean): void {
        if (fresh) {
            this.#opener = focused(this.ownerDocument);
        }
        this.ownerDocument.addEventListener('pointerdown', this.#outside, true);
        const origin = menuOrigin(point, { width: menu.offsetWidth, height: menu.offsetHeight }, this.#size());
        menu.style.setProperty('left', `${String(origin.x)}px`);
        menu.style.setProperty('top', `${String(origin.y)}px`);
        this.#items()[0]?.focus();
    }

    /** Closed, the focus its item held goes back to what had it (the map), unless the visitor already put it elsewhere. */
    #closed(): void {
        this.ownerDocument.removeEventListener('pointerdown', this.#outside, true);
        const opener = this.#opener;
        this.#opener = null;
        if (opener instanceof HTMLElement && focused(this.ownerDocument) === this.ownerDocument.body) {
            opener.focus();
        }
    }

    #size(): { readonly width: number; readonly height: number } {
        return { width: this.offsetWidth, height: this.offsetHeight };
    }

    #items(): HTMLElement[] {
        return [...this.renderRoot.querySelectorAll<HTMLElement>('.item')];
    }

    #item(item: MapMenuItem, place: MapPlace): TemplateResult {
        const label = translate(this.locale, item.label);
        const content = html`<hcm-icon name=${item.icon}></hcm-icon><span>${label}</span>`;
        if (item.href !== undefined) {
            return html`<a
                class="item"
                role="menuitem"
                data-item=${item.id}
                href=${item.href(place)}
                target="_blank"
                rel="noopener noreferrer"
                @click=${this.#close}
                >${content}</a
            >`;
        }
        const act = (): void => {
            const text = item.copy?.(place);
            const init = { bubbles: true, composed: true };
            this.dispatchEvent(
                text === undefined
                    ? new CustomEvent('hcm-map-menu-share', init)
                    : new CustomEvent('hcm-map-menu-copy', { ...init, detail: { text } }),
            );
            this.#close();
        };
        return html`<button type="button" class="item" role="menuitem" data-item=${item.id} @click=${act}>${content}</button>`;
    }

    /** A press anywhere but on the menu closes it. */
    readonly #outside = (event: Event): void => {
        const menu = this.renderRoot.querySelector('.menu');
        if (menu !== null && !event.composedPath().includes(menu)) {
            this.#close();
        }
    };

    readonly #close = (): void => {
        this.dispatchEvent(closeEvent());
    };

    readonly #onKey = (event: KeyboardEvent): void => {
        if (event.key === 'Escape') {
            event.preventDefault();
            this.#close();
            return;
        }
        this.#step(event);
    };

    /** The arrow keys, Home and End move the focus between the items, wrapping. */
    #step(event: KeyboardEvent): void {
        const next = NEXT[event.key];
        const items = this.#items();
        if (next !== undefined) {
            event.preventDefault();
            items[next(items.indexOf(this.shadowRoot?.activeElement as HTMLElement), items.length)]?.focus();
        }
    }
}

/** Registers `<hcm-map-menu>` once; calling it again is a no-op. */
export function defineHcmMapMenu(registry: CustomElementRegistry = customElements): void {
    if (registry.get(HCM_MAP_MENU_TAG) === undefined) {
        registry.define(HCM_MAP_MENU_TAG, HcmMapMenu);
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-map-menu': HcmMapMenu;
    }
}
