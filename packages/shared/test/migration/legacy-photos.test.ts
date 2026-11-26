import { describe, expect, it } from 'vitest';

import { conePolygon } from '../../src/geo/cone.js';
import type { LngLat } from '../../src/geo/math.js';
import { legacyFileName, migrateLegacyPhotos, type LegacyMigration, type MigratedPhoto } from '../../src/migration/legacy-photos.js';

const BASE = 'https://legacy.example/photos/';

function point(photo: string, coordinates: LngLat, properties: Record<string, unknown> = {}, id = ''): Record<string, unknown> {
    return {
        type: 'Feature',
        ...(id === '' ? {} : { id }),
        geometry: { type: 'Point', coordinates },
        properties: {
            title: 'Titlu',
            photo: `${BASE}${photo}`,
            author: '',
            year: '',
            source: '',
            description: '',
            'marker-color': '#3ca0d3',
            ...properties,
        },
    };
}

function cone(photo: string, apex: LngLat, bearing: number, fov: number, distanceM = 40): Record<string, unknown> {
    return {
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [conePolygon(apex, { bearing, fov, distanceM }, 1)] },
        properties: { title: 'Titlu', photo: `${BASE}${photo}`, author: '', year: '', source: '', description: '', fill: '#555' },
    };
}

function migrate(features: readonly unknown[]): LegacyMigration {
    return migrateLegacyPhotos({ type: 'FeatureCollection', features });
}

function byId(migration: LegacyMigration, id: string): MigratedPhoto | undefined {
    return migration.photos.find((photo) => photo.photo.id === id);
}

const UNIRII: LngLat = [26.1025, 44.4268];
const IZVOR: LngLat = [26.0839, 44.4302];

