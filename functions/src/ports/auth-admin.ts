/** A Firebase Auth account, as far as the admin functions need it. */
export interface AuthUser {
    readonly uid: string;
    readonly email?: string;
    readonly emailVerified: boolean;
    readonly displayName?: string;
    /** Sign-in providers (`google.com`, ...). */
    readonly providers: readonly string[];
    readonly createdAt: Date;
    readonly lastSignInAt?: Date;
    readonly customClaims: Readonly<Record<string, unknown>>;
}

/**
 * Firebase Auth through the Admin SDK (`roles/firebaseauth.admin` on `fn-admin@`; adapter
 * `functions/src/adapters/auth-admin.ts`, owned by fn-admin). Used by `admin.*`, `admins.*` and the stale-user
 * cleanup of `ops.tick`.
 */
export interface AuthAdmin {
    /** Undefined when the account does not exist (any more). */
    getUser(uid: string): Promise<AuthUser | undefined>;
    /** Sets (`true`) or removes (`false`) the `admin` custom claim, keeping every other claim. */
    setAdminClaim(uid: string, admin: boolean): Promise<void>;
    /** Revokes the refresh tokens: the next ID token refresh fails, so a removed admin is signed out within the hour. */
    revokeSessions(uid: string): Promise<void>;
    /** Deleting a missing account is not an error. */
    deleteUser(uid: string): Promise<void>;
    /**
     * Finding 67 (`worker.pair`): a Firebase custom token for `uid` carrying `claims`, signed by the runtime account's own
     * `signBlob` (`roles/iam.serviceAccountTokenCreator` on itself, Provision's `iam` item since M5); an hour to sign in with.
     */
    createCustomToken(uid: string, claims: Readonly<Record<string, unknown>>): Promise<string>;
    /** At most 1000 accounts per page. */
    listUsers(pageToken?: string): Promise<{ readonly users: readonly AuthUser[]; readonly nextPageToken?: string }>;
}
