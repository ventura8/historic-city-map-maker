import type { CallableResponse } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { PROBE_ATTEMPTS, PROBE_TIMEOUT_MS } from '../../src/auth/controller.js';
import { GoogleAuthError } from '../../src/auth/google-auth.js';
import { GOOGLE_SCOPES } from '../../src/google/scopes.js';
import { access, deployed, failure, OWNER, SESSION, settle, STRANGER, undeployed } from '../app/fakes.js';
import { harness, READ_ONLY, started } from './controller-harness.js';

describe('AuthController in normal mode (the server answers)', () => {
    it('happyPath_withoutAUserTheSignInShows', async () => {
        const h = harness();
        deployed(h.callables, h.auth, SESSION.owner);

        await started(h);

        expect(h.state()).toMatchObject({ auth: 'signedOut', mode: 'normal', user: null });
        expect(h.callables.calls[0]).toEqual({ name: 'admin.session', request: {}, timeoutMs: PROBE_TIMEOUT_MS });
    });

    it('happyPath_aSignedInAdminReachesTheShell', async () => {
        const h = harness({ user: OWNER });
        deployed(h.callables, h.auth, SESSION.owner);

        await started(h);

        expect(h.state()).toMatchObject({ auth: 'admin', mode: 'normal', role: 'owner', user: OWNER });
    });

    it('happyPath_theSignInClickAsksForNoScopeAndOpensTheShell', async () => {
        const h = harness();
        deployed(h.callables, h.auth, SESSION.admin);
        await started(h);

        await h.controller.signIn();
        await settle();

        expect(h.port.requests).toEqual([{ scope: null, options: {} }]);
        expect(h.state()).toMatchObject({ auth: 'admin', role: 'admin' });
        expect(h.callables.named('admin.session')).toBe(2);
    });

    it('badPath_aProbeThatTimedOutIsSentAgainAndAnAdminStillReachesTheShell', async () => {
        const h = harness({ user: OWNER });
        // A cold start: the first probe times out, the next one answers.
        const answers: (CallableResponse<'admin.session'> | Error)[] = [failure('deadline-exceeded', 'apiError.internal')];
        h.callables.answer('admin.session', () => {
            const next = answers.shift() ?? SESSION.owner;
            if (next instanceof Error) {
                throw next;
            }
            return next;
        });

        await started(h);

        expect(h.state()).toMatchObject({ auth: 'admin', mode: 'normal' });
        expect(h.recording.records.map((record) => record.message)).toContain('the server probe timed out: probing again');
    });

    it('badPath_aServerThatOnlyTimesOutIsTakenAsNoServerAfterTheLastProbe', async () => {
        const h = harness();
        h.callables.fail('admin.session', failure('deadline-exceeded', 'apiError.internal'));

        await started(h);

        expect(h.callables.named('admin.session')).toBe(PROBE_ATTEMPTS);
        expect(h.state()).toMatchObject({ auth: 'signedOut', mode: 'bootstrap' });
    });

    it('badPath_aDelayedClaimIsPickedUpByOneTokenRefresh', async () => {
        const h = harness({ user: OWNER });
        // The probe asks first (signed in, it gets a session too), then the evaluation.
        const answers: CallableResponse<'admin.session'>[] = [SESSION.delayed, SESSION.delayed, SESSION.owner];
        h.callables.answer('admin.session', () => answers.shift() ?? SESSION.owner);

        await started(h);

        expect(h.auth.refreshes).toBe(1);
        expect(h.state().auth).toBe('admin');
    });

    it('badPath_aStrangerIsToldAndSignedOut', async () => {
        const h = harness({ user: STRANGER });
        deployed(h.callables, h.auth, SESSION.stranger);

        await started(h);

        expect(h.state()).toMatchObject({ auth: 'notAdmin', user: null });
        expect(h.auth.signOuts).toBe(1);
    });

    it('badPath_aFailingBackgroundSignOutIsLoggedAndThePanelStays', async () => {
        const h = harness({ user: STRANGER });
        deployed(h.callables, h.auth, SESSION.stranger);
        h.auth.failSignOut = true;

        await started(h);

        expect(h.state().auth).toBe('notAdmin');
        expect(h.recording.records.some((record) => record.message === 'sign-out after refusal failed')).toBe(true);
    });

    it('happyPath_theBlockedPanelSignsOutToTheSignIn', async () => {
        const h = harness({ user: STRANGER });
        deployed(h.callables, h.auth, SESSION.stranger);
        await started(h);

        await h.controller.signOut();

        expect(h.state()).toMatchObject({ auth: 'signedOut', gate: { issue: null } });
    });

    it('badPath_aRetryableSessionFailureIsAServerProblemAndRetryRecovers', async () => {
        const h = harness({ user: OWNER });
        h.callables.answer('admin.session', (request) => {
            expect(request).toEqual({});
            if (h.callables.named('admin.session') === 2) {
                throw failure('unavailable', 'apiError.unavailable');
            }
            return SESSION.owner;
        });
        await started(h);

        expect(h.state()).toMatchObject({ auth: 'backendDown', gate: { issue: { key: 'apiError.unavailable' } } });

        await h.controller.retry();

        expect(h.state().auth).toBe('admin');
    });

    it('badPath_aRefusedSessionShowsItsReasonOnTheBlockedPanel', async () => {
        const h = harness({ user: STRANGER });
        h.callables.answer('admin.session', () => {
            if (h.callables.named('admin.session') > 1) {
                throw failure('permission-denied', 'apiError.accountNotAllowed');
            }
            throw failure('unauthenticated', 'apiError.unauthenticated');
        });

        await started(h);

        expect(h.state()).toMatchObject({ auth: 'notAdmin', gate: { issue: { key: 'apiError.accountNotAllowed' } } });
    });

    it('badPath_aRetryWithoutAUserEndsAtTheSignIn', async () => {
        const h = harness();
        deployed(h.callables, h.auth, SESSION.owner);
        await started(h);

        await h.controller.retry();

        expect(h.state().auth).toBe('signedOut');
    });
});

