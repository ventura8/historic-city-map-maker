/**
 * The dispatcher (`functions/src/imagery/{dispatch,on-job-write,cancel}.ts`, `docs/research/M3-interfaces.md` §4.2,
 * §4.3): a queued job starts exactly one Cloud Run execution on the machine its camera needs; a redelivered event, the
 * capacity cap and the budget guard start nothing more; a failed run call waits a minute; a cancellation ends what waits
 * and signals what runs; a job reaching `awaiting_approval` gets the approval policy; and a run the pipeline cancelled
 * has what it still held released (CR-M3-18).
 */
import {
    CLOUD_RUN_JOBS,
    FIRESTORE_PATHS,
    JOB_MAX_ATTEMPTS,
    jobLogDocSchema,
    opsDispatchDocSchema,
    timestampFromDate,
    type JobDoc,
} from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { dispatchJob, machineOf } from '../../src/imagery/dispatch.js';
import { releaseCancelled } from '../../src/imagery/end.js';
import { onJobWrite, onJobWriteFunction, placeFreed, transitionOf } from '../../src/imagery/on-job-write.js';
import { cancelAsked } from '../../src/imagery/tick-jobs.js';
import { UpstreamError } from '../../src/ports/errors.js';
import {
    CITY,
    NOW,
    at,
    readJob,
    readLayer,
    readScene,
    readUsage,
    readVersion,
    readyWorld,
    renderedVersion,
    runningJob,
    seedJob,
    seedLayer,
    seedScene,
    seedUsage,
    seedVersion,
    type ImageryWorld,
} from './world.js';

const EXECUTION = 'projects/demo-hcm/locations/us-central1/jobs/raster-pipeline/executions/raster-pipeline-x7k2m';
/** An import's download phase done (finding 56: the small job hands the job over for its processing). */
const DOWNLOADED: JobDoc['steps'] = { fetch: { status: 'done' }, extract: { status: 'done' } };
/** A lease the pipeline holds past `NOW` (its heartbeat is on time). */
const LEASE_HELD = { owner: 'raster-pipeline-x7k2m/0', until: at('2026-10-23T08:05:00.000Z') };

function queued(overrides: Partial<JobDoc> = {}): JobDoc {
    return {
        type: 'usgs-import',
        status: 'queued',
        params: { entityId: 'DS1035-1057DA023', dataset: 'corona2', sensor: 'KH-4A' },
        createdBy: 'u-admin',
        createdAt: at(NOW),
        layerId: 'kh-4a-corona-1966',
        versionId: 'job-1966-0712',
        updatedBy: 'u-admin',
        updatedAt: at(NOW),
        ...overrides,
    };
}

/** Firestore runs conflicting transactions one after the other; the fake runs them as they come, so they are queued. */
function serialiseTransactions(world: ImageryWorld): void {
    const transaction = world.deps.documents.transaction.bind(world.deps.documents);
    let last: Promise<unknown> = Promise.resolve();
    world.deps.documents.transaction = <R>(work: Parameters<typeof transaction<R>>[0]): Promise<R> => {
        const next = last.then(() => transaction(work));
        last = next.catch(() => undefined);
        return next;
    };
}

async function logLines(world: ImageryWorld, jobId: string): Promise<string[]> {
    const lines = await world.deps.documents.query(FIRESTORE_PATHS.jobLogs(CITY, jobId), jobLogDocSchema);
    return lines.documents.map((line) => line.data.message);
}

