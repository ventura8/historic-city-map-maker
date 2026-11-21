/** M13's contribute area as one lazy chunk (`DECISIONS-for-review.md` §34b): its page's elements and its store's module. */
import { AREA_ELEMENTS } from '@hcm/ui/admin/areas/contribute';

import { CONTRIBUTE_MODULE } from '../contribute/contribute.js';
import type { AreaChunk } from '../routing/area-chunk.js';

export const AREA: AreaChunk<'contribute'> = { elements: AREA_ELEMENTS, module: CONTRIBUTE_MODULE };