describe('AuthController: the owner claim and invitations', () => {
    it('happyPath_aReturningOwnerClaimsWithOneClickAndOneConsent', async () => {
        const h = harness({ user: OWNER });
        const answers: CallableResponse<'admin.session'>[] = [SESSION.unclaimed, SESSION.unclaimed, SESSION.owner];
        h.callables.answer('admin.session', () => answers.shift() ?? SESSION.owner);
        h.callables.answer('admin.claim', () => ({ role: 'owner', refreshToken: true }));
        await started(h);
        expect(h.state().auth).toBe('claimPending');

        h.port.outcomes.push(access(READ_ONLY));
        await h.controller.claim();

        expect(h.port.requests).toEqual([{ scope: 'cloudReadOnly', options: { loginHint: OWNER.email } }]);
        expect(h.callables.calls.find((call) => call.name === 'admin.claim')?.request).toEqual({
            googleAccessToken: 'ya29.e2e-owner-access-token',
        });
        expect(h.auth.refreshes).toBe(1);
        expect(h.state()).toMatchObject({ auth: 'admin', role: 'owner' });
    });

    it('badPath_aRefusedClaimStaysPendingWithItsMessage', async () => {
        const h = harness({ user: OWNER });
        h.callables.answer('admin.session', () => SESSION.unclaimed);
        h.callables.fail('admin.claim', failure('permission-denied', 'apiError.claim.tokenMismatch'));
        await started(h);

        h.port.outcomes.push(access(READ_ONLY));
        await h.controller.claim();

        expect(h.state()).toMatchObject({ auth: 'claimPending', gate: { issue: { key: 'apiError.claim.tokenMismatch' } } });
        expect(h.google.live('cloudReadOnly')).toBeNull();
    });

    it('badPath_aNotOwnerRefusalNamesTheProject', async () => {
        const h = harness({ user: OWNER });
        h.callables.answer('admin.session', () => SESSION.unclaimed);
        h.callables.fail('admin.claim', failure('permission-denied', 'apiError.claim.notOwner', { projectId: 'demo-hcm' }));
        await started(h);

        h.port.outcomes.push(access(READ_ONLY));
        await h.controller.claim();

        expect(h.state().gate.issue).toMatchObject({ key: 'apiError.claim.notOwner', params: { projectId: 'demo-hcm' } });
    });

    it('badPath_aClaimedMapRefusesASecondOwner', async () => {
        const h = harness({ user: OWNER });
        h.callables.answer('admin.session', () => SESSION.unclaimed);
        h.callables.fail('admin.claim', failure('already-exists', 'apiError.claim.alreadyClaimed'));
        await started(h);

        h.port.outcomes.push(access(READ_ONLY));
        await h.controller.claim();
        await settle();

        expect(h.state()).toMatchObject({ auth: 'notAdmin', gate: { issue: { key: 'apiError.claim.alreadyClaimed' } } });
    });

    it('badPath_aClosedClaimPopupChangesNothing', async () => {
        const h = harness({ user: OWNER });
        h.callables.answer('admin.session', () => SESSION.unclaimed);
        await started(h);

        h.port.outcomes.push(new GoogleAuthError('popupClosed'));
        await h.controller.claim();

        expect(h.state()).toMatchObject({ auth: 'claimPending', busy: false, gate: { issue: { key: 'adminShell.oauth.popupClosed' } } });
        expect(h.callables.named('admin.claim')).toBe(0);
    });

    it('badPath_aConsentWithoutATokenIsAnError', async () => {
        const h = harness({ user: OWNER });
        h.callables.answer('admin.session', () => SESSION.unclaimed);
        await started(h);

        h.port.outcomes.push(null);
        await h.controller.claim();

        expect(h.state().gate.issue?.key).toBe('apiError.internal');
    });

    it('happyPath_anInvitedAccountJoins', async () => {
        const h = harness({ user: STRANGER });
        const answers: CallableResponse<'admin.session'>[] = [SESSION.invited, SESSION.invited, SESSION.admin];
        h.callables.answer('admin.session', () => answers.shift() ?? SESSION.admin);
        h.callables.answer('admin.join', () => ({ role: 'admin', refreshToken: true }));
        await started(h);
        expect(h.state().auth).toBe('joinPending');

        await h.controller.join();

        expect(h.state()).toMatchObject({ auth: 'admin', role: 'admin' });
    });

    it('badPath_anExpiredInvitationShowsItsMessage', async () => {
        const h = harness({ user: STRANGER });
        h.callables.answer('admin.session', () => SESSION.invited);
        h.callables.fail('admin.join', failure('failed-precondition', 'apiError.invite.expired'));
        await started(h);

        await h.controller.join();

        expect(h.state()).toMatchObject({ auth: 'joinPending', busy: false, gate: { issue: { key: 'apiError.invite.expired' } } });
    });

    it('badPath_aJoinThatFailsWithoutDetailsIsAnInternalError', async () => {
        const h = harness({ user: STRANGER });
        h.callables.answer('admin.session', () => SESSION.invited);
        h.callables.fail('admin.join', new Error('network'));
        await started(h);

        await h.controller.join();

        expect(h.state().gate.issue?.key).toBe('apiError.internal');
    });

    it('badPath_aFailingTokenRefreshIsLoggedAndTheSessionAskedAgain', async () => {
        const h = harness({ user: OWNER });
        // The probe asks first (signed in, it gets a session too), then the evaluation.
        const answers: CallableResponse<'admin.session'>[] = [SESSION.delayed, SESSION.delayed, SESSION.owner];
        h.callables.answer('admin.session', () => answers.shift() ?? SESSION.owner);
        h.auth.failRefresh = true;

        await started(h);

        expect(h.state().auth).toBe('admin');
        expect(h.recording.records.some((record) => record.message === 'ID token refresh failed')).toBe(true);
    });
});

