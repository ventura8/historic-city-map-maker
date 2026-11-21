/**
 * The worker family's test world (`docs/research/M7-local-worker.md` §2.4): the imagery world (`../imagery/world.ts`: the
 * documents and blobs that validate like the adapters, a movable clock, the USGS fakes, a green guard, the city), a
 * recording signer (signing is an outside boundary), a second admin (`u-other`) whose worker is not the caller's, and
 * builders of a worker document, a local job (queued or claimed by `WORKER`) and the version it makes. Every value is a
 * generated test value.
 */
import { FIRESTORE_PATHS, LEASE_SECONDS, workerDocSchema, type JobDoc, type LayerVersionDoc, type WorkerDoc } from '@hcm/shared';
import type { CallableFunction } from 'firebase-functions/https';

import { createDiskStarterTemplates } from '../../src/adapters/starter-templates.js';
import { omit } from '../../src/api/objects.js';
import type { BucketRole } from '../../src/ports/blob-store.js';
import type { SignedDownload, SignedObjectRequest, UrlSigner } from '../../src/ports/url-signer.js';
import type { WorkerFamilyDeps } from '../../src/worker/index.js';
import { adminCall } from '../publish/fakes.js';
import { fakeAdmins } from '../support/fakes.js';
import { createFakeAuthAdmin } from '../support/platform.js';
import { CITY, NOW, at, readyWorld, renderedVersion, seedJob, seedVersion, type ImageryWorld } from '../imagery/world.js';

export { CITY, NOW, at };

export const WORKER = 'w-0123456789abcdef';
export const OTHER_WORKER = 'w-fedcba9876543210';
const OWNER = 'u-admin';
export const OTHER = 'u-other';
export const JOB = 'job-1966-0712';
export const LAYER = 'kh-4a-corona-1966';
export const ENTITY = 'DS1035-1057DA023';
export const FOLDER = `rasters/${CITY}/${LAYER}/${JOB}`;

const MINUTE = 60_000;

/** `minutes` from `NOW` (negative: before). */
export function minutes(count: number) {
    return at(new Date(Date.parse(NOW) + count * MINUTE).toISOString());
}

interface FakeSigner extends UrlSigner {
    readonly signed: { readonly bucket: BucketRole; readonly request: SignedObjectRequest }[];
}

/** A signer that records what it signs and answers V4-shaped addresses (a `PUT` carries its content type). */
function createFakeSigner(): FakeSigner {
    const signed: { bucket: BucketRole; request: SignedObjectRequest }[] = [];
    return {
        signed,
        signedDownload: (_bucket: BucketRole, download: SignedDownload) => Promise.resolve(`https://signed.test/${download.path}`),
        signedObject: (bucket, request) => {
            signed.push({ bucket, request });
            const url = `https://storage.googleapis.com/demo-hcm.firebasestorage.app/${request.path}?X-Goog-Signature=test`;
            const headers: Record<string, string> = request.contentType === undefined ? {} : { 'Content-Type': request.contentType };
            return Promise.resolve({ url, method: request.method, headers });
        },
    };
}

export type WorkerTestDeps = ImageryWorld['deps'] &
    WorkerFamilyDeps & { readonly signer: FakeSigner; readonly authAdmin: ReturnType<typeof createFakeAuthAdmin> };

export interface WorkerWorld extends Omit<ImageryWorld, 'deps'> {
    readonly deps: WorkerTestDeps;
    readonly signer: FakeSigner;
}

/** The imagery world with its city, setup and green guard, a signer and a second admin. */
export async function workerWorld(now = NOW): Promise<WorkerWorld> {
    const base = await readyWorld(now);
    const signer = createFakeSigner();
    const authAdmin = createFakeAuthAdmin();
    const starters = createDiskStarterTemplates(new URL('../../../packages/admin/starter/', import.meta.url));
    const deps = { ...base.deps, signer, authAdmin, auth: authAdmin.auth, admins: fakeAdmins([OWNER, OTHER]), starters };
    return { ...base, signer, deps };
}

/** One call of a worker callable, as `uid`, through its `.run()`. */
export function callAs<T>(
    world: WorkerWorld,
    factory: (getDeps: () => WorkerTestDeps) => CallableFunction<unknown, Promise<T>>,
    data: Readonly<Record<string, unknown>>,
    uid = OWNER,
): Promise<T> {
    return factory(() => world.deps).run(adminCall({ cityId: CITY, ...data }, uid));
}

/** A worker's document as `worker.hello` left it. */
function workerDoc(overrides: Partial<WorkerDoc> = {}): WorkerDoc {
    return {
        uid: OWNER,
        version: '1.0.0',
        startedAt: minutes(-30),
        lastSeenAt: minutes(-1),
        state: 'idle',
        updatedBy: OWNER,
        updatedAt: minutes(-1),
        ...overrides,
    };
}

export async function seedWorker(world: WorkerWorld, workerId = WORKER, overrides: Partial<WorkerDoc> = {}): Promise<void> {
    await world.deps.documents.set(FIRESTORE_PATHS.worker(CITY, workerId), workerDocSchema, workerDoc(overrides));
}

export function readWorker(world: WorkerWorld, workerId = WORKER): Promise<WorkerDoc | undefined> {
    return world.deps.documents.get(FIRESTORE_PATHS.worker(CITY, workerId), workerDocSchema);
}

/** A USGS import chosen for the owner's computer, queued and due. */
export function localJob(overrides: Partial<JobDoc> = {}): JobDoc {
    return {
        type: 'usgs-import',
        status: 'queued',
        params: { entityId: ENTITY, dataset: 'corona2', sensor: 'KH-4A' },
        createdBy: OWNER,
        createdAt: minutes(-60),
        layerId: LAYER,
        versionId: JOB,
        runOn: 'local',
        waitReason: 'worker',
        attempt: 0,
        updatedBy: 'system:imagery',
        updatedAt: minutes(-60),
        ...overrides,
    };
}

/** The local job `WORKER` claimed and runs (`running`, its lease live). */
export function heldJob(overrides: Partial<JobDoc> = {}): JobDoc {
    return {
        ...omit(localJob(), ['waitReason']),
        status: 'running',
        attempt: 1,
        dispatchAt: minutes(-10),
        startedAt: minutes(-10),
        step: 'fetch',
        progress: 0,
        lease: { owner: `worker:${WORKER}`, until: at(new Date(Date.parse(NOW) + LEASE_SECONDS * 1000 - MINUTE).toISOString()) },
        worker: { id: WORKER, uid: OWNER, claimedAt: minutes(-10) },
        updatedBy: 'system:pipeline',
        updatedAt: minutes(-1),
        ...overrides,
    };
}

/** The version the job makes, still processing (the golden render's ids, without its render). */
export function processingVersion(overrides: Partial<LayerVersionDoc> = {}): LayerVersionDoc {
    return { ...omit(renderedVersion(), ['output', 'georef']), state: 'processing', ...overrides };
}

/** The held job and its processing version, and the worker busy with it. */
export async function seedHeld(world: WorkerWorld, job: Partial<JobDoc> = {}, version: Partial<LayerVersionDoc> = {}): Promise<void> {
    await seedWorker(world, WORKER, { state: 'busy', jobId: JOB });
    await seedJob(world, JOB, heldJob(job));
    await seedVersion(world, JOB, processingVersion(version));
}
