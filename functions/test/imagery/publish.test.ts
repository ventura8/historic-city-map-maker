/**
 * Approval and publishing (`functions/src/imagery/{approval,publish,publish-guard,publish-mts,finalize}.ts`,
 * `docs/research/M3-interfaces.md` §7): the policy approves a measured georeference under the city's threshold on its
 * own; the guard reserves the estimate in the month's counter or holds the version for a choice; the COG is streamed to
 * the layer's tileset source, published and polled; an internal Mapbox failure is published once more, a refused recipe
 * fails the job and frees its reservation; success creates or updates the layer and books the compute units.
 */
import { MAX_TILESETS, PUBLISH_MAX_ATTEMPTS, type JobDoc, type LayerVersionDoc } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { applyApprovalPolicy } from '../../src/imagery/approval.js';
import { cancelJob } from '../../src/imagery/cancel.js';
import { onJobWrite } from '../../src/imagery/on-job-write.js';
import { publishFunction, runPublishTask } from '../../src/imagery/publish.js';
import { UpstreamError } from '../../src/ports/errors.js';
import {
    CITY,
    MAPBOX_USER,
    NOW,
    at,
    goldenGeoref,
    goldenOutput,
    readJob,
    readLayer,
    readScene,
    readUsage,
    readVersion,
    readyWorld,
    renderedVersion,
    seedCity,
    seedGuard,
    seedJob,
    seedLayer,
    seedScene,
    seedUsage,
    seedVersion,
    type ImageryWorld,
} from './world.js';

const JOB = 'job-1966-0712';
const LAYER = 'kh-4a-corona-1966';
const TILESET = `${MAPBOX_USER}.hcm-${CITY}-${LAYER}`;
const COG = new Uint8Array(4096).fill(7);

function awaitingJob(overrides: Partial<JobDoc> = {}): JobDoc {
    return {
        type: 'usgs-import',
        status: 'awaiting_approval',
        params: { entityId: 'DS1035-1057DA023', dataset: 'corona2', sensor: 'KH-4A' },
        createdBy: 'u-admin',
        createdAt: at(NOW),
        layerId: LAYER,
        versionId: JOB,
        waitReason: 'approval',
        machine: 'std',
        attempt: 1,
        updatedBy: 'system:pipeline',
        updatedAt: at(NOW),
        ...overrides,
    };
}

/** The golden rendered version over 100 km² (4 compute units at z16), measured on three checks. */
function rendered(overrides: Partial<LayerVersionDoc> = {}): LayerVersionDoc {
    return renderedVersion({
        output: { ...goldenOutput(), areaKm2: 100 },
        georef: { ...goldenGeoref(), checkpointCount: 3 },
        ...overrides,
    });
}

function approvedVersion(overrides: Partial<LayerVersionDoc> = {}): LayerVersionDoc {
    return rendered({ state: 'approved', approval: { auto: false, by: 'u-admin', at: at(NOW) }, ...overrides });
}

async function publishWorld(version: LayerVersionDoc = approvedVersion(), jobId = JOB): Promise<ImageryWorld> {
    const world = await readyWorld();
    await seedJob(world, jobId, awaitingJob({ versionId: jobId }));
    await seedVersion(world, jobId, { ...version, jobId });
    world.deps.blobs.put('private', version.output?.cogPath ?? 'x', COG, { contentType: 'image/tiff' });
    return world;
}

function start(world: ImageryWorld, jobId = JOB) {
    return runPublishTask(world.deps, { cityId: CITY, jobId, phase: 'start', poll: 0 });
}

function poll(world: ImageryWorld, count: number, jobId = JOB) {
    return runPublishTask(world.deps, { cityId: CITY, jobId, phase: 'poll', poll: count });
}

