/** `private`: `<project>.firebasestorage.app` (uploads, originals, rasters); `public`: `<project>-public` (served). */
export type BucketRole = 'private' | 'public';

export interface BlobMetadata {
    readonly size: number;
    readonly contentType: string;
    readonly generation: string;
    readonly customMetadata: Readonly<Record<string, string>>;
    /** The base64 MD5 Cloud Storage records (`md5Hash`), when it has one (M7: the worker's identity check of a re-upload). */
    readonly md5Hash?: string;
}

/** M12: what a copied object carries that its source does not (its source is private and short-lived in the browser's eyes). */
interface CopyOptions {
    readonly cacheControl?: string;
}

export interface WriteOptions {
    readonly contentType: string;
    readonly cacheControl?: string;
    /** `gzip` for the manifest (stored compressed, served decompressed to clients that do not accept gzip). */
    readonly contentEncoding?: 'gzip';
    /** `0`: create only (a retry never overwrites a published, immutable object). */
    readonly ifGenerationMatch?: 0;
    readonly customMetadata?: Readonly<Record<string, string>>;
}

/**
 * Cloud Storage objects by bucket role (the adapter maps roles to bucket names from `RuntimeConfig`). Paths come from
 * `STORAGE_PATHS` of `@hcm/shared`. Adapter `functions/src/adapters/storage.ts` (fn-content); the Storage emulator in
 * tests.
 */
export interface BlobStore {
    /** Undefined when the object does not exist. */
    stat(bucket: BucketRole, path: string): Promise<BlobMetadata | undefined>;
    read(bucket: BucketRole, path: string): Promise<Uint8Array>;
    /** With `ifGenerationMatch: 0`, rejects with `UpstreamError` `conflict` when the object exists. */
    write(bucket: BucketRole, path: string, bytes: Uint8Array, options: WriteOptions): Promise<void>;
    copy(
        from: { readonly bucket: BucketRole; readonly path: string },
        to: { readonly bucket: BucketRole; readonly path: string },
        options?: CopyOptions,
    ): Promise<void>;
    /** Deleting a missing object is not an error. */
    delete(bucket: BucketRole, path: string): Promise<void>;
    list(bucket: BucketRole, prefix: string): Promise<readonly string[]>;
}
