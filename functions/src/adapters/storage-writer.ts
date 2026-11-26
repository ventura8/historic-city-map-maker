import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import type { Storage } from 'firebase-admin/storage';

import type { BlobWriter } from '../ports/blob-writer.js';
import type { RuntimeConfig } from '../ports/runtime-config.js';
import { storageFailure } from './storage.js';

/** Where a failed stream failed: its source (the zip writer's own error goes on as it is) or the upload. */
interface SourceFailure {
    error: Error | undefined;
}

async function* watched(body: AsyncIterable<Uint8Array>, failure: SourceFailure): AsyncGenerator<Uint8Array> {
    try {
        yield* body;
    } catch (error) {
        failure.error = error instanceof Error ? error : new Error(String(error));
        throw failure.error;
    }
}

/**
 * Streams an object into a bucket (M5, `docs/research/M5-interfaces.md` §5.3): a resumable upload through firebase-admin
 * (`@google-cloud/storage`'s `createWriteStream`), bucket roles mapped to `RuntimeConfig.buckets`. When the source fails
 * its own error rejects (the export records `apiError.export.tooLarge`, say); when the upload fails, an `UpstreamError`
 * `cloud-storage`. Either way a partial object is deleted.
 */
export function createStorageBlobWriter(storage: Storage, buckets: RuntimeConfig['buckets']): BlobWriter {
    return {
        stream: async (bucket, path, body, options) => {
            const file = storage.bucket(buckets[bucket]).file(path);
            const failure: SourceFailure = { error: undefined };
            try {
                await pipeline(
                    Readable.from(watched(body, failure)),
                    file.createWriteStream({ contentType: options.contentType, resumable: true }),
                );
            } catch (error) {
                await file.delete({ ignoreNotFound: true }).catch(() => undefined);
                throw failure.error ?? storageFailure(error);
            }
        },
    };
}
