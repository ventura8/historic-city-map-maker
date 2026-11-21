/**
 * The tile-import wizard's draft of a series' sheets (`docs/research/M20-import-local.md` §19.11): the grid of `layout.json` as the
 * owner rearranges it. Pure functions; every change gives a new list, each sheet it touched now the owner's (`source: 'owner'`).
 */
import {
    THUMB_CELL_PX,
    THUMB_SPRITE_COLS,
    type LayoutFile,
    type LayoutSheet,
    type LeftOutReason,
    type OwnerSheet,
    type SheetSource,
    type SheetTurn,
} from '@hcm/shared';

export interface DraftSheet {
    readonly index: number;
    readonly name: string;
    readonly row: number;
    readonly col: number;
    readonly turn: SheetTurn;
    readonly flip: boolean;
    readonly out: LeftOutReason | null;
    readonly source: SheetSource;
    /** The oriented sheet's size in pixels, as the pipeline measured it. */
    readonly width: number;
    readonly height: number;
}

export interface Cell {
    readonly row: number;
    readonly col: number;
}

export interface Grid {
    readonly rows: number;
    readonly cols: number;
}

function draftOf(sheet: LayoutSheet, index: number): DraftSheet {
    const { name, row, col, turn, flip, source, width, height } = sheet;
    return { index, name, row, col, turn, flip, out: sheet.out ?? null, source, width, height };
}

/** The sheets of `layout.json`, in its order. */
export function sheetsOf(file: LayoutFile): readonly DraftSheet[] {
    return file.sheets.map(draftOf);
}

/** The sheet in the grid at `cell`, if any. */
export function sheetAt(sheets: readonly DraftSheet[], cell: Cell): DraftSheet | undefined {
    return sheets.find((sheet) => sheet.out === null && sheet.row === cell.row && sheet.col === cell.col);
}

function changed(sheets: readonly DraftSheet[], index: number, change: Partial<DraftSheet>): readonly DraftSheet[] {
    return sheets.map((sheet) => (sheet.index === index ? { ...sheet, ...change, source: 'owner' } : sheet));
}

/**
 * Drops sheet `index` on `cell`. A placed sheet there takes the dropped one's cell; a sheet coming back from the left-out ones only
 * lands on an empty cell.
 */
export function placeAt(sheets: readonly DraftSheet[], index: number, cell: Cell): readonly DraftSheet[] {
    const moved = sheets.find((sheet) => sheet.index === index);
    const there = sheetAt(sheets, cell);
    if (moved === undefined || !canDrop(moved, there)) {
        return sheets;
    }
    const placed = changed(sheets, index, { row: cell.row, col: cell.col, out: null });
    return there === undefined ? placed : changed(placed, there.index, { row: moved.row, col: moved.col });
}

/** A sheet lands on an empty cell, or on another placed sheet's cell when it is itself placed. */
function canDrop(moved: DraftSheet, there: DraftSheet | undefined): boolean {
    return there === undefined || (there.index !== moved.index && moved.out === null);
}

function clamp(value: number, size: number): number {
    return Math.min(Math.max(value, 0), size - 1);
}

/** The cell `rows` and `cols` away from `cell`, inside the grid. */
export function stepFrom(cell: Cell, rows: number, cols: number, grid: Grid): Cell {
    return { row: clamp(cell.row + rows, grid.rows), col: clamp(cell.col + cols, grid.cols) };
}

/** Moves the sheet at `cell` to the neighbouring cell `rows`, `cols` away (Shift and the arrows). */
export function shiftFrom(sheets: readonly DraftSheet[], cell: Cell, target: Cell): readonly DraftSheet[] {
    const sheet = sheetAt(sheets, cell);
    return sheet === undefined ? sheets : placeAt(sheets, sheet.index, target);
}

/** The sheet at `cell` with `change` made of it (a turn, a mirror, out of the map). */
export function changeAt(
    sheets: readonly DraftSheet[],
    cell: Cell,
    change: (sheet: DraftSheet) => Partial<DraftSheet>,
): readonly DraftSheet[] {
    const sheet = sheetAt(sheets, cell);
    return sheet === undefined ? sheets : changed(sheets, sheet.index, change(sheet));
}

