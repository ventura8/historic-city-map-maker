/**
 * `admins.revoke` (`functions/src/admin/revoke.ts`, M2-interfaces §3.1, M5-interfaces §1.7) through its callable's
 * `.run()` on the Firestore and Auth emulators: an admin leaves one city; one who leaves their last city loses access at
 * once; a city keeps one owner, and nobody removes themselves.
 */
import {
    FIRESTORE_PATHS,
    adminDocSchema,
    inboxItemDocSchema,
    inviteDocSchema,
    notifySettingsDocSchema,
    pushDeviceDocSchema,
    timestampFromDate,
    type AdminRole,
    type CityRoles,
} from '@hcm/shared';
import { afterAll, describe, expect, it } from 'vitest';

import { revokeFunction } from '../../src/admin/revoke.js';
import { requireAccess } from '../../src/api/access.js';
import { UpstreamError } from '../../src/ports/errors.js';
import { callableRequest, failureOf, googleToken, openEmulators, type World } from './world.js';

const emulators = openEmulators('fn-admin-revoke');

afterAll(async () => {
    await emulators.close();
});

const AT = timestampFromDate(new Date('2026-10-01T08:00:00.000Z'));
const INVITE_ID = 'd'.repeat(64);
const CITY = 'bucharest';

let accounts = 0;

/** The roles an admin of this file gets by their project role: the city's owner, or its editor. */
function rolesOf(role: AdminRole): CityRoles {
    return { [CITY]: role === 'owner' ? 'owner' : 'editor' };
}

/** An admin of this file: its Auth account with the claim, and its `admins/{uid}` document. */
async function seedAdmin(world: World, role: AdminRole = 'admin', cities: CityRoles = rolesOf(role)): Promise<string> {
    accounts += 1;
    const uid = `fn-admin-revoke-${String(accounts)}`;
    await world.sdkAuth.createUser({ uid, email: `${uid}@example.test`, emailVerified: true });
    await world.sdkAuth.setCustomUserClaims(uid, { admin: true, beta: true });
    const doc = { role, cities, createdAt: AT, updatedBy: uid, updatedAt: AT };
    await world.documents.set(FIRESTORE_PATHS.admin(uid), adminDocSchema, doc);
    return uid;
}

function revoke(world: World, caller: string, data: Readonly<Record<string, unknown>>) {
    return revokeFunction(() => world).run(
        callableRequest({ cityId: CITY, ...data }, { uid: caller, token: googleToken(`${caller}@example.test`, { admin: true }) }),
    );
}

