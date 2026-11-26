/**
 * The plan of whole-city dates and the harvest's target years (`functions/src/imagery/{join-plan,harvest-target,harvest,versions}.ts`,
 * `docs/research/M8-join-interfaces.md` §5): the plan is rewritten after a harvest and when a frame rendered; a dataset at the
 * cap is searched again per target year, so a targeted date cannot be lost to it; frames of a date in progress are not demoted.
 */
import { FIRESTORE_PATHS, datePlanDocSchema } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { datePlanChangedBy, ensureDatePlan, rewriteDatePlan } from '../../src/imagery/join-plan.js';
import { runLayerDelete } from '../../src/imagery/layer-delete.js';
import { onJobWrite } from '../../src/imagery/on-job-write.js';
import { markNotScanned } from '../../src/imagery/scene-rank.js';
import { searchFunction } from '../../src/imagery/search.js';
import { UpstreamError } from '../../src/ports/errors.js';
import { adminCall } from '../publish/fakes.js';
import { sceneRecord, type SceneRecord } from '../support/imagery-fakes.js';
import {
    DATE,
    EAST,
    F039,
    F040,
    F041,
    WEST,
    frameFields,
    joinVersion,
    partJob,
    partVersion,
    seedJoinOfTwo,
    seedPart,
} from './join-world.js';
import {
    BOUNDS,
    CITY,
    NOW,
    at,
    goldenOutput,
    readScene,
    readyWorld,
    seedCity,
    seedJob,
    seedScene,
    seedVersion,
    type ImageryWorld,
} from './world.js';

function plan(world: ImageryWorld) {
    return world.deps.documents.get(FIRESTORE_PATHS.imageryPlan(CITY), datePlanDocSchema);
}

function search(world: ImageryWorld, data: Record<string, unknown> = {}) {
    return searchFunction(() => world.deps).run(adminCall({ cityId: CITY, datasets: ['declassiii'], ...data }));
}

