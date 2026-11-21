/**
 * What the viewer's controls do to the store: closing a sheet, opening a photo, the FAB menu's actions (sheets, share,
 * Show my location, `my-location.ts`) and Settings. Plain functions over `ViewerStorePort` and `ViewerServices`, so each is tested without
 * the element.
 */
import { localized, type Layer, type Manifest, type ViewerLocale } from '@hcm/shared';

import { layoutFor } from './layout.js';
import { toggleMyLocation } from './my-location.js';
import { shareMessage, sharePage, type ViewerServices } from './services.js';
import type { ViewerState, ViewerStorePort } from './store-port.js';
import { localizedText } from './text.js';

/** The FAB menu's actions (`settings`: the language and the theme, out of About since 2026-11-08). */
const MENU_ACTIONS = ['layers', 'photos', 'unplaced', 'stories', 'locate', 'share', 'contribute', 'about', 'settings'] as const;

export type MenuAction = (typeof MENU_ACTIONS)[number];

export function isMenuAction(value: string): value is MenuAction {
    return (MENU_ACTIONS as readonly string[]).includes(value);
}

/** Closes whatever sheet is open: a photo's or a POI's details close their selection too. */
export function closeSheet(store: ViewerStorePort): void {
    const sheet = store.getState().sheet;
    if (sheet === 'photo') {
        store.openPhoto(null);
        return;
    }
    if (sheet === 'poi') {
        store.openPoi(null);
        return;
    }
    store.openSheet('none');
}

/** Opens a photo; the lightbox stays open when it was (its arrows step through the photos). */
export function selectPhoto(store: ViewerStorePort, photoId: string): void {
    const lightbox = store.getState().lightbox;
    store.openPhoto(photoId);
    if (lightbox) {
        store.setLightbox(true);
    }
}

/** Switches the store to `locale` unless it already shows it (the element's `lang` attribute follows the store). */
export function syncLocale(store: ViewerStorePort, locale: ViewerLocale): void {
    if (store.getState().locale !== locale) {
        store.setLocale(locale);
    }
}

/** The title a share uses: the open photo's title, else the city's name in `locale` (nothing before the manifest). */
export function shareTitle(manifest: Manifest | null, state: Pick<ViewerState, 'selectedPhotoId'>, locale: ViewerLocale): string {
    if (manifest === null) {
        return '';
    }
    const photo = manifest.photos.find((candidate) => candidate.id === state.selectedPhotoId);
    return photo === undefined ? localized(manifest.city.name, locale) : localizedText(photo.title, locale);
}

/**
 * Shares the page (the hash carries the view) and says "copied" or "failed" when the clipboard was used; a page that
 * was shared or copied is logged as the `share` event (dropped by telemetry without consent).
 */
export async function shareViewer(store: ViewerStorePort, services: ViewerServices): Promise<void> {
    const state = store.getState();
    const outcome = await sharePage(services, shareTitle(state.manifest, state, state.locale));
    if (outcome === 'shared' || outcome === 'copied') {
        store.logShare();
    }
    const message = shareMessage(outcome);
    if (message !== null) {
        store.showToast(message);
    }
}

/** The newest of `layers`, or null without any. */
function newestLayer(layers: readonly Pick<Layer, 'id' | 'year'>[]): string | null {
    const [newest] = [...layers].sort((a, b) => b.year - a.year);
    return newest === undefined ? null : newest.id;
}

/** The side the Layers panel's Compare opens with (V06): today while the map shows a historical layer, else the newest layer. */
export function defaultCompareLayer(state: Pick<ViewerState, 'overlays' | 'manifest'>): string | null {
    const shown = state.overlays.some((overlay) => overlay.kind === 'raster' && overlay.visible);
    return shown ? null : newestLayer(state.manifest?.layers ?? []);
}

/**
 * The Layers panel's Compare button: opens compare (a modal Layers sheet closes, so the map shows both sides) or, while
 * the visitor compares, closes it.
 */
export function toggleCompare(store: ViewerStorePort): void {
    const state = store.getState();
    if (state.compare !== null) {
        store.closeCompare();
        return;
    }
    store.openCompare(defaultCompareLayer(state));
    if (state.sheet === 'layers' && layoutFor(state.windowClass, state.compactHeight, state.dockable).sheetMode !== 'docked') {
        store.openSheet('none');
    }
}

/** One FAB menu choice. */
export function menuAction(store: ViewerStorePort, services: ViewerServices, action: MenuAction): void {
    const actions: Readonly<Record<MenuAction, () => void>> = {
        layers: () => {
            store.openSheet('layers');
        },
        photos: () => {
            store.openSheet('photos');
        },
        unplaced: () => {
            store.openSheet('unplaced');
        },
        stories: () => {
            store.openStory(null);
        },
        contribute: () => {
            const { manifest, locale } = store.getState();
            const url = manifest?.contributeUrl;
            if (url !== undefined) {
                // M13 §3: the Contribute page's signed-out welcome speaks the map's language and names the city.
                services.openPage(
                    url.replace(
                        '#',
                        `?lang=${locale}&name=${encodeURIComponent(manifest === null ? '' : localized(manifest.city.name, locale))}#`,
                    ),
                );
            }
        },
        about: () => {
            store.openSheet('about');
        },
        share: () => {
            void shareViewer(store, services);
        },
        locate: () => {
            toggleMyLocation(store, services);
        },
        settings: () => {
            store.openSheet('settings');
        },
    };
    actions[action]();
}
