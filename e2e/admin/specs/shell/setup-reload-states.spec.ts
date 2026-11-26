import { expectStateSound } from '../../../support/state-check.js';
import { adminVisit } from '../../../tour/states.js';
import { setupText, shellText, templatePattern } from '../../support/i18n.js';
import { newAdminBanner, redeployAdmin, serveInstallBundle, workThroughTheLook } from '../../support/install.js';
import { SetupPage } from '../../support/setup-page.js';
import { seedClaimedCity, seedSetupStatus } from '../../support/steps.js';
import { ADMIN_LOCK, adminPath, expect, test } from '../../support/test.js';
import { emulatorOrigin } from '../../world.js';

// One admin test at a time (the emulators are one Firebase project): see ADMIN_LOCK.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * The tour states of the live test of 2026-10-31 and 2026-11-01 (findings 29, 32 and 34 of
 * docs/research/manual-test-2026-10-25.md; e2e/admin/specs/shell/setup-ux-states.ts) at the admin tier's five projects,
 * each reached as the owner meets it on a claimed map and checked by the generic layout and accessibility checkers:
 * Setup right after a reload while the server's record is on its way, step c after Check again without Google's
 * permission, and the banner of a newer admin. The behaviours themselves are e2e/admin/steps/status.spec.ts,
 * provision.spec.ts and install/stale-admin.spec.ts, in English at one window.
 */

test.use({ persona: 'owner', mapOwner: 'owner' });

const NOW = new Date('2026-11-01T09:00:00.000Z');

test.beforeEach(async ({ page, adminWorld, upstream }) => {
    await seedClaimedCity(adminWorld.emulators, adminWorld.accounts.owner.uid);
    await seedSetupStatus(adminWorld.emulators, adminWorld.accounts.owner.uid);
    await upstream.scenario('google.provisioned', 'server');
    await page.clock.install({ time: NOW });
    await page.clock.resume();
});

test('Setup right after a reload: every step Checking…, the header without a count', async ({ page, lang }) => {
    let release: () => void = () => undefined;
    const released = new Promise<void>((resolve) => {
        release = resolve;
    });
    await page.route(`${emulatorOrigin('functions')}/**/setup-status`, async (route) => {
        await released;
        await route.fallback();
    });
    await page.goto(adminPath(lang, 'setup'));

    await expect(page.locator('hcm-setup-step').locator('.status[data-checking]').first()).toBeVisible();
    await expect(page.locator('hcm-setup-page').locator('header .note[role="status"]')).toHaveText(setupText(lang, 'adminSetup.checking'));
    await expectStateSound(page, adminVisit('setup.loading', lang));
    release();
    await expect(page.locator('hcm-setup-step').locator('.status[data-checking]')).toHaveCount(0);
});

test("Setup, Prepare the project after Check again without Google's permission: still Done, when it was last checked", async ({
    page,
    lang,
    consent,
    setupBudget,
}) => {
    const setup = new SetupPage(page, lang);
    await setup.visit('mapbox');
    const card = await setup.show('provision');
    const popup = await consent.opened(page, () =>
        setupBudget.inputs('provision').click(card.getByRole('button', { name: setupText(lang, 'adminSetup.recheck') })),
    );
    await popup.cancel(setupBudget.consents('provision'));

    await expect(card.getByText(templatePattern(setupText(lang, 'adminSetup.provision.lastChecked', { time: '\u0000' })))).toBeVisible();
    await setup.expectState('provision', 'ok');
    await expectStateSound(page, adminVisit('setup.provision-last-checked', lang));
});

test('A newer admin was published: the banner above the page with Reload', async ({ page, lang }) => {
    await serveInstallBundle(page);
    const setup = new SetupPage(page, lang);
    await setup.visit('mapbox');
    await redeployAdmin(page, '1.0.1+e2e0002');

    // Five minutes on the page's clock, the owner at work: the visible tab's next look at runtime.json.
    await workThroughTheLook(page);
    const banner = newAdminBanner(page);
    await expect(banner.getByRole('button', { name: shellText(lang, 'adminShell.update.reload') })).toBeVisible();
    await expectStateSound(page, adminVisit('shell.new-release', lang));
});
