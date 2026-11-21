/**
 * M20 §19.17 (2026-11-21, the Borroczyn atlas 1846: 11 columns by 10 rows, laid out 20 by 5 by the pipeline): the grid's size under
 * the owner's hand. A row or a column more, the last one taken away while no sheet is in it, and, for files numbered 1..N, the sheets
 * laid out row by row in a column count (the names' when they show one). The grid stays within `LAYOUT_SHEETS_MAX` cells.
 */
import { LAYOUT_SHEETS_MAX, type UiLocale } from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

import { tilesText as t } from './tiles-text.js';
import type { TilesIntentsPort, TilesViewState } from './tiles-port.js';

type GridView = Pick<TilesViewState, 'rows' | 'cols' | 'sheets' | 'reflowCols'>;

/** Whether a placed sheet sits in the last row (`axis` row) or the last column. */
function lastLineHolds(view: GridView, axis: 'row' | 'col'): boolean {
    const last = (axis === 'row' ? view.rows : view.cols) - 1;
    return view.sheets.some((sheet) => sheet.out === null && sheet[axis] === last);
}

/** What each of the four buttons may do now. */
export function gridMoves(view: GridView): { addRow: boolean; addCol: boolean; dropRow: boolean; dropCol: boolean } {
    return {
        addRow: (view.rows + 1) * view.cols <= LAYOUT_SHEETS_MAX,
        addCol: view.rows * (view.cols + 1) <= LAYOUT_SHEETS_MAX,
        dropRow: view.rows > 1 && !lastLineHolds(view, 'row'),
        dropCol: view.cols > 1 && !lastLineHolds(view, 'col'),
    };
}

/** The column count typed beside the button, read when it is pressed. */
function typedCols(event: Event): number {
    const input = (event.currentTarget as HTMLElement).closest('.reflow')?.querySelector('input');
    return input?.valueAsNumber ?? Number.NaN;
}

function reflowForm(locale: UiLocale, cols: number, intents: TilesIntentsPort | null): TemplateResult {
    return html`<div class="reflow">
        <p class="note">${t(locale, 'adminTiles.reflowHelp')}</p>
        <label
            >${t(locale, 'adminTiles.reflowCols')}
            <input name="cols" type="number" min="1" max=${LAYOUT_SHEETS_MAX} step="1" .value=${String(cols)}
        /></label>
        <hcm-button variant="tonal" icon="tune" @click=${(event: Event) => intents?.reflow(typedCols(event))}
            >${t(locale, 'adminTiles.reflow')}</hcm-button
        >
    </div>`;
}

/** "Grid size": the rows and columns with a button each way, and the layout by file number when the files are numbered. */
export function gridSizeSection(locale: UiLocale, view: GridView, intents: TilesIntentsPort | null): TemplateResult {
    const moves = gridMoves(view);
    const button = (allowed: boolean, key: Parameters<typeof t>[1], [rows, cols]: readonly [number, number]): TemplateResult =>
        html`<hcm-button
            variant="text"
            icon=${rows + cols > 0 ? 'add' : 'remove'}
            ?disabled=${!allowed}
            @click=${() => intents?.resize(rows, cols)}
            >${t(locale, key)}</hcm-button
        >`;
    return html`<section aria-labelledby="grid-size" data-state="grid-size">
        <h3 id="grid-size">${t(locale, 'adminTiles.sizeLabel', { rows: String(view.rows), cols: String(view.cols) })}</h3>
        <p class="note">${t(locale, 'adminTiles.sizeHelp')}</p>
        <div class="tools">
            ${button(moves.addRow, 'adminTiles.addRow', [1, 0])} ${button(moves.dropRow, 'adminTiles.dropRow', [-1, 0])}
            ${button(moves.addCol, 'adminTiles.addCol', [0, 1])} ${button(moves.dropCol, 'adminTiles.dropCol', [0, -1])}
        </div>
        ${view.reflowCols === null ? '' : reflowForm(locale, view.reflowCols, intents)}
    </section>`;
}
