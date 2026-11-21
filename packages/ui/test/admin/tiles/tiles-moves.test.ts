/**
 * The tile-import wizard without a drag or a mouse (`docs/research/M20-import-local.md` §19.11): Move and a tap on the cell, what the
 * live region says after each change, a touch that never starts a drag (the grid pans), and the seam's strips picked with the
 * keyboard's cross, a missing seam with no guess included. Axe-clean.
 */
import { axeViolations } from '@hcm/test-support/axe';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { centreOf, nudged } from '../../../src/admin/tiles/seam-pair.js';
import type { TilesViewState } from '../../../src/admin/tiles/tiles-port.js';
import { cleanup, deep, deepAll, deepText, defineAll } from '../shell/fake-app.js';
import { SEAM, tilesView } from './fixtures.js';
import { button, key, page, settled } from './harness.js';

function said(host: HTMLElement, element: string): string {
    return deepAll(deep(host, element), '[role="status"]')
        .map((status) => status.textContent.trim())
        .filter((text) => text !== '')
        .join('|');
}

function cell(host: HTMLElement, at: number): HTMLElement {
    const found = deepAll(host, '[role="gridcell"]')[at];
    if (found === undefined) {
        throw new Error(`no cell ${String(at)}`);
    }
    return found;
}

function moved(calls: readonly string[]): string[] {
    return calls.filter((call) => !call.startsWith('open'));
}

describe('<hcm-tile-grid>: one pointer, no drag @S-A-HAPPY-TILE-WIZARD-MOVE', () => {
    beforeAll(() => {
        defineAll();
    });

    afterEach(() => {
        cleanup();
    });

    it('happyPath_MoveThenATapPutsTheChosenSheetThereAndSaysSo', async () => {
        const { host, area } = await page(tilesView(), 400);
        await settled(host);
        button(host, 'Move').click();
        await settled(host);
        expect(said(host, 'hcm-tile-grid')).toContain('Tap the cell to move r1c1.jpg to.');
        cell(host, 3).click();
        await settled(host);
        expect(moved(area.calls)).toEqual(['place 0 1 1']);
        expect(said(host, 'hcm-tile-grid')).toContain('r1c1.jpg: moved to row 2, column 2.');
        cell(host, 1).click();
        expect(moved(area.calls)).toEqual(['place 0 1 1', 'select 0 1']);
        expect(await axeViolations(host)).toEqual([]);
    });

    it('happyPath_MovePressedTwiceIsOffAgain', async () => {
        const { host, area } = await page(tilesView());
        await settled(host);
        button(host, 'Move').click();
        await settled(host);
        button(host, 'Move').click();
        await settled(host);
        cell(host, 3).click();
        expect(moved(area.calls)).toEqual(['select 1 1']);
        expect(said(host, 'hcm-tile-grid')).toBe('');
    });

    it('happyPath_eachKeySaysWhatItDid @S-A-HAPPY-TILE-WIZARD-KEYBOARD', async () => {
        const { host } = await page(tilesView());
        await settled(host);
        const first = deep(host, '[role="gridcell"][tabindex="0"]');
        const heard: string[] = [];
        for (const [name, shift] of [
            ['r', false],
            ['f', false],
            ['ArrowRight', true],
            ['ArrowLeft', true],
            ['x', false],
        ] as const) {
            key(first, name, shift);
            await settled(host);
            heard.push(said(host, 'hcm-tile-grid'));
        }
        expect(heard).toEqual([
            'r1c1.jpg: turned a quarter clockwise.',
            'r1c1.jpg: mirrored.',
            'r1c1.jpg: moved to row 1, column 2.',
            'r1c1.jpg: moved to row 1, column 1.',
            'r1c1.jpg: taken out of the map.',
        ]);
        button(host, 'Mirror').click();
        button(host, 'Not part of this map').click();
        await settled(host);
        expect(said(host, 'hcm-tile-grid')).toBe('r1c1.jpg: taken out of the map.');
    });

    it('happyPath_theFocusFollowsTheChosenCellOnceTheStoreHasMovedIt', async () => {
        const { host, area } = await page(tilesView());
        await settled(host);
        key(deep(host, '[role="gridcell"][tabindex="0"]'), 'ArrowRight', true);
        await settled(host);
        area.set({ selected: { row: 0, col: 1 } });
        await settled(host);
        const grid = deep(host, 'hcm-tile-grid');
        expect(grid.shadowRoot?.activeElement?.getAttribute('data-col')).toBe('1');
        area.set({ revision: 3 });
        await settled(host);
        expect(grid.shadowRoot?.activeElement?.getAttribute('data-col')).toBe('1');
    });

    it('badPath_anEmptyCellOffersNoMoveAndSaysThereIsNoSheet', async () => {
        const { host, area } = await page(tilesView({ selected: { row: 1, col: 1 } }));
        await settled(host);
        expect(button(host, 'Move').disabled).toBe(true);
        deepAll(host, 'hcm-button')
            .find((item) => item.textContent.includes('Move'))
            ?.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
        cell(host, 0).click();
        expect(moved(area.calls)).toEqual(['select 0 0']);
        area.calls.length = 0;
        key(deep(host, '[role="gridcell"][tabindex="0"]'), 'r');
        await settled(host);
        expect(said(host, 'hcm-tile-grid')).toBe('No sheet in this cell.');
        expect(moved(area.calls)).toEqual(['rotate']);
    });

    it('badPath_aTouchNeverStartsADragSoTheGridPans', async () => {
        const { host, area } = await page(tilesView(), 360);
        await settled(host);
        expect(getComputedStyle(cell(host, 0)).touchAction).toBe('pan-x pan-y');
        cell(host, 0).dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true, composed: true }));
        const box = cell(host, 3).getBoundingClientRect();
        const point = { clientX: box.left + 5, clientY: box.top + 5, pointerType: 'touch', bubbles: true, composed: true };
        cell(host, 3).dispatchEvent(new PointerEvent('pointerup', point));
        expect(area.named('place')).toEqual([]);
    });

    it('badPath_aMouseLetGoOnItsOwnCellIsAClickNotADrop', async () => {
        const { host, area } = await page(tilesView());
        await settled(host);
        const box = cell(host, 0).getBoundingClientRect();
        const point = { clientX: box.left + 5, clientY: box.top + 5, bubbles: true, composed: true };
        cell(host, 0).dispatchEvent(new PointerEvent('pointerdown', { ...point, pointerType: 'mouse' }));
        cell(host, 0).dispatchEvent(new PointerEvent('pointerup', { ...point, pointerType: 'mouse' }));
        expect(area.named('place')).toEqual([]);
    });
});

