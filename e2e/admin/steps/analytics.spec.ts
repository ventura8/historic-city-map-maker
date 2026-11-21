import type { Locator, Page } from '@playwright/test';

import { GOOGLE_SCOPES } from '../../../packages/admin/src/google/scopes.js';
import { expectStateSound } from '../../support/state-check.js';
import { adminVisit } from '../../tour/states.js';
import { projectCity } from '../support/content.js';
import { apiText, setupText, shellText } from '../support/i18n.js';
import { seedPhotosCity } from '../support/photos.js';
import { followDeepLink, SetupPage, standInProviderPages } from '../support/setup-page.js';
import { ADMIN_LOCK, expect, test } from '../support/test.js';
import type { UpstreamControl } from '../support/upstream.js';

// One admin test at a time (the emulators are one Firebase project): see ADMIN_LOCK.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * The Setup Assistant's analytics and crash reports step (docs/research/M2b-interfaces.md §3.3 g; behaviour A22) on a
 * claimed, provisioned map, its owner signed in: `setup.analyticsConfig` detects Google Analytics through Firebase
 * Management (the server's world of the fake upstreams); the GA4 stream setting and the crash e-mail switch are the
 * owner's own Google calls (the browser's world), each after its consent; the crash panel lists `telemetry.listGroups`.
 */

test.use({ persona: 'owner', mapOwner: 'owner' });

/** When the claim created the city (a fixed time). */
const AT = new Date('2026-10-01T09:00:00.000Z');

test.beforeEach(async ({ page, adminWorld, upstream }) => {
    await seedPhotosCity(projectCity(adminWorld.emulators, adminWorld.accounts.owner.uid), AT);
    await upstream.scenario('google.provisioned', 'both');
    await standInProviderPages(page.context(), ['https://console.firebase.google.com']);
});

async function analyticsCard(page: Page, lang: 'ro' | 'en'): Promise<Locator> {
    const setup = new SetupPage(page, lang);
    await setup.visit();
    return setup.show('analytics');
}

