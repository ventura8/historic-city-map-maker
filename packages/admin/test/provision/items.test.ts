import { describe, expect, it } from 'vitest';

import { applyProvision, doctorProvision, planProvision, type ProvisionItemResult } from '../../src/provision/provisioner.js';
import { must, PROJECT, provisionWorld, writes } from './world.js';

const GITHUB = must(PROJECT.github);

/**
 * The items' own cases (docs/research/M2b-interfaces.md §3.4, §3.4.2): organisation policies (S-A04-BAD-ORG-POLICY), a
 * bucket name another project owns, the legacy role refused under uniform access, a deleted Workload Identity pool, a
 * provider whose condition changed, a browser key that is not the web configuration's, no owner address, no budget.
 */

function only(items: readonly ProvisionItemResult[], ...ids: readonly string[]): ProvisionItemResult[] {
    return items.filter((item) => ids.includes(item.id));
}

describe('a project of the owner own (CR-M5-7)', () => {
    it('happyPath_noGithubMeansNoDeployerAndNoPool', async () => {
        const world = provisionWorld();
        const own = Object.fromEntries(Object.entries(PROJECT).filter(([key]) => key !== 'github')) as Omit<typeof PROJECT, 'github'>;
        const report = await applyProvision(planProvision(null, ['apis', 'service-accounts', 'workload-identity', 'iam']), {
            ...world.deps,
            project: own,
        });

        expect(report.items.find((item) => item.id === 'workload-identity')).toMatchObject({ state: 'ok' });
        const iam = JSON.stringify(world.fakes.snapshot()['iam']);
        expect(iam).toContain('hcm-installer');
        expect(iam).not.toContain('gh-deployer');
        expect(iam).not.toContain('site-master');
        expect(world.fakes.callsTo('iam.workloadIdentityPools')).toHaveLength(0);
    });
});

describe('organisation policies', () => {
    it('happyPath_aProjectOutsideAnyOrganisationHasNothingEnforced', async () => {
        const world = provisionWorld();

        const report = await doctorProvision(world.deps, ['org-policies']);

        expect(report.items).toEqual([{ id: 'org-policies', state: 'ok' }]);
        expect(world.fakes.callsTo('org-policy')).toEqual([]);
    });

    it('badPath_domainRestrictedSharingLeavesTheBucketsInvalidButCreatesThem', async () => {
        const world = provisionWorld();
        world.fakes.scenario('resource-manager.domainRestricted');

        const report = await applyProvision(planProvision(null), world.deps);

        expect(only(report.items, 'buckets', 'bucket-cors', 'org-policies')).toEqual([
            {
                id: 'buckets',
                state: 'invalid',
                detail: 'adminSetup.provision.orgPolicy',
                params: { constraint: 'iam.allowedPolicyMemberDomains' },
            },
            { id: 'bucket-cors', state: 'pending', params: { item: 'buckets' } },
            { id: 'org-policies', state: 'ok', params: { enforced: 'iam.allowedPolicyMemberDomains' } },
        ]);
        expect(world.fakes.state.cloudStorage.buckets.has('demo-hcm-public')).toBe(true);
        expect(JSON.stringify(world.fakes.snapshot()['cloud-storage'])).not.toContain('allUsers');
    });

    it('badPath_publicAccessPreventionNamesItsConstraint', async () => {
        const world = provisionWorld();
        world.fakes.scenario('org-policy.publicAccessPrevented');

        const report = await applyProvision(planProvision(null, ['apis', 'org-policies', 'buckets']), world.deps);

        expect(only(report.items, 'buckets')).toEqual([
            {
                id: 'buckets',
                state: 'invalid',
                detail: 'adminSetup.provision.orgPolicy',
                params: { constraint: 'storage.publicAccessPrevention' },
            },
        ]);
    });

    it('happyPath_withoutDefaultGrantsTheComputeAccountGetsTheBuilderRole', async () => {
        const world = provisionWorld();
        world.fakes.scenario('org-policy.noDefaultGrants');

        const report = await applyProvision(planProvision(null), world.deps);
        const policy = JSON.stringify(world.fakes.state.resourceManager.policies.get('demo-hcm'));

        expect(only(report.items, 'iam', 'org-policies')).toEqual([
            { id: 'iam', state: 'ok' },
            { id: 'org-policies', state: 'ok', params: { enforced: 'iam.automaticIamGrantsForDefaultServiceAccounts' } },
        ]);
        expect(policy).toContain(
            '"role":"roles/cloudbuild.builds.builder","members":["serviceAccount:123456789012-compute@developer.gserviceaccount.com"]',
        );
    });

    it('badPath_anUnreadablePolicyLeavesTheItemsThatNeedItWaiting', async () => {
        const world = provisionWorld();
        world.fakes.scenario('resource-manager.inOrganization');
        world.fakes.fail('org-policy', 'unavailable');

        const report = await applyProvision(planProvision(null, ['apis', 'org-policies', 'buckets', 'iam']), world.deps);

        expect(only(report.items, 'iam', 'buckets', 'org-policies')).toEqual([
            { id: 'iam', state: 'pending', params: { item: 'buckets' } },
            { id: 'buckets', state: 'pending', params: { item: 'org-policies' } },
            { id: 'org-policies', state: 'unavailable', detail: 'apiError.unavailable' },
        ]);
    });
});

