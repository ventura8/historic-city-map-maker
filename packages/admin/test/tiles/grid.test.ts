/** M20 §19.17: the tile wizard's grid size and the layout by file number (the Borroczyn atlas 1846: 11 columns by 10 rows). */
import { LAYOUT_SHEETS_MAX } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import type { DraftSheet } from '../../src/tiles/draft.js';
import { canResize, columnsHint, numberedRun, numberOf, reflowColsOf, reflowed } from '../../src/tiles/grid.js';

function sheet(index: number, name: string, more: Partial<DraftSheet> = {}): DraftSheet {
    return { index, name, row: 0, col: index, turn: 0, flip: false, out: null, source: 'order', width: 300, height: 200, ...more };
}

/** Pages 1..n of an atlas in a 20-column grid, as the pipeline guessed it. */
function atlas(count: number): DraftSheet[] {
    return Array.from({ length: count }, (_, index) =>
        sheet(index, `Borroczyn/${String(index + 1).padStart(3, '0')}.jpg`, { row: Math.floor(index / 20), col: index % 20 }),
    );
}

describe('the grid size', () => {
    it('happyPath_aRowOrColumnMoreAndAnEmptyLastOneTakenAway @S-A-HAPPY-TILE-WIZARD-GRID-SIZE', () => {
        const sheets = [sheet(0, 'a.jpg'), sheet(1, 'b.jpg', { out: 'blank', col: 7 })];
        expect(canResize(sheets, { rows: 2, cols: 2 })).toBe(true);
        expect(canResize(sheets, { rows: 1, cols: 1 })).toBe(true);
    });

    it('badPath_aLineWithASheetOrAGridPastTheLimitIsRefused @S-A-BAD-TILE-WIZARD-GRID-SIZE', () => {
        const sheets = [sheet(0, 'a.jpg'), sheet(1, 'b.jpg')];
        expect(canResize(sheets, { rows: 1, cols: 1 })).toBe(false);
        expect(canResize(sheets, { rows: 0, cols: 2 })).toBe(false);
        expect(canResize(sheets, { rows: 1, cols: 0 })).toBe(false);
        expect(canResize(sheets, { rows: 2, cols: LAYOUT_SHEETS_MAX })).toBe(false);
    });
});

describe('the layout by file number', () => {
    it('happyPath_numberedPagesGoRowByRowInTheColumnsTheOwnerGives @S-A-HAPPY-TILE-WIZARD-GRID-SIZE', () => {
        const pages = atlas(99).map((page, index) => (index === 40 ? { ...page, out: 'no-seam' as const } : page));
        const laid = reflowed(pages, 11);
        expect(laid?.grid).toEqual({ rows: 9, cols: 11 });
        expect(laid?.sheets[10]).toMatchObject({ row: 0, col: 10, source: 'owner', out: null });
        expect(laid?.sheets[11]).toMatchObject({ row: 1, col: 0 });
        expect(laid?.sheets[40]).toMatchObject({ row: 3, col: 7, out: null });
    });

    it('happyPath_theOwnersAndBlankSheetsKeepTheirPlace', () => {
        const pages = [...atlas(3), sheet(3, 'Borroczyn/titlu.jpg', { out: 'no-join' }), sheet(4, '004.jpg', { out: 'not-part' })];
        const laid = reflowed(pages, 2);
        expect(laid?.sheets[3]).toBe(pages[3]);
        expect(laid?.sheets[4]).toBe(pages[4]);
        expect(laid?.grid).toEqual({ rows: 2, cols: 2 });
    });

    it('badPath_namesNotNumberedOrABadCountLayNothingOut @S-A-BAD-TILE-WIZARD-GRID-SIZE', () => {
        expect(reflowed([sheet(0, 'r1c1.jpg'), sheet(1, 'r1c2.jpg')], 2)).toBeNull();
        expect(reflowed([sheet(0, '1.jpg'), sheet(1, '1.png')], 2)).toBeNull();
        expect(reflowed([sheet(0, '0.jpg'), sheet(1, '1.jpg')], 2)).toBeNull();
        expect(reflowed([sheet(0, '1.jpg')], 2)).toBeNull();
        expect(reflowed(atlas(4), 0)).toBeNull();
        expect(reflowed(atlas(4), 1.5)).toBeNull();
        expect(reflowed([sheet(0, '1.jpg'), sheet(1, `${String(LAYOUT_SHEETS_MAX)}.jpg`)], 3)).toBeNull();
        expect(reflowed([sheet(0, '1.jpg'), sheet(1, `${String(LAYOUT_SHEETS_MAX + 1)}.jpg`)], 1)).toBeNull();
    });

    it('numberOf_readsTheOneNumberOfTheFileName', () => {
        expect(numberOf('Atlas 1846/pagina 07.jpg')).toBe(7);
        expect(numberOf('12')).toBe(12);
        expect(numberOf('r1c2.jpg')).toBeNull();
        expect(numberOf('titlu.jpg')).toBeNull();
        expect(numberOf('')).toBeNull();
    });

    it('columnsHint_readsTheColumnsANameStates', () => {
        expect(columnsHint(['Borroczyn 11x10/001.jpg'])).toBe(11);
        expect(columnsHint(['001.jpg', 'grila 11 coloane/002.jpg'])).toBe(11);
        expect(columnsHint(['8 cols/1.jpg'])).toBe(8);
        expect(columnsHint(['001.jpg', '0x3.jpg'])).toBeNull();
        expect(columnsHint(['001.jpg'])).toBeNull();
    });

    it('reflowColsOf_offersTheNamesColumnsElseTheGrids', () => {
        expect(reflowColsOf(atlas(4), { rows: 1, cols: 20 })).toBe(20);
        const named = atlas(4).map((page) => ({ ...page, name: `11x10/${page.name}` }));
        expect(reflowColsOf(named, { rows: 1, cols: 20 })).toBe(11);
        expect(reflowColsOf([sheet(0, 'r1c1.jpg'), sheet(1, 'r1c2.jpg')], { rows: 1, cols: 2 })).toBeNull();
    });
});

describe('the run of numbers', () => {
    it('numberedRun_isEveryMovableSheetsOwnNumber', () => {
        expect(numberedRun(atlas(3))).toEqual(
            new Map([
                [0, 1],
                [1, 2],
                [2, 3],
            ]),
        );
    });
});
