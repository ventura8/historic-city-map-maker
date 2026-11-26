/**
 * `imagery.retry` (`functions/src/imagery/retry.ts`, `docs/research/M3-interfaces.md` §4.5): a failed raster job again
 * after what it keeps (the city crop, the segments, the delivery): a pipeline failure goes back to `queued` (the dispatcher starts it), a failure after
 * approval goes back to the publisher; never past the attempts, never while the budget guard is red. A stopped job
 * (status `cancelled`, version `cancelled`) is retried the same way as a failed one.
 */
import { JOB_MAX_ATTEMPTS, PUBLISH_MAX_ATTEMPTS, type JobDoc, type LayerVersionDoc } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { retryFunction } from '../../src/imagery/retry.js';
import { failureOf } from '../admin/world.js';
import { F039, F040, requireVersion, seedJoinOfTwo } from './join-world.js';
import { adminCall } from '../publish/fakes.js';
import {
    CITY,
    NOW,
    at,
    goldenOutput,
    readJob,
    readVersion,
    readyWorld,
    renderedVersion,
    seedGuard,
    seedJob,
    seedScene,
    seedVersion,
    type ImageryWorld,
} from './world.js';

const JOB = 'job-1966-0712';

function failed(overrides: Partial<JobDoc> = {}): JobDoc {
    return {
        type: 'usgs-import',
        status: 'failed',
        params: { entityId: 'DS1035-1057DA023', dataset: 'corona2', sensor: 'KH-4A' },
        createdBy: 'u-admin',
        createdAt: at(NOW),
        layerId: 'kh-4a-corona-1966',
        versionId: JOB,
        attempt: 1,
        finishedAt: at(NOW),
        error: { code: 'apiError.imagery.referenceUnavailable', message: 'apiError.imagery.referenceUnavailable' },
        steps: { fetch: { status: 'done', gcsPath: 'usgs-raw/corona2/DS1035-1057DA023/a.tgz' }, reference: { status: 'failed' } },
        updatedBy: 'system:pipeline',
        updatedAt: at(NOW),
        ...overrides,
    };
}

function retry(world: ImageryWorld, jobId = JOB) {
    return retryFunction(() => world.deps).run(adminCall({ cityId: CITY, jobId }));
}

/** The failed version the pipeline left (the version a retry needs: a refused upload has none). */
async function seedFailedVersion(world: ImageryWorld, overrides: Parameters<typeof renderedVersion>[0] = {}): Promise<void> {
    await seedVersion(
        world,
        JOB,
        renderedVersion({ state: 'failed', output: undefined, error: { code: 'apiError.imagery.referenceUnavailable' }, ...overrides }),
    );
}

const PUBLISH_FAILED = renderedVersion({
    state: 'failed',
    approval: { auto: true, by: 'system:imagery', at: at(NOW) },
    error: { code: 'apiError.imagery.mtsRefused' },
});

