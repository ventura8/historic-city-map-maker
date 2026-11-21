/**
 * `setup.selfTest` (the Setup Assistant's Re-check; scenario A03): every check of `SELF_TEST_CHECKS` runs in order with
 * the functions' own credentials, each isolated, and what it finds for Mapbox, USGS and crash reporting lands in
 * `setup/status`.
 */
import {
    FIRESTORE_PATHS,
    SELF_TEST_CHECKS,
    VERTEX_MODEL_IDS,
    manifestStateDocSchema,
    opsProbeDocSchema,
    type SelfTestResponse,
} from '@hcm/shared';
import { MAPBOX_TOKENS, USGS_CREDENTIALS } from '@hcm/test-support/fakes';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { forgetModelChoice } from '../../src/api/vertex-models.js';
import { UpstreamError } from '../../src/ports/errors.js';
import { saveMapbox } from '../../src/setup/save-mapbox.js';
import { saveUsgs } from '../../src/setup/save-usgs.js';
import { selfTest } from '../../src/setup/self-test.js';
import { EVENTS_PROBE_WAIT_MS } from '../../src/setup/self-test-checks.js';
import { ADMIN, CITY, NOW, createWorld, type World, type WorldOptions } from './world.js';

const CHECKED = { seconds: Date.parse(NOW) / 1000, nanoseconds: 0 };

/** A project where Mapbox and USGS were connected through the Setup Assistant. */
async function connected(
    options: WorldOptions & { readonly usgs?: (typeof USGS_CREDENTIALS)['approved' | 'pending'] } = {},
): Promise<World> {
    const world = createWorld(options);
    await saveMapbox(world.deps, ADMIN, { cityId: CITY, secretToken: MAPBOX_TOKENS.bootstrap });
    await saveUsgs(world.deps, ADMIN, { ...(options.usgs ?? USGS_CREDENTIALS.approved), expiresOn: '2027-01-31' });
    return world;
}

// The model choice lives in the module (the functions project shares one module graph per worker): each test starts
// without one and leaves none behind.
beforeEach(() => {
    forgetModelChoice();
});
afterEach(() => {
    forgetModelChoice();
});

/** The ai check's result when the first model answers: ok, naming it (§67g). */
const AI_OK = { id: 'ai', state: 'ok', params: { model: VERTEX_MODEL_IDS[0] } };

function check(response: SelfTestResponse, id: (typeof SELF_TEST_CHECKS)[number]) {
    return response.checks.find((candidate) => candidate.id === id);
}

