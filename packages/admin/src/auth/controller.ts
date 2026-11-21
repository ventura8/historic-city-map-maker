/**
 * The admin's auth state machine (`docs/research/M2b-interfaces.md` §1.3–§1.5, §3.2, §3.3 d2). It probes the server
 * before sign-in, follows Firebase Auth's user, and moves through `AdminAuthState`:
 *
 * - **Normal mode** (the probe got an answer): `admin.session` decides between the shell (`admin`), the owner claim
 *   (automatic with a live read-only Google token, else one click), the invitation (`joinPending`) and `notAdmin`.
 * - **Bootstrap mode** (no answer): Google decides with the owner's own token (`ownership.ts`): `bootstrap`, `notOwner`
 *   or `backendDown`. When the Setup Assistant sees the server deployed it calls `serverReady`, which probes again and,
 *   once the server answers, claims with the token the provisioning left in memory (no click).
 * - **A start-up deploy** (`runtime.json` says `startUp`: the Hosting-only deploy of a new map) starts in bootstrap mode
 *   without the anonymous probe: the missing function's 404 has no CORS headers, so the probe would only make the
 *   browser log a CORS error. Google tells the owner when the server is installed (step d), and only then is it probed.
 *
 * - **The Contribute page** (M13 §3, `docs/research/M13-roles.md`): every state is a contributor's. The sign-in asks for no
 *   Cloud scope; a server that does not answer is `backendDown` ("resting", Try again), a start-up deploy's or an unowned
 *   map is `contributeClosed`; a session the server refuses is `backendDown` with its reason. Never the start-up mode,
 *   Google's owner check, the claim or `notAdmin` there.
 *
 * Every Google popup is the first await of the intent that opens it (popup blockers). Revocation: a callable answering
 * `apiError.notAdmin` or a denied admin read calls `accessDenied`; when the session then says the account is no admin
 * while an editor holds unsaved changes, the shell keeps the page read-only under a banner until sign-out (`revoked`,
 * `DECISIONS-for-review.md` §35e) instead of replacing it; a revoked refresh token signs the user out, which ends in
 * `signedOut` with `adminShell.session.expired`.
 */
import { API_ERRORS, apiErrorFromFailure, type ApiErrorDetails, type Logger, type SessionResponse } from '@hcm/shared';

import type { KeyValueStore, Unsubscribe } from '../app/ports.js';
import { CallableFailure, type AuthPort, type AuthUser, type CallablesPort } from '../firebase/ports.js';
import type { GoogleScope } from '../google/scopes.js';
import { NO_GATE, type AdminGate, type NoticeInput, type ShellState, type ShellStateAccess } from '../state/state.js';
import type { AdminAuthState } from './auth-state.js';
import type { GoogleAccessService, GoogleOutcome } from './google-service.js';
import type { OwnershipVerdict } from './ownership.js';

/** The probe's timeout (§1.4): a cold start slower than this answers the next probe. */
export const PROBE_TIMEOUT_MS = 10_000;

/**
 * How many probes one start sends while the server only times out: a server whose cold start (or a busy moment) took
 * longer than `PROBE_TIMEOUT_MS` answers the next one, and an admin is not sent to the start-up mode for it.
 */
export const PROBE_ATTEMPTS = 3;

/** Callable statuses that do not prove a deployed server: a missing function's 404 has no CORS headers. */
const NO_ANSWER: ReadonlySet<string> = new Set(['internal', 'unavailable', 'deadline-exceeded', 'not-found']);

/** Any answer but the four of `NO_ANSWER` proves a server (a deployed callable refuses an anonymous probe, say). */
function provesServer(error: unknown): boolean {
    return error instanceof CallableFailure && !NO_ANSWER.has(error.status);
}

/** A callable that got no answer in its time (a cold start, or a busy server), not a missing one. */
function timedOut(error: unknown): boolean {
    return error instanceof CallableFailure && error.status === 'deadline-exceeded';
}

/** Every `sessionStorage` key of the admin starts with this; the sign-out removes them all. */
const SESSION_PREFIX = 'hcm:admin:';

