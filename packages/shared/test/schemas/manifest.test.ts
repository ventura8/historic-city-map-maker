import { describe, expect, it } from 'vitest';

import { LICENSE_URLS, LICENSES, MAX_LAYERS, photoKindOf } from '../../src/schemas/manifest.js';
import { MAX_GEOMETRY_VERTICES, MAX_POLYGON_RINGS } from '../../src/schemas/geometry.js';
import { MAX_LINKS } from '../../src/schemas/primitives.js';
import { parseManifestJson, validateManifest, type ValidationIssue } from '../../src/schemas/validation.js';
import { squareRing, validCity, validLayer, validManifest, validPhoto, validPoi, validPoiCategory } from '../fixtures/manifest.js';

type Path = readonly (string | number)[];

/** A Firebase web API key shape, assembled at run time so no `AIza…` literal is ever committed (gitleaks). */
const FAKE_FIREBASE_KEY = ['AI', 'za', 'e2e'.padEnd(35, '0')].join('');
const FIREBASE_IDS = { apiKey: FAKE_FIREBASE_KEY, appId: '1:123456789012:web:0a1b2c3d4e5f', projectId: 'demo-hcm' };

/** The valid manifest with the value at `path` replaced (`undefined` deletes the key). */
function patched(path: Path, value: unknown): Record<string, unknown> {
    const manifest = validManifest();
    let target: Record<string | number, unknown> = manifest;
    for (const key of path.slice(0, -1)) {
        target = target[key] as Record<string | number, unknown>;
    }
    const last = path.at(-1) ?? '';
    if (value === undefined) {
        // Deleting by a computed key is the point of this helper (a missing field).
        Reflect.deleteProperty(target, last);
    } else {
        target[last] = value;
    }
    return manifest;
}

function issuesOf(input: unknown): readonly ValidationIssue[] {
    const result = validateManifest(input);
    return result.ok ? [] : result.issues;
}

