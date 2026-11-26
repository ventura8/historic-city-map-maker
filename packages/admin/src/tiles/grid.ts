/**
 * The tile-import wizard's grid size (`docs/research/M20-import-local.md` §19.17, the Borroczyn atlas 1846: 11 columns by 10 rows,
 * which the pipeline laid out 20 by 5, so a sheet dropped on column 10 landed on column 5). The owner adds or takes away rows and
 * columns; where the files are numbered 1..N, the sheets are laid out row by row in a column count the names may show. Pure functions:
 * the answer carries the cells, the pipeline's grid follows them (`owner_layout.py`), all within `LAYOUT_SHEETS_MAX`.
 */
import { LAYOUT_SHEETS_MAX } from '@hcm/shared';

import type { DraftSheet, Grid } from './draft.js';

/** Whether a grid of `next` holds every sheet in the grid and stays within `LAYOUT_SHEETS_MAX` cells. */
export function canResize(sheets: readonly DraftSheet[], next: Grid): boolean {
    if (next.rows < 1 || next.cols < 1 || next.rows * next.cols > LAYOUT_SHEETS_MAX) {
        return false;
    }
    return sheets.every((sheet) => sheet.out !== null || (sheet.row < next.rows && sheet.col < next.cols));
}

/** The one number in a file's name (its folders and extension left aside), or null. */
export function numberOf(name: string): number | null {
    const base = (name.split('/').pop() ?? '').replace(/\.[^.]*$/, '');
    const found = /^\D*(\d+)\D*$/.exec(base);
    return found === null ? null : Number(found[1]);
}

/** The sheets a layout by number moves: those in the grid and those left out for no seam (never the owner's or a blank page). */
function movable(sheet: DraftSheet): boolean {
    return sheet.out === null || sheet.out === 'no-seam';
}

/**
 * Each movable sheet's file number when every one has its own number from 1 (a run 1..N, gaps allowed: a page missing from the
 * archive), else null. At least two sheets.
 */
export function numberedRun(sheets: readonly DraftSheet[]): ReadonlyMap<number, number> | null {
    const numbers = new Map(sheets.filter(movable).map((sheet) => [sheet.index, numberOf(sheet.name) ?? 0]));
    const values = [...numbers.values()];
    const fit = values.every((number) => inRange(number)) && new Set(values).size === values.length;
    return fit && numbers.size >= 2 ? numbers : null;
}

/** A file number or a column count the grid can hold. */
function inRange(value: number): boolean {
    return value >= 1 && value <= LAYOUT_SHEETS_MAX;
}

/** Names that state the column count: `11x10` (columns by rows), `11 col`, `11 coloane`, `11 columns`. */
const GRAMMARS: readonly RegExp[] = [/(\d{1,5}) ?[x×] ?\d/i, /(\d{1,5}) ?col(?:s|umns?|oane)?\b/i];

/** The column count a name shows by one grammar, else 0. */
function statedBy(grammar: RegExp, names: readonly string[]): number {
    const counts = names.map((name) => Number(grammar.exec(name)?.[1] ?? 0));
    return counts.find((count) => inRange(count)) ?? 0;
}

/** The column count a name shows, or null. */
export function columnsHint(names: readonly string[]): number | null {
    const counts = GRAMMARS.map((grammar) => statedBy(grammar, names));
    return counts.find((count) => count > 0) ?? null;
}

/** The columns the wizard offers for a layout by number (the names', else the grid's), or null when the files are not numbered. */
export function reflowColsOf(sheets: readonly DraftSheet[], grid: Grid): number | null {
    return numberedRun(sheets) === null ? null : (columnsHint(sheets.map((sheet) => sheet.name)) ?? grid.cols);
}

/**
 * The numbered sheets laid out row by row in `cols` columns (sheet `n` at row `(n - 1) / cols`, column `(n - 1) % cols`), each now
 * the owner's, and the grid that holds them; null when the files are not numbered or the grid would pass `LAYOUT_SHEETS_MAX` cells.
 */
export function reflowed(sheets: readonly DraftSheet[], cols: number): { sheets: readonly DraftSheet[]; grid: Grid } | null {
    const numbers = numberedRun(sheets);
    if (numbers === null || !Number.isInteger(cols) || cols < 1) {
        return null;
    }
    const rows = Math.ceil(Math.max(...numbers.values()) / cols);
    if (rows * cols > LAYOUT_SHEETS_MAX) {
        return null;
    }
    const moved = sheets.map((sheet) => {
        const number = numbers.get(sheet.index);
        if (number === undefined) {
            return sheet;
        }
        return { ...sheet, row: Math.floor((number - 1) / cols), col: (number - 1) % cols, out: null, source: 'owner' as const };
    });
    return { sheets: moved, grid: { rows, cols } };
}
