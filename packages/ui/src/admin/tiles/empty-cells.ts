/**
 * M20 §19.13 (2026-11-21, the 1:500 of 1960-71 with chequerboard gaps): the grid's cells no sheet fills, said apart from the sheets the
 * layout left out (`<hcm-tile-grid>`'s "Sheets left out"). A cell with no sheet means the archive holds no sheet for it, or one of the
 * sheets left out belongs there: the owner puts it back, or leaves the gap.
 */
import type { UiLocale } from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

import { tilesText as t } from './tiles-text.js';
import type { TilesViewState } from './tiles-port.js';

/** At most this many empty cells are named; the heading counts them all. */
export const EMPTY_CELLS_NAMED_MAX = 50;

/** A cell's key in a set. */
function cellKey(row: number, col: number): string {
    return [row, col].join(':');
}

/** The grid's cells with no sheet in them, row by row (counted from 0). */
export function emptyCells(view: Pick<TilesViewState, 'rows' | 'cols' | 'sheets'>): { row: number; col: number }[] {
    const taken = new Set(view.sheets.filter((sheet) => sheet.out === null).map((sheet) => cellKey(sheet.row, sheet.col)));
    const cells: { row: number; col: number }[] = [];
    for (let row = 0; row < view.rows; row += 1) {
        for (let col = 0; col < view.cols; col += 1) {
            if (!taken.has(cellKey(row, col))) {
                cells.push({ row, col });
            }
        }
    }
    return cells;
}

/** "Cells with no sheet": how many, why, and the first of them by row and column; nothing when every cell has a sheet. */
export function emptyCellsSection(locale: UiLocale, view: Pick<TilesViewState, 'rows' | 'cols' | 'sheets'>): TemplateResult {
    const cells = emptyCells(view);
    if (cells.length === 0) {
        return html``;
    }
    return html`<section aria-labelledby="empty-cells" data-state="empty-cells">
        <h3 id="empty-cells">${t(locale, 'adminTiles.emptyLabel', { count: String(cells.length) })}</h3>
        <p>${t(locale, 'adminTiles.emptyWhy')}</p>
        <ul>
            ${cells
                .slice(0, EMPTY_CELLS_NAMED_MAX)
                .map(
                    (cell) => html`<li>${t(locale, 'adminTiles.emptyCell', { row: String(cell.row + 1), col: String(cell.col + 1) })}</li>`,
                )}
        </ul>
    </section>`;
}
