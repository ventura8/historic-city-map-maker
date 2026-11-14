/**
 * The jobs area (`docs/research/M2c-interfaces.md` §9.3; behaviour A18): `#/jobs` is a live query of the city's jobs,
 * newest first, filtered by status; `#/jobs/<jobId>` adds the job itself and its log lines (`jobs/{id}/logs` by `seq`,
 * live). A listener that drops attaches again by itself and the page says "Reconnecting…"; log lines are keyed by
 * `seq`, so a re-read never shows one twice. **Cancel** sets `cancelRequested` (stamped) on an unfinished job; the rules
 * refuse it on a finished one. From M3 (CR-M3-5, `raster.ts`): a job says why it waits, an `awaiting_gcps` one names its
 * version for the georeferencer, and **Retry** runs a failed raster job again (`imagery.retry`); while the budget guard
 * pauses the raster work the page says so, with the spend, and offers **Resume processing** (CR-M3-47).
 */
import {
    FIRESTORE_PATHS,
    isId,
    JOB_STEPS,
    jobDocSchema,
    jobLogDocSchema,
    type JobDoc,
    type JobLogDoc,
    type JobStatus,
    type TimestampLike,
} from '@hcm/shared';

import type { AreaModule, AreaStore } from '../content/areas.js';
import { LiveDoc, LOADING_DOC, type DocState } from '../content/doc.js';
import { isoOf, LiveList, LOADING_LIST, type ListState } from '../content/list.js';
import type { ContentQuery, ContentServices, Stored, WriteOutcome } from '../content/services.js';
import { GuardFeed, resumeGuard, type GuardView } from '../imagery/guard.js';
import { Store } from '../state/store.js';
import { pauseAllJobs, rasterFieldsOf, retryRasterJob, runSceneAgain, type RasterJobFields } from './raster.js';
import type { WorkerFeed } from '../worker/feed.js';

/** The list's status chips: every job, the unfinished ones, the failed ones, the others that ended. */
export type JobFilter = 'all' | 'active' | 'failed' | 'done';

/** Statuses of a job that has not finished (Cancel is offered, the progress moves). */
export const ACTIVE_JOB_STATUSES: readonly JobStatus[] = [
    'queued',
    'starting',
    'running',
    'waiting_usgs',
    'mts_processing',
    'awaiting_approval',
    'awaiting_gcps',
];

const FILTER_STATUSES: Readonly<Record<Exclude<JobFilter, 'all'>, readonly JobStatus[]>> = {
    active: ACTIVE_JOB_STATUSES,
    failed: ['failed'],
    done: ['succeeded', 'cancelled'],
};

/** A job's log keeps at most this many lines (`jobLogDocSchema`: 500 per job). */
const MAX_JOB_LOG_LINES = 500;

interface JobItem extends RasterJobFields {
    readonly id: string;
    readonly type: string;
    readonly status: JobStatus;
    readonly finished: boolean;
    /** 0 to 1, or null when the job reports none. */
    readonly progress: number | null;
    readonly step: string | null;
    readonly steps: readonly { readonly name: string; readonly status: string }[];
    readonly createdBy: string;
    readonly createdAt: string;
    /** A job that waits for its date (a deleted layer's tileset, CR-M2c-3): when it may run. */
    readonly dispatchAt: string | null;
    readonly cancelRequested: boolean;
    /** Pause (2026-11-13): the owner paused it (`imagery.pause`); its row reads Paused. */
    readonly paused: boolean;
    /** The job's own error: a code and a redacted message, shown as text. */
    readonly error: { readonly code: string; readonly message: string } | null;
}

interface JobLogLine {
    readonly seq: number;
    readonly level: JobLogDoc['level'];
    readonly step: string | null;
    readonly message: string;
    readonly at: string;
}

interface JobDetail {
    readonly id: string;
    /** The job (`job.doc` null: not found). */
    readonly job: DocState<JobItem>;
    readonly logs: ListState<JobLogLine>;
}

