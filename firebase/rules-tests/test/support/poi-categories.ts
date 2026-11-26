/** POI categories for the rules tests: the server's complete document, a client's new one, and the editor's update (with M27's fields). */
import { past, serverTime, stampedBy, systemStamp, type Data } from './world.js';

/** A category with every field its schema has. */
export function poiCategoryDoc(): Data {
    return {
        label: { ro: 'Clădiri', en: 'Buildings' },
        icon: 'church',
        color: '#875329',
        defaultOpacity: 0.8,
        order: 1,
        defaultVisible: true,
        pinned: false,
        attribution: 'Data © OpenStreetMap contributors, ODbL 1.0.',
        createdAt: past(),
        ...systemStamp('bootstrap'),
    };
}

/** A client's new category, exactly `CLIENT_WRITES.poiCategory.create`. */
export function newPoiCategory(uid: string): Data {
    return {
        label: { ro: 'Străzi dispărute' },
        icon: 'add_road',
        color: '#3366AA',
        defaultOpacity: 1,
        order: 2,
        defaultVisible: true,
        pinned: true,
        attribution: 'Data © OpenStreetMap contributors, ODbL 1.0.',
        createdAt: serverTime(),
        ...stampedBy(uid),
    };
}
/** Every field of `CLIENT_WRITES.poiCategory.update` (`EDITS.poiCategory`). */
export const POI_CATEGORY_EDITS: Readonly<Data> = {
    label: { ro: 'Biserici', en: 'Churches' },
    icon: 'mosque',
    color: '#aa00ff',
    defaultOpacity: 0,
    order: -1,
    defaultVisible: false,
    pinned: true,
    attribution: 'Our own scans.',
};
