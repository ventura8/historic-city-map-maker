// Fakes of the admin's ports for the node tests of the shell (app, auth, routing, state, firebase): each records what it
// was asked and is scripted per test. Never imported by product code.
import {
    apiErrorDetails,
    createLogger,
    type ApiErrorCode,
    type CallableName,
    type CallableRequest,
    type CallableResponse,
    type SessionResponse,
} from '@hcm/shared';
import { createRecordingSink, type RecordingSink } from '@hcm/test-support';
import { FIXTURE_VALUES } from '@hcm/test-support/api-fixtures';

import type { Clock, HashLocation, KeyValueStore, PageVisibility } from '../../src/app/ports.js';
import type { GoogleAccess, GoogleAuthPort, GoogleRequestOptions } from '../../src/auth/google-auth.js';
import {
    CallableFailure,
    type AuthPort,
    type AuthUser,
    type CallablesPort,
    type DocumentData,
    type DocumentsPort,
    type StoragePort,
} from '../../src/firebase/ports.js';
import type { GoogleScope } from '../../src/google/scopes.js';
import { NO_GATE, type ShellState, type ShellStateAccess } from '../../src/state/state.js';

/** The `demo-hcm` web configuration the e2e admin server answers (the API key assembled by the fixtures). */
export const E2E_WEB_CONFIG = {
    projectId: 'demo-hcm',
    appId: String(FIXTURE_VALUES['appId']),
    apiKey: String(FIXTURE_VALUES['apiKey']),
    authDomain: 'demo-hcm.firebaseapp.com',
    messagingSenderId: String(FIXTURE_VALUES['projectNumber']),
    storageBucket: 'demo-hcm.firebasestorage.app',
};

export const OWNER: AuthUser = { uid: 'owner-uid', email: 'owner@e2e.test', displayName: 'Owner' };
export const STRANGER: AuthUser = { uid: 'stranger-uid', email: 'stranger@e2e.test', displayName: null };

/** A recording logger. */
export function testLog(): { readonly log: ReturnType<typeof createLogger>; readonly recording: RecordingSink } {
    const recording = createRecordingSink();
    return { log: createLogger('admin-test', { sink: recording.sink }), recording };
}

/** Resolves once every queued promise callback has run (the controller chains several awaits). */
export async function settle(rounds = 20): Promise<void> {
    for (let round = 0; round < rounds; round += 1) {
        await Promise.resolve();
    }
}

export class FakeClock implements Clock {
    current = 1_760_000_000_000;
    readonly #timers = new Map<number, { readonly at: number; readonly callback: () => void }>();
    #next = 1;

    now(): number {
        return this.current;
    }

    setTimeout(callback: () => void, delayMs: number): number {
        const id = this.#next;
        this.#next += 1;
        this.#timers.set(id, { at: this.current + delayMs, callback });
        return id;
    }

    clearTimeout(handle: unknown): void {
        this.#timers.delete(handle as number);
    }

    /** Moves time on, running every timer that falls due (in order). */
    advance(ms: number): void {
        const end = this.current + ms;
        for (;;) {
            const due = [...this.#timers.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
            if (due === undefined) {
                break;
            }
            this.#timers.delete(due[0]);
            this.current = due[1].at;
            due[1].callback();
        }
        this.current = end;
    }

    get pending(): number {
        return this.#timers.size;
    }
}

export class MemoryStore implements KeyValueStore {
    readonly values = new Map<string, string>();

    get(key: string): string | null {
        return this.values.get(key) ?? null;
    }

    set(key: string, value: string): void {
        this.values.set(key, value);
    }

    remove(key: string): void {
        this.values.delete(key);
    }

    keys(): readonly string[] {
        return [...this.values.keys()];
    }
}

export class FakeLocation implements HashLocation {
    current: string;
    query: string;
    readonly writes: { readonly hash: string; readonly replace: boolean }[] = [];
    readonly #listeners = new Set<(hash: string) => void>();
    reloads = 0;

    constructor(hash = '', search = '') {
        this.current = hash;
        this.query = search;
    }

    hash(): string {
        return this.current;
    }

    setHash(hash: string, replace: boolean): void {
        this.writes.push({ hash, replace });
        this.current = hash;
        if (!replace) {
            this.visit(hash);
        }
    }

    /** The browser navigated (a link, the back button). */
    visit(hash: string): void {
        this.current = hash;
        for (const listener of this.#listeners) {
            listener(hash);
        }
    }

    onHashChange(listener: (hash: string) => void): () => void {
        this.#listeners.add(listener);
        return () => {
            this.#listeners.delete(listener);
        };
    }

    search(): string {
        return this.query;
    }

    page(): string {
        return 'https://demo-hcm.web.app/';
    }

