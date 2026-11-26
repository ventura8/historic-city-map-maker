/**
 * The least-squares transforms (`docs/research/M3-interfaces.md` §6.1): `affine` (6 unknowns, 3 per axis) and `poly2`
 * (12: the x², xy and y² terms too), fitted from normalized inputs to centred outputs through the normal equations. The
 * hat matrix's diagonal (each pair's leverage) gives every pair's leave-one-out residual without refitting:
 * `e / (1 − h)`; a pair that alone fixes the fitted model (`h` = 1, as each of exactly three affine pairs) has none.
 */
import { inverse, Matrix } from './matrix.js';
import type { PlanePoint } from './mercator.js';
import { centroid, normalize, normalizerOf, type Normalizer } from './spread.js';

/** The terms of each transform, of normalized coordinates. */
const TERMS = {
    affine: (point: PlanePoint): readonly number[] => [1, point.x, point.y],
    poly2: (point: PlanePoint): readonly number[] => [1, point.x, point.y, point.x * point.x, point.x * point.y, point.y * point.y],
} as const;

export type PolynomialKind = keyof typeof TERMS;

/** A leverage this close to 1 leaves no leave-one-out residual (the fit passes through the pair whatever it is). */
const FULL_LEVERAGE = 1e-9;

/** One pair of a fit: a point of the input plane and where it must land. */
export interface Correspondence {
    readonly input: PlanePoint;
    readonly output: PlanePoint;
}

/** A fitted polynomial map from one plane to another. */
export interface PolynomialModel {
    readonly kind: PolynomialKind;
    readonly input: Normalizer;
    readonly offset: PlanePoint;
    /** One row per term, the x and y coefficients. */
    readonly coefficients: Matrix;
}

export interface PolynomialFit {
    readonly model: PolynomialModel;
    /** Each pair's leave-one-out error in output units, in input order (null: the pair fixes the fit). */
    readonly leaveOneOut: readonly (PlanePoint | null)[];
}

export function evaluatePolynomial(model: PolynomialModel, point: PlanePoint): PlanePoint {
    const terms = TERMS[model.kind](normalize(model.input, point));
    let x = model.offset.x;
    let y = model.offset.y;
    terms.forEach((term, index) => {
        x += term * model.coefficients.get(index, 0);
        y += term * model.coefficients.get(index, 1);
    });
    return { x, y };
}

interface DesignRow extends Correspondence {
    readonly terms: readonly number[];
}

/** `Σ aᵢ aᵢᵀ` and `Σ aᵢ (outᵢ − offset)ᵀ` of the design rows. */
function normalEquations(size: number, rows: readonly DesignRow[], offset: PlanePoint): [Matrix, Matrix] {
    const normal = new Matrix(size, size);
    const right = new Matrix(size, 2);
    for (const { terms, output } of rows) {
        terms.forEach((left, i) => {
            right.add(i, 0, left * (output.x - offset.x));
            right.add(i, 1, left * (output.y - offset.y));
            terms.forEach((term, j) => {
                normal.add(i, j, left * term);
            });
        });
    }
    return [normal, right];
}

/** `aᵀ N⁻¹ a`. */
function leverageOf(terms: readonly number[], inverted: Matrix): number {
    let sum = 0;
    terms.forEach((left, i) => {
        terms.forEach((right, j) => {
            sum += left * inverted.get(i, j) * right;
        });
    });
    return sum;
}

/** The leave-one-out error of a residual `(dx, dy)` at leverage `h`, or null when the pair fixes the fit. */
function leaveOneOut(residual: PlanePoint, leverage: number): PlanePoint | null {
    const free = 1 - leverage;
    return free > FULL_LEVERAGE ? { x: residual.x / free, y: residual.y / free } : null;
}

/** The least-squares fit through the pairs; null when the normal matrix is singular. */
export function fitPolynomial(kind: PolynomialKind, pairs: readonly Correspondence[]): PolynomialFit | null {
    const input = normalizerOf(pairs.map((pair) => pair.input));
    const offset = centroid(pairs.map((pair) => pair.output));
    const rows = pairs.map((pair) => ({ ...pair, terms: TERMS[kind](normalize(input, pair.input)) }));
    const [normal, right] = normalEquations(TERMS[kind](offset).length, rows, offset);
    const inverted = inverse(normal);
    if (inverted === null) {
        return null;
    }
    const model = { kind, input, offset, coefficients: inverted.times(right) };
    const errors = rows.map((row) => {
        const fitted = evaluatePolynomial(model, row.input);
        return leaveOneOut({ x: row.output.x - fitted.x, y: row.output.y - fitted.y }, leverageOf(row.terms, inverted));
    });
    return { model, leaveOneOut: errors };
}
