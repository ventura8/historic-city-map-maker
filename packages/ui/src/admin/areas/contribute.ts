/** The Contribute page as the admin loads it lazily, in a chunk of its own (M13): its tag and definer. */
import { defineHcmContributePage, HCM_CONTRIBUTE_PAGE_TAG } from '../contribute/hcm-contribute-page.js';
import type { AreaElements } from './area.js';

export const AREA_ELEMENTS: AreaElements = { tag: HCM_CONTRIBUTE_PAGE_TAG, define: defineHcmContributePage };
