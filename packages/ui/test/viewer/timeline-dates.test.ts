import { describe, expect, it } from 'vitest';

import { countOf, dateCounts, dateItems, dateText, datesValueText, frontOfYear } from '../../src/viewer/timeline-dates.js';

/** V13: the years with several dates, the badge's count, the picker's entries and the layer on top. */
const LAYERS = [
    { id: 'a', year: 1966, date: '1966-09-03', label: { ro: 'Corona B', en: 'Corona B (EN)' } },
    { id: 'b', year: 1966, date: '1966-04-12', label: { ro: 'Corona A', en: 'Corona A (EN)' } },
    { id: 'c', year: 1966, label: { ro: 'Hartă 1966', en: 'Map 1966' } },
    { id: 'd', year: 1980, date: '1980-05', label: { ro: 'KH-9', en: 'KH-9' } },
];

describe('timeline dates', () => {
    it('happyPath_onlyYearsWithSeveralLayersCount', () => {
        const counts = dateCounts(LAYERS);

        expect([...counts]).toEqual([[1966, 3]]);
        expect(countOf(counts, 1966)).toBe(3);
        expect(countOf(counts, 1980)).toBe(0);
        expect(countOf(counts, null)).toBe(0);
    });

    it('happyPath_theDatesInTheVisitorsLanguageOldestFirstUndatedLast', () => {
        expect(dateItems(LAYERS, 1966, 'en')).toEqual([
            { id: 'b', date: 'April 12, 1966', label: 'Corona A (EN)' },
            { id: 'a', date: 'September 3, 1966', label: 'Corona B (EN)' },
            { id: 'c', date: '1966', label: 'Map 1966' },
        ]);
        expect(dateItems(LAYERS, 1966, 'ro')[0]?.date).toBe('12 aprilie 1966');
    });

    it('badPath_aMonthAloneOrNoDateShowsWhatIsKnown', () => {
        expect(dateText({ year: 1980, date: '1980-05' }, 'en')).toBe('May 1980');
        expect(dateText({ year: 1980, date: '1980' }, 'en')).toBe('1980');
        expect(dateText({ year: 1980 }, 'ro')).toBe('1980');
        expect(dateItems(LAYERS, 1901, 'ro')).toEqual([]);
    });

    it('happyPath_theChosenFrontOrTheYearsLastLayerIsOnTop', () => {
        expect(frontOfYear(LAYERS, 1966, 'b')).toBe('b');
        expect(frontOfYear(LAYERS, 1966, null)).toBe('c');
    });

    it('badPath_aFrontOfAnotherYearOrAYearWithoutLayersFallsBack', () => {
        expect(frontOfYear(LAYERS, 1966, 'd')).toBe('c');
        expect(frontOfYear(LAYERS, 1901, 'd')).toBeNull();
    });

    it('happyPath_theSliderSaysHowManyDatesAndThatEnterListsThem', () => {
        expect(datesValueText('en', 'Year 1966', 3)).toBe('Year 1966, several dates (3), Enter lists them');
        expect(datesValueText('ro', 'Anul 1980', 1)).toBe('Anul 1980');
    });
});
