import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { parseProjectConfig, serviceAccountIdsOf, projectNames, SERVICE_ACCOUNT_IDS } from '../../src/provision/project-config.js';
import { buildAccountBindings, REQUIRED_APIS, repositoryBindings, roleTable, SECRET_IDS } from '../../src/provision/resources.js';
import { PROJECT } from './world.js';

/** `infra/project.json` and the names and roles derived from it (docs/research/M2b-interfaces.md §3.4.1, §3.7). */

const INFRA = new URL('../../../../infra/project.json', import.meta.url);

describe('parseProjectConfig', () => {
    it('happyPath_theCommittedProjectFileIsValid', () => {
        const config = parseProjectConfig(JSON.parse(readFileSync(INFRA, 'utf8')));

        expect(config).toMatchObject({ projectId: 'bucurestiul-disparut', projectNumber: '804854330662', region: 'us-central1' });
        expect(config?.github).toMatchObject({ owner: 'ventura8', branch: 'master', environment: 'deploy' });
        expect(config?.github?.ownerId).toBeGreaterThan(0);
    });

    it('happyPath_aProjectOfTheOwnersOwnHasNoGithubAndAFirstCity', () => {
        // CR-M5-7: what `create-historic-city self-host` and the start page write.
        const config = parseProjectConfig({
            projectId: 'fostul-bacau',
            projectNumber: '123456789012',
            region: 'us-central1',
            cities: ['bacau'],
            viewerOrigins: ['https://fostul-bacau.web.app'],
            firstCity: { id: 'bacau', name: { ro: 'Bacău' } },
        });
        expect(config?.github).toBeUndefined();
        expect(config?.firstCity?.id).toBe('bacau');
        expect(serviceAccountIdsOf({ github: undefined })).not.toContain('gh-deployer');
    });

    it('badPath_unsetGithubIdsOrAnHttpOriginAreRefused', () => {
        expect(parseProjectConfig({ ...PROJECT, github: { ...PROJECT.github, repoId: 0 } })).toBeUndefined();
        expect(parseProjectConfig({ ...PROJECT, viewerOrigins: ['https://ventura8.github.io/with/a/path'] })).toBeUndefined();
        expect(parseProjectConfig('not a config')).toBeUndefined();
    });
});

describe('projectNames', () => {
    it('happyPath_theBucketsOriginsAndAccountsFollowTheProjectId', () => {
        const names = projectNames(PROJECT);

        expect([names.privateBucket, names.publicBucket]).toEqual(['demo-hcm.firebasestorage.app', 'demo-hcm-public']);
        expect(names.adminOrigins).toEqual([
            'https://demo-hcm.web.app',
            'https://demo-hcm.firebaseapp.com',
            'https://demo-hcm-admin.web.app',
            'https://demo-hcm-admin.firebaseapp.com',
        ]);
        expect(names.member('gh-deployer')).toBe('serviceAccount:gh-deployer@demo-hcm.iam.gserviceaccount.com');
        expect(SERVICE_ACCOUNT_IDS).toEqual(['fn-admin', 'fn-events', 'fn-crash', 'job-raster', 'gh-deployer', 'hcm-installer']);
    });
});

