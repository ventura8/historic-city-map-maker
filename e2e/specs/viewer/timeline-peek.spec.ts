import type { Locale } from '@hcm/shared';
import type { CDPSession, Locator, Page } from '@playwright/test';

import { twoDatesOf1980 } from '../../fixtures/manifest.js';
import { E2E_TILESET_LAYER, E2E_XYZ_LAYER } from '../../fixtures/world.js';
import { expect, test } from '../../support/test.js';
import { fingers, lift, meet, touch, type Point, type Rect } from '../../support/timeline.js';
import { callController, hashParam, openTimelineCard, openViewer, serveManifest, t, viewer } from '../../support/viewer.js';

/**
 * V68's peek (the owner, 2026-11-13: "the date picker for the year should open on mouse hover over the year in the
 * timeline", and the same idea for a finger, DECISIONS-for-review.md §195i): a pointer resting on a year of several dates
 * shows its menu without selecting the year. A mouse rests 300 ms on the year's point (a sweep opens nothing), reaches the
 * menu, and the menu closes 300 ms after it left both, or on Esc; a scrubbing finger rests 400 ms (a quick sweep opens
 * nothing), slides onto a date and lifts to pick it, or lifts on the year to keep the menu; moving on closes it. Each test
 * sets its own window (a computer, a tablet with a mouse; a phone, a tablet), and Playwright's clock is paused once the
 * map is up, so the delays are the page's timers run on purpose, never the machine's speed.
 */

const EMPTY_VIEW = '15/44.37000/25.97000';
/** The floating controls the menu must leave free. */
const CONTROLS = ['hcm-compass', '.dock.zoom', 'hcm-fab-menu'];

function slider(page: Page, lang: Locale) {
    return page.getByRole('slider', { name: t(lang, 'timeline.label'), exact: true });
}

function datesMenu(page: Page, lang: Locale) {
    return page.getByRole('menu', { name: t(lang, 'timeline.dates', { year: '1980' }), exact: true });
}

/** The centre of 1980's stop (the first) or of today's (the last). */
async function stopPoint(page: Page, year: 1980 | null): Promise<Point> {
    const stops = viewer(page).locator('hcm-timeline .stop');
    const box = await (year === null ? stops.last() : stops.first()).boundingBox();
    expect(box, 'the stop is on screen').not.toBeNull();
    return { x: (box?.x ?? 0) + (box?.width ?? 0) / 2, y: (box?.y ?? 0) + (box?.height ?? 0) / 2 };
}

async function boxOf(locator: Locator): Promise<Rect> {
    const box = await locator.boundingBox();
    expect(box, 'on screen').not.toBeNull();
    return { x: box?.x ?? 0, y: box?.y ?? 0, width: box?.width ?? 0, height: box?.height ?? 0 };
}

async function centreOf(page: Page, name: string): Promise<Point> {
    const box = await boxOf(page.getByRole('menuitemradio', { name }));
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** The finger already down moves through `path`. */
async function slide(cdp: CDPSession, path: readonly Point[]): Promise<void> {
    for (const point of path) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: point.x, y: point.y }] });
    }
}

/** The city whose 1980 has two dates, on today, the timeline card open and the page's clock paused. */
async function onToday(page: Page, lang: Locale): Promise<void> {
    await page.clock.install();
    await serveManifest(page, twoDatesOf1980());
    await openViewer(page, { lang, hash: EMPTY_VIEW });
    await callController(page, 'setYear', null);
    await openTimelineCard(page);
    await expect(slider(page, lang)).toHaveAttribute('aria-valuetext', t(lang, 'timeline.present'));
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
}

/** The menu is inside the window and clear of the compass, the zoom group and the menu button. */
async function expectClear(page: Page, lang: Locale): Promise<void> {
    const menu = await boxOf(datesMenu(page, lang));
    const size = page.viewportSize() ?? { width: 0, height: 0 };
    expect(menu.x).toBeGreaterThanOrEqual(0);
    expect(menu.y).toBeGreaterThanOrEqual(0);
    expect(menu.x + menu.width).toBeLessThanOrEqual(size.width);
    expect(menu.y + menu.height).toBeLessThanOrEqual(size.height);
    for (const selector of CONTROLS) {
        for (const control of await viewer(page).locator(selector).filter({ visible: true }).all()) {
            expect(meet(menu, await boxOf(control)), `the menu is clear of ${selector}`).toBe(false);
        }
    }
}

