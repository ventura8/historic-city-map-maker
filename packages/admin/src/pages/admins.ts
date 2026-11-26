/** The admins area as one lazy chunk (`DECISIONS-for-review.md` §34b): its page's elements and its store's module. */
import { AREA_ELEMENTS } from '@hcm/ui/admin/areas/admins';

import { ADMINS_MODULE } from '../admins/admins.js';
import type { AreaChunk } from '../routing/area-chunk.js';

export const AREA: AreaChunk<'admins'> = { elements: AREA_ELEMENTS, module: ADMINS_MODULE };
