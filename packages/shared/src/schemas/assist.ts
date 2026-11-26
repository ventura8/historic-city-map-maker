/**
 * The admin's assists (M4; `docs/research/M4-interfaces.md` §4): **title suggestions** from OpenStreetMap's Nominatim
 * (reverse geocoding of the place a photo or a point shows: one request a second for the whole project through a Cloud
 * Tasks queue, every answer cached, its attribution shown, a refusal leaves the admin typing) and **translation drafts**
 * between Romanian and English from Vertex AI Gemini, called server-side only (the paid tier the EEA requires; App Check;
 * a monthly cap; never published without the admin's Save). Both answers are plain text: sanitized here, length-limited,
 * rendered as text, never as HTML.
 */
import { z } from 'zod';

import { apiErrorCodeSchema } from '../api/errors.js';
import type { Locale } from '../i18n/index.js';
import { linkTargets } from '../text/markdown.js';
import { stamp, timestampSchema } from './firestore-common.js';
import { plainText } from './primitives.js';

/** Nominatim's reverse geocoder (usage policy: https://operations.osmfoundation.org/policies/nominatim/). */
export const NOMINATIM_REVERSE_URL = 'https://nominatim.openstreetmap.org/reverse';
/** Nominatim's search, beside the reverse geocoder (M5: New city finds a city by its name, `cities.locate`). */
export const NOMINATIM_SEARCH_URL = 'https://nominatim.openstreetmap.org/search';
/** The policy asks for an application's own User-Agent; a library's default is refused. */
export const NOMINATIM_USER_AGENT = 'historic-city-map/1 (+https://github.com/ventura8/historic-city-map-maker)';
/** Shown under every suggestion (the ODbL): Nominatim's own licence line. */
export const NOMINATIM_ATTRIBUTION = 'Data © OpenStreetMap contributors, ODbL 1.0. https://osm.org/copyright';
/** The task queue that keeps the whole project at one Nominatim request a second (`assist.geocode`). */
export const ASSIST_GEOCODE_QUEUE = 'assist-geocode';
export const GEOCODE_RATE_LIMITS = { maxDispatchesPerSecond: 1, maxConcurrentDispatches: 1 } as const;
/** A cached answer is reused this long; after a refusal (429) nothing is asked for this long. */
export const GEOCODE_CACHE_DAYS = 90;
export const GEOCODE_COOLDOWN_MINUTES = 10;
/**
 * A cell asked this recently is still in the queue (asking again answers `queued` without a second task); an editor that
 * has listened this long stops and says the assistant is not answering, so asking again queues it anew.
 */
export const GEOCODE_QUEUED_MINUTES = 2;
/**
 * The most title suggestions queued for Nominatim in one UTC day, for the whole project: far above an admin's real use (a
 * few dozen photos a day), it keeps a scripted session from asking Nominatim for cell after cell (its usage policy forbids
 * bulk geocoding). Past it, `apiError.assist.dailyCap` until the next day.
 */
export const GEOCODE_DAILY_CAP = 300;
/** Nominatim's `zoom` for a reverse request: 18 is a building, which a photo's place usually is. */
export const GEOCODE_ZOOM = 18;
export const MAX_TITLE_SUGGESTIONS = 3;
/** A cache cell: asked (`queued`), answered (`ready`, suggestions possibly empty), or refused or failed (`failed`). */
export const GEOCODE_STATES = ['queued', 'ready', 'failed'] as const;

/** Places are rounded to this many decimals of a degree for the cache and the request (about 11 m). */
const CELL_SCALE = 10_000;

/** The cache cell of a place (`n444268_e261025`): what the cache, the queue's task id and the request share. */
export function geocodeCellKey(lat: number, lng: number): string {
    const latPart = `${lat < 0 ? 's' : 'n'}${String(Math.abs(Math.round(lat * CELL_SCALE)))}`;
    return `${latPart}_${lng < 0 ? 'w' : 'e'}${String(Math.abs(Math.round(lng * CELL_SCALE)))}`;
}

/** The same shape as `GEOCODE_KEY_PATTERN` (the paths' check), with its four parts captured. */
const CELL_PARTS = /^([ns])(\d{1,6})_([ew])(\d{1,7})$/;

