// M8 (docs/research/M8-join-interfaces.md §6): Join frames and Add {year} as the Imagery area runs them, the plan's feed, a
// join version as its page reads it, a frame a live join holds, and Settings' search after saving the target years.
import { FIRESTORE_PATHS, datePlanDocSchema, imagerySettingsOf, type DatePlanRow } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { ImageryFeeds, type FeedsPatch } from '../../src/imagery/feeds.js';
import { IMAGERY_MODULE } from '../../src/imagery/imagery.js';
import { IDLE_JOIN, JOIN_WAIT_MS, JOIN_WAIT_TRIES, JoinActions, type JoinActionsState } from '../../src/imagery/join.js';
import { approvalFigures, versionViewOf } from '../../src/imagery/version-view.js';
import { versionItemOf } from '../../src/imagery/model.js';
import { failure, settle } from '../app/fakes.js';
import { answer, at, CITY, callsOf, cityDoc, golden, imageryWorld, SCENES, sceneDoc, setupStatus, VERSIONS, versionDoc } from './world.js';

const ANSWER = { jobId: 'job-join', versionId: 'job-join', layerId: 'kh-9-1972' };
const ROW: DatePlanRow = {
    date: '1972-08-08',
    sensor: 'KH-9-pan',
    frames: [
        { entityId: 'D3C1202-200149F039', free: true, versionId: 'job-f039', state: 'awaiting_approval' },
        { entityId: 'D3C1202-200149F040', free: true },
    ],
    paidFrames: [],
    coveragePct: 96,
    framesToDownload: 1,
    winter: false,
};

function seeded() {
    const world = imageryWorld();
    world.clock.current = Date.parse('2026-10-20T09:00:00Z');
    world.store.docs.set(FIRESTORE_PATHS.setupStatus, setupStatus('ok'));
    world.store.docs.set(FIRESTORE_PATHS.city(CITY), cityDoc({ imagery: { rmseThresholdM: 9, targetYears: [1978, 1966] } }));
    world.store.docs.set(SCENES('a'), sceneDoc('a', { harvestedAt: at('2026-10-15T00:00:00Z') }));
    return world;
}

