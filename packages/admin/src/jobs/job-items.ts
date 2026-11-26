/**
 * A job as the Jobs area shows it (`./jobs.ts`): its row's fields in the order its type runs its steps, its log lines,
 * and whether a later run that worked replaced it (`./replaced.ts`).
 */
import { JOB_STEPS, type JobDoc, type JobLogDoc, type JobStatus, type TimestampLike } from '@hcm/shared';

import { isoOf } from '../content/list.js';
import type { Stored } from '../content/services.js';
import { rasterFieldsOf, type RasterJobFields } from './raster.js';

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

export interface JobItem extends RasterJobFields {
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
    /** The later run that worked and replaced this failed job (`./replaced.ts`), or null: said so, with no Retry. */
    readonly replacedBy: string | null;
}

export interface JobLogLine {
    readonly seq: number;
    readonly level: JobLogDoc['level'];
    readonly step: string | null;
    readonly message: string;
    readonly at: string;
}

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

export function jobItemOf(doc: Stored<JobDoc>): JobItem {
    const job = doc.data;
    return {
        ...{ id: doc.id, type: job.type, status: job.status, finished: !ACTIVE_JOB_STATUSES.includes(job.status) },
        ...{ progress: job.progress ?? null, step: job.step ?? null, steps: stepsOf(job) },
        ...{ createdBy: job.createdBy, createdAt: isoOf(job.createdAt), dispatchAt: optionalIso(job.dispatchAt) },
        ...{ cancelRequested: job.cancelRequested === true, paused: job.paused !== undefined, error: job.error ?? null },
        ...rasterFieldsOf(job),
        replacedBy: null,
    };
}

/** The item marked replaced when a later run that worked replaced it (no Retry nor Run again then). */
export function markReplaced(item: JobItem, replaced: ReadonlyMap<string, string>): JobItem {
    const replacedBy = replaced.get(item.id);
    return replacedBy === undefined ? item : { ...item, replacedBy, retryable: false, rerunScene: null };
}

export function jobLogLineOf(doc: Stored<JobLogDoc>): JobLogLine {
    const line = doc.data;
    return { seq: line.seq, level: line.level, step: line.step ?? null, message: line.message, at: isoOf(line.updatedAt) };
}