const signOf = (part: string | undefined, negative: string): number => (part === negative ? -1 : 1);

/** The place a cell stands for, the only position the request carries; undefined for a malformed key. */
export function geocodeCellCenter(key: string): { readonly lat: number; readonly lng: number } | undefined {
    const parts = CELL_PARTS.exec(key);
    if (parts === null) {
        return undefined;
    }
    return {
        lat: (signOf(parts[1], 's') * Number(parts[2])) / CELL_SCALE,
        lng: (signOf(parts[3], 'w') * Number(parts[4])) / CELL_SCALE,
    };
}

/** One suggested title: the Romanian text, and the English one when OpenStreetMap has it (`name:en`). */
export const titleSuggestionSchema = z.strictObject({ ro: plainText(200), en: plainText(200).optional() });

export type TitleSuggestion = z.infer<typeof titleSuggestionSchema>;

/** `assistGeocodes/{key}`: written by `assist.suggestTitle` (queued) and the queue's `assist.geocode` only; admins read it. */
export const geocodeCellDocSchema = z.strictObject({
    state: z.enum(GEOCODE_STATES),
    suggestions: z.array(titleSuggestionSchema).max(MAX_TITLE_SUGGESTIONS),
    attribution: plainText(200),
    /** Why a cell `failed` (`apiError.assist.rateLimited`, `apiError.assist.unavailable`). */
    error: apiErrorCodeSchema.optional(),
    requestedAt: timestampSchema,
    answeredAt: timestampSchema.optional(),
    /** After this the cell is asked again (a failed cell: after the cool-down). */
    expiresAt: timestampSchema,
    ...stamp,
});

/** A UTC day, `2026-10-24`. */
const DAY_PATTERN = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;

/**
 * `ops/assist`: the Nominatim cool-down after a refusal, read before anything is queued, and how many cells were queued on
 * `queuedDay` (`GEOCODE_DAILY_CAP`).
 */
export const assistStateDocSchema = z.strictObject({
    nominatimCoolUntil: timestampSchema.optional(),
    queuedDay: z.string().regex(DAY_PATTERN).optional(),
    queuedToday: z.number().int().min(0).optional(),
    ...stamp,
});

/** The UTC day of `at` (`2026-10-24`), as `queuedDay` names it. */
export function utcDay(at: Date): string {
    return at.toISOString().slice(0, 10);
}

/** How many cells were queued on `day` (0 when the state counts another day, or nothing yet). */
export function queuedOn(state: Pick<AssistStateDoc, 'queuedDay' | 'queuedToday'> | undefined, day: string): number {
    return state?.queuedDay === day ? (state.queuedToday ?? 0) : 0;
}

export type GeocodeCellDoc = z.infer<typeof geocodeCellDocSchema>;
export type AssistStateDoc = z.infer<typeof assistStateDocSchema>;

/**
 * The Gemini models the drafts may come from, in order of preference (a new model is a reviewed change of this list);
 * Vertex AI in the functions' region. The functions use the first one Google offers the project, probing in order and
 * keeping the choice for a few minutes (`functions/src/api/vertex-models.ts`); the setup self-test's `ai` check asks
 * `countTokens`, which costs nothing, and names the model in use. `DECISIONS-for-review.md` §67g (the user's decision,
 * 2026-11-01): `gemini-2.5-flash-lite` was retired in October 2026 (the live self-test: "Vertex AI does not offer
 * gemini-2.5-flash-lite to this project"); `gemini-3.5-flash-lite` is stable since 2026-07-21 and retires no earlier
 * than 2027-07-21 (Google's Vertex AI model lifecycle page), `gemini-3.1-flash-lite` is its fallback.
 */
export const VERTEX_MODEL_IDS = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'] as const;
/** The preferred model: the first of `VERTEX_MODEL_IDS`. */
export const VERTEX_MODEL_ID = VERTEX_MODEL_IDS[0];
export const VERTEX_LOCATION = 'us-central1';
/**
 * The project's custom role the functions' account calls the model with (Provision's `iam` item makes it), instead of
 * `roles/aiplatform.user`, which also allows billable custom jobs and endpoint deploys. UNVERIFIED until the first real
 * call (`docs/research/M4-interfaces.md` §10): that `aiplatform.endpoints.predict` is all `generateContent` and
 * `countTokens` of a publisher model need (the setup self-test's `ai` check proves it, for free).
 */
