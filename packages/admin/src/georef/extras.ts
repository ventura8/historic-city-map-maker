/**
 * The georeferencer's lazy part (DECISIONS-for-review.md §110): the map a camera's lattice or a frame over terrain publishes (M15) and
 * Snap my points (M16) are the chunk `georef-extras.ts`, fetched (one dynamic `import()`, so the bundler splits it) the first time such
 * a version opens or Snap is pressed. A failed fetch (offline, or a deploy replaced the chunk) says so in words and leaves the page
 * working: the figures stay the version's, the preview is its pairs' fit, Snap sends nothing; the next need fetches it again.
 */
import type { Gcp } from '@hcm/shared';

import type { ContentServices } from '../content/services.js';
import type { OwnFit } from './fit-view.js';
import type { ghostOf, publishedMap, snapPoints, ViewLink } from './georef-extras.js';
import type { Snapped } from './snap.js';

/** What the chunk gives the georeferencer. */
interface GeorefExtrasChunk {
    readonly publishedMap: typeof publishedMap;
    readonly snapPoints: typeof snapPoints;
    readonly ViewLink: typeof ViewLink;
    readonly ghostOf: typeof ghostOf;
}

export type ExtrasLoader = () => Promise<GeorefExtrasChunk>;

/** The chunk's one dynamic `import()`. */
export const loadGeorefExtras: ExtrasLoader = async () => import('./georef-extras.js');

type Services = Pick<ContentServices, 'cityId' | 'callables' | 'notify' | 'log'>;

/** The chunk, or null when its fetch failed (logged; `notice`, when given, in the snackbar). */
export async function chunkOf(
    services: Services,
    load: ExtrasLoader,
    notice?: 'adminContent.georef.mapUnavailable',
): Promise<GeorefExtrasChunk | null> {
    try {
        return await load();
    } catch (error) {
        services.log.warn('georef chunk', { error: String(error) });
        if (notice !== undefined) {
            services.notify({ key: notice });
        }
        return null;
    }
}

/** The version's own fit with the map it publishes, once the chunk is in; `own` itself without one, or after a failed fetch (said in words). */
export async function publishedOf(services: Services, load: ExtrasLoader, own: OwnFit | null): Promise<OwnFit | null> {
    if (!own?.published) {
        return own;
    }
    const chunk = await chunkOf(services, load, 'adminContent.georef.mapUnavailable');
    return chunk === null ? own : chunk.publishedMap(own);
}

/** What Snap sends from: the version, the page's pairs and the version's own (the new manual pairs are the difference). */
export interface SnapInput {
    readonly version: { readonly id: string } | null;
    readonly pairs: readonly Gcp[];
    readonly base: readonly Gcp[];
}

/** Snap my points (`snap.ts`); without the chunk nothing is sent and the page says why. */
export async function snapOf(services: Services, load: ExtrasLoader, { version, pairs, base }: SnapInput): Promise<Snapped> {
    const chunk = await chunkOf(services, load);
    return chunk === null
        ? { saved: null, refusal: { key: 'adminContent.georef.snapUnavailable' } }
        : chunk.snapPoints(services, version, pairs, base);
}
