/**
 * The allow-lists of a worker's job (`docs/research/M7-local-worker.md` §2.5): which documents `worker.step` may read and
 * write, which fields and states its writes may set, and which objects `worker.urls` may sign. Everything is bound to the
 * one job the worker claimed: its city, its version, its layer and its parameters.
 */
import {
    FIRESTORE_PATHS,
    RASTER_PATHS,
    VERSION_FILES,
    isId,
    layerJoinParamsSchema,
    passPrefixOf,
    validate,
    type JobDoc,
    type JobStatus,
    type LayerJoinParams,
    type LayerVersionState,
} from '@hcm/shared';

import { ARCHIVE_COPY_FILE } from './archive-host.js';

/**
 * The job fields a run writes (`pipeline/src/hcm_pipeline/{runner,lease,jobs}.py`: the lease and its heartbeat, the step
 * records, the progress, the waits and the endings; `pipeline/tests/contracts/job.*.json`).
 */
export const WORKER_JOB_FIELDS: ReadonlySet<string> = new Set([
    'status',
    'waitReason',
    'retryAt',
    'lease',
    'startedAt',
    'finishedAt',
    'error',
    'step',
    'steps',
    'progress',
    'updatedAt',
    'updatedBy',
]);

/**
 * The layer version fields a run writes (`pipeline/src/hcm_pipeline/{documents,runner}.py` and `steps/*.py`: the scan,
 * the reference, the georeference, the suggestions, the output, the machines and the state with its error, M8: the join's
 * report, M9: what `locate` measured, M25: a Landsat scene's report; `pipeline/tests/contracts/version.*.json`).
 */
export const WORKER_VERSION_FIELDS: ReadonlySet<string> = new Set([
    'state',
    'error',
    'scan',
    'reference',
    'georef',
    'calibration',
    // M16: what a recalibration measured (the current fit and the new one on the same checks); its route, `replaces` and points stay the
    // server's (`step-update.ts` `recalibrationAllowed`).
    'recalibration',
    'join',
    // M20 (docs/research/M20-import-local.md §4): an archive series' placement report, and why it waits for a person; of its `source`
    // only what became of its sheets (`placedCount`, `skipped`: `step-update.ts` `sourceAllowed`).
    'archive',
    'source',
    'help',
    // M25 (docs/research/M25-landsat.md): what `warp` measured of a Landsat scene (`landsatReportSchema`); live 2026-11-14 every Landsat
    // run on a computer was refused at `warp` because this field was missing here.
    'landsat',
    'suggestions',
    'output',
    'machines',
    'updatedAt',
    'updatedBy',
]);

/** The statuses a run moves its job to (`cancelled` only after the admin asked). */
export const WORKER_JOB_STATUSES: ReadonlySet<JobStatus> = new Set<JobStatus>([
    'running',
    'queued',
    'waiting_usgs',
    'awaiting_gcps',
    'awaiting_approval',
    'failed',
    'cancelled',
]);

/** The states a run moves its version to. */
export const WORKER_VERSION_STATES: ReadonlySet<LayerVersionState> = new Set<LayerVersionState>([
    'processing',
    'needs_gcps',
    'awaiting_approval',
    'failed',
    'cancelled',
]);

/** What a document path is to the job: one of the documents of §2.5 (`held`: another version of its city, read-only, M15). */
export type DocumentTarget = 'city' | 'job' | 'version' | 'base' | 'layer' | 'scene' | 'pass' | 'held';

/** The job a worker holds, with the ids its allow-lists name. */
export interface JobScope {
    readonly cityId: string;
    readonly jobId: string;
    readonly job: JobDoc;
    /** The version it makes (`job.versionId`, else the job's own id). */
    readonly versionId: string;
}

/** A parameter of the job that is a document or object id (`params.basedOn`, `params.entityId`), else undefined. */
function idParam(job: JobDoc, name: string): string | undefined {
    const value = job.params[name];
    return isId(value) ? value : undefined;
}

/** A string parameter of the job (`params.uploadPath`), else undefined. */
function textParam(job: JobDoc, name: string): string | undefined {
    const value = job.params[name];
    return typeof value === 'string' ? value : undefined;
}

/** The base version a re-georeference renders again. */
function baseVersionOf(job: JobDoc): string | undefined {
    return job.type === 'regeoref' ? idParam(job, 'basedOn') : undefined;
}

