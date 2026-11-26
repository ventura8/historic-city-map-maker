/** The Imagery page as the admin loads it lazily, in a chunk of its own (`docs/research/M3-interfaces.md` §10.1). */
import { defineImageryElements } from '../imagery/define.js';
import { HCM_IMAGERY_PAGE_TAG } from '../imagery/hcm-imagery-page.js';
import type { AreaElements } from './area.js';

export const AREA_ELEMENTS: AreaElements = { tag: HCM_IMAGERY_PAGE_TAG, define: defineImageryElements };
