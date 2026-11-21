/** The stories area as one lazy chunk (M17, `docs/research/M17-stories.md` §6): its page's elements and its store's module. */
import { AREA_ELEMENTS } from '@hcm/ui/admin/areas/stories';

import type { AreaChunk } from '../routing/area-chunk.js';
import { STORIES_MODULE } from '../stories/stories.js';

export const AREA: AreaChunk<'stories'> = { elements: AREA_ELEMENTS, module: STORIES_MODULE };
