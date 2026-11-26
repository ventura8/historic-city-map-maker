import { PROVISION_ITEMS, type ProvisionItem } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import {
    applyProvision,
    doctorProvision,
    planProvision,
    PROVISION_ORDER,
    type ProvisionItemResult,
} from '../../src/provision/provisioner.js';
import { provisionWorld, writes } from './world.js';

/**
 * The provisioner against the fake upstreams (docs/research/M2b-interfaces.md §3.4): a fresh Blaze project provisioned
 * in one run, a second run that writes nothing (S-A04-HAPPY-PROVISION), the doctor's dry run, a partial failure that
 * leaves its dependants waiting and a retry that runs only what is not ok (S-A04-BAD-PARTIAL-FAILURE), a token expiring
 * mid-run (S-A04-BAD-TOKEN-EXPIRED-MID-RUN).
 */

function stateOf(items: readonly ProvisionItemResult[], id: ProvisionItem): ProvisionItemResult | undefined {
    return items.find((item) => item.id === id);
}

function notOk(items: readonly ProvisionItemResult[]): ProvisionItemResult[] {
    return items.filter((item) => item.state !== 'ok');
}

const AFTER_DEPLOY: ProvisionItemResult = { id: 'scheduler', state: 'pending', detail: 'adminSetup.provision.afterDeploy' };

