import type { BrowserContext } from '@playwright/test';

import { ADMIN_PATH, ADMIN_WEB_CONFIG, FIREBASE_APP_NAME } from '../world.js';
import type { SignedInAccount } from './emulators.js';

/**
 * A signed-in admin as the browser holds it (docs/research/M2b-interfaces.md §6.2): since M6 the admin's Firebase Auth
 * keeps its current user in the tab's `sessionStorage` (`browserSessionPersistence`, key
 * `firebase:authUser:<apiKey>:<app>`, the JSON of `UserImpl.toJSON()` in `@firebase/auth` 1.13), never in the origin's
 * IndexedDB, which the public map's pages share (finding 1 of the M6 security review). Playwright's storage state
 * carries no `sessionStorage`, so a context signs in through an init script: the first document of each tab under the
 * admin's folder (or the harness page) gets the account, with tokens the Auth emulator issued for this test, once (a
 * sign-out stays signed out after a reload). A page of the public map, on the same origin, gets nothing.
 */

/** The key Firebase Auth stores the current user under, for the admin's web configuration. */
export const FIREBASE_USER_KEY = `firebase:authUser:${ADMIN_WEB_CONFIG.apiKey}:${FIREBASE_APP_NAME}`;

/** The paths whose tabs start signed in: the admin's folder and the harness page (`support/harness.ts`). */
const SIGNED_IN_PATHS: readonly string[] = [ADMIN_PATH, '/__harness'];

/** The tab's note that it was signed in once (a later sign-out then stays). */
const SEEDED_KEY = 'hcm:e2e:signedIn';

/** What `UserImpl._fromJSON` reads back. */
function persistedUser(account: SignedInAccount, now: number): Record<string, unknown> {
    return {
        uid: account.uid,
        email: account.email,
        emailVerified: true,
        displayName: account.displayName,
        isAnonymous: false,
        providerData: [
            {
                providerId: 'google.com',
                uid: account.sub,
                displayName: account.displayName,
                email: account.email,
                phoneNumber: null,
                photoURL: null,
            },
        ],
        stsTokenManager: {
            refreshToken: account.refreshToken,
            accessToken: account.idToken,
            expirationTime: now + account.expiresIn * 1000,
        },
        apiKey: ADMIN_WEB_CONFIG.apiKey,
        appName: FIREBASE_APP_NAME,
    };
}

interface Seed {
    readonly paths: readonly string[];
    readonly key: string;
    readonly value: string;
    readonly marker: string;
}

/** Runs in each document before its scripts (only browser globals): the tab's first admin document signs in. */
function seedSession(seed: Seed): void {
    const here = location.pathname;
    if (!seed.paths.some((path) => here.startsWith(path)) || sessionStorage.getItem(seed.marker) !== null) {
        return;
    }
    sessionStorage.setItem(seed.marker, '1');
    sessionStorage.setItem(seed.key, seed.value);
}

/** Every tab of `context` opens the admin signed in as `account` (the token's expiry is the browser's wall-clock time). */
export async function signInContext(context: BrowserContext, account: SignedInAccount, now: number): Promise<void> {
    const seed: Seed = {
        paths: SIGNED_IN_PATHS,
        key: FIREBASE_USER_KEY,
        value: JSON.stringify(persistedUser(account, now)),
        marker: SEEDED_KEY,
    };
    await context.addInitScript(seedSession, seed);
}
