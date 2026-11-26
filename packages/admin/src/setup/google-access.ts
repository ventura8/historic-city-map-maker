/**
 * Getting a Google token for a step (`docs/research/M2b-interfaces.md` §2): the live one when it satisfies the scope
 * and has at least five minutes left (no click, no consent), else Google's popup, which must open in the click's
 * synchronous part, so nothing is awaited before it. Every popup counts one consent on the step. A closed popup, an
 * unticked scope or another account leaves the step as it was, with the reason.
 */
import { unsatisfiedScopes, type GoogleScope } from '../google/scopes.js';
import type { SetupContext } from './context.js';
import { consentFailure, scopeDenied } from './messages.js';
import type { GoogleAccess } from './ports.js';
import type { SetupStepId } from './steps.js';

/** A step checks that its token lives this much longer before it starts a batch of calls (§1.5). */
export const MIN_TOKEN_LIFE_MS = 5 * 60_000;

/** The live token for `scope` with enough life left, or null. */
export function liveAccess(ctx: SetupContext, scope: GoogleScope): GoogleAccess | null {
    const access = ctx.deps.google.live(scope);
    return access !== null && access.expiresAt - ctx.deps.clock.now() >= MIN_TOKEN_LIFE_MS ? access : null;
}

function granted(ctx: SetupContext, step: SetupStepId, scope: GoogleScope, access: GoogleAccess | null): GoogleAccess | null {
    if (access === null) {
        ctx.patchStep(step, { busy: false, error: { key: 'adminShell.oauth.popupClosed' } });
        return null;
    }
    if (unsatisfiedScopes(access.scopes, [scope]).length > 0) {
        ctx.patchStep(step, { busy: false, error: scopeDenied(scope) });
        return null;
    }
    ctx.patchStep(step, { needsContinue: false });
    return access;
}

/**
 * A token for `scope` on behalf of `step`: the live one, else (from a click only) Google's popup. Null when none was
 * obtained; the step then says why, or offers Continue when it may not open a popup itself.
 */
export async function googleAccess(
    ctx: SetupContext,
    step: SetupStepId,
    scope: GoogleScope,
    fromClick: boolean,
): Promise<GoogleAccess | null> {
    const live = liveAccess(ctx, scope);
    if (live !== null) {
        return live;
    }
    if (!fromClick) {
        ctx.patchStep(step, { busy: false, needsContinue: true, error: { key: 'adminShell.session.googleExpired' } });
        return null;
    }
    const popup = ctx.deps.google.request(scope);
    ctx.count(step, 'consents');
    try {
        return granted(ctx, step, scope, await popup);
    } catch (error) {
        ctx.patchStep(step, { busy: false, error: consentFailure(error, scope) });
        return null;
    }
}
