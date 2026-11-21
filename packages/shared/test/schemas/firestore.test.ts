import type { z } from 'zod';
import { describe, expect, it } from 'vitest';

import { timestampSchema } from '../../src/schemas/firestore-common.js';
import {
    cityDocSchema,
    historyEntryDocSchema,
    layerDocSchema,
    photoDocSchema,
    poiCategoryDocSchema,
    poiDocSchema,
} from '../../src/schemas/firestore.js';
import { validate, type ValidationResult } from '../../src/schemas/validation.js';

/** One entry point for every document schema (the tables below mix them). */
function check(schema: z.ZodType, doc: unknown): ValidationResult<unknown> {
    return validate(schema, doc);
}

/** What the Firestore SDKs return: a class instance whose `seconds`/`nanoseconds` are getters. */
class FakeTimestamp {
    readonly #seconds: number;
    readonly #nanoseconds: number;

    constructor(seconds: number, nanoseconds = 0) {
        this.#seconds = seconds;
        this.#nanoseconds = nanoseconds;
    }

    get seconds(): number {
        return this.#seconds;
    }

    get nanoseconds(): number {
        return this.#nanoseconds;
    }
}

const now = new FakeTimestamp(1_760_000_000);
const stamp = { updatedBy: 'uid-admin', updatedAt: now };

const docs = {
    city: {
        id: 'bucuresti',
        name: { ro: 'București dispărut' },
        bounds: { west: 25.93, south: 44.33, east: 26.25, north: 44.55 },
        center: { lat: 44.427037, lng: 26.085298 },
        zoom: 14.5,
        about: { ro: '**Despre**' },
        mapbox: { user: 'ventura86', publicToken: 'pk.test-viewer-token' },
        analytics: { measurementId: 'G-TEST1234' },
        photosOverlay: { defaultOpacity: 0.7 },
        published: false,
        createdAt: now,
        ...stamp,
    },
    photo: {
        title: { ro: 'Mihai Vodă', en: 'Mihai Vodă street' },
        year: 1978,
        license: 'unknown',
        location: { lat: 44.43, lng: 26.09 },
        links: [{ url: 'https://example.org/x', label: 'x' }],
        sourceUrl: 'https://example.org/source',
        published: false,
        processing: 'done',
        image: {
            web: 'https://storage.example.org/w.webp',
            thumb: 'https://storage.example.org/t.webp',
            sha256: 'a'.repeat(64),
            w: 10,
            h: 10,
        },
        exif: { Make: 'Zenit', FNumber: 8 },
        ...stamp,
    },
    layer: {
        year: 1966,
        label: { ro: 'Corona 1966' },
        kind: 'satellite',
        source: { type: 'mapbox', tilesetId: 'test-owner.kh4-1966' },
        minzoom: 10,
        maxzoom: 17,
        bounds: { west: 25.95, south: 44.35, east: 26.2, north: 44.5 },
        order: 1,
        opacity: 1,
        defaultVisible: true,
        status: 'awaiting_approval',
        published: false,
        provenance: {
            usgsEntityId: 'DS1035-1057DA023',
            usgsDataset: 'corona2',
            georef: { method: 'gcps', gcpCount: 12, checkpointRmseM: 8.5 },
        },
        mapbox: { tilesetId: 'test-owner.kh4-1966', publishedSourceSha: 'b'.repeat(64) },
        adjustments: { brightnessMin: 0.05, contrast: 0.3 },
        updatedBy: 'system:pipeline',
        updatedAt: now,
    },
    poiCategory: {
        label: { ro: 'Clădiri dispărute' },
        icon: 'domain_disabled',
        color: '#8B5E3C',
        defaultOpacity: 0.9,
        order: 2,
        ...stamp,
    },
    poi: {
        category: 'cladiri',
        geometry: {
            type: 'Polygon',
            rings: [
                {
                    points: [
                        { lat: 44.4268, lng: 26.086 },
                        { lat: 44.4268, lng: 26.0878 },
                        { lat: 44.4278, lng: 26.0878 },
                        { lat: 44.4268, lng: 26.086 },
                    ],
                },
            ],
        },
        title: { ro: 'Cvartal demolat' },
        description: { ro: '**Demolat** în 1986.', en: '**Demolished** in 1986.' },
        yearEnd: 1986,
        links: [{ url: 'https://example.org/poi', label: 'Sursa' }],
        photoIds: ['mihai-voda-1978'],
        published: true,
        createdAt: now,
        createdBy: 'uid-admin',
        ...stamp,
    },
    history: {
        entity: 'poi',
        entityId: 'cvartal',
        action: 'update',
        previous: { title: { ro: 'Cvartal' }, published: false, updatedBy: 'uid-admin', updatedAt: now },
        changedFields: ['title', 'published'],
        ...stamp,
    },
};

