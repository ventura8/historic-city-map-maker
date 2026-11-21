/**
 * The `manifests` step of `ops.tick` (`docs/research/M2-interfaces.md` §3.7, security review §4.5): once a day after
 * `NIGHTLY_HOUR_UTC`, a full rebuild of every published city's manifest (it catches any write a trigger missed) and the
 * sweep of public photo files nothing uses any more.
 */
import {
    DERIVATIVE_WRITTEN_AT,
    FIRESTORE_PATHS,
    MANIFEST_DEBOUNCE_SECONDS,
    MANIFEST_QUEUE,
    NIGHTLY_HOUR_UTC,
    STORAGE_PATHS,
    UNPUBLISH_DELETE_MINUTES,
    cityDocSchema,
    manifestStateDocSchema,
    manifestTaskId,
    photoDocSchema,
    publicObjectUrl,
    timestampToDate,
    type ManifestStateDoc,
    type TimestampLike,
} from '@hcm/shared';

import { UpstreamError } from '../ports/errors.js';
import type { Ports } from '../ports/index.js';

export type ManifestsDeps = Pick<Ports, 'log' | 'config' | 'documents' | 'blobs' | 'tasks'>;

const MINUTE_MS = 60_000;
const SETTLE_MS = UNPUBLISH_DELETE_MINUTES * MINUTE_MS;

/** Due on the first tick at or after `NIGHTLY_HOUR_UTC` of a UTC day that has had no nightly run yet. */
export function isNightlyDue(now: Date, lastNightlyAt: Date | undefined): boolean {
    const today = now.toISOString().slice(0, 10);
    return now.getUTCHours() >= NIGHTLY_HOUR_UTC && (lastNightlyAt === undefined || lastNightlyAt.toISOString().slice(0, 10) < today);
}

function olderThanSettle(time: TimestampLike | undefined, now: Date): boolean {
    return time !== undefined && now.getTime() - timestampToDate(time).getTime() >= SETTLE_MS;
}

/** The object paths of the public URLs the city's served manifest names (none when there is no manifest). */
async function servedPaths(deps: ManifestsDeps, cityId: string): Promise<ReadonlySet<string>> {
    const prefix = publicObjectUrl(deps.config.buckets.public, '');
    try {
        const manifest = JSON.parse(new TextDecoder().decode(await deps.blobs.read('public', STORAGE_PATHS.manifest(cityId)))) as {
            readonly photos?: readonly { readonly image?: { readonly web?: unknown; readonly thumb?: unknown } }[];
        };
        const urls = (manifest.photos ?? []).flatMap((photo) => [photo.image?.web, photo.image?.thumb]);
        return new Set(urls.flatMap((url) => (typeof url === 'string' && url.startsWith(prefix) ? [url.slice(prefix.length)] : [])));
    } catch (error) {
        if (error instanceof UpstreamError && error.failure === 'notFound') {
            return new Set();
        }
        throw error;
    }
}

/** The derivative paths the photo documents point at, and the photo ids whose documents cannot be read (kept whole). */
async function referenced(
    deps: ManifestsDeps,
    cityId: string,
): Promise<{ readonly paths: ReadonlySet<string>; readonly photoIds: ReadonlySet<string> }> {
    const prefix = publicObjectUrl(deps.config.buckets.public, '');
    const photos = await deps.documents.query(FIRESTORE_PATHS.photos(cityId), photoDocSchema);
    const urls = photos.documents.flatMap(({ data }) => (data.image === undefined ? [] : [data.image.web, data.image.thumb]));
    return {
        paths: new Set(urls.filter((url) => url.startsWith(prefix)).map((url) => url.slice(prefix.length))),
        photoIds: new Set(photos.invalid.map((photo) => photo.id)),
    };
}

/** No build running, and the last one at least the settle time ago: no cached manifest names a swept file any more. */
function settled(state: ManifestStateDoc | undefined, now: Date): boolean {
    return state?.status !== 'building' && olderThanSettle(state?.builtAt, now);
}

/** A derivative written before the settle time (one without the metadata predates it). */
async function isStale(deps: ManifestsDeps, path: string, now: Date): Promise<boolean> {
    const writtenAt = (await deps.blobs.stat('public', path))?.customMetadata[DERIVATIVE_WRITTEN_AT];
    return writtenAt === undefined || now.getTime() - Date.parse(writtenAt) >= SETTLE_MS;
}

/** A derivative is gone for good once no document and no served manifest names it, and it is older than the settle time. */
async function sweepCity(deps: ManifestsDeps, cityId: string, now: Date): Promise<number> {
    if (!settled(await deps.documents.get(FIRESTORE_PATHS.manifestState(cityId), manifestStateDocSchema), now)) {
        return 0;
    }
    const served = await servedPaths(deps, cityId);
    const kept = await referenced(deps, cityId);
    const candidates = (await deps.blobs.list('public', `photos/${cityId}/`)).filter(
        (path) => !served.has(path) && !kept.paths.has(path) && !kept.photoIds.has(String(path.split('/')[2])),
    );
    let deleted = 0;
    for (const path of candidates) {
        if (await isStale(deps, path, now)) {
            await deps.blobs.delete('public', path);
            deleted += 1;
        }
    }
    return deleted;
}

/**
 * The nightly work: one full build per published city (its own one-minute task window, so a build already queued for
 * that minute takes the request), then the sweep. Returns the time to record as `lastNightlyAt`, or nothing when the
 * nightly run is not due.
 */
export async function nightlyManifests(deps: ManifestsDeps, now: Date, lastNightlyAt: Date | undefined): Promise<Date | undefined> {
    if (!isNightlyDue(now, lastNightlyAt)) {
        return undefined;
    }
    const cities = await deps.documents.query(FIRESTORE_PATHS.cities, cityDocSchema, { where: [['published', '==', true]] });
    for (const { id } of cities.documents) {
        await deps.tasks.enqueue(
            MANIFEST_QUEUE,
            { cityId: id, requestedVersion: 1, full: true },
            { id: manifestTaskId(id, now), delaySeconds: MANIFEST_DEBOUNCE_SECONDS },
        );
        const deleted = await sweepCity(deps, id, now);
        deps.log.info('nightly manifest work', { cityId: id, deletedObjects: deleted });
    }
    return now;
}
