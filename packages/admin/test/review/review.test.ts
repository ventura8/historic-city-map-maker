/** The review queue's store (M13, `docs/research/M13-roles.md` §§2 to 4, §8): live lists, and every decision through a callable. */
import { FIRESTORE_PATHS } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { REVIEW_MODULE } from '../../src/review/review.js';
import { failure } from '../app/fakes.js';
import { CITY, contentWorld } from '../content/world.js';
import { PIN_FEATURE_ID } from '../../src/photos/map.js';
import { CONTAINER, FakeMaps, settle } from '../photos/world.js';

const STAMP = { updatedBy: 'u', updatedAt: { seconds: 1_700_000_000, nanoseconds: 0 } };
const PROPOSAL = { location: { lat: 44.44, lng: 26.1 }, bearing: 45 };

function suggestion(status = 'pending', overrides: object = {}) {
    return {
        photoId: 'p1',
        photoTitle: { ro: 'Unde?' },
        photoThumb: 'https://example.org/t.webp',
        kind: 'place',
        proposal: PROPOSAL,
        status,
        count: 2,
        accounts: ['a', 'b'],
        voices: [
            { uid: 'a', reason: 'Se vede biserica.', sourceUrl: 'https://example.org/s', credit: 'Maria', at: STAMP.updatedAt },
            { uid: 'b', at: STAMP.updatedAt },
        ],
        createdAt: STAMP.updatedAt,
        ...STAMP,
        ...overrides,
    };
}

const PENDING_PHOTO = {
    title: { ro: 'În așteptare' },
    license: 'PD',
    published: false,
    processing: 'done',
    reviewStatus: 'pending',
    credit: 'Maria',
    heldImage: { web: 'review-held/c/p/w.webp', thumb: 'review-held/c/p/t.webp', sha256: 'a'.repeat(64), w: 10, h: 10 },
    ...STAMP,
};

function world(role: 'owner' | 'moderator' = 'owner') {
    const maps = new FakeMaps();
    const files = {
        url: (path: string) => Promise.resolve(path === 'none' ? null : `blob:${path}`),
        read: () => Promise.resolve(null),
        release: () => undefined,
        save: () => Promise.resolve(false),
    };
    const made = contentWorld({ maps: maps as never, files: files, cityRole: () => role });
    made.store.put(FIRESTORE_PATHS.city(CITY), {
        name: { ro: 'București' },
        bounds: { west: 25.9, south: 44.3, east: 26.3, north: 44.6 },
        published: true,
        ...STAMP,
    });
    return { ...made, maps, area: REVIEW_MODULE.create(made.services) };
}

describe('the review queue: uploads', () => {
    it('happyPath_listsWhatWaitsWithHeldPicturesAndDecides @S-A90-HAPPY-APPROVE', async () => {
        const w = world();
        w.store.put(FIRESTORE_PATHS.photo(CITY, 'p1'), PENDING_PHOTO);
        w.store.put(FIRESTORE_PATHS.poi(CITY, 'poi1'), {
            category: 'c',
            geometry: { type: 'Point', point: { lat: 44.4, lng: 26.1 } },
            title: { ro: 'Loc' },
            published: false,
            reviewStatus: 'pending',
            ...STAMP,
        });
        w.callables.answer('review.decide', () => ({ status: 'approved' }));
        w.area.open([]);
        await settle();
        const [photo] = w.area.state.photos.items;
        expect(photo).toMatchObject({ entity: 'photo', id: 'p1', credit: 'Maria', thumbPath: 'review-held/c/p/t.webp' });
        expect(w.area.state.places.items[0]).toMatchObject({ entity: 'poi', id: 'poi1', credit: null, thumbPath: null });
        expect(w.area.state.pictures).toEqual({ 'review-held/c/p/t.webp': 'blob:review-held/c/p/t.webp' });
        await w.area.intents.decideItem(photo as never, 'approve', ' ');
        expect(w.callables.calls.at(-1)?.request).toEqual({
            cityId: CITY,
            entity: 'photo',
            id: 'p1',
            decision: 'approve',
            seenAt: '2023-11-14T22:13:20.000Z',
        });
        await w.area.intents.decideItem(photo as never, 'refuse', 'Nu.');
        expect(w.callables.calls.at(-1)?.request).toMatchObject({ decision: 'refuse', note: 'Nu.' });
        expect(w.notices.at(-1)).toEqual({ key: 'adminContent.review.done' });
    });

    it('badPath_aDecisionRefusedSaysWhy @S-A90-BAD-DECIDED-TWICE', async () => {
        const w = world();
        w.callables.fail('review.decide', failure('failed-precondition', 'apiError.review.alreadyDecided'));
        await w.area.intents.decideItem(
            {
                entity: 'poi',
                id: 'x',
                title: { ro: 'x' },
                thumbPath: null,
                credit: null,
                description: null,
                links: [],
                seenAt: '2026-10-12T08:00:00.000Z',
            },
            'approve',
            '',
        );
        expect(w.notices.at(-1)).toEqual({ key: 'apiError.review.alreadyDecided' });
        expect(w.area.state.busy).toBe(false);
    });
});

