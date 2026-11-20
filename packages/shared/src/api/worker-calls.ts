/**
 * The local worker's five callables (M7, `docs/research/M7-local-worker.md` §2.4, §2.5): their request and response
 * schemas and their registry rows (`WORKER_CALLABLES`: access `cityEditor`, App Check off, two instances, owner
 * `fn-worker`). The functions and the tests read them through `CALLABLES` (`callables.ts`); the admin, which never calls
 * them, reads `ADMIN_CALLABLES` and the names alone (`CALLABLE_NAMES`), so none of this reaches its bundle.
 */
import { z } from 'zod';

import { idSchema } from '../schemas/primitives.js';
import { cityIdSchema } from '../schemas/paths.js';
import { WORKER_HOST_PATTERN, WORKER_REMOVAL_WHYS, workerAiSchema, workerShareSchema } from '../schemas/worker.js';
import { JOB_STATUSES, WORKER_ID_PATTERN } from '../schemas/firestore-ops.js';
import { ARCHIVE_ID_PATTERN } from '../schemas/imagery-archive.js';
import { workerArchiveReportRequestSchema, workerArchiveReportResponseSchema } from './archive.js';
import { isoTimeSchema } from './common.js';
import type { CallableSpec, WorkerCallableName } from './registry.js';
import {
    ARCHIVE_COPY_MAX_BYTES,
    ARCHIVE_SHARE_IDLE_WHYS,
    WORKER_PAIR_CODE_PATTERN,
    WORKER_PAIR_ID_PATTERN,
    WORKER_URLS_MAX,
    WORKER_USGS_ENDPOINTS,
} from './worker.js';

const workerIdSchema = z.string().regex(WORKER_ID_PATTERN);
/** Cleanup item 1: the most job folders a claim names in `held`. */
const WORKER_HELD_MAX = 200;
const byteCount = z.number().int().min(0);
/** Cleanup item 6: the worker's disk as a claim says it (the worker's document adds when). */
const workerDiskSchema = z.strictObject({ workBytes: byteCount, freeBytes: byteCount, floorBytes: byteCount });
/** The most local archives a claim names (the worker sends its newest ones first). */
const WORKER_ARCHIVES_MAX = 200;
const versionSchema = z.string().regex(/^[0-9A-Za-z.+-]{1,40}$/);
/** A Firestore path the worker names (checked against the job's allow-list on the server, §2.5). */
const documentPathSchema = z.string().regex(/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+){1,5}$/);
/** An object path in the private bucket (checked against the job's allow-list). */
const objectPathSchema = z
    .string()
    .min(1)
    .max(1024)
    .regex(/^[A-Za-z0-9_./-]+$/)
    .refine((path) => !path.split('/').some((part) => part === '' || part === '.' || part === '..'));
/** A document's fields as JSON (timestamps as `{seconds, nanoseconds}`, a removed field as `{__hcmDelete: true}`). */
const fieldsSchema = z.record(z.string().min(1).max(200), z.unknown());
const updateTimeSchema = z.string().regex(/^\d{1,20}\.\d{9}$/);

const workerJobFields = { cityId: cityIdSchema, workerId: workerIdSchema, jobId: idSchema };

/** The pipeline image's digest (`sha256:<64 hex>`). */
const digestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);
/**
 * `worker.hello`: the worker introduces itself (recorded in `cities/{city}/workers/{workerId}`). Finding 72: a worker the
 * starter's supervisor runs names the image it runs (`image`), which is compared with the installed one.
 */
export const workerHelloRequestSchema = z.strictObject({
    cityId: cityIdSchema,
    workerId: workerIdSchema,
    version: versionSchema,
    image: digestSchema.optional(),
    /** Its local AI's state (M10): said again whenever it changes. */
    ai: workerAiSchema.optional(),
    /** W5 (household computers): the computer's own name and the starter's version, as the starter passed them on. */
    host: z
        .strictObject({
            name: z.string().regex(WORKER_HOST_PATTERN).optional(),
            os: z.enum(['linux', 'mac', 'windows']).optional(),
            starter: z
                .string()
                .regex(/^[0-9a-f]{12}$/)
                .optional(),
        })
        .optional(),
});
export const workerHelloResponseSchema = z.strictObject({
    pollSeconds: z.number().int().min(1),
    /** The longest wait between two claims of a worker idle for a while; a worker older than it asks every `pollSeconds`. */
    idlePollSeconds: z.number().int().min(1).optional(),
    heartbeatSeconds: z.number().int().min(1),
    /** The installed pipeline image (`setup/status.install.pipeline.image`), when one is recorded. */
    image: digestSchema.optional(),
    /** A paired worker whose image is not the installed one: it claims nothing until it runs the new command. */
    outdated: z.boolean().optional(),
});

