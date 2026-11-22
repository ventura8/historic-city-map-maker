/**
 * The public City Manifest v1: the only data the viewer reads (docs/ENGINE_API.md → Manifest v1).
 * Built by the manifest builder (M2) or the legacy migration (`seed/bucharest/manifest.static.json`),
 * served as static JSON, validated by the engine before anything is rendered.
 */
import { z } from 'zod';

import { bboxContains } from '../geo/bbox.js';
import { isCspOrigin, isHttpsUrl } from '../text/urls.js';
import { manifestRuleIssues } from './manifest-rules.js';
import { photosOverlaySchema, poiCategorySchema, poiSchema, MAX_POI_CATEGORIES, MAX_POIS } from './poi.js';
import {
    assetUrlSchema,
    bboxSchema,
    bearingSchema,
    coded,
    firebaseAppIdsSchema,
    fovSchema,
    hexColorSchema,
    httpsUrlSchema,
    idSchema,
    isoDateSchema,
    latLngSchema,
    linkSchema,
    lngLatSchema,
    localized,
    localizedMarkdown,
    localizedPartial,
    mapboxPublicTokenSchema,
    MAX_LINKS,
    measurementIdSchema,
    opacitySchema,
    plainText,
    tokenMapSchema,
    validYearRange,
    versionSchema,
    yearSchema,
    zoomSchema,
} from './primitives.js';
import { daySchema, monthSchema, withPhotoDate } from './photo-date.js';
import { MAX_STORIES, storySchema } from './story.js';
import { wikipediaRefSchema } from './wikipedia.js';

/** The `version` every v1 manifest carries; a different value is refused before validation. */
export const MANIFEST_VERSION = 1;

/** Photo licences that may be published (`unknown` exists only in Firestore and is never published). */
export const LICENSES = ['CC0', 'CC-BY-4.0', 'CC-BY-SA-4.0', 'PD', 'permission', 'permission-legacy'] as const;

export const LAYER_KINDS = ['satellite', 'aerial', 'map'] as const;

/** The four generated colour schemes of a city theme. */
export const THEME_SCHEMES = ['light', 'dark', 'highContrastLight', 'highContrastDark'] as const;

export const MAX_LAYERS = 300;
export const MAX_PHOTOS = 5000;

const MAPBOX_STYLE = /^mapbox:\/\/styles\/[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9_-]{1,64}$/;
const TILESET_ID = /^[a-z0-9_-]{1,32}\.[A-Za-z0-9_-]{1,64}$/;
const STYLE_CONFIG_KEY = /^[A-Za-z][A-Za-z0-9]{0,40}$/;

export const creditSchema = z.strictObject({ label: localized(300), url: httpsUrlSchema.optional() });

export const themeSchema = z.strictObject({
    seedColor: hexColorSchema,
    tokens: z.strictObject({
        light: tokenMapSchema,
        dark: tokenMapSchema,
        highContrastLight: tokenMapSchema,
        highContrastDark: tokenMapSchema,
    }),
});

/** An https style address whose origin a page's policy can name: a host with `;` or `'` is refused (`isCspOrigin`). */
function isHttpsStyle(style: string): boolean {
    return isHttpsUrl(style) && isCspOrigin(new URL(style).origin);
}

export const basemapSchema = z.strictObject({
    /** `mapbox://styles/<owner>/<style>` or an https style URL. */
    style: z
        .string()
        .max(2048)
        .refine((style) => MAPBOX_STYLE.test(style) || isHttpsStyle(style), coded('validation.format')),
    /** Mapbox Standard configuration properties (`lightPreset`, `show3dObjects`, ...), set on the `basemap` import. */
    config: z
        .record(z.string().regex(STYLE_CONFIG_KEY), z.union([z.string().max(64), z.number(), z.boolean()]))
        .refine((config) => Object.keys(config).length <= 30, coded('validation.tooBig'))
        .optional(),
});

/** GA4 (loaded only after consent) and the crash-report endpoint (`telemetry.reportError`). */
export const analyticsSchema = z.strictObject({
    measurementId: measurementIdSchema.optional(),
    errorEndpoint: httpsUrlSchema.optional(),
    firebase: firebaseAppIdsSchema.optional(),
});

export const citySchema = z
    .strictObject({
        id: idSchema,
        name: localized(100),
        center: lngLatSchema,
        zoom: zoomSchema,
        minZoom: zoomSchema,
        maxZoom: zoomSchema,
        bounds: bboxSchema,
        about: localizedMarkdown(10_000),
        credits: z.array(creditSchema).max(50),
        privacy: localizedMarkdown(10_000),
        theme: themeSchema,
        basemap: basemapSchema,
        /** The URL-restricted public token of the viewer. */
        mapbox: z.strictObject({ publicToken: mapboxPublicTokenSchema }),
        analytics: analyticsSchema,
        engine: z.strictObject({ minVersion: versionSchema.optional() }).optional(),
        /** True when an editor uploaded the city's tab icon, so `icon-own-32.png` exists (`docs/ENGINE_API.md` → *The page's tab icon*). */
        ownIcon: z.literal(true).optional(),
    })
    .refine((city) => city.minZoom <= city.zoom && city.zoom <= city.maxZoom, coded('validation.zoomRange', ['zoom']))
    .refine((city) => bboxContains(city.bounds, city.center), coded('validation.centerOutside', ['center']));