describe('imagery.retry', () => {
    it('happyPath_aPipelineFailureIsQueuedAgainFromItsFailedStep', async () => {
        const world = await readyWorld();
        await seedJob(world, JOB, failed());
        await seedVersion(
            world,
            JOB,
            renderedVersion({ state: 'failed', output: undefined, error: { code: 'apiError.imagery.referenceUnavailable' } }),
        );

        await expect(retry(world)).resolves.toEqual({ status: 'queued', attempt: 1 });

        const job = await readJob(world, JOB);
        expect(job).toMatchObject({
            status: 'queued',
            attempt: 1,
            steps: { fetch: { status: 'done' }, reference: { status: 'pending' } },
            updatedBy: 'u-admin',
        });
        expect(job?.error).toBeUndefined();
        expect(job?.finishedAt).toBeUndefined();
        expect((await readVersion(world, JOB))?.state).toBe('processing');
        expect(world.deps.tasks.queued).toEqual([]);
    });

    it('happyPath_aRetryRedoesWhatANewerPipelineMayDoDifferently_keepingTheDownload @S-A12-HAPPY-RETRY-REDOES', async () => {
        const world = await readyWorld();
        const fetched = { status: 'done', gcsPath: 'usgs-raw/corona2/DS1035-1057DA023/a.tgz' } as const;
        const steps = { fetch: fetched, extract: { status: 'done' }, stitch: { status: 'done' }, locate: { status: 'failed' } } as const;
        await seedJob(world, JOB, failed({ error: { code: 'apiError.imagery.cityNotFound', message: 'x' }, steps }));
        await seedVersion(
            world,
            JOB,
            renderedVersion({ state: 'failed', output: undefined, error: { code: 'apiError.imagery.cityNotFound' } }),
        );

        await retry(world);

        expect((await readJob(world, JOB))?.steps).toEqual({
            fetch: fetched,
            extract: { status: 'done' },
            stitch: { status: 'pending' },
            locate: { status: 'pending' },
        });
    });

    it('badPath_aRetryAfterTheCityCropKeepsIt_theDeliveryIsGone @S-A12-BAD-RETRY-KEEPS-CROP', async () => {
        const world = await readyWorld();
        const steps = {
            fetch: { status: 'done' },
            stitch: { status: 'done' },
            locate: { status: 'done' },
            reference: { status: 'done' },
            georef: { status: 'failed' },
        } as const;
        await seedJob(world, JOB, failed({ steps }));
        await seedVersion(
            world,
            JOB,
            renderedVersion({ state: 'failed', output: undefined, error: { code: 'apiError.imagery.referenceUnavailable' } }),
        );

        await retry(world);

        expect((await readJob(world, JOB))?.steps).toEqual({
            fetch: { status: 'done' },
            stitch: { status: 'done' },
            locate: { status: 'done' },
            reference: { status: 'pending' },
            georef: { status: 'pending' },
        });
    });

    it('happyPath_aFailureAfterApprovalGoesBackToThePublisher', async () => {
        const world = await readyWorld();
        await seedJob(
            world,
            JOB,
            failed({
                error: { code: 'apiError.imagery.mtsRefused', message: 'x' },
                mapboxJobId: 'mts-job-1',
                publishAttempts: 1,
                steps: { upload: { status: 'done', sha256: 'c'.repeat(64) }, publish: { status: 'done' }, tiles: { status: 'failed' } },
            }),
        );
        await seedVersion(world, JOB, PUBLISH_FAILED);

        await expect(retry(world)).resolves.toEqual({ status: 'awaiting_approval', attempt: 1 });

        expect(await readJob(world, JOB)).toMatchObject({ status: 'awaiting_approval', waitReason: 'approval' });
        expect((await readJob(world, JOB))?.mapboxJobId).toBeUndefined();
        expect((await readVersion(world, JOB))?.state).toBe('approved');
        expect(world.deps.tasks.queued).toEqual([
            {
                queue: 'imagery-publish',
                payload: { cityId: CITY, jobId: JOB, phase: 'start', poll: 0 },
                options: { id: `${CITY}-${JOB}-retry-${String(Date.parse(NOW))}` },
            },
        ]);
    });
});

describe('imagery.retry: a publish retry keeps the upload', () => {
    it('happyPath_aPublishRetryKeepsTheUploadAndClearsThePublishSteps', async () => {
        const world = await readyWorld();
        await seedJob(
            world,
            JOB,
            failed({
                error: { code: 'apiError.imagery.mtsRefused', message: 'x' },
                mapboxJobId: 'mts-job-1',
                steps: { upload: { status: 'done', sha256: 'c'.repeat(64) }, publish: { status: 'done' }, tiles: { status: 'failed' } },
            }),
        );
        await seedVersion(world, JOB, PUBLISH_FAILED);

        await retry(world);

        expect((await readJob(world, JOB))?.steps).toEqual({ upload: { status: 'done', sha256: 'c'.repeat(64) } });
    });
});

