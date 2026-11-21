import { runAs } from '../global-options.js';

import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

import {
    FIRESTORE_PATHS,
    MANIFEST_CACHE_CONTROL,
    MANIFEST_DEBOUNCE_SECONDS,
    MANIFEST_QUEUE,
    MANIFEST_SPLIT_BYTES,
    STORAGE_PATHS,
    buildManifestTaskSchema,
    cityDocSchema,
    layerDocSchema,
    manifestStateDocSchema,
    manifestTaskId,
    photoDocSchema,
    poiCategoryDocSchema,
    poiDocSchema,
    publicObjectUrl,
    storyDocSchema,
    systemWriter,
    timestampFromDate,
    validate,
    type ApiErrorCode,
    type BuildManifestTask,
    type CityDoc,
    type ManifestStateDoc,
    type ValidationIssue,
} from '@hcm/shared';
import { onTaskDispatched } from 'firebase-functions/tasks';

import { UpstreamError } from '../ports/errors.js';
import type { Ports } from '../ports/index.js';
import { assembleManifest, type CityContent, type SkippedDocument } from './assemble.js';
import { ensureCityIcon } from './icon.js';

export type BuildDeps = Pick<Ports, 'log' | 'clock' | 'config' | 'documents' | 'blobs' | 'tasks' | 'images'>;

/** At most this many skipped documents are listed on `manifests/{city}` (the schema's limit). */
const MAX_LISTED_SKIPS = 100;

type Counts = NonNullable<ManifestStateDoc['counts']>;

type BuildResult =
    | {
          readonly kind: 'published';
          readonly url: string;
          readonly sha256: string;
          readonly bytes: number;
          readonly counts: Counts;
          readonly skipped: readonly SkippedDocument[];
      }
    | { readonly kind: 'unpublished' }
    | {
          readonly kind: 'failed';
          readonly error: ApiErrorCode;
          readonly skipped: readonly SkippedDocument[];
          /** A transient failure, thrown again once recorded so Cloud Tasks retries the build. */
          readonly retry?: UpstreamError;
      };

export type BuildOutcome = BuildResult['kind'];

const PUBLISHED_ONLY = { where: [['published', '==', true]] } as const;

async function readContent(deps: BuildDeps, cityId: string, city: CityDoc): Promise<CityContent> {
    const [layers, photos, poiCategories, pois, stories] = await Promise.all([
        deps.documents.query(FIRESTORE_PATHS.layers(cityId), layerDocSchema, PUBLISHED_ONLY),
        deps.documents.query(FIRESTORE_PATHS.photos(cityId), photoDocSchema, PUBLISHED_ONLY),
        deps.documents.query(FIRESTORE_PATHS.poiCategories(cityId), poiCategoryDocSchema),
        deps.documents.query(FIRESTORE_PATHS.pois(cityId), poiDocSchema, PUBLISHED_ONLY),
        deps.documents.query(FIRESTORE_PATHS.stories(cityId), storyDocSchema, PUBLISHED_ONLY),
    ]);
    return { cityId, city, layers, photos, poiCategories, pois, stories };
}

/** A manifest the city itself keeps from publishing: no public token yet (Connect Mapbox), or another city issue. */
function cityRefused(
    deps: BuildDeps,
    cityId: string,
    issues: readonly ValidationIssue[],
    skipped: readonly SkippedDocument[],
): BuildResult {
    deps.log.warn('manifest refused', { cityId, issues: issues.map((issue) => `${issue.path}: ${issue.code}`).join(', ') });
    const tokenMissing = issues.some((issue) => issue.path.startsWith('city.mapbox'));
    return { kind: 'failed', error: tokenMissing ? 'apiError.mapbox.notConfigured' : 'apiError.invalidRequest', skipped };
}

/** The manifest as gzip JSON with a 60-second cache (security review §1.5); a warning above the split size (§4.5). */
async function upload(deps: BuildDeps, cityId: string, json: string): Promise<{ readonly url: string; readonly bytes: number }> {
    const path = STORAGE_PATHS.manifest(cityId);
    const gzip = gzipSync(json, { level: 9 });
    if (gzip.byteLength > MANIFEST_SPLIT_BYTES) {
        deps.log.warn('manifest above the split size', { cityId, bytes: gzip.byteLength, limit: MANIFEST_SPLIT_BYTES });
    }
    await deps.blobs.write('public', path, gzip, {
        contentType: 'application/json',
        contentEncoding: 'gzip',
        cacheControl: MANIFEST_CACHE_CONTROL,
    });
    return { url: publicObjectUrl(deps.config.buckets.public, path), bytes: gzip.byteLength };
}

