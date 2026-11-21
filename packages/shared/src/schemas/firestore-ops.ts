/**
 * Firestore operational documents (PLAN → Data; security review §1.2, §3.3, §3.4, §4): raster jobs and their logs,
 * harvested USGS scenes, the non-secret setup health `setup/status`, admins and invitations, the Mapbox usage
 * counters, the budget guard and the state of each city's manifest build. Content documents are in `firestore.ts`,
 * paths in `paths.ts`. No document here ever holds a secret (Secret Manager does) or an e-mail address in clear
 * outside `admins/{uid}` (invitations store `sha256(lowercase email)` as their id only).
 */
import { z } from 'zod';

import { apiErrorCodeSchema, apiErrorParamsSchema } from '../api/errors.js';
import { cityRolesSchema } from './city-roles.js';
import { setupInstallSchema } from './install.js';
import { sha256Schema, stamp, timestampSchema, uidSchema } from './firestore-common.js';
import { httpsOriginSchema, mapboxTokenIdSchema } from './firestore.js';
import {
    coded,
    firebaseAppIdsSchema,
    httpsUrlSchema,
    idSchema,
    mapboxPublicTokenSchema,
    measurementIdSchema,
    plainText,
    type ValidationCode,
} from './primitives.js';
import { isValidationCode } from './validation.js';

export { USGS_SCENE_STATUSES, usgsSceneDocSchema, type UsgsSceneDoc } from './usgs-scene.js';

/** The jobs the admin's own screens start; the rules do not list job types, a client never creates a job (imagery callables do). */
export const CLIENT_JOB_TYPES = ['usgs-import', 'geotiff-import', 'regeoref', 'republish'] as const;
/**
 * Every job type: the client's, `layer-delete`, which only `layers.delete` queues (CR-M2c-3), and `layer-join`, which only
 * `imagery.join` queues (M8, `docs/research/M8-join-interfaces.md` §2), and `layer-tiles`, which only `imagery.tick` queues: a version
 * rendered before M12 gets its tiles from its COG (`docs/research/M12-own-tiles.md`). M20 (`docs/research/M20-import-local.md` §4):
 * `archive-series`, one series of a local archive, which only `imagery.archiveImport` queues, always on the owner's computer.
 */
export const JOB_TYPES = [...CLIENT_JOB_TYPES, 'layer-delete', 'layer-join', 'layer-tiles', 'archive-series'] as const;
/** The job state machine of security review §4.1. */
export const JOB_STATUSES = [
    'queued',
    'starting',
    'running',
    'waiting_usgs',
    'mts_processing',
    'awaiting_approval',
    /** M3: the scan is ready but has no georeference (the matcher found too few pairs, or an upload carries none). */
    'awaiting_gcps',
    'succeeded',
    'failed',
    'cancelled',
] as const;
/** The statuses a job never leaves (the rules refuse a cancellation of these). */
export const FINISHED_JOB_STATUSES = ['succeeded', 'failed', 'cancelled'] as const;

/**
 * Review of M18 item 3: an editor placing points on a parked frame marks its job (`JobDoc.placingPoints`, stamped); for this
 * long after the mark `imagery.tick` does not send the frame searching again, which would refuse their Save. The georeferencer
 * marks it again every quarter of it while points are placed.
 */
export const PLACING_POINTS_HOLD_MS = 2 * 60 * 60 * 1000;
/**
 * Why an unfinished job is not running (`docs/research/M3-interfaces.md` §4.2): USGS preparing the download or in
 * maintenance, rate limited, the two-running-jobs cap, the budget guard, the admin's points or approval, the compute-unit
 * guard's choice, a publish deferred to next month, Mapbox processing. M7 (`docs/research/M7-local-worker.md` §3, §4): a job
 * chosen for the owner's computer waiting for a worker to claim it, a cloud run waiting for the admin's OK past Cloud
 * Run's free tier. M8 (`docs/research/M8-join-interfaces.md` §2, §5): a join waiting for its frames; it is born with this
 * reason, so no worker claims it before they are ready. M20 (`docs/research/M20-import-local.md` §1.3): an archive series beyond
 * today's share of new layers, born with `daily`; `imagery.tick` releases it, in the archive's order, as a day's count frees.
 */
