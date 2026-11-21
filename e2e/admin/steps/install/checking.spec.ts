import { OLDER_SERVER_RELEASE } from '@hcm/test-support/fakes';
import type { Locator, Page, Route } from '@playwright/test';

import { expectStateSound } from '../../../support/state-check.js';
import { adminVisit } from '../../../tour/states.js';
import { apiText, setupText } from '../../support/i18n.js';
import { INSTALL_RELEASE, installState, recordsSettled, serveInstallBundle, submittedBuilds, trackRecords } from '../../support/install.js';
import { SetupPage } from '../../support/setup-page.js';
import { seedClaimedCity, seedSetupStatus, STEPS_AT, withConsent } from '../../support/steps.js';
import { ADMIN_LOCK, expect, test } from '../../support/test.js';

// One admin test at a time (the emulators are one Firebase project): see ADMIN_LOCK.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * A build recorded at work is not shown as running before a look (behaviour A55; the live finding of 2026-11-08): the
 * owner's last visit recorded the server's and the pipeline's builds at work (`setup/status.install`), and the builds
 * ended since. Right after Setup opened, steps d and d3 said "Installing" with every step "next" until Cloud Build's
 * answer turned them into "An update is ready", so a visitor could wait for an install that was not running. A recorded
 * build at work now says when it was last seen and to check again; "Checking the installation…" only while a look runs
 * (the review of 6858f8a: with no Google token nothing looked, yet the card said it was checking for good), and a look
 * Google could not answer keeps it last seen, with the error: it may still be at work.
 */

test.use({ persona: 'owner', mapOwner: 'owner' });

const OK = { state: 'ok', checkedAt: STEPS_AT };
const RECORDED = STEPS_AT.toISOString();
/** What the owner's last visit recorded: both builds at work. */
const AT_WORK = { state: 'working', release: OLDER_SERVER_RELEASE, buildId: '0e2e0b1d-0001', checkedAt: RECORDED } as const;

test.beforeEach(async ({ page, adminWorld, upstream }) => {
    trackRecords(page);
    await seedClaimedCity(adminWorld.emulators, adminWorld.accounts.owner.uid, true);
    await upstream.scenario('google.provisioned', 'server');
    await upstream.scenario('google.provisioned', 'browser');
    await upstream.scenario('install.provisioned', 'browser');
    await upstream.scenario('cloud-functions.deployedOlderRelease', 'browser');
    await seedSetupStatus(adminWorld.emulators, adminWorld.accounts.owner.uid, {
        mapbox: { ...OK, user: 'e2e-mapbox' },
        usgs: OK,
        install: { server: AT_WORK, pipeline: { ...AT_WORK, buildId: '0e2e0b1d-0002' }, site: { state: 'installed', checkedAt: RECORDED } },
    });
    await serveInstallBundle(page);
    await page.clock.install();
    await page.clock.resume();
});

// A record cut off by the page's end would hold `setup/status` in the emulator for the next test.
test.afterEach(async ({ page }) => {
    await recordsSettled(page);
});

/** A recorded build at work: when it was last seen and Check again, never "Checking", "Installing" or its steps. */
async function expectLastSeen(card: Locator, lang: 'ro' | 'en'): Promise<void> {
    const [seen = ''] = setupText(lang, 'adminSetup.install.lastSeenCheckAgain', { date: '|' }).split('|');
    await expect(installState(card)).toHaveAttribute('data-state', 'lastSeen');
    await expect(installState(card)).toContainText(seen.trim());
    await expect(card.getByText(setupText(lang, 'adminSetup.install.state.checking'))).toHaveCount(0);
    await expect(card.getByText(setupText(lang, 'adminSetup.install.state.working'), { exact: true })).toHaveCount(0);
    await expect(card.locator('.build-steps')).toHaveCount(0);
}

/** Holds Cloud Build's answers to the page until `release` is called (the look stays under way meanwhile). */
async function holdCloudBuild(page: Page): Promise<() => void> {
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
        release = resolve;
    });
    await page.route('https://cloudbuild.googleapis.com/**', async (route: Route) => {
        await held;
        await route.fallback();
    });
    return release;
}

test(
    'A build recorded at work says when it was last seen, Checking only while the look runs, then the update that is ready',
    { tag: ['@S-A55-HAPPY-RECORDED-BUILD-CHECKED'] },
    async ({ page, lang, consent, setupBudget }) => {
        const setup = new SetupPage(page, lang);
        await setup.visit('pipeline');
        const deploy = await setup.show('deploy');
        await expectLastSeen(deploy, lang);
        await expectStateSound(page, adminVisit('setup.install-last-seen', lang));

        const release = await holdCloudBuild(page);
        await withConsent(
            page,
            consent,
            deploy.getByRole('button', { name: setupText(lang, 'adminSetup.recheck') }),
            setupBudget.inputs('deploy'),
            setupBudget.consents('deploy', 1),
        );
        await expect(installState(deploy)).toHaveAttribute('data-state', 'checking');
        await expect(installState(deploy)).toContainText(setupText(lang, 'adminSetup.install.state.checking'));
        await expect(deploy.locator('.build-steps')).toHaveCount(0);
        release();
        await expect(installState(deploy)).toContainText(setupText(lang, 'adminSetup.install.state.updateAvailable'));
        await expect(deploy.getByText(setupText(lang, 'adminSetup.install.update', { release: INSTALL_RELEASE }))).toBeVisible();
        await expect(deploy.getByRole('button', { name: setupText(lang, 'adminSetup.install.updateAction') })).toBeVisible();
    },
);

test(
    'With nothing looking, a build recorded at work never reads as checking or running; a failed look keeps it last seen with the error',
    { tag: ['@S-A55-BAD-RECORDED-BUILD-NOT-RUNNING'] },
    async ({ page, lang, consent, setupBudget, upstream, consoleErrors }) => {
        const setup = new SetupPage(page, lang);
        await setup.visit('pipeline');
        await expectLastSeen(await setup.show('deploy'), lang);
        // No Google token: nothing looks, however long the page stays open, and Update the map waits for a look.
        await page.clock.fastForward(120_000);
        const deploy = await setup.show('deploy');
        await expectLastSeen(deploy, lang);
        await expectLastSeen(await setup.show('pipeline'), lang);
        expect(await submittedBuilds(upstream)).toEqual([]);

        await upstream.fail('cloud-build', 'unavailable', 'browser');
        const card = await setup.show('deploy');
        await withConsent(
            page,
            consent,
            card.getByRole('button', { name: setupText(lang, 'adminSetup.recheck') }),
            setupBudget.inputs('deploy'),
            setupBudget.consents('deploy', 1),
        );
        // A failed read says nothing of the build: it stays last seen at work, with Google's error (the review of the stale
        // fixes: as "Unavailable now" it no longer counted as at work, and Update the map came back beside it).
        await expect(installState(card)).toHaveAttribute('data-state', 'lastSeen');
        await expect(card.locator('.install [role="alert"]')).toContainText(apiText(lang, 'apiError.unavailable'));
        await expect(card.getByText(setupText(lang, 'adminSetup.install.state.checking'))).toHaveCount(0);
        await expect(card.getByRole('button', { name: setupText(lang, 'adminSetup.install.updateAction') })).toHaveCount(0);
        expect(await submittedBuilds(upstream)).toEqual([]);
        // The browser logs each 503 Cloud Build answered meanwhile (the cards keep looking).
        expect(consoleErrors.takeMatching(/503.*cloudbuild\.googleapis\.com/).length).toBeGreaterThan(0);
    },
);
