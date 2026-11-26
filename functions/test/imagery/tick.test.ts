/**
 * `imagery.tick` (`functions/src/imagery/{tick,tick-jobs,tick-maintenance}.ts`, `docs/research/M3-interfaces.md` §4.5,
 * §4.6): every fifteen minutes (every five until 2026-11-12), per city and part by part, due jobs are dispatched, lost
 * executions recovered (out of memory on `std` → again on `xl`; past the attempts → failed), the cancellations, approvals and
 * polls a lost event left behind caught up, deferred publishes started, long-ended versions' files swept and the monthly
 * harvest run; while the budget guard is red only what ends or recovers work runs.
 */
import {
    CLOUD_RUN_JOBS,
    FIRESTORE_PATHS,
    JOB_MAX_ATTEMPTS,
    USGS_DATASETS,
    harvestStateDocSchema,
    timestampFromDate,
    type JobDoc,
} from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { lostAction } from '../../src/imagery/tick-jobs.js';
import { runImageryTick, tickFunction } from '../../src/imagery/tick.js';
import { UpstreamError } from '../../src/ports/errors.js';
import { sceneRecord } from '../support/imagery-fakes.js';
import {
    CITY,
    NOW,
    at,
    readJob,
    readVersion,
    readyWorld,
    renderedVersion,
    seedGuard,
    seedJob,
    seedScene,
    seedSetup,
    seedVersion,
    type ImageryWorld,
} from './world.js';

const EXECUTION = 'projects/demo-hcm/locations/us-central1/jobs/raster-pipeline/executions/raster-pipeline-x7k2m';
const MINUTE = 60_000;

function minutesAgo(minutes: number) {
    return timestampFromDate(new Date(Date.parse(NOW) - minutes * MINUTE));
}

function job(overrides: Partial<JobDoc> = {}): JobDoc {
    return {
        type: 'usgs-import',
        status: 'running',
        params: { entityId: 'DS1035-1057DA023', dataset: 'corona2', sensor: 'KH-4A' },
        createdBy: 'u-admin',
        createdAt: minutesAgo(120),
        layerId: 'kh-4a-corona-1966',
        versionId: 'job-1966-0712',
        machine: 'std',
        attempt: 1,
        executionName: EXECUTION,
        lease: { owner: 'raster-pipeline-x7k2m/0', until: minutesAgo(5) },
        updatedBy: 'system:pipeline',
        updatedAt: minutesAgo(15),
        ...overrides,
    };
}

function harvestState(world: ImageryWorld) {
    return world.deps.documents.get(FIRESTORE_PATHS.harvestState(CITY), harvestStateDocSchema);
}

async function lostWorld(
    overrides: Partial<JobDoc>,
    status: Parameters<ImageryWorld['jobs']['statuses']['set']>[1],
): Promise<ImageryWorld> {
    const world = await readyWorld();
    await seedJob(world, 'job-1966-0712', job(overrides));
    await seedVersion(world, 'job-1966-0712', renderedVersion({ state: 'processing', output: undefined }));
    world.jobs.statuses.set(EXECUTION, status);
    return world;
}

