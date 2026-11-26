import { describe, expect, it } from 'vitest';

import { en } from '../src/i18n/en.js';
import { DEFAULT_LOCALE, LOCALES, resolveLocale, translate } from '../src/i18n/index.js';
import { pluralOf } from '../src/i18n/plural.js';
import { ro } from '../src/i18n/ro.js';

const byText = (a: string, b: string): number => a.localeCompare(b);

describe('catalogues', () => {
    it('happyPath_romanianIsTheDefaultLocale', () => {
        expect(DEFAULT_LOCALE).toBe('ro');
        expect(LOCALES).toEqual(['ro', 'en']);
    });

    it('happyPath_everyLocaleHasTheSameKeys', () => {
        expect(Object.keys(en).toSorted(byText)).toEqual(Object.keys(ro).toSorted(byText));
    });

    it('badPath_noCatalogueHasAnEmptyMessage', () => {
        const empty = [...Object.entries(ro), ...Object.entries(en)].filter(([, text]) => text.trim() === '');

        expect(empty).toEqual([]);
    });
});

describe('resolveLocale', () => {
    it.each([
        ['ro', 'ro'],
        ['ro-RO', 'ro'],
        ['en', 'en'],
        ['EN-us', 'en'],
        [' en-GB ', 'en'],
    ] as const)('happyPath_%s_resolvesTo_%s', (tag, expected) => {
        expect(resolveLocale(tag)).toBe(expected);
    });

    it.each([['fr'], ['de-DE'], [''], [null], [undefined]])('badPath_%s_fallsBackToRomanian', (tag) => {
        expect(resolveLocale(tag)).toBe('ro');
    });
});

describe('translate', () => {
    it('happyPath_returnsTheCatalogueText', () => {
        expect(translate('ro', 'layers.title')).toBe('Straturi');
        expect(translate('en', 'layers.title')).toBe('Layers');
    });

    it('happyPath_fillsPlaceholders', () => {
        expect(translate('ro', 'error.config.invalid', { detail: 'lang' })).toBe('config.js este nevalid: lang');
    });

    it('badPath_missingParameterLeavesThePlaceholderVisible', () => {
        expect(translate('en', 'error.config.invalid')).toBe('config.js is invalid: {detail}');
    });
});

describe('pluralOf', () => {
    it.each([
        ['ro', 1, 'one'],
        ['ro', 0, 'few'],
        ['ro', 2, 'few'],
        ['ro', 19, 'few'],
        ['ro', 20, 'other'],
        ['en', 1, 'one'],
        ['en', 0, 'other'],
        ['en', 2, 'other'],
    ] as const)('happyPath_%s_%i_is_%s', (locale, count, form) => {
        expect(pluralOf(locale, count)).toBe(form);
    });
});
