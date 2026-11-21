import '../global-options.js';

import {
    FIRESTORE_PATHS,
    JOB_MAX_ATTEMPTS,
    JOB_STEPS,
    PUBLISH_MAX_ATTEMPTS,
    isSideJob,
    jobDocSchema,
    layerVersionDocSchema,
    retryCures,
    retryPastCap,
    type CallableRequest,
    type CallableResponse,
    type JobDoc,
    type JobStep,
    type LayerVersionDoc,
    type LayerVersionState,
} from '@hcm/shared';

import type { VerifiedCaller } from '../api/access.js';
import { ApiError } from '../api/api-error.js';
import { defineCallable, type CallableDeps } from '../api/callable.js';
import { omit } from '../api/objects.js';
import type { DocumentTransaction } from '../ports/documents.js';
import type { Ports } from '../ports/index.js';
import { GO, isRefused, partRefusal, partsReady } from './join-parts.js';
import { enqueuePublish } from './publish-queue.js';
import { guardIsRed, requireJob, stampOf, versionIdOf, type Stamp } from './records.js';

/**
 * `imagery.retry` (admin; `docs/research/M3-interfaces.md` §4.5): a failed raster job again, from its first unfinished
 * step. A pipeline failure goes back to `queued` with its failed steps `pending` (the finished ones are skipped by their
 * recorded outputs; the dispatcher starts a new execution); a failure after approval goes back to the publisher, never
 * to Cloud Run, its MTS job and publish steps cleared (the upload is kept: the same file is not sent twice). At most
 * `JOB_MAX_ATTEMPTS` executions and `PUBLISH_MAX_ATTEMPTS` publish starts in all; never while the budget guard is red;
 * never a job without its version (an upload the server refused: there is nothing to run) nor a failure no retry can
 * cure (a Mapbox token or its scopes: Setup's Mapbox step; out of memory on the large machine) (CR-M3-47); never a version
 * that ended otherwise: a dismissed one gave its scene and its scratch files back, and a retry would make a layer no scene
 * knows (finding of 2026-11-06; S-A12-BAD-RETRY-DISMISSED). A version still `processing` under a failed job is a stranded run
 * (the runner's second write did not arrive): the retry is the way out, as neither Dismiss nor Cancel takes it
 * (S-A12-BAD-STRANDED-VERSION). A stopped job (status `cancelled`, version `cancelled`) is retried the same way as a failed one,
 * without the Stop that ended it (`cancelRequested`), and its version keeps what the owner gave it: an archive series with saved
 * pairs (`georef`, `method: 'gcps'`) places itself from them again (`placing/owner.py`; S-A12-HAPPY-RETRY-STOPPED-PAIRS).
 * A manual retry of a run on the owner's computer (`runOn: 'local'`, an archive series) is allowed past `JOB_MAX_ATTEMPTS` and
 * starts the count again: it costs no cloud compute (`retryPastCap`; live report of 2026-11-12, S-A12-HAPPY-LOCAL-RETRY-PAST-CAP);
 * a cloud run's cap and every publish cap stay (S-A12-BAD-CLOUD-RETRY-AT-CAP). Checked again in the transaction that retries.
 * M8 (`docs/research/M8-join-interfaces.md` §5): a
 * failed join freed its frames, so its retry asks whether they are still its own (a newer join, new points or a publish of its
 * own may have taken one: `apiError.imagery.joinPartGone`), and it goes back waiting for them, so no worker can claim it before the
 * dispatcher looked; a publish retry needs them all still there.
 */
export type RetryDeps = Pick<Ports, 'documents' | 'clock' | 'log' | 'tasks'>;

type Request = CallableRequest<'imagery.retry'>;

/** A version that was approved failed while publishing: the retry is the publisher's. */
function failedAtPublish(job: JobDoc, version: LayerVersionDoc | undefined): boolean {
    return !isSideJob(job.type) && (job.type === 'republish' || version?.approval !== undefined);
}

