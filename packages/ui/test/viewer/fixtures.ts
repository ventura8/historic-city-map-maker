/**
 * Test data for the viewer elements: a small City Manifest v1 that passes `validateManifest` (two historical layers,
 * three photos, two POI categories, three POIs), so every element is driven with data the engine would accept.
 */
import { validateManifest, type Manifest, type ThemeTokens } from '@hcm/shared';

function tokens(primary: string): Record<string, string> {
    return { '--md-sys-color-primary': primary, '--md-sys-color-on-primary': '#ffffff', '--md-sys-color-surface': '#fff8f5' };
}

/**
 * The manifest address the element tests use: the migrated Bucharest manifest on the Vitest server, so the image
 * paths of the test photos resolve to real local WebP files (`seed/bucharest/derived/`) and no test reaches the
 * network. `fara-an` points at a file that does not exist (a 404, the missing-image path).
 */
export const TEST_MANIFEST_URL = new URL('/seed/bucharest/manifest.static.json', location.origin).href;

const THEME_TOKENS: ThemeTokens = {
    light: tokens('#875329'),
    dark: tokens('#ffb68a'),
    highContrastLight: tokens('#4a2500'),
    highContrastDark: tokens('#ffece3'),
};

function rawCity(): Record<string, unknown> {
    return {
        id: 'bucuresti',
        name: { ro: 'București dispărut', en: 'Lost Bucharest' },
        center: [26.0853, 44.4271],
        zoom: 14.5,
        minZoom: 10,
        maxZoom: 20,
        bounds: [
            [25.93, 44.33],
            [26.25, 44.55],
        ],
        about: {
            ro: '**Despre** hartă. [Sursa](https://example.org/despre)',
            en: '**About** the map. [Source](https://example.org/about)',
        },
        credits: [
            { label: { ro: 'Fotografii: arhiva A', en: 'Photos: archive A' } },
            { label: { ro: 'OpenStreetMap', en: 'OpenStreetMap' }, url: 'https://www.openstreetmap.org/copyright' },
        ],
        privacy: { ro: 'Fără cookie-uri fără acord.', en: 'No cookies without consent.' },
        theme: { seedColor: '#8B5E3C', tokens: THEME_TOKENS },
        basemap: { style: 'mapbox://styles/mapbox/standard-satellite' },
        mapbox: { publicToken: 'pk.viewer-ui-test' },
        analytics: { measurementId: 'G-VIEWERTEST' },
    };
}

function rawLayers(): unknown[] {
    return [
        {
            id: 'kh9-1977',
            year: 1977,
            label: { ro: 'KH-9 1977', en: 'KH-9 1977' },
            kind: 'satellite',
            attribution: 'USGS EROS',
            source: { type: 'mapbox', tilesetId: 'test-owner.kh9-1977' },
            minzoom: 10,
            maxzoom: 17,
            order: 2,
            defaultVisible: false,
            opacity: 1,
        },
        {
            id: 'kh4-1966',
            year: 1966,
            label: { ro: 'Corona 1966', en: 'Corona 1966' },
            kind: 'satellite',
            attribution: 'USGS Corona',
            source: { type: 'xyz', tiles: ['https://tiles.example.org/{z}/{x}/{y}.png'], tileSize: 256 },
            minzoom: 10,
            maxzoom: 17,
            order: 1,
            defaultVisible: true,
            opacity: 0.9,
        },
    ];
}

function rawPhotos(): unknown[] {
    return [
        {
            id: 'mihai-voda-1978',
            title: { ro: 'Mihai Vodă', en: 'Mihai Vodă church' },
            description: { ro: 'Strada spre Dâmbovița.' },
            year: 1978,
            yearEnd: 1979,
            author: 'Dan Vartanian',
            license: 'permission-legacy',
            rightsReview: true,
            links: [{ url: 'https://www.flickr.com/photos/x/1/', label: 'Flickr' }],
            location: { lat: 44.4317, lng: 26.0916 },
            bearing: 46.8,
            image: { web: 'derived/mihai-voda-1978/web.webp', thumb: 'derived/mihai-voda-1978/thumb.webp', w: 1100, h: 733 },
        },
        {
            id: 'uranus-1984',
            title: { ro: 'Strada Uranus' },
            dateText: { ro: 'Iulie 1984' },
            year: 1984,
            license: 'CC-BY-4.0',
            rightsHolder: 'Arhiva Uranus',
            links: [],
            location: { lat: 44.4285, lng: 26.0872 },
            image: {
                web: 'derived/uranus-colt-mihai-voda/web.webp',
                thumb: 'derived/uranus-colt-mihai-voda/thumb.webp',
                w: 800,
                h: 600,
            },
        },
        {
            id: 'fara-an',
            title: { ro: 'Fără an' },
            license: 'PD',
            links: [],
            location: { lat: 44.43, lng: 26.09 },
            image: { web: 'derived/missing-in-tests/web.webp', thumb: 'derived/missing-in-tests/thumb.webp', w: 400, h: 400 },
        },
    ];
}

function rawPoiCategories(): unknown[] {
    return [
        {
            id: 'cladiri',
            label: { ro: 'Clădiri dispărute', en: 'Vanished buildings' },
            icon: 'domain_disabled',
            color: '#8B5E3C',
            defaultOpacity: 1,
        },
        { id: 'evenimente', label: { ro: 'Evenimente', en: 'Events' }, icon: 'celebration', color: '#386A20', defaultOpacity: 0.8 },
    ];
}

function rawPois(): unknown[] {
    return [
        {
            id: 'casa-uranus',
            category: 'cladiri',
            geometry: { type: 'Point', coordinates: [26.0872, 44.4285] },
            title: { ro: 'Casa de pe Uranus', en: 'The house on Uranus street' },
            description: { ro: '**Demolată** în 1984. [Fișa](https://example.org/poi/casa)\n\n<b>Nu este HTML</b>' },
            yearStart: 1890,
            yearEnd: 1984,
            links: [{ url: 'https://example.org/poi/casa', label: 'Fișa locului' }],
            photoIds: ['mihai-voda-1978', 'uranus-1984'],
        },
        {
            id: 'cvartal',
            category: 'cladiri',
            geometry: {
                type: 'Polygon',
                coordinates: [
                    [
                        [26.086, 44.4268],
                        [26.0878, 44.4268],
                        [26.0878, 44.4278],
                        [26.086, 44.4278],
                        [26.086, 44.4268],
                    ],
                ],
            },
            title: { ro: 'Cvartal demolat' },
            yearStart: 1900,
            links: [],
        },
        {
            id: 'eveniment',
            category: 'evenimente',
            geometry: { type: 'Point', coordinates: [26.0905, 44.43] },
            title: { ro: 'Eveniment', en: 'Event' },
            links: [],
        },
    ];
}

function rawManifest(): Record<string, unknown> {
    return {
        version: 1,
        city: rawCity(),
        layers: rawLayers(),
        photos: rawPhotos(),
        photosOverlay: { defaultOpacity: 1 },
        poiCategories: rawPoiCategories(),
        pois: rawPois(),
    };
}

/** A fresh, validated manifest; `change` edits the raw JSON first (the result must still validate). */
export function testManifest(change: (raw: Record<string, unknown>) => void = () => undefined): Manifest {
    const raw = rawManifest();
    change(raw);
    const result = validateManifest(raw);
    if (!result.ok) {
        throw new Error(`invalid test manifest: ${JSON.stringify(result.issues)}`);
    }
    return result.value;
}
