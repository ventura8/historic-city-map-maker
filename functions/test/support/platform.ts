import type { AuthAdmin } from '../../src/ports/auth-admin.js';
import type { BlobStore } from '../../src/ports/blob-store.js';
import type { CloudRunJobs, ExecutionStatus, JobDescription, JobRunOptions } from '../../src/ports/cloud-run-jobs.js';
import { UpstreamError } from '../../src/ports/errors.js';
import type { SecretName, SecretStore } from '../../src/ports/secret-store.js';
import type { TaskQueue } from '../../src/ports/task-queue.js';
import { NOW } from './fakes.js';
import { PortRecorder, promised } from './recorder.js';

/**
 * In-memory fakes of the Firebase and Google Cloud platform ports (docs/research/M2-interfaces.md §4): Auth, Cloud
 * Storage, Cloud Tasks, Secret Manager and Cloud Run jobs. Each keeps its state in plain maps a test reads, records
 * every call (`recorder.calls`) and fails on demand (`recorder.failNext(method, new UpstreamError(...))`).
 */

type AuthUser = NonNullable<Awaited<ReturnType<AuthAdmin['getUser']>>>;
type AuthMethod = 'getUser' | 'setAdminClaim' | 'revokeSessions' | 'createCustomToken' | 'deleteUser' | 'listUsers';

/** A verified Google account created at `NOW`; override what a scenario needs. */
export function authUser(uid: string, overrides: Partial<AuthUser> = {}): AuthUser {
    return {
        uid,
        email: `${uid}@e2e.test`,
        emailVerified: true,
        displayName: uid,
        providers: ['google.com'],
        createdAt: new Date(NOW),
        customClaims: {},
        ...overrides,
    };
}

/** `AuthAdmin` over a map of accounts; `revoked` lists the uids whose sessions were revoked. */
export function createFakeAuthAdmin(users: readonly AuthUser[] = [], pageSize = 1000) {
    const accounts = new Map(users.map((user) => [user.uid, user]));
    const revoked: string[] = [];
    const recorder = new PortRecorder<AuthMethod>();
    const auth: AuthAdmin = {
        getUser: (uid) =>
            promised(() => {
                recorder.enter('getUser', [uid]);
                return accounts.get(uid);
            }),
        setAdminClaim: (uid, admin) =>
            promised(() => {
                recorder.enter('setAdminClaim', [uid, admin]);
                const user = accounts.get(uid);
                if (user === undefined) {
                    throw new UpstreamError('firebase-auth', 'notFound', { status: 404 });
                }
                const claims = Object.fromEntries(Object.entries(user.customClaims).filter(([key]) => key !== 'admin'));
                accounts.set(uid, { ...user, customClaims: admin ? { ...claims, admin: true } : claims });
            }),
        revokeSessions: (uid) =>
            promised(() => {
                recorder.enter('revokeSessions', [uid]);
                revoked.push(uid);
            }),
        // A stand-in token that says what it was made for (the real one is a signed JWT).
        createCustomToken: (uid, claims) =>
            promised(() => {
                recorder.enter('createCustomToken', [uid, claims]);
                return `custom.${uid}.${JSON.stringify(claims)}`;
            }),
        deleteUser: (uid) =>
            promised(() => {
                recorder.enter('deleteUser', [uid]);
                accounts.delete(uid);
            }),
        listUsers: (pageToken) =>
            promised(() => {
                recorder.enter('listUsers', [pageToken]);
                const sorted = [...accounts.values()].sort((a, b) => a.uid.localeCompare(b.uid));
                const start = Number(pageToken ?? 0);
                const next = start + pageSize < sorted.length ? { nextPageToken: String(start + pageSize) } : {};
                return { users: sorted.slice(start, start + pageSize), ...next };
            }),
    };
    return { auth, accounts, revoked, recorder };
}

type BucketRole = Parameters<BlobStore['stat']>[0];
type WriteOptions = Parameters<BlobStore['write']>[3];
type BlobMethod = 'stat' | 'read' | 'write' | 'copy' | 'delete' | 'list';

interface StoredBlob {
    readonly bytes: Uint8Array;
    readonly contentType: string;
    readonly generation: string;
    readonly customMetadata: Readonly<Record<string, string>>;
    readonly cacheControl?: string;
    readonly contentEncoding?: 'gzip';
}

