/**
 * The MTS half of the publisher (`docs/research/M3-interfaces.md` §7.3): the version's COG streamed from the private
 * bucket into the layer's tileset source (never held in memory; skipped when the same file is already there, or when an
 * earlier attempt of this publish uploaded it), the raster recipe written and the tileset published, then the MTS job
 * polled after 60, 120, 300 and every 900 seconds. The tileset and source ids are deterministic per layer, so a retry
 * never makes a second tileset; the publish call is marked on the job in a transaction first, so a retry that finds the
 * mark without a job id looks for the job Mapbox already started instead of starting (and paying for) another one
 * (CR-M3-47). The tiles token is read from Secret Manager at run time and never logged.
 */
import {
    FIRESTORE_PATHS,
    PUBLISH_POLL_SECONDS,
    jobDocSchema,
    layerDocSchema,
    layerVersionDocSchema,
    rasterRecipe,
    tilesetIdFor,
    tilesetName,
    timestampFromDate,
    timestampToDate,
    type JobDoc,
    type LayerVersionDoc,
} from '@hcm/shared';

import { ApiError } from '../api/api-error.js';
import { UpstreamError } from '../ports/errors.js';
import type { Ports } from '../ports/index.js';
import { enqueuePublish } from './publish-queue.js';
import { IMAGERY_WRITER, appendJobLog, requireMapboxUser, requireTilesToken, stampOf, versionIdOf, withStep } from './records.js';

export type MtsDeps = Pick<Ports, 'documents' | 'clock' | 'log' | 'secrets' | 'setup' | 'tilesets' | 'reader' | 'tasks'>;

/** M12: a version reaches here only with its COG: without one, `publish-own.ts` takes it whatever the city chose. */
type Output = NonNullable<LayerVersionDoc['output']> & { readonly cogPath: string; readonly cogBytes: number; readonly cogSha256: string };
type PublishingVersion = LayerVersionDoc & { readonly output: Output };

/** The job and its version while Mapbox works on them. */
export interface Publishing {
    readonly cityId: string;
    readonly jobId: string;
    readonly job: JobDoc;
    readonly version: PublishingVersion;
    readonly user: string;
    readonly token: string;
    readonly tilesetId: string;
    readonly sourceId: string;
}

/** A job Mapbox lists counts as this publish's when it was created at most this long before the publish call. */
const LOST_JOB_SLACK_MS = 60_000;
/** How many of the tileset's latest jobs a recovery reads. */
const LISTED_JOBS = 10;

function isPublishing(version: LayerVersionDoc | undefined): version is PublishingVersion {
    return version?.state === 'publishing' && version.output?.cogPath !== undefined;
}

/** The job and its version while both are at Mapbox. */
async function loadAtMapbox(deps: MtsDeps, cityId: string, jobId: string) {
    const job = await deps.documents.get(FIRESTORE_PATHS.job(cityId, jobId), jobDocSchema);
    const version = await deps.documents.get(FIRESTORE_PATHS.layerVersion(cityId, versionIdOf(jobId, job ?? {})), layerVersionDocSchema);
    return job?.status === 'mts_processing' && isPublishing(version) ? { job, version } : undefined;
}

/** The job and version under way at Mapbox, with the account's user and tiles token; undefined when there is none. */
export async function loadPublishing(deps: MtsDeps, cityId: string, jobId: string): Promise<Publishing | undefined> {
    const loaded = await loadAtMapbox(deps, cityId, jobId);
    if (loaded === undefined) {
        return undefined;
    }
    const [user, token] = [await requireMapboxUser(deps.setup), await requireTilesToken(deps.secrets)];
    const layerId = loaded.version.layerId;
    return {
        cityId,
        jobId,
        ...loaded,
        user,
        token,
        tilesetId: tilesetIdFor(user, cityId, layerId),
        sourceId: tilesetName(cityId, layerId),
    };
}

/**
 * Writes the job and the version as `change` leaves them (stamped by the publisher) while the job is still at Mapbox;
 * returns the job as written, or undefined when the job moved on meanwhile (a cancellation: nothing is written).
 */
