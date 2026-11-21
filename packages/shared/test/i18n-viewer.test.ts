/** The viewer's 25 languages (sixteen complete, nine being translated): the registry, the tags, the endonyms and every catalogue (DECISIONS-for-review.md §218). */
import { describe, expect, it } from 'vitest';

import {
    catalogueText,
    hasCatalogue,
    intlTag,
    isRtl,
    LANGUAGE_NAMES,
    localized,
    registerCatalogue,
    resolveLocale,
    resolveViewerLocale,
    shownLanguage,
    translate,
    VIEWER_LOCALES,
    viewerLocaleOf,
    type ViewerLocale,
} from '../src/i18n/index.js';
import { UI_LOCALES } from '../src/i18n/locales.js';
import { ro } from '../src/i18n/ro.js';
import { VIEWER_CATALOGUES } from '../src/i18n/viewer-catalogues.js';

const byText = (a: string, b: string): number => a.localeCompare(b);

/** The six plural forms every counted key has in every viewer catalogue. */
const PLURAL_FORMS = ['zero', 'one', 'two', 'few', 'many', 'other'];

describe('viewer languages', () => {
    it('happyPath_everyInterfaceLanguageRomanianFirst', () => {
        expect(VIEWER_LOCALES).toBe(UI_LOCALES);
        expect(VIEWER_LOCALES).toHaveLength(25);
        expect(VIEWER_LOCALES[0]).toBe('ro');
    });

    it.each([
        ['de', 'de'],
        ['de-AT', 'de'],
        [' ZH-tw ', 'zh'],
        ['pt-BR', 'pt'],
        ['ar-EG', 'ar'],
        ['ja', 'ja'],
        ['fa-IR', 'fa'],
        ['nl-BE', 'nl'],
    ] as const)('happyPath_%s_isTheViewerLanguage_%s', (tag, locale) => {
        expect(viewerLocaleOf(tag)).toBe(locale);
        expect(resolveViewerLocale(tag)).toBe(locale);
    });

    it.each([['sv'], ['xx'], [''], [null], [undefined], ['constructor']])('badPath_%s_isNoViewerLanguage', (tag) => {
        expect(viewerLocaleOf(tag)).toBeUndefined();
        expect(resolveViewerLocale(tag)).toBe('ro');
    });

    it('happyPath_theAdminKeepsItsTwoLanguages', () => {
        expect(resolveLocale('de')).toBe('ro');
        expect(resolveLocale('en-US')).toBe('en');
    });

    it('happyPath_arabicPersianAndUrduAreWrittenRightToLeft', () => {
        expect(VIEWER_LOCALES.filter(isRtl)).toEqual(['ar', 'fa', 'ur']);
    });
});

describe('the registry', () => {
    it('happyPath_romanianAndEnglishAreImportedTheOthersRegistered', () => {
        expect(hasCatalogue('ro')).toBe(true);
        expect(hasCatalogue('en')).toBe(true);
        expect(hasCatalogue('ja')).toBe(false);

        registerCatalogue('ja', VIEWER_CATALOGUES.ja);

        expect(hasCatalogue('ja')).toBe(true);
        expect(translate('ja', 'layers.title')).toBe(VIEWER_CATALOGUES.ja['layers.title']);
        expect(catalogueText('ja', 'mapLabels.group')).toBe(VIEWER_CATALOGUES.ja['mapLabels.group']);
    });

    it('happyPath_aKeyALanguageBeingTranslatedLacksShowsInEnglish', () => {
        registerCatalogue('ur', VIEWER_CATALOGUES.ur);

        expect(translate('ur', 'layers.title')).toBe(translate('en', 'layers.title'));
        expect(translate('ur', 'layers.toggle', { name: 'KH-9' })).toBe('Show ⁨KH-9⁩');
    });

    it('badPath_aLanguageNotHereYetGivesNoTextNeverAKey', () => {
        expect(translate('hi', 'layers.title')).toBe('');
        expect(catalogueText('hi', 'layers.title')).toBeUndefined();
        expect(catalogueText('ro', 'no.such.key')).toBeUndefined();
    });

    it('happyPath_rightToLeftIsolatesEachValue', () => {
        registerCatalogue('ar', VIEWER_CATALOGUES.ar);

        expect(translate('ar', 'layers.toggle', { name: 'KH-9 1980' })).toBe(
            VIEWER_CATALOGUES.ar['layers.toggle']?.replace('{name}', '⁨KH-9 1980⁩'),
        );
        expect(translate('en', 'layers.toggle', { name: 'KH-9 1980' })).toBe('Show KH-9 1980');
    });

    it('badPath_aMissingValueStaysVisibleUnisolated', () => {
        registerCatalogue('ar', VIEWER_CATALOGUES.ar);

        expect(translate('ar', 'layers.toggle')).toContain('{name}');
        expect(translate('ar', 'layers.toggle')).not.toContain('⁨');
    });
});

