/**
 * The layers family's test world: the fn-content fakes (`../publish/fakes.ts`: an in-memory `DocumentStore` that
 * validates like the adapter, a movable clock, `u-admin` as the admin), a city with its Mapbox account, and layers,
 * categories and jobs seeded through their schemas. Every value is a generated test value.
 */
import {
    FIRESTORE_PATHS,
    cityDocSchema,
    jobDocSchema,
    layerDocSchema,
    poiCategoryDocSchema,
    timestampFromDate,
    type CityDoc,
    type JobDoc,
    type LayerDoc,
    type PoiCategoryDoc,
} from '@hcm/shared';

import type { ContentDeps } from '../publish/fakes.js';

export const CITY = 'layers-city';
export const MAPBOX_USER = 'e2e-user';
const T0 = timestampFromDate(new Date('2026-10-01T08:00:00.000Z'));

function city(overrides: Partial<CityDoc> = {}): CityDoc {
    return {
        name: { ro: 'Orașul de test' },
        bounds: { west: 25.9, south: 44.3, east: 26.3, north: 44.6 },
        mapbox: { user: MAPBOX_USER },
        published: true,
        updatedBy: 'system:setup',
        updatedAt: T0,
        ...overrides,
    };
}

export function layer(overrides: Partial<LayerDoc> = {}): LayerDoc {
    return {
        year: 1968,
        label: { ro: 'Corona 1968' },
        kind: 'satellite',
        source: { type: 'mapbox', tilesetId: `${MAPBOX_USER}.corona-1968` },
        minzoom: 10,
        maxzoom: 17,
        order: 1,
        opacity: 1,
        defaultVisible: false,
        status: 'ready',
        published: true,
        mapbox: { tilesetId: `${MAPBOX_USER}.corona-1968`, publishedSourceSha: 'b'.repeat(64) },
        updatedBy: 'system:pipeline',
        updatedAt: T0,
        ...overrides,
    };
}

function category(overrides: Partial<PoiCategoryDoc> = {}): PoiCategoryDoc {
    return {
        label: { ro: 'Clădiri' },
        icon: 'domain',
        color: '#8B5E3C',
        defaultOpacity: 1,
        order: 0,
        updatedBy: 'u-admin',
        updatedAt: T0,
        ...overrides,
    };
}

function job(overrides: Partial<JobDoc> = {}): JobDoc {
    return {
        type: 'regeoref',
        status: 'running',
        params: { layerId: 'corona-1968' },
        createdBy: 'u-admin',
        createdAt: T0,
        updatedBy: 'system:pipeline',
        updatedAt: T0,
        ...overrides,
    };
}

export async function seedCity(deps: ContentDeps, overrides: Partial<CityDoc> = {}): Promise<void> {
    await deps.documents.set(FIRESTORE_PATHS.city(CITY), cityDocSchema, city(overrides));
}

export async function seedLayer(deps: ContentDeps, id: string, overrides: Partial<LayerDoc> = {}): Promise<void> {
    await deps.documents.set(FIRESTORE_PATHS.layer(CITY, id), layerDocSchema, layer(overrides));
}

export async function seedCategory(deps: ContentDeps, id: string, overrides: Partial<PoiCategoryDoc> = {}): Promise<void> {
    await deps.documents.set(FIRESTORE_PATHS.poiCategory(CITY, id), poiCategoryDocSchema, category(overrides));
}

export async function seedJob(deps: ContentDeps, id: string, overrides: Partial<JobDoc> = {}): Promise<void> {
    await deps.documents.set(FIRESTORE_PATHS.job(CITY, id), jobDocSchema, job(overrides));
}
