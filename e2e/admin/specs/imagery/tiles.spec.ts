import { translateAdminContent, translateApiError } from '@hcm/shared';
import type { Locator, Page } from '@playwright/test';

import { expectStateSound } from '../../../support/state-check.js';
import { adminVisit } from '../../../tour/states.js';
import type { ContentWorld } from '../../support/content.js';
import { expect, test } from '../../support/content-test.js';
import { FUNCTIONS_TIMEOUT_MS } from '../../support/emulators.js';
import { answerPreview, GOOD, POOR, SERIES, seedWaitingSeries, seriesVersion, tilesText } from './tiles-world.js';

/**
 * The tile-import wizard (docs/research/M20-import-local.md §19.11; behaviour A141), in a city of the admin's own (the content world: no
 * lock): an archive series parked with `layout-check` opens from its version's page; the owner moves, turns and takes out sheets
 * with the pointer and the keyboard, accepts a weak seam's guess, asks for the real preview (the worker's answer is what it leaves in
 * Firestore and the bucket), and sends the series on to the georeferencer. `imagery.saveLayout` and `imagery.acceptLayout` run in
 * the Functions emulator; a stale layout, every sheet out and a poor layout each say so.
 */

type Lang = 'ro' | 'en';

function grid(page: Page, lang: Lang): Locator {
    return page.getByRole('grid', { name: tilesText(lang, 'adminTiles.gridLabel') });
}

/** The cell of a sheet, by the sheet's name in its label. */
function sheetCell(page: Page, lang: Lang, name: string): Locator {
    return grid(page, lang).getByRole('gridcell', { name: new RegExp(`^${name.replace('.', '\\.')},`) });
}

function step(
    page: Page,
    lang: Lang,
    key: 'adminTiles.step.order' | 'adminTiles.step.seams' | 'adminTiles.step.preview' | 'adminTiles.step.points',
) {
    return page
        .getByRole('navigation', { name: tilesText(lang, 'adminTiles.stepsLabel') })
        .getByRole('button', { name: tilesText(lang, key) });
}

/** A live region that says `text`. */
function said(page: Page, text: string): Locator {
    return page.getByRole('status').filter({ hasText: text });
}

/** Opens the series' page and, from it, the wizard. */
async function openWizard(page: Page, lang: Lang, content: ContentWorld): Promise<void> {
    await page.goto(content.address(lang, `imagery/version/${SERIES}`, { map: false }));
    await page.getByRole('link', { name: translateAdminContent(lang, 'adminContent.imagery.openTiles') }).click();
    await expect(page).toHaveURL(new RegExp(`#/(c/[^/]+/)?help/${SERIES}/tiles$`));
    await expect(grid(page, lang)).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });
}

test(
    'The owner arranges the tiles with the pointer and the keyboard',
    { tag: ['@S-A-HAPPY-TILE-WIZARD-ORDER', '@S-A-HAPPY-TILE-WIZARD-KEYBOARD'] },
    async ({ page, lang, content }) => {
        await seedWaitingSeries(content);
        await openWizard(page, lang, content);
        await expect(sheetCell(page, lang, 'atlas/r1c1.jpg')).toHaveAttribute('aria-selected', 'true');
        await expect(page.getByRole('button', { name: tilesText(lang, 'adminTiles.putBack', { name: 'atlas/blank.jpg' }) })).toBeVisible();
        await expectStateSound(page, adminVisit('tiles.order', lang));

        // The keyboard: Shift and the arrows move the chosen sheet, R turns it, F mirrors it.
        await sheetCell(page, lang, 'atlas/r1c1.jpg').focus();
        await page.keyboard.press('Shift+ArrowRight');
        await page.keyboard.press('r');
        await page.keyboard.press('f');
        const moved = sheetCell(page, lang, 'atlas/r1c1.jpg');
        await expect(moved).toHaveAttribute(
            'aria-label',
            [
                tilesText(lang, 'adminTiles.cellSheet', { name: 'atlas/r1c1.jpg', row: '1', col: '2' }),
                tilesText(lang, 'adminTiles.turned', { turn: '90' }),
                tilesText(lang, 'adminTiles.mirrored'),
                tilesText(lang, 'adminTiles.source.owner'),
            ].join(', '),
        );
        await expect(moved).toBeFocused();

        // The pointer: a sheet dragged onto another cell swaps with the sheet there.
        const from = await sheetCell(page, lang, 'atlas/r2c1.jpg').boundingBox();
        const to = await sheetCell(page, lang, 'atlas/r2c2.jpg').boundingBox();
        expect(from).not.toBeNull();
        expect(to).not.toBeNull();
        await page.mouse.move((from?.x ?? 0) + 20, (from?.y ?? 0) + 20);
        await page.mouse.down();
        await page.mouse.move((to?.x ?? 0) + 20, (to?.y ?? 0) + 20, { steps: 4 });
        await page.mouse.up();
        await expect(sheetCell(page, lang, 'atlas/r2c1.jpg')).toHaveAttribute(
            'aria-label',
            new RegExp(tilesText(lang, 'adminTiles.cellSheet', { name: 'atlas/r2c1.jpg', row: '2', col: '2' }).replace('.', '\\.')),
        );
    },
);

