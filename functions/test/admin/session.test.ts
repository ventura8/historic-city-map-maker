/**
 * `admin.session` (`functions/src/admin/session.ts`, M2-interfaces §3.1) through its callable's `.run()` on the
 * Firestore emulator: what the admin app shows after a Google sign-in.
 */
import {
    FIRESTORE_PATHS,
    adminDocSchema,
    cityDocSchema,
    inviteDocSchema,
    inviteIdFor,
    ownerDocSchema,
    timestampFromDate,
    type CityRoles,
    type Schema,
} from '@hcm/shared';
import { afterAll, describe, expect, it } from 'vitest';

import { sessionFunction } from '../../src/admin/session.js';
import { UpstreamError } from '../../src/ports/errors.js';
import { callableRequest, failureOf, googleToken, openEmulators, type World } from './world.js';

const emulators = openEmulators('fn-admin-session');

afterAll(async () => {
    await emulators.close();
});

const EMAIL = 'session-user@example.test';
const AT = timestampFromDate(new Date('2026-10-01T08:00:00.000Z'));

function session(world: World, uid: string, token = googleToken(EMAIL)) {
    return sessionFunction(() => world).run(callableRequest({}, { uid, token }));
}

async function seedOwner(world: World, uid: string): Promise<void> {
    await world.documents.set(FIRESTORE_PATHS.setupOwner, ownerDocSchema, { uid, claimedAt: AT, updatedBy: uid, updatedAt: AT });
    await world.documents.set(FIRESTORE_PATHS.admin(uid), adminDocSchema, { role: 'owner', createdAt: AT, updatedBy: uid, updatedAt: AT });
}

async function seedInvite(world: World, expiresAt: Date, cities?: CityRoles): Promise<void> {
    const invite = {
        role: 'admin',
        invitedBy: 'u-owner',
        createdAt: AT,
        expiresAt: timestampFromDate(expiresAt),
        updatedBy: 'u-owner',
        updatedAt: AT,
    } as const;
    await world.documents.set(
        FIRESTORE_PATHS.invite(await inviteIdFor(EMAIL)),
        inviteDocSchema,
        cities === undefined ? invite : { ...invite, cities },
    );
}

async function seedCity(world: World, cityId: string, name: { readonly ro: string; readonly en?: string }): Promise<void> {
    const bounds = { west: 25.9, south: 44.3, east: 26.3, north: 44.6 };
    await world.documents.set(FIRESTORE_PATHS.city(cityId), cityDocSchema, {
        name,
        bounds,
        published: true,
        updatedBy: 'u-owner',
        updatedAt: AT,
    });
}

