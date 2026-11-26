/**
 * M7 documents (`docs/research/M7-local-worker.md` §2.4, §3, §4.2): a city's local workers, its remembered choice of
 * where raster jobs run, and the month's Cloud Run use (an estimate against the free tier). Written by the functions only;
 * a city's members read the first two, every admin the third (`usage/*`).
 */
import { z } from 'zod';

import { stamp, timestampSchema, uidSchema } from './firestore-common.js';
import { RUN_CHOICES } from './firestore-ops.js';
import { idSchema } from './primitives.js';

const PAIR_ID = /^[0-9a-f]{40}$/;
const digestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);

/** What a worker is doing: waiting for a job, or running one. */
export const WORKER_STATES = ['idle', 'busy'] as const;

/** The local AI on a worker's computer (`docs/research/M10-local-ai.md`): waiting for a frame, getting ready, running, or why not. */
export const WORKER_AI_STATES = ['idle', 'preparing', 'ready', 'unavailable'] as const;

/** Why the local AI is unavailable, in words the panel has (`adminWorker.ai.why.*`). */
export const WORKER_AI_WHYS = ['old-starter', 'arm64', 'disk', 'pull', 'tampered', 'unreachable', 'no-answer', 'garbage'] as const;

/**
 * Pause (the owner's request of 2026-11-13): who paused a computer or a job and when. `by` is the account that asked, or
 * `computer` for a person at the computer itself (its own page, `localhost:8765`); a computer's pause may end on its own (`until`).
 */
export const PAUSED_BY_COMPUTER = 'computer';
export const pausedSchema = z.strictObject({ by: uidSchema, at: timestampSchema, until: timestampSchema.optional() });
export type Paused = z.infer<typeof pausedSchema>;

export const workerAiSchema = z.strictObject({
    state: z.enum(WORKER_AI_STATES),
    device: z.enum(['gpu', 'cpu']).optional(),
    deviceName: z.string().min(1).max(120).optional(),
    why: z.enum(WORKER_AI_WHYS).optional(),
});

const byteCount = z.number().int().min(0);

/** A computer's name as its system says it (`hostname`, `%COMPUTERNAME%`), passed on by the starter (household, W5). */
export const WORKER_HOST_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;
/** The owner's name for a computer in the admin's list (Rename). */
export const WORKER_NAME_MAX = 40;
export const workerNameSchema = z
    .string()
    .trim()
    .min(1)
    .max(WORKER_NAME_MAX)
    .regex(/^[^<>\p{Cc}]+$/u);

/**
 * W5 (household computers, `docs/research/M7-local-worker.md` *Household computers*): the computer's share as its governor
 * last said it with a claim (M26): the profile in force and why, its cores, the threads and memory the worker may use.
 */
export const workerShareSchema = z.strictObject({
    // `WORKER_PROFILES` and `WORKER_PROFILE_WHYS` of api/worker-machine.ts, repeated: importing that module would put the whole
    // machine schema into every chunk that reads a worker document (`packages/shared/test` holds them equal).
    profile: z.enum(['full', 'quiet', 'paused']),
    why: z.enum(['idle', 'user-active', 'others-busy', 'battery', 'thermal', 'gpu-busy', 'owner']),
    cores: z.number().int().min(1).max(1024),
    threads: z.number().int().min(0).max(1024),
    memoryMb: z.number().int().min(0),
});

/**
 * W5: Remove this computer (the owner, 2026-11-13: "clean up first, disconnect second; the user never runs a command"): asked in
 * the admin's list, given to the worker with its next claim, accepted by it (its supervisor then cleans the computer up), and
 * done (the worker's last word, after the cleanup: the server then disconnects it), or failed and why.
 */
export const WORKER_REMOVAL_STEPS = ['asked', 'accepted', 'done', 'failed'] as const;
/** Why a computer could not clean itself up: a worker started by a command has no helper on the host, or a cleanup step failed. */
export const WORKER_REMOVAL_WHYS = ['no-starter', 'cleanup'] as const;
export const workerRemovalSchema = z.strictObject({
    step: z.enum(WORKER_REMOVAL_STEPS),
    askedAt: timestampSchema,
    /** Also remove Docker (or WSL), only where the helper installed it. */
    docker: z.boolean(),
    /** Keep the scanned maps (the local archives) in the worker's folder. */
    keep: z.boolean(),
    why: z.enum(WORKER_REMOVAL_WHYS).optional(),
    /** Docker stays: removing it needs the computer's password (Linux), said with the done. */
    dockerLeft: z.boolean().optional(),
});

/**
 * M20 §22 (2026-11-14): what a computer that holds scanned maps shares with the city's other computers through the bucket:
 * `sending` a series' copy (how far, for how many computers), or stopped for the day (`dayLimit`: `ARCHIVE_SHARE_DAY_BYTES`).
 */
export const WORKER_SHARING_STATES = ['sending', 'done', 'dayLimit'] as const;
export const workerSharingSchema = z.strictObject({
    state: z.enum(WORKER_SHARING_STATES),
    /** The other computers of the city that could take the shared series (connected, seen lately, not paused). */
    computers: z.number().int().min(0).max(1000),
    jobId: idSchema.optional(),
    sentBytes: byteCount,
    totalBytes: byteCount,
    /** The UTC day `dayBytes` counts (YYYY-MM-DD): the bytes this computer shared that day, against `ARCHIVE_SHARE_DAY_BYTES`. */
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    dayBytes: byteCount,
    at: timestampSchema,
});

