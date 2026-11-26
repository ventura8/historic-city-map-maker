/**
 * Small dense matrices for the georeferencing fits (`docs/research/M3-interfaces.md` §6): the least-squares normal
 * equations of the affine and second-order polynomial fits (at most 6 unknowns per axis) and the thin-plate spline's
 * system (one row per enabled pair, `MAX_GCPS` at most, plus 3). Row-major `Float64Array`s and Gaussian elimination
 * with partial pivoting. Pure and environment-neutral: the admin's georeferencer refits on every move, `imagery.saveGcps`
 * refits server-side with the same code.
 *
 * A matrix is **singular** when a pivot falls under `SINGULAR` of its largest entry. The fits normalize their inputs
 * (`spread.ts`), so this is the contract's "condition number of the design matrix over 1e12": the normal matrix's
 * condition is the design matrix's squared, and past 1e24 its pivots vanish in double precision long before.
 */

/** A pivot smaller than this share of the matrix's largest entry makes the matrix singular. */
const SINGULAR = 1e-13;

export class Matrix {
    readonly rows: number;
    readonly cols: number;
    readonly data: Float64Array;

    constructor(rows: number, cols: number) {
        this.rows = rows;
        this.cols = cols;
        this.data = new Float64Array(rows * cols);
    }

    /** A matrix of the given rows (all of one length). */
    static of(rows: readonly (readonly number[])[]): Matrix {
        const matrix = new Matrix(rows.length, rows[0]?.length ?? 0);
        rows.forEach((row, index) => {
            matrix.data.set(row, index * matrix.cols);
        });
        return matrix;
    }

    static identity(size: number): Matrix {
        const matrix = new Matrix(size, size);
        for (let index = 0; index < size; index += 1) {
            matrix.set(index, index, 1);
        }
        return matrix;
    }

    get(row: number, col: number): number {
        return Number(this.data[row * this.cols + col]);
    }

    set(row: number, col: number, value: number): void {
        this.data[row * this.cols + col] = value;
    }

    add(row: number, col: number, value: number): void {
        this.data[row * this.cols + col] = this.get(row, col) + value;
    }

    swapRows(a: number, b: number): void {
        const first = this.data.slice(a * this.cols, (a + 1) * this.cols);
        this.data.copyWithin(a * this.cols, b * this.cols, (b + 1) * this.cols);
        this.data.set(first, b * this.cols);
    }

    /** The largest absolute entry (0 for an empty matrix). */
    largest(): number {
        return this.data.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
    }

    /** `this × other`. */
    times(other: Matrix): Matrix {
        const product = new Matrix(this.rows, other.cols);
        for (let row = 0; row < this.rows; row += 1) {
            for (let col = 0; col < other.cols; col += 1) {
                product.set(row, col, this.#dotColumn(row, other, col));
            }
        }
        return product;
    }

    #dotColumn(row: number, other: Matrix, col: number): number {
        let sum = 0;
        for (let index = 0; index < this.cols; index += 1) {
            sum += this.get(row, index) * other.get(index, col);
        }
        return sum;
    }
}

/** `[a | b]`: the columns of `b` after those of `a` (same number of rows). */
function augment(a: Matrix, b: Matrix): Matrix {
    const work = new Matrix(a.rows, a.cols + b.cols);
    for (let row = 0; row < a.rows; row += 1) {
        work.data.set(a.data.subarray(row * a.cols, (row + 1) * a.cols), row * work.cols);
        work.data.set(b.data.subarray(row * b.cols, (row + 1) * b.cols), row * work.cols + a.cols);
    }
    return work;
}

function pivotRow(work: Matrix, col: number): number {
    let best = col;
    for (let row = col + 1; row < work.rows; row += 1) {
        if (Math.abs(work.get(row, col)) > Math.abs(work.get(best, col))) {
            best = row;
        }
    }
    return best;
}

/** Moves the largest entry of column `col` (from its diagonal down) onto the diagonal; false when it is too small. */
function pivotOn(work: Matrix, col: number, tolerance: number): boolean {
    const best = pivotRow(work, col);
    if (Math.abs(work.get(best, col)) <= tolerance) {
        return false;
    }
    work.swapRows(col, best);
    return true;
}

function eliminateBelow(work: Matrix, col: number): void {
    const pivot = work.get(col, col);
    for (let row = col + 1; row < work.rows; row += 1) {
        const factor = work.get(row, col) / pivot;
        for (let index = col; index < work.cols; index += 1) {
            work.add(row, index, -factor * work.get(col, index));
        }
    }
}

/** The solved value of unknown `row` in right-hand column `col`, the unknowns below it known. */
function solvedValue(work: Matrix, solution: Matrix, row: number, col: number): number {
    let sum = work.get(row, work.rows + col);
    for (let index = row + 1; index < work.rows; index += 1) {
        sum -= work.get(row, index) * solution.get(index, col);
    }
    return sum / work.get(row, row);
}

function backSubstitute(work: Matrix, columns: number): Matrix {
    const solution = new Matrix(work.rows, columns);
    for (let row = work.rows - 1; row >= 0; row -= 1) {
        for (let col = 0; col < columns; col += 1) {
            solution.set(row, col, solvedValue(work, solution, row, col));
        }
    }
    return solution;
}

/** The `X` of `a X = b` (`a` square); null when `a` is singular. */
export function solve(a: Matrix, b: Matrix): Matrix | null {
    const work = augment(a, b);
    const tolerance = SINGULAR * a.largest();
    for (let col = 0; col < a.rows; col += 1) {
        if (!pivotOn(work, col, tolerance)) {
            return null;
        }
        eliminateBelow(work, col);
    }
    return backSubstitute(work, b.cols);
}

/** The inverse of a square matrix; null when it is singular. */
export function inverse(a: Matrix): Matrix | null {
    return solve(a, Matrix.identity(a.rows));
}
