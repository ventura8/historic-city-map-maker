/**
 * The frames of a join (`docs/research/M8-join-interfaces.md` §5): whether a live join holds a frame, whether a join's frames
 * are ready for its job, and which of a layer's versions a new join would take. A join that ended (rejected, failed,
 * cancelled, published) holds nothing, so a stale `partOf` is ignored: a failed join frees its frames for a fix.
 */
import {
    ENDED_VERSION_STATES,
    FIRESTORE_PATHS,
    layerJoinParamsSchema,
    layerVersionDocSchema,
    timestampToDate,
    validate,
    type JobDoc,
    type LayerVersionDoc,
    type LayerVersionState,
} from '@hcm/shared';

import { ApiError } from '../api/api-error.js';
import type { DocumentReader, DocumentStore, StoredDocument } from '../ports/documents.js';

const ENDED: ReadonlySet<LayerVersionState> = new Set(ENDED_VERSION_STATES);
/** The states of a frame that is, or is about to be, a layer of its own. */
export const ON_ITS_LAYER: ReadonlySet<LayerVersionState> = new Set<LayerVersionState>(['published', 'approved', 'publishing']);
/**
 * The states in which a rendered frame is ready for its join. Batch 4 (`docs/research/M8-join-interfaces.md` §5.1): a frame on its way
 * to, or on, a layer of its own serves too; that layer is retired when the join publishes (`finalize-join.ts`).
 */
const READY: ReadonlySet<LayerVersionState> = new Set<LayerVersionState>([
    'awaiting_approval',
    'approved',
    'publishing',
    'published',
    'joined',
]);
/**
 * The ended states in which a frame still serves a new join: published, or `joined` (rendered and used by an earlier join). Live
 * 2026-11-12: the 1980-07-16 join refused frame D3C1216-100235A039 because its version was `joined`, and the scene page offered no
 * Import any more, so the owner was stuck. Only rejected, superseded, failed and cancelled frames are gone.
 */
const ENDED_YET_USABLE: ReadonlySet<LayerVersionState> = new Set<LayerVersionState>(['published', 'joined']);

/** A version not ended; only such a join holds its frames. */
function isLiveJoin(join: LayerVersionDoc | undefined): join is LayerVersionDoc {
    return join !== undefined && !ENDED.has(join.state);
}

/**
 * A version a new join may still find on a frame's layer: published, a frame `joined` before, or not ended. A join that is not
 * published yet is left out: with a published frame it is that layer's newest version, and the frame is what "add a frame" takes again.
 */
export function isUsablePart(version: LayerVersionDoc): boolean {
    if (version.state === 'published') {
        return true;
    }
    const live = version.state === 'joined' || !ENDED.has(version.state);
    return live && version.source?.kind !== 'join';
}

/** The live join that holds `part`, if any. */
export async function liveJoinOf(reader: DocumentReader, cityId: string, part: LayerVersionDoc): Promise<LayerVersionDoc | undefined> {
    if (part.partOf === undefined) {
        return undefined;
    }
    const join = await reader.get(FIRESTORE_PATHS.layerVersion(cityId, part.partOf), layerVersionDocSchema);
    return isLiveJoin(join) ? join : undefined;
}

/** What the admin knows a frame by: its USGS entity, else its version's job. */
function frameName(version: LayerVersionDoc): string {
    return version.source?.kind === 'usgs' ? version.source.entityId : version.jobId;
}

/** The refusal of a change to a frame a live join holds. */
export function heldPart(part: LayerVersionDoc): ApiError {
    return new ApiError('apiError.imagery.joinPartHeld', { frame: frameName(part) });
}

/** `apiError.imagery.joinPartHeld` while a live join holds `part`: reject or cancel the join first. */
export async function refuseHeldPart(reader: DocumentReader, cityId: string, part: LayerVersionDoc): Promise<void> {
    if ((await liveJoinOf(reader, cityId, part)) !== undefined) {
        throw heldPart(part);
    }
}

/** `taken`: a newer join stamped the frame (its own refusal, `apiError.imagery.joinPartTaken`); `gone`: no usable version is left. */
export type PartsReady =
    | { readonly kind: 'go' }
    | { readonly kind: 'hold' }
    | { readonly kind: 'gone'; readonly frame: string }
    | { readonly kind: 'taken'; readonly frame: string };

