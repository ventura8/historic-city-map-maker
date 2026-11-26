/** `suggestions.submit`, `suggestions.decide` and `contributors.setBlocked` (M13 §4), through their callables' `.run()`. */
import {
    FIRESTORE_PATHS,
    SUGGESTIONS_PER_DAY,
    cityDocSchema,
    contributorDocSchema,
    notificationEventDocSchema,
    notificationEventId,
    photoDocSchema,
    suggestionDocSchema,
} from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { suggestionsFunctions, contributorsFunctions } from '../../src/photos/index.js';
import { cityDoc } from '../publish/city.js';
import { suggestionGroupId } from '../../src/photos/suggest.js';
import { CITY_ID, as, communityWorld, refusal, seedMember, seedPhoto, type CommunityWorld } from './community-world.js';

function must<T>(value: T | undefined): T {
    if (value === undefined) {
        throw new Error('expected it to be there');
    }
    return value;
}

const PLACE = { location: { lat: 44.44, lng: 26.1 }, bearing: 45 };

function submit(world: CommunityWorld, uid: string | null, data: Record<string, unknown> = {}) {
    return suggestionsFunctions(() => world).submit.run(
        as(uid, { cityId: CITY_ID, photoId: 'lost', kind: 'place', proposal: PLACE, ...data }),
    );
}

function decide(world: CommunityWorld, uid: string, group: string, data: Record<string, unknown> = {}) {
    return suggestionsFunctions(() => world).decide.run(as(uid, { cityId: CITY_ID, suggestionId: group, decision: 'approve', ...data }));
}

const GROUP = suggestionGroupId({ photoId: 'lost', kind: 'place', proposal: PLACE });

const group = (world: CommunityWorld, id = GROUP) => world.documents.get(FIRESTORE_PATHS.suggestion(CITY_ID, id), suggestionDocSchema);
const photo = (world: CommunityWorld, id = 'lost') => world.documents.get(FIRESTORE_PATHS.photo(CITY_ID, id), photoDocSchema);

async function world() {
    const created = await communityWorld();
    await seedPhoto(created, 'lost', { location: undefined, bearing: undefined });
    await seedPhoto(created, 'placed');
    return created;
}

