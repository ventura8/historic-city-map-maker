/**
 * `<hcm-photo-list>`: photos as a list of buttons (thumbnail, title, date). It is the viewer without a map (no WebGL,
 * scenario S-V02-BAD-NO-WEBGL) and the "photos near this year" sheet (V04). A choice fires `hcm-photo-select`. M3 list
 * items: the title in body-large, the date as supporting text in body-medium (14 px; the M1 UX review found the
 * 12 px body-small too small to read on a phone).
 */
import { DEFAULT_LOCALE, photoKindOf, translate, type ViewerLocale, type Photo, type PhotoKind } from '@hcm/shared';
import { LitElement, css, html, type TemplateResult } from 'lit';
import { repeat } from 'lit/directives/repeat.js';

import { visuallyHidden } from '../components/styles.js';
import { resolveAssetUrl } from './services.js';
import { baseStyles } from './shared-styles.js';
import { localizedText, photoCountText, photoDateText } from './text.js';

export const HCM_PHOTO_LIST_TAG = 'hcm-photo-list';

/** Which photos the list shows (the owner, 2026-11-16): every kind, street photos or aerial photos. */
export type PhotoKindFilter = 'all' | PhotoKind;

const KIND_FILTERS: readonly PhotoKindFilter[] = ['all', 'ground', 'aerial'];

/** The photos of `photos` that `filter` keeps. */
export function photosOfKind(photos: readonly Photo[], filter: PhotoKindFilter): readonly Photo[] {
    return filter === 'all' ? photos : photos.filter((photo) => photoKindOf(photo) === filter);
}

/** The rows whose thumbnails load at once. */
const EAGER_ROWS = 12;

export class HcmPhotoList extends LitElement {
    static override readonly properties = {
        photos: { attribute: false },
        locale: { type: String },
        manifestUrl: { type: String, attribute: 'manifest-url' },
        restoreScroll: { attribute: false },
        kindFilter: { state: true },
    };

    static override readonly styles = [
        baseStyles,
        visuallyHidden,
        css`
            :host {
                display: block;
            }

            .kinds {
                display: flex;
                flex-wrap: wrap;
                gap: 8px;
                margin: 0 0 8px;
                padding: 0;
                border: 0;
            }

            .kinds label {
                display: inline-flex;
                align-items: center;
                gap: 4px;
                min-block-size: 48px;
                padding-inline: 12px;
                border: 1px solid var(--md-sys-color-outline);
                border-radius: var(--md-sys-shape-corner-small);
                cursor: pointer;
            }

            .kinds label:has(input:checked) {
                background: var(--md-sys-color-secondary-container);
                color: var(--md-sys-color-on-secondary-container);
            }

            .count {
                margin-block-end: 8px;
                color: var(--md-sys-color-on-surface-variant);
            }

            button {
                display: grid;
                grid-template-columns: 56px 1fr;
                align-items: center;
                column-gap: 16px;
                inline-size: 100%;
                min-block-size: 72px;
                padding-block: 8px;
                padding-inline: 8px 16px;
                border: 0;
                border-radius: var(--md-sys-shape-corner-medium);
                background: transparent;
                color: inherit;
                font: inherit;
                text-align: start;
                cursor: pointer;
            }

            button:hover {
                background: var(--md-sys-color-surface-container-high);
            }

            img {
                grid-row: span 2;
                inline-size: 56px;
                block-size: 56px;
                border-radius: var(--md-sys-shape-corner-small);
                object-fit: cover;
                background: var(--md-sys-color-surface-container-highest);
            }

            .title {
                overflow-wrap: anywhere;
                font-size: var(--md-sys-typescale-body-large-size);
                line-height: var(--md-sys-typescale-body-large-line-height);
            }

            .date {
                font-size: var(--md-sys-typescale-body-medium-size);
                line-height: var(--md-sys-typescale-body-medium-line-height);
                letter-spacing: var(--md-sys-typescale-body-medium-tracking);
                color: var(--md-sys-color-on-surface-variant);
                overflow-wrap: anywhere;
            }
        `,
    ];

    declare photos: readonly Photo[];
    declare locale: ViewerLocale;
    declare manifestUrl: string;
    /** V75: back from a photo opened here, the list scrolls to where it was. */
    declare restoreScroll: number;
    /** Street, aerial or both; the choice shows only when the city has aerial photos. */
    declare kindFilter: PhotoKindFilter;