export const JOB_WAIT_REASONS = [
    'usgs-preparing',
    'usgs-maintenance',
    'rate-limited',
    'capacity',
    'guard',
    'gcps',
    'approval',
    'compute-units',
    'deferred',
    'mapbox',
    'worker',
    'free-tier',
    'parts',
    'daily',
    // M20 (2026-11-13): an archive series waiting for the computer that has its scanned maps to send a copy of its sheets.
    'archive-copy',
    // 2026-11-13: a job whose stitched film is on the computer that stitched it, waiting for that computer to claim it.
    'film-copy',
] as const;
/** M7 (`docs/research/M7-local-worker.md` §3): where a raster job runs, the owner's computer or Cloud Run. */
export const RUN_PLACES = ['local', 'cloud'] as const;
export type RunPlace = (typeof RUN_PLACES)[number];
/** M7: a city's remembered choice; `auto` is the computer while one of the city's workers was seen lately, else the cloud. */
export const RUN_CHOICES = ['auto', 'local', 'cloud'] as const;
export type RunChoice = (typeof RUN_CHOICES)[number];
/** M7: a local worker's id (`w-` and 16 hex characters, new per process). */
export const WORKER_ID_PATTERN = /^w-[0-9a-f]{16}$/;
export const JOB_STEP_STATES = ['pending', 'running', 'done', 'failed', 'skipped'] as const;
/**
 * The three Cloud Run Job definitions (security review §4.1): `fetch` 1 vCPU / 4 GiB for an import's download phase
 * (`DOWNLOAD_STEPS`, network-bound: finding 56 of 2026-11-01), `std` 4 vCPU / 16 GiB, `xl` 8 vCPU / 32 GiB.
 */
export const JOB_MACHINES = ['fetch', 'std', 'xl'] as const;
export type JobMachine = (typeof JOB_MACHINES)[number];
export const JOB_LOG_LEVELS = ['info', 'warn', 'error'] as const;
/**
 * Where a connected service stands: never configured, waiting for someone outside (USGS M2M approval), verified,
 * rejected on its last check, or not answering (maintenance, 5xx: checked again later).
 */
export const SERVICE_STATES = ['missing', 'pending', 'ok', 'invalid', 'unavailable'] as const;
/** The Setup Assistant's cards, in screen order (`setup/status` has one record per area). */
export const SETUP_AREAS = ['billing', 'provision', 'mapbox', 'usgs', 'analytics', 'crash'] as const;
/**
 * The items of the "Provision cloud" doctor (PLAN Addendum 1, security review §1, §2), in screen order;
 * `docs/research/M2b-interfaces.md` §3.4 says what each one creates and in which order the provisioner runs them.
 * `crash-alerts` (the Cloud Monitoring e-mail channel and alert policy for new crash reports) and `api-key` (the
 * browser API key's referrer restriction) joined in M2b.
 */
export const PROVISION_ITEMS = [
    'apis',
    'service-accounts',
    'iam',
    'buckets',
    // [section server-bugs artifact-registry] M6 (docs/research/M6-interfaces.md §1.6, CR-M6-2): the pipeline's Docker repository.
    'artifact-registry',
    // [end server-bugs artifact-registry]
    'bucket-cors',
    'bucket-lifecycle',
    'secrets',
    'task-queues',
    'scheduler',
    'workload-identity',
    'app-check',
    'budget-alerts',
    'org-policies',
    'crash-alerts',
    'api-key',
    // §210: the admin's own Hosting site and its Firebase Auth domains.
    'admin-site',
] as const;
/**
 * Finding 65 of 2026-11-02: the version of Provision's item set, and the set version in which each item's definition last
 * changed. A release that changes what an item creates bumps `PROVISION_SET_VERSION` and sets that item's entry to it;
 * an update (Update the map, Install) then runs the items changed since the version `setup/status.provision.setVersion`
 * records, in the same click. Version 2 (M7): `artifact-registry`'s public pull of the pipeline image and
 * `bucket-lifecycle`'s 7-day `usgs-raw/`. Version 3 (finding 74 of 2026-11-03): `iam`'s `roles/run.viewer` for
 * `fn-admin@`, whose worker callables read the image the job `raster-pipeline` runs. Version 4 (§203): `apis` turns on
 * `analyticsdata.googleapis.com` for the Statistics view. Version 5 (§210, the admin on its own site): `admin-site` makes
 * the site and its Firebase Auth domains, `app-check`'s key and `api-key`'s referrers allow it, `bucket-cors` its origins.
 */
