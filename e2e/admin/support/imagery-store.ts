import { createHash } from 'node:crypto';

import type { TimestampLike } from '@hcm/shared';

import { ADMIN_WEB_CONFIG, E2E_PROJECT_ID, emulatorOrigin } from '../world.js';

/**
 * The Firestore and Storage emulators as the raster pipeline reaches them (docs/research/M3-interfaces.md §4.4, §13), from
 * the mock APIs' process, where the stand-in runner plays a run: plain `fetch` with the emulators' owner credential (no
 * Playwright, no rules), documents read with their timestamps as `{seconds, nanoseconds}` (what the shared schemas
 * validate) and written field by field (`updateMask`, so a field another writer owns is never overwritten), objects
 * uploaded to the private bucket with their generation and SHA-256.
 */

/** The emulators' administrator credential. */
const OWNER = { authorization: 'Bearer owner' } as const;
const DOCUMENTS = `${emulatorOrigin('firestore')}/v1/projects/${E2E_PROJECT_ID}/databases/(default)/documents`;
const STORAGE = emulatorOrigin('storage');
/** The private bucket (`RASTER_PATHS` live there). */
const PRIVATE_BUCKET = ADMIN_WEB_CONFIG.storageBucket;

type Value =
    | { readonly stringValue: string }
    | { readonly integerValue: string }
    | { readonly doubleValue: number }
    | { readonly booleanValue: boolean }
    | { readonly nullValue: null }
    | { readonly timestampValue: string }
    | { readonly arrayValue: { readonly values?: readonly Value[] } }
    | { readonly mapValue: { readonly fields?: Readonly<Record<string, Value>> } };

type Fields = Readonly<Record<string, Value>>;

/** A plain object of exactly `seconds` and `nanoseconds` numbers: a timestamp. */
function isTimestamp(value: object): value is TimestampLike {
    const keys = Object.keys(value).sort((left, right) => left.localeCompare(right));
    return keys.join(',') === 'nanoseconds,seconds' && typeof (value as TimestampLike).seconds === 'number';
}

function timestampText(value: TimestampLike): string {
    return new Date(value.seconds * 1000 + Math.floor(value.nanoseconds / 1_000_000)).toISOString();
}

function encodeObject(value: object): Value {
    if (value instanceof Date) {
        return { timestampValue: value.toISOString() };
    }
    if (Array.isArray(value)) {
        return { arrayValue: { values: value.map(encode) } };
    }
    return isTimestamp(value)
        ? { timestampValue: timestampText(value) }
        : { mapValue: { fields: encodeAll(value as Record<string, unknown>) } };
}

function encode(value: unknown): Value {
    if (value === null) {
        return { nullValue: null };
    }
    if (typeof value === 'object') {
        return encodeObject(value);
    }
    if (typeof value === 'string') {
        return { stringValue: value };
    }
    if (typeof value === 'number') {
        return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
    }
    if (typeof value === 'boolean') {
        return { booleanValue: value };
    }
    throw new TypeError(`no Firestore encoding for a ${typeof value}`);
}

function encodeAll(data: Readonly<Record<string, unknown>>): Record<string, Value> {
    return Object.fromEntries(Object.entries(data).map(([key, value]) => [key, encode(value)]));
}

/** A `timestampValue` back as `{seconds, nanoseconds}`. */
function timestampOf(text: string): TimestampLike {
    const ms = Date.parse(text);
    const nanosecondsText = /\.(\d+)Z$/.exec(text)?.[1] ?? '';
    const seconds = Math.floor(ms / 1000);
    return { seconds, nanoseconds: Number(nanosecondsText.padEnd(9, '0').slice(0, 9)) };
}

function decode(value: Value): unknown {
    if ('integerValue' in value) {
        return Number(value.integerValue);
    }
    if ('timestampValue' in value) {
        return timestampOf(value.timestampValue);
    }
    if ('arrayValue' in value) {
        return (value.arrayValue.values ?? []).map(decode);
    }
    if ('mapValue' in value) {
        return decodeAll(value.mapValue.fields ?? {});
    }
    return Object.values(value)[0] as unknown;
}

function decodeAll(fields: Fields): Record<string, unknown> {
    return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decode(value)]));
}