/**
 * `worker.claim`: the oldest due local job of the city, leased to this worker, or none. `types`: the job types the worker's
 * pipeline runs (an older image leaves a newer type queued for an updated one); absent, every type (a worker before it).
 * Free text of a type's shape, not the enum: a newer worker may name a type this server does not know yet.
 * `archives` (M20, 2026-11-13): the local archives this computer holds whole (its own scans, not copies of a few sheets): a
 * series another worker waits for comes back as `copy`, so this computer sends its sheets through the bucket.
 */
/**
 * Pause from the computer's own page (`localhost:8765`, the owner's request of 2026-11-13): the person there paused or resumed it;
 * the worker sends it with its next `worker.claim` or `worker.end`, and the server records it on the worker (`paused`).
 */
export const workerPauseCommandSchema = z.discriminatedUnion('action', [
    z.strictObject({ action: z.literal('pause'), until: isoTimeSchema.optional() }),
    z.strictObject({ action: z.literal('resume') }),
]);
export type WorkerPauseCommand = z.infer<typeof workerPauseCommandSchema>;

export const workerClaimRequestSchema = z.strictObject({
    cityId: cityIdSchema,
    workerId: workerIdSchema,
    pause: workerPauseCommandSchema.optional(),
    types: z
        .array(z.string().regex(/^[a-z][a-z-]{0,39}$/))
        .max(20)
        .optional(),
    archives: z.array(z.string().regex(ARCHIVE_ID_PATTERN)).max(WORKER_ARCHIVES_MAX).optional(),
    /**
     * M20 §22 (2026-11-14): this worker shares its archives' series from a thread of its own (`worker.archiveCopy` `wanted`), also
     * while it runs a job: its claim is never answered `copy`.
     */
    shares: z.literal(true).optional(),
    /** W5: the computer's share as its governor says it now; a computer whose person is busy leaves jobs to a calm one. */
    share: workerShareSchema.optional(),
    /**
     * W5, Remove this computer: the worker's word on the removal its last claim gave it (`accepted`; `done` once its supervisor
     * cleaned the computer up, after which the server disconnects it; `failed` and why). Such a claim takes no job.
     */
    removal: z
        .strictObject({
            step: z.enum(['accepted', 'done', 'failed']),
            why: z.enum(WORKER_REMOVAL_WHYS).optional(),
            dockerLeft: z.boolean().optional(),
        })
        .optional(),
    /** 2026-11-13: the jobs whose stitched film is on this computer: a job waiting for its film (`film-copy`) is given to it. */
    films: z.array(idSchema).max(WORKER_ARCHIVES_MAX).optional(),
    /**
     * Cleanup item 1 (2026-11-14): the jobs that have a scratch folder (`work/<city>/<job>`) on this computer, sent at most once an
     * hour; the answer's `jobStates` says what became of each, so the worker deletes only a folder no job needs any more.
     */
    held: z.array(idSchema).max(WORKER_HELD_MAX).optional(),
    /**
     * Cleanup item 6: the worker's disk, on every claim: what its folder uses, the free bytes of its disk and the floor under which it
     * takes no job (`lowDisk`).
     */
    disk: workerDiskSchema.optional(),
    /** Cleanup item 6: what the last "Free space now" the admin asked freed on this computer, and when. */
    freed: z.strictObject({ bytes: byteCount, at: isoTimeSchema }).optional(),
});

