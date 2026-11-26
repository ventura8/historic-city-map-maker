/**
 * The in-memory port fakes of `functions/test/support/` (docs/research/M2-interfaces.md §7) behave like the adapters
 * the handlers will get: validation and conflicts in the DocumentStore, create-only writes in the BlobStore, task
 * deduplication, scripted failures, and the scenario credentials of the outside services.
 */
import { adminDocSchema, inviteDocSchema, jobDocSchema, ownerDocSchema, timestampFromDate } from '@hcm/shared';
import { GOOGLE_TOKENS, MAPBOX_TOKENS, USGS_CREDENTIALS } from '@hcm/test-support/fakes';
import { describe, expect, it } from 'vitest';

import { InvalidDocumentError, UpstreamError } from '../../src/ports/errors.js';
import { createFakeDocumentStore } from './documents.js';
import { NOW } from './fakes.js';
import { createFakeImageProcessor, fakeImage, UNREADABLE_IMAGE } from './images.js';
import {
    authUser,
    createFakeAuthAdmin,
    createFakeBlobStore,
    createFakeCloudRunJobs,
    createFakeSecretStore,
    createFakeTaskQueue,
} from './platform.js';
import { PortRecorder } from './recorder.js';
import {
    createFakeErrorReporter,
    createFakeFirebaseManagement,
    createFakeGoogleIam,
    createFakeMapboxApi,
    createFakeUsgsApi,
    testRuntimeConfig,
} from './services.js';

const AT = timestampFromDate(new Date(NOW));
const LATER = timestampFromDate(new Date(Date.parse(NOW) + 60_000));

function admin(role: 'owner' | 'admin', at = AT) {
    return { role, createdAt: at, updatedBy: 'u-owner', updatedAt: at };
}

