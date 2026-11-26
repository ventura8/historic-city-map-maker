/**
 * `imagery.join` (`functions/src/imagery/{join,join-write}.ts`, `docs/research/M8-join-interfaces.md` §5): one date's frames
 * become one layer. Every check comes before anything is created; missing frames are imported for it, existing ones marked; a
 * join still awaiting approval gives way to one sharing a frame ("add a frame"), any other live join refuses.
 */
import { DEFAULT_NEW_CITY_LIMITS, FIRESTORE_PATHS, JOBS_PER_DAY, cityDocSchema, jobDocSchema, timestampFromDate } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { joinFunction } from '../../src/imagery/join.js';
import { failureOf } from '../admin/world.js';
import { adminCall } from '../publish/fakes.js';
import {
    DATE,
    F039,
    F040,
    F041,
    frameFields,
    joinVersion,
    joinSource,
    partVersion,
    requireVersion,
    seedJoinOfTwo,
    seedPart,
} from './join-world.js';
import {
    CITY,
    NOW,
    at,
    readJob,
    readLayer,
    readScene,
    readVersion,
    readyWorld,
    seedGuard,
    seedJob,
    seedLayer,
    seedScene,
    seedSetup,
    seedVersion,
    type ImageryWorld,
} from './world.js';

const JOIN_ID_PREFIX = 'jn-';

function join(world: ImageryWorld, entityIds: readonly string[]) {
    return joinFunction(() => world.deps).run(adminCall({ cityId: CITY, entityIds }));
}

/** Free scenes USGS confirms. */
async function seedFree(world: ImageryWorld, ...entityIds: readonly string[]): Promise<void> {
    for (const entityId of entityIds) {
        await seedScene(world, entityId, frameFields());
        world.scenes.options.set(entityId, { entityId, available: true, bytes: 1 });
    }
}

/** How many jobs and versions exist: nothing created means both stay as seeded. */
function counts(world: ImageryWorld) {
    return {
        jobs: world.deps.documents.paths(`${FIRESTORE_PATHS.jobs(CITY)}/`).length,
        versions: world.deps.documents.paths(`${FIRESTORE_PATHS.layerVersions(CITY)}/`).length,
    };
}

async function codeOf(promise: Promise<unknown>): Promise<unknown> {
    return (await failureOf(promise)).details;
}