describe('lost executions', () => {
    it('badPath_anOutOfMemoryExitOnStdRunsAgainOnXl @S-A12-BAD-LOST-EXECUTION', async () => {
        const world = await lostWorld({}, { state: 'failed', failure: 'oom', exitCode: 137 });

        await runImageryTick(world.deps);

        expect(world.jobs.runs.map((run) => run.job)).toEqual([CLOUD_RUN_JOBS.xl]);
        expect(await readJob(world, 'job-1966-0712')).toMatchObject({ status: 'starting', machine: 'xl', attempt: 2 });
        expect((await readJob(world, 'job-1966-0712'))?.lease).toBeUndefined();
    });

    it('badPath_anOutOfMemoryExitOfTheDownloadRunsItAgainOnStd @S-A12-BAD-PHASE-OUT-OF-MEMORY', async () => {
        const world = await lostWorld({ machine: 'fetch' }, { state: 'failed', failure: 'oom', exitCode: 137 });

        await runImageryTick(world.deps);

        expect(world.jobs.runs.map((run) => run.job)).toEqual([CLOUD_RUN_JOBS.std]);
        expect(await readJob(world, 'job-1966-0712')).toMatchObject({ status: 'starting', machine: 'std', attempt: 2 });
    });

    it('badPath_anOutOfMemoryExitOfTheProcessingMovesToXlWithoutDownloadingAgain @S-A12-BAD-PHASE-OUT-OF-MEMORY', async () => {
        const downloaded = {
            fetch: { status: 'done' as const },
            extract: { status: 'done' as const },
            stitch: { status: 'running' as const },
        };
        const world = await lostWorld({ steps: downloaded }, { state: 'failed', failure: 'oom', exitCode: 137 });

        await runImageryTick(world.deps);

        expect(world.jobs.runs.map((run) => run.job)).toEqual([CLOUD_RUN_JOBS.xl]);
        expect(await readJob(world, 'job-1966-0712')).toMatchObject({
            machine: 'xl',
            steps: { fetch: { status: 'done' }, extract: { status: 'done' } },
        });
    });

    it('happyPath_aDeadExecutionIsNoticedBeforeItsLeaseLapses @S-A12-HAPPY-DEAD-EXECUTION-NOTICED', async () => {
        // Finding 58 of 2026-11-01: killed for its memory (signal 9), the run wrote nothing more; its lease still holds.
        const held = { owner: 'raster-pipeline-x7k2m/0', until: minutesAgo(-6) };
        const world = await lostWorld(
            { machine: 'xl', attempt: 2, lease: held, updatedAt: minutesAgo(4) },
            { state: 'failed', failure: 'oom' },
        );

        await runImageryTick(world.deps);

        expect(await readJob(world, 'job-1966-0712')).toMatchObject({ status: 'failed', error: { code: 'apiError.imagery.outOfMemory' } });
        expect((await readVersion(world, 'job-1966-0712'))?.state).toBe('failed');
    });

    it('badPath_aLateHeartbeatOfARunStillRunningIsLeftAlone @S-A12-BAD-HEARTBEAT-LATE-RUNNING', async () => {
        const held = { owner: 'raster-pipeline-x7k2m/0', until: minutesAgo(-6) };
        const late = await lostWorld({ lease: held, updatedAt: minutesAgo(4) }, { state: 'running' });
        await runImageryTick(late.deps);
        const onTime = await lostWorld({ lease: held, updatedAt: minutesAgo(1) }, { state: 'failed', failure: 'oom' });
        await runImageryTick(onTime.deps);

        expect([(await readJob(late, 'job-1966-0712'))?.status, (await readJob(onTime, 'job-1966-0712'))?.status]).toEqual([
            'running',
            'running',
        ]);
        expect([...late.jobs.runs, ...onTime.jobs.runs]).toEqual([]);
    });

    it('badPath_outOfMemoryOnXlFails @S-A12-BAD-LOST-EXECUTION', async () => {
        const world = await lostWorld({ machine: 'xl', attempt: 2 }, { state: 'failed', failure: 'oom' });

        await runImageryTick(world.deps);

        expect(await readJob(world, 'job-1966-0712')).toMatchObject({ status: 'failed', error: { code: 'apiError.imagery.outOfMemory' } });
        expect((await readVersion(world, 'job-1966-0712'))?.state).toBe('failed');
        expect(world.jobs.runs).toEqual([]);
    });

    it('badPath_pastTheAttemptsItGivesUp @S-A12-BAD-LOST-EXECUTION', async () => {
        const world = await lostWorld({ attempt: JOB_MAX_ATTEMPTS }, { state: 'failed', failure: 'exit', exitCode: 1 });

        await runImageryTick(world.deps);

        expect(await readJob(world, 'job-1966-0712')).toMatchObject({
            status: 'failed',
            error: { code: 'apiError.imagery.attemptsExhausted', params: { attempts: '3' } },
        });
    });

    it('happyPath_aSlowHeartbeatIsLeftAloneForAnotherLease', async () => {
        const world = await lostWorld({}, { state: 'running' });

        await runImageryTick(world.deps);

        expect((await readJob(world, 'job-1966-0712'))?.status).toBe('running');
        expect(world.jobs.recorder.argsOf('get')).toEqual([[EXECUTION]]);
    });

    it('happyPath_aLeaseThatHoldsIsNotAsked', async () => {
        const world = await lostWorld(
            { lease: { owner: 'x/0', until: timestampFromDate(new Date(Date.parse(NOW) + MINUTE)) }, updatedAt: minutesAgo(1) },
            { state: 'failed' },
        );

        await runImageryTick(world.deps);

        expect(world.jobs.recorder.argsOf('get')).toEqual([]);
    });

    it('happyPath_aCancelledExecutionCancelsItsJob', async () => {
        const world = await lostWorld({ cancelRequested: true }, { state: 'cancelled' });

        await runImageryTick(world.deps);

        expect(await readJob(world, 'job-1966-0712')).toMatchObject({ status: 'cancelled' });
    });

    it('happyPath_anExecutionNeverNamedIsRunAgain', async () => {
        const world = await lostWorld({ executionName: undefined, lease: undefined }, { state: 'running' });

        await runImageryTick(world.deps);

        expect(await readJob(world, 'job-1966-0712')).toMatchObject({ status: 'starting', machine: 'std', attempt: 2 });
    });

    it.each([
        ['still running', job(), { state: 'running' as const }, 'wait'],
        ['cancelled', job(), { state: 'cancelled' as const }, 'cancel'],
        ['asked to stop and failed', job({ cancelRequested: true }), { state: 'failed' as const }, 'cancel'],
        ['succeeded without registering', job(), { state: 'succeeded' as const }, 'requeue'],
    ])('lostAction_%s', (_case, lost, status, kind) => {
        expect(lostAction(lost, status).kind).toBe(kind);
    });
});

