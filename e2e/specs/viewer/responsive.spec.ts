import type { Locator, Page } from '@playwright/test';

import { horizontalOverflow, isOnTop, overlaps, visibleBoxes } from '../../support/layout.js';
import { mapIdle } from '../../support/map.js';
import { sitePath } from '../../support/site.js';
import { blankScrollOf } from '../../support/state-check.js';
import { expect, test } from '../../support/test.js';
import { chooseMenuItem, menuButton, openLayers, t, viewer, visibilitySwitch, waitForEngineEvent } from '../../support/viewer.js';

/**
 * Responsive layout (behaviour V15) and the legal controls on compact (V18): a landscape phone collapses the controls
 * into the menu and keeps the timeline lying at the foot of the map (too short to stand); the compact bottom sheet has three heights and closes when dragged
 * away; long Romanian labels never scroll the full-screen About sideways; the collapsed Mapbox attribution stays
 * reachable, and a sheet at full height reaches the foot of the viewer while Mapbox's own logo and credits rise into the
 * strip of map it leaves (the Pixel 9 Pro review, P3: a bar with a copy of them took the foot of every sheet). Each
 * test sets its own viewport, so every functional project runs it at that size. The layout of every screen at all 11
 * viewports is the tour's (e2e/tour/viewer.tour.ts).
 */

async function boot(page: Page, size: { width: number; height: number }, lang: 'ro' | 'en', hash?: string): Promise<void> {
    await page.setViewportSize(size);
    await page.goto(sitePath('bucharest', hash === undefined ? { lang } : { lang, hash }));
    await waitForEngineEvent(page, 'hcm-ready');
    await mapIdle(page);
}

const FLOATING = [
    '.dock.timeline hcm-timeline',
    '.dock.menu hcm-fab-menu',
    '.dock.chip [data-layout-check="near-year"]',
    '.dock.zoom',
    'a.mapboxgl-ctrl-logo',
    '.mapboxgl-ctrl-attrib',
];

test(
    'A landscape phone collapses the controls into the menu and lays the timeline down',
    { tag: '@S-V15-BAD-COMPACT-LANDSCAPE' },
    async ({ page, lang }) => {
        await boot(page, { width: 915, height: 412 }, lang, '15/44.42700/26.08530&layers=e2e-1966');

        await expect(page.getByRole('slider', { name: t(lang, 'timeline.label'), exact: true })).toHaveAttribute(
            'aria-orientation',
            'horizontal',
        );
        for (const name of [t(lang, 'layers.title'), t(lang, 'action.share'), t(lang, 'about.title')]) {
            await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
        }
        const fab = menuButton(page, lang);
        const closed = await fab.boundingBox();
        await fab.click();
        const items = page.getByRole('menuitem');
        await expect(items.filter({ hasText: t(lang, 'layers.title') })).toBeVisible();
        await expect(items.filter({ hasText: t(lang, 'about.title') })).toBeVisible();
        // UX review: the two-column menu used to push its button from the leading edge to the middle of the screen.
        const open = await page.getByRole('button', { name: t(lang, 'action.close'), exact: true }).boundingBox();
        expect(open?.x, 'the menu button stays where it was tapped').toBe(closed?.x);
        await page.keyboard.press('Escape');
        expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
        expect(overlaps(await visibleBoxes(page, FLOATING))).toEqual([]);
    },
);

const COMPACT = { width: 360, height: 800 };

/** The open bottom sheet of the Layers panel and its drag handle. */
function layersSheet(page: Page): { sheet: Locator; handle: Locator; box: Locator } {
    const sheet = viewer(page).locator('hcm-layer-panel hcm-sheet[open]');
    return { sheet, handle: page.getByRole('button', { name: t('ro', 'sheet.resize') }), box: sheet.locator('section.sheet') };
}

async function sheetHeight(box: Locator): Promise<number> {
    return (await box.boundingBox())?.height ?? 0;
}

/** Waits until the sheet's height and slide transitions have finished (the handle moves with them). */
async function settled(box: Locator): Promise<void> {
    await expect.poll(() => box.evaluate((element) => element.getAnimations().length), { message: 'the sheet has settled' }).toBe(0);
}

