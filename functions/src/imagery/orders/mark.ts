import '../../global-options.js';

import {
    FIRESTORE_PATHS,
    acquisitionState,
    timestampToDate,
    usgsSceneDocSchema,
    type CallableRequest,
    type CallableResponse,
    type UsgsSceneDoc,
} from '@hcm/shared';

import type { VerifiedCaller } from '../../api/access.js';
import { ApiError } from '../../api/api-error.js';
import { defineCallable, type CallableDeps } from '../../api/callable.js';
import { IMAGERY_WRITER, requireCity, stampOf } from '../records.js';
import { rankNow } from '../scene-rank.js';
import { requireUsgs, usgsDownloads, withUsgs } from '../usgs-session.js';
import type { CheckDeps } from './check.js';
import { newOrder } from './order.js';
import { eeDatasetIdOf, requireScene } from './scene-order.js';

/**
 * `usgs.markOrdered` (admin; `docs/research/M4-interfaces.md` §1.4; S-A13-*): "I ordered it", the one click after the
 * admin's own purchase in EarthExplorer. A scene USGS already offers is refused (`apiError.usgs.alreadyAvailable`: Import
 * is free), and so is one that has an open order or was imported (`apiError.usgs.orderState`); USGS is asked first when
 * the city may download, so a scene scanned meanwhile becomes free instead of ordered (a USGS failure only defers the
 * question to the watch). The order is written in one transaction, stamped by the admin; the watch takes it from there.
 */
type Request = CallableRequest<'usgs.markOrdered'>;

/** `alreadyAvailable` for a scene USGS offers; `orderState` for one that has an open order or was imported. */
function refuseMark(scene: UsgsSceneDoc): void {
    const state = acquisitionState(scene);
    if (state !== 'needsOrder' && state !== 'expired' && state !== 'available') {
        throw new ApiError('apiError.usgs.orderState');
    }
    if (scene.downloadAvailable) {
        throw new ApiError('apiError.usgs.alreadyAvailable');
    }
}

/** The scene USGS lists after all: free (its EarthExplorer id kept) and ranked again, as `markNotScanned` does the reverse. */
async function markScanned(deps: CheckDeps, scene: UsgsSceneDoc, datasetId: string | undefined, cityId: string): Promise<never> {
    const free: UsgsSceneDoc = { ...scene, downloadAvailable: true, ...eeDatasetIdOf(scene.eeDatasetId ?? datasetId) };
    await deps.documents.set(FIRESTORE_PATHS.usgsScene(cityId, scene.entityId), usgsSceneDocSchema, {
        ...free,
        rank: await rankNow(deps, cityId, free),
        ...stampOf(IMAGERY_WRITER, deps.clock.now()),
    });
    throw new ApiError('apiError.usgs.alreadyAvailable');
}

/**
 * Asks USGS about the scene first (one session): listed → made free and refused; else EarthExplorer's dataset id the
 * answer carried. A USGS failure is not the admin's: the mark is recorded and the watch asks later.
 */
async function askFirst(deps: CheckDeps, cityId: string, scene: UsgsSceneDoc): Promise<string | undefined> {
    const options = await withUsgs(deps, (apiKey) => deps.scenes.downloadOptions(apiKey, scene.dataset, [scene.entityId])).catch(
        (error: unknown) => {
            deps.log.warn('usgs not asked before an order was marked', { entityId: scene.entityId, error: String(error) });
            return [];
        },
    );
    const option = options.find((candidate) => candidate.entityId === scene.entityId);
    if (option?.available === true) {
        return markScanned(deps, scene, option.datasetId, cityId);
    }
    return option?.datasetId;
}

async function markOrdered(deps: CheckDeps, caller: VerifiedCaller, request: Request): Promise<CallableResponse<'usgs.markOrdered'>> {
    await requireCity(deps.documents, request.cityId);
    const usgs = await requireUsgs(deps.setup);
    const scene = await requireScene(deps.documents, request);
    refuseMark(scene);
    const datasetId = usgsDownloads(usgs) ? await askFirst(deps, request.cityId, scene) : undefined;
    const now = deps.clock.now();
    const order = newOrder(caller.uid, now);
    const path = FIRESTORE_PATHS.usgsScene(request.cityId, request.entityId);
    await deps.documents.transaction(async (transaction) => {
        const current = await transaction.get(path, usgsSceneDocSchema);
        if (current === undefined) {
            throw new ApiError('apiError.notFound');
        }
        refuseMark(current);
        const ids = eeDatasetIdOf(current.eeDatasetId ?? datasetId);
        await transaction.set(path, usgsSceneDocSchema, { ...current, ...ids, order, ...stampOf(caller.uid, now) });
    });
    deps.log.info('usgs order marked', { uid: caller.uid, cityId: request.cityId, entityId: request.entityId });
    return { state: 'ordered', nextCheckAt: timestampToDate(order.nextCheckAt).toISOString() };
}

/** The `usgs-markOrdered` callable. */
export function markOrderedFunction(getDeps: () => CheckDeps & CallableDeps) {
    return defineCallable('usgs.markOrdered', markOrdered, getDeps);
}
