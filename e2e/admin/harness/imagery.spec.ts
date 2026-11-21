import { rasterRecipe, VERSION_FILES } from '@hcm/shared';
import { MAPBOX_TOKENS, publishedTileColour } from '@hcm/test-support/fakes';
import type { APIRequestContext } from '@playwright/test';

import { MOCK_API_ORIGIN } from '../../fixtures/world.js';
import { projectCity } from '../support/content.js';
import { openHarnessPage } from '../support/harness.js';
import { ImageryWorld, IMAGERY_MAPBOX_USER } from '../support/imagery.js';
import { seedCity } from '../support/ops.js';
import { ADMIN_LOCK, expect, test } from '../support/test.js';
import type { UpstreamControl } from '../support/upstream.js';
import type { EmulatorWorld } from '../support/emulators.js';

// One admin test at a time: the imagery world writes setup/status, ops/guard and the server's upstream world.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * Harness (behaviour A00): the M3 imagery world of the admin tier (docs/research/M3-interfaces.md §13), before the
 * screens and the backend that use it: the fake Cloud Run hands a pipeline run to the stand-in runner, which writes what
 * the raster pipeline writes (validated with the shared schemas) and ends a run every way the pipeline does; a tileset
 * the fake MTS published serves its colour to any page; and no admin page reaches a host only servers call, an
 * OpenStreetMap tile or Mapbox Satellite. The specs of the Imagery area build on exactly this.
 */

const AT = new Date('2026-10-20T09:00:00Z');
const SCENE = { entityId: 'DS1035-1057DA023', dataset: 'corona2', sensor: 'KH-4A' } as const;
const LAYER = 'kh-4a-corona-1966';
/** The stand-in plays a run in a few seconds; a busy emulator may take longer. */
const RUN_TIMEOUT_MS = 60_000;

/**
 * The server's world ready, with auto-publish off: fn-imagery's trigger runs in the Functions emulator, and the harness
 * tests the runner, so the approval policy leaves a version the stand-in registered waiting (`S-A17-*` test the policy).
 */
async function imageryWorld(emulators: EmulatorWorld, api: APIRequestContext, upstream: UpstreamControl): Promise<ImageryWorld> {
    const city = projectCity(emulators, 'system:setup');
    await seedCity(city, AT);
    const imagery = new ImageryWorld(api, city, upstream);
    await imagery.ready(AT, { autoPublish: false });
    await imagery.resetRunner();
    return imagery;
}

/**
 * A free scene's import as `imagery.import` creates it, the job already `starting` as the dispatcher leaves it just before
 * `jobs:run`: a `queued` job would be dispatched by fn-imagery's trigger too, and the harness dispatches it itself.
 */
async function seedImport(imagery: ImageryWorld, jobId: string): Promise<void> {
    await imagery.seedVersion(
        jobId,
        {
            layerId: LAYER,
            origin: 'usgs',
            state: 'processing',
            source: { kind: 'usgs', ...SCENE, acquisitionDate: '1966-07-12' },
            label: { ro: 'KH-4A Corona, 12 iulie 1966', en: 'KH-4A Corona, 12 July 1966' },
            year: 1966,
            date: '1966-07-12',
            sensor: 'KH-4A',
        },
        AT,
    );
    await imagery.seedJob(jobId, { type: 'usgs-import', status: 'starting', params: { ...SCENE }, layerId: LAYER, versionId: jobId }, AT);
}

/** A field of a document, read with a dotted path. */
function field(document: Record<string, unknown> | undefined, path: string): unknown {
    return path.split('.').reduce<unknown>((value, key) => (value as Record<string, unknown> | undefined)?.[key], document);
}

async function expectJob(imagery: ImageryWorld, jobId: string, path: string, value: unknown): Promise<void> {
    await expect.poll(async () => field(await imagery.job(jobId), path), { timeout: RUN_TIMEOUT_MS }).toEqual(value);
}

async function expectExecution(imagery: ImageryWorld, name: string, state: string): Promise<void> {
    await expect.poll(() => imagery.execution(name), { timeout: RUN_TIMEOUT_MS }).toBe(state);
}