describe('migrateLegacyPhotos: photos and cones', () => {
    it('happyPath_pointWithItsConeBecomesOnePhoto', () => {
        const migration = migrate([
            point('Mihai Voda 1978.jpg', UNIRII, { title: ' Mihai Vodă ', author: ' Dan Vartanian ', year: 1978 }, 'legacy-1'),
            cone('Mihai Voda 1978.jpg', UNIRII, 46.8, 51),
        ]);

        expect(migration).toEqual({
            cones: 1,
            warnings: [],
            photos: [
                {
                    sourceFile: 'Mihai Voda 1978.jpg',
                    legacyId: 'legacy-1',
                    photo: {
                        id: 'mihai-voda-1978',
                        title: { ro: 'Mihai Vodă' },
                        links: [],
                        year: 1978,
                        author: 'Dan Vartanian',
                        license: 'permission-legacy',
                        rightsReview: true,
                        location: { lat: 44.4268, lng: 26.1025 },
                        bearing: 46.8,
                        fov: 51,
                    },
                },
            ],
        });
    });

    it('happyPath_oneFileShownFromTwoPlacesStaysTwoPhotos', () => {
        const near: LngLat = [UNIRII[0] + 0.0002, UNIRII[1]];
        const migration = migrate([
            point('Al Orascu.jpg', UNIRII),
            cone('Al Orascu.jpg', near, 248.8, 47),
            point('Al Orascu.jpg', near),
            cone('Al Orascu.jpg', UNIRII, 194.4, 60),
        ]);

        expect(migration.photos.map((photo) => [photo.photo.id, photo.photo.bearing, photo.photo.fov])).toEqual([
            ['al-orascu', 194.4, 60],
            ['al-orascu-2', 248.8, 47],
        ]);
        expect(migration.cones).toBe(2);
    });

    it('happyPath_aConeWithoutAPointIsAPhotoAtItsApex', () => {
        const migration = migrate([cone('Fonteriei.jpg', IZVOR, 164.3, 45)]);

        expect(byId(migration, 'fonteriei')?.photo).toMatchObject({ location: { lat: IZVOR[1], lng: IZVOR[0] }, bearing: 164.3, fov: 45 });
        expect(migration.warnings).toEqual([
            { feature: 0, message: "a cone without a photo point: Fonteriei.jpg placed at the cone's apex" },
        ]);
    });

    it('happyPath_photosKeepFeatureOrderWithOrphansInTheirPlace', () => {
        const migration = migrate([point('b.jpg', UNIRII), cone('a.jpg', IZVOR, 10, 40), point('c.jpg', IZVOR)]);

        expect(migration.photos.map((photo) => photo.photo.id)).toEqual(['b', 'a', 'c']);
    });

    it('happyPath_aConeFindsItsPointWhateverTheUrlsSpellingOrHost', () => {
        // The old site wrote one photo's URL with spaces, %20 or on another host, and in two Unicode forms (ţ, t + U+0327).
        const spelled = (url: string, feature: Record<string, unknown>): Record<string, unknown> => ({
            ...feature,
            properties: { ...(feature['properties'] as Record<string, unknown>), photo: url },
        });
        const migration = migrate([
            spelled('https://one.example/photos/parcul ferdinand 1930.jpg', point('x.jpg', UNIRII)),
            spelled('https://two.example/photos/parcul%20ferdinand%201930.jpg', cone('x.jpg', UNIRII, 251.4, 54)),
            spelled(`${BASE}Piaţa.jpg`, point('x.jpg', IZVOR)),
            spelled(`${BASE}Piaţa.jpg`, cone('x.jpg', IZVOR, 12, 40)),
        ]);

        expect(migration.photos.map((photo) => [photo.photo.id, photo.photo.bearing, photo.photo.fov])).toEqual([
            ['parcul-ferdinand-1930', 251.4, 54],
            ['piata', 12, 40],
        ]);
        expect(migration.warnings).toEqual([]);
    });

    it('badPath_aConeOfAnotherFileStaysItsOwnPhoto', () => {
        const migration = migrate([point('Coltul strada Fonteriei.jpg', IZVOR), cone('Fonteriei.jpg', IZVOR, 164.3, 45)]);

        expect(migration.photos.map((photo) => [photo.photo.id, photo.photo.bearing ?? null])).toEqual([
            ['coltul-strada-fonteriei', null],
            ['fonteriei', 164.3],
        ]);
    });

    it('badPath_aSecondConeForThePhotoIsIgnored', () => {
        const migration = migrate([point('x.jpg', UNIRII), cone('x.jpg', UNIRII, 10, 40), cone('x.jpg', UNIRII, 200, 40)]);

        expect(byId(migration, 'x')?.photo.bearing).toBeCloseTo(10, 1);
        expect(migration.warnings).toEqual([{ feature: 2, message: 'ignored: a second cone for the photo of feature 0' }]);
    });

    it('badPath_aDegenerateConeLeavesThePhotoWithoutBearing', () => {
        const flat = { ...cone('x.jpg', UNIRII, 10, 40), geometry: { type: 'Polygon', coordinates: [[UNIRII, UNIRII, UNIRII, UNIRII]] } };

        const migration = migrate([point('x.jpg', UNIRII), flat]);

        expect(byId(migration, 'x')?.photo.bearing).toBeUndefined();
        expect(migration.warnings).toEqual([{ feature: 1, message: 'ignored: a degenerate cone' }]);
    });

    it('badPath_anEmptyConeRingIsSkipped', () => {
        const empty = { ...cone('z.jpg', UNIRII, 10, 40), geometry: { type: 'Polygon', coordinates: [[]] } };

        const migration = migrate([point('z.jpg', UNIRII), empty]);

        expect(migration.photos.map((photo) => photo.photo.bearing)).toEqual([undefined]);
        expect(migration.warnings).toEqual([{ feature: 1, message: 'skipped: a cone without a photo point and without a usable shape' }]);
    });

    it('badPath_aDegenerateOrphanConeIsSkipped', () => {
        const flat = { ...cone('y.jpg', UNIRII, 10, 40), geometry: { type: 'Polygon', coordinates: [[UNIRII, UNIRII, UNIRII, UNIRII]] } };

        const migration = migrate([flat]);

        expect(migration.photos).toEqual([]);
        expect(migration.warnings).toEqual([{ feature: 0, message: 'skipped: a cone without a photo point and without a usable shape' }]);
    });
});

describe('migrateLegacyPhotos: photos joining an earlier migration', () => {
    it('happyPath_theNewIdsKeepClearOfTheReservedOnesAndStayStable', () => {
        const features = [
            point('Gara Obor.jpg', UNIRII, {}, 'legacy-new'),
            cone('Gara Obor.jpg', UNIRII, 90, 50),
            point('La leu.jpeg', IZVOR),
        ];
        const reserved = ['gara-obor'];

        const joined = migrateLegacyPhotos({ type: 'FeatureCollection', features }, undefined, reserved);

        expect(joined.photos.map((photo) => [photo.photo.id, photo.legacyId ?? null, photo.photo.bearing ?? null])).toEqual([
            ['gara-obor-2', 'legacy-new', 90],
            ['la-leu', null, null],
        ]);
        expect(migrateLegacyPhotos({ type: 'FeatureCollection', features }, undefined, reserved)).toEqual(joined);
        expect(migrate(features).photos[0]?.photo.id).toBe('gara-obor');
    });
});

