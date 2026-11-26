/**
 * The georeferencer's lazy chunk (the admin's `georef-extras-<hash>.js`; `extras.ts` fetches it, DECISIONS-for-review.md §110): the map
 * a version publishes from its camera's lattice and, over terrain, through its RPC over its heights (M15, `terrainTransform` of
 * `@hcm/shared`), Snap my points (M16, `snap.ts`), which most versions never need, the linked views (`linked-views.ts`), fetched
 * once a fit exists, and the ghost of a pending pair (`ghost.ts`), fetched once a pair waits with two pairs or a fit, so the `georef` chunk keeps its budget.
 */
import { fitTransform, terrainTransform, type FittedTransform, type Gcp, type Georef } from '@hcm/shared';

import type { ContentServices } from '../content/services.js';
import type { OwnFit } from './fit-view.js';
import { roughPointsOf, snapped, type Snapped } from './snap.js';

export { ghostOf } from './ghost.js';
export { ViewLink } from './linked-views.js';

/** The map a lattice's nodes describe, as the warp renders it: a thin-plate spline through them. */
function latticeOf(lattice: NonNullable<Georef['lattice']>): FittedTransform | null {
    const nodes = lattice.nodes.map((node, index): Gcp => ({ id: String(index), ...node, enabled: true, origin: 'auto' }));
    const result = fitTransform('tps', nodes);
    return result.ok ? result.transform : null;
}

/** The map the version publishes: over terrain its RPC over its heights (from its lattice's map), else its lattice's; null: its pairs'. */
function mapOf({ lattice, terrain }: Pick<Georef, 'lattice' | 'terrain'>): FittedTransform | null {
    const nodes = lattice === undefined ? null : latticeOf(lattice);
    return terrain === undefined || nodes === null ? nodes : terrainTransform(terrain, nodes);
}

/** The version's own fit with the map it publishes made (`OwnFit.published`). */
export function publishedMap(own: OwnFit): OwnFit {
    return own.published === null ? own : { ...own, transform: mapOf(own.published), published: null };
}

/** Snap my points: the new manual pairs of `pairs` over `base` sent as rough points (`snap.ts`). */
export async function snapPoints(
    services: Pick<ContentServices, 'cityId' | 'callables' | 'notify'>,
    version: { readonly id: string } | null,
    pairs: readonly Gcp[],
    base: readonly Gcp[],
): Promise<Snapped> {
    return snapped(services, version, roughPointsOf(pairs, base));
}