describe('dispatchJob', () => {
    it('happyPath_aQueuedJobStartsExactlyOneExecution @S-A12-HAPPY-DISPATCH', async () => {
        const world = await readyWorld();
        await seedJob(world, 'job-1966-0712', queued());

        expect(await dispatchJob(world.deps, CITY, 'job-1966-0712')).toBe('started');

        // Finding 56 of 2026-11-01: an import's download runs first on the small job.
        expect(world.jobs.runs).toEqual([
            {
                job: CLOUD_RUN_JOBS.fetch,
                env: { JOB_ID: 'job-1966-0712', CITY_ID: CITY },
                name: 'projects/demo-hcm/locations/us-central1/jobs/raster-fetch/executions/raster-fetch-e2e01',
                options: { args: ['run'] },
            },
        ]);
        expect(await readJob(world, 'job-1966-0712')).toMatchObject({
            status: 'starting',
            machine: 'fetch',
            attempt: 1,
            dispatchAt: at(NOW),
            executionName: world.jobs.runs[0]?.name,
            updatedBy: 'system:imagery',
        });
    });

    it('happyPath_theDownloadHandedOverIsProcessedOnTheStandardJobInTheSameTry @S-A12-HAPPY-DISPATCH-PHASES', async () => {
        const world = await readyWorld();
        await seedJob(world, 'job-1966-0712', queued({ machine: 'fetch', attempt: 1, steps: DOWNLOADED }));

        expect(await dispatchJob(world.deps, CITY, 'job-1966-0712')).toBe('started');

        expect(world.jobs.runs.map((run) => run.job)).toEqual([CLOUD_RUN_JOBS.std]);
        expect(await readJob(world, 'job-1966-0712')).toMatchObject({ status: 'starting', machine: 'std', attempt: 1 });
    });

    it('happyPath_aKh9PanoramicFrameRunsOnTheLargeMachine @S-A12-HAPPY-DISPATCH', async () => {
        const world = await readyWorld();
        const params = { entityId: 'D3C1216-401178F016', dataset: 'declassiii', sensor: 'KH-9-pan' };
        await seedJob(world, 'j-pan', queued({ params, machine: 'fetch', steps: DOWNLOADED }));

        await dispatchJob(world.deps, CITY, 'j-pan');

        expect(world.jobs.runs[0]?.job).toBe(CLOUD_RUN_JOBS.xl);
        expect((await readJob(world, 'j-pan'))?.machine).toBe('xl');
    });

    it.each([
        ['an import still to download', { params: { sensor: 'KH-9-pan' } }, 'fetch'],
        ['an import whose download ran out of memory on the small job', { machine: 'std' as const }, 'std'],
        ['a KH-4A frame downloaded', { params: { sensor: 'KH-4A' }, steps: DOWNLOADED }, 'std'],
        ['an upload (no camera, no download)', { type: 'geotiff-import' as const, params: { uploadPath: 'x' } }, 'std'],
        ['an unknown camera', { params: { sensor: 'KH-99' }, steps: DOWNLOADED }, 'std'],
        ['a job that ran out of memory', { machine: 'xl' as const, params: {} }, 'xl'],
    ])('machineOf_%s', (_case, overrides, machine) => {
        expect(machineOf(queued(overrides))).toBe(machine);
    });

    it('happyPath_aRedeliveredTriggerStartsNothingMore @S-A12-HAPPY-DISPATCH', async () => {
        const world = await readyWorld();
        const job = queued();
        await seedJob(world, 'job-1966-0712', job);

        const first = await onJobWrite(world.deps, CITY, 'job-1966-0712', { before: undefined, after: job });
        const again = await onJobWrite(world.deps, CITY, 'job-1966-0712', { before: undefined, after: job });

        expect([first, again]).toEqual(['dispatch', 'dispatch']);
        expect(world.jobs.runs).toHaveLength(1);
    });

    it('badPath_aThirdJobWaitsForCapacity @S-A12-HAPPY-DISPATCH', async () => {
        const world = await readyWorld();
        await seedJob(world, 'running-1', queued({ status: 'running', lease: LEASE_HELD }));
        await seedJob(world, 'starting-1', queued({ status: 'starting' }));
        await seedJob(world, 'third', queued());

        expect(await dispatchJob(world.deps, CITY, 'third')).toBe('waiting');
        expect(await dispatchJob(world.deps, CITY, 'third')).toBe('waiting');

        expect(await readJob(world, 'third')).toMatchObject({ status: 'queued', waitReason: 'capacity' });
        expect(world.jobs.runs).toEqual([]);
    });

    it('badPath_dispatchersRacingForTheLastPlaceStartOneRun @S-A12-BAD-RACING-DISPATCH', async () => {
        const world = await readyWorld();
        await seedJob(world, 'running-1', queued({ status: 'running', lease: LEASE_HELD }));
        await seedJob(world, 'a', queued());
        await seedJob(world, 'b', queued());
        // Two trigger instances at once: both count the running jobs before either transaction commits (Firestore
        // serialises the transactions themselves: the second one retries and reads what the first wrote).
        serialiseTransactions(world);

        const outcomes = await Promise.all([dispatchJob(world.deps, CITY, 'a'), dispatchJob(world.deps, CITY, 'b')]);

        expect(outcomes.sort((left, right) => left.localeCompare(right))).toEqual(['started', 'waiting']);
        expect(world.jobs.runs).toHaveLength(1);
        expect(Object.keys((await world.deps.documents.get(FIRESTORE_PATHS.opsDispatch, opsDispatchDocSchema))?.slots ?? {})).toHaveLength(
            1,
        );
    });

    it('happyPath_aSlotWhoseRunEndedOrWhoseCityIsGoneIsFreedByTheNextDispatch @S-A12-BAD-RACING-DISPATCH', async () => {
        const world = await readyWorld();
        await world.deps.documents.set(FIRESTORE_PATHS.opsDispatch, opsDispatchDocSchema, {
            slots: { [`${CITY}/ended`]: { at: at(NOW) }, ['retired-city/run']: { at: at(NOW) } },
            updatedBy: 'system:imagery',
            updatedAt: at(NOW),
        });
        await seedJob(world, 'ended', queued({ status: 'succeeded' }));
        await seedJob(world, 'next', queued());

        expect(await dispatchJob(world.deps, CITY, 'next')).toBe('started');
        expect((await world.deps.documents.get(FIRESTORE_PATHS.opsDispatch, opsDispatchDocSchema))?.slots).toEqual({
            [`${CITY}/next`]: { at: at(NOW) },
        });
    });

    it('happyPath_aRunWhoseLeaseLapsedHoldsNoCapacity', async () => {
        const world = await readyWorld();
        await seedJob(world, 'lost', queued({ status: 'running', lease: { ...LEASE_HELD, until: at('2026-10-23T07:59:00.000Z') } }));
        await seedJob(world, 'never-leased', queued({ status: 'running' }));
        await seedJob(world, 'starting-1', queued({ status: 'starting' }));
        await seedJob(world, 'third', queued());

        expect(await dispatchJob(world.deps, CITY, 'third')).toBe('started');
        expect(world.jobs.runs).toHaveLength(1);
    });
});

