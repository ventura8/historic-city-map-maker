/**
 * The Mapbox Tilesets API (MTS, `/tilesets/v1`) and TileJSON (`/v4/{tileset}.json`) over REST with `fetch`
 * (`docs/research/M3-interfaces.md` §7.3; CR-M3-4: the tilesets list moved here from `mapbox.ts`). The tiles secret token
 * travels as the `access_token` query parameter, as Mapbox requires, so no URL is ever logged or put in an error.
 *
 * - A source is **replaced**: deleted first (a missing one is fine), then created (`POST /sources/{user}/{id}`, which on
 *   an existing source would append the file, and the tileset would mosaic both), streamed as `multipart/form-data` from
 *   the private bucket with its length known, never held in memory, with a long timeout of its own.
 * - A tileset is created with its recipe, or, when it exists, its recipe is replaced (`PATCH …/recipe`).
 * - Deleting a missing tileset or source is not an error.
 *
 * Failures (`UpstreamError('mapbox', …)`): 401 → `unauthorized`; 403 → `forbidden`; 404 → `notFound`; 400, 413, 422 →
 * `invalid` (413 keeps its status: the publisher reads it as a source too large); 429 → `rateLimited`; 5xx, network,
 * timeout → `unavailable`; an unreadable answer → `invalid`. **UNVERIFIED** (no Mapbox account may be called from a
 * test): the raster source upload's exact form and limits, and the recipe endpoint's answers.
 */
import { Readable } from 'node:stream';

import { UpstreamError } from '../ports/errors.js';
import type { MapboxTilesets, MtsJobSummary } from '../ports/mapbox-tilesets.js';
import { at, list, readJson, send, stringAt, strings, upstreamError, type Fetch } from './upstream-http.js';

export const MAPBOX_API = 'https://api.mapbox.com';

const SERVICE = 'mapbox';
/** A COG of a few hundred megabytes takes minutes to stream; the publish task itself may run 30. */
const UPLOAD_TIMEOUT_MS = 25 * 60 * 1000;
const BOUNDARY = 'hcm-tileset-source-boundary';

type SourceFile = Parameters<MapboxTilesets['uploadSource']>[3];
type MtsJob = Awaited<ReturnType<MapboxTilesets['job']>>;

const STAGES: readonly MtsJob['stage'][] = ['queued', 'processing', 'success', 'failed'];

function apiUrl(path: string, token: string, query: Readonly<Record<string, string>> = {}): string {
    const url = new URL(path, MAPBOX_API);
    for (const [name, value] of Object.entries(query)) {
        url.searchParams.set(name, value);
    }
    url.searchParams.set('access_token', token);
    return url.toString();
}

const segment = (value: string): string => encodeURIComponent(value);

function invalid(): UpstreamError {
    return new UpstreamError(SERVICE, 'invalid');
}

/** The multipart body around the file: its head and its tail, so the length is known before streaming. */
function multipart(file: SourceFile): { readonly head: Uint8Array; readonly tail: Uint8Array; readonly length: number } {
    const encoder = new TextEncoder();
    const head = encoder.encode(
        `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="source.tif"\r\nContent-Type: ${file.contentType}\r\n\r\n`,
    );
    const tail = encoder.encode(`\r\n--${BOUNDARY}--\r\n`);
    return { head, tail, length: head.length + file.bytes + tail.length };
}

/** The file between the multipart head and tail, as a web stream `fetch` can send. */
async function multipartStream(file: SourceFile, parts: ReturnType<typeof multipart>): Promise<ReadableStream<Uint8Array>> {
    const body = await file.open();
    async function* chunks(): AsyncGenerator<Uint8Array> {
        yield parts.head;
        for await (const chunk of body) {
            yield chunk as Uint8Array;
        }
        yield parts.tail;
    }
    return Readable.toWeb(Readable.from(chunks())) as ReadableStream<Uint8Array>;
}

function toStage(value: unknown): MtsJob['stage'] {
    const stage = STAGES.find((candidate) => candidate === value);
    if (stage === undefined) {
        throw invalid();
    }
    return stage;
}

/** `tileset_precisions`: km² per precision, numbers only. */
function precisionsOf(body: unknown): Readonly<Record<string, number>> | undefined {
    const value = at(body, 'tileset_precisions');
    if (typeof value !== 'object' || value === null) {
        return undefined;
    }
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, number] => typeof entry[1] === 'number'));
}

function toJob(body: unknown): MtsJob {
    const precisions = precisionsOf(body);
    const job = { stage: toStage(at(body, 'stage')), errors: strings(at(body, 'errors')) };
    return precisions === undefined ? job : { ...job, precisions };
}

function toZoomRange(body: unknown): { readonly minzoom: number; readonly maxzoom: number } {
    const [minzoom, maxzoom] = [at(body, 'minzoom'), at(body, 'maxzoom')];
    if (typeof minzoom !== 'number' || typeof maxzoom !== 'number') {
        throw invalid();
    }
    return { minzoom, maxzoom };
}

function toTileset(entry: unknown): { id: string; name?: string; created?: string }[] {
    const id = stringAt(entry, 'id');
    if (id === undefined) {
        return [];
    }
    const [name, created] = [stringAt(entry, 'name'), stringAt(entry, 'created')];
    return [{ id, ...(name === undefined ? {} : { name }), ...(created === undefined ? {} : { created }) }];
}

