import { describe, expect, it } from 'vitest';

import {
    bboxCenter,
    bboxContains,
    bboxExpand,
    bboxFromRecord,
    bboxIntersects,
    bboxOf,
    bboxToRecord,
    clampToBBox,
    type BBox,
} from '../../src/geo/bbox.js';
import { landsInCity } from '../../src/schemas/autogcp.js';

const BUCHAREST: BBox = [
    [25.93, 44.33],
    [26.25, 44.55],
];

describe('bboxOf', () => {
    it('happyPath_boxAroundPoints', () => {
        expect(
            bboxOf([
                [26.1, 44.4],
                [26.0, 44.5],
                [26.2, 44.45],
            ]),
        ).toEqual([
            [26.0, 44.4],
            [26.2, 44.5],
        ]);
    });

    it('badPath_noPointsNoBox', () => {
        expect(bboxOf([])).toBeNull();
    });
});

describe('bboxContains', () => {
    it.each([
        [[26.085, 44.427], true],
        [[25.93, 44.33], true],
        [[25.9, 44.4], false],
        [[26.3, 44.4], false],
        [[26.1, 44.3], false],
        [[26.1, 44.6], false],
    ] as const)('happyPath_point_%j_inside_is_%s', (point, expected) => {
        expect(bboxContains(BUCHAREST, point)).toBe(expected);
    });
});

describe('bboxIntersects', () => {
    it.each([
        [
            [
                [26.2, 44.5],
                [26.4, 44.7],
            ],
            true,
        ],
        [
            [
                [26.3, 44.4],
                [26.4, 44.5],
            ],
            false,
        ],
        [
            [
                [25.0, 44.4],
                [25.5, 44.5],
            ],
            false,
        ],
        [
            [
                [26.0, 44.6],
                [26.1, 44.7],
            ],
            false,
        ],
        [
            [
                [26.0, 44.0],
                [26.1, 44.1],
            ],
            false,
        ],
    ] as const)('happyPath_box_%j_intersects_is_%s', (other: BBox, expected) => {
        expect(bboxIntersects(BUCHAREST, other)).toBe(expected);
    });
});

describe('bboxExpand, bboxCenter, clampToBBox', () => {
    it('happyPath_expandsAndLimitsToTheMercatorWorld', () => {
        expect(bboxExpand(BUCHAREST, 0.5)).toEqual([
            [25.43, 43.83],
            [26.75, 45.05],
        ]);
        expect(
            bboxExpand(
                [
                    [-179.9, -85],
                    [179.9, 85],
                ],
                1,
            ),
        ).toEqual([
            [-180, -85.051129],
            [180, 85.051129],
        ]);
    });

    it('happyPath_centreAndClamp', () => {
        expect(bboxCenter(BUCHAREST)[0]).toBeCloseTo(26.09, 10);
        expect(clampToBBox([30, 40], BUCHAREST)).toEqual([26.25, 44.33]);
    });
});

describe('records', () => {
    it('happyPath_roundTripsTheFirestoreShape', () => {
        const record = bboxToRecord(BUCHAREST);

        expect(record).toEqual({ west: 25.93, south: 44.33, east: 26.25, north: 44.55 });
        expect(bboxFromRecord(record)).toEqual(BUCHAREST);
    });
});

describe('landsInCity', () => {
    it('keeps a district map and a map of the whole region', () => {
        expect(
            landsInCity(
                [
                    [26.05, 44.4],
                    [26.15, 44.47],
                ],
                BUCHAREST,
            ),
        ).toBe(true);
        expect(
            landsInCity(
                [
                    [25.7, 44.2],
                    [26.5, 44.7],
                ],
                BUCHAREST,
            ),
        ).toBe(true);
    });

    it('refuses the 1974 archive maps placed 18 km north-west of Bucharest', () => {
        expect(
            landsInCity(
                [
                    [25.89, 44.58],
                    [25.95, 44.6],
                ],
                BUCHAREST,
            ),
        ).toBe(false);
    });

    it('refuses a footprint whose centre lies far from the city', () => {
        expect(
            landsInCity(
                [
                    [24.0, 44.0],
                    [27.0, 45.0],
                ],
                [
                    [26.9, 44.9],
                    [27.2, 45.2],
                ],
            ),
        ).toBe(false);
    });

    it('judges a footprint without area by its centre alone', () => {
        expect(
            landsInCity(
                [
                    [26.1, 44.4],
                    [26.1, 44.4],
                ],
                BUCHAREST,
            ),
        ).toBe(true);
    });
});