describe('buckets', () => {
    it('badPath_aPublicBucketNameAnotherProjectOwnsIsAConflict', async () => {
        const world = provisionWorld();
        world.fakes.scenario('cloud-storage.publicBucketTaken');

        const report = await applyProvision(planProvision(null, ['apis', 'org-policies', 'buckets']), world.deps);

        expect(only(report.items, 'buckets')).toEqual([
            { id: 'buckets', state: 'invalid', detail: 'apiError.conflict', params: { bucket: 'demo-hcm-public' } },
        ]);
    });

    it('happyPath_aRefusedLegacyRoleFallsBackToObjectViewer', async () => {
        const world = provisionWorld();
        world.fakes.scenario('cloud-storage.legacyRolesRefused');

        const report = await applyProvision(planProvision(null, ['apis', 'org-policies', 'buckets']), world.deps);

        expect(only(report.items, 'buckets')).toEqual([{ id: 'buckets', state: 'ok' }]);
        expect(JSON.stringify(world.fakes.snapshot()['cloud-storage'])).toContain(
            '"role":"roles/storage.objectViewer","members":["allUsers"]',
        );
    });

    it('badPath_aBucketOfAnotherProjectThatCannotBeReadIsTaken', async () => {
        const world = provisionWorld();
        const storage = {
            ...world.clients.storage,
            getBucket: () =>
                world.clients.storage
                    .bucketPolicy('demo-hcm-public')
                    .read()
                    .then(() => undefined),
        };
        world.fakes.fail('cloud-storage', 'forbidden');
        const deps = { ...world.deps, clients: { ...world.clients, storage } };

        const report = await doctorProvision(deps, ['buckets']);

        expect(report.items).toEqual([
            { id: 'buckets', state: 'invalid', detail: 'apiError.conflict', params: { bucket: 'demo-hcm-public' } },
        ]);
    });

    it('badPath_corsAndLifecycleOfMissingBucketsAreMissing', async () => {
        const world = provisionWorld();

        const report = await doctorProvision(world.deps, ['bucket-cors', 'bucket-lifecycle']);

        expect(report.items).toEqual([
            { id: 'bucket-cors', state: 'missing' },
            { id: 'bucket-lifecycle', state: 'missing' },
        ]);
    });
});

