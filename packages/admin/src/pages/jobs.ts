/** The jobs area as one lazy chunk (`DECISIONS-for-review.md` §34b): its page's elements and its store's module. */
import { AREA_ELEMENTS } from '@hcm/ui/admin/areas/jobs';

import { JOBS_MODULE } from '../jobs/jobs.js';
import type { AreaChunk } from '../routing/area-chunk.js';

export const AREA: AreaChunk<'jobs'> = { elements: AREA_ELEMENTS, module: JOBS_MODULE };