async function ok(response: Response, what: string): Promise<Response> {
    if (!response.ok) {
        throw new Error(`${what}: ${String(response.status)} ${await response.text()}`);
    }
    return response;
}

/** A document's data (timestamps as `{seconds, nanoseconds}`), or undefined when it does not exist. */
export async function readDocument(path: string): Promise<Record<string, unknown> | undefined> {
    const response = await fetch(`${DOCUMENTS}/${path}`, { headers: OWNER });
    if (response.status === 404) {
        return undefined;
    }
    const body = (await (await ok(response, `read of ${path}`)).json()) as { readonly fields?: Fields };
    return decodeAll(body.fields ?? {});
}

/** A field path of the mask, each segment quoted when it is not a plain identifier. */
function maskPath(path: string): string {
    return path
        .split('.')
        .map((segment) => (/^[A-Za-z_]\w*$/.test(segment) ? segment : `\`${segment}\``))
        .join('.');
}

/**
 * A write to a document that no longer exists: the run of a test that ended, whose world the next test reset. Without
 * the precondition the write would create a partial document in that test's world.
 */
export class DocumentGone extends Error {
    readonly path: string;

    constructor(path: string) {
        super(`${path} no longer exists`);
        this.name = 'DocumentGone';
        this.path = path;
    }
}

/**
 * Writes the fields of `mask` (dotted paths into `data`, `steps.fetch`): a path present in `data` is set, one absent is
 * deleted; every other field of the document stays as it is. `existing`: only into a document that exists, else
 * `DocumentGone` (a job or a version; a log line is created).
 */
export async function updateDocument(
    path: string,
    data: Readonly<Record<string, unknown>>,
    mask: readonly string[],
    existing = false,
): Promise<void> {
    const fields = mask.map((field) => `updateMask.fieldPaths=${encodeURIComponent(maskPath(field))}`);
    const query = [...fields, ...(existing ? ['currentDocument.exists=true'] : [])].join('&');
    const response = await fetch(`${DOCUMENTS}/${path}?${query}`, {
        method: 'PATCH',
        headers: { ...OWNER, 'content-type': 'application/json' },
        body: JSON.stringify({ fields: encodeAll(data) }),
    });
    if (existing && response.status === 404) {
        throw new DocumentGone(path);
    }
    await ok(response, `update of ${path}`);
}

/** An object written to the private bucket: where, its generation and its digest (what a step records). */
export interface StoredObject {
    readonly path: string;
    readonly generation: string;
    readonly sha256: string;
    readonly bytes: number;
}

/** Uploads `bytes` to the private bucket at `path`. */
export async function uploadObject(path: string, bytes: Uint8Array<ArrayBuffer>, contentType: string): Promise<StoredObject> {
    const query = new URLSearchParams({ uploadType: 'media', name: path });
    const response = await fetch(`${STORAGE}/upload/storage/v1/b/${PRIVATE_BUCKET}/o?${query.toString()}`, {
        method: 'POST',
        headers: { ...OWNER, 'content-type': contentType },
        body: bytes,
    });
    const stored = (await (await ok(response, `upload of ${path}`)).json()) as { readonly generation?: string };
    return {
        path,
        generation: (stored.generation ?? '1').replace(/\D/g, '') || '1',
        sha256: createHash('sha256').update(bytes).digest('hex'),
        bytes: bytes.length,
    };
}

/** The names of the private bucket's objects below `prefix`. */
async function objectNames(prefix: string): Promise<string[]> {
    const query = new URLSearchParams({ prefix });
    const response = await fetch(`${STORAGE}/storage/v1/b/${PRIVATE_BUCKET}/o?${query.toString()}`, { headers: OWNER });
    const body = (await (await ok(response, `objects below ${prefix}`)).json()) as {
        readonly items?: readonly { readonly name: string }[];
    };
    return (body.items ?? []).map((item) => item.name);
}

/** Deletes the private bucket's objects below `prefix` (a missing one is fine). */
export async function deleteObjects(prefix: string): Promise<void> {
    for (const name of await objectNames(prefix)) {
        const response = await fetch(`${STORAGE}/storage/v1/b/${PRIVATE_BUCKET}/o/${encodeURIComponent(name)}`, {
            method: 'DELETE',
            headers: OWNER,
        });
        if (response.status !== 404) {
            await ok(response, `delete of ${name}`);
        }
    }
}