describe('workload identity', () => {
    it('happyPath_aDeletedPoolIsUndeletedNotRecreated', async () => {
        const world = provisionWorld();
        world.fakes.scenario('iam.poolDeleted');

        const report = await applyProvision(planProvision(null, ['apis', 'service-accounts', 'workload-identity']), world.deps);

        expect(only(report.items, 'workload-identity')).toEqual([expect.objectContaining({ id: 'workload-identity', state: 'ok' })]);
        expect(world.fakes.callsTo('iam.workloadIdentityPools.undelete')).toHaveLength(1);
        expect(world.fakes.callsTo('iam.workloadIdentityPools.create')).toEqual([]);
    });

    it('happyPath_aProviderWithAnOldConditionIsPatchedAndTheNewRepositoryBound', async () => {
        const world = provisionWorld();
        await applyProvision(planProvision(null, ['apis', 'service-accounts', 'workload-identity']), world.deps);
        const moved = { ...PROJECT, github: { ...GITHUB, repoId: 3000003 } };

        const report = await applyProvision(planProvision(null, ['workload-identity']), { ...world.deps, project: moved });

        expect(report.items).toEqual([expect.objectContaining({ id: 'workload-identity', state: 'ok' })]);
        expect(world.fakes.callsTo('iam.workloadIdentityPools.providers.patch')).toHaveLength(1);
        expect(JSON.stringify(world.fakes.snapshot()['iam'])).toContain("assertion.repository_id=='3000003'");
    });

    it('happyPath_aDeletedProviderIsUndeleted', async () => {
        const world = provisionWorld();
        await applyProvision(planProvision(null, ['apis', 'service-accounts', 'workload-identity']), world.deps);
        world.fakes.state.iam.projects.get('demo-hcm')?.deleted.add('github/site-master');

        const report = await applyProvision(planProvision(null, ['workload-identity']), world.deps);

        expect(report.items).toEqual([expect.objectContaining({ id: 'workload-identity', state: 'ok' })]);
        expect(world.fakes.callsTo('iam.workloadIdentityPools.providers.undelete')).toHaveLength(1);
    });
});

describe('the custom role of the translation drafts (M4)', () => {
    const IAM_PREFIX = ['apis', 'service-accounts', 'buckets', 'artifact-registry', 'secrets', 'org-policies', 'iam'] as const;

    it('happyPath_theRoleIsMadeWithItsPermissionsBeforeTheBindingThatNamesIt', async () => {
        const world = provisionWorld();

        const report = await applyProvision(planProvision(null, [...IAM_PREFIX]), world.deps);

        expect(only(report.items, 'iam')).toEqual([{ id: 'iam', state: 'ok' }]);
        const operations = world.fakes.calls.map((call) => call.operation);
        expect(operations.indexOf('iam.roles.create')).toBeGreaterThan(-1);
        expect(operations.indexOf('iam.roles.create')).toBeLessThan(operations.indexOf('resource-manager.setIamPolicy'));
        expect(world.fakes.state.iam.projects.get('demo-hcm')?.roles.get('hcmVertexDrafts')).toEqual({
            includedPermissions: ['aiplatform.endpoints.predict'],
            deleted: false,
        });
        expect(JSON.stringify(world.fakes.snapshot()['resource-manager'])).toContain('projects/demo-hcm/roles/hcmVertexDrafts');
        expect(JSON.stringify(world.fakes.snapshot()['resource-manager'])).not.toContain('roles/aiplatform.user');
    });

    it('badPath_aDeletedRoleWithOtherPermissionsIsUndeletedAndCorrectedNotRecreated', async () => {
        const world = provisionWorld();
        world.fakes.scenario('iam.roleDeleted');

        const doctor = await doctorProvision(world.deps, ['iam']);
        const report = await applyProvision(planProvision(null, [...IAM_PREFIX]), world.deps);

        expect(doctor.items[0]).toMatchObject({ id: 'iam', state: 'missing' });
        expect(only(report.items, 'iam')).toEqual([{ id: 'iam', state: 'ok' }]);
        expect(world.fakes.callsTo('iam.roles.undelete')).toHaveLength(1);
        expect(world.fakes.callsTo('iam.roles.patch')).toHaveLength(1);
        // Only M6's installer role (hcmInstaller) is new here; the drafts' role is never recreated.
        expect(world.fakes.callsTo('iam.roles.create').filter((call) => call.body.includes('hcmVertexDrafts'))).toEqual([]);
        expect(world.fakes.state.iam.projects.get('demo-hcm')?.roles.get('hcmVertexDrafts')).toEqual({
            includedPermissions: ['aiplatform.endpoints.predict'],
            deleted: false,
        });
    });

    it('badPath_aRoleWhosePermissionsChangedIsPatchedOnly', async () => {
        const world = provisionWorld();
        world.fakes.scenario('iam.roleDeleted');
        const role = must(world.fakes.state.iam.projects.get('demo-hcm')?.roles.get('hcmVertexDrafts'));
        role.deleted = false;

        const report = await applyProvision(planProvision(null, [...IAM_PREFIX]), world.deps);

        expect(only(report.items, 'iam')).toEqual([{ id: 'iam', state: 'ok' }]);
        expect(world.fakes.callsTo('iam.roles.undelete')).toEqual([]);
        expect(world.fakes.callsTo('iam.roles.patch')).toHaveLength(1);
        expect(role.includedPermissions).toEqual(['aiplatform.endpoints.predict']);
    });

    it('happyPath_aRoleThatIsRightIsLeftAsItIs', async () => {
        const world = provisionWorld();
        await applyProvision(planProvision(null, [...IAM_PREFIX]), world.deps);
        const before = world.fakes.calls.length;

        const report = await applyProvision(planProvision(null, ['iam']), world.deps);

        expect(report.items).toEqual([{ id: 'iam', state: 'ok' }]);
        expect(world.fakes.calls.slice(before).map((call) => call.operation)).not.toContain('iam.roles.create');
        expect(world.fakes.calls.slice(before).filter((call) => /iam\.roles\.(patch|undelete)/.test(call.operation))).toEqual([]);
    });
});

