import '../global-options.js';

import type { CallableRequest, CallableResponse } from '@hcm/shared';

import type { VerifiedCaller } from '../api/access.js';
import { defineCallable, type CallableDeps } from '../api/callable.js';
import { harvestCity, type HarvestDeps } from './harvest.js';

/**
 * `imagery.search` (admin; `docs/research/M3-interfaces.md` §3.1, S-A11-*): harvests and ranks the city's declassified
 * frames now. The Imagery area calls it when it opens on a harvest older than `HARVEST_EVERY_DAYS`, or on Search.
 */
async function imagerySearch(
    deps: HarvestDeps,
    caller: VerifiedCaller,
    request: CallableRequest<'imagery.search'>,
): Promise<CallableResponse<'imagery.search'>> {
    deps.log.info('usgs harvest requested', { uid: caller.uid, cityId: request.cityId });
    return harvestCity(deps, request);
}

/** The `imagery-search` callable. */
export function searchFunction(getDeps: () => HarvestDeps & CallableDeps) {
    return defineCallable('imagery.search', imagerySearch, getDeps);
}