const tileTemplateSchema = httpsUrlSchema.refine(
    (template) => ['{z}', '{x}', '{y}'].every((part) => template.includes(part)),
    coded('validation.tileTemplate'),
);

export const layerSourceSchema = z.discriminatedUnion('type', [
    z.strictObject({ type: z.literal('mapbox'), tilesetId: z.string().regex(TILESET_ID) }),
    z.strictObject({
        type: z.literal('xyz'),
        tiles: z.array(tileTemplateSchema).min(1).max(4),
        tileSize: z.union([z.literal(256), z.literal(512)]),
    }),
    z.strictObject({ type: z.literal('pmtiles'), url: assetUrlSchema }),
]);

/**
 * The ranges and neutral values of the raster image adjustments (Mapbox `raster-brightness-min/max`, `raster-contrast`,
 * `raster-saturation`). The schema refuses a value outside its range; `rasterAdjustmentPaint` clamps live slider values.
 */
export const LAYER_ADJUSTMENT_RANGES = {
    brightnessMin: { min: 0, max: 1, neutral: 0 },
    brightnessMax: { min: 0, max: 1, neutral: 1 },
    contrast: { min: -1, max: 1, neutral: 0 },
    saturation: { min: -1, max: 1, neutral: 0 },
} as const;

export type LayerAdjustmentName = keyof typeof LAYER_ADJUSTMENT_RANGES;

function adjustmentSchema(name: LayerAdjustmentName) {
    const range = LAYER_ADJUSTMENT_RANGES[name];
    return z.number().min(range.min).max(range.max).optional();
}

/** Raster paint adjustments applied live by the viewer (PLAN Addendum 3); brightness min never above max. */
export const layerAdjustmentsSchema = z
    .strictObject({
        brightnessMin: adjustmentSchema('brightnessMin'),
        brightnessMax: adjustmentSchema('brightnessMax'),
        contrast: adjustmentSchema('contrast'),
        saturation: adjustmentSchema('saturation'),
    })
    .refine((adjust) => (adjust.brightnessMin ?? 0) <= (adjust.brightnessMax ?? 1), coded('validation.value', ['brightnessMax']));

export const layerSchema = z
    .strictObject({
        id: idSchema,
        year: yearSchema,
        date: isoDateSchema.optional(),
        label: localized(200),
        description: localized(5000).optional(),
        kind: z.enum(LAYER_KINDS),
        sensor: plainText(100).optional(),
        attribution: plainText(500),
        source: layerSourceSchema,
        minzoom: zoomSchema,
        maxzoom: zoomSchema,
        bounds: bboxSchema.optional(),
        order: z.number().int(),
        defaultVisible: z.boolean(),
        opacity: opacitySchema,
        adjustments: layerAdjustmentsSchema.optional(),
    })
    .refine((layer) => layer.minzoom <= layer.maxzoom, coded('validation.zoomRange', ['maxzoom']))
    .refine((layer) => layer.date === undefined || layer.date.startsWith(String(layer.year)), coded('validation.value', ['date']));

const photoImageSchema = z.strictObject({
    web: assetUrlSchema,
    thumb: assetUrlSchema,
    w: z.number().int().min(1).max(20_000),
    h: z.number().int().min(1).max(20_000),
});

/**
 * The ways a photo can be shown (the owner 2026-11-09): `original` is `image`; `improved` (restored) and `colorized` are
 * optional `versions`, each with the credit of whoever made it. The viewer shows `improved` when there is one, else the
 * original; `colorized` only when the visitor picks it (`pv=` in the URL hash).
 */
export const PHOTO_VIEWS = ['original', 'improved', 'colorized'] as const;

const photoVersionSchema = photoImageSchema.extend({ credit: plainText(200).optional() });

/** Where the photo comes from: an https address and, optionally, its name. */
const photoSourceSchema = z.strictObject({ url: httpsUrlSchema, label: plainText(200).optional() });

/**
 * What a photo shows (the owner, 2026-11-16): `ground`, taken on the street (the default, so a photo without `kind` is
 * one), or `aerial`, taken from above (Imagery → aerial photos land here as photos, never as map layers).
 */
export const PHOTO_KINDS = ['ground', 'aerial'] as const;
export type PhotoKind = (typeof PHOTO_KINDS)[number];

