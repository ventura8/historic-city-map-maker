/**
 * In-memory fakes of the M3 ports (`docs/research/M3-interfaces.md` §9.3) for the imagery handler tests: USGS scene
 * search and download options scripted per dataset, guarded remote files scripted per address (refusing what the
 * adapter refuses), the Mapbox Tilesets API with its sources, tilesets and publish jobs, and a `BlobReader` over the
 * memory blob store. Each records its calls (`recorder`) and fails on demand (`recorder.failNext`).
 */
import { isIP } from 'node:net';
import { Readable } from 'node:stream';

import type { BlobReader } from '../../src/ports/blob-reader.js';
import type { BlobStore, BucketRole } from '../../src/ports/blob-store.js';
import { UpstreamError } from '../../src/ports/errors.js';
import type { MapboxTilesets, MtsJob, MtsJobSummary } from '../../src/ports/mapbox-tilesets.js';
import type { RemoteFile, RemoteFiles } from '../../src/ports/remote-files.js';
import type { DatasetIds, DownloadOption, UsgsScenes } from '../../src/ports/usgs-scenes.js';
import { PortRecorder, promised } from './recorder.js';

export type SceneRecord = Awaited<ReturnType<UsgsScenes['search']>>['records'][number];

/** A `scene-search` record over Bucharest (the fixture's frame), scanned, with a browse image on USGS's host. */
export function sceneRecord(entityId: string, overrides: Partial<SceneRecord> = {}): SceneRecord {
    return {
        entityId,
        displayId: entityId,
        acquisitionDate: '1966-07-12',
        footprint: [
            [25.95, 44.35],
            [26.25, 44.35],
            [26.25, 44.52],
            [25.95, 44.52],
            [25.95, 44.35],
        ],
        cloudCover: null,
        downloadAvailable: true,
        browseUrl: `https://ims.cr.usgs.gov/browse/declass1/${entityId}.jpg`,
        metadata: {},
        ...overrides,
    };
}

/** What `dataset-search` answers by default (M4): the two ids the shared fixture records; `declassiii` has none. */
const EE_DATASETS: readonly DatasetIds[] = [
    { alias: 'corona2', datasetId: '5e839febdccb64b3' },
    { alias: 'declassii', datasetId: '5e839ff7d71d4811' },
];

/** A record inside the request's acquisition window (absent ends are open). */
function within(record: SceneRecord, { from, to }: { readonly from?: string; readonly to?: string }): boolean {
    const date = record.acquisitionDate;
    return (from === undefined || date >= from) && (to === undefined || date <= to);
}

/**
 * `UsgsScenes` answering `records[dataset]` in pages of the request's `maxResults`; a dataset without records answers
 * none, a dataset in `failing` throws its error. `options` holds `download-options` answers by entity id (an unknown
 * entity is not available); `datasetIds` is what `dataset-search` answers (M4).
 */
export function createFakeUsgsScenes(records: Readonly<Record<string, readonly SceneRecord[]>> = {}) {
    const recorder = new PortRecorder<'search' | 'downloadOptions' | 'datasets'>();
    const options = new Map<string, DownloadOption>();
    const failing = new Map<string, UpstreamError>();
    const datasetIds: DatasetIds[] = [...EE_DATASETS];
    const scenes: UsgsScenes = {
        search: (apiKey, request) =>
            promised(() => {
                recorder.enter('search', [apiKey, request]);
                const failure = failing.get(request.dataset);
                if (failure !== undefined) {
                    throw failure;
                }
                const all = (records[request.dataset] ?? []).filter((record) => within(record, request));
                const start = (request.startingNumber ?? 1) - 1;
                const page = all.slice(start, start + request.maxResults);
                const nextRecord = start + page.length + 1;
                return nextRecord <= all.length
                    ? { records: page, totalHits: all.length, next: nextRecord }
                    : { records: page, totalHits: all.length };
            }),
        downloadOptions: (apiKey, dataset, entityIds) =>
            promised(() => {
                recorder.enter('downloadOptions', [apiKey, dataset, entityIds]);
                return entityIds.map((entityId) => options.get(entityId) ?? { entityId, available: false, bytes: 0 });
            }),
        datasets: (apiKey) =>
            promised(() => {
                recorder.enter('datasets', [apiKey]);
                return [...datasetIds];
            }),
    };
    return { scenes, options, failing, datasetIds, recorder };
}

/** The JPEG and PNG magic bytes the browse proxy and the tile probe check. */
export const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);
export const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);

/**
 * `RemoteFiles` answering `files` by address; the rest is `notFound`. Like the adapter it refuses (`forbidden`, no
 * status) an address that is not https on port 443, an IP literal, or a host `allowedHosts` does not list, before any
 * request (the adapter's DNS check of private addresses has its own tests).
 */
export function createFakeRemoteFiles() {
    const files = new Map<string, RemoteFile | UpstreamError>();
    const recorder = new PortRecorder<'get'>();
    const fetched: string[] = [];
    const remote: RemoteFiles = {
        get: (url, limits) =>
            promised(() => {
                recorder.enter('get', [url, limits]);
                const parsed = new URL(url);
                const literal = isIP(parsed.hostname.replace(/^\[|\]$/g, '')) !== 0;
                const allowed = (limits.allowedHosts ?? [parsed.hostname]).includes(parsed.hostname);
                if (parsed.protocol !== 'https:' || parsed.port !== '' || literal || !allowed) {
                    throw new UpstreamError('remote', 'forbidden');
                }
                fetched.push(url);
                const found = files.get(url) ?? new UpstreamError('remote', 'notFound', { status: 404 });
                if (found instanceof UpstreamError) {
                    throw found;
                }
                return found;
            }),
    };
    const serve = (url: string, bytes: Uint8Array, contentType = 'image/jpeg', status = 200): void => {
        files.set(url, { status, contentType, bytes });
    };
    return { remote, files, fetched, serve, recorder };
}

