/** The settings page as the admin loads it lazily, in a chunk of its own (`DECISIONS-for-review.md` §34b): its tag and definer. */
import { defineSettingsElements } from '../settings/define.js';
import { HCM_SETTINGS_PAGE_TAG } from '../settings/hcm-settings-page.js';
import type { AreaElements } from './area.js';

export const AREA_ELEMENTS: AreaElements = { tag: HCM_SETTINGS_PAGE_TAG, define: defineSettingsElements };
