import type { Storage } from 'firebase-admin/storage';

import type { BlobMetadata, BlobStore, BucketRole, WriteOptions } from '../ports/blob-store.js';
import { UpstreamError, type UpstreamFailure } from '../ports/errors.js';
import type { RuntimeConfig } from '../ports/runtime-config.js';

type Bucket = ReturnType<Storage['bucket']>;
type File = ReturnType<Bucket['file']>;

/** The fields of an object's metadata (`File.getMetadata()`) the adapter reads. */
interface StoredMetadata {
    readonly size?: string | number | undefined;
    readonly contentType?: string | undefined;
    readonly generation?: string | number | undefined;
    readonly metadata?: Readonly<Record<string, unknown>> | undefined;
    readonly md5Hash?: string | undefined;
}

/** HTTP statuses of the Cloud Storage JSON API, as a handler needs to tell them apart (M2-interfaces §4.1). */
const FAILURE_BY_STATUS: ReadonlyMap<number, UpstreamFailure> = new Map<number, UpstreamFailure>([
    [400, 'invalid'],
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [404, 'notFound'],
    [409, 'conflict'],
    [412, 'conflict'],
    [429, 'rateLimited'],
]);

/** The HTTP status of a `@google-cloud/storage` `ApiError` (its numeric `code`), or undefined for a network error. */
function statusOf(error: unknown): number | undefined {
    const code: unknown = typeof error === 'object' && error !== null ? (error as { readonly code?: unknown }).code : undefined;
    return typeof code === 'number' ? code : undefined;
}

/**
 * How a failed Cloud Storage call failed: 412 (`ifGenerationMatch: 0` on an existing object) is a `conflict`, every
 * 5xx and every error without a status (network, timeout) is `unavailable`. The message never carries a signed URL.
 */
export function storageFailure(error: unknown): UpstreamError {
    const status = statusOf(error);
    const failure = status === undefined ? 'unavailable' : (FAILURE_BY_STATUS.get(status) ?? 'unavailable');
    return status === undefined ? new UpstreamError('cloud-storage', failure) : new UpstreamError('cloud-storage', failure, { status });
}

async function guarded<T>(call: () => Promise<T>): Promise<T> {
    try {
        return await call();
    } catch (error) {
        throw storageFailure(error);
    }
}

function customMetadataOf(metadata: StoredMetadata): Readonly<Record<string, string>> {
    const custom = metadata.metadata ?? {};
    return Object.fromEntries(Object.entries(custom).flatMap(([key, value]) => (typeof value === 'string' ? [[key, value]] : [])));
}

function toBlobMetadata(metadata: StoredMetadata): BlobMetadata {
    return {
        size: Number(metadata.size ?? 0),
        contentType: metadata.contentType ?? 'application/octet-stream',
        generation: String(metadata.generation ?? ''),
        customMetadata: customMetadataOf(metadata),
        ...(metadata.md5Hash === undefined ? {} : { md5Hash: metadata.md5Hash }),
    };
}

/** The upload options: one request (no resumable session), the bytes as given (already compressed for the manifest). */
function saveOptions(options: WriteOptions) {
    return {
        resumable: false,
        gzip: false,
        contentType: options.contentType,
        metadata: {
            ...(options.cacheControl === undefined ? {} : { cacheControl: options.cacheControl }),
            ...(options.contentEncoding === undefined ? {} : { contentEncoding: options.contentEncoding }),
            ...(options.customMetadata === undefined ? {} : { metadata: { ...options.customMetadata } }),
        },
        ...(options.ifGenerationMatch === undefined ? {} : { preconditionOpts: { ifGenerationMatch: options.ifGenerationMatch } }),
    };
}

/**
 * Cloud Storage through firebase-admin (`@google-cloud/storage`, JSON API over HTTPS), bucket roles mapped to the
 * names of `RuntimeConfig.buckets`. Reads of a `Content-Encoding: gzip` object return the decompressed bytes (the
 * manifest); writes send the bytes as given. Every failure is an `UpstreamError` of `cloud-storage`.
 */
export function createStorageBlobStore(storage: Storage, buckets: RuntimeConfig['buckets']): BlobStore {
    const file = (bucket: BucketRole, path: string): File => storage.bucket(buckets[bucket]).file(path);
    return {
        stat: async (bucket, path) => {
            try {
                return toBlobMetadata((await file(bucket, path).getMetadata())[0]);
            } catch (error) {
                if (statusOf(error) === 404) {
                    return undefined;
                }
                throw storageFailure(error);
            }
        },
        read: (bucket, path) => guarded(async () => new Uint8Array((await file(bucket, path).download())[0])),
        write: (bucket, path, bytes, options) => guarded(() => file(bucket, path).save(Buffer.from(bytes), saveOptions(options))),
        copy: (from, to, options) =>
            guarded(async () => {
                await file(from.bucket, from.path).copy(
                    file(to.bucket, to.path),
                    options?.cacheControl === undefined ? {} : { cacheControl: options.cacheControl },
                );
            }),
        delete: (bucket, path) =>
            guarded(async () => {
                await file(bucket, path).delete({ ignoreNotFound: true });
            }),
        list: (bucket, prefix) =>
            guarded(async () => (await storage.bucket(buckets[bucket]).getFiles({ prefix }))[0].map((found) => found.name)),
    };
}