describe('edges of the project', () => {
    it('badPath_aBrowserKeyThatIsNotTheWebConfigurationsIsNotFound', async () => {
        const world = provisionWorld();
        const deps = { ...world.deps, web: { ...world.deps.web, apiKey: 'not-the-key' } };

        const report = await applyProvision(planProvision(null, ['api-key']), deps);

        expect(report.items).toEqual([{ id: 'api-key', state: 'invalid', detail: 'apiError.notFound' }]);
        expect(writes(world.fakes)).toEqual([]);
    });

    it('badPath_withoutTheOwnersAddressTheCrashAlertsWait', async () => {
        const world = provisionWorld({ ownerEmail: null });

        const report = await applyProvision(planProvision(null, ['crash-alerts']), world.deps);

        expect(report.items).toEqual([{ id: 'crash-alerts', state: 'pending' }]);
        expect(world.fakes.calls).toEqual([]);
    });

    it('happyPath_aCrashPolicyWithoutTheOwnersChannelGetsIt', async () => {
        const world = provisionWorld();
        await applyProvision(planProvision(null, ['crash-alerts']), world.deps);
        world.fakes.state.monitoring.channels.clear();

        const report = await applyProvision(planProvision(null, ['crash-alerts']), world.deps);

        expect(report.items).toEqual([{ id: 'crash-alerts', state: 'ok', params: { enabled: 'true' } }]);
        expect(world.fakes.callsTo('monitoring.alertPolicies.patch')).toHaveLength(1);
        expect(world.fakes.callsTo('monitoring.alertPolicies.create')).toHaveLength(1);
    });

    it('badPath_withoutABudgetTheBudgetAlertsWaitForBilling', async () => {
        const world = provisionWorld();

        const report = await applyProvision(planProvision(null, ['apis', 'budget-alerts']), world.deps);
        const again = await doctorProvision(world.deps, ['budget-alerts']);

        expect(only(report.items, 'budget-alerts')).toEqual([{ id: 'budget-alerts', state: 'pending', params: { item: 'billing' } }]);
        expect(again.items).toEqual([{ id: 'budget-alerts', state: 'pending', params: { item: 'billing' } }]);
        expect(world.fakes.state.pubsub.topics.has('demo-hcm/budget')).toBe(true);
    });

    it('happyPath_anExistingAppCheckKeyWithOtherDomainsIsCorrected', async () => {
        const world = provisionWorld();
        await world.clients.appCheck.createKey('demo-hcm', 'historic-city-map admin', ['old.example']);

        const report = await applyProvision(planProvision(null, ['app-check']), world.deps);

        expect(report.items).toEqual([expect.objectContaining({ id: 'app-check', state: 'ok' })]);
        expect(world.fakes.callsTo('recaptcha-enterprise.keys.patch')).toHaveLength(1);
        expect(world.fakes.callsTo('recaptcha-enterprise.keys.create')).toHaveLength(1);
    });
});