describe('applyProvision', () => {
    it('happyPath_aFreshBlazeProjectIsProvisionedInOneRunAndASecondRunWritesNothing', async () => {
        const world = provisionWorld();
        await world.createBudget();
        const heard: ProvisionItem[] = [];

        const report = await applyProvision(planProvision(null), world.deps, (item) => heard.push(item.id));
        const firstWrites = writes(world.fakes).length;
        const again = await applyProvision(planProvision(null), world.deps);

        expect(notOk(report.items)).toEqual([AFTER_DEPLOY]);
        expect(report.items.map((item) => item.id)).toEqual(PROVISION_ITEMS);
        expect(heard).toEqual(PROVISION_ORDER);
        expect(report.stopped).toBe(false);
        expect(firstWrites).toBeGreaterThan(30);
        expect(notOk(again.items)).toEqual([AFTER_DEPLOY]);
        expect(writes(world.fakes)).toHaveLength(firstWrites);
        expect(world.fakes.unhandled).toEqual([]);
    });

    it('happyPath_theProvisionedProjectHoldsWhatTheContractNames', async () => {
        const world = provisionWorld();
        const budget = await world.createBudget();

        const report = await applyProvision(planProvision(null), world.deps);
        const snapshot = JSON.stringify(world.fakes.snapshot());

        expect(world.fakes.state.serviceUsage.enabled.get('demo-hcm')?.has('analyticsadmin.googleapis.com')).toBe(true);
        expect(
            [...(world.fakes.state.iam.projects.get('demo-hcm')?.accounts.keys() ?? [])].toSorted((left, right) =>
                left.localeCompare(right),
            ),
        ).toEqual(['fn-admin', 'fn-crash', 'fn-events', 'gh-deployer', 'hcm-installer', 'job-raster']);
        expect(world.fakes.state.cloudStorage.buckets.has('demo-hcm.firebasestorage.app')).toBe(true);
        expect(snapshot).toContain('"roles/storage.legacyObjectReader","members":["allUsers"]');
        expect(snapshot).toContain("assertion.repository_owner_id=='1000001' && assertion.repository_id=='2000002'");
        expect(snapshot).toContain(
            'principalSet://iam.googleapis.com/projects/123456789012/locations/global/workloadIdentityPools/github/attribute.repository_id/2000002',
        );
        expect(snapshot).toContain('"pubsubTopic":"projects/demo-hcm/topics/budget"');
        expect(snapshot).toContain('billing-budget-alert@system.gserviceaccount.com');
        expect(snapshot).toContain(
            '"allowedReferrers":["https://demo-hcm.web.app/*","https://demo-hcm.firebaseapp.com/*","https://demo-hcm-admin.web.app/*","https://demo-hcm-admin.firebaseapp.com/*","https://ventura8.github.io/*"]',
        );
        expect(snapshot).toContain('"tokenTtl":"3600s"');
        expect(budget).toMatch(/^billingAccounts\/0E2E00-0E2E00-0E2E01\/budgets\//);
        expect(stateOf(report.items, 'app-check')?.params?.['siteKey']).toMatch(/^6Le2e/);
        expect(stateOf(report.items, 'workload-identity')?.params).toEqual({
            provider: 'projects/123456789012/locations/global/workloadIdentityPools/github/providers/site-master',
            serviceAccount: 'gh-deployer@demo-hcm.iam.gserviceaccount.com',
        });
        expect(stateOf(report.items, 'crash-alerts')?.params).toEqual({ enabled: 'true' });
        // The crash endpoint's account holds no role: none on the project, the buckets or the secrets (§42f).
        expect(snapshot.match(/fn-crash@demo-hcm\.iam\.gserviceaccount\.com/g) ?? []).toHaveLength(1);
    });

    it('badPath_aFailingItemLeavesItsDependantsWaitingAndARetryRunsOnlyWhatIsNotOk', async () => {
        const world = provisionWorld();
        await world.createBudget();
        world.fakes.fail('secret-manager', 'unavailable');

        const report = await applyProvision(planProvision(null), world.deps);
        world.fakes.fail('secret-manager', null);
        const retry = planProvision(report.items);
        const callsBefore = world.fakes.calls.length;
        const retried = await applyProvision(retry, world.deps);

        expect(notOk(report.items)).toEqual([
            { id: 'iam', state: 'pending', params: { item: 'secrets' } },
            { id: 'secrets', state: 'unavailable', detail: 'apiError.unavailable' },
            AFTER_DEPLOY,
        ]);
        expect(retry.items).toEqual(['secrets', 'iam', 'scheduler']);
        expect(notOk(retried.items)).toEqual([AFTER_DEPLOY]);
        expect(world.fakes.calls.slice(callsBefore).some((call) => call.operation.startsWith('cloud-tasks'))).toBe(false);
    });

    it('badPath_aTokenExpiringMidRunStopsTheRunAndARenewedOneResumesWithoutWritingTwice', async () => {
        const world = provisionWorld();
        await world.createBudget();
        world.dropTokenAfter(12);

        const stopped = await applyProvision(planProvision(null), world.deps);
        const writtenBefore = writes(world.fakes).map((call) => `${call.operation} ${call.url}`);
        world.renewToken();
        const resumed = await applyProvision(planProvision(stopped.items), world.deps);
        const writtenAgain = writes(world.fakes)
            .slice(writtenBefore.length)
            .map((call) => `${call.operation} ${call.url}`);

        expect(stopped.stopped).toBe(true);
        expect(stopped.items.length).toBeLessThan(PROVISION_ITEMS.length);
        expect(stopped.items).toContainEqual(expect.objectContaining({ detail: 'adminShell.session.googleExpired' }));
        expect(notOk(resumed.items)).toEqual([AFTER_DEPLOY]);
        expect(writtenAgain.filter((call) => writtenBefore.includes(call))).toEqual([]);
    });
});

describe('applyProvision when something goes wrong', () => {
    it('badPath_aRefusedOrUnreachableItemIsInvalidOrUnavailableAndTheRunGoesOn', async () => {
        const world = provisionWorld();
        await world.createBudget();
        world.fakes.fail('monitoring', 'forbidden');
        world.fakes.fail('api-keys', 'rateLimited');
        world.fakes.fail('pubsub', 'apiDisabled');

        const report = await applyProvision(planProvision(null), world.deps);

        expect(notOk(report.items)).toEqual([
            AFTER_DEPLOY,
            { id: 'budget-alerts', state: 'missing', detail: 'apiError.cloud.apiDisabled', params: { api: 'pubsub.googleapis.com' } },
            { id: 'crash-alerts', state: 'invalid', detail: 'apiError.cloud.permission', params: { role: 'roles/owner' } },
            { id: 'api-key', state: 'unavailable', detail: 'apiError.rateLimited' },
        ]);
        expect(world.sink.records.filter((record) => record.message === 'google call retried')).toHaveLength(3);
    });

    it('badPath_anUnexpectedErrorIsAnInternalFailureAndIsLoggedWithoutDetails', async () => {
        const world = provisionWorld();
        const queues = { ...world.clients.queues, queueExists: () => Promise.reject(new TypeError('queue lookup broke')) };
        const deps = { ...world.deps, clients: { ...world.clients, queues } };

        const report = await doctorProvision(deps, ['task-queues']);

        expect(report.items).toEqual([{ id: 'task-queues', state: 'invalid', detail: 'apiError.internal' }]);
        expect(world.sink.records.at(-1)).toMatchObject({ level: 'error', data: { item: 'task-queues', error: 'TypeError' } });
        expect(JSON.stringify(world.sink.records)).not.toContain('queue lookup broke');
    });

    it('badPath_aBuildOfAnotherProjectRefusesEveryItem', async () => {
        const world = provisionWorld();
        const deps = { ...world.deps, web: { ...world.deps.web, projectId: 'another-project' } };
        const heard: string[] = [];

        const report = await applyProvision(planProvision(null, ['apis', 'iam']), deps, (item) => heard.push(item.id));

        expect(report.items).toEqual([
            { id: 'apis', state: 'invalid', detail: 'apiError.invalidRequest', params: { projectId: 'demo-hcm' } },
            { id: 'iam', state: 'invalid', detail: 'apiError.invalidRequest', params: { projectId: 'demo-hcm' } },
        ]);
        expect(heard).toEqual(['apis', 'iam']);
        expect(world.fakes.calls).toEqual([]);
    });
});

describe('doctorProvision', () => {
    it('happyPath_theDoctorOfAFreshProjectWritesNothingAndSaysWhatEachItemLacks', async () => {
        const world = provisionWorld({ billing: false });

        const report = await doctorProvision(world.deps);

        expect(writes(world.fakes)).toEqual([]);
        expect(report.items.filter((item) => item.state === 'ok').map((item) => item.id)).toEqual(['org-policies']);
        expect(stateOf(report.items, 'apis')).toEqual({ id: 'apis', state: 'missing' });
        expect(stateOf(report.items, 'scheduler')).toEqual(AFTER_DEPLOY);
        expect(stateOf(report.items, 'budget-alerts')).toEqual({ id: 'budget-alerts', state: 'missing' });
    });

    it('happyPath_theDoctorChecksOnlyWhatItIsAskedAndReportsEachItem', async () => {
        const world = provisionWorld();
        const heard: ProvisionItemResult[] = [];

        const report = await doctorProvision(world.deps, ['secrets', 'apis'], (item) => heard.push(item));

        expect(report.items.map((item) => item.id)).toEqual(['apis', 'secrets']);
        expect(heard.map((item) => item.id)).toEqual(['apis', 'secrets']);
        expect(writes(world.fakes)).toEqual([]);
    });

    it('happyPath_onceTheServerIsDeployedTheSchedulerJobIsChecked', async () => {
        const world = provisionWorld();
        world.fakes.scenario('google.deployed');

        const deployed = await doctorProvision(world.deps, ['scheduler']);
        world.fakes.state.deployment.schedulerJob = false;
        const jobMissing = await doctorProvision(world.deps, ['scheduler']);

        expect(deployed.items).toEqual([{ id: 'scheduler', state: 'ok' }]);
        expect(jobMissing.items).toEqual([{ id: 'scheduler', state: 'invalid', detail: 'apiError.notFound' }]);
    });

    it('badPath_aTokenGoneBeforeTheDoctorStopsAtTheFirstItem', async () => {
        const world = provisionWorld();
        world.dropToken();

        const report = await doctorProvision(world.deps);

        expect(report).toEqual({ items: [{ id: 'apis', state: 'invalid', detail: 'adminShell.session.googleExpired' }], stopped: true });
        expect(world.fakes.calls).toEqual([]);
    });
});

describe('planProvision', () => {
    it('happyPath_withoutAReportEveryAskedItemRunsInExecutionOrder', () => {
        expect(planProvision(null).items).toEqual(PROVISION_ORDER);
        expect(planProvision(null, ['scheduler', 'apis']).items).toEqual(['apis', 'scheduler']);
        expect(new Set(PROVISION_ORDER)).toEqual(new Set(PROVISION_ITEMS));
    });

    it('badPath_itemsAlreadyOkAreLeftOut', () => {
        const observed: ProvisionItemResult[] = [
            { id: 'apis', state: 'ok' },
            { id: 'iam', state: 'pending' },
        ];

        expect(planProvision(observed, ['apis', 'iam']).items).toEqual(['iam']);
    });
});