/** A quarter turn clockwise. */
export function turned(sheet: DraftSheet): Partial<DraftSheet> {
    return { turn: ((sheet.turn + 90) % 360) as SheetTurn, width: sheet.height, height: sheet.width };
}

export function mirrored(sheet: DraftSheet): Partial<DraftSheet> {
    return { flip: !sheet.flip };
}

export function notPart(): Partial<DraftSheet> {
    return { out: 'not-part' };
}

/** The first empty cell, row by row. */
export function firstEmpty(sheets: readonly DraftSheet[], grid: Grid): Cell | null {
    for (let row = 0; row < grid.rows; row += 1) {
        for (let col = 0; col < grid.cols; col += 1) {
            if (sheetAt(sheets, { row, col }) === undefined) {
                return { row, col };
            }
        }
    }
    return null;
}

/** A left-out sheet back in the first empty cell (none: as it is). */
export function putBack(sheets: readonly DraftSheet[], index: number, grid: Grid): readonly DraftSheet[] {
    const cell = firstEmpty(sheets, grid);
    return cell === null ? sheets : placeAt(sheets, index, cell);
}

/** The sheets in the grid. */
export function placedCount(sheets: readonly DraftSheet[]): number {
    return sheets.filter((sheet) => sheet.out === null).length;
}

function ownerSheetOf(sheet: DraftSheet): OwnerSheet {
    const { index, row, col, turn, flip } = sheet;
    return sheet.out === 'not-part' ? { index, row, col, turn, flip, out: 'not-part' } : { index, row, col, turn, flip };
}

/**
 * The reasons a sheet keeps a cell of the pipeline's grid while it is left out: no seam to its neighbours was found (or no shared
 * edge, the older joins). Such a sheet is tried again at its cell (`docs/research/M20-import-local.md` §19.11): the pipeline marks
 * every sheet an answer does not name `not-part` for good.
 */
const RETRIED: ReadonlySet<LeftOutReason> = new Set<LeftOutReason>(['no-seam', 'no-join']);

/** A sheet the answer names: in the grid, taken out by the owner, or left out for no seam with its cell still free. */
function named(sheet: DraftSheet, sheets: readonly DraftSheet[]): boolean {
    if (sheet.out === null || sheet.out === 'not-part') {
        return true;
    }
    return RETRIED.has(sheet.out) && sheetAt(sheets, sheet) === undefined;
}

/**
 * The owner's answer: every sheet in the grid, every sheet the owner took out of the map, and every sheet left out for no seam
 * whose cell no other sheet took (it goes back to that cell, so the pipeline seeks its seams again). A blank page or a sheet with no
 * frame is not named.
 */
export function ownerSheetsOf(sheets: readonly DraftSheet[]): OwnerSheet[] {
    return sheets.filter((sheet) => named(sheet, sheets)).map(ownerSheetOf);
}

/**
 * A sheet's thumbnail in `thumbs.jpg`: its cell of the sprite, the thumbnail as stored (no turn) in the cell's top left, its long
 * side `THUMB_CELL_PX`.
 */
export function thumbOf(sheet: DraftSheet): readonly [number, number, number, number] {
    const sideways = sheet.turn % 180 !== 0;
    const width = sideways ? sheet.height : sheet.width;
    const height = sideways ? sheet.width : sheet.height;
    const scale = THUMB_CELL_PX / Math.max(width, height);
    const x = (sheet.index % THUMB_SPRITE_COLS) * THUMB_CELL_PX;
    const y = Math.floor(sheet.index / THUMB_SPRITE_COLS) * THUMB_CELL_PX;
    return [x, y, Math.round(width * scale), Math.round(height * scale)];
}

/** `thumbs.jpg`'s size for `count` sheets. */
export function thumbSpriteOf(count: number): { readonly width: number; readonly height: number } {
    return { width: Math.min(count, THUMB_SPRITE_COLS) * THUMB_CELL_PX, height: Math.ceil(count / THUMB_SPRITE_COLS) * THUMB_CELL_PX };
}
