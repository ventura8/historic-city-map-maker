/** The history area as one lazy chunk (`DECISIONS-for-review.md` §34b): its page's elements and its store's module. */
import { AREA_ELEMENTS } from '@hcm/ui/admin/areas/history';

import { HISTORY_MODULE } from '../history/history.js';
import type { AreaChunk } from '../routing/area-chunk.js';

export const AREA: AreaChunk<'history'> = { elements: AREA_ELEMENTS, module: HISTORY_MODULE };
