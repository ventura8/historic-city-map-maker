import type { Page } from '@playwright/test';

import { siteManifestData } from '../../fixtures/manifest.js';
import { BASEMAP_BACKGROUND, E2E_TILESET_LAYER, E2E_XYZ_LAYER } from '../../fixtures/world.js';
import { isOnTop, overlaps, visibleBoxes } from '../../support/layout.js';
import { blend, expectColourAt, mapFraction, mapIdle, renderedFeatureIds } from '../../support/map.js';
import { sitePath } from '../../support/site.js';
import { expect, test } from '../../support/test.js';
import {
    callController,
    hashParam,
    isDocked,
    menuButton,
    openLayers,
    openTimelineCard,
    openViewer,
    serveManifest,
    t,
    viewer,
    waitForEngineEvent,
} from '../../support/viewer.js';

/**
 * The timeline (behaviour V04): its stops are the layer years plus "today"; choosing a stop shows that year's layer
 * and keeps every photo marker on the map (the year stays in each photo's details), and a year without a layer snaps to the
 * nearest stop. A city without layers (Bucharest until M3) shows a note instead.
 */

/** The fixture's photos dated within 10 years of 1966 (the Bucharest seed has two, both of 1960). */
const PHOTOS_NEAR_1966: readonly string[] = (siteManifestData()['photos'] as { id: string; year?: number }[])
    .filter((photo) => photo.year !== undefined && Math.abs(photo.year - 1966) <= 10)
    .map((photo) => photo.id);

/** Two photos at Obor: `ferdinand` (1960, near the 1966 stop) and `parcul-ferdinand-1930` (near no stop). */
const OBOR_VIEW = '16/44.44763/26.13822';
const NEAR_1966 = 'ferdinand';
const NEAR_NO_STOP = 'parcul-ferdinand-1930';

function timelineSlider(page: Page, lang: 'ro' | 'en') {
    return page.getByRole('slider', { name: t(lang, 'timeline.label'), exact: true });
}

test('Choosing a stop shows its layer and every photo', { tag: ['@S-V04-HAPPY', '@S-V04-HAPPY-PHOTOS-EVERY-YEAR'] }, async ({ page, lang }) => {
    await openViewer(page, { lang, hash: OBOR_VIEW });
    const probe = await mapFraction(page, 0.5, 0.12);
    const slider = timelineSlider(page, lang);
    await expect.poll(() => renderedFeatureIds(page, 'hcm-photos-marker')).toEqual(expect.arrayContaining([NEAR_1966, NEAR_NO_STOP]));
    await expectColourAt(page, probe, BASEMAP_BACKGROUND, 'today shows no historical layer');

    await slider.focus();
    await slider.press('Home');
    await expect(slider).toHaveAttribute('aria-valuetext', t(lang, 'timeline.year', { year: '1966' }));
    await expectColourAt(page, probe, E2E_TILESET_LAYER.colour, 'the 1966 layer');
    // Every photo stays on the map whatever the year (the owner, 2026-11-15, S-V04-HAPPY-PHOTOS-EVERY-YEAR).
    await expect.poll(() => renderedFeatureIds(page, 'hcm-photos-marker')).toEqual(expect.arrayContaining([NEAR_1966, NEAR_NO_STOP]));
    await expect.poll(() => hashParam(page, 'layers')).toBe(E2E_TILESET_LAYER.id);

    await slider.press('ArrowRight');
    await expect(slider).toHaveAttribute('aria-valuetext', t(lang, 'timeline.year', { year: '1980' }));
    await expectColourAt(page, probe, blend(E2E_XYZ_LAYER.colour, BASEMAP_BACKGROUND, 0.8), 'the 1980 layer at its default 80 %');
    await expect.poll(() => renderedFeatureIds(page, 'hcm-photos-marker')).toEqual(expect.arrayContaining([NEAR_1966, NEAR_NO_STOP]));

    await slider.press('End');
    await expect(slider).toHaveAttribute('aria-valuetext', t(lang, 'timeline.present'));
    await expectColourAt(page, probe, BASEMAP_BACKGROUND, 'today again');
    await expect.poll(() => renderedFeatureIds(page, 'hcm-photos-marker')).toEqual(expect.arrayContaining([NEAR_1966, NEAR_NO_STOP]));
});

