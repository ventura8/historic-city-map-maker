// Pause (the owner's request of 2026-11-13; docs/research/M7-local-worker.md → Pause): the worker feed's job and computer pause
// (`imagery.pause`), how long a computer's pause lasts, and the Jobs store's Pause all and Resume all with their notices.
import { FIRESTORE_PATHS } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { JOBS_MODULE } from '../../src/jobs/jobs.js';
import { createWorkerFeed } from '../../src/worker/feed.js';
import { pausedOf, pauseUntil } from '../../src/worker/pause.js';
import { failure } from '../app/fakes.js';
import { at, CITY, contentWorld, type ContentWorld } from '../content/world.js';

const WORKER = 'w-0123456789abcdef';

function seenNow(world: ContentWorld, more: Record<string, unknown> = {}): Record<string, unknown> {
    const now = new Date(world.clock.now()).toISOString();
    return {
        ...{ uid: 'admin-uid', version: '1.0.0', startedAt: at(now), lastSeenAt: at(now), state: 'idle' },
        ...{ updatedBy: 'system:worker', updatedAt: at(now) },
        ...more,
    };
}

function jobDoc(more: Record<string, unknown> = {}): Record<string, unknown> {
    const created = at('2025-10-09T08:00:00Z');
    return {
        ...{ type: 'usgs-import', status: 'queued', params: { sensor: 'KH-4A' }, createdBy: 'admin-uid', createdAt: created },
        ...{ updatedBy: 'system:imagery', updatedAt: created },
        ...more,
    };
}

function requests(world: ContentWorld): unknown[] {
    return world.callables.calls.filter((call) => call.name === 'imagery.pause').map((call) => call.request);
}

describe('how long a computer is paused', () => {
    it('happyPath_anHourFromNowTomorrowAtEightAndUntilIResumeHasNoEnd', () => {
        const now = new Date(2026, 10, 13, 22, 30);

        expect(pauseUntil('hour', now)).toBe(new Date(2026, 10, 13, 23, 30).toISOString());
        expect(pauseUntil('tomorrow', now)).toBe(new Date(2026, 10, 14, 8, 0).toISOString());
        expect(pauseUntil('forever', now)).toBeUndefined();
    });

    it('badPath_noPauseReadsAsNullAndOneWithoutAnEndHasANullUntil', () => {
        expect(pausedOf(undefined)).toBeNull();
        expect(pausedOf({ by: 'computer', at: at('2026-11-13T09:00:00Z') })).toEqual({
            by: 'computer',
            at: '2026-11-13T09:00:00.000Z',
            until: null,
        });
    });
});

