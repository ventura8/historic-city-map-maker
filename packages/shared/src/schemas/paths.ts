/**
 * Where every document and object lives (`docs/research/M2-interfaces.md` §2.4): the one place that spells a Firestore
 * or Cloud Storage path, shared by the functions, the admin, the rules tests and the e2e seeding. Builders refuse an
 * id that could leave its segment (a `/`, `..`, an empty string): they throw a `RangeError`, which is a programming
 * error, because every caller validates its input with the API schemas first.
 */
import { z } from 'zod';

import { HISTORY_ENTITIES, type HistoryEntity, type PhotoContentType } from './firestore.js';
import { CITY_ID_PATTERN, isId } from './primitives.js';

export { CITY_ID_PATTERN };

export const cityIdSchema = z.string().regex(CITY_ID_PATTERN);

const UID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const MONTH_PATTERN = /^\d{4}-(?:0[1-9]|1[0-2])$/;
const HISTORY_ENTRY_PATTERN = /^\d{13}-[A-Za-z0-9_-]{1,64}$/;

/**
 * M4: a notification event's id (`notificationEventId`): its kind, then one to four id parts separated by `~`
 * (`order.reminder~bucharest~DS1105-1071DF076~7`), so the same event always gets the same id and is written once.
 */
export const NOTIFICATION_ID_PATTERN = /^[a-z][A-Za-z.]{2,30}(?:~[A-Za-z0-9_-]{1,64}){1,4}$/;

/** M4: a push device's id: the first 32 hex digits of the SHA-256 of its FCM registration token. */
export const PUSH_DEVICE_ID_PATTERN = /^[a-f0-9]{32}$/;

/** M4: a reverse-geocoding cache cell (`geocodeCellKey`: the place rounded to 4 decimals, about 11 m). */
export const GEOCODE_KEY_PATTERN = /^[ns]\d{1,6}_[ew]\d{1,7}$/;

function isCityId(value: string): boolean {
    return CITY_ID_PATTERN.test(value);
}

function segment(value: string, valid: (candidate: string) => boolean): string {
    if (!valid(value)) {
        throw new RangeError(`not a valid path segment: ${JSON.stringify(value)}`);
    }
    return value;
}

const matching = (pattern: RegExp) => (value: string) => pattern.test(value);

const cityPath = (cityId: string): string => `cities/${segment(cityId, isCityId)}`;
const adminPath = (uid: string): string => `admins/${segment(uid, matching(UID_PATTERN))}`;
const child = (cityId: string, collection: string, id: string): string => `${cityPath(cityId)}/${collection}/${segment(id, isId)}`;

/** The subcollection of each audited entity under its city (the city itself is the `cities/{city}` document). */
const COLLECTION_OF: Readonly<Record<Exclude<HistoryEntity, 'city'>, string>> = {
    layer: 'layers',
    photo: 'photos',
    poi: 'pois',
    poiCategory: 'poiCategories',
    story: 'stories',
};

/** One audited document (PLAN Addendum 3): what a history entry and `history.revert` name. */
export interface AuditedDocument {
    readonly entity: HistoryEntity;
    readonly cityId: string;
    /** The city id again for the city itself. */
    readonly entityId: string;
}

/** The Firestore path of an audited document. */
export function auditedDocumentPath(document: AuditedDocument): string {
    if (document.entity === 'city') {
        return cityPath(segment(document.entityId, (id) => id === document.cityId));
    }
    return child(document.cityId, COLLECTION_OF[document.entity], document.entityId);
}

function entityOfCollection(collection: string): HistoryEntity | undefined {
    return HISTORY_ENTITIES.find((entity) => entity !== 'city' && COLLECTION_OF[entity] === collection);
}

type Pair = readonly [string, string];
type Quad = readonly [string, string, string, string];

function isPair(parts: readonly string[]): parts is Pair {
    return parts.length === 2;
}

