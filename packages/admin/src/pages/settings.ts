/** The settings area as one lazy chunk (`DECISIONS-for-review.md` §34b): its page's elements and its store's module. */
import { AREA_ELEMENTS } from '@hcm/ui/admin/areas/settings';

import { contrastIssuesOf } from '../app/color.js';
import { settingsModule } from '../settings/settings.js';
import { contrastPasses } from '../settings/theme.js';
import type { AreaChunk } from '../routing/area-chunk.js';

/** The seed colour's contrast check runs on the colour library the entry loads (`../app/color.ts`). */
export const AREA: AreaChunk<'settings'> = {
    elements: AREA_ELEMENTS,
    module: settingsModule({ passes: contrastPasses(contrastIssuesOf) }),
};
