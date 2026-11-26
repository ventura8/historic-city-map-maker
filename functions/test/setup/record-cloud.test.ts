/**
 * `setup.recordCloud` (PLAN Addendum 1; scenario A04): what the browser-side billing check and the Provision cloud
 * doctor found is stored, stamped with the caller; the provisioning card is as good as its worst item.
 */
import { FIRESTORE_PATHS, PROVISION_ITEMS, type ProvisionItem, type ServiceState } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { recordCloud } from '../../src/setup/record-cloud.js';
import { ADMIN, NOW, createWorld, type World } from './world.js';

const CHECKED = { seconds: Date.parse(NOW) / 1000, nanoseconds: 0 };
const BILLING = {
    state: 'ok',
    budgetId: 'billingAccounts/0E2E00-0E2E00-0E2E01/budgets/0e2e0000-0000-4000-8000-000000000001',
    budgetAmount: 5,
    currency: 'USD',
} as const;

function items(state: ServiceState, ids: readonly ProvisionItem[] = PROVISION_ITEMS) {
    return ids.map((id) => ({ id, state }));
}

function record(world: World, request: Parameters<typeof recordCloud>[2]) {
    return recordCloud(world.deps, ADMIN, request);
}

describe('setup.recordCloud', () => {
    it('happyPath_billingAndTheBudgetAreStored', async () => {
        const world = createWorld();

        const response = await record(world, { billing: BILLING });

        expect(response.status.billing).toEqual({ ...BILLING, checkedAt: '2026-10-11T08:30:00.000Z' });
        expect(response.status.ready).toBe(false);
        expect(world.status()).toMatchObject({ billing: { ...BILLING, checkedAt: CHECKED }, updatedBy: ADMIN.uid });
        expect(world.status()).not.toHaveProperty('provision');
    });

    it('happyPath_everyItemOkMakesTheProvisioningGreenAndTheMapReady', async () => {
        const world = createWorld();
        world.documents.seed(FIRESTORE_PATHS.setupStatus, {
            mapbox: { state: 'ok' },
            usgs: { state: 'ok' },
            updatedBy: ADMIN.uid,
            updatedAt: CHECKED,
        });
        await record(world, { billing: BILLING });

        const response = await record(world, { provision: { items: items('ok') } });

        expect(response.status.provision.state).toBe('ok');
        expect(response.status.provision.items).toHaveLength(PROVISION_ITEMS.length);
        expect(response.status.ready).toBe(true);
        expect(world.status()?.billing?.state).toBe('ok');
    });

    it('badPath_aPartialReportLeavesTheOtherItemsMissing', async () => {
        const world = createWorld();

        const response = await record(world, { provision: { items: items('ok', ['secrets', 'apis']) } });

        expect(response.status.provision).toEqual({
            state: 'missing',
            checkedAt: '2026-10-11T08:30:00.000Z',
            items: [
                { id: 'apis', state: 'ok' },
                { id: 'secrets', state: 'ok' },
            ],
        });
    });

    it('badPath_aRunThatDidNotReachEveryChangedItemRecordsNoVersionSoTheNextUpdateRunsThemAgain @S-A04-BAD-UPDATE-PROVISION', async () => {
        // Finding 65 of 2026-11-02: the admin sends the item set's version only when its run brought every changed item to ok.
        const world = createWorld();

        const partial = await record(world, {
            provision: { items: [...items('ok', ['apis']), { id: 'bucket-lifecycle', state: 'invalid' }] },
        });
        expect(partial.status.provision).not.toHaveProperty('setVersion');

        const reached = await record(world, { provision: { items: items('ok'), setVersion: 2 } });
        const later = await record(world, { provision: { items: items('ok', ['apis']) } });
        expect(reached.status.provision.setVersion).toBe(2);
        expect(later.status.provision.setVersion).toBe(2);
        expect(world.status()?.provision?.setVersion).toBe(2);
    });

    it('happyPath_aLaterReportReplacesItsItemsAndKeepsTheOthers', async () => {
        const world = createWorld();
        await record(world, { provision: { items: items('ok') } });

        const response = await record(world, {
            provision: {
                items: [
                    { id: 'buckets', state: 'pending' },
                    { id: 'buckets', state: 'invalid', detail: 'apiError.cloud.permission', params: { role: 'roles/storage.admin' } },
                ],
            },
        });

        expect(response.status.provision.state).toBe('invalid');
        expect(response.status.provision.items.find((item) => item.id === 'buckets')).toEqual({
            id: 'buckets',
            state: 'invalid',
            detail: 'apiError.cloud.permission',
            params: { role: 'roles/storage.admin' },
        });
        expect(world.status()?.provision?.items).toHaveLength(PROVISION_ITEMS.length);
    });

    it.each([
        [['ok', 'pending'], 'pending'],
        [['pending', 'missing'], 'missing'],
        [['missing', 'unavailable', 'ok'], 'unavailable'],
        [['unavailable', 'invalid'], 'invalid'],
    ] as const)('badPath_theCardTakesTheWorstOf_%j', async (states, worst) => {
        const world = createWorld();
        const reported = PROVISION_ITEMS.map((id, index) => ({ id, state: states[index % states.length] ?? 'ok' }));

        await expect(record(world, { provision: { items: reported } })).resolves.toMatchObject({ status: { provision: { state: worst } } });
    });

    it('happyPath_aSchedulerWaitingForTheFirstDeployDoesNotHoldTheProvisioningBack', async () => {
        const world = createWorld();
        const waiting = PROVISION_ITEMS.map((id) => ({ id, state: id === 'scheduler' ? 'pending' : 'ok' }) as const);

        await expect(record(world, { provision: { items: waiting } })).resolves.toMatchObject({ status: { provision: { state: 'ok' } } });
    });

    it('badPath_aSchedulerFoundBrokenStillHoldsTheProvisioningBack', async () => {
        const world = createWorld();
        const broken = PROVISION_ITEMS.map((id) => ({ id, state: id === 'scheduler' ? 'invalid' : 'ok' }) as const);

        await expect(record(world, { provision: { items: broken } })).resolves.toMatchObject({
            status: { provision: { state: 'invalid' } },
        });
    });

    it('happyPath_aBillingReportLeavesTheProvisioningAlone', async () => {
        const world = createWorld();
        await record(world, { provision: { items: items('ok') } });

        await record(world, {
            billing: { state: 'invalid', detail: 'apiError.cloud.permission', params: { role: 'roles/billing.viewer' } },
        });

        expect(world.status()?.provision?.state).toBe('ok');
        expect(world.status()?.billing).toEqual({
            state: 'invalid',
            detail: 'apiError.cloud.permission',
            params: { role: 'roles/billing.viewer' },
            checkedAt: CHECKED,
        });
    });
});
