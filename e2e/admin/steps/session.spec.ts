import type { Page } from '@playwright/test';

import { GOOGLE_SCOPES } from '../../../packages/admin/src/google/scopes.js';
import type { GoogleConsent } from '../support/consent.js';
import { apiText, setupText, shellText } from '../support/i18n.js';
import { SetupPage } from '../support/setup-page.js';
import { ADMIN_LOCK, adminPath, expect, test } from '../support/test.js';
import { E2E_PROJECT_ID, PERSONAS } from '../world.js';
import type { InputBudget } from '../../support/budget.js';

// One admin test at a time (the emulators are one Firebase project): see ADMIN_LOCK.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * Signing in, claiming the map and joining it (docs/research/M2-interfaces.md §6, M2b-interfaces.md §1.3; behaviours
 * A01, A02) against the emulators and Google's consent stand-in, with the server answering (normal mode): the daily
 * sign-in asks Google for nothing beyond the account, the claim for read-only Cloud access; who may claim is the fake
 * Resource Manager's answer for the persona, who may join is an invitation the owner stored.
 */

/** When the map was claimed or the invitation made (a fixed time). */
const AT = new Date('2026-10-01T09:00:00.000Z');

/** Signs in with Google as `email` (Google's account chooser), with the daily sign-in's consent. */
async function signIn(page: Page, lang: 'ro' | 'en', consent: GoogleConsent, budget: InputBudget, email: string): Promise<void> {
    const flow = budget.flow('signIn', 2);
    const popup = await consent.opened(page, () =>
        flow.click(page.getByRole('button', { name: shellText(lang, 'adminShell.auth.signIn') })),
    );
    await popup.chooseAccount(email);
    await popup.allow(budget.flow('signInConsent', 1));
}

test(
    'A closed Google window, at the sign-in or at the claim, changes nothing and offers the same button again',
    { tag: ['@S-A01-BAD-POPUP-CLOSED'] },
    async ({ page, lang, consent, inputBudget, adminWorld }) => {
        await page.goto(adminPath(lang));
        const signInButton = page.getByRole('button', { name: shellText(lang, 'adminShell.auth.signIn') });
        const cancelled = inputBudget.flow('cancelled', 2);

        // The sign-in's window, closed.
        const first = await consent.opened(page, () => inputBudget.flow('signInClick', 2).click(signInButton));
        await first.cancel(cancelled);
        await expect(page.getByText(shellText(lang, 'adminShell.oauth.popupClosed'))).toBeVisible();
        await expect(signInButton).toBeEnabled();

        // Signed in; the claim's window, closed.
        await signIn(page, lang, consent, inputBudget, PERSONAS.owner.email);
        const claimButton = page.getByRole('button', { name: shellText(lang, 'adminShell.auth.claimAction') });
        const claim = await consent.opened(page, () => inputBudget.flow('claimClick', 1).click(claimButton));
        expect(await claim.requestedScopes()).toEqual([GOOGLE_SCOPES.cloudReadOnly]);
        await claim.cancel(cancelled);
        await expect(page.getByText(shellText(lang, 'adminShell.oauth.popupClosed'))).toBeVisible();
        await expect(claimButton).toBeEnabled();
        expect(await adminWorld.emulators.document(`admins/${adminWorld.accounts.owner.uid}`)).toBeUndefined();
        expect(await adminWorld.emulators.document('setup/owner')).toBeUndefined();
    },
);

