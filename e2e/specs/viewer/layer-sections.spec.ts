import type { Page } from '@playwright/test';

import { expect, test } from '../../support/test.js';
import { openLayers, openViewer, t, viewer, visibilitySwitch } from '../../support/viewer.js';

/**
 * The Layers panel's three collapsible sections (owner, 2026-11-22): pinned at the top, then Places, then the historical
 * layers; pinned and Places start expanded, Layers collapsed, and the choice is remembered per viewer.
 */

const LAYER_LABEL = 'Corona 1966 (e2e)';

function header(page: Page, name: string) {
    return viewer(page).locator('hcm-layer-panel').getByRole('button', { name, exact: true });
}

test(
    'Pinned, Places and Layers in that order; Layers starts collapsed and its header expands it',
    { tag: ['@S-V03-HAPPY-LAYER-SECTIONS', '@layer-sections-default'] },
    async ({ page, lang }) => {
        await openViewer(page, { lang, hash: '15/44.42700/26.08530' });
        await openLayers(page, lang);
        const sections = viewer(page).locator('hcm-layer-panel [data-section]');
        await expect(sections).toHaveCount(3);
        expect(await sections.evaluateAll((all) => all.map((element) => element.getAttribute('data-section')))).toEqual([
            'pinned',
            'places',
            'layers',
        ]);
        await expect(header(page, t(lang, 'layers.group.pinned'))).toHaveAttribute('aria-expanded', 'true');
        await expect(header(page, t(lang, 'layers.group.places'))).toHaveAttribute('aria-expanded', 'true');
        const layers = header(page, t(lang, 'layers.group.historical'));
        await expect(layers).toHaveAttribute('aria-expanded', 'false');
        await expect(visibilitySwitch(page, lang, LAYER_LABEL)).toBeHidden();

        await layers.click();
        await expect(layers).toHaveAttribute('aria-expanded', 'true');
        await expect(visibilitySwitch(page, lang, LAYER_LABEL)).toBeVisible();

        await page.reload();
        await openLayers(page, lang);
        await expect(header(page, t(lang, 'layers.group.historical'))).toHaveAttribute('aria-expanded', 'true');
    },
);

test(
    'With storage blocked the panel still opens with its default sections and the headers still work',
    { tag: ['@S-V03-BAD-LAYER-SECTIONS-NO-STORAGE', '@layer-sections-default'] },
    async ({ page, lang }) => {
        await page.addInitScript(() => {
            Object.defineProperty(window, 'localStorage', {
                get() {
                    throw new DOMException('blocked', 'SecurityError');
                },
            });
        });
        await openViewer(page, { lang, hash: '15/44.42700/26.08530' });
        await openLayers(page, lang);
        const places = header(page, t(lang, 'layers.group.places'));
        await expect(places).toHaveAttribute('aria-expanded', 'true');
        await expect(header(page, t(lang, 'layers.group.historical'))).toHaveAttribute('aria-expanded', 'false');

        await places.click();
        await expect(places).toHaveAttribute('aria-expanded', 'false');
    },
);
