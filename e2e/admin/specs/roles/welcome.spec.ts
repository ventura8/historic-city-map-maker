import type { Page } from '@playwright/test';

import { GOOGLE_SCOPES } from '../../../../packages/admin/src/google/scopes.js';
import type { InputBudget } from '../../../support/budget.js';
import { expectStateSound } from '../../../support/state-check.js';
import { adminVisit } from '../../../tour/states.js';
import { PROJECT_CITY } from '../../support/content.js';
import { ADMIN_LOCK, adminPath, expect, test } from '../../support/test.js';
import type { GoogleConsent } from '../../support/consent.js';
import { apiText } from '../../support/i18n.js';
import type { EmulatorWorld } from '../../support/emulators.js';
import { ADMIN_PATH, E2E_PROJECT_ID, emulatorOrigin, PERSONAS } from '../../world.js';
import { AT, cityText, shellText } from '../cities/world.js';

// One admin test at a time: the emulators are one Firebase project.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * The Contribute page's welcome (docs/research/M13-roles.md §3; behaviour A92): a public visitor who follows the map's
 * Contribute link while signed out is welcomed as a contributor in the map's language, never shown the admin's sign-in,
 * and goes back to the map in one click; once signed in, an account of no role lands on the Contribute page. An admin's
 * address still shows the admin's sign-in. Every other state of the page speaks to a contributor too: a server that does
 * not answer or is busy "rests" (Try again, Back to the map), a refused session is said there, a map nobody set up is "not
 * open yet"; never the start-up mode, the owner's check with Google, the claim or "not an admin".
 */
test.use({ persona: null, mapOwner: 'owner' });

const NAMES = { ro: 'București', en: 'Bucharest' } as const;
const ADMIN_COPY = [/Map administration/, /administers the map/, /Administrarea hărții/, /administrează harta/];

/**
 * Opens the welcome as the map's link does (its language, the city's name in it); the way back is the project's first city's
 * map at the Hosting root (M6 §2.4), a stand-in page here. Returns that address.
 */
