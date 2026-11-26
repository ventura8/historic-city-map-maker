import type { BucketRole } from './blob-store.js';

/**
 * Writing an object larger than memory (M5, `docs/research/M5-interfaces.md` §5.3, §5.4): the static export streams its
 * zip into the private bucket as the writer produces it. Beside `BlobStore` (whose `write` takes the whole object) so its
 * adapter is unchanged. Adapter `functions/src/adapters/storage-writer.ts`; the Storage emulator in tests.
 */
export interface BlobWriter {
    /**
     * Uploads `body`'s chunks as the object `path`, resolving once it is stored; a failure of `body` or of the upload
     * rejects (`UpstreamError` `cloud-storage` for the upload) and leaves no object behind.
     */
    stream(bucket: BucketRole, path: string, body: AsyncIterable<Uint8Array>, options: { readonly contentType: string }): Promise<void>;
}
