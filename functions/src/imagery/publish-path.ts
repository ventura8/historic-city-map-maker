/**
 * Which way a version reaches Mapbox (`docs/research/M7-local-worker.md` §6), decided by the guard step in its
 * transaction: the free Uploads API when the version's Studio file exists and is at most `UPLOADS_FREE_MAX_BYTES`, the
 * month's Uploads API megabytes plus the file stay within `MAPBOX_FREE_UPLOAD_MB`, the layer's tileset was not made by
 * MTS (or linked: its `mapbox.origin` is absent, `uploads` or `studio`) and the path did not fall back for this job
 * already; otherwise MTS behind the compute-unit guard, unchanged. The Uploads path reserves no compute units: the version
 * becomes `publishing` and its job is at Mapbox's door with the path marked `running`.
 */
import {
    MAPBOX_FREE_UPLOAD_MB,
    UPLOADS_FREE_MAX_BYTES,
    jobDocSchema,
    layerVersionDocSchema,
    type JobDoc,
    type LayerDoc,
    type LayerVersionDoc,
    type UsageDoc,
} from '@hcm/shared';

import type { DocumentTransaction } from '../ports/documents.js';
import { UPLOADS_STEP } from './publish-uploads.js';
import { IMAGERY_WRITER, stampOf, withStep } from './records.js';

/** What the choice reads, in the guard's transaction. */
export interface PathFacts {
    readonly job: JobDoc;
    readonly version: LayerVersionDoc;
    readonly layer: LayerDoc | undefined;
    readonly usage: UsageDoc;
}

/** The layer origins whose tileset an upload may replace (none yet, an upload's, a Studio upload's). */
const UPLOADS_ORIGINS: ReadonlySet<string | undefined> = new Set([undefined, 'uploads', 'studio']);

/** The version's Studio file, when it fits the free path. */
function studioBytesOf(version: LayerVersionDoc): number | undefined {
    const output = version.output;
    return output?.studioPath === undefined ? undefined : output.studioBytes;
}

/** The file fits the free path and the month's allowance. */
function fitsAllowance(bytes: number | undefined, usage: UsageDoc): boolean {
    return bytes !== undefined && bytes <= UPLOADS_FREE_MAX_BYTES && (usage.uploadsApiMb ?? 0) + bytes / 1e6 <= MAPBOX_FREE_UPLOAD_MB;
}

/** The path fell back to MTS for this job already. */
function fellBack(job: JobDoc): boolean {
    return job.steps?.[UPLOADS_STEP]?.status === 'skipped';
}

/** The layer's tileset may be replaced by an upload (it has none yet, or an upload or Studio made it). */
function originAllows(layer: LayerDoc | undefined): boolean {
    return UPLOADS_ORIGINS.has(layer?.mapbox?.origin);
}

/** The way this version reaches Mapbox. */
export function publishPathOf(facts: PathFacts): 'uploads' | 'mts' {
    const open = !fellBack(facts.job) && originAllows(facts.layer);
    return open && fitsAllowance(studioBytesOf(facts.version), facts.usage) ? 'uploads' : 'mts';
}

/** The Uploads path taken: the version `publishing`, the job at Mapbox's door with the path marked; no reservation. */
export async function takeUploads(
    transaction: DocumentTransaction,
    paths: { readonly job: string; readonly version: string },
    facts: PathFacts,
    now: Date,
): Promise<'publish'> {
    const stamp = stampOf(IMAGERY_WRITER, now);
    await transaction.set(paths.version, layerVersionDocSchema, { ...facts.version, state: 'publishing', ...stamp });
    const job = withStep({ ...facts.job, status: 'mts_processing', waitReason: 'mapbox', ...stamp }, 'guard', 'done', stamp.updatedAt);
    const steps = { ...job.steps, [UPLOADS_STEP]: { status: 'running' as const, startedAt: stamp.updatedAt } };
    await transaction.set(paths.job, jobDocSchema, { ...job, steps });
    return 'publish';
}
