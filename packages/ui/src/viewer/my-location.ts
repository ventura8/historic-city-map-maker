/**
 * "Show my location" (V10) as a switch: on, the browser watches the visitor's position; the first one inside the city
 * moves the camera there (a jump under reduced motion, as every camera move) and says how accurate it is, and every one
 * moves the blue dot the store draws on each map of the view. It ends when the visitor turns it off, when a position
 * falls outside the city, when the permission is refused, and when the viewer leaves the page or the page is hidden
 * (`<hcm-map-viewer>` calls `stopMyLocation`). The position stays in the page's memory: no storage or telemetry, and the
 * URL hash (so a shared link) keeps the view it had until the visitor moves the camera away from it (`store.flyTo`).
 */
import { bboxContains, type BBox, type MessageKey } from '@hcm/shared';

import { isDenied, type ViewerServices } from './services.js';
import type { MyLocationFix, ViewerStorePort } from './store-port.js';

/** The camera zooms in at least this far on the visitor's position. */
export const LOCATE_ZOOM = 16;

/** The running watch of each store (a viewer's), and the call that stops it. */
const watches = new WeakMap<ViewerStorePort, () => void>();

/** Stops watching and removes the dot; nothing when it was off. */
export function stopMyLocation(store: ViewerStorePort): void {
    const stop = watches.get(store);
    if (stop !== undefined) {
        watches.delete(store);
        stop();
        store.setMyLocation(null);
    }
}

function end(store: ViewerStorePort, key: MessageKey): void {
    stopMyLocation(store);
    store.showToast(key);
}

/** A new position: outside the city it ends; the first one also brings the camera and says how accurate it is. */
function follow(store: ViewerStorePort, bounds: BBox, fix: MyLocationFix): void {
    if (!bboxContains(bounds, fix.center)) {
        end(store, 'error.geolocate.outside');
        return;
    }
    const first = store.getState().myLocation === 'waiting';
    store.setMyLocation(fix);
    if (first) {
        const view = store.getState().view;
        store.flyTo({ ...view, center: fix.center, zoom: Math.max(view.zoom, LOCATE_ZOOM) });
        store.showToast('geolocate.shown', { meters: String(Math.round(fix.accuracy)) });
    }
}

/** A refusal ends it; a position that is late or lost while one is shown keeps the last one (the browser tries again). */
function failed(store: ViewerStorePort, error: unknown): void {
    const denied = isDenied(error);
    if (denied || store.getState().myLocation === 'waiting') {
        end(store, denied ? 'error.geolocate.denied' : 'error.geolocate.unavailable');
    }
}

/** The menu's Show my location: turns it on (no city yet: unavailable), or off with nothing said. */
export function toggleMyLocation(store: ViewerStorePort, services: ViewerServices): void {
    if (watches.has(store)) {
        stopMyLocation(store);
        store.dismissToast();
        return;
    }
    const bounds = store.getState().manifest?.city.bounds;
    if (bounds === undefined) {
        store.showToast('error.geolocate.unavailable');
        return;
    }
    store.showToast('geolocate.locating');
    store.setMyLocation('waiting');
    const stop = services.watchPosition(
        (fix) => {
            follow(store, bounds, fix);
        },
        (error) => {
            failed(store, error);
        },
    );
    watches.set(store, stop);
}
