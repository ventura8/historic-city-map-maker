/** The pois page as the admin loads it lazily, in a chunk of its own (`DECISIONS-for-review.md` §34b): its tag and definer. */
import { definePoisElements } from '../pois/define.js';
import { HCM_POIS_PAGE_TAG } from '../pois/hcm-pois-page.js';
import type { AreaElements } from './area.js';

export const AREA_ELEMENTS: AreaElements = { tag: HCM_POIS_PAGE_TAG, define: definePoisElements };
