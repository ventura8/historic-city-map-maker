/**
 * `history.revert` of a deletion (CR-M2c-5, `functions/src/history/restore.ts`): a deleted layer comes back only while
 * its tileset exists (the waiting `layer-delete` job is cancelled; a finished one answers `history.layerGone`), and a
 * deleted photo whose public files were swept is processed again from its original. Over the fn-content fakes.
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
    type AuditedDocument,
} from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { requireLayerTiles } from '../../src/history/restore.js';
import { revertFunction } from '../../src/history/revert.js';
import { layerDeleteFunction } from '../../src/layers/delete.js';
import { failureOf } from '../admin/world.js';
import { adminCall, contentDeps, type ContentDeps } from '../publish/fakes.js';
import { CITY as LAYER_CITY, layer, seedJob, seedLayer } from '../layers/world.js';
import { CITY as PHOTO_CITY, seedPhoto } from '../photos/world.js';

const NOW = '2026-10-17T08:30:00.000Z';
const DELETED_AT = timestampFromDate(new Date('2026-10-17T08:00:00.000Z'));
const ENTRY = '1760688000000-deleted';
const SHA = 'c'.repeat(64);

/** The `delete` entry the history trigger would have written for `previous`. */
async function deletionEntry(deps: ContentDeps, audited: AuditedDocument, previous: Record<string, unknown>): Promise<void> {
    await deps.documents.set(FIRESTORE_PATHS.historyEntry(audited, ENTRY), historyEntryDocSchema, {
        entity: audited.entity,
        entityId: audited.entityId,
        action: 'delete',
        previous,
        changedFields: Object.keys(previous),
        updatedBy: 'u-admin',
        updatedAt: DELETED_AT,
    });
}

function revert(deps: ContentDeps, audited: AuditedDocument) {
    return revertFunction(() => deps).run(
        adminCall({ cityId: audited.cityId, entity: audited.entity, entityId: audited.entityId, entryId: ENTRY }),
    );
}

/** Deletes the layer through `layers.delete` (its job waits), with the trigger's entry; answers the job's path. */
async function deletedLayer(deps: ContentDeps): Promise<{ readonly audited: AuditedDocument; readonly job: string }> {
    const audited: AuditedDocument = { entity: 'layer', cityId: LAYER_CITY, entityId: 'corona-1968' };
    await seedLayer(deps, 'corona-1968');
    const { jobId } = await layerDeleteFunction(() => deps).run(adminCall({ cityId: LAYER_CITY, layerId: 'corona-1968' }));
    await deletionEntry(deps, audited, layer());
    return { audited, job: FIRESTORE_PATHS.job(LAYER_CITY, jobId) };
}

describe('history.revert of a deleted layer', () => {
    it('happyPath_withinTheGraceTheLayerComesBackAndItsTilesetDeletionIsCancelled', async () => {
        const deps = contentDeps(NOW);
        const { audited, job } = await deletedLayer(deps);

        await revert(deps, audited);

        expect(await deps.documents.get(FIRESTORE_PATHS.layer(LAYER_CITY, 'corona-1968'), layerDocSchema)).toMatchObject({
            label: { ro: 'Corona 1968' },
        });
        expect(await deps.documents.get(job, jobDocSchema)).toMatchObject({ status: 'cancelled', updatedBy: 'u-admin' });
    });

    it('badPath_aLayerWhoseTilesetWasDeletedIsNotRestored @S-A23-BAD-LAYER-GONE', async () => {
        const deps = contentDeps(NOW);
        const { audited, job } = await deletedLayer(deps);
        const done = await deps.documents.get(job, jobDocSchema);
        await deps.documents.set(job, jobDocSchema, { ...(done ?? {}), status: 'succeeded' } as never);

        const failure = await failureOf(revert(deps, audited));

        expect(failure).toMatchObject({ code: 'failed-precondition', details: { code: 'apiError.history.layerGone' } });
        expect(deps.documents.peek(FIRESTORE_PATHS.layer(LAYER_CITY, 'corona-1968'))).toBeUndefined();
    });

    it('happyPath_aLayerThatExistsIsRevertedWithoutLookingAtItsJobs', async () => {
        const deps = contentDeps(NOW);
        await seedLayer(deps, 'corona-1968', { label: { ro: 'Acum' } });
        await seedJob(deps, 'old-delete', { type: 'layer-delete', status: 'succeeded', params: { layerId: 'corona-1968' } });
        const audited: AuditedDocument = { entity: 'layer', cityId: LAYER_CITY, entityId: 'corona-1968' };
        await deletionEntry(deps, audited, layer({ label: { ro: 'Corona 1968' } }));

        await revert(deps, audited);

        expect(await deps.documents.get(FIRESTORE_PATHS.layer(LAYER_CITY, 'corona-1968'), layerDocSchema)).toMatchObject({
            label: { ro: 'Corona 1968' },
        });
    });
});

