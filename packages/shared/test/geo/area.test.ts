import { describe, expect, it } from 'vitest';

import { AREA_FAR_M, AREA_NEAR_M, areaAhead, isConvexQuad } from '../../src/geo/area.js';
import { bearingBetween, distanceMeters } from '../../src/geo/bearing.js';
import type { LngLat } from '../../src/geo/math.js';

const PHOTO: LngLat = [26.086703, 44.422754];

const SQUARE: LngLat[] = [
    [0, 0],
    [0, 1],
    [1, 1],
    [1, 0],
];

describe('isConvexQuad', () => {
    it.each([
        ['a square, clockwise', SQUARE],
        ['a square, counter-clockwise', SQUARE.toReversed()],
        [
            'a trapezoid',
            [
                [0.4, 0],
                [0, 1],
                [1, 1],
                [0.6, 0],
            ] as LngLat[],
        ],
    ])('happyPath_accepts_%s', (_label, corners) => {
        expect(isConvexQuad(corners)).toBe(true);
    });

    it.each([
        ['three corners', SQUARE.slice(0, 3)],
        ['five corners', [...SQUARE, [0.5, -0.5]] as LngLat[]],
        [
            'a bow tie',
            [
                [0, 0],
                [1, 1],
                [0, 1],
                [1, 0],
            ] as LngLat[],
        ],
        [
            'a corner bent inward',
            [
                [0, 0],
                [0, 1],
                [0.2, 0.2],
                [1, 0],
            ] as LngLat[],
        ],
        [
            'three corners on a line',
            [
                [0, 0],
                [0, 0.5],
                [0, 1],
                [1, 0],
            ] as LngLat[],
        ],
    ])('badPath_refuses_%s', (_label, corners) => {
        expect(isConvexQuad(corners)).toBe(false);
    });
});

describe('areaAhead', () => {
    it('happyPath_aTrapezoidInFrontOfTheCamera', () => {
        const area = areaAhead(PHOTO, 90, 60);

        expect(isConvexQuad(area)).toBe(true);
        const [nearLeft, farLeft, farRight, nearRight] = area as [LngLat, LngLat, LngLat, LngLat];
        expect(distanceMeters(PHOTO, nearLeft)).toBeCloseTo(AREA_NEAR_M, 0);
        expect(distanceMeters(PHOTO, farRight)).toBeCloseTo(AREA_FAR_M, 0);
        expect(bearingBetween(PHOTO, farLeft)).toBeCloseTo(60, 0);
        expect(bearingBetween(PHOTO, nearRight)).toBeCloseTo(120, 0);
    });

    it('badPath_aFieldOfViewOutsideTheUsefulRangeIsCapped', () => {
        expect(isConvexQuad(areaAhead(PHOTO, 0, 180))).toBe(true);
        expect(isConvexQuad(areaAhead(PHOTO, 350, 1))).toBe(true);
    });
});
