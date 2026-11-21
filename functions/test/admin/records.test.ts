/** Helpers of the admin handlers (`functions/src/admin/records.ts`): the display name and the admin document. */
import { adminDocSchema, timestampFromDate } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { adminRecord, displayNameOf } from '../../src/admin/records.js';
import type { AuthAdmin, AuthUser } from '../../src/ports/auth-admin.js';

const NOW = new Date('2026-10-12T08:30:00.000Z');

/** An Auth port that knows one account (or none) and nothing else. */
function authWith(user: Partial<AuthUser> | undefined): AuthAdmin {
    const account: AuthUser | undefined =
        user === undefined
            ? undefined
            : { uid: 'u1', emailVerified: true, providers: ['google.com'], createdAt: NOW, customClaims: {}, ...user };
    const never = () => Promise.reject(new Error('not used'));
    return {
        getUser: () => Promise.resolve(account),
        setAdminClaim: never,
        revokeSessions: never,
        createCustomToken: never,
        deleteUser: never,
        listUsers: never,
    };
}

describe('displayNameOf', () => {
    it.each([
        ['a Google name, trimmed', { displayName: '  Ana Test ' }, 'Ana Test'],
        ['a name over 200 characters, cut', { displayName: `${'a'.repeat(199)}  b` }, 'a'.repeat(199)],
        ['a blank name', { displayName: '   ' }, undefined],
        ['an account without a name', {}, undefined],
        ['a missing account', undefined, undefined],
    ])('happyPath_%s', async (_case, user, expected) => {
        await expect(displayNameOf(authWith(user), 'u1')).resolves.toBe(expected);
    });
});

describe('adminRecord', () => {
    it('happyPath_aNewAdminWithoutANameStoresTheNormalizedAddress', () => {
        const record = adminRecord({
            uid: 'u1',
            email: 'Ana@Example.TEST',
            role: 'admin',
            displayName: undefined,
            createdAt: undefined,
            now: NOW,
        });

        expect(record).toEqual({
            role: 'admin',
            email: 'ana@example.test',
            createdAt: timestampFromDate(NOW),
            updatedBy: 'u1',
            updatedAt: timestampFromDate(NOW),
        });
        expect(adminDocSchema.safeParse(record).success).toBe(true);
    });
});
