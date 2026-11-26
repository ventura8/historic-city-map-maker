import { describe, expect, it } from 'vitest';

import { apiFailure, consentFailure, googleFailure, isSetupMessageKey, scopeDenied, setupMessage } from '../../src/setup/messages.js';
import { functionsError, googleError } from './harness.js';

describe('googleFailure', () => {
    it.each([
        ['notFound', 'invalid', 'apiError.notFound'],
        ['conflict', 'unavailable', 'apiError.conflict'],
        ['rateLimited', 'unavailable', 'apiError.rateLimited'],
        ['unavailable', 'unavailable', 'apiError.unavailable'],
        ['invalid', 'invalid', 'adminSetup.error.googleRefused'],
    ] as const)('badPath_%s_isShownAs_%s', (kind, state, key) => {
        expect(googleFailure(googleError(kind))).toEqual({ state, message: { key }, expired: false });
    });

    it('badPath_anExpiredTokenAsksToContinue', () => {
        expect(googleFailure(googleError('unauthorized'))).toEqual({
            state: 'unavailable',
            message: { key: 'adminShell.session.googleExpired' },
            expired: true,
        });
    });

    it('badPath_aRequestThatNeverLeftTheBrowserNamesItsHost', () => {
        // Finding 48 of 2026-11-01: a blocklist answered `::`; a server's 503 (above) stays "unavailable".
        expect(googleFailure(googleError('unavailable', { host: 'analyticsadmin.googleapis.com' }))).toEqual({
            state: 'unavailable',
            message: { key: 'adminShell.network.blocked', params: { host: 'analyticsadmin.googleapis.com' } },
            expired: false,
        });
    });

    it('badPath_aDisabledApiIsNamed', () => {
        const failure = googleFailure(googleError('forbidden', { api: 'cloudbilling.googleapis.com' }));

        expect(failure.message).toEqual({ key: 'apiError.cloud.apiDisabled', params: { api: 'cloudbilling.googleapis.com' } });
    });

    it('badPath_aMissingRoleIsNamed_orTheOwnerRoleWhenGoogleNamedNone', () => {
        expect(googleFailure(googleError('forbidden', { role: 'roles/billing.user' })).message.params).toEqual({
            role: 'roles/billing.user',
        });
        expect(googleFailure(googleError('forbidden')).message.params).toEqual({ role: 'roles/owner' });
    });

    it('badPath_anOrganisationPolicyIsNamed', () => {
        const named = googleFailure(googleError('orgPolicy', { constraint: 'iam.allowedPolicyMemberDomains' }));

        expect(named.message).toEqual({ key: 'adminSetup.provision.orgPolicy', params: { constraint: 'iam.allowedPolicyMemberDomains' } });
        expect(googleFailure(googleError('orgPolicy')).message.params).toEqual({ constraint: '' });
    });

    it.each([new TypeError('Failed to fetch'), 'offline', null, googleError('constructor')])(
        'badPath_anythingElseIsUnavailable_%#',
        (error) => {
            expect(googleFailure(error)).toEqual({ state: 'unavailable', message: { key: 'apiError.unavailable' }, expired: false });
        },
    );
});

describe('apiFailure', () => {
    it('badPath_aRetryableCodeIsUnavailable', () => {
        expect(apiFailure(functionsError('apiError.mapbox.unavailable'))).toEqual({
            state: 'unavailable',
            message: { key: 'apiError.mapbox.unavailable' },
            expired: false,
        });
    });

    it('badPath_aRefusalIsInvalidWithItsParameters', () => {
        const failure = apiFailure(functionsError('apiError.mapbox.missingScopes', { scopes: 'tokens:write' }));

        expect(failure).toEqual({
            state: 'invalid',
            message: { key: 'apiError.mapbox.missingScopes', params: { scopes: 'tokens:write' } },
            expired: false,
        });
    });

    it('badPath_aFailureWithoutDetailsFallsBackToItsStatus', () => {
        expect(apiFailure({ code: 'functions/unavailable' }).message).toEqual({ key: 'apiError.unavailable' });
        expect(apiFailure(new Error('boom')).message).toEqual({ key: 'apiError.internal' });
    });
});

describe('consentFailure', () => {
    it.each([
        ['auth/popup-blocked', 'adminShell.oauth.popupBlocked'],
        ['auth/popup-closed-by-user', 'adminShell.oauth.popupClosed'],
        ['auth/cancelled-popup-request', 'adminShell.oauth.popupClosed'],
        ['auth/user-mismatch', 'adminShell.oauth.wrongAccount'],
        ['hcm/wrong-account', 'adminShell.oauth.wrongAccount'],
        ['auth/network-request-failed', 'apiError.unavailable'],
        ['auth/something-new', 'apiError.internal'],
    ])('badPath_%s_says_%s', (code, key) => {
        expect(consentFailure(Object.assign(new Error(code), { code }), 'cloudBilling')).toEqual({ key });
    });

    it('badPath_anUntickedScopeNamesTheScope', () => {
        expect(consentFailure({ code: 'hcm/scope-denied' }, 'cloudPlatform')).toEqual(scopeDenied('cloudPlatform'));
        expect(scopeDenied('cloudPlatform')).toEqual({ key: 'adminShell.oauth.scopeDenied', params: { scope: 'cloudPlatform' } });
    });

    it('badPath_somethingThatIsNotAnErrorIsInternal', () => {
        expect(consentFailure(undefined, 'cloudReadOnly')).toEqual({ key: 'apiError.internal' });
    });
});

describe('isSetupMessageKey and setupMessage', () => {
    it('happyPath_apiCodesAndTheRecordableAdminKeysAreAccepted', () => {
        expect(isSetupMessageKey('apiError.cloud.permission')).toBe(true);
        expect(isSetupMessageKey('adminSetup.deploy.progress')).toBe(true);
        expect(isSetupMessageKey('adminShell.session.googleExpired')).toBe(true);
    });

    it('badPath_otherTextsAndNonStringsAreRefused', () => {
        expect(isSetupMessageKey('adminSetup.title')).toBe(false);
        expect(isSetupMessageKey('constructor')).toBe(false);
        expect(isSetupMessageKey(42)).toBe(false);
    });

    it('happyPath_aMessageCarriesItsParametersOnlyWhenGiven', () => {
        expect(setupMessage('adminSetup.deploy.failed', { name: 'admin-claim' })).toEqual({
            key: 'adminSetup.deploy.failed',
            params: { name: 'admin-claim' },
        });
        expect(Object.keys(setupMessage('adminSetup.title'))).toEqual(['key']);
    });
});
