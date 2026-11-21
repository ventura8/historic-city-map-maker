/**
 * The budget guard as the Imagery and Jobs areas read it (`packages/admin/src/imagery/guard.ts`, CR-M3-47): `ops/guard`
 * live with the spend the alert reported, and Resume processing through `imagery.resumeGuard`, once at a time.
 */
import { FIRESTORE_PATHS } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { GuardFeed, guardViewOf, resumeGuard } from '../../src/imagery/guard.js';
import { IMAGERY_MODULE } from '../../src/imagery/imagery.js';
import { JOBS_MODULE } from '../../src/jobs/jobs.js';
import { failure, settle } from '../app/fakes.js';
import { answer, at, callsOf, imageryWorld } from './world.js';

const RED = {
    state: 'red',
    reason: 'budget',
    since: at('2026-10-20T10:00:00Z'),
    spend: { costAmount: 5.37, budgetAmount: 5, currency: 'USD', interval: '2026-10-01T07:00:00Z' },
    updatedBy: 'system:ops',
    updatedAt: at('2026-10-20T10:00:00Z'),
};

describe('the budget guard as the areas read it', () => {
    it('happyPath_aRedGuardIsAPauseWithItsSpendAndAMissingOneIsGreen', () => {
        const world = imageryWorld();
        const seen: unknown[] = [];
        const feed = new GuardFeed(world.services, (guard) => seen.push(guard));

        feed.start();
        world.store.docs.set(FIRESTORE_PATHS.opsGuard, RED);
        feed.retry();
        feed.stop();

        expect(seen.at(0)).toBeNull();
        expect(seen).toContainEqual({ paused: false, costAmount: null, budgetAmount: null, currency: null });
        expect(seen.at(-1)).toEqual({ paused: true, costAmount: 5.37, budgetAmount: 5, currency: 'USD' });
        expect(world.store.listeners()).toBe(0);
        expect(guardViewOf({ status: 'loading', doc: null, reconnecting: false, failure: null })).toBeNull();
    });

    it('happyPath_resumeCallsTheServerAndSaysProcessingStartsAgain', async () => {
        const world = imageryWorld();
        answer(world.callables, 'imagery.resumeGuard', () => ({ state: 'green' }));

        await expect(resumeGuard(world.services)).resolves.toBe(true);

        expect(callsOf(world.callables, 'imagery.resumeGuard')).toEqual([{}]);
        expect(world.notices.map((notice) => notice.key)).toEqual(['adminContent.imagery.notice.resumed']);
    });

    it('badPath_aRefusedResumeSaysWhy', async () => {
        const world = imageryWorld();
        world.callables.fail('imagery.resumeGuard', failure('permission-denied', 'apiError.notAdmin'));

        await expect(resumeGuard(world.services)).resolves.toBe(false);

        expect(world.notices.map((notice) => notice.key)).toEqual(['apiError.notAdmin']);
    });
});

describe('Resume processing in the areas', () => {
    it('happyPath_theImageryAreaShowsThePauseAndResumesOnceAtATime', async () => {
        const world = imageryWorld();
        world.store.docs.set(FIRESTORE_PATHS.opsGuard, RED);
        answer(world.callables, 'imagery.resumeGuard', () => ({ state: 'green' }));
        const imagery = IMAGERY_MODULE.create(world.services);
        imagery.open([]);
        await settle();

        const paused = imagery.state.guard;
        const first = imagery.intents.resumeGuard();
        const second = imagery.intents.resumeGuard();
        const resuming = imagery.state.resuming;

        await expect(Promise.all([first, second])).resolves.toEqual([true, false]);
        expect(paused).toMatchObject({ paused: true, costAmount: 5.37 });
        expect([resuming, imagery.state.resuming]).toEqual([true, false]);
        expect(callsOf(world.callables, 'imagery.resumeGuard')).toHaveLength(1);
        imagery.destroy();
    });

    it('happyPath_theJobsAreaShowsThePauseAndResumesOnceAtATime', async () => {
        const world = imageryWorld();
        world.store.docs.set(FIRESTORE_PATHS.opsGuard, RED);
        answer(world.callables, 'imagery.resumeGuard', () => ({ state: 'green' }));
        const jobs = JOBS_MODULE.create(world.services);
        jobs.open([]);

        const first = jobs.intents.resumeGuard();
        const second = jobs.intents.resumeGuard();

        await expect(Promise.all([first, second])).resolves.toEqual([true, false]);
        expect(jobs.state.guard).toMatchObject({ paused: true, currency: 'USD' });
        expect(callsOf(world.callables, 'imagery.resumeGuard')).toHaveLength(1);
        jobs.destroy();
        expect(world.store.listeners()).toBe(0);
    });
});

describe('the budget guard: what an alert may leave out', () => {
    it('happyPath_aPauseWithoutSpendOrCurrencyStillPauses', () => {
        const world = imageryWorld();
        const seen: unknown[] = [];
        const feed = new GuardFeed(world.services, (guard) => seen.push(guard));
        world.store.docs.set(FIRESTORE_PATHS.opsGuard, { ...RED, spend: undefined });

        feed.start();
        const plain = seen.at(-1);
        world.store.docs.set(FIRESTORE_PATHS.opsGuard, { ...RED, spend: { costAmount: 6, budgetAmount: 5 } });
        feed.retry();

        expect(plain).toEqual({ paused: true, costAmount: null, budgetAmount: null, currency: null });
        expect(seen.at(-1)).toEqual({ paused: true, costAmount: 6, budgetAmount: 5, currency: null });
        feed.stop();
    });

    it('badPath_aDeniedReadMakesTheShellAskWhoThisIs', () => {
        const world = imageryWorld();
        const feed = new GuardFeed(world.services, () => undefined);
        feed.start();

        world.store.fail(FIRESTORE_PATHS.opsGuard, { kind: 'denied', code: 'permission-denied' });

        expect(world.denials.count).toBeGreaterThan(0);
        feed.stop();
    });
});