describe('the approval policy', () => {
    it('happyPath_aMeasuredGeoreferenceUnderTheThresholdIsApprovedAndQueued', async () => {
        const world = await readyWorld();
        await seedJob(world, JOB, awaitingJob());
        await seedVersion(world, JOB, rendered());

        expect(await onJobWrite(world.deps, CITY, JOB, { before: awaitingJob({ status: 'running' }), after: awaitingJob() })).toBe(
            'approval',
        );

        expect(await readVersion(world, JOB)).toMatchObject({
            state: 'approved',
            estimate: { computeUnits: 4, precision: '30cm', areaKm2: 100 },
            approval: { auto: true, by: 'system:imagery', checkpointRmseM: 8.9, thresholdM: 15 },
        });
        expect(world.deps.tasks.queued).toEqual([
            {
                queue: 'imagery-publish',
                payload: { cityId: CITY, jobId: JOB, phase: 'start', poll: 0 },
                options: { id: `${CITY}-${JOB}-auto` },
            },
        ]);
    });

    it('badPath_anUploadsOwnGeoreferenceWaitsForApproveWhateverTheThreshold @S-A17-BAD-EMBEDDED-GEOREF', async () => {
        const world = await readyWorld();
        await seedCity(world, { imagery: { autoPublish: true, rmseThresholdM: 200 } });
        await seedJob(world, JOB, awaitingJob({ type: 'geotiff-import' }));
        await seedVersion(world, JOB, rendered({ origin: 'upload', georef: { method: 'embedded', transform: 'affine', gcps: [] } }));

        expect(await applyApprovalPolicy(world.deps, CITY, JOB)).toBe(false);

        expect(await readVersion(world, JOB)).toMatchObject({ state: 'awaiting_approval', estimate: { computeUnits: 4 } });
        expect((await readVersion(world, JOB))?.approval).toBeUndefined();
        expect(world.deps.tasks.queued).toEqual([]);
    });

    it.each([
        ['the city publishes by hand', { imagery: { autoPublish: false } }, {}],
        ['the error is over the threshold', { imagery: { rmseThresholdM: 5 } }, {}],
        ['two checks are too few', {}, { georef: goldenGeoref() }],
        ['nothing was measured', {}, { georef: undefined }],
    ])('badPath_theVersionWaitsForApprove_%s', async (_case, city, version) => {
        const world = await readyWorld();
        await seedCity(world, city);
        await seedJob(world, JOB, awaitingJob());
        await seedVersion(world, JOB, rendered(version));

        expect(await applyApprovalPolicy(world.deps, CITY, JOB)).toBe(false);
        expect((await readVersion(world, JOB))?.state).toBe('awaiting_approval');
    });

    it('badPath_aVersionThatMovedOnIsLeftAsItIs', async () => {
        const world = await readyWorld();
        await seedJob(world, JOB, awaitingJob());
        await seedVersion(world, JOB, approvedVersion());

        expect(await applyApprovalPolicy(world.deps, CITY, JOB)).toBe(false);
        expect(await applyApprovalPolicy(world.deps, CITY, 'missing')).toBe(false);
        expect(world.deps.tasks.queued).toEqual([]);
    });
});