describe('dispatchJob: what does not start', () => {
    it('badPath_aFailedRunCallWaitsAMinuteAndSaysSo', async () => {
        const world = await readyWorld();
        await seedJob(world, 'job-1966-0712', queued());
        world.jobs.recorder.failNext('run', new UpstreamError('cloud-run', 'unavailable', { status: 503 }));

        expect(await dispatchJob(world.deps, CITY, 'job-1966-0712')).toBe('failed');

        expect(await readJob(world, 'job-1966-0712')).toMatchObject({
            status: 'queued',
            attempt: 1,
            retryAt: timestampFromDate(new Date(Date.parse(NOW) + 60_000)),
        });
        expect(await logLines(world, 'job-1966-0712')).toEqual([expect.stringContaining('retrying in a minute')]);
        expect(await dispatchJob(world.deps, CITY, 'job-1966-0712')).toBe('not-due');
    });

    it('badPath_aJobPastItsAttemptsFails', async () => {
        const world = await readyWorld();
        await seedJob(world, 'job-1966-0712', queued({ attempt: JOB_MAX_ATTEMPTS }));
        await seedVersion(world, 'job-1966-0712', renderedVersion({ state: 'processing', output: undefined }));

        expect(await dispatchJob(world.deps, CITY, 'job-1966-0712')).toBe('failed');

        expect(await readJob(world, 'job-1966-0712')).toMatchObject({
            status: 'failed',
            error: { code: 'apiError.imagery.attemptsExhausted', params: { attempts: '3' } },
        });
        expect(await readVersion(world, 'job-1966-0712')).toMatchObject({
            state: 'failed',
            error: { code: 'apiError.imagery.attemptsExhausted' },
        });
    });

    it('happyPath_aRepublishGoesToThePublisherAndADeletionWaitsForTheTick', async () => {
        const world = await readyWorld();
        await seedJob(world, 'rp', queued({ type: 'republish', params: { versionId: 'job-1966-0712' } }));
        await seedJob(world, 'ld', queued({ type: 'layer-delete', params: { layerId: 'old' } }));

        expect(await dispatchJob(world.deps, CITY, 'rp')).toBe('publish');
        expect(await dispatchJob(world.deps, CITY, 'ld')).toBe('skipped');

        expect(world.deps.tasks.queued).toEqual([
            {
                queue: 'imagery-publish',
                payload: { cityId: CITY, jobId: 'rp', phase: 'start', poll: 0 },
                options: { id: `${CITY}-rp-republish` },
            },
        ]);
        expect(world.jobs.runs).toEqual([]);
    });

    it.each([
        ['a job that is not queued', queued({ status: 'running' })],
        ['a job whose admin asked it to stop', queued({ cancelRequested: true })],
    ])('badPath_nothingStarts_%s', async (_case, job) => {
        const world = await readyWorld();
        await seedJob(world, 'j', job);

        expect(await dispatchJob(world.deps, CITY, 'j')).toBe('skipped');
        expect(await dispatchJob(world.deps, CITY, 'missing')).toBe('skipped');
        expect(world.jobs.runs).toEqual([]);
    });

    it('badPath_aJobTakenMeanwhileIsNotStartedTwice', async () => {
        const world = await readyWorld();
        await seedJob(world, 'j', queued({ status: 'starting' }));
        const stored = world.deps.documents.get.bind(world.deps.documents);
        let reads = 0;
        // The dispatcher's first read still sees the job queued; its transaction finds another dispatch took it.
        world.deps.documents.get = ((path: string, schema: Parameters<typeof stored>[1]) => {
            reads += 1;
            return reads === 1 ? Promise.resolve(queued()) : stored(path, schema);
        }) as typeof stored;

        expect(await dispatchJob(world.deps, CITY, 'j')).toBe('skipped');
        expect(world.jobs.runs).toEqual([]);
    });
});

