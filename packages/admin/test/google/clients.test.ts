import { createLogger } from '@hcm/shared';
import { fixtureResponse } from '@hcm/test-support/api-fixtures';
import { createFakeFetch, jsonResponse, route, routeTable, type Route } from '@hcm/test-support/fakes';
import { describe, expect, it } from 'vitest';

import { budgetDisplayName, budgetSpec } from '../../src/google/billing.js';
import { createGoogleClients, type GoogleClients } from '../../src/google/clients.js';
import { deploymentStatus, expectedFunctions } from '../../src/google/functions.js';
import { BATCH_ENABLE_LIMIT } from '../../src/google/service-usage.js';
import { BILLING_ACCOUNT, must, PROJECT, provisionWorld } from '../provision/world.js';

/**
 * The typed clients' own behaviour against the fake upstreams (M2b §3.3, §3.4): what the provisioner tests do not
 * reach (each answer shape, each idempotent create, each optional field).
 */

const TARGET = { projectId: PROJECT.projectId, projectNumber: PROJECT.projectNumber, currencyCode: 'USD', units: 5 };

/** Clients over a small route table (answers the fakes never give). */
function clientsOver(routes: readonly Route[]): GoogleClients {
    return createGoogleClients({
        fetch: createFakeFetch(routeTable(routes)).fetch,
        token: () => 'e2e-token',
        sleep: () => Promise.resolve(),
        log: createLogger('test', { sink: () => undefined }),
    });
}

describe('Resource Manager and Org Policy', () => {
    it('happyPath_theProjectItsParentAndTheOwnersPermission', async () => {
        const { clients, fakes } = provisionWorld();

        const alone = await clients.resourceManager.getProject('demo-hcm');
        fakes.scenario('resource-manager.inOrganization');
        const inside = await clients.resourceManager.getProject('demo-hcm');
        const granted = await clients.resourceManager.testPermissions('demo-hcm', ['resourcemanager.projects.setIamPolicy']);

        expect(alone).toEqual({ projectId: 'demo-hcm', name: 'projects/123456789012' });
        expect(inside.parent).toBe('organizations/100000000001');
        expect(granted).toEqual(['resourcemanager.projects.setIamPolicy']);
        await expect(clients.resourceManager.constraintEnforced('demo-hcm', 'iam.allowedPolicyMemberDomains')).resolves.toBe(false);
    });

    it('badPath_anAnswerWithoutFieldsOrPermissions', async () => {
        const clients = clientsOver([
            route('GET', 'https://cloudresourcemanager.googleapis.com/v3/projects/p', 'rm.get', () => jsonResponse({ parent: '' })),
            route('POST', 'https://cloudresourcemanager.googleapis.com/v3/projects/p:testIamPermissions', 'rm.test', () =>
                jsonResponse({}),
            ),
        ]);

        await expect(clients.resourceManager.getProject('p')).resolves.toEqual({ projectId: 'p', name: '' });
        await expect(clients.resourceManager.testPermissions('p', ['x'])).resolves.toEqual([]);
    });
});

