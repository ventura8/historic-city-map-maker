/** The jobs page as the admin loads it lazily, in a chunk of its own (`DECISIONS-for-review.md` §34b): its tag and definer. */
import { defineHcmJobsPage, HCM_JOBS_PAGE_TAG } from '../jobs/hcm-jobs-page.js';
import type { AreaElements } from './area.js';

export const AREA_ELEMENTS: AreaElements = { tag: HCM_JOBS_PAGE_TAG, define: defineHcmJobsPage };
