/**
 * A join's frames (`functions/src/imagery/join-parts.ts`, `docs/research/M8-join-interfaces.md` §5): the dispatcher holds the
 * join until its frames rendered, fails it once one ended; a frame a live join holds refuses every change and never approves
 * on its own, while one whose join ended goes back to the normal flow. Points on a frame waiting for them are what the join
 * waits for, so they are not refused.
 */
import { FIRESTORE_PATHS, jobLogDocSchema, layerVersionDocSchema, type Gcp } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { applyApprovalPolicy } from '../../src/imagery/approval.js';
import { cancelJob } from '../../src/imagery/cancel.js';
import { approveFunction, rejectFunction } from '../../src/imagery/approve.js';
import { cropFunction } from '../../src/imagery/crop.js';
import { dispatchJob } from '../../src/imagery/dispatch.js';
import { noticeJobChange } from '../../src/imagery/job-notices.js';
import { partsReady } from '../../src/imagery/join-parts.js';
import { saveGcpsFunction } from '../../src/imagery/save-gcps.js';
import { runOnFunction } from '../../src/imagery/run-on.js';
import { layerDeleteFunction } from '../../src/layers/delete.js';
import { failureOf } from '../admin/world.js';
import { adminCall } from '../publish/fakes.js';
import {
    F039,
    F040,
    joinJob,
    joinSource,
    joinVersion,
    partJob,
    partVersion,
    requireJob,
    requireVersion,
    seedJoinOfTwo,
    seedPart,
} from './join-world.js';
import {
    CITY,
    NOW,
    at,
    goldenGeoref,
    goldenOutput,
    needsGcpsVersion,
    readJob,
    readVersion,
    readyWorld,
    seedJob,
    seedLayer,
    seedVersion,
    type ImageryWorld,
} from './world.js';

const JOIN = 'jn-1';

/** A join on two frames as `state`s say, its job queued as the callable left it. */
async function heldWorld(
    first: Parameters<typeof partVersion>[2] = {},
    second: Parameters<typeof partVersion>[2] = {},
    jobLayer = 'layer-join',
) {
    const world = await readyWorld();
    const f039 = await seedPart(world, F039, { partOf: JOIN, ...first });
    const f040 = await seedPart(world, F040, { partOf: JOIN, ...second });
    const parts = [
        { ...f039, entityId: F039 },
        { ...f040, entityId: F040 },
    ];
    await seedVersion(
        world,
        JOIN,
        joinVersion({ jobId: JOIN, layerId: jobLayer, state: 'processing', output: undefined, join: undefined, source: joinSource(parts) }),
    );
    await seedJob(world, JOIN, joinJob(JOIN, parts, { layerId: jobLayer }));
    return world;
}

