/**
 * M16 (`docs/research/M16-recalibrate.md` §4, §5; S-A89-*): what the approval policy's transaction does once a recalibration is rendered.
 *
 * - **Its figures** compare it with the version it is `basedOn`. They say something about what Approve would replace only when that is the
 *   layer's published version (or the layer has none yet); otherwise they are dropped and the version reads `unmeasured`, so Approve asks
 *   for the owner's choice (`againstCurrent`, also read by `approve.ts`). A refine of a version that was itself waiting never launders a
 *   fit that would have needed `acceptWorse`.
 * - **The version it `replaces`**: a refine of a version waiting for approval leaves that version, and the layer's pending mark, where they
 *   are while it runs, because it may decline. Once rendered, the version it replaces (only its own `basedOn`, on the same layer: the
 *   worker never writes `replaces`, `step-update.ts`), still waiting with its job, ends cancelled, and the layer shows the new one as
 *   pending. A version approved meanwhile is left as it is: it publishes, and its finalize leaves the mark to the new one (`finalize.ts`).
 */
import {
    FIRESTORE_PATHS,
    jobDocSchema,
    layerDocSchema,
    layerVersionDocSchema,
    type JobDoc,
    type LayerDoc,
    type LayerVersionDoc,
} from '@hcm/shared';

import { omit } from '../api/objects.js';
import type { DocumentTransaction } from '../ports/documents.js';
import { IMAGERY_WRITER, stampOf, type Stamp } from './records.js';

/** True when a recalibration's figures measure against what Approve replaces: the layer's published version, or nothing yet. */
export function againstCurrent(version: LayerVersionDoc, layer: LayerDoc | undefined): boolean {
    return layer?.currentVersion === undefined || layer.currentVersion === version.basedOn;
}

/** The version as the policy records it: its figures kept only when they measure against the layer's published version. */
function honest(version: LayerVersionDoc, layer: LayerDoc | undefined): LayerVersionDoc {
    const { recalibration } = version;
    if (recalibration === undefined || againstCurrent(version, layer)) {
        return version;
    }
    return { ...version, recalibration: omit(recalibration, ['before', 'after']) };
}

interface Replaced {
    readonly id: string;
    readonly version: LayerVersionDoc | undefined;
    readonly job: JobDoc | undefined;
    /** The rendered recalibration that replaces it. */
    readonly next: LayerVersionDoc;
}

/** The version this one replaces: only its own base, never another the document names. */
function replacedOf(version: LayerVersionDoc): string | undefined {
    const id = version.recalibration?.replaces;
    return id !== undefined && id === version.basedOn ? id : undefined;
}

async function readReplaced(transaction: DocumentTransaction, cityId: string, id: string, next: LayerVersionDoc): Promise<Replaced> {
    const version = await transaction.get(FIRESTORE_PATHS.layerVersion(cityId, id), layerVersionDocSchema);
    const job = await transaction.get(FIRESTORE_PATHS.job(cityId, id), jobDocSchema);
    return { id, version, job, next };
}

function bothWaiting(version: LayerVersionDoc, job: JobDoc): boolean {
    return version.state === 'awaiting_approval' && job.status === 'awaiting_approval';
}

/** The replaced version and its job, when the version is on the new one's layer and both still wait for approval. */
function waitingPair({ version, job, next }: Replaced): { readonly version: LayerVersionDoc; readonly job: JobDoc } | undefined {
    if (version?.layerId !== next.layerId || job === undefined) {
        return undefined;
    }
    return bothWaiting(version, job) ? { version, job } : undefined;
}

/** The replaced version and its job, both still waiting for approval on the same layer, end cancelled. */
async function cancelWaiting(transaction: DocumentTransaction, cityId: string, replaced: Replaced, stamp: Stamp): Promise<void> {
    const waiting = waitingPair(replaced);
    if (waiting === undefined) {
        return;
    }
    const { version, job } = waiting;
    const cancelled: JobDoc = { ...omit(job, ['waitReason']), status: 'cancelled', finishedAt: stamp.updatedAt, ...stamp };
    await transaction.set(FIRESTORE_PATHS.job(cityId, replaced.id), jobDocSchema, cancelled);
    await transaction.set(FIRESTORE_PATHS.layerVersion(cityId, replaced.id), layerVersionDocSchema, {
        ...version,
        state: 'cancelled',
        ...stamp,
    });
}

/** The layer, when it exists and no other version is on its way to it, shows the new version as pending. */
async function markPending(
    transaction: DocumentTransaction,
    cityId: string,
    replaced: Replaced & { readonly layer: LayerDoc | undefined },
    stamp: Stamp,
): Promise<void> {
    const { layer, next } = replaced;
    const free = layer?.pendingVersion === undefined || layer.pendingVersion === replaced.id;
    if (layer !== undefined && free) {
        await transaction.set(FIRESTORE_PATHS.layer(cityId, next.layerId), layerDocSchema, {
            ...layer,
            pendingVersion: next.jobId,
            ...stamp,
        });
    }
}

/**
 * A rendered recalibration in the policy's transaction: replaces its waiting base, if any, and returns the version to record (its figures
 * kept only against the layer's published version). Every read comes before the first write; any other version is returned as it is.
 */
export async function replaceWaitingBase(
    transaction: DocumentTransaction,
    cityId: string,
    version: LayerVersionDoc,
    now: Date,
): Promise<LayerVersionDoc> {
    if (version.recalibration === undefined) {
        return version;
    }
    const layer = await transaction.get(FIRESTORE_PATHS.layer(cityId, version.layerId), layerDocSchema);
    const id = replacedOf(version);
    if (id !== undefined) {
        const replaced = await readReplaced(transaction, cityId, id, version);
        const stamp = stampOf(IMAGERY_WRITER, now);
        await cancelWaiting(transaction, cityId, replaced, stamp);
        await markPending(transaction, cityId, { ...replaced, layer }, stamp);
    }
    return honest(version, layer);
}
