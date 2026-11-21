/**
 * The free Uploads API path of the publisher (`functions/src/imagery/{publish-path,publish-uploads,publish,finalize}.ts`,
 * `docs/research/M7-local-worker.md` §6): a small Studio file publishes through the Uploads API without compute units
 * (`mapbox.via: 'uploads'`); a file too large, the month's allowance used, a layer whose tileset MTS made or a token
 * without the uploads scopes go through MTS behind the compute-unit guard (`via: 'mts'`); an upload that ends in an error
 * falls back to MTS once.
 */
import { FIRESTORE_PATHS, jobLogDocSchema, type JobDoc, type LayerVersionDoc } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { runPublishTask } from '../../src/imagery/publish.js';
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
    readUsage,
    readVersion,
    readyWorld,
    renderedVersion,
    seedJob,
    seedLayer,
    seedUsage,
    seedVersion,
    type ImageryWorld,
} from './world.js';

const JOB = 'job-1966-0712';
const LAYER = 'kh-4a-corona-1966';
const TILESET = `${MAPBOX_USER}.hcm-${CITY}-${LAYER}`;
const COG = new Uint8Array(4096).fill(7);
const STUDIO = new Uint8Array(2048).fill(9);
/** The Studio file as the render recorded it: 120 MB, within the free path's 300. */
const STUDIO_BYTES = 120_000_000;

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

/** The golden version, approved, over 100 km², its Studio file `studioBytes` large (none when null). */
function approved(studioBytes: number | null = STUDIO_BYTES, overrides: Partial<LayerVersionDoc> = {}): LayerVersionDoc {
    const studio = studioBytes === null ? { studioPath: undefined, studioBytes: undefined } : { studioBytes };
    return renderedVersion({
        output: { ...goldenOutput(), areaKm2: 100, ...studio },
        georef: { ...goldenGeoref(), checkpointCount: 3 },
        state: 'approved',
        approval: { auto: false, by: 'u-admin', at: at(NOW) },
        ...overrides,
    });
}

async function publishWorld(options: { readonly scoped?: boolean; readonly version?: LayerVersionDoc; readonly job?: JobDoc } = {}) {
    const world = await readyWorld();
    const version = options.version ?? approved();
    await seedJob(world, JOB, options.job ?? awaitingJob());
    await seedVersion(world, JOB, version);
    world.deps.blobs.put('private', String(goldenOutput().cogPath), COG, { contentType: 'image/tiff' });
    world.deps.blobs.put('private', String(goldenOutput().studioPath), STUDIO, { contentType: 'image/tiff' });
    if (options.scoped !== false) {
        world.uploads.grantScopes();
    }
    return world;
}

function start(world: ImageryWorld) {
    return runPublishTask(world.deps, { cityId: CITY, jobId: JOB, phase: 'start', poll: 0 });
}

function poll(world: ImageryWorld, count: number) {
    return runPublishTask(world.deps, { cityId: CITY, jobId: JOB, phase: 'poll', poll: count });
}

async function logLines(world: ImageryWorld): Promise<string[]> {
    const lines = await world.deps.documents.query(FIRESTORE_PATHS.jobLogs(CITY, JOB), jobLogDocSchema);
    return lines.documents.map((line) => line.data.message);
}

/** The MTS path ran: the estimate reserved, the COG streamed to the tileset source, the tileset published. */
async function expectMts(world: ImageryWorld): Promise<void> {
    expect((await readUsage(world, '2026-10'))?.reservations).toEqual({ [JOB]: { computeUnits: 4, at: at(NOW), newTileset: true } });
    expect(world.tilesets.recorder.argsOf('uploadSource')).toHaveLength(1);
    expect(world.tilesets.published).toEqual([TILESET]);
    expect(world.uploads.recorder.argsOf('stage')).toEqual([]);
}

