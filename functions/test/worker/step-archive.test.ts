/**
 * `worker.step` and an archive series (`functions/src/worker/step-update.ts` `sourceAllowed`, `docs/research/M20-import-local.md` §4):
 * a run writes its placement report and what became of the series' sheets (`source.placedCount`, `source.skipped`), and nothing
 * else of the version's source; another job's source stays the server's.
 */
import { FIRESTORE_PATHS, type CallableResponse } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { stepFunction } from '../../src/worker/step.js';
import { failureOf } from '../admin/world.js';
import { readVersion } from '../imagery/world.js';
import { CITY, JOB, WORKER, callAs, seedHeld, workerWorld, type WorkerWorld } from './world.js';

const VERSION_PATH = FIRESTORE_PATHS.layerVersion(CITY, JOB);
const ARCHIVE_SOURCE = { kind: 'archive', archiveId: 'ar-0123456789abcdef', seriesId: 's-0123456789ab', sheetCount: 64 } as const;
const REPORT = {
    method: 'grid',
    encoding: 'lineart',
    paperTransparent: true,
    checkpointRmseM: 3.7,
    checkpointCount: 39,
    checksDropped: 0,
    measuredPct: 88,
    rivalClean: true,
};

function update(world: WorkerWorld, fields: Record<string, unknown>): Promise<CallableResponse<'worker.step'>> {
    return callAs(world, stepFunction, { workerId: WORKER, jobId: JOB, request: { op: 'update', path: VERSION_PATH, fields } });
}

async function archiveRun(): Promise<WorkerWorld> {
    const world = await workerWorld();
    await seedHeld(world, { type: 'archive-series' }, { origin: 'archive', source: ARCHIVE_SOURCE });
    return world;
}

function codeOf(promise: Promise<unknown>): Promise<unknown> {
    return failureOf(promise).then((failure) => (failure.details as { code?: unknown } | undefined)?.code);
}

describe('worker.step and an archive series (M20)', () => {
    it('happyPath_aRunWritesItsReportAndWhatBecameOfItsSheets @S-P20-HAPPY-GRID', async () => {
        const world = await archiveRun();

        await expect(update(world, { archive: REPORT, 'source.placedCount': 62, 'source.skipped': { 'too-small': 2 } })).resolves.toEqual({
            ok: true,
        });
        await expect(readVersion(world, JOB)).resolves.toMatchObject({ archive: REPORT, source: { ...ARCHIVE_SOURCE, placedCount: 62 } });
    });

    it.each([
        ['renames its series', { 'source.seriesId': 's-ffffffffffff' }],
        ['changes its sheet count', { source: { ...ARCHIVE_SOURCE, sheetCount: 1 } }],
    ])('badPath_aRunThat_%s_isRefused @S-P20-BAD-SOURCE-FORGED', async (_case, fields) => {
        const world = await archiveRun();

        expect(await codeOf(update(world, fields))).toBe('apiError.worker.refused');
        await expect(readVersion(world, JOB)).resolves.toMatchObject({ source: ARCHIVE_SOURCE });
    });

    it('badPath_anImportRunNeverRewritesItsUsgsSource @S-P20-BAD-SOURCE-FORGED', async () => {
        const world = await workerWorld();
        await seedHeld(world);

        expect(await codeOf(update(world, { 'source.entityId': 'DS-OTHER' }))).toBe('apiError.worker.refused');
    });
});
