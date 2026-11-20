/**
 * `imagery.join` with `versionIds` (finding of 2026-11-14, the owner's harti.zip maps; `docs/research/M8-join-interfaces.md` §11):
 * archive maps that are parts of one map (the n and S halves of 1978, 1974-01 and -02, a set's sheets) become one layer. Each part
 * keeps its own fit: the `layer-join` job measures the seams on their overlap and moves nothing (`maxzoom` in its parameters, no
 * camera), and fails with `apiError.imagery.joinMapsApart` when a part meets none of the others. Every check comes before anything
 * is written: each part is an archive map with a scan and points of its own (`joinNeedsPoints`), usable (published, approved or
 * awaiting approval), one per map (`joinSameLayer`), and held by no live join. The join is a new version of the first published
 * part's layer, so its tileset and presentation stay; the other parts' layers retire when it publishes (`finalize-join.ts`).
 * Approval works as for any version.
 */
import {
    FIRESTORE_PATHS,
    jobDocSchema,
    layerDocSchema,
    layerVersionDocSchema,
    type CallableResponse,
    type JoinPart,
    type LayerDoc,
    type LayerJoinParams,
    type LayerVersionDoc,
} from '@hcm/shared';

import type { VerifiedCaller } from '../api/access.js';
import { ApiError } from '../api/api-error.js';
import type { DocumentTransaction } from '../ports/documents.js';
import type { Ports } from '../ports/index.js';
import { asJoinLayerBusy } from './join-busy.js';
import { isUsablePart, refuseHeldPart } from './join-parts.js';
import { refuseBusyLayer, refuseRasterJobs, type Placement } from './limits.js';
import { requireCity, requireVersion, stampOf } from './records.js';
import { createWork, jobIdFor, reserveLayerIds, type NewWork } from './versions.js';

/** The zoom an archive join renders to when no part says its own (the archive import's default). */
const DEFAULT_MAXZOOM = 17;
const MIN_ZOOM = 10;
const MAX_ZOOM = 22;

/** What the archive maps' join reads and writes. */
export type ArchiveJoinDeps = Pick<Ports, 'documents' | 'clock' | 'log'>;

/** An archive join's request. */
export interface ArchiveJoinRequest {
    readonly cityId: string;
    readonly versionIds: readonly string[];
}

/** One part as read: its version id and document. */
interface Part {
    readonly id: string;
    readonly version: LayerVersionDoc;
}

/** The name the owner knows a map by, for the refusals. */
function nameOf(version: LayerVersionDoc): string {
    return version.label.ro;
}

/** An archive map still usable (published, approved, awaiting approval). */
function usableMap(version: LayerVersionDoc): boolean {
    return version.source?.kind === 'archive' && isUsablePart(version);
}

/** A scan with points of its own (not a file's embedded georeference): what the join warps each part with. */
function pointed(version: LayerVersionDoc): boolean {
    const method = version.georef?.method;
    return version.scan !== undefined && method !== undefined && method !== 'embedded';
}

/** A part the join can take: an archive map, usable, with a scan and its own points; else the plain refusal. */
function requirePart(version: LayerVersionDoc): void {
    if (!usableMap(version)) {
        throw new ApiError('apiError.imagery.joinPartGone', { frame: nameOf(version) });
    }
    if (!pointed(version)) {
        throw new ApiError('apiError.imagery.joinNeedsPoints', { map: nameOf(version) });
    }
}

async function readParts(deps: ArchiveJoinDeps, request: ArchiveJoinRequest): Promise<Part[]> {
    const ids = [...new Set(request.versionIds)];
    if (ids.length < 2) {
        throw new ApiError('apiError.invalidRequest', undefined, [{ path: 'versionIds', code: 'validation.value' }]);
    }
    const parts: Part[] = [];
    for (const id of ids) {
        const version = await requireVersion(deps.documents, request.cityId, id);
        requirePart(version);
        await refuseHeldPart(deps.documents, request.cityId, version);
        parts.push({ id, version });
    }
    if (new Set(parts.map(({ version }) => version.layerId)).size < parts.length) {
        throw new ApiError('apiError.imagery.joinSameLayer');
    }
    return parts;
}

