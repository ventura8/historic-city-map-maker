/**
 * A city's USGS harvest attempts (`ops/harvest-{city}`, CR-M3-47; `docs/research/M3-interfaces.md` §3.5): every attempt,
 * the admin's search and the tick's monthly one, records when it ran, how it went and when the next one is due: a month
 * after a harvest that answered (scenes or none), `HARVEST_RETRY_HOURS` after a failure, doubled after each further one
 * (at most a month). The tick harvests a city only once that time has come, so a harvest that writes no scene (USGS not
 * answering, revoked credentials, an area without frames) never repeats every five minutes.
 *
 * Lesson 676: the attempt is written `running` at its start and again as each dataset is stored (`HarvestProgress`), so a run the
 * server stops past its timeout still leaves what it stored and where each dataset resumes, and is due again
 * `HARVEST_RESUME_MINUTES` later. Lesson 825: a run still `running` after `HARVEST_TIMEOUT_MS` (540 s) is marked `failed` with
 * `HARVEST_TIMEOUT_REASON` on the next search or tick (`failStaleHarvest`, `nextAt` due now), logged `harvest.killed`, and resumed;
 * `wasKilled` stays true for that reason. A `partial` run (a dataset searched only in part) resumes after `HARVEST_RESUME_MINUTES`,
 * doubled after each further one.
 */
import {
    FIRESTORE_PATHS,
    HARVEST_EVERY_DAYS,
    HARVEST_RESUME_MINUTES,
    HARVEST_RETRY_HOURS,
    HARVEST_TIMEOUT_REASON,
    harvestStateDocSchema,
    isStaleHarvest,
    timestampFromDate,
    timestampToDate,
    type ApiErrorCode,
    type HarvestDataset,
    type HarvestDatasets,
    type HarvestStateDoc,
    type UsgsDataset,
} from '@hcm/shared';

import type { Ports } from '../ports/index.js';
import { IMAGERY_WRITER, stampOf } from './records.js';

type HarvestStateDeps = Pick<Ports, 'documents' | 'clock'>;

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const MONTH_MS = HARVEST_EVERY_DAYS * 24 * HOUR_MS;

/** How long after the `failures`-th unfinished run in a row the harvest is tried again. */
function retryDelayMs(outcome: HarvestStateDoc['outcome'], failures: number): number {
    const doubled = 2 ** Math.max(0, failures - 1);
    if (outcome === 'failed') {
        return Math.min(MONTH_MS, HARVEST_RETRY_HOURS * HOUR_MS * doubled);
    }
    return outcome === 'partial' || outcome === 'running' ? Math.min(MONTH_MS, HARVEST_RESUME_MINUTES * MINUTE_MS * doubled) : MONTH_MS;
}

/** The city's last attempt, or undefined (never recorded: a harvest before CR-M3-47, or none). */
export function harvestStateOf(deps: Pick<Ports, 'documents'>, cityId: string): Promise<HarvestStateDoc | undefined> {
    return deps.documents.get(FIRESTORE_PATHS.harvestState(cityId), harvestStateDocSchema);
}

/** True for an attempt the server stopped: still `running` older than 540s, or marked failed due to timeout. */
export function wasKilled(state: HarvestStateDoc | undefined, now: Date): boolean {
    if (state === undefined) {
        return false;
    }
    if (state.outcome === 'failed' && state.reason === HARVEST_TIMEOUT_REASON) {
        return true;
    }
    return isStaleHarvest(state, now);
}

/** The `ops/harvest-{city}` write that marks a stale `running` attempt failed past the 540s limit. */
function staleFailureDoc(state: HarvestStateDoc, now: Date): HarvestStateDoc {
    return {
        ...state,
        outcome: 'failed',
        reason: HARVEST_TIMEOUT_REASON,
        failures: Math.min(1000, state.failures + 1),
        // Due now so the same search or tick can resume (failure backoff would hide it for an hour).
        nextAt: timestampFromDate(now),
        finishedAt: timestampFromDate(now),
        ...stampOf(IMAGERY_WRITER, now),
    };
}

/**
 * Transitions a stale `running` harvest older than 540s to `failed` with its reason, inside a transaction so concurrent
 * ticks or searches never produce duplicate status updates. Returns true if transitioned.
 */