async function openWelcome(page: Page, lang: 'ro' | 'en'): Promise<string> {
    await page.goto(adminPath(lang));
    const map = new URL('/', page.url()).href;
    await page.route(map, (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Map</title>' }));
    await page.goto(`${ADMIN_PATH}?${new URLSearchParams({ lang, name: NAMES[lang] }).toString()}#/contribute/${PROJECT_CITY}`);
    await expect(page.getByRole('heading', { name: shellText(lang, 'adminShell.welcome.title', { city: NAMES[lang] }) })).toBeVisible();
    return map;
}

test(
    'A visitor from the map is welcomed as a contributor in its language and goes back to the map',
    { tag: ['@S-A92-HAPPY-WELCOME', '@S-A92-BAD-NO-ADMIN-SIGN-IN'] },
    async ({ page, lang }) => {
        const map = await openWelcome(page, lang);

        await expect(page.getByRole('button', { name: shellText(lang, 'adminShell.welcome.signIn') })).toBeVisible();
        await expect(page.getByText(shellText(lang, 'adminShell.welcome.signInNote'))).toBeVisible();
        await expect(page).toHaveTitle(`${shellText(lang, 'adminShell.welcome.tabTitle')} · ${NAMES[lang]}`);
        for (const copy of ADMIN_COPY) {
            await expect(page.getByText(copy)).toHaveCount(0);
        }
        await expect(page.getByRole('button', { name: shellText(lang, 'adminShell.auth.signIn'), exact: true })).toHaveCount(0);
        await expectStateSound(page, adminVisit('roles.contribute-welcome', lang));

        await page.getByRole('link', { name: shellText(lang, 'adminShell.welcome.back') }).click();
        await expect(page).toHaveURL(map);
    },
);

/** The city's public document, which the Contribute page reads once signed in. */
async function seedCity(emulators: EmulatorWorld): Promise<void> {
    await emulators.setDocument(`cities/${PROJECT_CITY}`, {
        name: NAMES,
        bounds: { west: 25.9, south: 44.3, east: 26.3, north: 44.6 },
        published: true,
        updatedBy: 'system:photos',
        updatedAt: AT,
    });
}

/** The welcome's one sign-in, with the stranger's account; returns the scopes Google was asked for. */
async function signInFromWelcome(page: Page, lang: 'ro' | 'en', consent: GoogleConsent, budget: InputBudget): Promise<string[]> {
    const popup = await consent.opened(page, () =>
        budget.flow('contributeSignIn', 1).click(page.getByRole('button', { name: shellText(lang, 'adminShell.welcome.signIn') })),
    );
    const scopes = await popup.requestedScopes();
    await popup.chooseAccount(PERSONAS.stranger.email);
    await popup.allow(budget.flow('contributeSignInConsent', 1));
    return scopes;
}

/** The contributor's blocked panel: the welcome's heading, `message`, Back to the map and none of the administration's words. */
async function expectContributorPanel(page: Page, lang: 'ro' | 'en', message: string): Promise<void> {
    await expect(page.getByText(message)).toBeVisible();
    await expect(page.getByRole('heading', { name: shellText(lang, 'adminShell.welcome.title', { city: NAMES[lang] }) })).toBeVisible();
    await expect(page.getByRole('link', { name: shellText(lang, 'adminShell.welcome.back') })).toBeVisible();
    for (const copy of [...ADMIN_COPY, new RegExp(shellText(lang, 'adminShell.auth.otherAccount'))]) {
        await expect(page.getByText(copy)).toHaveCount(0);
    }
}

/** From now on the signed-in `admin.session` fails as `error` says (the anonymous probe already had its answer). */
async function failSession(page: Page, httpStatus: number, error: { readonly status: string; readonly code: string }): Promise<void> {
    await page.route(`${emulatorOrigin('functions')}/**/admin-session`, async (route) => {
        const response = await route.fetch();
        const body = { status: error.status, message: error.code, details: { code: error.code } };
        await route.fulfill({ response, status: httpStatus, json: { error: body } });
    });
}

test(
    'Signing in from the welcome lands an account of no role on the Contribute page, never on the admin',
    { tag: '@S-A92-HAPPY-WELCOME-SIGN-IN' },
    async ({ page, lang, adminWorld, consent, inputBudget }) => {
        await seedCity(adminWorld.emulators);
        await openWelcome(page, lang);

        await signInFromWelcome(page, lang, consent, inputBudget);

        await expect(page.getByLabel(cityText(lang, 'adminContent.contribute.reason'))).toBeVisible();
        await expect(page).toHaveURL(new RegExp(`#/contribute/${PROJECT_CITY}$`));
        await expect(page.getByRole('navigation')).toHaveCount(0);
        expect(await adminWorld.emulators.document(`admins/${adminWorld.accounts.stranger.uid}`)).toBeUndefined();
    },
);

test('An admin address signed out still shows the admin sign-in', { tag: '@S-A92-BAD-ADMIN-ROUTE' }, async ({ page, lang }) => {
    await page.goto(adminPath(lang, 'photos'));

    await expect(page.getByRole('heading', { name: shellText(lang, 'adminShell.appName') })).toBeVisible();
    await expect(page.getByText(shellText(lang, 'adminShell.auth.signInIntro'))).toBeVisible();
    await expect(page.getByRole('button', { name: shellText(lang, 'adminShell.auth.signIn'), exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: shellText(lang, 'adminShell.welcome.back') })).toHaveCount(0);
    await expect(page).toHaveTitle(shellText(lang, 'adminShell.appName'));
});

test(
    'A server that does not answer is resting on the Contribute page, never the setup; once it answers, Try again opens the page',
    { tag: '@S-A92-BAD-CONTRIBUTE-NO-SERVER' },
    async ({ page, lang, adminWorld, consent, inputBudget, serverDeployment }) => {
        await seedCity(adminWorld.emulators);
        await serverDeployment.hide();
        await openWelcome(page, lang);

        // The probe found no server: still the contributor's welcome, without the start-up mode's intro or Cloud consent note.
        await expect(page.locator('hcm-consent-note')).toHaveCount(0);
        await expect(page.getByText(shellText(lang, 'adminShell.auth.setupIntro', { projectId: E2E_PROJECT_ID }))).toHaveCount(0);
        expect(await signInFromWelcome(page, lang, consent, inputBudget)).not.toContain(GOOGLE_SCOPES.cloudReadOnly);

        await expectContributorPanel(page, lang, shellText(lang, 'adminShell.welcome.resting'));
        await expectStateSound(page, adminVisit('roles.contribute-resting', lang));
        expect(serverDeployment.claimErrors().length).toBeGreaterThan(0);

        await serverDeployment.show();
        await page.getByRole('button', { name: shellText(lang, 'adminShell.backend.retry') }).click();
        await expect(page.getByLabel(cityText(lang, 'adminContent.contribute.reason'))).toBeVisible();
        expect(await adminWorld.emulators.document(`admins/${adminWorld.accounts.stranger.uid}`)).toBeUndefined();
    },
);

test(
    'A busy server is resting on the Contribute page, with Try again and the way back',
    { tag: '@S-A92-BAD-CONTRIBUTE-BUSY' },
    async ({ page, lang, consent, inputBudget, consoleErrors }) => {
        await openWelcome(page, lang);
        await failSession(page, 503, { status: 'UNAVAILABLE', code: 'apiError.unavailable' });

        await signInFromWelcome(page, lang, consent, inputBudget);

        await expectContributorPanel(page, lang, shellText(lang, 'adminShell.welcome.resting'));
        await expect(page.getByRole('button', { name: shellText(lang, 'adminShell.backend.retry') })).toBeVisible();
        expect(consoleErrors.takeMatching(/status of 503/).length).toBeGreaterThan(0);
    },
);

test(
    'A refused session is said to the contributor, never "not an admin", and the account stays signed in',
    { tag: '@S-A92-BAD-CONTRIBUTE-SESSION' },
    async ({ page, lang, consent, inputBudget, consoleErrors }) => {
        await openWelcome(page, lang);
        await failSession(page, 403, { status: 'PERMISSION_DENIED', code: 'apiError.accountNotAllowed' });

        await signInFromWelcome(page, lang, consent, inputBudget);

        await expectContributorPanel(page, lang, shellText(lang, 'adminShell.welcome.resting'));
        await expect(page.getByText(apiText(lang, 'apiError.accountNotAllowed'))).toBeVisible();
        await expect(page.getByText(shellText(lang, 'adminShell.auth.notAdmin'))).toHaveCount(0);
        expect(consoleErrors.takeMatching(/status of 403/).length).toBeGreaterThan(0);
    },
);

test.describe('a map nobody set up', () => {
    test.use({ mapOwner: null });

    test(
        'The Contribute page of a map nobody claimed is not open yet, and never offers the claim',
        { tag: '@S-A92-BAD-CONTRIBUTE-NO-SERVER' },
        async ({ page, lang, consent, inputBudget, adminWorld }) => {
            await openWelcome(page, lang);

            await signInFromWelcome(page, lang, consent, inputBudget);

            await expectContributorPanel(page, lang, shellText(lang, 'adminShell.welcome.closed'));
            await expect(page.getByRole('button', { name: shellText(lang, 'adminShell.auth.claimAction') })).toHaveCount(0);
            await expectStateSound(page, adminVisit('roles.contribute-closed', lang));
            expect(await adminWorld.emulators.document(`admins/${adminWorld.accounts.stranger.uid}`)).toBeUndefined();
        },
    );
});
