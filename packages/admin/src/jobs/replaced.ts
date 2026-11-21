/**
 * A failed job a later run already replaced (the owner, 2026-11-21; `docs/LESSONS.md`): a failed job is *replaced* when a
 * later job (its `createdAt` after the failed one's) of the same type for the same target ended `succeeded`. The target is
 * `params.layerId`; a `layer-join` also counts each of `params.parts[].layerId`; a `usgs-import` its `params.entityId`.
 * A job with no target (a `regeoref` names only its `basedOn` version, not the layer) is never replaced. Home leaves a
 * replaced job out of its failed count; the Jobs list says "Replaced by a later run that worked" and offers no Retry.
 */
import { FIRESTORE_PATHS, jobDocSchema, type JobDoc } from '@hcm/shared';

import { isoOf } from '../content/list.js';
import { readOnce } from '../content/read-once.js';
import type { ContentQuery, ContentServices, Stored } from '../content/services.js';

/** At most this many failed and this many succeeded jobs are compared (newest first); older ones stay as they are. */
const REPLACED_WINDOW = 500;

/** What the rule reads of a job. */
export interface JobRun {
    readonly id: string;
    readonly type: string;
    readonly status: string;
    /** ISO time, comparable as text. */
    readonly createdAt: string;
    readonly targets: readonly string[];
}

function textOf(value: unknown): string | null {
    return typeof value === 'string' && value !== '' ? value : null;
}

function layerOfPart(part: unknown): string | null {
    return typeof part === 'object' && part !== null && 'layerId' in part ? textOf(part.layerId) : null;
}

/** Each `parts[].layerId` of a join's params. */
function partLayers(parts: unknown): readonly (string | null)[] {
    return Array.isArray(parts) ? parts.map(layerOfPart) : [];
}

/** The targets a job works on (an empty list: none known, never replaced). */
export function jobTargetsOf(type: string, params: Readonly<Record<string, unknown>>): readonly string[] {
    const found = [textOf(params['layerId'])];
    if (type === 'layer-join') {
        found.push(...partLayers(params['parts']));
    }
    if (type === 'usgs-import') {
        found.push(textOf(params['entityId']));
    }
    return found.filter((target): target is string => target !== null);
}

/** Whether `later` replaces the failed `job`: same type, created after it, a target in common. */
function replaces(later: JobRun, job: JobRun): boolean {
    return later.type === job.type && later.createdAt > job.createdAt && later.targets.some((target) => job.targets.includes(target));
}

/** Each failed job a later succeeded job of the same type and target replaced, with the id of the earliest such job. */
export function replacedJobIds(jobs: readonly JobRun[]): ReadonlyMap<string, string> {
    const succeeded = jobs.filter((job) => job.status === 'succeeded').toSorted((a, b) => a.createdAt.localeCompare(b.createdAt));
    const pairs = jobs
        .filter((job) => job.status === 'failed')
        .map((job) => [job.id, succeeded.find((later) => replaces(later, job))?.id] as const)
        .filter((pair): pair is readonly [string, string] => pair[1] !== undefined);
    return new Map(pairs);
}

/** A stored job as the rule reads it. */
function jobRunOf(doc: Stored<JobDoc>): JobRun {
    const job = doc.data;
    return { id: doc.id, type: job.type, status: job.status, createdAt: isoOf(job.createdAt), targets: jobTargetsOf(job.type, job.params) };
}

function queryOf(status: 'failed' | 'succeeded'): ContentQuery {
    return { where: [['status', 'in', [status]]], orderBy: [['createdAt', 'desc']], limit: REPLACED_WINDOW };
}

/** One read of the city's newest failed or succeeded jobs (empty when the read failed: nothing is called replaced). */
async function runsOf(services: ContentServices, status: 'failed' | 'succeeded'): Promise<readonly JobRun[]> {
    const answer = await readOnce(services, FIRESTORE_PATHS.jobs(services.cityId), jobDocSchema, queryOf(status));
    return answer.page === null ? [] : answer.page.docs.map(jobRunOf);
}

/** The ids of the city's replaced failed jobs, read once. */
export async function readReplacedJobIds(services: ContentServices): Promise<ReadonlyMap<string, string>> {
    const [failed, succeeded] = await Promise.all([runsOf(services, 'failed'), runsOf(services, 'succeeded')]);
    return replacedJobIds([...failed, ...succeeded]);
}
