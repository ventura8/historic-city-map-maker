/**
 * Firestore content documents (PLAN → Data, Addendum 3): the city, its photos, layers, POIs and POI categories, and the
 * `history` entries of every one of them. The operational documents (jobs, setup, admins, invitations, usage, the
 * guard, manifest builds) are in `firestore-ops.ts`; the paths of both in `paths.ts`.
 *
 * Every server writer (Cloud Functions, the raster pipeline through its own models) validates with these before
 * writing, because the Admin SDK bypasses the rules; `firebase/firestore.rules` checks the client-writable subset,
 * which `CLIENT_WRITES` (`client-writes.ts`) lists field by field. Firestore stores no nested arrays, so boxes are
 * `{west, south, east, north}` and positions `{lat, lng}` here, unlike the manifest. Final in M2
 * (`docs/research/M2-interfaces.md` §2); a change is a change request.
 */
import { z } from 'zod';

import { apiErrorCodeSchema } from '../api/errors.js';
import { sha256Schema, stamp, timestampSchema, uidSchema } from './firestore-common.js';
import { geometryDocSchema } from './geometry.js';
import { cityImagerySchema, JOIN_MAX_PARTS } from './imagery-settings.js';
import { citySourcesSchema } from './sources.js';
import {
    analyticsSchema,
    basemapSchema,
    creditSchema,
    layerAdjustmentsSchema,
    layerSourceSchema,
    LICENSES,
    themeSchema,
    LAYER_KINDS,
    PHOTO_KINDS,
} from './manifest.js';
import { ARCHIVE_PLACE_METHODS, layerRightsSchema } from './imagery-archive.js';
import { placeFactsSchema } from './place-facts.js';
import { iconNameSchema, levelOrderSchema, MAX_POI_PHOTOS, photosOverlaySchema, placeIdsSchema, planLevelSchema } from './poi.js';
import { heldImageSchema, reviewFields } from './review.js';
import { localizedStorySchema, storyFields } from './story.js';
import {
    assetUrlSchema,
    bearingSchema,
    boundsRecordSchema,
    coded,
    fovSchema,
    viewedAreaSchema,
    hexColorSchema,
    httpsUrlSchema,
    idSchema,
    isoDateSchema,
    latLngSchema,
    linkSchema,
    localizedMarkdownPartial,
    localizedPartial,
    mapboxPublicTokenSchema,
    MAX_LINKS,
    opacitySchema,
    plainText,
    storedViewedAreaSchema,
    validYearRange,
    validYearSpan,
    versionSchema,
    yearSchema,
    zoomSchema,
} from './primitives.js';
import { daySchema, monthSchema, withPhotoDate } from './photo-date.js';

/** The photo licences Firestore accepts: the published ones plus `unknown`, which cannot be published. */
export const FIRESTORE_LICENSES = [...LICENSES, 'unknown'] as const;
export const PROCESSING_STATES = ['pending', 'done', 'failed'] as const;
export const LAYER_STATUSES = ['draft', 'processing', 'awaiting_approval', 'ready', 'failed'] as const;
/** The declassified datasets (Declass 1, 2 and 3): scans of film, georeferenced by the pipeline. */
export const DECLASS_DATASETS = ['corona2', 'declassii', 'declassiii'] as const;
/**
 * M25 (`docs/research/M25-landsat.md`): Landsat Collection 2 Level-1 over the same M2M API: Landsat 4-5 TM (30 m, 1982-2013),
 * Landsat 7 ETM+ (15 m panchromatic, from 1999) and Landsat 8-9 OLI (`landsat_ot_c2_l1`, 15 m panchromatic, from 2013), already
 * georeferenced and public domain.
 */
export const LANDSAT_DATASETS = ['landsat_tm_c2_l1', 'landsat_etm_c2_l1', 'landsat_ot_c2_l1'] as const;
export const USGS_DATASETS = [...DECLASS_DATASETS, ...LANDSAT_DATASETS] as const;
/** How a layer was georeferenced: the scene's corners, the admin's points, the automatic matcher, or an upload's own (M3). */
export const GEOREF_METHODS = ['corners', 'gcps', 'auto', 'embedded'] as const;
/**
 * How a layer's tiles reached Mapbox (M3): our MTS publish, the admin's free Studio upload, or `layers.link`; M7
 * (`docs/research/M7-local-worker.md` §6): our publish through Mapbox's Uploads API.
 */
