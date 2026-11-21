/**
 * GeoJSON import and export of places (docs/research/M2c-interfaces.md §7.4; behaviour A34). A file never reaches the
 * server: it is parsed here, each feature mapped field by field into a new object (never spread from the file, so no
 * prototype keys travel), validated like an edited place (`draftIssues`: `poiDocSchema`, the city's limits, the
 * categories), and sorted into new, updated (its `id` names a place of the city), unchanged and refused (with the
 * reason). Text stays text: titles and descriptions are kept as typed, markup is characters.
 */
import { geometrySchema, ID_PATTERN, MAX_GEOMETRY_VERTICES, type Geometry } from '@hcm/shared';

import { draftIssues, type PoiContext } from './draft.js';
import { docFieldsOf, optional, type CategoryItem, type PoiLink, type PoiText, type PoiValue } from './model.js';

/** A file over this many bytes is refused before it is read. */
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

/** The export's own member: what wrote it, for which city, with which categories. */
export const EXPORT_VERSION = 1;

export const GEOJSON_MEDIA_TYPE = 'application/geo+json';

export type ImportFileRefusal = 'too-big' | 'not-geojson' | 'empty';

type ImportRefusalReason =
    | 'unsupported-type'
    | 'altitude'
    | 'open-ring'
    | 'too-many-positions'
    | 'outside'
    | 'bad-shape'
    | 'unknown-category'
    | 'invalid'
    | 'unreadable-place';

interface ImportRefusal {
    /** The feature's place in the file, from 1. */
    readonly number: number;
    /** Its Romanian title when it has one, as text. */
    readonly title: string | null;
    readonly reason: ImportRefusalReason;
    /** The field of an `invalid` feature (`title.ro`, `links.0.url`). */
    readonly path: string | null;
}

interface ImportedPlace {
    readonly number: number;
    /** The place it updates, or null for a new place. */
    readonly id: string | null;
    readonly value: PoiValue;
}

/** A planned update: its place's id is known. */
type UpdatedPlace = ImportedPlace & { readonly id: string };

export interface ImportPlan {
    readonly created: readonly ImportedPlace[];
    readonly updated: readonly UpdatedPlace[];
    readonly unchanged: number;
    readonly refused: readonly ImportRefusal[];
    /** Features without a known category (they take the category chosen for them). */
    readonly uncategorised: number;
}

export interface ImportContext extends PoiContext {
    /** The city's places by id. */
    readonly existing: ReadonlyMap<string, PoiValue>;
    /** The ids of the city's places whose documents fail their schema: a feature naming one is refused, never a new place. */
    readonly unreadable?: ReadonlySet<string>;
    /** The category a feature without a known one takes (chosen in the dialog), or null. */
    readonly fallbackCategory: string | null;
}

type Raw = Readonly<Record<string, unknown>>;

function isObject(value: unknown): value is Raw {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The features of a GeoJSON text (a FeatureCollection or a single Feature), or why there are none. */
export function readFeatures(
    text: string,
): { readonly ok: true; readonly features: readonly unknown[] } | { readonly ok: false; readonly reason: ImportFileRefusal } {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text) as unknown;
    } catch {
        return { ok: false, reason: 'not-geojson' };
    }
    const features = featuresOf(parsed);
    if (features === null) {
        return { ok: false, reason: 'not-geojson' };
    }
    return features.length === 0 ? { ok: false, reason: 'empty' } : { ok: true, features };
}

function featuresOf(parsed: unknown): readonly unknown[] | null {
    if (!isObject(parsed)) {
        return null;
    }
    if (parsed['type'] === 'Feature') {
        return [parsed];
    }
    const features = parsed['features'];
    return parsed['type'] === 'FeatureCollection' && Array.isArray(features) ? features : null;
}

function positionsIn(coordinates: unknown): unknown[] {
    if (!Array.isArray(coordinates)) {
        return [];
    }
    return typeof coordinates[0] === 'number' ? [coordinates] : coordinates.flatMap((inner: unknown) => positionsIn(inner));
}

function ringsOpen(geometry: Raw): boolean {
    const rings = geometry['coordinates'];
    return geometry['type'] === 'Polygon' && Array.isArray(rings) && rings.some((ring: unknown) => !isClosedRing(ring));
}

function isClosedRing(ring: unknown): boolean {
    return Array.isArray(ring) && ring.length > 0 && JSON.stringify(ring[0]) === JSON.stringify(ring.at(-1));
}

const PLACE_TYPES: ReadonlySet<string> = new Set(['Point', 'LineString', 'Polygon']);