describe('imagery.retry: a stopped job', () => {
    it('happyPath_aStoppedJobWithACancelledVersionIsQueuedAgain', async () => {
        const world = await readyWorld();
        await seedJob(world, JOB, failed({ status: 'cancelled', error: undefined }));
        await seedVersion(world, JOB, renderedVersion({ state: 'cancelled', output: undefined, error: undefined }));

        // A stopped job spent no attempt it could be blamed for: retry starts the count again (`attemptsAgain`).
        await expect(retry(world)).resolves.toEqual({ status: 'queued', attempt: 0 });

        const job = await readJob(world, JOB);
        expect(job).toMatchObject({
            status: 'queued',
            attempt: 0,
            updatedBy: 'u-admin',
        });
        expect(job?.error).toBeUndefined();
        expect(job?.finishedAt).toBeUndefined();
        expect((await readVersion(world, JOB))?.state).toBe('processing');
        expect(world.deps.tasks.queued).toEqual([]);
    });
});

describe('imagery.retry: a version that is no longer failed', () => {
    const SCENE = 'DS1035-1057DA023';

    it('badPath_aDismissedVersionIsNotBroughtBack_itsSceneWasFreed @S-A12-BAD-RETRY-DISMISSED', async () => {
        const world = await readyWorld();
        await seedJob(world, JOB, failed({ cancelRequested: true }));
        await seedFailedVersion(world, { state: 'rejected' });
        await seedScene(world, SCENE);

        expect(await failureOf(retry(world))).toMatchObject({ details: { code: 'apiError.imagery.versionRejected' } });

        expect((await readJob(world, JOB))?.status).toBe('failed');
        expect((await readVersion(world, JOB))?.state).toBe('rejected');
    });

    it('badPath_anImportSetAsideAfterTheFrameWasImportedAgainNamesTheNewerImport @S-A12-BAD-RETRY-IMPORTED-AGAIN', async () => {
        // The owner's report of 2026-11-13: the 1972 frame's old import answered a bare 400.
        const world = await readyWorld();
        await seedJob(world, JOB, failed());
        await seedFailedVersion(world, { state: 'rejected' });
        await seedVersion(world, 'im-older-0712', renderedVersion({ state: 'rejected' }));
        await seedVersion(world, 'im-newer-0712', renderedVersion({ state: 'awaiting_approval' }));
        await seedVersion(world, 'im-other-0999', renderedVersion({ state: 'awaiting_approval' }));

        expect(await failureOf(retry(world))).toMatchObject({
            details: { code: 'apiError.imagery.importedAgain', params: { versionId: 'im-newer-0712' } },
        });
        expect((await readJob(world, JOB))?.status).toBe('failed');
    });

    it('badPath_aVersionDismissedDuringTheRetryIsNotBroughtBack @S-A12-BAD-RETRY-DISMISSED', async () => {
        const world = await readyWorld();
        await seedJob(world, JOB, failed());
        await seedFailedVersion(world);
        const original = world.deps.documents.transaction.bind(world.deps.documents);
        world.deps.documents.transaction = (async (work: Parameters<typeof original>[0]) => {
            await seedFailedVersion(world, { state: 'rejected' });
            return original(work);
        }) as typeof original;

        expect(await failureOf(retry(world))).toMatchObject({ details: { code: 'apiError.imagery.versionState' } });

        expect((await readJob(world, JOB))?.status).toBe('failed');
    });

    it.each(['cancelled', 'awaiting_approval'] as const)(
        'badPath_aVersionInAnotherStateIsNotBroughtBack_%s @S-A12-BAD-RETRY-DISMISSED',
        async (state) => {
            const world = await readyWorld();
            await seedJob(world, JOB, failed());
            await seedVersion(world, JOB, renderedVersion({ state }));

            expect(await failureOf(retry(world))).toMatchObject({ details: { code: 'apiError.imagery.versionState' } });
        },
    );

    it('badPath_aVersionStrandedProcessingUnderAFailedJobCanBeRetried @S-A12-BAD-STRANDED-VERSION', async () => {
        const world = await readyWorld();
        await seedJob(world, JOB, failed());
        await seedVersion(world, JOB, renderedVersion({ state: 'processing' }));

        await expect(retry(world)).resolves.toMatchObject({ status: 'queued' });

        expect((await readJob(world, JOB))?.status).toBe('queued');
        expect((await readVersion(world, JOB))?.state).toBe('processing');
    });

    it.each(['approved', 'publishing'] as const)('happyPath_aPublishRetryOfAVersionStill_%s_goesBackToThePublisher', async (state) => {
        const world = await readyWorld();
        await seedJob(world, JOB, failed({ error: { code: 'apiError.imagery.mtsRefused', message: 'x' } }));
        await seedVersion(world, JOB, renderedVersion({ state, approval: { auto: true, by: 'system:imagery', at: at(NOW) } }));

        await expect(retry(world)).resolves.toMatchObject({ status: 'awaiting_approval' });

        expect((await readVersion(world, JOB))?.state).toBe(state);
    });
});