test(
    'The owner answers a weak seam, previews the layout and sends the series on to points',
    { tag: ['@S-A-HAPPY-TILE-WIZARD-SEAM', '@S-A-HAPPY-TILE-WIZARD-PREVIEW', '@S-A-HAPPY-TILE-WIZARD-HANDOFF'] },
    async ({ page, lang, content }) => {
        await seedWaitingSeries(content);
        await openWizard(page, lang, content);
        await step(page, lang, 'adminTiles.step.seams').click();
        const pair = page.getByRole('group', { name: tilesText(lang, 'adminTiles.seamsLabel') });
        await expect(pair.getByRole('application')).toHaveCount(2);
        await expectStateSound(page, adminVisit('tiles.seams', lang));
        await pair.focus();
        await page.keyboard.press('Enter');
        await expect(page.getByRole('status').filter({ hasText: tilesText(lang, 'adminTiles.seamAnswered') })).toBeVisible();

        await page.getByRole('button', { name: tilesText(lang, 'adminTiles.next'), exact: true }).click();
        await expect(page.getByRole('meter')).toHaveCount(3);
        await page.getByRole('button', { name: tilesText(lang, 'adminTiles.makePreview') }).click();
        await expect(page.getByText(tilesText(lang, 'adminTiles.previewing'))).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });
        await expectStateSound(page, adminVisit('tiles.previewing', lang));
        const asked = await seriesVersion(content);
        expect(asked).toMatchObject({ state: 'processing', help: { layoutAnswer: { revision: 2, preview: true } } });
        expect((asked?.['help'] as { layoutAnswer: { seams: unknown[] } }).layoutAnswer.seams).toEqual([
            { a: 1, b: 3, side: 'below', points: { a: [1500, 1990], b: [1497, 42] } },
        ]);

        // The worker places the series again with the owner's layout and waits with the new revision.
        await answerPreview(content, 3, GOOD);
        await expect(
            page.getByText(tilesText(lang, 'adminTiles.verdictIs', { verdict: tilesText(lang, 'adminTiles.verdict.good') })),
        ).toBeVisible({
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        await expect(page.getByRole('img', { name: tilesText(lang, 'adminTiles.stitched') })).toBeVisible();
        await expectStateSound(page, adminVisit('tiles.preview', lang));

        await page.getByRole('button', { name: tilesText(lang, 'adminTiles.next'), exact: true }).click();
        await page.getByRole('button', { name: tilesText(lang, 'adminTiles.handOff') }).click();
        await expect(page.getByText(tilesText(lang, 'adminTiles.handedOff'))).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });
        await expect
            .poll(async () => seriesVersion(content))
            .toMatchObject({ help: { layoutAnswer: { revision: 3, accepted: true, preview: false } } });
        await expectStateSound(page, adminVisit('tiles.handed-off', lang));
        await page.getByRole('link', { name: tilesText(lang, 'adminTiles.openGeoref') }).click();
        await expect(page).toHaveURL(new RegExp(`#/(c/[^/]+/)?georef/${SERIES}$`));
    },
);

