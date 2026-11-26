/**
 * The free Uploads API path of the publisher (`docs/research/M7-local-worker.md` §6; S-A64-*): a version whose Studio file
 * fits the free allowance is published without compute units. `upload`: Mapbox's temporary credentials, the S3 `PUT` of
 * `studio.tif` streamed from the private bucket, then the upload that makes the layer's tileset (the same deterministic
 * `tilesetIdFor` as MTS); `tiles`: the upload polled (the MTS poll's schedule and tasks) until it is complete, then the
 * TileJSON smoke test; `finalize` with the layer's `mapbox.origin: 'uploads'`. A token without the uploads scopes, an
 * upload Mapbox refuses or one that ends in an error falls back to MTS behind the compute-unit guard once: one log line
 * says why, the path is marked `skipped` on the job (the guard then never chooses it again for this job) and the version
 * goes back to `approved`; a refusal before anything was staged costs no publish attempt.
 */
import {
    FIRESTORE_PATHS,
    PUBLISH_POLL_SECONDS,
    jobDocSchema,
    layerVersionDocSchema,
    timestampFromDate,
    type JobDoc,
    type LayerVersionDoc,
} from '@hcm/shared';

import { omit } from '../api/objects.js';
import { UpstreamError, type UpstreamFailure } from '../ports/errors.js';
import type { Ports } from '../ports/index.js';
import type { UploadStatus } from '../ports/mapbox-uploads.js';
import { finalizeVersion } from './finalize.js';
import { record, type MtsDeps, type Publishing } from './publish-mts.js';
import { enqueuePublish } from './publish-queue.js';
import { IMAGERY_WRITER, appendJobLog, stampOf, withStep } from './records.js';

export type UploadsDeps = MtsDeps & Pick<Ports, 'uploads'>;

/** The job's mark of the path: `running` while the Uploads API publishes it, `skipped` once it fell back to MTS. */
export const UPLOADS_STEP = 'uploads';

/** The calls of the path, named in the log line of a fallback. */
type UploadsCall = 'credentials' | 'stage' | 'create' | 'status';

/** Mapbox failures that end the Uploads path (not the publish): MTS takes over. Others are Cloud Tasks' to retry. */
const FALLS_BACK: ReadonlySet<UpstreamFailure> = new Set<UpstreamFailure>(['unauthorized', 'forbidden', 'invalid', 'notFound']);

/** Why the path fell back, as the job's log line says it (the token's missing scopes named). */
const REASONS: Readonly<Partial<Record<`${UploadsCall}:${UpstreamFailure}`, string>>> = {
    'credentials:unauthorized': 'Mapbox refused the tiles token',
    'credentials:forbidden': 'the tiles token lacks the uploads:read and uploads:write scopes',
};

/** The end of the fallback's log line. */
const THROUGH_MTS = 'publishing through MTS behind the compute-unit guard.';

/** A refusal of the Uploads path at one call. */
class UploadsRefused extends Error {
    constructor(
        readonly call: UploadsCall,
        readonly failure: UpstreamFailure,
        /** What Mapbox said of an upload that ended in an error. */
        readonly detail?: string,
    ) {
        super(`uploads ${call}: ${failure}`);
    }
}

/** The path is under way for this job (its guard chose it and it has not fallen back). */
export function usesUploads(job: JobDoc): boolean {
    return job.steps?.[UPLOADS_STEP]?.status === 'running';
}

/** One call of the path; a failure that ends the path becomes `UploadsRefused`, any other is rethrown as it is. */
async function calling<T>(call: UploadsCall, work: () => Promise<T>): Promise<T> {
    try {
        return await work();
    } catch (error) {
        const ends = error instanceof UpstreamError && error.service === 'mapbox' && FALLS_BACK.has(error.failure);
        throw ends ? new UploadsRefused(call, error.failure) : error;
    }
}

function reasonOf(refused: UploadsRefused): string {
    const known =
        refused.detail === undefined ? REASONS[`${refused.call}:${refused.failure}`] : `the upload ended in an error: ${refused.detail}`;
    return known ?? `Mapbox answered ${refused.failure} to the ${refused.call} call`;
}

/** The job back before the guard, the path marked `skipped` (and the attempt given back when nothing was staged). */
function fallenBackJob(job: JobDoc, refund: boolean, at: ReturnType<typeof timestampFromDate>): JobDoc {
    const attempts = job.publishAttempts ?? 0;
    const steps = {
        ...omit(job.steps ?? {}, ['upload', 'publish', 'tiles']),
        [UPLOADS_STEP]: { status: 'skipped' as const, finishedAt: at },
    };
    return {
        ...omit(job, ['mapboxJobId', 'waitReason']),
        status: 'awaiting_approval',
        steps,
        publishAttempts: refund ? Math.max(0, attempts - 1) : attempts,
    };
}

/**
 * Back to MTS behind the guard, in one transaction while the job is still at Mapbox's door: the job before the guard
 * with the path skipped, the version `approved` again. Returns false when the job moved on meanwhile (a cancellation).
 */
