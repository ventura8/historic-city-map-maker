/** The interface's twenty-five languages, their directions and the per-key fallback to English (docs/I18N.md). */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { translateAdminShell } from '../src/i18n/admin-shell/index.js';
import { translateApiError } from '../src/i18n/api/index.js';
import { catalogueTranslator } from '../src/i18n/catalogue.js';
import { en } from '../src/i18n/en.js';
import { fillPlaceholders, hasCatalogue, isRtl, registerCatalogue, translate, uiText, VIEWER_LOCALES } from '../src/i18n/index.js';
import { familyLanguage, textLanguage } from '../src/i18n/registry.js';
import {
    BUNDLED_LOCALES,
    contentLocale,
    directionOf,
    isUiLocale,
    UI_LANGUAGE_NAMES,
    UI_LOCALES,
    UI_LOCALES_BY_NAME,
    uiLocaleOf,
} from '../src/i18n/locales.js';
import { translateStart } from '../src/i18n/start/index.js';

afterEach(() => {
    vi.restoreAllMocks();
});

describe('the interface languages', () => {
    it('happyPath_twentyFiveLanguagesWithRomanianAndEnglishBundled', () => {
        expect(UI_LOCALES).toHaveLength(25);
        expect(new Set(UI_LOCALES).size).toBe(25);
        expect(BUNDLED_LOCALES).toEqual(['ro', 'en']);
        expect(VIEWER_LOCALES.every((locale) => isUiLocale(locale))).toBe(true);
    });

    it('happyPath_arabicPersianAndUrduAreRightToLeft', () => {
        expect(UI_LOCALES.filter((locale) => directionOf(locale) === 'rtl')).toEqual(['ar', 'fa', 'ur']);
        expect(isRtl('fa')).toBe(true);
        expect(isRtl('fr')).toBe(false);
    });

    it('happyPath_everyLanguageHasItsOwnNameAndThePickersOrderIsFixed', () => {
        const byCode = (a: string, b: string): number => a.localeCompare(b);
        expect(Object.keys(UI_LANGUAGE_NAMES).toSorted(byCode)).toEqual([...UI_LOCALES].toSorted(byCode));
        expect(UI_LOCALES_BY_NAME).toHaveLength(25);
        expect(UI_LOCALES_BY_NAME[0]).toBe('id');
        expect(UI_LOCALES_BY_NAME.indexOf('fr')).toBeLessThan(UI_LOCALES_BY_NAME.indexOf('ru'));
    });

    it.each([
        ['fr-CA', 'fr'],
        [' FA ', 'fa'],
        ['ur-PK', 'ur'],
        ['zh-Hant', 'zh'],
    ] as const)('happyPath_%s_isTheLanguage_%s', (tag, locale) => {
        expect(uiLocaleOf(tag)).toBe(locale);
    });

    it.each([['sv'], [''], [null], [undefined], ['xx-fr']])('badPath_%s_isNoInterfaceLanguage', (tag) => {
        expect(uiLocaleOf(tag)).toBeUndefined();
        expect(isUiLocale(tag)).toBe(false);
    });

    it('happyPath_aCitysTextsAreRomanianForRomanianAndEnglishForEveryOtherLanguage', () => {
        expect(contentLocale('ro')).toBe('ro');
        expect(contentLocale('en')).toBe('en');
        expect(contentLocale('fa')).toBe('en');
    });
});

