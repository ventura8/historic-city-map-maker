/**
 * `<hcm-favorites>` (V91): the Favourites sheet's list, from the page's `favorites` store and the manifest. A row opens its
 * item with the event the rest of the viewer already uses (`hcm-poi-select`, `hcm-photo-select`, `hcm-layer-show`,
 * `hcm-story-select`); its star removes it. Without any, it says how to save one; when the browser refuses storage, it
 * says the list lasts for this page only and where to allow it.
 */
import { DEFAULT_LOCALE, translate, type Manifest, type ViewerLocale } from '@hcm/shared';
import { LitElement, css, html, type TemplateResult } from 'lit';

import { EMPTY } from './empty.js';
import { favoriteEntries, favorites, type FavoriteEntry, type FavoriteKind } from './favorites.js';
import { baseStyles, detailStyles } from './shared-styles.js';

export const HCM_FAVORITES_TAG = 'hcm-favorites';

const OPEN_EVENTS: Readonly<Record<FavoriteKind, readonly [string, string]>> = {
    poi: ['hcm-poi-select', 'poiId'],
    photo: ['hcm-photo-select', 'photoId'],
    layer: ['hcm-layer-show', 'layerId'],
    story: ['hcm-story-select', 'storyId'],
};

/** The event that opens `entry` where the viewer opens it from anywhere else. */
export function favoriteOpenEvent(entry: Pick<FavoriteEntry, 'kind' | 'id'>): CustomEvent {
    const [type, key] = OPEN_EVENTS[entry.kind];
    return new CustomEvent(type, { bubbles: true, composed: true, detail: { [key]: entry.id } });
}

export class HcmFavorites extends LitElement {
    static override readonly properties = {
        manifest: { attribute: false },
        locale: { type: String },
    };

    static override readonly styles = [
        baseStyles,
        detailStyles,
        css`
            :host {
                display: block;
            }

            ul.favorites {
                display: grid;
                gap: 4px;
            }

            li {
                display: flex;
                align-items: center;
                gap: 4px;
            }

            .open {
                display: flex;
                flex: 1;
                align-items: center;
                gap: 12px;
                min-inline-size: 0;
                min-block-size: 48px;
                padding: 4px 8px;
                border: 0;
                border-radius: var(--md-sys-shape-corner-medium);
                background: none;
                color: inherit;
                font: inherit;
                text-align: start;
                cursor: pointer;
                overflow-wrap: anywhere;
            }

            .open:hover {
                background: color-mix(in srgb, var(--md-sys-color-on-surface) 8%, transparent);
            }

            .open hcm-icon {
                color: var(--md-sys-color-on-surface-variant);
            }
        `,
    ];

    declare manifest: Manifest | null;
    declare locale: ViewerLocale;

    readonly #onChange = (): void => {
        this.requestUpdate();
    };

    constructor() {
        super();
        this.manifest = null;
        this.locale = DEFAULT_LOCALE;
    }

    override connectedCallback(): void {
        super.connectedCallback();
        favorites.addEventListener('change', this.#onChange);
    }

    override disconnectedCallback(): void {
        super.disconnectedCallback();
        favorites.removeEventListener('change', this.#onChange);
    }

    override render(): TemplateResult {
        const entries = this.manifest === null ? [] : favoriteEntries(favorites.list, this.manifest, this.locale);
        const note = favorites.persisted
            ? EMPTY
            : html`<div class="note" data-favorites="not-saved">
                  <p>${translate(this.locale, 'favorites.notSaved')}</p>
                  <p>${translate(this.locale, 'favorites.notSavedFix')}</p>
              </div>`;
        if (entries.length === 0) {
            return html`${note}
                <p class="supporting" data-favorites="empty">${translate(this.locale, 'favorites.empty')}</p>`;
        }
        return html`${note}
            <ul class="favorites">
                ${entries.map((entry) => this.#row(entry))}
            </ul>`;
    }

    #row(entry: FavoriteEntry): TemplateResult {
        const open = (event: Event): void => {
            event.currentTarget?.dispatchEvent(favoriteOpenEvent(entry));
        };
        return html`<li>
            <button type="button" class="open" data-open=${`${entry.kind}:${entry.id}`} @click=${open}>
                <hcm-icon name=${entry.icon}></hcm-icon><span>${entry.title}</span>
            </button>
            <hcm-favorite-star .kind=${entry.kind} .itemId=${entry.id} .locale=${this.locale}></hcm-favorite-star>
        </li>`;
    }
}

export function defineHcmFavorites(registry: CustomElementRegistry = customElements): void {
    if (registry.get(HCM_FAVORITES_TAG) === undefined) {
        registry.define(HCM_FAVORITES_TAG, HcmFavorites);
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-favorites': HcmFavorites;
    }
}