describe('imagery.retry: an outdated runner spent no attempt', () => {
    it.each([
        ['the outdated code', { code: 'apiError.imagery.pipelineOutdated', message: 'the pipeline does not run archive-series jobs' }],
        ['the legacy invalid request', { code: 'apiError.invalidRequest', message: 'the pipeline does not run archive-series jobs' }],
    ])('happyPath_pastTheAttemptsAFailureOf_%s_IsQueuedAgainWithItsCountReset @S-A12-HAPPY-RETRY-OUTDATED', async (_name, error) => {
        const world = await readyWorld();
        await seedJob(world, JOB, failed({ attempt: JOB_MAX_ATTEMPTS, error }));
        await seedFailedVersion(world);

        await expect(retry(world)).resolves.toEqual({ status: 'queued', attempt: 0 });

        expect((await readJob(world, JOB))?.attempt).toBe(0);
    });

    it('badPath_anotherInvalidRequestPastTheAttemptsIsNotTriedAgain @S-A12-BAD-RETRY-EXHAUSTED', async () => {
        const world = await readyWorld();
        await seedJob(
            world,
            JOB,
            failed({ attempt: JOB_MAX_ATTEMPTS, error: { code: 'apiError.invalidRequest', message: 'basedOn must be an id' } }),
        );
        await seedFailedVersion(world);

        expect(await failureOf(retry(world))).toMatchObject({ details: { code: 'apiError.imagery.attemptsExhausted' } });
    });
});

/** An archive series (M20) as `imagery.archiveImport` queues it: its originals never leave the owner's computer. */
const SERIES: Partial<JobDoc> = {
    type: 'archive-series',
    params: {
        archiveId: 'ar-0123456789abcdef',
        seriesId: 's-0123456789ab',
        class: 'grid',
        sheets: 4,
        encoding: 'lineart',
        order: 0,
        referenceLayerIds: [],
    },
    runOn: 'local',
    localOnly: true,
    attempt: JOB_MAX_ATTEMPTS,
    error: { code: 'apiError.internal', message: 'the server refused the record' },
    steps: { gather: { status: 'done' }, place: { status: 'failed' } },
};

