/**
 * `imagery.retry` of a job the owner stopped (`functions/src/imagery/retry.ts`; docs/LESSONS.md 565, 2026-11-12): the 1914 SOCEC
 * series had the owner's pairs saved (`imagery.saveGcps`), was stopped (Stop writes `cancelRequested`, the dispatcher ends the job),
 * then tried again. The retried job must not carry the Stop: kept, the dispatcher and every worker's claim pass the job over and
 * `imagery.tick` cancels it again, while its version sits `processing`, which the georeferencer shows read-only. The version keeps
 * the owner's pairs, so `place` warps the series through them (`pipeline/src/hcm_pipeline/placing/owner.py`).
 */
import { FIRESTORE_PATHS, jobDocSchema, type Gcp, type JobDoc, type LayerVersionDoc } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { onJobWrite } from '../../src/imagery/on-job-write.js';
import { retryFunction } from '../../src/imagery/retry.js';
import { saveGcpsFunction } from '../../src/imagery/save-gcps.js';
import { cancelAsked } from '../../src/imagery/tick-jobs.js';
import { failureOf } from '../admin/world.js';
import { adminCall } from '../publish/fakes.js';
import { CITY, NOW, at, needsGcpsVersion, readJob, readVersion, readyWorld, seedJob, seedVersion, type ImageryWorld } from './world.js';

const SERIES = 'ar-socec1914-s-0123456789ab';
const PARAMS = {
    ...{ archiveId: 'ar-0123456789abcdef', seriesId: 's-0123456789ab', class: 'grid', sheets: 4, encoding: 'grey' },
    ...{ order: 0, referenceLayerIds: [] },
};

/** The series' version parked for points: its stitched picture as its `scan`, and why it waits (`help`). */
function parkedVersion(): LayerVersionDoc {
    const source = { kind: 'archive' as const, archiveId: PARAMS.archiveId, seriesId: PARAMS.seriesId, sheetCount: 4 };
    const help = { reason: 'no-scale' as const, note: 'The map states no scale.', at: at(NOW) };
    return needsGcpsVersion({ origin: 'archive', source, help });
}

/** Eight pairs spread over the 8192 × 6144 scan, mapped by a plain affine onto central Bucharest. */
function pairs(): Gcp[] {
    return Array.from({ length: 8 }, (_, index) => {
        const x = ((index * 37) % 11) * (8192 / 11) + 50;
        const y = ((index * 53) % 7) * (6144 / 7) + 50;
        const geo = { lat: 44.5 - y * 0.00002 + (index % 3) * 0.000001, lng: 26 + x * 0.00002 };
        return { id: `g${String(index + 1)}`, pixel: { x, y }, geo, enabled: index < 6, origin: 'manual' as const };
    });
}

/** The series parked for points on the owner's computer, as `place` left it. */
function parkedSeries(): JobDoc {
    return {
        ...{ type: 'archive-series', status: 'awaiting_gcps', waitReason: 'gcps', params: PARAMS, runOn: 'local', localOnly: true },
        ...{ createdBy: 'uid-owner', createdAt: at(NOW), layerId: 'socec-1914', versionId: SERIES, attempt: 1 },
        steps: { gather: { status: 'done' }, place: { status: 'pending' } },
        ...{ updatedBy: 'system:pipeline', updatedAt: at(NOW) },
    };
}

/** The job written by `write`, with the trigger run on that write as the server runs it. */
async function written(world: ImageryWorld, write: () => Promise<unknown>): Promise<JobDoc | undefined> {
    const before = await readJob(world, SERIES);
    await write();
    const after = await readJob(world, SERIES);
    await onJobWrite(world.deps, CITY, SERIES, { before, after });
    return readJob(world, SERIES);
}

/** The owner's pairs saved on the parked series, then the owner's Stop carried out by the dispatcher. */
async function savedThenStopped(overdue: Pick<JobDoc, 'workerOverdueAt'> = {}): Promise<ImageryWorld> {
    const world = await readyWorld();
    await seedVersion(world, SERIES, parkedVersion());
    await seedJob(world, SERIES, parkedSeries());
    const save = saveGcpsFunction(() => world.deps);
    await written(world, () => save.run(adminCall({ cityId: CITY, transform: 'affine', versionId: SERIES, gcps: pairs() })));
    const stop = async (): Promise<void> => {
        const job = await readJob(world, SERIES);
        if (job !== undefined) {
            await world.deps.documents.set(FIRESTORE_PATHS.job(CITY, SERIES), jobDocSchema, { ...job, ...overdue, cancelRequested: true });
        }
    };
    expect(await written(world, stop)).toMatchObject({ status: 'cancelled', cancelRequested: true });
    expect((await readVersion(world, SERIES))?.state).toBe('cancelled');
    return world;
}

function retry(world: ImageryWorld) {
    return retryFunction(() => world.deps).run(adminCall({ cityId: CITY, jobId: SERIES }));
}

describe('imagery.retry: a stopped archive series with the owner pairs (2026-11-12)', () => {
    it('happyPath_theRetriedSeriesRunsAgainWithoutTheStop_itsVersionKeepsThePairs @S-A12-HAPPY-RETRY-STOPPED-PAIRS', async () => {
        const world = await savedThenStopped();

        const job = await written(world, () => retry(world));

        expect(job).toMatchObject({ status: 'queued', attempt: 0, steps: { gather: { status: 'pending' }, place: { status: 'pending' } } });
        expect(job?.cancelRequested).toBeUndefined();
        expect(job?.placingPoints).toBeUndefined();
        const version = await readVersion(world, SERIES);
        expect(version?.state).toBe('processing');
        expect(version?.georef).toMatchObject({ method: 'gcps', transform: 'affine' });
        expect(version?.georef?.gcps).toHaveLength(8);
        // The tick's pass over cancellations a lost event left behind no longer ends the retried series again.
        await cancelAsked(world.deps, CITY);
        expect((await readJob(world, SERIES))?.status).toBe('queued');
        expect((await readVersion(world, SERIES))?.state).toBe('processing');
    });

    it('happyPath_aSeriesStoppedWhileOverdueStartsItsNewWaitFresh @S-A12-HAPPY-RETRY-STOPPED-PAIRS', async () => {
        // tick-worker marks a queued local job no worker took (`workerOverdueAt`); a retry is a new wait, not an overdue one.
        const world = await savedThenStopped({ workerOverdueAt: at(NOW) });

        const job = await written(world, () => retry(world));

        expect(job).toMatchObject({ status: 'queued', runOn: 'local' });
        expect(job?.workerOverdueAt).toBeUndefined();
        expect(job?.cancelRequested).toBeUndefined();
    });

    it('badPath_aStoppedSeriesWhoseVersionWasDismissedIsNotBroughtBack_theStopStays @S-A12-BAD-RETRY-STOPPED-DISMISSED', async () => {
        const world = await savedThenStopped();
        const version = await readVersion(world, SERIES);
        await seedVersion(world, SERIES, { ...parkedVersion(), ...version, state: 'rejected' });

        expect(await failureOf(retry(world))).toMatchObject({ details: { code: 'apiError.imagery.versionRejected' } });

        expect(await readJob(world, SERIES)).toMatchObject({ status: 'cancelled', cancelRequested: true });
        expect((await readVersion(world, SERIES))?.state).toBe('rejected');
    });
});
