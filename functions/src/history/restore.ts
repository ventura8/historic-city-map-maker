/**
 * What restoring a deleted document must not get wrong (`docs/research/M2c-interfaces.md` §8.4, §6.6; CR-M2c-5): a
 * restored layer or photo never points at files that are gone.
 *
 * - A deleted layer waits `LAYER_DELETE_GRACE_DAYS` before its `layer-delete` job removes the Mapbox tileset. Restoring
 *   it within the grace sets that waiting job `cancelled` in the same transaction; once a job succeeded, the tiles are
 *   gone and the revert answers `apiError.history.layerGone` (S-A23-BAD-LAYER-GONE).
 * - A deleted photo's public derivatives are swept once no manifest names them. Restoring it after the sweep puts it
 *   back `pending` and processes it again from its kept original, as `photos.reprocess` does
 *   (S-A23-BAD-RESTORE-AFTER-SWEEP). The steps are written here: a feature folder reaches another only through
 *   `ports/`, `api/` and `@hcm/shared` (dependency-cruiser `functions-feature-folders-independent`).
 */
import {
    FIRESTORE_PATHS,
    STORAGE_PATHS,
    historyEntryDocSchema,
    jobDocSchema,
    layerDocSchema,
    photoDocSchema,
    publicObjectUrl,
    timestampFromDate,
    validate,
    type AuditedDocument,
    type JobDoc,
    type PhotoDoc,
} from '@hcm/shared';

import type { VerifiedCaller } from '../api/access.js';
import { ApiError } from '../api/api-error.js';
import { omit } from '../api/objects.js';
import type { DocumentTransaction } from '../ports/documents.js';
import type { Ports } from '../ports/index.js';

export type RestoreDeps = Pick<Ports, 'documents' | 'blobs' | 'clock' | 'log' | 'config'>;

const FINISHED: ReadonlySet<JobDoc['status']> = new Set(['succeeded', 'failed', 'cancelled']);

/**
 * The `layer-delete` jobs of a layer about to be restored: refused once one succeeded (its tiles are gone); the paths of
 * those still waiting otherwise, which the revert's transaction cancels.
 */
export async function waitingLayerDeletes(deps: Pick<RestoreDeps, 'documents'>, audited: AuditedDocument): Promise<readonly string[]> {
    if (audited.entity !== 'layer') {
        return [];
    }
    // `jobs.params` is exempt from indexing (`firebase/firestore.indexes.json`): ask by `type`, match the layer here (lesson 557).
    const deletes = await deps.documents.query(FIRESTORE_PATHS.jobs(audited.cityId), jobDocSchema, {
        where: [['type', '==', 'layer-delete']],
    });
    const jobs = deletes.documents.filter((job) => job.data.params['layerId'] === audited.entityId);
    if (jobs.some((job) => job.data.status === 'succeeded')) {
        throw new ApiError('apiError.history.layerGone');
    }
    return jobs.filter((job) => !FINISHED.has(job.data.status)).map((job) => job.path);
}

/**
 * M12: a deleted layer never comes back pointing at an archive that is gone. An entry older than its last publish names a version since
 * superseded, whose archive goes after its grace (`imagery/own-tiles-clean.ts`). Only a deleted layer takes its `source` from the entry
 * (the field is the server's): a revert of a layer that exists keeps the tiles it shows.
 */
export async function requireLayerTiles(
    deps: Pick<RestoreDeps, 'documents' | 'blobs' | 'config'>,
    audited: AuditedDocument,
    entryId: string,
): Promise<void> {
    const path = audited.entity === 'layer' ? await archiveOfEntry(deps, audited, entryId) : undefined;
    if (path !== undefined && (await deps.blobs.stat('public', path)) === undefined) {
        throw new ApiError('apiError.history.layerGone');
    }
}

/** The address of the archive a kept `source` names, if it names one. */
function archiveUrl(kept: unknown): string {
    const source = validate(layerDocSchema.shape.source, kept);
    return source.ok && source.value.type === 'pmtiles' ? source.value.url : '';
}

