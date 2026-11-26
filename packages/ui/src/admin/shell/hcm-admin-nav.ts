/**
 * `<hcm-admin-nav>`: the admin's navigation (`docs/research/M2b-interfaces.md` §1.2), one list in three M3 forms: the
 * navigation bar at the bottom of a compact window (its own four destinations plus "More", which opens the rest in a
 * modal bottom sheet), the collapsed navigation rail (icons with their labels below: medium, expanded, and a landscape
 * phone) and the expanded rail (labels beside the icons: large windows); never a drawer. Destinations are hash links,
 * so the browser's own navigation (and its history) works; the current one has `aria-current="page"`. The `foot` slot
 * takes the account button on a landscape phone, where there is no top bar. A rail taller than the window scrolls on
 * its own (a landscape phone), and a label wider than its item wraps inside it (a long translation, or a reader's wider
 * text spacing, WCAG 1.4.12) instead of leaving the rail.
 */
import { DEFAULT_LOCALE, INBOX_BADGE_MAX, type UiLocale } from '@hcm/shared';
import { LitElement, css, html, type TemplateResult } from 'lit';

import { visuallyHidden } from '../../components/styles.js';
import type { AdminDestinationPort, AdminRouteIdPort } from '../admin-port.js';
import { adminBase } from './admin-styles.js';
import { EMPTY } from './empty.js';
import { contentText, shellLanguage, shellText } from './text.js';

/** M4: the unread count as the badge shows it (`99+` above `INBOX_BADGE_MAX`), or null for none. */
export function badgeText(unread: number | null): string | null {
    if (unread === null || unread <= 0) {
        return null;
    }
    return unread > INBOX_BADGE_MAX ? `${String(INBOX_BADGE_MAX)}+` : String(unread);
}

export const HCM_ADMIN_NAV_TAG = 'hcm-admin-nav';

export type AdminNavVariant = 'bar' | 'rail' | 'expanded';

export class HcmAdminNav extends LitElement {
    static override readonly properties = {
        destinations: { attribute: false },
        current: { type: String },
        variant: { type: String, reflect: true },
        unread: { attribute: false },
        locale: { type: String },
        moreOpen: { state: true },
    };

    static override readonly styles = [
        adminBase,
        visuallyHidden,
        css`
            :host {
                display: block;
                background: var(--md-sys-color-surface-container, Canvas);
            }

            nav {
                display: flex;
                box-sizing: border-box;
                block-size: 100%;
            }

            :host([variant='bar']) nav {
                justify-content: space-around;
                min-block-size: 80px;
                padding-block-end: env(safe-area-inset-bottom);
            }

            :host([variant='rail']) nav,
            :host([variant='expanded']) nav {
                flex-direction: column;
                gap: 4px;
                padding-block: 12px;
                padding-inline-start: env(safe-area-inset-left);
                overflow-y: auto;
            }

            :host([variant='rail']) nav {
                inline-size: 96px;
                align-items: center;
            }

            :host([variant='expanded']) nav {
                inline-size: 240px;
                padding-inline: 12px;
            }

            .item {
                position: relative;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                gap: 4px;
                box-sizing: border-box;
                min-block-size: 56px;
                min-inline-size: 48px;
                max-inline-size: 100%;
                padding: 4px;
                border: 0;
                background: none;
                color: var(--md-sys-color-on-surface-variant, CanvasText);
                font: inherit;
                font-size: var(--md-sys-typescale-label-medium-size, 0.75rem);
                font-weight: var(--md-sys-typescale-label-medium-weight, 500);
                text-align: center;
                text-decoration: none;
                cursor: pointer;
            }

            .more-list .item {
                flex-direction: row;
                justify-content: flex-start;
                gap: 12px;
                padding-inline: 16px;
            }

            /* The whole fifth of the bar for the label: "Configurare" broke after its tenth letter at 360 px with 4 px padding. */
            :host([variant='bar']) .item {
                flex: 1 1 0;
                padding-inline: 0;
                container-type: inline-size;
            }

            :host([variant='expanded']) .item {
                flex-direction: row;
                justify-content: flex-start;
                gap: 12px;
                padding-inline: 16px;
                border-radius: var(--md-sys-shape-corner-full, 28px);
                font-size: var(--md-sys-typescale-label-large-size, 0.875rem);
            }

            .label {
                overflow-wrap: anywhere;
            }

            /*
             * At 320 px a fifth of the bar is 64 px, a few pixels short of "Configurare" at 12 px (the M2e review): below
             * about 70 px the label follows its item's width, 10.9 px at 64 px, so its words stay whole.
             */
            :host([variant='bar']) .label {
                font-size: min(var(--md-sys-typescale-label-medium-size, 0.75rem), 17cqi);
            }

            .indicator {
                flex: none;
                display: grid;
                place-items: center;
                inline-size: 56px;
                block-size: 32px;
                border-radius: var(--md-sys-shape-corner-full, 16px);
            }

            :host([variant='expanded']) .indicator {
                inline-size: auto;
            }

            .item[aria-current='page'] {
                color: var(--md-sys-color-on-surface, CanvasText);
            }

            .item[aria-current='page'] .indicator,
            :host([variant='expanded']) .item[aria-current='page'] {
                background: var(--md-sys-color-secondary-container, Highlight);
                color: var(--md-sys-color-on-secondary-container, HighlightText);
            }

            .foot {
                margin-block-start: auto;
            }

            /*
             * M4: the unread notifications (M3's large badge). Beside the icon in the rail and the bar, clear of its glyph;
             * at the end of the row where the label is beside the icon (the expanded rail, the More sheet).
             */
            .badge {
                position: absolute;
                inset-block-start: 4px;
                inset-inline-start: calc(50% + 14px);
                box-sizing: border-box;
                min-inline-size: 16px;
                block-size: 16px;
                padding-inline: 4px;
                border-radius: var(--md-sys-shape-corner-full, 8px);
                background: var(--md-sys-color-error, CanvasText);
                color: var(--md-sys-color-on-error, Canvas);
                font-size: var(--md-sys-typescale-label-small-size, 0.6875rem);
                line-height: 16px;
                text-align: center;
            }

            .more-list .badge,
            :host([variant='expanded']) .badge {
                position: static;
                margin-inline-start: auto;
            }

            .more-list {
                display: flex;
                flex-direction: column;
                gap: 4px;
                padding-block-end: 16px;
            }

            /*
             * An item as wide as the scrolling rail would lose the sides of a ring drawn outside it; the bar's items touch
             * the window's bottom and side edges, where the app shell's root (overflow hidden) cuts a ring drawn outside.
             */
            :host([variant='rail']) .item:focus-visible,
            :host([variant='bar']) .item:focus-visible {
                outline-offset: calc(-1 * var(--md-sys-state-focus-indicator-thickness, 3px));
            }
        `,
    ];