describe('<hcm-seam-pair>: the strips with the keyboard @S-A-HAPPY-TILE-WIZARD-SEAM-KEYS', () => {
    beforeAll(() => {
        defineAll();
    });

    afterEach(() => {
        cleanup();
    });

    it('happyPath_theCrossKeepsInsideTheStrip', () => {
        const sheet = [2250, 0, 750, 3000] as const;
        expect(centreOf(sheet)).toEqual([2625, 1500]);
        expect(nudged([2900, 1500], sheet, [1, 0], false)).toEqual([2915, 1500]);
        expect(nudged([2900, 1500], sheet, [1, 0], true)).toEqual([2975, 1500]);
        expect(nudged([2990, 10], sheet, [1, -1], true)).toEqual([3000, 0]);
        expect(nudged([2260, 2990], sheet, [-1, 1], true)).toEqual([2250, 3000]);
    });

    it('happyPath_theArrowsMoveTheCrossFromTheGuessAndSpacePicksIt', async () => {
        const { host, area } = await page(tilesView({ step: 'seams' }));
        await settled(host);
        const strip = deep(host, '.strip[data-side="a"]');
        expect(strip.getAttribute('tabindex')).toBe('0');
        key(strip, 'ArrowRight');
        await settled(host);
        expect(said(host, 'hcm-seam-pair')).toContain('The cross on r1c1.jpg: x 2915, y 1500.');
        expect(deepAll(host, '.dot.cross')).toHaveLength(1);
        key(strip, 'ArrowDown', true);
        key(strip, ' ');
        await settled(host);
        expect(area.named('pick')).toEqual(['pick "a" [2915,1800]']);
        expect(said(host, 'hcm-seam-pair')).toContain('Point picked on r1c1.jpg: x 2915, y 1800.');
        key(deep(host, '.strip[data-side="b"]'), 'Enter');
        key(strip, 'q');
        expect(area.named('pick')).toEqual(['pick "a" [2915,1800]', 'pick "b" [100,1500]']);
        expect(area.named('acceptSeam')).toEqual([]);
        expect(await axeViolations(host)).toEqual([]);
    });

    it('badPath_aMissingSeamHasNoGuessSoTheCrossStartsInTheMiddle', async () => {
        const missing = { ...SEAM, suggestion: null };
        const { host, area } = await page(tilesView({ step: 'seams', seams: [missing] }));
        await settled(host);
        expect(deepText(host)).toContain('The app did not find this seam');
        expect(button(host, 'Accept the guess').disabled).toBe(true);
        key(deep(host, '.strip[data-side="b"]'), ' ');
        expect(area.named('pick')).toEqual(['pick "b" [375,1500]']);
    });

    it('badPath_anotherSeamStartsTheCrossAgain', async () => {
        const other: TilesViewState['seams'][number] = { ...SEAM, a: 2, b: 3, nameA: 'r2c1.jpg', nameB: 'r2c2.jpg' };
        const { host, area } = await page(tilesView({ step: 'seams', seams: [SEAM, other] }));
        await settled(host);
        key(deep(host, '.strip[data-side="a"]'), 'ArrowUp');
        await settled(host);
        expect(deepAll(host, '.dot.cross')).toHaveLength(1);
        area.set({ seam: 1 });
        await settled(host);
        expect(deepAll(host, '.dot.cross')).toHaveLength(0);
        expect(said(host, 'hcm-seam-pair')).toBe('');
    });
});