describe('the plan of whole-city dates', () => {
    it('happyPath_theOutlineARenderLeftStandsForAFrameNothingProved @S-A66-BAD-WINDOW-BOX', async () => {
        const { west, south, east, north } = BOUNDS;
        const outline = [
            { lat: south, lng: west },
            { lat: south, lng: west + 0.04 },
            { lat: north, lng: west + 0.04 },
            { lat: north, lng: west },
        ];
        // Fitted by hand, so no proved outline; rendered on the whole window, so its box holds the whole city.
        const windowBox = { west: west - 0.1, south: south - 0.1, east: east + 0.1, north: north + 0.1 };
        const output = { ...goldenOutput(), bounds: windowBox };
        const world = await readyWorld();
        const boxOnly = await readyWorld();
        await seedPart(world, F039, { output: { ...output, outline }, state: 'awaiting_approval', calibration: undefined });
        await seedPart(boxOnly, F039, { output, state: 'awaiting_approval', calibration: undefined });
        await seedScene(world, F040, frameFields({ footprint: EAST }));
        await seedScene(boxOnly, F040, frameFields({ footprint: EAST }));

        await rewriteDatePlan(world.deps, CITY);
        await rewriteDatePlan(boxOnly.deps, CITY);

        // By its metadata ring and a box that holds everything, the two make the whole city; it really shows a tenth of it.
        expect((await plan(boxOnly))?.rows[0]?.coveragePct).toBeGreaterThan(70);
        expect((await plan(world))?.rows[0]?.coveragePct).toBeLessThan(62);
    });

    it('happyPath_aFramesMeasuredOutlineDecidesWhatItCovers @S-A66-HAPPY-MEASURED-OUTLINE', async () => {
        const { west, south, north } = BOUNDS;
        const outline = [
            { lat: south, lng: west },
            { lat: south, lng: west + 0.04 },
            { lat: north, lng: west + 0.04 },
            { lat: north, lng: west },
        ];
        const world = await readyWorld();
        const estimated = await readyWorld();
        await seedPart(world, F039, { output: undefined, state: 'processing', calibration: { how: 'votes', outline } });
        await seedPart(estimated, F039, { output: undefined, state: 'processing' });
        await seedScene(world, F040, frameFields({ footprint: EAST }));
        await seedScene(estimated, F040, frameFields({ footprint: EAST }));

        await rewriteDatePlan(world.deps, CITY);
        await rewriteDatePlan(estimated.deps, CITY);

        // By the estimate F039 holds the city alone: no join to offer. The proved map says a tenth of it: F040 is wanted.
        expect((await plan(estimated))?.rows).toEqual([]);
        expect((await plan(world))?.rows[0]?.frames.map((frame) => frame.entityId)).toEqual(expect.arrayContaining([F039, F040]));
    });

    it('happyPath_twoFramesOfADateMakeARow_summerAboveWinter @S-A66-HAPPY', async () => {
        const world = await readyWorld();
        await seedCity(world, { imagery: { targetYears: [1972] } });
        await seedScene(world, F039, frameFields({ displayId: 'F039' }));
        await seedScene(world, F040, frameFields({ footprint: EAST }));
        await seedScene(world, 'WINTER-A', frameFields({ acquisitionDate: '1972-02-02' }));
        await seedScene(world, 'WINTER-B', frameFields({ acquisitionDate: '1972-02-02', footprint: EAST }));

        await rewriteDatePlan(world.deps, CITY);

        const rows = (await plan(world))?.rows ?? [];
        expect(rows.map((row) => [row.date, row.winter])).toEqual([
            [DATE, false],
            ['1972-02-02', true],
        ]);
        expect(rows[0]).toMatchObject({ sensor: 'KH-9-pan', framesToDownload: 2, paidFrames: [] });
        expect(rows[0]?.frames.map((frame) => frame.entityId).sort((a, b) => a.localeCompare(b))).toEqual([F039, F040]);
        expect(rows[0]?.frames.find((frame) => frame.entityId === F039)?.displayId).toBe('F039');
    });

    it('happyPath_anImportedFrameShowsItsVersion_aRenderedOneNeedsNoDownload', async () => {
        const world = await readyWorld();
        const output = { ...goldenOutput(), bounds: { west: BOUNDS.west, south: BOUNDS.south, east: 26.1, north: BOUNDS.north } };
        await seedPart(world, F039, { output });
        await seedScene(world, F040, frameFields({ footprint: EAST }));

        await rewriteDatePlan(world.deps, CITY);

        const [row] = (await plan(world))?.rows ?? [];
        expect(row?.framesToDownload).toBe(1);
        expect(row?.frames).toContainEqual(expect.objectContaining({ entityId: F039, versionId: 'v-f039', state: 'awaiting_approval' }));
    });

    it('happyPath_aFrameThatFailedStillShows_itsOutlineNotTrusted', async () => {
        const world = await readyWorld();
        await seedPart(world, F039, {
            state: 'failed',
            output: undefined,
            calibration: undefined,
            error: { code: 'apiError.imagery.referenceUnavailable' },
        });
        await seedScene(world, F040, frameFields({ footprint: EAST }));

        await rewriteDatePlan(world.deps, CITY);

        expect((await plan(world))?.rows[0]?.frames).toContainEqual(expect.objectContaining({ entityId: F039, state: 'failed' }));
    });

    it('badPath_aPaidFrameIsNamedNotChosen @S-A66-BAD-PAID-FRAME', async () => {
        const world = await readyWorld();
        await seedScene(world, F039, frameFields());
        await seedScene(world, F040, frameFields({ footprint: EAST, downloadAvailable: false }));

        await rewriteDatePlan(world.deps, CITY);

        const [row] = (await plan(world))?.rows ?? [];
        expect(row?.frames.map((frame) => frame.entityId)).toEqual([F039]);
        expect(row?.paidFrames).toEqual([F040]);
    });

    it('badPath_aLoneFrameOrARejectedNeighbourMakesNoRow @S-A66-BAD-NO-NEIGHBOUR', async () => {
        const world = await readyWorld();
        await seedScene(world, F039, frameFields());
        await seedScene(world, F040, frameFields({ footprint: EAST, status: 'rejected' }));

        await rewriteDatePlan(world.deps, CITY);

        expect((await plan(world))?.rows).toEqual([]);
    });

    it('badPath_aDateAPublishedJoinShowsHasNoRow', async () => {
        const world = await readyWorld();
        await seedScene(world, F039, frameFields({ status: 'imported', layerId: 'layer-join' }));
        await seedScene(world, F040, frameFields({ footprint: EAST, status: 'imported', layerId: 'layer-join' }));
        await seedScene(world, F041, frameFields({ footprint: EAST }));
        await seedVersion(
            world,
            'jn-1',
            joinVersion({
                jobId: 'jn-1',
                layerId: 'layer-join',
                state: 'published',
                mapbox: { tilesetId: 'a.b', origin: 'mts', publishedAt: joinVersion().updatedAt },
            }),
        );

        await rewriteDatePlan(world.deps, CITY);

        expect((await plan(world))?.rows).toEqual([]);
    });

    it('badPath_aCityGoneWritesNoPlan', async () => {
        const world = await readyWorld();

        await rewriteDatePlan(world.deps, 'nowhere');

        expect(world.deps.documents.peek(FIRESTORE_PATHS.imageryPlan('nowhere'))).toBeUndefined();
    });
});