describe('setup.selfTest', () => {
    it('happyPath_everyCheckPassesOnAConnectedProject', async () => {
        const world = await connected();

        const response = await selfTest(world.deps, ADMIN);

        expect(response.checks).toEqual(SELF_TEST_CHECKS.map((id) => (id === 'ai' ? AI_OK : { id, state: 'ok' })));
        expect(response.status).toMatchObject({
            mapbox: { state: 'ok', user: 'e2e-mapbox' },
            usgs: { state: 'ok', role: 'download' },
            crash: { state: 'ok' },
        });
        expect(world.blobs.recorder.calls.map((call) => [call.method, call.args[0]])).toEqual([
            ['write', 'private'],
            ['delete', 'private'],
            ['write', 'public'],
            ['delete', 'public'],
        ]);
        expect(world.blobs.objects.size).toBe(0);
        expect(world.tasks.tasks).toEqual([
            {
                queue: 'publish-buildManifest',
                payload: { cityId: CITY, requestedVersion: 1, full: false },
                options: { id: `manifest-${CITY}-29861790`, delaySeconds: 60 },
            },
        ]);
        expect(manifestStateDocSchema.parse(world.documents.peek(FIRESTORE_PATHS.manifestState(CITY)))).toEqual({
            requestedVersion: 1,
            builtVersion: 0,
            status: 'queued',
            updatedBy: ADMIN.uid,
            updatedAt: CHECKED,
        });
        expect(world.errors.requests).toEqual([{ hours: 24, pageSize: 1 }]);
        expect(world.status()?.usgs).toMatchObject({
            tokenExpiresAt: { seconds: Date.parse('2027-01-31T00:00:00Z') / 1000, nanoseconds: 0 },
        });
        expect(world.records.at(-1)).toMatchObject({ message: 'self-test ran', data: { uid: ADMIN.uid, failed: '' } });
    });

    it('happyPath_aSecondRunRequestsTheNextManifestVersion', async () => {
        const world = await connected();
        await selfTest(world.deps, ADMIN);

        await selfTest(world.deps, ADMIN);

        expect(manifestStateDocSchema.parse(world.documents.peek(FIRESTORE_PATHS.manifestState(CITY))).requestedVersion).toBe(2);
        expect(world.tasks.tasks).toHaveLength(1);
    });

    it('badPath_aFreshProjectHasNothingToCheckYet', async () => {
        const world = createWorld({ city: false });

        const response = await selfTest(world.deps, ADMIN);

        expect(['task-queue', 'mapbox', 'usgs'].map((id) => check(response, id as 'mapbox')?.state)).toEqual([
            'missing',
            'missing',
            'missing',
        ]);
        expect(world.status()).toMatchObject({
            mapbox: { state: 'missing', checkedAt: CHECKED },
            usgs: { state: 'missing', checkedAt: CHECKED },
        });
    });

    it('badPath_aRefusedSecretManagerNamesTheFixAndTheOtherChecksStillRun', async () => {
        const world = await connected();
        world.upstream.fail('secret-manager', 'forbidden');

        const response = await selfTest(world.deps, ADMIN);

        expect(check(response, 'secrets')).toEqual({ id: 'secrets', state: 'invalid', detail: 'apiError.secrets.unavailable' });
        expect(
            ['firestore', 'private-bucket', 'public-bucket', 'task-queue', 'firebase-management', 'error-reporting'].map(
                (id) => check(response, id as 'secrets')?.state,
            ),
        ).toEqual(['ok', 'ok', 'ok', 'ok', 'ok', 'ok']);
        expect(
            world.records.filter((record) => record.message === 'self-test check failed').map((record) => record.data?.['check']),
        ).toEqual(['secrets', 'mapbox', 'usgs']);
    });
});

describe('setup.selfTest Mapbox and USGS', () => {
    it('badPath_aRevokedBootstrapTokenTurnsTheMapboxCardInvalidAndKeepsTheRest', async () => {
        const world = await connected();
        world.upstream.scenario('mapbox.bootstrapRevoked');

        const response = await selfTest(world.deps, ADMIN);

        expect(check(response, 'mapbox')).toEqual({ id: 'mapbox', state: 'invalid', detail: 'apiError.mapbox.tokenInvalid' });
        expect(world.status()?.mapbox).toMatchObject({
            state: 'invalid',
            detail: 'apiError.mapbox.tokenInvalid',
            user: 'e2e-mapbox',
            checkedAt: CHECKED,
        });
        expect(world.status()?.mapbox?.adminToken).toMatch(/^pk\./);
    });

    it('badPath_aRevokedTilesTokenIsFound', async () => {
        const world = await connected();
        const account = world.upstream.state.mapbox.accounts.get('e2e-mapbox');
        account?.tokens.splice(
            account.tokens.findIndex((token) => token.note.endsWith('tiles (auto)')),
            1,
        );

        await expect(selfTest(world.deps, ADMIN)).resolves.toMatchObject({
            status: { mapbox: { state: 'invalid', detail: 'apiError.mapbox.tokenInvalid' } },
        });
    });

    it('badPath_aStoredPublicTokenIsTheWrongKind', async () => {
        const world = createWorld();
        await world.deps.secrets.write('mapbox-sk-bootstrap', MAPBOX_TOKENS.defaultPublic);

        const response = await selfTest(world.deps, ADMIN);

        expect(check(response, 'mapbox')).toMatchObject({ state: 'invalid', detail: 'apiError.mapbox.tokenFormat' });
        expect(world.status()?.mapbox).toEqual({ state: 'invalid', detail: 'apiError.mapbox.tokenFormat', checkedAt: CHECKED });
    });

    it('happyPath_aPassingCheckClearsTheOldReason', async () => {
        const world = await connected();
        const status = world.status();
        world.documents.seed(FIRESTORE_PATHS.setupStatus, {
            ...status,
            mapbox: { ...status?.mapbox, state: 'unavailable', detail: 'apiError.mapbox.unavailable', params: { x: 'y' } },
        });

        await selfTest(world.deps, ADMIN);

        expect(world.status()?.mapbox).toMatchObject({ state: 'ok' });
        expect(world.status()?.mapbox).not.toHaveProperty('detail');
        expect(world.status()?.mapbox).not.toHaveProperty('params');
    });

    it('badPath_aPendingApprovalStaysPendingWithItsNextCheck', async () => {
        const world = await connected({ usgs: USGS_CREDENTIALS.pending });

        const response = await selfTest(world.deps, ADMIN);

        expect(check(response, 'usgs')).toEqual({ id: 'usgs', state: 'pending', detail: 'apiError.usgs.accessPending' });
        expect(world.status()?.usgs).toMatchObject({
            state: 'pending',
            role: 'search',
            detail: 'apiError.usgs.accessPending',
            nextCheckAt: { seconds: CHECKED.seconds + 6 * 3600, nanoseconds: 0 },
        });
    });

    // CR-M6-14 (M6 setup-ux §4.1): a Check again keeps the day USGS's approval has been awaited since.
    it('badPath_aCheckAgainKeepsSinceWhenTheApprovalIsAwaited', async () => {
        const world = await connected({ usgs: USGS_CREDENTIALS.pending });
        const earlier = { seconds: CHECKED.seconds - 3 * 86_400, nanoseconds: 0 };
        const status = world.status();
        world.documents.seed(FIRESTORE_PATHS.setupStatus, { ...status, usgs: { ...status?.usgs, pendingSince: earlier } });

        await selfTest(world.deps, ADMIN);

        expect(world.status()?.usgs).toMatchObject({ state: 'pending', pendingSince: earlier });
    });

    it('badPath_usgsMaintenanceKeepsTheKnownRole', async () => {
        const world = await connected();
        world.upstream.fail('usgs', 'maintenance');

        const response = await selfTest(world.deps, ADMIN);

        expect(check(response, 'usgs')).toEqual({ id: 'usgs', state: 'unavailable', detail: 'apiError.usgs.maintenance' });
        expect(world.status()?.usgs).toMatchObject({ state: 'unavailable', role: 'download', detail: 'apiError.usgs.maintenance' });
    });

    it('badPath_anExpiredUsgsTokenIsInvalid', async () => {
        const world = await connected();
        world.upstream.scenario('usgs.tokenExpired');

        await selfTest(world.deps, ADMIN);

        expect(world.status()?.usgs).toMatchObject({ state: 'invalid', detail: 'apiError.usgs.credentials', role: 'download' });
    });
});

