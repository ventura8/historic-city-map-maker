// M28 (docs/research/M28-sources.md): the sources a city's map uses, what each one is and costs, and the texts the cards build.
import { describe, expect, it } from 'vitest';

import { en as guidedEn } from '../../src/i18n/admin-sources-guided/en.js';
import { ro as guidedRo } from '../../src/i18n/admin-sources-guided/ro.js';
import { en as mainEn } from '../../src/i18n/admin-sources/en.js';
import { translateAdminSources } from '../../src/i18n/admin-sources/index.js';
import { ro as mainRo } from '../../src/i18n/admin-sources/ro.js';
import {
    GUIDED_CATALOGUE,
    NOT_USABLE_SOURCES,
    ONE_SCAN_USD,
    PLATFORM_LINKS,
    PLATFORM_MONTHLY_USD,
    PLATFORM_SECTIONS,
    SOURCE_CATALOGUE,
    sourceFacts,
    sourceOn,
    sourcesEstimate,
} from '../../src/schemas/sources-catalogue.js';
import {
    DEFAULT_SOURCES,
    REQUIRED_SOURCES,
    SOURCE_TOGGLES,
    citySourcesSchema,
    needsUsgsAccount,
    sourcesOf,
} from '../../src/schemas/sources.js';
import { cityDocSchema } from '../../src/schemas/firestore.js';

const ro = { ...mainRo, ...guidedRo };
const en = { ...mainEn, ...guidedEn };
const KEYS = new Set(Object.keys(ro));

/** Every key a source's card builds from its catalogue entry. */
function sourceKeys(id: string, counts: { pros: number; cons: number; steps: number }, example: boolean): string[] {
    const numbered = (part: string, count: number): string[] => Array.from({ length: count }, (_, index) => `${part}.${String(index + 1)}`);
    const parts = [
        'title',
        'short',
        'gives',
        'cost',
        'effort',
        'licence',
        'recommended',
        ...(example ? ['example'] : []),
        ...numbered('pro', counts.pros),
        ...numbered('con', counts.cons),
        ...numbered('step', counts.steps),
    ];
    return parts.map((part) => `adminSources.${id}.${part}`);
}

describe('sourcesOf', () => {
    it('happyPath_aCityThatChoseNothingGetsTheDefaults_freeOnPaidOff', () => {
        expect(sourcesOf(undefined)).toEqual(DEFAULT_SOURCES);
        expect(sourcesOf({})).toEqual(DEFAULT_SOURCES);
        expect([DEFAULT_SOURCES.usgsOrders, DEFAULT_SOURCES.cloudAi]).toEqual([false, false]);
        expect(SOURCE_TOGGLES.filter((id) => DEFAULT_SOURCES[id])).toEqual([
            'usgs',
            'landsat',
            'archives',
            'contributors',
            'openData',
            'localAi',
        ]);
    });

    it('happyPath_aStoredChoiceWins', () => {
        expect(sourcesOf({ usgs: false, cloudAi: true })).toMatchObject({ usgs: false, cloudAi: true, landsat: true });
    });

    it('badPath_paidScansReadOffWithoutTheDeclassifiedFrames', () => {
        expect(sourcesOf({ usgs: false, usgsOrders: true }).usgsOrders).toBe(false);
        expect(sourcesOf({ usgsOrders: true }).usgsOrders).toBe(true);
    });

    it('happyPath_landsatAloneStillNeedsTheUsgsAccount', () => {
        expect(needsUsgsAccount({ ...DEFAULT_SOURCES, usgs: false })).toBe(true);
        expect(needsUsgsAccount({ ...DEFAULT_SOURCES, usgs: false, landsat: false })).toBe(false);
    });
});

describe('citySourcesSchema', () => {
    it('happyPath_theCityDocumentHoldsTheChoice', () => {
        expect(citySourcesSchema.parse({ usgs: false })).toEqual({ usgs: false });
        expect(cityDocSchema.shape.sources.safeParse({ landsat: true }).success).toBe(true);
    });

    it('badPath_anUnknownSourceOrANonBooleanIsRefused', () => {
        expect(citySourcesSchema.safeParse({ fostul: true }).success).toBe(false);
        expect(citySourcesSchema.safeParse({ usgs: 'yes' }).success).toBe(false);
    });
});

