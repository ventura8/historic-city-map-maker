/**
 * The manifest of one city from its documents (`docs/research/M2-interfaces.md` §3.5, security review §4.5), pure:
 * the builder reads, this assembles and validates, the builder uploads. Every listed document becomes its manifest
 * shape (`{lat, lng}` → `[lng, lat]`, bounds records → boxes, English falling back to Romanian where the manifest needs
 * both); a document the manifest schema refuses is left out and reported (entity, id, first issue), never failing the
 * build; only a problem of the city itself does.
 */
import {
    MANIFEST_VERSION,
    bboxCenter,
    bboxFromRecord,
    geometryFromDoc,
    validateManifest,
    isReviewCleared,
    type CityDoc,
    type LayerDoc,
    type Manifest,
    type ManifestStateDoc,
    type PhotoDoc,
    type PoiCategoryDoc,
    type PoiDoc,
    type StoryDoc,
    type ValidationIssue,
} from '@hcm/shared';

import type { InvalidDocument, QueryResult, StoredDocument } from '../ports/documents.js';

export type SkippedDocument = NonNullable<ManifestStateDoc['skipped']>[number];

type ManifestEntity = SkippedDocument['entity'];

/** Everything the builder read for one city: the city, and each collection's valid and refused documents. */
export interface CityContent {
    readonly cityId: string;
    readonly city: CityDoc;
    readonly layers: QueryResult<LayerDoc>;
    readonly photos: QueryResult<PhotoDoc>;
    readonly poiCategories: QueryResult<PoiCategoryDoc>;
    readonly pois: QueryResult<PoiDoc>;
    /** M17: the city's published stories. */
    readonly stories: QueryResult<StoryDoc>;
}

/** How many of each the manifest lists (`manifests/{city}.counts`). */
type Counts = Readonly<Record<ListKey, number>>;

export type Assembly =
    | { readonly ok: true; readonly manifest: Manifest; readonly counts: Counts; readonly skipped: readonly SkippedDocument[] }
    | { readonly ok: false; readonly issues: readonly ValidationIssue[]; readonly skipped: readonly SkippedDocument[] };

/** M13 §5: where the manifest's Contribute link goes: the project's admin, when it knows its address. */
export interface ManifestLinks {
    readonly adminUrl?: string;
}

/** The view of a city that sets none: a city-wide zoom, within its own limits when it sets those. */
const VIEW_DEFAULTS = { zoom: 13, minZoom: 10, maxZoom: 20 } as const;
const DEFAULT_BASEMAP = { style: 'mapbox://styles/mapbox/standard' } as const;
/** A document refused again after this many passes fails the build (each pass drops every refused document). */
const MAX_PASSES = 4;
const MAX_SKIPPED_PATH = 200;

type ListKey = 'layers' | 'photos' | 'unplaced' | 'poiCategories' | 'pois' | 'stories';

const ENTITY_OF: Readonly<Record<ListKey, ManifestEntity>> = {
    layers: 'layer',
    photos: 'photo',
    unplaced: 'photo',
    poiCategories: 'poiCategory',
    pois: 'poi',
    stories: 'story',
};

const LIST_KEYS: readonly ListKey[] = ['layers', 'photos', 'unplaced', 'poiCategories', 'pois', 'stories'];

/** What the manifest still lists, which an entry's references are filtered to. */
interface Listed {
    /** The photos on the map: a POI's photos are these. */
    readonly placed: ReadonlySet<string>;
    /** M17: every listed photo, placed or not, and every listed place: a story's links are these. */
    readonly photos: ReadonlySet<string>;
    readonly pois: ReadonlySet<string>;
    /** M27: the listed layers, which a place's `sourceLayer` must name. */
    readonly layers: ReadonlySet<string>;
}

/** One listed document: its id and its manifest entry (its references are the ones the manifest still lists). */
interface Item {
    readonly id: string;
    readonly entry: (listed: Listed) => unknown;
}

type Lists = Readonly<Record<ListKey, readonly Item[]>>;

/** A manifest issue inside one listed item: the item's list and index, the issue, the path inside the item. */
interface Located {
    readonly key: ListKey;
    readonly index: number;
    readonly issue: ValidationIssue;
    readonly path: string;
}

type Localized = Readonly<{ ro: string; en?: string | undefined }>;

/** Romanian and English: English falls back to Romanian (the viewer would show Romanian anyway). */
function both(text: Localized): { readonly ro: string; readonly en: string } {
    return { ro: text.ro, en: text.en ?? text.ro };
}

function maybeBoth(text: Localized | undefined): { readonly ro: string; readonly en: string } | undefined {
    return text === undefined ? undefined : both(text);
}