describe('Cloud Billing and Budgets', () => {
    it('happyPath_aBudgetDifferingFromTheSpecIsPatchedAndTheTopicSetOnce', async () => {
        const { clients, fakes } = provisionWorld();
        await clients.billing.ensureBudget(BILLING_ACCOUNT, TARGET);

        const patched = await clients.billing.ensureBudget(BILLING_ACCOUNT, { ...TARGET, units: 25, currencyCode: 'RON' });
        const budget = await clients.billing.findBudget(BILLING_ACCOUNT, PROJECT.projectId);
        const first = await clients.billing.setBudgetTopic(must(budget), 'projects/demo-hcm/topics/budget');
        const reread = await clients.billing.findBudget(BILLING_ACCOUNT, PROJECT.projectId);
        const second = await clients.billing.setBudgetTopic(must(reread), 'projects/demo-hcm/topics/budget');

        expect(patched.written).toBe(true);
        expect(fakes.callsTo('billing-budgets.patch')[0]?.url).toContain('updateMask=amount');
        expect(budget?.body['amount']).toMatchObject({ specifiedAmount: { currencyCode: 'RON', units: '25' } });
        expect([first, second]).toEqual([true, false]);
        expect(reread?.body['notificationsRule']).toEqual({
            disableDefaultIamRecipients: false,
            pubsubTopic: 'projects/demo-hcm/topics/budget',
            schemaVersion: '1.0',
        });
    });

    it('badPath_aBudgetRoleMissingNamesTheCostsManagerRole', async () => {
        const { clients, fakes } = provisionWorld();
        fakes.scenario('billing-budgets.budgetForbidden');

        await expect(clients.billing.ensureBudget(BILLING_ACCOUNT, TARGET)).rejects.toMatchObject({
            kind: 'forbidden',
            role: 'roles/billing.costsManager',
        });
        await expect(clients.billing.findBudget(BILLING_ACCOUNT, 'another-project')).resolves.toBeUndefined();
    });

    it('happyPath_theBudgetSpecOfTheContract', () => {
        expect(budgetDisplayName('demo-hcm')).toBe('historic-city-map demo-hcm');
        expect(budgetSpec(TARGET)).toMatchObject({
            budgetFilter: { projects: ['projects/123456789012'], calendarPeriod: 'MONTH' },
            notificationsRule: { disableDefaultIamRecipients: false },
        });
    });

    it('badPath_sparseAnswersHaveDefaults', async () => {
        const clients = clientsOver([
            route('GET', 'https://cloudbilling.googleapis.com/v1/billingAccounts', 'accounts', () =>
                jsonResponse({ billingAccounts: [{ name: 'billingAccounts/A', open: false }] }),
            ),
            route('GET', 'https://billingbudgets.googleapis.com/v1/billingAccounts/A/budgets', 'budgets', () =>
                jsonResponse({ budgets: [{ name: 'billingAccounts/A/budgets/b' }] }),
            ),
            route('POST', 'https://billingbudgets.googleapis.com/v1/billingAccounts/A/budgets', 'create', () => jsonResponse({})),
        ]);

        await expect(clients.billing.listAccounts()).resolves.toEqual([
            { name: 'billingAccounts/A', open: false, displayName: '', currencyCode: 'USD' },
        ]);
        await expect(clients.billing.listBudgets('billingAccounts/A')).resolves.toEqual([
            { name: 'billingAccounts/A/budgets/b', displayName: '', body: { name: 'billingAccounts/A/budgets/b' } },
        ]);
        await expect(clients.billing.ensureBudget('billingAccounts/A', TARGET)).resolves.toEqual({ name: '', written: true });
    });
});

describe('Service Usage', () => {
    it('happyPath_moreThanTwentyServicesAreEnabledInBatchesAndAnAgentIsNamed', async () => {
        const { clients, fakes } = provisionWorld();
        const many = Array.from({ length: BATCH_ENABLE_LIMIT + 1 }, (_unused, index) => `api${String(index)}.googleapis.com`);

        await clients.serviceUsage.enable('123456789012', many);
        const agent = await clients.serviceUsage.serviceIdentity('123456789012', 'firebasestorage.googleapis.com');

        expect(fakes.callsTo('service-usage.batchEnable')).toHaveLength(2);
        await expect(clients.serviceUsage.isEnabled('demo-hcm', 'api20.googleapis.com')).resolves.toBe(true);
        await expect(clients.serviceUsage.isEnabled('demo-hcm', 'nothing.googleapis.com')).resolves.toBe(false);
        expect(agent).toBe('service-123456789012@gcp-sa-firebasestorage.iam.gserviceaccount.com');
    });

    it('badPath_anAgentWithoutAnAddressAndAServiceWithoutConfig', async () => {
        const clients = clientsOver([
            route('POST', 'https://serviceusage.googleapis.com/v1beta1/projects/1/services/x:generateServiceIdentity', 'id', () =>
                jsonResponse({ name: 'operations/1', done: true, response: {} }),
            ),
            route('GET', 'https://serviceusage.googleapis.com/v1/projects/1/services', 'list', () =>
                jsonResponse({
                    services: [
                        { name: 'projects/1/services/a.googleapis.com', state: 'ENABLED' },
                        { name: 'b', state: 'DISABLED' },
                    ],
                }),
            ),
        ]);

        await expect(clients.serviceUsage.serviceIdentity('1', 'x')).resolves.toBe('');
        await expect(clients.serviceUsage.listEnabled('1')).resolves.toEqual(['a.googleapis.com']);
    });
});

