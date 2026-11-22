/**
 * A place's media (`docs/research/M17-stories.md` §12, the owner 2026-11-22): what the place's sheet lists under Media,
 * sorted by kind. `maps` are the small-area map layers that name the place in `placeIds` (the 1906 exhibition plan of
 * Parcul Carol); `aerial`, `ground` and `interior` are photos of that kind. A photo is the place's when the place lists it
 * in `photoIds` (in that order, which the place editor sets) or when the photo names the place in `placeIds` (after them,
 * by year, then id). Unknown ids are skipped; nothing here reads more than the manifest.
 */
import { photoKindOf, type Layer, type Photo, type PhotoKind, type Poi, type UnplacedPhoto } from '../schemas/manifest.js';

export const PLACE_MEDIA_KINDS = ['maps', 'aerial', 'ground', 'interior'] as const;
export type PlaceMediaKind = (typeof PLACE_MEDIA_KINDS)[number];

export interface PlaceMedia {
    readonly maps: readonly Layer[];
    readonly aerial: readonly (Photo | UnplacedPhoto)[];
    readonly ground: readonly (Photo | UnplacedPhoto)[];
    readonly interior: readonly (Photo | UnplacedPhoto)[];
}

interface MediaSource {
    readonly layers: readonly Layer[];
    readonly photos: readonly (Photo | UnplacedPhoto)[];
}

const names = (item: { readonly placeIds?: readonly string[] | undefined }, placeId: string): boolean =>
    item.placeIds?.includes(placeId) === true;

function byYear(a: { readonly id: string; readonly year?: number | undefined }, b: typeof a): number {
    return (a.year ?? Number.MAX_SAFE_INTEGER) - (b.year ?? Number.MAX_SAFE_INTEGER) || a.id.localeCompare(b.id);
}

/** The photos of `poi`: its own `photoIds` first, in order, then the photos naming it, each once. */
function placePhotos(poi: Pick<Poi, 'id' | 'photoIds'>, photos: MediaSource['photos']): (Photo | UnplacedPhoto)[] {
    const byId = new Map(photos.map((photo) => [photo.id, photo]));
    const listed = (poi.photoIds ?? []).flatMap((id) => byId.get(id) ?? []);
    const seen = new Set(listed.map((photo) => photo.id));
    const naming = photos.filter((photo) => !seen.has(photo.id) && names(photo, poi.id)).toSorted(byYear);
    return [...listed, ...naming];
}

/** The media of `poi` in `source`, by kind; every list may be empty. */
export function placeMedia(poi: Pick<Poi, 'id' | 'photoIds'>, source: MediaSource): PlaceMedia {
    const photos = placePhotos(poi, source.photos);
    const ofKind = (kind: PhotoKind) => photos.filter((photo) => photoKindOf(photo) === kind);
    return {
        maps: source.layers.filter((layer) => names(layer, poi.id)).toSorted(byYear),
        aerial: ofKind('aerial'),
        ground: ofKind('ground'),
        interior: ofKind('interior'),
    };
}

/** The kinds that have at least one item, in the sheet's order. */
export function placeMediaKinds(media: PlaceMedia): PlaceMediaKind[] {
    return PLACE_MEDIA_KINDS.filter((kind) => media[kind].length > 0);
}
