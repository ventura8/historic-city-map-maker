import { expect, test } from '../../support/test.js';
import { callController, openLayers, openViewer, viewer } from '../../support/viewer.js';

/**
 * V73 (the iPhone QA, 2026-11-15): a new year scrolls the open Layers panel to that year's layers and marks them for a
 * moment (`revealed`); the page's first year reveals nothing. Unit tests: packages/ui/test/viewer/hcm-layer-panel.test.ts,
 * packages/ui/test/components/overlay-list.test.ts.
 */

const revealed = 'hcm-layer-panel hcm-overlay-list li.revealed';

test('A new year scrolls the open Layers panel to its layer and marks it', { tag: '@S-V73-HAPPY-REVEAL' }, async ({ page, lang }) => {
    await openViewer(page, { lang });
    await openLayers(page, lang);
    await callController(page, 'setYear', 1966);
    const row = viewer(page).locator(revealed);
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('1966');
    await expect(row).toBeInViewport();
});

test("The page's first year reveals nothing in the Layers panel", { tag: '@S-V73-BAD-NO-REVEAL' }, async ({ page, lang }) => {
    await openViewer(page, { lang, hash: '15/44.42700/26.08530&layers=e2e-1966' });
    await openLayers(page, lang);
    await expect(viewer(page).locator('hcm-layer-panel hcm-overlay-list li')).not.toHaveCount(0);
    await expect(viewer(page).locator(revealed)).toHaveCount(0);
});
