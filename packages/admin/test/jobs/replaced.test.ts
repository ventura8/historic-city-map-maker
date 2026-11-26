import { FIRESTORE_PATHS } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { HOME_MODULE } from '../../src/home/home.js';
import { JOBS_MODULE } from '../../src/jobs/jobs.js';
import { jobTargetsOf, readReplacedJobIds, replacedJobIds, type JobRun } from '../../src/jobs/replaced.js';
import type { ContentStore } from '../../src/content/services.js';
import { at, CITY, contentWorld } from '../content/world.js';

function run(id: string, status: string, createdAt: string, targets: readonly string[], type = 'layer-join'): JobRun {
    return { id, type, status, createdAt, targets };
}

function stored(type: string, status: string, iso: string, params: Record<string, unknown>): Record<string, unknown> {
    return { type, status, params, createdBy: 'admin-uid', createdAt: at(iso), updatedBy: 'system:pipeline', updatedAt: at(iso) };
}

/** Bucharest, 2026-11-15: two joins failed for want of frames, later joins of the same layers worked; a third layer did not. */
function seededWorld() {
    const world = contentWorld();
    const job = (id: string, data: Record<string, unknown>): void => {
        world.store.docs.set(FIRESTORE_PATHS.job(CITY, id), data);
    };
    job('jn-old-n', stored('layer-join', 'failed', '2026-11-14T10:00:00Z', { parts: [{ layerId: 'aerial-1974-n' }] }));
    job('jn-old-02', stored('layer-join', 'failed', '2026-11-15T10:00:00Z', { parts: [{ layerId: 'aerial-1974-02' }] }));
    job('jn-old-01', stored('layer-join', 'failed', '2026-11-15T11:00:00Z', { parts: [{ layerId: 'aerial-1974-01' }] }));
    job('jn-new-n', stored('layer-join', 'succeeded', '2026-11-16T10:00:00Z', { parts: [{ layerId: 'aerial-1974-n' }] }));
    job('jn-new-02', stored('layer-join', 'succeeded', '2026-11-16T11:00:00Z', { layerId: 'aerial-1974-02' }));
    return world;
}

async function settled(): Promise<void> {
    for (let round = 0; round < 20; round += 1) {
        await Promise.resolve();
    }
}

describe("a job's targets", () => {
    it('happyPath_aLayerAJoinsPartsAndAnImportsScene', () => {
        expect(jobTargetsOf('layer-tiles', { layerId: 'a' })).toEqual(['a']);
        expect(jobTargetsOf('layer-join', { layerId: 'a', parts: [{ layerId: 'b' }, { layerId: 'c' }] })).toEqual(['a', 'b', 'c']);
        expect(jobTargetsOf('usgs-import', { entityId: 'DS1' })).toEqual(['DS1']);
    });

    it('badPath_noTargetForARegeorefOrMalformedParams', () => {
        expect(jobTargetsOf('regeoref', { basedOn: 'v1' })).toEqual([]);
        expect(jobTargetsOf('layer-join', { parts: 'x' })).toEqual([]);
        expect(jobTargetsOf('layer-join', { parts: [null, 3, { other: 1 }, { layerId: '' }, { layerId: 7 }] })).toEqual([]);
        expect(jobTargetsOf('usgs-import', { entityId: 5 })).toEqual([]);
    });
});

describe('the replaced rule', () => {
    it('happyPath_aLaterSuccessOfTheSameTypeAndTargetReplacesAFailure @S-A195-HAPPY-REPLACED-JOB', () => {
        const ids = replacedJobIds([
            run('old', 'failed', '2026-11-14T10:00:00.000Z', ['l1']),
            run('new', 'succeeded', '2026-11-15T10:00:00.000Z', ['l0', 'l1']),
        ]);

        expect([...ids]).toEqual([['old', 'new']]);
    });

    it('badPath_anEarlierSuccessAnotherTypeAnotherTargetOrAnUnfinishedRunReplacesNothing @S-A195-BAD-NOT-REPLACED', () => {
        const ids = replacedJobIds([
            run('failed', 'failed', '2026-11-14T10:00:00.000Z', ['l1']),
            run('earlier', 'succeeded', '2026-11-13T10:00:00.000Z', ['l1']),
            run('type', 'succeeded', '2026-11-15T10:00:00.000Z', ['l1'], 'layer-tiles'),
            run('target', 'succeeded', '2026-11-15T10:00:00.000Z', ['l2']),
            run('running', 'running', '2026-11-15T10:00:00.000Z', ['l1']),
            run('no-target', 'failed', '2026-11-14T10:00:00.000Z', []),
        ]);

        expect(ids.size).toBe(0);
    });

    it('happyPath_readsTheCitysFailedAndSucceededJobsOnce', async () => {
        const world = seededWorld();

        const ids = await readReplacedJobIds(world.services);

        expect([...ids].toSorted(([a], [b]) => a.localeCompare(b))).toEqual([
            ['jn-old-02', 'jn-new-02'],
            ['jn-old-n', 'jn-new-n'],
        ]);
    });

    it('badPath_aReadThatFailsCallsNothingReplaced', async () => {
        const world = seededWorld();
        const refusing: ContentStore = Object.assign(Object.create(world.store) as ContentStore, {
            watchQuery: (...args: Parameters<ContentStore['watchQuery']>) => {
                args[4]({ kind: 'denied', code: 'permission-denied' });
                return (): void => undefined;
            },
        });

        const ids = await readReplacedJobIds({ ...world.services, store: refusing });

        expect(ids.size).toBe(0);
    });
});

describe('the replaced jobs on screen', () => {
    it('happyPath_homeLeavesThemOutOfTheFailedCount @S-A195-HAPPY-REPLACED-JOB', async () => {
        const home = HOME_MODULE.create(seededWorld().services);

        home.open([]);
        await settled();

        expect(home.state.counts?.failedJobs).toBe(1);
        home.destroy();
    });

    it('happyPath_theJobsListMarksThemWithNoRetry @S-A195-HAPPY-REPLACED-JOB', async () => {
        const jobs = JOBS_MODULE.create(seededWorld().services);

        jobs.open(['jn-old-n']);
        await settled();

        const marked = jobs.state.list.items.filter((item) => item.replacedBy !== null).map((item) => item.id);
        expect(marked.toSorted((a, b) => a.localeCompare(b))).toEqual(['jn-old-02', 'jn-old-n']);
        expect(jobs.state.detail?.job.doc?.data).toMatchObject({ replacedBy: 'jn-new-n', retryable: false, rerunScene: null });
        jobs.intents.retry();
        await settled();
        expect(jobs.state.list.items.find((item) => item.id === 'jn-old-01')?.replacedBy).toBeNull();
        jobs.close();
    });
});
