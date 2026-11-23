/** The `favorites` sheet (V91): the visitor's saved items, modal or docked as the viewer's other sheets. */
import { translate, type Manifest, type ViewerLocale } from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

import type { Placement } from './layout.js';
import { renderSheetFrame } from './sheet-frame.js';
import type { PlaceHandlers, StoriesHandlers } from './viewer-stories.js';

/** Each kind of favourite opens through the handler that opens it from anywhere else. */
export type FavoritesHandlers = StoriesHandlers & PlaceHandlers;

export function favoritesSheet(
    locale: ViewerLocale,
    manifest: Manifest,
    placement: Placement,
    handlers: FavoritesHandlers,
): TemplateResult {
    const frame = {
        ...placement,
        label: translate(locale, 'favorites.title'),
        closeLabel: translate(locale, 'action.close'),
        handleLabel: translate(locale, 'sheet.resize'),
        onClose: (): void => {
            handlers.onSheetClose(new CustomEvent('hcm-close'));
        },
    };
    return html`<div
        class="favorites-sheet"
        ?inert=${placement.inert === true}
        @hcm-close=${handlers.onSheetClose}
        @hcm-story-select=${handlers.onStorySelect}
        @hcm-photo-select=${handlers.onPhotoSelect}
        @hcm-poi-select=${handlers.onPoiSelect}
        @hcm-layer-show=${(event: CustomEvent<{ readonly layerId: string }>) => {
            // A layer shows on the map: the sheet steps aside so the visitor sees it.
            handlers.onLayerShow(event);
            handlers.onSheetClose(new CustomEvent('hcm-close'));
        }}
    >
        ${renderSheetFrame(frame, html`<hcm-favorites .manifest=${manifest} .locale=${locale}></hcm-favorites>`)}
    </div>`;
}
