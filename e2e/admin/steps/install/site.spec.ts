import { OLDER_SITE_RELEASE } from '@hcm/test-support/fakes';
import type { Locator } from '@playwright/test';

import { E2E_CITY_ID } from '../../../fixtures/world.js';
import { hostingUrl, serveBucketCity } from '../../../support/hosting.js';
import { engineEvents, waitForEngineEvent } from '../../../support/viewer.js';
import { setupText } from '../../support/i18n.js';
import {
    followSiteRelease,
    INSTALL_RELEASE,
    INSTALL_SLUG,
    installState,
    recordsSettled,
    seedPublishedMap,
    serveInstallBundle,
    submittedBuilds,
    trackRecords,
} from '../../support/install.js';
import { SetupPage } from '../../support/setup-page.js';
import { seedClaimedCity, seedSetupStatus, STEPS_AT, withConsent } from '../../support/steps.js';
import { ADMIN_LOCK, expect, test } from '../../support/test.js';
import type { UpstreamControl } from '../../support/upstream.js';
import { ADMIN_ORIGIN, E2E_PROJECT_ID } from '../../world.js';

// One admin test at a time (the emulators are one Firebase project): see ADMIN_LOCK.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * Publish the map (step i; docs/research/M6-interfaces.md §1.4.3, §1.7, §1.8, §2.5; behaviour A57; findings 13 and 14
 * of 2026-10-25), on a claimed map whose server is installed: one click (and Google's consent, since the token of
 * Prepare the project is long gone) submits a site build of the admin's own bundle; once the fake Cloud Build publishes
 * it, the site's `/release.json` says the public variant of the admin's release, the card links the project's Hosting
 * address and `/` boots the city with one map. An older site offers Update the map; a failed build leaves the site as it
 * was; nothing published yet keeps the button off with the reason; an hour after a consent the same click asks again.
 */

test.use({ persona: 'owner', mapOwner: 'owner' });

const OK = { state: 'ok', checkedAt: STEPS_AT };

async function siteBuilds(upstream: UpstreamControl) {
    return (await submittedBuilds(upstream)).filter((build) => build.target === 'site');
}

function publishButton(card: Locator, lang: 'ro' | 'en'): Locator {
    return card.getByRole('button', { name: setupText(lang, 'adminSetup.install.site.action') });
}

test.beforeEach(async ({ page, adminWorld, upstream }) => {
    trackRecords(page);
    await seedClaimedCity(adminWorld.emulators, adminWorld.accounts.owner.uid, true);
    await seedSetupStatus(adminWorld.emulators, adminWorld.accounts.owner.uid, { mapbox: { ...OK, user: 'e2e-mapbox' } });
    await upstream.scenario('google.provisioned', 'server');
    await upstream.scenario('google.provisioned', 'browser');
    await upstream.scenario('install.provisioned', 'browser');
    await upstream.scenario('google.deployed', 'browser');
    await serveInstallBundle(page);
    await followSiteRelease(page, upstream);
    await page.clock.install();
    await page.clock.resume();
});

// A record cut off by the page's end would hold `setup/status` in the emulator for the next test.
test.afterEach(async ({ page }) => {
    await recordsSettled(page);
});

