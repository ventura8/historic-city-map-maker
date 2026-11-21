/** The stories page as the admin loads it lazily, in a chunk of its own (M17): its tag and definer. */
import { defineStoriesElements } from '../stories/define.js';
import { HCM_STORIES_PAGE_TAG } from '../stories/hcm-stories-page.js';
import type { AreaElements } from './area.js';

export const AREA_ELEMENTS: AreaElements = { tag: HCM_STORIES_PAGE_TAG, define: defineStoriesElements };
