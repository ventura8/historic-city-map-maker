/**
 * A new rendition of a version's scan (`docs/research/M3-interfaces.md` §4.1, §6.4; S-P02-*): new points from the
 * georeferencer, or a crop of the layer. It gets its own `regeoref` job and version on the same layer, built from the base
 * version's scan, reference, label and dates (the pipeline reads the scan, never rewrites it, and calls no USGS). The
 * layer keeps its tiles and shows the version as pending until it is published; a base that was still awaiting approval
 * is replaced (it and its job end, cancelled). The transaction that creates the new version reads the base and the layer
 * again (CR-M3-47): a base the guard sent to Mapbox meanwhile, or a layer another version took, refuses the save
 * (`apiError.imagery.versionState`, `apiError.layers.busy`) instead of cancelling what is already under way. M8: a frame a
 * live join holds gets no new rendition (`apiError.imagery.joinPartHeld`); points on a frame waiting for them continue its
 * own job (`save-gcps.ts`), which is what the join waits for. M18 item 3: it is a re-run, never counted against the day's import
 * limit; only the budget guard is asked.
 */
import {
    FINISHED_JOB_STATUSES,
    FIRESTORE_PATHS,
    jobDocSchema,
    layerDocSchema,
    layerVersionDocSchema,
    type CropRing,
    type Georef,
    type JobDoc,
    type JobStatus,
    type LayerDoc,
    type LayerVersionDoc,
    type Recalibration,
} from '@hcm/shared';

import { ApiError } from '../api/api-error.js';
import { omit } from '../api/objects.js';
import type { DocumentTransaction } from '../ports/documents.js';
import type { Ports } from '../ports/index.js';
import { refuseHeldPart } from './join-parts.js';
import { refuseBusyLayer, refuseRunningLayer, refuseWhileGuardRed } from './limits.js';
import { pickDefined, stampOf, type Stamp } from './records.js';
import { createWork, jobIdFor, type NewWork } from './versions.js';

const FINISHED: ReadonlySet<JobStatus> = new Set(FINISHED_JOB_STATUSES);

export type RegeorefDeps = Pick<Ports, 'documents' | 'clock' | 'log'>;

export interface Regeoref {
    readonly cityId: string;
    /** The version whose scan is rendered again. */
    readonly base: LayerVersionDoc;
    readonly origin: 'regeoref' | 'crop';
    readonly georef: Georef;
    readonly crop?: CropRing;
    readonly by: string;
    /**
     * M16 (`docs/research/M16-recalibrate.md` §5): a recalibration. With `replaces`, a base waiting for approval stays, with the layer's
     * pending mark, until this version is rendered (the approval policy replaces it then): a refine that declines leaves it as it was.
     */
    readonly recalibration?: Recalibration;
}

type Fields = Parameters<typeof createWork>[2];

function fieldsOf(regeoref: Regeoref): Fields {
    const { base } = regeoref;
    const crop = regeoref.crop ?? base.crop;
    return {
        origin: regeoref.origin,
        basedOn: base.jobId,
        label: base.label,
        year: base.year,
        // `partOf`: a frame a join named stays out of the approval policy with its new points (`approval.ts`).
        ...pickDefined(base, ['source', 'date', 'sensor', 'scan', 'reference', 'partOf']),
        georef: regeoref.georef,
        ...(crop === undefined ? {} : { crop }),
        ...(regeoref.recalibration === undefined ? {} : { recalibration: regeoref.recalibration }),
    };
}

/** The base still awaiting approval ends, cancelled: the new version replaces it. */
async function replaceBase(transaction: DocumentTransaction, regeoref: Regeoref, job: JobDoc, stamp: Stamp): Promise<void> {
    const { cityId, base } = regeoref;
    const cancelled: JobDoc = { ...omit(job, ['waitReason']), status: 'cancelled', finishedAt: stamp.updatedAt, ...stamp };
    await transaction.set(FIRESTORE_PATHS.job(cityId, base.jobId), jobDocSchema, cancelled);
    await transaction.set(FIRESTORE_PATHS.layerVersion(cityId, base.jobId), layerVersionDocSchema, {
        ...base,
        state: 'cancelled',
        ...stamp,
    });
}

/** The layer (when it exists already) shows the new version as pending. */
async function markPending(
    transaction: DocumentTransaction,
    regeoref: Regeoref,
    layer: LayerDoc | undefined,
    work: NewWork,
): Promise<void> {
    if (layer !== undefined) {
        const stamp = stampOf(work.createdBy, work.now);
        await transaction.set(FIRESTORE_PATHS.layer(regeoref.cityId, regeoref.base.layerId), layerDocSchema, {
            ...layer,
            pendingVersion: work.jobId,
            ...stamp,
        });
    }
}

interface AwaitingBase {
    readonly job: JobDoc;
    readonly version: LayerVersionDoc;
}

/**
 * M16 (§5): a Refine or Snap already started from the waiting base, its job unfinished, holds it (`refining`, written in the same
 * transaction that starts one): a second start or a Save is `apiError.layers.busy`. The query before (`refuseBusyLayer`) can race; this
 * read cannot, as the layer's pending mark stays on the base while a refine runs.
 */
