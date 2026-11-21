import { describe, expect, it } from 'vitest';

import { GoogleAccessStore, MIN_TOKEN_REMAINING_MS } from '../../src/auth/google-access.js';
import { GoogleAccessService, failureNotice } from '../../src/auth/google-service.js';
import { GoogleAuthError } from '../../src/auth/google-auth.js';
import { GOOGLE_SCOPES } from '../../src/google/scopes.js';
import { access, FakeAuth, FakeClock, FakeGoogle, OWNER, STRANGER } from '../app/fakes.js';

describe('GoogleAccessStore', () => {
    it('happyPath_aLiveTokenOfTheUserSatisfiesItsScopes', () => {
        const clock = new FakeClock();
        const store = new GoogleAccessStore(() => clock.now());
        const token = access([GOOGLE_SCOPES.cloudPlatform], clock.now() + 3_600_000);

        store.keep(OWNER.uid, token);

        expect(store.live(OWNER.uid, 'cloudReadOnly', 0)).toBe(token);
        expect(store.live(OWNER.uid, 'cloudBilling', MIN_TOKEN_REMAINING_MS)).toBe(token);
    });

    it('badPath_anotherUserTheWrongScopeOrTooLittleTimeLeftGiveNoToken', () => {
        const clock = new FakeClock();
        const store = new GoogleAccessStore(() => clock.now());
        store.keep(OWNER.uid, access([GOOGLE_SCOPES.cloudReadOnly], clock.now() + 4 * 60_000));

        expect(store.live(STRANGER.uid, 'cloudReadOnly', 0)).toBeNull();
        expect(store.live(OWNER.uid, 'cloudPlatform', 0)).toBeNull();
        expect(store.live(OWNER.uid, 'cloudReadOnly', MIN_TOKEN_REMAINING_MS)).toBeNull();

        clock.advance(5 * 60_000);
        expect(store.live(OWNER.uid, 'cloudReadOnly', 0)).toBeNull();
    });

    it('happyPath_aTokenPerScopeStaysBesideTheNextConsentsToken', () => {
        const clock = new FakeClock();
        const store = new GoogleAccessStore(() => clock.now());
        const cloud = access([GOOGLE_SCOPES.cloudPlatform], clock.now() + 3_600_000);
        store.keep(OWNER.uid, cloud);

        clock.advance(10 * 60_000);
        const analytics = access([GOOGLE_SCOPES.analyticsEdit], clock.now() + 3_600_000);
        store.keep(OWNER.uid, analytics);

        // §73j: the Analytics consent no longer costs Google Cloud's token (Publish the map asks nothing within the hour).
        expect(store.live(OWNER.uid, 'cloudPlatform', MIN_TOKEN_REMAINING_MS)).toBe(cloud);
        expect(store.live(OWNER.uid, 'analyticsEdit', MIN_TOKEN_REMAINING_MS)).toBe(analytics);
        // Each expires on its own: Google Cloud's first, the Analytics token still live.
        clock.advance(50 * 60_000);
        expect(store.live(OWNER.uid, 'cloudPlatform', 0)).toBeNull();
        expect(store.live(OWNER.uid, 'analyticsEdit', 0)).toBe(analytics);
    });

    it('happyPath_aTokenThatGrantsMoreReplacesTheOnesItSupersedesAndTheLongestLivedAnswers', () => {
        const clock = new FakeClock();
        const store = new GoogleAccessStore(() => clock.now());
        const readOnly = access([GOOGLE_SCOPES.cloudReadOnly], clock.now() + 3_600_000);
        const billing = access([GOOGLE_SCOPES.cloudBilling], clock.now() + 3_600_000);
        store.keep(OWNER.uid, readOnly);
        store.keep(OWNER.uid, billing);

        clock.advance(30 * 60_000);
        const platform = access([GOOGLE_SCOPES.cloudPlatform, GOOGLE_SCOPES.cloudBilling], clock.now() + 3_600_000);
        store.keep(OWNER.uid, platform);
        clock.advance(40 * 60_000);

        // Both older tokens are superseded: only the newest is kept, and it answers for each of their scopes.
        expect(store.live(OWNER.uid, 'cloudReadOnly', MIN_TOKEN_REMAINING_MS)).toBe(platform);
        expect(store.live(OWNER.uid, 'cloudBilling', MIN_TOKEN_REMAINING_MS)).toBe(platform);
    });

    it('happyPath_ofTwoTokensForOneScopeTheLongerLivedAnswers', () => {
        const store = new GoogleAccessStore(() => 0);
        const platform = access([GOOGLE_SCOPES.cloudPlatform], 3_600_000, 'ya29.platform');
        const billing = access([GOOGLE_SCOPES.cloudBilling, GOOGLE_SCOPES.analyticsEdit], 1_800_000, 'ya29.billing');
        store.keep(OWNER.uid, platform);
        store.keep(OWNER.uid, billing);

        // Neither supersedes the other; both may be used for billing, and the one that lives longer answers.
        expect(store.live(OWNER.uid, 'cloudBilling', 0)).toBe(platform);
        expect(store.live(OWNER.uid, 'analyticsEdit', 0)).toBe(billing);
    });

    it('badPath_anotherUsersTokensAreForgottenWhenTheNextUserKeepsOne', () => {
        const store = new GoogleAccessStore(() => 0);
        store.keep(STRANGER.uid, access([GOOGLE_SCOPES.cloudPlatform], 3_600_000));
        store.keep(OWNER.uid, access([GOOGLE_SCOPES.analyticsEdit], 3_600_000));

        expect(store.live(STRANGER.uid, 'cloudPlatform', 0)).toBeNull();
        expect(store.live(OWNER.uid, 'cloudPlatform', 0)).toBeNull();
    });

    it('badPath_aDroppedTokenIsGone', () => {
        const store = new GoogleAccessStore(() => 0);
        store.keep(OWNER.uid, access([GOOGLE_SCOPES.cloudReadOnly], 3_600_000));

        store.drop();

        expect(store.live(OWNER.uid, 'cloudReadOnly', 0)).toBeNull();
    });
});

