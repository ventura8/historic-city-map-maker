import type { Locator, Page } from '@playwright/test';

import { focused, isOnTop, overlaps, visibleBoxes, type FocusInfo } from '../../support/layout.js';
import { expect, test } from '../../support/test.js';
import { closeModalSheet, isDocked, openViewer, t, viewer } from '../../support/viewer.js';

/**
 * Keyboard and screen reader (behaviour V14): the skip link leads to the timeline, the menu to the layers and the
 * photos, every stop shows a focus ring; on an extra-large screen the focused skip link shows over the map, never over
 * a docked pane's heading; the focused map opens the photo under its centre with Enter or Space. The forced-colours and
 * reduced-motion rows run in the a11y projects (e2e/a11y/).
 */

const LONE = 'strandul-opereta-1976';
const LONE_TITLE = 'Ștrandul Operetă';
const EMPTY_VIEW = '15/44.37000/25.97000';

async function expectFocus(page: Page, check: (info: FocusInfo) => boolean, what: string): Promise<FocusInfo> {
    await expect
        .poll(
            async () => {
                const info = await focused(page);
                return info !== null && check(info);
            },
            { message: `the focus is on ${what}` },
        )
        .toBe(true);
    const info = await focused(page);
    if (info === null) {
        throw new Error(`nothing has the focus instead of ${what}`);
    }
    expect(info.ringVisible, `${what} shows a focus ring`).toBe(true);
    return info;
}

/** Tabs (at most `limit` times) until `check` holds for the focused element. */
async function tabUntil(page: Page, check: (info: FocusInfo) => boolean, what: string, limit = 25): Promise<void> {
    for (let step = 0; step < limit; step += 1) {
        const info = await focused(page);
        if (info !== null && check(info)) {
            break;
        }
        await page.keyboard.press('Tab');
    }
    await expectFocus(page, check, what);
}

async function openFromMenu(page: Page, item: string): Promise<void> {
    await page.keyboard.press('Enter');
    await expectFocus(page, (info) => info.role === 'menuitem', 'the first menu item');
    for (let step = 0; step < 8; step += 1) {
        if ((await focused(page))?.name === item) {
            break;
        }
        await page.keyboard.press('ArrowDown');
    }
    await expectFocus(page, (info) => info.role === 'menuitem' && info.name === item, `the menu item ${item}`);
    await page.keyboard.press('Enter');
}

/** The title of the focused row of the photo list (the button's accessible name also holds the date). */
async function focusedRowTitle(page: Page): Promise<string> {
    return page.evaluate(() => {
        let active = document.activeElement;
        while (active?.shadowRoot?.activeElement) {
            active = active.shadowRoot.activeElement;
        }
        return active?.querySelector('.title')?.textContent.trim() ?? '';
    });
}

test('The skip link leads to the timeline, the menu to the layers and the photos', { tag: '@S-V14-HAPPY' }, async ({ page, lang }) => {
    await openViewer(page, { lang });
    const menu = t(lang, 'action.menu');

    await page.keyboard.press('Tab');
    await expectFocus(page, (info) => info.name === t(lang, 'viewer.skipToTimeline'), 'the skip link');
    await page.keyboard.press('Enter');
    await expectFocus(page, (info) => info.role === 'slider' && info.name === t(lang, 'timeline.label'), 'the timeline');

    await tabUntil(page, (info) => info.name === menu, 'the menu button');
    await openFromMenu(page, t(lang, 'layers.title'));
    await expect(page.getByRole('button', { name: t(lang, 'photosScope.options'), exact: true })).toBeVisible();
    await closeModalSheet(page);
    await expectFocus(page, (info) => info.name === menu, 'the menu button again');

    await openFromMenu(page, t(lang, 'photos.list'));
    await tabUntil(page, (info) => info.host === 'hcm-photo-list' && info.tag === 'button', 'a photo of the list');
    const title = await focusedRowTitle(page);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: title, exact: true }).first()).toBeVisible();
});

/** An extra-large screen: the Layers panel is docked in its own leading pane. */
const EXTRA_LARGE = { width: 1920, height: 1080 } as const;

/** Tabs once and checks that the focused skip link covers none of `headings` and sits over the map pane. */
async function expectSkipLinkClearOf(page: Page, lang: 'ro' | 'en', headings: readonly string[]): Promise<void> {
    await page.keyboard.press('Tab');
    await expectFocus(page, (info) => info.name === t(lang, 'viewer.skipToTimeline'), 'the skip link');
    for (const name of headings) {
        const heading = viewer(page).getByRole('heading', { name, exact: true });
        await expect(heading).toBeVisible();
        await expect(isOnTop(heading), `the skip link leaves "${name}" uncovered`).resolves.toBe(true);
    }
    const boxes = await visibleBoxes(page, ['.skip', '.pane']);
    expect(overlaps(boxes), 'the skip link over a pane').toEqual([]);
    const skip = await viewer(page).locator('.skip').boundingBox();
    const map = await viewer(page).locator('.map-pane').boundingBox();
    expect((skip?.x ?? -1) >= (map?.x ?? 0), 'the skip link starts inside the map pane').toBe(true);
}