describe('when the plan is rewritten', () => {
    it.each([
        ['a frame rendering', partJob('v', 'l', { status: 'running' }), partJob('v', 'l'), true],
        ['a frame still waiting', partJob('v', 'l'), partJob('v', 'l'), false],
        [
            'a join published',
            partJob('v', 'l', { type: 'layer-join', status: 'mts_processing' }),
            partJob('v', 'l', { type: 'layer-join', status: 'succeeded' }),
            true,
        ],
        [
            'a join rendering',
            partJob('v', 'l', { type: 'layer-join', status: 'running' }),
            partJob('v', 'l', { type: 'layer-join' }),
            false,
        ],
        ['a frame needing points', partJob('v', 'l', { status: 'running' }), partJob('v', 'l', { status: 'awaiting_gcps' }), true],
        ['a frame failing', partJob('v', 'l', { status: 'running' }), partJob('v', 'l', { status: 'failed' }), true],
        ['a frame rejected', partJob('v', 'l'), partJob('v', 'l', { status: 'cancelled' }), true],
        ['a frame published', partJob('v', 'l', { status: 'mts_processing' }), partJob('v', 'l', { status: 'succeeded' }), true],
        ['a frame running', partJob('v', 'l', { status: 'queued' }), partJob('v', 'l', { status: 'running' }), false],
        [
            'a deletion ending',
            partJob('v', 'l', { type: 'layer-delete', status: 'queued' }),
            partJob('v', 'l', { type: 'layer-delete', status: 'succeeded' }),
            false,
        ],
        ['a new job', undefined, partJob('v', 'l', { status: 'queued' }), false],
    ])('datePlanChangedBy_%s', (_name, before, after, changed) => {
        expect(datePlanChangedBy(before, after)).toBe(changed);
    });

    it('happyPath_aFrameReachingApprovalRewritesThePlan', async () => {
        const world = await readyWorld();
        const f039 = await seedPart(world, F039);
        await seedScene(world, F040, frameFields({ footprint: EAST }));

        await onJobWrite(world.deps, CITY, f039.versionId, {
            before: partJob(f039.versionId, f039.layerId, { status: 'running' }),
            after: partJob(f039.versionId, f039.layerId),
        });

        expect((await plan(world))?.rows).toHaveLength(1);
    });

    it('happyPath_theTickWritesAPlanForACityWithNone_aFrameAlreadyWaitingHasItsRow', async () => {
        const world = await readyWorld();
        await seedPart(world, F039);
        await seedScene(world, F040, frameFields({ footprint: EAST }));

        await ensureDatePlan(world.deps, CITY);

        expect((await plan(world))?.rows).toHaveLength(1);
    });

    it('badPath_aPlanThereIsLeftAlone', async () => {
        const world = await readyWorld();
        await seedPart(world, F039);
        await seedScene(world, F040, frameFields({ footprint: EAST }));
        await world.deps.documents.set(FIRESTORE_PATHS.imageryPlan(CITY), datePlanDocSchema, { rows: [], updatedAt: at(NOW) });

        await ensureDatePlan(world.deps, CITY);

        expect((await plan(world))?.rows).toEqual([]);
    });

    it('happyPath_aDeletedJoinsDateHasItsRowBack @S-A65-HAPPY-FINALIZE-SCENES', async () => {
        const world = await readyWorld();
        const mapbox = { tilesetId: 'a.b', origin: 'mts' as const, publishedAt: at(NOW) };
        const parts = await seedJoinOfTwo(world, 'jn-1', { state: 'published', mapbox }, { status: 'succeeded' });
        for (const [part, footprint] of [
            [parts[0], WEST],
            [parts[1], EAST],
        ] as const) {
            await seedScene(world, part?.entityId ?? '', frameFields({ status: 'imported', layerId: 'layer-join', footprint }));
        }
        await rewriteDatePlan(world.deps, CITY);
        expect((await plan(world))?.rows).toEqual([]);
        await seedJob(world, 'ld-1', {
            type: 'layer-delete',
            status: 'queued',
            params: { layerId: 'layer-join', sourceSha: 'b'.repeat(64) },
            createdBy: 'u-admin',
            createdAt: at(NOW),
            updatedBy: 'u-admin',
            updatedAt: at(NOW),
        });

        await expect(runLayerDelete(world.deps, CITY, 'ld-1')).resolves.toBe('succeeded');

        expect((await plan(world))?.rows.map((row) => row.date)).toEqual([DATE]);
    });

    it('badPath_aPlanThatCannotBeWrittenAfterADeletionFailsNotTheDeletion', async () => {
        const world = await readyWorld();
        planRefused(world);
        await seedJob(world, 'ld-1', {
            type: 'layer-delete',
            status: 'queued',
            params: { layerId: 'layer-gone', sourceSha: 'b'.repeat(64) },
            createdBy: 'u-admin',
            createdAt: at(NOW),
            updatedBy: 'u-admin',
            updatedAt: at(NOW),
        });

        await expect(runLayerDelete(world.deps, CITY, 'ld-1')).resolves.toBe('succeeded');
    });

    /** The plan's document refuses every write. */
    function planRefused(world: ImageryWorld): void {
        const write = world.deps.documents.set.bind(world.deps.documents);
        world.deps.documents.set = (path, schema, data) =>
            path === FIRESTORE_PATHS.imageryPlan(CITY) ? Promise.reject(new Error('plan refused')) : write(path, schema, data);
    }

    it('badPath_aPlanThatCannotBeWrittenFailsNotTheJob', async () => {
        const world = await readyWorld();
        const f039 = await seedPart(world, F040);
        planRefused(world);

        await expect(
            onJobWrite(world.deps, CITY, f039.versionId, {
                before: partJob(f039.versionId, f039.layerId, { status: 'running' }),
                after: partJob(f039.versionId, f039.layerId),
            }),
        ).resolves.toBe('approval');
        expect(await plan(world)).toBeUndefined();
    });

    it('badPath_aHarvestWhosePlanFailsStillAnswers', async () => {
        const world = await readyWorld(NOW, { declassiii: [record(F039)] });
        planRefused(world);

        await expect(search(world)).resolves.toMatchObject({ found: 1 });
        expect(await plan(world)).toBeUndefined();
    });
});