describe('createFakeDocumentStore', () => {
    it('happyPath_aValidDocumentIsStoredAndReadBack', async () => {
        const store = createFakeDocumentStore();

        await store.create('admins/u-owner', adminDocSchema, admin('owner'));

        await expect(store.get('admins/u-owner', adminDocSchema)).resolves.toEqual(admin('owner'));
        await expect(store.get('admins/nobody', adminDocSchema)).resolves.toBeUndefined();
        expect(store.writes).toEqual([{ kind: 'create', path: 'admins/u-owner', data: admin('owner') }]);
        expect(store.paths('admins/')).toEqual(['admins/u-owner']);
    });

    it('badPath_anInvalidWriteAndASecondCreateAreRefused', async () => {
        const store = createFakeDocumentStore();
        await store.set('admins/u-1', adminDocSchema, admin('admin'));

        await expect(store.set('admins/u-2', adminDocSchema, { ...admin('admin'), role: 'root' } as never)).rejects.toBeInstanceOf(
            InvalidDocumentError,
        );
        await expect(store.create('admins/u-1', adminDocSchema, admin('admin'))).rejects.toMatchObject({
            service: 'firestore',
            failure: 'conflict',
        });
        expect(store.peek('admins/u-2')).toBeUndefined();
    });

    it('badPath_aStoredDocumentItsSchemaRefusesIsAnInvalidDocumentError', async () => {
        const store = createFakeDocumentStore();
        store.seed('setup/owner', { uid: 'u-owner' });

        await expect(store.get('setup/owner', ownerDocSchema)).rejects.toMatchObject({ name: 'InvalidDocumentError', path: 'setup/owner' });
    });

    it('happyPath_aQueryOrdersByNameAscendingAndBreaksTiesByPath', async () => {
        const store = createFakeDocumentStore();
        await store.set('admins/b', adminDocSchema, admin('admin'));
        await store.set('admins/a', adminDocSchema, admin('admin'));

        const byName = await store.query('admins', adminDocSchema, { orderBy: ['__name__', 'asc'] });
        const tied = await store.query('admins', adminDocSchema, { orderBy: ['updatedAt', 'desc'] });

        expect(byName.documents.map((document) => document.id)).toEqual(['a', 'b']);
        expect(tied.documents.map((document) => document.id)).toEqual(['a', 'b']);
    });

    it('badPath_aDescendingKeyScanIsRefusedAsTheEmulatorRefusesIt', async () => {
        const store = createFakeDocumentStore();

        await expect(store.query('admins', adminDocSchema, { orderBy: ['__name__', 'desc'] })).rejects.toThrow(
            'does not support descending key scans',
        );
    });

    it('badPath_aQueryOnAFieldExemptFromIndexingIsRefusedAsFirestoreRefusesIt @S-A33-BAD-UNINDEXED-QUERY', async () => {
        const store = createFakeDocumentStore();

        await expect(store.query('cities/c/jobs', jobDocSchema, { where: [['params.layerId', '==', 'l']] })).rejects.toThrow(
            'FAILED_PRECONDITION',
        );
        await expect(store.count('cities/c/jobs', [['params.layerId', '==', 'l']])).rejects.toThrow('FAILED_PRECONDITION');
        await expect(store.query('cities/c/jobs', jobDocSchema, { where: [['status', 'in', ['queued']]] })).resolves.toMatchObject({
            documents: [],
        });
    });

    it('happyPath_aQueryFiltersOrdersLimitsAndSplitsInvalidDocuments', async () => {
        const store = createFakeDocumentStore();
        await store.set('admins/a', adminDocSchema, admin('admin', LATER));
        await store.set('admins/b', adminDocSchema, admin('owner', AT));
        await store.set('admins/c', adminDocSchema, admin('admin', AT));
        await store.set('admins/c/history/1', adminDocSchema, admin('admin', AT));
        store.seed('admins/d', { role: 'admin' });

        const admins = await store.query('admins', adminDocSchema, {
            where: [['role', '==', 'admin']],
            orderBy: ['updatedAt', 'desc'],
            limit: 5,
        });
        const byId = await store.query('admins', adminDocSchema, {
            where: [
                ['role', 'in', ['owner']],
                ['createdAt', '<=', AT],
            ],
        });
        const later = await store.query('admins', adminDocSchema, { where: [['updatedAt', '>', AT]], orderBy: ['updatedAt', 'asc'] });

        expect(admins.documents.map((document) => document.id)).toEqual(['a', 'c']);
        expect(admins.invalid.map((document) => document.path)).toEqual(['admins/d']);
        expect(byId.documents.map((document) => document.path)).toEqual(['admins/b']);
        expect(later.documents.map((document) => document.id)).toEqual(['a']);
        expect(
            (await store.query('admins', adminDocSchema, { where: [['role', '!=', 'admin']] })).documents.map((document) => document.id),
        ).toEqual(['b']);
        expect(
            (
                await store.query('admins', adminDocSchema, {
                    where: [
                        ['updatedAt', '<', LATER],
                        ['updatedAt', '>=', AT],
                    ],
                    limit: 1,
                })
            ).documents,
        ).toHaveLength(1);
    });
});

