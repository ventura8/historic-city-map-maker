/** `contribute.context`, `contribute.request` and `contribute.decide` (M13 §3), through their callables' `.run()`. */
import {
    FIRESTORE_PATHS,
    ROLE_REQUEST_RETRY_DAYS,
    adminDocSchema,
    cityDocSchema,
    contributorDocSchema,
    photoDocSchema,
    roleRequestDocSchema,
} from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { contributeFunctions } from '../../src/admin/index.js';
import { cityDoc } from '../publish/city.js';
import { CITY_ID, as, communityWorld, refusal, seedMember, seedPhoto, type CommunityWorld } from '../photos/community-world.js';

const ask = (w: CommunityWorld, uid: string | null, data: Record<string, unknown> = {}) =>
    contributeFunctions(() => w).request.run(as(uid, { cityId: CITY_ID, role: 'uploader', reason: 'Am multe fotografii vechi.', ...data }));
const context = (w: CommunityWorld, uid: string | null, data: Record<string, unknown> = {}) =>
    contributeFunctions(() => w).context.run(as(uid, { cityId: CITY_ID, ...data }));
const decide = (w: CommunityWorld, uid: string, data: Record<string, unknown> = {}) =>
    contributeFunctions(() => w).decide.run(as(uid, { cityId: CITY_ID, uid: 'u-applicant', decision: 'approve', ...data }));
const request = (w: CommunityWorld) => w.documents.get(FIRESTORE_PATHS.roleRequest(CITY_ID, 'u-applicant'), roleRequestDocSchema);
const admin = (w: CommunityWorld, uid = 'u-applicant') => w.documents.get(FIRESTORE_PATHS.admin(uid), adminDocSchema);

describe('contribute.context after a removal', () => {
    it('happyPath_aRemovedMemberIsNotToldTheyAreApprovedAndMayAskAgain @S-A92-HAPPY-ASK-AGAIN', async () => {
        const w = await communityWorld();
        await ask(w, 'u-applicant');
        await decide(w, 'u-owner');
        await w.documents.delete(FIRESTORE_PATHS.admin('u-applicant'));
        await expect(context(w, 'u-applicant')).resolves.toMatchObject({ role: null, request: null });
        await expect(ask(w, 'u-applicant')).resolves.toEqual({ status: 'pending' });
    });

    it('happyPath_aMemberStillSeesTheirApprovedRequest', async () => {
        const w = await communityWorld();
        await ask(w, 'u-applicant');
        await decide(w, 'u-owner');
        await expect(context(w, 'u-applicant')).resolves.toMatchObject({ role: 'uploader', request: { status: 'approved' } });
    });
});

