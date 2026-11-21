/**
 * `imagery.tick`'s way to own tiles (`functions/src/imagery/own-tiles-{sweep,clean}.ts`, `docs/research/M12-own-tiles.md`): what waited at
 * Mapbox's guard publishes on its recorded approval, what has no tiles gets them, nothing publishes without an approval, and what a
 * publish leaves behind goes after its grace.
 */
import { STORAGE_PATHS, publicObjectUrl, type JobDoc, type LayerVersionDoc } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { omit } from '../../src/api/objects.js';
import { rejectFunction } from '../../src/imagery/approve.js';
import { cancelJob } from '../../src/imagery/cancel.js';
import { dispatchJob } from '../../src/imagery/dispatch.js';
import { endWork } from '../../src/imagery/end.js';
import { runLayerDelete } from '../../src/imagery/layer-delete.js';
import { cleanOwnTiles } from '../../src/imagery/own-tiles-clean.js';
import { sweepOwnTiles, tilesJobId } from '../../src/imagery/own-tiles-sweep.js';
import { runPublishTask } from '../../src/imagery/publish.js';
import { runImageryTick } from '../../src/imagery/tick.js';
import { adminCall } from '../publish/fakes.js';
import {
    CITY,
    NOW,
    at,
    goldenOutput,
    readJob,
    readLayer,
    readVersion,
    readyWorld,
    renderedVersion,
    seedCity,
    seedGuard,
    seedJob,
    seedLayer,
    seedVersion,
    type ImageryWorld,
} from './world.js';

const LATER = new Date(new Date(NOW).getTime() + 3_600_000);
const EARLIER = at(new Date(new Date(NOW).getTime() - 3_600_000).toISOString());
const LAYER = 'kh-9-hexagon-1983';

function tilesOf(id: string) {
    return {
        path: `rasters/${CITY}/${LAYER}/${id}/tiles.pmtiles`,
        bytes: 7,
        count: 1,
        sha256: 'd'.repeat(64),
        thumbPath: `rasters/${CITY}/${LAYER}/${id}/thumb.webp`,
    };
}

function jobOf(id: string, overrides: Partial<JobDoc> = {}): JobDoc {
    return {
        type: 'usgs-import',
        status: 'awaiting_approval',
        params: { entityId: 'DZB00403', dataset: 'declassiii', sensor: 'KH-9-pan' },
        createdBy: 'u-admin',
        createdAt: at(NOW),
        layerId: LAYER,
        versionId: id,
        waitReason: 'approval',
        updatedBy: 'system:pipeline',
        updatedAt: EARLIER,
        ...overrides,
    };
}

function waiting(id: string, overrides: Partial<LayerVersionDoc> = {}): LayerVersionDoc {
    return renderedVersion({ layerId: LAYER, jobId: id, state: 'awaiting_approval', updatedAt: EARLIER, ...overrides });
}

function approved(id: string, overrides: Partial<LayerVersionDoc> = {}): LayerVersionDoc {
    return waiting(id, { state: 'approved', approval: { auto: false, by: 'u-admin', at: EARLIER }, ...overrides });
}

const withTiles = (id: string): LayerVersionDoc['output'] => ({ ...goldenOutput(), tiles: tilesOf(id) });

async function world(
    versions: Readonly<Record<string, LayerVersionDoc>>,
    jobs: Readonly<Record<string, Partial<JobDoc>>> = {},
): Promise<ImageryWorld> {
    const made = await readyWorld();
    await seedCity(made, { imagery: {} });
    for (const [id, version] of Object.entries(versions)) {
        await seedJob(made, id, jobOf(id, jobs[id]));
        await seedVersion(made, id, version);
    }
    return made;
}

const tick = (made: ImageryWorld): Promise<void> => sweepOwnTiles(made.deps, CITY, new Date(NOW));