test('A year without a layer snaps to the nearest stop', { tag: '@S-V04-BAD-YEAR-WITHOUT-LAYER' }, async ({ page, lang }) => {
    await openViewer(page, { lang, hash: OBOR_VIEW });
    const slider = timelineSlider(page, lang);

    await callController(page, 'setYear', 1972);
    await expect(slider).toHaveAttribute('aria-valuetext', t(lang, 'timeline.year', { year: '1966' }));
    await expect.poll(() => hashParam(page, 'layers')).toBe(E2E_TILESET_LAYER.id);
    await callController(page, 'setYear', 1975);
    await expect(slider).toHaveAttribute('aria-valuetext', t(lang, 'timeline.year', { year: '1980' }));
    await expect.poll(() => hashParam(page, 'layers')).toBe(E2E_XYZ_LAYER.id);

    // A tap between two stops on the track lands on the nearer one (a fifth of the way from 1966: up a phone's standing one).
    await openTimelineCard(page);
    const track = viewer(page).locator('hcm-timeline .track');
    const box = (await track.boundingBox()) ?? EMPTY_BOX;
    expect(box.width).toBeGreaterThan(0);
    const standing = box.height > box.width;
    await page.mouse.click(box.x + box.width * (standing ? 0.5 : 0.2), box.y + box.height * (standing ? 0.8 : 0.5));
    await expect(slider).toHaveAttribute('aria-valuetext', t(lang, 'timeline.year', { year: '1966' }));
    await expect(slider).toHaveAttribute('aria-valuemax', '2');
});

test(
    'A stop with photos near its year offers them in a chip; today offers none',
    { tag: '@S-V04-HAPPY-PHOTOS-NEAR-YEAR' },
    async ({ page, lang }) => {
        await openViewer(page, { lang, hash: OBOR_VIEW });
        const chip = page.getByRole('button', { name: t(lang, 'photos.nearYear', { year: '1966' }) });
        await expect(page.getByRole('button', { name: /1966|1980/ })).toHaveCount(0);

        const slider = timelineSlider(page, lang);
        await slider.focus();
        await slider.press('Home');
        await chip.click();
        const sheet = page.getByRole(viewportIsDocked(page) ? 'region' : 'dialog', { name: t(lang, 'photos.nearYear', { year: '1966' }) });
        await expect(sheet).toBeVisible();
        // The list is slotted into the sheet (a modal sheet's dialog is in its shadow root), so it is found by its own name.
        const list = viewer(page).locator('.photos-sheet hcm-photo-list');
        await expect(list.getByRole('status')).toHaveText(
            t(lang, lang === 'ro' ? 'photos.count.few' : 'photos.count.other', { count: String(PHOTOS_NEAR_1966.length) }),
        );
        await expect(list.getByRole('list', { name: t(lang, 'photos.list') }).getByRole('button')).toHaveCount(PHOTOS_NEAR_1966.length);

        await page.keyboard.press('Escape');
        await slider.focus();
        await slider.press('End');
        await expect(page.getByRole('button', { name: t(lang, 'photos.nearYear', { year: '1966' }) })).toHaveCount(0);
    },
);

/** The boxes of the photos-near-the-year chip and of the timeline card, both visible. */
async function chipAndTimeline(page: Page): Promise<{ chip: Box; timeline: Box }> {
    const chip = await viewer(page).locator('.dock.chip [data-layout-check="near-year"]').boundingBox();
    const timeline = await viewer(page).locator('hcm-timeline').boundingBox();
    expect(chip, 'the chip is shown').not.toBeNull();
    expect(timeline, 'the timeline is shown').not.toBeNull();
    return { chip: chip ?? EMPTY_BOX, timeline: timeline ?? EMPTY_BOX };
}