describe('the dispatcher and a join', () => {
    it('badPath_aFrameStillRunningHoldsTheJoin_noRunStarts @S-A65-BAD-PART-NEEDS-POINTS', async () => {
        const world = await heldWorld({ state: 'processing', output: undefined });

        await expect(dispatchJob(world.deps, CITY, JOIN)).resolves.toBe('waiting');

        expect(await readJob(world, JOIN)).toMatchObject({ status: 'queued', waitReason: 'parts' });
        expect(world.jobs.recorder.argsOf('run')).toEqual([]);
    });

    it('happyPath_aHoldIsOneWrite_askingAgainChangesNothing', async () => {
        const world = await heldWorld({ state: 'processing', output: undefined });
        await dispatchJob(world.deps, CITY, JOIN);
        const writes = world.deps.documents.writes.length;

        await dispatchJob(world.deps, CITY, JOIN);

        expect(world.deps.documents.writes).toHaveLength(writes);
    });

    it('happyPath_allFramesRenderedStartTheJoinOnTheBigMachine_itsWaitGone', async () => {
        const world = await heldWorld();

        await expect(dispatchJob(world.deps, CITY, JOIN)).resolves.toBe('started');

        const job = await readJob(world, JOIN);
        expect(job).toMatchObject({ status: 'starting', machine: 'xl', attempt: 1 });
        expect(job?.waitReason).toBeUndefined();
    });

    it('happyPath_aFramePublishedOnTheJoinsLayerIsReady', async () => {
        const mapbox = { tilesetId: 'a.b', origin: 'mts' as const, publishedAt: at(NOW) };
        const world = await heldWorld({ state: 'published', mapbox, layerId: 'layer-join' });

        await expect(dispatchJob(world.deps, CITY, JOIN)).resolves.toBe('started');
    });

    it.each([
        [
            'published as its own layer',
            { state: 'published' as const, mapbox: { tilesetId: 'a.b', origin: 'mts' as const, publishedAt: at(NOW) } },
        ],
        ['approved', { state: 'approved' as const, approval: { auto: false, by: 'u-admin', at: at(NOW) } }],
        ['publishing', { state: 'publishing' as const, approval: { auto: false, by: 'u-admin', at: at(NOW) } }],
        ['joined by an earlier join (live 2026-11-12)', { state: 'joined' as const }],
    ])('happyPath_aFrame_%s_servesTheJoin_liveFeb1972 @S-A65-HAPPY-PUBLISHED-FRAMES', async (_name, state) => {
        const world = await heldWorld(state);

        await expect(dispatchJob(world.deps, CITY, JOIN)).resolves.toBe('started');
    });

    it('badPath_aFrameANewerJoinStampedIsTaken_notRetryable @S-A65-BAD-PART-TAKEN', async () => {
        const world = await heldWorld({ partOf: 'jn-newer' });

        await expect(dispatchJob(world.deps, CITY, JOIN)).resolves.toBe('failed');

        expect(await readJob(world, JOIN)).toMatchObject({
            status: 'failed',
            error: { code: 'apiError.imagery.joinPartTaken', params: { frame: F039 } },
        });
    });

    it('happyPath_aJoinForTheComputerWaitsForAWorkerOnceItsFramesAreThere', async () => {
        const world = await heldWorld();
        await seedJob(world, JOIN, { ...(await requireJob(world, JOIN)), runOn: 'local' });

        await expect(dispatchJob(world.deps, CITY, JOIN)).resolves.toBe('waiting');

        expect((await readJob(world, JOIN))?.waitReason).toBe('worker');
    });

    it.each([
        ['cancelled', { state: 'cancelled' as const, output: undefined }],
        ['failed', { state: 'failed' as const, output: undefined, error: { code: 'apiError.imagery.referenceUnavailable' as const } }],
        ['superseded', { state: 'superseded' as const, mapbox: { tilesetId: 'a.b', origin: 'mts' as const, publishedAt: at(NOW) } }],
        ['rejected', { state: 'rejected' as const }],
    ])('badPath_aFrame_%s_failsTheJoin_namingIt @S-A65-BAD-PART-GONE', async (_name, ended) => {
        const world = await heldWorld(ended);

        await expect(dispatchJob(world.deps, CITY, JOIN)).resolves.toBe('failed');

        expect(await readJob(world, JOIN)).toMatchObject({
            status: 'failed',
            error: { code: 'apiError.imagery.joinPartGone', params: { frame: F039 } },
        });
        expect(await readVersion(world, JOIN)).toMatchObject({
            state: 'failed',
            error: { code: 'apiError.imagery.joinPartGone', params: { frame: F039 } },
        });
        expect((await readJob(world, 'v-f040'))?.status).toBe('awaiting_approval');
    });

    it('badPath_aFrameWhoseVersionVanishedIsGone_itsIdNamed', async () => {
        const world = await heldWorld();
        await world.deps.documents.delete(FIRESTORE_PATHS.layerVersion(CITY, 'v-f039'));

        await expect(partsReady(world.deps.documents, CITY, JOIN, await requireJob(world, JOIN))).resolves.toEqual({
            kind: 'gone',
            frame: 'v-f039',
        });
    });

    it('badPath_aGoneFrameWinsOverAHeldOne', async () => {
        const world = await heldWorld({ state: 'processing', output: undefined }, { state: 'cancelled', output: undefined });

        await expect(partsReady(world.deps.documents, CITY, JOIN, await requireJob(world, JOIN))).resolves.toEqual({
            kind: 'gone',
            frame: F040,
        });
    });

    it('badPath_parametersThatDoNotParseNameNoFrame', async () => {
        const job = joinJob(JOIN, [], { params: { parts: 'none' } });
        const world = await readyWorld();

        await expect(partsReady(world.deps.documents, CITY, JOIN, job)).resolves.toEqual({ kind: 'gone', frame: JOIN });
    });
});