export const VERTEX_DRAFTS_ROLE_ID = 'hcmVertexDrafts';
export const VERTEX_DRAFTS_PERMISSIONS: readonly string[] = ['aiplatform.endpoints.predict'];
/** Bumped whenever `translationPrompt` changes (the golden test pins its text). */
export const TRANSLATION_PROMPT_VERSION = 1;
/**
 * UNVERIFIED (Google's price list for the models of `VERTEX_MODEL_IDS`, kept from the flash-lite price of 2025 until the
 * first invoice line says otherwise): US dollars per million tokens. The monthly cap bounds what an error here can cost.
 */
export const AI_PRICE_USD_PER_MILLION_TOKENS = { input: 0.1, output: 0.4 } as const;
/** The month's cap for the whole project (expected use: under $0.05): over either, no draft until the next month. */
export const AI_MONTHLY_CAP = { requests: 500, usd: 0.5 } as const;

/** The fields a draft fills, and the longest text each takes (the manifest's limits). */
export const ASSIST_FIELDS = ['title', 'label', 'dateText', 'description'] as const;

export type AssistField = (typeof ASSIST_FIELDS)[number];

export const ASSIST_FIELD_MAX: Readonly<Record<AssistField, number>> = { title: 200, label: 200, dateText: 100, description: 5000 };

/** `usage/ai-YYYY-MM`: written by `assist.translateDraft` in the transaction that checks the cap; admins read it. */
export const aiUsageDocSchema = z.strictObject({
    month: z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/),
    requests: z.number().int().min(0),
    inputTokens: z.number().int().min(0),
    outputTokens: z.number().int().min(0),
    /** Estimated before the call, corrected by the tokens Vertex AI reports. */
    usd: z.number().min(0),
    ...stamp,
});

export type AiUsageDoc = z.infer<typeof aiUsageDocSchema>;

/** A conservative token count for Romanian or English text (a token is about three characters or more). */
export function estimateTokens(text: string): number {
    return Math.ceil(text.length / 3);
}

/** What a call costs, in US dollars, from its token counts. */
export function aiCostUsd(tokens: { readonly inputTokens: number; readonly outputTokens: number }): number {
    const price = AI_PRICE_USD_PER_MILLION_TOKENS;
    return (tokens.inputTokens * price.input + tokens.outputTokens * price.output) / 1_000_000;
}

/** True when one more call of `estimateUsd` would pass the month's cap (requests or dollars). */
export function overAiCap(usage: Pick<AiUsageDoc, 'requests' | 'usd'> | undefined, estimateUsd: number): boolean {
    const spent = usage ?? { requests: 0, usd: 0 };
    return spent.requests + 1 > AI_MONTHLY_CAP.requests || spent.usd + estimateUsd > AI_MONTHLY_CAP.usd;
}

const LANGUAGE_NAMES: Readonly<Record<Locale, string>> = { ro: 'Romanian', en: 'English' };

const FIELD_WORDS: Readonly<Record<AssistField, string>> = {
    title: 'the title of a place or a photograph',
    label: 'the name of a historical map layer',
    dateText: 'a date as a source wrote it',
    description: 'a description that may contain Markdown links',
};

export interface TranslationInput {
    readonly from: Locale;
    readonly to: Locale;
    readonly field: AssistField;
    readonly text: string;
    /** The city's name in the target language, for context. */
    readonly cityName: string;
}

/** What `assist.translateDraft` sends to Gemini: the instruction, the admin's text alone as the user turn, the limits. */
export interface TranslationPrompt {
    readonly systemInstruction: string;
    readonly userText: string;
    readonly maxOutputTokens: number;
    readonly temperature: number;
}

