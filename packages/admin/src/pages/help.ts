/** The tile-import wizard as one lazy chunk (`docs/research/M20-import-local.md` §19.11): its page's elements and its store's module. */
import { AREA_ELEMENTS } from '@hcm/ui/admin/areas/help';

import type { AreaChunk } from '../routing/area-chunk.js';
import { TILES_MODULE } from '../tiles/tiles.js';

export const AREA: AreaChunk<'help'> = { elements: AREA_ELEMENTS, module: TILES_MODULE };
