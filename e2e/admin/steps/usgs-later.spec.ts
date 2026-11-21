import { USGS_CREDENTIALS } from '@hcm/test-support/fakes';
import type { Page } from '@playwright/test';

import { contentFlowBudget } from '../../../packages/admin/src/content/budgets.js';
import { imageryText, readyImagery } from '../specs/imagery/world.js';
import type { EmulatorWorld } from '../support/emulators.js';
import { setupText, shellText, templatePattern } from '../support/i18n.js';
import { followDeepLink, SetupPage, standInProviderPages } from '../support/setup-page.js';
import { seedClaimedCity, seedSetupStatus, STEPS_AT } from '../support/steps.js';
import { ADMIN_LOCK, adminPath, expect, test } from '../support/test.js';

// One admin test at a time (the emulators are one Firebase project): see ADMIN_LOCK.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * USGS can wait (docs/research/M6-interfaces.md §4.1; findings 16 and 24 of docs/research/manual-test-2026-10-25.md;
 * behaviour A59), on a claimed map whose other required steps are done: **Do it later** (one input) postpones the step,
 * its chip reads Later, Setup's header says it is done with USGS for later, an empty address opens Home, whose reminder
 * offers Set up USGS until the step is done; a token waiting for USGS's M2M approval does not hold Setup back either,
 * and its reminder says since when. The Imagery area still asks for USGS first, and only USGS offers to wait.
 */

test.use({ persona: 'owner', mapOwner: 'owner' });

/** The page's time. */
const NOW = new Date('2026-10-25T09:00:00.000Z');
const OK = { state: 'ok', checkedAt: STEPS_AT };
const INSTALLED = {
    server: { state: 'installed', checkedAt: STEPS_AT.toISOString() },
    site: { state: 'installed', checkedAt: STEPS_AT.toISOString() },
};

async function seedAllBut(emulators: EmulatorWorld, owner: string, usgs: Readonly<Record<string, unknown>>): Promise<void> {
    await seedSetupStatus(emulators, owner, { mapbox: { ...OK, user: 'e2e-mapbox' }, usgs, install: INSTALLED });
}

test.beforeEach(async ({ page, adminWorld, upstream }) => {
    await seedClaimedCity(adminWorld.emulators, adminWorld.accounts.owner.uid);
    await upstream.scenario('google.provisioned', 'server');
    await standInProviderPages(page.context(), ['https://ers.cr.usgs.gov']);
    await page.clock.install({ time: NOW });
    await page.clock.resume();
});

/** Setup's "done" line. */
function doneLine(page: Page) {
    return page.locator('hcm-setup-page').locator('.ready');
}

/** Home is the page an empty address opened: its entry marked in the navigation and its page shown. */
async function expectHome(page: Page, lang: 'ro' | 'en'): Promise<void> {
    await page.goto(adminPath(lang));
    await expect(page.locator('hcm-home-page')).toBeVisible();
    await expect(page.getByRole('link', { name: shellText(lang, 'adminShell.nav.home'), exact: true }).first()).toHaveAttribute(
        'aria-current',
        'page',
    );
}

test(
    'Do it later postpones USGS with one input: the chip says Later, Setup is done, Home reminds until USGS is set up',
    { tag: ['@S-A59-HAPPY'] },
    async ({ page, lang, adminWorld, inputBudget }) => {
        test.setTimeout(150_000);
        await seedAllBut(adminWorld.emulators, adminWorld.accounts.owner.uid, { state: 'missing' });
        const setup = new SetupPage(page, lang);
        await setup.visit('usgs');
        await expect(doneLine(page)).toHaveCount(0);

        const later = inputBudget.flow('skipUsgs', contentFlowBudget('skipUsgs'));
        await later.click(setup.open('usgs').getByRole('button', { name: setupText(lang, 'adminSetup.usgs.later') }));
        await expect(setup.card('usgs').locator('.status[data-later]')).toContainText(setupText(lang, 'adminSetup.state.later'));
        await expect(doneLine(page)).toHaveText(setupText(lang, 'adminSetup.readyUsgsLater'));
        const progress = templatePattern(setupText(lang, 'adminSetup.progressLater', { done: '\u0000', total: '\u0000', later: '1' }));
        await expect(page.locator('hcm-setup-page').getByText(progress)).toBeVisible();
        await expect
            .poll(async () => (await adminWorld.emulators.document('setup/status'))?.['usgs'])
            .toMatchObject({
                state: 'missing',
                postponedAt: expect.anything(),
            });
        expect(later.used).toBe(1);

        // An empty address opens Home, which says USGS is not set up yet and leads to its step.
        await expectHome(page, lang);
        const reminder = page.locator('li[data-reminder="usgsLater"]');
        await expect(reminder).toContainText(setupText(lang, 'adminSetup.reminder.usgsLater'));
        await reminder.getByRole('link', { name: setupText(lang, 'adminSetup.reminder.setUpUsgs') }).click();

        // Set up later: the card still has every field; an approved account ends the postponement and the reminder.
        const card = await setup.show('usgs');
        await card.getByLabel(setupText(lang, 'adminSetup.usgs.username')).fill(USGS_CREDENTIALS.approved.username);
        await followDeepLink(page, () =>
            card.getByRole('link', { name: new RegExp(`^${setupText(lang, 'adminSetup.usgs.openTokenPage')}`) }).click(),
        );
        await card.getByLabel(setupText(lang, 'adminSetup.usgs.token')).fill(USGS_CREDENTIALS.approved.applicationToken);
        await card.getByLabel(setupText(lang, 'adminSetup.usgs.token')).press('Enter');
        await setup.expectState('usgs', 'ok');
        await expect(doneLine(page)).toHaveText(setupText(lang, 'adminSetup.ready'));
        await expectHome(page, lang);
        await expect(page.locator('li.reminder')).toHaveCount(0);
    },
);

