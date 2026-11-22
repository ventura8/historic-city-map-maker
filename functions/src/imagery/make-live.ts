import '../global-options.js';

import {
    FIRESTORE_PATHS,
    layerDocSchema,
    layerVersionDocSchema,
    type CallableRequest,
    type CallableResponse,
    type LayerDoc,
    type LayerVersionDoc,
} from '@hcm/shared';

import type { VerifiedCaller } from '../api/access.js';
import { ApiError } from '../api/api-error.js';
import { defineCallable, type CallableDeps } from '../api/callable.js';
import type { DocumentTransaction } from '../ports/documents.js';
import type { Ports } from '../ports/index.js';
import { dataBoundsOf } from './layer-bounds.js';
import { requireVersion, stampOf, type Stamp } from './records.js';

/**
 * `imagery.makeLive` (an editor or the city's owner; `docs/research/M12-own-tiles.md` §8; S-A231-*; lesson 759): a superseded version
 * whose own tiles are still in the public bucket becomes the layer's live version again. The layer's `source.url`, zooms, bounds and
 * `currentVersion` point at its archive, the version reads `published` and the one that was live reads `superseded` (its tiles then
 * wait out the grace of `own-tiles-clean.ts`). The layer is written as the caller, so History records the change, and
 * `publish.onLayerWrite` rebuilds the manifest. Refused: a version that is not superseded (`apiError.imagery.versionState`), one
 * whose own tiles are gone or never existed (`apiError.imagery.tilesGone`: calibrate again), one whose layer is gone
 * (`apiError.notFound`). The three documents are written in one transaction that reads them again.
 */
type Request = CallableRequest<'imagery.makeLive'>;

export type MakeLiveDeps = Pick<Ports, 'documents' | 'clock' | 'log' | 'blobs'>;

type Own = NonNullable<LayerVersionDoc['own']>;

/** The version's own public archive while it is still there, else null. */
async function liveArchive(deps: MakeLiveDeps, version: LayerVersionDoc): Promise<Own | null> {
    const own = version.own;
    if (own === undefined || own.removedAt !== undefined) {
        return null;
    }
    return (await deps.blobs.stat('public', own.path)) === undefined ? null : own;
}

/** The version, checked: superseded and its archive still in the public bucket. */
interface Restorable {
    readonly layerId: string;
    readonly own: Own;
    readonly output: NonNullable<LayerVersionDoc['output']>;
}

async function requireRestorable(deps: MakeLiveDeps, request: Request): Promise<Restorable> {
    const version = await requireVersion(deps.documents, request.cityId, request.versionId);
    if (version.state !== 'superseded') {
        throw new ApiError('apiError.imagery.versionState');
    }
    const own = await liveArchive(deps, version);
    if (own === null || version.output === undefined) {
        throw new ApiError('apiError.imagery.tilesGone');
    }
    return { layerId: version.layerId, own, output: version.output };
}

/** The layer as the version's archive leaves it: its tiles, zooms and bounds; the presentation kept. */
function layerAfter(layer: LayerDoc, restorable: Restorable, versionId: string, stamp: Stamp): LayerDoc {
    const { output, own } = restorable;
    const tiles = { minzoom: output.minzoom, maxzoom: output.maxzoom, bounds: dataBoundsOf(output) };
    return { ...layer, ...tiles, source: { type: 'pmtiles', url: own.url }, currentVersion: versionId, status: 'ready', ...stamp };
}

/** The version read again: still superseded. */
function stillSuperseded(version: LayerVersionDoc | undefined): LayerVersionDoc {
    if (version?.state !== 'superseded') {
        throw new ApiError('apiError.imagery.versionState');
    }
    return version;
}

/** The layer read again: still there. */
function stillThere(layer: LayerDoc | undefined): LayerDoc {
    if (layer === undefined) {
        throw new ApiError('apiError.notFound');
    }
    return layer;
}

/** The version that was live, read before any write; undefined when the layer showed none or this one. */
async function readPrevious(
    transaction: DocumentTransaction,
    cityId: string,
    previousId: string | undefined,
): Promise<Previous | undefined> {
    if (previousId === undefined) {
        return undefined;
    }
    const path = FIRESTORE_PATHS.layerVersion(cityId, previousId);
    const version = await transaction.get(path, layerVersionDocSchema);
    return version?.state === 'published' ? { path, version } : undefined;
}

interface Previous {
    readonly path: string;
    readonly version: LayerVersionDoc;
}

/** The three writes, the version and its layer read again first; the id of the version that was live. */
async function swap(deps: MakeLiveDeps, caller: VerifiedCaller, request: Request, restorable: Restorable): Promise<string | undefined> {
    const stamp = stampOf(caller.uid, deps.clock.now());
    const versionPath = FIRESTORE_PATHS.layerVersion(request.cityId, request.versionId);
    return deps.documents.transaction(async (transaction) => {
        const version = stillSuperseded(await transaction.get(versionPath, layerVersionDocSchema));
        const layerPath = FIRESTORE_PATHS.layer(request.cityId, version.layerId);
        const layer = stillThere(await transaction.get(layerPath, layerDocSchema));
        const previousId = layer.currentVersion === request.versionId ? undefined : layer.currentVersion;
        // Every read before the first write: Firestore's transactions read first.
        const previous = await readPrevious(transaction, request.cityId, previousId);
        await transaction.set(layerPath, layerDocSchema, layerAfter(layer, restorable, request.versionId, stamp));
        await transaction.set(versionPath, layerVersionDocSchema, { ...version, state: 'published', ...stamp });
        if (previous !== undefined) {
            await transaction.set(previous.path, layerVersionDocSchema, { ...previous.version, state: 'superseded', ...stamp });
        }
        return previousId;
    });
}

async function imageryMakeLive(
    deps: MakeLiveDeps,
    caller: VerifiedCaller,
    request: Request,
): Promise<CallableResponse<'imagery.makeLive'>> {
    const restorable = await requireRestorable(deps, request);
    const previous = await swap(deps, caller, request, restorable);
    deps.log.info('layer version made live again', {
        uid: caller.uid,
        cityId: request.cityId,
        versionId: request.versionId,
        layerId: restorable.layerId,
        previous: previous ?? null,
    });
    return { live: true };
}

/** The `imagery-makeLive` callable. */
export function makeLiveFunction(getDeps: () => MakeLiveDeps & CallableDeps) {
    return defineCallable('imagery.makeLive', imageryMakeLive, getDeps);
}
