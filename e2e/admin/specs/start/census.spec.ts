import { translateCensus, type CensusKey } from '@hcm/shared/census';
import type { Page } from '@playwright/test';

import { E2E_CENSUS_COUNTS } from '../../../mock-apis/catalogue.js';
import { expectStateSound } from '../../../support/state-check.js';
import { testIdOf } from '../../../support/test.js';
import { adminVisit } from '../../../tour/states.js';
import { ADMIN_LOCK, expect, test } from '../../support/test.js';
import { allowConsent, fillPlan, START_URL, startPage, startText } from './world.js';

/**
 * M29 (`docs/research/M29-imagery-census.md`): the start page's imagery census, against the e2e world's Landsat catalogue
 * (`e2e/mock-apis/catalogue.ts`): the exact Landsat count, the declassified estimate with its price, a preview per decade; and a
 * catalogue that refuses, said in plain words with Search again.
 */
test.describe.configure({ lock: ADMIN_LOCK });

const LANDSAT = Object.values(E2E_CENSUS_COUNTS).reduce((sum, count) => sum + count, 0);
const CATALOGUE = 'https://planetarycomputer.microsoft.com/api/stac/v1/search';

function censusText(lang: 'ro' | 'en', key: CensusKey, params?: Readonly<Record<string, string>>): string {
    return translateCensus(lang, key, params);
}

async function openPlan(page: Page, testId: string, lang: 'ro' | 'en'): Promise<void> {
    await page.goto(`${START_URL}?test=${encodeURIComponent(testId)}&lang=${lang}`);
    const start = startPage(page);
    await start.getByRole('button', { name: startText(lang, 'start.signIn') }).click();
    await allowConsent(page);
    await fillPlan(page, lang);
}

test(
    'The start page counts the city’s old images from above and shows the clearest of each decade',
    { tag: '@S-A189-HAPPY' },
    async ({ page, lang, upstream }, testInfo) => {
        await upstream.scenario('firebase-hosting.fresh', 'browser');
        await openPlan(page, testIdOf(testInfo), lang);
        const census = startPage(page).locator('hcm-imagery-census');
        await expect(census.getByRole('heading', { name: censusText(lang, 'census.title') })).toBeVisible();
        await expect(census.getByText(censusText(lang, 'census.landsat', { count: String(LANDSAT) }))).toBeVisible();
        await expect(census.getByText(censusText(lang, 'census.declassified'))).toBeVisible();
        await expect(census.locator('figure img')).toHaveCount(5);
        await expect(census.getByText(censusText(lang, 'census.unlock'))).toBeVisible();
        await expectStateSound(page, adminVisit('start.census', lang));
    },
);

test(
    'A catalogue that refuses the search is said in plain words, and Search again finds the images',
    { tag: '@S-A189-BAD-CENSUS' },
    async ({ page, lang, upstream, consoleErrors }, testInfo) => {
        await upstream.scenario('firebase-hosting.fresh', 'browser');
        let refuse = true;
        await page.route(CATALOGUE, async (route) => {
            if (refuse) {
                await route.fulfill({ status: 503, body: 'busy' });
                return;
            }
            await route.fallback();
        });
        await openPlan(page, testIdOf(testInfo), lang);
        const census = startPage(page).locator('hcm-imagery-census');
        await expect(census.getByRole('alert')).toContainText(censusText(lang, 'census.failed.refused'));
        await expect(census.getByText(censusText(lang, 'census.failed.help'))).toBeVisible();
        // The browser logs the refused searches (status 503) itself: expected here, and only these.
        await expect.poll(() => consoleErrors.takeMatching(/status of 503/).length).toBeGreaterThan(0);
        await expectStateSound(page, adminVisit('start.census-failed', lang));
        refuse = false;
        await census.getByRole('button', { name: censusText(lang, 'census.retry') }).click();
        await expect(census.getByText(censusText(lang, 'census.landsat', { count: String(LANDSAT) }))).toBeVisible();
    },
);
