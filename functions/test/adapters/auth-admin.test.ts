/**
 * The `AuthAdmin` adapter (`functions/src/adapters/auth-admin.ts`) on the Auth emulator through the real Admin SDK:
 * accounts, the `admin` claim beside other claims, refresh-token revocation, deletion and paging. Every uid is
 * prefixed with this file's name (the Auth emulator is shared by every test file).
 */
import { getAuth } from 'firebase-admin/auth';
import { afterAll, describe, expect, it } from 'vitest';

import { createAuthAdmin } from '../../src/adapters/auth-admin.js';
import { openEmulators } from '../admin/world.js';

const emulators = openEmulators('fn-adapter-auth');
const sdk = getAuth(emulators.app);
const auth = createAuthAdmin(sdk);

afterAll(async () => {
    await emulators.close();
});

let accounts = 0;

/** A fresh account of this file; `email` and `displayName` are generated test values. */
async function account(customClaims?: Record<string, unknown>): Promise<string> {
    accounts += 1;
    const uid = `fn-adapter-auth-${String(accounts)}`;
    await sdk.createUser({ uid, email: `${uid}@example.test`, emailVerified: true, displayName: 'Ana Test' });
    if (customClaims !== undefined) {
        await sdk.setCustomUserClaims(uid, customClaims);
    }
    return uid;
}

describe('getUser', () => {
    it('happyPath_mapsTheAccount', async () => {
        const uid = 'fn-adapter-auth-imported';
        await sdk.importUsers([
            {
                uid,
                email: 'imported@example.test',
                emailVerified: true,
                displayName: 'Ion Test',
                providerData: [{ uid: 'google-imported', providerId: 'google.com', email: 'imported@example.test' }],
                customClaims: { admin: true },
                metadata: { creationTime: '2026-10-01T08:00:00.000Z', lastSignInTime: '2026-10-11T08:00:00.000Z' },
            },
        ]);

        await expect(auth.getUser(uid)).resolves.toEqual({
            uid,
            email: 'imported@example.test',
            emailVerified: true,
            displayName: 'Ion Test',
            providers: ['google.com'],
            createdAt: new Date('2026-10-01T08:00:00.000Z'),
            lastSignInAt: new Date('2026-10-11T08:00:00.000Z'),
            customClaims: { admin: true },
        });
    });

    it('happyPath_anAccountThatNeverSignedInHasNoLastSignIn', async () => {
        const uid = 'fn-adapter-auth-bare';
        await sdk.importUsers([{ uid }]);

        const user = await auth.getUser(uid);

        expect(user).toMatchObject({ uid, emailVerified: false, providers: [], customClaims: {} });
        expect(user).not.toHaveProperty('email');
        expect(user).not.toHaveProperty('displayName');
        expect(user).not.toHaveProperty('lastSignInAt');
    });

    it('badPath_aMissingAccountIsUndefinedAndAnInvalidUidFails', async () => {
        await expect(auth.getUser('fn-adapter-auth-missing')).resolves.toBeUndefined();
        await expect(auth.getUser('')).rejects.toMatchObject({ code: 'auth/invalid-uid' });
    });
});

describe('setAdminClaim', () => {
    it('happyPath_setsAndRemovesTheClaimKeepingOtherClaims', async () => {
        const uid = await account({ beta: true });

        await auth.setAdminClaim(uid, true);
        expect((await sdk.getUser(uid)).customClaims).toEqual({ beta: true, admin: true });

        await auth.setAdminClaim(uid, false);
        expect((await sdk.getUser(uid)).customClaims).toEqual({ beta: true });
    });

    it('happyPath_removingTheOnlyClaimClearsTheClaims', async () => {
        const uid = await account();

        await auth.setAdminClaim(uid, true);
        await auth.setAdminClaim(uid, false);

        expect((await sdk.getUser(uid)).customClaims ?? {}).toEqual({});
    });

    it('badPath_aMissingAccountIsNotFound', async () => {
        await expect(auth.setAdminClaim('fn-adapter-auth-missing', true)).rejects.toMatchObject({
            name: 'UpstreamError',
            service: 'firebase-auth',
            failure: 'notFound',
        });
        await expect(auth.setAdminClaim('', true)).rejects.toMatchObject({ code: 'auth/invalid-uid' });
    });
});

describe('revokeSessions and deleteUser', () => {
    it('happyPath_revokesRefreshTokensThenDeletesTheAccount', async () => {
        const uid = await account();

        await auth.revokeSessions(uid);
        expect((await sdk.getUser(uid)).tokensValidAfterTime).toBeDefined();

        await auth.deleteUser(uid);
        await expect(auth.getUser(uid)).resolves.toBeUndefined();
        await expect(auth.deleteUser(uid)).resolves.toBeUndefined();
    });

    it('badPath_aMissingAccountCannotBeRevokedAndAnInvalidUidCannotBeDeleted', async () => {
        await expect(auth.revokeSessions('fn-adapter-auth-missing')).rejects.toMatchObject({ failure: 'notFound' });
        await expect(auth.deleteUser('')).rejects.toMatchObject({ code: 'auth/invalid-uid' });
    });
});

describe('createCustomToken', () => {
    it('happyPath_mintsATokenForTheAccountWithItsClaims', async () => {
        const uid = await account();

        const token = await auth.createCustomToken(uid, { worker: true, city: 'bucharest' });

        // The emulator's custom tokens are unsigned JWTs: the payload names the account and carries the claims.
        const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as Record<string, unknown>;
        expect(payload).toMatchObject({ uid, claims: { worker: true, city: 'bucharest' } });
    });
});

describe('listUsers', () => {
    it('happyPath_pagesThroughTheAccounts', async () => {
        await account();
        await account();
        const paged = createAuthAdmin(sdk, 1);

        const first = await paged.listUsers();
        const second = await paged.listUsers(first.nextPageToken);

        expect(first.users).toHaveLength(1);
        expect(first.nextPageToken).toBeDefined();
        expect(second.users).toHaveLength(1);
        expect(second.users[0]?.uid).not.toBe(first.users[0]?.uid);
    });

    it('happyPath_theLastPageHasNoNextToken', async () => {
        const all = await auth.listUsers();

        expect(all.users.length).toBeGreaterThan(0);
        expect(all).not.toHaveProperty('nextPageToken');
    });
});
