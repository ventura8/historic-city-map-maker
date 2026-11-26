/**
 * The thin-plate spline (`docs/research/M3-interfaces.md` §6.1, GDAL's `-tps`): an exact interpolation through every
 * enabled pair, `f(p) = a₀ + a₁u + a₂v + Σ wᵢ U(|p − pᵢ|)` with `U(r) = r² ln r`, from normalized inputs. One system
 * `[K P; Pᵀ 0] [w; a] = [v; 0]` per fit, solved through its inverse, whose diagonal gives every pair's leave-one-out
 * error without refitting (Rippa's rule: `eₖ = wₖ / (A⁻¹)ₖₖ`).
 */
import { inverse, Matrix } from './matrix.js';
import type { PlanePoint } from './mercator.js';
import type { Correspondence } from './polynomial.js';
import { centroid, normalize, normalizerOf, type Normalizer } from './spread.js';

/** The radial basis `r² ln r`, from the squared distance (0 at the point itself). */
function kernel(squared: number): number {
    return squared === 0 ? 0 : (squared * Math.log(squared)) / 2;
}

function squaredDistance(a: PlanePoint, b: PlanePoint): number {
    return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}

export interface SplineModel {
    readonly input: Normalizer;
    /** The normalized control points. */
    readonly points: readonly PlanePoint[];
    readonly offset: PlanePoint;
    /** `n` kernel weights then the 3 affine coefficients, each an x and a y column. */
    readonly solution: Matrix;
}

export interface SplineFit {
    readonly model: SplineModel;
    /** Each pair's leave-one-out error, in input order. */
    readonly leaveOneOut: readonly PlanePoint[];
}

/** The `(n + 3)²` system of the control points. */
function systemOf(points: readonly PlanePoint[]): Matrix {
    const size = points.length;
    const system = new Matrix(size + 3, size + 3);
    points.forEach((point, i) => {
        const affine = [1, point.x, point.y];
        points.forEach((other, j) => {
            system.set(i, j, kernel(squaredDistance(point, other)));
        });
        affine.forEach((value, k) => {
            system.set(i, size + k, value);
            system.set(size + k, i, value);
        });
    });
    return system;
}

/** The centred outputs, then three zero rows. */
function rightOf(pairs: readonly Correspondence[], offset: PlanePoint): Matrix {
    const right = new Matrix(pairs.length + 3, 2);
    pairs.forEach((pair, index) => {
        right.set(index, 0, pair.output.x - offset.x);
        right.set(index, 1, pair.output.y - offset.y);
    });
    return right;
}

export function evaluateSpline(model: SplineModel, point: PlanePoint): PlanePoint {
    const at = normalize(model.input, point);
    const size = model.points.length;
    const { solution } = model;
    let x = model.offset.x + solution.get(size, 0) + solution.get(size + 1, 0) * at.x + solution.get(size + 2, 0) * at.y;
    let y = model.offset.y + solution.get(size, 1) + solution.get(size + 1, 1) * at.x + solution.get(size + 2, 1) * at.y;
    model.points.forEach((control, index) => {
        const weight = kernel(squaredDistance(at, control));
        x += weight * solution.get(index, 0);
        y += weight * solution.get(index, 1);
    });
    return { x, y };
}

/** The spline through the pairs; null when the system is singular (coincident inputs). */
export function fitSpline(pairs: readonly Correspondence[]): SplineFit | null {
    const input = normalizerOf(pairs.map((pair) => pair.input));
    const offset = centroid(pairs.map((pair) => pair.output));
    const points = pairs.map((pair) => normalize(input, pair.input));
    const inverted = inverse(systemOf(points));
    if (inverted === null) {
        return null;
    }
    const solution = inverted.times(rightOf(pairs, offset));
    const leaveOneOut = points.map((_point, index) => {
        const diagonal = inverted.get(index, index);
        return { x: solution.get(index, 0) / diagonal, y: solution.get(index, 1) / diagonal };
    });
    return { model: { input, points, offset, solution }, leaveOneOut };
}