function cityView(city: CityDoc) {
    const bounds = bboxFromRecord(city.bounds);
    const minZoom = city.minZoom ?? VIEW_DEFAULTS.minZoom;
    const maxZoom = city.maxZoom ?? VIEW_DEFAULTS.maxZoom;
    const zoom = city.zoom ?? Math.min(Math.max(VIEW_DEFAULTS.zoom, minZoom), maxZoom);
    const center = city.center === undefined ? bboxCenter(bounds) : [city.center.lng, city.center.lat];
    return { center, zoom, minZoom, maxZoom, bounds };
}

/** The manifest's `city.ownIcon`: set only while the tab icon is an editor's upload (`icon-own-32.png` exists). */
function ownIconFlag(city: CityContent['city']): true | undefined {
    return city.icon?.source === 'custom' ? true : undefined;
}

/**
 * The manifest's `city`: the public token, theme tokens and analytics ids from the city document, the crash endpoint
 * from the runtime configuration (crash reports work before analytics is set up). A city without About, privacy
 * notice, theme or public token fails the manifest schema: the build reports it.
 */
function cityEntry(content: CityContent, errorEndpoint: string): unknown {
    const { city } = content;
    return {
        id: content.cityId,
        name: both(city.name),
        ...cityView(city),
        about: maybeBoth(city.about),
        credits: city.credits ?? [],
        privacy: maybeBoth(city.privacy),
        theme: city.theme,
        basemap: city.basemap ?? DEFAULT_BASEMAP,
        mapbox: { publicToken: city.mapbox?.publicToken },
        analytics: { ...city.analytics, errorEndpoint },
        engine: city.engine,
        ownIcon: ownIconFlag(city),
    };
}

function layerEntry(layer: LayerDoc, id: string, listed: Listed): unknown {
    return {
        id,
        year: layer.year,
        date: layer.date,
        label: both(layer.label),
        description: maybeBoth(layer.description),
        kind: layer.kind,
        sensor: layer.sensor,
        attribution: layer.attribution,
        source: layer.source,
        minzoom: layer.minzoom,
        maxzoom: layer.maxzoom,
        bounds: layer.bounds === undefined ? undefined : bboxFromRecord(layer.bounds),
        order: layer.order,
        defaultVisible: layer.defaultVisible,
        opacity: layer.opacity,
        adjustments: layer.adjustments,
        // M17 §12: a place the manifest does not list leaves the map's Media, never the map.
        placeIds: stillListed(layer.placeIds, listed.pois),
    };
}

/** What a photo says wherever it stands: on the map, or (M13) in the "Where was this taken?" gallery. */
function photoCommon(photo: PhotoDoc & { readonly image: NonNullable<PhotoDoc['image']> }, id: string, listed: Listed) {
    return {
        id,
        kind: photo.kind,
        placeIds: stillListed(photo.placeIds, listed.pois),
        title: photo.title,
        description: photo.description,
        year: photo.year,
        yearEnd: photo.yearEnd,
        month: photo.month,
        day: photo.day,
        dateText: photo.dateText,
        author: photo.author,
        license: photo.license,
        rightsHolder: photo.rightsHolder,
        rightsReview: photo.rightsReview,
        source: photo.sourceUrl === undefined ? undefined : { url: photo.sourceUrl, label: photo.sourceLabel },
        credit: photo.credit,
        links: photo.links ?? [],
        image: imageEntry(photo.image),
        versions: versionEntries(photo),
    };
}

/** The public part of an image: its two addresses and its size. */
function imageEntry(image: NonNullable<PhotoDoc['image']>) {
    return { web: image.web, thumb: image.thumb, w: image.w, h: image.h };
}

/** The improved and colorized versions, each with its credit (the owner 2026-11-09); absent when the photo has neither. */
function versionEntries({ versions, versionCredits }: PhotoDoc): unknown {
    const entries = (['improved', 'colorized'] as const).flatMap((kind) => {
        const version = versions?.[kind];
        return version === undefined ? [] : [[kind, { ...imageEntry(version.image), credit: versionCredits?.[kind] }] as const];
    });
    return entries.length === 0 ? undefined : Object.fromEntries(entries);
}

function photoEntry(photo: PhotoDoc & { readonly image: NonNullable<PhotoDoc['image']> }, id: string, listed: Listed): unknown {
    return { ...photoCommon(photo, id, listed), location: photo.location, bearing: photo.bearing, fov: photo.fov, viewedArea: photo.viewedArea };
}

function poiCategoryEntry(category: PoiCategoryDoc, id: string): unknown {
    const { icon, color, defaultOpacity, defaultVisible, pinned, attribution } = category;
    // M27: the three optional fields travel only when set, so a category without them reads as before.
    return { id, label: both(category.label), icon, color, defaultOpacity, defaultVisible, pinned, attribution };
}