export const PROVISION_SET_VERSION = 5;
export const PROVISION_CHANGED_IN: Readonly<Record<(typeof PROVISION_ITEMS)[number], number>> = {
    apis: 4,
    'service-accounts': 1,
    iam: 3,
    buckets: 1,
    'artifact-registry': 2,
    'bucket-cors': 5,
    'bucket-lifecycle': 2,
    secrets: 1,
    'task-queues': 1,
    scheduler: 1,
    'workload-identity': 1,
    'app-check': 5,
    'budget-alerts': 1,
    'org-policies': 1,
    'crash-alerts': 1,
    'api-key': 5,
    'admin-site': 5,
};

/** The items whose definition changed since the set version `recorded` (absent: 1, before the set had versions). */
export function provisionDue(recorded: number | undefined): readonly (typeof PROVISION_ITEMS)[number][] {
    const since = recorded ?? 1;
    return PROVISION_ITEMS.filter((id) => PROVISION_CHANGED_IN[id] > since);
}

/** `search` until USGS approves the M2M download role, then `download`. */
export const USGS_ROLES = ['search', 'download'] as const;
export const ADMIN_ROLES = ['owner', 'admin'] as const;
export const GUARD_STATES = ['green', 'red'] as const;
export const GUARD_REASONS = ['budget', 'manual'] as const;
/**
 * The steps of `ops.tick`, in the order it runs them (`docs/research/M2-interfaces.md` → `ops.tick`); M5's `memberships`
 * gives every admin document from before M5 its cities (`docs/research/M5-interfaces.md` §1.2), `exports` expires the
 * static exports past their time (§5.3).
 */
export const OPS_STEPS = [
    'guard',
    'jobs',
    'mts',
    'manifests',
    'health',
    'tokens',
    'invites',
    'users',
    'memberships',
    'exports',
    'sources',
] as const;
export const MANIFEST_BUILD_STATES = ['idle', 'queued', 'building', 'failed'] as const;
/** Entities a manifest build may skip (an invalid document is skipped and flagged, never fails the manifest). */
export const MANIFEST_ENTITIES = ['layer', 'photo', 'poi', 'poiCategory', 'story'] as const;

const stepNameSchema = z.string().regex(/^[a-z][a-z0-9-]{0,39}$/);

/**
 * `cities/{city}/jobs/{job}`: admins may set `cancelRequested` (and, on a parked frame, `placingPoints`); the callables that queue work (`layers.delete`, the M3
 * `imagery.*`), the dispatcher and the raster pipeline own every other field (security review §4.1: lease, heartbeat,
 * idempotent steps; `docs/research/M3-interfaces.md` §4: who writes which field in which status).
 */
