import type { Page, Route } from '@playwright/test';

import { expectStateSound } from '../../../support/state-check.js';
import { adminVisit } from '../../../tour/states.js';
import type { EmulatorWorld } from '../../support/emulators.js';
import { setupText } from '../../support/i18n.js';
import { SetupPage } from '../../support/setup-page.js';
import { STEPS_AT, seedClaimedCity, seedSetupStatus, withConsent } from '../../support/steps.js';
import { ADMIN_LOCK, adminPath, expect, test } from '../../support/test.js';
import { emulatorOrigin } from '../../world.js';

// One admin test at a time (the emulators are one Firebase project): see ADMIN_LOCK.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * The M6 setup-ux states of the tour (docs/research/M6-interfaces.md §6.3; e2e/admin/specs/shell/setup-ux-states.ts) at
 * the admin tier's five projects, each reached as the owner meets it on a claimed map and checked by the generic layout
 * and accessibility checkers: billing waiting for a new account, USGS left for later and Setup done, Setup done with
 * USGS's approval pending, an optional server check off, the end of the legacy import in the snackbar, and Home's
 * reminders. The behaviours themselves are the steps' specs (e2e/admin/steps/billing.spec.ts, usgs-later.spec.ts,
 * billing-trial.spec.ts, status.spec.ts, legacy.spec.ts), in English at one window.
 */

test.use({ persona: 'owner', mapOwner: 'owner' });

/** The page's time (Home's trial reminder counts from it). */
const NOW = new Date('2026-10-25T09:00:00.000Z');
const DAY_MS = 86_400_000;
const OK = { state: 'ok', checkedAt: STEPS_AT };
/** The installer's targets as Setup records them once installed (`setup/status.install`, installer). */
const INSTALLED = {
    server: { state: 'installed', checkedAt: STEPS_AT.toISOString() },
    site: { state: 'installed', checkedAt: STEPS_AT.toISOString() },
};

/** `setup/status` with everything but USGS done (Mapbox, the server and the site too), and `usgs` as given. */
async function seedAllBut(emulators: EmulatorWorld, owner: string, usgs: Readonly<Record<string, unknown>>): Promise<void> {
    await seedSetupStatus(emulators, owner, { mapbox: { ...OK, user: 'e2e-mapbox' }, usgs, install: INSTALLED });
}

test.beforeEach(async ({ page, adminWorld, upstream }) => {
    await seedClaimedCity(adminWorld.emulators, adminWorld.accounts.owner.uid);
    await upstream.scenario('google.provisioned', 'server');
    // The map's server is installed: the server card reads its functions with the owner's token.
    await upstream.scenario('google.deployed', 'browser');
    await page.clock.install({ time: NOW });
    await page.clock.resume();
});

/** The header's "done" line of Setup. */
function doneLine(page: Page) {
    return page.locator('hcm-setup-page').locator('.ready');
}

test('Setup, billing waiting for a new account: Create a billing account and the wait in words', async ({
    page,
    lang,
    consent,
    setupBudget,
    upstream,
    adminWorld,
}) => {
    await seedSetupStatus(adminWorld.emulators, adminWorld.accounts.owner.uid, { billing: { state: 'missing' } });
    await upstream.scenario('cloud-billing.noAccount', 'browser');
    const setup = new SetupPage(page, lang);
    await setup.visit('billing');
    const card = setup.open('billing');
    const link = card.getByRole('button', { name: new RegExp(`^${setupText(lang, 'adminSetup.billing.link').split('{')[0] ?? ''}`) });
    await withConsent(page, consent, link, setupBudget.inputs('billing'), setupBudget.consents('billing'));

    await expect(card.getByRole('link', { name: new RegExp(setupText(lang, 'adminSetup.billing.create')) })).toBeVisible();
    await expect(card.getByText(setupText(lang, 'adminSetup.billing.waitingHow'))).toBeVisible();
    await expectStateSound(page, adminVisit('setup.billing-waiting', lang));
});

test('Setup, billing linked: This account is a free trial', async ({ page, lang, adminWorld }) => {
    await seedAllBut(adminWorld.emulators, adminWorld.accounts.owner.uid, OK);
    const setup = new SetupPage(page, lang);
    await setup.visit('pipeline');
    const card = await setup.show('billing');

    await expect(card.getByRole('button', { name: setupText(lang, 'adminSetup.billing.markTrial') })).toBeVisible();
    await expectStateSound(page, adminVisit('setup.billing-mark-trial', lang));
});

