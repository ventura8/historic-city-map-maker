/**
 * The loader of the layer editor's Crop chunk (`layer-geometry`, `docs/research/M3-interfaces.md` §10.1): imports it on
 * the first Crop (one dynamic `import()`, so the bundler splits it), registers its element and hands over the tool.
 */
import type { CropToolFactory } from './geometry/types.js';

export function cropChunkLoader(registry: () => CustomElementRegistry): () => Promise<CropToolFactory> {
    return async () => {
        const { GEOMETRY } = await import('../pages/layer-geometry.js');
        GEOMETRY.elements.define(registry());
        return GEOMETRY.crop;
    };
}
