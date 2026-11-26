/**
 * Asking Google for a scope (`docs/research/M2b-interfaces.md` §2.2): the `GoogleAuthPort` and its implementation over a
 * popup sign-in. Production signs in with Firebase Auth's Google popup (`../firebase/google-popup.ts`); the e2e build
 * swaps only the popup for the OAuth stand-in page of the mock APIs (`stand-in.ts`). Either way the token is checked here
 * with Google's tokeninfo: every scope the step needs must be granted (granular consent lets the owner untick one) and
 * the token must belong to the signed-in account. The token lives in memory only (`google-access.ts`).
 */
import type { Logger } from '@hcm/shared';

import { GOOGLE_SCOPES, unsatisfiedScopes, type GoogleScope } from '../google/scopes.js';

export interface GoogleAccess {
    /** `ya29.…`, memory only. */
    readonly token: string;
    /** The granted scope URLs (tokeninfo). */
    readonly scopes: readonly string[];
    /** Epoch milliseconds. */
    readonly expiresAt: number;
}

export interface GoogleRequestOptions {
    /** The signed-in address, so a re-authentication skips the account chooser. */
    readonly loginHint?: string;
}

export interface GoogleAuthPort {
    /**
     * Opens Google's popup: must be the first await of a click handler (popup blockers). Resolves the access token of
     * `scope` (null when no scope was asked: the daily sign-in) or rejects with a `GoogleAuthError`.
     */
    request(scope: GoogleScope | null, options: GoogleRequestOptions): Promise<GoogleAccess | null>;
}

/** Why a consent did not produce a usable token (§2.5); each has its `adminShell.oauth.*` message. */
export type GoogleAuthFailure = 'popupBlocked' | 'popupClosed' | 'scopeDenied' | 'wrongAccount' | 'network' | 'failed';

/** Each failure's code, Firebase Auth's own where one exists (callers that switch on `code` read the same values). */
const FAILURE_CODES: Readonly<Record<GoogleAuthFailure, string>> = {
    popupBlocked: 'auth/popup-blocked',
    popupClosed: 'auth/popup-closed-by-user',
    scopeDenied: 'hcm/scope-denied',
    wrongAccount: 'hcm/wrong-account',
    network: 'auth/network-request-failed',
    failed: 'hcm/consent-failed',
};

export class GoogleAuthError extends Error {
    readonly failure: GoogleAuthFailure;
    readonly code: string;

    constructor(failure: GoogleAuthFailure) {
        super(`google consent failed: ${failure}`);
        this.name = 'GoogleAuthError';
        this.failure = failure;
        this.code = FAILURE_CODES[failure];
    }
}

/** What a popup sign-in returns: the OAuth access token (absent without a scope) and the account's address. */
export interface PopupResult {
    readonly accessToken: string | null;
    readonly email: string | null;
}

/**
 * One Google sign-in (or re-authentication when someone is signed in) with `scopeUrl` added and Google's custom
 * parameters (`include_granted_scopes`, `login_hint`). Rejects with the Firebase error (its `code`).
 */
export type PopupSignIn = (scopeUrl: string | null, parameters: Readonly<Record<string, string>>) => Promise<PopupResult>;

/** Firebase Auth's error codes → the failure shown (anything else is `failed`). */
const FIREBASE_FAILURES: Readonly<Record<string, GoogleAuthFailure>> = {
    'auth/popup-blocked': 'popupBlocked',
    'auth/popup-closed-by-user': 'popupClosed',
    'auth/cancelled-popup-request': 'popupClosed',
    'auth/user-cancelled': 'popupClosed',
    'auth/user-mismatch': 'wrongAccount',
    'auth/network-request-failed': 'network',
};

export const TOKENINFO_URL = 'https://oauth2.googleapis.com/tokeninfo';

/** A token's lifetime when tokeninfo cannot say (Google issues them for an hour). */
const DEFAULT_LIFETIME_S = 3540;

interface TokenInfo {
    readonly scopes: readonly string[];
    readonly email: string | null;
    readonly expiresInSeconds: number;
}

export interface GoogleAuthDeps {
    readonly fetch: (url: string, init?: RequestInit) => Promise<Response>;
    /** The clock token lifetimes are measured on. */
    readonly clock: { now(): number };
    readonly log: Logger;
}