/**
 * The attempts a retry would add to: the publish starts after approval, the executions before. A failure of a runner whose
 * pipeline was older than the job's type spent no real attempt, and a run on the owner's computer costs no cloud compute
 * (`retryPastCap`, shared with the admin's `jobRetryable`): its retry is allowed whatever the count (`uncapped`).
 */
function requireAttemptsLeft(job: JobDoc, version: LayerVersionDoc): void {
    // A job the owner stopped spent no attempt it could be blamed for: its retry starts the count again.
    if (job.status === 'cancelled') {
        return;
    }
    requireCounted(job, version);
}

function requireCounted(job: JobDoc, version: LayerVersionDoc): void {
    const [attempts, max] = failedAtPublish(job, version)
        ? [job.publishAttempts ?? 0, PUBLISH_MAX_ATTEMPTS]
        : [job.attempt ?? 0, JOB_MAX_ATTEMPTS];
    if (attempts >= max) {
        throw new ApiError('apiError.imagery.attemptsExhausted', { attempts: String(attempts) });
    }
}

/** A failure a retry may cure (`retryCures`: never one of `NOT_RETRYABLE_CODES`, but a local run's exhausted attempts). */
function curable(job: JobDoc, version: LayerVersionDoc | undefined): boolean {
    return retryCures(job, failedAtPublish(job, version));
}

/** The retry may pass the attempt cap and start the count again: an outdated runner's failure, or a local run's (not a publish). */
function uncapped(job: JobDoc, version: LayerVersionDoc | undefined): boolean {
    return retryPastCap(job, failedAtPublish(job, version));
}

/**
 * The states a retry may bring a version back from: failed; processing under a failed job, a stranded run (`_fail_job`
 * writes the job first); or approved or publishing for a publish retry (the schema gives those two an approval, so
 * `failedAtPublish` holds); never one dismissed or otherwise ended. A stopped job (status `cancelled`) revives only a
 * version still `cancelled`.
 */
const REVIVABLE: ReadonlySet<LayerVersionState> = new Set<LayerVersionState>(['failed', 'processing', 'approved', 'publishing']);

/** M12: a side job's version is not its to revive: it runs again while the version still takes its tiles. */
const SIDE_JOB_VERSIONS: ReadonlySet<LayerVersionState> = new Set<LayerVersionState>(['awaiting_approval', 'approved']);

function revivable(job: JobDoc, version: LayerVersionDoc | undefined): version is LayerVersionDoc {
    if (version === undefined) {
        return false;
    }
    if (isSideJob(job.type)) {
        return SIDE_JOB_VERSIONS.has(version.state);
    }
    if (job.status === 'cancelled') {
        return version.state === 'cancelled';
    }
    return REVIVABLE.has(version.state);
}

/** A failed raster job whose failure a retry may cure. */
function failedRetryable(job: JobDoc, version: LayerVersionDoc | undefined): version is LayerVersionDoc {
    return job.status === 'failed' && revivable(job, version) && curable(job, version);
}

/** A stopped job's version must still be cancelled. */
function cancelledRetryable(version: LayerVersionDoc | undefined): boolean {
    return version?.state === 'cancelled';
}

/** A failed or stopped raster job, made with its version (a refused upload has none), whose failure a retry may cure. */
function retryable(job: JobDoc, version: LayerVersionDoc | undefined): version is LayerVersionDoc {
    if (job.type === 'layer-delete') {
        return false;
    }
    if (job.status === 'cancelled') {
        return cancelledRetryable(version);
    }
    return failedRetryable(job, version);
}

