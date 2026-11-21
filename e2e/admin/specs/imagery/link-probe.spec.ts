import type { Locator, Page } from '@playwright/test';

import { E2E_TILE_HOST, E2E_XYZ_LAYER } from '../../../fixtures/world.js';
import { expectStateSound } from '../../../support/state-check.js';
import { adminVisit } from '../../../tour/states.js';
import { FUNCTIONS_TIMEOUT_MS } from '../../support/emulators.js';
import { ADMIN_LOCK, adminPath, expect, test } from '../../support/test.js';
import { errorText, imageryText, readyImagery } from './world.js';

// One admin test at a time: the probe runs in the server's upstream world and reads setup/status.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * Checking a source before linking it (behaviour A15; docs/research/M3-interfaces.md §8.2, §8.3): Check in the Link a
 * layer dialog asks `imagery.probeTiles` (the Functions emulator), which fetches one tile of the city's centre server-side
 * through the address guard from the e2e tile host (`tiles.e2e.test`, forwarded to the mock APIs, CR-M3-14): a PNG
 * answers with its type, a 404, an HTML page or a 503 are said in words, and Link stays off until the address changes.
 */
test.use({ persona: 'owner', mapOwner: 'owner' });

/** The Link a layer dialog's form (slotted into the kit's dialog: light DOM, not inside the native dialog). */
function linkDialog(page: Page): Locator {
    return page.locator('hcm-dialog', { has: page.locator('#link-address') });
}

async function openLink(page: Page, lang: 'ro' | 'en'): Promise<Locator> {
    await page.goto(adminPath(lang, 'layers'));
    await page.getByRole('button', { name: imageryText(lang, 'adminContent.layers.link'), exact: true }).click();
    const dialog = linkDialog(page);
    await expect(dialog.getByLabel(imageryText(lang, 'adminContent.layers.address'), { exact: true })).toBeVisible();
    return dialog;
}

/** A layer of the e2e tile host. */
function xyz(layer: string): string {
    return `https://${E2E_TILE_HOST}/xyz/${layer}/{z}/{x}/{y}.png`;
}

test(
    'A source is probed server-side before it is linked',
    { tag: '@S-A15-HAPPY-PROBED' },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        const imagery = await readyImagery(
            { emulators: adminWorld.emulators, api: mockApiRequest, upstream },
            adminWorld.accounts.owner.uid,
        );
        const dialog = await openLink(page, lang);
        await dialog.getByLabel(imageryText(lang, 'adminContent.layers.address'), { exact: true }).fill(E2E_XYZ_LAYER.tiles);

        // Check: the server asks one tile and says what answered; the browser never reached the tile host itself.
        await dialog.getByRole('button', { name: imageryText(lang, 'adminContent.layers.check') }).click();
        await expect(
            dialog.getByRole('status').filter({ hasText: imageryText(lang, 'adminContent.layers.tilesAnswer', { type: 'image/png' }) }),
        ).toBeVisible({
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        await expectStateSound(page, adminVisit('layers.link-probed', lang));

        // Link: the layer is created from the checked address.
        await dialog.getByLabel(imageryText(lang, 'adminContent.layers.labelRo'), { exact: true }).fill('Fotografie aeriană 1980');
        await dialog.getByLabel(imageryText(lang, 'adminContent.layers.year'), { exact: true }).fill('1980');
        await dialog.getByRole('button', { name: imageryText(lang, 'adminContent.layers.linkAction'), exact: true }).click();
        await expect
            .poll(
                async () =>
                    Object.values(await imagery.cityWorld.emulators.collection(`cities/${imagery.city}/layers`)).map(
                        (layer) => layer['source'],
                    ),
                {
                    timeout: FUNCTIONS_TIMEOUT_MS,
                },
            )
            .toEqual([{ type: 'xyz', tiles: [E2E_XYZ_LAYER.tiles], tileSize: 256 }]);
    },
);

test(
    'A 404 or invalid URL shows an error',
    { tag: '@S-A15-BAD-INVALID-URL' },
    async ({ page, lang, adminWorld, mockApiRequest, upstream, consoleErrors }) => {
        const imagery = await readyImagery(
            { emulators: adminWorld.emulators, api: mockApiRequest, upstream },
            adminWorld.accounts.owner.uid,
        );
        const dialog = await openLink(page, lang);
        const address = dialog.getByLabel(imageryText(lang, 'adminContent.layers.address'), { exact: true });
        const check = dialog.getByRole('button', { name: imageryText(lang, 'adminContent.layers.check') });
        const link = dialog.getByRole('button', { name: imageryText(lang, 'adminContent.layers.linkAction'), exact: true });
        await dialog.getByLabel(imageryText(lang, 'adminContent.layers.labelRo'), { exact: true }).fill('Plan');
        await dialog.getByLabel(imageryText(lang, 'adminContent.layers.year'), { exact: true }).fill('1911');

        // Each broken source in its own words, and Link off while it stands.
        const cases = [
            ['e2e-missing', 'apiError.imagery.tilesNotFound'],
            ['e2e-not-image', 'apiError.imagery.tilesNotImage'],
            ['e2e-down', 'apiError.imagery.tilesUnreachable'],
        ] as const;
        for (const [layer, code] of cases) {
            await address.fill(xyz(layer));
            await check.click();
            await expect(dialog.getByRole('alert').filter({ hasText: errorText(lang, code) })).toBeVisible({
                timeout: FUNCTIONS_TIMEOUT_MS,
            });
            await expect(link).toBeDisabled();
        }
        await expectStateSound(page, adminVisit('layers.link-no-tiles', lang));

        // A new address forgets the answer: Link is on again (the server's own checks still apply when it is sent).
        await address.fill(E2E_XYZ_LAYER.tiles);
        await expect(link).toBeEnabled();
        expect(Object.keys(await imagery.cityWorld.emulators.collection(`cities/${imagery.city}/layers`))).toEqual([]);
        // Each refused probe is the callable's error, which the browser logs.
        expect(consoleErrors.takeMatching(/imagery-probeTiles/).length).toBeGreaterThan(0);
    },
);
