/** The crashes page as the admin loads it lazily, in a chunk of its own (`DECISIONS-for-review.md` §34b): its tag and definer. */
import { defineHcmCrashesListPage, HCM_CRASHES_LIST_PAGE_TAG } from '../crashes/hcm-crashes-list-page.js';
import type { AreaElements } from './area.js';

export const AREA_ELEMENTS: AreaElements = { tag: HCM_CRASHES_LIST_PAGE_TAG, define: defineHcmCrashesListPage };
