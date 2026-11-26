/**
 * Reading and writing a scene's order (`docs/research/M4-interfaces.md` §1.3, §1.5): every write re-reads the scene in a
 * transaction and changes it only while its order is still in a state the writer expects, so a "Check now" and the tick
 * at once, or a click on a stale page, never move an order twice.
 */
import {
    EE_DATASET_ID_PATTERN,
    FIRESTORE_PATHS,
    usgsSceneDocSchema,
    type OrderState,
    type UsgsOrder,
    type UsgsSceneDoc,
} from '@hcm/shared';

import { ApiError } from '../../api/api-error.js';
import type { Ports } from '../../ports/index.js';
import { stampOf } from '../records.js';

/** A scene that has an order. */
export type OrderedScene = UsgsSceneDoc & { readonly order: UsgsOrder };

/** Which city, and when (the watch's run, a callable's call). */
export interface CityNow {
    readonly cityId: string;
    readonly now: Date;
}

/** Which scene of which city. */
export interface ScenePlace {
    readonly cityId: string;
    readonly entityId: string;
}

/** Who writes, when: an admin's uid (a callable) or `system:imagery` (the watch). */
export interface Writer {
    readonly by: string;
    readonly now: Date;
}

/** The scene an order write is for, and the states its order must still be in. */
export interface OrderTarget extends ScenePlace {
    readonly states: readonly OrderState[];
}

/** The scene, or `apiError.notFound`. */
export async function requireScene(documents: Ports['documents'], place: ScenePlace): Promise<UsgsSceneDoc> {
    const scene = await documents.get(FIRESTORE_PATHS.usgsScene(place.cityId, place.entityId), usgsSceneDocSchema);
    if (scene === undefined) {
        throw new ApiError('apiError.notFound');
    }
    return scene;
}

/** True when the scene has an order in one of `states`. */
export function orderIn(scene: UsgsSceneDoc | undefined, states: readonly OrderState[]): scene is OrderedScene {
    return scene?.order !== undefined && states.includes(scene.order.state);
}

/** EarthExplorer's id of a dataset, when it has the id's shape (`5e839febdccb64b3`). */
export function eeDatasetIdOf(datasetId: string | undefined): Pick<UsgsSceneDoc, 'eeDatasetId'> {
    return datasetId !== undefined && EE_DATASET_ID_PATTERN.test(datasetId) ? { eeDatasetId: datasetId } : {};
}

/**
 * Re-reads the scene in a transaction and, while its order is still in one of `states`, writes `change` of it stamped
 * by the writer. Returns the scene as written, or undefined when it was gone or its order had moved on.
 */
export async function updateOrder<T extends UsgsSceneDoc>(
    documents: Ports['documents'],
    target: OrderTarget,
    change: (scene: OrderedScene) => T,
    writer: Writer,
): Promise<T | undefined> {
    const path = FIRESTORE_PATHS.usgsScene(target.cityId, target.entityId);
    return documents.transaction(async (transaction) => {
        const scene = await transaction.get(path, usgsSceneDocSchema);
        if (!orderIn(scene, target.states)) {
            return undefined;
        }
        const written = { ...change(scene), ...stampOf(writer.by, writer.now) };
        await transaction.set(path, usgsSceneDocSchema, written);
        return written;
    });
}
