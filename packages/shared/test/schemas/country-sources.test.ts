// M28 (docs/research/M28-sources.md §10, §11): the country lists' schema, the curated seed, the helpers, the translation options.
import { describe, expect, it } from 'vitest';

import { en as finderEn } from '../../src/i18n/admin-sources-finder/en.js';
import { ro as finderRo } from '../../src/i18n/admin-sources-finder/ro.js';
import { COUNTRY_SEEDS } from '../../src/schemas/country-seeds.js';
import {
    COUNTRY_SOURCES_REFRESH_DAYS,
    IMPORT_ROUTES,
    PLACE_ACCESS,
    PLACE_COSTS,
    PLACE_KINDS,
    PLACE_MATERIALS,
    countryPlaceSchema,
    countrySourcesDue,
    directionsUrl,
    requestMailUrl,
} from '../../src/schemas/country-sources.js';
import { TRANSLATION_CATALOGUE, TRANSLATION_OPTIONS } from '../../src/schemas/translation-sources.js';

const DAY = 86_400_000;

describe('the curated country lists', () => {
    it('happyPath_everyRomanianPlaceIsValidUniqueAndHasAGuideForHowItIsReached', () => {
        const places = COUNTRY_SEEDS['RO']?.places ?? [];

        expect(places.length).toBeGreaterThanOrEqual(10);
        expect(new Set(places.map((place) => place.id)).size).toBe(places.length);
        for (const place of places) {
            expect(countryPlaceSchema.safeParse(place).success).toBe(true);
            expect(place.access === 'online' ? place.online : place.offline).toBeDefined();
            expect(place.access === 'both' ? place.online !== undefined && place.offline !== undefined : true).toBe(true);
            expect(place.offline?.request.body.includes('{city}') ?? true).toBe(true);
        }
    });

    it('badPath_aPlaceWithAPlainHttpSiteOrAnUnknownKindIsRefused', () => {
        const valid = COUNTRY_SEEDS['RO']?.places[0];

        expect(countryPlaceSchema.safeParse({ ...valid, url: 'example.ro/' }).success).toBe(false);
        expect(countryPlaceSchema.safeParse({ ...valid, kind: 'blog' }).success).toBe(false);
    });
});

describe('the helpers', () => {
    it('happyPath_aListIsDueAfterItsMonth_andNeverRefreshedIsDue', () => {
        const now = new Date('2026-11-14T10:00:00.000Z');

        expect(countrySourcesDue(undefined, now)).toBe(true);
        expect(countrySourcesDue(new Date(now.getTime() - (COUNTRY_SOURCES_REFRESH_DAYS - 1) * DAY), now)).toBe(false);
        expect(countrySourcesDue(new Date(now.getTime() - COUNTRY_SOURCES_REFRESH_DAYS * DAY), now)).toBe(true);
    });

    it('happyPath_theWayThereAndTheEmailAreBuiltFromTheData', () => {
        expect(directionsUrl('Calea Victoriei 125, București')).toBe(
            'https://www.google.com/maps/dir/?api=1&destination=Calea%20Victoriei%20125%2C%20Bucure%C8%99ti',
        );
        expect(requestMailUrl('a@b.ro', { subject: 'Hărți & planuri', body: 'Bună ziua,\n' })).toBe(
            'mailto:a@b.ro?subject=H%C4%83r%C8%9Bi%20%26%20planuri&body=Bun%C4%83%20ziua%2C%0A',
        );
    });
});

describe('every text the finder and the translation cards build', () => {
    const keys = new Set(Object.keys(finderRo));

    it('happyPath_existsInBothLanguages', () => {
        const built = [
            ...PLACE_KINDS.map((kind) => `adminSources.kind.${kind}`),
            ...PLACE_ACCESS.map((access) => `adminSources.access.${access}`),
            ...PLACE_COSTS.map((cost) => `adminSources.cost.${cost}`),
            ...PLACE_MATERIALS.map((material) => `adminSources.material.${material}`),
            ...IMPORT_ROUTES.map((route) => `adminSources.import.${route}`),
            ...TRANSLATION_CATALOGUE.flatMap((facts) => [
                `adminSources.tr.${facts.id}.title`,
                `adminSources.tr.quality.${facts.quality}`,
                `adminSources.tr.card.${facts.card}`,
                `adminSources.tr.privacy.${facts.privacy}`,
                ...(facts.overLimit === 'none' ? [] : [`adminSources.tr.over.${facts.overLimit}`]),
                ...facts.steps.map((_, index) => `adminSources.tr.${facts.id}.step.${String(index + 1)}`),
            ]),
        ];

        expect(built.filter((key) => !keys.has(key))).toEqual([]);
        const sorted = (list: readonly string[]): string[] => [...list].sort((a, b) => a.localeCompare(b));
        expect(sorted(Object.keys(finderEn))).toEqual(sorted([...keys]));
        expect(TRANSLATION_CATALOGUE.map((facts) => facts.id)).toEqual([...TRANSLATION_OPTIONS]);
    });

    it('badPath_noTranslationStepPointsOutsideHttpsOrTheApp', () => {
        const pages = TRANSLATION_CATALOGUE.flatMap((facts) => [...facts.steps, facts.pricing]).filter((page) => page !== null);

        expect(pages.filter((page) => !page.startsWith('https://') && !page.startsWith('#/'))).toEqual([]);
    });
});