describe('imagery.join: what it creates', () => {
    it('happyPath_twoMissingFramesAreImportedForTheJoinWhichWaitsForThem @S-A65-HAPPY', async () => {
        const world = await readyWorld();
        await seedFree(world, F039, F040);

        const answer = await join(world, [F039, F040]);

        expect(answer.jobId.startsWith(JOIN_ID_PREFIX)).toBe(true);
        expect(answer.versionId).toBe(answer.jobId);
        const job = await readJob(world, answer.jobId);
        expect(job).toMatchObject({
            type: 'layer-join',
            status: 'queued',
            waitReason: 'parts',
            layerId: answer.layerId,
            createdBy: 'u-admin',
        });
        const params = job?.params as { parts: { versionId: string; layerId: string }[]; sensor: string };
        expect(params.sensor).toBe('KH-9-pan');
        expect(new Set([answer.layerId, ...params.parts.map((part) => part.layerId)]).size).toBe(3);
        const version = await readVersion(world, answer.jobId);
        expect(version).toMatchObject({ origin: 'join', state: 'processing', date: DATE, year: 1972, sensor: 'KH-9-pan' });
        expect(version?.source).toEqual({
            kind: 'join',
            parts: params.parts.map((part, index) => ({
                ...part,
                entityId: [F039, F040][index],
                dataset: 'declassiii',
                sensor: 'KH-9-pan',
                acquisitionDate: DATE,
            })),
        });
        for (const [index, part] of params.parts.entries()) {
            const scene = await readScene(world, [F039, F040][index] ?? '');
            expect(scene).toMatchObject({ status: 'imported', layerId: part.layerId });
            expect(await readVersion(world, part.versionId)).toMatchObject({ partOf: answer.jobId, origin: 'usgs', state: 'processing' });
            expect(await readJob(world, part.versionId)).toMatchObject({ type: 'usgs-import', status: 'queued' });
        }
    });

    it('happyPath_aRenderedFrameIsMarkedAndNotImportedAgain', async () => {
        const world = await readyWorld();
        const f039 = await seedPart(world, F039);
        await seedFree(world, F040);

        const answer = await join(world, [F039, F040]);

        expect(await readVersion(world, f039.versionId)).toMatchObject({ partOf: answer.jobId, state: 'awaiting_approval' });
        expect((await readScene(world, F039))?.layerId).toBe(f039.layerId);
        expect(answer.layerId).not.toBe(f039.layerId);
        expect((await readJob(world, answer.jobId))?.params['parts']).toContainEqual({ versionId: f039.versionId, layerId: f039.layerId });
    });

    it('happyPath_oneRepeatedFrameCountsOnce', async () => {
        const world = await readyWorld();
        await seedFree(world, F039, F040);

        const answer = await join(world, [F039, F040, F039]);

        expect((await readJob(world, answer.jobId))?.params['parts']).toHaveLength(2);
    });

    it('happyPath_withOnePublishedFrameTheJoinIsANewVersionOfThatLayer', async () => {
        const world = await readyWorld();
        const f039 = await seedPart(
            world,
            F039,
            {
                state: 'published',
                mapbox: { tilesetId: 'e2e-mapbox.x', origin: 'mts', publishedAt: at(NOW) },
            },
            { status: 'succeeded' },
        );
        await seedLayer(world, f039.layerId, { currentVersion: f039.versionId, opacity: 0.4 });
        await seedFree(world, F040);

        const answer = await join(world, [F039, F040]);

        expect(answer.layerId).toBe(f039.layerId);
        expect(await readLayer(world, f039.layerId)).toMatchObject({
            pendingVersion: answer.jobId,
            opacity: 0.4,
            currentVersion: f039.versionId,
        });
    });

    it('happyPath_aFrameOfAnEndedJoinJoinsAgain_aStalePartOfIsIgnored @S-A65-BAD-REJECTED', async () => {
        const world = await readyWorld();
        await seedJoinOfTwo(world, 'jn-old', { state: 'rejected' }, { status: 'cancelled', waitReason: undefined });

        const answer = await join(world, [F039, F040]);

        expect((await readVersion(world, 'v-f039'))?.partOf).toBe(answer.jobId);
        expect((await readVersion(world, 'jn-old'))?.state).toBe('rejected');
    });

    it('happyPath_aFrameJoinedByAnEarlierJoinJoinsAgain_live20261112 @S-A65-HAPPY-JOINED-FRAME', async () => {
        const world = await readyWorld();
        await seedPart(world, F039, { state: 'joined', partOf: 'jn-old' });
        await seedPart(world, F040);

        const answer = await join(world, [F039, F040]);

        expect(await readVersion(world, 'v-f039')).toMatchObject({ state: 'joined', partOf: answer.jobId });
    });

    it('happyPath_aTransactionRunTwiceCreatesOneSet', async () => {
        const world = await readyWorld();
        await seedFree(world, F039, F040);
        world.deps.documents.contend(1);

        await join(world, [F039, F040]);

        expect(counts(world)).toEqual({ jobs: 3, versions: 3 });
    });
});