describe('the sweep to own tiles', () => {
    it('happyPath_whatWaitedAtMapboxsGuardPublishesOnItsApproval @S-A71-HAPPY-WAITED-AT-GUARD', async () => {
        const guard = {
            verdict: 'over' as const,
            available: 2,
            overageUsd: 20,
            checkedAt: EARLIER,
            choice: 'studio' as const,
            chosenBy: 'u-admin',
        };
        const made = await world({ v1: approved('v1', { guard, output: withTiles('v1') }) }, { v1: { waitReason: 'compute-units' } });
        made.deps.blobs.put('private', tilesOf('v1').path, new Uint8Array(7));

        await tick(made);

        expect((await readVersion(made, 'v1'))?.guard).toBeUndefined();
        expect(await readJob(made, 'v1')).toMatchObject({ status: 'awaiting_approval', waitReason: 'approval' });
        expect(made.deps.tasks.queued).toHaveLength(1);
        await runPublishTask(made.deps, made.deps.tasks.queued[0]?.payload as Parameters<typeof runPublishTask>[1]);
        expect(await readVersion(made, 'v1')).toMatchObject({ state: 'published', approval: { by: 'u-admin' } });
        expect(await readLayer(made, LAYER)).toMatchObject({ source: { type: 'pmtiles' } });
        expect(made.tilesets.recorder.calls).toEqual([]);
    });

    it.each(['defer', 'pay'] as const)(
        'happyPath_aChoiceOf_%s_ClearsToo_nothingWasCharged @S-A71-HAPPY-WAITED-AT-GUARD',
        async (choice) => {
            const guard = { verdict: 'over' as const, available: 2, checkedAt: EARLIER, choice, chosenBy: 'u-admin' };
            const made = await world({ v1: approved('v1', { guard, output: withTiles('v1') }) });

            await tick(made);

            expect((await readVersion(made, 'v1'))?.guard).toBeUndefined();
            expect(made.deps.tasks.queued).toHaveLength(1);
        },
    );

    it('happyPath_noTilesGetsItsJobFromItsCog_oneAtATime_approvedFirst @S-A71-HAPPY-TILES-JOB', async () => {
        const made = await world({ a: waiting('a'), b: approved('b') });

        await tick(made);

        const first = tilesJobId(CITY, 'b');
        expect(await readJob(made, first)).toMatchObject({
            type: 'layer-tiles',
            status: 'queued',
            params: { versionId: 'b' },
            versionId: 'b',
            layerId: LAYER,
        });
        await expect(readJob(made, tilesJobId(CITY, 'a'))).resolves.toBeUndefined();

        await tick(made);
        await expect(readJob(made, tilesJobId(CITY, 'a'))).resolves.toBeUndefined();

        await seedJob(made, first, { ...(await readJob(made, first)), status: 'succeeded' } as JobDoc);
        await tick(made);
        expect(await readJob(made, tilesJobId(CITY, 'a'))).toMatchObject({ status: 'queued' });
    });

    it('badPath_onlyAwaitingApprovalGetsItsPictureAndNeverPublishes @S-A71-BAD-NOT-APPROVED', async () => {
        const made = await world({ v1: waiting('v1', { output: withTiles('v1') }) });

        await tick(made);

        expect(made.deps.tasks.queued).toEqual([]);
        expect(await readVersion(made, 'v1')).toMatchObject({ state: 'awaiting_approval' });
    });

    it('badPath_aFrameALiveJoinHoldsGetsAPictureAndNeverPublishes @S-A71-BAD-HELD-BY-JOIN', async () => {
        const join = waiting('joined-one', { origin: 'join', state: 'processing' });
        const made = await world({
            'joined-one': join,
            held: approved('held', { partOf: 'joined-one', output: withTiles('held') }),
            bare: waiting('bare', { partOf: 'joined-one' }),
        });

        await tick(made);

        expect(made.deps.tasks.queued).toEqual([]);
        expect(await readVersion(made, 'held')).toMatchObject({ state: 'approved' });
        expect(await readJob(made, tilesJobId(CITY, 'bare'))).toMatchObject({ type: 'layer-tiles' });
    });

    it('badPath_aCityThatChoseMapboxIsLeftAlone @S-A71-BAD-CITY-CHOSE-MAPBOX', async () => {
        const made = await world({ v1: approved('v1', { output: withTiles('v1') }), v2: waiting('v2') });
        await seedCity(made, { imagery: { publishThroughMapbox: true } });

        await tick(made);

        expect(made.deps.tasks.queued).toEqual([]);
        await expect(readJob(made, tilesJobId(CITY, 'v2'))).resolves.toBeUndefined();
    });

    it('badPath_justApprovedWaitsForItsOwnTask @S-A71-BAD-JUST-APPROVED', async () => {
        const made = await world({ v1: approved('v1', { output: withTiles('v1'), updatedAt: at(NOW) }) });

        await tick(made);

        expect(made.deps.tasks.queued).toEqual([]);
    });

    it('badPath_aFailedTilesJobIsNotMadeAgain_itsRetryIsTheOwners @S-A71-BAD-FAILED-JOB', async () => {
        const made = await world({ v1: waiting('v1') });
        await seedJob(made, tilesJobId(CITY, 'v1'), jobOf('v1', { type: 'layer-tiles', status: 'failed', params: { versionId: 'v1' } }));
        const before = await readJob(made, tilesJobId(CITY, 'v1'));

        await tick(made);

        expect(await readJob(made, tilesJobId(CITY, 'v1'))).toEqual(before);
    });

    it('badPath_aVersionWithNeitherTilesNorACogIsNotAsked @S-A71-BAD-NO-COG', async () => {
        const output = omit(goldenOutput(), ['cogPath', 'cogBytes', 'cogSha256']);
        const made = await world({ v1: waiting('v1', { output }) });

        await tick(made);

        await expect(readJob(made, tilesJobId(CITY, 'v1'))).resolves.toBeUndefined();
    });

    it('happyPath_theTickRunsTheSweepAndTheCleanUp @S-A71-HAPPY-TILES-JOB', async () => {
        const made = await world({ v1: waiting('v1') });

        await expect(runImageryTick(made.deps)).resolves.toEqual([]);

        expect(await readJob(made, tilesJobId(CITY, 'v1'))).toMatchObject({ type: 'layer-tiles' });
    });

    it('badPath_aRedBudgetGuardStopsTheSweep @S-A71-BAD-GUARD-RED', async () => {
        const made = await world({ v1: approved('v1', { output: withTiles('v1') }), v2: waiting('v2') });
        await seedGuard(made, 'red');

        await runImageryTick(made.deps);

        expect(made.deps.tasks.queued).toEqual([]);
        await expect(readJob(made, tilesJobId(CITY, 'v2'))).resolves.toBeUndefined();
    });
});

