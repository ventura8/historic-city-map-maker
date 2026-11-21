import type { Browser, BrowserContext, Page } from '@playwright/test';
import { translateAdminShell } from '@hcm/shared';

import { contentFlowBudget } from '../../../../packages/admin/src/content/budgets.js';
import { installNetwork, Recorder } from '../../../support/network.js';
import { testIdOf } from '../../../support/test.js';
import { projectCity } from '../../support/content.js';
import type { EmulatorWorld } from '../../support/emulators.js';
import { flowText, seedPublicCity } from '../../support/flows.js';
import { signInContext } from '../../support/session.js';
import { expectStateSound } from '../../../support/state-check.js';
import { adminVisit } from '../../../tour/states.js';
import { ADMIN_LOCK, adminPath, expect, test } from '../../support/test.js';
import { ADMIN_ORIGIN } from '../../world.js';
import { seedCategories, seedPlace } from '../pois/places.js';

// One admin test at a time (the emulators are one Firebase project): see ADMIN_LOCK.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * Two admins at once (behaviour A02; docs/research/M2c-interfaces.md §2.2, §9.1): an invited admin edits a place while the
 * owner, in another browser, removes their access. The removal asks first and names the admin; afterwards the admin is
 * listed no more, their claim is gone and their sessions are revoked; their Save is refused by the rules (an admin must
 * still have `admins/{uid}`), nothing is written, and the shell says the access was removed while it keeps the page and
 * its draft on screen, read-only (Save and every action that writes off, the fields read-only: §42d), until the admin
 * signs out (DECISIONS-for-review.md §35e). An admin whose document goes
 * mid-session is refused at the next read, without waiting for the token to expire.
 */
test.use({ persona: 'admin', mapOwner: 'owner', admins: ['admin'] });

const AT = new Date('2026-10-17T09:00:00.000Z');

/** The owner's own browser: a second context signed in as the owner, behind the same firewall as the test's page. */
async function ownersBrowser(
    browser: Browser,
    emulators: EmulatorWorld,
    network: { readonly api: Parameters<typeof installNetwork>[1]; readonly testId: string; readonly blocked: Recorder },
): Promise<BrowserContext> {
    const context = await browser.newContext({ baseURL: ADMIN_ORIGIN, viewport: { width: 1440, height: 900 } });
    await signInContext(context, await emulators.signIn('owner'), Date.now());
    await installNetwork(context, network.api, network.testId, network.blocked, { upstream: true });
    return context;
}

/** The kit's open dialog (its actions are slotted content of the element). */
function dialog(page: Page) {
    return page.locator('hcm-dialog[open]');
}