describe('suggestions.submit', () => {
    it('happyPath_anyoneSignedInSuggestsAPlaceAndThePublicPhotoStays @S-A93-HAPPY-PLACE', async () => {
        const w = await world();
        await expect(submit(w, 'u-stranger', { credit: 'Maria' })).resolves.toEqual({
            received: true,
            remainingToday: SUGGESTIONS_PER_DAY - 1,
        });
        expect(await group(w)).toMatchObject({ photoId: 'lost', status: 'pending', count: 1, accounts: ['u-stranger'], proposal: PLACE });
        expect((await photo(w))?.location).toBeUndefined();
        const id = notificationEventId('suggestion.waiting', CITY_ID, GROUP);
        expect(await w.documents.get(FIRESTORE_PATHS.notificationEvent(id), notificationEventDocSchema)).toMatchObject({ cityId: CITY_ID });
    });

    it('happyPath_aPlacedPhotoIsContestedWithAReason @S-A93-HAPPY-CORRECTION', async () => {
        const w = await world();
        const correction = {
            photoId: 'placed',
            kind: 'correction',
            proposal: { year: 1950 },
            reason: 'Pe verso scrie 1950.',
            sourceUrl: 'https://example.org/x',
        };
        await expect(submit(w, 'u-stranger', correction)).resolves.toMatchObject({ received: true });
        const id = suggestionGroupId({ photoId: 'placed', kind: 'correction', proposal: { year: 1950 } });
        expect((await group(w, id))?.voices[0]).toMatchObject({ reason: 'Pe verso scrie 1950.', sourceUrl: 'https://example.org/x' });
    });

    it('happyPath_repeatsGroupAndAnAccountCountsOnce @S-A93-HAPPY-GROUP', async () => {
        const w = await world();
        await submit(w, 'u-a');
        await submit(w, 'u-a');
        // A few metres away and a few degrees round: the same proposal.
        await submit(w, 'u-b', { proposal: { location: { lat: 44.44001, lng: 26.10001 }, bearing: 50 } });
        expect(await group(w)).toMatchObject({ count: 2, accounts: ['u-a', 'u-b'] });
        expect((await group(w))?.voices).toHaveLength(2);
    });

    it('badPath_aRepeatOfARefusedProposalReopensNothing', async () => {
        const w = await world();
        await submit(w, 'u-a');
        await decide(w, 'u-moderator', GROUP, { decision: 'reject' });
        await expect(submit(w, 'u-b')).resolves.toMatchObject({ received: true });
        expect(await group(w)).toMatchObject({ status: 'rejected', count: 2 });
        expect((await group(w))?.voices).toHaveLength(1);
    });

    it('badPath_theDailyLimitHolds @S-A93-BAD-DAILY-LIMIT', async () => {
        const w = await world();
        await w.documents.set(FIRESTORE_PATHS.contributor(CITY_ID, 'u-a'), contributorDocSchema, {
            day: w.clock.now().toISOString().slice(0, 10),
            count: SUGGESTIONS_PER_DAY,
            updatedBy: 'u-a',
            updatedAt: { seconds: 0, nanoseconds: 0 },
        });
        expect(await refusal(submit(w, 'u-a'))).toBe('apiError.suggestion.dailyLimit');
        expect(await group(w)).toBeUndefined();
    });

    it('happyPath_theLimitIsADays', async () => {
        const w = await world();
        await w.documents.set(FIRESTORE_PATHS.contributor(CITY_ID, 'u-a'), contributorDocSchema, {
            day: '2020-01-01',
            count: SUGGESTIONS_PER_DAY,
            updatedBy: 'u-a',
            updatedAt: { seconds: 0, nanoseconds: 0 },
        });
        await expect(submit(w, 'u-a')).resolves.toMatchObject({ remainingToday: SUGGESTIONS_PER_DAY - 1 });
    });

    it('badPath_aBlockedAccountIsRefused @S-A93-BAD-BLOCKED', async () => {
        const w = await world();
        await contributorsFunctions(() => w).setBlocked.run(as('u-moderator', { cityId: CITY_ID, uid: 'u-a', blocked: true }));
        expect(await refusal(submit(w, 'u-a'))).toBe('apiError.contribute.blocked');
        await contributorsFunctions(() => w).setBlocked.run(as('u-moderator', { cityId: CITY_ID, uid: 'u-a', blocked: false }));
        await expect(submit(w, 'u-a')).resolves.toMatchObject({ received: true });
    });

    it('badPath_anUploaderMayNotBlock', async () => {
        const w = await world();
        const run = contributorsFunctions(() => w).setBlocked.run(as('u-uploader', { cityId: CITY_ID, uid: 'u-a', blocked: true }));
        expect(await refusal(run)).toBe('apiError.city.notReviewer');
    });

    it('badPath_outsideTheCity @S-A93-BAD-OUTSIDE', async () => {
        const w = await world();
        expect(await refusal(submit(w, 'u-a', { proposal: { location: { lat: 10, lng: 10 } } }))).toBe('apiError.suggestion.outsideCity');
    });

    it.each([
        ['an unpublished photo', { published: false }],
        ['a photo waiting for review', { reviewStatus: 'pending', published: true }],
        ['a refused photo', { reviewStatus: 'refused', published: true }],
    ])('badPath_%s_isNotThere @S-A93-BAD-NOT-PUBLIC', async (_name, overrides) => {
        const w = await world();
        await seedPhoto(w, 'hidden', { location: undefined, bearing: undefined, ...(overrides as object) });
        expect(await refusal(submit(w, 'u-a', { photoId: 'hidden' }))).toBe('apiError.notFound');
    });

    it('badPath_thePlaceToolIsForUnplacedAndTheCorrectionForPlaced', async () => {
        const w = await world();
        expect(await refusal(submit(w, 'u-a', { photoId: 'placed' }))).toBe('apiError.suggestion.wrongKind');
        expect(await refusal(submit(w, 'u-a', { kind: 'correction', reason: 'x' }))).toBe('apiError.suggestion.wrongKind');
    });

    it('badPath_whatThePhotoAlreadySays', async () => {
        const w = await world();
        const same = {
            photoId: 'placed',
            kind: 'correction',
            proposal: { location: { lat: 44.43, lng: 26.09 }, bearing: 90 },
            reason: 'x',
        };
        expect(await refusal(submit(w, 'u-a', same))).toBe('apiError.suggestion.noChange');
    });

    it.each([
        ['a correction with no reason', { photoId: 'placed', kind: 'correction', proposal: { year: 1950 } }],
        ['a place with no location', { proposal: { bearing: 10 } }],
        ['nothing at all', { proposal: {} }],
        ['a source that is not https', { sourceUrl: 'javascript:alert(1)' }],
        ['an end before its start', { photoId: 'placed', kind: 'correction', reason: 'x', proposal: { year: 1950, yearEnd: 1940 } }],
    ])('badPath_%s_isInvalid', async (_name, data) => {
        const w = await world();
        expect(await refusal(submit(w, 'u-a', data))).toBe('apiError.invalidRequest');
    });

    it('badPath_signedOut', async () => {
        const w = await world();
        expect(await refusal(submit(w, null))).toBe('apiError.unauthenticated');
    });
});

