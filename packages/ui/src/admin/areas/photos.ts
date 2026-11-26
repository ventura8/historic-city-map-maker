/** The photos page as the admin loads it lazily, in a chunk of its own (`DECISIONS-for-review.md` §34b): its tag and definer. */
import { definePhotosElements } from '../photos/define.js';
import { HCM_PHOTOS_PAGE_TAG } from '../photos/hcm-photos-page.js';
import type { AreaElements } from './area.js';

export const AREA_ELEMENTS: AreaElements = { tag: HCM_PHOTOS_PAGE_TAG, define: definePhotosElements };
