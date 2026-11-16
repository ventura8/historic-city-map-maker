import type { Locator, Page } from '@playwright/test';

import { siteManifestData, type Json } from '../../fixtures/manifest.js';
import { expect, test } from '../../support/test.js';
import { openLayers, openViewer, serveManifest, viewer } from '../../support/viewer.js';

/**
 * Each historical layer's date (or year) sits below its name in Layers, in smaller text, and the row is no taller for it
 * (the owner, 2026-11-14): a dated row has the height of an undated Places row at a phone's and a computer's width.
 * Photos left this list for a switch under Map labels, so no Photos row is drawn here.
 */

const WIDTHS = [
    { width: 360, height: 800 },
    { width: 1440, height: 900 },
] as const;

/** The first undated row: a Places category (Photos no longer has a row here). */
function undated(page: Page): Locator {
    return viewer(page).locator('hcm-overlay-list li[data-overlay]:not([data-overlay^="e2e-"])').first();
}

function row(page: Page, id: string): Locator {
    return viewer(page).locator(`hcm-overlay-list li[data-overlay="${id}"]`).first();
}

async function height(locator: Locator): Promise<number> {
    return (await locator.boundingBox())?.height ?? 0;
}

for (const size of WIDTHS) {
    test(
        `At ${String(size.width)} px each layer shows its date below its name in a row no taller than a Places row`,
        { tag: '@S-V03-HAPPY-LAYER-DATE' },
        async ({ page, lang }) => {
            await page.setViewportSize(size);
            await openViewer(page, { lang, hash: '15/44.42700/26.08530' });
            await openLayers(page, lang);
            const dated = row(page, 'e2e-1980');
            await expect(dated.locator('.detail')).toBeVisible();
            await expect(dated.locator('.detail')).toContainText('1980');
            // One read of both boxes: the phone's bottom sheet may still be sliding in between two separate reads.
            const below = await dated.evaluate((element) => {
                const name = element.querySelector('.label')?.getBoundingClientRect();
                const date = element.querySelector('.detail')?.getBoundingClientRect();
                return name !== undefined && date !== undefined && date.top >= name.bottom - 1;
            });
            expect(below, 'the date sits below the name').toBe(true);
            const places = await height(undated(page));
            expect(await height(dated)).toBeCloseTo(places, 1);
            expect(await height(row(page, 'e2e-1966'))).toBeCloseTo(places, 1);
        },
    );
}

test(
    'A long layer name wraps whole and Places show no date, with no Photos row',
    { tag: '@S-V03-BAD-LAYER-NO-DATE' },
    async ({ page, lang }) => {
        await page.setViewportSize({ width: 360, height: 800 });
        const manifest = siteManifestData();
        const layers = manifest['layers'] as Json[];
        const first: Json = layers.at(0) ?? {};
        first['label'] = { ro: 'Strat istoric '.repeat(10), en: 'Historical layer '.repeat(10) };
        await serveManifest(page, manifest);
        await openViewer(page, { lang, hash: '15/44.42700/26.08530' });
        await openLayers(page, lang);
        const long = row(page, String(first['id']));
        const label = long.locator('.label');
        // Wrapped, never cut: an ellipsis hid the layer's name under WCAG 1.4.12's text spacing (docs/LESSONS.md).
        expect(await label.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
        expect(await height(long)).toBeGreaterThan(await height(undated(page)));
        await expect(undated(page).locator('.detail')).toHaveCount(0);
        await expect(row(page, 'photos')).toHaveCount(0);
        await expect(viewer(page).locator('hcm-overlay-list li[data-overlay]:not([data-overlay^="e2e-"]) .detail')).toHaveCount(0);
    },
);
