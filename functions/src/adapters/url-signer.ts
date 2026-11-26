import type { BucketRole } from '../ports/blob-store.js';
import type { RuntimeConfig } from '../ports/runtime-config.js';
import type { SignedDownload, SignedObject, SignedObjectRequest, UrlSigner } from '../ports/url-signer.js';
import { storageFailure } from './storage.js';

/** A V4 signing request: a download (`read`, with its disposition) or a worker's upload (`write`, bound to its type). */
interface SigningConfig {
    readonly version: 'v4';
    readonly action: 'read' | 'write';
    readonly expires: Date;
    readonly responseDisposition?: string;
    readonly contentType?: string;
}

/** What the signer uses of firebase-admin's `Storage` (`getStorage(app)` satisfies it; the tests pass a fake). */
export interface SigningStorage {
    bucket(name: string): {
        file(path: string): {
            getSignedUrl(config: SigningConfig): Promise<[string]>;
        };
    };
}

/** `attachment; filename="<name>"`: the export's name is `EXPORT_FILE_NAME_PATTERN` (no quote, no path). */
export function attachmentDisposition(fileName: string): string {
    return `attachment; filename="${fileName}"`;
}

/**
 * Cloud Storage's V4 signed GET address (M5, `docs/research/M5-interfaces.md` §5.5): firebase-admin signs with the
 * runtime account's own `signBlob` (`roles/iam.serviceAccountTokenCreator` on itself, a provisioner item), so no key file
 * exists; the address makes the browser save the object under its file name. Failures are `UpstreamError`s whose
 * message never holds the address.
 */
export function createStorageUrlSigner(storage: SigningStorage, buckets: RuntimeConfig['buckets']): UrlSigner {
    const sign = async (bucket: BucketRole, path: string, config: SigningConfig): Promise<string> => {
        try {
            const [url] = await storage.bucket(buckets[bucket]).file(path).getSignedUrl(config);
            return url;
        } catch (error) {
            throw storageFailure(error);
        }
    };
    return {
        signedDownload: (bucket: BucketRole, download: SignedDownload) =>
            sign(bucket, download.path, {
                version: 'v4',
                action: 'read',
                expires: download.expiresAt,
                responseDisposition: attachmentDisposition(download.fileName),
            }),
        signedObject: async (bucket: BucketRole, request: SignedObjectRequest): Promise<SignedObject> => {
            const expires = request.expiresAt;
            if (request.method === 'GET') {
                return { url: await sign(bucket, request.path, { version: 'v4', action: 'read', expires }), method: 'GET', headers: {} };
            }
            const contentType = uploadType(request);
            const url = await sign(bucket, request.path, { version: 'v4', action: 'write', expires, contentType });
            return { url, method: 'PUT', headers: { 'Content-Type': contentType } };
        },
    };
}

/** A `PUT`'s content type: an upload is always bound to one (the worker's request names it; the handler checks it). */
function uploadType(request: SignedObjectRequest): string {
    if (request.contentType === undefined) {
        throw new TypeError(`a signed upload of ${request.path} needs its content type`);
    }
    return request.contentType;
}

/** The loopback names the Storage emulator may have (the stand-in never signs for another host). */
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** The Storage emulator's `host:port` (`FIREBASE_STORAGE_EMULATOR_HOST`), on loopback only. */
function emulatorHost(host: string | undefined): string {
    const name = host === undefined ? '' : new URL(`http://${host}`).hostname;
    if (host === undefined || !LOOPBACK.has(name)) {
        throw new Error('the Storage emulator must be on loopback (FIREBASE_STORAGE_EMULATOR_HOST) to sign a worker object');
    }
    return host;
}

/**
 * A worker's object on the Storage emulator's JSON API (M7, `docs/research/M7-local-worker.md` §2.4): a download with
 * `alt=media`, an upload with `uploadType=media`, both as the emulator's owner (`Bearer owner`, which skips the rules,
 * as the Admin SDK's write does on Cloud Storage).
 */
function emulatorObject(host: string, bucket: string, request: SignedObjectRequest): SignedObject {
    const root = `http://${host}`;
    const owner = { Authorization: 'Bearer owner' };
    if (request.method === 'GET') {
        const url = `${root}/download/storage/v1/b/${bucket}/o/${encodeURIComponent(request.path)}?alt=media`;
        return { url, method: 'GET', headers: owner };
    }
    const query = new URLSearchParams({ uploadType: 'media', name: request.path });
    return {
        url: `${root}/upload/storage/v1/b/${bucket}/o?${query.toString()}`,
        method: 'POST',
        headers: { ...owner, 'Content-Type': uploadType(request) },
    };
}

/** The stand-in's marker in its addresses: the mock public-storage host answers only these (`e2e`, never production). */
export const STAND_IN_SIGNATURE = 'hcm-emulator-stand-in';

/**
 * The Functions emulator's signer (the e2e stand-in): there is no account to sign with, so the address has the shape of a
 * V4 one on `storage.googleapis.com` without a signature; the e2e's mock public-storage host answers it from the Storage
 * emulator with the same disposition, so the browser downloads exactly the object the task wrote. A worker's object (M7)
 * is an address of the Storage emulator itself (`storageHost`, loopback only).
 */
export function createStandInUrlSigner(buckets: RuntimeConfig['buckets'], now: () => Date, storageHost?: string): UrlSigner {
    return {
        signedObject: (bucket: BucketRole, request: SignedObjectRequest) =>
            Promise.resolve().then(() => emulatorObject(emulatorHost(storageHost), buckets[bucket], request)),
        signedDownload: (bucket: BucketRole, download: SignedDownload) => {
            const seconds = Math.max(1, Math.round((download.expiresAt.getTime() - now().getTime()) / 1000));
            const query = new URLSearchParams({
                'X-Goog-Algorithm': STAND_IN_SIGNATURE,
                'X-Goog-Expires': String(seconds),
                'response-content-disposition': attachmentDisposition(download.fileName),
            });
            const path = download.path.split('/').map(encodeURIComponent).join('/');
            return Promise.resolve(`https://storage.googleapis.com/${buckets[bucket]}/${path}?${query.toString()}`);
        },
    };
}
