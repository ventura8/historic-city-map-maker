/**
 * Publishing, photo processing and the scheduler (`docs/research/M2-interfaces.md` §3.5–§3.7; scenarios A08, A10).
 * The manifest is rebuilt by one serialized, debounced task-queue function (security review §4.5), requested by the
 * content triggers and by the admin's `publish.rebuildManifest`; photos are processed by the Storage trigger
 * `photos.onUpload`; `ops.tick` runs every 15 minutes.
 */
import { z } from 'zod';

import { cityIdSchema } from '../schemas/paths.js';
import { idSchema } from '../schemas/primitives.js';

/** The task queue of the manifest builder (`publish.buildManifest`, `maxConcurrentDispatches: 1`). */
export const MANIFEST_QUEUE = 'publish-buildManifest';
/** Writes within this window share one build (the task id is the same, Cloud Tasks drops the duplicate). */
export const MANIFEST_DEBOUNCE_SECONDS = 60;
export const MANIFEST_CACHE_CONTROL = 'public, max-age=60';
export const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';
/** The custom metadata key `photos.onUpload` writes on every public derivative (ISO time); `ops.tick` keeps fresh ones. */
export const DERIVATIVE_WRITTEN_AT = 'writtenAt';
/** Above this gzip size the builder splits the manifest (security review §4.5); not reached before 2,000 photos. */
export const MANIFEST_SPLIT_BYTES = 2_000_000;
/** Public objects of an unpublished photo are deleted this long after the manifest stops naming them. */
export const UNPUBLISH_DELETE_MINUTES = 10;

const DEBOUNCE_MS = MANIFEST_DEBOUNCE_SECONDS * 1000;

/** The Cloud Tasks id of the build `now` falls into: `manifest-<city>-<minute bucket>`. */
export function manifestTaskId(cityId: string, now: Date): string {
    return `manifest-${cityId}-${String(Math.floor(now.getTime() / DEBOUNCE_MS))}`;
}

/** `publish.rebuildManifest` (admin): `full` rebuilds from every document instead of the changes since the last build. */
export const rebuildManifestRequestSchema = z.strictObject({ cityId: cityIdSchema, full: z.boolean().optional() });
export const rebuildManifestResponseSchema = z.strictObject({
    requestedVersion: z.number().int().min(1),
    /** False when a build of this window was already queued (it will include this request). */
    queued: z.boolean(),
});

/** The payload of a `publish.buildManifest` task. */
export const buildManifestTaskSchema = z.strictObject({
    cityId: cityIdSchema,
    requestedVersion: z.number().int().min(1),
    full: z.boolean(),
});

/** Limits of `photos.onUpload` (security review §1.5): the derivatives and what the server refuses. */
export const PHOTO_LIMITS = {
    maxUploadBytes: 60 * 1024 * 1024,
    maxInputPixels: 200_000_000,
    webLongEdge: 2048,
    thumbLongEdge: 400,
    webQuality: 82,
    thumbQuality: 72,
} as const;

/** `photos.reprocess` (admin): run the processing again on the photo's latest original or upload. */
export const reprocessPhotoRequestSchema = z.strictObject({ cityId: cityIdSchema, photoId: idSchema });
export const reprocessPhotoResponseSchema = z.strictObject({ processing: z.literal('pending') });

/** `ops.tick`: the Cloud Scheduler expression (one job, inside the free allowance of three). */
export const OPS_TICK_SCHEDULE = 'every 15 minutes';
/** Signed-in accounts without an `admins/{uid}` document are deleted after this long (security review §5, GDPR). */
export const STALE_USER_HOURS = 24;
/** The nightly full manifest rebuild runs on the first tick after this hour (UTC). */
export const NIGHTLY_HOUR_UTC = 2;

export type RebuildManifestRequest = z.infer<typeof rebuildManifestRequestSchema>;
export type RebuildManifestResponse = z.infer<typeof rebuildManifestResponseSchema>;
export type BuildManifestTask = z.infer<typeof buildManifestTaskSchema>;