/** The pinned prompt (`TRANSLATION_PROMPT_VERSION`): the admin's text is the only user content, nothing is executed. */
export function translationPrompt(input: TranslationInput): TranslationPrompt {
    const to = LANGUAGE_NAMES[input.to];
    const systemInstruction = [
        `You translate ${FIELD_WORDS[input.field]} on a public map of the history of ${input.cityName},`,
        `from ${LANGUAGE_NAMES[input.from]} to ${to}.`,
        'Answer with the translation only, as plain text: no quotes, no notes, no explanations, no HTML.',
        'Keep proper names, street names, numbers, years and dates as they are; keep every Markdown link and its address exactly.',
        `If the text is already in ${to}, answer with it unchanged.`,
    ].join(' ');
    const limit = ASSIST_FIELD_MAX[input.field];
    return {
        systemInstruction,
        userText: input.text,
        maxOutputTokens: Math.min(2048, Math.max(64, Math.ceil(limit / 2))),
        temperature: 0.2,
    };
}

/** A sanitized draft, and whether it had to be shortened to the field's limit. */
export interface DraftText {
    readonly text: string;
    readonly truncated: boolean;
}

/** Zero-width and bidirectional formatting characters: invisible, and able to make a text read differently. */
const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/gu;
const LINE_FEED = 0x0a;
const FIRST_PRINTABLE = 0x20;
const DELETE_THROUGH_C1 = [0x7f, 0x9f] as const;

/** C0 and C1 control characters and DELETE, except the line feed (a single-line field's `tidied` turns it into a space). */
function isControl(code: number): boolean {
    if (code === LINE_FEED) {
        return false;
    }
    return code < FIRST_PRINTABLE || (code >= DELETE_THROUGH_C1[0] && code <= DELETE_THROUGH_C1[1]);
}

/** Every control character but the line feed becomes a space. */
function withoutControls(text: string): string {
    return Array.from(text, (char) => (isControl(char.charCodeAt(0)) ? ' ' : char)).join('');
}

/** A whole answer in a code fence (with or without a language after the opening one), or null. */
function unfenced(text: string): string | null {
    if (!(text.length >= 6 && text.startsWith('```') && text.endsWith('```'))) {
        return null;
    }
    const firstBreak = text.indexOf('\n');
    return text.slice(firstBreak < 0 ? 3 : firstBreak + 1, -3).trim();
}

/** Opening and closing quotation marks around the whole answer. */
const QUOTED = /^["'“„«].*["'”»]$/su;

/** A whole answer wrapped in a code fence or in quotation marks, unwrapped. */
function unwrapped(text: string): string {
    const fenced = unfenced(text);
    if (fenced !== null) {
        return fenced;
    }
    return QUOTED.test(text) ? text.slice(1, -1).trim() : text;
}

/** Spaces collapsed; in a multi-line field, at most one empty line between paragraphs. */
function tidied(text: string, multiline: boolean): string {
    if (!multiline) {
        return text.replace(/\s+/gu, ' ').trim();
    }
    const lines = text.split('\n').map((line) => line.replace(/[ \t]+/gu, ' ').trim());
    return lines
        .join('\n')
        .replace(/\n{3,}/gu, '\n\n')
        .trim();
}

/** At most `max` characters, cut at the last space when one is near the end. */
function shortened(text: string, max: number): DraftText {
    if (text.length <= max) {
        return { text, truncated: false };
    }
    const head = text.slice(0, max);
    const space = head.lastIndexOf(' ');
    return { text: (space > max * 0.8 ? head.slice(0, space) : head).trimEnd(), truncated: true };
}

/**
 * A model's answer as a draft for `field`: plain text in NFC, without control or invisible formatting characters, without
 * a wrapping code fence or quotation marks, within the field's limit; null when nothing is left (no draft).
 */
export function sanitizeDraft(raw: string, field: AssistField): DraftText | null {
    const visible = withoutControls(raw.normalize('NFC').replace(INVISIBLE, ''));
    const text = tidied(unwrapped(visible.trim()), field === 'description');
    return text === '' ? null : shortened(text, ASSIST_FIELD_MAX[field]);
}

/**
 * Whether a draft keeps the source's links: every link address of the draft is one of the source's (a translation moves
 * a link's label, never its address). A model told by text pasted into the source to add a link, or that changes an
 * address, gives no draft (`apiError.assist.linksChanged`): the public viewer renders a description's links.
 */
export function draftKeepsLinks(source: string, draft: string): boolean {
    const known = new Set(linkTargets(source));
    return linkTargets(draft).every((target) => known.has(target));
}
