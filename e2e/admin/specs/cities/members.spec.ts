import type { Page } from '@playwright/test';

import { contentFlowBudget } from '../../../../packages/admin/src/content/budgets.js';
import type { InputBudget } from '../../../support/budget.js';
import { expectStateSound } from '../../../support/state-check.js';
import { adminVisit } from '../../../tour/states.js';
import type { GoogleConsent } from '../../support/consent.js';
import { PROJECT_CITY } from '../../support/content.js';
import { ADMIN_LOCK, adminPath, expect, test } from '../../support/test.js';
import { PERSONAS } from '../../world.js';
import { cityMenuButton, cityText, seedCity, shellText } from './world.js';

// One admin test at a time: invitations and memberships (`invites/*`, `admins/*`) are the project's.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * Per-city admins (behaviour A51, docs/research/M5-interfaces.md §1.7): a city's owner invites an editor to that city
 * only (the invited account joins and administers it alone, without a switcher, and is not an admin of Bucharest), and
 * makes an editor an owner after the question; an editor sees the list and why they cannot change it. Against the
 * Functions emulator's `admins.*` and the consent stand-in's sign-in.
 */
test.use({ persona: 'owner', mapOwner: 'owner' });

const SECOND = 'cluj-e2e';

/** The dialog open over the page (its content is slotted into the kit's `hcm-dialog`, in the light DOM). */
function dialog(page: Page) {
    return page.locator('hcm-dialog[open]');
}

async function signIn(page: Page, lang: 'ro' | 'en', consent: GoogleConsent, budget: InputBudget, email: string): Promise<void> {
    const flow = budget.flow('signIn', 2);
    const popup = await consent.opened(page, () =>
        flow.click(page.getByRole('button', { name: shellText(lang, 'adminShell.auth.signIn') })),
    );
    await popup.chooseAccount(email);
    await popup.allow(budget.flow('signInConsent', 1));
}

test('A city owner invites an editor to one city', { tag: '@S-A51-HAPPY' }, async ({ page, lang, adminWorld, consent, inputBudget }) => {
    const { emulators, accounts } = adminWorld;
    await seedCity(emulators, PROJECT_CITY, 'București');
    await seedCity(emulators, SECOND, 'Cluj (e2e)');
    await emulators.updateFields(`admins/${accounts.owner.uid}`, { cities: { [PROJECT_CITY]: 'owner', [SECOND]: 'owner' } }, ['cities']);
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto(adminPath(lang, `c/${SECOND}/admins`));
    await expect(page.getByRole('link', { name: new RegExp(PERSONAS.owner.email) })).toBeVisible();
    await expectStateSound(page, adminVisit('cities.admins', lang));

    // Invite, the address, Enter: the link is copied at once; the invitation names the city and the editor's role.
    const flow = inputBudget.flow('inviteToCity', contentFlowBudget('inviteToCity'));
    await flow.click(page.getByRole('button', { name: shellText(lang, 'adminShell.admins.invite'), exact: true }));
    const address = dialog(page).getByLabel(shellText(lang, 'adminShell.admins.email'));
    await flow.fill(address, PERSONAS.editor.email);
    await flow.press(address, 'Enter');
    await expect(page.getByText(shellText(lang, 'adminShell.admins.copied'))).toBeVisible();
    const invites = Object.values(await emulators.collection('invites'));
    expect(invites).toEqual([expect.objectContaining({ cities: { [SECOND]: 'editor' } })]);

    // The invited account signs in and joins: it administers that city alone.
    await page.locator('hcm-account-menu hcm-icon-button').first().click();
    await dialog(page)
        .getByRole('button', { name: shellText(lang, 'adminShell.auth.signOut'), exact: true })
        .click();
    await signIn(page, lang, consent, inputBudget, PERSONAS.editor.email);
    await inputBudget.flow('join', 1).click(page.getByRole('button', { name: shellText(lang, 'adminShell.auth.joinAction') }));

    await expect.poll(() => emulators.document(`admins/${accounts.editor.uid}`)).toMatchObject({ cities: { [SECOND]: 'editor' } });
    expect((await emulators.document(`admins/${accounts.editor.uid}`))?.['cities']).toEqual({ [SECOND]: 'editor' });
    // An admin of one city: addresses without a city, and no city menu.
    await page.goto(adminPath(lang, 'photos'));
    await expect(page).toHaveURL(/#\/photos$/);
    await expect(page.locator('hcm-admin-shell')).toBeVisible();
    await expect(cityMenuButton(page)).toHaveCount(0);
});

test.describe('with an editor of Bucharest', () => {
    test.use({ admins: ['admin'] });

    test('An owner makes an editor an owner', { tag: '@S-A51-HAPPY-ROLE' }, async ({ page, lang, adminWorld, inputBudget }) => {
        const { emulators, accounts } = adminWorld;
        await seedCity(emulators, PROJECT_CITY, 'București');
        await page.goto(adminPath(lang, 'admins'));

        const flow = inputBudget.flow('setCityRole', contentFlowBudget('setCityRole'));
        await flow.click(page.getByRole('link', { name: new RegExp(PERSONAS.admin.email) }));
        const role = page.locator('hcm-admins-page select#role');
        await expect(role).toHaveValue('editor');
        await flow.selectOption(role, 'owner');
        await expect(page.getByRole('dialog')).toBeVisible();
        await expectStateSound(page, adminVisit('cities.role-confirm', lang));
        await flow.click(dialog(page).getByRole('button', { name: shellText(lang, 'adminShell.admins.roleConfirmAction'), exact: true }));

        await expect.poll(() => emulators.document(`admins/${accounts.admin.uid}`)).toMatchObject({ cities: { [PROJECT_CITY]: 'owner' } });
        await expect(role).toHaveValue('owner');
    });

    test.describe('signed in as that editor', () => {
        test.use({ persona: 'admin' });

        test('An editor cannot invite or remove', { tag: '@S-A51-BAD-EDITOR-INVITES' }, async ({ page, lang, adminWorld }) => {
            await seedCity(adminWorld.emulators, PROJECT_CITY, 'București');
            await page.goto(adminPath(lang, 'admins'));

            await expect(page.getByText(shellText(lang, 'adminShell.admins.ownerOnly'))).toBeVisible();
            await expect(page.getByRole('button', { name: shellText(lang, 'adminShell.admins.invite'), exact: true })).toHaveCount(0);
            await expectStateSound(page, adminVisit('cities.admins-editor', lang));
            await page.getByRole('link', { name: new RegExp(PERSONAS.owner.email) }).click();
            await expect(page.locator('hcm-admins-page select#role')).toHaveCount(0);
            await expect(page.getByRole('button', { name: cityText(lang, 'adminContent.admins.remove') })).toHaveCount(0);
        });
    });
});