describe('a publish within the month', () => {
    it('happyPath_reservedUploadedPublishedPolledAndCounted @S-A42-HAPPY', async () => {
        const world = await publishWorld();
        world.tilesets.outcomes.push({ stage: 'processing', errors: [] }, { stage: 'success', errors: [], precisions: { '30cm': 98.5 } });

        await start(world);

        expect((await readUsage(world, '2026-10'))?.reservations).toEqual({ [JOB]: { computeUnits: 4, at: at(NOW), newTileset: true } });
        expect(await readJob(world, JOB)).toMatchObject({
            status: 'mts_processing',
            waitReason: 'mapbox',
            mapboxJobId: 'mts-job-1',
            publishAttempts: 1,
            steps: { upload: { status: 'done', sha256: 'c'.repeat(64) }, publish: { status: 'done' }, tiles: { status: 'running' } },
        });
        expect((await readVersion(world, JOB))?.state).toBe('publishing');
        expect(world.tilesets.sources.get(`${MAPBOX_USER}/hcm-${CITY}-${LAYER}`)).toBe(COG.length);
        expect(world.tilesets.recipes.get(TILESET)?.recipe).toEqual({
            version: 1,
            type: 'raster',
            sources: [{ uri: `mapbox://tileset-source/${MAPBOX_USER}/hcm-${CITY}-${LAYER}` }],
            minzoom: 10,
            maxzoom: 16,
        });
        expect(world.deps.tasks.queued.at(-1)).toMatchObject({ payload: { phase: 'poll', poll: 0 }, options: { delaySeconds: 60 } });

        await poll(world, 0);
        expect(world.deps.tasks.queued.at(-1)).toMatchObject({ payload: { phase: 'poll', poll: 1 }, options: { delaySeconds: 120 } });
        await poll(world, 1);

        expect(await readUsage(world, '2026-10')).toMatchObject({ computeUnits: 4, publishes: 1, uploadedMb: 212, reservations: {} });
        // Every step of the publish ends done: the Jobs page shows no step still running (the tiles answered).
        expect(await readJob(world, JOB)).toMatchObject({
            status: 'succeeded',
            finishedAt: at(NOW),
            progress: 1,
            steps: { publish: { status: 'done' }, tiles: { status: 'done', finishedAt: at(NOW) }, finalize: { status: 'done' } },
        });
        expect(await readVersion(world, JOB)).toMatchObject({
            state: 'published',
            mapbox: { tilesetId: TILESET, jobId: 'mts-job-1', origin: 'mts', precisions: { '10m': 0, '1m': 0, '30cm': 98.5, '1cm': 0 } },
        });
        expect(await readLayer(world, LAYER)).toMatchObject({
            year: 1966,
            date: '1966-07-12',
            label: { ro: 'KH-4A Corona, 12 iulie 1966' },
            kind: 'satellite',
            sensor: 'KH-4A Corona',
            attribution: 'USGS EROS, declassified imagery (public domain)',
            source: { type: 'mapbox', tilesetId: TILESET },
            minzoom: 10,
            maxzoom: 16,
            order: 0,
            opacity: 1,
            defaultVisible: false,
            status: 'ready',
            published: true,
            provenance: {
                usgsEntityId: 'DS1035-1057DA023',
                usgsDataset: 'corona2',
                georef: { method: 'auto', gcpCount: 6, checkpointRmseM: 8.9 },
            },
            mapbox: { tilesetId: TILESET, origin: 'mts', publishedSourceSha: 'c'.repeat(64) },
            currentVersion: JOB,
            updatedBy: 'system:imagery',
        });
        expect(world.tilesets.recorder.argsOf('tileJson')).toEqual([[TILESET]]);
    });

    it('happyPath_aNewVersionReplacesTheTilesAndKeepsWhatTheAdminSet', async () => {
        const world = await publishWorld();
        await seedLayer(world, LAYER, {
            label: { ro: 'Corona, vara lui 1966' },
            opacity: 0.6,
            order: 4,
            currentVersion: 'v-first',
            pendingVersion: JOB,
        });
        await seedVersion(
            world,
            'v-first',
            renderedVersion({ jobId: 'v-first', state: 'published', mapbox: { tilesetId: TILESET, origin: 'mts' } }),
        );
        world.tilesets.outcomes.push({ stage: 'success', errors: [] });

        await start(world);
        await poll(world, 0);

        const layer = await readLayer(world, LAYER);
        expect(layer).toMatchObject({ label: { ro: 'Corona, vara lui 1966' }, opacity: 0.6, order: 4, currentVersion: JOB });
        expect(layer?.pendingVersion).toBeUndefined();
        expect((await readVersion(world, 'v-first'))?.state).toBe('superseded');
    });

    it('badPath_anotherVersionsPendingMarkOutlivesThisPublish @S-A89-BAD-DECLINE-KEEPS-WAITING', async () => {
        // M16 §5: a refine of this version took the mark while it was approved and publishing; it keeps it once this one is live.
        const world = await publishWorld();
        await seedLayer(world, LAYER, { currentVersion: 'v-first', pendingVersion: 'rg-refine' });
        world.tilesets.outcomes.push({ stage: 'success', errors: [] });

        await start(world);
        await poll(world, 0);

        expect(await readLayer(world, LAYER)).toMatchObject({ currentVersion: JOB, pendingVersion: 'rg-refine' });
    });

    it('happyPath_theSameFileIsNotUploadedTwice', async () => {
        const world = await publishWorld();
        await seedLayer(world, LAYER, { mapbox: { tilesetId: TILESET, origin: 'mts', publishedSourceSha: 'c'.repeat(64) } });

        await start(world);

        expect(world.tilesets.recorder.argsOf('uploadSource')).toEqual([]);
        expect((await readJob(world, JOB))?.steps?.['upload']?.status).toBe('skipped');
    });
});

