// Documents of the layers and settings areas' tests (generated test values), and a recording map preview.
import { FIRESTORE_PATHS, type CityDoc, type LayerDoc, type PoiCategoryDoc, type PhotoDoc, type PoiDoc } from '@hcm/shared';

import type { PreviewChange, PreviewSink, PreviewTarget } from '../../src/layers/preview.js';
import { at, CITY } from '../content/world.js';

const T0 = at('2026-10-01T08:00:00.000Z');

export const LAYER_PATH = (id: string): string => FIRESTORE_PATHS.layer(CITY, id);
export const CATEGORY_PATH = (id: string): string => FIRESTORE_PATHS.poiCategory(CITY, id);
export const CITY_PATH = FIRESTORE_PATHS.city(CITY);

export function layerDoc(overrides: Partial<LayerDoc> = {}): LayerDoc {
    return {
        year: 1968,
        label: { ro: 'Corona 1968' },
        kind: 'satellite',
        source: { type: 'mapbox', tilesetId: 'e2e-user.corona-1968' },
        minzoom: 10,
        maxzoom: 17,
        order: 1,
        opacity: 1,
        defaultVisible: false,
        status: 'ready',
        published: true,
        mapbox: { tilesetId: 'e2e-user.corona-1968' },
        updatedBy: 'system:pipeline',
        updatedAt: T0,
        ...overrides,
    };
}

export function cityDoc(overrides: Partial<CityDoc> = {}): CityDoc {
    return {
        name: { ro: 'București', en: 'Bucharest' },
        bounds: { west: 25.9, south: 44.3, east: 26.3, north: 44.6 },
        center: { lat: 44.43, lng: 26.1 },
        zoom: 13,
        mapbox: { user: 'e2e-user' },
        published: true,
        updatedBy: 'system:setup',
        updatedAt: T0,
        ...overrides,
    };
}

export function categoryDoc(overrides: Partial<PoiCategoryDoc> = {}): PoiCategoryDoc {
    return {
        label: { ro: 'Clădiri', en: 'Buildings' },
        icon: 'domain',
        color: '#8b5e3c',
        defaultOpacity: 1,
        order: 0,
        updatedBy: 'admin-uid',
        updatedAt: T0,
        ...overrides,
    };
}

export function photoDoc(lat: number, lng: number, title: string): PhotoDoc {
    return {
        title: { ro: title },
        license: 'CC-BY-4.0',
        location: { lat, lng },
        published: true,
        processing: 'done',
        updatedBy: 'admin-uid',
        updatedAt: T0,
    };
}

export function poiDoc(lat: number, lng: number, title: string, category = 'cladiri'): PoiDoc {
    return {
        category,
        geometry: { type: 'Point', point: { lat, lng } },
        title: { ro: title },
        published: true,
        updatedBy: 'admin-uid',
        updatedAt: T0,
    };
}

/** The map preview as the areas drive it: every change and every restore, in order. */
export class RecordingPreview implements PreviewSink {
    readonly calls: (readonly ['preview', PreviewChange] | readonly ['restore', PreviewTarget])[] = [];

    preview(change: PreviewChange): void {
        this.calls.push(['preview', change]);
    }

    restore(target: PreviewTarget): void {
        this.calls.push(['restore', target]);
    }

    get last(): PreviewChange | undefined {
        const previews = this.calls.filter((call): call is readonly ['preview', PreviewChange] => call[0] === 'preview');
        return previews.at(-1)?.[1];
    }
}