export const LAYER_TILESET_ORIGINS = ['mts', 'studio', 'linked', 'uploads'] as const;
/** The audited, admin-editable documents (PLAN Addendum 3): each keeps a `history` subcollection. */
/** M17 (`docs/research/M17-stories.md` §2): `story` joins them. */
export const HISTORY_ENTITIES = ['city', 'layer', 'photo', 'poi', 'poiCategory', 'story'] as const;
export const HISTORY_ACTIONS = ['create', 'update', 'delete', 'revert'] as const;
/** What an admin may upload as a photo (`firebase/storage.rules`); the server sniffs the bytes, never trusts this. */
export const PHOTO_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/tiff', 'image/heic', 'image/heif'] as const;

const cityText = localizedMarkdownPartial(10_000);

/** A Mapbox token id (`authorization` of the Tokens API), never the token itself. */
export const mapboxTokenIdSchema = z.string().regex(/^[a-z0-9]{1,64}$/);

/** An https origin without a path (`https://ventura8.github.io`): what a URL-restricted Mapbox token allows. */
export const httpsOriginSchema = z.string().regex(/^https:\/\/[a-z0-9.-]{1,253}(?::\d{1,5})?$/);

/** `cities/{city}`. `id`, `mapbox`, `analytics`, `engine` and `createdAt` are server-owned. */
export const cityDocSchema = z.strictObject({
    id: idSchema.optional(),
    name: localizedPartial(100),
    bounds: boundsRecordSchema,
    center: latLngSchema.optional(),
    zoom: zoomSchema.optional(),
    minZoom: zoomSchema.optional(),
    maxZoom: zoomSchema.optional(),
    about: cityText.optional(),
    privacy: cityText.optional(),
    credits: z.array(creditSchema).max(50).optional(),
    theme: themeSchema.optional(),
    basemap: basemapSchema.optional(),
    /** Written by `setup.saveMapbox` and `setup.rotatePublicToken`: the viewer's URL-restricted public token. */
    mapbox: z
        .strictObject({
            user: z.string().max(64).optional(),
            publicToken: mapboxPublicTokenSchema.optional(),
            publicTokenId: mapboxTokenIdSchema.optional(),
            allowedUrls: z.array(httpsOriginSchema).max(10).optional(),
        })
        .optional(),
    /** Written by `setup.analyticsConfig` (GA4 ids from the Firebase Management API) and the crash endpoint. */
    analytics: analyticsSchema.optional(),
    engine: z.strictObject({ minVersion: versionSchema.optional() }).optional(),
    /** Defaults of the photos overlay (PLAN Addendum 3), copied into the manifest. */
    photosOverlay: photosOverlaySchema.optional(),
    /** M3: auto-publish, its RMSE threshold, the target years (`imagery-settings.ts`). */
    imagery: cityImagerySchema.optional(),
    /** M28 (`docs/research/M28-sources.md`): the sources the map uses, chosen on Setup's Sources step; absent: not chosen yet. */
    sources: citySourcesSchema.optional(),
    /**
     * M5 (`docs/research/M5-interfaces.md` §1.8): the city's share of the project's budgets, server-owned (written by
     * `cities.create` and `cities.setLimits`, whose `cityLimitsSchema` holds the upper bounds); absent, the project's own
     * caps alone hold the city.
     */
    limits: z
        .strictObject({
            computeUnitsPerMonth: z.number().min(0),
            rasterJobsPerDay: z.number().int().min(0),
            aiRequestsPerMonth: z.number().int().min(0),
            geocodeCellsPerDay: z.number().int().min(0),
            exportsPerDay: z.number().int().min(0),
        })
        .optional(),
    /**
     * The city's tab icon (`docs/research/M2-interfaces.md` → *The city's tab icon*), server-owned: written by
     * `cities.setIcon` and the manifest's build (the default, in the city's seed colour, `seedColor`), never by a client.
     * The files are `STORAGE_PATHS.cityIcon`; `url` is the 180 px one (the admin's preview), `sha256` the source's (the
     * upload's bytes, or the default's SVG).
     */
    icon: z
        .strictObject({
            source: z.enum(['default', 'custom']),
            seedColor: hexColorSchema.optional(),
            url: httpsUrlSchema,
            sha256: sha256Schema,
            ...stamp,
        })
        .optional(),
    published: z.boolean(),
    createdAt: timestampSchema.optional(),
    ...stamp,
});

