/** The layers area as one lazy chunk (`DECISIONS-for-review.md` §34b): its page's elements and its store's module. */
import { AREA_ELEMENTS } from '@hcm/ui/admin/areas/layers';

import { layersModule } from '../layers/layers.js';
import type { AreaChunk } from '../routing/area-chunk.js';

export const AREA: AreaChunk<'layers'> = { elements: AREA_ELEMENTS, module: layersModule };
