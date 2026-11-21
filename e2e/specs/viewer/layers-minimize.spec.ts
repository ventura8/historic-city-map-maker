import type { Locale } from '@hcm/shared';
import type { Page } from '@playwright/test';

import { mapIdle } from '../../support/map.js';
import { sitePath } from '../../support/site.js';
import { expect, test } from '../../support/test.js';
import {
    closeModalSheet,
    currentHash,
    openLayers,
    opacitySlider,
    t,
    viewer,
    visibilitySwitch,
    waitForEngineEvent,
} from '../../support/viewer.js';

/**
 * Minimizing the Layers panel (behaviour V03; the owner, 2026-11-08: "viewer should be able to minimize the layers
 * panel"). On an extra-large window the pane is always docked: its close button ("Restrânge straturile", expanded)
 * minimizes it to one floating button on the map's leading edge (collapsed; batch 4, the owner 2026-11-09: no rail) that brings it
 * back, the map takes the whole width, and nothing the visitor set is lost. The minimized pane lasts for the session, also when the window leaves the extra-large layout
 * and comes back. Everywhere else the panel is a sheet or a pane its close button already closes; opened again, it
 * shows the same values.
 */

const LAYER_LABEL = 'Corona 1966 (e2e)';

async function boot(page: Page, size: { width: number; height: number }, lang: Locale, hash: string): Promise<void> {
    await page.setViewportSize(size);
    await page.goto(sitePath('bucharest', { lang, hash }));
    await waitForEngineEvent(page, 'hcm-ready');
    await mapIdle(page);
}

function width(page: Page, selector: string): Promise<number> {
    return viewer(page)
        .locator(selector)
        .evaluate((element) => element.getBoundingClientRect().width);
}

/** The photo sheet's heading in the trailing pane (the sheet's host is `display: contents`, which Playwright calls hidden). */
function photoHeading(page: Page): ReturnType<Page['getByRole']> {
    return viewer(page).locator('.pane.trailing hcm-photo-sheet').getByRole('heading').first();
}

/** The leading pane's collapse button and its rail's button. */
function railOf(page: Page, lang: Locale): { close: ReturnType<Page['getByRole']>; rail: ReturnType<Page['getByRole']> } {
    const pane = viewer(page).locator('.pane.leading');
    return {
        close: pane.getByRole('button', { name: t(lang, 'layers.minimize'), exact: true }),
        rail: pane.getByRole('button', { name: t(lang, 'layers.title'), exact: true }),
    };
}

test(
    'At 1920 px the docked Layers pane minimizes to one floating button and comes back, the map taking the whole width',
    { tag: '@S-V03-HAPPY-MINIMIZE' },
    async ({ page, lang }) => {
        await boot(page, { width: 1920, height: 1080 }, lang, '15/44.42700/26.08530&layers=e2e-1966');
        const map = await width(page, '.map-pane');
        const { close, rail } = railOf(page, lang);
        await expect(close).toHaveAttribute('aria-expanded', 'true');
        await expect(
            viewer(page)
                .locator('.pane.leading')
                .getByRole('button', { name: t(lang, 'action.close'), exact: true }),
        ).toHaveCount(0);

        await close.click();
        await expect(rail).toBeFocused();
        await expect(rail).toHaveAttribute('aria-expanded', 'false');
        expect(await width(page, '.pane.leading')).toBe(0);
        expect(await width(page, '.map-pane')).toBe(map + 360);
        const button = await rail.boundingBox();
        const pane = await viewer(page).locator('.map-pane').boundingBox();
        expect([(button?.x ?? 0) - (pane?.x ?? 0), (button?.y ?? 0) - (pane?.y ?? 0)], "floating at the map pane's leading gutter").toEqual(
            [24, 24],
        );
        const canvas = viewer(page).locator('canvas.mapboxgl-canvas');
        await expect
            .poll(() => canvas.evaluate((element) => element.getBoundingClientRect().width), { message: 'Mapbox resized its canvas' })
            .toBe(map + 360);

        await page.keyboard.press('Enter');
        await expect(close).toBeFocused();
        await expect(visibilitySwitch(page, lang, LAYER_LABEL)).toBeVisible();
        expect(await width(page, '.map-pane')).toBe(map);
    },
);

test(
    'Minimizing loses no switch or slider, writes nothing to the hash and leaves the photo open beside it',
    { tag: '@S-V03-BAD-MINIMIZE-KEEPS-VALUES' },
    async ({ page, lang }) => {
        await boot(page, { width: 1920, height: 1080 }, lang, '15/44.42700/26.08530&layers=e2e-1966&photo=strandul-opereta-1976');
        const slider = opacitySlider(page, lang, LAYER_LABEL);
        const before = await currentHash(page);
        await slider.focus();
        await slider.press('ArrowLeft');
        await expect.poll(() => currentHash(page), 'the lowered opacity is in the hash').not.toBe(before);
        const hash = await currentHash(page);
        const value = await slider.getAttribute('aria-valuenow');
        const { close, rail } = railOf(page, lang);

        await close.click();
        await expect(rail).toBeVisible();
        expect(await currentHash(page)).toBe(hash);
        await expect(photoHeading(page)).toBeVisible();
        await rail.click();

        await expect(slider).toHaveAttribute('aria-valuenow', value ?? '');
        await expect(visibilitySwitch(page, lang, LAYER_LABEL)).toBeChecked();
        expect(await currentHash(page)).toBe(hash);
        await expect(photoHeading(page)).toBeVisible();
    },
);

test(
    "On a phone the Layers sheet's close is its minimize: opened again it shows the same values",
    { tag: '@S-V03-HAPPY-COMPACT-CLOSE' },
    async ({ page, lang }) => {
        await boot(page, { width: 412, height: 915 }, lang, '15/44.42700/26.08530&layers=e2e-1966');
        await openLayers(page, lang);
        const slider = opacitySlider(page, lang, LAYER_LABEL);
        await slider.focus();
        await slider.press('ArrowLeft');
        const value = await slider.getAttribute('aria-valuenow');

        await closeModalSheet(page);
        await expect(slider).toBeHidden();
        await openLayers(page, lang);

        await expect(slider).toHaveAttribute('aria-valuenow', value ?? '');
        await expect(visibilitySwitch(page, lang, LAYER_LABEL)).toBeChecked();
    },
);

test(
    'The minimized pane stays minimized when the window leaves the extra-large layout and comes back',
    { tag: '@S-V03-BAD-MINIMIZE-SURVIVES-RESIZE' },
    async ({ page, lang }) => {
        await boot(page, { width: 1920, height: 1080 }, lang, '15/44.42700/26.08530&layers=e2e-1966');
        const { close, rail } = railOf(page, lang);
        await close.click();
        await expect(rail).toBeVisible();
        const hash = await currentHash(page);

        await page.setViewportSize({ width: 1280, height: 800 });
        await expect(viewer(page).locator('.pane.leading')).toHaveCount(0);
        await page.setViewportSize({ width: 1920, height: 1080 });

        await expect(rail).toHaveAttribute('aria-expanded', 'false');
        expect(await width(page, '.pane.leading')).toBe(0);
        await expect(close).toHaveCount(0);
        expect(await currentHash(page)).toBe(hash);
    },
);