const photoImageDocSchema = z.strictObject({
    /** https URLs of the content-hashed derivatives in the public bucket (`STORAGE_PATHS.photoDerivative`). */
    web: assetUrlSchema,
    thumb: assetUrlSchema,
    /** SHA-256 of the original upload: the duplicate check and the derivative paths use it. */
    sha256: sha256Schema,
    w: z.number().int().min(1).max(20_000),
    h: z.number().int().min(1).max(20_000),
});

/** The original upload, kept in the private bucket (`STORAGE_PATHS.photoOriginal`): uploads/ expire after 7 days. */
/** M13: a direction or a field of view means nothing without a place. */
function aimedOnlyIfPlaced(photo: {
    readonly location?: unknown;
    readonly bearing?: unknown;
    readonly fov?: unknown;
    readonly viewedArea?: unknown;
}): boolean {
    return photo.location !== undefined || (photo.bearing === undefined && photo.fov === undefined && photo.viewedArea === undefined);
}

const photoOriginalDocSchema = z.strictObject({
    path: z.string().min(1).max(1024),
    contentType: z.enum(PHOTO_CONTENT_TYPES),
    bytes: z.number().int().min(1),
    sha256: sha256Schema,
});

/** An improved or colorized version (the owner 2026-11-09): its derivatives and its original, as `image` and `original` are. */
const photoVersionDocSchema = z.strictObject({ image: photoImageDocSchema, original: photoOriginalDocSchema });

/** The latest finalized upload seen for one slot (`photos.onUpload`), so an older upload never overwrites a newer one. */
const photoLatestUploadSchema = z.strictObject({
    upload: z.string().min(1).max(1024),
    at: timestampSchema,
});

/** What `photos.onUpload` read from the file (EXIF, file name); the admin accepts a suggestion with one click. */
const photoSuggestionsSchema = z.strictObject({
    location: latLngSchema.optional(),
    year: yearSchema.optional(),
    bearing: bearingSchema.optional(),
    title: plainText(200).optional(),
});

/**
 * A refused replacement of a photo that already has an image (`docs/research/M2c-interfaces.md` §6.4, CR-M2c-4): the
 * image stays published and this records why the new file was refused; the next successful processing removes it.
 */
const photoReplacementSchema = z.strictObject({
    error: apiErrorCodeSchema,
    at: timestampSchema,
    /** The photo the refused file repeats (`apiError.photo.duplicate`). */
    duplicateOf: idSchema.optional(),
});

/**
 * `cities/{city}/photos/{photo}`. `image`, `exif`, `processing`, `processingError`, `duplicateOf`, `suggested`,
 * `original` and `replacement` are owned by `photos.onUpload`; `createdAt` and `createdBy` are set once by the client
 * that creates it.
 */
