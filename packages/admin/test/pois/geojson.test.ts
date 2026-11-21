import { MAX_GEOMETRY_VERTICES, MAX_POLYGON_RINGS } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { EXPORT_VERSION, exportFileName, exportText, planImport, readFeatures, type ImportContext } from '../../src/pois/geojson.js';
import type { CategoryItem, PoiValue } from '../../src/pois/model.js';
import { AREA, POINT, SQUARE } from './world.js';

const CONTEXT: ImportContext = {
    limits: {
        limits: [
            [25.5, 43.8],
            [26.8, 45.05],
        ],
        maxVertices: MAX_GEOMETRY_VERTICES,
        maxRings: MAX_POLYGON_RINGS,
    },
    categories: new Set(['biserici', 'parcuri']),
    existing: new Map<string, PoiValue>([
        [
            'stavropoleos',
            {
                category: 'biserici',
                geometry: POINT,
                title: { ro: 'Stavropoleos' },
                yearStart: 1890,
                links: [],
                photoIds: [],
                published: true,
            },
        ],
    ]),
    fallbackCategory: null,
};

const STAVROPOLEOS: PoiValue = {
    category: 'biserici',
    geometry: POINT,
    title: { ro: 'Stavropoleos' },
    yearStart: 1890,
    links: [],
    photoIds: [],
    published: true,
};

const CATEGORIES: CategoryItem[] = [
    { id: 'biserici', label: { ro: 'Biserici', en: 'Churches' }, icon: 'church', color: '#8b5e3c', defaultOpacity: 0.9, order: 1 },
    { id: 'parcuri', label: { ro: 'Parcuri' }, icon: 'park', color: '#1f6f43', defaultOpacity: 0.9, order: 2 },
];

/** A feature; one whose properties name no year (start, end or seen) gets a start year, as every place needs one. */
function feature(properties: Record<string, unknown>, geometry: unknown = POINT, id?: string): Record<string, unknown> {
    const hasYear = 'yearStart' in properties || 'yearEnd' in properties || 'yearSeen' in properties;
    const dated = hasYear ? properties : { yearStart: 1890, ...properties };
    return { type: 'Feature', ...(id === undefined ? {} : { id }), geometry, properties: dated };
}

describe('GeoJSON import: the file', () => {
    it('happyPath_aCollectionOrOneFeatureIsRead', () => {
        expect(readFeatures(JSON.stringify({ type: 'FeatureCollection', features: [feature({})] }))).toEqual({
            ok: true,
            features: [feature({})],
        });
        expect(readFeatures(JSON.stringify(feature({ title: 'x' })))).toEqual({ ok: true, features: [feature({ title: 'x' })] });
    });

    it('badPath_whatIsNotGeoJsonOrHoldsNothingIsRefused', () => {
        expect(readFeatures('{ not json')).toEqual({ ok: false, reason: 'not-geojson' });
        expect(readFeatures('[1, 2]')).toEqual({ ok: false, reason: 'not-geojson' });
        expect(readFeatures(JSON.stringify({ type: 'FeatureCollection', features: 'none' }))).toEqual({ ok: false, reason: 'not-geojson' });
        expect(readFeatures(JSON.stringify({ type: 'Topology' }))).toEqual({ ok: false, reason: 'not-geojson' });
        expect(readFeatures(JSON.stringify({ type: 'FeatureCollection', features: [] }))).toEqual({ ok: false, reason: 'empty' });
    });
});