export interface JobsState {
    readonly filter: JobFilter;
    readonly list: ListState<JobItem>;
    /** `#/jobs/<jobId>`, or null on the list alone. */
    readonly detail: JobDetail | null;
    readonly cancelling: boolean;
    /** Retry is on its way (`imagery.retry`). */
    readonly retrying: boolean;
    /** Lesson 728: Run again with the latest pipeline is on its way (`imagery.import` with `again`). */
    readonly rerunning: boolean;
    /** The budget guard (null while reading). */
    readonly guard: GuardView | null;
    /** Resume processing is on its way (`imagery.resumeGuard`). */
    readonly resuming: boolean;
    /** Pause all or Resume all is on its way (`imagery.pause` without a job). */
    readonly pausingAll: boolean;
}

export interface JobsIntents {
    setFilter(filter: JobFilter): void;
    /** The next page of the list. */
    more(): void;
    /** Try again after a listener's failure (the list and the open job). */
    retry(): void;
    /** Asks the open job to stop (`cancelRequested: true`). */
    cancel(): Promise<WriteOutcome | null>;
    /** Runs the open failed raster job again; true once it is queued again. */
    retryJob(): Promise<boolean>;
    /** Lesson 728: the open job's scene imported again on the latest pipeline; true once the new job exists. */
    runAgain(): Promise<boolean>;
    /** Turns the budget guard green again; true once it is. */
    resumeGuard(): Promise<boolean>;
    /** Pause all or Resume all (2026-11-13): every queued or running job of the city; true once the server answered. */
    pauseAll(action: 'pause' | 'resume'): Promise<boolean>;
    /**
     * M7 (`docs/research/M7-local-worker.md` §7): a new feed of the city's local worker, its choice and the free-tier meter,
     * from the lazy `worker` chunk; the Jobs page, the pipeline card and a version's page each start and stop their own.
     */
    worker(): Promise<WorkerFeed>;
    /** M7: registers the `worker` chunk's elements, which then ask `worker` for their feeds. */
    workerElements(): Promise<void>;
}

const INITIAL: JobsState = {
    ...{ filter: 'all', list: LOADING_LIST, detail: null, cancelling: false, retrying: false, rerunning: false },
    ...{ guard: null, resuming: false, pausingAll: false },
};

function optionalIso(timestamp: TimestampLike | undefined): string | null {
    return timestamp === undefined ? null : isoOf(timestamp);
}

/** A step's place in the order its job's type runs them; one the type does not list goes last. */
function stepRank(order: readonly string[], name: string): number {
    const rank = order.indexOf(name);
    return rank === -1 ? order.length : rank;
}

/** The steps of a job in the order its type runs them (finding 80 of 2026-11-03: a retry's write reordered the stored map). */
function stepsOf(job: JobDoc): JobItem['steps'] {
    const order: readonly string[] = JOB_STEPS[job.type];
    return Object.entries(job.steps ?? {})
        .toSorted(([left], [right]) => stepRank(order, left) - stepRank(order, right))
        .map(([name, step]) => ({ name, status: step.status }));
}

function jobItemOf(doc: Stored<JobDoc>): JobItem {
    const job = doc.data;
    return {
        ...{ id: doc.id, type: job.type, status: job.status, finished: !ACTIVE_JOB_STATUSES.includes(job.status) },
        ...{ progress: job.progress ?? null, step: job.step ?? null, steps: stepsOf(job) },
        ...{ createdBy: job.createdBy, createdAt: isoOf(job.createdAt), dispatchAt: optionalIso(job.dispatchAt) },
        ...{ cancelRequested: job.cancelRequested === true, paused: job.paused !== undefined, error: job.error ?? null },
        ...rasterFieldsOf(job),
    };
}

function jobLogLineOf(doc: Stored<JobLogDoc>): JobLogLine {
    const line = doc.data;
    return { seq: line.seq, level: line.level, step: line.step ?? null, message: line.message, at: isoOf(line.updatedAt) };
}

