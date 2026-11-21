/**
 * What the photos area remembers per admin in `localStorage` (`docs/research/M2c-interfaces.md` §5.6, §6.2): the sticky
 * author, source, licence and rights holder new photos get, the last pin (where a photo without EXIF lands), and the
 * photos left at that fallback pin whose place is still to be checked. No secret, no address; a stored value that does
 * not validate is ignored (the admin works without storage).
 */
import { FIRESTORE_LICENSES, ID_PATTERN, isHttpsUrl, type LngLat, type PhotoDoc } from '@hcm/shared';
import { z } from 'zod';

import type { KeyValueStore } from '../app/ports.js';

export const STICKY_KEY = 'hcm:admin:photoSticky';
export const LAST_PIN_KEY = 'hcm:admin:lastPin';
export const CHECK_PLACE_KEY = 'hcm:admin:photoCheckPlace';

const text = z.string().trim().min(1).max(200);

const stickySchema = z.strictObject({
    author: text.optional(),
    sourceLabel: text.optional(),
    sourceUrl: z.string().max(2048).refine(isHttpsUrl).optional(),
    license: z.enum(FIRESTORE_LICENSES).optional(),
    rightsHolder: text.optional(),
});

const STICKY_FIELDS = ['author', 'sourceLabel', 'sourceUrl', 'license', 'rightsHolder'] as const;

type StickyField = (typeof STICKY_FIELDS)[number];

/** The fields a new photo copies from the last ones the admin chose (`S-A30-BAD-STICKY-FIELDS`); absent: not chosen. */
export type StickyFields = { readonly [K in StickyField]?: PhotoDoc[K] | undefined };

/** The chosen sticky fields only, as a photo document holds them. */
export function definedSticky(fields: StickyFields): Partial<Pick<PhotoDoc, StickyField>> {
    const entries = STICKY_FIELDS.flatMap((field) => (fields[field] === undefined ? [] : [[field, fields[field]] as const]));
    return Object.fromEntries(entries);
}

const lastPinSchema = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);
// No cap: a mark forgotten would lift its photo's publish block. A city holds at most `MAX_PHOTOS` of them, a few KB of 5 MB.
const checkPlaceSchema = z.array(z.string().regex(ID_PATTERN));

function read<T>(local: KeyValueStore, key: string, schema: z.ZodType<T>): T | null {
    const raw = local.get(key);
    if (raw === null) {
        return null;
    }
    try {
        const parsed = schema.safeParse(JSON.parse(raw));
        return parsed.success ? parsed.data : null;
    } catch {
        return null;
    }
}

export class PhotoMemory {
    readonly #local: KeyValueStore;

    constructor(local: KeyValueStore) {
        this.#local = local;
    }

    sticky(): StickyFields {
        return read(this.#local, STICKY_KEY, stickySchema) ?? {};
    }

    /** Remembers the sticky fields of a photo the admin saved (or of a bulk Set author, source and licence). */
    rememberSticky(fields: StickyFields): void {
        const next = { ...definedSticky(this.sticky()), ...definedSticky(fields) };
        if (stickySchema.safeParse(next).success) {
            this.#local.set(STICKY_KEY, JSON.stringify(next));
        }
    }

    lastPin(): LngLat | null {
        return read(this.#local, LAST_PIN_KEY, lastPinSchema);
    }

    rememberPin(position: LngLat): void {
        this.#local.set(LAST_PIN_KEY, JSON.stringify([position[0], position[1]]));
    }

    /** The photos left at the fallback pin. */
    checkPlace(): ReadonlySet<string> {
        return new Set(read(this.#local, CHECK_PLACE_KEY, checkPlaceSchema) ?? []);
    }

    markCheckPlace(photoId: string, check: boolean): void {
        const ids = [...this.checkPlace()].filter((id) => id !== photoId);
        const next = check ? [...ids, photoId] : ids;
        this.#local.set(CHECK_PLACE_KEY, JSON.stringify(next));
    }
}
