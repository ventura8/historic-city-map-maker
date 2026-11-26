import '../../global-options.js';

import { FIRESTORE_PATHS, acquisitionState, usgsSceneDocSchema, type CallableRequest, type CallableResponse } from '@hcm/shared';

import type { VerifiedCaller } from '../../api/access.js';
import { ApiError } from '../../api/api-error.js';
import { defineCallable, type CallableDeps } from '../../api/callable.js';
import { omit } from '../../api/objects.js';
import type { Ports } from '../../ports/index.js';
import { requireCity, stampOf } from '../records.js';
import { OPEN_ORDER_STATES } from './order.js';
import { orderIn } from './scene-order.js';

/**
 * `usgs.cancelOrder` (admin; `docs/research/M4-interfaces.md` §1.4; S-A13-HAPPY-TAKE-BACK): "Take the mark back", the
 * Undo of "I ordered it" (a mistake, or an order cancelled at USGS). Only an order USGS has not delivered: its record is
 * removed in one transaction and the scene keeps everything else; it answers the scene's state without it.
 */
export type TakeBackDeps = Pick<Ports, 'documents' | 'clock' | 'log'>;

type Request = CallableRequest<'usgs.cancelOrder'>;

async function cancelOrder(deps: TakeBackDeps, caller: VerifiedCaller, request: Request): Promise<CallableResponse<'usgs.cancelOrder'>> {
    await requireCity(deps.documents, request.cityId);
    const path = FIRESTORE_PATHS.usgsScene(request.cityId, request.entityId);
    const now = deps.clock.now();
    const scene = await deps.documents.transaction(async (transaction) => {
        const current = await transaction.get(path, usgsSceneDocSchema);
        if (current === undefined) {
            throw new ApiError('apiError.notFound');
        }
        if (!orderIn(current, OPEN_ORDER_STATES)) {
            throw new ApiError('apiError.usgs.orderState');
        }
        const unmarked = { ...omit(current, ['order']), ...stampOf(caller.uid, now) };
        await transaction.set(path, usgsSceneDocSchema, unmarked);
        return unmarked;
    });
    deps.log.info('usgs order mark taken back', { uid: caller.uid, cityId: request.cityId, entityId: request.entityId });
    return { state: acquisitionState(scene) };
}

/** The `usgs-cancelOrder` callable. */
export function cancelOrderFunction(getDeps: () => TakeBackDeps & CallableDeps) {
    return defineCallable('usgs.cancelOrder', cancelOrder, getDeps);
}
