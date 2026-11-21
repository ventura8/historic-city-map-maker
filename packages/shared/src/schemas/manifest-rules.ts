/**
 * The manifest rules that span more than one value: unique ids, one overlay namespace, places inside the city and
 * POI references that resolve. `manifestSchema` runs them after every field has passed its own schema; each rule
 * returns `{path, code}` pairs whose code is a `validation.*` i18n key, like every other validation issue.
 *
 * The input types are structural (not `Manifest`), so this module and `manifest.ts` do not import each other.
 */
import { bboxContains, bboxExpand, type BBox } from '../geo/bbox.js';
import type { LngLat } from '../geo/math.js';
import { geometryPositions, type Geometry } from './geometry.js';
import { PHOTOS_OVERLAY_ID, type ValidationCode } from './primitives.js';

/** A photo may stand this many degrees outside the city bounds (taken from outside, looking in); so may a POI vertex. */
export const PHOTO_LOCATION_SLACK_DEG = 0.5;

export interface RuleIssue {
    readonly path: readonly (string | number)[];
    readonly code: ValidationCode;
}

interface Identified {
    readonly id: string;
}

export interface CheckedManifest {
    readonly city: { readonly bounds: BBox };
    readonly layers: readonly Identified[];
    readonly photos: readonly (Identified & { readonly location: { readonly lat: number; readonly lng: number } })[];
    readonly unplaced?: readonly Identified[] | undefined;
    readonly poiCategories?: readonly Identified[] | undefined;
    readonly pois?:
        | readonly (Identified & {
              readonly category: string;
              readonly geometry: Geometry;
              readonly photoIds?: readonly string[] | undefined;
              readonly sourceLayer?: string | undefined;
          })[]
        | undefined;
    readonly stories?:
        | readonly (Identified & { readonly photoIds?: readonly string[] | undefined; readonly poiIds?: readonly string[] | undefined })[]
        | undefined;
}

type ListKey = 'layers' | 'photos' | 'unplaced' | 'poiCategories' | 'pois' | 'stories';

function duplicates(key: ListKey, items: readonly Identified[]): RuleIssue[] {
    const seen = new Set<string>();
    return items.flatMap((item, index) => {
        const duplicate = seen.has(item.id);
        seen.add(item.id);
        return duplicate ? [{ path: [key, index, 'id'], code: 'validation.duplicateId' }] : [];
    });
}

/** Overlay ids are the layer ids, `photos` and the POI category ids (`&op=` in the URL hash): one namespace. */
function overlayClashes(manifest: CheckedManifest): RuleIssue[] {
    const layerIds = new Set(manifest.layers.map((layer) => layer.id));
    const clash = (key: ListKey, taken: (id: string) => boolean) => (item: Identified, index: number) =>
        taken(item.id) ? [{ path: [key, index, 'id'], code: 'validation.duplicateId' as const }] : [];
    return [
        ...manifest.layers.flatMap(clash('layers', (id) => id === PHOTOS_OVERLAY_ID)),
        ...(manifest.poiCategories ?? []).flatMap(clash('poiCategories', (id) => id === PHOTOS_OVERLAY_ID || layerIds.has(id))),
    ];
}

function cityArea(manifest: CheckedManifest): BBox {
    return bboxExpand(manifest.city.bounds, PHOTO_LOCATION_SLACK_DEG);
}

function photoPlaces(manifest: CheckedManifest): RuleIssue[] {
    const area = cityArea(manifest);
    return manifest.photos.flatMap((photo, index) => {
        const position: LngLat = [photo.location.lng, photo.location.lat];
        return bboxContains(area, position) ? [] : [{ path: ['photos', index, 'location'], code: 'validation.outsideCity' }];
    });
}

function poiPlaces(manifest: CheckedManifest): RuleIssue[] {
    const area = cityArea(manifest);
    return (manifest.pois ?? []).flatMap((poi, index) =>
        geometryPositions(poi.geometry).every((position) => bboxContains(area, position))
            ? []
            : [{ path: ['pois', index, 'geometry'], code: 'validation.outsideCity' }],
    );
}

/** A POI's category, photos and (M27) source layer must exist in the same manifest. */
function poiReferences(manifest: CheckedManifest): RuleIssue[] {
    const categories = new Set((manifest.poiCategories ?? []).map((category) => category.id));
    const photos = new Set(manifest.photos.map((photo) => photo.id));
    const layers = new Set(manifest.layers.map((layer) => layer.id));
    const layerMissing = (layer: string | undefined): boolean => layer !== undefined && !layers.has(layer);
    return (manifest.pois ?? []).flatMap((poi, index): RuleIssue[] => [
        ...(categories.has(poi.category) ? [] : [{ path: ['pois', index, 'category'], code: 'validation.reference' } as const]),
        ...(layerMissing(poi.sourceLayer) ? [{ path: ['pois', index, 'sourceLayer'], code: 'validation.reference' } as const] : []),
        ...(poi.photoIds ?? []).flatMap((photoId, photoIndex) =>
            photos.has(photoId) ? [] : [{ path: ['pois', index, 'photoIds', photoIndex], code: 'validation.reference' } as const],
        ),
    ]);
}

/** M17 §4: a story's photos (placed or not) and places must exist in the same manifest; its figures are not checked. */
function storyReferences(manifest: CheckedManifest): RuleIssue[] {
    const photos = new Set([...manifest.photos, ...(manifest.unplaced ?? [])].map((photo) => photo.id));
    const pois = new Set((manifest.pois ?? []).map((poi) => poi.id));
    const missing = (index: number, key: 'photoIds' | 'poiIds', known: ReadonlySet<string>, ids: readonly string[] = []) =>
        ids.flatMap((id, at) => (known.has(id) ? [] : [{ path: ['stories', index, key, at], code: 'validation.reference' } as const]));
    return (manifest.stories ?? []).flatMap((story, index) => [
        ...missing(index, 'photoIds', photos, story.photoIds),
        ...missing(index, 'poiIds', pois, story.poiIds),
    ]);
}

function unplacedClashes(manifest: CheckedManifest): RuleIssue[] {
    const placed = new Set(manifest.photos.map((photo) => photo.id));
    return [
        ...duplicates('unplaced', manifest.unplaced ?? []),
        ...(manifest.unplaced ?? []).flatMap((photo, index) =>
            placed.has(photo.id) ? [{ path: ['unplaced', index, 'id'], code: 'validation.duplicateId' as const }] : [],
        ),
    ];
}

/** Every cross-value problem of a manifest whose fields are individually valid, in a stable order. */
export function manifestRuleIssues(manifest: CheckedManifest): RuleIssue[] {
    return [
        ...duplicates('layers', manifest.layers),
        ...duplicates('photos', manifest.photos),
        // M13: a photo's address is its id, so a photo is placed or unplaced, never both.
        ...unplacedClashes(manifest),
        ...duplicates('poiCategories', manifest.poiCategories ?? []),
        ...duplicates('pois', manifest.pois ?? []),
        ...overlayClashes(manifest),
        ...photoPlaces(manifest),
        ...poiPlaces(manifest),
        ...poiReferences(manifest),
        ...duplicates('stories', manifest.stories ?? []),
        ...storyReferences(manifest),
    ];
}
