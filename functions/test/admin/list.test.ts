/**
 * `admins.list` (`functions/src/admin/list.ts`, M2-interfaces §3.1, M5-interfaces §1.7) through its callable's `.run()`
 * on the Firestore emulator: the city's admins oldest first with their role in it, the project's owner marked, and the
 * invitations to the city by hash only; nobody of another city.
 */
import { FIRESTORE_PATHS, adminDocSchema, cityAdminsListResponseSchema, inviteDocSchema, timestampFromDate } from '@hcm/shared';
import { afterAll, describe, expect, it } from 'vitest';

import { listFunction } from '../../src/admin/list.js';
import { callableRequest, failureOf, googleToken, openEmulators, type World } from './world.js';

const emulators = openEmulators('fn-admin-list');

afterAll(async () => {
    await emulators.close();
});

const OWNER = 'u-list-owner';
const CITY = 'bucharest';
const EARLY = timestampFromDate(new Date('2026-09-01T08:00:00.000Z'));
const LATE = timestampFromDate(new Date('2026-10-01T08:00:00.000Z'));
const PENDING = 'e'.repeat(64);
const EXPIRED = 'f'.repeat(64);
const ELSEWHERE = 'a'.repeat(64);

function list(world: World, uid = OWNER, cityId = CITY) {
    return listFunction(() => world).run(callableRequest({ cityId }, { uid, token: googleToken('owner@example.test', { admin: true }) }));
}

async function seed(world: World): Promise<void> {
    await world.documents.set(FIRESTORE_PATHS.admin('u-list-admin'), adminDocSchema, {
        role: 'admin',
        cities: { [CITY]: 'editor', cluj: 'owner' },
        invitedBy: OWNER,
        createdAt: LATE,
        updatedBy: 'u-list-admin',
        updatedAt: LATE,
    });
    await world.documents.set(FIRESTORE_PATHS.admin('u-cluj-only'), adminDocSchema, {
        role: 'admin',
        cities: { cluj: 'owner' },
        createdAt: EARLY,
        updatedBy: 'u-cluj-only',
        updatedAt: EARLY,
    });
    await world.documents.set(FIRESTORE_PATHS.admin(OWNER), adminDocSchema, {
        role: 'owner',
        cities: { [CITY]: 'owner' },
        email: 'owner@example.test',
        displayName: 'Owner Test',
        createdAt: EARLY,
        updatedBy: OWNER,
        updatedAt: EARLY,
    });
    const invite = { role: 'admin', invitedBy: OWNER, createdAt: LATE, updatedBy: OWNER, updatedAt: LATE } as const;
    const open = timestampFromDate(new Date('2026-10-15T08:00:00Z'));
    await world.documents.set(FIRESTORE_PATHS.invite(PENDING), inviteDocSchema, {
        ...invite,
        cities: { [CITY]: 'owner' },
        expiresAt: open,
    });
    await world.documents.set(FIRESTORE_PATHS.invite(ELSEWHERE), inviteDocSchema, {
        ...invite,
        cities: { cluj: 'editor' },
        expiresAt: open,
    });
    await world.documents.set(FIRESTORE_PATHS.invite(EXPIRED), inviteDocSchema, {
        ...invite,
        cities: { [CITY]: 'editor' },
        expiresAt: timestampFromDate(new Date('2026-10-11T08:00:00Z')),
    });
}

describe('admins.list', () => {
    it('happyPath_listsTheCitysAdminsOldestFirstAndItsPendingInvitations @S-A51-HAPPY', async () => {
        const world = emulators.newWorld();
        await seed(world);

        const listed = await list(world);

        expect(cityAdminsListResponseSchema.safeParse(listed).success).toBe(true);
        expect(listed).toEqual({
            admins: [
                {
                    uid: OWNER,
                    role: 'owner',
                    projectOwner: true,
                    email: 'owner@example.test',
                    displayName: 'Owner Test',
                    createdAt: '2026-09-01T08:00:00.000Z',
                    self: true,
                },
                { uid: 'u-list-admin', role: 'editor', projectOwner: false, createdAt: '2026-10-01T08:00:00.000Z', self: false },
            ],
            invites: [
                {
                    inviteId: PENDING,
                    role: 'owner',
                    invitedBy: OWNER,
                    createdAt: '2026-10-01T08:00:00.000Z',
                    expiresAt: '2026-10-15T08:00:00.000Z',
                },
            ],
        });
        expect(world.recording.records).toEqual([]);
    });

    it('happyPath_anotherCitysListHasItsOwnAdminsAndRoles', async () => {
        const world = emulators.newWorld();
        await seed(world);

        const listed = await list(world, 'u-list-admin', 'cluj');

        expect(listed.admins.map((admin) => [admin.uid, admin.role])).toEqual([
            ['u-cluj-only', 'owner'],
            ['u-list-admin', 'owner'],
        ]);
        expect(listed.invites.map((invite) => invite.inviteId)).toEqual([ELSEWHERE]);
    });

    it('badPath_aCityTheCallerDoesNotAdministerListsNothing @S-A51-BAD-OTHER-CITY-CALLABLE', async () => {
        const world = emulators.newWorld();
        await seed(world);

        await expect(failureOf(list(world, OWNER, 'cluj'))).resolves.toMatchObject({
            code: 'permission-denied',
            details: { code: 'apiError.city.notMember', params: { cityId: 'cluj' } },
        });
    });

    it('badPath_aDocumentItsSchemaRefusesIsLeftOutAndAnInvalidInvitationLogged', async () => {
        const world = emulators.newWorld();
        await seed(world);
        await world.db.doc(FIRESTORE_PATHS.admin('u-broken')).set({ role: 'superuser', cities: { [CITY]: 'editor' }, createdAt: LATE });
        await world.db.doc(FIRESTORE_PATHS.invite('b'.repeat(64))).set({ role: 'root', createdAt: LATE });

        const listed = await list(world);

        expect(listed.admins.map((admin) => admin.uid)).toEqual([OWNER, 'u-list-admin']);
        expect(world.recording.records).toMatchObject([
            { level: 'warn', message: 'invitations left out of the list', data: { paths: [`invites/${'b'.repeat(64)}`] } },
        ]);
    });
});