    constructor() {
        super();
        this.photos = [];
        this.locale = DEFAULT_LOCALE;
        this.manifestUrl = '';
        this.restoreScroll = 0;
        this.kindFilter = 'all';
    }

    protected override firstUpdated(): void {
        const top = this.restoreScroll;
        if (top > 0) {
            requestAnimationFrame(() => {
                const scroller = scrollerOf(this);
                if (scroller !== null) {
                    scroller.scrollTop = top;
                }
            });
        }
    }

    override render(): TemplateResult {
        const shown = photosOfKind(this.photos, this.kindFilter);
        return html`${this.#kinds()}
            <p class="count" role="status">${photoCountText(shown.length, this.locale)}</p>
            <ul aria-label=${translate(this.locale, 'photos.list')}>
                ${repeat(
                    shown,
                    (photo) => photo.id,
                    (photo, index) => this.#item(photo, index),
                )}
            </ul>`;
    }

    /** The Street / Aerial choice, only when some photo is aerial (a city of street photos sees no change). */
    #kinds(): TemplateResult {
        if (!this.photos.some((photo) => photoKindOf(photo) === 'aerial')) {
            return html``;
        }
        const choose = (filter: PhotoKindFilter): void => {
            this.kindFilter = filter;
        };
        return html`<fieldset class="kinds">
            <legend class="visually-hidden">${translate(this.locale, 'photos.filter')}</legend>
            ${KIND_FILTERS.map(
                (filter) =>
                    html`<label
                        ><input
                            type="radio"
                            name="kind"
                            .checked=${this.kindFilter === filter}
                            @change=${() => {
                                choose(filter);
                            }}
                        />${translate(this.locale, `photos.filter.${filter}`)}</label
                    >`,
            )}
        </fieldset>`;
    }

    /**
     * M18 item 8: the first rows load at once (`EAGER_ROWS`): without a map this list is the whole page, and lazy thumbnails
     * in its scrolling box were seen still empty on the public map; the rows below load as they near the screen.
     */
    #item(photo: Photo, index: number): TemplateResult {
        const select = (): void => {
            const scroll = scrollerOf(this)?.scrollTop ?? 0;
            this.dispatchEvent(
                new CustomEvent('hcm-photo-select', { bubbles: true, composed: true, detail: { photoId: photo.id, scroll } }),
            );
        };
        const src = resolveAssetUrl(photo.image.thumb, this.manifestUrl, document.baseURI) ?? '';
        return html`<li>
            <button type="button" @click=${select}>
                <img src=${src} alt="" loading=${index < EAGER_ROWS ? 'eager' : 'lazy'} decoding="async" />
                <span class="title">${localizedText(photo.title, this.locale)}</span>
                <span class="date">${dateLine(photo, this.locale)}</span>
            </button>
        </li>`;
    }
}

/** The supporting line: the date, after "Aerial photo" for a photo taken from above. */
function dateLine(photo: Photo, locale: ViewerLocale): string {
    const date = photoDateText(photo, locale);
    if (photoKindOf(photo) !== 'aerial') {
        return date;
    }
    return `${translate(locale, 'photos.kind.aerial')} · ${date}`;
}

/** The element's parent across slots and shadow roots (null at the document). */
function parentOf(node: Element): Element | null {
    const root = node.getRootNode();
    return node.assignedSlot ?? node.parentElement ?? (root instanceof ShadowRoot ? root.host : null);
}

/** The box that scrolls the list: the nearest ancestor (slots and shadow roots crossed) that scrolls vertically. */
function scrollerOf(start: Element): Element | null {
    let node = parentOf(start);
    while (node !== null && !/auto|scroll/.test(getComputedStyle(node).overflowY)) {
        node = parentOf(node);
    }
    return node;
}

/** Registers `<hcm-photo-list>` once; calling it again is a no-op. */
export function defineHcmPhotoList(registry: CustomElementRegistry = customElements): void {
    if (registry.get(HCM_PHOTO_LIST_TAG) === undefined) {
        registry.define(HCM_PHOTO_LIST_TAG, HcmPhotoList);
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-photo-list': HcmPhotoList;
    }
}
