import type { Locale } from '@hcm/shared';
import type { Page } from '@playwright/test';

import { overlaps, visibleBoxes, type Box } from '../../support/layout.js';
import { mapFraction } from '../../support/map.js';
import { expect, test } from '../../support/test.js';
import { openViewer, t, viewer } from '../../support/viewer.js';

/**
 * V67 (the owner's V12, 2026-11-13): on a phone the timeline rests collapsed to the pill of its year and opens on a tap;
 * it covers nothing: the compass, the zoom group, the menu button, the chip or Mapbox's logo and attribution, upright or
 * on its side, down to 568 x 270. A press back on the map, or Esc, collapses it; a larger window never does.
 */

const VIEW_1966 = '16/44.44763/26.13822&layers=e2e-1966';
const FLOATING = [
    '[data-layout-check="timeline"]',
    '[data-layout-check="near-year"]',
    '[data-layout-check="menu"]',
    '[data-layout-check="zoom"]',
    'hcm-compass',
    '.mapboxgl-ctrl-attrib',
    'a.mapboxgl-ctrl-logo',
];

function slider(page: Page, lang: Locale) {
    return page.getByRole('slider', { name: t(lang, 'timeline.label'), exact: true });
}

async function timelineBox(page: Page): Promise<Box> {
    const [box] = await visibleBoxes(page, ['hcm-timeline']);
    expect(box, 'the timeline is shown').toBeDefined();
    return box ?? { name: 'hcm-timeline', x: 0, y: 0, width: 0, height: 0 };
}

async function expectClear(page: Page): Promise<void> {
    const boxes = await visibleBoxes(page, FLOATING);
    expect(boxes.map((box) => box.name)).toContain('timeline');
    expect(overlaps(boxes)).toEqual([]);
}

test('On a phone the timeline rests as its year pill and opens on a tap', { tag: '@S-V67-HAPPY-PILL-ON-PHONE' }, async ({ page, lang }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openViewer(page, { lang, hash: VIEW_1966 });
    const year = t(lang, 'timeline.year', { year: '1966' });

    await expect(viewer(page).locator('hcm-timeline')).toHaveAttribute('collapsed');
    const pill = await timelineBox(page);
    expect(Math.round(pill.height)).toBe(64);
    expect(pill.width).toBeGreaterThanOrEqual(96);
    expect(Math.round(pill.x)).toBe(16);
    await expect(slider(page, lang)).toHaveAttribute('aria-valuetext', year);
    await expectClear(page);

    await viewer(page).locator('hcm-timeline').click();
    await expect(viewer(page).locator('hcm-timeline')).not.toHaveAttribute('collapsed');
    const card = await timelineBox(page);
    expect(card.height).toBeGreaterThan(card.width);
    await expect(slider(page, lang)).toHaveAttribute('aria-valuetext', year);
    await expectClear(page);

    const map = await mapFraction(page, 0.6, 0.4);
    await page.mouse.click(map.x, map.y);
    await expect(viewer(page).locator('hcm-timeline')).toHaveAttribute('collapsed');
});

test(
    'On a short landscape phone the pill keeps the trailing foot, clear of the menu, the zoom, the compass and the legal line',
    { tag: '@S-V67-HAPPY-PILL-LANDSCAPE' },
    async ({ page, lang }) => {
        for (const size of [
            { width: 915, height: 412 },
            { width: 568, height: 270 },
        ]) {
            await page.setViewportSize(size);
            await openViewer(page, { lang, hash: VIEW_1966 });
            await expect(viewer(page).locator('hcm-timeline')).toHaveAttribute('collapsed');
            const pill = await timelineBox(page);
            expect(pill.height).toBe(64);
            expect(pill.x + pill.width, 'on the trailing side').toBeGreaterThan(size.width / 2);
            await expectClear(page);
        }
    },
);

test(
    'Esc collapses the open card with the focus kept; a larger window never collapses it',
    { tag: '@S-V67-BAD-ESC-AND-LARGE-WINDOW' },
    async ({ page, lang }) => {
        await page.setViewportSize({ width: 360, height: 800 });
        await openViewer(page, { lang, hash: VIEW_1966 });
        await page.getByRole('button', { name: t(lang, 'viewer.skipToTimeline') }).focus();
        await page.keyboard.press('Enter');
        await expect(viewer(page).locator('hcm-timeline')).not.toHaveAttribute('collapsed');
        await expect(slider(page, lang)).toBeFocused();

        await page.keyboard.press('Escape');
        await expect(viewer(page).locator('hcm-timeline')).toHaveAttribute('collapsed');
        await expect(slider(page, lang)).toBeFocused();
        await page.keyboard.press('ArrowUp');
        await expect(slider(page, lang)).toHaveAttribute('aria-valuetext', t(lang, 'timeline.year', { year: '1980' }));

        await page.setViewportSize({ width: 1280, height: 800 });
        await expect(viewer(page).locator('hcm-timeline')).not.toHaveAttribute('collapsed');
        const map = await mapFraction(page, 0.5, 0.3);
        await page.mouse.click(map.x, map.y);
        await expect(viewer(page).locator('hcm-timeline')).not.toHaveAttribute('collapsed');
        expect((await timelineBox(page)).width).toBeGreaterThan(300);
    },
);