describe('suggestions.submit: what the public may ask of the photo as it is', () => {
    it('badPath_aCityNotPublicIsNotThereForAStranger @S-A93-BAD-NOT-PUBLIC-CITY', async () => {
        const w = await world();
        await w.documents.set(FIRESTORE_PATHS.city(CITY_ID), cityDocSchema, cityDoc({ published: false }));
        expect(await refusal(submit(w, 'u-stranger'))).toBe('apiError.notFound');
        expect(await refusal(submit(w, 'u-stranger', { photoId: 'nosuch' }))).toBe('apiError.notFound');
        expect(await group(w)).toBeUndefined();
        expect(await w.documents.get(FIRESTORE_PATHS.contributor(CITY_ID, 'u-stranger'), contributorDocSchema)).toBeUndefined();
    });

    it('happyPath_aMemberOfACityNotPublicStillSuggests', async () => {
        const w = await world();
        await w.documents.set(FIRESTORE_PATHS.city(CITY_ID), cityDocSchema, cityDoc({ published: false }));
        await seedMember(w, 'u-moderator', { [CITY_ID]: 'moderator' });
        await expect(submit(w, 'u-moderator')).resolves.toMatchObject({ received: true });
    });

    it('happyPath_onlyWhatChangedIsKept @S-A93-HAPPY-ONLY-CHANGED', async () => {
        const w = await world();
        await seedPhoto(w, 'placed', { location: { lat: 44.43, lng: 26.09 }, bearing: 90 });
        const kept = { photoId: 'placed', kind: 'correction', reason: 'Pe verso.' };
        await submit(w, 'u-a', { ...kept, proposal: { location: { lat: 44.43, lng: 26.09 }, bearing: 90, year: 1950 } });
        const id = suggestionGroupId({ photoId: 'placed', kind: 'correction', proposal: { year: 1950 } });
        expect((await group(w, id))?.proposal).toEqual({ year: 1950 });
    });

    it('happyPath_aDateCorrectionLeavesAMoveMadeSinceAlone @S-A93-HAPPY-ONLY-CHANGED', async () => {
        const w = await world();
        await seedPhoto(w, 'placed', { location: { lat: 44.43, lng: 26.09 }, bearing: 90 });
        const proposal = { location: { lat: 44.43, lng: 26.09 }, bearing: 90, year: 1950 };
        await submit(w, 'u-a', { photoId: 'placed', kind: 'correction', reason: 'Pe verso.', proposal });
        const current = await photo(w, 'placed');
        const moved = { lat: 44.5, lng: 26.2 };
        await w.documents.set(FIRESTORE_PATHS.photo(CITY_ID, 'placed'), photoDocSchema, {
            ...must(current),
            location: moved,
            bearing: 200,
        });
        await decide(w, 'u-moderator', suggestionGroupId({ photoId: 'placed', kind: 'correction', proposal: { year: 1950 } }));
        expect(await photo(w, 'placed')).toMatchObject({ location: moved, bearing: 200, year: 1950 });
    });

    it('happyPath_aNewEndKeepsItsStartWhateverThePhotoSays @S-A93-HAPPY-YEAR-RANGE', async () => {
        const w = await world();
        await seedPhoto(w, 'placed', { year: 1920 });
        const proposal = { year: 1920, yearEnd: 1925 };
        await submit(w, 'u-a', { photoId: 'placed', kind: 'correction', reason: 'x', proposal });
        const id = suggestionGroupId({ photoId: 'placed', kind: 'correction', proposal });
        expect((await group(w, id))?.proposal).toEqual(proposal);
        await decide(w, 'u-moderator', id);
        expect(await photo(w, 'placed')).toMatchObject(proposal);
    });

    it('happyPath_theTextOfTheLanguageItWasWrittenIn', async () => {
        const w = await world();
        await seedPhoto(w, 'placed', { dateText: { ro: 'Iulie 1936', en: 'July 1936' } });
        const asking = { photoId: 'placed', kind: 'correction', reason: 'x' };
        expect(await refusal(submit(w, 'u-a', { ...asking, proposal: { dateText: 'July 1936', dateLocale: 'en' } }))).toBe(
            'apiError.suggestion.noChange',
        );
        await expect(submit(w, 'u-a', { ...asking, proposal: { dateText: 'Iulie 1936', dateLocale: 'en' } })).resolves.toMatchObject({
            received: true,
        });
    });

    it('badPath_aLanguageWithNoTextIsInvalid', async () => {
        const w = await world();
        const asking = { photoId: 'placed', kind: 'correction', reason: 'x' };
        expect(await refusal(submit(w, 'u-a', { ...asking, proposal: { year: 1950, dateLocale: 'en' } }))).toBe('apiError.invalidRequest');
    });
});

