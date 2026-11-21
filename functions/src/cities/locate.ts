import '../global-options.js';

import {
    FIRESTORE_PATHS,
    GEOCODE_COOLDOWN_MINUTES,
    assistStateDocSchema,
    cityAreaAround,
    systemWriter,
    timestampFromDate,
    timestampToDate,
    type CallableRequest,
    type CallableResponse,
} from '@hcm/shared';

import type { VerifiedCaller } from '../api/access.js';
import { defineCallable, type CallableDeps } from '../api/callable.js';
import { UpstreamError } from '../ports/errors.js';
import type { Ports } from '../ports/index.js';

export type LocateDeps = Pick<Ports, 'documents' | 'geocoder' | 'clock' | 'log'>;

type LocateRequest = CallableRequest<'cities.locate'>;
type LocateResponse = CallableResponse<'cities.locate'>;

const NOT_FOUND: LocateResponse = { bounds: null };
const MINUTE_MS = 60_000;

/** Whether `assist/state` says Nominatim refused recently: the title suggestions' cool-down is not over. */
async function coolingDown(deps: LocateDeps, now: Date): Promise<boolean> {
    const until = (await deps.documents.get(FIRESTORE_PATHS.assistState, assistStateDocSchema))?.nominatimCoolUntil;
    return until !== undefined && timestampToDate(until).getTime() > now.getTime();
}

/** A refusal starts the shared cool-down, so neither this call nor the title suggestions' queue asks again for a while. */
async function coolDown(deps: LocateDeps, now: Date): Promise<void> {
    const path = FIRESTORE_PATHS.assistState;
    const state = await deps.documents.get(path, assistStateDocSchema);
    await deps.documents.set(path, assistStateDocSchema, {
        ...state,
        nominatimCoolUntil: timestampFromDate(new Date(now.getTime() + GEOCODE_COOLDOWN_MINUTES * MINUTE_MS)),
        updatedBy: systemWriter('cities'),
        updatedAt: timestampFromDate(now),
    });
}

/** The place Nominatim names, or none when it cannot answer now (the admin then draws the rectangle by hand). */
async function search(deps: LocateDeps, name: string, now: Date): Promise<LocateResponse> {
    try {
        const place = await deps.geocoder.search({ q: name, lang: 'ro' });
        return place === undefined ? NOT_FOUND : { bounds: cityAreaAround(place.bounds), place: place.name.slice(0, 300) };
    } catch (error) {
        if (!(error instanceof UpstreamError)) {
            throw error;
        }
        if (error.failure === 'rateLimited') {
            await coolDown(deps, now);
        }
        deps.log.warn('city not located', { failure: error.failure });
        return NOT_FOUND;
    }
}

/**
 * `cities.locate` (the project's owner; M5 UX review: New city's minimum input; S-A50-HAPPY, S-A50-BAD-NOT-FOUND): where
 * the name New city was given lies, from one Nominatim search (`docs/research/M4-interfaces.md` §4.2's usage policy: the
 * application's own User-Agent; nothing while the title suggestions' cool-down holds, and a refusal starts it), as a
 * rectangle that can be a city (`cityAreaAround`). Nothing found, a cool-down or a failure answers `bounds: null`: the
 * admin draws the rectangle as before. The name is never logged.
 */
async function citiesLocate(deps: LocateDeps, _caller: VerifiedCaller, request: LocateRequest): Promise<LocateResponse> {
    const now = deps.clock.now();
    if (await coolingDown(deps, now)) {
        return NOT_FOUND;
    }
    return search(deps, request.name, now);
}

/** The `cities-locate` callable. */
export function locateFunction(getDeps: () => LocateDeps & CallableDeps) {
    return defineCallable('cities.locate', citiesLocate, getDeps);
}
