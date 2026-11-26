/**
 * `fitTransform` against the golden cases the pipeline's numpy transforms run too (`pipeline/tests/contracts/
 * georef-cases.json`, docs/research/M3-interfaces.md §6.3), and the parts the cases do not reach: noisy fits and their
 * leave-one-out residuals, checkpoints, the inverse, the thin-plate spline, and every refusal.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { distanceFromFit, fitTransform, type FitResult } from '../../src/georef/fit.js';
import { geoToMercator, groundMetres, mercatorToGeo, type GeoPoint } from '../../src/georef/mercator.js';
import { gcpSchema, type Gcp, type GeorefTransform } from '../../src/schemas/georef.js';

const CASES = resolve(import.meta.dirname, '../../../../pipeline/tests/contracts/georef-cases.json');

interface GoldenCase {
    readonly name: string;
    readonly transform: GeorefTransform;
    readonly gcps: readonly unknown[];
    readonly expect: {
        readonly ok: boolean;
        readonly reason?: string;
        readonly fitRmseM?: number;
        readonly checkpointRmseM?: number;
        readonly checkpointKind?: string;
        readonly checkpointCount?: number;
        readonly toleranceM?: number;
    };
}

interface Golden {
    readonly affine: {
        readonly x0: number;
        readonly y0: number;
        readonly a: number;
        readonly b: number;
        readonly c: number;
        readonly d: number;
    };
    readonly cases: readonly GoldenCase[];
}

const GOLDEN = JSON.parse(readFileSync(CASES, 'utf8')) as Golden;

/** The golden cases' pixel → EPSG:3857 map. */
function truth(pixel: { readonly x: number; readonly y: number }): GeoPoint {
    const { x0, y0, a, b, c, d } = GOLDEN.affine;
    return mercatorToGeo({ x: x0 + a * pixel.x + b * pixel.y, y: y0 + c * pixel.x + d * pixel.y });
}

function gcp(id: string, x: number, y: number, extra: Partial<Gcp> = {}): Gcp {
    return { id, pixel: { x, y }, geo: truth({ x, y }), enabled: true, origin: 'manual', ...extra };
}

/** A place `metres` east of where the truth puts the pixel. */
function shifted(pair: Gcp, metres: number): Gcp {
    const at = geoToMercator(pair.geo);
    const scale = 1 / Math.cos((pair.geo.lat * Math.PI) / 180);
    return { ...pair, geo: mercatorToGeo({ x: at.x + metres * scale, y: at.y }) };
}

/** A 4 × 4 grid of pairs over a 15000 × 12000 scan. */
function grid(): Gcp[] {
    return [0, 1, 2, 3].flatMap((row) => [0, 1, 2, 3].map((col) => gcp(`g${String(row * 4 + col)}`, col * 5000, row * 4000)));
}

/** A golden case's pairs as the schema reads them. */
function parsed(golden: GoldenCase): Gcp[] {
    return golden.gcps.map((pair) => gcpSchema.parse(pair));
}

/** The pair at `index` (throws when missing). */
function nth(pairs: readonly Gcp[], index: number): Gcp {
    const pair = pairs[index];
    if (pair === undefined) {
        throw new Error(`no pair ${String(index)}`);
    }
    return pair;
}

function ok(result: FitResult): Extract<FitResult, { ok: true }> {
    if (!result.ok) {
        throw new Error(`refused: ${result.reason}`);
    }
    return result;
}

