import { translateAdminShell } from '@hcm/shared';
import type { Page } from '@playwright/test';

import { expect, test } from '../../support/content-test.js';
import type { ContentWorld } from '../../support/content.js';
import { seedPhotosCity } from '../../support/photos.js';

/**
 * The tab's title and the page's language follow the admin's language (behaviour A21; the live polish of the deployed
 * admin, 2026-10-23: the title stayed "Administrarea hărții" while the screens followed an English browser). The admin is
 * opened without its `lang` parameter, so the browser's languages decide (`navigator.languages`), as for a visitor.
 */

const AT = new Date('2026-10-17T09:00:00.000Z');

/** The admin's address without the e2e `lang` parameter: the browser's language decides. */
function browserAddress(content: ContentWorld): string {
    const url = new URL(content.address('ro', 'photos', { map: false }));
    url.searchParams.delete('lang');
    return url.toString();
}

async function openAsBrowser(page: Page, content: ContentWorld): Promise<void> {
    await seedPhotosCity(content, AT);
    await page.goto(browserAddress(content));
}

test.describe('an English browser', () => {
    test.use({ locale: 'en-US' });

    test(
        "The tab's title and the page's language follow the admin's language",
        { tag: ['@S-A21-HAPPY-DOCUMENT-TITLE'] },
        async ({ page, content }) => {
            await openAsBrowser(page, content);

            await expect(page.getByRole('heading', { level: 1, name: translateAdminShell('en', 'adminShell.nav.photos') })).toBeVisible();
            await expect(page).toHaveTitle(translateAdminShell('en', 'adminShell.appName'));
            await expect(page.locator('html')).toHaveAttribute('lang', 'en');

            // Română from the account menu: the title and the language follow at once.
            await page
                .getByRole('button', { name: translateAdminShell('en', 'adminShell.account.label') })
                .filter({ visible: true })
                .click();
            await page.locator('hcm-language-select select').selectOption('ro');
            await page.keyboard.press('Escape');
            await expect(page).toHaveTitle(translateAdminShell('ro', 'adminShell.appName'));
            await expect(page.locator('html')).toHaveAttribute('lang', 'ro');
        },
    );
});

test.describe('a browser in a language the admin does not have', () => {
    // Swedish is not in UI_LOCALES (`docs/I18N.md`); German (`de`) is, so de-DE would open the admin in Deutsch.
    test.use({ locale: 'sv-SE' });

    test(
        'A browser language the admin does not have keeps the Romanian title and language',
        { tag: ['@S-A21-BAD-UNSUPPORTED-LANGUAGE'] },
        async ({ page, content }) => {
            await openAsBrowser(page, content);

            await expect(page.getByRole('heading', { level: 1, name: translateAdminShell('ro', 'adminShell.nav.photos') })).toBeVisible();
            await expect(page).toHaveTitle(translateAdminShell('ro', 'adminShell.appName'));
            await expect(page.locator('html')).toHaveAttribute('lang', 'ro');
            expect(await page.evaluate(() => navigator.language)).toBe('sv-SE');
        },
    );
});