describe('the role table', () => {
    const agents = {
        firebaseStorage: 'fs-agent@example.test',
        cloudStorage: 'gcs-agent@example.test',
        pubsub: 'pubsub-agent@example.test',
        computeDefault: undefined,
        appEngineDefault: undefined,
    };

    it('happyPath_everyM2bRowIsBoundOnItsResource', () => {
        const table = roleTable(PROJECT, agents);
        const project = table.find((policy) => policy.kind === 'project');

        expect(table.map((policy) => `${policy.kind}:${policy.resource}`)).toEqual([
            'project:demo-hcm',
            'bucket:demo-hcm.firebasestorage.app',
            'bucket:demo-hcm-public',
            ...SECRET_IDS.map((secret) => `secret:${secret}`),
            'serviceAccount:fn-admin@demo-hcm.iam.gserviceaccount.com',
            'serviceAccount:fn-events@demo-hcm.iam.gserviceaccount.com',
            'serviceAccount:fn-crash@demo-hcm.iam.gserviceaccount.com',
            'serviceAccount:job-raster@demo-hcm.iam.gserviceaccount.com',
        ]);
        expect(project?.bindings).toContainEqual({
            role: 'roles/firebaserules.firestoreServiceAgent',
            member: 'serviceAccount:fs-agent@example.test',
        });
        expect(project?.bindings.some((binding) => binding.role === 'roles/cloudbuild.builds.builder')).toBe(false);
        expect(table.find((policy) => policy.resource === 'mapbox-sk-bootstrap')?.bindings.map((binding) => binding.member)).not.toContain(
            'serviceAccount:fn-events@demo-hcm.iam.gserviceaccount.com',
        );
        expect(REQUIRED_APIS).toHaveLength(34);
        expect(REQUIRED_APIS).toContain('analyticsdata.googleapis.com');
    });

    it('happyPath_theM4AssistsAndPushHaveTheirApisAndRoles', () => {
        // docs/research/M4-interfaces.md §4.4 (CR-M4-5): Vertex AI for the drafts, FCM for web push.
        const project = roleTable(PROJECT, agents).find((policy) => policy.kind === 'project');
        const rolesOf = (account: string): string[] =>
            (project?.bindings ?? [])
                .filter((binding) => binding.member === `serviceAccount:${account}@demo-hcm.iam.gserviceaccount.com`)
                .map((binding) => binding.role);

        expect(REQUIRED_APIS).toEqual(
            expect.arrayContaining(['aiplatform.googleapis.com', 'fcm.googleapis.com', 'fcmregistrations.googleapis.com']),
        );
        expect(rolesOf('fn-admin')).toEqual(
            expect.arrayContaining([`projects/${PROJECT.projectId}/roles/hcmVertexDrafts`, 'roles/firebasecloudmessaging.admin']),
        );
        expect(rolesOf('fn-admin')).not.toContain('roles/aiplatform.user');
        expect(rolesOf('fn-events')).toContain('roles/firebasecloudmessaging.admin');
        expect(rolesOf('fn-events')).not.toContain(`projects/${PROJECT.projectId}/roles/hcmVertexDrafts`);
    });

    it('happyPath_theRasterJobReadsTheUsgsSecretsOnlyAndTheEventFunctionsRunItsExecutions', () => {
        // docs/research/M3-interfaces.md §9.4 (CR-M3-6): publishing stays in the functions, so no Mapbox secret for the job.
        const table = roleTable(PROJECT, agents);
        const raster = 'serviceAccount:job-raster@demo-hcm.iam.gserviceaccount.com';
        const events = 'serviceAccount:fn-events@demo-hcm.iam.gserviceaccount.com';
        const readers = (secret: string): string[] =>
            (table.find((policy) => policy.resource === secret)?.bindings ?? [])
                .filter((binding) => binding.role === 'roles/secretmanager.secretAccessor')
                .map((binding) => binding.member);
        const projectRoles = (member: string): string[] =>
            (table.find((policy) => policy.kind === 'project')?.bindings ?? [])
                .filter((binding) => binding.member === member)
                .map((binding) => binding.role);

        expect(readers('mapbox-sk-tiles')).not.toContain(raster);
        expect(readers('mapbox-sk-tiles')).toContain(events);
        expect(
            [readers('usgs-username'), readers('usgs-app-token')].every((members) => members.includes(raster) && members.includes(events)),
        ).toBe(true);
        expect(projectRoles(events)).toEqual(expect.arrayContaining(['roles/run.jobsExecutorWithOverrides', 'roles/run.viewer']));
        expect(projectRoles(raster)).toEqual(['roles/datastore.user']);
        expect(REQUIRED_APIS).toEqual(expect.arrayContaining(['run.googleapis.com', 'artifactregistry.googleapis.com']));
    });

    it('badPath_theCrashEndpointsAccountHoldsNoRoleOnlyTheDeployerMayActAsIt', () => {
        const crash = 'serviceAccount:fn-crash@demo-hcm.iam.gserviceaccount.com';
        const table = roleTable(PROJECT, agents);

        expect(table.flatMap((policy) => policy.bindings).filter((binding) => binding.member === crash)).toEqual([]);
        expect(table.find((policy) => policy.resource === 'fn-crash@demo-hcm.iam.gserviceaccount.com')?.bindings).toEqual([
            { role: 'roles/iam.serviceAccountUser', member: 'serviceAccount:gh-deployer@demo-hcm.iam.gserviceaccount.com' },
            { role: 'roles/iam.serviceAccountUser', member: 'serviceAccount:hcm-installer@demo-hcm.iam.gserviceaccount.com' },
        ]);
    });

    it('happyPath_theBuildAccountGetsTheInstallersActAsThenTheBuilderRoleOnly @S-A04-HAPPY-COMPUTE-BUILD-ACCOUNT', () => {
        // Finding 33 (DECISIONS §75g): the functions build as the Compute Engine default account; the installer acts as it on
        // that account only, and the account gets the narrow builder role before its Editor role goes.
        const compute = '123456789012-compute@developer.gserviceaccount.com';

        expect(buildAccountBindings(PROJECT, compute)).toEqual([
            {
                kind: 'serviceAccount',
                resource: compute,
                bindings: [
                    { role: 'roles/iam.serviceAccountUser', member: 'serviceAccount:hcm-installer@demo-hcm.iam.gserviceaccount.com' },
                ],
            },
            {
                kind: 'project',
                resource: 'demo-hcm',
                bindings: [{ role: 'roles/cloudbuild.builds.builder', member: `serviceAccount:${compute}` }],
            },
        ]);
        expect(roleTable(PROJECT, { ...agents, computeDefault: compute })[0]?.bindings.map((binding) => binding.role)).not.toContain(
            'roles/cloudbuild.builds.builder',
        );
    });

    it('badPath_withoutTheComputeAccountThereIsNoBuildAccountToBind', () => {
        expect(buildAccountBindings(PROJECT, undefined)).toEqual([]);
    });
});

