import { FIRESTORE_PATHS, layerDocSchema, MAX_LAYERS, type CityRole } from '@hcm/shared';

import { LiveList } from '../content/list.js';
import { rasterOf } from '../layers/map-session.js';
import type { PhotosServices } from './ports.js';
import type { PhotosState } from './state.js';

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
            changed(items);
        },
    });
}

export function canChooseBackground(role: CityRole | null): boolean {
    return role === 'owner' || role === 'editor';
}