describe("imagery.retry: a run on the owner's computer costs no cloud compute (live report of 2026-11-12)", () => {
    it.each([
        ['an archive series failed in place', SERIES],
        ['a frame run on the computer', { runOn: 'local' as const, attempt: JOB_MAX_ATTEMPTS }],
        ['a local run the dispatcher ended at the cap', { ...SERIES, error: { code: 'apiError.imagery.attemptsExhausted', message: 'x' } }],
        [
            'an archive series whose sheets never reached another computer',
            { ...SERIES, archiveReturns: 4, error: { code: 'apiError.imagery.archiveMissing', message: 'x' } },
        ],
    ])('happyPath_atTheCap_%s_IsQueuedAgainWithItsCountReset @S-A12-HAPPY-LOCAL-RETRY-PAST-CAP', async (_case, overrides) => {
        const world = await readyWorld();
        await seedJob(world, JOB, failed(overrides));
        await seedFailedVersion(world);

        await expect(retry(world)).resolves.toEqual({ status: 'queued', attempt: 0 });

        const job = await readJob(world, JOB);
        expect(job).toMatchObject({ status: 'queued', attempt: 0, runOn: 'local' });
        expect(job?.error).toBeUndefined();
        expect(job?.archiveReturns).toBeUndefined();
        expect((await readVersion(world, JOB))?.state).toBe('processing');
    });

    it.each([
        ['a cloud run', { runOn: 'cloud' as const }],
        ['a run never placed', {}],
    ])('badPath_%s_atTheCapIsStillRefused @S-A12-BAD-CLOUD-RETRY-AT-CAP', async (_case, overrides) => {
        const world = await readyWorld();
        await seedJob(world, JOB, failed({ ...overrides, attempt: JOB_MAX_ATTEMPTS, error: { code: 'apiError.internal', message: 'x' } }));
        await seedFailedVersion(world);

        expect(await failureOf(retry(world))).toMatchObject({
            details: { code: 'apiError.imagery.attemptsExhausted', params: { attempts: String(JOB_MAX_ATTEMPTS) } },
        });
        expect(await readJob(world, JOB)).toMatchObject({ status: 'failed', attempt: JOB_MAX_ATTEMPTS });
    });

    it('badPath_aLocalRunsPublishKeepsItsCap_MapboxWorkIsPaid @S-A12-BAD-CLOUD-RETRY-AT-CAP', async () => {
        const world = await readyWorld();
        const publishFailed = { error: { code: 'apiError.imagery.mtsRefused', message: 'x' }, publishAttempts: PUBLISH_MAX_ATTEMPTS };
        await seedJob(world, JOB, failed({ ...SERIES, ...publishFailed }));
        await seedVersion(world, JOB, PUBLISH_FAILED);

        expect(await failureOf(retry(world))).toMatchObject({ details: { code: 'apiError.imagery.attemptsExhausted' } });
        expect(world.deps.tasks.queued).toEqual([]);
    });

    it('badPath_aLocalRunsTokenFailureIsStillNotRetried @S-A12-BAD-CLOUD-RETRY-AT-CAP', async () => {
        const world = await readyWorld();
        await seedJob(world, JOB, failed({ ...SERIES, error: { code: 'apiError.mapbox.tokenInvalid', message: 'x' } }));
        await seedFailedVersion(world);

        expect(await failureOf(retry(world))).toMatchObject({ details: { code: 'apiError.imagery.versionState' } });
    });
});

