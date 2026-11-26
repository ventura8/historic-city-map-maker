import { FIRESTORE_PATHS } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { RECONNECT_DELAYS_MS } from '../../src/content/live.js';
import { JOBS_MODULE, jobsQuery, type JobsState } from '../../src/jobs/jobs.js';
import { at, CITY, contentWorld, type ContentWorld } from '../content/world.js';

const JOBS = FIRESTORE_PATHS.jobs(CITY);

function job(id: string, overrides: Record<string, unknown> = {}): [string, Record<string, unknown>] {
    return [
        FIRESTORE_PATHS.job(CITY, id),
        {
            type: 'usgs-import',
            status: 'running',
            params: {},
            createdBy: 'admin-uid',
            createdAt: at('2026-10-17T09:00:00Z'),
            updatedBy: 'system:pipeline',
            updatedAt: at('2026-10-17T09:05:00Z'),
            ...overrides,
        },
    ];
}

function logLine(jobId: string, seq: number, message: string): [string, Record<string, unknown>] {
    return [
        `${FIRESTORE_PATHS.jobLogs(CITY, jobId)}/${String(seq).padStart(6, '0')}`,
        {
            seq,
            level: seq === 2 ? 'error' : 'info',
            step: 'fetch',
            message,
            updatedBy: 'system:pipeline',
            updatedAt: at('2026-10-17T09:01:00Z'),
        },
    ];
}

function world(): ContentWorld & { readonly states: JobsState[]; readonly store: ContentWorld['store'] } {
    const base = contentWorld();
    for (const [path, data] of [
        job('a', { createdAt: at('2026-10-17T08:00:00Z'), status: 'succeeded' }),
        job('b', { progress: 0.42, step: 'fetch', steps: { fetch: { status: 'running' } } }),
        job('c', { status: 'failed', createdAt: at('2026-10-17T07:00:00Z'), error: { code: 'usgs.down', message: 'USGS did not answer' } }),
        logLine('b', 1, 'fetching the scene'),
        logLine('b', 2, 'a <b>bold</b> line stays text'),
    ]) {
        base.store.docs.set(path, data);
    }
    return { ...base, states: [] };
}

describe("a job's steps", () => {
    it('happyPath_theyReadInTheOrderTheTypeRunsThem_whateverTheStoredMapsOrder @S-A18-HAPPY-STEP-ORDER', () => {
        const steps = {
            locate: { status: 'pending' },
            fetch: { status: 'done' },
            'mts-retry': { status: 'done' },
            stitch: { status: 'done' },
        };
        const seeded = world();
        const [path, data] = job('z', { steps });
        seeded.store.docs.set(path, data);
        const jobs = JOBS_MODULE.create(seeded.services);

        jobs.open(['z']);

        expect(jobs.state.detail?.job.doc?.data.steps.map((step) => step.name)).toEqual(['fetch', 'stitch', 'locate', 'mts-retry']);
        jobs.close();
    });
});

describe('the jobs area', () => {
    it('happyPath_listsTheCitysJobsNewestFirstAndOpensOneWithItsLogLines', () => {
        const { services } = world();
        const jobs = JOBS_MODULE.create(services);

        jobs.open([]);
        expect(jobs.state.list.items.map((item) => item.id)).toEqual(['b', 'a', 'c']);
        jobs.open(['b']);

        const detail = jobs.state.detail;
        expect(detail?.job.doc?.data).toMatchObject({
            id: 'b',
            progress: 0.42,
            step: 'fetch',
            finished: false,
            steps: [{ name: 'fetch', status: 'running' }],
        });
        expect(detail?.logs.items.map((line) => [line.seq, line.level, line.message])).toEqual([
            [1, 'info', 'fetching the scene'],
            [2, 'error', 'a <b>bold</b> line stays text'],
        ]);
        expect(JOBS_MODULE.area).toBe('jobs');
        expect(jobs.hasUnsavedChanges()).toBe(false);
    });

    it('happyPath_filtersByStatusAndLoadsMore', () => {
        const { services } = world();
        const jobs = JOBS_MODULE.create(services);
        jobs.open([]);

        jobs.intents.setFilter('failed');
        const failed = jobs.state.list.items.map((item) => item.id);
        jobs.intents.setFilter('done');
        const done = jobs.state.list.items.map((item) => item.id);
        jobs.intents.setFilter('active');
        jobs.intents.more();

        expect([failed, done, jobs.state.list.items.map((item) => item.id)]).toEqual([['c'], ['a'], ['b']]);
        expect(jobsQuery('all')).toEqual({ where: [], orderBy: [['createdAt', 'desc']] });
    });

    it('happyPath_aRunningJobIsAskedToStopWithoutAVersionCheck', async () => {
        const { services, store, notices } = world();
        const jobs = JOBS_MODULE.create(services);
        jobs.open(['b']);

        const outcome = await jobs.intents.cancel();

        expect(outcome).toEqual({ ok: true });
        expect(store.writes).toEqual([
            { kind: 'update', path: FIRESTORE_PATHS.job(CITY, 'b'), fields: { cancelRequested: true }, expected: null },
        ]);
        expect(jobs.state.detail?.job.doc?.data.cancelRequested).toBe(true);
        expect(notices).toEqual([{ key: 'adminContent.jobs.cancelRequested' }]);
        await expect(jobs.intents.cancel()).resolves.toBeNull();
    });

    it('happyPath_aJobWaitingForItsDateSaysWhen', () => {
        const { services, store } = world();
        store.docs.set(...job('w', { type: 'layer-delete', status: 'queued', dispatchAt: at('2026-10-24T09:00:00Z') }));
        const jobs = JOBS_MODULE.create(services);

        jobs.open(['w']);

        expect(jobs.state.detail?.job.doc?.data).toMatchObject({
            type: 'layer-delete',
            dispatchAt: '2026-10-24T09:00:00.000Z',
            finished: false,
        });
    });
});

