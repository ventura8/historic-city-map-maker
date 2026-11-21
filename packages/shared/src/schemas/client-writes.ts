/**
 * What a signed-in admin may write directly with the Firestore SDK, field by field (every other write goes through a
 * callable or a server trigger). `create` lists the fields a new document may contain, `update` the fields an update
 * may change (`request.resource.data.diff(resource.data).affectedKeys()` in the rules); an empty list means the
 * operation is never allowed from a client. Every field outside these lists is server-owned.
 *
 * `firebase/firestore.rules` mirrors this table and `firebase/rules-tests` imports it, so a field added to a document
 * schema (`firestore.ts`, `firestore-ops.ts`) is added here, to the rules and to their tests in the same change
 * (CR-1 and CR-4 of `docs/research/M1-interfaces.md`, resolved in `docs/research/M2-interfaces.md` §2.3).
 */

/** Every client write stamps who and when (`updatedBy == request.auth.uid`, `updatedAt == request.time`). */
const STAMP = ['updatedBy', 'updatedAt'] as const;

const CITY_EDITABLE = [
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
    'photosOverlay',
    /** M3: auto-publish, its RMSE threshold and the target years (`cityImagerySchema`; CR-M3-2). */
    'imagery',
    /** M28: the sources the map uses (`citySourcesSchema`), saved on their own as the imagery settings are. */
    'sources',
    'published',
    ...STAMP,
] as const;

const PHOTO_EDITABLE = [
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
    'permissionNote',
    'legacyId',
    'links',
    'location',
    'bearing',
    'fov',
    'published',
    'rightsReview',
    /** Street (`ground`, the default) or `aerial` (the owner 2026-11-16). */
    'kind',
    /** M13: the optional credit name. */
    'credit',
    /** Who improved or colorized the photo (the owner 2026-11-09); the versions themselves are `photos.onUpload`'s. */
    'versionCredits',
    ...STAMP,
] as const;

const LAYER_EDITABLE = [
    'label',
    'description',
    'attribution',
    'year',
    'date',
    'order',
    'opacity',
    'defaultVisible',
    'adjustments',
    'published',
    ...STAMP,
] as const;

const POI_EDITABLE = [
    'category',
    'geometry',
    'title',
    'description',
    'yearStart',
    'yearEnd',
    /** M27: plan year when start/end are unknown (traced streets). */
    'yearSeen',
    'links',
    'photoIds',
    /** M13: the optional credit name. */
    'credit',
    /** M27: the layer the place was traced on. */
    'sourceLayer',
    'published',
    ...STAMP,
] as const;

/** M17 (`docs/research/M17-stories.md` §1). */
const STORY_EDITABLE = ['title', 'body', 'yearStart', 'yearEnd', 'photoIds', 'poiIds', 'credit', 'published', ...STAMP] as const;

// M27: the manifest's `defaultVisible`, `pinned` and `attribution` are the editors' too (firestore.rules allows them).
const POI_CATEGORY_EDITABLE = [
    'label',
    'icon',
    'color',
    'defaultOpacity',
    'order',
    'defaultVisible',
    'pinned',
    'attribution',
    ...STAMP,
] as const;

export interface ClientWrites {
    readonly create: readonly string[];
    readonly update: readonly string[];
}

export const CLIENT_WRITES = {
    /** Cities are created and deleted by callables (M5); admins edit the settings. */
    city: { create: [], update: CITY_EDITABLE },
    /**
     * A new photo starts `processing: 'pending'`, unpublished; `photos.onUpload` owns the image fields. M13: an uploader's
     * create of a photo or a place also carries `reviewStatus: 'pending'`, and nobody else's may (`firestore.rules`). A reviewer's
     * update may remove an improved or colorized version from `versions` and nothing else of it.
     */
    photo: { create: [...PHOTO_EDITABLE, 'processing', 'createdAt', 'createdBy'], update: [...PHOTO_EDITABLE, 'versions'] },
    /** Layers are created by the pipeline; admins edit presentation, default opacity and image adjustments. */
    layer: { create: [], update: LAYER_EDITABLE },
    poi: { create: [...POI_EDITABLE, 'createdAt', 'createdBy'], update: POI_EDITABLE },
    poiCategory: { create: [...POI_CATEGORY_EDITABLE, 'createdAt'], update: POI_CATEGORY_EDITABLE },
    /** M17: as a place, an uploader's create carries `reviewStatus: 'pending'`. */
    story: { create: [...STORY_EDITABLE, 'createdAt', 'createdBy'], update: STORY_EDITABLE },
    /**
     * Jobs are created by the callables and triggers that check their parameters, the budget guard, the daily cap and
     * their version in one transaction (`docs/research/M3-interfaces.md` §2.8, CR-M3-2); admins only ask one to stop, or mark a
     * parked frame they place points on (`placingPoints`, review of M18 item 3).
     */
    job: { create: [], update: ['cancelRequested', 'placingPoints', ...STAMP] },
    usgsScene: { create: [], update: ['status', 'note', ...STAMP] },
    /**
     * M4 (`docs/research/M4-interfaces.md` §5.6): `notify.onEvent` creates each admin's inbox items; the admin marks their
     * own read (`read` true, `readAt` the server's time).
     */
    inboxItem: { create: [], update: ['read', 'readAt', ...STAMP] },
    /** M4: each admin's own push settings (`admins/{uid}/notify/settings`); the devices are `notify.registerDevice`'s. */
    notifySettings: { create: ['push', 'pushKinds', 'createdAt', ...STAMP], update: ['push', 'pushKinds', ...STAMP] },
} as const satisfies Readonly<Record<string, ClientWrites>>;

export type ClientCollection = keyof typeof CLIENT_WRITES;
