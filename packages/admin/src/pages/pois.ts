/** The pois area as one lazy chunk (`DECISIONS-for-review.md` §34b): its page's elements and its store's module. */
import { AREA_ELEMENTS } from '@hcm/ui/admin/areas/pois';

import { POIS_MODULE } from '../pois/pois.js';
import type { AreaChunk } from '../routing/area-chunk.js';

export const AREA: AreaChunk<'pois'> = { elements: AREA_ELEMENTS, module: POIS_MODULE };