/** M20: a series another worker can run once its sheets are copied, of an archive the asking worker holds whole. */
const archiveCopyDutySchema = z.strictObject({
    jobId: idSchema,
    archiveId: z.string().regex(ARCHIVE_ID_PATTERN),
    seriesId: z.string().max(40),
});
export const workerClaimResponseSchema = z.strictObject({
    job: z.strictObject({ jobId: idSchema }).nullable(),
    /** M20 (2026-11-13): a series another worker waits for, whose archive this worker holds: send a copy of its sheets first. */
    copy: archiveCopyDutySchema.optional(),
    /** W5: Remove this computer was asked: clean up (with Docker when `docker`, keeping the scanned maps when `keep`), then say done. */
    remove: z.strictObject({ docker: z.boolean(), keep: z.boolean() }).optional(),
    /** W5: paused in the admin's list of computers (no job until Resume). */
    paused: z.boolean().optional(),
    /** W5: this computer's person is busy (or it runs hot) and another computer of the city is free: the job is left to it. */
    yielded: z.boolean().optional(),
    /** True when the worker's image is not the installed one (no job is given to it). */
    outdated: z.boolean().optional(),
    /** Pause (2026-11-13): who paused the computer (the admin or its own page), when, and `until` when it ends on its own. */
    pause: z.strictObject({ by: z.string().min(1).max(128), at: isoTimeSchema, until: isoTimeSchema.optional() }).optional(),
    /** Cleanup item 1: for each job of the claim's `held`, its status now, or `gone` when the job no longer exists. */
    jobStates: z.record(idSchema, z.union([z.enum(JOB_STATUSES), z.literal('gone')])).optional(),
    /** Cleanup item 6: the admin asked this computer to free space now ("Free space now"); it says what it freed with `freed`. */
    freeSpace: z.literal(true).optional(),
    /** Cleanup item 6: no job was given because the computer's disk is below its floor (`disk.freeBytes < disk.floorBytes`). */
    lowDisk: z.literal(true).optional(),
});

/**
 * `worker.pair` (no sign-in, finding 67): the one-time code of the admin's command, exchanged once for a Firebase custom
 * token of the owner who minted it, with the claims `worker: true`, `city` and `pair`. `replaces` is the pairing the
 * worker held before (a new command on the same computer): it is revoked when it is the same owner's, in the same city.
 */
const pairIdSchema = z.string().regex(WORKER_PAIR_ID_PATTERN);
export const workerPairRequestSchema = z.strictObject({
    cityId: cityIdSchema,
    code: z.string().regex(WORKER_PAIR_CODE_PATTERN),
    replaces: pairIdSchema.optional(),
});
export const workerPairResponseSchema = z.strictObject({ token: z.string().min(1).max(4096), pairId: pairIdSchema });

/**
 * `worker.image` (no sign-in, finding 72 of 2026-11-02, M7 §1.5): the installed pipeline image the starter's supervisor
 * pulls and runs, by digest, with its release: since finding 74 of 2026-11-03 the one the job `raster-pipeline` runs, with
 * its label's release, else `setup/status.install.pipeline`; `apiError.notFound` while neither names one. The image is public (Provision's `allUsers` reader of the repository `hcm`), so nothing here is a secret.
 */
export const workerImageRequestSchema = z.strictObject({});
export const workerImageResponseSchema = z.strictObject({
    image: z.string().regex(/^us-central1-docker\.pkg\.dev\/[a-z][a-z0-9-]{4,28}[a-z0-9]\/hcm\/pipeline@sha256:[0-9a-f]{64}$/),
    digest: digestSchema,
    release: z.string().max(64).optional(),
});

/** `worker.step`: one document operation of the claimed job's run (the pipeline's `DocumentStore`). */
export const workerStepOpSchema = z.discriminatedUnion('op', [
    z.strictObject({ op: z.literal('get'), path: documentPathSchema }),
    z.strictObject({ op: z.literal('update'), path: documentPathSchema, fields: fieldsSchema, ifUpdateTime: updateTimeSchema.optional() }),
    z.strictObject({ op: z.literal('create'), path: documentPathSchema, data: fieldsSchema }),
    z.strictObject({ op: z.literal('list'), collection: documentPathSchema }),
]);
export const workerStepRequestSchema = z.strictObject({ ...workerJobFields, request: workerStepOpSchema });
export const workerStepResponseSchema = z.strictObject({
    data: fieldsSchema.nullable().optional(),
    /** The read's update time, `<seconds>.<nanoseconds>`: the compare-and-set of a later `update`. */
    updateTime: updateTimeSchema.nullable().optional(),
    ok: z.boolean().optional(),
    created: z.boolean().optional(),
    ids: z.array(idSchema).max(1000).optional(),
    /** A list of the city's versions (M15): how many it left out because they fail their schema (an older server sends none). */
    skipped: z.number().int().min(0).max(1000).optional(),
});

