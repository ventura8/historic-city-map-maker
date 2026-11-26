import type { Page } from '@playwright/test';

import { GOOGLE_SCOPES } from '../../../packages/admin/src/google/scopes.js';
import type { GoogleConsent } from '../support/consent.js';
import type { ServerDeployment } from '../support/deployment.js';
import { setupText, shellText } from '../support/i18n.js';
import { FIREBASE_USER_KEY } from '../support/session.js';
import { SetupPage } from '../support/setup-page.js';
import { ADMIN_LOCK, adminPath, expect, test } from '../support/test.js';
import { ADMIN_RUNTIME, E2E_PROJECT_ID, PERSONAS } from '../world.js';
import type { InputBudget } from '../../support/budget.js';

// One admin test at a time (the emulators are one Firebase project): see ADMIN_LOCK.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * Start-up mode (docs/research/M2b-interfaces.md §1.3, §3.2; behaviour A25): a new map's Hosting-only deploy, its server
 * not installed (hidden at the network edge), where Google decides with the signed-in account's own read-only token who
 * may start the setup: the project's owner, nobody else; a map whose server is down is told apart from a map never set
 * up; the detected steps survive a reload without any token, and a page that needs the server opens Setup.
 */

/** `/runtime.json` of a new map's Hosting-only deploy: start-up mode without the probe. */
async function startUpDeploy(page: Page, server: ServerDeployment): Promise<void> {
    await server.hide();
    await page.route('**/runtime.json', (route) => route.fulfill({ json: { ...ADMIN_RUNTIME, startUp: true } }));
}

/** The start-up sign-in: one click, Google's read-only consent with `email`'s account. */
async function signIn(page: Page, lang: 'ro' | 'en', consent: GoogleConsent, budget: InputBudget, email: string): Promise<void> {
    const button = page.getByRole('button', { name: shellText(lang, 'adminShell.auth.signIn') });
    const popup = await consent.opened(page, () => budget.flow('signIn', 1).click(button));
    expect(await popup.requestedScopes()).toEqual([GOOGLE_SCOPES.cloudReadOnly]);
    await popup.chooseAccount(email);
    await popup.allow(budget.flow('signInConsent', 1));
}

test(
    'An account that does not own the project, on a map never set up, is told so with the project and Sign out; nothing else is called',
    { tag: ['@S-A25-BAD-NOT-OWNER'] },
    async ({ page, lang, consent, inputBudget, upstream, serverDeployment }) => {
        await startUpDeploy(page, serverDeployment);
        await page.goto(adminPath(lang));
        await signIn(page, lang, consent, inputBudget, PERSONAS.editor.email);

        await expect(page.getByText(shellText(lang, 'adminShell.auth.notOwner', { projectId: E2E_PROJECT_ID }))).toBeVisible();
        await expect(page.getByRole('button', { name: shellText(lang, 'adminShell.auth.otherAccount') })).toBeVisible();
        // Google was asked who the account is, whether it owns the project and whether Cloud Functions was ever enabled.
        const operations = (await upstream.calls('browser')).map((call) => call.operation);
        expect(operations).toContain('resource-manager.testIamPermissions');
        expect(
            operations.filter((name) => !/^(google-oauth\.|resource-manager\.testIamPermissions$|service-usage\.get$)/.test(name)),
        ).toEqual([]);
        expect(serverDeployment.claimErrors()).toEqual([]);
    },
);

