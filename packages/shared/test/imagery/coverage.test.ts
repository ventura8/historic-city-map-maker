/**
 * The footprint's share of the city (`docs/research/M3-interfaces.md` §3.2): the footprint clipped to the bounds, areas
 * with longitudes scaled by the cosine of the bounds' middle latitude; and M2M rings turned into stored footprints.
 */
import { describe, expect, it } from 'vitest';

import { MAX_FOOTPRINT_VERTICES, footprintCoverage, footprintOf } from '../../src/imagery/coverage.js';

const BOUNDS = { west: 26, south: 44, east: 27, north: 45 };

function box(west: number, south: number, east: number, north: number) {
    return [
        { lat: south, lng: west },
        { lat: south, lng: east },
        { lat: north, lng: east },
        { lat: north, lng: west },
    ];
}

describe('footprintCoverage', () => {
    it('happyPath_aFrameOverLongitude180StaysOnePieceAroundTheCity @S-P01-HAPPY-ANTIMERIDIAN', () => {
        const over = [
            { lat: -15, lng: 174.5 },
            { lat: -15, lng: -174.5 },
            { lat: -19, lng: -174.5 },
            { lat: -19, lng: 174.5 },
        ];
        const suva = { west: 178.3, south: -18.2, east: 178.55, north: -18.05 };
        const far = { west: -179.7, south: -18.2, east: -179.4, north: -18.05 };
        const elsewhere = { west: 10, south: -18.2, east: 10.5, north: -18.05 };

        expect(footprintCoverage(over, suva)).toBeCloseTo(1, 9);
        expect(footprintCoverage(over, far)).toBeCloseTo(1, 9);
        expect(footprintCoverage(over, elsewhere)).toBe(0);
    });

    it('happyPath_aFrameOverTheWholeCityCoversAllOfIt', () => {
        expect(footprintCoverage(box(25, 43, 28, 46), BOUNDS)).toBeCloseTo(1, 9);
    });

    it('happyPath_aFrameOverTheWestHalfCoversHalf', () => {
        expect(footprintCoverage(box(25, 43, 26.5, 46), BOUNDS)).toBeCloseTo(0.5, 9);
    });

    it('happyPath_aFrameInsideTheCityCoversItsOwnShare', () => {
        expect(footprintCoverage(box(26.25, 44.25, 26.75, 44.75), BOUNDS)).toBeCloseTo(0.25, 9);
    });

    it('happyPath_aTriangleAcrossTheCornerIsClippedOnEverySide', () => {
        const triangle = [
            { lat: 43.5, lng: 25.5 },
            { lat: 43.5, lng: 27.5 },
            { lat: 45.5, lng: 25.5 },
        ];

        expect(footprintCoverage(triangle, BOUNDS)).toBeCloseTo(0.5, 9);
    });

    it('happyPath_theWindingDoesNotMatter', () => {
        expect(footprintCoverage(box(25, 43, 26.5, 46).toReversed(), BOUNDS)).toBeCloseTo(0.5, 9);
    });

    it('badPath_aFrameElsewhereCoversNothing', () => {
        expect(footprintCoverage(box(10, 10, 11, 11), BOUNDS)).toBe(0);
    });
});

