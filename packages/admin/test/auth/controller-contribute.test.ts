import { describe, expect, it } from 'vitest';

import { access, deployed, failure, OWNER, SESSION, settle, STRANGER, undeployed } from '../app/fakes.js';
import { harness, READ_ONLY, started } from './controller-harness.js';

/**
 * M13 §3: on the Contribute page every state is a contributor's (`docs/research/M13-roles.md` §3): a signed-in account of no
 * role stays signed in; a server that does not answer is "resting" (Try again), never the start-up mode, Google's owner check
 * or the claim; a map nobody set up is "not open yet"; a session the server refuses is said there, never "not an admin".
 */
const CONTRIBUTING = { contributing: () => true } as const;

describe('M13: the Contribute page', () => {
    it('happyPath_aStrangerStaysSignedInThere @S-A92-HAPPY-REQUEST', async () => {
        const h = harness({ user: STRANGER, ...CONTRIBUTING });
        deployed(h.callables, h.auth, SESSION.stranger);

        await started(h);

        expect(h.state()).toMatchObject({ auth: 'visitor', mode: 'normal' });
        expect(h.auth.signOuts).toBe(0);
    });

    it('badPath_elsewhereAStrangerIsSignedOutAsBefore', async () => {
        const h = harness({ user: STRANGER, contributing: () => false });
        deployed(h.callables, h.auth, SESSION.stranger);

        await started(h);

        expect(h.state().auth).toBe('notAdmin');
    });

    it('badPath_aServerThatDoesNotAnswerIsRestingNeverTheSetup_andTryAgainOpensThePage @S-A92-BAD-CONTRIBUTE-NO-SERVER', async () => {
        const h = harness(CONTRIBUTING);
        undeployed(h.callables);
        await started(h);
        expect(h.state()).toMatchObject({ auth: 'signedOut', mode: 'bootstrap' });

        await h.controller.signIn();
        await settle();

        // No Cloud scope, no owner check, no claim: the contributor is told the map rests.
        expect(h.port.requests).toEqual([{ scope: null, options: {} }]);
        expect(h.ownership).not.toHaveBeenCalled();
        expect(h.state()).toMatchObject({ auth: 'backendDown', user: OWNER, gate: { reconsent: false, issue: null } });
        expect(h.callables.calls.every((call) => call.name === 'admin.session')).toBe(true);

        deployed(h.callables, h.auth, SESSION.stranger);
        await h.controller.retry();

        expect(h.state()).toMatchObject({ auth: 'visitor', mode: 'normal' });
    });

    it('badPath_aStartUpDeployIsNotOpenYet_andTheServerIsNeverCalled', async () => {
        const h = harness({ startUp: true, ...CONTRIBUTING });
        undeployed(h.callables);
        await started(h);

        h.port.outcomes.push(access(READ_ONLY));
        await h.controller.signIn();

        expect(h.port.requests[0]?.scope).toBeNull();
        expect(h.state()).toMatchObject({ auth: 'contributeClosed', gate: { reconsent: false } });
        expect(h.callables.calls).toEqual([]);
        expect(h.ownership).not.toHaveBeenCalled();
    });

    it('badPath_aMapWithoutAnOwnerIsNotOpenYet_neverTheClaim', async () => {
        const h = harness(CONTRIBUTING);
        deployed(h.callables, h.auth, SESSION.unclaimed);
        await started(h);

        // Even with a live read-only token (which elsewhere claims the map at once), nothing is claimed here.
        h.port.outcomes.push(access(READ_ONLY));
        await h.controller.signIn();
        await settle();

        expect(h.state()).toMatchObject({ auth: 'contributeClosed', mode: 'normal' });
        expect(h.callables.named('admin.claim')).toBe(0);
        expect(h.auth.signOuts).toBe(0);
    });

    it('badPath_aBusyServerIsRestingWithItsReason_andStaysSignedIn @S-A92-BAD-CONTRIBUTE-BUSY', async () => {
        const h = harness({ user: STRANGER, ...CONTRIBUTING });
        h.callables.answer('admin.session', () => {
            if (h.callables.named('admin.session') > 1) {
                throw failure('unavailable', 'apiError.unavailable');
            }
            return SESSION.stranger;
        });

        await started(h);

        expect(h.state()).toMatchObject({ auth: 'backendDown', gate: { issue: { key: 'apiError.unavailable' } } });
        expect(h.auth.signOuts).toBe(0);
    });

    it('badPath_aRefusedSessionIsSaidThere_neverNotAnAdmin @S-A92-BAD-CONTRIBUTE-SESSION', async () => {
        const h = harness({ user: STRANGER, ...CONTRIBUTING });
        h.callables.answer('admin.session', () => {
            if (h.callables.named('admin.session') > 1) {
                throw failure('permission-denied', 'apiError.accountNotAllowed');
            }
            return SESSION.stranger;
        });

        await started(h);

        expect(h.state()).toMatchObject({ auth: 'backendDown', gate: { issue: { key: 'apiError.accountNotAllowed' } } });
        expect(h.auth.signOuts).toBe(0);
    });

    it('badPath_aServerOlderThanTheAdminIsRestingWithoutTheAdminsReason', async () => {
        const h = harness({ user: STRANGER, ...CONTRIBUTING });
        h.callables.answer('admin.session', () => {
            if (h.callables.named('admin.session') > 1) {
                throw failure('failed-precondition', 'apiError.serverOutdated');
            }
            return SESSION.stranger;
        });

        await started(h);

        expect(h.state()).toMatchObject({ auth: 'backendDown', gate: { issue: null } });
        expect(h.ownership).not.toHaveBeenCalled();
    });
});
