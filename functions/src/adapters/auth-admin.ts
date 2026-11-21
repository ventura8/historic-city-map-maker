import type { Auth, UserRecord } from 'firebase-admin/auth';

import type { AuthAdmin, AuthUser } from '../ports/auth-admin.js';
import { UpstreamError } from '../ports/errors.js';

/** What the Admin SDK's `FirebaseAuthError` says about a uid with no account. */
const USER_NOT_FOUND = 'auth/user-not-found';

/** `listUsers` pages: the Admin SDK's maximum (tests page by one). */
const PAGE_SIZE = 1000;

type Claims = Readonly<Record<string, unknown>>;

function isUserNotFound(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === USER_NOT_FOUND;
}

/** A missing account is `UpstreamError` `notFound` (the handler decides whether that matters). */
function rethrowNotFound(error: unknown): never {
    if (isUserNotFound(error)) {
        throw new UpstreamError('firebase-auth', 'notFound', { status: 404 });
    }
    throw error;
}

function ignoreNotFound(error: unknown): undefined {
    if (isUserNotFound(error)) {
        return undefined;
    }
    throw error;
}

function optionalFields(record: UserRecord): Pick<AuthUser, 'email' | 'displayName' | 'lastSignInAt'> {
    // The SDK types `lastSignInTime` as a string, but an account that never signed in has none.
    const lastSignIn: string | undefined = record.metadata.lastSignInTime || undefined;
    return {
        ...(record.email === undefined ? {} : { email: record.email }),
        ...(record.displayName === undefined ? {} : { displayName: record.displayName }),
        ...(lastSignIn === undefined ? {} : { lastSignInAt: new Date(lastSignIn) }),
    };
}

function toAuthUser(record: UserRecord): AuthUser {
    return {
        uid: record.uid,
        emailVerified: record.emailVerified,
        providers: record.providerData.map((provider) => provider.providerId),
        createdAt: new Date(record.metadata.creationTime),
        customClaims: record.customClaims ?? {},
        ...optionalFields(record),
    };
}

/** The account's claims with `admin: true` set or removed, every other claim kept; `null` clears an empty set. */
function withAdminClaim(claims: Claims, admin: boolean): Claims | null {
    const others = Object.fromEntries(Object.entries(claims).filter(([key]) => key !== 'admin'));
    const next = admin ? { ...others, admin: true } : others;
    return Object.keys(next).length === 0 ? null : next;
}

/**
 * The `AuthAdmin` port on the Firebase Admin SDK (`roles/firebaseauth.admin` on `fn-admin@`): custom claims, refresh
 * token revocation, account deletion and listing. A missing account is `undefined` for `getUser`, nothing for
 * `deleteUser`, and `UpstreamError` `notFound` for the claim and the revocation.
 */
export function createAuthAdmin(auth: Auth, pageSize = PAGE_SIZE): AuthAdmin {
    return {
        getUser: async (uid) => {
            const record = await auth.getUser(uid).catch(ignoreNotFound);
            return record === undefined ? undefined : toAuthUser(record);
        },
        setAdminClaim: async (uid, admin) => {
            const record = await auth.getUser(uid).catch(rethrowNotFound);
            await auth.setCustomUserClaims(uid, withAdminClaim(record.customClaims ?? {}, admin));
        },
        revokeSessions: (uid) => auth.revokeRefreshTokens(uid).catch(rethrowNotFound),
        createCustomToken: (uid, claims) => auth.createCustomToken(uid, { ...claims }),
        deleteUser: async (uid) => {
            await auth.deleteUser(uid).catch(ignoreNotFound);
        },
        listUsers: async (pageToken) => {
            const page = await auth.listUsers(pageSize, pageToken);
            return { users: page.users.map(toAuthUser), ...(page.pageToken === undefined ? {} : { nextPageToken: page.pageToken }) };
        },
    };
}