/** The photo document, its viewed area checked by `viewedArea` (convex on save and publish, any four corners on read). */
const photoDocObject = (viewedArea: typeof storedViewedAreaSchema) =>
    z
    .strictObject({
        /** Absent on a street photo; `aerial` on a photo taken from above (Imagery → aerial photos, the owner 2026-11-16). */
        kind: z.enum(PHOTO_KINDS).optional(),
        /** The places whose Media list the photo (M17 §12, the owner 2026-11-22). */
        placeIds: placeIdsSchema.optional(),
        /** An interior photo's level (M17 §14). */
        level: levelOrderSchema.optional(),
        title: localizedPartial(200),
        description: localizedPartial(5000).optional(),
        year: yearSchema.optional(),
        yearEnd: yearSchema.optional(),
        /** The date's precision beyond the year (`docs/research/photo-date-source.md`). */
        month: monthSchema.optional(),
        day: daySchema.optional(),
        /** The legacy dating as written (`Iulie 1936`), shown when present (CR-1). */
        dateText: localizedPartial(100).optional(),
        author: plainText(200).optional(),
        license: z.enum(FIRESTORE_LICENSES),
        rightsHolder: plainText(200).optional(),
        sourceUrl: httpsUrlSchema.optional(),
        sourceLabel: plainText(200).optional(),
        permissionNote: plainText(2000).optional(),
        legacyId: plainText(64).optional(),
        links: z.array(linkSchema).max(MAX_LINKS).optional(),
        /** M13: absent while the photo waits for a place (`docs/research/M13-roles.md` §5); the map lists it apart. */
        location: latLngSchema.optional(),
        bearing: bearingSchema.optional(),
        fov: fovSchema.optional(),
        /** An aerial photo's ground footprint: four corners, a rectangle or a trapezoid (the owner 2026-11-22). */
        viewedArea: viewedArea.optional(),
        published: z.boolean(),
        rightsReview: z.boolean().optional(),
        image: photoImageDocSchema.optional(),
        exif: z.record(z.string().max(64), z.union([z.string().max(500), z.number()])).optional(),
        processing: z.enum(PROCESSING_STATES),
        /** Why the last processing failed (`apiError.photo.*`), set with `processing: 'failed'`. */
        processingError: apiErrorCodeSchema.optional(),
        /** The photo whose original has the same SHA-256 (flagged, never processed twice: S-A08-BAD-DUPLICATE). */
        duplicateOf: idSchema.optional(),
        suggested: photoSuggestionsSchema.optional(),
        original: photoOriginalDocSchema.optional(),
        replacement: photoReplacementSchema.optional(),
        /**
         * The improved and colorized versions, written by `photos.onUpload` from an upload whose metadata names the version; a
         * reviewer may only remove one (`firestore.rules`). Their credits are the admin's `versionCredits`.
         */
        versions: z.strictObject({ improved: photoVersionDocSchema.optional(), colorized: photoVersionDocSchema.optional() }).optional(),
        versionCredits: z.strictObject({ improved: plainText(200).optional(), colorized: plainText(200).optional() }).optional(),
        /**
         * The latest finalized upload per slot (`photos.onUpload`), so an older upload finishing late never overwrites a
         * newer image or version.
         */
        latestUploads: z
            .strictObject({
                image: photoLatestUploadSchema.optional(),
                improved: photoLatestUploadSchema.optional(),
                colorized: photoLatestUploadSchema.optional(),
            })
            .optional(),
        /** M13: a pending photo's derivatives, in the private bucket until `review.decide` moves them. */
        heldImage: heldImageSchema.optional(),
        ...reviewFields,
        createdAt: timestampSchema.optional(),
        createdBy: uidSchema.optional(),
        ...stamp,
    })
    .refine(validYearRange, coded('validation.yearRange', ['yearEnd']))
    .refine(aimedOnlyIfPlaced, coded('validation.reference', ['bearing']));

export const photoDocSchema = withPhotoDate(photoDocObject(viewedAreaSchema));

/** A photo as the admin reads it: a crossed viewed area still opens, for the editor to say why it cannot be saved. */
export const storedPhotoDocSchema = withPhotoDate(photoDocObject(storedViewedAreaSchema));

/**
 * `cities/{city}/layers/{layer}`: a layer that has tiles. Created by `layers.link` or, in M3, by the publish of its first
 * layer version (`layerVersions`, stamped `system:imagery`); admins edit the presentation fields, the default opacity and
 * the image adjustments.
 */
