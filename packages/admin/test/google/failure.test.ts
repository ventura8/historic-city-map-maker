import { fixture, type FixtureName } from '@hcm/test-support/api-fixtures';
import { describe, expect, it } from 'vitest';

import {
    failureMessage,
    failureOfAnswer,
    failureOfOperation,
    GoogleApiError,
    googleFailureOf,
    isGoogleFailure,
    unavailableFailure,
    type GoogleFailure,
} from '../../src/google/failure.js';

/** Google's error JSON to a `GoogleFailure`, and each failure to the message the admin shows (M2b §2.5, §3.4). */

function failureOf(name: FixtureName, values: Readonly<Record<string, string>> = {}, role?: string): GoogleFailure {
    const answer = fixture(name, values);
    return failureOfAnswer(answer.status, new Headers(answer.headers), answer.body, role);
}

describe('failureOfAnswer', () => {
    it('happyPath_aDisabledApiIsForbiddenAndNamed', () => {
        expect(failureOf('google/error.service-disabled', { service: 'pubsub.googleapis.com' })).toEqual({
            kind: 'forbidden',
            status: 403,
            reason: 'SERVICE_DISABLED',
            api: 'pubsub.googleapis.com',
        });
    });

    it('happyPath_aMissingPermissionKeepsTheDeclaredRoleAndThePermission', () => {
        expect(failureOf('google/error.permission-denied', { permission: 'billing.budgets.create' }, 'roles/billing.costsManager')).toEqual(
            {
                kind: 'forbidden',
                status: 403,
                reason: 'IAM_PERMISSION_DENIED',
                permission: 'billing.budgets.create',
                role: 'roles/billing.costsManager',
            },
        );
    });

    it('happyPath_conflictsKeepTheirGrpcStatus', () => {
        expect(failureOf('google/error.aborted')).toEqual({ kind: 'conflict', status: 409, reason: 'ABORTED' });
        expect(failureOf('google/error.already-exists')).toEqual({ kind: 'conflict', status: 409, reason: 'ALREADY_EXISTS' });
    });

    it('happyPath_organisationPoliciesNameTheirConstraint', () => {
        expect(failureOf('resource-manager/set-iam-policy.org-policy')).toMatchObject({
            kind: 'orgPolicy',
            status: 400,
            constraint: 'iam.allowedPolicyMemberDomains',
        });
        expect(failureOf('cloud-storage/bucket-iam.public-access-prevented')).toMatchObject({
            kind: 'orgPolicy',
            status: 412,
            constraint: 'storage.publicAccessPrevention',
        });
    });

    it('happyPath_aQuotaOrABillingPreconditionIsAnInvalidRequestWithItsReason', () => {
        expect(failureOf('cloud-billing/billing-info.quota-exceeded')).toEqual({ kind: 'invalid', status: 400, reason: 'QUOTA_EXCEEDED' });
        expect(failureOf('service-usage/enable.billing-required')).toEqual({
            kind: 'invalid',
            status: 400,
            reason: 'UREQ_PROJECT_BILLING_NOT_FOUND',
        });
        expect(
            failureOfAnswer(400, new Headers(), {
                error: {
                    details: [
                        {
                            '@type': 'type.googleapis.com/google.rpc.PreconditionFailure',
                            violations: [{ type: 'googleapis.com/billing-enabled' }],
                        },
                    ],
                },
            }),
        ).toEqual({
            kind: 'invalid',
            status: 400,
            reason: 'BILLING_REQUIRED',
        });
    });

    it('badPath_rateLimitsOutagesAndUnreadableAnswers', () => {
        expect(failureOf('google/error.rate-limited')).toMatchObject({ kind: 'rateLimited', status: 429, retryAfterSeconds: 30 });
        expect(failureOf('google/error.unavailable')).toEqual({ kind: 'unavailable', status: 503, reason: 'UNAVAILABLE' });
        expect(failureOf('google/error.not-found')).toEqual({ kind: 'notFound', status: 404, reason: 'NOT_FOUND' });
        expect(failureOf('google/error.unauthenticated')).toMatchObject({ kind: 'unauthorized', status: 401 });
        expect(failureOfAnswer(418, new Headers({ 'retry-after': 'Wed, 21 Oct 2026 07:28:00 GMT' }), '<html>')).toEqual({
            kind: 'invalid',
            status: 418,
        });
        expect(unavailableFailure()).toEqual({ kind: 'unavailable', status: 0 });
        const vague = {
            error: {
                status: 'FAILED_PRECONDITION',
                details: [
                    { '@type': 'type.googleapis.com/google.rpc.PreconditionFailure', violations: [{ subject: 'x' }] },
                    { '@type': 'type.googleapis.com/google.rpc.ErrorInfo' },
                ],
            },
        };
        expect(failureOfAnswer(400, new Headers(), vague)).toEqual({ kind: 'invalid', status: 400, reason: 'FAILED_PRECONDITION' });
        expect(unavailableFailure('roles/owner')).toEqual({ kind: 'unavailable', status: 0, role: 'roles/owner' });
    });
});

