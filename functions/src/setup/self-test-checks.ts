import { randomBytes } from 'node:crypto';

import {
    FIRESTORE_PATHS,
    MANIFEST_DEBOUNCE_SECONDS,
    MANIFEST_QUEUE,
    cityDocSchema,
    manifestStateDocSchema,
    manifestTaskId,
    opsProbeDocSchema,
    systemWriter,
    timestampFromDate,
    type ApiErrorCode,
    type ManifestStateDoc,
    type SelfTestCheck,
    type ServiceState,
} from '@hcm/shared';

import { ApiError } from '../api/api-error.js';
import { withOfferedModel } from '../api/vertex-models.js';
import type { BlobStore } from '../ports/blob-store.js';
import type { Ports } from '../ports/index.js';
import type { SecretName } from '../ports/secret-store.js';
import { MAPBOX_FAILURES, ROLES, SECRET_FAILURES, TRANSIENT, refusal, upstream, viaCloud } from './failures.js';
import { readSetupStatus } from './records.js';
import { checkUsgs, type UsgsOutcome } from './usgs-check.js';

/**
 * The checks of `setup.selfTest` (`SELF_TEST_CHECKS`, M2-interfaces §3.3): one real, minimal, harmless operation each,
 * with the functions' own service account, so a missing role, a disabled API or a revoked credential shows up on the
 * card it belongs to. A check resolves to its result or throws an `ApiError` (the runner records it).
 */
export type SelfTestDeps = Pick<
    Ports,
    'documents' | 'secrets' | 'blobs' | 'tasks' | 'mapbox' | 'usgs' | 'firebase' | 'errors' | 'clock' | 'config' | 'log' | 'translator'
>;

export interface CheckResult {
    readonly state: ServiceState;
    readonly detail?: ApiErrorCode;
    readonly params?: Readonly<Record<string, string>>;
    /** The USGS check's outcome (role and next check), kept for the `usgs` record. */
    readonly usgs?: UsgsOutcome;
}

/** Who runs the self-test, and when (its writes are stamped with the caller). */
export interface CheckContext {
    readonly uid: string;
    readonly now: Date;
}

type Check = (deps: SelfTestDeps, context: CheckContext) => Promise<CheckResult>;
type BucketRole = Parameters<BlobStore['write']>[0];

const OK: CheckResult = { state: 'ok' };
const SECRET_NAMES: readonly SecretName[] = ['mapbox-sk-bootstrap', 'mapbox-sk-tiles', 'usgs-username', 'usgs-app-token'];
const PROBE = new TextEncoder().encode('historic-city-map self-test');
const ERROR_REPORTING_TRANSIENT = {
    ...TRANSIENT,
    unavailable: ['apiError.errorReporting.unavailable'],
    maintenance: ['apiError.errorReporting.unavailable'],
} as const;

async function checkFirestore(deps: SelfTestDeps): Promise<CheckResult> {
    await viaCloud(readSetupStatus(deps.documents), ROLES.datastoreUser, TRANSIENT);
    return OK;
}

/** Every secret read fresh (the cache dropped first): a missing value is fine here, a refused read is not. */
async function checkSecrets(deps: SelfTestDeps): Promise<CheckResult> {
    deps.secrets.invalidate();
    for (const name of SECRET_NAMES) {
        await upstream(deps.secrets.read(name), SECRET_FAILURES);
    }
    return OK;
}

/** Writes and deletes one small object under `tmp/selftest/` (the buckets' lifecycle sweeps `tmp/` anyway). */
async function checkBucket(deps: SelfTestDeps, bucket: BucketRole, context: CheckContext): Promise<CheckResult> {
    const path = `tmp/selftest/${String(context.now.getTime())}.txt`;
    await viaCloud(deps.blobs.write(bucket, path, PROBE, { contentType: 'text/plain' }), ROLES.storageObjectAdmin, TRANSIENT);
    await viaCloud(deps.blobs.delete(bucket, path), ROLES.storageObjectAdmin, TRANSIENT);
    return OK;
}

