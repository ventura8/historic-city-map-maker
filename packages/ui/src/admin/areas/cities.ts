/** The New city page as the admin loads it lazily, in a chunk of its own (M5): its tag and definer. */
import { defineHcmNewCityPage, HCM_NEW_CITY_PAGE_TAG } from '../cities/hcm-new-city-page.js';
import type { AreaElements } from './area.js';

export const AREA_ELEMENTS: AreaElements = { tag: HCM_NEW_CITY_PAGE_TAG, define: defineHcmNewCityPage };
