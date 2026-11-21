/**
 * Resumable uploads to the private bucket (`docs/research/M2c-interfaces.md` §2.2 `ContentServices.uploads`, §6.2):
 * Firebase Storage's `uploadBytesResumable`, which sends the file in chunks and retries a dropped connection by itself
 * (`S-A08-BAD-UPLOAD-INTERRUPTED`), reports progress, and can be cancelled (`S-A37-BAD-CANCEL-UPLOAD`). Only this folder
 * imports the Firebase SDK (dependency-cruiser `admin-firebase-sdk-only-in-adapters`); the photos area sees `UploadPort`,
 * and its node tests a fake. The type of a file is decided by the server's sniffing, never here
 * (`design-review-security-cost.md` §1.5): the content type sent is what the Storage rules ask for.
 */
import { ref, uploadBytesResumable, type FirebaseStorage, type StorageReference, type UploadMetadata } from 'firebase/storage';

export interface UploadProgress {
    readonly sent: number;
    readonly total: number;
}

/** How an upload ended: sent, cancelled by the admin, given up after the SDK's retries, or refused by the rules. */
export type UploadEnd = { readonly ok: true } | { readonly ok: false; readonly reason: 'cancelled' | 'interrupted' | 'denied' | 'failed' };

export interface UploadRequest {
    /** `STORAGE_PATHS.photoUpload(...)`. */
    readonly path: string;
    readonly data: Blob;
    readonly contentType: string;
    readonly customMetadata: Readonly<Record<string, string>>;
}

export interface UploadHandle {
    /** Settles once, never rejects. */
    readonly finished: Promise<UploadEnd>;
    cancel(): void;
}

export interface UploadPort {
    start(request: UploadRequest, progress: (progress: UploadProgress) => void): UploadHandle;
}

/** What the adapter uses of the SDK's `UploadTask`. */
export interface SdkUploadTask {
    on(
        event: 'state_changed',
        next: (snapshot: { readonly bytesTransferred: number; readonly totalBytes: number }) => void,
        error: (error: { readonly code: string }) => void,
        complete: () => void,
    ): unknown;
    cancel(): boolean;
}

/** The SDK functions the adapter calls (`firebase/storage`), passed in so the node tests use a fake table. */
export interface UploadSdk {
    ref(storage: FirebaseStorage, path: string): StorageReference;
    uploadBytesResumable(reference: StorageReference, data: Blob, metadata: UploadMetadata): SdkUploadTask;
}

/** The SDK's own functions (the entry's table). */
export const UPLOAD_SDK: UploadSdk = { ref, uploadBytesResumable };

const REASONS: Readonly<Record<string, 'cancelled' | 'interrupted' | 'denied'>> = {
    'storage/canceled': 'cancelled',
    'storage/retry-limit-exceeded': 'interrupted',
    'storage/unauthorized': 'denied',
    'storage/unauthenticated': 'denied',
};

/** The end of a failed upload, from the SDK's error code (`storage/...`). */
export function uploadEndOf(code: string): UploadEnd {
    return { ok: false, reason: REASONS[code] ?? 'failed' };
}

/** `UploadPort` over Firebase Storage. */
export function firebaseUploads(sdk: UploadSdk, storage: () => FirebaseStorage): UploadPort {
    return {
        start: (request, progress) => {
            const metadata: UploadMetadata = { contentType: request.contentType, customMetadata: { ...request.customMetadata } };
            const task = sdk.uploadBytesResumable(sdk.ref(storage(), request.path), request.data, metadata);
            const finished = new Promise<UploadEnd>((resolve) => {
                task.on(
                    'state_changed',
                    (snapshot) => {
                        progress({ sent: snapshot.bytesTransferred, total: snapshot.totalBytes });
                    },
                    (error) => {
                        resolve(uploadEndOf(error.code));
                    },
                    () => {
                        resolve({ ok: true });
                    },
                );
            });
            return {
                finished,
                cancel: () => {
                    task.cancel();
                },
            };
        },
    };
}