test.describe('Publish the map', () => {
    test(
        'One click publishes the viewer at the root of the Hosting site; the admin stays at /admin/',
        { tag: ['@S-A57-HAPPY'] },
        async ({ page, lang, consent, setupBudget, upstream, adminWorld }) => {
            await seedPublishedMap(adminWorld.emulators, adminWorld.accounts.owner.uid);
            const setup = new SetupPage(page, lang);
            // USGS is the first step not done: the page opens it, then the test opens Publish the map.
            await setup.visit('usgs');
            const card = await setup.show('site');

            await withConsent(page, consent, publishButton(card, lang), setupBudget.inputs('site'), setupBudget.consents('site', 1));
            await expect.poll(async () => (await siteBuilds(upstream)).length).toBe(1);
            const [build] = await siteBuilds(upstream);
            expect(build?.request.steps.map((step) => step.id)).toEqual(['fetch', 'tools', 'hosting', 'config']);
            expect(build?.tags).toEqual(['hcm-install', 'hcm-site', `hcm-r-${INSTALL_SLUG}`]);
            expect(build?.substitutions).toMatchObject({ _ORIGIN: ADMIN_ORIGIN, _RELEASE: INSTALL_RELEASE, _SLUG: INSTALL_SLUG });
            // The release replaces every file of the site, so its fetch step puts the bundle back under the admin's path.
            expect(JSON.stringify(build?.request.steps[0])).toContain('HCM_KEEP_BUNDLE=public');

            await upstream.scenario('cloud-build.finish', 'browser');
            await page.clock.fastForward(10_000);
            await setup.expectState('site', 'ok');
            // Done, the page moves on: the test opens the card again.
            const published = await setup.show('site');
            await expect(installState(published)).toContainText(setupText(lang, 'adminSetup.install.state.installed'));
            await expect(
                published.getByRole('link', { name: new RegExp(setupText(lang, 'adminSetup.install.site.open')) }),
            ).toHaveAttribute('href', `https://${E2E_PROJECT_ID}.web.app/`);
            await expect
                .poll(async () => (await adminWorld.emulators.document('setup/status'))?.['install'])
                .toMatchObject({ site: { state: 'installed', release: INSTALL_RELEASE } });

            // The Hosting root the build published boots the city with one map (the e2e Hosting serves the public tree).
            const viewer = await page.context().newPage();
            await serveBucketCity(viewer, { city: E2E_CITY_ID, site: 'bucharest' });
            await viewer.goto(hostingUrl('/', { lang }));
            await waitForEngineEvent(viewer, 'hcm-ready');
            expect(await engineEvents(viewer, 'hcm-ready')).toEqual([expect.objectContaining({ cityId: E2E_CITY_ID })]);
            await viewer.close();
        },
    );

    test(
        'A site older than the admin is republished by Update the map, after the server it waits for',
        { tag: ['@S-A57-HAPPY-UPDATE'] },
        async ({ page, lang, consent, setupBudget, upstream, adminWorld }) => {
            await seedPublishedMap(adminWorld.emulators, adminWorld.accounts.owner.uid);
            await upstream.scenario('cloud-build.siteOlderRelease', 'browser');
            const setup = new SetupPage(page, lang);
            await setup.visit('usgs');
            const card = await setup.show('site');
            await withConsent(
                page,
                consent,
                card.getByRole('button', { name: setupText(lang, 'adminSetup.recheck') }),
                setupBudget.inputs('site', 1),
                setupBudget.consents('site', 1),
            );
            // A published site counts as done (an update is offered on its card): the page moves on, the test reopens it.
            await setup.expectState('site', 'ok');
            const behind = await setup.show('site');
            await expect(installState(behind)).toContainText(setupText(lang, 'adminSetup.install.state.updateAvailable'));

            await setupBudget
                .inputs('site')
                .click(behind.getByRole('button', { name: setupText(lang, 'adminSetup.install.updateAction') }));
            // The server predates this admin too (its functions name no release): it goes alone first. The imagery pipeline, not
            // installed with nothing in its way (finding 3 of the M6 review), and the site go once the server is in (2026-11-12:
            // a pipeline image ahead of its server had the worker's claims refused; `packages/admin/src/setup/install.ts`).
            const targets = async (): Promise<string[]> =>
                (await submittedBuilds(upstream)).map((build) => build.target).toSorted((left, right) => left.localeCompare(right));
            await expect.poll(targets).toEqual(['server']);
            await upstream.scenario('cloud-build.finish', 'browser');
            await page.clock.fastForward(10_000);
            await expect.poll(targets).toEqual(['pipeline', 'server', 'site']);
            await expect.poll(async () => (await siteBuilds(upstream)).length).toBe(1);
            await upstream.scenario('cloud-build.finish', 'browser');
            await page.clock.fastForward(10_000);
            await setup.expectState('site', 'ok');
            await expect
                .poll(async () => (await adminWorld.emulators.document('setup/status'))?.['install'])
                .toMatchObject({ server: { state: 'installed' }, site: { state: 'installed' } });
            await expect(installState(await setup.show('site'))).toContainText(setupText(lang, 'adminSetup.install.state.installed'));
            expect((await upstream.snapshot('browser'))['cloud-build']).toMatchObject({ hosting: { release: INSTALL_RELEASE } });
            expect(OLDER_SITE_RELEASE).not.toBe(INSTALL_RELEASE);
        },
    );
});

