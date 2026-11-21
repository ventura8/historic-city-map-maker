/**
 * A small published city in the documents' own shapes (`@hcm/shared` firestore schemas), seeded into the fake store:
 * the manifest tests build from it. Values are generated test values (the public token is not a real token).
 */
import {
    FIRESTORE_PATHS,
    STORAGE_PATHS,
    cityDocSchema,
    layerDocSchema,
    photoDocSchema,
    poiCategoryDocSchema,
    poiDocSchema,
    timestampFromDate,
    type CityDoc,
    type LayerDoc,
    type PhotoDoc,
    type PoiCategoryDoc,
    type PoiDoc,
    type StoryDoc,
} from '@hcm/shared';

import type { ContentDeps } from './fakes.js';
import { publicUrl } from './fakes.js';

export const CITY_ID = 'bucuresti';

const stamp = { updatedBy: 'u-admin', updatedAt: timestampFromDate(new Date('2026-10-12T08:00:00.000Z')) };

const TOKENS = { '--md-sys-color-primary': '#875329', '--md-sys-color-on-primary': '#ffffff' };

export function cityDoc(overrides: Partial<CityDoc> = {}): CityDoc {
    return {
        name: { ro: 'București dispărut', en: 'Lost Bucharest' },
        bounds: { west: 25.93, south: 44.33, east: 26.25, north: 44.55 },
        about: { ro: 'Despre **hartă**.' },
        privacy: { ro: 'Fără cookie-uri.', en: 'No cookies.' },
        theme: { seedColor: '#8B5E3C', tokens: { light: TOKENS, dark: TOKENS, highContrastLight: TOKENS, highContrastDark: TOKENS } },
        mapbox: { publicToken: 'pk.test-viewer-token', publicTokenId: 'viewer1' },
        analytics: { measurementId: 'G-TEST1234' },
        photosOverlay: { defaultOpacity: 0.9 },
        published: true,
        ...stamp,
        ...overrides,
    };
}

export function layerDoc(overrides: Partial<LayerDoc> = {}): LayerDoc {
    return {
        year: 1940,
        label: { ro: 'Zbor 1940' },
        kind: 'aerial',
        attribution: 'USGS',
        source: { type: 'xyz', tiles: ['https://tiles.example.test/1940/{z}/{x}/{y}.png'], tileSize: 256 },
        minzoom: 10,
        maxzoom: 18,
        bounds: { west: 26, south: 44.4, east: 26.2, north: 44.5 },
        order: 1,
        opacity: 0.8,
        defaultVisible: true,
        status: 'ready',
        published: true,
        ...stamp,
        ...overrides,
    };
}

export function photoDoc(id: string, overrides: Partial<PhotoDoc> = {}): PhotoDoc {
    return {
        title: { ro: `Fotografia ${id}` },
        license: 'CC-BY-4.0',
        location: { lat: 44.43, lng: 26.09 },
        bearing: 90,
        published: true,
        processing: 'done',
        image: {
            web: publicUrl(`photos/${CITY_ID}/${id}/12345678/web.webp`),
            thumb: publicUrl(`photos/${CITY_ID}/${id}/12345678/thumb.webp`),
            sha256: '1'.repeat(64),
            w: 2048,
            h: 1365,
        },
        ...stamp,
        ...overrides,
    };
}

export function categoryDoc(overrides: Partial<PoiCategoryDoc> = {}): PoiCategoryDoc {
    return { label: { ro: 'Biserici' }, icon: 'church', color: '#aa3300', defaultOpacity: 0.9, order: 1, ...stamp, ...overrides };
}

export function poiDoc(overrides: Partial<PoiDoc> = {}): PoiDoc {
    return {
        category: 'churches',
        geometry: { type: 'Point', point: { lat: 44.43, lng: 26.1 } },
        title: { ro: 'Biserica Enei' },
        published: true,
        ...stamp,
        ...overrides,
    };
}

/** M17: a published story about the photo `p1` and the place `enei`, with a figure of `p2`. */
export function storyDoc(overrides: Partial<StoryDoc> = {}): StoryDoc {
    return {
        title: { ro: 'Biserica Enei', en: 'Enei Church' },
        body: { ro: 'Demolată în **1977**.\n\n![Altarul](photo:p2)' },
        yearStart: 1977,
        photoIds: ['p1'],
        poiIds: ['enei'],
        published: true,
        ...stamp,
        ...overrides,
    };
}

/** The city document, one layer, two photos, one category and one POI. */
/** The city's tab icon as the build left it: the default in the city's colour, so a build draws none (`../publish/icon.test.ts`). */
const CURRENT_ICON: NonNullable<CityDoc['icon']> = {
    source: 'default',
    seedColor: '#8B5E3C',
    url: publicUrl(STORAGE_PATHS.cityIcon(CITY_ID, 180)),
    sha256: 'b'.repeat(64),
    ...stamp,
};

export async function seedCity(deps: ContentDeps, city: Partial<CityDoc> = {}): Promise<void> {
    await deps.documents.set(FIRESTORE_PATHS.city(CITY_ID), cityDocSchema, cityDoc({ icon: CURRENT_ICON, ...city }));
    await deps.documents.set(FIRESTORE_PATHS.layer(CITY_ID, 'flight-1940'), layerDocSchema, layerDoc());
    await deps.documents.set(FIRESTORE_PATHS.photo(CITY_ID, 'p2'), photoDocSchema, photoDoc('p2'));
    await deps.documents.set(FIRESTORE_PATHS.photo(CITY_ID, 'p1'), photoDocSchema, photoDoc('p1', { title: { ro: 'Unu', en: 'One' } }));
    await deps.documents.set(FIRESTORE_PATHS.poiCategory(CITY_ID, 'churches'), poiCategoryDocSchema, categoryDoc());
    await deps.documents.set(FIRESTORE_PATHS.poi(CITY_ID, 'enei'), poiDocSchema, poiDoc({ photoIds: ['p1', 'gone'] }));
}
