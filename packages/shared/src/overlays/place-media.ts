/**
 * A place's media (`docs/research/M17-stories.md` §12, the owner 2026-11-22): what the place's sheet lists under Media,
 * sorted by kind. `maps` are the small-area map layers that name the place in `placeIds` (the 1906 exhibition plan of
 * Parcul Carol); `aerial`, `ground` and `interior` are photos of that kind. A photo is the place's when the place lists it
 * in `photoIds` (in that order, which the place editor sets) or when the photo names the place in `placeIds` (after them,
 * by year, then id). Unknown ids are skipped; nothing here reads more than the manifest.
 */
import { photoKindOf, type Layer, type Photo, type PhotoKind, type UnplacedPhoto } from '../schemas/manifest.js';
import type { Poi } from '../schemas/poi.js';

export { MAX_MEDIA_PLACES } from '../schemas/poi.js';

export const PLACE_MEDIA_KINDS = ['maps', 'plans', 'aerial', 'ground', 'interior'] as const;
export type PlaceMediaKind = (typeof PLACE_MEDIA_KINDS)[number];

/** M17 §14: one level of a building's plans, its plan layers and the interior photos taken on it. */
export interface PlanLevel {
    readonly order: number;
    readonly label: { readonly ro: string; readonly en?: string | undefined };
    readonly layers: readonly Layer[];
    readonly photos: readonly (Photo | UnplacedPhoto)[];
}

export interface PlaceMedia {
    /** Maps of the place without a level (plans of the area, the 1906 exhibition plan). */
    readonly maps: readonly Layer[];
    /** M17 §14: the building's plans by level, lowest first. */
    readonly plans: readonly PlanLevel[];
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

/** The leveled layers grouped by level (the first label of an order names it), each with the interior photos on it. */
function planLevels(layers: readonly Layer[], interior: readonly (Photo | UnplacedPhoto)[]): PlanLevel[] {
    const levels = new Map<number, PlanLevel>();
    for (const layer of layers) {
        const level = layer.level;
        if (level !== undefined) {
            const known = levels.get(level.order);
            const plans = known === undefined ? [layer] : [...known.layers, layer];
            levels.set(level.order, { order: level.order, label: known?.label ?? level.label, layers: plans, photos: [] });
        }
    }
    return [...levels.values()]
        .map((level) => ({ ...level, photos: interior.filter((photo) => photo.level === level.order) }))
        .toSorted((a, b) => a.order - b.order);
}

/** The media of `poi` in `source`, by kind; every list may be empty. */
export function placeMedia(poi: Pick<Poi, 'id' | 'photoIds'>, source: MediaSource): PlaceMedia {
    const photos = placePhotos(poi, source.photos);
    const ofKind = (kind: PhotoKind) => photos.filter((photo) => photoKindOf(photo) === kind);
    const layers = source.layers.filter((layer) => names(layer, poi.id)).toSorted(byYear);
    return {
        maps: layers.filter((layer) => layer.level === undefined),
        plans: planLevels(layers, ofKind('interior')),
        aerial: ofKind('aerial'),
        ground: ofKind('ground'),
        interior: ofKind('interior'),
    };
}

/** The kinds that have at least one item, in the sheet's order. */
export function placeMediaKinds(media: PlaceMedia): PlaceMediaKind[] {
    return PLACE_MEDIA_KINDS.filter((kind) => media[kind].length > 0);
}
