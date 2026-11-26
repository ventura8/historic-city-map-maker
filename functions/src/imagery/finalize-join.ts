/**
 * What a published join does to its frames (`docs/research/M8-join-interfaces.md` §5), inside `finalizeVersion`'s transaction,
 * reads first: a frame still waiting for approval becomes `joined` and its job `succeeded` (its files stay for the layer:
 * `tick-maintenance.ts`, `layer-delete.ts`), and every frame's scene now holds the join's layer, or `releaseScenes` would free
 * it. A frame already published on the join's own layer is its previous version, which `supersede` handles. Batch 4
 * (`docs/research/M8-join-interfaces.md` §5.1): a frame published as a layer of its own retires that layer: it leaves the manifest
 * (`published: false`) with `retired` naming the join, its tiles and versions kept (the history trigger records the change); a frame
 * that publishes alone after its join did gets the same (`retiredByJoin`).
 */
import {
    FIRESTORE_PATHS,
    jobDocSchema,
    layerDocSchema,
    layerVersionDocSchema,
    usgsSceneDocSchema,
    type JobDoc,
    type JoinPart,
    type LayerDoc,
    type LayerVersionDoc,
    type UsgsSceneDoc,
} from '@hcm/shared';

import { omit } from '../api/objects.js';
import type { DocumentTransaction } from '../ports/documents.js';
import type { Stamp } from './records.js';

/** One frame of a join, as its transaction read it. */
export interface JoinFrame {
    readonly cityId: string;
    readonly part: JoinPart;
    readonly version: LayerVersionDoc | undefined;
    readonly job: JobDoc | undefined;
    readonly scene: UsgsSceneDoc | undefined;
    /** The frame's own layer, when it is not the join's: retired by the publish. */
    readonly layer: LayerDoc | undefined;
}

type Apply = (transaction: DocumentTransaction) => Promise<void>;

async function readFrame(transaction: DocumentTransaction, cityId: string, part: JoinPart, layerId: string): Promise<JoinFrame> {
    return {
        cityId,
        part,
        version: await transaction.get(FIRESTORE_PATHS.layerVersion(cityId, part.versionId), layerVersionDocSchema),
        job: await transaction.get(FIRESTORE_PATHS.job(cityId, part.versionId), jobDocSchema),
        scene: await transaction.get(FIRESTORE_PATHS.usgsScene(cityId, part.entityId), usgsSceneDocSchema),
        layer: part.layerId === layerId ? undefined : await transaction.get(FIRESTORE_PATHS.layer(cityId, part.layerId), layerDocSchema),
    };
}

/** Every frame of `version` when it is a join, read one after the other in the transaction; none for any other version. */
export async function readJoinFrames(transaction: DocumentTransaction, cityId: string, version: LayerVersionDoc): Promise<JoinFrame[]> {
    const frames: JoinFrame[] = [];
    for (const part of version.source?.kind === 'join' ? version.source.parts : []) {
        frames.push(await readFrame(transaction, cityId, part, version.layerId));
    }
    return frames;
}

function versionWrite({ cityId, part, version }: JoinFrame, stamp: Stamp): Apply | undefined {
    if (version?.state !== 'awaiting_approval' || version.output === undefined) {
        return undefined;
    }
    return (transaction) =>
        transaction.set(FIRESTORE_PATHS.layerVersion(cityId, part.versionId), layerVersionDocSchema, {
            ...version,
            state: 'joined',
            ...stamp,
        });
}

function jobWrite({ cityId, part, job }: JoinFrame, stamp: Stamp): Apply | undefined {
    if (job?.status !== 'awaiting_approval') {
        return undefined;
    }
    const succeeded: JobDoc = {
        ...omit(job, ['waitReason', 'error', 'lease']),
        status: 'succeeded',
        finishedAt: stamp.updatedAt,
        ...stamp,
    };
    return (transaction) => transaction.set(FIRESTORE_PATHS.job(cityId, part.versionId), jobDocSchema, succeeded);
}

function sceneWrite({ cityId, part, scene }: JoinFrame, layerId: string, stamp: Stamp): Apply | undefined {
    if (scene === undefined) {
        return undefined;
    }
    return (transaction) =>
        transaction.set(FIRESTORE_PATHS.usgsScene(cityId, part.entityId), usgsSceneDocSchema, {
            ...scene,
            status: 'imported',
            layerId,
            ...stamp,
        });
}

/** A layer the join `joinId` replaces: off the public map, with the join named; one already retired stays as it is. */
export function retiredLayer(layer: LayerDoc, joinId: string | undefined, stamp: Stamp): LayerDoc {
    if (joinId === undefined || layer.retired !== undefined) {
        return layer;
    }
    return { ...layer, published: false, retired: { by: joinId, at: stamp.updatedAt }, ...stamp };
}

function layerWrite({ cityId, part, layer }: JoinFrame, joinId: string, stamp: Stamp): Apply | undefined {
    if (layer === undefined || layer.retired !== undefined) {
        return undefined;
    }
    return (transaction) =>
        transaction.set(FIRESTORE_PATHS.layer(cityId, part.layerId), layerDocSchema, retiredLayer(layer, joinId, stamp));
}

/** The join a frame's version belongs to; none for a join itself. */
function joinIdOf(version: LayerVersionDoc): string | undefined {
    return version.source?.kind === 'join' ? undefined : version.partOf;
}

/** The join is published, as a layer other than the frame's own. */
function replaces(join: LayerVersionDoc | undefined, version: LayerVersionDoc): boolean {
    return join?.state === 'published' && join.layerId !== version.layerId;
}

/** The join a frame publishing alone was joined by, once that join is published as another layer: its layer is born retired. */
export async function retiredByJoin(
    transaction: DocumentTransaction,
    cityId: string,
    version: LayerVersionDoc,
): Promise<string | undefined> {
    const joinId = joinIdOf(version);
    if (joinId === undefined) {
        return undefined;
    }
    const join = await transaction.get(FIRESTORE_PATHS.layerVersion(cityId, joinId), layerVersionDocSchema);
    return replaces(join, version) ? joinId : undefined;
}

/** The writes for `frames` of the join `joinId` published as layer `layerId`. */
export function joinFrameWrites(frames: readonly JoinFrame[], layerId: string, joinId: string, stamp: Stamp): (Apply | undefined)[] {
    return frames.flatMap((frame) => [
        versionWrite(frame, stamp),
        jobWrite(frame, stamp),
        sceneWrite(frame, layerId, stamp),
        layerWrite(frame, joinId, stamp),
    ]);
}
