/**
 * The Wikipedia overlay (V3 of `reports/PLAN-live.md`, `docs/research/M31-wikipedia.md`): geotagged Wikipedia articles in the
 * city's bounds, built on the server and published as a static file beside the manifest, so a visitor makes no request to
 * Wikipedia and the viewer reads no Firestore.
 *
 * - `wikipediaFileSchema`: `cities/<city>/wikipedia.json` in the public bucket, the file the viewer loads the first time the
 *   overlay is switched on. Each article has a version per language (Romanian and English), its place and, when Wikipedia
 *   marks its page image free, a thumbnail copied to the public bucket beside it.
 * - `wikipediaStateDocSchema`: `cities/<city>/wikipedia/state`, written only by the functions (default-deny rules): the
 *   city's settings (on or off, languages, hidden articles) and the last fetch, cached for `WIKIPEDIA_REFRESH_DAYS`.
 * - `manifest.wikipedia` (`wikipediaRefSchema`): where the file is, present only while the overlay is on and has articles;
 *   the builder adds the overlay's category (`WIKIPEDIA_CATEGORY_ID`) with it.
 */
import { z } from 'zod';

import { timestampSchema, uidSchema } from './firestore-common.js';
import { httpsUrlSchema, plainText } from './primitives.js';

/** The languages the overlay can show, in the order the viewer falls back through. */
export const WIKIPEDIA_LANGUAGES = ['ro', 'en'] as const;
export type WikipediaLanguage = (typeof WIKIPEDIA_LANGUAGES)[number];

/** The POI category the manifest builder adds for the overlay (its switch and slider in Layers). */
export const WIKIPEDIA_CATEGORY_ID = 'wikipedia';
/** Shown under Layers while the overlay is on, and in each article's sheet (the text's licence). */
export const WIKIPEDIA_ATTRIBUTION = 'Wikipedia (CC BY-SA 4.0)';
/** The file beside the manifest (relative to it). */
export const WIKIPEDIA_FILE = 'wikipedia.json';
/** The thumbnails' folder beside the manifest (relative to it). */
export const WIKIPEDIA_THUMBS = 'wikipedia';
/** A fetch older than this is done again at the next manifest build (the tick asks for one). */
export const WIKIPEDIA_REFRESH_DAYS = 7;
export const MAX_WIKIPEDIA_ARTICLES = 400;
export const MAX_WIKIPEDIA_HIDDEN = 1000;
export const WIKIPEDIA_EXTRACT_CHARS = 300;
/** The thumbnail's width asked of Wikipedia, in pixels. */
export const WIKIPEDIA_THUMB_WIDTH = 320;
/** The generic User-Agent of every request to Wikipedia (its policy asks for a contact address, never a person's). */
export const WIKIPEDIA_USER_AGENT = 'HistoricCityMapMaker/1.0 (https://github.com/ventura8/historic-city-map-maker)';

export const WIKIPEDIA_ARTICLE_ID_PATTERN = /^(?:ro|en)-\d{1,12}$/;
export const WIKIPEDIA_THUMB_PATTERN = /^wikipedia\/(?:ro|en)-\d{1,12}\.(?:jpg|png|webp)$/;

export const wikipediaLanguageSchema = z.enum(WIKIPEDIA_LANGUAGES);
export const wikipediaArticleIdSchema = z.string().regex(WIKIPEDIA_ARTICLE_ID_PATTERN);

/** An article's page on one Wikipedia: its title, the first sentences as plain text, and its address. */
export const wikipediaVersionSchema = z.strictObject({
    title: plainText(200),
    extract: z.string().max(WIKIPEDIA_EXTRACT_CHARS),
    url: httpsUrlSchema.refine((url) => /^https:\/\/(?:ro|en)\.wikipedia\.org\/wiki\//.test(url)),
});

export const wikipediaArticleSchema = z
    .strictObject({
        /** `<language>-<page id>` of the first language that had the article. */
        id: wikipediaArticleIdSchema,
        lng: z.number().min(-180).max(180),
        lat: z.number().min(-90).max(90),
        versions: z.strictObject({ ro: wikipediaVersionSchema.optional(), en: wikipediaVersionSchema.optional() }),
        /** `wikipedia/<id>.<ext>`, relative to the manifest: a free image only. */
        thumb: z.string().regex(WIKIPEDIA_THUMB_PATTERN).optional(),
    })
    .refine((article) => article.versions.ro !== undefined || article.versions.en !== undefined);

export const wikipediaFileSchema = z.strictObject({
    version: z.literal(1),
    generatedAt: z.iso.datetime(),
    attribution: plainText(100),
    articles: z.array(wikipediaArticleSchema).max(MAX_WIKIPEDIA_ARTICLES),
});

/** What the admin chooses. */
export const wikipediaSettingsSchema = z.strictObject({
    enabled: z.boolean(),
    languages: z.array(wikipediaLanguageSchema).min(1).max(WIKIPEDIA_LANGUAGES.length),
    hidden: z.array(wikipediaArticleIdSchema).max(MAX_WIKIPEDIA_HIDDEN),
});

export const WIKIPEDIA_FAILURES = ['unavailable', 'rateLimited', 'invalid'] as const;

export const wikipediaStateDocSchema = wikipediaSettingsSchema.extend({
    /** The admin asked for a fetch now (Refresh, or other languages): the next build fetches whatever the cache's age. */
    refreshRequested: z.boolean().optional(),
    refreshedAt: timestampSchema.optional(),
    /** Why the last fetch failed (the file of the fetch before stays). */
    failure: z.enum(WIKIPEDIA_FAILURES).optional(),
    /** Every article of the last fetch, the hidden ones too (the admin's list, and the file rewritten without a fetch). */
    articles: z.array(wikipediaArticleSchema).max(MAX_WIKIPEDIA_ARTICLES).optional(),
    updatedBy: uidSchema,
    updatedAt: timestampSchema,
});

/** `manifest.wikipedia`. */
export const wikipediaRefSchema = z.strictObject({
    /** The file, relative to the manifest (`WIKIPEDIA_FILE`) or https. */
    file: plainText(500),
    count: z.number().int().min(1).max(MAX_WIKIPEDIA_ARTICLES),
    generatedAt: z.iso.datetime(),
});

export const DEFAULT_WIKIPEDIA_SETTINGS: WikipediaSettings = { enabled: false, languages: ['ro', 'en'], hidden: [] };

export type WikipediaVersion = z.infer<typeof wikipediaVersionSchema>;
export type WikipediaArticle = z.infer<typeof wikipediaArticleSchema>;
export type WikipediaFile = z.infer<typeof wikipediaFileSchema>;
export type WikipediaSettings = z.infer<typeof wikipediaSettingsSchema>;
export type WikipediaStateDoc = z.infer<typeof wikipediaStateDocSchema>;
export type WikipediaRef = z.infer<typeof wikipediaRefSchema>;
export type WikipediaFailure = (typeof WIKIPEDIA_FAILURES)[number];