/** `worker.urls`: signed URLs of the job's objects, or one M2M call made with the server's USGS key. */
export const workerUrlsRequestSchema = z.strictObject({
    ...workerJobFields,
    request: z.discriminatedUnion('kind', [
        z.strictObject({
            kind: z.literal('objects'),
            objects: z
                .array(
                    z.strictObject({
                        path: objectPathSchema,
                        method: z.enum(['GET', 'PUT']),
                        contentType: z
                            .string()
                            .regex(/^[a-z]+\/[a-z0-9.+-]+$/)
                            .optional(),
                    }),
                )
                .min(1)
                .max(WORKER_URLS_MAX),
        }),
        z.strictObject({ kind: z.literal('usgs'), endpoint: z.enum(WORKER_USGS_ENDPOINTS), payload: fieldsSchema }),
    ]),
});
export const workerSignedObjectSchema = z.strictObject({
    path: objectPathSchema,
    url: z.url(),
    /** The method to send (`PUT` on Cloud Storage; the emulator's stand-in answers another). */
    method: z.enum(['GET', 'PUT', 'POST']),
    /** The headers the request must carry (a PUT's signed content type). */
    headers: z.record(z.string().max(100), z.string().max(4096)),
    expiresAt: isoTimeSchema,
    exists: z.boolean(),
    size: z.number().int().min(0).optional(),
    generation: z
        .string()
        .regex(/^\d{1,30}$/)
        .optional(),
    md5: z.string().max(64).optional(),
});
export const workerUrlsResponseSchema = z.strictObject({
    objects: z.array(workerSignedObjectSchema).max(WORKER_URLS_MAX).optional(),
    usgs: z.unknown().optional(),
});

/**
 * `worker.end`: the run is over; a crash outside a step fails the job the worker still holds. `returned` (M20, 2026-11-13): the
 * worker does not hold the job's local archive and hands the job back, queued, without spending an attempt. `released` (Pause this
 * computer, 2026-11-13): the computer was paused; the run stopped at a checkpoint and the job goes back to the queue, its attempt
 * given back.
 */
export const workerEndRequestSchema = z.strictObject({
    ...workerJobFields,
    outcome: z.enum(['done', 'failed', 'returned', 'released']),
    error: z.strictObject({ code: z.string().max(64), message: z.string().max(2000) }).optional(),
    /** The computer's own page paused it during the run (`released` follows): recorded before the job is handed back. */
    pause: workerPauseCommandSchema.optional(),
    /**
     * P1-6 of the resilience audit (2026-11-14): the computer's disk filled up during the run (`released` follows): the job goes back
     * without using an attempt (no fault of the job); the worker claims nothing until it has room (`lowDisk`).
     */
    diskFull: z.literal(true).optional(),
});
export const workerEndResponseSchema = z.strictObject({ status: z.enum(JOB_STATUSES) });

/**
 * `worker.archiveCopy` (M20, live report of 2026-11-13): the computer holding an archive sends a series' sheets for a job another
 * worker waits on. `objects`: signed PUTs (and GETs, to see what is there) of `tmp/archive-copies/{city}/{job}/` files, each
 * a sheet by its SHA-256 or `manifest.json`; `done`: the copy is complete, `bytes` sent, and the job may be claimed again.
 * M20 §22 (2026-11-14): `wanted` (no job) asks which series to share next, from the sharing thread, also while the computer runs a
 * job; `progress` says how far the copy got (the Computers card). Every kind but `wanted` names its job.
 * Day-limit constants: `ARCHIVE_COPY_MAX_BYTES` / `ARCHIVE_SHARE_*` in `worker.ts` (admin-safe).
 */
