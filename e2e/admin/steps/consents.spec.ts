import type { Page, Request } from '@playwright/test';

import { translateAdminContent } from '@hcm/shared';

import { GOOGLE_SCOPES } from '../../../packages/admin/src/google/scopes.js';
import { apiText, setupText, shellText } from '../support/i18n.js';
import { SetupPage } from '../support/setup-page.js';
import { openStep, seedClaimedCity } from '../support/steps.js';
import { ADMIN_LOCK, adminPath, expect, test } from '../support/test.js';
import { ADMIN_RUNTIME, E2E_PROJECT_ID, PERSONAS } from '../world.js';

// One admin test at a time (the emulators are one Firebase project): see ADMIN_LOCK.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * Google's permissions, step by step (docs/research/M2b-interfaces.md §2.4–§2.6; behaviours A26, A27): each step asks
 * for its own scope, with the signed-in account as the login hint; a scope left unticked, a closed window or another
 * account changes nothing and calls nothing with the token; the token lives in the tab's memory only, never in storage,
 * the address or a request to anything but Google and `admin.claim`. Google's consent page is the stand-in.
 */

/** The access tokens the consent stand-in issues (`e2e/mock-apis/oauth.ts`). */
const ACCESS_TOKEN = /e2e-consent-\d+-access-token/;

/** The billing card's action, open. */
async function linkBilling(page: Page, lang: 'ro' | 'en'): Promise<ReturnType<Page['getByRole']>> {
    const card = await openStep(page, lang, 'billing');
    return card.getByRole('button', { name: new RegExp(`^${setupText(lang, 'adminSetup.billing.link').split('{')[0] ?? ''}`) });
}

test.describe('a new map in start-up mode', () => {
    test(
        'Each step asks Google for its own scope only, with the signed-in account as the login hint',
        { tag: ['@S-A27-HAPPY'] },
        async ({ page, lang, consent, inputBudget, setupBudget, upstream, serverDeployment }) => {
            // The billing APIs are on (no cloud-platform detour) and one billing account is open.
            await upstream.scenario('service-usage.billingApisEnabled', 'browser');
            await upstream.scenario('cloud-billing.accountOpen', 'browser');
            await serverDeployment.hide();
            await page.route('**/runtime.json', (route) => route.fulfill({ json: { ...ADMIN_RUNTIME, startUp: true } }));
            await page.goto(adminPath(lang));
            const signIn = await consent.opened(page, () =>
                inputBudget.flow('signIn', 1).click(page.getByRole('button', { name: shellText(lang, 'adminShell.auth.signIn') })),
            );
            await signIn.allow(inputBudget.flow('signInConsent', 1));
            const setup = new SetupPage(page, lang);
            await setup.expectState('signIn', 'ok');

            const billing = setup
                .open('billing')
                .getByRole('button', { name: new RegExp(`^${setupText(lang, 'adminSetup.billing.link').split('{')[0] ?? ''}`) });
            await expect(billing).toBeEnabled();
            const billingConsent = await consent.opened(page, () => setupBudget.inputs('billing').click(billing));
            await billingConsent.allow(setupBudget.consents('billing'));
            await setup.expectState('billing', 'ok');
            const run = (await setup.show('provision')).getByRole('button', { name: setupText(lang, 'adminSetup.provision.run') });
            const provisionConsent = await consent.opened(page, () => setupBudget.inputs('provision').click(run));
            await provisionConsent.cancel(setupBudget.consents('provision'));

            const requests = await consent.requests();
            expect(requests.map((request) => request.scopes)).toEqual([
                [GOOGLE_SCOPES.cloudReadOnly],
                [GOOGLE_SCOPES.cloudBilling],
                [GOOGLE_SCOPES.cloudPlatform],
            ]);
            expect(requests.slice(1).map((request) => request.loginHint)).toEqual([PERSONAS.owner.email, PERSONAS.owner.email]);
        },
    );
});

