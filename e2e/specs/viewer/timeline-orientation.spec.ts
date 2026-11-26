import type { Page } from '@playwright/test';

import { siteManifestData } from '../../fixtures/manifest.js';
import { E2E_XYZ_LAYER } from '../../fixtures/world.js';
import { overlaps, visibleBoxes, type Box } from '../../support/layout.js';
import { expect, test } from '../../support/test.js';
import { menuButton, openTimelineCard, openViewer, serveManifest, t, viewer } from '../../support/viewer.js';

/**
 * The timeline's orientation (behaviour V04; the owner, 2026-11-08: "for phone or small width setup, maybe it would be
 * wise to show the timeline vertically" and "when height is short, we should display the timeline horizontally"): a
 * phone held upright stands it on the leading edge with the photos-near-the-year chip docked under its foot and the menu
 * button in the bottom trailing corner; a short window lays it at the foot of the map. The arrow keys follow it on
 * screen, and the selected year's pill never hides another year's label (his phone: "1980" over 1979 and 1982).
 */

const OBOR_VIEW = '16/44.44763/26.13822';
/** The owner's city on 2026-11-08: eleven layer years and today. */
const OWNERS_YEARS = [1966, 1967, 1972, 1976, 1977, 1978, 1979, 1980, 1982, 1983, 1984] as const;
/** The photos-near-the-year button: a text chip or an icon button (`viewer-near-year.ts`). */
const NEAR_YEAR = '.dock.chip [data-layout-check="near-year"]';
const FLOATING = ['[role="menu"]', NEAR_YEAR, 'hcm-timeline'];

function slider(page: Page, lang: 'ro' | 'en') {
    return page.getByRole('slider', { name: t(lang, 'timeline.label'), exact: true });
}

async function boxOf(page: Page, selector: string): Promise<Box> {
    const [box] = await visibleBoxes(page, [selector]);
    expect(box, `${selector} is shown`).toBeDefined();
    return box ?? { name: selector, x: 0, y: 0, width: 0, height: 0 };
}

/** Selects 1966, then walks to 1980 and back with the key that points the way the timeline lies. */
async function walk(page: Page, lang: 'ro' | 'en', later: string, earlier: string): Promise<void> {
    const thumb = slider(page, lang);
    await thumb.focus();
    await thumb.press('Home');
    await expect(thumb).toHaveAttribute('aria-valuetext', t(lang, 'timeline.year', { year: '1966' }));
    await thumb.press(later);
    await expect(thumb).toHaveAttribute('aria-valuetext', t(lang, 'timeline.year', { year: '1980' }));
    await thumb.press(earlier);
    await expect(thumb).toHaveAttribute('aria-valuetext', t(lang, 'timeline.year', { year: '1966' }));
}

/**
 * Opens the menu: its items cover neither the chip nor the timeline, and all of them are on screen. Upright the press
 * collapses the open card (V12) and its pill steps aside while the menu is open (`timeline-dock-styles.ts`): the menu and
 * the chip remain.
 */
async function expectOpenMenuClear(page: Page, lang: 'ro' | 'en'): Promise<void> {
    await menuButton(page, lang).click();
    await expect(page.getByRole('menu', { name: t(lang, 'action.menu') })).toBeVisible();
    const boxes = await visibleBoxes(page, FLOATING);
    expect(boxes).toHaveLength(2);
    expect(overlaps(boxes)).toEqual([]);
    const menu = await boxOf(page, '[role="menu"]');
    expect(menu.y).toBeGreaterThanOrEqual(0);
}

/**
 * On a short window the open menu's rows take the map's width (P1, the Pixel 9 Pro on its side): the card and the chip
 * step aside while it is open (`dock-styles.ts`) and come back when it closes; the menu stays on screen.
 */
async function expectOpenMenuAlone(page: Page, lang: 'ro' | 'en'): Promise<void> {
    await menuButton(page, lang).click();
    await expect(page.getByRole('menu', { name: t(lang, 'action.menu') })).toBeVisible();
    expect(await visibleBoxes(page, FLOATING), 'only the menu while it is open').toHaveLength(1);
    const menu = await boxOf(page, '[role="menu"]');
    expect(menu.y).toBeGreaterThanOrEqual(0);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu', { name: t(lang, 'action.menu') })).toBeHidden();
    expect(await visibleBoxes(page, FLOATING)).toHaveLength(2);
}