export const layerDocSchema = z.strictObject({
    year: yearSchema,
    date: isoDateSchema.optional(),
    label: localizedPartial(200),
    description: localizedPartial(5000).optional(),
    kind: z.enum(LAYER_KINDS),
    sensor: plainText(100).optional(),
    attribution: plainText(500).optional(),
    source: layerSourceSchema,
    minzoom: zoomSchema,
    maxzoom: zoomSchema,
    bounds: boundsRecordSchema.optional(),
    order: z.number().int(),
    opacity: opacitySchema,
    defaultVisible: z.boolean(),
    adjustments: layerAdjustmentsSchema.optional(),
    /** A small-area map's places (M17 §12): their sheets list the layer under Media, Maps. */
    placeIds: placeIdsSchema.optional(),
    /** A building plan's level (M17 §14). */
    level: planLevelSchema.optional(),
    /** M20 (`docs/research/M20-import-local.md` §7): an archive map's licence, author and source, copied into the manifest. */
    rights: layerRightsSchema.optional(),
    status: z.enum(LAYER_STATUSES),
    published: z.boolean(),
    provenance: z
        .strictObject({
            usgsEntityId: z.string().max(64).optional(),
            usgsDataset: z.enum(USGS_DATASETS).optional(),
            /** M8: every frame of a joined layer; `usgsEntityId` is then the first, so the layer stays exportable. */
            usgsParts: z.array(z.string().max(64)).max(JOIN_MAX_PARTS).optional(),
            georef: z
                .strictObject({
                    method: z.enum(GEOREF_METHODS),
                    gcpCount: z.number().int().min(0).max(300).optional(),
                    checkpointRmseM: z.number().min(0).optional(),
                })
                .optional(),
            /** Batch 4: how an archive series was placed; `grid-names` with `approvedBy: 'owner'` when its owner approved it by hand. */
            archive: z.strictObject({ method: z.enum(ARCHIVE_PLACE_METHODS), approvedBy: z.literal('owner').optional() }).optional(),
        })
        .optional(),
    mapbox: z
        .strictObject({
            tilesetId: z.string().max(100),
            publishedSourceSha: sha256Schema.optional(),
            /** M3: the MTS tileset source (`<user>/<id>`'s id), deleted with the tileset. */
            sourceId: z.string().max(100).optional(),
            origin: z.enum(LAYER_TILESET_ORIGINS).optional(),
        })
        .optional(),
    /** M3: the layer version whose tiles the layer shows (its scan and points are the georeferencer's start). */
    currentVersion: idSchema.optional(),
    /** M3: a newer version under way or waiting for approval; the layer keeps its tiles until that one is published. */
    pendingVersion: idSchema.optional(),
    /**
     * Batch 4 (`docs/research/M8-join-interfaces.md` §5.1): the published join of its date that replaced this frame's layer (`by`, its
     * version) and when; the layer left the manifest, its tiles and versions are kept until the owner deletes it.
     */
    retired: z.strictObject({ by: idSchema, at: timestampSchema }).optional(),
    createdAt: timestampSchema.optional(),
    ...stamp,
});

/** `cities/{city}/poiCategories/{category}`: edited in the city settings; the manifest lists them by `order`. */
export const poiCategoryDocSchema = z.strictObject({
    label: localizedPartial(100),
    icon: iconNameSchema,
    color: hexColorSchema,
    defaultOpacity: opacitySchema,
    /** M27 (`docs/research/M27-lost-streets.md`): the manifest's `defaultVisible`, `pinned` and `attribution`. */
    defaultVisible: z.boolean().optional(),
    pinned: z.boolean().optional(),
    attribution: plainText(500).optional(),
    order: z.number().int(),
    createdAt: timestampSchema.optional(),
    ...stamp,
});

/** `cities/{city}/pois/{poi}`: drawn and edited by admins; the geometry has no nested arrays (`geometry.ts`). */
export const poiDocSchema = z
    .strictObject({
        category: idSchema,
        geometry: geometryDocSchema,
        title: localizedPartial(200),
        description: localizedMarkdownPartial(5000).optional(),
        yearStart: yearSchema.optional(),
        yearEnd: yearSchema.optional(),
        /** M27: plan year when the place has no known start/end (traced on that year's map). */
        yearSeen: yearSchema.optional(),
        links: z.array(linkSchema).max(MAX_LINKS).optional(),
        photoIds: z.array(idSchema).max(MAX_POI_PHOTOS).optional(),
        /** M27: the layer the place was traced on (the manifest drops it when that layer is not listed). */
        sourceLayer: idSchema.optional(),
        /** A sub-group of the category (an import's `group`: bridges, lakes…), its own switch in the Layers panel. */
        group: plainText(60).optional(),
        /** Structured facts (M17 §13); the manifest drops related places it does not list. */
        facts: placeFactsSchema.optional(),
        published: z.boolean(),
        ...reviewFields,
        createdAt: timestampSchema.optional(),
        createdBy: uidSchema.optional(),
        ...stamp,
    })
    .refine(validYearSpan, coded('validation.yearRange', ['yearEnd']));