function isQuad(parts: readonly string[]): parts is Quad {
    return parts.length === 4;
}

function cityDocument([root, cityId]: Pair): AuditedDocument | undefined {
    return root === 'cities' && isCityId(cityId) ? { entity: 'city', cityId, entityId: cityId } : undefined;
}

function childDocument([root, cityId, collection, entityId]: Quad): AuditedDocument | undefined {
    const entity = entityOfCollection(collection);
    return root === 'cities' && isCityId(cityId) && entity !== undefined && isId(entityId) ? { entity, cityId, entityId } : undefined;
}

/** The audited document at `path`, or undefined for any other path (a history trigger's document, a revert's target). */
export function parseAuditedDocumentPath(path: string): AuditedDocument | undefined {
    const parts = path.split('/');
    if (isPair(parts)) {
        return cityDocument(parts);
    }
    return isQuad(parts) ? childDocument(parts) : undefined;
}

/** Every Firestore path of the project. */
export const FIRESTORE_PATHS = {
    /** The collection of the city documents (CR-M2-15). */
    cities: 'cities',
    city: cityPath,
    photos: (cityId: string) => `${cityPath(cityId)}/photos`,
    photo: (cityId: string, photoId: string) => child(cityId, 'photos', photoId),
    layers: (cityId: string) => `${cityPath(cityId)}/layers`,
    layer: (cityId: string, layerId: string) => child(cityId, 'layers', layerId),
    pois: (cityId: string) => `${cityPath(cityId)}/pois`,
    poi: (cityId: string, poiId: string) => child(cityId, 'pois', poiId),
    /** M17 (`docs/research/M17-stories.md` §1): the city's stories. */
    stories: (cityId: string) => `${cityPath(cityId)}/stories`,
    story: (cityId: string, storyId: string) => child(cityId, 'stories', storyId),
    poiCategories: (cityId: string) => `${cityPath(cityId)}/poiCategories`,
    poiCategory: (cityId: string, categoryId: string) => child(cityId, 'poiCategories', categoryId),
    jobs: (cityId: string) => `${cityPath(cityId)}/jobs`,
    job: (cityId: string, jobId: string) => child(cityId, 'jobs', jobId),
    jobLogs: (cityId: string, jobId: string) => `${child(cityId, 'jobs', jobId)}/logs`,
    usgsScenes: (cityId: string) => `${cityPath(cityId)}/usgsScenes`,
    usgsScene: (cityId: string, entityId: string) => child(cityId, 'usgsScenes', entityId),
    /** M3: the layer versions (drafts on their way to a layer; `docs/research/M3-interfaces.md` §4.4). */
    layerVersions: (cityId: string) => `${cityPath(cityId)}/layerVersions`,
    layerVersion: (cityId: string, versionId: string) => child(cityId, 'layerVersions', versionId),
    /** M13 (`docs/research/M13-roles.md` §6): role requests (by account), suggestion groups, each account's count and block. */
    roleRequests: (cityId: string) => `${cityPath(cityId)}/roleRequests`,
    roleRequest: (cityId: string, uid: string) => `${cityPath(cityId)}/roleRequests/${uid}`,
    suggestions: (cityId: string) => `${cityPath(cityId)}/suggestions`,
    suggestion: (cityId: string, groupId: string) => child(cityId, 'suggestions', groupId),
    contributors: (cityId: string) => `${cityPath(cityId)}/contributors`,
    contributor: (cityId: string, uid: string) => `${cityPath(cityId)}/contributors/${uid}`,
    /** M8 (`docs/research/M8-join-interfaces.md` §2): the one plan of which frames make each date's whole-city layer. */
    imageryPlan: (cityId: string) => child(cityId, 'imageryPlans', 'dates'),
    /** M9 (`docs/research/M9-calibration.md` §2): a pass's last proved model, the first place to look for its next frame. */
    imageryPasses: (cityId: string) => `${cityPath(cityId)}/imageryPasses`,
    imageryPass: (cityId: string, passKey: string) => child(cityId, 'imageryPasses', passKey),
    /** M20 (`docs/research/M20-import-local.md` §2.4): the local archives' scan reports and a sample of their skipped files. */
    archives: (cityId: string) => `${cityPath(cityId)}/archives`,
    archive: (cityId: string, archiveId: string) => child(cityId, 'archives', archiveId),
    archiveIssues: (cityId: string, archiveId: string) => `${child(cityId, 'archives', archiveId)}/issues`,
    /** M20 (§2.3): a city's sheet grids, learnt once from a series and confirmed by its owner. */
    grids: (cityId: string) => `${cityPath(cityId)}/grids`,
    grid: (cityId: string, gridId: string) => child(cityId, 'grids', gridId),
    /** The `history` subcollection of an audited document (`auditedDocumentPath`). */
    history: (document: AuditedDocument) => `${auditedDocumentPath(document)}/history`,
    historyEntry: (document: AuditedDocument, entryId: string) =>
        `${auditedDocumentPath(document)}/history/${segment(entryId, matching(HISTORY_ENTRY_PATTERN))}`,
    admins: 'admins',
    admin: adminPath,
    /** M4 (docs/research/M4-interfaces.md §5): each admin's inbox, one item per notification event. */
    inbox: (uid: string) => `${adminPath(uid)}/inbox`,
    inboxItem: (uid: string, eventId: string) => `${adminPath(uid)}/inbox/${segment(eventId, matching(NOTIFICATION_ID_PATTERN))}`,
    /** M4: what each admin wants pushed to their devices. */
    notifySettings: (uid: string) => `${adminPath(uid)}/notify/settings`,
    /** M4: the browsers an admin allowed to show notifications (their FCM registration tokens). */
    pushDevices: (uid: string) => `${adminPath(uid)}/pushDevices`,
    pushDevice: (uid: string, deviceId: string) => `${adminPath(uid)}/pushDevices/${segment(deviceId, matching(PUSH_DEVICE_ID_PATTERN))}`,
    /** M4: the notification events the producers write once each, fanned out to every admin's inbox. */
    notificationEvents: 'notificationEvents',
    notificationEvent: (eventId: string) => `notificationEvents/${segment(eventId, matching(NOTIFICATION_ID_PATTERN))}`,
    /** M4 (§4): the reverse-geocoding cache of `assist.suggestTitle`, one cell of about 11 m each. */
    geocodeCells: 'assistGeocodes',
    geocodeCell: (key: string) => `assistGeocodes/${segment(key, matching(GEOCODE_KEY_PATTERN))}`,
    /** M4: the Nominatim cool-down after a refusal (`ops/assist`). */
    assistState: 'ops/assist',
    invites: 'invites',
    invite: (inviteId: string) => `invites/${segment(inviteId, matching(SHA256_PATTERN))}`,
    setupStatus: 'setup/status',
    setupOwner: 'setup/owner',
    usage: (month: string) => `usage/mapbox-${segment(month, matching(MONTH_PATTERN))}`,
    /** M4: the month's Vertex AI requests, tokens and cost (`assist.translateDraft`'s monthly cap). */
    aiUsage: (month: string) => `usage/ai-${segment(month, matching(MONTH_PATTERN))}`,
    opsGuard: 'ops/guard',
    /** M28: where a country's old maps and images can be found, researched and refreshed by `ops.tick` (`country-sources.ts`). */
    countrySources: 'countrySources',
    countrySource: (country: string) => `countrySources/${segment(country, matching(/^[A-Z]{2}$/))}`,
    /** M3: the dispatcher's execution slots (CR-M3-47). */
    opsDispatch: 'ops/dispatch',
    /** M6: the self-test's events probe, answered by `ops.onProbe` (`docs/research/M6-interfaces.md` §3.2). */
    opsProbe: 'ops/probe',
    /** M20: the turnstile of the jobs counted against today's shares (`opsDailyDocSchema`). */
    opsDaily: 'ops/daily',
    /** M3: a city's last USGS harvest attempt (CR-M3-47). */
    harvestState: (cityId: string) => `ops/harvest-${segment(cityId, isCityId)}`,
    manifestStates: 'manifests',
    manifestState: (cityId: string) => `manifests/${segment(cityId, isCityId)}`,
    /** M5 (docs/research/M5-interfaces.md §1.8): a city's month-to-date counters beside the project's. */
    cityUsage: (cityId: string, month: string) => `${cityPath(cityId)}/usage/${segment(month, matching(MONTH_PATTERN))}`,
    /** M5 (§5): a city's static exports, written by `export.start` and `export.build`. */
    cityExports: (cityId: string) => `${cityPath(cityId)}/exports`,
    cityExport: (cityId: string, exportId: string) => child(cityId, 'exports', exportId),
    /** M7 (docs/research/M7-local-worker.md §2.4, §3): a city's local workers (`w-…`) and its remembered run choice (`choice`). */
    workers: (cityId: string) => `${cityPath(cityId)}/workers`,
    worker: (cityId: string, workerId: string) => child(cityId, 'workers', workerId),
    runChoice: (cityId: string) => child(cityId, 'workers', 'choice'),
    /** Finding 67: a city's worker pairings (one-time codes and the sessions made with them) and their attempt limit. */
    pairings: (cityId: string) => `${cityPath(cityId)}/pairings`,
    pairing: (cityId: string, pairId: string) => child(cityId, 'pairings', pairId),
    pairLimit: (cityId: string) => child(cityId, 'pairings', 'limit'),
    /** M7 (§4.2): the month's Cloud Run use of every city's cloud runs (an estimate against the free tier). */
    cloudRunUsage: (month: string) => `usage/cloudrun-${segment(month, matching(MONTH_PATTERN))}`,
} as const;

