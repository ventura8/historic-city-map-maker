import '../global-options.js';

import {
    FIRESTORE_PATHS,
    STORAGE_PATHS,
    photoDocSchema,
    timestampFromDate,
    type CallableRequest,
    type CallableResponse,
    type PhotoDoc,
} from '@hcm/shared';

import type { VerifiedCaller } from '../api/access.js';
import { ApiError } from '../api/api-error.js';
import { defineCallable } from '../api/callable.js';
import type { Ports } from '../ports/index.js';
import { omit } from '../api/objects.js';

export type ReprocessDeps = Pick<Ports, 'log' | 'clock' | 'documents' | 'blobs' | 'admins'>;

type Request = CallableRequest<'photos.reprocess'>;

/** The file extension of an original or an upload (`…/<sha256>.jpg`, `…/<nonce>.tif`). */
function extensionOf(path: string): string {
    return path.slice(path.lastIndexOf('.') + 1);
}

/** The photo's kept original, else an upload still waiting in its folder (a failure that kept it), else nothing. */
async function sourceOf(deps: ReprocessDeps, request: Request, photo: PhotoDoc): Promise<string | undefined> {
    const original = photo.original?.path;
    if (original !== undefined && (await deps.blobs.stat('private', original)) !== undefined) {
        return original;
    }
    const uploads = await deps.blobs.list('private', `uploads/photos/${request.cityId}/`);
    return uploads.find((path) => path.split('/')[4] === request.photoId);
}

async function markPending(deps: ReprocessDeps, caller: VerifiedCaller, path: string): Promise<void> {
    await deps.documents.transaction(async (transaction) => {
        const current = await transaction.get(path, photoDocSchema);
        if (current === undefined) {
            throw new ApiError('apiError.notFound');
        }
        await transaction.set(path, photoDocSchema, {
            ...omit(current, ['processingError', 'duplicateOf']),
            processing: 'pending',
            updatedBy: caller.uid,
            updatedAt: timestampFromDate(deps.clock.now()),
        });
    });
}

/**
 * `photos.reprocess` (admin; `docs/research/M2-interfaces.md` §3.6): puts the photo back to `pending` and copies its
 * original (or the upload a transient failure kept) into a new upload of the caller's folder, which runs
 * `photos.onUpload` again. A photo with neither is `apiError.notFound`.
 */
export async function reprocessPhoto(
    deps: ReprocessDeps,
    caller: VerifiedCaller,
    request: Request,
): Promise<CallableResponse<'photos.reprocess'>> {
    const path = FIRESTORE_PATHS.photo(request.cityId, request.photoId);
    const photo = await deps.documents.get(path, photoDocSchema);
    const source = photo === undefined ? undefined : await sourceOf(deps, request, photo);
    if (source === undefined) {
        throw new ApiError('apiError.notFound');
    }
    const fileName = `reprocess-${String(deps.clock.now().getTime())}.${extensionOf(source)}`;
    await markPending(deps, caller, path);
    await deps.blobs.copy(
        { bucket: 'private', path: source },
        { bucket: 'private', path: STORAGE_PATHS.photoUpload(request.cityId, caller.uid, request.photoId, fileName) },
    );
    deps.log.info('photo reprocessing requested', { cityId: request.cityId, photoId: request.photoId, uid: caller.uid });
    return { processing: 'pending' };
}

/** `photos-reprocess` (callable, admins). */
export function reprocessFunction(getDeps: () => ReprocessDeps) {
    return defineCallable('photos.reprocess', reprocessPhoto, getDeps);
}
