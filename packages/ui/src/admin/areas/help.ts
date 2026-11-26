/** The tile-import wizard as the admin loads it lazily, in a chunk of its own (`docs/research/M20-import-local.md` §19.11). */
import { defineTilesElements } from '../tiles/define.js';
import { HCM_TILES_PAGE_TAG } from '../tiles/hcm-tiles-page.js';
import type { AreaElements } from './area.js';

export const AREA_ELEMENTS: AreaElements = { tag: HCM_TILES_PAGE_TAG, define: defineTilesElements };