/** A failed raster job with its version, whose failure a retry may cure. */
async function requireFailedWork(deps: RetryDeps, request: Request): Promise<{ job: JobDoc; version: LayerVersionDoc }> {
    const job = await requireJob(deps.documents, request.cityId, request.jobId);
    const path = FIRESTORE_PATHS.layerVersion(request.cityId, versionIdOf(request.jobId, job));
    const version = await deps.documents.get(path, layerVersionDocSchema);
    if (!retryable(job, version)) {
        if (!isSideJob(job.type)) {
            await refuseSetAside(deps, request, versionIdOf(request.jobId, job), version);
        }
        throw new ApiError('apiError.imagery.versionState');
    }
    return { job, version };
}

/** The frame of an import version: its id after `<kind>-<stamp>-` (`im-mw11bz00-D3C1202-200149F039` → `D3C1202-200149F039`). */
function frameOf(versionId: string): string {
    return versionId.split('-').slice(2).join('-');
}

/** A later import of the same frame into the same layer, not set aside itself; undefined when there is none. */
async function newerImport(deps: RetryDeps, cityId: string, versionId: string, layerId: string): Promise<string | undefined> {
    const frame = frameOf(versionId);
    const { documents } = await deps.documents.query(FIRESTORE_PATHS.layerVersions(cityId), layerVersionDocSchema, {
        where: [['layerId', '==', layerId]],
    });
    const later = documents.filter(
        ({ id, data }) => id !== versionId && frame !== '' && frameOf(id) === frame && data.state !== 'rejected',
    );
    return later.map(({ id }) => id).sort((a, b) => b.localeCompare(a))[0];
}

/**
 * A version set aside (rejected) runs no more (the owner's report of 2026-11-13: "Run it again" on the 1972 frame
 * `im-mw11bz00-D3C1202-200149F039` came back with a bare 400): the refusal names a newer import of the same frame
 * (`apiError.imagery.importedAgain`, which the Jobs page turns into Open the newer import), else says it was set aside.
 */
async function refuseSetAside(deps: RetryDeps, request: Request, versionId: string, version: LayerVersionDoc | undefined): Promise<void> {
    if (version?.state !== 'rejected') {
        return;
    }
    const newer = await newerImport(deps, request.cityId, versionId, version.layerId);
    deps.log.info('retry refused: the version was set aside', { jobId: request.jobId, versionId, newer: newer ?? 'none' });
    throw newer === undefined
        ? new ApiError('apiError.imagery.versionRejected')
        : new ApiError('apiError.imagery.importedAgain', { versionId: newer });
}

/** The job may be retried: failed or stopped with its version, a raster type, a curable failure, attempts left, the guard green. */
async function requireRetryable(deps: RetryDeps, request: Request): Promise<JobDoc> {
    const { job, version } = await requireFailedWork(deps, request);
    if (!uncapped(job, version)) {
        requireAttemptsLeft(job, version);
    }
    if (await guardIsRed(deps.documents)) {
        throw new ApiError('apiError.guardPaused');
    }
    return job;
}

/** The failed steps become `pending` again; the others keep what they recorded (a publish retry: the render stands). */
function reopenedSteps(job: JobDoc): JobDoc['steps'] {
    const steps = Object.entries(job.steps ?? {}).map(([name, step]) => [
        name,
        step.status === 'failed' ? { status: 'pending' as const } : step,
    ]);
    return Object.fromEntries(steps) as JobDoc['steps'];
}

/**
 * What a pipeline retry keeps, the first of these that is finished (finding 78 of 2026-11-03): the city crop (the delivery
 * is gone after it), an upload's inspection, the unpacked segments, the delivery (a long download). Every step after it
 * runs again, so a pipeline updated since the failure redoes its own results: the 1972 frame's retry kept the wrongly
 * joined frame of the pipeline before the fix.
 */
const KEPT_BY_A_RETRY: readonly JobStep[] = ['locate', 'inspect', 'extract', 'fetch'];

function finished(job: JobDoc, step: string): boolean {
    const status = job.steps?.[step]?.status;
    return status === 'done' || status === 'skipped';
}