describe('Firestore documents: happy paths', () => {
    it.each([
        ['city', cityDocSchema, docs.city],
        ['photo', photoDocSchema, docs.photo],
        ['layer', layerDocSchema, docs.layer],
        ['poiCategory', poiCategoryDocSchema, docs.poiCategory],
        ['poi', poiDocSchema, docs.poi],
        ['history', historyEntryDocSchema, docs.history],
        ['history create', historyEntryDocSchema, { ...docs.history, action: 'create', previous: null, changedFields: [] }],
        ['history revert', historyEntryDocSchema, { ...docs.history, action: 'revert', revertOf: 'entry-41' }],
        ['history entry naming its city (CR-M2c-14)', historyEntryDocSchema, { ...docs.history, cityId: 'bucharest' }],
        [
            'a revert that restores a deleted document',
            historyEntryDocSchema,
            { ...docs.history, action: 'revert', revertOf: 'entry-41', previous: null },
        ],
        ['a point POI', poiDocSchema, { ...docs.poi, geometry: { type: 'Point', point: { lat: 44.43, lng: 26.09 } } }],
    ] as const)('happyPath_%s', (_name, schema, doc) => {
        expect(check(schema, doc)).toMatchObject({ ok: true });
    });

    it('happyPath_aYearRange', () => {
        expect(check(photoDocSchema, { ...docs.photo, year: 1978, yearEnd: 1980 })).toMatchObject({ ok: true });
    });

    it('happyPath_aPlainTimestampObjectIsAccepted', () => {
        expect(timestampSchema.safeParse({ seconds: 1, nanoseconds: 2 }).success).toBe(true);
    });
});

describe('Firestore documents: bad paths', () => {
    it.each([
        ['a city without a stamp', cityDocSchema, { ...docs.city, updatedAt: undefined }, 'updatedAt', 'validation.required'],
        [
            'inverted city bounds',
            cityDocSchema,
            { ...docs.city, bounds: { west: 27, south: 44, east: 26, north: 45 } },
            'bounds',
            'validation.bounds',
        ],
        [
            'a secret token on the city',
            cityDocSchema,
            { ...docs.city, mapbox: { publicToken: 'sk.secret-scenario' } },
            'mapbox.publicToken',
            'validation.format',
        ],
        ['a photo without processing state', photoDocSchema, { ...docs.photo, processing: undefined }, 'processing', 'validation.required'],
        ['an unknown photo field', photoDocSchema, { ...docs.photo, html: '<b>x</b>' }, 'html', 'validation.unknownKey'],
        [
            'a photo end year without a year',
            photoDocSchema,
            { ...docs.photo, year: undefined, yearEnd: 1980 },
            'yearEnd',
            'validation.yearRange',
        ],
        [
            'a short image hash',
            photoDocSchema,
            { ...docs.photo, image: { ...docs.photo.image, sha256: 'abc' } },
            'image.sha256',
            'validation.format',
        ],
        ['an end year before the year', photoDocSchema, { ...docs.photo, year: 1981, yearEnd: 1980 }, 'yearEnd', 'validation.yearRange'],
        [
            'a day that month does not have',
            photoDocSchema,
            { ...docs.photo, year: 1937, yearEnd: 1937, month: 2, day: 29 },
            'day',
            'validation.dateImpossible',
        ],
        ['a month beside a range', photoDocSchema, { ...docs.photo, year: 1936, yearEnd: 1940, month: 7 }, 'month', 'validation.dateRange'],
        ['an unknown layer status', layerDocSchema, { ...docs.layer, status: 'live' }, 'status', 'validation.value'],
        [
            'an unknown georeferencing method',
            layerDocSchema,
            { ...docs.layer, provenance: { georef: { method: 'magic' } } },
            'provenance.georef.method',
            'validation.value',
        ],
    ] as const)('badPath_%s', (_name, schema, doc, path, code) => {
        const result = check(schema, doc);

        expect(result.ok ? [] : result.issues).toContainEqual({ path, code });
    });

    it('badPath_aHistorySnapshotOfTooManyFields', () => {
        const previous = Object.fromEntries(Array.from({ length: 101 }, (_, index) => [`field${String(index)}`, index]));

        const result = check(historyEntryDocSchema, { ...docs.history, previous });

        expect(result.ok ? [] : result.issues).toEqual([{ path: 'previous', code: 'validation.tooBig' }]);
    });

    it.each([[null], [{ seconds: '1', nanoseconds: 0 }], [{ seconds: 1 }], [new Date()]])('badPath_timestamp_%j', (value) => {
        expect(timestampSchema.safeParse(value).success).toBe(false);
    });
});