test(
    'Google Analytics not enabled: the card says so with the Firebase console link, which starts the 15 s watch',
    { tag: ['@S-A22-BAD-ANALYTICS-NOT-ENABLED'] },
    async ({ page, lang, consoleErrors }) => {
        await page.clock.install();
        await page.clock.resume();
        const card = await analyticsCard(page, lang);

        await expect(card.getByText(apiText(lang, 'apiError.analytics.notEnabled'))).toBeVisible();
        await expect(card.getByText(setupText(lang, 'adminSetup.analytics.enableHow'))).toBeVisible();
        const link = card.getByRole('link', { name: new RegExp(`^${setupText(lang, 'adminSetup.link.gcp.firebaseConsole')}`) });
        await expect(link).toHaveAttribute('href', /^https:\/\/console\.firebase\.google\.com\//);
        await followDeepLink(page, () => link.click());
        await expect(card.getByRole('status').filter({ hasText: setupText(lang, 'adminSetup.analytics.watching') })).toBeVisible();
        expect(consoleErrors.takeMatching(/status of 400/).length).toBeGreaterThan(0);
    },
);

test(
    'A server account without the Firebase viewer role: the card names the role and nothing is written',
    { tag: ['@S-A22-BAD-MISSING-ROLE'] },
    async ({ page, lang, adminWorld, upstream, consoleErrors }) => {
        await upstream.fail('firebase-management', 'forbidden', 'server');
        const card = await analyticsCard(page, lang);

        await expect(
            card.getByRole('alert').filter({ hasText: apiText(lang, 'apiError.cloud.permission', { role: 'roles/firebase.viewer' }) }),
        ).toBeVisible();
        expect(await adminWorld.emulators.document('cities/bucharest')).not.toHaveProperty('analytics');
        expect(consoleErrors.takeMatching(/status of 400/).length).toBeGreaterThan(0);
    },
);

test(
    'Error Reporting down: the crash panel says so with Retry while the rest of the card works; Retry lists the reports',
    { tag: ['@S-A22-BAD-ERROR-REPORTING-UNAVAILABLE'] },
    async ({ page, lang, upstream, consoleErrors }) => {
        await upstream.scenario('firebase-management.analyticsLinked', 'server');
        await upstream.fail('error-reporting', 'unavailable', 'server');
        const card = await analyticsCard(page, lang);

        await expect(card.getByText(setupText(lang, 'adminSetup.analytics.measurementId', { id: 'G-E2E0000000' }))).toBeVisible();
        const panel = card.locator('hcm-crash-groups');
        await expect(panel.getByRole('alert')).toContainText(apiText(lang, 'apiError.errorReporting.unavailable'));
        await expect(card.getByRole('button', { name: setupText(lang, 'adminSetup.analytics.streamSetting') })).toBeEnabled();
        expect(consoleErrors.takeMatching(/status of 503/).length).toBeGreaterThan(0);

        await upstream.fail('error-reporting', null, 'server');
        await panel.getByRole('button', { name: setupText(lang, 'adminSetup.retry') }).click();
        await expect(panel.getByText(setupText(lang, 'adminSetup.crashes.none'))).toBeVisible();
        await expect(panel.getByRole('alert')).toHaveText('');
    },
);

test(
    'Without a GA4 stream the stream setting asks to enable Google Analytics first and patches nothing',
    { tag: ['@S-A22-BAD-NO-STREAM'] },
    async ({ page, lang, consent, setupBudget, upstream, consoleErrors }) => {
        // The server sees Analytics linked; the owner's own Google calls find no stream yet.
        await upstream.scenario('firebase-management.analyticsLinked', 'server');
        const card = await analyticsCard(page, lang);
        const stream = card.getByRole('button', { name: setupText(lang, 'adminSetup.analytics.streamSetting') });
        const streamConsent = await consent.opened(page, () => setupBudget.inputs('analytics').click(stream));
        expect(await streamConsent.requestedScopes()).toEqual([GOOGLE_SCOPES.analyticsEdit]);
        await streamConsent.allow(setupBudget.consents('analytics'));

        await expect(card.getByRole('alert').filter({ hasText: setupText(lang, 'adminSetup.analytics.noStream') })).toBeVisible();
        const patches = (await upstream.calls('browser')).filter((call) => call.method === 'PATCH');
        expect(patches).toEqual([]);
        consoleErrors.takeMatching(/status of 404/);
    },
);

test(
    'The crash e-mail switch turns the alert policy off and on, one click each and one consent in all',
    { tag: ['@S-A22-HAPPY-CRASH-ALERTS'] },
    async ({ page, lang, consent, setupBudget, upstream }) => {
        await upstream.scenario('firebase-management.analyticsLinked', 'both');
        await upstream.scenario('monitoring.crashAlertsProvisioned', 'browser');
        const card = await analyticsCard(page, lang);
        const emails = card.getByRole('switch', { name: setupText(lang, 'adminSetup.analytics.crashEmails') });
        await expect(emails).toBeChecked();
        const inputs = setupBudget.inputs('analytics', 1);

        const switchConsent = await consent.opened(page, () => inputs.click(emails));
        expect(await switchConsent.requestedScopes()).toEqual([GOOGLE_SCOPES.cloudPlatform]);
        await switchConsent.allow(setupBudget.consents('analytics'));
        await expect(emails).not.toBeChecked();
        await inputs.click(emails);
        await expect(emails).toBeChecked();

        const patched = (await upstream.calls('browser', 'monitoring')).filter((call) => call.method === 'PATCH');
        expect(patched.map((call) => (JSON.parse(call.body) as { enabled: boolean }).enabled)).toEqual([false, true]);
    },
);

/** §76f: the field measurements' custom definitions the fake GA4 property holds, by kind. */
async function definitions(upstream: UpstreamControl): Promise<Readonly<Record<string, unknown[]>>> {
    const snapshot = (await upstream.snapshot('browser'))['analytics-admin'] as {
        readonly definitions: Readonly<Record<string, unknown[]>>;
    };
    return snapshot.definitions;
}

test(
    'Create the measurement reports registers the field measurements on the GA4 property; a second click creates nothing',
    { tag: ['@S-A22-HAPPY-MEASUREMENT-REPORTS', '@S-A22-HAPPY-REPORTS-AGAIN-NOTHING'] },
    async ({ page, lang, consent, setupBudget, upstream }) => {
        await upstream.scenario('firebase-management.analyticsLinked', 'both');
        const card = await analyticsCard(page, lang);
        const reports = card.getByRole('button', { name: setupText(lang, 'adminSetup.analytics.reports') });
        const inputs = setupBudget.inputs('analytics', 1);

        // One consent for the Analytics Admin API, on this click only.
        const reportsConsent = await consent.opened(page, () => inputs.click(reports));
        expect(await reportsConsent.requestedScopes()).toEqual([GOOGLE_SCOPES.analyticsEdit]);
        await reportsConsent.allow(setupBudget.consents('analytics'));
        const done = card.locator('.reports');
        await expect(done).toHaveText(setupText(lang, 'adminSetup.analytics.reportsDone', { created: '23', skipped: '0' }));
        expect(await definitions(upstream)).toMatchObject({
            'properties/400000001/customDimensions': expect.arrayContaining([expect.objectContaining({ parameterName: 'window_class' })]),
            'properties/400000001/customMetrics': expect.arrayContaining([
                expect.objectContaining({ parameterName: 'duration_ms', measurementUnit: 'MILLISECONDS' }),
            ]),
        });
        await expectStateSound(page, adminVisit('setup.analytics-reports', lang));

        // Idempotent: the tab still holds the Analytics token, so no consent; every definition is there already.
        const asked = (await consent.requests()).length;
        await inputs.click(reports);
        await expect(done).toHaveText(setupText(lang, 'adminSetup.analytics.reportsDone', { created: '0', skipped: '23' }));
        expect(await consent.requests()).toHaveLength(asked);
        expect((await upstream.calls('browser', 'analytics-admin')).filter((call) => call.method === 'POST')).toHaveLength(23);
    },
);

test(
    'Create the measurement reports without a property the account can edit, or without its role, says why and creates nothing',
    { tag: ['@S-A22-BAD-REPORTS-NO-PROPERTY', '@S-A22-BAD-REPORTS-PERMISSION'] },
    async ({ page, lang, consent, setupBudget, upstream, consoleErrors }) => {
        await upstream.scenario('firebase-management.analyticsLinked', 'both');
        // The GA4 property belongs to an account the signed-in owner cannot see.
        await upstream.scenario('analytics-admin.otherAccount', 'browser');
        const card = await analyticsCard(page, lang);
        const reports = card.getByRole('button', { name: setupText(lang, 'adminSetup.analytics.reports') });
        const inputs = setupBudget.inputs('analytics', 1);
        const reportsConsent = await consent.opened(page, () => inputs.click(reports));
        await reportsConsent.allow(setupBudget.consents('analytics'));

        const noProperty = setupText(lang, 'adminSetup.analytics.noProperty', { id: 'G-E2E0000000' });
        await expect(card.getByRole('alert').filter({ hasText: noProperty })).toBeVisible();
        await expect(card.locator('.reports')).toHaveText('');

        // Its role refused on the property: the role is named.
        await upstream.fail('analytics-admin', 'forbidden', 'browser');
        await inputs.click(reports);
        const permission = apiText(lang, 'apiError.cloud.permission', { role: 'roles/analytics.editor' });
        await expect(card.getByRole('alert').filter({ hasText: permission })).toBeVisible();
        expect((await upstream.calls('browser', 'analytics-admin')).filter((call) => call.method === 'POST')).toEqual([]);
        expect(await definitions(upstream)).toEqual({});
        consoleErrors.takeMatching(/status of 403/);
    },
);

test(
    'A request this browser cannot send names its host; a new click shows only its own failure, and one that works clears it',
    { tag: ['@S-A22-BAD-REPORTS-BLOCKED-HOST', '@S-A22-BAD-REPORTS-NEW-FAILURE-ONLY', '@S-A22-HAPPY-REPORTS-UNBLOCKED'] },
    async ({ page, lang, consent, setupBudget, upstream, consoleErrors }) => {
        // Finding 48 of 2026-11-01: a DNS blocklist (Pi-hole) answered `::` for the Analytics Admin API, so the request
        // never left the browser; the network refuses it here the same way (no HTTP answer at all).
        const host = 'analyticsadmin.googleapis.com';
        await page.route(`https://${host}/**`, (route) => route.abort('addressunreachable'));
        await page.clock.install();
        await upstream.scenario('firebase-management.analyticsLinked', 'both');
        const card = await analyticsCard(page, lang);
        const reports = card.getByRole('button', { name: setupText(lang, 'adminSetup.analytics.reports') });
        // Two clicks more than the happy path: the refused one and the one that works.
        const inputs = setupBudget.inputs('analytics', 2);
        const reportsConsent = await consent.opened(page, () => inputs.click(reports));
        await reportsConsent.allow(setupBudget.consents('analytics'));
        // The transport tries a request with no answer again (1, 2 and 4 s) before it says so.
        await page.clock.fastForward(10_000);

        const blocked = card.getByRole('alert').filter({ hasText: shellText(lang, 'adminShell.network.blocked', { host }) });
        await expect(blocked).toBeVisible();
        await expect(card.getByRole('alert').filter({ hasText: apiText(lang, 'apiError.unavailable') })).toHaveCount(0);
        expect(await upstream.calls('browser', 'analytics-admin')).toEqual([]);

        // Finding 49: the next click is a new attempt; Google now answers it with a refusal, which is all the card says.
        await page.unroute(`https://${host}/**`);
        await upstream.fail('analytics-admin', 'forbidden', 'browser');
        await inputs.click(reports);
        const permission = apiText(lang, 'apiError.cloud.permission', { role: 'roles/analytics.editor' });
        await expect(card.getByRole('alert').filter({ hasText: permission })).toBeVisible();
        await expect(blocked).toHaveCount(0);

        // Allowed and permitted: the reports are made and no failure is left on the card.
        await upstream.fail('analytics-admin', null, 'browser');
        await inputs.click(reports);
        await expect(card.locator('.reports')).toHaveText(
            setupText(lang, 'adminSetup.analytics.reportsDone', { created: '23', skipped: '0' }),
        );
        // Finding 49: the last failure went with its attempt (the card's alert regions stay, empty).
        await expect(card.getByRole('alert').filter({ hasText: permission })).toHaveCount(0);
        await expect(blocked).toHaveCount(0);
        await expect(card.getByRole('alert').filter({ hasText: /\S/ })).toHaveCount(0);
        consoleErrors.takeMatching(/ERR_ADDRESS_UNREACHABLE|status of 403/);
    },
);