test(
    'The owner moves a sheet with Move and a tap, and each change is said',
    { tag: '@S-A-HAPPY-TILE-WIZARD-MOVE' },
    async ({ page, lang, content }) => {
        await seedWaitingSeries(content);
        await openWizard(page, lang, content);
        await expect(sheetCell(page, lang, 'atlas/r1c1.jpg')).toHaveCSS('touch-action', 'pan-x pan-y');
        await sheetCell(page, lang, 'atlas/r1c1.jpg').click();
        await page.getByRole('button', { name: tilesText(lang, 'adminTiles.move'), exact: true }).click();
        await expect(said(page, tilesText(lang, 'adminTiles.movePick', { name: 'atlas/r1c1.jpg' }))).toBeVisible();
        await sheetCell(page, lang, 'atlas/r2c2.jpg').click();
        await expect(said(page, tilesText(lang, 'adminTiles.said.moved', { name: 'atlas/r1c1.jpg', row: '2', col: '2' }))).toBeVisible();
        await expect(sheetCell(page, lang, 'atlas/r1c1.jpg')).toHaveAttribute(
            'aria-label',
            new RegExp(tilesText(lang, 'adminTiles.cellSheet', { name: 'atlas/r1c1.jpg', row: '2', col: '2' }).replace('.', '\\.')),
        );
        await page.getByRole('button', { name: tilesText(lang, 'adminTiles.rotate'), exact: true }).click();
        await expect(said(page, tilesText(lang, 'adminTiles.said.turned', { name: 'atlas/r1c1.jpg' }))).toBeVisible();
    },
);

test(
    'A seam the app did not find is answered with the keyboard on each strip',
    { tag: '@S-A-HAPPY-TILE-WIZARD-SEAM-KEYS' },
    async ({ page, lang, content }) => {
        await seedWaitingSeries(content);
        await openWizard(page, lang, content);
        await step(page, lang, 'adminTiles.step.seams').click();
        const pair = page.getByRole('group', { name: tilesText(lang, 'adminTiles.seamsLabel') });
        await pair.focus();
        await page.keyboard.press('n');
        await expect(page.getByText(tilesText(lang, 'adminTiles.noGuess'))).toBeVisible();
        await expect(page.getByRole('button', { name: tilesText(lang, 'adminTiles.acceptSeam') })).toBeDisabled();
        await pair.getByRole('application', { name: tilesText(lang, 'adminTiles.strip', { name: 'atlas/r2c1.jpg' }) }).focus();
        await page.keyboard.press('ArrowRight');
        await page.keyboard.press('Space');
        await expect(said(page, tilesText(lang, 'adminTiles.pointPicked', { name: 'atlas/r2c1.jpg', x: '2760', y: '1000' }))).toBeVisible();
        await pair.getByRole('application', { name: tilesText(lang, 'adminTiles.strip', { name: 'atlas/r2c2.jpg' }) }).focus();
        await page.keyboard.press('Enter');
        await expect(page.getByRole('status').filter({ hasText: tilesText(lang, 'adminTiles.seamAnswered') })).toBeVisible();
        await expectStateSound(page, adminVisit('tiles.seam-missing', lang));

        await step(page, lang, 'adminTiles.step.preview').click();
        await page.getByRole('button', { name: tilesText(lang, 'adminTiles.makePreview') }).click();
        await expect(page.getByText(tilesText(lang, 'adminTiles.previewing'))).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });
        expect((await seriesVersion(content))?.['help']).toMatchObject({
            layoutAnswer: { seams: [{ a: 2, b: 3, side: 'right', points: { a: [2760, 1000], b: [250, 1000] } }] },
        });
    },
);

test(
    'A seam answered before its sheet is turned is asked again, not sent',
    { tag: '@S-A-BAD-TILE-WIZARD-SEAM-RESET' },
    async ({ page, lang, content }) => {
        await seedWaitingSeries(content);
        await openWizard(page, lang, content);
        await step(page, lang, 'adminTiles.step.seams').click();
        await page.getByRole('group', { name: tilesText(lang, 'adminTiles.seamsLabel') }).focus();
        await page.keyboard.press('Enter');
        await expect(page.getByRole('status').filter({ hasText: tilesText(lang, 'adminTiles.seamAnswered') })).toBeVisible();
        await step(page, lang, 'adminTiles.step.order').click();
        await sheetCell(page, lang, 'atlas/r2c2.jpg').click();
        await page.getByRole('button', { name: tilesText(lang, 'adminTiles.rotate'), exact: true }).click();
        await step(page, lang, 'adminTiles.step.seams').click();
        await expect(page.getByText(tilesText(lang, 'adminTiles.noSeams'))).toBeVisible();
    },
);