describe('Cloud Storage and Firebase Storage', () => {
    it('happyPath_aBucketIsCreatedOnceAndAnotherProjectsNameIsTaken', async () => {
        const { clients, fakes } = provisionWorld();
        const body = { name: 'demo-hcm-public' };

        const created = await clients.storage.createBucket('demo-hcm', '123456789012', body);
        const again = await clients.storage.createBucket('demo-hcm', '123456789012', body);
        fakes.scenario('cloud-storage.publicBucketTaken');
        const taken = await clients.storage.createBucket('demo-hcm', '123456789012', { name: 'other-public' });
        fakes.state.cloudStorage.buckets.set('other-public', { projectNumber: '999', settings: {}, bindings: [] });
        const takenByOther = await clients.storage.createBucket('demo-hcm', '123456789012', { name: 'other-public' });

        expect([created, again, taken, takenByOther]).toEqual(['created', 'exists', 'created', 'taken']);
        await expect(clients.storage.serviceAgent('demo-hcm')).resolves.toBe(
            'service-123456789012@gs-project-accounts.iam.gserviceaccount.com',
        );
    });

    it('badPath_aBucketWeCannotReadIsTakenAndAnyOtherFailureThrows', async () => {
        const conflict = (): Response => fixtureResponse('cloud-storage/bucket.exists');
        const clients = clientsOver([
            route('POST', 'https://storage.googleapis.com/storage/v1/b', 'insert', conflict),
            route('GET', 'https://storage.googleapis.com/storage/v1/b/forbidden', 'get', () =>
                fixtureResponse('google/error.permission-denied'),
            ),
            route('GET', 'https://storage.googleapis.com/storage/v1/b/down', 'get', () => fixtureResponse('google/error.invalid-argument')),
            route('GET', 'https://storage.googleapis.com/storage/v1/projects/p/serviceAccount', 'agent', () => jsonResponse({})),
        ]);

        await expect(clients.storage.createBucket('p', '1', { name: 'forbidden' })).resolves.toBe('taken');
        await expect(clients.storage.createBucket('p', '1', { name: 'down' })).rejects.toMatchObject({ kind: 'invalid' });
        await expect(clients.storage.serviceAgent('p')).resolves.toBe('');
    });

    it('badPath_theDefaultBucketNeedsBlaze', async () => {
        const { clients } = provisionWorld({ billing: false });

        await expect(clients.storage.hasDefaultBucket('123456789012')).resolves.toBe(false);
        await expect(clients.storage.addDefaultBucket('123456789012', 'us-central1')).rejects.toMatchObject({
            kind: 'invalid',
            status: 400,
        });
    });
});

