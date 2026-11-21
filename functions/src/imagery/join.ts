import '../global-options.js';

import {
    FIRESTORE_PATHS,
    layerDocSchema,
    layerLabelFor,
    usgsSceneDocSchema,
    yearOfDate,
    type CallableRequest,
    type CallableResponse,
    type LayerJoinParams,
    type LayerVersionDoc,
    type UsgsSceneDoc,
} from '@hcm/shared';

import type { VerifiedCaller } from '../api/access.js';
import { ApiError } from '../api/api-error.js';
import { defineCallable, type CallableDeps } from '../api/callable.js';
import type { StoredDocument } from '../ports/documents.js';
import type { Ports } from '../ports/index.js';
import { alreadyImported, confirmScanned, refuseWithoutDownloads, type ImportDeps } from './import.js';
import { joinArchive } from './join-archive.js';
import { asJoinLayerBusy } from './join-busy.js';
import { ON_ITS_LAYER, usablePartIn, versionsOfLayer } from './join-parts.js';
import { writeJoin, type JoinFrame, type JoinPlan } from './join-write.js';
import { refuseBusyLayer, refuseRasterJobs } from './limits.js';
import { requireCity } from './records.js';
import { requireUsgs } from './usgs-session.js';
import { jobIdFor, reserveLayerIds } from './versions.js';
import { deleteWorkFiles } from './work-files.js';

/**
 * `imagery.join` (a city editor; `docs/research/M8-join-interfaces.md` §5; S-A65-*): one date's frames become one layer. Frames
 * not imported yet are imported for it; the join's job is born waiting for its frames (`parts`) and the dispatcher starts it
 * once they rendered. Every check comes before anything is created: the frames share a date and a camera, the set fits the
 * guard and today's limits, the missing frames are scanned. With a frame already published the join is a new version of
 * that layer, so its tileset and presentation stay; otherwise it reserves its own layer id. Batch 4 (§5.1): any frame with a usable
 * version serves (awaiting approval, approved, publishing, published); with frames published as layers of their own, the join takes
 * the first one's layer and the others are retired when it publishes (`finalize-join.ts`); only a frame with no usable version refuses.
 */
export type JoinDeps = ImportDeps & Pick<Ports, 'blobs'>;

type Request = CallableRequest<'imagery.join'>;
/** One date's USGS frames (the archive maps' join is `join-archive.ts`). */
type FramesRequest = Extract<Request, { readonly entityIds: readonly string[] }>;

/** A scene with the version a join would take from its import, if it has one. */
interface Frame {
    readonly scene: UsgsSceneDoc;
    readonly part?: StoredDocument<LayerVersionDoc>;
    /** The frame's layer exists, or is on its way. */
    readonly onLayer: boolean;
}

async function requireScene(deps: JoinDeps, cityId: string, entityId: string): Promise<UsgsSceneDoc> {
    const scene = await deps.documents.get(FIRESTORE_PATHS.usgsScene(cityId, entityId), usgsSceneDocSchema);
    if (scene === undefined) {
        throw new ApiError('apiError.notFound');
    }
    return scene;
}

/** A date's scenes, the first apart: it names the set. */
interface Scenes {
    readonly head: UsgsSceneDoc;
    readonly all: readonly UsgsSceneDoc[];
}

/** The request's scenes, each once, of one date and one camera (`apiError.imagery.joinMixedFrames`). */
async function requireScenes(deps: JoinDeps, request: FramesRequest): Promise<Scenes> {
    const [first, ...rest] = new Set(request.entityIds);
    if (first === undefined || rest.length === 0) {
        throw new ApiError('apiError.invalidRequest', undefined, [{ path: 'entityIds', code: 'validation.value' }]);
    }
    const head = await requireScene(deps, request.cityId, first);
    const all = [head, ...(await Promise.all(rest.map((id) => requireScene(deps, request.cityId, id))))];
    if (new Set(all.map((scene) => `${scene.acquisitionDate} ${scene.sensor}`)).size > 1) {
        throw new ApiError('apiError.imagery.joinMixedFrames');
    }
    return { head, all };
}

/** A scene's import: the version to take; one that ended is gone, and a published join is not extended (delete and start again). */
async function importedFrame(deps: JoinDeps, cityId: string, scene: UsgsSceneDoc, layerId: string): Promise<Frame> {
    const part = usablePartIn(await versionsOfLayer(deps.documents, cityId, layerId));
    if (part === undefined) {
        throw new ApiError('apiError.imagery.joinPartGone', { frame: scene.entityId });
    }
    if (part.data.source?.kind === 'join') {
        throw await alreadyImported(deps, cityId, layerId);
    }
    const layer = await deps.documents.get(FIRESTORE_PATHS.layer(cityId, layerId), layerDocSchema);
    return { scene, part, onLayer: layer !== undefined || ON_ITS_LAYER.has(part.data.state) };
}

async function frameOf(deps: JoinDeps, cityId: string, scene: UsgsSceneDoc): Promise<Frame> {
    return scene.status === 'imported' && scene.layerId !== undefined
        ? importedFrame(deps, cityId, scene, scene.layerId)
        : { scene, onLayer: false };
}

