/**
 * The shell's side of Google consent (`docs/research/M2b-interfaces.md` §2): asks the `GoogleAuthPort` with the
 * signed-in address as the login hint, keeps a granted token in the memory-only `GoogleAccessStore`, and turns a failure
 * into its message (§2.5). The controller shows that message on its panel; the Setup Assistant's steps get it through
 * the shell's services, which show it in the snackbar.
 */
import { translateAdminShell, type UiLocale } from '@hcm/shared';

import type { AuthUser } from '../firebase/ports.js';
import type { GoogleScope } from '../google/scopes.js';
import type { NoticeInput, NoticeKey } from '../state/state.js';
import type { GoogleAccessStore } from './google-access.js';
import {
    GoogleAuthError,
    type GoogleAccess,
    type GoogleAuthFailure,
    type GoogleAuthPort,
    type GoogleRequestOptions,
} from './google-auth.js';

export type GoogleOutcome =
    | { readonly granted: true; readonly access: GoogleAccess | null }
    | { readonly granted: false; readonly failure: GoogleAuthFailure; readonly notice: NoticeInput };

export interface GoogleServiceDeps {
    readonly port: GoogleAuthPort;
    readonly store: GoogleAccessStore;
    readonly currentUser: () => AuthUser | null;
    readonly locale: () => UiLocale;
}

const FAILURE_KEYS: Readonly<Record<Exclude<GoogleAuthFailure, 'scopeDenied'>, NoticeKey>> = {
    popupBlocked: 'adminShell.oauth.popupBlocked',
    popupClosed: 'adminShell.oauth.popupClosed',
    wrongAccount: 'adminShell.oauth.wrongAccount',
    network: 'apiError.unavailable',
    failed: 'apiError.internal',
};

/** The message of a failure; a refused scope names the scope as Google's consent page shows it. */
export function failureNotice(failure: GoogleAuthFailure, scope: GoogleScope | null, locale: UiLocale): NoticeInput {
    if (failure !== 'scopeDenied') {
        return { key: FAILURE_KEYS[failure] };
    }
    const label = translateAdminShell(locale, `adminShell.oauth.scope.${scope ?? 'cloudReadOnly'}`);
    return { key: 'adminShell.oauth.scopeDenied', params: { scope: label } };
}

export class GoogleAccessService {
    readonly #deps: GoogleServiceDeps;

    constructor(deps: GoogleServiceDeps) {
        this.#deps = deps;
    }

    /** One consent popup for `scope` (none: the daily sign-in). Must be the first await of a click handler. */
    async request(scope: GoogleScope | null): Promise<GoogleOutcome> {
        let access: GoogleAccess | null;
        try {
            access = await this.#deps.port.request(scope, this.#options());
        } catch (error) {
            return this.#failed(error instanceof GoogleAuthError ? error.failure : 'failed', scope);
        }
        this.#keep(access);
        return { granted: true, access };
    }

    /** The signed-in user's token for `scope` with more than `minRemainingMs` left, or null. */
    live(scope: GoogleScope, minRemainingMs = 0): GoogleAccess | null {
        const uid = this.#deps.currentUser()?.uid;
        return uid === undefined ? null : this.#deps.store.live(uid, scope, minRemainingMs);
    }

    /** The signed-in address as the login hint (none before the first sign-in). */
    #options(): GoogleRequestOptions {
        const email = this.#deps.currentUser()?.email ?? null;
        return email === null ? {} : { loginHint: email };
    }

    /** Another account's token is useless: it is dropped with the refusal. */
    #failed(failure: GoogleAuthFailure, scope: GoogleScope | null): GoogleOutcome {
        if (failure === 'wrongAccount') {
            this.#deps.store.drop();
        }
        return { granted: false, failure, notice: failureNotice(failure, scope, this.#deps.locale()) };
    }

    /** Forgets every token (sign-out, a user change, a Google 401). */
    drop(): void {
        this.#deps.store.drop();
    }

    #keep(access: GoogleAccess | null): void {
        const uid = this.#deps.currentUser()?.uid;
        if (access !== null && uid !== undefined) {
            this.#deps.store.keep(uid, access);
        }
    }
}
