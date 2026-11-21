/**
 * Registers every viewer element once (idempotent per registry). The ui-kit elements the viewer renders (`hcm-sheet`,
 * `hcm-dialog`, `hcm-overlay-list`, `hcm-fab-menu`, `hcm-consent-banner`, ...) are registered by the kit's own
 * `defineUiKit`; the engine's `defineElements` calls both. `<hcm-lightbox>`, About and the map's menu are not among them:
 * the engine side-loads them the first time one opens (`extras-loader.ts`).
 */
import { defineHcmCompass, HCM_COMPASS_TAG } from './hcm-compass.js';
import { defineHcmDateMenu, HCM_DATE_MENU_TAG } from './hcm-date-menu.js';
import { defineHcmErrorCard, HCM_ERROR_CARD_TAG } from './hcm-error-card.js';
import { defineHcmLayerPanel, HCM_LAYER_PANEL_TAG } from './hcm-layer-panel.js';
import { defineHcmMapViewer, HCM_MAP_VIEWER_TAG } from './hcm-map-viewer.js';
import { defineHcmPhotosControl, HCM_PHOTOS_CONTROL_TAG } from './hcm-photos-control.js';
import { defineHcmPhotoList, HCM_PHOTO_LIST_TAG } from './hcm-photo-list.js';
import { defineHcmPhotoSheet, HCM_PHOTO_SHEET_TAG } from './hcm-photo-sheet.js';
import { defineHcmUnplacedGallery, HCM_UNPLACED_GALLERY_TAG } from './hcm-unplaced-gallery.js';
import { defineHcmPoiDetail, HCM_POI_DETAIL_TAG } from './hcm-poi-detail.js';
import { defineHcmStories, HCM_STORIES_TAG } from './hcm-stories.js';
import { defineHcmTimeline, HCM_TIMELINE_TAG } from './hcm-timeline.js';

/** Every tag the viewer defines (the kit's tags are listed by the kit). */
export const VIEWER_TAGS = [
    HCM_MAP_VIEWER_TAG,
    HCM_TIMELINE_TAG,
    HCM_LAYER_PANEL_TAG,
    HCM_PHOTO_SHEET_TAG,
    HCM_POI_DETAIL_TAG,
    HCM_PHOTO_LIST_TAG,
    HCM_UNPLACED_GALLERY_TAG,
    HCM_STORIES_TAG,
    HCM_ERROR_CARD_TAG,
    HCM_COMPASS_TAG,
    HCM_DATE_MENU_TAG,
    HCM_PHOTOS_CONTROL_TAG,
] as const;

const DEFINERS: readonly ((registry: CustomElementRegistry) => void)[] = [
    defineHcmMapViewer,
    defineHcmTimeline,
    defineHcmLayerPanel,
    defineHcmPhotoSheet,
    defineHcmPoiDetail,
    defineHcmPhotoList,
    defineHcmUnplacedGallery,
    defineHcmStories,
    defineHcmErrorCard,
    defineHcmCompass,
    defineHcmDateMenu,
    defineHcmPhotosControl,
];

/** Registers the viewer elements in `registry`; calling it again is a no-op. */
export function defineViewerElements(registry: CustomElementRegistry = customElements): void {
    for (const define of DEFINERS) {
        define(registry);
    }
}
