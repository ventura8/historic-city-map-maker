/**
 * The places list's pure parts (docs/research/M2c-interfaces.md §7.1): its query (one indexed filter: a category, else
 * Unpublished), what the filter shows of a loaded page (Unpublished within a category, the title search), the map's
 * overlays of the shown places and of an import's preview, the photos the picker offers, and every place read once.
 */
import { DEFAULT_POI_ICON, FIRESTORE_PATHS, isHttpsUrl, MAX_POIS, poiDocSchema, type AdminContentKey, type PhotoDoc } from '@hcm/shared';
import type { VectorOverlaySpec } from '@hcm/ui/map';

import { readOnce } from '../content/read-once.js';
import type { ContentQuery, ContentServices, Stored, WriteOutcome } from '../content/services.js';
import type { PlaceEditorState } from './editor.js';
import type { ImportState } from './importer.js';
import { overlayOf, UNCATEGORISED_COLOR } from './map-session.js';
import { exportFileName, exportText, GEOJSON_MEDIA_TYPE } from './geojson.js';
import { poiItemOf, textIn, textOf, type CategoryItem, type PoiItem, type PoiValue } from './model.js';

export interface PoisFilter {
    /** One category, or every one. */
    readonly category: string | null;
    readonly unpublished: boolean;
    /** Filters the loaded page by title. */
    readonly search: string;
}

/** A photo the picker offers (its thumbnail only when it is an https address). */
export interface PhotoChoice {
    readonly id: string;
    readonly title: { readonly ro: string; readonly en?: string };
    readonly year: number | null;
    readonly thumb: string | null;
}

/** The list's query: newest first, one indexed filter (a category, else Unpublished). */
export function poisQuery(filter: PoisFilter, ownerOnly: string | null = null): ContentQuery {
    // M13 §1: an uploader reads their own places only, and the rules read the query: it must ask for exactly those.
    if (ownerOnly !== null) {
        return { where: [['createdBy', '==', ownerOnly]], orderBy: [['updatedAt', 'desc']] };
    }
    if (filter.category !== null) {
        return { where: [['category', '==', filter.category]], orderBy: [['updatedAt', 'desc']] };
    }
    return { where: filter.unpublished ? [['published', '==', false]] : [], orderBy: [['updatedAt', 'desc']] };
}

function matches(item: PoiItem, search: string): boolean {
    return search === '' || `${item.title.ro} ${item.title.en ?? ''}`.toLocaleLowerCase('ro').includes(search);
}

/** The places of a page that the filter shows (Unpublished within a category, and the search, apply here). */
export function shownPlaces(items: readonly PoiItem[], filter: PoisFilter): readonly PoiItem[] {
    const search = filter.search.trim().toLocaleLowerCase('ro');
    return items.filter((item) => (!filter.unpublished || !item.published) && matches(item, search));
}

export function photoChoiceOf(doc: Stored<PhotoDoc>): PhotoChoice {
    const thumb = doc.data.image?.thumb ?? '';
    return { id: doc.id, title: textOf(doc.data.title), year: doc.data.year ?? null, thumb: isHttpsUrl(thumb) ? thumb : null };
}

/** One overlay per category with the places it shows, titles in the admin's language. */
export function placeOverlays(categories: readonly CategoryItem[], places: readonly PoiItem[], locale: 'ro' | 'en'): VectorOverlaySpec[] {
    return categories.map((category) =>
        overlayOf(
            category,
            places
                .filter((place) => place.category === category.id)
                .map((place) => ({ id: place.id, geometry: place.geometry, title: textIn(place.title, locale) })),
        ),
    );
}

/** The import's planned places on the map, in one neutral overlay that clicks pass through. */
export function importOverlays(importing: ImportState | null): VectorOverlaySpec[] {
    const plan = importing?.status === 'preview' ? importing.plan : null;
    if (plan === null) {
        return [];
    }
    const places = [...plan.created, ...plan.updated].flatMap((place) =>
        place.value.geometry === null
            ? []
            : [{ id: `hcm-import-${String(place.number)}`, geometry: place.value.geometry, title: place.value.title.ro }],
    );
    return [
        {
            ...overlayOf({ id: 'hcm-import', color: UNCATEGORISED_COLOR, icon: DEFAULT_POI_ICON, defaultOpacity: 1 }, places),
            clickable: false,
        },
    ];
}

export function notFound(id: string): PlaceEditorState {
    return {
        id,
        status: 'not-found',
        failure: null,
        reconnecting: false,
        draft: null,
        shape: 'point',
        sketch: [],
        vertex: null,
        refusal: null,
    };
}

export type WriteFailure = Exclude<WriteOutcome, { readonly ok: true }>['reason'];

/** The snackbar's text for a write the store refused. */
export const WRITE_FAILURES: Readonly<Record<WriteFailure, AdminContentKey>> = {
    conflict: 'adminContent.pois.conflict',
    gone: 'adminContent.pois.gone',
    denied: 'adminContent.pois.denied',
    offline: 'adminContent.pois.offline',
    invalid: 'adminContent.pois.invalid',
};

/** A new place's first value: in `category`, without a shape or a title yet, published (Save publishes it). */
export function newPlaceValue(category: string): PoiValue {
    return { category, geometry: null, title: { ro: '' }, links: [], photoIds: [], published: true };
}

/** The category a new place starts in: the last one saved while the city still has it, else the first, else none. */
export function newPlaceCategory(categories: readonly CategoryItem[], remembered: string | null): string {
    return categories.find((item) => item.id === remembered)?.id ?? categories[0]?.id ?? '';
}

/** Whether the open draft is a new place still without a category (added before the categories were listed). */
export function lacksCategory(draft: PlaceEditorState['draft'] | undefined): boolean {
    return draft?.isNew === true && draft.value.category === '';
}

/** Every place of the city that reads, and the ids of those whose document fails its schema (never shown as data). */
export interface EveryPlace {
    readonly places: readonly PoiItem[];
    readonly unreadable: readonly string[];
}

/**
 * Every place of the city, whatever the list loaded or filters (Export all, an import's plan); null when the read failed
 * (refused: the shell asks who this is again).
 */
export async function everyPlace(services: Pick<ContentServices, 'store' | 'clock' | 'cityId' | 'denied'>): Promise<EveryPlace | null> {
    const { page, failure } = await readOnce(services, FIRESTORE_PATHS.pois(services.cityId), poiDocSchema, { limit: MAX_POIS });
    if (page === null) {
        if (failure === 'denied') {
            services.denied();
        }
        return null;
    }
    return { places: page.docs.map(poiItemOf), unreadable: page.invalid.map((doc) => doc.path.slice(doc.path.lastIndexOf('/') + 1)) };
}

/** The GeoJSON file of `places` of the city (the whole city's export, or its selection's). */
export function exportFile(
    cityId: string,
    now: number,
    places: readonly PoiItem[],
    categories: readonly CategoryItem[],
): { readonly name: string; readonly type: string; readonly text: string } {
    const chosen = places.map((item) => ({ id: item.id, value: item.value }));
    return { name: exportFileName(cityId, new Date(now)), type: GEOJSON_MEDIA_TYPE, text: exportText(cityId, chosen, categories) };
}