describe('createFakeDocumentStore transactions', () => {
    it('happyPath_aTransactionCommitsItsWritesAtOnce', async () => {
        const store = createFakeDocumentStore();

        const result = await store.transaction(async (transaction) => {
            const existing = await transaction.get('setup/owner', ownerDocSchema);
            await transaction.create('setup/owner', ownerDocSchema, { uid: 'u-owner', claimedAt: AT, updatedBy: 'u-owner', updatedAt: AT });
            await transaction.set('admins/u-owner', adminDocSchema, admin('owner'));
            await transaction.delete('invites/x');
            return existing;
        });

        expect(result).toBeUndefined();
        expect(store.paths()).toEqual(['admins/u-owner', 'setup/owner']);
    });

    it('badPath_aReadAfterAWriteOrAFailedTransactionWritesNothing', async () => {
        const store = createFakeDocumentStore();
        await store.set('admins/u-1', adminDocSchema, admin('admin'));

        const readAfterWrite = store.transaction(async (transaction) => {
            await transaction.delete('admins/u-1');
            return transaction.get('admins/u-1', adminDocSchema);
        });
        const conflict = store.transaction(async (transaction) => {
            await transaction.delete('admins/u-1');
            await transaction.create('admins/u-1', adminDocSchema, admin('admin'));
            await transaction.create('admins/u-1', adminDocSchema, admin('admin'));
        });

        await expect(readAfterWrite).rejects.toThrow('all reads to be executed before all writes');
        await expect(conflict).rejects.toBeInstanceOf(UpstreamError);
        expect(store.paths()).toEqual(['admins/u-1']);
    });

    it('happyPath_contentionRunsTheWorkAgainAndKeepsOneCommit', async () => {
        const store = createFakeDocumentStore();
        let runs = 0;
        store.contend(2);

        await store.transaction(async (transaction) => {
            runs += 1;
            await transaction.set(`admins/u-${String(runs)}`, adminDocSchema, admin('admin'));
        });

        expect([runs, store.paths()]).toEqual([3, ['admins/u-3']]);
    });

    it('badPath_aScriptedFailureRejectsTheNextCall', async () => {
        const store = createFakeDocumentStore();
        store.recorder.failNext('get', new UpstreamError('firestore', 'unavailable'));

        await expect(store.get('admins/u', adminDocSchema)).rejects.toMatchObject({ failure: 'unavailable' });
        await expect(store.get('admins/u', adminDocSchema)).resolves.toBeUndefined();
        await store.delete('admins/u');
        expect(store.recorder.argsOf('get')).toEqual([['admins/u'], ['admins/u']]);
    });

    it('happyPath_invitesValidateTheirTimestamps', async () => {
        const store = createFakeDocumentStore();
        const invite = {
            role: 'admin' as const,
            invitedBy: 'u-owner',
            createdAt: AT,
            expiresAt: LATER,
            updatedBy: 'u-owner',
            updatedAt: AT,
        };

        await store.set(`invites/${'a'.repeat(64)}`, inviteDocSchema, invite);

        expect((await store.query('invites', inviteDocSchema, { where: [['expiresAt', '<', LATER]] })).documents).toEqual([]);
    });
});