/**
 * Requests a manifest rebuild the way the publish triggers do (M2-interfaces §3.5: `requestedVersion` + 1 and
 * `queued` in `manifests/{city}`, then the debounced task): harmless, the builder publishes the same manifest again.
 */
async function requestRebuild(deps: SelfTestDeps, cityId: string, context: CheckContext): Promise<void> {
    const path = FIRESTORE_PATHS.manifestState(cityId);
    const requestedVersion = await deps.documents.transaction(async (transaction) => {
        const current = await transaction.get(path, manifestStateDocSchema);
        const next: ManifestStateDoc = {
            ...(current ?? { builtVersion: 0 }),
            requestedVersion: (current?.requestedVersion ?? 0) + 1,
            status: 'queued',
            updatedBy: context.uid,
            updatedAt: timestampFromDate(context.now),
        };
        await transaction.set(path, manifestStateDocSchema, next);
        return next.requestedVersion;
    });
    const task = { id: manifestTaskId(cityId, context.now), delaySeconds: MANIFEST_DEBOUNCE_SECONDS };
    await viaCloud(
        deps.tasks.enqueue(MANIFEST_QUEUE, { cityId, requestedVersion, full: false }, task),
        ROLES.cloudTasksEnqueuer,
        TRANSIENT,
    );
}

/** A rebuild for every city; without a city there is nothing to enqueue yet. */
async function checkTaskQueue(deps: SelfTestDeps, context: CheckContext): Promise<CheckResult> {
    const cities = await deps.documents.query(FIRESTORE_PATHS.cities, cityDocSchema);
    for (const city of cities.documents) {
        await requestRebuild(deps, city.id, context);
    }
    return cities.documents.length === 0 ? { state: 'missing' } : OK;
}

/** How long the `events` check waits for `ops.onProbe`'s answer, and how often it looks (M6-interfaces §3.2). */
export const EVENTS_PROBE_WAIT_MS = 20_000;
const EVENTS_PROBE_POLL_MS = 1_000;
/** What Eventarc, Cloud Scheduler and the task queues need to call the functions (finding 17). */
const INVOKER_ROLE = 'roles/run.invoker';

/** Waits on the clock; a clock that cannot wait (a test's) polls its rounds at once. */
function waitOn(deps: SelfTestDeps): (ms: number) => Promise<void> {
    return deps.clock.sleep ?? (() => Promise.resolve());
}

async function probeAnswered(deps: SelfTestDeps, nonce: string): Promise<boolean> {
    const probe = await viaCloud(deps.documents.get(FIRESTORE_PATHS.opsProbe, opsProbeDocSchema), ROLES.datastoreUser, TRANSIENT);
    return probe?.receivedNonce === nonce;
}

/**
 * M6 (finding 17 of `docs/research/manual-test-2026-10-25.md`; S-A03-HAPPY-EVENTS-REACH, S-A03-BAD-EVENTS-REFUSED):
 * writes `ops/probe` with a fresh nonce and waits for `ops.onProbe`, which Eventarc delivers with `fn-events@`, to send
 * it back. No answer within `EVENTS_PROBE_WAIT_MS` means the events never reach the server, as when the event
 * functions' account lacked `roles/run.invoker`: the emulators skip IAM, so only this check on the real project shows it.
 */
async function checkEvents(deps: SelfTestDeps, context: CheckContext): Promise<CheckResult> {
    const nonce = randomBytes(16).toString('hex');
    const at = timestampFromDate(context.now);
    const probe = { nonce, requestedAt: at, updatedBy: systemWriter('ops'), updatedAt: at };
    await viaCloud(deps.documents.set(FIRESTORE_PATHS.opsProbe, opsProbeDocSchema, probe), ROLES.datastoreUser, TRANSIENT);
    const wait = waitOn(deps);
    for (let waited = 0; waited < EVENTS_PROBE_WAIT_MS; waited += EVENTS_PROBE_POLL_MS) {
        await wait(EVENTS_PROBE_POLL_MS);
        if (await probeAnswered(deps, nonce)) {
            return OK;
        }
    }
    throw new ApiError('apiError.setup.eventsUnreached', { role: INVOKER_ROLE });
}