describe('a publish started again', () => {
    it('badPath_aRedeliveredStartPollsTheJobItStartedInsteadOfPublishingAgain @S-A42-BAD-DUPLICATE-PUBLISH', async () => {
        const world = await publishWorld();
        await start(world);
        world.tilesets.outcomes.push({ stage: 'processing', errors: [] });

        // Cloud Tasks delivers the start again (or the tick's recovery queues one): Mapbox already has the job.
        await start(world);

        expect(world.tilesets.published).toEqual([TILESET]);
        expect(world.tilesets.recorder.argsOf('uploadSource')).toHaveLength(1);
        expect(world.tilesets.recorder.argsOf('job')).toEqual([[TILESET, 'mts-job-1']]);
        expect((await readUsage(world, '2026-10'))?.reservations).toEqual({ [JOB]: { computeUnits: 4, at: at(NOW), newTileset: true } });
    });

    it('badPath_aStartWhoseAnswerWasLostFollowsTheJobMapboxStarted @S-A42-BAD-DUPLICATE-PUBLISH', async () => {
        const world = await publishWorld();
        // Mapbox took the publish, but its answer never arrived (a reset connection): the task fails and is retried.
        world.tilesets.publishFailures.push(new UpstreamError('mapbox', 'unavailable', { status: 503 }));
        await expect(start(world)).rejects.toMatchObject({ failure: 'unavailable' });
        expect((await readJob(world, JOB))?.steps?.['publish']?.status).toBe('running');

        await start(world);

        expect(world.tilesets.published).toEqual([TILESET]);
        expect(world.tilesets.recorder.argsOf('uploadSource')).toHaveLength(1);
        expect(await readJob(world, JOB)).toMatchObject({
            mapboxJobId: 'mts-job-1',
            publishAttempts: 2,
            steps: { publish: { status: 'done' } },
        });
        expect(world.deps.tasks.queued.at(-1)).toMatchObject({
            payload: { phase: 'poll', poll: 0 },
            options: { id: `${CITY}-${JOB}-poll-0` },
        });
    });

    it('badPath_aPublishMapboxNeverReceivedIsMadeOnce', async () => {
        const world = await publishWorld();
        world.tilesets.recorder.failNext('publish', new UpstreamError('mapbox', 'unavailable', { status: 503 }));
        await expect(start(world)).rejects.toMatchObject({ failure: 'unavailable' });

        await start(world);

        expect(world.tilesets.recorder.argsOf('listJobs')).toEqual([[TILESET, 10]]);
        expect(world.tilesets.published).toEqual([TILESET]);
        expect(world.tilesets.recorder.argsOf('uploadSource')).toHaveLength(1);
    });

    it('badPath_aPublishThatKeepsFailingStopsAtItsAttempts @S-A42-BAD-PUBLISH-ATTEMPTS', async () => {
        const world = await publishWorld();
        for (let attempt = 1; attempt <= PUBLISH_MAX_ATTEMPTS; attempt += 1) {
            world.tilesets.recorder.failNext('uploadSource', new UpstreamError('mapbox', 'unavailable', { status: 504 }));
            await expect(start(world)).rejects.toMatchObject({ failure: 'unavailable' });
        }

        await start(world);

        expect(world.tilesets.recorder.argsOf('uploadSource')).toHaveLength(PUBLISH_MAX_ATTEMPTS);
        expect(await readJob(world, JOB)).toMatchObject({
            status: 'failed',
            publishAttempts: PUBLISH_MAX_ATTEMPTS,
            error: { code: 'apiError.imagery.attemptsExhausted', params: { attempts: String(PUBLISH_MAX_ATTEMPTS) } },
        });
        expect((await readVersion(world, JOB))?.state).toBe('failed');
        expect((await readUsage(world, '2026-10'))?.reservations).toEqual({});
    });

    it('badPath_whileTheBudgetGuardIsRedNothingReachesMapbox @S-A12-BAD-GUARD-PAUSED', async () => {
        const world = await publishWorld();
        await seedGuard(world, 'red');

        await start(world);

        expect(world.tilesets.recorder.calls).toEqual([]);
        expect(await readJob(world, JOB)).toMatchObject({ status: 'awaiting_approval', waitReason: 'guard' });
        expect((await readVersion(world, JOB))?.state).toBe('approved');
        expect(await readUsage(world, '2026-10')).toBeUndefined();
    });
});

