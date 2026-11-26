/**
 * `photos.onUpload`'s handler with the in-memory documents and buckets and the real sharp processor on generated
 * images: what the admin's upload becomes (original, public derivatives, the photo's server-owned fields), every
 * refusal with its code, idempotent redelivery, and failures that are not the file's fault.
 */
import { createHash } from 'node:crypto';

import { STORAGE_PATHS, timestampFromDate } from '@hcm/shared';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { UpstreamError } from '../../src/ports/errors.js';
import { processPhotoUpload } from '../../src/photos/upload.js';
import { contentDeps, publicUrl } from '../publish/fakes.js';
import { PDF, SVG, isoMedia, jpeg, pngHeaderOnly, rotatedJpeg, truncatedJpeg } from './images.js';
import { CITY, photo, seedPhoto, uploaded } from './world.js';

const NOW = '2026-10-12T08:30:00.000Z';
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

const EXIF = {
    make: 'TestCam',
    dateTimeOriginal: '1936:07:01 10:00:00',
    gps: { lat: '44/1 25/1 3000/100', latRef: 'N', lng: '26/1 5/1 0/1', lngRef: 'E' },
    direction: '2012/10',
};

describe('processPhotoUpload: processed', () => {
    it('happyPath_theUploadBecomesOriginalDerivativesAndSuggestions @S-A08-HAPPY-PROCESSED', async () => {
        const deps = contentDeps(NOW);
        await seedPhoto(deps, 'p1', { processingError: 'apiError.unavailable' });
        const bytes = await jpeg(64, 48, EXIF);
        const hash = sha(bytes);
        const object = uploaded(deps, 'p1', bytes, { name: 'Calea Victoriei 1936.jpg' });

        await expect(processPhotoUpload(deps, object)).resolves.toBe('done');

        const web = STORAGE_PATHS.photoDerivative(CITY, 'p1', hash, 'web');
        const thumb = STORAGE_PATHS.photoDerivative(CITY, 'p1', hash, 'thumb');
        const original = STORAGE_PATHS.photoOriginal(CITY, 'p1', hash, 'image/jpeg');
        expect(await photo(deps, 'p1')).toMatchObject({
            title: { ro: 'Calea Victoriei' },
            processing: 'done',
            image: { web: publicUrl(web), thumb: publicUrl(thumb), sha256: hash, w: 64, h: 48 },
            original: { path: original, contentType: 'image/jpeg', bytes: bytes.length, sha256: hash },
            exif: { make: 'TestCam', model: 'M1', dateTimeOriginal: '1936:07:01 10:00:00', gpsImgDirection: 201.2 },
            suggested: { location: { lat: 44.425, lng: 26.083_333 }, bearing: 201.2, year: 1936, title: 'Calea Victoriei 1936' },
            updatedBy: 'system:photos',
            updatedAt: timestampFromDate(new Date(NOW)),
        });
        expect((await photo(deps, 'p1'))?.processingError).toBeUndefined();
        expect(deps.blobs.paths('private')).toEqual([original]);
        expect(deps.blobs.paths('public')).toEqual([thumb, web]);
        expect(deps.blobs.object('public', web)?.options).toEqual({
            contentType: 'image/webp',
            cacheControl: 'public, max-age=31536000, immutable',
            ifGenerationMatch: 0,
            customMetadata: { writtenAt: NOW },
        });
        expect((await sharp(deps.blobs.object('public', web)?.bytes).metadata()).exif).toBeUndefined();
    });

    it('happyPath_theThumbnailIsAtMost400Pixels', async () => {
        const deps = contentDeps(NOW);
        await seedPhoto(deps, 'p1');
        const bytes = await jpeg(900, 300);

        await processPhotoUpload(deps, uploaded(deps, 'p1', bytes));

        const thumb = deps.blobs.object('public', STORAGE_PATHS.photoDerivative(CITY, 'p1', sha(bytes), 'thumb'));
        expect(await sharp(thumb?.bytes).metadata()).toMatchObject({ width: 400, height: 133 });
        expect((await photo(deps, 'p1'))?.suggested).toBeUndefined();
    });

    it('happyPath_theOriginalIsDecodedOnceAndTheThumbnailComesUprightFromTheWebDerivative @S-A08-HAPPY-THUMB-FROM-WEB', async () => {
        // 2026-11-12 (reports/resource-audit.md item 10): the second decode of the original is gone; the thumbnail is the web WebP's.
        const deps = contentDeps(NOW);
        await seedPhoto(deps, 'p1');
        const bytes = await rotatedJpeg(3000, 1000);
        const inputs: Uint8Array[] = [];
        const images = {
            ...deps.images,
            webp: (input: Uint8Array, options: { readonly longEdge: number; readonly quality: number }) => {
                inputs.push(input);
                return deps.images.webp(input, options);
            },
        };

        await expect(processPhotoUpload({ ...deps, images }, uploaded(deps, 'p1', bytes))).resolves.toBe('done');

        const web = deps.blobs.object('public', STORAGE_PATHS.photoDerivative(CITY, 'p1', sha(bytes), 'web'));
        const thumb = deps.blobs.object('public', STORAGE_PATHS.photoDerivative(CITY, 'p1', sha(bytes), 'thumb'));
        expect(inputs).toEqual([bytes, web?.bytes]);
        expect(await sharp(web?.bytes).metadata()).toMatchObject({ width: 683, height: 2048 });
        expect(await sharp(thumb?.bytes).metadata()).toMatchObject({ width: 133, height: 400 });
    });

    it('badPath_anOriginalThatDoesNotDecodeMakesNoThumbnailAttempt @S-A08-BAD-NO-THUMB-ATTEMPT', async () => {
        const deps = contentDeps(NOW);
        await seedPhoto(deps, 'p1');
        const calls: number[] = [];
        const images = {
            ...deps.images,
            webp: (_input: Uint8Array, options: { readonly longEdge: number; readonly quality: number }) => {
                calls.push(options.longEdge);
                return Promise.reject(new UpstreamError('image', 'invalid'));
            },
        };

        await processPhotoUpload({ ...deps, images }, uploaded(deps, 'p1', await jpeg(16, 16)));

        expect(calls).toEqual([2048]);
        expect(await photo(deps, 'p1')).toMatchObject({ processing: 'failed', processingError: 'apiError.photo.unreadable' });
        expect(deps.blobs.paths('public')).toEqual([]);
    });

    it('happyPath_aRedeliveredEventFindsItsDerivativesAndStillFinishes', async () => {
        const deps = contentDeps(NOW);
        await seedPhoto(deps, 'p1');
        const bytes = await jpeg(32, 32);
        deps.blobs.put('public', STORAGE_PATHS.photoDerivative(CITY, 'p1', sha(bytes), 'web'), new Uint8Array([1]));

        await expect(processPhotoUpload(deps, uploaded(deps, 'p1', bytes))).resolves.toBe('done');
        expect((await photo(deps, 'p1'))?.processing).toBe('done');
    });

    it('happyPath_reprocessingThePhotosOwnOriginalIsNoDuplicate', async () => {
        const deps = contentDeps(NOW);
        const bytes = await jpeg(32, 32);
        const hash = sha(bytes);
        await seedPhoto(deps, 'p1', {
            original: {
                path: STORAGE_PATHS.photoOriginal(CITY, 'p1', hash, 'image/jpeg'),
                contentType: 'image/jpeg',
                bytes: bytes.length,
                sha256: hash,
            },
        });

        await expect(processPhotoUpload(deps, uploaded(deps, 'p1', bytes, { file: 'reprocess-1791789188694.jpg' }))).resolves.toBe('done');
    });

    it('badPath_aPhotoDeletedWhileProcessingStaysDeleted', async () => {
        const deps = contentDeps(NOW);
        await seedPhoto(deps, 'p1');
        const images = {
            ...deps.images,
            webp: async (bytes: Uint8Array, options: { readonly longEdge: number; readonly quality: number }) => {
                await deps.documents.delete(`cities/${CITY}/photos/p1`);
                return deps.images.webp(bytes, options);
            },
        };

        await expect(processPhotoUpload({ ...deps, images }, uploaded(deps, 'p1', await jpeg(16, 16)))).resolves.toBe('done');
        expect(await photo(deps, 'p1')).toBeUndefined();
    });
});

