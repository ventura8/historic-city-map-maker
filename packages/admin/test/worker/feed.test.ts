import { FIRESTORE_PATHS, type SetupStatusView } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { JOBS_MODULE } from '../../src/jobs/jobs.js';
import { createWorkerFeed, type WorkerState } from '../../src/worker/feed.js';
import { failure } from '../app/fakes.js';
import { at, CITY, contentWorld, type ContentWorld } from '../content/world.js';

const DIGEST = `sha256:${'a'.repeat(64)}`;
const WORKER = 'w-0123456789abcdef';

/** An ISO time `seconds` before the fake clock's now. */
function before(world: ContentWorld, seconds: number): string {
    return new Date(world.clock.now() - seconds * 1000).toISOString();
}

function workerDoc(seenAt: string, more: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        uid: 'admin-uid',
        version: '1.0.0',
        startedAt: at('2025-10-01T00:00:00Z'),
        lastSeenAt: at(seenAt),
        state: 'idle',
        updatedBy: 'system:worker',
        updatedAt: at(seenAt),
        ...more,
    };
}

function jobDoc(more: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        type: 'usgs-import',
        status: 'queued',
        params: { sensor: 'KH-4A' },
        createdBy: 'admin-uid',
        createdAt: at('2025-10-09T08:00:00Z'),
        updatedBy: 'system:imagery',
        updatedAt: at('2025-10-09T08:00:00Z'),
        ...more,
    };
}

function status(image?: string): SetupStatusView {
    const pipeline = { state: 'installed', checkedAt: '2025-10-09T08:00:00.000Z', ...(image === undefined ? {} : { image }) };
    return { install: { pipeline } } as unknown as SetupStatusView;
}

function feedOf(world: ContentWorld, jobId: string | null = null): { feed: ReturnType<typeof createWorkerFeed>; states: WorkerState[] } {
    const feed = createWorkerFeed(world.services);
    const states: WorkerState[] = [];
    feed.subscribe((state) => {
        states.push(state);
    });
    feed.start(jobId);
    return { feed, states };
}