/** The list's query for a filter: newest first, one `in` filter on the status (indexed: status, createdAt). */
export function jobsQuery(filter: JobFilter): ContentQuery {
    return { where: filter === 'all' ? [] : [['status', 'in', FILTER_STATUSES[filter]]], orderBy: [['createdAt', 'desc']] };
}

const NOT_FOUND: DocState<never> = { ...LOADING_DOC, status: 'ready' };
const NO_LINES: ListState<never> = { ...LOADING_LIST, status: 'ready' };

/** The open job's detail before its listeners answer; an id that is no document id is not found at once. */
function detailFor(id: string | null): JobDetail | null {
    if (id === null) {
        return null;
    }
    return isId(id) ? { id, job: LOADING_DOC, logs: LOADING_LIST } : { id, job: NOT_FOUND, logs: NO_LINES };
}

/** The open job's id, or null on the list alone. */
function openId(detail: JobDetail | null): string | null {
    return detail === null ? null : detail.id;
}

/** The open job as read, or null. */
function openJob(detail: JobDetail | null): JobItem | null {
    return detail?.job.doc?.data ?? null;
}

/** A job Cancel may ask to stop: unfinished, and not asked yet. */
function stoppable(job: JobItem | null): job is JobItem {
    return job !== null && !job.finished && !job.cancelRequested;
}

class JobsStore implements AreaStore<JobsState, JobsIntents> {
    readonly #services: ContentServices;
    readonly #cell: Store<JobsState>;
    readonly #list: LiveList<JobDoc, JobItem>;
    readonly #job: LiveDoc<JobDoc>;
    readonly #logs: LiveList<JobLogDoc, JobLogLine>;
    readonly #guard: GuardFeed;
    readonly intents: JobsIntents;

