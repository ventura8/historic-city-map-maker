/** The layer editor's Crop element, loaded lazily with its tool in the `layer-geometry` chunk (`docs/research/M3-interfaces.md` §10.1). */
import { defineHcmLayerCrop, HCM_LAYER_CROP_TAG } from '../layers/geometry/hcm-layer-crop.js';
import type { AreaElements } from './area.js';

export const LAYER_GEOMETRY_ELEMENTS: AreaElements = { tag: HCM_LAYER_CROP_TAG, define: defineHcmLayerCrop };