test(
    'On a phone held upright the timeline stands on the leading edge with the chip under it',
    { tag: '@S-V04-HAPPY-VERTICAL-ON-PHONE' },
    async ({ page, lang }) => {
        await page.setViewportSize({ width: 375, height: 812 });
        await openViewer(page, { lang, hash: OBOR_VIEW });
        await openTimelineCard(page);
        await expect(slider(page, lang)).toHaveAttribute('aria-orientation', 'vertical');

        await walk(page, lang, 'ArrowUp', 'ArrowDown');
        const timeline = await boxOf(page, 'hcm-timeline');
        const chip = await boxOf(page, NEAR_YEAR);
        const fab = (await menuButton(page, lang).boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 };
        expect(timeline.height).toBeGreaterThan(timeline.width);
        expect(Math.abs(timeline.x - 16), 'on the leading edge').toBeLessThanOrEqual(1);
        // An icon button centred under the card (the owner, 2026-11-12: no text pill on a phone).
        expect(Math.abs(chip.x + chip.width / 2 - (timeline.x + timeline.width / 2)), 'centred under the card').toBeLessThanOrEqual(1);
        expect(Math.abs(chip.y - (timeline.y + timeline.height) - 8), '8 px under its foot').toBeLessThanOrEqual(1);
        expect(Math.abs(375 - 16 - (fab.x + fab.width)), 'the menu button on the trailing edge').toBeLessThanOrEqual(1);
        expect(fab.y, 'the menu button below the chip').toBeGreaterThanOrEqual(chip.y + chip.height + 8);

        await expectOpenMenuClear(page, lang);
    },
);

test(
    'A short window lays the timeline at the foot of the map, the chip on its trailing edge',
    { tag: '@S-V04-BAD-HORIZONTAL-WHEN-SHORT' },
    async ({ page, lang }) => {
        await page.setViewportSize({ width: 915, height: 412 });
        await openViewer(page, { lang, hash: OBOR_VIEW });
        await openTimelineCard(page);
        await expect(slider(page, lang)).toHaveAttribute('aria-orientation', 'horizontal');

        await walk(page, lang, 'ArrowRight', 'ArrowLeft');
        const timeline = await boxOf(page, 'hcm-timeline');
        const chip = await boxOf(page, NEAR_YEAR);
        expect(timeline.width).toBeGreaterThan(timeline.height);
        expect(Math.abs(chip.x + chip.width - (timeline.x + timeline.width)), "on the card's trailing edge").toBeLessThanOrEqual(1);
        expect(Math.abs(timeline.y - (chip.y + chip.height) - 8), '8 px above the card').toBeLessThanOrEqual(1);

        await expectOpenMenuAlone(page, lang);
    },
);

/** Whether `box` holds the point. */
function holds(box: Box, point: { readonly x: number; readonly y: number }): boolean {
    return box.x <= point.x && point.x <= box.x + box.width && box.y <= point.y && point.y <= box.y + box.height;
}

test(
    "On a narrow short phone the chip ends at the gutter, off the map's centre and clear of the open menu",
    { tag: '@S-V04-BAD-NARROW-SHORT-CHIP' },
    async ({ page, lang }) => {
        // The review at 568 x 320: the chip sat on the map's centre point and the open three-column menu covered it.
        await page.setViewportSize({ width: 568, height: 320 });
        await openViewer(page, { lang, hash: OBOR_VIEW });
        await openTimelineCard(page);
        await expect(slider(page, lang)).toHaveAttribute('aria-orientation', 'horizontal');
        await slider(page, lang).focus();
        await slider(page, lang).press('Home');

        const timeline = await boxOf(page, 'hcm-timeline');
        const chip = await boxOf(page, NEAR_YEAR);
        expect(Math.abs(chip.x + chip.width - (timeline.x + timeline.width)), "on the card's trailing edge").toBeLessThanOrEqual(1);
        expect(Math.abs(568 - 16 - (chip.x + chip.width)), 'the card and the chip end at the gutter').toBeLessThanOrEqual(1);
        expect(holds(chip, { x: 284, y: 160 }), "the chip on the map's centre").toBe(false);

        await expectOpenMenuAlone(page, lang);
    },
);

/** `years` as stops: the fixture's two layers and the other years drawn by the 1980 layer's tiles. */
function manifestOf(years: readonly number[]): Record<string, unknown> {
    const manifest = siteManifestData();
    const served = manifest['layers'] as Record<string, unknown>[];
    const xyz = served.find((layer) => layer['id'] === E2E_XYZ_LAYER.id) ?? {};
    const extra = years
        .filter((year) => !served.some((layer) => layer['year'] === year))
        .map((year) => ({
            ...xyz,
            id: `e2e-${String(year)}`,
            year,
            label: { ro: `Strat ${String(year)} (e2e)`, en: `Layer ${String(year)} (e2e)` },
        }));
    const layers = [...served, ...extra].map((layer, order) => ({ ...layer, order: order + 1 }));
    return { ...manifest, layers };
}

