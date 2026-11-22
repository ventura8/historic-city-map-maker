/**
 * The diff gate of the `publish.on*Write` triggers (`docs/research/M2-interfaces.md` §3.5, security review §4.5): a
 * write requests a manifest build only when it can change the published manifest.
 */
import type { HistoryEntity } from '@hcm/shared';

/** A content document as a trigger sees it (`snapshot.data()`), or undefined before a create and after a delete. */
export type RawDocument = Readonly<Record<string, unknown>> | undefined;

/**
 * Per entity, the document fields the builder (`assemble.ts`) reads besides `published`: the ones it copies into the
 * manifest and the ones that decide whether a document is listed (`status` of a layer, `processing` and `image` of a
 * photo). A change to any other field (the stamp, `createdAt`, a suggestion, the EXIF summary) rebuilds nothing.
 */
export const MANIFEST_FIELDS: Readonly<Record<HistoryEntity, readonly string[]>> = {
    city: [
        'name',
        'bounds',
        'center',
        'zoom',
        'minZoom',
        'maxZoom',
        'about',
        'privacy',
        'credits',
        'theme',
        'basemap',
        'mapbox',
        'analytics',
        'engine',
        'photosOverlay',
    ],
    layer: [
        'year',
        'date',
        'label',
        'description',
        'kind',
        'sensor',
        'attribution',
        'source',
        'minzoom',
        'maxzoom',
        'bounds',
        'order',
        'defaultVisible',
        'opacity',
        'adjustments',
        'placeIds',
        'status',
    ],
    photo: [
        'kind',
        'placeIds',
        'title',
        'description',
        'year',
        'yearEnd',
        'month',
        'day',
        'dateText',
        'author',
        'license',
        'rightsHolder',
        'sourceUrl',
        'sourceLabel',
        'rightsReview',
        'credit',
        'links',
        'location',
        'bearing',
        'fov',
        'viewedArea',
        'image',
        'versions',
        'versionCredits',
        'processing',
    ],
    poi: [
        'category',
        'geometry',
        'title',
        'description',
        'yearStart',
        'yearEnd',
        'yearSeen',
        'links',
        'photoIds',
        'credit',
        'sourceLayer',
        'group',
        'facts',
    ],
    poiCategory: ['label', 'icon', 'color', 'defaultOpacity', 'order', 'defaultVisible', 'pinned', 'attribution'],
    // M17: a story without a body is not listed, so its body decides as well as shows.
    story: ['title', 'body', 'yearStart', 'yearEnd', 'photoIds', 'poiIds', 'credit'],
};

/** POI categories have no `published` flag: every category is listed while it exists. */
function isListed(entity: HistoryEntity, document: RawDocument): boolean {
    if (entity === 'poiCategory') {
        return document !== undefined;
    }
    return document?.['published'] === true && [undefined, 'approved'].includes(document['reviewStatus'] as string | undefined);
}

/** The same value whatever the key order of its maps (Firestore does not promise one). */
function canonical(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(canonical);
    }
    if (typeof value !== 'object' || value === null) {
        return value;
    }
    const record = value as Readonly<Record<string, unknown>>;
    return Object.fromEntries(
        Object.keys(record)
            .toSorted((a, b) => a.localeCompare(b))
            .map((key) => [key, canonical(record[key])]),
    );
}

function sameValue(a: unknown, b: unknown): boolean {
    return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

/** The tab icon's source (an upload or the default) decides the manifest's `city.ownIcon`; its stamps do not. */
function iconSourceChanged(before: RawDocument, after: RawDocument): boolean {
    const source = (document: RawDocument): unknown => (document?.['icon'] as { readonly source?: unknown } | undefined)?.source;
    return source(before) !== source(after);
}

/**
 * True when the write can change the manifest: the document enters or leaves it (published, created or deleted), or
 * it is listed and one of its `MANIFEST_FIELDS` changed.
 */
export function needsManifestBuild(entity: HistoryEntity, before: RawDocument, after: RawDocument): boolean {
    const listed = isListed(entity, after);
    if (isListed(entity, before) !== listed) {
        return true;
    }
    return (
        listed && (MANIFEST_FIELDS[entity].some((field) => !sameValue(before?.[field], after?.[field])) || iconSourceChanged(before, after))
    );
}