describe('admin.session', () => {
    it('happyPath_aNewProjectOffersTheOwnerClaim', async () => {
        const world = emulators.newWorld();

        await expect(session(world, 'u-first')).resolves.toEqual({
            admin: false,
            role: null,
            claim: false,
            refreshToken: false,
            ownerClaimed: false,
            invitePending: false,
            cities: [],
            projectOwner: false,
        });
    });

    it('happyPath_theOwnerWithTheClaimNeedsNothing', async () => {
        const world = emulators.newWorld();
        await seedOwner(world, 'u-owner');

        await expect(session(world, 'u-owner', googleToken(EMAIL, { admin: true }))).resolves.toEqual({
            admin: true,
            role: 'owner',
            claim: true,
            refreshToken: false,
            ownerClaimed: true,
            invitePending: false,
            cities: [],
            projectOwner: true,
        });
    });

    it('badPath_aDocumentWithoutTheClaimOrAClaimWithoutTheDocumentAsksForARefresh', async () => {
        const world = emulators.newWorld();
        await seedOwner(world, 'u-owner');

        await expect(session(world, 'u-owner')).resolves.toMatchObject({ admin: true, claim: false, refreshToken: true });
        await expect(session(world, 'u-revoked', googleToken(EMAIL, { admin: true }))).resolves.toMatchObject({
            admin: false,
            claim: true,
            refreshToken: true,
        });
    });

    it('happyPath_aPendingInvitationIsOfferedUntilItExpires', async () => {
        const world = emulators.newWorld();
        await seedOwner(world, 'u-owner');
        await seedInvite(world, new Date('2026-10-20T08:00:00.000Z'));

        await expect(session(world, 'u-invited')).resolves.toMatchObject({ ownerClaimed: true, invitePending: true });
        await expect(session(world, 'u-invited', googleToken(EMAIL.toUpperCase()))).resolves.toMatchObject({ invitePending: true });

        world.clock.set('2026-10-20T08:00:00.000Z');
        await expect(session(world, 'u-invited')).resolves.toMatchObject({ invitePending: false });
    });

    it('badPath_anIdTokenWithoutAnAddressHasNoInvitation', async () => {
        const world = emulators.newWorld();
        await seedInvite(world, new Date('2026-10-20T08:00:00.000Z'));
        const token = googleToken(EMAIL);

        await expect(session(world, 'u-invited', { email_verified: true, firebase: token.firebase })).resolves.toMatchObject({
            invitePending: false,
        });
    });

    it('badPath_anUnverifiedOrNonGoogleAccountIsRefused @S-A20-BAD-UNVERIFIED-ACCOUNT', async () => {
        const world = emulators.newWorld();

        const unverified = await failureOf(session(world, 'u-first', googleToken(EMAIL, { email_verified: false })));
        const anonymous = await failureOf(session(world, 'u-first', googleToken(EMAIL, { firebase: { sign_in_provider: 'anonymous' } })));

        expect([unverified, anonymous]).toMatchObject([
            { code: 'permission-denied', details: { code: 'apiError.accountNotAllowed' } },
            { code: 'permission-denied', details: { code: 'apiError.accountNotAllowed' } },
        ]);
    });
});

