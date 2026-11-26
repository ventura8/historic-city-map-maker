/**
 * The Functions emulator's worker cap (`e2e/support/emulator-pool.ts`) over a stand-in of firebase-tools' `RuntimeWorkerPool`:
 * one worker per trigger, kept until something stops it, as the emulator's own pool does.
 */
import { describe, expect, it } from 'vitest';

import {
    capWorkerPool,
    DEFAULT_MAX_WORKERS,
    FINISHED,
    FINISHING,
    IDLE,
    isEventTrigger,
    leastRecentlyUsedIdle,
    maxWorkersOf,
    trim,
    type PoolPrototype,
    type PoolWorker,
} from '../support/emulator-pool.js';

interface StandInWorker extends PoolWorker {
    readonly trigger: string;
    killed: number;
}

function standInWorker(trigger: string, state = IDLE): StandInWorker {
    const worker: StandInWorker = {
        trigger,
        state,
        killed: 0,
        runtime: {
            process: {
                kill: () => {
                    worker.killed += 1;
                    return true;
                },
            },
        },
    };
    return worker;
}

/** A pool as firebase-tools keeps it: a worker list per trigger; a new class each time, so each test wraps its own prototype. */
function standInPool() {
    class Pool implements PoolPrototype {
        readonly workers = new Map<string, PoolWorker[]>();

        /** The emulator passes the trigger's definition; a name stands for a callable's here. */
        addWorker(...args: unknown[]): PoolWorker {
            const [definition] = args;
            const trigger = isEventTrigger(definition) ? (definition as { readonly id: string }).id : String(definition);
            const worker = standInWorker(trigger);
            this.workers.set(trigger, [...(this.workers.get(trigger) ?? []), worker]);
            return worker;
        }

        /** The emulator also passes the runtime (`nodejs24`); one runtime here. */
        getIdleWorker(...args: unknown[]): PoolWorker | undefined {
            return (this.workers.get(String(args[0])) ?? []).find((worker) => worker.state === IDLE);
        }
    }
    return { Pool };
}

function liveTriggers(pool: { readonly workers: Map<string, PoolWorker[]> }): string[] {
    return [...pool.workers.values()]
        .flat()
        .filter((worker) => worker.state !== FINISHING && worker.state !== FINISHED)
        .map((worker) => (worker as StandInWorker).trigger);
}

describe("the Functions emulator's worker cap", () => {
    it('happyPath_aNewWorkerPastTheCapStopsTheLeastRecentlyUsedIdleOne', () => {
        const { Pool } = standInPool();
        capWorkerPool(Pool.prototype, 2);
        const pool = new Pool();
        // As the emulator does, each new worker is handed the call it was added for.
        const first = pool.addWorker('admin-session') as StandInWorker;
        pool.getIdleWorker('admin-session', 'nodejs24');
        pool.addWorker('worker-claim');
        pool.getIdleWorker('worker-claim', 'nodejs24');
        // admin-session is called again: worker-claim is now the one used longest ago.
        expect(pool.getIdleWorker('admin-session', 'nodejs24')).toBe(first);
        pool.addWorker('photos-list');

        expect(liveTriggers(pool)).toEqual(['admin-session', 'photos-list']);
        const stopped = pool.workers.get('worker-claim')?.[0] as StandInWorker;
        expect(stopped.state).toBe(FINISHING);
        expect(stopped.killed).toBe(1);
        expect(first.killed).toBe(0);
    });

    it('badPath_aBusyWorkerIsNeverStoppedSoThePoolMayStayAboveTheCap', () => {
        const { Pool } = standInPool();
        capWorkerPool(Pool.prototype, 1);
        const pool = new Pool();
        const busy = pool.addWorker('export-build');
        busy.state = 'BUSY';
        const second = pool.addWorker('imagery-tick');
        second.state = 'BUSY';
        const fresh = pool.addWorker('worker-hello') as StandInWorker;

        // The new worker is idle but not handed its call yet: stopped there, the call would find no worker and its event
        // would be lost (lesson 813). It stays, with the busy ones; once it has served, it may go.
        expect(liveTriggers(pool)).toEqual(['export-build', 'imagery-tick', 'worker-hello']);
        expect(fresh.killed).toBe(0);
        expect(trim(pool, 1)).toBe(0);
        expect(leastRecentlyUsedIdle([busy, second])).toBeUndefined();
        expect(pool.getIdleWorker('worker-hello', 'nodejs24')).toBe(fresh);
        expect(trim(pool, 1)).toBe(1);
        expect(fresh.state).toBe(FINISHING);
    });

    it('happyPath_wrappingTwiceChangesOnlyTheCapAndAFinishedWorkerDoesNotCount', () => {
        const { Pool } = standInPool();
        capWorkerPool(Pool.prototype, 1);
        capWorkerPool(Pool.prototype, 3);
        // Wrapped once: the second call only moves the cap the wrapper reads.
        expect((Pool.prototype as { hcmCapped?: { max: number } }).hcmCapped).toEqual({ max: 3 });
        const pool = new Pool();
        pool.addWorker('a').state = FINISHED;
        pool.addWorker('b');
        pool.addWorker('c');
        pool.addWorker('d');

        expect(liveTriggers(pool)).toEqual(['b', 'c', 'd']);
        expect(pool.getIdleWorker('nobody', 'nodejs24')).toBeUndefined();
        const never = standInWorker('never-called');
        expect(leastRecentlyUsedIdle([never, standInWorker('also-never')])).toBe(never);
    });

    it('badPath_theCapFromTheEnvironmentIsAWholeNumberOfAtLeastOne', () => {
        expect(maxWorkersOf({ HCM_EMULATOR_MAX_WORKERS: '12' })).toBe(12);
        for (const text of [undefined, '', '0', '-3', '2.5', 'many']) {
            expect(maxWorkersOf({ HCM_EMULATOR_MAX_WORKERS: text })).toBe(DEFAULT_MAX_WORKERS);
        }
    });

    it('badPath_anEventTriggersWorkerIsNeverStoppedNorCountedSinceItsEventsWaitInOneLine', () => {
        const { Pool } = standInPool();
        capWorkerPool(Pool.prototype, 1);
        const pool = new Pool();
        // A Firestore trigger's worker, used long ago and idle: stopping it would cold-start the next event while the
        // emulator holds every other event behind it (lesson 822).
        const history = pool.addWorker({
            id: 'history-onPoiWrite',
            eventTrigger: { eventType: 'google.cloud.firestore.document.v1.written' },
        });
        pool.getIdleWorker('history-onPoiWrite', 'nodejs24');
        const session = pool.addWorker('admin-session') as StandInWorker;
        pool.getIdleWorker('admin-session', 'nodejs24');

        expect(history.hcmEvent).toBe(true);
        expect(session.hcmEvent).toBe(false);
        expect(liveTriggers(pool)).toEqual(['history-onPoiWrite', 'admin-session']);
        // A second callable past the cap of one stops the other callable, not the older event trigger's worker.
        pool.addWorker('setup-status');
        pool.getIdleWorker('setup-status', 'nodejs24');
        expect(session.state).toBe(FINISHING);
        expect(history.state).toBe(IDLE);
        expect(leastRecentlyUsedIdle([history])).toBeUndefined();
        expect(trim(pool, 0)).toBe(1);
        expect(history.state).toBe(IDLE);
        expect([isEventTrigger(null), isEventTrigger('history-onPoiWrite'), isEventTrigger({ httpsTrigger: {} })]).toEqual([
            false,
            false,
            false,
        ]);
    });
});
