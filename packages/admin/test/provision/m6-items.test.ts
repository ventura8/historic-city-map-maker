import { GOOGLE_TOKENS } from '@hcm/test-support/fakes';
import { describe, expect, it } from 'vitest';

import { createGoogleClients } from '../../src/google/clients.js';
import { createApiWaits, withApiPropagation, API_PROPAGATION_RETRY_MS } from '../../src/google/transport.js';
import type { ProvisionContext } from '../../src/provision/item.js';
import { STORAGE_ITEMS } from '../../src/provision/items-storage.js';
import { applyProvision, doctorProvision, planProvision, type ProvisionItemResult } from '../../src/provision/provisioner.js';
import { provisionWorld, writes, type ProvisionWorld } from './world.js';

/**
 * What Prepare the project adds in M6 (`docs/research/M6-interfaces.md` §1.2, §1.5, §1.6; findings 4, 12 and 17 of
 * `docs/research/manual-test-2026-10-25.md`): the pipeline's repository (the 16th item), the installer's account and
 * roles, `roles/run.invoker` for the function accounts, the Eventarc and Pub/Sub service identities before the role
 * table, and the wait for an API Google is still switching on.
 */

function only(items: readonly ProvisionItemResult[], ...ids: readonly string[]): ProvisionItemResult[] {
    return items.filter((item) => ids.includes(item.id));
}

/** The world's deps with clients that wait out propagation, and every line the run reported. */
function propagating(world: ProvisionWorld, slept: number[]) {
    const waits = createApiWaits();
    const clients = createGoogleClients(
        withApiPropagation(
            {
                fetch: world.fakes.fetch,
                token: () => GOOGLE_TOKENS.owner,
                sleep: (ms) => {
                    slept.push(ms);
                    return Promise.resolve();
                },
                log: world.log,
            },
            world.deps.project.projectNumber,
            waits,
        ),
    );
    return { ...world.deps, clients, waits };
}

const PREFIX = ['apis', 'service-accounts'] as const;

describe('the pipeline repository (the artifact-registry item)', () => {
    it('happyPath_theDockerRepositoryHcmIsCreatedOnceWithItsCleanupPolicy', async () => {
        const world = provisionWorld();

        const doctor = await doctorProvision(world.deps, ['artifact-registry']);
        const report = await applyProvision(planProvision(null, [...PREFIX, 'artifact-registry']), world.deps);
        const again = await applyProvision(planProvision(null, ['artifact-registry']), world.deps);

        expect(doctor.items).toEqual([{ id: 'artifact-registry', state: 'missing' }]);
        expect(only(report.items, 'artifact-registry')).toEqual([{ id: 'artifact-registry', state: 'ok' }]);
        expect(again.items).toEqual([{ id: 'artifact-registry', state: 'ok' }]);
        expect(world.fakes.callsTo('artifact-registry.repositories.create')).toHaveLength(1);
        const repository = world.fakes.state.artifactRegistry.repositories.get('demo-hcm/us-central1/hcm');
        expect(repository).toMatchObject({
            name: 'projects/demo-hcm/locations/us-central1/repositories/hcm',
            format: 'DOCKER',
            cleanupPolicies: { 'keep-two-newest': { action: 'KEEP', mostRecentVersions: { keepCount: 2 } } },
        });
    });

    it('badPath_anOutageLeavesTheRepositoryUnavailableAndThePermissionsTheServerNeedsDone @S-A55-HAPPY-PIPELINE-ITEM-FAILED', async () => {
        // Finding 31 of 2026-10-31: only the optional imagery pipeline needs the repository, so the iam item no longer waits.
        const world = provisionWorld();
        await world.createBudget();
        world.fakes.fail('artifact-registry', 'unavailable');

        const report = await applyProvision(planProvision(null), world.deps);

        expect(only(report.items, 'artifact-registry', 'iam')).toEqual([
            { id: 'iam', state: 'ok' },
            { id: 'artifact-registry', state: 'unavailable', detail: 'apiError.unavailable' },
        ]);
    });

    it('happyPath_aRepositoryWithoutTheInstallersWriterRoleLacksThatOnlyAndTheItemBindsIt', async () => {
        // Finding 31: the writer role on `hcm` is the artifact-registry item's own, bound right after the repository is made.
        const world = provisionWorld();
        await applyProvision(planProvision(null, PREFIX), world.deps);
        world.fakes.scenario('artifact-registry.provisioned');

        const doctor = await doctorProvision(world.deps, ['artifact-registry']);
        const report = await applyProvision(planProvision(doctor.items, ['artifact-registry']), world.deps);

        expect(doctor.items).toEqual([{ id: 'artifact-registry', state: 'missing' }]);
        expect(report.items).toEqual([{ id: 'artifact-registry', state: 'ok' }]);
        expect(world.fakes.callsTo('artifact-registry.repositories.create')).toEqual([]);
        expect(JSON.stringify(world.fakes.state.artifactRegistry.policies.snapshot())).toContain(
            '"role":"roles/artifactregistry.writer","members":["serviceAccount:hcm-installer@demo-hcm.iam.gserviceaccount.com"]',
        );
    });
});

