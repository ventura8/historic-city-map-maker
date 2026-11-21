import { createFakeFetch, createUpstreamFakes, GOOGLE_TOKENS, jsonResponse } from '@hcm/test-support/fakes';
import { describe, expect, it } from 'vitest';

import { createGoogleAuth, GoogleAuthError, googleParameters, TOKENINFO_URL, type PopupSignIn } from '../../src/auth/google-auth.js';
import { GOOGLE_SCOPES } from '../../src/google/scopes.js';
import { testLog } from '../app/fakes.js';

const NOW = 1_760_000_000_000;

function popup(result: { readonly accessToken: string | null; readonly email: string | null }, calls: unknown[] = []): PopupSignIn {
    return (scopeUrl, parameters) => {
        calls.push({ scopeUrl, parameters });
        return Promise.resolve(result);
    };
}

function failingPopup(code: unknown): PopupSignIn {
    return () => Promise.reject(Object.assign(new Error('popup'), { code }));
}

describe('createGoogleAuth', () => {
    it('happyPath_aGrantedScopeIsCheckedWithTokeninfoAndKeptWithItsLifetime', async () => {
        const fakes = createUpstreamFakes();
        const calls: unknown[] = [];
        const port = createGoogleAuth(popup({ accessToken: GOOGLE_TOKENS.owner, email: 'OWNER@e2e.test' }, calls), {
            fetch: fakes.fetch,
            clock: { now: () => NOW },
            log: testLog().log,
        });

        const access = await port.request('cloudReadOnly', { loginHint: 'owner@e2e.test' });

        expect(calls).toEqual([
            { scopeUrl: GOOGLE_SCOPES.cloudReadOnly, parameters: { include_granted_scopes: 'true', login_hint: 'owner@e2e.test' } },
        ]);
        expect(access).toEqual({
            token: GOOGLE_TOKENS.owner,
            scopes: expect.arrayContaining([GOOGLE_SCOPES.cloudReadOnly]) as unknown,
            expiresAt: NOW + 3_599_000,
        });
        expect(fakes.callsTo('google-oauth.tokeninfo')[0]).toMatchObject({
            method: 'POST',
            headers: { authorization: `Bearer ${GOOGLE_TOKENS.owner}` },
        });
    });

    it('happyPath_theDailySignInAsksForNoScopeAndCallsNothing', async () => {
        const fakes = createUpstreamFakes();
        const port = createGoogleAuth(popup({ accessToken: 'ya29.e2e-sign-in-access-token', email: 'owner@e2e.test' }), {
            fetch: fakes.fetch,
            clock: { now: () => NOW },
            log: testLog().log,
        });

        await expect(port.request(null, {})).resolves.toBeNull();
        expect(fakes.calls).toEqual([]);
    });

    it('badPath_anUntickedScopeIsRefusedBeforeAnyCall', async () => {
        const fakes = createUpstreamFakes();
        const port = createGoogleAuth(popup({ accessToken: GOOGLE_TOKENS.noScope, email: 'owner@e2e.test' }), {
            fetch: fakes.fetch,
            clock: { now: () => NOW },
            log: testLog().log,
        });

        await expect(port.request('cloudReadOnly', {})).rejects.toMatchObject({ failure: 'scopeDenied', code: 'hcm/scope-denied' });
    });

    it('badPath_aTokenOfAnotherAccountIsRefused', async () => {
        const fakes = createUpstreamFakes();
        const port = createGoogleAuth(popup({ accessToken: GOOGLE_TOKENS.owner, email: 'someone-else@e2e.test' }), {
            fetch: fakes.fetch,
            clock: { now: () => NOW },
            log: testLog().log,
        });

        await expect(port.request('cloudReadOnly', {})).rejects.toMatchObject({ failure: 'wrongAccount' });
    });

    it('happyPath_aPopupThatNamesNoAddressLeavesTheCheckToTokeninfo', async () => {
        const fakes = createUpstreamFakes();
        const port = createGoogleAuth(popup({ accessToken: GOOGLE_TOKENS.owner, email: null }), {
            fetch: fakes.fetch,
            clock: { now: () => NOW },
            log: testLog().log,
        });

        await expect(port.request('cloudReadOnly', {})).resolves.toMatchObject({ token: GOOGLE_TOKENS.owner });
    });

    it('badPath_anExpiredTokenFailsTheConsent', async () => {
        const fakes = createUpstreamFakes();
        const port = createGoogleAuth(popup({ accessToken: GOOGLE_TOKENS.expired, email: 'owner@e2e.test' }), {
            fetch: fakes.fetch,
            clock: { now: () => NOW },
            log: testLog().log,
        });

        await expect(port.request('cloudPlatform', {})).rejects.toMatchObject({ failure: 'failed' });
    });

    it('badPath_aConsentWithoutAnAccessTokenFails', async () => {
        const port = createGoogleAuth(popup({ accessToken: null, email: null }), {
            fetch: createUpstreamFakes().fetch,
            clock: { now: () => NOW },
            log: testLog().log,
        });

        await expect(port.request('cloudBilling', {})).rejects.toBeInstanceOf(GoogleAuthError);
    });
});

