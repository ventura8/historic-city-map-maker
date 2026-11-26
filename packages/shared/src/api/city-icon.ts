/**
 * `cities.setIcon` (a city's editors; `docs/research/M2-interfaces.md` → *The city's tab icon*): the city's browser tab
 * icon. The request carries a PNG or a WebP as base64 (`kind: 'upload'`, at most `CITY_ICON_LIMITS.maxBase64Chars`), or
 * asks for the default (`kind: 'reset'`: the Layers panel's map glyph in the city's seed colour). The server reads the type
 * from the bytes' magic numbers (never a file name or a content type), so an SVG, a JPEG, a PDF or a renamed file is refused
 * (`apiError.cityIcon.badType`), as is one too big, too small, not square or animated; nothing changes then.
 */
import { z } from 'zod';

import { sha256Schema } from '../schemas/firestore-common.js';
import { cityIdSchema } from '../schemas/paths.js';
import { httpsUrlSchema } from '../schemas/primitives.js';

/** The sizes a city's icon is stored at: the tab (32), the home screen (180, `apple-touch-icon`), the master (512). */
export const CITY_ICON_SIZES = [32, 180, 512] as const;
export type CityIconSize = (typeof CITY_ICON_SIZES)[number];

/** What `cities.setIcon` accepts: PNG or WebP only (never SVG), square enough, large enough, at most 1 MB. */
export const CITY_ICON_LIMITS = {
    maxBytes: 1_000_000,
    /** The request's base64 text: 4 characters per 3 bytes, rounded up. */
    maxBase64Chars: 1_333_336,
    minSide: 192,
    maxSide: 4096,
    /** The long side over the short one. */
    maxRatio: 1.25,
    contentTypes: ['image/png', 'image/webp'],
} as const; /** Standard base64, padded: the browser's `btoa` of the file's bytes. */
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export const cityIconRequestSchema = z.discriminatedUnion('kind', [
    z.strictObject({
        kind: z.literal('upload'),
        cityId: cityIdSchema,
        image: z.string().min(4).max(CITY_ICON_LIMITS.maxBase64Chars).regex(BASE64_PATTERN),
    }),
    z.strictObject({ kind: z.literal('reset'), cityId: cityIdSchema }),
]);

export const cityIconResponseSchema = z.strictObject({
    source: z.enum(['default', 'custom']),
    /** The 180 px icon's public address (the admin's preview). */
    url: httpsUrlSchema,
    sha256: sha256Schema,
});

export type CityIconRequest = z.infer<typeof cityIconRequestSchema>;
export type CityIconResponse = z.infer<typeof cityIconResponseSchema>;