describe('Join frames', () => {
    it('happyPath_theCallableGetsTheFramesAndTheNewVersionsIdComesBack', async () => {
        const { services, callables } = seeded();
        const imagery = IMAGERY_MODULE.create(services);
        answer(callables, 'imagery.join', () => ANSWER);
        imagery.open([]);

        const running = imagery.intents.joinFrames(['F039', 'F040']);
        expect(imagery.state.joining).toBe('F039');

        await expect(running).resolves.toBe('job-join');
        expect(callsOf(callables, 'imagery.join')).toEqual([{ cityId: CITY, entityIds: ['F039', 'F040'] }]);
        expect(imagery.state.joining).toBeNull();
        expect(imagery.state.joinRefusal).toBeNull();
    });

    it('badPath_aRefusalStaysByItsFirstFrameUntilTheNextJoin', async () => {
        const { services, callables } = seeded();
        const imagery = IMAGERY_MODULE.create(services);
        callables.fail('imagery.join', failure('failed-precondition', 'apiError.imagery.joinMixedFrames'));

        await expect(imagery.intents.joinFrames(['F039', 'F040'])).resolves.toBeNull();
        expect(imagery.state.joinRefusal).toEqual({ id: 'F039', notice: { key: 'apiError.imagery.joinMixedFrames' } });

        answer(callables, 'imagery.join', () => ANSWER);
        await expect(imagery.intents.joinFrames(['F039', 'F040'])).resolves.toBe('job-join');
        expect(imagery.state.joinRefusal).toBeNull();
    });

    // M18 item 4 (docs/research/M18-improvements.md): a frame's layer still busy is said plainly, with Join when it ends.
    it('happyPath_aBusyLayerOffersJoinWhenItEnds_whichJoinsByItselfOnceTheLayerIsFree @S-A65-HAPPY-JOIN-WHEN-FREE', async () => {
        const { services, callables, clock, notices } = seeded();
        const imagery = IMAGERY_MODULE.create(services);
        callables.fail('imagery.join', failure('failed-precondition', 'apiError.imagery.joinLayerBusy'));

        await expect(imagery.intents.joinFrames(['F039', 'F040'])).resolves.toBeNull();
        expect(imagery.state.joinRefusal).toEqual({ id: 'F039', notice: { key: 'apiError.imagery.joinLayerBusy' } });
        const offer = notices.at(-1);
        expect(offer).toMatchObject({ key: 'apiError.imagery.joinLayerBusy', action: { key: 'adminContent.imagery.join.whenFree' } });

        offer?.action?.run();
        expect(imagery.state.joinRefusal?.notice).toEqual({ key: 'adminContent.imagery.join.waitingFree' });
        clock.advance(JOIN_WAIT_MS);
        await settle();
        expect(callsOf(callables, 'imagery.join')).toHaveLength(2);
        expect(imagery.state.joinRefusal?.notice).toEqual({ key: 'adminContent.imagery.join.waitingFree' });

        answer(callables, 'imagery.join', () => ANSWER);
        clock.advance(JOIN_WAIT_MS);
        await settle();
        expect(callsOf(callables, 'imagery.join')).toHaveLength(3);
        expect(imagery.state.joinRefusal).toBeNull();
        expect(notices.at(-1)).toEqual({ key: 'adminContent.imagery.join.started' });
        clock.advance(JOIN_WAIT_MS);
        await settle();
        expect(callsOf(callables, 'imagery.join')).toHaveLength(3);
    });

    it('badPath_aWaitingJoinRefusedOtherwiseSaysWhyAndStops_andTheAreaEndingStopsIt @S-A65-BAD-JOIN-LAYER-BUSY', async () => {
        const { services, callables, clock, notices } = seeded();
        const imagery = IMAGERY_MODULE.create(services);
        callables.fail('imagery.join', failure('failed-precondition', 'apiError.imagery.joinLayerBusy'));
        await imagery.intents.joinFrames(['F039', 'F040']);
        notices.at(-1)?.action?.run();

        callables.fail('imagery.join', failure('failed-precondition', 'apiError.imagery.joinPartGone', { frame: 'F040' }));
        clock.advance(JOIN_WAIT_MS);
        await settle();
        expect(imagery.state.joinRefusal).toEqual({
            id: 'F039',
            notice: { key: 'apiError.imagery.joinPartGone', params: { frame: 'F040' } },
        });
        expect(notices.at(-1)).toEqual({ key: 'apiError.imagery.joinPartGone', params: { frame: 'F040' } });

        callables.fail('imagery.join', failure('failed-precondition', 'apiError.imagery.joinLayerBusy'));
        await imagery.intents.joinFrames(['F039', 'F040']);
        notices.at(-1)?.action?.run();
        imagery.destroy();
        clock.advance(JOIN_WAIT_MS);
        await settle();
        expect(callsOf(callables, 'imagery.join')).toHaveLength(3);
    });

    it('badPath_aLayerStillBusyAfterEveryTryIsSaidAgain', async () => {
        const { services, callables, clock, notices } = seeded();
        const actions = new JoinActions(services, () => undefined);
        callables.fail('imagery.join', failure('failed-precondition', 'apiError.imagery.joinLayerBusy'));
        await actions.join(['F039']);
        notices.at(-1)?.action?.run();

        for (let index = 0; index < JOIN_WAIT_TRIES; index += 1) {
            callables.fail('imagery.join', failure('failed-precondition', 'apiError.imagery.joinLayerBusy'));
            clock.advance(JOIN_WAIT_MS);
            await settle();
        }

        expect(callsOf(callables, 'imagery.join')).toHaveLength(JOIN_WAIT_TRIES + 1);
        expect(notices.at(-1)).toEqual({ key: 'apiError.imagery.joinLayerBusy' });
    });

    it('badPath_anAnswerThatFailsItsSchemaIsInternalAndNoFramesRunNothing', async () => {
        const { services, callables } = seeded();
        const states: Partial<JoinActionsState>[] = [];
        const actions = new JoinActions(services, (state) => states.push(state));
        answer(callables, 'imagery.join', () => ({ jobId: 'no' }) as never);

        await expect(actions.join([])).resolves.toBeNull();
        expect(states).toEqual([]);
        await expect(actions.join(['F039', 'F040'])).resolves.toBeNull();
        expect(states.at(-1)).toEqual({ joining: null, joinRefusal: { id: 'F039', notice: { key: 'apiError.internal' } } });
    });

    it('badPath_oneActionAtATime', async () => {
        const { services, callables } = seeded();
        const actions = new JoinActions(services, () => undefined);
        let release = (): void => undefined;
        const held = new Promise<void>((done) => {
            release = done;
        });
        answer(callables, 'imagery.join', async () => {
            await held;
            return ANSWER;
        });
        const search = (): Promise<void> => Promise.resolve();
        const settings = imagerySettingsOf({ rmseThresholdM: 15 });

        const first = actions.join(['F039', 'F040']);
        await expect(actions.join(['F039', 'F040'])).resolves.toBeNull();
        await expect(actions.addYear(1972, { settings, version: null, search })).resolves.toBe(false);
        release();
        await first;

        expect(callsOf(callables, 'imagery.join')).toHaveLength(1);
        expect(IDLE_JOIN).toEqual({ joining: null, joinRefusal: null, addingYear: null });
    });
});

