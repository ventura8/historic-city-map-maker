/**
 * A cap on the Functions emulator's workers (DECISIONS-for-review.md §180i, and the entry that follows it). The emulator
 * starts one Node worker per function trigger the first time it is called and keeps it for the whole run, never stopping an
 * idle one: 61 to 65 workers at about 165 MB each by the end of the e2e stage (10.6 GB), past a 12 GB container with the
 * browsers beside them. `capWorkerPool` makes the pool (firebase-tools' `RuntimeWorkerPool`) stop its least recently used
 * IDLE worker whenever it holds more than `max` live workers, exactly the way the emulator's own `refresh()` stops one after
 * a code change (state FINISHING, then the process killed; its exit handler marks it FINISHED and the pool forgets it). A
 * trigger whose worker was stopped gets a new one on its next call, as after a reload: a cold start of the bundle, not a
 * failure. A BUSY worker is never stopped, nor a fresh one the emulator added for a call it has not handed it yet (lesson 813),
 * so the pool may stay above `max` while they serve or wait for their calls. An event trigger's worker (a Firestore, Storage or
 * Pub/Sub trigger: `eventTrigger` in its definition) is never stopped and not counted: the Firestore emulator delivers its
 * events one at a time, each after the last one's answer, so one cold start (about 2 s on a loaded machine) held up every
 * test's triggers; thrashing past the cap, 73 cold starts in under three minutes put a place's history entries two minutes
 * behind its write (lesson 822). The cap is on the callable and HTTPS workers, which hold up only their own call.
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
    /** It serves an event trigger (`eventTrigger` in its definition): never stopped, never counted. */
    hcmEvent?: boolean;
    /** When the cap saw this worker last chosen for a call (a sequence number, never the wall clock). */
    hcmLastUsed?: number;
    /**
     * Added for a call it has not been handed yet: the emulator waits for its socket, then picks it (`sendRequest`). Stopped
     * in that gap, the call found no worker and its event was lost (lesson 813), so a fresh worker is never trimmed.
     */
    hcmFresh?: boolean;
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

/**
 * The default cap on callable and HTTPS workers: 12, beside the event triggers' (about 20 deployed, fewer called in one stage):
 * about 5 GB of workers at 165 MB each at most, 2 GB more than the 18 counted together before, which thrashed (lesson 822).
 */
export const DEFAULT_MAX_WORKERS = 12;

/** The cap from `HCM_EMULATOR_MAX_WORKERS` (a whole number of at least 1), else the default. */
export function maxWorkersOf(env: Readonly<Record<string, string | undefined>>): number {
    const text = env['HCM_EMULATOR_MAX_WORKERS'] ?? '';
    const value = Number(text);
    return /^\d+$/.test(text) && value >= 1 ? value : DEFAULT_MAX_WORKERS;
}

/** The live workers the cap counts: an event trigger's are left out. */
function live(pool: PoolFields): PoolWorker[] {
    return [...pool.workers.values()]
        .flat()
        .filter((worker) => worker.state !== FINISHING && worker.state !== FINISHED && worker.hcmEvent !== true);
}

/** The idle worker chosen longest ago, or undefined when none is idle; a fresh one, not handed its call yet, never counts. */
export function leastRecentlyUsedIdle(workers: readonly PoolWorker[]): PoolWorker | undefined {
    const idle = workers.filter((worker) => worker.state === IDLE && worker.hcmFresh !== true && worker.hcmEvent !== true);
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

/** An event trigger's definition (the emulator's `addWorker` gets the trigger first): one with `eventTrigger`. */
export function isEventTrigger(trigger: unknown): boolean {
    return typeof trigger === 'object' && trigger !== null && 'eventTrigger' in trigger;
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
            worker.hcmFresh = false;
        }
        return worker;
    };
    prototype.addWorker = function (this: PoolFields, ...args: unknown[]): PoolWorker {
        const worker = addWorker.apply(this, args);
        sequence += 1;
        worker.hcmLastUsed = sequence;
        worker.hcmFresh = true;
        worker.hcmEvent = isEventTrigger(args[0]);
        trim(this, cap.max);
        return worker;
    };
}