describe('imagery.runOn and a join', () => {
    it('badPath_movingAHeldJoinKeepsItsWait @S-A65-BAD-PART-NEEDS-POINTS', async () => {
        const world = await heldWorld({ state: 'processing', output: undefined });

        await runOnFunction(() => world.deps).run(adminCall({ cityId: CITY, jobId: JOIN, runOn: 'local' }));

        expect(await readJob(world, JOIN)).toMatchObject({ runOn: 'local', waitReason: 'parts' });
    });
});

/** Six spread pairs on the golden scan, inside the city. */
function pairs(): Gcp[] {
    return Array.from({ length: 6 }, (_, index) => {
        const x = 200 + ((index * 37) % 11) * 300;
        const y = 200 + ((index * 53) % 7) * 300;
        return {
            id: `g${String(index + 1)}`,
            pixel: { x, y },
            geo: { lat: 44.5 - y * 0.00002 + (index % 3) * 0.000001, lng: 26 + x * 0.00002 },
            enabled: index < 4,
            origin: 'manual' as const,
        };
    });
}

describe('a frame a live join holds', () => {
    const version = { cityId: CITY, versionId: 'v-f039' };

    it('badPath_refusesApproveRejectNewPointsCropAndDelete @S-A65-BAD-PART-HELD', async () => {
        const mapbox = { tilesetId: 'a.b', origin: 'mts' as const, publishedAt: at(NOW) };
        const world = await heldWorld();
        const published = await readyWorld();
        const f = await seedPart(published, F039, { partOf: JOIN, state: 'published', mapbox }, { status: 'succeeded' });
        await seedVersion(
            published,
            JOIN,
            joinVersion({ jobId: JOIN, layerId: f.layerId, state: 'processing', output: undefined, join: undefined }),
        );
        await seedLayer(published, f.layerId, { currentVersion: f.versionId });
        const held = { code: 'apiError.imagery.joinPartHeld', params: { frame: F039 } };
        const saving = { ...version, transform: 'affine', gcps: pairs() };
        const before = await readVersion(world, 'v-f039');
        const ring = [
            { lat: 44.4, lng: 26 },
            { lat: 44.4, lng: 26.1 },
            { lat: 44.5, lng: 26.1 },
        ];

        const failures = [
            await failureOf(approveFunction(() => world.deps).run(adminCall(version))),
            await failureOf(rejectFunction(() => world.deps).run(adminCall(version))),
            await failureOf(saveGcpsFunction(() => world.deps).run(adminCall(saving))),
            await failureOf(saveGcpsFunction(() => published.deps).run(adminCall({ ...saving, versionId: f.versionId }))),
            await failureOf(cropFunction(() => published.deps).run(adminCall({ cityId: CITY, layerId: f.layerId, ring }))),
            await failureOf(layerDeleteFunction(() => published.deps).run(adminCall({ cityId: CITY, layerId: f.layerId }))),
        ];

        expect(failures.map((failure) => failure.details)).toEqual(
            Array.from({ length: 6 }, () => expect.objectContaining(held) as unknown),
        );
        expect(await readVersion(world, 'v-f039')).toEqual(before);
    });

    it('happyPath_pointsOnAFrameWaitingForThemContinueItsOwnJob_theJoinWaitsOn @S-A65-BAD-PART-NEEDS-POINTS', async () => {
        const world = await readyWorld();
        await seedVersion(world, 'v-f039', { ...needsGcpsVersion(), partOf: JOIN });
        await seedJob(world, 'v-f039', partJob('v-f039', needsGcpsVersion().layerId, { status: 'awaiting_gcps', waitReason: undefined }));
        await seedVersion(world, JOIN, joinVersion({ jobId: JOIN, state: 'processing', output: undefined, join: undefined }));

        const answer = await saveGcpsFunction(() => world.deps).run(adminCall({ ...version, transform: 'affine', gcps: pairs() }));

        expect(answer).toMatchObject({ resumed: true, versionId: 'v-f039' });
        expect((await readVersion(world, 'v-f039'))?.partOf).toBe(JOIN);
    });

    it('happyPath_afterTheJoinEndedTheFrameIsAnOrdinaryOne_aStalePartOfIsIgnored @S-A65-BAD-REJECTED', async () => {
        const world = await readyWorld();
        await seedJoinOfTwo(world, JOIN, { state: 'rejected' }, { status: 'cancelled', waitReason: undefined });

        await expect(approveFunction(() => world.deps).run(adminCall(version))).resolves.toMatchObject({ state: 'approved' });
        await expect(rejectFunction(() => world.deps).run(adminCall({ cityId: CITY, versionId: 'v-f040' }))).resolves.toEqual({
            state: 'rejected',
        });
        // Rejecting the join itself touched neither frame nor scene: only the frame's own rejection frees its scene.
        expect((await readJob(world, 'v-f039'))?.status).toBe('awaiting_approval');
    });

    it('happyPath_aLayerWhoseFramesJoinEndedIsDeleted', async () => {
        const mapbox = { tilesetId: 'a.b', origin: 'mts' as const, publishedAt: at(NOW) };
        const world = await readyWorld();
        const f = await seedPart(world, F039, { partOf: JOIN, state: 'published', mapbox }, { status: 'succeeded' });
        await seedVersion(world, JOIN, joinVersion({ jobId: JOIN, state: 'rejected' }));
        await seedLayer(world, f.layerId, { currentVersion: f.versionId });

        await expect(layerDeleteFunction(() => world.deps).run(adminCall({ cityId: CITY, layerId: f.layerId }))).resolves.toBeDefined();
    });

    it('happyPath_rejectingAJoinLeavesItsFramesAndScenes @S-A65-BAD-REJECTED', async () => {
        const world = await readyWorld();
        await seedJoinOfTwo(world, JOIN);

        await expect(rejectFunction(() => world.deps).run(adminCall({ cityId: CITY, versionId: JOIN }))).resolves.toEqual({
            state: 'rejected',
        });

        expect(await readVersion(world, 'v-f039')).toMatchObject({ state: 'awaiting_approval', partOf: JOIN });
        expect((await readJob(world, 'v-f040'))?.status).toBe('awaiting_approval');
        const scene = world.deps.documents.peek(FIRESTORE_PATHS.usgsScene(CITY, F039)) as { status: string; layerId: string };
        expect(scene).toMatchObject({ status: 'imported', layerId: 'layer-f039' });
    });
});