describe('a cancellation before Mapbox', () => {
    it('badPath_aPublishNotYetAtMapboxIsCancelledAndFreesItsUnits @S-A12-BAD-CANCEL-BEFORE-MAPBOX', async () => {
        const world = await publishWorld();
        world.tilesets.recorder.failNext('uploadSource', new UpstreamError('mapbox', 'unavailable', { status: 504 }));
        await expect(start(world)).rejects.toMatchObject({ failure: 'unavailable' });

        expect(await cancelJob(world.deps, CITY, JOB)).toBe('cancelled');
        await start(world);

        expect(await readJob(world, JOB)).toMatchObject({ status: 'cancelled' });
        expect((await readVersion(world, JOB))?.state).toBe('cancelled');
        expect((await readUsage(world, '2026-10'))?.reservations).toEqual({});
        expect(world.tilesets.published).toEqual([]);
    });

    it('badPath_aCancellationDuringTheUploadStopsThePublishCall @S-A12-BAD-CANCEL-BEFORE-MAPBOX', async () => {
        const world = await publishWorld();
        const upload = world.deps.tilesets.uploadSource.bind(world.deps.tilesets);
        world.deps.tilesets.uploadSource = async (...args) => {
            const uploaded = await upload(...args);
            await cancelJob(world.deps, CITY, JOB);
            return uploaded;
        };

        await start(world);

        expect(world.tilesets.published).toEqual([]);
        expect((await readJob(world, JOB))?.status).toBe('cancelled');
    });

    it('badPath_aPublishAtMapboxIsLeftToFinish', async () => {
        const world = await publishWorld();
        await start(world);

        expect(await cancelJob(world.deps, CITY, JOB)).toBe('finishing');
        expect((await readJob(world, JOB))?.status).toBe('mts_processing');
    });
});

describe('the compute-unit guard', () => {
    it('badPath_overTheMonthNothingReachesMapbox', async () => {
        const world = await publishWorld(approvedVersion({ output: goldenOutput() }));

        await start(world);

        expect(await readVersion(world, JOB)).toMatchObject({
            state: 'approved',
            guard: { verdict: 'over', available: 20, overageUsd: 4.05 },
        });
        expect(await readJob(world, JOB)).toMatchObject({ status: 'awaiting_approval', waitReason: 'compute-units' });
        expect(world.tilesets.recorder.calls).toEqual([]);
    });

    it('badPath_theTwentyFifthTilesetNeedsTheOwner @S-A42-BAD-TILESET-LIMIT', async () => {
        const world = await publishWorld();
        for (let index = 0; index < MAX_TILESETS; index += 1) {
            await seedLayer(world, `layer-${String(index)}`, { mapbox: { tilesetId: `${MAPBOX_USER}.layer-${String(index)}` } });
        }

        await start(world);

        expect(await readVersion(world, JOB)).toMatchObject({ guard: { verdict: 'tileset-limit' } });
        expect((await readVersion(world, JOB))?.guard?.overageUsd).toBeUndefined();
        expect(world.tilesets.recorder.calls).toEqual([]);
    });

    it('badPath_twoPublishesNeverShareTheSameRemainingUnits @S-A42-BAD-RACING-PUBLISHES', async () => {
        const output = { ...goldenOutput(), areaKm2: 300 };
        const world = await publishWorld(approvedVersion({ output }));
        await seedJob(world, 'job-b', awaitingJob({ versionId: 'job-b', layerId: 'other-layer' }));
        await seedVersion(world, 'job-b', approvedVersion({ jobId: 'job-b', layerId: 'other-layer', output }));

        // Both approved at once: the queue dispatches one at a time and each reservation is in the guard's transaction.
        await start(world);
        await start(world, 'job-b');

        const states = [await readVersion(world, JOB), await readVersion(world, 'job-b')]
            .map((version) => String(version?.state))
            .sort((left, right) => left.localeCompare(right));
        expect(states).toEqual(['approved', 'publishing']);
        const usage = await readUsage(world, '2026-10');
        expect(Object.values(usage?.reservations ?? {})).toEqual([{ computeUnits: 12, at: at(NOW), newTileset: true }]);
        const held = [await readVersion(world, JOB), await readVersion(world, 'job-b')].find((version) => version?.state === 'approved');
        expect(held?.guard).toMatchObject({ verdict: 'over', available: 8 });
    });
});

