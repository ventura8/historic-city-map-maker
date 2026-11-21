/**
 * The test world of the fn-admin functions (admin, admins, history, telemetry): the real Firestore and Auth adapters
 * on the emulators (`npm test` runs Vitest under `firebase emulators:exec --only auth,firestore,storage`), a fresh
 * named Firestore database per test (test files run in parallel and `setup/owner` is one fixed document), scripted
 * fakes for the Google APIs, a recording logger and a fixed clock. Every value is a generated test value. The tests that
 * use it get the emulator timeouts (60 s per test and hook) from the `functions` project of `vitest.config.ts`.
 */
import { createLogger, type ListGroupsRequest, type ListGroupsResponse, type Logger, type ReportedErrorEvent } from '@hcm/shared';
import { createRecordingSink, type RecordingSink } from '@hcm/test-support';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import type { CallableRequest } from 'firebase-functions/https';

import type { Caller, CallerToken } from '../../src/api/access.js';
import { createAuthAdmin } from '../../src/adapters/auth-admin.js';
import { createDocumentStore } from '../../src/adapters/documents.js';
import { firestoreAdminDirectory } from '../../src/adapters/firestore.js';
import type { AdminDirectory } from '../../src/ports/admin-directory.js';
import type { AuthAdmin } from '../../src/ports/auth-admin.js';
import type { Clock } from '../../src/ports/clock.js';
import type { DocumentStore } from '../../src/ports/documents.js';
import type { ErrorReporter } from '../../src/ports/error-reporter.js';
import { UpstreamError } from '../../src/ports/errors.js';
import type { FirebaseManagement } from '../../src/ports/firebase-management.js';
import type { GoogleIam } from '../../src/ports/google-iam.js';
import type { RuntimeConfig } from '../../src/ports/runtime-config.js';
import { createFakeFirebaseManagement } from '../support/services.js';

const NOW = '2026-10-12T08:30:00.000Z';

/** The emulator's project and the generated values of the runtime configuration (no secret among them). */
export const CONFIG: RuntimeConfig = {
    projectId: 'demo-hcm',
    region: 'us-central1',
    buckets: { private: 'demo-hcm.firebasestorage.app', public: 'demo-hcm-public' },
    viewerOrigins: ['https://viewer.e2e.test'],
    adminOrigins: ['https://demo-hcm.web.app', 'https://demo-hcm.firebaseapp.com'],
    adminUrl: 'https://demo-hcm.web.app/',
    oauthClientIds: ['e2e-web-client.apps.googleusercontent.com'],
    errorEndpoint: 'https://us-central1-demo-hcm.cloudfunctions.net/telemetry-reportError',
    appCheck: 'monitor',
};

function requireEmulators(): void {
    if (!process.env['FIRESTORE_EMULATOR_HOST'] || !process.env['FIREBASE_AUTH_EMULATOR_HOST']) {
        throw new Error('the Firestore and Auth emulators are not running: run `npm test` (Vitest under firebase emulators:exec)');
    }
}

export function fixedClock(iso = NOW): Clock & { set(iso: string): void } {
    let now = new Date(iso);
    return {
        now: () => now,
        set: (next) => {
            now = new Date(next);
        },
    };
}

export interface World {
    readonly db: Firestore;
    readonly sdkAuth: Auth;
    readonly documents: DocumentStore;
    readonly auth: AuthAdmin;
    readonly admins: AdminDirectory;
    readonly clock: ReturnType<typeof fixedClock>;
    readonly config: RuntimeConfig;
    /** Google sign-in's client (`admin.claim` when `config.oauthClientIds` is empty): the fixture client by default. */
    readonly firebase: FirebaseManagement;
    readonly log: Logger;
    readonly recording: RecordingSink;
}

/** One emulator-backed app per test file; each test takes a fresh database from it with {@link newWorld}. */
export interface Emulators {
    readonly app: App;
    newWorld(): World;
    close(): Promise<void>;
}

