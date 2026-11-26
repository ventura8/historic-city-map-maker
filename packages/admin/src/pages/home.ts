/** The home area as one lazy chunk (`DECISIONS-for-review.md` §34b): its page's elements and its store's module. */
import { AREA_ELEMENTS } from '@hcm/ui/admin/areas/home';

import { HOME_MODULE } from '../home/home.js';
import type { AreaChunk } from '../routing/area-chunk.js';

export const AREA: AreaChunk<'home'> = { elements: AREA_ELEMENTS, module: HOME_MODULE };
