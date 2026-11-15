import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from 'lit';

import { deepActiveElement } from './focus.js';
import { defineHcmIcon } from './icon.js';
import { defineOnce, emit } from './internal.js';
import { baseStyles, focusRing, stateLayer, typeStyles } from './styles.js';

export const HCM_FAB_MENU_TAG = 'hcm-fab-menu';

export interface FabMenuItem {
    readonly value: string;
    /** Already localized. */
    readonly label: string;
    readonly icon: string;
    /** An item that is on or off (`menuitemcheckbox` with `aria-checked`, a 3 px ring while on); absent: an action. */
    readonly checked?: boolean;
}

const MOVE_KEYS: Readonly<Record<string, number>> = { ArrowDown: 1, ArrowUp: -1 };

/**
 * The M3 Expressive FAB menu: a FAB (`aria-haspopup="menu"`, `aria-expanded`, named `label`) that opens a short menu of
 * actions above it and turns into a close button (`closeLabel`). The menu is at most `--hcm-fab-menu-max-block-size`
 * tall and never wider than the element's box; beyond it the items continue in a second column, or, where the app sets
 * `--hcm-fab-menu-flow: row wrap-reverse` (a landscape phone), in rows that stack upwards from the FAB across the width
 * the app gives the element (the Pixel 9 Pro review, P1: seven items in one row ran 263 px off an 884 px screen). Where
 * even that is too tall the app sets `--hcm-fab-menu-overflow: auto` and the menu scrolls; the arrow keys move the focus,
 * which scrolls the focused item into view. `--hcm-fab-menu-item-height` (56 px) and `--hcm-fab-menu-item-padding` (24 px)
 * make the items more compact, never under 48 px. The FAB and the items line up on the
 * inline end, or on the side `--hcm-fab-menu-align` names (`flex-start` for a menu docked on the leading edge, so a
 * wrapped, wider menu never moves the FAB from under the finger). Opening focuses the first item; the arrow keys
 * (wrapping), Home and End move between items; Esc or a focus leaving the menu closes it, Esc returning the focus to
 * the FAB. The items end `--hcm-fab-menu-gap` (8 px) above the FAB; an app whose FAB sits beside a taller control sets
 * more, so the menu clears it. Narrowed by its dock, an item wraps its label and grows taller (at least 56 px). Choosing
 * an item fires `hcm-select` with `{value}` and closes the menu; every open or close fires `hcm-toggle` with `{open}`. Only the FAB and the items take the pointer: the rest of the element's box (beside the
 * FAB under a wide menu, the gaps between items) lets taps through to what is beneath it.
 */
export class HcmFabMenu extends LitElement {
    static override readonly properties = {
        icon: { type: String },
        label: { type: String },
        closeLabel: { type: String, attribute: 'close-label' },
        items: { attribute: false },
        open: { type: Boolean, reflect: true },
    };

    static override readonly styles = [
        baseStyles,
        focusRing,
        stateLayer,
        typeStyles,
        css`
            /*
             * Only the FAB and the items take the pointer: the open menu's box is as wide as its widest item and reaches
             * down beside the FAB, where nothing of it is drawn (the tour found it blocking the timeline there).
             */
            :host {
                display: inline-flex;
                flex-direction: column;
                gap: var(--hcm-fab-menu-gap, 8px);
                align-items: var(--hcm-fab-menu-align, flex-end);
                pointer-events: none;
            }

            /*
             * At most --hcm-fab-menu-max-block-size tall (the app sets it where the window is short): the items then
             * continue in a second column instead of leaving the screen (no scrolling, which a keyboard could not reach).
             */
            [role='menu'] {
                display: flex;
                flex-flow: var(--hcm-fab-menu-flow, column wrap);
                gap: 4px;
                align-items: var(--hcm-fab-menu-align, flex-end);
                place-content: flex-start var(--hcm-fab-menu-justify, flex-start);
                box-sizing: border-box;
                max-block-size: var(--hcm-fab-menu-max-block-size, none);
                max-inline-size: 100%;
                padding: var(--hcm-fab-menu-padding, 0);
                margin: 0;
                overflow-y: var(--hcm-fab-menu-overflow, visible);
                overscroll-behavior: contain;
            }

            .item,
            .fab {
                display: inline-flex;
                align-items: center;
                box-sizing: border-box;
                min-height: var(--hcm-fab-menu-item-height, 56px);
                margin: 0;
                border: none;
                border-radius: var(--md-sys-shape-corner-full);
                background: var(--md-sys-color-primary-container);
                color: var(--md-sys-color-on-primary-container);
                pointer-events: auto;
            }

            .item {
                flex: none;
                gap: 8px;
                padding-inline: var(--hcm-fab-menu-item-padding, 24px);
            }

            .fab {
                justify-content: center;
                width: 56px;
                border-radius: var(--md-sys-shape-corner-large);
                box-shadow: var(--md-sys-elevation-level3);
                transition: border-radius var(--md-sys-motion-spring-fast-spatial-duration) var(--md-sys-motion-spring-fast-spatial-easing);
            }

            /* A switch that is on wears a ring in its text colour (ButtonText under forced colours, as its edge). */
            .item[aria-checked='true'] {
                border: 3px solid;
            }

            :host([open]) .fab {
                border-radius: var(--md-sys-shape-corner-full);
                background: var(--md-sys-color-primary);
                color: var(--md-sys-color-on-primary);

                --hcm-icon-size: 20px;
            }

            @media (forced-colors: active) {
                .item,
                .fab {
                    border: 1px solid ButtonText;
                }
            }
        `,
    ];