describe('the pipeline image for everyone (M7, docs/research/M7-local-worker.md §1.1)', () => {
    const PULL = '"role":"roles/artifactregistry.reader","members":["allUsers"]';

    it('happyPath_anyoneMayPullThePipelinesImageFromHcm', async () => {
        const world = provisionWorld();
        await applyProvision(planProvision(null, [...PREFIX, 'artifact-registry']), world.deps);

        expect(JSON.stringify(world.fakes.state.artifactRegistry.policies.snapshot())).toContain(PULL);
        // A repository made before M7 lacks only the public pull, which the next run adds.
        const again = await doctorProvision(world.deps, ['artifact-registry']);
        expect(again.items).toEqual([{ id: 'artifact-registry', state: 'ok' }]);
    });

    it('badPath_anOrganisationThatRefusesAllUsersKeepsTheImagePrivateAndProvisionGoesOn', async () => {
        const world = provisionWorld();
        world.fakes.scenario('resource-manager.domainRestricted');
        const report = await applyProvision(planProvision(null, [...PREFIX, 'artifact-registry']), world.deps);

        const item = {
            id: 'artifact-registry',
            state: 'ok',
            detail: 'adminSetup.provision.orgPolicy',
            params: { constraint: 'iam.allowedPolicyMemberDomains' },
        };
        expect(only(report.items, 'artifact-registry')).toEqual([item]);
        expect(JSON.stringify(world.fakes.state.artifactRegistry.policies.snapshot())).not.toContain('allUsers');
        expect(JSON.stringify(world.fakes.state.artifactRegistry.policies.snapshot())).toContain('roles/artifactregistry.writer');
    });

    it('badPath_aRefusalTheFindingsDidNotForeseeIsRecordedAndTheItemIsStillOk', async () => {
        const world = provisionWorld();
        world.fakes.scenario('artifact-registry.publicPullRefused');

        const report = await applyProvision(planProvision(null, [...PREFIX, 'artifact-registry']), world.deps);

        expect(only(report.items, 'artifact-registry')).toEqual([
            {
                id: 'artifact-registry',
                state: 'ok',
                detail: 'adminSetup.provision.orgPolicy',
                params: { constraint: 'iam.allowedPolicyMemberDomains' },
            },
        ]);
        expect(JSON.stringify(world.fakes.state.artifactRegistry.policies.snapshot())).toContain('roles/artifactregistry.writer');
    });

    it('badPath_anyOtherFailureOfThePublicPullFailsTheFixAndUnreadableFindingsRestrictNothing', async () => {
        // The repository and its writer are there; Google fails the public pull's write for another reason than a policy.
        const writer = {
            role: 'roles/artifactregistry.writer',
            members: ['serviceAccount:hcm-installer@demo-hcm.iam.gserviceaccount.com'],
        };
        const policy = {
            read: () => Promise.resolve({ version: 1, bindings: [writer] }),
            write: () => Promise.reject(new Error('outage')),
        };
        const world = provisionWorld();
        const context = {
            project: world.deps.project,
            clients: { artifactRegistry: { get: () => Promise.resolve({ name: 'hcm' }), repositoryPolicy: () => policy } },
            findings: () => Promise.reject(new Error('organisation unreadable')),
        } as unknown as ProvisionContext;
        const item = STORAGE_ITEMS.find((spec) => spec.id === 'artifact-registry');

        const observation = await item?.observe(context);

        expect(observation).toMatchObject({ state: 'missing', lacks: ['binding'] });
        await expect(observation?.fix?.()).rejects.toThrow('outage');
    });
});

