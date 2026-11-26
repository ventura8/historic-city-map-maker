import { OLDER_SERVER_RELEASE } from '@hcm/test-support/fakes';
import type { Page } from '@playwright/test';

import { contentFlowBudget } from '../../../../packages/admin/src/content/budgets.js';
import type { EmulatorWorld } from '../../support/emulators.js';
import { setupText, shellText } from '../../support/i18n.js';
import { installState, nextLook, recordsSettled, serveInstallBundle, submittedBuilds, trackRecords } from '../../support/install.js';
import { SetupPage } from '../../support/setup-page.js';
import { seedClaimedCity, seedSetupStatus, STEPS_AT, withConsent } from '../../support/steps.js';
import { ADMIN_LOCK, adminPath, expect, test } from '../../support/test.js';
import type { UpstreamControl } from '../../support/upstream.js';

// One admin test at a time (the emulators are one Firebase project): see ADMIN_LOCK.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * The order of Update the map (docs/research/M6-interfaces.md §1.7, behaviour A56; 2026-11-12): with the server and the
 * imagery pipeline both behind, the server goes first and the pipeline only once the server is installed. The pipeline's
 * build had finished first, so `worker.image` handed the local worker the new image while the old server still answered
 * its claims, and refused them until the server caught up.
 */

test.use({ persona: 'owner', mapOwner: 'owner' });

const OK = { state: 'ok', checkedAt: STEPS_AT };
const RECORDED = STEPS_AT.toISOString();
const BEHIND = { state: 'updateAvailable', release: OLDER_SERVER_RELEASE, checkedAt: RECORDED };

async function buildsOf(upstream: UpstreamControl, target: string) {
    return (await submittedBuilds(upstream)).filter((build) => build.target === target);
}

/** A claimed map whose server and pipeline Setup recorded behind the admin's release, its site installed. */
async function seedBothBehind(page: Page, emulators: EmulatorWorld, ownerUid: string): Promise<void> {
    await seedSetupStatus(emulators, ownerUid, {
        mapbox: { ...OK, user: 'e2e-mapbox' },
        usgs: OK,
        install: { server: BEHIND, pipeline: BEHIND, site: { state: 'installed', checkedAt: RECORDED } },
    });
    await serveInstallBundle(page);
}

test.beforeEach(async ({ page, adminWorld, upstream }) => {
    trackRecords(page);
    await seedClaimedCity(adminWorld.emulators, adminWorld.accounts.owner.uid);
    await upstream.scenario('google.provisioned', 'server');
    await upstream.scenario('google.provisioned', 'browser');
    await upstream.scenario('install.provisioned', 'browser');
    await upstream.scenario('cloud-functions.deployedOlderRelease', 'browser');
    await upstream.scenario('cloud-run.pipelineJobsOlderRelease', 'browser');
    await page.clock.install();
    await page.clock.resume();
});

// A record cut off by the page's end would hold `setup/status` in the emulator for the next test.
test.afterEach(async ({ page }) => {
    await recordsSettled(page);
});

test(
    'Update the map installs the server first and the pipeline once the server is in',
    { tag: ['@S-A56-HAPPY-UPDATE-AFTER-SERVER'] },
    async ({ page, lang, consent, inputBudget, upstream, adminWorld, consoleErrors }) => {
        await seedBothBehind(page, adminWorld.emulators, adminWorld.accounts.owner.uid);
        await page.goto(adminPath(lang, 'setup/deploy'));
        const setup = new SetupPage(page, lang);
        const update = setupText(lang, 'adminSetup.install.updateAction');
        await expect(async () => {
            await expect((await setup.show('deploy')).getByRole('button', { name: update })).toBeVisible({ timeout: 2_000 });
        }).toPass({ timeout: 30_000 });
        const deploy = setup.open('deploy');
        await withConsent(
            page,
            consent,
            deploy.getByRole('button', { name: update }),
            inputBudget.flow('updateMap', contentFlowBudget('updateMap')),
            inputBudget.flow('updateMapConsent', 1),
        );
        await expect.poll(async () => (await buildsOf(upstream, 'server')).length).toBe(1);
        expect(await buildsOf(upstream, 'pipeline')).toHaveLength(0);

        await upstream.scenario('cloud-build.finish', 'browser');
        await nextLook(page, installState(deploy).filter({ hasText: setupText(lang, 'adminSetup.install.state.installed') }));
        // The server is in: the pipeline's build goes now, with the same click's token, and installs.
        await expect.poll(async () => (await buildsOf(upstream, 'pipeline')).length).toBe(1);
        await upstream.scenario('cloud-build.finish', 'browser');
        await page.clock.fastForward(10_000);
        await setup.expectState('pipeline', 'ok');
        await expect
            .poll(async () => (await adminWorld.emulators.document('setup/status'))?.['install'])
            .toMatchObject({ server: { state: 'installed' }, pipeline: { state: 'installed' } });
        // Setup then opens the first optional step not done, Analytics, whose card asks for the stream's settings: this world's
        // project has none (a 400 the browser logs).
        consoleErrors.takeMatching(/setup-analyticsConfig/);
    },
);