describe('the compute-unit guard: the tileset cap', () => {
    it('badPath_twoFirstPublishesNeverBothTakeTheLastTileset @S-A42-BAD-RACING-TILESETS', async () => {
        const world = await publishWorld();
        for (let index = 0; index < MAX_TILESETS - 1; index += 1) {
            await seedLayer(world, `layer-${String(index)}`, { mapbox: { tilesetId: `${MAPBOX_USER}.layer-${String(index)}` } });
        }
        await seedJob(world, 'job-b', awaitingJob({ versionId: 'job-b', layerId: 'other-layer' }));
        await seedVersion(world, 'job-b', approvedVersion({ jobId: 'job-b', layerId: 'other-layer' }));
        // The first one passes the guard (its upload then stalls); the second one's query ran before that commit, so it
        // sees the first version as it was (approved): only the first's reservation, read in the second's transaction,
        // shows the tileset on its way. Neither layer has its tileset yet.
        world.tilesets.recorder.failNext('uploadSource', new UpstreamError('mapbox', 'unavailable', { status: 504 }));
        await expect(start(world)).rejects.toMatchObject({ failure: 'unavailable' });
        await seedVersion(world, JOB, approvedVersion());

        await start(world, 'job-b');

        expect(await readVersion(world, 'job-b')).toMatchObject({ state: 'approved', guard: { verdict: 'tileset-limit' } });
        expect(world.tilesets.recorder.argsOf('uploadSource')).toHaveLength(1);
    });

    it('badPath_aDeletedLayersTilesetCountsUntilItsDeletionRuns @S-A42-BAD-RACING-TILESETS', async () => {
        const world = await publishWorld();
        for (let index = 0; index < MAX_TILESETS - 2; index += 1) {
            await seedLayer(world, `layer-${String(index)}`, { mapbox: { tilesetId: `${MAPBOX_USER}.layer-${String(index)}` } });
        }
        // A deleted layer's tileset stays until its job runs, and another city's first publish is under way.
        await seedJob(world, 'ld-deleted', {
            type: 'layer-delete',
            status: 'queued',
            params: { layerId: 'deleted', tilesetId: `${MAPBOX_USER}.deleted` },
            createdBy: 'u-admin',
            createdAt: at(NOW),
            updatedBy: 'u-admin',
            updatedAt: at(NOW),
        });
        await seedVersion(world, 'v-other', approvedVersion({ jobId: 'v-other', layerId: 'publishing-elsewhere', state: 'publishing' }));

        await start(world);

        expect(await readVersion(world, JOB)).toMatchObject({ guard: { verdict: 'tileset-limit' } });
        expect(world.tilesets.recorder.calls).toEqual([]);
    });

    it('happyPath_aPaidOverageLetsThePublishThroughKeepingTheChoice', async () => {
        const guard = {
            verdict: 'over' as const,
            available: 2,
            checkedAt: at(NOW),
            choice: 'pay' as const,
            chosenBy: 'u-owner',
            chosenAt: at(NOW),
        };
        const world = await publishWorld(approvedVersion({ guard }));
        await seedUsage(world, '2026-10', {
            computeUnits: 18,
            overageComputeUnits: 2,
            reservations: { [JOB]: { computeUnits: 4, at: at(NOW) } },
        });

        await start(world);

        expect(await readVersion(world, JOB)).toMatchObject({
            state: 'publishing',
            guard: { verdict: 'within', choice: 'pay', chosenBy: 'u-owner' },
        });
    });

    it.each([
        [
            'a version deferred to next month',
            approvedVersion({
                guard: { verdict: 'over', available: 0, checkedAt: at(NOW), choice: 'defer', deferUntil: at('2026-11-01T00:00:00.000Z') },
            }),
        ],
        [
            'a version going the Studio way',
            approvedVersion({ guard: { verdict: 'over', available: 0, checkedAt: at(NOW), choice: 'studio' } }),
        ],
        ['a version not approved', rendered()],
    ])('badPath_nothingIsPublished_%s', async (_case, version) => {
        const world = await publishWorld(version);

        await start(world);
        await start(world, 'missing');

        expect(world.tilesets.recorder.calls).toEqual([]);
        expect((await readVersion(world, JOB))?.state).toBe(version.state);
    });
});

