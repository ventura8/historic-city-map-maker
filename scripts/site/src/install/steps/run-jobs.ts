/**
 * The pipeline build's `jobs` step (`docs/research/M6-interfaces.md` §1.4.2): creates or replaces the raster pipeline's
 * three Cloud Run Jobs through Run Admin v2, on the image the `push` step pushed (by digest), exactly as D5 of
 * `MANUAL_TEST_PLAN.md` did with `gcloud`: `job-raster@`, task timeout 6 h, no retries, one task, args `run`, the
 * project's buckets in the environment, the release's slug as the `hcm-release` label and its build time, when it has
 * one, as `hcm-release-time` (finding 39 of 2026-11-01: it orders two builds of one version). Each operation is waited
 * for, and the jobs are made one after the other, never at once.
 *
 * Finding 47 of 2026-11-01: a call Google refuses for its request rate (429 or `RESOURCE_EXHAUSTED` with the reason
 * `RATE_LIMIT_EXCEEDED`, or no reason) is tried again after 5, 10, 20 and 40 s, each between half and one and a half
 * times that (jitter) or Google's `Retry-After` when longer, at most 60 s a wait (under four minutes in all), each wait
 * printed as a `retry` event; a quota (a `QuotaFailure`, or any other reason) is not tried again: the step ends with a
 * line naming it and a `quota` event the pipeline's card turns into the fix.
 *
 * `node steps/run-jobs.mjs --project <p> --region <r> --image-file /workspace/digest --slug <slug> [--release-time <s>]`
 */
import { parseArgs } from 'node:util';

import { CLOUD_RUN_JOBS, JOB_MACHINE_SIZES, type JobMachine } from '@hcm/shared';

import type { NamedQuota } from './google-error.js';
import { GoogleCallError, googleJson, logEvent, type StepDeps } from './step-io.js';

const RUN = 'https://run.googleapis.com/v2';

/** One job's machine in Run Admin v2's terms, from `JOB_MACHINE_SIZES` (the free-tier meter's own figures). */
function jobOf(machine: JobMachine): { readonly name: string; readonly cpu: string; readonly memory: string } {
    const size = JOB_MACHINE_SIZES[machine];
    return { name: CLOUD_RUN_JOBS[machine], cpu: String(size.vcpu), memory: `${String(size.gib)}Gi` };
}

/**
 * The three jobs and their machines (M3 §4.3): the small one runs an import's download (network-bound, finding 56 of
 * 2026-11-01: 8 vCPUs idled at 3 % for half an hour), the other two its processing (`std` 2 vCPU / 8 GiB, `xl` 4 / 16 since
 * 2026-11-12: `docs/research/M7-local-worker.md` §4.6).
 */
export const PIPELINE_JOBS = [jobOf('fetch'), jobOf('std'), jobOf('xl')] as const;

const OPERATION_POLLS = 120;
const OPERATION_POLL_MS = 5000;
/** A rate-limited call's tries after the first, its first wait and the longest wait (seconds). */
const RATE_RETRIES = 4;
const FIRST_RATE_WAIT_S = 5;
const MAX_RATE_WAIT_S = 60;
/** The longest quota name a `quota` event carries (the schema's). */
const MAX_QUOTA_TEXT = 200;

/** `<region>-docker.pkg.dev/<project>/hcm/pipeline@sha256:<64 hex>`, as `docker inspect` printed it. */
const IMAGE_DIGEST = /^[a-z0-9-]+-docker\.pkg\.dev\/[a-z][a-z0-9-]{4,28}[a-z0-9]\/hcm\/pipeline@sha256:([0-9a-f]{64})$/;

interface Options {
    readonly project: string;
    readonly region: string;
    readonly imageFile: string;
    readonly slug: string;
    /** The release's build time in seconds since 1970, or '' for a release that knows none. */
    readonly releaseTime: string;
}

function options(argv: readonly string[]): Options {
    const { values } = parseArgs({
        args: [...argv],
        options: {
            ...{ project: { type: 'string' }, region: { type: 'string' }, 'image-file': { type: 'string' }, slug: { type: 'string' } },
            'release-time': { type: 'string', default: '' },
        },
        strict: true,
    });
    const { project, region, slug } = values;
    const imageFile = values['image-file'];
    if (project === undefined || region === undefined || imageFile === undefined || slug === undefined) {
        throw new Error('usage: run-jobs --project <p> --region <r> --image-file <path> --slug <slug>');
    }
    return { project, region, imageFile, slug, releaseTime: values['release-time'] };
}

/** The pushed image by digest, from the `push` step's file (a quoted line is unquoted). */
export function imageOf(text: string): string {
    const image = text.trim().replaceAll("'", '');
    if (!IMAGE_DIGEST.test(image)) {
        throw new Error(`the push step left no image digest: ${JSON.stringify(image.slice(0, 120))}`);
    }
    return image;
}

/** The build time as the `hcm-release-time` label (whole seconds), or no label for a release without one. */
function timeLabel(releaseTime: string): Record<string, string> {
    return /^\d{1,10}$/.test(releaseTime) ? { 'hcm-release-time': releaseTime } : {};
}

