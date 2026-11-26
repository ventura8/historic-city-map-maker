import '../global-options.js';

import {
    FINISHED_JOB_STATUSES,
    FIRESTORE_PATHS,
    RASTER_PATHS,
    archiveDocSchema,
    jobDocSchema,
    jobLogDocSchema,
    layerVersionReadSchema,
    type ArchiveDoc,
    type CallableRequest,
    type CallableResponse,
    type JobDoc,
    type JobStatus,
    type LayerVersionDoc,
    type LayerVersionState,
} from '@hcm/shared';

import type { VerifiedCaller } from '../api/access.js';
import { ApiError } from '../api/api-error.js';
import { defineCallable, type CallableDeps } from '../api/callable.js';
import { omit } from '../api/objects.js';
import type { DocumentTransaction } from '../ports/documents.js';
import type { Ports } from '../ports/index.js';
import { endWork } from './end.js';
import { refuseHeldPart } from './join-parts.js';
import { deleteVersionTiles } from './own-tiles-clean.js';
import { requireVersion, stampOf } from './records.js';
import { releaseScene } from './release-scene.js';
import { deleteWorkFiles } from './work-files.js';

/**
 * `imagery.deleteVersion` (an editor or the city's owner; `docs/research/M3-interfaces.md` §7.1; S-A125-*): a version that never
 * reached the map goes for good: a failed, cancelled or rejected one, or an archive series waiting for points that the owner starts
 * over (its job is cancelled first, through the same ending as Cancel, so whatever it held is released). Its job, the job's log, its
 * scratch files (`work/{city}/{job}/`) and its own folder of the private bucket (`rasters/{city}/{layer}/{version}/`) go, with a
 * public copy a dead publish left; never the folder of a version it was based on, a USGS delivery, an upload's original or the
 * archive's originals, which stay on the owner's computer. A first import's scene that only a failure kept is freed, as Dismiss does.
 * Refused: a version that is or was on the map (`apiError.imagery.deletePublished`), one whose job is under way
 * (`apiError.imagery.deleteRunning`: Cancel first), one another version is built on (`apiError.imagery.deleteInUse`) and a frame a
 * live join holds (`apiError.imagery.joinPartHeld`). The two documents are deleted in a transaction that reads them again, so a
 * Retry clicked meanwhile is never deleted under its run (a version gone meanwhile is `apiError.notFound`, one that left its
 * deletable state `apiError.imagery.versionState`). An archive series also leaves its archive's record of jobs in the same
 * transaction, so `imagery.archiveImport` takes it again: the owner starts it over (the import's stamp goes with the last series).
 * Layer versions are not audited documents (no `history` subcollection);
 * the deletion is recorded as the structured log line every version decision writes, with the caller's uid.
 */
type Request = CallableRequest<'imagery.deleteVersion'>;

export type DeleteVersionDeps = Pick<Ports, 'documents' | 'clock' | 'log' | 'blobs'>;

/** States a version holds once it was on the map, or is on its way there. */
const ON_THE_MAP: ReadonlySet<LayerVersionState> = new Set<LayerVersionState>([
    'approved',
    'publishing',
    'published',
    'superseded',
    'joined',
]);

/** States of a version that ended without ever reaching the map. */
const NEVER_SHOWN: ReadonlySet<LayerVersionState> = new Set<LayerVersionState>(['failed', 'cancelled', 'rejected']);

const FINISHED: ReadonlySet<JobStatus> = new Set(FINISHED_JOB_STATUSES);

/** An archive series waiting for points, its job too: the owner may start it over. */
function parkedSeries(version: LayerVersionDoc, job: JobDoc | undefined): boolean {
    return version.origin === 'archive' && version.state === 'needs_gcps' && job?.status === 'awaiting_gcps';
}

/** A job that is gone or finished holds nothing a deletion could break. */
function jobDone(job: JobDoc | undefined): boolean {
    return job === undefined || FINISHED.has(job.status);
}

/** The refusal for `version` and its `job`, or null when it may be deleted. */
function deleteRefusal(version: LayerVersionDoc, job: JobDoc | undefined): ApiError | null {
    if (ON_THE_MAP.has(version.state)) {
        return new ApiError('apiError.imagery.deletePublished');
    }
    if (parkedSeries(version, job)) {
        return null;
    }
    if (!jobDone(job)) {
        return new ApiError('apiError.imagery.deleteRunning');
    }
    return NEVER_SHOWN.has(version.state) ? null : new ApiError('apiError.imagery.versionState');
}

