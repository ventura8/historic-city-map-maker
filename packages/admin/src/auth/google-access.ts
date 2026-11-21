/**
 * The Google access tokens of the session (`docs/research/M2b-interfaces.md` §2.3): those of one Firebase user, in
 * memory only. Never in Firestore, web storage, IndexedDB, a cookie, a URL, a log line or an error report. They are
 * dropped on sign-out, on a user change and on any Google 401.
 *
 * One token per scope (`DECISIONS-for-review.md` §73j, the user's decision of 2026-11-01): a popup's token carries the
 * scopes Google granted to that popup, which need not include an earlier consent's (§73h: the Analytics consent's token
 * replaced Google Cloud's, so Publish the map asked Google once more within the hour). A new token now replaces only the
 * tokens it supersedes (it may be used for every scope they may); the others stay until they expire or are dropped, and
 * `live` answers with the usable token that has the most time left.
 */
import { GOOGLE_SCOPES, unsatisfiedScopes, type GoogleScope } from '../google/scopes.js';
import type { GoogleAccess } from './google-auth.js';

/** A step starts a batch of Google calls only with at least this much of its token left (§1.5). */
export const MIN_TOKEN_REMAINING_MS = 5 * 60 * 1000;

const SCOPES = Object.keys(GOOGLE_SCOPES) as readonly GoogleScope[];

/** The admin's scopes a token may be used for. */
function grantsOf(access: GoogleAccess): readonly GoogleScope[] {
    return SCOPES.filter((scope) => unsatisfiedScopes(access.scopes, [scope]).length === 0);
}

/** Whether `newer` may be used for every scope `older` may, so `older` adds nothing. */
function supersedes(newer: GoogleAccess, older: GoogleAccess): boolean {
    return unsatisfiedScopes(newer.scopes, grantsOf(older)).length === 0;
}

export class GoogleAccessStore {
    readonly #now: () => number;
    #uid: string | null = null;
    #tokens: readonly GoogleAccess[] = [];

    constructor(now: () => number) {
        this.#now = now;
    }

    /** Keeps `access` for the user `uid` beside the user's other tokens (another user's are forgotten). */
    keep(uid: string, access: GoogleAccess): void {
        const kept = this.#uid === uid ? this.#tokens.filter((token) => !supersedes(access, token)) : [];
        this.#uid = uid;
        this.#tokens = [...kept, access];
    }

    /** The user's token that grants `scope` with the most time left, when that is more than `minRemainingMs`; else null. */
    live(uid: string, scope: GoogleScope, minRemainingMs: number): GoogleAccess | null {
        const now = this.#now();
        const usable = this.#of(uid).filter(
            (access) => access.expiresAt - now > minRemainingMs && unsatisfiedScopes(access.scopes, [scope]).length === 0,
        );
        return usable.reduce<GoogleAccess | null>(
            (best, access) => (best === null || access.expiresAt > best.expiresAt ? access : best),
            null,
        );
    }

    #of(uid: string): readonly GoogleAccess[] {
        return this.#uid === uid ? this.#tokens : [];
    }

    drop(): void {
        this.#uid = null;
        this.#tokens = [];
    }
}