describe('Add {year} to target years', () => {
    it('happyPath_theYearIsSavedInOrderAndTheSearchRanksAgain', async () => {
        const { services, callables, store, notices } = seeded();
        const imagery = IMAGERY_MODULE.create(services);
        answer(callables, 'imagery.search', () => ({
            found: 1,
            added: 0,
            updated: 0,
            failedDatasets: [],
            searchedAt: '2026-11-06T10:00:00.000Z',
        }));
        imagery.open([]);
        await settle();

        const running = imagery.intents.addTargetYear(1972);
        expect(imagery.state.addingYear).toBe(1972);

        await expect(running).resolves.toBe(true);
        await settle();
        expect(store.docs.get(FIRESTORE_PATHS.city(CITY))?.['imagery']).toEqual({
            autoPublish: true,
            rmseThresholdM: 9,
            targetYears: [1966, 1972, 1978],
            publishThroughMapbox: false,
            mapThresholdMaxM: 60,
            mapAutoPublish: true,
            landsatAuto: true,
            landsatFrom: 1984,
            landsatTo: undefined,
        });
        expect(callsOf(callables, 'imagery.search')).toEqual([{ cityId: CITY }]);
        expect(imagery.state.addingYear).toBeNull();
        expect(notices.at(-1)).toEqual({ key: 'adminContent.settings.saved' });
    });

    it('badPath_aRefusedSaveSaysWhyAndSearchesNothing', async () => {
        const { services, callables, store, notices } = seeded();
        const imagery = IMAGERY_MODULE.create(services);
        imagery.open([]);
        await settle();
        store.outcomes.push({ ok: false, reason: 'conflict' });

        await expect(imagery.intents.addTargetYear(1972)).resolves.toBe(false);

        expect(callsOf(callables, 'imagery.search')).toEqual([]);
        expect(notices.at(-1)).toEqual({ key: 'adminContent.settings.refused.conflict' });
    });

    it('badPath_aRefusalForAccessAlsoMakesTheShellAskAgain', async () => {
        const world = imageryWorld();
        const actions = new JoinActions(world.services, () => undefined);
        world.store.outcomes.push({ ok: false, reason: 'denied' });

        const settings = imagerySettingsOf({ rmseThresholdM: 15 });
        await expect(actions.addYear(1972, { settings, version: null, search: () => Promise.resolve() })).resolves.toBe(false);

        expect(world.denials.count).toBe(1);
        expect(world.notices.at(-1)).toEqual({ key: 'adminContent.settings.refused.denied' });
    });
});

describe('the plan of the dates', () => {
    function feeds() {
        const world = imageryWorld();
        const patches: FeedsPatch[] = [];
        const reads = new ImageryFeeds(world.services, (patch) => patches.push(patch));
        const dates = (): FeedsPatch['dates'] => patches.filter((patch) => 'dates' in patch).at(-1)?.dates;
        return { ...world, reads, dates };
    }

    it('happyPath_itsRowsAreReadLive', () => {
        const { reads, store, dates } = feeds();
        const plan = { rows: [ROW], updatedAt: at('2026-10-15T00:00:00Z') };
        expect(datePlanDocSchema.safeParse(plan).success).toBe(true);
        store.docs.set(FIRESTORE_PATHS.imageryPlan(CITY), plan);

        reads.start(true);

        expect(dates()).toEqual([ROW]);
        reads.stop();
    });

    it('badPath_noPlanIsNoRowAndAPlanThatFailsItsSchemaIsNoRow', () => {
        const { reads, store, dates } = feeds();

        reads.start(true);
        expect(dates()).toEqual([]);
        reads.stop();

        store.docs.set(FIRESTORE_PATHS.imageryPlan(CITY), { rows: 'no' });
        reads.start(true);
        expect(dates()).toEqual([]);
    });
});