    declare destinations: readonly AdminDestinationPort[];
    declare current: AdminRouteIdPort;
    declare variant: AdminNavVariant;
    declare locale: UiLocale;
    declare moreOpen: boolean;
    /** M4: the signed-in admin's unread notifications, shown on the Notifications item (null: unknown or none). */
    declare unread: number | null;

    constructor() {
        super();
        this.destinations = [];
        this.current = 'setup';
        this.variant = 'rail';
        this.locale = DEFAULT_LOCALE;
        this.moreOpen = false;
        this.unread = null;
    }

    override render(): TemplateResult {
        const label = shellText(this.locale, 'adminShell.nav.label');
        if (this.variant !== 'bar') {
            return html`<nav aria-label=${label}>
                ${this.destinations.map((destination) => this.#item(destination))}
                <div class="foot"><slot name="foot"></slot></div>
            </nav>`;
        }
        const own = this.destinations.filter((destination) => destination.compact);
        const more = this.destinations.filter((destination) => !destination.compact);
        return html`<nav aria-label=${label}>${own.map((destination) => this.#item(destination))} ${this.#more(more)}</nav>`;
    }

    #item(destination: AdminDestinationPort): TemplateResult {
        const current = destination.id === this.current;
        const close = (): void => {
            this.moreOpen = false;
        };
        return html`<a class="item" href=${['#', destination.id].join('/')} aria-current=${current ? 'page' : 'false'} @click=${close}>
            <span class="indicator"><hcm-icon name=${destination.icon} ?filled=${current}></hcm-icon></span>
            <span class="label" lang=${shellLanguage(this.locale, `adminShell.nav.${destination.id}`)}
                >${shellText(this.locale, `adminShell.nav.${destination.id}`)}</span
            >
            ${destination.id === 'inbox' ? this.#badge() : EMPTY}
        </a>`;
    }

    /** The unread count, read with the item's name (`Notificări, necitite: 3`; `Notifications, 3 unread`). */
    #badge(): TemplateResult {
        const text = badgeText(this.unread);
        if (text === null) {
            return EMPTY;
        }
        return html`<span class="badge" aria-hidden="true" data-badge>${text}</span
            ><span class="visually-hidden">, ${contentText(this.locale, 'adminContent.notify.badge', { count: text })}</span>`;
    }

    /** "More" and its modal bottom sheet, when the bar cannot hold every destination. */
    #more(more: readonly AdminDestinationPort[]): TemplateResult {
        if (more.length === 0) {
            return EMPTY;
        }
        const label = shellText(this.locale, 'adminShell.nav.more');
        const current = more.some((destination) => destination.id === this.current);
        const open = (): void => {
            this.moreOpen = true;
        };
        const close = (): void => {
            this.moreOpen = false;
        };
        return html`<button class="item" type="button" aria-haspopup="dialog" aria-expanded=${String(this.moreOpen)} @click=${open}>
                <span class="indicator"><hcm-icon name="menu" ?filled=${current}></hcm-icon></span>
                <span class="label">${label}</span>
                ${more.some((destination) => destination.id === 'inbox') ? this.#badge() : EMPTY}
            </button>
            <hcm-sheet
                modal
                variant="bottom"
                detent="half"
                .open=${this.moreOpen}
                .label=${label}
                .closeLabel=${shellText(this.locale, 'adminShell.nav.close')}
                .handleLabel=${label}
                @hcm-close=${close}
            >
                <div class="more-list">${more.map((destination) => this.#item(destination))}</div>
            </hcm-sheet>`;
    }
}

/** Registers `<hcm-admin-nav>` once; calling it again is a no-op. */
export function defineHcmAdminNav(registry: CustomElementRegistry = customElements): void {
    if (registry.get(HCM_ADMIN_NAV_TAG) === undefined) {
        registry.define(HCM_ADMIN_NAV_TAG, HcmAdminNav);
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-admin-nav': HcmAdminNav;
    }
}
