import type { Page } from '@playwright/test';

import { apiText, setupText, shellText } from '../../support/i18n.js';
import {
    newAdminBanner,
    preparedProject,
    redeployAdmin,
    serveInstallBundle,
    setTabVisibility,
    submittedBuilds,
    workThroughTheLook,
} from '../../support/install.js';
import { SetupPage } from '../../support/setup-page.js';
import { seedClaimedCity, seedSetupStatus } from '../../support/steps.js';
import { ADMIN_LOCK, expect, test } from '../../support/test.js';

// One admin test at a time (the emulators are one Firebase project): see ADMIN_LOCK.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * A tab left open across a redeploy of the admin (finding 29 of docs/research/manual-test-2026-10-25.md, live test
 * 2026-10-31; behaviour A61): it keeps running the old release's code, whose install builds would name the old
 * release's install bundle, which the redeploy removed (a build stopped with "fetch: manifest.json is not the one the
 * admin read"). The admin reads `runtime.json` again when the tab becomes visible, every five minutes while it is, and
 * before an install build: a newer release puts up "A new version of the admin is ready" with Reload, and an install
 * click refuses and asks for the reload instead of submitting a build.
 */

/** The release Hosting serves after the redeploy. */
const NEWER = '1.0.1+e2e0002';

test.describe('A newer admin served while the tab is open', () => {
    test.use({ persona: 'owner', mapOwner: 'owner' });

    test(
        'A redeploy seen while the owner works shows A new version of the admin is ready; Reload opens it, still signed in',
        { tag: ['@S-A61-HAPPY'] },
        async ({ page, lang, adminWorld }) => {
            await seedClaimedCity(adminWorld.emulators, adminWorld.accounts.owner.uid);
            await seedSetupStatus(adminWorld.emulators, adminWorld.accounts.owner.uid);
            await serveInstallBundle(page);
            await page.clock.install();
            await page.clock.resume();
            const setup = new SetupPage(page, lang);
            await setup.visit('mapbox');
            await expect(newAdminBanner(page)).toHaveCount(0);

            // M18 item 1: seen while the owner works on the visible tab (the five-minute look), it is the banner, not a reload.
            await redeployAdmin(page, NEWER);
            await workThroughTheLook(page);

            const banner = newAdminBanner(page);
            await expect(banner).toContainText(shellText(lang, 'adminShell.update.ready'));
            // Said politely: the banner is the content of a status region.
            await expect(
                page
                    .locator('hcm-admin-shell')
                    .getByRole('status')
                    .filter({ hasText: shellText(lang, 'adminShell.update.ready') }),
            ).toHaveCount(1);
            // Non-blocking: the page under it still works.
            await expect(setup.open('mapbox')).toBeVisible();

            await banner.getByRole('button', { name: shellText(lang, 'adminShell.update.reload') }).click();
            await expect(setup.open('mapbox')).toBeVisible({ timeout: 30_000 });
            await expect(page.getByRole('button', { name: shellText(lang, 'adminShell.auth.signIn') })).toHaveCount(0);
            await expect(newAdminBanner(page)).toHaveCount(0);
        },
    );

    // M18 item 1 (docs/research/M18-improvements.md): coming back after a deploy, nothing unsaved, the tab reloads by itself.
    test(
        'Coming back to the tab after a redeploy reloads it by itself, still signed in and without the banner',
        { tag: ['@S-A61-HAPPY-SELF-RELOAD'] },
        async ({ page, lang, adminWorld }) => {
            await seedClaimedCity(adminWorld.emulators, adminWorld.accounts.owner.uid);
            await seedSetupStatus(adminWorld.emulators, adminWorld.accounts.owner.uid);
            await serveInstallBundle(page);
            await page.clock.install();
            await page.clock.resume();
            const setup = new SetupPage(page, lang);
            await setup.visit('mapbox');
            await page.evaluate(() => {
                Object.assign(window, { hcmBeforeDeploy: true });
            });

            await redeployAdmin(page, NEWER);
            await setTabVisibility(page, 'hidden');
            await page.clock.fastForward(2 * 60_000);
            const reloaded = page.waitForEvent('load');
            await setTabVisibility(page, 'visible');
            await reloaded;

            await expect(setup.open('mapbox')).toBeVisible({ timeout: 30_000 });
            expect(await page.evaluate(() => 'hcmBeforeDeploy' in window)).toBe(false);
            await expect(page.getByRole('button', { name: shellText(lang, 'adminShell.auth.signIn') })).toHaveCount(0);
            await expect(newAdminBanner(page)).toHaveCount(0);
        },
    );
});

