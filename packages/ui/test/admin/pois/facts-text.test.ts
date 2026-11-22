import { describe, expect, it } from 'vitest';

import { datedLine, parseCommaList, parseDatedLines } from '../../../src/admin/pois/facts-text.js';
import { withFact } from '../../../src/admin/pois/poi-facts-fields.js';

describe('facts-text', () => {
    it('happyPath_linesWithYearsTodayAndNoneReadBack', () => {
        const items = parseDatedLines('1906-1940: Pavilion\n1950: Expo\n1960-: Park\n-1970: Lake\n\nazi: Str. X 2\nplain text');
        expect(items).toEqual([
            { text: 'Pavilion', yearStart: 1906, yearEnd: 1940 },
            { text: 'Expo', yearStart: 1950, yearEnd: 1950 },
            { text: 'Park', yearStart: 1960 },
            { text: 'Lake', yearEnd: 1970 },
            { text: 'Str. X 2', current: true },
            { text: 'plain text' },
        ]);
        expect(items.map((item) => datedLine(item))).toEqual([
            '1906-1940: Pavilion',
            '1950: Expo',
            '1960-: Park',
            '-1970: Lake',
            'azi: Str. X 2',
            'plain text',
        ]);
        expect(parseCommaList(' A ,, B ')).toEqual(['A', 'B']);
    });

    it('badPath_aLineItCannotReadKeepsItsText', () => {
        expect(parseDatedLines('19x6-1940: Pavilion\n -: x')).toEqual([{ text: '19x6-1940: Pavilion' }, { text: '-: x' }]);
    });

    it('happyPath_withFactSetsAndRemovesAndDropsTheEmptyObject', () => {
        const facts = withFact(undefined, 'floors', 3);
        expect(facts).toEqual({ floors: 3 });
        expect(withFact(facts, 'floors', undefined)).toBeUndefined();
    });
});