export const workerArchiveCopyRequestSchema = z.strictObject({
    cityId: cityIdSchema,
    workerId: workerIdSchema,
    jobId: idSchema.optional(),
    copy: z.discriminatedUnion('kind', [
        z.strictObject({
            kind: z.literal('wanted'),
            archives: z.array(z.string().regex(ARCHIVE_ID_PATTERN)).min(1).max(WORKER_ARCHIVES_MAX),
        }),
        z.strictObject({
            kind: z.literal('progress'),
            sentBytes: z.number().int().min(0).max(ARCHIVE_COPY_MAX_BYTES),
            totalBytes: z.number().int().min(0).max(ARCHIVE_COPY_MAX_BYTES),
        }),
        z.strictObject({
            kind: z.literal('objects'),
            objects: z
                .array(
                    z.strictObject({
                        path: objectPathSchema,
                        method: z.enum(['GET', 'PUT']),
                        contentType: z
                            .string()
                            .regex(/^[a-z]+\/[a-z0-9.+-]+$/)
                            .optional(),
                    }),
                )
                .min(1)
                .max(WORKER_URLS_MAX),
        }),
        z.strictObject({ kind: z.literal('done'), bytes: z.number().int().min(0).max(ARCHIVE_COPY_MAX_BYTES) }),
    ]),
});
export const workerArchiveCopyResponseSchema = z.strictObject({
    objects: z.array(workerSignedObjectSchema).max(WORKER_URLS_MAX).optional(),
    status: z.enum(JOB_STATUSES).optional(),
    /** `wanted`: the series to share now, or why none (`idle`); and how many other computers of the city could take it. */
    copy: archiveCopyDutySchema.optional(),
    idle: z.enum(ARCHIVE_SHARE_IDLE_WHYS).optional(),
    computers: z.number().int().min(0).max(1000).optional(),
});

/**
 * A local worker's callable (M7): a city editor's ID token, or the token of a worker paired for the city (`workerToken`),
 * App Check off, two instances at most.
 */
function workerCallable<Request extends z.ZodType, Response extends z.ZodType>(request: Request, response: Response) {
    return { access: 'cityEditor', appCheck: 'off', maxInstances: 2, request, response, owner: 'fn-worker', workerToken: true } as const;
}

/** The worker's rows of the registry, one per name of `WORKER_CALLABLE_NAMES` (no more, no fewer). */
export const WORKER_CALLABLES = {
    'worker.hello': workerCallable(workerHelloRequestSchema, workerHelloResponseSchema),
    'worker.claim': workerCallable(workerClaimRequestSchema, workerClaimResponseSchema),
    'worker.step': workerCallable(workerStepRequestSchema, workerStepResponseSchema),
    'worker.urls': workerCallable(workerUrlsRequestSchema, workerUrlsResponseSchema),
    'worker.end': workerCallable(workerEndRequestSchema, workerEndResponseSchema),
    // M20 (docs/research/M20-import-local.md §2.4): a local archive's scan report; bound to the worker, not to a job.
    'worker.archiveReport': workerCallable(workerArchiveReportRequestSchema, workerArchiveReportResponseSchema),
    // M20 (2026-11-13): a series' sheets copied through the bucket for another worker; bound to a job the computer does not hold.
    'worker.archiveCopy': workerCallable(workerArchiveCopyRequestSchema, workerArchiveCopyResponseSchema),
    // Finding 67: no sign-in; the one-time code is the credential, the attempts are limited per city.
    'worker.pair': {
        access: 'none',
        appCheck: 'off',
        maxInstances: 2,
        request: workerPairRequestSchema,
        response: workerPairResponseSchema,
        owner: 'fn-worker',
    },
    // Finding 72: no sign-in; the starter's supervisor asks which image to run (public, read-only).
    'worker.image': {
        access: 'none',
        appCheck: 'off',
        maxInstances: 2,
        request: workerImageRequestSchema,
        response: workerImageResponseSchema,
        owner: 'fn-worker',
    },
} as const satisfies Readonly<Record<WorkerCallableName, CallableSpec>>;
