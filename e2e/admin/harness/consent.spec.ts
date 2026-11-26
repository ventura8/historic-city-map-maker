import { FIXTURE_VALUES } from '@hcm/test-support/api-fixtures';

import { GOOGLE_SCOPES } from '../../../packages/admin/src/google/scopes.js';
import { MOCK_API_ORIGIN } from '../../fixtures/world.js';
import { SIGN_IN_SCOPES } from '../../mock-apis/oauth.js';
import { authorizeUrl, openHarnessPage, openPopup, receivedGrant, receivedMessages, tokenInfo } from '../support/harness.js';
import { ADMIN_LOCK, expect, test } from '../support/test.js';
import { PERSONAS } from '../world.js';

// One admin test at a time (the emulators are one Firebase project): see ADMIN_LOCK.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * Harness (behaviour A00): Google's consent, stood in for by the mock APIs (docs/research/M2b-interfaces.md §2.6). A
 * popup of the stand-in lists the accounts and the requested scopes; Allow posts `{idToken, accessToken, scope,
 * expiresIn}` to the opener, and the access token is a grant of the fake Google identity in the browser's world and in
 * the server's (which the Functions emulator reaches), so tokeninfo and Resource Manager answer for it. The admin's
 * e2e Google port (admin-shell) builds on this; here a spec-made page opens the popup itself.
 */

const OAUTH_CLIENT = String(FIXTURE_VALUES['oauthClientId']);

test(
    "Google's consent stand-in issues a token that the fake Google APIs honour",
    { tag: '@S-A00-HAPPY' },
    async ({ page, consent, setupBudget, upstream, mockApiRequest }) => {
        await openHarnessPage(page);
        const popup = await consent.opened(page, () => page.evaluate(openPopup, authorizeUrl(GOOGLE_SCOPES.cloudReadOnly)));

        expect(await popup.requestedScopes()).toEqual([GOOGLE_SCOPES.cloudReadOnly]);
        await expect(popup.page.getByRole('radio', { name: PERSONAS.owner.email })).toBeChecked();
        await popup.allow(setupBudget.consents('signIn'));

        await expect.poll(async () => (await receivedMessages(page)).map((received) => received.origin)).toEqual([MOCK_API_ORIGIN]);
        const message = await receivedGrant(page);
        const { email, sub, displayName } = PERSONAS.owner;
        expect(JSON.parse(message.idToken)).toEqual({ sub, email, email_verified: true, name: displayName });
        expect(message.scope.split(' ')).toEqual([...SIGN_IN_SCOPES, GOOGLE_SCOPES.cloudReadOnly]);
        expect(message.expiresIn).toBe(3599);
        const token = message.accessToken;
        expect(await page.evaluate(tokenInfo, token)).toEqual({
            status: 200,
            body: expect.objectContaining({ email, aud: OAUTH_CLIENT, scope: message.scope }) as unknown,
        });
        // The server's world (the shared partition, no test header) knows the token too: admin.claim will verify it.
        const server = await mockApiRequest.post(`${MOCK_API_ORIGIN}/h/oauth2.googleapis.com/tokeninfo`, {
            headers: { authorization: `Bearer ${token}` },
        });
        expect(await server.json()).toEqual(expect.objectContaining({ email, aud: OAUTH_CLIENT }));
        expect(await consent.requests()).toEqual([
            expect.objectContaining({ scopes: [GOOGLE_SCOPES.cloudReadOnly], outcome: 'allowed', account: email }),
        ]);
        expect((await upstream.calls('browser', 'google-oauth.tokeninfo')).map((call) => call.status)).toEqual([200]);
    },
);

test(
    'A cancelled consent tells the app and grants nothing',
    { tag: '@S-A00-BAD-CONSENT-CANCELLED' },
    async ({ page, consent, setupBudget }) => {
        await openHarnessPage(page);
        const popup = await consent.opened(page, () => page.evaluate(openPopup, authorizeUrl(GOOGLE_SCOPES.cloudBilling)));

        await popup.cancel(setupBudget.consents('billing'));

        await expect.poll(() => receivedMessages(page)).toEqual([{ origin: MOCK_API_ORIGIN, data: { cancelled: true } }]);
        expect(await consent.requests()).toEqual([expect.objectContaining({ scopes: [GOOGLE_SCOPES.cloudBilling], outcome: 'cancelled' })]);
    },
);

test(
    'The consent grants only the chosen account and the scopes left ticked',
    { tag: '@S-A00-BAD-SCOPE-UNTICKED' },
    async ({ page, consent, setupBudget }) => {
        await openHarnessPage(page);
        const scopes = `${GOOGLE_SCOPES.cloudPlatform} ${GOOGLE_SCOPES.analyticsEdit}`;
        const popup = await consent.opened(page, () => page.evaluate(openPopup, authorizeUrl(scopes, PERSONAS.owner.email)));

        await popup.chooseAccount(PERSONAS.editor.email);
        await popup.untick(GOOGLE_SCOPES.cloudPlatform);
        await popup.allow(setupBudget.consents('provision'));

        await expect.poll(async () => (await receivedMessages(page)).length).toBe(1);
        const info = await page.evaluate(tokenInfo, (await receivedGrant(page)).accessToken);
        expect(info.body['email']).toBe(PERSONAS.editor.email);
        expect(info.body['scope']?.split(' ')).toEqual([...SIGN_IN_SCOPES, GOOGLE_SCOPES.analyticsEdit]);
        expect(await consent.requests()).toEqual([
            expect.objectContaining({ account: PERSONAS.editor.email, granted: [GOOGLE_SCOPES.analyticsEdit], outcome: 'allowed' }),
        ]);
    },
);
