/**
 * `<hcm-georef-menu>`: the georeferencer's context menu (a right-click, a long press or the ContextMenu key / Shift+F10 on
 * the scan or the map; `./georef-menu-host.ts` opens it). A chunk of its own (`georef-menu-<hash>.js`, with the host's
 * gestures), fetched at the page's first render, so the `georef` chunk keeps its budget. An M3 menu in the top layer (a manual popover) at `x`, `y` (viewport
 * CSS px, kept inside the window): `role="menu"` with `menuitem` buttons; opening focuses the first item, the arrow keys
 * (wrapping), Home and End move between them. Its items: Add a point here where there is a place, Move and Delete this
 * point where there is a pair, Undo with `canUndo`; `locked` (a read-only version), only a line saying so (`aria-disabled`).
 * Choosing one fires `hcm-close` and calls its intent; Esc, Tab, a press outside or the focus leaving fire `hcm-close` (the
 * page closes it and gives the focus back).
 */
import type { UiLocale } from '@hcm/shared';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';

import { deepActiveElement } from '../../components/focus.js';
import { defineOnce, emit } from '../../components/internal.js';
import { baseStyles, focusRing, stateLayer, typeStyles } from '../../components/styles.js';
import { contentText } from '../shell/text.js';
import type { GeorefMenuOpen } from './georef-menu-host.js';
import type { GeorefIntentsPort } from './georef-port.js';

// The gestures that open it, and what is under them, come in this chunk too.
export { menuAt, MenuGestures } from './georef-menu-host.js';

const HCM_GEOREF_MENU_TAG = 'hcm-georef-menu';

/** The menu keeps this far from the window's edges (CSS px). */
const EDGE = 8;

const STEPS: Readonly<Record<string, number>> = { ArrowDown: 1, ArrowUp: -1 };

interface GeorefMenuItem {
    readonly value: string;
    readonly label: string;
    readonly disabled?: boolean;
}

type MenuText = 'add' | 'move' | 'delete' | 'undo' | 'readOnly';

/** The menu's items there: none that edits on a read-only version (one line saying so instead). */
function menuItems(locale: UiLocale, menu: GeorefMenuOpen, canUndo: boolean, locked: boolean): readonly GeorefMenuItem[] {
    const text = (key: MenuText): string => contentText(locale, `adminContent.georef.menu.${key}`);
    if (locked) {
        return [{ value: 'none', label: text('readOnly'), disabled: true }];
    }
    const values: readonly MenuText[] = [
        ...(menu.end === null ? [] : (['add'] as const)),
        ...(menu.hit === null ? [] : (['move', 'delete'] as const)),
        ...(canUndo ? (['undo'] as const) : []),
    ];
    return values.map((value) => ({ value, label: text(value) }));
}

/** A chosen item's intent. */
export function chooseItem(value: string, menu: GeorefMenuOpen, intents: GeorefIntentsPort | null): void {
    const { end, pane } = menu;
    const hit = menu.hit ?? '';
    const actions: Readonly<Record<string, (() => void) | undefined>> = {
        add: () => {
            if (end !== null) {
                intents?.addAt(end);
            }
        },
        move: () => {
            intents?.pickUp(hit, pane);
        },
        delete: () => {
            intents?.remove(hit);
        },
        undo: () => {
            intents?.undo();
        },
    };
    actions[value]?.();
}

export class HcmGeorefMenu extends LitElement {
    static override readonly properties = {
        menu: { attribute: false },
        locale: { type: String },
        canUndo: { type: Boolean, attribute: 'can-undo' },
        locked: { type: Boolean },
        intents: { attribute: false },
    };

    static override readonly styles = [
        baseStyles,
        focusRing,
        stateLayer,
        typeStyles,
        css`
            [role='menu'] {
                position: fixed;
                inset: auto;
                min-inline-size: 112px;
                max-inline-size: 280px;
                margin: 0;
                padding: 8px 0;
                border: none;
                border-radius: var(--md-sys-shape-corner-extra-small, 4px);
                background: var(--md-sys-color-surface-container, Canvas);
                color: var(--md-sys-color-on-surface, CanvasText);
                box-shadow: var(--md-sys-elevation-level2);
            }

            button {
                display: flex;
                align-items: center;
                box-sizing: border-box;
                inline-size: 100%;
                min-block-size: 48px;
                padding-inline: 12px;
                border: none;
                background: none;
                color: inherit;
                text-align: start;
            }

            button[aria-disabled='true'] {
                color: var(--md-sys-color-on-surface-variant, GrayText);
                cursor: default;
            }

            @media (forced-colors: active) {
                [role='menu'] {
                    border: 1px solid CanvasText;
                }
            }
        `,
    ];

