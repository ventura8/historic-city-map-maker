import type { Locator, Page } from '@playwright/test';

import { expect, test } from '../../support/content-test.js';
import { seedCategory, seedCity, seedPlace, text } from './world.js';

/**
 * A settings write that must read the city first (docs/research/M2c-interfaces.md §8.5, §9.5; behaviours A19, A33): when
 * that read cannot reach the server it says so and writes nothing. Taken for an empty answer, the read would save bounds that
 * leave places out, or delete a category its places still name.
 */

const AT = new Date('2026-10-17T09:00:00.000Z');
/** Firestore's listen channel of the emulator (WebChannel), and what cutting it logs (e2e/admin/specs/ops/stream.spec.ts). */
const LISTEN = /\/google\.firestore\.v1\.Firestore\/Listen\/channel/;
const CUT = /ERR_CONNECTION_RESET|ERR_INTERNET_DISCONNECTED|Listen\/channel|cleardot\.gif/;
/** How long a read waits for the server (`READ_WAIT_MS`). */
const READ_WAIT_MS = 30_000;
const WIDE = { west: 25, south: 44, east: 27, north: 45 };

function fieldOf(page: Page, lang: 'ro' | 'en', key: Parameters<typeof text>[1]): Locator {
    return page.getByLabel(text(lang, key), { exact: true });
}

async function goOffline(page: Page): Promise<void> {
    await page.route(LISTEN, (route) => route.abort('connectionreset'));
    await page.context().setOffline(true);
}

async function comeBack(page: Page): Promise<void> {
    await page.context().setOffline(false);
    await page.unroute(LISTEN);
}

test(
    'Smaller bounds whose check cannot read the content are refused, and nothing is saved',
    { tag: '@S-A19-BAD-BOUNDS-UNREAD' },
    async ({ page, lang, content, consoleErrors }) => {
        test.setTimeout(150_000);
        await page.clock.install();
        await seedCity(content, AT, { bounds: WIDE });
        await seedCategory(content, 'cladiri', AT);
        await seedPlace(content, 'giurgiu', AT, { category: 'cladiri', lat: 44.43, lng: 26.9, title: 'Podul Prieteniei' });
        await page.goto(content.address(lang, 'settings/area'));
        for (const [key, value] of [
            ['adminContent.settings.west', '25.9'],
            ['adminContent.settings.east', '26.3'],
            ['adminContent.settings.south', '44.3'],
            ['adminContent.settings.north', '44.6'],
        ] as const) {
            await fieldOf(page, lang, key).fill(value);
        }

        await goOffline(page);
        await page.getByRole('button', { name: text(lang, 'adminContent.common.save'), exact: true }).click();
        await page.clock.fastForward(READ_WAIT_MS);

        await expect(page.getByText(text(lang, 'adminContent.settings.refused.offline'))).toBeVisible();
        await comeBack(page);
        expect((await content.document())?.['bounds']).toEqual(WIDE);
        consoleErrors.takeMatching(CUT);
    },
);

test(
    'A category whose places cannot be read stays, and its places with it',
    { tag: '@S-A33-BAD-CATEGORY-UNREAD' },
    async ({ page, lang, content, consoleErrors }) => {
        test.setTimeout(150_000);
        await page.clock.install();
        await seedCity(content, AT);
        await seedCategory(content, 'cladiri', AT);
        await seedCategory(content, 'porturi', AT, { label: { ro: 'Porturi', en: 'Harbours' }, order: 1 });
        await seedPlace(content, 'ateneu', AT, { category: 'cladiri', lat: 44.44, lng: 26.1, title: 'Ateneul Român' });
        await page.goto(content.address(lang, 'settings/categories/cladiri'));
        await page.getByRole('button', { name: text(lang, 'adminContent.settings.deleteCategory'), exact: true }).click();
        // The dialog's body and actions are slotted content of its element (light DOM), not inside the native dialog.
        const dialog = page.locator('hcm-dialog', { has: page.locator('#delete-target') });
        await expect(dialog.getByText(text(lang, 'adminContent.settings.deleteCategoryInUse', { count: '1' }))).toBeVisible();
        await dialog.getByLabel(text(lang, 'adminContent.settings.moveTo')).selectOption('porturi');

        await goOffline(page);
        await dialog.locator('hcm-button.confirm').getByRole('button').click();
        await page.clock.fastForward(READ_WAIT_MS);

        await expect(page.getByText(text(lang, 'adminContent.settings.refused.offline'))).toBeVisible();
        await comeBack(page);
        expect(await content.document('poiCategories/cladiri')).toBeDefined();
        expect((await content.document('pois/ateneu'))?.['category']).toBe('cladiri');
        consoleErrors.takeMatching(CUT);
    },
);
