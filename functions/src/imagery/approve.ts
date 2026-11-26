import '../global-options.js';

import {
    FINISHED_JOB_STATUSES,
    FIRESTORE_PATHS,
    jobDocSchema,
    layerDocSchema,
    layerVersionDocSchema,
    layerVersionReadSchema,
    recalibrationVerdict,
    rightsAllowPublish,
    type CallableRequest,
    type CallableResponse,
    type JobDoc,
    type JobStatus,
    type LayerDoc,
    type LayerVersionDoc,
    type LayerVersionState,
    type Recalibration,
} from '@hcm/shared';

import type { VerifiedCaller } from '../api/access.js';
import { ApiError } from '../api/api-error.js';
import { defineCallable, type CallableDeps } from '../api/callable.js';
import type { DocumentTransaction } from '../ports/documents.js';
import type { Ports } from '../ports/index.js';
import { approved, estimateOf, queuePublish, type ApprovalDeps } from './approval.js';
import { endWork } from './end.js';
import { refuseHeldPart } from './join-parts.js';
import { deleteVersionTiles } from './own-tiles-clean.js';
import { againstCurrent } from './recalibrate-replace.js';
import { releaseScene } from './release-scene.js';
import { requireVersion, stampOf, type Stamp } from './records.js';
import { deleteWorkFiles } from './work-files.js';

/**
 * `imagery.approve` and `imagery.reject` (admin; `docs/research/M3-interfaces.md` §7.1; S-A12-HAPPY, S-A17-*): the one
 * click when a version did not publish on its own. Approve queues the publish (the compute-unit guard runs there);
 * Reject ends the version and its job, frees its reserved layer id and its scene, and the layer keeps its tiles. The
 * job and the version are checked again in the transaction that ends them, so a rejection never ends a publish the guard
 * has meanwhile sent to Mapbox (CR-M3-47). A version that failed is dismissed the same way: it becomes `rejected` and
 * leaves the Imagery area's "Waiting for you" (its job stays failed, marked `cancelRequested` so no page offers Retry), and its
 * scene can be imported again (finding 85). A version ended either way can never run again: its scratch files in the bucket go, and M12: its
 * tiles, private and any public copy a publish left (`deleteVersionTiles`)
 * (a local worker's stay in its work folder until its sweep: `work-files.ts`). M8: a frame a live join holds refuses both
 * (`refuseHeldPart`).
 */
type VersionRequest = CallableRequest<'imagery.reject'>;
type ApproveRequest = CallableRequest<'imagery.approve'>;

type RejectDeps = ApprovalDeps & Pick<Ports, 'blobs'>;

/** The versions an admin may still reject: waiting for points, for approval, or for a compute-unit choice. */
const REJECTABLE: ReadonlySet<LayerVersionState> = new Set<LayerVersionState>(['needs_gcps', 'awaiting_approval', 'approved']);
const FINISHED: ReadonlySet<JobStatus> = new Set(FINISHED_JOB_STATUSES);

/** A job and version a rejection may end: not at Mapbox, the version still waiting for the admin. */
function rejectable(job: JobDoc, version: LayerVersionDoc | undefined): boolean {
    return job.status !== 'mts_processing' && version !== undefined && REJECTABLE.has(version.state);
}

/** M16: better than the layer's published version, on the same checks; a recalibration of anything else is not shown better. */
function shownBetter(version: LayerVersionDoc, recalibration: Recalibration, layer: LayerDoc | undefined): boolean {
    return recalibrationVerdict(recalibration) === 'better' && againstCurrent(version, layer);
}

/**
 * M16 (`docs/research/M16-recalibrate.md` §4; S-A89-*): a recalibration not shown to be better than the layer's published version replaces
 * it only by the owner's choice (`acceptWorse`), which the page asks for in words. Its figures compare it with its `basedOn`, so they count
 * only when that is the published version, read in this transaction (a refine of a version that was itself waiting launders nothing).
 */
async function refuseUnchosenWorse(transaction: DocumentTransaction, version: LayerVersionDoc, request: ApproveRequest): Promise<void> {
    const { recalibration } = version;
    if (recalibration === undefined || request.acceptWorse === true) {
        return;
    }
    const layer = await transaction.get(FIRESTORE_PATHS.layer(request.cityId, version.layerId), layerDocSchema);
    if (!shownBetter(version, recalibration, layer)) {
        throw new ApiError('apiError.imagery.notBetter');
    }
}

/**
 * M20 (`docs/research/M20-import-local.md` §1.6, §7; S-A120-BAD-RIGHTS-UNCONFIRMED): a version that carries rights (an archive series)
 * publishes only once they allow it; one waiting for its owner's confirmation, or never to be published, stays private.
 */
function refuseUnconfirmedRights(version: LayerVersionDoc): void {
    if (version.rights !== undefined && !rightsAllowPublish(version.rights)) {
        throw new ApiError('apiError.imagery.rightsUnconfirmed');
    }
}

/**
 * Batch 4 (`docs/research/M20-import-local.md` §5.1; S-A120-*-GRID-NAMES): a grid series placed from its sheets' names without a proof is
 * approved by the city's owner alone (Approve the sheet-name placement); an editor's approval is `apiError.city.notOwner`.
 */
function refuseGridNamesUnlessOwner(version: LayerVersionDoc, caller: VerifiedCaller, cityId: string): void {
    if (version.archive?.method === 'grid-names' && caller.membership?.roleIn(cityId) !== 'owner') {
        throw new ApiError('apiError.city.notOwner');
    }
}

