/**
 * Places (points of interest) as the pois area reads and writes them (docs/research/M2c-interfaces.md §7): the editable
 * value of a place (its geometry as the manifest's `Geometry`, converted with `geometryToDoc` / `geometryFromDoc` at the
 * Firestore boundary only), list rows, categories, and the city's bounds and view the map and the limits use.
 */
import {
    bboxFromRecord,
    geometryFromDoc,
    geometryToDoc,
    MAX_GEOMETRY_VERTICES,
    MAX_POLYGON_RINGS,
    PHOTO_LOCATION_SLACK_DEG,
    bboxExpand,
    type BBox,
    type CityDoc,
    type Geometry,
    type MapView,
    type PoiCategoryDoc,
    type PoiDoc,
} from '@hcm/shared';

import type { Stored } from '../content/services.js';

/** The fields a place's editor changes (`CLIENT_WRITES.poi.update` without the stamp). */
export const POI_EDITABLE = [
    'category',
    'geometry',
    'title',
    'description',
    'yearStart',
    'yearEnd',
    'yearSeen',
    'links',
    'photoIds',
    'published',
    'sourceLayer',
] as const;

/** M13 §2: what the rules want of an uploader's new place, added to its fields as it is created. */
export const UPLOADER_POI_FIELDS = { reviewStatus: 'pending', published: false } as const;

export type PoiEditable = (typeof POI_EDITABLE)[number];

export type PoiShape = 'point' | 'line' | 'area';

export interface PoiLink {
    readonly url: string;
    readonly label: string;
}

export interface PoiText {
    readonly ro: string;
    readonly en?: string;
}

/** A place as its editor holds it; `geometry` is null until the shape of a new place is drawn. */
export interface PoiValue {
    readonly category: string;
    readonly geometry: Geometry | null;
    readonly title: PoiText;
    readonly description?: PoiText;
    readonly yearStart?: number;
    readonly yearEnd?: number;
    /** M27: plan year when start/end are unknown (traced on that year's map). */
    readonly yearSeen?: number;
    readonly links: readonly PoiLink[];
    readonly photoIds: readonly string[];
    readonly published: boolean;
    /** M27: the id of the city's layer the street was traced on. */
    readonly sourceLayer?: string;
}

/** A change the editor sends; `undefined` clears an optional field. */
export type PoiPatch = { readonly [K in keyof PoiValue]?: PoiValue[K] | undefined };

export interface PoiItem {
    readonly id: string;
    readonly version: string;
    readonly category: string;
    readonly title: PoiText;
    readonly yearStart: number | null;
    readonly yearEnd: number | null;
    readonly yearSeen: number | null;
    readonly shape: PoiShape;
    readonly published: boolean;
    readonly geometry: Geometry;
    /** The whole place as stored (the import compares with it, the export writes it). */
    readonly value: PoiValue;
}

export interface CategoryItem {
    readonly id: string;
    readonly label: PoiText;
    readonly icon: string;
    readonly color: string;
    readonly defaultOpacity: number;
    readonly order: number;
}

/** What the map and the limits need of the city. */
export interface CityFrame {
    readonly bounds: BBox;
    readonly view: MapView;
}

export function shapeOf(geometry: Geometry): PoiShape {
    if (geometry.type === 'Point') {
        return 'point';
    }
    return geometry.type === 'LineString' ? 'line' : 'area';
}

/** The text with an absent English left out. */
export function textOf(text: { readonly ro: string; readonly en?: string | undefined }): PoiText {
    return text.en === undefined ? { ro: text.ro } : { ro: text.ro, en: text.en };
}

/** `{[key]: value}`, or nothing when the value is absent. */
export function optional<K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> {
    return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}

/** A stored place as its editor starts. */
export function valueOf(doc: PoiDoc): PoiValue {
    return {
        category: doc.category,
        geometry: geometryFromDoc(doc.geometry),
        title: textOf(doc.title),
        ...optional('description', doc.description === undefined ? undefined : textOf(doc.description)),
        ...optional('yearStart', doc.yearStart),
        ...optional('yearEnd', doc.yearEnd),
        ...optional('yearSeen', doc.yearSeen),
        links: doc.links ?? [],
        photoIds: doc.photoIds ?? [],
        published: doc.published,
        ...optional('sourceLayer', doc.sourceLayer),
    };
}

