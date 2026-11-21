import type { Locator, Page } from '@playwright/test';

import { contentFlowBudget } from '../../../packages/admin/src/content/budgets.js';
import { setupText } from '../support/i18n.js';
import { SetupPage } from '../support/setup-page.js';
import { openStep, seedClaimedCity, seedSetupStatus, STEPS_AT, withConsent } from '../support/steps.js';
import { ADMIN_LOCK, adminPath, expect, test } from '../support/test.js';

// One admin test at a time (the emulators are one Firebase project): see ADMIN_LOCK.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * A likely free trial (docs/research/M6-interfaces.md §3.1; finding 18 of docs/research/manual-test-2026-10-25.md;
 * behaviour A60; DECISIONS-for-review.md §67f): no Google API says whether a billing account is a free trial, so an
 * account that appeared while the billing card waited (a new customer's, which Google opens as a 90-day trial) is
 * recorded as a likely trial from that day; Home reminds the owner 14 days before its end, with the link to upgrade it
 * in Google Cloud, until "It is a paid account" (one input) removes the reminder for good. An account that existed
 * before is never one.
 */

test.use({ persona: 'owner', mapOwner: 'owner' });

/** The page's time when the card waits. */
const NOW = new Date('2026-10-25T09:00:00.000Z');
const DAY_MS = 86_400_000;
const INSTALLED = {
    server: { state: 'installed', checkedAt: STEPS_AT.toISOString() },
    site: { state: 'installed', checkedAt: STEPS_AT.toISOString() },
};

test.beforeEach(async ({ page, adminWorld, upstream }) => {
    // The map's server is installed: the server card reads its functions.
    await upstream.scenario('google.deployed', 'browser');
    const owner = adminWorld.accounts.owner.uid;
    await seedClaimedCity(adminWorld.emulators, owner);
    await seedSetupStatus(adminWorld.emulators, owner, {
        billing: { state: 'missing' },
        mapbox: { state: 'ok', checkedAt: STEPS_AT, user: 'e2e-mapbox' },
        usgs: { state: 'ok', checkedAt: STEPS_AT },
        install: INSTALLED,
    });
    await page.clock.install({ time: NOW });
    await page.clock.resume();
});

async function linkButton(page: Page, lang: 'ro' | 'en'): Promise<Locator> {
    const card = await openStep(page, lang, 'billing');
    return card.getByRole('button', { name: new RegExp(`^${setupText(lang, 'adminSetup.billing.link').split('{')[0] ?? ''}`) });
}

/**
 * Home's reminders, by kind, on a page loaded at the clock's time (a second visit of the same address would be
 * in-page), once they are `expected`: the list follows the live `setup/status`, whose first answer and the records the
 * cards send after it arrive in their own time.
 */
async function expectReminders(page: Page, lang: 'ro' | 'en', expected: readonly string[]): Promise<void> {
    await page.goto(adminPath(lang, 'home'));
    await page.reload();
    await expect(page.locator('hcm-home-page')).toBeVisible();
    // The live `setup/status` has answered once a health chip shows.
    await expect(page.locator('hcm-home-page').locator('li.tag').first()).toBeVisible();
    const kinds = async (): Promise<string[]> =>
        (await page.locator('li.reminder').evaluateAll((items) => items.map((item) => item.getAttribute('data-reminder') ?? '')))
            // The server card, with the billing step's Google token, finds the seeded functions naming no release, older
            // than this admin, and records an update for Home's installation tile (A55's behaviour, not this one's).
            .filter((kind) => kind !== 'installUpdate');
    await expect.poll(kinds).toEqual(expected);
}

test(
    'A billing account made while the card waited is remembered as a likely trial; Home reminds 14 days before its end until It is a paid account',
    { tag: ['@S-A60-HAPPY'] },
    async ({ page, lang, consent, setupBudget, upstream, adminWorld, inputBudget }) => {
        await upstream.scenario('cloud-billing.noAccount', 'browser');
        await withConsent(page, consent, await linkButton(page, lang), setupBudget.inputs('billing'), setupBudget.consents('billing'));
        await expect(page.getByText(setupText(lang, 'adminSetup.billing.waitingHow'))).toBeVisible();

        // The owner creates the account on Google's page; the next look links it (no click) and records a likely trial.
        await upstream.scenario('cloud-billing.accountOpen', 'browser');
        await page.clock.fastForward(10_000);
        const setup = new SetupPage(page, lang);
        await setup.expectState('billing', 'ok');
        await expect
            .poll(async () => (await adminWorld.emulators.document('setup/status'))?.['billing'])
            .toMatchObject({ state: 'ok', trialSince: expect.anything() });
        await expect((await setup.show('billing')).getByText(setupText(lang, 'adminSetup.billing.trial'))).toBeVisible();

        // Day 75: no reminder yet; day 77 (14 days before the 90th): Home reminds, with the upgrade page.
        await page.clock.setSystemTime(new Date(NOW.getTime() + 75 * DAY_MS));
        await expectReminders(page, lang, []);
        await page.clock.setSystemTime(new Date(NOW.getTime() + 77 * DAY_MS));
        await expectReminders(page, lang, ['trial']);
        const reminder = page.locator('li[data-reminder="trial"]');
        await expect(reminder.getByRole('link', { name: new RegExp(setupText(lang, 'adminSetup.reminder.upgrade')) })).toHaveAttribute(
            'href',
            'https://console.cloud.google.com/billing',
        );

        // It is a paid account: one input, recorded for good.
        const paid = inputBudget.flow('dismissTrial', contentFlowBudget('dismissTrial'));
        await paid.click(reminder.getByRole('button', { name: setupText(lang, 'adminSetup.reminder.paid') }));
        await expect(page.locator('li[data-reminder="trial"]')).toHaveCount(0);
        await expect
            .poll(async () => (await adminWorld.emulators.document('setup/status'))?.['billing'])
            .toMatchObject({ trialPaidAt: expect.anything() });
        await page.clock.setSystemTime(new Date(NOW.getTime() + 89 * DAY_MS));
        await expectReminders(page, lang, []);
        expect(paid.used).toBe(1);
    },
);

test(
    'An account that existed before Setup is no trial: nothing recorded, no reminder at any date',
    { tag: ['@S-A60-BAD-EXISTING-ACCOUNT'] },
    async ({ page, lang, consent, setupBudget, adminWorld }) => {
        await withConsent(page, consent, await linkButton(page, lang), setupBudget.inputs('billing'), setupBudget.consents('billing'));
        const setup = new SetupPage(page, lang);
        await setup.expectState('billing', 'ok');
        await expect
            .poll(async () => (await adminWorld.emulators.document('setup/status'))?.['billing'])
            .toMatchObject({ state: 'ok', budgetAmount: 5 });
        expect((await adminWorld.emulators.document('setup/status'))?.['billing']).not.toHaveProperty('trialSince');
        await expect((await setup.show('billing')).getByText(setupText(lang, 'adminSetup.billing.trial'))).toHaveCount(0);

        for (const days of [76, 89, 120]) {
            await page.clock.setSystemTime(new Date(NOW.getTime() + days * DAY_MS));
            await expectReminders(page, lang, []);
        }
    },
);

test(
    'An account that existed before Setup can be said to be a free trial in one click; Home then announces its end',
    { tag: ['@S-A60-HAPPY-SAID-TRIAL'] },
    async ({ page, lang, consent, setupBudget, adminWorld }) => {
        // Finding 6 of the M6 review: the live map's account is exactly such a trial, which the card cannot infer.
        await withConsent(page, consent, await linkButton(page, lang), setupBudget.inputs('billing', 1), setupBudget.consents('billing'));
        const setup = new SetupPage(page, lang);
        await setup.expectState('billing', 'ok');
        const card = await setup.show('billing');

        await setupBudget.inputs('billing').click(card.getByRole('button', { name: setupText(lang, 'adminSetup.billing.markTrial') }));

        await expect(card.getByText(setupText(lang, 'adminSetup.billing.trial'))).toBeVisible();
        await expect(card.getByRole('button', { name: setupText(lang, 'adminSetup.billing.markTrial') })).toHaveCount(0);
        await expect
            .poll(async () => (await adminWorld.emulators.document('setup/status'))?.['billing'])
            .toMatchObject({ trialSince: expect.stringMatching(/^2026-10-25T09:0/) });
        await page.clock.setSystemTime(new Date(NOW.getTime() + 77 * DAY_MS));
        await expectReminders(page, lang, ['trial']);
    },
);
