import type { Locator, Page } from '@playwright/test';

import { mapIdle } from '../../support/map.js';
import { sitePath } from '../../support/site.js';
import { expect, test } from '../../support/test.js';
import { callController, viewer, waitForEngineEvent } from '../../support/viewer.js';

/**
 * A year chosen on the timeline shows its layer in the Layers panel (the owner, 2026-11-22: 1970 stayed hidden under the
 * sticky strip), and no row is ever drawn under anything.
 */

async function bootWide(page: Page): Promise<Locator> {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(sitePath('bucharest', { hash: '15/44.42700/26.08530' }));
    await waitForEngineEvent(page, 'hcm-ready');
    await mapIdle(page);
    return viewer(page).locator('.pane.leading hcm-layer-panel');
}

/** Whether the element at the row's centre is the row itself or inside it. */
async function rowOnTop(row: Locator): Promise<boolean> {
    return row.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const x = box.left + 8;
        const y = box.top + box.height / 2;
        const root = element.getRootNode() as ShadowRoot;
        const hit = root.elementFromPoint(x, y);
        return hit !== null && (hit === element || element.contains(hit));
    });
}

test(
    "Choosing a year expands its layer's section and brings its row into view",
    { tag: ['@S-V03-HAPPY-YEAR-REVEALS-ITS-LAYER', '@layer-sections-default'] },
    async ({ page }) => {
        const pane = await bootWide(page);
        await callController(page, 'setYear', 1980);
        const row = pane.locator('li[data-overlay="e2e-1980"]');
        await expect(row).toBeVisible();
        await expect.poll(() => rowOnTop(row)).toBe(true);
        const body = await pane.evaluate((panel) => panel.shadowRoot?.querySelector('.body')?.getBoundingClientRect().toJSON() as DOMRect);
        const box = await row.boundingBox();
        expect((box?.y ?? -1) >= body.y - 1 && (box?.y ?? 0) + (box?.height ?? 0) <= body.y + body.height + 1, 'inside the pane').toBe(
            true,
        );
    },
);

test('No row of the Layers pane is ever drawn under another part', { tag: '@S-V03-BAD-ROWS-NEVER-UNDER-THE-STRIP' }, async ({ page }) => {
    const pane = await bootWide(page);
    const scrolled = await pane
        .locator('hcm-overlay-list')
        .last()
        .evaluate((element) => {
            for (
                let node: Node | null = element;
                node !== null;
                node = node.parentNode ?? (node instanceof ShadowRoot ? node.host : null)
            ) {
                if (node instanceof HTMLElement && node.scrollHeight > node.clientHeight && getComputedStyle(node).overflowY === 'auto') {
                    node.scrollTop = node.scrollHeight / 3;
                    return node.scrollTop;
                }
            }
            return 0;
        });
    expect(scrolled, 'the pane scrolls').toBeGreaterThan(0);
    const rows = pane.locator('li[data-overlay]');
    const count = await rows.count();
    for (let index = 0; index < count; index += 1) {
        const row = rows.nth(index);
        if (await row.isVisible()) {
            const box = await row.boundingBox();
            if ((box?.y ?? -1) > 80 && (box?.y ?? 2000) < 1000) {
                expect(await rowOnTop(row), `row ${String(index)} on top`).toBe(true);
            }
        }
    }
});
