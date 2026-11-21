/** `review.decide` (M13 §2): the one door out of the queue. Through the callable's `.run()`, so its access is tested too. */
import {
    FIRESTORE_PATHS,
    STORAGE_PATHS,
    photoDocSchema,
    poiDocSchema,
    timestampFromDate,
    timestampToDate,
    type PhotoDoc,
} from '@hcm/shared';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { UpstreamError } from '../../src/ports/errors.js';
import { processPhotoUpload } from '../../src/photos/upload.js';
import { reviewFunctions } from '../../src/photos/review-decide.js';
import { poiDoc } from '../publish/city.js';
import { AT, CITY_ID, as, communityWorld, refusal, seedMember, seedPhoto, type CommunityWorld } from './community-world.js';

const SHA = 'a'.repeat(64);
const HELD = {
    web: STORAGE_PATHS.reviewHeld(CITY_ID, 'p1', SHA, 'web'),
    thumb: STORAGE_PATHS.reviewHeld(CITY_ID, 'p1', SHA, 'thumb'),
    sha256: SHA,
    w: 10,
    h: 10,
};

async function pending(world: CommunityWorld, overrides: Partial<PhotoDoc> = {}): Promise<void> {
    await seedPhoto(world, 'p1', {
        image: undefined,
        published: false,
        reviewStatus: 'pending',
        createdBy: 'u-uploader',
        heldImage: HELD,
        ...overrides,
    });
    world.blobs.put('private', HELD.web, new Uint8Array([1]));
    world.blobs.put('private', HELD.thumb, new Uint8Array([2]));
}

/** The instant a reviewer's card read the item: an approval says it (M13 §2). */
const SEEN = timestampToDate(AT).toISOString();

function decide(world: CommunityWorld, uid: string | null, data: Record<string, unknown>) {
    return reviewFunctions(() => world).decide.run(
        as(uid, { cityId: CITY_ID, entity: 'photo', id: 'p1', decision: 'approve', seenAt: SEEN, ...data }),
    );
}

const stored = (world: CommunityWorld) => world.documents.get(FIRESTORE_PATHS.photo(CITY_ID, 'p1'), photoDocSchema);

describe('review.decide', () => {
    it('happyPath_approvingPublishesThePhotoAndMovesItsPicturesOut @S-A90-HAPPY-APPROVE', async () => {
        const world = await communityWorld();
        await pending(world);
        await expect(decide(world, 'u-moderator', {})).resolves.toEqual({ status: 'approved' });
        const photo = await stored(world);
        expect(photo).toMatchObject({ published: true, reviewStatus: 'approved', reviewedBy: 'u-moderator', updatedBy: 'u-moderator' });
        expect(photo?.heldImage).toBeUndefined();
        expect(photo?.image?.web).toContain('demo-hcm-public');
        expect(world.blobs.paths('private', 'review-held/')).toEqual([]);
        expect(world.blobs.paths('public', 'photos/')).toHaveLength(2);
    });

    it('happyPath_refusingKeepsItPrivateAndDeletesThePictures @S-A90-HAPPY-REFUSE', async () => {
        const world = await communityWorld();
        await pending(world);
        await expect(decide(world, 'u-editor', { decision: 'refuse', note: 'Nu e din oraș.' })).resolves.toEqual({ status: 'refused' });
        expect(await stored(world)).toMatchObject({ published: false, reviewStatus: 'refused', reviewNote: 'Nu e din oraș.' });
        expect(world.blobs.paths('private', 'review-held/')).toEqual([]);
        expect(world.blobs.paths('public')).toEqual([]);
    });

    it('happyPath_aPlaceIsApprovedAndRefused', async () => {
        const world = await communityWorld();
        const seed = (id: string) =>
            world.documents.set(
                FIRESTORE_PATHS.poi(CITY_ID, id),
                poiDocSchema,
                poiDoc({ published: false, reviewStatus: 'pending', yearStart: 1850 }),
            );
        await seed('a');
        await seed('b');
        await decide(world, 'u-owner', { entity: 'poi', id: 'a' });
        await decide(world, 'u-owner', { entity: 'poi', id: 'b', decision: 'refuse' });
        expect(await world.documents.get(FIRESTORE_PATHS.poi(CITY_ID, 'a'), poiDocSchema)).toMatchObject({
            published: true,
            reviewStatus: 'approved',
        });
        expect(await world.documents.get(FIRESTORE_PATHS.poi(CITY_ID, 'b'), poiDocSchema)).toMatchObject({
            published: false,
            reviewStatus: 'refused',
        });
    });

    it('badPath_aPlaceWithoutAYearIsNotApprovedButCanBeRefused @S-A90-BAD-PLACE-YEAR', async () => {
        const world = await communityWorld();
        const path = FIRESTORE_PATHS.poi(CITY_ID, 'a');
        await world.documents.set(path, poiDocSchema, poiDoc({ published: false, reviewStatus: 'pending' }));
        expect(await refusal(decide(world, 'u-owner', { entity: 'poi', id: 'a' }))).toBe('apiError.review.placeYear');
        expect(await world.documents.get(path, poiDocSchema)).toMatchObject({ published: false, reviewStatus: 'pending' });
        await expect(decide(world, 'u-owner', { entity: 'poi', id: 'a', decision: 'refuse' })).resolves.toEqual({ status: 'refused' });
    });
});

