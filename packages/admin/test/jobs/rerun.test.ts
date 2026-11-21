/**
 * Lesson 728 (the owner's request of 2026-11-14): a scene's import that failed, was cancelled or waits for approval runs again on the
 * latest pipeline from its job's page (`imagery.import` with `again`): a new version of its layer, whose page then opens.
 */
import { FIRESTORE_PATHS } from '@hcm/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { JOBS_MODULE } from '../../src/jobs/jobs.js';
import { failure, settle } from '../app/fakes.js';
import { at, CITY, contentWorld } from '../content/world.js';
import { answer, callsOf } from '../imagery/world.js';

const L1991 = 'LT51820291991181XXX03';

function job(id: string, overrides: Record<string, unknown>): [string, Record<string, unknown>] {
    return [
        FIRESTORE_PATHS.job(CITY, id),
        {
            ...{ type: 'usgs-import', params: { entityId: L1991, dataset: 'landsat_tm_c2_l1', sensor: 'L5-TM' } },
            ...{
                createdBy: 'admin-uid',
                createdAt: at('2026-11-14T09:00:00Z'),
                updatedBy: 'system:pipeline',
                updatedAt: at('2026-11-14T09:05:00Z'),
            },
            ...overrides,
        },
    ];
}

function world() {
    const base = contentWorld();
    for (const [path, data] of [
        job('cancelled', { status: 'cancelled', versionId: 'cancelled' }),
        job('waiting', { status: 'awaiting_approval', versionId: 'waiting' }),
        job('failed', { status: 'failed', versionId: 'failed' }),
        job('running', { status: 'running' }),
        job('upload', { type: 'geotiff-import', status: 'failed', params: {} }),
        job('nameless', { status: 'failed', params: {} }),
    ]) {
        base.store.docs.set(path, data);
    }
    const jobs = JOBS_MODULE.create(base.services);
    jobs.open([]);
    return { ...base, jobs };
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('the jobs area: Run again with the latest pipeline', () => {
    it('happyPath_aCancelledLandsatImportRunsAgainAndItsNewVersionOpens @S-A130-HAPPY-RUN-AGAIN-JOB', async () => {
        const { jobs, callables, notices } = world();
        const place = { hash: '' };
        vi.stubGlobal('location', place);
        answer(callables, 'imagery.import', () => ({ jobId: 'im-new', versionId: 'im-new', layerId: 'l' }));
        jobs.open(['cancelled']);
        await settle();

        const first = jobs.intents.runAgain();
        const rerunning = jobs.state.rerunning;
        const second = jobs.intents.runAgain();

        await expect(Promise.all([first, second])).resolves.toEqual([true, false]);
        expect(rerunning).toBe(true);
        expect(jobs.state.rerunning).toBe(false);
        expect(callsOf(callables, 'imagery.import')).toEqual([{ cityId: CITY, entityId: L1991, again: true }]);
        expect(place.hash).toBe('#/imagery/version/im-new');
        expect(notices.map((notice) => notice.key)).toEqual(['adminContent.imagery.notice.imported']);
        const scenes = ['cancelled', 'waiting', 'failed', 'running', 'upload', 'nameless'].map(
            (id) => jobs.state.list.items.find((item) => item.id === id)?.rerunScene,
        );
        expect(scenes).toEqual([L1991, L1991, L1991, null, null, null]);
    });

    it('badPath_aRefusedRunAgainSaysWhyAndAJobWithNoSceneCallsNothing @S-A130-BAD-RUN-AGAIN-JOB', async () => {
        const { jobs, callables, notices } = world();
        callables.fail('imagery.import', failure('failed-precondition', 'apiError.usgs.accessPending'));
        jobs.open(['running']);
        await settle();
        const running = await jobs.intents.runAgain();
        jobs.open(['failed']);
        await settle();

        await expect(jobs.intents.runAgain()).resolves.toBe(false);
        expect(running).toBe(false);
        expect(callsOf(callables, 'imagery.import')).toHaveLength(1);
        expect(notices.map((notice) => notice.key)).toEqual(['apiError.usgs.accessPending']);
    });
});
