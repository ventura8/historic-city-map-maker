/**
 * In-memory ports for the fn-content tests (photos, publish, ops) that `functions/test/support/` does not hold yet: a
 * `BlobStore` that behaves like the Storage adapter (create-only writes conflict, missing objects are `notFound`), a
 * recording `TaskQueue` that drops a second task with the same id like Cloud Tasks, a movable clock, and the
 * `RuntimeConfig` of the `demo-hcm` project. Failures are scripted with `recorder.failNext`.
 */
import type { Logger } from '@hcm/shared';
import type { RecordingSink } from '@hcm/test-support';
import type { CallableRequest } from 'firebase-functions/https';

import { createSharpImageProcessor } from '../../src/adapters/image.js';
import type { CallerToken } from '../../src/api/access.js';
import type { BlobMetadata, BlobStore, BucketRole, WriteOptions } from '../../src/ports/blob-store.js';
import type { Clock } from '../../src/ports/clock.js';
import { UpstreamError } from '../../src/ports/errors.js';
import type { ImageProcessor } from '../../src/ports/image-processor.js';
import type { RuntimeConfig } from '../../src/ports/runtime-config.js';
import type { TaskQueue } from '../../src/ports/task-queue.js';
import { createFakeDocumentStore, type FakeDocumentStore } from '../support/documents.js';
import { fakeAdmins, recordingLogger } from '../support/fakes.js';
import { PortRecorder } from '../support/recorder.js';

export const TEST_CONFIG: RuntimeConfig = {
    projectId: 'demo-hcm',
    region: 'us-central1',
    buckets: { private: 'demo-hcm.firebasestorage.app', public: 'demo-hcm-public' },
    viewerOrigins: ['https://ventura8.github.io'],
    adminOrigins: ['https://demo-hcm.web.app', 'https://demo-hcm.firebaseapp.com'],
    adminUrl: 'https://demo-hcm.web.app/',
    oauthClientIds: ['test-client.apps.googleusercontent.com'],
    errorEndpoint: 'https://us-central1-demo-hcm.cloudfunctions.net/telemetry-reportError',
    appCheck: 'monitor',
};

/** The public URL of a public-bucket path in `TEST_CONFIG`. */
export function publicUrl(path: string): string {
    return `https://storage.googleapis.com/${TEST_CONFIG.buckets.public}/${path}`;
}

interface StoredObject {
    readonly bytes: Uint8Array;
    readonly options: WriteOptions;
}

type BlobMethod = 'stat' | 'read' | 'write' | 'copy' | 'delete' | 'list';

interface MemoryBlobStore extends BlobStore {
    readonly recorder: PortRecorder<BlobMethod>;
    /** Stores an object as a client or an earlier run left it. */
    put(bucket: BucketRole, path: string, bytes: Uint8Array, options?: Partial<WriteOptions>): void;
    object(bucket: BucketRole, path: string): StoredObject | undefined;
    /** The paths of a bucket that start with `prefix`, sorted. */
    paths(bucket: BucketRole, prefix?: string): string[];
}