describe('a tiles job that ends badly', () => {
    const job = (status: JobDoc['status']): JobDoc =>
        jobOf('v1', { type: 'layer-tiles', status, params: { versionId: 'v1' }, executionName: 'gone' });

    it('badPath_aFailureLeavesItsVersionWhereItStands @S-P08-BAD-FAILS-ALONE', async () => {
        const made = await world({ v1: approved('v1') });
        await seedJob(made, 'tiles-1', job('running'));

        await expect(
            endWork(made.deps, CITY, 'tiles-1', {
                status: 'failed',
                versionState: 'failed',
                by: 'system:imagery',
                error: { code: 'apiError.internal' },
            }),
        ).resolves.toBe(true);

        expect(await readVersion(made, 'v1')).toMatchObject({ state: 'approved' });
        expect(await readJob(made, 'tiles-1')).toMatchObject({ status: 'failed' });
    });

    it('happyPath_itsJobIsDispatchedLikeAnyRasterJob @S-A71-HAPPY-TILES-JOB', async () => {
        const made = await world({ v1: waiting('v1') });
        await tick(made);
        const jobId = tilesJobId(CITY, 'v1');

        await expect(dispatchJob(made.deps, CITY, jobId)).resolves.toBe('started');

        expect(await readJob(made, jobId)).toMatchObject({ status: 'starting', machine: 'std' });
        expect(await readVersion(made, 'v1')).toMatchObject({ state: 'awaiting_approval' });
    });

    it('badPath_aCancelOfAFrameAJoinHoldsStillEndsItsTilesJob @S-P08-BAD-FAILS-ALONE', async () => {
        const made = await world({ 'a-join': waiting('a-join', { origin: 'join' }), v1: waiting('v1', { partOf: 'a-join' }) });
        await seedJob(made, 'tiles-1', job('queued'));

        await expect(cancelJob(made.deps, CITY, 'tiles-1')).resolves.toBe('cancelled');

        expect(await readVersion(made, 'v1')).toMatchObject({ state: 'awaiting_approval', partOf: 'a-join' });
    });

    it('badPath_aCancelLeavesItsVersionWhereItStands @S-P08-BAD-FAILS-ALONE', async () => {
        const made = await world({ v1: waiting('v1') });
        await seedJob(made, 'tiles-1', job('queued'));

        await expect(cancelJob(made.deps, CITY, 'tiles-1')).resolves.toBe('cancelled');

        expect(await readVersion(made, 'v1')).toMatchObject({ state: 'awaiting_approval' });
    });
});