describe('processPhotoUpload: not a photo upload', () => {
    it('badPath_anotherObjectIsIgnored', async () => {
        const deps = contentDeps(NOW);

        await expect(processPhotoUpload(deps, { name: 'uploads/rasters/bucuresti/u/x/f.tif', size: 10, metadata: {} })).resolves.toBe(
            'ignored',
        );
        expect(deps.blobs.recorder.calls).toEqual([]);
    });

    it('badPath_anUploadWithoutItsPhotoDocumentIsDeleted', async () => {
        const deps = contentDeps(NOW);
        const object = uploaded(deps, 'ghost', await jpeg(8, 8));

        await expect(processPhotoUpload(deps, object)).resolves.toBe('orphan');
        expect(deps.blobs.paths('private')).toEqual([]);
        expect(deps.recording.records.at(-1)?.message).toBe('upload without its photo document deleted');
    });

    it('badPath_anUploadAlreadyProcessedAndDeletedIsGone', async () => {
        const deps = contentDeps(NOW);
        await seedPhoto(deps, 'p1');
        const object = uploaded(deps, 'p1', await jpeg(8, 8));
        await deps.blobs.delete('private', object.name);

        await expect(processPhotoUpload(deps, object)).resolves.toBe('gone');
        expect((await photo(deps, 'p1'))?.processing).toBe('pending');
    });
});