export const jobDocSchema = z.strictObject({
    type: z.enum(JOB_TYPES),
    status: z.enum(JOB_STATUSES),
    params: z.record(z.string().max(64), z.unknown()),
    createdBy: uidSchema,
    createdAt: timestampSchema,
    cancelRequested: z.boolean().optional(),
    step: stepNameSchema.optional(),
    progress: z.number().min(0).max(1).optional(),
    retryAt: timestampSchema.optional(),
    dispatchAt: timestampSchema.optional(),
    executionName: z.string().max(500).optional(),
    machine: z.enum(JOB_MACHINES).optional(),
    attempt: z.number().int().min(0).max(10).optional(),
    /**
     * P0-1 (2026-11-14): how many lost local runs (the computer stopped: a power cut or a crash) gave their attempt back
     * (`LOST_RUN_REFUNDS` at most; then a lost run counts as any other attempt).
     */
    lostRuns: z.number().int().min(0).max(10).optional(),
    /**
     * Finding of 2026-11-14 (1923 plan-ghid): the computers whose runs of this job were lost, oldest first. A computer that lost it
     * waits `LOST_HAND_OVER_MS` before it takes it again, so another computer of the owner's takes it first.
     */
    lostOn: z.array(z.string().regex(WORKER_ID_PATTERN)).max(10).optional(),
    /**
     * M3: how many times the publisher started this job's publish (`PUBLISH_MAX_ATTEMPTS`; every delivery of a start task
     * counts, so a publish that keeps failing ends instead of streaming its COG to Mapbox again and again).
     */
    publishAttempts: z.number().int().min(0).max(50).optional(),
    lease: z.strictObject({ owner: z.string().min(1).max(200), until: timestampSchema }).optional(),
    steps: z
        .record(
            stepNameSchema,
            z.strictObject({
                status: z.enum(JOB_STEP_STATES),
                gcsPath: z.string().max(1024).optional(),
                generation: z
                    .string()
                    .regex(/^\d{1,30}$/)
                    .optional(),
                sha256: sha256Schema.optional(),
                /** The output's size; while a transfer runs (the pipeline's `fetch`), the bytes received so far. */
                bytes: z.number().int().min(0).optional(),
                /** While a transfer runs: its announced size, when known (finding 55 of 2026-11-01). */
                totalBytes: z.number().int().min(0).optional(),
                startedAt: timestampSchema.optional(),
                finishedAt: timestampSchema.optional(),
            }),
        )
        .refine((steps) => Object.keys(steps).length <= 30, coded('validation.tooBig'))
        .optional(),
    mapboxJobId: z.string().max(100).optional(),
    /** `code` is an `apiError.*` code from M3 on (`params` fills its message); `message` is the redacted technical detail. */
    error: z.strictObject({ code: z.string().max(64), message: plainText(2000), params: apiErrorParamsSchema.optional() }).optional(),
    /** M3: the layer the job works for (reserved at Import for a new one). */
    layerId: idSchema.optional(),
    /** M3: the layer version it produces (its own id) or publishes (`republish`). */
    versionId: idSchema.optional(),
    /** M3: why an unfinished job is not running. */
    waitReason: z.enum(JOB_WAIT_REASONS).optional(),
    startedAt: timestampSchema.optional(),
    finishedAt: timestampSchema.optional(),
    /** M7 (`docs/research/M7-local-worker.md` §3): where it runs, decided by the dispatcher or the admin (`imagery.runOn`). */
    runOn: z.enum(RUN_PLACES).optional(),
    /** The place that holds this job's files when it was moved after parking for points: the other place cannot read them. */
    filesOn: z.enum(RUN_PLACES).optional(),
    /** M7: the local worker that claimed it last (`worker.claim`); its writes are accepted while it holds the job. */
    worker: z.strictObject({ id: z.string().regex(WORKER_ID_PATTERN), uid: uidSchema, claimedAt: timestampSchema }).optional(),
    /** M7 (§4.3): the admin's OK to run it in the cloud past the month's free tier. */
    freeTierOk: z.strictObject({ by: uidSchema, at: timestampSchema }).optional(),
    /** M7 (§4.2): the `dispatchAt` of the last cloud run counted into `usage/cloudrun-*` (a redelivered event counts nothing). */
    usageCountedAt: timestampSchema.optional(),
    /**
     * Finding 68 of 2026-11-02: when `imagery.tick` found it waiting for the computer `WORKER_WAIT_MINUTES` with no computer
     * seen (its page offers Run in Google Cloud instead; an inbox item `job.noWorker` was left once).
     */
    workerOverdueAt: timestampSchema.optional(),
    /**
     * M18 item 3 (`docs/research/M18-improvements.md`): the pipeline image (`sha256:…`) a frame parked for points was searched
     * with, as `imagery.tick` first saw it; once another image is installed the tick asks Locate again by itself, once.
     */
    searchedWith: z
        .string()
        .regex(/^sha256:[0-9a-f]{64}$/)
        .optional(),
    /**
     * Review of M18 item 3: an editor is placing points on this parked frame (the georeferencer's mark, with its `updatedAt`);
     * within `PLACING_POINTS_HOLD_MS` of it the tick leaves the frame waiting. The only other field a client writes.
     */
    placingPoints: z.literal(true).optional(),
    /**
     * M20 (`docs/research/M20-import-local.md` §1.1): the job's files exist only on the owner's computer (a local archive), so
     * `imagery.runOn` refuses to move it to the cloud (`apiError.imagery.localOnly`).
     */
    localOnly: z.literal(true).optional(),
    /**
     * M20 (§1.3): the moment the job counted against the day's new layers, when that is not its `createdAt`: an archive series
     * born waiting (`daily`) counts on the day `imagery.tick` releases it; one still waiting has none and counts nothing yet.
     */
    countedAt: timestampSchema.optional(),
    /**
     * M20 (live report of 2026-11-13; `docs/research/M20-import-local.md` §4.1): the copy of the series' sheets that the computer
     * holding the archive put in the bucket for another worker (`tmp/archive-copies/`, deleted after a day): who sent it, when,
     * how many bytes.
     */
    archiveCopy: z
        .strictObject({ by: z.string().regex(WORKER_ID_PATTERN), at: timestampSchema, bytes: z.number().int().min(0) })
        .optional(),
    /** M20: how often a worker without the sheets handed the job back (no attempt spent); at `ARCHIVE_RETURNS_MAX` it fails. */
    archiveReturns: z.number().int().min(0).optional(),
    /**
     * Pause (the owner's request of 2026-11-13; `imagery.pause`): the owner paused the job. A queued one is claimed and dispatched by
     * nobody; a starting or running one stops at its next step boundary and goes back to `queued` with the step it stopped before
     * (`runner.py`). `inRun`: it was in a run when paused, so Resume gives back the attempt that run counted.
     */
    paused: z.strictObject({ by: uidSchema, at: timestampSchema, inRun: z.literal(true).optional() }).optional(),
    /**
     * The computer running this job was paused (`imagery.pause` with a worker): the run stops at its next checkpoint and the worker
     * hands the job back (`worker.end` `released`), queued again without using an attempt.
     */
    releaseRequested: z.literal(true).optional(),
    ...stamp,
});