describe('what own tiles leave behind', () => {
    const PUBLIC_V1 = STORAGE_PATHS.layerTiles(CITY, LAYER, 'v1');

    function superseded(url: string, overrides: Partial<LayerVersionDoc> = {}): LayerVersionDoc {
        const publishedAt = EARLIER;
        return waiting('v1', {
            state: 'superseded',
            output: withTiles('v1'),
            own: { path: PUBLIC_V1, url, bytes: 7, publishedAt },
            ...overrides,
        });
    }

    async function cleanWorld(overrides: Partial<LayerVersionDoc> = {}, showing = 'v2'): Promise<ImageryWorld> {
        const made = await world({});
        const url = publicObjectUrl(made.deps.config.buckets.public, PUBLIC_V1);
        await seedVersion(made, 'v1', superseded(url, overrides));
        made.deps.blobs.put('public', PUBLIC_V1, new Uint8Array(7));
        const shown = publicObjectUrl(made.deps.config.buckets.public, STORAGE_PATHS.layerTiles(CITY, LAYER, showing));
        await seedLayer(made, LAYER, { source: { type: 'pmtiles', url: shown } });
        return made;
    }

    it('happyPath_aSupersededArchiveGoesAfterItsGrace @S-A72-HAPPY-SUPERSEDED', async () => {
        const made = await cleanWorld();

        await cleanOwnTiles(made.deps, CITY, new Date(LATER.getTime() + 8 * 86_400_000));

        expect(await made.deps.blobs.stat('public', PUBLIC_V1)).toBeUndefined();
        expect((await readVersion(made, 'v1'))?.own?.removedAt).toBeDefined();
    });

    it('badPath_withinItsGraceItStays @S-A72-BAD-IN-GRACE', async () => {
        const made = await cleanWorld();

        await cleanOwnTiles(made.deps, CITY, LATER);

        expect(await made.deps.blobs.stat('public', PUBLIC_V1)).toBeDefined();
    });

    it('badPath_aLayerThatPointsAtItAgainKeepsIt @S-A72-BAD-SHOWN-AGAIN', async () => {
        const made = await cleanWorld({}, 'v1');

        await cleanOwnTiles(made.deps, CITY, new Date(LATER.getTime() + 8 * 86_400_000));

        expect(await made.deps.blobs.stat('public', PUBLIC_V1)).toBeDefined();
        expect((await readVersion(made, 'v1'))?.own?.removedAt).toBeUndefined();
    });

    it('happyPath_aRejectedVersionsPrivateTilesGoAtOnce @S-A72-HAPPY-REJECTED', async () => {
        const made = await world({ v1: waiting('v1', { output: withTiles('v1') }) });
        made.deps.blobs.put('private', tilesOf('v1').path, new Uint8Array(7));
        made.deps.blobs.put('private', tilesOf('v1').thumbPath, new Uint8Array(7));

        await rejectFunction(() => made.deps).run(adminCall({ cityId: CITY, versionId: 'v1' }));

        expect(await made.deps.blobs.stat('private', tilesOf('v1').path)).toBeUndefined();
        expect(await made.deps.blobs.stat('private', tilesOf('v1').thumbPath)).toBeUndefined();
    });

    it('happyPath_aDeletedLayersPublicArchivesGoWithIt @S-A72-HAPPY-LAYER-DELETED', async () => {
        const made = await world({});
        const other = STORAGE_PATHS.layerTiles(CITY, 'another-layer', 'v9');
        made.deps.blobs.put('public', PUBLIC_V1, new Uint8Array(7));
        made.deps.blobs.put('public', STORAGE_PATHS.layerTiles(CITY, LAYER, 'v2'), new Uint8Array(7));
        made.deps.blobs.put('public', other, new Uint8Array(7));
        const job: JobDoc = jobOf('delete-it', { type: 'layer-delete', status: 'queued', params: { layerId: LAYER } });
        await seedJob(made, 'delete-it', job);

        await expect(runLayerDelete(made.deps, CITY, 'delete-it')).resolves.toBe('succeeded');

        expect(await made.deps.blobs.list('public', STORAGE_PATHS.layerTilesPrefix(CITY, LAYER))).toEqual([]);
        expect(await made.deps.blobs.stat('public', other)).toBeDefined();
    });
});