describe('setup.selfTest Google Cloud', () => {
    it.each([
        ['forbidden', { state: 'invalid', detail: 'apiError.cloud.permission', params: { role: 'roles/errorreporting.viewer' } }],
        ['unavailable', { state: 'unavailable', detail: 'apiError.errorReporting.unavailable' }],
    ] as const)('badPath_errorReporting_%s_isRecordedOnTheCrashCard', async (failure, expected) => {
        const world = createWorld();
        world.errors.failure = new UpstreamError('error-reporting', failure, { status: failure === 'forbidden' ? 403 : 503 });

        const response = await selfTest(world.deps, ADMIN);

        expect(check(response, 'error-reporting')).toEqual({ id: 'error-reporting', ...expected });
        expect(world.status()?.crash).toEqual({ ...expected, checkedAt: CHECKED });
    });

    it('badPath_aDisabledFirebaseManagementApiIsNamed', async () => {
        const world = createWorld();
        world.upstream.fail('firebase-management', 'apiDisabled');

        const response = await selfTest(world.deps, ADMIN);

        expect(check(response, 'firebase-management')).toEqual({
            id: 'firebase-management',
            state: 'invalid',
            detail: 'apiError.cloud.apiDisabled',
            params: { api: 'firebase.googleapis.com' },
        });
    });

    it('badPath_aBucketWithoutTheRoleNamesIt', async () => {
        const world = createWorld();
        world.blobs.recorder.failNext('write', new UpstreamError('cloud-storage', 'forbidden', { status: 403 }));

        const response = await selfTest(world.deps, ADMIN);

        expect(check(response, 'private-bucket')).toEqual({
            id: 'private-bucket',
            state: 'invalid',
            detail: 'apiError.cloud.permission',
            params: { role: 'roles/storage.objectAdmin' },
        });
        expect(check(response, 'public-bucket')?.state).toBe('ok');
    });

    it('badPath_anUnavailableTaskQueueIsRetryable', async () => {
        const world = createWorld();
        world.tasks.recorder.failNext('enqueue', new UpstreamError('cloud-tasks', 'unavailable', { status: 503 }));

        await expect(selfTest(world.deps, ADMIN)).resolves.toMatchObject({
            checks: expect.arrayContaining([{ id: 'task-queue', state: 'unavailable', detail: 'apiError.unavailable' }]) as unknown,
        });
    });

    it('badPath_anUnreachableFirestoreIsReported', async () => {
        const world = createWorld();
        world.documents.recorder.failNext('get', new UpstreamError('firestore', 'unavailable'));

        const response = await selfTest(world.deps, ADMIN);

        expect(check(response, 'firestore')).toEqual({ id: 'firestore', state: 'unavailable', detail: 'apiError.unavailable' });
    });

    it('happyPath_aBootstrapTokenWithoutATilesTokenYetIsEnough', async () => {
        const world = createWorld();
        await world.deps.secrets.write('mapbox-sk-bootstrap', MAPBOX_TOKENS.bootstrap);

        const response = await selfTest(world.deps, ADMIN);

        expect(check(response, 'mapbox')).toEqual({ id: 'mapbox', state: 'ok' });
        expect(world.upstream.callsTo('mapbox.tokens.retrieve')).toHaveLength(1);
    });

    it('badPath_aSetupStatusTheSchemaRefusesFailsTheFirestoreCheck', async () => {
        const world = createWorld();
        world.documents.seed(FIRESTORE_PATHS.setupStatus, { mapbox: { state: 'nonsense' } });

        const response = await selfTest(world.deps, ADMIN).catch((error: unknown) => error);

        expect(response).toMatchObject({ name: 'InvalidDocumentError', path: 'setup/status' });
        expect(world.records.find((record) => record.data?.['check'] === 'firestore')).toMatchObject({
            data: { code: 'apiError.internal' },
        });
    });

    it('badPath_anUnexpectedFailureIsAnInternalError', async () => {
        const world = createWorld();
        world.documents.seed(FIRESTORE_PATHS.manifestState(CITY), { requestedVersion: 'one' });

        const response = await selfTest(world.deps, ADMIN);

        expect(check(response, 'task-queue')).toEqual({ id: 'task-queue', state: 'unavailable', detail: 'apiError.internal' });
    });
});