describe('admins.revoke', () => {
    it('happyPath_aRevokedAdminLosesAccessAtOnce', async () => {
        const world = emulators.newWorld();
        const owner = await seedAdmin(world, 'owner');
        const admin = await seedAdmin(world);

        await expect(revoke(world, owner, { kind: 'admin', uid: admin })).resolves.toEqual({ revoked: true });

        await expect(world.documents.get(FIRESTORE_PATHS.admin(admin), adminDocSchema)).resolves.toBeUndefined();
        const account = await world.sdkAuth.getUser(admin);
        expect(account.customClaims).toEqual({ beta: true });
        expect(account.tokensValidAfterTime).toBeDefined();
        const staleToken = { uid: admin, token: googleToken(`${admin}@example.test`, { admin: true }) };
        await expect(requireAccess('admin', staleToken, world.admins)).rejects.toMatchObject({ code: 'apiError.notAdmin' });
    });

    it('happyPath_aRevokedAdminsPushDevicesInboxAndNotificationSettingsGoToo @S-A47-BAD-SHARED-BROWSER', async () => {
        const world = emulators.newWorld();
        const owner = await seedAdmin(world, 'owner');
        const admin = await seedAdmin(world);
        const stamp = { updatedBy: admin, updatedAt: AT };
        await world.documents.set(FIRESTORE_PATHS.pushDevice(admin, 'a'.repeat(32)), pushDeviceDocSchema, {
            ...{ token: 'e2e-fcm-token:revoked-browser-0001', lang: 'ro', createdAt: AT },
            ...stamp,
        });
        await world.documents.set(FIRESTORE_PATHS.notifySettings(admin), notifySettingsDocSchema, {
            ...{ push: true, pushKinds: ['job.failed'] },
            ...stamp,
        });
        // More items than one page of deletes: the inbox goes page by page.
        for (let index = 0; index < 101; index += 1) {
            await world.documents.set(FIRESTORE_PATHS.inboxItem(admin, `job.failed~c~j${String(index)}~0`), inboxItemDocSchema, {
                ...{ kind: 'job.failed', severity: 'error', params: { label: 'Corona' }, link: '#/jobs', createdAt: AT, read: false },
                ...stamp,
            });
        }
        await world.documents.set(FIRESTORE_PATHS.pushDevice(owner, 'b'.repeat(32)), pushDeviceDocSchema, {
            ...{ token: 'e2e-fcm-token:owner-browser-0001', lang: 'en', createdAt: AT },
            ...{ updatedBy: owner, updatedAt: AT },
        });

        await expect(revoke(world, owner, { kind: 'admin', uid: admin })).resolves.toEqual({ revoked: true });

        await expect(world.documents.count(FIRESTORE_PATHS.pushDevices(admin))).resolves.toBe(0);
        await expect(world.documents.count(FIRESTORE_PATHS.inbox(admin))).resolves.toBe(0);
        await expect(world.documents.get(FIRESTORE_PATHS.notifySettings(admin), notifySettingsDocSchema)).resolves.toBeUndefined();
        await expect(world.documents.count(FIRESTORE_PATHS.pushDevices(owner))).resolves.toBe(1);
    });

    it('happyPath_anotherOwnerOfTheCityMayBeRemovedButNeverOneself', async () => {
        const world = emulators.newWorld();
        const owner = await seedAdmin(world, 'owner');
        const coOwner = await seedAdmin(world, 'admin', { [CITY]: 'owner' });

        await expect(revoke(world, owner, { kind: 'admin', uid: coOwner })).resolves.toEqual({ revoked: true });
        const failure = await failureOf(revoke(world, owner, { kind: 'admin', uid: owner }));

        expect(failure).toMatchObject({ code: 'failed-precondition', details: { code: 'apiError.revoke.self' } });
        await expect(world.documents.get(FIRESTORE_PATHS.admin(coOwner), adminDocSchema)).resolves.toBeUndefined();
        await expect(world.documents.get(FIRESTORE_PATHS.admin(owner), adminDocSchema)).resolves.toMatchObject({
            cities: { [CITY]: 'owner' },
        });
    });

    it('happyPath_anAdminWhoseAccountIsGoneIsStillRemoved', async () => {
        const world = emulators.newWorld();
        const owner = await seedAdmin(world, 'owner');
        const admin = await seedAdmin(world);
        await world.sdkAuth.deleteUser(admin);

        await expect(revoke(world, owner, { kind: 'admin', uid: admin })).resolves.toEqual({ revoked: true });
        await expect(world.documents.get(FIRESTORE_PATHS.admin(admin), adminDocSchema)).resolves.toBeUndefined();
    });

    it('badPath_authUnavailableFailsRetryablyAfterTheDocumentIsGone', async () => {
        const world = emulators.newWorld();
        const owner = await seedAdmin(world, 'owner');
        const admin = await seedAdmin(world);
        const down = new UpstreamError('firebase-auth', 'unavailable', { status: 503 });
        const auth = { ...world.auth, setAdminClaim: () => Promise.reject(down) };

        const failure = await failureOf(
            revokeFunction(() => ({ ...world, auth })).run(
                callableRequest(
                    { cityId: CITY, kind: 'admin', uid: admin },
                    { uid: owner, token: googleToken(`${owner}@example.test`, { admin: true }) },
                ),
            ),
        );

        expect(failure).toMatchObject({ code: 'unavailable', details: { code: 'apiError.unavailable' } });
        await expect(world.documents.get(FIRESTORE_PATHS.admin(admin), adminDocSchema)).resolves.toBeUndefined();
    });
});

