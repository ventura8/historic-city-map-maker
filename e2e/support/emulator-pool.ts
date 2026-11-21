/**
 * A cap on the Functions emulator's workers (DECISIONS-for-review.md §180i, and the entry that follows it). The emulator
 * starts one Node worker per function trigger the first time it is called and keeps it for the whole run, never stopping an
 * idle one: 61 to 65 workers at about 165 MB each by the end of the e2e stage (10.6 GB), past a 12 GB container with the
 * browsers beside them. `capWorkerPool` makes the pool (firebase-tools' `RuntimeWorkerPool`) stop its least recently used
 * IDLE worker whenever it holds more than `max` live workers, exactly the way the emulator's own `refresh()` stops one after
 * a code change (state FINISHING, then the process killed; its exit handler marks it FINISHED and the pool forgets it). A
 * trigger whose worker was stopped gets a new one on its next call, as after a reload: a cold start of the bundle, not a
 * failure. A BUSY worker is never stopped, so the pool may stay above `max` while every worker is serving a call.
 *
 * Only `firebase emulators:start` / `exec` in the e2e and dev-stack worlds load this (`e2e/stack/firebase.ts`); the
 * deployed functions never see it.
 */

/** The worker states of firebase-tools' `RuntimeWorkerState` that this file reads or writes. */
export const IDLE = 'IDLE';
export const FINISHING = 'FINISHING';
export const FINISHED = 'FINISHED';

/** One emulator worker, as much of firebase-tools' `RuntimeWorker` as the cap touches. */
export interface PoolWorker {
    state: string;
    readonly runtime: { readonly process: { kill(signal?: string): boolean } };
    /** When the cap saw this worker last chosen for a call (a sequence number, never the wall clock). */
    hcmLastUsed?: number;
}

/** An instance's own fields the cap reads: every trigger's workers. */
export interface PoolFields {
    readonly workers: Map<string, PoolWorker[]>;
}

/** As much of `RuntimeWorkerPool.prototype` as the cap wraps. */
export interface PoolPrototype {
    addWorker: (this: PoolFields, ...args: unknown[]) => PoolWorker;
    getIdleWorker: (this: PoolFields, triggerId: unknown, runtime: unknown) => PoolWorker | undefined;
}

/** The default cap: about 3 GB of workers at 165 MB each, which keeps the e2e stage within 8 GB with the browsers and JVMs. */
export const DEFAULT_MAX_WORKERS = 18;

/** The cap from `HCM_EMULATOR_MAX_WORKERS` (a whole number of at least 1), else the default. */
export function maxWorkersOf(env: Readonly<Record<string, string | undefined>>): number {
    const text = env['HCM_EMULATOR_MAX_WORKERS'] ?? '';
    const value = Number(text);
    return /^\d+$/.test(text) && value >= 1 ? value : DEFAULT_MAX_WORKERS;
}

function live(pool: PoolFields): PoolWorker[] {
    return [...pool.workers.values()].flat().filter((worker) => worker.state !== FINISHING && worker.state !== FINISHED);
}

/** The idle worker chosen longest ago (one never chosen counts as oldest), or undefined when none is idle. */
export function leastRecentlyUsedIdle(workers: readonly PoolWorker[]): PoolWorker | undefined {
    const idle = workers.filter((worker) => worker.state === IDLE);
    return idle.reduce<PoolWorker | undefined>(
        (oldest, worker) => (oldest === undefined || (worker.hcmLastUsed ?? 0) < (oldest.hcmLastUsed ?? 0) ? worker : oldest),
        undefined,
    );
}

/** Stops least recently used idle workers until at most `max` are live (or none is idle); how many it stopped. */
export function trim(pool: PoolFields, max: number): number {
    let stopped = 0;
    let workers = live(pool);
    while (workers.length > max) {
        const oldest = leastRecentlyUsedIdle(workers);
        if (oldest === undefined) {
            break;
        }
        oldest.state = FINISHING;
        oldest.runtime.process.kill();
        stopped += 1;
        workers = live(pool);
    }
    return stopped;
}

/** Wraps the pool's prototype once: each worker chosen for a call is stamped, and each new worker trims the pool to `max`. */
export function capWorkerPool(prototype: PoolPrototype, max: number): void {
    const marked = prototype as PoolPrototype & { hcmCapped?: { max: number } };
    if (marked.hcmCapped !== undefined) {
        marked.hcmCapped.max = max;
        return;
    }
    const cap = { max };
    marked.hcmCapped = cap;
    let sequence = 0;
    const { addWorker, getIdleWorker } = prototype;
    prototype.getIdleWorker = function (this: PoolFields, triggerId: unknown, runtime: unknown): PoolWorker | undefined {
        const worker = getIdleWorker.call(this, triggerId, runtime);
        if (worker !== undefined) {
            sequence += 1;
            worker.hcmLastUsed = sequence;
        }
        return worker;
    };
    prototype.addWorker = function (this: PoolFields, ...args: unknown[]): PoolWorker {
        const worker = addWorker.apply(this, args);
        sequence += 1;
        worker.hcmLastUsed = sequence;
        trim(this, cap.max);
        return worker;
    };
}
