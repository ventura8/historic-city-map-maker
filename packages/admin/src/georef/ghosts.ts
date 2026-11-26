/**
 * The store's side of the ghost (`./ghost.ts`, in the lazy chunk): whenever the half pair or the pairs change, the pending pair's
 * expected other end is worked out and shown (the map's dashed ring, the scan's through the state), once the chunk is in. Without a
 * half pair, or with neither a fit nor two enabled pairs, there is none and nothing is fetched. A failed fetch leaves no ghost.
 */
import type { FittedTransform } from '@hcm/shared';

import type { ContentServices } from '../content/services.js';
import type { Store } from '../state/store.js';
import { chunkOf, type ExtrasLoader } from './extras.js';
import type { GeorefMap } from './georef-map.js';
import type { Ghost } from './ghost.js';
import type { GeorefState } from './state.js';

export interface GhostDeps {
    readonly services: Pick<ContentServices, 'cityId' | 'callables' | 'notify' | 'log'>;
    readonly extras: ExtrasLoader;
    readonly cell: Store<GeorefState>;
    readonly map: GeorefMap;
    /** The store's fit now (null: none). */
    readonly transform: () => FittedTransform | null;
}

/** A pair waits for its other end, and a fit or two enabled pairs can tell where. */
function wanted(deps: GhostDeps): boolean {
    const { half, pairs } = deps.cell.state;
    return half !== null && (deps.transform() !== null || pairs.filter((pair) => pair.enabled).length >= 2);
}

function shown(deps: GhostDeps, ghost: Ghost | null): void {
    deps.cell.update({ ghost });
    deps.map.setGhost(ghost !== null && 'geo' in ghost ? ghost.geo : null);
}

/** Shows the ghost of the state's half pair now (or takes it away). */
export async function showGhost(deps: GhostDeps): Promise<void> {
    const half = deps.cell.state.half;
    const chunk = wanted(deps) ? await chunkOf(deps.services, deps.extras) : null;
    // A later click or edit may have come while the chunk loaded: only the state's own half pair is shown.
    if (deps.cell.state.half === half) {
        shown(deps, chunk?.ghostOf(half, deps.cell.state.pairs, deps.transform()) ?? null);
    }
}
