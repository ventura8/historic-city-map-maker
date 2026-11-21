import { MAX_GEOMETRY_VERTICES, MAX_POLYGON_RINGS, type BBox, type Geometry } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import type { DrawLimits } from '../../../src/map/draw/draw-port.js';
import {
    checkGeometry,
    checkPositions,
    polygonCrossesItself,
    ringArea,
    roundGeometry,
    roundPosition,
    segmentsMeet,
} from '../../../src/map/draw/rules.js';

/** A mutable `[lng, lat]`, the type of the manifest geometry's positions. */
type Position = [number, number];

const CITY: BBox = [
    [25.9, 44.3],
    [26.3, 44.55],
];

const LIMITS: DrawLimits = { limits: CITY, maxVertices: MAX_GEOMETRY_VERTICES, maxRings: MAX_POLYGON_RINGS };

const SQUARE: Position[] = [
    [26.0, 44.4],
    [26.1, 44.4],
    [26.1, 44.5],
    [26.0, 44.5],
    [26.0, 44.4],
];

/** A ring whose first and third edges cross, with an area left over (an uneven hourglass). */
const BOWTIE: Position[] = [
    [26.0, 44.4],
    [26.1, 44.5],
    [26.1, 44.4],
    [26.0, 44.45],
    [26.0, 44.4],
];

describe('drawn geometry: rounding', () => {
    it('happyPath_positionsKeepSevenDecimals', () => {
        expect(roundPosition([26.123456789, 44.987654321])).toEqual([26.1234568, 44.9876543]);
        expect(roundGeometry({ type: 'Point', coordinates: [26.000000049, 44.1] })).toEqual({ type: 'Point', coordinates: [26, 44.1] });
        expect(
            roundGeometry({
                type: 'LineString',
                coordinates: [
                    [26.11111111, 44],
                    [26, 44.22222222],
                ],
            }),
        ).toEqual({
            type: 'LineString',
            coordinates: [
                [26.1111111, 44],
                [26, 44.2222222],
            ],
        });
        const polygon = roundGeometry({ type: 'Polygon', coordinates: [SQUARE.map(([lng, lat]) => [lng + 1e-9, lat])] });
        expect(polygon).toEqual({ type: 'Polygon', coordinates: [SQUARE] });
    });
});

describe('drawn geometry: segments and rings', () => {
    it('happyPath_crossingAndTouchingSegmentsMeet', () => {
        expect(
            segmentsMeet(
                [
                    [0, 0],
                    [2, 2],
                ],
                [
                    [0, 2],
                    [2, 0],
                ],
            ),
        ).toBe(true);
        expect(
            segmentsMeet(
                [
                    [0, 0],
                    [2, 0],
                ],
                [
                    [1, 0],
                    [1, 5],
                ],
            ),
        ).toBe(true);
        expect(
            segmentsMeet(
                [
                    [1, 0],
                    [1, 5],
                ],
                [
                    [0, 0],
                    [2, 0],
                ],
            ),
        ).toBe(true);
    });

    it('badPath_separateOrParallelSegmentsDoNotMeet', () => {
        expect(
            segmentsMeet(
                [
                    [0, 0],
                    [1, 0],
                ],
                [
                    [0, 1],
                    [1, 1],
                ],
            ),
        ).toBe(false);
        expect(
            segmentsMeet(
                [
                    [0, 0],
                    [1, 1],
                ],
                [
                    [2, 2],
                    [3, 3],
                ],
            ),
        ).toBe(false);
        expect(
            segmentsMeet(
                [
                    [0, 0],
                    [1, 0],
                ],
                [
                    [3, -1],
                    [3, 1],
                ],
            ),
        ).toBe(false);
    });

    it('happyPath_aRingsAreaIsPositiveWhicheverWayItTurns', () => {
        expect(ringArea(SQUARE)).toBeCloseTo(0.01, 10);
        expect(ringArea([...SQUARE].reverse())).toBeCloseTo(0.01, 10);
    });

    it('badPath_anHourglassOrAHoleAcrossTheEdgeCrossesItself', () => {
        const hole: Position[] = [
            [26.05, 44.45],
            [26.15, 44.45],
            [26.15, 44.47],
            [26.05, 44.47],
            [26.05, 44.45],
        ];
        expect(polygonCrossesItself([BOWTIE])).toBe(true);
        expect(polygonCrossesItself([SQUARE, hole])).toBe(true);
        expect(polygonCrossesItself([SQUARE])).toBe(false);
    });
});

describe('drawn geometry: the limits', () => {
    it('happyPath_shapesInsideTheCityKeepTheLimits', () => {
        const shapes: Geometry[] = [
            { type: 'Point', coordinates: [26.1, 44.43] },
            {
                type: 'LineString',
                coordinates: [
                    [26.0, 44.4],
                    [26.1, 44.5],
                    [26.1, 44.4],
                    [26.0, 44.5],
                ],
            },
            { type: 'Polygon', coordinates: [SQUARE] },
        ];
        expect(shapes.map((shape) => checkGeometry(shape, LIMITS))).toEqual([null, null, null]);
        expect(checkPositions([[26.1, 44.43]], LIMITS)).toBeNull();
    });

    it('badPath_aPositionOutsideTheCityIsRefused', () => {
        expect(checkGeometry({ type: 'Point', coordinates: [27, 44.43] }, LIMITS)).toEqual({ kind: 'outside', bounds: CITY });
        expect(
            checkPositions(
                [
                    [26.1, 44.43],
                    [26.1, 45],
                ],
                LIMITS,
            ),
        ).toEqual({ kind: 'outside', bounds: CITY });
    });

    it('badPath_tooManyPositionsOrRingsAreRefused', () => {
        const line: Position[] = Array.from({ length: 4 }, (_unused, index): Position => [26 + index / 100, 44.4]);
        const small: DrawLimits = { ...LIMITS, maxVertices: 3, maxRings: 1 };
        expect(checkGeometry({ type: 'LineString', coordinates: line }, small)).toEqual({ kind: 'too-many-vertices', max: 3 });
        expect(checkGeometry({ type: 'Polygon', coordinates: [SQUARE, SQUARE] }, { ...LIMITS, maxRings: 1 })).toEqual({
            kind: 'too-many-rings',
            max: 1,
        });
    });

    it('badPath_aFlatOrSelfCrossingPolygonIsRefused', () => {
        const flat: Position[] = [
            [26.0, 44.4],
            [26.1, 44.4],
            [26.2, 44.4],
            [26.0, 44.4],
        ];
        expect(checkGeometry({ type: 'Polygon', coordinates: [flat] }, LIMITS)).toEqual({ kind: 'zero-area' });
        expect(checkGeometry({ type: 'Polygon', coordinates: [] }, LIMITS)).toEqual({ kind: 'zero-area' });
        expect(checkGeometry({ type: 'Polygon', coordinates: [BOWTIE] }, LIMITS)).toEqual({ kind: 'self-intersection' });
    });
});