/** The steps after what a retry keeps become `pending` again; the kept ones and those before them stay as recorded. */
function rerunSteps(job: JobDoc): JobDoc['steps'] {
    const order: readonly string[] = JOB_STEPS[job.type];
    const kept = order.indexOf(KEPT_BY_A_RETRY.find((step) => finished(job, step)) ?? '');
    const steps = Object.entries(job.steps ?? {}).map(([name, step]) => [
        name,
        order.indexOf(name) > kept ? { status: 'pending' as const } : step,
    ]);
    return Object.fromEntries(steps) as JobDoc['steps'];
}

/** The publisher's steps a publish retry runs again (the upload is kept: its file is not sent twice). */
const PUBLISH_AGAIN = ['publish', 'tiles', 'finalize', 'mts-retry'] as const;

/** A publish retry starts with no MTS job and its publish steps cleared. */
function publishReopened(job: JobDoc): Pick<JobDoc, 'steps'> {
    return { steps: omit(reopenedSteps(job) ?? {}, PUBLISH_AGAIN) };
}

/** M8: a join goes back waiting for its frames, as `imagery.join` leaves it: a worker claims nothing the dispatcher did not see ready. */
function queuedAgain(job: JobDoc): Pick<JobDoc, 'waitReason'> {
    return job.type === 'layer-join' ? { waitReason: 'parts' } : {};
}

/**
 * A retry past the cap (`retryPastCap`: an outdated runner's failure, a local run's) or of a stopped job starts the count again:
 * the run gets every attempt (the worker claims only a job with attempts left).
 */
function attemptsAgain(job: JobDoc, atPublish: boolean): Pick<JobDoc, 'attempt'> {
    return retryPastCap(job, atPublish) || job.status === 'cancelled' ? { attempt: 0 } : {};
}

/**
 * What a run left that the retried job must not carry (docs/LESSONS.md 565): its error, its end, its lease and execution, its MTS
 * job, why it waited, an editor's placing mark, a local worker's overdue mark (`workerOverdueAt`: the retry is a new wait) and the
 * owner's Stop (`cancelRequested`). A Stop stays on the job it ended; kept on the retried one, the dispatcher and every worker's
 * claim pass the job over and `imagery.tick` cancels it again.
 */
const LEFT_BY_THE_RUN = [
    'error',
    'finishedAt',
    'lease',
    'retryAt',
    'executionName',
    'mapboxJobId',
    'waitReason',
    'placingPoints',
    'cancelRequested',
    'workerOverdueAt',
    // M20 (2026-11-13): a retried archive series starts its hand-backs again and wants a fresh copy of its sheets.
    'archiveReturns',
    'archiveCopy',
] as const;

function retriedJob(job: JobDoc, atPublish: boolean, stamp: Stamp): JobDoc {
    const kept = { ...omit(job, LEFT_BY_THE_RUN), ...attemptsAgain(job, atPublish) };
    if (atPublish) {
        return { ...kept, status: 'awaiting_approval', waitReason: 'approval', ...publishReopened(job), ...stamp };
    }
    return { ...kept, status: 'queued', ...queuedAgain(job), steps: rerunSteps(job), ...stamp };
}

/** M8: a join's frames are still its own; a publish retry cannot wait, so it needs them all ready now. */
async function requireJoinFrames(transaction: DocumentTransaction, request: Request, job: JobDoc, atPublish: boolean): Promise<void> {
    const ready = job.type === 'layer-join' ? await partsReady(transaction, request.cityId, request.jobId, job) : GO;
    if (isRefused(ready)) {
        throw partRefusal(ready);
    }
    if (atPublish && ready.kind === 'hold') {
        throw new ApiError('apiError.imagery.versionState');
    }
}

function retriedVersion(version: LayerVersionDoc, atPublish: boolean, stamp: Stamp): LayerVersionDoc {
    return { ...omit(version, ['error']), state: atPublish ? 'approved' : 'processing', ...stamp };
}