function service(user = OWNER) {
    const auth = new FakeAuth();
    auth.user = user;
    const clock = new FakeClock();
    const port = new FakeGoogle(auth);
    const google = new GoogleAccessService({
        port,
        store: new GoogleAccessStore(() => clock.now()),
        currentUser: () => auth.currentUser(),
        locale: () => 'ro',
    });
    return { auth, port, google };
}

describe('GoogleAccessService', () => {
    it('happyPath_aGrantIsKeptForTheSignedInUserWithItsAddressAsTheHint', async () => {
        const { port, google } = service();
        port.outcomes.push(access([GOOGLE_SCOPES.cloudBilling]));

        await expect(google.request('cloudBilling')).resolves.toMatchObject({ granted: true });

        expect(port.requests).toEqual([{ scope: 'cloudBilling', options: { loginHint: OWNER.email } }]);
        expect(google.live('cloudBilling')?.token).toBe('ya29.e2e-owner-access-token');
    });

    it('happyPath_noUserNoHintAndNoTokenKept', async () => {
        const { auth, port, google } = service();
        auth.user = null;
        port.outcomes.push(access([GOOGLE_SCOPES.cloudBilling]));
        Object.assign(auth, { announce: () => undefined });

        await google.request('cloudBilling');

        expect(port.requests[0]?.options).toEqual({});
        expect(google.live('cloudBilling')).toBeNull();
    });

    it('happyPath_anAccountWithoutAnAddressGivesNoHint', async () => {
        const { port, google } = service({ uid: 'no-address', email: null, displayName: null });

        await google.request(null);

        expect(port.requests[0]?.options).toEqual({});
    });

    it('badPath_aWrongAccountDropsTheTokenAndSaysWhy', async () => {
        const { port, google } = service();
        port.outcomes.push(access([GOOGLE_SCOPES.cloudReadOnly]), new GoogleAuthError('wrongAccount'));
        await google.request('cloudReadOnly');

        const outcome = await google.request('cloudBilling');

        expect(outcome).toEqual({ granted: false, failure: 'wrongAccount', notice: { key: 'adminShell.oauth.wrongAccount' } });
        expect(google.live('cloudReadOnly')).toBeNull();
    });

    it('badPath_anUnknownErrorIsAFailedConsent', async () => {
        const { port, google } = service();
        port.outcomes.push(new Error('boom'));

        await expect(google.request('cloudReadOnly')).resolves.toMatchObject({ granted: false, failure: 'failed' });
    });

    it('happyPath_dropForgetsTheToken', async () => {
        const { port, google } = service();
        port.outcomes.push(access([GOOGLE_SCOPES.cloudReadOnly]));
        await google.request('cloudReadOnly');

        google.drop();

        expect(google.live('cloudReadOnly')).toBeNull();
    });
});

describe('failureNotice', () => {
    it('happyPath_aRefusedScopeIsNamedInTheLanguageOfThePage', () => {
        expect(failureNotice('scopeDenied', 'cloudBilling', 'ro')).toEqual({
            key: 'adminShell.oauth.scopeDenied',
            params: { scope: 'Gestionează facturarea Google Cloud' },
        });
        expect(failureNotice('scopeDenied', null, 'en').params).toEqual({ scope: 'View your Google Cloud data' });
    });

    it.each([
        ['popupBlocked', 'adminShell.oauth.popupBlocked'],
        ['popupClosed', 'adminShell.oauth.popupClosed'],
        ['network', 'apiError.unavailable'],
        ['failed', 'apiError.internal'],
    ] as const)('badPath_%s_shows_%s', (failure, key) => {
        expect(failureNotice(failure, 'cloudPlatform', 'en')).toEqual({ key });
    });
});
