/** The admins page as the admin loads it lazily, in a chunk of its own (`DECISIONS-for-review.md` §34b): its tag and definer. */
import { defineHcmAdminsPage, HCM_ADMINS_PAGE_TAG } from '../admins/hcm-admins-page.js';
import type { AreaElements } from './area.js';

export const AREA_ELEMENTS: AreaElements = { tag: HCM_ADMINS_PAGE_TAG, define: defineHcmAdminsPage };
