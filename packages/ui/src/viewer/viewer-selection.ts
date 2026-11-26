/**
 * What the detail sheet shows: the selected photo, or the selected place with its category. M31
 * (`docs/research/M31-wikipedia.md` §4): the place may be a Wikipedia article (`wikipedia-<id>`), shown as a place of the
 * overlay's category in the visitor's language, with its free thumbnail (a file of the city's public bucket, relative to
 * the manifest).
 */
import {
    wikipediaArticleOf,
    wikipediaPoi,
    type Manifest,
    type Photo,
    type Poi,
    type PoiCategory,
    type WikipediaArticle,
} from '@hcm/shared';

import type { ViewerState } from './store-port.js';

export interface Selection {
    readonly photo: Photo | null;
    readonly poi: Poi | null;
    readonly category: PoiCategory | null;
    /** M31: the article's thumbnail path, relative to the manifest; null otherwise. */
    readonly thumbnail: string | null;
}

type SelectionState = Pick<ViewerState, 'sheet' | 'selectedPoiId' | 'selectedPhotoId' | 'locale' | 'wikipedia'>;

function categoryOf(manifest: Manifest, poi: Poi | null): PoiCategory | null {
    return poi === null ? null : ((manifest.poiCategories ?? []).find((candidate) => candidate.id === poi.category) ?? null);
}

function ownPlace(manifest: Manifest, poiId: string | null): Poi | undefined {
    return (manifest.pois ?? []).find((candidate) => candidate.id === poiId);
}

/** The article behind the selected place, when it is one of the Wikipedia overlay's. */
function articleOf(state: SelectionState): WikipediaArticle | undefined {
    return wikipediaArticleOf(state.wikipedia?.articles ?? [], state.selectedPoiId);
}

/** The place the sheet shows: one of the city's own, else an article of the Wikipedia overlay. */
function placeOf(state: SelectionState, manifest: Manifest): { readonly poi: Poi | null; readonly thumbnail: string | null } {
    const own = ownPlace(manifest, state.selectedPoiId);
    const article = own === undefined ? articleOf(state) : undefined;
    if (article !== undefined) {
        return { poi: wikipediaPoi(article, state.locale), thumbnail: article.thumb ?? null };
    }
    return { poi: own ?? null, thumbnail: null };
}

export function selectionOf(state: SelectionState, manifest: Manifest): Selection {
    const { poi, thumbnail } = state.sheet === 'poi' ? placeOf(state, manifest) : { poi: null, thumbnail: null };
    const photo = manifest.photos.find((candidate) => candidate.id === state.selectedPhotoId) ?? null;
    return { photo, poi, category: categoryOf(manifest, poi), thumbnail };
}