/** `cities/{city}/workers/{workerId}`: one local worker process, refreshed by `worker.hello` and `worker.claim`. */
export const workerDocSchema = z.strictObject({
    uid: uidSchema,
    version: z.string().regex(/^[0-9A-Za-z.+-]{1,40}$/),
    startedAt: timestampSchema,
    lastSeenAt: timestampSchema,
    state: z.enum(WORKER_STATES),
    jobId: idSchema.optional(),
    lastJob: z.strictObject({ id: idSchema, outcome: z.enum(['done', 'failed']), at: timestampSchema }).optional(),
    /** Finding 67: the pairing it signed in with (absent: a Google sign-in on its local page). */
    pair: z.string().regex(PAIR_ID).optional(),
    /**
     * The pipeline image it runs (finding 72: the one the starter's supervisor names in `worker.hello`, else its pairing's
     * command's), and whether that is no longer the installed one.
     */
    image: digestSchema.optional(),
    outdated: z.boolean().optional(),
    /** Its local AI, as the worker last said through `worker.hello`. */
    ai: workerAiSchema.optional(),
    /** W5: the owner's name for it (Rename), the computer's own name, its starter's version, its governor's share. */
    name: workerNameSchema.optional(),
    host: z.string().regex(WORKER_HOST_PATTERN).optional(),
    os: z.enum(['linux', 'mac', 'windows']).optional(),
    starter: z
        .string()
        .regex(/^[0-9a-f]{12}$/)
        .optional(),
    share: workerShareSchema.optional(),
    /** W5: Pause in the computers' list: the worker is given no job until Resume. */
    pausedAt: timestampSchema.optional(),
    /** W5: Remove this computer, and how far it got. */
    removal: workerRemovalSchema.optional(),
    /** 2026-11-13: the jobs whose stitched film this computer holds, as its last claim said (a job without its film waits for it). */
    films: z.array(idSchema).max(200).optional(),
    /** Disconnect this computer (`worker.revoke`): every later call of this worker is refused. */
    revokedAt: timestampSchema.optional(),
    /**
     * Pause this computer (`imagery.pause` from the admin, or the computer's own page through `worker.claim` / `worker.end`): it
     * claims nothing, hands its job back without using an attempt and frees the processor, until Resume or `until`.
     */
    paused: pausedSchema.optional(),
    /**
     * Cleanup item 6 (2026-11-14): the worker's disk as its last claim said it: what its folder uses, the free bytes of its disk, the
     * floor under which it takes no job, and when.
     */
    disk: z.strictObject({ workBytes: byteCount, freeBytes: byteCount, floorBytes: byteCount, at: timestampSchema }).optional(),
    /** "Free space now" (`worker.manage` `freeSpace`): when the admin asked; dropped once the worker said it freed space since. */
    freeSpaceAskedAt: timestampSchema.optional(),
    /** What the worker's last "Free space now" freed, and when (the worker's word, with a claim). */
    freed: z.strictObject({ bytes: byteCount, at: timestampSchema }).optional(),
    /** M20 §22: the scanned maps it shares with the other computers (`worker.archiveCopy`), and how far. */
    sharing: workerSharingSchema.optional(),
    ...stamp,
});

/**
 * `cities/{city}/pairings/{pairId}` (finding 67; id: the first 40 hex characters of the code's SHA-256, the code is never
 * stored): a one-time code minted by `worker.pairCode` for `uid`, exchanged once by `worker.pair` (`pairedAt`) before
 * `expiresAt`, revoked by Disconnect this computer or a later pairing that replaced it. No client reads or writes it.
 */
export const workerPairingDocSchema = z.strictObject({
    uid: uidSchema,
    /** The pipeline image the command named (absent: no image was recorded yet). */
    image: digestSchema.optional(),
    expiresAt: timestampSchema,
    pairedAt: timestampSchema.optional(),
    revokedAt: timestampSchema.optional(),
    ...stamp,
});

/** `cities/{city}/pairings/limit`: `worker.pair`'s attempts in the current window (it needs no sign-in). */
export const workerPairLimitDocSchema = z.strictObject({ windowStart: timestampSchema, attempts: z.number().int().min(0), ...stamp });

/** `cities/{city}/workers/choice`: where the city's raster jobs run by default (`auto` when absent). */
export const runChoiceDocSchema = z.strictObject({ choice: z.enum(RUN_CHOICES), ...stamp });

/**
 * `usage/cloudrun-YYYY-MM`: the month's counted cloud runs, seconds × each machine's vCPUs and GiB. Finding 64 of
 * 2026-11-02: `backfilledAt` says the month's cloud runs that ended before they were counted (the count began with M7's
 * release) were added once, from their jobs' recorded times (`imagery.tick`).
 */
export const cloudRunUsageDocSchema = z.strictObject({
    month: z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/),
    vcpuSeconds: z.number().min(0),
    gibSeconds: z.number().min(0),
    runs: z.number().int().min(0),
    backfilledAt: timestampSchema.optional(),
    ...stamp,
});

export type WorkerDoc = z.infer<typeof workerDocSchema>;
export type WorkerAi = z.infer<typeof workerAiSchema>;
export type WorkerShare = z.infer<typeof workerShareSchema>;
export type WorkerSharing = z.infer<typeof workerSharingSchema>;
export type WorkerRemoval = z.infer<typeof workerRemovalSchema>;
export type RunChoiceDoc = z.infer<typeof runChoiceDocSchema>;
export type CloudRunUsageDoc = z.infer<typeof cloudRunUsageDocSchema>;
export type WorkerPairingDoc = z.infer<typeof workerPairingDocSchema>;
export type WorkerPairLimitDoc = z.infer<typeof workerPairLimitDocSchema>;