/**
 * M17 (`docs/research/M17-stories.md` §1): `cities/{city}/stories/{story}`. The body may wait while a draft; a published
 * story without one is not listed (the builder skips it, the editor says so).
 */
export const storyDocSchema = z
    .strictObject({
        ...storyFields,
        body: localizedStorySchema.optional(),
        published: z.boolean(),
        ...reviewFields,
        createdAt: timestampSchema.optional(),
        createdBy: uidSchema.optional(),
        ...stamp,
    })
    .refine(validYearSpan, coded('validation.yearRange', ['yearEnd']));

/** A document as it was, keyed by field (validated again with its entity's schema before a revert writes it). */
const snapshotSchema = z
    .record(z.string().min(1).max(64), z.unknown())
    .refine((snapshot) => Object.keys(snapshot).length <= 100, coded('validation.tooBig'));

/**
 * `<audited document>/history/{entry}`, for example `cities/{city}/pois/{poi}/history/{entry}` (and
 * `cities/{city}/history/{entry}` for the city itself). Written by the `history.onWrite` triggers on every change of
 * an audited document, never by a client: `previous` is the version before the change (none for a create), and the
 * stamp is the change's own (for a delete, the deleting identity of the event's auth context). `history.revert`
 * writes the restored document and its own `revert` entry (`revertOf`; `previous` is null when it restores a deleted
 * document) in one transaction, and the trigger skips that change. Entry ids sort by time (`historyEntryId`); the
 * newest `HISTORY_KEEP` entries per document are kept. `cityId` names the city the audited document belongs to, so the
 * admin's recent changes ask one city's entries of the collection group (CR-M2c-14); every writer stamps it, and only an
 * entry written before it (none exists outside the emulators) lacks it, which then shows in its document's versions
 * alone.
 */
export const historyEntryDocSchema = z
    .strictObject({
        cityId: idSchema.optional(),
        entity: z.enum(HISTORY_ENTITIES),
        entityId: idSchema,
        action: z.enum(HISTORY_ACTIONS),
        previous: snapshotSchema.nullable(),
        changedFields: z.array(z.string().min(1).max(64)).max(100),
        /** The history entry whose `previous` a revert restored. */
        revertOf: z.string().min(1).max(128).optional(),
        ...stamp,
    })
    .refine(
        (entry) => entry.action === 'revert' || (entry.action === 'create') === (entry.previous === null),
        coded('validation.value', ['previous']),
    )
    .refine((entry) => (entry.action === 'revert') === (entry.revertOf !== undefined), coded('validation.value', ['revertOf']));

export type CityDoc = z.infer<typeof cityDocSchema>;
export type PhotoDoc = z.infer<typeof photoDocSchema>;
export type LayerDoc = z.infer<typeof layerDocSchema>;
export type PoiCategoryDoc = z.infer<typeof poiCategoryDocSchema>;
export type PoiDoc = z.infer<typeof poiDocSchema>;
export type StoryDoc = z.infer<typeof storyDocSchema>;
export type HistoryEntryDoc = z.infer<typeof historyEntryDocSchema>;
export type HistoryEntity = (typeof HISTORY_ENTITIES)[number];
export type HistoryAction = (typeof HISTORY_ACTIONS)[number];
export type FirestoreLicense = (typeof FIRESTORE_LICENSES)[number];
export type PhotoContentType = (typeof PHOTO_CONTENT_TYPES)[number];
export type GeorefMethod = (typeof GEOREF_METHODS)[number];
