/**
 * `fitTransform` (`docs/research/M3-interfaces.md` §6.2): the georeferencer's live fit and `imagery.saveGcps`'s check,
 * held to the pipeline's numpy answers by the golden cases (`pipeline/tests/contracts/georef-cases.json`). Pixels →
 * EPSG:3857 metres; a transform with fewer enabled pairs than `MIN_GCPS` is refused (`too-few`), as is a set that spans
 * no area or a singular system (`degenerate`). Residuals are ground metres: an enabled pair's is its leave-one-out
 * residual, a disabled pair's (a checkpoint) its distance from where the transform puts its pixel. `checkpointRmseM` is
 * the disabled pairs' RMSE when there are any, else the leave-one-out RMSE of the enabled ones (null when none has one);
 * `checkpointKind` says which (M9: only `held-out` approves on its own).
 *
 * A poly2 has no poly2 inverse: the place→pixel map is fitted on a grid of the forward map over the pairs' pixels
 * (`POLY2_INVERSE_GRID`, pipeline `INVERSE_GRID`), never on the pairs alone — that refused well-spread scans whose places
 * lay on two lines (DECISIONS §144).
 */
import { MIN_GCPS, type CheckpointKind, type Gcp, type GeorefTransform } from '../schemas/georef.js';
import { geoToMercator, groundMetres, mercatorToGeo, type GeoPoint, type PlanePoint } from './mercator.js';
import { evaluatePolynomial, fitPolynomial, type Correspondence, type PolynomialKind, type PolynomialModel } from './polynomial.js';
import { isDegenerateSpread } from './spread.js';
import { evaluateSpline, fitSpline } from './tps.js';

/** Side length of the grid the poly2 inverse is fitted on (pipeline `transforms.INVERSE_GRID`). */
const POLY2_INVERSE_GRID = 15;

export type PixelPoint = PlanePoint;

export interface FittedTransform {
    readonly kind: GeorefTransform;
    /** Scan pixel → WGS84. */
    toGeo(pixel: PixelPoint): GeoPoint;
    /** WGS84 → scan pixel (the inverse fit, for the warped preview's mesh). */
    toPixel(geo: GeoPoint): PixelPoint;
}

export type FitRefusal = 'too-few' | 'degenerate';

export type FitResult =
    | {
          readonly ok: true;
          readonly transform: FittedTransform;
          /** Ground metres by pair id (an enabled pair that alone fixes the fit has none). */
          readonly residuals: ReadonlyMap<string, number>;
          readonly fitRmseM: number;
          readonly checkpointRmseM: number | null;
          readonly checkpointCount: number;
          readonly checkpointKind: CheckpointKind | null;
      }
    | { readonly ok: false; readonly reason: FitRefusal };

/** A fit in both directions, and each enabled pair's leave-one-out error in EPSG:3857 metres (null: none). */
interface Fitted {
    readonly forward: (pixel: PixelPoint) => PlanePoint;
    readonly backward: (metres: PlanePoint) => PixelPoint;
    readonly leaveOneOut: readonly (PlanePoint | null)[];
}

/** The enabled pairs as both fits take them: pixel → metres, and metres → pixel. */
interface Pairs {
    readonly forward: readonly Correspondence[];
    readonly backward: readonly Correspondence[];
}

type Fitter = (pairs: Pairs) => Fitted | null;

function polynomialFitter(kind: PolynomialKind): Fitter {
    return (pairs) => {
        const forward = fitPolynomial(kind, pairs.forward);
        const backward = fitPolynomial(kind, pairs.backward);
        if (forward === null || backward === null) {
            return null;
        }
        return {
            forward: (pixel) => evaluatePolynomial(forward.model, pixel),
            backward: (point) => evaluatePolynomial(backward.model, point),
            leaveOneOut: forward.leaveOneOut,
        };
    };
}

/** One axis of the poly2 inverse grid: `index` of `POLY2_INVERSE_GRID` samples from `min` to `max`. */
function gridAxis(min: number, max: number, index: number): number {
    return min + ((max - min) * index) / (POLY2_INVERSE_GRID - 1);
}