describe('onJobWrite', () => {
    it.each([
        ['a new queued job', undefined, queued(), 'dispatch'],
        ['a retry back to queued', queued({ status: 'failed' }), queued(), 'dispatch'],
        ['a cancellation', queued(), queued({ cancelRequested: true }), 'cancel'],
        ['a cancellation and a status change at once', queued({ status: 'running' }), queued({ cancelRequested: true }), 'cancel'],
        ['a rendered version', queued({ status: 'running' }), queued({ status: 'awaiting_approval' }), 'approval'],
        ['a heartbeat', queued({ status: 'running' }), queued({ status: 'running', progress: 0.5 }), 'none'],
        ['a wait reason on a queued job', queued(), queued({ waitReason: 'capacity' }), 'none'],
        [
            'a run the pipeline cancelled',
            queued({ status: 'running', cancelRequested: true }),
            queued({ status: 'cancelled', cancelRequested: true }),
            'release',
        ],
        ['a run that failed in a step', queued({ status: 'running' }), queued({ status: 'failed' }), 'release'],
        ['another write of a cancelled job', queued({ status: 'cancelled' }), queued({ status: 'cancelled', progress: 1 }), 'none'],
    ] as const)('transitionOf_%s', (_case, before, after, transition) => {
        expect(transitionOf(before, after)).toBe(transition);
    });

    it('happyPath_aRunThatEndsStartsTheJobWaitingForItsPlaceAtOnce @S-A12-HAPPY-FREED-PLACE', async () => {
        // 2026-11-12 (reports/resource-audit.md item 9): the tick runs every 15 minutes; a job waiting for capacity does not wait for it.
        const world = await readyWorld();
        const running = queued({ status: 'running', lease: LEASE_HELD });
        await seedJob(world, 'running-1', running);
        await seedJob(world, 'running-2', running);
        await seedJob(world, 'third', queued());
        expect(await dispatchJob(world.deps, CITY, 'third')).toBe('waiting');
        const ended = { ...running, status: 'succeeded' as const };
        await seedJob(world, 'running-1', ended);

        expect(await onJobWrite(world.deps, CITY, 'running-1', { before: running, after: ended })).toBe('none');

        expect(world.jobs.runs).toHaveLength(1);
        expect(await readJob(world, 'third')).toMatchObject({ status: 'starting' });
    });

    it.each([
        ['a heartbeat', queued({ status: 'running', lease: LEASE_HELD }), queued({ status: 'running', lease: LEASE_HELD, progress: 0.5 })],
        ['a start', queued({ status: 'starting' }), queued({ status: 'running', lease: LEASE_HELD })],
        ['a new job that ended', undefined, queued({ status: 'succeeded' })],
    ] as const)('badPath_%sFreesNoPlaceAndStartsNothing @S-A12-BAD-NO-FREED-PLACE', async (_case, before, after) => {
        const world = await readyWorld();
        await seedJob(world, 'running-2', queued({ status: 'running', lease: LEASE_HELD }));
        await seedJob(world, 'third', queued({ waitReason: 'capacity' }));

        expect(placeFreed(before, after)).toBe(false);
        await onJobWrite(world.deps, CITY, 'running-1', { before, after });

        expect(world.jobs.runs).toEqual([]);
        expect(await readJob(world, 'third')).toMatchObject({ status: 'queued' });
    });

    it.each([
        ['a run that succeeded', 'running', 'succeeded'],
        ['a run that failed', 'running', 'failed'],
        ['a start that went back to a USGS wait', 'starting', 'waiting_usgs'],
        ['a rendered version', 'running', 'awaiting_approval'],
        ['a lost run requeued', 'running', 'queued'],
    ] as const)('placeFreed_%s', (_case, from, to) => {
        expect(placeFreed(queued({ status: from }), queued({ status: to }))).toBe(true);
    });

    it('badPath_aQueuedJobThatCannotBeDispatchedIsLoggedAndTheOthersStillAre @S-A12-BAD-NO-FREED-PLACE', async () => {
        const world = await readyWorld();
        const running = queued({ status: 'running', lease: LEASE_HELD });
        await seedJob(world, 'rp', queued({ type: 'republish', params: { versionId: 'job-1966-0712' } }));
        await seedJob(world, 'next', queued());
        world.deps.tasks.recorder.failNext('enqueue', new Error('queue down'));

        await onJobWrite(world.deps, CITY, 'ended', { before: running, after: { ...running, status: 'failed' } });

        expect(world.deps.recording.records.map((record) => record.message)).toContain('queued job not dispatched');
        expect(world.jobs.runs).toHaveLength(1);
        expect(await readJob(world, 'next')).toMatchObject({ status: 'starting' });
    });

    it('badPath_anInvalidOrDeletedJobAndABadCityAreIgnored', async () => {
        const world = await readyWorld();

        expect(await onJobWrite(world.deps, CITY, 'j', { before: queued(), after: undefined })).toBe('none');
        expect(await onJobWrite(world.deps, CITY, 'j', { before: undefined, after: { status: 'queued' } })).toBe('none');
        expect(await onJobWrite(world.deps, 'Not A City', 'j', { before: undefined, after: queued() })).toBe('none');
        expect(world.jobs.runs).toEqual([]);
    });

    it('happyPath_theTriggerReadsTheEventsSnapshots', async () => {
        const world = await readyWorld();
        await seedJob(world, 'job-1966-0712', queued());
        const snapshot = (data: unknown) => ({ data: () => data });
        const event = { params: { city: CITY, id: 'job-1966-0712' }, data: { before: snapshot(undefined), after: snapshot(queued()) } };

        await onJobWriteFunction(() => world.deps).run(event as unknown as Parameters<ReturnType<typeof onJobWriteFunction>['run']>[0]);

        expect(world.jobs.runs).toHaveLength(1);
        expect(onJobWriteFunction(() => world.deps).__endpoint).toMatchObject({
            serviceAccountEmail: 'fn-events@demo-hcm.iam.gserviceaccount.com',
            maxInstances: 5,
        });
    });
});