describe('manifest v1: happy paths', () => {
    it('happyPath_theFixtureIsValid', () => {
        expect(issuesOf(validManifest())).toEqual([]);
    });

    it('happyPath_aCityOf300LayersPublishesAndOneMoreIsRefused @S-A10-HAPPY-MANIFEST-300-LAYERS @S-A10-BAD-MANIFEST-301-LAYERS', () => {
        const layers = (count: number): unknown[] =>
            Array.from({ length: count }, (_, index) => ({ ...validLayer(), id: `layer-${String(index)}` }));

        expect(MAX_LAYERS).toBe(300);
        expect(issuesOf({ ...validManifest(), layers: layers(MAX_LAYERS) })).toEqual([]);
        expect(issuesOf({ ...validManifest(), layers: layers(MAX_LAYERS + 1) }).map((issue) => issue.code)).toContain('validation.tooBig');
    });

    it('happyPath_anAerialPhotoAndAPhotoWithoutKindIsAStreetPhoto', () => {
        const result = validateManifest(patched(['photos', 0, 'kind'], 'aerial'));

        expect(result.ok && photoKindOf(result.value.photos[0] ?? {})).toBe('aerial');
        expect(photoKindOf({})).toBe('ground');
    });

    it('happyPath_textIsTrimmed', () => {
        const result = validateManifest(patched(['photos', 0, 'title'], { ro: '  Mihai Vodă  ' }));

        expect(result.ok && result.value.photos[0]?.title.ro).toBe('Mihai Vodă');
    });

    it('happyPath_minimalCityAndPhoto', () => {
        const city = { ...validCity(), credits: [] };
        Reflect.deleteProperty(city, 'engine');
        const photo = {
            id: 'p',
            title: { ro: 'T' },
            license: 'CC0',
            links: [],
            location: { lat: 44.4, lng: 26.1 },
            image: { web: 'w.webp', thumb: 't.webp', w: 1, h: 1 },
        };

        expect(issuesOf({ version: 1, city, layers: [], photos: [photo] })).toEqual([]);
    });

    it.each([
        [{ type: 'xyz', tiles: ['https://tiles.example.org/{z}/{x}/{y}.png'], tileSize: 512 }],
        [{ type: 'pmtiles', url: 'layers/kh4.pmtiles' }],
        [{ type: 'pmtiles', url: 'https://cdn.example.org/kh4.pmtiles' }],
    ])('happyPath_layerSource_%j_isValid', (source) => {
        expect(issuesOf(patched(['layers', 0, 'source'], source))).toEqual([]);
    });

    it('happyPath_theFirebaseWebAppIdsForAnalytics', () => {
        const analytics = { measurementId: 'G-E2E0000000', firebase: FIREBASE_IDS };
        const result = validateManifest(patched(['city', 'analytics'], analytics));

        expect(result.ok && result.value.city.analytics.firebase).toEqual(FIREBASE_IDS);
    });

    it('happyPath_httpsStyleUrl', () => {
        expect(issuesOf(patched(['city', 'basemap'], { style: 'https://styles.example.org/style.json' }))).toEqual([]);
    });

    it('happyPath_adjustmentsWithOneBound', () => {
        expect(issuesOf(patched(['layers', 0, 'adjustments'], { brightnessMax: 0.5 }))).toEqual([]);
        expect(issuesOf(patched(['layers', 0, 'adjustments'], { brightnessMin: 0.5 }))).toEqual([]);
    });

    it('happyPath_aManifestWithoutPoisOrPhotosOverlay', () => {
        const manifest = validManifest();
        for (const key of ['photosOverlay', 'poiCategories', 'pois']) {
            Reflect.deleteProperty(manifest, key);
        }

        expect(issuesOf(manifest)).toEqual([]);
    });

    it.each([
        [
            {
                type: 'LineString',
                coordinates: [
                    [26.08, 44.42],
                    [26.09, 44.43],
                ],
            },
        ],
        [{ type: 'Polygon', coordinates: [squareRing(26.08, 44.42, 0.01), squareRing(26.08, 44.42, 0.002)] }],
        [{ type: 'Point', coordinates: [26.3, 44.6] }],
    ])('happyPath_poiGeometry_%j_isValid', (geometry) => {
        expect(issuesOf(patched(['pois', 0, 'geometry'], geometry))).toEqual([]);
    });

    it('happyPath_aPoiWithOnlyAnEndYearOrNoYears', () => {
        const ended = patched(['pois', 0, 'yearStart'], undefined);
        const poi = validPoi();
        Reflect.deleteProperty(poi, 'yearStart');
        Reflect.deleteProperty(poi, 'yearEnd');
        const timeless = { ...validManifest(), pois: [poi] };

        expect(issuesOf(ended)).toEqual([]);
        expect(issuesOf(timeless)).toEqual([]);
    });

    it('happyPath_anyIconNameIsAccepted', () => {
        expect(issuesOf(patched(['poiCategories', 0, 'icon'], 'celebration'))).toEqual([]);
    });

    it('happyPath_parsesJsonText', () => {
        expect(parseManifestJson(JSON.stringify(validManifest())).ok).toBe(true);
    });
});

