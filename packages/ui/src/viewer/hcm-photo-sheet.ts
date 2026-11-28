/**
 * `<hcm-photo-sheet>`: the detail sheet for a photo or a POI (docs/research/M1-interfaces.md §5.2; scenarios V07,
 * V24): a modal bottom sheet on compact, a modal side sheet on medium and compact height, a docked standard side
 * sheet from expanded. A photo shows its lazy WebP thumbnail (a button that opens the lightbox), its date, author,
 * licence, rights note, source link, description and links, all rendered as text and anchors; a POI renders `<hcm-poi-detail>`.
 * A missing image shows a placeholder that keeps the photo's title as its accessible name (S-V07-BAD-IMAGE404). Below the
 * image, while there is a map (`canLocate`), "Show on map" fires `hcm-photo-locate` (`{ photoId, offset }`): the viewer
 * brings the camera to the photo's place, `offset` px from the map's centre so that a modal sheet does not cover it (V51).
 * Once the thumbnail is decoded (or failed) the sheet fires `hcm-photo-shown` (`{ ok }`), which the viewer turns into
 * the `photo_timing` field measurement (docs/ARCHITECTURE.md → *Field measurements*). A photo with an improved or a
 * colorized version shows the version `photoVersion` picks and a switch between them (`photo-version.ts`), which fires
 * `hcm-photo-version` (`{ view }`). "Open in Google Street View" is a plain link to the photo's place, looking along its
 * bearing (V62).
 */
import {
    DEFAULT_LOCALE,
    isPhotoNearYear,
    shownLanguage,
    streetViewUrl,
    translate,
    type Layer,
    type ViewerLocale,
    type Photo,
    type PhotoView,
    type Poi,
    type PoiCategory,
    type Story,
} from '@hcm/shared';
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from 'lit';

import type { CameraOffset } from '../map/mapbox-types.js';
import { EMPTY } from './empty.js';
import type { SheetMode } from './layout.js';
import { relatedStories } from './hcm-stories.js';
import { photoSource } from './photo-source.js';
import { openStreetView } from './street-view-opener.js';
import { externalLink } from './markdown.js';
import { resolveAssetUrl } from './services.js';
import { closeEvent, renderSheetFrame } from './sheet-frame.js';
import { fallbackNote } from './fallback-note.js';
import { baseStyles, detailStyles, sheetStyles } from './shared-styles.js';
import { photoRights } from './photo-rights.js';
import { hasVersions, shownView, versionSwitch, viewCredit, viewImage } from './photo-version.js';
import { localizedText, photoDateText } from './text.js';
import type { TimelineStop } from './timeline-model.js';

export const HCM_PHOTO_SHEET_TAG = 'hcm-photo-sheet';

/**
 * Where Show on map puts the photo's place, in px from the centre of `map` (the box the sheet covers): the middle of what a
 * modal sheet's surface leaves, above a bottom sheet, beside a side sheet on whichever side it is (a right-to-left page puts
 * it on the left); a docked sheet has its own pane (no sheet surface here) and leaves the map whole.
 */
export function locateOffset(mode: SheetMode, sheet: DOMRect | undefined, map: DOMRect | undefined): CameraOffset {
    if (sheet === undefined || map === undefined) {
        return [0, 0];
    }
    if (mode === 'bottom') {
        return [0, (sheet.top - map.bottom) / 2];
    }
    const onTheRight = sheet.left + sheet.right >= map.left + map.right;
    return [onTheRight ? (sheet.left - map.right) / 2 : (sheet.right - map.left) / 2, 0];
}

/**
 * The layer years a photo's date names (the owner 2026-11-09): the first of `stops` its span holds (`match`), else up to three
 * within ten years of it, nearest first (the older on a tie). An undated photo names none.
 */