/**
 * A job's status alone, its other fields left unread (cleanup item 1, 2026-11-14: `worker.claim` answers the status of each job whose
 * scratch folder a computer holds, and one job that no longer passes its schema must not fail the whole answer).
 */
export const jobStatusOnlySchema = z.object({ status: z.enum(JOB_STATUSES) });

/** `cities/{city}/jobs/{job}/logs/{line}` (id: `seq` zero-padded to 6 digits): redacted, at most 500 per job. */
export const jobLogDocSchema = z.strictObject({
    seq: z.number().int().min(0).max(999_999),
    level: z.enum(JOB_LOG_LEVELS),
    step: stepNameSchema.optional(),
    message: plainText(2000),
    ...stamp,
});

/** The health every `setup/status` area shares; `detail` says why, as an error code with its parameters. */
const health = {
    state: z.enum(SERVICE_STATES),
    checkedAt: timestampSchema.optional(),
    detail: apiErrorCodeSchema.optional(),
    params: apiErrorParamsSchema.optional(),
};

const billingStatusSchema = z.strictObject({
    ...health,
    /** `billingAccounts/{account}/budgets/{budget}` of the $5 budget the Setup Assistant created. */
    budgetId: z
        .string()
        .regex(/^billingAccounts\/[A-Z0-9-]{1,40}\/budgets\/[a-z0-9-]{1,64}$/)
        .optional(),
    budgetAmount: z.number().min(0).max(1_000_000).optional(),
    currency: z
        .string()
        .regex(/^[A-Z]{3}$/)
        .optional(),
    // [section setup-ux trial] M6 (docs/research/M6-interfaces.md §3.1, behaviour A60): no Google API says whether an
    // account is a free trial (DECISIONS-for-review.md §67f), so an account that appeared while Setup's billing card
    // waited is recorded as a likely trial from that day; "It is a paid account" records `trialPaidAt` (for good).
    trialSince: timestampSchema.optional(),
    trialPaidAt: timestampSchema.optional(),
    // [end setup-ux trial]
});

const provisionItemSchema = z.strictObject({ id: z.enum(PROVISION_ITEMS), ...health });

const provisionStatusSchema = z.strictObject({
    ...health,
    items: z.array(provisionItemSchema).max(PROVISION_ITEMS.length).optional(),
    /**
     * Finding 65 of 2026-11-02: the version of Provision's item set (`PROVISION_SET_VERSION`) the project was last brought
     * to; an update runs the items changed since (`provisionDue`). Absent: provisioned before the set had versions (1).
     */
    setVersion: z.number().int().min(1).max(1000).optional(),
});