function createMemoryBlobStore(): MemoryBlobStore {
    const objects = new Map<string, StoredObject>();
    const recorder = new PortRecorder<BlobMethod>();
    let generation = 0;
    const key = (bucket: BucketRole, path: string) => `${bucket}:${path}`;
    const found = (bucket: BucketRole, path: string): StoredObject => {
        const stored = objects.get(key(bucket, path));
        if (stored === undefined) {
            throw new UpstreamError('cloud-storage', 'notFound', { status: 404 });
        }
        return stored;
    };
    const metadata = (stored: StoredObject): BlobMetadata => {
        generation += 1;
        return {
            size: stored.bytes.length,
            contentType: stored.options.contentType,
            generation: String(generation),
            customMetadata: stored.options.customMetadata ?? {},
        };
    };
    const put = (bucket: BucketRole, path: string, bytes: Uint8Array, options: Partial<WriteOptions> = {}): void => {
        objects.set(key(bucket, path), { bytes: new Uint8Array(bytes), options: { contentType: 'application/octet-stream', ...options } });
    };
    return {
        recorder,
        put,
        object: (bucket, path) => objects.get(key(bucket, path)),
        paths: (bucket, prefix = '') =>
            [...objects.keys()]
                .filter((name) => name.startsWith(`${bucket}:${prefix}`))
                .map((name) => name.slice(bucket.length + 1))
                .sort((a, b) => a.localeCompare(b)),
        stat: (bucket, path) =>
            Promise.resolve().then(() => {
                recorder.enter('stat', [bucket, path]);
                const stored = objects.get(key(bucket, path));
                return stored === undefined ? undefined : metadata(stored);
            }),
        read: (bucket, path) =>
            Promise.resolve().then(() => {
                recorder.enter('read', [bucket, path]);
                return new Uint8Array(found(bucket, path).bytes);
            }),
        write: (bucket, path, bytes, options) =>
            Promise.resolve().then(() => {
                recorder.enter('write', [bucket, path, options]);
                if (options.ifGenerationMatch === 0 && objects.has(key(bucket, path))) {
                    throw new UpstreamError('cloud-storage', 'conflict', { status: 412 });
                }
                put(bucket, path, bytes, options);
            }),
        copy: (from, to, options) =>
            Promise.resolve().then(() => {
                recorder.enter('copy', [from, to, options]);
                const source = found(from.bucket, from.path);
                objects.set(
                    key(to.bucket, to.path),
                    options?.cacheControl === undefined
                        ? source
                        : { ...source, options: { ...source.options, cacheControl: options.cacheControl } },
                );
            }),
        delete: (bucket, path) =>
            Promise.resolve().then(() => {
                recorder.enter('delete', [bucket, path]);
                objects.delete(key(bucket, path));
            }),
        list: (bucket, prefix) =>
            Promise.resolve().then(() => {
                recorder.enter('list', [bucket, prefix]);
                return [...objects.keys()]
                    .filter((name) => name.startsWith(`${bucket}:${prefix}`))
                    .map((name) => name.slice(bucket.length + 1));
            }),
    };
}

interface Enqueued {
    readonly queue: string;
    readonly payload: unknown;
    readonly options: unknown;
}

interface RecordingTaskQueue extends TaskQueue {
    readonly recorder: PortRecorder<'enqueue'>;
    /** Every task that was queued (a duplicate id is not). */
    readonly queued: readonly Enqueued[];
}

/** Cloud Tasks as far as the builder needs it: a task whose id was already queued is dropped (`false`). */
function createRecordingTaskQueue(): RecordingTaskQueue {
    const recorder = new PortRecorder<'enqueue'>();
    const queued: Enqueued[] = [];
    const ids = new Set<string>();
    return {
        recorder,
        queued,
        enqueue: (queue, payload, options = {}) =>
            Promise.resolve().then(() => {
                recorder.enter('enqueue', [queue, payload, options]);
                if (options.id !== undefined && ids.has(options.id)) {
                    return false;
                }
                if (options.id !== undefined) {
                    ids.add(options.id);
                }
                queued.push({ queue, payload, options });
                return true;
            }),
    };
}

interface MovableClock extends Clock {
    set(iso: string): void;
}

function movableClock(iso: string): MovableClock {
    let current = new Date(iso);
    return {
        now: () => new Date(current),
        set: (next) => {
            current = new Date(next);
        },
    };
}

export interface ContentDeps {
    readonly log: Logger;
    readonly recording: RecordingSink;
    readonly clock: MovableClock;
    readonly config: RuntimeConfig;
    readonly documents: FakeDocumentStore;
    readonly blobs: MemoryBlobStore;
    readonly tasks: RecordingTaskQueue;
    readonly images: ImageProcessor;
    readonly admins: ReturnType<typeof fakeAdmins>;
}

/** Fresh fakes for one test: an empty store and buckets, the real sharp processor, `u-admin` as the only admin. */
export function contentDeps(now = '2026-10-12T08:30:00.000Z'): ContentDeps {
    const { log, recording } = recordingLogger();
    return {
        log,
        recording,
        clock: movableClock(now),
        config: TEST_CONFIG,
        documents: createFakeDocumentStore(),
        blobs: createMemoryBlobStore(),
        tasks: createRecordingTaskQueue(),
        images: createSharpImageProcessor(),
        admins: fakeAdmins(['u-admin']),
    };
}

/** A callable request of a verified Google account holding the `admin` claim (what firebase-functions hands `.run()`). */
export function adminCall(data: unknown, uid = 'u-admin'): CallableRequest<unknown> {
    const token: CallerToken = { email_verified: true, admin: true, firebase: { sign_in_provider: 'google.com' } };
    return {
        data,
        auth: { uid, token, rawToken: 'test-id-token' },
        rawRequest: {} as CallableRequest['rawRequest'],
        acceptsStreaming: false,
    } as CallableRequest<unknown>;
}