/** PLAN Addendum 3: stamps on every audited document, POIs, POI categories, history entries, adjustments. */
const ADDENDUM_3_BAD = [
    ['a layer without a stamp', layerDocSchema, { ...docs.layer, updatedBy: undefined }, 'updatedBy', 'validation.required'],
    [
        'an adjustment out of range',
        layerDocSchema,
        { ...docs.layer, adjustments: { saturation: -2 } },
        'adjustments.saturation',
        'validation.tooSmall',
    ],
    [
        'a photos overlay over 1',
        cityDocSchema,
        { ...docs.city, photosOverlay: { defaultOpacity: 2 } },
        'photosOverlay.defaultOpacity',
        'validation.tooBig',
    ],
    ['a category without a stamp', poiCategoryDocSchema, { ...docs.poiCategory, updatedAt: undefined }, 'updatedAt', 'validation.required'],
    ['a category icon with spaces', poiCategoryDocSchema, { ...docs.poiCategory, icon: 'a b' }, 'icon', 'validation.format'],
    ['a fractional category order', poiCategoryDocSchema, { ...docs.poiCategory, order: 1.5 }, 'order', 'validation.type'],
    ['a POI without a stamp', poiDocSchema, { ...docs.poi, updatedBy: undefined }, 'updatedBy', 'validation.required'],
    ['a POI without published', poiDocSchema, { ...docs.poi, published: undefined }, 'published', 'validation.required'],
    ['an inverted POI span', poiDocSchema, { ...docs.poi, yearStart: 1990 }, 'yearEnd', 'validation.yearRange'],
    ['a POI category that is no id', poiDocSchema, { ...docs.poi, category: '../x' }, 'category', 'validation.format'],
    [
        'GeoJSON arrays in a POI document',
        poiDocSchema,
        { ...docs.poi, geometry: { type: 'Point', coordinates: [26.09, 44.43] } },
        'geometry.coordinates',
        'validation.unknownKey',
    ],
    [
        'an http link in a POI text',
        poiDocSchema,
        { ...docs.poi, description: { ro: '[x](http://e.org)' } },
        'description.ro',
        'validation.markdownLink',
    ],
    ['an unknown history entity', historyEntryDocSchema, { ...docs.history, entity: 'job' }, 'entity', 'validation.value'],
    [
        'a history entry whose city leaves its segment',
        historyEntryDocSchema,
        { ...docs.history, cityId: 'a/b' },
        'cityId',
        'validation.format',
    ],
    ['a create with a previous version', historyEntryDocSchema, { ...docs.history, action: 'create' }, 'previous', 'validation.value'],
    ['an update without a previous version', historyEntryDocSchema, { ...docs.history, previous: null }, 'previous', 'validation.value'],
    [
        'a delete without a previous version',
        historyEntryDocSchema,
        { ...docs.history, action: 'delete', previous: null },
        'previous',
        'validation.value',
    ],
    ['a revert without its entry', historyEntryDocSchema, { ...docs.history, action: 'revert' }, 'revertOf', 'validation.value'],
    ['an update naming a reverted entry', historyEntryDocSchema, { ...docs.history, revertOf: 'entry-41' }, 'revertOf', 'validation.value'],
    [
        'a history entry without a stamp',
        historyEntryDocSchema,
        { ...docs.history, updatedAt: undefined },
        'updatedAt',
        'validation.required',
    ],
] as const;

