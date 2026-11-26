/**
 * The world every `setup.*` test runs in: the real fn-setup adapters (Secret Manager, Mapbox, USGS M2M, Firebase
 * Management) over the fake upstreams of `@hcm/test-support/fakes`, so a handler test also proves what reaches Google,
 * Mapbox and USGS; the in-memory Firestore, Storage and Cloud Tasks fakes of `functions/test/support/`; a fixed clock
 * and a recording logger. Nothing reaches a network or an emulator.
 */
import {
    FIRESTORE_PATHS,
    createLogger,
    setupStatusDocSchema,
    timestampFromDate,
    type ListGroupsRequest,
    type LogRecord,
    type SetupStatusDoc,
} from '@hcm/shared';
import { createRecordingSink } from '@hcm/test-support';
import { createUpstreamFakes, type UpstreamFakes } from '@hcm/test-support/fakes';
import type { CallableRequest } from 'firebase-functions/https';

import { createFirebaseManagement } from '../../src/adapters/firebase-management.js';
import { createMapboxApi } from '../../src/adapters/mapbox.js';
import { createSecretManagerStore } from '../../src/adapters/secret-manager.js';
import { createUsgsApi } from '../../src/adapters/usgs.js';
import { createVertexAi } from '../../src/adapters/vertex-ai.js';
import type { Caller, CallerToken, VerifiedCaller } from '../../src/api/access.js';
import { answerProbe } from '../../src/ops/probe.js';
import type { ErrorReporter } from '../../src/ports/error-reporter.js';
import type { RuntimeConfig } from '../../src/ports/runtime-config.js';
import type { SetupDeps } from '../../src/setup/index.js';
import { createFakeDocumentStore } from '../support/documents.js';
import { NOW, fakeAdmins } from '../support/fakes.js';
import { createFakeBlobStore, createFakeTaskQueue } from '../support/platform.js';

export { NOW };

const ADMIN_UID = 'u-setup-admin';
export const CITY = 'bucharest';
export const VIEWER_ORIGINS = ['https://ventura8.github.io'];
export const ADMIN_ORIGINS = ['https://demo-hcm.web.app', 'https://demo-hcm.firebaseapp.com'];

const CONFIG: RuntimeConfig = {
    projectId: 'demo-hcm',
    region: 'us-central1',
    buckets: { private: 'demo-hcm.firebasestorage.app', public: 'demo-hcm-public' },
    viewerOrigins: VIEWER_ORIGINS,
    adminOrigins: ADMIN_ORIGINS,
    adminUrl: 'https://demo-hcm.web.app/',
    oauthClientIds: ['123456789012-e2eclient.apps.googleusercontent.com'],
    errorEndpoint: 'https://us-central1-demo-hcm.cloudfunctions.net/telemetry-reportError',
    appCheck: 'monitor',
};

/** The admin a handler acts for. */
export const ADMIN: VerifiedCaller = { uid: ADMIN_UID, email: 'admin@e2e.test', claim: true };

/** A scripted Error Reporting port: `listGroups` answers `groups`, or rejects with `failure`. */
interface FakeErrors extends ErrorReporter {
    readonly requests: ListGroupsRequest[];
    failure: Error | undefined;
}

function fakeErrors(): FakeErrors {
    const errors: FakeErrors = {
        requests: [],
        failure: undefined,
        report: () => undefined,
        listGroups: (request) => {
            errors.requests.push(request);
            return errors.failure === undefined ? Promise.resolve({ groups: [] }) : Promise.reject(errors.failure);
        },
    };
    return errors;
}

/** Answers one upstream call differently (undefined: the fake upstream answers it). */
type Intercept = (method: string, url: URL) => Response | undefined;

export interface World {
    readonly deps: SetupDeps;
    /**
     * M6: whether Eventarc delivers `ops/probe` to `ops.onProbe` (true by default); false is the project of finding 17,
     * whose event functions' account lacked `roles/run.invoker`. A delivery happens while the self-test waits.
     */
    deliverEvents: boolean;
    /** How many times the self-test waited for the probe's answer. */
    readonly waits: number;
    /** Consulted before the fake upstreams for every outside call. */
    intercept: Intercept | undefined;
    readonly upstream: UpstreamFakes;
    readonly documents: ReturnType<typeof createFakeDocumentStore>;
    readonly blobs: ReturnType<typeof createFakeBlobStore>;
    readonly tasks: ReturnType<typeof createFakeTaskQueue>;
    readonly errors: FakeErrors;
    readonly records: readonly LogRecord[];
    /** The stored `setup/status` (validated), or undefined. */
    status(): SetupStatusDoc | undefined;
    /** Every log line as one string (to prove what never appears in one). */
    logged(): string;
}

