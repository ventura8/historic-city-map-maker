/** The history page as the admin loads it lazily, in a chunk of its own (`DECISIONS-for-review.md` §34b): its tag and definer. */
import { defineHcmHistoryPage, HCM_HISTORY_PAGE_TAG } from '../history/hcm-history-page.js';
import type { AreaElements } from './area.js';

export const AREA_ELEMENTS: AreaElements = { tag: HCM_HISTORY_PAGE_TAG, define: defineHcmHistoryPage };