function readJob(deps: DeleteVersionDeps, cityId: string, version: LayerVersionDoc): Promise<JobDoc | undefined> {
    return deps.documents.get(FIRESTORE_PATHS.job(cityId, version.jobId), jobDocSchema);
}

/** `apiError.imagery.deleteInUse` while another version was made from this one (its scan may lie in this one's folder). */
async function refuseBuiltOn(deps: DeleteVersionDeps, cityId: string, versionId: string): Promise<void> {
    const children = await deps.documents.query(FIRESTORE_PATHS.layerVersions(cityId), layerVersionReadSchema, {
        where: [['basedOn', '==', versionId]],
    });
    if (children.documents.length > 0) {
        throw new ApiError('apiError.imagery.deleteInUse');
    }
}

/**
 * The version, checked: deletable, held by no live join, base of no other version. Read as an ending reads it
 * (`layerVersionReadSchema`): a record an older release stored with fields today's schema refuses can still be deleted.
 */
async function requireDeletable(deps: DeleteVersionDeps, request: Request): Promise<LayerVersionDoc> {
    const version = await requireVersion(deps.documents, request.cityId, request.versionId, layerVersionReadSchema);
    const refusal = deleteRefusal(version, await readJob(deps, request.cityId, version));
    if (refusal !== null) {
        throw refusal;
    }
    await refuseHeldPart(deps.documents, request.cityId, version);
    await refuseBuiltOn(deps, request.cityId, request.versionId);
    return version;
}

/** A parked series' job ends as a Cancel ends it (whatever it held released); refused when it moved on meanwhile. */
async function endParked(deps: DeleteVersionDeps, caller: VerifiedCaller, request: Request, version: LayerVersionDoc): Promise<void> {
    if (version.state !== 'needs_gcps') {
        return;
    }
    const accept = (job: JobDoc): boolean => job.status === 'awaiting_gcps';
    const ending = { status: 'cancelled', versionState: 'cancelled', by: caller.uid, accept } as const;
    if (!(await endWork(deps, request.cityId, version.jobId, ending))) {
        throw new ApiError('apiError.imagery.deleteRunning');
    }
}

/** The re-read version may still go: `apiError.notFound` once gone, `versionState` once it left, `deleteRunning` while its job runs. */
function refuseChanged(version: LayerVersionDoc | undefined, job: JobDoc | undefined): void {
    if (version === undefined) {
        throw new ApiError('apiError.notFound');
    }
    if (!NEVER_SHOWN.has(version.state)) {
        throw new ApiError('apiError.imagery.versionState');
    }
    if (!jobDone(job)) {
        throw new ApiError('apiError.imagery.deleteRunning');
    }
}

/** An archive series' record and the series it names, or null for any other version. */
interface SeriesRecord {
    readonly path: string;
    readonly seriesId: string;
}

function seriesRecordOf(cityId: string, version: LayerVersionDoc): SeriesRecord | null {
    const source = version.source;
    return source?.kind === 'archive' ? { path: FIRESTORE_PATHS.archive(cityId, source.archiveId), seriesId: source.seriesId } : null;
}

/** Who deletes, and when, for the archive record's stamp. */
interface Deleter {
    readonly uid: string;
    readonly now: Date;
}

/**
 * The archive's record without this series' job, so `imagery.archiveImport` takes the series again; with no series left, the
 * record reads as never imported. Null when the record names no job, or another job, for it (nothing to change).
 */
function withoutSeries(archive: ArchiveDoc, seriesId: string, jobId: string, by: Deleter): ArchiveDoc | null {
    if (archive.jobs?.[seriesId] !== jobId) {
        return null;
    }
    const jobs = Object.fromEntries(Object.entries(archive.jobs).filter(([id]) => id !== seriesId));
    const stamp = stampOf(by.uid, by.now);
    if (Object.keys(jobs).length > 0) {
        return { ...archive, jobs, ...stamp };
    }
    return { ...omit(archive, ['jobs', 'importedBy', 'importedAt']), ...stamp };
}

