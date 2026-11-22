import { expect, test } from '../../support/test.js';
import { openViewer, t, viewer } from '../../support/viewer.js';

/** The Layers panel, easier to find (the owner, 2026-11-22): a first visit on a phone offers it once. */

test(
    'A first visit on a phone offers Layers once, and its action opens them',
    { tag: ['@S-V03-HAPPY-LAYERS-HINT', '@layers-hint'] },
    async ({ page, lang }) => {
        await page.setViewportSize({ width: 360, height: 800 });
        await openViewer(page, { lang, hash: '15/44.42700/26.08530' });
        const hint = viewer(page).locator('[data-layout-check="layers-hint"]');
        await expect(hint).toContainText(t(lang, 'layers.hint'));
        await hint.getByRole('button', { name: t(lang, 'layers.hintOpen') }).click();
        await expect(
            viewer(page)
                .locator('hcm-layer-panel')
                .getByRole('heading', { name: t(lang, 'layers.title'), exact: true }),
        ).toBeVisible();
        await expect(hint).toHaveCount(0);

        await page.reload();
        await expect(viewer(page).locator('hcm-timeline')).toBeVisible();
        await expect(viewer(page).locator('[data-layout-check="layers-hint"]')).toHaveCount(0);
    },
);

test('Where the pane is docked there is no hint', { tag: ['@S-V03-BAD-LAYERS-HINT-DOCKED', '@layers-hint'] }, async ({ page, lang }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await openViewer(page, { lang, hash: '15/44.42700/26.08530' });
    await expect(
        viewer(page)
            .locator('hcm-layer-panel')
            .getByRole('heading', { name: t(lang, 'layers.title'), exact: true }),
    ).toBeVisible();
    await expect(viewer(page).locator('[data-layout-check="layers-hint"]')).toHaveCount(0);
});