describe('the installer, the invokers and the service agents (the iam item)', () => {
    it('happyPath_aFreshProjectGetsTheInstallerTheInvokersAndTheAgentsBeforeTheTable @S-A04-HAPPY-INSTALLER-ACCOUNT', async () => {
        const world = provisionWorld();
        await world.createBudget();

        const report = await applyProvision(planProvision(null), world.deps);
        const firstWrites = writes(world.fakes).length;
        const again = await applyProvision(planProvision(null), world.deps);

        expect(report.items.filter((item) => item.state !== 'ok').map((item) => item.id)).toEqual(['scheduler']);
        expect(report.items).toHaveLength(17);
        expect(world.fakes.state.iam.projects.get('demo-hcm')?.accounts.has('hcm-installer')).toBe(true);
        expect(world.fakes.state.iam.projects.get('demo-hcm')?.roles.get('hcmInstaller')?.includedPermissions).toEqual([
            'cloudfunctions.functions.setIamPolicy',
            'datastore.databases.getMetadata',
            'storage.buckets.get',
            'run.services.get',
            'run.services.getIamPolicy',
            'run.services.setIamPolicy',
            'run.jobs.create',
            'run.jobs.get',
            'run.jobs.update',
            'run.operations.get',
            'resourcemanager.projects.getIamPolicy',
            'artifactregistry.repositories.get',
            'artifactregistry.repositories.update',
        ]);
        const project = JSON.stringify(world.fakes.snapshot()['resource-manager']);
        // The compute default account invokes and receives a first deploy's events (firebase-tools' ensureServiceAgentRoles).
        expect(project).toContain(
            '"role":"roles/run.invoker","members":["serviceAccount:fn-admin@demo-hcm.iam.gserviceaccount.com","serviceAccount:fn-events@demo-hcm.iam.gserviceaccount.com","serviceAccount:123456789012-compute@developer.gserviceaccount.com"]',
        );
        expect(project).toContain('projects/demo-hcm/roles/hcmInstaller');
        expect(project).toContain('service-123456789012@gcp-sa-pubsub.iam.gserviceaccount.com');
        expect(JSON.stringify(world.fakes.state.artifactRegistry.policies.snapshot())).toContain(
            '"role":"roles/artifactregistry.writer","members":["serviceAccount:hcm-installer@demo-hcm.iam.gserviceaccount.com"]',
        );
        // The service identities first: Eventarc's and Pub/Sub's agents exist before any binding names them (finding 12).
        const operations = world.fakes.calls.map((call) => `${call.operation} ${call.url}`);
        const identity = (service: string): number => operations.findIndex((call) => call.includes(`${service}:generateServiceIdentity`));
        const firstPolicyWrite = operations.findIndex((call) => call.startsWith('resource-manager.setIamPolicy'));
        expect(identity('eventarc.googleapis.com')).toBeGreaterThan(-1);
        expect(identity('pubsub.googleapis.com')).toBeGreaterThan(-1);
        expect(identity('eventarc.googleapis.com')).toBeLessThan(firstPolicyWrite);
        expect(identity('pubsub.googleapis.com')).toBeLessThan(firstPolicyWrite);
        // A second run writes nothing.
        expect(again.items.filter((item) => item.state !== 'ok').map((item) => item.id)).toEqual(['scheduler']);
        expect(writes(world.fakes)).toHaveLength(firstWrites);
    });

    it('badPath_aRefusedEventarcIdentityNamesItsRoleAndTheOtherItemsAreProvisioned @S-A04-BAD-IDENTITY-REFUSED', async () => {
        const world = provisionWorld();
        await world.createBudget();
        world.fakes.scenario('service-usage.identityRefused');

        const report = await applyProvision(planProvision(null), world.deps);

        expect(only(report.items, 'iam')).toEqual([
            { id: 'iam', state: 'invalid', detail: 'apiError.cloud.permission', params: { role: 'roles/serviceusage.serviceUsageAdmin' } },
        ]);
        const fine = ['apis', 'service-accounts', 'buckets', 'artifact-registry', 'secrets', 'app-check', 'api-key'];
        expect(only(report.items, ...fine).map((item) => [item.id, item.state])).toEqual(
            report.items.filter((item) => fine.includes(item.id)).map((item) => [item.id, 'ok']),
        );
        expect(world.fakes.callsTo('resource-manager.setIamPolicy')).toEqual([]);
    });

    it('happyPath_theComputeDefaultAccountIsBoundOnlyWhenTheProjectHasOne', async () => {
        const world = provisionWorld();
        world.fakes.scenario('iam.noComputeAccount');
        await applyProvision(
            planProvision(null, ['apis', 'service-accounts', 'buckets', 'artifact-registry', 'secrets', 'org-policies', 'iam']),
            world.deps,
        );
        const compute = 'serviceAccount:123456789012-compute@developer.gserviceaccount.com';
        const computeRoles = (): string[] =>
            (world.fakes.state.resourceManager.policies.get('demo-hcm')?.bindings ?? [])
                .filter((binding) => binding.members.includes(compute))
                .map((binding) => binding.role);
        // The fake project's compute account keeps only its Editor role while the project has no such account to bind.
        expect(computeRoles()).toEqual(['roles/editor']);

        world.fakes.state.iam.projects
            .get('demo-hcm')
            ?.googleAccounts.set('123456789012-compute@developer.gserviceaccount.com', 'Compute Engine default service account');
        const doctor = await doctorProvision(world.deps, ['iam']);
        const report = await applyProvision(planProvision(null, ['iam']), world.deps);

        expect(doctor.items).toEqual([{ id: 'iam', state: 'missing' }]);
        expect(report.items).toEqual([{ id: 'iam', state: 'ok' }]);
        // Finding 33 (§75g): its builder role replaces Editor once it is the functions' build account.
        expect(computeRoles()).toEqual(
            expect.arrayContaining(['roles/run.invoker', 'roles/eventarc.eventReceiver', 'roles/cloudbuild.builds.builder']),
        );
        expect(computeRoles()).toHaveLength(3);
    });
});

