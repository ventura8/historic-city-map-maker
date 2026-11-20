/**
 * How unfinished raster work ends (`docs/research/M3-interfaces.md` §4.2, §7.1): cancelled, rejected or failed, in one
 * transaction that also releases what the work held: its compute-unit reservation in `usage/mapbox-YYYY-MM`, the layer's
 * `pendingVersion`, and, for a first import cancelled or rejected before it became a layer, its scene (back to `candidate`,
 * so its layer id is free again; `freedScene`), unless another version holds the same layer id (a re-georeference that
 * replaced it: CR-M3-47; `holdsLayerId`). A failure keeps its scene: Retry may still make its layer, and only a dismissal
 * gives it up (`release-scene.ts`). An ending may name the job and version it accepts (`accept`), checked in the same
 * transaction, so a cancellation or a rejection that read a waiting job never ends one the guard has meanwhile sent to Mapbox.
 */
import {
    ENDED_VERSION_STATES,
    FINISHED_JOB_STATUSES,
    FIRESTORE_PATHS,
    isSideJob,
    jobDocSchema,
    layerDocSchema,
    layerVersionDocSchema,
    layerVersionReadSchema,
    timestampToDate,
    usageDocSchema,
    usageMonth,
    usgsSceneDocSchema,
    type ApiErrorCode,
    type JobDoc,
    type JobStatus,
    type LayerDoc,
    type LayerVersionDoc,
    type LayerVersionState,
    type Schema,
    type UsageDoc,
    type UsgsSceneDoc,
} from '@hcm/shared';

import { compact, omit } from '../api/objects.js';
import type { DocumentTransaction } from '../ports/documents.js';
import type { Ports } from '../ports/index.js';
import { IMAGERY_WRITER, stampOf, versionIdOf, type Stamp } from './records.js';
import { freedScene } from './release-scene.js';
import { holdsLayerId } from './versions.js';

const FINISHED: ReadonlySet<JobStatus> = new Set(FINISHED_JOB_STATUSES);
const ENDED: ReadonlySet<LayerVersionState> = new Set(ENDED_VERSION_STATES);

export interface Ending {
    readonly status: 'cancelled' | 'failed';
    readonly versionState: 'cancelled' | 'rejected' | 'failed';
    /** Who ends it: the admin, or `system:imagery`. */
    readonly by: string;
    /** For a failure: the code, its parameters and the redacted technical detail. */
    readonly error?: { readonly code: ApiErrorCode; readonly params?: Readonly<Record<string, string>>; readonly message?: string };
    /** The job and version this ending applies to, as read in its transaction (absent: any unfinished job). */
    readonly accept?: (job: JobDoc, version: LayerVersionDoc | undefined) => boolean;
}

type EndDeps = Pick<Ports, 'documents' | 'clock'>;

/** One write of the ending, applied after every read. */
type Apply = (transaction: DocumentTransaction) => Promise<void>;

function setting<T>(path: string, schema: Schema<T>, data: T): Apply {
    return (transaction) => transaction.set(path, schema, data);
}

interface Places {
    readonly job: string;
    readonly version: string;
    readonly versionId: string;
    readonly layer?: string;
    readonly scene?: string;
    readonly usage: string;
}

interface Held {
    readonly places: Places;
    readonly job: JobDoc;
    readonly version: LayerVersionDoc | undefined;
    readonly layer: LayerDoc | undefined;
    readonly scene: UsgsSceneDoc | undefined;
    readonly usage: UsageDoc | undefined;
    /** Another version holds the version's layer id (`holdsLayerId`). */
    readonly layerIdHeld: boolean;
}

/** The month whose counter holds the version's reservation: where its guard ran, else now. */
function reservationMonth(version: LayerVersionDoc | undefined, now: Date): string {
    const checkedAt = version?.guard?.checkedAt;
    return usageMonth(checkedAt === undefined ? now : timestampToDate(checkedAt));
}

/** The scene a `usgs-import` job imports. */
function sceneEntityOf(job: JobDoc): string | undefined {
    const entityId = job.params['entityId'];
    return job.type === 'usgs-import' && typeof entityId === 'string' ? entityId : undefined;
}

interface Subject {
    readonly cityId: string;
    readonly jobId: string;
    readonly now: Date;
    /** The other versions of the same layer, found before the transaction (re-read inside it). */
    readonly siblings: readonly string[];
}

function placesOf({ cityId, jobId, now }: Subject, job: JobDoc, version: LayerVersionDoc | undefined): Places {
    const versionId = versionIdOf(jobId, job);
    const entityId = sceneEntityOf(job);
    return compact<Places>({
        job: FIRESTORE_PATHS.job(cityId, jobId),
        version: FIRESTORE_PATHS.layerVersion(cityId, versionId),
        versionId,
        layer: version === undefined ? undefined : FIRESTORE_PATHS.layer(cityId, version.layerId),
        scene: entityId === undefined ? undefined : FIRESTORE_PATHS.usgsScene(cityId, entityId),
        usage: FIRESTORE_PATHS.usage(reservationMonth(version, now)),
    });
}