test(
    'A project editor who does not own the project cannot claim the map: the message names the project, nothing is written',
    { tag: ['@S-A01-BAD-NOT-OWNER'] },
    async ({ page, lang, consent, inputBudget, adminWorld, consoleErrors }) => {
        await page.goto(adminPath(lang));
        await signIn(page, lang, consent, inputBudget, PERSONAS.editor.email);

        const claimButton = page.getByRole('button', { name: shellText(lang, 'adminShell.auth.claimAction') });
        const claim = await consent.opened(page, () => inputBudget.flow('claimClick', 1).click(claimButton));
        await claim.chooseAccount(PERSONAS.editor.email);
        await claim.allow(inputBudget.flow('claimConsent', 1));

        await expect(page.getByText(apiText(lang, 'apiError.claim.notOwner', { projectId: E2E_PROJECT_ID }))).toBeVisible();
        expect(await adminWorld.emulators.document(`admins/${adminWorld.accounts.editor.uid}`)).toBeUndefined();
        expect(await adminWorld.emulators.document('setup/owner')).toBeUndefined();
        expect(consoleErrors.takeMatching(/status of 403/).length).toBeGreaterThan(0);
    },
);

test.describe('the owner signed in before the claim reached the token', () => {
    test.use({ persona: 'owner' });

    test(
        'A claim the ID token does not carry yet is picked up by one token refresh, and the dashboard opens',
        { tag: ['@S-A01-BAD-CLAIM-DELAY'] },
        async ({ page, lang, adminWorld }) => {
            // The claim landed (admins/<uid> and the custom claim) after this browser's ID token was issued.
            await adminWorld.emulators.claimFor(adminWorld.accounts.owner, AT);
            const refreshes: string[] = [];
            page.on('request', (request) => {
                if (request.url().includes('securetoken.googleapis.com/v1/token')) {
                    refreshes.push(request.url());
                }
            });
            await page.goto(adminPath(lang));

            await new SetupPage(page, lang).visit();
            await expect(page.getByRole('heading', { name: setupText(lang, 'adminSetup.step.billing') }).first()).toBeVisible();
            expect(refreshes).toHaveLength(1);
            await expect(page.getByText(shellText(lang, 'adminShell.auth.claimTitle', { projectId: E2E_PROJECT_ID }))).toHaveCount(0);
        },
    );
});

test.describe('an invitation', () => {
    test.use({ mapOwner: 'owner', invited: ['admin'] });

    test(
        'The invited Google account signs in, sees the invitation and joins: an admin with the claim, the invitation used up',
        { tag: ['@S-A02-HAPPY'] },
        async ({ page, lang, consent, inputBudget, adminWorld }) => {
            await page.goto(adminPath(lang));
            await signIn(page, lang, consent, inputBudget, PERSONAS.admin.email);

            await expect(page.getByText(shellText(lang, 'adminShell.auth.joinTitle'))).toBeVisible();
            await inputBudget.flow('join', 1).click(page.getByRole('button', { name: shellText(lang, 'adminShell.auth.joinAction') }));

            const uid = adminWorld.accounts.admin.uid;
            await expect.poll(() => adminWorld.emulators.document(`admins/${uid}`)).toEqual(expect.objectContaining({ role: 'admin' }));
            await expect(page.getByRole('navigation').first()).toBeVisible();
            expect(Object.keys(await adminWorld.emulators.collection('invites'))).toEqual([]);
            expect((await adminWorld.emulators.account(uid)).claims).toMatchObject({ admin: true });
        },
    );

    test(
        'Another Google account than the invited one does not join, is signed out, and the invitation stays',
        { tag: ['@S-A02-BAD-OTHER-ADDRESS'] },
        async ({ page, lang, consent, inputBudget, adminWorld }) => {
            await page.goto(adminPath(lang));
            await signIn(page, lang, consent, inputBudget, PERSONAS.stranger.email);

            await expect(page.getByText(shellText(lang, 'adminShell.auth.notAdmin'))).toBeVisible();
            await expect(page.getByRole('button', { name: shellText(lang, 'adminShell.auth.joinAction') })).toHaveCount(0);
            expect(Object.keys(await adminWorld.emulators.collection('invites'))).toHaveLength(1);
            expect(await adminWorld.emulators.document(`admins/${adminWorld.accounts.stranger.uid}`)).toBeUndefined();
        },
    );
});