export interface AuthControllerDeps {
    readonly auth: AuthPort;
    readonly callables: CallablesPort;
    readonly google: GoogleAccessService;
    /** §3.2's check with a read-only token (`checkOwnership` bound to the project). */
    readonly ownership: (token: string) => Promise<OwnershipVerdict>;
    /** Service Usage's enable with a `cloud-platform` token (`enableService` bound to the project). */
    readonly enableApi: (token: string, api: string) => Promise<boolean>;
    readonly shell: ShellStateAccess;
    readonly session: KeyValueStore;
    readonly log: Logger;
    /** The deploy says the map's server is not installed yet (`runtime.json` → `startUp`): no probe before step (d). */
    readonly startUp?: boolean;
    /**
     * Whether this browser has had an answer from the project's server (`localStorage`): then a start-up deploy still
     * probes it, as its server has been installed since (a functions-only deploy left the start-up page in place).
     */
    readonly serverSeen?: { known(): boolean; remember(): void };
    /** Whether an editor holds unsaved changes (a revoked admin's page then stays, read-only, until sign-out). */
    readonly unsaved?: () => boolean;
    /** M5: what the session's cities make of the shell (`../app/current-city.ts`: the cities, the current one). */
    readonly cities?: (session: SessionResponse) => Partial<ShellState>;
    /** M13 §3: this page is the Contribute page, where a signed-in account of no role stays signed in. */
    readonly contributing?: () => boolean;
    /**
     * What this browser forgets before the account goes, while it may still call the server: the admin's push
     * registration (M4, `inbox/push-device.ts`), so a shared computer stops showing their notifications. Best effort:
     * it never rejects.
     */
    readonly leaving?: (uid: string) => Promise<void>;
}

function detailsOf(error: unknown): ApiErrorDetails {
    return error instanceof CallableFailure ? error.details : apiErrorFromFailure(undefined, undefined);
}

/** A server error code (and its parameters) as a panel message. */
function noticeFrom(details: ApiErrorDetails): NoticeInput {
    return details.params === undefined ? { key: details.code } : { key: details.code, params: details.params };
}

/** What §3.2 makes of Google's verdict (`expired` and `apiDisabled` ask for a new consent on the sign-in panel). */
const VERDICT_STATES: Readonly<Record<OwnershipVerdict['kind'], Partial<ShellState>>> = {
    owner: { auth: 'bootstrap', mode: 'bootstrap' },
    notOwner: { auth: 'notOwner' },
    down: { auth: 'backendDown' },
    expired: { auth: 'signedOut' },
    apiDisabled: { auth: 'signedOut' },
};

export class AuthController {
    readonly #deps: AuthControllerDeps;
    #answers = false;
    /** A consent popup is open: its click handler continues the flow, not the user listener. */
    #popup = false;
    /** The user asked to sign out (no "session expired" message). */
    #leaving = false;
    /** The uid last evaluated: Firebase may announce a popup's user after the popup's own flow decided. */
    #evaluated: string | null = null;
    #stopAuth: Unsubscribe | null = null;

    constructor(deps: AuthControllerDeps) {
        this.#deps = deps;
    }