describe('the Uploads API path', () => {
    it('happyPath_aSmallFilePublishesWithoutComputeUnits @S-A64-HAPPY-UPLOADS', async () => {
        const world = await publishWorld();
        world.uploads.outcomes.push('processing');

        await start(world);

        expect(world.uploads.recorder.calls.map((call) => call.method)).toEqual(['credentials', 'stage', 'create']);
        const [url] = world.uploads.recorder.argsOf('stage')[0] ?? [];
        expect(world.uploads.staged.get(String(url))).toBe(STUDIO.length);
        expect(world.uploads.recorder.argsOf('create')).toEqual([[MAPBOX_USER, { tileset: TILESET, url, name: `hcm-${CITY}-${LAYER}` }]]);
        expect(await readJob(world, JOB)).toMatchObject({
            status: 'mts_processing',
            waitReason: 'mapbox',
            mapboxJobId: 'e2e-upload-1',
            publishAttempts: 1,
            steps: { guard: { status: 'done' }, uploads: { status: 'running' }, upload: { status: 'done' }, tiles: { status: 'running' } },
        });
        expect(await readVersion(world, JOB)).toMatchObject({
            state: 'publishing',
            mapbox: { tilesetId: TILESET, jobId: 'e2e-upload-1', origin: 'uploads', via: 'uploads' },
        });
        expect(await readUsage(world, '2026-10')).toBeUndefined();
        expect(world.deps.tasks.queued.at(-1)).toMatchObject({ payload: { phase: 'poll', poll: 0 }, options: { delaySeconds: 60 } });

        await poll(world, 0);
        expect(world.deps.tasks.queued.at(-1)).toMatchObject({ payload: { phase: 'poll', poll: 1 }, options: { delaySeconds: 120 } });
        await poll(world, 1);

        expect(world.tilesets.recorder.argsOf('tileJson')).toEqual([[TILESET]]);
        expect(await readJob(world, JOB)).toMatchObject({
            status: 'succeeded',
            steps: { tiles: { status: 'done' }, finalize: { status: 'done' } },
        });
        expect(await readVersion(world, JOB)).toMatchObject({
            state: 'published',
            mapbox: { tilesetId: TILESET, origin: 'uploads', via: 'uploads' },
        });
        const layer = await readLayer(world, LAYER);
        expect(layer?.mapbox).toEqual({ tilesetId: TILESET, origin: 'uploads' });
        expect(layer).toMatchObject({ source: { type: 'mapbox', tilesetId: TILESET }, currentVersion: JOB, status: 'ready' });
        expect(await readUsage(world, '2026-10')).toMatchObject({
            computeUnits: 0,
            publishes: 0,
            uploadedMb: 0,
            uploadsApiMb: 120,
            uploadsApiPublishes: 1,
        });
        expect((await readUsage(world, '2026-10'))?.reservations).toBeUndefined();
        expect(world.tilesets.published).toEqual([]);
        expect(world.tilesets.recorder.argsOf('uploadSource')).toEqual([]);
    });

    it('happyPath_aLayerAStudioUploadMadeIsReplacedThroughTheUploadsApi', async () => {
        const world = await publishWorld();
        await seedLayer(world, LAYER, { mapbox: { tilesetId: `${MAPBOX_USER}.studio-1966`, origin: 'studio' } });
        await seedUsage(world, '2026-10', { uploadsApiMb: 9_000, uploadsApiPublishes: 40 });

        await start(world);
        await poll(world, 0);

        expect(await readVersion(world, JOB)).toMatchObject({ state: 'published', mapbox: { via: 'uploads' } });
        expect(await readUsage(world, '2026-10')).toMatchObject({ uploadsApiMb: 9_120, uploadsApiPublishes: 41, computeUnits: 0 });
    });

    it('badPath_aFileOver300MbGoesThroughMts @S-A64-BAD-TOO-LARGE', async () => {
        const world = await publishWorld({ version: approved(400_000_000) });
        world.tilesets.outcomes.push({ stage: 'success', errors: [] });

        await start(world);
        await expectMts(world);
        await poll(world, 0);

        expect(await readVersion(world, JOB)).toMatchObject({ state: 'published', mapbox: { origin: 'mts', via: 'mts' } });
        expect(await readUsage(world, '2026-10')).toMatchObject({ computeUnits: 4, publishes: 1 });
        expect(world.uploads.recorder.calls).toEqual([]);
    });

    it('badPath_theMonthsAllowanceUsedGoesThroughMts @S-A64-BAD-TOO-LARGE', async () => {
        const world = await publishWorld();
        // 9,950 MB used: 120 more would pass the 10,000 free.
        await seedUsage(world, '2026-10', { uploadsApiMb: 9_950 });

        await start(world);

        expect(world.tilesets.recorder.argsOf('uploadSource')).toHaveLength(1);
        expect(world.uploads.recorder.calls).toEqual([]);
        expect((await readVersion(world, JOB))?.mapbox?.via).toBe('mts');
    });

    it('badPath_aVersionWithoutAStudioFileGoesThroughMts @S-A64-BAD-TOO-LARGE', async () => {
        const world = await publishWorld({ version: approved(null) });

        await start(world);

        await expectMts(world);
        expect(world.uploads.recorder.calls).toEqual([]);
    });

    it('badPath_aLayerWhoseTilesetMtsMadeStaysOnMts @S-A64-BAD-MTS-TILESET', async () => {
        const world = await publishWorld();
        await seedLayer(world, LAYER);

        await start(world);

        expect(world.uploads.recorder.calls).toEqual([]);
        expect(world.tilesets.recorder.argsOf('uploadSource')).toHaveLength(1);
        expect(world.tilesets.published).toEqual([TILESET]);
        expect((await readUsage(world, '2026-10'))?.reservations?.[JOB]).toMatchObject({ computeUnits: 4 });
    });

    it('badPath_aTokenWithoutTheUploadsScopeFallsBackToMts @S-A64-BAD-NO-SCOPE', async () => {
        const world = await publishWorld({ scoped: false });

        await start(world);

        const warnings = (await logLines(world)).filter((line) => line.includes('Uploads API'));
        expect(warnings).toEqual([
            'The Uploads API cannot publish this version (the tiles token lacks the uploads:read and uploads:write scopes); ' +
                'publishing through MTS behind the compute-unit guard.',
        ]);
        await expectMts(world);
        expect(world.uploads.recorder.calls.map((call) => call.method)).toEqual(['credentials']);
        // Nothing was staged: the refused attempt is given back.
        expect(await readJob(world, JOB)).toMatchObject({
            status: 'mts_processing',
            publishAttempts: 1,
            steps: { uploads: { status: 'skipped' }, upload: { status: 'done' } },
        });
        expect(world.deps.tasks.queued.at(-1)).toMatchObject({ payload: { phase: 'poll', poll: 0 } });
    });
});

