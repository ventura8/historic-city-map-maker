import type { Readable } from 'node:stream';

import type { Storage } from 'firebase-admin/storage';

import type { BlobReader } from '../ports/blob-reader.js';
import type { BucketRole } from '../ports/blob-store.js';
import type { RuntimeConfig } from '../ports/runtime-config.js';
import { storageFailure } from './storage.js';

/** The size and type of an object, from its stored metadata (`File.getMetadata()`). */
export function objectFacts(metadata: { readonly size?: string | number | undefined; readonly contentType?: string | undefined }) {
    return { bytes: Number(metadata.size ?? 0), contentType: metadata.contentType ?? 'application/octet-stream' };
}

/**
 * Large objects read without holding them (`docs/research/M3-interfaces.md` §7.3, §8.1): the publisher streams a COG to
 * Mapbox (`open`: its size, its type and a stream of its bytes), the raster upload trigger sniffs a file's first bytes
 * (`range`). Through firebase-admin (`@google-cloud/storage`), bucket roles mapped to the names of
 * `RuntimeConfig.buckets`; failures are `UpstreamError('cloud-storage', …)` (`storageFailure`).
 */
export function createStorageBlobReader(storage: Storage, buckets: RuntimeConfig['buckets']): BlobReader {
    const file = (bucket: BucketRole, path: string) => storage.bucket(buckets[bucket]).file(path);
    return {
        open: async (bucket, path) => {
            try {
                const [metadata] = await file(bucket, path).getMetadata();
                const body: Readable = file(bucket, path).createReadStream({ validation: false });
                return { ...objectFacts(metadata), body };
            } catch (error) {
                throw storageFailure(error);
            }
        },
        range: async (bucket, path, start, end) => {
            if (end <= start) {
                return new Uint8Array(0);
            }
            try {
                const [bytes] = await file(bucket, path).download({ start, end: end - 1, validation: false });
                return new Uint8Array(bytes);
            } catch (error) {
                throw storageFailure(error);
            }
        },
    };
}