describe('suggestions.decide: applying to the photo as it is', () => {
    const correct = async (w: CommunityWorld, proposal: Record<string, unknown>): Promise<string> => {
        await submit(w, 'u-a', { photoId: 'placed', kind: 'correction', proposal, reason: 'x' });
        return suggestionGroupId({ photoId: 'placed', kind: 'correction', proposal });
    };

    it('happyPath_aYearPastTheOldRangeReplacesTheRange @S-A93-HAPPY-YEAR-RANGE', async () => {
        const w = await world();
        await seedPhoto(w, 'placed', { year: 1920, yearEnd: 1930 });
        const id = await correct(w, { year: 1950 });
        await expect(decide(w, 'u-moderator', id)).resolves.toEqual({ status: 'approved' });
        const stored = await photo(w, 'placed');
        expect(stored?.year).toBe(1950);
        expect(stored?.yearEnd).toBeUndefined();
    });

    it('badPath_anAdjustedDirectionOnAPhotoWithNoPlaceIsExplained @S-A93-BAD-DOES-NOT-FIT', async () => {
        const w = await world();
        await submit(w, 'u-a');
        expect(await refusal(decide(w, 'u-moderator', GROUP, { decision: 'adjust', adjusted: { bearing: 90 } }))).toBe(
            'apiError.suggestion.invalid',
        );
    });

    it('happyPath_aDateTextKeepsTheOtherLanguage @S-A93-HAPPY-DATE-LANGUAGE', async () => {
        const w = await world();
        await seedPhoto(w, 'placed', { dateText: { ro: 'Iulie 1936', en: 'July 1936' } });
        await decide(w, 'u-moderator', await correct(w, { dateText: '1938' }));
        expect((await photo(w, 'placed'))?.dateText).toEqual({ ro: '1938', en: 'July 1936' });
    });

    it('happyPath_aDateTextTypedInEnglishIsEnglish @S-A93-HAPPY-DATE-LANGUAGE', async () => {
        const w = await world();
        await seedPhoto(w, 'placed', { dateText: { ro: 'Iulie 1936' } });
        await decide(w, 'u-moderator', await correct(w, { dateText: 'Summer 1938', dateLocale: 'en' }));
        expect((await photo(w, 'placed'))?.dateText).toEqual({ ro: 'Iulie 1936', en: 'Summer 1938' });
    });

    it('happyPath_anEnglishTextOnAPhotoWithNoneIsAlsoTheRomanianFallback', async () => {
        const w = await world();
        await decide(w, 'u-moderator', await correct(w, { dateText: 'Summer 1938', dateLocale: 'en' }));
        expect((await photo(w, 'placed'))?.dateText).toEqual({ ro: 'Summer 1938', en: 'Summer 1938' });
    });

    it('happyPath_anApprovedYearShowsInsteadOfTheOldDateText @S-A93-HAPPY-DATE-LANGUAGE', async () => {
        const w = await world();
        await seedPhoto(w, 'placed', { year: 1936, dateText: { ro: 'Iulie 1936', en: 'July 1936' } });
        await decide(w, 'u-moderator', await correct(w, { year: 1938 }));
        const stored = await photo(w, 'placed');
        expect(stored?.year).toBe(1938);
        expect(stored?.dateText).toBeUndefined();
    });

    it('happyPath_anApprovedYearDropsTheMonthAndDayOfTheOldOne @S-A93-HAPPY-DATE-LANGUAGE', async () => {
        const w = await world();
        await seedPhoto(w, 'placed', { year: 1936, month: 7, day: 12 });
        const id = await correct(w, { year: 1938 });
        await expect(decide(w, 'u-moderator', id)).resolves.toEqual({ status: 'approved' });
        const stored = await photo(w, 'placed');
        expect([stored?.year, stored?.month, stored?.day]).toEqual([1938, undefined, undefined]);
        await expect(decide(w, 'u-moderator', id, { decision: 'revert' })).resolves.toEqual({ status: 'reverted' });
        const restored = await photo(w, 'placed');
        expect([restored?.year, restored?.month, restored?.day]).toEqual([1936, 7, 12]);
    });

    it('badPath_aDateTextOrAPlaceKeepsTheMonthAndDay', async () => {
        const w = await world();
        await seedPhoto(w, 'placed', { year: 1936, month: 7, day: 12 });
        await decide(w, 'u-moderator', await correct(w, { dateText: 'Vara 1936' }));
        await decide(w, 'u-moderator', await correct(w, { bearing: 12 }));
        const stored = await photo(w, 'placed');
        expect([stored?.month, stored?.day]).toEqual([7, 12]);
    });

    it('happyPath_aPlaceLeavesTheDateTextAlone', async () => {
        const w = await world();
        await seedPhoto(w, 'placed', { dateText: { ro: 'Iulie 1936' } });
        await decide(w, 'u-moderator', await correct(w, { bearing: 12 }));
        expect((await photo(w, 'placed'))?.dateText).toEqual({ ro: 'Iulie 1936' });
    });
});

