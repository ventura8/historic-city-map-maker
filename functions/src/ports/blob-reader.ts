import type { Readable } from 'node:stream';

import type { BucketRole } from './blob-store.js';

/**
 * Reading large objects without holding them (docs/research/M3-interfaces.md §7.3): the publisher streams a COG to
 * Mapbox, the raster upload trigger sniffs a file's first bytes. Beside `BlobStore` (whose `read` returns the whole
 * object) so fn-content's adapter is unchanged. Adapter `functions/src/adapters/storage-reader.ts` (fn-imagery); the
 * Storage emulator in tests.
 */
export interface BlobReader {
    /** The object's size and type, and a stream of its bytes; `UpstreamError` `notFound` when it does not exist. */
    open(bucket: BucketRole, path: string): Promise<{ readonly bytes: number; readonly contentType: string; readonly body: Readable }>;
    /** Bytes `[start, end)` of the object (fewer at its end). */
    range(bucket: BucketRole, path: string, start: number, end: number): Promise<Uint8Array>;
}
