/**
 * `photos.onUpload` with an improved or colorized version (the owner 2026-11-09; A140): an upload whose custom metadata names
 * the version becomes `versions.<version>` (its own content-hashed WebP pair and original), the photo's image, processing and
 * publication untouched; a pending photo or a file that is no photo is refused into `replacement`, the photo as it was.
 */
import { createHash } from 'node:crypto';

import { STORAGE_PATHS, type PhotoDoc } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { processPhotoUpload, versionOf, type FinalizedObject, type UploadOutcome } from '../../src/photos/upload.js';
import { contentDeps, publicUrl, type ContentDeps } from '../publish/fakes.js';
import { PDF, jpeg } from './images.js';
import { CITY, photo, seedPhoto } from './world.js';

const NOW = '2026-11-09T08:30:00.000Z';
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const IMAGE = {
    web: 'https://storage.googleapis.com/pub/w.webp',
    thumb: 'https://storage.googleapis.com/pub/t.webp',
    sha256: 'a'.repeat(64),
    w: 4,
    h: 3,
};
const DONE: Partial<PhotoDoc> = { processing: 'done', image: IMAGE, published: true };

function versionUpload(
    deps: ContentDeps,
    bytes: Uint8Array,
    version: string,
    options: { file?: string; timeCreated?: Date | string } = {},
): FinalizedObject {
    const path = STORAGE_PATHS.photoUpload(CITY, 'u-admin', 'p1', options.file ?? 'nonce-0002.jpg');
    const metadata = { originalName: 'color.jpg', version };
    deps.blobs.put('private', path, bytes, { contentType: 'image/jpeg', customMetadata: metadata });
    return {
        name: path,
        size: String(bytes.length),
        metadata,
        ...(options.timeCreated === undefined ? {} : { timeCreated: options.timeCreated }),
    };
}

describe('processPhotoUpload: a version', () => {
    it('happyPath_aColorizedVersionBesideTheImage', async () => {
        const deps = contentDeps(NOW);
        await seedPhoto(deps, 'p1', DONE);
        const bytes = await jpeg(64, 48);
        const hash = sha(bytes);

        await expect(processPhotoUpload(deps, versionUpload(deps, bytes, 'colorized'))).resolves.toBe('done');

        const web = STORAGE_PATHS.photoDerivative(CITY, 'p1', hash, 'web');
        const thumb = STORAGE_PATHS.photoDerivative(CITY, 'p1', hash, 'thumb');
        const original = STORAGE_PATHS.photoOriginal(CITY, 'p1', hash, 'image/jpeg');
        expect(await photo(deps, 'p1')).toMatchObject({
            ...DONE,
            versions: {
                colorized: {
                    image: { web: publicUrl(web), thumb: publicUrl(thumb), sha256: hash, w: 64, h: 48 },
                    original: { path: original, contentType: 'image/jpeg', bytes: bytes.length, sha256: hash },
                },
            },
            updatedBy: 'system:photos',
        });
        expect(deps.blobs.paths('private')).toEqual([original]);
    });

    it('badPath_aPhotoThatWaitsForReviewTakesNoVersion', async () => {
        const deps = contentDeps(NOW);
        await seedPhoto(deps, 'p1', { reviewStatus: 'pending' });

        await expect(processPhotoUpload(deps, versionUpload(deps, await jpeg(8, 8), 'improved'))).resolves.toBe('failed');

        const after = await photo(deps, 'p1');
        expect(after).toMatchObject({ processing: 'pending', replacement: { error: 'apiError.photo.versionNotAllowed' } });
        expect(after?.versions).toBeUndefined();
        expect(deps.blobs.paths('private')).toEqual([]);
        expect(deps.blobs.paths('public')).toEqual([]);
    });

    it('badPath_aFileThatIsNoPhotoIsRefusedAndThePhotoStays', async () => {
        const deps = contentDeps(NOW);
        await seedPhoto(deps, 'p1', DONE);

        await expect(processPhotoUpload(deps, versionUpload(deps, PDF, 'improved'))).resolves.toBe('failed');

        expect(await photo(deps, 'p1')).toMatchObject({ ...DONE, replacement: { error: 'apiError.photo.unsupportedType' } });
    });

    it('badPath_anUnknownVersionIsThePhotosOwnImage', () => {
        expect([versionOf({ version: 'sepia' }), versionOf({}), versionOf({ version: 'improved' })]).toEqual([
            undefined,
            undefined,
            'improved',
        ]);
    });

    it('badPath_anOlderVersionUploadFinishingAfterANewerOneNeverOverwritesIt', async () => {
        const deps = contentDeps(NOW);
        await seedPhoto(deps, 'p1', DONE);
        const older = await jpeg(32, 32);
        const newer = await jpeg(64, 48);
        const olderObject = versionUpload(deps, older, 'colorized', {
            file: 'color-0001.jpg',
            timeCreated: '2026-11-09T08:30:01.000Z',
        });
        const newerObject = versionUpload(deps, newer, 'colorized', {
            file: 'color-0002.jpg',
            timeCreated: '2026-11-09T08:30:05.000Z',
        });
        let newerOutcome: UploadOutcome | undefined;
        const slowImages = {
            ...deps.images,
            webp: async (bytes: Uint8Array, options: { readonly longEdge: number; readonly quality: number }) => {
                newerOutcome ??= await processPhotoUpload(deps, newerObject);
                return deps.images.webp(bytes, options);
            },
        };

        await expect(processPhotoUpload({ ...deps, images: slowImages }, olderObject)).resolves.toBe('stale');

        expect(newerOutcome).toBe('done');
        const after = await photo(deps, 'p1');
        expect(after?.versions?.colorized?.image.sha256).toBe(sha(newer));
        expect(after?.versions?.colorized?.original.sha256).toBe(sha(newer));
        expect(after?.latestUploads?.colorized?.upload).toBe(newerObject.name);
        expect(deps.blobs.paths('private', 'uploads/')).toEqual([]);
    });

    it('happyPath_concurrentUploadsForDifferentSlotsBothApply', async () => {
        const deps = contentDeps(NOW);
        await seedPhoto(deps, 'p1', DONE);
        const improved = await jpeg(40, 30);
        const colorized = await jpeg(48, 36);
        const improvedObject = versionUpload(deps, improved, 'improved', { file: 'imp-0001.jpg' });
        const colorizedObject = versionUpload(deps, colorized, 'colorized', { file: 'col-0001.jpg' });
        let colorizedOutcome: UploadOutcome | undefined;
        const interleavedImages = {
            ...deps.images,
            webp: async (bytes: Uint8Array, options: { readonly longEdge: number; readonly quality: number }) => {
                colorizedOutcome ??= await processPhotoUpload(deps, colorizedObject);
                return deps.images.webp(bytes, options);
            },
        };

        await expect(processPhotoUpload({ ...deps, images: interleavedImages }, improvedObject)).resolves.toBe('done');

        expect(colorizedOutcome).toBe('done');
        const after = await photo(deps, 'p1');
        expect(after?.versions?.improved?.image.sha256).toBe(sha(improved));
        expect(after?.versions?.colorized?.image.sha256).toBe(sha(colorized));
    });
});