/** The page's layers= once the clock runs again (the hash is written on a timer). */
async function expectLayers(page: Page, layers: string): Promise<void> {
    await page.clock.resume();
    await expect.poll(() => hashParam(page, 'layers')).toBe(layers);
}

const MOUSE_WINDOWS = [
    { name: 'a computer (l1440)', use: { viewport: { width: 1440, height: 900 }, hasTouch: false, isMobile: false } },
    { name: 'a tablet with a mouse (e1024)', use: { viewport: { width: 1024, height: 768 }, hasTouch: true, isMobile: false } },
];

for (const { name, use } of MOUSE_WINDOWS) {
    test.describe(`The peek under a mouse: ${name}`, () => {
        test.use(use);

        test(
            'Hovering a multi-date year opens its date menu without selecting',
            { tag: '@S-V68-HAPPY-HOVER-PEEK' },
            async ({ page, lang }) => {
                await onToday(page, lang);
                const of1980 = await stopPoint(page, 1980);

                await page.mouse.move(of1980.x, of1980.y);
                await page.clock.runFor(250);
                await expect(datesMenu(page, lang), 'not before the hover intent').toHaveCount(0);
                await page.clock.runFor(100);

                await expect(datesMenu(page, lang)).toBeVisible();
                await expect(slider(page, lang), 'the year is not selected').toHaveAttribute('aria-valuetext', t(lang, 'timeline.present'));
                await expect(page.getByRole('menuitemradio', { checked: true }), 'the focus stays').not.toBeFocused();
                await expectClear(page, lang);

                const march = await centreOf(page, 'Corona (e2e)');
                await page.mouse.move(of1980.x, march.y, { steps: 6 });
                await page.clock.runFor(1000);
                await expect(datesMenu(page, lang), 'the way into the menu keeps it').toBeVisible();
                await page.getByRole('menuitemradio', { name: 'Corona (e2e)' }).click();

                await expect(datesMenu(page, lang)).toBeHidden();
                await expect(slider(page, lang)).toHaveAttribute(
                    'aria-valuetext',
                    new RegExp(`^${t(lang, 'timeline.year', { year: '1980' })}`, 'u'),
                );
                await expectLayers(page, `${E2E_XYZ_LAYER.id},${E2E_TILESET_LAYER.id}`);
            },
        );

        test(
            "Sweeping across years doesn't open menus; leaving or Esc closes one",
            { tag: '@S-V68-BAD-HOVER-SWEEP' },
            async ({ page, lang }) => {
                await onToday(page, lang);
                const of1980 = await stopPoint(page, 1980);
                const today = await stopPoint(page, null);

                await page.mouse.move(today.x, today.y);
                await page.mouse.move(of1980.x, of1980.y, { steps: 5 });
                await page.mouse.move(today.x, today.y, { steps: 5 });
                await page.clock.runFor(1000);
                await expect(datesMenu(page, lang), 'a sweep opens nothing').toHaveCount(0);

                await page.mouse.move(of1980.x, of1980.y);
                await page.clock.runFor(300);
                await expect(datesMenu(page, lang)).toBeVisible();
                await page.mouse.move(today.x, today.y);
                await page.clock.runFor(300);
                await expect(datesMenu(page, lang), 'leaving the year and the menu closes it').toBeHidden();

                await page.mouse.move(of1980.x, of1980.y);
                await page.clock.runFor(300);
                await expect(datesMenu(page, lang)).toBeVisible();
                await page.keyboard.press('Escape');
                await expect(datesMenu(page, lang)).toBeHidden();
                await expect(slider(page, lang), 'nothing selected').toHaveAttribute('aria-valuetext', t(lang, 'timeline.present'));
            },
        );
    });
}