const mapboxStatusSchema = z.strictObject({
    ...health,
    user: z
        .string()
        .regex(/^[a-z0-9_-]{1,64}$/)
        .optional(),
    /** The scopes of the pasted secret token (its value is in Secret Manager only). */
    scopes: z
        .array(z.string().regex(/^[a-z]{1,20}:[a-z]{1,20}$/))
        .max(30)
        .optional(),
    tilesTokenId: mapboxTokenIdSchema.optional(),
    /** The admin's own URL-restricted public token (public by design: it only works from the admin's origins). */
    adminToken: mapboxPublicTokenSchema.optional(),
    adminTokenId: mapboxTokenIdSchema.optional(),
    adminAllowedUrls: z.array(httpsOriginSchema).max(10).optional(),
    /** Replaced public tokens, deleted by `ops.tick` once `retireAt` has passed (security review §1.3: 10 minutes). */
    retiring: z
        .array(z.strictObject({ tokenId: mapboxTokenIdSchema, retireAt: timestampSchema }))
        .max(10)
        .optional(),
});

const usgsStatusSchema = z.strictObject({
    ...health,
    role: z.enum(USGS_ROLES).optional(),
    /** While `pending`, `ops.tick` checks the M2M role again at this time (every 6 hours). */
    nextCheckAt: timestampSchema.optional(),
    /** The application token's expiry when the admin chose one; a reminder comes 14 days before. */
    tokenExpiresAt: timestampSchema.optional(),
    // [section setup-ux postponed] M6 (docs/research/M6-interfaces.md §4.1, behaviour A59): Do it later on the USGS card
    // (gone once a token is saved), and since when a saved token waits for USGS's M2M approval (kept while `pending`).
    postponedAt: timestampSchema.optional(),
    pendingSince: timestampSchema.optional(),
    // [end setup-ux postponed]
});

const analyticsStatusSchema = z.strictObject({
    ...health,
    measurementId: measurementIdSchema.optional(),
    appId: firebaseAppIdsSchema.shape.appId.optional(),
});

const crashStatusSchema = z.strictObject({ ...health, lastReportAt: timestampSchema.optional() });

/**
 * `setup/status`: the non-secret integration health the Setup Assistant shows (one record per `SETUP_AREAS` entry),
 * written by the `setup.*` callables, `ops.tick` and `telemetry.reportError`. Secrets live in Secret Manager only:
 * `secretsRev` is bumped on every secret write so each instance drops its cached values.
 */
export const setupStatusDocSchema = z.strictObject({
    billing: billingStatusSchema.optional(),
    provision: provisionStatusSchema.optional(),
    mapbox: mapboxStatusSchema.optional(),
    usgs: usgsStatusSchema.optional(),
    analytics: analyticsStatusSchema.optional(),
    crash: crashStatusSchema.optional(),
    secretsRev: z.number().int().min(0).optional(),
    // [section install] owner: installer (M6, docs/research/M6-interfaces.md §1.7): `setup.recordCloud`'s `install`.
    install: setupInstallSchema.optional(),
    // [end install]
    ...stamp,
});

export type SetupStatusDoc = z.infer<typeof setupStatusDocSchema>;

/**
 * `admins/{uid}`: written by `admin.claim`, `admin.join`, `admins.revoke` and the bootstrap script only; M5 adds the
 * cities callables (`cities.create`, `admins.setRole`), `admin.session` and `ops.tick` (the migration of `cities`).
 */
export const adminDocSchema = z.strictObject({
    /** `owner`: the account that claimed the project (it creates cities and sets their budgets); `admin`: any other. */
    role: z.enum(ADMIN_ROLES),
    /**
     * M5 (`docs/research/M5-interfaces.md` §1.2): the cities this admin belongs to and the role in each; written by the
     * functions only. A document without it is from before M5: `admin.session` and `ops.tick` give it every existing city
     * (`legacyCityRoles`), and until then the rules and the callables treat it as no membership (fail closed).
     */
    cities: cityRolesSchema.optional(),
    /** From the verified Google ID token, shown in the admins list; deleted with the document (GDPR). */
    email: z.email().max(254).optional(),
    displayName: plainText(200).optional(),
    invitedBy: uidSchema.optional(),
    createdAt: timestampSchema,
    ...stamp,
});

