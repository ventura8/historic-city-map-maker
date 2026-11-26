/**
 * The full-size view in the viewer's modal layer (V08): `<hcm-lightbox>`, which the engine side-loads the first time it
 * opens (`extras-loader.ts`); until then the tag is an unknown element that keeps the properties set on it. The map's
 * menu (V62) is side-loaded the same way, the first time it opens.
 */
import type { ViewerLocale, Photo, PhotoView } from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

import type { MenuPoint } from './map-menu-trigger.js';
import type { ViewerState } from './store-port.js';
import { photosNearYear, type TimelineStop } from './timeline-model.js';

/** The map's menu's events (V62). */
export interface MapMenuHandlers {
    readonly onMapMenuClose: (event: Event) => void;
    readonly onMapMenuCopy: (event: CustomEvent<{ readonly text: string }>) => void;
    /** Share a link to this view: the page's address, as the menu's Share. */
    readonly onMapMenuShare: (event: Event) => void;
}

/** The map's menu over the map (side-loaded with the full-size view; closed while `point` is null). */
export function mapMenu(
    view: { readonly locale: ViewerLocale; readonly mapMenu: MenuPoint | null },
    state: ViewerState,
    handlers: MapMenuHandlers,
): TemplateResult {
    return html`<hcm-map-menu
        .point=${view.mapMenu}
        .view=${state.view}
        .locale=${view.locale}
        @hcm-close=${handlers.onMapMenuClose}
        @hcm-map-menu-copy=${handlers.onMapMenuCopy}
        @hcm-map-menu-share=${handlers.onMapMenuShare}
    ></hcm-map-menu>`;
}

/** The full-size view's events, as the viewer handles them. */
export interface LightboxHandlers {
    readonly onPhotoSelect: (event: CustomEvent<{ readonly photoId: string }>) => void;
    /** `hcm-photo-version` of the sheet and the lightbox: the version the visitor picked. */
    readonly onPhotoVersion: (event: CustomEvent<{ readonly view: PhotoView }>) => void;
    readonly onLightboxClose: (event: Event) => void;
}

/**
 * The list the full-size view counts and pages through: the one it was opened from, the photo list's (the photos near the
 * year, all of them at "today"), which the map's markers show too. A photo outside it (a link to a photo far from the
 * year) pages through all of them. The Pixel 9 Pro review (P6) found "1 of 57" over a list of 11 photos.
 */
export function lightboxPhotos<P extends Pick<Photo, 'id' | 'year' | 'yearEnd'>>(
    all: readonly P[],
    year: TimelineStop,
    photoId: string | null,
): readonly P[] {
    const near = year === null ? all : photosNearYear(all, year);
    return near.some((photo) => photo.id === photoId) ? near : all;
}

export function lightbox(
    state: ViewerState,
    all: readonly Photo[],
    view: { readonly locale: ViewerLocale; readonly manifestUrl: string },
    handlers: LightboxHandlers,
): TemplateResult {
    return html`<hcm-lightbox
        .open=${state.lightbox && state.selectedPhotoId !== null}
        .photos=${lightboxPhotos(all, state.year, state.selectedPhotoId)}
        .photoId=${state.selectedPhotoId}
        .photoVersion=${state.photoVersion}
        .locale=${view.locale}
        .manifestUrl=${view.manifestUrl}
        @hcm-close=${handlers.onLightboxClose}
        @hcm-photo-select=${handlers.onPhotoSelect}
        @hcm-photo-version=${handlers.onPhotoVersion}
    ></hcm-lightbox>`;
}