/** The languages the viewer is complete in (`VIEWER_COMPLETE` of scripts/ci/check_i18n.py); the others are being translated. */
const COMPLETE: readonly ViewerLocale[] = ['ro', 'en', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'uk', 'pl', 'tr', 'ar', 'hi', 'zh', 'ja', 'ko'];

describe('every viewer catalogue', () => {
    const keys = Object.keys(VIEWER_CATALOGUES.ro).toSorted(byText);

    it.each(COMPLETE)('happyPath_%s_hasRomaniansKeysAndNoEmptyText', (locale) => {
        const catalogue = VIEWER_CATALOGUES[locale];

        expect(Object.keys(catalogue).toSorted(byText)).toEqual(keys);
        expect(Object.values(catalogue).filter((text) => text.trim() === '')).toEqual([]);
    });

    it.each(VIEWER_LOCALES.filter((locale) => !COMPLETE.includes(locale)))('happyPath_%s_beingTranslatedHasOnlyRomaniansKeys', (locale) => {
        expect(Object.keys(VIEWER_CATALOGUES[locale]).filter((key) => !keys.includes(key))).toEqual([]);
    });

    it.each(COMPLETE)('happyPath_%s_spellsOutEveryPluralFormItsRulesSelect', (locale) => {
        const categories = new Intl.PluralRules(intlTag(locale)).resolvedOptions().pluralCategories;

        expect(PLURAL_FORMS).toEqual(expect.arrayContaining([...categories]));
        for (const form of PLURAL_FORMS) {
            expect(VIEWER_CATALOGUES[locale][`photos.count.${form}`], `${locale} ${form}`).toContain('{count}');
        }
    });

    it('badPath_theRomanianSourceHasNoLanguageNamesAnyMore', () => {
        expect(Object.keys(ro).filter((key) => key.startsWith('language.'))).toEqual(['language.label', 'language.unavailable']);
    });
});

describe('LANGUAGE_NAMES', () => {
    it('happyPath_everyLanguageByItsOwnNameInTheRootCollationsOrder', () => {
        const names = Object.values(LANGUAGE_NAMES);

        expect(Object.keys(LANGUAGE_NAMES).toSorted(byText)).toEqual([...VIEWER_LOCALES].toSorted(byText));
        expect(names).toEqual(names.toSorted(new Intl.Collator('und').compare));
        expect(LANGUAGE_NAMES.ro).toBe('Română');
        expect(LANGUAGE_NAMES.ar).toBe('العربية');
    });
});

describe('intlTag', () => {
    it.each([
        ['ro', 'ro-RO'],
        ['en', 'en-GB'],
        ['ar', 'ar-u-nu-latn'],
        ['fa', 'fa-u-nu-latn'],
        ['de', 'de'],
        ['zh', 'zh'],
    ] as const)('happyPath_%s_formatsAs_%s', (locale, tag) => {
        expect(intlTag(locale)).toBe(tag);
    });

    it('happyPath_arabicDatesKeepLatinDigits', () => {
        expect(new Intl.NumberFormat(intlTag('ar'), { useGrouping: false }).format(1936)).toBe('1936');
    });
});

describe('localized', () => {
    const name = { ro: 'Gara de Nord', en: 'North Station', de: 'Nordbahnhof' } as const;

    it.each([
        ['de', 'Nordbahnhof', 'de'],
        ['en', 'North Station', 'en'],
        ['ro', 'Gara de Nord', 'ro'],
        ['ja', 'North Station', 'en'],
    ] as const)('happyPath_%s_shows_%s', (locale, text, shown) => {
        expect(localized(name, locale)).toBe(text);
        expect(shownLanguage(name, locale)).toBe(shown);
    });

    it('badPath_noEnglishFallsBackToRomanian', () => {
        const romanianOnly = { ro: 'Ștrandul Operetă' };
        const locales: readonly ViewerLocale[] = ['en', 'ar', 'ko'];

        expect(locales.map((locale) => localized(romanianOnly, locale))).toEqual([
            'Ștrandul Operetă',
            'Ștrandul Operetă',
            'Ștrandul Operetă',
        ]);
        expect(shownLanguage(romanianOnly, 'ko')).toBe('ro');
        expect(shownLanguage({ ro: 'x', en: undefined }, 'en')).toBe('ro');
    });
});