describe('mapbox failures', () => {
    it('happyPath_anInternalMtsFailureIsPublishedOnceMore @S-P01-BAD-MTS-FAILURE', async () => {
        const world = await publishWorld();
        world.tilesets.outcomes.push(
            { stage: 'failed', errors: ['Internal server error while processing'] },
            { stage: 'success', errors: [] },
        );

        await start(world);
        await poll(world, 0);
        expect(world.deps.tasks.queued.at(-1)).toMatchObject({
            payload: { phase: 'poll', poll: 1 },
            options: { id: `${CITY}-${JOB}-poll-1` },
        });
        await poll(world, 1);

        expect(world.tilesets.published).toEqual([TILESET, TILESET]);
        expect((await readJob(world, JOB))?.status).toBe('succeeded');
    });

    it('badPath_aRefusedRecipeFailsTheJobFreesTheUnitsAndKeepsTheTiles @S-P01-BAD-MTS-FAILURE', async () => {
        const world = await publishWorld();
        await seedLayer(world, LAYER, { currentVersion: 'v-first', pendingVersion: JOB });
        world.tilesets.outcomes.push({ stage: 'failed', errors: ['Invalid raster source: the GeoTIFF has no georeferencing.'] });

        await start(world);
        await poll(world, 0);

        expect(await readJob(world, JOB)).toMatchObject({ status: 'failed', error: { code: 'apiError.imagery.mtsRefused' } });
        expect((await readVersion(world, JOB))?.state).toBe('failed');
        expect((await readUsage(world, '2026-10'))?.reservations).toEqual({});
        const layer = await readLayer(world, LAYER);
        expect(layer?.currentVersion).toBe('v-first');
        expect(layer?.pendingVersion).toBeUndefined();
    });

    it('badPath_aSecondInternalFailureFails @S-P01-BAD-MTS-FAILURE', async () => {
        const world = await publishWorld();
        const internal = { stage: 'failed' as const, errors: ['internal error'] };
        world.tilesets.outcomes.push(internal, internal);

        await start(world);
        await poll(world, 0);
        await poll(world, 1);

        expect(await readJob(world, JOB)).toMatchObject({ status: 'failed', error: { code: 'apiError.imagery.mtsRefused' } });
        expect(world.tilesets.published).toHaveLength(2);
    });

    it.each([
        [
            'a revoked tiles token',
            'uploadSource',
            new UpstreamError('mapbox', 'unauthorized', { status: 401 }),
            'apiError.mapbox.tokenInvalid',
            undefined,
        ],
        [
            'a missing scope',
            'publish',
            new UpstreamError('mapbox', 'forbidden', { status: 403 }),
            'apiError.mapbox.missingScopes',
            { scopes: 'tilesets:read, tilesets:write, tilesets:list' },
        ],
        [
            'a refused recipe',
            'upsertTileset',
            new UpstreamError('mapbox', 'invalid', { status: 422 }),
            'apiError.imagery.mtsRefused',
            undefined,
        ],
    ] as const)('badPath_aPermanentFailureEndsThePublish_%s', async (_case, method, error, code, params) => {
        const world = await publishWorld();
        world.tilesets.recorder.failNext(method, error);

        await start(world);

        const job = await readJob(world, JOB);
        expect(job).toMatchObject({ status: 'failed', error: { code } });
        expect(job?.error?.params).toEqual(params);
        expect((await readUsage(world, '2026-10'))?.reservations).toEqual({});
    });
});

