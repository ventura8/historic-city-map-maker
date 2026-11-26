/**
 * The city's area (`docs/research/M2c-interfaces.md` §8.5, section `area`; behaviour A19): the bounds (a rectangle
 * drawn on the map, or four number fields), the start view (centre and zoom; **Use this view** takes the map's current
 * one) and the zoom limits. A rectangle without width or height is refused by the schema (`validation.bounds`,
 * S-A19-BAD-ZERO-AREA-BOUNDS); bounds that would leave a photo or a place beyond the bounds plus 0.5° are refused with
 * the list of them (S-A19-BAD-BOUNDS-EXCLUDE-CONTENT), since the manifest would drop them.
 */
import {
    bboxContains,
    bboxExpand,
    bboxFromRecord,
    geometryFromDoc,
    geometryPositions,
    PHOTO_LOCATION_SLACK_DEG,
    roundTo,
    type BoundsRecord,
    type CityDoc,
    type LngLat,
    type MapView,
    type PhotoDoc,
    type PoiDoc,
    type ValidationIssue,
} from '@hcm/shared';

/** The fields of the area section. */
export const AREA_FIELDS = ['bounds', 'center', 'zoom', 'minZoom', 'maxZoom'] as const satisfies readonly (keyof CityDoc)[];

/** Coordinates are kept to 7 decimals (about 1 cm), so a round trip through the map never shows a change that is none. */
const DECIMALS = 7;

/** Zoom levels are kept to two decimals. */
const ZOOM_DECIMALS = 2;

export function roundedBounds(bounds: BoundsRecord): BoundsRecord {
    return {
        west: roundTo(bounds.west, DECIMALS),
        south: roundTo(bounds.south, DECIMALS),
        east: roundTo(bounds.east, DECIMALS),
        north: roundTo(bounds.north, DECIMALS),
    };
}

/** **Use this view**: the map's centre and zoom as the city's start view. */
export function viewFields(view: Pick<MapView, 'center' | 'zoom'>): Pick<CityDoc, 'center' | 'zoom'> {
    return {
        center: { lat: roundTo(view.center[1], DECIMALS), lng: roundTo(view.center[0], DECIMALS) },
        zoom: roundTo(view.zoom, ZOOM_DECIMALS),
    };
}

/** The zoom limits hold the start zoom (absent limits are the map's own, 0 and 24). */
function zoomInOrder(city: CityDoc): boolean {
    const minZoom = city.minZoom ?? 0;
    const maxZoom = city.maxZoom ?? 24;
    const zoom = city.zoom ?? minZoom;
    return minZoom <= zoom && zoom <= maxZoom;
}

/** The start centre lies inside valid bounds (invalid bounds are the schema's issue, not this one). */
function centerInside(city: CityDoc): boolean {
    const { center, bounds } = city;
    return center === undefined || bounds.west >= bounds.east || bboxContains(bboxFromRecord(bounds), [center.lng, center.lat]);
}

/** The checks across the area's fields the schema cannot make: the zoom order and the centre inside the bounds. */
export function areaIssues(city: CityDoc): ValidationIssue[] {
    return [
        ...(zoomInOrder(city) ? [] : [{ path: 'zoom', code: 'validation.zoomRange' } as const]),
        ...(centerInside(city) ? [] : [{ path: 'center', code: 'validation.centerOutside' } as const]),
    ];
}

/** Something the area would leave out: its kind, id and Romanian title (the page links to its editor). */
export interface Outside {
    readonly kind: 'photo' | 'poi';
    readonly id: string;
    readonly title: string;
}

/** Whether `position` lies within `bounds` plus the slack the manifest allows. */
function inside(bounds: BoundsRecord, position: LngLat): boolean {
    return bboxContains(bboxExpand(bboxFromRecord(bounds), PHOTO_LOCATION_SLACK_DEG), position);
}

/** The photos and places the new bounds would leave beyond their slack (the manifest would drop them). */
export function contentOutside(
    bounds: BoundsRecord,
    photos: readonly { readonly id: string; readonly data: PhotoDoc }[],
    pois: readonly { readonly id: string; readonly data: PoiDoc }[],
): Outside[] {
    const photosOut = photos
        .filter((photo) => photo.data.location !== undefined && !inside(bounds, [photo.data.location.lng, photo.data.location.lat]))
        .map((photo): Outside => ({ kind: 'photo', id: photo.id, title: photo.data.title.ro }));
    const poisOut = pois
        .filter((poi) => !geometryPositions(geometryFromDoc(poi.data.geometry)).every((position) => inside(bounds, position)))
        .map((poi): Outside => ({ kind: 'poi', id: poi.id, title: poi.data.title.ro }));
    return [...photosOut, ...poisOut];
}

/** Whether `next` holds all of `current` (then nothing inside can fall out, and no content needs reading). */
export function boundsGrow(current: BoundsRecord, next: BoundsRecord): boolean {
    return next.west <= current.west && next.south <= current.south && next.east >= current.east && next.north >= current.north;
}

/** The area's number fields: the four edges, the start centre, the start zoom and the zoom limits. */
export type AreaNumberField = 'west' | 'south' | 'east' | 'north' | 'lat' | 'lng' | 'zoom' | 'minZoom' | 'maxZoom';

/** A number as typed (`,` read as the decimal point); NaN for anything else, so the schema names the field. */
function numberOf(text: string): number {
    const trimmed = text.trim().replace(',', '.');
    return trimmed === '' ? Number.NaN : Number(trimmed);
}

/** A field that may be empty: no value then. */
function optionalNumber(text: string): number | undefined {
    return text.trim() === '' ? undefined : numberOf(text);
}

function centerOf(city: CityDoc): { readonly lat: number; readonly lng: number } {
    const { west, south, east, north } = city.bounds;
    return city.center ?? { lat: (south + north) / 2, lng: (west + east) / 2 };
}

const AREA_PATCHES: Readonly<Record<AreaNumberField, (city: CityDoc, text: string) => Partial<CityDoc>>> = {
    west: (city, text) => ({ bounds: { ...city.bounds, west: numberOf(text) } }),
    south: (city, text) => ({ bounds: { ...city.bounds, south: numberOf(text) } }),
    east: (city, text) => ({ bounds: { ...city.bounds, east: numberOf(text) } }),
    north: (city, text) => ({ bounds: { ...city.bounds, north: numberOf(text) } }),
    lat: (city, text) => ({ center: { ...centerOf(city), lat: numberOf(text) } }),
    lng: (city, text) => ({ center: { ...centerOf(city), lng: numberOf(text) } }),
    zoom: (_city, text) => ({ zoom: optionalNumber(text) }),
    minZoom: (_city, text) => ({ minZoom: optionalNumber(text) }),
    maxZoom: (_city, text) => ({ maxZoom: optionalNumber(text) }),
};

/** The patch a typed number makes of the city. */
export function areaNumberPatch(city: CityDoc, field: AreaNumberField, text: string): Partial<CityDoc> {
    return AREA_PATCHES[field](city, text);
}