    constructor(services: ContentServices) {
        this.#services = services;
        this.#cell = new Store<JobsState>(INITIAL, services.log);
        const { store, clock, cityId } = services;
        const denied = (): void => {
            services.denied();
        };
        this.#list = new LiveList({
            ...{ store, clock, denied, collection: FIRESTORE_PATHS.jobs(cityId), schema: jobDocSchema, map: jobItemOf },
            changed: (list) => {
                this.#cell.update({ list });
            },
        });
        const changed = (): void => {
            this.#detailChanged();
        };
        this.#job = new LiveDoc({ store, clock, denied, schema: jobDocSchema, changed });
        this.#logs = new LiveList({
            ...{ store, clock, denied, collection: '', schema: jobLogDocSchema, map: jobLogLineOf, pageSize: MAX_JOB_LOG_LINES },
            changed,
        });
        this.#guard = new GuardFeed(services, (guard) => {
            this.#cell.update({ guard });
        });
        this.intents = {
            setFilter: (filter) => {
                this.#setFilter(filter);
            },
            more: () => {
                this.#list.more();
            },
            retry: () => {
                this.#retry();
            },
            cancel: () => this.#cancel(),
            retryJob: () => this.#retryJob(),
            runAgain: () => this.#runAgain(),
            resumeGuard: () => this.#resumeGuard(),
            pauseAll: (action) => this.#pauseAll(action),
            worker: async () => (await import('../worker/worker.js')).createWorkerFeed(services),
            workerElements: async () => {
                (await import('../worker/worker.js')).defineWorkerElements();
            },
        };
    }

    get state(): JobsState {
        return this.#cell.state;
    }

    subscribe(listener: (state: JobsState) => void): () => void {
        return this.#cell.subscribe(listener);
    }

    open(params: readonly string[]): void {
        if (!this.#list.active) {
            this.#list.show(jobsQuery(this.#cell.state.filter));
            this.#guard.start();
        }
        this.#select(params[0] ?? null);
    }

    close(): void {
        this.#list.stop();
        this.#guard.stop();
        this.#select(null);
    }

    hasUnsavedChanges(): boolean {
        return false;
    }

    destroy(): void {
        this.close();
    }

    #setFilter(filter: JobFilter): void {
        this.#cell.update({ filter });
        this.#list.show(jobsQuery(filter));
    }

    #select(id: string | null): void {
        if (id === openId(this.#cell.state.detail)) {
            return;
        }
        this.#job.stop();
        this.#logs.stop();
        const detail = detailFor(id);
        this.#cell.update({ detail });
        if (detail?.job.status === 'loading') {
            this.#watch(detail.id);
        }
    }

    /** The open job and its log lines, live. */
    #watch(id: string): void {
        const { cityId } = this.#services;
        this.#job.show(FIRESTORE_PATHS.job(cityId, id));
        this.#logs.showIn(FIRESTORE_PATHS.jobLogs(cityId, id), { orderBy: [['seq', 'asc']] });
    }

    #detailChanged(): void {
        const detail = this.#cell.state.detail;
        if (detail === null) {
            return;
        }
        const state = this.#job.state;
        const job: DocState<JobItem> = { ...state, doc: state.doc === null ? null : { ...state.doc, data: jobItemOf(state.doc) } };
        this.#cell.update({ detail: { id: detail.id, job, logs: this.#logs.list } });
    }

    async #resumeGuard(): Promise<boolean> {
        if (this.#cell.state.resuming) {
            return false;
        }
        this.#cell.update({ resuming: true });
        const resumed = await resumeGuard(this.#services);
        this.#cell.update({ resuming: false });
        return resumed;
    }

    async #pauseAll(action: 'pause' | 'resume'): Promise<boolean> {
        if (this.#cell.state.pausingAll) {
            return false;
        }
        this.#cell.update({ pausingAll: true });
        const done = await pauseAllJobs(this.#services, action);
        this.#cell.update({ pausingAll: false });
        return done;
    }

    #retry(): void {
        this.#list.retry();
        this.#guard.retry();
        if (this.#cell.state.detail !== null && this.#job.path !== '') {
            this.#job.retry();
            this.#logs.retry();
        }
    }

    async #cancel(): Promise<WriteOutcome | null> {
        const job = openJob(this.#cell.state.detail);
        if (!stoppable(job) || this.#cell.state.cancelling) {
            return null;
        }
        this.#cell.update({ cancelling: true });
        const outcome = await this.#services.store.update(
            FIRESTORE_PATHS.job(this.#services.cityId, job.id),
            { cancelRequested: true },
            null,
        );
        this.#cell.update({ cancelling: false });
        this.#report(outcome);
        return outcome;
    }

    async #retryJob(): Promise<boolean> {
        const job = openJob(this.#cell.state.detail);
        if (job?.retryable !== true || this.#cell.state.retrying) {
            return false;
        }
        this.#cell.update({ retrying: true });
        const queued = await retryRasterJob(this.#services, job.id);
        this.#cell.update({ retrying: false });
        return queued;
    }

    async #runAgain(): Promise<boolean> {
        const entityId = openJob(this.#cell.state.detail)?.rerunScene ?? null;
        if (entityId === null || this.#cell.state.rerunning) {
            return false;
        }
        this.#cell.update({ rerunning: true });
        const started = await runSceneAgain(this.#services, entityId);
        this.#cell.update({ rerunning: false });
        return started;
    }

    #report(outcome: WriteOutcome): void {
        if (outcome.ok) {
            this.#services.notify({ key: 'adminContent.jobs.cancelRequested' });
            return;
        }
        if (outcome.reason === 'denied') {
            this.#services.denied();
        }
        this.#services.notify({ key: outcome.reason === 'offline' ? 'adminContent.common.offline' : 'adminContent.jobs.cancelRefused' });
    }
}

export const JOBS_MODULE: AreaModule<JobsState, JobsIntents> = {
    area: 'jobs',
    create: (services) => new JobsStore(services),
};