describe('imagery.join: add a frame', () => {
    it('happyPath_aJoinAwaitingApprovalGivesWayToOneSharingAFrame_nothingDownloadedAgain @S-A65-HAPPY-ADD-FRAME', async () => {
        const world = await readyWorld();
        await seedJoinOfTwo(world, 'jn-old');
        world.deps.blobs.put('private', `work/${CITY}/jn-old/join-plan.json`, new Uint8Array([1]));
        await seedFree(world, F041);

        const answer = await join(world, [F039, F040, F041]);

        expect(await readVersion(world, 'jn-old')).toMatchObject({ state: 'rejected', updatedBy: 'u-admin' });
        expect(await readJob(world, 'jn-old')).toMatchObject({ status: 'cancelled', finishedAt: at(NOW) });
        expect((await readJob(world, 'jn-old'))?.waitReason).toBeUndefined();
        expect(await readVersion(world, 'v-f039')).toMatchObject({ partOf: answer.jobId, state: 'awaiting_approval' });
        expect(await readVersion(world, 'v-f040')).toMatchObject({ partOf: answer.jobId, state: 'awaiting_approval' });
        expect(counts(world)).toEqual({ jobs: 5, versions: 5 });
        expect(world.deps.blobs.paths('private', `work/${CITY}/jn-old/`)).toEqual([]);
    });

    it('happyPath_aReplacedJoinOnAPublishedLayerStopsBeingPending', async () => {
        const world = await readyWorld();
        const f039 = await seedPart(
            world,
            F039,
            {
                state: 'published',
                mapbox: { tilesetId: 'e2e-mapbox.x', origin: 'mts', publishedAt: at(NOW) },
                partOf: 'jn-old',
            },
            { status: 'succeeded' },
        );
        const f040 = await seedPart(world, F040, { partOf: 'jn-old' });
        await seedLayer(world, f039.layerId, { currentVersion: f039.versionId, pendingVersion: 'jn-old' });
        const parts = [
            { ...f039, entityId: F039 },
            { ...f040, entityId: F040 },
        ];
        await seedVersion(world, 'jn-old', joinVersion({ jobId: 'jn-old', layerId: f039.layerId, source: joinSource(parts) }));
        await seedJob(world, 'jn-old', {
            type: 'layer-join',
            status: 'awaiting_approval',
            params: { parts: [f039, f040], sensor: 'KH-9-pan' },
            createdBy: 'u-admin',
            createdAt: at(NOW),
            layerId: f039.layerId,
            versionId: 'jn-old',
            updatedBy: 'system:pipeline',
            updatedAt: at(NOW),
        });
        await seedFree(world, F041);

        const same = await join(world, [F039, F040, F041]);

        expect(same.layerId).toBe(f039.layerId);
        expect((await readLayer(world, f039.layerId))?.pendingVersion).toBe(same.jobId);
    });

    it('happyPath_aJoinLeavingThePublishedLayerClearsItsPending', async () => {
        const world = await readyWorld();
        const f039 = await seedPart(
            world,
            F039,
            {
                state: 'published',
                mapbox: { tilesetId: 'e2e-mapbox.x', origin: 'mts', publishedAt: at(NOW) },
                partOf: 'jn-old',
            },
            { status: 'succeeded' },
        );
        const f040 = await seedPart(world, F040, { partOf: 'jn-old' });
        await seedLayer(world, f039.layerId, { currentVersion: f039.versionId, pendingVersion: 'jn-old' });
        const parts = [
            { ...f039, entityId: F039 },
            { ...f040, entityId: F040 },
        ];
        await seedVersion(world, 'jn-old', joinVersion({ jobId: 'jn-old', layerId: f039.layerId, source: joinSource(parts) }));
        await seedJob(world, 'jn-old', {
            type: 'layer-join',
            status: 'awaiting_approval',
            params: { parts: [f039, f040], sensor: 'KH-9-pan' },
            createdBy: 'u-admin',
            createdAt: at(NOW),
            layerId: f039.layerId,
            versionId: 'jn-old',
            updatedBy: 'system:pipeline',
            updatedAt: at(NOW),
        });
        await seedFree(world, F041);

        const answer = await join(world, [F040, F041]);

        expect(answer.layerId).not.toBe(f039.layerId);
        expect((await readLayer(world, f039.layerId))?.pendingVersion).toBeUndefined();
        expect((await readVersion(world, 'jn-old'))?.state).toBe('rejected');
    });

    it.each(['processing', 'approved'] as const)('badPath_aLiveJoinIn_%s_refuses @S-A65-BAD-PART-HELD', async (state) => {
        const world = await readyWorld();
        const approval = state === 'approved' ? { approval: { auto: false, by: 'u-admin', at: at(NOW) } } : {};
        await seedJoinOfTwo(world, 'jn-old', { state, ...approval }, { status: state === 'approved' ? 'awaiting_approval' : 'queued' });
        const before = counts(world);

        expect(await codeOf(join(world, [F039, F040]))).toMatchObject({ code: 'apiError.imagery.joinPartHeld', params: { frame: F039 } });
        expect(counts(world)).toEqual(before);
    });
});