/** One listed MTS job; an entry without an id, a known stage or a creation time is left out. */
function toJobSummary(entry: unknown): MtsJobSummary[] {
    const [id, stage, created] = [
        stringAt(entry, 'id'),
        STAGES.find((candidate) => candidate === at(entry, 'stage')),
        at(entry, 'created'),
    ];
    return id === undefined || stage === undefined || typeof created !== 'number' ? [] : [{ id, stage, createdAt: created }];
}

/** A 400 or 409 whose message says the tileset exists (then its recipe is replaced instead). */
async function alreadyExists(response: Response): Promise<boolean> {
    if (response.status !== 400 && response.status !== 409) {
        return false;
    }
    return /already exists/i.test(stringAt(await readJson(response), 'message') ?? '');
}

/** One JSON call whose answer must be a 2xx. */
async function call(fetchFn: Fetch, method: string, url: string, body?: unknown): Promise<Response> {
    const init: RequestInit =
        body === undefined ? { method } : { method, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } };
    const response = await send(fetchFn, SERVICE, url, init);
    if (!response.ok) {
        throw upstreamError(SERVICE, response);
    }
    return response;
}

/** A DELETE that accepts a missing resource. */
async function remove(fetchFn: Fetch, url: string): Promise<void> {
    const response = await send(fetchFn, SERVICE, url, { method: 'DELETE' });
    if (!response.ok && response.status !== 404) {
        throw upstreamError(SERVICE, response);
    }
}

/** The file streamed as one multipart part, with the length known and the upload's own long timeout. */
async function upload(fetchFn: Fetch, url: string, file: SourceFile): Promise<Response> {
    const parts = multipart(file);
    const init = {
        method: 'POST',
        headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}`, 'content-length': String(parts.length) },
        body: await multipartStream(file, parts),
        duplex: 'half',
        signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    } as RequestInit;
    try {
        return await fetchFn(url, init);
    } catch {
        throw new UpstreamError(SERVICE, 'unavailable');
    }
}

/** Creates the tileset with its recipe, or replaces the recipe of the one that exists. */
async function upsert(
    fetchFn: Fetch,
    url: string,
    request: Parameters<MapboxTilesets['upsertTileset']>[2],
): Promise<'created' | 'updated'> {
    const created = await send(fetchFn, SERVICE, url, {
        method: 'POST',
        body: JSON.stringify(request),
        headers: { 'content-type': 'application/json' },
    });
    if (created.ok) {
        return 'created';
    }
    if (!(await alreadyExists(created.clone()))) {
        throw upstreamError(SERVICE, created);
    }
    const recipeUrl = new URL(url);
    recipeUrl.pathname = `${recipeUrl.pathname}/recipe`;
    await call(fetchFn, 'PATCH', recipeUrl.toString(), request.recipe);
    return 'updated';
}

/** The size Mapbox says it received (the file's own when it says none). */
async function uploadedBytes(response: Response, file: SourceFile): Promise<{ readonly bytes: number }> {
    if (!response.ok) {
        throw upstreamError(SERVICE, response);
    }
    const size = at(await readJson(response), 'file_size');
    return { bytes: typeof size === 'number' ? size : file.bytes };
}

export function createMapboxTilesets(options: { readonly fetch: Fetch }): MapboxTilesets {
    const json = async (method: string, url: string): Promise<unknown> => readJson(await call(options.fetch, method, url));
    const sourceUrl = (user: string, token: string, sourceId: string) =>
        apiUrl(`/tilesets/v1/sources/${segment(user)}/${segment(sourceId)}`, token);
    return {
        listTilesets: async (user, token, limit) => {
            const body = await json('GET', apiUrl(`/tilesets/v1/${segment(user)}`, token, { limit: String(limit) }));
            if (!Array.isArray(body)) {
                throw invalid();
            }
            return list(body).flatMap(toTileset);
        },
        uploadSource: async (user, token, sourceId, file) => {
            const url = sourceUrl(user, token, sourceId);
            await remove(options.fetch, url);
            return uploadedBytes(await upload(options.fetch, url, file), file);
        },
        upsertTileset: (token, tilesetId, request) => upsert(options.fetch, apiUrl(`/tilesets/v1/${segment(tilesetId)}`, token), request),
        publish: async (token, tilesetId) => {
            const jobId = stringAt(await json('POST', apiUrl(`/tilesets/v1/${segment(tilesetId)}/publish`, token)), 'jobId');
            if (jobId === undefined) {
                throw invalid();
            }
            return { jobId };
        },
        job: async (token, tilesetId, jobId) =>
            toJob(await json('GET', apiUrl(`/tilesets/v1/${segment(tilesetId)}/jobs/${segment(jobId)}`, token))),
        listJobs: async (token, tilesetId, limit) => {
            const body = await json('GET', apiUrl(`/tilesets/v1/${segment(tilesetId)}/jobs`, token, { limit: String(limit) }));
            if (!Array.isArray(body)) {
                throw invalid();
            }
            return list(body).flatMap(toJobSummary);
        },
        tileJson: async (token, tilesetId) => toZoomRange(await json('GET', apiUrl(`/v4/${segment(tilesetId)}.json`, token))),
        deleteTileset: (token, tilesetId) => remove(options.fetch, apiUrl(`/tilesets/v1/${segment(tilesetId)}`, token)),
        deleteSource: (user, token, sourceId) => remove(options.fetch, sourceUrl(user, token, sourceId)),
    };
}