function isPlaceGeometry(geometry: unknown): geometry is Raw {
    return isObject(geometry) && PLACE_TYPES.has(String(geometry['type']));
}

function hasAltitude(position: unknown): boolean {
    return Array.isArray(position) && position.length > 2;
}

/** Why a geometry cannot be a place's, before the schema's own checks. */
function geometryReason(geometry: unknown): ImportRefusalReason | null {
    if (!isPlaceGeometry(geometry)) {
        return 'unsupported-type';
    }
    const positions = positionsIn(geometry['coordinates']);
    if (positions.some(hasAltitude)) {
        return 'altitude';
    }
    if (ringsOpen(geometry)) {
        return 'open-ring';
    }
    return positions.length > MAX_GEOMETRY_VERTICES ? 'too-many-positions' : null;
}

function geometryOf(raw: unknown): { readonly geometry: Geometry } | { readonly reason: ImportRefusalReason } {
    const reason = geometryReason(raw);
    if (reason !== null) {
        return { reason };
    }
    const parsed = geometrySchema.safeParse(raw);
    return parsed.success ? { geometry: parsed.data } : { reason: 'invalid' };
}

function stringOf(value: unknown): string | null {
    return typeof value === 'string' ? value : null;
}

function objectText(value: Raw): PoiText {
    const ro = stringOf(value['ro']) ?? '';
    const en = stringOf(value['en']);
    return en === null ? { ro } : { ro, en };
}

/** `{ro, en?}` from an object, or a plain string as Romanian. */
function textOf(value: unknown): PoiText | null {
    const plain = stringOf(value);
    if (plain !== null) {
        return { ro: plain };
    }
    return isObject(value) ? objectText(value) : null;
}

/** `{[field]: year}` when the property is a number, else nothing (the schema checks the range). */
function yearOf(
    field: 'yearStart' | 'yearEnd' | 'yearSeen',
    value: unknown,
): Readonly<Partial<Record<'yearStart' | 'yearEnd' | 'yearSeen', number>>> {
    return typeof value === 'number' ? { [field]: value } : {};
}

function linksOf(value: unknown): PoiLink[] {
    return Array.isArray(value)
        ? value.filter(isObject).map((link) => ({ url: stringOf(link['url']) ?? '', label: stringOf(link['label']) ?? '' }))
        : [];
}

function idsOf(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
}

/** `{sourceLayer}` when the property is a layer id, else nothing (a non-id value is dropped). */
function sourceLayerOf(value: unknown): Readonly<Partial<Record<'sourceLayer', string>>> {
    return typeof value === 'string' && ID_PATTERN.test(value) ? { sourceLayer: value } : {};
}

/** A feature's properties as a place's value, field by field. */
function valueOf(properties: Raw, geometry: Geometry, category: string): PoiValue {
    const description = textOf(properties['description']);
    return {
        category,
        geometry,
        title: textOf(properties['title']) ?? { ro: '' },
        ...(description === null ? {} : { description }),
        ...yearOf('yearStart', properties['yearStart']),
        ...yearOf('yearEnd', properties['yearEnd']),
        ...yearOf('yearSeen', properties['yearSeen']),
        links: linksOf(properties['links']),
        photoIds: idsOf(properties['photoIds']),
        published: properties['published'] !== false,
        ...sourceLayerOf(properties['sourceLayer']),
    };
}

function existingId(feature: Raw, existing: ReadonlyMap<string, PoiValue>): string | null {
    const id = stringOf(feature['id']);
    return id !== null && ID_PATTERN.test(id) && existing.has(id) ? id : null;
}

function namesUnreadable(feature: Raw, context: ImportContext): boolean {
    const id = stringOf(feature['id']);
    return id !== null && context.unreadable?.has(id) === true;
}

function categoryOf(properties: Raw, context: ImportContext): string | null {
    const named = stringOf(properties['category']);
    return named !== null && context.categories?.has(named) === true ? named : context.fallbackCategory;
}

const ISSUE_REASONS: Readonly<Record<string, ImportRefusalReason>> = {
    'validation.outsideCity': 'outside',
    'validation.invalid': 'bad-shape',
    'validation.tooBig': 'too-many-positions',
};

function issueReason(path: string, code: string): ImportRefusalReason {
    if (path === 'category') {
        return 'unknown-category';
    }
    return path === 'geometry' ? (ISSUE_REASONS[code] ?? 'invalid') : 'invalid';
}