describe('cancel', () => {
    async function waitingWorld(status: JobDoc['status']): Promise<ImageryWorld> {
        const world = await readyWorld();
        await seedJob(world, 'job-1966-0712', queued({ status }));
        await seedVersion(
            world,
            'job-1966-0712',
            renderedVersion({ state: status === 'awaiting_gcps' ? 'needs_gcps' : 'awaiting_approval' }),
        );
        await seedScene(world, 'DS1035-1057DA023', { status: 'imported', layerId: 'kh-4a-corona-1966' });
        await seedUsage(world, '2026-10', {
            reservations: { 'job-1966-0712': { computeUnits: 3, at: at(NOW) }, other: { computeUnits: 1, at: at(NOW) } },
        });
        return world;
    }

    it.each(['queued', 'waiting_usgs', 'awaiting_gcps', 'awaiting_approval'] as const)(
        'happyPath_aWaitingJobEndsAtOnceAndReleasesWhatItHeld_%s',
        async (status) => {
            const world = await waitingWorld(status);

            await onJobWrite(world.deps, CITY, 'job-1966-0712', {
                before: queued({ status }),
                after: queued({ status, cancelRequested: true }),
            });

            expect(await readJob(world, 'job-1966-0712')).toMatchObject({ status: 'cancelled', finishedAt: at(NOW) });
            expect((await readVersion(world, 'job-1966-0712'))?.state).toBe('cancelled');
            expect(await readScene(world, 'DS1035-1057DA023')).toMatchObject({ status: 'candidate' });
            expect((await readScene(world, 'DS1035-1057DA023'))?.layerId).toBeUndefined();
            expect((await readUsage(world, '2026-10'))?.reservations).toEqual({ other: { computeUnits: 1, at: at(NOW) } });
        },
    );

    it('happyPath_aReplacementThatIsCancelledLeavesTheLayerAsItWas', async () => {
        const world = await waitingWorld('awaiting_approval');
        await seedLayer(world, 'kh-4a-corona-1966', { pendingVersion: 'job-1966-0712', currentVersion: 'v-first' });

        await onJobWrite(world.deps, CITY, 'job-1966-0712', { before: queued(), after: queued({ cancelRequested: true }) });

        const layer = await readLayer(world, 'kh-4a-corona-1966');
        expect(layer?.pendingVersion).toBeUndefined();
        expect(layer?.currentVersion).toBe('v-first');
        expect((await readScene(world, 'DS1035-1057DA023'))?.status).toBe('imported');
    });

    it('happyPath_aRunningJobsExecutionIsCancelledAndThePipelineFinishesIt', async () => {
        const world = await readyWorld();
        await seedJob(world, 'j', queued({ status: 'running', executionName: EXECUTION }));

        await onJobWrite(world.deps, CITY, 'j', {
            before: queued({ status: 'running' }),
            after: queued({ status: 'running', cancelRequested: true }),
        });

        expect(world.jobs.cancelled).toEqual([EXECUTION]);
        expect((await readJob(world, 'j'))?.status).toBe('running');
    });

    it.each([
        ['a start without its execution yet', queued({ status: 'starting' }), undefined],
        [
            'a cancel call that failed',
            queued({ status: 'running', executionName: EXECUTION }),
            new UpstreamError('cloud-run', 'unavailable'),
        ],
    ])('badPath_nothingMoreHappens_%s', async (_case, job, failure) => {
        const world = await readyWorld();
        await seedJob(world, 'j', job);
        if (failure !== undefined) {
            world.jobs.recorder.failNext('cancel', failure);
        }

        await onJobWrite(world.deps, CITY, 'j', { before: job, after: { ...job, cancelRequested: true } });

        expect((await readJob(world, 'j'))?.status).toBe(job.status);
        expect(world.jobs.cancelled).toEqual([]);
    });

    it('badPath_mapboxProcessingCannotBeCancelled', async () => {
        const world = await readyWorld();
        const atMapbox = queued({ status: 'mts_processing', mapboxJobId: 'mts-job-1' });
        await seedJob(world, 'j', atMapbox);

        await onJobWrite(world.deps, CITY, 'j', { before: atMapbox, after: { ...atMapbox, cancelRequested: true } });

        expect((await readJob(world, 'j'))?.status).toBe('mts_processing');
        expect(await logLines(world, 'j')).toEqual(['apiError.imagery.mapboxFinishing']);
    });

    it('happyPath_aPublishThatHasNotReachedMapboxIsCancelled @S-A12-BAD-CANCEL-BEFORE-MAPBOX', async () => {
        const world = await readyWorld();
        await seedJob(world, 'j', queued({ status: 'mts_processing', cancelRequested: true }));

        await cancelAsked(world.deps, CITY);

        expect((await readJob(world, 'j'))?.status).toBe('cancelled');
        expect(await logLines(world, 'j')).toEqual([]);
    });

    it('badPath_aFinishedOrMissingJobIsLeftAlone', async () => {
        const world = await readyWorld();
        await seedJob(world, 'done', queued({ status: 'succeeded' }));

        await onJobWrite(world.deps, CITY, 'done', {
            before: queued({ status: 'succeeded' }),
            after: queued({ status: 'succeeded', cancelRequested: true }),
        });
        await onJobWrite(world.deps, CITY, 'gone', { before: queued(), after: queued({ cancelRequested: true }) });

        expect((await readJob(world, 'done'))?.status).toBe('succeeded');
        expect(await readJob(world, 'gone')).toBeUndefined();
    });
});