test(
    'On an extra-large screen the focused skip link shows over the map, clear of the Layers heading',
    { tag: '@S-V14-HAPPY-SKIP-LINK-CLEAR' },
    async ({ page, lang }) => {
        await page.setViewportSize(EXTRA_LARGE);
        await openViewer(page, { lang });

        await expectSkipLinkClearOf(page, lang, [t(lang, 'layers.title')]);
        await page.keyboard.press('Enter');
        await expectFocus(page, (info) => info.role === 'slider' && info.name === t(lang, 'timeline.label'), 'the timeline');
    },
);

test(
    'With the Layers and a photo docked, the focused skip link covers neither heading',
    { tag: '@S-V14-BAD-SKIP-LINK-THREE-PANES' },
    async ({ page, lang }) => {
        await page.setViewportSize(EXTRA_LARGE);
        await openViewer(page, { lang, hash: `18/44.42955/26.09560&photo=${LONE}` });
        await expect(viewer(page).locator('.frame')).toHaveAttribute('data-panes', 'both');

        await expectSkipLinkClearOf(page, lang, [t(lang, 'layers.title'), LONE_TITLE]);
    },
);

test('Enter or Space on the focused map opens the photo at its centre', { tag: '@S-V14-HAPPY-MAP-KEYBOARD' }, async ({ page, lang }) => {
    await openViewer(page, { lang, hash: '18/44.429359/26.095447' });
    const canvas = viewer(page).locator('canvas.mapboxgl-canvas');

    await canvas.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: LONE_TITLE })).toBeVisible();
    await expect.poll(async () => (await page.evaluate(() => location.hash)).includes(`photo=${LONE}`)).toBe(true);

    await page
        .getByRole('button', { name: t(lang, 'action.close'), exact: true })
        .filter({ visible: true })
        .first()
        .click();
    await expect(page.getByRole('heading', { name: LONE_TITLE })).toHaveCount(0);
    await canvas.focus();
    await page.keyboard.press(' ');
    await expect(page.getByRole('heading', { name: LONE_TITLE })).toBeVisible();
});

test(
    'Enter on the focused map with nothing at its centre does nothing and keeps the focus',
    { tag: '@S-V14-BAD-NOTHING-UNDER-CENTRE' },
    async ({ page, lang }) => {
        await openViewer(page, { lang, hash: EMPTY_VIEW });
        const canvas = viewer(page).locator('canvas.mapboxgl-canvas');

        await canvas.focus();
        await page.keyboard.press('Enter');
        await page.keyboard.press(' ');

        await expect(canvas).toBeFocused();
        await expect(page.getByRole('dialog')).toHaveCount(0);
        await expect(page.getByRole('heading', { level: 2 })).toHaveCount(0);
        expect(await page.evaluate(() => location.hash)).not.toContain('photo=');
    },
);

test(
    'Shift+Tab right after a modal sheet takes the focus stays inside the sheet',
    { tag: '@S-V14-BAD-MODAL-TAB-WRAP' },
    async ({ page, lang }) => {
        await openViewer(page, { lang, hash: '18/44.429359/26.095447' });
        const canvas = viewer(page).locator('canvas.mapboxgl-canvas');
        await canvas.focus();
        await page.keyboard.press('Enter');
        await expect(page.getByRole('heading', { name: LONE_TITLE })).toBeVisible();
        // Below 760 px the photo opens in a modal sheet that focuses itself; wider, it is a docked pane beside the map.
        const sheet = viewer(page).locator('hcm-photo-sheet hcm-sheet[open]');

        await page.keyboard.press('Shift+Tab');
        await expectFocusAfterShiftTab(page, sheet, canvas);
    },
);

/**
 * After Shift+Tab: below 760 px the photo's modal sheet keeps the focus, and Escape closes it and gives the focus back
 * to the map; wider, the photo is a docked pane beside the map, which stays open.
 */
async function expectFocusAfterShiftTab(page: Page, sheet: Locator, canvas: Locator): Promise<void> {
    if (isDocked(page)) {
        await expect(sheet).toHaveCount(0);
        await expect(page.getByRole('heading', { name: LONE_TITLE })).toBeVisible();
        return;
    }
    await expect
        .poll(() => sheet.evaluate((element) => element.matches(':focus-within')), {
            message: 'the focus stays in the modal sheet',
        })
        .toBe(true);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('heading', { name: LONE_TITLE })).toHaveCount(0);
    await expect(canvas).toBeFocused();
}