describe('Firestore documents of PLAN Addendum 3: bad paths', () => {
    it.each(ADDENDUM_3_BAD)('badPath_%s', (_name, schema, doc, path, code) => {
        const result = check(schema, doc);

        expect(result.ok ? [] : result.issues).toContainEqual({ path, code });
    });
});

/** M2: what `photos.onUpload` and `setup.saveMapbox` add to the content documents. */
describe('Firestore content documents of M2', () => {
    const processed = {
        ...docs.photo,
        processing: 'failed',
        processingError: 'apiError.photo.unsupportedType',
        duplicateOf: 'mihai-voda-1978',
        suggested: { location: { lat: 44.43, lng: 26.09 }, year: 1936, bearing: 120, title: 'Strada Uranus' },
        original: { path: 'originals/photos/bucuresti/p1/x.jpg', contentType: 'image/jpeg', bytes: 1234, sha256: 'c'.repeat(64) },
    };

    it('happyPath_aProcessedPhotoWithSuggestionsAndItsOriginal', () => {
        expect(check(photoDocSchema, processed)).toMatchObject({ ok: true });
    });

    it('happyPath_aLegacyDateTextWithARomanianTitleOnly', () => {
        expect(check(photoDocSchema, { ...docs.photo, title: { ro: 'Uranus' }, dateText: { ro: 'Iulie 1936' } })).toMatchObject({
            ok: true,
        });
    });

    it('happyPath_theViewerTokenIdAndItsOrigins', () => {
        const mapbox = { ...docs.city.mapbox, publicTokenId: 'cijucimbe000brbkt48d0dhcx', allowedUrls: ['https://ventura8.github.io'] };

        expect(check(cityDocSchema, { ...docs.city, mapbox })).toMatchObject({ ok: true });
    });

    it.each([
        [
            'a processing error that is no code',
            photoDocSchema,
            { ...processed, processingError: 'boom' },
            'processingError',
            'validation.value',
        ],
        [
            'an original of an SVG',
            photoDocSchema,
            { ...processed, original: { ...processed.original, contentType: 'image/svg+xml' } },
            'original.contentType',
            'validation.value',
        ],
        ['a photo without a Romanian title', photoDocSchema, { ...docs.photo, title: { en: 'Uranus' } }, 'title.ro', 'validation.required'],
        [
            'a suggested year out of range',
            photoDocSchema,
            { ...processed, suggested: { year: 1700 } },
            'suggested.year',
            'validation.tooSmall',
        ],
        [
            'an allowed URL with a path',
            cityDocSchema,
            { ...docs.city, mapbox: { allowedUrls: ['https://ventura8.github.io/bucuresti'] } },
            'mapbox.allowedUrls[0]',
            'validation.format',
        ],
        [
            'a token id with capitals',
            cityDocSchema,
            { ...docs.city, mapbox: { publicTokenId: 'ABC' } },
            'mapbox.publicTokenId',
            'validation.format',
        ],
    ] as const)('badPath_%s', (_name, schema, doc, path, code) => {
        const result = check(schema, doc);

        expect(result.ok ? [] : result.issues).toContainEqual({ path, code });
    });
});