    reload(): void {
        this.reloads += 1;
    }
}

export class FakeVisibility implements PageVisibility {
    shown = true;

    visible(): boolean {
        return this.shown;
    }

    /** The shell itself never watches visibility (the Setup Assistant's polls do): nothing to announce here. */
    onChange(): () => void {
        return () => undefined;
    }
}

export class FakeAuth implements AuthPort {
    user: AuthUser | null = null;
    refreshes = 0;
    signOuts = 0;
    failSignOut = false;
    failRefresh = false;
    readonly #listeners = new Set<(user: AuthUser | null) => void>();

    currentUser(): AuthUser | null {
        return this.user;
    }

    onUserChanged(listener: (user: AuthUser | null) => void): () => void {
        this.#listeners.add(listener);
        const user = this.user;
        queueMicrotask(() => {
            listener(user);
        });
        return () => {
            this.#listeners.delete(listener);
        };
    }

    /** Firebase announces a new user (a sign-in, a sign-out, a revocation). */
    announce(user: AuthUser | null): void {
        this.user = user;
        for (const listener of this.#listeners) {
            listener(user);
        }
    }

    get listening(): number {
        return this.#listeners.size;
    }

    refreshIdToken(): Promise<void> {
        this.refreshes += 1;
        return this.failRefresh ? Promise.reject(new Error('auth/user-token-expired')) : Promise.resolve();
    }

    signOut(): Promise<void> {
        this.signOuts += 1;
        if (this.failSignOut) {
            return Promise.reject(new Error('auth/network-request-failed'));
        }
        this.announce(null);
        return Promise.resolve();
    }
}

type Answer<N extends CallableName> = (request: CallableRequest<N>) => CallableResponse<N> | Promise<CallableResponse<N>>;

/** A callable failure as the SDK adapter reports it. */
export function failure(status: string, code: ApiErrorCode, params?: Readonly<Record<string, string>>): CallableFailure {
    return new CallableFailure(status, apiErrorDetails(code, params));
}

export class FakeCallables implements CallablesPort {
    readonly calls: { readonly name: CallableName; readonly request: unknown; readonly timeoutMs?: number }[] = [];
    readonly #answers = new Map<CallableName, (request: unknown) => unknown>();

    answer<N extends CallableName>(name: N, answer: Answer<N>): void {
        this.#answers.set(name, answer as (request: unknown) => unknown);
    }

    /** Every call of `name` fails with `error`. */
    fail(name: CallableName, error: unknown): void {
        this.#answers.set(name, () => {
            throw error;
        });
    }

    async call<N extends CallableName>(
        name: N,
        request: CallableRequest<N>,
        options: { readonly timeoutMs?: number } = {},
    ): Promise<CallableResponse<N>> {
        this.calls.push({ name, request, ...options });
        const answer = this.#answers.get(name);
        if (answer === undefined) {
            throw failure('internal', 'apiError.internal');
        }
        return (await answer(request)) as CallableResponse<N>;
    }

    named(name: CallableName): number {
        return this.calls.filter((call) => call.name === name).length;
    }
}

/** The server is not deployed: every call fails like a missing function (no CORS headers: `internal`). */
export function undeployed(callables: FakeCallables): void {
    for (const name of ['admin.session', 'admin.claim', 'admin.join'] as const) {
        callables.fail(name, failure('internal', 'apiError.internal'));
    }
}

/** M5: the bundled city, as `admin.session` lists it for its owner and its editors. */
function bucharest(role: 'owner' | 'editor'): Pick<SessionResponse, 'cities' | 'projectOwner'> {
    return { cities: [{ id: 'bucharest', role, name: { ro: 'București', en: 'Bucharest' } }], projectOwner: role === 'owner' };
}

const NO_CITIES = (): Pick<SessionResponse, 'cities' | 'projectOwner'> => ({ cities: [], projectOwner: false });

type SessionName = 'stranger' | 'unclaimed' | 'invited' | 'owner' | 'admin' | 'delayed';

export const SESSION: Readonly<Record<SessionName, SessionResponse>> = {
    stranger: { admin: false, role: null, claim: false, refreshToken: false, ownerClaimed: true, invitePending: false, ...NO_CITIES() },
    unclaimed: { admin: false, role: null, claim: false, refreshToken: false, ownerClaimed: false, invitePending: false, ...NO_CITIES() },
    invited: { admin: false, role: null, claim: false, refreshToken: false, ownerClaimed: true, invitePending: true, ...NO_CITIES() },
    owner: {
        admin: true,
        role: 'owner',
        claim: true,
        refreshToken: false,
        ownerClaimed: true,
        invitePending: false,
        ...bucharest('owner'),
    },
    admin: {
        admin: true,
        role: 'admin',
        claim: true,
        refreshToken: false,
        ownerClaimed: true,
        invitePending: false,
        ...bucharest('editor'),
    },
    delayed: {
        admin: true,
        role: 'owner',
        claim: false,
        refreshToken: true,
        ownerClaimed: true,
        invitePending: false,
        ...bucharest('owner'),
    },
};

