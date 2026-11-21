import '../global-options.js';

import {
    FIRESTORE_PATHS,
    jobDocSchema,
    layerDocSchema,
    layerVersionDocSchema,
    relayoutable,
    type CallableRequest,
    type CallableResponse,
    type HelpItem,
    type JobDoc,
    type LayerDoc,
    type LayerVersionDoc,
} from '@hcm/shared';

import type { VerifiedCaller } from '../api/access.js';
import { ApiError } from '../api/api-error.js';
import { defineCallable, type CallableDeps } from '../api/callable.js';
import { omit } from '../api/objects.js';
import type { DocumentTransaction } from '../ports/documents.js';
import { refuseBusyLayer, refuseWhileGuardRed } from './limits.js';
import { pickDefined, stampOf } from './records.js';
import type { RegeorefDeps } from './regeoref.js';
import { createWork, jobIdFor, type NewWork } from './versions.js';

/**
 * `imagery.relayout` (a city editor; `docs/research/M20-import-local.md` §19.13, S-A-HAPPY-FIX-TILES): **Fix the tiles**. Live
 * 2026-11-21: the 1:500 of 1960-71 was published with gaps, sheets 80-300 m off and two turned, and once published nothing reopened it
 * (the tile wizard said it no longer waited). An archive series on the map or waiting for approval gets a **new version of the same
 * layer** whose job asks `relayout`: its `place` lays the sheets out again and waits for the owner in the tile wizard (`layout-check`),
 * seeded with the owner's earlier layout when there was one (`help.layoutAnswer`, as a preview). The version on the map stays there
 * until the new one is approved: nothing is unpublished and no layer deletion is asked. A base still waiting for approval ends,
 * cancelled, as a new rendition replaces it (`regeoref.ts`). The base's pairs are not carried: they name pixels of the old mosaic. The
 * job runs where the archive's files are (`runOn: 'local'`, as the import's).
 */
type Request = CallableRequest<'imagery.relayout'>;
type Response = CallableResponse<'imagery.relayout'>;

/** The new version's `help`: the owner's earlier layout again, as a preview to check; none when the layout was never answered. */
export function seededHelp(base: LayerVersionDoc, uid: string, at: HelpItem['at']): HelpItem | undefined {
    const help = base.help;
    const answer = help?.layoutAnswer;
    if (help === undefined || answer === undefined) {
        return undefined;
    }
    const layoutAnswer = { ...omit(answer, ['accepted']), preview: true, by: uid, at };
    return { ...omit(help, ['stitched']), layoutAnswer };
}

/** What the new version starts with: the base's label, year, source, rights and reference, the seeded help; no pairs, no scan. */
function fieldsOf(base: LayerVersionDoc, help: HelpItem | undefined): Parameters<typeof createWork>[2] {
    return {
        origin: 'archive',
        basedOn: base.jobId,
        label: base.label,
        year: base.year,
        ...pickDefined(base, ['source', 'date', 'reference', 'rights']),
        ...(help === undefined ? {} : { help }),
    };
}

/** An archive series on the map or waiting for approval with its own job, else `apiError.imagery.versionState`. */
function requireRelayoutable(version: LayerVersionDoc | undefined, job: JobDoc | undefined): [LayerVersionDoc, JobDoc] {
    if (version === undefined || job?.type !== 'archive-series' || !relayoutable(version)) {
        throw new ApiError('apiError.imagery.versionState');
    }
    return [version, job];
}

/** The base and its job, read in the transaction (a base approved or replaced meanwhile refuses). */
async function readBase(transaction: DocumentTransaction, cityId: string, versionId: string): Promise<[LayerVersionDoc, JobDoc]> {
    const version = await transaction.get(FIRESTORE_PATHS.layerVersion(cityId, versionId), layerVersionDocSchema);
    const job = await transaction.get(FIRESTORE_PATHS.job(cityId, versionId), jobDocSchema);
    return requireRelayoutable(version, job);
}

