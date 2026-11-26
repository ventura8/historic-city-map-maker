/**
 * A small valid City Manifest v1 as plain JSON, so each test can break one field. Every call returns a
 * fresh copy.
 */
export function tokens(): Record<string, string> {
    return { '--md-sys-color-primary': '#875329', '--md-sys-color-on-primary': '#ffffff' };
}

export function validCity(): Record<string, unknown> {
    return {
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
        about: { ro: '**Despre** [GitHub](https://github.com/x/y)', en: '**About**' },
        credits: [
            { label: { ro: 'Fotografii: A', en: 'Photos: A' } },
            { label: { ro: 'OSM', en: 'OSM' }, url: 'https://www.openstreetmap.org/copyright' },
        ],
        privacy: { ro: 'Fără cookie-uri.', en: 'No cookies.' },
        theme: {
            seedColor: '#8B5E3C',
            tokens: { light: tokens(), dark: tokens(), highContrastLight: tokens(), highContrastDark: tokens() },
        },
        basemap: { style: 'mapbox://styles/mapbox/standard-satellite', config: { lightPreset: 'day', show3dObjects: false } },
        mapbox: { publicToken: 'pk.test-viewer-token' },
        analytics: { measurementId: 'G-TEST1234', errorEndpoint: 'https://errors.example.org/report' },
        engine: { minVersion: '1.0.0' },
    };
}

export function validLayer(): Record<string, unknown> {
    return {
        id: 'kh4-1966',
        year: 1966,
        date: '1966-07-12',
        label: { ro: 'Corona 1966', en: 'Corona 1966' },
        description: { ro: 'Imagine KH-4A.', en: 'KH-4A image.' },
        kind: 'satellite',
        sensor: 'KH-4A',
        attribution: 'USGS EROS',
        source: { type: 'mapbox', tilesetId: 'test-owner.kh4-1966' },
        minzoom: 10,
        maxzoom: 17,
        bounds: [
            [25.95, 44.35],
            [26.2, 44.5],
        ],
        order: 1,
        defaultVisible: true,
        opacity: 0.9,
        adjustments: { brightnessMin: 0.1, brightnessMax: 0.9, contrast: 0.2, saturation: -1 },
    };
}

export function validPhoto(): Record<string, unknown> {
    return {
        id: 'mihai-voda-1978',
        title: { ro: 'Mihai Vodă' },
        description: { ro: 'Strada spre Dâmbovița.', en: 'The street towards the Dâmbovița.' },
        year: 1978,
        yearEnd: 1979,
        dateText: { ro: 'Iulie 1978' },
        author: 'Dan Vartanian',
        license: 'permission-legacy',
        rightsHolder: 'Dan Vartanian',
        rightsReview: true,
        links: [{ url: 'https://www.flickr.com/photos/x/1/', label: 'Flickr' }],
        location: { lat: 44.431722, lng: 26.091611 },
        bearing: 46.8,
        fov: 51,
        image: { web: 'derived/mihai-voda-1978/web.webp', thumb: 'https://storage.example.org/t.webp', w: 1100, h: 733 },
    };
}

export function validPoiCategory(): Record<string, unknown> {
    return {
        id: 'cladiri',
        label: { ro: 'Clădiri dispărute', en: 'Vanished buildings' },
        icon: 'domain_disabled',
        color: '#8B5E3C',
        defaultOpacity: 0.9,
    };
}

export function validPoi(): Record<string, unknown> {
    return {
        id: 'casa-uranus',
        category: 'cladiri',
        geometry: { type: 'Point', coordinates: [26.0872, 44.4285] },
        title: { ro: 'Casa de pe Uranus', en: 'The house on Uranus street' },
        description: { ro: '**Demolată** în 1984. [Sursa](https://example.org/poi/casa)' },
        yearStart: 1890,
        yearEnd: 1984,
        links: [{ url: 'https://example.org/poi/casa', label: 'Sursa' }],
        photoIds: ['mihai-voda-1978'],
    };
}

/** A closed square ring around `[lng, lat]` (half side `size` degrees). */
export function squareRing(lng: number, lat: number, size = 0.001): [number, number][] {
    return [
        [lng - size, lat - size],
        [lng + size, lat - size],
        [lng + size, lat + size],
        [lng - size, lat + size],
        [lng - size, lat - size],
    ];
}

export function validManifest(): Record<string, unknown> {
    return {
        version: 1,
        city: validCity(),
        layers: [validLayer()],
        photos: [validPhoto()],
        photosOverlay: { defaultOpacity: 0.8 },
        poiCategories: [validPoiCategory()],
        pois: [validPoi()],
    };
}