/**
 * `setup/owner`: who claimed the map (`admin.claim`, created once: a second claim finds it). A uid only, never an
 * address; the owner's `admins/{uid}` document says the rest.
 */
export const ownerDocSchema = z.strictObject({
    uid: uidSchema,
    claimedAt: timestampSchema,
    ...stamp,
});

/**
 * `invites/{sha256(lowercase email)}` (`inviteIdFor`): written by `admins.invite`, deleted by `admin.join` (accepted),
 * `admins.revoke` and `ops.tick` (expired). The address itself is never stored.
 */
export const inviteDocSchema = z.strictObject({
    role: z.literal('admin'),
    /**
     * M5: the cities the invitation grants, each with its role (`admins.invite` of a second city adds it here);
     * `admin.join` grants every one. An invitation from before M5 names none and grants the project's role alone.
     */
    cities: cityRolesSchema.optional(),
    invitedBy: uidSchema,
    createdAt: timestampSchema,
    expiresAt: timestampSchema,
    ...stamp,
});

/** `usage/mapbox-YYYY-MM`: the month-to-date Mapbox counters the compute-unit guard reads (security review §3.3). */
export const usageDocSchema = z.strictObject({
    month: z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/),
    computeUnits: z.number().min(0),
    computeUnitBudget: z.number().min(0),
    uploadedMb: z.number().min(0),
    publishes: z.number().int().min(0),
    studioUploads: z.number().int().min(0).optional(),
    /** M7 (`docs/research/M7-local-worker.md` §6): megabytes and publishes through Mapbox's Uploads API this month. */
    uploadsApiMb: z.number().min(0).optional(),
    uploadsApiPublishes: z.number().int().min(0).optional(),
    /**
     * M3: compute units held for publishes under way (by layer version), released or counted when Mapbox answers, so two
     * publishes never both fit in the same remaining budget (`docs/research/M3-interfaces.md` §7.2).
     */
    reservations: z
        .record(
            idSchema,
            z.strictObject({
                computeUnits: z.number().min(0),
                at: timestampSchema,
                /** The publish makes a tileset its layer did not have yet: the tileset cap counts it (CR-M3-47). */
                newTileset: z.boolean().optional(),
            }),
        )
        .refine((held) => Object.keys(held).length <= 50, coded('validation.tooBig'))
        .optional(),
    /** M3: compute units over the budget that an admin chose to pay for this month ("Pay about $X"). */
    overageComputeUnits: z.number().min(0).optional(),
    ...stamp,
});

const tickStepSchema = z.strictObject({ step: z.enum(OPS_STEPS), ok: z.boolean(), detail: apiErrorCodeSchema.optional() });

/**
 * `ops/guard`: `red` pauses raster dispatch, MTS publishes and AI assists, never the public site (security review
 * §3.4); `ops.onBudget` turns it red, an admin turns it green again. `lastTick` is what the last `ops.tick` did.
 */
export const opsGuardDocSchema = z.strictObject({
    state: z.enum(GUARD_STATES),
    reason: z.enum(GUARD_REASONS).optional(),
    since: timestampSchema.optional(),
    /** What the budget alert that turned it red said: the cost so far and the budget, in the billing account's currency. */
    spend: z
        .strictObject({
            costAmount: z.number().min(0),
            budgetAmount: z.number().min(0),
            currency: z
                .string()
                .regex(/^[A-Z]{3}$/)
                .optional(),
            /** The budget period the alert counts (`costIntervalStart`). */
            interval: z.string().max(40).optional(),
        })
        .optional(),
    /** Who turned it green again (`imagery.resumeGuard`), when, and the budget period whose spend they accepted. */
    resumedBy: uidSchema.optional(),
    resumedAt: timestampSchema.optional(),
    resumedFor: z.string().max(40).optional(),
    lastTick: z.strictObject({ ranAt: timestampSchema, steps: z.array(tickStepSchema).max(OPS_STEPS.length) }).optional(),
    lastNightlyAt: timestampSchema.optional(),
    ...stamp,
});

/**
 * `ops/dispatch`: the Cloud Run executions the dispatcher handed out (CR-M3-47), one slot per job that holds one, read
 * and written in the same transaction that moves a job to `starting`, so two dispatchers never both take the last place
 * of `RUNNING_JOBS_MAX`. A slot whose job no longer holds an execution is dropped by the next dispatch.
 */
