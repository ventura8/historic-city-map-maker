/**
 * What the assists share (`docs/research/M4-interfaces.md` §4): their writer, the city a request names, the budget
 * guard, the Nominatim cool-down of `ops/assist` and the times a cache cell keeps. The geocoding cache and the AI
 * counters are stamped `system:assist`.
 */
import {
    FIRESTORE_PATHS,
    GEOCODE_CACHE_DAYS,
    GEOCODE_COOLDOWN_MINUTES,
    GEOCODE_QUEUED_MINUTES,
    assistStateDocSchema,
    cityDocSchema,
    opsGuardDocSchema,
    systemWriter,
    timestampFromDate,
    timestampToDate,
    type CityDoc,
} from '@hcm/shared';

import { ApiError } from '../api/api-error.js';
import type { DocumentStore } from '../ports/documents.js';

const ASSIST_WRITER = 'assist';

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** A cell asked this recently is still in the queue: asking again answers `queued` without a second task. */
export const QUEUED_FRESH_MS = GEOCODE_QUEUED_MINUTES * MINUTE_MS;

export function stampOf(now: Date) {
    return { updatedBy: systemWriter(ASSIST_WRITER), updatedAt: timestampFromDate(now) };
}

function minutesAfter(now: Date, minutes: number): Date {
    return new Date(now.getTime() + minutes * MINUTE_MS);
}

/** When a cell answered now is asked again. */
export function cacheExpiry(now: Date): Date {
    return new Date(now.getTime() + GEOCODE_CACHE_DAYS * DAY_MS);
}

/** When a refused or failed cell is asked again: after the cool-down. */
export function cooldownEnd(now: Date): Date {
    return minutesAfter(now, GEOCODE_COOLDOWN_MINUTES);
}

/** The city a request names; `apiError.notFound` when there is none. */
export async function requireCity(documents: DocumentStore, cityId: string): Promise<CityDoc> {
    const city = await documents.get(FIRESTORE_PATHS.city(cityId), cityDocSchema);
    if (city === undefined) {
        throw new ApiError('apiError.notFound');
    }
    return city;
}

/** `ops/guard` red pauses the AI drafts (`opsGuardDocSchema`; security review §3.4). */
export async function guardIsRed(documents: DocumentStore): Promise<boolean> {
    return (await documents.get(FIRESTORE_PATHS.opsGuard, opsGuardDocSchema))?.state === 'red';
}

/** Until when Nominatim must not be asked (a refusal's cool-down), or undefined when it may be. */
export async function nominatimCoolUntil(documents: DocumentStore, now: Date): Promise<Date | undefined> {
    const until = (await documents.get(FIRESTORE_PATHS.assistState, assistStateDocSchema))?.nominatimCoolUntil;
    const end = until === undefined ? undefined : timestampToDate(until);
    return end !== undefined && end > now ? end : undefined;
}
