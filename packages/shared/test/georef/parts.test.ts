/**
 * The georeferencing's building blocks (docs/research/M3-interfaces.md §6): the matrices, the spread check and the
 * normalization, EPSG:3857, the warped preview's mesh and its triangle transforms.
 */
import { describe, expect, it } from 'vitest';

import { fitTransform, type FittedTransform } from '../../src/georef/fit.js';
import { inverse, Matrix, solve } from '../../src/georef/matrix.js';
import { geoToMercator, groundMetres, mercatorToGeo, WEB_MERCATOR_RADIUS_M } from '../../src/georef/mercator.js';
import { previewMesh, scanBounds, triangleTransform } from '../../src/georef/mesh.js';
import { convexHull, isDegenerateSpread, normalizerOf, polygonArea } from '../../src/georef/spread.js';

describe('the matrices', () => {
    it('happyPath_solvesAndInvertsWithRowSwaps', () => {
        const a = Matrix.of([
            [0, 2, 1],
            [1, 1, 0],
            [2, 0, 3],
        ]);
        const x = solve(a, Matrix.of([[7], [3], [11]]));
        const inverted = inverse(a);

        expect([x?.get(0, 0), x?.get(1, 0), x?.get(2, 0)].map((value) => Math.round((value ?? 0) * 1e9) / 1e9)).toEqual([1, 2, 3]);
        const product = a.times(inverted ?? new Matrix(3, 3));
        expect([0, 1, 2].map((index) => Math.round(product.get(index, index) * 1e9) / 1e9)).toEqual([1, 1, 1]);
        expect(a.largest()).toBe(3);
    });

    it('badPath_aSingularMatrixHasNoSolutionAndAnEmptyOneIsEmpty', () => {
        expect(
            inverse(
                Matrix.of([
                    [1, 2],
                    [2, 4],
                ]),
            ),
        ).toBeNull();
        const empty = Matrix.of([]);
        expect([empty.rows, empty.cols, empty.largest()]).toEqual([0, 0, 0]);
    });
});

describe('the spread', () => {
    it('happyPath_theHullOfASquareWithAPointInsideAndItsArea', () => {
        const hull = convexHull([
            { x: 0, y: 0 },
            { x: 4, y: 0 },
            { x: 2, y: 2 },
            { x: 4, y: 4 },
            { x: 0, y: 4 },
        ]);

        expect(hull).toHaveLength(4);
        expect(polygonArea(hull)).toBe(16);
        expect(
            normalizerOf([
                { x: 0, y: 0 },
                { x: 2, y: 0 },
            ]),
        ).toEqual({ cx: 1, cy: 0, scale: 1 });
    });

    it('badPath_coincidentCollinearAndThinSetsAreDegenerate', () => {
        const point = { x: 3, y: 3 };
        expect(isDegenerateSpread([point, point, point])).toBe(true);
        expect(
            isDegenerateSpread([
                { x: 0, y: 0 },
                { x: 5, y: 5 },
                { x: 10, y: 10 },
            ]),
        ).toBe(true);
        expect(
            isDegenerateSpread([
                { x: 0, y: 0 },
                { x: 1000, y: 1000 },
                { x: 500, y: 504 },
            ]),
        ).toBe(true);
        expect(
            isDegenerateSpread([
                { x: 0, y: 0 },
                { x: 1000, y: 0 },
                { x: 0, y: 1000 },
            ]),
        ).toBe(false);
    });
});

describe('EPSG:3857', () => {
    it('happyPath_aPlaceGoesThereAndBackAndGroundMetresShrinkWithLatitude', () => {
        const place = { lat: 44.4268, lng: 26.1025 };
        const back = mercatorToGeo(geoToMercator(place));

        expect(back.lat).toBeCloseTo(place.lat, 9);
        expect(back.lng).toBeCloseTo(place.lng, 9);
        expect(geoToMercator({ lat: 0, lng: 180 }).x).toBeCloseTo(Math.PI * WEB_MERCATOR_RADIUS_M, 3);
        expect(groundMetres(3, 4, 60)).toBeCloseTo(2.5, 9);
        expect(geoToMercator({ lat: 89.9, lng: 0 }).y).toBeCloseTo(geoToMercator({ lat: 85.051129, lng: 0 }).y, 3);
    });
});

/** A fit of a 1000 × 800 scan over a corner of București. */
function fitted(): FittedTransform {
    const pairs = [
        [0, 0, 44.46, 26.08],
        [1000, 0, 44.46, 26.12],
        [1000, 800, 44.43, 26.12],
        [0, 800, 44.43, 26.08],
    ].map(([x = 0, y = 0, lat = 0, lng = 0], index) => ({
        id: `g${String(index)}`,
        pixel: { x, y },
        geo: { lat, lng },
        enabled: true,
        origin: 'manual' as const,
    }));
    const result = fitTransform('affine', pairs);
    if (!result.ok) {
        throw new Error(result.reason);
    }
    return result.transform;
}

describe('the warped preview', () => {
    it('happyPath_theMeshCoversTheBoundsAndItsCornersMapToScanPixels', () => {
        const transform = fitted();
        const bounds = scanBounds(transform, { width: 1000, height: 800 });
        const mesh = previewMesh(transform, bounds, 2.4);

        expect(bounds[0][0]).toBeCloseTo(26.08, 6);
        expect(bounds[1][1]).toBeCloseTo(44.46, 6);
        expect(mesh).toHaveLength(4);
        const first = mesh[0];
        expect(first?.geo[0].lat).toBeCloseTo(44.46, 6);
        expect(first?.pixel[0].x).toBeCloseTo(0, 3);
        expect(mesh[3]?.pixel[2].x).toBeCloseTo(1000, 3);
        expect(mesh[3]?.pixel[2].y).toBeCloseTo(800, 3);
        expect(previewMesh(transform, bounds, 0)).toHaveLength(1);
        expect(scanBounds(transform, { width: 1000, height: 800 }, 0)[0][1]).toBeCloseTo(44.43, 6);
    });

    it('happyPath_aTriangleTransformMapsTheCornersAndAFlatTriangleHasNone', () => {
        const transform = triangleTransform(
            [
                { x: 0, y: 0 },
                { x: 10, y: 0 },
                { x: 0, y: 10 },
            ],
            [
                { x: 5, y: 5 },
                { x: 25, y: 5 },
                { x: 5, y: 35 },
            ],
        );

        expect(transform?.map((value) => Math.round(value * 1e9) / 1e9)).toEqual([2, 0, 0, 3, 5, 5]);
        expect(
            triangleTransform(
                [
                    { x: 0, y: 0 },
                    { x: 1, y: 1 },
                    { x: 2, y: 2 },
                ],
                [
                    { x: 0, y: 0 },
                    { x: 1, y: 0 },
                    { x: 0, y: 1 },
                ],
            ),
        ).toBeNull();
    });
});