export const opsDispatchDocSchema = z.strictObject({
    slots: z
        .record(z.string().regex(/^[a-z0-9-]{1,40}\/[A-Za-z0-9_-]{1,40}$/), z.strictObject({ at: timestampSchema }))
        .refine((slots) => Object.keys(slots).length <= 20, coded('validation.tooBig')),
    ...stamp,
});

// [section server-bugs probe]
/** A probe's nonce: 32 lowercase hex digits (16 random bytes). */
const probeNonceSchema = z.string().regex(/^[a-f0-9]{32}$/);

/**
 * `ops/probe` (M6, finding 17 of `docs/research/manual-test-2026-10-25.md`; `docs/research/M6-interfaces.md` §3.2): the
 * self-test's `events` check writes a fresh `nonce`, and `ops.onProbe`, a Firestore trigger that Eventarc delivers with
 * `fn-events@`, copies it to `receivedNonce`. Its nonce coming back proves the events reach the server. Written by the
 * functions only (`system:ops`); no client reads it.
 */
export const opsProbeDocSchema = z.strictObject({
    nonce: probeNonceSchema,
    requestedAt: timestampSchema,
    receivedNonce: probeNonceSchema.optional(),
    receivedAt: timestampSchema.optional(),
    ...stamp,
});
// [end server-bugs probe]

const skippedDocumentSchema = z.strictObject({
    entity: z.enum(MANIFEST_ENTITIES),
    id: idSchema,
    code: z.custom<ValidationCode>((value) => typeof value === 'string' && isValidationCode(value), coded('validation.value')),
    path: z.string().max(200),
});

/**
 * `manifests/{city}`: the city's manifest builds (security review §4.5). Triggers bump `requestedVersion`; the
 * serialized builder records what it published. Admins read it (the "Published" chip); only the builder writes it.
 */
export const manifestStateDocSchema = z.strictObject({
    requestedVersion: z.number().int().min(0),
    builtVersion: z.number().int().min(0),
    status: z.enum(MANIFEST_BUILD_STATES),
    builtAt: timestampSchema.optional(),
    url: httpsUrlSchema.optional(),
    sha256: sha256Schema.optional(),
    bytes: z.number().int().min(0).optional(),
    counts: z
        .strictObject({
            layers: z.number().int().min(0),
            photos: z.number().int().min(0),
            /** M13: photos in the "Where was this taken?" gallery; absent from a build before it. */
            unplaced: z.number().int().min(0).optional(),
            pois: z.number().int().min(0),
            poiCategories: z.number().int().min(0),
            /** M17: the stories listed; absent from a build before it. */
            stories: z.number().int().min(0).optional(),
        })
        .optional(),
    skipped: z.array(skippedDocumentSchema).max(100).optional(),
    error: apiErrorCodeSchema.optional(),
    ...stamp,
});

export type JobDoc = z.infer<typeof jobDocSchema>;
export type JobLogDoc = z.infer<typeof jobLogDocSchema>;
export type AdminDoc = z.infer<typeof adminDocSchema>;
export type InviteDoc = z.infer<typeof inviteDocSchema>;
export type OwnerDoc = z.infer<typeof ownerDocSchema>;
export type UsageDoc = z.infer<typeof usageDocSchema>;
export type OpsGuardDoc = z.infer<typeof opsGuardDocSchema>;
export type OpsDispatchDoc = z.infer<typeof opsDispatchDocSchema>;
export type OpsProbeDoc = z.infer<typeof opsProbeDocSchema>;
export type ManifestStateDoc = z.infer<typeof manifestStateDocSchema>;
export type JobStatus = (typeof JOB_STATUSES)[number];
export type JobType = (typeof JOB_TYPES)[number];
export type JobWaitReason = (typeof JOB_WAIT_REASONS)[number];
export type ServiceState = (typeof SERVICE_STATES)[number];
export type SetupArea = (typeof SETUP_AREAS)[number];
export type ProvisionItem = (typeof PROVISION_ITEMS)[number];
export type AdminRole = (typeof ADMIN_ROLES)[number];
export type UsgsRole = (typeof USGS_ROLES)[number];
export type OpsStep = (typeof OPS_STEPS)[number];
