/**
 * What every imagery function reads and stamps (`docs/research/M3-interfaces.md` §2): the `system:imagery` stamp, the
 * city, the budget guard, the lenient `setup/status` records of USGS and Mapbox, the job and its version, and the
 * redacted job log (`jobs/{id}/logs`, at most 500 lines). Feature-local: other folders reach these documents through
 * their own code (CR-M2-3).
 */
import {
    FIRESTORE_PATHS,
    cityDocSchema,
    jobDocSchema,
    jobLogDocSchema,
    layerVersionDocSchema,
    opsGuardDocSchema,
    redactText,
    setupStatusDocSchema,
    systemWriter,
    timestampFromDate,
    validate,
    type CityDoc,
    type JobDoc,
    type JobStep,
    type LayerVersionDoc,
    type Schema,
    type SetupStatusDoc,
    type TimestampLike,
    type UsageCounters,
    type UsageDoc,
} from '@hcm/shared';

import { ApiError } from '../api/api-error.js';
import type { DocumentStore } from '../ports/documents.js';
import type { Ports } from '../ports/index.js';

/** Who a server-side imagery write is stamped with. */
export const IMAGERY_WRITER = systemWriter('imagery');

/** At most this many log lines per job (`jobLogDocSchema`); later lines are dropped. */
const MAX_LOG_LINES = 500;

export interface Stamp {
    readonly updatedBy: string;
    readonly updatedAt: TimestampLike;
}

export function stampOf(by: string, now: Date): Stamp {
    return { updatedBy: by, updatedAt: timestampFromDate(now) };
}

/** The `keys` of `value` that are set (Firestore refuses `undefined`; optional fields stay absent). */
export function pickDefined<T extends object, K extends keyof T>(value: T, keys: readonly K[]): { [P in K]?: Exclude<T[P], undefined> } {
    return Object.fromEntries(keys.filter((key) => value[key] !== undefined).map((key) => [key, value[key]])) as {
        [P in K]?: Exclude<T[P], undefined>;
    };
}

/** What the compute-unit guard reads of a month's counter. */
export function countersOf(usage: UsageDoc): UsageCounters {
    return {
        computeUnits: usage.computeUnits,
        computeUnitBudget: usage.computeUnitBudget,
        ...pickDefined(usage, ['overageComputeUnits', 'reservations']),
    };
}

/** The city, or `apiError.notFound`. */
export async function requireCity(documents: DocumentStore, cityId: string): Promise<CityDoc> {
    const city = await documents.get(FIRESTORE_PATHS.city(cityId), cityDocSchema);
    if (city === undefined) {
        throw new ApiError('apiError.notFound');
    }
    return city;
}

/** True while the budget guard pauses the raster work (`ops/guard` red; a missing guard is green). */
export async function guardIsRed(documents: DocumentStore): Promise<boolean> {
    return (await documents.get(FIRESTORE_PATHS.opsGuard, opsGuardDocSchema))?.state === 'red';
}

type UsgsRecord = NonNullable<SetupStatusDoc['usgs']>;

/** One area's record of `setup/status`, read leniently (`SetupRecords`): a malformed or missing record is undefined. */
async function areaRecord<T>(setup: Ports['setup'], area: 'usgs' | 'mapbox', schema: Schema<T>): Promise<T | undefined> {
    const parsed = validate(schema, (await setup.readStatus())?.[area]);
    return parsed.ok ? parsed.value : undefined;
}

/** The USGS record of `setup/status` (its state and M2M role). */
export function usgsRecord(setup: Ports['setup']): Promise<UsgsRecord | undefined> {
    return areaRecord(setup, 'usgs', setupStatusDocSchema.shape.usgs);
}

/** The Mapbox account `setup.saveMapbox` recorded (`setup/status.mapbox.user`), or `apiError.mapbox.notConfigured`. */
export async function requireMapboxUser(setup: Ports['setup']): Promise<string> {
    const user = (await areaRecord(setup, 'mapbox', setupStatusDocSchema.shape.mapbox))?.user;
    if (user === undefined) {
        throw new ApiError('apiError.mapbox.notConfigured');
    }
    return user;
}

