import { translateStart } from '@hcm/shared';
import type { Page } from '@playwright/test';

import { expectStateSound } from '../../../support/state-check.js';
import { testIdOf } from '../../../support/test.js';
import { adminVisit } from '../../../tour/states.js';
import { ADMIN_LOCK, expect, test } from '../../support/test.js';
import { START_URL, startPage, startText } from './world.js';

/**
 * The start page in the interface's 25 languages (docs/I18N.md; behaviour A76): its language list offers them all, a language
 * beyond Romanian and English is fetched from the page's `i18n/` folder before it shows, Urdu turns the page right to left,
 * and a file that cannot be fetched keeps the language and says so.
 */

test.describe.configure({ lock: ADMIN_LOCK });

function languageList(page: Page, lang: 'ro' | 'en'): ReturnType<Page['getByRole']> {
    return startPage(page).getByRole('combobox', { name: startText(lang, 'start.language') });
}

async function openStart(page: Page, testId: string, lang: 'ro' | 'en'): Promise<void> {
    await page.goto(`${START_URL}?test=${encodeURIComponent(testId)}&lang=${lang}`);
    await expect(startPage(page).getByRole('heading', { level: 1 })).toBeVisible();
}

test(
    'The start page lists the 25 languages; Urdu is fetched, shown right to left and kept after a reload',
    { tag: ['@S-A76-HAPPY-LANGUAGE-PICKER'] },
    async ({ page, lang }, testInfo) => {
        await openStart(page, testIdOf(testInfo), lang);
        await expect(languageList(page, lang).locator('option')).toHaveCount(25);

        await languageList(page, lang).selectOption('ur');

        await expect(page.locator('html')).toHaveAttribute('lang', 'ur');
        await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
        await expect(languageList(page, 'en')).toHaveValue('ur');
        // The choice is kept (localStorage): the address without `lang` (which would win) opens in Urdu again.
        await page.goto(`${START_URL}?test=${encodeURIComponent(testIdOf(testInfo))}`);
        await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
        await expect(startPage(page).getByRole('heading', { level: 1 })).toHaveText(translateStart('ur', 'start.title'));
        // No Urdu file exists yet: every text shows in English, inside elements marked lang="en" (docs/I18N.md → Fallback),
        // and the leak check reads the page as the Urdu page it is.
        await expect(startPage(page).locator('main')).toHaveAttribute('lang', 'en');
        await expectStateSound(page, adminVisit('start.language-rtl', 'ur'));
    },
);

test(
    "A language whose file cannot be fetched keeps the start page's language, and says so",
    { tag: ['@S-A76-BAD-LANGUAGE-UNAVAILABLE'] },
    async ({ page, lang, consoleErrors }, testInfo) => {
        await page.route('**/i18n/de.json', (route) => route.fulfill({ status: 404, body: '' }));
        await openStart(page, testIdOf(testInfo), lang);

        await languageList(page, lang).selectOption('de');

        await expect(startPage(page).getByText(startText(lang, 'start.languageUnavailable'))).toBeVisible();
        await expect(page.locator('html')).toHaveAttribute('lang', lang);
        await expect(languageList(page, lang)).toHaveValue(lang);
        expect(consoleErrors.takeMatching(/status of 404 .*i18n\/de\.json/)).toHaveLength(1);
    },
);