/** M8: the frames a join reads, only from well-formed parameters of its own type. */
function joinPartsOf(job: JobDoc): LayerJoinParams['parts'] {
    const params = job.type === 'layer-join' ? validate(layerJoinParamsSchema, job.params) : undefined;
    return params?.ok === true ? params.value.parts : [];
}

/** The versions the job reads and never writes: a re-georeference's base, a join's frames. */
export function inputVersionsOf(job: JobDoc): string[] {
    const base = baseVersionOf(job);
    return [...(base === undefined ? [] : [base]), ...joinPartsOf(job).map((part) => part.versionId)];
}

/** The scene a USGS import fetches. */
export function sceneOf(job: JobDoc): string | undefined {
    return job.type === 'usgs-import' ? idParam(job, 'entityId') : undefined;
}

/** The upload a GeoTIFF import reads. */
function uploadOf(job: JobDoc): string | undefined {
    return job.type === 'geotiff-import' ? textParam(job, 'uploadPath') : undefined;
}

/** The documents of §2.5 by path (the input versions, the layer and the scene only when the job names them). */
function documentTargets({ cityId, jobId, job, versionId }: JobScope): Map<string, DocumentTarget> {
    const scene = sceneOf(job);
    const layerId = job.layerId;
    const entries: [string | undefined, DocumentTarget][] = [
        [FIRESTORE_PATHS.city(cityId), 'city'],
        [FIRESTORE_PATHS.job(cityId, jobId), 'job'],
        [FIRESTORE_PATHS.layerVersion(cityId, versionId), 'version'],
        ...inputVersionsOf(job).map((id): [string, DocumentTarget] => [FIRESTORE_PATHS.layerVersion(cityId, id), 'base']),
        [layerId === undefined ? undefined : FIRESTORE_PATHS.layer(cityId, layerId), 'layer'],
        [scene === undefined ? undefined : FIRESTORE_PATHS.usgsScene(cityId, scene), 'scene'],
    ];
    return new Map(entries.flatMap(([path, target]) => (path === undefined ? [] : [[path, target] as const])));
}

/** M9 (`docs/research/M9-calibration.md` §2): the date is the scene's, so the path is bound to the scene's mission, camera and a date. */
const PASS_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** `path` is the last proved model of the pass of the scene this import fetches: read-only, the first place to look. */
function isOwnPass({ cityId, job }: JobScope, path: string): boolean {
    const prefix = passPrefixOf(sceneOf(job) ?? '');
    const start = `${FIRESTORE_PATHS.imageryPasses(cityId)}/${prefix ?? ''}`;
    return prefix !== undefined && path.startsWith(start) && PASS_DATE.test(path.slice(start.length));
}

/**
 * M15 (`docs/research/M15-calibration-accuracy.md`, *Joint solve*): another version of the job's city, which a frame being joined
 * reads to find the accepted frames it may be held to. Read-only: `step-update.ts` writes `job` and `version` alone.
 */
function isCityVersion({ cityId }: JobScope, path: string): boolean {
    const prefix = `${FIRESTORE_PATHS.layerVersions(cityId)}/`;
    return path.startsWith(prefix) && isId(path.slice(prefix.length));
}

function readOnlyTarget(scope: JobScope, path: string): DocumentTarget | undefined {
    if (isOwnPass(scope, path)) {
        return 'pass';
    }
    return isCityVersion(scope, path) ? 'held' : undefined;
}

/** What `path` is to the job, or undefined when it is off the allow-list. */
export function documentTarget(scope: JobScope, path: string): DocumentTarget | undefined {
    return documentTargets(scope).get(path) ?? readOnlyTarget(scope, path);
}

/** A log line's id: its sequence number zero-padded to six digits (`pipeline/src/hcm_pipeline/documents.py` → `log_id`). */
const LOG_ID = /^\d{6}$/;

/** The sequence number of the job's log line at `path`, or undefined when `path` is not one of its log lines. */
export function logLineOf(scope: JobScope, path: string): number | undefined {
    const prefix = `${FIRESTORE_PATHS.jobLogs(scope.cityId, scope.jobId)}/`;
    const id = path.startsWith(prefix) ? path.slice(prefix.length) : '';
    return LOG_ID.test(id) ? Number(id) : undefined;
}