describe('release (CR-M3-18)', () => {
    const running = runningJob({ cancelRequested: true });
    const cancelled = queued({ status: 'cancelled', cancelRequested: true, finishedAt: at(NOW) });

    it('happyPath_aFirstImportThePipelineCancelledFreesItsScene', async () => {
        const world = await readyWorld();
        await seedJob(world, 'job-1966-0712', cancelled);
        await seedVersion(world, 'job-1966-0712', renderedVersion({ state: 'processing' }));
        await seedScene(world, 'DS1035-1057DA023', { status: 'imported', layerId: 'kh-4a-corona-1966' });

        expect(await onJobWrite(world.deps, CITY, 'job-1966-0712', { before: running, after: cancelled })).toBe('release');

        expect((await readVersion(world, 'job-1966-0712'))?.state).toBe('cancelled');
        expect(await readScene(world, 'DS1035-1057DA023')).toMatchObject({ status: 'candidate' });
        expect((await readScene(world, 'DS1035-1057DA023'))?.layerId).toBeUndefined();
        expect((await readJob(world, 'job-1966-0712'))?.updatedBy).toBe('u-admin');
    });

    it('happyPath_aReplacementThePipelineCancelledLeavesTheLayerAsItWas', async () => {
        const world = await readyWorld();
        await seedJob(world, 'job-1966-0712', cancelled);
        await seedVersion(world, 'job-1966-0712', renderedVersion({ state: 'cancelled' }));
        await seedLayer(world, 'kh-4a-corona-1966', { pendingVersion: 'job-1966-0712', currentVersion: 'v-first' });

        await onJobWrite(world.deps, CITY, 'job-1966-0712', { before: running, after: cancelled });

        const layer = await readLayer(world, 'kh-4a-corona-1966');
        expect(layer?.pendingVersion).toBeUndefined();
        expect(layer?.currentVersion).toBe('v-first');
    });

    it('badPath_aFirstImportReplacedByARegeoreferenceKeepsItsScene @S-A16-BAD-REGEOREF-KEEPS-SCENE', async () => {
        const world = await readyWorld();
        await seedJob(world, 'job-1966-0712', cancelled);
        await seedVersion(world, 'job-1966-0712', renderedVersion({ state: 'cancelled' }));
        // The re-georeference that replaced it holds the same layer id, still unfinished.
        await seedVersion(
            world,
            'rg-new',
            renderedVersion({ jobId: 'rg-new', origin: 'regeoref', basedOn: 'job-1966-0712', state: 'processing' }),
        );
        await seedScene(world, 'DS1035-1057DA023', { status: 'imported', layerId: 'kh-4a-corona-1966' });

        await onJobWrite(world.deps, CITY, 'job-1966-0712', { before: running, after: cancelled });

        expect(await readScene(world, 'DS1035-1057DA023')).toMatchObject({ status: 'imported', layerId: 'kh-4a-corona-1966' });
    });

    it('happyPath_aJoinThatFailedFreesItsLayerForTheNextJoin', async () => {
        const world = await readyWorld();
        const failed = queued({ status: 'failed', finishedAt: at(NOW) });
        await seedJob(world, 'job-1966-0712', failed);
        await seedVersion(
            world,
            'job-1966-0712',
            renderedVersion({ state: 'failed', error: { code: 'apiError.imagery.processingFailed' } }),
        );
        await seedScene(world, 'DS1035-1057DA023', { status: 'imported', layerId: 'kh-4a-corona-1966' });
        await seedLayer(world, 'kh-4a-corona-1966', { pendingVersion: 'job-1966-0712', currentVersion: 'v-first' });

        expect(await onJobWrite(world.deps, CITY, 'job-1966-0712', { before: runningJob(), after: failed })).toBe('release');

        expect((await readLayer(world, 'kh-4a-corona-1966'))?.pendingVersion).toBeUndefined();
        // A failure may be retried: its scene stays imported.
        expect(await readScene(world, 'DS1035-1057DA023')).toMatchObject({ status: 'imported' });
    });

    it('badPath_aRedeliveredOrStaleEventReleasesNothingMore', async () => {
        const world = await readyWorld();
        await seedJob(world, 'job-1966-0712', cancelled);
        await seedVersion(world, 'job-1966-0712', renderedVersion({ state: 'cancelled' }));
        await seedJob(world, 'requeued', queued());

        expect(await releaseCancelled(world.deps, CITY, 'job-1966-0712')).toBe(false);
        expect(await releaseCancelled(world.deps, CITY, 'requeued')).toBe(false);
        expect(await releaseCancelled(world.deps, CITY, 'gone')).toBe(false);
        expect((await readJob(world, 'requeued'))?.status).toBe('queued');
    });
});