describe('the deployment', () => {
    it('happyPath_everyRegistryFunctionActiveIsOk', () => {
        const expected = expectedFunctions();
        const active = expected.map((id) => ({ id, state: 'ACTIVE' }));

        // M3's 51, M4's orders (3 callables) and assists and notifications (5 callables, 2 background functions), M5's
        // cities (4 callables, `cities.locate` with the UX review) and static export (2 callables, 1 task queue function),
        // M6's events probe `ops.onProbe` (docs/research/M6-interfaces.md §3.2), M7's local worker (5 callables, which the
        // admin never calls but waits for, by name) and `imagery.runOn` (docs/research/M7-local-worker.md §2.4, §3); finding
        // 67 of 2026-11-02: `worker.pair` (the worker's) and `worker.pairCode`, `worker.revoke` (the admin's); finding 72:
        // `worker.image` (the starter file's supervisor's); finding 73: `worker.starter` (the starter file, HTTPS); `imagery.locateAgain`.
        // M12: `imagery.previewUrl` (a signed hour of a version's private archive). M13: the roles' and review's 7.
        // M16: `imagery.recalibrate`. M17: the stories' `history.onStoryWrite` and `publish.onStoryWrite`. M20: the local
        // archive's `worker.archiveReport`, `imagery.archiveImport` and `imagery.confirmRights`;
        // `imagery.deleteVersion`. The tab icon's `cities.setIcon`. M20 §19.10: the tile wizard's `imagery.saveLayout` and
        // `imagery.acceptLayout`. The owner's not-useful mark `imagery.markScene`. M20 (2026-11-13): `worker.archiveCopy`.
        // Household computers' `worker.manage`; Pause's `imagery.pause` (2026-11-13). M20 §19.13: Fix the tiles' `imagery.relayout`.
        // M31: the Wikipedia overlay's `wikipedia.manage`. Lesson 759: `imagery.makeLive`.
        expect(expected).toHaveLength(107);
        expect(expected).toEqual(
            expect.arrayContaining([
                'worker-hello',
                'worker-claim',
                'worker-step',
                'worker-urls',
                'worker-end',
                'worker-pair',
                'worker-pairCode',
                'worker-image',
                'worker-starter',
                'worker-archiveReport',
                'worker-archiveCopy',
                'worker-manage',
                'imagery-archiveImport',
                'imagery-confirmRights',
                'imagery-deleteVersion',
                'imagery-saveLayout',
                'imagery-acceptLayout',
                'imagery-markScene',
            ]),
        );
        expect(deploymentStatus(active)).toEqual({ state: 'ok', ready: 107, total: 107, failed: [] });
    });

    it('badPath_someMissingIsPendingAndOneFailedIsInvalid', () => {
        expect(deploymentStatus([{ id: 'a', state: 'ACTIVE' }], ['a', 'b'])).toEqual({ state: 'pending', ready: 1, total: 2, failed: [] });
        expect(deploymentStatus([{ id: 'b', state: 'FAILED' }], ['a', 'b'])).toEqual({
            state: 'invalid',
            ready: 0,
            total: 2,
            failed: ['b'],
        });
    });

    it('badPath_aFunctionWithoutAStateIsUnspecified', async () => {
        const clients = clientsOver([
            route('GET', 'https://cloudfunctions.googleapis.com/v2/projects/p/locations/r/functions', 'list', () =>
                jsonResponse({ functions: [{ name: 'projects/p/locations/r/functions/admin-session' }] }),
            ),
        ]);

        await expect(clients.functions.list('p', 'r')).resolves.toEqual([
            { id: 'admin-session', state: 'STATE_UNSPECIFIED', release: null, releaseTime: null },
        ]);
    });

    it('happyPath_aFunctionNamesItsReleaseAndBuildTime_badPath_aTimeThatIsNotOneIsNone', async () => {
        // Finding 39 of 2026-11-01: HCM_RELEASE_TIME orders two builds of one version.
        const env = (time: string) => ({ environmentVariables: { HCM_RELEASE: '1.0.0+abc1234', HCM_RELEASE_TIME: time } });
        const clients = clientsOver([
            route('GET', 'https://cloudfunctions.googleapis.com/v2/projects/p/locations/r/functions', 'list', () =>
                jsonResponse({
                    functions: [
                        { name: 'projects/p/locations/r/functions/a', state: 'ACTIVE', serviceConfig: env('1761955200') },
                        { name: 'projects/p/locations/r/functions/b', state: 'ACTIVE', serviceConfig: env('soon') },
                    ],
                }),
            ),
        ]);

        await expect(clients.functions.list('p', 'r')).resolves.toEqual([
            { id: 'a', state: 'ACTIVE', release: '1.0.0+abc1234', releaseTime: 1_761_955_200 },
            { id: 'b', state: 'ACTIVE', release: '1.0.0+abc1234', releaseTime: null },
        ]);
    });
});

