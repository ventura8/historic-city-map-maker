/** The inbox as one lazy chunk (`docs/research/M4-interfaces.md` §5.5): its page's elements and its store's module. */
import { AREA_ELEMENTS } from '@hcm/ui/admin/areas/inbox';

import { INBOX_MODULE } from '../inbox/inbox.js';
import type { AreaChunk } from '../routing/area-chunk.js';

export const AREA: AreaChunk<'inbox'> = { elements: AREA_ELEMENTS, module: INBOX_MODULE };
