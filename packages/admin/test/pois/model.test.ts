import { geometryToDoc, type Geometry, type PoiDoc } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import {
    categoryItemOf,
    cityFrameOf,
    docFieldsOf,
    drawLimitsOf,
    optional,
    patched,
    poiItemOf,
    shapeOf,
    textIn,
    valueOf,
    type PoiValue,
} from '../../src/pois/model.js';
import { AREA, BOUNDS, POINT } from './world.js';

const STAMP = { updatedBy: 'admin-uid', updatedAt: { seconds: 1, nanoseconds: 0 } };

const DOC: PoiDoc = {
    category: 'biserici',
    geometry: geometryToDoc(POINT),
    title: { ro: 'Stavropoleos', en: 'Stavropoleos Church' },
    description: { ro: 'O **biserică**.' },
    yearStart: 1724,
    links: [{ url: 'https://example.org/', label: 'Despre' }],
    photoIds: ['p1'],
    published: true,
    ...STAMP,
};

describe('places: values and documents', () => {
    it('happyPath_aStoredPlaceBecomesItsValueAndBack', () => {
        const value = valueOf(DOC);

        expect(value).toEqual({
            category: 'biserici',
            geometry: POINT,
            title: { ro: 'Stavropoleos', en: 'Stavropoleos Church' },
            description: { ro: 'O **biserică**.' },
            yearStart: 1724,
            links: [{ url: 'https://example.org/', label: 'Despre' }],
            photoIds: ['p1'],
            published: true,
        });
        expect(docFieldsOf(value)).toEqual({
            category: 'biserici',
            geometry: geometryToDoc(POINT),
            title: { ro: 'Stavropoleos', en: 'Stavropoleos Church' },
            description: { ro: 'O **biserică**.' },
            yearStart: 1724,
            links: [{ url: 'https://example.org/', label: 'Despre' }],
            photoIds: ['p1'],
            published: true,
        });
    });

    it('badPath_emptyTextsAndMissingFieldsAreLeftOut', () => {
        const bare: PoiDoc = { category: 'c', geometry: geometryToDoc(AREA), title: { ro: 'A' }, published: false, ...STAMP };
        const value: PoiValue = { ...valueOf(bare), title: { ro: ' Loc ', en: '  ' }, description: { ro: ' ', en: '' }, yearEnd: 1990 };

        expect(valueOf(bare)).toEqual({ category: 'c', geometry: AREA, title: { ro: 'A' }, links: [], photoIds: [], published: false });
        expect(docFieldsOf(value)).toEqual({
            category: 'c',
            geometry: geometryToDoc(AREA),
            title: { ro: 'Loc' },
            yearEnd: 1990,
            links: [],
            photoIds: [],
            published: false,
        });
        expect(docFieldsOf({ ...value, geometry: null, description: { ro: '', en: 'Only English' } })).toEqual({
            category: 'c',
            title: { ro: 'Loc' },
            description: { ro: '', en: 'Only English' },
            yearEnd: 1990,
            links: [],
            photoIds: [],
            published: false,
        });
    });

    it('happyPath_aPatchSetsAndClearsFields', () => {
        const value = valueOf(DOC);

        expect(patched(value, { yearStart: undefined, yearEnd: 1900 })).toEqual({ ...value, yearStart: undefined, yearEnd: 1900 });
        expect('yearStart' in patched(value, { yearStart: undefined })).toBe(false);
        expect(optional('a', undefined)).toEqual({});
        expect(optional('a', 0)).toEqual({ a: 0 });
    });

    it('happyPath_rowsCategoriesAndTheCityFrame', () => {
        const item = poiItemOf({
            id: 'stavropoleos',
            path: 'cities/bucharest/pois/stavropoleos',
            data: DOC,
            version: 'v1',
            pending: false,
        });
        const category = categoryItemOf({
            id: 'biserici',
            path: 'p',
            data: { label: { ro: 'Biserici' }, icon: 'church', color: '#8b5e3c', defaultOpacity: 0.9, order: 1, ...STAMP },
            version: 'v',
            pending: false,
        });
        const city = { name: { ro: 'B' }, bounds: BOUNDS, published: true, ...STAMP };

        expect(item).toMatchObject({ id: 'stavropoleos', version: 'v1', shape: 'point', yearStart: 1724, yearEnd: null });
        expect(item).toMatchObject({ yearSeen: null, published: true });
        expect(category).toEqual({
            id: 'biserici',
            label: { ro: 'Biserici' },
            icon: 'church',
            color: '#8b5e3c',
            defaultOpacity: 0.9,
            order: 1,
        });
        expect(cityFrameOf(city)).toEqual({
            bounds: [
                [26, 44.3],
                [26.3, 44.55],
            ],
            view: { center: [26.15, 44.425], zoom: 13, bearing: 0 },
        });
        expect(cityFrameOf({ ...city, center: { lat: 44.43, lng: 26.1 }, zoom: 15 }).view).toEqual({
            center: [26.1, 44.43],
            zoom: 15,
            bearing: 0,
        });
        expect(drawLimitsOf(cityFrameOf(city))).toEqual({
            limits: [
                [25.5, 43.8],
                [26.8, 45.05],
            ],
            maxVertices: 500,
            maxRings: 20,
        });
    });

    it('happyPath_shapesAndTextsInTheAdminsLanguage', () => {
        const line: Geometry = {
            type: 'LineString',
            coordinates: [
                [26, 44],
                [26.1, 44],
            ],
        };
        expect([POINT, AREA, line].map(shapeOf)).toEqual(['point', 'area', 'line']);
        expect(textIn({ ro: 'Biserică', en: 'Church' }, 'en')).toBe('Church');
        expect(textIn({ ro: 'Biserică' }, 'en')).toBe('Biserică');
        expect(textIn({ ro: 'Biserică', en: 'Church' }, 'ro')).toBe('Biserică');
    });
});

describe('places: the old map a street was traced on (M27)', () => {
    it('happyPath_theSourceLayerTravelsFromTheDocumentToTheValueAndBack', () => {
        const value = valueOf({ ...DOC, sourceLayer: 'plan-1911' });
        expect(value.sourceLayer).toBe('plan-1911');
        expect(docFieldsOf(value)).toMatchObject({ sourceLayer: 'plan-1911' });
    });

    it('badPath_aPlaceWithoutOneHasNoSourceLayerField', () => {
        expect(valueOf(DOC)).not.toHaveProperty('sourceLayer');
        expect(docFieldsOf(patched(valueOf({ ...DOC, sourceLayer: 'x' }), { sourceLayer: undefined }))).not.toHaveProperty('sourceLayer');
    });
});
