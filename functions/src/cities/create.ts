import '../global-options.js';

import {
    DEFAULT_NEW_CITY_LIMITS,
    FIRESTORE_PATHS,
    MAX_CITIES,
    adminDocSchema,
    cityDocSchema,
    harvestStateDocSchema,
    startViewForBounds,
    suggestCityId,
    timestampFromDate,
    type CallableRequest,
    type CallableResponse,
    type CityDoc,
    type HarvestStateDoc,
} from '@hcm/shared';

import type { VerifiedCaller } from '../api/access.js';
import { ApiError } from '../api/api-error.js';
import { defineCallable, type CallableDeps } from '../api/callable.js';
import { migrateLegacyInvites, projectCityIds, rolesWithOwnedCity } from '../api/memberships.js';
import { createStarterCategories } from '../api/starter-categories.js';
import { InvalidDocumentError } from '../ports/errors.js';
import type { Ports } from '../ports/index.js';
import { aboutText, privacyText } from './texts.js';

export type CreateDeps = Pick<Ports, 'documents' | 'clock' | 'log'>;

type CreateRequest = CallableRequest<'cities.create'>;
type CreateResponse = CallableResponse<'cities.create'>;

/** The basemap every new city starts with (Settings changes it): Mapbox Standard, as the M1 starter kit's. */
const NEW_CITY_BASEMAP = { style: 'mapbox://styles/mapbox/standard' } as const;

/** The GA4 ids of another city of the project (one property serves them all), or none. */
async function projectAnalytics(deps: CreateDeps, cityIds: readonly string[]): Promise<CityDoc['analytics']> {
    for (const cityId of cityIds) {
        const analytics = await deps.documents.get(FIRESTORE_PATHS.city(cityId), cityDocSchema).then(
            (city) => city?.analytics,
            (error: unknown) => {
                if (error instanceof InvalidDocumentError) {
                    return undefined;
                }
                throw error;
            },
        );
        if (analytics?.measurementId !== undefined) {
            return analytics;
        }
    }
    return undefined;
}

/** The new city's document: what the flow sent, then what the server derives from it. */
function newCity(request: CreateRequest, analytics: CityDoc['analytics'], caller: VerifiedCaller, now: Date): CityDoc {
    const at = timestampFromDate(now);
    return {
        id: request.cityId,
        name: request.name,
        bounds: request.bounds,
        ...startViewForBounds(request.bounds),
        about: aboutText(request.name),
        privacy: privacyText(),
        theme: request.theme,
        basemap: NEW_CITY_BASEMAP,
        imagery: {},
        limits: DEFAULT_NEW_CITY_LIMITS,
        ...(analytics === undefined ? {} : { analytics }),
        published: false,
        createdAt: at,
        updatedBy: caller.uid,
        updatedAt: at,
    };
}

/**
 * The new city's harvest state, due at once: the next `imagery.tick` searches its rectangle (S-A50-HAPPY-HARVEST), with
 * no call of the flow's. A city without a state waits for the Imagery area's first visit (CR-M3-44, so that the e2e content
 * worlds' cities are never harvested); a created one is meant to be used, so its first harvest is not left waiting. The
 * state reads as an attempt that found nothing, made when the city was created, due now.
 */
function firstHarvest(at: CityDoc['updatedAt'], uid: string): HarvestStateDoc {
    return { attemptedAt: at, outcome: 'empty', failures: 0, nextAt: at, updatedBy: uid, updatedAt: at };
}

/**
 * An id another city already has: the caller's own city answers `{created: false}` (a retried call, nothing written:
 * S-A50-HAPPY-RETRY); anyone else's is `apiError.city.idTaken` with a free id to offer (S-A50-BAD-ID-TAKEN).
 */
function retried(caller: VerifiedCaller, request: CreateRequest, taken: readonly string[]): CreateResponse {
    if (caller.membership?.roleIn(request.cityId) === 'owner') {
        return { created: false, cityId: request.cityId };
    }
    throw new ApiError('apiError.city.idTaken', { cityId: request.cityId, suggestion: suggestCityId(request.name.ro, taken) });
}

/**
 * In one transaction: the city, its starter POI categories, and the caller as its owner (`admins/{uid}.cities`). A city created meanwhile under the
 * same id makes it `apiError.city.idTaken`; a caller removed meanwhile, `apiError.notAdmin`.
 */
async function writeCity(deps: CreateDeps, caller: VerifiedCaller, request: CreateRequest, taken: readonly string[]): Promise<void> {
    const city = newCity(request, await projectAnalytics(deps, taken), caller, deps.clock.now());
    const adminPath = FIRESTORE_PATHS.admin(caller.uid);
    await deps.documents.transaction(async (transaction) => {
        const existing = await transaction.get(FIRESTORE_PATHS.city(request.cityId), cityDocSchema);
        const admin = await transaction.get(adminPath, adminDocSchema);
        if (existing !== undefined) {
            throw new ApiError('apiError.city.idTaken', { cityId: request.cityId, suggestion: suggestCityId(request.name.ro, taken) });
        }
        if (admin === undefined) {
            throw new ApiError('apiError.notAdmin');
        }
        await transaction.create(FIRESTORE_PATHS.city(request.cityId), cityDocSchema, city);
        await createStarterCategories(transaction, request.cityId, city);
        await transaction.set(
            FIRESTORE_PATHS.harvestState(request.cityId),
            harvestStateDocSchema,
            firstHarvest(city.updatedAt, caller.uid),
        );
        const cities = rolesWithOwnedCity(admin, taken, request.cityId);
        await transaction.set(adminPath, adminDocSchema, { ...admin, cities, updatedBy: caller.uid, updatedAt: city.updatedAt });
    });
}

/**
 * `cities.create` (the project's owner; `docs/research/M5-interfaces.md` §1.6; S-A50-*): the New city flow's one call.
 * Refuses an id another city has, and a twenty-first city (`apiError.city.tooMany`); the request's schema already
 * refused a reserved or malformed id and a rectangle outside `CITY_SPAN_LIMITS`. The city starts unpublished, with
 * the start view of its rectangle, texts made from its name, the default basemap, the flow's theme, the new-city
 * limits, the project's analytics ids and the five starter POI categories (finding 35 of 2026-11-01); its creator owns it. Nothing else is asked: the first USGS harvest runs at
 * the next `imagery.tick`, which finds the new city's harvest state due (S-A50-HAPPY-HARVEST), and the viewer's
 * Mapbox token is minted by the flow's follow-up `setup.rotatePublicToken` (the token belongs to `setup/`). A pending
 * invitation from before M5 is given the existing cities first (`migrateLegacyInvites`), so it never grants this one.
 */
async function citiesCreate(deps: CreateDeps, caller: VerifiedCaller, request: CreateRequest): Promise<CreateResponse> {
    const taken = await projectCityIds(deps.documents);
    if (taken.includes(request.cityId)) {
        return retried(caller, request, taken);
    }
    if (taken.length >= MAX_CITIES) {
        throw new ApiError('apiError.city.tooMany', { max: String(MAX_CITIES) });
    }
    // A pending invitation from before M5 gets the cities of now first, never this one (docs/LESSONS.md 245).
    await migrateLegacyInvites(deps);
    await writeCity(deps, caller, request, taken);
    deps.log.info('city created', { uid: caller.uid, cityId: request.cityId });
    return { created: true, cityId: request.cityId };
}

/** The `cities-create` callable. */
export function createFunction(getDeps: () => CreateDeps & CallableDeps) {
    return defineCallable('cities.create', citiesCreate, getDeps);
}