describe('AuthController against a server older than the admin (finding 27 of 2026-10-31)', () => {
    it('badPath_anAnswerInAnOlderShapeProvesTheServerAndGooglesVerdictDecides', async () => {
        const h = harness();
        h.callables.fail('admin.session', failure('failed-precondition', 'apiError.serverOutdated'));
        await started(h);
        expect(h.state()).toMatchObject({ auth: 'signedOut', mode: 'normal' });

        h.port.outcomes.push(access(READ_ONLY));
        await h.controller.signIn();
        await settle();

        // Not "not an admin", not "the server is down": the owner reaches Setup, where Update the map replaces the server.
        expect(h.ownership).toHaveBeenCalledTimes(1);
        expect(h.state()).toMatchObject({ auth: 'bootstrap', mode: 'bootstrap', user: OWNER });
    });
});

describe('AuthController in bootstrap mode (no server yet)', () => {
    it('happyPath_theOwnerSignsInWithTheReadOnlyScopeAndStartsTheSetup', async () => {
        const h = harness();
        undeployed(h.callables);
        await started(h);
        expect(h.state()).toMatchObject({ auth: 'signedOut', mode: 'bootstrap' });

        h.port.outcomes.push(access(READ_ONLY));
        await h.controller.signIn();

        expect(h.port.requests[0]?.scope).toBe('cloudReadOnly');
        expect(h.ownership).toHaveBeenCalledTimes(1);
        expect(h.state()).toMatchObject({ auth: 'bootstrap', mode: 'bootstrap', user: OWNER });
        expect(h.callables.calls.every((call) => call.name === 'admin.session')).toBe(true);
    });

    it.each([
        ['notOwner', { kind: 'notOwner' }],
        ['backendDown', { kind: 'down' }],
    ] as const)('badPath_theVerdictLeadsTo_%s', async (expected, verdict) => {
        const h = harness({ verdicts: [verdict] });
        undeployed(h.callables);
        await started(h);

        h.port.outcomes.push(access(READ_ONLY));
        await h.controller.signIn();

        expect(h.state().auth).toBe(expected);
    });

    it('happyPath_aStartUpDeployCallsNothingOfTheServerUntilGoogleSaysItIsInstalled', async () => {
        const h = harness({ startUp: true });
        undeployed(h.callables);
        await started(h);
        expect(h.state()).toMatchObject({ auth: 'signedOut', mode: 'bootstrap' });

        h.port.outcomes.push(access(READ_ONLY));
        await h.controller.signIn();

        expect(h.port.requests[0]?.scope).toBe('cloudReadOnly');
        expect(h.state()).toMatchObject({ auth: 'bootstrap', mode: 'bootstrap', user: OWNER });
        // No probe: a function that is not deployed answers 404 without CORS headers, which the browser logs as an error.
        expect(h.callables.calls).toEqual([]);
        expect(h.recording.records.map((record) => record.message)).toContain('start-up deploy: bootstrap mode without probing the server');

        // Step (d) saw every function ACTIVE: now the server is probed, and it answers.
        deployed(h.callables, h.auth, SESSION.owner);
        expect(await h.controller.serverReady()).toBe(true);
        expect(h.callables.calls.map((call) => call.name)).toContain('admin.session');
        expect(h.state()).toMatchObject({ auth: 'admin', mode: 'normal' });
        expect(h.memory.seen).toBe(true);
    });

    it('happyPath_aBrowserThatHadTheServersAnswerProbesItDespiteAStartUpDeploy', async () => {
        // A functions-only deploy left the start-up page in place: the server is there, so the session decides.
        const h = harness({ startUp: true, seen: true, user: OWNER });
        deployed(h.callables, h.auth, SESSION.owner);

        await started(h);

        expect(h.state()).toMatchObject({ auth: 'admin', mode: 'normal' });
    });

    it('badPath_aStartUpDeployWithAStrangerAsksGoogleAndNeverTheServer', async () => {
        const h = harness({ startUp: true, verdicts: [{ kind: 'notOwner' }] });
        await started(h);

        h.port.outcomes.push(access(READ_ONLY));
        await h.controller.signIn();

        expect(h.state().auth).toBe('notOwner');
        expect(h.callables.calls).toEqual([]);
    });

    it('badPath_aReloadKeepsTheUserButAsksForTheConsentAgain', async () => {
        const h = harness({ user: OWNER });
        undeployed(h.callables);

        await started(h);

        expect(h.state()).toMatchObject({ auth: 'signedOut', user: OWNER, gate: { reconsent: true } });
        expect(h.ownership).not.toHaveBeenCalled();

        h.port.outcomes.push(access(READ_ONLY));
        await h.controller.signIn();

        expect(h.port.requests[0]?.options).toEqual({ loginHint: OWNER.email });
        expect(h.state().auth).toBe('bootstrap');
    });

    it('badPath_anExpiredTokenAsksAgain', async () => {
        const h = harness({ verdicts: [{ kind: 'expired' }] });
        undeployed(h.callables);
        await started(h);

        h.port.outcomes.push(access(READ_ONLY));
        await h.controller.signIn();

        expect(h.state()).toMatchObject({ auth: 'signedOut', gate: { reconsent: true } });
        expect(h.google.live('cloudReadOnly')).toBeNull();
    });

    it('badPath_aClosedPopupKeepsThePanelAndSaysWhy', async () => {
        const h = harness({ user: OWNER });
        undeployed(h.callables);
        await started(h);

        h.port.outcomes.push(new GoogleAuthError('popupClosed'));
        await h.controller.signIn();

        expect(h.state()).toMatchObject({ auth: 'signedOut', gate: { reconsent: true, issue: { key: 'adminShell.oauth.popupClosed' } } });
    });

    it('badPath_aClosedFirstSignInPopupLeavesNobodySignedIn', async () => {
        const h = harness();
        undeployed(h.callables);
        await started(h);

        h.port.outcomes.push(new GoogleAuthError('popupBlocked'));
        await h.controller.signIn();

        expect(h.state()).toMatchObject({ auth: 'signedOut', user: null, gate: { issue: { key: 'adminShell.oauth.popupBlocked' } } });
    });
});

