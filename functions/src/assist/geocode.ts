import '../global-options.js';

import {
    ASSIST_GEOCODE_QUEUE,
    FIRESTORE_PATHS,
    GEOCODE_RATE_LIMITS,
    MAX_TITLE_SUGGESTIONS,
    NOMINATIM_ATTRIBUTION,
    assistStateDocSchema,
    geocodeCellCenter,
    geocodeCellDocSchema,
    geocodeTaskSchema,
    sanitizeDraft,
    timestampFromDate,
    validate,
    type ApiErrorCode,
    type GeocodeCellDoc,
    type GeocodeTask,
    type TitleSuggestion,
} from '@hcm/shared';
import { onTaskDispatched } from 'firebase-functions/tasks';

import { runAs } from '../global-options.js';
import { UpstreamError } from '../ports/errors.js';
import type { Ports } from '../ports/index.js';
import { cacheExpiry, cooldownEnd, nominatimCoolUntil, stampOf } from './records.js';

/**
 * `assist.geocode` (task queue `assist-geocode`, `fn-events@`; `docs/research/M4-interfaces.md` §4.2; S-A45-HAPPY-
 * GEOCODE-QUEUE, S-A45-BAD-GEOCODE-COOLDOWN, S-A09-BAD-NOMINATIM-429): the only caller of Nominatim. One request a second
 * for the whole project, one at a time (`GEOCODE_RATE_LIMITS`), at the cell's centre and never the admin's more precise
 * place, in Romanian. The answer becomes at most `MAX_TITLE_SUGGESTIONS` plain-text titles (the object's name with its
 * English one, the road with its quarter, the quarter alone), cached for `GEOCODE_CACHE_DAYS`.
 *
 * A refusal (429, 403) fails the cell with `apiError.assist.rateLimited` and cools every request down for
 * `GEOCODE_COOLDOWN_MINUTES` (`ops/assist`), without a retry; a 5xx or a timeout is retried once by the queue, then the
 * cell fails with `apiError.assist.unavailable` until the cool-down's length has passed. A cell that is no longer
 * `queued` (answered meanwhile) is left as it is.
 */
export type GeocodeDeps = Pick<Ports, 'documents' | 'clock' | 'log' | 'geocoder'>;

type ReversePlace = NonNullable<Awaited<ReturnType<Ports['geocoder']['reverse']>>>;

/** The queue's attempts: the first, and one retry after a 5xx or a timeout. */
export const GEOCODE_MAX_ATTEMPTS = 2;

/** Plain text of at most a title's length, or null when nothing is left. */
function clean(text: string | undefined): string | null {
    return text === undefined ? null : (sanitizeDraft(text, 'title')?.text ?? null);
}

function suggestion(ro: string | null, en: string | null = null): TitleSuggestion[] {
    if (ro === null) {
        return [];
    }
    return [en === null || en === ro ? { ro } : { ro, en }];
}

/** The suggestions a place offers, best first, without repeats. */
export function suggestionsOf(place: ReversePlace | undefined): TitleSuggestion[] {
    if (place === undefined) {
        return [];
    }
    const road = clean(place.road);
    const area = clean(place.area);
    const candidates = [
        ...suggestion(clean(place.name), clean(place.nameEn)),
        ...suggestion(road !== null && area !== null ? clean(`${road}, ${area}`) : road),
        ...suggestion(area),
    ];
    const unique = candidates.filter((candidate, index) => candidates.findIndex((other) => other.ro === candidate.ro) === index);
    return unique.slice(0, MAX_TITLE_SUGGESTIONS);
}

function answeredCell(cell: GeocodeCellDoc, change: Partial<GeocodeCellDoc>, now: Date): GeocodeCellDoc {
    return { ...cell, ...change, answeredAt: timestampFromDate(now), ...stampOf(now) };
}

/** Writes the cell's outcome, but only while it is still the `queued` cell the task was made for. */
async function settle(deps: GeocodeDeps, key: string, change: Partial<GeocodeCellDoc>): Promise<void> {
    const path = FIRESTORE_PATHS.geocodeCell(key);
    const now = deps.clock.now();
    await deps.documents.transaction(async (transaction) => {
        const cell = await transaction.get(path, geocodeCellDocSchema);
        if (cell?.state === 'queued') {
            await transaction.set(path, geocodeCellDocSchema, answeredCell(cell, change, now));
        }
    });
}