describe('footprintCoverage of a KH-9 panoramic frame', () => {
    /** The corners USGS lists for D3C1202-200149F039 (a strip 560 km long and 36 km wide at its ends). */
    const MEASURED = {
        nw: { lat: 45.112, lng: 22.169 },
        ne: { lat: 44.205, lng: 29.158 },
        se: { lat: 43.887, lng: 29.2 },
        sw: { lat: 44.824, lng: 21.965 },
    };
    const OUTLINE = [MEASURED.nw, MEASURED.ne, MEASURED.se, MEASURED.sw];
    const BUCHAREST = { west: 25.9, south: 44.3, east: 26.3, north: 44.6 };
    /** A strip along the equator, 40 degrees long and 2 wide at its ends, so its shape can be read off. */
    const STRIP = box(-20, -1, 20, 1);
    const PANORAMIC = { sensor: 'KH-9-pan' } as const;

    /** A window taller than the strip, as wide as `width`, around longitude `lng`. */
    const across = (lng: number, width = 0.01) => ({ west: lng - width / 2, south: -5, east: lng + width / 2, north: 5 });
    /** The strip's width at a longitude, in degrees (the coverage of a window 10 degrees tall). */
    const widthAt = (ring: typeof STRIP, lng: number) => footprintCoverage(ring, across(lng), PANORAMIC) * 10;

    it('happyPath_theMeasuredFrameCoversAboutHalfTheCityNotAllOfIt', () => {
        expect(footprintCoverage(OUTLINE, BUCHAREST)).toBeCloseTo(0.975, 3);

        const coverage = footprintCoverage(OUTLINE, BUCHAREST, { sensor: 'KH-9-pan', corners: MEASURED });

        expect(coverage).toBeCloseTo(0.53, 2);
        // The measured truth is about 51 %: the estimate misses it by the corners' constant shift, not by its shape.
        expect(Math.abs(coverage - 0.51)).toBeLessThan(0.03);
    });

    it('happyPath_theWidthFollowsTheSlantRange_aBowTie', () => {
        expect(widthAt(STRIP, 0)).toBeCloseTo(2 * Math.cos((60.5 * Math.PI) / 180), 3);
        expect(widthAt(STRIP, 19.99)).toBeGreaterThan(1.95);
        expect(widthAt(STRIP, -19.99)).toBeGreaterThan(1.95);
        // Halfway along the frame the scan angle is atan(tan(60.5) / 2), 41.5 degrees: wider than the waist, under the ends.
        expect(widthAt(STRIP, 10)).toBeCloseTo(
            (2 * Math.cos((60.5 * Math.PI) / 180)) / Math.cos(Math.atan(Math.tan((60.5 * Math.PI) / 180) / 2)),
            2,
        );
    });

    it('happyPath_theCornersDecideWhenBothAreKnown_elseTheFootprintsFourVertices', () => {
        const fromFootprint = footprintCoverage(OUTLINE, BUCHAREST, PANORAMIC);
        const fromCorners = footprintCoverage(box(10, 10, 11, 11), BUCHAREST, { sensor: 'KH-9-pan', corners: MEASURED });

        expect(fromFootprint).toBeCloseTo(fromCorners, 9);
    });

    it('happyPath_aStripNamedFromItsShortSideIsTheSameBowTie', () => {
        const [a, b, c, d] = STRIP as [(typeof STRIP)[0], (typeof STRIP)[0], (typeof STRIP)[0], (typeof STRIP)[0]];

        expect(widthAt([b, c, d, a], 0)).toBeCloseTo(widthAt(STRIP, 0), 9);
    });

    it('badPath_anOutlineOfOtherThanFourVerticesIsKept', () => {
        const hexagon = [...STRIP, { lat: 1, lng: -21 }, { lat: -1, lng: -21 }];

        expect(footprintCoverage(hexagon, across(0), PANORAMIC)).toBeCloseTo(footprintCoverage(hexagon, across(0)), 9);
    });

    it.each(['KH-4', 'KH-4A', 'KH-4B', 'KH-7', 'KH-9-mapping'] as const)('badPath_anotherCameraKeepsItsFootprint_%s', (sensor) => {
        expect(footprintCoverage(OUTLINE, BUCHAREST, { sensor, corners: MEASURED })).toBe(footprintCoverage(OUTLINE, BUCHAREST));
    });
});

describe('footprintOf', () => {
    it('happyPath_aClosedM2mRingBecomesAnOpenFootprintOfLatLngVertices', () => {
        const ring: [number, number][] = [
            [25.95, 44.35],
            [26.25, 44.35],
            [26.25, 44.52],
            [25.95, 44.52],
            [25.95, 44.35],
        ];

        expect(footprintOf(ring)).toEqual([
            { lat: 44.35, lng: 25.95 },
            { lat: 44.35, lng: 26.25 },
            { lat: 44.52, lng: 26.25 },
            { lat: 44.52, lng: 25.95 },
        ]);
    });

    it('happyPath_anOpenRingIsKept', () => {
        expect(
            footprintOf([
                [1, 2],
                [3, 4],
                [5, 6],
            ]),
        ).toHaveLength(3);
    });

    it('happyPath_aLongRingIsThinnedToTheLimit', () => {
        const ring = Array.from({ length: 200 }, (_, index): [number, number] => [26 + Math.cos(index / 30), 44 + Math.sin(index / 30)]);

        const footprint = footprintOf(ring);

        expect(footprint?.length).toBeLessThanOrEqual(MAX_FOOTPRINT_VERTICES);
        expect(footprint?.[0]).toEqual({ lat: 44, lng: 27 });
    });

    it.each([
        ['an empty ring', []],
        ['a single point', [[1, 2]]],
        [
            'two points and the closing one',
            [
                [1, 2],
                [3, 4],
                [1, 2],
            ],
        ],
    ])('badPath_tooFewVerticesHaveNoFootprint_%s', (_case, ring) => {
        expect(footprintOf(ring as [number, number][])).toBeUndefined();
    });
});