describe('the worker feed: Pause', () => {
    it('happyPath_aVersionsJobIsPausedAndResumedAndShowsWhoPausedIt @S-A170-HAPPY', async () => {
        const world = contentWorld();
        world.callables.answer('imagery.pause', () => ({ changed: 1 }));
        world.store.docs.set(FIRESTORE_PATHS.job(CITY, 'j1'), jobDoc({ paused: { by: 'admin-uid', at: at('2025-10-09T08:05:00Z') } }));
        const feed = createWorkerFeed(world.services);
        feed.start('j1');

        expect(feed.state.job?.paused).toEqual({ by: 'admin-uid', at: '2025-10-09T08:05:00.000Z', until: null });
        await expect(feed.intents.pauseJob('resume')).resolves.toBe(true);
        await feed.intents.pauseJob('pause');
        expect(requests(world)).toEqual([
            { cityId: CITY, action: 'resume', jobId: 'j1' },
            { cityId: CITY, action: 'pause', jobId: 'j1' },
        ]);
    });

    it('happyPath_theSeenComputerIsPausedForAnHourAndResumed @S-A171-HAPPY', async () => {
        const world = contentWorld();
        world.callables.answer('imagery.pause', () => ({ changed: 1 }));
        world.store.docs.set(FIRESTORE_PATHS.worker(CITY, WORKER), seenNow(world));
        const feed = createWorkerFeed(world.services);
        feed.start(null);

        await feed.intents.pauseComputer('hour');
        await feed.intents.pauseComputer('forever');
        await feed.intents.pauseComputer(null);
        const until = new Date(world.clock.now() + 3_600_000).toISOString();
        expect(requests(world)).toEqual([
            { cityId: CITY, action: 'pause', workerId: WORKER, until },
            { cityId: CITY, action: 'pause', workerId: WORKER },
            { cityId: CITY, action: 'resume', workerId: WORKER },
        ]);
    });

    it('badPath_aPauseWhoseEndPassedReadsAsOverAndNoComputerOrJobAsksNothing', async () => {
        const world = contentWorld();
        const ended = new Date(world.clock.now() - 1000).toISOString();
        const paused = { by: 'computer', at: at(ended), until: at(ended) };
        world.store.docs.set(FIRESTORE_PATHS.worker(CITY, WORKER), seenNow(world, { paused }));
        const feed = createWorkerFeed(world.services);
        feed.start(null);
        expect(feed.state.worker?.paused).toBeNull();

        const empty = createWorkerFeed(contentWorld().services);
        empty.start('none');
        await expect(empty.intents.pauseJob('pause')).resolves.toBe(false);
        await expect(empty.intents.pauseComputer('hour')).resolves.toBe(false);
    });

    it('badPath_aRefusedPauseIsSaidWhereItWasAsked @S-A170-BAD-FINISHED', async () => {
        const world = contentWorld();
        world.callables.fail('imagery.pause', failure('failed-precondition', 'apiError.imagery.notPausable'));
        world.store.docs.set(FIRESTORE_PATHS.job(CITY, 'j1'), jobDoc({ status: 'awaiting_approval' }));
        const feed = createWorkerFeed(world.services);
        feed.start('j1');

        await expect(feed.intents.pauseJob('pause')).resolves.toBe(false);
        expect(feed.state).toMatchObject({ acting: false, refusal: { key: 'apiError.imagery.notPausable' } });
    });
});

describe('the Jobs store: Pause all and Resume all', () => {
    it('happyPath_pauseAllSaysHowManyAndAPausedJobsRowSaysPaused @S-A170-HAPPY-ALL', async () => {
        const world = contentWorld();
        world.callables.answer('imagery.pause', () => ({ changed: 3 }));
        world.store.docs.set(FIRESTORE_PATHS.job(CITY, 'j1'), jobDoc({ paused: { by: 'admin-uid', at: at('2025-10-09T08:05:00Z') } }));
        const store = JOBS_MODULE.create(world.services);
        store.open([]);
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(store.state.list.items[0]?.paused).toBe(true);
        const [first, second] = await Promise.all([store.intents.pauseAll('pause'), store.intents.pauseAll('pause')]);
        expect([first, second]).toEqual([true, false]);
        await store.intents.pauseAll('resume');
        expect(world.notices.map((notice) => notice.key)).toEqual(['adminContent.jobs.pausedAll', 'adminContent.jobs.resumedAll']);
        expect(world.notices[0]?.params).toEqual({ count: '3' });
        expect(requests(world)).toEqual([
            { cityId: CITY, action: 'pause' },
            { cityId: CITY, action: 'resume' },
        ]);
    });

    it('badPath_nothingToPauseOrResumeIsSaidAndARefusalToo @S-A170-BAD-NOTHING', async () => {
        const world = contentWorld();
        world.callables.answer('imagery.pause', () => ({ changed: 0 }));
        const store = JOBS_MODULE.create(world.services);

        await store.intents.pauseAll('pause');
        await store.intents.pauseAll('resume');
        world.callables.fail('imagery.pause', failure('permission-denied', 'apiError.notAdmin'));
        await expect(store.intents.pauseAll('pause')).resolves.toBe(false);
        expect(world.notices.map((notice) => notice.key)).toEqual([
            'adminContent.jobs.nothingToPause',
            'adminContent.jobs.nothingToResume',
            'apiError.notAdmin',
        ]);
    });
});