test.describe('Publish the map: what stops it', () => {
    test(
        'With no published manifest Publish the map is off and says why; nothing is submitted',
        { tag: ['@S-A57-BAD-NOTHING-TO-SHOW'] },
        async ({ page, lang, consent, setupBudget, upstream }) => {
            const setup = new SetupPage(page, lang);
            await setup.visit('usgs');
            const card = await setup.show('site');

            await withConsent(page, consent, publishButton(card, lang), setupBudget.inputs('site'), setupBudget.consents('site', 1));

            await expect(card.getByText(setupText(lang, 'adminSetup.install.offReason'))).toBeVisible();
            await expect(publishButton(card, lang)).toBeDisabled();
            expect(await siteBuilds(upstream)).toEqual([]);
        },
    );

    test(
        'A failed site build leaves the site as it was; the card names the step and Try again costs one input',
        { tag: ['@S-A57-BAD-FAILED'] },
        async ({ page, lang, consent, setupBudget, upstream, adminWorld }) => {
            await seedPublishedMap(adminWorld.emulators, adminWorld.accounts.owner.uid);
            await upstream.scenario('cloud-build.siteFailsAtHosting', 'browser');
            const setup = new SetupPage(page, lang);
            await setup.visit('usgs');
            const card = await setup.show('site');
            const inputs = setupBudget.inputs('site', 1);

            await withConsent(page, consent, publishButton(card, lang), inputs, setupBudget.consents('site', 1));
            await expect.poll(async () => (await siteBuilds(upstream)).length).toBe(1);
            await upstream.scenario('cloud-build.finish', 'browser');
            await page.clock.fastForward(10_000);

            const step = setupText(lang, 'adminSetup.install.step.hosting');
            await expect(card.getByText(setupText(lang, 'adminSetup.install.failedAt', { step }))).toBeVisible();
            await expect(card.locator('pre.log')).toContainText('hosting failed');
            expect((await upstream.snapshot('browser'))['cloud-build']).toMatchObject({ hosting: null });
            await inputs.click(card.getByRole('button', { name: setupText(lang, 'adminSetup.install.tryAgain') }));
            await expect.poll(async () => (await siteBuilds(upstream)).length).toBe(2);
        },
    );

    test(
        'Hours after Prepare the project, the same click asks Google once and then publishes',
        { tag: ['@S-A57-BAD-TOKEN-EXPIRED'] },
        async ({ page, lang, consent, setupBudget, upstream, adminWorld, consoleErrors }) => {
            await seedPublishedMap(adminWorld.emulators, adminWorld.accounts.owner.uid);
            const setup = new SetupPage(page, lang);
            await setup.visit('usgs');
            const card = await setup.show('site');
            // Prepare the project's token lived an hour at most: the steps between took longer, and this tab holds none.
            await page.clock.fastForward('02:00:00');

            const publish = setupBudget.inputs('site');
            const consents = setupBudget.consents('site', 1);
            const scopes = await withConsent(page, consent, publishButton(card, lang), publish, consents);

            expect(scopes).toHaveLength(1);
            await expect.poll(async () => (await siteBuilds(upstream)).length).toBe(1);
            expect([publish.used, consents.used]).toEqual([1, 1]);
            // The hours the clock jumped make Firestore's channel check its connection (an image the admin's CSP refuses).
            consoleErrors.takeMatching(/cleardot\.gif/);
        },
    );
});