/** A job as Run Admin v2 takes it. */
export function jobBody(opts: Options, image: string, job: (typeof PIPELINE_JOBS)[number]): Record<string, unknown> {
    const env = [
        { name: 'GOOGLE_CLOUD_PROJECT', value: opts.project },
        { name: 'HCM_PRIVATE_BUCKET', value: `${opts.project}.firebasestorage.app` },
        { name: 'HCM_PUBLIC_BUCKET', value: `${opts.project}-public` },
    ];
    return {
        labels: { 'hcm-release': opts.slug, ...timeLabel(opts.releaseTime) },
        template: {
            taskCount: 1,
            template: {
                serviceAccount: `job-raster@${opts.project}.iam.gserviceaccount.com`,
                timeout: '21600s',
                maxRetries: 0,
                containers: [{ image, args: ['run'], env, resources: { limits: { cpu: job.cpu, memory: job.memory } } }],
            },
        },
    };
}

/** The wait before try `attempt + 1` of a rate-limited call: 5·2^(attempt−1) s with jitter, or `Retry-After`, at most 60 s. */
export function rateWaitSeconds(attempt: number, retryAfterSeconds: number, random: number): number {
    const jittered = Math.round(FIRST_RATE_WAIT_S * 2 ** (attempt - 1) * (0.5 + random));
    return Math.min(MAX_RATE_WAIT_S, Math.max(jittered, retryAfterSeconds));
}

function rateLimited(error: unknown, attempt: number): error is GoogleCallError {
    return error instanceof GoogleCallError && error.refusal.exhaustion === 'rate' && attempt <= RATE_RETRIES;
}

/** A Google call of this step: a refusal for the request rate is tried again (above), anything else is thrown. */
async function call(deps: StepDeps, token: string, url: string, init: RequestInit = {}): Promise<unknown> {
    for (let attempt = 1; ; attempt += 1) {
        try {
            return await googleJson(deps, token, url, init);
        } catch (error) {
            if (!rateLimited(error, attempt)) {
                throw error;
            }
            const waitSeconds = rateWaitSeconds(attempt, error.refusal.retryAfterSeconds, deps.random());
            deps.log(`jobs: ${error.message}: trying again in ${String(waitSeconds)} s`);
            logEvent(deps, { event: 'retry', attempt, waitSeconds, reason: 'quota' });
            await deps.sleep(waitSeconds * 1000);
        }
    }
}

async function exists(deps: StepDeps, token: string, url: string): Promise<boolean> {
    try {
        await call(deps, token, url);
        return true;
    } catch (error) {
        if (error instanceof GoogleCallError && error.status === 404) {
            return false;
        }
        throw error;
    }
}

interface Operation {
    readonly name?: string;
    readonly done?: boolean;
    readonly error?: unknown;
}

async function waitFor(deps: StepDeps, token: string, started: unknown): Promise<void> {
    let operation = started as Operation;
    let polls = 0;
    while (operation.done !== true) {
        if (polls >= OPERATION_POLLS || operation.name === undefined) {
            throw new Error('the job operation did not finish');
        }
        polls += 1;
        await deps.sleep(OPERATION_POLL_MS);
        operation = (await call(deps, token, `${RUN}/${operation.name}`)) as Operation;
    }
    if (operation.error !== undefined) {
        throw new Error(`the job operation failed: ${JSON.stringify(operation.error).slice(0, 300)}`);
    }
}

/** What every job of one run shares: the world, the build's token, the options and the pushed image. */
interface JobRun {
    readonly deps: StepDeps;
    readonly token: string;
    readonly opts: Options;
    readonly image: string;
}

async function upsert(run: JobRun, job: (typeof PIPELINE_JOBS)[number]): Promise<void> {
    const { deps, token, opts, image } = run;
    const jobs = `${RUN}/projects/${opts.project}/locations/${opts.region}/jobs`;
    const body = JSON.stringify(jobBody(opts, image, job));
    const started = (await exists(deps, token, `${jobs}/${job.name}`))
        ? await call(deps, token, `${jobs}/${job.name}`, { method: 'PATCH', body })
        : await call(deps, token, `${jobs}?jobId=${job.name}`, { method: 'POST', body });
    await waitFor(deps, token, started);
    deps.log(`jobs: ${job.name} runs ${image} (${job.cpu} CPU, ${job.memory})`);
}

/** The quota as a `quota` event carries it (each name at most 200 characters). */
function quotaEvent(quota: NamedQuota): { event: 'quota'; service: string; metric: string; limit: string } {
    const cut = (value: string): string => value.slice(0, MAX_QUOTA_TEXT);
    return { event: 'quota', service: quota.service, metric: cut(quota.metric), limit: cut(quota.limit) };
}

/** A refusal that names a quota ends the step with a line naming it and its `quota` event; then it is thrown on. */
function nameQuota(deps: StepDeps, job: string, error: unknown): void {
    const quota = error instanceof GoogleCallError ? error.refusal.quota : null;
    if (quota === null) {
        return;
    }
    const event = quotaEvent(quota);
    deps.log(
        `jobs: Google Cloud refused ${job} for the quota ${event.metric || '(unnamed)'} (limit ${event.limit || '?'}) of ` +
            `${event.service}. A free-trial project has lower quotas: upgrade the account, or ask for a higher quota on ` +
            'the Quotas page, then try again.',
    );
    logEvent(deps, event);
}

/** Creates or replaces the three jobs, one after the other; resolves to the step's exit status. */
export async function runJobs(argv: readonly string[], deps: StepDeps): Promise<number> {
    const opts = options(argv);
    const image = imageOf(deps.readFile(opts.imageFile));
    const run: JobRun = { deps, token: await deps.token(), opts, image };
    for (const job of PIPELINE_JOBS) {
        try {
            await upsert(run, job);
        } catch (error) {
            nameQuota(deps, job.name, error);
            throw error;
        }
    }
    logEvent(deps, { event: 'image', digest: `sha256:${String(IMAGE_DIGEST.exec(image)?.[1])}` });
    return 0;
}