    /** Where it opened and what is there. */
    declare menu: GeorefMenuOpen;
    declare locale: UiLocale;
    declare canUndo: boolean;
    /** A read-only version: nothing that edits. */
    declare locked: boolean;
    declare intents: GeorefIntentsPort | null;

    constructor() {
        super();
        this.menu = { pane: 'scan', at: { x: 0, y: 0 }, end: null, hit: null };
        this.locale = 'en';
        this.canUndo = false;
        this.locked = false;
        this.intents = null;
    }

    override connectedCallback(): void {
        super.connectedCallback();
        this.ownerDocument.addEventListener('pointerdown', this.#outside, true);
    }

    override disconnectedCallback(): void {
        super.disconnectedCallback();
        this.ownerDocument.removeEventListener('pointerdown', this.#outside, true);
    }

    protected override firstUpdated(): void {
        this.#menu()?.showPopover();
        this.#items()[0]?.focus();
    }

    /** Placed at its point, moved back inside the window where it would leave it. */
    protected override updated(): void {
        const menu = this.#menu();
        if (menu === null) {
            return;
        }
        const box = menu.getBoundingClientRect();
        const { x, y } = this.menu.at;
        menu.style.left = `${String(Math.max(EDGE, Math.min(x, innerWidth - box.width - EDGE)))}px`;
        menu.style.top = `${String(Math.max(EDGE, Math.min(y, innerHeight - box.height - EDGE)))}px`;
    }

    override render(): TemplateResult {
        const label = contentText(this.locale, 'adminContent.georef.menu.label');
        const items = menuItems(this.locale, this.menu, this.canUndo, this.locked);
        return html`<div role="menu" popover="manual" aria-label=${label} @keydown=${this.#key} @focusout=${this.#focusOut}>
            ${items.map(
                (item) =>
                    html`<button
                        class="interactive label-large"
                        role="menuitem"
                        tabindex="-1"
                        data-value=${item.value}
                        aria-disabled=${item.disabled === true ? 'true' : nothing}
                        @click=${() => {
                            this.#choose(item);
                        }}
                    >
                        ${item.label}
                    </button>`,
            )}
        </div>`;
    }

    #menu(): HTMLElement | null {
        return this.renderRoot.querySelector<HTMLElement>('[role="menu"]');
    }

    #items(): HTMLElement[] {
        return [...this.renderRoot.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    }

    /** Closed first (the page gives the focus back), then the item's intent. */
    #choose(item: GeorefMenuItem): void {
        if (item.disabled !== true) {
            emit(this, 'hcm-close', {});
            chooseItem(item.value, this.menu, this.intents);
        }
    }

    readonly #key = (event: KeyboardEvent): void => {
        if (event.key === 'Escape' || event.key === 'Tab') {
            // The page's own Esc (it drops the half pair) is not this one.
            event.preventDefault();
            event.stopPropagation();
            emit(this, 'hcm-close', {});
            return;
        }
        this.#move(event);
    };

    /** The arrow keys (wrapping), Home and End. */
    #move(event: KeyboardEvent): void {
        const items = this.#items();
        const current = items.findIndex((item) => item === deepActiveElement(this.ownerDocument));
        const step = STEPS[event.key];
        const ends: Readonly<Record<string, number>> = { Home: 0, End: items.length - 1 };
        const target = step === undefined ? ends[event.key] : (current + step + items.length) % items.length;
        if (target !== undefined) {
            event.preventDefault();
            items[target]?.focus();
        }
    }

    readonly #focusOut = (event: FocusEvent): void => {
        const next = event.relatedTarget;
        if (next instanceof Node && !this.renderRoot.contains(next)) {
            emit(this, 'hcm-close', {});
        }
    };

    /** A press anywhere else closes the menu (and does what it does there). */
    readonly #outside = (event: Event): void => {
        if (!event.composedPath().includes(this)) {
            emit(this, 'hcm-close', {});
        }
    };
}

export function defineHcmGeorefMenu(registry: CustomElementRegistry = customElements): void {
    defineOnce(registry, HCM_GEOREF_MENU_TAG, HcmGeorefMenu);
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-georef-menu': HcmGeorefMenu;
    }
}
