/**
 * Building blocks of every schema in `@hcm/shared`: ids, bilingual text, URLs, coordinates, colours.
 * Every object schema is strict (`z.strictObject`): an unknown key is an error, which also blocks
 * prototype-pollution keys (security review §1.7). A refinement's `message` is a `validation.*` i18n
 * key, so `toValidationIssues` can hand it to the UI as is.
 */
import { z } from 'zod';

import type { MessageKey } from '../i18n/index.js';
import { parseMarkdown } from '../text/markdown.js';
import { isHttpsUrl, isRelativeUrl, MAX_URL_LENGTH } from '../text/urls.js';

/**
 * No `eval`, ever: zod probes `Function('')` to compile faster object parsers, and every city page's CSP (no
 * 'unsafe-eval') reports that probe as a violation (S-V16-BAD-INLINE-STYLE found it). Every schema module imports this
 * one, so the setting is in place before the first parse; the interpreted parsers are fast enough for a manifest.
 */
z.config({ jitless: true });

/** The localized error codes the validation helpers return: every `validation.*` catalogue key. */
export type ValidationCode = Extract<MessageKey, `validation.${string}`>;

/**
 * City ids are lowercase: they name Storage folders, which `firebase/storage.rules` matches with `[a-z0-9-]{2,32}`. Here, not
 * in `paths.ts`, whose Firestore schemas a page that only checks a city id (the start page) must not carry (docs/LESSONS.md 593).
 */
export const CITY_ID_PATTERN = /^[a-z0-9-]{2,32}$/;

/** Ids of cities, layers, photos and overlays; also what a URL hash may carry (never a selector). */
export const ID_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;

export function isId(value: unknown): value is string {
    return typeof value === 'string' && ID_PATTERN.test(value);
}

/**
 * The overlay id of the photo markers and cones (PLAN Addendum 3). Overlay ids are the layer ids, this one and the
 * POI category ids, so no layer or category may use it.
 */
export const PHOTOS_OVERLAY_ID = 'photos';

/** Options of a refinement whose failure reports `code` (at `path`, relative to the refined value). */
export function coded(code: ValidationCode, path?: (string | number)[]): { message: ValidationCode; path?: (string | number)[] } {
    return path === undefined ? { message: code } : { message: code, path };
}

export const idSchema = z.string().regex(ID_PATTERN);

/** A year range is valid when there is no end year, or an end year not before the (required) start year. */
export function validYearRange(value: { readonly year?: number | undefined; readonly yearEnd?: number | undefined }): boolean {
    return value.yearEnd === undefined || (value.year !== undefined && value.year <= value.yearEnd);
}

/** A POI span: either bound may be absent (a demolished building with an unknown construction year), never inverted. */
export function validYearSpan(value: { readonly yearStart?: number | undefined; readonly yearEnd?: number | undefined }): boolean {
    return value.yearStart === undefined || value.yearEnd === undefined || value.yearStart <= value.yearEnd;
}

/** Trimmed, non-empty plain text of at most `max` characters (rendered as text, never as HTML). */
export function plainText(max: number) {
    return z.string().trim().min(1).max(max);
}

/** Romanian and English, both required (labels and names every visitor sees). */
export function localized(max: number) {
    return z.strictObject({ ro: plainText(max), en: plainText(max) });
}

/** Romanian required, English optional (photo texts: the viewer falls back to Romanian). */
export function localizedPartial(max: number) {
    return z.strictObject({ ro: plainText(max), en: plainText(max).optional() });
}

/** Markdown-subset text (`text/markdown.ts`) whose links are all https. */
function markdownText(max: number) {
    return plainText(max).refine((text) => parseMarkdown(text).rejectedLinks.length === 0, coded('validation.markdownLink'));
}

export function localizedMarkdown(max: number) {
    return z.strictObject({ ro: markdownText(max), en: markdownText(max) });
}

/** Markdown subset, Romanian required and English optional (texts the viewer falls back to Romanian for). */
export function localizedMarkdownPartial(max: number) {
    return z.strictObject({ ro: markdownText(max), en: markdownText(max).optional() });
}

export const httpsUrlSchema = z.string().max(MAX_URL_LENGTH).refine(isHttpsUrl, coded('validation.httpsOnly'));

/** Links per photo or POI (the Firestore rules allow 5). */
export const MAX_LINKS = 5;