describe('the role table of M6 (docs/research/M6-interfaces.md §1.2, §1.6)', () => {
    const agents = {
        firebaseStorage: 'fs-agent@example.test',
        cloudStorage: 'gcs-agent@example.test',
        pubsub: 'pubsub-agent@example.test',
        computeDefault: undefined,
        appEngineDefault: undefined,
    };

    it('happyPath_theM6InstallerHasExactlyTheContractsRolesAndActsOnlyAsTheRuntimeAccounts @S-A04-HAPPY-INSTALLER-ACCOUNT', () => {
        // docs/research/M6-interfaces.md §1.2 (CR-M6-2): the in-app installer's builds run as hcm-installer@.
        const table = roleTable(PROJECT, agents);
        const installer = 'serviceAccount:hcm-installer@demo-hcm.iam.gserviceaccount.com';
        const roles = (resource: string): string[] =>
            (table.find((policy) => policy.resource === resource)?.bindings ?? [])
                .filter((binding) => binding.member === installer)
                .map((binding) => binding.role);

        expect(roles('demo-hcm')).toEqual([
            'roles/cloudfunctions.developer',
            'roles/firebaserules.admin',
            'roles/datastore.indexAdmin',
            'roles/cloudscheduler.admin',
            'roles/cloudtasks.queueAdmin',
            'roles/serviceusage.serviceUsageConsumer',
            'roles/firebase.viewer',
            'roles/firebasehosting.admin',
            'roles/logging.logWriter',
            'projects/demo-hcm/roles/hcmInstaller',
        ]);
        // Finding 31: the repository's writer role is the artifact-registry item's, so the iam item never waits for it.
        expect(roles('hcm')).toEqual([]);
        expect(repositoryBindings(PROJECT)).toEqual({
            kind: 'repository',
            resource: 'hcm',
            bindings: [{ role: 'roles/artifactregistry.writer', member: installer }],
        });
        for (const account of ['fn-admin', 'fn-events', 'fn-crash', 'job-raster']) {
            expect(roles(`${account}@demo-hcm.iam.gserviceaccount.com`)).toEqual(['roles/iam.serviceAccountUser']);
        }
        expect(roles('gh-deployer@demo-hcm.iam.gserviceaccount.com')).toEqual([]);
        // Never the wide roles §1.2 rules out.
        const wide = [
            'roles/owner',
            'roles/editor',
            'roles/run.admin',
            'roles/resourcemanager.projectIamAdmin',
            'roles/artifactregistry.repoAdmin',
        ];
        expect(
            table.flatMap((policy) => policy.bindings).filter((binding) => binding.member === installer && wide.includes(binding.role)),
        ).toEqual([]);
        expect(REQUIRED_APIS).toEqual(
            expect.arrayContaining(['firebasehosting.googleapis.com', 'firebaserules.googleapis.com', 'firestore.googleapis.com']),
        );
    });

    it('happyPath_theFunctionAccountsMayInvokeTheFunctionsEventarcAndSchedulerCall', () => {
        // Finding 17: Eventarc delivers with fn-events@, Cloud Scheduler's OIDC token is fn-admin@'s.
        const project = roleTable(PROJECT, agents)[0];
        const invokers = (project?.bindings ?? [])
            .filter((binding) => binding.role === 'roles/run.invoker')
            .map((binding) => binding.member);

        expect(invokers).toEqual([
            'serviceAccount:fn-admin@demo-hcm.iam.gserviceaccount.com',
            'serviceAccount:fn-events@demo-hcm.iam.gserviceaccount.com',
        ]);
    });

    it('happyPath_aFirstDeploysServiceAgentRolesAreInPlaceForTheInstaller', () => {
        // firebase-tools' ensureServiceAgentRoles wants them on a project without event functions yet; the installer may
        // read the project's policy but not write it.
        const withCompute = roleTable(PROJECT, { ...agents, computeDefault: '123456789012-compute@developer.gserviceaccount.com' })[0];
        const without = roleTable(PROJECT, agents)[0];
        const compute = 'serviceAccount:123456789012-compute@developer.gserviceaccount.com';

        expect(without?.bindings).toContainEqual({
            role: 'roles/iam.serviceAccountTokenCreator',
            member: 'serviceAccount:pubsub-agent@example.test',
        });
        expect(without?.bindings.filter((binding) => binding.member === compute)).toEqual([]);
        expect(withCompute?.bindings.filter((binding) => binding.member === compute)).toEqual([
            { role: 'roles/run.invoker', member: compute },
            { role: 'roles/eventarc.eventReceiver', member: compute },
        ]);
    });

    it('happyPath_theInstallerActsAsTheAppEngineDefaultAccountOnThatAccountOnly @S-A04-HAPPY-APPENGINE-ACTAS', () => {
        // Finding 28 of docs/research/manual-test-2026-10-25.md (live test 2026-10-31): firebase-tools' checkServiceAccountIam wants actAs on it.
        const appEngine = 'demo-hcm@appspot.gserviceaccount.com';
        const installer = 'serviceAccount:hcm-installer@demo-hcm.iam.gserviceaccount.com';
        const table = roleTable(PROJECT, { ...agents, appEngineDefault: appEngine });

        expect(table.find((policy) => policy.resource === appEngine)).toEqual({
            kind: 'serviceAccount',
            resource: appEngine,
            bindings: [{ role: 'roles/iam.serviceAccountUser', member: installer }],
        });
        expect(table.at(-1)?.resource).toBe(appEngine);
        // Never project-wide: the project's policy gives the installer no Service Account User role.
        expect(
            table[0]?.bindings.filter((binding) => binding.member === installer && binding.role === 'roles/iam.serviceAccountUser'),
        ).toEqual([]);
    });

    it('badPath_aProjectWithoutTheAppEngineDefaultAccountGetsNoBindingForIt', () => {
        const table = roleTable(PROJECT, agents);

        expect(table.some((policy) => policy.resource.endsWith('@appspot.gserviceaccount.com'))).toBe(false);
    });
});
