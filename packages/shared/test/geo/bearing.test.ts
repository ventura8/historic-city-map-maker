import { describe, expect, it } from 'vitest';

import { bearingBetween, destinationPoint, distanceMeters } from '../../src/geo/bearing.js';
import type { LngLat } from '../../src/geo/math.js';

const UNIVERSITY: LngLat = [26.1025, 44.4355];

describe('bearingBetween', () => {
    it.each([
        [[26.1025, 44.5], 0],
        [[26.2, 44.4355], 90],
        [[26.1025, 44.4], 180],
        [[26.0, 44.4355], 270],
    ] as const)('happyPath_towards_%j_is_%d', (to, expected) => {
        expect(bearingBetween(UNIVERSITY, to)).toBeCloseTo(expected, 0);
    });

    it('badPath_samePointIsNorth', () => {
        expect(bearingBetween(UNIVERSITY, UNIVERSITY)).toBe(0);
    });
});

describe('distanceMeters', () => {
    it('happyPath_oneDegreeOfLatitudeIsAbout111Km', () => {
        expect(distanceMeters([26, 44], [26, 45])).toBeCloseTo(111_195, -1);
    });

    it('badPath_samePointIsZero', () => {
        expect(distanceMeters(UNIVERSITY, UNIVERSITY)).toBe(0);
    });
});

describe('destinationPoint', () => {
    it('happyPath_travelsTheDistanceOnTheBearing', () => {
        const target = destinationPoint(UNIVERSITY, 135, 500);

        expect(distanceMeters(UNIVERSITY, target)).toBeCloseTo(500, 3);
        expect(bearingBetween(UNIVERSITY, target)).toBeCloseTo(135, 3);
    });

    it('happyPath_wrapsAcrossTheAntimeridian', () => {
        const [lng] = destinationPoint([179.9999, 0], 90, 1000);

        expect(lng).toBeLessThan(-179.99);
    });
});
