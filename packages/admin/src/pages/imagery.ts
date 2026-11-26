/** The Imagery area as one lazy chunk (`docs/research/M3-interfaces.md` §10.1): its page's elements and its store's module. */
import { AREA_ELEMENTS } from '@hcm/ui/admin/areas/imagery';

import { IMAGERY_MODULE } from '../imagery/imagery.js';
import type { AreaChunk } from '../routing/area-chunk.js';

export const AREA: AreaChunk<'imagery'> = { elements: AREA_ELEMENTS, module: IMAGERY_MODULE };