/** True when one of `siblings` (re-read in the transaction) is a version that holds the same layer id. */
async function siblingHolds(transaction: DocumentTransaction, subject: Subject, layerId: string | undefined): Promise<boolean> {
    for (const id of subject.siblings) {
        const sibling = await transaction.get(FIRESTORE_PATHS.layerVersion(subject.cityId, id), layerVersionReadSchema);
        if (sibling !== undefined && sibling.layerId === layerId && holdsLayerId(sibling.state)) {
            return true;
        }
    }
    return false;
}

/** Every other document `job` holds, read first (a Firestore transaction reads before it writes). */
async function readRest(transaction: DocumentTransaction, subject: Subject, job: JobDoc): Promise<Held> {
    const { cityId, jobId } = subject;
    // M12: a side job works beside its version: its ending holds nothing of the version's.
    const version = isSideJob(job.type)
        ? undefined
        : await transaction.get(FIRESTORE_PATHS.layerVersion(cityId, versionIdOf(jobId, job)), layerVersionReadSchema);
    const places = placesOf(subject, job, version);
    const read = <T>(path: string | undefined, schema: Schema<T>) => (path === undefined ? undefined : transaction.get(path, schema));
    const layer = await read(places.layer, layerDocSchema);
    const scene = await read(places.scene, usgsSceneDocSchema);
    const usage = await transaction.get(places.usage, usageDocSchema);
    const layerIdHeld = scene === undefined ? false : await siblingHolds(transaction, subject, version?.layerId);
    return { places, job, version, layer, scene, usage, layerIdHeld };
}

/** The other versions of the job's layer (a query, which a transaction cannot hold: their states are read in it). */
async function siblingsOf(deps: EndDeps, cityId: string, jobId: string): Promise<readonly string[]> {
    const job = await deps.documents.get(FIRESTORE_PATHS.job(cityId, jobId), jobDocSchema);
    const versionId = versionIdOf(jobId, job ?? {});
    const version = await deps.documents.get(FIRESTORE_PATHS.layerVersion(cityId, versionId), layerVersionReadSchema);
    if (job?.type !== 'usgs-import' || version === undefined) {
        return [];
    }
    const versions = await deps.documents.query(FIRESTORE_PATHS.layerVersions(cityId), layerVersionReadSchema, {
        where: [['layerId', '==', version.layerId]],
    });
    return versions.documents.map((sibling) => sibling.id).filter((id) => id !== versionId);
}

/** Every document the ending touches, or undefined when the job is gone or already finished. */
async function readHeld(transaction: DocumentTransaction, subject: Subject): Promise<Held | undefined> {
    const job = await transaction.get(FIRESTORE_PATHS.job(subject.cityId, subject.jobId), jobDocSchema);
    return job === undefined || FINISHED.has(job.status) ? undefined : readRest(transaction, subject, job);
}

function errorParams(error: NonNullable<Ending['error']>): { params?: Record<string, string> } {
    return error.params === undefined ? {} : { params: { ...error.params } };
}

function jobWrite(held: Held, ending: Ending, stamp: Stamp): Apply {
    const error =
        ending.error === undefined
            ? {}
            : {
                  error: {
                      code: ending.error.code,
                      message: (ending.error.message ?? ending.error.code).slice(0, 2000),
                      ...errorParams(ending.error),
                  },
              };
    const job: JobDoc = {
        ...omit(held.job, ['waitReason', 'lease', 'error']),
        status: ending.status,
        finishedAt: stamp.updatedAt,
        ...error,
        ...stamp,
    };
    return setting(held.places.job, jobDocSchema, job);
}

function versionWrite(held: Held, ending: Ending, stamp: Stamp): Apply | undefined {
    if (held.version === undefined || ENDED.has(held.version.state)) {
        return undefined;
    }
    const error = ending.error === undefined ? {} : { error: { code: ending.error.code, ...errorParams(ending.error) } };
    return setting(held.places.version, layerVersionDocSchema, {
        ...omit(held.version, ['error']),
        state: ending.versionState,
        ...error,
        ...stamp,
    });
}

/** The layer stops showing the version as pending. */
function layerWrite(held: Held, stamp: Stamp): Apply | undefined {
    if (held.layer?.pendingVersion !== held.places.versionId || held.places.layer === undefined) {
        return undefined;
    }
    return setting(held.places.layer, layerDocSchema, { ...omit(held.layer, ['pendingVersion']), ...stamp });
}

/** The version holds its scene's reserved layer id alone, and its layer was never made. */
function holdsScene(held: Held, version: LayerVersionDoc, scene: UsgsSceneDoc): boolean {
    return version.origin === 'usgs' && held.layer === undefined && scene.layerId === version.layerId && !held.layerIdHeld;
}

/** A first import: a USGS version whose layer does not exist yet, holding its scene's reserved layer id alone. */
function isFirstImport(held: Held): boolean {
    const { scene, version } = held;
    return version !== undefined && scene !== undefined && holdsScene(held, version, scene);
}

