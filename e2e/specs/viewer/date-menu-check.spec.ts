import type { Locale } from '@hcm/shared';
import type { Page } from '@playwright/test';

import { twoDatesOf1980 } from '../../fixtures/manifest.js';
import { E2E_TILESET_LAYER, E2E_XYZ_LAYER } from '../../fixtures/world.js';
import { expectColourAt, mapFraction } from '../../support/map.js';
import { expect, test } from '../../support/test.js';
import { callController, hashParam, openLayers, openViewer, serveManifest, t, visibilitySwitch } from '../../support/viewer.js';

/**
 * V13 (the owner, 2026-11-24): each row of a year's panel has its own checkbox that shows or hides that layer on the map right
 * there, the Layers panel's state (its switch follows) and the link's `layers=`; a tap on the date still picks it and brings it
 * to the front, and the layer on top stays on. 1980 has two dates: March (Corona) and August, August on top.
 */

const CORONA = 'Corona (e2e)';
const BOTH = `${E2E_TILESET_LAYER.id},${E2E_XYZ_LAYER.id}`;

function slider(page: Page, lang: Locale) {
    return page.getByRole('slider', { name: t(lang, 'timeline.label'), exact: true });
}

function datesMenu(page: Page, lang: Locale) {
    return page.getByRole('menu', { name: t(lang, 'timeline.dates', { year: '1980' }), exact: true });
}

function checkbox(page: Page, layerId: string) {
    return page.locator(`hcm-date-menu .box[data-show="${layerId}"]`);
}

async function openDates(page: Page, lang: Locale): Promise<void> {
    await slider(page, lang).focus();
    await page.keyboard.press('Enter');
    await expect(datesMenu(page, lang)).toBeVisible();
}

async function openOn1980(page: Page, lang: Locale): Promise<void> {
    await serveManifest(page, twoDatesOf1980());
    await openViewer(page, { lang, hash: '15/44.37000/25.97000' });
    await callController(page, 'setYear', 1980);
    await expect.poll(() => hashParam(page, 'layers')).toBe(BOTH);
}

test(
    "A row's checkbox hides and shows its layer in the panel, the Layers panel and the link following",
    { tag: ['@S-V13-HAPPY-CHECK-IN-PANEL', '@S-V13-HAPPY-CHECK-SYNCS-LAYERS'] },
    async ({ page, lang }) => {
        await openOn1980(page, lang);
        await openDates(page, lang);
        const corona = checkbox(page, E2E_TILESET_LAYER.id);
        const label = await corona.getAttribute('aria-label');
        expect(label?.startsWith(t(lang, 'timeline.showOnMap', { name: CORONA }))).toBe(true);
        await expect(corona).toBeChecked();

        await corona.click();

        await expect(corona).not.toBeChecked();
        await expect(datesMenu(page, lang), 'the panel stays open').toBeVisible();
        await expect.poll(() => hashParam(page, 'layers')).toBe(E2E_XYZ_LAYER.id);
        await page.keyboard.press('Escape');
        await openLayers(page, lang);
        const toggle = visibilitySwitch(page, lang, CORONA);
        await expect(toggle).not.toBeChecked();
        await toggle.click();
        await expect.poll(async () => (await hashParam(page, 'layers'))?.split(',').sort().join(',')).toBe(BOTH);
        await page.keyboard.press('Escape');
        await callController(page, 'setYear', 1980);
        await openDates(page, lang);
        await expect(checkbox(page, E2E_TILESET_LAYER.id)).toBeChecked();
    },
);

test(
    'The layer on top cannot be cleared in the panel; a hidden date picked comes back on top',
    { tag: '@S-V13-BAD-FRONT-STAYS-ON' },
    async ({ page, lang }) => {
        await openOn1980(page, lang);
        const probe = await mapFraction(page, 0.5, 0.3);
        await openDates(page, lang);
        const august = checkbox(page, E2E_XYZ_LAYER.id);
        await expect(august).toBeChecked();
        await expect(august).toBeDisabled();
        await checkbox(page, E2E_TILESET_LAYER.id).click();
        await expect.poll(() => hashParam(page, 'layers')).toBe(E2E_XYZ_LAYER.id);

        await page.locator('hcm-date-menu .item', { hasText: CORONA }).click();

        await expect(datesMenu(page, lang)).toBeHidden();
        await expectColourAt(page, probe, E2E_TILESET_LAYER.colour, 'the March layer, picked, on top again');
        await expect.poll(() => hashParam(page, 'layers')).toBe(`${E2E_XYZ_LAYER.id},${E2E_TILESET_LAYER.id}`);
    },
);

test(
    "The keyboard: Tab reaches a row's checkbox, Space toggles it, the arrows cross a row, Enter picks the date",
    { tag: ['@S-V13-HAPPY-CHECK-KEYBOARD', '@S-V13-BAD-SPACE-ON-CHECK-PICKS-NOTHING'] },
    async ({ page, lang }) => {
        await openOn1980(page, lang);
        await openDates(page, lang);
        await expect(page.locator('hcm-date-menu [data-front]')).toBeFocused();
        await page.keyboard.press('ArrowUp');
        await page.keyboard.press('Shift+Tab');
        const corona = checkbox(page, E2E_TILESET_LAYER.id);
        await expect(corona).toBeFocused();

        await page.keyboard.press('Space');

        await expect(corona).not.toBeChecked();
        await expect(datesMenu(page, lang), 'Space on the checkbox picks nothing').toBeVisible();
        await expect.poll(() => hashParam(page, 'layers')).toBe(E2E_XYZ_LAYER.id);
        await page.keyboard.press('Space');
        await expect.poll(async () => (await hashParam(page, 'layers'))?.split(',').sort().join(',')).toBe(BOTH);
        await page.keyboard.press('ArrowRight');
        await expect(page.locator('hcm-date-menu .item').first()).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(datesMenu(page, lang)).toBeHidden();
        await expect.poll(() => hashParam(page, 'layers')).toBe(`${E2E_XYZ_LAYER.id},${E2E_TILESET_LAYER.id}`);
    },
);
