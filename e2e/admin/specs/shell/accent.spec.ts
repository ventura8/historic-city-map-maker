import { translate, translateAdminShell } from '@hcm/shared';
import type { Page } from '@playwright/test';

import { emulateDeviceAccent } from '../../../support/device-accent.js';
import { expect, test } from '../../support/content-test.js';
import type { ContentWorld } from '../../support/content.js';
import { seedPhotosCity } from '../../support/photos.js';

/**
 * The admin follows the device as the viewer does (behaviour A21; the owner, 2026-11-13): its theme's mode follows the
 * system and its colours the device's accent, unless the account menu says otherwise. The Playwright browser is a
 * Chromium tab, which Chrome gives no accent of the device: the page names one with `--hcm-device-accent`.
 */

const AT = new Date('2026-10-17T09:00:00.000Z');
const PRIMARY = '--md-sys-color-primary';

async function openAdmin(page: Page, content: ContentWorld, accent: string | null): Promise<void> {
    if (accent !== null) {
        await emulateDeviceAccent(page, accent);
    }
    await seedPhotosCity(content, AT);
    await page.goto(content.address('en', 'photos', { map: false }));
    await expect(page.getByRole('heading', { level: 1, name: translateAdminShell('en', 'adminShell.nav.photos') })).toBeVisible();
}

/** The primary colour the shell wears now. */
async function primary(page: Page): Promise<string> {
    return page
        .locator('hcm-admin-shell')
        .evaluate((shell, name) => getComputedStyle(shell).getPropertyValue(name).trim().toLowerCase(), PRIMARY);
}

async function openAccountMenu(page: Page): Promise<void> {
    await page
        .getByRole('button', { name: translateAdminShell('en', 'adminShell.account.label') })
        .filter({ visible: true })
        .click();
}

/** Picks `choice` in the account menu's Colours. */
async function chooseColours(page: Page, choice: 'accent.device' | 'accent.map'): Promise<void> {
    await openAccountMenu(page);
    await page.getByRole('radio', { name: translate('en', choice), exact: true }).click();
    await page.keyboard.press('Escape');
}

for (const scheme of ['light', 'dark'] as const) {
    test(
        `The ${scheme} admin wears the device's accent by default; Map colours brings the city's back`,
        { tag: '@S-A21-HAPPY-DEVICE-ACCENT' },
        async ({ page, content }) => {
            await page.emulateMedia({ colorScheme: scheme });
            await openAdmin(page, content, '#1e8e3e');
            const accented = await primary(page);
            await openAccountMenu(page);
            // The device's accent shows: no word on why it cannot.
            await expect(page.getByText(translate('en', 'accent.hidden'))).toHaveCount(0);
            await page.keyboard.press('Escape');

            await chooseColours(page, 'accent.map');
            await expect.poll(() => primary(page)).not.toBe(accented);
            const own = await primary(page);
            await page.reload();
            await expect.poll(() => primary(page)).toBe(own);
            await chooseColours(page, 'accent.device');
            await expect.poll(() => primary(page)).toBe(accented);
        },
    );
}

test(
    "Without the device's accent the admin wears the city's own colours",
    { tag: '@S-A21-BAD-NO-DEVICE-ACCENT' },
    async ({ page, content }) => {
        await openAdmin(page, content, null);
        const shownByDefault = await primary(page);
        // A Chromium tab: Device accent says the browser does not share the device's colour, and what shows instead.
        await openAccountMenu(page);
        await expect(page.getByText(translate('en', 'accent.hidden'))).toBeVisible();
        await page.keyboard.press('Escape');

        await chooseColours(page, 'accent.map');

        // Nothing to follow: Device accent and Map colours look the same.
        await expect.poll(() => primary(page)).toBe(shownByDefault);
    },
);
