/**
 * Swipe compare's lazy chunk (M4, docs/research/M4-interfaces.md §3.2): `import('./compare/compare.js')` from the entry
 * (`mount.ts` → `loadCompare`) makes the ES module build emit it as `compare-<hash>.js` beside `engine.mjs`, fetched the
 * first time the visitor compares; the IIFE build inlines it. Its module is the `CompareModule` the entry's driver starts.
 */
import { createCompareUi } from '@hcm/ui/viewer/compare';

import type { CompareModule } from '../core/compare-port.js';
import { startCompare } from './session.js';

export const compareModule: CompareModule = { startCompare, createCompareUi };