export async function record(
    deps: MtsDeps,
    work: Publishing,
    change: { job: JobDoc; version?: LayerVersionDoc },
): Promise<JobDoc | undefined> {
    const stamp = stampOf(IMAGERY_WRITER, deps.clock.now());
    return deps.documents.transaction(async (transaction) => {
        const path = FIRESTORE_PATHS.job(work.cityId, work.jobId);
        const current = await transaction.get(path, jobDocSchema);
        if (current?.status !== 'mts_processing') {
            return undefined;
        }
        const job: JobDoc = { ...change.job, publishAttempts: current.publishAttempts ?? 0, ...stamp };
        await transaction.set(path, jobDocSchema, job);
        if (change.version !== undefined) {
            await transaction.set(FIRESTORE_PATHS.layerVersion(work.cityId, work.version.jobId), layerVersionDocSchema, {
                ...change.version,
                ...stamp,
            });
        }
        return job;
    });
}

/** A source Mapbox refuses as too large (413). UNVERIFIED limit; the Studio path stays offered. */
function tooLarge(error: unknown, output: Output): ApiError | undefined {
    const refused = error instanceof UpstreamError && error.service === 'mapbox' && error.status === 413;
    return refused ? new ApiError('apiError.imagery.sourceTooLarge', { megabytes: String(Math.ceil(output.cogBytes / 1e6)) }) : undefined;
}

/** An earlier attempt of this publish uploaded this very file already. */
function uploadedBefore(work: Publishing): boolean {
    const step = work.job.steps?.['upload'];
    return step?.status === 'done' && step.sha256 === work.version.output.cogSha256;
}

/** Streams the COG into the tileset source; the job records the step done with the file's SHA-256. */
async function stream(deps: MtsDeps, work: Publishing): Promise<JobDoc | undefined> {
    const object = await deps.reader.open('private', work.version.output.cogPath);
    const file = { bytes: object.bytes, contentType: object.contentType, open: () => Promise.resolve(object.body) };
    await deps.tilesets.uploadSource(work.user, work.token, work.sourceId, file).catch((error: unknown) => {
        throw tooLarge(error, work.version.output) ?? error;
    });
    const at = stampOf(IMAGERY_WRITER, deps.clock.now()).updatedAt;
    const done = withStep(work.job, 'upload', 'done', at);
    const steps = { ...done.steps, upload: { ...done.steps?.['upload'], status: 'done' as const, sha256: work.version.output.cogSha256 } };
    const job = await record(deps, work, { job: { ...done, steps } });
    await appendJobLog(deps, work.cityId, work.jobId, {
        level: 'info',
        step: 'upload',
        message: `Uploaded ${String(object.bytes)} bytes to Mapbox.`,
    });
    return job;
}

/**
 * The upload: skipped when this publish uploaded the file before, or when the layer's tiles already come from it;
 * otherwise streamed. Returns the job as it now stands, or undefined when it moved on (then nothing is published).
 */
async function upload(deps: MtsDeps, work: Publishing): Promise<JobDoc | undefined> {
    if (uploadedBefore(work)) {
        return work.job;
    }
    const layer = await deps.documents.get(FIRESTORE_PATHS.layer(work.cityId, work.version.layerId), layerDocSchema);
    if (layer?.mapbox?.publishedSourceSha === work.version.output.cogSha256) {
        return record(deps, work, { job: withStep(work.job, 'upload', 'skipped', stampOf(IMAGERY_WRITER, deps.clock.now()).updatedAt) });
    }
    return stream(deps, work);
}

/** Records the MTS job of this publish and queues its first poll (`poll` counts the polls of the job). */
async function followJob(deps: MtsDeps, work: Publishing, mapboxJobId: string, poll: number): Promise<void> {
    const at = stampOf(IMAGERY_WRITER, deps.clock.now()).updatedAt;
    const job = withStep(withStep({ ...work.job, mapboxJobId }, 'publish', 'done', at), 'tiles', 'running', at);
    const mapbox = { tilesetId: work.tilesetId, sourceId: work.sourceId, jobId: mapboxJobId, origin: 'mts' as const, via: 'mts' as const };
    await record(deps, work, { job, version: { ...work.version, mapbox } });
    await appendJobLog(deps, work.cityId, work.jobId, {
        level: 'info',
        step: 'publish',
        message: `Mapbox is processing ${work.tilesetId}.`,
    });
    await enqueuePublish(
        deps.tasks,
        { cityId: work.cityId, jobId: work.jobId, phase: 'poll', poll },
        `poll-${String(poll)}`,
        PUBLISH_POLL_SECONDS[0],
    );
}