describe('the review queue: suggestions and requests', () => {
    it('happyPath_aSuggestionComparesOnTheMapAndIsAdjusted @S-A93-HAPPY-ADJUST', async () => {
        const w = world('moderator');
        w.store.put(FIRESTORE_PATHS.suggestion(CITY, 's1'), suggestion());
        w.store.put(FIRESTORE_PATHS.photo(CITY, 'p1'), {
            ...PENDING_PHOTO,
            reviewStatus: 'approved',
            location: { lat: 44.5, lng: 26.2 },
            bearing: 10,
            dateText: { ro: 'Vara' },
        });
        w.callables.answer('suggestions.decide', () => ({ status: 'adjusted' }));
        w.area.open([]);
        await settle();
        expect(w.area.state.requests).toBeNull();
        expect(w.area.state.suggestions.items[0]?.voices[0]).toMatchObject({ reason: 'Se vede biserica.', credit: 'Maria' });
        expect(w.area.state.suggestions.items[0]?.voices[1]).toMatchObject({ reason: null, credit: null, sourceUrl: null });
        w.area.intents.select('s1');
        await settle();
        expect(w.area.state.current).toMatchObject({ location: { lat: 44.5, lng: 26.2 }, dateText: 'Vara' });
        w.area.intents.attachMap(CONTAINER);
        await settle();
        expect(w.area.state.map).toBe('ready');
        w.area.intents.startAdjusting();
        w.maps.draw.emitChange({
            final: true,
            features: [{ id: PIN_FEATURE_ID, geometry: { type: 'Point', coordinates: [26.15, 44.45] } }],
        });
        await settle();
        expect(w.area.state.adjusted?.location).toEqual({ lat: 44.45, lng: 26.15 });
        await w.area.intents.decideSuggestion('s1', 'adjust', '');
        expect(w.callables.calls.at(-1)?.request).toMatchObject({
            suggestionId: 's1',
            decision: 'adjust',
            adjusted: { location: { lat: 44.45, lng: 26.15 } },
        });
        w.area.intents.zoomBy(1);
        w.area.close();
        expect(w.area.state.selected).toBeNull();
        w.area.destroy();
    });

    it('happyPath_approveAndRejectSendNoValues @S-A93-HAPPY-APPROVE', async () => {
        const w = world();
        w.callables.answer('suggestions.decide', () => ({ status: 'approved' }));
        await w.area.intents.decideSuggestion('s1', 'approve', '');
        expect(w.callables.calls.at(-1)?.request).toEqual({ cityId: CITY, suggestionId: 's1', decision: 'approve' });
        await w.area.intents.decideSuggestion('s1', 'reject', 'Nu.');
        expect(w.callables.calls.at(-1)?.request).toEqual({ cityId: CITY, suggestionId: 's1', decision: 'reject', note: 'Nu.' });
    });

    it('badPath_aSuggestionNotListedOpensNothing', async () => {
        const w = world();
        w.area.open([]);
        await settle();
        w.area.intents.select('nosuch');
        expect(w.area.state.current).toBeNull();
    });
});