describe('processPhotoUpload: refused', () => {
    it.each([
        ['an SVG @S-A08-BAD-NOT-A-PHOTO', () => Promise.resolve(SVG), 'apiError.photo.unsupportedType'],
        ['a PDF @S-A08-BAD-NOT-A-PHOTO', () => Promise.resolve(PDF), 'apiError.photo.unsupportedType'],
        ['an HEIC photo (not decodable here) @S-A08-BAD-HEIC', () => Promise.resolve(isoMedia('heic')), 'apiError.photo.heicUnsupported'],
        ['a 240-megapixel image @S-A08-BAD-PIXEL-LIMIT', () => Promise.resolve(pngHeaderOnly(20_000, 12_000)), 'apiError.photo.tooLarge'],
        ['a truncated JPEG', truncatedJpeg, 'apiError.photo.unreadable'],
        ['a PNG whose pixels cannot be decoded', () => Promise.resolve(pngHeaderOnly(64, 64)), 'apiError.photo.unreadable'],
    ])('badPath_%s', async (_name, make, code) => {
        const deps = contentDeps(NOW);
        await seedPhoto(deps, 'p1');

        await expect(processPhotoUpload(deps, uploaded(deps, 'p1', await make()))).resolves.toBe('failed');

        expect(await photo(deps, 'p1')).toMatchObject({ processing: 'failed', processingError: code, updatedBy: 'system:photos' });
        expect(deps.blobs.paths('private')).toEqual([]);
        expect(deps.blobs.paths('public')).toEqual([]);
        expect(deps.recording.records.at(-1)).toMatchObject({ message: 'photo refused', data: { code } });
    });

    it('badPath_aFileOverTheUploadLimitIsNeverRead', async () => {
        const deps = contentDeps(NOW);
        await seedPhoto(deps, 'p1');
        const object = { ...uploaded(deps, 'p1', await jpeg(8, 8)), size: 61 * 1024 * 1024 };

        await processPhotoUpload(deps, object);

        expect(await photo(deps, 'p1')).toMatchObject({ processing: 'failed', processingError: 'apiError.photo.tooLarge' });
        expect(deps.blobs.recorder.argsOf('read')).toEqual([]);
    });

    it('badPath_theSameFileAsAnotherPhotoIsADuplicate @S-A08-BAD-DUPLICATE-HASH', async () => {
        const deps = contentDeps(NOW);
        const bytes = await jpeg(24, 24);
        const hash = sha(bytes);
        await seedPhoto(deps, 'older', {
            processing: 'done',
            original: {
                path: STORAGE_PATHS.photoOriginal(CITY, 'older', hash, 'image/jpeg'),
                contentType: 'image/jpeg',
                bytes: 1,
                sha256: hash,
            },
        });
        await seedPhoto(deps, 'p1', { duplicateOf: 'stale' });

        await processPhotoUpload(deps, uploaded(deps, 'p1', bytes));

        expect(await photo(deps, 'p1')).toMatchObject({
            processing: 'failed',
            processingError: 'apiError.photo.duplicate',
            duplicateOf: 'older',
        });
        expect(deps.blobs.paths('public')).toEqual([]);
    });
});