/** The scene of a first import that ended for good, its layer never made, goes back to `candidate`; a failure may be retried. */
function sceneWrite(held: Held, versionState: Ending['versionState'], stamp: Stamp): Apply | undefined {
    const { scene, places } = held;
    if (versionState === 'failed' || !isFirstImport(held) || scene === undefined || places.scene === undefined) {
        return undefined;
    }
    return setting(places.scene, usgsSceneDocSchema, freedScene(scene, stamp));
}

/** The usage counter without this version's reservation (nothing to write when it held none). */
function usageWrite(held: Held, stamp: Stamp): Apply | undefined {
    const reservations = held.usage?.reservations;
    if (held.usage === undefined || reservations?.[held.places.versionId] === undefined) {
        return undefined;
    }
    const kept = Object.fromEntries(Object.entries(reservations).filter(([id]) => id !== held.places.versionId));
    return setting(held.places.usage, usageDocSchema, { ...held.usage, reservations: kept, ...stamp });
}

/** True when the ending applies to the job and version it read. */
function accepted(held: Held | undefined, ending: Ending): held is Held {
    return held !== undefined && (ending.accept?.(held.job, held.version) ?? true);
}

/**
 * Ends the job and its version as `ending` says; false when the job was already finished (or is gone), or when it is
 * not one `ending.accept` takes.
 */
export async function endWork(deps: EndDeps, cityId: string, jobId: string, ending: Ending): Promise<boolean> {
    const now = deps.clock.now();
    const stamp = stampOf(ending.by, now);
    const siblings = await siblingsOf(deps, cityId, jobId);
    return deps.documents.transaction(async (transaction) => {
        const held = await readHeld(transaction, { cityId, jobId, now, siblings });
        if (!accepted(held, ending)) {
            return false;
        }
        const writes = [
            jobWrite(held, ending, stamp),
            versionWrite(held, ending, stamp),
            layerWrite(held, stamp),
            sceneWrite(held, ending.versionState, stamp),
            usageWrite(held, stamp),
        ];
        for (const write of writes) {
            await write?.(transaction);
        }
        return true;
    });
}

const CANCELLED: Ending = { status: 'cancelled', versionState: 'cancelled', by: IMAGERY_WRITER };
const FAILED: Ending = { status: 'failed', versionState: 'failed', by: IMAGERY_WRITER };
const FAILED_DEFAULT_ERROR: NonNullable<Ending['error']> = { code: 'apiError.internal' };

/** A failed version's `error` from the job, or a stable default when the job wrote none. */
function failedError(job: JobDoc): NonNullable<Ending['error']> {
    const error = job.error;
    if (error === undefined) {
        return FAILED_DEFAULT_ERROR;
    }
    // Job stores `code` as a short string; version docs require an `ApiErrorCode` (pipeline codes are that set).
    return {
        code: error.code as ApiErrorCode,
        message: error.message,
        ...(error.params === undefined ? {} : { params: error.params }),
    };
}

/** The ending a run the pipeline itself ended carries; none for a job still on its way. */
function endingOf(job: JobDoc | undefined): Ending | undefined {
    if (job?.status === 'cancelled') {
        return CANCELLED;
    }
    // A failed version needs `error` (`REQUIRED_BY_STATE.failed`); copy the job's, or a stable default when it has none.
    return job?.status === 'failed' ? { ...FAILED, error: failedError(job) } : undefined;
}

/**
 * What a run the pipeline cancelled still holds (CR-M3-18): the pipeline writes only its job, version, logs and objects,
 * so once the job is `cancelled` the dispatcher releases the layer's `pendingVersion`, a first import's scene and a
 * reservation, and ends a version the pipeline left open. A run that failed in a step (the pipeline writes `failed` the same
 * way) is released alike: a failed join held its layer's `pendingVersion`, and every later join was refused as busy (live
 * 2026-11-15, the 1974 join, lesson 739). False when the job is neither cancelled nor failed, or held nothing more.
 */
export async function releaseCancelled(deps: EndDeps, cityId: string, jobId: string): Promise<boolean> {
    const now = deps.clock.now();
    const stamp = stampOf(IMAGERY_WRITER, now);
    const siblings = await siblingsOf(deps, cityId, jobId);
    return deps.documents.transaction(async (transaction) => {
        const job = await transaction.get(FIRESTORE_PATHS.job(cityId, jobId), jobDocSchema);
        const ending = endingOf(job);
        if (job === undefined || ending === undefined) {
            return false;
        }
        const held = await readRest(transaction, { cityId, jobId, now, siblings }, job);
        const writes = [
            versionWrite(held, ending, stamp),
            layerWrite(held, stamp),
            sceneWrite(held, ending.versionState, stamp),
            usageWrite(held, stamp),
        ];
        const due = writes.filter((write): write is Apply => write !== undefined);
        for (const write of due) {
            await write(transaction);
        }
        return due.length > 0;
    });
}
