/**
 * `<hcm-poi-detail>`: the details of a point of interest inside the detail sheet (PLAN Addendum 3, scenario V24):
 * its category (icon and colour), years, the Markdown-subset description walked into DOM nodes (markup stays text),
 * its links and the thumbnails of its photos; a thumbnail fires `hcm-photo-select` to open that photo. M27
 * (`docs/research/M27-lost-streets.md`): its sources, as text: the historical layer it was traced on (`sourceLayer`, looked
 * up in `layers`; an unknown id says nothing) and the credit of its category's data (`attribution`). M17 §12
 * (`docs/research/M17-stories.md`): its Media, one chip per kind that has any (Maps, Aerial, Exterior, Interior, from
 * `placeMedia`); a photo's thumbnail fires `hcm-photo-select`, a map's button `hcm-layer-show` (switch it on and fit it).
 */
import {
    DEFAULT_LOCALE,
    localized,
    categoryLabel,
    placeMedia,
    placeMediaKinds,
    poiIcon,
    shownLanguage,
    translate,
    type Layer,
    type ViewerLocale,
    type Photo,
    type PlaceMedia,
    type PlaceMediaKind,
    type Poi,
    type UnplacedPhoto,
    type PoiCategory,
} from '@hcm/shared';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';

import { cssProperties } from '../components/css-properties.js';
import { EMPTY } from './empty.js';
import { externalLink, renderMarkdown } from './markdown.js';
import { creditLine } from './photo-rights.js';
import { placeFacts } from './poi-facts.js';
import { planItems } from './place-plans.js';
import { resolveAssetUrl } from './services.js';
import { fallbackNote } from './fallback-note.js';
import { baseStyles, detailStyles } from './shared-styles.js';
import { localizedText, placeYearsText } from './text.js';

export const HCM_POI_DETAIL_TAG = 'hcm-poi-detail';

/** Category colours come from the manifest (`#rrggbb`, schema-checked); anything else is ignored. */
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** M17 §12: the viewer-internal event asking to show a place's map (switched on, at its year, fitted). */
function layerShowEvent(layerId: string): CustomEvent<{ readonly layerId: string }> {
    return new CustomEvent('hcm-layer-show', { bubbles: true, composed: true, detail: { layerId } });
}

/** The viewer-internal event asking to open a photo. */
export function photoSelectEvent(photoId: string): CustomEvent<{ readonly photoId: string }> {
    return new CustomEvent('hcm-photo-select', { bubbles: true, composed: true, detail: { photoId } });
}

export class HcmPoiDetail extends LitElement {
    static override readonly properties = {
        poi: { attribute: false },
        category: { attribute: false },
        thumbnail: { attribute: false },
        layers: { attribute: false },
        photos: { attribute: false },
        pois: { attribute: false },
        locale: { type: String },
        manifestUrl: { type: String, attribute: 'manifest-url' },
        mediaKind: { state: true },
        planLevel: { state: true },
    };

    static override readonly styles = [
        baseStyles,
        detailStyles,
        css`
            :host {
                display: block;
            }

            .category {
                display: flex;
                align-items: center;
                gap: 8px;
            }

            .swatch {
                display: inline-grid;
                place-items: center;
                inline-size: 32px;
                block-size: 32px;
                border-radius: var(--md-sys-shape-corner-full);
                background: var(--hcm-poi-color, var(--md-sys-color-primary));
                color: var(--md-sys-color-on-primary);
            }

            .thumbs {
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
                gap: 8px;
            }

            /* The grid's gap spaces the thumbnails: the detail lists' 4 px between items would push every later one down. */
            .details .thumbs li + li {
                margin-block-start: 0;
            }

            .thumbs button {
                display: block;
                inline-size: 100%;
                min-block-size: 48px;
                padding: 0;
                border: 0;
                border-radius: var(--md-sys-shape-corner-medium);
                overflow: hidden;
                background: var(--md-sys-color-surface-container-highest);
                cursor: pointer;
            }

            .picture {
                display: block;
                inline-size: 100%;
                max-block-size: 240px;
                object-fit: cover;
                border-radius: var(--md-sys-shape-corner-medium);
            }

            .kinds {
                margin: 0 0 8px;
            }

            .maps button {
                display: flex;
                align-items: center;
                gap: 8px;
                inline-size: 100%;
                min-block-size: 48px;
                padding-inline: 12px;
                border: 1px solid var(--md-sys-color-outline-variant);
                border-radius: var(--md-sys-shape-corner-medium);
                background: var(--md-sys-color-surface-container-high);
                color: var(--md-sys-color-on-surface);
                font: inherit;
                text-align: start;
                cursor: pointer;
            }

            .thumbs img {
                display: block;
                inline-size: 100%;
                aspect-ratio: 1;
                object-fit: cover;
            }
        `,
    ];