/** The ids of `ids` that are in `known`; none at all is absent. */
function stillListed(ids: readonly string[] | undefined, known: ReadonlySet<string>): readonly string[] | undefined {
    const kept = ids?.filter((id) => known.has(id));
    return kept?.length === 0 ? undefined : kept;
}

/** M17 §13: a place's facts name only places the manifest lists; none left, the field goes. */
function factsEntry(facts: PoiDoc['facts'], listed: Listed): unknown {
    if (facts === undefined) {
        return undefined;
    }
    const kept = { ...facts, relatedPlaceIds: stillListed(facts.relatedPlaceIds, listed.pois) };
    return Object.values(kept).some((value) => value !== undefined) ? kept : undefined;
}

/** A POI names only photos the manifest lists: an unpublished photo leaves the POI, never the POI the manifest. */
function poiEntry(poi: PoiDoc, id: string, listed: Listed): unknown {
    return {
        id,
        category: poi.category,
        geometry: geometryFromDoc(poi.geometry),
        title: poi.title,
        description: poi.description,
        yearStart: poi.yearStart,
        yearEnd: poi.yearEnd,
        yearSeen: poi.yearSeen,
        links: poi.links ?? [],
        photoIds: stillListed(poi.photoIds, listed.placed),
        credit: poi.credit,
        // M27: a layer the manifest does not list (unpublished, retired) is left out, never the place.
        sourceLayer: poi.sourceLayer !== undefined && listed.layers.has(poi.sourceLayer) ? poi.sourceLayer : undefined,
        group: poi.group,
        facts: factsEntry(poi.facts, listed),
    };
}

/** M17 §4: a story names only photos and places the manifest lists, as a POI does. */
function storyEntry(story: StoryDoc & { readonly body: NonNullable<StoryDoc['body']> }, id: string, listed: Listed): unknown {
    return {
        id,
        title: story.title,
        body: story.body,
        yearStart: story.yearStart,
        yearEnd: story.yearEnd,
        photoIds: stillListed(story.photoIds, listed.photos),
        poiIds: stillListed(story.poiIds, listed.pois),
        credit: story.credit,
    };
}

/** A story is listed published, cleared by review and with a text. */
function hasBody(story: StoryDoc): story is StoryDoc & { readonly body: NonNullable<StoryDoc['body']> } {
    return story.published && isReviewCleared(story) && story.body !== undefined;
}

const byId = (a: { readonly id: string }, b: { readonly id: string }): number => a.id.localeCompare(b.id);

function byOrder(a: StoredDocument<{ readonly order: number }>, b: StoredDocument<{ readonly order: number }>): number {
    return a.data.order - b.data.order || byId(a, b);
}

/**
 * Listed: published, processed and (M13 §2) cleared by review. `reviewStatus` is checked here as well as in the rules: a
 * pending or refused document never reaches the public whatever its `published` says.
 */
function hasImage(photo: PhotoDoc): photo is PhotoDoc & { readonly image: NonNullable<PhotoDoc['image']> } {
    return photo.published && isReviewCleared(photo) && photo.processing === 'done' && photo.image !== undefined;
}

/** The listed documents in a stable order: ready published layers, processed published photos, every category. */
function listsOf(content: CityContent): Lists {
    const shown = content.photos.documents.flatMap(({ id, data }) => (hasImage(data) ? [{ id, data }] : []));
    const items = (placed: boolean, entry: typeof photoEntry | typeof photoCommon) =>
        shown
            .filter(({ data }) => (data.location !== undefined) === placed)
            .map(({ id, data }) => ({ id, entry: (listed: Listed) => entry(data, id, listed) }))
            .toSorted(byId);
    return {
        layers: content.layers.documents
            .filter(({ data }) => data.published && data.status === 'ready')
            .toSorted(byOrder)
            .map(({ id, data }) => ({ id, entry: (listed: Listed) => layerEntry(data, id, listed) })),
        photos: items(true, photoEntry),
        unplaced: items(false, photoCommon),
        poiCategories: content.poiCategories.documents
            .toSorted(byOrder)
            .map(({ id, data }) => ({ id, entry: () => poiCategoryEntry(data, id) })),
        pois: content.pois.documents
            .filter(({ data }) => data.published && isReviewCleared(data))
            .toSorted(byId)
            .map(({ id, data }) => ({ id, entry: (listed: Listed) => poiEntry(data, id, listed) })),
        stories: content.stories.documents
            .flatMap(({ id, data }) => (hasBody(data) ? [{ id, data }] : []))
            .toSorted(byId)
            .map(({ id, data }) => ({ id, entry: (listed: Listed) => storyEntry(data, id, listed) })),
    };
}