describe('platform fakes', () => {
    it('happyPath_authClaimsKeepOtherClaimsAndUsersArePaged', async () => {
        const { auth, accounts, revoked } = createFakeAuthAdmin([authUser('u-2', { customClaims: { beta: true } }), authUser('u-1')], 1);

        await auth.setAdminClaim('u-2', true);
        await auth.revokeSessions('u-2');
        const first = await auth.listUsers();
        const second = await auth.listUsers(first.nextPageToken);
        await auth.setAdminClaim('u-2', false);
        await auth.deleteUser('u-1');
        await auth.deleteUser('missing');

        expect(first).toMatchObject({ users: [{ uid: 'u-1' }], nextPageToken: '1' });
        expect(second.users.map((user) => user.uid)).toEqual(['u-2']);
        expect(second).not.toHaveProperty('nextPageToken');
        expect(accounts.get('u-2')?.customClaims).toEqual({ beta: true });
        expect(revoked).toEqual(['u-2']);
        await expect(auth.getUser('u-1')).resolves.toBeUndefined();
        await expect(auth.setAdminClaim('missing', true)).rejects.toMatchObject({ failure: 'notFound' });
    });

    it('happyPath_blobsAreWrittenCopiedListedAndCreateOnlyWritesRefuseAnExistingObject', async () => {
        const { blobs, objects } = createFakeBlobStore();
        const bytes = new TextEncoder().encode('webp');

        await blobs.write('public', 'photos/bucharest/p1/abcd1234/web.webp', bytes, {
            contentType: 'image/webp',
            ifGenerationMatch: 0,
            cacheControl: 'public, max-age=31536000, immutable',
        });
        await blobs.copy(
            { bucket: 'public', path: 'photos/bucharest/p1/abcd1234/web.webp' },
            { bucket: 'private', path: 'originals/p1.webp' },
        );

        await expect(
            blobs.write('public', 'photos/bucharest/p1/abcd1234/web.webp', bytes, { contentType: 'image/webp', ifGenerationMatch: 0 }),
        ).rejects.toMatchObject({ failure: 'conflict' });
        await expect(blobs.stat('public', 'photos/bucharest/p1/abcd1234/web.webp')).resolves.toMatchObject({
            size: 4,
            contentType: 'image/webp',
            generation: '1',
        });
        await expect(blobs.read('private', 'originals/p1.webp')).resolves.toEqual(bytes);
        await expect(blobs.list('public', 'photos/bucharest/')).resolves.toEqual(['photos/bucharest/p1/abcd1234/web.webp']);
        expect(objects.get('public:photos/bucharest/p1/abcd1234/web.webp')?.cacheControl).toBe('public, max-age=31536000, immutable');
        await blobs.delete('private', 'originals/p1.webp');
        await expect(blobs.stat('private', 'originals/p1.webp')).resolves.toBeUndefined();
        await expect(blobs.read('private', 'originals/p1.webp')).rejects.toMatchObject({ failure: 'notFound' });
        await expect(blobs.copy({ bucket: 'private', path: 'missing' }, { bucket: 'public', path: 'x' })).rejects.toMatchObject({
            failure: 'notFound',
        });
    });

    it('happyPath_aTaskIdIsQueuedOnce', async () => {
        const { queue, tasks } = createFakeTaskQueue();
        const payload = { cityId: 'bucharest', requestedVersion: 1, full: false };

        await expect(queue.enqueue('publish-buildManifest', payload, { id: 'bucharest-1', delaySeconds: 60 })).resolves.toBe(true);
        await expect(queue.enqueue('publish-buildManifest', payload, { id: 'bucharest-1' })).resolves.toBe(false);
        await expect(queue.enqueue('publish-buildManifest', payload)).resolves.toBe(true);
        expect(tasks.map((task) => task.options)).toEqual([{ id: 'bucharest-1', delaySeconds: 60 }, {}]);
    });

    it('happyPath_secretsKeepVersionsAndJobsRecordRuns', async () => {
        const { secrets, versions, recorder } = createFakeSecretStore({ 'usgs-username': 'e2e-ok' });
        const { jobs, runs, cancelled } = createFakeCloudRunJobs();

        await expect(secrets.write('usgs-username', 'e2e-m2m-pending')).resolves.toBe('projects/demo-hcm/secrets/usgs-username/versions/2');
        await expect(secrets.read('usgs-username')).resolves.toBe('e2e-m2m-pending');
        await expect(secrets.read('mapbox-sk-tiles')).resolves.toBeUndefined();
        secrets.invalidate();
        const execution = await jobs.run('hcm-pipeline', { HCM_JOB_ID: 'j1' });
        await jobs.cancel(execution.name);

        expect(versions.get('usgs-username')).toEqual(['e2e-ok', 'e2e-m2m-pending']);
        expect(recorder.calls.map((call) => call.method)).toEqual(['write', 'read', 'read', 'invalidate']);
        expect(runs).toEqual([
            {
                job: 'hcm-pipeline',
                env: { HCM_JOB_ID: 'j1' },
                name: 'projects/demo-hcm/locations/us-central1/jobs/hcm-pipeline/executions/hcm-pipeline-e2e01',
            },
        ]);
        expect(cancelled).toEqual([execution.name]);
    });

    it('happyPath_jobsRecordTheirOptionsAndAnswerScriptedStatuses', async () => {
        const { jobs, runs, statuses } = createFakeCloudRunJobs();

        const execution = await jobs.run('raster-pipeline-xl', { JOB_ID: 'j2', CITY_ID: 'bucharest' }, { args: ['run'] });
        const before = await jobs.get(execution.name);
        statuses.set(execution.name, { state: 'failed', failure: 'oom', exitCode: 137 });

        expect(runs[0]?.options).toEqual({ args: ['run'] });
        expect(before).toEqual({ state: 'running' });
        await expect(jobs.get(execution.name)).resolves.toEqual({ state: 'failed', failure: 'oom', exitCode: 137 });
    });

    it('happyPath_fakeImagesAreInspectedAndScaled', async () => {
        const { images } = createFakeImageProcessor();

        const inspected = await images.inspect(fakeImage({ exif: { direction: 90 } }));
        const web = await images.webp(fakeImage(), { longEdge: 2048, quality: 82 });
        const small = await images.webp(fakeImage({ width: 300, height: 200 }), { longEdge: 400, quality: 70 });

        expect(inspected).toEqual({ contentType: 'image/jpeg', width: 4000, height: 3000, exif: { direction: 90 } });
        expect([web.width, web.height, new TextDecoder().decode(web.bytes)]).toEqual([2048, 1536, 'HCM-FAKE-WEBP:2048x1536@82']);
        expect([small.width, small.height]).toEqual([300, 200]);
    });

    it('badPath_notAnImageUnreadableAndTooLarge', async () => {
        const { images } = createFakeImageProcessor(1_000_000);

        await expect(images.inspect(new TextEncoder().encode('<svg/>'))).resolves.toMatchObject({ contentType: undefined });
        await expect(images.inspect(UNREADABLE_IMAGE)).rejects.toMatchObject({ failure: 'invalid' });
        await expect(images.inspect(fakeImage())).rejects.toMatchObject({ failure: 'invalid' });
        await expect(images.grey(fakeImage(), 128)).rejects.toMatchObject({ failure: 'invalid' });
        await expect(images.jpeg(fakeImage(), 4096)).rejects.toMatchObject({ failure: 'invalid' });
    });
});

