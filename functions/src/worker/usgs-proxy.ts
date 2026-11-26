/**
 * The M2M calls a local worker's `fetch` step makes, made by the server with its own USGS key (`worker.urls` with
 * `kind: 'usgs'`, `docs/research/M7-local-worker.md` §2.5, §10.7): four endpoints, each payload exactly the one the
 * pipeline sends for the claimed job's scene and label (`pipeline/src/hcm_pipeline/usgs.py`), so a worker can use the
 * project's USGS account for nothing else. The answer is M2M's `data` as USGS sent it.
 */
import { isDeepStrictEqual } from 'node:util';

import type { JobDoc, WORKER_USGS_ENDPOINTS } from '@hcm/shared';

import { ApiError } from '../api/api-error.js';
import { withUsgs, type UsgsSessionDeps } from '../imagery/usgs-session.js';
import { sceneOf } from './allow-list.js';

export type UsgsProxyDeps = UsgsSessionDeps;

type Endpoint = (typeof WORKER_USGS_ENDPOINTS)[number];
type Payload = Readonly<Record<string, unknown>>;

/** What the worker asks USGS: an endpoint and its payload. */
export interface UsgsCall {
    readonly endpoint: Endpoint;
    readonly payload: Payload;
}

/** An M2M product id (`download-options` → `id`, which `download-request` names). */
const PRODUCT_ID = /^[A-Za-z0-9_-]{1,64}$/;

function isRecord(value: unknown): value is Payload {
    return typeof value === 'object' && value !== null;
}

/** The product a `download-request` names, when it names one well-formed product. */
function productIdOf(payload: Payload): string | undefined {
    const downloads = payload['downloads'];
    const first: unknown = Array.isArray(downloads) ? downloads[0] : undefined;
    const productId = isRecord(first) ? first['productId'] : undefined;
    return typeof productId === 'string' && PRODUCT_ID.test(productId) ? productId : undefined;
}

interface Scene {
    readonly dataset: unknown;
    readonly entityId: string;
    readonly label: string;
}

/** The only payload `endpoint` may carry for the job's scene (the product id is the one the worker chose). */
function expected(endpoint: Endpoint, scene: Scene, payload: Payload): Payload {
    switch (endpoint) {
        case 'download-options':
            return { datasetName: scene.dataset, entityIds: [scene.entityId] };
        case 'download-request':
            return { downloads: [{ entityId: scene.entityId, productId: productIdOf(payload) }], label: scene.label };
        case 'download-retrieve':
        case 'download-order-remove':
            return { label: scene.label };
    }
}

/** The scene and label of a USGS import (`hcm-<job>`, the pipeline's `label_for`), or `apiError.worker.refused`. */
function sceneFor(job: JobDoc, jobId: string): Scene {
    const entityId = sceneOf(job);
    if (entityId === undefined) {
        throw new ApiError('apiError.worker.refused');
    }
    return { dataset: job.params['dataset'], entityId, label: `hcm-${jobId}` };
}

/** One M2M call for the worker's job, its payload checked first (`apiError.worker.refused`, nothing called). */
export async function proxyUsgs(deps: UsgsProxyDeps, job: JobDoc, jobId: string, call: UsgsCall): Promise<unknown> {
    const { endpoint, payload } = call;
    if (!isDeepStrictEqual(payload, expected(endpoint, sceneFor(job, jobId), payload))) {
        throw new ApiError('apiError.worker.refused');
    }
    return withUsgs(deps, (apiKey) => deps.usgs.request(apiKey, endpoint, payload));
}