    declare icon: string;
    declare label: string;
    declare closeLabel: string;
    declare items: readonly FabMenuItem[];
    declare open: boolean;

    private focusFirstItem = false;
    /** A press on the FAB is in progress (pointerdown seen, click not yet): the focus leaving for it keeps the menu open. */
    private pressingFab = false;

    constructor() {
        super();
        this.icon = 'menu';
        this.label = '';
        this.closeLabel = '';
        this.items = [];
        this.open = false;
    }

    protected override updated(changed: PropertyValues<this>): void {
        if (changed.has('open') && this.open && this.focusFirstItem) {
            this.focusFirstItem = false;
            this.menuItems()[0]?.focus();
        }
    }

    override render(): TemplateResult {
        return html`${this.open ? this.renderMenu() : nothing}
            <button
                class="fab interactive"
                part="fab"
                aria-label=${this.open ? this.closeLabel : this.label}
                aria-haspopup="menu"
                aria-expanded=${String(this.open)}
                aria-controls="menu"
                @pointerdown=${this.onFabPointerDown}
                @pointercancel=${this.onFabPointerCancel}
                @click=${this.onFabClick}
                @keydown=${this.onKeyDown}
            >
                <hcm-icon name=${this.open ? 'close' : this.icon}></hcm-icon>
            </button>`;
    }

    private renderMenu(): TemplateResult {
        return html`<div id="menu" role="menu" aria-label=${this.label} @keydown=${this.onKeyDown} @focusout=${this.onFocusOut}>
            ${this.items.map(
                (item) =>
                    html`<button
                        class="item interactive title-medium"
                        role=${item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
                        aria-checked=${item.checked === undefined ? nothing : String(item.checked)}
                        tabindex="-1"
                        @click=${() => {
                            this.choose(item.value);
                        }}
                    >
                        <hcm-icon name=${item.icon}></hcm-icon><span>${item.label}</span>
                    </button>`,
            )}
        </div>`;
    }

    private menuItems(): HTMLElement[] {
        return [...this.renderRoot.querySelectorAll<HTMLElement>('[role^="menuitem"]')];
    }

    private fab(): HTMLElement | null {
        return this.renderRoot.querySelector<HTMLElement>('.fab');
    }

    private setOpen(open: boolean): void {
        if (open !== this.open) {
            this.open = open;
            this.focusFirstItem = open;
            emit(this, 'hcm-toggle', { open });
        }
    }

    /**
     * Closes the menu and focuses the FAB before announcing the choice: whatever the app opens in reply (a sheet, a
     * dialog) then remembers the FAB as its opener and gives the focus back to it on close. The item that had the focus
     * is gone with the menu (S-V15-BAD-SHEET-DRAG-CLOSE).
     */
    private choose(value: string): void {
        this.setOpen(false);
        this.fab()?.focus();
        emit(this, 'hcm-select', { value });
    }

    /**
     * iOS Safari never focuses a tapped button: the item that had the focus blurs to nothing, `focusout` closed the menu and
     * the tap's `click` opened it again, so the X never closed it (the owner, 2026-11-15; lesson 740). A press on the FAB
     * marks itself, and the focus leaving for it is no reason to close: its own click decides.
     */
    private readonly onFabPointerDown = (): void => {
        this.pressingFab = true;
    };

    private readonly onFabPointerCancel = (): void => {
        this.pressingFab = false;
    };

    private readonly onFabClick = (): void => {
        this.pressingFab = false;
        this.setOpen(!this.open);
    };

    private readonly onKeyDown = (event: KeyboardEvent): void => {
        if (event.key === 'Escape' && this.open) {
            event.stopPropagation();
            this.setOpen(false);
            this.fab()?.focus();
            return;
        }
        this.moveFocus(event);
    };

    /** Arrow keys, Home and End inside the open menu. */
    private moveFocus(event: KeyboardEvent): void {
        const items = this.menuItems();
        const active = deepActiveElement(this.ownerDocument);
        const current = items.findIndex((item) => item === active);
        const step = MOVE_KEYS[event.key];
        const ends: Readonly<Record<string, number>> = { Home: 0, End: items.length - 1 };
        const target = step === undefined ? ends[event.key] : (current + step + items.length) % items.length;
        if (target !== undefined && items.length > 0) {
            event.preventDefault();
            items[target]?.focus();
        }
    }

    /** Focus leaving the whole element (not moving between its items or to the FAB) closes the menu. */
    private readonly onFocusOut = (event: FocusEvent): void => {
        const next = event.relatedTarget;
        if (this.pressingFab) {
            return;
        }
        if (!(next instanceof Node) || !this.renderRoot.contains(next)) {
            this.setOpen(false);
        }
    };
}

export function defineHcmFabMenu(registry: CustomElementRegistry = customElements): void {
    defineHcmIcon(registry);
    defineOnce(registry, HCM_FAB_MENU_TAG, HcmFabMenu);
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-fab-menu': HcmFabMenu;
    }
}