/** In the page: the labels the selected year's pill covers, by year (none expected). */
async function coveredLabels(page: Page): Promise<string[]> {
    return viewer(page)
        .locator('hcm-timeline')
        .evaluate((element) => {
            const root = element.shadowRoot;
            const thumb = root?.querySelector('.thumb')?.getBoundingClientRect();
            const stops = [...(root?.querySelectorAll('.stop') ?? [])];
            return stops
                .filter((stop) => !stop.classList.contains('selected'))
                .map((stop) => ({ text: stop.textContent.trim(), box: stop.querySelector('.label')?.getBoundingClientRect() }))
                .filter(({ box }) => {
                    if (thumb === undefined || box === undefined) {
                        return false;
                    }
                    return (
                        box.left < thumb.right - 1 && thumb.left < box.right - 1 && box.top < thumb.bottom - 1 && thumb.top < box.bottom - 1
                    );
                })
                .map(({ text }) => text);
        });
}

test(
    "The selected year's pill hides no other year's label, upright, short or wide",
    { tag: '@S-V04-BAD-PILL-HIDES-NO-LABEL' },
    async ({ page, lang }) => {
        // The springs off: each box is measured where the pill lands.
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await serveManifest(page, manifestOf(OWNERS_YEARS));
        for (const size of [
            { width: 320, height: 568 },
            { width: 375, height: 812 },
            { width: 915, height: 412 },
        ]) {
            await page.setViewportSize(size);
            await openViewer(page, { lang, hash: OBOR_VIEW });
            await openTimelineCard(page);
            await openTimelineCard(page);
            const thumb = slider(page, lang);
            await expect(thumb).toHaveAttribute('aria-valuemax', String(OWNERS_YEARS.length));
            await thumb.focus();
            await thumb.press('Home');
            for (const year of [...OWNERS_YEARS.map(String), t(lang, 'timeline.present')]) {
                await expect(viewer(page).locator('hcm-timeline .thumb-label')).toHaveText(year);
                expect(await coveredLabels(page), `${String(size.width)}x${String(size.height)} at ${year}`).toEqual([]);
                await thumb.press('ArrowUp');
            }
        }
    },
);

interface CardView {
    /** The thumb is inside the card. */
    readonly inView: boolean;
    /** The labels shown that meet the pill or another label. */
    readonly crowded: readonly string[];
    /** The labels shown that stick out of the card (the Pixel Tablet: 1847 clipped to "7"). */
    readonly clipped: readonly string[];
    readonly labelled: number;
    readonly scrolls: boolean;
    readonly density: string;
    readonly touchAction: string;
    readonly fade: { readonly start: string; readonly end: string };
}

/** In the page: the timeline's card as a visitor sees it. */
async function cardView(page: Page): Promise<CardView> {
    return viewer(page)
        .locator('hcm-timeline')
        .evaluate((element) => {
            const meets = (a: DOMRect, b: DOMRect) =>
                a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
            const inside = (a: DOMRect, b: DOMRect) => a.left >= b.left && a.right <= b.right && a.top >= b.top && a.bottom <= b.bottom;
            const root = element.shadowRoot;
            const view = element.getBoundingClientRect();
            const thumb = root?.querySelector('.thumb')?.getBoundingClientRect() ?? view;
            const scroller = root?.querySelector<HTMLElement>('.scroller') ?? element;
            const shown = [...(root?.querySelectorAll('.stop:not(.selected):not(.minor) .label') ?? [])].map((label) => ({
                text: label.textContent,
                box: label.getBoundingClientRect(),
            }));
            const scrollerBox = scroller.getBoundingClientRect();
            const crowded = shown.filter(
                ({ box }, at) => meets(box, thumb) || shown.some((other, otherAt) => otherAt !== at && meets(box, other.box)),
            );
            const scrolls = scroller.scrollWidth > scroller.clientWidth || scroller.scrollHeight > scroller.clientHeight;
            return {
                inView: inside(thumb, view),
                crowded: crowded.map(({ text }) => text),
                // A scrolling card hides what lies beyond its edges on purpose, behind its fade (a label may straddle it):
                // only a card that fits can clip a label (the Pixel Tablet's "7").
                clipped: scrolls ? [] : shown.filter(({ box }) => meets(box, scrollerBox) && !inside(box, view)).map(({ text }) => text),
                labelled: shown.length,
                scrolls,
                density: element.getAttribute('density') ?? '',
                touchAction: getComputedStyle(element).touchAction,
                fade: {
                    start: scroller.style.getPropertyValue('--hcm-fade-start'),
                    end: scroller.style.getPropertyValue('--hcm-fade-end'),
                },
            };
        });
}