describe('imagery.join: refused before anything is created', () => {
    it.each([
        ['another date', { acquisitionDate: '1972-08-09' }],
        ['another camera', { sensor: 'KH-9-mapping' }],
    ] as const)('badPath_framesOf%sAreMixed @S-A65-BAD-MIXED', async (_name, other) => {
        const world = await readyWorld();
        await seedFree(world, F039);
        await seedScene(world, F040, frameFields(other));

        expect(await codeOf(join(world, [F039, F040]))).toMatchObject({ code: 'apiError.imagery.joinMixedFrames' });
        expect(counts(world)).toEqual({ jobs: 0, versions: 0 });
    });

    it('badPath_anUnknownCityOrSceneIsNotFound', async () => {
        const world = await readyWorld();
        await seedFree(world, F039);

        expect(await codeOf(join(world, [F039, F040]))).toMatchObject({ code: 'apiError.notFound' });
        const other = joinFunction(() => world.deps).run(adminCall({ cityId: 'nowhere', entityIds: [F039, F040] }));
        expect(await codeOf(other)).toMatchObject({ code: 'apiError.notFound' });
    });

    it('badPath_oneFrameNamedTwiceIsNoJoin', async () => {
        const world = await readyWorld();
        await seedFree(world, F039);

        expect(await codeOf(join(world, [F039, F039]))).toMatchObject({ code: 'apiError.invalidRequest' });
    });

    it('badPath_theBudgetGuardRefuses', async () => {
        const world = await readyWorld();
        await seedFree(world, F039, F040);
        await seedGuard(world, 'red');

        expect(await codeOf(join(world, [F039, F040]))).toMatchObject({ code: 'apiError.guardPaused' });
        expect(counts(world)).toEqual({ jobs: 0, versions: 0 });
    });

    it('badPath_aSetThatDoesNotFitTodayIsRefusedWhole @S-A65-BAD-DAILY-LIMIT', async () => {
        const world = await readyWorld();
        await seedFree(world, F039, F040, F041);
        for (let index = 0; index < JOBS_PER_DAY - 3; index += 1) {
            await world.deps.documents.set(FIRESTORE_PATHS.job(CITY, `j-${String(index)}`), jobDocSchema, {
                type: 'usgs-import',
                status: 'succeeded',
                params: { entityId: `e-${String(index)}` },
                createdBy: 'u-admin',
                createdAt: at(NOW),
                updatedBy: 'u-admin',
                updatedAt: at(NOW),
            });
        }
        const before = counts(world);

        expect(await codeOf(join(world, [F039, F040, F041]))).toMatchObject({
            code: 'apiError.imagery.dailyLimit',
            params: { limit: String(JOBS_PER_DAY) },
        });
        expect(counts(world)).toEqual(before);
        await expect(join(world, [F039, F040])).resolves.toBeDefined();
    });

    it('badPath_aCitysOwnShareCountsTheWholeSet', async () => {
        const world = await readyWorld();
        await seedFree(world, F039, F040);
        const city = await world.deps.documents.get(FIRESTORE_PATHS.city(CITY), cityDocSchema);
        await world.deps.documents.set(FIRESTORE_PATHS.city(CITY), cityDocSchema, {
            ...(city ?? {
                name: { ro: 'B' },
                bounds: { west: 0, south: 0, east: 1, north: 1 },
                published: false,
                updatedBy: 'x',
                updatedAt: at(NOW),
            }),
            limits: { ...DEFAULT_NEW_CITY_LIMITS, rasterJobsPerDay: 2 },
            updatedAt: timestampFromDate(new Date(NOW)),
        });

        expect(await codeOf(join(world, [F039, F040]))).toMatchObject({ code: 'apiError.imagery.dailyLimit', params: { limit: '2' } });
    });
});