test(
    'The fake Cloud Run hands a pipeline run to the stand-in, which writes what the pipeline writes',
    { tag: '@S-A00-HAPPY-IMAGERY-RUNNER' },
    async ({ adminWorld, mockApiRequest, upstream }) => {
        const imagery = await imageryWorld(adminWorld.emulators, mockApiRequest, upstream);
        await imagery.script({ attempts: [{ outcome: 'under', holdAt: 'georef' }] });
        await seedImport(imagery, 'job-1966');

        const execution = await imagery.dispatch('job-1966');
        await expectJob(imagery, 'job-1966', 'steps.reference.status', 'done');
        const held = await imagery.version('job-1966');
        expect([field(held, 'scan.previewScale'), field(held, 'reference.s2Item'), field(held, 'georef.method')]).toEqual([
            0.5,
            'S2B_35TMK_20250803_0_L2A',
            'corners',
        ]);
        expect([await imagery.execution(execution), field(await imagery.job('job-1966'), 'status')]).toEqual(['running', 'running']);

        expect(await imagery.release()).toBe(1);
        await expectJob(imagery, 'job-1966', 'status', 'awaiting_approval');
        const version = await imagery.version('job-1966');
        expect(version).toMatchObject({
            state: 'awaiting_approval',
            georef: { method: 'auto', transform: 'affine', checkpointRmseM: 6.2, checkpointCount: 3 },
            output: { minzoom: 10, maxzoom: 16, previewPath: `rasters/bucharest/${LAYER}/job-1966/preview.png` },
        });
        expect(await imagery.job('job-1966')).toMatchObject({
            waitReason: 'approval',
            progress: 1,
            steps: { register: { status: 'done' } },
        });
        expect(await imagery.objects(`rasters/bucharest/${LAYER}/job-1966/`)).toEqual(
            [...VERSION_FILES].map((file) => `rasters/bucharest/${LAYER}/job-1966/${file}`).sort((a, b) => a.localeCompare(b)),
        );
        expect(await imagery.objects('work/bucharest/job-1966/')).toEqual([]);
        await expectExecution(imagery, execution, 'succeeded');
        expect(await imagery.runs()).toEqual([
            expect.objectContaining({ jobId: 'job-1966', attempt: 1, outcome: 'under', state: 'ended' }),
        ]);
        expect(Object.values(await imagery.logs('job-1966')).map((line) => line['message'])).toContain(
            'register done: the version awaits approval',
        );
    },
);

test(
    'A scripted failure, a USGS maintenance, too few pairs and an out-of-memory kill end the run as the pipeline would',
    { tag: '@S-A00-BAD-IMAGERY-RUNNER-ENDS' },
    async ({ adminWorld, mockApiRequest, upstream }) => {
        const imagery = await imageryWorld(adminWorld.emulators, mockApiRequest, upstream);

        await imagery.script({ attempts: [{ outcome: 'fail', failAt: 'warp', code: 'apiError.imagery.unreadableRaster' }] });
        await seedImport(imagery, 'job-fail');
        const failed = await imagery.dispatch('job-fail');
        await expectJob(imagery, 'job-fail', 'status', 'failed');
        expect(await imagery.job('job-fail')).toMatchObject({
            error: { code: 'apiError.imagery.unreadableRaster' },
            steps: { warp: { status: 'failed' } },
        });
        expect(await imagery.version('job-fail')).toMatchObject({ state: 'failed', error: { code: 'apiError.imagery.unreadableRaster' } });
        await expectExecution(imagery, failed, 'failed');

        await imagery.script({ attempts: [{ outcome: 'maintenance' }] });
        await seedImport(imagery, 'job-wait');
        await imagery.dispatch('job-wait');
        await expectJob(imagery, 'job-wait', 'status', 'waiting_usgs');
        expect(await imagery.job('job-wait')).toMatchObject({ waitReason: 'usgs-maintenance', steps: { fetch: { status: 'pending' } } });

        await imagery.script({ attempts: [{ outcome: 'no-match' }] });
        await seedImport(imagery, 'job-points');
        await imagery.dispatch('job-points');
        await expectJob(imagery, 'job-points', 'status', 'awaiting_gcps');
        expect(await imagery.version('job-points')).toMatchObject({
            state: 'needs_gcps',
            error: { code: 'apiError.imagery.noMatch', params: { pairs: '3' } },
            georef: { method: 'corners' },
        });

        await imagery.script({ attempts: [{ outcome: 'oom', failAt: 'warp' }] });
        await seedImport(imagery, 'job-oom');
        const killed = await imagery.dispatch('job-oom');
        await expectExecution(imagery, killed, 'failed');
        const lost = await imagery.job('job-oom');
        expect([field(lost, 'status'), field(lost, 'steps.georef.status'), field(lost, 'steps.warp')]).toEqual([
            'running',
            'done',
            undefined,
        ]);
    },
);

