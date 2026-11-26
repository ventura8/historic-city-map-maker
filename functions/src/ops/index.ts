import { onBudgetFunction } from './budget.js';
import { onProbeFunction } from './probe.js';
import { tickFunction, type OpsDeps } from './tick.js';

/**
 * The `ops.*` functions under their registry names (`docs/research/M2-interfaces.md` §3.7): the scheduled `tick`, the
 * budget alert `onBudget` and, since M6, the self-test's events probe `onProbe` (`docs/research/M6-interfaces.md` §3.2).
 * The integrator exports them as the `ops` group (`export const ops = opsFunctions(getDeps)`).
 */
export function opsFunctions(getDeps: () => OpsDeps) {
    return { tick: tickFunction(getDeps), onBudget: onBudgetFunction(getDeps), onProbe: onProbeFunction(getDeps) };
}