/** A base waiting for approval ends, cancelled: the new version replaces it (the version on the map, if any, stays). */
async function endWaitingBase(transaction: DocumentTransaction, work: NewWork, base: LayerVersionDoc, job: JobDoc): Promise<void> {
    if (base.state !== 'awaiting_approval') {
        return;
    }
    const stamp = stampOf(work.createdBy, work.now);
    const cancelled: JobDoc = { ...omit(job, ['waitReason']), status: 'cancelled', finishedAt: stamp.updatedAt, ...stamp };
    await transaction.set(FIRESTORE_PATHS.job(work.cityId, base.jobId), jobDocSchema, cancelled);
    await transaction.set(FIRESTORE_PATHS.layerVersion(work.cityId, base.jobId), layerVersionDocSchema, {
        ...base,
        state: 'cancelled',
        ...stamp,
    });
}

/** The layer, read again: another version on its way to it refuses (`apiError.layers.busy`). */
async function freeLayer(transaction: DocumentTransaction, cityId: string, base: LayerVersionDoc): Promise<LayerDoc | undefined> {
    const layer = await transaction.get(FIRESTORE_PATHS.layer(cityId, base.layerId), layerDocSchema);
    if (layer?.pendingVersion !== undefined && layer.pendingVersion !== base.jobId) {
        throw new ApiError('apiError.layers.busy');
    }
    return layer;
}

/** The layer (when it exists) shows the new version as pending; its published version stays on the map. */
async function markPending(transaction: DocumentTransaction, work: NewWork, layer: LayerDoc | undefined): Promise<void> {
    if (layer !== undefined) {
        const path = FIRESTORE_PATHS.layer(work.cityId, work.layerId);
        await transaction.set(path, layerDocSchema, { ...layer, pendingVersion: work.jobId, ...stampOf(work.createdBy, work.now) });
    }
}

/** The new work for the base: an `archive-series` job on the base's layer that asks `relayout`, on the owner's computer. */
function workFor(base: LayerVersionDoc, job: JobDoc, ask: { cityId: string; uid: string; now: Date }): NewWork {
    const { cityId, uid, now } = ask;
    return {
        cityId,
        jobId: jobIdFor('ar', now, base.layerId),
        type: 'archive-series',
        params: { ...omit(job.params, ['restitch']), relayout: true },
        layerId: base.layerId,
        createdBy: uid,
        now,
        runOn: 'local',
        localOnly: true,
        waitReason: 'worker',
    };
}

/** Every read first (the base, its job, the layer), then the writes: the new work, the layer's mark, a waiting base ended. */
async function relayoutIn(transaction: DocumentTransaction, request: Request, uid: string, now: Date): Promise<string> {
    const [base, job] = await readBase(transaction, request.cityId, request.versionId);
    const layer = await freeLayer(transaction, request.cityId, base);
    const work = workFor(base, job, { cityId: request.cityId, uid, now });
    await createWork(transaction, work, fieldsOf(base, seededHelp(base, uid, stampOf(uid, now).updatedAt)));
    await markPending(transaction, work, layer);
    await endWaitingBase(transaction, work, base, job);
    return work.jobId;
}

async function imageryRelayout(deps: RegeorefDeps, caller: VerifiedCaller, request: Request): Promise<Response> {
    const { cityId, versionId } = request;
    const [base] = requireRelayoutable(
        await deps.documents.get(FIRESTORE_PATHS.layerVersion(cityId, versionId), layerVersionDocSchema),
        await deps.documents.get(FIRESTORE_PATHS.job(cityId, versionId), jobDocSchema),
    );
    await refuseWhileGuardRed(deps.documents);
    await refuseBusyLayer(deps.documents, cityId, base.layerId, base.state === 'awaiting_approval' ? base.jobId : undefined);
    const jobId = await deps.documents.transaction((transaction) => relayoutIn(transaction, request, caller.uid, deps.clock.now()));
    deps.log.info('archive series reopened at its tile layout', { uid: caller.uid, cityId, basedOn: versionId, jobId });
    return { jobId, versionId: jobId };
}

/** The `imagery-relayout` callable. */
export function relayoutFunction(getDeps: () => RegeorefDeps & CallableDeps) {
    return defineCallable('imagery.relayout', imageryRelayout, getDeps);
}