const FINGER_WINDOWS = [
    { name: 'a phone (c360)', use: { viewport: { width: 360, height: 800 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } },
    { name: 'a tablet (m768)', use: { viewport: { width: 768, height: 1024 }, hasTouch: true, isMobile: false } },
];

/** A point `by` px off `from` across the timeline: up from a lying one, to the trailing side of a standing one. */
async function across(page: Page, from: Point, by: number): Promise<Point> {
    const standing = (await viewer(page).locator('hcm-timeline').getAttribute('orientation')) === 'vertical';
    return standing ? { x: from.x + by, y: from.y } : { x: from.x, y: from.y - by };
}

for (const { name, use } of FINGER_WINDOWS) {
    test.describe(`The peek under a finger: ${name}`, () => {
        test.use(use);

        test(
            'A dwell opens the dates, and sliding onto one and lifting picks it',
            { tag: '@S-V68-HAPPY-DWELL-PICK' },
            async ({ page, lang }) => {
                await onToday(page, lang);
                const cdp = await fingers(page);
                const of1980 = await stopPoint(page, 1980);
                const today = await stopPoint(page, null);

                await touch(cdp, today, [of1980], false);
                await page.clock.runFor(350);
                await expect(datesMenu(page, lang), 'not before the dwell').toHaveCount(0);
                await page.clock.runFor(100);
                await expect(datesMenu(page, lang)).toBeVisible();
                await expectClear(page, lang);
                const march = await centreOf(page, 'Corona (e2e)');
                const beside = await across(page, of1980, 60);
                await slide(cdp, [beside, march]);
                await lift(cdp);

                await expect(datesMenu(page, lang)).toBeHidden();
                await expect(slider(page, lang)).toHaveAttribute(
                    'aria-valuetext',
                    new RegExp(`^${t(lang, 'timeline.year', { year: '1980' })}`, 'u'),
                );
                await expectLayers(page, `${E2E_XYZ_LAYER.id},${E2E_TILESET_LAYER.id}`);
            },
        );

        test("Touch doesn't open on hover", { tag: '@S-V68-BAD-HOVER-TOUCH' }, async ({ page, lang }) => {
            await onToday(page, lang);
            const cdp = await fingers(page);

            await touch(cdp, await stopPoint(page, null), [], true);
            await page.clock.runFor(1000);

            await expect(datesMenu(page, lang), 'a tap on today, then nothing: a finger never hovers').toHaveCount(0);
            await expect(slider(page, lang)).toHaveAttribute('aria-valuetext', t(lang, 'timeline.present'));
        });

        test('A quick sweep opens nothing, and moving on closes the menu', { tag: '@S-V68-BAD-DWELL-SWEEP' }, async ({ page, lang }) => {
            await onToday(page, lang);
            const cdp = await fingers(page);
            const of1980 = await stopPoint(page, 1980);
            const today = await stopPoint(page, null);

            await touch(cdp, today, [of1980, today], true);
            await page.clock.runFor(1000);
            await expect(datesMenu(page, lang), 'a quick sweep opens nothing').toHaveCount(0);

            await touch(cdp, today, [of1980], false);
            await page.clock.runFor(400);
            await expect(datesMenu(page, lang)).toBeVisible();
            await slide(cdp, [today]);
            await expect(datesMenu(page, lang), 'moving on closes it').toBeHidden();
            await expect(slider(page, lang), 'the scrub goes on').toHaveAttribute('aria-valuetext', t(lang, 'timeline.present'));
            await lift(cdp);
            await expect(datesMenu(page, lang)).toHaveCount(0);
        });

        test('Lifting on the year after a dwell keeps the menu for a tap', { tag: '@S-V68-HAPPY-DWELL-PICK' }, async ({ page, lang }) => {
            await onToday(page, lang);
            const cdp = await fingers(page);
            const of1980 = await stopPoint(page, 1980);

            await touch(cdp, await stopPoint(page, null), [of1980], false);
            await page.clock.runFor(400);
            await expect(datesMenu(page, lang)).toBeVisible();
            await lift(cdp);

            await expect(datesMenu(page, lang)).toBeVisible();
            await expect(page.getByRole('menuitemradio', { checked: true })).toBeFocused();
        });
    });
}