/** The public object the entry's kept `source` names, if it names one. */
async function archiveOfEntry(
    deps: Pick<RestoreDeps, 'documents' | 'config'>,
    audited: AuditedDocument,
    entryId: string,
): Promise<string | undefined> {
    const entry = await deps.documents.get(FIRESTORE_PATHS.historyEntry(audited, entryId), historyEntryDocSchema);
    const url = archiveUrl(entry?.previous?.['source']);
    const prefix = publicObjectUrl(deps.config.buckets.public, '');
    return url.startsWith(prefix) ? url.slice(prefix.length) : undefined;
}

/** Inside the revert's transaction, after its reads: each waiting job of the restored layer ends `cancelled`. */
export async function cancelLayerDeletes(
    transaction: DocumentTransaction,
    paths: readonly string[],
    stamp: { readonly caller: VerifiedCaller; readonly now: Date },
): Promise<void> {
    const jobs = await Promise.all(paths.map(async (path) => ({ path, job: await transaction.get(path, jobDocSchema) })));
    for (const { path, job } of jobs) {
        if (job !== undefined && !FINISHED.has(job.status)) {
            await transaction.set(path, jobDocSchema, {
                ...job,
                status: 'cancelled',
                updatedBy: stamp.caller.uid,
                updatedAt: timestampFromDate(stamp.now),
            });
        }
    }
}

/** The restored photo when the sweep removed its public files (its `web` derivative is gone), else undefined. */
async function sweptPhoto(deps: RestoreDeps, audited: AuditedDocument): Promise<PhotoDoc | undefined> {
    const photo = await deps.documents.get(FIRESTORE_PATHS.photo(audited.cityId, audited.entityId), photoDocSchema);
    const image = photo?.image;
    if (image === undefined) {
        return undefined;
    }
    const web = STORAGE_PATHS.photoDerivative(audited.cityId, audited.entityId, image.sha256, 'web');
    return (await deps.blobs.stat('public', web)) === undefined ? photo : undefined;
}

/** The photo's original while the private bucket still keeps it. */
async function keptOriginal(deps: RestoreDeps, photo: PhotoDoc): Promise<string | undefined> {
    const original = photo.original?.path;
    return original !== undefined && (await deps.blobs.stat('private', original)) !== undefined ? original : undefined;
}

/** Back to `pending`, without the last processing's error: the manifest leaves the photo out until it is processed. */
async function markPending(deps: RestoreDeps, caller: VerifiedCaller, path: string): Promise<void> {
    await deps.documents.transaction(async (transaction) => {
        const current = await transaction.get(path, photoDocSchema);
        if (current !== undefined) {
            await transaction.set(path, photoDocSchema, {
                ...omit(current, ['processingError', 'duplicateOf']),
                processing: 'pending',
                updatedBy: caller.uid,
                updatedAt: timestampFromDate(deps.clock.now()),
            });
        }
    });
}

/**
 * A restored photo whose public derivatives the sweep removed goes back to `pending`, and its kept original is copied
 * into a new upload of the caller's folder, which runs `photos.onUpload` again. Without the original it stays
 * `pending` (never on the public map with files that are gone) and the log says why.
 */
export async function reprocessIfSwept(deps: RestoreDeps, caller: VerifiedCaller, audited: AuditedDocument): Promise<boolean> {
    const photo = audited.entity === 'photo' ? await sweptPhoto(deps, audited) : undefined;
    if (photo === undefined) {
        return false;
    }
    const ids = { cityId: audited.cityId, photoId: audited.entityId };
    await markPending(deps, caller, FIRESTORE_PATHS.photo(ids.cityId, ids.photoId));
    const original = await keptOriginal(deps, photo);
    if (original === undefined) {
        deps.log.warn('restored photo has no original to process again', ids);
        return true;
    }
    const fileName = `reprocess-${String(deps.clock.now().getTime())}.${original.slice(original.lastIndexOf('.') + 1)}`;
    await deps.blobs.copy(
        { bucket: 'private', path: original },
        { bucket: 'private', path: STORAGE_PATHS.photoUpload(ids.cityId, caller.uid, ids.photoId, fileName) },
    );
    deps.log.info('restored photo processed again', ids);
    return true;
}
