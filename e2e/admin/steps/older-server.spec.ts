import type { Page } from '@playwright/test';

import { apiText, setupText } from '../support/i18n.js';
import { answerAsOlderServer, serveInstallBundle } from '../support/install.js';
import { SetupPage } from '../support/setup-page.js';
import { seedClaimedCity, seedSetupStatus, STEPS_AT } from '../support/steps.js';
import { ADMIN_LOCK, adminPath, expect, test } from '../support/test.js';
import { E2E_PROJECT_ID } from '../world.js';

// One admin test at a time (the emulators are one Firebase project): see ADMIN_LOCK.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * The M6 admin against a server older than itself (behaviour A03; finding 27 of docs/research/manual-test-2026-10-25.md (live test 2026-10-31)):
 * the live map's admin was redeployed while its server stayed the 61 functions of `90b31be`, from before M5, and Setup
 * then read 3 of 11 with every step the server had recorded as "To do". The older server's `admin.session` answers
 * without M5's `cities` and `projectOwner`; the admin reads that answer, leaves start-up mode, and takes each step's
 * state from `setup.status`; a `setup.status` it cannot read says "Update the server to check", never "To do".
 */

test.use({ persona: 'owner', mapOwner: 'owner' });

const OK = { state: 'ok', checkedAt: STEPS_AT };

/** Steps whose state only the server's record knows (the live test's d2, e and f). */
const RECORDED_STEPS = ['claim', 'mapbox', 'usgs'] as const;

/** The live map: a pre-M6 server (61 functions, no release), the admin's start-up variant, a tab the old admin had seen the server in. */
async function liveMap(
    page: Page,
    fixtures: { readonly upstream: { scenario(name: string, world: 'browser' | 'server'): Promise<void> } },
) {
    await fixtures.upstream.scenario('install.provisioned', 'browser');
    await fixtures.upstream.scenario('cloud-functions.preM6', 'browser');
    await serveInstallBundle(page, { startUp: true });
    await page.addInitScript((projectId) => {
        localStorage.setItem('hcm:admin:serverSeen', projectId);
    }, E2E_PROJECT_ID);
    // 90b31be's admin.session: no `cities`, no `projectOwner` (both came with M5).
    await answerAsOlderServer(page, 'admin-session', (result) =>
        Object.fromEntries(Object.entries(result).filter(([key]) => key !== 'cities' && key !== 'projectOwner')),
    );
}

test.beforeEach(async ({ adminWorld, upstream }) => {
    await seedClaimedCity(adminWorld.emulators, adminWorld.accounts.owner.uid);
    await upstream.scenario('google.provisioned', 'server');
    await seedSetupStatus(adminWorld.emulators, adminWorld.accounts.owner.uid, {
        mapbox: { ...OK, user: 'e2e-mapbox' },
        usgs: OK,
    });
});

test(
    'A server from before M5 answers in its own shape: the admin leaves start-up mode and the steps it recorded stay Done',
    { tag: ['@S-A03-HAPPY-OLDER-SERVER'] },
    async ({ page, lang, upstream }) => {
        await liveMap(page, { upstream });
        const setup = new SetupPage(page, lang);

        await page.goto(adminPath(lang, 'setup'));

        for (const step of RECORDED_STEPS) {
            await setup.expectState(step, 'ok');
        }
        await expect(page.locator('hcm-setup-step[data-unknown], hcm-setup-step .status[data-unknown]')).toHaveCount(0);
    },
);

test(
    'A setup.status the admin cannot read says Update the server to check on every step it records, never To do',
    { tag: ['@S-A03-BAD-OLDER-SERVER-STATUS'] },
    async ({ page, lang, upstream }) => {
        await liveMap(page, { upstream });
        // A server whose record has a shape this admin does not know (an answer, not an outage).
        await answerAsOlderServer(page, 'setup-status', () => ({ format: 0 }));
        const setup = new SetupPage(page, lang);

        await page.goto(adminPath(lang, 'setup'));

        await expect(page.locator('hcm-setup-page').getByText(apiText(lang, 'apiError.serverOutdated'))).toBeVisible();
        // It answered this admin: the claim is done, as its record would have said.
        await setup.expectState('claim', 'ok');
        for (const step of ['mapbox', 'usgs'] as const) {
            const chip = setup.card(step).locator('.status').first();
            await expect(chip).toHaveAttribute('data-unknown', '');
            await expect(chip).toContainText(setupText(lang, 'adminSetup.state.unknown'));
            await expect(chip).not.toContainText(setupText(lang, 'adminSetup.state.missing'));
        }
    },
);
