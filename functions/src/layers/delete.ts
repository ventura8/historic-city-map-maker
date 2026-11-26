import '../global-options.js';

import {
    ENDED_VERSION_STATES,
    FIRESTORE_PATHS,
    JOB_STATUSES,
    LAYER_DELETE_GRACE_DAYS,
    jobDocSchema,
    layerDocSchema,
    layerVersionDocSchema,
    timestampFromDate,
    type CallableRequest,
    type CallableResponse,
    type JobDoc,
    type JobStatus,
    type LayerDeleteParams,
    type LayerDoc,
    type LayerVersionDoc,
    type LayerVersionState,
} from '@hcm/shared';

import type { VerifiedCaller } from '../api/access.js';
import { ApiError } from '../api/api-error.js';
import { defineCallable, type CallableDeps } from '../api/callable.js';
import { compact } from '../api/objects.js';
import type { DocumentTransaction } from '../ports/documents.js';
import type { Ports } from '../ports/index.js';

export type LayerDeleteDeps = Pick<Ports, 'documents' | 'clock' | 'log'>;

type Request = CallableRequest<'layers.delete'>;

const DAY_MS = 86_400_000;

const ENDED_VERSIONS: ReadonlySet<LayerVersionState> = new Set(ENDED_VERSION_STATES);

/** A job in one of these states is done with its layer; any other one is still working on it. */
const FINISHED: ReadonlySet<JobStatus> = new Set<JobStatus>(['succeeded', 'failed', 'cancelled']);

/** The layer states in which the raster pipeline is working on the layer's tiles. */
const PROCESSING: ReadonlySet<LayerDoc['status']> = new Set<LayerDoc['status']>(['processing', 'awaiting_approval']);

/** `ld-<time>-<layer>` (at most 40 characters, `ID_PATTERN`): one deletion per layer and millisecond. */
function jobIdFor(layerId: string, now: Date): string {
    return `ld-${now.getTime().toString(36)}-${layerId.slice(0, 26)}`;
}

/** The job's layer: M2's jobs in their parameters, M3's raster jobs (`usgs-import`, `geotiff-import`, `regeoref`, `republish`) at the
 * top level (`docs/research/M3-interfaces.md` §2.3; CR-M3-24). */
function layerOfJob(job: JobDoc): unknown {
    return job.layerId ?? job.params['layerId'];
}

const UNFINISHED: readonly JobStatus[] = JOB_STATUSES.filter((status) => !FINISHED.has(status));

/**
 * A layer whose pipeline job is not finished, or which the pipeline is processing, is not deleted (`layers.busy`). The jobs are asked
 * by their indexed `status` and matched to the layer here: `jobs.params` is exempt from indexing (`firebase/firestore.indexes.json`),
 * so a query on `params.layerId` fails in Firestore (lesson 557).
 */
async function refuseWhileBusy(deps: LayerDeleteDeps, request: Request): Promise<void> {
    const jobs = await deps.documents.query(FIRESTORE_PATHS.jobs(request.cityId), jobDocSchema, {
        where: [['status', 'in', UNFINISHED]],
    });
    if (jobs.documents.some((job) => layerOfJob(job.data) === request.layerId)) {
        throw new ApiError('apiError.layers.busy');
    }
}

/** The layer's current version, if it has one. */
async function currentVersionOf(deps: LayerDeleteDeps, request: Request): Promise<LayerVersionDoc | undefined> {
    const layer = await deps.documents.get(FIRESTORE_PATHS.layer(request.cityId, request.layerId), layerDocSchema);
    const current = layer?.currentVersion;
    return current === undefined
        ? undefined
        : deps.documents.get(FIRESTORE_PATHS.layerVersion(request.cityId, current), layerVersionDocSchema);
}

/** The frame a join is built from, by the join's own state: one that ended holds nothing (a stale `partOf`). */
async function heldByLiveJoin(deps: LayerDeleteDeps, cityId: string, partOf: string): Promise<boolean> {
    const join = await deps.documents.get(FIRESTORE_PATHS.layerVersion(cityId, partOf), layerVersionDocSchema);
    return join !== undefined && !ENDED_VERSIONS.has(join.state);
}

/** What the admin knows a frame by: its USGS entity, else its version's job. */
function frameOf(version: LayerVersionDoc): string {
    return version.source?.kind === 'usgs' ? version.source.entityId : version.jobId;
}