export const GO: PartsReady = { kind: 'go' };
const HOLD: PartsReady = { kind: 'hold' };

/**
 * A frame that can never serve this join: its version ended (rejected, failed, cancelled, superseded). Batch 4: published, on the
 * join's layer or a layer of its own, it serves (live 2026-11-09: a frame approved while its join waited failed the join); so does a
 * frame `joined` by an earlier join (live 2026-11-12).
 */
function partGone(part: LayerVersionDoc): boolean {
    return !ENDED_YET_USABLE.has(part.state) && ENDED.has(part.state);
}

function partReady(part: LayerVersionDoc, joinId: string): PartsReady {
    if (part.partOf !== joinId) {
        return { kind: 'taken', frame: frameName(part) };
    }
    if (partGone(part)) {
        return { kind: 'gone', frame: frameName(part) };
    }
    return READY.has(part.state) && part.output !== undefined ? GO : HOLD;
}

/** A frame that can never serve the join: taken by a newer join, or without a usable version. */
export function isRefused(ready: PartsReady): ready is Extract<PartsReady, { readonly frame: string }> {
    return ready.kind === 'gone' || ready.kind === 'taken';
}

/** The refusal a frame that cannot serve its join answers: taken by a newer join, or without a usable version. */
export function partRefusal(ready: Extract<PartsReady, { readonly frame: string }>): ApiError {
    const code = ready.kind === 'taken' ? 'apiError.imagery.joinPartTaken' : 'apiError.imagery.joinPartGone';
    return new ApiError(code, { frame: ready.frame });
}

async function partStateOf(
    reader: DocumentReader,
    path: string,
    versionId: string,
    ready: (part: LayerVersionDoc) => PartsReady,
): Promise<PartsReady> {
    const part = await reader.get(path, layerVersionDocSchema);
    return part === undefined ? { kind: 'gone', frame: versionId } : ready(part);
}

/**
 * A join's frames: `go` once all are rendered and waiting, approved or published, `taken` when a newer join stamped one (a failed join
 * frees its frames, and its retry must not take them back), `gone` (naming the frame) as soon as one can no longer serve, else `hold`.
 * Parameters that do not parse name no frame the job can ever read, which is `gone` too.
 */
export async function partsReady(reader: DocumentReader, cityId: string, joinId: string, job: JobDoc): Promise<PartsReady> {
    const params = validate(layerJoinParamsSchema, job.params);
    if (!params.ok) {
        return { kind: 'gone', frame: joinId };
    }
    const states = await Promise.all(
        params.value.parts.map(({ versionId }) =>
            partStateOf(reader, FIRESTORE_PATHS.layerVersion(cityId, versionId), versionId, (part) => partReady(part, joinId)),
        ),
    );
    return states.find(isRefused) ?? states.find((state) => state.kind === 'hold') ?? GO;
}

/** The newest first. */
function newestFirst(versions: readonly StoredDocument<LayerVersionDoc>[]): StoredDocument<LayerVersionDoc>[] {
    return [...versions].sort(
        (left, right) => timestampToDate(right.data.createdAt).getTime() - timestampToDate(left.data.createdAt).getTime(),
    );
}

/** Of a layer's versions, the frame a join would take: the newest not ended, or published. */
export function usablePartIn(versions: readonly StoredDocument<LayerVersionDoc>[]): StoredDocument<LayerVersionDoc> | undefined {
    return newestFirst(versions).find((version) => isUsablePart(version.data));
}

/** The newest of a layer's versions, whatever its state. */
export function newestIn(versions: readonly StoredDocument<LayerVersionDoc>[]): StoredDocument<LayerVersionDoc> | undefined {
    return newestFirst(versions)[0];
}

/** The versions of a layer. */
export async function versionsOfLayer(documents: DocumentStore, cityId: string, layerId: string) {
    const versions = await documents.query(FIRESTORE_PATHS.layerVersions(cityId), layerVersionDocSchema, {
        where: [['layerId', '==', layerId]],
    });
    return versions.documents;
}