describe('history.revert of a deleted photo', () => {
    const audited: AuditedDocument = { entity: 'photo', cityId: PHOTO_CITY, entityId: 'p1' };
    const ORIGINAL = STORAGE_PATHS.photoOriginal(PHOTO_CITY, 'p1', SHA, 'image/jpeg');
    const WEB = STORAGE_PATHS.photoDerivative(PHOTO_CITY, 'p1', SHA, 'web');

    async function deletedPhoto(deps: ContentDeps, keepOriginal = true): Promise<void> {
        const processed = {
            processing: 'done' as const,
            image: {
                web: `https://storage.googleapis.com/public-bucket/${WEB}`,
                thumb: `https://storage.googleapis.com/public-bucket/${WEB}`,
                sha256: SHA,
                w: 2048,
                h: 1365,
            },
            original: { path: ORIGINAL, contentType: 'image/jpeg' as const, bytes: 3, sha256: SHA },
        };
        await seedPhoto(deps, 'p1', processed);
        const previous = await deps.documents.get(FIRESTORE_PATHS.photo(PHOTO_CITY, 'p1'), photoDocSchema);
        await deps.documents.delete(FIRESTORE_PATHS.photo(PHOTO_CITY, 'p1'));
        await deletionEntry(deps, audited, { ...(previous ?? {}) });
        if (keepOriginal) {
            deps.blobs.put('private', ORIGINAL, new Uint8Array([1, 2, 3]), { contentType: 'image/jpeg' });
        }
    }

    it('badPath_aPhotoRestoredAfterTheSweepIsProcessedAgain @S-A23-BAD-RESTORE-AFTER-SWEEP', async () => {
        const deps = contentDeps(NOW);
        await deletedPhoto(deps);

        await revert(deps, audited);

        expect((await deps.documents.get(FIRESTORE_PATHS.photo(PHOTO_CITY, 'p1'), photoDocSchema))?.processing).toBe('pending');
        expect(deps.blobs.paths('private', 'uploads/')).toEqual([
            expect.stringMatching(/^uploads\/photos\/bucuresti\/u-admin\/p1\/reprocess-\d+\.jpg$/),
        ]);
        expect(deps.recording.records.map((record) => record.message)).toContain('restored photo processed again');
    });

    it('badPath_aSweptPhotoWithoutItsOriginalStaysPendingOffThePublicMap', async () => {
        const deps = contentDeps(NOW);
        await deletedPhoto(deps, false);

        await revert(deps, audited);

        expect((await deps.documents.get(FIRESTORE_PATHS.photo(PHOTO_CITY, 'p1'), photoDocSchema))?.processing).toBe('pending');
        expect(deps.blobs.paths('private', 'uploads/')).toEqual([]);
        expect(deps.recording.records.map((record) => record.message)).toContain('restored photo has no original to process again');
    });

    it('happyPath_aPhotoWhosePublicFilesRemainComesBackAsItWas', async () => {
        const deps = contentDeps(NOW);
        await deletedPhoto(deps);
        deps.blobs.put('public', WEB, new Uint8Array([4]), { contentType: 'image/webp' });

        await revert(deps, audited);

        expect((await deps.documents.get(FIRESTORE_PATHS.photo(PHOTO_CITY, 'p1'), photoDocSchema))?.processing).toBe('done');
        expect(deps.blobs.paths('private', 'uploads/')).toEqual([]);
    });

    it('happyPath_aRestoredPhotoWithoutAnImageNeedsNoProcessing', async () => {
        const deps = contentDeps(NOW);
        await seedPhoto(deps, 'p2');
        const previous = await deps.documents.get(FIRESTORE_PATHS.photo(PHOTO_CITY, 'p2'), photoDocSchema);
        await deps.documents.delete(FIRESTORE_PATHS.photo(PHOTO_CITY, 'p2'));
        const unprocessed: AuditedDocument = { entity: 'photo', cityId: PHOTO_CITY, entityId: 'p2' };
        await deletionEntry(deps, unprocessed, { ...(previous ?? {}) });

        await revert(deps, unprocessed);

        expect((await deps.documents.get(FIRESTORE_PATHS.photo(PHOTO_CITY, 'p2'), photoDocSchema))?.processing).toBe('pending');
        expect(deps.blobs.paths('private', 'uploads/')).toEqual([]);
    });
});

describe('a deleted layer on its own tiles (M12)', () => {
    const LAYER = 'own-layer';
    const audited: AuditedDocument = { entity: 'layer', cityId: LAYER_CITY, entityId: LAYER };
    const PATH = STORAGE_PATHS.layerTiles(LAYER_CITY, LAYER, 'v1');

    async function entryNaming(deps: ContentDeps): Promise<void> {
        const url = publicObjectUrl(deps.config.buckets.public, PATH);
        await deletionEntry(deps, audited, { source: { type: 'pmtiles', url } });
    }

    it('badPath_anEntryWhoseArchiveIsGoneRefuses @S-A72-BAD-RESTORE-GONE', async () => {
        const deps = contentDeps(NOW);
        await entryNaming(deps);

        await expect(requireLayerTiles(deps, audited, ENTRY)).rejects.toMatchObject({ code: 'apiError.history.layerGone' });
    });

    it('happyPath_itsArchiveThereItComesBack @S-A72-HAPPY-RESTORE', async () => {
        const deps = contentDeps(NOW);
        await entryNaming(deps);
        deps.blobs.put('public', PATH, new Uint8Array(7));

        await expect(requireLayerTiles(deps, audited, ENTRY)).resolves.toBeUndefined();
    });

    it('happyPath_aPhotoOrALayerOnMapboxIsNotAsked @S-A72-HAPPY-RESTORE', async () => {
        const deps = contentDeps(NOW);
        await deletionEntry(deps, audited, { source: { type: 'mapbox', tilesetId: 'u.t' } });

        await expect(requireLayerTiles(deps, audited, ENTRY)).resolves.toBeUndefined();
        await expect(requireLayerTiles(deps, { ...audited, entity: 'photo' }, ENTRY)).resolves.toBeUndefined();
    });
});