test.describe('the owner of a claimed map', () => {
    test.use({ persona: 'owner', mapOwner: 'owner' });

    test.beforeEach(async ({ adminWorld }) => {
        await seedClaimedCity(adminWorld.emulators, adminWorld.accounts.owner.uid);
    });

    test(
        'A scope left unticked at Google stops the step before any Google call, naming the permission; the button asks again',
        { tag: ['@S-A27-BAD-SCOPE-DENIED'] },
        async ({ page, lang, consent, setupBudget, upstream }) => {
            const link = await linkBilling(page, lang);
            const inputs = setupBudget.inputs('billing', 1);
            const popup = await consent.opened(page, () => inputs.click(link));
            await popup.untick(GOOGLE_SCOPES.cloudPlatform);
            await popup.allow(setupBudget.consents('billing', 1));

            const permission = shellText(lang, 'adminShell.oauth.scope.cloudPlatform');
            await expect(page.getByText(shellText(lang, 'adminShell.oauth.scopeDenied', { scope: permission })).first()).toBeVisible();
            expect((await upstream.calls('browser')).filter((call) => !call.operation.startsWith('google-oauth.'))).toEqual([]);
            const again = await consent.opened(page, () => inputs.click(link));
            expect(await again.requestedScopes()).toEqual([GOOGLE_SCOPES.cloudPlatform]);
            await again.cancel(setupBudget.consents('billing', 1));
        },
    );

    test(
        'A consent cancelled at Google changes nothing',
        { tag: ['@S-A27-BAD-POPUP-CLOSED'] },
        async ({ page, lang, consent, setupBudget, upstream }) => {
            const link = await linkBilling(page, lang);
            const popup = await consent.opened(page, () => setupBudget.inputs('billing').click(link));
            await popup.cancel(setupBudget.consents('billing'));

            await expect(page.getByText(shellText(lang, 'adminShell.oauth.popupClosed')).first()).toBeVisible();
            await new SetupPage(page, lang).expectState('billing', 'missing');
            await expect(link).toBeEnabled();
            expect((await upstream.calls('browser')).filter((call) => !call.operation.startsWith('google-oauth.'))).toEqual([]);
        },
    );

    test(
        'Another Google account chosen at Google is refused, and nothing is called with its token',
        { tag: ['@S-A27-BAD-WRONG-ACCOUNT'] },
        async ({ page, lang, consent, setupBudget, upstream }) => {
            const link = await linkBilling(page, lang);
            const popup = await consent.opened(page, () => setupBudget.inputs('billing').click(link));
            await popup.chooseAccount(PERSONAS.editor.email);
            await popup.allow(setupBudget.consents('billing'));

            await expect(page.getByText(shellText(lang, 'adminShell.oauth.wrongAccount')).first()).toBeVisible();
            await new SetupPage(page, lang).expectState('billing', 'missing');
            expect((await upstream.calls('browser')).filter((call) => !call.operation.startsWith('google-oauth.'))).toEqual([]);
        },
    );

    test(
        'A Google access token is never stored, put in the address or sent anywhere but to Google',
        { tag: ['@S-A27-BAD-TOKEN-NEVER-STORED'] },
        async ({ page, lang, consent, setupBudget }) => {
            const leaks: string[] = [];
            page.on('request', (request: Request) => {
                const host = new URL(request.url()).host;
                const carried = `${request.url()} ${JSON.stringify(request.headers())} ${request.postData() ?? ''}`;
                // Google's hosts, and Firebase Auth's Identity Toolkit (its emulator in e2e), which signs in with the grant.
                const google =
                    host.endsWith('.googleapis.com') || new URL(request.url()).pathname.startsWith('/identitytoolkit.googleapis.com/');
                if (ACCESS_TOKEN.test(carried) && !google) {
                    leaks.push(request.url());
                }
            });
            const link = await linkBilling(page, lang);
            const popup = await consent.opened(page, () => setupBudget.inputs('billing').click(link));
            await popup.allow(setupBudget.consents('billing'));
            await new SetupPage(page, lang).expectState('billing', 'ok');

            expect(leaks).toEqual([]);
            expect(page.url()).not.toMatch(ACCESS_TOKEN);
            const stored = await page.evaluate(async () => {
                const databases = await indexedDB.databases();
                const dumps = await Promise.all(
                    databases.map(
                        (info) =>
                            new Promise<string>((resolve) => {
                                const open = indexedDB.open(info.name ?? '');
                                open.onsuccess = () => {
                                    const db = open.result;
                                    const names = [...db.objectStoreNames];
                                    if (names.length === 0) {
                                        resolve('');
                                        return;
                                    }
                                    const transaction = db.transaction(names, 'readonly');
                                    const values: unknown[] = [];
                                    for (const name of names) {
                                        transaction.objectStore(name).getAll().onsuccess = (event) => {
                                            values.push((event.target as IDBRequest<unknown[]>).result);
                                        };
                                    }
                                    transaction.oncomplete = () => {
                                        resolve(JSON.stringify(values));
                                    };
                                };
                                open.onerror = () => {
                                    resolve('');
                                };
                            }),
                    ),
                );
                return [
                    JSON.stringify(Object.entries(localStorage)),
                    JSON.stringify(Object.entries(sessionStorage)),
                    document.cookie,
                    ...dumps,
                ].join('\n');
            });
            expect(stored).not.toMatch(ACCESS_TOKEN);
            expect(JSON.stringify(await page.context().cookies())).not.toMatch(ACCESS_TOKEN);
        },
    );
});

