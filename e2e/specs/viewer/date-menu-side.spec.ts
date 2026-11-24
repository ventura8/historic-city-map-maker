import type { Locale } from '@hcm/shared';
import type { Locator, Page } from '@playwright/test';

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

async function boxOrNull(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
    const box = await locator.boundingBox();
    expect(box, 'on screen').not.toBeNull();
    return box ?? { x: 0, y: 0, width: 0, height: 0 };
}

/** The px between the row and the timeline: past a standing one, above a lying one (negative: over it). */
function gapBeside(pair: { x: number; y: number; width: number; height: number }, card: typeof pair, standing: boolean): number {
    return standing ? pair.x - (card.x + card.width) : card.y - (pair.y + pair.height);
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
            const bottomOf = (box: { readonly y: number; readonly height: number } | null): number =>
                (box?.y ?? Number.NaN) + (box?.height ?? 0);
            expect(Math.abs(bottomOf(datesBox) - bottomOf(slidersBox)), 'the dates and the sliders end on one line').toBeLessThanOrEqual(1);
            for (const box of [datesBox, slidersBox]) {
                expect(box !== null && box.x >= 0 && box.x + box.width <= width, 'inside the window').toBe(true);
            }
            const pair = await boxOrNull(viewer(page).locator('hcm-date-menu .pair'));
            const card = await boxOrNull(viewer(page).locator('hcm-timeline'));
            const standing = (await viewer(page).locator('hcm-timeline').getAttribute('orientation')) === 'vertical';
            // Beside the timeline (above a lying one, past a standing one), never moved off to a corner (the owner, 2026-11-23).
            const gap = gapBeside(pair, card, standing);
            expect(gap, 'the row is beside the timeline').toBeGreaterThanOrEqual(0);
            expect(gap, 'the row is beside the timeline, not in a corner').toBeLessThanOrEqual(24);
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

/** The sliders lie under the dates: apart, the sliders' top at or below the dates' bottom. */
function under(dates: { x: number; y: number; width: number; height: number }, sliders: typeof dates): boolean {
    return !overlaps(dates, sliders) && sliders.y >= dates.y + dates.height - 0.5;
}

test(
    'On a 320 px phone the opacity sliders go under the dates, inside the window and clear of the timeline',
    { tag: '@S-V13-HAPPY-DATES-STACKED-NARROW' },
    async ({ page, lang }) => {
        // The owner, 2026-11-24: "Stack on very narrow phones": beside the standing timeline there is no room for both.
        await restOnTheYear(page, lang, 320, 568);
        const dates = await boxOrNull(page.getByRole('menu', { name: t(lang, 'timeline.dates', { year: '1980' }), exact: true }));
        const sliders = await boxOrNull(viewer(page).locator('hcm-date-menu .side'));
        expect(under(dates, sliders), 'the sliders under the dates').toBe(true);
        for (const box of [dates, sliders]) {
            expect(box.x >= 0 && box.x + box.width <= 320 && box.y >= 0 && box.y + box.height <= 568, 'inside the window').toBe(true);
        }
        const card = await boxOrNull(viewer(page).locator('hcm-timeline'));
        expect(overlaps(sliders, card) || overlaps(dates, card), 'clear of the timeline').toBe(false);
        await expect(viewer(page).locator('hcm-date-menu .opacity-sliders [role="slider"]')).toHaveCount(3);
    },
);

test(
    'A phone with room beside the timeline keeps the dates and the sliders side by side, never stacked',
    { tag: '@S-V13-BAD-STACKED-WITH-ROOM' },
    async ({ page, lang }) => {
        await restOnTheYear(page, lang, 360, 800);
        const dates = await boxOrNull(page.getByRole('menu', { name: t(lang, 'timeline.dates', { year: '1980' }), exact: true }));
        const sliders = await boxOrNull(viewer(page).locator('hcm-date-menu .side'));
        expect(sideBySide(dates, sliders), 'one row').toBe(true);
        await expect(viewer(page).locator('hcm-date-menu .pair[data-stacked]')).toHaveCount(0);
    },
);

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

test(
    'A click on another year opens its dates by that year, not by the year the thumb glides from',
    { tag: '@S-V13-BAD-MENU-BY-OLD-THUMB' },
    async ({ page, lang }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await serveManifest(page, twoDatesOf1980());
        await openViewer(page, { lang, hash: '15/44.37000/25.97000' });
        await callController(page, 'setYear', null);
        const stop = await boxOrNull(viewer(page).locator('hcm-timeline .stop').first());
        await page.mouse.click(stop.x + stop.width / 2, stop.y + stop.height / 2);
        const pair = viewer(page).locator('hcm-date-menu .pair');
        await expect(pair).toBeVisible();
        const row = await boxOrNull(pair);
        const card = await boxOrNull(viewer(page).locator('hcm-timeline'));
        // The thumb glided from "today" at the far end for 350 ms: the row is by 1980 all the same (the owner, 2026-11-23).
        // By 1980's end of the timeline (moved along it only past the photos chip), never by today's at the other end.
        expect(row.x + row.width / 2, 'the row is by 1980').toBeLessThan(card.x + card.width / 2);
        expect(gapBeside(row, card, false), 'just above the timeline').toBeGreaterThanOrEqual(0);
        expect(gapBeside(row, card, false), 'just above the timeline').toBeLessThanOrEqual(24);
    },
);