describe('the review queue: the rest', () => {
    it('happyPath_blockingAsksFirstAndKeepsWhatTheyWrote @S-A93-BAD-BLOCKED', async () => {
        const w = world();
        w.callables.answer('contributors.setBlocked', () => ({ blocked: true }));
        w.area.intents.askBlock('a', 'Reclame.');
        expect(w.callables.calls).toEqual([]);
        expect(w.area.state.confirmBlock).toEqual({ uid: 'a', about: 'Reclame.' });
        await w.area.intents.confirmBlock();
        expect(w.callables.calls.at(-1)?.request).toEqual({ cityId: CITY, uid: 'a', blocked: true, about: 'Reclame.' });
        expect(w.notices.at(-1)).toEqual({ key: 'adminContent.review.blocked' });
        expect(w.area.state.confirmBlock).toBeNull();
    });

    it('happyPath_aMisclickIsCancelledAndNothingIsSent', async () => {
        const w = world();
        w.area.intents.askBlock('a', null);
        w.area.intents.cancelBlock();
        expect(w.area.state.confirmBlock).toBeNull();
        await w.area.intents.confirmBlock();
        expect(w.callables.calls).toEqual([]);
    });

    it('happyPath_blockedAccountsAreListedAndLetBack @S-A93-HAPPY-UNBLOCK', async () => {
        const w = world();
        w.store.put(FIRESTORE_PATHS.contributor(CITY, 'a'), {
            day: '2026-10-12',
            count: 3,
            blocked: true,
            blockedBy: 'u',
            blockedFor: 'Reclame.',
            ...STAMP,
        });
        w.store.put(FIRESTORE_PATHS.contributor(CITY, 'b'), { day: '2026-10-12', count: 1, ...STAMP });
        w.callables.answer('contributors.setBlocked', () => ({ blocked: false }));
        w.area.open([]);
        await settle();
        expect(w.area.state.blocked.items).toEqual([{ uid: 'a', about: 'Reclame.' }]);
        await w.area.intents.unblock('a');
        expect(w.callables.calls.at(-1)?.request).toEqual({ cityId: CITY, uid: 'a', blocked: false });
        expect(w.notices.at(-1)).toEqual({ key: 'adminContent.review.unblocked' });
        w.area.intents.retry();
        w.area.close();
    });
});

describe('the review queue: blocks and adjusting', () => {
    it('happyPath_approvingSaysWhatTheReviewerSaw @S-A90-BAD-CHANGED-SINCE', async () => {
        const w = world();
        w.store.put(FIRESTORE_PATHS.photo(CITY, 'p1'), {
            ...PENDING_PHOTO,
            description: { ro: 'Text nou.' },
            links: [{ url: 'https://example.org/x', label: 'Sursa' }],
        });
        w.callables.answer('review.decide', () => ({ status: 'approved' }));
        w.area.open([]);
        await settle();
        const [item] = w.area.state.photos.items;
        expect(item).toMatchObject({
            description: { ro: 'Text nou.' },
            links: [{ url: 'https://example.org/x', label: 'Sursa' }],
            seenAt: '2023-11-14T22:13:20.000Z',
        });
        await w.area.intents.decideItem(item as never, 'approve', '');
        expect(w.callables.calls.at(-1)?.request).toMatchObject({ decision: 'approve', seenAt: '2023-11-14T22:13:20.000Z' });
    });
});

