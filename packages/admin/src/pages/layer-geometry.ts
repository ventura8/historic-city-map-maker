/** The layer editor's Crop as one lazy chunk (`docs/research/M3-interfaces.md` §10.1, §10.5): its element and its tool. */
import { LAYER_GEOMETRY_ELEMENTS } from '@hcm/ui/admin/areas/layer-geometry';

import { createCropTool } from '../layers/geometry/crop-tool.js';
import type { CropToolFactory } from '../layers/geometry/types.js';

export const GEOMETRY: { readonly elements: { define(registry: CustomElementRegistry): void }; readonly crop: CropToolFactory } = {
    elements: LAYER_GEOMETRY_ELEMENTS,
    crop: createCropTool,
};
