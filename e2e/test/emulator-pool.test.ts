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

        addWorker(...args: unknown[]): PoolWorker {
            const trigger = String(args[0]);
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
        const first = pool.addWorker('admin-session') as StandInWorker;
        pool.addWorker('worker-claim');
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
        pool.addWorker('worker-hello');

        // The new worker was idle and the oldest idle one: it is the one stopped; the busy ones keep serving.
        expect(liveTriggers(pool)).toEqual(['export-build', 'imagery-tick']);
        expect(trim(pool, 1)).toBe(0);
        expect(leastRecentlyUsedIdle([busy, second])).toBeUndefined();
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
});
