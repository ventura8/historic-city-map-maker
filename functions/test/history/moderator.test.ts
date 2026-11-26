/**
 * M13 (`docs/research/M13-roles.md` §§1, 4): a moderator reverts a photo or a place in one click and nothing else, and an
 * approved suggestion goes through the existing history: its previous version is what the revert brings back.
 */
import {
    FIRESTORE_PATHS,
    historyEntryDocSchema,
    notificationEventDocSchema,
    notificationEventId,
    photoDocSchema,
    type PhotoDoc,
} from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { recordHistory } from '../../src/history/record.js';
import { revertFunction } from '../../src/history/revert.js';
import { CITY_ID, as, communityWorld, refusal, seedPhoto, type CommunityWorld } from '../photos/community-world.js';

const PHOTO = `cities/${CITY_ID}/photos/lost`;

function revert(world: CommunityWorld, uid: string, data: Record<string, unknown>) {
    return revertFunction(() => world).run(as(uid, { cityId: CITY_ID, entryId: `${'1'.repeat(13)}-e`, ...data }));
}

/** The entry the history trigger writes for an approved suggestion that placed the photo. */
async function placedBySuggestion(world: CommunityWorld): Promise<string> {
    const before = await world.documents.get(FIRESTORE_PATHS.photo(CITY_ID, 'lost'), photoDocSchema);
    if (before === undefined) {
        throw new Error('the photo is seeded');
    }
    const after: PhotoDoc = { ...before, location: { lat: 44.44, lng: 26.1 }, bearing: 45, updatedBy: 'u-moderator' };
    await world.documents.set(FIRESTORE_PATHS.photo(CITY_ID, 'lost'), photoDocSchema, after);
    await recordHistory(world, {
        document: PHOTO,
        before,
        after,
        eventId: 'event-1',
        time: new Date('2026-10-12T09:00:00.000Z'),
        authType: 'unknown',
        authId: undefined,
    });
    const entries = await world.documents.query(`${PHOTO}/history`, historyEntryDocSchema);
    return entries.documents[0]?.id ?? '';
}

describe('history.revert for a moderator', () => {
    it('happyPath_anApprovedPlaceComesOffInOneClick @S-A93-HAPPY-REVERT', async () => {
        const world = await communityWorld();
        await seedPhoto(world, 'lost', { location: undefined, bearing: undefined });
        const entryId = await placedBySuggestion(world);
        const answer = await revert(world, 'u-moderator', { entity: 'photo', entityId: 'lost', entryId });
        expect(new Set(answer.restoredFields)).toEqual(new Set(['bearing', 'location']));
        const photo = await world.documents.get(FIRESTORE_PATHS.photo(CITY_ID, 'lost'), photoDocSchema);
        expect(photo?.location).toBeUndefined();
        expect(photo?.bearing).toBeUndefined();
    });

    it.each([
        ['city', CITY_ID],
        ['layer', 'l1'],
        ['poiCategory', 'c1'],
    ])('badPath_never_%s @S-A90-BAD-MODERATOR-SETTINGS', async (entity, entityId) => {
        const world = await communityWorld();
        expect(await refusal(revert(world, 'u-moderator', { entity, entityId }))).toBe('apiError.city.notEditor');
    });

    it('badPath_anUploaderRevertsNothing', async () => {
        const world = await communityWorld();
        expect(await refusal(revert(world, 'u-uploader', { entity: 'photo', entityId: 'x' }))).toBe('apiError.city.notReviewer');
    });
});

describe('recordHistory tells the reviewers', () => {
    const change = (id: string, before: object | undefined, after: object | undefined) => ({
        document: `cities/${CITY_ID}/pois/${id}`,
        before: before as never,
        after: after as never,
        eventId: `event-${id}`,
        time: new Date('2026-10-12T09:00:00.000Z'),
        authType: 'unknown',
        authId: undefined,
    });
    const event = (world: CommunityWorld, id: string) =>
        world.documents.get(
            FIRESTORE_PATHS.notificationEvent(notificationEventId('review.waiting', CITY_ID, id)),
            notificationEventDocSchema,
        );
    const item = { title: { ro: 'x' }, updatedBy: 'u-uploader', updatedAt: { seconds: 1, nanoseconds: 0 } };

    it('happyPath_aNewPendingItem @S-A90-HAPPY-NOTIFIED', async () => {
        const world = await communityWorld();
        await recordHistory(world, change('a', undefined, { ...item, reviewStatus: 'pending' }));
        expect(await event(world, 'a')).toMatchObject({ kind: 'review.waiting', cityId: CITY_ID, link: '#/review' });
    });

    it('badPath_notAStaffItemNorAnEdit', async () => {
        const world = await communityWorld();
        await recordHistory(world, change('b', undefined, item));
        await recordHistory(world, change('c', { ...item, reviewStatus: 'pending' }, { ...item, reviewStatus: 'pending', year: 1 }));
        expect(await event(world, 'b')).toBeUndefined();
        expect(await event(world, 'c')).toBeUndefined();
    });
});