/** Place→pixel samples of the forward poly2 on a grid over the pairs' pixels (a quadratic has no exact inverse). */
function poly2InverseNodes(forward: PolynomialModel, pairs: readonly Correspondence[]): Correspondence[] {
    const xs = pairs.map((pair) => pair.input.x);
    const ys = pairs.map((pair) => pair.input.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    return Array.from({ length: POLY2_INVERSE_GRID * POLY2_INVERSE_GRID }, (_node, index) => {
        const pixel = {
            x: gridAxis(minX, maxX, index % POLY2_INVERSE_GRID),
            y: gridAxis(minY, maxY, Math.floor(index / POLY2_INVERSE_GRID)),
        };
        return { input: evaluatePolynomial(forward, pixel), output: pixel };
    });
}

/** Poly2: forward through the pairs; inverse through a forward-sampled grid (pipeline `_inverse_grid`). */
const poly2Fitter: Fitter = (pairs) => {
    const forward = fitPolynomial('poly2', pairs.forward);
    if (forward === null) {
        return null;
    }
    const backward = fitPolynomial('poly2', poly2InverseNodes(forward.model, pairs.forward));
    if (backward === null) {
        return null;
    }
    return {
        forward: (pixel) => evaluatePolynomial(forward.model, pixel),
        backward: (point) => evaluatePolynomial(backward.model, point),
        leaveOneOut: forward.leaveOneOut,
    };
};

const splineFitter: Fitter = (pairs) => {
    const forward = fitSpline(pairs.forward);
    const backward = fitSpline(pairs.backward);
    if (forward === null || backward === null) {
        return null;
    }
    return {
        forward: (pixel) => evaluateSpline(forward.model, pixel),
        backward: (point) => evaluateSpline(backward.model, point),
        leaveOneOut: forward.leaveOneOut,
    };
};

const FITTERS: Readonly<Record<GeorefTransform, Fitter>> = {
    affine: polynomialFitter('affine'),
    poly2: poly2Fitter,
    tps: splineFitter,
};

/** The root mean square of the values (0 for none). */
function rms(values: readonly number[]): number {
    return Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / Math.max(values.length, 1));
}

/** Ground metres between a pair's place and where the forward fit puts its pixel. */
function missBy(fitted: Fitted, gcp: Gcp): number {
    const target = geoToMercator(gcp.geo);
    const at = fitted.forward(gcp.pixel);
    return groundMetres(target.x - at.x, target.y - at.y, gcp.geo.lat);
}

/**
 * Ground metres between a pair's place and where `transform` puts its pixel: how far a suggestion the admin has not
 * accepted lies from the page's current fit; it is not part of that fit, so this is a true check.
 */
export function distanceFromFit(transform: FittedTransform, gcp: Pick<Gcp, 'pixel' | 'geo'>): number {
    const target = geoToMercator(gcp.geo);
    const at = geoToMercator(transform.toGeo(gcp.pixel));
    return groundMetres(target.x - at.x, target.y - at.y, gcp.geo.lat);
}

/** The enabled pairs' leave-one-out residuals in ground metres, by id (pairs without one left out). */
function enabledResiduals(fitted: Fitted, enabled: readonly Gcp[]): [string, number][] {
    return enabled.flatMap((gcp, index) => {
        const error = fitted.leaveOneOut.at(index) ?? null;
        return error === null ? [] : [[gcp.id, groundMetres(error.x, error.y, gcp.geo.lat)] as [string, number]];
    });
}

/** What the checks are: the disabled pairs, else the enabled ones against each other (null: no checks at all). */
function kindOf(disabled: number, count: number): CheckpointKind | null {
    if (count === 0) {
        return null;
    }
    return disabled > 0 ? 'held-out' : 'leave-one-out';
}

function measured(fitted: Fitted, kind: GeorefTransform, enabled: readonly Gcp[], checks: readonly Gcp[]): FitResult {
    const held = enabledResiduals(fitted, enabled);
    const checked = checks.map((gcp) => [gcp.id, missBy(fitted, gcp)] as [string, number]);
    const checkpoints = checks.length > 0 ? checked : held;
    return {
        ok: true,
        transform: {
            kind,
            toGeo: (pixel) => mercatorToGeo(fitted.forward(pixel)),
            toPixel: (geo) => fitted.backward(geoToMercator(geo)),
        },
        residuals: new Map([...held, ...checked]),
        fitRmseM: rms(enabled.map((gcp) => missBy(fitted, gcp))),
        checkpointRmseM: checkpoints.length === 0 ? null : rms(checkpoints.map(([, metres]) => metres)),
        checkpointCount: checkpoints.length,
        checkpointKind: kindOf(checks.length, checkpoints.length),
    };
}

interface Paired {
    readonly pixel: PixelPoint;
    readonly metres: PlanePoint;
}

/** The pixels or the places span no area. */
function degenerate(pairs: readonly Paired[]): boolean {
    return isDegenerateSpread(pairs.map((pair) => pair.pixel)) || isDegenerateSpread(pairs.map((pair) => pair.metres));
}

function correspondences(pairs: readonly Paired[]): Pairs {
    return {
        forward: pairs.map((pair) => ({ input: pair.pixel, output: pair.metres })),
        backward: pairs.map((pair) => ({ input: pair.metres, output: pair.pixel })),
    };
}

/** Fits `kind` through the enabled pairs of `gcps`; the disabled ones are checkpoints. */
export function fitTransform(kind: GeorefTransform, gcps: readonly Gcp[]): FitResult {
    const enabled = gcps.filter((gcp) => gcp.enabled);
    if (enabled.length < MIN_GCPS[kind]) {
        return { ok: false, reason: 'too-few' };
    }
    const pairs = enabled.map((gcp) => ({ pixel: gcp.pixel, metres: geoToMercator(gcp.geo) }));
    const fitted = degenerate(pairs) ? null : FITTERS[kind](correspondences(pairs));
    if (fitted === null) {
        return { ok: false, reason: 'degenerate' };
    }
    return measured(
        fitted,
        kind,
        enabled,
        gcps.filter((gcp) => !gcp.enabled),
    );
}
