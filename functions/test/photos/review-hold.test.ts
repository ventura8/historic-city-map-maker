/**
 * M13 §2, §9: whose upload reaches the public bucket. What decides is who uploaded (the path's uid) and whether the item waits, read
 * when the trigger runs: a late upload of an uploader never replaces an approved picture, and a refused photo never gets an address.
 */
import { FIRESTORE_PATHS, STORAGE_PATHS, adminDocSchema, photoDocSchema, timestampFromDate, type PhotoDoc } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { processPhotoUpload } from '../../src/photos/upload.js';
import { contentDeps, type ContentDeps } from '../publish/fakes.js';
import { jpeg } from './images.js';
import { CITY, photo, seedPhoto } from './world.js';

const NOW = '2026-10-12T08:30:00.000Z';
const AT = timestampFromDate(new Date(NOW));
const IMAGE = {
    web: 'https://storage.googleapis.com/demo-hcm-public/photos/bucuresti/p1/aaaaaaaa/web.webp',
    thumb: 'https://storage.googleapis.com/demo-hcm-public/photos/bucuresti/p1/aaaaaaaa/thumb.webp',
    sha256: 'a'.repeat(64),
    w: 10,
    h: 10,
};

async function member(deps: ContentDeps, uid: string, role: 'moderator' | 'uploader' | 'editor'): Promise<void> {
    await deps.documents.set(FIRESTORE_PATHS.admin(uid), adminDocSchema, {
        role: 'admin',
        cities: { [CITY]: role },
        createdAt: AT,
        updatedBy: uid,
        updatedAt: AT,
    });
}

async function upload(deps: ContentDeps, uid: string): Promise<'ignored' | 'orphan' | 'gone' | 'failed' | 'done'> {
    const bytes = await jpeg(40, 30);
    const name = STORAGE_PATHS.photoUpload(CITY, uid, 'p1', 'nonce-0001.jpg');
    deps.blobs.put('private', name, bytes, { contentType: 'image/jpeg' });
    return processPhotoUpload(deps, { name, size: String(bytes.length), metadata: {} });
}

async function world(fields: Partial<PhotoDoc>): Promise<ContentDeps> {
    const deps = contentDeps(NOW);
    await member(deps, 'u-up', 'uploader');
    await member(deps, 'u-mod', 'moderator');
    await seedPhoto(deps, 'p1', { createdBy: 'u-up', ...fields });
    return deps;
}

describe("whose upload goes public (M13 §2's hold)", () => {
    it('badPath_anUploadersLateUploadNeverReplacesAnApprovedPicture @S-A90-BAD-LATE-UPLOAD', async () => {
        const deps = await world({ reviewStatus: 'approved', published: true, processing: 'done', image: IMAGE });
        await expect(upload(deps, 'u-up')).resolves.toBe('failed');
        const stored = await photo(deps, 'p1');
        expect(stored?.image).toEqual(IMAGE);
        expect(stored?.published).toBe(true);
        expect(stored?.replacement?.error).toBe('apiError.review.alreadyDecided');
        expect(deps.blobs.paths('public')).toEqual([]);
        expect(deps.blobs.paths('private', 'uploads/')).toEqual([]);
    });

    it('badPath_anAccountNoLongerAReviewerIsTreatedAsAnUploader', async () => {
        const deps = await world({ reviewStatus: 'approved', published: true, processing: 'done', image: IMAGE });
        await expect(upload(deps, 'u-gone')).resolves.toBe('failed');
        expect((await photo(deps, 'p1'))?.image).toEqual(IMAGE);
    });

    it('happyPath_aReviewersUploadStillReplacesAnApprovedPicture', async () => {
        const deps = await world({ reviewStatus: 'approved', published: true, processing: 'done', image: IMAGE });
        await expect(upload(deps, 'u-mod')).resolves.toBe('done');
        const stored = await photo(deps, 'p1');
        expect(stored?.image?.web).not.toBe(IMAGE.web);
        expect(stored?.heldImage).toBeUndefined();
    });

    it.each(['u-up', 'u-mod'])('badPath_aRefusedPhotoNeverGetsAPublicAddress, upload by %s @S-A90-BAD-REFUSED-NO-ADDRESS', async (uid) => {
        const deps = await world({ reviewStatus: 'refused', processing: 'pending' });
        await expect(upload(deps, uid)).resolves.toBe('failed');
        const stored = await photo(deps, 'p1');
        expect(stored?.image).toBeUndefined();
        expect(stored?.heldImage).toBeUndefined();
        expect(stored).toMatchObject({ processing: 'failed', processingError: 'apiError.review.alreadyDecided', reviewStatus: 'refused' });
        expect(deps.blobs.paths('public')).toEqual([]);
    });

    it('happyPath_aPendingPhotoIsHeldWhoeverUploads', async () => {
        const deps = await world({ reviewStatus: 'pending' });
        await expect(upload(deps, 'u-mod')).resolves.toBe('done');
        const stored = await photo(deps, 'p1');
        expect(stored?.image).toBeUndefined();
        expect(stored?.heldImage?.web).toContain('review-held/');
        expect(deps.blobs.paths('public')).toEqual([]);
    });

    it('badPath_aPhotoDecidedWhileItsUploadRunsKeepsItsPublicPicture', async () => {
        const deps = await world({ reviewStatus: 'pending' });
        const webp = deps.images.webp.bind(deps.images);
        deps.images.webp = async (bytes, options) => {
            const path = FIRESTORE_PATHS.photo(CITY, 'p1');
            const current = await deps.documents.get(path, photoDocSchema);
            if (current?.reviewStatus === 'pending') {
                await deps.documents.set(path, photoDocSchema, { ...current, reviewStatus: 'approved', published: true, image: IMAGE });
            }
            return webp(bytes, options);
        };
        await expect(upload(deps, 'u-up')).resolves.toBe('failed');
        const stored = await photo(deps, 'p1');
        expect(stored?.image).toEqual(IMAGE);
        expect(stored?.heldImage).toBeUndefined();
        expect(deps.blobs.paths('private', 'review-held/')).toEqual([]);
    });
});
