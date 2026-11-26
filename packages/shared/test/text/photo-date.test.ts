import { describe, expect, it } from 'vitest';

import { formatPhotoDate, monthNames } from '../../src/text/photo-date.js';

describe('formatPhotoDate', () => {
    it.each([
        ['en', { year: 1936, month: 7 }, 'July 1936'],
        ['ro', { year: 1936, month: 7 }, 'Iulie 1936'],
        ['en', { year: 1936, month: 7, day: 12 }, '12 July 1936'],
        ['ro', { year: 1936, month: 7, day: 12 }, '12 iulie 1936'],
        ['en', { year: 1800, month: 1, day: 1 }, '1 January 1800'],
        ['en', { year: 2100, month: 12, day: 31 }, '31 December 2100'],
    ] as const)('happyPath_%s_%j', (locale, date, text) => {
        expect(formatPhotoDate(date, locale)).toBe(text);
    });
});

describe('monthNames', () => {
    it('happyPath_twelveNamesInOrder', () => {
        expect(monthNames('en')).toHaveLength(12);
        expect(monthNames('en')[0]).toBe('January');
        expect(monthNames('ro')[6]).toBe('Iulie');
    });
});

describe('formatPhotoDate in the viewer languages', () => {
    it('happyPath_arabicKeepsLatinDigits', () => {
        expect(formatPhotoDate({ year: 1936, month: 7, day: 12 }, 'ar')).toMatch(/12.*1936/u);
    });

    it('happyPath_turkishCapitalisesWithItsOwnRules', () => {
        expect(formatPhotoDate({ year: 1936, month: 7 }, 'tr')).toBe('Temmuz 1936');
    });

    it('happyPath_japaneseWritesItsOwnOrder', () => {
        expect(formatPhotoDate({ year: 1936, month: 7, day: 12 }, 'ja')).toBe('1936年7月12日');
    });
});
