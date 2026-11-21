/**
 * Finding 85 of 2026-11-05: a scene whose import ended for good goes back to `candidate`, so it can be imported again. The
 * server's own endings free it (`end.ts`), but a run that failed in the pipeline ends the job by itself, and dismissing that
 * version left the scene `imported` for ever, with no Import to offer. Freed when the layer it reserved does not exist, is
 * not waiting out a deletion's grace, nor left by a deletion that failed for good (a revert brings it back, its tiles still at
 * Mapbox) and no version holds its id (`holdsLayerId`: a failed one may
 * still be retried): on a dismissal, once a layer's deletion has run, and on every tick for a scene an earlier release left
 * behind. An order that bought the scan goes with its import (`freedScene`).
 */
import {
    FIRESTORE_PATHS,
    layerDocSchema,
    layerVersionDocSchema,
    usgsSceneDocSchema,
    type OrderState,
    type UsgsSceneDoc,
} from '@hcm/shared';

import { omit } from '../api/objects.js';
import type { DocumentTransaction } from '../ports/documents.js';
import type { Ports } from '../ports/index.js';
import { IMAGERY_WRITER, stampOf, type Stamp } from './records.js';
import { deletionsPending, holdsLayerId } from './versions.js';

export type ReleaseDeps = Pick<Ports, 'documents' | 'clock'>;

/** The states of an order whose import is what ended: nothing is left for the order to do. */
const ORDER_OF_THE_IMPORT: readonly OrderState[] = ['importing', 'imported'];

/**
 * The order without what its ended import was. Not back to `delivered`: the watch imports a delivered order by itself, so a
 * Cancel or a Dismiss would start again within five minutes; a scene USGS delivered and with no order is `available`, whose
 * Import is the admin's own click (`acquisitionState`).
 */
function withoutImportOrder(scene: UsgsSceneDoc): UsgsSceneDoc {
    return scene.order !== undefined && ORDER_OF_THE_IMPORT.includes(scene.order.state) ? omit(scene, ['order']) : scene;
}

/** The scene with its import ended for good: `candidate`, its reserved layer id and its import's order gone. */
export function freedScene(scene: UsgsSceneDoc, stamp: Stamp): UsgsSceneDoc {
    return { ...omit(withoutImportOrder(scene), ['layerId']), status: 'candidate', ...stamp };
}

/** True when one of the layer's versions (`ids`, re-read in the transaction) may still become its layer. */
async function versionHolds(transaction: DocumentTransaction, cityId: string, ids: readonly string[]): Promise<boolean> {
    for (const id of ids) {
        const version = await transaction.get(FIRESTORE_PATHS.layerVersion(cityId, id), layerVersionDocSchema);
        if (version !== undefined && holdsLayerId(version.state)) {
            return true;
        }
    }
    return false;
}

/** The scene back to `candidate`, in a transaction that finds it still held by nothing. */
export async function releaseScene(deps: ReleaseDeps, cityId: string, entityId: string, layerId: string): Promise<void> {
    if ((await deletionsPending(deps.documents, cityId)).includes(layerId)) {
        return;
    }
    const versions = await deps.documents.query(FIRESTORE_PATHS.layerVersions(cityId), layerVersionDocSchema, {
        where: [['layerId', '==', layerId]],
    });
    const ids = versions.documents.map((version) => version.id);
    const path = FIRESTORE_PATHS.usgsScene(cityId, entityId);
    await deps.documents.transaction(async (transaction) => {
        const scene = await transaction.get(path, usgsSceneDocSchema);
        const layer = await transaction.get(FIRESTORE_PATHS.layer(cityId, layerId), layerDocSchema);
        const held = await versionHolds(transaction, cityId, ids);
        if (scene?.layerId === layerId && layer === undefined && !held) {
            await transaction.set(path, usgsSceneDocSchema, freedScene(scene, stampOf(IMAGERY_WRITER, deps.clock.now())));
        }
    });
}

/** Every scene of a layer whose deletion has just run (its tileset and files are gone: nothing can bring it back). */
export async function releaseLayerScenes(deps: ReleaseDeps, cityId: string, layerId: string): Promise<void> {
    const scenes = await deps.documents.query(FIRESTORE_PATHS.usgsScenes(cityId), usgsSceneDocSchema, {
        where: [['layerId', '==', layerId]],
    });
    for (const { id } of scenes.documents) {
        await releaseScene(deps, cityId, id, layerId);
    }
}

function reservedLayer(scene: UsgsSceneDoc): string | undefined {
    return scene.status === 'imported' ? scene.layerId : undefined;
}

/** A scene whose layer exists holds it: one read, and the tick goes no further (most imported scenes, on every tick). */
async function releaseUnlessItsLayerExists(deps: ReleaseDeps, cityId: string, entityId: string, layerId: string): Promise<void> {
    const layer = await deps.documents.get(FIRESTORE_PATHS.layer(cityId, layerId), layerDocSchema);
    if (layer === undefined) {
        await releaseScene(deps, cityId, entityId, layerId);
    }
}

/** Every `imported` scene of the city that nothing holds any more goes back to `candidate`. */
export async function releaseScenes(deps: ReleaseDeps, cityId: string): Promise<void> {
    const scenes = await deps.documents.query(FIRESTORE_PATHS.usgsScenes(cityId), usgsSceneDocSchema, {
        where: [['status', '==', 'imported']],
    });
    for (const { id, data } of scenes.documents) {
        const layerId = reservedLayer(data);
        if (layerId !== undefined) {
            await releaseUnlessItsLayerExists(deps, cityId, id, layerId);
        }
    }
}
