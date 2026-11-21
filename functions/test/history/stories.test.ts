/**
 * M17's stories through M13's doors (docs/research/M17-stories.md §2): `review.decide` approves or refuses an uploader's story,
 * bound to what the reviewer saw, and `history.revert` brings a story's earlier version back, a moderator's revert included.
 */
import { FIRESTORE_PATHS, historyEntryDocSchema, storyDocSchema, timestampToDate, type StoryDoc } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { recordHistory } from '../../src/history/record.js';
import { revertFunction } from '../../src/history/revert.js';
import { reviewFunctions } from '../../src/photos/review-decide.js';
import { AT, CITY_ID, as, communityWorld, refusal, type CommunityWorld } from '../photos/community-world.js';
import { storyDoc } from '../publish/city.js';

const PATH = FIRESTORE_PATHS.story(CITY_ID, 's1');
const SEEN = timestampToDate(AT).toISOString();

async function seed(world: CommunityWorld, overrides: Partial<StoryDoc> = {}): Promise<void> {
    await world.documents.set(PATH, storyDocSchema, { ...storyDoc(), updatedAt: AT, ...overrides });
}

function decide(world: CommunityWorld, data: Record<string, unknown>) {
    return reviewFunctions(() => world).decide.run(
        as('u-moderator', { cityId: CITY_ID, entity: 'story', id: 's1', decision: 'approve', seenAt: SEEN, ...data }),
    );
}

const stored = (world: CommunityWorld) => world.documents.get(PATH, storyDocSchema);

describe('review.decide: a story', () => {
    it('happyPath_aWaitingStoryIsApprovedAndPublished @S-A100-HAPPY-REVIEW', async () => {
        const world = await communityWorld();
        await seed(world, { published: false, reviewStatus: 'pending', createdBy: 'u-uploader' });
        await expect(decide(world, {})).resolves.toEqual({ status: 'approved' });
        expect(await stored(world)).toMatchObject({ published: true, reviewStatus: 'approved', reviewedBy: 'u-moderator' });
    });

    it('happyPath_aRefusedStoryStaysPrivate', async () => {
        const world = await communityWorld();
        await seed(world, { published: false, reviewStatus: 'pending' });
        await expect(decide(world, { decision: 'refuse', seenAt: undefined })).resolves.toEqual({ status: 'refused' });
        expect(await stored(world)).toMatchObject({ published: false, reviewStatus: 'refused' });
    });

    it('badPath_aStoryChangedSinceTheReviewerReadItIsNotApproved @S-A100-BAD-REVIEW', async () => {
        const world = await communityWorld();
        await seed(world, { published: false, reviewStatus: 'pending' });
        expect(await refusal(decide(world, { seenAt: '2026-01-01T00:00:00.000Z' }))).toBe('apiError.review.changed');
        expect(await stored(world)).toMatchObject({ published: false, reviewStatus: 'pending' });
    });

    it('badPath_aStoryWithNoTextIsNotApproved @S-A100-BAD-REVIEW-EMPTY', async () => {
        const world = await communityWorld();
        await seed(world, { published: false, reviewStatus: 'pending', body: undefined });
        expect(await refusal(decide(world, {}))).toBe('apiError.review.storyEmpty');
        expect(await stored(world)).toMatchObject({ published: false, reviewStatus: 'pending' });
    });

    it('happyPath_aStoryWithNoTextCanStillBeRefused', async () => {
        const world = await communityWorld();
        await seed(world, { published: false, reviewStatus: 'pending', body: undefined });
        await expect(decide(world, { decision: 'refuse' })).resolves.toEqual({ status: 'refused' });
    });
});

describe('history.revert: a story', () => {
    async function edited(world: CommunityWorld): Promise<string> {
        const before = storyDoc({ updatedAt: AT });
        const after: StoryDoc = { ...before, body: { ro: 'Altă poveste.' }, updatedBy: 'u-editor' };
        await world.documents.set(PATH, storyDocSchema, after);
        await recordHistory(world, {
            document: PATH,
            before,
            after,
            eventId: 'event-story',
            time: new Date('2026-10-12T09:00:00.000Z'),
            authType: 'unknown',
            authId: undefined,
        });
        const entries = await world.documents.query(`${PATH}/history`, historyEntryDocSchema);
        return entries.documents[0]?.id ?? '';
    }

    it('happyPath_aModeratorBringsAStorysTextBack @S-A100-HAPPY-REVERT', async () => {
        const world = await communityWorld();
        const entryId = await edited(world);
        const answer = await revertFunction(() => world).run(
            as('u-moderator', { cityId: CITY_ID, entity: 'story', entityId: 's1', entryId }),
        );
        expect(answer.restoredFields).toEqual(['body']);
        expect((await stored(world))?.body).toEqual(storyDoc().body);
    });

    it('badPath_anUploaderRevertsNothing @S-A100-BAD-REVERT', async () => {
        const world = await communityWorld();
        const entryId = await edited(world);
        expect(
            await refusal(revertFunction(() => world).run(as('u-uploader', { cityId: CITY_ID, entity: 'story', entityId: 's1', entryId }))),
        ).toMatch(/^apiError\./);
        expect((await stored(world))?.body).toEqual({ ro: 'Altă poveste.' });
    });
});