/** Drags the handle by `dy` CSS px (negative: up) once the sheet has settled. */
async function dragHandle(page: Page, handle: Locator, box: Locator, dy: number): Promise<void> {
    await settled(box);
    const start = await handle.boundingBox();
    const x = (start?.x ?? 0) + (start?.width ?? 0) / 2;
    const y = (start?.y ?? 0) + (start?.height ?? 0) / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + dy, { steps: 8 });
    await page.mouse.up();
}

test(
    'The compact sheet cycles peek, half and full, steps with the arrows and snaps after a drag',
    { tag: '@S-V15-HAPPY-SHEET-HEIGHTS' },
    async ({ page }) => {
        await boot(page, COMPACT, 'ro');
        await openLayers(page, 'ro');
        const { sheet, handle, box } = layersSheet(page);
        // The sheets' container: the whole viewer (V18: no bar below the sheets since the Pixel 9 Pro review, P3).
        const pane = (await viewer(page).locator('.modal-layer').boundingBox())?.height ?? 0;
        await expect(sheet).toHaveAttribute('detent', 'half');
        await expect.poll(() => sheetHeight(box)).toBeCloseTo(pane * 0.5, -1);

        await settled(box);
        await handle.click();
        await expect(sheet).toHaveAttribute('detent', 'full');
        await expect.poll(() => sheetHeight(box)).toBeCloseTo(pane - 72, -1);
        // The spring may overshoot while it settles; the settled sheet keeps 72 px of the map above it.
        await expect
            .poll(async () => (await box.boundingBox())?.y ?? 0, { message: 'the map stays visible above the full sheet' })
            .toBeGreaterThanOrEqual(71);
        await settled(box);
        await handle.click();
        await expect(sheet).toHaveAttribute('detent', 'peek');
        await expect.poll(() => sheetHeight(box)).toBeCloseTo(Math.min(160, pane * 0.3), -1);
        await handle.press('ArrowUp');
        await expect(sheet).toHaveAttribute('detent', 'half');
        await handle.press('ArrowUp');
        await expect(sheet).toHaveAttribute('detent', 'full');
        await handle.press('ArrowDown');
        await expect(sheet).toHaveAttribute('detent', 'half');

        // A drag that ends near the full height snaps to it.
        await dragHandle(page, handle, box, -pane * 0.4);
        await expect(sheet).toHaveAttribute('detent', 'full');
    },
);

test(
    'Dragging the compact sheet away closes it and gives the focus back to the menu',
    { tag: '@S-V15-BAD-SHEET-DRAG-CLOSE' },
    async ({ page }) => {
        await boot(page, COMPACT, 'ro');
        await openLayers(page, 'ro');
        const { sheet, handle, box } = layersSheet(page);
        await handle.press('ArrowDown');
        await expect(sheet).toHaveAttribute('detent', 'peek');

        await dragHandle(page, handle, box, 150);

        await expect(viewer(page).locator('hcm-layer-panel hcm-sheet[open]')).toHaveCount(0);
        await expect(menuButton(page, 'ro')).toBeFocused();
    },
);

/** Runs in the page: the About dialog box's sideways scroll and the icons of its theme choice. */
function aboutFacts(): { overflow: number; themeIcons: number; wrapped: string[] } {
    const deep = (root: Document | ShadowRoot, selector: string): Element[] => {
        const found = Array.from(root.querySelectorAll(selector));
        for (const element of Array.from(root.querySelectorAll('*'))) {
            if (element.shadowRoot !== null) {
                found.push(...deep(element.shadowRoot, selector));
            }
        }
        return found;
    };
    const dialog = deep(document, 'hcm-dialog').at(0)?.shadowRoot?.querySelector('dialog') ?? null;
    const groups = deep(document, '[role="radiogroup"]');
    const theme = groups.at(-1);
    const icons = theme === undefined ? [] : Array.from(theme.querySelectorAll('hcm-icon'));
    const labels = groups.flatMap((group) => Array.from(group.querySelectorAll('[role="radio"] span')));
    return {
        overflow: dialog === null ? -1 : dialog.scrollWidth - dialog.clientWidth,
        themeIcons: icons.filter((icon) => icon.checkVisibility()).length,
        wrapped: labels
            .filter((label) => label.getClientRects().length > 1 || label.getBoundingClientRect().height > 30)
            .map((label) => label.textContent),
    };
}