async function settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('the local worker feed', () => {
    it('happyPath_aWorkerSeenAMinuteAgoIsConnectedUntilThreeMinutesPassWithItsChoiceUsageAndImage', async () => {
        const world = contentWorld();
        world.callables.answer('setup.status', () => status(DIGEST));
        world.store.docs.set(
            FIRESTORE_PATHS.worker(CITY, WORKER),
            workerDoc(before(world, 60), { lastJob: { id: 'j1', outcome: 'done', at: at('2025-10-09T08:00:00Z') } }),
        );
        world.store.docs.set(FIRESTORE_PATHS.worker(CITY, 'w-ffffffffffffffff'), workerDoc(before(world, 3600)));
        world.store.docs.set(FIRESTORE_PATHS.runChoice(CITY), {
            choice: 'local',
            updatedBy: 'admin-uid',
            updatedAt: at('2025-10-09T08:00:00Z'),
        });
        world.store.docs.set(FIRESTORE_PATHS.cloudRunUsage('2025-10'), {
            month: '2025-10',
            vcpuSeconds: 12_345,
            gibSeconds: 45_678,
            runs: 3,
            updatedBy: 'system:imagery',
            updatedAt: at('2025-10-09T08:00:00Z'),
        });

        const { feed } = feedOf(world);
        await settle();

        expect(feed.state).toMatchObject({
            city: CITY,
            status: 'ready',
            connected: true,
            choice: 'local',
            image: DIGEST,
            usage: { vcpuSeconds: 12_345, gibSeconds: 45_678 },
            job: null,
            worker: {
                id: WORKER,
                version: '1.0.0',
                state: 'idle',
                jobId: null,
                lastJob: { id: 'j1', outcome: 'done', at: '2025-10-09T08:00:00.000Z' },
            },
        });
        // Two minutes on, it no longer counts as connected (seen 180 s ago at most).
        world.clock.advance(120_001);
        expect(feed.state.connected).toBe(false);
        feed.stop();
    });

    it('badPath_noWorkerNoChoiceNoUsageAndNoImageReadAsNoneAutoZeroAndNull', async () => {
        const world = contentWorld();
        world.callables.answer('setup.status', () => status());
        const { feed } = feedOf(world);
        await settle();

        expect(feed.state).toMatchObject({ status: 'ready', worker: null, connected: false, choice: 'auto', image: null });
        expect(feed.state.usage).toEqual({ vcpuSeconds: 0, gibSeconds: 0 });
    });

    it('badPath_aStaleWorkerIsNotConnectedAndAFailedStatusCallMeansNoImage', async () => {
        const world = contentWorld();
        world.callables.fail('setup.status', failure('permission-denied', 'apiError.notAdmin'));
        world.store.docs.set(FIRESTORE_PATHS.worker(CITY, WORKER), workerDoc(before(world, 600), { state: 'busy', jobId: 'j2' }));
        const { feed } = feedOf(world);
        await settle();

        expect(feed.state).toMatchObject({ connected: false, image: null, worker: { state: 'busy', jobId: 'j2', lastJob: null } });
    });

    it('happyPath_theChoiceChangesThroughImageryRunOnWithoutAJob', async () => {
        const world = contentWorld();
        world.callables.answer('imagery.runOn', () => ({ choice: 'cloud' }));
        const { feed } = feedOf(world);

        await expect(feed.intents.setChoice('cloud')).resolves.toBe(true);

        expect(world.callables.calls.filter((call) => call.name === 'imagery.runOn').map((call) => call.request)).toEqual([
            { cityId: CITY, runOn: 'cloud' },
        ]);
        expect(feed.state).toMatchObject({ acting: false, refusal: null });
    });

    it('badPath_aRefusedChangeIsSaidAndASecondOneWhileTheFirstIsOnItsWayIsIgnored', async () => {
        const world = contentWorld();
        world.callables.fail('imagery.runOn', failure('failed-precondition', 'apiError.imagery.versionState'));
        const { feed } = feedOf(world);

        const first = feed.intents.setChoice('local');
        await expect(feed.intents.setChoice('cloud')).resolves.toBe(false);
        await expect(first).resolves.toBe(false);

        expect(feed.state.refusal).toEqual({ key: 'apiError.imagery.versionState' });
        expect(world.callables.named('imagery.runOn')).toBe(1);
    });
});