/** The archive record as it should be written, or null when there is none or it does not name this version's job. */
async function keptRecord(
    transaction: DocumentTransaction,
    record: SeriesRecord | null,
    known: LayerVersionDoc,
    by: Deleter,
): Promise<{ readonly path: string; readonly archive: ArchiveDoc } | null> {
    if (record === null) {
        return null;
    }
    const stored = await transaction.get(record.path, archiveDocSchema);
    const archive = stored === undefined ? null : withoutSeries(stored, record.seriesId, known.jobId, by);
    return archive === null ? null : { path: record.path, archive };
}

/**
 * The version and its job deleted together, both read again first: still never shown, the job still done; an archive series
 * leaves its archive's record of jobs in the same transaction.
 */
async function deleteDocuments(deps: DeleteVersionDeps, caller: VerifiedCaller, request: Request, known: LayerVersionDoc): Promise<void> {
    const versionPath = FIRESTORE_PATHS.layerVersion(request.cityId, request.versionId);
    const jobPath = FIRESTORE_PATHS.job(request.cityId, known.jobId);
    const record = seriesRecordOf(request.cityId, known);
    await deps.documents.transaction(async (transaction) => {
        const version = await transaction.get(versionPath, layerVersionReadSchema);
        const job = await transaction.get(jobPath, jobDocSchema);
        const kept = await keptRecord(transaction, record, known, { uid: caller.uid, now: deps.clock.now() });
        refuseChanged(version, job);
        await transaction.delete(jobPath);
        await transaction.delete(versionPath);
        if (kept !== null) {
            await transaction.set(kept.path, archiveDocSchema, kept.archive);
        }
    });
}

/** The job's log lines, valid or not. */
async function deleteLogs(deps: DeleteVersionDeps, cityId: string, jobId: string): Promise<void> {
    const logs = await deps.documents.query(FIRESTORE_PATHS.jobLogs(cityId, jobId), jobLogDocSchema);
    const paths = [...logs.documents, ...logs.invalid].map((line) => line.path);
    await Promise.all(paths.map((path) => deps.documents.delete(path)));
}

/** `rasters/{city}/{layer}/{version}/`, its segments checked by the one place that spells the path. */
function versionFolder(cityId: string, versionId: string, version: LayerVersionDoc): string {
    const file = RASTER_PATHS.version(cityId, version.layerId, versionId, 'tiles.pmtiles');
    return file.slice(0, file.lastIndexOf('/') + 1);
}

/** Every file only this version uses; a failure is logged (the work folder's lifecycle stays the backstop). */
async function deleteFiles(deps: DeleteVersionDeps, cityId: string, versionId: string, version: LayerVersionDoc): Promise<void> {
    await deleteWorkFiles(deps, cityId, version.jobId);
    try {
        const paths = await deps.blobs.list('private', versionFolder(cityId, versionId, version));
        await Promise.all(paths.map((path) => deps.blobs.delete('private', path)));
        await deleteVersionTiles(deps, cityId, versionId, version);
    } catch (error) {
        deps.log.warn('files of a deleted version left behind', { cityId, versionId, error: String(error) });
    }
}

/** A first import's scene that only its failure kept (a cancelled or rejected one was freed when it ended). */
async function freeScene(deps: DeleteVersionDeps, cityId: string, version: LayerVersionDoc): Promise<void> {
    if (version.state === 'failed' && version.source?.kind === 'usgs') {
        await releaseScene(deps, cityId, version.source.entityId, version.layerId);
    }
}

async function imageryDeleteVersion(
    deps: DeleteVersionDeps,
    caller: VerifiedCaller,
    request: Request,
): Promise<CallableResponse<'imagery.deleteVersion'>> {
    const version = await requireDeletable(deps, request);
    await endParked(deps, caller, request, version);
    await deleteDocuments(deps, caller, request, version);
    await freeScene(deps, request.cityId, version);
    await deleteLogs(deps, request.cityId, version.jobId);
    await deleteFiles(deps, request.cityId, request.versionId, version);
    deps.log.info('layer version deleted', {
        uid: caller.uid,
        cityId: request.cityId,
        versionId: request.versionId,
        layerId: version.layerId,
        was: version.state,
    });
    return { deleted: true };
}

/** The `imagery-deleteVersion` callable. */
export function deleteVersionFunction(getDeps: () => DeleteVersionDeps & CallableDeps) {
    return defineCallable('imagery.deleteVersion', imageryDeleteVersion, getDeps);
}
