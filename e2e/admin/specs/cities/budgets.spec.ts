import { MAX_CITY_LIMITS } from '@hcm/shared';
import type { Locator, Page } from '@playwright/test';

import { contentFlowBudget } from '../../../../packages/admin/src/content/budgets.js';
import { expectStateSound } from '../../../support/state-check.js';
import { adminVisit } from '../../../tour/states.js';
import { expect, test } from '../../support/content-test.js';
import { seedPublicCity } from '../../support/flows.js';
import { AT, cityText, makeProjectOwner } from './world.js';

/**
 * Settings → the city's budget (behaviour A52, docs/research/M5-interfaces.md §1.8): the project's owner changes the
 * city's share of the project's budgets, one input per field moved and Save, through the Functions emulator's
 * `cities.setLimits`; every other admin reads the limits with why they cannot change them. A city created before M5 has
 * no limits of its own: the card says the project's caps alone hold it, its fields are empty, and the limits its owner
 * types are the only ones set (the others save at their maxima: docs/LESSONS.md 256).
 */

function budget(page: Page): Locator {
    return page.locator('hcm-settings-page section[data-section="budget"]');
}

function limitField(page: Page, lang: 'ro' | 'en', key: 'adminContent.budgets.computeUnits' | 'adminContent.budgets.rasterJobs'): Locator {
    return budget(page).getByLabel(cityText(lang, key), { exact: true });
}

test("The project owner sets a city's share of the budgets", { tag: '@S-A52-HAPPY' }, async ({ page, lang, content, inputBudget }) => {
    await seedPublicCity(content, AT);
    await makeProjectOwner(content);
    await page.goto(content.address(lang, 'settings/budget', { map: false }));
    await expect(limitField(page, lang, 'adminContent.budgets.computeUnits')).toHaveValue('');
    await expect(page.locator('hcm-settings-page [data-budget-caps-only]')).toHaveText(
        cityText(lang, 'adminContent.budgets.projectCapsOnly'),
    );
    await expectStateSound(page, adminVisit('cities.budget', lang));

    const flow = inputBudget.flow('setCityLimits', contentFlowBudget('setCityLimits', 2));
    await flow.fill(limitField(page, lang, 'adminContent.budgets.computeUnits'), '4');
    await flow.fill(limitField(page, lang, 'adminContent.budgets.rasterJobs'), '2');
    await flow.click(budget(page).getByRole('button', { name: cityText(lang, 'adminContent.common.save'), exact: true }));

    await expect(page.locator('hcm-snackbar').filter({ hasText: cityText(lang, 'adminContent.budgets.saved') })).toBeVisible();
    await expect
        .poll(async () => (await content.document())?.['limits'])
        .toEqual({ ...MAX_CITY_LIMITS, computeUnitsPerMonth: 4, rasterJobsPerDay: 2 });
    await page.reload();
    await expect(limitField(page, lang, 'adminContent.budgets.rasterJobs')).toHaveValue('2');
    await expect(page.locator('hcm-settings-page [data-budget-caps-only]')).toHaveCount(0);
});

test("An admin who is not the project's owner reads the budget only", async ({ page, lang, content }) => {
    await seedPublicCity(content, AT);

    await page.goto(content.address(lang, 'settings/budget', { map: false }));

    await expect(budget(page)).toContainText(cityText(lang, 'adminContent.budgets.ownerOnly'));
    await expect(limitField(page, lang, 'adminContent.budgets.computeUnits')).toHaveAttribute('readonly', '');
    await expect(budget(page).getByRole('button')).toHaveCount(0);
    await expectStateSound(page, adminVisit('cities.budget-readonly', lang));
});