/** One row per rule: what breaks, where, the value, and the localized issue it must produce. */
const RULES = [
    ['version', ['version'], 2, 'version', 'validation.value'],
    ['an unknown top-level key', ['extra'], true, 'extra', 'validation.unknownKey'],
    ['a missing English name', ['city', 'name', 'en'], undefined, 'city.name.en', 'validation.required'],
    ['an empty name', ['city', 'name', 'ro'], '   ', 'city.name.ro', 'validation.tooSmall'],
    ['a numeric name', ['city', 'name', 'ro'], 5, 'city.name.ro', 'validation.type'],
    ['an id with a space', ['city', 'id'], 'bucu resti', 'city.id', 'validation.format'],
    [
        'inverted bounds',
        ['city', 'bounds'],
        [
            [26.25, 44.33],
            [25.93, 44.55],
        ],
        'city.bounds',
        'validation.bounds',
    ],
    ['a zoom beyond 24', ['city', 'maxZoom'], 25, 'city.maxZoom', 'validation.tooBig'],
    ['a zoom outside its range', ['city', 'zoom'], 9, 'city.zoom', 'validation.zoomRange'],
    ['a centre outside the bounds', ['city', 'center'], [27, 44.4], 'city.center', 'validation.centerOutside'],
    ['an http link in About', ['city', 'about', 'ro'], '[x](http://example.org)', 'city.about.ro', 'validation.markdownLink'],
    ['a named seed colour', ['city', 'theme', 'seedColor'], 'brown', 'city.theme.seedColor', 'validation.format'],
    [
        'a token value that escapes',
        ['city', 'theme', 'tokens', 'light', '--md-sys-color-primary'],
        'red;x',
        'city.theme.tokens.light.--md-sys-color-primary',
        'validation.cssValue',
    ],
    [
        'a url() token value',
        ['city', 'theme', 'tokens', 'dark', '--md-sys-color-primary'],
        'url(x)',
        'city.theme.tokens.dark.--md-sys-color-primary',
        'validation.cssValue',
    ],
    [
        'an empty token set',
        ['city', 'theme', 'tokens', 'highContrastDark'],
        {},
        'city.theme.tokens.highContrastDark',
        'validation.required',
    ],
    ['a malformed style', ['city', 'basemap', 'style'], 'mapbox://styles/only-owner', 'city.basemap.style', 'validation.format'],
    // docs/LESSONS.md 241: the origin `https://a.example.org;connect-src` would end a policy's directive.
    [
        'a style whose host ends a policy directive',
        ['city', 'basemap', 'style'],
        'https://a.example.org;connect-src/x',
        'city.basemap.style',
        'validation.format',
    ],
    ['a secret Mapbox token', ['city', 'mapbox', 'publicToken'], 'sk.secret-scenario', 'city.mapbox.publicToken', 'validation.format'],
    ['a Universal Analytics id', ['city', 'analytics', 'measurementId'], 'UA-1234-1', 'city.analytics.measurementId', 'validation.format'],
    [
        'a Firebase key of the wrong shape',
        ['city', 'analytics', 'firebase'],
        { ...FIREBASE_IDS, apiKey: 'not-a-key' },
        'city.analytics.firebase.apiKey',
        'validation.format',
    ],
    [
        'a Firebase app id of another platform',
        ['city', 'analytics', 'firebase'],
        { ...FIREBASE_IDS, appId: '1:123456789012:android:0a1b' },
        'city.analytics.firebase.appId',
        'validation.format',
    ],
    [
        'a Firebase project id with capitals',
        ['city', 'analytics', 'firebase'],
        { ...FIREBASE_IDS, projectId: 'Demo-HCM' },
        'city.analytics.firebase.projectId',
        'validation.format',
    ],
    [
        'Firebase ids with a secret',
        ['city', 'analytics', 'firebase'],
        { ...FIREBASE_IDS, serviceAccount: 'x' },
        'city.analytics.firebase.serviceAccount',
        'validation.unknownKey',
    ],
    [
        'an http error endpoint',
        ['city', 'analytics', 'errorEndpoint'],
        'http://errors.example.org',
        'city.analytics.errorEndpoint',
        'validation.httpsOnly',
    ],
    ['a two-part engine version', ['city', 'engine', 'minVersion'], '1.0', 'city.engine.minVersion', 'validation.format'],
    ['a javascript credit link', ['city', 'credits', 1, 'url'], 'javascript:alert(1)', 'city.credits[1].url', 'validation.httpsOnly'],
    ['a malformed tileset id', ['layers', 0, 'source', 'tilesetId'], 'no-owner', 'layers[0].source.tilesetId', 'validation.format'],
    [
        'a tile template without y',
        ['layers', 0, 'source'],
        { type: 'xyz', tiles: ['https://t.example.org/{z}/{x}.png'], tileSize: 256 },
        'layers[0].source.tiles[0]',
        'validation.tileTemplate',
    ],
    [
        'an odd tile size',
        ['layers', 0, 'source'],
        { type: 'xyz', tiles: ['https://t.example.org/{z}/{x}/{y}.png'], tileSize: 300 },
        'layers[0].source.tileSize',
        'validation.value',
    ],
    [
        'an unknown source type',
        ['layers', 0, 'source'],
        { type: 'wms', url: 'https://x.example.org' },
        'layers[0].source.type',
        'validation.value',
    ],
    [
        'a pmtiles path that climbs',
        ['layers', 0, 'source'],
        { type: 'pmtiles', url: '../x.pmtiles' },
        'layers[0].source.url',
        'validation.assetUrl',
    ],
    ['a zoom range upside down', ['layers', 0, 'minzoom'], 18, 'layers[0].maxzoom', 'validation.zoomRange'],
    ['a date of another year', ['layers', 0, 'date'], '1967-01-01', 'layers[0].date', 'validation.value'],
    ['an impossible date', ['layers', 0, 'date'], '1966-02-30', 'layers[0].date', 'validation.format'],
    [
        'inverted brightness',
        ['layers', 0, 'adjustments'],
        { brightnessMin: 0.9, brightnessMax: 0.1 },
        'layers[0].adjustments.brightnessMax',
        'validation.value',
    ],
    ['a contrast below -1', ['layers', 0, 'adjustments', 'contrast'], -1.5, 'layers[0].adjustments.contrast', 'validation.tooSmall'],
    ['a saturation over 1', ['layers', 0, 'adjustments', 'saturation'], 2, 'layers[0].adjustments.saturation', 'validation.tooBig'],
    ['a brightness over 1', ['layers', 0, 'adjustments', 'brightnessMax'], 1.2, 'layers[0].adjustments.brightnessMax', 'validation.tooBig'],
    ['an unknown adjustment', ['layers', 0, 'adjustments', 'gamma'], 2, 'layers[0].adjustments.gamma', 'validation.unknownKey'],
    ['an unknown layer kind', ['layers', 0, 'kind'], 'drawing', 'layers[0].kind', 'validation.value'],
    ['an unknown photo kind', ['photos', 0, 'kind'], 'underwater', 'photos[0].kind', 'validation.value'],
    ['a layer named like the photos overlay', ['layers', 0, 'id'], 'photos', 'layers[0].id', 'validation.duplicateId'],
    ['an end year before the year', ['photos', 0, 'yearEnd'], 1970, 'photos[0].yearEnd', 'validation.yearRange'],
    ['the licence unknown', ['photos', 0, 'license'], 'unknown', 'photos[0].license', 'validation.value'],
    ['an http link', ['photos', 0, 'links', 0, 'url'], 'http://www.example.org/x', 'photos[0].links[0].url', 'validation.httpsOnly'],
    ['a protocol-relative image', ['photos', 0, 'image', 'web'], '//evil.example/x.webp', 'photos[0].image.web', 'validation.assetUrl'],
    ['a photo far outside the city', ['photos', 0, 'location'], { lat: 46, lng: 26.1 }, 'photos[0].location', 'validation.outsideCity'],
    ['a bearing over 360', ['photos', 0, 'bearing'], 361, 'photos[0].bearing', 'validation.tooBig'],
    ['a zero field of view', ['photos', 0, 'fov'], 0, 'photos[0].fov', 'validation.tooSmall'],
    [
        'a viewed area bent inward',
        ['photos', 0, 'viewedArea'],
        [
            { lat: 44.43, lng: 26.09 },
            { lat: 44.44, lng: 26.09 },
            { lat: 44.432, lng: 26.092 },
            { lat: 44.43, lng: 26.1 },
        ],
        'photos[0].viewedArea',
        'validation.viewedArea',
    ],
    ['a fractional width', ['photos', 0, 'image', 'w'], 10.5, 'photos[0].image.w', 'validation.type'],
    ['a photos overlay opacity below 0', ['photosOverlay', 'defaultOpacity'], -0.1, 'photosOverlay.defaultOpacity', 'validation.tooSmall'],
    ['an unknown photos overlay key', ['photosOverlay', 'visible'], false, 'photosOverlay.visible', 'validation.unknownKey'],
    ['a category named like the photos overlay', ['poiCategories', 0, 'id'], 'photos', 'poiCategories[0].id', 'validation.duplicateId'],
    ['a category named like a layer', ['poiCategories', 0, 'id'], 'kh4-1966', 'poiCategories[0].id', 'validation.duplicateId'],
    [
        'a category without an English label',
        ['poiCategories', 0, 'label', 'en'],
        undefined,
        'poiCategories[0].label.en',
        'validation.required',
    ],
    ['a capitalised icon name', ['poiCategories', 0, 'icon'], 'Church', 'poiCategories[0].icon', 'validation.format'],
    ['an icon name with a dash', ['poiCategories', 0, 'icon'], 'local-cafe', 'poiCategories[0].icon', 'validation.format'],
    ['a named category colour', ['poiCategories', 0, 'color'], 'red', 'poiCategories[0].color', 'validation.format'],
    ['a category opacity over 1', ['poiCategories', 0, 'defaultOpacity'], 1.5, 'poiCategories[0].defaultOpacity', 'validation.tooBig'],
    ['a POI in an unknown category', ['pois', 0, 'category'], 'nope', 'pois[0].category', 'validation.reference'],
    ['a POI showing an unknown photo', ['pois', 0, 'photoIds'], ['ghost'], 'pois[0].photoIds[0]', 'validation.reference'],
    ['a POI traced on an unknown layer (M27)', ['pois', 0, 'sourceLayer'], 'gone-1911', 'pois[0].sourceLayer', 'validation.reference'],
    ['a pinned flag that is no boolean (M27)', ['poiCategories', 0, 'pinned'], 'yes', 'poiCategories[0].pinned', 'validation.type'],
    ['a POI photo id that is no id', ['pois', 0, 'photoIds'], ['a b'], 'pois[0].photoIds[0]', 'validation.format'],
    ['a POI span ending before it starts', ['pois', 0, 'yearStart'], 1990, 'pois[0].yearEnd', 'validation.yearRange'],
    ['a POI year before 1500', ['pois', 0, 'yearStart'], 1499, 'pois[0].yearStart', 'validation.tooSmall'],
    ['a POI without a Romanian title', ['pois', 0, 'title'], { en: 'House' }, 'pois[0].title.ro', 'validation.required'],
    [
        'an http link in a POI text',
        ['pois', 0, 'description', 'ro'],
        '[x](http://e.org)',
        'pois[0].description.ro',
        'validation.markdownLink',
    ],
    ['a POI without links', ['pois', 0, 'links'], undefined, 'pois[0].links', 'validation.required'],
    ['a POI far outside the city', ['pois', 0, 'geometry', 'coordinates'], [27.5, 44.4], 'pois[0].geometry', 'validation.outsideCity'],
    [
        'a position with an altitude',
        ['pois', 0, 'geometry', 'coordinates'],
        [26.08, 44.42, 80],
        'pois[0].geometry.coordinates',
        'validation.tooBig',
    ],
    [
        'a longitude beyond 180',
        ['pois', 0, 'geometry', 'coordinates'],
        [181, 44.42],
        'pois[0].geometry.coordinates[0]',
        'validation.tooBig',
    ],
    ['an unsupported geometry type', ['pois', 0, 'geometry', 'type'], 'MultiPoint', 'pois[0].geometry.type', 'validation.value'],
    ['a GeoJSON bbox member', ['pois', 0, 'geometry', 'bbox'], [26, 44, 27, 45], 'pois[0].geometry.bbox', 'validation.unknownKey'],
    [
        'a line of one position',
        ['pois', 0, 'geometry'],
        { type: 'LineString', coordinates: [[26.08, 44.42]] },
        'pois[0].geometry.coordinates',
        'validation.tooSmall',
    ],
    [
        'a ring that is not closed',
        ['pois', 0, 'geometry'],
        {
            type: 'Polygon',
            coordinates: [
                squareRing(26.08, 44.42)
                    .slice(0, 4)
                    .concat([[26.07, 44.41]]),
            ],
        },
        'pois[0].geometry.coordinates[0]',
        'validation.ringClosed',
    ],
    [
        'a ring of three positions',
        ['pois', 0, 'geometry'],
        {
            type: 'Polygon',
            coordinates: [
                [
                    [26.08, 44.42],
                    [26.09, 44.42],
                    [26.08, 44.42],
                ],
            ],
        },
        'pois[0].geometry.coordinates[0]',
        'validation.tooSmall',
    ],
    [
        'a polygon without rings',
        ['pois', 0, 'geometry'],
        { type: 'Polygon', coordinates: [] },
        'pois[0].geometry.coordinates',
        'validation.tooSmall',
    ],
    [
        'a polygon partly outside the city',
        ['pois', 0, 'geometry'],
        { type: 'Polygon', coordinates: [squareRing(26.08, 44.42, 0.8)] },
        'pois[0].geometry',
        'validation.outsideCity',
    ],
] as const;

