import { translateAdminContent, type AdminContentKey } from '@hcm/shared';

import type { CityWorld } from '../../support/content.js';

/**
 * The layers and settings areas' world for the admin tier (docs/research/M2c-interfaces.md §8, §12.3): a city, its
 * historical layers, POI categories, photos and places, written into the Firestore emulator past the rules (as the raster
 * pipeline, the Setup Assistant or an earlier session would have left them), and the pages' texts. Every value is a
 * generated test value.
 */

/** An editor text (`adminContent.*`) in the project's language. */
export function text(lang: 'ro' | 'en', key: AdminContentKey, params: Readonly<Record<string, string>> = {}): string {
    return translateAdminContent(lang, key, params);
}

/** The city: bounds around Bucharest, its start view, the Mapbox account `e2e-user`, published. */
export async function seedCity(world: CityWorld, at: Date, extra: Readonly<Record<string, unknown>> = {}): Promise<void> {
    await world.emulators.setDocument(`cities/${world.city}`, {
        name: { ro: 'București', en: 'Bucharest' },
        bounds: { west: 25.9, south: 44.3, east: 26.3, north: 44.6 },
        center: { lat: 44.43, lng: 26.1 },
        zoom: 13,
        mapbox: { user: 'e2e-user' },
        published: true,
        updatedBy: 'system:setup',
        updatedAt: at,
        ...extra,
    });
}

/** A ready historical layer the raster pipeline published. */
export async function seedLayer(world: CityWorld, id: string, at: Date, extra: Readonly<Record<string, unknown>> = {}): Promise<void> {
    await world.emulators.setDocument(`cities/${world.city}/layers/${id}`, {
        year: 1968,
        label: { ro: 'Corona 1968' },
        kind: 'satellite',
        source: { type: 'mapbox', tilesetId: `e2e-user.${id}` },
        minzoom: 10,
        maxzoom: 17,
        order: 1,
        opacity: 1,
        defaultVisible: false,
        status: 'ready',
        published: true,
        mapbox: { tilesetId: `e2e-user.${id}` },
        updatedBy: 'system:pipeline',
        updatedAt: at,
        ...extra,
    });
}

/** A POI category. */
export async function seedCategory(world: CityWorld, id: string, at: Date, extra: Readonly<Record<string, unknown>> = {}): Promise<void> {
    await world.emulators.setDocument(`cities/${world.city}/poiCategories/${id}`, {
        label: { ro: 'Clădiri', en: 'Buildings' },
        icon: 'domain',
        color: '#8b5e3c',
        defaultOpacity: 1,
        order: 0,
        updatedBy: 'system:setup',
        updatedAt: at,
        ...extra,
    });
}

/** A place of `category` at a point. */
export async function seedPlace(
    world: CityWorld,
    id: string,
    at: Date,
    place: { category: string; lat: number; lng: number; title: string },
): Promise<void> {
    await world.emulators.setDocument(`cities/${world.city}/pois/${id}`, {
        category: place.category,
        geometry: { type: 'Point', point: { lat: place.lat, lng: place.lng } },
        title: { ro: place.title },
        yearStart: 1890,
        published: true,
        updatedBy: 'system:setup',
        updatedAt: at,
    });
}

/** A processed photo at a point. */
export async function seedPhotoAt(
    world: CityWorld,
    id: string,
    at: Date,
    photo: { lat: number; lng: number; title: string },
): Promise<void> {
    await world.emulators.setDocument(`cities/${world.city}/photos/${id}`, {
        title: { ro: photo.title },
        license: 'CC-BY-4.0',
        location: { lat: photo.lat, lng: photo.lng },
        published: false,
        processing: 'pending',
        updatedBy: 'system:setup',
        updatedAt: at,
    });
}
