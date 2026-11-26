/** M13's review area as one lazy chunk (`DECISIONS-for-review.md` §34b): its page's elements and its store's module. */
import { AREA_ELEMENTS } from '@hcm/ui/admin/areas/review';

import { REVIEW_MODULE } from '../review/review.js';
import type { AreaChunk } from '../routing/area-chunk.js';

export const AREA: AreaChunk<'review'> = { elements: AREA_ELEMENTS, module: REVIEW_MODULE };