describe('imagery.join: frames that cannot be taken', () => {
    it.each(['approved', 'publishing'] as const)(
        'happyPath_aFrameThePolicyMoved_%s_SinceTheCallableLookedIsStampedAnyway',
        async (state) => {
            const world = await readyWorld();
            await seedPart(world, F039);
            await seedPart(world, F040);
            const transaction = world.deps.documents.transaction.bind(world.deps.documents);
            world.deps.documents.transaction = async (work) => {
                const frame = await requireVersion(world, 'v-f040');
                await seedVersion(world, 'v-f040', {
                    ...frame,
                    state,
                    approval: { auto: true, by: 'system:imagery', at: at(NOW) },
                });
                return transaction(work);
            };

            const answer = await join(world, [F039, F040]);

            expect(await readVersion(world, 'v-f040')).toMatchObject({ state, partOf: answer.jobId });
            expect((await readVersion(world, 'v-f039'))?.partOf).toBe(answer.jobId);
        },
    );

    it('badPath_aFrameNotScannedCreatesNothing', async () => {
        const world = await readyWorld();
        await seedFree(world, F039);
        await seedScene(world, F040, frameFields({ downloadAvailable: false }));

        expect(await codeOf(join(world, [F039, F040]))).toMatchObject({ code: 'apiError.imagery.notScanned' });
        expect(counts(world)).toEqual({ jobs: 0, versions: 0 });
        expect(world.usgs.sessions.size).toBe(0);
    });

    it('badPath_aFrameUsgsNoLongerOffersIsMarkedAndCreatesNothing', async () => {
        const world = await readyWorld();
        await seedFree(world, F039);
        await seedScene(world, F040, frameFields());

        expect(await codeOf(join(world, [F039, F040]))).toMatchObject({ code: 'apiError.imagery.notScanned' });
        expect((await readScene(world, F040))?.downloadAvailable).toBe(false);
        expect(counts(world)).toEqual({ jobs: 0, versions: 0 });
    });

    it('badPath_downloadsNotApprovedRefuseAMissingFrame', async () => {
        const world = await readyWorld();
        await seedFree(world, F039, F040);
        await seedSetup(world, { usgs: { state: 'ok', role: 'search' } });

        expect(await codeOf(join(world, [F039, F040]))).toMatchObject({ code: 'apiError.usgs.accessPending' });
    });

    it('happyPath_framesAllImportedAskNothingOfUsgs', async () => {
        const world = await readyWorld();
        await seedPart(world, F039);
        await seedPart(world, F040);
        await seedSetup(world, { usgs: { state: 'pending' } });

        await expect(join(world, [F039, F040])).resolves.toBeDefined();
        expect(world.usgs.sessions.size).toBe(0);
    });

    it.each(['failed', 'rejected', 'cancelled'] as const)(
        'badPath_aFrameWhoseImportEnded_%s_isGone @S-A65-BAD-PART-GONE',
        async (state) => {
            const world = await readyWorld();
            const error = state === 'failed' ? { error: { code: 'apiError.imagery.referenceUnavailable' as const } } : {};
            await seedPart(world, F039, { state, ...error });
            await seedFree(world, F040);
            const before = counts(world);

            expect(await codeOf(join(world, [F039, F040]))).toMatchObject({
                code: 'apiError.imagery.joinPartGone',
                params: { frame: F039 },
            });
            expect(counts(world)).toEqual(before);
        },
    );

    it('badPath_anImportedSceneWithoutAnyVersionIsGone', async () => {
        const world = await readyWorld();
        await seedScene(world, F039, frameFields({ status: 'imported', layerId: 'layer-none' }));
        await seedFree(world, F040);

        expect(await codeOf(join(world, [F039, F040]))).toMatchObject({ code: 'apiError.imagery.joinPartGone', params: { frame: F039 } });
    });

    it('badPath_aPublishedJoinIsNotExtended', async () => {
        const world = await readyWorld();
        await seedScene(world, F039, frameFields({ status: 'imported', layerId: 'layer-join' }));
        await seedLayer(world, 'layer-join', { label: { ro: 'Stratul unit' } });
        await seedVersion(
            world,
            'jn-done',
            joinVersion({
                jobId: 'jn-done',
                layerId: 'layer-join',
                state: 'published',
                mapbox: { tilesetId: 'a.b', origin: 'mts', publishedAt: at(NOW) },
            }),
        );
        await seedFree(world, F040);

        expect(await codeOf(join(world, [F039, F040]))).toMatchObject({
            code: 'apiError.imagery.alreadyImported',
            params: { layer: 'Stratul unit' },
        });
    });

    it('badPath_aFrameOnItsWayToAPublishWaitsForItsLayer @S-A65-BAD-JOIN-LAYER-BUSY', async () => {
        const world = await readyWorld();
        const approval = { auto: true, by: 'system:imagery', at: at(NOW) };
        await seedPart(world, F039, { state: 'publishing', approval }, { status: 'mts_processing' });
        await seedPart(world, F040);

        expect(await codeOf(join(world, [F039, F040]))).toMatchObject({ code: 'apiError.imagery.joinLayerBusy' });
    });

    it('badPath_aNewRenditionOnThePublishedLayerKeepsItBusy', async () => {
        const world = await readyWorld();
        const f039 = await seedPart(world, F039, { state: 'processing', output: undefined }, { status: 'running' });
        await seedLayer(world, f039.layerId, { pendingVersion: 'v-f039' });
        await seedPart(world, F040);

        expect(await codeOf(join(world, [F039, F040]))).toMatchObject({ code: 'apiError.imagery.joinLayerBusy' });
    });
});