/** The file extension each accepted photo type is stored with. */
export const PHOTO_EXTENSIONS: Readonly<Record<PhotoContentType, string>> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/tiff': 'tif',
    'image/heic': 'heic',
    'image/heif': 'heif',
};

/** An upload's file name: a client nonce (a new one per upload: Storage never overwrites) and an image extension. */
export const UPLOAD_FILE_PATTERN = /^[A-Za-z0-9_-]{8,64}\.(?:jpe?g|png|webp|tiff?|heic|heif)$/;

export const PHOTO_VARIANTS = ['web', 'thumb'] as const;
export type PhotoVariant = (typeof PHOTO_VARIANTS)[number];

const citySegment = (cityId: string): string => segment(cityId, isCityId);
const idSegment = (id: string): string => segment(id, isId);
const shaSegment = (sha256: string): string => segment(sha256, matching(SHA256_PATTERN));

/** Every Cloud Storage object path; the comment names the bucket (`private`: `<project>.firebasestorage.app`). */
export const STORAGE_PATHS = {
    /** private, written by the admin client: `{photo}` is the id of the photo document created just before. */
    photoUpload: (cityId: string, uid: string, photoId: string, fileName: string) =>
        [
            'uploads/photos',
            citySegment(cityId),
            segment(uid, matching(UID_PATTERN)),
            idSegment(photoId),
            segment(fileName, matching(UPLOAD_FILE_PATTERN)),
        ].join('/'),
    /** private, written by `photos.onUpload`: the original, kept after the upload expires (lifecycle: 7 days). */
    photoOriginal: (cityId: string, photoId: string, sha256: string, contentType: PhotoContentType) =>
        ['originals/photos', citySegment(cityId), idSegment(photoId), `${shaSegment(sha256)}.${PHOTO_EXTENSIONS[contentType]}`].join('/'),
    /** public, immutable: content-hashed by the first 8 hex digits of the original's SHA-256. */
    photoDerivative: (cityId: string, photoId: string, sha256: string, variant: PhotoVariant) =>
        ['photos', citySegment(cityId), idSegment(photoId), shaSegment(sha256).slice(0, 8), `${variant}.webp`].join('/'),
    /** M12: public, immutable: the tiles of one published layer version. */
    layerTiles: (cityId: string, layerId: string, versionId: string) =>
        ['tiles', citySegment(cityId), idSegment(layerId), `${idSegment(versionId)}.pmtiles`].join('/'),
    /** M12: public, every published archive of a layer (a deleted layer's are emptied together). */
    layerTilesPrefix: (cityId: string, layerId: string) => `tiles/${citySegment(cityId)}/${idSegment(layerId)}/`,
    /** private (M13 §2): a pending photo's derivative, until `review.decide` moves or deletes it. */
    reviewHeld: (cityId: string, photoId: string, sha256: string, variant: PhotoVariant) =>
        ['review-held', citySegment(cityId), idSegment(photoId), `${shaSegment(sha256)}-${variant}.webp`].join('/'),
    /** public, `Cache-Control: public, max-age=60`. */
    manifest: (cityId: string) => `cities/${citySegment(cityId)}/manifest.json`,
    /**
     * public, `Cache-Control: public, max-age=300`, fixed names the server overwrites (`cities.setIcon`, the manifest's build):
     * the city's tab icon at `CITY_ICON_SIZES`, which the city's pages link straight to (the page never learns a hash).
     */
    cityIcon: (cityId: string, size: 32 | 180 | 512) => `cities/${citySegment(cityId)}/icon-${String(size)}.png`,
    /**
     * public, written by `cities.setIcon` for an editor's upload only and deleted by Use the default: the uploaded icon
     * at 32 px. A city's pages show it in the tab in place of the default, which they draw in the visitor's theme; its
     * absence is how a page knows the city's icon is the default (the page never reads Firestore).
     */
    cityOwnIcon: (cityId: string) => `cities/${citySegment(cityId)}/icon-own-32.png`,
    /** private, written by `export.build` (M5 §5), deleted by the bucket's lifecycle after `EXPORT_LIMITS.ttlDays`. */
    cityExport: (cityId: string, exportId: string) => ['exports', citySegment(cityId), `${idSegment(exportId)}.zip`].join('/'),
} as const;

