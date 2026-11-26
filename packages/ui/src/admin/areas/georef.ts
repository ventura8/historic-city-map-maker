/** The georeferencer as the admin loads it lazily, in a chunk of its own (`docs/research/M3-interfaces.md` §10.1). */
import { defineGeorefElements } from '../georef/define.js';
import { HCM_GEOREF_PAGE_TAG } from '../georef/hcm-georef-page.js';
import type { AreaElements } from './area.js';

export const AREA_ELEMENTS: AreaElements = { tag: HCM_GEOREF_PAGE_TAG, define: defineGeorefElements };