describe('review.decide: what the reviewer saw, and the public bucket', () => {
    it('badPath_anItemChangedSinceTheReviewerSawItIsNotApproved @S-A90-BAD-CHANGED-SINCE', async () => {
        const world = await communityWorld();
        await pending(world, { description: { ro: 'Altceva acum.' }, updatedAt: timestampFromDate(new Date('2026-10-12T09:00:00.000Z')) });
        expect(await refusal(decide(world, 'u-moderator', {}))).toBe('apiError.review.changed');
        const photo = await stored(world);
        expect(photo).toMatchObject({ published: false, reviewStatus: 'pending' });
        expect(world.blobs.paths('public')).toEqual([]);
        expect(world.blobs.paths('private', 'review-held/')).toHaveLength(2);
    });

    it('badPath_anItemChangedWhileItsPicturesMoveIsNotApproved', async () => {
        const world = await communityWorld();
        await pending(world);
        const read = world.blobs.read.bind(world.blobs);
        world.blobs.read = async (bucket, path) => {
            const later = timestampFromDate(new Date('2026-10-12T09:00:00.000Z'));
            const current = await stored(world);
            if (current !== undefined) {
                await world.documents.set(FIRESTORE_PATHS.photo(CITY_ID, 'p1'), photoDocSchema, { ...current, updatedAt: later });
            }
            return read(bucket, path);
        };
        expect(await refusal(decide(world, 'u-moderator', {}))).toBe('apiError.review.changed');
        expect((await stored(world))?.published).toBe(false);
    });

    it('happyPath_anApprovalRetriedAfterItsPicturesMovedFindsThemThere', async () => {
        const world = await communityWorld();
        await pending(world);
        world.blobs.put('public', STORAGE_PATHS.photoDerivative(CITY_ID, 'p1', SHA, 'web'), new Uint8Array([1]));
        await expect(decide(world, 'u-moderator', {})).resolves.toEqual({ status: 'approved' });
    });

    it('badPath_aPublicBucketThatFailsLeavesThePhotoPending', async () => {
        const world = await communityWorld();
        await pending(world);
        world.blobs.write = () => Promise.reject(new UpstreamError('cloud-storage', 'unavailable', { status: 503 }));
        expect(await refusal(decide(world, 'u-moderator', {}))).toBe('apiError.unavailable');
        expect((await stored(world))?.reviewStatus).toBe('pending');
    });

    it('badPath_anApprovalThatDoesNotSayWhatItSawIsInvalid', async () => {
        const world = await communityWorld();
        await pending(world);
        expect(await refusal(decide(world, 'u-moderator', { seenAt: undefined }))).toBe('apiError.invalidRequest');
    });

    it('happyPath_aRefusalNeedsNoInstant', async () => {
        const world = await communityWorld();
        await pending(world, { updatedAt: timestampFromDate(new Date('2026-10-12T09:00:00.000Z')) });
        await expect(decide(world, 'u-moderator', { decision: 'refuse', seenAt: undefined })).resolves.toEqual({ status: 'refused' });
    });

    it('badPath_aPlaceChangedSinceIsNotApproved', async () => {
        const world = await communityWorld();
        const later = timestampFromDate(new Date('2026-10-12T09:00:00.000Z'));
        await world.documents.set(
            FIRESTORE_PATHS.poi(CITY_ID, 'a'),
            poiDocSchema,
            poiDoc({ published: false, reviewStatus: 'pending', yearStart: 1850, updatedAt: later }),
        );
        expect(await refusal(decide(world, 'u-owner', { entity: 'poi', id: 'a' }))).toBe('apiError.review.changed');
    });

    it('badPath_decidedTwiceIsRefused @S-A90-BAD-DECIDED-TWICE', async () => {
        const world = await communityWorld();
        await pending(world);
        await decide(world, 'u-owner', {});
        expect(await refusal(decide(world, 'u-owner', {}))).toBe('apiError.review.alreadyDecided');
        expect(await refusal(decide(world, 'u-owner', { decision: 'refuse' }))).toBe('apiError.review.alreadyDecided');
    });

    it('badPath_aPhotoStillBeingProcessedOrWithNoLicenceWaits', async () => {
        const world = await communityWorld();
        await pending(world, { processing: 'pending', heldImage: undefined });
        expect(await refusal(decide(world, 'u-owner', {}))).toBe('apiError.review.notReady');
        await pending(world, { license: 'unknown' });
        expect(await refusal(decide(world, 'u-owner', {}))).toBe('apiError.review.licenseUnknown');
    });

    it('badPath_nothingToDecide', async () => {
        const world = await communityWorld();
        expect(await refusal(decide(world, 'u-owner', { id: 'missing' }))).toBe('apiError.notFound');
    });

    it.each([
        ['u-uploader', 'apiError.city.notReviewer'],
        ['u-other', 'apiError.city.notMember'],
        ['u-stranger', 'apiError.notAdmin'],
    ])('badPath_%s_mayNotDecide @S-A90-BAD-NOT-REVIEWER', async (uid, code) => {
        const world = await communityWorld();
        await pending(world);
        expect(await refusal(decide(world, uid, {}))).toBe(code);
        expect((await stored(world))?.published).toBe(false);
    });

    it('badPath_signedOut', async () => {
        const world = await communityWorld();
        expect(await refusal(decide(world, null, {}))).toBe('apiError.unauthenticated');
    });
});