describe('AuthController in bootstrap mode: enabling an API and the switch to the server', () => {
    it('happyPath_aDisabledResourceManagerIsEnabledWithGoogleThenChecked', async () => {
        const h = harness({ verdicts: [{ kind: 'apiDisabled', api: 'cloudresourcemanager.googleapis.com' }, { kind: 'owner' }] });
        undeployed(h.callables);
        await started(h);
        h.port.outcomes.push(access(READ_ONLY));
        await h.controller.signIn();
        expect(h.state()).toMatchObject({
            auth: 'signedOut',
            gate: { enableApi: 'cloudresourcemanager.googleapis.com', issue: { key: 'apiError.cloud.apiDisabled' } },
        });

        h.port.outcomes.push(access([GOOGLE_SCOPES.cloudPlatform]));
        await h.controller.enableApi();

        expect(h.port.requests[1]?.scope).toBe('cloudPlatform');
        expect(h.enableApi).toHaveBeenCalledWith('ya29.e2e-owner-access-token', 'cloudresourcemanager.googleapis.com');
        expect(h.state().auth).toBe('bootstrap');
    });

    it('badPath_aRefusedEnableShowsTheApiAgain', async () => {
        const h = harness({ verdicts: [{ kind: 'apiDisabled', api: 'cloudresourcemanager.googleapis.com' }], enabled: false });
        undeployed(h.callables);
        await started(h);
        h.port.outcomes.push(access(READ_ONLY));
        await h.controller.signIn();

        h.port.outcomes.push(access([GOOGLE_SCOPES.cloudPlatform]));
        await h.controller.enableApi();

        expect(h.state()).toMatchObject({
            auth: 'signedOut',
            gate: { issue: { key: 'apiError.cloud.apiDisabled', params: { api: 'cloudresourcemanager.googleapis.com' } } },
        });
    });

    it('badPath_aClosedEnablePopupKeepsTheOffer', async () => {
        const h = harness({ verdicts: [{ kind: 'apiDisabled', api: 'cloudresourcemanager.googleapis.com' }] });
        undeployed(h.callables);
        await started(h);
        h.port.outcomes.push(access(READ_ONLY));
        await h.controller.signIn();

        h.port.outcomes.push(new GoogleAuthError('popupClosed'));
        await h.controller.enableApi();

        expect(h.enableApi).not.toHaveBeenCalled();
        expect(h.state()).toMatchObject({
            gate: { enableApi: 'cloudresourcemanager.googleapis.com', issue: { key: 'adminShell.oauth.popupClosed' } },
        });
    });

    it('badPath_enableWithoutAnApiOpensNoPopup', async () => {
        const h = harness();
        undeployed(h.callables);
        await started(h);

        await h.controller.enableApi();

        expect(h.port.requests).toEqual([]);
    });

    it('happyPath_theDeployedServerIsClaimedWithTheProvisioningTokenAndNoClick', async () => {
        const h = harness();
        undeployed(h.callables);
        await started(h);
        h.port.outcomes.push(access([...READ_ONLY, GOOGLE_SCOPES.cloudPlatform]));
        await h.controller.signIn();
        expect(await h.controller.serverReady()).toBe(false);

        const answers: CallableResponse<'admin.session'>[] = [SESSION.unclaimed, SESSION.unclaimed, SESSION.owner];
        h.callables.answer('admin.session', () => answers.shift() ?? SESSION.owner);
        h.callables.answer('admin.claim', () => ({ role: 'owner', refreshToken: true }));

        expect(await h.controller.serverReady()).toBe(true);
        expect(h.port.requests).toHaveLength(1);
        expect(h.state()).toMatchObject({ auth: 'admin', mode: 'normal', role: 'owner' });
    });

    it('badPath_withoutALiveTokenTheClaimCostsOneClick', async () => {
        const h = harness({ user: OWNER });
        h.callables.answer('admin.session', () => SESSION.unclaimed);

        expect(await h.controller.serverReady()).toBe(true);
        expect(h.state().auth).toBe('claimPending');
    });

    it('badPath_aServerThatAnswersWithNobodySignedInShowsTheSignIn', async () => {
        const h = harness();
        deployed(h.callables, h.auth, SESSION.owner);

        expect(await h.controller.serverReady()).toBe(true);
        expect(h.state().auth).toBe('signedOut');
    });

    it('badPath_anUnexpectedProbeErrorCountsAsNoAnswer', async () => {
        const h = harness();
        h.callables.fail('admin.session', new TypeError('Failed to fetch'));

        await started(h);

        expect(h.state().mode).toBe('bootstrap');
    });
});