test(
    'A server update that stopped never lets the pipeline go: its card still offers the update',
    { tag: ['@S-A56-BAD-UPDATE-SERVER-STOPPED'] },
    async ({ page, lang, consent, inputBudget, upstream, adminWorld }) => {
        await upstream.scenario('cloud-build.serverFailsAtFunctions', 'browser');
        await seedBothBehind(page, adminWorld.emulators, adminWorld.accounts.owner.uid);
        await page.goto(adminPath(lang, 'setup/deploy'));
        const setup = new SetupPage(page, lang);
        const update = setupText(lang, 'adminSetup.install.updateAction');
        await expect(async () => {
            await expect((await setup.show('deploy')).getByRole('button', { name: update })).toBeVisible({ timeout: 2_000 });
        }).toPass({ timeout: 30_000 });
        const deploy = setup.open('deploy');
        await withConsent(
            page,
            consent,
            deploy.getByRole('button', { name: update }),
            inputBudget.flow('updateMap', contentFlowBudget('updateMap')),
            inputBudget.flow('updateMapConsent', 1),
        );
        await expect.poll(async () => (await buildsOf(upstream, 'server')).length).toBe(1);

        await upstream.scenario('cloud-build.finish', 'browser');
        await nextLook(page, installState(deploy).filter({ hasText: setupText(lang, 'adminSetup.install.state.failed') }));
        expect(await buildsOf(upstream, 'pipeline')).toHaveLength(0);
        const pipeline = await setup.show('pipeline');
        await expect(installState(pipeline)).toContainText(setupText(lang, 'adminSetup.install.state.updateAvailable'));
        await expect(pipeline.getByRole('button', { name: update })).toBeVisible();
        // 2026-11-14: the pipeline's card says why its update did not start and where the fix is.
        await expect(pipeline).toContainText(setupText(lang, 'adminSetup.install.serverStopped'));
    },
);

test(
    "A token that ran out while the server built pauses the cards with Continue, whose consent starts the pipeline's update",
    { tag: ['@S-A56-BAD-UPDATE-TOKEN-RAN-OUT'] },
    async ({ page, lang, consent, inputBudget, upstream, adminWorld, consoleErrors }) => {
        // The live finding of 2026-11-14: the server went in after the page's Google token had run out; the watch stopped
        // without a word, the pipeline's update was dropped, and the computers kept the old processing.
        await seedBothBehind(page, adminWorld.emulators, adminWorld.accounts.owner.uid);
        await page.goto(adminPath(lang, 'setup/deploy'));
        const setup = new SetupPage(page, lang);
        const update = setupText(lang, 'adminSetup.install.updateAction');
        await expect(async () => {
            await expect((await setup.show('deploy')).getByRole('button', { name: update })).toBeVisible({ timeout: 2_000 });
        }).toPass({ timeout: 30_000 });
        const deploy = setup.open('deploy');
        await withConsent(
            page,
            consent,
            deploy.getByRole('button', { name: update }),
            inputBudget.flow('updateMap', contentFlowBudget('updateMap')),
            inputBudget.flow('updateMapConsent', 1),
        );
        await expect.poll(async () => (await buildsOf(upstream, 'server')).length).toBe(1);
        await upstream.scenario('cloud-build.start', 'browser');

        // Less than five minutes of the token's hour left: the card says it stopped following, with Continue.
        await page.clock.fastForward('56:00');
        await expect(deploy).toContainText(setupText(lang, 'adminSetup.install.followPaused'), { timeout: 30_000 });
        const proceed = deploy.getByRole('button', { name: shellText(lang, 'adminShell.session.continue') });
        await expect(proceed).toBeVisible();
        await upstream.scenario('cloud-build.finish', 'browser');
        expect(await buildsOf(upstream, 'pipeline')).toHaveLength(0);

        await withConsent(page, consent, proceed, inputBudget.flow('followContinue', 1), inputBudget.flow('followContinueConsent', 1));
        // The renewed token's look finds the server in: the held pipeline update starts by itself.
        await expect.poll(async () => (await buildsOf(upstream, 'pipeline')).length, { timeout: 30_000 }).toBe(1);
        await expect(deploy).not.toContainText(setupText(lang, 'adminSetup.install.followPaused'));
        consoleErrors.takeMatching(/setup-analyticsConfig/);
    },
);