describe('the jobs area: refusals and failures', () => {
    it('badPath_aFinishedJobOffersNoCancelAndARefusedCancelIsReported', async () => {
        const { services, store, notices, denials } = world();
        const jobs = JOBS_MODULE.create(services);
        jobs.open(['a']);
        await expect(jobs.intents.cancel()).resolves.toBeNull();

        jobs.open(['b']);
        store.outcomes.push({ ok: false, reason: 'denied' });
        await jobs.intents.cancel();
        store.setOffline(true);
        await jobs.intents.cancel();

        expect(notices.map((notice) => notice.key)).toEqual(['adminContent.jobs.cancelRefused', 'adminContent.common.offline']);
        expect(denials.count).toBe(1);
        expect(jobs.state.cancelling).toBe(false);
    });

    it('badPath_aDroppedLogListenerComesBackWithEachLineOnce', () => {
        const { services, store, clock } = world();
        const jobs = JOBS_MODULE.create(services);
        jobs.open(['b']);
        const logs = FIRESTORE_PATHS.jobLogs(CITY, 'b');

        store.fail(logs, { kind: 'unavailable', code: 'unavailable' });
        expect(jobs.state.detail?.logs).toMatchObject({ reconnecting: true });
        store.docs.set(...logLine('b', 3, 'after the drop'));
        clock.advance(RECONNECT_DELAYS_MS[0] ?? 0);

        expect(jobs.state.detail?.logs.items.map((line) => line.seq)).toEqual([1, 2, 3]);
        expect(jobs.state.detail?.logs.reconnecting).toBe(false);
    });

    it('badPath_anUnknownOrMalformedJobIsNotFoundAndTryAgainReattaches', () => {
        const { services, store } = world();
        const jobs = JOBS_MODULE.create(services);
        jobs.open(['missing']);
        expect(jobs.state.detail?.job).toMatchObject({ status: 'ready', doc: null });
        jobs.open(['not a valid id!']);
        expect(jobs.state.detail).toMatchObject({ id: 'not a valid id!', job: { status: 'ready', doc: null } });

        jobs.open(['b']);
        store.fail(FIRESTORE_PATHS.job(CITY, 'b'), { kind: 'failed', code: 'internal' });
        store.fail(JOBS, { kind: 'failed', code: 'internal' });
        expect([jobs.state.list.status, jobs.state.detail?.job.status]).toEqual(['error', 'error']);
        jobs.intents.retry();

        expect([jobs.state.list.status, jobs.state.detail?.job.status]).toEqual(['ready', 'ready']);
        jobs.open([]);
        jobs.intents.retry();
        expect(jobs.state.detail).toBeNull();
    });

    it('happyPath_closingDetachesEveryListener', () => {
        const { services, store } = world();
        const jobs = JOBS_MODULE.create(services);
        jobs.open(['b']);
        // The list, the open job, its log lines and the budget guard (CR-M3-47).
        expect(store.listeners()).toBe(4);

        jobs.destroy();

        expect(store.listeners()).toBe(0);
        expect(jobs.state.detail).toBeNull();
    });

    it('happyPath_subscribersHearEveryChange', () => {
        const { services } = world();
        const jobs = JOBS_MODULE.create(services);
        const heard: JobsState[] = [];
        const stop = jobs.subscribe((state) => heard.push(state));

        jobs.open([]);
        stop();
        jobs.intents.setFilter('failed');

        expect(heard.length).toBeGreaterThan(0);
        expect(heard.at(-1)?.filter).toBe('all');
    });
});