describe('dispatch and waits', () => {
    it('happyPath_aUsgsWaitPastItsTimeIsResumed', async () => {
        const world = await readyWorld();
        await seedJob(
            world,
            'due',
            job({ status: 'waiting_usgs', waitReason: 'usgs-preparing', retryAt: minutesAgo(1), lease: undefined }),
        );
        await seedJob(
            world,
            'later',
            job({ status: 'waiting_usgs', retryAt: timestampFromDate(new Date(Date.parse(NOW) + MINUTE)), lease: undefined }),
        );

        await runImageryTick(world.deps);

        expect(await readJob(world, 'due')).toMatchObject({ status: 'starting', attempt: 2 });
        expect((await readJob(world, 'due'))?.waitReason).toBeUndefined();
        expect((await readJob(world, 'later'))?.status).toBe('waiting_usgs');
    });

    it('happyPath_aStaleStartIsDispatchedAgain', async () => {
        const world = await readyWorld();
        await seedJob(world, 'stale', job({ status: 'starting', executionName: undefined, lease: undefined, dispatchAt: minutesAgo(11) }));
        await seedJob(world, 'fresh', job({ status: 'starting', executionName: undefined, lease: undefined, dispatchAt: minutesAgo(2) }));

        await runImageryTick(world.deps);

        expect(await readJob(world, 'stale')).toMatchObject({ status: 'starting', attempt: 2, executionName: world.jobs.runs[0]?.name });
        expect(await readJob(world, 'fresh')).toMatchObject({ status: 'starting', attempt: 1 });
    });

    it('happyPath_cancellationsAndApprovalsALostEventLeftAreCaughtUp', async () => {
        const world = await readyWorld();
        await seedJob(world, 'asked', job({ status: 'awaiting_gcps', cancelRequested: true, lease: undefined, versionId: 'v-asked' }));
        await seedJob(world, 'job-1966-0712', job({ status: 'awaiting_approval', lease: undefined }));
        await seedVersion(world, 'job-1966-0712', renderedVersion());
        await seedJob(world, 'evaluated', job({ status: 'awaiting_approval', lease: undefined, versionId: 'v-evaluated' }));
        await seedVersion(
            world,
            'v-evaluated',
            renderedVersion({ jobId: 'evaluated', estimate: { computeUnits: 1, precision: '30cm', areaKm2: 25, at: at(NOW) } }),
        );

        await runImageryTick(world.deps);

        expect((await readJob(world, 'asked'))?.status).toBe('cancelled');
        expect((await readVersion(world, 'job-1966-0712'))?.estimate).toMatchObject({ computeUnits: 24.5, precision: '30cm' });
        expect((await readVersion(world, 'v-evaluated'))?.estimate?.computeUnits).toBe(1);
    });

    it('happyPath_mapboxJobsWhosePollWentMissingArePolledAgain', async () => {
        const world = await readyWorld();
        await seedJob(
            world,
            'polled',
            job({ status: 'mts_processing', lease: undefined, mapboxJobId: 'mts-1', updatedAt: minutesAgo(30) }),
        );
        await seedJob(world, 'unpublished', job({ status: 'mts_processing', lease: undefined, updatedAt: minutesAgo(30) }));
        await seedJob(world, 'recent', job({ status: 'mts_processing', lease: undefined, mapboxJobId: 'mts-2', updatedAt: minutesAgo(5) }));

        await runImageryTick(world.deps);

        expect(world.deps.tasks.queued.map((task) => task.payload)).toEqual([
            { cityId: CITY, jobId: 'polled', phase: 'poll', poll: 3 },
            { cityId: CITY, jobId: 'unpublished', phase: 'start', poll: 0 },
        ]);
    });

    it('badPath_aJobThatStaysStaleIsQueuedOnceNotOnEveryTick @S-A42-BAD-DUPLICATE-PUBLISH', async () => {
        const world = await readyWorld();
        await seedJob(world, 'unpublished', job({ status: 'mts_processing', lease: undefined, updatedAt: minutesAgo(30) }));

        await runImageryTick(world.deps);
        world.deps.clock.set('2026-10-23T08:05:00.000Z');
        await runImageryTick(world.deps);
        world.deps.clock.set('2026-10-23T08:10:00.000Z');
        await runImageryTick(world.deps);

        expect(world.deps.tasks.queued.map((task) => task.options)).toEqual([
            { id: `${CITY}-unpublished-stale-${String(Date.parse(NOW) - 30 * MINUTE)}` },
        ]);
    });
});