test(
    'A series whose tiles wait offers no points on its preview',
    { tag: '@S-A-BAD-TILE-WIZARD-POINTS-FIRST' },
    async ({ page, lang, content }) => {
        await seedWaitingSeries(content);
        await page.goto(content.address(lang, `imagery/version/${SERIES}`, { map: false }));
        await expect(page.getByRole('link', { name: translateAdminContent(lang, 'adminContent.imagery.openTiles') })).toBeVisible({
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        await expect(page.getByRole('link', { name: translateAdminContent(lang, 'adminContent.imagery.openGeoref') })).toHaveCount(0);
    },
);

test(
    'A layout the pipeline wrote again while the owner worked is refused as stale',
    { tag: '@S-A-BAD-TILE-WIZARD-STALE-REVISION' },
    async ({ page, lang, content, consoleErrors }) => {
        await seedWaitingSeries(content);
        await openWizard(page, lang, content);
        await sheetCell(page, lang, 'atlas/r1c1.jpg').focus();
        await page.keyboard.press('r');
        await answerPreview(content, 5, POOR);
        await step(page, lang, 'adminTiles.step.preview').click();
        await page.getByRole('button', { name: tilesText(lang, 'adminTiles.makePreview') }).click();
        await expect(page.getByRole('alert').filter({ hasText: translateApiError(lang, 'apiError.imagery.layoutStale') })).toBeVisible({
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        await expect(page.getByText(tilesText(lang, 'adminTiles.poor'))).toBeVisible();
        expect(await seriesVersion(content)).toMatchObject({ state: 'needs_gcps' });
        await expectStateSound(page, adminVisit('tiles.stale', lang));
        // The refusal itself: the browser logs the callable's failed-precondition.
        await expect.poll(() => consoleErrors.takeMatching(/status of 400 .*imagery-saveLayout/).length).toBe(1);
    },
);

test(
    'Every sheet taken out of the map keeps the hand-off off',
    { tag: '@S-A-BAD-TILE-WIZARD-ALL-OUT' },
    async ({ page, lang, content }) => {
        await seedWaitingSeries(content);
        await openWizard(page, lang, content);
        await sheetCell(page, lang, 'atlas/r1c1.jpg').focus();
        await page.keyboard.press('x');
        for (const move of ['ArrowRight', 'ArrowDown', 'ArrowLeft']) {
            await page.keyboard.press(move);
            await page.keyboard.press('x');
        }
        await expect(grid(page, lang).getByRole('gridcell', { name: /^atlas\// })).toHaveCount(0);
        await step(page, lang, 'adminTiles.step.points').click();
        await expect(page.getByRole('alert').filter({ hasText: tilesText(lang, 'adminTiles.allOut') })).toBeVisible();
        await expect(page.getByRole('button', { name: tilesText(lang, 'adminTiles.handOff') })).toBeDisabled();
        await expectStateSound(page, adminVisit('tiles.all-out', lang));
    },
);

test('A poor layout says so in the meter and an alert', { tag: '@S-A-BAD-TILE-WIZARD-PREVIEW-POOR' }, async ({ page, lang, content }) => {
    await seedWaitingSeries(content, { quality: POOR });
    await openWizard(page, lang, content);
    await step(page, lang, 'adminTiles.step.preview').click();
    await expect(page.getByRole('alert').filter({ hasText: tilesText(lang, 'adminTiles.poor') })).toBeVisible();
    await expect(page.getByRole('meter').first()).toHaveAttribute('aria-valuetext', new RegExp(tilesText(lang, 'adminTiles.meter.needs')));
    await expectStateSound(page, adminVisit('tiles.preview-poor', lang));
});

test(
    'A wrong address and a layout that cannot be read each say so',
    { tag: '@S-A-BAD-TILE-WIZARD-UNREADABLE' },
    async ({ page, lang, content, consoleErrors }) => {
        await seedWaitingSeries(content, { withLayout: false });
        await page.goto(content.address(lang, 'help/ar-nothing-here/tiles', { map: false }));
        await expect(page.getByText(tilesText(lang, 'adminTiles.notFound'))).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });
        await expectStateSound(page, adminVisit('tiles.empty', lang));
        await page.goto(content.address(lang, `help/${SERIES}/tiles`, { map: false }));
        await expect(page.getByRole('alert').filter({ hasText: tilesText(lang, 'adminTiles.loadFailed') })).toBeVisible({
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        await expect(page.getByRole('button', { name: tilesText(lang, 'adminTiles.retry') })).toBeVisible();
        await expectStateSound(page, adminVisit('tiles.error', lang));
        // The layout the worker never wrote: the browser logs the bucket's 404.
        await expect.poll(() => consoleErrors.takeMatching(/status of 404 .*layout\.json/).length).toBeGreaterThan(0);
    },
);
