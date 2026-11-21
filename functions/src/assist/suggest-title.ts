import '../global-options.js';

import {
    ASSIST_GEOCODE_QUEUE,
    FIRESTORE_PATHS,
    GEOCODE_DAILY_CAP,
    NOMINATIM_ATTRIBUTION,
    PHOTO_LOCATION_SLACK_DEG,
    bboxContains,
    bboxExpand,
    assistStateDocSchema,
    bboxFromRecord,
    geocodeCellDocSchema,
    geocodeCellKey,
    queuedOn,
    timestampFromDate,
    timestampToDate,
    usageMonth,
    utcDay,
    type ApiErrorCode,
    type CallableResponse,
    type CityDoc,
    type CityUsageDoc,
    type GeocodeCellDoc,
} from '@hcm/shared';

import { ApiError } from '../api/api-error.js';
import { defineCallable, type CallableDeps } from '../api/callable.js';
import { geocodedOn, readCityUsage, shareOf, writeCityUsage, type CityShare } from '../api/city-usage.js';
import type { DocumentTransaction } from '../ports/documents.js';
import type { Ports } from '../ports/index.js';
import { QUEUED_FRESH_MS, nominatimCoolUntil, requireCity, stampOf } from './records.js';

/**
 * `assist.suggestTitle` (admin; `docs/research/M4-interfaces.md` §4.2; S-A09-HAPPY-TITLE-SUGGESTION, S-A45-HAPPY-
 * GEOCODE-QUEUE, S-A45-BAD-GEOCODE-COOLDOWN): title suggestions for the place a photo or a point shows. The place is
 * rounded to its cache cell (`geocodeCellKey`, about 11 m); a cell answered and not expired answers at once, one asked
 * less than two minutes ago answers `queued`, one refused or failed answers `failed` until it expires. Otherwise, while
 * Nominatim cools down after a refusal, the answer is `failed` with `apiError.assist.rateLimited` and nothing is queued;
 * past `GEOCODE_DAILY_CAP` cells queued today (UTC, the project's) or (M5) the city's daily share, `failed` with
 * `apiError.assist.dailyCap` (Nominatim's
 * policy forbids bulk use); else the cell is set `queued` and the day's count raised in one transaction (two admins asking
 * at once queue one task) and one task goes to the `assist-geocode` queue, whose worker asks Nominatim one request a
 * second. A task that cannot be queued takes its cell back, so asking again queues anew. The editor listens to the cell.
 */
export type SuggestTitleDeps = CallableDeps & Pick<Ports, 'documents' | 'clock' | 'tasks'>;

type Response = CallableResponse<'assist.suggestTitle'>;

interface LatLng {
    readonly lat: number;
    readonly lng: number;
}

/** The cell as the callable answers it. */
function answerOf(key: string, cell: GeocodeCellDoc): Response {
    return {
        state: cell.state,
        key,
        suggestions: cell.suggestions,
        attribution: cell.attribution,
        ...(cell.error === undefined ? {} : { error: cell.error }),
    };
}

/** Whether a stored cell still answers by itself (`ready` or `failed` not expired, `queued` still fresh). */
export function cellAnswers(cell: GeocodeCellDoc | undefined, now: Date): cell is GeocodeCellDoc {
    if (cell === undefined) {
        return false;
    }
    if (cell.state === 'queued') {
        return now.getTime() - timestampToDate(cell.requestedAt).getTime() < QUEUED_FRESH_MS;
    }
    return timestampToDate(cell.expiresAt) > now;
}

/** The city's bounds plus `PHOTO_LOCATION_SLACK_DEG`, the reach of a photo's place (the editors' own limit). */
function withinReach(bounds: Parameters<typeof bboxFromRecord>[0], location: LatLng): boolean {
    return bboxContains(bboxExpand(bboxFromRecord(bounds), PHOTO_LOCATION_SLACK_DEG), [location.lng, location.lat]);
}

function queuedCell(now: Date): GeocodeCellDoc {
    return {
        state: 'queued',
        suggestions: [],
        attribution: NOMINATIM_ATTRIBUTION,
        requestedAt: timestampFromDate(now),
        expiresAt: timestampFromDate(new Date(now.getTime() + QUEUED_FRESH_MS)),
        ...stampOf(now),
    };
}

/** What the claim found: the cell answers by itself, today's cap is reached, or the cell is now `queued` (queue it). */
type Claim = { readonly kind: 'answers'; readonly cell: GeocodeCellDoc } | { readonly kind: 'capped' } | { readonly kind: 'queued' };

