/**
 * `<hcm-favorite-star>` (V91): the star beside a place's, a photo's, a layer's or a story's title. An M3 toggle icon button
 * (`aria-pressed`, the star fills when saved) whose name says what a press does ("Save to favourites" / "Remove from
 * favourites"); with `row` it takes its own line, at the end (a sheet's details). It reads and flips the page's `favorites` store and follows its `change`, so every star of one item agrees.
 */
import { DEFAULT_LOCALE, translate, type ViewerLocale } from '@hcm/shared';
import { LitElement, css, html, type TemplateResult } from 'lit';

import { favorites, type FavoriteKind } from './favorites.js';

export const HCM_FAVORITE_STAR_TAG = 'hcm-favorite-star';

export class HcmFavoriteStar extends LitElement {
    static override readonly properties = {
        kind: { type: String },
        itemId: { type: String, attribute: 'item-id' },
        locale: { type: String },
    };

    static override readonly styles = css`
        :host {
            display: inline-flex;
            flex: none;
        }

        /* At the top of a sheet's details: the star sits at the line's end, under the sheet's close button. */
        :host([row]) {
            display: flex;
            justify-content: flex-end;

            /* The 40 px button's 48 px touch target reaches 4 px past it: the line below must not cover that ring. */
            padding-block: 4px;
        }
    `;

    declare kind: FavoriteKind;
    declare itemId: string;
    declare locale: ViewerLocale;

    readonly #onChange = (): void => {
        this.requestUpdate();
    };

    constructor() {
        super();
        this.kind = 'poi';
        this.itemId = '';
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
        const saved = favorites.has(this.kind, this.itemId);
        const onClick = (event: Event): void => {
            event.stopPropagation();
            favorites.toggle(this.kind, this.itemId);
        };
        return html`<hcm-icon-button
            icon="star"
            toggle
            .selected=${saved}
            label=${translate(this.locale, saved ? 'favorites.remove' : 'favorites.add')}
            data-favorite=${`${this.kind}:${this.itemId}`}
            @click=${onClick}
        ></hcm-icon-button>`;
    }
}

export function defineHcmFavoriteStar(registry: CustomElementRegistry = customElements): void {
    if (registry.get(HCM_FAVORITE_STAR_TAG) === undefined) {
        registry.define(HCM_FAVORITE_STAR_TAG, HcmFavoriteStar);
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-favorite-star': HcmFavoriteStar;
    }
}
