/**
 * The one transaction of `imagery.join` (`docs/research/M8-join-interfaces.md` §5), all reads first: a live join awaiting
 * approval that shares a frame is rejected (this is how "add a frame" works; its frames and scenes stay, so nothing is downloaded
 * again), a live join in any other state refuses; the missing frames are imported with `partOf`, the existing ones stamped; the
 * join's job is created waiting for its frames, so nothing can claim it before the dispatcher saw them ready.
 */
import {
    FIRESTORE_PATHS,
    jobDocSchema,
    layerDocSchema,
    layerVersionDocSchema,
    type JobDoc,
    type LayerDoc,
    type LayerJoinParams,
    type LayerVersionDoc,
    type Sensor,
    type UsgsSceneDoc,
} from '@hcm/shared';

import { ApiError } from '../api/api-error.js';
import { omit } from '../api/objects.js';
import type { DocumentTransaction } from '../ports/documents.js';
import { importWork, readFreeScene, writeImport } from './import.js';
import { heldPart, isUsablePart, liveJoinOf } from './join-parts.js';
import { pickDefined, stampOf, type Stamp } from './records.js';
import { createWork, type NewWork } from './versions.js';

/** One frame of the new join: its version and layer, existing or about to be imported. */
export interface JoinFrame {
    readonly scene: UsgsSceneDoc;
    readonly versionId: string;
    readonly layerId: string;
    readonly isNew: boolean;
}

/** Everything the transaction needs, ids reserved. */
export interface JoinPlan {
    readonly cityId: string;
    readonly jobId: string;
    readonly layerId: string;
    /** The join is a new version of an existing frame's layer. */
    readonly joinsLayer: boolean;
    readonly frames: readonly JoinFrame[];
    readonly label: LayerVersionDoc['label'];
    readonly year: number;
    readonly date: string;
    readonly sensor: Sensor;
    readonly by: string;
    readonly now: Date;
    /** Where its jobs run when the city's choice is `local` (`Placement`, `docs/research/M7-local-worker.md` §4.5). */
    readonly runOn?: 'local';
}

/** A live join that shares a frame and gives way to the new one. */
interface Replaced {
    readonly job: JobDoc;
    readonly version: LayerVersionDoc;
    readonly layer: LayerDoc | undefined;
}

/** What the transaction read before its first write. */
interface Read {
    readonly fresh: readonly (readonly [JoinFrame, UsgsSceneDoc])[];
    readonly parts: readonly (readonly [JoinFrame, LayerVersionDoc])[];
    readonly replaced: ReadonlyMap<string, Replaced>;
    readonly layer: LayerDoc | undefined;
}

/**
 * The frame's version, still one a join may take. Batch 4 (§5.1): the policy may have approved a frame since the callable looked; it then
 * goes public alone, and its layer is retired when the join publishes (`finalize-join.ts`), so only a version that ended refuses.
 */
async function readPart(transaction: DocumentTransaction, plan: JoinPlan, frame: JoinFrame): Promise<LayerVersionDoc> {
    const part = await transaction.get(FIRESTORE_PATHS.layerVersion(plan.cityId, frame.versionId), layerVersionDocSchema);
    if (part === undefined || !isUsablePart(part)) {
        throw new ApiError('apiError.imagery.joinPartGone', { frame: frame.scene.entityId });
    }
    return part;
}

/** The live join that holds `part`, read with what rejecting it writes; only one still awaiting approval may be replaced. */
async function readReplaced(transaction: DocumentTransaction, cityId: string, part: LayerVersionDoc): Promise<Replaced | undefined> {
    const join = await liveJoinOf(transaction, cityId, part);
    if (join === undefined) {
        return undefined;
    }
    const job = await transaction.get(FIRESTORE_PATHS.job(cityId, join.jobId), jobDocSchema);
    if (join.state !== 'awaiting_approval' || job?.status !== 'awaiting_approval') {
        throw heldPart(part);
    }
    return { job, version: join, layer: await transaction.get(FIRESTORE_PATHS.layer(cityId, join.layerId), layerDocSchema) };
}

async function readAllReplaced(
    transaction: DocumentTransaction,
    cityId: string,
    parts: readonly LayerVersionDoc[],
): Promise<ReadonlyMap<string, Replaced>> {
    const replaced = new Map<string, Replaced>();
    for (const part of parts) {
        const join = await readReplaced(transaction, cityId, part);
        if (join !== undefined) {
            replaced.set(join.version.jobId, join);
        }
    }
    return replaced;
}

