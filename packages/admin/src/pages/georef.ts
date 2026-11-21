/** The georeferencer as one lazy chunk (`docs/research/M3-interfaces.md` §10.1): its page's elements and its store's module. */
import { AREA_ELEMENTS } from '@hcm/ui/admin/areas/georef';

import { GEOREF_MODULE } from '../georef/georef.js';
import type { AreaChunk } from '../routing/area-chunk.js';

export const AREA: AreaChunk<'georef'> = { elements: AREA_ELEMENTS, module: GEOREF_MODULE };
