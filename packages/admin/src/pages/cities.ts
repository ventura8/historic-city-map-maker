/** The New city flow as one lazy chunk (`docs/research/M5-interfaces.md` §1.6): its page's elements and its store's module. */
import { AREA_ELEMENTS } from '@hcm/ui/admin/areas/cities';

import { CITIES_MODULE } from '../cities/new-city.js';
import type { AreaChunk } from '../routing/area-chunk.js';

export const AREA: AreaChunk<'cities'> = { elements: AREA_ELEMENTS, module: CITIES_MODULE };