/** A KH-9 record of the date over the west of the city. */
function record(entityId: string, overrides: Partial<SceneRecord> = {}): SceneRecord {
    return sceneRecord(entityId, { acquisitionDate: DATE, ...overrides });
}

/** `count` frames of 1973, enough to fill a dataset's cap. */
function filler(count: number): SceneRecord[] {
    return Array.from({ length: count }, (_, index) => record(`DZB-${String(index).padStart(4, '0')}`, { acquisitionDate: '1973-05-05' }));
}

/** The window of every search USGS was asked. */
function windowsAsked(world: ImageryWorld): (string | undefined)[][] {
    return world.scenes.recorder.argsOf('search').map(([, request]) => {
        const { from, to } = request as { readonly from?: string; readonly to?: string };
        return [from, to];
    });
}

describe('a dataset at the cap', () => {
    it('happyPath_aTargetDatePastTheCapIsFoundByItsYearsSearch_eachFrameOnce @S-A66-HAPPY-TRUNCATED', async () => {
        const world = await readyWorld(NOW, { declassiii: [...filler(500), record(F039)] });
        await seedCity(world, { imagery: { targetYears: [1972, 1990] } });

        await search(world);

        expect(await readScene(world, F039)).toMatchObject({ acquisitionDate: DATE });
        expect(windowsAsked(world).filter(([from]) => from !== undefined)).toEqual([
            ['1972-01-01', '1972-12-31'],
            ['1990-01-01', '1990-12-31'],
        ]);
    });

    it('happyPath_theYearsStayInsideTheRequestsWindow', async () => {
        const world = await readyWorld(NOW, { declassiii: filler(500) });
        await seedCity(world, { imagery: { targetYears: [1972, 1973, 1980] } });

        await search(world, { from: '1973-02-01', to: '1973-12-31' });

        expect(new Set(windowsAsked(world).map((window) => window.join(' ')))).toEqual(new Set(['1973-02-01 1973-12-31']));
    });

    it('badPath_underTheCapNoYearIsSearchedAgain', async () => {
        const world = await readyWorld(NOW, { declassiii: filler(499) });

        await search(world);

        expect(windowsAsked(world).every(([from]) => from === undefined)).toBe(true);
    });

    it('badPath_aYearsSearchThatFailsKeepsWhatTheFirstFound', async () => {
        const world = await readyWorld(NOW, { declassiii: filler(500) });
        await seedCity(world, { imagery: { targetYears: [1972] } });
        const original = world.deps.scenes.search.bind(world.deps.scenes);
        world.deps.scenes.search = (key, request) =>
            request.from === undefined ? original(key, request) : Promise.reject(new UpstreamError('usgs', 'unavailable'));

        await expect(search(world)).resolves.toMatchObject({ found: 500, failedDatasets: [] });
    });
});