test('Setup, USGS left for later: Later on its chip, Setup done with USGS for later', async ({ page, lang, setupBudget, adminWorld }) => {
    await seedAllBut(adminWorld.emulators, adminWorld.accounts.owner.uid, { state: 'missing' });
    const setup = new SetupPage(page, lang);
    await setup.visit('usgs');

    await setupBudget.inputs('usgs').click(setup.open('usgs').getByRole('button', { name: setupText(lang, 'adminSetup.usgs.later') }));
    await expect(setup.card('usgs').locator('.status[data-later]')).toContainText(setupText(lang, 'adminSetup.state.later'));
    await expect(doneLine(page)).toHaveText(setupText(lang, 'adminSetup.readyUsgsLater'));
    await expectStateSound(page, adminVisit('setup.usgs-later', lang));
});

test("Setup done while USGS's approval is pending: the USGS card says since when", async ({ page, lang, adminWorld }) => {
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
    await expect(setup.open('usgs').locator('.since')).toBeVisible();
    await expectStateSound(page, adminVisit('setup.done-usgs-pending', lang));
});

test('Setup after Check again: the translation drafts off, apart and quiet; Setup still done', async ({
    page,
    lang,
    upstream,
    adminWorld,
}) => {
    await seedAllBut(adminWorld.emulators, adminWorld.accounts.owner.uid, OK);
    await upstream.scenario('vertex-ai.modelUnavailable', 'server');
    await page.goto(adminPath(lang, 'setup'));
    const selfTest = page.waitForResponse(`${emulatorOrigin('functions')}/**/setup-selfTest`);
    await page
        .getByRole('button', { name: setupText(lang, 'adminSetup.recheck') })
        .first()
        .click();
    await selfTest;

    const optional = page.locator('[data-check="ai"][data-optional]');
    await expect(optional).toContainText(setupText(lang, 'adminSetup.selfTest.off.ai'));
    await expectStateSound(page, adminVisit('setup.checks-optional-off', lang));
});

test('Setup, the legacy import ended: the snackbar says how many photos are on the map, with Open', async ({
    page,
    lang,
    adminWorld,
    consoleErrors,
}) => {
    test.setTimeout(240_000);
    await seedAllBut(adminWorld.emulators, adminWorld.accounts.owner.uid, OK);
    // The bundle's originals are gone: every photo fails at once, so the import ends in seconds.
    await page.route('**/legacy/bucharest/originals/**', (route: Route) =>
        route.fulfill({ status: 404, contentType: 'text/plain', body: 'Not found' }),
    );
    const setup = new SetupPage(page, lang);
    await page.goto(adminPath(lang, 'setup/legacyImport'));
    const card = await setup.show('legacyImport');
    await card.getByRole('button', { name: setupText(lang, 'adminSetup.import.action', { count: '57' }) }).click();

    const snackbar = page.locator('hcm-snackbar').locator('.snackbar');
    await expect(snackbar).toContainText(setupText(lang, 'adminSetup.import.someOnMap', { done: '0', total: '57' }), {
        timeout: 180_000,
    });
    // The pointer rests on it, which holds it open (its timer waits while it is pointed at) for the checkers.
    await snackbar.hover();
    await expect(snackbar.getByRole('button', { name: setupText(lang, 'adminSetup.import.open') })).toBeVisible();
    await expectStateSound(page, adminVisit('setup.import-done', lang));
    expect(consoleErrors.takeMatching(/status of 404/).length).toBeGreaterThan(0);
});

test('Home: USGS is not set up yet, with Set up USGS', async ({ page, lang, adminWorld }) => {
    await seedAllBut(adminWorld.emulators, adminWorld.accounts.owner.uid, { state: 'missing', postponedAt: STEPS_AT });
    await page.goto(adminPath(lang, 'home'));

    const reminder = page.locator('li[data-reminder="usgsLater"]');
    await expect(reminder).toContainText(setupText(lang, 'adminSetup.reminder.usgsLater'));
    await expect(reminder.getByRole('link', { name: setupText(lang, 'adminSetup.reminder.setUpUsgs') })).toHaveAttribute(
        'href',
        '#/setup/usgs',
    );
    await expectStateSound(page, adminVisit('home.usgs-later', lang));
});

test('Home: the likely free trial ends soon, with the upgrade link and It is a paid account', async ({ page, lang, adminWorld }) => {
    await seedAllBut(adminWorld.emulators, adminWorld.accounts.owner.uid, OK);
    await adminWorld.emulators.updateFields('setup/status', { billing: { ...OK, trialSince: new Date(NOW.getTime() - 80 * DAY_MS) } }, [
        'billing',
    ]);
    await page.goto(adminPath(lang, 'home'));

    const reminder = page.locator('li[data-reminder="trial"]');
    await expect(reminder.getByRole('button', { name: setupText(lang, 'adminSetup.reminder.paid') })).toBeVisible();
    await expect(reminder.getByRole('link', { name: new RegExp(setupText(lang, 'adminSetup.reminder.upgrade')) })).toHaveAttribute(
        'href',
        'https://console.cloud.google.com/billing',
    );
    await expectStateSound(page, adminVisit('home.trial-reminder', lang));
});