/** `value` with `patch` applied; an `undefined` in the patch removes the field. */
export function patched(value: PoiValue, patch: PoiPatch): PoiValue {
    const merged: Record<string, unknown> = { ...value, ...patch };
    return Object.fromEntries(Object.entries(merged).filter(([, field]) => field !== undefined)) as unknown as PoiValue;
}

/** A trimmed text: an empty English is no English; an empty description no description. */
function cleanText(text: PoiText): PoiText {
    const en = text.en?.trim() ?? '';
    return en === '' ? { ro: text.ro.trim() } : { ro: text.ro.trim(), en };
}

function cleanDescription(text: PoiText | undefined): Readonly<Record<string, PoiText>> {
    const cleaned = text === undefined ? null : cleanText(text);
    return cleaned === null || (cleaned.ro === '' && cleaned.en === undefined) ? {} : { description: cleaned };
}

function optionalYears(value: PoiValue): Readonly<Partial<Record<'yearStart' | 'yearEnd' | 'yearSeen', number>>> {
    return {
        ...optional('yearStart', value.yearStart),
        ...optional('yearEnd', value.yearEnd),
        ...optional('yearSeen', value.yearSeen),
    };
}

/** The Firestore fields of a place (without the stamp): the geometry without nested arrays, empty texts left out. */
export function docFieldsOf(value: PoiValue): Readonly<Record<string, unknown>> {
    return {
        category: value.category,
        ...(value.geometry === null ? {} : { geometry: geometryToDoc(value.geometry) }),
        title: cleanText(value.title),
        ...cleanDescription(value.description),
        ...optionalYears(value),
        links: value.links,
        photoIds: value.photoIds,
        published: value.published,
        ...optional('sourceLayer', value.sourceLayer),
    };
}

export function poiItemOf(doc: Stored<PoiDoc>): PoiItem {
    const value = valueOf(doc.data);
    const geometry = geometryFromDoc(doc.data.geometry);
    return {
        ...{ id: doc.id, version: doc.version, category: value.category, title: value.title },
        ...{ yearStart: value.yearStart ?? null, yearEnd: value.yearEnd ?? null, yearSeen: value.yearSeen ?? null },
        ...{ shape: shapeOf(geometry), published: value.published, geometry, value },
    };
}

export function categoryItemOf(doc: Stored<PoiCategoryDoc>): CategoryItem {
    const { label, icon, color, defaultOpacity, order } = doc.data;
    return { id: doc.id, label: textOf(label), icon, color, defaultOpacity, order };
}

/** The city's bounds and starting view (its centre and zoom, else the middle of its bounds at zoom 13). */
export function cityFrameOf(city: CityDoc): CityFrame {
    const bounds = bboxFromRecord(city.bounds);
    const center = city.center === undefined ? null : ([city.center.lng, city.center.lat] as const);
    const middle: readonly [number, number] = [(bounds[0][0] + bounds[1][0]) / 2, (bounds[0][1] + bounds[1][1]) / 2];
    return { bounds, view: { center: center ?? middle, zoom: city.zoom ?? 13, bearing: 0 } };
}

/** The drawing limits of a city (its bounds plus the slack the manifest rules allow). */
export function drawLimitsOf(frame: CityFrame): { readonly limits: BBox; readonly maxVertices: number; readonly maxRings: number } {
    return { limits: bboxExpand(frame.bounds, PHOTO_LOCATION_SLACK_DEG), maxVertices: MAX_GEOMETRY_VERTICES, maxRings: MAX_POLYGON_RINGS };
}

/** Text in the admin's language; a missing English text falls back to Romanian. */
export function textIn(text: PoiText, locale: 'ro' | 'en'): string {
    return locale === 'en' ? (text.en ?? text.ro) : text.ro;
}