describe('manifest v1: every rule reports a localized code', () => {
    it.each(RULES)('badPath_%s', (_name, path, value, issuePath, code) => {
        expect(issuesOf(patched(path, value))).toContainEqual({ path: issuePath, code });
    });

    it.each([
        ['a year and a month', { yearEnd: undefined, month: 7 }],
        ['a year, a month and a day', { yearEnd: undefined, month: 7, day: 12 }],
        ['a month in a range of one year', { year: 1978, yearEnd: 1978, month: 12, day: 31 }],
        ['29 February of a leap year', { year: 1936, yearEnd: undefined, month: 2, day: 29 }],
        ['a source with a name', { source: { url: 'https://arhiva.example/1', label: 'Arhiva' } }],
        ['a source without a name', { source: { url: 'https://arhiva.example/1' } }],
    ])('happyPath_aPhotoWith_%s', (_name, fields) => {
        const manifest = validManifest();
        (manifest['photos'] as unknown[])[0] = JSON.parse(JSON.stringify({ ...validPhoto(), ...fields })) as unknown;

        expect(issuesOf(manifest)).toEqual([]);
    });

    it.each([
        ['a month without a year', { year: undefined, yearEnd: undefined, month: 7 }, 'photos[0].month', 'validation.datePart'],
        ['a day without a month', { yearEnd: undefined, day: 12 }, 'photos[0].day', 'validation.datePart'],
        ['a month beside a range', { month: 7 }, 'photos[0].month', 'validation.dateRange'],
        ['month 13', { yearEnd: undefined, month: 13 }, 'photos[0].month', 'validation.tooBig'],
        ['day 32', { yearEnd: undefined, month: 7, day: 32 }, 'photos[0].day', 'validation.tooBig'],
        ['31 April', { yearEnd: undefined, month: 4, day: 31 }, 'photos[0].day', 'validation.dateImpossible'],
        [
            '29 February of a common year',
            { year: 1937, yearEnd: undefined, month: 2, day: 29 },
            'photos[0].day',
            'validation.dateImpossible',
        ],
        ['29 February 1900', { year: 1900, yearEnd: undefined, month: 2, day: 29 }, 'photos[0].day', 'validation.dateImpossible'],
        ['an http source', { source: { url: 'http://arhiva.example/1' } }, 'photos[0].source.url', 'validation.httpsOnly'],
        ['a source without an address', { source: { label: 'Arhiva' } }, 'photos[0].source.url', 'validation.required'],
        [
            'an unknown key in a source',
            { source: { url: 'https://a.example', name: 'x' } },
            'photos[0].source.name',
            'validation.unknownKey',
        ],
    ])('badPath_aPhotoWith_%s', (_name, fields, path, code) => {
        const manifest = validManifest();
        (manifest['photos'] as unknown[])[0] = JSON.parse(JSON.stringify({ ...validPhoto(), ...fields })) as unknown;

        expect(issuesOf(manifest)).toContainEqual({ path, code });
    });

    it('badPath_anEndYearWithoutAYear', () => {
        const manifest = patched(['photos', 0, 'year'], undefined);

        expect(issuesOf(manifest)).toEqual([{ path: 'photos[0].yearEnd', code: 'validation.yearRange' }]);
    });

    it('badPath_tooManyLinks', () => {
        const links = Array.from({ length: MAX_LINKS + 1 }, (_, index) => ({ url: `https://example.org/${String(index)}`, label: 'x' }));

        expect(issuesOf(patched(['photos', 0, 'links'], links))).toEqual([{ path: 'photos[0].links', code: 'validation.tooBig' }]);
    });

    it('badPath_tooManyStyleConfigEntries', () => {
        const config = Object.fromEntries(Array.from({ length: 31 }, (_, index) => [`key${String(index)}`, index]));

        expect(issuesOf(patched(['city', 'basemap', 'config'], config))).toEqual([
            { path: 'city.basemap.config', code: 'validation.tooBig' },
        ]);
    });

    it('badPath_duplicateIds', () => {
        const manifest = { ...validManifest(), layers: [validLayer(), validLayer()], photos: [validPhoto(), validPhoto()] };

        expect(issuesOf(manifest)).toEqual([
            { path: 'layers[1].id', code: 'validation.duplicateId' },
            { path: 'photos[1].id', code: 'validation.duplicateId' },
        ]);
    });

    it('badPath_duplicatePoiAndCategoryIds', () => {
        const manifest = { ...validManifest(), poiCategories: [validPoiCategory(), validPoiCategory()], pois: [validPoi(), validPoi()] };

        expect(issuesOf(manifest)).toEqual([
            { path: 'poiCategories[1].id', code: 'validation.duplicateId' },
            { path: 'pois[1].id', code: 'validation.duplicateId' },
        ]);
    });

    it('badPath_anEmptyRingIsTooShortAndOpen', () => {
        const manifest = patched(['pois', 0, 'geometry'], { type: 'Polygon', coordinates: [[]] });

        expect(issuesOf(manifest)).toEqual([
            { path: 'pois[0].geometry.coordinates[0]', code: 'validation.tooSmall' },
            { path: 'pois[0].geometry.coordinates[0]', code: 'validation.ringClosed' },
        ]);
    });

    it('badPath_aRingOverTheVertexBudget', () => {
        const ring = [...Array.from({ length: MAX_GEOMETRY_VERTICES }, (_, index) => [26 + index / 10_000, 44.4]), [26, 44.4]];

        expect(issuesOf(patched(['pois', 0, 'geometry'], { type: 'Polygon', coordinates: [ring] }))).toEqual([
            { path: 'pois[0].geometry.coordinates[0]', code: 'validation.tooBig' },
        ]);
    });

    it('badPath_ringsTogetherOverTheVertexBudget', () => {
        const half = Math.ceil(MAX_GEOMETRY_VERTICES / 2);
        const ring = [...Array.from({ length: half }, (_, index) => [26 + index / 10_000, 44.4]), [26, 44.4]];

        expect(issuesOf(patched(['pois', 0, 'geometry'], { type: 'Polygon', coordinates: [ring, ring] }))).toEqual([
            { path: 'pois[0].geometry.coordinates', code: 'validation.tooBig' },
        ]);
    });

    it('badPath_tooManyRings', () => {
        const rings = Array.from({ length: MAX_POLYGON_RINGS + 1 }, () => squareRing(26.08, 44.42));

        expect(issuesOf(patched(['pois', 0, 'geometry'], { type: 'Polygon', coordinates: rings }))).toEqual([
            { path: 'pois[0].geometry.coordinates', code: 'validation.tooBig' },
        ]);
    });

    it('badPath_aLineOverTheVertexBudget', () => {
        const coordinates = Array.from({ length: MAX_GEOMETRY_VERTICES + 1 }, (_, index) => [26 + index / 10_000, 44.4]);

        expect(issuesOf(patched(['pois', 0, 'geometry'], { type: 'LineString', coordinates }))).toEqual([
            { path: 'pois[0].geometry.coordinates', code: 'validation.tooBig' },
        ]);
    });

    it('badPath_prototypePollutionKeyIsRejected', () => {
        const text = JSON.stringify(validManifest()).replace('"id":"bucuresti"', '"id":"bucuresti","__proto__":{"polluted":true}');

        const result = parseManifestJson(text);

        expect(result.ok ? [] : result.issues).toEqual([{ path: 'city.__proto__', code: 'validation.unknownKey' }]);
        expect(Object.prototype).not.toHaveProperty('polluted');
    });

    it.each([['{"version":'], ['not json'], ['']])('badPath_invalidJson_%s', (text) => {
        expect(parseManifestJson(text)).toEqual({ ok: false, issues: [{ path: '', code: 'validation.json' }] });
    });

    it('badPath_notAnObject', () => {
        expect(issuesOf(null)).toEqual([{ path: '', code: 'validation.type' }]);
    });
});

describe('the licences', () => {
    it('happyPath_everyCreativeCommonsLicenceHasItsLegalCode @S-A232-HAPPY-LICENCES', () => {
        const cc = LICENSES.filter((license) => license.startsWith('CC'));
        expect(cc).toEqual([
            'CC0',
            'CC-BY-4.0',
            'CC-BY-SA-4.0',
            'CC-BY-3.0',
            'CC-BY-SA-3.0',
            'CC-BY-SA-3.0-RO',
            'CC-BY-2.0',
            'CC-BY-SA-2.0',
        ]);
        expect(cc.every((license) => LICENSE_URLS[license]?.startsWith('https://creativecommons.org/') === true)).toBe(true);
        expect(LICENSE_URLS['CC-BY-SA-3.0-RO']).toBe('https://creativecommons.org/licenses/by-sa/3.0/ro/');
    });

    it('badPath_aLicenceWithoutALegalCodeHasNoUrl @S-A232-BAD-LICENCES', () => {
        expect([LICENSE_URLS.PD, LICENSE_URLS.permission, LICENSE_URLS['permission-legacy']]).toEqual([undefined, undefined, undefined]);
    });
});
