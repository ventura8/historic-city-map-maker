import '../global-options.js';

import {
    BROWSE_FETCH_MAX_BYTES,
    BROWSE_LONG_EDGE,
    BROWSE_MAX_BYTES,
    CLOUD_ESTIMATE_VERSION,
    FIRESTORE_PATHS,
    RASTER_PATHS,
    timestampFromDate,
    usgsSceneDocSchema,
    type CallableRequest,
    type CallableResponse,
    type UsgsSceneDoc,
} from '@hcm/shared';

import type { VerifiedCaller } from '../api/access.js';
import { ApiError } from '../api/api-error.js';
import { defineCallable, type CallableDeps } from '../api/callable.js';
import { UpstreamError } from '../ports/errors.js';
import type { Ports } from '../ports/index.js';
import { measureClouds, type Measure } from './cloud-record.js';
import { imageTypeOf } from './magic.js';
import { IMAGERY_WRITER, stampOf } from './records.js';

/**
 * The browse proxy (`docs/research/M3-interfaces.md` §3.4): the browser never requests a USGS address, so a scene's
 * browse image is fetched server-side from `ims.cr.usgs.gov` (M25: and `landsatlook.usgs.gov`) only (`RemoteFiles` with `allowedHosts`), checked to be a
 * JPEG or a PNG, and copied create-only into the private bucket, where the admin reads it with the Storage SDK.
 */
export type BrowseDeps = Pick<Ports, 'documents' | 'clock' | 'log' | 'remote' | 'blobs' | 'images'>;

/** USGS's browse hosts: the only addresses a browse image is fetched from (M25: LandsatLook's for a Landsat scene). */
const BROWSE_HOSTS = ['ims.cr.usgs.gov', 'landsatlook.usgs.gov'];
/** 30 s: a KH-9 panoramic strip's 13 MB preview must arrive in time. */
const BROWSE_TIMEOUT_MS = 30_000;

/** What a failed copy records and answers, in the owner's words (`apiError.imagery.*`). */
const BROWSE_ERRORS = ['apiError.imagery.browseUnavailable', 'apiError.imagery.browseNotImage', 'apiError.imagery.browseTooLarge'] as const;

type BrowseError = (typeof BROWSE_ERRORS)[number];

type BrowseType = CallableResponse<'imagery.browse'>['contentType'];

const BROWSE_TYPES: readonly BrowseType[] = ['image/jpeg', 'image/png'];

/** Writes the scene's new browse record in a transaction (an admin's triage meanwhile is kept). */
async function recordBrowse(deps: BrowseDeps, cityId: string, entityId: string, browse: UsgsSceneDoc['browse']): Promise<void> {
    const path = FIRESTORE_PATHS.usgsScene(cityId, entityId);
    await deps.documents.transaction(async (transaction) => {
        const scene = await transaction.get(path, usgsSceneDocSchema);
        if (scene !== undefined) {
            await transaction.set(path, usgsSceneDocSchema, { ...scene, browse, ...stampOf(IMAGERY_WRITER, deps.clock.now()) });
        }
    });
}

/** The code of a failed fetch: a file over `BROWSE_FETCH_MAX_BYTES` (`invalid`) is too large, anything else USGS not answering. */
function fetchFailure(error: unknown): ApiError {
    const tooLarge = error instanceof UpstreamError && error.failure === 'invalid';
    return new ApiError(tooLarge ? 'apiError.imagery.browseTooLarge' : 'apiError.imagery.browseUnavailable');
}

/**
 * What USGS sent, as a file we store: a JPEG or a PNG; one over `BROWSE_MAX_BYTES` (a KH-9 panoramic strip's is 7 to 13 MB) shrunk
 * to a JPEG `BROWSE_LONG_EDGE` long. A web page in place of the picture is `browseNotImage`; one that cannot be shrunk `browseTooLarge`.
 */
async function fetchBrowse(deps: BrowseDeps, sourceUrl: string): Promise<{ type: BrowseType; bytes: Uint8Array }> {
    const file = await deps.remote
        .get(sourceUrl, { maxBytes: BROWSE_FETCH_MAX_BYTES, timeoutMs: BROWSE_TIMEOUT_MS, allowedHosts: BROWSE_HOSTS })
        .catch((error: unknown) => {
            throw fetchFailure(error);
        });
    const contentType = imageTypeOf(file.bytes, BROWSE_TYPES);
    if (contentType === undefined) {
        throw new ApiError('apiError.imagery.browseNotImage');
    }
    if (file.bytes.length <= BROWSE_MAX_BYTES) {
        return { type: contentType, bytes: file.bytes };
    }
    const shrunk = await deps.images.jpeg(file.bytes, BROWSE_LONG_EDGE).catch(() => {
        throw new ApiError('apiError.imagery.browseTooLarge');
    });
    return { type: 'image/jpeg', bytes: shrunk };
}