type TilesetMethod =
    'listTilesets' | 'uploadSource' | 'upsertTileset' | 'publish' | 'job' | 'listJobs' | 'tileJson' | 'deleteTileset' | 'deleteSource';

/**
 * `MapboxTilesets` of one account: uploaded sources (their bytes counted from the stream), tilesets with their recipes,
 * publish jobs that answer `outcomes` in order on each poll (`processing` once they are used up: a test pushes more),
 * and the TileJSON of every tileset with a recipe. `token` must be the tiles token, else `unauthorized`.
 */
export function createFakeMapboxTilesets(user = 'e2e-mapbox', token = 'sk.e2e-tiles-token') {
    const recorder = new PortRecorder<TilesetMethod>();
    const sources = new Map<string, number>();
    const tilesets = new Map<string, { readonly name: string; readonly recipe: Readonly<Record<string, unknown>> }>();
    const outcomes: MtsJob[] = [];
    const published: string[] = [];
    const listed: { id: string; name?: string; created?: string }[] = [];
    /** The publish jobs `listJobs` answers, newest first (a test adds the ones a lost answer left at Mapbox). */
    const jobs: MtsJobSummary[] = [];
    /** What `publish` answers instead of a job, once each (an error thrown after Mapbox took the job, say). */
    const publishFailures: Error[] = [];
    const check = (given: string): void => {
        if (given !== token) {
            throw new UpstreamError('mapbox', 'unauthorized', { status: 401 });
        }
    };
    const tilesetsPort: MapboxTilesets = {
        listTilesets: (owner, given, limit) =>
            promised(() => {
                recorder.enter('listTilesets', [owner, limit]);
                check(given);
                return [...listed, ...[...tilesets].map(([id, tileset]) => ({ id, name: tileset.name }))].slice(0, limit);
            }),
        uploadSource: async (owner, given, sourceId, file) => {
            recorder.enter('uploadSource', [owner, sourceId, file.bytes, file.contentType]);
            check(given);
            let bytes = 0;
            for await (const chunk of await file.open()) {
                bytes += (chunk as Uint8Array).length;
            }
            sources.set(`${owner}/${sourceId}`, bytes);
            return { bytes };
        },
        upsertTileset: (given, tilesetId, request) =>
            promised(() => {
                recorder.enter('upsertTileset', [tilesetId, request]);
                check(given);
                const existed = tilesets.has(tilesetId);
                tilesets.set(tilesetId, { name: request.name, recipe: request.recipe });
                return existed ? 'updated' : 'created';
            }),
        publish: (given, tilesetId) =>
            promised(() => {
                recorder.enter('publish', [tilesetId]);
                check(given);
                published.push(tilesetId);
                const jobId = `mts-job-${String(published.length)}`;
                jobs.unshift({ id: jobId, stage: 'queued', createdAt: Date.parse('2026-10-23T08:00:00.000Z') + published.length });
                const failure = publishFailures.shift();
                if (failure !== undefined) {
                    throw failure;
                }
                return { jobId };
            }),
        job: (given, tilesetId, jobId) =>
            promised(() => {
                recorder.enter('job', [tilesetId, jobId]);
                check(given);
                return outcomes.shift() ?? { stage: 'processing', errors: [] };
            }),
        listJobs: (given, tilesetId, limit) =>
            promised(() => {
                recorder.enter('listJobs', [tilesetId, limit]);
                check(given);
                return jobs.slice(0, limit);
            }),
        tileJson: (given, tilesetId) =>
            promised(() => {
                recorder.enter('tileJson', [tilesetId]);
                check(given);
                const recipe = tilesets.get(tilesetId)?.recipe;
                if (recipe === undefined) {
                    throw new UpstreamError('mapbox', 'notFound', { status: 404 });
                }
                return { minzoom: Number(recipe['minzoom']), maxzoom: Number(recipe['maxzoom']) };
            }),
        deleteTileset: (given, tilesetId) =>
            promised(() => {
                recorder.enter('deleteTileset', [tilesetId]);
                check(given);
                tilesets.delete(tilesetId);
            }),
        deleteSource: (owner, given, sourceId) =>
            promised(() => {
                recorder.enter('deleteSource', [owner, sourceId]);
                check(given);
                sources.delete(`${owner}/${sourceId}`);
            }),
    };
    return {
        tilesets: tilesetsPort,
        user,
        token,
        sources,
        recipes: tilesets,
        outcomes,
        published,
        listed,
        jobs,
        publishFailures,
        recorder,
    };
}

/** `BlobReader` over a `BlobStore` fake: `open` streams a copy of the object, `range` slices it. */
export function createMemoryBlobReader(blobs: BlobStore) {
    const recorder = new PortRecorder<'open' | 'range'>();
    const reader: BlobReader = {
        open: async (bucket: BucketRole, path: string) => {
            recorder.enter('open', [bucket, path]);
            const [bytes, metadata] = await Promise.all([blobs.read(bucket, path), blobs.stat(bucket, path)]);
            return { bytes: bytes.length, contentType: metadata?.contentType ?? 'application/octet-stream', body: Readable.from([bytes]) };
        },
        range: async (bucket, path, start, end) => {
            recorder.enter('range', [bucket, path, start, end]);
            return (await blobs.read(bucket, path)).slice(start, end);
        },
    };
    return { reader, recorder };
}
