import type { Locator, Page } from '@playwright/test';

import { recordLiveRegions } from '../support/live-regions.js';
import { expectStateSound } from '../support/state-check.js';
import { adminVisit } from './states.js';
import { expect, test } from '../admin/support/content-test.js';
import { adminMapReady } from '../admin/support/map.js';
import { seedCity, seedLayer, text } from '../admin/specs/settings/world.js';

/**
 * The layers page (docs/research/M2c-interfaces.md §8.1–§8.4; behaviours A35, A33): an admin opens `#/layers` of a city of its own before the
 * raster pipeline made any layer, then sees the layers an earlier run left, top first; tries to link another account's
 * tileset (refused in the dialog, nothing sent); opens a layer, moves its image adjustments from the keyboard only (each
 * stays in its range, the levels never cross, every value is said as a signed percentage), saves them, and asks to
 * delete the layer but keeps it. Every screen and dialog on the way runs the generic layout and accessibility checkers
 * (the layers section of e2e/tour/states.ts).
 *
 * Part of the layout and accessibility tour (DECISIONS-for-review.md §34c): it runs at every tour project's viewport,
 * scheme and language (tier `tour` on every push, `tour-matrix` in `all` and nightly), in a city of its own, so it
 * needs no lock beside the admin tier.
 */

// The content world's fakes (Mapbox, Google) are forwarded as in the admin projects.
test.use({ forwardUpstreams: true });
const AT = new Date('2026-10-17T09:00:00.000Z');

/** An image adjustment's slider in the open layer's editor. */
function slider(page: Page, lang: 'ro' | 'en', name: 'brightnessMin' | 'brightnessMax' | 'contrast' | 'saturation'): Locator {
    return page.getByRole('slider', { name: text(lang, `adminContent.layers.adjust.${name}`), exact: true });
}

/** Presses each key on `target` and reads the value it then says. */
async function pressAndRead(target: Locator, steps: readonly (readonly [string, string])[]): Promise<void> {
    await target.focus();
    for (const [key, said] of steps) {
        await target.press(key);
        await expect(target, key).toHaveAttribute('aria-valuetext', said);
    }
}

test(
    'Image adjustments from the keyboard stay in their ranges, are said as signed percentages and are saved',
    { tag: ['@S-A35-BAD-KEYBOARD-LIMITS', '@S-A15-BAD-FOREIGN-PRIVATE-TILESET', '@S-A31-HAPPY-EDITORS', '@S-A21-BAD-LEAK-CHECK'] },
    async ({ page, lang, content }) => {
        await page.context().addInitScript(recordLiveRegions);
        await seedCity(content, AT);
        await page.goto(content.address(lang, 'layers'));

        // No layer yet: the page says where layers come from.
        await expect(page.getByText(text(lang, 'adminContent.layers.empty'))).toBeVisible();
        await expectStateSound(page, adminVisit('layers.empty', lang));

        // The layers of an earlier run, top first (the higher order is drawn on top).
        await seedLayer(content, 'plan-1911', AT, {
            label: { ro: 'Planul 1911' },
            year: 1911,
            order: 1,
            status: 'processing',
            published: false,
        });
        await seedLayer(content, 'corona-1968', AT, { order: 2 });
        const rows = page.locator('hcm-layers-page a.row');
        await expect(rows).toHaveCount(2);
        await expect(rows.first()).toContainText('Corona 1968');
        await expectStateSound(page, adminVisit('layers.list', lang));

        // Link a layer: another account's tileset is refused in the dialog, before anything is sent; Esc closes it.
        const linkName = text(lang, 'adminContent.layers.link');
        await page.getByRole('button', { name: linkName, exact: true }).click();
        await expect(page.getByRole('dialog', { name: text(lang, 'adminContent.layers.linkTitle') })).toBeVisible();
        // The dialog's form and actions are slotted content of its element (light DOM), not inside the native dialog.
        const dialog = page.locator('hcm-dialog', { has: page.locator('#link-address') });
        await expectStateSound(page, adminVisit('layers.link', lang));
        await dialog.getByLabel(text(lang, 'adminContent.layers.address'), { exact: true }).fill('mapbox://other-user.plan-1911');
        await dialog.getByLabel(text(lang, 'adminContent.layers.labelRo'), { exact: true }).fill('Planul 1911');
        await dialog.getByLabel(text(lang, 'adminContent.layers.year'), { exact: true }).fill('1911');
        await dialog.getByRole('button', { name: text(lang, 'adminContent.layers.linkAction'), exact: true }).click();
        await expect(dialog.getByRole('alert')).toContainText('other-user');
        await expectStateSound(page, adminVisit('layers.link-refused', lang, { escape: { opener: linkName } }));
        await expect(rows).toHaveCount(2);

        // The editor of Corona 1968.
        await rows.first().click();
        await expect(page.getByRole('heading', { level: 2, name: 'Corona 1968' })).toBeVisible();
        // A settled state: the editor's map opens after its heading (its legal line comes with it).
        await adminMapReady(page);
        await expectStateSound(page, adminVisit('layers.editor', lang));

        // Every slider from the keyboard: the ends, a page, a step; each value stays in its range and is said as a signed
        // percentage. The black level stops at the white level and the white level at the black one.
        await pressAndRead(slider(page, lang, 'saturation'), [
            ['End', '+100 %'],
            ['PageUp', '+100 %'],
            ['ArrowUp', '+100 %'],
            ['Home', '-100 %'],
            ['PageDown', '-100 %'],
            ['ArrowDown', '-100 %'],
            ['ArrowRight', '-99 %'],
        ]);
        await pressAndRead(slider(page, lang, 'contrast'), [
            ['End', '+100 %'],
            ['Home', '-100 %'],
            ['PageUp', '-80 %'],
            ['ArrowRight', '-79 %'],
        ]);
        const black = slider(page, lang, 'brightnessMin');
        const white = slider(page, lang, 'brightnessMax');
        await pressAndRead(black, [
            ['Home', '0 %'],
            ['PageDown', '0 %'],
            ['End', '+100 %'],
        ]);
        await pressAndRead(white, [
            ['Home', '0 %'],
            ['End', '0 %'],
        ]);
        await pressAndRead(black, [
            ['ArrowLeft', '+99 %'],
            ['PageDown', '+89 %'],
        ]);
        await pressAndRead(white, [['Home', '-11 %']]);
        await expect(white).toHaveAttribute('aria-valuenow', '89');
        const said = text(lang, 'adminContent.layers.adjusted', {
            name: text(lang, 'adminContent.layers.adjust.brightnessMax'),
            value: '-11',
        });
        await expectStateSound(page, adminVisit('layers.adjusting', lang, { announcements: [said] }));

        // Save writes the adjustments, each within its range, the levels uncrossed.
        await page.getByRole('button', { name: text(lang, 'adminContent.common.save'), exact: true }).click();
        await expect
            .poll(async () => (await content.document(`layers/corona-1968`))?.['adjustments'])
            .toEqual({ brightnessMin: 0.89, brightnessMax: 0.89, contrast: -0.79, saturation: -0.99 });

        // Delete asks first; Esc keeps the layer.
        const deleteName = text(lang, 'adminContent.layers.delete');
        await page.getByRole('button', { name: deleteName, exact: true }).click();
        await expect(
            page.getByRole('dialog', { name: text(lang, 'adminContent.layers.deleteConfirm', { name: 'Corona 1968' }) }),
        ).toBeVisible();
        await expectStateSound(page, adminVisit('layers.delete-confirm', lang, { escape: { opener: deleteName } }));
        expect(await content.document(`layers/corona-1968`)).toBeDefined();
    },
);
