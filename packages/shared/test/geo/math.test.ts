import { describe, expect, it } from 'vitest';

import { bearingDelta, clamp, roundTo, toDegrees, toRadians, wrapBearing } from '../../src/geo/math.js';

describe('clamp', () => {
    it.each([
        [5, 0, 10, 5],
        [-1, 0, 10, 0],
        [11, 0, 10, 10],
    ])('happyPath_%d_in_%d_%d_is_%d', (value, min, max, expected) => {
        expect(clamp(value, min, max)).toBe(expected);
    });

    it('badPath_nanBecomesTheMinimum', () => {
        expect(clamp(Number.NaN, 2, 4)).toBe(2);
    });
});

describe('wrapBearing', () => {
    it.each([
        [0, 0],
        [359.5, 359.5],
        [360, 0],
        [725, 5],
        [-90, 270],
        [-360, 0],
    ])('happyPath_%d_wrapsTo_%d', (degrees, expected) => {
        expect(Object.is(wrapBearing(degrees), expected)).toBe(true);
    });

    it.each([[Number.NaN], [Number.POSITIVE_INFINITY]])('badPath_nonFinite_%d_isNorth', (degrees) => {
        expect(wrapBearing(degrees)).toBe(0);
    });
});

describe('bearingDelta', () => {
    it.each([
        [10, 30, 20],
        [350, 10, 20],
        [10, 350, -20],
        [0, 180, 180],
    ])('happyPath_from_%d_to_%d_is_%d', (from, to, expected) => {
        expect(bearingDelta(from, to)).toBe(expected);
    });
});

describe('angles and rounding', () => {
    it('happyPath_radiansAndDegreesRoundTrip', () => {
        expect(toDegrees(toRadians(123.4))).toBeCloseTo(123.4, 10);
        expect(toRadians(180)).toBeCloseTo(Math.PI, 12);
    });

    it('happyPath_roundsToDigitsWithoutNegativeZero', () => {
        expect(String(roundTo(44.4270371, 5))).toBe('44.42704');
        // toBe compares with Object.is, so this also rules out -0.
        expect(roundTo(-0.000001, 2)).toBe(0);
    });
});