export interface WorldOptions {
    /** Secret Manager has the four secrets (the Provision cloud step ran); true by default. */
    readonly provisioned?: boolean;
    /** Seed `cities/bucharest`; true by default. */
    readonly city?: boolean;
}

/** A city document as the admin's settings write it. */
export function cityDoc(overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
    return {
        name: { ro: 'București', en: 'Bucharest' },
        bounds: { west: 25.9, south: 44.3, east: 26.3, north: 44.6 },
        published: true,
        updatedBy: ADMIN_UID,
        updatedAt: timestampFromDate(new Date(NOW)),
        ...overrides,
    };
}

export function createWorld(options: WorldOptions = {}): World {
    const upstream = createUpstreamFakes();
    if (options.provisioned !== false) {
        upstream.scenario('secret-manager.provisioned');
    }
    const documents = createFakeDocumentStore();
    if (options.city !== false) {
        documents.seed(FIRESTORE_PATHS.city(CITY), cityDoc());
    }
    const recording = createRecordingSink();
    const log = createLogger('functions', { sink: recording.sink, minLevel: 'debug' });
    // While the self-test waits, Eventarc delivers its probe to ops.onProbe (when the world says it does).
    let waits = 0;
    const clock = {
        now: () => new Date(NOW),
        sleep: async () => {
            waits += 1;
            if (world.deliverEvents) {
                await answerProbe({ log, clock, documents });
            }
        },
    };
    const blobs = createFakeBlobStore();
    const tasks = createFakeTaskQueue();
    const errors = fakeErrors();
    const tokens = { accessToken: () => Promise.resolve('e2e-service-account-token') };
    const intercepted: typeof fetch = async (input, init) => {
        const request = new Request(input, init);
        return world.intercept?.(request.method, new URL(request.url)) ?? upstream.fetch(input, init);
    };
    const deps: SetupDeps = {
        log,
        clock,
        config: CONFIG,
        documents,
        admins: fakeAdmins([ADMIN_UID]),
        setup: {
            readStatus: () => Promise.resolve(documents.peek(FIRESTORE_PATHS.setupStatus) as Readonly<Record<string, unknown>> | undefined),
        },
        secrets: createSecretManagerStore({ projectId: CONFIG.projectId, tokens, fetch: intercepted, clock, log, ttlMs: 300_000 }),
        mapbox: createMapboxApi({ fetch: intercepted }),
        usgs: createUsgsApi({ fetch: intercepted, log }),
        firebase: createFirebaseManagement({ tokens, fetch: intercepted }),
        blobs: blobs.blobs,
        tasks: tasks.queue,
        errors,
        // M4 (CR-M4-5): the self-test's `ai` check asks the fake Vertex AI's `countTokens`.
        translator: createVertexAi({ projectId: CONFIG.projectId, tokens, fetch: intercepted }),
    };
    const world: World = {
        deps,
        intercept: undefined,
        deliverEvents: true,
        get waits() {
            return waits;
        },
        upstream,
        documents,
        blobs,
        tasks,
        errors,
        records: recording.records,
        status: () => {
            const stored = documents.peek(FIRESTORE_PATHS.setupStatus);
            return stored === undefined ? undefined : setupStatusDocSchema.parse(stored);
        },
        logged: () => JSON.stringify(recording.records),
    };
    return world;
}

/** A verified Google admin's ID token claims; override one to build each bad case. */
export function adminToken(overrides: Partial<CallerToken> = {}): CallerToken {
    return { email: 'admin@e2e.test', email_verified: true, admin: true, firebase: { sign_in_provider: 'google.com' }, ...overrides };
}

/** What firebase-functions hands a callable's `.run()` (`null`: an anonymous caller). */
export function callableRequest(data: unknown, auth: Caller | null = { uid: ADMIN_UID, token: adminToken() }): CallableRequest<unknown> {
    const base = { data, rawRequest: {} as CallableRequest['rawRequest'], acceptsStreaming: false };
    return (auth === null ? base : { ...base, auth: { ...auth, rawToken: 'e2e-id-token' } }) as CallableRequest<unknown>;
}

/** The rejection of `promise` (fails the test when it resolves). */
export async function rejection(promise: Promise<unknown>): Promise<unknown> {
    try {
        await promise;
    } catch (error) {
        return error;
    }
    throw new Error('expected a rejection');
}