describe('setup.selfTest Vertex AI (M4, CR-M4-5)', () => {
    it('happyPath_theAiCheckCountsTokensOnThePinnedModelWithoutACharge @S-A45-HAPPY-SELF-TEST', async () => {
        const world = createWorld();

        const response = await selfTest(world.deps, ADMIN);

        expect(check(response, 'ai')).toEqual(AI_OK);
        expect(world.upstream.callsTo('vertex-ai.countTokens').map((call) => new URL(call.url).pathname)).toEqual([
            '/v1/projects/demo-hcm/locations/us-central1/publishers/google/models/gemini-3.5-flash-lite:countTokens',
        ]);
        expect(world.upstream.callsTo('vertex-ai.generateContent')).toEqual([]);
    });

    it('happyPath_theFirstModelNotOfferedTheCheckProbesTheNextAndNamesIt @S-A45-HAPPY-FALLBACK-MODEL', async () => {
        const world = createWorld();
        world.upstream.scenario('vertex-ai.firstModelUnavailable');

        const response = await selfTest(world.deps, ADMIN);

        expect(check(response, 'ai')).toEqual({ id: 'ai', state: 'ok', params: { model: 'gemini-3.1-flash-lite' } });
        expect(world.upstream.state.vertexAi.counted).toEqual(['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite']);
        expect(world.upstream.callsTo('vertex-ai.generateContent')).toEqual([]);
    });

    it.each([
        ['apiDisabled', { state: 'invalid', detail: 'apiError.cloud.apiDisabled', params: { api: 'aiplatform.googleapis.com' } }],
        ['forbidden', { state: 'invalid', detail: 'apiError.cloud.permission', params: { role: 'hcmVertexDrafts' } }],
        ['unavailable', { state: 'unavailable', detail: 'apiError.unavailable' }],
    ] as const)('badPath_vertexAi_%s_sendsTheOwnerToPrepareTheProject @S-A45-BAD-API-DISABLED', async (mode, expected) => {
        const world = createWorld();
        world.upstream.fail('vertex-ai', mode);

        const response = await selfTest(world.deps, ADMIN);

        expect(check(response, 'ai')).toEqual({ id: 'ai', ...expected });
    });
});