test.describe('the owner signed in on a map nobody claimed yet', () => {
    test.use({ persona: 'owner' });

    test(
        'A refused claim says why and leaves the account without admin rights',
        { tag: ['@S-A26-BAD-CLAIM-REFUSED'] },
        async ({ page, lang, consent, inputBudget, adminWorld, consoleErrors }) => {
            await page.goto(adminPath(lang));
            const claim = page.getByRole('button', { name: shellText(lang, 'adminShell.auth.claimAction') });
            await expect(page.getByText(shellText(lang, 'adminShell.auth.claimTitle', { projectId: E2E_PROJECT_ID }))).toBeVisible();

            // Meanwhile another account claims the map.
            await adminWorld.emulators.claimFor(adminWorld.accounts.admin, new Date('2026-10-01T09:00:00.000Z'));
            const popup = await consent.opened(page, () => inputBudget.flow('claim', 1).click(claim));
            await popup.allow(inputBudget.flow('claimConsent', 1));

            await expect(page.getByText(apiText(lang, 'apiError.claim.alreadyClaimed'))).toBeVisible();
            expect(await adminWorld.emulators.document(`admins/${adminWorld.accounts.owner.uid}`)).toBeUndefined();
            expect((await adminWorld.emulators.account(adminWorld.accounts.owner.uid)).claims).not.toHaveProperty('admin');
            expect(consoleErrors.takeMatching(/status of 409|status of 400/).length).toBeGreaterThan(0);
        },
    );
});

// M18 item 2 (docs/research/M18-improvements.md): its own block, as the owner's (the describe above is at its line limit).
test.describe('the owner of a claimed map, a blocked window', () => {
    test.use({ persona: 'owner', mapOwner: 'owner' });

    test.beforeEach(async ({ adminWorld }) => {
        await seedClaimedCity(adminWorld.emulators, adminWorld.accounts.owner.uid);
    });

    test(
        'A Google window the browser blocked is said plainly, and Try again opens it from its own click',
        { tag: ['@S-A27-HAPPY-BLOCKED-TRY-AGAIN', '@S-A27-BAD-POPUP-BLOCKED'] },
        async ({ page, lang, consent, setupBudget }) => {
            const link = await linkBilling(page, lang);
            // The browser blocks the next window: `window.open` answers null once, as a blocker does.
            await page.evaluate(() => {
                const open = window.open.bind(window);
                window.open = () => {
                    window.open = open;
                    return null;
                };
            });
            const inputs = setupBudget.inputs('billing', 2);
            await inputs.click(link);

            const snackbar = page.locator('hcm-snackbar');
            await expect(snackbar).toContainText(shellText(lang, 'adminShell.oauth.popupBlocked'));
            expect(await consent.requests()).toEqual([]);
            const tryAgain = snackbar.getByRole('button', { name: translateAdminContent(lang, 'adminContent.common.retry') });
            const popup = await consent.opened(page, () => inputs.click(tryAgain));
            await popup.allow(setupBudget.consents('billing'));
            await expect(snackbar).toContainText(shellText(lang, 'adminShell.oauth.retryGranted'));

            // The step's button goes on with the token the retry got: no other window.
            await inputs.click(link);
            await expect.poll(async () => (await consent.requests()).length).toBe(1);
        },
    );
});