describe('suggestions.decide: revert undoes that decision and no other', () => {
    it('happyPath_revertTakesOffWhatThatApprovalWroteAndNothingElse @S-A93-HAPPY-REVERT', async () => {
        const w = await world();
        await submit(w, 'u-a', { credit: 'Maria' });
        await decide(w, 'u-moderator', GROUP);
        const current = await photo(w);
        await w.documents.set(FIRESTORE_PATHS.photo(CITY_ID, 'lost'), photoDocSchema, { ...must(current), title: { ro: 'Alt titlu' } });
        await expect(decide(w, 'u-moderator', GROUP, { decision: 'revert' })).resolves.toEqual({ status: 'reverted' });
        const stored = await photo(w);
        expect(stored?.location).toBeUndefined();
        expect(stored?.bearing).toBeUndefined();
        expect(stored?.credit).toBeUndefined();
        expect(stored?.title).toEqual({ ro: 'Alt titlu' });
        expect(stored?.updatedBy).toBe('u-moderator');
        const decided = await group(w);
        expect(decided?.status).toBe('reverted');
        expect(decided?.undo).toBeUndefined();
    });

    it('happyPath_theOlderOfTwoApprovalsTakesOffItsOwnFields', async () => {
        const w = await world();
        const correct = async (proposal: Record<string, unknown>) => {
            await submit(w, 'u-a', { photoId: 'placed', kind: 'correction', proposal, reason: 'x' });
            const id = suggestionGroupId({ photoId: 'placed', kind: 'correction', proposal });
            await decide(w, 'u-moderator', id);
            return id;
        };
        const before = await photo(w, 'placed');
        const older = await correct({ year: 1950 });
        await correct({ bearing: 12 });
        await decide(w, 'u-moderator', older, { decision: 'revert' });
        const stored = await photo(w, 'placed');
        expect(stored?.bearing).toBe(12);
        expect(stored?.year).toBe(before?.year);
    });

    it('badPath_aFieldChangedSinceIsNeverOverwritten @S-A93-BAD-REVERT-STALE', async () => {
        const w = await world();
        await submit(w, 'u-a');
        await decide(w, 'u-moderator', GROUP);
        const current = await photo(w);
        const moved = { lat: 44.5, lng: 26.2 };
        await w.documents.set(FIRESTORE_PATHS.photo(CITY_ID, 'lost'), photoDocSchema, { ...must(current), location: moved });
        expect(await refusal(decide(w, 'u-moderator', GROUP, { decision: 'revert' }))).toBe('apiError.suggestion.notRevertable');
        expect((await photo(w))?.location).toEqual(moved);
        expect((await group(w))?.status).toBe('approved');
    });

    it.each(['reject', 'approve'] as const)('badPath_onlyAnAppliedDecisionReverts, after %s then again', async (first) => {
        const w = await world();
        await submit(w, 'u-a');
        await decide(w, 'u-moderator', GROUP, { decision: first });
        if (first === 'approve') {
            await decide(w, 'u-moderator', GROUP, { decision: 'revert' });
        }
        expect(await refusal(decide(w, 'u-moderator', GROUP, { decision: 'revert' }))).toBe('apiError.suggestion.alreadyDecided');
    });

    it('badPath_aGroupThatKeptNoWayBackOrIsGoneOrAPendingOne', async () => {
        const w = await world();
        expect(await refusal(decide(w, 'u-moderator', 'nosuch', { decision: 'revert' }))).toBe('apiError.notFound');
        await submit(w, 'u-a');
        expect(await refusal(decide(w, 'u-moderator', GROUP, { decision: 'revert' }))).toBe('apiError.suggestion.notRevertable');
        const stored = await group(w);
        await w.documents.set(FIRESTORE_PATHS.suggestion(CITY_ID, GROUP), suggestionDocSchema, { ...must(stored), status: 'approved' });
        expect(await refusal(decide(w, 'u-moderator', GROUP, { decision: 'revert' }))).toBe('apiError.suggestion.notRevertable');
    });

    it('badPath_aPhotoGoneSinceCannotBeReverted', async () => {
        const w = await world();
        await submit(w, 'u-a');
        await decide(w, 'u-moderator', GROUP);
        await w.documents.delete(FIRESTORE_PATHS.photo(CITY_ID, 'lost'));
        expect(await refusal(decide(w, 'u-moderator', GROUP, { decision: 'revert' }))).toBe('apiError.notFound');
    });

    it('badPath_aRevertTheSchemaWouldRefuseWritesNothing', async () => {
        const w = await world();
        await submit(w, 'u-a', { proposal: { location: PLACE.location } });
        const id = suggestionGroupId({ photoId: 'lost', kind: 'place', proposal: { location: PLACE.location } });
        await decide(w, 'u-moderator', id);
        const current = await photo(w);
        await w.documents.set(FIRESTORE_PATHS.photo(CITY_ID, 'lost'), photoDocSchema, { ...must(current), bearing: 45 });
        expect(await refusal(decide(w, 'u-moderator', id, { decision: 'revert' }))).toBe('apiError.suggestion.notRevertable');
        expect((await photo(w))?.location).toEqual(PLACE.location);
    });

    it('badPath_aStrangerMayNotRevert', async () => {
        const w = await world();
        await submit(w, 'u-a');
        await decide(w, 'u-moderator', GROUP);
        expect(await refusal(decide(w, 'u-uploader', GROUP, { decision: 'revert' }))).toBe('apiError.city.notReviewer');
    });
});