describe('GeoJSON import: the plan', () => {
    it('happyPath_featuresAreSortedIntoNewUpdatedAndUnchanged', () => {
        const features = [
            feature(
                {
                    category: 'parcuri',
                    title: { ro: 'Cișmigiu', en: 'Cismigiu Gardens' },
                    yearStart: 1847,
                    links: [{ url: 'https://example.org/', label: 'Despre' }],
                },
                AREA,
            ),
            feature({ category: 'biserici', title: { ro: 'Stavropoleos' }, published: true }, POINT, 'stavropoleos'),
            feature(
                {
                    category: 'biserici',
                    title: 'Stavropoleos nou',
                    description: { ro: 'Text', en: 'Text' },
                    yearEnd: 1990,
                    photoIds: ['p1', 7],
                },
                POINT,
                'stavropoleos',
            ),
            feature({ category: 'biserici', title: { ro: 'Necunoscut' }, published: false }, POINT, 'nu-exista'),
        ];

        const plan = planImport(features, CONTEXT);

        expect(plan.created.map((place) => [place.number, place.id, place.value.title])).toEqual([
            [1, null, { ro: 'Cișmigiu', en: 'Cismigiu Gardens' }],
            [4, null, { ro: 'Necunoscut' }],
        ]);
        expect(plan.created[0]?.value).toMatchObject({
            yearStart: 1847,
            links: [{ url: 'https://example.org/', label: 'Despre' }],
            published: true,
        });
        expect(plan.created[1]?.value.published).toBe(false);
        expect(plan.updated.map((place) => [place.number, place.id])).toEqual([[3, 'stavropoleos']]);
        expect(plan.updated[0]?.value).toMatchObject({ description: { ro: 'Text', en: 'Text' }, yearEnd: 1990, photoIds: ['p1'] });
        expect(plan.unchanged).toBe(1);
        expect(plan.refused).toEqual([]);
        expect(plan.uncategorised).toBe(0);
    });

    it('badPath_eachRefusedFeatureSaysWhy', () => {
        const open = [
            [26.1, 44.43],
            [26.11, 44.43],
            [26.11, 44.44],
            [26.1, 44.44],
        ];
        const features = [
            feature({ title: 'Multi' }, { type: 'MultiPoint', coordinates: [[26.1, 44.43]] }),
            feature({ title: 'Sus' }, { type: 'Point', coordinates: [26.1, 44.43, 80] }),
            feature({ title: 'Deschis' }, { type: 'Polygon', coordinates: [open] }),
            feature(
                { title: 'Mare' },
                { type: 'LineString', coordinates: Array.from({ length: 501 }, (_unused, index) => [26 + index / 10_000, 44.4]) },
            ),
            feature({ category: 'biserici', title: 'Departe' }, { type: 'Point', coordinates: [28, 44] }),
            feature(
                { category: 'biserici', title: 'Fluture' },
                {
                    type: 'Polygon',
                    coordinates: [
                        [
                            [26.0, 44.4],
                            [26.1, 44.5],
                            [26.1, 44.4],
                            [26.0, 44.45],
                            [26.0, 44.4],
                        ],
                    ],
                },
            ),
            feature({ category: 'nimic', title: 'Fără categorie' }),
            feature({ category: 'biserici', title: { en: 'English only' } }),
            feature({ category: 'biserici', title: 'Rău', links: [{ url: 'http://example.org/', label: 'x' }] }),
            feature({ category: 'biserici', title: 'Greșit' }, { type: 'Point', coordinates: ['26', 44] }),
            'not a feature',
            null,
        ];

        const plan = planImport(features, CONTEXT);

        expect(plan.refused.map((refusal) => [refusal.number, refusal.title, refusal.reason, refusal.path])).toEqual([
            [1, 'Multi', 'unsupported-type', null],
            [2, 'Sus', 'altitude', null],
            [3, 'Deschis', 'open-ring', null],
            [4, 'Mare', 'too-many-positions', null],
            [5, 'Departe', 'outside', 'geometry'],
            [6, 'Fluture', 'bad-shape', 'geometry'],
            [7, 'Fără categorie', 'unknown-category', null],
            [8, '', 'invalid', 'title.ro'],
            [9, 'Rău', 'invalid', 'links[0].url'],
            [10, 'Greșit', 'invalid', null],
            [11, null, 'unsupported-type', null],
            [12, null, 'unsupported-type', null],
        ]);
        expect(plan.created).toEqual([]);
    });

    it('happyPath_featuresWithoutAKnownCategoryTakeTheChosenOne', () => {
        const features = [
            feature({ title: 'Fără' }),
            feature({ category: 'nimic', title: 'Alta' }),
            feature({ category: 'parcuri', title: 'Parc' }),
        ];

        const plan = planImport(features, { ...CONTEXT, fallbackCategory: 'biserici' });
        const unknown = planImport(features, { ...CONTEXT, categories: null, fallbackCategory: 'biserici' });

        expect(plan.created.map((place) => place.value.category)).toEqual(['biserici', 'biserici', 'parcuri']);
        expect(plan.uncategorised).toBe(2);
        expect(unknown.uncategorised).toBe(3);
    });

    it('badPath_markupInImportedTextStaysText', () => {
        const plan = planImport([feature({ category: 'biserici', title: '<img src=x onerror=alert(1)>' })], CONTEXT);

        expect(plan.created[0]?.value.title).toEqual({ ro: '<img src=x onerror=alert(1)>' });
    });
});