describe('maintenance', () => {
    it('happyPath_aDeferredPublishRunsWhenItsMonthComes @S-A42-HAPPY-DEFER', async () => {
        const world = await readyWorld('2026-11-01T00:05:00.000Z');
        const guard = { verdict: 'over' as const, available: 2, checkedAt: at(NOW), choice: 'defer' as const, chosenBy: 'u-admin' };
        await seedVersion(
            world,
            'due',
            renderedVersion({
                jobId: 'due',
                state: 'approved',
                approval: { auto: false, by: 'u-admin', at: at(NOW) },
                guard: { ...guard, deferUntil: at('2026-11-01T00:00:00.000Z') },
            }),
        );
        await seedVersion(
            world,
            'later',
            renderedVersion({
                jobId: 'later',
                state: 'approved',
                approval: { auto: false, by: 'u-admin', at: at(NOW) },
                guard: { ...guard, deferUntil: at('2026-12-01T00:00:00.000Z') },
            }),
        );

        await runImageryTick(world.deps);

        expect(world.deps.tasks.queued).toEqual([
            {
                queue: 'imagery-publish',
                payload: { cityId: CITY, jobId: 'due', phase: 'start', poll: 0 },
                options: { id: `${CITY}-due-deferred-2026-11` },
            },
        ]);
    });

    it('happyPath_aPublishTheBudgetGuardPausedIsQueuedOnceItIsGreen @S-A43-HAPPY-RESUME', async () => {
        const world = await readyWorld();
        await seedVersion(
            world,
            'paused',
            renderedVersion({ jobId: 'paused', state: 'approved', approval: { auto: true, by: 'system:imagery', at: at(NOW) } }),
        );
        await seedJob(
            world,
            'paused',
            job({ status: 'awaiting_approval', waitReason: 'guard', lease: undefined, updatedAt: minutesAgo(40) }),
        );
        await seedVersion(
            world,
            'waiting',
            renderedVersion({ jobId: 'waiting', state: 'approved', approval: { auto: false, by: 'u-admin', at: at(NOW) } }),
        );
        await seedJob(world, 'waiting', job({ status: 'awaiting_approval', waitReason: 'compute-units', lease: undefined }));

        await runImageryTick(world.deps);
        await runImageryTick(world.deps);

        expect(world.deps.tasks.queued).toEqual([
            {
                queue: 'imagery-publish',
                payload: { cityId: CITY, jobId: 'paused', phase: 'start', poll: 0 },
                options: { id: `${CITY}-paused-resumed-${String(Date.parse(NOW) - 40 * MINUTE)}` },
            },
        ]);
    });

    it('happyPath_theFilesOfLongEndedVersionsAreSwept', async () => {
        const world = await readyWorld();
        await seedVersion(world, 'old', renderedVersion({ jobId: 'old', state: 'rejected', updatedAt: minutesAgo(31 * 24 * 60) }));
        await seedVersion(world, 'recent', renderedVersion({ jobId: 'recent', state: 'cancelled', updatedAt: minutesAgo(24 * 60) }));
        world.deps.blobs.put('private', 'rasters/bucharest/kh-4a-corona-1966/old/scan.tif', new Uint8Array([1]));
        world.deps.blobs.put('private', 'rasters/bucharest/kh-4a-corona-1966/recent/scan.tif', new Uint8Array([1]));

        await runImageryTick(world.deps);

        expect(world.deps.blobs.paths('private', 'rasters/')).toEqual(['rasters/bucharest/kh-4a-corona-1966/recent/scan.tif']);
        expect((await readVersion(world, 'old'))?.updatedAt).toEqual(at(NOW));
    });
});

