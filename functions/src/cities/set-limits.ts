import '../global-options.js';

import { FIRESTORE_PATHS, cityDocSchema, timestampFromDate, type CallableRequest, type CallableResponse } from '@hcm/shared';

import type { VerifiedCaller } from '../api/access.js';
import { ApiError } from '../api/api-error.js';
import { defineCallable, type CallableDeps } from '../api/callable.js';
import type { Ports } from '../ports/index.js';

export type SetLimitsDeps = Pick<Ports, 'documents' | 'clock' | 'log'>;

/**
 * `cities.setLimits` (the project's owner; `docs/research/M5-interfaces.md` §1.8; S-A52-HAPPY, S-A52-BAD-NOT-PROJECT-OWNER):
 * a city's share of the project's budgets, `cities/{city}.limits`, which no client may write. The request's schema
 * holds each limit under the project's own cap; the project's caps keep holding beside it. A missing city →
 * `apiError.notFound`. The limits are no manifest field, so no build follows.
 */
async function citiesSetLimits(
    deps: SetLimitsDeps,
    caller: VerifiedCaller,
    request: CallableRequest<'cities.setLimits'>,
): Promise<CallableResponse<'cities.setLimits'>> {
    const path = FIRESTORE_PATHS.city(request.cityId);
    await deps.documents.transaction(async (transaction) => {
        const city = await transaction.get(path, cityDocSchema);
        if (city === undefined) {
            throw new ApiError('apiError.notFound');
        }
        const stamp = { updatedBy: caller.uid, updatedAt: timestampFromDate(deps.clock.now()) };
        await transaction.set(path, cityDocSchema, { ...city, limits: request.limits, ...stamp });
    });
    deps.log.info('city limits set', { uid: caller.uid, cityId: request.cityId });
    return { limits: request.limits };
}

/** The `cities-setLimits` callable. */
export function setLimitsFunction(getDeps: () => SetLimitsDeps & CallableDeps) {
    return defineCallable('cities.setLimits', citiesSetLimits, getDeps);
}
