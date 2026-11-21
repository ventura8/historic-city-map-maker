import { describe, expect, it } from 'vitest';

import { distanceMeters } from '../../src/geo/bearing.js';
import { angularSpan, coneFromPolygon, conePolygon, DEFAULT_FOV, findConeApex, MAX_FOV, MIN_FOV, openRing } from '../../src/geo/cone.js';
import type { LngLat } from '../../src/geo/math.js';

const PHOTO: LngLat = [26.086703, 44.422754];

describe('openRing', () => {
    it('happyPath_dropsTheClosingVertex', () => {
        expect(
            openRing([
                [0, 0],
                [1, 0],
                [0, 1],
                [0, 0],
            ]),
        ).toEqual([
            [0, 0],
            [1, 0],
            [0, 1],
        ]);
    });

    it('badPath_openOrTinyRingsAreKept', () => {
        const rings: LngLat[][] = [
            [],
            [[0, 0]],
            [
                [0, 0],
                [1, 1],
            ],
        ];

        expect(rings.map(openRing)).toEqual(rings);
    });
});

describe('conePolygon', () => {
    it('happyPath_drawsApexArcAndApex', () => {
        const ring = conePolygon(PHOTO, { bearing: 90, fov: 60, distanceM: 40 }, 4);

        expect(ring).toHaveLength(7);
        expect(ring[0]).toEqual(PHOTO);
        expect(ring.at(-1)).toEqual(PHOTO);
        expect(ring.slice(1, -1).every((vertex) => Math.abs(distanceMeters(PHOTO, vertex) - 40) < 0.01)).toBe(true);
    });

    it('badPath_clampsTheFieldOfViewAndDrawsAtLeastOneStep', () => {
        const ring = conePolygon(PHOTO, { bearing: 0, fov: 500, distanceM: 10 }, 0);
        const cone = coneFromPolygon(ring, PHOTO);

        expect(ring).toHaveLength(4);
        expect(cone?.fov).toBeCloseTo(MAX_FOV, 6);
    });

    it('happyPath_defaultsMatchThePlan', () => {
        expect([DEFAULT_FOV, MIN_FOV, MAX_FOV]).toEqual([60, 1, 180]);
    });
});

describe('angularSpan', () => {
    it('happyPath_spanOfTwoBearings', () => {
        expect(angularSpan([30, 90])).toEqual({ start: 30, span: 60 });
    });

    it('happyPath_spanAcrossNorth', () => {
        expect(angularSpan([350, 20, 5])).toEqual({ start: 350, span: 30 });
    });

    it.each([
        [[], { start: 0, span: 0 }],
        [[400], { start: 40, span: 0 }],
    ])('badPath_fewerThanTwoBearings_%j_spanNothing', (bearings, expected) => {
        expect(angularSpan(bearings)).toEqual(expected);
    });
});

describe('coneFromPolygon', () => {
    it.each([
        [295.3, 43],
        [358.3, 40],
        [6, 41],
        [150.3, 69],
    ])('happyPath_recoversBearing_%d_andFov_%d', (bearing, fov) => {
        const ring = conePolygon(PHOTO, { bearing, fov, distanceM: 30 }, 1);

        const cone = coneFromPolygon(ring, [PHOTO[0] + 0.00001, PHOTO[1]]);

        expect(cone?.apex).toEqual(PHOTO);
        expect(cone?.bearing).toBeCloseTo(bearing, 1);
        expect(cone?.fov).toBeCloseTo(fov, 1);
        expect(cone?.distanceM).toBeCloseTo(30, 3);
    });

    it('happyPath_apexMayBeAnyVertexOfTheRing', () => {
        const [apex, left, right] = conePolygon(PHOTO, { bearing: 200, fov: 50, distanceM: 25 }, 1) as [LngLat, LngLat, LngLat];

        expect(coneFromPolygon([left, apex, right, left], PHOTO)?.bearing).toBeCloseTo(200, 1);
    });

    it('badPath_emptyRingIsNull', () => {
        expect(coneFromPolygon([], [26, 44])).toBeNull();
    });

    it('badPath_ringWithOneFarVertexIsNull', () => {
        const ring: LngLat[] = [
            [26, 44],
            [26, 44],
            [26.001, 44],
        ];

        expect(coneFromPolygon(ring, [26, 44])).toBeNull();
    });
});

describe('findConeApex', () => {
    it('happyPath_findsTheVertexWithEqualSides', () => {
        const [apex, left, right] = conePolygon(PHOTO, { bearing: 160, fov: 45, distanceM: 47 }, 1) as [LngLat, LngLat, LngLat];

        expect(findConeApex([left, right, apex, left])).toEqual(apex);
    });

    it('happyPath_firstVertexWinsATie', () => {
        expect(
            findConeApex([
                [0, 0],
                [0, 0],
                [0, 0],
            ]),
        ).toEqual([0, 0]);
    });

    it('badPath_emptyRingHasNoApex', () => {
        expect(findConeApex([])).toBeNull();
    });
});
