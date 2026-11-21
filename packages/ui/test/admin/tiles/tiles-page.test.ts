/**
 * `<hcm-tiles-page>` and its steps (`docs/research/M20-import-local.md` §19.11): the grid with its keyboard and drag, the weak seam with
 * its clicks and keys, the preview with its meter, the hand-off, and the page's other states. Axe-clean.
 */
import { axeViolations } from '@hcm/test-support/axe';
import { html } from 'lit';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { AREA_ELEMENTS } from '../../../src/admin/areas/help.js';
import type { TilesViewState } from '../../../src/admin/tiles/tiles-port.js';
import { adminState, cleanup, deep, deepAll, deepText, defineAll, FakeAdminApp, mount, updated } from '../shell/fake-app.js';
import { tilesView } from './fixtures.js';
import { button, key, page, settled } from './harness.js';

describe('<hcm-tiles-page>: step 1, the order @S-A-HAPPY-TILE-WIZARD-ORDER', () => {
    beforeAll(() => {
        defineAll();
    });

    afterEach(() => {
        cleanup();
    });

    it('happyPath_theGridNamesEverySheetAndIsAccessible', async () => {
        const { host } = await page(tilesView());
        await settled(host);
        const cells = deepAll(host, '[role="gridcell"]').map((cell) => cell.getAttribute('aria-label'));
        expect(cells).toEqual([
            'r1c1.jpg, row 1, column 1, by its name',
            'r1c2.jpg, row 1, column 2, turned 90°, mirrored, by its seams',
            'r2c1.jpg, row 2, column 1, by order',
            'Empty cell, row 2, column 2',
        ]);
        expect(deepText(host)).toMatch(/blank\.jpg\s*: blank page/);
        expect(await axeViolations(host)).toEqual([]);
    });

    it('happyPath_theKeysMoveTurnMirrorAndTakeOut @S-A-HAPPY-TILE-WIZARD-KEYBOARD', async () => {
        const { host, area } = await page(tilesView());
        await settled(host);
        const first = deep(host, '[role="gridcell"][tabindex="0"]');
        for (const [name, shift] of [
            ['ArrowRight', false],
            ['ArrowDown', true],
            ['r', false],
            ['F', false],
            ['x', false],
            ['q', false],
        ] as const) {
            key(first, name, shift);
        }
        expect(area.calls.filter((call) => !call.startsWith('open'))).toEqual(['select 0 1', 'shift 1 0', 'rotate', 'flip', 'takeOut']);
    });

    it('happyPath_aDragDropsTheSheetOnTheCellUnderThePointer', async () => {
        const { host, area } = await page(tilesView());
        await settled(host);
        const [from, , , to] = deepAll(host, '[role="gridcell"]');
        if (from === undefined || to === undefined) {
            throw new Error('no cells');
        }
        from.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
        const box = to.getBoundingClientRect();
        const point = { clientX: box.left + box.width / 2, clientY: box.top + box.height / 2, bubbles: true, composed: true };
        to.dispatchEvent(new PointerEvent('pointerup', point));
        from.click();
        button(host, 'Put blank.jpg back').click();
        button(host, 'Turn').click();
        expect(area.calls.filter((call) => !call.startsWith('open'))).toEqual(['place 0 1 1', 'select 0 0', 'putBack 3', 'rotate']);
    });

    it('badPath_aPointerLiftedOutsideTheGridMovesNothing', async () => {
        const { host, area } = await page(tilesView());
        await settled(host);
        const grid = deep(host, '[role="grid"]');
        grid.dispatchEvent(new PointerEvent('pointerup', { clientX: -50, clientY: -50, bubbles: true, composed: true }));
        expect(area.named('place')).toEqual([]);
    });

    it('happyPath_NextGoesToTheSeams', async () => {
        const { host, area } = await page(tilesView());
        button(host, 'Next').click();
        expect(area.named('goTo')).toEqual(['goTo "seams"']);
    });
});