type Mapped = { readonly place: ImportedPlace; readonly categorised: boolean } | { readonly refusal: ImportRefusal };

/** A feature's parts, each an object (an empty one when the file has none). */
function partsOf(raw: unknown): { readonly feature: Raw; readonly properties: Raw } {
    const feature = isObject(raw) ? raw : {};
    return { feature, properties: isObject(feature['properties']) ? feature['properties'] : {} };
}

interface Candidate {
    readonly number: number;
    readonly feature: Raw;
    readonly value: PoiValue;
}

/** A mapped feature checked like an edited place. */
function checked(
    candidate: Candidate,
    context: ImportContext,
    refuse: (reason: ImportRefusalReason, path: string | null) => Mapped,
): Mapped {
    if (namesUnreadable(candidate.feature, context)) {
        return refuse('unreadable-place', null);
    }
    const [issue] = draftIssues(candidate.value, context);
    if (issue !== undefined) {
        return refuse(issueReason(issue.path, issue.code), issue.path);
    }
    const place = { number: candidate.number, id: existingId(candidate.feature, context.existing), value: candidate.value };
    return { place, categorised: candidate.value.category !== context.fallbackCategory };
}

function mapFeature(raw: unknown, number: number, context: ImportContext): Mapped {
    const { feature, properties } = partsOf(raw);
    const title = textOf(properties['title'])?.ro ?? null;
    const refuse = (reason: ImportRefusalReason, path: string | null): Mapped => ({ refusal: { number, title, reason, path } });
    const geometry = geometryOf(feature['geometry']);
    if ('reason' in geometry) {
        return refuse(geometry.reason, null);
    }
    const category = categoryOf(properties, context);
    if (category === null) {
        return refuse('unknown-category', null);
    }
    return checked({ number, feature, value: valueOf(properties, geometry.geometry, category) }, context, refuse);
}

function unchanged(place: ImportedPlace, existing: ReadonlyMap<string, PoiValue>): boolean {
    const stored = place.id === null ? undefined : existing.get(place.id);
    return stored !== undefined && JSON.stringify(docFieldsOf(stored)) === JSON.stringify(docFieldsOf(place.value));
}

/** Sorts the file's features into what an import would create, update, leave and refuse (nothing is written). */
export function planImport(features: readonly unknown[], context: ImportContext): ImportPlan {
    const mapped = features.map((raw, index) => mapFeature(raw, index + 1, context));
    const places = mapped.flatMap((item) => ('place' in item ? [item.place] : []));
    const changed = places.filter((place) => !unchanged(place, context.existing));
    return {
        created: changed.filter((place) => place.id === null),
        updated: changed.filter((place): place is UpdatedPlace => place.id !== null),
        unchanged: places.length - changed.length,
        refused: mapped.flatMap((item) => ('refusal' in item ? [item.refusal] : [])),
        uncategorised: mapped.filter((item) => 'place' in item && !item.categorised).length,
    };
}

/** One place of an export. */
export interface ExportedPlace {
    readonly id: string;
    readonly value: PoiValue;
}

function exportFeature(place: ExportedPlace): Raw {
    const { value } = place;
    return {
        type: 'Feature',
        id: place.id,
        geometry: value.geometry,
        properties: {
            category: value.category,
            title: value.title,
            ...(value.description === undefined ? {} : { description: value.description }),
            ...optional('yearStart', value.yearStart),
            ...optional('yearEnd', value.yearEnd),
            ...optional('yearSeen', value.yearSeen),
            links: value.links,
            ...(value.photoIds.length === 0 ? {} : { photoIds: value.photoIds }),
            published: value.published,
            ...optional('sourceLayer', value.sourceLayer),
        },
    };
}

/** The export's text: a FeatureCollection with its own `hcm` member naming the city and the categories it uses. */
export function exportText(cityId: string, places: readonly ExportedPlace[], categories: readonly CategoryItem[]): string {
    const used = new Set(places.map((place) => place.value.category));
    const named = categories.filter((category) => used.has(category.id)).map(({ id, label, icon, color }) => ({ id, label, icon, color }));
    const collection = {
        type: 'FeatureCollection',
        hcm: { version: EXPORT_VERSION, city: cityId, categories: named },
        features: places.filter((place) => place.value.geometry !== null).map(exportFeature),
    };
    return JSON.stringify(collection, null, 2);
}

/** `<city>-places-<YYYY-MM-DD>.geojson`. */
export function exportFileName(cityId: string, now: Date): string {
    return `${cityId}-places-${now.toISOString().slice(0, 10)}.geojson`;
}
