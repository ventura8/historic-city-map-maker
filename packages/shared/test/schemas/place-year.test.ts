import { describe, expect, it } from 'vitest';

import { poiDocSchema } from '../../src/schemas/firestore.js';
import { hasPlaceYear, latestPlaceYear, placeYearIssues } from '../../src/schemas/place-year.js';
import { validate } from '../../src/schemas/validation.js';

/** 2026-11-12T10:00:00Z: next year is 2027. */
const NOW = Date.UTC(2026, 10, 12, 10);

describe('placeYearIssues', () => {
    it.each([
        ['a single year', { yearStart: 1890 }],
        ['an open start (built before records began)', { yearEnd: 1977 }],
        ['a span', { yearStart: 1850, yearEnd: 1977 }],
        ['next year (a place being built)', { yearStart: 2027 }],
        ['only the plan year it was seen on (M27 traced street)', { yearSeen: 1939 }],
    ])('happyPath_aPlaceWith_%s_isDated', (_label, place) => {
        expect(hasPlaceYear(place)).toBe(true);
        expect(placeYearIssues(place, latestPlaceYear(NOW))).toEqual([]);
    });

    it('badPath_aPlaceWithoutAYearAndWithoutYearSeen_asksForOneAtTheStartYear', () => {
        expect(hasPlaceYear({})).toBe(false);
        expect(placeYearIssues({ yearStart: undefined, yearEnd: undefined, yearSeen: undefined }, 2027)).toEqual([
            { path: 'yearStart', code: 'validation.required' },
        ]);
    });

    it('badPath_aYearAfterNextYear_isLate', () => {
        expect(placeYearIssues({ yearStart: 2028, yearEnd: 2030, yearSeen: 2029 }, latestPlaceYear(NOW))).toEqual([
            { path: 'yearStart', code: 'validation.tooBig' },
            { path: 'yearEnd', code: 'validation.tooBig' },
            { path: 'yearSeen', code: 'validation.tooBig' },
        ]);
    });

    it('happyPath_withoutToday_onlyTheMissingYearIsChecked', () => {
        expect(placeYearIssues({ yearEnd: 2100 }, null)).toEqual([]);
        expect(placeYearIssues({ yearSeen: 1914 }, null)).toEqual([]);
        expect(placeYearIssues({}, null)).toEqual([{ path: 'yearStart', code: 'validation.required' }]);
    });

    it('happyPath_theLatestYearIsNextYearInUtc', () => {
        expect(latestPlaceYear(Date.UTC(2026, 11, 31, 23, 59))).toBe(2027);
        expect(latestPlaceYear(Date.UTC(2027, 0, 1))).toBe(2028);
    });
});

describe('a stored place without a year', () => {
    it('happyPath_stillReadsAsAPoiDocument', () => {
        const stored = {
            category: 'cladiri',
            geometry: { type: 'Point', point: { lat: 44.43, lng: 26.1 } },
            title: { ro: 'Biserica Enei' },
            published: true,
            updatedBy: 'admin',
            updatedAt: { seconds: 1, nanoseconds: 0 },
        };
        const result = validate(poiDocSchema, stored);
        expect(result.ok).toBe(true);
        expect(result.ok && hasPlaceYear(result.value)).toBe(false);
    });
});
