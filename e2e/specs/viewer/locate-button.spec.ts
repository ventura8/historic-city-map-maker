import type { Locator } from '@playwright/test';

import { expect, test } from '../../support/test.js';
import { locateButton, menuButton, openViewer, t, viewer } from '../../support/viewer.js';

/**
 * Show my location is an icon button just above the compass (the owner, 2026-11-22), clear of the compass, the zoom
 * buttons, the Layers pane and the timeline on every window; the menu no longer lists it.
 */

interface Box {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

/** Two boxes overlap; a missing one (a control this window does not show) overlaps nothing. */
function overlaps(a: Box | null, b: Box | null): boolean {
    return a !== null && b !== null && a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** `a` is above or before `b` (a missing `b`: nothing to be above). */
function aboveOrBeside(a: Box | null, b: Box | null): boolean {
    return a === null || b === null || a.y + a.height <= b.y + 1 || a.x + a.width <= b.x + 1;
}

async function boxOf(locator: Locator): Promise<Box | null> {
    return (await locator.count()) === 0 || !(await locator.first().isVisible()) ? null : locator.first().boundingBox();
}

for (const [width, height] of [
    [1440, 900],
    [1024, 768],
    [768, 1024],
    [412, 915],
    [360, 800],
    [800, 360],
] as const) {
    test(
        `Show my location sits above the compass and covers no control at ${String(width)} x ${String(height)}`,
        { tag: '@S-V10-HAPPY-LOCATE-ICON' },
        async ({ page, lang }) => {
            await page.setViewportSize({ width, height });
            await openViewer(page, { lang, hash: '15/44.42700/26.08530' });
            const button = locateButton(page, lang);
            await expect(button).toBeVisible();
            await expect(viewer(page).locator('.dock.locate hcm-icon-button')).toHaveAttribute('title', t(lang, 'action.locate'));
            const mine = await button.boundingBox();
            expect((mine?.width ?? 0) >= 40 && (mine?.height ?? 0) >= 40, 'an icon button, not a chip').toBe(true);
            expect(mine?.width ?? 0, 'no text beside the icon').toBeLessThan(60);
            expect(aboveOrBeside(mine, await boxOf(viewer(page).locator('.dock.compass'))), 'above or beside the compass').toBe(true);
            for (const selector of ['.dock.compass', '.dock.zoom', 'hcm-timeline', '.pane.leading', '.dock.menu']) {
                expect(overlaps(mine, await boxOf(viewer(page).locator(selector))), `clear of ${selector}`).toBe(false);
            }
        },
    );
}

test('Show my location is no longer an item of the menu', { tag: '@S-V10-BAD-NOT-IN-MENU' }, async ({ page, lang }) => {
    await openViewer(page, { lang, hash: '15/44.42700/26.08530' });
    await menuButton(page, lang).click();
    await expect(page.getByRole('menuitemcheckbox', { name: t(lang, 'action.locate'), exact: true })).toHaveCount(0);
    await expect(page.getByRole('menuitem', { name: t(lang, 'action.locate'), exact: true })).toHaveCount(0);
});