test(
    "A token waiting for USGS's approval does not hold Setup back: Home opens and its reminder says since when",
    { tag: ['@S-A59-HAPPY-APPROVAL-PENDING', '@S-A59-BAD-NO-LATER-WHILE-PENDING'] },
    async ({ page, lang, adminWorld }) => {
        await seedAllBut(adminWorld.emulators, adminWorld.accounts.owner.uid, {
            state: 'pending',
            checkedAt: STEPS_AT,
            role: 'search',
            detail: 'apiError.usgs.accessPending',
            pendingSince: STEPS_AT,
        });
        const setup = new SetupPage(page, lang);
        await setup.visit('usgs');
        await expect(doneLine(page)).toHaveText(setupText(lang, 'adminSetup.readyUsgsPending'));
        await expect(setup.open('usgs').locator('.since')).toHaveText(
            setupText(lang, 'adminSetup.usgs.pendingSince', { date: '1 Oct 2026' }),
        );
        // Setup is done already: Do it later would only turn Home's "waiting since" into "not set up" (finding 8 of the
        // M6 review), so the waiting card offers none.
        await expect(setup.open('usgs').getByRole('button', { name: setupText(lang, 'adminSetup.usgs.later') })).toHaveCount(0);

        await expectHome(page, lang);
        await expect(page.locator('li[data-reminder="usgsPending"]')).toContainText(
            setupText(lang, 'adminSetup.reminder.usgsPending', { date: '1 Oct 2026' }),
        );
    },
);

test(
    'Imagery while USGS is postponed asks for USGS first and searches nothing',
    { tag: ['@S-A59-BAD-IMAGERY-WHILE-LATER'] },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        await readyImagery({ emulators: adminWorld.emulators, api: mockApiRequest, upstream }, adminWorld.accounts.owner.uid);
        await adminWorld.emulators.updateFields('setup/status', { usgs: { state: 'missing', postponedAt: STEPS_AT } }, ['usgs']);
        await page.goto(adminPath(lang, 'imagery'));

        await expect(page.getByText(imageryText(lang, 'adminContent.imagery.usgsMissing'))).toBeVisible();
        await expect(page.getByRole('link', { name: imageryText(lang, 'adminContent.imagery.openUsgsSetup') })).toHaveAttribute(
            'href',
            '#/setup/usgs',
        );
        expect(await upstream.calls('server', 'usgs')).toEqual([]);
    },
);

test(
    'Only a step that can wait offers Do it later: billing, the project, the server and Mapbox never do',
    { tag: ['@S-A59-BAD-REQUIRED-NOT-SKIPPABLE'] },
    async ({ page, lang, adminWorld }) => {
        await seedSetupStatus(adminWorld.emulators, adminWorld.accounts.owner.uid, { billing: { state: 'missing' } });
        const setup = new SetupPage(page, lang);
        await setup.visit('billing');
        const later = setupText(lang, 'adminSetup.usgs.later');

        for (const step of ['billing', 'provision', 'deploy', 'mapbox'] as const) {
            const card = await setup.show(step);
            await expect(card.getByRole('button', { name: later })).toHaveCount(0);
        }
        await expect((await setup.show('usgs')).getByRole('button', { name: later })).toBeVisible();
    },
);