describe('fitTransform: the golden cases', () => {
    it.each(GOLDEN.cases.filter((golden) => !golden.expect.ok))(
        'badPath_the $name case is refused as the pipeline refuses it',
        (golden) => {
            expect(fitTransform(golden.transform, parsed(golden))).toEqual({ ok: false, reason: golden.expect.reason });
        },
    );

    it.each(GOLDEN.cases.filter((golden) => golden.expect.ok))('happyPath_the $name case gives what the pipeline gives', (golden) => {
        const fitted = ok(fitTransform(golden.transform, parsed(golden)));
        const tolerance = golden.expect.toleranceM ?? 0.01;

        expect(fitted.fitRmseM).toBeLessThan((golden.expect.fitRmseM ?? 0) + tolerance);
        expect(fitted.checkpointCount).toBe(golden.expect.checkpointCount ?? fitted.checkpointCount);
        expect(fitted.checkpointRmseM ?? 0).toBeLessThan((golden.expect.checkpointRmseM ?? fitted.checkpointRmseM ?? 0) + tolerance);
        expect(fitted.transform.kind).toBe(golden.transform);
        expect(fitted.checkpointKind).toBe(golden.expect.checkpointKind ?? fitted.checkpointKind);
    });
});

describe('fitTransform: noisy pairs', () => {
    it('happyPath_anAffineFitMeasuresTheMovedPairByLeavingItOut', () => {
        const pairs = grid();
        pairs[5] = shifted(nth(pairs, 5), 30);

        const fitted = ok(fitTransform('affine', pairs));

        const moved = fitted.residuals.get('g5') ?? 0;
        const others = [...fitted.residuals.entries()].filter(([id]) => id !== 'g5').map(([, metres]) => metres);
        expect(moved).toBeGreaterThan(25);
        expect(Math.max(...others)).toBeLessThan(moved / 3);
        expect(fitted.fitRmseM).toBeGreaterThan(5);
        expect(fitted.checkpointCount).toBe(16);
        expect(fitted.checkpointRmseM).toBeGreaterThan(fitted.fitRmseM);
    });

    it('happyPath_disabledPairsAreTheCheckpointsAndTheInverseReturnsThePixel', () => {
        const pairs = grid().map((pair, index) => (index % 5 === 0 ? { ...pair, enabled: false } : pair));
        pairs[0] = shifted(nth(pairs, 0), 12);

        const fitted = ok(fitTransform('poly2', pairs));

        expect(fitted.checkpointCount).toBe(4);
        expect(fitted.checkpointRmseM).toBeCloseTo(6, 0);
        expect(fitted.residuals.get('g0')).toBeCloseTo(12, 1);
        const back = fitted.transform.toPixel(fitted.transform.toGeo({ x: 1234, y: 5678 }));
        expect(back.x).toBeCloseTo(1234, 3);
        expect(back.y).toBeCloseTo(5678, 3);
    });

    it('happyPath_exactlyThreeAffinePairsFitButLeaveNothingToCheck', () => {
        const fitted = ok(fitTransform('affine', [gcp('a', 0, 0), gcp('b', 9000, 0), gcp('c', 0, 7000)]));

        expect(fitted.fitRmseM).toBeLessThan(0.01);
        expect([fitted.checkpointRmseM, fitted.checkpointCount, fitted.residuals.size]).toEqual([null, 0, 0]);
        expect(fitted.checkpointKind).toBeNull();
    });
});

describe('fitTransform: the thin-plate spline', () => {
    it('happyPath_theSplinePassesThroughEveryPairAndItsLeaveOneOutMatchesARefit', () => {
        const pairs = grid().slice(0, 12);
        pairs[6] = shifted(nth(pairs, 6), 20);

        const fitted = ok(fitTransform('tps', pairs));
        const without = ok(fitTransform('tps', [...pairs.slice(0, 6), ...pairs.slice(7)]));
        const moved = pairs[6];
        const predicted = geoToMercator(without.transform.toGeo(moved.pixel));
        const target = geoToMercator(moved.geo);

        expect(fitted.fitRmseM).toBeLessThan(0.01);
        expect(fitted.residuals.get(moved.id)).toBeCloseTo(groundMetres(target.x - predicted.x, target.y - predicted.y, moved.geo.lat), 3);
        const back = fitted.transform.toPixel(fitted.transform.toGeo({ x: 7000, y: 3000 }));
        expect(back.x).toBeCloseTo(7000, 0);
        expect(back.y).toBeCloseTo(3000, 0);
    });

    it('badPath_twoPairsOnOnePixelMakeTheSplineDegenerate', () => {
        const pairs = grid().slice(0, 11);
        pairs.push({ ...nth(pairs, 3), id: 'twin' });

        expect(fitTransform('tps', pairs)).toEqual({ ok: false, reason: 'degenerate' });
    });
});

