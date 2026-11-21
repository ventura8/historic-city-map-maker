/**
 * `photos.onUpload` on a photo that already has an image: the admin's Replace image (`docs/research/M2c-interfaces.md`
 * §6.4, CR-M2c-4). A new file swaps the image in one write; a refused one keeps the image, processed and published, and
 * records why in `replacement`; the same file again changes no public file.
 */
import { createHash } from 'node:crypto';

import { STORAGE_PATHS, timestampFromDate, type PhotoDoc } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { UpstreamError } from '../../src/ports/errors.js';
import { processPhotoUpload } from '../../src/photos/upload.js';
import { contentDeps, publicUrl, type ContentDeps } from '../publish/fakes.js';
import { isoMedia, jpeg } from './images.js';
import { CITY, photo, seedPhoto, uploaded } from './world.js';

const NOW = '2026-10-12T08:30:00.000Z';
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** A published photo processed from `bytes`: its derivatives in the public bucket, its original kept. */
async function publishedPhoto(deps: ContentDeps, photoId: string, bytes: Uint8Array, extra: Partial<PhotoDoc> = {}): Promise<PhotoDoc> {
    await seedPhoto(deps, photoId);
    await processPhotoUpload(deps, uploaded(deps, photoId, bytes, { file: 'first-0001.jpg' }));
    const processed = await photo(deps, photoId);
    await seedPhoto(deps, photoId, { ...processed, published: true, ...extra });
    return { ...processed, published: true, ...extra } as PhotoDoc;
}

describe('processPhotoUpload: a replacement', () => {
    it('happyPath_aNewFileSwapsTheImageInOneWriteAndStaysPublished', async () => {
        const deps = contentDeps(NOW);
        const before = await publishedPhoto(deps, 'p1', await jpeg(32, 32), {
            replacement: { error: 'apiError.photo.heicUnsupported', at: timestampFromDate(new Date('2026-10-11T08:00:00.000Z')) },
        });
        const next = await jpeg(48, 32, { make: 'Other' });

        await expect(processPhotoUpload(deps, uploaded(deps, 'p1', next, { file: 'second-0002.jpg' }))).resolves.toBe('done');

        const after = await photo(deps, 'p1');
        expect(after).toMatchObject({
            processing: 'done',
            published: true,
            image: { sha256: sha(next), web: publicUrl(STORAGE_PATHS.photoDerivative(CITY, 'p1', sha(next), 'web')), w: 48, h: 32 },
        });
        expect(after?.replacement).toBeUndefined();
        expect(after?.image?.sha256).not.toBe(before.image?.sha256);
    });

    it('badPath_aRefusedReplacementKeepsTheImagePublished @S-A37-BAD-REFUSED-KEEPS-IMAGE', async () => {
        const deps = contentDeps(NOW);
        const before = await publishedPhoto(deps, 'p1', await jpeg(32, 32));
        const publicFiles = deps.blobs.paths('public');

        await expect(processPhotoUpload(deps, uploaded(deps, 'p1', isoMedia('heic'), { file: 'second-0002.heic' }))).resolves.toBe(
            'failed',
        );

        const after = await photo(deps, 'p1');
        expect(after).toMatchObject({
            processing: 'done',
            published: true,
            image: before.image,
            original: before.original,
            replacement: { error: 'apiError.photo.heicUnsupported', at: timestampFromDate(new Date(NOW)) },
            updatedBy: 'system:photos',
        });
        expect(after?.processingError).toBeUndefined();
        expect(deps.blobs.paths('public')).toEqual(publicFiles);
        expect(deps.blobs.paths('private')).toEqual([before.original?.path]);
    });

    it('badPath_aReplacementThatRepeatsAnotherPhotoNamesIt', async () => {
        const deps = contentDeps(NOW);
        const other = await jpeg(24, 24);
        await publishedPhoto(deps, 'older', other);
        await publishedPhoto(deps, 'p1', await jpeg(32, 32));

        await processPhotoUpload(deps, uploaded(deps, 'p1', other, { file: 'second-0002.jpg' }));

        const after = await photo(deps, 'p1');
        expect(after).toMatchObject({ processing: 'done', replacement: { error: 'apiError.photo.duplicate', duplicateOf: 'older' } });
        expect(after?.duplicateOf).toBeUndefined();
    });

    it('badPath_theSameFileAgainWritesNoNewPublicFile', async () => {
        const deps = contentDeps(NOW);
        const bytes = await jpeg(32, 32);
        const before = await publishedPhoto(deps, 'p1', bytes);
        const publicFiles = deps.blobs.paths('public');

        await expect(processPhotoUpload(deps, uploaded(deps, 'p1', bytes, { file: 'again-0003.jpg' }))).resolves.toBe('done');

        expect(await photo(deps, 'p1')).toMatchObject({ processing: 'done', published: true, image: before.image });
        expect(deps.blobs.paths('public')).toEqual(publicFiles);
    });

    it('badPath_aStorageOutageDuringAReplacementKeepsTheImageAndTheUpload', async () => {
        const deps = contentDeps(NOW);
        const before = await publishedPhoto(deps, 'p1', await jpeg(32, 32));
        const object = uploaded(deps, 'p1', await jpeg(16, 16), { file: 'second-0002.jpg' });
        deps.blobs.recorder.failNext('copy', new UpstreamError('cloud-storage', 'unavailable', { status: 503 }));

        await expect(processPhotoUpload(deps, object)).resolves.toBe('failed');

        expect(await photo(deps, 'p1')).toMatchObject({
            processing: 'done',
            image: before.image,
            replacement: { error: 'apiError.unavailable' },
        });
        expect(deps.blobs.paths('private')).toContain(object.name);
    });
});
