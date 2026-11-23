import type { Locale } from '@hcm/shared';
import type { Page } from '@playwright/test';

import { twoDatesOf1980 } from '../../fixtures/manifest.js';
import { expect, test } from '../../support/test.js';
import { callController, openViewer, serveManifest, t, viewer } from '../../support/viewer.js';

/**
 * A year with several layers (the owner, 2026-11-22): its pill always shows the dates together with the opacity sliders,
 * and the sliders never cover the timeline. Since 2026-11-23 the two sit side by side in one row on every window, and the
 * sliders never show alone (a mouse on the pill showed the timeline's own card without the dates).
 */

async function restOnTheYear(page: Page, lang: Locale, width: number, height: number): Promise<void> {
    await page.setViewportSize({ width, height });
    await serveManifest(page, twoDatesOf1980());
    await openViewer(page, { lang, hash: '15/44.37000/25.97000' });
    await callController(page, 'setYear', 1980);
    // Enter on the year (a keyboard, a remote, a phone's pill): the same menu on every window (V13).
    await page.getByRole('slider', { name: t(lang, 'timeline.label'), exact: true }).focus();
    await page.keyboard.press('Enter');
}

function overlaps(a: { x: number; y: number; width: number; height: number }, b: typeof a): boolean {
    return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** One row: apart along it, sharing some of their height. */
function sideBySide(a: { x: number; y: number; width: number; height: number }, b: typeof a): boolean {
    return !overlaps(a, b) && a.y < b.y + b.height && b.y < a.y + a.height;
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
        `The dates and the opacity sliders show together at ${String(width)} x ${String(height)}`,
        { tag: '@S-V13-HAPPY-DATES-WITH-SLIDERS' },
        async ({ page, lang }) => {
            await restOnTheYear(page, lang, width, height);
            const dates = page.getByRole('menu', { name: t(lang, 'timeline.dates', { year: '1980' }), exact: true });
            const sliders = viewer(page).locator('hcm-date-menu .side');
            await expect(dates).toBeVisible();
            await expect(sliders).toBeVisible();
            await expect(viewer(page).locator('.opacity-sheet')).toHaveCount(0);
            const datesBox = await dates.boundingBox();
            const slidersBox = await sliders.boundingBox();
            expect(datesBox !== null && slidersBox !== null && !overlaps(datesBox, slidersBox), 'the sliders sit beside the dates').toBe(
                true,
            );
        },
    );

    test(
        `The dates and the opacity sliders sit side by side, inside the window, at ${String(width)} x ${String(height)}`,
        { tag: '@S-V13-HAPPY-DATES-SIDE-BY-SIDE' },
        async ({ page, lang }) => {
            await restOnTheYear(page, lang, width, height);
            const dates = page.getByRole('menu', { name: t(lang, 'timeline.dates', { year: '1980' }), exact: true });
            const sliders = viewer(page).locator('hcm-date-menu .side');
            await expect(sliders).toBeVisible();
            const datesBox = await dates.boundingBox();
            const slidersBox = await sliders.boundingBox();
            expect(datesBox !== null && slidersBox !== null && sideBySide(datesBox, slidersBox), 'one row').toBe(true);
            for (const box of [datesBox, slidersBox]) {
                expect(box !== null && box.x >= 0 && box.x + box.width <= width, 'inside the window').toBe(true);
            }
        },
    );

    test(
        `The opacity sliders never cover the timeline at ${String(width)} x ${String(height)}`,
        { tag: '@S-V13-BAD-SLIDERS-OVER-TIMELINE' },
        async ({ page, lang }) => {
            await restOnTheYear(page, lang, width, height);
            const sliders = viewer(page).locator('hcm-date-menu .side');
            await expect(sliders).toBeVisible();
            const slidersBox = await sliders.boundingBox();
            const timelineBox = await viewer(page).locator('hcm-timeline').boundingBox();
            expect(slidersBox !== null && timelineBox !== null && !overlaps(slidersBox, timelineBox), 'clear of the timeline').toBe(true);
        },
    );
}

test(
    'A mouse on the pill of a year of several dates never shows the sliders without the dates',
    { tag: '@S-V13-BAD-SLIDERS-ALONE' },
    async ({ page, lang }) => {
        await restOnTheYear(page, lang, 1440, 900);
        const dates = page.getByRole('menu', { name: t(lang, 'timeline.dates', { year: '1980' }), exact: true });
        await expect(dates).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(dates).toHaveCount(0);
        // The pointer back on the pill (as after a press on the menu's scrim): the timeline's own card stays hidden.
        await viewer(page).locator('hcm-timeline').locator('.thumb').hover();
        await expect(viewer(page).locator('hcm-timeline').locator('.opacity:not([hidden])')).toHaveCount(0);
        // Its peek then shows the dates and the sliders together, or nothing: never the sliders alone.
        const sliders = viewer(page).locator('hcm-date-menu .side');
        await expect(async () => {
            const lone = (await sliders.count()) > 0 && (await dates.count()) === 0;
            expect(lone, 'no sliders without their dates').toBe(false);
        }).toPass();
    },
);