describe('<hcm-tiles-page>: step 2, the seams @S-A-HAPPY-TILE-WIZARD-SEAM', () => {
    beforeAll(() => {
        defineAll();
    });

    afterEach(() => {
        cleanup();
    });

    it('happyPath_theStripsShowTheGuessAndAClickPicksAPoint', async () => {
        const { host, area } = await page(tilesView({ step: 'seams' }));
        await settled(host);
        expect(deepText(host)).toContain('Seam 1 of 1: r1c1.jpg and r1c2.jpg');
        expect(deepAll(host, '.dot.guess')).toHaveLength(2);
        const strip = deep(host, '.strip[data-side="b"]');
        const box = strip.getBoundingClientRect();
        strip.dispatchEvent(
            new MouseEvent('click', {
                clientX: box.left + box.width / 2,
                clientY: box.top + box.height / 2,
                bubbles: true,
                composed: true,
            }),
        );
        const pair = deep(host, '.pair');
        key(pair, 'Enter');
        key(pair, 'n');
        key(pair, 'z');
        button(host, 'Accept the guess').click();
        expect(area.named('pick')[0]).toMatch(/^pick "b" \[3\d\d,1[45]\d\d\]$/);
        expect(area.calls.filter((call) => !call.startsWith('open') && !call.startsWith('pick'))).toEqual([
            'acceptSeam',
            'nextSeam',
            'acceptSeam',
        ]);
        expect(await axeViolations(host)).toEqual([]);
    });

    it('happyPath_anAnsweredSeamSaysSoAndShowsThePickedPoint', async () => {
        const seam = { ...tilesView().seams[0], picked: { a: [10, 20], b: [30, 40] }, answered: true } as TilesViewState['seams'][number];
        const { host } = await page(tilesView({ step: 'seams', seams: [seam] }));
        await settled(host);
        expect(deepText(host)).toContain('Answered');
        expect(deepAll(host, '.dot')).toHaveLength(4);
    });

    it('badPath_noWeakSeamSaysEveryNeighbourAgrees', async () => {
        const { host } = await page(tilesView({ step: 'seams', seams: [] }));
        await settled(host);
        expect(deepText(host)).toContain('No doubtful seams');
    });

    it('badPath_aSeamWithoutStripsOrGuessOffersNoAccept', async () => {
        const seam = { ...tilesView().seams[0], strips: null, suggestion: null } as TilesViewState['seams'][number];
        const { host } = await page(tilesView({ step: 'seams', seams: [seam], seamsSprite: null }));
        await settled(host);
        expect(deepAll(host, '.strip')).toHaveLength(0);
        expect(button(host, 'Accept the guess').disabled).toBe(true);
    });
});

describe('<hcm-tiles-page>: step 3, the preview @S-A-HAPPY-TILE-WIZARD-PREVIEW', () => {
    beforeAll(() => {
        defineAll();
    });

    afterEach(() => {
        cleanup();
    });

    it('happyPath_theMeterSaysEachFigureAndThePreviewIsAskedFor', async () => {
        const { host, area } = await page(tilesView({ step: 'preview' }));
        await settled(host);
        const meters = deepAll(host, '[role="meter"]').map((meter) => meter.getAttribute('aria-valuetext'));
        expect(meters).toEqual([
            'Sheets placed: 75 %: needs a look',
            'Seams agree: 0.31: needs a look',
            'Seam error: 6.5 px: needs a look',
        ]);
        expect(deepText(host)).toContain('The layout: Worth a check');
        expect(deep(host, 'img').getAttribute('alt')).toBe('The joined picture');
        button(host, 'Make the real preview').click();
        expect(area.named('preview')).toEqual(['preview']);
        expect(await axeViolations(host)).toEqual([]);
    });

    it('happyPath_aGoodLayoutSaysSo', async () => {
        const quality = { placedPct: 100, seamMedian: 0.8, seamRmsPx: 1.2, verdict: 'good' as const };
        const { host } = await page(tilesView({ step: 'preview', quality }));
        await settled(host);
        expect(deepAll(host, '[role="meter"]').map((meter) => meter.getAttribute('aria-valuetext'))).toEqual([
            'Sheets placed: 100 %: good',
            'Seams agree: 0.80: good',
            'Seam error: 1.2 px: good',
        ]);
    });

    it('badPath_aPoorLayoutWarnsAndAPreviewUnderWayHidesThePicture @S-A-BAD-TILE-WIZARD-PREVIEW-POOR', async () => {
        const quality = { placedPct: 20, seamMedian: -0.1, seamRmsPx: 40, verdict: 'poor' as const };
        const { host } = await page(tilesView({ step: 'preview', quality, previewing: true }));
        await settled(host);
        expect(deepText(host)).toContain('The layout is still poor');
        expect(deepText(host)).toContain('The app is joining the sheets');
        expect(deepAll(host, 'img')).toHaveLength(0);
        expect(button(host, 'Make the real preview').disabled).toBe(true);
    });

    it('badPath_noQualityShowsNoMeter', async () => {
        const { host } = await page(tilesView({ step: 'preview', quality: null, stitched: null, thumbs: null }));
        await settled(host);
        expect(deepAll(host, '[role="meter"]')).toHaveLength(0);
    });
});

