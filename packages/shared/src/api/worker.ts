/**
 * M7: "Run on my computer" (`docs/research/M7-local-worker.md`). The local worker (`python -m hcm_pipeline worker`) speaks
 * to the server through five callables, `worker.hello`, `worker.claim`, `worker.step`, `worker.urls` and `worker.end`
 * (access `cityEditor`, App Check off: §2.4), each bound to the one job the worker claimed; their schemas are in
 * `worker-calls.ts`, which the admin never imports (it never calls them, and its bundle should not carry them). Here: the
 * constants of the worker (§1–§2), the free-tier estimate (§4) and the Uploads API path (§6), and `imagery.runOn`, with
 * which the admin chooses where a job runs.
 */
import { z } from 'zod';

import { coded, idSchema } from '../schemas/primitives.js';
import { cityIdSchema } from '../schemas/paths.js';
import { RUN_CHOICES, RUN_PLACES, WORKER_ID_PATTERN, type JobMachine } from '../schemas/firestore-ops.js';
import { STUDIO_MAX_BYTES } from '../schemas/imagery-publish.js';
import { isoTimeSchema } from './common.js';

/** The local page's port, on the computer's loopback only (`-p 127.0.0.1:8765:8765`). */
export const WORKER_PORT = 8765;
/** A worker seen this recently counts as connected (`auto` sends new jobs to the computer). */
export const WORKER_FRESH_SECONDS = 180;
/** How often a worker asks for a job while awake (`worker.claim` also refreshes its `lastSeenAt`). */
export const WORKER_POLL_SECONDS = 30;
/**
 * The longest an idle worker waits between two claims (`worker.hello`'s `idlePollSeconds`; `pipeline/src/hcm_pipeline/worker/pace.py`):
 * ten minutes after its last job or the admin's last look it asks at most this rarely, so a new job starts within a minute. Not a
 * listener: the worker reaches the project only through its callables (no Firestore SDK, and no rule lets it read the jobs), and a
 * long-poll would hold a function instance for every idle minute. 43,200 calls a month a worker instead of 86,400
 * (`reports/resource-audit.md` §4); the longest wait with its jitter stays well inside `WORKER_FRESH_SECONDS`.
 */
export const WORKER_IDLE_POLL_SECONDS = 60;
/** How long a signed URL of `worker.urls` works. */
export const WORKER_URL_SECONDS = 900;
/** At most this many objects per `worker.urls` call. */
export const WORKER_URLS_MAX = 20;
/** The lease owner of a worker's run: `worker:<workerId>` (a Cloud Run run's is `<execution>/<attempt>`). */
export const WORKER_LEASE_PREFIX = 'worker:';
/** The field value a `worker.step` update sends to remove a field (Firestore's `DELETE_FIELD` cannot travel as JSON). */
export const WORKER_DELETE_FIELD = '__hcmDelete';
/**
 * Pairing (finding 67 of 2026-11-02, `docs/research/M7-local-worker.md` §2.6): the one-time code the admin's command
 * carries (`--pair <code>`), 26 characters of base32 (130 random bits), minted by `worker.pairCode` and exchanged once by
 * `worker.pair` for a sign-in of the owner's account; it works this many seconds.
 */
export const WORKER_PAIR_SECONDS = 600;
/**
 * W5 (household computers): the code of "Add another computer"'s one-line command lasts longer, since the computer first
 * installs Docker and downloads the pipeline (several minutes) before its worker can spend it. Still one use.
 */
export const WORKER_HOUSEHOLD_PAIR_SECONDS = 2700;
export const WORKER_PAIR_CODE_PATTERN = /^[a-z2-7]{26}$/;
/** `worker.pair` answers at most this many attempts per city in `WORKER_PAIR_WINDOW_SECONDS` (it needs no sign-in). */
export const WORKER_PAIR_ATTEMPTS = 20;
export const WORKER_PAIR_WINDOW_SECONDS = 600;
/** A pairing's id: the first 40 hex characters of the code's SHA-256 (the code itself is never stored). */
export const WORKER_PAIR_ID_PATTERN = /^[0-9a-f]{40}$/;
/** The worker's container and its named volume (`-v hcm-worker:/work`: the work folder and the paired session). */
export const WORKER_CONTAINER = 'hcm-worker';
/**
 * Finding 68: a job waiting for the computer this many minutes, with no computer seen, offers Run in Google Cloud instead
 * and leaves an inbox item (`job.noWorker`).
 */
export const WORKER_WAIT_MINUTES = 15;
/**
 * Finding 72 of 2026-11-02 (the starter file, `docs/research/M7-local-worker.md` §1.5): the worker run by the starter's
 * supervisor (`worker --supervised`) exits with this code when its image is older than the installed pipeline's; the
 * supervisor then reads the installed image (`worker.image`), pulls it and starts the worker again. 75 is sysexits'
 * EX_TEMPFAIL (the pipeline's `ExitCode.OUTDATED`), apart from Docker's own 125-137.
 */