describe('imagery.retry: what is not tried again', () => {
    it('badPath_pastTheAttemptsItIsNotTriedAgain', async () => {
        const world = await readyWorld();
        await seedJob(world, JOB, failed({ attempt: JOB_MAX_ATTEMPTS }));
        await seedFailedVersion(world);

        expect(await failureOf(retry(world))).toMatchObject({
            code: 'failed-precondition',
            details: { code: 'apiError.imagery.attemptsExhausted', params: { attempts: '3' } },
        });
    });

    it('badPath_aPublishPastItsAttemptsIsNotTriedAgain @S-A42-BAD-PUBLISH-ATTEMPTS', async () => {
        const world = await readyWorld();
        await seedJob(
            world,
            JOB,
            failed({ error: { code: 'apiError.imagery.mtsRefused', message: 'x' }, publishAttempts: PUBLISH_MAX_ATTEMPTS }),
        );
        await seedVersion(world, JOB, PUBLISH_FAILED);

        expect(await failureOf(retry(world))).toMatchObject({
            details: { code: 'apiError.imagery.attemptsExhausted', params: { attempts: String(PUBLISH_MAX_ATTEMPTS) } },
        });
        expect(world.deps.tasks.queued).toEqual([]);
    });

    it.each([
        ['a revoked Mapbox token', 'apiError.mapbox.tokenInvalid'],
        ['a token without the tileset scopes', 'apiError.mapbox.missingScopes'],
    ])('badPath_aFailureNoRetryCuresIsNotRetried_%s @S-A12-BAD-NOT-RETRYABLE', async (_case, code) => {
        const world = await readyWorld();
        await seedJob(world, JOB, failed({ error: { code, message: code } }));
        await seedFailedVersion(world, { error: { code: code as 'apiError.mapbox.tokenInvalid' } });

        expect(await failureOf(retry(world))).toMatchObject({ details: { code: 'apiError.imagery.versionState' } });
        expect((await readJob(world, JOB))?.status).toBe('failed');
    });

    it('badPath_aRefusedUploadWithoutAVersionIsNotRetried @S-A14-BAD-NON-TIFF', async () => {
        const world = await readyWorld();
        await seedJob(
            world,
            JOB,
            failed({
                type: 'geotiff-import',
                attempt: undefined,
                steps: undefined,
                error: { code: 'apiError.imagery.notTiff', message: 'x' },
            }),
        );

        expect(await failureOf(retry(world))).toMatchObject({ details: { code: 'apiError.imagery.versionState' } });
        expect((await readJob(world, JOB))?.status).toBe('failed');
    });

    it.each([
        ['a job that did not fail', failed({ status: 'running' })],
        ['a layer deletion', failed({ type: 'layer-delete', params: { layerId: 'x' } })],
    ])('badPath_onlyAFailedRasterJobIsRetried_%s', async (_case, job) => {
        const world = await readyWorld();
        await seedJob(world, JOB, job);

        expect(await failureOf(retry(world))).toMatchObject({ details: { code: 'apiError.imagery.versionState' } });
    });

    it('badPath_theBudgetGuardPausesRetries', async () => {
        const world = await readyWorld();
        await seedGuard(world, 'red');
        await seedJob(world, JOB, failed());
        await seedFailedVersion(world);

        expect(await failureOf(retry(world))).toMatchObject({ details: { code: 'apiError.guardPaused' } });
    });

    it('badPath_aJobRetriedMeanwhileIsNotRetriedTwice', async () => {
        const world = await readyWorld();
        await seedJob(world, JOB, failed());
        const original = world.deps.documents.transaction.bind(world.deps.documents);
        world.deps.documents.transaction = (async (work: Parameters<typeof original>[0]) => {
            await seedJob(world, JOB, failed({ status: 'queued' }));
            return original(work);
        }) as typeof original;

        expect(await failureOf(retry(world))).toMatchObject({ details: { code: 'apiError.imagery.versionState' } });
    });

    it('badPath_anUnknownJobIsNotFound', async () => {
        const world = await readyWorld();

        expect(await failureOf(retry(world, 'nope'))).toMatchObject({ code: 'not-found' });
    });

    it('happyPath_aJobWithoutAttemptsOrStepsIsQueued', async () => {
        const world = await readyWorld();
        await seedJob(world, JOB, failed({ attempt: undefined, versionId: undefined, steps: undefined, error: undefined }));
        await seedFailedVersion(world);

        await expect(retry(world)).resolves.toEqual({ status: 'queued', attempt: 0 });
    });
});