/** Finding 28 of `docs/research/manual-test-2026-10-25.md (live test 2026-10-31)`: firebase-tools' actAs check on the App Engine default account. */
describe('the installer acts as the App Engine default account (the iam item)', () => {
    const APP_ENGINE = 'demo-hcm@appspot.gserviceaccount.com';
    const INSTALLER = 'serviceAccount:hcm-installer@demo-hcm.iam.gserviceaccount.com';
    const BEFORE_IAM = ['apis', 'service-accounts', 'buckets', 'artifact-registry', 'secrets', 'org-policies', 'iam'] as const;

    function appEngineUsers(world: ProvisionWorld): readonly string[] {
        const policy = world.fakes.state.iam.projects.get('demo-hcm')?.accountPolicies.get(APP_ENGINE) ?? [];
        return policy.find((binding) => binding.role === 'roles/iam.serviceAccountUser')?.members ?? [];
    }

    it('happyPath_provisionGrantsServiceAccountUserOnThatOneAccountNeverProjectWide @S-A04-HAPPY-APPENGINE-ACTAS', async () => {
        const world = provisionWorld();

        const report = await applyProvision(planProvision(null, BEFORE_IAM), world.deps);

        expect(only(report.items, 'iam')).toEqual([{ id: 'iam', state: 'ok' }]);
        expect(appEngineUsers(world)).toEqual([INSTALLER]);
        const project = world.fakes.state.resourceManager.policies.get('demo-hcm')?.bindings ?? [];
        expect(project.filter((binding) => binding.role === 'roles/iam.serviceAccountUser')).toEqual([]);
    });

    it('badPath_aProjectWithoutTheAccountHasNothingToGrantAndIsNotAFailure @S-A04-BAD-NO-APPENGINE-ACCOUNT', async () => {
        const world = provisionWorld();
        world.fakes.scenario('iam.noAppEngineAccount');

        const report = await applyProvision(planProvision(null, BEFORE_IAM), world.deps);
        const doctor = await doctorProvision(world.deps, ['iam']);

        expect(only(report.items, 'iam')).toEqual([{ id: 'iam', state: 'ok' }]);
        expect(doctor.items).toEqual([{ id: 'iam', state: 'ok' }]);
        expect(world.fakes.calls.filter((call) => call.url.includes(`${APP_ENGINE}:`))).toEqual([]);
    });

    it('badPath_aProjectProvisionedBeforeTheFixLacksTheGrantAndARunOfTheIamItemAddsIt @S-A55-BAD-NO-ACTAS', async () => {
        const world = provisionWorld();
        await applyProvision(planProvision(null, BEFORE_IAM), world.deps);
        world.fakes.scenario('iam.appEngineActAsMissing');

        const doctor = await doctorProvision(world.deps, ['iam']);
        const report = await applyProvision(planProvision(null, ['iam']), world.deps);

        expect(doctor.items).toEqual([{ id: 'iam', state: 'missing' }]);
        expect(report.items).toEqual([{ id: 'iam', state: 'ok' }]);
        expect(appEngineUsers(world)).toEqual([INSTALLER]);
    });
});