/** Writes the recipe, publishes, records the MTS job and queues its first poll. */
export async function publishTileset(deps: MtsDeps, work: Publishing, poll: number): Promise<void> {
    const { minzoom, maxzoom } = work.version.output;
    const recipe = rasterRecipe(work.user, work.sourceId, minzoom, maxzoom);
    await deps.tilesets.upsertTileset(work.token, work.tilesetId, { name: work.sourceId, recipe });
    const { jobId: mapboxJobId } = await deps.tilesets.publish(work.token, work.tilesetId);
    await followJob(deps, work, mapboxJobId, poll);
}

/** `go`: marked, publish; `lost`: an earlier attempt called Mapbox and its answer was lost; `gone`: nothing to publish. */
type Mark = { readonly kind: 'go'; readonly job: JobDoc } | { readonly kind: 'lost'; readonly since: Date } | { readonly kind: 'gone' };

/** Still at Mapbox's door: at Mapbox in its status, with no MTS job recorded yet. */
function atTheDoor(job: JobDoc | undefined): job is JobDoc {
    return job?.status === 'mts_processing' && job.mapboxJobId === undefined;
}

/** An earlier attempt marked its publish call and never recorded the answer: since when. */
function lostSince(job: JobDoc): Date | undefined {
    const started = job.steps?.['publish'];
    return started?.status === 'running' && started.startedAt !== undefined ? timestampToDate(started.startedAt) : undefined;
}

/** In one transaction: the job is still at Mapbox's door, and its `publish` step is marked running before the call. */
async function markPublishing(deps: MtsDeps, work: Publishing): Promise<Mark> {
    const now = deps.clock.now();
    return deps.documents.transaction(async (transaction): Promise<Mark> => {
        const path = FIRESTORE_PATHS.job(work.cityId, work.jobId);
        const current = await transaction.get(path, jobDocSchema);
        if (!atTheDoor(current)) {
            return { kind: 'gone' };
        }
        const since = lostSince(current);
        if (since !== undefined) {
            return { kind: 'lost', since };
        }
        const job: JobDoc = { ...withStep(current, 'publish', 'running', timestampFromDate(now)), ...stampOf(IMAGERY_WRITER, now) };
        await transaction.set(path, jobDocSchema, job);
        return { kind: 'go', job };
    });
}

/** The MTS job an earlier attempt started (created since its publish call), if Mapbox lists one. */
async function lostJob(deps: MtsDeps, work: Publishing, since: Date): Promise<string | undefined> {
    const jobs = await deps.tilesets.listJobs(work.token, work.tilesetId, LISTED_JOBS);
    return jobs.find((job) => job.stage !== 'failed' && job.createdAt >= since.getTime() - LOST_JOB_SLACK_MS)?.id;
}

/** After the upload: one publish call, or the job a lost answer left at Mapbox, followed. */
async function publishOnce(deps: MtsDeps, work: Publishing, poll: number): Promise<void> {
    const mark = await markPublishing(deps, work);
    if (mark.kind === 'gone') {
        return;
    }
    if (mark.kind === 'go') {
        await publishTileset(deps, { ...work, job: mark.job }, poll);
        return;
    }
    const found = await lostJob(deps, work, mark.since);
    await (found === undefined ? publishTileset(deps, work, poll) : followJob(deps, work, found, poll));
}

/** The publish after the guard: the upload (unless done), then one publish call (the guard's own step is done). */
export async function uploadAndPublish(deps: MtsDeps, work: Publishing, poll: number): Promise<void> {
    const job = await upload(deps, work);
    if (job !== undefined) {
        await publishOnce(deps, { ...work, job }, poll);
    }
}

/** The delay before poll `poll` (60, 120, 300 seconds, then every 900). */
export function pollDelay(poll: number): number {
    return Number(PUBLISH_POLL_SECONDS[Math.min(poll, PUBLISH_POLL_SECONDS.length - 1)]);
}