describe('mapbox failures: a file too large, the token, the transient ones', () => {
    it('badPath_aFileTooLargeForMapboxGoesBackWithTheFreeStudioWay @S-A42-BAD-SOURCE-TOO-LARGE', async () => {
        const world = await publishWorld();
        world.tilesets.recorder.failNext('uploadSource', new UpstreamError('mapbox', 'invalid', { status: 413 }));

        await start(world);

        expect(await readVersion(world, JOB)).toMatchObject({ state: 'approved', guard: { verdict: 'too-large', available: 20 } });
        expect(await readJob(world, JOB)).toMatchObject({ status: 'awaiting_approval', waitReason: 'compute-units' });
        expect((await readJob(world, JOB))?.steps?.['upload']).toBeUndefined();
        expect((await readUsage(world, '2026-10'))?.reservations).toEqual({});
        // Another start sends nothing: the file would be refused again; only the Studio way is left.
        await start(world);
        expect(world.tilesets.recorder.argsOf('uploadSource')).toHaveLength(1);
    });

    it('badPath_aFileTooLargeWithoutAStudioCopyFails @S-A42-BAD-SOURCE-TOO-LARGE', async () => {
        const withoutStudio = Object.fromEntries(Object.entries(goldenOutput()).filter(([key]) => !key.startsWith('studio')));
        const world = await publishWorld(
            approvedVersion({ output: { ...(withoutStudio as ReturnType<typeof goldenOutput>), areaKm2: 100 } }),
        );
        world.tilesets.recorder.failNext('uploadSource', new UpstreamError('mapbox', 'invalid', { status: 413 }));

        await start(world);

        expect(await readJob(world, JOB)).toMatchObject({
            status: 'failed',
            error: { code: 'apiError.imagery.sourceTooLarge', params: { megabytes: '212' } },
        });
    });

    it('badPath_withoutTheTilesTokenTheJobSaysMapboxIsNotSetUp', async () => {
        const world = await publishWorld();
        world.secrets.versions.delete('mapbox-sk-tiles');

        await start(world);

        expect(await readJob(world, JOB)).toMatchObject({ status: 'failed', error: { code: 'apiError.mapbox.notConfigured' } });
    });

    it('badPath_aTransientFailureIsLeftToCloudTasksRetries', async () => {
        const world = await publishWorld();
        world.tilesets.recorder.failNext('publish', new UpstreamError('mapbox', 'unavailable', { status: 503 }));

        await expect(start(world)).rejects.toMatchObject({ failure: 'unavailable' });

        expect((await readJob(world, JOB))?.status).toBe('mts_processing');
    });

    it('badPath_aTransientUploadFailureIsLeftToCloudTasksRetries', async () => {
        const world = await publishWorld();
        world.tilesets.recorder.failNext('uploadSource', new UpstreamError('mapbox', 'unavailable', { status: 502 }));

        await expect(start(world)).rejects.toMatchObject({ failure: 'unavailable', status: 502 });
    });

    it('badPath_aJobThatVanishedMidwayIsNotWrittenAgain', async () => {
        const world = await publishWorld();
        const upload = world.deps.tilesets.uploadSource.bind(world.deps.tilesets);
        world.deps.tilesets.uploadSource = async (...args) => {
            const uploaded = await upload(...args);
            await world.deps.documents.delete(`cities/${CITY}/jobs/${JOB}`);
            return uploaded;
        };

        await start(world);

        expect(await readJob(world, JOB)).toBeUndefined();
        expect((await readVersion(world, JOB))?.mapbox).toBeUndefined();
    });

    it('badPath_aPollOfNothingDoesNothing', async () => {
        const world = await publishWorld();

        await poll(world, 0);

        expect(world.tilesets.recorder.calls).toEqual([]);
    });
});

describe('imagery-publish', () => {
    it('happyPath_theQueueRunsOneValidTaskAtATime', async () => {
        const world = await publishWorld();
        const queue = publishFunction(() => world.deps);

        await queue.run({ data: { cityId: CITY, jobId: JOB, phase: 'start', poll: 0 } } as Parameters<typeof queue.run>[0]);
        await queue.run({ data: { cityId: CITY, jobId: '../x', phase: 'start', poll: 0 } } as Parameters<typeof queue.run>[0]);

        expect((await readJob(world, JOB))?.status).toBe('mts_processing');
        expect(world.deps.recording.records.map((record) => record.message)).toContain('publish task refused');
        expect(queue.__endpoint).toMatchObject({
            serviceAccountEmail: 'fn-events@demo-hcm.iam.gserviceaccount.com',
            maxInstances: 1,
            availableMemoryMb: 512,
            timeoutSeconds: 1800,
        });
    });

    it('happyPath_aPublishedImportKeepsItsSceneImported', async () => {
        const world = await publishWorld();
        await seedScene(world, 'DS1035-1057DA023', { status: 'imported', layerId: LAYER });
        world.tilesets.outcomes.push({ stage: 'success', errors: [] });

        await start(world);
        await poll(world, 0);

        expect(await readScene(world, 'DS1035-1057DA023')).toMatchObject({ status: 'imported', layerId: LAYER });
        expect((await readVersion(world, JOB))?.state).toBe('published');
    });
});