describe('fitTransform: refusals', () => {
    it('badPath_tooFewEnabledPairsForTheTransform', () => {
        expect(fitTransform('tps', grid().slice(0, 9))).toEqual({ ok: false, reason: 'too-few' });
        expect(fitTransform('affine', [])).toEqual({ ok: false, reason: 'too-few' });
    });

    it('badPath_placesOnOneLineAreDegenerateEvenWhenThePixelsSpread', () => {
        const pairs = [gcp('a', 0, 0), gcp('b', 9000, 0), gcp('c', 0, 7000), gcp('d', 9000, 7000)].map((pair, index) => ({
            ...pair,
            geo: { lat: 44.4 + index * 0.01, lng: 26 + index * 0.01 },
        }));

        expect(fitTransform('affine', pairs)).toEqual({ ok: false, reason: 'degenerate' });
    });

    it('badPath_pixelsOnACircleLeaveTheSecondOrderFitSingular', () => {
        const pairs = Array.from({ length: 8 }, (_pair, index) => {
            const angle = (index * Math.PI) / 4;
            return gcp(`c${String(index)}`, 6000 + 5000 * Math.cos(angle), 6000 + 5000 * Math.sin(angle));
        });

        expect(fitTransform('poly2', pairs)).toEqual({ ok: false, reason: 'degenerate' });
        expect(fitTransform('affine', pairs).ok).toBe(true);
    });

    it('badPath_pixelsOnOnlyTwoRowsLeaveTheSecondOrderFitSingular @S-A16-BAD-POLY2-TWO-ROWS', () => {
        const pairs = [0, 1, 2].flatMap((col) => [gcp(`t${String(col)}`, col * 4500, 0), gcp(`b${String(col)}`, col * 4500, 7000)]);

        expect(fitTransform('poly2', pairs)).toEqual({ ok: false, reason: 'degenerate' });
        expect(fitTransform('affine', pairs).ok).toBe(true);
    });
});

describe('fitTransform: poly2 inverse through a forward grid', () => {
    /** Well-spread scan pixels whose places lie on two latitudes (two streets): reverse-on-pairs was singular. */
    function twoStreetPairs(): Gcp[] {
        const pixels = [
            [0, 0],
            [9000, 0],
            [9000, 7000],
            [0, 7000],
            [4500, 3500],
            [2000, 5000],
        ] as const;
        return pixels.map(([x, y], index) => ({
            id: `s${String(index)}`,
            pixel: { x, y },
            geo: index % 2 === 0 ? { lat: 44.55, lng: 26 + index * 0.015 } : { lat: 44.5, lng: 26 + index * 0.015 },
            enabled: true,
            origin: 'manual' as const,
        }));
    }

    it('happyPath_placesOnTwoStreetsStillFitWhenTheInverseIsSampledOnTheForwardGrid @S-A16-HAPPY-POLY2-GRID-INVERSE', () => {
        const pairs = twoStreetPairs();
        const fitted = ok(fitTransform('poly2', pairs));

        expect(fitted.fitRmseM).toBeLessThan(0.01);
        expect(fitted.transform.kind).toBe('poly2');
        expect(fitTransform('affine', pairs).ok).toBe(true);
    });
});

describe('distanceFromFit', () => {
    it('happyPath_aPairTheFitAgreesWithIsCloseAndAShiftedOneIsAsFarAsItsShift', () => {
        const { transform } = ok(fitTransform('affine', grid()));

        expect(distanceFromFit(transform, gcp('s1', 7000, 5000))).toBeLessThan(0.01);
        expect(distanceFromFit(transform, shifted(gcp('s2', 7000, 5000), 40))).toBeCloseTo(40, 1);
    });
});
