/**
 * The event handlers of `<hcm-map-viewer>`: each maps one viewer-internal event of a part (or a ui-kit event that
 * bubbles out of one) to a store action. `act` stops the event first, so none of them leaves the viewer: the page
 * sees only the public events of docs/ENGINE_API.md.
 */
import type { MenuPoint } from './map-menu-trigger.js';
import { PhotoReturn } from './photo-return.js';
import type { ViewerServices } from './services.js';
import type { ViewerStorePort } from './store-port.js';
import { closeSheet, isMenuAction, menuAction, selectPhoto, shareViewer, toggleCompare } from './viewer-actions.js';
import type { OverlayOpacityDetail, ViewerHandlers } from './viewer-render.js';
import { toggleMyLocation } from './my-location.js';
import { frontShotDirection } from './shot-direction.js';
import { viewForLayer, viewForYear } from './year-view.js';

/** What the handlers need from the element. */
export interface HandlerHost {
    /** Stops `event` (when given) and runs `action` on the attached store, if any. */
    act(event: Event | null, action: (store: ViewerStorePort) => void): void;
    /** A slider moved (live) or was released (`final`). */
    setOpacity(store: ViewerStorePort, detail: OverlayOpacityDetail): void;
    services(): ViewerServices;
    focusTimeline(): void;
    /** Opens the map's menu at a point, or closes it (null). */
    mapMenu(point: MenuPoint | null): void;
    /** V75: a photo opened from the list goes back to it (absent: the page's own history). */
    readonly photoReturn?: PhotoReturn;
}

/** The list's scroll a `hcm-photo-select` of `<hcm-photo-list>` carries (0 from anywhere else). */
function scrollOf(detail: object): number {
    const scroll: unknown = Reflect.get(detail, 'scroll');
    return typeof scroll === 'number' ? scroll : 0;
}

/** A handler that stops its event and runs `action` on the store. */
type On = <E extends Event>(action: (store: ViewerStorePort, event: E) => void) => (event: E) => void;

function actingOn(host: HandlerHost): On {
    return (action) => (event) => {
        host.act(event, (store) => {
            action(store, event);
        });
    };
}

/** The Layers panel's Map labels and its rail, the help panel's switch, and About's buttons to the help and licence panels. */
function inputHandlers(
    on: On,
): Pick<ViewerHandlers, 'onMapLabel' | 'onPhotosNear' | 'onLayersMinimize' | 'onShortcuts' | 'onHelpOpen' | 'onLicenceOpen'> {
    return {
        onMapLabel: on((store, event) => {
            store.setMapLabels({ [event.detail.kind]: event.detail.visible });
        }),
        onPhotosNear: on((store, event) => {
            store.setPhotosNear(event.detail.near);
        }),
        onLayersMinimize: on((store, event) => {
            store.setLayersHidden(event.detail.minimized);
        }),
        onShortcuts: on((store, event) => {
            store.setShortcuts(event.detail.enabled);
        }),
        onHelpOpen: on((store) => {
            store.openSheet('help');
        }),
        onLicenceOpen: on((store) => {
            store.openSheet('licence');
        }),
    };
}

/** A photo to open, to show on the map (V51) or full size, and its thumbnail on screen. */
type PhotoHandlers = Pick<
    ViewerHandlers,
    | 'photoReturn'
    | 'onDateShow'
    | 'onSheetClose'
    | 'onPhotoSelect'
    | 'onPhotoLocate'
    | 'onLightboxOpen'
    | 'onPhotoShown'
    | 'onPhotoVersion'
    | 'onLightboxClose'
>;

function photoHandlers(on: On, host: HandlerHost): PhotoHandlers {
    const photoReturn =
        host.photoReturn ??
        new PhotoReturn(window, (action) => {
            host.act(null, action);
        });
    return {
        photoReturn,
        onSheetClose: on((store) => {
            if (!photoReturn.back(store)) {
                closeSheet(store);
            }
        }),
        onPhotoSelect: on((store, event) => {
            photoReturn.opened(store.getState().sheet, scrollOf(event.detail));
            selectPhoto(store, event.detail.photoId);
        }),
        onPhotoLocate: on((store, event) => {
            store.locatePhoto(event.detail.photoId, event.detail.offset);
        }),
        onLightboxOpen: on((store) => {
            store.setLightbox(true);
        }),
        onDateShow: on((store, event) => {
            store.toggleOverlay(event.detail.layerId, event.detail.visible);
        }),
        onPhotoShown: on((store, event) => {
            store.photoShown?.(event.detail.ok);
        }),
        onPhotoVersion: on((store, event) => {
            store.setPhotoVersion(event.detail.view);
        }),
        onLightboxClose: on((store) => {
            store.setLightbox(false);
        }),
    };
}

/** M17 §12: a place's map from its Media, switched on, brought to the front, its year on the timeline and fitted. */
function showLayer(store: ViewerStorePort, layerId: string): void {
    store.pickLayer(layerId);
    const state = store.getState();
    const layer = state.manifest?.layers.find((candidate) => candidate.id === layerId);
    const target = layer === undefined ? null : viewForLayer(layer, state.view, globalThis.innerWidth);
    if (target !== null) {
        store.flyTo(target);
    }
}

