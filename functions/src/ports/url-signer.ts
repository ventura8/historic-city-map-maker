import type { BucketRole } from './blob-store.js';

/** What a signed download address says and how long it works. */
export interface SignedDownload {
    /** The object's path in the bucket (`STORAGE_PATHS.cityExport`). */
    readonly path: string;
    /** When the address stops working. */
    readonly expiresAt: Date;
    /** The file name the browser saves it as (`Content-Disposition: attachment; filename="..."`). */
    readonly fileName: string;
}

/** M7 (`docs/research/M7-local-worker.md` §2.4): one object a local worker reads (`GET`) or writes (`PUT`). */
export interface SignedObjectRequest {
    readonly path: string;
    readonly method: 'GET' | 'PUT';
    /** A `PUT`'s content type: the address is bound to it (the upload must send the same header). */
    readonly contentType?: string;
    readonly expiresAt: Date;
}

/** How to use a signed object address: the method and the headers the request must carry. */
export interface SignedObject {
    readonly url: string;
    /** `GET` or `PUT` on Cloud Storage; the emulator's stand-in uploads with its JSON API's `POST`. */
    readonly method: 'GET' | 'PUT' | 'POST';
    readonly headers: Readonly<Record<string, string>>;
}

/**
 * Short-lived addresses of private objects. M5 (`docs/research/M5-interfaces.md` §5.5): the static export leaves the
 * private bucket only through a signed download. M7 (`docs/research/M7-local-worker.md` §2.4): a local worker reads its
 * job's inputs and writes its version's files through one signed address per object. Adapter
 * `functions/src/adapters/url-signer.ts`: Cloud Storage's V4 signing with the runtime account's own `signBlob` in
 * production; in the Functions emulator the e2e stand-in (a download the mock public-storage host answers from the
 * Storage emulator; a worker's object straight on the Storage emulator). The address is a credential for its lifetime:
 * never logged.
 */
export interface UrlSigner {
    signedDownload(bucket: BucketRole, download: SignedDownload): Promise<string>;
    signedObject(bucket: BucketRole, request: SignedObjectRequest): Promise<SignedObject>;
}