describe('the fallback to English', () => {
    it('happyPath_aRegisteredLanguageShowsItsOwnText', () => {
        registerCatalogue('nl', { 'adminShell.appName': 'Beheer {city}' });

        expect(hasCatalogue('nl')).toBe(true);
        expect(uiText('nl', 'adminShell.appName')).toBe('Beheer {city}');
    });

    it('badPath_aKeyTheLanguageLacksShowsInEnglishAndIsLoggedOnce', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        registerCatalogue('hu', { 'start.title': 'Saját térkép' });
        const translateFamily = catalogueTranslator<'a.one' | 'a.two'>({
            ro: { 'a.one': 'Unu', 'a.two': 'Doi' },
            en: { 'a.one': 'One', 'a.two': 'Two {n}' },
        });

        expect(translateFamily('hu', 'a.one')).toBe('One');
        expect(translateFamily('hu', 'a.two', { n: '2' })).toBe('Two 2');
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0]?.[1]).toEqual({ locale: 'hu', key: 'a.one' });
    });

    it('happyPath_aRegisteredLanguageTranslatesEveryFamily', () => {
        registerCatalogue('el', {
            'adminShell.notice.close': 'Κλείσιμο',
            'apiError.notFound': 'Δεν βρέθηκε.',
            'start.language': 'Γλώσσα',
            'theme.label': 'Θέμα',
        });

        expect(translateAdminShell('el', 'adminShell.notice.close')).toBe('Κλείσιμο');
        expect(translateApiError('el', 'apiError.notFound')).toBe('Δεν βρέθηκε.');
        expect(translateStart('el', 'start.language')).toBe('Γλώσσα');
        expect(translate('el', 'theme.label')).toBe('Θέμα');
    });

    it('badPath_anAdminFamilyWithNoFileShowsEnglishButTheViewersTextsWaitForTheirFile', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);

        expect(translateAdminShell('bg', 'adminShell.notice.close')).toBe('Close the message');
        expect(translate('bn', 'theme.label')).toBe('');
        expect(translate('ko', 'theme.label')).toBe('');
        registerCatalogue('bn', {});
        expect(translate('bn', 'theme.label')).toBe(en['theme.label']);
    });

    it('badPath_aKeyNoLanguageHasIsUndefined_andTheTranslatorsShowNoText', () => {
        registerCatalogue('id', { 'a.one': 'Satu' });
        const translateFamily = catalogueTranslator<'a.one'>({ ro: { 'a.one': 'Unu' }, en: { 'a.one': 'One' } });

        expect(uiText('fr', 'no.such.key')).toBeUndefined();
        expect(translate('id', 'no.such.key' as never)).toBe('');
        expect(translateFamily('id', 'no.such.key' as never)).toBe('');
        expect(translateApiError('id', 'no.such.code' as never)).toBe('');
    });

    it('happyPath_aSecondFileOfALanguageAddsItsKeys', () => {
        registerCatalogue('vi', { 'a.one': 'Một' });
        registerCatalogue('vi', { 'a.two': 'Hai' });

        expect(uiText('vi', 'a.one')).toBe('Một');
        expect(uiText('vi', 'a.two')).toBe('Hai');
    });

    it('happyPath_rightToLeftValuesAreIsolated', () => {
        registerCatalogue('ur', { 'theme.label': 'تھیم {name}' });

        expect(translate('ur', 'theme.label', { name: 'Map' })).toBe('تھیم ⁨Map⁩');
    });

    it('happyPath_everyAdminFamilyAndTheApiErrorsIsolateValuesInRightToLeftLanguages', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        registerCatalogue('fa', { 'a.city': 'نقشهٔ {city}' });
        const translateFamily = catalogueTranslator<'a.city'>({ ro: { 'a.city': 'Harta {city}' }, en: { 'a.city': 'Map of {city}' } });

        expect(translateFamily('fa', 'a.city', { city: 'Bacău' })).toBe('نقشهٔ ⁨Bacău⁩');
        expect(translateFamily('ar', 'a.city', { city: 'Bacău' })).toBe('Map of ⁨Bacău⁩');
        expect(translateFamily('fr', 'a.city', { city: 'Bacău' })).toBe('Map of Bacău');
        expect(fillPlaceholders('{a} {b}', { a: 'x' }, 'ur')).toBe('⁨x⁩ {b}');
        expect(translateApiError('ur', 'apiError.claim.notOwner', { projectId: 'bacau' })).toContain('⁨bacau⁩');
        expect(translateApiError('en', 'apiError.claim.notOwner', { projectId: 'bacau' })).not.toContain('⁨');
    });

    it('happyPath_theLanguageATextShowsInIsTheLanguagesOwnOrEnglish', () => {
        registerCatalogue('hu', { 'b.own': 'Saját' });

        expect(textLanguage('hu', 'b.own')).toBe('hu');
        expect(textLanguage('hu', 'b.other')).toBe('en');
        expect(textLanguage('ro', 'b.bundled')).toBe('ro');
        expect(familyLanguage('hu', 'b.')).toBe('hu');
        expect(familyLanguage('hu', 'c.')).toBe('en');
        expect(familyLanguage('nl', 'b.')).toBe('en');
        expect(familyLanguage('en', 'c.')).toBe('en');
    });
});
