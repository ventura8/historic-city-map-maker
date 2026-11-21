/**
 * What every creator of a raster job checks first (`docs/research/M3-interfaces.md` §4.1, security review §3.4): the
 * budget guard is green (`apiError.guardPaused`), fewer than `JOBS_PER_DAY` raster jobs started today in the whole
 * project and (M5) fewer than the city's own share (`apiError.imagery.dailyLimit {limit}`), and the layer has no
 * unfinished job (`apiError.layers.busy`). The daily
 * count and the busy check are queries, which a Firestore transaction cannot hold, so two creators racing in the same
 * second may both pass: the cap is a spend guard, not an exact quota. M20's counting transactions (an archive's import, the
 * daily release) are exact: each passes the turnstile `ops/daily` and counts inside its transaction (`dailyRoomIn`).
 *
 * The cap bounds the paid CLOUD work (`docs/research/M7-local-worker.md` §4.5, the owner 2026-11-12): a job that runs on the
 * owner's computer (`runOn: 'local'`, `localOnly`) never counts, and a city whose choice is `local` starts new imports and
 * joins past the cap, each recorded `runOn: 'local'` at its creation (`Placement`). Moving such a job to the cloud later
 * (`imagery.runOn`) checks the cap then and counts it on the day of the move (`refuseCloudMove`).
 */
import {
    FINISHED_JOB_STATUSES,
    FIRESTORE_PATHS,
    JOBS_PER_DAY,
    cityDocSchema,
    jobDocSchema,
    opsDailyDocSchema,
    timestampFromDate,
    timestampToDate,
    type JobDoc,
    type JobStatus,
    type JobType,
} from '@hcm/shared';

import { ApiError } from '../api/api-error.js';
import type { DocumentStore, DocumentTransaction } from '../ports/documents.js';
import { runChoiceOf } from './place.js';
import { guardIsRed, IMAGERY_WRITER, stampOf } from './records.js';

const FINISHED: ReadonlySet<JobStatus> = new Set(FINISHED_JOB_STATUSES);
/** The turnstile's schema (`ops/daily`), built once. */
const TURNSTILE = opsDailyDocSchema();
/**
 * M18 item 3 (`docs/research/M18-improvements.md`): the jobs that count against the day's limit are the ones that bring
 * new imagery in (a scene, an upload, a join). A re-run of what is already here (new points, a crop, Locate again) never
 * counts, whatever it costs: the cap guards the downloads and the new layers, and the budget guard still stops any start.
 */
const COUNTED: ReadonlySet<JobType> = new Set<JobType>(['usgs-import', 'geotiff-import', 'layer-join', 'archive-series']);

/**
 * M20 (`docs/research/M20-import-local.md` §1.3): when a job counted. An archive series counts once, on the day it was let
 * start (`countedAt`: at its creation when today's share had room, else when `imagery.tick` released it from `daily`); one still
 * waiting counts nothing. Every other counted type counts on the day it was created.
 */
function countedAtOf(job: JobDoc): Date | undefined {
    if (job.countedAt !== undefined) {
        return timestampToDate(job.countedAt);
    }
    return job.type === 'archive-series' ? undefined : timestampToDate(job.createdAt);
}

/**
 * True when the job counts against the day that began at `since`. A job on the owner's computer (`runOn: 'local'`, or
 * `localOnly`: an archive series) never counts: it runs free there, so the cap, which guards the Cloud Run spend, neither
 * counts nor holds it (the owner, 2026-11-09 and 2026-11-12).
 */
function countsSince(job: JobDoc, since: Date): boolean {
    const at = countedAtOf(job);
    return COUNTED.has(job.type) && !onComputer(job) && at !== undefined && at >= since;
}

/** The job runs on the owner's computer: placed there, or its files exist only there. */
function onComputer(job: Pick<JobDoc, 'runOn' | 'localOnly'>): boolean {
    return job.runOn === 'local' || job.localOnly === true;
}

/** Where new jobs run, recorded on them at their creation: `{ runOn: 'local' }` when the city's choice is `local`, else nothing. */
export interface Placement {
    readonly runOn?: 'local';
}