    /** Probes the server (a start-up deploy assumes none), then follows Firebase Auth's user. */
    async start(): Promise<void> {
        if (this.#deps.startUp === true && this.#deps.serverSeen?.known() !== true) {
            this.#deps.log.info('start-up deploy: bootstrap mode without probing the server');
            this.#set({ mode: 'bootstrap' });
        } else {
            await this.#reprobe();
        }
        this.#stopAuth = this.#deps.auth.onUserChanged((user) => {
            void this.#userChanged(user);
        });
    }

    stop(): void {
        this.#stopAuth?.();
        this.#stopAuth = null;
    }

    /** The sign-in click: Google's popup, with the read-only Cloud scope when the server did not answer (§3.3 a). */
    async signIn(): Promise<void> {
        const gate = this.#deps.shell.get().gate;
        this.#set({ auth: 'signingIn', gate: NO_GATE });
        const outcome = await this.#consent(this.#answers || this.#contributing() ? null : 'cloudReadOnly');
        if (!outcome.granted) {
            this.#set({ auth: 'signedOut', gate: { ...gate, issue: this.#deps.shell.notice(outcome.notice) } });
            return;
        }
        await this.#continueWithUser();
    }

    /** The claim click (`claimPending`): a read-only consent, then `admin.claim`. */
    async claim(): Promise<void> {
        this.#set({ busy: true, gate: NO_GATE });
        const token = await this.#consentToken('cloudReadOnly');
        if (token !== null) {
            await this.#runClaim(token);
        }
    }

    /** The join click (`joinPending`): `admin.join`, then the session again. */
    async join(): Promise<void> {
        this.#set({ busy: true, gate: NO_GATE });
        try {
            await this.#deps.callables.call('admin.join', {});
        } catch (error) {
            this.#refused(noticeFrom(detailsOf(error)));
            return;
        }
        await this.#refresh();
        await this.#askSession(true);
    }

    /** Enables the API the sign-in panel names (one `cloud-platform` consent), then checks the ownership again. */
    async enableApi(): Promise<void> {
        const api = this.#deps.shell.get().gate.enableApi;
        const token = api === null ? null : await this.#consentToken('cloudPlatform');
        if (api === null || token === null) {
            return;
        }
        if (!(await this.#deps.enableApi(token, api))) {
            this.#refused({ key: 'apiError.cloud.apiDisabled', params: { api } });
            return;
        }
        await this.#continueWithUser();
    }

    /**
     * Signs out: every Google token and every `hcm:admin:*` session key goes too (§1.5), and, first, this browser's push
     * registration of the admin (M4).
     */
    async signOut(): Promise<void> {
        this.#leaving = true;
        this.#deps.google.drop();
        for (const key of this.#deps.session.keys().filter((name) => name.startsWith(SESSION_PREFIX))) {
            this.#deps.session.remove(key);
        }
        const user = this.#deps.auth.currentUser();
        await this.#forget(user);
        if (user === null) {
            this.#leaving = false;
            this.#set({ auth: 'signedOut', user: null, role: null, busy: false, revoked: false, people: {}, gate: NO_GATE });
            return;
        }
        await this.#deps.auth.signOut();
    }

    /** M4: this browser's push registration of `user` goes first, while the server still answers them (never throws). */
    async #forget(user: AuthUser | null): Promise<void> {
        if (user !== null && this.#deps.leaving !== undefined) {
            await this.#deps.leaving(user.uid);
        }
    }

    /** Try again (`backendDown`): probes, then decides for the current user. */
    async retry(): Promise<void> {
        this.#set({ auth: 'probing', gate: NO_GATE });
        await this.#reprobe();
        await this.#continueWithUser();
    }

    /**
     * The Setup Assistant saw every function deployed (§3.3 d): probes again and, once the server answers, follows the
     * normal flow, whose claim needs no click while the provisioning's token is alive. True when the server answered.
     */
    async serverReady(): Promise<boolean> {
        await this.#reprobe();
        if (this.#answers) {
            await this.#continueWithUser();
        }
        return this.#answers;
    }

    /** A callable said `apiError.notAdmin` or an admin read was denied: ask the server who this is now (§1.5), once. */
    async accessDenied(): Promise<void> {
        const shell = this.#deps.shell.get();
        if (shell.auth === 'admin' && !shell.revoked) {
            await this.#askSession(false);
        }
    }

    async #reprobe(): Promise<void> {
        this.#answers = await this.#probe();
        if (this.#answers) {
            this.#deps.serverSeen?.remember();
        }
        this.#set({ mode: this.#answers ? 'normal' : 'bootstrap' });
    }

    /**
     * An anonymous (or signed-in) `admin-session` call; any answer but the four of `NO_ANSWER` proves a server. A call
     * that timed out is sent again, up to `PROBE_ATTEMPTS` in all (`docs/LESSONS.md` 120).
     */
    async #probe(attempts: number = PROBE_ATTEMPTS): Promise<boolean> {
        try {
            await this.#deps.callables.call('admin.session', {}, { timeoutMs: PROBE_TIMEOUT_MS });
            return true;
        } catch (error) {
            if (attempts > 1 && timedOut(error)) {
                this.#deps.log.warn('the server probe timed out: probing again', { attemptsLeft: attempts - 1 });
                return this.#probe(attempts - 1);
            }
            return provesServer(error);
        }
    }

    /** A consent's token, or null after the panel shows why there is none. */
    async #consentToken(scope: GoogleScope): Promise<string | null> {
        const outcome = await this.#consent(scope);
        if (!outcome.granted) {
            this.#refused(outcome.notice);
            return null;
        }
        if (outcome.access === null) {
            this.#refused({ key: 'apiError.internal' });
            return null;
        }
        return outcome.access.token;
    }

    async #consent(scope: GoogleScope | null): Promise<GoogleOutcome> {
        this.#popup = true;
        try {
            return await this.#deps.google.request(scope);
        } finally {
            this.#popup = false;
        }
    }

    /** Firebase's user changed: a consent popup's own flow goes on; a new user is evaluated once. */
    async #userChanged(user: AuthUser | null): Promise<void> {
        const previous = this.#deps.shell.get().auth;
        this.#set({ user });
        if (this.#popup || (user !== null && user.uid === this.#evaluated)) {
            return;
        }
        if (user === null) {
            this.#signedOut(previous);
            return;
        }
        await this.#evaluate(user);
    }

    #signedOut(previous: AdminAuthState): void {
        this.#deps.google.drop();
        this.#evaluated = null;
        if (previous === 'notAdmin' && !this.#leaving) {
            return;
        }
        const expired = ['admin', 'visitor'].includes(previous) && !this.#leaving;
        this.#leaving = false;
        const issue = expired ? this.#deps.shell.notice({ key: 'adminShell.session.expired' }) : null;
        this.#set({ auth: 'signedOut', role: null, busy: false, revoked: false, people: {}, gate: { ...NO_GATE, issue } });
    }

    /** After a consent or a retry: the current user's case is decided again (none: signed out). */
    async #continueWithUser(): Promise<void> {
        const user = this.#deps.auth.currentUser();
        this.#set({ user });
        if (user === null) {
            this.#set({ auth: 'signedOut', busy: false });
            return;
        }
        await this.#evaluate(user);
    }

    async #evaluate(user: AuthUser): Promise<void> {
        this.#evaluated = user.uid;
        this.#set({ auth: 'probing', busy: false, gate: NO_GATE });
        if (!this.#answers && this.#contributing()) {
            this.#noServerToContribute();
            return;
        }
        await (this.#answers ? this.#askSession(false) : this.#classify());
    }

    /** M13 §3: no server on the Contribute page: it rests (Try again), or a start-up deploy's map is not open yet. */
    #noServerToContribute(): void {
        const installed = this.#deps.startUp !== true || this.#deps.serverSeen?.known() === true;
        this.#set({ auth: installed ? 'backendDown' : 'contributeClosed', busy: false });
    }

    /** M13 §3: this page is the Contribute page (the address, or the deep link kept while signed out). */
    #contributing(): boolean {
        return this.#deps.contributing?.() === true;
    }

    async #askSession(refreshed: boolean): Promise<void> {
        let session: SessionResponse;
        try {
            session = await this.#deps.callables.call('admin.session', {});
        } catch (error) {
            await this.#sessionFailed(detailsOf(error));
            return;
        }
        if (session.refreshToken && !refreshed) {
            await this.#refresh();
            await this.#askSession(true);
            return;
        }
        await this.#applySession(session);
    }

    async #applySession(session: SessionResponse): Promise<void> {
        if (session.admin) {
            this.#set({ auth: 'admin', mode: 'normal', role: session.role, busy: false, gate: NO_GATE, ...this.#deps.cities?.(session) });
        } else if (this.#contributing()) {
            // M13 §3: the Contribute page is for any signed-in account (no refusal, the session stays); a map nobody
            // set up yet is not open to contributions, and the claim is never offered there.
            this.#set({
                auth: session.ownerClaimed ? 'visitor' : 'contributeClosed',
                mode: 'normal',
                role: null,
                busy: false,
                gate: NO_GATE,
            });
        } else {
            await this.#notAnAdmin(session);
        }
    }

    async #notAnAdmin(session: SessionResponse): Promise<void> {
        if (!session.ownerClaimed) {
            await this.#claimOrWait();
        } else if (session.invitePending) {
            this.#set({ auth: 'joinPending', busy: false });
        } else {
            this.#notAdmin(null);
        }
    }

    /** The map has no owner: claim at once with a live read-only token, else wait for the click (§3.3 d2). */
    async #claimOrWait(): Promise<void> {
        const access = this.#deps.google.live('cloudReadOnly');
        if (access === null) {
            this.#set({ auth: 'claimPending', busy: false });
            return;
        }
        await this.#runClaim(access.token);
    }

    async #runClaim(token: string): Promise<void> {
        this.#set({ auth: 'claiming', busy: false, gate: NO_GATE });
        try {
            await this.#deps.callables.call('admin.claim', { googleAccessToken: token });
        } catch (error) {
            this.#claimRefused(detailsOf(error));
            return;
        }
        await this.#refresh();
        await this.#askSession(true);
    }

    #claimRefused(details: ApiErrorDetails): void {
        if (details.code === 'apiError.claim.alreadyClaimed') {
            this.#notAdmin(details);
            return;
        }
        this.#deps.google.drop();
        this.#set({ auth: 'claimPending', gate: this.#gate(details) });
    }

    /**
     * A session the server did not give: a retryable failure is a server problem, anything else a refusal. A server older
     * than the admin (its answer in an older shape, finding 27 of 2026-10-31) cannot say who is an admin: Google's verdict
     * decides, as in start-up mode, so its owner reaches Setup and Update the map. M13 §3: on the Contribute page every
     * failure is the contributor's Try again, with its reason unless that reason speaks to the admin (an outdated server).
     */
    async #sessionFailed(details: ApiErrorDetails): Promise<void> {
        if (this.#contributing()) {
            const gate = details.code === 'apiError.serverOutdated' ? NO_GATE : this.#gate(details);
            this.#set({ auth: 'backendDown', busy: false, gate });
            return;
        }
        if (details.code === 'apiError.serverOutdated') {
            await this.#classify();
            return;
        }
        if (API_ERRORS[details.code].retryable) {
            this.#set({ auth: 'backendDown', busy: false, gate: this.#gate(details) });
            return;
        }
        this.#notAdmin(details);
    }

    /**
     * Not an admin (S-A01-BAD-STRANGER): the panel says so and the Firebase session ends at once; an admin whose access
     * was removed while editing keeps the page, read-only, until sign-out (S-A20-BAD-REVOKED-WHILE-EDITING).
     */
    #notAdmin(details: ApiErrorDetails | null): void {
        if (this.#deps.shell.get().auth === 'admin' && this.#deps.unsaved?.() === true) {
            this.#deps.log.warn('access removed while editing: the page stays read-only until sign-out');
            this.#set({ revoked: true, busy: false });
            return;
        }
        this.#set({ auth: 'notAdmin', role: null, busy: false, gate: details === null ? NO_GATE : this.#gate(details) });
        this.#deps.auth.signOut().catch((error: unknown) => {
            this.#deps.log.warn('sign-out after refusal failed', { error: String(error) });
        });
    }

    /** Google's verdict in start-up mode; without a live read-only token the sign-in asks again. */
    async #classify(): Promise<void> {
        const access = this.#deps.google.live('cloudReadOnly');
        const verdict: OwnershipVerdict = access === null ? { kind: 'expired' } : await this.#deps.ownership(access.token);
        const gate: AdminGate = { ...NO_GATE, reconsent: verdict.kind === 'expired' };
        if (verdict.kind === 'expired') {
            this.#deps.google.drop();
        }
        const disabled = verdict.kind === 'apiDisabled' ? verdict.api : null;
        const issue = disabled === null ? null : this.#deps.shell.notice({ key: 'apiError.cloud.apiDisabled', params: { api: disabled } });
        this.#set({ ...VERDICT_STATES[verdict.kind], gate: { ...gate, issue, enableApi: disabled } });
    }

    async #refresh(): Promise<void> {
        try {
            await this.#deps.auth.refreshIdToken();
        } catch (error) {
            this.#deps.log.warn('ID token refresh failed', { error: String(error) });
        }
    }

    #refused(notice: NoticeInput): void {
        this.#set({ busy: false, gate: { ...this.#deps.shell.get().gate, issue: this.#deps.shell.notice(notice) } });
    }

    #gate(details: ApiErrorDetails): AdminGate {
        return { ...NO_GATE, issue: this.#deps.shell.notice(noticeFrom(details)) };
    }

    #set(patch: Partial<ShellState>): void {
        this.#deps.shell.update(patch);
    }
}