describe('Google and Firebase port fakes', () => {
    it('happyPath_theOwnerTokenHoldsEveryPermissionAndAnEditorOnlyGet', async () => {
        const { iam } = createFakeGoogleIam();
        const asked = ['resourcemanager.projects.setIamPolicy', 'resourcemanager.projects.get'];

        await expect(iam.tokenInfo(GOOGLE_TOKENS.owner)).resolves.toMatchObject({
            email: 'owner@e2e.test',
            audience: testRuntimeConfig().oauthClientIds[0],
        });
        await expect(iam.testProjectPermissions('demo-hcm', GOOGLE_TOKENS.owner, asked)).resolves.toEqual(asked);
        await expect(iam.testProjectPermissions('demo-hcm', GOOGLE_TOKENS.editor, asked)).resolves.toEqual([
            'resourcemanager.projects.get',
        ]);
        await expect(iam.testProjectPermissions('demo-hcm', GOOGLE_TOKENS.expired, asked)).resolves.toEqual([]);
        await expect(iam.tokenInfo(GOOGLE_TOKENS.expired)).rejects.toMatchObject({ service: 'google-oauth', failure: 'unauthorized' });
        await expect(iam.tokenInfo(GOOGLE_TOKENS.otherClient)).resolves.toMatchObject({
            audience: '210987654321-elsewhere.apps.googleusercontent.com',
        });
    });

    it('happyPath_analyticsIsLinkedOnDemand', async () => {
        const { firebase, apps, linkAnalytics } = createFakeFirebaseManagement();
        const appId = String(apps[0]?.appId);

        await expect(firebase.webAppConfig('demo-hcm', appId)).resolves.not.toHaveProperty('measurementId');
        linkAnalytics();
        await expect(firebase.webAppConfig('demo-hcm', appId)).resolves.toMatchObject({
            measurementId: 'G-E2E0000000',
            apiKey: expect.stringMatching(/^AIza/) as unknown,
        });
        await expect(firebase.listWebApps('demo-hcm')).resolves.toHaveLength(1);
        await expect(firebase.webAppConfig('demo-hcm', 'missing')).rejects.toMatchObject({ failure: 'notFound' });
    });

    it('happyPath_googleSignInHasTheFixtureClientUntilRemoved', async () => {
        const { firebase, analytics } = createFakeFirebaseManagement();

        await expect(firebase.googleSignInClientId('demo-hcm')).resolves.toBe('123456789012-e2eclient.apps.googleusercontent.com');
        analytics.signInClient = null;
        await expect(firebase.googleSignInClientId('demo-hcm')).resolves.toBeNull();
    });

    it('happyPath_errorReportsAreKeptAndGroupsPaged', async () => {
        const group = {
            groupId: 'g',
            message: 'TypeError',
            service: 'viewer',
            count: 1,
            firstSeen: NOW,
            lastSeen: NOW,
            resolution: 'OPEN' as const,
        };
        const { errors, reports } = createFakeErrorReporter([group, { ...group, groupId: 'h' }]);

        errors.report({ '@type': 'x' } as never);
        const first = await errors.listGroups({ hours: 24, pageSize: 1 });
        const second = await errors.listGroups({ hours: 24, pageSize: 1, pageToken: first.nextPageToken });

        expect(reports).toHaveLength(1);
        expect([first.groups[0]?.groupId, first.nextPageToken, second.groups[0]?.groupId, second.nextPageToken]).toEqual([
            'g',
            '1',
            'h',
            undefined,
        ]);
    });
});

