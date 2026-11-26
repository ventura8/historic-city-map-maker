/**
 * `<hcm-unplaced-gallery>` (M13, `docs/research/M13-roles.md` §5; V40): the "Where was this taken?" gallery of the photos with no
 * place yet. Each one links to the Contribute page on that photo, a page of its own that signs in; the map itself signs nothing
 * in, so a visitor who only looks sends nothing anywhere. No link without `contributeUrl` (a static export).
 */
import { DEFAULT_LOCALE, translate, type ViewerLocale, type UnplacedPhoto } from '@hcm/shared';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { repeat } from 'lit/directives/repeat.js';

import { externalLink } from './markdown.js';
import { photoRights } from './photo-rights.js';
import { resolveAssetUrl } from './services.js';
import { baseStyles, detailStyles } from './shared-styles.js';
import { localizedText, photoDateText } from './text.js';

export const HCM_UNPLACED_GALLERY_TAG = 'hcm-unplaced-gallery';

export class HcmUnplacedGallery extends LitElement {
    static override readonly properties = {
        photos: { attribute: false },
        locale: { type: String },
        manifestUrl: { attribute: false },
        contributeUrl: { attribute: false },
    };

    static override readonly styles = [
        baseStyles,
        detailStyles,
        css`
            :host {
                display: block;
            }

            ul {
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
                gap: 16px;
                margin-block-start: 12px;
            }

            li {
                display: flex;
                flex-direction: column;
                gap: 4px;
                overflow-wrap: anywhere;
            }

            img {
                inline-size: 100%;
                block-size: auto;
                aspect-ratio: 1;
                border-radius: var(--md-sys-shape-corner-medium);
                object-fit: cover;
                background: var(--md-sys-color-surface-container-highest);
            }

            .date {
                color: var(--md-sys-color-on-surface-variant);
            }

            /*
             * "I know where" stands alone on its line, so it is a target of its own: 48 px tall like the sheet's lone links
             * (detailStyles' .link > a). The tour at m768 found it 19 px tall, the height of its text.
             */
            li > a {
                display: inline-flex;
                align-items: center;
                align-self: flex-start;
                min-block-size: 48px;
            }
        `,
    ];

    declare photos: readonly UnplacedPhoto[];
    declare locale: ViewerLocale;
    declare manifestUrl: string;
    declare contributeUrl: string | null;

    constructor() {
        super();
        this.photos = [];
        this.locale = DEFAULT_LOCALE;
        this.manifestUrl = '';
        this.contributeUrl = null;
    }

    override render(): TemplateResult {
        return html`<p>${translate(this.locale, 'unplaced.intro')}</p>
            <ul aria-label=${translate(this.locale, 'unplaced.title')}>
                ${repeat(
                    this.photos,
                    (photo) => photo.id,
                    (photo) => this.#item(photo),
                )}
            </ul>`;
    }

    #item(photo: UnplacedPhoto): TemplateResult {
        const title = localizedText(photo.title, this.locale);
        const src = resolveAssetUrl(photo.image.thumb, this.manifestUrl, document.baseURI) ?? '';
        return html`<li>
            <img src=${src} alt=${title} loading="lazy" decoding="async" />
            <span>${title}</span>
            <span class="date">${photoDateText(photo, this.locale)}</span>
            ${photoRights(photo, this.locale)}
            ${this.contributeUrl === null ? nothing : externalLink(`${this.contributeUrl}/${photo.id}`, translate(this.locale, 'unplaced.suggest'))}
        </li>`;
    }
}

/** Registers `<hcm-unplaced-gallery>` once; calling it again is a no-op. */
export function defineHcmUnplacedGallery(registry: CustomElementRegistry = customElements): void {
    if (registry.get(HCM_UNPLACED_GALLERY_TAG) === undefined) {
        registry.define(HCM_UNPLACED_GALLERY_TAG, HcmUnplacedGallery);
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-unplaced-gallery': HcmUnplacedGallery;
    }
}
