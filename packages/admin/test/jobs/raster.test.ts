import { FIRESTORE_PATHS } from '@hcm/shared';
import { describe, expect, it, vi } from 'vitest';

import { JOBS_MODULE } from '../../src/jobs/jobs.js';
import { withNewerImport } from '../../src/jobs/raster.js';
import { failure, settle } from '../app/fakes.js';
import { at, CITY, contentWorld } from '../content/world.js';
import { answer, callsOf } from '../imagery/world.js';

function job(id: string, overrides: Record<string, unknown> = {}): [string, Record<string, unknown>] {
    return [
        FIRESTORE_PATHS.job(CITY, id),
        {
            ...{ type: 'usgs-import', status: 'failed', params: {}, createdBy: 'admin-uid', createdAt: at('2026-10-17T09:00:00Z') },
            ...{ updatedBy: 'system:pipeline', updatedAt: at('2026-10-17T09:05:00Z') },
            ...overrides,
        },
    ];
}

function world() {
    const base = contentWorld();
    for (const [path, data] of [
        job('failed', { attempt: 1, layerId: 'l', versionId: 'failed', error: { code: 'apiError.internal', message: 'GDAL' } }),
        job('spent', { attempt: 3, layerId: 'l' }),
        // CR-M3-47: a failure no retry cures, and an upload the server refused (no version, no layer), offer no Retry.
        job('token', { attempt: 1, layerId: 'l', error: { code: 'apiError.mapbox.tokenInvalid', message: 'x' } }),
        job('refused', { type: 'geotiff-import', error: { code: 'apiError.imagery.notTiff', message: 'x' } }),
        job('published', { attempt: 1, layerId: 'l', publishAttempts: 6, steps: { guard: { status: 'done' } } }),
        job('deleting', { type: 'layer-delete' }),
        job('waiting', { status: 'waiting_usgs', waitReason: 'rate-limited', retryAt: at('2026-10-21T09:00:00Z') }),
        job('points', { type: 'geotiff-import', status: 'awaiting_gcps', waitReason: 'gcps', versionId: 'points' }),
    ]) {
        base.store.docs.set(path, data);
    }
    const jobs = JOBS_MODULE.create(base.services);
    jobs.open([]);
    return { ...base, jobs };
}

function item(jobs: ReturnType<typeof world>['jobs'], id: string) {
    return jobs.state.list.items.find((candidate) => candidate.id === id);
}

describe('the jobs area: raster jobs', () => {
    it('happyPath_whyAJobWaitsUntilWhenItsVersionAndWhetherItRunsAgain', () => {
        const { jobs } = world();

        expect(item(jobs, 'waiting')).toMatchObject({ waitReason: 'rate-limited', retryAt: '2026-10-21T09:00:00.000Z', retryable: false });
        expect(item(jobs, 'points')).toMatchObject({ waitReason: 'gcps', versionId: 'points', retryable: false });
        expect(item(jobs, 'failed')).toMatchObject({ waitReason: null, retryAt: null, versionId: 'failed', retryable: true });
        expect(['spent', 'deleting', 'token', 'refused', 'published'].map((id) => item(jobs, id)?.retryable)).toEqual([
            false,
            false,
            false,
            false,
            false,
        ]);
    });

    it('happyPath_aFailedRasterJobIsQueuedAgainOnce', async () => {
        const { jobs, callables, notices } = world();
        answer(callables, 'imagery.retry', () => ({ status: 'queued', attempt: 1 }));
        jobs.open(['failed']);

        const first = jobs.intents.retryJob();
        const second = jobs.intents.retryJob();
        const retrying = jobs.state.retrying;

        await expect(Promise.all([first, second])).resolves.toEqual([true, false]);
        expect(retrying).toBe(true);
        expect(jobs.state.retrying).toBe(false);
        expect(callsOf(callables, 'imagery.retry')).toEqual([{ cityId: CITY, jobId: 'failed' }]);
        expect(notices.map((notice) => notice.key)).toEqual(['adminContent.jobs.retried']);
    });

    it('badPath_aRefusedRetrySaysWhyAndAJobThatCannotRunAgainCallsNothing', async () => {
        const { jobs, callables, notices } = world();
        callables.fail('imagery.retry', failure('failed-precondition', 'apiError.imagery.attemptsExhausted'));
        jobs.open(['spent']);
        const spent = await jobs.intents.retryJob();
        jobs.open(['failed']);
        await settle();

        await expect(jobs.intents.retryJob()).resolves.toBe(false);
        expect(spent).toBe(false);
        expect(callsOf(callables, 'imagery.retry')).toHaveLength(1);
        expect(notices.map((notice) => notice.key)).toEqual(['apiError.imagery.attemptsExhausted']);
    });

    it('badPath_anImportDoneAgainLaterOffersTheNewerOneInsteadOfABareRefusal', async () => {
        // The owner's report of 2026-11-13: the 1972 frame's old import, set aside after a newer import of the frame.
        const { jobs, callables, notices } = world();
        callables.fail(
            'imagery.retry',
            failure('failed-precondition', 'apiError.imagery.importedAgain', { versionId: 'im-new-D3C1202-200149F039' }),
        );
        jobs.open(['failed']);
        await settle();

        await expect(jobs.intents.retryJob()).resolves.toBe(false);

        const place = { hash: '' };
        vi.stubGlobal('location', place);
        const [notice] = notices;
        expect(notice).toMatchObject({ key: 'apiError.imagery.importedAgain', action: { key: 'adminContent.jobs.openNewer' } });
        notice?.action?.run();
        expect(place.hash).toBe('#/imagery/version/im-new-D3C1202-200149F039');
        vi.unstubAllGlobals();
        expect(withNewerImport({ key: 'apiError.imagery.importedAgain' })).toEqual({ key: 'apiError.imagery.importedAgain' });
    });

    it('badPath_noOpenJobRetriesNothing', async () => {
        const { jobs, callables } = world();

        await expect(jobs.intents.retryJob()).resolves.toBe(false);
        expect(callsOf(callables, 'imagery.retry')).toEqual([]);
    });
});