/** The version is approved now, its estimate recorded; any other state is `apiError.imagery.versionState`. */
async function approveVersion(deps: ApprovalDeps, caller: VerifiedCaller, request: ApproveRequest): Promise<LayerVersionDoc> {
    const path = FIRESTORE_PATHS.layerVersion(request.cityId, request.versionId);
    const now = deps.clock.now();
    return deps.documents.transaction(async (transaction) => {
        const version = await transaction.get(path, layerVersionDocSchema);
        if (version === undefined) {
            throw new ApiError('apiError.notFound');
        }
        if (version.state !== 'awaiting_approval' || version.output === undefined) {
            throw new ApiError('apiError.imagery.versionState');
        }
        await refuseHeldPart(transaction, request.cityId, version);
        refuseUnconfirmedRights(version);
        refuseGridNamesUnlessOwner(version, caller, request.cityId);
        await refuseUnchosenWorse(transaction, version, request);
        const result = approved({ ...version, estimate: version.estimate ?? estimateOf(version.output, now) }, caller.uid, now);
        await transaction.set(path, layerVersionDocSchema, result);
        return result;
    });
}

async function imageryApprove(
    deps: ApprovalDeps,
    caller: VerifiedCaller,
    request: ApproveRequest,
): Promise<CallableResponse<'imagery.approve'>> {
    const version = await approveVersion(deps, caller, request);
    await queuePublish(deps, request.cityId, version.jobId, 'approved');
    deps.log.info('layer version approved', { uid: caller.uid, cityId: request.cityId, versionId: request.versionId });
    return { state: version.state, jobId: version.jobId };
}

/** The version's job is still unfinished and not at Mapbox, so rejecting it changes nothing published. */
async function requireRejectable(deps: ApprovalDeps, request: VersionRequest): Promise<LayerVersionDoc> {
    const version = await requireVersion(deps.documents, request.cityId, request.versionId, layerVersionReadSchema);
    const job = await deps.documents.get(FIRESTORE_PATHS.job(request.cityId, version.jobId), jobDocSchema);
    const busyAtMapbox = job === undefined || FINISHED.has(job.status) || job.status === 'mts_processing';
    if (!REJECTABLE.has(version.state) || busyAtMapbox) {
        throw new ApiError('apiError.imagery.versionState');
    }
    return version;
}

/** The failed job stays failed, marked so that `jobRetryable` no longer offers Retry on any page. */
async function markJobDismissed(transaction: DocumentTransaction, path: string, stamp: Stamp): Promise<void> {
    const job = await transaction.get(path, jobDocSchema);
    if (job?.status === 'failed') {
        await transaction.set(path, jobDocSchema, { ...job, cancelRequested: true, ...stamp });
    }
}

/** A failed version `rejected`, its job marked, in a transaction that finds it still failed; returns it. */
async function rejectFailed(deps: ApprovalDeps, caller: VerifiedCaller, request: VersionRequest): Promise<LayerVersionDoc> {
    const path = FIRESTORE_PATHS.layerVersion(request.cityId, request.versionId);
    const stamp = stampOf(caller.uid, deps.clock.now());
    return deps.documents.transaction(async (transaction) => {
        const version = await transaction.get(path, layerVersionReadSchema);
        if (version?.state !== 'failed') {
            throw new ApiError('apiError.imagery.versionState');
        }
        await markJobDismissed(transaction, FIRESTORE_PATHS.job(request.cityId, version.jobId), stamp);
        await transaction.set(path, layerVersionDocSchema, { ...version, state: 'rejected', ...stamp });
        return version;
    });
}

/** A failed version, dismissed: only its own scene is released, and its scratch files go. */
async function dismissFailed(deps: RejectDeps, caller: VerifiedCaller, request: VersionRequest): Promise<void> {
    const version = await rejectFailed(deps, caller, request);
    if (version.source?.kind === 'usgs') {
        await releaseScene(deps, request.cityId, version.source.entityId, version.layerId);
    }
    await deleteWorkFiles(deps, request.cityId, version.jobId);
    await deleteVersionTiles(deps, request.cityId, request.versionId, version);
}

/** A waiting version: it and its job end, checked again in the transaction; its scratch files go. */
async function rejectWaiting(deps: RejectDeps, caller: VerifiedCaller, request: VersionRequest): Promise<void> {
    const version = await requireRejectable(deps, request);
    const ending = { status: 'cancelled', versionState: 'rejected', by: caller.uid, accept: rejectable } as const;
    if (!(await endWork(deps, request.cityId, version.jobId, ending))) {
        throw new ApiError('apiError.imagery.versionState');
    }
    await deleteWorkFiles(deps, request.cityId, version.jobId);
    await deleteVersionTiles(deps, request.cityId, request.versionId, version);
}

async function imageryReject(
    deps: RejectDeps,
    caller: VerifiedCaller,
    request: VersionRequest,
): Promise<CallableResponse<'imagery.reject'>> {
    const current = await requireVersion(deps.documents, request.cityId, request.versionId, layerVersionReadSchema);
    await refuseHeldPart(deps.documents, request.cityId, current);
    await (current.state === 'failed' ? dismissFailed(deps, caller, request) : rejectWaiting(deps, caller, request));
    deps.log.info('layer version rejected', { uid: caller.uid, cityId: request.cityId, versionId: request.versionId, was: current.state });
    return { state: 'rejected' };
}

/** The `imagery-approve` callable. */
export function approveFunction(getDeps: () => ApprovalDeps & CallableDeps) {
    return defineCallable('imagery.approve', imageryApprove, getDeps);
}

/** The `imagery-reject` callable. */
export function rejectFunction(getDeps: () => RejectDeps & CallableDeps) {
    return defineCallable('imagery.reject', imageryReject, getDeps);
}