/** The server answers: an anonymous probe gets `unauthenticated`, a signed-in session gets `session`. */
export function deployed(callables: FakeCallables, auth: FakeAuth, session: CallableResponse<'admin.session'>): void {
    callables.answer('admin.session', () => {
        if (auth.user === null) {
            throw failure('unauthenticated', 'apiError.unauthenticated');
        }
        return session;
    });
}

export class FakeDocuments implements DocumentsPort {
    readonly data = new Map<string, DocumentData>();
    readonly watchers = new Map<
        string,
        { readonly onNext: (data: DocumentData | null) => void; readonly onError: (code: string) => void }
    >();
    stopped = 0;

    get(path: string): Promise<DocumentData | null> {
        return Promise.resolve(this.data.get(path) ?? null);
    }

    watch(path: string, onNext: (data: DocumentData | null) => void, onError: (code: string) => void): () => void {
        this.watchers.set(path, { onNext, onError });
        onNext(this.data.get(path) ?? null);
        return () => {
            this.stopped += 1;
            this.watchers.delete(path);
        };
    }

    set(path: string, data: DocumentData): Promise<void> {
        this.data.set(path, data);
        return Promise.resolve();
    }

    delete(path: string): Promise<void> {
        this.data.delete(path);
        return Promise.resolve();
    }

    /** The documents directly in `collectionPath` whose fields equal `equals`. */
    query(
        collectionPath: string,
        equals: readonly (readonly [string, unknown])[] = [],
    ): Promise<readonly { readonly id: string; readonly data: DocumentData }[]> {
        const prefix = `${collectionPath}/`;
        const rows = [...this.data.entries()]
            .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
            .filter(([, data]) => equals.every(([field, value]) => data[field] === value))
            .map(([path, data]) => ({ id: path.slice(prefix.length), data }));
        return Promise.resolve(rows);
    }

    serverTimestamp(): unknown {
        return { sentinel: 'serverTimestamp' };
    }
}

export const NO_STORAGE: StoragePort = { upload: () => Promise.resolve() };

/** A Google token as the consent popup grants it. */
export function access(
    scopes: readonly string[],
    expiresAt = 1_760_000_000_000 + 3_600_000,
    token = 'ya29.e2e-owner-access-token',
): GoogleAccess {
    return { token, scopes, expiresAt };
}

export type ScriptedConsent = GoogleAccess | null | Error;

/** Google's popup, scripted: each request takes the next outcome (and signs `user` in, like Firebase's popup). */
export class FakeGoogle implements GoogleAuthPort {
    readonly requests: { readonly scope: GoogleScope | null; readonly options: GoogleRequestOptions }[] = [];
    readonly outcomes: ScriptedConsent[] = [];
    readonly #auth: FakeAuth;
    readonly #user: AuthUser;

    constructor(auth: FakeAuth, user: AuthUser = OWNER) {
        this.#auth = auth;
        this.#user = user;
    }

    request(scope: GoogleScope | null, options: GoogleRequestOptions): Promise<GoogleAccess | null> {
        this.requests.push({ scope, options });
        const outcome = this.outcomes.shift() ?? null;
        if (outcome instanceof Error) {
            return Promise.reject(outcome);
        }
        if (this.#auth.user === null) {
            this.#auth.announce(this.#user);
        }
        return Promise.resolve(outcome);
    }
}

/** The shell's state before anything happened, and an in-memory `ShellStateAccess` over it. */
export function shellStateAccess(overrides: Partial<ShellState> = {}): ShellStateAccess & { readonly notices: number } {
    let state: ShellState = {
        auth: 'starting',
        mode: null,
        user: null,
        role: null,
        busy: false,
        gate: NO_GATE,
        route: { id: 'setup', params: [] },
        destinations: [],
        leaving: null,
        revoked: false,
        newRelease: null,
        people: {},
        unread: null,
        cities: [],
        cityId: null,
        projectOwner: false,
        setupReady: null,
        locale: 'en',
        theme: { mode: 'system', accent: 'device', city: null, preview: null },
        consent: 'unknown',
        analytics: false,
        windowClass: 'compact',
        notice: null,
        projectId: 'demo-hcm',
        authDomain: 'demo-hcm.firebaseapp.com',
        ...overrides,
    };
    let notices = 0;
    return {
        get: () => state,
        update: (patch) => {
            state = { ...state, ...patch };
        },
        notice: (input) => {
            notices += 1;
            return { ...input, id: notices };
        },
        get notices() {
            return notices;
        },
    };
}