describe('maintenance: the monthly harvest', () => {
    it('happyPath_aHarvestOlderThanAMonthIsRepeated', async () => {
        const world = await readyWorld(NOW, { corona2: [sceneRecord('DS1105-1071DF075')] });
        await seedScene(world, 'DS-OLD', { harvestedAt: minutesAgo(31 * 24 * 60) });

        await runImageryTick(world.deps);

        expect(world.deps.documents.paths(FIRESTORE_PATHS.usgsScenes(CITY))).toContain(FIRESTORE_PATHS.usgsScene(CITY, 'DS1105-1071DF075'));
    });

    it('badPath_aCityNeverHarvestedWaitsForItsFirstVisit', async () => {
        const world = await readyWorld(NOW, { corona2: [sceneRecord('DS1105-1071DF075')] });

        await runImageryTick(world.deps);

        expect(world.scenes.recorder.calls).toEqual([]);
        expect(world.deps.documents.paths(FIRESTORE_PATHS.usgsScenes(CITY))).toEqual([]);
    });

    it('happyPath_aRecentHarvestIsNotRepeated', async () => {
        const world = await readyWorld(NOW, { corona2: [sceneRecord('DS1105-1071DF075')] });
        await seedScene(world, 'DS-OLD', { harvestedAt: minutesAgo(5 * 24 * 60) });

        await runImageryTick(world.deps);

        expect(world.scenes.recorder.calls).toEqual([]);
    });

    it('badPath_aHarvestUsgsDoesNotAnswerBacksOffInsteadOfRepeatingEveryTick @S-A11-BAD-HARVEST-BACKOFF', async () => {
        const world = await readyWorld();
        for (const dataset of USGS_DATASETS) {
            world.scenes.failing.set(dataset, new UpstreamError('usgs', 'unavailable', { status: 502 }));
        }
        await seedScene(world, 'DS-OLD', { harvestedAt: minutesAgo(31 * 24 * 60) });

        expect(await runImageryTick(world.deps)).toEqual([`${CITY}:harvest`]);
        world.deps.clock.set('2026-10-23T08:05:00.000Z');
        expect(await runImageryTick(world.deps)).toEqual([]);

        expect(world.usgs.recorder.argsOf('login')).toHaveLength(1);
        expect(await harvestState(world)).toMatchObject({
            outcome: 'failed',
            failures: 1,
            error: 'apiError.usgs.unavailable',
            nextAt: at('2026-10-23T09:00:00.000Z'),
        });
        // An hour later it is tried again, and the next wait doubles.
        world.deps.clock.set('2026-10-23T09:00:00.000Z');
        await runImageryTick(world.deps);
        expect(world.usgs.recorder.argsOf('login')).toHaveLength(2);
        expect(await harvestState(world)).toMatchObject({ failures: 2, nextAt: at('2026-10-23T11:00:00.000Z') });
    });

    it('happyPath_aHarvestThatFoundNothingWaitsAMonth @S-A11-BAD-HARVEST-BACKOFF', async () => {
        const world = await readyWorld();
        await seedScene(world, 'DS-OLD', { harvestedAt: minutesAgo(31 * 24 * 60) });

        await runImageryTick(world.deps);
        world.deps.clock.set('2026-10-23T08:05:00.000Z');
        await runImageryTick(world.deps);

        expect(world.usgs.recorder.argsOf('login')).toHaveLength(1);
        expect(await harvestState(world)).toMatchObject({ outcome: 'empty', failures: 0, nextAt: at('2026-11-22T08:00:00.000Z') });
    });

    it('badPath_refusedCredentialsMarkSetupAndStopTheTicksHarvest @S-A11-BAD-HARVEST-BACKOFF', async () => {
        const world = await readyWorld();
        world.secrets.versions.set('usgs-app-token', ['revoked-token']);
        await seedScene(world, 'DS-OLD', { harvestedAt: minutesAgo(31 * 24 * 60) });

        await runImageryTick(world.deps);
        world.deps.clock.set('2026-10-23T10:00:00.000Z');
        await runImageryTick(world.deps);

        expect(world.usgs.recorder.argsOf('login')).toHaveLength(1);
        expect((await world.deps.setup.readStatus())?.['usgs']).toMatchObject({
            state: 'invalid',
            role: 'download',
            detail: 'apiError.usgs.credentials',
        });
    });

    it('happyPath_aUsgsCheckThatFoundMaintenanceDoesNotStopTheHarvest', async () => {
        const world = await readyWorld(NOW, { corona2: [sceneRecord('DS1105-1071DF075')] });
        await seedSetup(world, { usgs: { state: 'unavailable', role: 'download', detail: 'apiError.usgs.maintenance' } });
        await seedScene(world, 'DS-OLD', { harvestedAt: minutesAgo(31 * 24 * 60) });

        await runImageryTick(world.deps);

        expect(world.deps.documents.paths(FIRESTORE_PATHS.usgsScenes(CITY))).toContain(FIRESTORE_PATHS.usgsScene(CITY, 'DS1105-1071DF075'));
    });

    it('badPath_withoutUsgsThereIsNoHarvest', async () => {
        const world = await readyWorld(NOW, { corona2: [sceneRecord('DS1105-1071DF075')] });
        await seedSetup(world, { usgs: { state: 'missing' } });
        await seedScene(world, 'DS-OLD', { harvestedAt: minutesAgo(31 * 24 * 60) });

        await runImageryTick(world.deps);

        expect(world.usgs.recorder.calls).toEqual([]);
    });
});

