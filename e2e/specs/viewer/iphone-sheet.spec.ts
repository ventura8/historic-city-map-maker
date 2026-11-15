import type { Locator, Page } from '@playwright/test';

import { twoDatesOf1980 } from '../../fixtures/manifest.js';
import { expect, test } from '../../support/test.js';
import {
    callController,
    menuButton,
    menuItemNamed,
    openLayers,
    openTimelineCard,
    openViewer,
    opacitySlider,
    serveManifest,
    t,
    viewer,
} from '../../support/viewer.js';

/**
 * The owner's iPhone (2026-11-15; lesson 740): in Safari the X of the open menu did not close it, and the Layers panel
 * dimmed the whole map. Run in WebKit with the iPhone 15 profile (project `fn-webkit-iphone15`, e2e/projects.ts).
 *
 * Playwright's WebKit on Linux focuses a tapped button, iOS Safari does not: there the element that had the focus blurs to
 * nothing. `safariFocusModel` gives the page Safari's rule, which is what reproduced the bug before the fix.
 */

test.use({
    expectedConsoleErrors: [
        {
            text: /^Refused to apply a stylesheet because its hash, its nonce, or 'unsafe-inline' does not appear in the style-src directive/,
            url: /^(?:http:\/\/127\.0\.0\.1:\d+\/|$)/,
            why: "Playwright's WebKit inserts <style>body {}</style> from its own inspector (web-inspector://bootstrap.js) after a tap; the page adds no inline style (seen 2026-11-15)",
        },
    ],
});

/**
 * iOS Safari's focus on a tap: a pressed button takes no focus, and whatever had it blurs. A button with a `tabindex` (the
 * menu's items) is focusable by a press there and takes the focus as everywhere else.
 */
async function safariFocusModel(page: Page): Promise<void> {
    await page.addInitScript(() => {
        const deepActive = (): Element | null => {
            let active = document.activeElement;
            while (active?.shadowRoot?.activeElement) {
                active = active.shadowRoot.activeElement;
            }
            return active;
        };
        document.addEventListener(
            'mousedown',
            (event) => {
                const button = event.composedPath().find((node) => node instanceof HTMLButtonElement);
                if (button instanceof HTMLButtonElement && !button.hasAttribute('tabindex')) {
                    event.preventDefault();
                    const active = deepActive();
                    if (active instanceof HTMLElement) {
                        active.blur();
                    }
                }
            },
            true,
        );
    });
}

/** What a finger at (x, y) reaches, through every shadow root: its class list and its accessible name. */
async function hitAt(page: Page, x: number, y: number): Promise<string> {
    return page.evaluate(
        ([px, py]) => {
            let hit: Element | null = document.elementFromPoint(px, py);
            while (hit?.shadowRoot) {
                const inner = hit.shadowRoot.elementFromPoint(px, py);
                if (inner === null || inner === hit) {
                    break;
                }
                hit = inner;
            }
            return `${hit?.className ?? ''} ${hit?.getAttribute('aria-label') ?? ''}`;
        },
        [x, y] as const,
    );
}

test(
    'On an iPhone the Layers panel leaves the map undimmed and usable, and its X closes it',
    { tag: '@S-V15-HAPPY-IPHONE-LAYERS' },
    async ({ page, lang }, testInfo) => {
        await safariFocusModel(page);
        await openViewer(page, { lang });
        await menuButton(page, lang).tap();
        await menuItemNamed(page, t(lang, 'layers.title')).tap();
        const panel = page.getByRole('region', { name: t(lang, 'layers.title'), exact: true });
        await expect(panel).toBeVisible();

        await expect(page.getByRole('dialog', { name: t(lang, 'layers.title'), exact: true })).toHaveCount(0);
        await expect(viewer(page).locator('hcm-layer-panel hcm-sheet .scrim')).toHaveCount(0);
        await expect(viewer(page).locator('.frame')).not.toHaveAttribute('inert');
        const box = await panel.boundingBox();
        expect(box).not.toBeNull();
        expect(await hitAt(page, 40, Math.max(1, (box?.y ?? 0) / 2)), 'a finger above the panel reaches the map').toContain(
            'mapboxgl-canvas',
        );
        await page.screenshot({ path: testInfo.outputPath('iphone-layers-open.png') });

        const close = panel.getByRole('button', { name: t(lang, 'action.close'), exact: true });
        const target = await close.boundingBox();
        const [cx, cy] = [(target?.x ?? 0) + (target?.width ?? 0) / 2, (target?.y ?? 0) + (target?.height ?? 0) / 2];
        // A real <button> whose touch target is at least 44 px: a finger 22 px from its centre still reaches it.
        for (const [dx, dy] of [
            [-21, 0],
            [21, 0],
            [0, -21],
            [0, 21],
        ] as const) {
            expect(await hitAt(page, cx + dx, cy + dy), `the X at ${String(dx)}, ${String(dy)} px from its centre`).toContain(
                t(lang, 'action.close'),
            );
        }
        await close.tap();
        await expect(panel).toHaveCount(0);
        await page.screenshot({ path: testInfo.outputPath('iphone-layers-closed.png') });

        await menuButton(page, lang).tap();
        await menuItemNamed(page, t(lang, 'layers.title')).tap();
        await expect(panel).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(panel).toHaveCount(0);
    },
);

