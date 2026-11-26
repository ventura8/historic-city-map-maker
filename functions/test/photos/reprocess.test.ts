/**
 * `photos.reprocess`: the photo goes back to `pending` and its original (or the upload a transient failure kept) is
 * copied into a new upload of the caller's folder, which `photos.onUpload` then processes again.
 */
import { STORAGE_PATHS } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import type { VerifiedCaller } from '../../src/api/access.js';
import { processPhotoUpload } from '../../src/photos/upload.js';
import { reprocessFunction, reprocessPhoto } from '../../src/photos/reprocess.js';
import { adminCall, contentDeps } from '../publish/fakes.js';
import { jpeg } from './images.js';
import { CITY, photo, seedPhoto, uploaded } from './world.js';

const NOW = '2026-10-12T09:00:00.000Z';
const ADMIN: VerifiedCaller = { uid: 'u-admin', email: undefined, claim: true };
const ORIGINAL = STORAGE_PATHS.photoOriginal(CITY, 'p1', 'a'.repeat(64), 'image/tiff');
const REPROCESS_UPLOAD = STORAGE_PATHS.photoUpload(CITY, 'u-admin', 'p1', `reprocess-${String(Date.parse(NOW))}.tif`);

describe('reprocessPhoto', () => {
    it('happyPath_theOriginalBecomesANewUpload', async () => {
        const deps = contentDeps(NOW);
        await seedPhoto(deps, 'p1', {
            processing: 'failed',
            processingError: 'apiError.unavailable',
            original: { path: ORIGINAL, contentType: 'image/tiff', bytes: 4, sha256: 'a'.repeat(64) },
        });
        deps.blobs.put('private', ORIGINAL, new Uint8Array([1, 2, 3, 4]), {
            contentType: 'image/tiff',
            customMetadata: { originalName: 'scan.tif' },
        });

        await expect(reprocessPhoto(deps, ADMIN, { cityId: CITY, photoId: 'p1' })).resolves.toEqual({ processing: 'pending' });

        expect(await photo(deps, 'p1')).toMatchObject({ processing: 'pending', updatedBy: 'u-admin' });
        expect((await photo(deps, 'p1'))?.processingError).toBeUndefined();
        expect(deps.blobs.object('private', REPROCESS_UPLOAD)?.options.customMetadata).toEqual({ originalName: 'scan.tif' });
    });

    it('happyPath_withoutAnOriginalTheKeptUploadIsUsedAndProcessedAgain @S-A08-BAD-STORAGE-DOWN', async () => {
        const deps = contentDeps(NOW);
        await seedPhoto(deps, 'p1', { processing: 'failed', processingError: 'apiError.unavailable' });
        const kept = uploaded(deps, 'p1', await jpeg(10, 10));
        uploaded(deps, 'other', await jpeg(4, 4));

        await reprocessPhoto(deps, ADMIN, { cityId: CITY, photoId: 'p1' });
        const copy = STORAGE_PATHS.photoUpload(CITY, 'u-admin', 'p1', `reprocess-${String(Date.parse(NOW))}.jpg`);
        await processPhotoUpload(deps, { name: copy, size: 100, metadata: {} });

        expect((await photo(deps, 'p1'))?.processing).toBe('done');
        expect(deps.blobs.paths('private', 'uploads/')).toEqual(
            [kept.name, STORAGE_PATHS.photoUpload(CITY, 'u-admin', 'other', 'nonce-0001.jpg')].sort((a, b) => a.localeCompare(b)),
        );
    });

    it('badPath_anOriginalThatIsGoneFallsBackToTheUploads', async () => {
        const deps = contentDeps(NOW);
        await seedPhoto(deps, 'p1', { original: { path: ORIGINAL, contentType: 'image/tiff', bytes: 4, sha256: 'a'.repeat(64) } });

        await expect(reprocessPhoto(deps, ADMIN, { cityId: CITY, photoId: 'p1' })).rejects.toMatchObject({ code: 'apiError.notFound' });
        expect((await photo(deps, 'p1'))?.processing).toBe('pending');
    });

    it('badPath_aMissingPhotoIsNotFound', async () => {
        const deps = contentDeps(NOW);

        await expect(reprocessPhoto(deps, ADMIN, { cityId: CITY, photoId: 'ghost' })).rejects.toMatchObject({ code: 'apiError.notFound' });
        expect(deps.blobs.recorder.calls).toEqual([]);
    });

    it('badPath_aPhotoDeletedMeanwhileIsNotFoundAndNothingIsCopied', async () => {
        const deps = contentDeps(NOW);
        await seedPhoto(deps, 'p1');
        uploaded(deps, 'p1', await jpeg(4, 4));
        const blobs = {
            ...deps.blobs,
            list: async (bucket: 'private' | 'public', prefix: string) => {
                await deps.documents.delete(`cities/${CITY}/photos/p1`);
                return deps.blobs.list(bucket, prefix);
            },
        };

        await expect(reprocessPhoto({ ...deps, blobs }, ADMIN, { cityId: CITY, photoId: 'p1' })).rejects.toMatchObject({
            code: 'apiError.notFound',
        });
        expect(deps.blobs.recorder.argsOf('copy')).toEqual([]);
    });
});

describe('photos-reprocess', () => {
    it('happyPath_anAdminCallsIt', async () => {
        const deps = contentDeps(NOW);
        await seedPhoto(deps, 'p1');
        uploaded(deps, 'p1', await jpeg(4, 4));

        await expect(reprocessFunction(() => deps).run(adminCall({ cityId: CITY, photoId: 'p1' }))).resolves.toEqual({
            processing: 'pending',
        });
    });

    it('badPath_aNonAdminIsRefused', async () => {
        const deps = contentDeps(NOW);

        await expect(reprocessFunction(() => deps).run(adminCall({ cityId: CITY, photoId: 'p1' }, 'u-stranger'))).rejects.toMatchObject({
            code: 'permission-denied',
            details: { code: 'apiError.notAdmin' },
        });
    });
});
