import { translateAdminContent } from '@hcm/shared';
import type { Locator, Page } from '@playwright/test';

import type { ContentWorld } from '../../support/content.js';
import { expect, test } from '../../support/content-test.js';
import { FUNCTIONS_TIMEOUT_MS } from '../../support/emulators.js';
import { SERIES, seedWaitingSeries, seriesVersion, tilesText } from './tiles-world.js';

/**
 * The tile wizard's grid under the owner's hand (docs/research/M20-import-local.md §19.17, 2026-11-21): the Borroczyn atlas 1846 needs
 * 11 columns and the pipeline made 5, so the owner adds a column and a sheet moved there is sent at that column; a last column with a
 * sheet in it cannot be taken away. A sheet the pipeline left out and the owner did not put back stays out of the real preview (the
 * plan-ghid 1923's 62 text pages came back into empty cells). `imagery.saveLayout` runs in the Functions emulator.
 */

type Lang = 'ro' | 'en';

function grid(page: Page, lang: Lang): Locator {
    return page.getByRole('grid', { name: tilesText(lang, 'adminTiles.gridLabel') });
}

function sheetCell(page: Page, lang: Lang, name: string): Locator {
    return grid(page, lang).getByRole('gridcell', { name: new RegExp(`^${name.replace('.', '\\.')},`) });
}

function button(page: Page, lang: Lang, key: Parameters<typeof tilesText>[1]): Locator {
    return page.getByRole('button', { name: tilesText(lang, key) });
}

async function openWizard(page: Page, lang: Lang, content: ContentWorld): Promise<void> {
    await page.goto(content.address(lang, `imagery/version/${SERIES}`, { map: false }));
    await page.getByRole('link', { name: translateAdminContent(lang, 'adminContent.imagery.openTiles') }).click();
    await expect(grid(page, lang)).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });
}

async function makePreview(page: Page, lang: Lang): Promise<void> {
    await page
        .getByRole('navigation', { name: tilesText(lang, 'adminTiles.stepsLabel') })
        .getByRole('button', { name: tilesText(lang, 'adminTiles.step.preview') })
        .click();
    await button(page, lang, 'adminTiles.makePreview').click();
    await expect(page.getByText(tilesText(lang, 'adminTiles.previewing'))).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });
}

test('The owner adds a column and moves a sheet into it', { tag: '@S-A-HAPPY-TILE-WIZARD-GRID-SIZE' }, async ({ page, lang, content }) => {
    await seedWaitingSeries(content);
    await openWizard(page, lang, content);

    await button(page, lang, 'adminTiles.addCol').click();
    await expect(page.getByRole('heading', { name: tilesText(lang, 'adminTiles.sizeLabel', { rows: '2', cols: '3' }) })).toBeVisible();
    await sheetCell(page, lang, 'atlas/r1c2.jpg').click();
    await page.keyboard.press('Shift+ArrowRight');
    await expect(sheetCell(page, lang, 'atlas/r1c2.jpg')).toHaveAttribute('data-col', '2');

    await makePreview(page, lang);
    expect((await seriesVersion(content))?.['help']).toMatchObject({
        layoutAnswer: { sheets: expect.arrayContaining([{ index: 1, row: 0, col: 2, turn: 0, flip: false }]) as unknown },
    });
});

test(
    'A column with a sheet is not taken away, and a sheet left out stays out of the preview',
    { tag: ['@S-A-BAD-TILE-WIZARD-GRID-SIZE', '@S-A-BAD-TILE-WIZARD-LEFT-OUT-STAYS'] },
    async ({ page, lang, content }) => {
        await seedWaitingSeries(content, { noSeam: true });
        await openWizard(page, lang, content);
        await expect(button(page, lang, 'adminTiles.dropCol')).toBeDisabled();
        await expect(page.getByRole('button', { name: tilesText(lang, 'adminTiles.putBack', { name: 'atlas/r2c2.jpg' }) })).toBeVisible();

        await sheetCell(page, lang, 'atlas/r1c1.jpg').focus();
        await page.keyboard.press('r');
        await makePreview(page, lang);
        const help = (await seriesVersion(content))?.['help'] as { layoutAnswer: { sheets: { index: number }[] } };
        expect(help.layoutAnswer.sheets.map((sheet) => sheet.index)).toEqual([0, 1, 2]);
    },
);