/** The parts' own largest zoom, within what a join renders. */
export function maxzoomOf(parts: readonly { readonly version: Pick<LayerVersionDoc, 'output'> }[]): number {
    const zooms = parts.flatMap(({ version }) => (version.output === undefined ? [] : [version.output.maxzoom]));
    const zoom = zooms.length === 0 ? DEFAULT_MAXZOOM : Math.max(...zooms);
    return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/** Two labels or more as one: "N + S". */
function labelOf(parts: readonly Part[]): LayerVersionDoc['label'] {
    const ro = parts.map(({ version }) => version.label.ro).join(' + ');
    const english = parts.map(({ version }) => version.label.en ?? version.label.ro).join(' + ');
    return { ro, en: english };
}

/** The part whose layer the join becomes a new version of: the first published, else none (a new layer). */
function publishedPart(parts: readonly Part[]): Part | undefined {
    return parts.find(({ version }) => version.state === 'published');
}

function sourceOf(parts: readonly Part[]): NonNullable<LayerVersionDoc['source']> {
    const joined: JoinPart[] = parts.map(({ id, version }) => ({ versionId: id, layerId: version.layerId, entityId: id }));
    return { kind: 'join', parts: joined };
}

interface Plan {
    readonly cityId: string;
    readonly jobId: string;
    readonly layerId: string;
    readonly joinsLayer: boolean;
    readonly parts: readonly Part[];
    readonly by: string;
    readonly now: Date;
    readonly placement: Placement;
}

/** A run that ended (failed or cancelled) holds its layer no more, whatever stamp it left (lesson 739). */
const ENDED_RUNS: ReadonlySet<string> = new Set(['failed', 'cancelled']);

/** The layer's pending version is a run still on its way (a version with no job of its own counts as one). */
async function stillPending(transaction: DocumentTransaction, cityId: string, pending: string): Promise<boolean> {
    const job = await transaction.get(FIRESTORE_PATHS.job(cityId, pending), jobDocSchema);
    return job === undefined || !ENDED_RUNS.has(job.status);
}

/** The join's layer when it joins a published one: no other version may be on its way to it. */
async function readFreeLayer(transaction: DocumentTransaction, plan: Plan): Promise<LayerDoc | undefined> {
    const layer = plan.joinsLayer ? await transaction.get(FIRESTORE_PATHS.layer(plan.cityId, plan.layerId), layerDocSchema) : undefined;
    if (layer?.pendingVersion !== undefined && (await stillPending(transaction, plan.cityId, layer.pendingVersion))) {
        throw new ApiError('apiError.imagery.joinLayerBusy');
    }
    return layer;
}

/** The join's own work: its `layer-join` job born waiting for its parts, and its version. */
function workOf(plan: Plan): NewWork {
    const { cityId, jobId, parts, by, now } = plan;
    const params: LayerJoinParams = {
        parts: parts.map(({ id, version }) => ({ versionId: id, layerId: version.layerId })),
        maxzoom: maxzoomOf(parts),
    };
    return { cityId, jobId, type: 'layer-join', params, layerId: plan.layerId, createdBy: by, now, waitReason: 'parts', ...plan.placement };
}

/** The join's job and version, its parts stamped `partOf` and its layer's pending version, in one transaction. */
async function writeIn(transaction: DocumentTransaction, plan: Plan): Promise<void> {
    const { cityId, jobId, parts } = plan;
    const layer = await readFreeLayer(transaction, plan);
    const stamp = stampOf(plan.by, plan.now);
    for (const { id, version } of parts) {
        await transaction.set(FIRESTORE_PATHS.layerVersion(cityId, id), layerVersionDocSchema, { ...version, partOf: jobId, ...stamp });
    }
    const year = parts[0]?.version.year ?? plan.now.getUTCFullYear();
    await createWork(transaction, workOf(plan), { origin: 'join', source: sourceOf(parts), label: labelOf(parts), year });
    if (layer !== undefined) {
        await transaction.set(FIRESTORE_PATHS.layer(cityId, plan.layerId), layerDocSchema, { ...layer, pendingVersion: jobId, ...stamp });
    }
}

/** A busy published layer refuses in the join's own words (`apiError.imagery.joinLayerBusy`). */
async function requireFreeLayer(deps: ArchiveJoinDeps, cityId: string, published: Part | undefined): Promise<void> {
    if (published === undefined) {
        return;
    }
    await refuseBusyLayer(deps.documents, cityId, published.version.layerId).catch(asJoinLayerBusy);
}

/** The published part's layer, else a new one named after the parts. */
async function layerFor(deps: ArchiveJoinDeps, cityId: string, parts: readonly Part[], published: Part | undefined): Promise<string> {
    return published?.version.layerId ?? (await reserveLayerIds(deps.documents, cityId))(labelOf(parts).ro);
}

/** The archive maps' join: every check, then one transaction. */
export async function joinArchive(
    deps: ArchiveJoinDeps,
    caller: VerifiedCaller,
    request: ArchiveJoinRequest,
): Promise<CallableResponse<'imagery.join'>> {
    await requireCity(deps.documents, request.cityId);
    const parts = await readParts(deps, request);
    const now = deps.clock.now();
    const placement = await refuseRasterJobs(deps.documents, now, request.cityId, 1);
    const published = publishedPart(parts);
    await requireFreeLayer(deps, request.cityId, published);
    const layerId = await layerFor(deps, request.cityId, parts, published);
    const jobId = jobIdFor('jn', now, parts[0]?.version.layerId ?? 'archive');
    const plan: Plan = {
        cityId: request.cityId,
        jobId,
        layerId,
        joinsLayer: published !== undefined,
        parts,
        by: caller.uid,
        now,
        placement,
    };
    await deps.documents.transaction((transaction) => writeIn(transaction, plan));
    deps.log.info('archive maps joined', { uid: caller.uid, cityId: request.cityId, jobId, layerId, parts: parts.length });
    return { jobId, versionId: jobId, layerId };
}
