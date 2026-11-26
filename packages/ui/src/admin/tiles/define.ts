/** Registers the tile-import wizard's page and what it renders (`docs/research/M20-import-local.md` §19.11); idempotent per registry. */
import { defineUiKit } from '../../components/define.js';
import { defineHcmTilesPage } from './hcm-tiles-page.js';
import { defineHcmSeamPair } from './seam-pair.js';
import { defineHcmTileGrid } from './tile-grid.js';
import { defineHcmTilePreview } from './tile-preview.js';

export function defineTilesElements(registry: CustomElementRegistry = customElements): void {
    defineUiKit(registry);
    defineHcmTileGrid(registry);
    defineHcmSeamPair(registry);
    defineHcmTilePreview(registry);
    defineHcmTilesPage(registry);
}