describe('imagery.join: the transaction reads again', () => {
    /** Runs `change` between the checks and the transaction: on the first read the transaction makes. */
    function changedBefore(world: ImageryWorld, change: () => Promise<void>): void {
        const original = world.deps.documents.transaction.bind(world.deps.documents);
        let done = false;
        world.deps.documents.transaction = async (work) => {
            if (!done) {
                done = true;
                await change();
            }
            return original(work);
        };
    }

    it('badPath_aFrameThatEndedMeanwhileIsGone', async () => {
        const world = await readyWorld();
        const f039 = await seedPart(world, F039);
        await seedPart(world, F040);
        changedBefore(world, () =>
            seedVersion(world, f039.versionId, partVersion(f039.versionId, F039, { state: 'cancelled', output: undefined })),
        );

        expect(await codeOf(join(world, [F039, F040]))).toMatchObject({ code: 'apiError.imagery.joinPartGone', params: { frame: F039 } });
    });

    it('badPath_aFrameImportedMeanwhileIsAlreadyImported', async () => {
        const world = await readyWorld();
        await seedFree(world, F039);
        await seedPart(world, F040);
        changedBefore(world, () => seedScene(world, F039, frameFields({ status: 'imported', layerId: 'layer-x' })));

        expect(await codeOf(join(world, [F039, F040]))).toMatchObject({
            code: 'apiError.imagery.alreadyImported',
            params: { layer: 'layer-x' },
        });
    });

    it('badPath_aSceneRemovedMeanwhileIsNotFound', async () => {
        const world = await readyWorld();
        await seedFree(world, F039);
        await seedPart(world, F040);
        changedBefore(world, () => world.deps.documents.delete(FIRESTORE_PATHS.usgsScene(CITY, F039)));

        expect(await codeOf(join(world, [F039, F040]))).toMatchObject({ code: 'apiError.notFound' });
    });

    it('badPath_aLayerTakenMeanwhileIsBusy', async () => {
        const world = await readyWorld();
        const mapbox = { tilesetId: 'e2e-mapbox.x', origin: 'mts' as const, publishedAt: at(NOW) };
        const f039 = await seedPart(world, F039, { state: 'published', mapbox }, { status: 'succeeded' });
        await seedLayer(world, f039.layerId, { currentVersion: f039.versionId });
        await seedPart(world, F040);
        changedBefore(world, () => seedLayer(world, f039.layerId, { currentVersion: f039.versionId, pendingVersion: 'rg-1' }));

        expect(await codeOf(join(world, [F039, F040]))).toMatchObject({ code: 'apiError.imagery.joinLayerBusy' });
    });
});

describe('imagery.join: frames published as layers of their own (batch 4)', () => {
    it('happyPath_twoFramesPublishedAsTheirOwnLayersJoinIntoTheFirstsLayer_liveFeb1972 @S-A65-HAPPY-PUBLISHED-FRAMES', async () => {
        const world = await readyWorld();
        const mapbox = { tilesetId: 'e2e-mapbox.x', origin: 'mts' as const, publishedAt: at(NOW) };
        const first = await seedPart(world, F039, { state: 'published', mapbox }, { status: 'succeeded' });
        const second = await seedPart(world, F040, { state: 'published', mapbox }, { status: 'succeeded' });
        await seedLayer(world, first.layerId, { currentVersion: first.versionId });
        await seedLayer(world, second.layerId, { currentVersion: second.versionId });

        const answer = await join(world, [F039, F040]);

        expect(answer.layerId).toBe(first.layerId);
        expect(await readLayer(world, first.layerId)).toMatchObject({ pendingVersion: answer.jobId, published: true });
        expect(await readLayer(world, second.layerId)).toMatchObject({ published: true });
        expect((await readLayer(world, second.layerId))?.pendingVersion).toBeUndefined();
        expect(await readVersion(world, second.versionId)).toMatchObject({ state: 'published', partOf: answer.jobId });
    });

    it('happyPath_aPublishedFrameIsPreferredToOneAwaitingItsPublish', async () => {
        const world = await readyWorld();
        const mapbox = { tilesetId: 'e2e-mapbox.x', origin: 'mts' as const, publishedAt: at(NOW) };
        const approval = { auto: false, by: 'u-admin', at: at(NOW) };
        await seedPart(world, F039, { state: 'approved', approval }, { status: 'awaiting_approval' });
        const second = await seedPart(world, F040, { state: 'published', mapbox }, { status: 'succeeded' });
        await seedLayer(world, second.layerId, { currentVersion: second.versionId });

        expect((await join(world, [F039, F040])).layerId).toBe(second.layerId);
    });
});
