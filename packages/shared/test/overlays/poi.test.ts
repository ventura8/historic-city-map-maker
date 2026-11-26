import { describe, expect, it } from 'vitest';

import { poiIcon, poiInYear } from '../../src/overlays/poi.js';
import { DEFAULT_POI_ICON, POI_ICONS } from '../../src/schemas/poi.js';

describe('poiInYear', () => {
    it.each([
        [{ yearStart: 1900, yearEnd: 1986 }, 1950, true],
        [{ yearStart: 1900, yearEnd: 1986 }, 1900, true],
        [{ yearStart: 1900, yearEnd: 1986 }, 1986, true],
        [{ yearEnd: 1984 }, 1830, true],
        [{ yearStart: 1977 }, 2020, true],
        [{}, 1966, true],
    ])('happyPath_%j_isShownIn_%s', (poi, year, expected) => {
        expect(poiInYear(poi, year)).toBe(expected);
    });

    it.each([
        [{ yearStart: 1900, yearEnd: 1986 }, 1899],
        [{ yearStart: 1900, yearEnd: 1986 }, 1987],
        [{ yearEnd: 1984 }, 1990],
        [{ yearStart: 1977 }, 1966],
    ])('badPath_%j_isHiddenIn_%s', (poi, year) => {
        expect(poiInYear(poi, year)).toBe(false);
    });

    it('happyPath_todayShowsEveryPoi', () => {
        expect(poiInYear({ yearStart: 1900, yearEnd: 1910 }, null)).toBe(true);
    });
});

describe('poiIcon', () => {
    it('happyPath_aBundledIconIsKept', () => {
        expect(POI_ICONS.map((name) => poiIcon(name))).toEqual([...POI_ICONS]);
    });

    it.each([['celebration'], [''], ['Church']])('badPath_%s_drawsTheDefaultPin', (name) => {
        expect(poiIcon(name)).toBe(DEFAULT_POI_ICON);
    });

    it('happyPath_theDefaultIsBundledAndTheListIsSorted', () => {
        expect(POI_ICONS).toContain(DEFAULT_POI_ICON);
        expect([...POI_ICONS]).toEqual([...POI_ICONS].toSorted((a, b) => a.localeCompare(b)));
    });
});