export function openEmulators(name: string): Emulators {
    requireEmulators();
    const app = initializeApp({ projectId: CONFIG.projectId }, name);
    let databases = 0;
    return {
        app,
        newWorld: () => {
            databases += 1;
            const db = getFirestore(app, `${name}-${String(databases)}`);
            const recording = createRecordingSink();
            return {
                db,
                sdkAuth: getAuth(app),
                documents: createDocumentStore(db),
                auth: createAuthAdmin(getAuth(app)),
                admins: firestoreAdminDirectory(db),
                clock: fixedClock(),
                config: CONFIG,
                firebase: createFakeFirebaseManagement().firebase,
                log: createLogger('functions', { sink: recording.sink, minLevel: 'debug' }),
                recording,
            };
        },
        close: () => deleteApp(app),
    };
}

/** A verified Google account's ID token claims; override one to build each bad case. */
export function googleToken(email: string, overrides: Partial<CallerToken> = {}): CallerToken {
    return { email, email_verified: true, firebase: { sign_in_provider: 'google.com' }, ...overrides };
}

/** What a callable's `.run()` receives (the ID token already verified by firebase-functions). */
export function callableRequest(data: unknown, auth?: Caller): CallableRequest<unknown> {
    const base = { data, rawRequest: {} as CallableRequest['rawRequest'], acceptsStreaming: false };
    return (auth === undefined ? base : { ...base, auth: { ...auth, rawToken: 'e2e-id-token' } }) as CallableRequest<unknown>;
}

/** The failure a callable's `.run()` rejects with: its status and `details`. */
export async function failureOf(promise: Promise<unknown>): Promise<{ readonly code: unknown; readonly details: unknown }> {
    try {
        await promise;
    } catch (error) {
        return error as { code: unknown; details: unknown };
    }
    throw new Error('expected the call to fail');
}

type TokenInfo = Awaited<ReturnType<GoogleIam['tokenInfo']>>;

export interface FakeIam extends GoogleIam {
    /** The calls, without the token: `tokenInfo`, `testProjectPermissions <project> <permissions>`. */
    readonly calls: string[];
}

/** Google's tokeninfo and Resource Manager, scripted: each answer is a value or the `UpstreamError` to throw. */
export function fakeIam(info: TokenInfo | UpstreamError, granted: readonly string[] | UpstreamError = []): FakeIam {
    const calls: string[] = [];
    const answer = <T>(value: T | UpstreamError): Promise<T> =>
        value instanceof UpstreamError ? Promise.reject(value) : Promise.resolve(value);
    return {
        calls,
        tokenInfo: () => {
            calls.push('tokenInfo');
            return answer(info);
        },
        testProjectPermissions: (projectId, _token, permissions) => {
            calls.push(`testProjectPermissions ${projectId} ${permissions.join(',')}`);
            return answer(granted);
        },
    };
}

export interface FakeErrors extends ErrorReporter {
    readonly reports: ReportedErrorEvent[];
    readonly requests: ListGroupsRequest[];
}

/** Error Reporting, scripted: `report` records, `listGroups` answers `groups` or throws it. */
export function fakeErrors(groups: ListGroupsResponse | UpstreamError = { groups: [] }): FakeErrors {
    const reports: ReportedErrorEvent[] = [];
    const requests: ListGroupsRequest[] = [];
    return {
        reports,
        requests,
        report: (event) => {
            reports.push(event);
        },
        listGroups: (request) => {
            requests.push(request);
            return groups instanceof UpstreamError ? Promise.reject(groups) : Promise.resolve(groups);
        },
    };
}

/** Every logged record as one string: a test asserts what never appears in it (a token, an address). */
export function loggedText(recording: RecordingSink): string {
    return JSON.stringify(recording.records);
}

/** Strings in a stable order, for comparing lists whose order does not matter. */
export function sorted(values: Iterable<string>): string[] {
    return [...values].sort((a, b) => a.localeCompare(b));
}

/** The registry's callable names of a family, without the family prefix (`admin.claim` → `claim`). */
export function registryKeys(names: readonly string[], family: string): string[] {
    return names.filter((name) => name.startsWith(`${family}.`)).map((name) => name.slice(family.length + 1));
}
