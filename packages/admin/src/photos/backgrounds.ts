import { FIRESTORE_PATHS, layerDocSchema, MAX_LAYERS, type CityRole } from '@hcm/shared';

import type { RasterLayerSpec } from '@hcm/ui/map';

import { LiveList } from '../content/list.js';
import { rasterOf } from '../layers/map-session.js';
import type { PhotosServices } from './ports.js';
import type { PhotosState } from './state.js';

// The dot is outside the city layer id alphabet. This choice exists only in the photo editor.
const CURRENT_SATELLITE: RasterLayerSpec = {
    id: 'mapbox.satellite',
    source: { type: 'mapbox', tilesetId: 'mapbox.satellite' },
    minzoom: 0,
    maxzoom: 22,
    visible: true,
    opacity: 1,
    order: 0,
    attribution: null,
};

/** The city's saved map and imagery layers, including those hidden at startup in the public viewer. */
export function photoBackgrounds(services: PhotosServices, changed: (items: PhotosState['backgrounds']) => void) {
    const { store, clock, denied, cityId } = services;
    return new LiveList({
        store,
        clock,
        denied,
        collection: FIRESTORE_PATHS.layers(cityId),
        schema: layerDocSchema,
        pageSize: MAX_LAYERS,
        map: ({ id, data }) => ({ id, label: data.label, raster: { ...rasterOf(id, data), opacity: 1 } }),
        changed: ({ items }) => {
            changed([{ id: CURRENT_SATELLITE.id, label: null }, ...items]);
        },
    });
}

export function canChooseBackground(role: CityRole | null): boolean {
    return role === 'owner' || role === 'editor';
}

/** Resolve a local photo-placement choice. A removed saved layer falls back to streets. */
export function chosenBackground(
    id: string,
    items: readonly { readonly id: string; readonly raster: RasterLayerSpec }[],
): RasterLayerSpec | null {
    return id === CURRENT_SATELLITE.id ? CURRENT_SATELLITE : (items.find((item) => item.id === id)?.raster ?? null);
}