for (const width of [320, 360]) {
    test(
        `At ${String(width)} px the full-screen Settings never scroll sideways and their theme labels have no icons`,
        { tag: '@S-V15-BAD-LONG-LABELS' },
        async ({ page }) => {
            await boot(page, { width, height: 640 }, 'ro');
            await chooseMenuItem(page, 'ro', t('ro', 'settings.title'));
            await expect(page.getByRole('dialog', { name: t('ro', 'settings.title') })).toBeVisible();

            const facts = await page.evaluate(aboutFacts);
            expect(facts.overflow).toBe(0);
            expect(facts.themeIcons, 'only the check mark of the chosen theme').toBeLessThanOrEqual(1);
            expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
        },
    );
}

test('At 1440 px no language or theme label of Settings wraps', { tag: '@S-V15-BAD-LONG-LABELS' }, async ({ page }) => {
    await boot(page, { width: 1440, height: 900 }, 'ro');
    await chooseMenuItem(page, 'ro', t('ro', 'settings.title'));
    await expect(page.getByRole('dialog', { name: t('ro', 'settings.title') })).toBeVisible();

    expect((await page.evaluate(aboutFacts)).wrapped).toEqual([]);
});

test(
    'The collapsed attribution on a compact map opens and stays reachable',
    { tag: '@S-V18-BAD-COLLAPSED-ATTRIBUTION' },
    async ({ page }) => {
        await boot(page, COMPACT, 'ro');
        const control = viewer(page).locator('.mapboxgl-ctrl-attrib');
        await expect(control).toHaveClass(/mapboxgl-compact/);
        const toggle = viewer(page).getByRole('button', { name: t('ro', 'map.toggleAttribution') });
        await expect(toggle).toBeVisible();
        await expect(isOnTop(toggle)).resolves.toBe(true);

        await toggle.click();
        await expect(control).toHaveClass(/mapboxgl-compact-show/);
        const credit = viewer(page).getByRole('link', { name: '© Mapbox' });
        await expect(credit).toBeVisible();
        await expect(isOnTop(credit)).resolves.toBe(true);
        await expect(viewer(page).getByRole('link', { name: t('ro', 'map.logo') })).toBeVisible();
    },
);

test(
    "A full-height sheet on a phone reaches the viewer's foot; Mapbox's logo and credits, a layer's among them, rise above it",
    { tag: '@S-V18-BAD-FULL-SHEET' },
    async ({ page }) => {
        await boot(page, COMPACT, 'ro');
        await openLayers(page, 'ro');
        const { sheet, handle, box } = layersSheet(page);
        await settled(box);
        await handle.click();
        await expect(sheet).toHaveAttribute('detent', 'full');
        await settled(box);

        const logo = viewer(page).locator('.mapboxgl-ctrl-bottom-left a.mapboxgl-ctrl-logo');
        const credits = viewer(page).locator('.mapboxgl-ctrl-bottom-right .mapboxgl-ctrl-attrib');
        const sheetBox = (await box.boundingBox()) ?? { y: 0, height: 0 };
        const frame = (await viewer(page).boundingBox()) ?? { y: 0, height: Number.POSITIVE_INFINITY };
        expect(sheetBox.y + sheetBox.height, 'the sheet reaches the foot of the viewer').toBeCloseTo(frame.y + frame.height, 0);
        await expect(viewer(page).locator('.legal')).toHaveCount(0);
        for (const control of [logo, credits]) {
            await expect(control).toBeVisible();
            await expect
                .poll(
                    async () => {
                        const at = await control.boundingBox();
                        return at === null ? Number.POSITIVE_INFINITY : at.y + at.height;
                    },
                    { message: 'above the sheet, in the strip of map it leaves' },
                )
                .toBeLessThanOrEqual(sheetBox.y + 0.5);
        }

        await visibilitySwitch(page, 'ro', 'Corona 1966 (e2e)').click();
        await expect(credits).toContainText('USGS (e2e)');
        // The collapsed attribution keeps its links out of the accessibility tree until it is opened.
        await expect(credits.locator('a', { hasText: '© Mapbox' })).toHaveAttribute('href', 'https://www.mapbox.com/about/maps/');
    },
);