describe('the less travelled paths', () => {
    it('badPath_anUnreachableFunctionsListOrSchedulerJobsOfAnotherNameLeaveTheSchedulerUnavailableOrWaiting', async () => {
        const world = provisionWorld();
        world.fakes.fail('cloud-functions', 'unavailable');
        const down = await doctorProvision(world.deps, ['scheduler']);
        world.fakes.fail('cloud-functions', null);
        world.fakes.scenario('cloud-functions.deployed');
        const jobs = (list: readonly { readonly name: string; readonly uri?: string }[]): typeof world.deps => ({
            ...world.deps,
            clients: { ...world.clients, queues: { ...world.clients.queues, listSchedulerJobs: () => Promise.resolve([...list]) } },
        });

        const byUri = await doctorProvision(
            jobs([{ name: 'projects/p/locations/r/jobs/renamed', uri: 'https://ops-tick-abc.a.run.app/' }]),
            ['scheduler'],
        );
        const other = await doctorProvision(jobs([{ name: 'projects/p/locations/r/jobs/other' }]), ['scheduler']);

        expect(down.items).toEqual([{ id: 'scheduler', state: 'unavailable', detail: 'apiError.unavailable' }]);
        expect(byUri.items).toEqual([{ id: 'scheduler', state: 'ok' }]);
        expect(other.items).toEqual([{ id: 'scheduler', state: 'invalid', detail: 'apiError.notFound' }]);
    });

    it('happyPath_onlyWhatTheBudgetTopicLacksIsAdded', async () => {
        const world = provisionWorld();
        await world.createBudget();
        await world.clients.pubsub.createTopic('demo-hcm', 'budget');

        const report = await applyProvision(planProvision(null, ['budget-alerts']), world.deps);

        expect(report.items).toEqual([{ id: 'budget-alerts', state: 'ok' }]);
        expect(world.fakes.callsTo('pubsub.topics.create')).toHaveLength(1);
        expect(world.fakes.callsTo('pubsub.topics.setIamPolicy')).toHaveLength(1);
    });

    it('happyPath_aBudgetThatLostItsTopicIsPointedBackAlone', async () => {
        const world = provisionWorld();
        await world.createBudget();
        await applyProvision(planProvision(null, ['budget-alerts']), world.deps);
        const budgets = world.fakes.state.billing.budgets.get('0E2E00-0E2E00-0E2E01') ?? [];
        budgets.splice(0, 1, { ...budgets[0], notificationsRule: {} });

        const report = await applyProvision(planProvision(null, ['budget-alerts']), world.deps);

        expect(report.items).toEqual([{ id: 'budget-alerts', state: 'ok' }]);
        expect(world.fakes.callsTo('pubsub.topics.setIamPolicy')).toHaveLength(1);
        expect(world.fakes.callsTo('billing-budgets.patch')).toHaveLength(2);
    });

    it('happyPath_onlyTheKeysDomainsAreCorrectedWhenTheConfigurationIsRight', async () => {
        const world = provisionWorld();
        await applyProvision(planProvision(null, ['app-check']), world.deps);
        const key = (await world.clients.appCheck.listKeys('demo-hcm'))[0];
        await world.clients.appCheck.setKeyDomains(must(key), ['old.example']);

        const report = await applyProvision(planProvision(null, ['app-check']), world.deps);

        expect(report.items).toEqual([expect.objectContaining({ id: 'app-check', state: 'ok' })]);
        expect(world.fakes.callsTo('app-check.recaptchaEnterpriseConfig.patch')).toHaveLength(1);
    });

    it('happyPath_aCrashPolicyThatLostTheOwnersChannelGetsItBack', async () => {
        const world = provisionWorld();
        await applyProvision(planProvision(null, ['crash-alerts']), world.deps);
        const policy = (await world.clients.monitoring.listAlertPolicies('demo-hcm'))[0];
        await world.clients.monitoring.patchAlertPolicy(String(policy?.name), { notificationChannels: [] }, ['notificationChannels']);

        const report = await applyProvision(planProvision(null, ['crash-alerts']), world.deps);

        expect(report.items).toEqual([{ id: 'crash-alerts', state: 'ok', params: { enabled: 'true' } }]);
        expect(world.fakes.callsTo('monitoring.notificationChannels.create')).toHaveLength(1);
    });

    it('badPath_anUnreadablePolicyMakesTheIamItemUnavailable', async () => {
        const world = provisionWorld();
        await applyProvision(planProvision(null, ['apis', 'secrets']), world.deps);
        world.fakes.fail('secret-manager', 'unavailable');

        const report = await doctorProvision(world.deps, ['iam']);

        expect(report.items).toEqual([{ id: 'iam', state: 'unavailable', detail: 'apiError.unavailable' }]);
    });

    it('happyPath_aDeletedProviderWithAnOldConditionIsUndeletedAndPatched', async () => {
        const world = provisionWorld();
        await applyProvision(planProvision(null, ['apis', 'service-accounts', 'workload-identity']), world.deps);
        world.fakes.state.iam.projects.get('demo-hcm')?.deleted.add('github/site-master');
        const moved = { ...PROJECT, github: { ...GITHUB, branch: 'main' } };

        const report = await applyProvision(planProvision(null, ['workload-identity']), { ...world.deps, project: moved });

        expect(report.items).toEqual([expect.objectContaining({ id: 'workload-identity', state: 'ok' })]);
        expect(world.fakes.callsTo('iam.workloadIdentityPools.providers.undelete')).toHaveLength(1);
        expect(world.fakes.callsTo('iam.workloadIdentityPools.providers.patch')).toHaveLength(1);
    });

    it('badPath_anUnreachableBucketApiAndAPublicReadAPolicyRefusesUnannounced', async () => {
        const down = provisionWorld();
        down.fakes.fail('cloud-storage', 'unavailable');
        const refusing = provisionWorld();
        refusing.fakes.scenario('cloud-storage.publicAccessPrevented');

        const unreachable = await doctorProvision(down.deps, ['buckets']);
        const refused = await applyProvision(planProvision(null, ['apis', 'org-policies', 'buckets']), refusing.deps);

        expect(unreachable.items).toEqual([{ id: 'buckets', state: 'unavailable', detail: 'apiError.unavailable' }]);
        expect(only(refused.items, 'buckets')).toEqual([
            {
                id: 'buckets',
                state: 'invalid',
                detail: 'adminSetup.provision.orgPolicy',
                params: { constraint: 'storage.publicAccessPrevention' },
            },
        ]);
    });
});