export function photoMapYears(
    photo: Pick<Photo, 'year' | 'yearEnd'>,
    stops: readonly TimelineStop[],
): { readonly match: number | undefined; readonly near: readonly number[] } {
    const years = stops.filter((stop) => stop !== null);
    const match = years.find((year) => isPhotoNearYear(photo, year, 0));
    // The distance to the span [year, yearEnd] orders as |2y - year - yearEnd| does: the span's length is the same for all.
    const { year: start = 0, yearEnd: end = start } = photo;
    const near = years.filter((year) => match === undefined && isPhotoNearYear(photo, year));
    return { match, near: near.toSorted((a, b) => Math.abs(2 * a - start - end) - Math.abs(2 * b - start - end)).slice(0, 3) };
}

export class HcmPhotoSheet extends LitElement {
    static override readonly properties = {
        photo: { attribute: false },
        poi: { attribute: false },
        category: { attribute: false },
        thumbnail: { attribute: false },
        layers: { attribute: false },
        photos: { attribute: false },
        pois: { attribute: false },
        locale: { type: String },
        mode: { type: String },
        open: { type: Boolean },
        manifestUrl: { type: String, attribute: 'manifest-url' },
        contributeUrl: { attribute: false },
        stories: { attribute: false },
        canLocate: { attribute: false },
        years: { attribute: false },
        photoVersion: { attribute: false },
        backToList: { attribute: false },
        imageFailed: { state: true },
    };

    static override readonly styles = [
        baseStyles,
        sheetStyles,
        detailStyles,
        css`
            :host {
                display: contents;
            }

            .image {
                display: block;
                inline-size: 100%;
                padding: 0;
                border: 0;
                border-radius: var(--md-sys-shape-corner-large);
                overflow: hidden;
                background: var(--md-sys-color-surface-container-highest);
                cursor: zoom-in;
            }

            .image img {
                display: block;
                inline-size: 100%;
                block-size: auto;
            }

            /* V75: Back is the sheet's first control: a full 48 px target, nothing above it to borrow from. */
            .back {
                --hcm-control-size: 48px;
            }

            .placeholder {
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                gap: 8px;
                min-block-size: 160px;
                border-radius: var(--md-sys-shape-corner-large);
                background: var(--md-sys-color-surface-container-highest);
                color: var(--md-sys-color-on-surface-variant);
            }
        `,
    ];

    declare photo: Photo | null;
    declare poi: Poi | null;
    declare category: PoiCategory | null;
    /** M31: a Wikipedia article's free thumbnail (relative to the manifest), or null. */
    declare thumbnail: string | null;
    /** M27: the manifest's layers (a place's `sourceLayer` is named from them). */
    declare layers: readonly Layer[];
    /** Every manifest photo (a POI's linked thumbnails are looked up here). */
    declare photos: readonly Photo[];
    /** M17 §13: the places a place's facts name. */
    declare pois: readonly Poi[];
    declare locale: ViewerLocale;
    /** M13: the city's Contribute page (`manifest.contributeUrl`): a photo's "Suggest a correction" opens it on the photo. */
    declare contributeUrl: string | null;
    /** M17: the city's stories; those naming the photo or the place are listed. */
    declare stories: readonly Story[];
    /** There is a map to show the photo on (none without WebGL: the photo list's sheet has no Locate). */
    declare canLocate: boolean;
    /** The timeline's stops: with a map, the photo's date leads to the map of its layer years (`photoMapYears`). */
    declare years: readonly TimelineStop[];
    /** The version the visitor picked (null: the photo's default, `shownView`). */
    declare photoVersion: PhotoView | null;
    /** V75: the photo was opened from the list: Back returns to it (`hcm-photo-back`). */
    declare backToList: boolean;
    declare mode: SheetMode;
    declare open: boolean;
    declare manifestUrl: string;
    declare imageFailed: boolean;

    constructor() {
        super();
        this.photo = null;
        this.poi = null;
        this.category = null;
        this.thumbnail = null;
        this.layers = [];
        this.photos = [];
        this.pois = [];
        this.locale = DEFAULT_LOCALE;
        this.mode = 'bottom';
        this.open = false;
        this.manifestUrl = '';
        this.contributeUrl = null;
        this.stories = [];
        this.canLocate = false;
        this.years = [];
        this.photoVersion = null;
        this.backToList = false;
        this.imageFailed = false;
    }

