import type { Locator, Page } from '@playwright/test';
import type { ViewerLocale } from '@hcm/shared';

import { expect, test } from '../../support/test.js';
import { callController, menuButton, menuItemNamed, openViewer, t } from '../../support/viewer.js';

/**
 * Back to the photo list (V75; the QA tester's iPhone, 2026-11-15): a photo opened from the list returns to it, at the same
 * row, by the sheet's Back, the browser's back (iOS swipe-back) and Esc. A photo opened from the map closes as before. Run
 * in WebKit with the iPhone 15 profile (project `fn-webkit-iphone15`, e2e/projects.ts).
 */

test.use({
    expectedConsoleErrors: [
        {
            text: /^Refused to apply a stylesheet because its hash, its nonce, or 'unsafe-inline' does not appear in the style-src directive/,
            url: /^(?:http:\/\/127\.0\.0\.1:\d+\/|$)/,
            why: "Playwright's WebKit inserts <style>body {}</style> from its own inspector (web-inspector://bootstrap.js) after a tap; the page adds no inline style (seen 2026-11-15)",
        },
    ],
});

/** The row the test opens: far enough down that the list has to scroll to it. */
const ROW = 20;

function rows(page: Page, lang: ViewerLocale): Locator {
    return page.getByRole('list', { name: t(lang, 'photos.list') }).getByRole('button');
}

async function openRowFromList(page: Page, lang: ViewerLocale): Promise<void> {
    const row = rows(page, lang).nth(ROW);
    await row.scrollIntoViewIfNeeded();
    await row.tap();
    await expect(page.getByRole('button', { name: t(lang, 'photo.backToList') })).toBeVisible();
}

async function expectListAtRow(page: Page, lang: ViewerLocale): Promise<void> {
    await expect(rows(page, lang).nth(ROW)).toBeInViewport();
    await expect(page.getByRole('button', { name: t(lang, 'photo.backToList') })).toHaveCount(0);
}

test(
    'On an iPhone a photo opened from the list goes back to the list at the same row: Back, the back gesture and Esc',
    { tag: '@S-V75-HAPPY-BACK-TO-LIST' },
    async ({ page, lang }) => {
        await openViewer(page, { lang });
        await menuButton(page, lang).tap();
        await menuItemNamed(page, t(lang, 'photos.list')).tap();

        await openRowFromList(page, lang);
        await page.getByRole('button', { name: t(lang, 'photo.backToList') }).tap();
        await expectListAtRow(page, lang);

        await openRowFromList(page, lang);
        await page.goBack();
        await expectListAtRow(page, lang);

        await openRowFromList(page, lang);
        await page.keyboard.press('Escape');
        await expectListAtRow(page, lang);
    },
);

test('On an iPhone a photo opened from the map has no Back and its Esc closes it', { tag: '@S-V75-BAD-FROM-MAP' }, async ({ page, lang }) => {
    await openViewer(page, { lang });
    await callController(page, 'openPhoto', 'strandul-opereta-1976');
    await expect(page.getByRole('button', { name: t(lang, 'photo.openLightbox') })).toBeVisible();
    await expect(page.getByRole('button', { name: t(lang, 'photo.backToList') })).toHaveCount(0);

    await page.keyboard.press('Escape');

    await expect(page.getByRole('button', { name: t(lang, 'photo.openLightbox') })).toHaveCount(0);
    await expect(page.getByRole('list', { name: t(lang, 'photos.list') })).toHaveCount(0);
});