describe('the Uploads API path: what goes wrong', () => {
    it('badPath_anUploadThatEndsInAnErrorFallsBackToMtsOnce', async () => {
        const world = await publishWorld();
        world.uploads.outcomes.push({ error: 'the GeoTIFF could not be read' });
        world.tilesets.outcomes.push({ stage: 'success', errors: [] });

        await start(world);
        await poll(world, 0);

        expect(await logLines(world)).toContain(
            'The Uploads API cannot publish this version (the upload ended in an error: the GeoTIFF could not be read); ' +
                'publishing through MTS behind the compute-unit guard.',
        );
        await expectMtsAfterUploads(world);
        // MTS's first poll is a new task (the path's poll 0 kept its name).
        expect(world.deps.tasks.queued.at(-1)).toMatchObject({ payload: { phase: 'poll', poll: 1 } });
        await poll(world, 1);
        expect(await readVersion(world, JOB)).toMatchObject({ state: 'published', mapbox: { origin: 'mts', via: 'mts' } });
        expect((await readJob(world, JOB))?.publishAttempts).toBe(2);
    });

    it('badPath_aStagingRefusedFallsBackAndKeepsTheAttempt', async () => {
        const world = await publishWorld();
        world.uploads.recorder.failNext('stage', new UpstreamError('mapbox', 'forbidden', { status: 403 }));

        await start(world);

        expect(await logLines(world)).toContain(
            'The Uploads API cannot publish this version (Mapbox answered forbidden to the stage call); ' +
                'publishing through MTS behind the compute-unit guard.',
        );
        await expectMtsAfterUploads(world);
        expect((await readJob(world, JOB))?.publishAttempts).toBe(2);
    });

    it('badPath_anUploadMapboxNoLongerKnowsFallsBack', async () => {
        const world = await publishWorld({
            job: awaitingJob({
                status: 'mts_processing',
                waitReason: 'mapbox',
                mapboxJobId: 'e2e-upload-9',
                publishAttempts: 1,
                steps: { guard: { status: 'done' }, uploads: { status: 'running' }, tiles: { status: 'running' } },
            }),
            version: approved(STUDIO_BYTES, { state: 'publishing' }),
        });

        await poll(world, 3);

        expect(await logLines(world)).toContain(
            'The Uploads API cannot publish this version (Mapbox answered notFound to the status call); ' +
                'publishing through MTS behind the compute-unit guard.',
        );
        await expectMtsAfterUploads(world);
        expect(world.deps.tasks.queued.at(-1)).toMatchObject({ payload: { phase: 'poll', poll: 4 } });
    });

    it('badPath_aTransientFailureIsLeftToCloudTasks', async () => {
        const world = await publishWorld();
        world.uploads.recorder.failNext('credentials', new UpstreamError('mapbox', 'unavailable', { status: 503 }));

        await expect(start(world)).rejects.toMatchObject({ failure: 'unavailable' });

        expect(await readJob(world, JOB)).toMatchObject({ status: 'mts_processing', steps: { uploads: { status: 'running' } } });
        expect(world.tilesets.recorder.calls).toEqual([]);

        // Cloud Tasks' retry: the path goes on where the guard left it.
        await start(world);
        expect(world.uploads.recorder.argsOf('create')).toHaveLength(1);
    });

    it('badPath_aTransientFailureOfAPollIsLeftToCloudTasks', async () => {
        const world = await publishWorld();
        await start(world);
        world.uploads.recorder.failNext('status', new UpstreamError('mapbox', 'rateLimited', { status: 429 }));

        await expect(poll(world, 0)).rejects.toMatchObject({ failure: 'rateLimited' });

        expect(await readJob(world, JOB)).toMatchObject({ status: 'mts_processing', steps: { uploads: { status: 'running' } } });
        await poll(world, 0);
        expect((await readJob(world, JOB))?.status).toBe('succeeded');
    });

    it('badPath_aPublishCancelledWhileItFallsBackStops', async () => {
        const world = await publishWorld();
        const refuse = world.deps.uploads.credentials.bind(world.deps.uploads);
        world.deps.uploads.credentials = async (user, token) => {
            await cancelMeanwhile(world);
            return refuse(user, token);
        };
        world.uploads.grantScopes();
        world.uploads.recorder.failNext('credentials', new UpstreamError('mapbox', 'unauthorized', { status: 401 }));

        await start(world);

        expect((await readJob(world, JOB))?.status).toBe('cancelled');
        expect(world.tilesets.recorder.calls).toEqual([]);
        expect(await logLines(world)).toContain(
            'The Uploads API cannot publish this version (Mapbox refused the tiles token); ' +
                'publishing through MTS behind the compute-unit guard.',
        );
    });

    it('badPath_anUploadAtItsPollCancelledMeanwhileStops', async () => {
        const world = await publishWorld();
        await start(world);
        world.uploads.outcomes.push({ error: 'x' });
        const status = world.deps.uploads.status.bind(world.deps.uploads);
        world.deps.uploads.status = async (user, token, id) => {
            await cancelMeanwhile(world);
            return status(user, token, id);
        };

        await poll(world, 0);

        expect((await readJob(world, JOB))?.status).toBe('cancelled');
        expect(world.tilesets.recorder.calls).toEqual([]);
    });

    it('happyPath_aVersionWhoseStudioFileIsGoneSendsItsCog', async () => {
        // A job the path holds whose version lost its Studio file (rewritten meanwhile): its COG is what exists.
        const world = await publishWorld({
            job: awaitingJob({
                status: 'mts_processing',
                waitReason: 'mapbox',
                steps: { guard: { status: 'done' }, uploads: { status: 'running' } },
            }),
            version: approved(null, { state: 'publishing' }),
        });

        await start(world);
        await poll(world, 0);

        expect(world.uploads.staged.get(String(world.uploads.recorder.argsOf('stage')[0]?.[0]))).toBe(COG.length);
        expect(await readUsage(world, '2026-10')).toMatchObject({ uploadsApiMb: 0, uploadsApiPublishes: 1 });
    });
});

/** The admin's cancellation landing while Mapbox is asked. */
async function cancelMeanwhile(world: ImageryWorld): Promise<void> {
    const job = await readJob(world, JOB);
    if (job !== undefined) {
        await seedJob(world, JOB, { ...job, status: 'cancelled' });
    }
}

/** After a fallback: the path skipped on the job, then the MTS path behind the guard. */
async function expectMtsAfterUploads(world: ImageryWorld): Promise<void> {
    expect((await readJob(world, JOB))?.steps?.['uploads']?.status).toBe('skipped');
    expect((await readUsage(world, '2026-10'))?.reservations?.[JOB]).toMatchObject({ computeUnits: 4 });
    expect(world.tilesets.recorder.argsOf('uploadSource')).toHaveLength(1);
    expect(world.tilesets.published).toEqual([TILESET]);
}