/** Reads, assembles and uploads; an unpublished or deleted city has its manifest removed. */
async function buildFrom(deps: BuildDeps, cityId: string): Promise<BuildResult> {
    const city = await deps.documents.get(FIRESTORE_PATHS.city(cityId), cityDocSchema);
    if (city?.published !== true) {
        await deps.blobs.delete('public', STORAGE_PATHS.manifest(cityId));
        return { kind: 'unpublished' };
    }
    const assembly = assembleManifest(await readContent(deps, cityId, city), deps.config.errorEndpoint, { adminUrl: deps.config.adminUrl });
    if (!assembly.ok) {
        return cityRefused(deps, cityId, assembly.issues, assembly.skipped);
    }
    const json = JSON.stringify(assembly.manifest);
    const stored = await upload(deps, cityId, json);
    const sha256 = createHash('sha256').update(json).digest('hex');
    return { kind: 'published', ...stored, sha256, counts: assembly.counts, skipped: assembly.skipped };
}

/** Storage, Firestore or Cloud Tasks not answering: worth another attempt. */
function transientError(error: unknown): UpstreamError | undefined {
    return error instanceof UpstreamError && ['unavailable', 'rateLimited'].includes(error.failure) ? error : undefined;
}

/** A transient failure is retried by Cloud Tasks; anything else is recorded and left for the next build. */
function failed(deps: BuildDeps, cityId: string, error: unknown): BuildResult {
    const retry = transientError(error);
    deps.log.error('manifest build failed', { cityId, error: String(error), transient: retry !== undefined });
    return retry === undefined
        ? { kind: 'failed', error: 'apiError.internal', skipped: [] }
        : { kind: 'failed', error: 'apiError.unavailable', skipped: [], retry };
}

function skippedField(skipped: readonly SkippedDocument[]): Pick<ManifestStateDoc, 'skipped'> {
    return skipped.length === 0 ? {} : { skipped: skipped.slice(0, MAX_LISTED_SKIPS) };
}

const LAST_GOOD_FIELDS = ['builtAt', 'url', 'sha256', 'bytes', 'counts'] as const;

type LastGood = Required<Pick<ManifestStateDoc, (typeof LAST_GOOD_FIELDS)[number]>>;

/** A published build writes these five together. */
function hasLastGood(state: ManifestStateDoc | undefined): state is ManifestStateDoc & LastGood {
    return LAST_GOOD_FIELDS.every((field) => state?.[field] !== undefined);
}

/** What a failed build keeps of the last published one: the manifest that is still served. */
function lastGood(current: ManifestStateDoc | undefined): Partial<LastGood> {
    if (!hasLastGood(current)) {
        return {};
    }
    const { builtAt, url, sha256, bytes, counts } = current;
    return { builtAt, url, sha256, bytes, counts };
}

interface StateBase {
    readonly requestedVersion: number;
    readonly builtVersion: number;
    readonly updatedBy: string;
    readonly updatedAt: ManifestStateDoc['updatedAt'];
}

/** A failed build changes nothing that was published: the last good fields and `builtVersion` stay. */
function failedState(current: ManifestStateDoc | undefined, base: StateBase, result: BuildResult & { kind: 'failed' }): ManifestStateDoc {
    const builtVersion = current?.builtVersion ?? 0;
    return { ...lastGood(current), ...base, builtVersion, status: 'failed', error: result.error, ...skippedField(result.skipped) };
}

/** The state after the build that started from `startedFrom` (the race guard: `builtVersion` never goes back). */
function stateAfter(current: ManifestStateDoc | undefined, base: StateBase, startedFrom: number, result: BuildResult): ManifestStateDoc {
    const status = base.requestedVersion > startedFrom ? 'queued' : 'idle';
    switch (result.kind) {
        case 'published': {
            const { url, sha256, bytes, counts } = result;
            return { ...base, status, builtAt: base.updatedAt, url, sha256, bytes, counts, ...skippedField(result.skipped) };
        }
        case 'unpublished':
            return { ...base, status, builtAt: base.updatedAt };
        case 'failed':
            return failedState(current, base, result);
    }
}