/** Phones upright and on their side (the Pixel 9 Pro's own: P5, "Azi" off the right edge), the tablet both ways, a desktop. */
const CARD_SIZES = [
    { width: 360, height: 800 },
    { width: 426, height: 803 },
    { width: 568, height: 320 },
    { width: 884, height: 322 },
    { width: 800, height: 1280 },
    { width: 1280, height: 800 },
    { width: 1440, height: 900 },
] as const;

test(
    'Twenty-two years each have a label 40 px apart, none clipped or crowded, scrolling where they do not fit, on a phone, a tablet and a desktop',
    { tag: '@S-V04-BAD-MANY-YEARS-FIT' },
    async ({ page, lang }) => {
        // The Pixel Tablet, 2026-11-12: at 30 px per gap twenty-two stops overflowed the card and 1847 showed as "7"; the owner,
        // 2026-11-14: "too crowded", only the years, no dots: every year labelled, and the card scrolls where they do not fit.
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await serveManifest(page, manifestOf(Array.from({ length: 21 }, (_, at) => 1964 + at)));
        for (const size of CARD_SIZES) {
            await page.setViewportSize(size);
            await openViewer(page, { lang, hash: OBOR_VIEW });
            await openTimelineCard(page);
            await openTimelineCard(page);
            const thumb = slider(page, lang);
            await expect(thumb).toHaveAttribute('aria-valuemax', '21');
            await thumb.focus();
            for (const [key, index] of [
                ['Home', '0'],
                ['End', '21'],
            ] as const) {
                await thumb.press(key);
                await expect(thumb).toHaveAttribute('aria-valuenow', index);
                const where = `${String(size.width)}x${String(size.height)} after ${key}`;
                const view = await cardView(page);
                expect(view.scrolls, `${where}: the track scrolls only when it does not fit`).toBe(view.density === 'scroll');
                expect(view.inView, `${where}: the thumb in view`).toBe(true);
                expect(view.clipped, `${where}: clipped labels`).toEqual([]);
                expect(view.crowded, `${where}: crowded labels`).toEqual([]);
                expect(view.labelled, `${where}: every year named`).toBe(21);
            }
        }
    },
);

/**
 * How a scrolling card lies or stands: the scroll starts at the leading edge lying and at the top (today) standing, so
 * after Home or End the far years fade at that end; a finger scrolls it along the timeline.
 */
const LYING = { faded: { Home: 'end', End: 'start' }, touchAction: 'pan-x' } as const;
const STANDING = { faded: { Home: 'start', End: 'end' }, touchAction: 'pan-y' } as const;

test(
    'With more years than the card holds the timeline scrolls under a finger, its edge fades and the selected year stays in view',
    { tag: '@S-V04-BAD-MANY-YEARS-SCROLL' },
    async ({ page, lang }) => {
        // The review, 2026-11-08: stops squeezed 17 px apart; the device test, 2026-11-12: the track could not be scrolled by finger.
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await serveManifest(page, manifestOf(Array.from({ length: 61 }, (_, at) => 1924 + at)));
        for (const { pose, ...size } of [
            { width: 320, height: 568, pose: STANDING },
            { width: 568, height: 320, pose: LYING },
            { width: 768, height: 1024, pose: LYING },
        ]) {
            await page.setViewportSize(size);
            await openViewer(page, { lang, hash: OBOR_VIEW });
            await openTimelineCard(page);
            await openTimelineCard(page);
            const thumb = slider(page, lang);
            await expect(thumb).toHaveAttribute('aria-valuemax', '61');
            await thumb.focus();
            for (const [key, index] of [
                ['Home', '0'],
                ['End', '61'],
                ['Home', '0'],
            ] as const) {
                const faded = pose.faded[key];
                await thumb.press(key);
                await expect(thumb).toHaveAttribute('aria-valuenow', index);
                const where = `${String(size.width)}x${String(size.height)} after ${key}`;
                await expect.poll(async () => (await cardView(page)).inView, `${where}: the thumb in view`).toBe(true);
                await expect.poll(async () => (await cardView(page)).fade[faded], `${where}: the ${faded} fades`).toBe('56px');
                const view = await cardView(page);
                expect(view.scrolls, `${where}: the card scrolls`).toBe(true);
                expect(view.touchAction, `${where}: a finger scrolls it`).toBe(pose.touchAction);
                expect(view.crowded, `${where}: crowded labels`).toEqual([]);
            }
        }
    },
);
