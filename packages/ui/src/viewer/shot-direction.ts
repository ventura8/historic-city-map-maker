/**
 * The shot direction button (V93, the owner 2026-11-23): a satellite or aerial layer may say which way its camera looked
 * (`shotDirection`, degrees clockwise from north). While that layer is the one on top, a round button under Show my
 * location turns the map to it, so the view matches the image. The layer on top is the engine's (`stack.ts`
 * `frontLayerId`): the chosen front while visible, else the last visible layer of the timeline's year.
 */
import type { Layer, Manifest } from '@hcm/shared';

import type { ViewerState } from './store-port.js';

type StackState = Pick<ViewerState, 'year' | 'front' | 'overlays'>;

function frontLayer(layers: readonly Layer[], state: StackState): Layer | undefined {
    const visible = new Set(state.overlays.filter((overlay) => overlay.kind === 'raster' && overlay.visible).map((overlay) => overlay.id));
    const chosen = state.front === null || !visible.has(state.front) ? undefined : layers.find((layer) => layer.id === state.front);
    return chosen ?? layers.findLast((layer) => layer.year === state.year && visible.has(layer.id));
}

/** The shot direction of the layer on top, when it is a satellite or aerial image that has one; else null. */
export function frontShotDirection(manifest: Manifest | null, state: StackState): number | null {
    const layer = manifest === null ? undefined : frontLayer(manifest.layers, state);
    return layer === undefined || layer.kind === 'map' ? null : (layer.shotDirection ?? null);
}
