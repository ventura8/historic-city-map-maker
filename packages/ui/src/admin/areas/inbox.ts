/** The inbox page as the admin loads it lazily, in a chunk of its own (`docs/research/M4-interfaces.md` §5.5): its tag and definer. */
import { defineHcmInboxPage, HCM_INBOX_PAGE_TAG } from '../inbox/hcm-inbox-page.js';
import type { AreaElements } from './area.js';

export const AREA_ELEMENTS: AreaElements = { tag: HCM_INBOX_PAGE_TAG, define: defineHcmInboxPage };
