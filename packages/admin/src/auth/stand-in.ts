/**
 * The e2e stand-in for Google's consent popup (`docs/research/M2b-interfaces.md` §2.6). Google's OAuth is an outside
 * boundary, so the `e2e` build swaps only the popup: it opens the mock APIs' page `/__oauth/authorize`, which lists the
 * requested scopes as ticked checkboxes with Allow and Cancel. Allow posts `{idToken, accessToken, scope, expiresIn}`
 * to this window (origin-checked); `idToken` is the unsigned JSON the Auth emulator accepts for Google, and the admin
 * signs in with that credential. Everything after the popup (tokeninfo, the scope and account checks) runs exactly as in
 * production (`google-auth.ts`). Never part of the production bundle: the entry reaches it only through `E2E_KIT`, which
 * the bundler folds to null outside `vite build --mode e2e`.
 */
import { z } from 'zod';

import type { Clock, Unsubscribe } from '../app/ports.js';
import { STAND_IN_ORIGIN } from './stand-in-origin.js';
import type { PopupResult, PopupSignIn } from './google-auth.js';

export { STAND_IN_ORIGIN };

/** How often the stand-in checks whether its popup was closed without an answer. */
export const POPUP_POLL_MS = 500;

const grantSchema = z.object({
    idToken: z.string().min(2).max(4096),
    accessToken: z.string().min(1).max(4096),
    scope: z.string().max(4096),
    expiresIn: z.number().int().positive(),
});

const cancelSchema = z.object({ cancelled: z.literal(true) });

/** A message event as the stand-in reads it. */
export interface StandInMessage {
    readonly origin: string;
    readonly source: unknown;
    readonly data: unknown;
}

interface StandInPopup {
    readonly closed: boolean;
}

export interface StandInDeps {
    /** `window.open(url, 'hcm-oauth', 'popup')`; null when the browser blocked it. */
    readonly open: (url: string) => StandInPopup | null;
    /** Subscribes to the window's `message` events. */
    readonly onMessage: (listener: (message: StandInMessage) => void) => Unsubscribe;
    readonly clock: Clock;
    /** The e2e test's partition (`?test=` of the admin's address), so the stand-in registers its grant there. */
    readonly testId: string;
    /** `signInWithCredential` (or `reauthenticateWithCredential`) with Google's credential of the two tokens. */
    readonly signInWithCredential: (idToken: string, accessToken: string) => Promise<{ readonly email: string | null }>;
    readonly origin?: string;
}

/** A Firebase-shaped error, so `google-auth.ts` maps it like the real popup's. */
function authError(code: string): Error & { readonly code: string } {
    return Object.assign(new Error(code), { code });
}

function authorizeUrl(origin: string, scopeUrl: string | null, parameters: Readonly<Record<string, string>>, testId: string): string {
    const query = new URLSearchParams({ ...parameters, scope: scopeUrl ?? '', test: testId });
    return `${origin}/__oauth/authorize?${query.toString()}`;
}

/** Resolves the popup's answer: a grant, a cancellation (rejects `popup-closed-by-user`), or a closed popup (same). */
function awaitAnswer(deps: StandInDeps, origin: string, popup: StandInPopup): Promise<z.infer<typeof grantSchema>> {
    return new Promise((resolve, reject) => {
        let timer: unknown;
        const finish = (outcome: () => void): void => {
            stop();
            deps.clock.clearTimeout(timer);
            outcome();
        };
        const stop = deps.onMessage((message) => {
            if (message.origin !== origin || message.source !== popup) {
                return;
            }
            const grant = grantSchema.safeParse(message.data);
            if (grant.success) {
                finish(() => {
                    resolve(grant.data);
                });
            } else if (cancelSchema.safeParse(message.data).success) {
                finish(() => {
                    reject(authError('auth/popup-closed-by-user'));
                });
            }
        });
        const watch = (): void => {
            timer = deps.clock.setTimeout(() => {
                if (popup.closed) {
                    finish(() => {
                        reject(authError('auth/popup-closed-by-user'));
                    });
                    return;
                }
                watch();
            }, POPUP_POLL_MS);
        };
        watch();
    });
}

/** The stand-in's `PopupSignIn`. */
export function createStandInPopup(deps: StandInDeps): PopupSignIn {
    const origin = deps.origin ?? STAND_IN_ORIGIN;
    return async (scopeUrl, parameters): Promise<PopupResult> => {
        const popup = deps.open(authorizeUrl(origin, scopeUrl, parameters, deps.testId));
        if (popup === null) {
            throw authError('auth/popup-blocked');
        }
        const grant = await awaitAnswer(deps, origin, popup);
        const user = await deps.signInWithCredential(grant.idToken, grant.accessToken);
        return { accessToken: grant.accessToken, email: user.email };
    };
}
