/** The review page as the admin loads it lazily, in a chunk of its own (M13): its tag and definer. */
import { defineHcmReviewPage, HCM_REVIEW_PAGE_TAG } from '../review/hcm-review-page.js';
import type { AreaElements } from './area.js';

export const AREA_ELEMENTS: AreaElements = { tag: HCM_REVIEW_PAGE_TAG, define: defineHcmReviewPage };