/** M5 (`docs/research/M5-interfaces.md` §1.7): a removal takes one city; the admin keeps the others. */
describe('admins.revoke: one city of several', () => {
    it('happyPath_anAdminOfTwoCitiesKeepsTheOtherAndTheProjectOwnerKeepsTheDocument @S-A51-HAPPY', async () => {
        const world = emulators.newWorld();
        const owner = await seedAdmin(world, 'owner');
        const twoCities = await seedAdmin(world, 'admin', { [CITY]: 'editor', cluj: 'owner' });
        // A project owner who edits the city (a document from before docs/LESSONS.md 243) keeps their document.
        const projectOwner = await seedAdmin(world, 'owner', { [CITY]: 'editor' });

        await expect(revoke(world, owner, { kind: 'admin', uid: twoCities })).resolves.toEqual({ revoked: true });
        await expect(revoke(world, owner, { kind: 'admin', uid: projectOwner })).resolves.toEqual({ revoked: true });

        await expect(world.documents.get(FIRESTORE_PATHS.admin(twoCities), adminDocSchema)).resolves.toMatchObject({
            cities: { cluj: 'owner' },
            updatedBy: owner,
        });
        await expect(world.documents.get(FIRESTORE_PATHS.admin(projectOwner), adminDocSchema)).resolves.toMatchObject({
            role: 'owner',
            cities: {},
        });
        expect((await world.sdkAuth.getUser(twoCities)).customClaims).toEqual({ admin: true, beta: true });
    });

    it('badPath_theProjectsOwnerIsNeverRemovedFromACityTheyOwn @S-A51-BAD-PROJECT-OWNER-STAYS', async () => {
        const world = emulators.newWorld();
        const projectOwner = await seedAdmin(world, 'owner');
        const coOwner = await seedAdmin(world, 'admin', { [CITY]: 'owner' });

        await expect(failureOf(revoke(world, coOwner, { kind: 'admin', uid: projectOwner }))).resolves.toMatchObject({
            code: 'failed-precondition',
            details: { code: 'apiError.city.projectOwnerStays' },
        });
        await expect(world.documents.get(FIRESTORE_PATHS.admin(projectOwner), adminDocSchema)).resolves.toMatchObject({
            cities: { [CITY]: 'owner' },
        });
    });

    it('badPath_twoOwnersRemovingEachOtherAtOnceLeaveTheCityAnOwner @S-A51-BAD-ROLE-RACE', async () => {
        // docs/LESSONS.md 243: revokeAdmin had no last-owner check, and each removal read the other's document on its own.
        const world = emulators.newWorld();
        const first = await seedAdmin(world, 'admin', { [CITY]: 'owner', cluj: 'owner' });
        const second = await seedAdmin(world, 'admin', { [CITY]: 'owner', cluj: 'owner' });

        const outcomes = await Promise.allSettled([
            revoke(world, first, { kind: 'admin', uid: second }),
            revoke(world, second, { kind: 'admin', uid: first }),
        ]);

        expect(outcomes.map((outcome) => outcome.status).sort((a, b) => a.localeCompare(b))).toEqual(['fulfilled', 'rejected']);
        const left = await Promise.all([first, second].map((uid) => world.documents.get(FIRESTORE_PATHS.admin(uid), adminDocSchema)));
        expect(left.filter((admin) => admin?.cities?.[CITY] === 'owner')).toHaveLength(1);
    });

    it('badPath_anEditorOfTheCityRemovesNobody', async () => {
        const world = emulators.newWorld();
        const owner = await seedAdmin(world, 'owner');
        const editor = await seedAdmin(world);

        await expect(failureOf(revoke(world, editor, { kind: 'admin', uid: owner }))).resolves.toMatchObject({
            code: 'permission-denied',
            details: { code: 'apiError.city.notOwner', params: { cityId: CITY } },
        });
        await expect(world.documents.get(FIRESTORE_PATHS.admin(owner), adminDocSchema)).resolves.toBeDefined();
    });

    it('badPath_anUnknownAdminOrInvitationOrOneOfAnotherCityIsNotFound', async () => {
        const world = emulators.newWorld();
        const admin = await seedAdmin(world, 'owner');
        const elsewhere = await seedAdmin(world, 'admin', { cluj: 'editor' });
        const invite = { role: 'admin', invitedBy: admin, createdAt: AT, expiresAt: AT, updatedBy: admin, updatedAt: AT } as const;
        await world.documents.set(FIRESTORE_PATHS.invite(INVITE_ID), inviteDocSchema, { ...invite, cities: { cluj: 'editor' } });

        const unknownAdmin = await failureOf(revoke(world, admin, { kind: 'admin', uid: 'fn-admin-revoke-nobody' }));
        const otherCitysAdmin = await failureOf(revoke(world, admin, { kind: 'admin', uid: elsewhere }));
        const otherCitysInvite = await failureOf(revoke(world, admin, { kind: 'invite', inviteId: INVITE_ID }));
        const unknownInvite = await failureOf(revoke(world, admin, { kind: 'invite', inviteId: 'e'.repeat(64) }));

        expect([unknownAdmin, otherCitysAdmin, otherCitysInvite, unknownInvite]).toMatchObject([
            { code: 'not-found', details: { code: 'apiError.notFound' } },
            { code: 'not-found', details: { code: 'apiError.notFound' } },
            { code: 'not-found', details: { code: 'apiError.notFound' } },
            { code: 'not-found', details: { code: 'apiError.notFound' } },
        ]);
        await expect(world.documents.get(FIRESTORE_PATHS.invite(INVITE_ID), inviteDocSchema)).resolves.toBeDefined();
    });

    it('happyPath_aPendingInvitationLosesTheCityAndGoesWithItsLast', async () => {
        const world = emulators.newWorld();
        const admin = await seedAdmin(world, 'owner', { [CITY]: 'owner', cluj: 'owner' });
        const invite = { role: 'admin', invitedBy: admin, createdAt: AT, expiresAt: AT, updatedBy: admin, updatedAt: AT } as const;
        await world.documents.set(FIRESTORE_PATHS.invite(INVITE_ID), inviteDocSchema, {
            ...invite,
            cities: { [CITY]: 'editor', cluj: 'owner' },
        });

        await expect(revoke(world, admin, { kind: 'invite', inviteId: INVITE_ID })).resolves.toEqual({ revoked: true });
        await expect(world.documents.get(FIRESTORE_PATHS.invite(INVITE_ID), inviteDocSchema)).resolves.toMatchObject({
            cities: { cluj: 'owner' },
        });
        await expect(revoke(world, admin, { cityId: 'cluj', kind: 'invite', inviteId: INVITE_ID })).resolves.toEqual({ revoked: true });
        await expect(world.documents.get(FIRESTORE_PATHS.invite(INVITE_ID), inviteDocSchema)).resolves.toBeUndefined();
    });
});
