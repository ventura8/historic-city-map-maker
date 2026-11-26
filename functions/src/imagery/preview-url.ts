import '../global-options.js';

import { IMAGERY_PREVIEW_URL_SECONDS, isOwnTiles, type CallableRequest, type CallableResponse, type LayerVersionDoc } from '@hcm/shared';

import type { VerifiedCaller } from '../api/access.js';
import { ApiError } from '../api/api-error.js';
import { defineCallable, type CallableDeps } from '../api/callable.js';
import type { BucketRole } from '../ports/blob-store.js';
import type { Ports } from '../ports/index.js';
import { requireVersion } from './records.js';

export type PreviewUrlDeps = Pick<Ports, 'documents' | 'clock' | 'log' | 'blobs' | 'signer'>;

type Request = CallableRequest<'imagery.previewUrl'>;

/** The archive an address is signed for: its bucket, its path, its size. */
interface Archive {
    readonly bucket: BucketRole;
    readonly path: string;
    readonly bytes: number;
}

/** The public copy of a published version (publishing moves the archive there: M12-own-tiles.md → *Cost*), while it is there. */
async function publicArchive(deps: PreviewUrlDeps, version: LayerVersionDoc): Promise<Archive | undefined> {
    const own = version.own;
    if (own === undefined || own.removedAt !== undefined) {
        return undefined;
    }
    return (await deps.blobs.stat('public', own.path)) === undefined ? undefined : { bucket: 'public', path: own.path, bytes: own.bytes };
}

/**
 * The private archive, only from the version's own folder (`isOwnTiles`: the path is a worker's write). No tiles yet answers
 * `apiError.imagery.tilesMissing` (they are on their way); tiles gone, or lying anywhere else, `apiError.imagery.tilesGone` (nothing makes
 * them again).
 */
async function privateArchive(deps: PreviewUrlDeps, request: Request, version: LayerVersionDoc): Promise<Archive> {
    const tiles = version.output?.tiles;
    if (tiles === undefined) {
        throw new ApiError('apiError.imagery.tilesMissing');
    }
    const mine = isOwnTiles(request.cityId, version.layerId, request.versionId, tiles);
    if (!mine || (await deps.blobs.stat('private', tiles.path)) === undefined) {
        throw new ApiError('apiError.imagery.tilesGone');
    }
    return { bucket: 'private', path: tiles.path, bytes: tiles.bytes };
}

/**
 * `imagery.previewUrl` (a city's editor; `docs/research/M12-own-tiles.md`; S-A74-*): the owner sees an image before approving it, and
 * after. A V4 signed GET of the version's archive, for one hour, read with `Range` requests by the admin's map; no preflight and no rule
 * per tile. The address is a credential for its hour: it is never logged and never stored.
 */
async function imageryPreviewUrl(
    deps: PreviewUrlDeps,
    caller: VerifiedCaller,
    request: Request,
): Promise<CallableResponse<'imagery.previewUrl'>> {
    const version = await requireVersion(deps.documents, request.cityId, request.versionId);
    const archive = (await publicArchive(deps, version)) ?? (await privateArchive(deps, request, version));
    const expiresAt = new Date(deps.clock.now().getTime() + IMAGERY_PREVIEW_URL_SECONDS * 1000);
    const signed = await deps.signer.signedObject(archive.bucket, { path: archive.path, method: 'GET', expiresAt });
    deps.log.info('layer version preview signed', { uid: caller.uid, cityId: request.cityId, versionId: request.versionId });
    return { url: signed.url, expiresAt: expiresAt.toISOString(), bytes: archive.bytes };
}

/** The `imagery-previewUrl` callable. */
export function previewUrlFunction(getDeps: () => PreviewUrlDeps & CallableDeps) {
    return defineCallable('imagery.previewUrl', imageryPreviewUrl, getDeps);
}