describe('contribute.request', () => {
    it('happyPath_anyoneAsksForARole @S-A92-HAPPY-REQUEST', async () => {
        const w = await communityWorld();
        await expect(ask(w, 'u-applicant', { credit: 'Maria' })).resolves.toEqual({ status: 'pending' });
        expect(await request(w)).toMatchObject({
            role: 'uploader',
            status: 'pending',
            credit: 'Maria',
            email: 'u-applicant@example.test',
            displayName: 'Name of u-applicant',
        });
        expect(await admin(w)).toBeUndefined();
        expect(w.auth.claims.size).toBe(0);
    });

    it('badPath_oneOpenRequestPerAccount @S-A92-BAD-ALREADY-PENDING', async () => {
        const w = await communityWorld();
        await ask(w, 'u-applicant');
        expect(await refusal(ask(w, 'u-applicant', { role: 'moderator' }))).toBe('apiError.contribute.alreadyPending');
    });

    it('badPath_aBlockedAccountIsRefused @S-A92-BAD-BLOCKED', async () => {
        const w = await communityWorld();
        await w.documents.set(FIRESTORE_PATHS.contributor(CITY_ID, 'u-applicant'), contributorDocSchema, {
            day: '2026-10-12',
            count: 0,
            blocked: true,
            updatedBy: 'u-owner',
            updatedAt: { seconds: 0, nanoseconds: 0 },
        });
        expect(await refusal(ask(w, 'u-applicant'))).toBe('apiError.contribute.blocked');
    });

    it('badPath_aRoleTheAccountAlreadyCovers', async () => {
        const w = await communityWorld();
        await seedMember(w, 'u-applicant', { [CITY_ID]: 'moderator' });
        expect(await refusal(ask(w, 'u-applicant'))).toBe('apiError.contribute.alreadyMember');
        await expect(ask(w, 'u-applicant', { role: 'moderator' })).rejects.toBeDefined();
    });

    it('happyPath_anUploaderMayAskToModerate', async () => {
        const w = await communityWorld();
        await seedMember(w, 'u-applicant', { [CITY_ID]: 'uploader' });
        await expect(ask(w, 'u-applicant', { role: 'moderator' })).resolves.toEqual({ status: 'pending' });
    });

    it('badPath_aCityNotPublicOrMissing', async () => {
        const w = await communityWorld();
        await w.documents.set(FIRESTORE_PATHS.city(CITY_ID), cityDocSchema, cityDoc({ published: false }));
        expect(await refusal(ask(w, 'u-applicant'))).toBe('apiError.notFound');
        expect(await refusal(ask(w, 'u-applicant', { cityId: 'nosuch' }))).toBe('apiError.notFound');
    });

    it.each([
        ['owner', { role: 'owner' }],
        ['editor', { role: 'editor' }],
        ['no reason', { reason: '' }],
    ])('badPath_askingFor_%s_isInvalid', async (_name, data) => {
        const w = await communityWorld();
        expect(await refusal(ask(w, 'u-applicant', data))).toBe('apiError.invalidRequest');
    });

    it('badPath_signedOut', async () => {
        const w = await communityWorld();
        expect(await refusal(ask(w, null))).toBe('apiError.unauthenticated');
    });
});

describe('contribute.decide', () => {
    it('happyPath_anOwnerApprovesAndTheAccountIsAMemberOfThisCityOnly @S-A92-HAPPY-APPROVE', async () => {
        const w = await communityWorld();
        await ask(w, 'u-applicant');
        await expect(decide(w, 'u-owner')).resolves.toEqual({ status: 'approved' });
        expect((await admin(w))?.cities).toEqual({ [CITY_ID]: 'uploader' });
        expect((await admin(w))?.role).toBe('admin');
        expect(w.auth.claims.get('u-applicant')).toBe(true);
        expect(await request(w)).toMatchObject({ status: 'approved', decidedBy: 'u-owner' });
    });

    it('happyPath_anExistingAdminKeepsTheirOtherCitiesAndTheStrongerRole', async () => {
        const w = await communityWorld();
        await seedMember(w, 'u-applicant', { cluj: 'editor', [CITY_ID]: 'uploader' });
        await ask(w, 'u-applicant', { role: 'moderator' });
        await decide(w, 'u-owner');
        expect((await admin(w))?.cities).toEqual({ cluj: 'editor', [CITY_ID]: 'moderator' });
    });

    it('badPath_aRefusedPersonIsToldAndWaits @S-A92-BAD-REFUSED-TOLD', async () => {
        const w = await communityWorld();
        await ask(w, 'u-applicant');
        await expect(decide(w, 'u-owner', { decision: 'refuse', note: 'Trimite mai multe detalii.' })).resolves.toEqual({
            status: 'refused',
        });
        expect(await admin(w)).toBeUndefined();
        expect(w.auth.claims.size).toBe(0);
        const told = await context(w, 'u-applicant');
        expect(told.request).toMatchObject({ status: 'refused', note: 'Trimite mai multe detalii.' });
        expect(told.request?.retryAt).toBeDefined();
        expect(await refusal(ask(w, 'u-applicant'))).toBe('apiError.contribute.retryLater');
    });

    it('happyPath_aRefusedPersonMayAskAgainLater', async () => {
        const w = await communityWorld();
        await ask(w, 'u-applicant');
        await decide(w, 'u-owner', { decision: 'refuse' });
        w.clock.set(new Date(w.clock.now().getTime() + (ROLE_REQUEST_RETRY_DAYS + 1) * 86_400_000).toISOString());
        await expect(ask(w, 'u-applicant')).resolves.toEqual({ status: 'pending' });
        expect((await request(w))?.note).toBeUndefined();
    });

    it('badPath_decidedTwice @S-A92-BAD-DECIDED-TWICE', async () => {
        const w = await communityWorld();
        await ask(w, 'u-applicant');
        await decide(w, 'u-owner');
        expect(await refusal(decide(w, 'u-owner', { decision: 'refuse' }))).toBe('apiError.contribute.alreadyDecided');
    });

    it('badPath_noRequest', async () => {
        const w = await communityWorld();
        expect(await refusal(decide(w, 'u-owner'))).toBe('apiError.notFound');
    });

    it.each([
        ['u-editor', 'apiError.city.notOwner'],
        ['u-moderator', 'apiError.city.notOwner'],
        ['u-uploader', 'apiError.city.notOwner'],
        ['u-other', 'apiError.city.notMember'],
        ['u-stranger', 'apiError.notAdmin'],
    ])('badPath_%s_mayNotDecide @S-A92-BAD-NOT-OWNER', async (uid, code) => {
        const w = await communityWorld();
        await ask(w, 'u-applicant');
        expect(await refusal(decide(w, uid))).toBe(code);
        expect(await admin(w)).toBeUndefined();
    });
});