function draft(content: CityContent, city: unknown, lists: Lists, links: ManifestLinks): unknown {
    const ids = (key: ListKey) => lists[key].map((item) => item.id);
    const listed: Listed = {
        placed: new Set(ids('photos')),
        photos: new Set([...ids('photos'), ...ids('unplaced')]),
        pois: new Set(ids('pois')),
        layers: new Set(ids('layers')),
    };
    const entries = (key: ListKey) => lists[key].map((item) => item.entry(listed));
    return {
        version: MANIFEST_VERSION,
        city,
        layers: entries('layers'),
        photos: entries('photos'),
        // M13 §5: absent when empty, so a city with none keeps the manifest it had.
        unplaced: lists.unplaced.length === 0 ? undefined : entries('unplaced'),
        contributeUrl: links.adminUrl === undefined ? undefined : `${links.adminUrl}#/contribute/${content.cityId}`,
        photosOverlay: content.city.photosOverlay,
        poiCategories: entries('poiCategories'),
        pois: entries('pois'),
        // M17 §4: absent when empty, as `unplaced`.
        stories: lists.stories.length === 0 ? undefined : entries('stories'),
    };
}

/** `photos[3].location.lat` → the fourth item of `photos`, and the path inside it (`location.lat`). */
function locate(issue: ValidationIssue): Located | undefined {
    const key = LIST_KEYS.find((candidate) => issue.path.startsWith(`${candidate}[`));
    if (key === undefined) {
        return undefined;
    }
    const close = issue.path.indexOf(']');
    return { key, index: Number(issue.path.slice(key.length + 1, close)), issue, path: issue.path.slice(close + 1).replace(/^\./, '') };
}

function skippedOf(located: Located, id: string): SkippedDocument {
    return { entity: ENTITY_OF[located.key], id, code: located.issue.code, path: located.path.slice(0, MAX_SKIPPED_PATH) };
}

/** Each refused item once (its first issue), and the lists without them. */
function drop(lists: Lists, located: readonly Located[]): { readonly lists: Lists; readonly skipped: readonly SkippedDocument[] } {
    const first = new Map<string, Located>();
    for (const item of located) {
        const at = `${item.key}/${String(item.index)}`;
        first.set(at, first.get(at) ?? item);
    }
    const skipped: SkippedDocument[] = [];
    const keep = (key: ListKey) =>
        lists[key].filter((item, index) => {
            const refusal = first.get(`${key}/${String(index)}`);
            if (refusal !== undefined) {
                skipped.push(skippedOf(refusal, item.id));
            }
            return refusal === undefined;
        });
    return {
        lists: {
            layers: keep('layers'),
            photos: keep('photos'),
            unplaced: keep('unplaced'),
            poiCategories: keep('poiCategories'),
            pois: keep('pois'),
            stories: keep('stories'),
        },
        skipped,
    };
}

/** Validates, drops the refused documents and tries again, until the manifest passes or the city itself is the problem. */
function settle(
    content: CityContent,
    city: unknown,
    lists: Lists,
    state: { passes: number; skipped: readonly SkippedDocument[]; links: ManifestLinks },
): Assembly {
    const result = validateManifest(draft(content, city, lists, state.links));
    if (result.ok) {
        const counts = {
            layers: lists.layers.length,
            photos: lists.photos.length,
            unplaced: lists.unplaced.length,
            poiCategories: lists.poiCategories.length,
            pois: lists.pois.length,
            stories: lists.stories.length,
        };
        return { ok: true, manifest: result.value, counts, skipped: state.skipped };
    }
    const located = result.issues.map(locate);
    const items = located.filter((item) => item !== undefined);
    if (items.length < located.length || state.passes === 0) {
        return { ok: false, issues: result.issues.filter((_, index) => located[index] === undefined), skipped: state.skipped };
    }
    const next = drop(lists, items);
    return settle(content, city, next.lists, {
        passes: state.passes - 1,
        skipped: [...state.skipped, ...next.skipped],
        links: state.links,
    });
}

function refused(entity: ManifestEntity, documents: readonly InvalidDocument[]): SkippedDocument[] {
    return documents.map((document) => ({
        entity,
        id: document.id,
        code: document.issues[0]?.code ?? 'validation.invalid',
        path: (document.issues[0]?.path ?? '').slice(0, MAX_SKIPPED_PATH),
    }));
}

/** The city's manifest and the documents left out, or the issues of the city itself when it cannot be published. */
export function assembleManifest(content: CityContent, errorEndpoint: string, links: ManifestLinks = {}): Assembly {
    const skipped = [
        ...refused('layer', content.layers.invalid),
        ...refused('photo', content.photos.invalid),
        ...refused('poiCategory', content.poiCategories.invalid),
        ...refused('poi', content.pois.invalid),
        ...refused('story', content.stories.invalid),
    ];
    return settle(content, cityEntry(content, errorEndpoint), listsOf(content), { passes: MAX_PASSES, skipped, links });
}