interface Box {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

const EMPTY_BOX: Box = { x: 0, y: 0, width: 0, height: 0 };

/**
 * The chip is part of the timeline (the owner, 2026-11-08: "it looks like it is floating around"): on a phone held
 * upright an icon button 8 px under the standing card's foot, centred on it; elsewhere 8 px above the lying card, on its
 * leading edge, or its trailing one on a short window, whose menu opens on the leading side.
 */
async function expectChipOnTheTimeline(page: Page): Promise<void> {
    const { chip, timeline } = await chipAndTimeline(page);
    // Standing, as a card or as its pill (V67).
    if ((await viewer(page).locator('hcm-timeline').getAttribute('orientation')) === 'vertical') {
        expect(
            Math.abs(chip.x + chip.width / 2 - (timeline.x + timeline.width / 2)),
            "on the standing timeline's axis",
        ).toBeLessThanOrEqual(1);
        expect(Math.abs(chip.y - (timeline.y + timeline.height) - 8), '8 px under its foot').toBeLessThanOrEqual(1);
        return;
    }
    if ((page.viewportSize()?.height ?? 0) < 480) {
        expect(Math.abs(chip.x + chip.width - (timeline.x + timeline.width)), "on the timeline's trailing edge").toBeLessThanOrEqual(1);
    } else {
        expect(Math.abs(chip.x - timeline.x), "on the timeline's leading edge").toBeLessThanOrEqual(1);
    }
    expect(Math.abs(timeline.y - (chip.y + chip.height) - 8), 'right above the timeline').toBeLessThanOrEqual(1);
}

/** The owner's screenshot: with a pane docked the map is narrower and the card centred in what is left. */
async function openLayersWhereDocked(page: Page, lang: 'ro' | 'en'): Promise<void> {
    if (viewportIsDocked(page)) {
        await openLayers(page, lang);
    }
}

/**
 * The open menu leaves the chip uncovered: from 600 px its items end 8 px above the lying timeline; on a phone held upright
 * they begin above the chip's row (the owner's phone: the last item covered the chip's end).
 */
async function expectOpenMenuLeavesTheChip(page: Page, lang: 'ro' | 'en'): Promise<void> {
    await menuButton(page, lang).click();
    await expect(page.getByRole('menu', { name: t(lang, 'action.menu') })).toBeVisible();
    await expect(isOnTop(viewer(page).locator('.dock.chip [data-layout-check="near-year"]'))).resolves.toBe(true);
}

test(
    'The photos-near-the-year chip sits on the timeline at every layout',
    { tag: '@S-V04-HAPPY-CHIP-ON-TIMELINE' },
    async ({ page, lang }) => {
        await openViewer(page, { lang, hash: OBOR_VIEW });
        await timelineSlider(page, lang).focus();
        await timelineSlider(page, lang).press('Home');
        await expect(page.getByRole('button', { name: t(lang, 'photos.nearYear', { year: '1966' }) })).toBeVisible();
        await openLayersWhereDocked(page, lang);
        await expectChipOnTheTimeline(page);

        await page.setViewportSize({ width: 915, height: 412 });
        // The viewer measures its own box: wait for the short window's layout before measuring the chip.
        await expect(viewer(page).locator('.frame')).toHaveAttribute('data-compact-height', '');
        await expect(viewer(page).locator('hcm-timeline')).toHaveAttribute('orientation', 'horizontal');
        // A docked Layers pane becomes a modal side sheet there: the map pane widens while the sheet slides in.
        await expect(async () => {
            await expectChipOnTheTimeline(page);
        }).toPass();
    },
);

test(
    'The chip never floats alone: none at today or at a year without photos, and the open menu leaves it uncovered',
    { tag: '@S-V04-BAD-CHIP-NEVER-ALONE' },
    async ({ page, lang }) => {
        // The photos taken within 10 years of 1980 move to 1930, near no stop (removing them would orphan the places' links).
        const manifest = siteManifestData();
        const photos = manifest['photos'] as { year?: number }[];
        manifest['photos'] = photos.map((photo) =>
            photo.year !== undefined && Math.abs(photo.year - 1980) <= 10 ? { ...photo, year: 1930 } : photo,
        );
        await serveManifest(page, manifest);
        await openViewer(page, { lang, hash: OBOR_VIEW });
        const chip = viewer(page).locator('.dock.chip');
        await expect(chip).toHaveCount(0);

        const slider = timelineSlider(page, lang);
        await slider.focus();
        await slider.press('Home');
        await slider.press('ArrowRight');
        await expect(slider).toHaveAttribute('aria-valuetext', t(lang, 'timeline.year', { year: '1980' }));
        await expect(chip).toHaveCount(0);

        await slider.press('Home');
        await expect(chip).toHaveCount(1);
        await expectChipOnTheTimeline(page);
        await expectOpenMenuLeavesTheChip(page, lang);
    },
);

const PHONE = { width: 390, height: 844 };

test(
    'On a phone held upright the chip is an icon button under the timeline, named in full',
    { tag: '@S-V04-HAPPY-PHONE-ICON-CHIP' },
    async ({ page, lang }, testInfo) => {
        await page.setViewportSize(PHONE);
        await openViewer(page, { lang, hash: OBOR_VIEW });
        await expect(viewer(page).locator('hcm-timeline')).toHaveAttribute('orientation', 'vertical');
        const slider = timelineSlider(page, lang);
        await slider.focus();
        await slider.press('Home');
        const name = t(lang, 'photos.nearYear', { year: '1966' });
        const button = page.getByRole('button', { name, exact: true });

        await expect(button).toBeVisible();
        const host = viewer(page).locator('.dock.chip hcm-icon-button');
        await expect(host).toHaveAttribute('title', name);
        await expect(host).toHaveAttribute('icon', 'photo_library');
        await expect(viewer(page).locator('.dock.chip')).not.toContainText(name);
        const { chip } = await chipAndTimeline(page);
        expect([chip.width, chip.height], 'a 40 px icon button, no text pill').toEqual([40, 40]);
        await expectChipOnTheTimeline(page);
        await page.screenshot({ path: testInfo.outputPath('phone-near-year.png') });

        await button.click();
        await expect(page.getByRole('dialog', { name })).toBeVisible();
    },
);

test(
    'On a phone no year, or a year without photos, shows no button; a wide window keeps the text chip',
    { tag: '@S-V04-BAD-PHONE-NO-YEAR-NO-BUTTON' },
    async ({ page, lang }) => {
        await page.setViewportSize(PHONE);
        await openViewer(page, { lang, hash: OBOR_VIEW });
        await expect(viewer(page).locator('hcm-timeline')).toHaveAttribute('orientation', 'vertical');
        const chip = viewer(page).locator('.dock.chip');
        // Today: the year is null.
        await expect(chip).toHaveCount(0);
        await expect(viewer(page).locator('[data-layout-check="near-year"]')).toHaveCount(0);

        const slider = timelineSlider(page, lang);
        await slider.focus();
        await slider.press('Home');
        await expect(chip.locator('hcm-icon-button')).toHaveCount(1);
        await slider.press('End');
        await expect(chip).toHaveCount(0);

        await slider.press('Home');
        await page.setViewportSize({ width: 1024, height: 768 });
        await expect(viewer(page).locator('hcm-timeline')).toHaveAttribute('orientation', 'horizontal');
        // A large window: the text chip under a mouse; a touch project's finger keeps the icon button (`(pointer: coarse)`).
        const name = t(lang, 'photos.nearYear', { year: '1966' });
        const finger = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
        await expect(chip.locator(finger ? 'hcm-icon-button' : 'hcm-button')).toHaveCount(1);
        await expect(chip.locator(finger ? 'hcm-button' : 'hcm-icon-button')).toHaveCount(0);
        await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
    },
);

test(
    'A tablet gets the icon button named in full, upright and on its side under a finger; only a mouse gets the text',
    { tag: '@S-V04-HAPPY-TABLET-ICON-CHIP' },
    async ({ page, lang }) => {
        // The owner, 2026-11-13: the text chip only on large screens; a tablet on its side is as wide as a laptop.
        const name = t(lang, 'photos.nearYear', { year: '1966' });
        const chip = viewer(page).locator('.dock.chip');
        const showsIcon = async (where: string): Promise<void> => {
            const button = page.getByRole('button', { name, exact: true });
            await expect(button, where).toBeVisible();
            await expect(chip.locator('hcm-icon-button'), where).toHaveAttribute('title', name);
            await expect(chip.locator('hcm-button'), where).toHaveCount(0);
            await expect(chip, where).not.toContainText(name);
        };

        await page.setViewportSize({ width: 800, height: 1280 });
        await openViewer(page, { lang, hash: OBOR_VIEW });
        const slider = timelineSlider(page, lang);
        await slider.focus();
        await slider.press('Home');
        await showsIcon('800x1280');

        await page.setViewportSize({ width: 1280, height: 800 });
        // A mouse sees the text there; a touch project's finger already keeps the icon button.
        const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
        await expect(chip.locator(coarse ? 'hcm-icon-button' : 'hcm-button')).toBeVisible();
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
        await cdp.send('Emulation.setEmitTouchEventsForMouse', { enabled: true, configuration: 'mobile' });
        await expect.poll(() => page.evaluate(() => matchMedia('(pointer: coarse)').matches), 'a finger').toBe(true);
        await showsIcon('1280x800, a finger');
    },
);

/** Windows from 760 px wide dock the sheets in a pane (a labelled region); narrower ones open modal dialogs. */
function viewportIsDocked(page: Page): boolean {
    return isDocked(page);
}

test(
    'Without historical layers a note replaces the timeline, clear of the menu',
    { tag: '@S-V04-HAPPY-NO-LAYERS-NOTE' },
    async ({ page, lang }) => {
        await serveManifest(page, siteManifestData({ layers: false }));
        await openViewer(page, { lang });

        await expect(timelineSlider(page, lang)).toHaveCount(0);
        const note = page.getByText(t(lang, 'timeline.empty'), { exact: true });
        await expect(note).toBeVisible();
        await expect(isOnTop(note)).resolves.toBe(true);
        await expect(isOnTop(menuButton(page, lang))).resolves.toBe(true);
        const boxes = await visibleBoxes(page, ['.dock.timeline-note .note', '.dock.menu hcm-fab-menu']);
        expect(boxes).toHaveLength(2);
        expect(overlaps(boxes)).toEqual([]);
    },
);

for (const size of [
    { width: 320, height: 568 },
    { width: 915, height: 412 },
]) {
    test(
        `The no-layers note leaves the menu, the logo and the attribution free at ${String(size.width)}x${String(size.height)}`,
        { tag: '@S-V04-BAD-NO-LAYERS-NOTE-LAYOUT' },
        async ({ page, lang }) => {
            await page.setViewportSize(size);
            await serveManifest(page, siteManifestData({ layers: false }));
            await page.goto(sitePath('bucharest', { lang }));
            await waitForEngineEvent(page, 'hcm-ready');
            await mapIdle(page);

            const note = page.getByText(t(lang, 'timeline.empty'), { exact: true });
            await expect(note).toBeVisible();
            const controls = [
                menuButton(page, lang),
                viewer(page).locator('a.mapboxgl-ctrl-logo'),
                viewer(page).locator('.mapboxgl-ctrl-attrib-button, .mapboxgl-ctrl-attrib').first(),
            ];
            for (const control of controls) {
                await expect(control).toBeVisible();
                await expect(isOnTop(control)).resolves.toBe(true);
            }
            const boxes = await visibleBoxes(page, [
                '.dock.timeline-note .note',
                '.dock.menu hcm-fab-menu',
                'a.mapboxgl-ctrl-logo',
                '.mapboxgl-ctrl-attrib',
            ]);
            expect(overlaps(boxes)).toEqual([]);
            const noteBox = await note.boundingBox();
            expect((noteBox?.x ?? -1) >= 0 && (noteBox?.x ?? 0) + (noteBox?.width ?? 0) <= size.width).toBe(true);
        },
    );
}

/**
 * The lying timeline takes the map's whole foot (the owner, 2026-11-14): from the leading gutter to the trailing column of
 * the menu button and the zoom group, never a narrower centred bar. Measured against the dock's containing block, the map
 * pane, so a docked pane narrows it with the map.
 */
async function expectTimelineFillsTheMap(page: Page): Promise<void> {
    const gaps = await viewer(page)
        .locator('.dock.timeline')
        .evaluate((dock) => {
            const pane = (dock as HTMLElement).offsetParent?.getBoundingClientRect();
            const card = dock.querySelector('hcm-timeline')?.getBoundingClientRect();
            const gutter = Number.parseFloat(getComputedStyle(dock).getPropertyValue('--hcm-gutter'));
            return pane && card ? { start: card.left - pane.left, end: pane.right - card.right, gutter } : undefined;
        });
    expect(gaps, 'the timeline and its map pane are measured').toBeDefined();
    expect(Math.abs((gaps?.start ?? 0) - (gaps?.gutter ?? 0)), 'from the leading gutter').toBeLessThanOrEqual(1);
    expect(Math.abs((gaps?.end ?? 0) - (gaps?.gutter ?? 0) - 72), "to the menu button's column").toBeLessThanOrEqual(1);
}

for (const width of [768, 1440, 2560]) {
    test(
        `The lying timeline spans the map's width at ${String(width)} px`,
        { tag: '@S-V04-HAPPY-TIMELINE-FULL-WIDTH' },
        async ({ page, lang }) => {
            await page.setViewportSize({ width, height: width === 768 ? 1024 : 900 });
            await openViewer(page, { lang, hash: OBOR_VIEW });
            await expect(viewer(page).locator('hcm-timeline')).toHaveAttribute('orientation', 'horizontal');
            await expect(async () => {
                await expectTimelineFillsTheMap(page);
            }).toPass();
        },
    );
}

test(
    'With the Layers pane docked the lying timeline spans the narrower map, never under the pane',
    { tag: '@S-V04-BAD-TIMELINE-UNDER-PANE' },
    async ({ page, lang }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await openViewer(page, { lang, hash: OBOR_VIEW });
        await openLayers(page, lang);
        await expect(async () => {
            await expectTimelineFillsTheMap(page);
        }).toPass();
        const pane = page.getByRole('region', { name: t(lang, 'layers.title') });
        const timeline = (await viewer(page).locator('hcm-timeline').boundingBox()) ?? EMPTY_BOX;
        const paneBox = (await pane.boundingBox()) ?? EMPTY_BOX;
        const apart = timeline.x + timeline.width <= paneBox.x + 1 || paneBox.x + paneBox.width <= timeline.x + 1;
        expect(apart, 'clear of the docked pane').toBe(true);
    },
);

/**
 * Standing and open (a phone held upright), the timeline takes the map's whole height from the top gutter down to the
 * chip's row above the menu button (the owner, 2026-11-14): the card fills its dock, which begins at the gutter.
 */
test(
    "The standing timeline, open, spans the map's height at 360 x 800",
    { tag: '@S-V04-HAPPY-TIMELINE-FULL-HEIGHT' },
    async ({ page, lang }) => {
        await page.setViewportSize({ width: 360, height: 800 });
        await openViewer(page, { lang, hash: OBOR_VIEW });
        await expect(viewer(page).locator('hcm-timeline')).toHaveAttribute('orientation', 'vertical');
        await openTimelineCard(page);
        await expect(async () => {
            const gaps = await viewer(page)
                .locator('.dock.timeline')
                .evaluate((dock) => {
                    const pane = (dock as HTMLElement).offsetParent?.getBoundingClientRect();
                    const box = dock.getBoundingClientRect();
                    const card = dock.querySelector('hcm-timeline')?.getBoundingClientRect();
                    const gutter = Number.parseFloat(getComputedStyle(dock).getPropertyValue('--hcm-gutter'));
                    return pane && card ? { top: card.top - pane.top, slack: box.height - card.height, gutter } : undefined;
                });
            expect(Math.abs((gaps?.top ?? -1) - (gaps?.gutter ?? 0)), 'from the top gutter').toBeLessThanOrEqual(1);
            expect(Math.abs(gaps?.slack ?? -1), 'down to the chip row').toBeLessThanOrEqual(1);
        }).toPass();
    },
);