describe('migrateLegacyPhotos: texts, links and dates', () => {
    it('happyPath_htmlBecomesTextAndLinks', () => {
        const migration = migrate([
            point('a.jpg', UNIRII, {
                source: '<a href="https://www.flickr.com/photos/1/" target="_blank">Flickr</a>',
                description:
                    '<p>Vedere spre sud.</p><p>Alte legături:&nbsp;<a href="http://www.costingheorghe.ro/thenow/a/">thenow</a></p>',
            }),
        ]);

        expect(migration.photos[0]?.photo).toMatchObject({
            description: { ro: 'Vedere spre sud.' },
            links: [
                { url: 'https://www.flickr.com/photos/1/', label: 'Flickr' },
                { url: 'https://www.costingheorghe.ro/thenow/a/', label: 'thenow' },
            ],
        });
    });

    it('happyPath_sourceTextOutsideLinksIsKept', () => {
        const migration = migrate([point('a.jpg', UNIRII, { source: 'Arhiva familiei' })]);

        expect(migration.photos[0]?.photo.description).toEqual({ ro: 'Arhiva familiei' });
    });

    it('happyPath_dateInWordsAndYearFromTheFileName', () => {
        const migration = migrate([point('obor-1936.jpg', UNIRII, { year: 'Iulie 1936' }), point('Arionoaia 1980.jpg', IZVOR)]);

        expect(migration.photos.map((photo) => [photo.photo.year, photo.photo.dateText])).toEqual([
            [1936, { ro: 'Iulie 1936' }],
            [1980, undefined],
        ]);
    });

    it('badPath_unsafeAndExtraLinksAreReported', () => {
        const anchors = Array.from({ length: 6 }, (_, index) => `<a href="https://example.org/${String(index)}">${String(index)}</a>`).join(
            ' ',
        );

        const migration = migrate([point('a.jpg', UNIRII, { source: `${anchors} <a href="http://unknown.example/">x</a>` })]);

        expect(migration.photos[0]?.photo.links).toHaveLength(5);
        expect(migration.warnings).toEqual([
            { feature: 0, message: 'dropped a link that is not https: http://unknown.example/' },
            { feature: 0, message: 'kept the first 5 of 6 links' },
        ]);
    });

    it('badPath_anEmptyTitleBecomesTheFileName', () => {
        const migration = migrate([point('Gara Obor.jpg', UNIRII, { title: '  ' })]);

        expect(migration.photos[0]?.photo.title).toEqual({ ro: 'Gara Obor' });
        expect(migration.warnings).toEqual([{ feature: 0, message: 'no title: the file name Gara Obor.jpg is used' }]);
    });
});

describe('migrateLegacyPhotos: bad input', () => {
    it.each([[null], [{ type: 'Feature' }], [[]], ['text']])('badPath_notACollection_%j', (input) => {
        expect(migrateLegacyPhotos(input)).toEqual({
            photos: [],
            cones: 0,
            warnings: [{ feature: -1, message: 'not a GeoJSON FeatureCollection' }],
        });
    });

    it('badPath_invalidFeaturesAreSkippedWithAWarning', () => {
        const migration = migrate([
            { type: 'Feature', geometry: { type: 'LineString', coordinates: [] }, properties: { photo: 'x.jpg' } },
            point('x.jpg', [200, 44]),
            { ...point('x.jpg', UNIRII), properties: { title: 'no photo' } },
            point('a%2F..%2Fb.jpg', UNIRII),
            point('ok.jpg', UNIRII),
        ]);

        expect(migration.photos.map((photo) => photo.photo.id)).toEqual(['ok']);
        expect(migration.warnings.map((warning) => warning.feature)).toEqual([0, 1, 2, 3]);
    });
});

describe('legacyFileName', () => {
    it.each([
        ['https://legacy.example/photos/Mihai Voda, nr 63.jpg', 'Mihai Voda, nr 63.jpg'],
        ['https://legacy.example/photos/Mihai%20Vod%C4%83.jpg?v=2#x', 'Mihai Vodă.jpg'],
        ['plain.png', 'plain.png'],
        ['https://legacy.example/photos/100%.jpg', '100%.jpg'],
    ])('happyPath_%s', (url, expected) => {
        expect(legacyFileName(url)).toBe(expected);
    });

    it.each([
        ['https://legacy.example/photos/'],
        ['https://legacy.example/.hidden'],
        ['https://legacy.example/a%2F..%2Fb'],
        ['https://legacy.example/a%5Cb'],
    ])('badPath_%s_isUnusable', (url) => {
        expect(legacyFileName(url)).toBeNull();
    });
});
