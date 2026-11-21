/** M20 §19.13: the tile wizard says which cells no sheet fills, apart from the sheets the layout left out. */
import { render } from 'lit';
import { describe, expect, it } from 'vitest';

import { EMPTY_CELLS_NAMED_MAX, emptyCells, emptyCellsSection } from '../../../src/admin/tiles/empty-cells.js';
import { tilesView } from './fixtures.js';

function shown(view: Parameters<typeof emptyCellsSection>[1]): HTMLElement {
    const host = document.createElement('div');
    render(emptyCellsSection('en', view), host);
    return host;
}

describe('the cells with no sheet', () => {
    it('happyPath_aGapInTheGridIsNamedByRowAndColumnApartFromTheSheetsLeftOut @S-A-HAPPY-FIX-TILES', () => {
        const view = tilesView();

        expect(emptyCells(view)).toEqual([{ row: 1, col: 1 }]);
        const host = shown(view);
        expect(host.querySelector('h3')?.textContent).toBe('Cells with no sheet (1)');
        expect(host.querySelector('li')?.textContent).toBe('Row 2, column 2');
        expect(host.textContent).toContain('the archive has no sheet for them');
    });

    it('badPath_aFullGridSaysNothing @S-A-BAD-FIX-TILES-STATE', () => {
        const view = tilesView({ rows: 1, cols: 2 });

        expect(emptyCells(view)).toEqual([]);
        expect(shown(view).querySelector('section')).toBeNull();
    });

    it('aLargeGapNamesOnlyTheFirstCellsAndCountsThemAll', () => {
        const host = shown({ rows: 10, cols: 10, sheets: [] });

        expect(host.querySelectorAll('li')).toHaveLength(EMPTY_CELLS_NAMED_MAX);
        expect(host.querySelector('h3')?.textContent).toBe('Cells with no sheet (100)');
    });
});
