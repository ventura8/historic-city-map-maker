/**
 * What the places area's live reads share (docs/research/M2c-interfaces.md §7): the store, the clock and the denied
 * notice of its services, and a live list of one of the city's collections built from them.
 */
import { LiveList, type ListState, type LiveListDeps } from '../content/list.js';
import type { ContentServices } from '../content/services.js';

export type LiveParts = Pick<ContentServices, 'store' | 'clock'> & { readonly denied: () => void };

export function livePartsOf(services: ContentServices): LiveParts {
    const { store, clock } = services;
    return {
        store,
        clock,
        denied: () => {
            services.denied();
        },
    };
}

/** A live list of `collection`, its documents read with `schema` and shown as `map` makes them. */
export function liveListOf<Doc, Item>(
    services: ContentServices,
    collection: string,
    parts: Pick<LiveListDeps<Doc, Item>, 'schema' | 'map'>,
    changed: (list: ListState<Item>) => void,
): LiveList<Doc, Item> {
    return new LiveList<Doc, Item>({ ...livePartsOf(services), collection, ...parts, changed });
}