describe('the review queue: adjusting by hand', () => {
    it('happyPath_adjustingTypesEveryValueWithNoMap @S-A93-HAPPY-ADJUST-FIELDS', async () => {
        const w = world();
        w.store.put(FIRESTORE_PATHS.suggestion(CITY, 's1'), suggestion('pending', { proposal: { year: 1950 }, kind: 'correction' }));
        w.callables.answer('suggestions.decide', () => ({ status: 'adjusted' }));
        w.area.open([]);
        await settle();
        w.area.intents.attachMap(CONTAINER);
        await settle();
        w.area.intents.select('s1');
        w.area.intents.startAdjusting();
        w.area.intents.editAdjusted({ bearing: 80, dateText: 'Vara' });
        w.area.intents.editAdjusted({ location: { lat: 44.45, lng: 26.15 } });
        w.area.intents.editAdjusted({ year: undefined });
        expect(w.area.state.adjusted).toEqual({ bearing: 80, dateText: 'Vara', dateLocale: 'ro', location: { lat: 44.45, lng: 26.15 } });
        w.area.intents.editAdjusted({ dateText: '' });
        expect(w.area.state.adjusted).toEqual({ bearing: 80, location: { lat: 44.45, lng: 26.15 } });
        await w.area.intents.decideSuggestion('s1', 'adjust', '');
        expect(w.callables.calls.at(-1)?.request).toMatchObject({ decision: 'adjust', adjusted: { bearing: 80 } });
    });

    it('badPath_adjustChangedNothingIsAnApprovalNotAnAdjustment @S-A93-HAPPY-ADJUST-FIELDS', async () => {
        const w = world();
        w.store.put(FIRESTORE_PATHS.suggestion(CITY, 's1'), suggestion('pending', { proposal: { year: 1950 }, kind: 'correction' }));
        w.callables.answer('suggestions.decide', () => ({ status: 'approved' }));
        w.area.open([]);
        await settle();
        w.area.intents.select('s1');
        w.area.intents.startAdjusting();
        await w.area.intents.decideSuggestion('s1', 'adjust', '');
        expect(w.callables.calls.at(-1)?.request).toEqual({ cityId: CITY, suggestionId: 's1', decision: 'approve' });
    });

    it('happyPath_revertTakesOffThatDecision @S-A93-HAPPY-REVERT', async () => {
        const w = world();
        w.store.put(FIRESTORE_PATHS.suggestion(CITY, 's2'), suggestion('approved', { decidedBy: 'u' }));
        w.callables.answer('suggestions.decide', () => ({ status: 'reverted' }));
        w.area.open([]);
        await settle();
        const [row] = w.area.state.decided.items;
        await w.area.intents.revert(row as never);
        expect(w.callables.calls.at(-1)?.request).toEqual({ cityId: CITY, suggestionId: 's2', decision: 'revert' });
        expect(w.notices.at(-1)).toEqual({ key: 'adminContent.review.reverted' });
    });

    it('badPath_aRevertOfAFieldChangedSinceSaysWhy @S-A93-BAD-REVERT-STALE', async () => {
        const w = world();
        w.callables.fail('suggestions.decide', failure('failed-precondition', 'apiError.suggestion.notRevertable'));
        await w.area.intents.revert({ id: 's' } as never);
        expect(w.notices.at(-1)).toEqual({ key: 'apiError.suggestion.notRevertable' });
    });

    it('happyPath_anOwnerAnswersARequest @S-A92-HAPPY-APPROVE', async () => {
        const w = world();
        w.store.put(FIRESTORE_PATHS.roleRequest(CITY, 'u1'), {
            role: 'uploader',
            reason: 'Am poze.',
            email: 'a@e.test',
            displayName: 'Ana',
            credit: 'Ana P',
            status: 'pending',
            createdAt: STAMP.updatedAt,
            ...STAMP,
        });
        w.store.put(FIRESTORE_PATHS.roleRequest(CITY, 'u2'), {
            role: 'moderator',
            reason: 'Eu.',
            status: 'pending',
            createdAt: STAMP.updatedAt,
            ...STAMP,
        });
        w.callables.answer('contribute.decide', () => ({ status: 'approved' }));
        w.area.open([]);
        await settle();
        expect(w.area.state.requests?.items).toContainEqual({
            uid: 'u1',
            role: 'uploader',
            reason: 'Am poze.',
            credit: 'Ana P',
            name: 'Ana',
            email: 'a@e.test',
        });
        expect(w.area.state.requests?.items).toContainEqual({
            uid: 'u2',
            role: 'moderator',
            reason: 'Eu.',
            credit: null,
            name: '',
            email: '',
        });
        await w.area.intents.decideRequest('u1', 'approve', '');
        expect(w.callables.calls.at(-1)?.request).toEqual({ cityId: CITY, uid: 'u1', decision: 'approve' });
    });

    it('happyPath_retryAttachesAgain', async () => {
        const w = world();
        w.area.open([]);
        await settle();
        w.area.intents.retry();
        await settle();
        expect(w.area.state.photos.status).toBe('ready');
        expect([REVIEW_MODULE.area, w.area.hasUnsavedChanges()]).toEqual(['review', false]);
    });

    it('badPath_aCityThatCannotBeReadHasNoMap', async () => {
        const w = world();
        w.store.drop(FIRESTORE_PATHS.city(CITY));
        w.area.open([]);
        w.area.intents.attachMap(CONTAINER);
        await settle();
        expect(w.maps.created).toHaveLength(0);
    });
});