describe("the local worker feed: a version's job and the failures", () => {
    it('happyPath_aVersionsJobItsPlaceItsWaitAndItsEstimateAndTheOkPastTheFreeTier', async () => {
        const world = contentWorld();
        world.callables.answer('imagery.runOn', () => ({ choice: 'cloud', runOn: 'cloud' }));
        world.store.docs.set(FIRESTORE_PATHS.job(CITY, 'j1'), jobDoc({ runOn: 'cloud', waitReason: 'free-tier' }));
        const { feed } = feedOf(world, 'j1');

        // The download on `fetch` (1,800 s × 1 vCPU, 4 GiB), the processing on `std` (2,700 s × 2 vCPU, 8 GiB).
        expect(feed.state.job).toEqual({
            id: 'j1',
            status: 'queued',
            runOn: 'cloud',
            waitReason: 'free-tier',
            estimate: { vcpuSeconds: 7200, gibSeconds: 28_800 },
            step: null,
            progress: null,
            overdue: false,
            paused: null,
        });
        expect(world.callables.named('setup.status')).toBe(0);
        await expect(feed.intents.runJob('cloud', true)).resolves.toBe(true);
        await expect(feed.intents.runJob('local', false)).resolves.toBe(true);

        expect(world.callables.calls.filter((call) => call.name === 'imagery.runOn').map((call) => call.request)).toEqual([
            { cityId: CITY, jobId: 'j1', runOn: 'cloud', freeTierOk: true },
            { cityId: CITY, jobId: 'j1', runOn: 'local' },
        ]);
    });

    it('happyPath_aJoinRunsOnThePipelineSoItHasAPlace', () => {
        const world = contentWorld();
        const parts = [
            { versionId: 'a', layerId: 'la' },
            { versionId: 'b', layerId: 'lb' },
        ];
        const params = { parts, sensor: 'KH-9-pan' };
        world.store.docs.set(FIRESTORE_PATHS.job(CITY, 'join'), jobDoc({ type: 'layer-join', params, waitReason: 'parts' }));

        expect(feedOf(world, 'join').feed.state.job).toMatchObject({ id: 'join', waitReason: 'parts' });
    });

    it('happyPath_anArchiveSeriesRunsOnThePipelineSoItsPageShowsItsPlace', () => {
        const world = contentWorld();
        const params = {
            archiveId: 'ar-0123456789abcdef',
            seriesId: 's-000000000000',
            class: 'grid',
            sheets: 4,
            encoding: 'lineart',
            order: 0,
            referenceLayerIds: [],
        };
        world.store.docs.set(
            FIRESTORE_PATHS.job(CITY, 'series'),
            jobDoc({ type: 'archive-series', params, runOn: 'local', localOnly: true, waitReason: 'daily' }),
        );

        expect(feedOf(world, 'series').feed.state.job).toMatchObject({ id: 'series', runOn: 'local', waitReason: 'daily' });
    });

    it('badPath_aJobThePipelineDoesNotRunOrNoJobAtAllHasNoPlace', async () => {
        const world = contentWorld();
        world.store.docs.set(FIRESTORE_PATHS.job(CITY, 'del'), jobDoc({ type: 'layer-delete', params: {} }));
        const { feed } = feedOf(world, 'del');

        expect(feed.state.job).toBeNull();
        await expect(feed.intents.runJob('local', false)).resolves.toBe(false);
        expect(world.callables.named('imagery.runOn')).toBe(0);

        const none = feedOf(contentWorld(), 'missing').feed;
        expect(none.state.job).toBeNull();

        // A queued import the dispatcher has not placed yet: no place, no wait.
        world.store.docs.set(FIRESTORE_PATHS.job(CITY, 'new'), jobDoc());
        expect(feedOf(world, 'new').feed.state.job).toMatchObject({ runOn: null, waitReason: null });
    });

    it('badPath_aRefusedListenerSaysWhyAndTryAgainReadsAgain', async () => {
        const world = contentWorld();
        world.callables.answer('setup.status', () => status(DIGEST));
        const { feed } = feedOf(world);
        world.store.fail(FIRESTORE_PATHS.workers(CITY), { kind: 'denied', code: 'permission-denied' });

        expect(feed.state).toMatchObject({ status: 'error', failure: { kind: 'denied' } });
        expect(world.denials.count).toBe(1);
        feed.intents.retry();
        expect(feed.state.status).toBe('ready');
        await settle();
    });

    it('happyPath_theJobsStoreHandsOutFeedsAndRegistersTheElements', async () => {
        const world = contentWorld();
        const jobs = JOBS_MODULE.create(world.services);

        const feed = await jobs.intents.worker();
        await jobs.intents.workerElements();

        expect(feed.state.city).toBe(CITY);
        expect(globalThis.customElements.get('hcm-worker-panel')).toBeDefined();
        expect(globalThis.customElements.get('hcm-run-place')).toBeDefined();
    });
});