describe('imagery.retry of a join (M8)', () => {
    const JOIN = 'jn-1';

    function failedJoin(): Partial<JobDoc> {
        return { status: 'failed', error: { code: 'apiError.imagery.processingFailed', message: 'apiError.imagery.processingFailed' } };
    }

    async function joinFailedOfTwo(world: ImageryWorld, version: Partial<LayerVersionDoc> = {}, job: Partial<JobDoc> = {}) {
        return seedJoinOfTwo(
            world,
            JOIN,
            { state: 'failed', output: undefined, join: undefined, error: { code: 'apiError.imagery.processingFailed' }, ...version },
            { ...failedJoin(), ...job },
        );
    }

    function retryJoin(world: ImageryWorld) {
        return retry(world, JOIN);
    }

    it('happyPath_itsFramesStillItsOwn_itWaitsForTheDispatcher_noWorkerCanClaimIt', async () => {
        const world = await readyWorld();
        await joinFailedOfTwo(world, {}, { runOn: 'local' });

        await expect(retryJoin(world)).resolves.toMatchObject({ status: 'queued' });

        expect(await readJob(world, JOIN)).toMatchObject({ status: 'queued', waitReason: 'parts' });
    });

    it('badPath_aFrameANewerJoinTookRefuses_nothingMoves @S-A65-BAD-RETRY-STALE', async () => {
        const world = await readyWorld();
        await joinFailedOfTwo(world);
        const frame = await requireVersion(world, 'v-f039');
        await seedVersion(world, 'v-f039', { ...frame, partOf: 'jn-2' });

        const failure = await failureOf(retryJoin(world));

        expect(failure.details).toMatchObject({ code: 'apiError.imagery.joinPartTaken', params: { frame: F039 } });
        expect((await readJob(world, JOIN))?.status).toBe('failed');
        expect((await readVersion(world, JOIN))?.state).toBe('failed');
    });

    it('badPath_aFrameReplacedByItsNewPointsRefuses', async () => {
        const world = await readyWorld();
        await joinFailedOfTwo(world);
        const frame = await requireVersion(world, 'v-f040');
        await seedVersion(world, 'v-f040', { ...frame, state: 'cancelled' });

        expect((await failureOf(retryJoin(world))).details).toMatchObject({
            code: 'apiError.imagery.joinPartGone',
            params: { frame: F040 },
        });
    });

    it('happyPath_atPublishAFramePublishedOnItsOwnMeanwhileStillServes_thePublishIsQueued_live1980', async () => {
        const world = await readyWorld();
        const approval = { auto: false, by: 'u-admin', at: at(NOW) };
        await joinFailedOfTwo(
            world,
            { state: 'approved', output: goldenOutput(), error: undefined, approval },
            { steps: { guard: { status: 'done' } } },
        );
        const frame = await requireVersion(world, 'v-f039');
        await seedVersion(world, 'v-f039', {
            ...frame,
            state: 'published',
            mapbox: { tilesetId: 'a.b', origin: 'mts', publishedAt: at(NOW) },
        });

        await expect(retryJoin(world)).resolves.toMatchObject({ status: 'awaiting_approval' });
        expect(world.deps.tasks.queued).toHaveLength(1);
    });

    it('happyPath_atPublishFramesStillWaitingGoBackToThePublisher', async () => {
        const world = await readyWorld();
        const approval = { auto: false, by: 'u-admin', at: at(NOW) };
        await joinFailedOfTwo(
            world,
            { state: 'approved', output: goldenOutput(), error: undefined, approval },
            { steps: { guard: { status: 'done' } } },
        );

        await expect(retryJoin(world)).resolves.toMatchObject({ status: 'awaiting_approval' });

        expect((await readVersion(world, JOIN))?.state).toBe('approved');
    });

    it.each([
        'apiError.imagery.joinSeamTooFar',
        'apiError.imagery.joinNoFrames',
        'apiError.imagery.joinPartMissing',
        'apiError.imagery.joinPartTaken',
    ] as const)('badPath_%sNoRetryCures', async (code) => {
        const world = await readyWorld();
        await joinFailedOfTwo(world, {}, { error: { code, message: code } });

        expect((await failureOf(retryJoin(world))).details).toMatchObject({ code: 'apiError.imagery.versionState' });
    });
});

describe('imagery.retry of a side job (M12)', () => {
    const SIDE = { type: 'layer-tiles', params: { versionId: JOB }, steps: { pyramid: { status: 'failed' } } } as const;

    it('happyPath_itRunsAgainAndItsVersionStaysApproved @S-A71-BAD-FAILED-JOB', async () => {
        const world = await readyWorld();
        await seedJob(world, 'tiles-1', failed(SIDE));
        await seedVersion(world, JOB, renderedVersion({ state: 'approved', approval: { auto: false, by: 'u-admin', at: at(NOW) } }));

        await expect(retry(world, 'tiles-1')).resolves.toMatchObject({ status: 'queued' });

        expect(await readVersion(world, JOB)).toMatchObject({ state: 'approved' });
        expect(world.deps.tasks.queued).toEqual([]);
    });

    it('badPath_notOnceItsVersionEnded @S-A71-BAD-FAILED-JOB', async () => {
        const world = await readyWorld();
        await seedJob(world, 'tiles-1', failed(SIDE));
        await seedVersion(world, JOB, renderedVersion({ state: 'rejected' }));

        expect((await failureOf(retry(world, 'tiles-1'))).details).toMatchObject({ code: 'apiError.imagery.versionState' });
    });
});
