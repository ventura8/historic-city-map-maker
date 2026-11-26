/**
 * A scene's order as the Imagery area shows it (`docs/research/M4-interfaces.md` §1.3, §1.7): the one acquisition state
 * of its chip (`acquisitionState`), the order's dates and last failure when it has one, and EarthExplorer's page of the
 * scene (the verified deep link; null when its dataset's EarthExplorer id is not known yet, so the card names the
 * entity id to search for instead of a broken link).
 */
import {
    acquisitionState,
    earthExplorerSceneUrl,
    type ApiErrorCode,
    type OrderState,
    type SceneAcquisitionState,
    type UsgsSceneDoc,
} from '@hcm/shared';

import { isoOf } from '../../content/list.js';

/** What a scene item adds for orders. */
export interface OrderFields {
    readonly acquisition: SceneAcquisitionState;
    /** The order's state, dates and last failure; null without one. */
    readonly order: {
        readonly state: OrderState;
        readonly orderedAt: string;
        readonly nextCheckAt: string;
        readonly lastCheckedAt: string | null;
        readonly lastError: ApiErrorCode | null;
        /** The import a delivery started (its version has the same id). */
        readonly importJobId: string | null;
    } | null;
    readonly earthExplorerUrl: string | null;
}

function orderOf(order: NonNullable<UsgsSceneDoc['order']>): NonNullable<OrderFields['order']> {
    return {
        state: order.state,
        orderedAt: isoOf(order.orderedAt),
        nextCheckAt: isoOf(order.nextCheckAt),
        lastCheckedAt: order.lastCheckedAt === undefined ? null : isoOf(order.lastCheckedAt),
        lastError: order.lastError ?? null,
        importJobId: order.importJobId ?? null,
    };
}

export function orderFieldsOf(scene: UsgsSceneDoc): OrderFields {
    return {
        acquisition: acquisitionState(scene),
        order: scene.order === undefined ? null : orderOf(scene.order),
        earthExplorerUrl: earthExplorerSceneUrl(scene) ?? null,
    };
}