    protected override willUpdate(changed: PropertyValues<this>): void {
        if (changed.has('photo') || changed.has('photoVersion')) {
            this.imageFailed = false;
        }
    }

    override render(): TemplateResult {
        const onClose = (): void => {
            this.dispatchEvent(closeEvent());
        };
        const frame = {
            mode: this.mode,
            open: this.open,
            label: this.#title(),
            closeLabel: translate(this.locale, 'action.close'),
            handleLabel: translate(this.locale, 'sheet.resize'),
            onClose,
        };
        return renderSheetFrame(frame, this.#content());
    }

    #title(): string {
        const text = this.poi?.title ?? this.photo?.title;
        return text === undefined ? '' : localizedText(text, this.locale);
    }

    #content(): TemplateResult {
        if (this.poi !== null) {
            return html`<hcm-poi-detail
                    .poi=${this.poi}
                    .category=${this.category}
                    .thumbnail=${this.thumbnail}
                    .layers=${this.layers}
                    .photos=${this.photos}
                    .pois=${this.pois}
                    .locale=${this.locale}
                    .manifestUrl=${this.manifestUrl}
                ></hcm-poi-detail>
                <div class="details">${relatedStories(this.stories, 'poiIds', this.poi.id, this.locale)}</div>`;
        }
        return this.photo === null ? EMPTY : this.#photoDetails(this.photo);
    }

    #photoDetails(photo: Photo): TemplateResult {
        const locale = this.locale;
        return html`<div class="details">
            <hcm-favorite-star row kind="photo" item-id=${photo.id} .locale=${locale}></hcm-favorite-star>
            ${this.#back()} ${this.#image(photo)} ${this.#locate(photo)}
            <p class="link">${openStreetView(streetViewUrl(photo.location, photo.bearing), locale)}</p>
            ${this.#date(photo)} ${photoRights(photo, locale)} ${photoSource(photo, locale)}
            ${
                photo.description === undefined
                    ? nothing
                    : html`<p lang=${shownLanguage(photo.description, locale)}>${localizedText(photo.description, locale)}</p>`
            }
            ${fallbackNote(photo.title, locale)} ${this.#links(photo)} ${this.#suggestion(photo)}
            ${relatedStories(this.stories, 'photoIds', photo.id, this.locale)}
        </div>`;
    }

    /** V75: Back to the photo list, when the photo was opened from it. */
    #back(): TemplateResult {
        if (!this.backToList) {
            return EMPTY;
        }
        const onBack = (): void => {
            this.dispatchEvent(new CustomEvent('hcm-photo-back', { bubbles: true, detail: null }));
        };
        return html`<p>
            <hcm-button variant="tonal" icon="arrow_back" class="back" @click=${onBack}
                >${translate(this.locale, 'photo.backToList')}</hcm-button
            >
        </p>`;
    }

    /** "Show on map": the offset keeps the photo's place in the middle of what a modal sheet leaves of the map. */
    #locate(photo: Photo): TemplateResult {
        if (!this.canLocate) {
            return EMPTY;
        }
        const onLocate = (): void => {
            const frame = this.renderRoot.querySelector('hcm-sheet');
            const offset = locateOffset(this.mode, frame?.sheet()?.getBoundingClientRect(), frame?.getBoundingClientRect());
            this.dispatchEvent(new CustomEvent('hcm-photo-locate', { bubbles: true, detail: { photoId: photo.id, offset } }));
        };
        return html`<p>
            <hcm-button variant="tonal" icon="location_on" @click=${onLocate}>${translate(this.locale, 'photo.locate')}</hcm-button>
        </p>`;
    }

    /** The date; holding a layer's year it is a button to the map of that year, else chips name the near ones (V07). */
    #date(photo: Photo): TemplateResult {
        const date = photoDateText(photo, this.locale);
        const { match, near } = photoMapYears(photo, this.canLocate ? this.years : []);
        if (match !== undefined) {
            return html`<p>${this.#mapYear(match, date, [date, this.#mapOf(match)].join(', '))}</p>`;
        }
        return html`<p class="supporting">${date}</p>
            ${this.#nearYears(near)}`;
    }

    /** Up to three chips of the layer years near the photo's, nearest first, one under another (48 px targets); none: nothing. */
    #nearYears(near: readonly number[]): TemplateResult | typeof nothing {
        return near.length === 0 ? nothing : html`<section>${near.map((year) => this.#mapYear(year, this.#mapOf(year)))}</section>`;
    }

    #mapOf(year: number): string {
        return translate(this.locale, 'photo.mapOf', { year: String(year) });
    }

    /** Shows the map at `year` with its layers; the photo stays open. */
    #mapYear(year: number, text: string, label?: string): TemplateResult {
        const show = (): void => {
            this.dispatchEvent(new CustomEvent('hcm-year-change', { detail: { year } }));
        };
        return html`<hcm-button variant=${label === undefined ? 'outlined' : 'text'} icon="map" .label=${label} @click=${show}
            >${text}</hcm-button
        >`;
    }

    /** M13 §4: contesting the photo is a page of its own, which signs in; the map holds only the link. */
    #suggestion(photo: Photo): TemplateResult {
        if (this.contributeUrl === null) {
            return EMPTY;
        }
        const url = `${this.contributeUrl}/${photo.id}`;
        return html`<p class="link">${externalLink(url, translate(this.locale, 'photo.suggest'))}</p>`;
    }

    #image(photo: Photo): TemplateResult {
        const view = shownView(photo, this.photoVersion);
        const versions = hasVersions(photo) ? versionSwitch(photo, view, this.locale, this) : EMPTY;
        return html`${this.#thumbnail(photo, view)} ${versions} ${viewCredit(photo, view, this.locale)}`;
    }

    #thumbnail(photo: Photo, view: PhotoView): TemplateResult {
        const title = localizedText(photo.title, this.locale);
        const image = viewImage(photo, view);
        const src = resolveAssetUrl(image.thumb, this.manifestUrl, document.baseURI);
        if (this.imageFailed || src === null) {
            return html`<div class="placeholder" role="img" aria-label=${title}>
                <hcm-icon name="broken_image"></hcm-icon>
                <span aria-hidden="true">${translate(this.locale, 'error.photoImage')}</span>
            </div>`;
        }
        const onError = (): void => {
            this.imageFailed = true;
            this.#shown(false);
        };
        const onLoad = (event: Event): void => {
            const shown = (): void => {
                this.#shown(true);
            };
            void (event.currentTarget as HTMLImageElement).decode().then(shown, shown);
        };
        const openLightbox = (): void => {
            this.dispatchEvent(new CustomEvent('hcm-lightbox-open', { bubbles: true, detail: { photoId: photo.id } }));
        };
        return html`<button type="button" class="image" aria-label=${translate(this.locale, 'photo.openLightbox')} @click=${openLightbox}>
            <img
                src=${src}
                alt=${title}
                width=${image.w}
                height=${image.h}
                loading="lazy"
                decoding="async"
                @load=${onLoad}
                @error=${onError}
            />
        </button>`;
    }

    /** The thumbnail is on screen (decoded) or failed: the viewer times the photo's opening. */
    #shown(ok: boolean): void {
        this.dispatchEvent(new CustomEvent('hcm-photo-shown', { bubbles: true, detail: { ok } }));
    }

    #links(photo: Photo): TemplateResult {
        if (photo.links.length === 0) {
            return EMPTY;
        }
        return html`<section>
            <h3>${translate(this.locale, 'photo.links')}</h3>
            <ul>
                ${photo.links.map((link) => html`<li>${externalLink(link.url, link.label)}</li>`)}
            </ul>
        </section>`;
    }
}

/** Registers `<hcm-photo-sheet>` once; calling it again is a no-op. */
export function defineHcmPhotoSheet(registry: CustomElementRegistry = customElements): void {
    if (registry.get(HCM_PHOTO_SHEET_TAG) === undefined) {
        registry.define(HCM_PHOTO_SHEET_TAG, HcmPhotoSheet);
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-photo-sheet': HcmPhotoSheet;
    }
}