/** A rendered frame whose georeference would publish on its own. */
function measured(partOf?: string) {
    const georef = { ...goldenGeoref(), checkpointRmseM: 5, checkpointCount: 4 };
    return partVersion('v-f039', F039, { output: goldenOutput(), georef, ...(partOf === undefined ? {} : { partOf }) });
}

describe('the approval policy and a frame', () => {
    it('badPath_aHeldFrameNeverPublishesOnItsOwn_itsEstimateIsRecorded @S-A65-BAD-PART-NOT-AUTO', async () => {
        const world = await readyWorld();
        await seedVersion(world, 'v-f039', measured(JOIN));
        await seedJob(world, 'v-f039', partJob('v-f039', 'layer-f039'));
        await seedVersion(world, JOIN, joinVersion({ jobId: JOIN, state: 'processing', output: undefined, join: undefined }));

        await expect(applyApprovalPolicy(world.deps, CITY, 'v-f039')).resolves.toBe(false);

        const version = await readVersion(world, 'v-f039');
        expect(version?.state).toBe('awaiting_approval');
        expect(version?.estimate).toBeDefined();
        expect(world.deps.tasks.queued).toEqual([]);
    });

    it.each([
        { state: 'rejected' },
        { state: 'failed', error: { code: 'apiError.imagery.joinPartGone' } },
        { state: 'cancelled' },
    ] as const)(
        'badPath_aFrameOfAJoinThatEnded_$state_waitsForApprove_noHalfACityGoesPublicAlone @S-A65-BAD-ENDED-NOT-AUTO',
        async (ended) => {
            const world = await readyWorld();
            await seedVersion(world, 'v-f039', measured(JOIN));
            await seedJob(world, 'v-f039', partJob('v-f039', 'layer-f039'));
            await seedVersion(world, JOIN, joinVersion({ jobId: JOIN, ...ended }));

            await expect(applyApprovalPolicy(world.deps, CITY, 'v-f039')).resolves.toBe(false);

            const frame = await requireVersion(world, 'v-f039');
            expect(frame.state).toBe('awaiting_approval');
            // The tick asks no more: its estimate is recorded.
            expect(frame.estimate).toBeDefined();
        },
    );

    it('happyPath_aFrameNoJoinEverNamedFollowsThePolicy', async () => {
        const world = await readyWorld();
        await seedVersion(world, 'v-f039', measured());
        await seedJob(world, 'v-f039', partJob('v-f039', 'layer-f039'));

        await expect(applyApprovalPolicy(world.deps, CITY, 'v-f039')).resolves.toBe(true);
    });

    it('badPath_newPointsOnAFrameOfAJoinThatEndedKeepItFromPublishingAlone', async () => {
        const world = await readyWorld();
        await seedPart(world, F039, { partOf: JOIN, state: 'awaiting_approval' });
        await seedVersion(world, JOIN, joinVersion({ jobId: JOIN, state: 'failed', error: { code: 'apiError.imagery.joinPartGone' } }));

        await saveGcpsFunction(() => world.deps).run(adminCall({ cityId: CITY, versionId: 'v-f039', transform: 'affine', gcps: pairs() }));

        const replaced = (await world.deps.documents.query(`cities/${CITY}/layerVersions`, layerVersionDocSchema)).documents.find(
            (version) => version.data.basedOn === 'v-f039',
        );
        expect(replaced?.data.partOf).toBe(JOIN);
    });
});