/** The map's own controls that a docked pane must leave uncovered (the Pixel Tablet upright: Menu, zoom and the timeline). */
const MAP_CONTROLS = ['.dock.timeline hcm-timeline', '.dock.menu hcm-fab-menu', '.dock.zoom'];

test(
    'A tablet held upright docks the Layers panel beside the map, which keeps its timeline, Menu and zoom in view',
    { tag: '@S-V15-HAPPY-TABLET-PORTRAIT-DOCKED' },
    async ({ page, lang }) => {
        // The Pixel Tablet, 2026-11-12 (800 x 1280): the modal side sheet covered the timeline, Menu and the zoom buttons.
        await boot(page, { width: 800, height: 1280 }, lang, '15/44.42700/26.08530&layers=e2e-1966');
        await openLayers(page, lang);

        await expect(page.getByRole('region', { name: t(lang, 'layers.title'), exact: true })).toBeVisible();
        await expect(page.getByRole('dialog', { name: t(lang, 'layers.title'), exact: true })).toHaveCount(0);
        // The map's controls settle beside the docked pane (the zoom group was read before it showed: lesson 819).
        await expect
            .poll(async () => (await visibleBoxes(page, MAP_CONTROLS)).length, { message: 'the timeline, Menu and zoom are shown' })
            .toBe(MAP_CONTROLS.length);
        expect(overlaps(await visibleBoxes(page, ['hcm-layer-panel', ...MAP_CONTROLS])), 'the pane beside the controls').toEqual([]);
        for (const selector of MAP_CONTROLS) {
            await expect(isOnTop(viewer(page).locator(selector)), `${selector} uncovered`).resolves.toBe(true);
        }
        expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    },
);

test(
    'A window under 760 px wide, or wide but short, still opens the Layers panel as a sheet over the map',
    { tag: '@S-V15-BAD-NARROW-OR-SHORT-MODAL' },
    async ({ page, lang }) => {
        for (const size of [
            { width: 759, height: 1024 },
            { width: 915, height: 412 },
        ]) {
            await boot(page, size, lang, '15/44.42700/26.08530&layers=e2e-1966');
            await openLayers(page, lang);
            const where = `${String(size.width)}x${String(size.height)}`;
            // A standard sheet since 2026-11-15 (no scrim, the map stays usable): a labelled region, not a dialog.
            await expect(page.getByRole('region', { name: t(lang, 'layers.title'), exact: true }), where).toBeVisible();
            await page.keyboard.press('Escape');
            await expect(page.getByRole('region', { name: t(lang, 'layers.title'), exact: true }), where).toHaveCount(0);
        }
    },
);

test(
    'The city page is an app shell: the window never scrolls into blank space below the map',
    { tag: '@S-V15-HAPPY-NO-BLANK-SCROLL' },
    async ({ page, lang }) => {
        await boot(page, COMPACT, lang);
        await page.mouse.wheel(0, 2000);

        expect(await page.evaluate(() => window.scrollY)).toBe(0);
        expect(await blankScrollOf(page)).toEqual([]);
    },
);

test(
    'A blank area left under the map is found by the no-blank-scroll checker',
    { tag: '@S-V15-BAD-NO-BLANK-SCROLL' },
    async ({ page, lang }) => {
        await boot(page, COMPACT, lang);
        // A fixture's fault: 400 px of nothing after the body, which clips its own overflow, so the root's scroller grows.
        await page.evaluate(() => {
            const blank = document.createElement('div');
            blank.style.blockSize = '400px';
            document.documentElement.append(blank);
        });

        const messages = (await blankScrollOf(page)).map((violation) => violation.message);
        expect(messages).toContain("the app shell's page is 1200 px tall in a 800 px window");
        expect(messages).toContain('scrolling the window moves the app shell 400 px');
    },
);