describe('the edges', () => {
    it('badPath_sparseAnswersOfSchedulerAppCheckMonitoringAndAnalytics', async () => {
        const clients = clientsOver([
            route('GET', 'https://cloudscheduler.googleapis.com/v1/projects/p/locations/r/jobs', 'jobs', () =>
                jsonResponse({ jobs: [{ name: 'projects/p/locations/r/jobs/other' }] }),
            ),
            route('GET', 'https://recaptchaenterprise.googleapis.com/v1/projects/p/keys', 'keys', () =>
                jsonResponse({ keys: [{ name: 'projects/1/keys/k' }] }),
            ),
            route('POST', 'https://recaptchaenterprise.googleapis.com/v1/projects/p/keys', 'create', () =>
                jsonResponse({ name: 'projects/1/keys/n' }),
            ),
            route('GET', 'https://firebaseappcheck.googleapis.com/v1/projects/1/apps/a/recaptchaEnterpriseConfig', 'config', () =>
                jsonResponse({}),
            ),
            route('GET', 'https://monitoring.googleapis.com/v3/projects/p/notificationChannels', 'channels', () =>
                jsonResponse({ notificationChannels: [{ name: 'c' }] }),
            ),
            route('POST', 'https://monitoring.googleapis.com/v3/projects/p/notificationChannels', 'channel', () =>
                jsonResponse({ name: 'c2' }),
            ),
            route('GET', 'https://monitoring.googleapis.com/v3/projects/p/alertPolicies', 'policies', () =>
                jsonResponse({ alertPolicies: [{ name: 'a', enabled: false }] }),
            ),
            route('GET', 'https://firebase.googleapis.com/v1beta1/projects/p/analyticsDetails', 'details', () =>
                jsonResponse({ analyticsProperty: { id: 'properties/1' }, streamMappings: [{ app: 'projects/p/webApps/other' }] }),
            ),
        ]);

        await expect(clients.queues.listSchedulerJobs('p', 'r')).resolves.toEqual([{ name: 'projects/p/locations/r/jobs/other' }]);
        await expect(clients.appCheck.listKeys('p')).resolves.toEqual([
            { name: 'projects/1/keys/k', displayName: '', siteKey: 'k', allowedDomains: [] },
        ]);
        await expect(clients.appCheck.createKey('p', 'n', [])).resolves.toMatchObject({ siteKey: 'n' });
        await expect(clients.appCheck.getConfig('1', 'a')).resolves.toEqual({});
        await expect(clients.monitoring.listEmailChannels('p')).resolves.toEqual([{ name: 'c', displayName: '', email: '' }]);
        await expect(clients.monitoring.createEmailChannel('p', 'd', 'e')).resolves.toMatchObject({ name: 'c2' });
        await expect(clients.monitoring.listAlertPolicies('p')).resolves.toMatchObject([
            { name: 'a', displayName: '', enabled: false, channels: [] },
        ]);
        await expect(clients.analytics.findStream('p', 'mine')).resolves.toBeUndefined();
    });

    it('badPath_aKeyWithoutRestrictionsAPoolWithoutStateABucketWithoutProjectAndABudgetWithoutNotifications', async () => {
        const keys = 'https://apikeys.googleapis.com/v2/projects/p/locations/global/keys';
        const clients = clientsOver([
            route('GET', keys, 'keys', () =>
                jsonResponse({ keys: [{ name: 'projects/1/locations/global/keys/a' }, { name: 'projects/1/locations/global/keys/b' }] }),
            ),
            route(
                'GET',
                'https://apikeys.googleapis.com/v2/projects/1/locations/global/keys/{key}/keyString',
                'keyString',
                (_request, params) => jsonResponse({ keyString: `key-${String(params['key'])}` }),
            ),
            route('GET', 'https://iam.googleapis.com/v1/projects/1/locations/global/workloadIdentityPools/github', 'pool', () =>
                jsonResponse({ name: 'projects/1/locations/global/workloadIdentityPools/github' }),
            ),
            route('GET', 'https://storage.googleapis.com/storage/v1/b/bare', 'bucket', () => jsonResponse({ name: 'bare' })),
            route('PATCH', 'https://billingbudgets.googleapis.com/v1/billingAccounts/A/budgets/b', 'patch', () => jsonResponse({})),
        ]);

        await expect(clients.apiKeys.findKey('p', 'key-b')).resolves.toEqual({
            name: 'projects/1/locations/global/keys/b',
            allowedReferrers: [],
            restrictions: {},
        });
        await expect(clients.iam.getPool('1', 'github')).resolves.toMatchObject({ state: 'ACTIVE' });
        await expect(clients.storage.getBucket('bare')).resolves.toEqual({ name: 'bare', projectNumber: '', body: { name: 'bare' } });
        await expect(
            clients.billing.setBudgetTopic({ name: 'billingAccounts/A/budgets/b', displayName: '', body: {} }, 'projects/p/topics/budget'),
        ).resolves.toBe(true);
    });

    it('happyPath_theGa4StreamIsFoundAndReadBack', async () => {
        const { clients, fakes } = provisionWorld();
        fakes.scenario('firebase-management.analyticsLinked');

        const stream = await clients.analytics.findStream('demo-hcm', '1:123456789012:web:0e2e0e2e');

        expect(stream).toEqual({ property: 'properties/400000001', streamId: '500000001', measurementId: 'G-E2E0000000' });
        await expect(clients.analytics.pageChangesEnabled(must(stream))).resolves.toBe(true);
    });

    it('badPath_aProjectWithoutTheWebConfigurationsKeyFindsNone', async () => {
        const { clients } = provisionWorld();

        await expect(clients.apiKeys.findKey('demo-hcm', 'another-key')).resolves.toBeUndefined();
    });

    it('happyPath_theServiceAccountsOfTheProjectAreListedById', async () => {
        const { clients } = provisionWorld();
        await clients.iam.createServiceAccount('demo-hcm', 'fn-admin', 'Functions: admin');
        await clients.iam.createServiceAccount('demo-hcm', 'fn-admin', 'Functions: admin');

        // Google's own App Engine and Compute Engine default accounts are listed too, by the part of their address before the @.
        await expect(clients.iam.listServiceAccounts('demo-hcm')).resolves.toEqual(['fn-admin', 'demo-hcm', '123456789012-compute']);
        await expect(clients.iam.getPool('123456789012', 'github')).resolves.toBeUndefined();
    });

    it('happyPath_anAccountIsFoundByItsAddressAndAMissingOneIsNotAFailure', async () => {
        const { clients, fakes } = provisionWorld();
        await clients.iam.createServiceAccount('demo-hcm', 'fn-admin', 'Functions: admin');

        await expect(clients.iam.serviceAccountExists('demo-hcm', 'demo-hcm@appspot.gserviceaccount.com')).resolves.toBe(true);
        await expect(clients.iam.serviceAccountExists('demo-hcm', 'fn-admin@demo-hcm.iam.gserviceaccount.com')).resolves.toBe(true);
        fakes.scenario('iam.noAppEngineAccount');
        await expect(clients.iam.serviceAccountExists('demo-hcm', 'demo-hcm@appspot.gserviceaccount.com')).resolves.toBe(false);
        await expect(clients.iam.serviceAccountExists('demo-hcm', 'nobody@demo-hcm.iam.gserviceaccount.com')).resolves.toBe(false);
    });
});
