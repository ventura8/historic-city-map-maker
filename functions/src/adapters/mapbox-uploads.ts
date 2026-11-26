/**
 * Mapbox's Uploads API over REST with `fetch` (`docs/research/M7-local-worker.md` §6): the temporary S3 credentials, the
 * S3 `PUT` of the file (streamed with its length known, signed with SigV4 in `us-east-1` with an unsigned payload, its
 * own long timeout), the upload that makes the tileset, and its status. The tiles secret token travels as the
 * `access_token` query parameter, as Mapbox requires, and the temporary credentials only in the signed headers, so no URL,
 * header or body is ever logged or put in an error.
 *
 * Failures (`UpstreamError('mapbox', …)`, the S3 `PUT`'s too): 401 → `unauthorized`; 403 → `forbidden` (a token without
 * `uploads:write`, or credentials S3 refuses); 404 → `notFound`; 400, 422 → `invalid`; 429 → `rateLimited`; 5xx,
 * network, timeout → `unavailable`; an unreadable answer → `invalid`. **UNVERIFIED** (no Mapbox account may be called
 * from a test): the answers' exact shape beyond the documented fields, and the replacement of an Uploads-made tileset.
 */
import { Readable } from 'node:stream';

import { UpstreamError } from '../ports/errors.js';
import type { MapboxUploads, StagedFile, UploadCredentials, UploadStatus } from '../ports/mapbox-uploads.js';
import { MAPBOX_API } from './mapbox-tilesets.js';
import { UNSIGNED_PAYLOAD, amzDate, signV4 } from './sigv4.js';
import { at, readJson, send, stringAt, upstreamError, type Fetch } from './upstream-http.js';

const SERVICE = 'mapbox';
/** The S3 bucket of Mapbox's staging area is in `us-east-1`. */
const S3_REGION = 'us-east-1';
/** A file of up to 300 MB takes minutes to stream; the publish task itself may run 30. */
const STAGE_TIMEOUT_MS = 25 * 60 * 1000;

const CREDENTIAL_FIELDS = ['accessKeyId', 'secretAccessKey', 'sessionToken', 'bucket', 'key', 'url'] as const;

function invalid(): UpstreamError {
    return new UpstreamError(SERVICE, 'invalid');
}

function apiUrl(path: string, token: string): string {
    const url = new URL(path, MAPBOX_API);
    url.searchParams.set('access_token', token);
    return url.toString();
}

const segment = (value: string): string => encodeURIComponent(value);

function toCredentials(body: unknown): UploadCredentials {
    const values = CREDENTIAL_FIELDS.map((field) => stringAt(body, field));
    if (values.some((value) => value === undefined || value === '')) {
        throw invalid();
    }
    return Object.fromEntries(CREDENTIAL_FIELDS.map((field, index) => [field, values[index]])) as unknown as UploadCredentials;
}

/** Mapbox's `error` is null until an upload fails, then its message. */
function errorOf(body: unknown): { readonly error?: string } {
    const error = at(body, 'error');
    return typeof error === 'string' && error !== '' ? { error } : {};
}

function toStatus(body: unknown): UploadStatus {
    const [id, complete, progress] = [stringAt(body, 'id'), at(body, 'complete'), at(body, 'progress')];
    if (id === undefined || typeof complete !== 'boolean') {
        throw invalid();
    }
    return { id, complete, progress: typeof progress === 'number' ? progress : 0, ...errorOf(body) };
}

/** One JSON call whose answer must be a 2xx; its body. */
async function json(fetchFn: Fetch, method: string, url: string, body?: unknown): Promise<unknown> {
    const init: RequestInit =
        body === undefined ? { method } : { method, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } };
    const response = await send(fetchFn, SERVICE, url, init);
    if (!response.ok) {
        throw upstreamError(SERVICE, response);
    }
    return readJson(response);
}

/** The S3 staging address the credentials name (HTTPS only: the temporary credentials never travel in clear). */
function stagingUrl(credentials: UploadCredentials): URL {
    const url = new URL(credentials.url);
    if (url.protocol !== 'https:') {
        throw invalid();
    }
    return url;
}

/** The signed headers of the `PUT` (the session token among them), the length and the type beside them. */
function stageHeaders(credentials: UploadCredentials, url: URL, file: StagedFile, now: Date): Record<string, string> {
    const signed = {
        'x-amz-content-sha256': UNSIGNED_PAYLOAD,
        'x-amz-date': amzDate(now),
        'x-amz-security-token': credentials.sessionToken,
    };
    const authorization = signV4(
        { method: 'PUT', url, headers: signed, payloadHash: UNSIGNED_PAYLOAD, region: S3_REGION, service: 's3', now },
        credentials,
    );
    return { ...signed, authorization, 'content-type': file.contentType, 'content-length': String(file.bytes) };
}

async function put(fetchFn: Fetch, url: URL, init: RequestInit): Promise<Response> {
    try {
        return await fetchFn(url.toString(), init);
    } catch {
        throw new UpstreamError(SERVICE, 'unavailable');
    }
}

export function createMapboxUploads(options: { readonly fetch: Fetch; readonly now: () => Date }): MapboxUploads {
    const uploadsUrl = (user: string, token: string, suffix = '') => apiUrl(`/uploads/v1/${segment(user)}${suffix}`, token);
    return {
        credentials: async (user, token) => toCredentials(await json(options.fetch, 'POST', uploadsUrl(user, token, '/credentials'))),
        stage: async (credentials, file) => {
            const url = stagingUrl(credentials);
            const init = {
                method: 'PUT',
                headers: stageHeaders(credentials, url, file, options.now()),
                body: Readable.toWeb(await file.open()) as ReadableStream<Uint8Array>,
                duplex: 'half',
                signal: AbortSignal.timeout(STAGE_TIMEOUT_MS),
            } as RequestInit;
            const response = await put(options.fetch, url, init);
            if (!response.ok) {
                throw upstreamError(SERVICE, response);
            }
        },
        create: async (user, token, request) => toStatus(await json(options.fetch, 'POST', uploadsUrl(user, token), request)),
        status: async (user, token, uploadId) =>
            toStatus(await json(options.fetch, 'GET', uploadsUrl(user, token, `/${segment(uploadId)}`))),
    };
}
