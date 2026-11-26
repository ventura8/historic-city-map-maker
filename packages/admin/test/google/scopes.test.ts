import { CLAIM_OAUTH_SCOPE } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { GOOGLE_SCOPES, unsatisfiedScopes } from '../../src/google/scopes.js';

const SIGN_IN = ['openid', 'https://www.googleapis.com/auth/userinfo.email'];

describe('GOOGLE_SCOPES', () => {
    it('happyPath_theOwnershipCheckUsesTheClaimScope', () => {
        expect(GOOGLE_SCOPES.cloudReadOnly).toBe(CLAIM_OAUTH_SCOPE);
    });
});

describe('unsatisfiedScopes', () => {
    it('happyPath_aTokenWithTheExactScopeSatisfiesTheStep', () => {
        expect(unsatisfiedScopes([...SIGN_IN, GOOGLE_SCOPES.cloudBilling], ['cloudBilling'])).toEqual([]);
    });

    it('happyPath_cloudPlatformAlsoSatisfiesTheReadOnlyAndBillingSteps', () => {
        expect(unsatisfiedScopes([GOOGLE_SCOPES.cloudPlatform], ['cloudReadOnly', 'cloudBilling', 'cloudPlatform'])).toEqual([]);
    });

    it('badPath_theSignInScopesAloneSatisfyNoCloudStep', () => {
        expect(unsatisfiedScopes(SIGN_IN, ['cloudReadOnly', 'cloudBilling'])).toEqual(['cloudReadOnly', 'cloudBilling']);
    });

    it('badPath_aReadOnlyTokenCannotProvision', () => {
        expect(unsatisfiedScopes([GOOGLE_SCOPES.cloudReadOnly], ['cloudPlatform'])).toEqual(['cloudPlatform']);
    });

    it('badPath_cloudPlatformDoesNotCoverAnalytics', () => {
        expect(unsatisfiedScopes([GOOGLE_SCOPES.cloudPlatform], ['analyticsEdit'])).toEqual(['analyticsEdit']);
    });
});