/** The parts of a photo upload's path (the `photos.onUpload` trigger reads them from the finalized object's name). */
export interface PhotoUpload {
    readonly cityId: string;
    readonly uid: string;
    readonly photoId: string;
    readonly fileName: string;
}

type Sextet = readonly [string, string, string, string, string, string];

function isSextet(parts: readonly string[]): parts is Sextet {
    return parts.length === 6;
}

function validUpload(upload: PhotoUpload): boolean {
    return [isCityId(upload.cityId), UID_PATTERN.test(upload.uid), isId(upload.photoId), UPLOAD_FILE_PATTERN.test(upload.fileName)].every(
        Boolean,
    );
}

function uploadOf([uploads, photos, cityId, uid, photoId, fileName]: Sextet): PhotoUpload | undefined {
    const upload = { cityId, uid, photoId, fileName };
    return uploads === 'uploads' && photos === 'photos' && validUpload(upload) ? upload : undefined;
}

/** The photo upload at `path`, or undefined for any other object (the trigger ignores those). */
export function parsePhotoUploadPath(path: string): PhotoUpload | undefined {
    const parts = path.split('/');
    return isSextet(parts) ? uploadOf(parts) : undefined;
}

const BUCKET_PATTERN = /^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/;

/** The public https URL of an object in a public bucket (what the manifest and `image.web` carry). */
export function publicObjectUrl(bucket: string, path: string): string {
    return `https://storage.googleapis.com/${segment(bucket, matching(BUCKET_PATTERN))}/${path}`;
}