describe('the private bucket lifecycle', () => {
    it('happyPath_thePrivateBucketsLifecycleIsTheRasterPipelinesFivePrefixesAndTheExports', async () => {
        // PRIVATE_BUCKET_LIFECYCLE of @hcm/shared (docs/research/M3-interfaces.md §2.7, CR-M3-6; M5's exports, CR-M5-8).
        const world = provisionWorld();
        await applyProvision(planProvision(null, ['apis', 'org-policies', 'buckets', 'bucket-lifecycle']), world.deps);
        const lifecycle = world.fakes.state.cloudStorage.buckets.get('demo-hcm.firebasestorage.app')?.settings['lifecycle'] as {
            rule: { condition: { age: number; matchesPrefix: string[] } }[];
        };

        expect(lifecycle.rule.map((rule) => [rule.condition.matchesPrefix[0], rule.condition.age])).toEqual([
            ['tmp/', 1],
            ['uploads/', 7],
            ['work/', 14],
            ['usgs-raw/', 7],
            ['reference/', 90],
            ['exports/', 7],
        ]);
        expect((await doctorProvision(world.deps, ['bucket-lifecycle'])).items).toEqual([{ id: 'bucket-lifecycle', state: 'ok' }]);
    });

    it('badPath_aLifecycleWithoutTheSoftDeleteSettingIsMissing', async () => {
        const world = provisionWorld();
        await applyProvision(planProvision(null, ['apis', 'org-policies', 'buckets', 'bucket-lifecycle']), world.deps);
        delete world.fakes.state.cloudStorage.buckets.get('demo-hcm.firebasestorage.app')?.settings['softDeletePolicy'];

        const report = await doctorProvision(world.deps, ['bucket-lifecycle']);

        expect(report.items).toEqual([{ id: 'bucket-lifecycle', state: 'missing' }]);
    });

    it('badPath_somethingThrownThatIsNotAnErrorIsStillAnInternalFailure', async () => {
        const world = provisionWorld();
        const queues = { ...world.clients.queues, queueExists: () => Promise.reject(Object.create(null) as Error) };

        const report = await doctorProvision({ ...world.deps, clients: { ...world.clients, queues } }, ['task-queues']);

        expect(report.items).toEqual([{ id: 'task-queues', state: 'invalid', detail: 'apiError.internal' }]);
        expect(world.sink.records.at(-1)?.data).toEqual({ item: 'task-queues', error: 'unknown' });
    });
});