describe('<hcm-tiles-page>: step 4 and the states @S-A-HAPPY-TILE-WIZARD-HANDOFF', () => {
    beforeAll(() => {
        defineAll();
    });

    afterEach(() => {
        cleanup();
    });

    it('happyPath_theHandOffSendsTheSeriesOnAndThenLinksTheGeoreferencer', async () => {
        const { host, area } = await page(tilesView({ step: 'points' }));
        button(host, 'Place it on the map').click();
        expect(area.named('handOff')).toEqual(['handOff']);
        area.set({ handedOff: true });
        await updated(host);
        expect(deepText(host)).toContain('Sent on');
        expect(deep(host, 'a[href="#/georef/ar-mw993zri-s-4054e55659a3"]')).toBeTruthy();
        button(host, 'Back').click();
        expect(area.named('goTo')).toEqual([]);
    });

    it('badPath_everySheetOutKeepsTheHandOffOff @S-A-BAD-TILE-WIZARD-ALL-OUT', async () => {
        const sheets = tilesView().sheets.map((sheet) => ({ ...sheet, out: 'not-part' as const }));
        const { host } = await page(tilesView({ step: 'points', sheets }));
        expect(deepText(host)).toContain('Keep at least one sheet in the grid.');
        expect(button(host, 'Place it on the map').disabled).toBe(true);
    });

    it('badPath_aStaleRefusalIsShown @S-A-BAD-TILE-WIZARD-STALE-REVISION', async () => {
        const { host } = await page(tilesView({ refusal: { key: 'apiError.imagery.layoutStale' } }));
        expect(deepText(host)).toContain('laid the tiles out again');
    });

    it('happyPath_aNewStepMovesTheFocusToItsHeading', async () => {
        const { host, area } = await page(tilesView());
        button(host, 'Seams').click();
        area.set({ step: 'seams' });
        await updated(host);
        expect(host.shadowRoot?.activeElement?.tagName).toBe('H2');
        expect(area.named('goTo')).toEqual(['goTo "seams"']);
    });

    it.each([
        ['loading', 'Reading the tile layout'],
        ['notFound', 'No series at this address.'],
        ['moved', 'no longer waits for its tiles'],
    ] as const)('badPath_the%sStateSaysSo', async (status, words) => {
        const { host } = await page(tilesView({ status }));
        expect(deepText(host)).toContain(words);
    });

    it('badPath_aLayoutThatCannotBeReadOffersTryAgain', async () => {
        const { host, area } = await page(tilesView({ status: 'error' }));
        expect(deepText(host)).toContain('could not be read');
        button(host, 'Try again').click();
        expect(area.named('retry')).toEqual(['retry']);
    });

    it('happyPath_aPhoneShowsTheSameWizard', async () => {
        const { host } = await page(tilesView(), 360);
        await settled(host);
        expect(deepAll(host, '[role="gridcell"]')).toHaveLength(4);
        expect(await axeViolations(host)).toEqual([]);
    });
});

describe('the steps on their own', () => {
    afterEach(() => {
        cleanup();
    });

    it('badPath_elementsWithoutAViewOrIntentsShowNothingAndIgnoreKeys', async () => {
        AREA_ELEMENTS.define(customElements);
        const view = tilesView();
        const bare = await mount<HTMLElement>(
            html`<div>
                <hcm-tile-grid></hcm-tile-grid><hcm-tile-preview></hcm-tile-preview>
                <hcm-tile-grid locale="en" .view=${view}></hcm-tile-grid
                ><hcm-seam-pair locale="en" .view=${{ ...view, step: 'seams' }}></hcm-seam-pair>
            </div>`,
        );
        await settled(bare);
        const grids = deepAll(bare, 'hcm-tile-grid');
        expect(grids[0]?.shadowRoot?.textContent.trim()).toBe('');
        const cell = deep(grids[1] ?? bare, '[role="gridcell"]');
        key(cell, 'ArrowRight');
        key(cell, 'r');
        cell.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', ctrlKey: true, bubbles: true, composed: true }));
        const pair = deep(bare, '.pair');
        pair.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', altKey: true, bubbles: true, composed: true }));
        for (const label of ['Turn', 'Mirror', 'Not part of this map', 'Accept the guess', 'Next seam', 'Put blank.jpg back']) {
            button(bare, label).click();
        }
        expect(deepAll(bare, '[role="gridcell"]')).toHaveLength(4);
    });

    it('badPath_aPageWithoutAStoreShowsNothing', async () => {
        AREA_ELEMENTS.define(customElements);
        const app = new FakeAdminApp(adminState({ route: { id: 'help', params: ['x', 'tiles'] } }));
        const host = await mount<HTMLElement>(html`<hcm-tiles-page .app=${app} .state=${app.state}></hcm-tiles-page>`);
        expect(host.shadowRoot?.textContent.trim()).toBe('');
    });

    it('happyPath_BackGoesToTheStepBefore', async () => {
        const { host, area } = await page(tilesView({ step: 'preview' }));
        button(host, 'Back').click();
        expect(area.named('goTo')).toEqual(['goTo "seams"']);
    });
});
