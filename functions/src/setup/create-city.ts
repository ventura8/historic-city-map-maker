import {
    FIRESTORE_PATHS,
    adminDocSchema,
    cityDocSchema,
    timestampFromDate,
    type CallableRequest,
    type CallableResponse,
    type CityDoc,
} from '@hcm/shared';

import type { VerifiedCaller } from '../api/access.js';
import { projectCityIds, rolesWithOwnedCity } from '../api/memberships.js';
import { createStarterCategories } from '../api/starter-categories.js';
import type { Ports } from '../ports/index.js';
import { stampOf } from './records.js';

export type CreateCityDeps = Pick<Ports, 'documents' | 'clock' | 'log'>;

type Request = CallableRequest<'setup.createCity'>;

/** The new city: the client's fields, then the fields only the server writes (`id`, `createdAt`, published, the stamp). */
function newCity(request: Request, caller: VerifiedCaller, deps: CreateCityDeps): CityDoc {
    const stamp = stampOf(caller.uid, deps);
    return { ...request.city, id: request.cityId, published: true, createdAt: timestampFromDate(deps.clock.now()), ...stamp };
}

/**
 * `setup.createCity` (the project's owner; docs/research/M2b-interfaces.md §3.3 d2, CR-M2b-1): right after the owner claim, the
 * Setup Assistant creates the city from the bundled seed (`legacy/<city>/city.json`), because the rules never let a
 * client create a city and `setup.saveMapbox` needs one. Idempotent: in one transaction, an existing city is left as it
 * is and answered `{created: false}`. The bundled city is public today (the static site), so it is created published:
 * its manifest appears once `setup.saveMapbox` writes the viewer token (the builder publishes nothing before). M5
 * (`docs/research/M5-interfaces.md` §1.1): the same transaction makes the caller, the project's owner, the city's owner.
 * The same transaction writes the five starter POI categories (finding 35 of 2026-11-01: the bundled seed has none, and a
 * city without a category cannot hold a place).
 */
export async function createCity(
    deps: CreateCityDeps,
    caller: VerifiedCaller,
    request: Request,
): Promise<CallableResponse<'setup.createCity'>> {
    const path = FIRESTORE_PATHS.city(request.cityId);
    const adminPath = FIRESTORE_PATHS.admin(caller.uid);
    const cityIds = await projectCityIds(deps.documents);
    const created = await deps.documents.transaction(async (transaction) => {
        const existing = await transaction.get(path, cityDocSchema);
        const admin = await transaction.get(adminPath, adminDocSchema);
        if (existing !== undefined) {
            return false;
        }
        const city = newCity(request, caller, deps);
        await transaction.create(path, cityDocSchema, city);
        await createStarterCategories(transaction, request.cityId, city);
        if (admin !== undefined) {
            const cities = rolesWithOwnedCity(admin, cityIds, request.cityId);
            await transaction.set(adminPath, adminDocSchema, { ...admin, cities, updatedBy: city.updatedBy, updatedAt: city.updatedAt });
        }
        return true;
    });
    deps.log.info('city created', { uid: caller.uid, cityId: request.cityId, created });
    return { created };
}