function stamp(deps: BuildDeps): Pick<ManifestStateDoc, 'updatedBy' | 'updatedAt'> {
    return { updatedBy: systemWriter('publish'), updatedAt: timestampFromDate(deps.clock.now()) };
}

/** `status: 'building'`; the version the build starts from is the latest request (or the task's, on a fresh city). */
async function startBuild(deps: BuildDeps, task: BuildManifestTask): Promise<number> {
    const path = FIRESTORE_PATHS.manifestState(task.cityId);
    return deps.documents.transaction(async (transaction) => {
        const current = await transaction.get(path, manifestStateDocSchema);
        const requestedVersion = Math.max(current?.requestedVersion ?? 0, task.requestedVersion);
        await transaction.set(path, manifestStateDocSchema, {
            ...(current ?? { builtVersion: 0 }),
            requestedVersion,
            status: 'building',
            ...stamp(deps),
        });
        return requestedVersion;
    });
}

/** Records the result; returns the latest requested version (a write during the build raised it). */
async function finishBuild(deps: BuildDeps, cityId: string, startedFrom: number, result: BuildResult): Promise<number> {
    const path = FIRESTORE_PATHS.manifestState(cityId);
    return deps.documents.transaction(async (transaction) => {
        const current = await transaction.get(path, manifestStateDocSchema);
        const base = {
            requestedVersion: Math.max(current?.requestedVersion ?? 0, startedFrom),
            builtVersion: Math.max(current?.builtVersion ?? 0, startedFrom),
            ...stamp(deps),
        };
        await transaction.set(path, manifestStateDocSchema, stateAfter(current, base, startedFrom, result));
        return base.requestedVersion;
    });
}

/**
 * `publish.buildManifest` (`docs/research/M2-interfaces.md` §3.5): one serialized build of the city's manifest from
 * every published document (M2 builds in full; the incremental build waits for a city past 500 documents). A request
 * that arrived while it ran queues the next build (its own task normally does; this catches a lost one). The city's
 * default tab icon is kept first (`./icon.ts`).
 */
export async function buildManifest(deps: BuildDeps, task: BuildManifestTask): Promise<BuildOutcome> {
    const startedFrom = await startBuild(deps, task);
    // The city's default tab icon, before the manifest (its failure is logged, never the build's).
    await ensureCityIcon(deps, task.cityId);
    const result = await buildFrom(deps, task.cityId).catch((error: unknown) => failed(deps, task.cityId, error));
    const requestedVersion = await finishBuild(deps, task.cityId, startedFrom, result);
    if (result.kind === 'failed' && result.retry !== undefined) {
        throw result.retry;
    }
    if (result.kind !== 'failed' && requestedVersion > startedFrom) {
        const now = deps.clock.now();
        await deps.tasks.enqueue(
            MANIFEST_QUEUE,
            { cityId: task.cityId, requestedVersion, full: true },
            { id: manifestTaskId(task.cityId, now), delaySeconds: MANIFEST_DEBOUNCE_SECONDS },
        );
    }
    deps.log.info('manifest build finished', { cityId: task.cityId, outcome: result.kind, startedFrom, requestedVersion });
    return result.kind;
}

/**
 * `publish-buildManifest` (task queue): one dispatch at a time, so builds never race; five attempts with backoff for a
 * transient failure. A payload the schema refuses is logged and dropped (a retry would refuse it again).
 */
export function buildManifestFunction(getDeps: () => BuildDeps) {
    return onTaskDispatched(
        {
            retryConfig: { maxAttempts: 5, minBackoffSeconds: 30 },
            rateLimits: { maxConcurrentDispatches: 1 },
            memory: '512MiB',
            timeoutSeconds: 300,
            maxInstances: 1,
            ...runAs('publish.buildManifest'),
        },
        async (request) => {
            const deps = getDeps();
            const task = validate(buildManifestTaskSchema, request.data);
            if (!task.ok) {
                deps.log.error('manifest build task refused', { issues: task.issues.length });
                return;
            }
            await buildManifest(deps, task.value);
        },
    );
}
