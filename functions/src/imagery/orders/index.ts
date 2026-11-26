/**
 * The `usgs.*` order callables (`docs/research/M4-interfaces.md` §1.4): "I ordered it", "Check now" and "Take the mark
 * back" of the Imagery area's order card. `functions/src/index.ts` exports `usgs = usgsFunctions(getDeps)`, which
 * deploys `usgs-markOrdered`, `usgs-checkOrder` and `usgs-cancelOrder`; the daily watch is `imagery.tick`'s step
 * `orders` (`watch.ts`). Part of the imagery feature folder: it reuses the M3 import, ranking and USGS session.
 */
import type { CallableDeps } from '../../api/callable.js';
import { checkOrderFunction } from './check-now.js';
import type { CheckDeps } from './check.js';
import { markOrderedFunction } from './mark.js';
import { cancelOrderFunction } from './take-back.js';

export function usgsFunctions(getDeps: () => CheckDeps & CallableDeps) {
    return {
        markOrdered: markOrderedFunction(getDeps),
        checkOrder: checkOrderFunction(getDeps),
        cancelOrder: cancelOrderFunction(getDeps),
    };
}