describe('failureOfOperation', () => {
    it('happyPath_aFinishedOperationsErrorMapsLikeAnAnswer', () => {
        expect(failureOfOperation({ code: 7, message: 'denied' }, 'roles/owner')).toEqual({
            kind: 'forbidden',
            status: 403,
            role: 'roles/owner',
        });
        expect(failureOfOperation({ code: 6 })).toEqual({ kind: 'conflict', status: 409 });
        expect(failureOfOperation({ code: 13 })).toEqual({ kind: 'unavailable', status: 500 });
        expect(failureOfOperation({})).toEqual({ kind: 'unavailable', status: 500 });
    });
});

describe('GoogleApiError', () => {
    it('happyPath_theFailuresFieldsAreTheErrorsOwnAndTheMessageHoldsNoUrl', () => {
        const error = new GoogleApiError('cloud-billing.updateBillingInfo', { kind: 'forbidden', status: 403, role: 'roles/billing.user' });

        expect(error).toMatchObject({ name: 'GoogleApiError', kind: 'forbidden', status: 403, role: 'roles/billing.user' });
        expect(error.message).toBe('cloud-billing.updateBillingInfo failed: forbidden (HTTP 403)');
        expect(googleFailureOf(error)).toEqual({ kind: 'forbidden', status: 403, role: 'roles/billing.user' });
        expect(isGoogleFailure(error, 'notFound', 'forbidden')).toBe(true);
    });

    it('badPath_anotherErrorIsNoGoogleFailure', () => {
        expect(googleFailureOf(new Error('x'))).toBeUndefined();
        expect(isGoogleFailure('x', 'forbidden')).toBe(false);
        expect(isGoogleFailure(new GoogleApiError('x', { kind: 'conflict', status: 409 }), 'forbidden')).toBe(false);
    });
});

describe('failureMessage', () => {
    it('happyPath_eachFailureHasItsMessage', () => {
        const messages = (
            [
                { kind: 'unauthorized', status: 401 },
                { kind: 'notFound', status: 404 },
                { kind: 'conflict', status: 409 },
                { kind: 'rateLimited', status: 429 },
                { kind: 'unavailable', status: 503 },
                { kind: 'unavailable', status: 0, host: 'analyticsadmin.googleapis.com' },
                { kind: 'invalid', status: 400 },
                { kind: 'invalid', status: 400, reason: 'QUOTA_EXCEEDED' },
                { kind: 'orgPolicy', status: 412, constraint: 'storage.publicAccessPrevention' },
                { kind: 'orgPolicy', status: 400 },
            ] satisfies GoogleFailure[]
        ).map((failure) => failureMessage(failure));

        expect(messages).toEqual([
            { key: 'adminShell.session.googleExpired' },
            { key: 'apiError.notFound' },
            { key: 'apiError.conflict' },
            { key: 'apiError.rateLimited' },
            { key: 'apiError.unavailable' },
            // Finding 48 of 2026-11-01: a request that never left the browser names its host, unlike a server's 503.
            { key: 'adminShell.network.blocked', params: { host: 'analyticsadmin.googleapis.com' } },
            { key: 'apiError.internal' },
            { key: 'adminSetup.billing.quota' },
            { key: 'adminSetup.provision.orgPolicy', params: { constraint: 'storage.publicAccessPrevention' } },
            { key: 'adminSetup.provision.orgPolicy', params: { constraint: '' } },
        ]);
    });

    it('badPath_aForbiddenCallNamesTheDisabledApiTheUntickedScopeOrTheRole', () => {
        expect(failureMessage({ kind: 'forbidden', status: 403, api: 'iam.googleapis.com' })).toEqual({
            key: 'apiError.cloud.apiDisabled',
            params: { api: 'iam.googleapis.com' },
        });
        // M6 (finding 4): an API the transport waited for and Google still refused is still switching on.
        expect(failureMessage({ kind: 'forbidden', status: 403, api: 'iam.googleapis.com', reason: 'API_PROPAGATING' })).toEqual({
            key: 'apiError.cloud.apiPropagation',
            params: { api: 'iam.googleapis.com' },
        });
        expect(failureMessage({ kind: 'forbidden', status: 403, reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' }, 'cloudBilling')).toEqual({
            key: 'adminShell.oauth.scopeDenied',
            params: { scope: 'adminShell.oauth.scope.cloudBilling' },
        });
        expect(failureMessage({ kind: 'forbidden', status: 403, role: 'roles/billing.user' })).toEqual({
            key: 'apiError.cloud.permission',
            params: { role: 'roles/billing.user' },
        });
        expect(failureMessage({ kind: 'forbidden', status: 403 })).toEqual({
            key: 'apiError.cloud.permission',
            params: { role: 'roles/owner' },
        });
    });
});
