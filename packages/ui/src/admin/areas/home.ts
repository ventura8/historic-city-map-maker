/** The home page as the admin loads it lazily, in a chunk of its own (`DECISIONS-for-review.md` §34b): its tag and definer. */
import { defineHcmHomePage, HCM_HOME_PAGE_TAG } from '../home/hcm-home-page.js';
import type { AreaElements } from './area.js';

export const AREA_ELEMENTS: AreaElements = { tag: HCM_HOME_PAGE_TAG, define: defineHcmHomePage };