export const WORKER_OUTDATED_EXIT = 75;
/**
 * The starter files' templates (`packages/admin/starter/`), one per system, which `functions/build.mjs` copies beside the
 * server's bundle (`dist/starter/`) and `worker.starter` fills (finding 73 of 2026-11-03).
 */
export const WORKER_STARTER_TEMPLATES = { posix: 'hcm-worker.sh', windows: 'hcm-worker.bat' } as const;
/**
 * The starter files' version (`docs/research/M7-local-worker.md`, *The starter updates itself*): the first 12 hex digits of the
 * SHA-256 of both templates with their version lines emptied (`scripts/site/src/admin/starter.ts`, which a test and the admin's
 * build hold equal to the templates' own lines and to the pipeline's `STARTER_VERSION`). The worker's `/state` says the version of
 * the starter that runs it; the admin's "This computer" says whether it is this release's.
 */
export const WORKER_STARTER_VERSION = 'e0afe8c32568';
/** The release's list of the starter files on Hosting, `<admin>/starter.json`: the version and each template's SHA-256. */
export const WORKER_STARTER_LIST_FILE = 'starter.json';
/** What an installed starter's last look for a newer one said (`HCM_STARTER_UPDATE`, the worker's `/state` `starter.update`). */
export const WORKER_STARTER_UPDATES = [
    'unchecked',
    'current',
    'updated',
    'not-installed',
    'no-list',
    'no-file',
    'bad-sum',
    'read-only',
] as const;
export type WorkerStarterUpdate = (typeof WORKER_STARTER_UPDATES)[number];
/** The placeholders a starter template carries, which `worker.starter` fills (the project, the city, install or uninstall). */
export const WORKER_STARTER_PLACEHOLDERS = { project: '__HCM_PROJECT__', city: '__HCM_CITY__', action: '__HCM_ACTION__' } as const;
/** The systems a starter file is made for. */
export const WORKER_OSES = ['linux', 'mac', 'windows'] as const;
export type WorkerOs = (typeof WORKER_OSES)[number];
/** What a starter file does when opened: set the computer up, or remove the worker from it. */
export const WORKER_STARTER_ACTIONS = ['install', 'uninstall'] as const;
export type WorkerStarterAction = (typeof WORKER_STARTER_ACTIONS)[number];
/** The file's name, by action and system (what the browser saves; `Content-Disposition` of `worker.starter`). */
export const WORKER_STARTER_FILE_NAMES: Readonly<Record<WorkerStarterAction, Readonly<Record<WorkerOs, string>>>> = {
    install: { linux: 'hcm-worker.sh', mac: 'hcm-worker.command', windows: 'hcm-worker.bat' },
    uninstall: { linux: 'hcm-worker-remove.sh', mac: 'hcm-worker-remove.command', windows: 'hcm-worker-remove.bat' },
};
/**
 * `worker.starter` (finding 73 of 2026-11-03: Chrome saved nothing of the file the admin made in the page): the public
 * HTTPS function's query, `GET /worker-starter?city=<city>&os=<linux|mac|windows>&action=<install|uninstall>`, answered
 * with the filled file as a download (`Content-Disposition: attachment`). Nothing in it is a secret.
 */
export const workerStarterQuerySchema = z.strictObject({
    city: cityIdSchema,
    os: z.enum(WORKER_OSES),
    action: z.enum(WORKER_STARTER_ACTIONS),
});

/** The most bytes one archive series' copy may put in the bucket (a guard on the bucket's traffic, not a limit of the scans). */
export const ARCHIVE_COPY_MAX_BYTES = 8 * 1024 ** 3;

/**
 * M20 §22 (2026-11-14): the most bytes one computer shares through the bucket in a day (UTC). Every byte shared is downloaded once
 * by another computer, and that download is the bucket's only billed traffic (about 0.12 USD a GB): 20 GB is about 2.4 USD a day at
 * most. Over it the computer stops sharing until the next day and runs those series itself. Lives here (not `worker-calls.ts`) so the
 * admin's household card can name the day limit without pulling the worker-only callable schemas into its chunk.
 */
export const ARCHIVE_SHARE_DAY_BYTES = 20 * 1024 ** 3;

/** M20 §22: why `wanted` names no series to share now: none waits, no other computer could take one, or today's bytes are spent. */
export const ARCHIVE_SHARE_IDLE_WHYS = ['nothing', 'alone', 'dayLimit'] as const;

/** The USGS M2M endpoints a worker may ask the server to call for its job (§2.5). */
export const WORKER_USGS_ENDPOINTS = ['download-options', 'download-request', 'download-retrieve', 'download-order-remove'] as const;

/**
 * Cloud Run's monthly free tier as the user gave it (request-based; jobs may count against the instance-based tier's
 * 240,000 vCPU-seconds and 450,000 GiB-seconds instead: UNVERIFIED, these lower figures are the conservative ones).
 */