describe('an API Google is still switching on (finding 4)', () => {
    it('happyPath_theItemWaitsForGoogleOnTheClockAndSettlesWithNoClick @S-A04-HAPPY-API-PROPAGATION', async () => {
        const world = provisionWorld();
        world.fakes.scenario('service-usage.propagation');
        const slept: number[] = [];
        const heard: ProvisionItemResult[] = [];

        const report = await applyProvision(planProvision(null, [...PREFIX]), propagating(world, slept), (item) => heard.push(item));

        expect(report.items).toEqual([
            { id: 'apis', state: 'ok' },
            { id: 'service-accounts', state: 'ok' },
        ]);
        expect(slept).toEqual(API_PROPAGATION_RETRY_MS.slice(0, 3));
        const waiting = {
            id: 'service-accounts',
            state: 'pending',
            detail: 'adminSetup.provision.apiWaiting',
            params: { api: 'iam.googleapis.com' },
        };
        expect(heard).toEqual([{ id: 'apis', state: 'ok' }, waiting, waiting, waiting, { id: 'service-accounts', state: 'ok' }]);
        expect(world.fakes.state.iam.projects.get('demo-hcm')?.accounts.has('fn-admin')).toBe(true);
        // Service Usage was asked once whether the API is on at all.
        expect(world.fakes.callsTo('service-usage.get')).toHaveLength(1);
    });

    it('badPath_anApiStillOffAfterAboutThreeMinutesIsMissingWithItsNameAndARetryFinishes @S-A04-BAD-API-STILL-DISABLED', async () => {
        const world = provisionWorld();
        world.fakes.scenario('service-usage.propagationSlow');
        const slept: number[] = [];
        const deps = propagating(world, slept);

        const report = await applyProvision(planProvision(null, [...PREFIX, 'iam', 'workload-identity']), deps);
        const waited = [...slept];
        const retried = await applyProvision(planProvision(report.items), deps);

        expect(waited).toEqual(API_PROPAGATION_RETRY_MS);
        expect(waited.reduce((total, ms) => total + ms, 0)).toBe(190_000);
        expect(only(report.items, 'service-accounts', 'iam', 'workload-identity')).toEqual([
            { id: 'service-accounts', state: 'missing', detail: 'apiError.cloud.apiPropagation', params: { api: 'iam.googleapis.com' } },
            { id: 'iam', state: 'pending', params: { item: 'service-accounts' } },
            { id: 'workload-identity', state: 'pending', params: { item: 'service-accounts' } },
        ]);
        expect(only(retried.items, 'service-accounts', 'workload-identity')).toEqual([
            { id: 'service-accounts', state: 'ok' },
            expect.objectContaining({ id: 'workload-identity', state: 'ok' }),
        ]);
    });

    it('badPath_anApiServiceUsageReportsOffIsNotWaitedFor', async () => {
        // Nobody enabled IAM (the apis item did not run): its SERVICE_DISABLED is the truth, not a propagation.
        const world = provisionWorld();
        world.fakes.fail('iam', 'apiDisabled');
        const slept: number[] = [];

        const report = await applyProvision(planProvision(null, ['service-accounts']), propagating(world, slept));

        expect(slept).toEqual([]);
        expect(only(report.items, 'service-accounts')).toEqual([
            { id: 'service-accounts', state: 'missing', detail: 'apiError.cloud.apiDisabled', params: { api: 'iam.googleapis.com' } },
        ]);
    });

    it('badPath_withoutTheWaitsTheTransportFailsAtOnceAsBefore', async () => {
        const world = provisionWorld();
        world.fakes.scenario('service-usage.propagation');

        const report = await applyProvision(planProvision(null, [...PREFIX]), world.deps);

        expect(only(report.items, 'service-accounts')).toEqual([
            { id: 'service-accounts', state: 'missing', detail: 'apiError.cloud.apiDisabled', params: { api: 'iam.googleapis.com' } },
        ]);
    });
});
