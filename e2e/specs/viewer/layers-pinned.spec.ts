import { translateMapLabels } from '@hcm/shared/map-labels';
import type { Locale } from '@hcm/shared';
import type { Page } from '@playwright/test';

import { siteManifestData, type Json } from '../../fixtures/manifest.js';
import { E2E_PLAIN_STYLE_ID } from '../../fixtures/world.js';
import { mapIdle } from '../../support/map.js';
import { sitePath } from '../../support/site.js';
import { expect, test } from '../../support/test.js';
import { openLayers, openViewer, serveManifest, t, viewer, waitForEngineEvent } from '../../support/viewer.js';

/**
 * Compare, Street names and POIs stay pinned at the top of Layers while the overlay list scrolls (owner, 2026-11-10).
 */

async function bootWide(page: Page, lang: Locale): Promise<void> {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(sitePath('bucharest', { lang, hash: '15/44.42700/26.08530&layers=e2e-1966' }));
    await waitForEngineEvent(page, 'hcm-ready');
    await mapIdle(page);
}

test(
    'Compare and map-label switches sit above the overlay list and stay while it scrolls',
    { tag: '@S-V03-HAPPY-LAYERS-PINNED' },
    async ({ page, lang }) => {
        await bootWide(page, lang);
        const pane = viewer(page).locator('.pane.leading hcm-layer-panel');
        const compare = pane.getByRole('button', { name: t(lang, 'compare.open'), exact: true });
        const streets = pane.getByRole('switch', { name: translateMapLabels(lang, 'mapLabels.streets'), exact: true });
        const list = pane.locator('hcm-overlay-list');

        await expect(compare).toBeVisible();
        await expect(streets).toBeVisible();
        const compareBox = await compare.boundingBox();
        const listBox = await list.boundingBox();
        expect((compareBox?.y ?? 0) < (listBox?.y ?? 0), 'Compare sits above the overlay list').toBe(true);

        await list.evaluate((element) => {
            const body = element.closest('.body');
            if (body instanceof HTMLElement) {
                body.scrollTop = body.scrollHeight;
            }
        });
        await expect(compare).toBeVisible();
        await expect(streets).toBeVisible();
        const after = await compare.boundingBox();
        expect(Math.abs((after?.y ?? 0) - (compareBox?.y ?? 0)) < 2, 'Compare stays pinned while the list scrolls').toBe(true);
    },
);

test(
    'With no historical layers and a custom basemap, Layers has no pinned strip',
    { tag: '@S-V03-BAD-LAYERS-NO-PINNED' },
    async ({ page, lang }) => {
        const manifest = siteManifestData();
        (manifest['city'] as Json)['basemap'] = { style: `mapbox://styles/hcm-e2e/${E2E_PLAIN_STYLE_ID}` };
        manifest['layers'] = [];
        await serveManifest(page, manifest);
        await openViewer(page, { lang, hash: '15/44.42700/26.08530' });
        await openLayers(page, lang);

        await expect(page.getByRole('button', { name: t(lang, 'compare.open'), exact: true })).toHaveCount(0);
        await expect(page.getByRole('group', { name: translateMapLabels(lang, 'mapLabels.group'), exact: true })).toHaveCount(0);
        // The strip holds the Photos switch alone (2026-11-16): nothing of Compare, Map labels or a pinned category.
        await expect(viewer(page).locator('hcm-layer-panel .pinned > :not(hcm-photos-control)')).toHaveCount(0);
        await expect(viewer(page).locator('hcm-layer-panel .pinned hcm-photos-control')).toBeVisible();
        await expect(viewer(page).locator('hcm-overlay-list')).toBeVisible();
    },
);

test(
    "On a phone's bottom sheet the strip scrolls with the list, so nothing the focus reaches sits under it",
    { tag: '@S-V03-BAD-LAYERS-PINNED-PHONE' },
    async ({ page, lang }) => {
        await page.setViewportSize({ width: 360, height: 800 });
        await openViewer(page, { lang, hash: '15/44.42700/26.08530&layers=e2e-1966' });
        await openLayers(page, lang);
        const panel = viewer(page).locator('hcm-layer-panel');
        const compare = panel.getByRole('button', { name: t(lang, 'compare.open'), exact: true });
        await expect(compare).toBeVisible();
        const before = await compare.boundingBox();

        await panel.locator('hcm-sheet').evaluate((sheet) => {
            const scroller = sheet.shadowRoot?.querySelector('.content');
            if (scroller instanceof HTMLElement) {
                scroller.scrollTop = scroller.scrollHeight;
            }
        });
        await expect
            .poll(async () => (await compare.boundingBox())?.y ?? -1, 'Compare scrolls away with the list')
            .toBeLessThan((before?.y ?? 0) - 40);

        const last = panel.getByRole('switch').last();
        await last.focus();
        const box = await last.boundingBox();
        const hit = await page.evaluate(
            ({ x, y }) => {
                let element = document.elementFromPoint(x, y);
                while (element?.shadowRoot) {
                    const inner = element.shadowRoot.elementFromPoint(x, y);
                    if (inner === null || inner === element) {
                        break;
                    }
                    element = inner;
                }
                return element?.getAttribute('role') ?? element?.tagName.toLowerCase() ?? '';
            },
            { x: (box?.x ?? 0) + (box?.width ?? 0) / 2, y: (box?.y ?? 0) + (box?.height ?? 0) / 2 },
        );
        expect(hit, 'the focused switch is the element under its own centre').toBe('switch');
    },
);