test.describe('a map set up and claimed', () => {
    test.use({ mapOwner: 'owner' });

    test(
        'A set-up map whose server does not answer shows Try again instead of the setup; once it answers, Try again leads to the daily sign-in',
        { tag: ['@S-A25-BAD-SERVER-DOWN'] },
        async ({ page, lang, consent, inputBudget, upstream, serverDeployment, consoleErrors }) => {
            // Cloud Functions was enabled once (the map was set up); its server does not answer now.
            await upstream.scenario('service-usage.allEnabled', 'browser');
            await serverDeployment.hide();
            await page.goto(adminPath(lang));
            await signIn(page, lang, consent, inputBudget, PERSONAS.admin.email);

            await expect(page.getByText(shellText(lang, 'adminShell.backend.down'))).toBeVisible();
            await expect(page.getByRole('button', { name: setupText(lang, 'adminSetup.step.billing') })).toHaveCount(0);
            expect(serverDeployment.claimErrors().length).toBeGreaterThan(0);

            // The account may not read the project (Google's 403 to testIamPermissions), which is no verdict of its own.
            expect(consoleErrors.takeMatching(/status of 403/).length).toBeGreaterThan(0);

            // The server answers again: Try again takes the daily path, admin.session, which knows this account is no admin.
            await serverDeployment.show();
            await page.getByRole('button', { name: shellText(lang, 'adminShell.backend.retry') }).click();
            await expect(page.getByText(shellText(lang, 'adminShell.backend.down'))).toHaveCount(0);
            await expect(page.getByText(shellText(lang, 'adminShell.auth.notAdmin'))).toBeVisible();
        },
    );
});

test(
    'A page that needs the server opens Setup in start-up mode and says why',
    { tag: ['@S-A25-BAD-PAGE-NEEDS-SERVER'] },
    async ({ page, lang, consent, inputBudget, serverDeployment }) => {
        await startUpDeploy(page, serverDeployment);
        await page.goto(adminPath(lang));
        await signIn(page, lang, consent, inputBudget, PERSONAS.owner.email);
        await expect(page.getByText(shellText(lang, 'adminShell.bootstrap.banner'))).toBeVisible();

        await page.goto(adminPath(lang, 'photos'));
        await expect(page.getByText(shellText(lang, 'adminShell.route.needsBackend')).first()).toBeVisible();
        await expect(new SetupPage(page, lang).card('billing')).toBeVisible();
        expect(new URL(page.url()).hash).toBe('#/setup');
    },
);

test(
    'A reload in start-up mode keeps the detected steps but no token, e-mail address or secret; the next step asks Google again',
    { tag: ['@S-A25-BAD-RELOAD-KEEPS-STEPS'] },
    async ({ page, lang, consent, inputBudget, setupBudget, upstream, serverDeployment }) => {
        await upstream.scenario('cloud-billing.accountOpen', 'browser');
        await startUpDeploy(page, serverDeployment);
        await page.goto(adminPath(lang));
        await signIn(page, lang, consent, inputBudget, PERSONAS.owner.email);
        const setup = new SetupPage(page, lang);
        const link = setup
            .open('billing')
            .getByRole('button', { name: new RegExp(`^${setupText(lang, 'adminSetup.billing.link').split('{')[0] ?? ''}`) });
        const billingConsent = await consent.opened(page, () => setupBudget.inputs('billing').click(link));
        await billingConsent.allow(setupBudget.consents('billing'));
        await setup.expectState('billing', 'ok');

        await page.reload();
        await signIn(page, lang, consent, inputBudget, PERSONAS.owner.email);
        await setup.expectState('billing', 'ok');
        const entries = await page.evaluate(() => Object.entries(sessionStorage));
        const own = JSON.stringify(entries.filter(([key]) => key.startsWith('hcm:')));
        expect(own).toContain('hcm:admin:bootstrap:');
        expect(own).not.toMatch(/access-token|ya29|@e2e\.test|sk\./);
        // Besides the app's own record, only Firebase Auth's session (since M6 the sign-in lives in this tab, so no page
        // of the public map on the same origin can read it: DECISIONS-for-review.md §73a), and never a Google token.
        const others = entries.filter(([key]) => !key.startsWith('hcm:')).map(([key]) => key);
        expect(others).toContain(FIREBASE_USER_KEY);
        expect(others.every((key) => key.startsWith('firebase:'))).toBe(true);
        expect(JSON.stringify(entries)).not.toMatch(/ya29|sk\./);

        // Provisioning has no token of its own scope after the reload: its click asks Google.
        const run = (await setup.show('provision')).getByRole('button', { name: setupText(lang, 'adminSetup.provision.run') });
        const provisionConsent = await consent.opened(page, () => setupBudget.inputs('provision').click(run));
        expect(await provisionConsent.requestedScopes()).toEqual([GOOGLE_SCOPES.cloudPlatform]);
        await provisionConsent.cancel(setupBudget.consents('provision'));
    },
);