describe('AuthController: sessions ending', () => {
    it('badPath_aRevokedSessionEndsAtTheSignInWithAMessage', async () => {
        const h = harness({ user: OWNER });
        deployed(h.callables, h.auth, SESSION.owner);
        await started(h);

        h.auth.announce(null);
        await settle();

        expect(h.state()).toMatchObject({ auth: 'signedOut', gate: { issue: { key: 'adminShell.session.expired' } } });
    });

    it('happyPath_signingOutForgetsTokensAndSessionKeysButNotOtherKeys', async () => {
        const h = harness({ user: OWNER });
        deployed(h.callables, h.auth, SESSION.unclaimed);
        h.session.set('hcm:admin:returnTo', '#/photos');
        h.session.set('hcm:admin:bootstrap:demo-hcm', '{}');
        h.session.set('other-app', 'kept');
        await started(h);
        h.port.outcomes.push(new GoogleAuthError('popupClosed'));
        await h.controller.claim();

        await h.controller.signOut();
        await settle();

        expect(h.session.keys()).toEqual(['other-app']);
        expect(h.state()).toMatchObject({ auth: 'signedOut', gate: { issue: null } });
    });

    it('happyPath_signingOutForgetsThisBrowsersPushRegistrationOfTheAdminFirst', async () => {
        const h = harness({ user: OWNER, leaving: true });
        deployed(h.callables, h.auth, SESSION.owner);
        await started(h);

        await h.controller.signOut();
        await settle();

        expect(h.left).toEqual([OWNER.uid]);
        expect(h.auth.signOuts).toBe(1);
    });

    it('badPath_signingOutWithNobodySignedInForgetsNothing', async () => {
        const h = harness({ leaving: true });
        deployed(h.callables, h.auth, SESSION.owner);
        await started(h);

        await h.controller.signOut();

        expect(h.left).toEqual([]);
        expect(h.state().auth).toBe('signedOut');
    });

    it('badPath_aRemovedAdminIsDeniedOnTheNextAction', async () => {
        const h = harness({ user: OWNER });
        const answers: CallableResponse<'admin.session'>[] = [SESSION.admin, SESSION.admin, SESSION.stranger];
        h.callables.answer('admin.session', () => answers.shift() ?? SESSION.stranger);
        await started(h);
        expect(h.state().auth).toBe('admin');

        await h.controller.accessDenied();
        await settle();

        expect(h.state().auth).toBe('notAdmin');
    });

    it('badPath_aRemovedAdminWithUnsavedChangesKeepsThePageReadOnlyUntilSignOut', async () => {
        // S-A20-BAD-REVOKED-WHILE-EDITING (DECISIONS-for-review.md §35e): the draft stays on screen.
        const h = harness({ user: OWNER, unsaved: () => true });
        const answers: CallableResponse<'admin.session'>[] = [SESSION.admin, SESSION.admin, SESSION.stranger];
        h.callables.answer('admin.session', () => answers.shift() ?? SESSION.stranger);
        await started(h);

        await h.controller.accessDenied();
        await settle();
        expect(h.state()).toMatchObject({ auth: 'admin', revoked: true });
        expect(h.auth.signOuts).toBe(0);
        const asked = h.callables.named('admin.session');
        await h.controller.accessDenied();
        expect(h.callables.named('admin.session')).toBe(asked);

        await h.controller.signOut();
        await settle();
        expect(h.state()).toMatchObject({ auth: 'signedOut', revoked: false, gate: { issue: null } });
    });

    it('badPath_aDenialOutsideTheShellAsksNothing', async () => {
        const h = harness();
        deployed(h.callables, h.auth, SESSION.owner);
        await started(h);
        const calls = h.callables.calls.length;

        await h.controller.accessDenied();

        expect(h.callables.calls).toHaveLength(calls);
    });

    it('happyPath_theSameUserAnnouncedAgainIsNotEvaluatedTwice', async () => {
        const h = harness({ user: OWNER });
        deployed(h.callables, h.auth, SESSION.owner);
        await started(h);
        const calls = h.callables.calls.length;

        h.auth.announce(OWNER);
        await settle();

        expect(h.callables.calls).toHaveLength(calls);
    });

    it('happyPath_stopEndsTheAuthSubscription', async () => {
        const h = harness();
        deployed(h.callables, h.auth, SESSION.owner);
        await started(h);

        h.controller.stop();
        h.controller.stop();

        expect(h.auth.listening).toBe(0);
    });
});