export async function failStaleHarvest(
    deps: Pick<Ports, 'documents' | 'clock' | 'log'>,
    cityId: string,
    now: Date = deps.clock.now(),
): Promise<boolean> {
    const datasets = await deps.documents.transaction(async (transaction) => {
        const state = await transaction.get(FIRESTORE_PATHS.harvestState(cityId), harvestStateDocSchema);
        if (!state || !isStaleHarvest(state, now)) {
            return undefined;
        }
        await transaction.set(FIRESTORE_PATHS.harvestState(cityId), harvestStateDocSchema, staleFailureDoc(state, now));
        return { datasets: state.datasets };
    });
    if (datasets === undefined) {
        return false;
    }
    deps.log.error('usgs harvest timed out past 540s limit', { cityId, reasonCode: 'harvest.killed', datasets: datasets.datasets });
    return true;
}

/** Unfinished runs in a row after each outcome, from the count before it (a run still going keeps it). */
const FAILURES_AFTER: Readonly<Record<HarvestStateDoc['outcome'], (before: number) => number>> = {
    ok: () => 0,
    empty: () => 0,
    failed: (before) => before + 1,
    partial: (before) => before + 1,
    running: (before) => before,
};

/** Unfinished runs in a row once this attempt is counted (0 after one that answered in full). */
function failuresAfter(previous: HarvestStateDoc | undefined, outcome: HarvestStateDoc['outcome']): number {
    return FAILURES_AFTER[outcome](previous?.failures ?? 0);
}

interface HarvestRecord {
    readonly outcome: HarvestStateDoc['outcome'];
    readonly error?: ApiErrorCode;
    readonly datasets?: HarvestDatasets;
    /** The run's start (the `attemptedAt` of every write of one run). */
    readonly startedAt?: Date;
    /** The attempt before this run, read once at its start. */
    readonly previous: HarvestStateDoc | undefined;
}

/** Writes the attempt `record` (each write of a run carries every dataset's part so far). */
async function writeHarvest(deps: HarvestStateDeps, cityId: string, record: HarvestRecord): Promise<void> {
    const now = deps.clock.now();
    const failures = failuresAfter(record.previous, record.outcome);
    const finished = record.outcome === 'running' ? {} : { finishedAt: timestampFromDate(now) };
    await deps.documents.set(FIRESTORE_PATHS.harvestState(cityId), harvestStateDocSchema, {
        attemptedAt: timestampFromDate(record.startedAt ?? now),
        outcome: record.outcome,
        failures,
        nextAt: timestampFromDate(new Date(now.getTime() + retryDelayMs(record.outcome, failures))),
        ...(record.error === undefined ? {} : { error: record.error }),
        ...(record.datasets === undefined ? {} : { datasets: record.datasets }),
        ...finished,
        ...stampOf(IMAGERY_WRITER, now),
    });
}

/**
 * One run's record as its datasets finish: `running` with every dataset's part so far, written one write after another (the
 * datasets are searched at once), so the admin's Search shows each as it is stored and a stopped run leaves where each resumes.
 */
export class HarvestProgress {
    readonly #deps: HarvestStateDeps;
    readonly #cityId: string;
    readonly #startedAt: Date;
    readonly #previous: HarvestStateDoc | undefined;
    readonly #datasets: Partial<Record<UsgsDataset, HarvestDataset>> = {};
    #writes: Promise<void> = Promise.resolve();

    constructor(deps: HarvestStateDeps, cityId: string, start: { readonly at: Date; readonly previous: HarvestStateDoc | undefined }) {
        this.#deps = deps;
        this.#cityId = cityId;
        this.#startedAt = start.at;
        this.#previous = start.previous;
    }

    get datasets(): HarvestDatasets {
        return { ...this.#datasets };
    }

    /** Sets the parts of `datasets` and writes the record `running`, after the writes before it. */
    running(datasets: HarvestDatasets): Promise<void> {
        Object.assign(this.#datasets, datasets);
        const write = this.#writes.then(() => this.#write({ outcome: 'running' }));
        this.#writes = write.catch(() => undefined);
        return write;
    }

    /** The run's last write: its outcome, after every `running` one. */
    async finish(outcome: HarvestStateDoc['outcome'], error?: ApiErrorCode): Promise<void> {
        await this.#writes;
        await this.#write(error === undefined ? { outcome } : { outcome, error });
    }

    #write(record: Pick<HarvestRecord, 'outcome' | 'error'>): Promise<void> {
        return writeHarvest(this.#deps, this.#cityId, {
            ...record,
            datasets: this.datasets,
            startedAt: this.#startedAt,
            previous: this.#previous,
        });
    }
}

/** The recorded attempt says the next harvest is due (undefined: nothing recorded, the caller decides). */
export function dueByState(state: HarvestStateDoc | undefined, now: Date): boolean | undefined {
    return state === undefined ? undefined : timestampToDate(state.nextAt) <= now;
}
