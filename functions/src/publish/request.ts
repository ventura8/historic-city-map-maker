import {
    FIRESTORE_PATHS,
    MANIFEST_DEBOUNCE_SECONDS,
    MANIFEST_QUEUE,
    manifestStateDocSchema,
    manifestTaskId,
    timestampFromDate,
    type RebuildManifestResponse,
} from '@hcm/shared';

import type { Ports } from '../ports/index.js';

export type RequestDeps = Pick<Ports, 'log' | 'clock' | 'documents' | 'tasks'>;

export interface BuildRequest {
    readonly cityId: string;
    /** Rebuild from every document (M2 always does; the flag travels for the incremental builder of a larger city). */
    readonly full: boolean;
    /** The stamp: the admin's uid for `publish.rebuildManifest`, `system:publish` or `system:ops` otherwise. */
    readonly updatedBy: string;
}

/**
 * A content write while a build is queued and has not started (admin sweep 2026-11-14: a burst of POI writes, the Disappeared streets rebuild, made 9
 * `publish-onpoiwrite` runs fail on the counter's "cross-transaction contention"): it reads every document when it starts, so this
 * write is in it with no new count. The window's task is asked again (the same id: a no-op when it is there), so a queued build
 * whose task was lost still runs.
 */
async function joinQueuedBuild(
    deps: RequestDeps,
    queued: { readonly cityId: string; readonly full: boolean; readonly requestedVersion: number; readonly now: Date },
): Promise<RebuildManifestResponse> {
    const { cityId, full, requestedVersion, now } = queued;
    const asked = await deps.tasks.enqueue(
        MANIFEST_QUEUE,
        { cityId, requestedVersion, full },
        { id: manifestTaskId(cityId, now), delaySeconds: MANIFEST_DEBOUNCE_SECONDS },
    );
    deps.log.info('manifest build already queued', { cityId, requestedVersion, queued: asked });
    return { requestedVersion, queued: asked };
}

/**
 * Asks for a build of the city's manifest (security review §4.5): `manifests/{city}.requestedVersion` + 1 and `status:
 * 'queued'` in one transaction, then one `publish-buildManifest` task whose id is the city's current one-minute window
 * (`manifestTaskId`), delayed by that minute: every request of the window shares the build (`queued: false` for all
 * but the first). The builder reads everything when it runs, so a shared build includes each request.
 */
export async function requestManifestBuild(deps: RequestDeps, request: BuildRequest): Promise<RebuildManifestResponse> {
    const { cityId, full, updatedBy } = request;
    const now = deps.clock.now();
    const path = FIRESTORE_PATHS.manifestState(cityId);
    const waiting = await deps.documents.get(path, manifestStateDocSchema);
    if (!full && waiting?.status === 'queued') {
        return joinQueuedBuild(deps, { cityId, full, requestedVersion: waiting.requestedVersion, now });
    }
    const requestedVersion = await deps.documents.transaction(async (transaction) => {
        const current = await transaction.get(path, manifestStateDocSchema);
        const next = (current?.requestedVersion ?? 0) + 1;
        await transaction.set(path, manifestStateDocSchema, {
            ...(current ?? { builtVersion: 0 }),
            requestedVersion: next,
            status: 'queued',
            updatedBy,
            updatedAt: timestampFromDate(now),
        });
        return next;
    });
    const queued = await deps.tasks.enqueue(
        MANIFEST_QUEUE,
        { cityId, requestedVersion, full },
        { id: manifestTaskId(cityId, now), delaySeconds: MANIFEST_DEBOUNCE_SECONDS },
    );
    deps.log.info('manifest build requested', { cityId, requestedVersion, queued });
    return { requestedVersion, queued };
}