/** M5: the city's counters while its daily share of cells has room, `capped` once it has none, undefined without a share. */
async function cityGeocodeRoom(
    transaction: DocumentTransaction,
    share: CityShare | undefined,
    now: Date,
): Promise<{ readonly share: CityShare; readonly usage: CityUsageDoc } | 'capped' | undefined> {
    if (share === undefined) {
        return undefined;
    }
    const usage = await readCityUsage(transaction, share, usageMonth(now));
    return geocodedOn(usage, utcDay(now)) >= share.limits.geocodeCellsPerDay ? 'capped' : { share, usage };
}

/**
 * In one transaction: the cell as stored when it still answers; else, under today's caps (the project's and, M5, the
 * city's share), the cell set `queued` and counted.
 */
async function claimCell(deps: SuggestTitleDeps, key: string, now: Date, share: CityShare | undefined): Promise<Claim> {
    const path = FIRESTORE_PATHS.geocodeCell(key);
    return deps.documents.transaction(async (transaction): Promise<Claim> => {
        const cell = await transaction.get(path, geocodeCellDocSchema);
        if (cellAnswers(cell, now)) {
            return { kind: 'answers', cell };
        }
        const state = await transaction.get(FIRESTORE_PATHS.assistState, assistStateDocSchema);
        const day = utcDay(now);
        const queued = queuedOn(state, day);
        const city = queued >= GEOCODE_DAILY_CAP ? 'capped' : await cityGeocodeRoom(transaction, share, now);
        if (city === 'capped') {
            return { kind: 'capped' };
        }
        await transaction.set(path, geocodeCellDocSchema, queuedCell(now));
        await transaction.set(FIRESTORE_PATHS.assistState, assistStateDocSchema, {
            ...state,
            queuedDay: day,
            queuedToday: queued + 1,
            ...stampOf(now),
        });
        if (city !== undefined) {
            const counted = { ...city.usage, geocodeDay: day, geocodeToday: geocodedOn(city.usage, day) + 1 };
            await writeCityUsage(transaction, city.share, counted, stampOf(now));
        }
        return { kind: 'queued' };
    });
}

const refused = (key: string, error: ApiErrorCode): Response => ({
    state: 'failed',
    key,
    suggestions: [],
    attribution: NOMINATIM_ATTRIBUTION,
    error,
});

/** One task for the cell; a task that cannot be queued takes the cell back (no `queued` cell without a task behind it). */
async function enqueue(deps: SuggestTitleDeps, key: string, now: Date): Promise<void> {
    try {
        await deps.tasks.enqueue(ASSIST_GEOCODE_QUEUE, { key }, { id: `${key}-${String(now.getTime())}` });
    } catch (error) {
        await deps.documents.delete(FIRESTORE_PATHS.geocodeCell(key));
        throw error;
    }
}

/** A cell that does not answer by itself: refused while Nominatim cools down or past today's caps, else queued. */
async function queueCell(
    deps: SuggestTitleDeps,
    key: string,
    now: Date,
    city: { readonly id: string; readonly doc: CityDoc },
): Promise<Response> {
    const cityId = city.id;
    if ((await nominatimCoolUntil(deps.documents, now)) !== undefined) {
        return refused(key, 'apiError.assist.rateLimited');
    }
    const claim = await claimCell(deps, key, now, shareOf(cityId, city.doc));
    if (claim.kind !== 'queued') {
        return claim.kind === 'answers' ? answerOf(key, claim.cell) : refused(key, 'apiError.assist.dailyCap');
    }
    await enqueue(deps, key, now);
    deps.log.info('title suggestions queued', { cityId, key });
    return answerOf(key, queuedCell(now));
}

async function suggestTitle(deps: SuggestTitleDeps, data: { readonly cityId: string; readonly location: LatLng }): Promise<Response> {
    const city = await requireCity(deps.documents, data.cityId);
    if (!withinReach(city.bounds, data.location)) {
        throw new ApiError('apiError.invalidRequest', undefined, [{ path: 'location', code: 'validation.outsideCity' }]);
    }
    const now = deps.clock.now();
    const key = geocodeCellKey(data.location.lat, data.location.lng);
    const stored = await deps.documents.get(FIRESTORE_PATHS.geocodeCell(key), geocodeCellDocSchema);
    return cellAnswers(stored, now) ? answerOf(key, stored) : queueCell(deps, key, now, { id: data.cityId, doc: city });
}

export function suggestTitleFunction(getDeps: () => SuggestTitleDeps) {
    return defineCallable('assist.suggestTitle', (deps: SuggestTitleDeps, _caller, data) => suggestTitle(deps, data), getDeps);
}
