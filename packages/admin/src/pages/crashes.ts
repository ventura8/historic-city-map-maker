/** The crashes area as one lazy chunk (`DECISIONS-for-review.md` §34b): its page's elements and its store's module. */
import { AREA_ELEMENTS } from '@hcm/ui/admin/areas/crashes';

import { CRASHES_MODULE } from '../crashes/crashes.js';
import type { AreaChunk } from '../routing/area-chunk.js';

export const AREA: AreaChunk<'crashes'> = { elements: AREA_ELEMENTS, module: CRASHES_MODULE };