describe('Mapbox and USGS port fakes', () => {
    it('happyPath_mapboxMintsUpdatesAndDeletesWithTheBootstrapToken', async () => {
        const { mapbox, tokens } = createFakeMapboxApi();

        const check = await mapbox.retrieveToken(MAPBOX_TOKENS.bootstrap);
        const minted = await mapbox.createToken('e2e-mapbox', MAPBOX_TOKENS.bootstrap, {
            note: 'viewer',
            scopes: ['styles:read'],
            allowedUrls: ['https://ventura8.github.io'],
        });
        const updated = await mapbox.updateToken('e2e-mapbox', MAPBOX_TOKENS.bootstrap, minted.id, {
            note: 'viewer',
            scopes: ['styles:read'],
            allowedUrls: ['https://e2e.test'],
        });
        await mapbox.deleteToken('e2e-mapbox', MAPBOX_TOKENS.bootstrap, minted.id);
        await mapbox.deleteToken('e2e-mapbox', MAPBOX_TOKENS.bootstrap, minted.id);

        expect(check).toEqual({ user: 'e2e-mapbox', usage: 'sk', tokenId: 'cle2e00token00000000000001' });
        expect(minted).toEqual({ id: 'cle2e00minted0000000000001', token: 'pk.e2e-minted-token-0001' });
        expect(updated).toEqual(minted);
        expect(tokens.some((token) => token.id === minted.id)).toBe(false);
        const listed = await mapbox.listTokens('e2e-mapbox', MAPBOX_TOKENS.missingScopes);
        expect(listed.find((token) => token.id === 'cle2e00token00000000000002')?.scopes).not.toContain('tokens:write');
        await expect(
            mapbox.createToken('e2e-mapbox', MAPBOX_TOKENS.bootstrap, { note: 'tiles', scopes: ['tilesets:read'] }),
        ).resolves.toMatchObject({ token: 'sk.e2e-minted-token-0002' });
    });

    it('badPath_mapboxRefusesDemoBillingRevokedAndMissingTokens', async () => {
        const { mapbox, plans } = createFakeMapboxApi();
        const request = { note: 'viewer', scopes: ['styles:read'] };

        await expect(mapbox.createToken('e2e-mapbox-trial', MAPBOX_TOKENS.trial, request)).rejects.toMatchObject({
            failure: 'forbidden',
            status: 403,
        });
        await expect(mapbox.createToken('e2e-mapbox-billing', MAPBOX_TOKENS.billingPending, request)).rejects.toMatchObject({
            failure: 'invalid',
            status: 422,
        });
        await expect(mapbox.retrieveToken(MAPBOX_TOKENS.revoked)).rejects.toMatchObject({ failure: 'unauthorized' });
        await expect(mapbox.listTokens('e2e-mapbox-trial', MAPBOX_TOKENS.bootstrap)).rejects.toMatchObject({ failure: 'unauthorized' });
        await expect(mapbox.updateToken('e2e-mapbox', MAPBOX_TOKENS.bootstrap, 'missing', request)).rejects.toMatchObject({
            failure: 'notFound',
        });
        plans.set('e2e-mapbox-trial', 'paid');
        await expect(mapbox.createToken('e2e-mapbox-trial', MAPBOX_TOKENS.trial, request)).resolves.toMatchObject({
            id: expect.any(String) as unknown,
        });
    });

    it('happyPath_usgsApprovesThePendingUserOnDemand', async () => {
        const { usgs, sessions, approve } = createFakeUsgsApi();

        const ok = await usgs.login(USGS_CREDENTIALS.approved.username, USGS_CREDENTIALS.approved.applicationToken);
        const pending = await usgs.login(USGS_CREDENTIALS.pending.username, USGS_CREDENTIALS.pending.applicationToken);
        const before = await usgs.permissions(pending);
        approve();

        await expect(usgs.permissions(ok)).resolves.toContain('download');
        expect(before).toEqual(['user']);
        await expect(usgs.permissions(pending)).resolves.toContain('download');
        await usgs.logout(ok);
        expect([...sessions.keys()]).toEqual([pending]);
    });

    it('badPath_usgsRefusesExpiredAndUnknownCredentialsAndLoggedOutKeys', async () => {
        const { usgs, recorder } = createFakeUsgsApi();
        recorder.failNext('login', new UpstreamError('usgs', 'maintenance', { status: 503 }));

        await expect(usgs.login(USGS_CREDENTIALS.approved.username, USGS_CREDENTIALS.approved.applicationToken)).rejects.toMatchObject({
            failure: 'maintenance',
        });
        await expect(usgs.login(USGS_CREDENTIALS.expired.username, USGS_CREDENTIALS.expired.applicationToken)).rejects.toMatchObject({
            failure: 'unauthorized',
        });
        await expect(usgs.login(USGS_CREDENTIALS.unknown.username, USGS_CREDENTIALS.unknown.applicationToken)).rejects.toMatchObject({
            failure: 'unauthorized',
        });
        await expect(usgs.permissions('e2e-usgs-api-key-9999')).rejects.toMatchObject({ failure: 'unauthorized' });
    });

    it('happyPath_theRuntimeConfigIsTheEmulatorWorld', () => {
        expect(testRuntimeConfig({ appCheck: 'enforce' })).toMatchObject({
            projectId: 'demo-hcm',
            buckets: { private: 'demo-hcm.firebasestorage.app', public: 'demo-hcm-public' },
            adminOrigins: ['https://demo-hcm.web.app', 'https://demo-hcm.firebaseapp.com'],
            appCheck: 'enforce',
        });
    });
});

describe('PortRecorder', () => {
    it('happyPath_failuresAreConsumedInOrder', () => {
        const recorder = new PortRecorder<'call'>();
        recorder.failNext('call', new Error('first'), new Error('second'));

        expect(() => {
            recorder.enter('call', [1]);
        }).toThrow('first');
        expect(() => {
            recorder.enter('call', [2]);
        }).toThrow('second');
        recorder.enter('call', [3]);
        expect(recorder.argsOf('call')).toEqual([[1], [2], [3]]);
    });
});
