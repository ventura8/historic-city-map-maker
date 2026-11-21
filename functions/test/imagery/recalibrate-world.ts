/**
 * M16: the world of the recalibration tests (`recalibrate.test.ts`, `recalibrate-guards.test.ts`): a layer whose current version is published
 * or waiting for approval, the callables as an admin calls them, and a new version as the pipeline leaves it once rendered.
 */
import { type JobDoc, type LayerVersionDoc, type Recalibration } from '@hcm/shared';

import { approveFunction } from '../../src/imagery/approve.js';
import { recalibrateFunction } from '../../src/imagery/recalibrate.js';
import { failureOf } from '../admin/world.js';
import { adminCall } from '../publish/fakes.js';
import {
    CITY,
    NOW,
    at,
    readJob,
    readVersion,
    readyWorld,
    renderedVersion,
    seedJob,
    seedLayer,
    seedVersion,
    type ImageryWorld,
} from './world.js';

export const CURRENT = 'job-1966-0712';
export const LAYER = 'kh-4a-corona-1966';
export const MAPBOX = { tilesetId: 'e2e-mapbox.hcm-bucharest-kh-4a-corona-1966', origin: 'mts' } as const;
export const WAITING = { status: 'awaiting_approval', waitReason: 'approval' } as const;

export function job(overrides: Partial<JobDoc> = {}): JobDoc {
    return {
        type: 'usgs-import',
        status: 'succeeded',
        params: { entityId: 'DS1035-1057DA023', dataset: 'corona2', sensor: 'KH-4A' },
        createdBy: 'u-admin',
        createdAt: at(NOW),
        layerId: LAYER,
        versionId: CURRENT,
        updatedBy: 'system:pipeline',
        updatedAt: at(NOW),
        ...overrides,
    };
}

export async function world(
    state: 'published' | 'awaiting_approval' = 'published',
    version: Partial<LayerVersionDoc> = {},
): Promise<ImageryWorld> {
    const found = await readyWorld();
    const published = state === 'published' ? { mapbox: MAPBOX } : {};
    await seedVersion(found, CURRENT, renderedVersion({ state, ...published, ...version }));
    await seedJob(found, CURRENT, job(state === 'published' ? {} : WAITING));
    await seedLayer(found, LAYER, state === 'published' ? { currentVersion: CURRENT } : { pendingVersion: CURRENT });
    return found;
}

export function recalibrate(found: ImageryWorld, data: Record<string, unknown>, deps: ImageryWorld['deps'] = found.deps) {
    return recalibrateFunction(() => deps).run(adminCall({ cityId: CITY, versionId: CURRENT, route: 'auto', ...data }));
}

export function approve(found: ImageryWorld, versionId: string, acceptWorse?: true) {
    const data = acceptWorse === undefined ? {} : { acceptWorse };
    return approveFunction(() => found.deps).run(adminCall({ cityId: CITY, versionId, ...data }));
}

export async function required<T>(read: Promise<T | undefined>): Promise<T> {
    const found = await read;
    if (found === undefined) {
        throw new Error('not found');
    }
    return found;
}

export function codeOf(promise: Promise<unknown>): Promise<unknown> {
    return failureOf(promise).then((failure) => (failure.details as { code?: unknown } | undefined)?.code);
}

/** The new version, rendered and waiting with its job, as the pipeline leaves it. */
export async function rendered(found: ImageryWorld, id: string, recalibration: Recalibration): Promise<void> {
    const version = await required(readVersion(found, id));
    await seedVersion(found, id, renderedVersion({ ...version, layerId: LAYER, jobId: id, state: 'awaiting_approval', recalibration }));
    const started = await required(readJob(found, id));
    await seedJob(found, id, { ...started, ...WAITING });
}
