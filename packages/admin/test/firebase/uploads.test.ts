// The resumable uploads over Firebase Storage's `uploadBytesResumable`, with a fake SDK table.
import type { FirebaseStorage, StorageReference, UploadMetadata } from 'firebase/storage';
import { describe, expect, it } from 'vitest';

import { firebaseUploads, uploadEndOf, UPLOAD_SDK, type SdkUploadTask, type UploadSdk } from '../../src/firebase/uploads.js';

interface Task extends SdkUploadTask {
    next: (snapshot: { bytesTransferred: number; totalBytes: number }) => void;
    error: (error: { code: string }) => void;
    complete: () => void;
    cancelled: boolean;
}

function fakeSdk() {
    const calls: { path: string; metadata: UploadMetadata }[] = [];
    const tasks: Task[] = [];
    const sdk: UploadSdk = {
        ref: (_storage, path) => ({ fullPath: path }) as unknown as StorageReference,
        uploadBytesResumable: (reference, _data, metadata) => {
            calls.push({ path: (reference as unknown as { fullPath: string }).fullPath, metadata });
            const task: Task = {
                next: () => undefined,
                error: () => undefined,
                complete: () => undefined,
                cancelled: false,
                on: (_event, next, error, complete) => {
                    task.next = next;
                    task.error = error;
                    task.complete = complete;
                    return undefined;
                },
                cancel: () => {
                    task.cancelled = true;
                    task.error({ code: 'storage/canceled' });
                    return true;
                },
            };
            tasks.push(task);
            return task;
        },
    };
    return { sdk, calls, tasks };
}

const REQUEST = {
    path: 'uploads/photos/bucharest/u/p1/abcdefgh.jpg',
    data: new Blob(['x']),
    contentType: 'image/jpeg',
    customMetadata: { originalName: 'a.jpg' },
};

describe('firebaseUploads', () => {
    it('happyPath_theFileIsSentWithItsMetadataAndProgress', async () => {
        const { sdk, calls, tasks } = fakeSdk();
        const progress: unknown[] = [];
        const handle = firebaseUploads(sdk, () => ({}) as FirebaseStorage).start(REQUEST, (step) => {
            progress.push(step);
        });

        tasks[0]?.next({ bytesTransferred: 5, totalBytes: 10 });
        tasks[0]?.complete();

        await expect(handle.finished).resolves.toEqual({ ok: true });
        expect(calls).toEqual([{ path: REQUEST.path, metadata: { contentType: 'image/jpeg', customMetadata: { originalName: 'a.jpg' } } }]);
        expect(progress).toEqual([{ sent: 5, total: 10 }]);
    });

    it('badPath_cancelEndsTheUploadCancelled', async () => {
        const { sdk, tasks } = fakeSdk();
        const handle = firebaseUploads(sdk, () => ({}) as FirebaseStorage).start(REQUEST, () => undefined);

        handle.cancel();

        await expect(handle.finished).resolves.toEqual({ ok: false, reason: 'cancelled' });
        expect(tasks[0]?.cancelled).toBe(true);
    });

    it.each([
        ['storage/retry-limit-exceeded', 'interrupted'],
        ['storage/unauthorized', 'denied'],
        ['storage/unauthenticated', 'denied'],
        ['storage/quota-exceeded', 'failed'],
    ])('badPath_theSdksError %s ends %s', (code, reason) => {
        expect(uploadEndOf(code)).toEqual({ ok: false, reason });
    });

    it('happyPath_theRealTableIsTheSdks', () => {
        expect(typeof UPLOAD_SDK.ref).toBe('function');
        expect(typeof UPLOAD_SDK.uploadBytesResumable).toBe('function');
    });
});