/** M5 (`docs/research/M5-interfaces.md` §1.2): the cities the admin belongs to, migrated and invited ones included. */
describe('admin.session: the cities', () => {
    it('happyPath_anAdminFromBeforeM5GetsEveryExistingCityAtTheFirstSession @S-A51-HAPPY-MIGRATION', async () => {
        const world = emulators.newWorld();
        await seedOwner(world, 'u-owner');
        await world.documents.set(FIRESTORE_PATHS.admin('u-editor'), adminDocSchema, {
            role: 'admin',
            createdAt: AT,
            updatedBy: 'u-owner',
            updatedAt: AT,
        });
        await seedCity(world, 'cluj', { ro: 'Cluj-Napoca' });
        await seedCity(world, 'bucharest', { ro: 'București', en: 'Bucharest' });

        const owner = await session(world, 'u-owner', googleToken(EMAIL, { admin: true }));
        const editor = await session(world, 'u-editor', googleToken('editor@example.test', { admin: true }));

        expect([owner.cities, owner.projectOwner, editor.projectOwner]).toEqual([
            [
                { id: 'bucharest', role: 'owner', name: { ro: 'București', en: 'Bucharest' } },
                { id: 'cluj', role: 'owner', name: { ro: 'Cluj-Napoca' } },
            ],
            true,
            false,
        ]);
        expect(editor.cities.map((city) => [city.id, city.role])).toEqual([
            ['bucharest', 'editor'],
            ['cluj', 'editor'],
        ]);
        await expect(world.documents.get(FIRESTORE_PATHS.admin('u-editor'), adminDocSchema)).resolves.toMatchObject({
            cities: { bucharest: 'editor', cluj: 'editor' },
            updatedBy: 'system:cities',
        });
    });

    it('happyPath_anAdminInvitedToAnotherCityGetsItAtTheNextSession @S-A49-HAPPY', async () => {
        const world = emulators.newWorld();
        await seedCity(world, 'bucharest', { ro: 'București' });
        await seedCity(world, 'cluj', { ro: 'Cluj-Napoca' });
        const stamp = { createdAt: AT, updatedBy: 'u-owner', updatedAt: AT };
        await world.documents.set(FIRESTORE_PATHS.admin('u-editor'), adminDocSchema, {
            role: 'admin',
            cities: { bucharest: 'owner' },
            ...stamp,
        });
        await seedInvite(world, new Date('2026-10-20T08:00:00.000Z'), { cluj: 'editor', bucharest: 'editor' });

        const answer = await session(world, 'u-editor', googleToken(EMAIL, { admin: true }));

        expect(answer.cities.map((city) => [city.id, city.role])).toEqual([
            ['bucharest', 'owner'],
            ['cluj', 'editor'],
        ]);
        expect(answer.invitePending).toBe(false);
        await expect(world.documents.get(FIRESTORE_PATHS.invite(await inviteIdFor(EMAIL)), inviteDocSchema)).resolves.toBeUndefined();
    });

    it('badPath_anExpiredOrCitylessInvitationIsNotTakenByAnAdmin', async () => {
        const world = emulators.newWorld();
        const stamp = { createdAt: AT, updatedBy: 'u-owner', updatedAt: AT };
        await world.documents.set(FIRESTORE_PATHS.admin('u-editor'), adminDocSchema, { role: 'admin', cities: {}, ...stamp });
        await seedInvite(world, new Date('2026-10-01T08:00:00.000Z'), { cluj: 'editor' });

        await expect(session(world, 'u-editor', googleToken(EMAIL, { admin: true }))).resolves.toMatchObject({ cities: [] });
        await seedInvite(world, new Date('2026-10-20T08:00:00.000Z'));
        await expect(session(world, 'u-editor', googleToken(EMAIL, { admin: true }))).resolves.toMatchObject({ cities: [] });
        await expect(world.documents.get(FIRESTORE_PATHS.invite(await inviteIdFor(EMAIL)), inviteDocSchema)).resolves.toBeDefined();
    });

    it('badPath_aCityWithoutItsDocumentYetOrAnInvalidOneShowsItsId', async () => {
        // The bundled city has no document until Setup writes it: its owner can still open it, and invite.
        const world = emulators.newWorld();
        const stamp = { createdAt: AT, updatedBy: 'u-owner', updatedAt: AT };
        await world.documents.set(FIRESTORE_PATHS.admin('u-editor'), adminDocSchema, {
            role: 'admin',
            cities: { later: 'editor', broken: 'owner' },
            ...stamp,
        });
        await world.db.doc(FIRESTORE_PATHS.city('broken')).set({ name: 'not a localized name', published: 'yes' });

        const answer = await session(world, 'u-editor', googleToken('editor@example.test', { admin: true }));
        expect([...answer.cities].sort((a, b) => a.id.localeCompare(b.id))).toEqual([
            { id: 'broken', role: 'owner', name: { ro: 'broken' } },
            { id: 'later', role: 'editor', name: { ro: 'later' } },
        ]);
        expect(world.recording.records).toMatchObject([{ level: 'warn', data: { cityId: 'broken' } }]);
    });

    it('badPath_aCityThatCannotBeReadFailsTheSession', async () => {
        const world = emulators.newWorld();
        const stamp = { createdAt: AT, updatedBy: 'u-owner', updatedAt: AT };
        await world.documents.set(FIRESTORE_PATHS.admin('u-editor'), adminDocSchema, {
            role: 'admin',
            cities: { cluj: 'editor' },
            ...stamp,
        });
        const down = new UpstreamError('firestore', 'unavailable', { status: 503 });
        const documents = {
            ...world.documents,
            get: <T>(path: string, schema: Schema<T>) =>
                path.startsWith('cities/') ? Promise.reject(down) : world.documents.get(path, schema),
        };

        const failure = await failureOf(
            sessionFunction(() => ({ ...world, documents })).run(
                callableRequest({}, { uid: 'u-editor', token: googleToken('editor@example.test', { admin: true }) }),
            ),
        );

        expect(failure).toMatchObject({ code: 'unavailable' });
    });
});