describe('SOURCE_CATALOGUE', () => {
    it('happyPath_everySourceHasAnEntryAndOnlySentinel2IsAlwaysOn', () => {
        const byName = (left: string, right: string): number => left.localeCompare(right, 'en');
        expect(SOURCE_CATALOGUE.map((entry) => entry.id).toSorted(byName)).toEqual(
            [...SOURCE_TOGGLES, ...REQUIRED_SOURCES].toSorted(byName),
        );
        expect(SOURCE_CATALOGUE.filter((entry) => entry.required).map((entry) => entry.id)).toEqual(['sentinel2']);
        expect(sourceFacts('usgsOrders')).toMatchObject({ needs: 'usgs', account: 'usgs' });
        // The owner's correction of 2026-11-13: the platform is not a source.
        expect(SOURCE_CATALOGUE.some((entry) => ['mapbox', 'googleCloud'].includes(entry.id))).toBe(false);
    });

    it('happyPath_everyTextACardBuildsExistsInBothLanguages', () => {
        const built = [
            ...SOURCE_CATALOGUE.flatMap((entry) => sourceKeys(entry.id, entry, true)),
            ...GUIDED_CATALOGUE.flatMap((entry) => [
                ...sourceKeys(entry.id, { pros: 2, cons: 2, steps: 2 }, false),
                `adminSources.publicUse.${entry.publicUse}`,
                `adminSources.path.${entry.path}`,
                `adminSources.automatic.${entry.automatic}`,
            ]),
            ...NOT_USABLE_SOURCES.flatMap((id) => [`adminSources.notUsable.${id}.title`, `adminSources.notUsable.${id}.why`]),
            ...['imagery', 'places', 'ai', 'guided'].map((group) => `adminSources.group.${group}`),
            ...PLATFORM_SECTIONS.flatMap((section) =>
                ['title', 'role', 'cost', 'limits', 'help.1'].map((part) => `adminSources.platform.${section}.${part}`),
            ),
        ];

        expect(built.filter((key) => !KEYS.has(key))).toEqual([]);
        const byName = (left: string, right: string): number => left.localeCompare(right, 'en');
        expect(Object.keys(en).toSorted(byName)).toEqual([...KEYS].toSorted(byName));
        // A long text continues in `<key>+2`: the translator joins the parts.
        expect(translateAdminSources('en', 'adminSources.usgs.gives')).toContain('Corona: 7.5 m (KH-4)');
        expect(translateAdminSources('en', 'adminSources.summary.total', { low: '0.5', high: '2' })).toBe(
            'In all: about USD 0.5–2 a month.',
        );
    });

    it('happyPath_everyProviderPageIsHttps', () => {
        const links = [...SOURCE_CATALOGUE, ...GUIDED_CATALOGUE].flatMap((entry) => entry.links);
        const platform = PLATFORM_SECTIONS.flatMap((section) => PLATFORM_LINKS[section]);

        expect([...links, ...platform].every((link) => link.url.startsWith('https://'))).toBe(true);
        expect(GUIDED_CATALOGUE.find((entry) => entry.id === 'romanianArchives')?.links).toHaveLength(2);
    });
});

describe('sourcesEstimate', () => {
    it('happyPath_theDefaultsCostOnlyThePlatform', () => {
        expect(sourcesEstimate(DEFAULT_SOURCES)).toEqual({
            platform: PLATFORM_MONTHLY_USD,
            sources: { low: 0, high: 0 },
            monthly: { low: 0.5, high: 2 },
            perScanUsd: null,
        });
    });

    it('happyPath_theCloudAiAddsItsCapAndPaidScansTheirOneOffPrice', () => {
        const estimate = sourcesEstimate({ ...DEFAULT_SOURCES, cloudAi: true, usgsOrders: true });

        expect(estimate.sources).toEqual({ low: 0, high: 0.5 });
        expect(estimate.monthly).toEqual({ low: 0.5, high: 2.5 });
        expect(estimate.perScanUsd).toBe(ONE_SCAN_USD);
        expect(ONE_SCAN_USD).toBe(35);
    });

    it('badPath_aRequiredSourceIsOnWhateverTheChoice', () => {
        expect(sourceOn({ ...DEFAULT_SOURCES, usgs: false }, 'sentinel2')).toBe(true);
        expect(sourceOn({ ...DEFAULT_SOURCES, usgs: false }, 'usgs')).toBe(false);
    });
});