/** `BlobStore` over a map keyed `<bucket role>:<path>`; `objects` holds what was written. */
export function createFakeBlobStore() {
    const objects = new Map<string, StoredBlob>();
    const recorder = new PortRecorder<BlobMethod>();
    let generation = 0;
    const key = (bucket: BucketRole, path: string): string => `${bucket}:${path}`;
    const store = (bucket: BucketRole, path: string, bytes: Uint8Array, options: Omit<WriteOptions, 'ifGenerationMatch'>): void => {
        generation += 1;
        objects.set(key(bucket, path), {
            ...options,
            bytes: bytes.slice(),
            customMetadata: options.customMetadata ?? {},
            generation: String(generation),
        });
    };
    const blobs: BlobStore = {
        stat: (bucket, path) =>
            promised(() => {
                recorder.enter('stat', [bucket, path]);
                const found = objects.get(key(bucket, path));
                return found === undefined
                    ? undefined
                    : {
                          size: found.bytes.length,
                          contentType: found.contentType,
                          generation: found.generation,
                          customMetadata: found.customMetadata,
                      };
            }),
        read: (bucket, path) =>
            promised(() => {
                recorder.enter('read', [bucket, path]);
                const found = objects.get(key(bucket, path));
                if (found === undefined) {
                    throw new UpstreamError('cloud-storage', 'notFound', { status: 404 });
                }
                return found.bytes.slice();
            }),
        write: (bucket, path, bytes, options) =>
            promised(() => {
                recorder.enter('write', [bucket, path, options]);
                if (options.ifGenerationMatch === 0 && objects.has(key(bucket, path))) {
                    throw new UpstreamError('cloud-storage', 'conflict', { status: 412 });
                }
                store(bucket, path, bytes, options);
            }),
        copy: (from, to) =>
            promised(() => {
                recorder.enter('copy', [from, to]);
                const found = objects.get(key(from.bucket, from.path));
                if (found === undefined) {
                    throw new UpstreamError('cloud-storage', 'notFound', { status: 404 });
                }
                store(to.bucket, to.path, found.bytes, found);
            }),
        delete: (bucket, path) =>
            promised(() => {
                recorder.enter('delete', [bucket, path]);
                objects.delete(key(bucket, path));
            }),
        list: (bucket, prefix) =>
            promised(() => {
                recorder.enter('list', [bucket, prefix]);
                const paths = [...objects.keys()]
                    .filter((name) => name.startsWith(`${bucket}:${prefix}`))
                    .map((name) => name.slice(bucket.length + 1));
                return paths.sort((a, b) => a.localeCompare(b));
            }),
    };
    return { blobs, objects, recorder };
}

type EnqueueArgs = Parameters<TaskQueue['enqueue']>;

/** `TaskQueue` that keeps the queued tasks; a second task with the same id is refused (`false`), as Cloud Tasks does. */
export function createFakeTaskQueue() {
    const tasks: { readonly queue: EnqueueArgs[0]; readonly payload: EnqueueArgs[1]; readonly options: NonNullable<EnqueueArgs[2]> }[] = [];
    const recorder = new PortRecorder<'enqueue'>();
    const used = new Set<string>();
    const queue: TaskQueue = {
        enqueue: (name, payload, options = {}) =>
            promised(() => {
                recorder.enter('enqueue', [name, payload, options]);
                const id = options.id === undefined ? undefined : `${name}/${options.id}`;
                if (id !== undefined && used.has(id)) {
                    return false;
                }
                if (id !== undefined) {
                    used.add(id);
                }
                tasks.push({ queue: name, payload, options });
                return true;
            }),
    };
    return { queue, tasks, recorder };
}

/** `SecretStore` keeping every version; `read` answers the latest, as Secret Manager's `versions/latest` does. */
export function createFakeSecretStore(initial: Partial<Readonly<Record<SecretName, string>>> = {}) {
    const versions = new Map<SecretName, string[]>();
    for (const [name, value] of Object.entries(initial) as [SecretName, string][]) {
        versions.set(name, [value]);
    }
    const recorder = new PortRecorder<'read' | 'write' | 'invalidate'>();
    const secrets: SecretStore = {
        read: (name) =>
            promised(() => {
                recorder.enter('read', [name]);
                return versions.get(name)?.at(-1);
            }),
        write: (name, value) =>
            promised(() => {
                recorder.enter('write', [name]);
                const list = [...(versions.get(name) ?? []), value];
                versions.set(name, list);
                return `projects/demo-hcm/secrets/${name}/versions/${String(list.length)}`;
            }),
        invalidate: () => {
            recorder.enter('invalidate', []);
        },
    };
    return { secrets, versions, recorder };
}

/**
 * `CloudRunJobs` (M3) that records the executions it starts (their options when given) and the ones it cancels; `get`
 * answers an execution's scripted status (`statuses`), `running` until a test sets another; `job` a job's scripted
 * image and labels (`descriptions`, finding 74), none until a test sets one.
 */
export function createFakeCloudRunJobs() {
    const runs: {
        readonly job: string;
        readonly env: Readonly<Record<string, string>>;
        readonly name: string;
        readonly options?: JobRunOptions;
    }[] = [];
    const cancelled: string[] = [];
    const statuses = new Map<string, ExecutionStatus>();
    /** Finding 74: what each job runs (`job`); a job not listed does not exist. */
    const descriptions = new Map<string, JobDescription>();
    const recorder = new PortRecorder<'run' | 'cancel' | 'get' | 'job'>();
    const jobs: CloudRunJobs = {
        run: (job, env, options) =>
            promised(() => {
                recorder.enter('run', [job, env, options]);
                const name = `projects/demo-hcm/locations/us-central1/jobs/${job}/executions/${job}-e2e${String(runs.length + 1).padStart(2, '0')}`;
                runs.push(options === undefined ? { job, env, name } : { job, env, name, options });
                return { name };
            }),
        cancel: (execution) =>
            promised(() => {
                recorder.enter('cancel', [execution]);
                cancelled.push(execution);
            }),
        get: (execution) =>
            promised(() => {
                recorder.enter('get', [execution]);
                return statuses.get(execution) ?? { state: 'running' };
            }),
        job: (job) =>
            promised(() => {
                recorder.enter('job', [job]);
                return descriptions.get(job);
            }),
    };
    return { jobs, runs, cancelled, statuses, descriptions, recorder };
}
