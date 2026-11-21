/**
 * The `layers.*` functions (layers-settings, `docs/research/M2c-interfaces.md` §8.1, §8.4): `layers.delete` removes a
 * layer and queues the deletion of its tileset after the grace period, `layers.link` adds a layer over a tileset or tile
 * server that already exists. `functions/src/index.ts` exports `layers = layersFunctions(getDeps)`, which deploys
 * `layers-delete` and `layers-link`.
 */
import type { CallableDeps } from '../api/callable.js';
import { layerDeleteFunction, type LayerDeleteDeps } from './delete.js';
import { layerLinkFunction, type LayerLinkDeps } from './link.js';

export type LayersFamilyDeps = CallableDeps & LayerDeleteDeps & LayerLinkDeps;

export function layersFunctions(getDeps: () => LayersFamilyDeps) {
    return { delete: layerDeleteFunction(getDeps), link: layerLinkFunction(getDeps) };
}
