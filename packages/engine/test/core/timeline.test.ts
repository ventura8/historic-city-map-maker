import { describe, expect, it } from 'vitest';

import {
    layerIdsOfYear,
    photoNearYear,
    photosNearYear,
    PHOTO_YEAR_WINDOW,
    snapYear,
    timelineYears,
    yearOfLayers,
} from '../../src/core/timeline.js';
import { layer } from './fixtures.js';

describe('timeline', () => {
    const layers = [layer({ id: 'a', year: 1980 }), layer({ id: 'b', year: 1966 }), layer({ id: 'c', year: 1980 })];

    it('happyPath_yearsAreDistinctAndOldestFirst', () => {
        expect(timelineYears(layers)).toEqual([1966, 1980]);
    });

    it('happyPath_aYearWithoutALayerSnapsToTheNearestStop', () => {
        expect(snapYear(1975, [1966, 1980])).toBe(1980);
        expect(snapYear(1970, [1966, 1980])).toBe(1966);
        expect(snapYear(1980, [1966, 1980])).toBe(1980);
    });

    it('happyPath_aTieSnapsToTheOlderStop', () => {
        expect(snapYear(1973, [1966, 1980])).toBe(1966);
    });

    it('badPath_todayAndNonFiniteYearsStayToday', () => {
        expect(snapYear(null, [1966])).toBeNull();
        expect(snapYear(Number.NaN, [1966])).toBeNull();
        expect(snapYear(1970, [])).toBeNull();
    });

    it('happyPath_theLayersOfAStop', () => {
        expect([...layerIdsOfYear(layers, 1980)]).toEqual(['a', 'c']);
        expect(layerIdsOfYear(layers, null).size).toBe(0);
    });

    it('happyPath_photosNearAYearMeetItsWindow', () => {
        expect(PHOTO_YEAR_WINDOW).toBe(10);
        expect(photoNearYear({ year: 1970 }, 1980)).toBe(true);
        expect(photoNearYear({ year: 1950, yearEnd: 1972 }, 1980)).toBe(true);
        expect(photoNearYear({ year: 1991 }, 1980)).toBe(false);
        expect(photoNearYear({ year: 1950, yearEnd: 1969 }, 1980)).toBe(false);
    });

    it('badPath_anUndatedPhotoIsNearNoYearButShownToday', () => {
        expect(photoNearYear({}, 1980)).toBe(false);
        expect(photoNearYear({}, null)).toBe(true);
    });

    it('happyPath_todayShowsEveryPhotoInOrder', () => {
        const photos = [{ year: 1900 }, {}, { year: 1975 }];

        expect(photosNearYear(photos, null)).toBe(photos);
        expect(photosNearYear(photos, 1980)).toEqual([{ year: 1975 }]);
    });

    it('happyPath_theYearOfVisibleLayersIsTheNewest', () => {
        expect(yearOfLayers(layers, ['b', 'a'])).toBe(1980);
        expect(yearOfLayers(layers, ['b'])).toBe(1966);
    });

    it('badPath_unknownLayersStandForToday', () => {
        expect(yearOfLayers(layers, ['nope'])).toBeNull();
        expect(yearOfLayers(layers, [])).toBeNull();
    });
});
