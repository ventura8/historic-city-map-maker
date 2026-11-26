/**
 * M28 (`docs/research/M28-sources.md` §10): where a country's historical maps, air photos and satellite images can be found,
 * online or in person, as `countrySources/{country}` (ISO 3166-1 alpha-2, upper case). `ops.tick`'s `sources` step writes it:
 * a country with a curated list (`COUNTRY_SEEDS`, Romania first) starts from it, any other from the open data Wikidata holds
 * (its national archives, library and mapping agency, marked `verified: false`); every place's address is checked to answer,
 * and the whole list is refreshed every `COUNTRY_SOURCES_REFRESH_DAYS`. The admin reads it (staff only, never the viewer).
 * Names and guides are data in Romanian and English; a place's request text is written in the institution's own language.
 */
import { z } from 'zod';

import { timestampSchema, uidSchema } from './firestore-common.js';
import { httpsUrlSchema, idSchema, localized, plainText } from './primitives.js';

/** How often a country's list is researched and its addresses checked again. */
export const COUNTRY_SOURCES_REFRESH_DAYS = 30;

export const PLACE_KINDS = [
    'archive',
    'mappingAgency',
    'cadastre',
    'military',
    'library',
    'museum',
    'university',
    'commercial',
    'portal',
] as const;
export type PlaceKind = (typeof PLACE_KINDS)[number];

export const PLACE_MATERIALS = ['historicalMaps', 'cityPlans', 'cadastralPlans', 'aerialPhotos', 'satellite'] as const;
export type PlaceMaterial = (typeof PLACE_MATERIALS)[number];

/** Online (a website or an API), in person (a reading room), or both. */
export const PLACE_ACCESS = ['online', 'offline', 'both'] as const;

export const PLACE_COSTS = ['free', 'paid', 'mixed', 'unknown'] as const;

/** Where what the owner brings home comes into the app: a map or an image (Imagery → Upload), a folder of scans (the local import), a photo. */
export const IMPORT_ROUTES = ['imageryUpload', 'localImport', 'photos'] as const;
export type ImportRoute = (typeof IMPORT_ROUTES)[number];

const text = localized(1200);
const phoneSchema = z.string().regex(/^[0-9+().\s/-]{6,40}$/);
const emailSchema = z
    .string()
    .max(120)
    .regex(/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i);

/** The online part: the account it asks for, where to make one, whether a key is needed and where the app takes what you get. */
const onlineSchema = z.strictObject({
    /** The provider's sign-up page; absent when the site needs no account. */
    signupUrl: httpsUrlSchema.optional(),
    /** `none`: the site and its downloads need no key; `site`: a key exists, but only for the provider's own tools. */
    key: z.enum(['none', 'site']),
    /** What to do on the site, step by step, in plain words. */
    howTo: text,
    importRoute: z.enum(IMPORT_ROUTES),
});

/** A request ready to send: its subject and its text. */
export interface PlaceRequest {
    readonly subject: string;
    readonly body: string;
}

/** The in-person part: where, when, whom to write to, what to ask for, what to bring, what it costs. */
const offlineSchema = z.strictObject({
    address: plainText(200),
    hours: text,
    phone: phoneSchema.optional(),
    email: emailSchema.optional(),
    /** How to get in (a reader's card, a research permit) and what to bring. */
    access: text,
    /** The request, ready to send, in the institution's language (`countrySourcesDocSchema.language`). */
    request: z.strictObject({ subject: plainText(160), body: plainText(1500) }),
    /** The same request, for the owner to read, in Romanian and English. */
    requestMeaning: text,
    fees: text,
    importRoute: z.enum(IMPORT_ROUTES),
});

export const countryPlaceSchema = z.strictObject({
    id: idSchema,
    name: localized(160),
    kind: z.enum(PLACE_KINDS),
    access: z.enum(PLACE_ACCESS),
    cost: z.enum(PLACE_COSTS),
    /** The figures, as the institution publishes them; absent when it publishes none. */
    costNote: text.optional(),
    years: z.strictObject({ from: z.number().int().min(1000).max(2100), to: z.number().int().min(1000).max(2100) }).optional(),
    materials: z.array(z.enum(PLACE_MATERIALS)).max(PLACE_MATERIALS.length),
    /** What it holds that a requester can name (a plan's title and year). */
    holdings: text.optional(),
    url: httpsUrlSchema,
    /** Checked by a person against the institution's own pages (the curated lists); false: found in Wikidata, not yet checked. */
    verified: z.boolean(),
    online: onlineSchema.optional(),
    offline: offlineSchema.optional(),
    /** Whether `url` answered at the last refresh (absent: not checked yet). */
    reachable: z.boolean().optional(),
});

export type CountryPlace = z.infer<typeof countryPlaceSchema>;

export const countrySourcesDocSchema = z.strictObject({
    country: z.string().regex(/^[A-Z]{2}$/),
    /** The institutions' language, which the ready request is written in. */
    language: z.string().regex(/^[a-z]{2}$/),
    /** The cities whose centre lies in the country (the admin finds its city's list by it). */
    cities: z.array(idSchema).max(100),
    places: z.array(countryPlaceSchema).max(80),
    /** `curated`: a list checked by a person, refreshed; `researched`: found in open data only. */
    origin: z.enum(['curated', 'researched']),
    /** The day the curated facts were last compared with the institutions' pages (`YYYY-MM-DD`). */
    factsCheckedOn: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
    refreshedAt: timestampSchema,
    updatedBy: uidSchema,
    updatedAt: timestampSchema,
});

export type CountrySourcesDoc = z.infer<typeof countrySourcesDocSchema>;

const DAY_MS = 86_400_000;

/** Whether a list refreshed at `refreshedAt` is due again at `now`. */
export function countrySourcesDue(refreshedAt: Date | undefined, now: Date): boolean {
    return refreshedAt === undefined || now.getTime() - refreshedAt.getTime() >= COUNTRY_SOURCES_REFRESH_DAYS * DAY_MS;
}

/** Google Maps with the place as the destination (Maps URLs, `api=1`): the phone or browser asks only where from. */
export function directionsUrl(address: string): string {
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;
}

/** An email to the institution with the ready request filled in: the owner only presses Send in their own mail app. */
export function requestMailUrl(email: string, request: { readonly subject: string; readonly body: string }): string {
    return `mailto:${email}?subject=${encodeURIComponent(request.subject)}&body=${encodeURIComponent(request.body)}`;
}
