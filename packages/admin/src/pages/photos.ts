/** The photos area as one lazy chunk (`DECISIONS-for-review.md` §34b): its page's elements and its store's module. */
import { AREA_ELEMENTS } from '@hcm/ui/admin/areas/photos';

import { PHOTOS_MODULE } from '../photos/module.js';
import type { AreaChunk } from '../routing/area-chunk.js';

export const AREA: AreaChunk<'photos'> = { elements: AREA_ELEMENTS, module: PHOTOS_MODULE };