describe('the review queue: its edges', () => {
    it('badPath_aHeldPictureThatCannotBeReadShowsNothing', async () => {
        const w = world();
        w.store.put(FIRESTORE_PATHS.photo(CITY, 'p1'), { ...PENDING_PHOTO, heldImage: { ...PENDING_PHOTO.heldImage, thumb: 'none' } });
        w.area.open([]);
        await settle();
        expect(w.area.state.pictures).toEqual({});
        expect(w.area.state.photos.items[0]?.thumbPath).toBe('none');
    });

    it('happyPath_leavingFreesThePictures', async () => {
        const released: string[] = [];
        const w = world();
        const files = {
            url: () => Promise.resolve('blob:x'),
            read: () => Promise.resolve(null),
            release: (url: string) => released.push(url),
            save: () => Promise.resolve(false),
        };
        const area = REVIEW_MODULE.create({ ...w.services, files: files });
        w.store.put(FIRESTORE_PATHS.photo(CITY, 'p1'), PENDING_PHOTO);
        area.open([]);
        await settle();
        area.destroy();
        expect(released).toEqual(['blob:x']);
    });

    it('badPath_withoutTheFileReaderOrTheMapFactory', async () => {
        const w = world();
        const area = REVIEW_MODULE.create({ ...w.services, files: null, maps: null });
        w.store.put(FIRESTORE_PATHS.photo(CITY, 'p1'), PENDING_PHOTO);
        area.open([]);
        area.intents.attachMap(CONTAINER);
        await settle();
        expect(area.state.pictures).toEqual({});
        expect(area.state.map).toBe('unavailable');
        area.intents.zoomBy(1);
        area.destroy();
    });

    it('happyPath_aPhotoGoneWhileComparedAndAProposalWithNoPlace', async () => {
        const w = world();
        w.store.put(FIRESTORE_PATHS.suggestion(CITY, 's1'), suggestion('pending', { proposal: { year: 1950 }, kind: 'correction' }));
        w.area.open([]);
        await settle();
        w.area.intents.attachMap(CONTAINER);
        await settle();
        w.area.intents.select('s1');
        await settle();
        expect(w.area.state.current).toBeNull();
        w.area.intents.startAdjusting();
        expect(w.area.state.adjusted).toEqual({ year: 1950 });
        w.store.put(FIRESTORE_PATHS.photo(CITY, 'p1'), { ...PENDING_PHOTO, reviewStatus: 'approved' });
        await settle();
        expect(w.area.state.current).toEqual({});
    });

    it('badPath_adjustingWithNothingSelectedSendsEmptyValues', async () => {
        const w = world();
        w.callables.fail('suggestions.decide', failure('invalid-argument', 'apiError.invalidRequest'));
        w.area.intents.startAdjusting();
        expect(w.area.state.adjusted).toEqual({});
        await w.area.intents.decideSuggestion('s1', 'adjust', '');
        expect(w.notices.at(-1)).toEqual({ key: 'apiError.invalidRequest' });
    });

    it('badPath_aMapPinMovedWithNothingSelectedAndAPinRefused', async () => {
        const w = world();
        w.area.open([]);
        await settle();
        w.area.intents.attachMap(CONTAINER);
        await settle();
        w.area.intents.select('nosuch');
        await settle();
        w.maps.draw.emitRefused();
        expect(w.notices.at(-1)).toEqual({ key: 'apiError.suggestion.outsideCity' });
        expect(w.area.state.map).toBe('ready');
    });
});

describe('the review queue: stories (M17 §2)', () => {
    it('happyPath_anUploadersStoryWaitsWithItsTextAndIsDecided', async () => {
        const w = world('moderator');
        w.store.put(FIRESTORE_PATHS.story(CITY, 'st1'), {
            title: { ro: 'Teatrul' },
            body: { ro: 'A ars în 1944.' },
            published: false,
            reviewStatus: 'pending',
            credit: 'Maria',
            ...STAMP,
        });
        w.callables.answer('review.decide', () => ({ status: 'approved' }));
        w.area.open([]);
        await settle();
        const [story] = w.area.state.stories.items;
        expect(story).toMatchObject({ entity: 'story', id: 'st1', description: { ro: 'A ars în 1944.' }, credit: 'Maria', links: [] });
        await w.area.intents.decideItem(story as never, 'approve', '');
        expect(w.callables.calls.at(-1)?.request).toMatchObject({ entity: 'story', id: 'st1', decision: 'approve' });
    });
});