function failureOf(error: unknown): GoogleAuthFailure {
    if (error instanceof GoogleAuthError) {
        return error.failure;
    }
    // Firebase's errors carry a `code`; anything else (no object, no code) is a failure without one.
    const code: unknown = Reflect.get(Object(error) as object, 'code');
    return typeof code === 'string' ? (FIREBASE_FAILURES[code] ?? 'failed') : 'failed';
}

function stringField(body: Readonly<Record<string, unknown>>, name: string): string | null {
    const value = body[name];
    return typeof value === 'string' ? value : null;
}

/** tokeninfo's answer read (`expires_in` is a string of seconds; anything unreadable counts as an hour). */
function readTokenInfo(body: Readonly<Record<string, unknown>>): TokenInfo {
    const seconds = Number(body['expires_in']);
    return {
        scopes: (stringField(body, 'scope') ?? '').split(' ').filter((scope) => scope !== ''),
        email: stringField(body, 'email'),
        expiresInSeconds: Number.isFinite(seconds) && seconds > 0 ? seconds : DEFAULT_LIFETIME_S,
    };
}

/**
 * Asks tokeninfo about `token` (POST with the token as a bearer, as `admin.claim`'s adapter does). **UNVERIFIED** that
 * tokeninfo answers a browser with CORS headers: when the request itself fails, the token is used as granted (a Google
 * 403 `ACCESS_TOKEN_SCOPE_INSUFFICIENT` later maps to the same `scopeDenied`).
 */
async function tokenInfo(deps: GoogleAuthDeps, token: string, assumed: readonly string[]): Promise<TokenInfo> {
    let response: Response;
    try {
        response = await deps.fetch(TOKENINFO_URL, { method: 'POST', headers: { authorization: `Bearer ${token}` }, credentials: 'omit' });
    } catch (error) {
        deps.log.warn('tokeninfo unreachable: the token is used as granted', { error: String(error) });
        return { scopes: assumed, email: null, expiresInSeconds: DEFAULT_LIFETIME_S };
    }
    if (!response.ok) {
        throw new GoogleAuthError('failed');
    }
    return readTokenInfo((await response.json()) as Readonly<Record<string, unknown>>);
}

function sameAddress(left: string | null, right: string | null): boolean {
    return left === null || right === null || left.toLowerCase() === right.toLowerCase();
}

/** The access the popup granted for `scope`, checked with tokeninfo. */
async function checkedAccess(deps: GoogleAuthDeps, scope: GoogleScope, result: PopupResult): Promise<GoogleAccess> {
    if (result.accessToken === null) {
        throw new GoogleAuthError('failed');
    }
    const info = await tokenInfo(deps, result.accessToken, [GOOGLE_SCOPES[scope]]);
    if (unsatisfiedScopes(info.scopes, [scope]).length > 0) {
        throw new GoogleAuthError('scopeDenied');
    }
    if (!sameAddress(info.email, result.email)) {
        throw new GoogleAuthError('wrongAccount');
    }
    return { token: result.accessToken, scopes: info.scopes, expiresAt: deps.clock.now() + info.expiresInSeconds * 1000 };
}

/** Google's custom parameters: incremental authorization, and the account to preselect. */
export function googleParameters(options: GoogleRequestOptions): Readonly<Record<string, string>> {
    const hint = options.loginHint ?? '';
    return { include_granted_scopes: 'true', ...(hint === '' ? {} : { login_hint: hint }) };
}

/** The `GoogleAuthPort` over a popup sign-in (Firebase's in production, the stand-in in e2e). */
export function createGoogleAuth(signIn: PopupSignIn, deps: GoogleAuthDeps): GoogleAuthPort {
    return {
        request: async (scope, options) => {
            try {
                const result = await signIn(scope === null ? null : GOOGLE_SCOPES[scope], googleParameters(options));
                return scope === null ? null : await checkedAccess(deps, scope, result);
            } catch (error) {
                const failure = failureOf(error);
                deps.log.info('google consent failed', { scope, failure });
                throw error instanceof GoogleAuthError ? error : new GoogleAuthError(failure);
            }
        },
    };
}