async function fallBack(deps: UploadsDeps, work: Publishing, refused: UploadsRefused, refund: boolean): Promise<boolean> {
    const now = deps.clock.now();
    const stamp = stampOf(IMAGERY_WRITER, now);
    const moved = await deps.documents.transaction(async (transaction) => {
        const path = FIRESTORE_PATHS.job(work.cityId, work.jobId);
        const job = await transaction.get(path, jobDocSchema);
        if (job?.status !== 'mts_processing') {
            return false;
        }
        await transaction.set(path, jobDocSchema, { ...fallenBackJob(job, refund, timestampFromDate(now)), ...stamp });
        const version: LayerVersionDoc = { ...omit(work.version, ['mapbox']), state: 'approved', ...stamp };
        await transaction.set(FIRESTORE_PATHS.layerVersion(work.cityId, work.version.jobId), layerVersionDocSchema, version);
        return true;
    });
    const message = `The Uploads API cannot publish this version (${reasonOf(refused)}); ${THROUGH_MTS}`;
    await appendJobLog(deps, work.cityId, work.jobId, { level: 'warn', step: 'upload', message });
    deps.log.warn('uploads path fell back to mts', {
        cityId: work.cityId,
        jobId: work.jobId,
        call: refused.call,
        failure: refused.failure,
    });
    return moved;
}

/** Records the upload on the job (the MTS job's field), the version's tileset, and queues its first poll. */
async function followUpload(
    deps: UploadsDeps,
    work: Publishing,
    upload: { readonly id: string; readonly bytes: number },
    poll: number,
): Promise<void> {
    const uploadId = upload.id;
    const at = stampOf(IMAGERY_WRITER, deps.clock.now()).updatedAt;
    const done = withStep(withStep({ ...work.job, mapboxJobId: uploadId }, 'upload', 'done', at), 'publish', 'done', at);
    const job = withStep(done, 'tiles', 'running', at);
    const mapbox = { tilesetId: work.tilesetId, jobId: uploadId, origin: 'uploads' as const, via: 'uploads' as const };
    await record(deps, work, { job, version: { ...work.version, mapbox } });
    await appendJobLog(deps, work.cityId, work.jobId, {
        level: 'info',
        step: 'upload',
        message: `Sent ${String(upload.bytes)} bytes to Mapbox's Uploads API; Mapbox is processing ${work.tilesetId}.`,
    });
    await enqueuePublish(
        deps.tasks,
        { cityId: work.cityId, jobId: work.jobId, phase: 'poll', poll },
        `poll-${String(poll)}`,
        PUBLISH_POLL_SECONDS[0],
    );
}

/** The Studio file of the version (the guard chose the path only for a version that has one). */
function studioPathOf(work: Publishing): string {
    return work.version.output.studioPath ?? work.version.output.cogPath;
}

/** Credentials, the staged file, the upload; then its first poll. */
async function stageAndCreate(deps: UploadsDeps, work: Publishing, poll: number): Promise<void> {
    const credentials = await calling('credentials', () => deps.uploads.credentials(work.user, work.token));
    const object = await deps.reader.open('private', studioPathOf(work));
    const file = { bytes: object.bytes, contentType: object.contentType, open: () => Promise.resolve(object.body) };
    await calling('stage', () => deps.uploads.stage(credentials, file));
    const request = { tileset: work.tilesetId, url: credentials.url, name: work.sourceId };
    const upload = await calling('create', () => deps.uploads.create(work.user, work.token, request));
    await followUpload(deps, work, { id: upload.id, bytes: object.bytes }, poll);
}

/** What the path did: started (polls follow), finished, still processing, or fell back to MTS (the caller restarts). */
export type UploadsOutcome = 'started' | 'finished' | 'processing' | 'fell-back';

/** A refusal of the path falls back to MTS (`fell-back`, or `finished` when the job moved on); anything else is rethrown. */
async function fallBackOrThrow(deps: UploadsDeps, work: Publishing, error: unknown): Promise<UploadsOutcome> {
    if (!(error instanceof UploadsRefused)) {
        throw error;
    }
    // A refusal of the credentials staged nothing: the attempt is given back.
    return (await fallBack(deps, work, error, error.call === 'credentials')) ? 'fell-back' : 'finished';
}

/** The publish after the guard chose the Uploads path; `fell-back` when MTS must take over. */
export async function publishThroughUploads(deps: UploadsDeps, work: Publishing, poll: number): Promise<UploadsOutcome> {
    try {
        await stageAndCreate(deps, work, poll);
        return 'started';
    } catch (error) {
        return fallBackOrThrow(deps, work, error);
    }
}

/** Complete: the tiles must answer their TileJSON (the smoke test), then the layer gets them. */
async function succeed(deps: UploadsDeps, work: Publishing): Promise<void> {
    await deps.tilesets.tileJson(work.token, work.tilesetId);
    await finalizeVersion(deps, {
        cityId: work.cityId,
        jobId: work.jobId,
        versionId: work.version.jobId,
        origin: 'uploads',
        tilesetId: work.tilesetId,
    });
}

/** What a status says: ended in an error (the path is refused), still processing, or complete (then finalized). */
async function settle(deps: UploadsDeps, work: Publishing, status: UploadStatus): Promise<UploadsOutcome> {
    if (status.error !== undefined) {
        throw new UploadsRefused('status', 'invalid', status.error);
    }
    if (!status.complete) {
        return 'processing';
    }
    await succeed(deps, work);
    return 'finished';
}

/** `poll` of an upload: complete → finalized; ended in an error (or refused) → MTS; else still processing. */
export async function pollUpload(deps: UploadsDeps, work: Publishing, uploadId: string): Promise<UploadsOutcome> {
    try {
        return await settle(deps, work, await calling('status', () => deps.uploads.status(work.user, work.token, uploadId)));
    } catch (error) {
        return fallBackOrThrow(deps, work, error);
    }
}