describe('contributors.setBlocked: both ways', () => {
    it('happyPath_blockKeepsWhatTheyWroteAndUnblockForgetsIt @S-A93-HAPPY-UNBLOCK', async () => {
        const w = await world();
        const set = (data: Record<string, unknown>) =>
            contributorsFunctions(() => w).setBlocked.run(as('u-moderator', { cityId: CITY_ID, uid: 'u-a', ...data }));
        const stored = () => w.documents.get(FIRESTORE_PATHS.contributor(CITY_ID, 'u-a'), contributorDocSchema);
        await set({ blocked: true, about: 'Reclame.' });
        expect(await stored()).toMatchObject({ blocked: true, blockedBy: 'u-moderator', blockedFor: 'Reclame.' });
        await set({ blocked: false });
        const after = await stored();
        expect(after?.blocked).toBeUndefined();
        expect(after?.blockedFor).toBeUndefined();
        await expect(submit(w, 'u-a')).resolves.toMatchObject({ received: true });
    });
});

describe('suggestions.decide', () => {
    it('happyPath_approvingPlacesThePhotoAsTheReviewer @S-A93-HAPPY-APPROVE', async () => {
        const w = await world();
        await submit(w, 'u-a', { credit: 'Maria' });
        await expect(decide(w, 'u-moderator', GROUP)).resolves.toEqual({ status: 'approved' });
        expect(await photo(w)).toMatchObject({ ...PLACE, credit: 'Maria', updatedBy: 'u-moderator' });
        expect(await group(w)).toMatchObject({ status: 'approved', decidedBy: 'u-moderator' });
    });

    it('happyPath_adjustingAppliesTheReviewersValues @S-A93-HAPPY-ADJUST', async () => {
        const w = await world();
        await submit(w, 'u-a');
        const adjusted = { location: { lat: 44.45, lng: 26.11 }, bearing: 90 };
        await expect(decide(w, 'u-editor', GROUP, { decision: 'adjust', adjusted, note: 'Puțin mai la nord.' })).resolves.toEqual({
            status: 'adjusted',
        });
        expect(await photo(w)).toMatchObject(adjusted);
        expect(await group(w)).toMatchObject({ status: 'adjusted', applied: adjusted, note: 'Puțin mai la nord.' });
    });

    it('happyPath_aDateTextIsApplied', async () => {
        const w = await world();
        const proposal = { dateText: 'Vara lui 1936' };
        await submit(w, 'u-a', { photoId: 'placed', kind: 'correction', proposal, reason: 'x' });
        await decide(w, 'u-owner', suggestionGroupId({ photoId: 'placed', kind: 'correction', proposal }));
        expect((await photo(w, 'placed'))?.dateText).toEqual({ ro: 'Vara lui 1936' });
    });

    it('happyPath_rejectingChangesNothingPublic @S-A93-HAPPY-REJECT', async () => {
        const w = await world();
        await submit(w, 'u-a');
        await expect(decide(w, 'u-owner', GROUP, { decision: 'reject' })).resolves.toEqual({ status: 'rejected' });
        expect((await photo(w))?.location).toBeUndefined();
    });

    it('badPath_decidedTwice @S-A93-BAD-DECIDED-TWICE', async () => {
        const w = await world();
        await submit(w, 'u-a');
        await decide(w, 'u-owner', GROUP);
        expect(await refusal(decide(w, 'u-owner', GROUP))).toBe('apiError.suggestion.alreadyDecided');
    });

    it('badPath_anAdjustmentOutsideTheCityOrWithNoValues', async () => {
        const w = await world();
        await submit(w, 'u-a');
        const far = { decision: 'adjust', adjusted: { location: { lat: 10, lng: 10 } } };
        expect(await refusal(decide(w, 'u-owner', GROUP, far))).toBe('apiError.suggestion.outsideCity');
        expect(await refusal(decide(w, 'u-owner', GROUP, { decision: 'adjust' }))).toBe('apiError.invalidRequest');
    });

    it('badPath_aGroupWhosePhotoIsGoneOrNoGroup', async () => {
        const w = await world();
        await submit(w, 'u-a');
        await w.documents.delete(FIRESTORE_PATHS.photo(CITY_ID, 'lost'));
        expect(await refusal(decide(w, 'u-owner', GROUP))).toBe('apiError.notFound');
        expect(await refusal(decide(w, 'u-owner', 'nosuch'))).toBe('apiError.notFound');
    });

    it.each([
        ['u-uploader', 'apiError.city.notReviewer'],
        ['u-other', 'apiError.city.notMember'],
        ['u-stranger', 'apiError.notAdmin'],
    ])('badPath_%s_mayNotDecide', async (uid, code) => {
        const w = await world();
        await submit(w, 'u-a');
        expect(await refusal(decide(w, uid, GROUP))).toBe(code);
        expect((await photo(w))?.location).toBeUndefined();
    });
});
