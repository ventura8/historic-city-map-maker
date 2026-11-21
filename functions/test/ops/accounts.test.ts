/**
 * The `invites` and `users` steps: expired invitations go, and so do accounts that never became admins once 24 hours
 * have passed; never an admin, the owner, or an account whose invitation is still open.
 */
import { FIRESTORE_PATHS, adminDocSchema, inviteDocSchema, inviteIdFor, ownerDocSchema, timestampFromDate } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { expireInvites, removeStaleUsers } from '../../src/ops/accounts.js';
import { account, hoursBefore, opsDeps, type OpsTestDeps } from './fakes.js';

const NOW = '2026-10-12T09:00:00.000Z';
const OLD = '2026-10-10T09:00:00.000Z';
const stamp = { updatedBy: 'system:admins', updatedAt: hoursBefore(NOW, 48) };

async function invite(deps: OpsTestDeps, email: string, expiresInHours: number): Promise<string> {
    const id = await inviteIdFor(email);
    await deps.documents.set(FIRESTORE_PATHS.invite(id), inviteDocSchema, {
        role: 'admin',
        invitedBy: 'u-admin',
        createdAt: hoursBefore(NOW, 24),
        expiresAt: timestampFromDate(new Date(Date.parse(NOW) + expiresInHours * 3_600_000)),
        ...stamp,
    });
    return id;
}

describe('expireInvites', () => {
    it('happyPath_onlyExpiredInvitationsAreDeleted @S-A02-BAD-EXPIRED-INVITE', async () => {
        const deps = opsDeps(NOW);
        const expired = await invite(deps, 'late@example.test', -1);
        const open = await invite(deps, 'soon@example.test', 48);

        await expect(expireInvites(deps, new Date(NOW))).resolves.toBe(1);

        expect(deps.documents.paths('invites/')).toEqual([FIRESTORE_PATHS.invite(open)]);
        expect(deps.documents.paths('invites/')).not.toContain(FIRESTORE_PATHS.invite(expired));
    });

    it('badPath_noInvitationsNothingDeleted', async () => {
        await expect(expireInvites(opsDeps(NOW), new Date(NOW))).resolves.toBe(0);
    });
});

describe('removeStaleUsers', () => {
    it('happyPath_onlyAccountsThatNeverBecameAdminsAfter24Hours @S-A20-BAD-STALE-ACCOUNT', async () => {
        const deps = opsDeps(NOW, {
            users: [
                account('u-admin', OLD, 'admin@example.test'),
                account('u-owner', OLD),
                account('u-broken', OLD),
                account('u-invited', OLD, 'Invited@Example.test'),
                account('u-fresh', '2026-10-12T08:00:00.000Z'),
                account('u-stranger', OLD, 'stranger@example.test'),
                account('u-anonymous', OLD),
            ],
        });
        await deps.documents.set(FIRESTORE_PATHS.admin('u-admin'), adminDocSchema, {
            role: 'admin',
            createdAt: hoursBefore(NOW, 72),
            ...stamp,
        });
        deps.documents.seed(FIRESTORE_PATHS.admin('u-broken'), { role: 'emperor' });
        await deps.documents.set(FIRESTORE_PATHS.setupOwner, ownerDocSchema, { uid: 'u-owner', claimedAt: hoursBefore(NOW, 72), ...stamp });
        await invite(deps, 'invited@example.test', 24);

        await expect(removeStaleUsers(deps, new Date(NOW))).resolves.toBe(2);

        expect(deps.auth.deleted).toEqual(['u-stranger', 'u-anonymous']);
        expect(deps.auth.recorder.argsOf('listUsers')).toEqual([[undefined], ['2'], ['4'], ['6']]);
        expect(deps.recording.records.filter((record) => record.message === 'stale account deleted').map((record) => record.data)).toEqual([
            { uid: 'u-stranger' },
            { uid: 'u-anonymous' },
        ]);
    });

    it('badPath_withoutAnOwnerOrAdminsEveryOldAccountGoes', async () => {
        const deps = opsDeps(NOW, { users: [account('u-1', OLD), account('u-2', OLD, 'two@example.test')] });

        await expect(removeStaleUsers(deps, new Date(NOW))).resolves.toBe(2);
    });

    it('badPath_aFailedDeletionStopsTheStep', async () => {
        const deps = opsDeps(NOW, { users: [account('u-1', OLD)] });
        deps.auth.recorder.failNext('deleteUser', new Error('auth unavailable'));

        await expect(removeStaleUsers(deps, new Date(NOW))).rejects.toThrow('auth unavailable');
    });
});