describe('runImageryTick', () => {
    it('badPath_whileTheGuardIsRedOnlyEndingAndRecoveryRun', async () => {
        const world = await readyWorld();
        await seedGuard(world, 'red');
        await seedJob(world, 'queued', job({ status: 'queued', lease: undefined, executionName: undefined, attempt: 0 }));
        await seedJob(world, 'asked', job({ status: 'awaiting_gcps', cancelRequested: true, lease: undefined, versionId: 'v-asked' }));

        const failed = await runImageryTick(world.deps);

        expect(failed).toEqual([]);
        expect((await readJob(world, 'queued'))?.status).toBe('queued');
        expect((await readJob(world, 'asked'))?.status).toBe('cancelled');
        expect(world.jobs.runs).toEqual([]);
        expect(world.scenes.recorder.calls).toEqual([]);
    });

    it('badPath_aFailingPartIsLoggedAndTheOthersRun', async () => {
        const world = await readyWorld(NOW, { corona2: [sceneRecord('DS1105-1071DF075')] });
        world.secrets.versions.delete('usgs-username');
        await seedScene(world, 'DS-OLD', { harvestedAt: minutesAgo(31 * 24 * 60) });
        await seedJob(world, 'queued', job({ status: 'queued', lease: undefined, executionName: undefined, attempt: 0 }));

        const failed = await runImageryTick(world.deps);

        expect(failed).toEqual([`${CITY}:harvest`]);
        expect((await readJob(world, 'queued'))?.status).toBe('starting');
        expect(world.deps.recording.records.map((record) => record.message)).toContain('imagery tick part failed');
    });

    it('happyPath_theScheduleRunsTheTickAsItsOwnAccount', async () => {
        const world = await readyWorld();
        const tick = tickFunction(() => world.deps);

        await tick.run({ scheduleTime: NOW, jobName: 'firebase-schedule-imagery-tick-us-central1' });

        expect(tick.__endpoint).toMatchObject({
            serviceAccountEmail: 'fn-events@demo-hcm.iam.gserviceaccount.com',
            maxInstances: 1,
            scheduleTrigger: { schedule: 'every 15 minutes' },
        });
        expect(world.deps.recording.records.map((record) => record.message)).toContain('imagery tick finished');
    });
});