/** Fetches and stores the image (`fetchBrowse` says what failed). */
async function fetchAndStore(deps: BrowseDeps, scene: UsgsSceneDoc, sourceUrl: string): Promise<{ type: BrowseType; bytes: Uint8Array }> {
    const fetched = await fetchBrowse(deps, sourceUrl);
    const path = RASTER_PATHS.browse(scene.dataset, scene.entityId);
    try {
        await deps.blobs.write('private', path, fetched.bytes, { contentType: fetched.type, ifGenerationMatch: 0 });
    } catch (error) {
        // Another city copied the same frame first (`usgs-browse/` is shared): its copy is as good.
        if (!(error instanceof UpstreamError && error.failure === 'conflict')) {
            throw error;
        }
    }
    return fetched;
}

/** The clouds of a scene not measured yet by the current method (a copy made again is the same frame). */
async function measureOnce(deps: BrowseDeps, measured: Measure): Promise<void> {
    if (measured.scene.cloudEstimate?.version !== CLOUD_ESTIMATE_VERSION) {
        await measureClouds(deps, measured);
    }
}

/** A failure's code: our own refusal's, else USGS or the bucket not answering. */
function browseErrorOf(error: unknown): BrowseError {
    return error instanceof ApiError
        ? (BROWSE_ERRORS.find((code) => code === error.code) ?? 'apiError.imagery.browseUnavailable')
        : BROWSE_ERRORS[0];
}

/**
 * Copies `scene`'s browse image into our bucket and records it (`browse.state: 'copied'`, `path`, `checkedAt`) with its clouds
 * (`rewritePlan` false: the harvest writes the plan once after its prefetch); a
 * failure records `failed` with what failed (`browseUnavailable`, `browseNotImage`, `browseTooLarge`) and rejects with that code
 * (the card says it and offers Try again).
 */
export async function copyBrowse(
    deps: BrowseDeps,
    cityId: string,
    scene: UsgsSceneDoc,
    rewritePlan = true,
): Promise<{ path: string; contentType: BrowseType }> {
    const checkedAt = timestampFromDate(deps.clock.now());
    const sourceUrl = scene.browse.sourceUrl;
    try {
        if (sourceUrl === undefined) {
            throw new ApiError('apiError.imagery.browseUnavailable');
        }
        const fetched = await fetchAndStore(deps, scene, sourceUrl);
        const path = RASTER_PATHS.browse(scene.dataset, scene.entityId);
        await recordBrowse(deps, cityId, scene.entityId, { state: 'copied', sourceUrl, path, checkedAt });
        await measureOnce(deps, { cityId, scene, bytes: () => Promise.resolve(fetched.bytes), rewritePlan });
        return { path, contentType: fetched.type };
    } catch (error) {
        const code = browseErrorOf(error);
        deps.log.warn('browse image not copied', { cityId, entityId: scene.entityId, code, error: String(error) });
        const failed = { state: 'failed' as const, error: code, checkedAt };
        await recordBrowse(deps, cityId, scene.entityId, sourceUrl === undefined ? failed : { ...failed, sourceUrl });
        throw new ApiError(code);
    }
}

/** The stored copy when it is still there (a lifecycle rule or a manual clean-up may have removed it). */
async function storedCopy(deps: BrowseDeps, scene: UsgsSceneDoc): Promise<{ path: string; contentType: BrowseType } | undefined> {
    const path = scene.browse.path;
    if (scene.browse.state !== 'copied' || path === undefined) {
        return undefined;
    }
    const stored = await deps.blobs.stat('private', path);
    return stored === undefined ? undefined : { path, contentType: stored.contentType === 'image/png' ? 'image/png' : 'image/jpeg' };
}

/** `imagery.browse` (admin): the scene's browse copy, made first when there is none. */
async function imageryBrowse(
    deps: BrowseDeps,
    _caller: VerifiedCaller,
    request: CallableRequest<'imagery.browse'>,
): Promise<CallableResponse<'imagery.browse'>> {
    const scene = await deps.documents.get(FIRESTORE_PATHS.usgsScene(request.cityId, request.entityId), usgsSceneDocSchema);
    if (scene === undefined) {
        throw new ApiError('apiError.notFound');
    }
    const stored = await storedCopy(deps, scene);
    if (stored === undefined) {
        return copyBrowse(deps, request.cityId, scene);
    }
    await measureOnce(deps, { cityId: request.cityId, scene, bytes: () => deps.blobs.read('private', stored.path), rewritePlan: true });
    return stored;
}

/** The `imagery-browse` callable. */
export function browseFunction(getDeps: () => BrowseDeps & CallableDeps) {
    return defineCallable('imagery.browse', imageryBrowse, getDeps);
}