/** True when `collection` is the job's log. */
export function isJobLog(scope: JobScope, collection: string): boolean {
    return collection === FIRESTORE_PATHS.jobLogs(scope.cityId, scope.jobId);
}

/** M15: true when `collection` is its city's versions, whose ids a frame being joined lists. */
export function isCityVersions(scope: JobScope, collection: string): boolean {
    return collection === FIRESTORE_PATHS.layerVersions(scope.cityId);
}

/** The objects of a version's run: the version's folder, its layer, and the inputs its parameters name. */
export interface ObjectScope {
    readonly cityId: string;
    /** The job (M20: an archive series reads its sheets' copy from the job's own folder of `tmp/archive-copies/`). */
    readonly jobId: string;
    readonly layerId: string;
    readonly versionId: string;
    readonly job: JobDoc;
    /**
     * M8: the scans its input versions name. A version with new points keeps the scan of the one it was based on, in that one's
     * folder (`imagery/regeoref.ts`, which never copies it), so a version's id does not say where its scan lies.
     */
    readonly inputScans: readonly string[];
}

function versionFolder({ cityId, layerId, versionId }: Pick<ObjectScope, 'cityId' | 'layerId' | 'versionId'>): string {
    return `rasters/${cityId}/${layerId}/${versionId}/`;
}

/** One file of the version's folder (`rasters/C/L/V/<file>`). */
function inVersionFolder(scope: ObjectScope, path: string): boolean {
    const folder = versionFolder(scope);
    const name = path.startsWith(folder) ? path.slice(folder.length) : '';
    return name !== '' && !name.includes('/');
}

/** The inputs a run reads beyond its own folder: the base version's scan (`regeoref`), each frame's (`layer-join`), the upload. */
function inputsOf(scope: ObjectScope): string[] {
    const base = baseVersionOf(scope.job);
    const upload = uploadOf(scope.job);
    return [
        ...(base === undefined ? [] : [RASTER_PATHS.version(scope.cityId, scope.layerId, base, 'scan.tif')]),
        ...joinPartsOf(scope.job).map((part) => RASTER_PATHS.version(scope.cityId, part.layerId, part.versionId, 'scan.tif')),
        ...(upload === undefined ? [] : [upload]),
    ];
}

/** A scan an input version names, of this city: a path a document holds grants no more than the city's rasters. */
function isInputScan(scope: ObjectScope, path: string): boolean {
    return scope.inputScans.includes(path) && path.startsWith(`rasters/${scope.cityId}/`) && !path.includes('..');
}

/** M15: the 5 m image of a frame of the city (`rasters/C/L/V/align.tif`), which a frame being joined measures its film ties on. */
const ALIGN_IMAGE = /^rasters\/([^/]+)\/([^/]+)\/([^/]+)\/align\.tif$/;

function isCityAlignImage({ cityId }: ObjectScope, path: string): boolean {
    const [, city, layer, version] = ALIGN_IMAGE.exec(path) ?? [];
    return city === cityId && isId(layer) && isId(version);
}

/** M20 (2026-11-13): one file of the copy of an archive series' sheets that its job reads (`ARCHIVE_COPY_FILE`). */
function isOwnArchiveCopy({ cityId, jobId, job }: ObjectScope, path: string): boolean {
    const folder = `tmp/archive-copies/${cityId}/${jobId}/`;
    return job.type === 'archive-series' && path.startsWith(folder) && ARCHIVE_COPY_FILE.test(path.slice(folder.length));
}

/** True when the run may read `path`: a file of its version, one of its inputs, a frame's image of its city (M15), its archive copy. */
export function mayRead(scope: ObjectScope, path: string): boolean {
    const inputs = inputsOf(scope).includes(path) || isInputScan(scope, path);
    return inVersionFolder(scope, path) || inputs || isCityAlignImage(scope, path) || isOwnArchiveCopy(scope, path);
}

/** True when the run may write `path`: one of its version's files (`VERSION_FILES`), nothing else. */
export function mayWrite(scope: ObjectScope, path: string): boolean {
    return VERSION_FILES.some((file) => RASTER_PATHS.version(scope.cityId, scope.layerId, scope.versionId, file) === path);
}
