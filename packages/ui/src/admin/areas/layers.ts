/** The layers page as the admin loads it lazily, in a chunk of its own (`DECISIONS-for-review.md` §34b): its tag and definer. */
import { defineLayersElements } from '../layers/define.js';
import { HCM_LAYERS_PAGE_TAG } from '../layers/hcm-layers-page.js';
import type { AreaElements } from './area.js';

export const AREA_ELEMENTS: AreaElements = { tag: HCM_LAYERS_PAGE_TAG, define: defineLayersElements };