describe('the rank of a frame of a date in progress', () => {
    it('happyPath_aNeighbourOfAnUnfinishedVersionIsNotDemotedForItsYear @S-A11-HAPPY-SAME-DATE-RANK', async () => {
        const world = await readyWorld();
        await seedVersion(world, 'v-f039', partVersion('v-f039', F039, { state: 'processing', output: undefined }));
        await seedScene(world, F040, frameFields({ footprint: WEST, rank: { score: 1, reasons: [], version: 1 } }));

        await markNotScanned(world.deps, CITY, F040);

        const reasons = (await readScene(world, F040))?.rank.reasons.map((reason) => reason.code);
        expect(reasons).toContain('sameDate');
    });

    it('badPath_aFramesOwnImportIsNoNeighbour', async () => {
        const world = await readyWorld();
        await seedVersion(world, 'v-f040', partVersion('v-f040', F040, { state: 'processing', output: undefined, layerId: 'layer-f040' }));
        await seedScene(world, F040, frameFields({ status: 'imported', layerId: 'layer-f040' }));

        await markNotScanned(world.deps, CITY, F040);

        expect((await readScene(world, F040))?.rank.reasons.map((reason) => reason.code)).not.toContain('sameDate');
    });

    it('badPath_aHarvestRanksAFinishedNeighbourByItsYearAlone', async () => {
        const world = await readyWorld(NOW, { declassiii: [record(F040)] });
        await seedVersion(world, 'v-f039', partVersion('v-f039', F039, { state: 'rejected' }));

        await search(world);

        expect((await readScene(world, F040))?.rank.reasons.map((reason) => reason.code)).not.toContain('sameDate');
    });

    it('happyPath_aHarvestSeesAnUnfinishedNeighbour', async () => {
        const world = await readyWorld(NOW, { declassiii: [record(F040)] });
        await seedVersion(world, 'v-f039', partVersion('v-f039', F039, { state: 'processing', output: undefined }));

        await search(world);

        expect((await readScene(world, F040))?.rank.reasons.map((reason) => reason.code)).toContain('sameDate');
    });
});

// M25 (docs/research/M25-landsat.md §1): a Landsat scene holds the city on its own.
describe('the plan of whole-city dates: Landsat', () => {
    it('badPath_aLandsatSceneNeverJoinsAPlan @S-A130-HAPPY', async () => {
        const world = await readyWorld();
        await seedScene(world, F039, frameFields({ dataset: 'landsat_tm_c2_l1', sensor: 'L5-TM' }));
        await seedScene(world, F040, frameFields({ footprint: EAST, dataset: 'landsat_tm_c2_l1', sensor: 'L5-TM' }));

        await rewriteDatePlan(world.deps, CITY);

        expect((await plan(world))?.rows).toEqual([]);
    });
});
