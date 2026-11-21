/**
 * The `history.*` functions (fn-admin, `docs/research/M2-interfaces.md` §2.2, §3.2): the six audit triggers and the
 * `history.revert` callable. The integrator's `functions/src/index.ts` exports `history = historyFunctions(getDeps)`,
 * which deploys `history-onCityWrite`, ..., `history-revert`.
 */
import type { CallableDeps } from '../api/callable.js';
import { historyTrigger, type RecordDeps } from './record.js';
import { revertFunction, type RevertDeps } from './revert.js';

export type HistoryFamilyDeps = CallableDeps & RecordDeps & RevertDeps;

export function historyFunctions(getDeps: () => HistoryFamilyDeps) {
    return {
        onCityWrite: historyTrigger('history.onCityWrite', getDeps),
        onLayerWrite: historyTrigger('history.onLayerWrite', getDeps),
        onPhotoWrite: historyTrigger('history.onPhotoWrite', getDeps),
        onPoiWrite: historyTrigger('history.onPoiWrite', getDeps),
        onPoiCategoryWrite: historyTrigger('history.onPoiCategoryWrite', getDeps),
        onStoryWrite: historyTrigger('history.onStoryWrite', getDeps),
        revert: revertFunction(getDeps),
    };
}