describe('a join version as its page reads it', () => {
    const JOIN = golden('version.join.json');
    const stored = (data: Record<string, unknown>) => ({ id: 'job-join', path: VERSIONS('job-join'), data, version: '', pending: false });
    const doc = (data: Record<string, unknown>) => versionViewOf(stored(data) as never);

    it('happyPath_itsFramesAndItsReportWithNoScan', () => {
        const view = doc(JOIN);

        expect(view.origin).toBe('join');
        expect(view.parts.map((part) => part.entityId)).toEqual(['D3C1202-200149F039', 'D3C1202-200149F040']);
        expect(view.join).toEqual(JOIN['join']);
        expect([view.entityId, view.partOf, view.hasScan, view.georef]).toEqual([null, null, false, null]);
    });

    it('happyPath_theApprovalFiguresReadTheWorstFramesError', () => {
        const figures = approvalFigures(doc(JOIN), undefined, 15);

        expect(figures.checkpointRmseM).toBeCloseTo((JOIN['join'] as { checkpointRmseM: number }).checkpointRmseM);
    });

    it('happyPath_aUsgsFrameNamesItsSceneAndItsJoin', () => {
        const frame = versionDoc({ partOf: 'job-join' });
        const view = doc(frame);

        expect(view.entityId).toBe((frame['source'] as { entityId: string }).entityId);
        expect(view.partOf).toBe('job-join');
        expect(view.parts).toEqual([]);
        expect(versionItemOf(stored(frame) as never).partOf).toBe('job-join');
        expect(versionItemOf(stored(frame) as never).entityIds).toEqual([(frame['source'] as { entityId: string }).entityId]);
    });

    it('badPath_anUploadHasNoSceneAndNoJoin', () => {
        const view = doc(versionDoc({ source: { kind: 'upload', uploadPath: 'uploads/a.tif', bytes: 1 } }));
        const bare = doc({ ...versionDoc(), source: undefined });

        expect([view.entityId, view.partOf, view.join]).toEqual([null, null, null]);
        expect(bare.entityId).toBeNull();
        expect(versionItemOf(stored(versionDoc()) as never).partOf).toBeNull();
        expect(
            versionItemOf(stored(versionDoc({ source: { kind: 'upload', uploadPath: 'uploads/a.tif', bytes: 1 } })) as never).entityIds,
        ).toEqual([]);
    });

    it('happyPath_aJoinItemNamesAllItsFrames', () => {
        expect(versionItemOf(stored(JOIN) as never).entityIds).toEqual(['D3C1202-200149F039', 'D3C1202-200149F040']);
    });
});

describe('the version page reads its frame scene', () => {
    it('happyPath_theScenesCoverageArrivesByItsOwnReadAndLeavesWithThePage', async () => {
        const world = seeded();
        const version = versionDoc();
        const entityId = (version['source'] as { entityId: string }).entityId;
        world.store.docs.set(VERSIONS('job-1966-0712'), version);
        world.store.docs.set(SCENES(entityId), sceneDoc(entityId, { coverage: 0.51 }));
        const imagery = IMAGERY_MODULE.create(world.services);

        imagery.open(['version', 'job-1966-0712']);
        await settle();
        expect(imagery.state.named.scene?.coverage).toBeCloseTo(0.51);

        imagery.open([]);
        await settle();
        expect(imagery.state.named.scene).toBeNull();
    });

    it('badPath_anUploadsPageReadsNoScene', async () => {
        const world = seeded();
        world.store.docs.set(VERSIONS('up'), versionDoc({ source: { kind: 'upload', uploadPath: 'uploads/a.tif', bytes: 1 } }));
        const imagery = IMAGERY_MODULE.create(world.services);

        imagery.open(['version', 'up']);
        await settle();

        expect(imagery.state.named.scene).toBeNull();
    });
});