describe('the local worker feed: pairing, progress and Disconnect (findings 66-68 of 2026-11-02)', () => {
    it('happyPath_thePanelMintsNoCodeOnItsOwnAndHandsOutTheComputersPart @S-A62-HAPPY-PAIR', async () => {
        // Finding 72: the code is minted only when the computer's part needs one (auto-pair, or Advanced opened).
        const world = contentWorld();
        world.callables.answer('setup.status', () => status(DIGEST));
        const { feed } = feedOf(world);
        await settle();

        const local = await feed.intents.local('demo-hcm');

        expect(world.callables.named('worker.pairCode')).toBe(0);
        expect(local.state).toMatchObject({ phase: 'none', code: null });
        expect(globalThis.customElements.get('hcm-worker-local')).toBeDefined();
    });

    it('happyPath_theConnectedWorkersJobIsFollowedLiveAndDroppedWhenItIsIdle', async () => {
        const world = contentWorld();
        world.callables.answer('setup.status', () => status());
        world.store.docs.set(FIRESTORE_PATHS.job(CITY, 'j3'), jobDoc({ status: 'running', runOn: 'local', step: 'georef', progress: 0.4 }));
        world.store.docs.set(FIRESTORE_PATHS.worker(CITY, WORKER), workerDoc(before(world, 10), { state: 'busy', jobId: 'j3' }));
        const { feed } = feedOf(world);
        await settle();

        expect(feed.state.job).toMatchObject({ id: 'j3', step: 'georef', progress: 0.4, overdue: false });
        world.store.put(FIRESTORE_PATHS.worker(CITY, WORKER), workerDoc(before(world, 5), { state: 'idle' }));
        await settle();
        expect(feed.state.job).toBeNull();
        feed.stop();
    });

    it('happyPath_itReadsWhatTheWorkerSaidOfItsLocalAi @S-A68-HAPPY-DEVICE-SHOWN', async () => {
        const world = contentWorld();
        world.callables.answer('setup.status', () => status());
        const ai = { state: 'ready', device: 'gpu', deviceName: 'NVIDIA RTX 3080' } as const;
        world.store.docs.set(FIRESTORE_PATHS.worker(CITY, WORKER), workerDoc(before(world, 10), { ai }));
        const { feed } = feedOf(world);
        await settle();

        expect(feed.state.worker?.ai).toEqual(ai);
    });

    it('badPath_aWorkerOlderThanTheAiHasNone @S-A68-BAD-AI-UNAVAILABLE', async () => {
        const world = contentWorld();
        world.callables.answer('setup.status', () => status());
        world.store.docs.set(FIRESTORE_PATHS.worker(CITY, WORKER), workerDoc(before(world, 10)));
        const { feed } = feedOf(world);
        await settle();

        expect(feed.state.worker?.ai).toBeNull();
    });

    it('happyPath_disconnectRevokesTheSeenWorker @S-A62-HAPPY-DISCONNECT', async () => {
        const world = contentWorld();
        world.callables.answer('setup.status', () => status());
        world.callables.answer('worker.revoke', () => ({ revoked: true }));
        world.store.docs.set(FIRESTORE_PATHS.worker(CITY, WORKER), workerDoc(before(world, 10), { outdated: true }));
        const { feed } = feedOf(world);
        await settle();

        expect(feed.state.worker).toMatchObject({ outdated: true, revoked: false });
        await expect(feed.intents.disconnect()).resolves.toBe(true);
        expect(world.callables.calls.find((call) => call.name === 'worker.revoke')?.request).toEqual({ cityId: CITY, workerId: WORKER });

        world.store.put(FIRESTORE_PATHS.worker(CITY, WORKER), workerDoc(before(world, 5), { revokedAt: at('2025-10-09T08:00:00Z') }));
        await settle();
        expect(feed.state).toMatchObject({ connected: false, worker: { revoked: true } });
        feed.stop();
    });

    it('badPath_noWorkerOrARefusedDisconnectIsSaid', async () => {
        const world = contentWorld();
        world.callables.answer('setup.status', () => status());
        world.callables.fail('worker.revoke', failure('permission-denied', 'apiError.city.notMember'));
        const { feed } = feedOf(world);
        await settle();
        await expect(feed.intents.disconnect()).resolves.toBe(false);

        world.store.put(FIRESTORE_PATHS.worker(CITY, WORKER), workerDoc(before(world, 10)));
        await settle();
        await expect(feed.intents.disconnect()).resolves.toBe(false);
        expect(feed.state.refusal).toEqual({ key: 'apiError.city.notMember' });
        feed.stop();
    });

    it('happyPath_aJobNoComputerCameForIsOverdue @S-A62-HAPPY-NO-WORKER-OFFER', () => {
        const world = contentWorld();
        world.store.docs.set(
            FIRESTORE_PATHS.job(CITY, 'j4'),
            jobDoc({ runOn: 'local', waitReason: 'worker', workerOverdueAt: at('2025-10-09T08:20:00Z') }),
        );
        expect(feedOf(world, 'j4').feed.state.job).toMatchObject({ overdue: true, waitReason: 'worker' });
    });
});
