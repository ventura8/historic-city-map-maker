import { describe, expect, it } from 'vitest';

import type { MigratedPhoto } from '../../src/migration/legacy-photos.js';
import { buildStaticManifest, creditsNamingAuthors, photoAuthorsCredit } from '../../src/migration/static-manifest.js';
import type { Theme } from '../../src/schemas/manifest.js';
import { tokens, validCity } from '../fixtures/manifest.js';

const theme: Theme = {
    seedColor: '#8B5E3C',
    tokens: { light: tokens(), dark: tokens(), highContrastLight: tokens(), highContrastDark: tokens() },
};

function migrated(id: string, author?: string): MigratedPhoto {
    return {
        sourceFile: `${id}.jpg`,
        photo: {
            id,
            title: { ro: id },
            links: [],
            license: 'permission-legacy',
            rightsReview: true,
            location: { lat: 44.43, lng: 26.09 },
            ...(author === undefined ? {} : { author }),
        },
    };
}

function cityWithoutTheme(): Record<string, unknown> {
    const city = validCity();
    Reflect.deleteProperty(city, 'theme');
    return city;
}

const image = (id: string) => ({ web: `derived/${id}/web.webp`, thumb: `derived/${id}/thumb.webp`, w: 800, h: 600 });

describe('photoAuthorsCredit', () => {
    it('happyPath_namesEveryAuthorOnceInRomanianOrder', () => {
        expect(
            photoAuthorsCredit([
                { author: 'Ștefan' },
                { author: 'Ion Mureșan' },
                {},
                { author: 'Dan Vartanian' },
                { author: 'Ion Mureșan' },
            ]),
        ).toEqual({
            label: { ro: 'Fotografii: Dan Vartanian, Ion Mureșan, Ștefan', en: 'Photos: Dan Vartanian, Ion Mureșan, Ștefan' },
        });
    });

    it('badPath_noAuthorsNoCredit', () => {
        expect(photoAuthorsCredit([{}, { author: undefined }])).toBeNull();
    });
});

describe('creditsNamingAuthors', () => {
    const migratedLine = { label: { ro: 'Fotografii: Dan Perry, Dan Vartanian', en: 'Photos: Dan Perry, Dan Vartanian' } };
    const osm = { label: { ro: 'Date © OSM', en: 'Data © OSM' }, url: 'https://www.openstreetmap.org/copyright' };
    const photos = [{ author: 'Dan Vartanian' }, { author: 'Studiourile Buftea' }, {}, { author: 'Dan Perry' }];

    it('happyPath_theMigratedLineListsTheNewAuthorToo', () => {
        expect(creditsNamingAuthors([migratedLine, osm], photos)).toEqual([
            {
                label: {
                    ro: 'Fotografii: Dan Perry, Dan Vartanian, Studiourile Buftea',
                    en: 'Photos: Dan Perry, Dan Vartanian, Studiourile Buftea',
                },
            },
            osm,
        ]);
    });

    it('happyPath_everyAuthorNamedLeavesTheCreditsAsTheyAre', () => {
        const credits = [{ label: { ro: 'Mulțumiri lui Dan Perry, Dan Vartanian și Studiourile Buftea', en: 'Thanks' } }];

        expect(creditsNamingAuthors(credits, photos)).toEqual(credits);
    });

    it('badPath_anEditedLineStaysAndTheMissingAuthorsGetALineOfTheirOwn', () => {
        const edited = { label: { ro: 'Fotografii: Dan Perry, Dan Vartanian (colecția Perry)', en: 'Photos: Dan Perry, Dan Vartanian' } };
        const linked = { ...migratedLine, url: 'https://example.org/authors' };

        expect(creditsNamingAuthors([edited, osm], photos)).toEqual([
            edited,
            osm,
            { label: { ro: 'Fotografii: Studiourile Buftea', en: 'Photos: Studiourile Buftea' } },
        ]);
        expect(creditsNamingAuthors([linked], photos)[1]?.label.ro).toBe('Fotografii: Studiourile Buftea');
        expect(creditsNamingAuthors([], [{ author: 'Ana' }])).toEqual([{ label: { ro: 'Fotografii: Ana', en: 'Photos: Ana' } }]);
    });
});

describe('buildStaticManifest', () => {
    it('happyPath_buildsAValidManifestWithTheAuthorsCreditFirst', () => {
        const result = buildStaticManifest({
            city: cityWithoutTheme(),
            theme,
            photos: [migrated('a', 'Dan Perry'), migrated('b')],
            images: new Map([
                ['a', image('a')],
                ['b', image('b')],
            ]),
        });

        expect(result.ok).toBe(true);
        expect(result.ok && result.value.city.credits.map((credit) => credit.label.en)).toEqual(['Photos: Dan Perry', 'Photos: A', 'OSM']);
        expect(result.ok && result.value.photos.map((photo) => photo.image.web)).toEqual(['derived/a/web.webp', 'derived/b/web.webp']);
        expect(result.ok && result.value.layers).toEqual([]);
    });

    it('happyPath_aPhotoWithoutImageIsLeftOutAndCreditsMayBeAbsent', () => {
        const city = cityWithoutTheme();
        Reflect.deleteProperty(city, 'credits');

        const result = buildStaticManifest({
            city: { ...city, credits: 'not a list' },
            theme,
            photos: [migrated('a', 'X'), migrated('b')],
            images: new Map([['b', image('b')]]),
        });

        expect(result.ok && result.value.photos.map((photo) => photo.id)).toEqual(['b']);
        expect(result.ok && result.value.city.credits).toEqual([]);
    });

    it('badPath_anInvalidCityFailsValidation', () => {
        const result = buildStaticManifest({ city: { ...cityWithoutTheme(), id: 'not valid' }, theme, photos: [], images: new Map() });

        expect(result.ok ? [] : result.issues).toEqual([{ path: 'city.id', code: 'validation.format' }]);
    });
});
