import '../global-options.js';

import { FIRESTORE_PATHS, cityDocSchema, type CallableRequest, type CallableResponse } from '@hcm/shared';

import type { VerifiedCaller } from '../api/access.js';
import { ApiError } from '../api/api-error.js';
import { defineCallable } from '../api/callable.js';
import { InvalidDocumentError } from '../ports/errors.js';
import type { Ports } from '../ports/index.js';
import { requestManifestBuild, type RequestDeps } from './request.js';

export type RebuildDeps = RequestDeps & Pick<Ports, 'admins'>;

/** Whether the city exists; an invalid city document exists too (the build then records why it cannot publish it). */
async function cityExists(deps: RebuildDeps, cityId: string): Promise<boolean> {
    try {
        return (await deps.documents.get(FIRESTORE_PATHS.city(cityId), cityDocSchema)) !== undefined;
    } catch (error) {
        if (error instanceof InvalidDocumentError) {
            return true;
        }
        throw error;
    }
}

/**
 * `publish.rebuildManifest` (admin; `docs/research/M2-interfaces.md` §3.5): requests a build of the city's manifest,
 * stamped with the admin's uid; `queued: false` when this minute's build was already queued (it includes the request).
 */
export async function rebuildManifest(
    deps: RebuildDeps,
    caller: VerifiedCaller,
    request: CallableRequest<'publish.rebuildManifest'>,
): Promise<CallableResponse<'publish.rebuildManifest'>> {
    if (!(await cityExists(deps, request.cityId))) {
        throw new ApiError('apiError.notFound');
    }
    return requestManifestBuild(deps, { cityId: request.cityId, full: request.full ?? true, updatedBy: caller.uid });
}

/** `publish-rebuildManifest` (callable, admins). */
export function rebuildManifestFunction(getDeps: () => RebuildDeps) {
    return defineCallable('publish.rebuildManifest', rebuildManifest, getDeps);
}