describe('GeoJSON import: the years', () => {
    it('happyPath_aFeatureWithOnlyYearSeenIsAccepted', () => {
        const plan = planImport(
            [feature({ category: 'biserici', title: 'Strada Rozelor', yearSeen: 1939, sourceLayer: 'harta-bucuresti-1939' })],
            CONTEXT,
        );
        const [place] = plan.created;

        expect(plan.refused).toEqual([]);
        expect(place?.value.yearSeen).toBe(1939);
        expect(place?.value.sourceLayer).toBe('harta-bucuresti-1939');
        expect(place?.value.yearStart).toBeUndefined();
        expect(place?.value.yearEnd).toBeUndefined();
    });

    it('badPath_aFeatureWithoutAYearAndWithoutYearSeenIsRefusedAtItsStartYear', () => {
        const plan = planImport(
            [feature({ category: 'biserici', title: 'Fără an', yearStart: 'demult' }), feature({ category: 'biserici', title: 'Cu an' })],
            CONTEXT,
        );

        expect(plan.refused).toEqual([{ number: 1, title: 'Fără an', reason: 'invalid', path: 'yearStart' }]);
        expect(plan.created.map((place) => place.value.yearStart)).toEqual([1890]);
    });
});

describe('GeoJSON export', () => {
    it('happyPath_theExportNamesTheCityAndTheCategoriesItUsesAndImportsUnchanged', () => {
        const places = [
            { id: 'stavropoleos', value: STAVROPOLEOS },
            {
                id: 'cismigiu',
                value: {
                    category: 'parcuri',
                    geometry: AREA,
                    title: { ro: 'Cișmigiu' },
                    description: { ro: 'Parc' },
                    yearStart: 1847,
                    yearEnd: 2000,
                    links: [],
                    photoIds: ['p1'],
                    published: false,
                } satisfies PoiValue,
            },
        ];

        const text = exportText('bucharest', places, CATEGORIES);
        const parsed = JSON.parse(text) as { hcm: unknown; features: unknown[] };
        const again = readFeatures(text);
        const plan = again.ok
            ? planImport(again.features, { ...CONTEXT, existing: new Map(places.map((place) => [place.id, place.value])) })
            : null;

        expect(parsed.hcm).toEqual({
            version: EXPORT_VERSION,
            city: 'bucharest',
            categories: [
                { id: 'biserici', label: { ro: 'Biserici', en: 'Churches' }, icon: 'church', color: '#8b5e3c' },
                { id: 'parcuri', label: { ro: 'Parcuri' }, icon: 'park', color: '#1f6f43' },
            ],
        });
        expect(parsed.features[1]).toEqual({
            type: 'Feature',
            id: 'cismigiu',
            geometry: { type: 'Polygon', coordinates: [SQUARE] },
            properties: {
                category: 'parcuri',
                title: { ro: 'Cișmigiu' },
                description: { ro: 'Parc' },
                yearStart: 1847,
                yearEnd: 2000,
                links: [],
                photoIds: ['p1'],
                published: false,
            },
        });
        expect(plan).toMatchObject({ created: [], updated: [], unchanged: 2, refused: [] });
        expect(exportFileName('bucharest', new Date(Date.UTC(2026, 9, 17, 23, 0)))).toBe('bucharest-places-2026-10-17.geojson');
    });

    it('badPath_aPlaceWithoutAShapeIsLeftOutOfTheExport', () => {
        const text = exportText('bucharest', [{ id: 'nou', value: { ...STAVROPOLEOS, geometry: null } }], CATEGORIES);

        expect(JSON.parse(text)).toMatchObject({ features: [], hcm: { categories: [{ id: 'biserici' }] } });
    });
});

describe('GeoJSON: the old map a street was traced on (M27)', () => {
    it('happyPath_aSourceLayerIdIsImportedAndExported', () => {
        const plan = planImport([feature({ category: 'biserici', title: { ro: 'Strada Veche' }, sourceLayer: 'plan-1911' })], CONTEXT);
        expect(plan.created[0]?.value.sourceLayer).toBe('plan-1911');

        const text = exportText('bucharest', [{ id: 'veche', value: { ...STAVROPOLEOS, sourceLayer: 'plan-1911' } }], CATEGORIES);
        const parsed = JSON.parse(text) as { features: { properties: Record<string, unknown> }[] };
        expect(parsed.features[0]?.properties['sourceLayer']).toBe('plan-1911');
    });

    it('badPath_aSourceLayerThatIsNotAnIdIsDropped', () => {
        const plan = planImport(
            [
                feature({ category: 'biserici', title: { ro: 'A' }, sourceLayer: 'Not an id!' }),
                feature({ category: 'biserici', title: { ro: 'B' }, sourceLayer: 42 }),
            ],
            CONTEXT,
        );
        expect(plan.created.map((place) => place.value.sourceLayer)).toEqual([undefined, undefined]);
        expect(plan.refused).toEqual([]);

        const text = exportText('bucharest', [{ id: 'stavropoleos', value: STAVROPOLEOS }], CATEGORIES);
        const parsed = JSON.parse(text) as { features: { properties: Record<string, unknown> }[] };
        expect(parsed.features[0]?.properties).not.toHaveProperty('sourceLayer');
    });
});