async function logMessages(world: ImageryWorld, jobId: string): Promise<readonly string[]> {
    const lines = await world.deps.documents.query(FIRESTORE_PATHS.jobLogs(CITY, jobId), jobLogDocSchema);
    return lines.documents.map((line) => line.data.message);
}

describe('cancelling a frame a live join holds', () => {
    it.each(['awaiting_approval', 'running', 'mts_processing'] as const)(
        'badPath_aJobIn_%s_isNotEnded_theRequestIsWithdrawn @S-A65-BAD-CANCEL-HELD',
        async (status) => {
            const world = await heldWorld();
            const frame = await requireJob(world, 'v-f039');
            await seedJob(world, 'v-f039', { ...frame, status, cancelRequested: true, executionName: 'exec-1' });
            const before = await readVersion(world, 'v-f039');

            await expect(cancelJob(world.deps, CITY, 'v-f039')).resolves.toBe('skipped');

            const job = await readJob(world, 'v-f039');
            expect(job?.status).toBe(status);
            expect(job?.cancelRequested).toBeUndefined();
            expect(await readVersion(world, 'v-f039')).toEqual(before);
            expect(await logMessages(world, 'v-f039')).toContain('apiError.imagery.joinPartHeld');
            expect(world.jobs.cancelled).toEqual([]);
        },
    );

    it('happyPath_theJoinItselfStillCancels_itsFramesThenAreFree', async () => {
        const world = await heldWorld();
        const join = await requireJob(world, JOIN);
        await seedJob(world, JOIN, { ...join, cancelRequested: true });

        await expect(cancelJob(world.deps, CITY, JOIN)).resolves.toBe('cancelled');

        const frame = await requireJob(world, 'v-f039');
        await seedJob(world, 'v-f039', { ...frame, cancelRequested: true });
        await expect(cancelJob(world.deps, CITY, 'v-f039')).resolves.toBe('cancelled');
        expect((await readVersion(world, 'v-f039'))?.state).toBe('cancelled');
    });

    it('badPath_aFrameLeftAloneBetweenTheReadAndTheTransactionIsNotClobbered', async () => {
        const world = await heldWorld();
        const frame = await requireJob(world, 'v-f039');
        await seedJob(world, 'v-f039', { ...frame, cancelRequested: true });
        const transaction = world.deps.documents.transaction.bind(world.deps.documents);
        world.deps.documents.transaction = async (work) => {
            await world.deps.documents.delete(`cities/${CITY}/jobs/v-f039`);
            return transaction(work);
        };

        await expect(cancelJob(world.deps, CITY, 'v-f039')).resolves.toBe('skipped');

        expect(await readJob(world, 'v-f039')).toBeUndefined();
    });
});

describe('what the admins are told about a frame', () => {
    const write = (world: ImageryWorld) =>
        noticeJobChange(
            world.deps,
            { cityId: CITY, jobId: 'v-f039', job: partJob('v-f039', 'layer-f039') },
            partJob('v-f039', 'layer-f039', { status: 'running' }),
        );

    it('badPath_aHeldFrameIsNotAnnouncedAsReady', async () => {
        const world = await heldWorld();

        await write(world);

        expect(world.deps.documents.paths('notificationEvents')).toEqual([]);
    });

    it('happyPath_aFrameWhoseJoinEndedIsAnnounced', async () => {
        const world = await readyWorld();
        await seedJoinOfTwo(world, JOIN, { state: 'rejected' }, { status: 'cancelled', waitReason: undefined });

        await write(world);

        expect(world.deps.documents.paths('notificationEvents')).toHaveLength(1);
    });
});