describe('setup.selfTest events (M6, finding 17)', () => {
    it('happyPath_theProbeComesBackThroughOpsOnProbe', async () => {
        const world = createWorld();

        const response = await selfTest(world.deps, ADMIN);

        expect(check(response, 'events')).toEqual({ id: 'events', state: 'ok' });
        const probe = opsProbeDocSchema.parse(world.documents.peek(FIRESTORE_PATHS.opsProbe));
        expect(probe.receivedNonce).toBe(probe.nonce);
        expect(probe.nonce).toMatch(/^[a-f0-9]{32}$/);
        expect(probe).toMatchObject({ requestedAt: CHECKED, receivedAt: CHECKED, updatedBy: 'system:ops' });
        // Delivered while the check waited the first time.
        expect(world.waits).toBe(1);
    });

    it('happyPath_eachRunSendsAFreshNonce', async () => {
        const world = createWorld();
        await selfTest(world.deps, ADMIN);
        const first = opsProbeDocSchema.parse(world.documents.peek(FIRESTORE_PATHS.opsProbe)).nonce;

        await selfTest(world.deps, ADMIN);

        const second = opsProbeDocSchema.parse(world.documents.peek(FIRESTORE_PATHS.opsProbe));
        expect(second.nonce).not.toBe(first);
        expect(second.receivedNonce).toBe(second.nonce);
    });

    it('badPath_eventsThatNeverArriveNameTheInvokerRole @S-A03-BAD-EVENTS-REFUSED', async () => {
        // The project of 2026-10-25: Eventarc could not call the event functions, whose account lacked roles/run.invoker.
        const world = createWorld();
        world.deliverEvents = false;

        const response = await selfTest(world.deps, ADMIN);

        expect(check(response, 'events')).toEqual({
            id: 'events',
            state: 'invalid',
            detail: 'apiError.setup.eventsUnreached',
            params: { role: 'roles/run.invoker' },
        });
        // It waited 20 s in all, one second at a time, then gave up; the other checks still ran.
        expect(world.waits).toBe(20);
        expect(opsProbeDocSchema.parse(world.documents.peek(FIRESTORE_PATHS.opsProbe))).not.toHaveProperty('receivedNonce');
        expect(check(response, 'mapbox')).toBeDefined();
        expect(world.records.find((record) => record.data?.['check'] === 'events')).toMatchObject({
            level: 'warn',
            data: { code: 'apiError.setup.eventsUnreached' },
        });
    });

    it('badPath_aClockThatCannotWaitPollsItsRoundsAtOnce @S-A03-BAD-EVENTS-REFUSED', async () => {
        const world = createWorld();
        const reads = (): number => world.documents.recorder.argsOf('get').filter((args) => args[0] === FIRESTORE_PATHS.opsProbe).length;

        const response = await selfTest({ ...world.deps, clock: { now: () => new Date(NOW) } }, ADMIN);

        expect(check(response, 'events')).toMatchObject({ state: 'invalid', detail: 'apiError.setup.eventsUnreached' });
        expect(reads()).toBe(EVENTS_PROBE_WAIT_MS / 1_000);
    });

    it('badPath_aProbeThatCannotBeWrittenIsAFirestoreProblem', async () => {
        const world = createWorld();
        world.documents.recorder.failNext('set', new UpstreamError('firestore', 'forbidden', { status: 403 }));

        const response = await selfTest(world.deps, ADMIN);

        expect(check(response, 'events')).toEqual({
            id: 'events',
            state: 'invalid',
            detail: 'apiError.cloud.permission',
            params: { role: 'roles/datastore.user' },
        });
    });
});

/** Answers Vertex AI's `countTokens` with `status` and `body` (the other calls reach the fake upstreams). */
function vertexAnswers(world: World, status: number, body: unknown): void {
    world.intercept = (_method, url) =>
        url.pathname.endsWith(':countTokens')
            ? new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
            : undefined;
}

/** Google's error envelope with an `ErrorInfo` reason and a free-text message that must never reach a log. */
function googleRefusal(code: number, status: string, reason: string) {
    return {
        error: {
            code,
            status,
            message: 'Publisher model secret-detail-in-message was not found or your project does not have access to it.',
            details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason, domain: 'aiplatform.googleapis.com' }],
        },
    };
}