describe('contribute.context', () => {
    it('happyPath_aStrangerReadsTheCityAndAPublicPhoto @S-A92-HAPPY-CONTEXT', async () => {
        const w = await communityWorld();
        await seedPhoto(w, 'p1');
        const answer = await context(w, 'u-stranger', { photoId: 'p1' });
        expect(answer).toMatchObject({ role: null, blocked: false, request: null });
        expect(answer.city.id).toBe(CITY_ID);
        expect(answer.photo).toMatchObject({ id: 'p1', location: { lat: 44.43, lng: 26.09 } });
    });

    it('happyPath_aMemberSeesTheirRole', async () => {
        const w = await communityWorld();
        await seedMember(w, 'u-moderator', { [CITY_ID]: 'moderator' });
        expect((await context(w, 'u-moderator')).role).toBe('moderator');
    });

    it.each([
        ['unpublished', { published: false }],
        ['pending', { reviewStatus: 'pending', published: true }],
        ['refused', { reviewStatus: 'refused', published: true }],
        ['without pictures', { image: undefined }],
    ])('badPath_aPhoto_%s_isNotThere @S-A92-BAD-NOT-PUBLIC', async (_name, overrides) => {
        const w = await communityWorld();
        await seedPhoto(w, 'p1', overrides as object);
        expect(await refusal(context(w, 'u-stranger', { photoId: 'p1' }))).toBe('apiError.notFound');
        expect(await w.documents.get(FIRESTORE_PATHS.photo(CITY_ID, 'p1'), photoDocSchema)).toBeDefined();
    });

    it('badPath_aCityNotYetPublicIsItsMembersOnly', async () => {
        const w = await communityWorld();
        await w.documents.set(FIRESTORE_PATHS.city(CITY_ID), cityDocSchema, cityDoc({ published: false }));
        expect(await refusal(context(w, 'u-stranger'))).toBe('apiError.notFound');
        await seedMember(w, 'u-editor', { [CITY_ID]: 'editor' });
        await expect(context(w, 'u-editor')).resolves.toMatchObject({ role: 'editor' });
    });

    it('badPath_signedOut', async () => {
        const w = await communityWorld();
        expect(await refusal(context(w, null))).toBe('apiError.unauthenticated');
    });
});
