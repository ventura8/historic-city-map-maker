/**
 * Points of interest (PLAN Addendum 3): places, buildings, vanished streets, events or notes beyond the photos, each
 * in a city-defined category with an icon and a colour. The manifest carries `poiCategories[]` and `pois[]`; the
 * Firestore documents are in `firestore.ts`. Every POI category is also an overlay with its own opacity
 * (`overlays/model.ts`), so category ids share the overlay namespace with the layer ids and `photos`.
 */
import { z } from 'zod';

import { geometrySchema } from './geometry.js';
import { placeFactsSchema } from './place-facts.js';
import {
    coded,
    hexColorSchema,
    idSchema,
    linkSchema,
    localized,
    localizedMarkdownPartial,
    localizedPartial,
    MAX_LINKS,
    opacitySchema,
    plainText,
    validYearSpan,
    yearSchema,
} from './primitives.js';

export const MAX_POIS = 5000;
export const MAX_POI_CATEGORIES = 50;

/** Photos one POI may show in its detail sheet (ids of manifest photos). */
export const MAX_POI_PHOTOS = 20;

/**
 * Place media (`docs/research/M17-stories.md` §12, the owner 2026-11-22): the places a photo or a small-area map layer
 * belongs to (`placeIds`), at most this many each; the place's sheet lists them under Media by kind.
 */
export const MAX_MEDIA_PLACES = 10;

/** The `placeIds` of a photo or a layer: POI ids, each once. */
export const placeIdsSchema = z
    .array(idSchema)
    .min(1)
    .max(MAX_MEDIA_PLACES)
    .refine((ids) => new Set(ids).size === ids.length, coded('validation.duplicateId'));

/**
 * A building plan's level (`docs/research/M17-stories.md` §14): `order` sorts the levels (-1 a basement, 0 the ground floor,
 * 0.5 a mezzanine, 1 the first floor) and is what an interior photo's `level` names; `label` is what the picker shows.
 */
export const levelOrderSchema = z.number().min(-10).max(200);
export const planLevelSchema = z.strictObject({ order: levelOrderSchema, label: localizedPartial(60) });

/** A Material Symbols icon name (`account_balance`, `church`): lower case letters, digits and underscores. */
export const ICON_NAME_PATTERN = /^[a-z0-9_]{1,64}$/;

/**
 * The Material Symbols the engine bundles for POI categories (the admin's icon picker offers exactly these). A
 * manifest may name any other valid icon; the viewer then draws `DEFAULT_POI_ICON`, so an older engine never refuses a
 * manifest written for a newer icon set.
 */
export const POI_ICONS = [
    'account_balance',
    'add_road',
    'apartment',
    'castle',
    'church',
    'construction',
    'domain',
    'domain_disabled',
    'event',
    'factory',
    'flag',
    'fort',
    'history',
    'home',
    'info',
    'local_hospital',
    'location_on',
    'mosque',
    'museum',
    'park',
    'photo_camera',
    'route',
    'school',
    'stadium',
    'store',
    'synagogue',
    'theater_comedy',
    'train',
    'tram',
    'water',
] as const;

export const DEFAULT_POI_ICON = 'location_on';

export const iconNameSchema = z.string().regex(ICON_NAME_PATTERN);

export const poiCategorySchema = z.strictObject({
    id: idSchema,
    label: localized(100),
    /** A Material Symbols name; one outside `POI_ICONS` is drawn as `DEFAULT_POI_ICON`. */
    icon: iconNameSchema,
    /** `#rrggbb`: the icon background, the line and the fill of the category's POIs. */
    color: hexColorSchema,
    /** The overlay's opacity until the visitor moves its slider (0 to 1). */
    defaultOpacity: opacitySchema,
    /** M27: false starts the overlay hidden (the Disappeared streets); absent or true, shown. */
    defaultVisible: z.boolean().optional(),
    /** M27: listed in the Layers panel's top strip, below Compare and Map labels, above the historical layers. */
    pinned: z.boolean().optional(),
    /** M27: the credit of the category's data (`OpenHistoricalMap (CC0)`), shown while the overlay is visible. */
    attribution: plainText(500).optional(),
});

export const poiSchema = z
    .strictObject({
        id: idSchema,
        /** The id of one of the manifest's `poiCategories`. */
        category: idSchema,
        geometry: geometrySchema,
        title: localizedPartial(200),
        /** Markdown subset (`text/markdown.ts`), https links only. */
        description: localizedMarkdownPartial(5000).optional(),
        yearStart: yearSchema.optional(),
        yearEnd: yearSchema.optional(),
        /**
         * M27: the year of the plan the place was traced on when its lifespan (`yearStart` / `yearEnd`) is unknown
         * (a disappeared street proved only on that plan).
         */
        yearSeen: yearSchema.optional(),
        links: z.array(linkSchema).max(MAX_LINKS),
        /** Manifest photo ids shown in the POI's detail sheet. */
        photoIds: z.array(idSchema).max(MAX_POI_PHOTOS).optional(),
        /** M13: the name its contributor asked to be credited under. */
        credit: plainText(100).optional(),
        /** M27: the id of the manifest layer the POI was traced on (a disappeared street seen on the map of 1911). */
        sourceLayer: idSchema.optional(),
        /**
         * A sub-group of the category (bridges, lakes, ponds, islands of the old rivers; the owner, 2026-11-22), set by an
         * import: the Layers panel lists one switch per group under its category. Any short text.
         */
        group: plainText(60).optional(),
        /** Structured facts (M17 §13): architect, years, style, floors, uses, LMI code, addresses, related places. */
        facts: placeFactsSchema.optional(),
    })
    .refine(validYearSpan, coded('validation.yearRange', ['yearEnd']));

/** The photos overlay (markers and view cones) as a whole. */
export const photosOverlaySchema = z.strictObject({ defaultOpacity: opacitySchema });

export type PoiCategory = z.infer<typeof poiCategorySchema>;
export type Poi = z.infer<typeof poiSchema>;
export type PhotosOverlay = z.infer<typeof photosOverlaySchema>;
export type PoiIcon = (typeof POI_ICONS)[number];