test(
    "On an iPhone the menu's X closes the menu although Safari blurs the focused item to nothing",
    { tag: '@S-V15-BAD-IPHONE-MENU-CLOSE' },
    async ({ page, lang }) => {
        await safariFocusModel(page);
        await openViewer(page, { lang });
        await menuButton(page, lang).tap();
        const item = menuItemNamed(page, t(lang, 'layers.title'));
        await expect(item).toBeVisible();

        await page
            .getByRole('button', { name: t(lang, 'action.close'), exact: true })
            .filter({ visible: true })
            .tap();

        await expect(item).toHaveCount(0);
        await expect(menuButton(page, lang)).toHaveAttribute('aria-expanded', 'false');
    },
);

test(
    "On an iPhone the menu's X morphs back to the rounded square without a sharp-cornered frame",
    { tag: '@S-V15-BAD-IPHONE-MENU-MORPH' },
    async ({ page, lang }) => {
        await openViewer(page, { lang });
        await menuButton(page, lang).tap();
        // The same button by its place: its name changes to the close label while the menu is open.
        const fab = page.locator('hcm-fab-menu .fab');
        await expect(fab).toHaveAttribute('aria-expanded', 'true');
        await expect.poll(() => fab.evaluate((button) => getComputedStyle(button).borderTopLeftRadius)).toBe('28px');

        // Every frame of the closing morph, sampled until it settles: never below the square's 16 px corner (lesson 741).
        const radii = await fab.evaluate(
            (button) =>
                new Promise<number[]>((resolve) => {
                    const seen: number[] = [];
                    const sample = (): void => {
                        seen.push(Number.parseFloat(getComputedStyle(button).borderTopLeftRadius));
                        if (seen.length < 40) {
                            requestAnimationFrame(sample);
                        } else {
                            resolve(seen);
                        }
                    };
                    (button as HTMLButtonElement).click();
                    requestAnimationFrame(sample);
                }),
        );
        expect(Math.min(...radii), radii.join(' ')).toBeGreaterThanOrEqual(16);
        expect(Math.max(...radii)).toBeLessThanOrEqual(28);
        await expect(fab).toHaveAttribute('aria-expanded', 'false');
    },
);

/** The timeline's thumb on the oldest year (Home), the card open on a phone. */
async function oldestYear(page: Page): Promise<Locator> {
    await openTimelineCard(page);
    const thumb = viewer(page).locator('hcm-timeline .thumb');
    await thumb.focus();
    await thumb.press('Home');
    await thumb.evaluate((element) => {
        (element as HTMLElement).blur();
    });
    return thumb;
}

test(
    "On an iPhone a tap on the selected year shows its layer's opacity slider, and the Layers panel follows it",
    { tag: '@S-V12-HAPPY-IPHONE-YEAR-OPACITY' },
    async ({ page, lang }) => {
        await openViewer(page, { lang });
        const thumb = await oldestYear(page);
        const range = viewer(page).locator('hcm-timeline .opacity [role="slider"]');
        await expect(range).toBeHidden();

        await thumb.tap();
        await expect(range).toBeVisible();
        const label = (await range.getAttribute('aria-label')) ?? '';
        const name = label.slice(label.indexOf(':') + 1).trim();
        expect(label).toBe(t(lang, 'layers.opacity', { name }));
        const box = await range.boundingBox();
        expect(box?.height ?? 0, 'the slider is a 48 px touch target').toBeGreaterThanOrEqual(44);

        await range.focus();
        await range.press('Home');
        for (let step = 0; step < 4; step += 1) {
            await range.press('PageUp');
        }
        await expect(range).toHaveAttribute('aria-valuetext', t(lang, 'layers.opacityValue', { percent: '40' }));
        await openLayers(page, lang);
        await expect(opacitySlider(page, lang, name)).toHaveAttribute('aria-valuenow', '40');
    },
);

test(
    'On an iPhone the year opacity slider closes on a tap elsewhere and today has none',
    { tag: '@S-V12-BAD-IPHONE-YEAR-OPACITY' },
    async ({ page, lang }) => {
        await openViewer(page, { lang });
        const range = viewer(page).locator('hcm-timeline .opacity [role="slider"]');
        await openTimelineCard(page);
        const thumb = viewer(page).locator('hcm-timeline .thumb');
        await thumb.tap();
        await expect(range, 'today has no layer to fade').toBeHidden();

        await oldestYear(page);
        await thumb.tap();
        await expect(range).toBeVisible();
        const box = await thumb.boundingBox();
        await page.touchscreen.tap(20, Math.max(20, (box?.y ?? 200) - 200));
        await expect(range).toBeHidden();
    },
);

