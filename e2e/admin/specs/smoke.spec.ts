import type { Page } from '@playwright/test';

import { GOOGLE_SCOPES } from '../../../packages/admin/src/google/scopes.js';
import { recordLiveRegions } from '../../support/live-regions.js';
import { expectStateSound } from '../../support/state-check.js';
import { adminVisit } from '../../tour/states.js';
import { setupText, shellText } from '../support/i18n.js';
import { SetupPage } from '../support/setup-page.js';
import { ADMIN_LOCK, adminPath, expect, test } from '../support/test.js';
import { E2E_PROJECT_ID, PERSONAS } from '../world.js';

// One admin test at a time (the emulators are one Firebase project): see ADMIN_LOCK.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * The admin's smoke (docs/research/M2b-interfaces.md §1.3, §2.1, §3.3 d2): with the server answering (normal mode),
 * the project's owner signs in with Google, confirms the ownership with one read-only consent, and lands on the Setup
 * Assistant at its next step, billing; a stranger who signs in once the map has an owner is told the account does not
 * administer the map. Everything owned runs for real on the emulators; only Google's consent page is the stand-in.
 * Each screen on the way (the claim panel, Setup, the account menu, an unknown address's snackbar, the blocked panel)
 * runs the generic layout and accessibility checkers (behaviour A31, the admin's states of e2e/tour/states.ts).
 */

/**
 * Waits until Setup has settled: its check is done and the step it opens at (billing, the first not done) is open. A
 * state checked before that changes under the checkers: the card opening mid-walk moved the steps below it off screen.
 */
async function setupSettled(page: Page, lang: 'ro' | 'en'): Promise<void> {
    await expect(new SetupPage(page, lang).open('billing')).toBeVisible();
    await expect(page.getByRole('button', { name: setupText(lang, 'adminSetup.recheck') }).first()).toBeEnabled();
}

test(
    'The project owner claims the map with Google and reaches the dashboard',
    { tag: ['@S-A01-HAPPY', '@S-A31-HAPPY', '@S-A29-BAD-UNKNOWN-ROUTE', '@S-A27-HAPPY'] },
    async ({ page, lang, consent, setupBudget, adminWorld }) => {
        await page.context().addInitScript(recordLiveRegions);
        await page.goto(adminPath(lang));

        // The daily sign-in asks Google for nothing beyond the account (§2.1).
        const signInButton = page.getByRole('button', { name: shellText(lang, 'adminShell.auth.signIn') });
        const signIn = await consent.opened(page, () => setupBudget.inputs('signIn').click(signInButton));
        expect(await signIn.requestedScopes()).toEqual([]);
        await signIn.allow(setupBudget.consents('signIn'));

        // admin.session says the map has no owner: the claim costs one click and one read-only consent.
        await expect(page.getByText(shellText(lang, 'adminShell.auth.claimTitle', { projectId: E2E_PROJECT_ID }))).toBeVisible();
        await expectStateSound(page, adminVisit('claim', lang));
        const claimButton = page.getByRole('button', { name: shellText(lang, 'adminShell.auth.claimAction') });
        const claim = await consent.opened(page, () => setupBudget.inputs('claim', 1).click(claimButton));
        expect(await claim.requestedScopes()).toEqual([GOOGLE_SCOPES.cloudReadOnly]);
        await claim.allow(setupBudget.consents('claim', 1));

        // The dashboard of a map not set up yet is the Setup Assistant, open at its next step. In list and detail the step's
        // heading is both a row of the list and the detail's title (two headings by one name): the row's is checked here.
        const billing = new SetupPage(page, lang).card('billing');
        await expect(billing.getByRole('heading', { name: setupText(lang, 'adminSetup.step.billing') })).toBeVisible();
        const owner = adminWorld.accounts.owner.uid;
        await expect
            .poll(() => adminWorld.emulators.document(`admins/${owner}`))
            .toEqual(expect.objectContaining({ role: 'owner', email: PERSONAS.owner.email }));
        expect(await adminWorld.emulators.document('setup/owner')).toEqual(expect.objectContaining({ uid: owner }));
        await setupSettled(page, lang);
        await expectStateSound(page, adminVisit('setup-billing', lang));

        // The account menu is a dialog: Esc closes it and the focus goes back to its button.
        const account = shellText(lang, 'adminShell.account.label');
        await page.getByRole('button', { name: account }).filter({ visible: true }).click();
        await expect(page.getByRole('dialog', { name: account })).toBeVisible();
        await expectStateSound(page, adminVisit('account-menu', lang, { escape: { opener: account } }));

        // An address the admin does not know opens Setup and says so (S-A29-BAD-UNKNOWN-ROUTE).
        await page.goto(adminPath(lang, 'no-such-page'));
        const notice = shellText(lang, 'adminShell.route.notFound');
        // The snackbar's message, not its live region, which repeats the text a moment after it shows. The pointer then
        // rests on it, which holds it open (its 8 s timer waits while it is pointed at) for the checkers to see it whole.
        const message = page.getByText(notice).and(page.locator(':not([aria-live])'));
        await expect(message).toBeVisible();
        await message.hover();
        await expect(page.getByRole('heading', { name: setupText(lang, 'adminSetup.step.billing') }).first()).toBeVisible();
        await setupSettled(page, lang);
        await expectStateSound(page, adminVisit('unknown-route', lang, { announcements: [notice] }));
    },
);

test.describe('a stranger, once the map has an owner', () => {
    test.use({ persona: 'stranger', mapOwner: 'owner' });

    test(
        'A non-admin without an invitation is told and signed out',
        { tag: ['@S-A01-BAD-STRANGER', '@S-A31-HAPPY'] },
        async ({ page, lang, adminWorld }) => {
            await page.goto(adminPath(lang));

            await expect(page.getByText(shellText(lang, 'adminShell.auth.notAdmin'))).toBeVisible();
            await expectStateSound(page, adminVisit('blocked', lang));
            await page.getByRole('button', { name: shellText(lang, 'adminShell.auth.otherAccount') }).click();

            await expect(page.getByRole('button', { name: shellText(lang, 'adminShell.auth.signIn') })).toBeVisible();
            expect(await adminWorld.emulators.document(`admins/${adminWorld.accounts.stranger.uid}`)).toBeUndefined();
        },
    );
});

test.describe('the owner of a claimed map on a phone', () => {
    test.use({ persona: 'owner', mapOwner: 'owner' });

    test(
        'Rotating a phone with the account menu open gives the focus back to the account button',
        { tag: ['@S-A29-BAD-ROTATE-MENU-OPEN'] },
        async ({ page, lang }) => {
            const account = shellText(lang, 'adminShell.account.label');
            const button = page.getByRole('button', { name: account });
            const dialog = page.getByRole('dialog', { name: account });
            await page.setViewportSize({ width: 360, height: 800 });
            await page.goto(adminPath(lang));
            await setupSettled(page, lang);

            // Upright, the menu is the top bar's; held sideways (a compact height), the rail's foot holds it instead.
            for (const turned of [
                { width: 800, height: 360 },
                { width: 360, height: 800 },
            ]) {
                await button.click();
                await expect(dialog).toBeVisible();
                await page.setViewportSize(turned);
                await expect(dialog).toBeHidden();
                await expect(button).toBeFocused();
            }
        },
    );
});