function failure(error: ApiErrorCode, until: Date): Partial<GeocodeCellDoc> {
    return { state: 'failed', suggestions: [], error, expiresAt: timestampFromDate(until) };
}

/** Nominatim refused: nothing is asked until `until` (the day's count of queued cells kept). */
async function coolDown(deps: GeocodeDeps, until: Date): Promise<void> {
    const now = deps.clock.now();
    await deps.documents.transaction(async (transaction) => {
        const state = await transaction.get(FIRESTORE_PATHS.assistState, assistStateDocSchema);
        await transaction.set(FIRESTORE_PATHS.assistState, assistStateDocSchema, {
            ...state,
            nominatimCoolUntil: timestampFromDate(until),
            ...stampOf(now),
        });
    });
}

/** A failed request: a refusal cools down; a transient failure is retried by the queue unless this was the last attempt. */
async function failed(deps: GeocodeDeps, key: string, error: unknown, lastAttempt: boolean): Promise<void> {
    const until = cooldownEnd(deps.clock.now());
    if (error instanceof UpstreamError && error.failure === 'rateLimited') {
        await coolDown(deps, until);
        await settle(deps, key, failure('apiError.assist.rateLimited', until));
        deps.log.warn('nominatim refused: cooling down', { key, until: until.toISOString() });
        return;
    }
    if (!lastAttempt) {
        throw error;
    }
    await settle(deps, key, failure('apiError.assist.unavailable', until));
    deps.log.warn('nominatim unavailable: the admin types the title', { key, error: String(error) });
}

/** The centre of a cell still waiting in the queue; undefined for a malformed key or a cell answered meanwhile. */
async function queuedCentre(deps: GeocodeDeps, key: string): Promise<{ readonly lat: number; readonly lng: number } | undefined> {
    const centre = geocodeCellCenter(key);
    if (centre === undefined) {
        return undefined;
    }
    const cell = await deps.documents.get(FIRESTORE_PATHS.geocodeCell(key), geocodeCellDocSchema);
    return cell?.state === 'queued' ? centre : undefined;
}

/** Asks Nominatim for the cell and caches what it offers. */
async function answer(deps: GeocodeDeps, key: string, centre: { readonly lat: number; readonly lng: number }): Promise<void> {
    const place = await deps.geocoder.reverse({ ...centre, lang: 'ro' });
    const now = deps.clock.now();
    const ready = { state: 'ready', suggestions: suggestionsOf(place), attribution: NOMINATIM_ATTRIBUTION } as const;
    await settle(deps, key, { ...ready, expiresAt: timestampFromDate(cacheExpiry(now)) });
}

/** Answers one queued cell. `attempt` is the queue's (0 for the first). */
export async function geocodeCell(deps: GeocodeDeps, task: GeocodeTask, attempt: number): Promise<void> {
    const centre = await queuedCentre(deps, task.key);
    if (centre === undefined) {
        return;
    }
    const coolUntil = await nominatimCoolUntil(deps.documents, deps.clock.now());
    if (coolUntil !== undefined) {
        await settle(deps, task.key, failure('apiError.assist.rateLimited', coolUntil));
        return;
    }
    await answer(deps, task.key, centre).catch((error: unknown) => failed(deps, task.key, error, attempt + 1 >= GEOCODE_MAX_ATTEMPTS));
}

/** The `assist-geocode` task queue: one dispatch a second for the whole project, one at a time, one retry after 10 s. */
export function geocodeFunction(getDeps: () => GeocodeDeps) {
    return onTaskDispatched(
        {
            rateLimits: { ...GEOCODE_RATE_LIMITS },
            retryConfig: { maxAttempts: GEOCODE_MAX_ATTEMPTS, minBackoffSeconds: 10 },
            maxInstances: 1,
            timeoutSeconds: 60,
            ...runAs('assist.geocode'),
        },
        async (request) => {
            const deps = getDeps();
            const task = validate(geocodeTaskSchema, request.data);
            if (!task.ok) {
                deps.log.error('geocode task refused', { queue: ASSIST_GEOCODE_QUEUE, issues: task.issues.length });
                return;
            }
            await geocodeCell(deps, task.value, request.retryCount);
        },
    );
}