describe('createGoogleAuth: tokeninfo answers and Firebase errors', () => {
    it('badPath_anUnreachableTokeninfoUsesTheTokenAsGrantedForAnHour', async () => {
        const { log, recording } = testLog();
        const port = createGoogleAuth(popup({ accessToken: 'ya29.e2e-cors-access-token', email: 'owner@e2e.test' }), {
            fetch: createFakeFetch(() => undefined).fetch,
            clock: { now: () => NOW },
            log,
        });

        await expect(port.request('cloudBilling', {})).resolves.toEqual({
            token: 'ya29.e2e-cors-access-token',
            scopes: [GOOGLE_SCOPES.cloudBilling],
            expiresAt: NOW + 3_540_000,
        });
        expect(recording.records.map((record) => record.message)).toContain('tokeninfo unreachable: the token is used as granted');
    });

    it('badPath_tokeninfoWithoutScopesDeniesTheStep', async () => {
        const fetcher = createFakeFetch(() => ({ operation: 'tokeninfo', response: jsonResponse({ email: 'owner@e2e.test' }) }));
        const port = createGoogleAuth(popup({ accessToken: 'ya29.e2e-bare-access-token', email: 'owner@e2e.test' }), {
            fetch: fetcher.fetch,
            clock: { now: () => NOW },
            log: testLog().log,
        });

        await expect(port.request('cloudPlatform', {})).rejects.toMatchObject({ failure: 'scopeDenied' });
    });

    it('badPath_anUnreadableLifetimeCountsAsAnHour', async () => {
        const fetcher = createFakeFetch((request) =>
            request.url.toString() === TOKENINFO_URL
                ? { operation: 'tokeninfo', response: jsonResponse({ scope: GOOGLE_SCOPES.cloudPlatform, expires_in: 'soon' }) }
                : undefined,
        );
        const port = createGoogleAuth(popup({ accessToken: 'ya29.e2e-odd-access-token', email: 'owner@e2e.test' }), {
            fetch: fetcher.fetch,
            clock: { now: () => NOW },
            log: testLog().log,
        });

        await expect(port.request('cloudPlatform', {})).resolves.toMatchObject({ expiresAt: NOW + 3_540_000 });
    });

    it.each([
        ['auth/popup-blocked', 'popupBlocked'],
        ['auth/popup-closed-by-user', 'popupClosed'],
        ['auth/cancelled-popup-request', 'popupClosed'],
        ['auth/user-mismatch', 'wrongAccount'],
        ['auth/network-request-failed', 'network'],
        ['auth/internal-error', 'failed'],
        [42, 'failed'],
    ])('badPath_firebaseError_%s_is_%s', async (code, expected) => {
        const port = createGoogleAuth(failingPopup(code), {
            fetch: createFakeFetch(() => undefined).fetch,
            clock: { now: () => NOW },
            log: testLog().log,
        });

        await expect(port.request('cloudReadOnly', {})).rejects.toMatchObject({ failure: expected });
    });

    it('badPath_aPopupErrorWithoutACodeFails', async () => {
        const port = createGoogleAuth(() => Promise.reject(new Error('popup gone')), {
            fetch: createFakeFetch(() => undefined).fetch,
            clock: { now: () => NOW },
            log: testLog().log,
        });

        await expect(port.request(null, {})).rejects.toMatchObject({ failure: 'failed' });
    });
});

describe('googleParameters', () => {
    it('happyPath_incrementalAuthorizationAlwaysAndTheHintWhenKnown', () => {
        expect(googleParameters({})).toEqual({ include_granted_scopes: 'true' });
        expect(googleParameters({ loginHint: '' })).toEqual({ include_granted_scopes: 'true' });
        expect(googleParameters({ loginHint: 'a@e2e.test' })).toEqual({ include_granted_scopes: 'true', login_hint: 'a@e2e.test' });
    });
});