async function refuseRefining(transaction: DocumentTransaction, cityId: string, version: LayerVersionDoc): Promise<void> {
    if (version.refining === undefined) {
        return;
    }
    const job = await transaction.get(FIRESTORE_PATHS.job(cityId, version.refining), jobDocSchema);
    if (job !== undefined && !FINISHED.has(job.status)) {
        throw new ApiError('apiError.layers.busy');
    }
}

/** The base's job, read again: still waiting for approval with its version, or the save is refused. */
async function awaitingBase(transaction: DocumentTransaction, regeoref: Regeoref): Promise<AwaitingBase> {
    const { cityId, base } = regeoref;
    const job = await transaction.get(FIRESTORE_PATHS.job(cityId, base.jobId), jobDocSchema);
    const version = await transaction.get(FIRESTORE_PATHS.layerVersion(cityId, base.jobId), layerVersionDocSchema);
    if (job?.status !== 'awaiting_approval' || version?.state !== 'awaiting_approval') {
        throw new ApiError('apiError.imagery.versionState');
    }
    await refuseRefining(transaction, cityId, version);
    return { job, version };
}

/** M16: the waiting base records the refine that will replace it once rendered, so a second start in a race is refused. */
async function markRefining(transaction: DocumentTransaction, regeoref: Regeoref, awaiting: AwaitingBase, work: NewWork): Promise<void> {
    await transaction.set(FIRESTORE_PATHS.layerVersion(regeoref.cityId, regeoref.base.jobId), layerVersionDocSchema, {
        ...awaiting.version,
        refining: work.jobId,
        ...stampOf(work.createdBy, work.now),
    });
}

/** The layer, read again: no other version may be on its way to it. */
async function freeLayer(transaction: DocumentTransaction, regeoref: Regeoref): Promise<LayerDoc | undefined> {
    const layer = await transaction.get(FIRESTORE_PATHS.layer(regeoref.cityId, regeoref.base.layerId), layerDocSchema);
    if (layer?.pendingVersion !== undefined && layer.pendingVersion !== regeoref.base.jobId) {
        throw new ApiError('apiError.layers.busy');
    }
    return layer;
}

/** A waiting base: a refine marks it and leaves it with the layer's mark (§5), any other rendition replaces it at once. */
async function settleAwaitingBase(
    transaction: DocumentTransaction,
    regeoref: Regeoref,
    awaiting: AwaitingBase,
    work: NewWork,
): Promise<boolean> {
    if (regeoref.recalibration?.replaces !== undefined) {
        await markRefining(transaction, regeoref, awaiting, work);
        return false;
    }
    await replaceBase(transaction, regeoref, awaiting.job, stampOf(work.createdBy, work.now));
    return true;
}

async function regeorefIn(transaction: DocumentTransaction, regeoref: Regeoref, work: NewWork): Promise<void> {
    const awaiting = regeoref.base.state === 'awaiting_approval' ? await awaitingBase(transaction, regeoref) : undefined;
    const layer = await freeLayer(transaction, regeoref);
    await createWork(transaction, work, fieldsOf(regeoref));
    const takesLayer = awaiting === undefined || (await settleAwaitingBase(transaction, regeoref, awaiting, work));
    if (takesLayer) {
        await markPending(transaction, regeoref, layer, work);
    }
}

/** Parameters for a regeoref job: an archive version also names its archive so only a worker holding it whole claims it. */
function paramsOf(base: LayerVersionDoc): Record<string, unknown> {
    if (base.source?.kind === 'archive' && typeof base.source.archiveId === 'string') {
        return { basedOn: base.jobId, originalArchiveId: base.source.archiveId };
    }
    return { basedOn: base.jobId };
}

/** Starts the new rendition after the creator's checks; its job id is also its version id. */
export async function startRegeoref(deps: RegeorefDeps, regeoref: Regeoref): Promise<{ jobId: string; versionId: string }> {
    const now = deps.clock.now();
    const { cityId, base } = regeoref;
    await refuseHeldPart(deps.documents, cityId, base);
    // M18 item 3: a re-run of a scan already here is not an import, so the day's limit is not asked.
    await refuseWhileGuardRed(deps.documents);
    const except = base.state === 'awaiting_approval' ? base.jobId : undefined;
    // Admin sweep 2026-11-14 (bug 1): a refine of a frame waiting for approval is not raced by another frame of the date that waits too.
    const refuse = regeoref.recalibration?.replaces === undefined ? refuseBusyLayer : refuseRunningLayer;
    await refuse(deps.documents, cityId, base.layerId, except);
    const jobId = jobIdFor(regeoref.origin === 'crop' ? 'cr' : 'rg', now, base.layerId);
    const work: NewWork = {
        cityId,
        jobId,
        type: 'regeoref',
        params: paramsOf(base),
        layerId: base.layerId,
        createdBy: regeoref.by,
        now,
    };
    await deps.documents.transaction((transaction) => regeorefIn(transaction, regeoref, work));
    deps.log.info('layer version started', { uid: regeoref.by, cityId, layerId: base.layerId, jobId, origin: regeoref.origin });
    return { jobId, versionId: jobId };
}