describe("processPhotoUpload: the old site's photos", () => {
    it('happyPath_twoLegacyPhotosOfOneImageAreBothProcessed', async () => {
        const deps = contentDeps(NOW);
        const bytes = await jpeg(24, 24);
        const hash = sha(bytes);
        const original = {
            path: STORAGE_PATHS.photoOriginal(CITY, 'left', hash, 'image/jpeg'),
            contentType: 'image/jpeg' as const,
            bytes: 1,
            sha256: hash,
        };
        await seedPhoto(deps, 'left', { processing: 'done', legacyId: 'legacy-left', original });
        await seedPhoto(deps, 'right', { legacyId: 'legacy-right' });

        await processPhotoUpload(deps, uploaded(deps, 'right', bytes));

        expect(await photo(deps, 'right')).toMatchObject({ processing: 'done', original: { sha256: hash } });
    });

    it('badPath_aNewPhotoOfALegacyImageIsStillADuplicate', async () => {
        const deps = contentDeps(NOW);
        const bytes = await jpeg(24, 24);
        const hash = sha(bytes);
        const original = {
            path: STORAGE_PATHS.photoOriginal(CITY, 'left', hash, 'image/jpeg'),
            contentType: 'image/jpeg' as const,
            bytes: 1,
            sha256: hash,
        };
        await seedPhoto(deps, 'left', { processing: 'done', legacyId: 'legacy-left', original });
        await seedPhoto(deps, 'p1');

        await processPhotoUpload(deps, uploaded(deps, 'p1', bytes));

        expect(await photo(deps, 'p1')).toMatchObject({
            processing: 'failed',
            processingError: 'apiError.photo.duplicate',
            duplicateOf: 'left',
        });
    });
});

describe('processPhotoUpload: failures that are not the file', () => {
    it('badPath_anUnavailableBucketIsRetryableAndKeepsTheUpload @S-A08-BAD-STORAGE-DOWN', async () => {
        const deps = contentDeps(NOW);
        await seedPhoto(deps, 'p1', { duplicateOf: 'stale' });
        const object = uploaded(deps, 'p1', await jpeg(16, 16));
        deps.blobs.recorder.failNext('copy', new UpstreamError('cloud-storage', 'unavailable', { status: 503 }));

        await expect(processPhotoUpload(deps, object)).resolves.toBe('failed');

        const stored = await photo(deps, 'p1');
        expect([stored?.processing, stored?.processingError, stored?.duplicateOf]).toEqual(['failed', 'apiError.unavailable', undefined]);
        expect(deps.blobs.paths('private')).toEqual([object.name]);
        expect(deps.recording.records.at(-1)).toMatchObject({ level: 'error', message: 'photo processing failed' });
    });

    it('badPath_anUploadThatCannotBeReadIsRetryable', async () => {
        const deps = contentDeps(NOW);
        await seedPhoto(deps, 'p1');
        deps.blobs.recorder.failNext('read', new UpstreamError('cloud-storage', 'rateLimited', { status: 429 }));

        await processPhotoUpload(deps, uploaded(deps, 'p1', await jpeg(16, 16)));

        expect((await photo(deps, 'p1'))?.processingError).toBe('apiError.unavailable');
    });

    it('badPath_aProcessorFailureThatIsNoUnreadableFileIsInternal', async () => {
        const deps = contentDeps(NOW);
        await seedPhoto(deps, 'p1');
        const images = { ...deps.images, inspect: () => Promise.reject(new Error('sharp crashed')) };

        await processPhotoUpload({ ...deps, images }, uploaded(deps, 'p1', await jpeg(16, 16)));

        expect((await photo(deps, 'p1'))?.processingError).toBe('apiError.internal');
    });

    it('badPath_anUnexpectedFailureIsInternal', async () => {
        const deps = contentDeps(NOW);
        await seedPhoto(deps, 'p1');
        deps.documents.recorder.failNext('query', new Error('query failed'));

        await processPhotoUpload(deps, uploaded(deps, 'p1', await jpeg(16, 16)));

        expect((await photo(deps, 'p1'))?.processingError).toBe('apiError.internal');
    });

    it('badPath_aWriteThatFailsOtherwiseIsNotSwallowed', async () => {
        const deps = contentDeps(NOW);
        await seedPhoto(deps, 'p1');
        deps.blobs.recorder.failNext('write', new UpstreamError('cloud-storage', 'forbidden', { status: 403 }));

        await processPhotoUpload(deps, uploaded(deps, 'p1', await jpeg(16, 16)));

        expect((await photo(deps, 'p1'))?.processingError).toBe('apiError.internal');
    });
});