/** The tiles secret token (`mapbox-sk-tiles`), or `apiError.mapbox.notConfigured`. Never logged. */
export async function requireTilesToken(secrets: Ports['secrets']): Promise<string> {
    const token = await secrets.read('mapbox-sk-tiles');
    if (token === undefined) {
        throw new ApiError('apiError.mapbox.notConfigured');
    }
    return token;
}

/** The job, or `apiError.notFound`. */
export async function requireJob(documents: DocumentStore, cityId: string, jobId: string): Promise<JobDoc> {
    const job = await documents.get(FIRESTORE_PATHS.job(cityId, jobId), jobDocSchema);
    if (job === undefined) {
        throw new ApiError('apiError.notFound');
    }
    return job;
}

/**
 * The layer version, or `apiError.notFound`. An ending passes `layerVersionReadSchema`: a record its schema refuses is
 * still read, without the fields it refuses (`legacy-reads.ts` in `@hcm/shared`).
 */
export async function requireVersion(
    documents: DocumentStore,
    cityId: string,
    versionId: string,
    schema: Schema<LayerVersionDoc> = layerVersionDocSchema,
): Promise<LayerVersionDoc> {
    const version = await documents.get(FIRESTORE_PATHS.layerVersion(cityId, versionId), schema);
    if (version === undefined) {
        throw new ApiError('apiError.notFound');
    }
    return version;
}

/** The version a job works on: its `versionId`, or its own id (a version's id is its job's). */
export function versionIdOf(jobId: string, job: Pick<JobDoc, 'versionId'>): string {
    return job.versionId ?? jobId;
}

/** `steps.<step>` set to `status`, the other steps kept. */
export function withStep(
    job: JobDoc,
    step: JobStep,
    status: 'pending' | 'running' | 'done' | 'failed' | 'skipped',
    at: TimestampLike,
): JobDoc {
    const previous = job.steps?.[step];
    const times = status === 'running' ? { startedAt: at } : { finishedAt: at };
    return { ...job, steps: { ...job.steps, [step]: { ...previous, status, ...times } } };
}

export interface LogLine {
    readonly level: 'info' | 'warn' | 'error';
    readonly message: string;
    readonly step?: JobStep;
}

/** The id of log line `seq` (zero-padded, so the lines sort by id). */
function lineId(seq: number): string {
    return String(seq).padStart(6, '0');
}

/** Writes the line after the job's last one (nothing past `MAX_LOG_LINES`). */
async function writeLine(deps: Pick<Ports, 'documents' | 'clock'>, path: string, line: LogLine): Promise<void> {
    const last = await deps.documents.query(path, jobLogDocSchema, { orderBy: ['seq', 'desc'], limit: 1 });
    const seq = (last.documents[0]?.data.seq ?? -1) + 1;
    if (seq >= MAX_LOG_LINES) {
        return;
    }
    const entry = {
        seq,
        level: line.level,
        message: redactText(line.message).slice(0, 2000),
        ...stampOf(IMAGERY_WRITER, deps.clock.now()),
    };
    await deps.documents.create(`${path}/${lineId(seq)}`, jobLogDocSchema, line.step === undefined ? entry : { ...entry, step: line.step });
}

/**
 * Appends a redacted line to the job's log (`jobs/{id}/logs`), after the last one the pipeline or a function wrote.
 * Best effort: a log line never fails the work it describes.
 */
export async function appendJobLog(deps: Pick<Ports, 'documents' | 'clock' | 'log'>, cityId: string, jobId: string, line: LogLine) {
    try {
        await writeLine(deps, FIRESTORE_PATHS.jobLogs(cityId, jobId), line);
    } catch (error) {
        deps.log.warn('job log line not written', { cityId, jobId, error: String(error) });
    }
}
