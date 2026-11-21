/**
 * Typed City Manifest v1 fixtures for the engine-core tests: every builder returns a fresh, schema-valid manifest
 * (checked with `validateManifest`, so a fixture that drifts from the contract fails loudly instead of testing nothing).
 */
import { validateManifest, type Layer, type Manifest, type Photo, type Poi, type PoiCategory, type Story } from '@hcm/shared';

const TOKENS = { '--md-sys-color-primary': '#875329', '--md-sys-color-on-primary': '#ffffff' };

/** `value` without `keys` (exactOptionalPropertyTypes forbids writing `key: undefined`). */
export function omit<T extends object, K extends keyof T>(value: T, ...keys: readonly K[]): Omit<T, K> {
    return Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key as K))) as Omit<T, K>;
}

export function layer(overrides: Partial<Layer> = {}): Layer {
    return {
        id: 'kh4-1966',
        year: 1966,
        label: { ro: 'Corona 1966', en: 'Corona 1966 (EN)' },
        kind: 'satellite',
        attribution: 'USGS EROS',
        source: { type: 'mapbox', tilesetId: 'test-owner.kh4-1966' },
        minzoom: 10,
        maxzoom: 17,
        order: 1,
        defaultVisible: false,
        opacity: 0.9,
        ...overrides,
    };
}

export function photo(overrides: Partial<Photo> = {}): Photo {
    return {
        id: 'mihai-voda-1978',
        title: { ro: 'Mihai Vodă', en: 'Mihai Voda street' },
        year: 1978,
        license: 'permission-legacy',
        links: [],
        location: { lat: 44.431722, lng: 26.091611 },
        bearing: 46.8,
        fov: 51,
        image: { web: 'derived/mihai-voda-1978/web.webp', thumb: 'derived/mihai-voda-1978/thumb.webp', w: 1100, h: 733 },
        ...overrides,
    };
}

export function category(overrides: Partial<PoiCategory> = {}): PoiCategory {
    return {
        id: 'cladiri',
        label: { ro: 'Clădiri dispărute', en: 'Vanished buildings' },
        icon: 'domain_disabled',
        color: '#8B5E3C',
        defaultOpacity: 1,
        ...overrides,
    };
}

export function poi(overrides: Partial<Poi> = {}): Poi {
    return {
        id: 'casa-uranus',
        category: 'cladiri',
        geometry: { type: 'Point', coordinates: [26.0872, 44.4285] },
        title: { ro: 'Casa de pe Uranus', en: 'The house on Uranus street' },
        yearStart: 1890,
        yearEnd: 1984,
        links: [],
        ...overrides,
    };
}

export interface ManifestParts {
    readonly layers?: readonly Layer[];
    readonly photos?: readonly Photo[];
    readonly categories?: readonly PoiCategory[];
    readonly pois?: readonly Poi[];
    readonly analytics?: Manifest['city']['analytics'];
    readonly photosOpacity?: number;
    /** M17: the city's stories (none by default). */
    readonly stories?: Manifest['stories'];
}

/** M17: a story about a photo and a place, from 1966. */
export const STORY: Story = {
    id: 'teatrul',
    title: { ro: 'Teatrul', en: 'The theatre' },
    body: { ro: 'A ars în **1944**.' },
    yearStart: 1966,
    photoIds: ['mihai-voda-1978'],
    poiIds: ['strada'],
};

/** A valid manifest of Bucharest: two layers (1966, 1980), three photos, two POI categories with three POIs. */
export function manifest(parts: ManifestParts = {}): Manifest {
    const input = {
        version: 1,
        city: {
            id: 'bucuresti',
            name: { ro: 'București dispărut', en: 'Lost Bucharest' },
            center: [26.085298, 44.427037],
            zoom: 14.5,
            minZoom: 10,
            maxZoom: 20,
            bounds: [
                [25.93, 44.33],
                [26.25, 44.55],
            ],
            about: { ro: 'Despre', en: 'About' },
            credits: [],
            privacy: { ro: 'Fără cookie-uri.', en: 'No cookies.' },
            theme: { seedColor: '#8B5E3C', tokens: { light: TOKENS, dark: TOKENS, highContrastLight: TOKENS, highContrastDark: TOKENS } },
            basemap: { style: 'mapbox://styles/mapbox/standard-satellite', config: { lightPreset: 'day' } },
            mapbox: { publicToken: 'pk.test-viewer-token' },
            analytics: parts.analytics ?? { measurementId: 'G-TEST1234', errorEndpoint: 'https://errors.example.org/report' },
        },
        layers: parts.layers ?? [
            layer(),
            layer({
                id: 'kh9-1980',
                year: 1980,
                order: 2,
                defaultVisible: false,
                source: { type: 'xyz', tiles: ['https://tiles.example.org/{z}/{x}/{y}.webp'], tileSize: 256 },
            }),
        ],
        photos: parts.photos ?? [
            photo(),
            { ...omit(photo(), 'bearing', 'fov'), id: 'uranus-1936', year: 1936, location: { lat: 44.4285, lng: 26.0872 } },
            { ...omit(photo(), 'bearing', 'fov', 'year'), id: 'undated', title: { ro: 'Fără an' } },
        ],
        photosOverlay: { defaultOpacity: parts.photosOpacity ?? 1 },
        poiCategories: parts.categories ?? [
            category(),
            category({ id: 'strazi', label: { ro: 'Străzi', en: 'Streets' }, icon: 'celebration', color: '#B3261E', defaultOpacity: 0.8 }),
        ],
        pois: parts.pois ?? [
            poi(),
            poi({
                id: 'strada',
                category: 'strazi',
                title: { ro: 'Stradă' },
                geometry: {
                    type: 'LineString',
                    coordinates: [
                        [26.085, 44.4256],
                        [26.087, 44.4258],
                    ],
                },
                yearStart: 1850,
                yearEnd: 1985,
            }),
            { ...omit(poi(), 'yearStart', 'yearEnd'), id: 'eveniment', title: { ro: 'Eveniment', en: 'Event' } },
        ],
        ...(parts.stories === undefined ? {} : { stories: parts.stories }),
    };
    const result = validateManifest(JSON.parse(JSON.stringify(input)));
    if (!result.ok) {
        throw new Error(`invalid fixture: ${JSON.stringify(result.issues)}`);
    }
    return result.value;
}
