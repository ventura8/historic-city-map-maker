import { createFakeFetch, createUpstreamFakes, GOOGLE_TOKENS, jsonResponse } from '@hcm/test-support/fakes';
import { describe, expect, it } from 'vitest';

import { checkOwnership, disabledService, enableService } from '../../src/auth/ownership.js';

const PROJECT = 'demo-hcm';

describe('checkOwnership', () => {
    it('happyPath_theProjectOwnerStartsTheSetup', async () => {
        const fakes = createUpstreamFakes();

        await expect(checkOwnership(fakes.fetch, PROJECT, GOOGLE_TOKENS.owner)).resolves.toEqual({ kind: 'owner' });
        expect(fakes.callsTo('resource-manager.testIamPermissions')[0]?.url).toBe(
            'https://cloudresourcemanager.googleapis.com/v3/projects/demo-hcm:testIamPermissions',
        );
        expect(fakes.callsTo('service-usage')).toEqual([]);
    });

    it('badPath_anEditorOfANeverSetUpMapIsNotTheOwner', async () => {
        const fakes = createUpstreamFakes();

        await expect(checkOwnership(fakes.fetch, PROJECT, GOOGLE_TOKENS.editor)).resolves.toEqual({ kind: 'notOwner' });
        expect(fakes.callsTo('service-usage.get')[0]?.url).toContain('/services/cloudfunctions.googleapis.com');
    });

    it('badPath_aStrangerIsNotTheOwner', async () => {
        const fakes = createUpstreamFakes();

        await expect(checkOwnership(fakes.fetch, PROJECT, GOOGLE_TOKENS.stranger)).resolves.toEqual({ kind: 'notOwner' });
    });

    it('badPath_aSetUpMapWhoseServerIsDownIsDown', async () => {
        const fakes = createUpstreamFakes();
        fakes.scenario('service-usage.allEnabled');

        await expect(checkOwnership(fakes.fetch, PROJECT, GOOGLE_TOKENS.editor)).resolves.toEqual({ kind: 'down' });
    });

    it('badPath_anExpiredTokenAsksForConsentAgain', async () => {
        const fakes = createUpstreamFakes();

        await expect(checkOwnership(fakes.fetch, PROJECT, GOOGLE_TOKENS.expired)).resolves.toEqual({ kind: 'expired' });
    });

    it('badPath_aDisabledResourceManagerIsNamed', async () => {
        const fakes = createUpstreamFakes();
        fakes.fail('resource-manager', 'apiDisabled');

        await expect(checkOwnership(fakes.fetch, PROJECT, GOOGLE_TOKENS.owner)).resolves.toEqual({
            kind: 'apiDisabled',
            api: 'cloudresourcemanager.googleapis.com',
        });
    });

    it('badPath_aGoogleOutageIsDown', async () => {
        const fakes = createUpstreamFakes();
        fakes.fail('resource-manager', 'unavailable');

        await expect(checkOwnership(fakes.fetch, PROJECT, GOOGLE_TOKENS.owner)).resolves.toEqual({ kind: 'down' });
    });

    it('badPath_aServiceUsageOutageLeavesItOpen', async () => {
        const fakes = createUpstreamFakes();
        fakes.fail('service-usage', 'unavailable');

        await expect(checkOwnership(fakes.fetch, PROJECT, GOOGLE_TOKENS.editor)).resolves.toEqual({ kind: 'down' });
    });

    it('badPath_aNetworkFailureIsDown', async () => {
        await expect(checkOwnership(createFakeFetch(() => undefined).fetch, PROJECT, GOOGLE_TOKENS.owner)).resolves.toEqual({
            kind: 'down',
        });
    });

    it('badPath_anUnreadableAnswerIsNotOwnership', async () => {
        const fetcher = createFakeFetch((request) =>
            request.url.hostname === 'cloudresourcemanager.googleapis.com'
                ? { operation: 'rm', response: new Response('not json', { status: 200 }) }
                : { operation: 'su', response: jsonResponse({}) },
        );

        await expect(checkOwnership(fetcher.fetch, PROJECT, GOOGLE_TOKENS.owner)).resolves.toEqual({ kind: 'down' });
    });
});

describe('disabledService', () => {
    it('happyPath_readsTheServiceOfAServiceDisabledError', () => {
        const body = {
            error: { details: [{ reason: 'OTHER' }, { reason: 'SERVICE_DISABLED', metadata: { service: 'x.googleapis.com' } }] },
        };

        expect(disabledService(body)).toBe('x.googleapis.com');
    });

    it.each([null, {}, { error: { details: 'no' } }, { error: { details: [{ reason: 'SERVICE_DISABLED' }] } }])(
        'badPath_%j_namesNone',
        (body) => {
            expect(disabledService(body)).toBeUndefined();
        },
    );
});

describe('enableService', () => {
    it('happyPath_aSparkSafeApiIsEnabled', async () => {
        const fakes = createUpstreamFakes();

        await expect(enableService(fakes.fetch, PROJECT, GOOGLE_TOKENS.owner, 'cloudresourcemanager.googleapis.com')).resolves.toBe(true);
        expect(JSON.parse(fakes.callsTo('service-usage.batchEnable')[0]?.body ?? '{}')).toEqual({
            serviceIds: ['cloudresourcemanager.googleapis.com'],
        });
    });

    it('badPath_aRefusalOrANetworkFailureIsFalse', async () => {
        const fakes = createUpstreamFakes();
        fakes.fail('service-usage', 'forbidden');

        await expect(enableService(fakes.fetch, PROJECT, GOOGLE_TOKENS.owner, 'x.googleapis.com')).resolves.toBe(false);
        await expect(enableService(createFakeFetch(() => undefined).fetch, PROJECT, GOOGLE_TOKENS.owner, 'x.googleapis.com')).resolves.toBe(
            false,
        );
    });
});