/** The kind of `photo`: `ground` when it says none. */
export function photoKindOf(photo: { readonly kind?: PhotoKind | undefined }): PhotoKind {
    return photo.kind ?? 'ground';
}

/** What a photo says wherever it stands on the map or, unplaced (M13), in the gallery. */
const photoFields = {
    id: idSchema,
    /** Absent on a street photo (`ground`); `aerial` on a photo taken from above. */
    kind: z.enum(PHOTO_KINDS).optional(),
    title: localizedPartial(200),
    description: localizedPartial(5000).optional(),
    year: yearSchema.optional(),
    yearEnd: yearSchema.optional(),
    /** The date's precision beyond the year (`docs/research/photo-date-source.md`). */
    month: monthSchema.optional(),
    day: daySchema.optional(),
    /** How the source dates the photo when that is more than a year (`Iulie 1936`). */
    dateText: localizedPartial(100).optional(),
    author: plainText(200).optional(),
    license: z.enum(LICENSES),
    rightsHolder: plainText(200).optional(),
    /** True while the rights of a migrated photo are being confirmed (the viewer shows a note). */
    rightsReview: z.boolean().optional(),
    source: photoSourceSchema.optional(),
    /** M13: the name its contributor asked to be credited under. */
    credit: plainText(100).optional(),
    links: z.array(linkSchema).max(MAX_LINKS),
    image: photoImageSchema,
    /** The improved and colorized versions; absent on a photo that has only its original. */
    versions: z.strictObject({ improved: photoVersionSchema.optional(), colorized: photoVersionSchema.optional() }).optional(),
};

const photoObjectSchema = z
    .strictObject({
        ...photoFields,
        location: latLngSchema,
        bearing: bearingSchema.optional(),
        fov: fovSchema.optional(),
    })
    .refine(validYearRange, coded('validation.yearRange', ['yearEnd']));

export const photoSchema = withPhotoDate(photoObjectSchema);

/** M13 (`docs/research/M13-roles.md` §5): a published photo with no place yet, shown in the "Where was this taken?" gallery. */
export const unplacedPhotoSchema = withPhotoDate(
    z.strictObject(photoFields).refine(validYearRange, coded('validation.yearRange', ['yearEnd'])),
);

export const manifestSchema = z
    .strictObject({
        version: z.literal(MANIFEST_VERSION),
        city: citySchema,
        layers: z.array(layerSchema).max(MAX_LAYERS),
        photos: z.array(photoSchema).max(MAX_PHOTOS),
        /** M13: photos with no place yet; absent when there are none, so a manifest from before it stays valid. */
        unplaced: z.array(unplacedPhotoSchema).max(MAX_PHOTOS).optional(),
        /** M13: the Contribute page of this city, the map's one link to anything that signs in. */
        contributeUrl: httpsUrlSchema.optional(),
        /** Defaults of the photos overlay; without it the photos start fully opaque. */
        photosOverlay: photosOverlaySchema.optional(),
        poiCategories: z.array(poiCategorySchema).max(MAX_POI_CATEGORIES).optional(),
        pois: z.array(poiSchema).max(MAX_POIS).optional(),
        /** M17 (`docs/research/M17-stories.md` §4): the city's stories; absent when there are none. */
        stories: z.array(storySchema).max(MAX_STORIES).optional(),
        /** M31 (`docs/research/M31-wikipedia.md`): the Wikipedia overlay's file, loaded when the overlay is first switched on. */
        wikipedia: wikipediaRefSchema.optional(),
    })
    .superRefine((manifest, context) => {
        for (const issue of manifestRuleIssues(manifest)) {
            context.addIssue({ code: 'custom', ...coded(issue.code, [...issue.path]) });
        }
    });

export type Manifest = z.infer<typeof manifestSchema>;
export type City = z.infer<typeof citySchema>;
export type Credit = z.infer<typeof creditSchema>;
export type Theme = z.infer<typeof themeSchema>;
export type ThemeTokens = Theme['tokens'];
export type ThemeScheme = (typeof THEME_SCHEMES)[number];
export type Basemap = z.infer<typeof basemapSchema>;
export type Layer = z.infer<typeof layerSchema>;
export type LayerKind = (typeof LAYER_KINDS)[number];
export type LayerSource = z.infer<typeof layerSourceSchema>;
export type LayerAdjustments = z.infer<typeof layerAdjustmentsSchema>;
export type Photo = z.infer<typeof photoSchema>;
export type UnplacedPhoto = z.infer<typeof unplacedPhotoSchema>;
export type PhotoImage = z.infer<typeof photoImageSchema>;
export type PhotoView = (typeof PHOTO_VIEWS)[number];
export type PhotoVersion = z.infer<typeof photoVersionSchema>;
export type PhotoLink = z.infer<typeof linkSchema>;
export type License = (typeof LICENSES)[number];
