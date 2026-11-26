import type { Page } from '@playwright/test';

import { expectStateSound } from '../../../support/state-check.js';
import { adminVisit } from '../../../tour/states.js';
import { FUNCTIONS_TIMEOUT_MS } from '../../support/emulators.js';
import { ADMIN_LOCK, adminPath, expect, test } from '../../support/test.js';
import { awaitHarvest, cardImport, errorText, IMAGERY_AT, imageryText, readyImagery, sceneList } from './world.js';

// One admin test at a time: `ops/guard` is the project's singleton, and the import runs in the server's world.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * The budget guard's pause and its way out (behaviour A43, CR-M3-47; docs/research/M3-interfaces.md §10.2): the month's
 * Google Cloud cost reached the budget, `ops.onBudget` turned `ops/guard` red with the alert's spend, and the Imagery and
 * Jobs pages say so with the spend, while an Import is refused with why; Resume processing, asked first, turns the guard
 * green (`imagery.resumeGuard`) and the next Import starts. The public map never stopped.
 */
test.use({ persona: 'owner', mapOwner: 'owner' });

const SCENE = 'DS1035-1057DA023';

/** A message with its `{param}` holes as a pattern (`.+` for each). */
function pattern(text: string): RegExp {
    return new RegExp(text.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{\w+\}/g, '.+'));
}

/** The banner of the paused guard, on whichever page shows it. */
function banner(page: Page, lang: 'ro' | 'en') {
    return page.getByRole('status').filter({ hasText: pattern(imageryText(lang, 'adminContent.imagery.guard.paused')) });
}

test(
    'A budget pause shows the spend and refuses an import, and Resume processing turns the guard green',
    { tag: ['@S-A43-HAPPY', '@S-A43-BAD-PAUSED'] },
    async ({ page, lang, adminWorld, mockApiRequest, upstream, consoleErrors }) => {
        test.setTimeout(180_000);
        const imagery = await readyImagery(
            { emulators: adminWorld.emulators, api: mockApiRequest, upstream },
            adminWorld.accounts.owner.uid,
        );
        // The budget alert of this month: 5.37 USD of a 5 USD budget.
        await adminWorld.emulators.setDocument('ops/guard', {
            state: 'red',
            reason: 'budget',
            since: IMAGERY_AT,
            spend: { costAmount: 5.37, budgetAmount: 5, currency: 'USD', interval: '2026-10-01T07:00:00Z' },
            updatedBy: 'system:ops',
            updatedAt: IMAGERY_AT,
        });

        // Imagery: the pause with its spend, and an Import refused with why.
        await page.goto(adminPath(lang, 'imagery'));
        await awaitHarvest(page, lang);
        const cost = new Intl.NumberFormat(lang, { style: 'currency', currency: 'USD' }).format(5.37).replaceAll('\u00a0', ' ');
        await expect(banner(page, lang)).toContainText(cost);
        await expectStateSound(page, adminVisit('imagery.guard-paused', lang));
        await cardImport(page, lang, SCENE).click();
        await expect(sceneList(page, lang).getByText(errorText(lang, 'apiError.guardPaused'))).toBeVisible({
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        expect(await imagery.runs()).toHaveLength(0);
        // The refusal is the callable's 400 (failed-precondition), which the browser logs.
        expect(consoleErrors.takeMatching(/status of 400 .*imagery-import/)).toHaveLength(1);

        // Jobs says the same, and Resume processing asks first.
        await page.goto(adminPath(lang, 'jobs'));
        await expect(banner(page, lang)).toBeVisible();
        await expectStateSound(page, adminVisit('imagery.job-guard-paused', lang));
        await page.getByRole('button', { name: imageryText(lang, 'adminContent.imagery.guard.resume') }).click();
        const question = page.locator('hcm-dialog[open]');
        await expect(question).toContainText(imageryText(lang, 'adminContent.imagery.confirm.resumeBody'));
        await expectStateSound(page, adminVisit('imagery.guard-resume', lang));
        await question.getByRole('button', { name: imageryText(lang, 'adminContent.imagery.guard.resume') }).click();

        // Green again, for the rest of this budget period; the banner goes and an Import starts.
        await expect(banner(page, lang)).toBeHidden({ timeout: FUNCTIONS_TIMEOUT_MS });
        await expect
            .poll(async () => adminWorld.emulators.document('ops/guard'), { timeout: FUNCTIONS_TIMEOUT_MS })
            .toMatchObject({ state: 'green', resumedBy: adminWorld.accounts.owner.uid, resumedFor: '2026-10-01T07:00:00Z' });
        await page.goto(adminPath(lang, 'imagery'));
        await awaitHarvest(page, lang);
        await cardImport(page, lang, SCENE).click();
        await expect(page).toHaveURL(/#\/imagery\/version\//, { timeout: FUNCTIONS_TIMEOUT_MS });
    },
);
