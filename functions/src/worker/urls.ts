import '../global-options.js';

import {
    FIRESTORE_PATHS,
    WORKER_URL_SECONDS,
    layerVersionDocSchema,
    type CallableRequest,
    type CallableResponse,
    type JobDoc,
} from '@hcm/shared';

import type { VerifiedCaller } from '../api/access.js';
import { ApiError } from '../api/api-error.js';
import { defineCallable, type CallableDeps } from '../api/callable.js';
import { versionIdOf } from '../imagery/records.js';
import type { BlobMetadata } from '../ports/blob-store.js';
import type { Ports } from '../ports/index.js';
import { inputVersionsOf, mayRead, mayWrite, type ObjectScope } from './allow-list.js';
import { IN_RUN, requireGreen, requireHeld } from './holder.js';
import { paired } from './pairing.js';
import { proxyUsgs, type UsgsProxyDeps } from './usgs-proxy.js';

export type UrlsDeps = Pick<Ports, 'documents' | 'clock' | 'log' | 'blobs' | 'signer'> & UsgsProxyDeps;

type Request = CallableRequest<'worker.urls'>;
type Response = CallableResponse<'worker.urls'>;
export type ObjectRequest = Extract<Request['request'], { kind: 'objects' }>['objects'][number];
export type SignedAnswer = NonNullable<Response['objects']>[number];

/** A generation as the answer carries it (Cloud Storage's are decimal numbers). */
const GENERATION = /^\d{1,30}$/;

function refused(): ApiError {
    return new ApiError('apiError.worker.refused');
}

/** The scan each input version names (M8: a re-georeferenced frame's lies in its base's folder). */
async function inputScans(deps: UrlsDeps, cityId: string, job: JobDoc): Promise<string[]> {
    const inputs = await Promise.all(
        inputVersionsOf(job).map((id) => deps.documents.get(FIRESTORE_PATHS.layerVersion(cityId, id), layerVersionDocSchema)),
    );
    return inputs.flatMap((input) => input?.scan?.path ?? []);
}

/** The objects of the job's run: its version's folder (the version's layer) and the inputs its parameters name. */
async function objectScope(deps: UrlsDeps, cityId: string, jobId: string, job: JobDoc): Promise<ObjectScope> {
    const versionId = versionIdOf(jobId, job);
    const version = await deps.documents.get(FIRESTORE_PATHS.layerVersion(cityId, versionId), layerVersionDocSchema);
    if (version === undefined) {
        throw new ApiError('apiError.notFound');
    }
    return { cityId, jobId, layerId: version.layerId, versionId, job, inputScans: await inputScans(deps, cityId, job) };
}

/** True when the run may have `object` signed: a read of its files or inputs, a typed write of one of its version's files. */
function allowed(scope: ObjectScope, object: ObjectRequest): boolean {
    return object.method === 'GET' ? mayRead(scope, object.path) : object.contentType !== undefined && mayWrite(scope, object.path);
}

/** What the answer says of an existing object: its size, generation and MD5 (when Cloud Storage has them). */
function metadataOf(metadata: BlobMetadata | undefined): Pick<SignedAnswer, 'size' | 'generation' | 'md5'> {
    if (metadata === undefined) {
        return {};
    }
    const generation = GENERATION.test(metadata.generation) ? { generation: metadata.generation } : {};
    const md5 = metadata.md5Hash === undefined ? {} : { md5: metadata.md5Hash };
    return { size: metadata.size, ...generation, ...md5 };
}

export async function signOne(deps: Pick<UrlsDeps, 'blobs' | 'signer'>, object: ObjectRequest, expiresAt: Date): Promise<SignedAnswer> {
    const typed = object.contentType === undefined ? {} : { contentType: object.contentType };
    const [metadata, signed] = await Promise.all([
        deps.blobs.stat('private', object.path),
        deps.signer.signedObject('private', { path: object.path, method: object.method, expiresAt, ...typed }),
    ]);
    return {
        path: object.path,
        url: signed.url,
        method: signed.method,
        headers: { ...signed.headers },
        expiresAt: expiresAt.toISOString(),
        exists: metadata !== undefined,
        ...metadataOf(metadata),
    };
}

/** Every object on the allow-list, or nothing signed at all (`apiError.worker.refused`). */
function signAll(deps: UrlsDeps, scope: ObjectScope, objects: readonly ObjectRequest[]): Promise<SignedAnswer[]> {
    if (!objects.every((object) => allowed(scope, object))) {
        throw refused();
    }
    const expiresAt = new Date(deps.clock.now().getTime() + WORKER_URL_SECONDS * 1000);
    return Promise.all(objects.map((object) => signOne(deps, object, expiresAt)));
}

/**
 * `worker.urls` (`docs/research/M7-local-worker.md` §2.4, §2.5; S-A62-HAPPY-SIGNED-URLS, S-A62-BAD-PATH-REFUSED): while the
 * caller's worker runs the job it holds, a signed address per object (`WORKER_URL_SECONDS`; a `PUT` bound to its content
 * type) for its version's files and its inputs, with each object's metadata; or one M2M call of its `fetch` step made
 * with the server's USGS key. The delivery, the scratch and the reference cache stay on the computer: nothing signs them.
 */
async function workerUrls(deps: UrlsDeps, caller: VerifiedCaller, request: Request): Promise<Response> {
    await requireGreen(deps.documents);
    const call = { cityId: request.cityId, workerId: request.workerId, uid: caller.uid };
    const job = await requireHeld(deps.documents, call, request.jobId, deps.clock.now());
    if (!IN_RUN.has(job.status)) {
        throw refused();
    }
    const asked = request.request;
    if (asked.kind === 'usgs') {
        return { usgs: await proxyUsgs(deps, job, request.jobId, asked) };
    }
    return { objects: await signAll(deps, await objectScope(deps, call.cityId, request.jobId, job), asked.objects) };
}

/** The `worker-urls` callable. */
export function urlsFunction(getDeps: () => UrlsDeps & CallableDeps) {
    return defineCallable('worker.urls', paired(workerUrls), getDeps);
}