test.describe('The installed admin updates itself (2026-11-14)', () => {
    test.use({ persona: 'owner', mapOwner: 'owner' });

    type Emulators = Parameters<typeof seedClaimedCity>[0];

    async function openSetup(page: Page, lang: 'ro' | 'en', emulators: Emulators, uid: string): Promise<SetupPage> {
        await seedClaimedCity(emulators, uid);
        await seedSetupStatus(emulators, uid);
        await serveInstallBundle(page);
        await page.clock.install();
        await page.clock.resume();
        const setup = new SetupPage(page, lang);
        await setup.visit('mapbox');
        await page.evaluate(() => {
            Object.assign(window, { hcmBeforeDeploy: true });
        });
        return setup;
    }

    test(
        'A visible tab nobody touched for a minute reloads into a redeploy by itself, still signed in and without the banner',
        { tag: ['@S-A61-HAPPY-IDLE-RELOAD'] },
        async ({ page, lang, adminWorld }) => {
            const setup = await openSetup(page, lang, adminWorld.emulators, adminWorld.accounts.owner.uid);

            await redeployAdmin(page, NEWER);
            const reloaded = page.waitForEvent('load');
            await page.clock.fastForward(5 * 60_000);
            await reloaded;

            await expect(setup.open('mapbox')).toBeVisible({ timeout: 30_000 });
            expect(await page.evaluate(() => 'hcmBeforeDeploy' in window)).toBe(false);
            await expect(page.getByRole('button', { name: shellText(lang, 'adminShell.auth.signIn') })).toHaveCount(0);
            await expect(newAdminBanner(page)).toHaveCount(0);
        },
    );

    test(
        'A tab that already reloaded for a release never reloads for it again: the banner offers Reload instead',
        { tag: ['@S-A61-BAD-NO-RELOAD-LOOP'] },
        async ({ page, lang, adminWorld }) => {
            await openSetup(page, lang, adminWorld.emulators, adminWorld.accounts.owner.uid);
            // As if this tab had reloaded for NEWER and come back still running the older admin (a cache, lesson 707).
            await page.evaluate((release) => {
                sessionStorage.setItem('hcm-admin-reloaded-for', release);
            }, NEWER);

            await redeployAdmin(page, NEWER);
            await setTabVisibility(page, 'hidden');
            await page.clock.fastForward(2 * 60_000);
            await setTabVisibility(page, 'visible');

            await expect(newAdminBanner(page)).toContainText(shellText(lang, 'adminShell.update.ready'));
            expect(await page.evaluate(() => 'hcmBeforeDeploy' in window), 'no reload loop').toBe(true);
        },
    );
});

test(
    'An install clicked in a tab whose admin was replaced submits no build and asks for a reload',
    { tag: ['@S-A61-BAD-INSTALL-REFUSED'] },
    async ({ page, lang, consent, inputBudget, setupBudget, upstream, serverDeployment }) => {
        await serverDeployment.hide();
        const { deploy } = await preparedProject({
            ...{ page, lang, consent, setupBudget, upstream, signInBudget: inputBudget.flow('signIn', 1) },
            signInConsent: inputBudget.flow('signInConsent', 1),
        });
        // Redeployed since the tab opened, and no look has run yet: the click itself finds it out.
        await redeployAdmin(page, NEWER, { startUp: true });

        await setupBudget.inputs('deploy').click(deploy.getByRole('button', { name: setupText(lang, 'adminSetup.install.server.action') }));

        await expect(deploy).toContainText(apiText(lang, 'apiError.install.adminOutdated', { release: NEWER }));
        await expect(newAdminBanner(page)).toContainText(shellText(lang, 'adminShell.update.ready'));
        expect((await submittedBuilds(upstream)).filter((build) => build.target === 'server')).toEqual([]);
    },
);
