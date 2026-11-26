/**
 * The city's places as a photo's or a map layer's place picker offers them (`placeIds`, `docs/research/M17-stories.md`
 * §12): every place read once, sorted by Romanian title; an uploader reads their own only, as the rules ask.
 */
import { FIRESTORE_PATHS, MAX_POIS, poiDocSchema } from '@hcm/shared';

import { readOnce } from './read-once.js';
import { ownerOnlyOf, type ContentServices } from './services.js';

export interface PlacePick {
    readonly id: string;
    readonly title: { readonly ro: string; readonly en?: string | undefined };
}

/** The city's places, or null when the read gave no answer (the picker then stays off). */
export async function readPlacePicks(
    services: Pick<ContentServices, 'store' | 'clock' | 'cityId' | 'cityRole' | 'user'>,
): Promise<readonly PlacePick[] | null> {
    const ownerOnly = ownerOnlyOf(services);
    const query = ownerOnly === null ? { limit: MAX_POIS } : { where: [['createdBy', '==', ownerOnly]] as const, limit: MAX_POIS };
    const answer = await readOnce(services, FIRESTORE_PATHS.pois(services.cityId), poiDocSchema, query);
    if (answer.page === null) {
        return null;
    }
    return answer.page.docs
        .map((stored) => ({ id: stored.id, title: stored.data.title }))
        .toSorted((a, b) => a.title.ro.localeCompare(b.title.ro, 'ro'));
}
