import '../../global-options.js';

import { ORDER_CHECK_NOW_MIN_SECONDS, timestampToDate, type CallableRequest, type CallableResponse, type UsgsSceneDoc } from '@hcm/shared';

import type { VerifiedCaller } from '../../api/access.js';
import { ApiError } from '../../api/api-error.js';
import { defineCallable, type CallableDeps } from '../../api/callable.js';
import { requireCity } from '../records.js';
import { requireUsgs, usgsDownloads } from '../usgs-session.js';
import { checkOne, type CheckDeps } from './check.js';
import { OPEN_ORDER_STATES } from './order.js';
import { orderIn, requireScene, type OrderedScene } from './scene-order.js';
import { importDelivered } from './watch.js';

/**
 * `usgs.checkOrder` (admin; `docs/research/M4-interfaces.md` §1.4; S-A13-*): "Check now", never needed (the watch asks
 * daily) but there for an admin who knows USGS delivered. Exactly what the watch does for one order: USGS asked, the
 * answer recorded, a delivered scan imported at once (or by a later tick while the budget guard or today's cap holds it).
 * At most once a minute per scene (`apiError.rateLimited`); a USGS failure is recorded on the order and answered.
 */
type Request = CallableRequest<'usgs.checkOrder'>;
type Response = CallableResponse<'usgs.checkOrder'>;

/** The order "Check now" may ask about, not asked about within the last minute. */
function checkable(scene: UsgsSceneDoc, now: Date): OrderedScene {
    if (!orderIn(scene, OPEN_ORDER_STATES)) {
        throw new ApiError('apiError.usgs.orderState');
    }
    const last = scene.order.lastCheckedAt;
    if (last !== undefined && now.getTime() - timestampToDate(last).getTime() < ORDER_CHECK_NOW_MIN_SECONDS * 1000) {
        throw new ApiError('apiError.rateLimited');
    }
    return scene;
}

/** The callable answer after the order was checked (and imported when delivered). */
function answerOf(written: OrderedScene, available: boolean, jobId: string | undefined): Response {
    if (written.order.state !== 'delivered') {
        return { state: written.order.state, available };
    }
    return jobId === undefined ? { state: 'delivered', available } : { state: 'importing', available, jobId };
}

async function checkOrder(deps: CheckDeps, caller: VerifiedCaller, request: Request): Promise<Response> {
    await requireCity(deps.documents, request.cityId);
    const usgs = await requireUsgs(deps.setup);
    const scene = checkable(await requireScene(deps.documents, request), deps.clock.now());
    if (!usgsDownloads(usgs)) {
        throw new ApiError('apiError.usgs.accessPending');
    }
    // DDS e-mail download page: M2M may still say unavailable; the admin confirms and we treat it as delivered.
    const { scene: written, outcome } = await checkOne(deps, {
        cityId: request.cityId,
        scene,
        by: caller.uid,
        ...(request.fromOrderPage === true ? { forced: { kind: 'available' as const } } : {}),
    });
    if (outcome.kind === 'failed') {
        throw new ApiError(outcome.code);
    }
    const jobId = written.order.state === 'delivered' ? await importDelivered(deps, request.cityId, written, deps.clock.now()) : undefined;
    deps.log.info('usgs order checked now', {
        uid: caller.uid,
        cityId: request.cityId,
        entityId: request.entityId,
        jobId,
        fromOrderPage: request.fromOrderPage === true,
    });
    return answerOf(written, outcome.kind === 'available', jobId);
}

/** The `usgs-checkOrder` callable. */
export function checkOrderFunction(getDeps: () => CheckDeps & CallableDeps) {
    return defineCallable('usgs.checkOrder', checkOrder, getDeps);
}