/**
 * M8 (docs/research/M8-join-interfaces.md §5): a layer whose current version is a frame of a live join is not deleted
 * (`apiError.imagery.joinPartHeld`). Its folder keeps its own reading of these documents (CR-M2-3).
 */
async function refuseHeldLayer(deps: LayerDeleteDeps, request: Request): Promise<void> {
    const version = await currentVersionOf(deps, request);
    if (version?.partOf !== undefined && (await heldByLiveJoin(deps, request.cityId, version.partOf))) {
        throw new ApiError('apiError.imagery.joinPartHeld', { frame: frameOf(version) });
    }
}

/**
 * What the `layer-delete` job deletes: the tileset the raster pipeline published for the layer (`mapbox.tilesetId`)
 * and its source. A layer linked to a tileset that existed before (`layers.link`) names none: the tileset stays in the
 * Mapbox account.
 */
function paramsOf(request: Request, layer: LayerDoc): LayerDeleteParams {
    return compact<LayerDeleteParams>({
        layerId: request.layerId,
        tilesetId: layer.mapbox?.tilesetId,
        sourceSha: layer.mapbox?.publishedSourceSha,
    });
}

interface Deletion {
    readonly request: Request;
    readonly caller: VerifiedCaller;
    readonly now: Date;
    readonly runsAt: Date;
    readonly jobId: string;
}

function jobOf(deletion: Deletion, layer: LayerDoc): JobDoc {
    const now = timestampFromDate(deletion.now);
    return {
        type: 'layer-delete',
        status: 'queued',
        params: paramsOf(deletion.request, layer),
        createdBy: deletion.caller.uid,
        createdAt: now,
        dispatchAt: timestampFromDate(deletion.runsAt),
        updatedBy: deletion.caller.uid,
        updatedAt: now,
    };
}

/** In one transaction: the layer goes (the history trigger keeps it whole) and its `layer-delete` job waits. */
async function deleteAndQueue(transaction: DocumentTransaction, deletion: Deletion): Promise<void> {
    const { cityId, layerId } = deletion.request;
    const path = FIRESTORE_PATHS.layer(cityId, layerId);
    const layer = await transaction.get(path, layerDocSchema);
    if (layer === undefined) {
        throw new ApiError('apiError.notFound');
    }
    // A new version on its way (a replacement, a re-georeference or a crop) is the pipeline working on the layer too.
    if (PROCESSING.has(layer.status) || layer.pendingVersion !== undefined) {
        throw new ApiError('apiError.layers.busy');
    }
    await transaction.delete(path);
    await transaction.create(FIRESTORE_PATHS.job(cityId, deletion.jobId), jobDocSchema, jobOf(deletion, layer));
}

/**
 * `layers.delete` (admins; `docs/research/M2c-interfaces.md` §8.4, CR-M2c-3; S-A33-HAPPY-LAYER): deletes the layer
 * document and queues a `layer-delete` job that may run `LAYER_DELETE_GRACE_DAYS` later (the raster pipeline's
 * dispatcher runs it in M3, CR-M2c-13; a revert of the deletion before then cancels it, CR-M2c-5). A missing layer is
 * `apiError.notFound`; a layer the pipeline is working on is `apiError.layers.busy`; M8: a layer a live join is built from is
 * `apiError.imagery.joinPartHeld`.
 */
async function layersDelete(deps: LayerDeleteDeps, caller: VerifiedCaller, request: Request): Promise<CallableResponse<'layers.delete'>> {
    await refuseHeldLayer(deps, request);
    await refuseWhileBusy(deps, request);
    const now = deps.clock.now();
    const runsAt = new Date(now.getTime() + LAYER_DELETE_GRACE_DAYS * DAY_MS);
    const deletion: Deletion = { request, caller, now, runsAt, jobId: jobIdFor(request.layerId, now) };
    await deps.documents.transaction((transaction) => deleteAndQueue(transaction, deletion));
    deps.log.info('layer deleted', { uid: caller.uid, cityId: request.cityId, layerId: request.layerId, jobId: deletion.jobId });
    return { jobId: deletion.jobId, runsAt: runsAt.toISOString() };
}

/** The `layers-delete` callable. */
export function layerDeleteFunction(getDeps: () => LayerDeleteDeps & CallableDeps) {
    return defineCallable('layers.delete', layersDelete, getDeps);
}