test(
    "The admin's cancel reaches the run as SIGTERM; without a cancel the job goes back to the queue",
    { tag: '@S-A00-BAD-IMAGERY-RUNNER-CANCEL' },
    async ({ adminWorld, mockApiRequest, upstream }) => {
        const imagery = await imageryWorld(adminWorld.emulators, mockApiRequest, upstream);
        await imagery.script({ attempts: [{ outcome: 'under', holdAt: 'extract' }] });
        await seedImport(imagery, 'job-cancel');
        await seedImport(imagery, 'job-sigterm');

        const cancelled = await imagery.dispatch('job-cancel');
        await expectJob(imagery, 'job-cancel', 'steps.fetch.status', 'done');
        await adminWorld.emulators.updateFields('cities/bucharest/jobs/job-cancel', { cancelRequested: true }, ['cancelRequested']);
        await imagery.cancelExecution(cancelled);
        await expectJob(imagery, 'job-cancel', 'status', 'cancelled');
        expect(await imagery.version('job-cancel')).toMatchObject({ state: 'cancelled' });
        await expectExecution(imagery, cancelled, 'cancelled');

        const stopped = await imagery.dispatch('job-sigterm');
        await expectJob(imagery, 'job-sigterm', 'steps.fetch.status', 'done');
        await imagery.cancelExecution(stopped);
        await expectJob(imagery, 'job-sigterm', 'status', 'queued');
        expect(await imagery.job('job-sigterm')).toMatchObject({
            steps: { extract: { status: 'pending' } },
            retryAt: expect.any(String),
        });
        expect(await imagery.objects('work/bucharest/job-cancel/')).toEqual([]);
    },
);

test(
    'A tileset the fake MTS published serves its own colour to every page',
    { tag: '@S-A00-HAPPY-PUBLISHED-TILES' },
    async ({ page, mockApiRequest }) => {
        const name = 'hcm-bucharest-kh-4a-corona-1966';
        const tileset = `${IMAGERY_MAPBOX_USER}.${name}`;
        const mts = (path: string): string => `${MOCK_API_ORIGIN}/h/api.mapbox.com/tilesets/v1/${path}?access_token=${MAPBOX_TOKENS.tiles}`;
        // As the publisher does, in the server's world (no test header: the shared partition).
        await mockApiRequest.post(mts(`sources/${IMAGERY_MAPBOX_USER}/${name}`), { data: 'COG' });
        await mockApiRequest.post(mts(tileset), { data: { name, recipe: rasterRecipe(IMAGERY_MAPBOX_USER, name, 10, 16) } });
        const { jobId } = (await (await mockApiRequest.post(mts(`${tileset}/publish`), { data: {} })).json()) as { jobId: string };
        await expect
            .poll(async () => ((await (await mockApiRequest.get(mts(`${tileset}/jobs/${jobId}`))).json()) as { stage: string }).stage)
            .toBe('success');

        await openHarnessPage(page);
        const seen = await page.evaluate(async (id) => {
            const tileJson = (await (await fetch(`https://api.mapbox.com/v4/${id}.json?access_token=pk.e2e-fake-token`)).json()) as {
                minzoom: number;
                maxzoom: number;
            };
            const tile = await fetch(`https://api.mapbox.com/v4/${id}/12/2340/1489.png?access_token=pk.e2e-fake-token`);
            const bitmap = await createImageBitmap(await tile.blob());
            const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
            const context = canvas.getContext('2d');
            context?.drawImage(bitmap, 0, 0);
            return { zooms: [tileJson.minzoom, tileJson.maxzoom], pixel: [...(context?.getImageData(8, 8, 1, 1).data ?? [])].slice(0, 3) };
        }, tileset);

        expect(seen).toEqual({ zooms: [10, 16], pixel: [...publishedTileColour(tileset)] });
    },
);

test(
    'USGS, STAC, Overpass, OpenStreetMap tiles and Mapbox Satellite stay blocked for every admin page',
    { tag: '@S-A00-BAD-SERVER-ONLY-HOSTS' },
    async ({ page, firewall }) => {
        const refused = [
            'https://ims.cr.usgs.gov/browse/declass1/DS1035-1057DA023.jpg',
            'https://m2m.cr.usgs.gov/api/api/json/stable/login-token',
            'https://earth-search.aws.element84.com/v1/search',
            'https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/35/T/MK/2025/8/S2B_35TMK_20250803_0_L2A/TCI.tif',
            'https://overpass-api.de/api/interpreter',
            'https://tile.openstreetmap.org/12/2340/1489.png',
            'https://api.mapbox.com/styles/v1/mapbox/satellite-v9?access_token=pk.e2e-fake-token',
            'https://api.mapbox.com/v4/mapbox.satellite/12/2340/1489@2x.jpg90?access_token=pk.e2e-fake-token',
        ];
        await openHarnessPage(page);

        for (const url of refused) {
            await expect(page.goto(url)).rejects.toThrow(/ERR_BLOCKED_BY_CLIENT/);
        }

        expect(firewall.take()).toEqual(refused);
    },
);