    declare poi: Poi | null;
    declare category: PoiCategory | null;
    /** M31: a Wikipedia article's free thumbnail (relative to the manifest), shown above its text; null for none. */
    declare thumbnail: string | null;
    /** M27: the manifest's layers, where `sourceLayer` is looked up. */
    declare layers: readonly Layer[];
    /** The manifest's photos; the POI's `photoIds` are looked up here (unknown ids are skipped). */
    declare photos: readonly Photo[];
    /** M17 §13: the manifest's places, where the facts' related places are looked up. */
    declare pois: readonly Poi[];
    declare locale: ViewerLocale;
    declare manifestUrl: string;
    /** The Media chip chosen; null: the first kind the place has. */
    declare mediaKind: PlaceMediaKind | null;
    /** M17 §14: the plan level chosen; null: the lowest. */
    declare planLevel: number | null;

    constructor() {
        super();
        this.poi = null;
        this.category = null;
        this.thumbnail = null;
        this.layers = [];
        this.photos = [];
        this.pois = [];
        this.locale = DEFAULT_LOCALE;
        this.manifestUrl = '';
        this.mediaKind = null;
        this.planLevel = null;
    }

    override willUpdate(changed: Map<PropertyKey, unknown>): void {
        if (changed.has('poi')) {
            this.mediaKind = null;
            this.planLevel = null;
        }
    }

    override render(): TemplateResult {
        const poi = this.poi;
        if (poi === null) {
            return EMPTY;
        }
        const years = placeYearsText(poi, this.locale);
        return html`<div class="details">
            <hcm-favorite-star row kind="poi" item-id=${poi.id} .locale=${this.locale}></hcm-favorite-star>
            ${this.#category()} ${this.#thumbnail()} ${this.#currentName(poi)}
            ${years === null ? nothing : html`<p class="years">${years}</p>`}
            ${
                poi.description === undefined
                    ? nothing
                    : html`<div class="description" lang=${shownLanguage(poi.description, this.locale)}>
                          ${renderMarkdown(localizedText(poi.description, this.locale))}
                      </div>`
            }
            ${fallbackNote(poi.title, this.locale)} ${creditLine(poi.credit, this.locale)} ${this.#facts(poi)} ${this.#sources(poi)}
            ${this.#links(poi)} ${this.#media(poi)}
        </div>`;
    }