/** A labelled https link (legacy HTML anchors were converted to these). */
export const linkSchema = z.strictObject({ url: httpsUrlSchema, label: plainText(200) });

/** An image or archive address: https, or relative to the manifest that names it (no `..`, no `//host`). */
export const assetUrlSchema = z
    .string()
    .max(MAX_URL_LENGTH)
    .refine((url) => isHttpsUrl(url) || isRelativeUrl(url), coded('validation.assetUrl'));

const lngSchema = z.number().min(-180).max(180);
const latSchema = z.number().min(-90).max(90);

/** `[lng, lat]` in degrees (GeoJSON and Mapbox order). */
export const lngLatSchema = z.tuple([lngSchema, latSchema]);

/** `{lat, lng}`: a photo location, the shape Firestore and the rules use. */
export const latLngSchema = z.strictObject({ lat: latSchema, lng: lngSchema });

/** `[[west, south], [east, north]]` with west < east and south < north (no antimeridian crossing). */
export const bboxSchema = z
    .tuple([lngLatSchema, lngLatSchema])
    .refine(([[west, south], [east, north]]) => west < east && south < north, coded('validation.bounds'));

/** The same box as Firestore stores it: `{west, south, east, north}`. */
export const boundsRecordSchema = z
    .strictObject({ west: lngSchema, south: latSchema, east: lngSchema, north: latSchema })
    .refine((bounds) => bounds.west < bounds.east && bounds.south < bounds.north, coded('validation.bounds'));

export const zoomSchema = z.number().min(0).max(24);
export const yearSchema = z.number().int().min(1800).max(2100);
export const opacitySchema = z.number().min(0).max(1);
export const bearingSchema = z.number().min(0).max(360);
export const fovSchema = z.number().min(1).max(180);
export const hexColorSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/);

/** `YYYY-MM-DD`, a real calendar date. */
export const isoDateSchema = z.iso.date();

/** A Mapbox public token (`pk.`); a secret `sk.` token can never pass. */
export const mapboxPublicTokenSchema = z.string().regex(/^pk\.[A-Za-z0-9._-]{1,1000}$/);

/** A GA4 measurement id (`G-XXXXXXX`). */
export const measurementIdSchema = z.string().regex(/^G-[A-Z0-9]{4,20}$/);

/**
 * The public identifiers of the city's Firebase web app, which `firebase/analytics` needs besides the measurement id
 * (M1-interfaces CR-9). They are not secrets (every Firebase web page ships them), but the M2 manifest builder writes
 * them from the Firebase Management API and they are never committed: gitleaks reports `AIza…` keys.
 */
export const firebaseAppIdsSchema = z.strictObject({
    apiKey: z.string().regex(/^AIza[0-9A-Za-z_-]{35}$/),
    appId: z.string().regex(/^1:\d{1,20}:web:[0-9a-f]{1,40}$/),
    projectId: z.string().regex(/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/),
});

/** `major.minor.patch` of an engine release. */
export const versionSchema = z.string().regex(/^\d{1,4}\.\d{1,4}\.\d{1,6}$/);

/** A Material 3 system token name: `--md-sys-color-primary`, `--md-sys-shape-corner-full`, ... */
export const TOKEN_NAME_PATTERN = /^--md-sys-[a-z0-9-]{1,60}$/;

/**
 * A token value: colours (`#875329`, `rgb(1 2 3 / 50%)`), lengths and plain words only. No quotes,
 * semicolons, braces, colons, backslashes or `url(`, so a value can never leave its declaration.
 */
const TOKEN_VALUE_PATTERN = /^[#\w .,%()/+-]{1,100}$/;

export const tokenValueSchema = z
    .string()
    .refine((value) => TOKEN_VALUE_PATTERN.test(value) && !value.toLowerCase().includes('url('), coded('validation.cssValue'));

/** At most this many tokens per scheme (the generated M3 colour scheme has about 55). */
export const MAX_TOKENS = 200;

/** One scheme's tokens: 1 to `MAX_TOKENS` `--md-sys-*` custom properties. */
export const tokenMapSchema = z
    .record(z.string().regex(TOKEN_NAME_PATTERN), tokenValueSchema)
    .refine((tokens) => Object.keys(tokens).length > 0, coded('validation.required'))
    .refine((tokens) => Object.keys(tokens).length <= MAX_TOKENS, coded('validation.tooBig'));