/** The job in the transaction must still be failed or cancelled. */
function requireRetryableStatus(job: JobDoc | undefined): asserts job is JobDoc {
    if (job?.status !== 'failed' && job?.status !== 'cancelled') {
        throw new ApiError('apiError.imagery.versionState');
    }
}

/** The version in the transaction must still be revivable. */
function requireRevivable(job: JobDoc, version: LayerVersionDoc | undefined): asserts version is LayerVersionDoc {
    if (!revivable(job, version)) {
        throw new ApiError('apiError.imagery.versionState');
    }
}

/** Write the version back only if it was failed or cancelled (a stranded `processing` version stays as is). */
async function updateVersionIfEnded(
    transaction: DocumentTransaction,
    ctx: { versionPath: string; version: LayerVersionDoc; atPublish: boolean; stamp: Stamp },
): Promise<void> {
    if (ctx.version.state === 'failed' || ctx.version.state === 'cancelled') {
        await transaction.set(ctx.versionPath, layerVersionDocSchema, retriedVersion(ctx.version, ctx.atPublish, ctx.stamp));
    }
}

/** Read the job and version from the transaction, asserting they are still retryable. */
async function readRetryable(
    transaction: DocumentTransaction,
    request: Request,
): Promise<{ job: JobDoc; version: LayerVersionDoc; jobPath: string; versionPath: string }> {
    const jobPath = FIRESTORE_PATHS.job(request.cityId, request.jobId);
    const job = await transaction.get(jobPath, jobDocSchema);
    requireRetryableStatus(job);
    const versionPath = FIRESTORE_PATHS.layerVersion(request.cityId, versionIdOf(request.jobId, job));
    const version = await transaction.get(versionPath, layerVersionDocSchema);
    requireRevivable(job, version);
    return { job, version, jobPath, versionPath };
}

/** Write the retried job and version back into the transaction. */
async function writeRetried(
    transaction: DocumentTransaction,
    ctx: { jobPath: string; versionPath: string; job: JobDoc; version: LayerVersionDoc; atPublish: boolean; stamp: Stamp },
): Promise<JobDoc> {
    const retried = retriedJob(ctx.job, ctx.atPublish, ctx.stamp);
    await transaction.set(ctx.jobPath, jobDocSchema, retried);
    await updateVersionIfEnded(transaction, {
        versionPath: ctx.versionPath,
        version: ctx.version,
        atPublish: ctx.atPublish,
        stamp: ctx.stamp,
    });
    return retried;
}

async function retryIn(transaction: DocumentTransaction, request: Request, stamp: Stamp): Promise<{ job: JobDoc; atPublish: boolean }> {
    const { job, version, jobPath, versionPath } = await readRetryable(transaction, request);
    const atPublish = failedAtPublish(job, version);
    await requireJoinFrames(transaction, request, job, atPublish);
    const retried = await writeRetried(transaction, { jobPath, versionPath, job, version, atPublish, stamp });
    return { job: retried, atPublish };
}

async function imageryRetry(deps: RetryDeps, caller: VerifiedCaller, request: Request): Promise<CallableResponse<'imagery.retry'>> {
    await requireRetryable(deps, request);
    const now = deps.clock.now();
    const { job, atPublish } = await deps.documents.transaction((transaction) => retryIn(transaction, request, stampOf(caller.uid, now)));
    if (atPublish) {
        await enqueuePublish(deps.tasks, { cityId: request.cityId, jobId: request.jobId }, `retry-${String(now.getTime())}`);
    }
    deps.log.info('raster job retried', { uid: caller.uid, cityId: request.cityId, jobId: request.jobId, atPublish });
    return { status: job.status, attempt: job.attempt ?? 0 };
}

/** The `imagery-retry` callable. */
export function retryFunction(getDeps: () => RetryDeps & CallableDeps) {
    return defineCallable('imagery.retry', imageryRetry, getDeps);
}