/** The stored bootstrap token (and the tiles token, when there is one) must still be valid secret tokens. */
async function checkMapbox(deps: SelfTestDeps): Promise<CheckResult> {
    const bootstrap = await upstream(deps.secrets.read('mapbox-sk-bootstrap'), SECRET_FAILURES);
    if (bootstrap === undefined) {
        return { state: 'missing' };
    }
    if ((await upstream(deps.mapbox.retrieveToken(bootstrap), MAPBOX_FAILURES)).usage !== 'sk') {
        throw new ApiError('apiError.mapbox.tokenFormat');
    }
    const tiles = await upstream(deps.secrets.read('mapbox-sk-tiles'), SECRET_FAILURES);
    if (tiles !== undefined) {
        await upstream(deps.mapbox.retrieveToken(tiles), MAPBOX_FAILURES);
    }
    return OK;
}

/** A login, the M2M role and a logout with the stored credentials. */
async function checkUsgsAccount(deps: SelfTestDeps): Promise<CheckResult> {
    const username = await upstream(deps.secrets.read('usgs-username'), SECRET_FAILURES);
    const token = await upstream(deps.secrets.read('usgs-app-token'), SECRET_FAILURES);
    if (username === undefined || token === undefined) {
        return { state: 'missing' };
    }
    const outcome = await checkUsgs(deps.usgs, username, token);
    return 'detail' in outcome ? { state: outcome.state, detail: outcome.detail, usgs: outcome } : { state: outcome.state, usgs: outcome };
}

async function checkFirebaseManagement(deps: SelfTestDeps): Promise<CheckResult> {
    await viaCloud(deps.firebase.listWebApps(deps.config.projectId), ROLES.firebaseViewer, TRANSIENT);
    return OK;
}

async function checkErrorReporting(deps: SelfTestDeps): Promise<CheckResult> {
    await viaCloud(deps.errors.listGroups({ hours: 24, pageSize: 1 }), ROLES.errorReportingViewer, ERROR_REPORTING_TRANSIENT);
    return OK;
}

/** Vertex AI's API, named by a refusal. */
const VERTEX_API = 'aiplatform.googleapis.com';

/**
 * M4 (`docs/research/M4-interfaces.md` §4.4, CR-M4-5; S-A45-HAPPY-SELF-TEST, S-A45-BAD-API-DISABLED): `countTokens` of a
 * word proves the Vertex AI API, `fn-admin@`'s custom role `hcmVertexDrafts` and that Google serves a model, without a
 * charge (never `generateContent`). M6 (finding 20; S-A45-BAD-MODEL-UNAVAILABLE, S-A45-BAD-UPSTREAM-LOGGED): any answer
 * Google refused names its reason (`apiError.cloud.refused`); none is `apiError.internal` any more. §67g (the user's
 * decision of 2026-11-01; S-A45-HAPPY-FALLBACK-MODEL): the models of `VERTEX_MODEL_IDS` are probed in order, the check
 * names the one in use (`params.model`), and a project offered none names every model tried.
 */
async function checkAi(deps: SelfTestDeps, context: CheckContext): Promise<CheckResult> {
    try {
        const offered = withOfferedModel(context.now, (model) => deps.translator.countTokens(model, 'test'));
        const { model } = await viaCloud(offered, ROLES.vertexDrafts, TRANSIENT);
        return { state: 'ok', params: { model } };
    } catch (error) {
        throw refusal(error, VERTEX_API);
    }
}

/** Every check, in the order the card lists them. */
export const CHECKS: Readonly<Record<SelfTestCheck, Check>> = {
    firestore: checkFirestore,
    secrets: checkSecrets,
    'private-bucket': (deps, context) => checkBucket(deps, 'private', context),
    'public-bucket': (deps, context) => checkBucket(deps, 'public', context),
    'task-queue': checkTaskQueue,
    events: checkEvents,
    mapbox: checkMapbox,
    usgs: checkUsgsAccount,
    'firebase-management': checkFirebaseManagement,
    'error-reporting': checkErrorReporting,
    ai: checkAi,
};
