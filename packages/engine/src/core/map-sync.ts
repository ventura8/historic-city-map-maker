/**
 * The map follows the store (docs/research/M1-interfaces.md §6): `render` draws a freshly mounted map from the state,
 * `update` applies what changed between two states. Raster layers in the `middle` slot with their adjustments, the
 * photos (filtered by the timeline), one vector overlay per POI category in the `top` slot; visibility and opacity
 * whenever an overlay changes (the adapter coalesces opacity to one paint per animation frame); a language switch
 * also reaches Mapbox's own labels and the basemap's (`setLocale`). The overlays drawn are `displayedOverlays`: on a
 * compact window, swipe compare's toggle may show the compared side's historical layer instead (M4, V06). The basemap's
 * own labels follow the visitor's choice on either map (`map-labels.ts`, V31), its light the theme (`map-light.ts`, V38).
 * The visitor's position, once known, is a blue dot on either map (V10), Show on map's ring around a photo's place too (V51).
 */
import { findOverlay, PHOTOS_OVERLAY_ID, rasterAdjustmentPaint, type Layer, type Manifest, type Overlay } from '@hcm/shared';
import type { MyLocationFix, ViewerMapPort } from '@hcm/ui/map';

import { drawMapLabels } from './map-labels.js';
import { drawMapLight, mapLight } from './map-light.js';
import { photoFeatures, poiSpecs, rasterSpec } from './map-specs.js';
import { stackOrder } from './stack.js';
import { displayedOverlays, type MyLocationState, type ViewerState } from './state.js';

/** The position to draw: none while off or waiting for the first one. */
function fixOf(state: MyLocationState): MyLocationFix | null {
    return typeof state === 'object' ? state : null;
}

/** Each layer's place in the stack of the overlays the map draws (`stack.ts`). */
function stackOf(state: ViewerState, { layers }: Manifest): (layer: Pick<Layer, 'id' | 'year'>) => number {
    return stackOrder({ layers, overlays: displayedOverlays(state), year: state.year, front: state.front });
}

export class MapSync {
    readonly #map: ViewerMapPort;
    readonly #assetBase: string | undefined;

    /** `assetBase`: the manifest's absolute address, for relative asset URLs (undefined: relative to the page). */
    constructor(map: ViewerMapPort, assetBase: string | undefined) {
        this.#map = map;
        this.#assetBase = assetBase;
    }

    /** Draws everything for `state` on a map that was just mounted. */
    render(state: ViewerState): void {
        const manifest = state.manifest;
        if (manifest === null) {
            return;
        }
        const overlays = displayedOverlays(state);
        const order = stackOf(state, manifest);
        for (const layer of manifest.layers) {
            const spec = rasterSpec(layer, findOverlay(overlays, layer.id), this.#assetBase, state.locale);
            this.#map.addRasterLayer({ ...spec, order: order(layer) }, 'middle');
            this.#map.setLayerPaint(layer.id, rasterAdjustmentPaint(layer.adjustments));
        }
        const photos = findOverlay(state.overlays, PHOTOS_OVERLAY_ID);
        if (photos !== undefined) {
            this.#map.setOverlayVisibility(photos.id, photos.visible);
            this.#map.setOverlayOpacity(photos.id, photos.opacity);
        }
        this.#features(manifest, state);
        drawMapLabels(this.#map, state.mapLabels.shown, manifest.city.basemap.config);
        drawMapLight(this.#map, mapLight(state));
        this.#map.setMyLocation(fixOf(state.myLocation));
        if (state.photoMark !== null) {
            this.#map.markPhoto(state.photoMark);
        }
    }

    /** Applies the difference between `previous` and `next` (same manifest). */
    update(previous: ViewerState, next: ViewerState): void {
        const manifest = next.manifest;
        if (manifest === null || manifest !== previous.manifest) {
            return;
        }
        this.#overlays(displayedOverlays(previous), displayedOverlays(next));
        this.#stack(previous, next, manifest);
        this.#yearAndLanguage(previous, next, manifest);
        if (next.mapLabels.shown !== previous.mapLabels.shown) {
            drawMapLabels(this.#map, next.mapLabels.shown, manifest.city.basemap.config);
        }
        this.#light(previous, next);
        this.#places(previous, next);
    }

    /** V15: a layer whose place in the stack changed (the timeline's layer to the front) moves there, its tiles kept. */
    #stack(previous: ViewerState, next: ViewerState, manifest: Manifest): void {
        const before = stackOf(previous, manifest);
        const after = stackOf(next, manifest);
        for (const layer of manifest.layers) {
            if (before(layer) !== after(layer)) {
                this.#map.setLayerOrder(layer.id, after(layer));
            }
        }
    }

    /** The visitor's blue dot and Show on map's ring. */
    #places(previous: ViewerState, next: ViewerState): void {
        if (next.myLocation !== previous.myLocation) {
            this.#map.setMyLocation(fixOf(next.myLocation));
        }
        if (next.photoMark !== previous.photoMark) {
            this.#map.markPhoto(next.photoMark);
        }
    }

    #light(previous: ViewerState, next: ViewerState): void {
        const light = mapLight(next);
        if (light !== mapLight(previous)) {
            drawMapLight(this.#map, light);
        }
    }

    /** A new year or language redraws the photos and POIs; a new language also relabels Mapbox's own controls. */
    #yearAndLanguage(previous: ViewerState, next: ViewerState, manifest: Manifest): void {
        if (next.locale !== previous.locale) {
            this.#map.setLocale(next.locale);
            this.#features(manifest, next);
        } else if (next.year !== previous.year) {
            this.#features(manifest, next);
        }
    }

    #overlays(previous: readonly Overlay[], next: readonly Overlay[]): void {
        if (previous === next) {
            return;
        }
        for (const overlay of next) {
            this.#overlay(findOverlay(previous, overlay.id), overlay);
        }
    }

    #overlay(before: Overlay | undefined, overlay: Overlay): void {
        if (before?.visible !== overlay.visible) {
            this.#map.setOverlayVisibility(overlay.id, overlay.visible);
        }
        if (before?.opacity !== overlay.opacity) {
            this.#map.setOverlayOpacity(overlay.id, overlay.opacity);
        }
    }

    /** The photo markers and the POIs of the current stop, titles in the current language. */
    #features(manifest: Manifest, state: ViewerState): void {
        this.#map.setPhotosData(photoFeatures(manifest.photos, state.locale, state.year));
        for (const spec of poiSpecs(manifest, state.overlays, state.locale, state.year)) {
            this.#map.addVectorOverlay(spec, 'top');
        }
    }
}
