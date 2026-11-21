import { describe, expect, it } from 'vitest';

import { isPhotoNearYear, PHOTO_YEAR_WINDOW } from '../../src/overlays/photos.js';

describe('isPhotoNearYear', () => {
    it('happyPath_theWindowIsTenYears', () => {
        expect(PHOTO_YEAR_WINDOW).toBe(10);
    });

    it.each([
        [{ year: 1966 }, 1966],
        [{ year: 1956 }, 1966],
        [{ year: 1976 }, 1966],
        [{ year: 1940, yearEnd: 1960 }, 1966],
        [{ year: 1970, yearEnd: 1990 }, 1966],
    ])('happyPath_%j_isNear_%s', (photo, year) => {
        expect(isPhotoNearYear(photo, year)).toBe(true);
    });

    it.each([
        [{ year: 1955 }, 1966],
        [{ year: 1977 }, 1966],
        [{ year: 1930, yearEnd: 1955 }, 1966],
        [{}, 1966],
    ])('badPath_%j_isNotNear_%s', (photo, year) => {
        expect(isPhotoNearYear(photo, year)).toBe(false);
    });

    it('happyPath_aCallerMayNarrowTheWindow', () => {
        expect(isPhotoNearYear({ year: 1970 }, 1966, 2)).toBe(false);
        expect(isPhotoNearYear({ year: 1968 }, 1966, 2)).toBe(true);
    });
});
