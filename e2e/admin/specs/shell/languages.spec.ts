import { registerCatalogue, translate, translateAdminContent, translateAdminShell, type UiLocale } from '@hcm/shared';
import type { Page } from '@playwright/test';

import { expectStateSound } from '../../../support/state-check.js';
import { adminVisit } from '../../../tour/states.js';
import { expect, test } from '../../support/content-test.js';
import type { ContentWorld } from '../../support/content.js';
import { photosText, seedPhotosCity } from '../../support/photos.js';

/**
 * The admin in the interface's 25 languages (docs/I18N.md; behaviour A95): the account menu's language dropdown lists them all,
 * a language beyond Romanian and English is fetched from `/admin/i18n/<locale>.json` before the shell shows it and stays chosen
 * after a reload, Arabic, Persian and Urdu turn the page right to left, a key the language's file lacks shows in English, and a
 * file that cannot be fetched keeps the language and says so.
 */

const AT = new Date('2026-10-17T09:00:00.000Z');

/** The account menu's language dropdown (`<hcm-language-select>`: a native `<select>`, not a radiogroup). */
function languageList(page: Page, current: UiLocale): ReturnType<Page['getByRole']> {
    return page.getByRole('combobox', { name: translate(current, 'language.label'), exact: true });
}

/** Picks `locale` in the account menu (every language by its own name) and closes the menu. */
async function chooseLanguage(page: Page, current: UiLocale, locale: UiLocale): Promise<void> {
    await page
        .getByRole('button', { name: translateAdminShell(current, 'adminShell.account.label') })
        .filter({ visible: true })
        .click();
    await languageList(page, current).selectOption(locale);
    await page.keyboard.press('Escape');
}

/** The photos page's empty state, in the project's language. */
async function openPhotos(page: Page, lang: 'ro' | 'en', content: ContentWorld): Promise<void> {
    await seedPhotosCity(content, AT);
    await page.goto(content.address(lang, 'photos', { map: false }));
    await expect(page.getByText(photosText(lang, 'adminContent.photos.empty'))).toBeVisible();
}

test(
    'Any of the 25 languages is chosen in the account menu, fetched, shown and kept after a reload; Arabic turns the page right to left',
    { tag: ['@S-A95-HAPPY-LANGUAGE-PICKER'] },
    async ({ page, lang, content }) => {
        test.setTimeout(120_000);
        await openPhotos(page, lang, content);
        await page
            .getByRole('button', { name: translateAdminShell(lang, 'adminShell.account.label') })
            .filter({ visible: true })
            .click();
        // One dropdown named Limbă / Language, not a long list of radios (the owner, 2026-11-14).
        const list = languageList(page, lang);
        await expect(list).toBeVisible();
        await expect(list.locator('option')).toHaveCount(25);
        await expect(list.getByRole('radio')).toHaveCount(0);
        await expect(list).toHaveValue(lang);
        await page.keyboard.press('Escape');

        // The French texts as the page fetches them (`/admin/i18n/fr.json`), registered here so the test reads the same.
        const french = await page.request.get(new URL('/admin/i18n/fr.json', page.url()).href);
        registerCatalogue('fr', ((await french.json()) as { readonly messages: Record<string, string> }).messages);
        await chooseLanguage(page, lang, 'fr');
        await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
        await expect(page.getByText(translateAdminContent('fr', 'adminContent.photos.empty'))).toBeVisible();
        // Kept: the address without its `lang` (which would win) opens in French again.
        const address = new URL(page.url());
        address.searchParams.delete('lang');
        await page.goto(address.href);
        await expect(page.getByText(translateAdminContent('fr', 'adminContent.photos.empty'))).toBeVisible();

        await chooseLanguage(page, 'fr', 'ar');
        await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
        await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
        // What no Arabic file has yet shows in English inside an element marked lang="en" (docs/I18N.md → Fallback): the
        // leak check reads the page as the Arabic page it is.
        await expect(page.locator('main .scroller')).toHaveAttribute('lang', 'en');
        await expectStateSound(page, adminVisit('shell.language-rtl', 'ar'));
    },
);

test(
    "A key the chosen language's file lacks shows in English",
    { tag: ['@S-A95-BAD-MISSING-KEY-FALLS-BACK'] },
    async ({ page, lang, content }) => {
        await page.route('**/admin/i18n/fr.json', async (route) => {
            const response = await route.fetch();
            const file = (await response.json()) as { messages: Record<string, string> };
            delete file.messages['adminContent.photos.empty'];
            await route.fulfill({ response, json: file });
        });
        await openPhotos(page, lang, content);

        await chooseLanguage(page, lang, 'fr');

        await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
        await expect(page.getByText(photosText('en', 'adminContent.photos.empty'))).toBeVisible();
    },
);

test(
    'A language whose file cannot be fetched keeps the page in its language, and the snackbar says so',
    { tag: ['@S-A95-BAD-CATALOGUE-UNAVAILABLE'] },
    async ({ page, lang, content, consoleErrors }) => {
        await page.route('**/admin/i18n/de.json', (route) => route.fulfill({ status: 404, body: '' }));
        await openPhotos(page, lang, content);

        await chooseLanguage(page, lang, 'de');

        await expect(page.locator('hcm-snackbar').locator('.snackbar')).toContainText(
            translateAdminShell(lang, 'adminShell.language.unavailable', { language: 'Deutsch' }),
        );
        await expect(page.locator('html')).toHaveAttribute('lang', lang);
        await expect(page.getByText(photosText(lang, 'adminContent.photos.empty'))).toBeVisible();
        expect(consoleErrors.takeMatching(/status of 404 .*admin\/i18n\/de\.json/)).toHaveLength(1);
    },
);
