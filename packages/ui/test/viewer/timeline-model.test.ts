import { PHOTO_YEAR_WINDOW } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { photosNearYear, stopIndex, timelineDensity, timelineStops, YEAR_GAP_PX } from '../../src/viewer/timeline-model.js';

describe('timelineStops', () => {
    it('happyPath_layerYearsAscendingWithoutDuplicatesThenToday', () => {
        expect(timelineStops([{ year: 1977 }, { year: 1966 }, { year: 1977 }])).toEqual([1966, 1977, null]);
    });

    it('badPath_noLayersLeavesOnlyToday', () => {
        expect(timelineStops([])).toEqual([null]);
    });
});

describe('stopIndex', () => {
    const stops = [1966, 1977, 1980, null];

    it('happyPath_exactYearAndToday', () => {
        expect(stopIndex(stops, 1977)).toBe(1);
        expect(stopIndex(stops, null)).toBe(3);
    });

    it('badPath_yearWithoutALayerSnapsToTheNearestStop', () => {
        expect(stopIndex(stops, 1970)).toBe(0);
        expect(stopIndex(stops, 1979)).toBe(2);
        expect(stopIndex(stops, 2050)).toBe(2);
        expect(stopIndex(stops, 1800)).toBe(0);
    });

    it('badPath_aTieKeepsTheEarlierStop', () => {
        expect(stopIndex([1960, 1970, null], 1965)).toBe(0);
    });

    it('badPath_onlyTodayOrNoStops', () => {
        expect(stopIndex([null], 1950)).toBe(0);
        expect(stopIndex([], null)).toBe(-1);
    });
});

describe('photosNearYear', () => {
    const photos = [{ id: 'a', year: 1960 }, { id: 'b', year: 1975, yearEnd: 1990 }, { id: 'c', year: 2000 }, { id: 'd' }];

    it('happyPath_yearsAndRangesWithinTheWindow', () => {
        expect(photosNearYear(photos, 1966).map((photo) => photo.id)).toEqual(['a', 'b']);
        expect(photosNearYear(photos, 1995).map((photo) => photo.id)).toEqual(['b', 'c']);
        expect(PHOTO_YEAR_WINDOW).toBe(10);
    });

    it('badPath_todayAndUndatedPhotosAreNeverNear', () => {
        expect(photosNearYear(photos, null)).toEqual([]);
        expect(photosNearYear(photos.slice(3), 1966)).toEqual([]);
    });

    it('happyPath_customWindow', () => {
        expect(photosNearYear(photos, 1966, 0)).toEqual([]);
    });
});

describe('timelineDensity', () => {
    it('happyPath_yearsThatFit40PxApartAreRoomy', () => {
        expect(timelineDensity(1000, 0)).toBe('roomy');
        expect(timelineDensity(400, 10)).toBe('roomy');
        expect(YEAR_GAP_PX).toBe(40);
    });

    it('badPath_yearsLongerThanTheCardScroll', () => {
        // The owner, 2026-11-14: "too crowded"; the track keeps 40 px per gap and scrolls instead.
        expect(timelineDensity(399, 10)).toBe('scroll');
        expect(timelineDensity(-10, 1)).toBe('scroll');
    });
});