describe('photos.onUpload, for a pending photo (M13 §2)', () => {
    const jpeg = () =>
        sharp({ create: { width: 50, height: 40, channels: 3, background: '#808080' } })
            .jpeg()
            .toBuffer();
    const objectOf = async (world: CommunityWorld) => {
        const path = STORAGE_PATHS.photoUpload(CITY_ID, 'u-uploader', 'p1', 'nonce-0001.jpg');
        const bytes = new Uint8Array(await jpeg());
        world.blobs.put('private', path, bytes, { contentType: 'image/jpeg' });
        return { name: path, size: String(bytes.length), metadata: {} };
    };

    it('happyPath_itsPicturesStayPrivate @S-A90-BAD-NOT-PUBLIC-BEFORE', async () => {
        const world = await communityWorld();
        await seedPhoto(world, 'p1', {
            image: undefined,
            published: false,
            processing: 'pending',
            reviewStatus: 'pending',
            location: undefined,
            bearing: undefined,
        });
        await expect(processPhotoUpload(world, await objectOf(world))).resolves.toBe('done');
        const photo = await stored(world);
        expect(photo?.image).toBeUndefined();
        expect(photo?.heldImage?.web).toMatch(/^review-held\//);
        expect(photo?.processing).toBe('done');
        expect(world.blobs.paths('public')).toEqual([]);
    });

    it('happyPath_aPhotoOfStaffIsPublicAsBefore', async () => {
        const world = await communityWorld();
        await seedPhoto(world, 'p1', { image: undefined, published: false, processing: 'pending', createdAt: AT });
        await seedMember(world, 'u-uploader', { [CITY_ID]: 'editor' });
        await processPhotoUpload(world, await objectOf(world));
        expect((await stored(world))?.image?.web).toContain('demo-hcm-public');
        expect(world.blobs.paths('private', 'review-held/')).toEqual([]);
    });
});