/** M17: a story to open (null: their list), and a place a story names; §12: a place's map to show. */
function storyHandlers(on: On): Pick<ViewerHandlers, 'onStorySelect' | 'onPoiSelect' | 'onLayerShow'> {
    return {
        onLayerShow: on((store, event) => {
            showLayer(store, event.detail.layerId);
        }),
        onStorySelect: on((store, event) => {
            store.openStory(event.detail.storyId);
        }),
        onPoiSelect: on((store, event) => {
            store.openPoi(event.detail.poiId);
        }),
    };
}

/**
 * The map's menu (V62): its close, Copy coordinates through the clipboard service, said by a toast whether it worked or
 * not, and Share a link to this view, the menu's Share (the page's address carries the view).
 */
function mapMenuHandlers(host: HandlerHost): Pick<ViewerHandlers, 'onMapMenuClose' | 'onMapMenuCopy' | 'onMapMenuShare'> {
    const say = (key: 'mapMenu.copied' | 'mapMenu.copyFailed') => (): void => {
        host.act(null, (store) => {
            store.showToast(key);
        });
    };
    return {
        onMapMenuClose: () => {
            host.mapMenu(null);
        },
        onMapMenuCopy: (event) => {
            event.stopPropagation();
            void host.services().copyText(event.detail.text).then(say('mapMenu.copied'), say('mapMenu.copyFailed'));
        },
        onMapMenuShare: (event) => {
            host.act(event, (store) => {
                void shareViewer(store, host.services());
            });
        },
    };
}

/**
 * The zoom buttons (V52): one level in (1) or out (-1); the compass (V64): north up and level. A click is no event of a
 * part, nothing to stop.
 */
function zoomHandler(host: HandlerHost): Pick<ViewerHandlers, 'onZoom' | 'onCompass' | 'onLocate' | 'onShotDirection' | 'onOverlayGroup'> {
    return {
        // A place category's sub-group switch (the owner, 2026-11-22).
        onOverlayGroup: (event) => {
            host.act(event, (store) => {
                store.toggleOverlayGroup(event.detail.id, event.detail.group, event.detail.visible);
            });
        },
        // Show my location (V10): the icon button above the compass (the owner, 2026-11-22).
        onLocate: () => {
            host.act(null, (store) => {
                toggleMyLocation(store, host.services());
            });
        },
        onZoom: (step) => {
            host.act(null, (store) => {
                store.zoomBy(step);
            });
        },
        onCompass: () => {
            host.act(null, (store) => {
                store.resetNorth();
            });
        },
        // V93: the map turned to the shot direction of the image on top (the owner, 2026-11-23).
        onShotDirection: () => {
            host.act(null, (store) => {
                const state = store.getState();
                const shot = frontShotDirection(state.manifest, state);
                if (shot !== null) {
                    store.faceBearing(shot);
                }
            });
        },
    };
}

/** A new year, and the camera to its layers when none covers the view (the owner, 2026-11-22: an empty 1945). */
function setYearInView(store: ViewerStorePort, year: number | null): void {
    store.setYear(year);
    const state = store.getState();
    const target = viewForYear(state.manifest, year, state.view, globalThis.innerWidth);
    if (target !== null) {
        store.flyTo(target);
    }
}

export function createHandlers(host: HandlerHost): ViewerHandlers {
    const on = actingOn(host);
    return {
        onYearChange: on((store, event) => {
            setYearInView(store, event.detail.year);
        }),
        onOverlayVisibility: on((store, event) => {
            store.toggleOverlay(event.detail.id, event.detail.visible);
        }),
        onOverlayOpacity: on((store, event) => {
            host.setOpacity(store, event.detail);
        }),
        ...photoHandlers(on, host),
        onMenuSelect: on((store, event) => {
            const value = event.detail.value;
            if (isMenuAction(value)) {
                menuAction(store, host.services(), value);
            }
        }),
        onLocaleChange: on((store, event) => {
            store.setLocale(event.detail.locale);
        }),
        onThemeChange: on((store, event) => {
            const { theme, accent } = event.detail;
            if (theme !== undefined) {
                store.setTheme(theme);
            }
            if (accent !== undefined) {
                store.setAccent(accent);
            }
        }),
        onConsent: on((store, event) => {
            store.setConsent(event.detail.decision);
        }),
        onRetry: on((store) => {
            void store.retry();
        }),
        onCompareToggle: on(toggleCompare),
        ...zoomHandler(host),
        ...mapMenuHandlers(host),
        onToastDismiss: on((store) => {
            store.dismissToast();
        }),
        ...inputHandlers(on),
        ...storyHandlers(on),
        onSkip: () => {
            host.focusTimeline();
        },
        onNearYear: () => {
            host.act(null, (store) => {
                store.openSheet('photos');
            });
        },
        onDatePick: on((store, event) => {
            // The menu stays open, as the opacity panel does: only a press outside, Esc or the pill closes it.
            store.pickLayer(event.detail.layerId);
        }),
    };
}
