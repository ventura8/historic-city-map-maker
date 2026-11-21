/**
 * `admin.join` (`functions/src/admin/join.ts`, M2-interfaces §3.1) through its callable's `.run()` on the Firestore
 * and Auth emulators: an invited Google account becomes an admin once, before its invitation expires.
 */
import { FIRESTORE_PATHS, adminDocSchema, inviteDocSchema, inviteIdFor, timestampFromDate, type CityRoles } from '@hcm/shared';
import { afterAll, describe, expect, it } from 'vitest';

import { joinFunction } from '../../src/admin/join.js';
import { callableRequest, failureOf, googleToken, loggedText, openEmulators, type World } from './world.js';

const emulators = openEmulators('fn-admin-join');

afterAll(async () => {
    await emulators.close();
});

const AT = timestampFromDate(new Date('2026-10-01T08:00:00.000Z'));
const EXPIRES = new Date('2026-10-15T08:00:00.000Z');

let accounts = 0;

async function newAccount(world: World): Promise<{ readonly uid: string; readonly email: string }> {
    accounts += 1;
    const uid = `fn-admin-join-${String(accounts)}`;
    const email = `${uid}@example.test`;
    await world.sdkAuth.createUser({ uid, email, emailVerified: true, displayName: 'Invited Test' });
    return { uid, email };
}

async function invite(world: World, email: string, cities?: CityRoles): Promise<string> {
    const inviteId = await inviteIdFor(email);
    const stored = {
        role: 'admin',
        invitedBy: 'u-owner',
        createdAt: AT,
        expiresAt: timestampFromDate(EXPIRES),
        updatedBy: 'u-owner',
        updatedAt: AT,
    } as const;
    await world.documents.set(FIRESTORE_PATHS.invite(inviteId), inviteDocSchema, cities === undefined ? stored : { ...stored, cities });
    return inviteId;
}

function join(world: World, uid: string, email: string | undefined) {
    const token = googleToken(email ?? '');
    const auth = { uid, token: email === undefined ? { email_verified: true, firebase: token.firebase } : token };
    return joinFunction(() => world).run(callableRequest({}, auth));
}

describe('admin.join', () => {
    it('happyPath_anInvitedAccountJoinsOnce', async () => {
        const world = emulators.newWorld();
        const { uid, email } = await newAccount(world);
        const inviteId = await invite(world, email);

        await expect(join(world, uid, email)).resolves.toEqual({ role: 'admin', refreshToken: true });

        await expect(world.documents.get(FIRESTORE_PATHS.admin(uid), adminDocSchema)).resolves.toMatchObject({
            role: 'admin',
            email,
            displayName: 'Invited Test',
            invitedBy: 'u-owner',
            updatedBy: uid,
        });
        await expect(world.documents.get(FIRESTORE_PATHS.invite(inviteId), inviteDocSchema)).resolves.toBeUndefined();
        expect((await world.sdkAuth.getUser(uid)).customClaims).toEqual({ admin: true });
        expect(loggedText(world.recording)).not.toContain(email);
        await expect(failureOf(join(world, uid, email))).resolves.toMatchObject({ details: { code: 'apiError.invite.notFound' } });
    });

    it('happyPath_anOwnerWhoWasAlsoInvitedStaysTheOwner', async () => {
        const world = emulators.newWorld();
        const { uid, email } = await newAccount(world);
        await world.documents.set(FIRESTORE_PATHS.admin(uid), adminDocSchema, {
            role: 'owner',
            createdAt: AT,
            updatedBy: uid,
            updatedAt: AT,
        });
        await invite(world, email);

        await expect(join(world, uid, email)).resolves.toEqual({ role: 'owner', refreshToken: true });
        await expect(world.documents.get(FIRESTORE_PATHS.admin(uid), adminDocSchema)).resolves.toMatchObject({
            role: 'owner',
            createdAt: AT,
        });
    });

    it('happyPath_anInvitationToCitiesMakesTheAccountAnAdminOfThoseCitiesOnly @S-A51-HAPPY', async () => {
        const world = emulators.newWorld();
        const { uid, email } = await newAccount(world);
        await invite(world, email, { cluj: 'editor' });

        await expect(join(world, uid, email)).resolves.toEqual({ role: 'admin', refreshToken: true });

        await expect(world.documents.get(FIRESTORE_PATHS.admin(uid), adminDocSchema)).resolves.toMatchObject({
            cities: { cluj: 'editor' },
        });
    });

    it('happyPath_anOwnerOfACityInvitedAsItsEditorStaysItsOwner', async () => {
        const world = emulators.newWorld();
        const { uid, email } = await newAccount(world);
        const stamp = { createdAt: AT, updatedBy: uid, updatedAt: AT };
        await world.documents.set(FIRESTORE_PATHS.admin(uid), adminDocSchema, { role: 'owner', cities: { cluj: 'owner' }, ...stamp });
        await invite(world, email, { cluj: 'editor', bacau: 'editor' });

        await join(world, uid, email);

        await expect(world.documents.get(FIRESTORE_PATHS.admin(uid), adminDocSchema)).resolves.toMatchObject({
            cities: { cluj: 'owner', bacau: 'editor' },
        });
    });

    it('badPath_anExpiredInvitationCannotBeUsed @S-A02-BAD-EXPIRED-INVITE', async () => {
        const world = emulators.newWorld();
        const { uid, email } = await newAccount(world);
        await invite(world, email);
        world.clock.set(EXPIRES.toISOString());

        const failure = await failureOf(join(world, uid, email));

        expect(failure).toMatchObject({ code: 'failed-precondition', details: { code: 'apiError.invite.expired' } });
        await expect(world.documents.get(FIRESTORE_PATHS.admin(uid), adminDocSchema)).resolves.toBeUndefined();
        expect((await world.sdkAuth.getUser(uid)).customClaims ?? {}).toEqual({});
    });

    it('badPath_anotherAddressFindsNoInvitationAndLeavesItPending', async () => {
        const world = emulators.newWorld();
        const invited = await newAccount(world);
        const other = await newAccount(world);
        const inviteId = await invite(world, invited.email);

        const failure = await failureOf(join(world, other.uid, other.email));

        expect(failure).toMatchObject({ code: 'not-found', details: { code: 'apiError.invite.notFound' } });
        await expect(world.documents.get(FIRESTORE_PATHS.invite(inviteId), inviteDocSchema)).resolves.toBeDefined();
    });

    it('badPath_anIdTokenWithoutAnAddressHasNoInvitation', async () => {
        const world = emulators.newWorld();
        const { uid } = await newAccount(world);

        await expect(failureOf(join(world, uid, undefined))).resolves.toMatchObject({ details: { code: 'apiError.invite.notFound' } });
    });

    it('badPath_anUnverifiedAccountCannotJoin @S-A20-BAD-UNVERIFIED-ACCOUNT', async () => {
        const world = emulators.newWorld();
        const { uid, email } = await newAccount(world);
        await invite(world, email);

        const failure = await failureOf(
            joinFunction(() => world).run(callableRequest({}, { uid, token: googleToken(email, { email_verified: false }) })),
        );

        expect(failure).toMatchObject({ details: { code: 'apiError.accountNotAllowed' } });
    });
});