/** The join's layer when it joins one: no other version may be on its way to it. */
async function readFreeLayer(
    transaction: DocumentTransaction,
    plan: JoinPlan,
    replaced: ReadonlyMap<string, Replaced>,
): Promise<LayerDoc | undefined> {
    const layer = plan.joinsLayer ? await transaction.get(FIRESTORE_PATHS.layer(plan.cityId, plan.layerId), layerDocSchema) : undefined;
    if (layer?.pendingVersion !== undefined && !replaced.has(layer.pendingVersion)) {
        throw new ApiError('apiError.imagery.joinLayerBusy');
    }
    return layer;
}

async function readAll(transaction: DocumentTransaction, plan: JoinPlan): Promise<Read> {
    const fresh: (readonly [JoinFrame, UsgsSceneDoc])[] = [];
    const parts: (readonly [JoinFrame, LayerVersionDoc])[] = [];
    for (const frame of plan.frames) {
        if (frame.isNew) {
            fresh.push([frame, await readFreeScene(transaction, plan.cityId, frame.scene.entityId)]);
        } else {
            parts.push([frame, await readPart(transaction, plan, frame)]);
        }
    }
    const replaced = await readAllReplaced(
        transaction,
        plan.cityId,
        parts.map(([, part]) => part),
    );
    return { fresh, parts, replaced, layer: await readFreeLayer(transaction, plan, replaced) };
}

/** The replaced join ends rejected and its job cancelled; the layer stops showing it as pending. */
async function rejectReplaced(transaction: DocumentTransaction, cityId: string, { job, version, layer }: Replaced, stamp: Stamp) {
    const cancelled: JobDoc = {
        ...omit(job, ['waitReason', 'lease', 'error']),
        status: 'cancelled',
        finishedAt: stamp.updatedAt,
        ...stamp,
    };
    await transaction.set(FIRESTORE_PATHS.job(cityId, version.jobId), jobDocSchema, cancelled);
    await transaction.set(FIRESTORE_PATHS.layerVersion(cityId, version.jobId), layerVersionDocSchema, {
        ...omit(version, ['error']),
        state: 'rejected',
        ...stamp,
    });
    if (layer?.pendingVersion === version.jobId) {
        await transaction.set(FIRESTORE_PATHS.layer(cityId, version.layerId), layerDocSchema, {
            ...omit(layer, ['pendingVersion']),
            ...stamp,
        });
    }
}

/** The new join's version fields: a source of every frame, in the job's order. */
function sourceOf(plan: JoinPlan): NonNullable<LayerVersionDoc['source']> {
    return {
        kind: 'join',
        parts: plan.frames.map(({ scene, versionId, layerId }) => ({
            versionId,
            layerId,
            entityId: scene.entityId,
            dataset: scene.dataset,
            sensor: scene.sensor,
            acquisitionDate: scene.acquisitionDate,
        })),
    };
}

/** Creates the join's work in `transaction`, its frames marked; the replaced joins' ids are returned (their scratch files go). */
export async function writeJoin(transaction: DocumentTransaction, plan: JoinPlan, params: LayerJoinParams): Promise<string[]> {
    const read = await readAll(transaction, plan);
    const { cityId, jobId, by, now } = plan;
    const stamp = stampOf(by, now);
    for (const replaced of read.replaced.values()) {
        await rejectReplaced(transaction, cityId, replaced, stamp);
    }
    for (const [frame, scene] of read.fresh) {
        const start = { cityId, scene, createdBy: by, now, ...pickDefined(plan, ['runOn']) };
        await writeImport(transaction, importWork(start, frame.layerId), scene, jobId);
    }
    for (const [frame, part] of read.parts) {
        await transaction.set(FIRESTORE_PATHS.layerVersion(cityId, frame.versionId), layerVersionDocSchema, {
            ...part,
            partOf: jobId,
            ...stamp,
        });
    }
    const placed = pickDefined(plan, ['runOn']);
    const work: NewWork = {
        cityId,
        jobId,
        type: 'layer-join',
        params,
        layerId: plan.layerId,
        createdBy: by,
        now,
        waitReason: 'parts',
        ...placed,
    };
    const { label, year, date, sensor } = plan;
    await createWork(transaction, work, { origin: 'join', source: sourceOf(plan), label, year, date, sensor });
    if (read.layer !== undefined) {
        await transaction.set(FIRESTORE_PATHS.layer(cityId, plan.layerId), layerDocSchema, {
            ...read.layer,
            pendingVersion: jobId,
            ...stamp,
        });
    }
    return [...read.replaced.keys()];
}