/** The frames still to import are scanned, by the scene and by USGS, with downloads approved; nothing is created otherwise. */
async function requireScanned(deps: JoinDeps, cityId: string, missing: readonly Frame[]): Promise<void> {
    if (missing.length === 0) {
        return;
    }
    if (missing.some((frame) => !frame.scene.downloadAvailable)) {
        throw new ApiError('apiError.imagery.notScanned');
    }
    refuseWithoutDownloads(await requireUsgs(deps.setup));
    for (const { scene } of missing) {
        await confirmScanned(deps, cityId, scene);
    }
}

/**
 * The frame whose layer the join becomes a new version of: the first one published, else the first on its way to a layer; none when no
 * frame is a layer. Batch 4: the other frames' layers of the date are retired when the join publishes (`finalize-join.ts`).
 */
function publishedFrame(frames: readonly Frame[]): StoredDocument<LayerVersionDoc> | undefined {
    const onLayers = frames.flatMap((frame) => (frame.onLayer && frame.part !== undefined ? [frame.part] : []));
    return onLayers.find((part) => part.data.state === 'published') ?? onLayers[0];
}

/**
 * A busy layer refuses, the join its frame already belongs to aside: "add a frame" replaces that one (`join-write.ts`). M18
 * item 4: with its own words (`apiError.imagery.joinLayerBusy`), which the admin answers with Join when it ends.
 */
async function requireFreeLayer(deps: JoinDeps, cityId: string, published: StoredDocument<LayerVersionDoc> | undefined): Promise<void> {
    if (published === undefined) {
        return;
    }
    await refuseBusyLayer(deps.documents, cityId, published.data.layerId, published.data.partOf).catch(asJoinLayerBusy);
}

/** What the plan is made of. */
interface JoinSet {
    readonly request: FramesRequest;
    readonly by: string;
    readonly head: UsgsSceneDoc;
    readonly frames: readonly Frame[];
}

/** The ids of the set: a layer id per frame still to import, and the join's own unless it joins a published layer. */
async function planOf(deps: JoinDeps, { request, by, head, frames }: JoinSet): Promise<JoinPlan> {
    const now = deps.clock.now();
    const label = layerLabelFor(head.sensor, head.acquisitionDate);
    const published = publishedFrame(frames);
    const nextId = await reserveLayerIds(deps.documents, request.cityId);
    const planned = frames.map(({ scene, part }): JoinFrame => {
        return part === undefined
            ? { scene, versionId: jobIdFor('im', now, scene.entityId), layerId: nextId(label.ro), isNew: true }
            : { scene, versionId: part.id, layerId: part.data.layerId, isNew: false };
    });
    return {
        cityId: request.cityId,
        jobId: jobIdFor('jn', now, head.entityId),
        layerId: published?.data.layerId ?? nextId(label.ro),
        joinsLayer: published !== undefined,
        frames: planned,
        label,
        year: yearOfDate(head.acquisitionDate),
        date: head.acquisitionDate,
        sensor: head.sensor,
        by,
        now,
    };
}

function paramsOf(plan: JoinPlan): LayerJoinParams {
    return { parts: plan.frames.map(({ versionId, layerId }) => ({ versionId, layerId })), sensor: plan.sensor };
}

async function imageryJoin(deps: JoinDeps, caller: VerifiedCaller, request: Request): Promise<CallableResponse<'imagery.join'>> {
    return 'versionIds' in request ? joinArchive(deps, caller, request) : joinFrames(deps, caller, request);
}

async function joinFrames(deps: JoinDeps, caller: VerifiedCaller, request: FramesRequest): Promise<CallableResponse<'imagery.join'>> {
    await requireCity(deps.documents, request.cityId);
    const { head, all } = await requireScenes(deps, request);
    const frames = await Promise.all(all.map((scene) => frameOf(deps, request.cityId, scene)));
    const missing = frames.filter((frame) => frame.part === undefined);
    const placement = await refuseRasterJobs(deps.documents, deps.clock.now(), request.cityId, missing.length + 1);
    await requireScanned(deps, request.cityId, missing);
    await requireFreeLayer(deps, request.cityId, publishedFrame(frames));
    const plan = { ...(await planOf(deps, { request, by: caller.uid, head, frames })), ...placement };
    const replaced = await deps.documents.transaction((transaction) => writeJoin(transaction, plan, paramsOf(plan)));
    await Promise.all(replaced.map((jobId) => deleteWorkFiles(deps, request.cityId, jobId)));
    deps.log.info('frames joined', {
        uid: caller.uid,
        cityId: request.cityId,
        jobId: plan.jobId,
        layerId: plan.layerId,
        frames: frames.length,
    });
    return { jobId: plan.jobId, versionId: plan.jobId, layerId: plan.layerId };
}

/** The `imagery-join` callable. */
export function joinFunction(getDeps: () => JoinDeps & CallableDeps) {
    return defineCallable('imagery.join', imageryJoin, getDeps);
}
