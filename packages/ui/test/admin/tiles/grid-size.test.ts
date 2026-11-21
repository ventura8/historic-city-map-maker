/** M20 §19.17: the tile wizard's grid size, a row or a column more or fewer, and the layout by file number. */
import { LAYOUT_SHEETS_MAX } from '@hcm/shared';
import { render } from 'lit';
import { describe, expect, it, vi } from 'vitest';

import { gridMoves, gridSizeSection } from '../../../src/admin/tiles/grid-size.js';
import type { TilesIntentsPort } from '../../../src/admin/tiles/tiles-port.js';
import { tilesView } from './fixtures.js';

function shown(view: Parameters<typeof gridSizeSection>[1], intents: TilesIntentsPort | null = null): HTMLElement {
    const host = document.createElement('div');
    document.body.append(host);
    render(gridSizeSection('en', view, intents), host);
    return host;
}

function buttonNamed(host: HTMLElement, name: string): HTMLElement {
    const found = [...host.querySelectorAll<HTMLElement>('hcm-button')].find((button) => button.textContent.trim() === name);
    if (found === undefined) {
        throw new Error(`no button ${name}`);
    }
    return found;
}

function intentsSpy() {
    return { resize: vi.fn(), reflow: vi.fn() } as unknown as TilesIntentsPort & {
        resize: ReturnType<typeof vi.fn>;
        reflow: ReturnType<typeof vi.fn>;
    };
}

describe('the grid size', () => {
    it('happyPath_theOwnerAddsARowAndAColumn @S-A-HAPPY-TILE-WIZARD-GRID-SIZE', () => {
        const intents = intentsSpy();
        const host = shown(tilesView(), intents);
        expect(host.querySelector('h3')?.textContent).toBe('Grid size: 2 rows, 2 columns');
        buttonNamed(host, 'Add a column').click();
        buttonNamed(host, 'Add a row').click();
        expect(intents.resize.mock.calls).toEqual([
            [0, 1],
            [1, 0],
        ]);
        expect(host.querySelector('.reflow')).toBeNull();
    });

    it('badPath_aLastLineWithASheetAndAGridAtTheLimitAreOff @S-A-BAD-TILE-WIZARD-GRID-SIZE', () => {
        expect(gridMoves(tilesView())).toEqual({ addRow: true, addCol: true, dropRow: false, dropCol: false });
        expect(gridMoves(tilesView({ rows: 3, cols: 3 }))).toMatchObject({ dropRow: true, dropCol: true });
        expect(gridMoves(tilesView({ rows: 1, cols: LAYOUT_SHEETS_MAX, sheets: [] }))).toEqual({
            addRow: false,
            addCol: false,
            dropRow: false,
            dropCol: true,
        });
        const host = shown(tilesView());
        expect(buttonNamed(host, 'Remove the last row').hasAttribute('disabled')).toBe(true);
        buttonNamed(host, 'Add a row').click();
    });

    it('happyPath_numberedFilesAreLaidOutInTheColumnsTyped', () => {
        const intents = intentsSpy();
        const host = shown(tilesView({ reflowCols: 11 }), intents);
        const input = host.querySelector('input');
        expect(input?.valueAsNumber).toBe(11);
        if (input !== null) {
            input.value = '12';
        }
        buttonNamed(host, 'Lay out by file number').click();
        expect(intents.reflow.mock.calls).toEqual([[12]]);
        expect(host.textContent).toContain('Sheets in one row');
    });
});