test(
    'On an iPhone the open menu hides the zoom buttons and the compass, and closing it brings them back',
    { tag: '@S-V15-HAPPY-IPHONE-MENU-HIDES-CONTROLS' },
    async ({ page, lang }) => {
        await openViewer(page, { lang });
        const zoomIn = page.getByRole('button', { name: t(lang, 'viewer.zoomIn'), exact: true });
        const compass = page.getByRole('button', { name: t(lang, 'viewer.compass'), exact: true });
        await expect(zoomIn).toBeVisible();
        await expect(compass).toBeVisible();
        const before = await compass.boundingBox();

        await menuButton(page, lang).tap();
        await expect(zoomIn).toBeHidden();
        await expect(compass).toBeHidden();

        await page.locator('hcm-fab-menu .fab').tap();
        await expect(zoomIn).toBeVisible();
        await expect(compass).toBeVisible();
        expect(await compass.boundingBox(), 'no layout jump').toEqual(before);
    },
);

test('The Layers panel lists its historical layers newest first', { tag: '@S-V03-HAPPY-LAYERS-NEWEST-FIRST' }, async ({ page, lang }) => {
    await openViewer(page, { lang });
    await menuButton(page, lang).tap();
    await menuItemNamed(page, t(lang, 'layers.title')).tap();
    const panel = page.getByRole('region', { name: t(lang, 'layers.title'), exact: true });
    // The rows in the order a screen reader reads them (the 1966 one may be scrolled out of view).
    const rows = await panel.ariaSnapshot();
    const newer = rows.indexOf('1980 (e2e)');

    expect(newer, 'the 1980 layer is listed').toBeGreaterThanOrEqual(0);
    expect(newer, 'the 1980 layer before the 1966 one').toBeLessThan(rows.indexOf('Corona 1966 (e2e)'));
});

/** A finger held on `target`: a touch pointerdown with no lift (the long press, `long-press.ts`). */
async function holdOn(target: Locator): Promise<void> {
    const box = await target.boundingBox();
    const x = (box?.x ?? 0) + 4;
    const y = (box?.y ?? 0) + 4;
    await target.dispatchEvent('pointerdown', {
        clientX: x,
        clientY: y,
        pointerType: 'touch',
        isPrimary: true,
        bubbles: true,
        composed: true,
    });
}

test(
    'On an iPhone a long press on the collapsed year pill opens its opacity card: "all" first, then a slider per layer',
    { tag: '@S-V12-HAPPY-IPHONE-YEAR-OPACITY-HOLD' },
    async ({ page, lang }) => {
        await serveManifest(page, twoDatesOf1980());
        await openViewer(page, { lang });
        await callController(page, 'setYear', 1980);
        const thumb = viewer(page).locator('hcm-timeline .thumb');
        await expect(viewer(page).locator('hcm-timeline[collapsed]')).toHaveCount(1);
        await expect(viewer(page).locator('hcm-timeline[fadable]')).toHaveCount(1);

        await holdOn(thumb);
        const ranges = viewer(page).locator('hcm-timeline .opacity [role="slider"]');
        await expect(ranges).toHaveCount(3);
        await expect(ranges.first()).toBeVisible();
        const all = t(lang, 'layers.opacity', { name: t(lang, 'timeline.opacityAll', { year: '1980' }) });
        await expect(ranges.first()).toHaveAttribute('aria-label', all);
        await thumb.dispatchEvent('pointerup', { pointerType: 'touch', bubbles: true, composed: true });
        await expect(ranges).toHaveCount(3);
        const sheet = await viewer(page).locator('hcm-timeline .opacity').boundingBox();
        const height = page.viewportSize()?.height ?? 0;
        expect(Math.round((sheet?.y ?? 0) + (sheet?.height ?? 0)), 'a bottom sheet on a phone').toBe(height);

        await ranges.first().focus();
        await ranges.first().press('Home');
        for (let step = 0; step < 3; step += 1) {
            await ranges.first().press('PageUp');
        }
        const thirty = t(lang, 'layers.opacityValue', { percent: '30' });
        await expect(ranges.nth(1)).toHaveAttribute('aria-valuetext', thirty);
        await expect(ranges.nth(2)).toHaveAttribute('aria-valuetext', thirty);
    },
);

test(
    'On an iPhone a short press on the collapsed pill opens the timeline without the opacity card',
    { tag: '@S-V12-BAD-IPHONE-YEAR-OPACITY-HOLD' },
    async ({ page, lang }) => {
        await serveManifest(page, twoDatesOf1980());
        await openViewer(page, { lang });
        await callController(page, 'setYear', 1980);
        await viewer(page).locator('hcm-timeline .thumb').tap();
        await expect(viewer(page).locator('hcm-timeline[collapsed]')).toHaveCount(0);
        await expect(viewer(page).locator('hcm-timeline .opacity [role="slider"]').first()).toBeHidden();
    },
);
