import { GOOGLE_TOKENS } from '@hcm/test-support/fakes';
import { describe, expect, it } from 'vitest';

import {
    bootstrapRecordKey,
    clearBootstrapRecord,
    isBootstrapRecord,
    readBootstrapRecord,
    writeBootstrapRecord,
    type BootstrapRecord,
} from '../../src/setup/bootstrap-record.js';
import { FakeSession, PROJECT_ID } from './harness.js';

const CHECKED = '2026-10-12T09:00:00.000Z';

const RECORD: BootstrapRecord = {
    version: 1,
    projectId: PROJECT_ID,
    updatedAt: CHECKED,
    steps: {
        signIn: { state: 'ok', checkedAt: CHECKED },
        billing: {
            state: 'invalid',
            checkedAt: CHECKED,
            detail: 'apiError.cloud.permission',
            params: { role: 'roles/billing.costsManager' },
        },
        deploy: {
            state: 'pending',
            checkedAt: '2026-10-12T09:00:00Z',
            detail: 'adminSetup.deploy.progress',
            params: { ready: '3', total: '32' },
        },
    },
    billing: {
        accountName: 'billingAccounts/AAAAAA-BBBBBB-CCCCCC',
        budgetId: 'billingAccounts/AAAAAA-BBBBBB-CCCCCC/budgets/b-1',
        budgetAmount: 5,
        currency: 'USD',
    },
    provision: {
        items: [
            {
                id: 'buckets',
                state: 'invalid',
                detail: 'adminSetup.provision.orgPolicy',
                params: { constraint: 'storage.publicAccessPrevention' },
            },
        ],
    },
    deploy: { ready: 3, total: 32, failed: ['admin-claim'] },
};

function variant(change: Readonly<Record<string, unknown>>): unknown {
    return { ...RECORD, ...change };
}

describe('readBootstrapRecord and writeBootstrapRecord', () => {
    it('happyPath_aRecordSurvivesTheRoundTripUnderItsProjectKey', () => {
        const session = new FakeSession();

        expect(writeBootstrapRecord(session, RECORD)).toBe(true);
        expect([...session.values.keys()]).toEqual([bootstrapRecordKey(PROJECT_ID)]);
        expect(bootstrapRecordKey(PROJECT_ID)).toBe('hcm:admin:bootstrap:demo-hcm');
        expect(readBootstrapRecord(session, PROJECT_ID)).toEqual(RECORD);
    });

    it('happyPath_noRecordReadsAsNull', () => {
        expect(readBootstrapRecord(new FakeSession(), PROJECT_ID)).toBeNull();
    });

    it('badPath_anotherProjectsRecordIsDropped', () => {
        const session = new FakeSession();
        session.set(bootstrapRecordKey(PROJECT_ID), JSON.stringify({ ...RECORD, projectId: 'other-project' }));

        expect(readBootstrapRecord(session, PROJECT_ID)).toBeNull();
        expect(session.values.size).toBe(0);
    });

    it('badPath_textThatIsNotJsonIsDropped', () => {
        const session = new FakeSession();
        session.set(bootstrapRecordKey(PROJECT_ID), '{not json');

        expect(readBootstrapRecord(session, PROJECT_ID)).toBeNull();
        expect(session.values.size).toBe(0);
    });

    it('happyPath_clearRemovesTheRecord', () => {
        const session = new FakeSession();
        writeBootstrapRecord(session, RECORD);

        clearBootstrapRecord(session, PROJECT_ID);

        expect(session.values.size).toBe(0);
    });
});

describe('isBootstrapRecord', () => {
    it('happyPath_theSmallestRecordIsWellFormed', () => {
        expect(isBootstrapRecord({ version: 1, projectId: PROJECT_ID, updatedAt: CHECKED, steps: {} })).toBe(true);
    });

    it.each([
        ['an access token as a field', variant({ accessToken: GOOGLE_TOKENS.owner })],
        [
            'an access token as a parameter',
            variant({ steps: { billing: { state: 'ok', checkedAt: CHECKED, params: { token: GOOGLE_TOKENS.owner } } } }),
        ],
        [
            'an e-mail address as a parameter',
            variant({ steps: { signIn: { state: 'ok', checkedAt: CHECKED, params: { who: 'owner@example.com' } } } }),
        ],
        ['a sentence as a reason', variant({ steps: { signIn: { state: 'ok', checkedAt: CHECKED, detail: 'Billing is linked' } } })],
        ['an unknown step', variant({ steps: { mapbox: { state: 'ok', checkedAt: CHECKED } } })],
        ['a time that is not ISO 8601', variant({ updatedAt: '12/10/2026' })],
        ['an unknown state', variant({ steps: { signIn: { state: 'done', checkedAt: CHECKED } } })],
        ['a display name for the account', variant({ billing: { accountName: 'My card' } })],
        ['a negative budget', variant({ billing: { budgetAmount: -5 } })],
        ['a fractional function count', variant({ deploy: { ready: 1.5, total: 32 } })],
        ['a malformed function name', variant({ deploy: { ready: 1, total: 32, failed: ['Admin Claim'] } })],
        [
            'too many parameters',
            variant({
                steps: {
                    signIn: {
                        state: 'ok',
                        checkedAt: CHECKED,
                        params: Object.fromEntries('abcdefghijk'.split('').map((name) => [name, '1'])),
                    },
                },
            }),
        ],
        ['a parameter that is not text', variant({ steps: { signIn: { state: 'ok', checkedAt: CHECKED, params: { count: 3 } } } })],
        ['a parameter with a bad name', variant({ steps: { signIn: { state: 'ok', checkedAt: CHECKED, params: { 'bad-name': '1' } } } })],
        ['a list of items that is not a list', variant({ provision: { items: 'all' } })],
        ['an array instead of a record', [RECORD]],
        ['another version', variant({ version: 2 })],
        ['nothing', null],
    ])('badPath_%s_isRefused', (_case, value) => {
        expect(isBootstrapRecord(value)).toBe(false);
    });

    it('badPath_writingAMalformedRecordWritesNothing', () => {
        const session = new FakeSession();

        expect(writeBootstrapRecord(session, { ...RECORD, projectId: 'X' })).toBe(false);
        expect(session.values.size).toBe(0);
    });
});
