// `@hcm/ui/viewer/compare` (M4, docs/research/M4-interfaces.md §3.2): swipe compare's surface, imported only by the engine's
// lazy compare chunk (never from `@hcm/ui`'s root), so none of it is in `engine.mjs`.
export { createCompareUi } from './compare-ui.js';
export type { CompareChoice, CompareUi, CompareUiEvents, CompareUiFactory, CompareUiMode, CompareUiProps } from './compare-types.js';
export { dividerKey, dividerPercent, draggedPosition } from './divider.js';
export { HCM_COMPARE_TAG, HcmCompare, defineHcmCompare } from './hcm-compare.js';