export const CLOUD_RUN_FREE_TIER = { vcpuSeconds: 180_000, gibSeconds: 360_000 } as const;
/**
 * The size of each Cloud Run job (`CLOUD_RUN_JOBS`), the one source of the installer's jobs (`scripts/site/src/install/steps/run-jobs.ts`)
 * and of the free-tier meter. 2026-11-12 (reports/resource-audit.md item 7, `docs/research/M7-local-worker.md` §4.6): `std` 2 vCPU / 8 GiB
 * and `xl` 4 / 16, down from 4 / 16 and 8 / 32, sized for GDAL's cache and a warp's memory that follow the machine (512 and 1,024 MB
 * on 8 GiB) and a 60-sheet atlas pasted part by part, (`rasters.gdal_memory`, merged with `track/stripfix`; DECISIONS-for-review.md §179);
 * a run out of memory still runs again on the next machine (`fetch` → `std` → `xl`, today's `std`). A processing phase so takes half
 * the GiB-seconds: about 16 free runs a month, not 8.
 */
export const JOB_MACHINE_SIZES: Readonly<Record<JobMachine, { readonly vcpu: number; readonly gib: number }>> = {
    fetch: { vcpu: 1, gib: 4 },
    std: { vcpu: 2, gib: 8 },
    xl: { vcpu: 4, gib: 16 },
};
/** The estimate of one phase's run on each machine, in seconds: a download on `fetch`, a processing on `std` or `xl`. */
export const CLOUD_RUN_ESTIMATE_SECONDS: Readonly<Record<JobMachine, number>> = { fetch: 1800, std: 2700, xl: 3600 };

/** Mapbox's Uploads API: the megabytes a month it processes for free (no compute units; `platform-research.json`). */
export const MAPBOX_FREE_UPLOAD_MB = 10_000;
/** The largest file the free Uploads path sends: the Studio file's ceiling (Console uploads' free limit). */
export const UPLOADS_FREE_MAX_BYTES = STUDIO_MAX_BYTES;

/**
 * `imagery.runOn` (admin): without `jobId`, the city's remembered choice; with `jobId`, where that job runs (and the
 * city's choice with it), while it holds no run; `freeTierOk` is the OK to run it in the cloud past the free tier.
 */
export const imageryRunOnRequestSchema = z
    .strictObject({ cityId: cityIdSchema, jobId: idSchema.optional(), runOn: z.enum(RUN_CHOICES), freeTierOk: z.boolean().optional() })
    .refine((request) => request.jobId === undefined || request.runOn !== 'auto', coded('validation.format', ['runOn']));
export const imageryRunOnResponseSchema = z.strictObject({ choice: z.enum(RUN_CHOICES), runOn: z.enum(RUN_PLACES).optional() });

/**
 * `imagery.pause` (admin; the owner's request of 2026-11-13): `pause` or `resume` one job (`jobId`), one computer (`workerId`, with
 * `until` when its pause ends on its own: For 1 hour, Until tomorrow), or, naming neither, every pausable job of the city (Pause all,
 * Resume all). `changed`: how many jobs or computers it changed (0: nothing was left to change).
 */
export const PAUSE_ACTIONS = ['pause', 'resume'] as const;
export type PauseAction = (typeof PAUSE_ACTIONS)[number];
/** The longest a timed pause of a computer may last (Until tomorrow at the latest). */
export const PAUSE_UNTIL_MAX_HOURS = 48;
export const imageryPauseRequestSchema = z
    .strictObject({
        cityId: cityIdSchema,
        action: z.enum(PAUSE_ACTIONS),
        jobId: idSchema.optional(),
        workerId: z.string().regex(WORKER_ID_PATTERN).optional(),
        until: isoTimeSchema.optional(),
    })
    .refine((request) => request.jobId === undefined || request.workerId === undefined, coded('validation.format', ['jobId']))
    .refine(
        (request) => request.until === undefined || (request.workerId !== undefined && request.action === 'pause'),
        coded('validation.format', ['until']),
    );
export const imageryPauseResponseSchema = z.strictObject({ changed: z.number().int().min(0) });

/**
 * `worker.pairCode` (admin): a one-time pairing code for the city's worker command, and when it stops working; `household`
 * (W5): for "Add another computer"'s command, which lasts `WORKER_HOUSEHOLD_PAIR_SECONDS`.
 */
export const workerPairCodeRequestSchema = z.strictObject({ cityId: cityIdSchema, household: z.boolean().optional() });
export const workerPairCodeResponseSchema = z.strictObject({ code: z.string().regex(WORKER_PAIR_CODE_PATTERN), expiresAt: isoTimeSchema });
/** `worker.revoke` (admin): Disconnect this computer: its pairing and its worker refused from now on. */
export const workerRevokeRequestSchema = z.strictObject({ cityId: cityIdSchema, workerId: z.string().regex(WORKER_ID_PATTERN) });
export const workerRevokeResponseSchema = z.strictObject({ revoked: z.boolean() });
