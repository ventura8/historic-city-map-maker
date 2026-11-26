/**
 * The admin's assists (M4; `docs/research/M4-interfaces.md` §4): title suggestions from Nominatim and translation drafts
 * from Vertex AI Gemini. Both answer plain text the editors put into the draft of the field (never saved, never published
 * without the admin's Save). The registry rows (owner `fn-assist-notify`) join with their implementation.
 */
import { z } from 'zod';

import { LOCALES } from '../i18n/index.js';
import { ASSIST_FIELD_MAX, ASSIST_FIELDS, GEOCODE_STATES, MAX_TITLE_SUGGESTIONS, titleSuggestionSchema } from '../schemas/assist.js';
import { cityIdSchema, GEOCODE_KEY_PATTERN } from '../schemas/paths.js';
import { coded, latLngSchema } from '../schemas/primitives.js';
import { apiErrorCodeSchema } from './errors.js';

/**
 * `assist.suggestTitle` (admin): suggestions for the place a photo or a point shows. A cached cell answers at once
 * (`ready`); otherwise the cell is queued (`queued`) and the editor listens to `assistGeocodes/{key}` until the queue's
 * one-a-second worker answers. `failed`: Nominatim refused or failed; the admin types the title (nothing is retried for
 * `GEOCODE_COOLDOWN_MINUTES` after a refusal).
 */
export const assistSuggestTitleRequestSchema = z.strictObject({ cityId: cityIdSchema, location: latLngSchema });
export const assistSuggestTitleResponseSchema = z.strictObject({
    state: z.enum(GEOCODE_STATES),
    key: z.string().regex(GEOCODE_KEY_PATTERN),
    suggestions: z.array(titleSuggestionSchema).max(MAX_TITLE_SUGGESTIONS),
    /** Shown with the suggestions: `NOMINATIM_ATTRIBUTION`. */
    attribution: z.string().max(200),
    error: apiErrorCodeSchema.optional(),
});

/** A queued geocoding (`ASSIST_GEOCODE_QUEUE`, `assist.geocode`): the cell only; its centre is what Nominatim is asked. */
export const geocodeTaskSchema = z.strictObject({ key: z.string().regex(GEOCODE_KEY_PATTERN) });

/**
 * `assist.translateDraft` (admin, App Check enforced): a draft of `text` in the other language for one field. Refused
 * while the budget guard is red (`apiError.guardPaused`), past the month's cap (`apiError.assist.monthlyCap`), when the
 * model answers nothing usable (`apiError.assist.noDraft`) or is unavailable (`apiError.assist.unavailable`); the
 * editor then leaves the field as it is.
 */
export const assistTranslateDraftRequestSchema = z
    .strictObject({
        cityId: cityIdSchema,
        field: z.enum(ASSIST_FIELDS),
        from: z.enum(LOCALES),
        to: z.enum(LOCALES),
        text: z.string().trim().min(1).max(ASSIST_FIELD_MAX.description),
    })
    .refine((request) => request.from !== request.to, coded('validation.value', ['to']))
    .refine((request) => request.text.length <= ASSIST_FIELD_MAX[request.field], coded('validation.tooBig', ['text']));

export const assistTranslateDraftResponseSchema = z.strictObject({
    /** Plain text, sanitized (`sanitizeDraft`), within the field's limit. */
    draft: z.string().min(1).max(ASSIST_FIELD_MAX.description),
    /** True when the draft was shortened to fit the field. */
    truncated: z.boolean(),
    /** The pinned model id (`VERTEX_MODEL_ID`), shown as "Draft by {model}: check it before saving". */
    model: z.string().max(100),
});

export type AssistSuggestTitleResponse = z.infer<typeof assistSuggestTitleResponseSchema>;
export type AssistTranslateDraftRequest = z.infer<typeof assistTranslateDraftRequestSchema>;
export type GeocodeTask = z.infer<typeof geocodeTaskSchema>;