/** The first instant of `now`'s day, UTC. */
function dayStart(now: Date): Date {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Every city of the project (a project holds one or a few: the daily cap and the running cap are per project). */
export async function cityIds(documents: DocumentStore): Promise<string[]> {
    const cities = await documents.query(FIRESTORE_PATHS.cities, cityDocSchema);
    return [...cities.documents, ...cities.invalid].map((city) => city.id);
}

/** The city's jobs created or (M20) counted since `since`, each once. */
async function jobsSince(documents: DocumentStore, cityId: string, since: Date): Promise<readonly JobDoc[]> {
    const at = timestampFromDate(since);
    const queryFrom = (field: 'createdAt' | 'countedAt') =>
        documents.query(FIRESTORE_PATHS.jobs(cityId), jobDocSchema, { where: [[field, '>=', at]] });
    const [created, counted] = await Promise.all([queryFrom('createdAt'), queryFrom('countedAt')]);
    const byId = new Map([...created.documents, ...counted.documents].map((job) => [job.id, job.data]));
    return [...byId.values()];
}

/** The imports that counted since the start of today (UTC), per city. */
async function rasterJobsToday(documents: DocumentStore, now: Date): Promise<ReadonlyMap<string, number>> {
    const since = dayStart(now);
    const counts = await Promise.all(
        (await cityIds(documents)).map(async (cityId) => {
            const jobs = await jobsSince(documents, cityId, since);
            return [cityId, jobs.filter((job) => countsSince(job, since)).length] as const;
        }),
    );
    return new Map(counts);
}

/** M5: the city's own daily share (`cities/{city}.limits.rasterJobsPerDay`), or none for a city without limits. */
async function cityDailyJobs(documents: DocumentStore, cityId: string): Promise<number | undefined> {
    return (await documents.get(FIRESTORE_PATHS.city(cityId), cityDocSchema))?.limits?.rasterJobsPerDay;
}

/** `apiError.guardPaused` while the budget guard is red: a re-run asks only this (M18 item 3). */
export async function refuseWhileGuardRed(documents: DocumentStore): Promise<void> {
    if (await guardIsRed(documents)) {
        throw new ApiError('apiError.guardPaused');
    }
}

/**
 * `apiError.guardPaused` while the budget guard is red, `apiError.imagery.dailyLimit` once today's jobs reached the
 * project's cap or (M5, `docs/research/M5-interfaces.md` §1.8; S-A52-BAD-DAILY-JOBS) the share of `cityId`. A city whose
 * choice is `local` passes the cap (S-A12-HAPPY-LOCAL-PAST-DAILY-CAP): the new job is placed on the computer (`Placement`).
 */
export function refuseNewRasterJob(documents: DocumentStore, now: Date, cityId: string): Promise<Placement> {
    return refuseRasterJobs(documents, now, cityId, 1);
}

/**
 * The same refusals for `count` new jobs at once (M8, `docs/research/M8-join-interfaces.md` §5: a join's missing frames and
 * the join itself): all of them must fit today, so a set is never half created. Returns where they run (`Placement`).
 */
export async function refuseRasterJobs(documents: DocumentStore, now: Date, cityId: string, count: number): Promise<Placement> {
    await refuseWhileGuardRed(documents);
    if ((await runChoiceOf(documents, cityId)) === 'local') {
        return { runOn: 'local' };
    }
    await refuseOverCap(documents, now, cityId, count);
    return {};
}

/**
 * `imagery.runOn` moving `job` to the cloud (S-A12-BAD-RUNON-CLOUD-PAST-CAP): a counted job that ran on the computer starts
 * to count, so the guard and today's caps are checked now; the move then stamps `countedAt` (`countsOnMove`).
 */
export async function refuseCloudMove(documents: DocumentStore, now: Date, cityId: string, job: JobDoc): Promise<void> {
    if (countsOnMove(job)) {
        await refuseWhileGuardRed(documents);
        await refuseOverCap(documents, now, cityId, 1);
    }
}

/** True when moving `job` to the cloud makes it count: a counted type that ran on the computer by choice (it counts on the day of the move). */
export function countsOnMove(job: Pick<JobDoc, 'type' | 'runOn' | 'localOnly'>): boolean {
    return COUNTED.has(job.type) && job.runOn === 'local' && job.localOnly !== true;
}

/** `apiError.imagery.dailyLimit` when `count` more counted jobs do not fit today's project cap or the city's share. */
async function refuseOverCap(documents: DocumentStore, now: Date, cityId: string, count: number): Promise<void> {
    const today = await rasterJobsToday(documents, now);
    refuseAtLimit(
        [...today.values()].reduce((sum, jobs) => sum + jobs, count - 1),
        JOBS_PER_DAY,
    );
    refuseAtLimit((today.get(cityId) ?? 0) + count - 1, await cityDailyJobs(documents, cityId));
}

/**
 * M20 (§1.3): how many more counted jobs today's shares leave for `cityId`: the project's `JOBS_PER_DAY` and the city's own
 * share, whichever is smaller (never below zero). An archive's series beyond it wait (`daily`), never refused.
 */
async function dailyRoom(documents: DocumentStore, now: Date, cityId: string): Promise<number> {
    const today = await rasterJobsToday(documents, now);
    const project = JOBS_PER_DAY - [...today.values()].reduce((sum, jobs) => sum + jobs, 0);
    const share = await cityDailyJobs(documents, cityId);
    const city = share === undefined ? project : share - (today.get(cityId) ?? 0);
    return Math.max(0, Math.min(project, city));
}

/**
 * M20 (§1.3): today's room for `cityId`, counted inside `transaction` once it read the turnstile `ops/daily`. A counting
 * transaction that commits meanwhile writes the turnstile, so this one retries and counts again: two never spend the same room.
 * The caller passes the turnstile (`passTurnstile`) with its writes.
 */
export async function dailyRoomIn(transaction: DocumentTransaction, documents: DocumentStore, now: Date, cityId: string): Promise<number> {
    await transaction.get(FIRESTORE_PATHS.opsDaily, TURNSTILE);
    return dailyRoom(documents, now, cityId);
}

/** Writes the turnstile `ops/daily`, so a counting transaction that read it before this one commits counts again. */
export async function passTurnstile(transaction: DocumentTransaction, now: Date): Promise<void> {
    await transaction.set(FIRESTORE_PATHS.opsDaily, TURNSTILE, stampOf(IMAGERY_WRITER, now));
}

/** `apiError.imagery.dailyLimit` once `count` reached `limit` (none: no limit of its own, as a city created before M5). */
function refuseAtLimit(count: number, limit: number | undefined): void {
    if (limit !== undefined && count >= limit) {
        throw new ApiError('apiError.imagery.dailyLimit', { limit: String(limit) });
    }
}

/** The statuses of a job that waits for a person, not for a machine: a refine of another waiting frame does not race it. */
const WAITING_FOR_A_PERSON: ReadonlySet<JobStatus> = new Set<JobStatus>(['awaiting_approval', 'awaiting_gcps']);

/** The jobs of the layer that are not finished (`except`: a job the caller replaces itself). */
async function unfinishedJobs(documents: DocumentStore, cityId: string, layerId: string, except?: string): Promise<JobStatus[]> {
    const jobs = await documents.query(FIRESTORE_PATHS.jobs(cityId), jobDocSchema, { where: [['layerId', '==', layerId]] });
    return jobs.documents.filter((job) => job.id !== except && !FINISHED.has(job.data.status)).map((job) => job.data.status);
}

/** `apiError.layers.busy` when a job of the layer is not finished (`except`: a job the caller replaces itself). */
export async function refuseBusyLayer(documents: DocumentStore, cityId: string, layerId: string, except?: string): Promise<void> {
    if ((await unfinishedJobs(documents, cityId, layerId, except)).length > 0) {
        throw new ApiError('apiError.layers.busy');
    }
}

/**
 * `apiError.layers.busy` when a job of the layer is running, not when it only waits for a person: a refine of a frame waiting for approval
 * beside another frame of the same date that waits too (they share the date's layer; admin sweep 2026-11-14, bug 1).
 */
export async function refuseRunningLayer(documents: DocumentStore, cityId: string, layerId: string, except?: string): Promise<void> {
    if ((await unfinishedJobs(documents, cityId, layerId, except)).some((status) => !WAITING_FOR_A_PERSON.has(status))) {
        throw new ApiError('apiError.layers.busy');
    }
}