    #category(): TemplateResult {
        const category = this.category;
        if (category === null) {
            return EMPTY;
        }
        const color = HEX_COLOR.test(category.color) ? { '--hcm-poi-color': category.color } : {};
        return html`<p class="category">
            <span class="swatch" ${cssProperties(color)}><hcm-icon .name=${poiIcon(category.icon)}></hcm-icon></span>
            <span>${translate(this.locale, 'poi.category', { category: categoryLabel(category, this.locale) })}</span>
        </p>`;
    }

    /** M17 §13: the place's facts; a related place fires `hcm-poi-select`. */
    #facts(poi: Poi): TemplateResult {
        return placeFacts(poi, this.pois, this.locale, (poiId) => {
            this.dispatchEvent(new CustomEvent('hcm-poi-select', { bubbles: true, composed: true, detail: { poiId } }));
        });
    }

    /** M31: the article's picture, decorative (its title is the sheet's heading). */
    #thumbnail(): TemplateResult {
        const src = this.thumbnail === null ? null : resolveAssetUrl(this.thumbnail, this.manifestUrl, document.baseURI);
        return src === null ? EMPTY : html`<img class="picture" src=${src} alt="" loading="lazy" decoding="async" />`;
    }

    /** M27: the street's current name when it was renamed rather than demolished. */
    #currentName(poi: Poi): TemplateResult {
        if (poi.currentName === undefined) {
            return EMPTY;
        }
        return html`<p class="current-name" lang=${shownLanguage(poi.currentName, this.locale)}>
            ${translate(this.locale, 'poi.currentName', { name: localizedText(poi.currentName, this.locale) })}
        </p>`;
    }

    /** M27: the layer the place was traced on and its category's data credit, each a line of text; none, nothing. */
    #sources(poi: Poi): TemplateResult {
        const layer = this.layers.find((candidate) => candidate.id === poi.sourceLayer);
        const attribution = this.category?.attribution;
        const lines = [
            ...(layer === undefined ? [] : [translate(this.locale, 'poi.sourceLayer', { layer: localized(layer.label, this.locale) })]),
            ...(attribution === undefined ? [] : [translate(this.locale, 'layers.attribution', { attribution })]),
        ];
        if (lines.length === 0) {
            return EMPTY;
        }
        return html`<section class="sources">
            <h3>${translate(this.locale, 'poi.sources')}</h3>
            <ul>
                ${lines.map((line) => html`<li>${line}</li>`)}
            </ul>
        </section>`;
    }

    #links(poi: Poi): TemplateResult {
        if (poi.links.length === 0) {
            return EMPTY;
        }
        return html`<section>
            <h3>${translate(this.locale, 'poi.links')}</h3>
            <ul>
                ${poi.links.map((link) => html`<li>${externalLink(link.url, link.label)}</li>`)}
            </ul>
        </section>`;
    }

    /** M17 §12: the place's media by kind; nothing when it has none. */
    #media(poi: Poi): TemplateResult {
        const media = placeMedia(poi, { layers: this.layers, photos: this.photos });
        const kinds = placeMediaKinds(media);
        const first = kinds[0];
        if (first === undefined) {
            return EMPTY;
        }
        const kind = this.mediaKind !== null && kinds.includes(this.mediaKind) ? this.mediaKind : first;
        return html`<section class="media">
            <h3>${translate(this.locale, 'poi.media')}</h3>
            ${this.#kinds(kinds, kind)} ${this.#items(media, kind)}
        </section>`;
    }

    #kinds(kinds: readonly PlaceMediaKind[], chosen: PlaceMediaKind): TemplateResult {
        // The kit's segmented button: a bare radio drew no border a visitor could see and was a 13 px target (the tour).
        const options = kinds.map((kind) => ({ value: kind, label: translate(this.locale, `poi.media.${kind}`) }));
        const choose = (event: CustomEvent<{ value: PlaceMediaKind }>): void => {
            this.mediaKind = event.detail.value;
        };
        return html`<hcm-segmented-button
            class="kinds"
            .options=${options}
            .value=${chosen}
            .label=${translate(this.locale, 'poi.media')}
            @hcm-change=${choose}
        ></hcm-segmented-button>`;
    }

    #items(media: PlaceMedia, kind: PlaceMediaKind): TemplateResult {
        if (kind === 'plans') {
            return planItems({
                levels: media.plans,
                chosen: this.planLevel,
                locale: this.locale,
                choose: (order) => {
                    this.planLevel = order;
                },
                plan: (layer) => this.#map(layer),
                photo: (photo) => this.#thumb(photo),
            });
        }
        if (kind === 'maps') {
            return html`<ul class="maps">
                ${media.maps.map((layer) => this.#map(layer))}
            </ul>`;
        }
        return html`<ul class="thumbs">
            ${media[kind].map((photo) => this.#thumb(photo))}
        </ul>`;
    }

    #map(layer: Layer): TemplateResult {
        const title = localized(layer.label, this.locale);
        const show = (): void => {
            this.dispatchEvent(layerShowEvent(layer.id));
        };
        return html`<li>
            <button type="button" aria-label=${translate(this.locale, 'poi.openMap', { title })} @click=${show}>
                <hcm-icon name="map"></hcm-icon><span>${title} · ${String(layer.year)}</span>
            </button>
        </li>`;
    }

    #thumb(photo: Photo | UnplacedPhoto): TemplateResult {
        const title = localizedText(photo.title, this.locale);
        const src = resolveAssetUrl(photo.image.thumb, this.manifestUrl, document.baseURI) ?? '';
        const select = (): void => {
            this.dispatchEvent(photoSelectEvent(photo.id));
        };
        return html`<li>
            <button type="button" aria-label=${translate(this.locale, 'poi.openPhoto', { title })} @click=${select}>
                <img src=${src} alt="" loading="lazy" decoding="async" />
            </button>
        </li>`;
    }
}

/** Registers `<hcm-poi-detail>` once; calling it again is a no-op. */
export function defineHcmPoiDetail(registry: CustomElementRegistry = customElements): void {
    if (registry.get(HCM_POI_DETAIL_TAG) === undefined) {
        registry.define(HCM_POI_DETAIL_TAG, HcmPoiDetail);
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-poi-detail': HcmPoiDetail;
    }
}