test(
    'An admin whose access is removed while editing cannot save, is told, and keeps the draft until sign-out',
    { tag: ['@S-A02-BAD-REVOKE', '@S-A20-BAD-REVOKED-WHILE-EDITING'] },
    async ({ page, lang, adminWorld, browser, mockApiRequest, consoleErrors, inputBudget }, testInfo) => {
        test.setTimeout(180_000);
        const { emulators, accounts } = adminWorld;
        const city = projectCity(emulators, accounts.owner.uid);
        await seedPublicCity(city, AT);
        await seedCategories(city, AT);
        await seedPlace(city, { id: 'gara', title: 'Gara Veche', at: [26.07, 44.446] }, AT);

        // The admin opens the place and changes its title: a draft, nothing written yet.
        await page.goto(adminPath(lang, 'pois/gara'));
        const title = page.getByRole('textbox', { name: flowText(lang, 'adminContent.pois.field.titleRo') });
        await expect(title).toHaveValue('Gara Veche');
        await title.fill('Gara de Nord');

        // Meanwhile the owner removes the admin's access, which asks first and names the admin.
        const blocked = new Recorder();
        const owners = await ownersBrowser(browser, emulators, { api: mockApiRequest, testId: testIdOf(testInfo), blocked });
        const owner = await owners.newPage();
        await owner.goto(adminPath(lang, `admins/${accounts.admin.uid}`));
        // Within the budget of the admin's row, Remove access and the confirmation (the address opens the row here).
        const revoke = inputBudget.flow('revokeAdmin', contentFlowBudget('revokeAdmin'));
        await revoke.click(owner.getByRole('button', { name: flowText(lang, 'adminContent.admins.remove') }));
        await expect(
            owner.getByRole('dialog', { name: flowText(lang, 'adminContent.admins.revokeConfirm', { name: 'admin@e2e.test' }) }),
        ).toBeVisible();
        await revoke.click(dialog(owner).getByRole('button', { name: flowText(lang, 'adminContent.admins.remove') }));
        await expect.poll(() => emulators.document(`admins/${accounts.admin.uid}`)).toBeUndefined();
        await owner.goto(adminPath(lang, 'admins'));
        await expect(
            owner.getByRole('link', { name: new RegExp(translateAdminShell(lang, 'adminShell.admins.role.owner')) }),
        ).toBeVisible();
        await expect(owner.getByRole('link', { name: /admin@e2e\.test/ })).toHaveCount(0);
        const revoked = await emulators.account(accounts.admin.uid);
        expect(revoked.claims['admin']).toBeUndefined();
        expect(revoked.validSince).toBeGreaterThan(0);
        await owners.close();
        expect(blocked.take(), "the owner's browser reached only the loopback and mocked hosts").toEqual([]);

        // The admin's Save is refused by the rules (an admin must still have `admins/{uid}`) and writes nothing; the shell
        // asks admin.session again and, as the editor holds changes, keeps the page and the draft under a banner.
        const save = page.getByRole('button', { name: flowText(lang, 'adminContent.common.save'), exact: true });
        await save.click();
        const banner = page.getByRole('alert').filter({ hasText: translateAdminShell(lang, 'adminShell.session.revoked') });
        await expect(banner).toBeVisible();
        await expect(title).toHaveValue('Gara de Nord');
        await expect(page.getByText(translateAdminShell(lang, 'adminShell.auth.notAdmin'))).toHaveCount(0);
        expect((await emulators.document(`cities/${city.city}/pois/gara`))?.['title']).toEqual({ ro: 'Gara Veche' });
        // The refused commit is an HTTP 403 from Firestore, which Chromium logs.
        await expect.poll(() => consoleErrors.takeMatching(/status of 403/).length).toBeGreaterThan(0);
        // The editor's snackbar says why the Save failed; the pointer rests on it, which holds it open (its 8 s timer
        // waits while it is pointed at) for the checkers to see it whole.
        const refused = page.getByText(flowText(lang, 'adminContent.pois.denied')).and(page.locator(':not([aria-live])'));
        await refused.hover();
        await expectStateSound(page, adminVisit('session-revoked', lang));

        // The page is read-only under the banner (DECISIONS-for-review.md §42d): Save and the editor's actions are off, the
        // fields read-only (what is there can still be selected and copied), the drawing tools off; nothing more is sent.
        await expect(save).toBeDisabled();
        await expect(title).not.toBeEditable();
        await expect(title).toHaveValue('Gara de Nord');
        await expect(page.getByRole('button', { name: flowText(lang, 'adminContent.pois.delete') })).toBeDisabled();
        await expect(page.getByRole('combobox', { name: flowText(lang, 'adminContent.pois.field.category') })).toBeDisabled();
        expect(consoleErrors.takeMatching(/status of 403/)).toEqual([]);

        // Sign out asks to discard the changes first, then signs out.
        await banner.getByRole('button', { name: translateAdminShell(lang, 'adminShell.auth.signOut') }).click();
        await dialog(page)
            .getByRole('button', { name: flowText(lang, 'adminContent.common.discard') })
            .click();
        await expect(page.getByRole('button', { name: translateAdminShell(lang, 'adminShell.auth.signIn') })).toBeVisible();
        expect((await emulators.document(`cities/${city.city}/pois/gara`))?.['title']).toEqual({ ro: 'Gara Veche' });
    },
);

test(
    'An admin removed mid-session is refused at the next read, without waiting for the token to expire',
    { tag: ['@S-A20-BAD-ADMIN-REMOVED'] },
    async ({ page, lang, adminWorld, consoleErrors }) => {
        // The project's claim decides what a non-admin is told (no owner: the claim; an owner: "not an admin"), so this
        // test holds the lock: a locked test's reset empties `setup/owner` for a moment.
        const { emulators, accounts } = adminWorld;
        const city = projectCity(emulators, accounts.owner.uid);
        await seedPublicCity(city, AT);
        await seedCategories(city, AT);
        await seedPlace(city, { id: 'gara', title: 'Gara Veche', at: [26.07, 44.446] }, AT);
        await page.goto(adminPath(lang, 'pois/gara'));
        await expect(page.getByRole('textbox', { name: flowText(lang, 'adminContent.pois.field.titleRo') })).toHaveValue('Gara Veche');

        // The owner removes this admin (its document goes; its ID token still carries the claim).
        await emulators.deleteDocument(`admins/${accounts.admin.uid}`);

        // The next read is refused at once: the shell asks admin.session again and says the account is no admin.
        await page.goto(adminPath(lang, 'jobs'));
        await expect(page.getByText(translateAdminShell(lang, 'adminShell.auth.notAdmin'))).toBeVisible();
        // A refused read may reach the console as Firestore's HTTP 403 (a listener's refusal does not).
        consoleErrors.takeMatching(/status of 403/);
    },
);