describe('setup.selfTest Vertex AI failures (M6, finding 20)', () => {
    it('badPath_aModelGoogleDoesNotOfferIsNamed @S-A45-BAD-MODEL-UNAVAILABLE', async () => {
        const world = createWorld();
        vertexAnswers(world, 404, googleRefusal(404, 'NOT_FOUND', 'MODEL_NOT_FOUND'));

        const response = await selfTest(world.deps, ADMIN);

        expect(check(response, 'ai')).toEqual({
            id: 'ai',
            state: 'invalid',
            detail: 'apiError.assist.modelUnavailable',
            params: { model: 'gemini-3.5-flash-lite, gemini-3.1-flash-lite' },
        });
        expect(world.records.find((record) => record.data?.['check'] === 'ai')?.data).toEqual({
            check: 'ai',
            code: 'apiError.assist.modelUnavailable',
            service: 'vertex-ai',
            failure: 'notFound',
            status: 404,
            googleStatus: 'NOT_FOUND',
            reason: 'MODEL_NOT_FOUND',
        });
    });

    it.each([
        [
            400,
            googleRefusal(400, 'INVALID_ARGUMENT', 'MODEL_CONFIG_INVALID'),
            'MODEL_CONFIG_INVALID',
            { failure: 'invalid', status: 400, googleStatus: 'INVALID_ARGUMENT', reason: 'MODEL_CONFIG_INVALID' },
        ],
        [
            401,
            googleRefusal(401, 'UNAUTHENTICATED', 'ACCESS_TOKEN_EXPIRED'),
            'ACCESS_TOKEN_EXPIRED',
            { failure: 'unauthorized', status: 401, googleStatus: 'UNAUTHENTICATED', reason: 'ACCESS_TOKEN_EXPIRED' },
        ],
        [
            409,
            { error: { code: 409, status: 'ABORTED', message: 'conflict' } },
            'ABORTED',
            { failure: 'conflict', status: 409, googleStatus: 'ABORTED' },
        ],
        [422, { error: { code: 422, message: 'no status' } }, 'HTTP 422', { failure: 'invalid', status: 422 }],
    ] as const)(
        'badPath_vertexAi_%i_isLoggedWithItsStatusAndReasonAndNamedAsGooglesRefusal @S-A45-BAD-UPSTREAM-LOGGED',
        async (status, body, reason, upstream) => {
            const world = createWorld();
            vertexAnswers(world, status, body);

            const response = await selfTest(world.deps, ADMIN);

            expect(check(response, 'ai')).toEqual({
                id: 'ai',
                state: 'invalid',
                detail: 'apiError.cloud.refused',
                params: { api: 'aiplatform.googleapis.com', reason },
            });
            const line = world.records.find((record) => record.data?.['check'] === 'ai');
            expect(line).toMatchObject({ level: 'warn', message: 'self-test check failed' });
            expect(line?.data).toEqual({ check: 'ai', code: 'apiError.cloud.refused', service: 'vertex-ai', ...upstream });
            expect(world.logged()).not.toContain('secret-detail-in-message');
            expect(world.logged()).not.toContain('e2e-service-account-token');
        },
    );

    it('badPath_anAnswerWithoutTheTokenCountIsARefusalNotAServerError @S-A45-BAD-UPSTREAM-LOGGED', async () => {
        const world = createWorld();
        vertexAnswers(world, 200, { promptTokensDetails: [] });

        const response = await selfTest(world.deps, ADMIN);

        expect(check(response, 'ai')).toEqual({
            id: 'ai',
            state: 'invalid',
            detail: 'apiError.cloud.refused',
            params: { api: 'aiplatform.googleapis.com', reason: 'invalid' },
        });
        expect(world.records.find((record) => record.data?.['check'] === 'ai')?.data).toEqual({
            check: 'ai',
            code: 'apiError.cloud.refused',
            service: 'vertex-ai',
            failure: 'invalid',
        });
    });

    it('badPath_aGoogleNameThatIsNotOneIsDropped', async () => {
        const world = createWorld();
        vertexAnswers(world, 400, { error: { code: 400, status: 'not a name <b>', details: [{ reason: 'x'.repeat(65).toUpperCase() }] } });

        const response = await selfTest(world.deps, ADMIN);

        expect(check(response, 'ai')?.params).toEqual({ api: 'aiplatform.googleapis.com', reason: 'HTTP 400' });
    });
});
